//170 owns no runtime. Reuse169's minimal actual publication/approval/terminal
// setup in the caller's identity-checked namespace; no database or deps copy.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {prepareOnsiteScheduleNative} from './attendance-onsite-schedule-native.mjs';
import {boundClockRpcExpression,quote} from './attendance-bound-clocks-native.mjs';
import {lifecycleJson as json,lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
const require=createRequire(import.meta.url);
export const pinScheduleMigration='202610050143_merchant_attendance_pin_schedule.sql';
export const pinScheduleRpc='faolla_attendance_pin_schedule_v1';
export const pinScheduleReplaced=['faolla_attendance_self_schedule_guard_v1','faolla_attendance_shift_check_v1',
  'faolla_attendance_shift_plan_adoption_v1','faolla_attendance_shift_plan_adoption_guard_v1'];
export function pinScheduleExpression(a){
  assert.deepEqual(Object.keys(a).sort(),['p_site','p_terminal','p_secret_hash','p_no','p_lease','p_verified','p_request','p_allow_new','p_selection','p_allow_schedule','p_bind_rules'].sort());
  for(const key of ['p_verified','p_allow_new','p_allow_schedule','p_bind_rules'])assert.equal(typeof a[key],'boolean');
  assert.match(a.p_site,/^9999000[1-6]$/);
  return `public.${pinScheduleRpc}(${quote(a.p_site)},${quote(a.p_terminal)},${quote(a.p_secret_hash)},${quote(a.p_no)},${quote(a.p_lease)},${a.p_verified},${json(a.p_request)},${a.p_allow_new},${json(a.p_selection)},${a.p_allow_schedule},${a.p_bind_rules})`;
}
export function pinScheduleRequest(body,cookie,old=false){
  return new Request(`https://www.faolla.com/api/merchant-enterprise/attendance/${old?'terminal-clock':'terminal-schedule'}`,
    {method:'POST',headers:{origin:'https://www.faolla.com','sec-fetch-site':'same-origin','content-type':'application/json',cookie},body:JSON.stringify(body)});
}
export function pinScheduleOldDefinitions(d){
  const oids=d.exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f'
    and proname not in(${pinScheduleReplaced.map(quote).join(',')});`);
  return ()=>d.exec(`select md5(jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef) order by p.oid)::text)
    from pg_proc p where p.pronamespace=${d.owned.oid} and p.oid=any(${quote(oids)}::oid[]) and p.prokind='f';`);
}
export async function preparePinScheduleNative(native,scope){
  const onsite=await prepareOnsiteScheduleNative(native,scope),d=onsite,{exec,site,location,worker,auth,owner,employee,terminal,secret}=d;
  const tables=d.inventory().filter(t=>t!=='faolla_schema_migrations'),facts=d.fingerprint(tables),catalogBefore=JSON.parse(d.tableCatalog());
  const previousDefinitions=pinScheduleOldDefinitions(d),oldDefinitions=previousDefinitions();
  const migration=readFileSync(path.join(native.root,'scripts/supabase-migrations',pinScheduleMigration),'utf8');
  const firstCommit=migration.indexOf('commit;')+7,secondCommit=migration.indexOf('commit;',firstCommit)+7;
  native.query(scope.sql(migration.slice(0,firstCommit)));
  assert.equal(exec("select convalidated::text from pg_constraint where conrelid='public.merchant_attendance_shift_plan_adoptions'::regclass and conname='attendance_shift_plan_adoptions_channels_v3';"),'false');
  assert.equal(exec("select count(*) from pg_constraint where conrelid='public.merchant_attendance_shift_plan_adoptions'::regclass and conname='attendance_shift_plan_adoptions_channels_v2' and convalidated;"),'1');
  native.query(scope.sql(migration.slice(0,firstCommit)));
  native.query(scope.sql(migration.slice(0,secondCommit)));
  assert.equal(exec("select count(*) from pg_constraint where conrelid='public.merchant_attendance_shift_plan_adoptions'::regclass and conname in('attendance_shift_plan_adoptions_channels_v2','attendance_shift_plan_adoptions_channels_v3') and convalidated;"),'2');
  const reapply=()=>native.query(scope.sql(migration));reapply();
  assert.equal(d.fingerprint(tables),facts);assert.equal(previousDefinitions(),oldDefinitions);
  const normalized=rows=>rows.map(row=>row[1]==='merchant_attendance_shift_plan_adoptions'?row.map((v,i)=>i===5?v.filter(s=>!s.includes('channel')):v):row);
  assert.deepEqual(normalized(JSON.parse(d.tableCatalog())),normalized(catalogBefore));
  const installedDefinitions=d.definitions(),installedCatalog=d.tableCatalog(),installedFacts=d.fingerprint();reapply();
  assert.equal(d.fingerprint(),installedFacts);assert.equal(d.definitions(),installedDefinitions);assert.equal(d.tableCatalog(),installedCatalog);
  const {terminalHash,executeTerminalDevice}=require('../../src/lib/merchantAttendanceTerminal.server.ts');
  const {executePinAdmin}=require('../../src/lib/merchantAttendancePin.server.ts');
  const {executePinClock}=require('../../src/lib/merchantAttendancePinClock.server.ts');
  const {executeAttendancePinSchedule}=require('../../src/lib/merchantAttendancePinSchedule.server.ts');
  const {parsePinScheduleHttpResult}=require('../../src/lib/merchantAttendancePinSchedule.ts');
  const {handleAttendancePinSchedule}=require('../../src/app/api/merchant-enterprise/attendance/terminal-schedule/route-handler.ts');
  const {handlePinClock}=require('../../src/app/api/merchant-enterprise/attendance/terminal-clock/route-handler.ts');
  const {handleTerminalDevice}=require('../../src/app/api/merchant-enterprise/attendance/terminal-device/route-handler.ts');
  const workerNo=exec(`select worker_no from public.merchant_attendance_workers where merchant_id='${site}' and id='${worker}';`),pin='01738264';
  const cookie=`__Host-faolla-attendance-terminal=${site}.${terminal}.${secret}`,calls=[],failures=[];
  const service={rpc:async(name,args)=>{
    assert([pinScheduleRpc,'faolla_attendance_pin_begin_v1','faolla_attendance_pin_clock_v1','faolla_attendance_pin_clock_bound_v1',
      'faolla_attendance_pin_admin_v1','faolla_attendance_terminal_device_v1'].includes(name));
    calls.push({name,args});
    const expression=name===pinScheduleRpc?pinScheduleExpression(args):name==='faolla_attendance_terminal_device_v1'
      ?`public.faolla_attendance_terminal_device_v1(${quote(args.p_site)},${quote(args.p_id)},${quote(args.p_secret_hash)},${quote(args.p_device_hash)},${args.p_allow_pair})`:boundClockRpcExpression(name,args);
    try{return {data:JSON.parse(exec(`set local role service_role;select ${expression};`)),error:null};}
    catch(error){failures.push(String(error));const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}
  }};
  await executePinAdmin({siteId:site,authUserId:owner,workerNo,operationId:null,allowSet:true,
    command:{action:'set',operationId:id(170001),expectedRevision:0,workerId:worker,employeeId:employee,pin,salt:randomBytes(16).toString('hex')}},service);
  const common={allow:()=>true,entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}})};
  const handleNew=(req,overrides={})=>handleAttendancePinSchedule(req,{...common,baseEnabled:()=>true,featureEnabled:()=>true,bindRules:()=>false,
    execute:i=>executeAttendancePinSchedule(i,service),...overrides});
  const handleOld=(req,overrides={})=>handlePinClock(req,{...common,enabled:()=>true,execute:i=>executePinClock(i,service),...overrides});
  const handleDevice=(req,overrides={})=>handleTerminalDevice(req,{...common,enabled:()=>true,execute:i=>executeTerminalDevice(i,service),...overrides});
  let operation=170100;
  const command=(action='clock_in',patch={})=>({expectedWorkerId:worker,expectedEmployeeId:employee,operationId:id(++operation),locationId:location,action,expectedSequence:d.sequence(),...patch});
  const request=async(c=null,selection=null,operationId=null,overrides={},suppliedPin=pin)=>{
    const response=await handleNew(pinScheduleRequest({workerNo,pin:suppliedPin,command:c,operationId,selection},cookie),overrides);
    const body=await response.json();if(response.status===200)parsePinScheduleHttpResult(body,{siteId:site,terminalId:terminal,workerNo,command:c,operationId,selection});
    return {status:response.status,body};
  };
  const oldClock=(action='clock_out',patch={})=>executePinClock({siteId:site,terminalId:terminal,secret,workerNo,pin,allowNew:true,command:command(action,patch),operationId:null},service);
  const oldRead=()=>executePinClock({siteId:site,terminalId:terminal,secret,workerNo,pin,allowNew:true,command:null,operationId:null},service);
  const counts=()=>JSON.parse(exec(`select jsonb_build_object('events',(select count(*) from public.merchant_attendance_events),
    'receipts',(select count(*) from public.merchant_attendance_pin_clock_receipts),'relations',(select count(*) from public.merchant_attendance_shift_schedule_relations),
    'adoptions',(select count(*) from public.merchant_attendance_shift_plan_adoptions),'bindings',(select count(*) from public.merchant_attendance_shift_rule_bindings));`));
  const authState=()=>JSON.parse(exec(`select jsonb_build_object('workerAttempts',(select attempts from public.merchant_attendance_pin_credentials where merchant_id='${site}' and worker_id='${worker}'),
    'deviceAttempts',(select attempts from public.merchant_attendance_pin_attempts where merchant_id='${site}' and terminal_id='${terminal}'),
    'consumed',coalesce((select lease_id is null and lease_expires is null and worker_id is null and employee_id is null and credential_revision is null from public.merchant_attendance_pin_attempts where merchant_id='${site}' and terminal_id='${terminal}'),true));`));
  const authTables=['merchant_attendance_pin_attempts','merchant_attendance_pin_credentials'];
  const businessFacts=()=>d.fingerprint(d.inventory().filter(t=>!authTables.includes(t)));
  // Reset only this owned synthetic actor BETWEEN independent test cases.
  // Never reset a live lease, alter SQL limits, or claim this is a rate-limit test.
  const resetAuthBudget=()=>{assert.equal(authState().consumed,true);exec(`update public.merchant_attendance_pin_credentials set attempts=0,window_at=clock_timestamp() where merchant_id='${site}' and worker_id='${worker}';
    update public.merchant_attendance_pin_attempts set attempts=0,window_at=clock_timestamp() where merchant_id='${site}' and terminal_id='${terminal}';`);};
  const lease=()=>{const a={p_site:site,p_terminal:terminal,p_secret_hash:terminalHash(secret),p_no:workerNo,p_lease:randomUUID(),p_allow:true};
    const raw=JSON.parse(exec(`set local role service_role;select ${boundClockRpcExpression('faolla_attendance_pin_begin_v1',a)};`));assert.equal(raw.workerId,worker);return a;};
  const sqlInput=(l,c=null,selection=null,op=null,patch={})=>{const {p_allow:_unused,...common}=l;void _unused;return {...common,p_verified:true,
    p_request:{command:c,operationId:op},p_allow_new:true,p_selection:selection,p_allow_schedule:true,p_bind_rules:false,...patch};};
  const raw= args=>JSON.parse(exec(`set local role service_role;select ${pinScheduleExpression(args)};`));
  return {...d,onsite,pin,workerNo,cookie,service,calls,failures,handleNew,handleOld,handleDevice,request,command,oldClock,oldRead,counts,authState,authTables,businessFacts,resetAuthBudget,
    lease,sqlInput,rawPin:raw,previousDefinitions,oldDefinitions,installedDefinitions,installedCatalog,reapply,auth,employee,worker};
}
