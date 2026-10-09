import {attendanceSelfUuid} from "./merchantAttendanceSelf";
import {attendanceRecordInstant} from "./merchantAttendanceManagement";
import {MerchantAttendanceError} from "./merchantAttendanceTime";
import {parseCorrectionProposal,previewCorrection} from "./merchantAttendanceCorrection";
import {parseCorrectionDecisionSnapshot,CORRECTION_DECISION_ERRORS,type CorrectionDecisionQuery} from "./merchantAttendanceCorrectionDecision";
import type {RevisionCycleEffect} from "./merchantAttendanceRevisionCycle";

// Initial decision is immutable history. Current source can belong to a later
// revision, or another approved application for the same original shift.
export type CurrentCorrectionDecisionResult=Omit<ReturnType<typeof parseCorrectionDecisionSnapshot>,"effective">&{
  protocol:"correction-decision-v2";decisionEffect:ReturnType<typeof parseCorrectionDecisionSnapshot>["effective"];
  current:RevisionCycleEffect|null;writeEnabled:boolean;replayed:boolean;effectiveChanged:boolean;
};
function fail():never{throw new MerchantAttendanceError("attendance_invalid_request");}
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:fail();
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const instant=(v:unknown)=>{const s=attendanceRecordInstant(v);if(s!==v)fail();return s;};
const integer=(v:unknown,max:number)=>Number.isSafeInteger(v)&&Number(v)>=1&&Number(v)<=max?Number(v):fail();
function exact(v:Record<string,unknown>,keys:string[]){if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail();}
export function parseCurrentCorrectionDecision(raw:unknown,q:CorrectionDecisionQuery):CurrentCorrectionDecisionResult{
  const v=object(raw);exact(v,["protocol","siteId","asOf","review","evidenceToken","blockers","canApprove","canReject","decision","receipt","effective","current","writeEnabled","replayed","effectiveChanged"]);
  if(v.protocol!=="correction-decision-v2"||["writeEnabled","replayed","effectiveChanged"].some(k=>typeof v[k]!=="boolean"))fail();
  const {effective:decisionEffect,...snapshot}=parseCorrectionDecisionSnapshot(v,q),a=snapshot.review.application,basis=a.basis;
  const asOf=instant(v.asOf),fresh=snapshot.receipt!==null&&!v.replayed;
  if(v.replayed&&!snapshot.receipt||fresh&&(!v.writeEnabled||snapshot.receipt!.recordedAt<snapshot.review.asOf)
    ||v.effectiveChanged!==Boolean(fresh&&snapshot.receipt!.action==="approve"))fail();
  let current:RevisionCycleEffect|null=null;
  if(v.current!==null){
    const e=object(v.current),l=object(e.lineage);
    exact(e,["requestId","operationId","revision","policyRevision","action","originalLastEventId","recordedAt","employeeId","timeZone","proposal","calculationVersion","elapsedUs","workedUs","breakUs","paidBreakUs","lineage"]);
    exact(l,["rootRequestId","rootOperationId","rootRecordedAt","previousOperationId"]);
    const requestId=attendanceSelfUuid(e.requestId),operationId=attendanceSelfUuid(e.operationId),revision=integer(e.revision,2147483647),policyRevision=integer(e.policyRevision,9007199254740989);
    const recordedAt=instant(e.recordedAt),rootRequestId=attendanceSelfUuid(l.rootRequestId),rootOperationId=attendanceSelfUuid(l.rootOperationId),rootRecordedAt=instant(l.rootRecordedAt);
    const previousOperationId=l.previousOperationId===null?null:attendanceSelfUuid(l.previousOperationId),proposal=parseCorrectionProposal(e.proposal,recordedAt),compared=previewCorrection(basis,proposal),totals=compared.proposed.totals??fail();
    if(compared.original.status!=="completed"||e.action!=="approve"||e.calculationVersion!=="declaration-v1"||e.employeeId!==basis.employeeId
      ||e.originalLastEventId!==basis.events.at(-1)!.id||e.timeZone!==basis.events[0].timeZone
      ||compared.original.endAt!>=rootRecordedAt||recordedAt>asOf||rootRequestId===rootOperationId||requestId===operationId)fail();
    if(revision===1){if(requestId!==rootRequestId||operationId!==rootOperationId||recordedAt!==rootRecordedAt||previousOperationId!==null)fail();}
    else if([rootRequestId,rootOperationId].includes(requestId)||[rootRequestId,rootOperationId].includes(operationId)||recordedAt<=rootRecordedAt||previousOperationId===null
      ||[requestId,operationId,rootRequestId].includes(previousOperationId)||(revision===2)!==(previousOperationId===rootOperationId))fail();
    for(const key of ["elapsedUs","workedUs","breakUs","paidBreakUs"] as const)if(e[key]!==totals[key])fail();
    current={requestId,operationId,revision,policyRevision,action:"approve",originalLastEventId:basis.events.at(-1)!.id,recordedAt,employeeId:basis.employeeId,
      timeZone:basis.events[0].timeZone,proposal,calculationVersion:"declaration-v1",...totals,lineage:{rootRequestId,rootOperationId,rootRecordedAt,previousOperationId}};
  }
  if(snapshot.blockers.includes("already_effective")!==(current!==null))fail();
  if(decisionEffect){
    if(!current||current.lineage.rootRequestId!==q.requestId||current.lineage.rootOperationId!==decisionEffect.operationId||current.lineage.rootRecordedAt!==decisionEffect.recordedAt)fail();
    if(current.revision===1){
      if(current.policyRevision!==decisionEffect.policyRevision||!same(current.proposal,decisionEffect.proposal))fail();
      for(const key of ["elapsedUs","workedUs","breakUs","paidBreakUs"] as const)if(current[key]!==decisionEffect[key])fail();
    }else if(fresh)fail();
  }else if(current&&(current.lineage.rootRequestId===q.requestId||current.requestId===q.requestId))fail();
  if(v.canApprove!==(v.writeEnabled&&snapshot.blockers.length===0)
    ||v.canReject!==(v.writeEnabled&&a.item.status==="submitted"&&!snapshot.blockers.some(k=>["withdrawn","already_decided","binding_changed","self_review"].includes(k))))fail();
  return {...snapshot,protocol:"correction-decision-v2",decisionEffect,current,writeEnabled:v.writeEnabled as boolean,replayed:v.replayed as boolean,effectiveChanged:v.effectiveChanged as boolean};
}
export const CURRENT_CORRECTION_ERRORS={...CORRECTION_DECISION_ERRORS,attendance_report_version_required:409};
