//168 synthetic-only actual route -> old spatial service -> additive141 SQL.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {preparePlanRuleApprovalsNative} from './attendance-plan-rule-approvals-native.mjs';
import {boundClockMigrationBody,boundClockRpcExpression,quote} from './attendance-bound-clocks-native.mjs';
import {lifecycleJson as json,lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
const require=createRequire(import.meta.url);
export const locationScheduleMigration='202610050141_merchant_attendance_location_schedule.sql';
export const locationScheduleRpc='faolla_attendance_location_schedule_v1';
export function locationScheduleExpression(a){
  assert.deepEqual(Object.keys(a).sort(),['p_site_id','p_auth_user_id','p_expected_worker_id','p_command','p_operation_id','p_assertion','p_allow_new_sessions','p_require_clock','p_selection','p_allow_schedule','p_bind_rules'].sort());
  for(const key of ['p_allow_new_sessions','p_require_clock','p_allow_schedule','p_bind_rules'])assert.equal(typeof a[key],'boolean');
  assert.match(a.p_site_id,/^9999000[1-6]$/);
  return `public.${locationScheduleRpc}(${quote(a.p_site_id)},${quote(a.p_auth_user_id)},${quote(a.p_expected_worker_id)},${json(a.p_command)},${quote(a.p_operation_id)},${json(a.p_assertion)},${a.p_allow_new_sessions},${a.p_require_clock},${json(a.p_selection)},${a.p_allow_schedule},${a.p_bind_rules})`;
}
export function locationScheduleRequest(method,value,old=false){
  const base=`https://www.faolla.com/api/merchant-enterprise/attendance/${old?'location-clock':'location-schedule'}`;
  return new Request(method==='POST'?base:`${base}?${new URLSearchParams(Object.entries(value).filter(([,v])=>v!==null))}`,
    {method,headers:{origin:'https://www.faolla.com','sec-fetch-site':'same-origin','content-type':'application/json'},...(method==='POST'?{body:JSON.stringify(value)}:{})});
}
export async function prepareLocationScheduleNative(native,scope){
  const d=await preparePlanRuleApprovalsNative(native,scope),{exec,site,location,worker,auth,owner}=d;
  // Owned synthetic fixture only. Real draft/publication/acknowledgement RPCs,
  // no fabricated location assertion or bypass of original notice guards.
  exec(`update public.merchant_attendance_settings set location_clock_enabled=true where merchant_id='${site}';
    update public.merchant_attendance_locations set latitude=37.3,longitude=-5.9,radius_meters=100 where merchant_id='${site}' and id='${location}';`);
  const values={purpose:'Synthetic168 location check',notice:'Synthetic168 location notice',contact:'Synthetic owner',alternative:'Manual review',retentionDays:90,latitude:37.3,longitude:-5.9,radiusMeters:100};
  const nq=access=>({access,locationId:location,expectedWorkerId:access==='self'?worker:null,operationId:null});
  exec(`set local role service_role;select public.faolla_attendance_location_policy_draft_v1('${site}','${owner}','${location}',${json({operationId:id(168001),expectedRevision:0,expectedSettingsVersion:1,expectedLocationVersion:1,values})},null,true);`);
  exec(`set local role service_role;select public.faolla_attendance_location_notice_v1('${site}','${owner}',${json(nq('owner'))},${json({action:'publish',operationId:id(168002),expectedRevision:0,draftRevision:1,expectedSettingsVersion:1,expectedLocationVersion:1,reason:'Synthetic168 publication'})},true);`);
  exec(`set local role service_role;select public.faolla_attendance_location_notice_v1('${site}','${auth}',${json(nq('self'))},${json({action:'acknowledge',operationId:id(168003),expectedRevision:1})},true);`);
  const protectedTables=d.inventory().filter(t=>t!=='faolla_schema_migrations'),beforeFacts=d.fingerprint(protectedTables),catalogBefore=JSON.parse(d.tableCatalog());
  const oldOids=exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f';`);
  const previousDefinitions=()=>exec(`select md5(jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef) order by p.oid)::text)
    from pg_proc p where p.pronamespace=${d.owned.oid} and p.oid=any(${quote(oldOids)}::oid[]) and p.prokind='f';`);
  const oldDefinitions=previousDefinitions();exec(boundClockMigrationBody(native.root,locationScheduleMigration));
  assert.equal(d.fingerprint(protectedTables),beforeFacts);assert.equal(previousDefinitions(),oldDefinitions);
  assert.deepEqual(JSON.parse(d.tableCatalog()).filter(r=>catalogBefore.some(old=>old[0]===r[0])),catalogBefore);
  const installedDefinitions=d.definitions(),installedCatalog=d.tableCatalog(),after=d.fingerprint();
  exec(boundClockMigrationBody(native.root,locationScheduleMigration));
  assert.equal(d.fingerprint(),after);assert.equal(d.definitions(),installedDefinitions);assert.equal(d.tableCatalog(),installedCatalog);
  d.publishRules(undefined,0,d.day(1),168010);
  let operation=168100;
  const approve=slot=>{const preview=d.raw(d.query(slot)),c=d.approvalCommand(preview,++operation,'Synthetic168 approved reference');
    return d.raw(d.query(slot,'approve',c.operationId),c).approval;};
  const mainApproval=approve(d.slots.main),browserApproval=approve(d.slots.browser);
  const {executeAttendanceLocationSchedule}=require('../../src/lib/merchantAttendanceLocationSchedule.server.ts');
  const {handleAttendanceLocationSchedule}=require('../../src/app/api/merchant-enterprise/attendance/location-schedule/route-handler.ts');
  const {executeAttendanceLocationClock}=require('../../src/lib/merchantAttendanceLocationClock.server.ts');
  const {parseLocationScheduleHttpResult}=require('../../src/lib/merchantAttendanceLocationSchedule.ts');
  const {handleAttendanceLocationClock}=require('../../src/app/api/merchant-enterprise/attendance/location-clock/route-handler.ts');
  const calls=[],failures=[];
  const service={rpc:async(name,args)=>{
    assert([locationScheduleRpc,'faolla_attendance_location_clock_v2','faolla_attendance_location_clock_bound_v1'].includes(name));
    calls.push({name,command:args.p_command?.action??null,args});
    try{return {data:JSON.parse(exec(`set local role service_role;select ${name===locationScheduleRpc?locationScheduleExpression(args):boundClockRpcExpression(name,args)};`)),error:null};}
    catch(error){failures.push(String(error));const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}
  }};
  const common={authenticate:async()=>({user:{id:auth},authenticationMethods:['password']}),allow:()=>true,
    entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}})};
  const handleNew=(req,overrides={})=>handleAttendanceLocationSchedule(req,{...common,baseEnabled:()=>true,featureEnabled:()=>true,bindRules:()=>false,
    execute:i=>executeAttendanceLocationSchedule(i,service),...overrides});
  const handleOld=(req,overrides={})=>handleAttendanceLocationClock(req,{...common,enabled:()=>true,execute:i=>executeAttendanceLocationClock(i,service),...overrides});
  const request=async(c=null,selection=null,op=null,overrides={})=>{
    const response=await handleNew(locationScheduleRequest(c?'POST':'GET',c?{siteId:site,command:c,selection}:{siteId:site,expectedWorkerId:worker,operationId:op}),overrides);
    const body=await response.json();if(response.status===200)parseLocationScheduleHttpResult(body,{siteId:site,expectedWorkerId:worker,operationId:op,command:c,authUserId:auth,...(c?{selection}:{})});
    return {status:response.status,body};
  };
  const oldRead=()=>executeAttendanceLocationClock({siteId:site,expectedWorkerId:worker,operationId:null,command:null,authUserId:auth,moduleEnabled:true},service);
  const command=async(action='clock_in',patch={})=>{
    const r=await oldRead(),p=r.policy,seq=r.state.sequence;
    return {expectedWorkerId:worker,operationId:id(++operation),locationId:location,action,expectedSequence:seq,settingsVersion:p.settingsVersion,workerVersion:p.workerVersion,
      locationVersion:p.locationVersion,noticeRevision:r.noticeGate.revision,safeFinish:false,
      position:{latitude:37.3,longitude:-5.9,accuracyMeters:10,capturedAt:new Date().toISOString()},positionFailure:null,...patch};
  };
  const oldClock=async(action='clock_out',patch={})=>executeAttendanceLocationClock({siteId:site,expectedWorkerId:worker,operationId:null,command:await command(action,patch),authUserId:auth,moduleEnabled:true},service);
  const counts=()=>JSON.parse(exec(`select jsonb_build_object('events',(select count(*) from public.merchant_attendance_events),
    'relations',(select count(*) from public.merchant_attendance_shift_schedule_relations),'adoptions',(select count(*) from public.merchant_attendance_shift_plan_adoptions),
    'results',(select count(*) from public.merchant_attendance_location_results),'notices',(select count(*) from public.merchant_attendance_location_clock_notices));`));
  return {...d,approve,mainApproval,browserApproval,previousDefinitions,oldDefinitions,installedDefinitions,installedCatalog,
    service,calls,failures,handleNew,handleOld,request,command,oldClock,oldRead,counts};
}
