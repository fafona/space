import {createServerSupabaseServiceClient} from "./superAdminServer";
import type {AttendanceSelfRpc} from "./merchantAttendanceSelf.server";
import {attendanceSelfUuid} from "./merchantAttendanceSelf";
import {MerchantAttendanceError} from "./merchantAttendanceTime";
import {ATTENDANCE_SCOPED_TIMESHEET_ERRORS} from "./merchantAttendanceScopedTimesheet";
import {parseScopedContext,parseScopedContextQuery,scopedContextQueryString,type ScopedContextQuery} from "./merchantAttendanceScopedTimesheetContext";
export const SCOPED_CONTEXT_ERRORS:Readonly<Record<string,number>>={...ATTENDANCE_SCOPED_TIMESHEET_ERRORS,attendance_version_conflict:409};
export async function executeScopedContext(input:{query:ScopedContextQuery;authUserId:string},service:AttendanceSelfRpc|null=createServerSupabaseServiceClient()){
  if(!service)throw new MerchantAttendanceError("attendance_unavailable");
  const q=parseScopedContextQuery("https://local.invalid/?"+scopedContextQueryString(input.query));
  const {data,error}=await service.rpc("faolla_attendance_scoped_report_context_v1",{p_site_id:q.siteId,p_auth_user_id:attendanceSelfUuid(input.authUserId),
    p_query:{access:q.access,search:q.search,cursor:q.cursor,scopeRevision:q.scopeRevision}});
  if(error)throw new MerchantAttendanceError(Object.hasOwn(SCOPED_CONTEXT_ERRORS,error.message??"")?error.message!:"attendance_unavailable");
  try{return parseScopedContext(data,q);}catch{throw new MerchantAttendanceError("attendance_unavailable");}
}
