// Construction contracts, not execution evidence for PostgreSQL.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {qualifyAttendanceSandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {selfRequestsMigrationPlan,selfRequestsNativePlan,selfRequestsNativeFailure,selfRequestsQueryInput} from './merchant-attendance-self-requests-native.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const owned={schema:'attendance_race_'+'a'.repeat(32),owner:'postgres',oid:1234,tableOid:2345,marker:'faolla-synthetic-concurrency:11111111-1111-4111-8111-111111111111'};
const scope={schema:owned.schema,sql:s=>qualifyAttendanceSandbox(s,owned.schema)};
const tables=['merchants','faolla_schema_migrations','merchant_attendance_events','merchant_attendance_correction_entries','merchant_attendance_revision_requests','merchant_attendance_missing_requests','merchant_attendance_missing_entries'];
const make=()=>selfRequestsNativePlan(owned,tables,{now:Date.UTC(2026,9,4,12)});
const source=readFileSync(new URL('./merchant-attendance-self-requests-native.mjs',import.meta.url),'utf8');

test('migration plan reuses complete original source with only transaction and owned schema adaptation',()=>{
  const plan=selfRequestsMigrationPlan(root,scope);assert.deepEqual(plan.map(r=>Number(r.name.slice(0,12))%1000),[89,96,98,99,100,101,102,103,118]);
  for(const migration of plan){assert.equal(migration.source,readFileSync(path.join(root,'scripts/supabase-migrations',migration.name),'utf8'));
    assert.equal(migration.body,migration.source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''));assert.equal(migration.statement,scope.sql(migration.body));assert.doesNotMatch(migration.statement,/\bpublic\./);}
  assert.throws(()=>selfRequestsMigrationPlan(root,{...scope,schema:'public'}));assert.throws(()=>selfRequestsMigrationPlan(root,{...scope,sql:s=>s}));
});

test('construction strictly validates namespace ownership, OIDs, marker and all fingerprint table identifiers',()=>{
  const plan=make();assert(plan.guard.includes(owned.marker));assert.match(plan.guard,/c\.oid=2345 and n\.oid=1234/);
  for(const patch of [{schema:'public'},{owner:'service_role'},{oid:0},{tableOid:0},{marker:'synthetic'}])assert.throws(()=>selfRequestsNativePlan({...owned,...patch},tables));
  for(const values of [[],tables.slice(1),[...tables,tables[0]],[...tables,'bad;drop table merchants'],[...tables,'auth.users']])assert.throws(()=>selfRequestsNativePlan(owned,values));
  assert.throws(()=>selfRequestsNativePlan(owned,tables,{now:NaN}));for(const t of tables)assert(plan.fingerprint.includes(`from public.${t} r`));
});

test('same-worker additions use real correction/missing writers and disclose exactly four raw synthetic punches',()=>{
  const plan=make(),seed=plan.seed.join('\n');assert.match(seed,/begin;reset role;do \$owned\$/);assert.match(seed,/self_requests_extra_seed_absent/);
  assert.equal((seed.match(/'clock_in','web'/g)||[]).length,2);assert.equal((seed.match(/'clock_out','web'/g)||[]).length,2);
  assert.equal((seed.match(/do \$actual_correction\$/g)||[]).length,3);assert.equal((seed.match(/do \$actual_missing\$/g)||[]).length,4);
  assert.match(seed,/set local role service_role;do \$actual_correction\$/);assert.match(seed,/faolla_attendance_correction_decide_v2/);
  assert.match(seed,/"action":"revise"/);assert(seed.includes(`"expectedWorkerId":"${plan.workerId}"`));
  assert.doesNotMatch(seed,/insert into public\.merchant_attendance_(correction_decisions|revision_decisions|effect_versions)\b/);
  assert.doesNotMatch(seed,/update public\.merchant_attendance_(events|correction_entries|revision_requests|missing_entries)\b/);
  assert.doesNotMatch(seed,/disable trigger|session_replication_role|drop constraint|drop not null|statement_timeout|pg_sleep/);
  assert(plan.seed.length<20);assert.match(seed,/Synthetic pre-existing declaration/);assert(plan.oldAt.endsWith('.000123Z'));
});

test('the closed68-row oracle independently fixes IDs/statuses/terminal operations and includes each kind at one shared UUID',()=>{
  const plan=make();assert.equal(plan.oracleCases.length,68);assert.deepEqual([...new Set(plan.oracleCases.map(r=>r.status))].sort(),['approved','rejected','submitted','withdrawn']);
  assert.deepEqual(plan.oracleCases.filter(r=>r.requestId===plan.ids.tie).map(r=>r.kind),['correction','revision','missing']);
  assert.deepEqual(['correction','revision','missing'].map(k=>plan.oracleCases.filter(r=>r.kind===k).length),[6,55,7]);
  assert.doesNotMatch(plan.oracle,/faolla_attendance_self_requests|when|not exists/i);assert.match(plan.oracle,/order by at desc,rank desc,request desc/);
  assert.match(plan.oracle,/'status','approved'/);assert.match(plan.oracle,/operation_id='/);
  assert.match(plan.seed.join('\n'),/do \$ties\$ declare t timestamptz:=clock_timestamp\(\)/);
  assert.match(source,/assert.deepEqual\(items,data.expected\(kind,status\)\)/);assert.match(source,/assert.deepEqual\(pages.map\(p=>p.scanned\),\[50,18\]\)/);
});

test('the exact8-field RPC query and bounded walker retain filtered empty pages and all three cursor fields',()=>{
  const q=selfRequestsQueryInput();assert.equal(Object.keys(q).length,8);assert.equal(q.kind,'all');assert.equal(q.status,'all');
  assert.equal(q.asOf,null);for(const key of ['cursorAt','cursorKind','cursorId'])assert.equal(q[key],null);
  assert.equal(selfRequestsQueryInput({kind:'missing'}).kind,'missing');assert.equal(q.kind,'all');
  assert.match(source,/assert.equal\(empty.scanned,50\);assert.deepEqual\(empty.items,\[\]\);assert\(empty.nextCursor\)/);
  assert.match(source,/cursorKind:page.nextCursor.kind/);assert.match(source,/assert.equal\(page.asOf,first.asOf\)/);
  assert.match(source,/pinned asOf retains original state/);assert.match(source,/fresh asOf sees actual terminal/);
  assert.match(make().withdrawSql,/set local role service_role/);assert.match(make().withdrawSql,/faolla_attendance_missing_v1/);
});

test('corruption/lifecycle scenarios preserve append-only data, rollback and check fingerprints around reads',()=>{
  assert.match(source,/create temp table self_requests_before\(value text\) on commit drop/);assert.match(source,/self_requests_read_mutated_facts/);
  assert.match(source,/end;\$unchanged\$;rollback;/);assert.match(source,/self_requests_scenario_changes_not_rolled_back/);
  assert.match(source,/replacement worker inherits none/);assert.match(source,/replacement auth inherits none/);
  assert.match(source,/badRevision/);assert.match(source,/badStart/);assert.match(source,/badMissing/);assert.match(source,/exception when not_null_violation/);
  assert.doesNotMatch(source,/disable trigger|session_replication_role|drop constraint|drop not null/);assert.equal(make().labels.length,9);
});

test('runner is import-safe, reuses unmodified lawful125 prepare and only executes new reads as service_role',()=>{
  assert.match(source,/prepareSelfRevisionHistoryNativeFixture\(native,scope\)/);assert.doesNotMatch(source,/prior\.plan\.seed|filter\(.*seed|replace\(.*seed/);
  assert.match(source,/assert.deepEqual\(assertLifecycleSandbox\(raw\),owned/);assert.match(source,/self_requests_reapply_changed_owner_acl_index/);
  assert.match(source,/self_requests_reapply_changed_facts/);assert.match(source,/runAttendanceLabelsReuse\(args,native=>withAttendanceConcurrencySandbox\(native/);
  assert.match(source,/path.resolve\(process.argv\[1\]\)===path.resolve\(fileURLToPath\(import.meta.url\)\)/);
  assert.match(source,/self_requests_browser_execute_allowed/);assert.match(source,/self_requests_private_table_read_allowed/);
  assert.doesNotMatch(source,/initdb|create database|spawn\(|execFile|fetch\(|grant select|grant all|\.env|process\.env/);
});

test('ACL probes preserve061 service-role event SELECT and deny direct reads only for the four private request ledgers',()=>{
  const acl=source.slice(source.indexOf('exec(`set local role service_role;do $private$'),source.indexOf("assert.equal(data.fingerprint(),before,'self_requests_scenario_changes_not_rolled_back')"));
  assert(acl.includes("has_table_privilege(current_user,'public.merchant_attendance_events','SELECT')"));
  assert.match(acl,/perform 1 from public\.merchant_attendance_events limit 1;/);
  const privateTables=acl.match(/\$\{\[([^\]]+)\]\.map\(t=>/)?.[1];assert(privateTables);
  assert.deepEqual([...privateTables.matchAll(/'([^']+)'/g)].map(match=>match[1]),[
    'merchant_attendance_correction_entries','merchant_attendance_revision_requests','merchant_attendance_missing_requests','merchant_attendance_missing_entries']);
  assert.doesNotMatch(privateTables,/merchant_attendance_events/);
  const foundation=readFileSync(path.join(root,'scripts/supabase-migrations/202609290061_merchant_attendance_foundation.sql'),'utf8');
  assert.match(foundation,/grant select on public\.merchant_attendance_events to service_role;/);
  assert(make().labels.some(label=>label.includes('four request ledgers stay private while061 event SELECT is preserved')));
});

test('diagnostics return only an approved code, known phase and numeric source line',()=>{
  assert.deepEqual(selfRequestsNativeFailure(new Error('ERROR: attendance_self_requests_invalid\nCONTEXT: PL/pgSQL function synthetic(text) line 17 at RAISE\nSQL: private values')),
    {error:'self_requests_native_failed',phase:'entry',code:'attendance_self_requests_invalid',sourceLine:17});
  assert.deepEqual(selfRequestsNativeFailure(new Error('ERROR: private_token\nperson@example.test')),
    {error:'self_requests_native_failed',phase:'entry',code:'local_check_failed',sourceLine:null});
});
