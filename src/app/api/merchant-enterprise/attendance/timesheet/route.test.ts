import assert from "node:assert/strict";
import test from "node:test";
import type {User} from "@supabase/supabase-js";
import {handleAttendanceTimesheet,attendanceTimesheetDependencies} from "./route-handler";
import {MerchantAttendanceError} from "@/lib/merchantAttendanceTime";
import {MerchantEnterpriseAccessError} from "@/lib/merchantEnterpriseAuth.server";
import {parseAttendanceTimesheetResult,attendanceTimesheetQueryString} from "@/lib/merchantAttendanceTimesheet";
import {sheetWire,timesheetQuery as query,timesheetOwner} from "../../../../../../scripts/fixtures/attendance-timesheet-model";
const url=`https://www.faolla.com/api/merchant-enterprise/attendance/timesheet?${attendanceTimesheetQueryString(query)}`;
function setup(extra:Partial<typeof attendanceTimesheetDependencies>={}){
  const calls:Parameters<typeof attendanceTimesheetDependencies.execute>[0][]=[];
  const deps:typeof attendanceTimesheetDependencies={enabled:()=>true,allow:()=>true,
    authenticate:async()=>({user:{id:timesheetOwner} as User,accessToken:'synthetic',authenticationMethods:['password']}),
    entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}) as Awaited<ReturnType<typeof attendanceTimesheetDependencies.entitlement>>,
    execute:async input=>{calls.push(input);return parseAttendanceTimesheetResult(sheetWire(),query);},...extra};
  return {deps,calls};
}
test('report is default-off, GET-only and canonical/same-origin checked before auth',async()=>{
  let authenticated=false;const {deps}=setup({enabled:()=>false,authenticate:async()=>{authenticated=true;throw Error('must not run');}});
  assert.equal((await handleAttendanceTimesheet(new Request(url),deps)).status,404);deps.enabled=()=>true;
  for(const method of ['POST','PUT','DELETE'])assert.equal((await handleAttendanceTimesheet(new Request(url,{method}),deps)).status,405);
  assert.equal((await handleAttendanceTimesheet(new Request(url.replace('www.','merchant.')),deps)).status,403);
  assert.equal((await handleAttendanceTimesheet(new Request(url,{headers:{origin:'https://other.invalid'}}),deps)).status,403);assert.equal(authenticated,false);
});
test('only full authentication reaches DB, with server principal not client identity',async()=>{
  for(const methods of [[],['invite'],['magiclink'],['recovery'],['password','recovery']]){
    const {deps,calls}=setup({authenticate:async()=>({user:{id:timesheetOwner} as User,accessToken:'synthetic',authenticationMethods:methods})});
    assert.equal((await handleAttendanceTimesheet(new Request(url),deps)).status,403);assert.equal(calls.length,0);
  }
  const {deps,calls}=setup(),r=await handleAttendanceTimesheet(new Request(url),deps);assert.equal(r.status,200);
  assert.deepEqual(calls,[{query,authUserId:timesheetOwner}]);assert.equal((await r.json()).moduleEnabled,false);
});
test('paused capture still allows owner historical read but entitlement is rechecked every time',async()=>{
  const {deps,calls}=setup();const r=await handleAttendanceTimesheet(new Request(url),deps);
  assert.equal(r.headers.get('cache-control'),'private, no-store');assert.match(r.headers.get('vary')!,/Cookie.*Authorization/);
  assert.equal(r.headers.get('x-content-type-options'),'nosniff');
  deps.entitlement=async()=>{throw new MerchantEnterpriseAccessError('enterprise_management_disabled',403);};
  assert.equal((await handleAttendanceTimesheet(new Request(url),deps)).status,403);assert.equal(calls.length,1);
});
test('target/permission overrides, duplicate filters and overlong periods never execute',async()=>{
  const {deps,calls}=setup();for(const suffix of ['&access=owner','&authUserId='+timesheetOwner,'&fromDate=2026-09-01','&asOf=now'])
    assert.equal((await handleAttendanceTimesheet(new Request(url+suffix),deps)).status,400);
  assert.equal((await handleAttendanceTimesheet(new Request(url.replace('2026-09-30','2026-10-02')),deps)).status,400);assert.equal(calls.length,0);
});
test('owner revocation, excess data and rate limits have bounded non-sensitive errors',async()=>{
  for(const [code,status] of [['attendance_access_denied',403],['attendance_report_too_large',422],['attendance_report_overlap',422],['attendance_session_span_too_long',422],['attendance_local_date_does_not_exist',422]] as const){
    const {deps}=setup({execute:async()=>{throw new MerchantAttendanceError(code);}}),r=await handleAttendanceTimesheet(new Request(url),deps);assert.equal(r.status,status);assert.equal((await r.json()).error,code);
  }
  const r=await handleAttendanceTimesheet(new Request(url),setup({allow:()=>false}).deps);assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'60');
  const broken=await handleAttendanceTimesheet(new Request(url),setup({execute:async()=>{throw Error('secret_sql');}}).deps);assert.deepEqual(await broken.json(),{ok:false,error:'attendance_unavailable'});
});
test('both deployment gates must explicitly enable the report',()=>{
  const keys=['FAOLLA_ATTENDANCE_ADMIN_ENABLED','FAOLLA_ATTENDANCE_TIMESHEET_ENABLED'],saved=keys.map(k=>process.env[k]);
  try{for(const k of keys)process.env[k]='1';assert.equal(attendanceTimesheetDependencies.enabled(),true);
    for(const k of keys){delete process.env[k];assert.equal(attendanceTimesheetDependencies.enabled(),false);process.env[k]='1';}
  }finally{keys.forEach((k,n)=>{if(saved[n]===undefined)delete process.env[k];else process.env[k]=saved[n];});}
});
