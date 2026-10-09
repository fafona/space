import {revisionResponse} from "./attendance-revision-model";
import type {AttendanceRevisionReviewResult} from "../../src/lib/merchantAttendanceRevisionReview";
export const revisionReviewQuery={siteId:"99990001",requestId:"00000000-0000-4000-8000-000000000300"};
export function revisionReviewResponse(mode:"submitted"|"withdrawn"="submitted"):AttendanceRevisionReviewResult{
  const r=revisionResponse(mode),i=r.item!,summary={requestId:i.requestId,startEventId:r.basis.events[0].id,revision:i.revision,status:i.status,submittedAt:i.submittedAt,startAt:i.proposal.startAt,endAt:i.proposal.endAt};
  return {siteId:r.siteId,requestId:i.requestId,asOf:r.asOf,reviewOnly:true,approvalAvailable:false,effectiveChanged:false,
    submittedRevision:i.submittedRevision,ledgerRevision:r.revision,pendingRequestId:r.pendingRequestId,base:r.base,evidenceToken:"a".repeat(32),
    blockers:mode==="submitted"?[]:["withdrawn"],checksPassed:mode==="submitted",rejectionChecksPassed:mode==="submitted",
    review:{siteId:r.siteId,asOf:r.asOf,mode:"detail",approvalAvailable:false,rulesEnforced:true,
      item:{...summary,employeeId:r.employeeId,workerId:r.workerId,workerName:"合成员工",workerNo:"TEST-REVISION"},
      application:{siteId:r.siteId,employeeId:r.employeeId,workerId:r.workerId,asOf:r.asOf,mode:"detail",canRequest:false,rulesEnforced:true,
        rules:{...r.currentRules,binding:"bound"},item:summary,basis:r.basis,proposal:i.proposal,reason:i.reason,withdrawal:i.withdrawal,receipt:null},
      evidence:{bindingCurrent:true,ownApplication:false,basisIssue:null,currentBasis:{...structuredClone(r.basis),asOf:r.asOf},previous:null,next:null,
        employmentPeriods:[{startsOn:"2026-01-01",endsOn:null}],employmentTruncated:false}}};
}
