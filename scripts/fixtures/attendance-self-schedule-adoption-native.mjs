//171 has no runtime of its own. Root reuses the verified stopped local cluster.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {preparePinScheduleNative} from './attendance-pin-schedule-native.mjs';
import {selfScheduleExpression,selfScheduleRequest} from './attendance-self-schedule-native.mjs';
import {boundClockRpcExpression,quote} from './attendance-bound-clocks-native.mjs';
import {lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
const require=createRequire(import.meta.url);
export const selfScheduleAdoptionMigration='202610050144_merchant_attendance_self_schedule_adoption.sql';
export const selfScheduleAdoptionRpc='faolla_attendance_self_schedule_adoption_v1';
export function selfScheduleAdoptionExpression(a){return selfScheduleExpression(a).replace('public.faolla_attendance_self_schedule_v1(',`public.${selfScheduleAdoptionRpc}(`);}
export function selfScheduleAdoptionRequest(method,value){
  const old=selfScheduleRequest(method,value);
  return new Request(old.url.replace('/self-schedule','/self-schedule-adoption'),old);
}
export function selfScheduleAdoptionOldDefinitions(d){
  const oids=d.exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f'
    and proname not in('faolla_attendance_shift_plan_adoption_v1','faolla_attendance_shift_plan_adoption_guard_v1');`);
  return ()=>d.exec(`select md5(jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef) order by p.oid)::text)
    from pg_proc p where p.pronamespace=${d.owned.oid} and p.oid=any(${quote(oids)}::oid[]) and p.prokind='f';`);
}
export async function prepareSelfScheduleAdoptionNative(native,scope){
  const d=await preparePinScheduleNative(native,scope),{exec,site,auth,worker}=d;
  const previousDefinitions=selfScheduleAdoptionOldDefinitions(d),oldDefinitions=previousDefinitions(),catalogBefore=JSON.parse(d.tableCatalog());
  const facts=d.fingerprint(d.inventory().filter(t=>t!=='faolla_schema_migrations'));
  const migration=readFileSync(path.join(native.root,'scripts/supabase-migrations',selfScheduleAdoptionMigration),'utf8');
  const first=migration.indexOf('commit;')+7,second=migration.indexOf('commit;',first)+7;
  native.query(scope.sql(migration.slice(0,first)));
  assert.equal(exec("select convalidated::text from pg_constraint where conrelid='public.merchant_attendance_shift_plan_adoptions'::regclass and conname='attendance_shift_plan_adoptions_channels_v4';"),'false');
  assert.equal(exec("select count(*) from pg_constraint where conrelid='public.merchant_attendance_shift_plan_adoptions'::regclass and conname='attendance_shift_plan_adoptions_channels_v3' and convalidated;"),'1');
  native.query(scope.sql(migration.slice(0,first)));native.query(scope.sql(migration.slice(0,second)));
  assert.equal(exec("select count(*) from pg_constraint where conrelid='public.merchant_attendance_shift_plan_adoptions'::regclass and conname in('attendance_shift_plan_adoptions_channels_v3','attendance_shift_plan_adoptions_channels_v4') and convalidated;"),'2');
  const reapply=()=>native.query(scope.sql(migration));reapply();
  assert.equal(d.fingerprint(d.inventory().filter(t=>t!=='faolla_schema_migrations')),facts);assert.equal(previousDefinitions(),oldDefinitions);
  const normalized=rows=>rows.map(row=>row[1]==='merchant_attendance_shift_plan_adoptions'?row.map((v,i)=>i===5?v.filter(s=>!s.includes('channel')):v):row);
  assert.deepEqual(normalized(JSON.parse(d.tableCatalog())),normalized(catalogBefore));
  const installedDefinitions=d.definitions(),installedCatalog=d.tableCatalog(),installedFacts=d.fingerprint();reapply();
  assert.equal(d.fingerprint(),installedFacts);assert.equal(d.definitions(),installedDefinitions);assert.equal(d.tableCatalog(),installedCatalog);
  const {executeAttendanceSelfScheduleAdoption}=require('../../src/lib/merchantAttendanceSelfScheduleAdoption.server.ts');
  const {parseSelfScheduleAdoptionHttpResult}=require('../../src/lib/merchantAttendanceSelfScheduleAdoption.ts');
  const {handleAttendanceSelfScheduleAdoption}=require('../../src/app/api/merchant-enterprise/attendance/self-schedule-adoption/route-handler.ts');
  const {executeAttendanceSelfSchedule}=require('../../src/lib/merchantAttendanceSelfSchedule.server.ts');
  const {handleAttendanceSelfSchedule}=require('../../src/app/api/merchant-enterprise/attendance/self-schedule/route-handler.ts');
  const {executeAttendanceSelf}=require('../../src/lib/merchantAttendanceSelf.server.ts');
  const {handleAttendanceSelf}=require('../../src/app/api/merchant-enterprise/attendance/self/route-handler.ts');
  const calls=[],failures=[];
  const service={rpc:async(name,args)=>{
    assert([selfScheduleAdoptionRpc,'faolla_attendance_self_schedule_v1','faolla_attendance_self_v1','faolla_attendance_self_bound_v1'].includes(name));
    calls.push({name,args});
    const expression=name===selfScheduleAdoptionRpc?selfScheduleAdoptionExpression(args):name==='faolla_attendance_self_schedule_v1'?selfScheduleExpression(args):boundClockRpcExpression(name,args);
    try{return {data:JSON.parse(exec(`set local role service_role;select ${expression};`)),error:null};}
    catch(error){failures.push(String(error));const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}
  }};
  const common={authenticate:async()=>({user:{id:auth},authenticationMethods:['password']}),allow:()=>true,
    entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}})};
  const gates={...common,baseEnabled:()=>true,featureEnabled:()=>true,bindRules:()=>false};
  const handleNew=(req,overrides={})=>handleAttendanceSelfScheduleAdoption(req,{...gates,execute:i=>executeAttendanceSelfScheduleAdoption(i,service),...overrides});
  const handle137=(req,overrides={})=>handleAttendanceSelfSchedule(req,{...gates,execute:i=>executeAttendanceSelfSchedule(i,service),...overrides});
  const handleOld=(req,overrides={})=>handleAttendanceSelf(req,{...common,enabled:()=>true,execute:i=>executeAttendanceSelf(i,service),...overrides});
  let operation=171100;
  const command=(action='clock_in',patch={})=>({expectedWorkerId:worker,operationId:id(++operation),locationId:d.location,action,expectedSequence:d.sequence(),...patch});
  const request=async(c=null,selection=null,op=null,overrides={})=>{
    const response=await handleNew(selfScheduleAdoptionRequest(c?'POST':'GET',c?{siteId:site,command:c,selection}:{siteId:site,operationId:op}),overrides),body=await response.json();
    if(response.status===200)parseSelfScheduleAdoptionHttpResult(body,{siteId:site,authUserId:auth,expectedEmployeeId:d.employee,command:c,operationId:op,...(c?{selection}:{})});
    return {status:response.status,body};
  };
  const legacyRequest=async(c=null,selection=null,op=null,overrides={})=>{
    const response=await handle137(selfScheduleRequest(c?'POST':'GET',c?{siteId:site,command:c,selection}:{siteId:site,operationId:op}),overrides);
    return {status:response.status,body:await response.json()};
  };
  const oldClock=(action='clock_out',patch={})=>executeAttendanceSelf({siteId:site,authUserId:auth,command:command(action,patch),operationId:null},service);
  const oldRead=()=>executeAttendanceSelf({siteId:site,authUserId:auth,command:null,operationId:null},service);
  const counts=()=>JSON.parse(exec(`select jsonb_build_object('events',(select count(*) from public.merchant_attendance_events),
    'relations',(select count(*) from public.merchant_attendance_shift_schedule_relations),'adoptions',(select count(*) from public.merchant_attendance_shift_plan_adoptions),
    'bindings',(select count(*) from public.merchant_attendance_shift_rule_bindings),'sources',(select count(*) from public.merchant_attendance_shift_rule_sources));`));
  const input=(c=null,selection=null,op=null,patch={})=>({p_site_id:site,p_auth_user_id:auth,p_command:c,p_selection:selection,p_operation_id:op,p_allow_write:true,p_bind_rules:false,...patch});
  return {...d,pinChannel:d,service,calls,failures,handleNew,handle137,handleOld,request,legacyRequest,command,oldClock,oldRead,counts,input,
    rawSelf:a=>JSON.parse(exec(`set local role service_role;select ${selfScheduleAdoptionExpression(a)};`)),
    previousDefinitions,oldDefinitions,installedDefinitions,installedCatalog,reapply};
}
