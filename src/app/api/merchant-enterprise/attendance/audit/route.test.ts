import assert from "node:assert/strict";
import test from "node:test";
import type {User} from "@supabase/supabase-js";
import {attendanceAuditDependencies,handleAttendanceAudit} from "./route-handler";
import {MerchantAttendanceError} from "@/lib/merchantAttendanceTime";
import {MerchantEnterpriseAccessError} from "@/lib/merchantEnterpriseAuth.server";
const id="00000000-0000-4000-8000-000000000001";
const base="https://www.faolla.com/api/merchant-enterprise/attendance/audit";
const parameters={siteId:"99990001",source:"config",mode:"list",fromAt:"2026-09-01T00:00:00.000Z",toAt:"2026-09-02T00:00:00.000Z"};
const request=(patch:Record<string,string>={})=>new Request(`${base}?${new URLSearchParams({...parameters,...patch})}`);
function setup(extra:Partial<typeof attendanceAuditDependencies>={}){
  const calls:Parameters<typeof attendanceAuditDependencies.execute>[0][]=[];
  const deps:typeof attendanceAuditDependencies={enabled:()=>true,allow:()=>true,
    authenticate:async()=>({user:{id} as User,accessToken:"synthetic",authenticationMethods:["password"]}),
    entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}) as Awaited<ReturnType<typeof attendanceAuditDependencies.entitlement>>,
    execute:async input=>{calls.push(input);return {siteId:input.siteId,source:input.source,mode:"list",asOf:"2026-09-03T00:00:00.000000Z",items:[],nextCursor:null};},...extra};
  return {deps,calls};
}
test("audit route is default closed, canonical and read-only",async()=>{
  let authenticated=false;const {deps}=setup({enabled:()=>false,authenticate:async()=>{authenticated=true;throw Error("unreachable");}});
  assert.equal((await handleAttendanceAudit(request(),deps)).status,404);deps.enabled=()=>true;
  for(const method of ["POST","PUT","DELETE"])assert.equal((await handleAttendanceAudit(new Request(base,{method}),deps)).status,405);
  assert.equal((await handleAttendanceAudit(new Request(request().url.replace("www.","merchant.")),deps)).status,403);
  assert.equal(authenticated,false);
});
for(const authenticationMethods of [[],["recovery"],["password","invite"],["magiclink"]])test(`audit denies unsafe auth: ${authenticationMethods}`,async()=>{
  const {deps,calls}=setup({authenticate:async()=>({user:{id} as User,accessToken:"synthetic",authenticationMethods})});
  assert.equal((await handleAttendanceAudit(request(),deps)).status,403);assert.equal(calls.length,0);
});
test("password and OAuth owner reads bind verified identity and remain readable while punching is paused",async()=>{
  for(const authenticationMethods of [["password"],["oauth"]]){
    const {deps,calls}=setup({authenticate:async()=>({user:{id} as User,accessToken:"synthetic",authenticationMethods})});
    const response=await handleAttendanceAudit(request(),deps);assert.equal(response.status,200);assert.equal((await response.json()).moduleEnabled,false);
    assert.equal(calls[0].authUserId,id);assert.equal(response.headers.get("cache-control"),"private, no-store");
    assert.match(response.headers.get("vary")!,/Cookie, Authorization, x-merchant-access-token/);
    for(const field of ["authUserId","employeeId","isOwner","role","permissions","limit","scope","offset"])
      assert.equal((await handleAttendanceAudit(request({[field]:id}),deps)).status,400);
    assert.equal(calls.length,1);
  }
});
test("list, continuation and detail always repeat auth, entitlement and database authorization",async()=>{
  let auth=0,entitlement=0;const {deps,calls}=setup();const authenticate=deps.authenticate,read=deps.entitlement;
  deps.authenticate=async r=>{auth++;return authenticate(r);};deps.entitlement=async site=>{entitlement++;return read(site);};
  assert.equal((await handleAttendanceAudit(request(),deps)).status,200);
  assert.equal((await handleAttendanceAudit(request({asOf:"2026-09-03T00:00:00.000000Z",cursorAt:"2026-09-01T12:00:00.000001Z",cursorId:id}),deps)).status,200);
  deps.execute=async input=>{calls.push(input);throw new MerchantAttendanceError("attendance_access_denied");};
  assert.equal((await handleAttendanceAudit(new Request(`${base}?${new URLSearchParams({siteId:"99990001",source:"config",mode:"detail",operationId:id})}`),deps)).status,403);
  assert.equal(auth,3);assert.equal(entitlement,3);assert.equal(calls.length,3);assert.equal(calls[2].mode,"detail");
});
test("audit preserves denial, not-found and throttling while masking unexpected internals",async()=>{
  for(const [extra,status] of [[{allow:()=>false},429],
    [{execute:async()=>{throw new MerchantAttendanceError("attendance_audit_not_found");}},404],
    [{entitlement:async()=>{throw new MerchantEnterpriseAccessError("enterprise_management_disabled",403);}},403],
    [{execute:async()=>{throw Error("private SQL");}},503]] as const){
    const {deps}=setup(extra),response=await handleAttendanceAudit(request(),deps);assert.equal(response.status,status);
    assert.doesNotMatch(await response.text(),/private SQL/);if(status===429)assert.equal(response.headers.get("retry-after"),"60");
  }
});
