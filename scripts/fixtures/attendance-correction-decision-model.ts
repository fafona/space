import {correctionReviewDetail,reviewQuery} from "./attendance-correction-review-model";
import {correctionId} from "./attendance-correction-model";
import type {CorrectionDecisionCommand,CorrectionDecisionResult} from "../../src/lib/merchantAttendanceCorrectionDecision";
import type {RevisionCycleEffect} from "../../src/lib/merchantAttendanceRevisionCycle";
import {previewCorrection} from "../../src/lib/merchantAttendanceCorrection";
import {parseCurrentCorrectionDecision} from "../../src/lib/merchantAttendanceCurrentCorrectionDecision";
// Pure synthetic response builders, not a database/authorization/concurrency simulation.
export const decisionQuery={siteId:reviewQuery.siteId,requestId:reviewQuery.requestId,operationId:null};
export const decisionOwner=correctionId(1);
export const decisionCommand:CorrectionDecisionCommand={requestId:reviewQuery.requestId,operationId:correctionId(200),action:"approve",expectedRevision:1,
  expectedEvidence:"0123456789abcdef0123456789abcdef",reason:"已核对声明及原始记录"};
export const decisionAt="2026-09-30T12:00:01.000001Z",decisionAsOf="2026-09-30T12:00:02.000002Z";
export function decisionResponse(action:"approve"|"reject"|null=null,receipt=false):CorrectionDecisionResult{
  const review=correctionReviewDetail();
  const decision=action?{requestId:decisionCommand.requestId,operationId:decisionCommand.operationId,action,requestRevision:1,
    evidenceToken:decisionCommand.expectedEvidence,reason:decisionCommand.reason,recordedAt:decisionAt}:null;
  return {siteId:decisionQuery.siteId,asOf:decisionAsOf,review,evidenceToken:decisionCommand.expectedEvidence,
    blockers:action?["already_decided"]:[],canApprove:!action,canReject:!action,decision,receipt:receipt?decision:null,timesheetIntegrated:false,
    effective:action==="approve"?{requestId:decisionQuery.requestId,operationId:decisionCommand.operationId,revision:1,policyRevision:1,
      proposal:structuredClone(review.application.proposal),timeZone:"Europe/Madrid",calculationVersion:"declaration-v1",
      elapsedUs:32400000000,workedUs:30600000000,breakUs:1800000000,paidBreakUs:0,recordedAt:decisionAt}:null};
}
// Synthetic v2 summaries only; this does not simulate database approvals.
export function currentDecisionResult(initial=decisionResponse(),options:{writeEnabled?:boolean;fresh?:boolean;revision?:number;otherRoot?:boolean}={}){
  const {timesheetIntegrated,...r}=structuredClone(initial);void timesheetIntegrated;
  const writeEnabled=options.writeEnabled??true,e=r.effective??(options.otherRoot?decisionResponse("approve").effective:null),b=r.review.application.basis;
  let current:RevisionCycleEffect|null=e?{...e,action:"approve",originalLastEventId:b.events.at(-1)!.id,employeeId:b.employeeId,
    lineage:{rootRequestId:e.requestId,rootOperationId:e.operationId,rootRecordedAt:e.recordedAt,previousOperationId:null}}:null;
  if(current&&options.otherRoot){current={...current,requestId:correctionId(900),operationId:correctionId(901),lineage:{...current.lineage,rootRequestId:correctionId(900),rootOperationId:correctionId(901)}};}
  if(current&&(options.revision??1)>1){
    current.proposal={...current.proposal,endAt:"2026-09-28T15:00:00.000000Z",breaks:[]};
    Object.assign(current,previewCorrection(b,current.proposal).proposed.totals,{requestId:correctionId(301),operationId:correctionId(302),revision:options.revision,recordedAt:"2026-09-30T12:00:01.500001Z"});
    current.lineage.previousOperationId=options.revision===2?e!.operationId:correctionId(303);
  }
  if(current){if(!r.blockers.includes("already_effective"))r.blockers.push("already_effective");r.canApprove=false;}
  if(!writeEnabled)r.canApprove=r.canReject=false;
  return parseCurrentCorrectionDecision({...r,protocol:"correction-decision-v2",current,writeEnabled,replayed:!!r.receipt&&!options.fresh,
    effectiveChanged:!!r.receipt&&!!options.fresh&&r.receipt.action==="approve"},{...decisionQuery,operationId:r.receipt?.operationId??null});
}
