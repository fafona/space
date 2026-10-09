//Pure construction/static guardrails only. No native runner is invoked.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {employmentLifecycleNativePlan,employmentLifecycleCommandFromDetail,employmentLifecycleExpression} from './fixtures/attendance-employment-lifecycle-native.mjs';
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const driver=read('./merchant-attendance-employment-lifecycle-native.mjs'),fixture=read('./fixtures/attendance-employment-lifecycle-native.mjs'),history=read('./fixtures/attendance-employment-lifecycle-history-native.mjs');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const has=(source,parts)=>parts.forEach(part=>assert(source.includes(part),part));
test('bounded deterministic fixture identities remain distinct and reject ambiguous scope',()=>{
  const plans=Array.from({length:20},(_,n)=>employmentLifecycleNativePlan(n,id(99)));
  assert.equal(new Set(plans.map(p=>p.site)).size,20);
  assert.equal(new Set(plans.flatMap(p=>[p.employee,p.auth,p.worker,p.role,p.location])).size,100);
  for(const invalid of [-1,20,1.5,NaN])assert.throws(()=>employmentLifecycleNativePlan(invalid,id(99)));
  assert.throws(()=>employmentLifecycleNativePlan(0,'not-an-owner'));
});
test('command construction uses all14 current CAS fields and never chooses another period or identity',()=>{
  const detail={worker:{id:id(1),employeeId:id(2),employeeAuthUserId:id(3),version:8,employeeVersion:9},settingsVersion:10,revision:1,today:'2026-10-06',
    periods:[{id:id(4),startsOn:'2000-01-01',endsOn:'2026-10-05'}],suspension:{id:id(5),generation:2}};
  const c=employmentLifecycleCommandFromDetail(detail,'rejoin',id(6),'Explicit fixture reason');
  assert.deepEqual(c,{action:'rejoin',operationId:id(6),workerId:id(1),employeeId:id(2),employeeAuthUserId:id(3),expectedWorkerVersion:8,expectedEmployeeVersion:9,
    expectedSettingsVersion:10,expectedRevision:1,expectedPeriodId:id(4),suspensionId:id(5),expectedGeneration:2,expectedDate:'2026-10-06',reason:'Explicit fixture reason'});
  assert.throws(()=>employmentLifecycleCommandFromDetail({...detail,suspension:null},'close',id(6)));
  assert.throws(()=>employmentLifecycleCommandFromDetail(detail,'restore',id(6)));
  assert.match(employmentLifecycleExpression({siteId:'99990160'},id(99),null,false),/faolla_attendance_employment_lifecycle_v1\(.+,null,false\)$/);
});
test('inert driver completes original193 reapply before166 and delegates existing baseline ownership',()=>{
  has(driver,['node --import tsx scripts/merchant-attendance-employment-lifecycle-native.mjs --run-local --directory <existing-stopped-directory> [--with-browser]',
    'including no-browser runs','runApplicationDelegationNative(args,null,async context=>','prepareAttendanceEmployeeManagement(context.native,context.scope)',
    'const prior193=await verifyAccountSuspensionNative(prepared);','const employment=await verifyEmploymentLifecycleNative(prepared,browserCheck);',
    'if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))']);
  assert(driver.indexOf('await verifyAccountSuspensionNative(prepared)')<driver.indexOf('await verifyEmploymentLifecycleNative(prepared,browserCheck)'));
  assert.doesNotMatch(driver+fixture+history,/\binitdb\b|\bcreatedb\b|DISABLE\s+(?:TRIGGER|ROW)|session_replication_role|npm run build/i);
});
test('166 install and reentry protect old facts/definitions except the two approved adaptations',()=>{
  has(fixture,["proname not in('faolla_attendance_admin_v1','faolla_attendance_account_detail_v1')",
    'assert.equal(d.fingerprint(protectedTables),beforeInstall)','assert.equal(oldDefinitions(),originalDefinitions)',
    'assert.equal(all(),installedFacts)','assert.equal(d.definitions(),installedDefinitions)','assert.equal(d.tableCatalog(),installedCatalog)',
    'assert.deepEqual(acl,{service:true,anon:false,authenticated:false,privateTable:false})']);
});
test('real civil-date chain preserves inactive intent and rejects reopening before the new start date',()=>{
  has(fixture,["for(const [n,active] of [[0,true],[1,false]])","zone:'Etc/GMT+12'","settingsValues('Etc/GMT-14')",
    'assert.equal(before.suspension.wasActive,active)','assert.equal(notStarted.canRestore,false)',"notStarted.blockers.includes('employment_closed')",
    'restored.result.receipt.workerActive,active','waitedOvernight:false','oldPeriods);',
    "admin(p,'worker',workerValues(p,true,rejoin.expectedDate,p.name+' explicitly enabled'))"]);
  assert.doesNotMatch(fixture,/update\s+public\.merchant_attendance_employment_operations|insert\s+into\s+public\.merchant_attendance_events/i);
});
test('future blockers and past pending use actual old submit/approve/cancel paths',()=>{
  has(fixture,['faolla_attendance_schedule_evidenced_v1','faolla_attendance_leave_v1','faolla_attendance_work_arrangement_v1',
    "['leave','schedule','trip']","x.kind==='leave'&&x.status==='approved'","expectedRevision:2,reason:'Synthetic196 explicit leave cancellation'",
    "reason:'Synthetic196 explicit trip rejection'","past.operationId))).detail.status,'submitted'",'assert.deepEqual(ready.pending.items,[])']);
});
test('races use existing exactPID helper and assert receipt identity plus concrete losing outcomes',()=>{
  has(fixture,['lifecycleRace({connect:()=>native.connect(),query:sql=>native.query(sql),sql:scope.sql}',
    'assert(raced.witnessed&&!raced.right.error)','assert.deepEqual(a.receipt,b.receipt)',
    'assert(restoreRace.witnessed&&restoreRace.right.error)','attendance_account_suspension_changed',
    'assert(clockRace.witnessed&&clockRace.right.error)','realConcurrentWaits:3']);
});

test('targeted final ledger CHECK proves exact23514 rollback and restores its original constraint catalog',()=>{
  has(fixture,["constraint='attendance_employment_fixture_fail_196'",'check(operation_id<>${quote(command.operationId)}::uuid) not valid',
    'set local role service_role;do $el_late_insert$',"raise exception 'el_expected_final_ledger_failure_missing'",
    'exception when check_violation then','fault_constraint=CONSTRAINT_NAME,fault_state=RETURNED_SQLSTATE',
    "fault_state='23514' and fault_constraint=${quote(constraint)}","assert.equal(all(),baseline,'el_failed_close_all_tables_unchanged')",
    'drop constraint ${constraint};set constraints all immediate','assert.equal(constraints(),originalConstraints)',
    "read(u,q(u,'recover',{operationId:command.operationId})).receipt,null"]);
  assert(fixture.indexOf('check(operation_id<>${quote(command.operationId)}')<fixture.indexOf('do $el_late_insert$'));
  assert(fixture.indexOf('drop constraint ${constraint}')<fixture.indexOf("const tomorrow=new Date(Date.now()+86400000)"));
});

test('close publication race reserves n9 and verifies no schedule receipts slots or evidence survived',()=>{
  has(fixture,['all,settings,call,reject}=p,u=seed(9)',"racePrefix+'select '+expression(publish)+';'",
    'assert(raced.witnessed&&raced.right.error);assert.match(String(raced.right.error),/attendance_version_conflict/)',
    'assert.equal(winner.receipt.operationId,command.operationId)',"assert.equal(read(u).detail.state,'closed')",
    "reject(expression({...publish,operationId:next(),expectedSettingsVersion:settings(u).version}),'attendance_schedule_worker_invalid')",
    'assert.equal(d.fingerprint(protectedNames),protectedBefore)',
    "['merchant_attendance_schedule_commands','merchant_attendance_schedule_slots','merchant_attendance_schedule_publication_evidence']",
    'assert.deepEqual(empty.entries,[])','not a claim that the employment-range branch ran']);
});
test('113 starts through real location service and retains explicit safeFinish/replay while worker stays paused',()=>{
  has(fixture,['executeAttendanceLocationClock','faolla_attendance_location_policy_draft_v1','faolla_attendance_location_notice_v1',
    "assert.equal(name,'faolla_attendance_location_clock_v2')",'position:{latitude:37.3,longitude:-5.9,accuracyMeters:10,capturedAt:new Date().toISOString()}',
    'safeFinish:true,position:null,positionFailure:null','closed.receiptGate.safeFinish,true','assert.deepEqual(replayed.receipt,closed.receipt)','assert.equal(all(),stable)']);
  assert.doesNotMatch(fixture,/p_assertion\s*:\s*\{/);
});
test('historical premise is explicitly synthetic, INSERT-only with constraints and full rollback',()=>{
  has(history,['synthetic INSERTs','ONE transaction','insert into public.merchant_attendance_employment_operations',
    'public.faolla_attendance_employment_hash_v1','set local role service_role','faolla_attendance_account_suspensions_v1','faolla_attendance_self_v1',
    "'elh_new_shift_not_old_tail'","'elh_original_history_unchanged'",'faolla_attendance_period_report_v2',
    "prefix+'set constraints all immediate;rollback;'","assert.equal(all(),baseline,'elh_all_facts_rollback')",'assert.equal(indexes(),oldIndexes)',
    'actualHistoricalClose:false','await employmentLifecycleCommandFingerprint(site,actual.command)']);
  assert.doesNotMatch(history,/\bupdate\s+public\.|\bdelete\s+from\s+public\./i);
});
test('actual handler/service port has one fresh write and GET recovery bypasses current entitlement only',()=>{
  has(fixture,['executeEmploymentLifecycle(input,service)',"['p_allow_write','p_auth_user_id','p_command','p_query']",
    "const recovered=await handle(get(recover),{enabled:()=>false,entitlement:async()=>{throw Error('recover must not read current entitlement');}})",
    'assert.equal(calls.filter(x=>x.write).length,1)',"assert.equal((await absent.json()).receipt,null)",
    'handleAdmin:request=>handleAttendanceAdmin(request','executeAttendanceAdmin(input,adminService)','createBrowserSubject,clearFutureBlocker']);
});
