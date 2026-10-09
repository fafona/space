//218 caller-owned capacity probe, never a runtime/bootstrap entrypoint.
//Every incident/declaration is written by real176 under enabled constraints.
//Only the explicitly labelled identity savepoint changes a synthetic employee
//Auth binding directly; it does not claim a real account-rebinding workflow.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql,outageNativeTables} from './attendance-outage-native.mjs';
const require=createRequire(import.meta.url),fresh=n=>id(218300000+n);
const stamp=ms=>new Date(ms).toISOString().replace(/Z$/,'000Z');

export function createOutageCapacityNativePlan(input){
 const {site,location,fromAt,toAt,now,subject,other}=input;
 assert.match(site,/^\d{8}$/);
 for(const value of [fromAt,toAt])assert.match(value,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}000Z$/,'capacity_fixed_frame_millisecond_exact');
 const start=Date.parse(fromAt),end=Date.parse(toAt),clock=Date.parse(now);
 assert(start<end&&end+7200000<clock&&end-start+14400000<=31*86400000,'capacity_past_bounded_frame');
 for(const person of [subject,other]){
  for(const key of ['workerId','employeeId','employeeAuthUserId'])assert.match(person[key],/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  for(const key of ['workerVersion','employeeVersion'])assert(Number.isSafeInteger(person[key])&&person[key]>0);
  assert(Number.isSafeInteger(person.generation)&&person.generation>=0);
 }
 assert.notEqual(subject.workerId,other.workerId);assert.notEqual(subject.employeeId,other.employeeId);assert.notEqual(subject.employeeAuthUserId,other.employeeAuthUserId);
 const interval=(a,b)=>({startAt:stamp(a),endAt:stamp(b),timeZone:'UTC',startOffsetMinutes:0,endOffsetMinutes:0});
 const incident={action:'create_incident',operationId:fresh(1),incidentId:fresh(2),type:'network',channel:'web',locationId:location,
  interval:interval(start-7200000,end+7200000),reason:'Synthetic218 bounded capacity incident, not reconstructed work'};
 const declaration=(n,person,span,statement)=>({action:'declare',operationId:fresh(2000+n),declarationId:fresh(1000+n),incidentId:incident.incidentId,
  workerId:person.workerId,employeeId:person.employeeId,employeeAuthUserId:person.employeeAuthUserId,
  expectedWorkerVersion:person.workerVersion,expectedEmployeeVersion:person.employeeVersion,expectedGeneration:person.generation,
  interval:span,statement,originalOperationId:null,originalChannel:null,paperReference:null});
 const relevant=Array.from({length:101},(_,i)=>declaration(i+1,subject,interval(start,end),'Synthetic218 relevant declaration '+(i+1)));
 const irrelevant=[
  declaration(201,other,interval(start,end),'Synthetic218 other worker is outside target scope'),
  declaration(202,subject,interval(start-7200000,start-3600000),'Synthetic218 wholly earlier interval is outside target scope'),
  declaration(203,subject,interval(start-3600000,start),'Synthetic218 left boundary touches but does not overlap'),
  declaration(204,subject,interval(end,end+3600000),'Synthetic218 right boundary touches but does not overlap'),
 ];
 const wrongAuth=fresh(9000),mismatched=declaration(205,{...subject,employeeAuthUserId:wrongAuth},interval(start,end),'Synthetic218 declaration records the temporary actual synthetic Auth');
 return {incident,relevant,irrelevant,mismatched,wrongAuth};
}

export async function verifyAttendanceOutageCapacityNative(ctx){
 const {d,h,native,scope,period,pq,periodId,archive,oldArchive,periodArchive}=ctx;
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);assert.equal(typeof native.querySteps,'function');
 const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);
 assert((await period(pq('detail','owner',periodId))).period.sealed,'capacity_existing_seal_required');
 const baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog(),names=d.inventory(),sealed=periodArchive();
 const fullHash=outageNativeFingerprintSql(names),protectedHash=outageNativeFingerprintSql(names.filter(name=>!outageNativeTables.includes(name)));
 const {projectPeriodClosureSource}=require('../../src/lib/merchantAttendancePeriodClosure.server.ts');
 const {projectOutageResult}=require('../../src/lib/merchantAttendanceOutage.server.ts');
 const q=access=>pq('preview',access,periodId);
 const sourceQ=access=>Object.fromEntries(['siteId','access','workerId','fromDate','throughDate','periodId'].map(k=>[k,q(access)[k]]));
 const initialSource=JSON.parse(d.exec(`set local role service_role;select public.faolla_attendance_period_closure_source_v1(${json(sourceQ('owner'))},${quote(d.owner)})::text;`));
 const initial=projectPeriodClosureSource(initialSource,q('owner'));
 assert.equal(initial.artifact.source.context.outages,undefined,'capacity_empty_outage_context_required');
 const profiles=JSON.parse(d.exec(`select jsonb_build_object('now',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'items',(select jsonb_agg(jsonb_build_object('workerId',w.id,'employeeId',e.id,'employeeAuthUserId',e.auth_user_id,'workerVersion',w.version,
    'employeeVersion',e.version,'generation',coalesce(ep.generation,0)) order by w.id)
   from public.merchant_attendance_workers w join public.merchant_enterprise_employees e on e.merchant_id=w.merchant_id and e.id=w.employee_id
   left join public.merchant_attendance_account_epochs ep on ep.merchant_id=e.merchant_id and ep.employee_id=e.id
   where w.merchant_id=${quote(d.site)} and w.id in (${quote(h.workerId)},${quote(d.worker)})));`));
 assert.equal(profiles.items.length,2);const subject=profiles.items.find(p=>p.workerId===h.workerId),other=profiles.items.find(p=>p.workerId===d.worker);
 assert.equal(subject.employeeId,h.employeeId);assert.equal(subject.employeeAuthUserId,h.employeeAuthUserId);
 assert.equal(other.employeeId,d.employee);assert.equal(other.employeeAuthUserId,d.auth);
 const p=createOutageCapacityNativePlan({site:d.site,location:h.slot.locationId,fromAt:initial.artifact.period.startAt,toAt:initial.artifact.period.endAt,now:profiles.now,subject,other});
 assert.equal(d.fingerprint(),baseline,'capacity_preparation_zero_writes');
 const site=quote(d.site),owner=quote(d.owner),employee=quote(h.employeeId),auth=quote(h.employeeAuthUserId),worker=quote(h.workerId);
 const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
 const steps=[],metadata=new Map();let submissions=0,reads=0,rejections=0;
 const checkSeal=`assert exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${site} and period_id=${quote(periodId)} and sealed),'capacity_seal_preserved';`;
 const related=`merchant_id=${site} and worker_id=${worker} and declared_interval->>'startAt'<${quote(initial.artifact.period.endAt)} and declared_interval->>'endAt'>${quote(initial.artifact.period.startAt)}`;
 const append=(label,commands,{dynamicIdentity=false}={})=>{
  assert(/^[a-z_]+$/.test(label)&&!metadata.has(label));assert(commands.length>0&&commands.length<=10);
  metadata.set(label,{kind:'writes',count:commands.length});submissions+=commands.length;
  steps.push(prefix+`do $outage_capacity_write$ declare capacity_before text;capacity_command jsonb;capacity_query jsonb;capacity_value jsonb;capacity_rows jsonb:='[]';begin
   capacity_before:=${protectedHash};
   for capacity_command in select value from jsonb_array_elements(${json(commands)}) loop
    ${dynamicIdentity?`select capacity_command||jsonb_build_object('employeeAuthUserId',e.auth_user_id,'expectedEmployeeVersion',e.version,
      'expectedWorkerVersion',w.version,'expectedGeneration',coalesce(ep.generation,0)) into strict capacity_command
     from public.merchant_attendance_workers w join public.merchant_enterprise_employees e on e.merchant_id=w.merchant_id and e.id=w.employee_id
     left join public.merchant_attendance_account_epochs ep on ep.merchant_id=e.merchant_id and ep.employee_id=e.id where w.merchant_id=${site} and w.id=${worker};`:''}
    capacity_query:=jsonb_build_object('siteId',${site},'access','owner','mode',case when capacity_command->>'action'='create_incident' then 'incident' else 'declaration' end)
     ||case when capacity_command->>'action'='create_incident' then jsonb_build_object('incidentId',capacity_command->'incidentId') else jsonb_build_object('declarationId',capacity_command->'declarationId') end;
    set local role service_role;capacity_value:=public.faolla_attendance_outage_v1(capacity_query,${owner},capacity_command,true);
    set constraints all immediate;set constraints all deferred;reset role;
    capacity_rows:=capacity_rows||jsonb_build_array(jsonb_build_object('query',capacity_query,'command',capacity_command,'value',capacity_value));
   end loop;
   assert capacity_before=${protectedHash},'capacity_write_changed_old_facts';
   perform set_config(${quote('faolla.outage218_'+label)},jsonb_build_object('label',${quote(label)},'kind','writes','rows',capacity_rows,'before',capacity_before,'after',${protectedHash})::text,true);
   end;$outage_capacity_write$;select current_setting(${quote('faolla.outage218_'+label)})::jsonb;`);
 };
 const read=(label,{access='owner',count=null,error=null}={})=>{
  assert(/^[a-z_]+$/.test(label)&&!metadata.has(label));metadata.set(label,{kind:'source',access,count,error});if(error)rejections++;else reads++;
  steps.push(prefix+`do $outage_capacity_read$ declare capacity_before text;capacity_value jsonb;capacity_error text;begin
   capacity_before:=${fullHash};set local role service_role;
   ${error?`begin perform public.faolla_attendance_period_closure_source_v1(${json(sourceQ(access))},${quote(access==='owner'?d.owner:h.employeeAuthUserId)});
    raise exception 'capacity_expected_rejection_missing';exception when others then capacity_error:=sqlerrm;if capacity_error<>${quote(error)} then raise;end if;end;`
    :`capacity_value:=public.faolla_attendance_period_closure_source_v1(${json(sourceQ(access))},${quote(access==='owner'?d.owner:h.employeeAuthUserId)});`}
   reset role;assert capacity_before=${fullHash},'capacity_read_or_rejection_wrote_facts';
   perform set_config(${quote('faolla.outage218_'+label)},jsonb_build_object('label',${quote(label)},'kind','source','value',capacity_value,'error',capacity_error,'before',capacity_before,'after',${fullHash})::text,true);
   end;$outage_capacity_read$;select current_setting(${quote('faolla.outage218_'+label)})::jsonb;`);
 };
 const count=n=>steps.push(prefix+`do $outage_capacity_count$ begin assert (select count(*) from public.merchant_attendance_outage_declarations where ${related})=${n},'capacity_exact_related_count';
  assert (select count(*) from public.merchant_attendance_outage_declarations where merchant_id=${site})=${n+4},'capacity_irrelevant_rows_exist';${checkSeal}end;$outage_capacity_count$;`);
 steps.push('begin;'+prefix+`do $outage_capacity_start$ begin ${checkSeal}
  assert not exists(select 1 from public.merchant_attendance_outage_operations where merchant_id=${site}),'capacity_empty_176_required';
  assert not exists(select 1 from public.merchant_enterprise_employees where auth_user_id=${quote(p.wrongAuth)}),'capacity_unused_synthetic_auth_required';
  assert not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and t.tgenabled<>'O'),'capacity_all_guards_enabled';
  end;$outage_capacity_start$;`);
 append('incident',[p.incident]);append('irrelevant',p.irrelevant);count(0);read('unrelated_zero',{count:0});
 for(let start=0;start<99;start+=10)append('batch_'+String.fromCharCode(97+start/10),p.relevant.slice(start,Math.min(start+10,99)));
 count(99);read('ninety_nine',{count:99});
 //No immutable rows are forged or changed: a real176 command saves the
 //temporary currently-bound Auth. Restore the current Auth before reading so
 //the old work collector succeeds and179 itself must reject the saved mismatch.
 steps.push(prefix+`do $capacity_identity_baseline$ begin perform set_config('faolla.outage218_identity_before',${fullHash},true);end;$capacity_identity_baseline$;
  savepoint outage_capacity_identity;
  update public.merchant_enterprise_employees set auth_user_id=${quote(p.wrongAuth)} where merchant_id=${site} and id=${employee} and auth_user_id=${auth};
  do $capacity_identity_changed$ begin assert exists(select 1 from public.merchant_enterprise_employees where merchant_id=${site} and id=${employee} and auth_user_id=${quote(p.wrongAuth)}),'capacity_identity_change_applied';end;$capacity_identity_changed$;`);
 append('saved_mismatch',[p.mismatched],{dynamicIdentity:true});
 steps.push(prefix+`update public.merchant_enterprise_employees set auth_user_id=${auth} where merchant_id=${site} and id=${employee} and auth_user_id=${quote(p.wrongAuth)};
  do $capacity_identity_current$ begin assert exists(select 1 from public.merchant_enterprise_employees where merchant_id=${site} and id=${employee} and auth_user_id=${auth}),'capacity_original_current_auth_restored';
   assert (select employee_auth_user_id from public.merchant_attendance_outage_declarations where merchant_id=${site} and declaration_id=${quote(p.mismatched.declarationId)})=${quote(p.wrongAuth)}::uuid,'capacity_saved_identity_differs';end;$capacity_identity_current$;`);
 count(100);read('identity_not_filtered',{error:'attendance_period_source_identity_changed'});
 steps.push(prefix+`rollback to savepoint outage_capacity_identity;release savepoint outage_capacity_identity;do $capacity_identity_rollback$ begin
  assert ${fullHash}=current_setting('faolla.outage218_identity_before'),'capacity_identity_full_rollback';end;$capacity_identity_rollback$;`);
 append('hundredth',[p.relevant[99]]);count(100);read('hundred_owner',{count:100});read('hundred_self',{access:'self',count:100});
 append('hundred_first',[p.relevant[100]]);count(101);read('hundred_first_owner',{error:'attendance_period_source_too_large'});read('hundred_first_self',{access:'self',error:'attendance_period_source_too_large'});
 steps.push(prefix+`set constraints all immediate;do $capacity_finish$ begin ${checkSeal}end;$capacity_finish$;
  select jsonb_build_object('kind','counts','incidents',(select count(*) from public.merchant_attendance_outage_incidents where merchant_id=${site}),
   'declarations',(select count(*) from public.merchant_attendance_outage_declarations where merchant_id=${site}),
   'operations',(select count(*) from public.merchant_attendance_outage_operations where merchant_id=${site}));rollback;`);
 assert(steps.length<=40,'capacity_bounded_steps');assert.equal(submissions,107);let rows;const failures=[];
 try{rows=(await native.querySteps(steps.map(sql=>scope.sql(sql)))).trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));}
 catch(error){failures.push(new Error('outage_capacity_actual_sql_failed:'+String(error?.message??error),{cause:error}));}
 finally{
  for(const [label,get,want]of [['facts',()=>d.fingerprint(),baseline],['definitions',()=>d.definitions(),definitions],['catalog',()=>d.tableCatalog(),catalog],
   ['old155_text',()=>archive().artifactText,oldArchive.artifactText],['old155_sha',()=>archive().artifactSha256,oldArchive.artifactSha256],
   ['sealed_text',()=>periodArchive().artifactText,sealed.artifactText],['sealed_sha',()=>periodArchive().artifactSha256,sealed.artifactSha256]]){
   try{assert.equal(get(),want,'capacity_rollback_'+label);}catch(error){failures.push(error);}
  }
 }
 if(failures.length)throw new AggregateError(failures,'outage_capacity_native_failed:'+failures.map(e=>e.message).join(' | '));
 const parsed=new Map();let seen=0,projectedWrites=0;
 for(const row of rows){if(!row.label)continue;seen++;const expected=metadata.get(row.label);assert(expected);assert.equal(row.kind,expected.kind);assert.equal(row.before,row.after);
  if(row.kind==='writes'){
   assert.equal(row.rows.length,expected.count);
   for(const item of row.rows){const value=projectOutageResult(item.value,item.query,d.owner,item.command);assert(value.receipt);assert.equal(value.receipt.operationId,item.command.operationId);projectedWrites++;}
  }else{
   assert.equal(row.error,expected.error);if(row.error)continue;
   const value=projectPeriodClosureSource(row.value,q(expected.access));parsed.set(row.label,value);
   const entries=value.artifact.source.context.outages;
   if(expected.count===0){assert.equal(entries,undefined);assert.deepEqual(value.artifact.source,initial.artifact.source);}
   else{
    assert.equal(value.artifact.source.sourceVersion,'attendance-period-source-v4');assert.equal(entries.length,expected.count);
    assert.deepEqual(entries.map(e=>e.declarationId),p.relevant.slice(0,expected.count).map(c=>c.declarationId));
    for(const entry of entries){assert.equal(entry.workerId,h.workerId);assert.equal(entry.employeeId,h.employeeId);assert.equal(entry.employeeAuthUserId,h.employeeAuthUserId);
     assert.equal(entry.revision,0);assert.equal(entry.resultVersion,0);assert.equal(entry.status.resolved,false);assert(entry.status.blockers.includes('result_missing'));}
    assert(value.blockers.includes('unresolved_outage'));
    const canonical={...value.artifact.source};delete canonical.sourceVersion;delete canonical.context;
    const original={...initial.artifact.source};delete original.sourceVersion;delete original.context;assert.deepEqual(canonical,original,'capacity_no_work_or_frame_changes');
    const context={...value.artifact.source.context};delete context.outages;assert.deepEqual(context,initial.artifact.source.context,'capacity_other_context_preserved');
   }
  }
 }
 assert.equal(seen,metadata.size);assert.equal(projectedWrites,submissions);
 assert.deepEqual(parsed.get('hundred_owner').artifact.source,parsed.get('hundred_self').artifact.source,'capacity_owner_self_same_canonical');
 assert.deepEqual(rows.find(r=>r.kind==='counts'),{kind:'counts',incidents:1,declarations:105,operations:106});
 native.pass('218179 actual176 100 complete / 101 too_large, worker and half-open scope exclusions, saved identity fail-closed, rollback preserves sealed archives');
 return {syntheticOnly:true,submissions,projectedWrites,reads,rejections,transactionSteps:steps.length,relevantCapacity:100,tooLargeAt:101,
  irrelevantDeclarations:4,halfOpenBoundaryCases:2,identityMismatchRejected:true,syntheticDirectAuthRebinding:true,actualAccountRebindingApi:false,
  declarationApi:true,completeRealSourceProjection:true,readsAndRejectionsZeroWrites:true,rollbackRestored:true,oldFactsAndArchivesUnchanged:true,
  definitionsAndCatalogUnchanged:true,browser:false,productionAccess:false,newCluster:false};
}
