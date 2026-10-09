import {createServerSupabaseServiceClient} from "./superAdminServer";
import type {AttendanceSelfRpc} from "./merchantAttendanceSelf.server";
import {attendanceSelfUuid} from "./merchantAttendanceSelf";
import {MerchantAttendanceError} from "./merchantAttendanceTime";
import type {AttendanceRevisionReviewQuery} from "./merchantAttendanceRevisionReview";
import {parseRevisionDecisionCommand,parseRevisionDecisionQuery,revisionDecisionReceiptMatches,type RevisionDecisionCommand,type RevisionDecisionQuery} from "./merchantAttendanceRevisionDecision";
import {parseRevisionApprovalReviewQuery,parseRevisionApprovalReview,parseRevisionApprovalResult,REVISION_APPROVAL_ERRORS} from "./merchantAttendanceRevisionApproval";

// Candidate executors behind explicit default-off HTTP gates. Migration 098
// grants only the server role; internal helpers and browser roles stay private.
async function call(service:AttendanceSelfRpc|null,name:string,args:Record<string,unknown>){
  if(!service)throw new MerchantAttendanceError("attendance_unavailable");
  let response;
  try{response=await service.rpc(name,args);}catch{throw new MerchantAttendanceError("attendance_unavailable");}
  if(response.error){const code=response.error.message??"";throw new MerchantAttendanceError(Object.hasOwn(REVISION_APPROVAL_ERRORS,code)?code:"attendance_unavailable");}
  return response.data;
}
export async function executeRevisionApprovalReview(input:{query:AttendanceRevisionReviewQuery;authUserId:string},service:AttendanceSelfRpc|null=createServerSupabaseServiceClient()){
  const q=parseRevisionApprovalReviewQuery(input.query);
  const data=await call(service,"faolla_attendance_revision_owner_review_v3",{p_site_id:q.siteId,p_auth_user_id:attendanceSelfUuid(input.authUserId),p_request_id:q.requestId});
  try{return parseRevisionApprovalReview(data,q);}catch{throw new MerchantAttendanceError("attendance_unavailable");}
}
export async function executeRevisionDecision(input:{query:RevisionDecisionQuery;command:RevisionDecisionCommand|null;authUserId:string;allowWrite:boolean},service:AttendanceSelfRpc|null=createServerSupabaseServiceClient()){
  const q=parseRevisionDecisionQuery(input.query);
  if(typeof input.allowWrite!=="boolean"||input.command!==null&&(!input.command||typeof input.command!=="object"||Array.isArray(input.command)||Object.hasOwn(input.command,"siteId")))throw new MerchantAttendanceError("attendance_invalid_request");
  const c=input.command===null?null:parseRevisionDecisionCommand({siteId:q.siteId,...input.command}).command;
  if(c&&(q.operationId!==null||q.requestId!==c.requestId))throw new MerchantAttendanceError("attendance_invalid_request");
  const data=await call(service,"faolla_attendance_revision_decide_v2",{p_site_id:q.siteId,p_auth_user_id:attendanceSelfUuid(input.authUserId),p_request_id:q.requestId,
    p_command:c,p_operation_id:q.operationId,p_allow_write:input.allowWrite});
  try{
    const result=parseRevisionApprovalResult(data,{...q,operationId:c?.operationId??q.operationId});
    if(result.writeEnabled!==input.allowWrite||c&&(!result.receipt||!revisionDecisionReceiptMatches(c,result.receipt))||!c&&(result.effectiveChanged||result.receipt&&!result.replayed))throw Error("receipt_mismatch");
    return result;
  }catch{throw new MerchantAttendanceError("attendance_unavailable");}
}
