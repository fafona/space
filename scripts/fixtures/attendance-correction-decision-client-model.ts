import {decisionResponse,decisionCommand,decisionQuery,decisionAt,decisionAsOf,currentDecisionResult} from "./attendance-correction-decision-model";
import {parseCorrectionDecisionCommand,type CorrectionDecisionCommand} from "../../src/lib/merchantAttendanceCorrectionDecision";
import type {AttendanceApiFetch} from "../../src/lib/merchantAttendanceSelfClient";
import {correctionRules} from "./attendance-correction-model";
// In-memory synthetic transport only. Does not claim SQL/HTTP/authentication/race validation.
export function createDecisionClientFixture(){
  let mode="normal",writes=0,committed:CorrectionDecisionCommand|null=null;
  const calls:{path:string;method:string;body:string|null}[]=[];
  const fail=(error:string,status:number)=>Response.json({ok:false,error},{status});
  const value=(operationId:string|null,fresh=false)=>{
    const r=decisionResponse(committed?.action??null,false);
    if(committed){r.decision={requestId:committed.requestId,operationId:committed.operationId,requestRevision:committed.expectedRevision,
      evidenceToken:committed.expectedEvidence,reason:committed.reason,action:committed.action,recordedAt:decisionAt};
      r.receipt=operationId===committed.operationId&&mode!=="receipt_hidden"?r.decision:null;
      if(r.effective)r.effective.operationId=committed.operationId;
    }else{
      if(mode==="changed"){r.evidenceToken="f".repeat(32);}
      if(mode==="legacy"){r.review.application.rules=correctionRules("legacy");r.blockers=["rule_legacy_unbound"];r.canApprove=false;}
      if(mode==="blocked"){r.blockers=["effective_overlap"];r.canApprove=false;}
      if(mode==="withdrawn"){r.review.item.status=r.review.application.item.status="withdrawn";r.review.item.revision=r.review.application.item.revision=2;
        r.review.asOf=r.review.application.asOf=r.review.evidence.currentBasis!.asOf=decisionAsOf;r.review.application.rules!.checkedAt=decisionAsOf;
        r.review.application.withdrawal={reason:"员工已撤回",recordedAt:decisionAt};r.blockers=["withdrawn"];r.canApprove=r.canReject=false;}
    }
    if(mode==="paused")r.canApprove=r.canReject=false;
    return {ok:true,moduleEnabled:mode!=="paused",...currentDecisionResult(r,{writeEnabled:mode!=="paused",fresh,revision:mode==="revised"?6:1,otherRoot:mode==="other_root"})};
  };
  const apiFetch:AttendanceApiFetch=async(path,init)=>{
    const method=init?.method??"GET",body=typeof init?.body==="string"?init.body:null;calls.push({path,method,body});
    const url=new URL(path,"https://synthetic.invalid");
    if(url.pathname!=="/api/merchant-enterprise/attendance/correction-decisions")throw Error("synthetic_route_missing");
    if(mode==="offline")throw Error("network_unavailable");if(mode==="denied")return fail("attendance_access_denied",403);
    if(mode==="not_found")return fail("attendance_correction_not_found",404);
    if(method==="GET"){
      if(url.searchParams.get("siteId")!==decisionQuery.siteId||url.searchParams.get("requestId")!==decisionQuery.requestId)return fail("attendance_correction_not_found",404);
      return Response.json(value(url.searchParams.get("operationId")));
    }
    if(method!=="POST")throw Error("synthetic_method_forbidden");
    const parsed=parseCorrectionDecisionCommand(JSON.parse(body!)),c=parsed.command;
    if(parsed.siteId!==decisionQuery.siteId||c.requestId!==decisionQuery.requestId)return fail("attendance_correction_not_found",404);
    if(mode==="unsent")throw Error("request_not_delivered");
    const fresh=!committed;
    if(committed){if(JSON.stringify(committed)!==JSON.stringify(c))return fail(committed.operationId===c.operationId?"attendance_operation_conflict":"attendance_correction_decided",409);}
    else{
      if(mode==="paused")return fail("attendance_platform_paused",403);
      if(mode==="withdrawn")return fail("attendance_version_conflict",409);
      if(mode==="changed"||c.expectedEvidence!==decisionCommand.expectedEvidence)return fail("attendance_correction_evidence_changed",409);
      if(["blocked","legacy"].includes(mode)&&c.action==="approve")return fail("attendance_correction_decision_blocked",409);
      committed=c;writes++;if(mode==="lost")throw Error("committed_response_lost");
    }
    return Response.json(value(c.operationId,fresh));
  };
  return {apiFetch,calls,mode:(next:string)=>{mode=next;},writes:()=>writes,value,committed:()=>committed,
    otherDecision:()=>{committed={...decisionCommand,operationId:"00000000-0000-4000-8000-000000000999",action:"reject"};writes++;}};
}
