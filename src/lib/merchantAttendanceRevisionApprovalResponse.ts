import {MerchantAttendanceError} from "./merchantAttendanceTime";
import {parseRevisionDecisionQuery,type RevisionDecisionQuery} from "./merchantAttendanceRevisionDecision";
import {parseRevisionApprovalResult} from "./merchantAttendanceRevisionApproval";
export function revisionApprovalQueryString(q:RevisionDecisionQuery){return new URLSearchParams(Object.entries(q).filter((e):e is [string,string]=>e[1]!==null)).toString();}
export function parseRevisionApprovalHttpQuery(url:string):RevisionDecisionQuery{
  const q=new URL(url).searchParams;
  if([...q.keys()].some(k=>!["siteId","requestId","operationId"].includes(k)||q.getAll(k).length!==1))throw new MerchantAttendanceError("attendance_invalid_request");
  return parseRevisionDecisionQuery({siteId:q.get("siteId"),requestId:q.get("requestId"),operationId:q.get("operationId")});
}
export function parseRevisionApprovalResponse(raw:unknown,q:RevisionDecisionQuery){
  if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new MerchantAttendanceError("attendance_invalid_request");const v=raw as Record<string,unknown>;
  if(v.ok!==true||typeof v.moduleEnabled!=="boolean"||v.moduleEnabled!==v.writeEnabled)throw new MerchantAttendanceError("attendance_invalid_request");
  const {ok,moduleEnabled,...body}=v;void ok;
  return {...parseRevisionApprovalResult(body,q),moduleEnabled};
}
