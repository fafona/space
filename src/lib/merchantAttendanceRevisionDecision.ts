import {attendanceSelfSite,attendanceSelfUuid} from "./merchantAttendanceSelf";
import {attendanceRecordInstant} from "./merchantAttendanceManagement";
import {MerchantAttendanceError} from "./merchantAttendanceTime";
import {parseCorrectionDecisionCommand,type CorrectionDecisionCommand} from "./merchantAttendanceCorrectionDecision";
import {parseAttendanceRevisionReviewResult,type AttendanceRevisionReviewResult} from "./merchantAttendanceRevisionReview";
import {parseCorrectionProposal,previewCorrection,type CorrectionProposal} from "./merchantAttendanceCorrection";
import type {AttendanceSessionAmounts} from "./merchantAttendanceSession";

// Private transaction protocol only. No HTTP writer or application RPC grant.
export type RevisionDecisionCommand=CorrectionDecisionCommand&{expectedBaseOperationId:string};
export type RevisionDecisionQuery={siteId:string;requestId:string;operationId:string|null};
export type RevisionDecisionRecord={requestId:string;operationId:string;action:"approve"|"reject";requestRevision:number;
  baseOperationId:string;evidenceToken:string;reason:string;recordedAt:string;command:RevisionDecisionCommand};
export type RevisionDecisionEffect=AttendanceSessionAmounts&{requestId:string;operationId:string;revision:1|2;policyRevision:number;
  recordedAt:string;timeZone:string;proposal:CorrectionProposal;lineage:{rootRequestId:string;rootOperationId:string;rootRecordedAt:string;previousOperationId:string|null}};
export type RevisionDecisionResult={siteId:string;requestId:string;asOf:string;protocol:"revision-decision-v1";review:AttendanceRevisionReviewResult;
  evidenceToken:string;blockers:string[];writeEnabled:boolean;canApprove:boolean;canReject:boolean;
  decision:RevisionDecisionRecord|null;receipt:RevisionDecisionRecord|null;current:RevisionDecisionEffect;replayed:boolean;effectiveChanged:boolean};
const fail=():never=>{throw new MerchantAttendanceError("attendance_invalid_request");};
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:fail();
function exact(v:Record<string,unknown>,keys:string[]){if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail();}
function instant(v:unknown){const s=attendanceRecordInstant(v);if(s!==v)fail();return s;}
const token=(v:unknown)=>typeof v==="string"&&/^[a-f0-9]{32}$/.test(v)?v:fail();
export function parseRevisionDecisionCommand(value:unknown):{siteId:string;command:RevisionDecisionCommand}{
  const v=obj(value);exact(v,["siteId","requestId","operationId","action","expectedRevision","expectedEvidence","expectedBaseOperationId","reason"]);
  const {expectedBaseOperationId,...old}=v,result=parseCorrectionDecisionCommand(old);
  return {...result,command:{...result.command,expectedBaseOperationId:attendanceSelfUuid(expectedBaseOperationId)}};
}
export function parseRevisionDecisionQuery(value:unknown):RevisionDecisionQuery{
  const v=obj(value);exact(v,["siteId","requestId","operationId"]);
  return {siteId:attendanceSelfSite(v.siteId),requestId:attendanceSelfUuid(v.requestId),operationId:v.operationId===null?null:attendanceSelfUuid(v.operationId)};
}
export function revisionDecisionReceiptMatches(c:RevisionDecisionCommand,r:RevisionDecisionRecord){
  return c.operationId===r.operationId&&c.requestId===r.requestId&&c.action===r.action&&c.expectedRevision===r.requestRevision
    &&c.expectedEvidence===r.evidenceToken&&c.expectedBaseOperationId===r.baseOperationId&&c.reason===r.reason;
}
export function parseRevisionDecisionResult(raw:unknown,input:RevisionDecisionQuery):RevisionDecisionResult{
  const q=parseRevisionDecisionQuery(input),v=obj(raw);
  exact(v,["siteId","requestId","asOf","protocol","review","evidenceToken","blockers","writeEnabled","canApprove","canReject","decision","receipt","current","replayed","effectiveChanged"]);
  if(v.siteId!==q.siteId||v.requestId!==q.requestId||v.protocol!=="revision-decision-v1"
    ||["writeEnabled","canApprove","canReject","replayed","effectiveChanged"].some(k=>typeof v[k]!=="boolean"))fail();
  const asOf=instant(v.asOf),review=parseAttendanceRevisionReviewResult(v.review,q),evidenceToken=token(v.evidenceToken);
  if(asOf<review.asOf)fail();
  function record(value:unknown):RevisionDecisionRecord|null{
    if(value===null)return null;const d=obj(value);
    exact(d,["requestId","operationId","action","requestRevision","baseOperationId","evidenceToken","reason","recordedAt","command"]);
    const c=obj(d.command),command=parseRevisionDecisionCommand({siteId:q.siteId,...c}).command;
    // A nested command cannot override its authenticated envelope's tenant.
    if(Object.hasOwn(c,"siteId"))fail();
    const recordedAt=instant(d.recordedAt);
    if(d.requestId!==q.requestId||d.operationId!==command.operationId||d.action!==command.action||d.requestRevision!==command.expectedRevision
      ||d.baseOperationId!==command.expectedBaseOperationId||d.evidenceToken!==command.expectedEvidence||d.reason!==command.reason
      ||command.requestId!==q.requestId||command.expectedRevision!==review.submittedRevision||review.review.item.status!=="submitted"
      ||command.expectedBaseOperationId!==review.base.operationId||recordedAt<=review.review.item.submittedAt||recordedAt>asOf)fail();
    return {requestId:q.requestId,operationId:command.operationId,action:command.action,requestRevision:command.expectedRevision,
      baseOperationId:command.expectedBaseOperationId,evidenceToken:command.expectedEvidence,reason:command.reason,recordedAt,command};
  }
  const decision=record(v.decision),receipt=record(v.receipt);
  if(receipt&&(receipt.operationId!==q.operationId||JSON.stringify(receipt)!==JSON.stringify(decision)))fail();
  const e=obj(v.current),l=obj(e.lineage),b=review.base,a=review.review.application;
  exact(e,["requestId","operationId","revision","policyRevision","action","originalLastEventId","recordedAt","employeeId","timeZone","proposal","calculationVersion","elapsedUs","workedUs","breakUs","paidBreakUs","lineage"]);
  exact(l,["rootRequestId","rootOperationId","rootRecordedAt","previousOperationId"]);
  const requestId=attendanceSelfUuid(e.requestId),operationId=attendanceSelfUuid(e.operationId),recordedAt=instant(e.recordedAt);
  const proposal=parseCorrectionProposal(e.proposal,recordedAt),totals=previewCorrection(a.basis,proposal).proposed.totals??fail();
  if(e.action!=="approve"||e.calculationVersion!=="declaration-v1"||e.timeZone!==b.timeZone||e.employeeId!==review.review.item.employeeId
    ||e.originalLastEventId!==a.basis.events.at(-1)!.id||!Number.isSafeInteger(e.policyRevision)||Number(e.policyRevision)<1||Number(e.policyRevision)>9007199254740989
    ||l.rootRequestId!==b.requestId||l.rootOperationId!==b.operationId||l.rootRecordedAt!==b.recordedAt||recordedAt>asOf||requestId===operationId)fail();
  if(e.revision===1){
    if(requestId!==b.requestId||operationId!==b.operationId||recordedAt!==b.recordedAt||l.previousOperationId!==null||e.policyRevision!==b.policyRevision||JSON.stringify(proposal)!==JSON.stringify(b.proposal))fail();
  }else if(e.revision===2){
    if(requestId===b.requestId||operationId===b.operationId||l.previousOperationId!==b.operationId||recordedAt<=b.recordedAt)fail();
  }else fail(); // Later-cycle protocol must be deliberately implemented first.
  for(const key of ["elapsedUs","workedUs","breakUs","paidBreakUs"] as const)if(e[key]!==totals[key])fail();
  const current:RevisionDecisionEffect={requestId,operationId,revision:e.revision as 1|2,policyRevision:Number(e.policyRevision),recordedAt,timeZone:b.timeZone,proposal,...totals,
    lineage:{rootRequestId:b.requestId,rootOperationId:b.operationId,rootRecordedAt:b.recordedAt,previousOperationId:e.revision===1?null:b.operationId}};
  if(decision){
    if(decision.action==="approve"?(current.revision!==2||requestId!==q.requestId||operationId!==decision.operationId||recordedAt!==decision.recordedAt
      ||e.policyRevision!==a.rules!.policy!.revision||JSON.stringify(proposal)!==JSON.stringify(a.proposal)):operationId!==b.operationId)fail();
  }
  const blockers=[...review.blockers,...(decision?["already_decided"]:[]),...(operationId!==b.operationId?["base_changed"]:[])];
  if(JSON.stringify(v.blockers)!==JSON.stringify(blockers)||v.canApprove!==(v.writeEnabled&&blockers.length===0)
    ||v.canReject!==(v.writeEnabled&&!decision&&operationId===b.operationId&&review.rejectionChecksPassed)
    ||v.replayed&&!receipt||v.effectiveChanged!==Boolean(receipt?.action==="approve"&&!v.replayed)
    ||receipt&&!v.replayed&&(!v.writeEnabled||receipt.recordedAt<review.asOf))fail();
  return {siteId:q.siteId,requestId:q.requestId,asOf,protocol:"revision-decision-v1",review,evidenceToken,blockers,writeEnabled:v.writeEnabled as boolean,
    canApprove:v.canApprove as boolean,canReject:v.canReject as boolean,decision,receipt,current,replayed:v.replayed as boolean,effectiveChanged:v.effectiveChanged as boolean};
}
