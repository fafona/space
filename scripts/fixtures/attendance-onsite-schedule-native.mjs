//169 synthetic-only actual HMAC / handler / old108 + additive142 transaction.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {preparePlanRuleApprovalsNative} from './attendance-plan-rule-approvals-native.mjs';
import {boundClockMigrationBody,boundClockRpcExpression,quote} from './attendance-bound-clocks-native.mjs';
import {lifecycleJson as json,lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
const require=createRequire(import.meta.url);
export const onsiteScheduleMigration='202610050142_merchant_attendance_onsite_schedule.sql';
export const onsiteScheduleRpc='faolla_attendance_onsite_schedule_v1';
export function onsiteScheduleExpression(a){
  assert.deepEqual(Object.keys(a).sort(),['p_site','p_auth','p_claims','p_command','p_operation','p_allow_new','p_selection','p_allow_schedule','p_bind_rules'].sort());
  for(const key of ['p_allow_new','p_allow_schedule','p_bind_rules'])assert.equal(typeof a[key],'boolean');
  assert.match(a.p_site,/^9999000[1-6]$/);
  return `public.${onsiteScheduleRpc}(${quote(a.p_site)},${quote(a.p_auth)},${json(a.p_claims)},${json(a.p_command)},${quote(a.p_operation)},${a.p_allow_new},${json(a.p_selection)},${a.p_allow_schedule},${a.p_bind_rules})`;
}
export function onsiteScheduleRequest(method,value,old=false){
  const base=`https://www.faolla.com/api/merchant-enterprise/attendance/${old?'onsite-clock':'onsite-schedule'}`;
  return new Request(method==='POST'?base:`${base}?${new URLSearchParams(Object.entries(value).filter(([,v])=>v!==null))}`,
    {method,headers:{origin:'https://www.faolla.com','sec-fetch-site':'same-origin','content-type':'application/json'},...(method==='POST'?{body:JSON.stringify(value)}:{})});
}
export async function prepareOnsiteScheduleNative(native,scope){
  const d=await preparePlanRuleApprovalsNative(native,scope),{exec,site,location,worker,auth,owner,employee}=d;
  exec(boundClockMigrationBody(native.root,'202610050141_merchant_attendance_location_schedule.sql'));
  const protectedTables=d.inventory().filter(t=>t!=='faolla_schema_migrations'),facts=d.fingerprint(protectedTables),catalogBefore=JSON.parse(d.tableCatalog());
  const oldOids=exec(`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f'
    and proname not in('faolla_attendance_location_plan_adoption_v1','faolla_attendance_shift_plan_adoption_guard_v1');`);
  const previousDefinitions=()=>exec(`select md5(jsonb_agg(jsonb_build_array(p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef) order by p.oid)::text)
    from pg_proc p where p.pronamespace=${d.owned.oid} and p.oid=any(${quote(oldOids)}::oid[]) and p.prokind='f';`);
  const oldDefinitions=previousDefinitions(),migration=readFileSync(path.join(native.root,'scripts/supabase-migrations',onsiteScheduleMigration),'utf8');
  // Exercise correct partial installation: its old validated constraint stays
  // effective across both commits. Never wrap all three stages in one BEGIN.
  const stage1=migration.slice(0,migration.indexOf('commit;')+7);
  native.query(scope.sql(stage1));
  assert.equal(exec("select convalidated::text from pg_constraint where conrelid='public.merchant_attendance_shift_plan_adoptions'::regclass and conname='attendance_shift_plan_adoptions_channels_v2';"),'false');
  assert.equal(exec("select count(*) from pg_constraint where conrelid='public.merchant_attendance_shift_plan_adoptions'::regclass and conname='merchant_attendance_shift_plan_adoptions_channel_check' and convalidated;"),'1');
  assert.equal(exec('select count(*) from public.faolla_schema_migrations where version=202610050142;'),'0');
  native.query(scope.sql(stage1)); // NOT VALID partial state is resumable.
  const end2=migration.indexOf('commit;',migration.indexOf('commit;')+7)+7;
  native.query(scope.sql(migration.slice(0,end2)));
  assert.equal(exec("select count(*) from pg_constraint where conrelid='public.merchant_attendance_shift_plan_adoptions'::regclass and conname in('merchant_attendance_shift_plan_adoptions_channel_check','attendance_shift_plan_adoptions_channels_v2') and convalidated;"),'2');
  native.query(scope.sql(migration));
  assert.equal(d.fingerprint(protectedTables),facts);assert.equal(previousDefinitions(),oldDefinitions);
  const normalized=rows=>rows.map(row=>row[1]==='merchant_attendance_shift_plan_adoptions'?row.map((v,i)=>i===5?v.filter(s=>!s.includes('channel')):v):row);
  assert.deepEqual(normalized(JSON.parse(d.tableCatalog())),normalized(catalogBefore));
  const installedDefinitions=d.definitions(),installedCatalog=d.tableCatalog(),installedFacts=d.fingerprint();
  const reapply=()=>native.query(scope.sql(migration));reapply();
  assert.equal(d.fingerprint(),installedFacts);assert.equal(d.definitions(),installedDefinitions);assert.equal(d.tableCatalog(),installedCatalog);
  const {terminalHash}=require('../../src/lib/merchantAttendanceTerminal.server.ts');
  const terminal=id(169001),secret=randomBytes(32).toString('base64url'),pairSecret=randomBytes(32).toString('base64url');
  exec(`set local role service_role;select public.faolla_attendance_terminal_admin_v1('${site}','${owner}','{"terminalId":null,"cursor":null}',${json({action:'create',terminalId:terminal,locationId:location,label:'Synthetic169 onsite terminal',pairHash:terminalHash(pairSecret)})},true);`);
  exec(`set local role service_role;select public.faolla_attendance_terminal_device_v1('${site}','${terminal}','${terminalHash(pairSecret)}','${terminalHash(secret)}',true);`);
  d.publishRules(undefined,0,d.day(1),169010);
  let operation=169100;
  const approve=slot=>{const preview=d.raw(d.query(slot)),c=d.approvalCommand(preview,++operation,'Synthetic169 approved reference');return d.raw(d.query(slot,'approve',c.operationId),c).approval;};
  const mainApproval=approve(d.slots.main),browserApproval=approve(d.slots.browser);
  const {executeAttendanceOnsiteSchedule}=require('../../src/lib/merchantAttendanceOnsiteSchedule.server.ts');
  const {handleAttendanceOnsiteSchedule}=require('../../src/app/api/merchant-enterprise/attendance/onsite-schedule/route-handler.ts');
  const {executeOnsiteClock,executeOnsiteIssue,verifyOnsiteToken,signOnsiteToken}=require('../../src/lib/merchantAttendanceOnsiteQr.server.ts');
  const {parseOnsiteScheduleHttpResult}=require('../../src/lib/merchantAttendanceOnsiteSchedule.ts');
  const {handleOnsiteClock}=require('../../src/app/api/merchant-enterprise/attendance/onsite-clock/route-handler.ts');
  const calls=[],failures=[];
  const service={rpc:async(name,args)=>{
    assert([onsiteScheduleRpc,'faolla_attendance_onsite_clock_v1','faolla_attendance_onsite_clock_bound_v1','faolla_attendance_onsite_issue_v1'].includes(name));
    calls.push({name,command:args.p_command?.action??null,args});
    const expression=name===onsiteScheduleRpc?onsiteScheduleExpression(args):name==='faolla_attendance_onsite_issue_v1'
      ?`public.faolla_attendance_onsite_issue_v1(${quote(args.p_site)},${quote(args.p_terminal)},${quote(args.p_secret_hash)})`:boundClockRpcExpression(name,args);
    try{return {data:JSON.parse(exec(`set local role service_role;select ${expression};`)),error:null};}
    catch(error){failures.push(String(error));const code=String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];if(!code)throw error;return {data:null,error:{message:code}};}
  }};
  const common={authenticate:async()=>({user:{id:auth},authenticationMethods:['password']}),allow:()=>true,
    entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}})};
  const handleNew=(req,overrides={})=>handleAttendanceOnsiteSchedule(req,{...common,baseEnabled:()=>true,featureEnabled:()=>true,bindRules:()=>false,
    execute:i=>executeAttendanceOnsiteSchedule(i,service),...overrides});
  const handleOld=(req,overrides={})=>handleOnsiteClock(req,{...common,enabled:()=>true,execute:i=>executeOnsiteClock(i,service),...overrides});
  const issue=()=>executeOnsiteIssue({siteId:site,terminalId:terminal,secret},service);
  const oldRead=()=>executeOnsiteClock({siteId:site,command:null,token:null,operationId:null,authUserId:auth,allowNew:true},service);
  const command=async(action='clock_in',patch={})=>({expectedWorkerId:worker,expectedEmployeeId:employee,operationId:id(++operation),locationId:location,
    action,expectedSequence:(await oldRead()).state.sequence,...patch});
  const request=async(c=null,selection=null,op=null,overrides={},token=null)=>{
    if(c&&token===null)token=(await issue()).token;
    const response=await handleNew(onsiteScheduleRequest(c?'POST':'GET',c?{siteId:site,token,command:c,selection}:{siteId:site,operationId:op}),overrides);
    const body=await response.json();if(response.status===200)parseOnsiteScheduleHttpResult(body,{siteId:site,operationId:op,command:c,authUserId:auth,...(c?{selection}:{})});
    return {status:response.status,body,token};
  };
  const oldClock=async(action='clock_out',patch={},token=null)=>executeOnsiteClock({siteId:site,operationId:null,command:await command(action,patch),token:token??(await issue()).token,authUserId:auth,allowNew:true},service);
  const counts=()=>JSON.parse(exec(`select jsonb_build_object('events',(select count(*) from public.merchant_attendance_events),
    'relations',(select count(*) from public.merchant_attendance_shift_schedule_relations),'adoptions',(select count(*) from public.merchant_attendance_shift_plan_adoptions),
    'nonces',(select count(*) from public.merchant_attendance_onsite_receipts),'bindings',(select count(*) from public.merchant_attendance_shift_rule_bindings));`));
  return {...d,terminal,secret,approve,mainApproval,browserApproval,previousDefinitions,oldDefinitions,installedDefinitions,installedCatalog,reapply,
    service,calls,failures,handleNew,handleOld,request,command,oldClock,oldRead,counts,issue,verifyOnsiteToken,signOnsiteToken};
}
