import assert from "node:assert/strict";
import test from "node:test";
import {AttendanceRevisionApprovalClient,parseRevisionApprovalPending,revisionApprovalKey} from "./merchantAttendanceRevisionApprovalClient";
import {parseRevisionApprovalHttpQuery,parseRevisionApprovalResponse,revisionApprovalQueryString} from "./merchantAttendanceRevisionApprovalResponse";
import {revisionApprovalModel} from "../../scripts/fixtures/attendance-revision-approval-client-model";
import {revisionApprovalResponse} from "../../scripts/fixtures/attendance-revision-approval-model";
import {correctionId as id} from "../../scripts/fixtures/attendance-correction-model";
const baseline=revisionApprovalResponse(),siteId=baseline.siteId,ownerId=id(77),requestId=baseline.requestId,q={siteId,requestId,operationId:null};
function setup(){
  const model=revisionApprovalModel(),store=new Map<string,string>(),storage={getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>{store.set(k,v);},removeItem:(k:string)=>{store.delete(k);}};
  let serial=700;const options={siteId,ownerId,apiFetch:model.apiFetch,storage:()=>storage,randomId:()=>id(serial++)};
  return {model,store,storage,options,client:new AttendanceRevisionApprovalClient(options)};
}
const intent={action:"approve" as const,reason:"合成核对"};
test("revision approval HTTP envelope and unique query reject downgrade, tampering and identity injection",()=>{
  assert.deepEqual(parseRevisionApprovalHttpQuery('https://local.invalid/?'+revisionApprovalQueryString(q)),q);
  for(const extra of ['&requestId='+requestId,'&ownerId='+ownerId,'&allowWrite=true','&operationId='])assert.throws(()=>parseRevisionApprovalHttpQuery('https://local.invalid/?'+revisionApprovalQueryString(q)+extra));
  const v={ok:true,...baseline,moduleEnabled:true};assert.equal(parseRevisionApprovalResponse(v,q).current.revision,2);
  for(const patch of [{ok:false},{moduleEnabled:false},{moduleEnabled:"true"},{protocol:"revision-decision-v1"},{extra:1},{current:{...baseline.current,workedUs:0}},{canReject:false},{review:{...baseline.review,sourceVersion:"revision-review-v1"}}])assert.throws(()=>parseRevisionApprovalResponse({...v,...patch},q));
});
test("initialization only reads and approval stores full predecessor intent before a single double-click POST",async()=>{
  const s=setup();await s.client.initialize(requestId);assert.equal(s.client.getSnapshot().phase,"ready");assert.equal(s.model.writes(),0);
  let stored=false;s.options.apiFetch=async(path,init)=>{if(init?.method==="POST"){stored=true;const p=parseRevisionApprovalPending(s.store.get(s.client.storageKey)!,siteId,ownerId);assert.equal(p.command.expectedBaseOperationId,baseline.current.operationId);assert.equal(p.command.expectedRevision,2);assert.equal(p.command.expectedEvidence,baseline.evidenceToken);}return s.model.apiFetch(path,init);};
  await Promise.all([s.client.submit(intent),s.client.submit(intent)]);assert(stored);assert.equal(s.model.writes(),1);assert.equal(s.client.getSnapshot().result!.current.revision,3);assert.equal(s.store.size,0);s.client.pause();
});
test("lost committed reply recovers original approval and later current revision with GET only",async()=>{
  const s=setup();await s.client.initialize(requestId);s.model.mode("lost");await s.client.submit(intent);assert.equal(s.client.getSnapshot().phase,"unconfirmed");s.client.pause();s.model.mode("advanced");
  const reopened=new AttendanceRevisionApprovalClient(s.options);await reopened.initialize(id(888));const state=reopened.getSnapshot();
  assert.equal(state.phase,"ready",state.message);assert.equal(state.requestId,requestId);assert.equal(state.result!.decision!.operationId,s.model.committed()!.operationId);assert.equal(state.result!.review.base.revision,2);assert.equal(state.result!.current.revision,4);
  assert.equal(state.result!.replayed,true);assert.equal(state.result!.effectiveChanged,false);assert.equal(state.pending,null);assert.equal(s.model.calls.filter(c=>c.method==="POST").length,1);reopened.pause();
});
test("paused mode recovers receipts but never resends missing or new approvals",async()=>{
  for(const mode of ["lost","unsent"]){const s=setup();await s.client.initialize(requestId);s.model.mode(mode);await s.client.submit(intent);s.model.mode("paused");await s.client.initialize();await s.client.retry();
    const state=s.client.getSnapshot();assert.equal(state.result!.moduleEnabled,false);assert.equal(!!state.pending,mode==="unsent");await s.client.submit(intent);assert.equal(s.model.calls.filter(c=>c.method==="POST").length,1);s.client.pause();}
});
test("explicit retry checks receipt first then sends byte-identical original intent only once",async()=>{
  const s=setup();await s.client.initialize(requestId);s.model.mode("unsent");await s.client.submit(intent);s.model.mode("normal");await s.client.initialize(id(999));assert.equal(s.model.calls.filter(c=>c.method==="POST").length,1);
  await s.client.retry();const posts=s.model.calls.filter(c=>c.method==="POST");assert.equal(posts.length,2);assert.equal(posts[0].body,posts[1].body);assert.equal(s.model.writes(),1);assert.equal(s.store.size,0);s.client.pause();
});
test("owner denial, not-found or offline hides result, preserves original operation and cannot auto retry",async()=>{
  for(const mode of ["denied","not_found","offline"]){const s=setup();await s.client.initialize(requestId);s.model.mode("lost");await s.client.submit(intent);const saved=s.store.get(s.client.storageKey);s.model.mode(mode);await s.client.initialize();await s.client.retry();
    assert.equal(s.client.getSnapshot().result,null);assert.equal(s.store.get(s.client.storageKey),saved);assert.equal(s.model.calls.filter(c=>c.method==="POST").length,1);s.client.pause();}
});
test("approval blocker still allows explicit rejection without changing hours",async()=>{
  const s=setup();s.model.mode("blocked");await s.client.initialize(requestId);assert.equal(s.client.getSnapshot().result!.canApprove,false);assert.equal(s.client.getSnapshot().result!.canReject,true);
  await s.client.submit(intent);assert.equal(s.model.writes(),0);await s.client.submit({action:"reject",reason:"重叠需更正"});assert.equal(s.client.getSnapshot().phase,"ready");assert.equal(s.client.getSnapshot().result!.current.operationId,baseline.current.operationId);assert.equal(s.model.writes(),1);s.client.pause();
});
test("withdrawal or another immutable decision fences uncertain intent without labeling our command successful",async()=>{
  for(const withdrawn of [true,false]){const s=setup();await s.client.initialize(requestId);s.model.mode("unsent");await s.client.submit(intent);s.model.mode(withdrawn?"withdrawn":"normal");if(!withdrawn)s.model.otherDecision();await s.client.initialize();
    assert.equal(s.client.getSnapshot().phase,"ready",s.client.getSnapshot().message);assert.equal(s.store.size,0);assert.match(s.client.getSnapshot().message,/未确认本次审批成功/);assert.equal(s.model.calls.filter(c=>c.method==="POST").length,1);s.client.pause();}
});
test("changed evidence fails the first submission definitively without making a replacement command",async()=>{
  const s=setup();await s.client.initialize(requestId);s.model.mode("changed");await s.client.submit(intent);assert.equal(s.client.getSnapshot().phase,"blocked");assert.equal(s.store.size,0);assert.equal(s.model.writes(),0);await s.client.retry();assert.equal(s.model.calls.filter(c=>c.method==="POST").length,1);s.client.pause();
});
test("malformed success or a receipt for altered intent never clears uncertain state",async()=>{
  for(const mutate of [(v:Record<string,unknown>)=>{v.receipt=null;},(v:Record<string,unknown>)=>{v.protocol="revision-decision-v1";},(v:Record<string,unknown>)=>{const r=v as unknown as typeof baseline;r.decision!.reason=r.decision!.command.reason="其他理由";r.receipt=structuredClone(r.decision);}]){
    const s=setup();await s.client.initialize(requestId);s.options.apiFetch=async(path,init)=>{const r=await s.model.apiFetch(path,init),v=await r.json();mutate(v);return Response.json(v);};await s.client.submit(intent);
    assert.equal(s.client.getSnapshot().phase,"unconfirmed");assert.equal(s.client.getSnapshot().result,null);assert.equal(s.store.size,1);s.client.pause();}
});
test("hidden page discards a late response but can recover the committed operation on return",{timeout:5000},async()=>{
  const s=setup();await s.client.initialize(requestId);let release!:()=>void,entered!:()=>void;const hold=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
  s.options.apiFetch=async(path,init)=>{const r=await s.model.apiFetch(path,init);if(init?.method==="POST"){entered();await hold;}return r;};const pending=s.client.submit(intent);await started;s.client.pause();release();await pending;
  assert.equal(s.client.getSnapshot().result,null);assert.equal(s.store.size,1);s.options.apiFetch=s.model.apiFetch;await s.client.initialize();assert.equal(s.store.size,0);assert.equal(s.model.writes(),1);s.client.pause();
});
test("malformed, changed, non-durable or unavailable pending storage never causes a write",async()=>{
  for(const raw of ['{','[]',JSON.stringify({ownerId:id(88),siteId,command:{}})]){const s=setup();s.store.set(s.client.storageKey,raw);await s.client.initialize(requestId);assert.equal(s.client.getSnapshot().phase,"blocked");assert.equal(s.model.calls.length,0);assert.equal(s.store.get(s.client.storageKey),raw);s.client.pause();}
  for(const bad of ["overwrite","discard","throw"]){const s=setup();await s.client.initialize(requestId);if(bad==="overwrite")s.store.set(s.client.storageKey,"changed");else if(bad==="discard")s.storage.setItem=()=>{};else s.storage.setItem=()=>{throw Error("quota");};await s.client.submit(intent);assert.equal(s.model.writes(),0);s.client.pause();}
});
test("storage removal failure after commit is uncertain; pending schema rejects actor and field injection",async()=>{
  const s=setup();await s.client.initialize(requestId);s.storage.removeItem=()=>{};await s.client.submit(intent);const p=s.client.getSnapshot().pending!;assert.equal(s.client.getSnapshot().phase,"unconfirmed");assert.equal(s.client.getSnapshot().result,null);
  assert.deepEqual(parseRevisionApprovalPending(JSON.stringify(p),siteId,ownerId),p);
  for(const patch of [{ownerId:id(88)},{siteId:"99990002"},{extra:1},{command:{...p.command,allowWrite:true}},{command:{...p.command,expectedBaseOperationId:null}}])assert.throws(()=>parseRevisionApprovalPending(JSON.stringify({...p,...patch}),siteId,ownerId));
  assert.notEqual(revisionApprovalKey(siteId,ownerId),revisionApprovalKey(siteId,id(88)));assert.throws(()=>parseRevisionApprovalPending(' '.repeat(8193),siteId,ownerId));s.client.pause();
});
