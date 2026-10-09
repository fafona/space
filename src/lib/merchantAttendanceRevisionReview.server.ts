import {createServerSupabaseServiceClient} from "./superAdminServer";
import type {AttendanceSelfRpc} from "./merchantAttendanceSelf.server";
import {attendanceSelfUuid} from "./merchantAttendanceSelf";
import {MerchantAttendanceError} from "./merchantAttendanceTime";
import {parseAttendanceRevisionReviewQuery,attendanceRevisionReviewQueryString,parseAttendanceRevisionReviewResult,ATTENDANCE_REVISION_REVIEW_ERRORS,type AttendanceRevisionReviewQuery} from "./merchantAttendanceRevisionReview";
export async function executeAttendanceRevisionReview(input:{query:AttendanceRevisionReviewQuery;authUserId:string},service:AttendanceSelfRpc|null=createServerSupabaseServiceClient()){
  if(!service)throw new MerchantAttendanceError("attendance_unavailable");
  const q=parseAttendanceRevisionReviewQuery("https://local.invalid/?"+attendanceRevisionReviewQueryString(input.query));
  const r=await service.rpc("faolla_attendance_revision_owner_review_v1",{p_site_id:q.siteId,p_auth_user_id:attendanceSelfUuid(input.authUserId),p_request_id:q.requestId});
  if(r.error){const code=r.error.message??"";throw new MerchantAttendanceError(Object.hasOwn(ATTENDANCE_REVISION_REVIEW_ERRORS,code)?code:"attendance_unavailable");}
  try{return parseAttendanceRevisionReviewResult(r.data,q);}catch{throw new MerchantAttendanceError("attendance_unavailable");}
}
