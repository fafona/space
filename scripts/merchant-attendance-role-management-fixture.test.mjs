import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {roleManagementFixturePlan,prepareAttendanceRoleManagement} from './merchant-attendance-role-management-fixture.mjs';
import {qualifyAttendanceSandbox} from './merchant-attendance-concurrency-sandbox.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const plan=roleManagementFixturePlan(root),rpc='faolla_update_merchant_enterprise_role_v3';
const owned={schema:'attendance_race_'+'a'.repeat(32),oid:123,tableOid:456,owner:'postgres',
  marker:'faolla-synthetic-concurrency:12345678-1234-1234-1234-123456789abc'};
const sql=source=>qualifyAttendanceSandbox(source,owned.schema);
const renamed=new Map([
  ['faolla_update_merchant_enterprise_role_v1_preaudit_019','faolla_update_merchant_enterprise_role_v1'],
  ['faolla_update_merchant_enterprise_role_v2_preaudit_019','faolla_update_merchant_enterprise_role_v2'],
  ['faolla_update_merchant_enterprise_role_v2_core_041','faolla_update_merchant_enterprise_role_v2'],
]);
const body=name=>plan.definitions.find(item=>item.kind==='function'&&item.name===name).statement;

test('eight complete canonical functions change only three historical declaration names',()=>{
  const functions=plan.definitions.filter(item=>item.kind==='function');assert.equal(functions.length,8);
  let renamedCount=0;
  for(const definition of functions){
    const source=readFileSync(path.join(root,'scripts/supabase-migrations',definition.file),'utf8');
    assert(source.includes(definition.original),'the complete definition must be copied verbatim');
    assert.match(definition.original,/^create (?:or replace )?function\s+public\./);assert.match(definition.original,/\n\$\$;$/);
    if(renamed.has(definition.name)){
      renamedCount++;assert.equal(definition.statement.replace(`public.${definition.name}(`,`public.${renamed.get(definition.name)}(`),definition.original);
    }else assert.equal(definition.statement,definition.original);
    assert.equal(definition.statement.slice(definition.statement.indexOf('as $$')),definition.original.slice(definition.original.indexOf('as $$')));
  }
  assert.equal(renamedCount,3);
  assert.deepEqual(plan.sourceMigrations,[
    '202607310009_merchant_enterprise_board_access_scopes.sql',
    '202608010013_merchant_enterprise_role_atomic_authorization.sql',
    '202608020019_merchant_enterprise_audit.sql',
    '202608280041_merchant_staff_business_permissions.sql',
  ]);
});

test('the original delegation, owner checks, advisory locks, CAS and audit context remain intact',()=>{
  assert.match(body(rpc),/v_response := public\.faolla_update_merchant_enterprise_role_v2_core_041\(p_input\)/);
  assert.match(body(rpc),/faolla_assert_staff_business_role_owner_v1/);
  assert.match(body(rpc),/exception when others then[\s\S]*coalesce\(v_previous_actor_type, ''\)[\s\S]*raise;/);
  assert.match(body('faolla_update_merchant_enterprise_role_v2_core_041'),/faolla_set_merchant_enterprise_audit_context_v1\(p_input, 'role.update', 'input'\)/);
  assert.match(body('faolla_update_merchant_enterprise_role_v2_core_041'),/faolla_update_merchant_enterprise_role_v2_preaudit_019\(p_input\)/);
  const atomic=body('faolla_update_merchant_enterprise_role_v2_preaudit_019');
  assert.match(atomic,/pg_advisory_xact_lock/);assert.match(atomic,/permission_escalation_denied/);
  assert.match(atomic,/for update of employee/);assert.match(atomic,/for update of role_row/);
  assert.match(atomic,/return public\.faolla_update_merchant_enterprise_role_v1\(p_input\)/);
  assert.match(body('faolla_update_merchant_enterprise_role_v1'),/faolla_set_merchant_enterprise_audit_context_v1\(p_input, 'role.update', 'input'\)/);
  assert.match(body('faolla_update_merchant_enterprise_role_v1'),/faolla_update_merchant_enterprise_role_v1_preaudit_019\(p_input\)/);
  const write=body('faolla_update_merchant_enterprise_role_v1_preaudit_019');
  assert.match(write,/v_role\.version <> v_expected_version/);assert.match(write,/enterprise_version_conflict/);
  assert.match(write,/role_in_use/);assert.match(write,/role_board_access_in_use/);assert.match(write,/updated_at = updated_at/);
  assert.doesNotMatch(write,/version\s*=\s*version\s*\+|merchant_attendance_/);
  // Preserved, not replaced by a permissive local owner/auth shim. The scoped
  // attendance-only runner does not invoke this commercial-permissions branch.
  assert.match(body('faolla_assert_staff_business_role_owner_v1'),/from auth\.users as auth_user/);
  assert.match(body('faolla_assert_staff_business_role_owner_v1'),/cardinality\(array_remove\(v_owner_ids, null::uuid\)\) <> 7/);
});

test('three triggers and all eight hardened search paths are exact source definitions',()=>{
  assert.deepEqual(plan.triggers,['merchant_enterprise_roles_staff_business_owner_guard','merchant_enterprise_roles_audit','merchant_enterprise_role_boards_audit']);
  const extras=plan.definitions.filter(item=>item.kind!=='function');assert.equal(extras.length,11);
  for(const definition of extras){
    assert.equal(definition.statement,definition.original);
    assert(readFileSync(path.join(root,'scripts/supabase-migrations',definition.file),'utf8').includes(definition.original));
  }
  assert.equal(extras.filter(item=>item.kind==='configuration').length,8);
  assert(!plan.triggers.some(name=>name.includes('touch')||name.includes('default_workflow')),'existing version trigger is required, not recreated; INSERT workflows are outside scope');
  assert.match(body('faolla_guard_staff_business_role_owner_v1'),/old\.permissions[\s\S]*new\.permissions/);
});

test('only current public role v3 is service-callable and no direct table or global ACL is added',()=>{
  assert.deepEqual(plan.rpc,{name:rpc,argumentKeys:['p_input'],signature:rpc+'(jsonb)'});
  assert.deepEqual(plan.statements.filter(statement=>statement.startsWith('grant ')),[
    `grant execute on function public.${rpc}(jsonb) to service_role;`,
  ]);
  for(const signature of plan.functions)assert(plan.statements.includes(`revoke all on function public.${signature} from public,anon,authenticated,service_role;`));
  assert.doesNotMatch(plan.statements.join('\n'),/create role|alter role|owner to|pg_authid|supabase_admin|grant (?:all|insert|update|delete)/i);
  assert(!plan.functions.some(signature=>signature.startsWith('faolla_update_merchant_enterprise_role_v2(')||signature.includes('create_merchant')));
  for(const statement of plan.statements)assert.doesNotMatch(statement,/^(?:insert into|update|delete from|truncate|create table|alter table|drop)\s/i);
  assert.deepEqual(plan.readTables,['merchants','merchant_enterprise_roles','merchant_enterprise_role_boards','merchant_enterprise_employees',
    'merchant_task_boards','merchant_task_columns','merchant_tasks','merchant_task_assignees']);
});

test('constructed transaction checks exact ownership, existing employee preparation and strict attendance dependencies',async()=>{
  let submitted;const stop=Error('pure construction probe: no SQL execution');
  const native={root,query:statement=>{assert.match(statement,/obj_description/);return JSON.stringify(owned);},
    querySteps:async steps=>{submitted=steps;throw stop;}};
  await assert.rejects(prepareAttendanceRoleManagement(native,{sql}),error=>error===stop);
  assert(submitted);assert.match(submitted[0],/^begin;reset role;/);assert.equal(submitted.at(-1),'commit;');
  const guard=submitted[0];assert(guard.includes('c.oid=456 and n.oid=123'));assert(guard.includes(owned.marker));
  assert.match(guard,/role_management_employee_preparation_required/);assert.match(guard,/role_management_fixture_already_present/);
  assert.match(guard,/t\.tgfoid=to_regprocedure/);assert.match(guard,/t\.tgenabled='O'/);
  assert.match(guard,/role_management_private_tables_required/);
  assert.match(guard,/array\['enterprise.view','attendance.self.view','attendance.self.clock'\]\) is distinct from true/);
  assert.match(guard,/array\['enterprise.view','attendance.self.view'\]\) is distinct from true/);
  assert.match(guard,/array\['enterprise.view'\]\) is distinct from true/);
  assert.match(guard,/array\['enterprise.view','attendance.self.clock'\]\) is distinct from false/);
  assert.match(guard,/array\['attendance.self.view'\]\) is distinct from false/);
  assert.match(guard,/fixture.not_a_permission/);
  for(const step of submitted){assert.doesNotMatch(step,/\bpublic\./);assert.doesNotMatch(step,/set search_path\s*(?:=|to)\s*(?:pg_catalog,\s*)?public\b/);}
  for(const definition of plan.definitions){
    const expected=sql(definition.statement.replace(/(set search_path\s*=\s*)public\b/g,`$1${owned.schema}`)
      .replace(/(set search_path\s+to\s+pg_catalog,\s*)public\b/g,`$1${owned.schema}`));
    assert(submitted.includes(expected),'only the explicit schema/search_path rewrite is allowed');
  }
  assert(!plan.definitions.some(definition=>definition.name==='faolla_valid_merchant_enterprise_permissions_v1'));
});

test('non-owned schemas or incomplete qualification stop before submitting installation statements',async()=>{
  for(const change of [{schema:'public'},{oid:0},{tableOid:0},{owner:'service_role'},{marker:'foreign'}]){
    let submitted=false;
    const native={root,query:()=>JSON.stringify({...owned,...change}),querySteps:async()=>{submitted=true;}};
    await assert.rejects(prepareAttendanceRoleManagement(native,{sql}),/lifecycle_owned_schema_required/);assert.equal(submitted,false);
  }
  let submitted=false;
  const native={root,query:()=>JSON.stringify(owned),querySteps:async()=>{submitted=true;}};
  await assert.rejects(prepareAttendanceRoleManagement(native,{sql:source=>source}),/role_management_qualifier_required/);
  // Partial object rewriting is insufficient for the v3 pg_catalog-first path.
  await assert.rejects(prepareAttendanceRoleManagement(native,{sql:source=>source.replace(/\bpublic\./g,`${owned.schema}.`)}),/role_management_private_search_path_required/);
  assert.equal(submitted,false);
});

test('catalog postconditions fail closed on unexpected callable delegates, missing triggers or table DML',async()=>{
  const expected={functions:8,privateOwners:8,triggers:3,publicRpc:true,privateCallable:0,browserCallable:0,writableTables:0};
  for(const change of [{privateCallable:1},{browserCallable:1},{writableTables:1},{privateOwners:7},{triggers:2},{publicRpc:false}]){
    let catalog;
    const native={root,query:statement=>{
      if(statement.includes('obj_description'))return JSON.stringify(owned);
      catalog=statement;return JSON.stringify({...expected,...change});
    },querySteps:async()=>{}};
    // This is a fake catalog-response rejection test, not an applied-DDL or
    // successful business-RPC claim. Real catalogs are checked by the runner.
    await assert.rejects(prepareAttendanceRoleManagement(native,{sql}),/role_management_fixture_catalog_mismatch/);
    assert.match(catalog,/has_function_privilege\('anon'/);assert.match(catalog,/has_table_privilege\('service_role'/);
  }
});

test('fixture never launches a database, writes business rows, claims a migration or invokes role mutation',()=>{
  const source=readFileSync(new URL('./merchant-attendance-role-management-fixture.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/dotenv|DATABASE_URL|SUPABASE_|spawn\(|createClient|listen\(|drop schema|create schema/);
  assert.doesNotMatch(source,/select public\.faolla_update_merchant_enterprise_role|insert into public\.faolla_schema_migrations|return \{role:/);
  assert.match(source,/syntheticOnly:true,roleEditingPrepared:true,businessRoleEditingPrepared:false,taskWorkflowPrepared:false/);
  assert.match(source,/if\(typeof native.querySteps==='function'\)await native.querySteps\(steps\)/);
});
