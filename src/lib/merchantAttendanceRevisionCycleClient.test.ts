import assert from "node:assert/strict";
import test from "node:test";
import {AttendanceRevisionCycleClient,parseRevisionCyclePending,revisionCycleKey} from "./merchantAttendanceRevisionCycleClient";
import {parseRevisionCycleInput,parseRevisionCycleResponse} from "./merchantAttendanceRevisionCycleResponse";
import {revisionCycleModel} from "../../scripts/fixtures/attendance-revision-cycle-client-model";
import {wire,advance} from "../../scripts/fixtures/attendance-revision-cycle-model";
import {revisionQuery as q,revisionCommand as legacy} from "../../scripts/fixtures/attendance-revision-model";
import {correctionId as id} from "../../scripts/fixtures/attendance-correction-model";
import type {AttendanceApiFetch} from "./merchantAttendanceSelfClient";
const employeeId=wire().employeeId,target={workerId:q.expectedWorkerId,baseRequestId:q.baseRequestId},proposal=legacy.proposal;
function setup(){
  const model=revisionCycleModel(),store=new Map<string,string>();let generated=300;
  const storage={getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>{store.set(k,v);},removeItem:(k:string)=>{store.delete(k);}};
  const options={siteId:q.siteId,employeeId,apiFetch:model.fetch,storage:()=>storage,randomId:()=>id(generated++)};
  return {model,store,storage,options,client:new AttendanceRevisionCycleClient(options)};
}
test("cycle HTTP envelope is exact, validates sources and rejects legacy write shape or tenant overrides",()=>{
  const v=wire(),body={ok:true,...v,moduleEnabled:true};assert.equal(parseRevisionCycleResponse(body,q).current.revision,2);
  for(const patch of [{ok:false},{moduleEnabled:"true"},{moduleEnabled:false},{secret:"hidden"},{protocol:"revision-self-v1"},{current:{...v.current,workedUs:1}}])assert.throws(()=>parseRevisionCycleResponse({...body,...patch},q));
  const command={...legacy,expectedEffectiveOperationId:v.current.operationId},input={siteId:q.siteId,expectedWorkerId:q.expectedWorkerId,baseRequestId:q.baseRequestId,command};
  assert.deepEqual(parseRevisionCycleInput(input).command,command);
  for(const patch of [{command:legacy},{authUserId:id(99)},{moduleEnabled:true},{command:{...command,siteId:q.siteId}}])assert.throws(()=>parseRevisionCycleInput({...input,...patch}));
  v.canSubmit=false;assert.equal(parseRevisionCycleResponse({ok:true,...v,moduleEnabled:false},q).canSubmit,false);
});
test("entry rechecks membership, starts from latest revision and stores the exact intent before POST",async()=>{
  const {client,model,store,options}=setup();await client.initialize(target);
  assert.equal(client.getSnapshot().phase,"ready");assert.equal(client.getSnapshot().result!.current.revision,2);assert.equal(model.postCount(),0);
  const seen:unknown[]=[];options.apiFetch=async(path,init)=>{if(init?.method==="POST")seen.push(parseRevisionCyclePending(store.get(client.storageKey)!,q.siteId,employeeId));return model.fetch(path,init);};
  await Promise.all([client.submit(proposal,"重新核对"),client.submit(proposal,"双击")]);
  assert.equal(model.postCount(),1);assert.equal(seen.length,1);assert.equal(store.size,0);
  const state=client.getSnapshot();assert.equal(state.result!.item!.status,"submitted");assert.equal(state.result!.current.revision,2);
  assert.equal((model.calls.find(c=>c.method==="POST")!.body as {command:{expectedEffectiveOperationId:string}}).command.expectedEffectiveOperationId,wire().current.operationId);
  client.pause();
});
test("lost submit response recovers by GET after approval, without reissuing or relabeling the original result",async()=>{
  const {client,model,options,store}=setup();await client.initialize(target);model.setMode("lost");await client.submit(proposal,"核对");
  assert.equal(client.getSnapshot().phase,"unconfirmed");assert.equal(store.size,1);model.terminal("approved");client.pause();model.setMode("normal");
  const reopened=new AttendanceRevisionCycleClient(options);await reopened.initialize(null);const r=reopened.getSnapshot();
  assert.equal(r.phase,"ready");assert.equal(r.pending,null);assert.equal(r.result!.item!.status,"approved");assert.equal(r.result!.item!.basedOn.revision,2);assert.equal(r.result!.current.revision,3);
  assert.equal(model.postCount(),1);assert.equal(store.size,0);reopened.pause();
});
test("explicit retry checks a missing receipt first, reuses byte-identical command and never creates a new ID",async()=>{
  const {client,model}=setup();await client.initialize(target);model.setMode("missing");await client.submit(proposal,"核对");const pending=client.getSnapshot().pending!;
  await client.initialize({workerId:q.expectedWorkerId,baseRequestId:id(999)});assert.equal(client.getSnapshot().query!.baseRequestId,q.baseRequestId);assert.equal(model.postCount(),1);
  model.setMode("normal");await client.retry();const posts=model.calls.filter(c=>c.method==="POST");assert.equal(posts.length,2);assert.deepEqual(posts[0].body,posts[1].body);
  assert.equal(client.getSnapshot().result!.receipt!.operationId,pending.command.operationId);assert.equal(client.getSnapshot().pending,null);client.pause();
});
test("paused collection still permits explicit withdrawal and exact receipt recovery, not a new submission",async()=>{
  const {client,model}=setup();await client.initialize(target);await client.submit(proposal,"核对");model.setMode("paused");await client.initialize();
  assert.equal(client.getSnapshot().result!.moduleEnabled,false);assert.equal(client.getSnapshot().result!.canWithdraw,true);
  await client.withdraw("不再提交此声明");assert.equal(client.getSnapshot().result!.item!.status,"withdrawn");assert.equal(client.getSnapshot().result!.current.revision,2);
  await client.prepare();await client.submit(proposal,"暂停不应提交");assert.equal(model.postCount(),2);client.pause();
});
test("rejection permits a new explicit request from unchanged current source, approval never permits withdrawal",async()=>{
  const {client,model}=setup();await client.initialize(target);await client.submit(proposal,"核对");model.terminal("rejected");await client.initialize();
  assert.equal(client.getSnapshot().result!.item!.status,"rejected");await client.withdraw("无效撤回");assert.equal(model.postCount(),1);
  await client.prepare();await client.submit(proposal,"再次说明");assert.equal(model.postCount(),2);assert.equal(client.getSnapshot().result!.item!.submittedRevision,3);
  model.terminal("approved");await client.initialize();await client.withdraw("不能撤回批准");assert.equal(model.postCount(),2);client.pause();
});
test("denied, changed member or rebound worker hide all results and retain the pending command",async()=>{
  for(const mode of ["denied","wrong_employee","rebound"]){const {client,model,store}=setup();await client.initialize(target);model.setMode("lost");await client.submit(proposal,"核对");const original=store.get(client.storageKey);
    model.setMode(mode);await client.initialize();assert.equal(client.getSnapshot().phase,"blocked");assert.equal(client.getSnapshot().result,null);assert.equal(client.getSnapshot().workerId,null);
    assert.equal(store.get(client.storageKey),original);await client.retry();assert.equal(model.postCount(),1);client.pause();}
});
test("corrupt success payload after a committed POST cannot clear uncertain state",async()=>{
  const {client,model,store}=setup();await client.initialize(target);model.setMode("corrupt");await client.submit(proposal,"核对");assert.equal(client.getSnapshot().phase,"unconfirmed");assert.equal(client.getSnapshot().result,null);assert.equal(store.size,1);
  model.setMode("normal");await client.initialize();assert.equal(client.getSnapshot().phase,"ready");assert.equal(store.size,0);assert.equal(model.postCount(),1);client.pause();
});
test("hidden or replaced requests cannot reveal a late response or clear its uncertain command",{timeout:5000},async()=>{
  const {client,model,options,store}=setup();await client.initialize(target);assert.equal(client.getSnapshot().phase,"ready");
  let release!:()=>void,started!:()=>void;const held=new Promise<void>(r=>release=r),entered=new Promise<void>(r=>started=r);
  options.apiFetch=async(path,init)=>{const result=await model.fetch(path,init);if(init?.method==="POST"){started();await held;}return result;};
  const submitting=client.submit(proposal,"核对");await entered;client.pause();release();await submitting;
  assert.equal(client.getSnapshot().result,null);assert.equal(store.size,1);options.apiFetch=model.fetch;await client.initialize();assert.equal(store.size,0);assert.equal(model.postCount(),1);client.pause();
});
test("malformed, overwritten or non-durable intent storage never causes a write",async()=>{
  for(const broken of ["{","[]",JSON.stringify({employeeId:id(77),query:q,command:legacy})]){const {client,model,store}=setup();store.set(client.storageKey,broken);await client.initialize(target);assert.equal(client.getSnapshot().phase,"blocked");assert.equal(model.calls.length,0);assert.equal(store.get(client.storageKey),broken);client.pause();}
  const {client,model,store}=setup();await client.initialize(target);store.set(client.storageKey,"another-tab-change");await client.submit(proposal,"核对");assert.equal(model.postCount(),0);client.pause();
  const s=setup();s.storage.setItem=()=>{};await s.client.initialize(target);await s.client.submit(proposal,"核对");assert.equal(s.model.postCount(),0);s.client.pause();
});
test("storage clearing failure after success preserves pending recovery instead of presenting a confirmed result",async()=>{
  const s=setup();await s.client.initialize(target);s.storage.removeItem=()=>{throw Error("unavailable_storage");};await s.client.submit(proposal,"核对");assert.equal(s.client.getSnapshot().phase,"unconfirmed");assert.equal(s.client.getSnapshot().result,null);assert.equal(s.store.size,1);s.client.pause();
});
test("pending command schema enforces root, worker, membership, operation and full predecessor",async()=>{
  const s=setup();await s.client.initialize(target);s.model.setMode("lost");await s.client.submit(proposal,"核对");const p=s.client.getSnapshot().pending!;
  assert.deepEqual(parseRevisionCyclePending(JSON.stringify(p),q.siteId,employeeId),p);
  for(const patch of [{employeeId:id(999)},{extra:true},{query:{...p.query,siteId:"99990002"}},{query:{...p.query,requestId:id(999)}},{query:{...p.query,operationId:id(999)}},{command:legacy}])assert.throws(()=>parseRevisionCyclePending(JSON.stringify({...p,...patch}),q.siteId,employeeId));
  assert.throws(()=>parseRevisionCyclePending(" ".repeat(16385),q.siteId,employeeId));assert.notEqual(revisionCycleKey(q.siteId,employeeId),revisionCycleKey(q.siteId,id(999)));s.client.pause();
});
test("late historical application keeps its based-on and own outcome distinct from a newer source",async()=>{
  const {client,model}=setup(),v=wire("approved");advance(v);model.setValue(v);await client.initialize(target);await client.detail(v.item!.requestId);
  const r=client.getSnapshot().result!;assert.equal(r.item!.basedOn.revision,2);assert.equal(r.item!.decisionEffect!.revision,3);assert.equal(r.current.revision,4);assert.equal(model.postCount(),0);client.pause();
});
test("successful JSON must match the employee and complete original receipt command",async()=>{
  for(const mutate of [(v:Record<string,unknown>)=>{v.employeeId=id(987);},(v:Record<string,unknown>)=>{v.receipt=null;}]){
    const s=setup();await s.client.initialize(target);const fetch:AttendanceApiFetch=async(path,init)=>{const r=await s.model.fetch(path,init);const value=await r.json();mutate(value);return new Response(JSON.stringify(value),{headers:{"content-type":"application/json"}});};
    s.options.apiFetch=fetch;await s.client.submit(proposal,"核对");assert.equal(s.client.getSnapshot().phase,"unconfirmed");assert.equal(s.store.size,1);assert.equal(s.client.getSnapshot().result,null);s.client.pause();
  }
});
test("history selection rechecks identity then reads selected detail directly without an intermediate preparation request",async()=>{
  const s=setup(),v=wire("submitted");s.model.setValue(v);await s.client.initialize(target,v.item!.requestId);
  assert.equal(s.client.getSnapshot().phase,"ready");assert.equal(s.client.getSnapshot().result!.mode,"detail");assert.equal(s.client.getSnapshot().result!.item!.requestId,v.item!.requestId);
  assert.equal(s.model.calls.length,2);assert(s.model.calls[0].path.includes('/context?'));assert(s.model.calls[1].path.includes('mode=detail'));assert.equal(s.model.postCount(),0);s.client.pause();
});
test("history selection cannot replace a previously uncertain original request",async()=>{
  const s=setup();await s.client.initialize(target);s.model.setMode('lost');await s.client.submit(proposal,'合成核对');const original=s.client.getSnapshot().pending!;s.model.setMode('normal');
  await s.client.initialize({workerId:target.workerId,baseRequestId:id(999)},id(998));assert.equal(s.client.getSnapshot().phase,'ready');assert.equal(s.client.getSnapshot().result!.rootRequestId,target.baseRequestId);
  assert.equal(s.client.getSnapshot().result!.item!.requestId,original.query.requestId);assert.equal(s.model.postCount(),1);s.client.pause();
});
