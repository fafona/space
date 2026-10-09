// Synthetic delegated-management inputs, not evidence of successful management.
// The existing employee/role preparers install the unchanged production chain;
// this adapter forwards structurally valid scope violations to that real SQL.
import assert from 'node:assert/strict';
import {assertLifecycleSandbox,lifecycleId as id} from './merchant-attendance-lifecycle-native-support.mjs';

const freeze=value=>{if(value&&typeof value==='object'){for(const nested of Object.values(value))freeze(nested);Object.freeze(value);}return value;};
const consts=freeze({
  site:'99990001',ownerAuthId:id(99),employeeAuthId:id(1),delegateAuthId:id(2),
  employeeId:id(101),delegateEmployeeId:id(102),outsideEmployeeId:id(103),workerId:id(201),placeId:id(301),
  roles:{target:id(30),delegate:id(31),system:id(32),outside:id(33)},boards:{a:id(401),b:id(402)},
  permissions:{target:['enterprise.view','attendance.self.view','attendance.self.clock'],
    delegate:['enterprise.view','roles.view','roles.manage','employees.view','employees.manage','attendance.self.view','attendance.self.clock']},
  labels:{targetRole:'合成员工角色',delegateRole:'合成主管角色',systemRole:'合成管理角色',outsideRole:'合成范围外角色',
    targetEmployee:'合成员工甲',delegateEmployee:'合成委托主管',outsideEmployee:'合成范围外员工',boardA:'合成默认看板',boardB:'合成范围外看板'},
});
const names=freeze({role:'faolla_update_merchant_enterprise_role_v3',employee:'faolla_update_merchant_enterprise_employee_v1'});
const rpcNames=Object.freeze(Object.values(names));
const allowedPermissions=Object.freeze([...new Set([...consts.permissions.delegate,'attendance.self.request','attendance.records.view','tasks.view'])]);
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
const array=values=>`array[${values.map(literal).join(',')}]::text[]`;
const commonKeys=['merchant_id','expected_version','actor_type','actor_id'];
const roleFields=['role_id','name','description','permissions','access_scope','allowed_board_ids','status'];
const employeeFields=['employee_id','display_name','status','offboarding_mode'];
const knownErrors=new Set(['permission_escalation_denied','permission_denied','enterprise_version_conflict','role_not_found','role_name_conflict',
  'system_role_protected','role_in_use','role_board_access_in_use','invalid_role','invalid_role_update','invalid_role_actor','invalid_role_status',
  'invalid_role_board_access','invalid_permissions','invalid_site_id','employee_not_found','employee_board_access_in_use',
  'employee_open_tasks_require_resolution','employee_offboarding_scope_denied','employee_offboarding_replacement_invalid',
  'invalid_employee','invalid_employee_update','invalid_employee_status','invalid_employee_status_transition','invalid_employee_offboarding',
  'invalid_employee_actor','invalid_employee_role','invalid_employee_invitation']);

function object(value){return value&&typeof value==='object'&&!Array.isArray(value)
  &&[Object.prototype,null].includes(Object.getPrototypeOf(value));}
function exact(value,fields){return object(value)&&Reflect.ownKeys(value).length===fields.length&&fields.every(key=>Object.hasOwn(value,key));}
function fields(value,required,optional){return object(value)&&required.every(key=>Object.hasOwn(value,key))
  &&Reflect.ownKeys(value).every(key=>typeof key==='string'&&[...required,...optional].includes(key));}
function text(value,max,empty=false){return typeof value==='string'&&value===value.trim()&&Array.from(value).length<=max
  &&(empty||value.length>0)&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value);}
const version=value=>Number.isSafeInteger(value)&&value>=1;

// These guarded statements are inserted by the caller at their explicit seed
// boundaries, inside its owned-schema transaction. They never install a schema,
// migration, trigger, permission, task, assignment or attendance business fact.
function seedGuard(){return `do $owned$ begin
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.oid='public.merchants'::regclass and n.nspname ~ '^attendance_race_[a-f0-9]{32}$'
      and n.nspowner::regrole::text='postgres'
      and obj_description(n.oid,'pg_namespace') ~ '^faolla-synthetic-concurrency:[a-f0-9-]{36}$')
    or (select count(*) from public.merchants)<>1
    or not exists(select 1 from public.merchants where id='${consts.site}' and user_id='${consts.ownerAuthId}')
    then raise exception 'delegated_management_owned_seed_required';end if;
end;$owned$;`;}

export function delegatedManagementPlan(){
  const c=consts,r=c.roles,l=c.labels;
  const identitiesSql=`${seedGuard()}
do $identities$ begin
  if to_regclass('public.merchant_enterprise_audit_events') is not null
    or (select count(*) from public.merchant_enterprise_roles)<>3
    or (select count(*) from public.merchant_enterprise_employees)<>1
    or not exists(select 1 from public.merchant_enterprise_roles where merchant_id='${c.site}' and id='${r.target}' and name=${literal(l.targetRole)} and permissions=${array(c.permissions.target)})
    or not exists(select 1 from public.merchant_enterprise_roles where merchant_id='${c.site}' and id='${r.delegate}' and name=${literal(l.delegateRole)} and permissions=array['enterprise.view']::text[])
    or not exists(select 1 from public.merchant_enterprise_roles where merchant_id='${c.site}' and id='${r.system}' and name=${literal(l.systemRole)} and not is_system)
    or not exists(select 1 from public.merchant_enterprise_employees where merchant_id='${c.site}' and id='${c.employeeId}'
      and auth_user_id='${c.employeeAuthId}' and role_id='${r.target}' and status='active')
    then raise exception 'delegated_management_initial_identities_required';end if;
end;$identities$;
insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions)
  values('${r.outside}','${c.site}',${literal(l.outsideRole)},${array(c.permissions.target)});
update public.merchant_enterprise_roles set permissions=${array(c.permissions.delegate)} where merchant_id='${c.site}' and id='${r.delegate}';
update public.merchant_enterprise_roles set is_system=true where merchant_id='${c.site}' and id='${r.system}';
insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status,accepted_at) values
  ('${c.delegateEmployeeId}','${c.site}','${c.delegateAuthId}','employee-b@example.test',${literal(l.delegateEmployee)},'${r.delegate}','active',now()),
  ('${c.outsideEmployeeId}','${c.site}',null,'outside-delegated@example.test',${literal(l.outsideEmployee)},'${r.outside}','invited',null);`;
  const workspaceSql=`${seedGuard()}
do $workspace$ begin
  if (select count(*) from public.merchant_enterprise_roles)<>4 or (select count(*) from public.merchant_enterprise_employees)<>3
    or exists(select 1 from public.merchant_task_boards) or exists(select 1 from public.merchant_task_columns)
    or exists(select 1 from public.merchant_tasks) or exists(select 1 from public.merchant_task_assignees)
    or exists(select 1 from public.merchant_enterprise_role_boards) or exists(select 1 from public.merchant_enterprise_audit_events)
    or exists(select 1 from pg_trigger where tgrelid='public.merchant_enterprise_roles'::regclass and tgname='merchant_enterprise_roles_audit' and not tgisinternal)
    or exists(select 1 from public.merchant_enterprise_roles where merchant_id='${c.site}' and access_scope<>'all')
    or not exists(select 1 from public.merchant_enterprise_employees where merchant_id='${c.site}' and id='${c.delegateEmployeeId}' and auth_user_id='${c.delegateAuthId}' and role_id='${r.delegate}' and status='active')
    or not exists(select 1 from public.merchant_enterprise_employees where merchant_id='${c.site}' and id='${c.outsideEmployeeId}' and auth_user_id is null and role_id='${r.outside}' and status='invited')
    then raise exception 'delegated_management_empty_workspace_required';end if;
end;$workspace$;
insert into public.merchant_task_boards(id,merchant_id,name,system_key,position) values
  ('${c.boards.a}','${c.site}',${literal(l.boardA)},'default',0),('${c.boards.b}','${c.site}',${literal(l.boardB)},null,1);
insert into public.merchant_task_columns(id,merchant_id,board_id,name,system_key,position,is_done) values
  ${['todo','in_progress','blocked','done'].map((key,n)=>`('${id(410+n)}','${c.site}','${c.boards.a}','合成工作列${n}','${key}',${n},${key==='done'})`).join(',')};
update public.merchant_enterprise_roles set access_scope='restricted' where merchant_id='${c.site}' and id in ('${r.target}','${r.outside}');
insert into public.merchant_enterprise_role_boards(merchant_id,role_id,board_id) values
  ('${c.site}','${r.target}','${c.boards.a}'),('${c.site}','${r.outside}','${c.boards.b}');`;
  return {consts,identitiesSql,workspaceSql};
}

export function redactDelegatedManagementDiagnostics(value){
  return String(value instanceof Error?value.stack??value.message:value)
    .replaceAll('Synthetic-attendance-only!','[synthetic-password-redacted]')
    .replace(/eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[jwt-redacted]');
}

export function createAttendanceDelegatedManagementTransport(exec){
  assert.equal(typeof exec,'function');
  const owned=assertLifecycleSandbox(exec),calls=[],errors=[];
  const guard=`do $owned$ begin
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.oid='public.merchants'::regclass and c.oid=${owned.tableOid} and n.oid=${owned.oid}
        and n.nspname=${literal(owned.schema)} and n.nspowner::regrole::text='postgres'
        and obj_description(n.oid,'pg_namespace')=${literal(owned.marker)})
      or (select count(*) from public.merchants)<>1 or not exists(select 1 from public.merchants where id='${consts.site}')
      then raise exception 'delegated_management_owned_schema_required';end if;
  end;$owned$;`;
  const rpc=async(name,args)=>{
    let input;
    try{
      assert(rpcNames.includes(name)&&exact(args,['p_input']));input=args.p_input;
      const role=name===names.role,idKey=role?'role_id':'employee_id';
      assert(fields(input,[...commonKeys,idKey],role?roleFields:employeeFields));
      assert(input.merchant_id===consts.site&&version(input.expected_version));
      assert(input.actor_type==='owner'&&input.actor_id===consts.ownerAuthId
        ||input.actor_type==='employee'&&input.actor_id===consts.delegateEmployeeId);
      assert((role?Object.values(consts.roles):[consts.employeeId,consts.delegateEmployeeId,consts.outsideEmployeeId]).includes(input[idKey]));
      assert(Object.keys(input).some(key=>!(commonKeys.includes(key)||key===idKey)));
      if(role){
        if(Object.hasOwn(input,'name'))assert(text(input.name,80));
        if(Object.hasOwn(input,'description'))assert(text(input.description,1000,true));
        if(Object.hasOwn(input,'status'))assert(['active','archived'].includes(input.status));
        if(Object.hasOwn(input,'permissions'))assert(Array.isArray(input.permissions)&&new Set(input.permissions).size===input.permissions.length
          &&input.permissions.every(permission=>allowedPermissions.includes(permission)));
        assert(Object.hasOwn(input,'access_scope')===Object.hasOwn(input,'allowed_board_ids'));
        if(Object.hasOwn(input,'access_scope')){
          assert(['all','restricted'].includes(input.access_scope)&&Array.isArray(input.allowed_board_ids)
            &&new Set(input.allowed_board_ids).size===input.allowed_board_ids.length&&input.allowed_board_ids.every(board=>Object.values(consts.boards).includes(board)));
          assert(input.access_scope!=='all'||input.allowed_board_ids.length===0);
        }
      }else{
        if(Object.hasOwn(input,'display_name'))assert(text(input.display_name,120));
        if(Object.hasOwn(input,'status'))assert(['active','disabled'].includes(input.status));
        if(Object.hasOwn(input,'offboarding_mode'))assert(input.offboarding_mode==='unassign'&&input.status==='disabled');
      }
      const copied=JSON.parse(JSON.stringify(input));assert.deepEqual(copied,input);input=copied;
    }catch{throw Error('delegated_management_invalid_rpc_arguments');}
    // No permission-subset, actor status, own-role or board-scope simulation.
    // The exact service-role function performs those decisions and mutations.
    calls.push({name,input:structuredClone(input)});
    try{
      const result=JSON.parse(exec(`begin;reset role;${guard}set local role service_role;
        select jsonb_build_object('role',current_user,'data',public.${name}(${literal(JSON.stringify(input))}::jsonb));commit;`));
      assert(exact(result,['role','data'])&&result.role==='service_role');
      return {data:result.data,error:null};
    }catch(error){
      const code=String(error).match(/ERROR:\s+([a-z_]+)/)?.[1];
      if(code&&knownErrors.has(code))return {data:null,error:{message:code}};
      errors.push('delegated_management_sql_failure');return {data:null,error:{message:'enterprise_store_unavailable'}};
    }
  };
  return {rpc,rpcNames,calls,errors,service:{rpc}};
}
