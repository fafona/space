import assert from "node:assert/strict";
import test from "node:test";
import {executeRevisionDecision as decide,executeRevisionApprovalReview as review} from "./merchantAttendanceRevisionDecision.server";
import {executeRevisionCycle as self} from "./merchantAttendanceRevisionCycle.server";
import {revisionApprovalResponse as wire,recoverRevisionApproval as recover,revisionCycleServiceFixture as fixture} from "../../scripts/fixtures/attendance-revision-approval-model";
import {correctionId as id} from "../../scripts/fixtures/attendance-correction-model";
const response=(data:unknown)=>({rpc:async()=>({data,error:null})});
function input(){const w=wire("approve");return {query:{siteId:w.siteId,requestId:w.requestId,operationId:null as string|null},command:w.decision!.command,authUserId:id(77),allowWrite:true};}
test("new owner executors call only explicit v2/v3 RPCs with server identity and write gate",async()=>{
  const w=wire("approve"),i=input();let calls=0;
  const r=await decide(i,{rpc:async(name,args)=>{calls++;assert.equal(name,"faolla_attendance_revision_decide_v2");assert.deepEqual(args,{p_site_id:i.query.siteId,p_auth_user_id:i.authUserId,p_request_id:i.query.requestId,p_command:i.command,p_operation_id:null,p_allow_write:true});return {data:w,error:null};}});
  assert.equal(r.receipt!.operationId,i.command.operationId);assert.equal(calls,1);
  const q={siteId:w.siteId,requestId:w.requestId};await review({query:q,authUserId:i.authUserId},{rpc:async(name,args)=>{assert.equal(name,"faolla_attendance_revision_owner_review_v3");assert.deepEqual(args,{p_site_id:q.siteId,p_auth_user_id:i.authUserId,p_request_id:q.requestId});return {data:w.review,error:null};}});
});
test("missing or mismatched receipts never report success; read requests never accept fresh write claims",async()=>{
  const i=input(),r=recover(wire("approve"));
  await assert.rejects(decide(i,response({...wire("approve"),receipt:null,effectiveChanged:false})),/attendance_unavailable/);
  await assert.rejects(decide({...i,command:{...i.command,reason:"different"}},response(wire("approve"))),/attendance_unavailable/);
  await assert.rejects(decide({...i,command:null,query:{...i.query,operationId:i.command.operationId}},response(wire("approve"))),/attendance_unavailable/);
  const found=await decide({...i,allowWrite:false,command:null,query:{...i.query,operationId:i.command.operationId}},response(r));assert.equal(found.replayed,true);
  const replay=await decide({...i,allowWrite:false},response(r));assert.equal(replay.effectiveChanged,false);
  await assert.rejects(decide({...i,allowWrite:true},response(r)),/attendance_unavailable/);
  const missing={...r,receipt:null,replayed:false};assert.equal((await decide({...i,allowWrite:false,command:null,query:{...i.query,operationId:id(999)}},response(missing))).receipt,null);
});
test("owner input rejects cross-request operations, hidden tenant/principal and non-boolean write flags before RPC",async()=>{
  const i=input();let calls=0;const service={rpc:async()=>{calls++;throw Error("must not call");}};
  for(const bad of [{...i,query:{...i.query,operationId:id(1)}},{...i,query:{...i.query,requestId:id(99)}},{...i,command:{...i.command,siteId:"99990002"}},
    {...i,command:{...i.command,authUserId:id(99)}},{...i,authUserId:"bad"},{...i,allowWrite:"true"}])await assert.rejects(decide(bad as typeof i,service),/attendance_invalid_request/);
  await assert.rejects(review({query:{...i.query} as {siteId:string;requestId:string},authUserId:i.authUserId},service),/attendance_invalid_request/);assert.equal(calls,0);
});
test("candidate service masks internal and transport errors and never retries a possibly committed decision",async()=>{
  const i=input();let calls=0;await assert.rejects(decide(i,{rpc:async()=>{calls++;throw Error("private connection details; committed response lost");}}),/attendance_unavailable/);assert.equal(calls,1);
  for(const message of ["attendance_revision_base_changed","attendance_access_denied","attendance_correction_evidence_changed","private SQL"]){
    await assert.rejects(decide(i,{rpc:async()=>({data:null,error:{message}})}),new RegExp(message==="private SQL"?"attendance_unavailable":message));}
  await assert.rejects(decide(i,null),/attendance_unavailable/);
  await assert.rejects(review({query:{siteId:i.query.siteId,requestId:i.query.requestId},authUserId:i.authUserId},response({...wire().review,checksPassed:false})),/attendance_unavailable/);
});
test("employee v2 executor binds new command, root/worker query and authenticated principal",async()=>{
  const f=fixture();let calls=0;
  const r=await self({...f,authUserId:id(77),moduleEnabled:true},{rpc:async(name,args)=>{calls++;assert.equal(name,"faolla_attendance_revision_self_v2");assert.deepEqual(args,{p_site_id:f.query.siteId,p_auth_user_id:id(77),
    p_query:{mode:"detail",expectedWorkerId:f.query.expectedWorkerId,baseRequestId:f.query.baseRequestId,requestId:f.query.requestId,operationId:null},p_command:f.command,p_platform_enabled:true});return {data:f.data,error:null};}});
  assert.equal(r.receipt!.operationId,f.command.operationId);assert.equal(calls,1);
  await assert.rejects(self({...f,authUserId:id(77),moduleEnabled:true},response({...f.data,receipt:null})),/attendance_unavailable/);
  await assert.rejects(self({...f,command:{...f.command,reason:"different"},authUserId:id(77),moduleEnabled:true},response(f.data)),/attendance_unavailable/);
});
test("employee reads recover existing operation while paused; legacy writes, malformed queries and automatic retries are refused",async()=>{
  const f=fixture(),i={query:f.query,command:f.command,authUserId:id(77),moduleEnabled:false};
  assert.equal((await self({...i,command:null,query:{...i.query,operationId:f.command.operationId}},response(f.data))).receipt!.operationId,f.command.operationId);
  assert.equal((await self({...i,command:null,query:{...i.query,operationId:id(999)}},response({...f.data,receipt:null}))).receipt,null);
  const old:Record<string,unknown>={...f.command};delete old.expectedEffectiveOperationId;let calls=0;const service={rpc:async()=>{calls++;throw Error("private transport error");}};
  for(const patch of [{command:old},{query:{...i.query,operationId:id(999)}},{moduleEnabled:1},{query:{...i.query,authUserId:id(99)}}])await assert.rejects(self({...i,...patch} as typeof i,service),/attendance_invalid_request/);
  assert.equal(calls,0);await assert.rejects(self(i,service),/attendance_unavailable/);assert.equal(calls,1);
});
