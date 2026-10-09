// Pure runner/SQL construction contracts. These tests do not execute PostgreSQL
// and do not substitute mocked data for the separate native acceptance result.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {noticeCoverageMigrationPlan,noticeCoverageNativePlan,prepareNoticeCoverageNativeFixture,
  checkAttendanceNoticeCoverageNative,noticeCoverageNativeFailure} from './merchant-attendance-notice-coverage-native.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const owned={schema:'attendance_race_'+'a'.repeat(32),oid:123,tableOid:456,owner:'postgres',
  marker:'faolla-synthetic-concurrency:12345678-1234-1234-1234-123456789abc'};
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scope={schema:owned.schema,sql:source=>source.replace(/\bpublic\./g,owned.schema+'.').replace(/(search_path\s*=\s*pg_catalog,\s*)public\b/g,'$1'+owned.schema)};
const tables=['merchants','faolla_schema_migrations','merchant_enterprise_roles','merchant_enterprise_employees',
  'merchant_attendance_workers','merchant_attendance_settings','merchant_attendance_locations','merchant_attendance_events',
  'merchant_attendance_scope_grants','merchant_attendance_location_policy_drafts',
  'merchant_attendance_location_notices','merchant_attendance_location_notice_acknowledgements'];
const plan=noticeCoverageNativePlan(owned,tables),all=[...plan.seed,...plan.steps].join('\n');
const source=readFileSync(new URL('./merchant-attendance-notice-coverage-native.mjs',import.meta.url),'utf8');

test('only original073/076/115 migrations are read in full and schema-adapted without business body changes',()=>{
  const migrations=noticeCoverageMigrationPlan(root,scope);
  assert.deepEqual(migrations.map(item=>item.name),['202609300073_merchant_attendance_location_policy_drafts.sql',
    '202609300076_merchant_attendance_location_notices.sql','202610030115_merchant_attendance_location_notice_coverage.sql']);
  for(const migration of migrations){
    const original=readFileSync(new URL('./supabase-migrations/'+migration.name,import.meta.url),'utf8');
    assert.equal(migration.source,original);
    assert.equal(migration.body,original.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''));
    assert.equal(migration.statement,scope.sql(migration.body));assert(!/\bpublic\./.test(migration.statement));
  }
  assert.throws(()=>noticeCoverageMigrationPlan(root,{schema:'public',sql:scope.sql}));
  assert.throws(()=>noticeCoverageMigrationPlan(root,{schema:owned.schema,sql:value=>value}));
  assert.match(source,/checked\(migrations\.at\(-1\)\.body\)/);
  assert.match(source,/coverage_migration_reapply_changed_function_acl/);
  assert.match(source,/coverage_migration_reapply_changed_business_facts/);
});

test('bounded synthetic seed has exactly57 assigned workers,51 eligible and six explicit exclusions without any punches',()=>{
  assert.equal(plan.workers.length,57);assert.equal(plan.people.length,56);
  assert.equal(new Set(plan.workers.map(worker=>worker.id)).size,57);
  assert(plan.people.every(person=>person.status!=='active'||person.authId!==null),'original active-binding constraint is never bypassed');
  assert.deepEqual(plan.people.filter(person=>person.authId===null).map(person=>person.status),['invited']);
  const exclusion=worker=>!worker.active?'worker_inactive':!worker.employee||worker.employee.status!=='active'||!worker.employee.authId?
    'employee_unavailable':worker.employee.roleId!==id(30)?'role_unavailable':null;
  assert.equal(plan.workers.filter(worker=>exclusion(worker)===null).length,51);
  assert.deepEqual(plan.workers.slice(50).map(exclusion),[null,'employee_unavailable','employee_unavailable','worker_inactive','role_unavailable','employee_unavailable','role_unavailable']);
  assert.deepEqual(plan.workers.slice(0,51).map(worker=>worker.id),Array.from({length:51},(_,index)=>id(201+index)));
  assert.match(plan.seed[0],/array\['enterprise.view','attendance.self.view'\]/);
  assert.doesNotMatch(all,/attendance\.self\.clock|insert into public\.merchant_attendance_events|update public\.merchant_attendance_events/);
  for(const batch of plan.seed.filter(sql=>/^insert into public\.merchant_enterprise_employees|^insert into public\.merchant_attendance_workers/.test(sql))){
    const rows=[...batch.matchAll(/\('00000000-0000-4000-8000-\d{12}'/g)];assert(rows.length<=50);
  }
  assert.match(plan.seed.at(-1),/COVERAGE-OTHER-LOCATION/);assert.match(plan.seed.at(-1),/COVERAGE-FOREIGN/);
  assert.match(plan.seed[0],/'UTC',false,false/);
});

test('every report assertion is surrounded by whole-business fingerprints and actual service-role execution',()=>{
  const reports=plan.steps.filter(sql=>sql.startsWith('update coverage_read_baseline'));
  assert(reports.length>=10);
  for(const report of reports){
    assert.match(report,/set local role service_role;do \$check\$/);
    assert.match(report,/assert current_user='service_role','coverage_native_service_role_required'/);
    assert.match(report,/end;\$check\$;reset role;/);
    assert.match(report,/coverage_read_changed_business_facts/);
    for(const table of tables)assert(report.includes(`from public.${table} t`));
  }
  assert.match(plan.steps[1],/perform public\.faolla_attendance_location_policy_draft_v1/);
  assert.match(plan.steps[1],/perform public\.faolla_attendance_location_notice_v1/);
  assert(plan.steps[1].includes('"action":"acknowledge"'));
  assert(plan.steps[1].includes('"expectedWorkerId":"'+id(201)+'"'));
  assert.doesNotMatch(all,/insert into public\.merchant_attendance_location_(?:notices|notice_acknowledgements|policy_drafts)/);
  assert.match(all,/only actual draft writes/);assert.match(all,/only actual notice writes/);assert.match(all,/only actual employee ACK/);
});

test('paging compares the entire57 UUID list, stable per-read totals and a genuinely empty trailing page',()=>{
  const paging=plan.steps.find(sql=>sql.includes('every assigned UUID exactly once'));assert(paging);
  assert.match(paging,/jsonb_array_length\(a->'items'\)=50/);assert.match(paging,/jsonb_array_length\(b->'items'\)=7/);
  assert(paging.includes('"cursorWorkerId":"'+id(250)+'"'));
  assert(paging.includes('"cursorWorkerId":"'+id(257)+'"'));
  assert.match(paging,/b->'counts'=a->'counts'/);
  const expected=paging.match(/assert all_ids=array\[([^\]]+)\]/)?.[1];assert(expected);
  assert.deepEqual([...expected.matchAll(/'([^']+)'::uuid/g)].map(match=>match[1]),plan.workers.map(worker=>worker.id));
  assert.match(paging,/a->'items'='\[\]'::jsonb and a->'nextCursor'='null'::jsonb/);
  assert.doesNotMatch(paging,/\boffset\b|sort\(/i);
});

test('version/identity scenarios use isolated savepoints and preserve historical ACKs instead of rewriting them',()=>{
  const savepoints=[...all.matchAll(/(?:^|\n)savepoint ([a-z_]+);/g)].map(match=>match[1]);
  assert.deepEqual(savepoints,['settings_change','location_change','current_auth','current_binding','historical_inactive']);
  for(const name of savepoints)assert.equal((all.match(new RegExp(`rollback to savepoint ${name};`,'g'))??[]).length,1);
  assert.match(all,/new current auth cannot inherit ACK/);assert.match(all,/new employee and worker tuple cannot inherit ACK/);
  assert.match(all,/exact inactive history remains visible/);assert.match(all,/ineligible ACK not counted as confirmed/);
  assert.match(all,/new unpublished draft keeps original publication/);assert.match(all,/stale publication retains historical version ACK/);
  assert.match(all,/withdrawn has no pending interpretation/);assert.match(all,/republish requires new revision ACK/);
  assert.doesNotMatch(all,/update public\.merchant_attendance_location_(?:notice_acknowledgements|notices)|delete from public\.|disable trigger|session_replication_role/);
  assert.match(plan.steps.at(-1),/select '[^\n]+'::jsonb;rollback;$/);
  assert.match(source,/coverage_native_seed_or_case_not_rolled_back/);
});

test('actual denial statements cover unauthorized actors, tenant/location confusion, malformed fences and private/browser ACLs',()=>{
  assert(all.includes(`'99990002','${id(99)}'`),'same owner cannot read another tenant');
  assert(all.includes(`'99990001','${id(1)}'`));assert(all.includes(`'99990001','${id(98)}'`));
  assert.match(all,/attendance_location_denied/);assert.match(all,/attendance_version_conflict/);
  for(const shape of ['"extra":true','"expectedNoticeRevision":"3"','"expectedSettingsVersion":0','"expectedLocationVersion":true','"locationId":7'])assert(all.includes(shape));
  for(const role of ['anon','authenticated'])assert(all.includes(`set local role ${role};do $acl$`));
  assert.match(all,/coverage_browser_execute_allowed';exception when insufficient_privilege then null/);
  assert.match(all,/perform 1 from public\.merchant_attendance_location_notices/);
  assert.match(all,/perform 1 from public\.merchant_attendance_location_notice_acknowledgements/);
  assert.match(all,/coverage_private_table_read_allowed';exception when insufficient_privilege then null/);
});

test('owned plan rejects broad namespaces and interpolated identifiers, and exported browser preparation reuses original writes',()=>{
  assert.match(plan.guard,/c\.oid=456 and n\.oid=123/);assert(plan.guard.includes(owned.marker));
  assert.match(plan.seed[0],/^begin;reset role;do \$owned\$/);assert.match(plan.seed[0],/coverage_native_fresh_namespace_required/);
  for(const invalid of [{...owned,schema:'public'},{...owned,owner:'service_role'},{...owned,oid:0},{...owned,tableOid:0},{...owned,marker:'not-owned'}])
    assert.throws(()=>noticeCoverageNativePlan(invalid,tables));
  for(const invalid of [[...tables,'public.merchants'],[...tables,'merchant_x;drop_schema'],[...tables,tables[0]],[]])
    assert.throws(()=>noticeCoverageNativePlan(owned,invalid));
  assert.equal(typeof prepareNoticeCoverageNativeFixture,'function');assert.equal(typeof checkAttendanceNoticeCoverageNative,'function');
  assert.match(source,/native\.querySteps\(\[\.\.\.plan\.seed,plan\.steps\[1\],'commit;'\]\.map\(scope\.sql\)\)/);
  assert.match(source,/return \{site,owner,place,other:otherPlace,exec:checked,owned,queryInput:query,counts:expectedCounts/);
  assert.match(source,/withAttendanceConcurrencySandbox\(native,/);assert.match(source,/runAttendanceLabelsReuse\(args,/);
  assert.match(source,/if\(process\.argv\[1\]&&path\.resolve\(process\.argv\[1\]\)===path\.resolve\(fileURLToPath\(import\.meta\.url\)\)\)/);
  assert.doesNotMatch(source,/initdb|create database|drop database|statement_timeout\s*=|fetch\(|playwright|writeFile/);
});

test('native failure diagnostics expose only a fixed phase, allowlisted code and numeric source line, never SQL or credentials',()=>{
  const secret='Synthetic-new-staff-only!2026',token='eyJhbGciOiJIUzI1NiJ9.fake.signature';
  const result=noticeCoverageNativeFailure(Error(`ERROR: attendance_access_denied\nDETAIL: ${secret} ${token}\nCONTEXT: PL/pgSQL function fixture_probe() line 7 at ASSERT`));
  assert.deepEqual(result,{error:'notice_coverage_native_failed',phase:'entry',code:'attendance_access_denied',sourceLine:7});
  assert(!JSON.stringify(result).includes(secret));assert(!JSON.stringify(result).includes(token));assert(!JSON.stringify(result).includes('fixture_probe'));
  assert.deepEqual(noticeCoverageNativeFailure(Error(`ERROR: private_secret_value\n${secret}`)),
    {error:'notice_coverage_native_failed',phase:'entry',code:'local_check_failed',sourceLine:null});
  assert.match(source,/console\.error\(JSON\.stringify\(noticeCoverageNativeFailure\(error\)\)\)/);
  assert.doesNotMatch(source,/console\.error\(error\)|error\.stack/);
});
