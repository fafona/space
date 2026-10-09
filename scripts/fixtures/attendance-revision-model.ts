import {correctionBasis,correctionId as id,correctionSite,correctionWorker,correctionEmployee,correctionProposal,correctionRules} from "./attendance-correction-model";
import {previewCorrection} from "../../src/lib/merchantAttendanceCorrection";
import type {AttendanceRevisionQuery,AttendanceRevisionCommand,AttendanceRevisionResult} from "../../src/lib/merchantAttendanceRevision";
export const revisionQuery:AttendanceRevisionQuery={siteId:correctionSite,expectedWorkerId:correctionWorker,baseRequestId:id(100),mode:"prepare",requestId:null,operationId:null};
export const revisionAt="2026-09-30T13:00:00.000000Z",revisionWithdrawAt="2026-09-30T13:01:00.000000Z",revisionAsOf="2026-09-30T14:00:00.000000Z";
export const revisionCommand:Extract<AttendanceRevisionCommand,{action:"submit"}>={action:"submit",operationId:id(300),expectedRevision:0,expectedBaseOperationId:id(200),expectedPolicyRevision:1,reason:"申请重新核对",
  proposal:{...structuredClone(correctionProposal),endAt:"2026-09-28T16:30:00.000000Z"}};
export const revisionWithdrawal:Extract<AttendanceRevisionCommand,{action:"withdraw"}>={action:"withdraw",operationId:id(301),requestId:id(300),expectedRevision:1,reason:"撤回新申请"};
export function revisionResponse(mode:"prepare"|"submitted"|"withdrawn"="prepare",receipt:AttendanceRevisionCommand|null=null):AttendanceRevisionResult{
  const basis=correctionBasis(),totals=previewCorrection(basis,correctionProposal).proposed.totals!;
  return {siteId:correctionSite,mode:mode==="prepare"?"prepare":"detail",employeeId:correctionEmployee,workerId:correctionWorker,asOf:revisionAsOf,
    revision:mode==="prepare"?0:mode==="submitted"?1:2,pendingRequestId:mode==="submitted"?id(300):null,canSubmit:mode!=="submitted",canWithdraw:mode==="submitted",approvalAvailable:false,effectiveChanged:false,basis,
    currentRules:{...correctionRules(),checkedAt:revisionAsOf},base:{requestId:id(100),operationId:id(200),revision:1,policyRevision:1,proposal:structuredClone(correctionProposal),timeZone:"Europe/Madrid",recordedAt:"2026-09-30T12:01:00.000000Z",...totals},
    item:mode==="prepare"?null:{requestId:id(300),revision:mode==="submitted"?1:2,submittedRevision:1,status:mode,policyRevision:1,proposal:structuredClone(revisionCommand.proposal),reason:revisionCommand.reason,submittedAt:revisionAt,
      withdrawal:mode==="withdrawn"?{reason:revisionWithdrawal.reason,recordedAt:revisionWithdrawAt}:null},
    receipt:receipt?{operationId:receipt.operationId,requestId:id(300),revision:receipt.action==="submit"?1:2,action:receipt.action,recordedAt:receipt.action==="submit"?revisionAt:revisionWithdrawAt,command:structuredClone(receipt)}:null};
}
export const revisionDetail=(operationId:string|null=null):AttendanceRevisionQuery=>({...revisionQuery,mode:"detail",requestId:id(300),operationId});
