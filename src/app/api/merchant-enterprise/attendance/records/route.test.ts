import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleAttendanceRecords, attendanceRecordsDependencies } from "./route-handler";
import type { AttendanceRecordsInput } from "@/lib/merchantAttendanceManagement.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
const id="00000000-0000-4000-8000-000000000001";
const url="https://www.faolla.com/api/merchant-enterprise/attendance/records";
const parameters={siteId:"99990001",access:"manager",fromAt:"2026-09-01T00:00:00.000Z",toAt:"2026-09-02T00:00:00.000Z"};
const request=(patch:Record<string,string>={})=>new Request(`${url}?${new URLSearchParams({...parameters,...patch})}`);
function setup(extra:Partial<typeof attendanceRecordsDependencies>={}) {
  const calls:AttendanceRecordsInput[]=[];
  const deps:typeof attendanceRecordsDependencies={enabled:()=>true,
    authenticate:async()=>({user:{id} as User,accessToken:"synthetic",authenticationMethods:["password"]}),allow:()=>true,
    entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:true}}) as Awaited<ReturnType<typeof attendanceRecordsDependencies.entitlement>>,
    execute:async input=>{calls.push(input);return {siteId:input.siteId,access:input.access,scopeRevision:input.access==="owner"?null:1,
      asOf:"2026-09-29T00:00:00.000000Z",items:[],nextCursor:null};},...extra};
  return {calls,deps};
}
test("record route defaults off and rejects writes and foreign portal",async()=>{
  let auth=false;const {deps}=setup({enabled:()=>false,authenticate:async()=>{auth=true;throw Error("no");}});
  assert.equal((await handleAttendanceRecords(request(),deps)).status,404);deps.enabled=()=>true;
  assert.equal((await handleAttendanceRecords(new Request(url,{method:"POST"}),deps)).status,405);
  assert.equal((await handleAttendanceRecords(new Request(request().url.replace("www.","merchant.")),deps)).status,403);assert.equal(auth,false);
});
test("manager reads bind verified auth and never accept employee or permission overrides",async()=>{
  const {deps,calls}=setup();const r=await handleAttendanceRecords(request(),deps);assert.equal(r.status,200);assert.equal(calls[0].authUserId,id);
  assert.equal(r.headers.get("cache-control"),"private, no-store");
  for(const key of ["employeeId","authUserId","permissions","scope","offset"])assert.equal((await handleAttendanceRecords(request({[key]:id}),deps)).status,400);
  assert.equal(calls.length,1);
});
test("OAuth remains owner-only and choosing owner does not skip DB ownership validation",async()=>{
  const {deps,calls}=setup({authenticate:async()=>({user:{id} as User,accessToken:"synthetic",authenticationMethods:["oauth"]})});
  assert.equal((await handleAttendanceRecords(request(),deps)).status,403);assert.equal(calls.length,0);
  assert.equal((await handleAttendanceRecords(request({access:"owner"}),deps)).status,200);assert.equal(calls[0].access,"owner");
  deps.execute=async()=>{throw new MerchantAttendanceError("attendance_access_denied");};
  assert.equal((await handleAttendanceRecords(request({access:"owner"}),deps)).status,403);
});
for(const authenticationMethods of [[],["recovery"],["password","invite"],["magiclink"]])test(`record read rejects unsafe auth ${authenticationMethods}`,async()=>{
  const {deps,calls}=setup({authenticate:async()=>({user:{id} as User,accessToken:"synthetic",authenticationMethods})});
  assert.equal((await handleAttendanceRecords(request(),deps)).status,403);assert.equal((await handleAttendanceRecords(request({access:"owner"}),deps)).status,403);assert.equal(calls.length,0);
});
test("paused history reads remain authorized and every cursor page rechecks server access",async()=>{
  let reads=0;const {deps,calls}=setup({entitlement:async()=>{reads++;return {permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}} as Awaited<ReturnType<typeof attendanceRecordsDependencies.entitlement>>;}});
  const first=await handleAttendanceRecords(request(),deps);assert.equal(first.status,200);assert.equal((await first.json()).moduleEnabled,false);
  deps.execute=async()=>{throw new MerchantAttendanceError("attendance_access_denied");};
  const next=await handleAttendanceRecords(request({asOf:"2026-09-29T00:00:00.000000Z",cursorAt:"2026-09-01T12:00:00.123456Z",cursorId:id}),deps);
  assert.equal(next.status,403);assert.equal(reads,2);assert.equal(calls.length,1);
});
test("record API honors entitlement/rate failures and masks internal errors",async()=>{
  for(const [overrides,status] of [[{entitlement:async()=>{throw new MerchantEnterpriseAccessError("enterprise_management_disabled",403);}},403],
    [{allow:()=>false},429],[{execute:async()=>{throw Error("private SQL data");}},503]] as const) {
    const {deps}=setup(overrides),r=await handleAttendanceRecords(request(),deps);assert.equal(r.status,status);assert.equal((await r.json()).ok,false);
    if(status===429)assert.equal(r.headers.get("retry-after"),"60");
  }
});
