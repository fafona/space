import {createServerSupabaseServiceClient} from "./superAdminServer";
import type {AttendanceSelfRpc} from "./merchantAttendanceSelf.server";
import {attendanceSelfUuid} from "./merchantAttendanceSelf";
import {MerchantAttendanceError} from "./merchantAttendanceTime";
import {parseCorrectionDecisionQuery,correctionDecisionQueryString,parseCorrectionDecisionCommand,correctionDecisionReceiptMatches,type CorrectionDecisionQuery,type CorrectionDecisionCommand} from "./merchantAttendanceCorrectionDecision";
import {parseCurrentCorrectionDecision,CURRENT_CORRECTION_ERRORS} from "./merchantAttendanceCurrentCorrectionDecision";

// Candidate HTTP entry remains explicitly gated; migration 096 grants no role.
export async function executeCurrentCorrectionDecision(input:{query:CorrectionDecisionQuery;command:CorrectionDecisionCommand|null;authUserId:string;allowWrite:boolean},service:AttendanceSelfRpc|null=createServerSupabaseServiceClient()){
  const q=parseCorrectionDecisionQuery("https://local.invalid/?"+correctionDecisionQueryString(input.query));
  if(typeof input.allowWrite!=="boolean"||input.command!==null&&(!input.command||typeof input.command!=="object"||Array.isArray(input.command)||Object.hasOwn(input.command,"siteId")))throw new MerchantAttendanceError("attendance_invalid_request");
  const c=input.command===null?null:parseCorrectionDecisionCommand({siteId:q.siteId,...input.command}).command;
  if(c&&(q.operationId!==null||c.requestId!==q.requestId))throw new MerchantAttendanceError("attendance_invalid_request");
  if(!service)throw new MerchantAttendanceError("attendance_unavailable");
  const args={p_site_id:q.siteId,p_auth_user_id:attendanceSelfUuid(input.authUserId),p_request_id:q.requestId,p_command:c,p_operation_id:q.operationId,p_allow_write:input.allowWrite};
  let response;try{response=await service.rpc("faolla_attendance_correction_decide_v2",args);}catch{throw new MerchantAttendanceError("attendance_unavailable");}
  if(response.error){const code=response.error.message??"";throw new MerchantAttendanceError(Object.hasOwn(CURRENT_CORRECTION_ERRORS,code)?code:"attendance_unavailable");}
  try{
    const r=parseCurrentCorrectionDecision(response.data,{...q,operationId:c?.operationId??q.operationId});
    if(r.writeEnabled!==input.allowWrite||c&&(!r.receipt||!correctionDecisionReceiptMatches(c,r.receipt))||!c&&(r.effectiveChanged||r.receipt&&!r.replayed))throw Error("receipt_mismatch");return r;
  }catch{throw new MerchantAttendanceError("attendance_unavailable");}
}
