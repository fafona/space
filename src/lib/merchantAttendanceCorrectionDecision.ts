import {attendanceSelfSite,attendanceSelfUuid} from "./merchantAttendanceSelf";
import {attendanceRecordInstant} from "./merchantAttendanceManagement";
import {attendanceTimeZone,MerchantAttendanceError} from "./merchantAttendanceTime";
import {parseCorrectionProposal,previewCorrection,type CorrectionProposal} from "./merchantAttendanceCorrection";
import {parseCorrectionReviewResult,inspectCorrectionReview,type CorrectionReviewResult,CORRECTION_CHECK_LABELS} from "./merchantAttendanceCorrectionReview";
import {CORRECTION_RULE_LABELS} from "./merchantAttendanceCorrectionRules";
import {parseCorrectionDecisionRecord,type CorrectionDecisionRecord} from "./merchantAttendanceCorrectionDecisionRecord";
export type CorrectionDecisionQuery={siteId:string;requestId:string;operationId:string|null};
export type CorrectionDecisionCommand={action:"approve"|"reject";operationId:string;requestId:string;expectedRevision:number;expectedEvidence:string;reason:string};
export type CorrectionEffect={requestId:string;operationId:string;revision:1;policyRevision:number;timeZone:string;proposal:CorrectionProposal;
  calculationVersion:"declaration-v1";elapsedUs:number;workedUs:number;breakUs:number;paidBreakUs:number;recordedAt:string};
export const DECISION_BLOCKERS=[...Object.keys(CORRECTION_CHECK_LABELS),...Object.keys(CORRECTION_RULE_LABELS).map(k=>`rule_${k}`),"already_decided","already_effective","effective_overlap","missing_overlap"] as const;
export type CorrectionDecisionResult={siteId:string;asOf:string;review:Extract<CorrectionReviewResult,{mode:"detail"}>;evidenceToken:string;
  blockers:string[];canApprove:boolean;canReject:boolean;decision:CorrectionDecisionRecord|null;receipt:CorrectionDecisionRecord|null;effective:CorrectionEffect|null;timesheetIntegrated:false};
const fail=():never=>{throw new MerchantAttendanceError("attendance_invalid_request");};
const obj=(v:unknown):Record<string,unknown>=>!v||typeof v!=="object"||Array.isArray(v)?fail():v as Record<string,unknown>;
const token=(v:unknown)=>typeof v==="string"&&/^[0-9a-f]{32}$/.test(v)?v:fail();
export function correctionDecisionQueryString(q:CorrectionDecisionQuery){return new URLSearchParams(Object.entries(q).filter((e):e is [string,string]=>e[1]!==null)).toString();}
export function parseCorrectionDecisionQuery(url:string):CorrectionDecisionQuery {
  const q=new URL(url).searchParams;for(const k of q.keys())if(!["siteId","requestId","operationId"].includes(k)||q.getAll(k).length!==1)fail();
  return {siteId:attendanceSelfSite(q.get("siteId")),requestId:attendanceSelfUuid(q.get("requestId")),operationId:q.has("operationId")?attendanceSelfUuid(q.get("operationId")):null};
}
export function parseCorrectionDecisionCommand(raw:unknown):{siteId:string;command:CorrectionDecisionCommand}{
  const v=obj(raw),keys=["siteId","requestId","operationId","action","expectedRevision","expectedEvidence","reason"];
  if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k))||(v.action!=="approve"&&v.action!=="reject")
    ||!Number.isSafeInteger(v.expectedRevision)||Number(v.expectedRevision)<1||Number(v.expectedRevision)>9007199254740989
    ||typeof v.reason!=="string"||!v.reason.trim()||v.reason!==v.reason.trim()||[...v.reason].length>500||/[\u0000-\u001f\u007f-\u009f]/.test(v.reason))fail();
  return {siteId:attendanceSelfSite(v.siteId),command:{requestId:attendanceSelfUuid(v.requestId),operationId:attendanceSelfUuid(v.operationId),action:v.action as "approve"|"reject",
    expectedRevision:Number(v.expectedRevision),expectedEvidence:token(v.expectedEvidence),reason:v.reason as string}};
}
export function parseCorrectionDecisionResult(raw:unknown,q:CorrectionDecisionQuery):CorrectionDecisionResult{
  const v=obj(raw);if(v.protocol!==undefined||v.timesheetIntegrated!==false)fail();
  return {...parseCorrectionDecisionSnapshot(raw,q),timesheetIntegrated:false};
}
// Shared first-decision facts only: this never claims the effect is the current
// source. Explicit protocol wrappers validate their own integration metadata.
export function parseCorrectionDecisionSnapshot(raw:unknown,q:CorrectionDecisionQuery):Omit<CorrectionDecisionResult,"timesheetIntegrated">{
  const v=obj(raw),asOf=attendanceRecordInstant(v.asOf);
  if(v.siteId!==q.siteId||typeof v.canApprove!=="boolean"||typeof v.canReject!=="boolean"||!Array.isArray(v.blockers)
    ||v.blockers.length>DECISION_BLOCKERS.length||new Set(v.blockers).size!==v.blockers.length||v.blockers.some(b=>typeof b!=="string"||!DECISION_BLOCKERS.includes(b)))fail();
  const review=parseCorrectionReviewResult(v.review,{siteId:q.siteId,mode:"detail",requestId:q.requestId},true);
  if(review.mode!=="detail"||review.asOf>asOf)return fail();const a=review.application;
  const blockers=v.blockers as string[];
  const context={requestId:q.requestId,revision:a.item.revision,submittedAt:a.item.submittedAt,asOf};
  const decision=parseCorrectionDecisionRecord(v.decision,context),receipt=parseCorrectionDecisionRecord(v.receipt,context);
  if(decision&&a.item.status!=="submitted"||receipt&&(receipt.operationId!==q.operationId||JSON.stringify(receipt)!==JSON.stringify(decision))
    ||v.canApprove&&(blockers.length>0||v.canReject!==true||inspectCorrectionReview(review).issues.length>0||!a.rules||a.rules.issues.length>0)
    ||v.canReject&&(blockers.some(b=>['withdrawn','already_decided','binding_changed','self_review'].includes(b))||!review.evidence.bindingCurrent||review.evidence.ownApplication||a.item.status!=="submitted")
    ||decision&&(v.canApprove||v.canReject||!blockers.includes("already_decided")))fail();
  let effective:CorrectionEffect|null=null;
  if(v.effective!==null){
    const e=obj(v.effective),proposal=parseCorrectionProposal(e.proposal,asOf),timeZone=attendanceTimeZone(e.timeZone as string),recordedAt=attendanceRecordInstant(e.recordedAt);
    if(!decision||decision.action!=="approve"||e.requestId!==q.requestId||e.operationId!==decision.operationId||recordedAt!==decision.recordedAt
      ||e.revision!==1||e.calculationVersion!=="declaration-v1"||e.policyRevision!==a.rules?.policy?.revision||timeZone!==a.basis.events[0].timeZone
      ||JSON.stringify(proposal)!==JSON.stringify(a.proposal))fail();
    const totals=previewCorrection(a.basis,proposal).proposed.totals!;
    for(const k of ["elapsedUs","workedUs","breakUs","paidBreakUs"] as const)if(!Number.isSafeInteger(e[k])||e[k]!==totals[k])fail();
    effective={requestId:q.requestId,operationId:decision!.operationId,revision:1,policyRevision:Number(e.policyRevision),timeZone,proposal,
      calculationVersion:"declaration-v1",elapsedUs:totals.elapsedUs,workedUs:totals.workedUs,breakUs:totals.breakUs,paidBreakUs:totals.paidBreakUs,recordedAt};
  }
  if((decision?.action==="approve")!==(effective!==null))fail();
  return {siteId:q.siteId,asOf,review,evidenceToken:token(v.evidenceToken),blockers,canApprove:v.canApprove as boolean,canReject:v.canReject as boolean,
    decision,receipt,effective};
}
export function correctionDecisionReceiptMatches(c:CorrectionDecisionCommand,r:CorrectionDecisionRecord){
  return c.operationId===r.operationId&&c.requestId===r.requestId&&c.action===r.action&&c.expectedRevision===r.requestRevision&&c.expectedEvidence===r.evidenceToken&&c.reason===r.reason;
}
export const CORRECTION_DECISION_ERRORS:Readonly<Record<string,number>>={attendance_invalid_request:400,attendance_invalid_instant:400,attendance_invalid_content_type:415,
  attendance_period_sealed:409,
  attendance_body_too_large:413,attendance_access_denied:403,attendance_platform_paused:403,attendance_settings_required:409,attendance_correction_not_found:404,
  attendance_operation_conflict:409,attendance_version_conflict:409,attendance_correction_decided:409,attendance_correction_evidence_changed:409,
  attendance_correction_decision_blocked:409,attendance_rate_limited:429};
