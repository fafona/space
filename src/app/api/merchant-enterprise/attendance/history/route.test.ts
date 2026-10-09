import assert from "node:assert/strict";
import test from "node:test";
import type {User} from "@supabase/supabase-js";
import {attendanceHistoryDependencies,handleAttendanceHistory} from "./route-handler";
import type {AttendanceHistoryInput} from "@/lib/merchantAttendanceHistory.server";
import {MerchantAttendanceError} from "@/lib/merchantAttendanceTime";
import {MerchantEnterpriseAccessError} from "@/lib/merchantEnterpriseAuth.server";

const id="00000000-0000-4000-8000-000000000001";
const base="https://www.faolla.com/api/merchant-enterprise/attendance/history";
const parameters={siteId:"99990001",fromAt:"2026-09-01T00:00:00.000Z",toAt:"2026-09-03T00:00:00.000Z"};
const request=(patch:Record<string,string>={})=>new Request(`${base}?${new URLSearchParams({...parameters,...patch})}`);
function setup(extra:Partial<typeof attendanceHistoryDependencies>={}) {
  const calls:AttendanceHistoryInput[]=[];
  const deps:typeof attendanceHistoryDependencies={enabled:()=>true,allow:()=>true,
    authenticate:async()=>({user:{id} as User,accessToken:"synthetic",authenticationMethods:["password"]}),
    entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}) as Awaited<ReturnType<typeof attendanceHistoryDependencies.entitlement>>,
    execute:async input=>{calls.push(input);return {siteId:input.siteId,employeeId:id,workerId:id,asOf:"2026-09-04T00:00:00.000000Z",items:[],nextCursor:null};},...extra};
  return {deps,calls};
}
test("history route defaults closed and accepts canonical GET only",async()=>{
  let authenticated=false;const {deps}=setup({enabled:()=>false,authenticate:async()=>{authenticated=true;throw Error("not reached");}});
  assert.equal((await handleAttendanceHistory(request(),deps)).status,404);deps.enabled=()=>true;
  assert.equal((await handleAttendanceHistory(new Request(base,{method:"POST"}),deps)).status,405);
  assert.equal((await handleAttendanceHistory(new Request(request().url.replace("www.","merchant.")),deps)).status,403);
  assert.equal(authenticated,false);
});
for(const authenticationMethods of [[],["oauth"],["recovery"],["password","invite"],["magiclink"]])test(`history requires current normal password auth: ${authenticationMethods}`,async()=>{
  const {deps,calls}=setup({authenticate:async()=>({user:{id} as User,accessToken:"synthetic",authenticationMethods})});
  assert.equal((await handleAttendanceHistory(request(),deps)).status,403);assert.equal(calls.length,0);
});
test("paused self history reads bind verified identity and private no-store headers",async()=>{
  const {deps,calls}=setup();const response=await handleAttendanceHistory(request(),deps);
  assert.equal(response.status,200);assert.equal((await response.json()).moduleEnabled,false);
  assert.equal(calls[0].authUserId,id);assert.equal(response.headers.get("cache-control"),"private, no-store");
  for(const key of ["employeeId","workerId","authUserId","access","isOwner","permissions","limit","scope"])
    assert.equal((await handleAttendanceHistory(request({[key]:id}),deps)).status,400);
  assert.equal(calls.length,1);
});
test("history repeats auth, entitlement and DB checks on every cursor page",async()=>{
  let auth=0,entitlement=0;const {deps}=setup();const authenticate=deps.authenticate,readEntitlement=deps.entitlement;
  deps.authenticate=async r=>{auth++;return authenticate(r);};deps.entitlement=async site=>{entitlement++;return readEntitlement(site);};
  assert.equal((await handleAttendanceHistory(request(),deps)).status,200);
  deps.execute=async()=>{throw new MerchantAttendanceError("attendance_access_denied");};
  assert.equal((await handleAttendanceHistory(request({expectedWorkerId:id,asOf:"2026-09-04T00:00:00.000000Z",cursorAt:"2026-09-01T12:00:00.000123Z",cursorId:id}),deps)).status,403);
  assert.equal(auth,2);assert.equal(entitlement,2);
});
test("history masks internal errors and preserves rate, binding and enterprise denial statuses",async()=>{
  for(const [extra,status] of [[{allow:()=>false},429],[{execute:async()=>{throw new MerchantAttendanceError("attendance_worker_changed");}},409],
    [{entitlement:async()=>{throw new MerchantEnterpriseAccessError("enterprise_management_disabled",403);}},403],
    [{execute:async()=>{throw Error("private SQL and customer data");}},503]] as const) {
    const {deps}=setup(extra),response=await handleAttendanceHistory(request(),deps);assert.equal(response.status,status);
    assert.doesNotMatch(await response.text(),/private SQL/);if(status===429)assert.equal(response.headers.get("retry-after"),"60");
  }
});
