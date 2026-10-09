import {revisionApprovalResponse,recoverRevisionApproval} from "./attendance-revision-approval-model";
import {correctionId as id} from "./attendance-correction-model";
import {parseRevisionDecisionCommand,type RevisionDecisionCommand} from "../../src/lib/merchantAttendanceRevisionDecision";
import type {AttendanceApiFetch} from "../../src/lib/merchantAttendanceSelfClient";
// Synthetic transport only: browser/client tests, not authentication or SQL evidence.
export function revisionApprovalModel(){
  let mode="normal",committed:RevisionDecisionCommand|null=null,writes=0;
  const calls:{method:string;path:string;body:string|null}[]=[],baseline=revisionApprovalResponse();
  const value=(operationId:string|null,fresh=false)=>{
    let r=revisionApprovalResponse(committed?.action??null);
    if(committed){
      r.decision={...r.decision!,operationId:committed.operationId,reason:committed.reason,evidenceToken:committed.expectedEvidence,command:structuredClone(committed)};
      if(committed.action==="approve")r.current.operationId=committed.operationId;
      r.receipt=structuredClone(r.decision);
      if(!fresh)r=recoverRevisionApproval(r,mode==="advanced");
      if(operationId!==committed.operationId||mode==="receipt_hidden"){r.receipt=null;r.replayed=false;}
    }else{
      if(mode==="blocked"){r.review.blockers=["effective_overlap"];r.review.checksPassed=false;r.blockers=["effective_overlap"];r.canApprove=false;}
      if(mode==="changed")r.evidenceToken="f".repeat(32);
      if(mode==="withdrawn"){
        const a=r.review.review.application;r.review.requestState="withdrawn";r.review.pendingRequestId=null;r.review.ledgerRevision++;
        r.review.review.item.status=a.item.status="withdrawn";r.review.review.item.revision=a.item.revision=r.review.ledgerRevision;
        a.withdrawal={reason:"合成员工已撤回",recordedAt:"2026-09-30T14:01:00.000000Z"};
        r.review.asOf=r.review.review.asOf=a.asOf=a.rules!.checkedAt=r.review.review.evidence.currentBasis!.asOf=r.asOf;
        r.review.blockers=r.blockers=["withdrawn"];r.review.checksPassed=r.review.rejectionChecksPassed=r.canApprove=r.canReject=false;
      }
    }
    r.writeEnabled=mode!=="paused";
    if(!r.writeEnabled)r.canApprove=r.canReject=false;
    return {ok:true,...r,moduleEnabled:r.writeEnabled};
  };
  const fail=(error:string,status=409)=>Response.json({ok:false,error},{status});
  const apiFetch:AttendanceApiFetch=async(path,init)=>{
    const method=init?.method??"GET",body=typeof init?.body==="string"?init.body:null;calls.push({method,path,body});
    const u=new URL(path,"https://synthetic.invalid");if(u.pathname!=="/api/merchant-enterprise/attendance/revision-decisions")throw Error("unexpected_route");
    if(mode==="offline")throw Error("offline");if(mode==="denied")return fail("attendance_access_denied",403);if(mode==="not_found")return fail("attendance_correction_not_found",404);
    if(method==="GET"){
      if(u.searchParams.get("siteId")!==baseline.siteId||u.searchParams.get("requestId")!==baseline.requestId)return fail("attendance_correction_not_found",404);
      return Response.json(value(u.searchParams.get("operationId")));
    }
    if(method!=="POST")throw Error("unexpected_method");const {siteId,command:c}=parseRevisionDecisionCommand(JSON.parse(body!));
    if(siteId!==baseline.siteId||c.requestId!==baseline.requestId)return fail("attendance_correction_not_found",404);
    if(mode==="unsent")throw Error("not_delivered");const fresh=!committed;
    if(committed){if(JSON.stringify(c)!==JSON.stringify(committed))return fail(committed.operationId===c.operationId?"attendance_operation_conflict":"attendance_correction_decided");}
    else{
      if(mode==="paused")return fail("attendance_platform_paused",403);
      if(mode==="withdrawn")return fail("attendance_version_conflict");
      if(mode==="changed"||c.expectedEvidence!==baseline.evidenceToken)return fail("attendance_correction_evidence_changed");
      if(c.expectedBaseOperationId!==baseline.review.base.operationId)return fail("attendance_revision_base_changed");
      if(mode==="blocked"&&c.action==="approve")return fail("attendance_correction_decision_blocked");
      committed=c;writes++;if(mode==="lost")throw Error("committed_reply_lost");
    }
    return Response.json(value(c.operationId,fresh));
  };
  return {apiFetch,calls,value,mode:(next:string)=>{mode=next;},writes:()=>writes,committed:()=>committed,
    otherDecision:()=>{committed={...revisionApprovalResponse("reject").decision!.command,operationId:id(999)};writes++;}};
}
