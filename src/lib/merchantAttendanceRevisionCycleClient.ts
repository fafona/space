import {attendanceSelfSite,attendanceSelfUuid} from "./merchantAttendanceSelf";
import {attendanceManagementRequest,AttendanceManagementRejected} from "./merchantAttendanceManagementClient";
import {ATTENDANCE_SELF_CONTEXT_ERRORS,parseAttendanceSelfContext} from "./merchantAttendanceSelfContext";
import {attendanceRevisionQueryString,parseAttendanceRevisionQuery,type AttendanceRevisionQuery} from "./merchantAttendanceRevision";
import {parseRevisionCycleCommand,type RevisionCycleCommand} from "./merchantAttendanceRevisionCycle";
import {parseRevisionCycleResponse,REVISION_CYCLE_ERRORS} from "./merchantAttendanceRevisionCycleResponse";
import type {CorrectionProposal} from "./merchantAttendanceCorrection";
import type {AttendanceApiFetch} from "./merchantAttendanceSelfClient";

type Store=Pick<Storage,"getItem"|"setItem"|"removeItem">;
export type RevisionTarget={workerId:string;baseRequestId:string};
export type RevisionCyclePending={employeeId:string;query:AttendanceRevisionQuery;command:RevisionCycleCommand};
type Result=ReturnType<typeof parseRevisionCycleResponse>;
type State={phase:"idle"|"loading"|"ready"|"saving"|"unconfirmed"|"blocked";workerId:string|null;query:AttendanceRevisionQuery|null;result:Result|null;pending:RevisionCyclePending|null;message:string};
export const revisionCycleKey=(siteId:string,employeeId:string)=>`faolla:attendance:revision-cycle:v2:${attendanceSelfSite(siteId)}:${attendanceSelfUuid(employeeId)}`;
export function parseRevisionCyclePending(raw:string,siteId:string,employeeId:string):RevisionCyclePending{
  if(raw.length>16384)throw Error("invalid_pending");const p=JSON.parse(raw);
  if(!p||Object.keys(p).sort().join()!=="command,employeeId,query"||p.employeeId!==employeeId||!p.query
    ||Object.keys(p.query).sort().join()!=="baseRequestId,expectedWorkerId,mode,operationId,requestId,siteId")throw Error("invalid_pending");
  const query=parseAttendanceRevisionQuery("https://local.invalid/?"+attendanceRevisionQueryString(p.query)),command=parseRevisionCycleCommand(p.command);
  if(query.siteId!==siteId||query.mode!=="detail"||query.operationId!==null||query.requestId!==(command.action==="submit"?command.operationId:command.requestId))throw Error("invalid_pending");
  return {employeeId,query,command};
}
const messages:Record<string,string>={attendance_access_denied:"当前账号没有本人修订访问权限；已隐藏资料，待确认编号不会转交其他账号。",
  attendance_application_window_protocol_required:"该商户已启用新版申请窗口，请通过新入口核对后提交；旧待确认编号保留，请先核对原号，不会自动重发。",
  attendance_worker_changed:"本人考勤档案已变更；停止使用旧档案，保留原操作供核对。",
  attendance_not_available:"连续修订入口尚未开放；待确认操作不会自动重发。",
  attendance_platform_paused:"平台暂停新申请；仍可按当前权限核对或撤回待审申请。",
  attendance_revision_base_changed:"当前核定已更新，请重新读取；不能覆盖新的审批结果。",
  attendance_revision_unchanged:"申请内容与当前核定相同，请先修改需要重新核对的时间。",
  attendance_correction_not_found:"暂未找到原申请；不代表提交失败，请核对原编号或明确重试。",
  attendance_version_conflict:"申请版本已变化，不能按旧版本继续提交，请重新读取。",
  attendance_correction_pending:"该班次已有待审修订，请先查看或撤回。",
  attendance_correction_closed:"该申请已经结束，不能撤回或覆盖；请重新核对。",
  attendance_operation_conflict:"操作编号与原内容不一致；保留原编号，不另建编号重发。",
  attendance_report_version_required:"页面与服务版本尚未同步；请更新后核对，不自动重发。",
  attendance_correction_policy_changed:"申请政策已经更新，请重新读取规则和当前核定。",
  attendance_correction_window_expired:"已超过当前申请期限，请联系负责人核查。",
  attendance_correction_period_locked:"涉及的周期已锁定，不能新建修订申请。",
  attendance_period_sealed:"该员工周期已封存，请负责人填写理由重开后，再重新核对修订；原记录未改写。",
  attendance_rate_limited:"请求较频繁，请稍后手动核对原操作。"};
/** Separate per-member tab intent. Refresh always revalidates identity and only GETs. */
export class AttendanceRevisionCycleClient{
  private state:State={phase:"idle",workerId:null,query:null,result:null,pending:null,message:"请选择已批准班次，或恢复本标签页待确认修订。"};
  private generation=0;private controller:AbortController|null=null;private paused=true;private listeners=new Set<()=>void>();
  readonly storageKey:string;
  constructor(private readonly options:{siteId:string;employeeId:string;apiFetch:AttendanceApiFetch;storage:()=>Store;randomId?:()=>string;timeoutMs?:number}){this.storageKey=revisionCycleKey(options.siteId,options.employeeId);}
  getSnapshot=()=>this.state;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private set(p:Partial<State>){this.state={...this.state,...p};this.listeners.forEach(fn=>fn());}
  private stored(){const raw=this.options.storage().getItem(this.storageKey);return raw===null?null:parseRevisionCyclePending(raw,this.options.siteId,this.options.employeeId);}
  private checkStorage(){if(JSON.stringify(this.stored())!==JSON.stringify(this.state.pending))throw Error("storage_conflict");}
  private clear(){this.checkStorage();this.options.storage().removeItem(this.storageKey);if(this.options.storage().getItem(this.storageKey)!==null)throw Error("storage_conflict");this.set({pending:null});}
  hasLeaveRisk=()=>{try{return !!this.controller||!!this.stored();}catch{return true;}};
  pause=()=>{this.paused=true;this.generation++;this.controller?.abort();this.controller=null;this.set({result:null,workerId:null,phase:this.state.pending?"unconfirmed":"idle",message:"资料已隐藏；离开或中止等待不等于撤回已发送申请。"});};
  initialize=async(target?:RevisionTarget|null,detailRequestId?:string)=>{
    this.pause();this.paused=false;const g=this.generation,controller=new AbortController();this.controller=controller;this.set({phase:"loading"});
    try{
      const pending=this.stored();this.set({pending});
      const body=await attendanceManagementRequest(this.options.apiFetch,`/api/merchant-enterprise/attendance/corrections/context?siteId=${this.options.siteId}`,{method:"GET"},
        {signal:controller.signal,timeoutMs:this.options.timeoutMs,maxBytes:2048,errorStatuses:ATTENDANCE_SELF_CONTEXT_ERRORS});
      const context=parseAttendanceSelfContext(body,this.options.siteId);
      if(g!==this.generation||this.paused)return;
      if(context.employeeId!==this.options.employeeId)throw Error("attendance_access_denied");this.checkStorage();
      const next:AttendanceRevisionQuery|null=pending?.query??(target?{siteId:this.options.siteId,expectedWorkerId:attendanceSelfUuid(target.workerId),baseRequestId:attendanceSelfUuid(target.baseRequestId),
        mode:detailRequestId?"detail":"prepare",requestId:detailRequestId?attendanceSelfUuid(detailRequestId):null,operationId:null}:target===null?null:this.state.query);
      if(next&&next.expectedWorkerId!==context.workerId)throw Error("attendance_worker_changed");
      this.set({workerId:context.workerId,query:next});
    }catch(e){if(g===this.generation)this.set({result:null,workerId:null,phase:"blocked",message:this.message(e)});return;}
    finally{if(g===this.generation)this.controller=null;}
    if(g===this.generation&&!this.paused){if(this.state.query)await this.run(this.state.query,null,false);else this.set({phase:"idle",message:"没有待确认修订；请返回已批准的补正详情选择班次。"});}
  };
  private canNavigate(){return !this.paused&&!this.controller&&!this.state.pending&&!!this.state.workerId;}
  prepare=async()=>{if(this.canNavigate()&&this.state.query)await this.run({...this.state.query,mode:"prepare",requestId:null,operationId:null},null,false);};
  detail=async(requestId:string)=>{if(this.canNavigate()&&this.state.query)await this.run({...this.state.query,mode:"detail",requestId:attendanceSelfUuid(requestId),operationId:null},null,false);};
  submit=async(proposal:CorrectionProposal,reason:string)=>{
    const r=this.state.result;if(!this.canNavigate()||this.state.phase!=="ready"||r?.mode!=="prepare"||!r.canSubmit||!r.moduleEnabled||!r.currentRules.policy)return;
    await this.start({action:"submit",operationId:this.uuid(),expectedRevision:r.revision,expectedBaseOperationId:r.current.lineage.rootOperationId,
      expectedEffectiveOperationId:r.current.operationId,expectedPolicyRevision:r.currentRules.policy.revision,proposal,reason:reason.trim()});
  };
  withdraw=async(reason:string)=>{
    const r=this.state.result;if(!this.canNavigate()||this.state.phase!=="ready"||!r?.canWithdraw||r.item?.status!=="submitted")return;
    await this.start({action:"withdraw",operationId:this.uuid(),requestId:r.item.requestId,expectedRevision:r.item.revision,reason:reason.trim()});
  };
  private uuid(){return (this.options.randomId??(()=>crypto.randomUUID()))();}
  private async start(raw:RevisionCycleCommand){
    try{
      this.checkStorage();const command=parseRevisionCycleCommand(raw),query={...this.state.query!,mode:"detail" as const,requestId:command.action==="submit"?command.operationId:command.requestId,operationId:null};
      if(new TextEncoder().encode(JSON.stringify({siteId:query.siteId,expectedWorkerId:query.expectedWorkerId,baseRequestId:query.baseRequestId,command})).length>8192)throw Error("body_too_large");
      const pending=parseRevisionCyclePending(JSON.stringify({employeeId:this.options.employeeId,query,command}),this.options.siteId,this.options.employeeId),value=JSON.stringify(pending);
      this.options.storage().setItem(this.storageKey,value);if(this.options.storage().getItem(this.storageKey)!==value)throw Error("storage_conflict");
      this.set({pending});await this.run(pending.query,command,true);
    }catch(e){this.set({result:null,phase:"blocked",message:this.message(e)});}
  }
  retry=async()=>{
    if(this.paused||this.controller||!this.state.workerId||this.state.phase!=="unconfirmed"||!this.state.pending)return;
    const outcome=await this.run(this.state.pending.query,null,false);
    if(outcome==="missing"&&!this.paused&&this.state.workerId&&this.state.pending)await this.run(this.state.pending.query,this.state.pending.command,false);
  };
  private message(e:unknown){return messages[e instanceof Error?e.message:""]??"未能确认结果。请检查时间、理由或访问权限，再核对原编号；不会自动重发。";}
  private async run(input:AttendanceRevisionQuery,command:RevisionCycleCommand|null,first:boolean):Promise<"done"|"missing"|"failed">{
    const g=++this.generation,controller=new AbortController();this.controller=controller;this.set({result:null,phase:command?"saving":"loading"});
    try{
      this.checkStorage();const query=parseAttendanceRevisionQuery("https://local.invalid/?"+attendanceRevisionQueryString(input));
      if(query.siteId!==this.options.siteId||query.expectedWorkerId!==this.state.workerId)throw Error("attendance_worker_changed");this.set({query});
      const p=this.state.pending,q={...query,operationId:p?.command.operationId??null};
      const raw=await attendanceManagementRequest(this.options.apiFetch,`/api/merchant-enterprise/attendance/revision-requests${command?"":"?"+attendanceRevisionQueryString(q)}`,
        command?{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({siteId:q.siteId,expectedWorkerId:q.expectedWorkerId,baseRequestId:q.baseRequestId,command})}:{method:"GET"},
        {signal:controller.signal,timeoutMs:this.options.timeoutMs,maxBytes:262144,errorStatuses:REVISION_CYCLE_ERRORS});
      if(g!==this.generation||this.paused)return "failed";
      const result=parseRevisionCycleResponse(raw,q);if(result.employeeId!==this.options.employeeId)throw Error("attendance_access_denied");this.checkStorage();
      if(p&&result.receipt){if(JSON.stringify(parseRevisionCycleCommand(result.receipt.command))!==JSON.stringify(p.command))throw Error("receipt_mismatch");this.clear();}
      else if(command)throw Error("receipt_missing");
      this.set({result,phase:this.state.pending?"unconfirmed":"ready",message:this.state.pending?"原操作仍待确认；请查收据或明确用原编号重试。":result.receipt?"原操作已确认；下方显示当前申请状态。提交或撤回不等于批准，也不会改变原始打卡。":"已核对当前核定及本人权限。新申请需要明确提交，不会自动生效。"});
      return this.state.pending?"missing":"done";
    }catch(e){
      if(g!==this.generation||this.paused)return "failed";let missing=false;
      try{
        this.checkStorage();missing=!command&&!!this.state.pending&&e instanceof AttendanceManagementRejected&&e.message==="attendance_correction_not_found";
        if(command&&e instanceof AttendanceManagementRejected&&e.message!=="attendance_operation_conflict"&&e.message!=="attendance_application_window_protocol_required"&&(first||["attendance_version_conflict","attendance_revision_base_changed","attendance_correction_closed","attendance_correction_policy_changed"].includes(e.message)))this.clear();
      }catch{missing=false;}
      this.set({result:null,phase:this.state.pending?"unconfirmed":"blocked",message:this.message(e)});return missing?"missing":"failed";
    }finally{if(g===this.generation)this.controller=null;}
  }
}
