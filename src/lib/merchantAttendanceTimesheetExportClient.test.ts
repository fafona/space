import assert from "node:assert/strict";
import test from "node:test";
import {AttendanceTimesheetExportClient} from "./merchantAttendanceTimesheetExportClient";
import {timesheetExportCommand as cmd,timesheetExportWire as wire} from "../../scripts/fixtures/attendance-timesheet-export-model";
import {timesheetId as id} from "../../scripts/fixtures/attendance-timesheet-model";
import {parseTimesheetExportSource,buildTimesheetExportCsv,timesheetExportFilename,type TimesheetExportCommand} from "./merchantAttendanceTimesheetExport";
import type {AttendanceApiFetch} from "./merchantAttendanceSelfClient";
import {ATTENDANCE_REPORT_SOURCE_VERSION} from "./merchantAttendanceTimesheet";
const response=(c:TimesheetExportCommand)=>{const w=wire(c);w.report.sourceVersion=ATTENDANCE_REPORT_SOURCE_VERSION;const r=parseTimesheetExportSource(w,c,ATTENDANCE_REPORT_SOURCE_VERSION);return {ok:true,moduleEnabled:true,receipt:r.receipt,replayed:false,csv:buildTimesheetExportCsv(r.report!,r.receipt),filename:timesheetExportFilename(c),viewerEmployeeId:c.query.access==="owner"?null:c.query.access==="self"?id(2):id(90),accessValidUntil:null};};
function fixture(access:"owner"|"self"|"manager"="owner",change?:(b:ReturnType<typeof response>)=>unknown){
  let requests=0,downloads=0,denied=0,available=true,clock=0,next=800;
  const command=cmd(access),apiFetch:AttendanceApiFetch=async(_url,init)=>{requests++;assert.equal(init?.method,"POST");assert.equal(init.cache,"no-store");const b=response(JSON.parse(String(init.body)));return Response.json(change?change(b):b);};
  const client=new AttendanceTimesheetExportClient({selection:{siteId:command.siteId,query:command.query},actorId:access==="owner"?id(1):access==="self"?id(2):id(90),apiFetch,
    available:()=>available,deliver:()=>{downloads++;},onDenied:()=>{denied++;},randomId:()=>id(next++),now:()=>clock});
  return {client,counts:()=>({requests,downloads,denied}),hide:()=>{available=false;client.invalidate();},advance:(ms:number)=>{clock+=ms;}};
}
test("export requires explicit acknowledgement and available page, no mount request or automatic retry",async()=>{
  const f=fixture();assert.deepEqual(f.counts(),{requests:0,downloads:0,denied:0});await f.client.download(false);assert.equal(f.counts().requests,0);
  await f.client.download(true);assert.equal(f.counts().downloads,1);const first=f.client.getSnapshot().operationId;
  await f.client.download(true);assert.equal(f.counts().downloads,2);assert.notEqual(first,f.client.getSnapshot().operationId);f.hide();await f.client.download(true);assert.equal(f.counts().requests,2);
});
test("self and manager match the current viewer; tampered receipt, filename or replay contents never download",async()=>{
  for(const access of ["self","manager"] as const){const valid=fixture(access);await valid.client.download(true);assert.equal(valid.counts().downloads,1);
    for(const patch of [{viewerEmployeeId:id(999)},{filename:"other.html"},{replayed:true},{receipt:{...wire(cmd(access)).receipt,siteId:"99990008"}},{csv:"<script>bad</script>"}]){
      const f=fixture(access,b=>({...b,...patch}));await f.client.download(true);assert.equal(f.counts().downloads,0);assert.equal(f.counts().requests,1);
    }
  }
});
test("safe replay is receipt-only, finite lease subtracts full request time, no local CSV persisted",async()=>{
  const replay=fixture("owner",b=>({...b,replayed:true,csv:null,filename:null,viewerEmployeeId:null,accessValidUntil:null}));await replay.client.download(true);assert.equal(replay.counts().downloads,0);assert.match(replay.client.getSnapshot().message,/不重复下载/);
  const f=fixture("manager",b=>{f.advance(1500);return {...b,accessValidUntil:"2026-09-30T12:00:01.000000Z"};});await f.client.download(true);assert.equal(f.counts().downloads,0);assert.equal(f.counts().denied,1);
  assert.equal("csv" in f.client.getSnapshot(),false);
});
test("invalidation aborts response and prevents late downloads, concurrent click sends once",async()=>{
  let release!:()=>void,downloads=0,requests=0;const c=cmd();
  const client=new AttendanceTimesheetExportClient({selection:c,actorId:id(1),available:()=>true,randomId:()=>c.operationId,deliver:()=>{downloads++;},apiFetch:async()=>{requests++;await new Promise<void>(r=>release=r);return Response.json(response(c));}});
  const pending=client.download(true);await client.download(true);assert.equal(requests,1);client.invalidate();release();await pending;assert.equal(downloads,0);assert.equal(client.getSnapshot().operationId,null);
});
test("lost response is unknown audit outcome, not a promise of no writes, and is never retried automatically",async()=>{
  let requests=0,downloads=0;const c=cmd();
  const client=new AttendanceTimesheetExportClient({selection:c,actorId:id(1),available:()=>true,randomId:()=>c.operationId,deliver:()=>{downloads++;},apiFetch:async()=>{requests++;throw Error("network");}});
  await client.download(true);assert.equal(requests,1);assert.equal(downloads,0);assert.match(client.getSnapshot().message,/服务器可能已有来源读取记录/);
});
