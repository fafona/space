// Test-only role UPDATE infrastructure, after prepareAttendanceEmployeeManagement.
// Copies the real v3 -> audited v2 -> atomic v2 -> audited v1 -> v1 chain.
// No role write, permission backfill, Auth row, global 041 ACL or result is faked.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {assertLifecycleSandbox} from './merchant-attendance-lifecycle-native-support.mjs';

const files={
  scopes:'202607310009_merchant_enterprise_board_access_scopes.sql',
  authorization:'202608010013_merchant_enterprise_role_atomic_authorization.sql',
  audit:'202608020019_merchant_enterprise_audit.sql',
  business:'202608280041_merchant_staff_business_permissions.sql',
};
const rpcName='faolla_update_merchant_enterprise_role_v3';
const readTables=['merchants','merchant_enterprise_roles','merchant_enterprise_role_boards','merchant_enterprise_employees',
  'merchant_task_boards','merchant_task_columns','merchant_tasks','merchant_task_assignees'];
const requiredTables=[...readTables,'merchant_enterprise_audit_events'];
const requiredFunctions=[
  'faolla_touch_versioned_row()',
  'faolla_valid_merchant_enterprise_permissions_v1(text[])',
  'faolla_set_merchant_enterprise_audit_context_v1(jsonb,text,text)',
  'faolla_capture_merchant_enterprise_audit_v1()',
  'faolla_append_merchant_enterprise_audit_event_v1(text,text,text,uuid,text,jsonb,jsonb,text,text,uuid,text)',
  'faolla_update_merchant_enterprise_employee_v1(jsonb)',
];
const requiredTriggers=[
  ['merchant_enterprise_roles','merchant_enterprise_roles_touch','faolla_touch_versioned_row()'],
  ['merchant_enterprise_audit_events','merchant_enterprise_audit_events_append_only','faolla_reject_merchant_enterprise_audit_mutation_v1()'],
  ['merchant_enterprise_employees','merchant_enterprise_employees_audit','faolla_capture_merchant_enterprise_audit_v1()'],
];
const quoted=value=>"'"+String(value).replaceAll("'","''")+"'";
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const array=values=>`array[${values.map(quoted).join(',')}]`;

// The complete original definitions are exposed for pure construction tests.
// The installed attendance predicate remains untouched (081 in the base
// sandbox, 090 in a fully loaded candidate); both enforce self.clock -> view.
export function roleManagementFixturePlan(root){
  assert.equal(typeof root,'string');assert(path.isAbsolute(root),'role_management_root_required');
  const sources=Object.fromEntries(Object.entries(files).map(([key,file])=>[key,readFileSync(path.join(root,'scripts/supabase-migrations',file),'utf8')]));
  const definitions=[];
  const select=(file,label,pattern)=>{
    const matches=[...sources[file].matchAll(new RegExp(pattern,'g'))];
    assert.equal(matches.length,1,`role_management_exact_source_required:${label}`);
    return matches[0][0];
  };
  const add=(file,name,kind,original,statement=original,signature=null)=>{
    definitions.push({file:files[file],name,kind,original,statement,signature});return statement;
  };
  const fn=(file,name,args,renamed=name)=>{
    const original=select(file,name,`create (?:or replace )?function\\s+public\\.${escape(name)}\\([\\s\\S]*?\\n\\$\\$;`);
    return add(file,renamed,'function',original,renamed===name?original:original.replace(`public.${name}(`,`public.${renamed}(`),`${renamed}(${args})`);
  };
  const trigger=(file,name)=>add(file,name,'trigger',select(file,name,`create trigger ${name}\\s[\\s\\S]*?;`));
  const statements=[
    fn('scopes','faolla_update_merchant_enterprise_role_v1','jsonb','faolla_update_merchant_enterprise_role_v1_preaudit_019'),
    fn('authorization','faolla_update_merchant_enterprise_role_v2','jsonb','faolla_update_merchant_enterprise_role_v2_preaudit_019'),
    fn('audit','faolla_update_merchant_enterprise_role_v1','jsonb'),
    fn('audit','faolla_update_merchant_enterprise_role_v2','jsonb','faolla_update_merchant_enterprise_role_v2_core_041'),
    fn('business','faolla_role_has_staff_business_permissions_v1','text[]'),
    // Its auth.users branch is preserved verbatim but is not entered by these
    // attendance-only role edits. This fixture does not prepare business roles.
    fn('business','faolla_assert_staff_business_role_owner_v1','text,text'),
    fn('business','faolla_guard_staff_business_role_owner_v1',''),
    fn('business',rpcName,'jsonb'),
    trigger('business','merchant_enterprise_roles_staff_business_owner_guard'),
    trigger('audit','merchant_enterprise_roles_audit'),
    trigger('audit','merchant_enterprise_role_boards_audit'),
  ];
  const functions=definitions.filter(item=>item.kind==='function');
  for(const definition of functions){
    // Retain the later canonical pg_catalog-first configuration as well as
    // the original function body; do not copy global ownership/role changes.
    statements.push(add('business',definition.name+'-search-path','configuration',select('business',definition.name+'-search-path',
      `alter function public\\.${escape(definition.name)}\\([^;]*?\\)\\s+set search_path to pg_catalog, public;`)));
    statements.push(`revoke all on function public.${definition.signature} from public,anon,authenticated,service_role;`);
  }
  statements.push(`grant execute on function public.${rpcName}(jsonb) to service_role;`);
  return {statements,definitions,functions:functions.map(item=>item.signature),
    triggers:definitions.filter(item=>item.kind==='trigger').map(item=>item.name),
    readTables:[...readTables],requiredTables:[...requiredTables],requiredFunctions:[...requiredFunctions],
    rpc:{name:rpcName,argumentKeys:['p_input'],signature:`${rpcName}(jsonb)`},
    sourceMigrations:Object.values(files)};
}

export async function prepareAttendanceRoleManagement(native,{sql}){
  assert.equal(typeof native.query,'function');assert.equal(typeof sql,'function');
  const exec=statement=>native.query(sql(statement));
  const owned=assertLifecycleSandbox(exec),plan=roleManagementFixturePlan(native.root);
  const functions=array(plan.functions),triggers=array(plan.triggers),tables=array(requiredTables);
  const prerequisiteTriggers=requiredTriggers.map(items=>`(${items.map(quoted).join(',')})`).join(',');
  const guard=`do $owned$ begin
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.oid='public.merchants'::regclass and c.oid=${owned.tableOid} and n.oid=${owned.oid}
        and n.nspname=${quoted(owned.schema)} and n.nspowner::regrole::text='postgres'
        and obj_description(n.oid,'pg_namespace')=${quoted(owned.marker)}) then raise exception 'role_management_owned_schema_required'; end if;
    if exists(select 1 from unnest(${tables}) as target(name) where to_regclass('public.'||target.name) is null)
      or exists(select 1 from unnest(${array(requiredFunctions)}) as target(signature) where to_regprocedure('public.'||target.signature) is null)
      or exists(select 1 from (values ${prerequisiteTriggers}) as target(table_name,trigger_name,signature)
        where not exists(select 1 from pg_trigger t where t.tgrelid=to_regclass('public.'||target.table_name)
          and t.tgname=target.trigger_name and t.tgfoid=to_regprocedure('public.'||target.signature)
          and t.tgenabled='O' and not t.tgisinternal))
      then raise exception 'role_management_employee_preparation_required'; end if;
    if exists(select 1 from unnest(${functions}) as target(signature) where to_regprocedure('public.'||target.signature) is not null)
      or to_regprocedure('public.faolla_update_merchant_enterprise_role_v2(jsonb)') is not null
      or exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
        where c.relnamespace=${owned.oid} and t.tgname=any(${triggers}))
      then raise exception 'role_management_fixture_already_present'; end if;
    if public.faolla_valid_merchant_enterprise_permissions_v1(array['enterprise.view','attendance.self.view','attendance.self.clock']) is distinct from true
      or public.faolla_valid_merchant_enterprise_permissions_v1(array['enterprise.view','attendance.self.view']) is distinct from true
      or public.faolla_valid_merchant_enterprise_permissions_v1(array['enterprise.view']) is distinct from true
      or public.faolla_valid_merchant_enterprise_permissions_v1(array['enterprise.view','attendance.self.clock']) is distinct from false
      or public.faolla_valid_merchant_enterprise_permissions_v1(array['attendance.self.view']) is distinct from false
      or public.faolla_valid_merchant_enterprise_permissions_v1(array['enterprise.view','fixture.not_a_permission']) is distinct from false
      then raise exception 'role_management_attendance_permission_dependencies_required'; end if;
    if exists(select 1 from unnest(${tables}) as target(name)
      where has_table_privilege('service_role','public.'||target.name,'INSERT,UPDATE,DELETE,TRUNCATE'))
      then raise exception 'role_management_private_tables_required'; end if;
  end; $owned$;`;
  const scoped=statement=>{
    const result=sql(statement
      .replace(/(set search_path\s*=\s*)public\b/g,`$1${owned.schema}`)
      .replace(/(set search_path\s+to\s+pg_catalog,\s*)public\b/g,`$1${owned.schema}`));
    assert(!/\bpublic\./.test(result),'role_management_qualifier_required');
    assert(!/set search_path\s*(?:=|to)\s*(?:pg_catalog,\s*)?public\b/.test(result),'role_management_private_search_path_required');
    return result;
  };
  const steps=[scoped(`begin;reset role;${guard}`),...plan.statements.map(scoped),'commit;'];
  if(typeof native.querySteps==='function')await native.querySteps(steps);
  else native.query(steps.join('\n'));
  const installed=JSON.parse(exec(`reset role;select jsonb_build_object(
    'functions',(select count(*) from pg_proc where pronamespace=${owned.oid} and proname=any(${array(plan.functions.map(signature=>signature.split('(')[0]))})),
    'privateOwners',(select count(*) from pg_proc where pronamespace=${owned.oid} and proname=any(${array(plan.functions.map(signature=>signature.split('(')[0]))}) and proowner::regrole::text='postgres'),
    'triggers',(select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and t.tgname=any(${triggers}) and t.tgenabled='O' and not t.tgisinternal),
    'publicRpc',has_function_privilege('service_role','public.${rpcName}(jsonb)','EXECUTE'),
    'privateCallable',(select count(*) from unnest(${array(plan.functions.filter(signature=>signature!==plan.rpc.signature))}) as target(signature)
      where has_function_privilege('service_role','public.'||target.signature,'EXECUTE')),
    'browserCallable',(select count(*) from unnest(${functions}) as target(signature)
      where has_function_privilege('anon','public.'||target.signature,'EXECUTE') or has_function_privilege('authenticated','public.'||target.signature,'EXECUTE')),
    'writableTables',(select count(*) from unnest(${tables}) as target(name)
      where has_table_privilege('service_role','public.'||target.name,'INSERT,UPDATE,DELETE,TRUNCATE')));`));
  assert.deepEqual(installed,{functions:plan.functions.length,privateOwners:plan.functions.length,triggers:plan.triggers.length,
    publicRpc:true,privateCallable:0,browserCallable:0,writableTables:0},'role_management_fixture_catalog_mismatch');
  return {readTables:plan.readTables,rpc:plan.rpc,sourceMigrations:plan.sourceMigrations,
    syntheticOnly:true,roleEditingPrepared:true,businessRoleEditingPrepared:false,taskWorkflowPrepared:false};
}
