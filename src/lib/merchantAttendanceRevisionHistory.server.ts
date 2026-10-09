import {createServerSupabaseServiceClient} from "./superAdminServer";
import type {AttendanceSelfRpc} from "./merchantAttendanceSelf.server";
import {attendanceSelfUuid} from "./merchantAttendanceSelf";
import {MerchantAttendanceError} from "./merchantAttendanceTime";
import {parseRevisionHistoryQuery,parseRevisionHistoryResult,REVISION_HISTORY_ERRORS,type RevisionHistoryQuery} from "./merchantAttendanceRevisionHistory";
// Explicit read-only candidate; migration 098 grants only server-side EXECUTE.
export async function executeRevisionHistory(input:{query:RevisionHistoryQuery;authUserId:string},service:AttendanceSelfRpc|null=createServerSupabaseServiceClient()){
  const q=parseRevisionHistoryQuery(input.query),{siteId,...query}=q;if(!service)throw new MerchantAttendanceError("attendance_unavailable");
  let response;try{response=await service.rpc("faolla_attendance_revision_history_v1",{p_site_id:siteId,p_auth_user_id:attendanceSelfUuid(input.authUserId),p_query:query});}catch{throw new MerchantAttendanceError("attendance_unavailable");}
  if(response.error){const code=response.error.message??"";throw new MerchantAttendanceError(Object.hasOwn(REVISION_HISTORY_ERRORS,code)?code:"attendance_unavailable");}
  try{return parseRevisionHistoryResult(response.data,q);}catch{throw new MerchantAttendanceError("attendance_unavailable");}
}
