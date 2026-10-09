//172 inert fixture: root owns the already-existing synthetic PG lifecycle.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {prepareSelfScheduleAdoptionNative} from './attendance-self-schedule-adoption-native.mjs';
import {boundClockMigrationBody,boundClockRpcExpression,quote} from './attendance-bound-clocks-native.mjs';
import {locationScheduleExpression,locationScheduleRequest} from './attendance-location-schedule-native.mjs';
import {lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
const require=createRequire(import.meta.url);
export const planAdoptionViewMigration='202610050145_merchant_attendance_plan_adoption_view.sql';
export const viewRpc='faolla_attendance_shift_check_adoption_v1';
export const coverageRpc='faolla_attendance_plan_coverage_adoptions_v1';
const readRpcs=[viewRpc,coverageRpc,'faolla_attendance_shift_check_v1','faolla_attendance_plan_coverage_v1','faolla_attendance_sources_v1'];
export function planAdoptionViewExpression(name,q,actor){
  assert(readRpcs.includes(name));return `public.${name}(${json(q)},${quote(actor)})`;
}
export function planAdoptionViewRequest(kind,q,method='GET'){
  return new Request(`https://www.faolla.com/api/merchant-enterprise/attendance/${kind}?${new URLSearchParams(q)}`,
    {method,headers:{host:'www.faolla.com',origin:'https://www.faolla.com','sec-fetch-site':'same-origin'}});
}
export async function preparePlanAdoptionViewNative(native,scope){
  const d=await prepareSelfScheduleAdoptionNative(native,scope),{exec,site,owner,auth,worker,location}=d;
  const protectedTables=d.inventory().filter(t=>t!=='faolla_schema_migrations'),facts=d.fingerprint(protectedTables),catalog=d.tableCatalog();
  const oids=exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f';`);
  const previousViewDefinitions=()=>exec(`select md5(jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef) order by p.oid)::text)
    from pg_proc p where p.pronamespace=${d.owned.oid} and p.oid=any(${quote(oids)}::oid[]) and p.prokind='f';`);
  const oldViewDefinitions=previousViewDefinitions(),reapplyView=()=>exec(boundClockMigrationBody(native.root,planAdoptionViewMigration));reapplyView();
  assert.equal(previousViewDefinitions(),oldViewDefinitions);assert.equal(d.tableCatalog(),catalog);assert.equal(d.fingerprint(protectedTables),facts);
  const viewDefinitions=d.definitions(),installedFacts=d.fingerprint();reapplyView();
  assert.equal(d.definitions(),viewDefinitions);assert.equal(d.tableCatalog(),catalog);assert.equal(d.fingerprint(),installedFacts);
  //Actual location-policy draft, publication and employee acknowledgement in
  //the SAME owned fixture. Never construct a server position assertion by hand.
  exec(`update public.merchant_attendance_settings set location_clock_enabled=true where merchant_id='${site}';
    update public.merchant_attendance_locations set latitude=37.3,longitude=-5.9,radius_meters=100 where merchant_id='${site}' and id='${location}';`);
  const values={purpose:'Synthetic172 location check',notice:'Synthetic172 location notice',contact:'Synthetic owner',alternative:'Manual review',retentionDays:90,latitude:37.3,longitude:-5.9,radiusMeters:100};
  const nq=access=>({access,locationId:location,expectedWorkerId:access==='self'?worker:null,operationId:null});
  exec(`set local role service_role;select public.faolla_attendance_location_policy_draft_v1('${site}','${owner}','${location}',${json({operationId:id(172001),expectedRevision:0,expectedSettingsVersion:1,expectedLocationVersion:1,values})},null,true);`);
  exec(`set local role service_role;select public.faolla_attendance_location_notice_v1('${site}','${owner}',${json(nq('owner'))},${json({action:'publish',operationId:id(172002),expectedRevision:0,draftRevision:1,expectedSettingsVersion:1,expectedLocationVersion:1,reason:'Synthetic172 publication'})},true);`);
  exec(`set local role service_role;select public.faolla_attendance_location_notice_v1('${site}','${auth}',${json(nq('self'))},${json({action:'acknowledge',operationId:id(172003),expectedRevision:1})},true);`);
  //Independent channel fixtures share a plan/employee, NOT one simultaneous
  //channel configuration. Ordinary111 must refuse a geofenced location. Set
  //the owned synthetic fence only during the actual location clock case; both
  //geo events still pass the genuine policy/notice/server assertion guards.
  const configureGeo=enabled=>exec(`update public.merchant_attendance_locations set latitude=${enabled?'37.3':'null'},longitude=${enabled?'-5.9':'null'},radius_meters=${enabled?'100':'null'} where merchant_id='${site}' and id='${location}';`);
  configureGeo(false);
  const {executeAttendanceLocationSchedule}=require('../../src/lib/merchantAttendanceLocationSchedule.server.ts');
  const {executeAttendanceLocationClock}=require('../../src/lib/merchantAttendanceLocationClock.server.ts');
  const {handleAttendanceLocationSchedule}=require('../../src/app/api/merchant-enterprise/attendance/location-schedule/route-handler.ts');
  const {executeShiftCheckAdoption,executePlanCoverageAdoptions}=require('../../src/lib/merchantAttendancePlanAdoptionView.server.ts');
  const {executeShiftCheck}=require('../../src/lib/merchantAttendanceShiftCheck.server.ts');
  const {executePlanCoverage}=require('../../src/lib/merchantAttendancePlanCoverage.server.ts');
  const {executeSources}=require('../../src/lib/merchantAttendanceSources.server.ts');
  const {handleShiftCheckAdoption}=require('../../src/app/api/merchant-enterprise/attendance/shift-check-adoption/route-handler.ts');
  const {handlePlanCoverageAdoptions}=require('../../src/app/api/merchant-enterprise/attendance/plan-coverage-adoptions/route-handler.ts');
  const {handleShiftCheck}=require('../../src/app/api/merchant-enterprise/attendance/shift-check/route-handler.ts');
  const {handlePlanCoverage}=require('../../src/app/api/merchant-enterprise/attendance/plan-coverage/route-handler.ts');
  const {handleSources}=require('../../src/app/api/merchant-enterprise/attendance/sources/route-handler.ts');
  const viewCalls=[],viewFailures=[];
  const readRawView=(name,q,actor=owner)=>JSON.parse(exec(`set local role service_role;select ${planAdoptionViewExpression(name,q,actor)};`));
  const viewService={rpc:async(name,args)=>{
    assert(readRpcs.includes(name));assert.deepEqual(Object.keys(args).sort(),['p_auth_user_id','p_query']);viewCalls.push(name);
    try{return {data:readRawView(name,args.p_query,args.p_auth_user_id),error:null};}
    catch(error){viewFailures.push(String(error));const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}
  }};
  const common={enabled:()=>true,authenticate:async()=>({user:{id:owner},authenticationMethods:['password']}),allow:()=>true,
    entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}})};
  const handleShift=(req,overrides={})=>handleShiftCheckAdoption(req,{...common,siteEnabled:()=>true,execute:i=>executeShiftCheckAdoption(i,viewService),...overrides});
  const handlePlan=(req,overrides={})=>handlePlanCoverageAdoptions(req,{...common,siteEnabled:()=>true,execute:i=>executePlanCoverageAdoptions(i,viewService),...overrides});
  const handleOldShift=(req,overrides={})=>handleShiftCheck(req,{...common,execute:i=>executeShiftCheck(i,viewService),...overrides});
  const handleOldPlan=(req,overrides={})=>handlePlanCoverage(req,{...common,execute:i=>executePlanCoverage(i,viewService),...overrides});
  const handleSourceRead=(req,overrides={})=>handleSources(req,{...common,execute:i=>executeSources(i,viewService),...overrides});
  const viewQuery=startEventId=>({siteId:site,workerId:worker,startEventId});
  const coverageQuery=(slot=d.slots.main)=>({siteId:site,workerId:worker,slotId:slot.id});
  const readView=async(kind,q,overrides={},method='GET')=>{const r=await (kind==='shift-check-adoption'?handleShift:handlePlan)(planAdoptionViewRequest(kind,q,method),overrides);
    return {status:r.status,headers:r.headers,body:await r.json()};};
  const geoFailures=[],geoService={rpc:async(name,args)=>{
    assert(['faolla_attendance_location_schedule_v1','faolla_attendance_location_clock_v2','faolla_attendance_location_clock_bound_v1'].includes(name));
    try{return {data:JSON.parse(exec(`set local role service_role;select ${name==='faolla_attendance_location_schedule_v1'?locationScheduleExpression(args):boundClockRpcExpression(name,args)};`)),error:null};}
    catch(error){geoFailures.push(String(error));const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}
  }};
  let operation=172100;
  const geoCommand=async(action='clock_in')=>{const r=await executeAttendanceLocationClock({siteId:site,expectedWorkerId:worker,operationId:null,command:null,authUserId:auth,moduleEnabled:true},geoService),p=r.policy;
    return {expectedWorkerId:worker,operationId:id(++operation),locationId:location,action,expectedSequence:r.state.sequence,settingsVersion:p.settingsVersion,workerVersion:p.workerVersion,
      locationVersion:p.locationVersion,noticeRevision:r.noticeGate.revision,safeFinish:false,position:{latitude:37.3,longitude:-5.9,accuracyMeters:10,capturedAt:new Date().toISOString()},positionFailure:null};};
  const geoRequest=async(c,selection,bindRules=true)=>{const r=await handleAttendanceLocationSchedule(locationScheduleRequest('POST',{siteId:site,command:c,selection}),
    {...common,authenticate:async()=>({user:{id:auth},authenticationMethods:['password']}),baseEnabled:()=>true,featureEnabled:()=>true,bindRules:()=>bindRules,execute:i=>executeAttendanceLocationSchedule(i,geoService)});
    return {status:r.status,body:await r.json()};};
  const geoFinish=async()=>executeAttendanceLocationClock({siteId:site,expectedWorkerId:worker,operationId:null,command:await geoCommand('clock_out'),authUserId:auth,moduleEnabled:true},geoService);
  return {...d,readRawView,viewQuery,coverageQuery,readView,handleShift,handlePlan,handleOldShift,handleOldPlan,handleSources:handleSourceRead,viewCalls,viewFailures,
    geoCommand,geoRequest,geoFinish,configureGeo,geoFailures,reapplyView,viewDefinitions,previousViewDefinitions,oldViewDefinitions};
}
