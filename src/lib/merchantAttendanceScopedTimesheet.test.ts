import assert from "node:assert/strict";
import test from "node:test";
import {attendanceScopedTimesheetQueryString,parseAttendanceScopedTimesheetQuery,parseAttendanceScopedTimesheetResult,type AttendanceScopedTimesheetQuery} from "./merchantAttendanceScopedTimesheet";
import {executeAttendanceScopedTimesheet} from "./merchantAttendanceScopedTimesheet.server";
import {scopedSelfQuery as self,scopedManagerQuery as manager,scopedSheetWire,scopedViewer,scopedManager} from "../../scripts/fixtures/attendance-scoped-timesheet-model";
import {timesheetId as id,timesheetOwner,sheetEffect} from "../../scripts/fixtures/attendance-timesheet-model";
const parse=(q:AttendanceScopedTimesheetQuery)=>parseAttendanceScopedTimesheetQuery(`https://local.invalid/?${attendanceScopedTimesheetQueryString(q)}`);
test("self cannot choose a worker; expected binding is only a continuity precondition",()=>{
  assert.deepEqual(parse(self),self);assert.deepEqual(parse({...self,access:"self",expectedWorkerId:id(4)}),{...self,expectedWorkerId:id(4)});
  const url=`https://local.invalid/?${attendanceScopedTimesheetQueryString(self)}`;
  for(const suffix of ["&workerId="+id(8),"&locationId="+id(8),"&viewerEmployeeId="+id(8),"&access=manager","&scopeRevision=1","&asOf=now","&authUserId="+timesheetOwner,"&timeZone=UTC"])
    assert.throws(()=>parseAttendanceScopedTimesheetQuery(url+suffix));
});
test("manager must supply one exact pair, no owner mode or partial axes",()=>{
  assert.deepEqual(parse(manager),manager);const url=`https://local.invalid/?${attendanceScopedTimesheetQueryString(manager)}`;
  for(const value of [url.replace("access=manager","access=owner"),url.replace("&workerId="+id(4),""),url.replace("&locationId="+id(5),""),url+"&expectedWorkerId="+id(4),url+"&locationId="+id(8)])assert.throws(()=>parseAttendanceScopedTimesheetQuery(value));
});
test("calendar range strictly supports at most 31 dates including DST periods",()=>{
  for(const q of [{...self,fromDate:"2026-09-31"},{...manager,throughDate:"2026-10-02"},{...self,throughDate:"2026-08-30"},{...self,throughDate:"2101-01-01"}])assert.throws(()=>parse(q));
  assert.doesNotThrow(()=>parse({...manager,fromDate:"2026-10-01",throughDate:"2026-10-31"}));
});
test("self and manager have explicit subset coverage and no target account binding in output",()=>{
  for(const q of [self,manager]){
    const wire=scopedSheetWire(q.access),before=structuredClone(wire),r=parseAttendanceScopedTimesheetResult(wire,q);
    assert.deepEqual(wire,before);assert.equal(r.totals.selected.workedUs,8*3600000000);assert.equal(r.coverage,"authorized-complete-sessions-v1");assert.equal("employeeId" in r,false);
    assert.equal(JSON.stringify(r).includes("actorEmployeeId"),false);assert.equal(r.viewerEmployeeId,q.access==="self"?scopedViewer:scopedManager);
  }
});
test("old attribution, nullable legacy actor or mixed identity fails the whole self response",()=>{
  for(const actorEmployeeId of [null,id(3)]){const wire=scopedSheetWire();wire.items[0].events[1].actorEmployeeId=actorEmployeeId;assert.throws(()=>parseAttendanceScopedTimesheetResult(wire,self));}
  const wire=scopedSheetWire();wire.employeeId=id(3);assert.throws(()=>parseAttendanceScopedTimesheetResult(wire,self));
  assert.throws(()=>parseAttendanceScopedTimesheetResult(scopedSheetWire(),{...self,access:"self",expectedWorkerId:id(8)}));
});
test("manager rejects any foreign-location event, mismatched target or missing scope revision",()=>{
  const wire=scopedSheetWire("manager");wire.items[0].events[1].locationId=id(9);assert.throws(()=>parseAttendanceScopedTimesheetResult(wire,manager));
  for(const patch of [{scopeRevision:0},{scopeRevision:null},{locationId:id(6)},{workerId:id(8)},{coverage:"full-person"},{access:"owner"}])assert.throws(()=>parseAttendanceScopedTimesheetResult({...scopedSheetWire("manager"),...patch},manager));
});
test("approved effect must retain self employee lineage, not just target worker",()=>{
  const wire=scopedSheetWire();wire.items[0].effect={...sheetEffect({startAt:"2026-09-05T08:00:00.000000Z",endAt:"2026-09-05T17:00:00.000000Z",breaks:[]}),employeeId:scopedViewer};
  assert.equal(parseAttendanceScopedTimesheetResult(wire,self).totals.difference.workedUs,3600000000);wire.items[0].effect.employeeId=id(3);assert.throws(()=>parseAttendanceScopedTimesheetResult(wire,self));
});
test("scope expiry is canonical, future relative to snapshot, and forbidden for self",()=>{
  const wire=scopedSheetWire("manager");wire.accessValidUntil="2026-10-01T00:00:00.000000Z";assert.equal(parseAttendanceScopedTimesheetResult(wire,manager).accessValidUntil,wire.accessValidUntil);
  for(const end of [wire.asOf,"2026-01-01T00:00:00.000000Z","bad","2026-10-01T00:00:00.000Z"]){wire.accessValidUntil=end;assert.throws(()=>parseAttendanceScopedTimesheetResult(wire,manager));}
  assert.throws(()=>parseAttendanceScopedTimesheetResult({...scopedSheetWire(),accessValidUntil:"2026-10-01T00:00:00.000000Z"},self));
});
test("server uses only scoped RPC, authenticated principal and null target identity for self",async()=>{
  for(const q of [self,manager]){const calls:unknown[]=[];
    const r=await executeAttendanceScopedTimesheet({query:q,authUserId:timesheetOwner},{rpc:async(name,args)=>{calls.push({name,args});return {data:{...scopedSheetWire(q.access),sourceVersion:"raw-and-approved-v2"},error:null};}});
    assert.equal(r.access,q.access);assert.deepEqual(calls,[{name:"faolla_attendance_scoped_period_report_v2",args:{p_site_id:q.siteId,p_auth_user_id:timesheetOwner,
      p_query:{access:q.access,fromDate:q.fromDate,throughDate:q.throughDate,workerId:q.access==="manager"?q.workerId:null,locationId:q.access==="manager"?q.locationId:null,expectedWorkerId:null}}}]);
  }
});
test("server masks arbitrary SQL/invalid evidence, preserves rebind and boundary errors",async()=>{
  for(const [message,expected] of [["secret SQL", "attendance_unavailable"],["attendance_worker_changed","attendance_worker_changed"],["attendance_access_denied","attendance_access_denied"],["attendance_report_too_large","attendance_report_too_large"]]){
    await assert.rejects(()=>executeAttendanceScopedTimesheet({query:self,authUserId:timesheetOwner},{rpc:async()=>({data:null,error:{message}})}),new RegExp(expected));
  }
  await assert.rejects(()=>executeAttendanceScopedTimesheet({query:self,authUserId:timesheetOwner},{rpc:async()=>({data:scopedSheetWire("manager"),error:null})}),/attendance_unavailable/);
  await assert.rejects(()=>executeAttendanceScopedTimesheet({query:self,authUserId:timesheetOwner},null),/attendance_unavailable/);
});
