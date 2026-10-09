//176 inert caller-owned probes, never a database/process launcher. All setup is
//synthetic and rolled back. Pending/effect gate probes temporarily toggle ONLY
//the new149 head projection: this is adversarial trigger coverage, not proof
//that a legitimate149 seal can coexist with a pending correction.
import assert from 'node:assert/strict';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';

const stamp6=value=>new Date(value).toISOString().replace(/Z$/,'000Z');
const offset=(value,minutes)=>stamp6(Date.parse(value)+minutes*60000);
const perform=expression=>'do $actual_guard_rpc$ begin perform '+expression+';end;$actual_guard_rpc$;';
function hashSql(names){
  assert(names.length>0&&new Set(names).size===names.length);
  return '(select md5(jsonb_object_agg(name,rows order by name)::text) from ('+names.map(name=>{
    assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name));
    return 'select '+quote(name)+" name,(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]') from public."+name+' r) rows';
  }).join(' union all ')+') guard_probe_rows)';
}

//Call while pid is genuinely sealed by the main149 flow, before its normal
//reopen. q is the main driver's query factory; no service/result is mocked.
export async function verifyPeriodSealGuardsNative({d,native,scope,h,q,pid}){
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true&&h.syntheticHistoricalRows===10);
  assert.equal(typeof q,'function');assert.equal(typeof native?.querySteps,'function');
  const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));
  assert.deepEqual(owned,d.owned);assert.equal(owned.schema,scope.schema);
  assert.deepEqual(h.query,{siteId:d.site,workerId:d.otherWorker,slotId:h.slot.id});
  assert.equal(h.employeeId,d.otherEmployee);assert.equal(h.employeeAuthUserId,d.otherAuth);assert.equal(h.slot.timeZone,'UTC');
  const query=q('detail','owner',pid),site=quote(d.site),owner=quote(d.owner),auth=quote(h.employeeAuthUserId),worker=quote(h.workerId),period=quote(pid);
  assert.equal(query.workerId,h.workerId);assert.equal(query.fromDate,h.slot.workDate);assert.equal(query.throughDate,h.slot.workDate);
  const names=d.inventory(),allHash=hashSql(names),baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();
  const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
  const initial=prefix+`do $guard_initial$ begin
    assert exists(select 1 from public.merchant_attendance_period_closures where merchant_id=${site} and period_id=${period}
      and worker_id=${worker} and employee_id=${quote(h.employeeId)} and employee_auth_user_id=${auth} and sealed and state='sealed'
      and revision<99 and confirmed_version=current_version),'guard_actual_sealed_head_required';
    assert not exists(select 1 from public.merchant_attendance_correction_entries where merchant_id=${site} and start_event_id=${quote(h.startEventId)}),'guard_initial_correction_empty';
    assert not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and t.tgenabled<>'O'),'guard_enabled_triggers_required';
  end;$guard_initial$;`;
  let scenarios=0,rejections=0;
  const run=async(label,steps,writes)=>{
    assert.match(label,/^[a-z_]+$/);for(const name of writes)assert(names.includes(name),name);
    const protectedHash=hashSql(names.filter(name=>!writes.includes(name)));
    const observed=kind=>prefix+`select jsonb_build_object('kind',${quote(kind)},'label',${quote(label)},'hash',${protectedHash});`;
    const statements=['begin;'+initial+observed('before'),...steps.map(step=>prefix+step),observed('after')+'rollback;'];
    assert(statements.length<=24,label+':bounded_statement_count');
    let rows;
    try{const output=await native.querySteps(statements.map(step=>scope.sql(step)));
      rows=output.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));}
    catch(error){throw new Error('period_guard_probe_failed:'+label+':'+String(error?.message??error),{cause:error});}
    finally{
      assert.equal(d.fingerprint(),baseline,label+':outer_rollback_failed');
      assert.equal(d.definitions(),definitions,label+':old_function_changed');
      assert.equal(d.tableCatalog(),catalog,label+':constraint_or_trigger_changed');
    }
    assert.deepEqual(rows.map(x=>x.kind),['before','after'],label+':unexpected_result_rows');
    assert.equal(rows[0].hash,rows[1].hash,label+':protected_old_table_writes');scenarios++;
  };
  const reject=(setup,statement,error='attendance_period_sealed')=>{
    rejections++;
    return `do $expected_guard$ declare before_hash text;review jsonb;prepared jsonb;command jsonb;result jsonb;begin
      ${setup}
      before_hash:=${allHash};
      begin ${statement} raise exception 'expected_period_gate_rejection_missing';
      exception when others then if sqlerrm<>${quote(error)} then raise;end if;end;
      assert ${allHash}=before_hash,'period_gate_failure_left_partial_rows';
    end;$expected_guard$;`;
  };
  const unchanged=statement=>`do $guard_readonly$ declare before_hash text;begin before_hash:=${allHash};${statement}
    assert ${allHash}=before_hash,'period_original_receipt_recovery_wrote_rows';end;$guard_readonly$;`;
  const unsealSetup=`update public.merchant_attendance_period_closures set sealed=false,state='confirmed' where merchant_id=${site} and period_id=${period};`;
  const resealSetup=`update public.merchant_attendance_period_closures set sealed=true,state='sealed' where merchant_id=${site} and period_id=${period};`;
  const policy=id(176700),rootRequest=id(176701),rootApproval=id(176702),revisionRequest=id(176703),revisionApproval=id(176704);
  const policyRevision=`(select revision from public.merchant_attendance_correction_controls where merchant_id=${site} and operation_id=${quote(policy)})`;
  const settingsVersion=`(select version from public.merchant_attendance_settings where merchant_id=${site})`;
  const policySetup=perform(`public.faolla_attendance_correction_controls_v2(${site},${owner},jsonb_build_object('action','set_policy',
    'operationId',${quote(policy)},'expectedRevision',(select coalesce(max(revision),0) from public.merchant_attendance_correction_controls where merchant_id=${site}),
    'expectedSettingsVersion',${settingsVersion},'reason','Synthetic176 rollback guard window','submissionWindowDays',365),null,null,true)`);
  const firstProposal={startAt:offset(h.slot.startAt,10),endAt:offset(h.slot.endAt,-20),breaks:[]};
  const lastProposal={startAt:stamp6(h.slot.startAt),endAt:stamp6(h.slot.endAt),breaks:[]};
  const correctionQuery={mode:'detail',expectedWorkerId:h.workerId,requestId:rootRequest,operationId:null};
  const firstCommand=json({action:'submit',operationId:rootRequest,expectedRevision:0,expectedPolicyRevision:1,reason:'Synthetic176 correction gate probe',
    startEventId:h.startEventId,expectedLastEventId:h.lastEventId,proposal:firstProposal})+"||jsonb_build_object('expectedPolicyRevision',"+policyRevision+')';
  const submit=`public.faolla_attendance_correction_self_v3(${site},${auth},${json(correctionQuery)},${firstCommand},true)`;
  const prepareApproval=(version,op,action='approve')=>`review:=public.faolla_attendance_correction_decide_v${version}(${site},${owner},${quote(rootRequest)},null,null,true);
    assert review->>'canApprove'='true','guard_first_approval_otherwise_eligible';
    command:=jsonb_build_object('action',${quote(action)},'operationId',${quote(op)},'requestId',${quote(rootRequest)},'expectedRevision',1,
      'expectedEvidence',review->>'evidenceToken','reason','Synthetic176 first approval gate');`;
  const approveRoot=`do $guard_setup_approve$ declare review jsonb;command jsonb;begin ${prepareApproval(2,rootApproval)}
    perform public.faolla_attendance_correction_decide_v2(${site},${owner},${quote(rootRequest)},command,null,true);end;$guard_setup_approve$;`;
  const correctionTables=['merchant_attendance_period_closures','merchant_attendance_correction_controls','merchant_attendance_correction_entries',
    'merchant_attendance_correction_rule_bindings','merchant_attendance_correction_decisions','merchant_attendance_correction_effects',
    'merchant_attendance_revision_requests','merchant_attendance_revision_decisions','merchant_attendance_effect_versions'];

  await run('fresh_correction_submit',[policySetup,reject('',`perform ${submit};`)],['merchant_attendance_correction_controls']);
  await run('first_approval_and_recovery',[policySetup,unsealSetup,perform(submit),resealSetup,
    reject(prepareApproval(1,id(176705)),`perform public.faolla_attendance_correction_decide_v1(${site},${owner},${quote(rootRequest)},command,null,true);`),
    reject(prepareApproval(2,id(176706)),`perform public.faolla_attendance_correction_decide_v2(${site},${owner},${quote(rootRequest)},command,null,true);`),
    unchanged(`perform ${submit};`),
    // A rejected request is a terminal administrative action, not an effect.
    `do $guard_reject_allowed$ declare review jsonb;command jsonb;begin ${prepareApproval(2,id(176707),'reject')}
      perform public.faolla_attendance_correction_decide_v2(${site},${owner},${quote(rootRequest)},command,null,true);end;$guard_reject_allowed$;`,
  ],correctionTables);

  const revisionQuery=(mode,requestId=null)=>({mode,expectedWorkerId:h.workerId,baseRequestId:rootRequest,requestId,operationId:null});
  const revisionSetup=(legacy=false,operation=revisionRequest)=>`prepared:=public.faolla_attendance_revision_self_v2(${site},${auth},${json(revisionQuery('prepare'))},null,true);
    command:=jsonb_build_object('action','submit','operationId',${quote(operation)},'expectedRevision',(prepared->>'revision')::bigint,
      'expectedBaseOperationId',${quote(rootApproval)},'expectedPolicyRevision',${policyRevision},'reason','Synthetic176 revision gate','proposal',${json(lastProposal)})
      ${legacy?'':"||jsonb_build_object('expectedEffectiveOperationId',prepared->'current'->>'operationId')"};`;
  const revisionSubmit=`public.faolla_attendance_revision_self_v2(${site},${auth},${json(revisionQuery('detail',revisionRequest))},command,true)`;
  await run('revision_requests_and_effect',[policySetup,unsealSetup,perform(submit),approveRoot,resealSetup,
    reject(revisionSetup(true,id(176708)),`perform public.faolla_attendance_revision_self_v1(${site},${auth},${json(revisionQuery('detail',id(176708)))},command,true);`),
    reject(revisionSetup(),`perform ${revisionSubmit};`),unsealSetup,
    `do $guard_setup_revision$ declare prepared jsonb;command jsonb;begin ${revisionSetup()} perform ${revisionSubmit};end;$guard_setup_revision$;`,resealSetup,
    reject(`review:=public.faolla_attendance_revision_decide_v2(${site},${owner},${quote(revisionRequest)},null,null,true);
      assert review->>'canApprove'='true','guard_revision_otherwise_eligible';
      command:=jsonb_build_object('action','approve','operationId',${quote(revisionApproval)},'requestId',${quote(revisionRequest)},
        'expectedRevision',(review->'review'->>'submittedRevision')::bigint,'expectedEvidence',review->>'evidenceToken',
        'expectedBaseOperationId',review->'current'->>'operationId','reason','Synthetic176 revised effect gate');`,
    `perform public.faolla_attendance_revision_decide_v2(${site},${owner},${quote(revisionRequest)},command,null,true);`),
  ],correctionTables);

  const missingRoot=id(176710),missingApproved=id(176711),missingChild=id(176712);
  const missingQuery=(access,requestId=null)=>({siteId:d.site,access,fromDate:h.slot.workDate,throughDate:new Date(Date.parse(h.slot.workDate)+86400000).toISOString().slice(0,10),requestId,operationId:null,beforeAt:null,beforeId:null});
  const missingProposal={startAt:offset(h.slot.startAt,-120),endAt:offset(h.slot.startAt,-60),breaks:[]};
  const movedProposal={startAt:offset(h.slot.startAt,1320),endAt:offset(h.slot.startAt,1380),breaks:[]};
  assert.equal(missingProposal.startAt.slice(0,10),h.slot.workDate);
  assert.notEqual(movedProposal.startAt.slice(0,10),h.slot.workDate);
  const missingCommand=(revise=false)=>json({action:revise?'revise':'submit',operationId:revise?missingChild:missingRoot,
    reason:'Synthetic176 missing declaration gate',expectedWorkerId:h.workerId,expectedSettingsVersion:1,expectedPolicyRevision:1,
    locationId:h.slot.locationId,timeZone:'UTC',proposal:revise?movedProposal:missingProposal,
    ...(revise?{supersedesRequestId:missingRoot,expectedApprovalOperationId:missingApproved}:{})})+
    `||jsonb_build_object('expectedSettingsVersion',${settingsVersion},'expectedPolicyRevision',${policyRevision})`;
  const missingSubmit=revise=>`public.faolla_attendance_missing_v1(${json(missingQuery('self'))},${auth},${missingCommand(revise)},true)`;
  const missingApproveSetup=(requestId,operation)=>`review:=public.faolla_attendance_missing_v1(${json(missingQuery('owner',requestId))},${owner},null,true);
    assert review->'detail'->>'canApprove'='true','guard_missing_otherwise_eligible';
    command:=jsonb_build_object('action','approve','operationId',${quote(operation)},'requestId',${quote(requestId)},'expectedRevision',1,
      'evidenceToken',review->'detail'->>'evidenceToken','reason','Synthetic176 missing approval gate');`;
  const missingApprove=requestId=>`public.faolla_attendance_missing_v1(${json(missingQuery('owner',requestId))},${owner},command,true)`;
  await run('missing_and_superseded_interval',[policySetup,
    reject('',`perform ${missingSubmit(false)};`),unsealSetup,perform(missingSubmit(false)),resealSetup,
    reject(missingApproveSetup(missingRoot,missingApproved),`perform ${missingApprove(missingRoot)};`),
    unsealSetup,`do $guard_setup_missing_approval$ declare review jsonb;command jsonb;begin ${missingApproveSetup(missingRoot,missingApproved)}
      perform ${missingApprove(missingRoot)};end;$guard_setup_missing_approval$;`,resealSetup,
    // The replacement lies wholly outside the sealed day. Its old approved
    // parent inside the day still blocks removal through a moved declaration.
    reject('',`perform ${missingSubmit(true)};`),unsealSetup,perform(missingSubmit(true)),resealSetup,
    reject(missingApproveSetup(missingChild,id(176713)),`perform ${missingApprove(missingChild)};`),
  ],['merchant_attendance_period_closures','merchant_attendance_correction_controls','merchant_attendance_missing_requests','merchant_attendance_missing_entries']);

  // The capacity path uses ONLY actual149 commands, not a fabricated revision.
  // Each batch has <=10 appends under the unchanged statement timeout.
  const closeCall=(query,command,allow=true)=>`public.faolla_attendance_period_closure_v1(${json(query)},${owner},${command},null,${allow})`;
  const batches=[];
  for(let ceiling=10;ceiling<=100;ceiling+=10){const target=Math.min(ceiling,99);
    batches.push(`do $guard_capacity_batch$ declare head public.merchant_attendance_period_closures%rowtype;command jsonb;i integer;begin
      select * into head from public.merchant_attendance_period_closures where merchant_id=${site} and period_id=${period};
      if head.revision<${target} then for i in head.revision+1..${target} loop
        command:=jsonb_build_object('action','respond','operationId',('00000000-0000-4000-8000-'||lpad((176800+i)::text,12,'0'))::uuid,
          'periodId',${period},'expectedRevision',i-1,'expectedVersion',head.current_version,'expectedFingerprint',null,'reason','Synthetic176 bounded capacity probe');
        perform ${closeCall(query,'command')};
      end loop;end if;
    end;$guard_capacity_batch$;`);
  }
  const capSetup=`command:=jsonb_build_object('action','respond','operationId',${quote(id(176950))},'periodId',${period},'expectedRevision',99,
    'expectedVersion',(select current_version from public.merchant_attendance_period_closures where merchant_id=${site} and period_id=${period}),
    'expectedFingerprint',null,'reason','Synthetic176 reserved reopen slot');`;
  const capReject=reject(capSetup,`perform ${closeCall(query,'command')};`,'attendance_period_limit');
  const capReopen=`do $guard_capacity_reopen$ declare head public.merchant_attendance_period_closures%rowtype;command jsonb;result jsonb;before_hash text;begin
    select * into head from public.merchant_attendance_period_closures where merchant_id=${site} and period_id=${period};
    assert head.revision=99 and head.sealed,'guard_capacity_must_reserve_reopen';
    command:=jsonb_build_object('action','reopen','operationId',${quote(id(176951))},'periodId',${period},'expectedRevision',99,
      'expectedVersion',head.current_version,'expectedFingerprint',null,'reason','Synthetic176 capacity reopen remains available');
    result:=${closeCall(query,'command',false)};
    assert result->'period'->>'revision'='100' and result->'period'->>'state'='open' and result->'period'->'sealed'='false'::jsonb,
      'guard_capacity_reopen_must_release_seal';
    assert jsonb_array_length(result->'history')=100,'guard_capacity_history_must_stay_bounded';
    before_hash:=${allHash};
    result:=${closeCall(q('recover','owner',pid,id(176951)),'null',false)};
    assert result->'operation'->>'operationId'=${quote(id(176951))} and result->'replayed'='true'::jsonb,'guard_capacity_original_receipt_unreadable';
    result:=${closeCall(q('export','owner',pid,null,1),'null',false)};
    assert result->>'artifactVersion'='1' and result->'artifact' is not null,'guard_capacity_archive_unreadable';
    assert ${allHash}=before_hash,'guard_capacity_recovery_or_export_wrote_rows';
  end;$guard_capacity_reopen$;`;
  const clocks=`do $guard_capacity_clocks$ declare status jsonb;first_reply jsonb;last_reply jsonb;n bigint;begin
    select count(*) into n from public.merchant_attendance_events where merchant_id=${site} and worker_id=${worker};
    status:=public.faolla_attendance_self_v1(${site},${auth},null,null);
    assert status->'state'->>'status'='off','guard_clock_fixture_must_be_off';
    first_reply:=public.faolla_attendance_self_v1(${site},${auth},jsonb_build_object('action','clock_in','operationId',${quote(id(176952))},
      'expectedWorkerId',${worker},'locationId',status->'locationId','expectedSequence',(status->'state'->>'sequence')::bigint),null);
    last_reply:=public.faolla_attendance_self_v1(${site},${auth},jsonb_build_object('action','clock_out','operationId',${quote(id(176953))},
      'expectedWorkerId',${worker},'locationId',first_reply->'locationId','expectedSequence',(first_reply->'state'->>'sequence')::bigint),null);
    assert first_reply->'receipt'->>'action'='clock_in' and last_reply->'receipt'->>'action'='clock_out','guard_capacity_must_not_block_actual_clock';
    assert (select count(*) from public.merchant_attendance_events where merchant_id=${site} and worker_id=${worker})=n+2,'guard_capacity_exact_two_clock_events';
  end;$guard_capacity_clocks$;`;
  await run('reserved_reopen_capacity',[...batches,capReject,capReopen,clocks],['merchant_attendance_period_closures','merchant_attendance_period_entries','merchant_attendance_events']);
  return {scenarios,expectedSealedRejections:rejections-1,expectedCapacityRejections:1,
    failedStatementFingerprintsChecked:true,allOuterRollbacksRestored:true,protectedOldTablesUnchanged:true,definitionsAndCatalogUnchanged:true,
    historicalFixtureRows:h.syntheticHistoricalRows,adversarialNewProjectionSetup:true,actualLegacyCorrectionAndRevisionRpcs:true,
    actualMissingRpcs:true,actualCapacityReopen:true,actualNormalClockEventsWithinRollback:2,
    syntheticOnly:true,callerOwnsRuntimeAndCleanup:true,
    fixtureDisclosure:'Actual old RPCs over synthetic historical facts. Only the new149 seal projection is temporarily toggled inside rollback-only adversarial setup; this is not a legitimate seal-with-pending workflow claim. Each rejected statement is immediately checked for zero writes before the outer rollback. Capacity uses actual149 replies through revision99, reserved paused reopen100 and real111 clock-in/out, all rolled back.'};
}
