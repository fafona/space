// Pure construction/source checks, not claims of live SQL acceptance.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {leaveMigrationPlan,leaveNativePlan,leaveQueryInput,leaveNativeSubmit,leaveNativeAction,leaveNativeFailure,
  prepareLeaveNativeFixture,checkAttendanceLeaveNative} from './merchant-attendance-leave-native.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),source=readFileSync(new URL('./merchant-attendance-leave-native.mjs',import.meta.url),'utf8').replaceAll('\r\n','\n');
const owned={schema:'attendance_race_'+'b'.repeat(32),oid:300,tableOid:301,owner:'postgres',marker:'faolla-synthetic-concurrency:00000000-0000-4000-8000-000000000001'};
const scope={schema:owned.schema,sql:s=>s.replaceAll('public.',owned.schema+'.').replace(/(search_path\s*=\s*pg_catalog,\s*)public\b/g,`$1${owned.schema}`)};
const tables=['merchants','faolla_schema_migrations','merchant_enterprise_roles','merchant_enterprise_employees','merchant_attendance_settings','merchant_attendance_workers','merchant_attendance_employment_periods',
  'merchant_attendance_events','merchant_attendance_leave_requests','merchant_attendance_leave_entries'];
const plan=()=>leaveNativePlan(owned,tables,'2026-10-03');

test('imports expose prepare/check without starting services, using only caller-owned existing-cluster machinery',()=>{
  assert.equal(typeof prepareLeaveNativeFixture,'function');assert.equal(typeof checkAttendanceLeaveNative,'function');
  assert.match(source,/if\(process\.argv\[1\]&&path\.resolve\(process\.argv\[1\]\)===fileURLToPath\(import\.meta\.url\)\)/);
  assert.match(source,/runAttendanceLabelsReuse\(args,native=>withAttendanceConcurrencySandbox/);
  assert.doesNotMatch(source,/spawn\(|pg_ctl|initdb|fetch\(|dotenv|disable trigger/i);
});
test('only121 and122 original complete sources are installed with schema/outer-transaction adaptation',()=>{
  const ms=leaveMigrationPlan(root,scope);assert.deepEqual(ms.map(m=>m.name),['202610030121_merchant_attendance_leave_permission.sql','202610030122_merchant_attendance_leave_requests.sql']);
  for(const m of ms){assert.equal(m.source,readFileSync(new URL(`./supabase-migrations/${m.name}`,import.meta.url),'utf8'));
    assert.equal(m.body,m.source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''));assert.equal(m.statement,scope.sql(m.body));assert.doesNotMatch(m.statement,/\bpublic\./);}
  assert.throws(()=>leaveMigrationPlan(root,{...scope,schema:'public'}));
  assert.match(source,/exec\(migration\[1\]\.body\);assert\.equal\(installed\(\),definition/);
});
test('every execution binds exact owned namespace/table OIDs, owner and random marker, with a closed identifier inventory',()=>{
  const p=plan();for(const marker of [owned.schema,owned.marker,'n.oid=300','c.oid=301',"n.nspowner::regrole::text='postgres'"])assert(p.guard.includes(marker));
  for(const patch of [{schema:'public'},{oid:0},{tableOid:2.5},{owner:'service_role'},{marker:'not-owned'}])assert.throws(()=>leaveNativePlan({...owned,...patch},tables,'2026-10-03'));
  for(const list of [[...tables,'arbitrary;select'],[...tables,'public.foreign'],[...tables,'merchants']])assert.throws(()=>leaveNativePlan(owned,list,'2026-10-03'));
  assert.match(source,/assert\.deepEqual\(assertLifecycleSandbox\(raw\),owned/);assert.match(source,/start\.test\(source\)\?source\.replace\(start,`\$1reset role;\$\{guard\}/);
});
test('minimal fresh seed is identities/settings/employment only, with leave permission separate from request/clock and no business requests/events',()=>{
  const p=plan();assert(p.seed.includes("assert not exists(select 1 from public.merchants)"));
  assert.deepEqual([...p.seed.matchAll(/insert into public\.(\w+)/g)].map(m=>m[1]),['merchants','merchant_enterprise_roles','merchant_enterprise_employees','merchant_attendance_settings','merchant_attendance_workers','merchant_attendance_employment_periods']);
  assert.doesNotMatch(p.seed,/attendance_(?:leave_requests|leave_entries|events|schedule)|attendance\.self\.(?:clock|request)/);
  assert(p.seed.includes("array['enterprise.view','attendance.self.view','attendance.self.leave']"));assert(p.seed.includes("'UTC',false,false"));
  assert.equal(p.time.startAt,'2026-10-05T08:00:00.000Z');assert.equal(p.time.endAt,'2026-10-05T16:00:00.000Z');assert.equal(p.time.pastStartAt,'2026-08-24T08:00:00.000Z');
  assert.match(source,/seededLeaveRequests:0,seededAttendanceEvents:0/);
});
test('query/submit/action factories preserve exact6/8/5 fields and canonical minute UTC precision',()=>{
  const p=plan(),q=leaveQueryInput(),submit=leaveNativeSubmit(1001,p.time.startAt,p.time.endAt);
  assert.deepEqual(Object.keys(q),['siteId','access','requestId','operationId','beforeAt','beforeId']);assert.equal(q.access,'self');
  assert.equal(Object.keys(submit).length,8);assert.equal(submit.expectedWorkerId,p.workerId);assert.equal(submit.expectedSettingsVersion,1);assert.equal(submit.timeZone,'UTC');
  for(const at of [submit.startAt,submit.endAt])assert.equal(Date.parse(at)%60000,0);
  for(const action of ['withdraw','approve','reject','cancel']){const c=leaveNativeAction(2001,action,submit.operationId);assert.equal(Object.keys(c).length,5);assert.equal(c.expectedRevision,action==='cancel'?2:1);}
  assert.equal(leaveQueryInput('owner').access,'owner');
});
test('actual RPC produces all requests/terminal states with independently fixed counts and original-receipt recovery, not simulated responses',()=>{
  assert.match(source,/for\(let n=1001;n<=1028;n\+\+\)/);assert.match(source,/JSON\.parse\(exec\(`set local role service_role;select \$\{expression/);
  assert(source.includes("['submit','approve','cancel']"));assert(source.includes("new Set(['submitted','withdrawn','approved','rejected','cancelled'])"));
  assert(source.includes('Array.from({length:28},(_,n)=>id(1028-n))'));assert(source.includes('Object.keys(r).length===8'));
  assert(source.includes('call(q(),submit(n),false).receipt'));assert(source.includes('requests:28,entries:36,exactLockWitnesses:2'));
  assert.doesNotMatch(source,/insert into public\.merchant_attendance_leave_(?:requests|entries)|update public\.merchant_attendance_leave_(?:requests|entries)/);
  assert(source.includes('leave_writers_changed_old_business'));
});
test('negative and boundary scenarios use rolled-back real SQL with current identity/owner, independent overlap and no additional privileged grants',()=>{
  for(const marker of ['attendance_leave_overlap','attendance_leave_binding_changed','attendance_leave_outside_employment','attendance_worker_changed','attendance_version_conflict',
    'attendance_platform_paused','attendance_leave_not_found','inactive worker may withdraw','view-only retains receipts','owner approval does not require current self.leave',
    'exclusive midnight end','touching endpoints do not overlap','cancel releases approved interval','leave_browser_execute_allowed','leave_private_privilege_allowed'])assert(source.includes(marker));
  assert.match(source,/end;\$checks\$;rollback;/);assert.match(source,/leave_negative_and_writer_probes_not_rolled_back/);
  assert.doesNotMatch(source,/grant |reset.*attempt|disable trigger|update public\.merchant_attendance_events/i);
  const p=plan();for(const t of tables)assert(p.fingerprint.includes(`from public.${t} r`));
  for(const t of tables.filter(t=>!['merchant_attendance_leave_requests','merchant_attendance_leave_entries'].includes(t)))assert(p.protectedFingerprint.includes(`from public.${t} r`));
  for(const t of ['merchant_attendance_leave_requests','merchant_attendance_leave_entries'])assert(!p.protectedFingerprint.includes(`from public.${t} r`));
});
test('diagnostics expose only known codes/phase/source line, not SQL, private reasons or credentials',()=>{
  const e=leaveNativeFailure(Error('ERROR: attendance_leave_overlap\nSECRET reason/token\nPL/pgSQL function x line 12 at RAISE'));
  assert.equal(e.code,'attendance_leave_overlap');assert.equal(e.sourceLine,12);assert(!JSON.stringify(e).includes('SECRET'));
  assert.equal(leaveNativeFailure(Error('ERROR: secret_password')).code,'local_check_failed');
  assert.equal(plan().labels.length,9);assert(plan().labels.every(label=>!label.includes('concurrency')));
});
