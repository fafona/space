import {attendanceSelfSite,attendanceSelfUuid} from "./merchantAttendanceSelf";
import {attendanceRecordInstant} from "./merchantAttendanceManagement";
import {attendanceTimeZone,MerchantAttendanceError} from "./merchantAttendanceTime";
import {parseCorrectionProposal,previewCorrection,type CorrectionProposal} from "./merchantAttendanceCorrection";
import {parseCorrectionRules,type CorrectionRules} from "./merchantAttendanceCorrectionRules";
import {parseAttendanceSessionResult,summarizeAttendanceSessionRecords,type AttendanceSessionResult,type AttendanceSessionAmounts} from "./merchantAttendanceSession";

export type AttendanceRevisionQuery={siteId:string;expectedWorkerId:string;baseRequestId:string;mode:"prepare"|"detail";requestId:string|null;operationId:string|null};
export type AttendanceRevisionCommand={operationId:string;expectedRevision:number;reason:string}&(
  {action:"submit";expectedBaseOperationId:string;expectedPolicyRevision:number;proposal:CorrectionProposal}|{action:"withdraw";requestId:string});
export type AttendanceRevisionInput={siteId:string;expectedWorkerId:string;baseRequestId:string;command:AttendanceRevisionCommand};
export type AttendanceRevisionItem={requestId:string;revision:number;submittedRevision:number;status:"submitted"|"withdrawn";policyRevision:number;
  proposal:CorrectionProposal;reason:string;submittedAt:string;withdrawal:{reason:string;recordedAt:string}|null};
export type AttendanceRevisionResult={siteId:string;mode:"prepare"|"detail";employeeId:string;workerId:string;asOf:string;revision:number;pendingRequestId:string|null;
  canSubmit:boolean;canWithdraw:boolean;approvalAvailable:false;effectiveChanged:false;basis:AttendanceSessionResult;currentRules:CorrectionRules;
  base:AttendanceSessionAmounts&{requestId:string;operationId:string;revision:1;policyRevision:number;proposal:CorrectionProposal;timeZone:string;recordedAt:string};
  item:AttendanceRevisionItem|null;receipt:{operationId:string;requestId:string;revision:number;action:"submit"|"withdraw";recordedAt:string;command:AttendanceRevisionCommand}|null};
function fail(code="attendance_invalid_request"):never{throw new MerchantAttendanceError(code);}
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:fail();
function exact(v:Record<string,unknown>,keys:string[]){if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail();}
function revision(v:unknown,min=0,max=9007199254740989){if(!Number.isSafeInteger(v)||Number(v)<min||Number(v)>max)fail();return Number(v);}
function note(v:unknown){if(typeof v!=="string"||v!==v.trim()||![...v].length||[...v].length>500||/[\u0000-\u001f\u007f-\u009f]/.test(v))fail();return v;}
function canonicalInstant(v:unknown){const s=attendanceRecordInstant(v);if(s!==v)fail();return s;}
function parseCommand(raw:unknown):AttendanceRevisionCommand{
  const c=obj(raw);if(c.action!=="submit"&&c.action!=="withdraw")fail();
  exact(c,["action","operationId","expectedRevision","reason",...(c.action==="submit"?["expectedBaseOperationId","expectedPolicyRevision","proposal"]:["requestId"])]);
  const common={operationId:attendanceSelfUuid(c.operationId),expectedRevision:revision(c.expectedRevision,0,9007199254740988),reason:note(c.reason)};
  return c.action==="submit"?{...common,action:"submit",expectedBaseOperationId:attendanceSelfUuid(c.expectedBaseOperationId),expectedPolicyRevision:revision(c.expectedPolicyRevision,1),proposal:parseCorrectionProposal(c.proposal)}:
    {...common,action:"withdraw",requestId:attendanceSelfUuid(c.requestId)};
}
export function parseAttendanceRevisionInput(raw:unknown):AttendanceRevisionInput{
  const v=obj(raw);exact(v,["siteId","expectedWorkerId","baseRequestId","command"]);
  return {siteId:attendanceSelfSite(v.siteId),expectedWorkerId:attendanceSelfUuid(v.expectedWorkerId),baseRequestId:attendanceSelfUuid(v.baseRequestId),command:parseCommand(v.command)};
}
export function attendanceRevisionQueryString(q:AttendanceRevisionQuery){return new URLSearchParams(Object.entries(q).filter((e):e is [string,string]=>e[1]!==null)).toString();}
export function parseAttendanceRevisionQuery(url:string):AttendanceRevisionQuery{
  const q=new URL(url).searchParams,mode=q.get("mode"),keys=["siteId","expectedWorkerId","baseRequestId","mode",...(mode==="detail"?["requestId","operationId"]:[])];
  if(mode!=="prepare"&&mode!=="detail"||[...q.keys()].some(k=>!keys.includes(k)||q.getAll(k).length!==1))fail();
  return {siteId:attendanceSelfSite(q.get("siteId")),expectedWorkerId:attendanceSelfUuid(q.get("expectedWorkerId")),baseRequestId:attendanceSelfUuid(q.get("baseRequestId")),mode,
    requestId:mode==="detail"?attendanceSelfUuid(q.get("requestId")):null,operationId:mode==="detail"&&q.has("operationId")?attendanceSelfUuid(q.get("operationId")):null};
}
export function parseAttendanceRevisionResult(raw:unknown,query:AttendanceRevisionQuery):AttendanceRevisionResult{
  const q=parseAttendanceRevisionQuery("https://local.invalid/?"+attendanceRevisionQueryString(query)),v=obj(raw);
  exact(v,["siteId","mode","employeeId","workerId","asOf","revision","pendingRequestId","canSubmit","canWithdraw","approvalAvailable","effectiveChanged","basis","currentRules","base","item","receipt"]);
  if(v.siteId!==q.siteId||v.workerId!==q.expectedWorkerId||v.mode!==q.mode||v.approvalAvailable!==false||v.effectiveChanged!==false||typeof v.canSubmit!=="boolean"||typeof v.canWithdraw!=="boolean")fail();
  const employeeId=attendanceSelfUuid(v.employeeId),asOf=canonicalInstant(v.asOf),rev=revision(v.revision),b=obj(v.base);
  exact(b,["requestId","operationId","revision","policyRevision","proposal","timeZone","recordedAt","elapsedUs","breakUs","paidBreakUs","workedUs"]);
  if(b.requestId!==q.baseRequestId||b.revision!==1)fail();
  const basisRaw=obj(v.basis),events=basisRaw.events;if(!Array.isArray(events)||events.length<2||events.length>202)fail();
  const basis=parseAttendanceSessionResult(v.basis,{siteId:q.siteId,startEventId:attendanceSelfUuid(obj(events[0]).id)});
  const recordedAt=canonicalInstant(b.recordedAt),proposal=parseCorrectionProposal(b.proposal,recordedAt),timeZone=attendanceTimeZone(b.timeZone as string);
  if(basis.workerId!==q.expectedWorkerId||basis.employeeId!==employeeId||basis.asOf>=recordedAt||recordedAt>asOf
    ||summarizeAttendanceSessionRecords(basis).status!=="completed"||timeZone!==basis.events[0].timeZone)fail();
  const totals=previewCorrection(basis,proposal).proposed.totals!;
  for(const k of ["elapsedUs","breakUs","paidBreakUs","workedUs"] as const)if(b[k]!==totals[k])fail();
  const base={requestId:q.baseRequestId,operationId:attendanceSelfUuid(b.operationId),revision:1 as const,policyRevision:revision(b.policyRevision,1),proposal,timeZone,recordedAt,...totals};
  const currentRules=parseCorrectionRules(v.currentRules,{mode:"prepare",asOf,startAt:basis.events[0].occurredAt});
  const pendingRequestId=v.pendingRequestId===null?null:attendanceSelfUuid(v.pendingRequestId);
  if((rev%2===1)!==(pendingRequestId!==null)||pendingRequestId===base.requestId||pendingRequestId===base.operationId||v.canSubmit&&(pendingRequestId!==null||currentRules.issues.length>0))fail();
  let item:AttendanceRevisionItem|null=null;
  if(q.mode==="prepare"){if(v.item!==null||v.receipt!==null||v.canWithdraw)fail();}
  else{
    const i=obj(v.item);exact(i,["requestId","revision","submittedRevision","status","policyRevision","proposal","reason","submittedAt","withdrawal"]);
    const submittedAt=canonicalInstant(i.submittedAt),submittedRevision=revision(i.submittedRevision,1),lastRevision=revision(i.revision,1);
    const newProposal=parseCorrectionProposal(i.proposal,submittedAt);
    if(i.requestId!==q.requestId||i.requestId===base.requestId||i.requestId===base.operationId||submittedRevision%2!==1||i.status!=="submitted"&&i.status!=="withdrawn"||submittedAt<=recordedAt||submittedAt>asOf||lastRevision>rev
      ||i.status==="submitted"&&(lastRevision!==submittedRevision||pendingRequestId!==q.requestId||lastRevision!==rev)
      ||i.status==="withdrawn"&&(lastRevision!==submittedRevision+1||pendingRequestId===q.requestId)||JSON.stringify(newProposal)===JSON.stringify(base.proposal))fail();
    let withdrawal=null;
    if(i.withdrawal!==null){const w=obj(i.withdrawal);exact(w,["reason","recordedAt"]);withdrawal={reason:note(w.reason),recordedAt:canonicalInstant(w.recordedAt)};
      if(withdrawal.recordedAt<=submittedAt||withdrawal.recordedAt>asOf)fail();}
    if((i.status==="withdrawn")!==(withdrawal!==null)||v.canWithdraw!==(i.status==="submitted"))fail();
    item={requestId:q.requestId!,revision:lastRevision,submittedRevision,status:i.status,policyRevision:revision(i.policyRevision,1),proposal:newProposal,reason:note(i.reason),submittedAt,withdrawal};
  }
  let receipt:AttendanceRevisionResult["receipt"]=null;
  if(v.receipt!==null){
    if(!item||!q.operationId)fail();const r=obj(v.receipt);exact(r,["operationId","requestId","revision","action","recordedAt","command"]);
    const command=parseCommand(r.command),at=canonicalInstant(r.recordedAt),n=revision(r.revision,1);
    if(r.operationId!==q.operationId||command.operationId!==r.operationId||r.requestId!==q.requestId||r.action!==command.action||command.expectedRevision+1!==n||n>item.revision||at>asOf)fail();
    if(command.action==="submit"?(r.operationId!==item.requestId||n!==item.submittedRevision||at!==item.submittedAt||command.reason!==item.reason||command.expectedPolicyRevision!==item.policyRevision||command.expectedBaseOperationId!==base.operationId||JSON.stringify(command.proposal)!==JSON.stringify(item.proposal)):
      (command.requestId!==item.requestId||item.status!=="withdrawn"||n!==item.revision||at!==item.withdrawal?.recordedAt||command.reason!==item.withdrawal.reason))fail();
    receipt={operationId:q.operationId,requestId:item.requestId,revision:n,action:command.action,recordedAt:at,command};
  }
  return {siteId:q.siteId,mode:q.mode,workerId:q.expectedWorkerId,employeeId,asOf,revision:rev,pendingRequestId,canSubmit:v.canSubmit,canWithdraw:v.canWithdraw,
    approvalAvailable:false,effectiveChanged:false,basis,currentRules,base,item,receipt};
}
export const ATTENDANCE_REVISION_ERRORS:Readonly<Record<string,number>>={attendance_invalid_request:400,attendance_invalid_instant:400,attendance_invalid_content_type:415,attendance_body_too_large:413,
  attendance_application_window_protocol_required:409,
  attendance_period_sealed:409,
  attendance_access_denied:403,attendance_platform_paused:403,attendance_settings_required:409,attendance_worker_changed:409,attendance_revision_base_not_found:404,attendance_correction_not_found:404,
  attendance_operation_conflict:409,attendance_version_conflict:409,attendance_correction_pending:409,attendance_correction_closed:409,attendance_revision_base_changed:409,attendance_revision_unchanged:409,
  attendance_correction_policy_required:409,attendance_correction_policy_changed:409,attendance_correction_window_expired:409,attendance_correction_period_locked:409,attendance_correction_rules_unavailable:409,
  attendance_correction_basis_changed:409,attendance_correction_unsupported_basis:409,attendance_session_too_large:422,attendance_session_invalid_records:422,attendance_session_span_too_long:422,
  attendance_revision_too_large:422,attendance_rate_limited:429};
