import assert from "node:assert/strict";
import test from "node:test";
import { executePeriodClosuresV2,periodClosuresV2SiteEnabled,projectPeriodClosureV2Result } from "./merchantAttendancePeriodClosureV2.server";
import { projectPeriodClosureSource } from "./merchantAttendancePeriodClosure.server";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { periodClosureUiCommand as command,periodClosureUiOwner as owner,periodClosureUiQuery } from "../../scripts/fixtures/attendance-period-closure-ui-model";
import { periodClosureV2FixtureQuery as query,periodClosureV2FixtureRaw as raw,periodClosureV2FixtureSource as source,
  v2FixtureSha as sha } from "../../scripts/fixtures/attendance-period-closure-v2-model";

function stub(fn:(name:string,args:Record<string,unknown>,n:number)=>{data:unknown;error:{message:string}|null}) {
  const calls:{name:string;args:Record<string,unknown>}[]=[];
  const service:AttendanceSelfRpc={rpc:async(name,args)=>{calls.push({name,args});return fn(name,args,calls.length);}};
  return {service,calls};
}
test("v2 writes need exact new flag as well as existing bounded site rollout",()=>{
  const site=query().siteId,base={FAOLLA_ATTENDANCE_PERIOD_CLOSURES_ENABLED:"1",FAOLLA_ATTENDANCE_PERIOD_CLOSURES_SITE_IDS:site};
  for(const env of [{},base,{...base,FAOLLA_ATTENDANCE_PERIOD_CONTINUATION_ENABLED:"true"},
    {FAOLLA_ATTENDANCE_PERIOD_CONTINUATION_ENABLED:"1"},{...base,FAOLLA_ATTENDANCE_PERIOD_CONTINUATION_ENABLED:"1",FAOLLA_ATTENDANCE_PERIOD_CLOSURES_SITE_IDS:"*"}])
    assert.equal(periodClosuresV2SiteEnabled(site,env),false);
  assert.equal(periodClosuresV2SiteEnabled(site,{...base,FAOLLA_ATTENDANCE_PERIOD_CONTINUATION_ENABLED:"1"}),true);
});
test("saved v2 details carry a single checked original body, not a fake full history",async()=>{
  const q=query(),r=raw(q);assert.equal(r.kind,"detail");
  if(r.kind!=="detail")throw Error("fixture");r.period.revision=101;r.period.currentVersion=21;r.artifactVersion=21;
  const f=stub(()=>({data:r,error:null})),result=await executePeriodClosuresV2({query:q,authUserId:owner},f.service);
  assert.equal(result.kind,"detail");assert(!Object.hasOwn(result,"history"));assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].name,"faolla_attendance_period_closure_v2");assert.equal(f.calls[0].args.p_allow_write,false);
  for(const patch of [{artifactBytes:r.artifactBytes+1},{artifactSha256:"0".repeat(64)},{artifactText:r.artifactText+" "},
    {history:[]},{artifact:null,artifactVersion:null}])assert.throws(()=>projectPeriodClosureV2Result({...r,...patch},q,owner,null));
});
test("old exact send receipt is recovered before source collection even with new writes paused",async()=>{
  const q=query(),c=command(),recovery={...q,mode:"recover" as const,operationId:c.operationId},saved=raw(recovery);
  const f=stub(()=>({data:saved,error:null})),result=await executePeriodClosuresV2({query:q,command:c,authUserId:owner,moduleEnabled:false},f.service);
  assert.equal(result.kind,"detail");if(result.kind==="detail")assert.equal(result.replayed,true);
  assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].args.p_query,recovery);assert.equal(f.calls[0].args.p_command,null);
});
test("permission, upgrade, malformed receipt and command mismatch never fall through into a fresh write",async()=>{
  const q=query(),c=command();
  for(const code of ["attendance_access_denied","attendance_period_protocol_required","attendance_period_storage_limit"]){
    const f=stub(()=>({data:null,error:{message:code}}));await assert.rejects(executePeriodClosuresV2({query:q,command:c,authUserId:owner},f.service),new RegExp(code));assert.equal(f.calls.length,1);
  }
  const recovery={...q,mode:"recover" as const,operationId:c.operationId},saved=raw(recovery,{...c,reason:"different exact command"});
  const f=stub(()=>({data:saved,error:null}));await assert.rejects(executePeriodClosuresV2({query:q,command:c,authUserId:owner},f.service),/attendance_operation_conflict/);assert.equal(f.calls.length,1);
});
test("unseen send uses fixed source scope then submits same original command once",async()=>{
  const q=query(),s=source(),c={...command(),expectedFingerprint:s.sourceFingerprint};
  const f=stub((name,args,n)=>{
    assert.equal(args.p_auth_user_id,owner);
    if(n===1)return {data:null,error:{message:"attendance_operation_not_found"}};
    if(n===2){assert.equal(name,"faolla_attendance_period_closure_source_v1");assert(!Object.hasOwn(args.p_query as object,"cursor"));return {data:s,error:null};}
    assert.equal(n,3);assert.deepEqual(args.p_command,c);const r=raw(q,c);if(r.kind!=="detail")throw Error("fixture");
    r.artifact=projectPeriodClosureSource(s,periodClosureUiQuery()).artifact;r.artifactText=JSON.stringify(r.artifact);
    r.artifactBytes=Buffer.byteLength(r.artifactText);r.artifactSha256=sha(r.artifactText);return {data:r,error:null};
  });
  const r=await executePeriodClosuresV2({query:q,command:c,authUserId:owner,moduleEnabled:true},f.service);
  assert.equal(r.kind,"detail");assert.equal(f.calls.length,3);assert.equal(f.calls[2].args.p_allow_write,true);
});
test("saved export is one RPC and never rescans current sources or quota",async()=>{
  const q=query("export"),f=stub(name=>{assert.equal(name,"faolla_attendance_period_closure_v2");return {data:raw(q),error:null};});
  await executePeriodClosuresV2({query:q,authUserId:owner,moduleEnabled:false},f.service);assert.equal(f.calls.length,1);
});
test("a stale fresh source or unknown rpc error cannot silently fall back to v1",async()=>{
  const q=query(),c=command(),f=stub((_name,_args,n)=>n===1?{data:null,error:{message:"attendance_operation_not_found"}}:{data:source(),error:null});
  await assert.rejects(executePeriodClosuresV2({query:q,command:c,authUserId:owner},f.service),/attendance_period_source_changed/);assert.equal(f.calls.length,2);
  const missing=stub(()=>({data:null,error:{message:"function absent"}}));
  await assert.rejects(executePeriodClosuresV2({query:q,authUserId:owner},missing.service),/attendance_unavailable/);assert.equal(missing.calls.length,1);
});
