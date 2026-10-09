import {attendanceSelfSite,attendanceSelfUuid} from "./merchantAttendanceSelf";
import {attendanceManagementRequest,AttendanceManagementRejected} from "./merchantAttendanceManagementClient";
import type {AttendanceApiFetch} from "./merchantAttendanceSelfClient";
import {correctionDecisionQueryString,correctionDecisionReceiptMatches,parseCorrectionDecisionCommand,type CorrectionDecisionCommand} from "./merchantAttendanceCorrectionDecision";
import {CURRENT_CORRECTION_ERRORS} from "./merchantAttendanceCurrentCorrectionDecision";
import {parseCurrentCorrectionResponse} from "./merchantAttendanceCurrentCorrectionResponse";

type Store=Pick<Storage,"getItem"|"setItem"|"removeItem">;
export type CorrectionDecisionPending={siteId:string;ownerId:string;command:CorrectionDecisionCommand};
type Result=ReturnType<typeof parseCurrentCorrectionResponse>;
type State={phase:"idle"|"loading"|"ready"|"saving"|"unconfirmed"|"blocked";requestId:string|null;result:Result|null;pending:CorrectionDecisionPending|null;message:string};
export const correctionDecisionKey=(siteId:string,ownerId:string)=>`faolla:attendance:correction-decision:v1:${attendanceSelfSite(siteId)}:${attendanceSelfUuid(ownerId)}`;
// Keep this exact slot: v2 changes the response, not the six-field command or
// ownership key. Existing uncertain commands must recover by their original ID.
export function parseCorrectionDecisionPending(raw:string,siteId:string,ownerId:string):CorrectionDecisionPending{
  if(raw.length>8192)throw Error("invalid_pending");const p=JSON.parse(raw);
  if(!p||Object.keys(p).sort().join()!=="command,ownerId,siteId"||p.siteId!==attendanceSelfSite(siteId)||p.ownerId!==attendanceSelfUuid(ownerId)
    ||!p.command||Object.keys(p.command).sort().join()!=="action,expectedEvidence,expectedRevision,operationId,reason,requestId")throw Error("invalid_pending");
  const parsed=parseCorrectionDecisionCommand({siteId,...p.command});
  return {siteId,ownerId,command:parsed.command};
}
const messages:Record<string,string>={
  attendance_period_sealed:"该员工周期已封存，请负责人填写理由重开后，再重新核对审批；原记录未改写。",
  attendance_access_denied:"当前账号不是此企业的有效负责人，已隐藏资料；待确认操作不会转交其他账号。",
  attendance_not_available:"审批操作入口尚未开放；保留原编号，不会自动重发。",
  attendance_correction_not_found:"未能读取原申请；请核对权限，不会换申请或另建编号重发。",
  attendance_platform_paused:"平台暂停新审批，仍可查询原收据。",
  attendance_correction_evidence_changed:"核对条件已经变化，请重新核对。若原操作仍待确认，不会将它当作确定失败。",
  attendance_version_conflict:"申请版本已推进，原命令已失效；请重新核对。",
  attendance_correction_decided:"申请已有决定，原命令不能再执行；这不代表本次操作成功。",
  attendance_correction_decision_blocked:"当前条件不允许该决定，请核对阻断项。待确认操作不会自动丢弃。",
  attendance_operation_conflict:"原编号对应内容或身份不一致，保留原编号供核查，不会自动替换。",
  attendance_rate_limited:"请求较频繁，请稍后手动查询原收据。",
  attendance_report_version_required:"审批版本尚未同步，请更新页面后重新核对；保留待确认编号，不自动重发。",
};
export class AttendanceCorrectionDecisionClient{
  private state:State={phase:"idle",requestId:null,result:null,pending:null,message:"请选择申请进入审批；只查询，不自动提交。"};
  private generation=0;private controller:AbortController|null=null;private paused=true;private listeners=new Set<()=>void>();
  readonly storageKey:string;
  constructor(private readonly options:{siteId:string;ownerId:string;apiFetch:AttendanceApiFetch;storage:()=>Store;randomId?:()=>string;timeoutMs?:number}){
    this.storageKey=correctionDecisionKey(options.siteId,options.ownerId);
  }
  getSnapshot=()=>this.state;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private set(value:Partial<State>){this.state={...this.state,...value};this.listeners.forEach(fn=>fn());}
  private restored(){const raw=this.options.storage().getItem(this.storageKey);return raw===null?null:parseCorrectionDecisionPending(raw,this.options.siteId,this.options.ownerId);}
  private samePending(){if(JSON.stringify(this.restored())!==JSON.stringify(this.state.pending))throw Error("storage_conflict");}
  private clear(){this.samePending();this.options.storage().removeItem(this.storageKey);if(this.options.storage().getItem(this.storageKey)!==null)throw Error("storage_not_cleared");this.set({pending:null});}
  hasLeaveRisk=()=>{try{return !!this.controller||!!this.restored();}catch{return true;}};
  pause=()=>{this.paused=true;this.generation++;this.controller?.abort();this.controller=null;
    this.set({result:null,phase:this.state.pending?"unconfirmed":"idle",message:"资料已隐藏；中止等待不是撤销审批，返回后只查询原收据。"});};
  initialize=async(requestId:string|null|undefined=undefined)=>{
    this.pause();this.paused=false;
    try{const pending=this.restored(),target=pending?.command.requestId??(requestId===undefined?this.state.requestId:requestId);
      this.set({pending,requestId:target===null?null:attendanceSelfUuid(target),result:null});
    }catch{this.set({result:null,phase:"blocked",message:"待确认存储异常，不会覆盖、删除或自动重发。"});return;}
    if(this.state.requestId)await this.request(null,false);
    else this.set({phase:"idle",message:"当前标签页没有待确认审批；请返回核对列表选择申请。"});
  };
  submit=async(intent:{action:"approve"|"reject";reason:string})=>{
    const r=this.state.result;
    if(this.paused||this.controller||this.state.pending||this.state.phase!=="ready"||!r?.moduleEnabled||r.decision
      ||(intent.action==="approve"?!r.canApprove:!r.canReject))return;
    try{
      this.samePending();const command=parseCorrectionDecisionCommand({siteId:this.options.siteId,...intent,reason:intent.reason.trim(),
        requestId:r.review.item.requestId,operationId:(this.options.randomId??(()=>crypto.randomUUID()))(),expectedRevision:r.review.item.revision,expectedEvidence:r.evidenceToken}).command;
      if(new TextEncoder().encode(JSON.stringify({siteId:this.options.siteId,...command})).byteLength>4096)throw Error("body_too_large");
      const pending={siteId:this.options.siteId,ownerId:this.options.ownerId,command},raw=JSON.stringify(pending);
      this.options.storage().setItem(this.storageKey,raw);if(this.options.storage().getItem(this.storageKey)!==raw)throw Error("storage_write_failed");
      this.set({pending});await this.request(command,true);
    }catch{this.set({result:null,phase:"blocked",message:"参数或存储异常，未能可靠保存原操作；不会换编号重发，请重新读取。"});}
  };
  retry=async()=>{
    if(this.paused||this.controller||!this.state.pending||this.state.phase!=="unconfirmed")return;
    const ok=await this.request(null,false);
    if(ok&&!this.paused&&this.state.pending&&this.state.phase==="unconfirmed"&&this.state.result?.moduleEnabled)
      await this.request(this.state.pending.command,false);
  };
  private async request(command:CorrectionDecisionCommand|null,first:boolean){
    const g=++this.generation,controller=new AbortController();this.controller=controller;
    this.set({phase:command?"saving":"loading",result:null});
    try{
      this.samePending();const q={siteId:this.options.siteId,requestId:attendanceSelfUuid(this.state.requestId),operationId:this.state.pending?.command.operationId??null};
      const raw=await attendanceManagementRequest(this.options.apiFetch,`/api/merchant-enterprise/attendance/correction-decisions${command?"":`?${correctionDecisionQueryString(q)}`}`,
        {method:command?"POST":"GET",...(command?{headers:{"Content-Type":"application/json"},body:JSON.stringify({siteId:this.options.siteId,...command})}:{})},
        {signal:controller.signal,timeoutMs:this.options.timeoutMs,maxBytes:262144,errorStatuses:CURRENT_CORRECTION_ERRORS});
      if(g!==this.generation||this.paused)return false;
      this.samePending();const result=parseCurrentCorrectionResponse(raw,q),p=this.state.pending;
      if(!command&&(result.effectiveChanged||result.receipt&&!result.replayed))throw Error("readonly_claims_write");
      if(command&&!result.receipt||p&&result.receipt&&!correctionDecisionReceiptMatches(p.command,result.receipt))throw Error("receipt_mismatch");
      if(p&&result.receipt){this.clear();this.set({result,phase:"ready",message:"原审批已确认；本次审批结果与当前有效工时分别显示，后续修订不改变原收据。原始打卡保留，不代表工资结算。"});}
      // Only immutable terminal state can fence an uncertain older request. A changed hash/temporary denial may later revert.
      else if(p&&((result.decision&&result.decision.operationId!==p.command.operationId)||result.review.item.revision>p.command.expectedRevision)){
        this.clear();this.set({result,phase:"ready",message:"原命令已被申请新版本或其他决定阻断，不能再执行；未确认本次审批成功，请查看当前结果。"});
      }else this.set({result,phase:p?"unconfirmed":"ready",message:p?"原审批尚未确认；请核对原编号，可查询收据或明确重试，不会自动提交。"
        :result.decision?"本申请已有决定，不能重复审批。":"已重新读取事实与规则。请核对差异、选择决定并确认理由；提交时服务器会再次检查。"});
      return true;
    }catch(e){
      if(g!==this.generation||this.paused)return false;
      if(command&&e instanceof AttendanceManagementRejected&&(first&&e.message!=="attendance_operation_conflict"
        ||["attendance_version_conflict","attendance_correction_decided"].includes(e.message))){try{this.clear();}catch{/* Keep uncertain storage. */}}
      const code=e instanceof Error?e.message:"";
      this.set({result:null,phase:this.state.pending?"unconfirmed":"blocked",message:messages[code]??"未能确认审批结果。网络或响应异常不代表失败；请手动查询原收据，不要重复创建决定。"});return false;
    }finally{if(g===this.generation)this.controller=null;}
  }
}
