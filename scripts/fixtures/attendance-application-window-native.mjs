//243 INERT. Real application RPCs in one rollback-only synthetic transaction.
//The disclosed191 past-time seed is never represented as a historical RPC.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './attendance-outage-native.mjs';
import {periodContinuationSerialization,periodContinuationArchiveBytes} from './attendance-period-continuation-native.mjs';
import {operationalPunchPastSeed,operationalPunchFixtureIds} from './attendance-operational-punch-native.mjs';
const require=createRequire(import.meta.url),uid=n=>id(243600000+n),instant=d=>d.toISOString().replace('Z','000Z');
export function applicationWindowRpcExpression(name,a){
 assert(['faolla_attendance_application_window_v1','faolla_attendance_operational_consumer_activation_v1','faolla_attendance_operational_rules_v1'].includes(name));
 const flag=name==='faolla_attendance_operational_consumer_activation_v1'?'p_allow_activate':'p_allow_write';
 assert.deepEqual(Object.keys(a).sort(),['p_query','p_auth_user_id','p_command',flag].sort());assert.equal(typeof a[flag],'boolean');
 return `public.${name}(${json(a.p_query)},${quote(a.p_auth_user_id)},${json(a.p_command)},${a[flag]})`;
}
export async function verifyApplicationWindowNative(ctx){
 const {d,h,native,scope,archive,periodArchive}=ctx;assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);assert.equal(d.owned.schema,scope.schema);
 const {executeApplicationWindow}=require('../../src/lib/merchantAttendanceApplicationWindow.server.ts');
 const {executeOperationalConsumerActivation}=require('../../src/lib/merchantAttendanceOperationalConsumerActivation.server.ts');
 const {executeOperationalRuleLedger}=require('../../src/lib/merchantAttendanceOperationalRuleLedger.server.ts');
 const {parseCurrentCorrectionDecision}=require('../../src/lib/merchantAttendanceCurrentCorrectionDecision.ts');
 const {parseMissingResult}=require('../../src/lib/merchantAttendanceMissing.ts');
 const names=d.inventory(),baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();
 const originalArchive=periodContinuationArchiveBytes(await archive()),originalPeriod=periodContinuationArchiveBytes(await periodArchive());
 const site=quote(d.site),owner=quote(d.owner),auth=quote(h.employeeAuthUserId),start=id(204710),end=id(204711);
 const append=['correction_entries','correction_rule_bindings','correction_decisions','correction_effects','revision_requests',
  'missing_requests','missing_entries','operational_rule_operations','operational_rule_streams','operational_rule_publications',
  'operational_consumer_activations','application_window_proofs'].map(n=>'merchant_attendance_'+n);
 const all=outageNativeFingerprintSql(names),outside=outageNativeFingerprintSql(names.filter(n=>!append.includes(n)));
 for(const n of names)assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(n));
 const originals=`(select jsonb_object_agg(n,rows) from (${names.map(n=>`select ${quote(n)} n,(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from public.${n} x) rows`).join(' union all ')}) originals)`;
 const preserve=names.map(n=>`assert not exists(select prior.value from jsonb_array_elements(current_setting('faolla.aw243_originals')::jsonb->${quote(n)}) prior(value) except select to_jsonb(x) from public.${n} x),'aw243_old_row_changed:${n}';`).join('\n');
 const prefix=periodContinuationSerialization+d.guard,connection=native.connect({lifetimeMs:90000});
 let steps=0,reads=0,writes=0,rejections=0,serial=100,stage='begin',lastRpc=null,rolledBack=false,replayOnly=false;const groups=[];
 const next=()=>uid(++serial);
 const step=async(label,sql)=>{stage=label;assert(++steps<=150,'application_window_max150_steps');return connection.step(scope.sql((label==='begin'?'begin;':'')+prefix+sql));};
 const call=async(label,expression,{write=false,role='service_role',replay=false}={})=>{
  const r=JSON.parse(await step(label,`do $aw243_call$ declare before_hash text;outside_hash text;value jsonb;failure text;state_code text;context_text text;begin
   before_hash:=${all};outside_hash:=${outside};begin set local role ${role};assert current_user=${quote(role)};
    value:=${expression};set constraints all immediate;set constraints all deferred;
    exception when others then get stacked diagnostics failure=message_text,state_code=returned_sqlstate,context_text=pg_exception_context;end;reset role;
   if failure is not null or value ? 'error' or ${!write||replay} then assert ${all}=before_hash,'aw243_read_reject_or_replay_changed_facts';end if;
   assert ${outside}=outside_hash,'aw243_unrelated_table_changed';${preserve}
   perform set_config('faolla.aw243_result',jsonb_build_object('value',value,'error',failure,'sqlstate',state_code,'context',context_text)::text,true);
  end;$aw243_call$;select current_setting('faolla.aw243_result')::jsonb;`));
  lastRpc=r;if(r.error||r.value?.error)rejections++;else if(write)writes++;else reads++;return r;
 };
 const service={rpc:async(name,args)=>{const r=await call('rpc_'+name+'_'+(args.p_command?.command?.action??args.p_command?.action??args.p_query.mode),applicationWindowRpcExpression(name,args),{write:!!args.p_command,replay:replayOnly});return {data:r.value,error:r.error?{message:r.error}:null};}};
 const save=async name=>{assert(/^[a-z0-9_]+$/.test(name));return step('save_'+name,`savepoint ${name};select ${all};`);};
 const restore=async(name,hash)=>assert.equal(await step('restore_'+name,`rollback to savepoint ${name};release savepoint ${name};select ${all};`),hash);
 const ok=async(label,sql,options)=>{const r=await call(label,sql,options);assert.equal(r.error,null,JSON.stringify(r));return r.value;};
 const deny=async(label,fn,code)=>{const previous=steps;await assert.rejects(fn);assert(steps>previous,label+':must_reach_SQL');assert.equal(lastRpc.error??lastRpc.value?.error,code,label+':'+JSON.stringify(lastRpc));};
 const activation=(command=null,allowActivate=true,authUserId=d.owner,query={siteId:d.site,consumer:'application_window',mode:'current'})=>executeOperationalConsumerActivation({query,command,authUserId,allowActivate},service);
 const toggle=(action,expectedRevision)=>({siteId:d.site,consumer:'application_window',action,expectedRevision,operationId:next(),reason:'Synthetic243 explicit '+action});
 const run=(query,command=null,allowWrite=true,authUserId=h.employeeAuthUserId)=>executeApplicationWindow({query,command,allowWrite,authUserId},service);
 const correctionQuery={siteId:d.site,mode:'prepare',family:'correction',workerId:h.workerId,startEventId:start};
 const prepareCommand=(prepared,proposal,reason='Synthetic243 actual self submit')=>({command:{action:'submit',operationId:next(),expectedRevision:prepared.application.revision,
  expectedPolicyRevision:prepared.application.rules.policy.revision,startEventId:start,expectedLastEventId:end,proposal,reason},expectedWindowFingerprint:prepared.window.windowFingerprint});
 const correctionLegacy=(command,version=3)=>`public.faolla_attendance_correction_self_v${version}(${site},${auth},${json({mode:'detail',expectedWorkerId:h.workerId,requestId:command.operationId,operationId:null})},${json(command)},true)`;
 const revisionLegacy=(baseRequestId,command,version=2)=>`public.faolla_attendance_revision_self_v${version}(${site},${auth},${json({mode:'detail',expectedWorkerId:h.workerId,baseRequestId,requestId:command.operationId,operationId:null})},${json(command)},true)`;
 try{
  const profile=JSON.parse(await step('begin',`set local lock_timeout='3s';set local statement_timeout='10s';
   do $aw243_pre$ begin assert current_user='postgres';assert not exists(select 1 from public.merchant_attendance_operational_consumer_activations);
    assert not exists(select 1 from public.merchant_attendance_application_window_proofs);assert not exists(select 1 from public.merchant_attendance_operational_rule_streams);
    perform set_config('faolla.aw243_originals',${originals}::text,true);end;$aw243_pre$;
   select jsonb_build_object('today',(clock_timestamp() at time zone 'UTC')::date::text,
    'localToday',(select (clock_timestamp() at time zone time_zone)::date::text from public.merchant_attendance_settings where merchant_id=${site}));`));
  assert.equal((await activation()).current,null);const off=await run(correctionQuery);assert.equal(off.canSubmit,false);
  await deny('nonowner_activation',()=>activation(toggle('activate',0),true,h.employeeAuthUserId),'attendance_access_denied');
  await deny('flagoff_activation',()=>activation(toggle('activate',0),false),'attendance_operational_consumer_disabled');
  const activatedCommand=toggle('activate',0),activated=await activation(activatedCommand);assert.equal(activated.current.revision,1);
  replayOnly=true;try{assert.deepEqual((await activation(activatedCommand,false)).receipt,activated.receipt);}finally{replayOnly=false;}
  for(const consumer of ['review_routing','timesheet_cycle','reminders'])assert.equal((await activation(null,false,d.owner,{siteId:d.site,consumer,mode:'current'})).current,null);
  const prepared=await run(correctionQuery);assert(prepared.canSubmit&&prepared.application.canRequest);assert.equal(prepared.window.selectedDays,null);
  assert.equal(prepared.window.effectiveDeadlineAt,prepared.window.baselineDeadlineAt);
  const events=prepared.application.basis.events,proposal={startAt:events[0].occurredAt,endAt:instant(new Date(Date.parse(events.at(-1).occurredAt)+60000)),breaks:[]};
  const submit=prepareCommand(prepared,proposal);
  for(const version of [2,3]){const denied=await call('legacy_correction_'+version,correctionLegacy(submit.command,version),{write:true,role:version===2?'postgres':'service_role'});assert.equal(denied.error,'attendance_application_window_protocol_required',JSON.stringify(denied));}
  await step('proof_failure_injection',`alter table public.merchant_attendance_application_window_proofs add constraint synthetic243_fault check(operation_id<>${quote(submit.command.operationId)}) not valid;select 1;`);
  const beforeFault=steps;await assert.rejects(()=>run(correctionQuery,submit),error=>error.code==='attendance_application_window_invalid');
  assert(steps>beforeFault);assert.equal(lastRpc.sqlstate,'23514');assert.match(lastRpc.error,/synthetic243_fault/);
  await step('remove_proof_failure','alter table public.merchant_attendance_application_window_proofs drop constraint synthetic243_fault;select 1;');
  const recovery={siteId:d.site,mode:'recover',family:'correction',operationId:submit.command.operationId};assert.equal((await run(recovery,null,false)).receipt,null);
  const submitted=await run(correctionQuery,submit);assert.equal(submitted.receipt.requestId,submit.command.operationId);
  const detail=await run({siteId:d.site,mode:'detail',family:'correction',workerId:h.workerId,requestId:submit.command.operationId});
  assert.equal(detail.window.windowFingerprint,prepared.window.windowFingerprint);assert.equal(detail.application.item.status,'submitted');
  replayOnly=true;try{assert.deepEqual((await run(correctionQuery,submit,false)).receipt,submitted.receipt);}finally{replayOnly=false;}
  await deny('full_body_conflict',()=>run(correctionQuery,{...submit,command:{...submit.command,reason:'Different original body'}},false),'attendance_operation_conflict');
  assert.equal((await run(recovery,null,false,d.auth)).receipt,null);groups.push('activation_exact_scope_and_actual_correction_atomicity');

  const ownQuery={siteId:d.site,requestId:submit.command.operationId,operationId:null};
  const ownerDetail=parseCurrentCorrectionDecision(await ok('owner_review',`public.faolla_attendance_correction_decide_v2(${site},${owner},${quote(ownQuery.requestId)},null,null,true)`),ownQuery);assert(ownerDetail.canApprove);
  const approve={action:'approve',operationId:next(),requestId:ownQuery.requestId,expectedRevision:ownerDetail.review.application.item.revision,expectedEvidence:ownerDetail.evidenceToken,reason:'Synthetic243 unchanged owner approval'};
  parseCurrentCorrectionDecision(await ok('owner_approve',`public.faolla_attendance_correction_decide_v2(${site},${owner},${quote(ownQuery.requestId)},${json(approve)},null,true)`,{write:true}),{...ownQuery,operationId:approve.operationId});
  const revisionQuery={siteId:d.site,mode:'prepare',family:'correction_revision',workerId:h.workerId,baseRequestId:ownQuery.requestId},revision=await run(revisionQuery);assert(revision.canSubmit);
  assert.equal(revision.window.rootDeadlineAt,submitted.receipt.effectiveDeadlineAt);
  const revisionCommand={command:{action:'submit',operationId:next(),expectedRevision:revision.application.revision,expectedBaseOperationId:revision.application.current.lineage.rootOperationId,
   expectedEffectiveOperationId:revision.application.current.operationId,expectedPolicyRevision:revision.application.currentRules.policy.revision,
   proposal:{...proposal,endAt:instant(new Date(Date.parse(proposal.endAt)+60000))},reason:'Synthetic243 actual revision'},expectedWindowFingerprint:revision.window.windowFingerprint};
  for(const version of [1,2]){const command=version===1?Object.fromEntries(Object.entries(revisionCommand.command).filter(([k])=>k!=='expectedEffectiveOperationId')):revisionCommand.command;
   const rejected=await call('legacy_revision_'+version,revisionLegacy(ownQuery.requestId,command,version),{write:true,role:version===1?'postgres':'service_role'});assert.equal(rejected.error,'attendance_application_window_protocol_required',JSON.stringify(rejected));}
  const revised=await run(revisionQuery,revisionCommand);assert.equal(revised.receipt.family,'correction_revision');
  assert.equal((await run({siteId:d.site,mode:'detail',family:'correction_revision',workerId:h.workerId,requestId:revisionCommand.command.operationId})).application.item.status,'submitted');
  const disabled=await activation(toggle('deactivate',1),false);assert.equal(disabled.current.revision,2);
  assert.deepEqual((await run(recovery,null,false)).receipt,submitted.receipt);
  const withdraw={action:'withdraw',operationId:next(),requestId:revisionCommand.command.operationId,expectedRevision:revision.application.revision+1,reason:'Synthetic243 legacy withdrawal while off'};
  await ok('legacy_revision_withdraw_off',`public.faolla_attendance_revision_self_v2(${site},${auth},${json({mode:'detail',expectedWorkerId:h.workerId,baseRequestId:ownQuery.requestId,requestId:withdraw.requestId,operationId:null})},${json(withdraw)},false)`,{write:true});
  assert.equal((await run(revisionQuery)).canSubmit,false);groups.push('actual_revision_both_legacy_gates_root_cap_and_off_withdraw');
  await activation(toggle('activate',2));

  const missingDay=new Date(Date.parse(profile.today+'T00:00:00Z')-8*86400000).toISOString().slice(0,10);
  const missingQuery={siteId:d.site,mode:'prepare',family:'missing',workerId:h.workerId,fromDate:profile.today,throughDate:profile.today,proposedStartAt:missingDay+'T08:00:00.000000Z',supersedesRequestId:null};
  const missing=await run(missingQuery);assert(missing.canSubmit);const m=missing.application;
  const missingCommand={command:{action:'submit',operationId:next(),reason:'Synthetic243 missing application',expectedWorkerId:h.workerId,expectedSettingsVersion:m.settingsVersion,expectedPolicyRevision:m.policyRevision,
   locationId:m.locationId,timeZone:m.timeZone,proposal:{startAt:missingQuery.proposedStartAt,endAt:missingDay+'T10:00:00.000000Z',breaks:[]}},expectedWindowFingerprint:missing.window.windowFingerprint};
  const mq={siteId:d.site,access:'self',fromDate:profile.today,throughDate:profile.today,requestId:null,operationId:null,beforeAt:null,beforeId:null};
  const legacyMissing=(q,c=null)=>`public.faolla_attendance_missing_v1(${json(q)},${q.access==='owner'?owner:auth},${json(c)},true)`;
  const missingDenied=await call('legacy_missing_gate',legacyMissing(mq,missingCommand.command),{write:true});assert.equal(missingDenied.error,'attendance_application_window_protocol_required',JSON.stringify(missingDenied));
  const missingSubmitted=await run(missingQuery,missingCommand);assert.equal(missingSubmitted.receipt.family,'missing');
  const moq={...mq,access:'owner',requestId:missingCommand.command.operationId};
  const missingReview=parseMissingResult(await ok('owner_missing_review',legacyMissing(moq)),moq,false);assert(missingReview.detail.canApprove);
  const missingApprove={action:'approve',operationId:next(),requestId:moq.requestId,expectedRevision:1,evidenceToken:missingReview.detail.evidenceToken,reason:'Synthetic243 original owner approves missing'};
  parseMissingResult(await ok('owner_missing_approve',legacyMissing(moq,missingApprove),{write:true}),{...moq,operationId:missingApprove.operationId},false);
  const mrq={...missingQuery,family:'missing_revision',supersedesRequestId:moq.requestId},mr=await run(mrq);assert(mr.canSubmit);
  assert.equal(mr.window.rootDeadlineAt,missingSubmitted.receipt.effectiveDeadlineAt);
  const mrCommand={command:{...missingCommand.command,action:'revise',operationId:next(),supersedesRequestId:moq.requestId,expectedApprovalOperationId:missingApprove.operationId,
   reason:'Synthetic243 actual missing revision',proposal:{...missingCommand.command.proposal,endAt:missingDay+'T10:01:00.000000Z'}},expectedWindowFingerprint:mr.window.windowFingerprint};
  const missingRevisionDenied=await call('legacy_missing_revision_gate',legacyMissing(mq,mrCommand.command),{write:true});assert.equal(missingRevisionDenied.error,'attendance_application_window_protocol_required',JSON.stringify(missingRevisionDenied));
  const missingRevised=await run(mrq,mrCommand);assert.equal(missingRevised.receipt.family,'missing_revision');
  assert.equal((await run({siteId:d.site,mode:'detail',family:'missing_revision',workerId:h.workerId,requestId:mrCommand.command.operationId})).application.detail.status,'submitted');
  groups.push('actual_missing_and_missing_revision_with_original_owner_decision');

  const sourceBranch=await save('aw243_source');
  const scopeValue={kind:'enterprise'},ruleQuery=(mode='detail',extra={})=>({siteId:d.site,scope:scopeValue,mode,...extra});
  const ledger=(query,command=null)=>executeOperationalRuleLedger({query,command,authUserId:d.owner,allowWrite:true},service);
  const rules=Object.fromEntries(['allowedChannels','locationScope','shiftSource','breakTypes','correctionWindow','reviewRouting','timesheetCycle','reminders'].map(k=>[k,{mode:'inherit'}]));
  rules.correctionWindow={mode:'value',value:{days:0}};const templateBranch=await save('aw243_template');const ruleDetail=(await ledger(ruleQuery())).data;
  await ledger(ruleQuery(),{siteId:d.site,scope:scopeValue,action:'save_draft',operationId:operationalPunchFixtureIds.draft,expectedRevision:0,reason:'Synthetic243 zero-day actual template',expectedContext:ruleDetail.context,rules});
  const tomorrow=new Date(Date.parse(profile.localToday+'T00:00:00Z')+86400000).toISOString().slice(0,10),preview=(await ledger(ruleQuery('preview',{sourceDraftRevision:1,effectiveOn:tomorrow,endsOn:null}))).data;
  await ledger(ruleQuery(),{siteId:d.site,scope:scopeValue,action:'publish',operationId:operationalPunchFixtureIds.publish,expectedRevision:1,sourceDraftRevision:1,effectiveOn:tomorrow,endsOn:null,previewFingerprint:preview.previewFingerprint,reason:'Synthetic243 zero-day actual future publication'});
  const templates=JSON.parse(await step('read_template_rows',`select jsonb_build_object('head',(select to_jsonb(x) from public.merchant_attendance_operational_rule_streams x),
   'operations',(select jsonb_agg(to_jsonb(x) order by revision) from public.merchant_attendance_operational_rule_operations x));`));
  await restore('aw243_template',templateBranch);await step('disclosed_four_past_rows',operationalPunchPastSeed(templates,profile.localToday)+'select 1;');
  const expiredQuery={...missingQuery,proposedStartAt:missingDay+'T11:00:00.000000Z'},expired=await run(expiredQuery);assert.equal(expired.window.selectedDays,0);assert.equal(expired.canSubmit,false);
  assert(expired.window.effectiveDeadlineAt<=expired.readAt);assert(expired.window.effectiveDeadlineAt<=expired.window.baselineDeadlineAt);
  const expiredCommand={command:{...missingCommand.command,operationId:next(),proposal:{startAt:expiredQuery.proposedStartAt,endAt:missingDay+'T12:00:00.000000Z',breaks:[]}},expectedWindowFingerprint:expired.window.windowFingerprint};
  await deny('real_zero_day_expired',()=>run(expiredQuery,expiredCommand),'attendance_application_window_expired');
  await restore('aw243_source',sourceBranch);groups.push('real191_template_disclosed_past_source_zero_day_exact_expiration');
  await step('check_old_before_rollback',`do $aw243_end$ begin ${preserve} end;$aw243_end$;select 1;`);
  await step('rollback','rollback;');rolledBack=true;
  return {phase:243,groups,steps,reads,writes,rejections,actualFamilies:['correction','correction_revision','missing','missing_revision'],
   actualOwnerApprovals:2,legacyFreshGates:6,proofFailureAtomic:true,originalNumberFullHash:true,
   syntheticPastTimeSeed:{rows:4,realDraft:1,realFuturePublication:1,notHistoricalRpc:true},rollbackRestored:true,oldFactsUnchanged:true,oldArchivesUnchanged:true,realAuth:false,production:false};
 }catch(error){throw new Error('application_window_native_stage:'+stage+':'+(error?.stack??error)+':'+JSON.stringify(lastRpc).slice(0,16000));}
 finally{try{if(!rolledBack)await connection.step('rollback;');}catch(error){if(!String(error).includes('attendance_concurrency_closed'))throw error;}finally{await connection.close();}
  assert.equal(d.fingerprint(),baseline);assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  assert.deepEqual(periodContinuationArchiveBytes(await archive()),originalArchive);assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),originalPeriod);
 }
}
