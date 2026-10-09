// Test-only preparation inside an existing ownership-checked attendance schema.
// Installs the real employee update chain and its status/version/audit guards.
// No employee mutation, login, business result, role editor or global migration
// is simulated here. The caller seeds only synthetic identities and owns cleanup.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {assertLifecycleSandbox} from './merchant-attendance-lifecycle-native-support.mjs';

const files={
  core:'202607250001_core_transaction_foundation.sql',
  foundation:'202607310001_merchant_enterprise_foundation.sql',
  boards:'202607310002_merchant_enterprise_board_workflows.sql',
  invitations:'202607310003_merchant_enterprise_invitation_lifecycle.sql',
  scopes:'202607310009_merchant_enterprise_board_access_scopes.sql',
  offboarding:'202607310010_merchant_enterprise_employee_offboarding.sql',
  transition:'202607310011_merchant_enterprise_employee_role_transition.sql',
  authorization:'202608020017_merchant_enterprise_employee_atomic_authorization.sql',
  audit:'202608020019_merchant_enterprise_audit.sql',
};
const snapshotTables=['merchant_enterprise_roles','merchant_enterprise_role_boards','merchant_enterprise_employees',
  'merchant_task_boards','merchant_task_columns','merchant_tasks','merchant_task_assignees'];
const newTables=['merchant_task_boards','merchant_task_columns','merchant_tasks','merchant_task_assignees',
  'merchant_task_events','merchant_enterprise_role_boards','merchant_enterprise_audit_events'];
const rpcName='faolla_update_merchant_enterprise_employee_v1';
const quoted=value=>"'"+String(value).replaceAll("'","''")+"'";
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

// Pure source construction is exported so tests can compare complete function
// bodies against repository migrations without inventing successful SQL replies.
export function employeeManagementFixturePlan(root){
  assert.equal(typeof root,'string');assert(path.isAbsolute(root),'employee_management_root_required');
  const sources=Object.fromEntries(Object.entries(files).map(([key,file])=>[key,readFileSync(path.join(root,'scripts/supabase-migrations',file),'utf8')]));
  const definitions=[];
  const select=(file,label,pattern)=>{
    const matches=[...sources[file].matchAll(new RegExp(pattern,'g'))];
    assert.equal(matches.length,1,`employee_management_exact_source_required:${label}`);
    return matches[0][0];
  };
  const add=(file,name,kind,original,statement=original,signature=null)=>{
    definitions.push({file:files[file],name,kind,original,statement,signature});return statement;
  };
  const fn=(file,name,args,renamed=name)=>{
    const original=select(file,name,`create or replace function\\s+public\\.${escape(name)}\\([\\s\\S]*?\\n\\$\\$;`);
    const statement=renamed===name?original:original.replace(`public.${name}(`,`public.${renamed}(`);
    assert(statement.includes(`public.${renamed}(`));
    return add(file,renamed,'function',original,statement,`${renamed}(${args})`);
  };
  const table=(file,name)=>add(file,name,'table',select(file,name,`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`));
  const trigger=(file,name)=>add(file,name,'trigger',select(file,name,`create trigger ${name}\\s[\\s\\S]*?;`));
  const column=(file,tableName,columnName)=>add(file,`${tableName}.${columnName}`,'column',select(file,columnName,
    `alter table public\\.${tableName}\\s+add column if not exists ${columnName} [^;]+;`));
  const statements=[];

  statements.push(fn('core','faolla_touch_versioned_row',''));
  for(const name of newTables.slice(0,5))statements.push(table('foundation',name));
  statements.push(column('boards','merchant_task_boards','position'));
  statements.push(add('boards','board-position-default','ddl',select('boards','board-position-default',
    'alter table public\\.merchant_task_boards\\s+alter column position set default 0,\\s+alter column position set not null;')));
  statements.push(add('boards','board-column-position-constraints','ddl',select('boards','board-position-constraints',
    "do \\$\\$\\nbegin\\n  if not exists \\([\\s\\S]*?conname = 'merchant_task_boards_position_nonnegative'[\\s\\S]*?\\n\\$\\$;")));
  for(const name of ['invitation_version','invitation_token_hash','invitation_expires_at','invitation_revoked_at','invitation_sent_at','invitation_delivery_status'])
    statements.push(column('invitations','merchant_enterprise_employees',name));
  statements.push(column('scopes','merchant_enterprise_roles','access_scope'));
  statements.push(add('scopes','role-access-scope-constraint','ddl',select('scopes','role-access-scope-constraint',
    "do \\$\\$\\nbegin\\n  if not exists \\([\\s\\S]*?conname = 'merchant_enterprise_roles_access_scope_check'[\\s\\S]*?\\n\\$\\$;")));
  statements.push(table('scopes','merchant_enterprise_role_boards'));
  statements.push(table('audit','merchant_enterprise_audit_events'));
  // Index definitions are copied, not widened. Existing roles/employees retain
  // their original base-table constraints and attendance permission validator.
  for(const [file,names] of [['foundation',newTables.slice(0,5)],['boards',['merchant_task_boards']],
    ['scopes',['merchant_enterprise_role_boards']],['audit',['merchant_enterprise_audit_events']]]){
    for(const name of names){
      const matches=[...sources[file].matchAll(new RegExp(`create (?:unique )?index if not exists [a-z_]+\\s+on public\\.${name}\\([\\s\\S]*?;`,'g'))];
      assert(matches.length>0,`employee_management_index_source_required:${name}`);
      for(const match of matches)statements.push(add(file,match[0].match(/index if not exists ([a-z_]+)/)[1],'index',match[0]));
    }
  }

  statements.push(fn('scopes','faolla_employee_assignments_fit_role_v1','text,uuid,uuid'));
  statements.push(fn('scopes','faolla_guard_merchant_employee_role_assignments_v1',''));
  statements.push(fn('offboarding','faolla_merchant_enterprise_role_fits_actor_v1','text,uuid,uuid'));
  statements.push(fn('offboarding','faolla_guard_merchant_employee_open_task_disable_v1',''));
  statements.push(fn('transition',rpcName,'jsonb',`${rpcName}_unchecked_017`));
  statements.push(fn('authorization','faolla_authorize_merchant_enterprise_employee_actor_v1','jsonb,uuid,boolean'));
  statements.push(fn('authorization',rpcName,'jsonb',`${rpcName}_preaudit_019`));
  statements.push(fn('audit','faolla_reject_merchant_enterprise_audit_mutation_v1',''));
  statements.push(fn('audit','faolla_set_merchant_enterprise_audit_context_v1','jsonb,text,text'));
  statements.push(fn('audit','faolla_append_merchant_enterprise_audit_event_v1','text,text,text,uuid,text,jsonb,jsonb,text,text,uuid,text'));
  statements.push(fn('audit','faolla_capture_merchant_enterprise_audit_v1',''));
  statements.push(fn('audit',rpcName,'jsonb'));
  for(const name of ['merchant_enterprise_roles_touch','merchant_enterprise_employees_touch','merchant_task_boards_touch','merchant_task_columns_touch','merchant_tasks_touch'])
    statements.push(trigger('foundation',name));
  statements.push(trigger('scopes','merchant_enterprise_employees_role_assignments_guard'));
  statements.push(trigger('offboarding','merchant_enterprise_employees_open_task_disable_guard'));
  statements.push(trigger('audit','merchant_enterprise_audit_events_append_only'));
  statements.push(trigger('audit','merchant_enterprise_employees_audit'));

  // These two display columns belong only to the already-synthetic merchants
  // fixture. No alias/owner/auth identifier is changed or backfilled.
  statements.push('alter table public.merchants add column if not exists name text;');
  statements.push('alter table public.merchants add column if not exists email text;');
  const functions=definitions.filter(item=>item.kind==='function');
  for(const definition of functions)statements.push(`revoke all on function public.${definition.signature} from public,anon,authenticated,service_role;`);
  statements.push(`grant execute on function public.${rpcName}(jsonb) to service_role;`);
  for(const name of [...new Set([...snapshotTables,...newTables])]){
    statements.push(`alter table public.${name} enable row level security;`);
    statements.push(`revoke all on table public.${name} from public,anon,authenticated,service_role;`);
  }
  const readTables=['merchants',...snapshotTables];
  for(const name of readTables)statements.push(`grant select on table public.${name} to service_role;`);
  return {statements,definitions,readTables,snapshotTables:[...snapshotTables],newTables:[...newTables],
    functions:functions.map(item=>item.signature),triggers:definitions.filter(item=>item.kind==='trigger').map(item=>item.name),
    rpc:{name:rpcName,argumentKeys:['p_input'],signature:`${rpcName}(jsonb)`},sourceMigrations:[...new Set(definitions.map(item=>item.file))]};
}

export async function prepareAttendanceEmployeeManagement(native,{sql}){
  assert.equal(typeof native.query,'function');assert.equal(typeof sql,'function');
  const exec=statement=>native.query(sql(statement)),owned=assertLifecycleSandbox(exec),plan=employeeManagementFixturePlan(native.root);
  const newTableArray=plan.newTables.map(quoted).join(','),functionArray=plan.functions.map(quoted).join(','),triggerArray=plan.triggers.map(quoted).join(',');
  const guard=`do $owned$ begin
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.oid='public.merchants'::regclass and c.oid=${owned.tableOid} and n.oid=${owned.oid}
        and n.nspname=${quoted(owned.schema)} and n.nspowner::regrole::text='postgres'
        and obj_description(n.oid,'pg_namespace')=${quoted(owned.marker)}) then raise exception 'employee_management_owned_schema_required'; end if;
    if exists(select 1 from unnest(array[${newTableArray}]) as target(name) where to_regclass('public.'||target.name) is not null)
      or exists(select 1 from unnest(array[${functionArray}]) as target(signature) where to_regprocedure('public.'||target.signature) is not null)
      or exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
        where c.relnamespace=${owned.oid} and t.tgname=any(array[${triggerArray}]))
      then raise exception 'employee_management_fixture_already_present'; end if;
  end; $owned$;`;
  // The standard attendance qualifier handles public.object references; older
  // enterprise definitions also need their standalone public search_path moved.
  const scoped=statement=>{
    const result=sql(statement.replace(/(set search_path\s*=\s*)public\b/g,`$1${owned.schema}`));
    assert(!/\bpublic\./.test(result),'employee_management_qualifier_required');
    assert(!/set search_path\s*=\s*public\b/.test(result),'employee_management_private_search_path_required');
    return result;
  };
  const steps=[scoped(`begin;reset role;${guard}`),...plan.statements.map(scoped),'commit;'];
  if(typeof native.querySteps==='function')await native.querySteps(steps);
  else native.query(steps.join('\n'));
  // Read-only postcondition checks use actual catalogs, not assumed install
  // success. The caller still owns a thrown-error cleanup of its exact schema.
  const installed=JSON.parse(exec(`reset role;select jsonb_build_object(
    'tables',(select count(*) from pg_class where relnamespace=${owned.oid} and relname=any(array[${newTableArray}]) and relkind='r'),
    'functions',(select count(*) from pg_proc where pronamespace=${owned.oid} and proname=any(array[${plan.functions.map(signature=>quoted(signature.split('(')[0])).join(',')}])),
    'triggers',(select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace=${owned.oid} and t.tgname=any(array[${triggerArray}]) and not t.tgisinternal),
    'publicRpc',has_function_privilege('service_role','public.${rpcName}(jsonb)','EXECUTE'),
    'privateCallable',(select count(*) from unnest(array[${plan.functions.filter(signature=>signature!==`${rpcName}(jsonb)`).map(quoted).join(',')}]) as target(signature)
      where has_function_privilege('service_role','public.'||target.signature,'EXECUTE')),
    'writableTables',(select count(*) from unnest(array[${[...new Set([...snapshotTables,...newTables])].map(quoted).join(',')}]) as target(name)
      where has_table_privilege('service_role','public.'||target.name,'INSERT,UPDATE,DELETE,TRUNCATE')));`));
  assert.deepEqual(installed,{tables:plan.newTables.length,functions:plan.functions.length,triggers:plan.triggers.length,
    publicRpc:true,privateCallable:0,writableTables:0},'employee_management_fixture_catalog_mismatch');
  return {readTables:plan.readTables,snapshotTables:plan.snapshotTables,rpc:plan.rpc,sourceMigrations:plan.sourceMigrations,
    syntheticOnly:true,roleEditingPrepared:false,taskWorkflowPrepared:false};
}
