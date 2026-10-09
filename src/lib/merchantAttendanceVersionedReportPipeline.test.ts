import assert from "node:assert/strict";
import test from "node:test";
import {ATTENDANCE_REPORT_SOURCE_VERSION as version,parseAttendanceTimesheetResult,type AttendanceTimesheetSourceVersion} from "./merchantAttendanceTimesheet";
import {parseAttendanceTimesheetResponse as browser} from "./merchantAttendanceTimesheetResponse";
import {parseScopedTimesheetResponse as scopedBrowser} from "./merchantAttendanceScopedTimesheetResponse";
import {executeAttendanceTimesheet} from "./merchantAttendanceTimesheet.server";
import {executeAttendanceScopedTimesheet} from "./merchantAttendanceScopedTimesheet.server";
import {executeTimesheetExport} from "./merchantAttendanceTimesheetExport.server";
import {AttendanceTimesheetClient} from "./merchantAttendanceTimesheetClient";
import {AttendanceScopedTimesheetClient} from "./merchantAttendanceScopedTimesheetClient";
import {scopedPairKey} from "./merchantAttendanceScopedTimesheetContext";
import type {AttendanceSelfRpc} from "./merchantAttendanceSelf.server";
import {createTimesheetClientFixture,timesheetResponse} from "../../scripts/fixtures/attendance-timesheet-client-model";
import {createScopedClientFixture,scopedActor} from "../../scripts/fixtures/attendance-scoped-timesheet-client-model";
import {sheetWire,sheetEffect,timesheetId as id,timesheetQuery as q,timesheetOwner} from "../../scripts/fixtures/attendance-timesheet-model";
import {scopedSheetWire,scopedSelfQuery,scopedManagerQuery,scopedViewer,scopedManager} from "../../scripts/fixtures/attendance-scoped-timesheet-model";
import {timesheetExportCommand,timesheetExportWire} from "../../scripts/fixtures/attendance-timesheet-export-model";
import {attendanceDayUtcRange} from "./merchantAttendanceTime";
import {attendanceRecordInstant} from "./merchantAttendanceManagement";
import {sheetEvent} from "../../scripts/fixtures/attendance-timesheet-model";
import {handleAttendanceTimesheet,attendanceTimesheetDependencies} from "../app/api/merchant-enterprise/attendance/timesheet/route-handler";
import type {User} from "@supabase/supabase-js";

function revised(revision=6){
  return {...sheetEffect({startAt:"2026-09-05T08:00:00.000000Z",endAt:"2026-09-05T10:00:00.000001Z",breaks:[]}),
    revision,requestId:id(revision===1?30:31),operationId:id(revision===1?40:41),
    lineage:{rootRequestId:id(30),rootOperationId:id(40),rootRecordedAt:revision===1?"2026-09-25T20:00:00.000000Z":"2026-09-24T20:00:00.000000Z",
      previousOperationId:revision===1?null:revision===2?id(40):id(42)}};
}
function source(revision=6){const w=sheetWire();return {...w,sourceVersion:version,items:w.items.map(i=>({...i,effect:revised(revision)}))};}
function response(revision=6){return {ok:true,moduleEnabled:true,...parseAttendanceTimesheetResult(source(revision),q,version)};}
const rpc=(name:string,data:unknown):AttendanceSelfRpc=>({rpc:async(received,args)=>{assert.equal(received,name);assert.equal(args.p_site_id,q.siteId);return {data,error:null};}});

test("v2 computed browser protocol preserves first and later revision provenance, exact microseconds and negative difference",()=>{
  for(const revision of [1,2,3,6,2147483647]){
    const wire=response(revision),before=structuredClone(wire),out=browser(wire,q,version);
    assert.deepEqual(wire,before);assert.equal(out.sourceVersion,version);assert.equal(out.rows[0].correction?.revision,revision);
    assert.deepEqual(out.rows[0].correction,wire.rows[0].correction);assert.equal(out.totals.selected.workedUs,7200000001);
    assert.equal(out.totals.original.workedUs,28800000000);assert.equal(out.totals.difference.workedUs,-21599999999);
    assert.throws(()=>browser(wire,q));
  }
});
test("active report version is explicit, never selected from payload or silently downgraded",async()=>{
  assert.equal(version,"raw-and-approved-v2");assert.throws(()=>browser(timesheetResponse(),q,version));
  for(const sourceVersion of [undefined,"raw-and-approved-v1","raw-and-approved-v3"])assert.throws(()=>browser({...response(),sourceVersion},q,version));
  const invalid="raw-and-approved-v3" as AttendanceTimesheetSourceVersion;
  assert.throws(()=>browser(timesheetResponse(),q,invalid));assert.throws(()=>parseAttendanceTimesheetResult({...sheetWire(),sourceVersion:invalid},q,invalid));
  await assert.rejects(executeAttendanceTimesheet({query:q,authUserId:timesheetOwner},rpc("faolla_attendance_period_report_v2",sheetWire())),/attendance_unavailable/);
});
test("computed lineage is validated independently rather than trusting server summary totals",()=>{
  for(const patch of [{revision:0},{revision:1},{revision:1.5},{revision:2147483648},{revision:"6"},{lineage:null},{lineage:{}},
    {recordedAt:"2026-09-23T20:00:00.000000Z"}]){
    const w=response();Object.assign(w.rows[0].correction!,patch);assert.throws(()=>browser(w,q,version));
  }
  for(const patch of [{rootRequestId:id(31)},{rootOperationId:id(41)},{rootRecordedAt:"2026-09-25T20:00:00.000000Z"},
    {rootRecordedAt:"2026-09-04T20:00:00.000000Z"},{previousOperationId:null},{previousOperationId:id(41)},{previousOperationId:id(40)},{extra:true}]){
    const w=response();Object.assign(w.rows[0].correction!.lineage!,patch);assert.throws(()=>browser(w,q,version));
  }
  const second=response(2);second.rows[0].correction!.lineage!.previousOperationId=id(42);assert.throws(()=>browser(second,q,version));
  const first=response(1);first.rows[0].correction!.lineage!.previousOperationId=id(40);assert.throws(()=>browser(first,q,version));
});
test("v2 keeps amount recalculation, duplicate detection and private-field projection",()=>{
  const patches:((v:ReturnType<typeof response>)=>void)[]=[v=>v.rows.push(structuredClone(v.rows[0])),v=>v.totals.selected.workedUs++,
    v=>v.rows[0].selected.totals!.workedUs++,v=>v.rows[0].selectedInPeriod!.workedUs++,v=>v.days[0].selected.workedUs++,v=>v.rows[0].eventIds[1]=v.rows[0].eventIds[0]];
  for(const patch of patches){const w=response();patch(w);assert.throws(()=>browser(w,q,version));}
  const parsed=browser({...response(),secret:"hidden",actorAuthUserId:id(88)},q,version);assert.equal("secret" in parsed,false);assert.equal("actorAuthUserId" in parsed,false);
});
test("v2 original, open, empty, paused and microsecond/daily summaries use unchanged computation",()=>{
  for(const mode of ["normal","original","open","empty","paused"]){
    const old=timesheetResponse(q,mode),w=timesheetResponse(q,mode,version),out=browser(w,q,version);
    assert.deepEqual(out.totals,old.totals);assert.deepEqual(out.days,old.days);assert.equal(out.openSessionCount,old.openSessionCount);assert.equal(out.moduleEnabled,old.moduleEnabled);
  }
});
test("computed v2 sessions cannot reuse another root even when current approval IDs are unique",()=>{
  const w=source(),next=revised();Object.assign(next,{requestId:id(32),operationId:id(43)});
  Object.assign(next.lineage,{rootRequestId:id(33),rootOperationId:id(44),previousOperationId:id(45)});
  Object.assign(next,sheetEffect({startAt:"2026-09-06T08:00:00.000000Z",endAt:"2026-09-06T10:00:00.000001Z",breaks:[]},id(104)),{revision:6,requestId:id(32),operationId:id(43)});
  w.items.push({startEventId:id(103),events:[sheetEvent(3,"clock_in","2026-09-06T08:00:00.000000Z"),sheetEvent(4,"clock_out","2026-09-06T16:00:00.000000Z")],effect:next});
  const valid={ok:true,moduleEnabled:true,...parseAttendanceTimesheetResult(w,q,version)};assert.equal(browser(valid,q,version).rows.length,2);
  for(const key of ["rootRequestId","rootOperationId"] as const){const invalid=structuredClone(valid);invalid.rows[1].correction!.lineage![key]=valid.rows[0].correction!.lineage![key];assert.throws(()=>browser(invalid,q,version));}
});
test("v2 browser/server parity retains real spring/autumn day lengths, skipped dates and cross-midnight microseconds",()=>{
  for(const [date,hours] of [["2026-03-29",23],["2026-10-25",25]] as const){
    const query={...q,fromDate:date,throughDate:date},w={...sheetWire(),sourceVersion:version},range=attendanceDayUtcRange(date,w.timeZone);
    Object.assign(w,query,{asOf:"2026-11-01T12:00:00.000000Z",fromAt:attendanceRecordInstant(range.startAt),toAt:attendanceRecordInstant(range.endAt)});
    w.items[0].events=[sheetEvent(1,"clock_in",w.fromAt),sheetEvent(2,"clock_out",w.toAt)];
    const out=browser({ok:true,moduleEnabled:true,...parseAttendanceTimesheetResult(w,query,version)},query,version);assert.equal(out.totals.selected.workedUs,hours*3600000000);
  }
  const w={...sheetWire(),sourceVersion:version};w.items[0].events=[sheetEvent(1,"clock_in","2026-09-05T21:59:59.999999Z"),sheetEvent(2,"clock_out","2026-09-05T22:00:00.000001Z")];
  const out=browser({ok:true,moduleEnabled:true,...parseAttendanceTimesheetResult(w,q,version)},q,version);
  assert.equal(out.days.find(d=>d.date==="2026-09-05")!.selected.workedUs,1);assert.equal(out.days.find(d=>d.date==="2026-09-06")!.selected.workedUs,1);
  const query={...q,fromDate:"2011-12-29",throughDate:"2011-12-31"},zone="Pacific/Apia";
  const skipped={...sheetWire(),...query,sourceVersion:version,timeZone:zone,items:[],fromAt:attendanceRecordInstant(attendanceDayUtcRange(query.fromDate,zone).startAt),toAt:attendanceRecordInstant(attendanceDayUtcRange(query.throughDate,zone).endAt)};
  assert.deepEqual(browser({ok:true,moduleEnabled:true,...parseAttendanceTimesheetResult(skipped,query,version)},query,version).skippedDates,["2011-12-30"]);
});
test("actual HTTP handler passes latest-source metadata to browser while keeping private no-store and server-authenticated principal",async()=>{
  let receivedPrincipal="";
  const service:AttendanceSelfRpc={rpc:async(name,args)=>{assert.equal(name,"faolla_attendance_period_report_v2");receivedPrincipal=String(args.p_auth_user_id);return {data:source(),error:null};}};
  const deps:Partial<typeof attendanceTimesheetDependencies>={enabled:()=>true,allow:()=>true,
    authenticate:async()=>({user:{id:timesheetOwner} as User,accessToken:"synthetic",authenticationMethods:["password"]}),
    entitlement:async()=>({permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}) as Awaited<ReturnType<typeof attendanceTimesheetDependencies.entitlement>>,
    execute:input=>executeAttendanceTimesheet(input,service)};
  const result=await handleAttendanceTimesheet(new Request("https://www.faolla.com/api/merchant-enterprise/attendance/timesheet?"+new URLSearchParams(q)),deps);
  assert.equal(result.status,200);assert.equal(result.headers.get("cache-control"),"private, no-store");assert.equal(receivedPrincipal,timesheetOwner);
  const parsed=browser(await result.json(),q,version);assert.equal(parsed.rows[0].correction?.revision,6);assert.equal(parsed.moduleEnabled,false);
});
test("actual owner and scoped executors feed computed HTTP readers and CSV from the same latest source",async()=>{
  const owner=await executeAttendanceTimesheet({query:q,authUserId:timesheetOwner},rpc("faolla_attendance_period_report_v2",source()));
  assert.equal(browser(await Response.json({ok:true,moduleEnabled:false,...owner}).json(),q,version).rows[0].correction?.revision,6);
  for(const access of ["self","manager"] as const){
    const base=scopedSheetWire(access),query=access==="self"?scopedSelfQuery:scopedManagerQuery,viewer=access==="self"?scopedViewer:scopedManager;
    const w={...base,sourceVersion:version,items:base.items.map(i=>({...i,effect:{...revised(),employeeId:scopedViewer}}))};
    const result=await executeAttendanceScopedTimesheet({query,authUserId:viewer},rpc("faolla_attendance_scoped_period_report_v2",w));
    const http={ok:true,moduleEnabled:false,...result},out=scopedBrowser(http,query,viewer,version);
    assert.equal(out.rows[0].correction?.revision,6);assert.deepEqual(out.totals,owner.totals);assert.equal("employeeId" in out,false);
    assert.throws(()=>scopedBrowser(http,query,id(998),version));assert.throws(()=>scopedBrowser({...http,employeeId:scopedViewer},query,viewer,version));
    if(access==="manager"){
      assert.throws(()=>scopedBrowser({...http,locationId:id(999)},query,viewer,version));
      assert.throws(()=>scopedBrowser({...http,accessValidUntil:http.asOf},query,viewer,version));
    }
  }
  for(const access of ["owner","self","manager"] as const){
    const command=timesheetExportCommand(access),w=timesheetExportWire(command);
    const report={...w.report,sourceVersion:version,items:w.report.items.map(i=>({...i,effect:{...revised(),employeeId:scopedViewer}}))};
    const result=await executeTimesheetExport({command,authUserId:timesheetOwner},rpc("faolla_attendance_period_export_v2",{...w,report}));
    for(const value of [version,"7200000001",id(41),id(40),id(42),"lineage.previousOperationId"])assert(result.csv?.includes(value));
    assert(!result.csv?.includes("actorEmployeeId"));assert(!result.csv?.includes("[object Object]"));
    const replay=await executeTimesheetExport({command,authUserId:timesheetOwner},rpc("faolla_attendance_period_export_v2",{...w,replayed:true,report:null}));
    assert.equal(replay.csv,null);assert.equal(replay.filename,null);
  }
});
test("owner browser state accepts actual version 6 but clears a later downgraded response without retry",async t=>{
  const f=createTimesheetClientFixture();let downgrade=false,calls=0;
  const client=new AttendanceTimesheetClient({siteId:q.siteId,ownerId:timesheetOwner,apiFetch:async(url,init)=>{
    if(new URL(url,"https://local.invalid").pathname.endsWith("/timesheet")){calls++;return Response.json(downgrade?timesheetResponse():response());}return f.apiFetch(url,init);
  }});t.after(()=>client.invalidate());await client.initialize();client.selectWorker(q.workerId);client.setDates(q.fromDate,q.throughDate);await client.load();
  assert.equal(client.getSnapshot().result?.rows[0].correction?.revision,6);downgrade=true;await client.load();
  assert.equal(calls,2);assert.equal(client.getSnapshot().result,null);assert.equal(client.getSnapshot().phase,"blocked");
});
test("self and manager browser state accept later versions while retaining scope and stale-data guards",async t=>{
  for(const access of ["self","manager"] as const){
    const f=createScopedClientFixture();let downgrade=false,calls=0;
    const {employeeId,...computed}=response();assert.equal(employeeId,scopedViewer);
    const w={...computed,access,viewerEmployeeId:access==="self"?scopedViewer:scopedManager,scopeRevision:access==="self"?null:1,
      locationId:access==="self"?null:id(5),coverage:"authorized-complete-sessions-v1",accessValidUntil:null};
    const client=new AttendanceScopedTimesheetClient({siteId:q.siteId,actorId:scopedActor(access),access,apiFetch:async(url,init)=>{
      if(new URL(url,"https://local.invalid").pathname.endsWith("/scoped-timesheet")){calls++;return Response.json(downgrade?{...w,sourceVersion:undefined}:w);}return f.apiFetch(url,init);
    }});t.after(()=>client.invalidate());await client.initialize();if(access==="manager")client.selectPair(scopedPairKey(client.getSnapshot().context!.items[0]));
    client.setDates(q.fromDate,q.throughDate);await client.load();assert.equal(client.getSnapshot().result?.rows[0].correction?.revision,6);
    downgrade=true;await client.load();assert.equal(calls,2);assert.equal(client.getSnapshot().result,null);
  }
});
