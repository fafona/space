import {revisionApprovalResponse} from "./attendance-revision-approval-model";
import {correctionId as id} from "./attendance-correction-model";
import {parseRevisionHistoryHttpQuery,type RevisionHistoryQuery,type RevisionHistoryItem,type RevisionHistoryResult} from "../../src/lib/merchantAttendanceRevisionHistory";
import type {AttendanceApiFetch} from "../../src/lib/merchantAttendanceSelfClient";
const a=revisionApprovalResponse(),base=a.review.review.application;
export const historyOwner=id(77),historyEmployee=base.employeeId,historyWorker=base.workerId,historySite=a.siteId,historyRoot=a.review.base.lineage.rootRequestId;
export const historyAsOf="2026-10-01T15:00:00.000000Z";
export const historyOwnerQuery:RevisionHistoryQuery={siteId:historySite,access:"owner",scope:"submission-period",fromAt:"2026-09-01T00:00:00.000000Z",toAt:"2026-10-02T00:00:00.000000Z",status:"all",asOf:null,cursorAt:null,cursorId:null};
export const historySelfQuery:RevisionHistoryQuery={siteId:historySite,access:"self",scope:"root-history",expectedWorkerId:historyWorker,rootRequestId:historyRoot,status:"all",asOf:null,cursorAt:null,cursorId:null};
export function historyItem(n=0,status:RevisionHistoryItem['status']='submitted'):RevisionHistoryItem{
  return {requestId:n===0?a.requestId:id(2000+n),rootRequestId:historyRoot,workerId:historyWorker,employeeId:historyEmployee,workerName:"合成员工",workerNo:"TEST-REVISION",submittedRevision:n+1,
    submittedAt:new Date(Date.parse('2026-09-30T13:00:00Z')-n*60000).toISOString().replace('.000Z','.000000Z'),proposedStartAt:base.proposal.startAt,proposedEndAt:base.proposal.endAt,status,
    closedAt:status==='submitted'?null:'2026-09-30T14:00:00.000000Z',decisionOperationId:['approved','rejected'].includes(status)?id(3000+n):null};
}
export function historyValue(q:RevisionHistoryQuery,items:RevisionHistoryItem[]=[historyItem()]):RevisionHistoryResult{
  return {protocol:"revision-history-v1",readOnly:true,siteId:q.siteId,access:q.access,employeeId:q.access==='self'?historyEmployee:null,workerId:q.access==='self'?q.expectedWorkerId:null,rootRequestId:q.access==='self'?q.rootRequestId:null,
    asOf:q.asOf??historyAsOf,items,scanned:items.length,nextCursor:null};
}
// Bounded in-memory fixture, not a database/identity implementation.
export function historyModel(){
  let mode="normal",records=[historyItem()],now=historyAsOf;const calls:{path:string;method:string}[]=[];
  const apiFetch:AttendanceApiFetch=async(path,init)=>{
    const method=init?.method??"GET";calls.push({path,method});if(method!=="GET")throw Error("synthetic_writes_forbidden");
    if(mode==='denied')return Response.json({ok:false,error:'attendance_access_denied'},{status:403});if(mode==='offline')throw Error('offline');
    const q=parseRevisionHistoryHttpQuery('https://local.invalid'+path),stamp=q.asOf??now;
    const sorted=records.filter(r=>(q.access==='owner'?(r.submittedAt>=q.fromAt&&r.submittedAt<q.toAt):r.rootRequestId===q.rootRequestId)&&r.submittedAt<=stamp&&(!q.cursorAt||r.submittedAt<q.cursorAt||r.submittedAt===q.cursorAt&&r.requestId<q.cursorId!))
      .sort((a,b)=>b.submittedAt.localeCompare(a.submittedAt)||b.requestId.localeCompare(a.requestId)),candidates=sorted.slice(0,50);
    const r=historyValue({...q,asOf:stamp},candidates.filter(x=>q.status==='all'||x.status===q.status));r.scanned=candidates.length;
    if(sorted.length>50)r.nextCursor={recordedAt:candidates.at(-1)!.submittedAt,requestId:candidates.at(-1)!.requestId};
    if(mode==='wrong_employee')r.employeeId=id(999);if(mode==='corrupt')r.readOnly=false as true;
    return Response.json({ok:true,...r,moduleEnabled:mode!=='paused'});
  };
  return {apiFetch,calls,mode:(m:string)=>{mode=m;},records:(v:RevisionHistoryItem[])=>{records=structuredClone(v);},now:(s:string)=>{now=s;}};
}
