// Local owned-schema infrastructure only. Pairing, PIN setup, KDF verification
// and punches belong to the actual services/UI; this preparation performs none.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {assertLifecycleSandbox,lifecycleId as id} from './merchant-attendance-lifecycle-native-support.mjs';

const require=createRequire(import.meta.url);
const {createAttendanceAuditShellTransport}=require('./fixtures/attendance-audit-shell-transport.ts');
const {TERMINAL_ERRORS}=require('../src/lib/merchantAttendanceTerminal.ts');
const {PIN_ERRORS}=require('../src/lib/merchantAttendancePin.ts');
const {PIN_CLOCK_ERRORS}=require('../src/lib/merchantAttendancePinClock.ts');
const migrations=[
  '202610010104_merchant_attendance_terminals.sql',
  '202610010106_merchant_attendance_pin_credentials.sql',
  '202610010107_merchant_attendance_pin_clock.sql',
  '202610020112_merchant_attendance_pin_clock_identity.sql',
];
const tables=['merchant_attendance_terminals','merchant_attendance_terminal_audit','merchant_attendance_pin_credentials',
  'merchant_attendance_pin_audit','merchant_attendance_pin_attempts','merchant_attendance_pin_clock_receipts'];
const signatures={
  faolla_attendance_terminal_admin_v1:'text,uuid,jsonb,jsonb,boolean',
  faolla_attendance_terminal_device_v1:'text,uuid,text,text,boolean',
  faolla_attendance_pin_admin_v1:'text,uuid,text,uuid,jsonb,boolean',
  faolla_attendance_pin_begin_v1:'text,uuid,text,text,uuid,boolean',
  faolla_attendance_pin_finish_v1:'text,uuid,text,text,uuid,boolean,boolean',
  faolla_attendance_pin_clock_v1:'text,uuid,text,text,uuid,boolean,jsonb,boolean',
};
const keys={
  faolla_attendance_terminal_admin_v1:['p_site','p_auth','p_query','p_command','p_allow_create'],
  faolla_attendance_terminal_device_v1:['p_site','p_id','p_secret_hash','p_device_hash','p_allow_pair'],
  faolla_attendance_pin_admin_v1:['p_site','p_auth','p_no','p_operation','p_command','p_allow_set'],
  faolla_attendance_pin_begin_v1:['p_site','p_terminal','p_secret_hash','p_no','p_lease','p_allow'],
  faolla_attendance_pin_finish_v1:['p_site','p_terminal','p_secret_hash','p_no','p_lease','p_verified','p_allow'],
  faolla_attendance_pin_clock_v1:['p_site','p_terminal','p_secret_hash','p_no','p_lease','p_verified','p_request','p_allow_new'],
};
const rpcNames=Object.freeze(Object.keys(keys));
const fixed={site:'99990001',ownerId:id(99),employeeAuthId:id(1),workerId:id(201),placeId:id(301)};
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
const array=values=>`array[${values.map(literal).join(',')}]`;
function exact(value,fields){
  return value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value))
    &&Reflect.ownKeys(value).length===fields.length&&fields.every(field=>Object.hasOwn(value,field));
}
function checkBinding(options){
  assert(exact(options,Object.keys(fixed)),'pin_management_binding_fields');
  for(const key of Object.keys(fixed))assert(options[key]===fixed[key],'pin_management_synthetic_binding_required');
  return {...options};
}
function validWorkerNo(value){return typeof value==='string'&&value===value.trim()&&Array.from(value).length>=1
  &&Array.from(value).length<=40&&!/[\u0000-\u001f\u007f-\u009f]/.test(value);}
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:null;
const project=(value,fields)=>{
  const raw=object(value);if(!raw)return null;
  return Object.fromEntries(fields.filter(field=>Object.hasOwn(raw,field)
    &&(raw[field]===null||['string','number','boolean'].includes(typeof raw[field]))).map(field=>[field,raw[field]]));
};

// Closed HTTP-log projection, not a request parser. The real handler MUST receive
// the original body. Unknown paths/bodies fail closed instead of being echoed.
export function sanitizePinManagementBody(pathname,body){
  const raw=object(body);if(!raw)return null;
  switch(pathname){
    case '/api/merchant-enterprise/attendance/terminal-device': return project(raw,['action']);
    case '/api/merchant-enterprise/attendance/terminals': return {...project(raw,['siteId']),
      command:project(raw.command,['action','terminalId','locationId','label'])};
    case '/api/merchant-enterprise/attendance/pin-credentials': return {...project(raw,['siteId','workerNo']),
      command:project(raw.command,['action','operationId','expectedRevision','workerId','employeeId'])};
    case '/api/merchant-enterprise/attendance/terminal-clock': return {...project(raw,['workerNo','operationId']),
      command:project(raw.command,['expectedWorkerId','expectedEmployeeId','operationId','locationId','action','expectedSequence'])};
    default:return null;
  }
}

// Browser/driver failures can echo fill arguments, cookies and whole SQL even
// after HTTP bodies were projected. Apply this before storing ANY diagnostic.
export function redactPinManagementDiagnostics(value){
  return String(value instanceof Error?value.stack??value.message:value)
    .replace(/\d{8}\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}/gi,'[pair-token-redacted]')
    .replace(/eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[jwt-redacted]')
    .replace(/(?<!\d)\d{8,12}(?!\d)/g,'[numeric-secret-redacted]')
    .replace(/[a-f0-9]{32,}/gi,'[hash-redacted]')
    .replace(/[A-Za-z0-9_+/=-]{43,}/g,'[opaque-secret-redacted]');
}

export function pinManagementFixturePlan(root){
  assert.equal(typeof root,'string');assert(path.isAbsolute(root),'pin_management_root_required');
  return migrations.map(name=>({name,source:readFileSync(path.join(root,'scripts/supabase-migrations',name),'utf8')}));
}

export function createAttendancePinManagementTransport(exec,options){
  assert.equal(typeof exec,'function');
  const {employeeId,workerNo,...input}=options,bound=checkBinding(input);
  assert(employeeId===id(101)&&validWorkerNo(workerNo),'pin_management_employee_binding_required');
  assertLifecycleSandbox(exec);
  const base=createAttendanceAuditShellTransport(exec),errors=[];
  const rpc=async(name,args)=>{
    // Reuse every existing exact-shape/UUID/hash/boolean/PIN request validator,
    // while excluding the audit transport's unrelated RPCs and tenant actors.
    try{
      assert(Object.hasOwn(keys,name)&&exact(args,keys[name]));assert(args.p_site===bound.site);
      if(Object.hasOwn(args,'p_auth'))assert([bound.ownerId,bound.employeeAuthId].includes(args.p_auth));
      if(Object.hasOwn(args,'p_no'))assert(validWorkerNo(args.p_no)&&args.p_no.toLowerCase()===workerNo.toLowerCase());
      if(name==='faolla_attendance_terminal_admin_v1'&&args.p_command?.action==='create')assert(args.p_command.locationId===bound.placeId);
      if(name==='faolla_attendance_pin_admin_v1'&&args.p_command!==null){
        assert(args.p_command.workerId===bound.workerId);
        assert(args.p_command.employeeId===employeeId||args.p_command.action==='revoke'&&args.p_command.employeeId===null);
      }
      if(name==='faolla_attendance_pin_clock_v1'&&args.p_request?.command!==null){
        const c=args.p_request.command;
        assert(c.expectedWorkerId===bound.workerId&&c.expectedEmployeeId===employeeId&&c.locationId===bound.placeId);
      }
    }catch{throw Error('pin_management_invalid_rpc_arguments');}
    const before=base.calls.length;
    try{
      const result=await base.rpc(name,args);
      if(result.error){
        const known=name==='faolla_attendance_pin_clock_v1'?PIN_CLOCK_ERRORS:name.startsWith('faolla_attendance_pin_')?PIN_ERRORS:TERMINAL_ERRORS;
        if(!Object.hasOwn(known,result.error.message??'')){
          errors.push('pin_management_sql_failure');return {data:null,error:{message:'attendance_unavailable'}};
        }
      }
      return result;
    }catch{
      // Even a rejected argument containing secrets must never escape inside
      // AssertionError.actual/expected or a PostgreSQL echoed statement.
      if(base.calls.length===before)throw Error('pin_management_invalid_rpc_arguments');
      errors.push('pin_management_sql_failure');return {data:null,error:{message:'attendance_unavailable'}};
    }
  };
  return {rpc,rpcNames,calls:base.calls,errors};
}

export async function prepareAttendancePinManagement(native,scope,options){
  assert.equal(typeof native.query,'function');assert.equal(typeof scope.sql,'function');
  const bound=checkBinding(options),exec=source=>native.query(scope.sql(source)),owned=assertLifecycleSandbox(exec);
  assert.equal(scope.schema,owned.schema,'pin_management_scope_mismatch');
  const plan=pinManagementFixturePlan(native.root);
  const guard=`do $owned$ begin
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.oid='public.merchants'::regclass and c.oid=${owned.tableOid} and n.oid=${owned.oid}
        and n.nspname=${literal(owned.schema)} and n.nspowner::regrole::text='postgres'
        and obj_description(n.oid,'pg_namespace')=${literal(owned.marker)})
      then raise exception 'pin_management_owned_schema_required';end if;
    if (select count(*) from public.merchants)<>1 or not exists(select 1 from public.merchants m
      where m.id='${bound.site}' and '${bound.ownerId}'::uuid=any(array[m.user_id,m.auth_user_id,m.owner_user_id,m.owner_id,m.auth_id,m.created_by,m.created_by_user_id]))
      or not exists(select 1 from public.merchant_attendance_workers w
        join public.merchant_enterprise_employees e on e.merchant_id=w.merchant_id and e.id=w.employee_id
        join public.merchant_attendance_locations l on l.merchant_id=w.merchant_id and l.id=w.default_location_id
        where w.merchant_id='${bound.site}' and w.id='${bound.workerId}' and w.active and e.status='active'
          and e.id='${id(101)}' and e.auth_user_id='${bound.employeeAuthId}' and l.id='${bound.placeId}' and l.active)
      then raise exception 'pin_management_seed_binding_required';end if;
  end;$owned$;`;
  const protectedTables=['merchants','merchant_enterprise_employees','merchant_enterprise_roles','merchant_attendance_settings',
    'merchant_attendance_workers','merchant_attendance_locations','merchant_attendance_employment_periods','merchant_attendance_events','merchant_enterprise_audit_events'];
  const snapshot=`reset role;select jsonb_build_object(${protectedTables.map(table=>`${literal(table)},
    (select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) from public.${table} t)`).join(',')});`;
  const before=exec(snapshot);
  const qualify=source=>{const result=scope.sql(source);assert(!/\bpublic\./.test(result),'pin_management_qualifier_required');return result;};
  const steps=[qualify(`begin;reset role;${guard}do $empty$ begin
    if exists(select 1 from unnest(${array(tables)}) as target(name) where to_regclass('public.'||target.name) is not null)
      then raise exception 'pin_management_fixture_already_present';end if;end;$empty$;commit;`),
  ...plan.flatMap(item=>[qualify(`begin;reset role;${guard}commit;`),qualify(item.source)])];
  if(typeof native.querySteps==='function')await native.querySteps(steps);
  else for(const step of steps)native.query(step);
  assert.equal(exec(snapshot),before,'pin_management_preparation_changed_protected_facts');
  const installed=JSON.parse(exec(`reset role;select jsonb_build_object(
    'tables',(select count(*) from pg_class where relnamespace=${owned.oid} and relkind='r' and relname=any(${array(tables)})),
    'rows',${tables.map(table=>`(select count(*) from public.${table})`).join('+')},
    'serviceFunctions',(select count(*) from unnest(${array(Object.entries(signatures).map(([name,args])=>name+'('+args+')'))}) as target(signature)
      where has_function_privilege('service_role','public.'||target.signature,'EXECUTE')),
    'browserFunctions',(select count(*) from unnest(${array(Object.entries(signatures).map(([name,args])=>name+'('+args+')'))}) as target(signature)
      where has_function_privilege('anon','public.'||target.signature,'EXECUTE') or has_function_privilege('authenticated','public.'||target.signature,'EXECUTE')),
    'privateMember',has_function_privilege('service_role','public.faolla_attendance_pin_member_v1(text,text)','EXECUTE'),
    'privateSnapshot',has_function_privilege('service_role','public.faolla_attendance_terminal_snapshot_v1(text,uuid,timestamptz)','EXECUTE'),
    'tableDml',(select count(*) from unnest(${array(tables)}) as target(name)
      where has_table_privilege('service_role','public.'||target.name,'INSERT,UPDATE,DELETE,TRUNCATE')),
    'employeeId',w.employee_id,'workerNo',w.worker_no)
    from public.merchant_attendance_workers w where w.merchant_id='${bound.site}' and w.id='${bound.workerId}';`));
  assert(installed&&validWorkerNo(installed.workerNo),'pin_management_worker_number_required');
  assert.deepEqual(installed,{tables:6,rows:0,serviceFunctions:6,browserFunctions:0,privateMember:false,privateSnapshot:false,tableDml:0,
    employeeId:id(101),workerNo:installed.workerNo},'pin_management_preparation_mismatch');
  const transport=createAttendancePinManagementTransport(exec,{...bound,employeeId:installed.employeeId,workerNo:installed.workerNo});
  return {...transport,service:{rpc:transport.rpc},workerNo:installed.workerNo,employeeId:installed.employeeId,
    sourceMigrations:plan.map(item=>item.name),syntheticOnly:true,seededBusinessRows:0};
}
