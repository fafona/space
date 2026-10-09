import {createServerSupabaseServiceClient} from "./superAdminServer";
import type {AttendanceSelfRpc} from "./merchantAttendanceSelf.server";
import {attendanceSelfUuid} from "./merchantAttendanceSelf";
import {MerchantAttendanceError} from "./merchantAttendanceTime";
import {CORRECTION_DECISION_ERRORS,correctionDecisionQueryString,parseCorrectionDecisionQuery,parseCorrectionDecisionCommand,parseCorrectionDecisionResult,
  correctionDecisionReceiptMatches,type CorrectionDecisionQuery,type CorrectionDecisionCommand} from "./merchantAttendanceCorrectionDecision";
export async function executeCorrectionDecision(input:{query:CorrectionDecisionQuery;command:CorrectionDecisionCommand|null;authUserId:string;allowWrite:boolean},service:AttendanceSelfRpc|null=createServerSupabaseServiceClient()){
  if(!service)throw new MerchantAttendanceError("attendance_unavailable");
  const q=parseCorrectionDecisionQuery(`https://local.invalid/?${correctionDecisionQueryString(input.query)}`);
  const c=input.command?parseCorrectionDecisionCommand({siteId:q.siteId,...input.command}).command:null;
  if(c&&(q.operationId!==null||q.requestId!==c.requestId))throw new MerchantAttendanceError("attendance_invalid_request");
  const result=await service.rpc("faolla_attendance_correction_decide_v1",{p_site_id:q.siteId,p_auth_user_id:attendanceSelfUuid(input.authUserId),p_request_id:q.requestId,
    p_command:c,p_operation_id:q.operationId,p_allow_write:input.allowWrite});
  if(result.error){const code=result.error.message??"";throw new MerchantAttendanceError(Object.hasOwn(CORRECTION_DECISION_ERRORS,code)?code:"attendance_unavailable");}
  try{const r=parseCorrectionDecisionResult(result.data,{...q,operationId:c?.operationId??q.operationId});
    if(c&&(!r.receipt||!correctionDecisionReceiptMatches(c,r.receipt)))throw Error("receipt_mismatch");return r;
  }catch{throw new MerchantAttendanceError("attendance_unavailable");}
}
