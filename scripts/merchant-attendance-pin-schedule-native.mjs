import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {preparePinScheduleNative,pinScheduleExpression,pinScheduleMigration,pinScheduleRpc,pinScheduleOldDefinitions} from './fixtures/attendance-pin-schedule-native.mjs';
import {prepareLocationScheduleNative} from './fixtures/attendance-location-schedule-native.mjs';
import {onsiteScheduleMigration} from './fixtures/attendance-onsite-schedule-native.mjs';
import {planRuleApprovalsExpression} from './fixtures/attendance-plan-rule-approvals-native.mjs';
import {planCoverageExpression} from './fixtures/attendance-plan-coverage-native.mjs';
import {selfScheduleExpression} from './fixtures/attendance-self-schedule-native.mjs';
import {checkAttendancePinScheduleBrowser} from './fixtures/attendance-pin-schedule-browser.mjs';
import {lifecycleId as id,lifecycleJson as json,lifecycleRace} from './merchant-attendance-lifecycle-native-support.mjs';
let phase='entry';
export async function checkPinScheduleNative(native,scope,browserCheck=null){
  phase='prepare';const d=await preparePinScheduleNative(native,scope),{exec,site,auth,employee,worker,slots}=d;
  let checks=0;const pass=message=>{checks++;native.pass(message);};
  const expect=async(p,status=200)=>{const r=await p;assert.equal(r.status,status,JSON.stringify({body:r.body,sql:d.failures.at(-1)}));return r.body;};
  pass('143 partial NOT VALID validated and full installs preserve all business facts and only four approved helper definitions change');
  phase='authenticated-candidates';const before=d.businessFacts(),authBefore=d.authState();
  const plain=await expect(d.request());assert(plain.choices.entries.some(s=>s.id===slots.main.id));
  assert.equal(plain.clock.employeeId,employee);assert.equal(d.businessFacts(),before);assert.equal(d.authState().consumed,true);
  assert.equal(d.authState().workerAttempts,authBefore.workerAttempts+1);
  const wrong=await expect(d.request(null,null,null,{},'93827164'),403);assert.equal(wrong.error,'attendance_pin_denied');
  const off=await expect(d.request(null,null,null,{featureEnabled:()=>false}));assert.equal(off.choices.entries.length,0);
  assert.equal(d.businessFacts(),before);assert.equal(d.authState().consumed,true);
  pass('candidate POST performs actual PIN scrypt and consumes authentication attempts but writes no attendance business facts');
  phase='adopted';d.resetAuthBudget();const first=d.command(),result=await expect(d.request(first,d.selected(slots.main)));
  assert.equal(result.association.status,'linked');assert.equal(result.adoption.status,'adopted');assert.equal(result.adoption.channel,'pin');
  assert.deepEqual(result.adoption.approval,{operationId:d.mainApproval.operationId,revision:d.mainApproval.revision,sourceId:d.mainApproval.sourceId,
    sourceSha256:d.mainApproval.sourceSha256,recordedAt:d.mainApproval.recordedAt});
  assert.equal(result.adoption.employeeAuthUserId,auth);assert.equal(result.adoption.recordedAt,result.association.recordedAt);
  assert.equal(exec(`select source from public.merchant_attendance_events where id='${result.clock.receipt.id}';`),'kiosk');
  assert.deepEqual(d.counts(),{events:1,receipts:1,relations:1,adoptions:1,bindings:0});
  const shiftQuery={siteId:site,workerId:worker,startEventId:result.clock.receipt.id};
  const readFacts=d.fingerprint();
  const reader=JSON.parse(exec(`set local role service_role;select public.faolla_attendance_shift_check_v1(${json(shiftQuery)},'${d.owner}');`));
  assert(JSON.stringify(reader).includes(result.clock.receipt.id));
  const coverage=JSON.parse(exec(`set local role service_role;select ${planCoverageExpression({siteId:site,workerId:worker,slotId:slots.main.id},d.owner)};`));
  assert(JSON.stringify(coverage).includes(result.clock.receipt.id));assert.equal(d.fingerprint(),readFacts);
  pass('real PIN handler commits kiosk event original receipt explicit selection and actual140 approval atomically and138/139 owner readers accept it');
  phase='recovery';const firstCounts=d.counts();
  const recovered=await expect(d.request(null,null,first.operationId,{featureEnabled:()=>false}));assert.deepEqual(recovered.adoption,result.adoption);
  const replay=await expect(d.request(first,d.selected(slots.main)));assert.equal(replay.clock.replayed,true);
  const changed=await expect(d.request(first,null),409);assert.equal(changed.error,'attendance_operation_conflict');assert.equal(d.authState().consumed,true);
  await expect(d.request(first,d.selected(slots.main),null,{featureEnabled:()=>false}),403);assert.equal(d.authState().consumed,true);
  const paused={entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}})};
  const pauseRead=await expect(d.request(null,null,first.operationId,paused));assert.deepEqual(pauseRead.adoption,result.adoption);
  const pauseReplay=await expect(d.request(first,d.selected(slots.main),null,paused));assert.equal(pauseReplay.clock.replayed,true);
  assert.deepEqual(d.counts(),firstCounts);await d.oldClock();
  pass('fresh PIN verification recovers original identity selection and approval on feature rollback or platform pause without duplicate facts');
  phase='cancel-and-device';d.resetAuthBudget();d.cancel(slots.main);
  const cancelled=await expect(d.request(null,null,first.operationId));assert.equal(cancelled.association.currentCancelled,true);assert.deepEqual(cancelled.adoption,result.adoption);
  const deniedArgs=d.sqlInput(d.lease(),null,null,first.operationId);
  exec(`begin;update public.merchant_attendance_terminals set revoked_at=clock_timestamp(),revoked_by='${d.owner}' where id='${d.terminal}';set local role service_role;
    do $revoked$ begin begin perform ${pinScheduleExpression(deniedArgs)};raise assert_failure;exception when others then if sqlerrm<>'attendance_terminal_denied' then raise;end if;end;end;$revoked$;reset role;rollback;`);
  assert.equal(d.rawPin(deniedArgs).adoption.status,'adopted');assert.equal(d.authState().consumed,true);
  pass('cancellation keeps saved adoption while PIN recovery still rejects a currently revoked terminal');
  phase='statuses';for(const [slot,status,reason] of [[null,'unselected',null],[slots.alternate,'not_approved','approval_missing'],[slots.legacy,'unverified','publication_missing'],[slots.main,'unverified','cancelled']]){
    d.resetAuthBudget();const r=await expect(d.request(d.command(),slot?d.selected(slot):null));assert.equal(r.adoption.status,status);assert.equal(r.adoption.reason,reason);assert.equal(r.adoption.approval,null);await d.oldClock();
  }
  pass('unselected unapproved unpublished and cancelled plans preserve real clock events without fabricated approvals');
  phase='legacy';d.resetAuthBudget();const legacyCommand=d.command(),old=await d.oldClock('clock_in',legacyCommand),legacy=await expect(d.request(null,null,old.receipt.operationId));
  assert.equal(legacy.association,null);assert.equal(legacy.adoption,null);const oldCounts=d.counts();
  await expect(d.request(legacyCommand,null),409);assert.deepEqual(d.counts(),oldCounts);assert.equal(d.authState().consumed,true);await d.oldClock();
  pass('legacy original PIN receipt remains readable and is not backfilled by the new protocol; old clock-out still succeeds');
  phase='bound';d.resetAuthBudget();const bindingBefore=d.counts().bindings;
  const bound=await expect(d.request(d.command(),null,null,{bindRules:()=>true}));assert.equal(bound.adoption.status,'unselected');assert.equal(d.counts().bindings,bindingBefore+1);await d.oldClock();
  pass('optional133 PIN rule binding remains atomic with mandatory new relation and adoption');
  phase='business-denial';d.resetAuthBudget();const stableCounts=d.counts();
  for(const [selection,error,status] of [[d.selected(slots.other),'attendance_access_denied',403],[{slotId:slots.alternate.id,revision:999},'attendance_invalid_request',400]]){
    const rejected=await expect(d.request(d.command(),selection),status);assert.equal(rejected.error,error);assert.deepEqual(d.counts(),stableCounts);assert.equal(d.authState().consumed,true);
    const a=d.calls.filter(c=>c.name===pinScheduleRpc).at(-1).args;assert.equal(d.rawPin(a).error,'attendance_pin_denied');
  }
  await expect(d.request(d.command(),null,null,paused),403);assert.equal(d.authState().consumed,true);assert.deepEqual(d.counts(),stableCounts);
  pass('known business denials roll back event receipt and sidecars while consuming the verified lease exactly once');
  phase='identity';d.resetAuthBudget();const identityArgs=d.sqlInput(d.lease(),null,null,first.operationId);
  exec(`begin;update public.merchant_enterprise_employees set auth_user_id='${id(97)}' where merchant_id='${site}' and id='${employee}';set local role service_role;
    do $identity$ declare r jsonb;begin r:=${pinScheduleExpression(identityArgs)};assert r->>'error' in('attendance_access_denied','attendance_worker_changed');end;$identity$;reset role;rollback;`);
  assert.equal(d.rawPin(identityArgs).adoption.status,'adopted');assert.equal(d.authState().consumed,true);
  pass('current employee auth binding mismatch cannot disclose original PIN relation or approval');
  phase='locks';d.resetAuthBudget();const raceCommand=d.command(),raceLease=d.lease(),writeArgs=d.sqlInput(raceLease,raceCommand,d.selected(slots.race));
  const preview=d.raw(d.query(slots.race)),approval=d.approvalCommand(preview,170990),q=d.query(slots.race,'approve',approval.operationId);
  const holder=`reset role;${d.guard}set local role service_role;select ${planRuleApprovalsExpression(q,d.owner,approval)};`;
  const waiter=`reset role;${d.guard}savepoint probe;set local role service_role;do $adopted$ declare r jsonb;begin r:=${pinScheduleExpression(writeArgs)};
    assert r->'adoption'->'approval'->>'operationId'='${approval.operationId}';assert r->'adoption'->'approval'->>'sourceSha256'='${approval.expectedFingerprint}';end;$adopted$;reset role;rollback to savepoint probe;`;
  exec(`begin;${holder}${waiter}rollback;`);
  const approvalRace=await lifecycleRace({connect:native.connect,query:native.query,sql:scope.sql},holder,waiter);assert(approvalRace.witnessed);assert.equal(approvalRace.right.error,null);
  assert.equal(d.rawPin(d.sqlInput(raceLease)).clock.employeeId,employee);
  d.resetAuthBudget();const cancelLease=d.lease(),cancel=d.cancelCommand(slots.cancelAfter),cancelArgs=d.sqlInput(cancelLease,d.command(),d.selected(slots.cancelAfter));
  const cancelHolder=`reset role;${d.guard}set local role service_role;select ${d.cancelExpression(cancel)};`;
  const cancelWaiter=`reset role;${d.guard}savepoint probe;set local role service_role;do $cancelled$ declare r jsonb;begin r:=${pinScheduleExpression(cancelArgs)};
    assert r->'association'->>'reason'='cancelled';assert r->'adoption'->>'status'='unverified';end;$cancelled$;reset role;rollback to savepoint probe;`;
  exec(`begin;${cancelHolder}${cancelWaiter}rollback;`);
  const cancelRace=await lifecycleRace({connect:native.connect,query:native.query,sql:scope.sql},cancelHolder,cancelWaiter);assert(cancelRace.witnessed);assert.equal(cancelRace.right.error,null);
  assert.equal(d.rawPin(d.sqlInput(cancelLease)).clock.employeeId,employee);assert.deepEqual(d.counts(),stableCounts);
  pass('exact blocked-PID witnesses prove actual140 approval and99 cancellation serialize with PIN worker clock');
  phase='unknown-storage-failure';d.resetAuthBudget();const failLease=d.lease(),failArgs=d.sqlInput(failLease,d.command(),d.selected(slots.race),null,{p_bind_rules:true});
  const atomicTables=['merchant_attendance_events','merchant_attendance_pin_clock_receipts','merchant_attendance_shift_schedule_relations','merchant_attendance_shift_plan_adoptions','merchant_attendance_shift_rule_bindings','merchant_attendance_shift_rule_sources'];
  const actualCounts=`jsonb_build_array(${atomicTables.map(t=>`(select count(*) from public.${t})`).join(',')})`,failureFacts=d.fingerprint();
  exec(`begin;alter table public.merchant_attendance_shift_plan_adoptions add constraint synthetic170_failure check(channel<>'pin') not valid;
    do $failure$ declare before_counts jsonb;begin before_counts:=${actualCounts};begin perform ${pinScheduleExpression(failArgs)};raise assert_failure;exception when check_violation then null;end;
    assert ${actualCounts}=before_counts,'synthetic_sidecar_partial_commit';
    assert exists(select 1 from public.merchant_attendance_pin_attempts where merchant_id='${site}' and terminal_id='${d.terminal}' and lease_id='${failLease.p_lease}');end;$failure$;rollback;`);
  assert.equal(d.fingerprint(),failureFacts);assert.equal(d.authState().consumed,false);
  // SQL-only proof reuses this fixture's actually issued lease after rolling back
  // the injected constraint. The UI never automatically reuses an auth lease.
  assert.equal(d.rawPin(failArgs).adoption.status,'adopted');assert.equal(d.authState().consumed,true);await d.oldClock();
  pass('unknown constraint failure preserves112 whole-call rollback including unconsumed lease and no partial six-table business result');
  phase='duplicate-lease';d.resetAuthBudget();const duplicateLease=d.lease(),duplicateArgs=d.sqlInput(duplicateLease,d.command(),null);
  const duplicateHolder=`reset role;${d.guard}set local role service_role;select ${pinScheduleExpression(duplicateArgs)};`;
  const duplicateWaiter=`reset role;${d.guard}set local role service_role;do $duplicate$ declare r jsonb;begin r:=${pinScheduleExpression(duplicateArgs)};assert r->>'error'='attendance_pin_denied';end;$duplicate$;`;
  exec(`begin;${duplicateHolder}${duplicateWaiter}rollback;`);const duplicateBefore=d.counts();
  const duplicateRace=await lifecycleRace({connect:native.connect,query:native.query,sql:scope.sql},duplicateHolder,duplicateWaiter);assert(duplicateRace.witnessed);assert.equal(duplicateRace.right.error,null);
  assert.deepEqual(d.counts(),{...duplicateBefore,events:duplicateBefore.events+1,receipts:duplicateBefore.receipts+1,relations:duplicateBefore.relations+1,adoptions:duplicateBefore.adoptions+1});
  const freshRecovery=await expect(d.request(null,null,duplicateArgs.p_request.command.operationId));assert.equal(freshRecovery.clock.receipt.operationId,duplicateArgs.p_request.command.operationId);await d.oldClock();
  pass('concurrent same lease accepts only one event; recovery succeeds only through a fresh real PIN verification');
  phase='web-onsite-compatibility';d.resetAuthBudget();
  const webCommand={operationId:id(170991),expectedWorkerId:worker,locationId:d.location,action:'clock_in',expectedSequence:d.sequence()};
  const webArgs={p_site_id:site,p_auth_user_id:auth,p_command:webCommand,p_operation_id:null,p_selection:d.selected(slots.alternate),p_allow_write:true,p_bind_rules:false};
  const web=JSON.parse(exec(`set local role service_role;select ${selfScheduleExpression(webArgs)};`));assert.equal(web.association.status,'linked');await d.oldClock();
  const onsite=await d.onsite.request(await d.onsite.command(),d.selected(slots.browser));assert.equal(onsite.status,200);assert.equal(onsite.body.adoption.status,'adopted');assert.equal(onsite.body.adoption.channel,'onsite');await d.onsite.oldClock();
  pass('expanded shared guards preserve original137 web selected clock and142 onsite adopted clock plus old safe clock-out');
  phase='ACL';exec(`do $acl$ declare r text;begin foreach r in array array['anon','authenticated','service_role'] loop
    assert not has_table_privilege(r,'public.merchant_attendance_shift_plan_adoptions','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
    assert has_function_privilege(r,'public.${pinScheduleRpc}(text,uuid,text,text,uuid,boolean,jsonb,boolean,jsonb,boolean,boolean)','EXECUTE')=(r='service_role');end loop;end;$acl$;`);
  for(const mutation of ['update public.merchant_attendance_shift_plan_adoptions set channel=channel','delete from public.merchant_attendance_shift_plan_adoptions','truncate public.merchant_attendance_shift_plan_adoptions'])
    exec(`begin;do $immutable$ begin begin ${mutation};raise assert_failure;exception when others then if sqlerrm<>'attendance_events_append_only' then raise;end if;end;end;$immutable$;rollback;`);
  const factsAfter=d.fingerprint();d.reapply();assert.equal(d.fingerprint(),factsAfter);assert.equal(d.previousDefinitions(),d.oldDefinitions);assert.equal(d.definitions(),d.installedDefinitions);assert.equal(d.tableCatalog(),d.installedCatalog);
  pass('private ACL append-only protections and repeat install preserve facts and protected function definitions');
  phase='browser';d.resetAuthBudget();const browser=browserCheck?await browserCheck(native,scope,d):null;
  return {checks,lockWitnesses:3,browser,productionAccess:false,realAuth:false,realPhysicalTerminal:false,newCluster:false};
}
async function locationCompatibility(native,scope){
  phase='location-compatibility';const d=await prepareLocationScheduleNative(native,scope);
  native.query(scope.sql(readFileSync(path.join(native.root,'scripts/supabase-migrations',onsiteScheduleMigration),'utf8')));
  const previous=pinScheduleOldDefinitions(d),definitions=previous(),facts=d.fingerprint(d.inventory().filter(t=>t!=='faolla_schema_migrations'));
  native.query(scope.sql(readFileSync(path.join(native.root,'scripts/supabase-migrations',pinScheduleMigration),'utf8')));
  assert.equal(d.fingerprint(d.inventory().filter(t=>t!=='faolla_schema_migrations')),facts);assert.equal(previous(),definitions);
  for(const [slot,status] of [[d.slots.main,'adopted'],[null,'unselected'],[d.slots.alternate,'not_approved'],[d.slots.legacy,'unverified']]){
    const c=await d.command(),r=await d.request(c,slot?d.selected(slot):null);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.adoption.status,status);assert.equal(r.body.adoption.channel,'location');
    const recovered=await d.request(null,null,c.operationId);assert.equal(recovered.status,200);assert.deepEqual(recovered.body.adoption,r.body.adoption);await d.oldClock();
  }
  assert.equal(previous(),definitions);native.pass('143 shared adapters preserve actual141 location adopted unselected unapproved unpublished and original recovery');
  return {checks:1,locationCases:4};
}
export async function runPinScheduleNative(args,browserCheck=null){
  let result,compatibility;const keys=['FAOLLA_ATTENDANCE_ONSITE_QR_SECRET','FAOLLA_ATTENDANCE_PIN_PEPPER'],previous=keys.map(k=>process.env[k]);
  process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET=randomBytes(32).toString('hex');process.env.FAOLLA_ATTENDANCE_PIN_PEPPER=randomBytes(32).toString('base64url');
  try{await runAttendanceLabelsReuse(args,async native=>{
    await withAttendanceConcurrencySandbox(native,async scope=>{result=await checkPinScheduleNative(native,scope,browserCheck);});
    await withAttendanceConcurrencySandbox(native,async scope=>{compatibility=await locationCompatibility(native,scope);});
  });return {...result,compatibility};}
  finally{keys.forEach((key,index)=>{if(previous[index]===undefined)delete process.env[key];else process.env[key]=previous[index];});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runPinScheduleNative(process.argv.slice(2),checkAttendancePinScheduleBrowser).then(result=>console.log(JSON.stringify(result))).catch(error=>{
  console.error(JSON.stringify({error:'pin_schedule_native_failed',phase,code:String(error).match(/attendance_[a-z_]+/)?.[0]??'local_check_failed',message:String(error),stack:String(error.stack).split('\n').slice(0,6)}));process.exitCode=1;});
