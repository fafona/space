import {createServerSupabaseServiceClient} from "./superAdminServer";
import type {AttendanceSelfRpc} from "./merchantAttendanceSelf.server";
import {ATTENDANCE_SESSION_ERRORS,parseAttendanceSessionResult,type AttendanceSessionQuery} from "./merchantAttendanceSession";
import {MerchantAttendanceError} from "./merchantAttendanceTime";
export type AttendanceSessionInput=AttendanceSessionQuery&{authUserId:string};
export async function executeAttendanceSession(input:AttendanceSessionInput,service:AttendanceSelfRpc|null=createServerSupabaseServiceClient()){
  if(!service)throw new MerchantAttendanceError("attendance_unavailable");
  const result=await service.rpc("faolla_attendance_self_session_v1",{p_site_id:input.siteId,p_auth_user_id:input.authUserId,p_start_event_id:input.startEventId});
  if(result.error){const code=result.error.message??"";throw new MerchantAttendanceError(Object.hasOwn(ATTENDANCE_SESSION_ERRORS,code)?code:"attendance_unavailable");}
  try{return parseAttendanceSessionResult(result.data,input);}catch(error){
    if(error instanceof MerchantAttendanceError&&["attendance_session_too_large","attendance_session_invalid_records","attendance_session_span_too_long"].includes(error.code))throw error;
    throw new MerchantAttendanceError("attendance_unavailable");
  }
}
