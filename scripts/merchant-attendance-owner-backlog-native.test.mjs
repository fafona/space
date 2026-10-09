// Construction tests only: PostgreSQL/native acceptance is a separate run.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {qualifyAttendanceSandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {ownerBacklogMigrationPlan,ownerBacklogNativePlan,ownerBacklogNativeFailure,ownerBacklogQueryInput} from './merchant-attendance-owner-backlog-native.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const owned={schema:'attendance_race_'+'a'.repeat(32),owner:'postgres',oid:1234,tableOid:2345,
  marker:'faolla-synthetic-concurrency:11111111-1111-4111-8111-111111111111'};
const scope={schema:owned.schema,sql:s=>qualifyAttendanceSandbox(s,owned.schema)};
const tables=['merchants','faolla_schema_migrations','merchant_attendance_correction_entries','merchant_attendance_revision_requests',
  'merchant_attendance_missing_requests','merchant_attendance_missing_entries','merchant_attendance_events','merchant_enterprise_employees',
  'merchant_enterprise_roles','merchant_attendance_workers','merchant_attendance_settings'];
const make=()=>ownerBacklogNativePlan(owned,tables,{now:Date.UTC(2026,9,4,12)});
const source=readFileSync(new URL('./merchant-attendance-owner-backlog-native.mjs',import.meta.url),'utf8');

test('migration construction reuses original source with only transaction and owned-schema adaptations',()=>{
  const plan=ownerBacklogMigrationPlan(root,scope);
  assert.deepEqual(plan.map(r=>Number(r.name.slice(0,12))%1000),[89,96,98,99,100,101,102,103,117]);
  for(const migration of plan){
    assert.equal(migration.source,readFileSync(path.join(root,'scripts/supabase-migrations',migration.name),'utf8'));
    assert.equal(migration.body,migration.source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''));
    assert.equal(migration.statement,scope.sql(migration.body));assert.doesNotMatch(migration.statement,/\bpublic\./);
  }
  assert.throws(()=>ownerBacklogMigrationPlan(root,{...scope,schema:'public'}));
  assert.throws(()=>ownerBacklogMigrationPlan(root,{...scope,sql:s=>s}));
});

test('construction requires owned OIDs, owner, marker and a closed safe table identifier inventory',()=>{
  const plan=make();assert(plan.guard.includes(owned.marker)&&plan.guard.includes(owned.schema));
  assert.match(plan.guard,/c\.oid=2345 and n\.oid=1234/);
  for(const patch of [{schema:'public'},{owner:'service_role'},{oid:0},{tableOid:0},{marker:'synthetic'}])
    assert.throws(()=>ownerBacklogNativePlan({...owned,...patch},tables));
  for(const values of [[],tables.slice(1),[...tables,tables[0]],[...tables,'bad;drop table merchants'],[...tables,'auth.users']])
    assert.throws(()=>ownerBacklogNativePlan(owned,values));
  assert.throws(()=>ownerBacklogNativePlan(owned,tables,{now:NaN}));
  for(const table of tables)assert(plan.fingerprint.includes(`from public.${table} r`));
});

test('historical seeds explicitly distinguish50 closed declarations from real RPC terminal evidence',()=>{
  const plan=make(),seed=plan.seed.join('\n');
  assert.match(seed,/begin;reset role;do \$owned\$/);
  assert.match(seed,/owner_backlog_extra_seed_must_be_absent/);
  assert.equal((seed.match(/insert into public\.merchant_attendance_correction_entries/g)||[]).length,102);
  assert.equal((seed.match(/Synthetic pre-existing historical withdrawal',/g)||[]).length,50);
  assert.equal((seed.match(/'clock_in','web'/g)||[]).length,3);
  assert.equal((seed.match(/'clock_out','web'/g)||[]).length,3);
  assert(plan.seed.length<25);
  assert.equal(Date.UTC(2026,9,4,12)-Date.parse(plan.oldAt),60*86400000-8*3600000);
  assert(plan.oldAt.endsWith('.000123Z'));
  assert.doesNotMatch(seed,/update public\.merchant_attendance_(events|correction_entries|revision_requests|missing_entries)\b/);
  assert.doesNotMatch(seed,/disable trigger|session_replication_role|drop constraint|drop not null|statement_timeout|pg_sleep/);
  assert.match(seed,/set local role service_role;do \$actual_missing\$/);
  for(const action of ['approve','withdraw','reject'])assert(seed.includes(`'action','${action}'`));
  assert.match(seed,/"action":"revise"/);
  assert.doesNotMatch(seed,/insert into public\.merchant_attendance_(correction_decisions|revision_decisions|effect_versions)\b/);
});

test('same-ID/time fixture and independent eight pending identities are not derived from new RPC results',()=>{
  const plan=make(),seed=plan.seed.join('\n'),tie=plan.ids.tie;
  assert.match(seed,/do \$tie\$ declare t timestamptz:=clock_timestamp\(\)/);
  assert(seed.includes(`'${tie}','${tie}'`));
  assert.deepEqual(plan.expectedIds.correction,[plan.ids.oldPending,tie]);
  assert.equal(plan.expectedIds.revision.length,3);assert.equal(plan.expectedIds.missing.length,3);
  assert.equal(Object.values(plan.expectedIds).flat().filter(value=>value===tie).length,3);
  assert.doesNotMatch(plan.oracle,/owner_backlog|not exists|revision=2|decision|status/i);
  assert.match(plan.oracle,/order by recorded_at,rank,request_id/);
  assert.match(plan.oracle,/where merchant_id='99990001'/);
  assert.match(source,/assert\.deepEqual\(all,expected\.all\)/);
  assert.match(source,/tie\.slice\(n\+1\)/);
  assert(source.includes('new Set(tie.map(r=>r.submittedAt)).size,1'));
});

test('pinned query template has exact null cursor triplet and independent per-call values',()=>{
  const first=ownerBacklogQueryInput();assert.deepEqual(first,{kind:'all',asOf:null,cursorAt:null,cursorKind:null,cursorId:null});
  const second=ownerBacklogQueryInput({kind:'missing'});assert.equal(first.kind,'all');assert.equal(second.kind,'missing');
  assert.match(source,/first=page;assert.equal\(page.scanned,50\);assert.deepEqual\(page.items,\[\]\)/);
  assert.match(source,/assert.equal\(page.asOf,first.asOf\)/);
  assert.match(source,/cursorKind:page.nextCursor.kind/);
  assert.match(source,/pinned asOf keeps previous pending/);
  assert.match(source,/fresh read sees actual terminal/);
  assert.match(make().withdrawSql,/set local role service_role/);
  assert.match(make().withdrawSql,/faolla_attendance_missing_v1/);
});

test('all lifecycle and corruption probes rollback without bypassing append-only or identity constraints',()=>{
  assert.match(source,/create temp table backlog_before\(value text\) on commit drop/);
  assert.match(source,/insert into backlog_before values\(\$\{plan.fingerprint\}\)/);
  assert.match(source,/owner_backlog_read_mutated_business_facts/);
  assert.match(source,/end;\$unchanged\$;rollback;/);
  assert.match(source,/owner_backlog_scenarios_not_rolled_back/);
  assert.match(source,/inactive rebound historic backlog visible/);
  assert.match(source,/update public\.merchants set user_id/);
  assert.match(source,/Synthetic inconsistent historical identity/);
  assert.match(source,/explicitly advance once/);
  assert.doesNotMatch(source,/disable trigger|session_replication_role|drop constraint|drop not null/);
  assert.equal(make().labels.length,9);
});

test('runner is import-safe and reuses the established fixture/cluster with repeated owned guards and service-only reads',()=>{
  assert.match(source,/prepareSelfRevisionHistoryNativeFixture\(native,scope\)/);
  assert.match(source,/assert.deepEqual\(assertLifecycleSandbox\(raw\),owned/);
  assert.match(source,/owner_backlog_reapply_changed_owner_acl_definition/);
  assert.match(source,/owner_backlog_reapply_changed_facts/);
  assert.match(source,/runAttendanceLabelsReuse\(args,native=>withAttendanceConcurrencySandbox\(native/);
  assert.match(source,/path.resolve\(process.argv\[1\]\)===path.resolve\(fileURLToPath\(import.meta.url\)\)/);
  assert.match(source,/for\(const role of \['anon','authenticated'\]\)/);
  assert.match(source,/owner_backlog_private_table_read_allowed/);
  assert.doesNotMatch(source,/initdb|create database|spawn\(|execFile|fetch\(|grant select|grant all|\.env|process\.env/);
});

test('diagnostics disclose only phase, approved code and numeric source line',()=>{
  assert.deepEqual(ownerBacklogNativeFailure(new Error('ERROR: attendance_owner_backlog_invalid\nCONTEXT: PL/pgSQL function synthetic(text) line 17 at RAISE\nSQL: private values')),
    {error:'owner_backlog_native_failed',phase:'entry',code:'attendance_owner_backlog_invalid',sourceLine:17});
  assert.deepEqual(ownerBacklogNativeFailure(new Error('ERROR: secret_payload\nprivate person@example.test')),
    {error:'owner_backlog_native_failed',phase:'entry',code:'local_check_failed',sourceLine:null});
});

test('synthetic timestamp arithmetic is parenthesized before timezone conversion',()=>{
  assert.match(make().seed.join('\n'),/to_char\(\('[^']+'::timestamptz\+interval '2 microseconds'\) at time zone 'UTC'/);
});
