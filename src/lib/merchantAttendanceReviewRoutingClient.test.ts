import test from "node:test";
import assert from "node:assert/strict";
import { AttendanceReviewRoutingClient, parseReviewRoutingPending, type ReviewRoutingClientOptions } from "./merchantAttendanceReviewRoutingClient";
import { parseReviewRoutingHttpQuery, type ReviewRoutingQuery, type ReviewRoutingCommand } from "./merchantAttendanceReviewRouting";
import { routingId,routingSite,routingOwner,routingDetail,routingResult,routingCommand,routingReceipt,routingDelegate,routingObservation } from "../../scripts/fixtures/attendance-review-routing-model";
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json"}});
function setup(overrides:Partial<ReviewRoutingClientOptions>={}){
  const values=new Map<string,string>(),calls:{method:string;query:ReviewRoutingQuery;command:ReviewRoutingCommand|null}[]=[];let current=true;
  const storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}};
  const f=routingDetail("correction",null),a=routingDelegate();const options:ReviewRoutingClientOptions={siteId:routingSite,authUserId:routingOwner,enabled:true,storage:()=>storage,isCurrentAuth:()=>current,randomId:()=>routingId(300),apiFetch:async(url,init)=>{
    const method=init?.method??"GET",body=method==="POST"?JSON.parse(String(init?.body)):null,q=body?.query??parseReviewRoutingHttpQuery("https://local.invalid"+url),command=body?.command??null;calls.push({method,query:q,command});
    if(command){assert.ok(values.size,"intent durable before POST");return json({ok:true,data:routingResult({kind:"receipt"},routingReceipt(q,command))});}
    if(q.mode==="recover")return json({ok:true,data:routingResult({kind:"receipt"})});
    if(q.mode==="detail")return json({ok:true,data:f.wire});
    if(q.mode==="grants")return json({ok:true,data:routingResult({kind:"grants",request:f.request,items:[{grantId:a.grantId,delegateEmployeeId:a.employeeId,delegateAuthUserId:a.authUserId,delegateName:"Synthetic",validFrom:a.validFrom,validUntil:a.validUntil,usable:true,reason:null}],nextCursor:null})});
    return json({ok:true,data:routingResult({kind:"list",items:[],nextCursor:null})});},...overrides};
  const client=new AttendanceReviewRoutingClient(options);return{client,options,values,storage,calls,f,setCurrent:(v:boolean)=>{current=v;}};
}
async function ready(s:ReturnType<typeof setup>,c=s.client){await c.initialize();await c.grants(s.f.query.family,s.f.query.requestId);assert.equal(c.selectGrant(routingId(12)),true);await c.detail(s.f.query.family,s.f.query.requestId);}
test("198 local initialize and explicit grant/detail precede one durable POST; receipt never grants another write",async()=>{
  const s=setup();await s.client.initialize();assert.equal(s.calls.length,0);await s.client.act("register","No fresh detail");assert.equal(s.calls.length,0);
  await ready(s);await s.client.act("register","明确指派");assert.deepEqual(s.calls.map(x=>x.method),["GET","GET","POST"]);assert.equal(s.client.getSnapshot().pending,null);assert.equal(s.values.size,0);
  await s.client.act("register","不得重复");assert.equal(s.calls.length,3);s.client.dispose();
});
test("198 no selected usable grant or stale observation can submit",async()=>{
  const s=setup();await s.client.initialize();await s.client.detail(s.f.query.family,s.f.query.requestId);await s.client.act("register","未选择");assert.equal(s.calls.length,1);
  await ready(s);const d=s.client.getSnapshot().result?.data;if(d?.kind!=="detail")throw Error();
  await s.client.submit(routingCommand({expectedObservationFingerprint:"f".repeat(64),expectedRequestRevision:d.observation.requestRevision}));assert.equal(s.calls.length,3);s.client.dispose();
});
test("198 lost reply reloads same original bytes; null receipt preserves; exact receipt GET clears without POST",async()=>{
  const s=setup(),base=s.options.apiFetch;let saved:ReviewRoutingCommand|null=null,proof=false;
  const apiFetch:ReviewRoutingClientOptions["apiFetch"]=async(url,init)=>{if(init?.method==="POST"){saved=JSON.parse(String(init.body)).command;throw Error("lost reply");}const q=parseReviewRoutingHttpQuery("https://local.invalid"+url);if(q.mode==="recover")return json({ok:true,data:routingResult({kind:"receipt"},proof&&saved?routingReceipt(s.f.query,saved):null)});return base(url,init);};
  const c=new AttendanceReviewRoutingClient({...s.options,apiFetch});await ready(s,c);await c.act("register","明确指派");const raw=s.values.get(c.storageKey)!;assert.ok(raw);c.dispose();
  const next=new AttendanceReviewRoutingClient({...s.options,apiFetch,enabled:false});await next.initialize();assert.equal(s.values.get(c.storageKey),raw);await next.list();await next.recover();assert.equal(s.values.get(c.storageKey),raw);proof=true;await next.recover();assert.equal(next.getSnapshot().pending,null);assert.equal(s.values.size,0);assert.deepEqual(s.calls.map(x=>x.method),["GET","GET"]);next.dispose();
});
test("198 malformed or foreign pending blocks without transport or overwrite",async()=>{
  const s=setup();s.values.set(s.client.storageKey,"not-json");await s.client.initialize();await s.client.list();assert.equal(s.calls.length,0);assert.equal(s.values.get(s.client.storageKey),"not-json");s.client.dispose();
  const original=setup(),base=original.options.apiFetch,c=new AttendanceReviewRoutingClient({...original.options,apiFetch:async(url,init)=>{if(init?.method==="POST")throw Error();return base(url,init);}});await ready(original,c);await c.act("register","原意图");await assert.rejects(parseReviewRoutingPending(original.values.get(c.storageKey)!,{siteId:routingSite,authUserId:routingId(99)}));c.dispose();
});
test("198 every rejected/unknown POST retains original intent; flag off disables fresh writes",async()=>{
  for(const[code,status]of[["attendance_review_routing_changed",409],["attendance_review_routing_disabled",403],["attendance_operation_conflict",409]]as const){const s=setup(),base=s.options.apiFetch,c=new AttendanceReviewRoutingClient({...s.options,apiFetch:(url,init)=>init?.method==="POST"?Promise.resolve(json({ok:false,error:{code,message:"Synthetic"}},status)):base(url,init)});await ready(s,c);await c.act("register","明确指派");assert.ok(c.getSnapshot().pending);assert.ok(s.values.get(c.storageKey));c.dispose();}
  const off=setup({enabled:false});await ready(off);await off.client.act("register","关闭");assert.equal(off.calls.length,2);off.client.dispose();
});
test("198 storage failure/replacement prevents sending or clearing another writer's intent",async()=>{
  const s=setup(),base=s.options.apiFetch,c=new AttendanceReviewRoutingClient({...s.options,apiFetch:async(url,init)=>{const r=await base(url,init);if(init?.method==="POST")s.values.set(c.storageKey,"replacement");return r;}});await ready(s,c);await c.act("register","明确指派");assert.equal(s.values.get(c.storageKey),"replacement");assert.ok(c.getSnapshot().pending);c.dispose();
  const broken=setup({storage:()=>({getItem:()=>null,setItem:()=>{throw Error("quota");},removeItem:()=>assert.fail()})});await ready(broken);await broken.client.act("register","明确指派");assert.equal(broken.calls.length,2);broken.client.dispose();
});
test("198 Auth change fences delayed headers/body while keeping saved original intent",async()=>{
  for(const phase of["headers","body"]as const){const s=setup(),base=s.options.apiFetch;let finish!:()=>void,arrived!:()=>void;const hold=new Promise<void>(r=>{finish=r;}),started=new Promise<void>(r=>{arrived=r;});
    const c=new AttendanceReviewRoutingClient({...s.options,apiFetch:async(url,init)=>{if(init?.method!=="POST")return base(url,init);const body=JSON.parse(String(init.body)),text=JSON.stringify({ok:true,data:routingResult({kind:"receipt"},routingReceipt(body.query,body.command))});if(phase==="headers"){arrived();await hold;return new Response(text,{headers:{"content-type":"application/json"}});}return new Response(new ReadableStream<Uint8Array>({start(ctrl){ctrl.enqueue(new TextEncoder().encode(text.slice(0,1)));arrived();void hold.then(()=>{try{ctrl.enqueue(new TextEncoder().encode(text.slice(1)));ctrl.close();}catch{}});}}),{headers:{"content-type":"application/json"}});}});
    await ready(s,c);const writing=c.act("register","明确指派");await started;const raw=s.values.get(c.storageKey);s.setCurrent(false);c.pause();finish();await writing;assert.equal(s.values.get(c.storageKey),raw);assert.equal(c.getSnapshot().result,null);c.dispose();}
});
test("198 digest/stream deadlines cancel without late intent write or unbounded read",async t=>{
  const s=setup({timeoutMs:15});await ready(s);const original=crypto.subtle.digest.bind(crypto.subtle);let finish!:()=>void;const hold=new Promise<void>(r=>{finish=r;});t.mock.method(crypto.subtle,"digest",async(...args:Parameters<SubtleCrypto["digest"]>)=>{await hold;return original(...args);});await s.client.act("register","明确指派");assert.equal(s.values.size,0);finish();await new Promise<void>(r=>setImmediate(r));assert.equal(s.values.size,0);s.client.dispose();
});
test("198 opening original requires fresh exact worker/employee/Auth and request identity",async()=>{
  const s=setup();await s.client.initialize();assert.deepEqual(await s.client.freshOriginal(s.f.request),s.f.request);assert.equal(await s.client.freshOriginal({...s.f.request,workerId:routingId(99)}),null);s.setCurrent(false);assert.equal(await s.client.freshOriginal(s.f.request),null);s.client.dispose();
});
test("198 handover needs fresh canTakeOver and never creates a grant",async()=>{
  const f=routingDetail(),s=setup(),base=s.options.apiFetch; if(f.wire.data.kind!=="detail"||!f.current)throw Error();
  const changed=routingId(60),d={...f.wire.data,observation:routingObservation(f.request,f.current,changed),canTakeOver:true};const c=new AttendanceReviewRoutingClient({...s.options,authUserId:changed,apiFetch:async(url,init)=>{if(init?.method==="POST"){const body=JSON.parse(String(init.body));assert.equal(body.command.grantId,null);return json({ok:true,data:routingResult({kind:"receipt"},routingReceipt(body.query,body.command,changed),changed)});}return json({ok:true,data:routingResult(d,null,changed)});}});
  await c.initialize();await c.detail(f.request.family,f.request.requestId);await c.act("take_over","负责人明确接手");assert.match(c.getSnapshot().message,/不等于可批准/);assert.equal(c.getSnapshot().pending,null);c.dispose();assert.ok(base);
});
