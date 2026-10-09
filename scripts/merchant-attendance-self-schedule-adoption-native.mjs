import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {runAttendanceLabelsReuse} from './merchant-attendance-choice-labels-reuse-native.mjs';
import {withAttendanceConcurrencySandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {prepareSelfScheduleAdoptionNative,selfScheduleAdoptionExpression as expression,selfScheduleAdoptionMigration,selfScheduleAdoptionOldDefinitions} from './fixtures/attendance-self-schedule-adoption-native.mjs';
import {prepareLocationScheduleNative} from './fixtures/attendance-location-schedule-native.mjs';
import {onsiteScheduleMigration} from './fixtures/attendance-onsite-schedule-native.mjs';
import {pinScheduleMigration} from './fixtures/attendance-pin-schedule-native.mjs';
import {planRuleApprovalsExpression} from './fixtures/attendance-plan-rule-approvals-native.mjs';
import {planCoverageExpression} from './fixtures/attendance-plan-coverage-native.mjs';
import {lifecycleId as id,lifecycleJson as json,lifecycleRace} from './merchant-attendance-lifecycle-native-support.mjs';
let phase='entry';
export async function checkSelfScheduleAdoptionNative(native,scope,browserCheck=null){
  phase='prepare';const d=await prepareSelfScheduleAdoptionNative(native,scope),{exec,site,auth,employee,worker,slots}=d;
  let checks=0;const pass=message=>{checks++;native.pass(message);};
  const expect=async(p,status=200)=>{const r=await p;assert.equal(r.status,status,JSON.stringify({body:r.body,sql:d.failures.at(-1)}));return r.body;};
  pass('144 three partial/repeated CHECK stages preserve business rows and all old function definitions except two approved adapters');
  phase='read';const before=d.fingerprint();
  const candidate=await expect(d.request());assert(candidate.choices.entries.some(s=>s.id===slots.main.id));assert.equal(candidate.adoption,null);
  const off=await expect(d.request(null,null,null,{featureEnabled:()=>false}));assert.equal(off.choices.entries.length,0);assert.equal(d.fingerprint(),before);
  pass('ordinary web candidate and feature-off GET make no data changes');
  phase='adopt';const first=d.command(),r=await expect(d.request(first,d.selected(slots.main)));
  assert.equal(r.association.status,'linked');assert.equal(r.adoption.status,'adopted');assert.equal(r.adoption.channel,'self');
  assert.deepEqual(r.adoption.approval,{operationId:d.mainApproval.operationId,revision:d.mainApproval.revision,sourceId:d.mainApproval.sourceId,sourceSha256:d.mainApproval.sourceSha256,recordedAt:d.mainApproval.recordedAt});
  assert.equal(r.adoption.employeeAuthUserId,auth);assert.equal(r.adoption.employeeId,employee);
  assert.deepEqual(d.counts(),{events:1,relations:1,adoptions:1,bindings:0,sources:0});
  const readersBefore=d.fingerprint();
  const shift=JSON.parse(exec(`set local role service_role;select public.faolla_attendance_shift_check_v1(${json({siteId:site,workerId:worker,startEventId:r.clock.receipt.id})},'${d.owner}');`));
  assert(JSON.stringify(shift).includes(r.clock.receipt.id));
  const coverage=JSON.parse(exec(`set local role service_role;select ${planCoverageExpression({siteId:site,workerId:worker,slotId:slots.main.id},d.owner)};`));
  assert(JSON.stringify(coverage).includes(r.clock.receipt.id));assert.equal(d.fingerprint(),readersBefore);
  pass('new real handler/137/111 atomically save web event selection actual140 reference; unchanged138/139 relation readers still work');
  phase='replay';const stable=d.counts(),paused={entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}})};
  assert.deepEqual((await expect(d.request(null,null,first.operationId,{featureEnabled:()=>false}))).adoption,r.adoption);
  assert.deepEqual((await expect(d.request(null,null,first.operationId,paused))).adoption,r.adoption);
  assert.equal((await expect(d.request(first,d.selected(slots.main)))).clock.replayed,true);
  for(const [command,selection] of [[{...first,expectedSequence:first.expectedSequence+1},d.selected(slots.main)],[first,null]])
    assert.equal((await expect(d.request(command,selection),409)).error,'attendance_operation_conflict');
  await expect(d.request(first,d.selected(slots.main),null,{featureEnabled:()=>false}),403);
  await expect(d.request(first,d.selected(slots.main),null,paused),403);assert.deepEqual(d.counts(),stable);await d.oldClock();
  pass('exact five-field original replay and read-only feature/platform-off recovery do not duplicate facts or allow paused POST');
  //140 deliberately freezes a selected plan once its shift exists. Reapprove
  //a different, not-yet-clocked plan through the real140 path, never bypass it.
  phase='new-approval';const newer=d.approve(slots.browser);assert.equal(newer.revision,d.browserApproval.revision+1);
  assert.deepEqual((await expect(d.request(null,null,first.operationId))).adoption,r.adoption);
  const next=await expect(d.request(d.command(),d.selected(slots.browser)));assert.equal(next.adoption.approval.operationId,newer.operationId);await d.oldClock();
  d.cancel(slots.main);const cancelled=await expect(d.request(null,null,first.operationId));assert.equal(cancelled.association.currentCancelled,true);assert.deepEqual(cancelled.adoption,r.adoption);
  pass('separate unstarted-plan reapproval and later cancellation never replace the first immutable approval reference');
  phase='statuses';for(const [slot,status,reason] of [[null,'unselected',null],[slots.alternate,'not_approved','approval_missing'],[slots.legacy,'unverified','publication_missing'],[slots.main,'unverified','cancelled']]){
    const a=await expect(d.request(d.command(),slot?d.selected(slot):null));assert.equal(a.adoption.status,status);assert.equal(a.adoption.reason,reason);assert.equal(a.adoption.approval,null);await d.oldClock();
  }
  pass('none unapproved unpublished and cancelled selections retain real clock-ins without fabricated adoption');
  phase='selection-edges';const outside=d.publication([[`${d.day(3)}T09:00:00.000Z`,`${d.day(3)}T09:30:00.000Z`]]).slots[0];
  for(const [slot,setup,patch,status,reason] of [[outside,'',{},'unverified','outside_window'],
    [slots.alternate,`update public.merchant_attendance_workers set default_location_id='${d.secondLocation}',version=2 where id='${worker}';`,{locationId:d.secondLocation},'unverified','location_changed'],
    [slots.overnight,'',{},'not_approved','approval_missing']]){
    const c=d.command('clock_in',patch),args=d.input(c,d.selected(slot)),recovery=d.input(null,null,c.operationId,{p_allow_write:false}),facts=d.fingerprint();
    exec(`begin;${setup}set local role service_role;do $edge$ declare r jsonb;s jsonb;begin r:=${expression(args)};
      assert r->'adoption'->>'status'='${status}';assert r->'adoption'->>'reason'='${reason}';
      assert r->'association'->'slot'->>'startAt'='${slot.startAt}';assert r->'association'->'slot'->>'endAt'='${slot.endAt}';
      s:=${expression(recovery)};assert s->'adoption'=r->'adoption';end;$edge$;reset role;rollback;`);
    assert.equal(d.fingerprint(),facts);
  }
  pass('window-excluded changed-location and overnight explicit plans retain their original decision on read-only recovery');
  phase='legacy';for(const selected of [false,true]){
    const c=d.command(),old=selected?await expect(d.legacyRequest(c,d.selected(slots.alternate))):{clock:await d.oldClock('clock_in',c)};
    const legacy=await expect(d.request(null,null,old.clock.receipt.operationId));assert.equal(legacy.adoption,null);assert.equal(legacy.association?.status??null,selected?'linked':null);
    const counts=d.counts();await expect(d.request(c,selected?d.selected(slots.alternate):null),409);assert.deepEqual(d.counts(),counts);await d.oldClock();
  }
  pass('both plain111 and selected137 historical receipts remain readable but new POST cannot backfill approval');
  phase='bound';const bindings=d.counts().bindings;
  const bound=await expect(d.request(d.command(),null,null,{bindRules:()=>true}));assert.equal(bound.adoption.status,'unselected');assert.equal(d.counts().bindings,bindings+1);await d.oldClock();
  pass('optional133 binding and mandatory137/144 sidecars coexist with original safe clock-out');
  phase='business-denial';const denialCounts=d.counts();
  for(const [selection,status,error] of [[d.selected(slots.other),403,'attendance_access_denied'],[{slotId:slots.alternate.id,revision:999},400,'attendance_invalid_request']]){
    assert.equal((await expect(d.request(d.command(),selection),status)).error,error);assert.deepEqual(d.counts(),denialCounts);
  }
  const args=d.input(null,null,first.operationId);
  exec(`begin;update public.merchant_enterprise_employees set auth_user_id='${id(97)}' where merchant_id='${site}' and id='${employee}';set local role service_role;
    do $identity$ begin begin perform ${expression(args)};raise assert_failure;exception when others then if sqlerrm not in('attendance_access_denied','attendance_worker_changed') then raise;end if;end;end;$identity$;reset role;rollback;`);
  assert.deepEqual(d.counts(),denialCounts);
  pass('foreign selections wrong revisions and current auth rebinding fail closed without partial new records');
  phase='locks';const approval=d.approvalCommand(d.raw(d.query(slots.race)),171990),q=d.query(slots.race,'approve',approval.operationId);
  const approvalHolder=`reset role;${d.guard}set local role service_role;select ${planRuleApprovalsExpression(q,d.owner,approval)};`;
  const raceArgs=d.input(d.command(),d.selected(slots.race));
  const approvalWaiter=`reset role;${d.guard}savepoint probe;set local role service_role;do $adopted$ declare r jsonb;begin r:=${expression(raceArgs)};
    assert r->'adoption'->'approval'->>'operationId'='${approval.operationId}';assert r->'adoption'->'approval'->>'sourceSha256'='${approval.expectedFingerprint}';end;$adopted$;reset role;rollback to savepoint probe;`;
  exec(`begin;${approvalHolder}${approvalWaiter}rollback;`);
  const aRace=await lifecycleRace({connect:native.connect,query:native.query,sql:scope.sql},approvalHolder,approvalWaiter);assert(aRace.witnessed);assert.equal(aRace.right.error,null);
  const cancel=d.cancelCommand(slots.cancelAfter),cancelArgs=d.input(d.command(),d.selected(slots.cancelAfter));
  const cancelHolder=`reset role;${d.guard}set local role service_role;select ${d.cancelExpression(cancel)};`;
  const cancelWaiter=`reset role;${d.guard}savepoint probe;set local role service_role;do $cancelled$ declare r jsonb;begin r:=${expression(cancelArgs)};
    assert r->'adoption'->>'reason'='cancelled';assert r->'adoption'->>'status'='unverified';end;$cancelled$;reset role;rollback to savepoint probe;`;
  exec(`begin;${cancelHolder}${cancelWaiter}rollback;`);
  const cRace=await lifecycleRace({connect:native.connect,query:native.query,sql:scope.sql},cancelHolder,cancelWaiter);assert(cRace.witnessed);assert.equal(cRace.right.error,null);
  assert.deepEqual(d.counts(),denialCounts);
  pass('exact blocked-PID witnesses show140 approval and99 cancellation serialized against actual ordinary web clock transaction');
  phase='atomic';const atomicTables=['merchant_attendance_events','merchant_attendance_shift_schedule_relations','merchant_attendance_shift_plan_adoptions','merchant_attendance_shift_rule_bindings','merchant_attendance_shift_rule_sources'];
  const countSql=`jsonb_build_array(${atomicTables.map(t=>`(select count(*) from public.${t})`).join(',')})`,failureArgs=d.input(d.command(),d.selected(slots.race),null,{p_bind_rules:true}),failureFacts=d.fingerprint();
  exec(`begin;alter table public.merchant_attendance_shift_plan_adoptions add constraint synthetic171_failure check(channel<>'self') not valid;
    do $failure$ declare before_counts jsonb;begin before_counts:=${countSql};begin perform ${expression(failureArgs)};raise assert_failure;exception when check_violation then null;end;
    assert ${countSql}=before_counts,'synthetic_self_partial_commit';end;$failure$;rollback;`);
  assert.equal(d.fingerprint(),failureFacts);
  pass('injected mandatory adoption failure rolls back all five event relation adoption binding source tables before outer cleanup');
  phase='duplicate';const duplicateArgs=d.input(d.command(),null),duplicateBefore=d.counts();
  const dupHolder=`reset role;${d.guard}set local role service_role;select ${expression(duplicateArgs)};`;
  const dupWaiter=`reset role;${d.guard}set local role service_role;do $duplicate$ declare r jsonb;begin r:=${expression(duplicateArgs)};assert r->'clock'->>'replayed'='true';assert r->'adoption'->>'status'='unselected';end;$duplicate$;`;
  exec(`begin;${dupHolder}${dupWaiter}rollback;`);
  const dupRace=await lifecycleRace({connect:native.connect,query:native.query,sql:scope.sql},dupHolder,dupWaiter);assert(dupRace.witnessed);assert.equal(dupRace.right.error,null);
  assert.deepEqual(d.counts(),{...duplicateBefore,events:duplicateBefore.events+1,relations:duplicateBefore.relations+1,adoptions:duplicateBefore.adoptions+1});await d.oldClock();
  pass('same-original-number race records exactly one clock-in relation and adoption while the other request replays');
  phase='channels';let otherChannelCases=0;
  for(const channel of [d.onsite,d.pinChannel])for(const [slot,status] of [[slots.browser,'adopted'],[null,'unselected'],[slots.alternate,'not_approved'],[slots.legacy,'unverified']]){
    if(channel===d.pinChannel)channel.resetAuthBudget();
    const c=await channel.command(),selection=slot?d.selected(slot):null,other=await channel.request(c,selection);assert.equal(other.status,200,JSON.stringify(other.body));assert.equal(other.body.adoption.status,status);
    const read=await channel.request(null,null,c.operationId);assert.equal(read.status,200);assert.deepEqual(read.body.adoption,other.body.adoption);
    const cross=d.command('clock_in',{operationId:c.operationId,expectedSequence:c.expectedSequence}),crossCounts=d.counts();
    await expect(d.request(null,null,c.operationId),409);await expect(d.request(cross,selection),409);assert.deepEqual(d.counts(),crossCounts);await channel.oldClock();otherChannelCases++;
  }
  // Even old onsite/PIN entries without a relation/adoption are not self entries.
  for(const channel of [d.onsite,d.pinChannel]){
    if(channel===d.pinChannel)channel.resetAuthBudget();const c=await channel.command(),old=await channel.oldClock('clock_in',c),counts=d.counts();
    await expect(d.request(null,null,old.receipt.operationId),409);
    await expect(d.request(d.command('clock_in',{operationId:c.operationId,expectedSequence:c.expectedSequence}),null),409);assert.deepEqual(d.counts(),counts);await channel.oldClock();
  }
  pass('all eight actual onsite/PIN adoption status/recovery cases survive144; old and new other-channel receipts cannot be relabelled self');
  phase='acl';exec(`do $acl$ declare r text;begin foreach r in array array['anon','authenticated','service_role'] loop
    assert not has_table_privilege(r,'public.merchant_attendance_shift_plan_adoptions','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
    assert has_function_privilege(r,'public.faolla_attendance_self_schedule_adoption_v1(text,uuid,jsonb,jsonb,uuid,boolean,boolean)','EXECUTE')=(r='service_role');end loop;end;$acl$;`);
  for(const mutation of ['update public.merchant_attendance_shift_plan_adoptions set channel=channel','delete from public.merchant_attendance_shift_plan_adoptions','truncate public.merchant_attendance_shift_plan_adoptions'])
    exec(`begin;do $immutable$ begin begin ${mutation};raise assert_failure;exception when others then if sqlerrm<>'attendance_events_append_only' then raise;end if;end;end;$immutable$;rollback;`);
  const facts=d.fingerprint();d.reapply();assert.equal(d.fingerprint(),facts);assert.equal(d.previousDefinitions(),d.oldDefinitions);assert.equal(d.definitions(),d.installedDefinitions);assert.equal(d.tableCatalog(),d.installedCatalog);
  pass('ACL append-only guards complete migration reapply and every protected old function remain intact after native cases');
  phase='browser';const browser=browserCheck?await browserCheck(native,scope,d):null;
  return {checks,lockWitnesses:3,otherChannelCases,browser,productionAccess:false,realAuthentication:false,newCluster:false};
}
async function locationCompatibility(native,scope){
  phase='location-compatibility';const d=await prepareLocationScheduleNative(native,scope);
  for(const name of [onsiteScheduleMigration,pinScheduleMigration])native.query(scope.sql(readFileSync(path.join(native.root,'scripts/supabase-migrations',name),'utf8')));
  const previous=selfScheduleAdoptionOldDefinitions(d),definitions=previous(),facts=d.fingerprint(d.inventory().filter(t=>t!=='faolla_schema_migrations'));
  native.query(scope.sql(readFileSync(path.join(native.root,'scripts/supabase-migrations',selfScheduleAdoptionMigration),'utf8')));
  assert.equal(d.fingerprint(d.inventory().filter(t=>t!=='faolla_schema_migrations')),facts);assert.equal(previous(),definitions);
  for(const [slot,status] of [[d.slots.main,'adopted'],[null,'unselected'],[d.slots.alternate,'not_approved'],[d.slots.legacy,'unverified']]){
    const c=await d.command(),r=await d.request(c,slot?d.selected(slot):null);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.adoption.status,status);assert.equal(r.body.adoption.channel,'location');
    const recovered=await d.request(null,null,c.operationId);assert.equal(recovered.status,200);assert.deepEqual(recovered.body.adoption,r.body.adoption);
    const args={p_site_id:d.site,p_auth_user_id:d.auth,p_command:null,p_selection:null,p_operation_id:c.operationId,p_allow_write:false,p_bind_rules:false};
    assert.throws(()=>d.exec(`set local role service_role;select ${expression(args)};`),/attendance_operation_conflict/);await d.oldClock();
  }
  assert.equal(previous(),definitions);native.pass('144 shared helpers preserve all four actual141 location status/recovery cases and reject self-channel misrouting');
  return {checks:1,locationCases:4};
}
export async function runSelfScheduleAdoptionNative(args,browserCheck=null){
  let result,compatibility;const keys=['FAOLLA_ATTENDANCE_ONSITE_QR_SECRET','FAOLLA_ATTENDANCE_PIN_PEPPER'],previous=keys.map(k=>process.env[k]);
  process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET=randomBytes(32).toString('hex');process.env.FAOLLA_ATTENDANCE_PIN_PEPPER=randomBytes(32).toString('base64url');
  try{await runAttendanceLabelsReuse(args,async native=>{
    await withAttendanceConcurrencySandbox(native,async scope=>{result=await checkSelfScheduleAdoptionNative(native,scope,browserCheck);});
    await withAttendanceConcurrencySandbox(native,async scope=>{compatibility=await locationCompatibility(native,scope);});
  });return {...result,compatibility};}
  finally{keys.forEach((key,index)=>{if(previous[index]===undefined)delete process.env[key];else process.env[key]=previous[index];});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const browser=process.argv.includes('--without-browser')?null:(await import('./fixtures/attendance-self-schedule-adoption-browser.mjs')).checkAttendanceSelfScheduleAdoptionBrowser;
  runSelfScheduleAdoptionNative(process.argv.slice(2).filter(v=>v!=='--without-browser'),browser).then(result=>console.log(JSON.stringify(result))).catch(error=>{
    console.error(JSON.stringify({error:'self_schedule_adoption_native_failed',phase,message:String(error),stack:String(error.stack).split('\n').slice(0,6)}));process.exitCode=1;});
}
