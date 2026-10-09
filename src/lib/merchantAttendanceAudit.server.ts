import {createServerSupabaseServiceClient} from "./superAdminServer";
import type {AttendanceSelfRpc} from "./merchantAttendanceSelf.server";
import {ATTENDANCE_AUDIT_ERRORS,parseAttendanceAuditResult,type AttendanceAuditQuery} from "./merchantAttendanceAudit";
import {MerchantAttendanceError} from "./merchantAttendanceTime";
export type AttendanceAuditInput=AttendanceAuditQuery&{authUserId:string};
export async function executeAttendanceAudit(input:AttendanceAuditInput,service:AttendanceSelfRpc|null=createServerSupabaseServiceClient()){
  if(!service)throw new MerchantAttendanceError("attendance_unavailable");
  const q=input.mode==="detail"?{mode:input.mode,source:input.source,operationId:input.operationId}:
    {mode:input.mode,source:input.source,fromAt:input.fromAt,toAt:input.toAt,asOf:input.asOf,cursorAt:input.cursorAt,cursorId:input.cursorId};
  const result=await service.rpc("faolla_attendance_audit_v1",{p_site_id:input.siteId,p_auth_user_id:input.authUserId,p_query:q});
  if(result.error){const code=result.error.message??"";throw new MerchantAttendanceError(Object.hasOwn(ATTENDANCE_AUDIT_ERRORS,code)?code:"attendance_unavailable");}
  try{return parseAttendanceAuditResult(result.data,input);}catch{throw new MerchantAttendanceError("attendance_unavailable");}
}
