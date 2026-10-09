import assert from "node:assert/strict";
import test from "node:test";
import {parseAttendanceTimesheetResponse as parse} from "./merchantAttendanceTimesheetResponse";
import {parseAttendanceTimesheetResult} from "./merchantAttendanceTimesheet";
import {formatAttendanceTimesheetDuration as format} from "./merchantAttendanceTimesheetDisplay";
import {attendanceDayUtcRange} from "./merchantAttendanceTime";
import {attendanceRecordInstant} from "./merchantAttendanceManagement";
import {timesheetResponse} from "../../scripts/fixtures/attendance-timesheet-client-model";
import {timesheetQuery as q,sheetWire,sheetEvent,timesheetId as id} from "../../scripts/fixtures/attendance-timesheet-model";

test("HTTP summary protocol validates original, approved, open, empty and paused results without mutations",()=>{
  for(const mode of ["normal","original","open","empty","paused"]){const value=timesheetResponse(q,mode),before=structuredClone(value),result=parse(value,q);assert.deepEqual(value,before);const {ok,...expected}=value;assert.equal(ok,true);assert.deepEqual(result,expected);}
});
test("SQL evidence is not accepted as the computed HTTP protocol",()=>assert.throws(()=>parse(sheetWire(),q)));
test("HTTP result scope, version, payroll claims and booleans must match",()=>{
  for(const patch of [{siteId:"99990008"},{workerId:id(9)},{fromDate:"2026-09-02"},{throughDate:"2026-10-01"},{calculationVersion:"v2"},{payrollReady:true},{moduleEnabled:"true"},{ok:false},{asOf:"2101-01-01T00:00:00.000000Z"},{fromAt:"2026-09-01T00:00:00.000000Z"}])assert.throws(()=>parse({...timesheetResponse(),...patch},q));
});
test("tampered daily, row and total amounts, open counts, dates and flags are rejected",()=>{
  const patches:((v:ReturnType<typeof timesheetResponse>)=>void)[]=[v=>v.totals.selected.workedUs++,v=>v.totals.difference.workedUs++,v=>v.days[0].original.breakUs++,v=>v.rows[0].selectedInPeriod!.workedUs++,v=>v.rows[0].selected.totals!.elapsedUs++,v=>v.days.reverse(),v=>v.days.pop(),v=>v.skippedDates.push("2026-09-02"),v=>v.openSessionCount++,v=>v.periodInProgress=!v.periodInProgress];
  for(const patch of patches){const value=timesheetResponse();patch(value);assert.throws(()=>parse(value,q));}
});
test("provenance, raw identifiers and impossible declaration lineage are rejected",()=>{
  const patches:((v:ReturnType<typeof timesheetResponse>)=>void)[]=[v=>v.rows[0].eventIds.push(id(300)),v=>v.rows[0].eventIds[1]=v.rows[0].eventIds[0],v=>v.rows[0].startEventId=id(301),v=>v.rows[0].lastEventId=id(301),v=>v.rows[0].correction=null,v=>v.rows[0].correction!.recordedAt="2026-09-01T00:00:00.000000Z",v=>v.rows[0].correction!.policyRevision=0,v=>v.rows[0].selected.timeZone="UTC",v=>v.rows[0].source="original"];
  for(const patch of patches){const value=timesheetResponse();patch(value);assert.throws(()=>parse(value,q));}
});
test("open shifts cannot claim a completed total, approval, future or reversed break",()=>{
  for(const patch of [(v:ReturnType<typeof timesheetResponse>)=>{v.rows[0].original.totals=v.totals.original;},(v:ReturnType<typeof timesheetResponse>)=>{v.rows[0].original.openBreak!.startAt="2026-08-31T00:00:00.000000Z";},(v:ReturnType<typeof timesheetResponse>)=>{v.rows[0].source="approved";}]){const value=timesheetResponse(q,"open");patch(value);assert.throws(()=>parse(value,q));}
});
test("original rows with over 32 breaks retain the raw-record limit",()=>{
  const wire=sheetWire();wire.items[0].events=[sheetEvent(1,"clock_in","2026-09-05T00:00:00.000000Z")];
  for(let n=0;n<40;n++)for(const action of ["break_start","break_end"] as const)wire.items[0].events.push(sheetEvent(wire.items[0].events.length+1,action,`2026-09-05T01:${String(n).padStart(2,"0")}:00.000000Z`,true));
  wire.items[0].events.push(sheetEvent(82,"clock_out","2026-09-05T16:00:00.000000Z"));
  const result=parseAttendanceTimesheetResult(wire,q);assert.equal(parse({ok:true,moduleEnabled:true,...result},q).rows[0].selected.breaks.length,40);
});
test("microseconds and negative differences are retained and independent from payroll",()=>{
  const value=timesheetResponse();assert.equal(parse(value,q).totals.difference.workedUs,-3600000000);
  assert.equal(format(-1,true),"−0 小时 0 分 0.000001 秒");assert.equal(format(2682000000000),"745 小时 0 分 0 秒");
  for(const n of [NaN,Infinity,1.5,-1,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>format(n));
});
test("output is whitelisted and does not forward private or unrecognized fields",()=>{
  const value=timesheetResponse();const result=parse({...value,secret:"hidden",actorId:id(1)},q);assert.equal("secret" in result,false);assert.equal("actorId" in result,false);
});
test("31-day autumn period has 745 hours and all daily values reconcile",()=>{
  const query={...q,fromDate:"2026-10-01",throughDate:"2026-10-31"},wire=sheetWire();
  Object.assign(wire,query,{asOf:"2026-11-01T12:00:00.000000Z",fromAt:"2026-09-30T22:00:00.000000Z",toAt:"2026-10-31T23:00:00.000000Z"});wire.items=[];
  for(let n=1;n<=31;n++){const range=attendanceDayUtcRange(`2026-10-${String(n).padStart(2,"0")}`,wire.timeZone);const start=sheetEvent(2*n-1,"clock_in",attendanceRecordInstant(range.startAt)),end=sheetEvent(2*n,"clock_out",attendanceRecordInstant(range.endAt));wire.items.push({startEventId:start.id,events:[start,end],effect:null});}
  const value={ok:true,moduleEnabled:true,...parseAttendanceTimesheetResult(wire,query)},result=parse(value,query);
  assert.equal(result.totals.selected.workedUs,745*3600000000);assert.equal(format(result.totals.selected.workedUs),"745 小时 0 分 0 秒");assert.equal(result.days.find(d=>d.date==="2026-10-25")!.selected.workedUs,25*3600000000);
});
test("daily microsecond precision survives the computed HTTP round trip",()=>{
  const wire=sheetWire();wire.items[0].events=[sheetEvent(1,"clock_in","2026-09-05T21:59:59.999999Z"),sheetEvent(2,"clock_out","2026-09-05T22:00:00.000001Z")];
  const result=parse({ok:true,moduleEnabled:true,...parseAttendanceTimesheetResult(wire,q)},q);assert.equal(result.days.find(d=>d.date==="2026-09-05")!.selected.workedUs,1);assert.equal(result.days.find(d=>d.date==="2026-09-06")!.selected.workedUs,1);
});
test("skipped civil date and last allowed query endpoint match the server protocol",()=>{
  for(const [fromDate,throughDate,timeZone] of [["2011-12-29","2011-12-31","Pacific/Apia"],["2100-12-31","2100-12-31","UTC"]]){
    const query={...q,fromDate,throughDate},wire=sheetWire();Object.assign(wire,query,{timeZone,fromAt:attendanceRecordInstant(attendanceDayUtcRange(fromDate,timeZone).startAt),toAt:attendanceRecordInstant(attendanceDayUtcRange(throughDate,timeZone).endAt)});wire.items=[];
    const value={ok:true,moduleEnabled:true,...parseAttendanceTimesheetResult(wire,query)};assert.deepEqual(parse(value,query).skippedDates,value.skippedDates);
  }
});
test("duplicate shifts, excess rows, invalid breaks and numeric strings are rejected",()=>{
  const patches:((v:ReturnType<typeof timesheetResponse>)=>void)[]=[v=>v.rows.push(structuredClone(v.rows[0])),v=>v.rows=Array(101).fill(v.rows[0]),
    v=>v.rows[0].original.breaks.push({startAt:"2026-09-01T07:00:00.000000Z",endAt:"2026-09-01T09:00:00.000000Z",paid:false}),
    v=>{(v.totals.selected as unknown as Record<string,unknown>).workedUs=String(v.totals.selected.workedUs);}];
  for(const patch of patches){const value=timesheetResponse();patch(value);assert.throws(()=>parse(value,q));}
});
