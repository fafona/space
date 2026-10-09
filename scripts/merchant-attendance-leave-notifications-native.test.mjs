// Pure construction/source checks. No simulated success JSON stands in for SQL.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {leaveNotificationsMigrationPlan,leaveNotificationsFingerprint,leaveNotificationQuery,leaveNotificationMark,leaveNotificationsNativeFailure,
  prepareLeaveNotificationsNativeFixture,checkAttendanceLeaveNotificationsNative} from './merchant-attendance-leave-notifications-native.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),source=readFileSync(new URL('./merchant-attendance-leave-notifications-native.mjs',import.meta.url),'utf8').replaceAll('\r\n','\n');
const scope={schema:'attendance_race_'+'d'.repeat(32),sql(s){return s.replaceAll('public.',this.schema+'.');}};
const tables=['merchants','faolla_schema_migrations','merchant_enterprise_roles','merchant_enterprise_employees','merchant_attendance_settings','merchant_attendance_workers','merchant_attendance_events',
  'merchant_attendance_leave_requests','merchant_attendance_leave_entries','merchant_attendance_leave_notifications','merchant_attendance_leave_notification_reads'];

test('inert imports expose fixture/check and reuse the exact prior owned base without starting services or inventing notice seed facts',()=>{
  assert.equal(typeof prepareLeaveNotificationsNativeFixture,'function');assert.equal(typeof checkAttendanceLeaveNotificationsNative,'function');
  assert(source.includes('await prepareLeaveNativeFixture(native,scope)'));assert(source.includes('assert.deepEqual(assertLifecycleSandbox('));
  assert(source.includes('owned.schema,scope.schema'));assert(source.includes('seededNotifications:0,seededReadMarkers:0'));
  assert.match(source,/if\(process\.argv\[1\]&&path\.resolve\(process\.argv\[1\]\)===fileURLToPath\(import\.meta\.url\)\)/);
  assert.match(source,/runAttendanceLabelsReuse\(args,native=>withAttendanceConcurrencySandbox/);assert.doesNotMatch(source,/spawn\(|pg_ctl|initdb|fetch\(|dotenv|disable trigger/i);
});
test('only complete original125 is installed with scoped schema/outer transaction adaptation and closed scope validation',()=>{
  const m=leaveNotificationsMigrationPlan(root,scope);assert.equal(m.name,'202610040125_merchant_attendance_leave_notifications.sql');
  assert.equal(m.source,readFileSync(new URL(`./supabase-migrations/${m.name}`,import.meta.url),'utf8'));
  assert.equal(m.body,m.source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''));assert.equal(m.statement,scope.sql(m.body));assert.doesNotMatch(m.statement,/\bpublic\./);
  assert.throws(()=>leaveNotificationsMigrationPlan(root,{...scope,schema:'public'}));
  for(const marker of ['leave_notifications_changed_old_definition_acl','leave_notifications_install_changed_old_facts','leave_notifications_reapply_changed_installation','leave_notifications_reapply_changed_facts'])assert(source.includes(marker));
});
test('dynamic fingerprints reject arbitrary identifiers and protect every table except exactly the four approved append-only fact tables',()=>{
  const full=leaveNotificationsFingerprint(tables),exclude=tables.slice(-4),protectedSql=leaveNotificationsFingerprint(tables,exclude);
  for(const t of tables)assert(full.includes(`from public.${t} r`));
  for(const t of tables.slice(0,-4))assert(protectedSql.includes(`from public.${t} r`));for(const t of exclude)assert(!protectedSql.includes(`from public.${t} r`));
  for(const list of [[...tables,'bad;select'],[...tables,'public.foreign'],[...tables,'merchants']])assert.throws(()=>leaveNotificationsFingerprint(list));
  assert.throws(()=>leaveNotificationsFingerprint(tables,['merchant_attendance_workers']));assert.throws(()=>leaveNotificationsFingerprint([]));
});
test('notice query exact6 and natural mark-read key exact2 match published contract and never invent a second operation ID',()=>{
  const q=leaveNotificationQuery(),command=leaveNotificationMark('00000000-0000-4000-8000-000000002102');
  assert.deepEqual(Object.keys(q),['siteId','expectedEmployeeId','expectedWorkerId','notificationId','beforeAt','beforeId']);assert.equal(q.expectedWorkerId,null);
  assert.deepEqual(Object.keys(command),['action','notificationId']);assert.equal(command.action,'mark_read');assert(!Object.hasOwn(command,'operationId'));
  assert(source.includes('const noticeQuery=leaveNotificationQuery,notices='));assert(source.includes('const notify=(query,command,allow=true,actor=base.owner)'));
  assert(source.includes('set local role service_role;select ${expression(rpc,query,command,allow,actor)}'));
});
test('normal events come from original submit/decision RPCs and explicit wrapper, with an independent decision-order oracle rather than notification-derived expected rows',()=>{
  for(const marker of ['old writer never captures','original receipt replay never backfills','older submitted request has newest decision','Object.keys(i).length===9',
    "approval.currentStatus,'cancelled'","cancelDetail.type,'approval_cancelled'",'25+8','requests:36,entries:73,notifications:34,readMarkers:2'])assert(source.includes(marker));
  assert(source.includes('const expected=[id(2004),id(2201),...Array.from({length:30},(_,n)=>id(2130-n)),id(2003)]'));
  assert.doesNotMatch(source,/insert into public\.merchant_attendance_leave_notifications\b|insert into public\.merchant_attendance_leave_(?:requests|entries)\b/);
});
test('capture-failure injection targets only an owned new-table CHECK and proves source remains submitted before outer rollback',()=>{
  assert(source.includes('alter table public.merchant_attendance_leave_notifications add constraint synthetic_capture_fault'));
  const section=source.slice(source.indexOf("phase='capture-failure-atomic-rollback'"),source.indexOf("phase='actual-original-wrapper-lock-races'"));
  assert(section.includes("denied('attendance_leave_invalid',capture(fault))"));assert(section.includes("assert a->'detail'->>'status'='submitted'"));
  assert(section.includes("operation_id='${fault.operationId}';`),'0'"));assert(section.includes('assert.equal(data.fingerprint(),faultBefore)'));
  assert.doesNotMatch(source,/create or replace function|alter table public\.merchant_attendance_leave_(?:requests|entries)|disable trigger/);
});
test('fresh reject/cancel after rebinding preserve original recipient identity with source RPCs, denial probes, restored-identity reads and full rollback',()=>{
  const probe=source.slice(source.indexOf("phase='fresh-capture-after-recipient-rebinding'"),source.indexOf("phase='strict-input-and-read-integrity'"));
  assert(probe.includes("expression('faolla_attendance_leave_v1',leaveQ(),submit(1401),true,employeeAuth)"));
  assert(probe.includes("expression('faolla_attendance_leave_v1',leaveQ(),submit(1402),true,employeeAuth)"));assert(probe.includes('legacy(reboundApprove)'));
  const originalApprove=probe.indexOf('select ${legacy(reboundApprove)}'),rebind=probe.indexOf('update public.merchant_attendance_workers'),capture=probe.indexOf('a:=${capture(reboundReject)}');
  assert(originalApprove<rebind&&rebind<capture);assert(probe.includes('a:=${capture(reboundCancel)}'));
  assert(probe.includes('rebound recipient cannot inherit freshly captured notices'));assert(probe.includes("denied('attendance_notification_not_found'"));
  assert(probe.includes('leaveNotificationMark(c.operationId)'));assert(probe.includes('count(*)=2 and bool_and'));
  for(const field of ['merchant_id','worker_id','employee_id','recipient_auth_user_id'])assert(probe.includes(field));
  assert(probe.includes('restored original identity can read fresh rejection'));assert(probe.includes('restored original identity can read fresh cancellation'));
  assert(probe.includes('end;$original_recipient$;rollback;'));assert(probe.includes('leave_notifications_precapture_rebind_probe_not_fully_rolled_back'));
  assert.doesNotMatch(probe,/insert into public\.merchant_attendance_leave_|update public\.merchant_attendance_leave_/);
});
test('three actual exact-blocker races cover both source orderings and one immutable marker with stable first read timestamp',()=>{
  for(const marker of ['await race(capture(first),legacy(first))','await race(legacy(second),capture(second))','await race(note(mark.notificationId,mark,true),note(mark.notificationId,mark,true))',
    'wrappedFirst.witnessed,true','oldFirst.witnessed,true','marked.witnessed,true','paused exact mark replay preserves first timestamp','exactLockWitnesses:3'])assert(source.includes(marker));
  assert(source.includes('lifecycleRace({connect:native.connect,query:native.query,sql:scope.sql}'));assert.doesNotMatch(source,/setTimeout|grant |disable trigger/);
  assert(source.includes('sourceDefinition(),data.sourceDefinitionBaseline'));assert(source.includes('groups')===false);
});
test('read probes cover full recipient identity, permission loss, inactive history, current-owner changes, ACL and safe diagnostics',()=>{
  for(const marker of ['same employee/worker new Auth cannot inherit notifications','new worker does not inherit old notices','unbound home is empty',
    'historical approver need not remain owner','inactive self-view-only profile may read history','attendance_notification_invalid','notification_private_privilege_allowed',
    'notification_helper_execute_allowed','leave_notifications_rollback_changed_facts','New synthetic inconsistent read only'])assert(source.includes(marker));
  assert.match(source,/end;\$checks\$;rollback;/);
  const e=leaveNotificationsNativeFailure(Error('ERROR: attendance_notification_invalid\nSECRET email/token\nPL/pgSQL function x line 12 at RAISE'));
  assert.equal(e.code,'attendance_notification_invalid');assert.equal(e.sourceLine,12);assert(!JSON.stringify(e).includes('SECRET'));
  assert.equal(leaveNotificationsNativeFailure(Error('ERROR: secret_password')).code,'local_check_failed');
});
