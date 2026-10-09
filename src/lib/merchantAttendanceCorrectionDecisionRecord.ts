import {attendanceSelfUuid} from "./merchantAttendanceSelf";
import {attendanceRecordInstant} from "./merchantAttendanceManagement";
import {MerchantAttendanceError} from "./merchantAttendanceTime";
export type CorrectionDecisionRecord={requestId:string;operationId:string;action:"approve"|"reject";requestRevision:number;evidenceToken:string;reason:string;recordedAt:string};
export function parseCorrectionDecisionRecord(raw:unknown,context:{requestId:string;revision:number;submittedAt:string;asOf:string}):CorrectionDecisionRecord|null {
  if(raw===null)return null;
  const fail=():never=>{throw new MerchantAttendanceError("attendance_invalid_request");};
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return fail();const v=raw as Record<string,unknown>;
  const recordedAt=attendanceRecordInstant(v.recordedAt);
  if(v.requestId!==context.requestId||v.requestRevision!==context.revision||!Number.isSafeInteger(v.requestRevision)||Number(v.requestRevision)<1
    ||(v.action!=="approve"&&v.action!=="reject")||typeof v.evidenceToken!=="string"||!/^[0-9a-f]{32}$/.test(v.evidenceToken)
    ||typeof v.reason!=="string"||!v.reason.trim()||v.reason!==v.reason.trim()||[...v.reason].length>500||/[\u0000-\u001f\u007f-\u009f]/.test(v.reason)
    ||recordedAt<=context.submittedAt||recordedAt>context.asOf)return fail();
  return {requestId:context.requestId,operationId:attendanceSelfUuid(v.operationId),action:v.action as "approve"|"reject",requestRevision:Number(v.requestRevision),
    evidenceToken:v.evidenceToken as string,reason:v.reason as string,recordedAt};
}
