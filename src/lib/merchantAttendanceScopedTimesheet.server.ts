import {createServerSupabaseServiceClient} from "./superAdminServer";
import type {AttendanceSelfRpc} from "./merchantAttendanceSelf.server";
import {attendanceSelfUuid} from "./merchantAttendanceSelf";
import {MerchantAttendanceError} from "./merchantAttendanceTime";
import {currentAttendanceReportVersion} from "./merchantAttendanceCurrentReportVersion";
import {ATTENDANCE_SCOPED_TIMESHEET_ERRORS,attendanceScopedTimesheetQueryString,parseAttendanceScopedTimesheetQuery,parseAttendanceScopedTimesheetResult,type AttendanceScopedTimesheetQuery} from "./merchantAttendanceScopedTimesheet";
export async function executeAttendanceScopedTimesheet(input:{query:AttendanceScopedTimesheetQuery;authUserId:string},service:AttendanceSelfRpc|null=createServerSupabaseServiceClient()){
  if(!service)throw new MerchantAttendanceError("attendance_unavailable");
  const q=parseAttendanceScopedTimesheetQuery(`https://local.invalid/?${attendanceScopedTimesheetQueryString(input.query)}`);
  const response=await service.rpc("faolla_attendance_scoped_period_report_v2",{p_site_id:q.siteId,p_auth_user_id:attendanceSelfUuid(input.authUserId),p_query:{
    access:q.access,fromDate:q.fromDate,throughDate:q.throughDate,workerId:q.access==="manager"?q.workerId:null,
    locationId:q.access==="manager"?q.locationId:null,expectedWorkerId:q.access==="self"?q.expectedWorkerId:null}});
  if(response.error){const code=response.error.message??"";throw new MerchantAttendanceError(Object.hasOwn(ATTENDANCE_SCOPED_TIMESHEET_ERRORS,code)?code:"attendance_unavailable");}
  try{return parseAttendanceScopedTimesheetResult(response.data,q,currentAttendanceReportVersion(response.data));}catch(e){
    if(e instanceof MerchantAttendanceError&&["attendance_session_invalid_records","attendance_session_span_too_long","attendance_report_overlap"].includes(e.code))throw e;
    throw new MerchantAttendanceError("attendance_unavailable");
  }
}
