import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {prepareOnsiteScheduleNative,onsiteScheduleExpression,onsiteScheduleMigration,onsiteScheduleRpc} from './fixtures/attendance-onsite-schedule-native.mjs';
import {prepareLocationScheduleNative} from './fixtures/attendance-location-schedule-native.mjs';
import {planRuleApprovalsExpression} from './fixtures/attendance-plan-rule-approvals-native.mjs';
import {checkAttendanceOnsiteScheduleBrowser} from './fixtures/attendance-onsite-schedule-browser.mjs';
import {lifecycleId as id,lifecycleRace} from './merchant-attendance-lifecycle-native-support.mjs';
let phase='entry';
export async function checkOnsiteScheduleNative(native,scope,browserCheck=null){
  phase='prepare';const d=await prepareOnsiteScheduleNative(native,scope),{exec,site,auth,employee,slots}=d;
  let checks=0;const pass=message=>{checks++;native.pass(message);};
  pass('142 three-stage partial installs and reapply preserve facts and all old functions except two approved private adapters');
  phase='read-only';const before=d.fingerprint(),plain=await d.request();assert.equal(plain.status,200,JSON.stringify(plain.body));
  assert(plain.body.choices.entries.some(s=>s.id===slots.main.id));assert.equal(plain.body.clock.employeeId,employee);
  assert.equal(JSON.stringify(plain.body).includes('terminalId'),false);
  const disabled=await d.request(null,null,null,{featureEnabled:()=>false});assert.equal(disabled.status,200);assert.equal(disabled.body.choices.entries.length,0);assert.equal(d.fingerprint(),before);
  pass('candidate GET is read-only, default-location scoped, bounded and explicitly not QR proof');
  phase='adopted';const first=await d.command(),result=await d.request(first,d.selected(slots.main));
  assert.equal(result.status,200,JSON.stringify({body:result.body,sql:d.failures.at(-1)}));
  assert.equal(result.body.association.status,'linked');assert.equal(result.body.adoption.status,'adopted');
  assert.deepEqual(result.body.adoption.approval,{operationId:d.mainApproval.operationId,revision:d.mainApproval.revision,sourceId:d.mainApproval.sourceId,
    sourceSha256:d.mainApproval.sourceSha256,recordedAt:d.mainApproval.recordedAt});
  assert.equal(result.body.adoption.recordedAt,result.body.association.recordedAt);
  const firstCounts=d.counts();assert.deepEqual(firstCounts,{events:1,relations:1,adoptions:1,nonces:1,bindings:0});
  pass('real HMAC / HTTP handler /108 receipt /137 relation /140 approval reference commit together');
  phase='recovery';const recovered=await d.request(null,null,first.operationId,{featureEnabled:()=>false});assert.equal(recovered.status,200);assert.deepEqual(recovered.body.adoption,result.body.adoption);
  const repeated=await d.request(first,d.selected(slots.main),null,{},result.token);assert.equal(repeated.status,200);assert.equal(repeated.body.clock.replayed,true);
  const changed=await d.request(first,null,null,{},result.token);assert.equal(changed.status,409);assert.equal(changed.body.error,'attendance_operation_conflict');
  const off=await d.request(first,d.selected(slots.main),null,{featureEnabled:()=>false},result.token);assert.equal(off.status,403);
  const paused=await d.request(null,null,first.operationId,{entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}})});
  assert.equal(paused.status,200);assert.deepEqual(paused.body.adoption,result.body.adoption);assert.deepEqual(d.counts(),firstCounts);
  d.cancel(slots.main);const cancelled=await d.request(null,null,first.operationId);assert.equal(cancelled.status,200);
  assert.equal(cancelled.body.association.currentCancelled,true);assert.deepEqual(cancelled.body.adoption,result.body.adoption);
  await d.oldClock();pass('original-number recovery survives feature rollback and cancellation without changing saved selection or approval');
  phase='nonce-and-expiry';const c=await d.command(),used=await d.request(c,null,null,{},result.token);assert.equal(used.status,409);assert.equal(used.body.error,'attendance_qr_used');
  const issued=await d.issue(),claims=d.verifyOnsiteToken(issued.token),past={...claims,issuedAtMs:claims.issuedAtMs-90000,expiresAtMs:claims.expiresAtMs-90000};
  // Keep canonical pairing chronology while testing an authentic expired code.
  past.pairedAtMs=Math.min(past.pairedAtMs,past.issuedAtMs);
  const expired=await d.request(c,null,null,{},d.signOnsiteToken(past));assert.equal(expired.status,409);assert.equal(expired.body.error,'attendance_qr_expired');
  const invalid=await d.request(c,null,null,{},issued.token.slice(0,-1)+(issued.token.endsWith('A')?'B':'A'));assert.equal(invalid.status,400);
  assert.deepEqual(d.counts(),{...firstCounts,events:2,nonces:2});
  const originalArgs={p_site:site,p_auth:auth,p_claims:null,p_command:null,p_operation:first.operationId,p_allow_new:false,p_selection:null,p_allow_schedule:false,p_bind_rules:false};
  exec(`begin;update public.merchant_attendance_terminals set revoked_at=clock_timestamp(),revoked_by='${d.owner}' where id='${d.terminal}';set local role service_role;
    do $recover$ declare r jsonb;begin r:=${onsiteScheduleExpression(originalArgs)};assert r->'adoption'->>'status'='adopted';end;$recover$;reset role;rollback;`);
  pass('same-worker nonce reuse expired or tampered codes cannot add events while revoked-terminal original GET still recovers');
  phase='statuses';for(const [slot,status,reason] of [[null,'unselected',null],[slots.alternate,'not_approved','approval_missing'],[slots.legacy,'unverified','publication_missing'],[slots.main,'unverified','cancelled']]){
    const r=await d.request(await d.command(),slot?d.selected(slot):null);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.adoption.status,status);assert.equal(r.body.adoption.reason,reason);
    assert.equal(r.body.adoption.approval,null);await d.oldClock();
  }
  pass('explicit no-plan, missing approval, unpublished and cancelled plans preserve clock evidence without fabricated adoption');
  phase='legacy';const old=await d.oldClock('clock_in'),legacy=await d.request(null,null,old.receipt.operationId);assert.equal(legacy.status,200);assert.equal(legacy.body.adoption,null);assert.equal(legacy.body.association,null);
  const savedCall=d.calls.find(c=>c.args.p_command?.operationId===old.receipt.operationId),oldCounts=d.counts();
  const oldPost=await d.request(savedCall.args.p_command,null);assert.equal(oldPost.status,409);assert.deepEqual(d.counts(),oldCounts);await d.oldClock();
  pass('legacy QR receipt remains readable with null sidecars and cannot be backfilled by new POST');
  phase='bound';const bindingBefore=d.counts().bindings,bound=await d.request(await d.command(),null,null,{bindRules:()=>true});assert.equal(bound.status,200,JSON.stringify(bound.body));
  assert.equal(bound.body.adoption.status,'unselected');assert.equal(d.counts().bindings,bindingBefore+1);await d.oldClock();
  pass('optional original134 binding coexists with mandatory new relation and adoption');
  phase='atomic-input-denial';const stableCounts=d.counts(),wrong=await d.request(await d.command(),d.selected(slots.other));assert.equal(wrong.status,403);assert.deepEqual(d.counts(),stableCounts);
  const revision=await d.request(await d.command(),{slotId:slots.alternate.id,revision:999});assert.equal(revision.status,400);assert.deepEqual(d.counts(),stableCounts);
  const wrongLocation=await d.request(await d.command('clock_in',{locationId:d.secondLocation}),null);assert.equal(wrongLocation.status,400);assert.deepEqual(d.counts(),stableCounts);
  pass('foreign employee selection wrong revision and code-location mismatch roll back or reject before event/nonce creation');
  phase='identity';const stable=d.fingerprint();
  exec(`begin;update public.merchant_enterprise_employees set auth_user_id='${id(97)}' where merchant_id='${site}' and id='${employee}';set local role service_role;
    do $rebind$ begin begin perform ${onsiteScheduleExpression(originalArgs)};raise assert_failure;exception when others then if sqlerrm not in('attendance_access_denied','attendance_worker_changed') then raise;end if;end;end;$rebind$;reset role;rollback;`);
  assert.equal(d.fingerprint(),stable);pass('current employee identity remains mandatory for immutable original QR recovery');
  phase='locks';const raceCommand=await d.command(),raceCode=await d.issue();
  const writeArgs={...originalArgs,p_claims:d.verifyOnsiteToken(raceCode.token),p_command:raceCommand,p_operation:null,p_allow_new:true,p_selection:d.selected(slots.race),p_allow_schedule:true};
  const preview=d.raw(d.query(slots.race)),approval=d.approvalCommand(preview,169990),q=d.query(slots.race,'approve',approval.operationId);
  const holder=`reset role;${d.guard}set local role service_role;select ${planRuleApprovalsExpression(q,d.owner,approval)};`;
  const waiter=`reset role;${d.guard}savepoint probe;set local role service_role;do $adopted$ declare r jsonb;begin r:=${onsiteScheduleExpression(writeArgs)};
    assert r->'adoption'->'approval'->>'operationId'='${approval.operationId}';assert r->'adoption'->'approval'->>'sourceSha256'='${approval.expectedFingerprint}';end;$adopted$;reset role;rollback to savepoint probe;`;
  exec(`begin;${holder}${waiter}rollback;`);
  const approvalRace=await lifecycleRace({connect:native.connect,query:native.query,sql:scope.sql},holder,waiter);assert(approvalRace.witnessed);assert.equal(approvalRace.right.error,null);
  const cancel=d.cancelCommand(slots.cancelAfter),cancelCode=await d.issue(),cancelArgs={...writeArgs,p_claims:d.verifyOnsiteToken(cancelCode.token),p_selection:d.selected(slots.cancelAfter)};
  const cancelHolder=`reset role;${d.guard}set local role service_role;select ${d.cancelExpression(cancel)};`;
  const cancelWaiter=`reset role;${d.guard}savepoint probe;set local role service_role;do $cancelled$ declare r jsonb;begin r:=${onsiteScheduleExpression(cancelArgs)};
    assert r->'association'->>'reason'='cancelled';assert r->'adoption'->>'status'='unverified';end;$cancelled$;reset role;rollback to savepoint probe;`;
  exec(`begin;${cancelHolder}${cancelWaiter}rollback;`);
  const cancelRace=await lifecycleRace({connect:native.connect,query:native.query,sql:scope.sql},cancelHolder,cancelWaiter);assert(cancelRace.witnessed);assert.equal(cancelRace.right.error,null);
  assert.deepEqual(d.counts(),stableCounts);pass('exact blocked-PID witnesses prove140 approval and99 cancellation serialize with onsite worker clock');
  phase='sidecar-failure';const atomicTables=['merchant_attendance_events','merchant_attendance_onsite_receipts','merchant_attendance_shift_schedule_relations','merchant_attendance_shift_plan_adoptions','merchant_attendance_shift_rule_bindings','merchant_attendance_shift_rule_sources'];
  const actualCounts=`jsonb_build_array(${atomicTables.map(t=>`(select count(*) from public.${t})`).join(',')})`,failCode=await d.issue();
  const failArgs={...writeArgs,p_claims:d.verifyOnsiteToken(failCode.token),p_bind_rules:true};const failureFacts=d.fingerprint();
  exec(`begin;alter table public.merchant_attendance_shift_plan_adoptions add constraint synthetic169_failure check(channel<>'onsite') not valid;
    do $failure$ declare before_counts jsonb;begin before_counts:=${actualCounts};begin perform ${onsiteScheduleExpression(failArgs)};raise assert_failure;exception when check_violation then null;end;
    assert ${actualCounts}=before_counts,'synthetic_sidecar_partial_commit';end;$failure$;rollback;`);
  assert.equal(d.fingerprint(),failureFacts);assert.deepEqual(d.counts(),stableCounts);
  // Failure did NOT spend the nonce: the identical command/code can now commit.
  const afterFailure=await d.request(raceCommand,d.selected(slots.race),null,{bindRules:()=>true},failCode.token);assert.equal(afterFailure.status,200);assert.equal(afterFailure.body.adoption.status,'adopted');await d.oldClock();
  pass('sidecar failure rolls back all six tables and leaves the original nonce available for the same command');
  phase='nonce-race';const nonceCommand=await d.command(),nonceCode=await d.issue(),nonceArgs={...writeArgs,p_command:nonceCommand,p_claims:d.verifyOnsiteToken(nonceCode.token),p_selection:null};
  const nonceHolder=`reset role;${d.guard}set local role service_role;select ${onsiteScheduleExpression(nonceArgs)};`;
  const nonceWaiter=`reset role;${d.guard}set local role service_role;do $replay$ declare r jsonb;begin r:=${onsiteScheduleExpression(nonceArgs)};assert r->'clock'->'replayed'='true'::jsonb;end;$replay$;`;
  exec(`begin;${nonceHolder}${nonceWaiter}rollback;`);const nonceBefore=d.counts();
  const nonceRace=await lifecycleRace({connect:native.connect,query:native.query,sql:scope.sql},nonceHolder,nonceWaiter);assert(nonceRace.witnessed);assert.equal(nonceRace.right.error,null);
  assert.deepEqual(d.counts(),{...nonceBefore,events:nonceBefore.events+1,nonces:nonceBefore.nonces+1,relations:nonceBefore.relations+1,adoptions:nonceBefore.adoptions+1});await d.oldClock();
  pass('concurrent identical code and operation commit exactly one event and replay the same relation');
  phase='ACL';exec(`do $acl$ declare r text;begin foreach r in array array['anon','authenticated','service_role'] loop
    assert not has_table_privilege(r,'public.merchant_attendance_shift_plan_adoptions','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
    assert has_function_privilege(r,'public.${onsiteScheduleRpc}(text,uuid,jsonb,jsonb,uuid,boolean,jsonb,boolean,boolean)','EXECUTE')=(r='service_role');end loop;end;$acl$;`);
  for(const mutation of ['update public.merchant_attendance_shift_plan_adoptions set channel=channel','delete from public.merchant_attendance_shift_plan_adoptions','truncate public.merchant_attendance_shift_plan_adoptions'])
    exec(`begin;do $immutable$ begin begin ${mutation};raise assert_failure;exception when others then if sqlerrm<>'attendance_events_append_only' then raise;end if;end;end;$immutable$;rollback;`);
  const factsAfter=d.fingerprint();d.reapply();assert.equal(d.fingerprint(),factsAfter);assert.equal(d.previousDefinitions(),d.oldDefinitions);assert.equal(d.definitions(),d.installedDefinitions);assert.equal(d.tableCatalog(),d.installedCatalog);
  pass('private sidecar ACL append-only protections and reapply preserve all existing facts and approved definitions');
  phase='browser';const browser=browserCheck?await browserCheck(native,scope,d):null;
  return {checks,lockWitnesses:3,browser,productionAccess:false,realAuth:false,realCamera:false,newCluster:false};
}
async function locationCompatibility(native,scope){
  phase='location-compatibility';const d=await prepareLocationScheduleNative(native,scope),before=d.fingerprint(d.inventory().filter(t=>t!=='faolla_schema_migrations'));
  native.query(scope.sql(readFileSync(path.join(native.root,'scripts/supabase-migrations',onsiteScheduleMigration),'utf8')));
  assert.equal(d.fingerprint(d.inventory().filter(t=>t!=='faolla_schema_migrations')),before);assert.equal(d.previousDefinitions(),d.oldDefinitions);
  for(const [slot,status] of [[d.slots.main,'adopted'],[null,'unselected'],[d.slots.alternate,'not_approved'],[d.slots.legacy,'unverified']]){
    const c=await d.command(),selection=slot?d.selected(slot):null,r=await d.request(c,selection);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.adoption.status,status);
    assert.equal(r.body.adoption.channel,'location');const recovered=await d.request(null,null,c.operationId);assert.equal(recovered.status,200);assert.deepEqual(recovered.body.adoption,r.body.adoption);
    await d.oldClock();
  }
  assert.equal(d.previousDefinitions(),d.oldDefinitions);native.pass('142 shared private adapters preserve actual141 spatial clock adopted unselected unapproved unpublished and original-number recovery');
  return {checks:1,locationCases:4};
}
export async function runOnsiteScheduleNative(args,browserCheck=null){
  let result,compatibility;const previous=process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET;
  process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET=randomBytes(32).toString('hex');
  try{await runAttendanceLabelsReuse(args,async native=>{
    await withAttendanceConcurrencySandbox(native,async scope=>{result=await checkOnsiteScheduleNative(native,scope,browserCheck);});
    await withAttendanceConcurrencySandbox(native,async scope=>{compatibility=await locationCompatibility(native,scope);});
  });return {...result,compatibility};}
  finally{if(previous===undefined)delete process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET;else process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET=previous;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runOnsiteScheduleNative(process.argv.slice(2),checkAttendanceOnsiteScheduleBrowser).then(result=>console.log(JSON.stringify(result))).catch(error=>{
  console.error(JSON.stringify({error:'onsite_schedule_native_failed',phase,code:String(error).match(/attendance_[a-z_]+/)?.[0]??'local_check_failed',message:String(error),stack:String(error.stack).split('\n').slice(0,6)}));process.exitCode=1;});
