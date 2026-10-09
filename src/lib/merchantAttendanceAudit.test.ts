import assert from "node:assert/strict";
import test from "node:test";
import {parseAttendanceAuditQuery,parseAttendanceAuditResult,attendanceAuditQueryString,type AttendanceAuditItem} from "./merchantAttendanceAudit";
import {executeAttendanceAudit} from "./merchantAttendanceAudit.server";
import {AttendanceAuditClient} from "./merchantAttendanceAuditClient";
import type {AttendanceApiFetch} from "./merchantAttendanceSelfClient";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const siteId="99990001",parameters={siteId,source:"config",mode:"list",fromAt:"2026-09-01T00:00:00.000Z",toAt:"2026-09-02T00:00:00.000Z"};
const url=(patch:Record<string,string>={})=>`https://local.invalid/?${new URLSearchParams({...parameters,...patch})}`;
const parsed=parseAttendanceAuditQuery(url());if(parsed.mode!=="list")throw Error("fixture");const query=parsed;
const rows:AttendanceAuditItem[]=Array.from({length:25},(_,n)=>({operationId:id(100-n),recordedAt:`2026-09-01T12:00:00.${String(999999-n).padStart(6,"0")}Z`,
  kind:"settings",version:100-n,targetId:null,employeeId:null,actorRef:"a".repeat(32),byCurrentOwner:true}));
const settings={timeZone:"UTC",enabled:false,webClockEnabled:false,webBreakPaid:false};
const list=(items=rows)=>({ok:true,moduleEnabled:false,siteId,source:"config",mode:"list",asOf:"2026-09-03T00:00:00.000000Z",items,
  nextCursor:items.length===25?{recordedAt:items.at(-1)!.recordedAt,operationId:items.at(-1)!.operationId}:null});
const detail=(item=rows[0])=>({ok:true,moduleEnabled:false,siteId,source:"config",mode:"detail",item,before:null,after:settings});
const dq={siteId,source:"config" as const,mode:"detail" as const,operationId:rows[0].operationId};
const client=(apiFetch:AttendanceApiFetch,timeoutMs?:number)=>new AttendanceAuditClient({siteId,apiFetch,timeoutMs});

test("audit modes are strict and client identity, source mix, offset and range overrides are rejected",()=>{
  assert.equal(parseAttendanceAuditQuery(`https://local.invalid/?${attendanceAuditQueryString(dq)}`).mode,"detail");
  for(const key of ["actorId","authUserId","employeeId","isOwner","limit","offset","operationId"])assert.throws(()=>parseAttendanceAuditQuery(url({[key]:id(9)})));
  assert.throws(()=>parseAttendanceAuditQuery(`${url()}&siteId=${siteId}`));
  assert.throws(()=>parseAttendanceAuditQuery(url({source:"all"})));assert.throws(()=>parseAttendanceAuditQuery(url({mode:"detail"})));
  assert.throws(()=>parseAttendanceAuditQuery(`https://local.invalid/?${attendanceAuditQueryString(dq)}&fromAt=${query.fromAt}`));
});
test("audit preserves microsecond cursor and enforces 31-day and half-open boundaries",()=>{
  assert.ok(parseAttendanceAuditQuery(url({toAt:"2026-10-02T00:00:00.000000Z"})));
  const invalid:Record<string,string>[]=[{toAt:"2026-10-02T00:00:00.000001Z"},{toAt:parameters.fromAt},{cursorId:id(1)},{cursorAt:rows[0].recordedAt},
    {cursorId:id(1),cursorAt:rows[0].recordedAt},{asOf:list().asOf,cursorId:id(1),cursorAt:query.toAt}];
  for(const q of invalid)assert.throws(()=>parseAttendanceAuditQuery(url(q)));
  const q=parseAttendanceAuditQuery(url({asOf:list().asOf,cursorId:id(1),cursorAt:rows[0].recordedAt}));
  assert.equal(new URLSearchParams(attendanceAuditQueryString(q)).get("cursorAt"),rows[0].recordedAt);
});
test("audit list is bounded, sorted, tenant/source checked and strips raw metadata",()=>{
  const result=parseAttendanceAuditResult({...list(),secret:"x",items:rows.map(r=>({...r,actor_auth_user_id:id(8),command:settings}))},query);
  assert.equal(result.mode,"list");if(result.mode!=="list")throw Error("fixture");assert.equal("actor_auth_user_id" in result.items[0],false);
  for(const bad of [{...list(),siteId:"99990002"},{...list(),source:"scope"},{...list(),items:[...rows,rows[0]]},{...list(),items:[...rows].reverse()},
    {...list(),items:[...rows.slice(0,24),rows[0]]},{...list([]),nextCursor:list().nextCursor},{...list([]),items:[{...rows[0],actorRef:id(8)}]},
    {...list([]),items:[{...rows[0],kind:"grant_put"}]},{...list([]),items:[{...rows[0],version:0}]}])assert.throws(()=>parseAttendanceAuditResult(bad,query));
});
test("config detail whitelists exact historical fields and does not fill missing startsOn",()=>{
  const worker={...rows[0],kind:"worker" as const,targetId:id(4)},values={id:id(4),employeeId:id(5),workerNo:"W1",displayName:"历史人员",locationId:id(6),active:true,startsOn:"2026-09-01"};
  const raw={...detail(worker),before:{...values,startsOn:null},after:values};const result=parseAttendanceAuditResult(raw,dq);
  assert.equal(result.mode,"detail");if(result.mode!=="detail")throw Error("fixture");assert.equal(result.before?.startsOn,null);
  for(const bad of [{...raw,after:{...values,latitude:12}},{...raw,after:{...values,id:id(8)}},{...raw,after:{...values,active:"yes"}},
    {...raw,after:{...values,startsOn:null}},{...raw,item:{...worker,operationId:id(9)}},{...raw,after:null}])assert.throws(()=>parseAttendanceAuditResult(bad,dq));
});
test("single-grant detail preserves exact historical ID sets with bounded sorted membership",()=>{
  const item={...rows[0],kind:"grant_put",targetId:id(4),employeeId:id(5)},grant={id:id(4),workerIds:[id(7),id(8)],locationIds:[id(6)],validFrom:query.fromAt,validUntil:null};
  const q={...dq,source:"scope" as const},raw={...detail(),source:"scope",item,before:null,after:grant};
  assert.equal(parseAttendanceAuditResult(raw,q).mode,"detail");
  for(const values of [{...grant,workerIds:[]},{...grant,workerIds:[id(8),id(7)]},{...grant,workerIds:[id(7),id(7)]},
    {...grant,workerIds:Array.from({length:201},(_,n)=>id(100+n))},{...grant,validUntil:grant.validFrom}])assert.throws(()=>parseAttendanceAuditResult({...raw,after:values},q));
  assert.equal(parseAttendanceAuditResult({...raw,item:{...item,kind:"grant_remove"},before:grant,after:null},q).mode,"detail");
  assert.throws(()=>parseAttendanceAuditResult({...raw,item:{...item,kind:"grant_remove"}},q));
});
test("RPC adapter forwards verified owner identity and fixed query keys only",async()=>{
  let sent:Record<string,unknown>|null=null;
  await executeAttendanceAudit({...query,authUserId:id(1)},{rpc:async(name,args)=>{assert.equal(name,"faolla_attendance_audit_v1");sent=args;return {data:list(),error:null};}});
  assert.equal((sent as unknown as {p_auth_user_id:string}).p_auth_user_id,id(1));
  assert.equal("authUserId" in (sent as unknown as {p_query:object}).p_query,false);
  await assert.rejects(executeAttendanceAudit({...dq,authUserId:id(1)},null),/attendance_unavailable/);
  for(const [message,expected]of [["attendance_audit_not_found","attendance_audit_not_found"],["private SQL","attendance_unavailable"],["toString","attendance_unavailable"]])
    await assert.rejects(executeAttendanceAudit({...dq,authUserId:id(1)},{rpc:async()=>({data:null,error:{message}})}),new RegExp(expected));
  await assert.rejects(executeAttendanceAudit({...dq,authUserId:id(1)},{rpc:async()=>({data:{...detail(),source:"scope"},error:null})}),/attendance_unavailable/);
});
test("list requests do not prefetch detail; detail uses current selected row and GET only",async()=>{
  const urls:string[]=[];const c=client(async(url,init)=>{urls.push(url);assert.notEqual(init?.method,"POST");assert.equal(init?.cache,"no-store");
    return Response.json(new URL(url,"https://local.invalid").searchParams.get("mode")==="detail"?detail():list());});
  await c.load(query);assert.equal(urls.length,1);assert.equal(c.getSnapshot().detail,null);
  await c.detail(rows[0]);assert.equal(urls.length,1);
  await c.detail(c.getSnapshot().result!.items[0]);assert.equal(urls.length,2);assert.equal(c.getSnapshot().detail?.after?.timeZone,"UTC");
  c.closeDetail();assert.equal(c.getSnapshot().detail,null);assert.equal(urls.length,2);
});
test("detail denial clears list and snapshots, with manual recovery only",async()=>{
  let calls=0;const c=client(async()=>++calls===1?Response.json(list()):Response.json({ok:false,error:"attendance_access_denied"},{status:403}));
  await c.load(query);await c.detail(c.getSnapshot().result!.items[0]);assert.equal(c.getSnapshot().result,null);assert.equal(c.getSnapshot().detail,null);assert.equal(c.getSnapshot().phase,"blocked");assert.equal(calls,2);
});
test("late detail cannot appear after a new source query or hidden tab",async()=>{
  let release!:(r:Response)=>void,calls=0;
  const c=client(async()=>++calls===2?new Promise<Response>(resolve=>{release=resolve;}):Response.json(list()));
  await c.load(query);const pending=c.detail(c.getSnapshot().result!.items[0]);c.invalidate();release(Response.json(detail()));await pending;
  assert.equal(c.getSnapshot().detail,null);assert.equal(c.getSnapshot().result,null);await c.refresh();assert.equal(c.getSnapshot().phase,"ready");
});
test("next page sends exact cursor and clears old detail before loading",async()=>{
  const urls:string[]=[];const c=client(async url=>{urls.push(url);return urls.length===1?Response.json(list()):Response.json(list([]));});
  await c.load(query);const next=c.next();assert.equal(c.getSnapshot().result,null);await next;
  const q=new URL(urls[1],"https://local.invalid").searchParams;assert.equal(q.get("cursorAt"),rows.at(-1)!.recordedAt);assert.equal(q.get("source"),"config");
});
test("audit refuses cross-tenant inputs, mismatched detail metadata and oversized response",async()=>{
  let calls=0;const c=client(async()=>{calls++;return Response.json(list());});await c.load({...query,siteId:"99990002"});assert.equal(calls,0);
  for(const bad of [{...detail(),item:{...rows[0],version:999}},{...detail(),padding:"x".repeat(65536)},{...detail(),moduleEnabled:undefined}]){
    let count=0;const c=client(async()=>Response.json(++count===1?list():bad));await c.load(query);await c.detail(c.getSnapshot().result!.items[0]);assert.equal(c.getSnapshot().phase,"blocked");assert.equal(c.getSnapshot().result,null);
  }
});
test("audit transport cancels deadline, rejects HTML, and never loops requests",async()=>{
  let aborted=false;const c=client(async(_url,init)=>{init?.signal?.addEventListener("abort",()=>{aborted=true;});return new Promise<Response>(()=>{});},10);
  await c.load(query);assert.equal(aborted,true);assert.equal(c.getSnapshot().phase,"blocked");
  const html=client(async()=>new Response("login",{headers:{"content-type":"text/html"}}));await html.load(query);assert.equal(html.getSnapshot().result,null);
});
