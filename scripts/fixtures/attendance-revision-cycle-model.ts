import type {RevisionCycleEffect,RevisionCycleItem,RevisionCycleResult} from "../../src/lib/merchantAttendanceRevisionCycle";
import {previewCorrection} from "../../src/lib/merchantAttendanceCorrection";
import {revisionQuery as q,revisionResponse as old,revisionCommand as legacy,revisionDetail as detail} from "./attendance-revision-model";
import {correctionId as id} from "./attendance-correction-model";
// Synthetic protocol fixtures, not a database or authorization simulation.
export function wire(status:RevisionCycleItem["status"]|"prepare"="prepare",legacyBase=false):RevisionCycleResult{
  const o=old(),b=o.base,root:RevisionCycleEffect={...b,action:"approve",originalLastEventId:o.basis.events.at(-1)!.id,employeeId:o.employeeId,calculationVersion:"declaration-v1",
    lineage:{rootRequestId:b.requestId,rootOperationId:b.operationId,rootRecordedAt:b.recordedAt,previousOperationId:null}};
  const p={...structuredClone(b.proposal),endAt:"2026-09-28T15:30:00.000000Z"};
  const basedOn=legacyBase?root:{...root,requestId:id(290),operationId:id(291),revision:2,recordedAt:"2026-09-30T12:30:00.000000Z",proposal:p,
    ...previewCorrection(o.basis,p).proposed.totals!,lineage:{...root.lineage,previousOperationId:root.operationId}};
  const submittedRevision=legacyBase?1:2,submittedAt="2026-09-30T13:00:00.000000Z",terminalAt="2026-09-30T13:01:00.000000Z";
  const item:RevisionCycleItem|null=status==="prepare"?null:{requestId:legacy.operationId,revision:submittedRevision+(status==="withdrawn"?1:0),submittedRevision,status,policyRevision:1,
    proposal:structuredClone(legacy.proposal),reason:legacy.reason,submittedAt,basedOn:structuredClone(basedOn),withdrawal:null,decision:null,decisionEffect:null};
  let current=structuredClone(basedOn);
  if(item?.status==="withdrawn")item.withdrawal={reason:"撤回",recordedAt:terminalAt};
  if(item&&(status==="approved"||status==="rejected")){
    const c={action:status==="approved"?"approve" as const:"reject" as const,requestId:item.requestId,operationId:id(501),expectedRevision:submittedRevision,
      expectedEvidence:"a".repeat(32),expectedBaseOperationId:basedOn.operationId,reason:"核对结果"};
    item.decision={requestId:item.requestId,operationId:c.operationId,action:c.action,requestRevision:submittedRevision,baseOperationId:basedOn.operationId,
      evidenceToken:c.expectedEvidence,reason:c.reason,recordedAt:terminalAt,command:c};
    if(status==="approved"){
      current={...current,requestId:item.requestId,operationId:c.operationId,revision:basedOn.revision+1,recordedAt:terminalAt,proposal:structuredClone(item.proposal),
        ...previewCorrection(o.basis,item.proposal).proposed.totals!,lineage:{...current.lineage,previousOperationId:basedOn.operationId}};
      item.decisionEffect=structuredClone(current);
    }
  }
  return {protocol:"revision-self-v2",siteId:o.siteId,rootRequestId:q.baseRequestId,mode:status==="prepare"?"prepare":"detail",employeeId:o.employeeId,workerId:o.workerId,
    asOf:o.asOf,revision:item?.revision??submittedRevision-1,pendingRequestId:status==="submitted"?legacy.operationId:null,canSubmit:status!=="submitted",canWithdraw:status==="submitted",
    approvalAvailable:false,effectiveChanged:false,basis:o.basis,currentRules:o.currentRules,current,item,receipt:null};
}
export function receipt(v:RevisionCycleResult,action:"submit"|"withdraw"="submit",oldCommand=false){
  const i=v.item!,c=action==="submit"?{...structuredClone(legacy),expectedRevision:i.submittedRevision-1,
    ...(oldCommand?{}:{expectedEffectiveOperationId:i.basedOn.operationId})}:{action,operationId:id(502),requestId:i.requestId,expectedRevision:i.revision-1,reason:i.withdrawal!.reason};
  v.receipt={operationId:c.operationId,requestId:i.requestId,revision:action==="submit"?i.submittedRevision:i.revision,action,
    recordedAt:action==="submit"?i.submittedAt:i.withdrawal!.recordedAt,command:c};return detail(c.operationId);
}
export function advance(v:RevisionCycleResult){
  const p={...structuredClone(v.current.proposal),endAt:"2026-09-28T14:00:00.000000Z"},prior=v.current;
  v.current={...prior,requestId:id(910),operationId:id(911),revision:prior.revision+1,recordedAt:"2026-09-30T13:30:00.000000Z",proposal:p,
    ...previewCorrection(v.basis,p).proposed.totals!,lineage:{...prior.lineage,previousOperationId:prior.operationId}};v.revision++;
}
