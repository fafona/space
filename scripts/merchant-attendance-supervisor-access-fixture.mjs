// Local owned-schema infrastructure only. The four matrix events below are
// synthetic historical prestate, not evidence of actual clock submissions.
// Role edits, scope writes and record authorization always execute original SQL.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id} from './merchant-attendance-lifecycle-native-support.mjs';
import {prepareAttendanceEmployeeManagement} from './merchant-attendance-employee-management-fixture.mjs';
import {prepareAttendanceRoleManagement} from './merchant-attendance-role-management-fixture.mjs';

const require=createRequire(import.meta.url);
const {createAttendanceEmployeeManagementReadTransport}=require('./fixtures/attendance-employee-management-read-transport.ts');
const {attendanceSelfUuid}=require('../src/lib/merchantAttendanceSelf.ts');
const {parseAttendanceScopeCommand,parseAttendanceRecordsQuery,ATTENDANCE_MANAGEMENT_ERRORS}=require('../src/lib/merchantAttendanceManagement.ts');
const {parseAttendanceChoicesQuery}=require('../src/lib/merchantAttendanceChoices.ts');
const site='99990001',ownerId=id(99),managerAuth=id(1),managerEmployee=id(101),roleId=id(30);
const workers=Object.freeze([id(201),id(202)]),locations=Object.freeze([id(301),id(302)]);
const labels=Object.freeze({manager:'合成主管甲',role:'合成员工角色',
  workerNames:Object.freeze(['合成范围员工甲','合成范围员工乙']),
  workerNos:Object.freeze(['SUPERVISOR-123-A','SUPERVISOR-123-B']),
  locationNames:Object.freeze(['合成授权地点','合成未授权地点'])});
const roleName='faolla_update_merchant_enterprise_role_v3',scopeName='faolla_attendance_scopes_v1';
const recordsName='faolla_attendance_records_v1',choicesName='faolla_attendance_choices_v1';
const rpcNames=Object.freeze([roleName,scopeName,recordsName,choicesName]);
const roleKeys=['merchant_id','role_id','expected_version','actor_type','actor_id','permissions','name','description','access_scope','allowed_board_ids'];
const recordKeys=['access','fromAt','toAt','workerId','locationId','asOf','cursorAt','cursorId'];
const permissions=new Set(['enterprise.view','attendance.records.view']);
const knownErrors=new Set([...Object.keys(ATTENDANCE_MANAGEMENT_ERRORS),
  'invalid_role_update','invalid_role_actor','invalid_role','invalid_role_status','invalid_permissions',
  'invalid_permission_dependencies','invalid_role_board_access','invalid_site_id','role_not_found',
  'enterprise_version_conflict','permission_escalation_denied','system_role_protected','role_in_use','role_board_access_in_use']);
const factTables={roles:'merchant_enterprise_roles',scopes:'merchant_attendance_scopes',
  grants:'merchant_attendance_scope_grants',scopeOperations:'merchant_attendance_scope_operations',audits:'merchant_enterprise_audit_events'};
const mutableTables=new Set([...Object.values(factTables),'merchant_attendance_scope_workers','merchant_attendance_scope_locations']);
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const json=value=>value===null?'null':`${quote(JSON.stringify(value))}::jsonb`;
const exact=(value,keys)=>{
  assert(value&&typeof value==='object'&&!Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(),[...keys].sort());
};
const uuidOrNull=value=>value===null?null:attendanceSelfUuid(value);
const scopedId=(value,ids)=>{assert(ids.includes(value));return value;};

/** Pure statement construction, not a claim that these statements executed. */
export function supervisorAccessSeedPlan(date){
  assert(typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date));
  assert.equal(new Date(`${date}T00:00:00.000Z`).toISOString().slice(0,10),date);
  const owner={id:ownerId,email:'owner-entry@example.test'},manager={id:managerAuth,email:'employee-a@example.test'};
  const roles=['employee','supervisor','administrator'].map((systemKey,index)=>({id:id(30+index),
    name:[labels.role,'合成主管角色','合成管理角色'][index],systemKey}));
  const events=workers.flatMap((workerId,w)=>locations.map((locationId,l)=>({id:id(1001+w*2+l),workerId,locationId,
    operationId:id(2001+w*2+l),sequence:l+1,action:l===0?'clock_in':'clock_out',
    occurredAt:`${date}T12:${String(w*2+l).padStart(2,'0')}:00.000123Z`})));
  const seedSql=`insert into public.merchants(id,user_id) values('${site}','${ownerId}');
    insert into public.merchant_enterprise_roles(id,merchant_id,name,system_key,permissions) values
    ${roles.map(row=>`('${row.id}','${site}',${quote(row.name)},'${row.systemKey}',array['enterprise.view'])`).join(',')};
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status,accepted_at)
    values('${managerEmployee}','${site}','${managerAuth}',${quote(manager.email)},${quote(labels.manager)},'${roleId}','active',clock_timestamp());
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled)
    values('${site}','UTC',false,false);
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values
    ${locations.map((locationId,index)=>`('${locationId}','${site}',${quote(labels.locationNames[index])},'UTC',true)`).join(',')};
    insert into public.merchant_attendance_workers(id,merchant_id,worker_no,display_name,active,default_location_id) values
    ${workers.map((workerId,index)=>`('${workerId}','${site}',${quote(labels.workerNos[index])},${quote(labels.workerNames[index])},true,'${locations[index]}')`).join(',')};
    insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,time_zone,occurred_at,received_at) values
    ${events.map(event=>`('${event.id}','${site}','${event.workerId}','${event.locationId}','${event.operationId}',${event.sequence},'${event.action}','web','UTC','${event.occurredAt}'::timestamptz,'${event.occurredAt}'::timestamptz)`).join(',')};`;
  const workspaceSql=`insert into public.merchant_task_boards(id,merchant_id,name,system_key)
    values('${id(401)}','${site}','合成默认看板','default');
    insert into public.merchant_task_columns(id,merchant_id,board_id,name,system_key,position,is_done) values
    ${['todo','in_progress','blocked','done'].map((key,index)=>`('${id(410+index)}','${site}','${id(401)}','合成工作列${index}','${key}',${index},${key==='done'})`).join(',')};`;
  return {site,owner,manager,actors:[owner,manager],managerEmployee,roleId,workers:[...workers],locations:[...locations],labels,date,
    allowedIds:[events[0].id],forbiddenIds:events.slice(1).reverse().map(event=>event.id),events,seedSql,workspaceSql};
}

/** Every statement is fenced by the original namespace OID, owner and marker. */
export function createSupervisorAccessOwnedExec(rawExec,owned){
  assert.equal(typeof rawExec,'function');
  assert.deepEqual(assertLifecycleSandbox(rawExec),owned,'supervisor_access_namespace_changed');
  const guard=`do $owned$ begin if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.oid='public.merchants'::regclass and c.oid=${owned.tableOid} and n.oid=${owned.oid}
    and n.nspname=${quote(owned.schema)} and n.nspowner::regrole::text='postgres'
    and obj_description(n.oid,'pg_namespace')=${quote(owned.marker)})
    then raise exception 'supervisor_access_owned_schema_required';end if;end;$owned$;`;
  return source=>{
    assert.equal(typeof source,'string');
    assert.deepEqual(assertLifecycleSandbox(rawExec),owned,'supervisor_access_namespace_changed');
    const begin=/^(\s*begin(?:\s+read\s+only)?\s*;)/i;
    return rawExec(begin.test(source)?source.replace(begin,`$1reset role;${guard}\n`):`begin;reset role;${guard}\n${source}\ncommit;`);
  };
}

/** Validate shape and fixture bounds, leaving all actual authorization to SQL. */
export function validateSupervisorAccessRpcInput(name,args,roleMetadata){
  assert(rpcNames.includes(name));
  if(name===roleName){
    exact(args,['p_input']);const input=args.p_input;exact(input,roleKeys);
    assert.equal(input.merchant_id,site);assert.equal(input.role_id,roleId);
    assert.equal(input.actor_type,'owner');assert.equal(input.actor_id,ownerId);
    assert(Number.isSafeInteger(input.expected_version)&&input.expected_version>=1&&input.expected_version<Number.MAX_SAFE_INTEGER);
    assert(Array.isArray(input.permissions)&&input.permissions.length>=1&&input.permissions.length<=2);
    assert.equal(new Set(input.permissions).size,input.permissions.length);assert(input.permissions.every(value=>permissions.has(value)));
    assert(roleMetadata&&roleMetadata.id===roleId&&roleMetadata.merchant_id===site&&roleMetadata.access_scope==='all');
    assert.equal(input.name,roleMetadata.name);assert.equal(input.description,roleMetadata.description);
    assert.equal(input.access_scope,'all');assert.deepEqual(input.allowed_board_ids,[]);return args;
  }
  exact(args,name===scopeName?['p_site_id','p_auth_user_id','p_employee_id','p_command','p_operation_id']:
    ['p_site_id','p_auth_user_id','p_query']);
  assert.equal(args.p_site_id,site);assert([ownerId,managerAuth].includes(args.p_auth_user_id));
  if(name===scopeName){
    assert.equal(args.p_employee_id,managerEmployee);assert.equal(uuidOrNull(args.p_operation_id),args.p_operation_id);
    if(args.p_command!==null){
      assert.equal(args.p_operation_id,null);
      const parsed=parseAttendanceScopeCommand({siteId:site,employeeId:managerEmployee,...args.p_command});
      assert.deepEqual(args.p_command,parsed.command);
      if(parsed.command.grant){
        for(const workerId of parsed.command.grant.workerIds)scopedId(workerId,workers);
        for(const locationId of parsed.command.grant.locationIds)scopedId(locationId,locations);
      }
    }
    return args;
  }
  const query=args.p_query,url=new URL('https://attendance-auth.invalid/query');url.searchParams.set('siteId',site);
  if(name===recordsName){
    exact(query,recordKeys);
    for(const key of recordKeys){
      if(query[key]!==null){assert.equal(typeof query[key],'string');url.searchParams.set(key,query[key]);}
    }
    const {siteId,...parsed}=parseAttendanceRecordsQuery(url.href);assert.equal(siteId,site);assert.deepEqual(query,parsed);
    if(query.workerId!==null)scopedId(query.workerId,workers);
    if(query.locationId!==null)scopedId(query.locationId,locations);
  }else{
    assert(query&&typeof query==='object');
    exact(query,Object.hasOwn(query,'ids')?['kind','ids']:['kind','search','cursor']);
    assert.equal(typeof query.kind,'string');url.searchParams.set('kind',query.kind);
    if(Object.hasOwn(query,'ids')){
      assert(Array.isArray(query.ids));
      for(const value of query.ids)assert.equal(attendanceSelfUuid(value),value);
      url.searchParams.set('ids',query.ids.join(','));
    }else{
      assert.equal(typeof query.search,'string');assert.equal(uuidOrNull(query.cursor),query.cursor);
      url.searchParams.set('search',query.search);if(query.cursor!==null)url.searchParams.set('cursor',query.cursor);
    }
    const parsed=parseAttendanceChoicesQuery(url.href);
    assert.deepEqual(query,parsed.ids?{kind:parsed.kind,ids:parsed.ids}:{kind:parsed.kind,search:parsed.search,cursor:parsed.cursor});
    const ids=query.kind==='managers'?[managerEmployee]:query.kind==='workers'?workers:locations;
    for(const value of query.ids??(query.cursor===null?[]:[query.cursor]))scopedId(value,ids);
  }
  return args;
}

export function createSupervisorAccessTransport(exec,owned){
  assert.deepEqual(assertLifecycleSandbox(exec),owned,'supervisor_access_namespace_changed');
  const roleRows=JSON.parse(exec(`reset role;select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)
    from public.merchant_enterprise_roles t where merchant_id='${site}' and id='${roleId}';`));
  assert(Array.isArray(roleRows)&&roleRows.length===1,'supervisor_access_original_role_required');
  const metadata=roleRows[0];
  assert.equal(metadata.id,roleId);assert.equal(metadata.merchant_id,site);assert.equal(metadata.name,labels.role);
  assert.equal(metadata.description,'');assert.equal(metadata.access_scope,'all');
  assert.equal(exec(`reset role;select count(*) from public.merchant_enterprise_role_boards where merchant_id='${site}';`),'0');
  const calls=[],errors=[];
  const management=createAttendanceEmployeeManagementReadTransport(exec,{syntheticAuthUserIds:[ownerId,managerAuth]});
  const rpc=async(name,args)=>{
    try{validateSupervisorAccessRpcInput(name,args,metadata);}
    catch{errors.push('supervisor_access_rpc_forbidden');throw Error('supervisor_access_rpc_forbidden');}
    const call={name,input:structuredClone(args),error:null};calls.push(call);
    const params=name===roleName?json(args.p_input):name===scopeName?
      [quote(args.p_site_id),quote(args.p_auth_user_id),quote(args.p_employee_id),json(args.p_command),args.p_operation_id===null?'null':quote(args.p_operation_id)].join(','):
      [quote(args.p_site_id),quote(args.p_auth_user_id),json(args.p_query)].join(',');
    try{
      assert.deepEqual(assertLifecycleSandbox(exec),owned,'supervisor_access_namespace_changed');
      const result=JSON.parse(exec(`begin;reset role;set local role service_role;
        select jsonb_build_object('role',current_user,'data',public.${name}(${params}));commit;`));
      assert.equal(result.role,'service_role');assert(Object.hasOwn(result,'data'));
      return {data:result.data,error:null};
    }catch(error){
      const code=String(error).match(/ERROR:\s+([a-z_]+)(?=\r?\n|$)/)?.[1];
      if(code&&knownErrors.has(code)){call.error=code;return {data:null,error:{message:code}};}
      errors.push('supervisor_access_rpc_failed');throw Error('supervisor_access_rpc_failed');
    }
  };
  return {rpc,read:management.read,calls,readCalls:management.calls,rpcNames,
    get errors(){return [...errors,...management.errors];}};
}

export function createSupervisorAccessOracles(exec,owned){
  const catalog=()=>JSON.parse(exec(`reset role;select coalesce(jsonb_agg(jsonb_build_object('name',relname,'oid',oid::bigint) order by relname),'[]'::jsonb)
    from pg_class where relnamespace=${owned.oid} and relkind in('r','p');`));
  const original=catalog();assert(Array.isArray(original)&&original.length>0);
  const names=new Set();
  for(const row of original){
    assert(typeof row.name==='string'&&/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(row.name)&&row.name.length<=63);
    assert(Number.isSafeInteger(row.oid)&&row.oid>0&&!names.has(row.name));names.add(row.name);
  }
  for(const name of [...mutableTables,'merchants','merchant_enterprise_employees','merchant_attendance_events',
    'merchant_attendance_workers','merchant_attendance_locations','merchant_attendance_settings','faolla_schema_migrations',
    'merchant_task_boards','merchant_task_columns','merchant_enterprise_role_boards'])assert(names.has(name),'supervisor_access_required_table_missing');
  const protectedTables=original.filter(row=>!mutableTables.has(row.name)).map(row=>row.name);
  const rows=table=>`(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.${table} t)`;
  const facts=()=>JSON.parse(exec(`reset role;select jsonb_build_object(
    ${Object.entries(factTables).filter(([key])=>key!=='grants').map(([key,table])=>`${quote(key)},${rows(table)}`).join(',')},
    'grants',(select coalesce(jsonb_agg(to_jsonb(g)||jsonb_build_object(
      'workerIds',(select coalesce(jsonb_agg(worker_id order by worker_id),'[]'::jsonb) from public.merchant_attendance_scope_workers w
        where w.merchant_id=g.merchant_id and w.employee_id=g.employee_id and w.grant_id=g.id),
      'locationIds',(select coalesce(jsonb_agg(location_id order by location_id),'[]'::jsonb) from public.merchant_attendance_scope_locations l
        where l.merchant_id=g.merchant_id and l.employee_id=g.employee_id and l.grant_id=g.id)) order by g.id),'[]'::jsonb)
      from public.merchant_attendance_scope_grants g));`));
  const protectedFingerprint=()=>{
    assert.deepEqual(catalog(),original,'supervisor_access_table_catalog_changed');
    return exec(`reset role;select md5(jsonb_build_object(${protectedTables.map(table=>`${quote(table)},${rows(table)}`).join(',')})::text);`);
  };
  return {facts,protectedFingerprint,protectedTables:Object.freeze(protectedTables)};
}

export async function prepareAttendanceSupervisorAccessFixture(native,scope){
  assert.equal(typeof native.query,'function');assert.equal(typeof scope.sql,'function');
  const rawExec=source=>native.query(scope.sql(source)),owned=assertLifecycleSandbox(rawExec);
  assert.equal(scope.schema,owned.schema);
  const exec=createSupervisorAccessOwnedExec(rawExec,owned);
  const emptyTables=['merchants','merchant_enterprise_roles','merchant_enterprise_employees','merchant_attendance_settings',
    'merchant_attendance_workers','merchant_attendance_locations','merchant_attendance_events',
    'merchant_attendance_scopes','merchant_attendance_scope_grants','merchant_attendance_scope_operations'];
  const empty=JSON.parse(exec(`reset role;select jsonb_build_object(${emptyTables.map(table=>`${quote(table)},(select count(*) from public.${table})`).join(',')});`));
  assert.deepEqual(empty,Object.fromEntries(emptyTables.map(table=>[table,0])),'supervisor_access_fresh_namespace_required');
  const date=exec(`reset role;select to_char((clock_timestamp() at time zone 'UTC')::date-1,'YYYY-MM-DD');`);
  const plan=supervisorAccessSeedPlan(date);exec(plan.seedSql);
  const employeePreparation=await prepareAttendanceEmployeeManagement(native,scope);
  exec(plan.workspaceSql);
  const rolePreparation=await prepareAttendanceRoleManagement(native,scope);
  assert.deepEqual(assertLifecycleSandbox(rawExec),owned,'supervisor_access_namespace_changed');
  const transport=createSupervisorAccessTransport(exec,owned),oracles=createSupervisorAccessOracles(exec,owned);
  const initial=oracles.facts();
  assert.equal(initial.roles.length,3);assert(initial.roles.every(row=>row.permissions.length===1&&row.permissions[0]==='enterprise.view'));
  for(const key of ['scopes','grants','scopeOperations','audits'])assert.deepEqual(initial[key],[],'supervisor_access_empty_authorization_prestate_required');
  const {seedSql:unusedSeed,workspaceSql:unusedWorkspace,...publicPlan}=plan;
  void unusedSeed;void unusedWorkspace;
  return {...publicPlan,exec,owned,rpc:transport.rpc,read:transport.read,calls:transport.calls,readCalls:transport.readCalls,
    rpcNames:transport.rpcNames,...oracles,employeePreparation,rolePreparation,syntheticOnly:true,
    get errors(){return transport.errors;}};
}
