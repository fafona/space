import assert from "node:assert/strict";
import test from "node:test";
import type {User} from "@supabase/supabase-js";
import {attendanceSessionDependencies,handleAttendanceSession} from "./route-handler";
import {MerchantAttendanceError} from "@/lib/merchantAttendanceTime";
import {MerchantEnterpriseAccessError} from "@/lib/merchantEnterpriseAuth.server";
const id="00000000-0000-4000-8000-000000000001";
const base="https://www.faolla.com/api/merchant-enterprise/attendance/session",params={siteId:"99990001",startEventId:id};
const request=(extra:Record<string,string>={})=>new Request(`${base}?${new URLSearchParams({...params,...extra})}`);
function setup(extra:Partial<typeof attendanceSessionDependencies>={}){
  const calls:Parameters<typeof attendanceSessionDependencies.execute>[0][]=[];
  const deps:typeof attendanceSessionDependencies={enabled:()=>true,allow:()=>true,
    authenticate:async()=>({user:{id} as User,accessToken:"synthetic",authenticationMethods:["password"]}),
    entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}) as Awaited<ReturnType<typeof attendanceSessionDependencies.entitlement>>,
    execute:async input=>{calls.push(input);return {siteId:input.siteId,employeeId:id,workerId:id,asOf:"2026-09-03T00:00:00.000000Z",events:[]};},...extra};
  return {deps,calls};
}
test("self session route is closed by default and accepts only canonical GET",async()=>{
  let reached=false;const {deps}=setup({enabled:()=>false,authenticate:async()=>{reached=true;throw Error("unreachable");}});
  assert.equal((await handleAttendanceSession(request(),deps)).status,404);deps.enabled=()=>true;
  assert.equal((await handleAttendanceSession(new Request(base,{method:"POST"}),deps)).status,405);
  assert.equal((await handleAttendanceSession(new Request(request().url.replace("www.","merchant.")),deps)).status,403);assert.equal(reached,false);
});
for(const authenticationMethods of [[],["oauth"],["magiclink"],["password","invite"],["recovery"]])test(`self session rejects non-normal password session: ${authenticationMethods}`,async()=>{
  const {deps,calls}=setup({authenticate:async()=>({user:{id} as User,accessToken:"synthetic",authenticationMethods})});
  assert.equal((await handleAttendanceSession(request(),deps)).status,403);assert.equal(calls.length,0);
});
test("session route binds server identity, allows paused reads and forbids employee targeting",async()=>{
  const {deps,calls}=setup(),response=await handleAttendanceSession(request(),deps);assert.equal(response.status,200);
  assert.equal((await response.json()).moduleEnabled,false);assert.equal(response.headers.get("cache-control"),"private, no-store");
  assert.deepEqual(calls,[{...params,authUserId:id}]);
  for(const key of ["employeeId","workerId","authUserId","isOwner","permissions","limit","asOf","fromAt"])
    assert.equal((await handleAttendanceSession(request({[key]:id}),deps)).status,400);
  assert.equal(calls.length,1);
});
test("session refresh repeats identity, entitlement and database scope checks",async()=>{
  let auth=0,entitlement=0;const {deps}=setup(),originalAuth=deps.authenticate,originalRead=deps.entitlement;
  deps.authenticate=async req=>{auth++;return originalAuth(req);};deps.entitlement=async site=>{entitlement++;return originalRead(site);};
  assert.equal((await handleAttendanceSession(request(),deps)).status,200);
  deps.execute=async()=>{throw new MerchantAttendanceError("attendance_access_denied");};assert.equal((await handleAttendanceSession(request(),deps)).status,403);
  assert.equal(auth,2);assert.equal(entitlement,2);
});
test("session errors distinguish not-found and review-needed without leaking DB messages",async()=>{
  for(const [extra,status] of [[{allow:()=>false},429],
    [{execute:async()=>{throw new MerchantAttendanceError("attendance_session_not_found");}},404],
    [{execute:async()=>{throw new MerchantAttendanceError("attendance_session_too_large");}},422],
    [{execute:async()=>{throw new MerchantAttendanceError("attendance_session_invalid_records");}},422],
    [{entitlement:async()=>{throw new MerchantEnterpriseAccessError("enterprise_management_disabled",403);}},403],
    [{execute:async()=>{throw Error("private SQL");}},503]] as const){
    const {deps}=setup(extra),response=await handleAttendanceSession(request(),deps);assert.equal(response.status,status);
    assert.doesNotMatch(await response.text(),/private SQL/);if(status===429)assert.equal(response.headers.get("retry-after"),"60");
  }
});
