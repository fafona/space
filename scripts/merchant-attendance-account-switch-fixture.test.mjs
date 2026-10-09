// Pure construction checks only. Deliberately stop before any SQL execution;
// these tests make no claim that authentication or database authorization passed.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {accountSwitchFixturePlan,prepareAttendanceAccountSwitch,redactAccountSwitchDiagnostics} from './merchant-attendance-account-switch-fixture.mjs';
import {qualifyAttendanceSandbox} from './merchant-attendance-concurrency-sandbox.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const owned={schema:'attendance_race_'+'a'.repeat(32),oid:123,tableOid:456,owner:'postgres',marker:'faolla-synthetic-concurrency:12345678-1234-1234-1234-123456789abc'};
const scope={schema:owned.schema,sql:source=>qualifyAttendanceSandbox(source,owned.schema)};
const source=readFileSync(new URL('./merchant-attendance-account-switch-fixture.mjs',import.meta.url),'utf8');
const stop=Error('pure construction: do not execute SQL');
const native=overrides=>({root,query:sql=>sql.includes('obj_description')?JSON.stringify(owned):'pure fingerprint',querySteps:async()=>{throw stop;},...overrides});

test('plan loads complete original068 then110 and preserves identity checks and service-only ACLs',()=>{
  const plan=accountSwitchFixturePlan(root);assert.deepEqual(plan.map(row=>row.name.split('_')[0].slice(-3)),['068','110']);
  for(const row of plan)assert.equal(row.source,readFileSync(path.join(root,'scripts/supabase-migrations',row.name),'utf8'));
  assert.match(plan[1].source,/actor_employee_id\s*=\s*v_employee\.id/);assert.match(plan[1].source,/actor_employee_id is distinct from v_employee\.id/);
  assert.match(plan[1].source,/grant execute[\s\S]*to service_role/);assert.throws(()=>accountSwitchFixturePlan('relative-root'),/absolute_root_required/);
});

test('constructed steps recheck exact owned OIDs and bindings before each original migration and the B-only seed',async()=>{
  let steps;await assert.rejects(prepareAttendanceAccountSwitch(native({querySteps:async value=>{steps=value;throw stop;}}),scope),error=>error===stop);
  const plan=accountSwitchFixturePlan(root);assert.equal(steps.length,5);
  for(const index of [0,2,4]){
    assert.match(steps[index],/c\.oid=456 and n\.oid=123/);assert(steps[index].includes(owned.marker));assert(steps[index].includes(owned.schema));
    assert.match(steps[index],/account_switch_initial_binding_required/);assert.match(steps[index],/merchant_enterprise_audit_events'\) is not null/);
  }
  assert.equal(steps[1],scope.sql(plan[0].source));assert.equal(steps[3],scope.sql(plan[1].source));
  for(const statement of steps)assert.doesNotMatch(statement,/\bpublic\./);
  const seed=steps[4];assert.equal((seed.match(/insert into /g)??[]).length,3);
  for(const value of ['000000000102','000000000202','000000000002','employee-b@example.test','SYNTHETIC-109-B','合成员工乙'])assert(seed.includes(value));
  assert.doesNotMatch(seed,/insert into [\w.]*merchant_attendance_events|\bupdate\b|\bdelete\b|on conflict|disable trigger/i);
});

test('wrong namespace metadata or unqualified/mismatched scope cannot submit migration or seed statements',async()=>{
  for(const patch of [{schema:'public'},{owner:'service_role'},{oid:0},{tableOid:0},{marker:'unowned'}]){
    let submitted=false;await assert.rejects(prepareAttendanceAccountSwitch(native({query:()=>JSON.stringify({...owned,...patch}),querySteps:async()=>{submitted=true;}}),scope),/lifecycle_owned_schema_required/);assert.equal(submitted,false);
  }
  await assert.rejects(prepareAttendanceAccountSwitch(native(),{...scope,schema:'attendance_race_'+'b'.repeat(32)}),/scope_mismatch/);
  await assert.rejects(prepareAttendanceAccountSwitch(native(),{...scope,sql:value=>value}),/qualifier_required/);
});

test('fixture verifies A/config/facts preservation and exact B counts without installing management audit or invoking business RPCs',()=>{
  assert.match(source,/account_switch_preparation_changed_original_facts/);assert.match(source,/account_switch_preparation_mismatch/);
  for(const table of ['merchants','merchant_enterprise_roles','merchant_enterprise_employees','merchant_attendance_workers','merchant_attendance_employment_periods','merchant_attendance_settings','merchant_attendance_locations','merchant_attendance_events','merchant_attendance_config_operations','merchant_attendance_scope_operations'])assert(source.includes('from public.'+table));
  assert.match(source,/employees:2,workers:2,employment:2,events:0,managementAuditAbsent:true/);
  assert.match(source,/employeeB:1,workerB:1,employmentB:1,serviceFunctions:2,browserFunctions:0/);
  assert.match(source,/seededEmployees:1,seededWorkers:1,seededEvents:0/);
  assert.doesNotMatch(source,/spawn\(|DATABASE_URL|create schema|drop schema|disable trigger|\.rpc\(|insert into public\.merchant_attendance_events/i);
});

test('diagnostics redact synthetic password, JWT and named refresh tokens without losing nonsecret check labels',()=>{
  const jwt='eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.syntheticsignature';
  const input=`account_switch_probe password=wrong-synthetic-password Synthetic-attendance-only! ${jwt} {"refresh_token":"synthetic-refresh-value"}`;
  const output=redactAccountSwitchDiagnostics(input);assert.match(output,/account_switch_probe/);
  for(const secret of ['wrong-synthetic-password','Synthetic-attendance-only!',jwt,'synthetic-refresh-value'])assert(!output.includes(secret));
  assert(!redactAccountSwitchDiagnostics(Error(input)).includes(jwt));
});
