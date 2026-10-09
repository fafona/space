// Pure construction only; no PostgreSQL/browser connection is made by this file.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {qualifyAttendanceSandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {shiftTemplatesMigrationPlan,shiftTemplatesNativePlan,shiftTemplatesNativeFailure,shiftTemplatesQueryInput,shiftTemplateNativeCommand} from './merchant-attendance-shift-templates-native.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const owned={schema:'attendance_race_'+'a'.repeat(32),owner:'postgres',oid:1234,tableOid:2345,marker:'faolla-synthetic-concurrency:11111111-1111-4111-8111-111111111111'};
const scope={schema:owned.schema,sql:s=>qualifyAttendanceSandbox(s,owned.schema)};
const tables=['merchants','faolla_schema_migrations','merchant_attendance_settings','merchant_attendance_events','merchant_attendance_shift_templates','merchant_attendance_shift_template_operations'];
const make=()=>shiftTemplatesNativePlan(owned,tables);
const source=readFileSync(new URL('./merchant-attendance-shift-templates-native.mjs',import.meta.url),'utf8');

test('119 migration construction preserves full source except transaction shell and owned schema qualification',()=>{
  const plan=shiftTemplatesMigrationPlan(root,scope);assert.equal(plan.name,'202610030119_merchant_attendance_shift_templates.sql');
  assert.equal(plan.source,readFileSync(path.join(root,'scripts/supabase-migrations',plan.name),'utf8'));
  assert.equal(plan.body,plan.source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''));assert.equal(plan.statement,scope.sql(plan.body));assert.doesNotMatch(plan.statement,/\bpublic\./);
  assert.throws(()=>shiftTemplatesMigrationPlan(root,{...scope,schema:'public'}));assert.throws(()=>shiftTemplatesMigrationPlan(root,{...scope,sql:s=>s}));
});

test('fixture plan requires exact owned namespace identity and fingerprints only closed table identifiers',()=>{
  const plan=make();assert(plan.guard.includes(owned.marker));assert.match(plan.guard,/c\.oid=2345 and n\.oid=1234/);
  for(const patch of [{schema:'public'},{owner:'service_role'},{oid:0},{tableOid:0},{marker:'synthetic'}])assert.throws(()=>shiftTemplatesNativePlan({...owned,...patch},tables));
  for(const invalid of [[],tables.slice(1),[...tables,tables[0]],[...tables,'evil;drop table merchants'],[...tables,'auth.users']])assert.throws(()=>shiftTemplatesNativePlan(owned,invalid));
  for(const t of tables)assert(plan.fingerprint.includes(`from public.${t} r`));
  for(const t of tables.slice(0,4))assert(plan.protectedFingerprint.includes(`from public.${t} r`));
  assert.doesNotMatch(plan.protectedFingerprint,/from public\.merchant_attendance_shift_template/);
});

test('preparation seeds only empty synthetic merchant/settings and provides dynamic inventory protection for later099 installation',()=>{
  const plan=make();assert.match(plan.seed,/shift_templates_fresh_namespace_required/);
  assert.deepEqual([...plan.seed.matchAll(/insert into public\.(\w+)/g)].map(m=>m[1]),['merchants','merchant_attendance_settings']);
  assert.match(plan.seed,/'UTC',false,false/);assert.doesNotMatch(plan.seed,/insert into public\.merchant_attendance_(shift|events|workers|locations)/);
  assert.match(source,/fingerprint=\(\)=>exec\(`select \$\{shiftTemplatesNativePlan\(owned,inventory\(\)\).fingerprint\}/);
  assert.match(source,/protectedFingerprint=\(\)=>exec\(`select \$\{shiftTemplatesNativePlan\(owned,inventory\(\)\).protectedFingerprint\}/);
  assert.match(source,/sql:scope.sql/);
});

test('daily query and command factories use exact4/5 keys with no weekday/timezone/person seed',()=>{
  const q=shiftTemplatesQueryInput(),c=shiftTemplateNativeCommand(1001);
  assert.deepEqual(q,{siteId:'99990001',view:'active',cursorId:null,operationId:null});
  assert.deepEqual(Object.keys(c).sort(),['operationId','templateId','expectedRevision','action','template'].sort());
  assert.equal(c.operationId,c.templateId);assert.equal(c.expectedRevision,0);assert.equal(c.action,'save');
  assert.deepEqual(Object.keys(c.template).sort(),['name','segments']);
  assert.deepEqual(c.template.segments,[{start:'08:00',end:'12:00',nextDay:false},{start:'13:00',end:'17:00',nextDay:false}]);
  c.template.segments[0].start='09:00';assert.equal(shiftTemplateNativeCommand(1001).template.segments[0].start,'08:00');
  assert.equal(shiftTemplatesQueryInput({view:'archived'}).view,'archived');assert.equal(q.view,'active');
});

test('native positive writes use original RPC and recovery compares historical receipt snapshots while paused',()=>{
  assert.match(source,/for\(let n=1001;n<=1025;n\+\+\)/);assert.match(source,/actual-owner-commands/);
  assert.match(source,/call\(shiftTemplatesQueryInput\(\),command,false\).receipt,expected/);
  assert.match(source,/assert.deepEqual\(data.read\(\{view:'archived'\}\).items,\[archived.receipt.item\]\)/);
  assert.match(source,/assert.equal\(data.read\(\{operationId:id\(9999\)\}\).receipt,null\)/);
  assert.match(source,/shift_templates_reads_or_replays_changed_facts/);assert.match(source,/new owner must not read former actor receipt/);
  assert.doesNotMatch(source,/insert into public\.merchant_attendance_shift_template|update public\.merchant_attendance_shift_templates\b/);
});

test('capacity, shape and ACL negative cases rollback without bypassing constraints or altering old permissions',()=>{
  assert.match(source,/length:40/);assert.match(source,/length:36/);assert.match(source,/attendance_template_limit/);
  assert.match(source,/archive frees one active slot/);assert.match(source,/Full day boundary/);assert.match(source,/shift_templates_capacity_not_rolled_back/);
  for(const text of ['attendance_version_conflict','attendance_template_archived','attendance_not_available','attendance_operation_conflict','attendance_settings_required'])assert(source.includes(text));
  assert.match(source,/nextDay:'false'/);assert.match(source,/weekdays:\[1\]/);
  assert.match(source,/exception when insufficient_privilege then null/);assert.match(source,/receipt_update_allowed/);assert.match(source,/receipt_delete_allowed/);assert.match(source,/receipt_truncate_allowed/);
  assert.doesNotMatch(source,/disable trigger|session_replication_role|drop constraint|drop not null|statement_timeout|grant select|grant all/);assert.equal(make().labels.length,9);
});

test('runner imports safely and reuses only the established cluster/sandbox with repeated identity checks',()=>{
  assert.match(source,/assert.deepEqual\(assertLifecycleSandbox\(raw\),owned/);assert.match(source,/shift_templates_reapply_changed_owner_acl_index/);assert.match(source,/shift_templates_reapply_changed_facts/);
  assert.match(source,/runAttendanceLabelsReuse\(args,native=>withAttendanceConcurrencySandbox\(native/);
  assert.match(source,/path.resolve\(process.argv\[1\]\)===path.resolve\(fileURLToPath\(import.meta.url\)\)/);
  assert.doesNotMatch(source,/initdb|create database|spawn\(|execFile|fetch\(|\.env|process\.env/);
  assert.match(source,/scenarioChangesRolledBack:true/);assert.match(source,/callerOwnedNamespaceCleanup:true/);
});

test('native diagnostics allow only known codes and numeric source locations, not SQL or private values',()=>{
  assert.deepEqual(shiftTemplatesNativeFailure(new Error('ERROR: attendance_template_limit\nCONTEXT: PL/pgSQL function synthetic(text) line 7 at RAISE\nSQL: person@example.test')),
    {error:'shift_templates_native_failed',phase:'entry',code:'attendance_template_limit',sourceLine:7});
  assert.deepEqual(shiftTemplatesNativeFailure(new Error('ERROR: synthetic_private_value\nraw token')),
    {error:'shift_templates_native_failed',phase:'entry',code:'local_check_failed',sourceLine:null});
});
