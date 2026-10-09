//188 Inert, caller-owned capacity probes. ONE actual RPC submit is the template;
//203 request/submit pairs are explicitly synthetic constrained copies, not 203
//user submissions. Every write lives in one rollback-only transaction. No new
//database, process, permissions, timeout changes or disabled constraints.
import assert from 'node:assert/strict';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';

const requestTable='merchant_attendance_work_arrangement_requests';
const entryTable='merchant_attendance_work_arrangement_entries';
const stamp=ms=>new Date(ms).toISOString();
const fid=n=>id(188000000+n);
const parseLines=output=>output.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));

// Pure plan exported for bounded fixture tests; this is not a business API.
export function workArrangementCapacityFixturePlan(home,workerId){
  assert(Number.isSafeInteger(home?.settingsVersion)&&home.settingsVersion>=1);
  assert(Number.isSafeInteger(home?.policy?.revision)&&home.policy.revision>=0);
  assert.equal(typeof home.timeZone,'string');assert.equal(typeof workerId,'string');
  const day=Date.parse(home.readAt.slice(0,10)+'T00:00:00.000Z');assert(Number.isFinite(day));
  const start=day+90*86400000+9*3600000,end=start+3600000;
  assert(stamp(end).slice(0,10)<='2100-12-31');
  const span={kind:'remote',timeZone:home.timeZone,startAt:stamp(start),endAt:stamp(end)};
  const command={action:'submit',operationId:fid(1),reason:'Synthetic188 actual RPC capacity template',
    expectedWorkerId:workerId,expectedSettingsVersion:home.settingsVersion,expectedPolicyRevision:home.policy.revision,...span};
  const unrelated=Array.from({length:101},(_,n)=>({id:fid(100+n),startAt:stamp(start-86400000),endAt:stamp(end-86400000)}));
  const related=Array.from({length:99},(_,n)=>({id:fid(300+n),startAt:span.startAt,endAt:span.endAt}));
  const adjacent=[{id:fid(500),startAt:stamp(start-3600000),endAt:span.startAt},
    {id:fid(501),startAt:span.endAt,endAt:stamp(end+3600000)}];
  const overflow={id:fid(600),startAt:span.startAt,endAt:span.endAt};
  const copies=[...unrelated,...related,...adjacent,overflow],ids=[command.operationId,...copies.map(row=>row.id)];
  assert.equal(copies.length,203);assert.equal(new Set(ids).size,204);
  return {span,command,unrelated,related,adjacent,overflow,ids};
}

function fingerprint(names,site=null,excludedIds=[]){
  assert(names.length>0&&new Set(names).size===names.length);
  const excluded=excludedIds.map(value=>quote(value)+'::uuid').join(',');
  return '(select md5(jsonb_object_agg(cap_table_name,cap_table_rows order by cap_table_name)::text) from ('+names.map(name=>{
    assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name));
    const where=excludedIds.length&&[requestTable,entryTable].includes(name)
      ?` where not (wa_cap_row.merchant_id=${quote(site)} and wa_cap_row.request_id=any(array[${excluded}]))`:'';
    return `select ${quote(name)} cap_table_name,(select coalesce(jsonb_agg(to_jsonb(wa_cap_row) order by to_jsonb(wa_cap_row)::text),'[]') from public.${name} wa_cap_row${where}) cap_table_rows`;
  }).join(' union all ')+') wa_cap_fact_rows)';
}

export async function verifyWorkArrangementCapacityNative({d,native,scope,h,work,wq}){
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true&&h.syntheticHistoricalRows===10);
  assert.equal(typeof native?.querySteps,'function');assert.equal(typeof work,'function');assert.equal(typeof wq,'function');
  const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);
  assert.equal(h.workerId,d.otherWorker);assert.equal(h.employeeId,d.otherEmployee);assert.equal(h.employeeAuthUserId,d.otherAuth);
  const baseline=d.fingerprint(),defs=d.definitions(),catalog=d.tableCatalog(),names=d.inventory();
  assert(names.includes(requestTable)&&names.includes(entryTable));
  const home=await work(wq());assert.equal(d.fingerprint(),baseline,'capacity_home_read_wrote');
  assert(home.canSubmit&&home.workerId===h.workerId&&home.employeeId===h.employeeId&&home.actorId===h.employeeAuthUserId,'capacity_current_self_required');
  const plan=workArrangementCapacityFixturePlan(home,h.workerId),allHash=fingerprint(names),protectedHash=fingerprint(names,d.site,plan.ids);
  const site=quote(d.site),worker=quote(h.workerId),employee=quote(h.employeeId),auth=quote(h.employeeAuthUserId);
  const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
  const checkedConstraints='set constraints all immediate;set constraints all deferred;';
  const context=`public.faolla_attendance_work_arrangement_context_v1(${site},${worker},${employee},${auth},${quote(plan.span.startAt)}::timestamptz,${quote(plan.span.endAt)}::timestamptz)`;
  const conflicts=`public.faolla_attendance_work_arrangement_conflicts_v1(${site},${worker},${employee},${auth},${quote(plan.span.startAt)}::timestamptz,${quote(plan.span.endAt)}::timestamptz,null)`;
  // Helpers are intentionally called as the verified namespace owner, never
  //granted to service_role. The real template submit authenticates via the RPC.
  const expressions={context,conflicts};
  const read=(label,kind)=>`${prefix}select jsonb_build_object('kind','before_read','label',${quote(label)},'reader',${quote(kind)},'hash',${allHash});
    select jsonb_build_object('kind','read','label',${quote(label)},'reader',${quote(kind)},'value',${expressions[kind]});
    select jsonb_build_object('kind','after_read','label',${quote(label)},'reader',${quote(kind)},'hash',${allHash});`;
  const reject=kind=>`${prefix}do $capacity_reject$ declare wa_before_hash text;begin wa_before_hash:=${allHash};
    begin perform ${expressions[kind]};raise exception 'capacity_expected_rejection_missing';
    exception when raise_exception then if sqlerrm<>'attendance_work_arrangement_too_large' then raise;end if;end;
    assert ${allHash}=wa_before_hash,'capacity_failed_read_wrote';end;$capacity_reject$;
    select jsonb_build_object('kind','rejection','reader',${quote(kind)},'code','attendance_work_arrangement_too_large');`;
  const mark=kind=>`${prefix}select jsonb_build_object('kind',${quote(kind)},'hash',${protectedHash});`;
  const initial=`do $capacity_initial$ begin
    assert exists(select 1 from public.faolla_schema_migrations where version=202610060156 and name='merchant_attendance_work_arrangements'),'capacity156_required';
    assert not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and t.tgenabled<>'O'),'capacity_all_triggers_enabled';
    assert exists(select 1 from pg_constraint where conrelid='public.${requestTable}'::regclass and conname='attendance_work_arrangement_submit_fk' and condeferrable and condeferred),'capacity_deferred_submit_pair_required';
    assert not exists(select 1 from public.${requestTable} where merchant_id=${site} and request_id=any(array[${plan.ids.map(value=>quote(value)+'::uuid').join(',')}])), 'capacity_fixture_ids_unused';
    -- The private ABI requires the same settings -> worker lock order as its
    --authorized public callers, including the first empty-target read.
    perform 1 from public.merchant_attendance_settings where merchant_id=${site} for update;
    assert found,'capacity_settings_required';
    perform 1 from public.merchant_attendance_workers where merchant_id=${site} and id=${worker} for update;
    assert found,'capacity_worker_required';
  end;$capacity_initial$;`;
  const template=`set local role service_role;select jsonb_build_object('kind','template','value',public.faolla_attendance_work_arrangement_v1(
    ${json(wq())},${auth},${json(plan.command)},true));reset role;${checkedConstraints}`;
  const copyBatch=rows=>{
    assert(rows.length>0&&rows.length<=10);
    return `do $capacity_copy$ declare wa_copy jsonb;wa_request public.${requestTable}%rowtype;wa_entry public.${entryTable}%rowtype;begin
      for wa_copy in select value from jsonb_array_elements(${json(rows)}) loop
        select * into strict wa_request from public.${requestTable} where merchant_id=${site} and request_id=${quote(plan.command.operationId)};
        select * into strict wa_entry from public.${entryTable} where merchant_id=${site} and operation_id=${quote(plan.command.operationId)};
        wa_request.request_id:=(wa_copy->>'id')::uuid;wa_request.start_at:=(wa_copy->>'startAt')::timestamptz;wa_request.end_at:=(wa_copy->>'endAt')::timestamptz;
        wa_request.reason:='Synthetic188 constrained capacity copy';
        wa_entry.request_id:=wa_request.request_id;wa_entry.operation_id:=wa_request.request_id;
        wa_entry.command:=wa_entry.command||jsonb_build_object('operationId',wa_request.request_id,'startAt',wa_copy->>'startAt','endAt',wa_copy->>'endAt','reason',wa_request.reason);
        wa_entry.snapshot:=wa_entry.snapshot||jsonb_build_object('requestId',wa_request.request_id,'startAt',wa_copy->>'startAt','endAt',wa_copy->>'endAt');
        insert into public.${requestTable} select (wa_request).*;
        insert into public.${entryTable} select (wa_entry).*;
        -- Each copy passes the same immutable receipt validator, including
        --actual saved policy/identity/command/snapshot, even when off-window.
        perform public.faolla_attendance_work_arrangement_summary_v1(wa_request);
      end loop;end;$capacity_copy$;${checkedConstraints}`;
  };
  const batches=rows=>{const out=[];for(let i=0;i<rows.length;i+=10)out.push(prefix+copyBatch(rows.slice(i,i+10)));return out;};
  const checkPair=label=>[read(label,'context'),read(label,'conflicts')];
  const counts=`${prefix}set constraints all immediate;select jsonb_build_object('kind','counts',
    'requests',(select count(*) from public.${requestTable} where merchant_id=${site} and request_id=any(array[${plan.ids.map(value=>quote(value)+'::uuid').join(',')}])),
    'entries',(select count(*) from public.${entryTable} where merchant_id=${site} and request_id=any(array[${plan.ids.map(value=>quote(value)+'::uuid').join(',')}])));`;
  const steps=['begin;'+prefix+initial+mark('protected_before'),...checkPair('empty_target'),prefix+template,
    ...checkPair('one_real_template'),...batches([...plan.unrelated,...plan.adjacent]),...checkPair('unrelated_101_and_half_open_edges'),
    ...batches(plan.related),...checkPair('exact_100'),...batches([plan.overflow]),reject('context'),reject('conflicts'),counts,
    mark('protected_after')+'rollback;'];
  assert(steps.length<=40,'capacity_bounded_steps');let rows;const failures=[];
  try{rows=parseLines(await native.querySteps(steps.map(step=>scope.sql(step))));}
  catch(error){failures.push(new Error('work_arrangement_capacity_failed:'+String(error?.message??error),{cause:error}));}
  finally{
    for(const [label,readBaseline,expectedValue] of [['capacity_rollback_all_facts',()=>d.fingerprint(),baseline],
      ['capacity_definitions',()=>d.definitions(),defs],['capacity_catalog',()=>d.tableCatalog(),catalog]]){
      try{assert.equal(readBaseline(),expectedValue,label);}catch(error){failures.push(error);}
    }
  }
  if(failures.length)throw new AggregateError(failures,'work_arrangement_capacity_failed: '+failures.map(error=>error.message).join(' | '));
  assert.equal(rows[0].kind,'protected_before');assert.equal(rows.at(-1).kind,'protected_after');
  assert.equal(rows[0].hash,rows.at(-1).hash,'capacity_old_rows_and_archives_changed');
  const templateResult=rows.find(row=>row.kind==='template')?.value;
  assert.deepEqual(templateResult?.receipt?.command,plan.command);assert.equal(templateResult.receipt.item.requestId,plan.command.operationId);
  assert.equal(templateResult.receipt.item.policyRevision,home.policy.revision);assert.equal(templateResult.receipt.item.status,'submitted');
  const expected={empty_target:[],one_real_template:[plan.command.operationId],unrelated_101_and_half_open_edges:[plan.command.operationId],
    exact_100:[plan.command.operationId,...plan.related.map(row=>row.id)]};
  const successful=rows.filter(row=>row.kind==='read');assert.equal(successful.length,8);
  for(const row of successful){
    const position=rows.indexOf(row),before=rows[position-1],after=rows[position+1];
    assert.equal(before.kind,'before_read');assert.equal(after.kind,'after_read');assert.equal(before.label,row.label);assert.equal(after.label,row.label);
    assert.equal(before.hash,after.hash,'capacity_read_mutation:'+row.label+':'+row.reader);
    assert(Array.isArray(row.value));const actual=row.value.map(item=>row.reader==='context'?item.requestId:item.id).sort();
    assert.deepEqual(actual,[...expected[row.label]].sort(),row.label+':'+row.reader+':exact_related_ids');
    for(const item of row.value){assert.equal(item.status,'submitted');assert.equal(item.startAt,plan.span.startAt);assert.equal(item.endAt,plan.span.endAt);
      if(row.reader==='context'){assert.equal(item.employeeId,h.employeeId);assert.equal(item.employeeAuthUserId,h.employeeAuthUserId);
        assert.equal(item.policyRevision,home.policy.revision);assert.equal(item.history.length,1);assert.equal(item.history[0].action,'submit');}
      else assert.equal(item.source,'work_arrangement');}
  }
  assert.deepEqual(rows.filter(row=>row.kind==='rejection').map(row=>[row.reader,row.code]),
    [['context','attendance_work_arrangement_too_large'],['conflicts','attendance_work_arrangement_too_large']]);
  assert.deepEqual(rows.find(row=>row.kind==='counts'),{kind:'counts',requests:204,entries:204});
  return {actualRpcSubmissions:1,syntheticRequestCopies:203,syntheticSubmitEntryCopies:203,syntheticCopyRows:406,
    unrelatedCopies:101,halfOpenAdjacentCopies:2,relatedCopies:100,maximumRelatedRequests:101,privateSuccessfulReads:8,
    publicHomeReads:1,exactTooLargeRejections:2,transactionSteps:steps.length,allReadsFactHashUnchanged:true,
    oldFactsAndArchivesUnchanged:true,rollbackRestored:true,definitionsAndCatalogUnchanged:true,
    policyRevision:home.policy.revision,templateTimeZone:home.timeZone,unrelatedDatesAreFutureLedgerHistory:true,
    privilegedPrivateHelperProbe:true,actualMassUserSubmissions:false,productionPerformanceProven:false,
    browserCoverage:false,productionAccess:false,newCluster:false};
}
