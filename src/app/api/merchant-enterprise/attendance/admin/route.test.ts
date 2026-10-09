import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleAttendanceAdmin, attendanceAdminDependencies } from "./route-handler";
import type { AttendanceAdminInput } from "@/lib/merchantAttendanceAdmin.server";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
const id="00000000-0000-4000-8000-000000000001";
const settings={timeZone:"UTC",enabled:false,webClockEnabled:false,webBreakPaid:false};
const body={siteId:"99990001",operationId:id,expectedVersion:0,kind:"settings",values:settings};
const url="https://www.faolla.com/api/merchant-enterprise/attendance/admin";
const post=(value:unknown=body,origin="https://www.faolla.com")=>new Request(url,{method:"POST",headers:{"Content-Type":"application/json",origin},body:JSON.stringify(value)});
function setup(extra:Partial<typeof attendanceAdminDependencies>={}) {
  const calls:AttendanceAdminInput[]=[];
  const deps:typeof attendanceAdminDependencies={enabled:()=>true,authenticate:async()=>({user:{id} as User,accessToken:"synthetic",authenticationMethods:["oauth"]}),
    entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}}) as Awaited<ReturnType<typeof attendanceAdminDependencies.entitlement>>,allow:()=>true,
    execute:async(input)=>{calls.push(input);return {siteId:input.siteId,version:0,settings:null,view:input.view,items:[],nextCursor:null,receipt:null};},...extra};
  return {calls,deps};
}
test("owner config route defaults off and does not authenticate",async()=>{
  const {deps,calls}=setup({enabled:()=>false,authenticate:async()=>{throw Error("unexpected");}});const r=await handleAttendanceAdmin(post(),deps);assert.equal(r.status,404);assert.equal(r.headers.get("cache-control"),"private, no-store");assert.equal(calls.length,0);
});
test("owner OAuth uses validated auth identity only, not client roles",async()=>{
  const {deps,calls}=setup();assert.equal((await handleAttendanceAdmin(post(),deps)).status,200);assert.equal(calls[0].authUserId,id);
  for(const key of ["authUserId","actor","employeeId","permissions"])assert.equal((await handleAttendanceAdmin(post({...body,[key]:id}),deps)).status,400);
  assert.equal(calls.length,1);
});
for(const authenticationMethods of [[],["recovery"],["password","invite"],["magiclink"]])test(`owner config rejects unsafe session ${authenticationMethods}`,async()=>{
  const {deps,calls}=setup({authenticate:async()=>({user:{id} as User,accessToken:"synthetic",authenticationMethods})});assert.equal((await handleAttendanceAdmin(post(),deps)).status,403);assert.equal(calls.length,0);
});
test("origin and merchant-domain checks run before auth",async()=>{
  let auth=false;const {deps}=setup({authenticate:async()=>{auth=true;throw Error("unexpected");}});
  assert.equal((await handleAttendanceAdmin(post(body,"https://other.example"),deps)).status,403);
  assert.equal((await handleAttendanceAdmin(new Request("https://merchant.faolla.com/api/merchant-enterprise/attendance/admin?siteId=99990001"),deps)).status,403);assert.equal(auth,false);
});
test("entitlement, rate limit and denied owner never become success",async()=>{
  for(const [overrides,status] of [[{entitlement:async()=>{throw new MerchantEnterpriseAccessError("enterprise_management_disabled",403);}},403],[{allow:()=>false},429],[{execute:async()=>{throw new MerchantAttendanceError("attendance_access_denied");}},403],[{execute:async()=>{throw Error("private database details");}},503]] as const) {
    const {deps}=setup(overrides);const r=await handleAttendanceAdmin(post(),deps);assert.equal(r.status,status);assert.equal((await r.json()).ok,false);
  }
});
test("query pagination strict and body size bounded",async()=>{
  const {deps,calls}=setup();assert.equal((await handleAttendanceAdmin(new Request(`${url}?siteId=99990001&view=workers&cursor=${id}`),deps)).status,200);assert.equal(calls[0].cursor,id);
  assert.equal((await handleAttendanceAdmin(new Request(`${url}?siteId=99990001&view=workers&offset=50`),deps)).status,400);
  assert.equal((await handleAttendanceAdmin(post({...body,padding:"x".repeat(4096)}),deps)).status,413);assert.equal(calls.length,1);
});
test("platform pause blocks every config write but keeps owner-scoped reads and receipts",async()=>{
  const {deps,calls}=setup({entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}) as Awaited<ReturnType<typeof attendanceAdminDependencies.entitlement>>});
  const response=await handleAttendanceAdmin(post(),deps);
  assert.equal(response.status,403);assert.equal((await response.json()).error,"attendance_platform_paused");assert.equal(calls.length,0);
  const read=await handleAttendanceAdmin(new Request(`${url}?siteId=99990001&operationId=${id}`),deps);
  assert.equal(read.status,200);assert.equal((await read.json()).moduleEnabled,false);assert.equal(calls[0].operationId,id);
  deps.execute=async()=>{throw new MerchantAttendanceError("attendance_access_denied");};
  assert.equal((await handleAttendanceAdmin(new Request(`${url}?siteId=99990001`),deps)).status,403);
});
test("missing platform flag is closed and client cannot override it",async()=>{
  const {deps,calls}=setup({entitlement:async()=>({}) as Awaited<ReturnType<typeof attendanceAdminDependencies.entitlement>>});
  assert.equal((await handleAttendanceAdmin(post(),deps)).status,403);
  assert.equal((await handleAttendanceAdmin(post({...body,moduleEnabled:true}),deps)).status,400);assert.equal(calls.length,0);
});
