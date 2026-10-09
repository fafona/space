import {revisionReviewResponse} from "./attendance-revision-review-model";
import {correctionId as id} from "./attendance-correction-model";
import {previewCorrection} from "../../src/lib/merchantAttendanceCorrection";
import type {RevisionApprovalResult,RevisionApprovalReview} from "../../src/lib/merchantAttendanceRevisionApproval";
import type {RevisionCycleEffect,RevisionCycleResult,RevisionCycleCommand} from "../../src/lib/merchantAttendanceRevisionCycle";
export function revisionApprovalResponse(action:"approve"|"reject"|null=null,firstBase=false):RevisionApprovalResult{
  const old=revisionReviewResponse(),a=old.review.application,b=old.base;
  let base:RevisionCycleEffect={...b,action:"approve",originalLastEventId:a.basis.events.at(-1)!.id,employeeId:a.employeeId,calculationVersion:"declaration-v1",
    lineage:{rootRequestId:b.requestId,rootOperationId:b.operationId,rootRecordedAt:b.recordedAt,previousOperationId:null}};
  const p={...structuredClone(b.proposal),endAt:"2026-09-28T15:30:00.000000Z"};
  if(!firstBase)base={...base,requestId:id(290),operationId:id(291),revision:2,recordedAt:"2026-09-30T12:30:00.000000Z",proposal:p,
    ...previewCorrection(a.basis,p).proposed.totals!,lineage:{...base.lineage,previousOperationId:b.operationId}};
  const revision=firstBase?1:2;
  old.review.application.item.revision=revision;old.review.item.revision=revision;
  const review:RevisionApprovalReview={...old,base,sourceVersion:"revision-review-v2",requestState:"submitted",submittedRevision:revision,ledgerRevision:revision};
  const c={action:action??"approve",requestId:review.requestId,operationId:id(500),expectedRevision:revision,expectedEvidence:"b".repeat(32),expectedBaseOperationId:base.operationId,reason:"合成核对结果"};
  const decision=action?{requestId:review.requestId,operationId:c.operationId,action,requestRevision:revision,baseOperationId:base.operationId,evidenceToken:c.expectedEvidence,
    reason:c.reason,recordedAt:"2026-09-30T14:01:00.000000Z",command:c}:null;
  const current:RevisionCycleEffect=action==="approve"?{...base,requestId:review.requestId,operationId:c.operationId,revision:base.revision+1,recordedAt:decision!.recordedAt,
    proposal:structuredClone(a.proposal),...previewCorrection(a.basis,a.proposal).proposed.totals!,lineage:{...base.lineage,previousOperationId:base.operationId}}:structuredClone(base);
  return {protocol:"revision-decision-v2",siteId:review.siteId,requestId:review.requestId,asOf:"2026-09-30T14:02:00.000000Z",review,evidenceToken:"c".repeat(32),
    blockers:action?["already_decided",...(action==="approve"?["base_changed"]:[])]:[],writeEnabled:true,canApprove:!action,canReject:!action,decision,receipt:structuredClone(decision),current,replayed:false,effectiveChanged:action==="approve"};
}
export function recoverRevisionApproval(v:RevisionApprovalResult,advance=false):RevisionApprovalResult{
  const r=structuredClone(v),a=r.review.review.application;
  if(advance){
    const p={...structuredClone(a.proposal),endAt:"2026-09-28T14:00:00.000000Z"};
    r.current={...r.current,requestId:id(910),operationId:id(911),revision:r.current.revision+1,recordedAt:"2026-09-30T14:03:00.000000Z",proposal:p,
      ...previewCorrection(a.basis,p).proposed.totals!,lineage:{...r.current.lineage,previousOperationId:r.current.operationId}};
    r.review.ledgerRevision++;r.asOf="2026-09-30T14:04:00.000000Z";
  }
  r.review.requestState=r.decision?.action==="approve"?"approved":"rejected";r.review.pendingRequestId=null;
  r.review.asOf=r.asOf;r.review.review.asOf=r.asOf;a.asOf=r.asOf;a.rules!.checkedAt=r.asOf;r.review.review.evidence.currentBasis!.asOf=r.asOf;
  r.blockers=[...r.review.blockers,"already_decided",...(r.current.operationId!==r.review.base.operationId?["base_changed"]:[])];
  r.replayed=true;r.effectiveChanged=false;r.writeEnabled=false;r.canApprove=false;r.canReject=false;return r;
}
export function revisionCycleServiceFixture(withReceipt=true){
  const owner=revisionApprovalResponse(),r=owner.review,a=r.review.application;
  const command:RevisionCycleCommand={action:"submit",operationId:r.requestId,expectedRevision:r.submittedRevision-1,reason:a.reason,
    expectedBaseOperationId:r.base.lineage.rootOperationId,expectedEffectiveOperationId:r.base.operationId,expectedPolicyRevision:a.rules!.policy!.revision,proposal:structuredClone(a.proposal)};
  const query={siteId:r.siteId,mode:"detail" as const,expectedWorkerId:a.workerId,baseRequestId:r.base.lineage.rootRequestId,requestId:r.requestId,operationId:null};
  const data:RevisionCycleResult={protocol:"revision-self-v2",siteId:r.siteId,rootRequestId:query.baseRequestId,mode:"detail",employeeId:a.employeeId,workerId:a.workerId,asOf:r.asOf,
    revision:r.submittedRevision,pendingRequestId:r.requestId,canSubmit:false,canWithdraw:true,approvalAvailable:false,effectiveChanged:false,basis:a.basis,currentRules:{...a.rules!,binding:"preparation"},current:r.base,
    item:{requestId:r.requestId,revision:r.submittedRevision,submittedRevision:r.submittedRevision,status:"submitted",policyRevision:command.expectedPolicyRevision,proposal:a.proposal,reason:a.reason,
      submittedAt:a.item.submittedAt,basedOn:r.base,withdrawal:null,decision:null,decisionEffect:null},
    receipt:withReceipt?{operationId:command.operationId,requestId:r.requestId,revision:r.submittedRevision,action:"submit",recordedAt:a.item.submittedAt,command}:null};
  return {query,command,data};
}
