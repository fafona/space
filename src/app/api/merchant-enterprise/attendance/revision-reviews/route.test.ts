import assert from "node:assert/strict";
import test from "node:test";
import type {User} from "@supabase/supabase-js";
import {handleAttendanceRevisionReview as handle,attendanceRevisionReviewDependencies as defaults} from "./route-handler";
import {MerchantAttendanceError} from "@/lib/merchantAttendanceTime";
import {MerchantEnterpriseAccessError} from "@/lib/merchantEnterpriseAuth.server";
import {revisionReviewQuery as q} from "../../../../../../scripts/fixtures/attendance-revision-review-model";
import {revisionApprovalResponse} from "../../../../../../scripts/fixtures/attendance-revision-approval-model";
const owner="00000000-0000-4000-8000-000000000077",url=`https://www.faolla.com/api/merchant-enterprise/attendance/revision-reviews?siteId=${q.siteId}&requestId=${q.requestId}`;
function setup(patch:Partial<typeof defaults>={}){
  const calls:Parameters<typeof defaults.execute>[0][]=[];
  const deps:typeof defaults={enabled:()=>true,allow:()=>true,authenticate:async()=>({user:{id:owner} as User,accessToken:"synthetic",authenticationMethods:["password"]}),
    entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}) as Awaited<ReturnType<typeof defaults.entitlement>>,
    execute:async i=>{calls.push(i);return revisionApprovalResponse().review;},...patch};return {calls,deps};
}
test("revision reviews are GET-only default-off with canonical, origin and fetch-site protection before auth",async()=>{
  let authed=false;const {deps}=setup({enabled:()=>false,authenticate:async()=>{authed=true;throw Error("unreachable");}});
  assert.equal((await handle(new Request(url),deps)).status,404);deps.enabled=()=>true;
  for(const method of ["POST","PUT","DELETE"])assert.equal((await handle(new Request(url,{method}),deps)).status,405);
  for(const request of [new Request(url.replace("www.","merchant.")),new Request(url,{headers:{origin:"https://other.invalid"}}),new Request(url,{headers:{"sec-fetch-site":"cross-site"}})])assert.equal((await handle(request,deps)).status,403);
  assert.equal(authed,false);
});
test("ordinary password or OAuth owner sessions reach DB authorization; invite/recovery sessions cannot",async()=>{
  for(const methods of [[],["invite"],["magiclink"],["recovery"],["password","recovery"],["password"],["oauth"]]){
    const {deps,calls}=setup({authenticate:async()=>({user:{id:owner} as User,accessToken:"synthetic",authenticationMethods:methods})}),r=await handle(new Request(url),deps),valid=methods.length===1&&["password","oauth"].includes(methods[0]);
    assert.equal(r.status,valid?200:403);assert.equal(calls.length,valid?1:0);
    if(valid){assert.deepEqual(calls[0],{query:q,authUserId:owner});assert.equal((await r.json()).moduleEnabled,false);}
  }
});
test("owner review refreshes enterprise eligibility, has no cache and refuses extra identity or decision fields",async()=>{
  const {deps,calls}=setup(),r=await handle(new Request(url),deps);assert.equal(r.status,200);assert.equal(r.headers.get("cache-control"),"private, no-store");assert.match(r.headers.get("vary")!,/Cookie.*Authorization/);
  for(const suffix of ["&authUserId="+owner,"&action=approve","&operationId="+owner,"&requestId="+owner])assert.equal((await handle(new Request(url+suffix),deps)).status,400);
  deps.entitlement=async()=>{throw new MerchantEnterpriseAccessError("enterprise_management_disabled",403);};assert.equal((await handle(new Request(url),deps)).status,403);assert.equal(calls.length,1);
});
test("review errors and rate limits are bounded, unknown database errors expose no private detail",async()=>{
  for(const [code,status] of [["attendance_access_denied",403],["attendance_correction_not_found",404],["attendance_revision_review_too_large",422],["secret SQL",503]] as const){
    const r=await handle(new Request(url),setup({execute:async()=>{throw new MerchantAttendanceError(code);}}).deps);assert.equal(r.status,status);assert.equal((await r.json()).error,status===503?"attendance_unavailable":code);
  }
  const r=await handle(new Request(url),setup({allow:()=>false}).deps);assert.equal(r.status,429);assert.equal(r.headers.get("retry-after"),"60");
});
test("all four current-version review switches require explicit enablement",()=>{
  const keys=["FAOLLA_ATTENDANCE_ADMIN_ENABLED","FAOLLA_ATTENDANCE_CORRECTION_REVIEW_ENABLED","FAOLLA_ATTENDANCE_REVISION_REVIEW_ENABLED","FAOLLA_ATTENDANCE_REVISION_DECISIONS_ENABLED"],saved=keys.map(k=>process.env[k]);
  try{keys.forEach(k=>{process.env[k]="1";});assert.equal(defaults.enabled(),true);for(const k of keys){delete process.env[k];assert.equal(defaults.enabled(),false);process.env[k]="1";}}
  finally{keys.forEach((k,i)=>{if(saved[i]===undefined)delete process.env[k];else process.env[k]=saved[i];});}
});
