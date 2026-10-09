import assert from "node:assert/strict";
import test from "node:test";
import type {User} from "@supabase/supabase-js";
import {handleCorrectionDecision,correctionDecisionDependencies} from "./route-handler";
import {MerchantAttendanceError} from "@/lib/merchantAttendanceTime";
import {MerchantEnterpriseAccessError} from "@/lib/merchantEnterpriseAuth.server";
import {decisionCommand as command,decisionOwner as ownerId,decisionQuery as query,currentDecisionResult} from "../../../../../../scripts/fixtures/attendance-correction-decision-model";
const url="https://www.faolla.com/api/merchant-enterprise/attendance/correction-decisions",body={siteId:query.siteId,...command};
const get=()=>new Request(`${url}?siteId=${query.siteId}&requestId=${query.requestId}`);
const post=(value:unknown=body,origin="https://www.faolla.com")=>new Request(url,{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify(value)});
function setup(extra:Partial<typeof correctionDecisionDependencies>={}){
  const calls:Parameters<typeof correctionDecisionDependencies.execute>[0][]=[];
  const deps:typeof correctionDecisionDependencies={enabled:()=>true,allow:()=>true,
    authenticate:async()=>({user:{id:ownerId} as User,accessToken:"synthetic",authenticationMethods:["password"]}),
    entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}) as Awaited<ReturnType<typeof correctionDecisionDependencies.entitlement>>,
    execute:async input=>{calls.push(input);return currentDecisionResult(undefined,{writeEnabled:input.allowWrite});},...extra};
  return {deps,calls};
}
test("decisions default-off and method/canonical/origin guards run before authentication",async()=>{
  let auth=false;const {deps}=setup({enabled:()=>false,authenticate:async()=>{auth=true;throw Error("unreachable");}});
  assert.equal((await handleCorrectionDecision(get(),deps)).status,404);deps.enabled=()=>true;
  assert.equal((await handleCorrectionDecision(new Request(url,{method:"DELETE"}),deps)).status,405);
  assert.equal((await handleCorrectionDecision(post(body,"https://other.invalid"),deps)).status,403);
  assert.equal((await handleCorrectionDecision(new Request(get().url.replace("www.","merchant.")),deps)).status,403);
  assert.equal(auth,false);
});
test("only ordinary authenticated sessions proceed, actor and paused gate come from server",async()=>{
  for(const methods of [[],["invite"],["magiclink"],["recovery"],["password","recovery"]]){
    const {deps,calls}=setup({authenticate:async()=>({user:{id:ownerId} as User,accessToken:"synthetic",authenticationMethods:methods})});
    assert.equal((await handleCorrectionDecision(post(),deps)).status,403);assert.equal(calls.length,0);
  }
  for(const methods of [["password"],["oauth"]]){
    const {deps,calls}=setup({authenticate:async()=>({user:{id:ownerId} as User,accessToken:"synthetic",authenticationMethods:methods})});
    const r=await handleCorrectionDecision(post(),deps);assert.equal(r.status,200);
    assert.deepEqual(calls,[{query,command,authUserId:ownerId,allowWrite:false}]);assert.equal((await r.json()).moduleEnabled,false);
  }
});
test("GET receipt performs no command, repeats entitlement and is never cached",async()=>{
  const {deps,calls}=setup(),r=await handleCorrectionDecision(new Request(`${get().url}&operationId=${command.operationId}`),deps);
  assert.equal(r.status,200);assert.equal(calls[0].command,null);assert.equal(calls[0].query.operationId,command.operationId);
  assert.equal(r.headers.get("cache-control"),"private, no-store");assert.match(r.headers.get("vary")!,/Cookie.*Authorization/);
  assert.equal(r.headers.get("x-content-type-options"),"nosniff");
  deps.entitlement=async()=>{throw new MerchantEnterpriseAccessError("enterprise_management_disabled",403);};
  assert.equal((await handleCorrectionDecision(get(),deps)).status,403);assert.equal(calls.length,1);
});
test("actor/permission/effect injection, mixed query and oversized or non-JSON body never execute",async()=>{
  const {deps,calls}=setup();for(const patch of [{authUserId:ownerId},{allowWrite:true},{canApprove:true},{effective:{}},{action:["approve"]}])
    assert.equal((await handleCorrectionDecision(post({...body,...patch}),deps)).status,400);
  assert.equal((await handleCorrectionDecision(new Request(get().url,{method:"POST",headers:{origin:"https://www.faolla.com","content-type":"application/json"},body:JSON.stringify(body)}),deps)).status,400);
  assert.equal((await handleCorrectionDecision(new Request(url,{method:"POST",headers:{origin:"https://www.faolla.com","content-type":"text/plain"},body:"{}"}),deps)).status,415);
  assert.equal((await handleCorrectionDecision(post({...body,reason:"x".repeat(5000)}),deps)).status,413);
  assert.equal((await handleCorrectionDecision(new Request(`${get().url}&requestId=${query.requestId}`),deps)).status,400);
  assert.equal(calls.length,0);
});
test("decision/evidence/version conflicts and rate limits are mapped without private SQL details",async()=>{
  for(const code of ["attendance_operation_conflict","attendance_version_conflict","attendance_correction_decided","attendance_correction_evidence_changed","attendance_correction_decision_blocked","attendance_report_version_required"]){
    const {deps}=setup({execute:async()=>{throw new MerchantAttendanceError(code);}}),r=await handleCorrectionDecision(post(),deps);
    assert.equal(r.status,409);assert.equal((await r.json()).error,code);
  }
  const limited=await handleCorrectionDecision(post(),setup({allow:()=>false}).deps);
  assert.equal(limited.status,429);assert.equal(limited.headers.get("retry-after"),"60");
  const unavailable=await handleCorrectionDecision(post(),setup({execute:async()=>{throw Error("private_table_or_secret");}}).deps);
  assert.equal(unavailable.status,503);assert.deepEqual(await unavailable.json(),{ok:false,error:"attendance_unavailable"});
});
test("all four deployment switches must explicitly enable current-source decision API",()=>{
  const keys=["FAOLLA_ATTENDANCE_ADMIN_ENABLED","FAOLLA_ATTENDANCE_CORRECTION_REVIEW_ENABLED","FAOLLA_ATTENDANCE_CORRECTION_DECISIONS_ENABLED","FAOLLA_ATTENDANCE_CURRENT_CORRECTION_DECISIONS_ENABLED"];
  const saved=keys.map(k=>process.env[k]);
  try{for(const k of keys)process.env[k]="1";assert.equal(correctionDecisionDependencies.enabled(),true);
    for(const key of keys){delete process.env[key];assert.equal(correctionDecisionDependencies.enabled(),false);process.env[key]="1";}
  }finally{keys.forEach((k,i)=>{if(saved[i]===undefined)delete process.env[k];else process.env[k]=saved[i];});}
});
