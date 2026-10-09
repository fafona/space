import {parseAttendanceTimesheetComputedResponse} from "./merchantAttendanceTimesheetResponse";
import {attendanceSelfUuid} from "./merchantAttendanceSelf";
import {attendanceRecordInstant} from "./merchantAttendanceManagement";
import type {AttendanceScopedTimesheetQuery,AttendanceScopedTimesheetResult} from "./merchantAttendanceScopedTimesheet";
import type {AttendanceTimesheetSourceVersion} from "./merchantAttendanceTimesheet";
export function parseScopedTimesheetResponse(raw:unknown,q:AttendanceScopedTimesheetQuery,viewerEmployeeId:string,sourceVersion:AttendanceTimesheetSourceVersion="raw-and-approved-v1"):AttendanceScopedTimesheetResult&{moduleEnabled:boolean}{
  const fail=():never=>{throw Error("attendance_report_invalid_data");};
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return fail();
  const v=raw as Record<string,unknown>;
  if(v.access!==q.access||v.viewerEmployeeId!==attendanceSelfUuid(viewerEmployeeId)||v.coverage!=="authorized-complete-sessions-v1"||"employeeId" in v)return fail();
  const workerId=attendanceSelfUuid(v.workerId);
  if(q.access==="self"&&q.expectedWorkerId!==null&&q.expectedWorkerId!==workerId)return fail();
  if(q.access==="manager"&&(q.workerId!==workerId||v.locationId!==q.locationId||!Number.isSafeInteger(v.scopeRevision)||Number(v.scopeRevision)<1||Number(v.scopeRevision)>9007199254740990))return fail();
  if(q.access==="self"&&(v.scopeRevision!==null||v.locationId!==null||v.accessValidUntil!==null))return fail();
  const result=parseAttendanceTimesheetComputedResponse(v,{siteId:q.siteId,workerId,fromDate:q.fromDate,throughDate:q.throughDate},sourceVersion);
  const accessValidUntil=v.accessValidUntil===null?null:attendanceRecordInstant(v.accessValidUntil);
  if(accessValidUntil!==null&&(accessValidUntil!==v.accessValidUntil||accessValidUntil<=result.asOf))return fail();
  return {...result,access:q.access,viewerEmployeeId,coverage:"authorized-complete-sessions-v1",scopeRevision:q.access==="manager"?Number(v.scopeRevision):null,
    locationId:q.access==="manager"?q.locationId:null,accessValidUntil};
}
