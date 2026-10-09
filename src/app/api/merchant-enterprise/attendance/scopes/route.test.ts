import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleAttendanceScopes, attendanceScopesDependencies } from "./route-handler";
import type { AttendanceScopeInput } from "@/lib/merchantAttendanceManagement.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
const id="00000000-0000-4000-8000-000000000001",employee="00000000-0000-4000-8000-000000000002";
const url="https://www.faolla.com/api/merchant-enterprise/attendance/scopes";
const body={siteId:"99990001",employeeId:employee,operationId:id,expectedRevision:0,action:"put",grantId:id,
  grant:{workerIds:[id],locationIds:[id],validFrom:"2026-01-01T00:00:00.000Z",validUntil:null}};
const post=(value:unknown=body,origin="https://www.faolla.com")=>new Request(url,{method:"POST",headers:{"content-type":"application/json",origin},body:JSON.stringify(value)});
const get=()=>new Request(`${url}?siteId=99990001&employeeId=${employee}&operationId=${id}`);
function setup(extra:Partial<typeof attendanceScopesDependencies>={}) {
  const calls:AttendanceScopeInput[]=[];
  const deps:typeof attendanceScopesDependencies={enabled:()=>true,
    authenticate:async()=>({user:{id} as User,accessToken:"synthetic",authenticationMethods:["oauth"]}),allow:()=>true,
    entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}}) as Awaited<ReturnType<typeof attendanceScopesDependencies.entitlement>>,
    execute:async input=>{calls.push(input);return {scope:{siteId:input.siteId,employeeId:input.employeeId,revision:0,grants:[]},receipt:null};},...extra};
  return {calls,deps};
}
test("scope route defaults closed and rejects bad origin before authentication",async()=>{
  let accessed=false;const {deps}=setup({enabled:()=>false,authenticate:async()=>{accessed=true;throw Error("no");}});
  assert.equal((await handleAttendanceScopes(post(),deps)).status,404);deps.enabled=()=>true;
  assert.equal((await handleAttendanceScopes(post(body,"https://bad.example"),deps)).status,403);
  assert.equal((await handleAttendanceScopes(new Request(url.replace("www.","merchant.")+"?siteId=99990001"),deps)).status,403);
  assert.equal(accessed,false);
});
test("scope API passes only verified owner candidate and strict explicit target to RPC",async()=>{
  const {deps,calls}=setup();const r=await handleAttendanceScopes(post(),deps);assert.equal(r.status,200);
  assert.equal(calls[0].authUserId,id);assert.equal(calls[0].employeeId,employee);assert.equal(r.headers.get("cache-control"),"private, no-store");
  for(const k of ["authUserId","actor","isOwner","moduleEnabled"])assert.equal((await handleAttendanceScopes(post({...body,[k]:true}),deps)).status,400);
  assert.equal(calls.length,1);
});
for(const authenticationMethods of [[],["invite"],["password","recovery"],["magiclink"]])test(`scope rejects unsafe authentication ${authenticationMethods}`,async()=>{
  const {deps,calls}=setup({authenticate:async()=>({user:{id} as User,accessToken:"synthetic",authenticationMethods})});
  assert.equal((await handleAttendanceScopes(post(),deps)).status,403);assert.equal(calls.length,0);
});
test("platform pause forbids new/replacement grants but permits reads and security revocation",async()=>{
  const {deps,calls}=setup({entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}) as Awaited<ReturnType<typeof attendanceScopesDependencies.entitlement>>});
  assert.equal((await handleAttendanceScopes(post(),deps)).status,403);assert.equal(calls.length,0);
  const r=await handleAttendanceScopes(get(),deps);assert.equal(r.status,200);assert.equal((await r.json()).moduleEnabled,false);assert.equal(calls[0].operationId,id);
  assert.equal((await handleAttendanceScopes(post({...body,action:"remove",grant:null}),deps)).status,200);assert.equal(calls[1].command?.action,"remove");
  deps.execute=async()=>{throw new MerchantAttendanceError("attendance_access_denied");};
  assert.equal((await handleAttendanceScopes(post({...body,action:"remove",grant:null}),deps)).status,403);
});
test("revocation exception never bypasses hard entitlement, rate or current owner denial",async()=>{
  for(const [overrides,status] of [[{entitlement:async()=>{throw new MerchantEnterpriseAccessError("enterprise_management_disabled",403);}},403],
    [{allow:()=>false},429],[{execute:async()=>{throw new MerchantAttendanceError("attendance_access_denied");}},403],
    [{execute:async()=>{throw Error("database private data");}},503],
    [{execute:async()=>{throw new MerchantAttendanceError("toString");}},503]] as const) {
    const {deps}=setup(overrides),r=await handleAttendanceScopes(post({...body,action:"remove",grant:null}),deps);
    assert.equal(r.status,status);assert.equal((await r.json()).ok,false);
  }
});
test("scope byte limit and duplicate query fields reject before RPC",async()=>{
  const {deps,calls}=setup();assert.equal((await handleAttendanceScopes(post({...body,padding:"x".repeat(16384)}),deps)).status,413);
  assert.equal((await handleAttendanceScopes(new Request(get().url+`&employeeId=${id}`),deps)).status,400);
  assert.equal((await handleAttendanceScopes(new Request(url,{method:"DELETE"}),deps)).status,405);assert.equal(calls.length,0);
});
