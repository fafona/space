import {attendanceSelfUuid} from "./merchantAttendanceSelf";
import {attendanceRecordInstant} from "./merchantAttendanceManagement";
import {MerchantAttendanceError} from "./merchantAttendanceTime";
import {parseCorrectionProposal,previewCorrection} from "./merchantAttendanceCorrection";
import {parseCorrectionReviewResult,inspectCorrectionReview,type CorrectionReviewResult} from "./merchantAttendanceCorrectionReview";
import {parseAttendanceRevisionReviewQuery,attendanceRevisionReviewQueryString,REVISION_REVIEW_BLOCKERS,ATTENDANCE_REVISION_REVIEW_ERRORS,type AttendanceRevisionReviewQuery} from "./merchantAttendanceRevisionReview";
import {CORRECTION_DECISION_ERRORS} from "./merchantAttendanceCorrectionDecision";
import {parseRevisionDecisionCommand,parseRevisionDecisionQuery,type RevisionDecisionRecord,type RevisionDecisionQuery} from "./merchantAttendanceRevisionDecision";
import type {AttendanceSessionResult} from "./merchantAttendanceSession";
import type {RevisionCycleEffect} from "./merchantAttendanceRevisionCycle";

// Explicit v2 candidate consumer. It does not negotiate versions, enable writes or
// grant RPC access. Historical decisions and today's selected source are separate.
export type RevisionApprovalReview={sourceVersion:"revision-review-v2";requestState:"submitted"|"withdrawn"|"approved"|"rejected";
  siteId:string;requestId:string;asOf:string;reviewOnly:true;approvalAvailable:false;effectiveChanged:false;
  review:Extract<CorrectionReviewResult,{mode:"detail"}>;base:RevisionCycleEffect;submittedRevision:number;ledgerRevision:number;pendingRequestId:string|null;
  evidenceToken:string;blockers:string[];checksPassed:boolean;rejectionChecksPassed:boolean};
export type RevisionApprovalResult={protocol:"revision-decision-v2";siteId:string;requestId:string;asOf:string;review:RevisionApprovalReview;
  evidenceToken:string;blockers:string[];writeEnabled:boolean;canApprove:boolean;canReject:boolean;decision:RevisionDecisionRecord|null;receipt:RevisionDecisionRecord|null;
  current:RevisionCycleEffect;replayed:boolean;effectiveChanged:boolean};
function fail():never{throw new MerchantAttendanceError("attendance_invalid_request");}
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:fail();
function exact(v:Record<string,unknown>,keys:string[]){if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail();}
function positive(v:unknown){if(!Number.isSafeInteger(v)||Number(v)<1||Number(v)>9007199254740989)fail();return Number(v);}
function instant(v:unknown){const s=attendanceRecordInstant(v);if(s!==v)fail();return s;}
const token=(v:unknown)=>typeof v==="string"&&/^[0-9a-f]{32}$/.test(v)?v:fail();
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export function parseRevisionApprovalReviewQuery(value:unknown):AttendanceRevisionReviewQuery{
  const q=obj(value);exact(q,["siteId","requestId"]);
  return parseAttendanceRevisionReviewQuery("https://local.invalid/?"+attendanceRevisionReviewQueryString(q as AttendanceRevisionReviewQuery));
}
function source(value:unknown,basis:AttendanceSessionResult,asOf:string,limit:number):RevisionCycleEffect{
  const e=obj(value),l=obj(e.lineage);
  exact(e,["requestId","operationId","revision","policyRevision","action","originalLastEventId","recordedAt","employeeId","timeZone","proposal","calculationVersion","elapsedUs","workedUs","breakUs","paidBreakUs","lineage"]);
  exact(l,["rootRequestId","rootOperationId","rootRecordedAt","previousOperationId"]);
  const requestId=attendanceSelfUuid(e.requestId),operationId=attendanceSelfUuid(e.operationId),revision=positive(e.revision),policyRevision=positive(e.policyRevision);
  const recordedAt=instant(e.recordedAt),rootRequestId=attendanceSelfUuid(l.rootRequestId),rootOperationId=attendanceSelfUuid(l.rootOperationId),rootRecordedAt=instant(l.rootRecordedAt);
  const previousOperationId=l.previousOperationId===null?null:attendanceSelfUuid(l.previousOperationId),proposal=parseCorrectionProposal(e.proposal,recordedAt);
  const compared=previewCorrection(basis,proposal),totals=compared.proposed.totals??fail();
  if(compared.original.status!=="completed"||e.action!=="approve"||e.calculationVersion!=="declaration-v1"||e.employeeId!==basis.employeeId
    ||e.originalLastEventId!==basis.events.at(-1)!.id||e.timeZone!==basis.events[0].timeZone
    ||basis.asOf>=rootRecordedAt||recordedAt>asOf||revision>limit||rootRequestId===rootOperationId||requestId===operationId)fail();
  if(revision===1){if(requestId!==rootRequestId||operationId!==rootOperationId||recordedAt!==rootRecordedAt||previousOperationId!==null)fail();}
  else if([rootRequestId,rootOperationId].includes(requestId)||[rootRequestId,rootOperationId].includes(operationId)||recordedAt<=rootRecordedAt||previousOperationId===null
    ||[requestId,operationId,rootRequestId].includes(previousOperationId)||(revision===2)!==(previousOperationId===rootOperationId))fail();
  for(const key of ["elapsedUs","workedUs","breakUs","paidBreakUs"] as const)if(e[key]!==totals[key])fail();
  return {requestId,operationId,revision,policyRevision,action:"approve",originalLastEventId:basis.events.at(-1)!.id,recordedAt,employeeId:basis.employeeId,
    timeZone:basis.events[0].timeZone,proposal,calculationVersion:"declaration-v1",...totals,lineage:{rootRequestId,rootOperationId,rootRecordedAt,previousOperationId}};
}
export function parseRevisionApprovalReview(raw:unknown,input:AttendanceRevisionReviewQuery):RevisionApprovalReview{
  const q=parseRevisionApprovalReviewQuery(input),v=obj(raw);
  exact(v,["sourceVersion","requestState","siteId","requestId","asOf","reviewOnly","approvalAvailable","effectiveChanged","review","base","submittedRevision","ledgerRevision","pendingRequestId","evidenceToken","blockers","checksPassed","rejectionChecksPassed"]);
  if(v.sourceVersion!=="revision-review-v2"||typeof v.requestState!=="string"||!["submitted","withdrawn","approved","rejected"].includes(v.requestState)
    ||v.siteId!==q.siteId||v.requestId!==q.requestId||v.reviewOnly!==true||v.approvalAvailable!==false||v.effectiveChanged!==false
    ||typeof v.checksPassed!=="boolean"||typeof v.rejectionChecksPassed!=="boolean")fail();
  const asOf=instant(v.asOf),review=parseCorrectionReviewResult(v.review,{...q,mode:"detail"},true);
  if(review.mode!=="detail"||review.asOf!==asOf||review.decisionsAvailable!==undefined||review.application.item.decision!==undefined||review.application.rules?.binding!=="bound")fail();
  const a=review.application,submittedRevision=positive(v.submittedRevision),ledgerRevision=positive(v.ledgerRevision),pendingRequestId=v.pendingRequestId===null?null:attendanceSelfUuid(v.pendingRequestId);
  // Decisions are a separate journal; never infer request state from parity.
  if(submittedRevision>ledgerRevision||a.item.revision>ledgerRevision
    ||(v.requestState==="withdrawn"?(a.item.status!=="withdrawn"||a.item.revision!==submittedRevision+1):(a.item.status!=="submitted"||a.item.revision!==submittedRevision))
    ||(v.requestState==="submitted"?(pendingRequestId!==q.requestId||a.item.revision!==ledgerRevision):pendingRequestId===q.requestId)
    ||pendingRequestId!==null&&v.requestState!=="submitted"&&ledgerRevision<=a.item.revision)fail();
  const base=source(v.base,a.basis,asOf,submittedRevision);
  if([base.requestId,base.operationId,base.lineage.rootRequestId,base.lineage.rootOperationId].includes(q.requestId)
    ||pendingRequestId!==null&&[base.requestId,base.operationId,base.lineage.rootRequestId,base.lineage.rootOperationId].includes(pendingRequestId)
    ||base.recordedAt>=a.item.submittedAt||same(base.proposal,a.proposal))fail();
  const evidenceToken=token(v.evidenceToken);
  if(!Array.isArray(v.blockers)||v.blockers.length>REVISION_REVIEW_BLOCKERS.length||new Set(v.blockers).size!==v.blockers.length||v.blockers.some(k=>typeof k!=="string"||!REVISION_REVIEW_BLOCKERS.includes(k)))fail();
  const blockers=v.blockers as string[],expected=[...inspectCorrectionReview(review).issues,...a.rules!.issues.map(k=>`rule_${k}`)];
  if(expected.some(k=>!blockers.includes(k))||blockers.some(k=>k!=="effective_overlap"&&k!=="missing_overlap"&&!expected.includes(k))
    ||v.checksPassed!==(blockers.length===0)||v.rejectionChecksPassed!==!blockers.some(k=>["withdrawn","binding_changed","self_review"].includes(k)))fail();
  return {sourceVersion:"revision-review-v2",requestState:v.requestState as RevisionApprovalReview["requestState"],siteId:q.siteId,requestId:q.requestId,asOf,
    reviewOnly:true,approvalAvailable:false,effectiveChanged:false,review,base,submittedRevision,ledgerRevision,pendingRequestId,evidenceToken,blockers,checksPassed:v.checksPassed,rejectionChecksPassed:v.rejectionChecksPassed};
}
export function parseRevisionApprovalResult(raw:unknown,input:RevisionDecisionQuery):RevisionApprovalResult{
  const q=parseRevisionDecisionQuery(input),v=obj(raw);
  exact(v,["protocol","siteId","requestId","asOf","review","evidenceToken","blockers","writeEnabled","canApprove","canReject","decision","receipt","current","replayed","effectiveChanged"]);
  if(v.protocol!=="revision-decision-v2"||v.siteId!==q.siteId||v.requestId!==q.requestId
    ||["writeEnabled","canApprove","canReject","replayed","effectiveChanged"].some(k=>typeof v[k]!=="boolean"))fail();
  const asOf=instant(v.asOf),review=parseRevisionApprovalReview(v.review,{siteId:q.siteId,requestId:q.requestId}),b=review.base,a=review.review.application,evidenceToken=token(v.evidenceToken);
  if(asOf<review.asOf)fail();
  function record(value:unknown):RevisionDecisionRecord|null{
    if(value===null)return null;const d=obj(value),c=obj(d.command);
    exact(d,["requestId","operationId","action","requestRevision","baseOperationId","evidenceToken","reason","recordedAt","command"]);
    if(Object.hasOwn(c,"siteId"))fail();
    const command=parseRevisionDecisionCommand({siteId:q.siteId,...c}).command,recordedAt=instant(d.recordedAt);
    if(d.requestId!==q.requestId||command.requestId!==q.requestId||d.operationId!==command.operationId||d.action!==command.action||d.requestRevision!==command.expectedRevision
      ||d.baseOperationId!==command.expectedBaseOperationId||d.evidenceToken!==command.expectedEvidence||d.reason!==command.reason
      ||command.expectedRevision!==review.submittedRevision||command.expectedBaseOperationId!==b.operationId||a.item.status!=="submitted"
      ||recordedAt<=a.item.submittedAt||recordedAt>asOf||[q.requestId,b.requestId,b.operationId,b.lineage.rootRequestId,b.lineage.rootOperationId].includes(command.operationId))fail();
    return {requestId:q.requestId,operationId:command.operationId,action:command.action,requestRevision:command.expectedRevision,baseOperationId:command.expectedBaseOperationId,
      evidenceToken:command.expectedEvidence,reason:command.reason,recordedAt,command};
  }
  const decision=record(v.decision),receipt=record(v.receipt),fresh=receipt!==null&&v.replayed===false;
  if(receipt&&(receipt.operationId!==q.operationId||!same(receipt,decision))||v.replayed&&!receipt)fail();
  if(decision){
    if(fresh?(review.requestState!=="submitted"||receipt!.recordedAt<review.asOf||!v.writeEnabled||!(decision.action==="approve"?review.checksPassed:review.rejectionChecksPassed)):
      review.requestState!==(decision.action==="approve"?"approved":"rejected"))fail();
  }else if(review.requestState!=="submitted"&&review.requestState!=="withdrawn")fail();
  const current=source(v.current,a.basis,asOf,review.ledgerRevision+1),l=current.lineage;
  if(l.rootRequestId!==b.lineage.rootRequestId||l.rootOperationId!==b.lineage.rootOperationId||l.rootRecordedAt!==b.lineage.rootRecordedAt||current.revision<b.revision
    ||(current.revision===b.revision?!same(current,b):current.recordedAt<=b.recordedAt||[b.operationId,b.requestId].includes(current.operationId)))fail();
  if(decision?.action==="approve"){
    if(current.revision<b.revision+1||current.recordedAt<decision.recordedAt)fail();
    if(current.revision===b.revision+1){
      if(current.requestId!==q.requestId||current.operationId!==decision.operationId||current.recordedAt!==decision.recordedAt||l.previousOperationId!==b.operationId
        ||current.policyRevision!==a.rules!.policy!.revision||!same(current.proposal,a.proposal))fail();
    }else if(fresh||current.requestId===q.requestId||current.operationId===decision.operationId||current.recordedAt<=decision.recordedAt)fail();
  }else{
    if(current.requestId===q.requestId||decision&&current.operationId===decision.operationId||fresh&&!same(current,b)
      ||decision&&current.revision>b.revision&&current.recordedAt<=decision.recordedAt)fail();
  }
  const blockers=[...review.blockers,...(decision?["already_decided"]:[]),...(current.operationId!==b.operationId?["base_changed"]:[])];
  if(!same(v.blockers,blockers)||v.canApprove!==(v.writeEnabled&&blockers.length===0)
    ||v.canReject!==(v.writeEnabled&&!decision&&current.operationId===b.operationId&&review.rejectionChecksPassed)
    ||v.effectiveChanged!==Boolean(fresh&&receipt!.action==="approve"))fail();
  return {protocol:"revision-decision-v2",siteId:q.siteId,requestId:q.requestId,asOf,review,evidenceToken,blockers,writeEnabled:v.writeEnabled as boolean,
    canApprove:v.canApprove as boolean,canReject:v.canReject as boolean,decision,receipt,current,replayed:v.replayed as boolean,effectiveChanged:v.effectiveChanged as boolean};
}
export const REVISION_APPROVAL_ERRORS:Readonly<Record<string,number>>={...ATTENDANCE_REVISION_REVIEW_ERRORS,...CORRECTION_DECISION_ERRORS,
  attendance_revision_base_changed:409,attendance_report_version_required:409};
