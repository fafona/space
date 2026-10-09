import {attendanceSelfSite,attendanceSelfUuid} from "./merchantAttendanceSelf";
import {attendanceDayUtcRange,MerchantAttendanceError} from "./merchantAttendanceTime";
import {attendanceRecordInstant} from "./merchantAttendanceManagement";
import {ATTENDANCE_TIMESHEET_ERRORS,parseAttendanceTimesheetResult,type AttendanceTimesheetResult,type AttendanceTimesheetSourceVersion} from "./merchantAttendanceTimesheet";

type Period={siteId:string;fromDate:string;throughDate:string};
export type AttendanceScopedTimesheetQuery=Period&({access:"self";expectedWorkerId:string|null}|{access:"manager";workerId:string;locationId:string});
export type AttendanceScopedTimesheetResult=Omit<AttendanceTimesheetResult,"employeeId">&{
  access:"self"|"manager";viewerEmployeeId:string;scopeRevision:number|null;locationId:string|null;
  coverage:"authorized-complete-sessions-v1";accessValidUntil:string|null;
};
const fail=(code="attendance_report_invalid_data"):never=>{throw new MerchantAttendanceError(code);};
const obj=(v:unknown):Record<string,unknown>=>!v||typeof v!=="object"||Array.isArray(v)?fail():v as Record<string,unknown>;
export function attendanceScopedTimesheetQueryString(q:AttendanceScopedTimesheetQuery){
  const p=new URLSearchParams({siteId:q.siteId,access:q.access,fromDate:q.fromDate,throughDate:q.throughDate});
  if(q.access==="manager"){p.set("workerId",q.workerId);p.set("locationId",q.locationId);}
  else if(q.expectedWorkerId!==null)p.set("expectedWorkerId",q.expectedWorkerId);
  return p.toString();
}
export function parseAttendanceScopedTimesheetQuery(url:string):AttendanceScopedTimesheetQuery{
  const p=new URL(url).searchParams,access=p.get("access"),base=["siteId","access","fromDate","throughDate"];
  if(access!=="self"&&access!=="manager")fail("attendance_invalid_request");
  const allowed=[...base,...(access==="self"?["expectedWorkerId"]:["workerId","locationId"])];
  if([...p.keys()].some(k=>!allowed.includes(k)||p.getAll(k).length!==1)||base.some(k=>!p.has(k)))fail("attendance_invalid_request");
  const siteId=attendanceSelfSite(p.get("siteId")),fromDate=p.get("fromDate")!,throughDate=p.get("throughDate")!;
  try{attendanceDayUtcRange(fromDate,"UTC");attendanceDayUtcRange(throughDate,"UTC");}catch{fail("attendance_invalid_request");}
  const distance=Date.parse(throughDate+"T00:00:00Z")-Date.parse(fromDate+"T00:00:00Z");
  if(distance<0||distance>30*86400000)fail("attendance_invalid_request");
  if(access==="self")return {siteId,access,fromDate,throughDate,expectedWorkerId:p.has("expectedWorkerId")?attendanceSelfUuid(p.get("expectedWorkerId")):null};
  return {siteId,access:"manager",fromDate,throughDate,workerId:attendanceSelfUuid(p.get("workerId")),locationId:attendanceSelfUuid(p.get("locationId"))};
}
export function parseAttendanceScopedTimesheetResult(raw:unknown,input:AttendanceScopedTimesheetQuery,sourceVersion:AttendanceTimesheetSourceVersion="raw-and-approved-v1"):AttendanceScopedTimesheetResult{
  const q=parseAttendanceScopedTimesheetQuery(`https://local.invalid/?${attendanceScopedTimesheetQueryString(input)}`),v=obj(raw);
  if(v.access!==q.access||v.coverage!=="authorized-complete-sessions-v1"||!Array.isArray(v.items)||v.items.length>100)fail();
  const viewerEmployeeId=attendanceSelfUuid(v.viewerEmployeeId),workerId=attendanceSelfUuid(v.workerId);
  const accessValidUntil=v.accessValidUntil===null?null:attendanceRecordInstant(v.accessValidUntil);
  if(accessValidUntil!==null&&(accessValidUntil!==v.accessValidUntil||accessValidUntil<=attendanceRecordInstant(v.asOf)))fail();
  let scopeRevision:number|null=null,locationId:string|null=null;
  if(q.access==="self"){
    if(v.employeeId!==viewerEmployeeId||v.scopeRevision!==null||v.locationId!==null||accessValidUntil!==null||(q.expectedWorkerId!==null&&workerId!==q.expectedWorkerId))fail();
  }else{
    if(workerId!==q.workerId||v.locationId!==q.locationId||!Number.isSafeInteger(v.scopeRevision)||Number(v.scopeRevision)<1||Number(v.scopeRevision)>9007199254740990)fail();
    scopeRevision=Number(v.scopeRevision);locationId=q.locationId;
  }
  // Defense in depth on the restricted wire. Never silently filter or publish a
  // partly authorized session; a malformed SQL result is rejected in its entirety.
  for(const raw of v.items as unknown[]){
    const row=obj(raw),events=row.events;if(!Array.isArray(events)||events.length<1||events.length>2002)return fail();
    for(const rawEvent of events){const event=obj(rawEvent);if(q.access==="self"?event.actorEmployeeId!==viewerEmployeeId:event.locationId!==locationId)fail();}
    if(q.access==="self"&&row.effect!==null&&obj(row.effect).employeeId!==viewerEmployeeId)fail();
  }
  const {employeeId,...result}=parseAttendanceTimesheetResult(v,{siteId:q.siteId,workerId,fromDate:q.fromDate,throughDate:q.throughDate},sourceVersion);
  // Target account bindings/actor identities are not part of a manager report.
  if(q.access==="self"&&employeeId!==viewerEmployeeId)fail();
  return {...result,access:q.access,viewerEmployeeId,scopeRevision,locationId,coverage:"authorized-complete-sessions-v1",accessValidUntil};
}
export const ATTENDANCE_SCOPED_TIMESHEET_ERRORS:Readonly<Record<string,number>>={...ATTENDANCE_TIMESHEET_ERRORS,attendance_worker_changed:409};
