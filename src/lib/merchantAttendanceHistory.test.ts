import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {parseAttendanceHistoryQuery,parseAttendanceHistoryResult} from "./merchantAttendanceHistory";
import {executeAttendanceHistory} from "./merchantAttendanceHistory.server";
import {AttendanceHistoryClient,attendanceHistoryDateQuery,attendanceHistoryQueryString} from "./merchantAttendanceHistoryClient";
import type {AttendanceApiFetch} from "./merchantAttendanceSelfClient";
import {AttendanceSessionClient} from "./merchantAttendanceSessionClient";

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const siteId="99990001",employeeId=id(1),workerId=id(2),locationId=id(3);
const params={siteId,fromAt:"2026-09-01T00:00:00.000Z",toAt:"2026-09-03T00:00:00.000Z"};
const url=(patch:Record<string,string>={})=>`https://local.invalid/?${new URLSearchParams({...params,...patch})}`;
const query=parseAttendanceHistoryQuery(url());
const rows=Array.from({length:50},(_,n)=>({id:id(1000-n),workerId,locationId,workerName:"本人",workerNo:"T1",locationName:"历史地点",
  sequence:1000-n,action:"clock_in",source:"web",timeZone:"UTC",breakPaid:null,occurredAt:`2026-09-01T12:00:00.${String(999999-n).padStart(6,"0")}Z`}));
const payload=(items=rows)=>({ok:true,moduleEnabled:false,siteId,employeeId,workerId,asOf:"2026-09-04T00:00:00.000000Z",items,
  nextCursor:items.length===50?{id:items.at(-1)!.id,occurredAt:items.at(-1)!.occurredAt}:null});
const json=(body:unknown,status=200)=>Response.json(body,{status});
const client=(apiFetch:AttendanceApiFetch,timeoutMs?:number)=>new AttendanceHistoryClient({siteId,employeeId,apiFetch,timeoutMs});

test("self history accepts no client identity, scope or access-role selector",()=>{
  assert.equal(query.fromAt,"2026-09-01T00:00:00.000000Z");
  for(const key of ["employeeId","workerId","authUserId","access","scope","limit","offset","locationId"])
    assert.throws(()=>parseAttendanceHistoryQuery(url({[key]:id(90)})));
  assert.throws(()=>parseAttendanceHistoryQuery(`${url()}&siteId=${siteId}`));
});
test("history ranges preserve microsecond 31-day bounds and cursor requires bound worker",()=>{
  assert.ok(parseAttendanceHistoryQuery(url({toAt:"2026-10-02T00:00:00.000000Z"})));
  const invalid:Record<string,string>[]=[{toAt:"2026-10-02T00:00:00.000001Z"},{toAt:params.fromAt},{fromAt:"2026-02-30T00:00:00.000Z"},
    {cursorAt:rows[0].occurredAt},{cursorId:id(4)},{expectedWorkerId:"*"},
    {asOf:payload().asOf,cursorAt:rows[0].occurredAt,cursorId:rows[0].id}];
  for(const patch of invalid)assert.throws(()=>parseAttendanceHistoryQuery(url(patch)));
  const q=parseAttendanceHistoryQuery(url({expectedWorkerId:workerId,asOf:payload().asOf,cursorAt:rows[0].occurredAt,cursorId:rows[0].id}));
  assert.equal(q.cursorAt,rows[0].occurredAt);assert.equal(new URLSearchParams(attendanceHistoryQueryString(q)).get("cursorAt"),rows[0].occurredAt);
});
test("history results whitelist metadata and enforce one worker, tenant, page bounds and ordering",()=>{
  const result=parseAttendanceHistoryResult({...payload(),authUserId:id(7),items:rows.map(r=>({...r,operationId:id(8),latitude:42}))},query);
  assert.equal(result.items.length,50);assert.equal("authUserId" in result,false);assert.equal("operationId" in result.items[0],false);
  for(const body of [{...payload(),siteId:"99990002"},{...payload(),workerId:id(99)},
    {...payload(),items:[...rows,rows[0]]},{...payload(),items:[...rows].reverse()},
    {...payload([]),items:[{...rows[0],workerId:id(99)}]},
    {...payload([]),items:[{...rows[0],occurredAt:params.toAt}]},
    {...payload([]),items:[{...rows[0],breakPaid:true}]},{...payload([]),items:[{...rows[0],source:["web"]}]},
    {...payload([]),items:[{...rows[0],source:{toString:"web"}}]},{...payload([]),nextCursor:payload().nextCursor}])
    assert.throws(()=>parseAttendanceHistoryResult(body,query));
  assert.throws(()=>parseAttendanceHistoryResult(payload([]),{...query,expectedWorkerId:id(99)}));
  assert.throws(()=>parseAttendanceHistoryResult(payload([]),{...query,asOf:"2026-09-05T00:00:00.000000Z"}));
});
test("service sends only server-verified auth and strict self query, not employee or role",async()=>{
  let args:Record<string,unknown>|undefined;
  const result=await executeAttendanceHistory({...query,authUserId:id(8)},{rpc:async(name,input)=>{
    assert.equal(name,"faolla_attendance_self_history_v1");args=input;return {data:payload([]),error:null};}});
  assert.equal(result.workerId,workerId);assert.equal(args?.p_auth_user_id,id(8));
  assert.deepEqual(Object.keys(args?.p_query as object).sort(),["asOf","cursorAt","cursorId","expectedWorkerId","fromAt","toAt"]);
  for(const [message,expected] of [["attendance_access_denied","attendance_access_denied"],["attendance_worker_changed","attendance_worker_changed"],["secret SQL","attendance_unavailable"],["toString","attendance_unavailable"]])
    await assert.rejects(executeAttendanceHistory({...query,authUserId:id(8)},{rpc:async()=>({data:null,error:{message}})}),new RegExp(expected));
  await assert.rejects(executeAttendanceHistory({...query,authUserId:id(8)},null),/attendance_unavailable/);
  await assert.rejects(executeAttendanceHistory({...query,authUserId:id(8)},{rpc:async()=>({data:{...payload(),siteId:"99990002"},error:null})}),/attendance_unavailable/);
});
test("history date controls cover 23/25-hour DST days and at most 30 calendar days",()=>{
  for(const [date,hours] of [["2026-03-29",23],["2026-10-25",25]] as const){const q=attendanceHistoryDateQuery(siteId,date,date,"Europe/Madrid");assert.equal(Date.parse(q.toAt)-Date.parse(q.fromAt),hours*3600000);}
  assert.ok(attendanceHistoryDateQuery(siteId,"2026-10-01","2026-10-30","Europe/Madrid"));
  for(const [start,end,zone] of [["2026-10-01","2026-10-31","UTC"],["2026-02-30","2026-03-01","UTC"],["2011-12-30","2011-12-30","Pacific/Apia"],["2026-01-01","2026-01-01","+01:00"]])
    assert.throws(()=>attendanceHistoryDateQuery(siteId,start,end,zone));
});
test("client sends GET with exact cursor, pins worker and clears rows before next-page denial",async()=>{
  const urls:string[]=[];const c=client(async(path,init)=>{
    urls.push(path);assert.notEqual(init?.method,"POST");assert.equal(init?.cache,"no-store");
    return urls.length===1?json(payload()):json({ok:false,error:"attendance_access_denied"},403);
  });
  await c.load(query);assert.equal(c.getSnapshot().result?.moduleEnabled,false);
  const next=c.next();assert.equal(c.getSnapshot().result,null);await next;assert.equal(c.getSnapshot().phase,"blocked");
  const q=new URL(urls[1],"https://local.invalid").searchParams;
  assert.equal(q.get("expectedWorkerId"),workerId);assert.equal(q.get("cursorAt"),rows.at(-1)!.occurredAt);assert.equal(q.has("workerId"),false);
});
test("rebound worker gets explicit conflict and only manual first-page query clears pin",async()=>{
  const urls:string[]=[];const c=client(async path=>{urls.push(path);return urls.length===2?json({ok:false,error:"attendance_worker_changed"},409):json(payload());});
  await c.load(query);await c.next();assert.equal(c.getSnapshot().result,null);assert.match(c.getSnapshot().message,/档案已变化/);
  await c.refresh(true);assert.equal(new URL(urls[2],"https://local.invalid").searchParams.has("expectedWorkerId"),false);
});
test("wrong employee and tenant responses never appear, even on empty pages",async()=>{
  for(const patch of [{employeeId:id(99)},{siteId:"99990002"},{moduleEnabled:undefined}]) {
    const c=client(async()=>json({...payload([]),...patch}));await c.load(query);assert.equal(c.getSnapshot().result,null);assert.equal(c.getSnapshot().phase,"blocked");
  }
});
test("client cannot switch tenant or submit unvalidated queries",async()=>{
  let calls=0;const c=client(async()=>{calls++;return json(payload());});
  for(const patch of [{siteId:"99990002"},{toAt:query.fromAt},{expectedWorkerId:"*"}])await c.load({...query,...patch});
  await c.refresh();await c.next();assert.equal(calls,0);
});
test("late response cannot return after a newer query or hidden tab clears history",async()=>{
  let release!:(r:Response)=>void,calls=0;
  const c=client(async()=>++calls===1?new Promise<Response>(resolve=>{release=resolve;}):json(payload([])));
  const old=c.load(query);await c.load(query);release(json(payload()));await old;assert.equal(c.getSnapshot().result?.items.length,0);
  c.invalidate();assert.equal(c.getSnapshot().result,null);await c.refresh();assert.equal(calls,3);assert.equal(c.getSnapshot().phase,"ready");
  c.invalidate(true);await c.refresh();assert.equal(calls,3);
});
test("history timeout and oversized or HTML response clear rows without automatic retries",async()=>{
  for(const make of [()=>new Response("login",{headers:{"content-type":"text/html"}}),()=>json({...payload(),padding:"x".repeat(98304)})]) {
    let calls=0;const c=client(async()=>{calls++;return make();});await c.load(query);assert.equal(calls,1);assert.equal(c.getSnapshot().phase,"blocked");assert.equal(c.getSnapshot().result,null);
  }
  let aborted=false,calls=0;const c=client(async(_path,init)=>{calls++;init?.signal?.addEventListener("abort",()=>{aborted=true;});return new Promise<Response>(()=>{});},15);
  await c.load(query);assert.equal(aborted,true);assert.equal(calls,1);assert.equal(c.getSnapshot().phase,"blocked");assert.match(c.getSnapshot().message,/没有提交/);
});
test("session invalidation clears the bound history page but requires an explicit fresh first-page query",async()=>{
  const urls:string[]=[];
  const c=client(async path=>{urls.push(path);return json(payload());});
  await c.load(query);const visible=c.getSnapshot().result!,boundQuery=c.getSnapshot().query;
  assert.equal(c.invalidateFromSession(visible),true);
  assert.equal(c.getSnapshot().result,null);assert.equal(c.getSnapshot().phase,"blocked");
  assert.deepEqual(c.getSnapshot().query,boundQuery);assert.equal(c.getSnapshot().query?.expectedWorkerId,workerId);
  assert.match(c.getSnapshot().message,/重新查询首页/);
  await c.next();await c.refresh();c.invalidate();await c.refresh();assert.equal(urls.length,1);
  await c.refresh(true);assert.equal(urls.length,2);assert.equal(c.getSnapshot().phase,"ready");
  const fresh=new URL(urls[1],"https://local.invalid").searchParams;
  for(const field of ["expectedWorkerId","asOf","cursorAt","cursorId"])assert.equal(fresh.has(field),false);
  assert.equal(fresh.get("fromAt"),query.fromAt);assert.equal(fresh.get("toAt"),query.toAt);
});
test("a stale session or cloned page snapshot cannot erase replacement or in-flight history",async()=>{
  let release!:(r:Response)=>void,calls=0;
  const c=client(async()=>++calls===3?new Promise<Response>(resolve=>{release=resolve;}):json(payload()));
  await c.load(query);const old=c.getSnapshot().result!;
  await c.load(query);const current=c.getSnapshot().result!;
  assert.equal(c.invalidateFromSession(old),false);assert.equal(c.invalidateFromSession({...current}),false);
  assert.equal(c.getSnapshot().result,current);
  const pending=c.load(query);assert.equal(c.invalidateFromSession(current),false);
  release(json(payload([])));await pending;assert.equal(c.getSnapshot().phase,"ready");
  assert.deepEqual(c.getSnapshot().result?.items,[]);assert.equal(calls,3);
});
test("actual session denial clears parent and child without a hidden replacement-worker query; manual refresh recovers",async()=>{
  for(const response of [()=>json({ok:false,error:"attendance_session_not_found"},404),
    ()=>json({ok:false,error:"attendance_access_denied"},403),()=>new Response("login",{status:401})]){
    let historyCalls=0,sessionCalls=0;
    const c=client(async()=>{historyCalls++;return json(payload());});
    await c.load(query);const visible=c.getSnapshot().result!;
    const session=new AttendanceSessionClient({siteId,employeeId,expectedWorkerId:workerId,startEventId:rows[0].id,
      apiFetch:async()=>{sessionCalls++;return response();},onIdentityInvalidated:()=>{c.invalidateFromSession(visible);}});
    await session.load();assert.equal(c.getSnapshot().result,null);assert.equal(session.getSnapshot().report,null);
    await c.refresh();assert.equal(historyCalls,1);assert.equal(sessionCalls,1);
    await c.refresh(true);assert.equal(historyCalls,2);assert.equal(c.getSnapshot().phase,"ready");
  }
});
test("temporary session failures clear only the child, retaining the current history page",async()=>{
  for(const response of [()=>json({ok:false,error:"attendance_rate_limited"},429),
    ()=>json({ok:false,error:"attendance_session_not_found"},500),()=>{throw Error("offline");}]){
    const c=client(async()=>json(payload()));await c.load(query);const visible=c.getSnapshot().result!;
    const session=new AttendanceSessionClient({siteId,employeeId,expectedWorkerId:workerId,startEventId:rows[0].id,
      apiFetch:async()=>response(),onIdentityInvalidated:()=>{c.invalidateFromSession(visible);}});
    await session.load();assert.equal(session.getSnapshot().report,null);assert.equal(c.getSnapshot().result,visible);
  }
});
test("history/session component wiring guards synchronous selection changes and leaves explicit recovery enabled",()=>{
  const history=readFileSync(new URL("../components/enterprise/MerchantAttendanceHistoryPanel.tsx",import.meta.url),"utf8");
  const session=readFileSync(new URL("../components/enterprise/MerchantAttendanceSessionPanel.tsx",import.meta.url),"utf8");
  assert.match(history,/onSessionIdentityInvalidated=useCallback/);
  assert.match(history,/selectedSession\.current!==startEventId\|\|!client\.invalidateFromSession\(state\.result\)/);
  assert.match(history,/selectedSession\.current=next;setSessionId\(next\)/);
  assert.match(history,/closeSession\(\);setError\(""\)/);
  assert.match(history,/expectedWorkerId=\{record\.workerId\}/);
  assert.match(history,/disabled=\{busy\|\|!state\.query\|\|!!error\} onClick=\{\(\)=>\{closeSession\(\);void client\.refresh\(true\);\}\}/);
  assert.match(session,/onIdentityInvalidated:\(\)=>onIdentityInvalidated\?\.\(startEventId\)/);
  assert.match(session,/client\.initialize\(\)/);assert.match(session,/client\.dispose\(\)/);
});
