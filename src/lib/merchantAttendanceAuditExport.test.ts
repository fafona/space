import assert from "node:assert/strict";
import test from "node:test";
import {attendanceAuditCsvCell,buildAttendanceAuditCsv,parseAttendanceAuditExportQuery,parseAttendanceAuditExportResult} from "./merchantAttendanceAuditExport";
import {executeAttendanceAuditExport,createAttendanceAuditExportLimiter} from "./merchantAttendanceAuditExport.server";
import {AttendanceAuditExportClient} from "./merchantAttendanceAuditExportClient";
import type {AttendanceApiFetch} from "./merchantAttendanceSelfClient";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const query={siteId:"99990001",source:"config" as const,fromAt:"2026-09-01T00:00:00.000000Z",toAt:"2026-09-02T00:00:00.000000Z"};
const row=(n=1)=>({item:{operationId:id(n),recordedAt:"2026-09-01T12:00:00.000001Z",kind:"settings",version:n,targetId:null,employeeId:null,actorRef:"a".repeat(32),byCurrentOwner:true},
  before:null,after:{timeZone:"UTC",enabled:false,webClockEnabled:false,webBreakPaid:false}});
const result=(rows=[row()])=>({...query,schemaVersion:1,asOf:"2026-09-03T00:00:00.000000Z",count:rows.length,rows});
const url=(patch:Record<string,string>={})=>`https://local.invalid/?${new URLSearchParams({...query,...patch})}`;
const reply=(raw:unknown=result())=>Response.json({ok:true,moduleEnabled:false,...raw as object});
function client(apiFetch:AttendanceApiFetch,options:Partial<ConstructorParameters<typeof AttendanceAuditExportClient>[0]>={}){
  const files:ReturnType<typeof buildAttendanceAuditCsv>[]=[];
  return {files,c:new AttendanceAuditExportClient({siteId:query.siteId,apiFetch,available:()=>true,deliver:f=>{files.push(f);},...options})};
}

test("export query has only tenant/source/range; never accepts caller identity, pagination or size",()=>{
  assert.deepEqual(parseAttendanceAuditExportQuery(url()),query);
  for(const k of ["authUserId","ownerId","limit","offset","mode","asOf","cursorId","operationId"])assert.throws(()=>parseAttendanceAuditExportQuery(url({[k]:id(2)})));
  const invalid:Record<string,string>[]=[{source:"all"},{toAt:query.fromAt},{toAt:"2026-10-02T00:00:00.000001Z"},{fromAt:"2026-02-30T00:00:00.000000Z"}];
  for(const patch of invalid)assert.throws(()=>parseAttendanceAuditExportQuery(url(patch)));
  assert.throws(()=>parseAttendanceAuditExportQuery(`${url()}&source=config`));
  assert.equal(parseAttendanceAuditExportQuery(url({toAt:"2026-10-02T00:00:00.000000Z"})).toAt,"2026-10-02T00:00:00.000000Z");
});
test("export response strips secrets and the adapter never leaks verified authentication identity",async()=>{
  const input={...query,authUserId:id(8)};
  const raw={...result(),secret:"private",rows:[{...row(),command:"secret",item:{...row().item,actor_auth_user_id:id(8)}}]};
  const parsed=parseAttendanceAuditExportResult(raw,input);
  assert.doesNotMatch(JSON.stringify(parsed),/secret|authUserId|actor_auth_user_id/);
  const data=await executeAttendanceAuditExport(input,{rpc:async(name,args)=>{
    assert.equal(name,"faolla_attendance_audit_export_v1");assert.deepEqual(args,{p_site_id:query.siteId,p_auth_user_id:id(8),p_query:{source:query.source,fromAt:query.fromAt,toAt:query.toAt}});
    return {data:raw,error:null};}});
  assert.deepEqual(data,parsed);
});
test("export snapshot rejects tenant/range/count/source changes, duplicates, bad ordering and truncated schemas",()=>{
  const many=Array.from({length:251},(_,n)=>row(251-n));
  for(const bad of [{...result(),siteId:"99990002"},{...result(),source:"scope"},{...result(),fromAt:query.toAt},
    {...result(),count:2},{...result(),schemaVersion:2},result([row(),row()]),result([row(),row(2)]),result(many),
    {...result(),rows:[{...row(),after:{...row().after,latitude:12}}]},
    {...result(),rows:[{...row(),item:{...row().item,recordedAt:query.toAt}}]},
    {...result(),asOf:row().item.recordedAt}])assert.throws(()=>parseAttendanceAuditExportResult(bad,query));
  assert.equal(parseAttendanceAuditExportResult(result(many.slice(1)),query).count,250);
});
test("scope exports allow only the affected historical grant, including removal",()=>{
  const q={...query,source:"scope" as const},grant={id:id(20),workerIds:[id(30)],locationIds:[id(40)],validFrom:query.fromAt,validUntil:null};
  const raw={...result(),source:"scope",rows:[{item:{...row().item,kind:"grant_remove",targetId:id(20),employeeId:id(50)},before:grant,after:null}]};
  assert.equal(parseAttendanceAuditExportResult(raw,q).rows[0].after,null);
  assert.throws(()=>parseAttendanceAuditExportResult({...raw,rows:[{...raw.rows[0],after:grant}]},q));
});
test("CSV quotes every field, uses BOM/CRLF and preserves old snapshots rather than today's values",()=>{
  const raw=result(),parsed=parseAttendanceAuditExportResult(raw,query),file=buildAttendanceAuditCsv(parsed);
  assert.ok(file.csv.startsWith("\ufeff\"格式版本\""));assert.ok(file.csv.endsWith("\r\n"));
  assert.match(file.csv,/""timeZone"":""UTC""/);assert.match(file.csv,/"null"/);assert.match(file.csv,/2026-09-01T12:00:00.000001Z/);
  assert.equal(file.filename,"attendance-audit-config-99990001-2026-09-03.csv");
  const empty=buildAttendanceAuditCsv(parseAttendanceAuditExportResult(result([]),query));assert.equal(empty.count,0);
  assert.match(empty.csv,/99990001/);assert.match(empty.csv,/"0"/);assert.equal(empty.csv.split("\r\n").length,3);
});
test("CSV defenses cover quotes, commas, line breaks, Unicode whitespace and formula prefixes",()=>{
  for(const v of ["=cmd()","+1","-1","@x","  =cmd()","\ufeff=1","\u200b+1","\tHello","\rHello","\nHello"])assert.ok(attendanceAuditCsvCell(v).startsWith('"\''));
  assert.equal(attendanceAuditCsvCell('a,"b"\n中文'),'"a,""b""\n中文"');
  assert.equal(attendanceAuditCsvCell('{"name":"=cmd()"}'),'"{""name"":""=cmd()""}"');
});
test("adapter fails closed on missing RPC, corrupt data, oversize and unknown SQL errors",async()=>{
  const input={...query,authUserId:id(8)};
  await assert.rejects(executeAttendanceAuditExport(input,null),/attendance_unavailable/);
  for(const code of ["attendance_access_denied","attendance_export_too_large","private SQL","toString"])
    await assert.rejects(executeAttendanceAuditExport(input,{rpc:async()=>({data:null,error:{message:code}})}),new RegExp(code.startsWith("attendance_")?code:"attendance_unavailable"));
  await assert.rejects(executeAttendanceAuditExport(input,{rpc:async()=>({data:{...result(),count:9},error:null})}),/attendance_unavailable/);
});
test("export resource limiter is bounded, per identity and expires without background polling",()=>{
  const allow=createAttendanceAuditExportLimiter();for(let n=0;n<6;n++)assert.equal(allow("a",100),true);assert.equal(allow("a",100),false);
  assert.equal(allow("b",100),true);assert.equal(allow("a",60100),true);
  for(let n=0;n<2998;n++)assert.equal(allow(`identity-${n}`,60100),true);
  assert.equal(allow("last",60100),true);assert.equal(allow("excess",60100),false);assert.equal(allow("excess",120100),true);
});
test("client is inert until explicit click; one GET obtains the entire authorized snapshot",async()=>{
  const calls:string[]=[];const {c,files}=client(async(url,init)=>{calls.push(url);assert.equal(init?.cache,"no-store");assert.notEqual(init?.method,"POST");return reply();});
  assert.equal(calls.length,0);await c.download(query);assert.equal(calls.length,1);assert.equal(files.length,1);assert.equal(c.getSnapshot().phase,"ready");
  assert.deepEqual(parseAttendanceAuditExportQuery(new URL(calls[0],"https://local.invalid").href),query);
  assert.equal("rows" in c.getSnapshot(),false);assert.equal("csv" in c.getSnapshot(),false);
});
test("new filters, hidden/unmounted view and a late response cannot download stale private content",async()=>{
  for(const mode of ["invalidate","hidden"]){
    let resolve!:(r:Response)=>void,visible=true,calls=0;
    const {c,files}=client(async()=>{calls++;return new Promise<Response>(r=>{resolve=r;});},{available:()=>visible});
    const pending=c.download(query);await c.download(query);assert.equal(calls,1);
    if(mode==="invalidate")c.invalidate();else visible=false;
    resolve(reply());await pending;assert.equal(files.length,0);assert.equal(c.getSnapshot().phase,"idle");
  }
});
test("all export failures download nothing and never automatically repeat",async()=>{
  for(const response of [()=>reply({...result(),count:8}),()=>reply({...result(),siteId:"99990002"}),()=>reply({...result(),extra:"x".repeat(2097152)}),
    ()=>Response.json({ok:false,error:"attendance_export_too_large"},{status:413}),()=>Response.json({ok:false,error:"attendance_rate_limited"},{status:429}),
    ()=>new Response("login",{headers:{"content-type":"text/html"}})]){
    let calls=0;const {c,files}=client(async()=>{calls++;return response();});await c.download(query);
    assert.equal(files.length,0);assert.equal(calls,1);assert.equal(c.getSnapshot().phase,"blocked");
  }
});
test("expired identity or enterprise/owner revocation clears the companion audit view",async()=>{
  for(const [code,status] of [["unauthorized",401],["attendance_access_denied",403],["enterprise_management_disabled",403]] as const){
    let denied=0;const {c,files}=client(async()=>Response.json({ok:false,error:code},{status}),{onDenied:()=>{denied++;}});
    await c.download(query);assert.equal(denied,1);assert.equal(files.length,0);
  }
});
test("deadline cancels request; cross-tenant/invalid query and hidden click issue no request",async()=>{
  let calls=0,aborted=false;const {c,files}=client(async(_url,init)=>{calls++;init?.signal?.addEventListener("abort",()=>{aborted=true;});return new Promise<Response>(()=>{});},{timeoutMs:10});
  await c.download({...query,siteId:"99990002"});await c.download({...query,fromAt:"bad"});assert.equal(calls,0);
  await c.download(query);assert.equal(calls,1);assert.equal(aborted,true);assert.equal(files.length,0);
  const hidden=client(async()=>{throw Error("unexpected request");},{available:()=>false});await hidden.c.download(query);assert.equal(hidden.c.getSnapshot().phase,"idle");
});
test("a download dispatch error does not claim a saved file",async()=>{
  const {c}=client(async()=>reply(),{deliver:()=>{throw Error("download unavailable");}});await c.download(query);assert.equal(c.getSnapshot().phase,"blocked");
});
