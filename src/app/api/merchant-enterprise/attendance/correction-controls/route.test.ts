import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleCorrectionControls, correctionControlDependencies } from "./route-handler";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { createCorrectionControlsFixture, controlId as id, controlSite as siteId, controlOwner as ownerId } from "../../../../../../scripts/fixtures/attendance-correction-controls-model";
const url="https://www.faolla.com/api/merchant-enterprise/attendance/correction-controls";
const body={siteId,operationId:id(100),expectedRevision:0,expectedSettingsVersion:1,action:"set_policy",submissionWindowDays:7,reason:"负责人理由"};
const get=()=>new Request(`${url}?siteId=${siteId}`);
const post=(value:unknown=body,origin="https://www.faolla.com")=>new Request(url,{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify(value)});
function setup(extra:Partial<typeof correctionControlDependencies>={}){
  const calls:Parameters<typeof correctionControlDependencies.execute>[0][]=[];
  const deps:typeof correctionControlDependencies={enabled:()=>true,allow:()=>true,authenticate:async()=>({user:{id:ownerId} as User,accessToken:"synthetic",authenticationMethods:["password"]}),
    entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}) as Awaited<ReturnType<typeof correctionControlDependencies.entitlement>>,
    execute:async input=>{calls.push(input);return createCorrectionControlsFixture().response(null,null);},...extra};return {deps,calls};
}
test("controls default-off, method/canonical/origin guards run before auth",async()=>{let auth=false;const {deps}=setup({enabled:()=>false,authenticate:async()=>{auth=true;throw Error("unreachable");}});
  assert.equal((await handleCorrectionControls(get(),deps)).status,404);deps.enabled=()=>true;
  assert.equal((await handleCorrectionControls(new Request(url,{method:"DELETE"}),deps)).status,405);
  assert.equal((await handleCorrectionControls(post(body,"https://other.invalid"),deps)).status,403);
  assert.equal((await handleCorrectionControls(new Request(get().url.replace("www.","merchant.")),deps)).status,403);assert.equal(auth,false);});
test("only full owner auth context allowed; owner identity/paused write flag come from server",async()=>{
  for(const methods of [[],["recovery"],["invite"],["magiclink"],["password","recovery"]]){const {deps,calls}=setup({authenticate:async()=>({user:{id:ownerId} as User,accessToken:"synthetic",authenticationMethods:methods})});
    assert.equal((await handleCorrectionControls(post(),deps)).status,403);assert.equal(calls.length,0);}
  for(const methods of [["password"],["oauth"]]){const {deps,calls}=setup({authenticate:async()=>({user:{id:ownerId} as User,accessToken:"synthetic",authenticationMethods:methods})});
    const r=await handleCorrectionControls(post(),deps);assert.equal(r.status,200);assert.equal(calls[0].authUserId,ownerId);assert.equal(calls[0].allowWrite,false);assert.equal((await r.json()).moduleEnabled,false);}
});
test("GET receipt and history remain read-only with fresh entitlement and no-store",async()=>{const {deps,calls}=setup();const r=await handleCorrectionControls(new Request(`${get().url}&operationId=${id(100)}&beforeRevision=25`),deps);
  assert.equal(r.status,200);assert.equal(calls[0].command,null);assert.equal(calls[0].query.beforeRevision,25);assert.equal(calls[0].query.operationId,id(100));assert.equal(r.headers.get("cache-control"),"private, no-store");
  deps.entitlement=async()=>{throw new MerchantEnterpriseAccessError("enterprise_management_disabled",403);};assert.equal((await handleCorrectionControls(get(),deps)).status,403);assert.equal(calls.length,1);});
test("actor/enforcement injection, query mixing, wrong content and oversized body never execute",async()=>{const {deps,calls}=setup();
  for(const patch of [{allowWrite:true},{actor:ownerId},{rulesEnforced:true},{action:"approve"},{timeZone:"UTC"}])assert.equal((await handleCorrectionControls(post({...body,...patch}),deps)).status,400);
  assert.equal((await handleCorrectionControls(new Request(`${url}?siteId=${siteId}`,{method:"POST",headers:{origin:"https://www.faolla.com","content-type":"application/json"},body:JSON.stringify(body)}),deps)).status,400);
  assert.equal((await handleCorrectionControls(new Request(url,{method:"POST",headers:{origin:"https://www.faolla.com","content-type":"text/plain"},body:"{}"}),deps)).status,415);
  assert.equal((await handleCorrectionControls(post({...body,reason:"x".repeat(5000)}),deps)).status,413);assert.equal(calls.length,0);});
test("conflicts, rate limits, and private SQL failures are mapped without leaking internals",async()=>{
  for(const [override,status,error] of [[{allow:()=>false},429,"attendance_rate_limited"],[{execute:async()=>{throw new MerchantAttendanceError("attendance_period_overlap");}},409,"attendance_period_overlap"],
    [{execute:async()=>{throw new MerchantAttendanceError("attendance_version_conflict");}},409,"attendance_version_conflict"],[{execute:async()=>{throw Error("secret relation");}},503,"attendance_unavailable"]] as const){
    const {deps}=setup(override),r=await handleCorrectionControls(post(),deps);assert.equal(r.status,status);assert.equal((await r.json()).error,error);if(status===429)assert.equal(r.headers.get("retry-after"),"60");}
});
