import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {prepareLocationScheduleNative,locationScheduleMigration,locationScheduleExpression,locationScheduleRpc} from './fixtures/attendance-location-schedule-native.mjs';
import {boundClockMigrationBody} from './fixtures/attendance-bound-clocks-native.mjs';
import {planRuleApprovalsExpression} from './fixtures/attendance-plan-rule-approvals-native.mjs';
import {lifecycleId as id,lifecycleRace} from './merchant-attendance-lifecycle-native-support.mjs';
import {checkAttendanceLocationScheduleBrowser} from './fixtures/attendance-location-schedule-browser.mjs';
let phase='entry';
export async function checkLocationScheduleNative(native,scope,browserCheck=null){
  phase='prepare';const d=await prepareLocationScheduleNative(native,scope),{exec,site,worker,auth,employee,slots}=d;
  native.pass('141 additive install and reapply preserve previous facts function definitions and checked table catalog');
  phase='read-only';const before=d.fingerprint(),plain=await d.request();assert.equal(plain.status,200,JSON.stringify(plain.body));
  assert(plain.body.choices.entries.some(s=>s.id===slots.main.id));assert.equal(Object.hasOwn(plain.body.clock,'internalFence'),false);
  const disabled=await d.request(null,null,null,{featureEnabled:()=>false});assert.equal(disabled.status,200);assert.equal(disabled.body.choices.entries.length,0);assert.equal(d.fingerprint(),before);
  native.pass('explicit candidate GET is bounded private and does not write while feature-off remains recoverable');
  phase='adopted-clock';const first=await d.command(),result=await d.request(first,d.selected(slots.main));assert.equal(result.status,200,JSON.stringify({body:result.body,sql:d.failures.at(-1)}));
  assert.equal(result.body.clock.locationResult.reason,'inside');assert.equal(result.body.association.status,'linked');assert.equal(result.body.adoption.status,'adopted');
  assert.deepEqual(result.body.adoption.approval,{operationId:d.mainApproval.operationId,revision:d.mainApproval.revision,sourceId:d.mainApproval.sourceId,
    sourceSha256:d.mainApproval.sourceSha256,recordedAt:d.mainApproval.recordedAt});
  assert.equal(result.body.adoption.recordedAt,result.body.association.recordedAt);assert.equal(result.body.choices.entries.length,0);
  const firstCount=d.counts();assert.deepEqual(firstCount,{events:1,relations:1,adoptions:1,results:1,notices:1});
  native.pass('actual113 spatial notice receipt137 relation and140 approved reference commit together through real handler');
  phase='recovery';const recovered=await d.request(null,null,first.operationId,{featureEnabled:()=>false});assert.equal(recovered.status,200);assert.deepEqual(recovered.body.adoption,result.body.adoption);
  const repeated=await d.request(first,d.selected(slots.main));assert.equal(repeated.status,200);assert.equal(repeated.body.clock.replayed,true);
  const changed=await d.request(first,null);assert.equal(changed.status,409);assert.equal(changed.body.error,'attendance_operation_conflict');assert.deepEqual(d.counts(),firstCount);
  const postOff=await d.request(first,d.selected(slots.main),null,{featureEnabled:()=>false});assert.equal(postOff.status,403);assert.deepEqual(d.counts(),firstCount);
  d.cancel(slots.main);const afterCancel=await d.request(null,null,first.operationId);assert.equal(afterCancel.status,200);
  assert.equal(afterCancel.body.association.currentCancelled,true);assert.deepEqual(afterCancel.body.adoption,result.body.adoption);
  await d.oldClock();native.pass('same number recovery and feature rollback never change selection or rewrite old approval after cancellation');
  phase='unselected-and-unapproved';
  for(const [slot,status,reason] of [[null,'unselected',null],[slots.alternate,'not_approved','approval_missing'],[slots.legacy,'unverified','publication_missing'],[slots.main,'unverified','cancelled']]){
    const c=await d.command(),r=await d.request(c,slot?d.selected(slot):null);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.adoption.status,status);assert.equal(r.body.adoption.reason,reason);
    assert.equal(r.body.adoption.approval,null);await d.oldClock();
  }
  const denied=await d.request(await d.command('clock_in',{position:null,positionFailure:'denied'}),null);assert.equal(denied.status,200,JSON.stringify(denied.body));
  assert.equal(denied.body.clock.locationResult.needsReview,true);assert.equal(denied.body.clock.locationResult.reason,'denied');await d.oldClock();
  native.pass('unselected missing approval unpublished cancelled and denied-position paths preserve actual clock without fabricating approval');
  phase='legacy';const old=await d.oldClock('clock_in'),legacy=await d.request(null,null,old.receipt.operationId);assert.equal(legacy.status,200);assert.equal(legacy.body.adoption,null);assert.equal(legacy.body.association,null);
  const original=d.calls.filter(c=>c.args.p_command?.operationId===old.receipt.operationId).at(-1).args.p_command;
  const legacyCommand={...original,expectedWorkerId:worker,position:null,positionFailure:'denied'};
  const oldCounts=d.counts(),oldPost=await d.request(legacyCommand,null);assert.equal(oldPost.status,409);assert.deepEqual(d.counts(),oldCounts);await d.oldClock();
  native.pass('legacy location receipt reads with no sidecar and new POST never backfills it');
  phase='bound-original';const bindingsBefore=Number(exec('select count(*) from public.merchant_attendance_shift_rule_bindings;'));
  const bound=await d.request(await d.command(),null,null,{bindRules:()=>true});assert.equal(bound.status,200,JSON.stringify(bound.body));
  assert.equal(bound.body.adoption.status,'unselected');assert.equal(Number(exec('select count(*) from public.merchant_attendance_shift_rule_bindings;')),bindingsBefore+1);
  await d.oldClock();native.pass('optional actual134 rule-bound old location path retains its binding alongside new selection capture');
  phase='atomic-denial';const counts=d.counts();const wrong=await d.request(await d.command(),d.selected(slots.other));assert.equal(wrong.status,403);assert.deepEqual(d.counts(),counts);
  const wrongVersion=await d.request(await d.command(),{slotId:slots.alternate.id,revision:999});assert.equal(wrongVersion.status,400);assert.deepEqual(d.counts(),counts);
  native.pass('foreign employee selection and invalid revision roll back old event location receipts and relation atomically');
  phase='identity';const snapshot=d.fingerprint();
  const recoveryArgs={p_site_id:site,p_auth_user_id:auth,p_expected_worker_id:worker,p_command:null,p_operation_id:first.operationId,p_assertion:null,p_allow_new_sessions:false,p_require_clock:false,p_selection:null,p_allow_schedule:false,p_bind_rules:false};
  exec(`begin;update public.merchant_enterprise_employees set auth_user_id='${id(97)}' where merchant_id='${site}' and id='${employee}';set local role service_role;
    do $rebind$ begin begin perform ${locationScheduleExpression(recoveryArgs)};raise assert_failure;exception when others then if sqlerrm not in('attendance_access_denied','attendance_worker_changed') then raise;end if;end;end;$rebind$;reset role;rollback;`);
  assert.equal(d.fingerprint(),snapshot);native.pass('current identity remains required for old location schedule recovery');
  phase='locks';const c=await d.command(),prepared=await d.request(null,null,c.operationId);assert.equal(prepared.status,200);
  // Reuse the old spatial service's own assertion as observed from a real
  // successful call, updating only its fresh sample metadata in this fixture.
  const assertion={...d.calls.find(c=>c.args.p_assertion!==null&&c.args.p_assertion!==undefined).args.p_assertion,capturedAt:new Date().toISOString()};
  const {expectedWorkerId:_worker,position:_position,positionFailure:_failure,...sqlCommand}=c;void _worker;void _position;void _failure;
  const writeArgs={...recoveryArgs,p_command:sqlCommand,p_operation_id:null,p_assertion:assertion,p_allow_new_sessions:true,p_require_clock:true,p_selection:d.selected(slots.race),p_allow_schedule:true};
  const preview=d.raw(d.query(slots.race)),approval=d.approvalCommand(preview,168990),q=d.query(slots.race,'approve',approval.operationId);
  const holder=`reset role;${d.guard}set local role service_role;select ${planRuleApprovalsExpression(q,d.owner,approval)};`;
  const waiter=`reset role;${d.guard}savepoint probe;set local role service_role;do $adopted$ declare r jsonb;begin r:=${locationScheduleExpression(writeArgs)};
    assert r->'adoption'->'approval'->>'operationId'='${approval.operationId}';
    assert r->'adoption'->'approval'->>'sourceSha256'='${approval.expectedFingerprint}';end;$adopted$;reset role;rollback to savepoint probe;`;
  exec(`begin;reset role;${d.guard}set local role service_role;select ${planRuleApprovalsExpression(q,d.owner,approval)};${waiter}rollback;`);
  const race=await lifecycleRace({connect:native.connect,query:native.query,sql:scope.sql},holder,waiter);assert(race.witnessed);assert.equal(race.right.error,null);
  const cancel=d.cancelCommand(slots.cancelAfter),cancelArgs={...writeArgs,p_selection:d.selected(slots.cancelAfter)};
  const cancelHolder=`reset role;${d.guard}set local role service_role;select ${d.cancelExpression(cancel)};`;
  const cancelWaiter=`reset role;${d.guard}savepoint probe;set local role service_role;do $cancelled$ declare r jsonb;begin r:=${locationScheduleExpression(cancelArgs)};
    assert r->'association'->>'reason'='cancelled';assert r->'adoption'->>'status'='unverified';end;$cancelled$;reset role;rollback to savepoint probe;`;
  exec(`begin;${cancelHolder}${cancelWaiter}rollback;`);
  const cancelRace=await lifecycleRace({connect:native.connect,query:native.query,sql:scope.sql},cancelHolder,cancelWaiter);assert(cancelRace.witnessed);assert.equal(cancelRace.right.error,null);
  assert.deepEqual(d.counts(),counts);native.pass('real140 approval and99 cancellation locks serialize location clock and preserve exact winner semantics');
  phase='sidecar-failure';const stable=d.fingerprint();
  const atomicTables=['merchant_attendance_events','merchant_attendance_location_results','merchant_attendance_location_clock_notices','merchant_attendance_shift_schedule_relations','merchant_attendance_shift_plan_adoptions','merchant_attendance_shift_rule_bindings','merchant_attendance_shift_rule_sources'];
  const actualCounts=`jsonb_build_array(${atomicTables.map(t=>`(select count(*) from public.${t})`).join(',')})`;
  exec(`begin;alter table public.merchant_attendance_shift_plan_adoptions add constraint synthetic168_failure check(channel<>'location') not valid;
    do $failure$ declare before_counts jsonb;begin before_counts:=${actualCounts};begin perform ${locationScheduleExpression({...writeArgs,p_bind_rules:true})};raise assert_failure;exception when check_violation then null;end;
    assert ${actualCounts}=before_counts,'synthetic_sidecar_partial_commit';end;$failure$;rollback;`);
  assert.equal(d.fingerprint(),stable);assert.deepEqual(d.counts(),counts);
  // Actual forbidden rewrites, with catches only inside the synthetic test.
  for(const mutation of ['update public.merchant_attendance_shift_plan_adoptions set channel=channel','delete from public.merchant_attendance_shift_plan_adoptions','truncate public.merchant_attendance_shift_plan_adoptions']){
    exec(`begin;do $immutable$ begin begin ${mutation};raise assert_failure;exception when others then if sqlerrm<>'attendance_events_append_only' then raise;end if;end;end;$immutable$;rollback;`);
  }
  assert.equal(d.fingerprint(),stable);native.pass('sidecar failure is atomic and saved adoption rejects update delete and truncate');
  phase='ACL';exec(`do $acl$ declare r text;begin foreach r in array array['anon','authenticated','service_role'] loop
    assert not has_table_privilege(r,'public.merchant_attendance_shift_plan_adoptions','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
    assert has_function_privilege(r,'public.${locationScheduleRpc}(text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean,jsonb,boolean,boolean)','EXECUTE')=(r='service_role');end loop;end;$acl$;`);
  const after=d.fingerprint();exec(boundClockMigrationBody(native.root,locationScheduleMigration));assert.equal(d.fingerprint(),after);assert.equal(d.previousDefinitions(),d.oldDefinitions);
  assert.equal(d.definitions(),d.installedDefinitions);assert.equal(d.tableCatalog(),d.installedCatalog);native.pass('private append-only sidecar ACL and old function definitions remain unchanged after real writes and reapply');
  phase='browser';const browser=browserCheck?await browserCheck(native,scope,d):null;
  return {checks:12,lockWitnesses:2,browser,productionAccess:false,realAuth:false,realGPS:false,newCluster:false,oldDefinitionsUnchanged:true};
}
export async function runLocationScheduleNative(args,browserCheck=null){let result;await runAttendanceLabelsReuse(args,native=>withAttendanceConcurrencySandbox(native,async scope=>{
  result=await checkLocationScheduleNative(native,scope,browserCheck);}));return result;}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runLocationScheduleNative(process.argv.slice(2),checkAttendanceLocationScheduleBrowser).then(result=>console.log(JSON.stringify(result))).catch(error=>{
  console.error(JSON.stringify({error:'location_schedule_native_failed',phase,code:String(error).match(/attendance_[a-z_]+/)?.[0]??'local_check_failed',message:String(error),stack:String(error.stack).split('\n').slice(0,6)}));process.exitCode=1;});
