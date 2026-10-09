import assert from "node:assert/strict";
import test from "node:test";
import {AttendanceCorrectionDecisionClient,correctionDecisionKey,parseCorrectionDecisionPending} from "./merchantAttendanceCorrectionDecisionClient";
import {createDecisionClientFixture} from "../../scripts/fixtures/attendance-correction-decision-client-model";
import {decisionQuery as q,decisionCommand,decisionOwner} from "../../scripts/fixtures/attendance-correction-decision-model";
import {correctionId as id} from "../../scripts/fixtures/attendance-correction-model";
import type {AttendanceApiFetch} from "./merchantAttendanceSelfClient";
const intent={action:"approve" as const,reason:"核对无误"};
function setup(wrap?:(f:AttendanceApiFetch)=>AttendanceApiFetch){
  const model=createDecisionClientFixture(),map=new Map<string,string>();let n=200;
  const storage={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);},removeItem:(k:string)=>{map.delete(k);}};
  const apiFetch=wrap?wrap(model.apiFetch):model.apiFetch;
  const fresh=(timeoutMs=1500,ownerId=decisionOwner)=>new AttendanceCorrectionDecisionClient({siteId:q.siteId,ownerId,apiFetch,storage:()=>storage,randomId:()=>id(n++),timeoutMs});
  return {model,map,storage,fresh,client:fresh(),key:correctionDecisionKey(q.siteId,decisionOwner)};
}
const posts=(s:ReturnType<typeof setup>)=>s.model.calls.filter(c=>c.method==="POST");
test("pending record and key bind one exact owner/company, only immutable command is stored",()=>{
  const p={siteId:q.siteId,ownerId:decisionOwner,command:decisionCommand},raw=JSON.stringify(p);
  assert.deepEqual(parseCorrectionDecisionPending(raw,q.siteId,decisionOwner),p);
  for(const bad of [{...p,siteId:"99990002"},{...p,ownerId:id(99)},{...p,workerNotes:"private"},{...p,command:{...p.command,siteId:q.siteId}},
    {...p,command:{...p.command,expectedEvidence:"bad"}}])assert.throws(()=>parseCorrectionDecisionPending(JSON.stringify(bad),q.siteId,decisionOwner));
  assert.throws(()=>parseCorrectionDecisionPending(" ".repeat(8193),q.siteId,decisionOwner));
  assert.notEqual(correctionDecisionKey(q.siteId,id(2)),correctionDecisionKey(q.siteId,id(3)));
});
test("entry with no target reads storage only; selection performs GET and never auto-approves",async()=>{
  const s=setup();await s.client.initialize(null);assert.equal(s.model.calls.length,0);
  await s.client.initialize(q.requestId);assert.equal(s.model.calls.length,1);assert.equal(posts(s).length,0);assert.equal(s.client.getSnapshot().phase,"ready");
});
test("explicit approval is persisted before POST, returns exact receipt and prevents double click",async()=>{
  let saved=false;const s=setup(base=>async(path,init)=>{if(init?.method==="POST")saved=s.map.has(s.key);return base(path,init);});
  await s.client.initialize(q.requestId);await Promise.all([s.client.submit(intent),s.client.submit({...intent,reason:"重复"})]);
  assert.equal(saved,true);assert.equal(posts(s).length,1);assert.equal(s.model.writes(),1);assert.equal(s.map.size,0);
  assert.equal(s.client.getSnapshot().result?.decision?.action,"approve");assert.equal(s.client.getSnapshot().result?.decisionEffect?.workedUs,30600000000);
});
test("rejection of unapprovable legacy has no effect and terminal outcome cannot be resubmitted",async()=>{
  const s=setup();s.model.mode("legacy");await s.client.initialize(q.requestId);await s.client.submit(intent);assert.equal(posts(s).length,0);
  await s.client.submit({action:"reject",reason:"请按当前政策重新申报"});assert.equal(s.model.writes(),1);
  assert.equal(s.client.getSnapshot().result?.decisionEffect,null);await s.client.submit(intent);assert.equal(posts(s).length,1);
});
test("lost committed response restores original request before requested new target, using GET only",async()=>{
  const s=setup();await s.client.initialize(q.requestId);s.model.mode("lost");await s.client.submit(intent);
  assert.equal(s.client.getSnapshot().phase,"unconfirmed");s.model.mode("normal");const fresh=s.fresh();await fresh.initialize(id(333));
  assert.equal(s.model.calls.at(-1)?.method,"GET");assert.equal(fresh.getSnapshot().requestId,q.requestId);assert.equal(posts(s).length,1);assert.equal(s.map.size,0);
});
test("unsent intent survives reentry; only explicit retry may post exact original body",async()=>{
  const s=setup();await s.client.initialize(q.requestId);s.model.mode("unsent");await s.client.submit(intent);const raw=posts(s)[0].body;
  s.model.mode("normal");const fresh=s.fresh();await fresh.initialize();assert.equal(posts(s).length,1);assert.equal(s.map.size,1);
  await fresh.retry();assert.equal(posts(s).length,2);assert.equal(posts(s)[1].body,raw);assert.equal(s.map.size,0);assert.equal(s.model.writes(),1);
});
test("paused state forbids new decisions but recovers committed receipt",async()=>{
  const s=setup();s.model.mode("paused");await s.client.initialize(q.requestId);await s.client.submit(intent);assert.equal(posts(s).length,0);
  s.model.mode("normal");await s.client.initialize();s.model.mode("lost");await s.client.submit(intent);
  s.model.mode("paused");await s.fresh().initialize();assert.equal(s.map.size,0);assert.equal(s.model.writes(),1);
});
test("paused uncertain unsent intent stays stored and retry does not POST",async()=>{
  const s=setup();await s.client.initialize(q.requestId);s.model.mode("unsent");await s.client.submit(intent);
  s.model.mode("paused");await s.client.retry();assert.equal(posts(s).length,1);assert.equal(s.map.size,1);
});
test("first definitive changed-evidence refusal clears only unsent first attempt",async()=>{
  const s=setup();await s.client.initialize(q.requestId);s.model.mode("changed");await s.client.submit(intent);
  assert.equal(s.map.size,0);assert.equal(s.model.writes(),0);assert.equal(s.client.getSnapshot().phase,"blocked");
});
test("after uncertainty changed hash or temporary blocker is not a permanent fence",async()=>{
  for(const mode of ["changed","blocked","paused"]){const s=setup();await s.client.initialize(q.requestId);s.model.mode("unsent");await s.client.submit(intent);
    const raw=s.map.get(s.key);s.model.mode(mode);await s.client.retry();assert.equal(s.map.get(s.key),raw,mode);assert.equal(s.model.writes(),0);
  }
});
test("another immutable decision or withdrawn revision permanently fences old command without retry",async()=>{
  for(const kind of ["decision","withdrawn"]){const s=setup();await s.client.initialize(q.requestId);s.model.mode("unsent");await s.client.submit(intent);
    s.model.mode(kind==="withdrawn"?"withdrawn":"normal");if(kind==="decision")s.model.otherDecision();
    await s.client.retry();assert.equal(s.map.size,0);assert.equal(posts(s).length,1);assert.match(s.client.getSnapshot().message,/未确认本次审批成功/);
  }
});
test("hidden original receipt or changed command receipt never pretends own success",async()=>{
  const s=setup();await s.client.initialize(q.requestId);s.model.mode("lost");await s.client.submit(intent);
  s.model.mode("receipt_hidden");await s.client.initialize();assert.equal(s.map.size,1);assert.equal(s.client.getSnapshot().phase,"unconfirmed");
});
test("wrong returned receipt body preserves pending and hides result",async()=>{
  const s=setup(base=>async(path,init)=>{const r=await base(path,init);if(init?.method!=="POST")return r;const b=await r.json();b.receipt.reason="不同内容";return Response.json(b);});
  await s.client.initialize(q.requestId);await s.client.submit(intent);assert.equal(s.map.size,1);assert.equal(s.client.getSnapshot().result,null);
});
test("permission loss and not-found during recovery never POST or erase uncertainty",async()=>{
  for(const mode of ["denied","not_found"]){const s=setup();await s.client.initialize(q.requestId);s.model.mode("unsent");await s.client.submit(intent);
    s.model.mode(mode);await s.client.retry();assert.equal(posts(s).length,1);assert.equal(s.map.size,1);assert.equal(s.client.getSnapshot().result,null);}
});
test("other owner never restores previous owner's command",async()=>{
  const s=setup();await s.client.initialize(q.requestId);s.model.mode("unsent");await s.client.submit(intent);
  const count=s.model.calls.length;await s.fresh(1500,id(77)).initialize();assert.equal(s.model.calls.length,count);assert.equal(s.map.size,1);
});
test("corrupted, inaccessible or mismatched storage fails closed before requests",async()=>{
  for(const kind of ["corrupt","denied","foreign"]){const s=setup();
    if(kind==="denied")s.storage.getItem=()=>{throw Error("storage_denied");};
    else s.map.set(s.key,kind==="corrupt"?"{bad":JSON.stringify({siteId:q.siteId,ownerId:id(88),command:decisionCommand}));
    await s.client.initialize(q.requestId);assert.equal(s.model.calls.length,0);assert.equal(s.client.getSnapshot().phase,"blocked");assert.equal(s.client.hasLeaveRisk(),true);
  }
});
test("storage write failure or late slot collision prevents new POST",async()=>{
  for(const kind of ["write","collision"]){const s=setup();await s.client.initialize(q.requestId);
    if(kind==="write")s.storage.setItem=()=>{throw Error("unavailable");};
    else s.map.set(s.key,JSON.stringify({siteId:q.siteId,ownerId:decisionOwner,command:decisionCommand}));
    await s.client.submit(intent);assert.equal(posts(s).length,0);assert.equal(s.client.getSnapshot().result,null);
  }
});
test("failure to remove confirmed pending never presents final success",async()=>{
  const s=setup();await s.client.initialize(q.requestId);s.storage.removeItem=()=>{throw Error("denied");};await s.client.submit(intent);
  assert.equal(s.map.size,1);assert.equal(s.client.getSnapshot().phase,"unconfirmed");assert.equal(s.client.getSnapshot().result,null);
});
test("hiding aborts late result and forbids writes/retry until a fresh read",async()=>{
  let release:(()=>void)|undefined;
  const s=setup(base=>async(path,init)=>{const r=await base(path,init);if(init?.method==="POST")await new Promise<void>(resolve=>{release=resolve;});return r;});
  await s.client.initialize(q.requestId);const write=s.client.submit(intent);await new Promise(resolve=>setTimeout(resolve,0));assert.ok(release);
  s.client.pause();release!();await write;assert.equal(s.client.getSnapshot().result,null);assert.equal(s.map.size,1);
  await s.client.retry();await s.client.submit(intent);assert.equal(posts(s).length,1);await s.fresh().initialize();assert.equal(s.map.size,0);
});
test("timeout covers stalled body and preserves possible commit",async()=>{
  let cancelled=false;const s=setup(base=>async(path,init)=>init?.method==="POST"?new Response(new ReadableStream({cancel(){cancelled=true;}}),
    {headers:{"Content-Type":"application/json"}}):base(path,init));
  const client=s.fresh(50);await client.initialize(q.requestId);await client.submit(intent);assert.equal(client.getSnapshot().phase,"unconfirmed");assert.equal(cancelled,true);assert.equal(s.map.size,1);
});
test("HTML, excessive body and mismatched tenant never confirm writes",async()=>{
  for(const mode of ["html","large","tenant"]){const s=setup(base=>async(path,init)=>{const r=await base(path,init);if(init?.method!=="POST")return r;
    if(mode==="html")return new Response("login",{headers:{"Content-Type":"text/html"}});if(mode==="large")return Response.json({pad:"x".repeat(262145)});
    const b=await r.json();b.siteId="99990002";return Response.json(b);});
    await s.client.initialize(q.requestId);await s.client.submit(intent);assert.equal(s.map.size,1);assert.equal(s.client.getSnapshot().result,null);
  }
});
test("existing v1 pending slot recovers its exact historical receipt with a newer current source by GET only",async()=>{
  const s=setup(),legacyKey=`faolla:attendance:correction-decision:v1:${q.siteId}:${decisionOwner}`;
  await s.model.apiFetch("/api/merchant-enterprise/attendance/correction-decisions",{method:"POST",body:JSON.stringify({siteId:q.siteId,...decisionCommand})});
  s.map.set(legacyKey,JSON.stringify({siteId:q.siteId,ownerId:decisionOwner,command:decisionCommand}));s.model.mode("revised");
  await s.client.initialize(id(999));assert.equal(posts(s).length,1);assert.equal(s.map.size,0);assert.equal(s.client.getSnapshot().requestId,q.requestId);
  assert.equal(s.client.getSnapshot().result?.decisionEffect?.revision,1);assert.equal(s.client.getSnapshot().result?.current?.revision,6);
  assert.equal(s.client.getSnapshot().result?.replayed,true);assert.equal(s.client.getSnapshot().result?.effectiveChanged,false);
});
test("downgraded, mixed-gate or mismatched-source HTTP response cannot erase uncertain operation",async()=>{
  for(const kind of ["protocol","gate","source"]){const s=setup(base=>async(path,init)=>{
    const r=await base(path,init);if(init?.method!=="POST")return r;const value=await r.json();
    if(kind==="protocol")value.protocol="correction-decision-v1";else if(kind==="gate")value.moduleEnabled=false;else value.current.workedUs++;
    return Response.json(value);
  });await s.client.initialize(q.requestId);await s.client.submit(intent);assert.equal(s.client.getSnapshot().result,null);assert.equal(s.map.size,1);assert.equal(posts(s).length,1);}
});
test("read-only receipt recovery cannot accept a response claiming a fresh write",async()=>{
  const s=setup(base=>async(path,init)=>{const r=await base(path,init),value=await r.json();if((init?.method??"GET")==="GET"&&value.receipt){value.replayed=false;value.effectiveChanged=true;}return Response.json(value);});
  await s.client.initialize(q.requestId);s.model.mode("lost");await s.client.submit(intent);s.model.mode("normal");await s.client.initialize();
  assert.equal(s.client.getSnapshot().result,null);assert.equal(s.map.size,1);assert.equal(posts(s).length,1);
});
