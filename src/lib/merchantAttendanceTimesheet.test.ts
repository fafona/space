import assert from "node:assert/strict";
import test from "node:test";
import {parseAttendanceTimesheetQuery,attendanceTimesheetQueryString,parseAttendanceTimesheetResult,type AttendanceTimesheetQuery} from "./merchantAttendanceTimesheet";
import {executeAttendanceTimesheet} from "./merchantAttendanceTimesheet.server";
import {attendanceDayUtcRange} from "./merchantAttendanceTime";
import {attendanceRecordInstant} from "./merchantAttendanceManagement";
import {sheetWire,sheetEvent,sheetEffect,timesheetQuery as q,timesheetOwner,timesheetId as id} from "../../scripts/fixtures/attendance-timesheet-model";
const hour=3600000000;
const parse=(v=sheetWire(),query=q)=>parseAttendanceTimesheetResult(v,query);
function period(v:ReturnType<typeof sheetWire>,date:string,last=date,zone=v.timeZone){
  const query={...q,fromDate:date,throughDate:last};v.fromDate=date;v.throughDate=last;v.timeZone=zone;
  v.fromAt=attendanceRecordInstant(attendanceDayUtcRange(date,zone).startAt);v.toAt=attendanceRecordInstant(attendanceDayUtcRange(last,zone).endAt);return query;
}
test('timesheet query is exact and limited by calendar dates, not browser timezone',()=>{
  const url=`https://local.invalid/?${attendanceTimesheetQueryString(q)}`;assert.deepEqual(parseAttendanceTimesheetQuery(url),q);
  for(const suffix of ['&workerId='+q.workerId,'&authUserId='+timesheetOwner,'&access=manager','&timeZone=UTC','&asOf=2026-09-01','&source=approved'])assert.throws(()=>parseAttendanceTimesheetQuery(url+suffix));
  for(const query of [{...q,throughDate:'2026-10-02'},{...q,fromDate:'2026-09-31'},{...q,fromDate:'2026-10-01'},
    {...q,fromDate:'2026-02-29'},{...q,throughDate:'2101-01-01'},{...q,workerId:'invalid'}])assert.throws(()=>parseAttendanceTimesheetQuery(`https://local.invalid/?${attendanceTimesheetQueryString(query)}`));
  assert.doesNotThrow(()=>parseAttendanceTimesheetQuery(`https://local.invalid/?${attendanceTimesheetQueryString({...q,throughDate:'2026-10-01'})}`));
});
test('closed original hours stay unchanged, separately totalled, traceable and never payroll',()=>{
  const v=sheetWire(),before=structuredClone(v),r=parse(v);assert.deepEqual(v,before);
  assert.equal(r.totals.original.workedUs,8*hour);assert.deepEqual(r.totals.original,r.totals.selected);assert.equal(r.totals.difference.workedUs,0);
  assert.equal(r.rows[0].source,'original');assert.deepEqual(r.rows[0].eventIds,[id(101),id(102)]);assert.equal(r.days.length,30);
  assert.equal(r.days.find(d=>d.date==='2026-09-05')!.selected.workedUs,8*hour);assert.equal(r.payrollReady,false);assert.equal(r.periodInProgress,true);
});
test('approved declaration replaces rather than adds to its original shift',()=>{
  const v=sheetWire();v.items[0].effect=sheetEffect({startAt:'2026-09-05T08:00:00.000000Z',endAt:'2026-09-05T17:00:00.000000Z',breaks:[]});
  const r=parse(v);assert.equal(r.totals.original.workedUs,8*hour);assert.equal(r.totals.selected.workedUs,9*hour);assert.equal(r.totals.difference.workedUs,hour);
  assert.equal(r.rows[0].source,'approved');assert.equal(r.rows[0].correction?.requestId,id(30));
});
test('paid breaks are reported separately, not silently treated as worked hours or wages',()=>{
  const v=sheetWire();v.items[0].events=[sheetEvent(1,'clock_in','2026-09-05T08:00:00.000000Z'),sheetEvent(2,'break_start','2026-09-05T10:00:00.000000Z',true),
    sheetEvent(3,'break_end','2026-09-05T10:30:00.000000Z'),sheetEvent(4,'clock_out','2026-09-05T16:00:00.000000Z')];
  const r=parse(v);assert.equal(r.totals.selected.workedUs,7.5*hour);assert.equal(r.totals.selected.paidBreakUs,.5*hour);
});
test('open work and open breaks do not manufacture an end or a zero-length completed shift',()=>{
  for(const onBreak of [false,true]){
    const v=sheetWire();v.items[0].events=[sheetEvent(1,'clock_in','2026-09-05T08:00:00.000000Z')];
    if(onBreak)v.items[0].events.push(sheetEvent(2,'break_start','2026-09-05T10:00:00.000000Z'));
    const r=parse(v);assert.equal(r.openSessionCount,1);assert.equal(r.rows[0].selected.endAt,null);assert.equal(r.rows[0].selected.totals,null);
    assert.equal(r.totals.selected.workedUs,0);assert.equal(r.rows[0].selected.status,onBreak?'break':'working');
  }
});
test('left boundary previous shift is clipped without losing its original evidence',()=>{
  const v=sheetWire();v.items[0].events=[sheetEvent(1,'clock_in','2026-08-31T21:00:00.000000Z'),sheetEvent(2,'clock_out','2026-09-01T02:00:00.000000Z')];
  const query=period(v,'2026-09-01'),r=parse(v,query);assert.equal(r.rows[0].original.totals?.workedUs,5*hour);assert.equal(r.totals.original.workedUs,4*hour);
});
test('right boundary clips a completed next-day shift with microsecond accuracy',()=>{
  const v=sheetWire();v.items[0].events=[sheetEvent(1,'clock_in','2026-09-05T21:59:59.999999Z'),sheetEvent(2,'clock_out','2026-09-05T22:00:00.000001Z')];
  const r=parse(v,period(v,'2026-09-05'));assert.equal(r.totals.original.workedUs,1);assert.equal(r.rows[0].original.totals?.workedUs,2);
});
test('cross-midnight breaks are split and conservation holds in microseconds',()=>{
  const v=sheetWire();v.items[0].events=[sheetEvent(1,'clock_in','2026-09-05T21:00:00.000000Z'),sheetEvent(2,'break_start','2026-09-05T21:59:59.999999Z',true),
    sheetEvent(3,'break_end','2026-09-05T22:00:00.000001Z'),sheetEvent(4,'clock_out','2026-09-05T23:00:00.000000Z')];
  const r=parse(v);assert.equal(r.totals.selected.elapsedUs,2*hour);assert.equal(r.totals.selected.workedUs,2*hour-2);assert.equal(r.totals.selected.paidBreakUs,2);
  for(const date of ['2026-09-05','2026-09-06']){const d=r.days.find(d=>d.date===date)!;assert.equal(d.selected.workedUs,hour-1);assert.equal(d.selected.paidBreakUs,1);}
});
test('approved shift moved into the period is not lost due to original-start filtering',()=>{
  const v=sheetWire();v.items[0].effect=sheetEffect({startAt:'2026-09-06T08:00:00.000000Z',endAt:'2026-09-06T16:00:00.000000Z',breaks:[]});
  const r=parse(v,period(v,'2026-09-06'));assert.equal(r.totals.original.workedUs,0);assert.equal(r.totals.selected.workedUs,8*hour);
});
test('approved shift moved out removes original hours instead of double counting across periods',()=>{
  const v=sheetWire();v.items[0].effect=sheetEffect({startAt:'2026-09-06T08:00:00.000000Z',endAt:'2026-09-06T16:00:00.000000Z',breaks:[]});
  const r=parse(v,period(v,'2026-09-05'));assert.equal(r.totals.original.workedUs,8*hour);assert.equal(r.totals.selected.workedUs,0);assert.equal(r.totals.difference.workedUs,-8*hour);
});
test('spring and autumn DST days contain 23 and 25 real hours',()=>{
  for(const [date,start,end,hours] of [['2026-03-29','2026-03-28T23:00:00.000000Z','2026-03-29T22:00:00.000000Z',23],
    ['2025-10-26','2025-10-25T22:00:00.000000Z','2025-10-26T23:00:00.000000Z',25]] as const){
    const v=sheetWire();v.items[0].events=[sheetEvent(1,'clock_in',start),sheetEvent(2,'clock_out',end)];
    const r=parse(v,period(v,date));assert.equal(r.totals.selected.workedUs,hours*hour);assert.equal(r.days.length,1);
  }
});
test('skipped local days are disclosed, not fabricated as 24 hours',()=>{
  const v=sheetWire();v.items[0].events=[{...sheetEvent(1,'clock_in','2011-12-29T10:00:00.000000Z'),timeZone:'Pacific/Apia'},
    {...sheetEvent(2,'clock_out','2011-12-31T10:00:00.000000Z'),timeZone:'Pacific/Apia'}];
  const r=parse(v,period(v,'2011-12-29','2011-12-31','Pacific/Apia'));assert.deepEqual(r.skippedDates,['2011-12-30']);assert.equal(r.days.length,2);assert.equal(r.totals.selected.workedUs,48*hour);
});
test('report grouping uses explicit merchant timezone and retains original event timezone',()=>{
  const v=sheetWire();v.items[0].events=[{...sheetEvent(1,'clock_in','2026-09-05T21:00:00.000000Z'),timeZone:'UTC'},
    {...sheetEvent(2,'clock_out','2026-09-05T23:00:00.000000Z'),timeZone:'UTC'}];
  const r=parse(v);assert.equal(r.rows[0].original.timeZone,'UTC');assert.equal(r.days.find(d=>d.date==='2026-09-06')!.selected.workedUs,hour);
});
test('inactive or no-longer-bound worker history need not invent an employee identity',()=>{
  const v=sheetWire();const r=parseAttendanceTimesheetResult({...v,employeeId:null},q);assert.equal(r.employeeId,null);assert.equal(r.rows.length,1);
});
test('pending metadata cannot become approved hours and sensitive fields are projected away',()=>{
  const v=sheetWire();const r= parseAttendanceTimesheetResult({...v,authUserId:id(700),privateToken:'secret',items:v.items.map(i=>({...i,reason:'private reason',pendingProposal:{},latitude:12}))},q);
  assert.equal(r.rows[0].source,'original');assert.doesNotMatch(JSON.stringify(r),/secret|authUserId|latitude|private reason|pendingProposal/);
});
test('empty period remains a complete bounded observation, with zero daily amounts',()=>{
  const v=sheetWire();v.items=[];const r=parse(v);assert.equal(r.rows.length,0);assert.equal(r.days.length,30);assert.equal(r.totals.selected.workedUs,0);
});
test('wrong scope, boundaries, partial results and unknown source version fail closed',()=>{
  for(const patch of [{siteId:'99990008'},{workerId:id(66)},{fromDate:'2026-09-02'},{timeZone:'UTC'},
    {fromAt:'2026-09-01T00:00:00.000000Z'},{complete:false},{sourceVersion:'old'},{items:new Array(101).fill(sheetWire().items[0])}])assert.throws(()=>parseAttendanceTimesheetResult({...sheetWire(),...patch},q));
});
test('malformed raw sequence, future events, duplicate identities and missing starts are rejected',()=>{
  for(const change of [(v:ReturnType<typeof sheetWire>)=>v.items[0].events[1].sequence=3,
    (v:ReturnType<typeof sheetWire>)=>v.items[0].events[1].occurredAt='2026-10-01T00:00:00.000000Z',
    (v:ReturnType<typeof sheetWire>)=>v.items[0].events[1].id=v.items[0].events[0].id,
    (v:ReturnType<typeof sheetWire>)=>v.items[0].events[0].action='clock_out',
    (v:ReturnType<typeof sheetWire>)=>v.items.push(structuredClone(v.items[0]))]){const v=sheetWire();change(v);assert.throws(()=>parse(v));}
});
test('effect must prove approval, exact lineage, bounded revision, timestamp and totals',()=>{
  const effect=sheetEffect({startAt:'2026-09-05T08:00:00.000000Z',endAt:'2026-09-05T17:00:00.000000Z',breaks:[]});
  for(const patch of [{action:'reject'},{revision:2},{originalLastEventId:id(999)},{recordedAt:'2026-10-01T00:00:00.000000Z'},
    {recordedAt:'2026-09-01T00:00:00.000000Z'},{policyRevision:0},{timeZone:'UTC'},{calculationVersion:'estimate'},{workedUs:123}]){
    const v=sheetWire();v.items[0].effect={...effect,...patch};assert.throws(()=>parse(v));
  }
});
test('selected overlap is rejected rather than returning inflated period totals',()=>{
  const v=sheetWire();v.items[0].effect=sheetEffect({startAt:'2026-09-05T08:00:00.000000Z',endAt:'2026-09-06T10:00:00.000000Z',breaks:[]});
  v.items.push({startEventId:id(103),events:[sheetEvent(3,'clock_in','2026-09-06T08:00:00.000000Z'),sheetEvent(4,'clock_out','2026-09-06T16:00:00.000000Z')],effect:null});
  assert.throws(()=>parse(v),/attendance_report_overlap/);
});
test('irrelevant rows and original chronological overlap are rejected',()=>{
  const v=sheetWire();assert.throws(()=>parse(v,period(v,'2026-09-07')));
  const other=sheetWire();other.items.push({startEventId:id(103),events:[sheetEvent(3,'clock_in','2026-09-05T12:00:00.000000Z'),sheetEvent(4,'clock_out','2026-09-05T18:00:00.000000Z')],effect:null});assert.throws(()=>parse(other));
});
test('an open original cannot be followed by another fabricated session',()=>{
  const v=sheetWire();v.items[0].events.pop();
  v.items.push({startEventId:id(103),events:[sheetEvent(3,'clock_in','2026-09-06T08:00:00.000000Z'),sheetEvent(4,'clock_out','2026-09-06T16:00:00.000000Z')],effect:null});
  assert.throws(()=>parse(v));
});
test('empty future period is marked in progress, never a finalized no-attendance record',()=>{
  const v=sheetWire();v.items=[];const r=parse(v,period(v,'2026-10-01'));
  assert.equal(r.periodInProgress,true);assert.equal(r.openSessionCount,0);assert.equal(r.payrollReady,false);assert.equal(r.totals.selected.workedUs,0);
});
test('server calls only read RPC with server actor and rejects malformed or confidential errors',async()=>{
  let called=0;const result=await executeAttendanceTimesheet({query:q,authUserId:timesheetOwner},{rpc:async(name,args)=>{
    called++;assert.equal(name,'faolla_attendance_period_report_v2');assert.deepEqual(args,{p_site_id:q.siteId,p_auth_user_id:timesheetOwner,p_query:{workerId:q.workerId,fromDate:q.fromDate,throughDate:q.throughDate}});return {data:{...sheetWire(),sourceVersion:"raw-and-approved-v2"},error:null};}});
  assert.equal(called,1);assert.equal(result.totals.original.workedUs,8*hour);
  await assert.rejects(()=>executeAttendanceTimesheet({query:q,authUserId:timesheetOwner},null),/attendance_unavailable/);
  for(const response of [{data:sheetWire(),error:{message:'private_table_secret'}},{data:{...sheetWire(),complete:false},error:null}])
    await assert.rejects(()=>executeAttendanceTimesheet({query:q,authUserId:timesheetOwner},{rpc:async()=>response}),/attendance_unavailable/);
  await assert.rejects(()=>executeAttendanceTimesheet({query:q as AttendanceTimesheetQuery,authUserId:timesheetOwner},{rpc:async()=>({data:null,error:{message:'attendance_access_denied'}})}),/attendance_access_denied/);
});
test('unsupported long raw shift is a reviewable error, never a partial total or transient outage',async()=>{
  const v=sheetWire();v.sourceVersion="raw-and-approved-v2";v.items[0].events[0].occurredAt='2026-08-01T08:00:00.000000Z';
  await assert.rejects(()=>executeAttendanceTimesheet({query:q,authUserId:timesheetOwner},{rpc:async()=>({data:v,error:null})}),/attendance_session_span_too_long/);
});
