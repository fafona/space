import {attendanceSelfUuid} from "./merchantAttendanceSelf";
import {attendanceRecordInstant} from "./merchantAttendanceManagement";
import {MerchantAttendanceError} from "./merchantAttendanceTime";
import {parseCorrectionProposal,previewCorrection,type CorrectionProposal} from "./merchantAttendanceCorrection";
import {parseCorrectionRules,type CorrectionRules} from "./merchantAttendanceCorrectionRules";
import {parseAttendanceSessionResult,summarizeAttendanceSessionRecords,type AttendanceSessionResult,type AttendanceSessionAmounts} from "./merchantAttendanceSession";
import {parseAttendanceRevisionQuery,attendanceRevisionQueryString,type AttendanceRevisionQuery,type AttendanceRevisionCommand} from "./merchantAttendanceRevision";
import {parseRevisionDecisionCommand,type RevisionDecisionRecord} from "./merchantAttendanceRevisionDecision";

// Candidate protocol; application activation and private RPC grants remain separate.
export type RevisionCycleCommand=Extract<AttendanceRevisionCommand,{action:"withdraw"}>|(
  Extract<AttendanceRevisionCommand,{action:"submit"}>&{expectedEffectiveOperationId:string});
type RecoverableCommand=AttendanceRevisionCommand|RevisionCycleCommand;
export type RevisionCycleEffect=AttendanceSessionAmounts&{requestId:string;operationId:string;revision:number;policyRevision:number;
  action:"approve";originalLastEventId:string;recordedAt:string;employeeId:string;timeZone:string;proposal:CorrectionProposal;calculationVersion:"declaration-v1";
  lineage:{rootRequestId:string;rootOperationId:string;rootRecordedAt:string;previousOperationId:string|null}};
export type RevisionCycleItem={requestId:string;revision:number;submittedRevision:number;status:"submitted"|"withdrawn"|"approved"|"rejected";
  policyRevision:number;proposal:CorrectionProposal;reason:string;submittedAt:string;basedOn:RevisionCycleEffect;
  withdrawal:{reason:string;recordedAt:string}|null;decision:RevisionDecisionRecord|null;decisionEffect:RevisionCycleEffect|null};
export type RevisionCycleResult={protocol:"revision-self-v2";siteId:string;rootRequestId:string;mode:"prepare"|"detail";employeeId:string;workerId:string;
  asOf:string;revision:number;pendingRequestId:string|null;canSubmit:boolean;canWithdraw:boolean;approvalAvailable:false;effectiveChanged:false;
  basis:AttendanceSessionResult;currentRules:CorrectionRules;current:RevisionCycleEffect;item:RevisionCycleItem|null;
  receipt:{operationId:string;requestId:string;revision:number;action:"submit"|"withdraw";recordedAt:string;command:RecoverableCommand}|null};
function fail():never{throw new MerchantAttendanceError("attendance_invalid_request");}
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:fail();
function exact(v:Record<string,unknown>,keys:string[]){if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail();}
function number(v:unknown,min=0,max=9007199254740989){if(!Number.isSafeInteger(v)||Number(v)<min||Number(v)>max)fail();return Number(v);}
function note(v:unknown){if(typeof v!=="string"||v!==v.trim()||![...v].length||[...v].length>500||/[\u0000-\u001f\u007f-\u009f]/.test(v))fail();return v;}
function instant(v:unknown){const s=attendanceRecordInstant(v);if(s!==v)fail();return s;}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function command(raw:unknown,allowLegacy=false):RecoverableCommand{
  const c=obj(raw);if(c.action!=="submit"&&c.action!=="withdraw")fail();
  const legacy=allowLegacy&&c.action==="submit"&&!Object.hasOwn(c,"expectedEffectiveOperationId");
  exact(c,["action","operationId","expectedRevision","reason",...(c.action==="submit"?
    ["expectedBaseOperationId","expectedPolicyRevision","proposal",...(legacy?[]:["expectedEffectiveOperationId"])]:["requestId"])]);
  const common={operationId:attendanceSelfUuid(c.operationId),expectedRevision:number(c.expectedRevision,0,9007199254740988),reason:note(c.reason)};
  if(c.action==="withdraw")return {...common,action:"withdraw",requestId:attendanceSelfUuid(c.requestId)};
  return {...common,action:"submit",expectedBaseOperationId:attendanceSelfUuid(c.expectedBaseOperationId),expectedPolicyRevision:number(c.expectedPolicyRevision,1),
    proposal:parseCorrectionProposal(c.proposal),...(legacy?{}:{expectedEffectiveOperationId:attendanceSelfUuid(c.expectedEffectiveOperationId)})};
}
export function parseRevisionCycleCommand(raw:unknown):RevisionCycleCommand{return command(raw) as RevisionCycleCommand;}
export function parseRevisionCycleResult(raw:unknown,input:AttendanceRevisionQuery):RevisionCycleResult{
  const q=parseAttendanceRevisionQuery("https://local.invalid/?"+attendanceRevisionQueryString(input)),v=obj(raw);
  exact(v,["protocol","siteId","rootRequestId","mode","employeeId","workerId","asOf","revision","pendingRequestId","canSubmit","canWithdraw","approvalAvailable","effectiveChanged","basis","currentRules","current","item","receipt"]);
  if(v.protocol!=="revision-self-v2"||v.siteId!==q.siteId||v.rootRequestId!==q.baseRequestId||v.workerId!==q.expectedWorkerId||v.mode!==q.mode
    ||v.approvalAvailable!==false||v.effectiveChanged!==false||typeof v.canSubmit!=="boolean"||typeof v.canWithdraw!=="boolean")fail();
  const employeeId=attendanceSelfUuid(v.employeeId),asOf=instant(v.asOf),rev=number(v.revision),events=obj(v.basis).events;
  if(!Array.isArray(events)||events.length<2||events.length>202)fail();
  const basis=parseAttendanceSessionResult(v.basis,{siteId:q.siteId,startEventId:attendanceSelfUuid(obj(events[0]).id)});
  if(basis.workerId!==q.expectedWorkerId||basis.employeeId!==employeeId||summarizeAttendanceSessionRecords(basis).status!=="completed")fail();
  function effect(value:unknown):RevisionCycleEffect{
    const e=obj(value),l=obj(e.lineage);
    exact(e,["requestId","operationId","revision","policyRevision","action","originalLastEventId","recordedAt","employeeId","timeZone","proposal","calculationVersion","elapsedUs","workedUs","breakUs","paidBreakUs","lineage"]);
    exact(l,["rootRequestId","rootOperationId","rootRecordedAt","previousOperationId"]);
    const requestId=attendanceSelfUuid(e.requestId),operationId=attendanceSelfUuid(e.operationId),n=number(e.revision,1),policyRevision=number(e.policyRevision,1);
    const recordedAt=instant(e.recordedAt),rootOperationId=attendanceSelfUuid(l.rootOperationId),rootRecordedAt=instant(l.rootRecordedAt);
    const previousOperationId=l.previousOperationId===null?null:attendanceSelfUuid(l.previousOperationId);
    const proposal=parseCorrectionProposal(e.proposal,recordedAt),totals=previewCorrection(basis,proposal).proposed.totals??fail();
    if(e.action!=="approve"||e.calculationVersion!=="declaration-v1"||e.originalLastEventId!==basis.events.at(-1)!.id||e.employeeId!==employeeId
      ||e.timeZone!==basis.events[0].timeZone||l.rootRequestId!==q.baseRequestId||rootOperationId===q.baseRequestId||requestId===operationId
      ||basis.asOf>=rootRecordedAt||recordedAt>asOf||n>rev+1)fail();
    if(n===1){if(requestId!==q.baseRequestId||operationId!==rootOperationId||recordedAt!==rootRecordedAt||previousOperationId!==null)fail();}
    else if(requestId===q.baseRequestId||requestId===rootOperationId||operationId===rootOperationId||operationId===q.baseRequestId||recordedAt<=rootRecordedAt
      ||previousOperationId===null||previousOperationId===operationId||previousOperationId===q.baseRequestId||previousOperationId===requestId
      ||(n===2)!==(previousOperationId===rootOperationId))fail();
    for(const key of ["elapsedUs","workedUs","breakUs","paidBreakUs"] as const)if(e[key]!==totals[key])fail();
    return {requestId,operationId,revision:n,policyRevision,action:"approve",originalLastEventId:basis.events.at(-1)!.id,recordedAt,employeeId,timeZone:basis.events[0].timeZone,
      proposal,calculationVersion:"declaration-v1",...totals,lineage:{rootRequestId:q.baseRequestId,rootOperationId,rootRecordedAt,previousOperationId}};
  }
  const current=effect(v.current),pendingRequestId=v.pendingRequestId===null?null:attendanceSelfUuid(v.pendingRequestId);
  const currentRules=parseCorrectionRules(v.currentRules,{mode:"prepare",asOf,startAt:basis.events[0].occurredAt});
  if(pendingRequestId!==null&&(rev===0||[q.baseRequestId,current.lineage.rootOperationId,current.requestId,current.operationId].includes(pendingRequestId))
    ||v.canSubmit&&(pendingRequestId!==null||currentRules.issues.length>0))fail();
  function related(e:RevisionCycleEffect){
    if(e.lineage.rootOperationId!==current.lineage.rootOperationId||e.lineage.rootRecordedAt!==current.lineage.rootRecordedAt
      ||e.revision>current.revision||e.recordedAt>current.recordedAt||(e.revision===current.revision?!same(e,current):e.operationId===current.operationId||e.recordedAt>=current.recordedAt))fail();
  }
  let item:RevisionCycleItem|null=null;
  if(q.mode==="prepare"){if(v.item!==null||v.receipt!==null||v.canWithdraw)fail();}
  else{
    const i=obj(v.item);exact(i,["requestId","revision","submittedRevision","status","policyRevision","proposal","reason","submittedAt","basedOn","withdrawal","decision","decisionEffect"]);
    const submittedAt=instant(i.submittedAt),submittedRevision=number(i.submittedRevision,1),lastRevision=number(i.revision,1),policyRevision=number(i.policyRevision,1);
    const proposed=parseCorrectionProposal(i.proposal,submittedAt),basedOn=effect(i.basedOn);related(basedOn);
    if(i.requestId!==q.requestId||[q.baseRequestId,basedOn.operationId,basedOn.requestId,current.lineage.rootOperationId].includes(q.requestId!)
      ||typeof i.status!=="string"||!["submitted","withdrawn","approved","rejected"].includes(i.status)||lastRevision>rev||submittedRevision>lastRevision||basedOn.revision>submittedRevision
      ||submittedAt<=basedOn.recordedAt||submittedAt>asOf||same(proposed,basedOn.proposal)
      ||(i.status==="withdrawn"?lastRevision!==submittedRevision+1:lastRevision!==submittedRevision)
      ||(i.status==="submitted"?(pendingRequestId!==q.requestId||lastRevision!==rev||!same(basedOn,current)):pendingRequestId===q.requestId)
      ||v.canWithdraw!==(i.status==="submitted"))fail();
    let withdrawal:RevisionCycleItem["withdrawal"]=null,decision:RevisionDecisionRecord|null=null,decisionEffect:RevisionCycleEffect|null=null;
    if(i.withdrawal!==null){const w=obj(i.withdrawal);exact(w,["reason","recordedAt"]);withdrawal={reason:note(w.reason),recordedAt:instant(w.recordedAt)};
      if(withdrawal.recordedAt<=submittedAt||withdrawal.recordedAt>asOf)fail();}
    if((i.status==="withdrawn")!==(withdrawal!==null))fail();
    if(i.decision!==null){
      const d=obj(i.decision),c=obj(d.command);exact(d,["requestId","operationId","action","requestRevision","baseOperationId","evidenceToken","reason","recordedAt","command"]);
      if(Object.hasOwn(c,"siteId"))fail();
      const parsed=parseRevisionDecisionCommand({siteId:q.siteId,...c}).command,recordedAt=instant(d.recordedAt);
      if(d.requestId!==q.requestId||parsed.requestId!==q.requestId||d.operationId!==parsed.operationId||d.action!==parsed.action||d.requestRevision!==parsed.expectedRevision
        ||d.baseOperationId!==parsed.expectedBaseOperationId||d.evidenceToken!==parsed.expectedEvidence||d.reason!==parsed.reason
        ||parsed.expectedRevision!==submittedRevision||parsed.expectedBaseOperationId!==basedOn.operationId||recordedAt<=submittedAt||recordedAt>asOf
        ||[q.requestId,basedOn.requestId,basedOn.operationId,q.baseRequestId,current.lineage.rootOperationId].includes(parsed.operationId))fail();
      decision={requestId:q.requestId!,operationId:parsed.operationId,action:parsed.action,requestRevision:submittedRevision,baseOperationId:basedOn.operationId,
        evidenceToken:parsed.expectedEvidence,reason:parsed.reason,recordedAt,command:parsed};
    }
    if((i.status==="approved"||i.status==="rejected")!==(decision!==null)||decision&&(i.status==="approved")!==(decision.action==="approve"))fail();
    if(i.decisionEffect!==null){decisionEffect=effect(i.decisionEffect);related(decisionEffect);}
    if((i.status==="approved")!==(decisionEffect!==null))fail();
    if(decisionEffect&&(!decision||decisionEffect.requestId!==q.requestId||decisionEffect.operationId!==decision.operationId||decisionEffect.recordedAt!==decision.recordedAt
      ||decisionEffect.revision!==basedOn.revision+1||decisionEffect.lineage.previousOperationId!==basedOn.operationId||decisionEffect.policyRevision!==policyRevision||!same(decisionEffect.proposal,proposed)))fail();
    const terminalAt=withdrawal?.recordedAt??decision?.recordedAt;
    if(i.status!=="approved"&&current.requestId===q.requestId||terminalAt&&current.revision>basedOn.revision&&i.status!=="approved"&&current.recordedAt<=terminalAt)fail();
    item={requestId:q.requestId!,revision:lastRevision,submittedRevision,status:i.status as RevisionCycleItem["status"],policyRevision,proposal:proposed,reason:note(i.reason),submittedAt,basedOn,withdrawal,decision,decisionEffect};
  }
  let receipt:RevisionCycleResult["receipt"]=null;
  if(v.receipt!==null){
    if(!item||!q.operationId)fail();const r=obj(v.receipt);exact(r,["operationId","requestId","revision","action","recordedAt","command"]);
    const c=command(r.command,true),recordedAt=instant(r.recordedAt),n=number(r.revision,1);
    if(r.operationId!==q.operationId||c.operationId!==r.operationId||r.requestId!==q.requestId||r.action!==c.action||c.expectedRevision+1!==n||n>item.revision||recordedAt>asOf)fail();
    if(c.action==="submit"){
      const predecessor="expectedEffectiveOperationId" in c?c.expectedEffectiveOperationId:c.expectedBaseOperationId;
      if(c.operationId!==item.requestId||n!==item.submittedRevision||recordedAt!==item.submittedAt||c.reason!==item.reason||c.expectedPolicyRevision!==item.policyRevision
        ||c.expectedBaseOperationId!==current.lineage.rootOperationId||predecessor!==item.basedOn.operationId||!same(c.proposal,item.proposal))fail();
    }else if(c.requestId!==item.requestId||c.operationId===item.requestId||item.status!=="withdrawn"||n!==item.revision||recordedAt!==item.withdrawal?.recordedAt||c.reason!==item.withdrawal.reason)fail();
    receipt={operationId:q.operationId,requestId:item.requestId,revision:n,action:c.action,recordedAt,command:c};
  }
  return {protocol:"revision-self-v2",siteId:q.siteId,rootRequestId:q.baseRequestId,mode:q.mode,employeeId,workerId:q.expectedWorkerId,asOf,revision:rev,
    pendingRequestId,canSubmit:v.canSubmit,canWithdraw:v.canWithdraw,approvalAvailable:false,effectiveChanged:false,basis,currentRules,current,item,receipt};
}
