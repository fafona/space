import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { AttendancePeriodDelegatedClosureClient, periodDelegatedClosurePendingKey,
  type PeriodDelegatedClosureClientOptions, type PeriodDelegatedClosureStorage } from "./merchantAttendancePeriodDelegatedClosureClient";
import { parsePeriodDelegatedClosureHttpQuery, periodDelegatedClosureFingerprintText,
  type PeriodDelegatedClosureQuery as Query, type PeriodDelegatedClosureCommand as Command } from "./merchantAttendancePeriodDelegatedClosure";
import { projectPeriodDelegatedSource } from "./merchantAttendancePeriodClosure.server";
import { periodClosureUiArtifact, periodClosureUiQuery, periodClosureUiSummary, periodClosureUiEntry,
  periodClosureUiId as id, periodClosureUiPeriod as periodId } from "../../scripts/fixtures/attendance-period-closure-ui-model";
import { scheduleEvidenceWire } from "../../scripts/fixtures/attendance-schedule-evidence-model";

const a=periodClosureUiArtifact(),q0=periodClosureUiQuery(),actorEmployeeId=id(41001),expectedAuthUserId=id(41002),grantId=id(41003);
const scope={siteId:q0.siteId,actorEmployeeId,expectedAuthUserId,grantId,workerId:a.worker.workerId,targetEmployeeId:a.worker.employeeId,
  targetAuthUserId:a.worker.employeeAuthUserId,authorizedFromDate:"2026-09-01",authorizedThroughDate:"2026-09-30"};
const readAt="2026-09-15T12:00:00.000001Z",sha=(s:string)=>createHash("sha256").update(s).digest("hex");
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{"content-type":"application/json"}});
function draft(){const report={...scheduleEvidenceWire().attendance,access:"delegate"},base={...report.base} as Record<string,unknown>;delete base.asOf;
  const context={pendingCorrections:[],missing:[],leave:[],calendar:[],plans:{items:[],sessions:[]},reviews:[]};
  const source={sourceVersion:"attendance-period-source-v1",siteId:scope.siteId,workerId:scope.workerId,employeeId:scope.targetEmployeeId,employeeAuthUserId:scope.targetAuthUserId,
    fromDate:q0.fromDate,throughDate:q0.throughDate,timeZone:a.period.timeZone,fromAt:a.period.startAt,toAt:a.period.endAt,dayBoundaries:a.dayBoundaries,context,
    report:{version:report.version,base,missing:[],complete:true,payrollReady:false}};
  const sourceText=JSON.stringify(source);return projectPeriodDelegatedSource({...source,report,sourceCanonical:source,sourceText,sourceFingerprint:sha(sourceText),
    validation:"delegate_checked",complete:true,blockers:[]},q0).artifact;}
const candidate=draft();
type Call={q:Query;c:Command|null};
type FixtureOptions={storage?:PeriodDelegatedClosureStorage;enabled?:boolean;current?:()=>boolean;timeoutMs?:number;options?:Partial<PeriodDelegatedClosureClientOptions>;
  response?:(call:Call,base:Record<string,unknown>)=>Response|Promise<Response>};
function fixture(o:FixtureOptions={}){
  const values=new Map<string,string>(),storage=o.storage??{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}};
  const calls:Call[]=[],saved=new Map<string,unknown>();let ids=42000;
  const options:PeriodDelegatedClosureClientOptions={...scope,fromDate:q0.fromDate,throughDate:q0.throughDate,enabled:o.enabled??true,storage:()=>storage,
    isCurrentAuth:o.current,timeoutMs:o.timeoutMs,randomId:()=>id(++ids),apiFetch:async(url,init)=>{
      const c=init?.method==="POST"?JSON.parse(String(init.body)) as {query:Query;command:Command}:null;
      const q=c?.query??parsePeriodDelegatedClosureHttpQuery(new URL(String(url),"https://local.test").href),call={q,c:c?.command??null};calls.push(call);
      const common={protocol:"period-delegated-closure-v1",siteId:scope.siteId,workerId:scope.workerId,actorId:expectedAuthUserId,employeeId:actorEmployeeId,
        grantId,access:"delegate",readAt,usableActions:["view","send","respond","seal","reopen"]};
      let data:Record<string,unknown>;
      if(call.c){const command=call.c;const receipt={operationId:command.operationId,action:command.action,grantId,grantRevision:1,periodId:command.periodId,
        periodRevision:command.expectedRevision+1,actorId:expectedAuthUserId,recordedAt:readAt,commandFingerprint:sha(periodDelegatedClosureFingerprintText(q,command))};
        saved.set(command.operationId,receipt);data={...common,usableActions:[],kind:"receipt",receipt};}
      else if(q.mode==="recover")data={...common,usableActions:[],kind:"receipt",receipt:saved.get(q.operationId!)??null};
      else if(q.mode==="list")data={...common,kind:"list",items:[{...periodClosureUiSummary(),openedAt:"2026-09-11T10:00:00.000001Z"}],nextCursor:null};
      else if(q.mode==="preview")data={...common,kind:"preview",preview:{artifact:candidate,period:q.periodId?periodClosureUiSummary():null,blockers:[]}};
      else if(q.mode==="history")data={...common,kind:"history",period:periodClosureUiSummary(),items:[periodClosureUiEntry()],nextCursor:null};
      else if(q.mode==="versions")data={...common,kind:"versions",period:periodClosureUiSummary(),items:[{version:1,operationId:id(900),recordedAt:readAt,artifactId:id(901),
        sourceFingerprint:a.sourceFingerprint,artifactBytes:1024,artifactSha256:"d".repeat(64)}],nextCursor:null};
      else data={...common,kind:"detail",period:periodClosureUiSummary(),artifact:a,artifactVersion:q.version??1,sourceChanged:q.version===null?false:null,operation:null,replayed:false};
      const base={ok:true,moduleEnabled:o.enabled??true,data};return o.response?o.response(call,base):json(base);
    },...o.options};
  return{client:new AttendancePeriodDelegatedClosureClient(options),calls,storage,values,options,saved};
}
async function preview(f:ReturnType<typeof fixture>){await f.client.initialize();await f.client.preview();}
async function detail(f:ReturnType<typeof fixture>){await f.client.initialize();await f.client.load();const r=f.client.getSnapshot().result;
  assert.equal(r?.kind,"list");if(r?.kind!=="list")throw Error("fixture");await f.client.selectPeriod(r.items[0]);}
const posts=(f:ReturnType<typeof fixture>)=>f.calls.filter(x=>x.c);

test("constructor and initialize are inert; exact scope keys isolate both identities and grant",async()=>{
  const f=fixture();await f.client.initialize();assert.equal(f.calls.length,0);assert.equal(f.client.getSnapshot().phase,"idle");
  for(const patch of [{grantId:id(500)},{actorEmployeeId:id(501)},{expectedAuthUserId:id(502)},{targetEmployeeId:id(503)},{targetAuthUserId:id(504)},{workerId:id(505)}]){
    assert.notEqual(periodDelegatedClosurePendingKey({...scope,...patch}),f.client.storageKey);}
  for(const options of [{actorEmployeeId:scope.targetEmployeeId},{expectedAuthUserId:scope.targetAuthUserId},{authorizedFromDate:"2026-09-04"},
    {throughDate:"2026-10-01"},{fromDate:"2026-02-30"},{timeoutMs:NaN}])assert.throws(()=>fixture({options}));
});

test("fresh preview leads to one durable send, receipt-only result and no automatic refresh",async()=>{
  let durable=false;const f=fixture({response:({c},base)=>{if(c){durable=f.storage.getItem(f.client.storageKey)!==null;assert.equal(c.expectedRevision,0);assert.equal(c.expectedVersion,0);
    assert.equal(c.expectedFingerprint,candidate.sourceFingerprint);}return json(base);}});
  await preview(f);await f.client.send("明确送审");assert.equal(durable,true);assert.equal(posts(f).length,1);assert.equal(f.calls.length,2);
  assert.equal(f.client.getSnapshot().result?.kind,"receipt");assert.equal(f.client.getSnapshot().pending,null);assert.equal(f.values.size,0);
  await f.client.send();await f.client.respond("cannot reuse receipt");assert.equal(posts(f).length,1);
  assert.equal("confirm" in f.client,false);assert.equal("dispute" in f.client,false);assert.equal("exportVersion" in f.client,false);assert.equal("endAttempt" in f.client,false);
});

test("lost committed response persists original intent; reload flagoff makes exactly one original GET",async()=>{
  const f=fixture({response:({c},base)=>c?new Response('{"ok":',{headers:{"content-type":"application/json"}}):json(base)});
  await preview(f);await f.client.send("one original intent");const pending=f.client.getSnapshot().pending!,raw=f.storage.getItem(f.client.storageKey);
  assert.equal(f.client.getSnapshot().phase,"unconfirmed");await f.client.send();assert.equal(posts(f).length,1);
  const calls:Call[]=[];const reload=new AttendancePeriodDelegatedClosureClient({...f.options,enabled:false,apiFetch:async(url,init)=>{
    assert.equal(init?.method,"GET");const q=parsePeriodDelegatedClosureHttpQuery(new URL(String(url),"https://local.test").href);calls.push({q,c:null});
    return json({ok:true,moduleEnabled:false,data:{protocol:"period-delegated-closure-v1",siteId:scope.siteId,workerId:scope.workerId,grantId,access:"delegate",actorId:expectedAuthUserId,
      employeeId:actorEmployeeId,readAt,usableActions:[],kind:"receipt",receipt:f.saved.get(pending.command.operationId)}});}});
  await reload.initialize();assert.equal(calls.length,0);assert.equal(f.storage.getItem(f.client.storageKey),raw);await reload.load();assert.equal(calls.length,0);
  await reload.recover();assert.equal(calls.length,1);assert.equal(calls[0].q.operationId,pending.command.operationId);assert.equal(calls[0].q.periodId,pending.command.periodId);
  assert.equal(reload.getSnapshot().pending,null);assert.equal(f.storage.getItem(f.client.storageKey),null);
});

test("receipt tuple mismatches and even exact business rejection retain the original marker",async()=>{
  for(const patch of [{commandFingerprint:"0".repeat(64)},{actorId:id(99)},{operationId:id(99)},{periodId:id(99)},{periodRevision:4},{action:"respond"},{grantId:id(99)}]){
    const f=fixture({response:({c},base)=>{if(c){const d=base.data as Record<string,unknown>;return json({...base,data:{...d,receipt:{...d.receipt as object,...patch}}});}return json(base);}});
    await preview(f);await f.client.send();assert.equal(f.client.getSnapshot().phase,"unconfirmed");assert.equal(f.values.size,1);}
  for(const status of [409,404,403,503]){const error=status===409?"attendance_version_conflict":status===404?"attendance_operation_not_found":status===403?"attendance_period_delegation_disabled":"attendance_unavailable";
    const f=fixture({response:({c},base)=>c?json({ok:false,error},status):json(base)});await preview(f);await f.client.send();assert.equal(f.values.size,1);}
});

test("GET null, auth error and false-module responses do not retire unknown pending",async()=>{
  let mode="null";const f=fixture({response:({q,c},base)=>{if(c)throw Error("lost");if(q.mode==="recover")return mode==="null"
    ?json({...base,moduleEnabled:false,data:{...base.data as object,receipt:null}}):json({ok:false,error:"attendance_access_denied"},403);return json(base);}});
  await preview(f);await f.client.send();const raw=f.storage.getItem(f.client.storageKey);await f.client.recover();assert.equal(f.storage.getItem(f.client.storageKey),raw);
  mode="denied";await f.client.recover();assert.equal(f.storage.getItem(f.client.storageKey),raw);assert.equal(posts(f).length,1);
});

test("unknown stored scope or altered fingerprint fails closed without HTTP or overwriting bytes",async()=>{
  const f=fixture({response:({c},base)=>{if(c)throw Error("lost");return json(base);}});await preview(f);await f.client.send();const saved=f.storage.getItem(f.client.storageKey)!;
  for(const alter of [(v:Record<string,unknown>)=>({...v,commandFingerprint:"0".repeat(64)}),(v:Record<string,unknown>)=>({...v,scope:{...v.scope as object,targetAuthUserId:id(99)}})]){
    const bad=JSON.stringify(alter(JSON.parse(saved)));f.storage.setItem(f.client.storageKey,bad);const next=new AttendancePeriodDelegatedClosureClient(f.options),count=f.calls.length;
    await next.initialize();await next.recover();assert.equal(f.calls.length,count);assert.equal(f.storage.getItem(f.client.storageKey),bad);assert.equal(next.getSnapshot().phase,"blocked");}
});

test("list selection retains saved period dates for detail, preview, history, versions and continuation",async()=>{
  const f=fixture({options:{fromDate:"2026-09-02",throughDate:"2026-09-02"}});await detail(f);
  await f.client.preview(periodId);await f.client.history(periodId);await f.client.versions(periodId);await f.client.detail(periodId,1);
  for(const call of f.calls.slice(1)){assert.equal(call.q.fromDate,q0.fromDate);assert.equal(call.q.throughDate,q0.throughDate);}
  const count=f.calls.length;await f.client.detail(id(999));await f.client.history(id(999));await f.client.versions(id(999));await f.client.next();assert.equal(f.calls.length,count);
  await f.client.respond("historical detail not a write basis");assert.equal(posts(f).length,0);
});

test("history keyset next is explicit and keeps fixed snapshot, original date range and grant",async()=>{
  const f=fixture({options:{fromDate:"2026-09-02",throughDate:"2026-09-02"},response:({q},base)=>{
    if(q.mode!=="history")return json(base);const top=q.cursor?.kind==="history"?q.cursor.beforeRevision-1:51;
    const items=Array.from({length:Math.min(50,top)},(_,i)=>{const rev=top-i,entry=periodClosureUiEntry();return {...entry,revision:rev,action:rev===1?"send":"respond",operationId:id(60000+rev),
      command:{...entry.command,operationId:id(60000+rev),action:rev===1?"send":"respond",expectedRevision:rev-1,expectedVersion:rev===1?0:1,expectedFingerprint:rev===1?entry.command.expectedFingerprint:null,reason:rev===1?entry.reason:"reply"},reason:rev===1?entry.reason:"reply"};});
    const nextCursor=top>50?{kind:"history",siteId:q.siteId,access:q.access,grantId:q.grantId,workerId:q.workerId,fromDate:q.fromDate,throughDate:q.throughDate,periodId:q.periodId,atRevision:51,beforeRevision:2}:null;
    return json({...base,data:{...base.data as object,period:{...periodClosureUiSummary(),revision:51},items,nextCursor}});}});
  await detail(f);await f.client.history(periodId);assert.equal(f.client.getSnapshot().phase,"ready");const count=f.calls.length;assert.equal(count,3);
  await f.client.next();assert.equal(f.calls.length,4);assert.equal(f.calls.at(-1)!.q.cursor?.kind,"history");assert.equal(f.calls.at(-1)!.q.fromDate,q0.fromDate);
  assert.equal(f.client.getSnapshot().phase,"ready");await f.client.next();assert.equal(f.calls.length,4);
});

test("only fresh allowed CAS actions are derived; respondent and seal do not become employee confirmation",async()=>{
  const respond=fixture();await detail(respond);await respond.client.respond("explicit response");assert.equal(posts(respond)[0].c?.expectedRevision,1);assert.equal(posts(respond)[0].c?.expectedVersion,1);
  assert.equal(posts(respond)[0].c?.expectedFingerprint,null);
  const seal=fixture({response:({q},base)=>q.mode==="detail"?json({...base,data:{...base.data as object,period:{...periodClosureUiSummary(),state:"confirmed",confirmedVersion:1}}}):json(base)});
  await detail(seal);await seal.client.seal("explicit seal");assert.equal(posts(seal)[0].c?.action,"seal");assert.equal(posts(seal)[0].c?.expectedFingerprint,a.sourceFingerprint);
  const reopen=fixture({response:({q},base)=>q.mode==="detail"?json({...base,data:{...base.data as object,period:{...periodClosureUiSummary(),state:"sealed",sealed:true,confirmedVersion:1}}}):json(base)});
  await detail(reopen);await reopen.client.respond("denied sealed");await reopen.client.reopen("explicit reopen");assert.deepEqual(posts(reopen).map(x=>x.c!.action),["reopen"]);
});

test("module gate, usable action, sealed state and stale source prevent wrong local writes",async()=>{
  for(const modify of [(b:Record<string,unknown>)=>({...b,moduleEnabled:false}),
    (b:Record<string,unknown>)=>({...b,data:{...b.data as object,usableActions:["view"]}})]){
    const f=fixture({response:(_c,b)=>json(modify(b))});await preview(f);await f.client.send();assert.equal(posts(f).length,0);}
  const off=fixture({enabled:false});await preview(off);await off.client.send();assert.equal(off.calls.length,0);
  const stale=fixture({response:({q},b)=>q.mode==="detail"?json({...b,data:{...b.data as object,sourceChanged:true,period:{...periodClosureUiSummary(),state:"confirmed",confirmedVersion:1}}}):json(b)});
  await detail(stale);await stale.client.seal("not current");assert.equal(posts(stale).length,0);
});

test("storage failure after a durable write prevents POST and reload retains exact original",async()=>{
  const values=new Map<string,string>();let fault=true;const storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);if(fault)throw Error("stored then failed");},removeItem:(k:string)=>{values.delete(k);}};
  const f=fixture({storage});await preview(f);await f.client.send();assert.equal(posts(f).length,0);assert.equal(values.size,1);fault=false;
  await f.client.initialize();assert.equal(f.client.getSnapshot().phase,"unconfirmed");assert.equal(posts(f).length,0);
});

test("CAS storage replacement cannot be overwritten or cleared by a matching late receipt",async()=>{
  const f=fixture({response:({c},base)=>{if(c)f.storage.setItem(f.client.storageKey,"foreign bytes");return json(base);}});
  await preview(f);await f.client.send();assert.equal(f.storage.getItem(f.client.storageKey),"foreign bytes");assert.equal(f.client.getSnapshot().phase,"unconfirmed");
});

test("synchronous subscriber pause before POST preserves durable original and prevents request",async()=>{
  const f=fixture();await preview(f);f.client.subscribe(()=>{if(f.client.getSnapshot().pending&&f.client.getSnapshot().phase==="saving")f.client.pause();});
  await f.client.send();assert.equal(posts(f).length,0);assert.equal(f.values.size,1);assert.equal(f.client.getSnapshot().result,null);
});

test("wrong actual Auth, employee or target identity clears display and never supplies a write basis",async()=>{
  for(const patch of [{actorId:id(88)},{employeeId:id(88)}]){const f=fixture({response:(_q,b)=>json({...b,data:{...b.data as object,...patch}})});
    await preview(f);assert.equal(f.client.getSnapshot().result,null);await f.client.send();assert.equal(posts(f).length,0);}
  const f=fixture({response:({q},b)=>q.mode==="list"?json({...b,data:{...b.data as object,items:[{...periodClosureUiSummary(),employeeAuthUserId:id(88),openedAt:readAt}]}}):json(b)});
  await f.client.initialize();await f.client.load();assert.equal(f.client.getSnapshot().result,null);
});

test("scope change late GET is ignored, and no parallel request enters the active lease",async()=>{
  let done!:(r:Response)=>void,current=true;const f=fixture({current:()=>current,response:(_q,b)=>new Promise(resolve=>{done=()=>resolve(json(b));})});
  await f.client.initialize();const first=f.client.load();await new Promise<void>(r=>setImmediate(r));await f.client.preview();assert.equal(f.calls.length,1);
  current=false;done(json({}));await first;assert.equal(f.client.getSnapshot().result,null);assert.equal(f.client.getSnapshot().phase,"idle");
});

test("document hidden before a late body finishes clears visible data without starting another request",async t=>{
  const prior=Object.getOwnPropertyDescriptor(globalThis,"document");let hidden=false,finish!:()=>void;
  Object.defineProperty(globalThis,"document",{configurable:true,value:{get hidden(){return hidden;}}});
  t.after(()=>{if(prior)Object.defineProperty(globalThis,"document",prior);else Reflect.deleteProperty(globalThis,"document");});
  const f=fixture({response:(_q,base)=>new Response(new ReadableStream({start(controller){finish=()=>{controller.enqueue(new TextEncoder().encode(JSON.stringify(base)));controller.close();};}}),{headers:{"content-type":"application/json"}})});
  await f.client.initialize();const read=f.client.load();await new Promise<void>(r=>setImmediate(r));hidden=true;finish();await read;
  assert.equal(f.client.getSnapshot().result,null);assert.equal(f.client.getSnapshot().phase,"idle");await f.client.preview();assert.equal(f.calls.length,1);
});

test("hung crypto has a total deadline; its late digest cannot store or POST",async t=>{
  const f=fixture({timeoutMs:100});await preview(f);let done!:(v:ArrayBuffer)=>void;
  t.mock.method(crypto.subtle,"digest",()=>new Promise<ArrayBuffer>(resolve=>{done=resolve;}));await f.client.send();
  assert.equal(posts(f).length,0);assert.equal(f.values.size,0);const state=f.client.getSnapshot();done(new ArrayBuffer(32));await new Promise<void>(r=>setImmediate(r));
  assert.equal(f.client.getSnapshot(),state);assert.equal(f.values.size,0);
});

test("hung digest while restoring never retires pending even after a correct late hash",async t=>{
  const f=fixture({response:({c},b)=>{if(c)throw Error("lost");return json(b);}});await preview(f);await f.client.send();const raw=f.storage.getItem(f.client.storageKey)!;
  let done!:(v:ArrayBuffer)=>void;t.mock.method(crypto.subtle,"digest",()=>new Promise<ArrayBuffer>(resolve=>{done=resolve;}));
  const reload=new AttendancePeriodDelegatedClosureClient({...f.options,timeoutMs:100});await reload.initialize();assert.equal(f.storage.getItem(f.client.storageKey),raw);
  const parsed=JSON.parse(raw),hex=parsed.commandFingerprint as string;done(Uint8Array.from(hex.match(/../g)!,x=>parseInt(x,16)).buffer);await new Promise<void>(r=>setImmediate(r));
  assert.equal(f.storage.getItem(f.client.storageKey),raw);assert.equal(reload.getSnapshot().phase,"blocked");
});

test("hung POST headers and body expire while keeping original operation",async()=>{
  for(const body of [false,true]){let cancelled=false;const f=fixture({timeoutMs:100,response:({c},b)=>!c?json(b):body
    ?new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{"content-type":"application/json"}}):new Promise<Response>(()=>{})});
    await preview(f);await f.client.send();assert.equal(f.client.getSnapshot().phase,"unconfirmed");assert.equal(f.values.size,1);if(body)assert.equal(cancelled,true);}
});

test("crypto and transport share one absolute lease deadline rather than receiving separate budgets",async t=>{
  const actualNow=performance.now.bind(performance),actualDigest=crypto.subtle.digest.bind(crypto.subtle);let offset=0;
  t.mock.method(performance,"now",()=>actualNow()+offset);
  const f=fixture({timeoutMs:100,response:({c},base)=>{if(c)offset+=60;return json(base);}});await preview(f);
  t.mock.method(crypto.subtle,"digest",async(...args:Parameters<typeof crypto.subtle.digest>)=>{const result=await actualDigest(...args);offset+=60;return result;});
  await f.client.send();assert.equal(posts(f).length,1);assert.equal(f.values.size,1);assert.equal(f.client.getSnapshot().phase,"unconfirmed");
});

test("duplicate JSON, invalid UTF8, wrong status and oversized bodies cannot clear pending",async()=>{
  const responses=[()=>new Response('{"ok":true,"ok":true}',{headers:{"content-type":"application/json"}}),
    ()=>new Response(new Uint8Array([0xc3,0x28]),{headers:{"content-type":"application/json"}}),()=>json({},201),
    ()=>new Response('x'.repeat(4194305),{headers:{"content-type":"application/json"}})];
  for(const bad of responses){const f=fixture({response:({c},base)=>c?bad():json(base)});await preview(f);await f.client.send();assert.equal(f.values.size,1);assert.equal(f.client.getSnapshot().phase,"unconfirmed");}
});
