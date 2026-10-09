import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceCorrectionControlsClient, parseCorrectionControlsPending } from "./merchantAttendanceCorrectionControlsClient";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { controlId as id, controlSite as siteId, controlOwner as ownerId, createCorrectionControlsFixture } from "../../scripts/fixtures/attendance-correction-controls-model";
const intent = { action: "set_policy" as const, submissionWindowDays: 7, reason: " 核对期限 " };
function setup(wrap?: (api: AttendanceApiFetch) => AttendanceApiFetch, timeoutMs=2000) {
  const model=createCorrectionControlsFixture(), map=new Map<string,string>();let n=100;
  const storage={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);},removeItem:(k:string)=>{map.delete(k);}};
  const apiFetch=wrap?wrap(model.apiFetch):model.apiFetch;
  const fresh=()=>new AttendanceCorrectionControlsClient({siteId,ownerId,apiFetch,storage:()=>storage,randomId:()=>id(n++),timeoutMs});
  return {model,map,storage,fresh,client:fresh()};
}
const posts=(s:ReturnType<typeof setup>)=>s.model.calls.filter(c=>c.method==="POST");
test("opening only reads; explicit save stores normalized intent before POST and confirms receipt", async()=>{
  let saved=false;const s=setup(base=>async(path,init)=>{if(init?.method==="POST")saved=s.map.size===1;return base(path,init);});
  await s.client.initialize();assert.equal(posts(s).length,0);await s.client.submit(intent);
  assert.equal(saved,true);assert.equal(s.model.entries.length,1);assert.equal(s.map.size,0);assert.equal(s.client.getSnapshot().phase,"ready");
});
test("double submit creates only one revision",async()=>{const s=setup();await s.client.initialize();await Promise.all([s.client.submit(intent),s.client.submit(intent)]);assert.equal(posts(s).length,1);});
test("lost committed response restores by GET with no write retry",async()=>{const s=setup();await s.client.initialize();s.model.mode("lost");await s.client.submit(intent);s.client.pause();
  assert.equal(s.map.size,1);s.model.mode("normal");const fresh=s.fresh();await fresh.initialize();assert.equal(s.map.size,0);assert.equal(posts(s).length,1);assert.equal(fresh.getSnapshot().phase,"ready");});
test("unsent command stays uncertain after GET; explicit retry sends identical original bytes",async()=>{const s=setup();await s.client.initialize();s.model.mode("unsent");await s.client.submit(intent);
  const raw=s.map.get(s.client.storageKey);s.model.mode("normal");const fresh=s.fresh();await fresh.initialize();assert.equal(fresh.getSnapshot().phase,"unconfirmed");assert.equal(s.map.get(s.client.storageKey),raw);
  await fresh.retry();assert.equal(posts(s).length,2);assert.equal(posts(s)[0].body,posts(s)[1].body);assert.equal(s.model.entries.length,1);assert.equal(s.map.size,0);});
test("pending blocks history paging/new writes, and pause prevents explicit retry",async()=>{const s=setup();await s.client.initialize();s.model.mode("unsent");await s.client.submit(intent);const n=s.model.calls.length;
  await s.client.page(1);await s.client.submit(intent);s.client.pause();await s.client.retry();assert.equal(s.model.calls.length,n);});
test("later settings fence releases unreceived old operation but does not send it",async()=>{const s=setup();await s.client.initialize();s.model.mode("unsent");await s.client.submit(intent);s.model.bumpSettings();s.model.mode("normal");
  const fresh=s.fresh();await fresh.initialize();assert.equal(s.map.size,0);assert.equal(fresh.getSnapshot().phase,"ready");assert.equal(posts(s).length,1);});
test("paused platform can recover committed receipt but cannot create new policy",async()=>{const s=setup();await s.client.initialize();s.model.mode("lost");await s.client.submit(intent);s.model.enabled(false);s.model.mode("normal");
  await s.client.initialize();assert.equal(s.map.size,0);await s.client.submit(intent);assert.equal(posts(s).length,1);});
test("permission denial during uncertain retry retains original intent and never writes",async()=>{const s=setup();await s.client.initialize();s.model.mode("unsent");await s.client.submit(intent);const before=s.map.get(s.client.storageKey);
  s.model.mode("denied");await s.client.retry();assert.equal(s.map.get(s.client.storageKey),before);assert.equal(posts(s).length,1);assert.equal(s.client.getSnapshot().result,null);});
test("corrupt, injected or cross-owner pending data cannot issue requests or overwrite storage",async()=>{const s=setup();await s.client.initialize();s.model.mode("unsent");await s.client.submit(intent);const raw=s.map.get(s.client.storageKey)!,p=JSON.parse(raw);
  for(const bad of [{...p,ownerId:id(99)},{...p,siteId:"99990002"},{...p,extra:true},{...p,command:{...p.command,approved:true}}])assert.throws(()=>parseCorrectionControlsPending(JSON.stringify(bad),siteId,ownerId));
  assert.throws(()=>parseCorrectionControlsPending("x".repeat(8193),siteId,ownerId));s.map.set(s.client.storageKey,"corrupt");const n=s.model.calls.length;await s.fresh().initialize();assert.equal(s.model.calls.length,n);assert.equal(s.map.get(s.client.storageKey),"corrupt");});
test("storage unavailable before save sends no write",async()=>{const s=setup();await s.client.initialize();s.storage.setItem=()=>{throw Error("quota");};await s.client.submit(intent);assert.equal(posts(s).length,0);});
test("storage replacement during write cannot clear another pending operation or report success",async()=>{const s=setup(base=>async(path,init)=>{const r=await base(path,init);if(init?.method==="POST")s.map.set(s.client.storageKey,"different");return r;});
  await s.client.initialize();await s.client.submit(intent);assert.equal(s.map.get(s.client.storageKey),"different");assert.equal(s.client.getSnapshot().result,null);assert.equal(s.client.getSnapshot().phase,"unconfirmed");});
test("old lock receipt does not restore a lock that a later confirmed operation unlocked",async()=>{const s=setup();await s.client.initialize();await s.client.submit({action:"lock_period",fromDate:"2026-03-29",throughDate:"2026-03-29",reason:"锁定"});
  const lock=s.model.entries[0];await s.client.submit({action:"unlock_period",periodId:lock.operationId,reason:"明确解锁"});
  const command={action:"lock_period",operationId:lock.operationId,expectedRevision:0,expectedSettingsVersion:1,fromDate:"2026-03-29",throughDate:"2026-03-29",reason:"锁定"};
  s.map.set(s.client.storageKey,JSON.stringify({siteId,ownerId,command}));const fresh=s.fresh();await fresh.initialize();assert.equal(fresh.getSnapshot().result?.activePeriods.length,0);assert.equal(posts(s).length,2);assert.equal(s.map.size,0);});
test("paused late transport cannot resurrect evidence",async()=>{let release!:(r:Response)=>void;const s=setup(()=>async()=>new Promise<Response>(resolve=>{release=resolve;}));
  const task=s.client.initialize();s.client.pause();release(Response.json({ok:true,...s.model.response(null,null)}));await task;assert.equal(s.client.getSnapshot().result,null);});
test("a committed POST released after pause cannot clear pending or publish evidence; remount recovers by original-ID GET only",async()=>{
  let committed!:(response:Response)=>void,release!:()=>void,delivered!:()=>void;
  const ready=new Promise<Response>(resolve=>{committed=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;}),finished=new Promise<void>(resolve=>{delivered=resolve;});
  const s=setup(base=>async(path,init)=>{
    const response=await base(path,init);
    if(init?.method==="POST"){committed(response);await gate;delivered();}
    return response;
  });
  await s.client.initialize();const saving=s.client.submit(intent);let unsubscribe=()=>{};
  try{
    const response=await Promise.race([ready,saving.then(()=>{throw Error("save_settled_before_held_response");})]);
    assert.equal(response.status,200);assert.equal(s.model.entries.length,1);assert.equal(posts(s).length,1);
    const raw=s.map.get(s.client.storageKey)!;assert.ok(raw);const pending=JSON.parse(raw),entry=structuredClone(s.model.entries[0]);
    assert.equal(entry.operationId,pending.command.operationId);assert.equal((await response.clone().json()).receipt.operationId,pending.command.operationId);
    assert.equal(s.client.getSnapshot().phase,"saving");s.client.pause();
    const publications:ReturnType<typeof s.client.getSnapshot>[]=[];unsubscribe=s.client.subscribe(()=>publications.push(s.client.getSnapshot()));
    release();await finished;await saving;await new Promise(resolve=>setImmediate(resolve));
    assert.equal(s.client.getSnapshot().phase,"unconfirmed");assert.equal(s.client.getSnapshot().result,null);
    assert.equal(s.map.get(s.client.storageKey),raw);assert.deepEqual(s.client.getSnapshot().pending,pending);
    assert(publications.every(state=>state.result===null&&state.pending?.command.operationId===pending.command.operationId));
    const from=s.model.calls.length,fresh=s.fresh();await fresh.initialize();
    const recovery=s.model.calls.slice(from);assert.deepEqual(recovery.map(call=>call.method),["GET"]);
    assert.equal(new URL(recovery[0].path,"https://synthetic.invalid").searchParams.get("operationId"),pending.command.operationId);
    assert.equal(fresh.getSnapshot().phase,"ready");assert.deepEqual(fresh.getSnapshot().result?.receipt,entry);assert.equal(fresh.getSnapshot().pending,null);
    assert.equal(s.map.get(s.client.storageKey),undefined);assert.equal(posts(s).length,1);assert.deepEqual(s.model.entries,[entry]);
    assert.equal(s.client.getSnapshot().result,null);assert.equal(s.client.getSnapshot().phase,"unconfirmed");
  }finally{release();unsubscribe();await saving;}
});
test("body timeout cancels unfinished stream and leaves a bounded blocked state",async()=>{let cancelled=false;const s=setup(()=>async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"ok":'));},cancel(){cancelled=true;}}),{headers:{"content-type":"application/json"}}),50);
  await s.client.initialize();assert.equal(s.client.getSnapshot().phase,"blocked");assert.equal(cancelled,true);});
