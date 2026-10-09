import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {employeeManagementFixturePlan,prepareAttendanceEmployeeManagement} from './merchant-attendance-employee-management-fixture.mjs';
import {qualifyAttendanceSandbox} from './merchant-attendance-concurrency-sandbox.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const plan=employeeManagementFixturePlan(root),rpc='faolla_update_merchant_enterprise_employee_v1';
const owned={schema:'attendance_race_'+'a'.repeat(32),oid:123,tableOid:456,owner:'postgres',
  marker:'faolla-synthetic-concurrency:12345678-1234-1234-1234-123456789abc'};

test('complete canonical functions differ only by the two historical declaration renames',()=>{
  const functions=plan.definitions.filter(item=>item.kind==='function');assert.equal(functions.length,13);
  let renamed=0;
  for(const definition of functions){
    const migration=readFileSync(path.join(root,'scripts/supabase-migrations',definition.file),'utf8');
    assert(migration.includes(definition.original),'complete function must come verbatim from its named migration');
    assert.match(definition.original,/^create or replace function\s+public\./);assert.match(definition.original,/\n\$\$;$/);
    if([rpc+'_unchecked_017',rpc+'_preaudit_019'].includes(definition.name)){
      renamed++;assert.equal(definition.statement.replace(`public.${definition.name}(`,`public.${rpc}(`),definition.original);
    }else assert.equal(definition.statement,definition.original);
    assert.equal(definition.statement.slice(definition.statement.indexOf('as $$')),definition.original.slice(definition.original.indexOf('as $$')));
  }
  assert.equal(renamed,2);
  assert.match(functions.find(item=>item.name===rpc).statement,/faolla_set_merchant_enterprise_audit_context_v1\(p_input, 'employee.update', 'input'\)/);
  assert.match(functions.find(item=>item.name===rpc).statement,/faolla_update_merchant_enterprise_employee_v1_preaudit_019\(p_input\)/);
  assert.match(functions.find(item=>item.name===rpc+'_preaudit_019').statement,/faolla_authorize_merchant_enterprise_employee_actor_v1/);
  assert.match(functions.find(item=>item.name===rpc+'_preaudit_019').statement,/faolla_update_merchant_enterprise_employee_v1_unchecked_017\(p_input\)/);
});

test('all copied tables, constraints, indexes, columns and triggers are exact original definitions',()=>{
  for(const definition of plan.definitions.filter(item=>item.kind!=='function')){
    assert.equal(definition.statement,definition.original);
    assert(readFileSync(path.join(root,'scripts/supabase-migrations',definition.file),'utf8').includes(definition.original));
  }
  assert.equal(plan.newTables.length,7);assert.equal(plan.snapshotTables.length,7);
  assert.deepEqual(plan.readTables,['merchants',...plan.snapshotTables]);
  assert(plan.definitions.some(item=>item.name==='merchant_task_boards.position'));
  assert(plan.definitions.some(item=>item.name==='merchant_enterprise_employees.invitation_token_hash'));
  assert(plan.definitions.some(item=>item.name==='merchant_enterprise_roles.access_scope'));
  assert(plan.triggers.includes('merchant_enterprise_employees_role_assignments_guard'));
  assert(plan.triggers.includes('merchant_enterprise_employees_open_task_disable_guard'));
  assert(plan.triggers.includes('merchant_enterprise_employees_touch'));
  assert(plan.triggers.includes('merchant_enterprise_employees_audit'));
});

test('real status guards, CAS, restore acceptance and audit privacy remain inside canonical functions',()=>{
  const body=plan.definitions.find(item=>item.name===rpc+'_unchecked_017').statement;
  assert.match(body,/v_employee\.version <> v_expected_version/);assert.match(body,/v_next_status = 'active' and v_employee\.accepted_at is null/);
  assert.match(body,/employee_open_tasks_require_resolution/);assert.match(body,/updated_at = updated_at/);
  assert.doesNotMatch(body,/merchant_attendance_|version\s*=\s*version\s*\+/);
  const touch=plan.definitions.find(item=>item.name==='faolla_touch_versioned_row').statement;
  assert.match(touch,/new\.version = old\.version \+ 1/);
  const audit=plan.definitions.find(item=>item.name==='faolla_capture_merchant_enterprise_audit_v1').statement;
  assert.match(audit,/'employee.disabled'/);assert.match(audit,/'employee.restored'/);
  assert.match(audit,/Email, auth UUIDs, invitation/);
  assert.match(plan.definitions.find(item=>item.name==='faolla_append_merchant_enterprise_audit_event_v1').statement,/if v_actor_type in \('owner', 'system'\) then\s+v_actor_id := null/);
});

test('only the actual employee public RPC is callable; delegates and direct DML are not granted',()=>{
  const sql=plan.statements.join('\n');
  assert.deepEqual(plan.rpc,{name:rpc,argumentKeys:['p_input'],signature:rpc+'(jsonb)'});
  assert.deepEqual(plan.statements.filter(s=>s.startsWith('grant execute')),['grant execute on function public.'+rpc+'(jsonb) to service_role;']);
  for(const signature of plan.functions)assert(plan.statements.includes(`revoke all on function public.${signature} from public,anon,authenticated,service_role;`));
  for(const table of new Set([...plan.newTables,...plan.snapshotTables]))
    assert(plan.statements.includes(`revoke all on table public.${table} from public,anon,authenticated,service_role;`));
  assert.doesNotMatch(sql,/grant (?:all|insert|update|delete)|create role|alter role|pg_authid|supabase_admin|set role service_role/i);
  assert(!plan.sourceMigrations.some(name=>name.includes('041_')));
  assert(!plan.functions.some(name=>name.includes('role_v3')||name.includes('invitation')));
});

test('preparation stops before execution on a non-owned namespace and scopes every definition before handing it to the native caller',async()=>{
  let submitted=null;const sentinel=Error('pure preparation probe stops before SQL execution');
  const native={root,query:statement=>{assert.match(statement,/obj_description/);return JSON.stringify(owned);},querySteps:async steps=>{submitted=steps;throw sentinel;}};
  await assert.rejects(prepareAttendanceEmployeeManagement(native,{sql:s=>qualifyAttendanceSandbox(s,owned.schema)}),error=>error===sentinel);
  assert(submitted);assert.match(submitted[0],/^begin;reset role;/);assert.match(submitted.at(-1),/^commit;$/);
  assert(submitted[0].includes('c.oid=456 and n.oid=123'));assert(submitted[0].includes(owned.marker));
  assert.match(submitted[0],/employee_management_fixture_already_present/);
  for(const step of submitted){assert.doesNotMatch(step,/\bpublic\./);assert.doesNotMatch(step,/set search_path\s*=\s*public\b/);}
  assert(submitted.some(step=>step.includes(`set search_path = ${owned.schema}`)));
  for(const change of [{schema:'public'},{owner:'service_role'},{tableOid:0},{marker:'not-owned'}]){
    let called=false;await assert.rejects(prepareAttendanceEmployeeManagement({...native,query:()=>JSON.stringify({...owned,...change}),querySteps:async()=>{called=true;}},
      {sql:s=>s}),/lifecycle_owned_schema_required/);assert.equal(called,false);
  }
  await assert.rejects(prepareAttendanceEmployeeManagement(native,{sql:s=>s}),/employee_management_qualifier_required/);
});

test('fixture installs definitions only: no employee seed, business RPC execution, manual result or migration ledger claim',()=>{
  const source=readFileSync(new URL('./merchant-attendance-employee-management-fixture.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/dotenv|DATABASE_URL|SUPABASE_|spawn\(|createClient|listen\(|drop schema|create schema/);
  assert.doesNotMatch(source,/select public\.faolla_update_merchant_enterprise_employee|insert into public\.faolla_schema_migrations|return \{employee:/);
  // DML inside copied real function bodies is retained; top-level installation
  // statements themselves never insert/update employees or attendance facts.
  for(const statement of plan.statements)assert.doesNotMatch(statement,/^(?:insert into|update|delete from|truncate)\s/i);
  assert.match(source,/has_function_privilege\('service_role'/);assert.match(source,/has_table_privilege\('service_role'/);
  assert.match(source,/roleEditingPrepared:false,taskWorkflowPrepared:false/);
});
