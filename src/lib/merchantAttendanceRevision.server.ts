import {createServerSupabaseServiceClient} from "./superAdminServer";
import type {AttendanceSelfRpc} from "./merchantAttendanceSelf.server";
import {attendanceSelfUuid} from "./merchantAttendanceSelf";
import {MerchantAttendanceError} from "./merchantAttendanceTime";
import {parseAttendanceRevisionInput,parseAttendanceRevisionQuery,attendanceRevisionQueryString,parseAttendanceRevisionResult,ATTENDANCE_REVISION_ERRORS,type AttendanceRevisionCommand,type AttendanceRevisionQuery} from "./merchantAttendanceRevision";
export async function executeAttendanceRevision(input:{query:AttendanceRevisionQuery;command:AttendanceRevisionCommand|null;authUserId:string;moduleEnabled:boolean},service:AttendanceSelfRpc|null=createServerSupabaseServiceClient()){
  if(!service)throw new MerchantAttendanceError("attendance_unavailable");
  const q=parseAttendanceRevisionQuery("https://local.invalid/?"+attendanceRevisionQueryString(input.query));
  const command=input.command?parseAttendanceRevisionInput({siteId:q.siteId,expectedWorkerId:q.expectedWorkerId,baseRequestId:q.baseRequestId,command:input.command}).command:null;
  if(command&&(q.mode!=="detail"||q.operationId!==null||q.requestId!==(command.action==="submit"?command.operationId:command.requestId)))throw new MerchantAttendanceError("attendance_invalid_request");
  const response=await service.rpc("faolla_attendance_revision_self_v1",{p_site_id:q.siteId,p_auth_user_id:attendanceSelfUuid(input.authUserId),
    p_query:{mode:q.mode,expectedWorkerId:q.expectedWorkerId,baseRequestId:q.baseRequestId,requestId:q.requestId,operationId:q.operationId},p_command:command,p_platform_enabled:input.moduleEnabled});
  if(response.error){const code=response.error.message??"";throw new MerchantAttendanceError(Object.hasOwn(ATTENDANCE_REVISION_ERRORS,code)?code:"attendance_unavailable");}
  try{
    const result=parseAttendanceRevisionResult(response.data,{...q,operationId:command?.operationId??q.operationId});
    if(!input.moduleEnabled&&result.canSubmit||command&&(!result.receipt||JSON.stringify(result.receipt.command)!==JSON.stringify(command)))throw Error("receipt_mismatch");
    return result;
  }catch{throw new MerchantAttendanceError("attendance_unavailable");}
}
