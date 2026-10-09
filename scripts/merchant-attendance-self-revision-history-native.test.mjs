// Pure construction/ownership tests. They do not assert PostgreSQL execution.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {qualifyAttendanceSandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {selfRevisionHistoryMigrationPlan,selfRevisionHistoryNativePlan,selfRevisionHistoryNativeFailure} from './merchant-attendance-self-revision-history-native.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const owned={schema:'attendance_race_'+'a'.repeat(32),owner:'postgres',oid:1234,tableOid:2345,
  marker:'faolla-synthetic-concurrency:11111111-1111-4111-8111-111111111111'};
const scope={schema:owned.schema,sql:s=>qualifyAttendanceSandbox(s,owned.schema)};
const tables=['merchants','faolla_schema_migrations','merchant_enterprise_employees','merchant_enterprise_roles','merchant_attendance_workers',
  'merchant_attendance_events','merchant_attendance_revision_requests','merchant_attendance_revision_decisions',
  'merchant_attendance_correction_entries','merchant_attendance_correction_effects','merchant_attendance_settings','merchant_attendance_effect_versions'];
const plan=()=>selfRevisionHistoryNativePlan(owned,tables,{now:Date.UTC(2026,9,3,12)});
const source=readFileSync(new URL('./merchant-attendance-self-revision-history-native.mjs',import.meta.url),'utf8');

test('native dependencies retain exact original source except transaction wrapping and owned schema qualification',()=>{
  const migrations=selfRevisionHistoryMigrationPlan(root,scope);
  assert.deepEqual(migrations.map(m=>m.name.match(/_(\w+)\.sql$/)?.[1]),[
    'merchant_attendance_self_context','merchant_attendance_period_report','merchant_attendance_scoped_period_report',
    'merchant_attendance_period_export','merchant_attendance_revision_requests','merchant_attendance_revision_review',
    'merchant_attendance_versioned_reports','merchant_attendance_revision_decision_core','merchant_attendance_revision_cycles',
    'merchant_attendance_revision_history','merchant_attendance_self_revision_history']);
  for(const migration of migrations){
    assert.equal(migration.source,readFileSync(path.join(root,'scripts/supabase-migrations',migration.name),'utf8'));
    assert.equal(migration.body,migration.source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''));
    assert.equal(migration.statement,scope.sql(migration.body));
    assert.doesNotMatch(migration.statement,/\bpublic\./);
  }
  assert.throws(()=>selfRevisionHistoryMigrationPlan(root,{...scope,schema:'public'}));
  assert.throws(()=>selfRevisionHistoryMigrationPlan(root,{...scope,sql:s=>s}));
});

test('pure plan requires owned namespace OIDs, owner, marker and safe complete table names',()=>{
  const p=plan();assert.match(p.guard,/c\.oid=2345 and n\.oid=1234/);
  assert(p.guard.includes(owned.marker)&&p.guard.includes(owned.schema));
  for(const patch of [{schema:'public'},{owner:'service_role'},{oid:0},{tableOid:0},{marker:'synthetic'}])
    assert.throws(()=>selfRevisionHistoryNativePlan({...owned,...patch},tables));
  for(const names of [[],tables.slice(1),[...tables,tables[0]],[...tables,'bad;drop table merchants'],[...tables,'auth.users']])
    assert.throws(()=>selfRevisionHistoryNativePlan(owned,names));
  assert.throws(()=>selfRevisionHistoryNativePlan(owned,tables,{now:NaN}));
});

test('fixture constructs only explicit synthetic raw attendance and original writers for valid root/terminal ledgers',()=>{
  const p=plan(),seed=p.seed.join('\n');
  assert.match(seed,/begin;reset role;do \$owned\$/);
  assert.match(seed,/not exists\(select 1 from public\.merchants\)/);
  assert.equal((seed.match(/insert into public\.merchant_attendance_events/g)||[]).length,1);
  assert.equal((seed.match(/'clock_in','web'/g)||[]).length,4);
  assert.equal((seed.match(/'clock_out','web'/g)||[]).length,4);
  assert.match(seed,/2026-09-25T08:00:00\.000123Z/);
  assert.equal((seed.match(/perform public\.faolla_attendance_correction_self_v3/g)||[]).length,4);
  assert.equal((seed.match(/perform public\.faolla_attendance_correction_decide_v1/g)||[]).length,4);
  assert.equal((seed.match(/perform public\.faolla_attendance_revision_decide_v2/g)||[]).length,2);
  assert.equal((seed.match(/'action','withdraw'/g)||[]).length,51);
  assert.equal((seed.match(/'action','submit'/g)||[]).length,56);
  assert.doesNotMatch(seed,/insert into public\.merchant_attendance_(?:correction_entries|correction_effects|revision_requests|revision_decisions|effect_versions)\b/);
  assert.doesNotMatch(seed,/disable trigger|session_replication_role|drop constraint|alter .*not null|statement_timeout/);
});

test('fifty-four expected own candidates cross two roots and make the first approved page empty without losing its cursor',()=>{
  const p=plan();assert.equal(p.roots.length,2);assert.equal(p.expected.all.length,54);
  assert.equal(new Set(p.expected.all).size,54);assert.equal(p.expected.withdrawn.length,51);
  for(const status of ['submitted','approved','rejected'])assert.equal(p.expected[status].length,1);
  assert.deepEqual(p.expected.all,[...p.expected.submitted,...p.expected.withdrawn,...p.expected.rejected,...p.expected.approved]);
  assert.equal(p.expected.all.slice(0,50).filter(id=>p.expected.approved.includes(id)).length,0);
  assert.equal(p.expected.all.slice(50).filter(id=>p.expected.approved.includes(id)).length,1);
  assert(p.steps.some(s=>s.includes('empty nonfinal status page')&&s.includes("a->>'scanned'='50'")));
  assert(p.steps.some(s=>s.includes('exact54 order without omissions/duplicates')&&s.includes("a->'asOf'")));
  assert(p.steps.some(s=>s.includes('exact thirteen item fields')));
});

test('read-only acceptance uses service role with full-table fingerprints and permits paused inactive view-only history',()=>{
  const p=plan(),seed=p.seed.join('\n'),steps=p.steps.join('\n');
  assert.match(seed,/time_zone,enabled,web_clock_enabled\) values\('99990001','UTC',false,false\)/);
  assert.match(seed,/default_location_id,active\) values/);
  assert.match(seed,/permissions=array\['enterprise.view','attendance.self.view'\]/);
  for(const name of tables)assert(p.fingerprint.includes(`from public.${name} t`));
  const reads=p.steps.filter(s=>s.includes('self_revision_service_role_required'));
  assert(reads.length>=10);
  for(const read of reads){
    assert.match(read,/set local role service_role;do \$read\$/);
    assert(read.includes('self_revision_read_changed_business_facts'));
    assert(read.indexOf('set value=')<read.indexOf('set local role service_role'));
  }
  assert.match(steps,/same asOf excludes subsequent terminal write exactly/);
  assert.match(steps,/fresh asOf observes actual later withdrawal/);
  assert.match(steps,/reset role;[\s\S]*select '[\s\S]*rollback;$/);
  assert(p.seed.length+p.steps.length<=100,'existing bounded querySteps limit');
});

test('negative cases retain original constraints, explicitly rollback lifecycle mutations and check both identity bindings',()=>{
  const p=plan(),steps=p.steps.join('\n');
  for(const scenario of ['employee_disabled','role_off','role_view','binding_change','auth_change']){
    assert(steps.includes(`savepoint ${scenario};`));assert(steps.includes(`rollback to savepoint ${scenario};`));
  }
  assert.match(steps,/new binding inherits no former applicant data/);
  assert.match(steps,/same employee different account inherits none/);
  assert.match(steps,/replacement employee inherits none/);
  assert.equal((steps.match(/exception when not_null_violation/g)||[]).length,4);
  assert.doesNotMatch(steps,/disable trigger|session_replication_role|drop constraint|drop not null/);
  assert(steps.includes('set local role anon;')&&steps.includes('set local role authenticated;'));
  assert.equal((steps.match(/self_revision_private_table_read_allowed/g)||[]).length,4);
  assert.match(steps,/attendance_worker_changed/);assert.match(steps,/attendance_invalid_request/);
});

test('runner is import safe, reuses only existing guarded sandbox and checks116 reapplication without table grants',()=>{
  assert.match(source,/runAttendanceLabelsReuse\(args,native=>withAttendanceConcurrencySandbox\(native,/);
  assert.match(source,/path\.resolve\(process\.argv\[1\]\)===path\.resolve\(fileURLToPath\(import.meta.url\)\)/);
  assert.match(source,/self_revision_reapply_changed_function_owner_acl_index/);
  assert.match(source,/self_revision_reapply_changed_facts/);
  assert.match(source,/self_revision_native_changes_not_rolled_back/);
  assert.match(source,/assert\.deepEqual\(assertLifecycleSandbox\(raw\),owned/);
  assert.doesNotMatch(source,/initdb|create database|spawn\(|execFile|fetch\(|grant select|grant all|\.env|process\.env/);
});

test('failure diagnostics expose only fixed phase/code/numeric source line and no raw SQL or credentials',()=>{
  const safe=selfRevisionHistoryNativeFailure(new Error("ERROR: attendance_access_denied\nCONTEXT: PL/pgSQL function synthetic(text) line 47 at RAISE\npassword=secret email=person@example.test"));
  assert.deepEqual(safe,{error:'self_revision_history_native_failed',phase:'entry',code:'attendance_access_denied',sourceLine:47});
  assert.deepEqual(selfRevisionHistoryNativeFailure(new Error('ERROR: invented_secret\nSQL statement: private payload')),
    {error:'self_revision_history_native_failed',phase:'entry',code:'local_check_failed',sourceLine:null});
});
