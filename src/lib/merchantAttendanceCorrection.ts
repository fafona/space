import {attendanceSelfSite,attendanceSelfUuid} from "./merchantAttendanceSelf";
import {attendanceRecordInstant} from "./merchantAttendanceManagement";
import {MerchantAttendanceError} from "./merchantAttendanceTime";
import {parseAttendanceSessionResult,summarizeAttendanceSessionRecords,type AttendanceSessionResult} from "./merchantAttendanceSession";
import {parseCorrectionRules,type CorrectionRules} from "./merchantAttendanceCorrectionRules";
import {parseCorrectionDecisionRecord,type CorrectionDecisionRecord} from "./merchantAttendanceCorrectionDecisionRecord";

export type CorrectionProposal={startAt:string;endAt:string;breaks:{startAt:string;endAt:string;paid:boolean}[]};
export type CorrectionCommand={operationId:string;expectedRevision:number;reason:string}&(
  {action:"submit";startEventId:string;expectedLastEventId:string;proposal:CorrectionProposal;expectedPolicyRevision?:number}|
  {action:"withdraw";requestId:string});
export type CorrectionQuery={siteId:string;expectedWorkerId:string}&(
  {mode:"prepare";startEventId:string}|{mode:"detail";requestId:string;operationId:string|null}|
  {mode:"list";cursorAt:string|null;cursorId:string|null});
export type CorrectionSummary={requestId:string;startEventId:string;revision:number;status:"submitted"|"withdrawn";decision?:CorrectionDecisionRecord|null;
  submittedAt:string;startAt:string;endAt:string};
export type CorrectionReceipt={operationId:string;requestId:string;revision:number;action:"submit"|"withdraw";recordedAt:string};
export const correctionStatusLabel=(item:CorrectionSummary)=>item.decision?.action==="approve"?"已批准 · 核定修订":item.decision?.action==="reject"?"已驳回":item.status==="withdrawn"?"已撤回":"已提交 · 未审批";
export type CorrectionResult={siteId:string;employeeId:string;workerId:string;canRequest:boolean;asOf:string;rulesEnforced?:true;rules?:CorrectionRules;decisionsAvailable?:true}&(
  {mode:"prepare";basis:AttendanceSessionResult;revision:number;pendingRequestId:string|null}|
  {mode:"list";items:CorrectionSummary[];nextCursor:{recordedAt:string;requestId:string}|null}|
  {mode:"detail";item:CorrectionSummary;basis:AttendanceSessionResult;proposal:CorrectionProposal;reason:string;withdrawal:{reason:string;recordedAt:string}|null;receipt:CorrectionReceipt|null});
const fail=(code="attendance_invalid_request"):never=>{throw new MerchantAttendanceError(code);};
const obj=(v:unknown):Record<string,unknown>=>!v||typeof v!=="object"||Array.isArray(v)?fail():v as Record<string,unknown>;
function exact(o:Record<string,unknown>,keys:string[]){if(Object.keys(o).length!==keys.length||keys.some(k=>!Object.hasOwn(o,k)))fail();}
const revision=(v:unknown,min=0)=>!Number.isSafeInteger(v)||(v as number)<min||(v as number)>9007199254740989?fail():v as number;
function note(v:unknown){if(typeof v!=="string"||v!==v.trim()||![...v].length||[...v].length>500||/[\u0000-\u001f\u007f-\u009f]/.test(v))return fail();return v;}
const us=(s:string)=>BigInt(Date.parse(`${s.slice(0,23)}Z`))*BigInt(1000)+BigInt(s.slice(23,26));
export function parseCorrectionProposal(raw:unknown,asOf?:string):CorrectionProposal {
  const v=obj(raw);exact(v,["startAt","endAt","breaks"]);
  const startAt=attendanceRecordInstant(v.startAt),endAt=attendanceRecordInstant(v.endAt);
  if(endAt<=startAt||us(endAt)-us(startAt)>BigInt(2678400000000)||asOf&&endAt>attendanceRecordInstant(asOf)
    ||!Array.isArray(v.breaks)||v.breaks.length>32)fail();
  let previous=startAt;
  const breaks=(v.breaks as unknown[]).map(raw=>{const b=obj(raw);exact(b,["startAt","endAt","paid"]);
    const from=attendanceRecordInstant(b.startAt),to=attendanceRecordInstant(b.endAt);
    if(from<previous||to<=from||to>endAt||typeof b.paid!=="boolean")fail();previous=to;
    return {startAt:from,endAt:to,paid:b.paid as boolean};});
  return {startAt,endAt,breaks};
}
export function parseCorrectionCommand(raw:unknown):{siteId:string;expectedWorkerId:string;command:CorrectionCommand}{
  const v=obj(raw);if(v.action!=="submit"&&v.action!=="withdraw")fail();
  exact(v,["siteId","expectedWorkerId","action","operationId","expectedRevision","reason",...(v.action==="submit"?["startEventId","expectedLastEventId","proposal",...(Object.hasOwn(v,"expectedPolicyRevision")?["expectedPolicyRevision"]:[])]:["requestId"])]);
  const base={siteId:attendanceSelfSite(v.siteId),expectedWorkerId:attendanceSelfUuid(v.expectedWorkerId)};
  const common={operationId:attendanceSelfUuid(v.operationId),expectedRevision:revision(v.expectedRevision),reason:note(v.reason)};
  if(common.expectedRevision>9007199254740988)fail();
  return {...base,command:v.action==="submit"?{...common,action:"submit",startEventId:attendanceSelfUuid(v.startEventId),expectedLastEventId:attendanceSelfUuid(v.expectedLastEventId),proposal:parseCorrectionProposal(v.proposal),...(Object.hasOwn(v,"expectedPolicyRevision")?{expectedPolicyRevision:revision(v.expectedPolicyRevision,1)}:{})}:
    {...common,action:"withdraw",requestId:attendanceSelfUuid(v.requestId)}};
}
export function correctionQueryString(q:CorrectionQuery){const params=new URLSearchParams();for(const [k,v] of Object.entries(q))if(v!==null)params.set(k,v);return params.toString();}
export function parseCorrectionQuery(url:string):CorrectionQuery{
  const q=new URL(url).searchParams,mode=q.get("mode");if(!["prepare","detail","list"].includes(mode??""))fail();
  const keys=["siteId","expectedWorkerId","mode",...(mode==="prepare"?["startEventId"]:mode==="detail"?["requestId","operationId"]:["cursorAt","cursorId"])];
  for(const k of q.keys())if(!keys.includes(k)||q.getAll(k).length!==1)fail();
  const base={siteId:attendanceSelfSite(q.get("siteId")),expectedWorkerId:attendanceSelfUuid(q.get("expectedWorkerId"))};
  if(mode==="prepare")return {...base,mode,startEventId:attendanceSelfUuid(q.get("startEventId"))};
  if(mode==="detail")return {...base,mode,requestId:attendanceSelfUuid(q.get("requestId")),operationId:q.has("operationId")?attendanceSelfUuid(q.get("operationId")):null};
  const cursorAt=q.has("cursorAt")?attendanceRecordInstant(q.get("cursorAt")):null,cursorId=q.has("cursorId")?attendanceSelfUuid(q.get("cursorId")):null;
  if((cursorAt===null)!==(cursorId===null))fail();return {...base,mode:"list",cursorAt,cursorId};
}
function summary(raw:unknown,asOf:string):CorrectionSummary{
  const o=obj(raw);if(o.status!=="submitted"&&o.status!=="withdrawn")return fail();
  const startAt=attendanceRecordInstant(o.startAt),endAt=attendanceRecordInstant(o.endAt),submittedAt=attendanceRecordInstant(o.submittedAt);
  if(endAt<=startAt||endAt>submittedAt||submittedAt>asOf||us(endAt)-us(startAt)>BigInt(2678400000000))fail();
  const requestId=attendanceSelfUuid(o.requestId),rev=revision(o.revision,1);
  const decision=o.decision===undefined?{}:{decision:parseCorrectionDecisionRecord(o.decision,{requestId,revision:rev,submittedAt,asOf})};
  if(decision.decision&&o.status!=="submitted")fail();
  return {requestId,startEventId:attendanceSelfUuid(o.startEventId),revision:rev,status:o.status,submittedAt,startAt,endAt,...decision};
}
export function parseCorrectionResult(raw:unknown,q:CorrectionQuery,requireRules=false,requireDecisions=false):CorrectionResult{
  const v=obj(raw);if(v.siteId!==q.siteId||v.workerId!==q.expectedWorkerId||v.mode!==q.mode||typeof v.canRequest!=="boolean")fail();
  if((requireRules||v.rulesEnforced!==undefined)&&v.rulesEnforced!==true)fail();
  if((requireDecisions||v.decisionsAvailable!==undefined)&&v.decisionsAvailable!==true)fail();
  const base={siteId:q.siteId,employeeId:attendanceSelfUuid(v.employeeId),workerId:q.expectedWorkerId,asOf:attendanceRecordInstant(v.asOf),canRequest:v.canRequest as boolean,...(v.rulesEnforced===true?{rulesEnforced:true as const}:{}),...(v.decisionsAvailable===true?{decisionsAvailable:true as const}:{})};
  const basis=(raw:unknown,start:string)=>{const parsed=parseAttendanceSessionResult(raw,{siteId:q.siteId,startEventId:start});
    if(parsed.workerId!==base.workerId||parsed.employeeId!==base.employeeId||parsed.asOf>base.asOf||parsed.events.length>202)fail();return parsed;};
  if(q.mode==="prepare"){
    const rev=revision(v.revision),pendingRequestId=v.pendingRequestId===null?null:attendanceSelfUuid(v.pendingRequestId);
    if(rev===0&&pendingRequestId!==null)fail();
    const original=basis(v.basis,q.startEventId);
    const rules=v.rulesEnforced===true?{rules:parseCorrectionRules(v.rules,{mode:"prepare",asOf:base.asOf,startAt:original.events[0].occurredAt})}:{};
    return {...base,...rules,mode:q.mode,basis:original,revision:rev,pendingRequestId};
  }
  if(q.mode==="list"){
    if(!Array.isArray(v.items)||v.items.length>25)fail();let previous=q.cursorId?{submittedAt:q.cursorAt!,requestId:q.cursorId}:null;
    const ids=new Set<string>();const items=(v.items as unknown[]).map(raw=>{const i=summary(raw,base.asOf);if(v.decisionsAvailable===true&&i.decision===undefined)fail();
      if(ids.has(i.requestId)||previous&&(i.submittedAt>previous.submittedAt||i.submittedAt===previous.submittedAt&&i.requestId>=previous.requestId))fail();
      previous=i;ids.add(i.requestId);return i;});
    let nextCursor=null;if(v.nextCursor!==null){const c=obj(v.nextCursor);nextCursor={recordedAt:attendanceRecordInstant(c.recordedAt),requestId:attendanceSelfUuid(c.requestId)};
      if(items.length!==25||items.at(-1)?.submittedAt!==nextCursor.recordedAt||items.at(-1)?.requestId!==nextCursor.requestId)fail();}
    return {...base,mode:"list",items,nextCursor};
  }
  const item=summary(v.item,base.asOf);if(item.requestId!==q.requestId)fail();
  if(v.decisionsAvailable===true&&(item.decision===undefined||item.decision&&base.canRequest))fail();
  const original=basis(v.basis,item.startEventId),proposal=parseCorrectionProposal(v.proposal,item.submittedAt);
  if(proposal.startAt!==item.startAt||proposal.endAt!==item.endAt||original.asOf>item.submittedAt)fail();
  let withdrawal=null;if(v.withdrawal!==null){const w=obj(v.withdrawal);withdrawal={reason:note(w.reason),recordedAt:attendanceRecordInstant(w.recordedAt)};
    if(withdrawal.recordedAt<item.submittedAt||withdrawal.recordedAt>base.asOf)fail();}
  if((item.status==="withdrawn")!==(withdrawal!==null))fail();
  let receipt=null;if(v.receipt!==null){const r=obj(v.receipt);if(r.action!=="submit"&&r.action!=="withdraw")fail();
    receipt={operationId:attendanceSelfUuid(r.operationId),requestId:attendanceSelfUuid(r.requestId),revision:revision(r.revision,1),action:r.action as "submit"|"withdraw",recordedAt:attendanceRecordInstant(r.recordedAt)};
    if(receipt.operationId!==q.operationId||receipt.requestId!==q.requestId||receipt.revision>item.revision||receipt.recordedAt>base.asOf||receipt.recordedAt<item.submittedAt
      ||receipt.action==="submit"&&(receipt.operationId!==item.requestId||receipt.recordedAt!==item.submittedAt||item.status==="submitted"&&receipt.revision!==item.revision)
      ||receipt.action==="withdraw"&&(item.status!=="withdrawn"||receipt.revision!==item.revision||receipt.recordedAt!==withdrawal?.recordedAt))fail();}
  const rules=v.rulesEnforced===true?{rules:parseCorrectionRules(v.rules,{mode:"detail",asOf:base.asOf,startAt:original.events[0].occurredAt,submittedAt:item.submittedAt})}:{};
  return {...base,...rules,mode:"detail",item,basis:original,proposal,reason:note(v.reason),withdrawal,receipt};
}
// A declaration preview only: never feeds applyAttendanceEvent or current clock state.
export function previewCorrection(basis:AttendanceSessionResult,raw:CorrectionProposal){
  const original=parseAttendanceSessionResult(basis,{siteId:basis.siteId,startEventId:basis.events[0]?.id});
  const p=parseCorrectionProposal(raw),first=original.events[0];
  const spans=[{action:"clock_in" as const,occurredAt:p.startAt,breakPaid:null},...p.breaks.flatMap(b=>[
    {action:"break_start" as const,occurredAt:b.startAt,breakPaid:b.paid},{action:"break_end" as const,occurredAt:b.endAt,breakPaid:null}]),
    {action:"clock_out" as const,occurredAt:p.endAt,breakPaid:null}];
  const report=summarizeAttendanceSessionRecords({...original,events:spans.map((s,n)=>({...first,...s,sequence:n+1}))});
  return {kind:"unapproved_declaration" as const,original:summarizeAttendanceSessionRecords(original),proposed:report};
}
export const CORRECTION_ERRORS:Readonly<Record<string,number>>={attendance_invalid_request:400,attendance_invalid_instant:400,attendance_access_denied:403,
  attendance_application_window_protocol_required:409,
  attendance_period_sealed:409,
  attendance_correction_decided:409,
  attendance_correction_policy_required:409,attendance_correction_policy_changed:409,attendance_correction_window_expired:409,
  attendance_correction_period_locked:409,attendance_correction_rules_unavailable:409,
  attendance_invalid_content_type:415,attendance_body_too_large:413,
  attendance_platform_paused:403,attendance_worker_changed:409,attendance_settings_required:409,attendance_version_conflict:409,
  attendance_operation_conflict:409,attendance_correction_pending:409,attendance_correction_closed:409,attendance_correction_basis_changed:409,
  attendance_correction_not_found:404,attendance_session_not_found:404,attendance_session_invalid_records:422,attendance_session_too_large:422,
  attendance_session_span_too_long:422,attendance_correction_unsupported_basis:422,attendance_rate_limited:429};
