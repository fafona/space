import assert from "node:assert/strict";
import test from "node:test";
import type {User} from "@supabase/supabase-js";
import {handleAttendanceCorrection,correctionDependencies} from "./route-handler";
import type {CorrectionInput} from "@/lib/merchantAttendanceCorrection.server";
import {MerchantAttendanceError} from "@/lib/merchantAttendanceTime";
import {MerchantEnterpriseAccessError} from "@/lib/merchantEnterpriseAuth.server";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const base="https://www.faolla.com/api/merchant-enterprise/attendance/corrections";
const body={siteId:"99990001",expectedWorkerId:id(2),action:"submit",operationId:id(10),expectedRevision:0,startEventId:id(3),expectedLastEventId:id(4),reason:"漏记下班",
  proposal:{startAt:"2026-09-28T08:00:00.000000Z",endAt:"2026-09-28T17:00:00.000000Z",breaks:[]}};
const post=(value:unknown=body,origin="https://www.faolla.com")=>new Request(base,{method:"POST",headers:{"content-type":"application/json",origin},body:JSON.stringify(value)});
const get=()=>new Request(`${base}?${new URLSearchParams({siteId:body.siteId,expectedWorkerId:body.expectedWorkerId,mode:"detail",requestId:body.operationId,operationId:body.operationId})}`);
function setup(extra:Partial<typeof correctionDependencies>={}){
  const calls:CorrectionInput[]=[];
  const deps:typeof correctionDependencies={enabled:()=>true,allow:()=>true,
    authenticate:async()=>({user:{id:id(1)} as User,accessToken:"synthetic",authenticationMethods:["password"]}),
    entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}) as Awaited<ReturnType<typeof correctionDependencies.entitlement>>,
    execute:async input=>{calls.push(input);return {siteId:body.siteId,employeeId:id(5),workerId:id(2),canRequest:true,asOf:"2026-09-30T12:00:00.000000Z",mode:"list",items:[],nextCursor:null};},...extra};
  return {deps,calls};
}
test("correction candidate rejects disabled flags, wrong methods and cross-origin mutations before authentication",async()=>{
  let called=false;const {deps}=setup({enabled:()=>false,authenticate:async()=>{called=true;throw Error("unreachable");}});
  assert.equal((await handleAttendanceCorrection(post(),deps)).status,404);deps.enabled=()=>true;
  assert.equal((await handleAttendanceCorrection(new Request(base,{method:"DELETE"}),deps)).status,405);
  assert.equal((await handleAttendanceCorrection(post(body,"https://other.invalid"),deps)).status,403);
  assert.equal((await handleAttendanceCorrection(new Request(get().url.replace("www.","merchant.")),deps)).status,403);assert.equal(called,false);
});
test("only password employee auth is accepted for all correction modes",async()=>{
  for(const authenticationMethods of [[],["oauth"],["recovery"],["magiclink"],["password","invite"]]){
    const {deps,calls}=setup({authenticate:async()=>({user:{id:id(1)} as User,accessToken:"synthetic",authenticationMethods})});
    assert.equal((await handleAttendanceCorrection(get(),deps)).status,403);assert.equal((await handleAttendanceCorrection(post(),deps)).status,403);assert.equal(calls.length,0);
  }
});
test("server identity and current platform flag are forwarded without locally faking success while paused",async()=>{
  const {deps,calls}=setup();const response=await handleAttendanceCorrection(post(),deps);assert.equal(response.status,200);
  assert.equal(calls[0].authUserId,id(1));assert.equal(calls[0].moduleEnabled,false);assert.equal(calls[0].query.mode,"detail");
  assert.deepEqual(calls[0].query,{siteId:body.siteId,expectedWorkerId:body.expectedWorkerId,mode:"detail",requestId:body.operationId,operationId:null});
  assert.equal(response.headers.get("cache-control"),"private, no-store");assert.equal((await response.json()).moduleEnabled,false);
  deps.execute=async()=>{throw new MerchantAttendanceError("attendance_platform_paused");};assert.equal((await handleAttendanceCorrection(post(),deps)).status,403);
});
test("caller cannot approve, impersonate or alter original events through correction bodies",async()=>{
  const {deps,calls}=setup();
  for(const patch of [{authUserId:id(9)},{employeeId:id(9)},{source:"web"},{status:"approved"},{action:"approve"},{effective:true},{createdAt:"2026-09-28"}])
    assert.equal((await handleAttendanceCorrection(post({...body,...patch}),deps)).status,400);
  const queried=new Request(`${base}?siteId=${body.siteId}`,{method:"POST",headers:{origin:"https://www.faolla.com","content-type":"application/json"},body:JSON.stringify(body)});
  assert.equal((await handleAttendanceCorrection(queried,deps)).status,400);assert.equal(calls.length,0);
});
test("GET receipt, preparation and summary listing authorize independently and never submit a command",async()=>{
  const {deps,calls}=setup();
  for(const suffix of [new URL(get().url).search,`?siteId=${body.siteId}&expectedWorkerId=${id(2)}&mode=prepare&startEventId=${id(3)}`,
    `?siteId=${body.siteId}&expectedWorkerId=${id(2)}&mode=list`])assert.equal((await handleAttendanceCorrection(new Request(base+suffix),deps)).status,200);
  assert.equal(calls.length,3);assert.ok(calls.every(c=>c.command===null));
  deps.execute=async()=>{throw new MerchantAttendanceError("attendance_access_denied");};assert.equal((await handleAttendanceCorrection(get(),deps)).status,403);
});
test("correction API rejects oversized/bad JSON content without reaching the ledger",async()=>{
  const {deps,calls}=setup();assert.equal((await handleAttendanceCorrection(post({...body,reason:"x".repeat(9000)}),deps)).status,413);
  assert.equal((await handleAttendanceCorrection(new Request(base,{method:"POST",headers:{origin:"https://www.faolla.com","content-type":"text/plain"},body:"{}"}),deps)).status,415);
  assert.equal(calls.length,0);
});
test("rate limits, stale basis and command conflicts are distinct; unexpected SQL stays private",async()=>{
  for(const [override,status,expected] of [[{allow:()=>false},429,"attendance_rate_limited"],
    [{execute:async()=>{throw new MerchantAttendanceError("attendance_correction_basis_changed");}},409,"attendance_correction_basis_changed"],
    [{execute:async()=>{throw new MerchantAttendanceError("attendance_operation_conflict");}},409,"attendance_operation_conflict"],
    [{entitlement:async()=>{throw new MerchantEnterpriseAccessError("enterprise_management_disabled",403);}},403,"enterprise_management_disabled"],
    [{execute:async()=>{throw Error("private SQL and employee");}},503,"attendance_unavailable"]] as const){
    const {deps}=setup(override),response=await handleAttendanceCorrection(post(),deps);assert.equal(response.status,status);
    assert.equal((await response.json()).error,expected);if(status===429)assert.equal(response.headers.get("retry-after"),"60");
  }
});
