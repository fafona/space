// Test-only, owned-namespace onboarding infrastructure. Invited prestate comes
// from the existing fixture; all activation, permission, configuration and clock
// changes must come from the real service-role functions, never synthetic DTOs.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {prepareAttendanceInitialPasswordFixture,applyInitialPasswordReplayFixture,validateInitialPasswordRpcInput} from './merchant-attendance-initial-password-fixture.mjs';
import {prepareAttendanceRoleManagement} from './merchant-attendance-role-management-fixture.mjs';
import {isInvitationBrowserRecoveryRead} from './merchant-attendance-invitation-browser-fixture.mjs';
import {validateInvitationRetryRpcInput} from './merchant-attendance-invitation-retry-native.mjs';
import {assertLifecycleSandbox,lifecycleId as id} from './merchant-attendance-lifecycle-native-support.mjs';

const require=createRequire(import.meta.url);
const {createAttendanceEmployeeManagementReadTransport}=require('./fixtures/attendance-employee-management-read-transport.ts');
const {parseAttendanceAdminCommand,parseAttendanceAdminQuery,ATTENDANCE_ADMIN_ERRORS}=require('../src/lib/merchantAttendanceAdmin.ts');
const {parseAttendanceSelfCommand,attendanceSelfUuid,ATTENDANCE_SELF_ERROR_STATUS}=require('../src/lib/merchantAttendanceSelf.ts');
const site='99990001',ownerId=id(99),subjects=new Set([ownerId,id(1),id(2),id(3)]);
const setupNames=['claim','complete','release'].map(action=>`faolla_${action}_merchant_employee_initial_password_setup_v1`);
const invitationNames=['faolla_accept_merchant_employee_invitation_v1','faolla_waive_employee_initial_password_v1'];
const roleName='faolla_update_merchant_enterprise_role_v3',adminName='faolla_attendance_admin_v1',selfName='faolla_attendance_self_v1';
const rpcNames=Object.freeze([...setupNames,...invitationNames,roleName,adminName,selfName]);
const permissionNames=new Set(['enterprise.view','attendance.self.view','attendance.self.clock']);
const knownErrors=new Set([...Object.keys(ATTENDANCE_ADMIN_ERRORS),...Object.keys(ATTENDANCE_SELF_ERROR_STATUS),
  'invalid_role_update','invalid_role_actor','invalid_role','invalid_role_status','invalid_permissions','invalid_permission_dependencies',
  'invalid_role_board_access','invalid_site_id','role_not_found','enterprise_version_conflict',
  'permission_escalation_denied','system_role_protected','role_in_use','role_board_access_in_use']);
const factTables={roles:'merchant_enterprise_roles',settings:'merchant_attendance_settings',locations:'merchant_attendance_locations',
  workers:'merchant_attendance_workers',periods:'merchant_attendance_employment_periods',events:'merchant_attendance_events',
  configOperations:'merchant_attendance_config_operations'};
const mutableTables=new Set([...Object.values(factTables),'merchant_enterprise_employees',
  'merchant_employee_initial_password_setups','merchant_enterprise_audit_events']);
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const json=value=>value===null?'null':`${quote(JSON.stringify(value))}::jsonb`;
const uuidOrNull=value=>value===null?null:attendanceSelfUuid(value);
const exact=(value,keys)=>{
  assert(value&&typeof value==='object'&&!Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(),[...keys].sort());
};

/** Pure validation of the exact original service RPC shapes, not authorization. */
export function validateAttendanceOnboardingRpcInput(name,args){
  assert(rpcNames.includes(name));
  if(setupNames.includes(name))return validateInitialPasswordRpcInput(name,args);
  if(invitationNames.includes(name)){
    const input=validateInvitationRetryRpcInput(name,args);
    assert([id(1),id(2),id(3)].includes(input.auth_user_id));return input;
  }
  if(name===roleName){
    exact(args,['p_input']);const input=args.p_input;
    exact(input,['merchant_id','role_id','expected_version','actor_type','actor_id','permissions']);
    assert.equal(input.merchant_id,site);assert.equal(input.actor_type,'owner');assert.equal(input.actor_id,ownerId);
    assert([id(30),id(31),id(32)].includes(input.role_id));
    assert(Number.isSafeInteger(input.expected_version)&&input.expected_version>=1&&input.expected_version<Number.MAX_SAFE_INTEGER);
    assert(Array.isArray(input.permissions)&&input.permissions.length>=1&&input.permissions.length<=3);
    assert.equal(new Set(input.permissions).size,input.permissions.length);
    assert(input.permissions.every(value=>permissionNames.has(value)));return input;
  }
  exact(args,name===adminName?['p_site_id','p_auth_user_id','p_query','p_command','p_operation_id']:
    ['p_site_id','p_auth_user_id','p_command','p_operation_id']);
  assert.equal(args.p_site_id,site);assert(subjects.has(args.p_auth_user_id));
  assert.equal(uuidOrNull(args.p_operation_id),args.p_operation_id);
  if(name===adminName){
    exact(args.p_query,['view','cursor','search']);
    const q=new URL('https://attendance-auth.invalid/query');q.searchParams.set('siteId',site);
    assert.equal(typeof args.p_query.view,'string');assert.equal(typeof args.p_query.search,'string');
    assert.equal(uuidOrNull(args.p_query.cursor),args.p_query.cursor);
    q.searchParams.set('view',args.p_query.view);q.searchParams.set('search',args.p_query.search);
    if(args.p_query.cursor!==null)q.searchParams.set('cursor',args.p_query.cursor);
    const parsed=parseAttendanceAdminQuery(q.href);
    assert.deepEqual(args.p_query,{view:parsed.view,cursor:parsed.cursor,search:parsed.search});
  }
  if(args.p_command!==null){
    assert.equal(args.p_operation_id,null);
    const parsed=name===adminName?parseAttendanceAdminCommand({siteId:site,...args.p_command}):
      parseAttendanceSelfCommand({siteId:site,...args.p_command});
    assert.deepEqual(args.p_command,parsed.command);
  }
  return args;
}

/** Only a complete original111 migration, with transaction/schema adaptation. */
export function onboardingSelfMigrationPlan(root,scope){
  assert.equal(typeof root,'string');assert(path.isAbsolute(root));
  assert.match(scope.schema,/^attendance_race_[a-f0-9]{32}$/);assert.equal(typeof scope.sql,'function');
  const migration='202610020111_merchant_attendance_self_clock_identity.sql';
  const original=readFileSync(path.join(root,'scripts/supabase-migrations',migration),'utf8');
  const body=original.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'');
  const statement=scope.sql(body);
  assert(!/\bpublic\./.test(statement)&&!/search_path\s*(?:=|to)\s*public\b/.test(statement));
  return {migration,original,statement};
}

/** Extra owner reads use the same strict real-SQL reader, never serveShell. */
export function createAttendanceOnboardingTransport(prepared){
  assert.equal(typeof prepared.exec,'function');
  assert.deepEqual(assertLifecycleSandbox(prepared.exec),prepared.owned,'onboarding_fixture_namespace_changed');
  const onboardingCalls=[],transportErrors=[];
  const management=createAttendanceEmployeeManagementReadTransport(prepared.exec,{syntheticAuthUserIds:[...subjects]});
  const checked=source=>{
    assert.deepEqual(assertLifecycleSandbox(prepared.exec),prepared.owned,'onboarding_fixture_namespace_changed');
    return prepared.exec(source);
  };
  const onboardingRpc=async(name,args)=>{
    let input;
    try{input=validateAttendanceOnboardingRpcInput(name,args);}catch{
      transportErrors.push('onboarding_fixture_rpc_forbidden');throw Error('onboarding_fixture_rpc_forbidden');
    }
    // Invitation/setup calls intentionally log no token hash, fingerprint or
    // returned private employee/setup data. Attendance intent contains no PIN.
    const call={name,error:null};
    if(name===roleName)call.input=structuredClone(input);
    else if(name===adminName||name===selfName)call.input=structuredClone(args);
    onboardingCalls.push(call);
    if(setupNames.includes(name)||invitationNames.includes(name)){
      try{
        const result=await (setupNames.includes(name)?prepared.initialPasswordRpc(name,args):prepared.rpc(name,args));
        call.error=result.error?.message??null;return result;
      }catch{transportErrors.push('onboarding_fixture_rpc_failed');throw Error('onboarding_fixture_rpc_failed');}
    }
    const parameters=name===roleName?json(input):
      [quote(site),quote(args.p_auth_user_id),...(name===adminName?[json(args.p_query)]:[]),
        json(args.p_command),args.p_operation_id===null?'null':quote(args.p_operation_id)].join(',');
    try{
      const result=JSON.parse(checked(`begin;reset role;set local role service_role;
        select jsonb_build_object('role',current_user,'data',public.${name}(${parameters}));commit;`));
      assert.equal(result.role,'service_role');return {data:result.data,error:null};
    }catch(error){
      const code=String(error).match(/ERROR:\s+([a-z_]+)(?=\r?\n|$)/)?.[1];
      if(code&&knownErrors.has(code)){call.error=code;return {data:null,error:{message:code}};}
      transportErrors.push('onboarding_fixture_rpc_failed');throw Error('onboarding_fixture_rpc_failed');
    }
  };
  // Recovery classification precedes ordinary reads. Invalid recovery-shaped
  // requests stay on the strict recovery reader and must never fall back.
  const onboardingRead=request=>isInvitationBrowserRecoveryRead(request)?prepared.read(request):management.read(request);
  return {onboardingRpc,onboardingRead,onboardingCalls,onboardingRpcNames:rpcNames,onboardingReadCalls:management.calls,
    get onboardingErrors(){return [...transportErrors,...management.errors,...prepared.errors,...prepared.initialPasswordErrors];}};
}

function createOnboardingOracles(prepared){
  const exec=source=>{
    assert.deepEqual(assertLifecycleSandbox(prepared.exec),prepared.owned,'onboarding_fixture_namespace_changed');
    return prepared.exec(source);
  };
  const tableCatalog=()=>JSON.parse(exec(`reset role;select coalesce(jsonb_agg(jsonb_build_object('name',relname,'oid',oid::bigint) order by relname),'[]'::jsonb)
    from pg_class where relnamespace=${prepared.owned.oid} and relkind in('r','p');`));
  const catalog=tableCatalog();assert(Array.isArray(catalog)&&catalog.length>0);
  const names=new Set();
  for(const table of catalog){
    assert(typeof table.name==='string'&&/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(table.name)&&table.name.length<=63);
    assert(Number.isSafeInteger(table.oid)&&table.oid>0&&!names.has(table.name));names.add(table.name);
  }
  for(const name of [...mutableTables,'merchants','faolla_schema_migrations','merchant_enterprise_staff_identities',
    'merchant_task_boards','merchant_task_columns','merchant_enterprise_role_boards'])assert(names.has(name),'onboarding_fixture_table_required');
  const protectedTables=catalog.filter(table=>!mutableTables.has(table.name)).map(table=>table.name);
  const rows=table=>`(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.${table} t)`;
  const onboardingFacts=()=>({enterprise:prepared.facts(),...JSON.parse(exec(`reset role;select jsonb_build_object(
    ${Object.entries(factTables).map(([key,table])=>`${quote(key)},${rows(table)}`).join(',')});`))});
  const onboardingProtectedFingerprint=()=>{
    assert.deepEqual(tableCatalog(),catalog,'onboarding_fixture_table_catalog_changed');
    return exec(`reset role;select md5(jsonb_build_object(${protectedTables.map(table=>`${quote(table)},${rows(table)}`).join(',')})::text);`);
  };
  return {onboardingFacts,onboardingProtectedFingerprint,onboardingProtectedTables:Object.freeze(protectedTables)};
}

export async function prepareAttendanceOnboardingFixture(native,scope){
  const prepared=await prepareAttendanceInitialPasswordFixture(native,scope);
  assert.equal(prepared.site,site);assert.equal(prepared.ownerId,ownerId);assert.equal(scope.schema,prepared.owned.schema);
  assert.deepEqual(assertLifecycleSandbox(prepared.exec),prepared.owned,'onboarding_fixture_namespace_changed');
  const before=prepared.facts();
  assert.equal(before.employees.length,3);assert.equal(before.setups.length,0);
  assert(before.employees.every(employee=>employee.status==='invited'&&employee.accepted_at===null),'onboarding_fixture_invited_prestate_required');
  const absent=JSON.parse(prepared.exec(`reset role;select jsonb_build_object(${Object.entries(factTables).filter(([key])=>key!=='roles')
    .map(([key,table])=>`${quote(key)},(select count(*) from public.${table})`).join(',')});`));
  assert.deepEqual(absent,{settings:0,locations:0,workers:0,periods:0,events:0,configOperations:0},'onboarding_fixture_empty_attendance_required');
  const replay=applyInitialPasswordReplayFixture(native,scope,prepared);
  const role=await prepareAttendanceRoleManagement(native,scope);
  const self=onboardingSelfMigrationPlan(native.root,scope);prepared.exec(self.statement);
  assert.deepEqual(prepared.facts(),before,'onboarding_fixture_install_changed_enterprise_facts');
  const oracles=createOnboardingOracles(prepared),initial=oracles.onboardingFacts();
  for(const key of Object.keys(absent))assert.deepEqual(initial[key],[],'onboarding_fixture_install_seeded_attendance');
  const transport=createAttendanceOnboardingTransport(prepared),owner={id:ownerId,email:'owner-entry@example.test'};
  // Preserve live error getters rather than copying their current array value.
  Object.defineProperty(prepared,'onboardingErrors',{enumerable:true,get:()=>transport.onboardingErrors});
  const {onboardingErrors:ignored,...methods}=transport;void ignored;
  return Object.assign(prepared,methods,oracles,{owner,onboardingActors:[owner,...prepared.actors],
    onboardingInstallation:{selfMigration:self.migration,role,replay,seededActiveEmployees:0,seededWorkers:0,seededAttendanceEvents:0}});
}
