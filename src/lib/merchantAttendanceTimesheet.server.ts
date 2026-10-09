import {createServerSupabaseServiceClient} from "./superAdminServer";
import type {AttendanceSelfRpc} from "./merchantAttendanceSelf.server";
import {attendanceSelfUuid} from "./merchantAttendanceSelf";
import {MerchantAttendanceError} from "./merchantAttendanceTime";
import {ATTENDANCE_TIMESHEET_ERRORS,attendanceTimesheetQueryString,parseAttendanceTimesheetQuery,parseAttendanceTimesheetResult,type AttendanceTimesheetQuery} from "./merchantAttendanceTimesheet";
import {currentAttendanceReportVersion} from "./merchantAttendanceCurrentReportVersion";
export async function executeAttendanceTimesheet(input:{query:AttendanceTimesheetQuery;authUserId:string},service:AttendanceSelfRpc|null=createServerSupabaseServiceClient()){
  if(!service)throw new MerchantAttendanceError("attendance_unavailable");
  const q=parseAttendanceTimesheetQuery(`https://local.invalid/?${attendanceTimesheetQueryString(input.query)}`),{siteId,...rpcQuery}=q;
  const response=await service.rpc("faolla_attendance_period_report_v2",{p_site_id:siteId,p_auth_user_id:attendanceSelfUuid(input.authUserId),p_query:rpcQuery});
  if(response.error){const code=response.error.message??"";throw new MerchantAttendanceError(Object.hasOwn(ATTENDANCE_TIMESHEET_ERRORS,code)?code:"attendance_unavailable");}
  try{return parseAttendanceTimesheetResult(response.data,q,currentAttendanceReportVersion(response.data));}catch(error){
    // An unsupported raw shift or conflicting selected spans require review,
    // not an endless retry of a fictitious transient outage. Bad wire/scope
    // metadata remains masked and never reaches the caller as partial totals.
    if(error instanceof MerchantAttendanceError&&["attendance_session_invalid_records","attendance_session_span_too_long","attendance_report_overlap"].includes(error.code))throw error;
    throw new MerchantAttendanceError("attendance_unavailable");
  }
}
