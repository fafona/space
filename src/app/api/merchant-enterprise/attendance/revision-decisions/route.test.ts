import assert from "node:assert/strict";
import test from "node:test";
import type {User} from "@supabase/supabase-js";
import {handleRevisionDecision as handle,revisionDecisionDependencies as defaults} from "./route-handler";
import {MerchantAttendanceError} from "@/lib/merchantAttendanceTime";
import {MerchantEnterpriseAccessError} from "@/lib/merchantEnterpriseAuth.server";
import {revisionApprovalResponse} from "../../../../../../scripts/fixtures/attendance-revision-approval-model";
const fixture=revisionApprovalResponse("approve"),command=fixture.decision!.command,ownerId="00000000-0000-4000-8000-000000000077",query={siteId:fixture.siteId,requestId:fixture.requestId,operationId:null};
const url="https://www.faolla.com/api/merchant-enterprise/attendance/revision-decisions",body={siteId:query.siteId,...command};
const get=()=>new Request(`${url}?siteId=${query.siteId}&requestId=${query.requestId}`);
const post=(value:unknown=body,origin="https://www.faolla.com")=>new Request(url,{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify(value)});
function setup(extra:Partial<typeof defaults>={}){
  const calls:Parameters<typeof defaults.execute>[0][]=[];
  const deps:typeof defaults={enabled:()=>true,allow:()=>true,authenticate:async()=>({user:{id:ownerId} as User,accessToken:"synthetic",authenticationMethods:["password"]}),
    entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}) as Awaited<ReturnType<typeof defaults.entitlement>>,
    execute:async input=>{calls.push(input);const r=revisionApprovalResponse();r.writeEnabled=input.allowWrite;r.canApprove=r.canReject=input.allowWrite;return r;},...extra};return {deps,calls};
}
test("revision approval default-off/method/canonical/origin guards precede authentication",async()=>{
  let auth=false;const {deps}=setup({enabled:()=>false,authenticate:async()=>{auth=true;throw Error("unreachable");}});
  assert.equal((await handle(get(),deps)).status,404);deps.enabled=()=>true;
  assert.equal((await handle(new Request(url,{method:"DELETE"}),deps)).status,405);
  for(const r of [post(body,"https://other.invalid"),new Request(get().url.replace("www.","merchant.")),new Request(get().url,{headers:{origin:"https://other.invalid"}}),new Request(get().url,{headers:{"sec-fetch-site":"cross-site"}})])assert.equal((await handle(r,deps)).status,403);
  assert.equal(auth,false);
});
test("revision approval rejects partial sessions and takes actor/entitlement exclusively from server",async()=>{
  for(const methods of [[],["invite"],["magiclink"],["recovery"],["password","recovery"],["password"],["oauth"]]){
    const valid=methods.length===1&&["password","oauth"].includes(methods[0]);const {deps,calls}=setup({authenticate:async()=>({user:{id:ownerId} as User,accessToken:"synthetic",authenticationMethods:methods})});
    const r=await handle(post(),deps);assert.equal(r.status,valid?200:403);assert.equal(calls.length,valid?1:0);
    if(valid){assert.deepEqual(calls[0],{query,command,authUserId:ownerId,allowWrite:false});assert.equal((await r.json()).moduleEnabled,false);}
  }
});
test("revision receipt GET is read-only and no-store, fresh entitlement denial prevents execution",async()=>{
  const {deps,calls}=setup(),r=await handle(new Request(`${get().url}&operationId=${command.operationId}`),deps);
  assert.equal(r.status,200);assert.equal(calls[0].command,null);assert.equal(calls[0].query.operationId,command.operationId);
  assert.equal(r.headers.get("cache-control"),"private, no-store");assert.match(r.headers.get("vary")!,/Cookie.*Authorization/);assert.equal(r.headers.get("x-content-type-options"),"nosniff");
  deps.entitlement=async()=>{throw new MerchantEnterpriseAccessError("enterprise_management_disabled",403);};assert.equal((await handle(get(),deps)).status,403);assert.equal(calls.length,1);
});
test("revision approval injection, legacy missing predecessor, mixed query and oversized/non-JSON bodies never execute",async()=>{
  const {deps,calls}=setup();for(const patch of [{authUserId:ownerId},{allowWrite:true},{canApprove:true},{current:{}},{expectedBaseOperationId:null},{expectedBaseOperationId:undefined},{reason:["x"]}])assert.equal((await handle(post({...body,...patch}),deps)).status,400);
  assert.equal((await handle(new Request(get().url,{method:"POST",headers:{origin:"https://www.faolla.com","content-type":"application/json"},body:JSON.stringify(body)}),deps)).status,400);
  assert.equal((await handle(new Request(url,{method:"POST",headers:{origin:"https://www.faolla.com","content-type":"text/plain"},body:"{}"}),deps)).status,415);
  assert.equal((await handle(post({...body,reason:"x".repeat(5000)}),deps)).status,413);
  for(const extra of ["&requestId="+query.requestId,"&operationId="+command.operationId+"&operationId="+command.operationId,"&ownerId="+ownerId])assert.equal((await handle(new Request(get().url+extra),deps)).status,400);
  assert.equal(calls.length,0);
});
test("revision conflicts/rate limits are bounded and unknown errors reveal no SQL details",async()=>{
  for(const code of ["attendance_revision_base_changed","attendance_operation_conflict","attendance_version_conflict","attendance_correction_decided","attendance_correction_evidence_changed","attendance_correction_decision_blocked","attendance_report_version_required"]){
    const r=await handle(post(),setup({execute:async()=>{throw new MerchantAttendanceError(code);}}).deps);assert.equal(r.status,409);assert.equal((await r.json()).error,code);
  }
  const limited=await handle(post(),setup({allow:()=>false}).deps);assert.equal(limited.status,429);assert.equal(limited.headers.get("retry-after"),"60");
  const r=await handle(post(),setup({execute:async()=>{throw Error("private_sql_secret");}}).deps);assert.equal(r.status,503);assert.deepEqual(await r.json(),{ok:false,error:"attendance_unavailable"});
});
test("revision approval needs all four explicit deployment flags",()=>{
  const keys=["FAOLLA_ATTENDANCE_ADMIN_ENABLED","FAOLLA_ATTENDANCE_CORRECTION_REVIEW_ENABLED","FAOLLA_ATTENDANCE_REVISION_REVIEW_ENABLED","FAOLLA_ATTENDANCE_REVISION_DECISIONS_ENABLED"],saved=keys.map(k=>process.env[k]);
  try{keys.forEach(k=>process.env[k]="1");assert.equal(defaults.enabled(),true);for(const k of keys){delete process.env[k];assert.equal(defaults.enabled(),false);process.env[k]="1";}}
  finally{keys.forEach((k,i)=>{if(saved[i]===undefined)delete process.env[k];else process.env[k]=saved[i];});}
});
