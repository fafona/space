import {attendanceSelfSite,attendanceSelfUuid} from "./merchantAttendanceSelf";
import {attendanceRecordInstant} from "./merchantAttendanceManagement";
import {attendanceTimeZone,MerchantAttendanceError} from "./merchantAttendanceTime";
import {parseCorrectionProposal,previewCorrection} from "./merchantAttendanceCorrection";
import {parseCorrectionReviewResult,inspectCorrectionReview,CORRECTION_CHECK_LABELS,type CorrectionReviewResult} from "./merchantAttendanceCorrectionReview";
import {CORRECTION_RULE_LABELS} from "./merchantAttendanceCorrectionRules";
import type {AttendanceRevisionResult} from "./merchantAttendanceRevision";
export type AttendanceRevisionReviewQuery={siteId:string;requestId:string};
export const REVISION_REVIEW_BLOCKERS=[...Object.keys(CORRECTION_CHECK_LABELS),...Object.keys(CORRECTION_RULE_LABELS).map(k=>`rule_${k}`),"effective_overlap","missing_overlap"];
export type AttendanceRevisionReviewResult={siteId:string;requestId:string;asOf:string;reviewOnly:true;approvalAvailable:false;effectiveChanged:false;
  review:Extract<CorrectionReviewResult,{mode:"detail"}>;base:AttendanceRevisionResult["base"];submittedRevision:number;ledgerRevision:number;pendingRequestId:string|null;
  evidenceToken:string;blockers:string[];checksPassed:boolean;rejectionChecksPassed:boolean};
function fail():never{throw new MerchantAttendanceError("attendance_invalid_request");}
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:fail();
function exact(v:Record<string,unknown>,keys:string[]){if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail();}
function rev(v:unknown){if(!Number.isSafeInteger(v)||Number(v)<1||Number(v)>9007199254740989)fail();return Number(v);}
function instant(v:unknown){const s=attendanceRecordInstant(v);if(s!==v)fail();return s;}
export function attendanceRevisionReviewQueryString(q:AttendanceRevisionReviewQuery){return new URLSearchParams({siteId:q.siteId,requestId:q.requestId}).toString();}
export function parseAttendanceRevisionReviewQuery(url:string):AttendanceRevisionReviewQuery{
  const p=new URL(url).searchParams;if([...p.keys()].some(k=>!["siteId","requestId"].includes(k)||p.getAll(k).length!==1))fail();
  return {siteId:attendanceSelfSite(p.get("siteId")),requestId:attendanceSelfUuid(p.get("requestId"))};
}
export function parseAttendanceRevisionReviewResult(raw:unknown,query:AttendanceRevisionReviewQuery):AttendanceRevisionReviewResult{
  const q=parseAttendanceRevisionReviewQuery("https://local.invalid/?"+attendanceRevisionReviewQueryString(query)),v=obj(raw);
  exact(v,["siteId","requestId","asOf","reviewOnly","approvalAvailable","effectiveChanged","review","base","submittedRevision","ledgerRevision","pendingRequestId","evidenceToken","blockers","checksPassed","rejectionChecksPassed"]);
  if(v.siteId!==q.siteId||v.requestId!==q.requestId||v.reviewOnly!==true||v.approvalAvailable!==false||v.effectiveChanged!==false||typeof v.checksPassed!=="boolean"||typeof v.rejectionChecksPassed!=="boolean")fail();
  const asOf=instant(v.asOf),review=parseCorrectionReviewResult(v.review,{...q,mode:"detail"},true);
  if(review.mode!=="detail"||review.asOf!==asOf||review.decisionsAvailable!==undefined||review.application.item.decision!==undefined||review.application.rules?.binding!=="bound")fail();
  const submittedRevision=rev(v.submittedRevision),ledgerRevision=rev(v.ledgerRevision),pendingRequestId=v.pendingRequestId===null?null:attendanceSelfUuid(v.pendingRequestId),a=review.application;
  if(submittedRevision%2!==1||(ledgerRevision%2===1)!==(pendingRequestId!==null)||a.item.revision>ledgerRevision
    ||a.item.status==="submitted"&&(a.item.revision!==submittedRevision||a.item.revision!==ledgerRevision||pendingRequestId!==q.requestId)
    ||a.item.status==="withdrawn"&&(a.item.revision!==submittedRevision+1||pendingRequestId===q.requestId))fail();
  const b=obj(v.base);exact(b,["requestId","operationId","revision","policyRevision","proposal","timeZone","recordedAt","elapsedUs","breakUs","paidBreakUs","workedUs"]);
  const requestId=attendanceSelfUuid(b.requestId),operationId=attendanceSelfUuid(b.operationId),recordedAt=instant(b.recordedAt),proposal=parseCorrectionProposal(b.proposal,recordedAt),timeZone=attendanceTimeZone(b.timeZone as string);
  if(b.revision!==1||requestId===operationId||requestId===q.requestId||operationId===q.requestId||pendingRequestId===requestId||pendingRequestId===operationId
    ||recordedAt>=a.item.submittedAt||a.basis.asOf>=recordedAt||timeZone!==a.basis.events[0].timeZone||JSON.stringify(proposal)===JSON.stringify(a.proposal))fail();
  const compared=previewCorrection(a.basis,proposal),totals=compared.proposed.totals;
  if(compared.original.status!=="completed"||!totals)fail();
  for(const k of ["elapsedUs","breakUs","paidBreakUs","workedUs"] as const)if(b[k]!==totals[k])fail();
  const base={requestId,operationId,revision:1 as const,policyRevision:rev(b.policyRevision),proposal,timeZone,recordedAt,...totals};
  if(typeof v.evidenceToken!=="string"||!/^[0-9a-f]{32}$/.test(v.evidenceToken)||!Array.isArray(v.blockers)||v.blockers.length>REVISION_REVIEW_BLOCKERS.length||new Set(v.blockers).size!==v.blockers.length||v.blockers.some(k=>typeof k!=="string"||!REVISION_REVIEW_BLOCKERS.includes(k)))fail();
  const blockers=v.blockers as string[],expected=[...inspectCorrectionReview(review).issues,...a.rules!.issues.map(k=>`rule_${k}`)];
  if(expected.some(k=>!blockers.includes(k))||blockers.some(k=>k!=="effective_overlap"&&k!=="missing_overlap"&&!expected.includes(k))
    ||v.checksPassed!==(blockers.length===0)||v.rejectionChecksPassed!==!blockers.some(k=>["withdrawn","binding_changed","self_review"].includes(k)))fail();
  return {siteId:q.siteId,requestId:q.requestId,asOf,reviewOnly:true,approvalAvailable:false,effectiveChanged:false,review,base,submittedRevision,ledgerRevision,pendingRequestId,
    evidenceToken:v.evidenceToken,blockers,checksPassed:v.checksPassed,rejectionChecksPassed:v.rejectionChecksPassed};
}
// Display only. Pending proposals never replace an effective report selection.
export function attendanceRevisionReviewComparison(result:AttendanceRevisionReviewResult){
  const r=parseAttendanceRevisionReviewResult(result,{siteId:result.siteId,requestId:result.requestId}),basis=r.review.application.basis;
  const previous=previewCorrection(basis,r.base.proposal),requested=previewCorrection(basis,r.review.application.proposal);
  const approved=previous.proposed.totals!,proposal=requested.proposed.totals!;
  return {kind:"unapproved_revision_comparison" as const,original:previous.original,approved:previous.proposed,requested:requested.proposed,
    changeFromApproved:{elapsedUs:proposal.elapsedUs-approved.elapsedUs,breakUs:proposal.breakUs-approved.breakUs,paidBreakUs:proposal.paidBreakUs-approved.paidBreakUs,workedUs:proposal.workedUs-approved.workedUs}};
}
export const ATTENDANCE_REVISION_REVIEW_ERRORS:Readonly<Record<string,number>>={attendance_invalid_request:400,attendance_access_denied:403,attendance_settings_required:409,
  attendance_correction_not_found:404,attendance_revision_review_too_large:422,attendance_rate_limited:429};
