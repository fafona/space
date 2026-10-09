// Local Portal acceptance infrastructure, never an application transport.
// Invited identities/workspace are explicit synthetic prestate; acceptance and
// its audit/version changes must be produced by the original HTTP/SQL chain.
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {prepareAttendanceEmployeeManagement} from './merchant-attendance-employee-management-fixture.mjs';
import {prepareAttendanceInvitationRetry} from './merchant-attendance-invitation-retry-fixture.mjs';
import {assertLifecycleSandbox,lifecycleId as id} from './merchant-attendance-lifecycle-native-support.mjs';
import {validateInvitationRetryRpcInput,validateInvitationRecoveryRead,createInvitationRetryRecoveryRead} from './merchant-attendance-invitation-retry-native.mjs';

const require=createRequire(import.meta.url);
const {createAttendanceEmployeeManagementReadTransport}=require('./fixtures/attendance-employee-management-read-transport.ts');
const site='99990001',ownerId=id(99);
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');
const actorIds=new Set([id(1),id(2),id(3)]);
const protectedTables=['merchants','merchant_enterprise_roles','merchant_enterprise_role_boards',
  'merchant_task_boards','merchant_task_columns','merchant_tasks','merchant_task_assignees','merchant_task_events',
  'merchant_attendance_workers','merchant_attendance_employment_periods','merchant_attendance_events',
  'merchant_attendance_settings','merchant_attendance_locations','faolla_schema_migrations'];

/** Pure SQL construction; passing tokens here does not claim any SQL executed. */
export function invitationBrowserSeedPlan(tokens){
  assert(Array.isArray(tokens)&&tokens.length===3&&new Set(tokens).size===3,'invitation_browser_distinct_tokens_required');
  for(const token of tokens)assert(typeof token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(token),'invitation_browser_token_shape_required');
  const actors=[1,2,3].map(n=>({id:id(n),email:`invite-retry-${n}@example.test`}));
  const invitations=actors.map((actor,index)=>({n:index+1,employeeId:id(101+index),actor,token:tokens[index],version:7,
    policy:index===1?'required':'waived',displayName:`合成受邀员工${index+1}`}));
  const identitiesSql=`insert into public.merchants(id,user_id) values('${site}','${ownerId}');
    insert into public.merchant_enterprise_roles(id,merchant_id,name,system_key,permissions) values
    ${['employee','supervisor','administrator'].map((key,index)=>`('${id(30+index)}','${site}','合成邀请角色${index+1}','${key}',array['enterprise.view'])`).join(',')};`;
  const invitationsSql=invitations.map(item=>`insert into public.merchant_enterprise_employees(
    id,merchant_id,auth_user_id,email,display_name,role_id,status,invitation_version,invitation_token_hash,
    invitation_expires_at,invitation_revoked_at,initial_password_policy) values(
    '${item.employeeId}','${site}','${item.actor.id}',${quote(item.actor.email)},${quote(item.displayName)},'${id(30)}',
    'invited',7,${quote(hash(item.token))},clock_timestamp()+interval '1 day',null,'${item.policy}');`).join('\n');
  const workspaceSql=`insert into public.merchant_task_boards(id,merchant_id,name,system_key)
    values('${id(401)}','${site}','合成默认看板','default');
    insert into public.merchant_task_columns(id,merchant_id,board_id,name,system_key,position,is_done) values
    ${['todo','in_progress','blocked','done'].map((key,index)=>`('${id(410+index)}','${site}','${id(401)}','合成工作列${index}','${key}',${index},${key==='done'})`).join(',')};`;
  return {site,ownerId,actors,invitations,identitiesSql,invitationsSql,workspaceSql};
}

/** A failed/malformed recovery candidate never falls back to a broader reader. */
export function isInvitationBrowserRecoveryRead(request){
  const url=new URL(request.url);
  return url.pathname==='/rest/v1/merchant_enterprise_employees'&&
    ['invitation_version','accepted_at','invitation_revoked_at','invitation_token_hash'].some(key=>url.searchParams.has(key));
}

function guardFor(owned){
  return `do $owned$ begin if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.oid='public.merchants'::regclass and c.oid=${owned.tableOid} and n.oid=${owned.oid}
    and n.nspname=${quote(owned.schema)} and n.nspowner::regrole::text='postgres'
    and obj_description(n.oid,'pg_namespace')=${quote(owned.marker)})
    then raise exception 'invitation_browser_owned_schema_required';end if;end;$owned$;`;
}

/** rawExec must already rewrite public qualifiers into the caller-owned schema. */
export function createInvitationBrowserTransport(rawExec,owned){
  assert.equal(typeof rawExec,'function');
  assert.deepEqual(assertLifecycleSandbox(rawExec),owned,'invitation_browser_namespace_changed');
  const ownedGuard=guardFor(owned),transportErrors=[],rpcCalls=[];
  const exec=source=>{
    assert.equal(typeof source,'string');
    assert.deepEqual(assertLifecycleSandbox(rawExec),owned,'invitation_browser_namespace_changed');
    // Keep the OID/owner/marker check in the same transaction as each query or
    // fixture write. Existing reader transactions retain their READ ONLY flag.
    const begin=/^(\s*begin(?:\s+read\s+only)?\s*;)/i;
    const guarded=begin.test(source)?source.replace(begin,`$1reset role;${ownedGuard}\n`)
      :`begin;reset role;${ownedGuard}\n${source}\ncommit;`;
    return rawExec(guarded);
  };
  const rpc=async(name,args)=>{
    let input;
    try{
      input=validateInvitationRetryRpcInput(name,args);
      assert(actorIds.has(input.auth_user_id),'invitation_browser_rpc_subject_forbidden');
    }catch{transportErrors.push('invitation_browser_rpc_forbidden');throw Error('invitation_browser_rpc_forbidden');}
    const record={name,error:null};rpcCalls.push(record);
    try{
      const result=JSON.parse(exec(`begin;reset role;set local role service_role;
        select jsonb_build_object('role',current_user,'data',public.${name}(${quote(JSON.stringify(input))}::jsonb));commit;`));
      assert.equal(result.role,'service_role');return {data:result.data,error:null};
    }catch(error){
      const code=String(error).match(/ERROR:\s+([a-z_]+)/)?.[1];
      if(!code||! /^(?:employee_|merchant_|enterprise_)[a-z_]+$/.test(code)){
        transportErrors.push('invitation_browser_rpc_failed');throw Error('invitation_browser_rpc_failed');
      }
      record.error=code;return {data:null,error:{message:code}};
    }
  };
  const management=createAttendanceEmployeeManagementReadTransport(exec,{syntheticAuthUserIds:[...actorIds]});
  const recovery=createInvitationRetryRecoveryRead(exec,{owned,ownedGuard,fallback:management.read});
  const read=request=>{
    if(!isInvitationBrowserRecoveryRead(request))return management.read(request);
    try{
      const input=validateInvitationRecoveryRead(request);
      assert(actorIds.has(input.actorId),'invitation_browser_recovery_subject_forbidden');
    }catch{transportErrors.push('invitation_browser_recovery_forbidden');throw Error('invitation_browser_recovery_forbidden');}
    return recovery.read(request);
  };
  const facts=()=>JSON.parse(exec(`reset role;select jsonb_build_object(
    'employees',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.merchant_enterprise_employees t),
    'setups',(select coalesce(jsonb_agg(to_jsonb(t) order by employee_id),'[]'::jsonb) from public.merchant_employee_initial_password_setups t),
    'audits',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.merchant_enterprise_audit_events t));`));
  const protectedFingerprint=()=>exec(`reset role;select md5(jsonb_build_object(${protectedTables.map(table=>
    `${quote(table)},(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.${table} t)`).join(',')})::text);`);
  return {owned,ownedGuard,exec,rpc,read,facts,protectedFingerprint,rpcCalls,
    readCalls:management.calls,recoveryCalls:recovery.calls,
    get errors(){return [...transportErrors,...management.errors,...recovery.errors];}};
}

export async function prepareInvitationBrowser(native,scope){
  assert.equal(typeof native.query,'function');assert.equal(typeof scope.sql,'function');
  const rawExec=source=>native.query(scope.sql(source));
  const owned=assertLifecycleSandbox(rawExec);assert.equal(scope.schema,owned.schema,'invitation_browser_scope_mismatch');
  const transport=createInvitationBrowserTransport(rawExec,owned);
  const plan=invitationBrowserSeedPlan(Array.from({length:3},()=>randomBytes(32).toString('base64url')));
  // Only a fresh owned namespace is accepted. Never replace an existing tenant,
  // employee/role, workspace or invitation to make the acceptance scenario pass.
  transport.exec(`do $empty$ begin if exists(select 1 from public.merchants)
    or exists(select 1 from public.merchant_enterprise_roles)
    or exists(select 1 from public.merchant_enterprise_employees)
    then raise exception 'invitation_browser_empty_namespace_required';end if;end;$empty$;
    ${plan.identitiesSql}`);
  await prepareAttendanceEmployeeManagement(native,scope);
  await prepareAttendanceInvitationRetry(native,scope);
  transport.exec(`${plan.invitationsSql}\n${plan.workspaceSql}`);
  const initial=transport.facts();
  assert.equal(initial.employees.length,3);assert.equal(initial.setups.length,0);
  for(const item of plan.invitations){
    const employee=initial.employees.find(row=>row.id===item.employeeId);
    assert(employee&&employee.merchant_id===site&&employee.auth_user_id===item.actor.id&&employee.status==='invited'
      &&employee.accepted_at===null&&employee.invitation_version===7&&employee.initial_password_policy===item.policy
      &&employee.invitation_token_hash===hash(item.token),'invitation_browser_invited_seed_required');
  }
  const counts=JSON.parse(transport.exec(`select jsonb_build_object(
    'roles',(select count(*) from public.merchant_enterprise_roles),
    'boards',(select count(*) from public.merchant_task_boards),
    'columns',(select count(*) from public.merchant_task_columns),
    'workers',(select count(*) from public.merchant_attendance_workers),
    'events',(select count(*) from public.merchant_attendance_events),
    'settings',(select count(*) from public.merchant_attendance_settings),
    'locations',(select count(*) from public.merchant_attendance_locations));`));
  assert.deepEqual(counts,{roles:3,boards:1,columns:4,workers:0,events:0,settings:0,locations:0});
  // Do not copy getter properties with object spread: errors must remain live.
  return Object.assign(transport,{site,ownerId,actors:plan.actors,invitations:plan.invitations,
    syntheticOnly:true,seededInvitedEmployees:3,seededActiveEmployees:0,seededAttendanceEvents:0});
}
