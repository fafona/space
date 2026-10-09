import {attendanceSelfSite,attendanceSelfUuid} from "./merchantAttendanceSelf";
import {attendanceRecordInstant} from "./merchantAttendanceManagement";
import {MerchantAttendanceError} from "./merchantAttendanceTime";
import {REVISION_APPROVAL_ERRORS} from "./merchantAttendanceRevisionApproval";
export const REVISION_HISTORY_STATUSES=["all","submitted","approved","rejected","withdrawn"] as const;
export type RevisionHistoryStatus=typeof REVISION_HISTORY_STATUSES[number];
type Paging={siteId:string;status:RevisionHistoryStatus;asOf:string|null;cursorAt:string|null;cursorId:string|null};
export type RevisionHistoryQuery=Paging&({access:"owner";scope:"submission-period";fromAt:string;toAt:string}|{access:"self";scope:"root-history";expectedWorkerId:string;rootRequestId:string});
export type RevisionHistoryItem={requestId:string;rootRequestId:string;workerId:string;employeeId:string;workerName:string;workerNo:string;submittedRevision:number;submittedAt:string;
  proposedStartAt:string;proposedEndAt:string;status:Exclude<RevisionHistoryStatus,"all">;closedAt:string|null;decisionOperationId:string|null};
export type RevisionHistoryResult={protocol:"revision-history-v1";readOnly:true;siteId:string;access:"owner"|"self";employeeId:string|null;workerId:string|null;rootRequestId:string|null;asOf:string;
  items:RevisionHistoryItem[];scanned:number;nextCursor:{recordedAt:string;requestId:string}|null};
const fail=():never=>{throw new MerchantAttendanceError("attendance_invalid_request");};
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:fail();
function exact(v:Record<string,unknown>,keys:string[]){if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail();}
const instant=(v:unknown)=>{const s=attendanceRecordInstant(v);return s===v?s:fail();};
const micro=(v:string)=>BigInt(Date.parse(v.slice(0,23)+'Z'))*BigInt(1000)+BigInt(v.slice(23,26));
export const revisionHistoryQueryString=(q:RevisionHistoryQuery)=>new URLSearchParams(Object.entries(q).filter((e):e is [string,string]=>e[1]!==null)).toString();
export function parseRevisionHistoryQuery(raw:unknown):RevisionHistoryQuery{
  const v=obj(raw);exact(v,["siteId","access","scope","status","asOf","cursorAt","cursorId",...(v.access==="owner"?["fromAt","toAt"]:v.access==="self"?["expectedWorkerId","rootRequestId"]:fail())]);
  const siteId=attendanceSelfSite(v.siteId),status=REVISION_HISTORY_STATUSES.includes(v.status as RevisionHistoryStatus)?v.status as RevisionHistoryStatus:fail();
  const asOf=v.asOf===null?null:instant(v.asOf),cursorAt=v.cursorAt===null?null:instant(v.cursorAt),cursorId=v.cursorId===null?null:attendanceSelfUuid(v.cursorId);
  if((cursorAt===null)!==(cursorId===null)||cursorAt&&(!asOf||cursorAt>asOf))fail();
  const shared={siteId,status,asOf,cursorAt,cursorId};
  if(v.access==="owner"){
    const fromAt=instant(v.fromAt),toAt=instant(v.toAt);if(v.scope!=="submission-period"||fromAt>=toAt||micro(toAt)-micro(fromAt)>BigInt(2678400000000)||fromAt<"2000-01-01"||toAt>"2101-01-01T00:00:00.000000Z"||cursorAt&&(cursorAt<fromAt||cursorAt>=toAt))fail();
    return {...shared,access:"owner",scope:"submission-period",fromAt,toAt};
  }
  if(v.scope!=="root-history")fail();return {...shared,access:"self",scope:"root-history",expectedWorkerId:attendanceSelfUuid(v.expectedWorkerId),rootRequestId:attendanceSelfUuid(v.rootRequestId)};
}
export function parseRevisionHistoryHttpQuery(url:string){
  const p=new URL(url).searchParams,v:Record<string,unknown>={asOf:null,cursorAt:null,cursorId:null};
  for(const [k,x] of p){if(p.getAll(k).length!==1)fail();v[k]=x;}return parseRevisionHistoryQuery(v);
}
const before=(a:{recordedAt:string;requestId:string},b:{recordedAt:string;requestId:string})=>a.recordedAt<b.recordedAt||a.recordedAt===b.recordedAt&&a.requestId<b.requestId;
function label(v:unknown,max:number){return typeof v==="string"&&v.trim()&&[...v].length<=max&&!/[\u0000-\u001f\u007f-\u009f]/.test(v)?v:fail();}
export function parseRevisionHistoryResult(raw:unknown,input:RevisionHistoryQuery):RevisionHistoryResult{
  const q=parseRevisionHistoryQuery(input),v=obj(raw);exact(v,["protocol","readOnly","siteId","access","employeeId","workerId","rootRequestId","asOf","items","scanned","nextCursor"]);
  const asOf=instant(v.asOf);
  if(v.protocol!=="revision-history-v1"||v.readOnly!==true||v.siteId!==q.siteId||v.access!==q.access||q.asOf!==null&&asOf!==q.asOf||q.cursorAt&&q.cursorAt>asOf
    ||!Number.isInteger(v.scanned)||Number(v.scanned)<0||Number(v.scanned)>50||!Array.isArray(v.items)||v.items.length>Number(v.scanned))fail();
  const employeeId=v.employeeId===null?null:attendanceSelfUuid(v.employeeId),workerId=v.workerId===null?null:attendanceSelfUuid(v.workerId),rootRequestId=v.rootRequestId===null?null:attendanceSelfUuid(v.rootRequestId);
  if(q.access==="owner"?(employeeId!==null||workerId!==null||rootRequestId!==null):(!employeeId||workerId!==q.expectedWorkerId||rootRequestId!==q.rootRequestId))fail();
  let previous=q.cursorAt?{recordedAt:q.cursorAt,requestId:q.cursorId!}:null;
  const items=(v.items as unknown[]).map(raw=>{
    const r=obj(raw);exact(r,["requestId","rootRequestId","workerId","employeeId","workerName","workerNo","submittedRevision","submittedAt","proposedStartAt","proposedEndAt","status","closedAt","decisionOperationId"]);
    const requestId=attendanceSelfUuid(r.requestId),root=attendanceSelfUuid(r.rootRequestId),w=attendanceSelfUuid(r.workerId),e=attendanceSelfUuid(r.employeeId),submittedAt=instant(r.submittedAt);
    const proposedStartAt=instant(r.proposedStartAt),proposedEndAt=instant(r.proposedEndAt),closedAt=r.closedAt===null?null:instant(r.closedAt),operation=r.decisionOperationId===null?null:attendanceSelfUuid(r.decisionOperationId);
    if(!Number.isSafeInteger(r.submittedRevision)||Number(r.submittedRevision)<1||Number(r.submittedRevision)>9007199254740989||requestId===root||submittedAt>asOf
      ||proposedStartAt>=proposedEndAt||proposedEndAt>submittedAt||closedAt&&(closedAt<=submittedAt||closedAt>asOf)
      ||!['submitted','withdrawn','approved','rejected'].includes(String(r.status))||q.status!=="all"&&r.status!==q.status
      ||(r.status==="submitted")!==(closedAt===null)||(['approved','rejected'].includes(String(r.status)))!==(operation!==null)||operation&&[requestId,root].includes(operation)
      ||q.access==="owner"&&(submittedAt<q.fromAt||submittedAt>=q.toAt)||q.access==="self"&&(w!==workerId||e!==employeeId||root!==rootRequestId)
      ||previous&&!before({recordedAt:submittedAt,requestId},previous))fail();
    previous={recordedAt:submittedAt,requestId};return {requestId,rootRequestId:root,workerId:w,employeeId:e,workerName:label(r.workerName,120),workerNo:label(r.workerNo,40),submittedRevision:Number(r.submittedRevision),submittedAt,proposedStartAt,proposedEndAt,status:r.status as RevisionHistoryItem['status'],closedAt,decisionOperationId:operation};
  });
  if(new Set(items.map(i=>i.requestId)).size!==items.length)fail();
  let nextCursor=null;
  if(v.nextCursor!==null){
    const c=obj(v.nextCursor);exact(c,["recordedAt","requestId"]);nextCursor={recordedAt:instant(c.recordedAt),requestId:attendanceSelfUuid(c.requestId)};
    if(v.scanned!==50||nextCursor.recordedAt>asOf||q.access==="owner"&&(nextCursor.recordedAt<q.fromAt||nextCursor.recordedAt>=q.toAt)
      ||previous&&before(previous,nextCursor)||q.cursorAt&&!before(nextCursor,{recordedAt:q.cursorAt,requestId:q.cursorId!}))fail();
  }
  return {protocol:"revision-history-v1",readOnly:true,siteId:q.siteId,access:q.access,employeeId,workerId,rootRequestId,asOf,items,scanned:Number(v.scanned),nextCursor};
}
export function parseRevisionHistoryResponse(raw:unknown,q:RevisionHistoryQuery){
  const v=obj(raw);if(v.ok!==true||typeof v.moduleEnabled!=="boolean")fail();const {ok,moduleEnabled,...body}=v;void ok;return {...parseRevisionHistoryResult(body,q),moduleEnabled};
}
export const REVISION_HISTORY_ERRORS:Readonly<Record<string,number>>={...REVISION_APPROVAL_ERRORS,attendance_not_available:404,attendance_worker_changed:409,attendance_revision_base_not_found:404,attendance_revision_history_invalid:503,attendance_revision_history_too_large:422};
