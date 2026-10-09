import assert from "node:assert/strict";
import test from "node:test";
import type {User} from "@supabase/supabase-js";
import {attendanceAuditExportDependencies,handleAttendanceAuditExport} from "./route-handler";
import {MerchantAttendanceError} from "@/lib/merchantAttendanceTime";
import {MerchantEnterpriseAccessError} from "@/lib/merchantEnterpriseAuth.server";
const id="00000000-0000-4000-8000-000000000001";
const base="https://www.faolla.com/api/merchant-enterprise/attendance/audit-export";
const parameters={siteId:"99990001",source:"config",fromAt:"2026-09-01T00:00:00.000Z",toAt:"2026-09-02T00:00:00.000Z"};
const request=(patch:Record<string,string>={})=>new Request(`${base}?${new URLSearchParams({...parameters,...patch})}`);
function setup(extra:Partial<typeof attendanceAuditExportDependencies>={}){
  const calls:Parameters<typeof attendanceAuditExportDependencies.execute>[0][]=[];
  const deps:typeof attendanceAuditExportDependencies={enabled:()=>true,allow:()=>true,
    authenticate:async()=>({user:{id} as User,accessToken:"synthetic",authenticationMethods:["password"]}),
    entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}) as Awaited<ReturnType<typeof attendanceAuditExportDependencies.entitlement>>,
    execute:async input=>{calls.push(input);return {siteId:input.siteId,source:input.source,fromAt:input.fromAt,toAt:input.toAt,
      schemaVersion:1,asOf:"2026-09-03T00:00:00.000000Z",count:0,rows:[]};},...extra};
  return {deps,calls};
}
test("export inherits the closed admin gate and permits only canonical read requests",async()=>{
  let authenticated=false;const {deps}=setup({enabled:()=>false,authenticate:async()=>{authenticated=true;throw Error("unreachable");}});
  assert.equal((await handleAttendanceAuditExport(request(),deps)).status,404);deps.enabled=()=>true;
  for(const method of ["POST","PUT","DELETE"])assert.equal((await handleAttendanceAuditExport(new Request(base,{method}),deps)).status,405);
  assert.equal((await handleAttendanceAuditExport(new Request(request().url.replace("www.","merchant.")),deps)).status,403);
  assert.equal(authenticated,false);
});
test("incomplete and recovery/invitation authentication cannot export",async()=>{
  for(const authenticationMethods of [[],["recovery"],["password","invite"],["magiclink"]]){
    const {deps,calls}=setup({authenticate:async()=>({user:{id} as User,accessToken:"synthetic",authenticationMethods})});
    assert.equal((await handleAttendanceAuditExport(request(),deps)).status,403);assert.equal(calls.length,0);
  }
});
test("verified identity is server supplied; exports remain read-only with punching paused",async()=>{
  for(const authenticationMethods of [["password"],["oauth"]]){
    const {deps,calls}=setup({authenticate:async()=>({user:{id} as User,accessToken:"synthetic",authenticationMethods})});
    const response=await handleAttendanceAuditExport(request(),deps);assert.equal(response.status,200);assert.equal((await response.json()).moduleEnabled,false);
    assert.equal(calls[0].authUserId,id);assert.equal(response.headers.get("cache-control"),"private, no-store");
    assert.equal(response.headers.get("x-content-type-options"),"nosniff");assert.match(response.headers.get("vary")!,/Cookie, Authorization/);
    for(const field of ["authUserId","employeeId","isOwner","limit","cursorId","asOf","offset"])
      assert.equal((await handleAttendanceAuditExport(request({[field]:id}),deps)).status,400);
    assert.equal(calls.length,1);
  }
});
test("each export repeats auth, entitlement and SQL authorization, including after revocation",async()=>{
  let auth=0,entitlement=0;const {deps,calls}=setup();const authenticate=deps.authenticate,read=deps.entitlement;
  deps.authenticate=async r=>{auth++;return authenticate(r);};deps.entitlement=async site=>{entitlement++;return read(site);};
  assert.equal((await handleAttendanceAuditExport(request(),deps)).status,200);
  deps.execute=async input=>{calls.push(input);throw new MerchantAttendanceError("attendance_access_denied");};
  const denied=await handleAttendanceAuditExport(request(),deps);assert.equal(denied.status,403);assert.equal("rows" in await denied.json(),false);
  assert.equal(auth,2);assert.equal(entitlement,2);assert.equal(calls.length,2);
});
test("oversize and throttled exports return no partial rows; failures do not expose SQL",async()=>{
  for(const [extra,status] of [[{allow:()=>false},429],
    [{execute:async()=>{throw new MerchantAttendanceError("attendance_export_too_large");}},413],
    [{authenticate:async()=>{throw new MerchantEnterpriseAccessError("unauthorized",401);}},401],
    [{entitlement:async()=>{throw new MerchantEnterpriseAccessError("enterprise_management_disabled",403);}},403],
    [{execute:async()=>{throw Error("private SQL");}},503]] as const){
    const {deps}=setup(extra),response=await handleAttendanceAuditExport(request(),deps);assert.equal(response.status,status);
    assert.doesNotMatch(await response.text(),/private SQL|"rows"/);if(status===429)assert.equal(response.headers.get("retry-after"),"60");
  }
});
