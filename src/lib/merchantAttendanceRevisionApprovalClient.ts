import {attendanceSelfSite,attendanceSelfUuid} from "./merchantAttendanceSelf";
import {attendanceManagementRequest,AttendanceManagementRejected} from "./merchantAttendanceManagementClient";
import {parseRevisionDecisionCommand,revisionDecisionReceiptMatches,type RevisionDecisionCommand} from "./merchantAttendanceRevisionDecision";
import {REVISION_APPROVAL_ERRORS} from "./merchantAttendanceRevisionApproval";
import {parseRevisionApprovalResponse,revisionApprovalQueryString} from "./merchantAttendanceRevisionApprovalResponse";
import type {AttendanceApiFetch} from "./merchantAttendanceSelfClient";
type Store=Pick<Storage,"getItem"|"setItem"|"removeItem">;
export type RevisionApprovalPending={siteId:string;ownerId:string;command:RevisionDecisionCommand};
type Result=ReturnType<typeof parseRevisionApprovalResponse>;
type State={phase:"idle"|"loading"|"ready"|"saving"|"unconfirmed"|"blocked";requestId:string|null;result:Result|null;pending:RevisionApprovalPending|null;message:string};
export const revisionApprovalKey=(siteId:string,ownerId:string)=>`faolla:attendance:revision-approval:v2:${attendanceSelfSite(siteId)}:${attendanceSelfUuid(ownerId)}`;
export function parseRevisionApprovalPending(raw:string,siteId:string,ownerId:string):RevisionApprovalPending{
  if(raw.length>8192)throw Error("invalid_pending");const p=JSON.parse(raw);
  if(!p||Object.keys(p).sort().join()!=="command,ownerId,siteId"||p.siteId!==siteId||p.ownerId!==ownerId||!p.command
    ||Object.keys(p.command).sort().join()!=="action,expectedBaseOperationId,expectedEvidence,expectedRevision,operationId,reason,requestId")throw Error("invalid_pending");
  return {siteId,ownerId,command:parseRevisionDecisionCommand({siteId,...p.command}).command};
}
const messages:Record<string,string>={attendance_access_denied:"当前账号不是此企业的有效负责人；资料已隐藏，原待确认操作不会转交其他账号。",
  attendance_not_available:"修订审批入口尚未开放；不会自动重发待确认操作。",
  attendance_platform_paused:"平台暂停新审批，仍可按当前权限查询原收据。",
  attendance_correction_not_found:"暂未读取到原修订申请；不会换申请或换编号重发。",
  attendance_correction_evidence_changed:"核对条件已变化，请重新读取；原操作如果仍未确认，不会把它当作确定失败。",
  attendance_revision_base_changed:"生效核定已更新，不能覆盖较新的审批结果。请重新核对。",
  attendance_version_conflict:"申请版本已变化，不能使用旧命令继续审批，请重新读取。",
  attendance_correction_decided:"该申请已有审批决定，不能重复处理；这不代表本次操作成功。",
  attendance_correction_decision_blocked:"当前条件不允许该决定，请核对阻断项。",
  attendance_period_sealed:"该员工周期已封存，请负责人填写理由重开后，再重新核对审批；原记录未改写。",
  attendance_operation_conflict:"原编号与命令或身份不一致；保留原操作供核对，不自动换编号。",
  attendance_report_version_required:"页面和服务版本尚未同步，请更新后重新核对，不自动重发。",
  attendance_rate_limited:"请求较频繁，请稍后手动查询原收据。"};
export class AttendanceRevisionApprovalClient{
  private state:State={phase:"idle",requestId:null,result:null,pending:null,message:"输入修订申请编号核对，或恢复本标签页待确认审批。待办列表尚未接入。"};
  private generation=0;private controller:AbortController|null=null;private paused=true;private listeners=new Set<()=>void>();
  readonly storageKey:string;
  constructor(private readonly options:{siteId:string;ownerId:string;apiFetch:AttendanceApiFetch;storage:()=>Store;randomId?:()=>string;timeoutMs?:number}){this.storageKey=revisionApprovalKey(options.siteId,options.ownerId);}
  getSnapshot=()=>this.state;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private set(p:Partial<State>){this.state={...this.state,...p};this.listeners.forEach(fn=>fn());}
  private stored(){const raw=this.options.storage().getItem(this.storageKey);return raw===null?null:parseRevisionApprovalPending(raw,this.options.siteId,this.options.ownerId);}
  private checkStorage(){if(JSON.stringify(this.stored())!==JSON.stringify(this.state.pending))throw Error("storage_conflict");}
  private clear(){this.checkStorage();this.options.storage().removeItem(this.storageKey);if(this.options.storage().getItem(this.storageKey)!==null)throw Error("storage_conflict");this.set({pending:null});}
  hasLeaveRisk=()=>{try{return !!this.controller||!!this.stored();}catch{return true;}};
  pause=()=>{this.paused=true;this.generation++;this.controller?.abort();this.controller=null;this.set({result:null,phase:this.state.pending?"unconfirmed":"idle",message:"资料已隐藏；离开或中止等待不会撤销已发送的审批。"});};
  initialize=async(requestId?:string|null)=>{
    this.pause();this.paused=false;
    try{const pending=this.stored(),target=pending?.command.requestId??(requestId===undefined?this.state.requestId:requestId);
      this.set({pending,requestId:target===null?null:attendanceSelfUuid(target),result:null});
    }catch{this.set({result:null,phase:"blocked",message:"申请编号或待确认存储无效；不会覆盖、删除或自动重发。"});return;}
    if(this.state.requestId)await this.request(null,false);else this.set({phase:"idle",message:"没有待确认修订审批；可按员工提供的修订申请编号核对。待办列表尚未接入。"});
  };
  submit=async(intent:{action:"approve"|"reject";reason:string})=>{
    const r=this.state.result;if(this.paused||this.controller||this.state.pending||this.state.phase!=="ready"||!r?.moduleEnabled||r.decision
      ||(intent.action==="approve"?!r.canApprove:!r.canReject))return;
    try{
      this.checkStorage();const command=parseRevisionDecisionCommand({siteId:this.options.siteId,...intent,reason:intent.reason.trim(),requestId:r.requestId,
        operationId:(this.options.randomId??(()=>crypto.randomUUID()))(),expectedRevision:r.review.submittedRevision,expectedEvidence:r.evidenceToken,expectedBaseOperationId:r.review.base.operationId}).command;
      if(new TextEncoder().encode(JSON.stringify({siteId:this.options.siteId,...command})).length>4096)throw Error("body_too_large");
      const pending=parseRevisionApprovalPending(JSON.stringify({siteId:this.options.siteId,ownerId:this.options.ownerId,command}),this.options.siteId,this.options.ownerId),raw=JSON.stringify(pending);
      this.options.storage().setItem(this.storageKey,raw);if(this.options.storage().getItem(this.storageKey)!==raw)throw Error("storage_conflict");this.set({pending});await this.request(command,true);
    }catch{this.set({result:null,phase:"blocked",message:"无法可靠保存原操作，请核对参数或标签页存储；不会换编号重发。"});}
  };
  retry=async()=>{
    if(this.paused||this.controller||!this.state.pending||this.state.phase!=="unconfirmed")return;
    const found=await this.request(null,false);
    if(found&&!this.paused&&this.state.pending&&this.state.phase==="unconfirmed"&&this.state.result?.moduleEnabled)await this.request(this.state.pending.command,false);
  };
  private async request(command:RevisionDecisionCommand|null,first:boolean){
    const g=++this.generation,controller=new AbortController();this.controller=controller;this.set({result:null,phase:command?"saving":"loading"});
    try{
      this.checkStorage();const q={siteId:this.options.siteId,requestId:attendanceSelfUuid(this.state.requestId),operationId:this.state.pending?.command.operationId??null};
      const raw=await attendanceManagementRequest(this.options.apiFetch,`/api/merchant-enterprise/attendance/revision-decisions${command?"":"?"+revisionApprovalQueryString(q)}`,
        command?{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({siteId:this.options.siteId,...command})}:{method:"GET"},
        {signal:controller.signal,timeoutMs:this.options.timeoutMs,maxBytes:262144,errorStatuses:REVISION_APPROVAL_ERRORS});
      if(g!==this.generation||this.paused)return false;this.checkStorage();const result=parseRevisionApprovalResponse(raw,q),p=this.state.pending;
      if(!command&&(result.effectiveChanged||result.receipt&&!result.replayed))throw Error("readonly_claims_write");
      if(command&&!result.receipt||p&&result.receipt&&!revisionDecisionReceiptMatches(p.command,result.receipt))throw Error("receipt_mismatch");
      if(p&&result.receipt){this.clear();this.set({result,phase:"ready",message:"原审批已确认；本次决定与当前核定分别显示，后续修订不会改写原收据。"});}
      else if(p&&(result.review.requestState==="withdrawn"||result.decision&&result.decision.operationId!==p.command.operationId)){
        this.clear();this.set({result,phase:"ready",message:"原命令已被撤回或其他决定永久阻断，不能再执行；未确认本次审批成功，请查看实际结果。"});
      }else this.set({result,phase:p?"unconfirmed":"ready",message:p?"原操作尚未确认；请查询收据或明确用原编号重试，不自动提交。":result.decision?"本申请已有决定；历史审批与当前生效结果请分别核对。":"已读取当前身份、事实与规则；提交时服务器仍会重新核对。"});return true;
    }catch(e){
      if(g!==this.generation||this.paused)return false;
      if(command&&e instanceof AttendanceManagementRejected&&e.message!=="attendance_operation_conflict"&&(first||["attendance_version_conflict","attendance_revision_base_changed","attendance_correction_decided"].includes(e.message))){try{this.clear();}catch{/* Keep uncertain storage. */}}
      this.set({result:null,phase:this.state.pending?"unconfirmed":"blocked",message:messages[e instanceof Error?e.message:""]??"未能确认审批结果。网络或响应异常不等于失败；请核对原编号，不重复创建决定。"});return false;
    }finally{if(g===this.generation)this.controller=null;}
  }
}
