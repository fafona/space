import {wire} from "./attendance-revision-cycle-model";
import {revisionQuery as q} from "./attendance-revision-model";
import {correctionId as id} from "./attendance-correction-model";
import {parseRevisionCycleInput} from "../../src/lib/merchantAttendanceRevisionCycleResponse";
import type {RevisionCycleCommand,RevisionCycleResult} from "../../src/lib/merchantAttendanceRevisionCycle";
import {previewCorrection} from "../../src/lib/merchantAttendanceCorrection";
import type {AttendanceApiFetch} from "../../src/lib/merchantAttendanceSelfClient";
// Deterministic synthetic transport for real component/client checks, never real authorization.
export function revisionCycleModel(){
  let value=wire(),mode="normal",tick=0;const calls:{method:string;path:string;body:unknown}[]=[],receipts=new Map<string,NonNullable<RevisionCycleResult["receipt"]>>();
  const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json"}});
  const error=(error:string,status=409)=>reply({ok:false,error},status),nextAt=()=>`2026-09-30T13:${String(tick++).padStart(2,"0")}:00.000000Z`;
  const response=(url:URL)=>{
    const r=structuredClone(value),detail=url.searchParams.get("mode")==="detail";
    if(detail&&r.item?.requestId!==url.searchParams.get("requestId"))return error("attendance_correction_not_found",404);
    r.mode=detail?"detail":"prepare";if(!detail){r.item=null;r.canWithdraw=false;}
    r.receipt=detail?structuredClone(receipts.get(url.searchParams.get("operationId")??"")??null):null;
    if(mode==="paused")r.canSubmit=false;if(mode==="corrupt")r.current.workedUs++;if(mode==="wrong_employee")r.employeeId=id(987);
    return reply({ok:true,...r,moduleEnabled:mode!=="paused"});
  };
  const terminal=(status:"approved"|"rejected")=>{
    const i=value.item;if(!i||i.status!=="submitted")throw Error("expected_pending_fixture");
    const c={action:status==="approved"?"approve" as const:"reject" as const,operationId:id(810+tick),requestId:i.requestId,expectedRevision:i.submittedRevision,expectedBaseOperationId:i.basedOn.operationId,expectedEvidence:"a".repeat(32),reason:"合成审批结果"},at=nextAt();
    i.status=status;i.decision={requestId:i.requestId,operationId:c.operationId,action:c.action,requestRevision:i.submittedRevision,baseOperationId:c.expectedBaseOperationId,evidenceToken:c.expectedEvidence,reason:c.reason,recordedAt:at,command:c};
    if(status==="approved"){
      value.current={...structuredClone(i.basedOn),requestId:i.requestId,operationId:c.operationId,revision:i.basedOn.revision+1,policyRevision:i.policyRevision,recordedAt:at,proposal:structuredClone(i.proposal),...previewCorrection(value.basis,i.proposal).proposed.totals!,lineage:{...i.basedOn.lineage,previousOperationId:i.basedOn.operationId}};
      i.decisionEffect=structuredClone(value.current);
    }
    value.pendingRequestId=null;value.canWithdraw=false;value.canSubmit=true;
  };
  const fetch:AttendanceApiFetch=async(path,init={})=>{
    const url=new URL(path,"https://local.invalid"),method=init.method??"GET",body=method==="POST"?JSON.parse(String(init.body)):null;calls.push({method,path,body});
    if(mode==="denied")return error("attendance_access_denied",403);
    if(url.pathname.endsWith("/context"))return reply({ok:true,moduleEnabled:mode!=="paused",siteId:q.siteId,employeeId:mode==="wrong_employee"?id(987):value.employeeId,workerId:mode==="rebound"?id(988):q.expectedWorkerId,locationId:null});
    if(url.pathname!=="/api/merchant-enterprise/attendance/revision-requests")throw Error("unexpected_fixture_path");
    if(method==="POST"){
      const input=parseRevisionCycleInput(body),c:RevisionCycleCommand=input.command;
      if(mode==="unavailable")return error("attendance_unavailable",503);
      if(mode==="missing")throw Error("synthetic_request_not_delivered");
      if(!receipts.has(c.operationId)){
        if(mode==="paused"&&c.action==="submit")return error("attendance_platform_paused",403);
        if(c.expectedRevision!==value.revision)return error("attendance_version_conflict");
        const at=nextAt();
        if(c.action==="submit"){
          if(value.pendingRequestId)return error("attendance_correction_pending");
          if(c.expectedEffectiveOperationId!==value.current.operationId)return error("attendance_revision_base_changed");
          value.item={requestId:c.operationId,revision:value.revision+1,submittedRevision:value.revision+1,status:"submitted",policyRevision:c.expectedPolicyRevision,proposal:structuredClone(c.proposal),reason:c.reason,submittedAt:at,basedOn:structuredClone(value.current),withdrawal:null,decision:null,decisionEffect:null};
          value.pendingRequestId=c.operationId;value.canSubmit=false;value.canWithdraw=true;
        }else{
          if(value.item?.status!=="submitted"||value.item.requestId!==c.requestId)return error("attendance_correction_closed");
          value.item.status="withdrawn";value.item.revision++;value.item.withdrawal={reason:c.reason,recordedAt:at};value.pendingRequestId=null;value.canWithdraw=false;value.canSubmit=true;
        }
        value.revision++;value.mode="detail";receipts.set(c.operationId,{operationId:c.operationId,requestId:value.item!.requestId,revision:value.revision,action:c.action,recordedAt:at,command:structuredClone(c)});
      }
      if(mode==="lost")throw Error("synthetic_response_lost_after_commit");
      url.searchParams.set("mode","detail");url.searchParams.set("requestId",c.action==="submit"?c.operationId:c.requestId);url.searchParams.set("operationId",c.operationId);
    }
    return response(url);
  };
  return {fetch,calls,setMode:(v:string)=>{mode=v;},terminal,snapshot:()=>structuredClone(value),setValue:(v:RevisionCycleResult)=>{value=structuredClone(v);},postCount:()=>calls.filter(c=>c.method==="POST").length};
}
