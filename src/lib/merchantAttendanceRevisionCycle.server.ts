import {createServerSupabaseServiceClient} from "./superAdminServer";
import type {AttendanceSelfRpc} from "./merchantAttendanceSelf.server";
import {attendanceSelfUuid} from "./merchantAttendanceSelf";
import {MerchantAttendanceError} from "./merchantAttendanceTime";
import {parseAttendanceRevisionQuery,attendanceRevisionQueryString,ATTENDANCE_REVISION_ERRORS,type AttendanceRevisionQuery} from "./merchantAttendanceRevision";
import {parseRevisionCycleCommand,parseRevisionCycleResult,type RevisionCycleCommand} from "./merchantAttendanceRevisionCycle";

// Explicit v2 candidate behind the default-off HTTP gate. Legacy seven-field
// submissions recover by their operation ID; new writes require current source.
export async function executeRevisionCycle(input:{query:AttendanceRevisionQuery;command:RevisionCycleCommand|null;authUserId:string;moduleEnabled:boolean},service:AttendanceSelfRpc|null=createServerSupabaseServiceClient()){
  if(!service)throw new MerchantAttendanceError("attendance_unavailable");
  if(typeof input.moduleEnabled!=="boolean")throw new MerchantAttendanceError("attendance_invalid_request");
  const q=parseAttendanceRevisionQuery("https://local.invalid/?"+attendanceRevisionQueryString(input.query)),c=input.command===null?null:parseRevisionCycleCommand(input.command);
  if(c&&(q.mode!=="detail"||q.operationId!==null||q.requestId!==(c.action==="submit"?c.operationId:c.requestId)))throw new MerchantAttendanceError("attendance_invalid_request");
  let response;const args={p_site_id:q.siteId,p_auth_user_id:attendanceSelfUuid(input.authUserId),
    p_query:{mode:q.mode,expectedWorkerId:q.expectedWorkerId,baseRequestId:q.baseRequestId,requestId:q.requestId,operationId:q.operationId},p_command:c,p_platform_enabled:input.moduleEnabled};
  try{response=await service.rpc("faolla_attendance_revision_self_v2",args);}catch{throw new MerchantAttendanceError("attendance_unavailable");}
  if(response.error){const code=response.error.message??"";throw new MerchantAttendanceError(Object.hasOwn(ATTENDANCE_REVISION_ERRORS,code)||code==="attendance_report_version_required"?code:"attendance_unavailable");}
  try{
    const result=parseRevisionCycleResult(response.data,{...q,operationId:c?.operationId??q.operationId});
    if(!input.moduleEnabled&&result.canSubmit||c&&(!result.receipt||JSON.stringify(result.receipt.command)!==JSON.stringify(c)))throw Error("receipt_mismatch");
    return result;
  }catch{throw new MerchantAttendanceError("attendance_unavailable");}
}
