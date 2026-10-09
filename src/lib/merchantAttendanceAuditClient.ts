import {ATTENDANCE_AUDIT_ERRORS,attendanceAuditQueryString,parseAttendanceAuditQuery,parseAttendanceAuditResult,
  type AttendanceAuditItem,type AttendanceAuditQuery,type AttendanceAuditResult} from "./merchantAttendanceAudit";
import {attendanceManagementMessage,attendanceManagementRequest} from "./merchantAttendanceManagementClient";
import type {AttendanceApiFetch} from "./merchantAttendanceSelfClient";
type ListQuery=Extract<AttendanceAuditQuery,{mode:"list"}>;
type ListResult=Extract<AttendanceAuditResult,{mode:"list"}>&{moduleEnabled:boolean};
type DetailResult=Extract<AttendanceAuditResult,{mode:"detail"}>;
type State={phase:"idle"|"loading"|"ready"|"blocked";query:ListQuery|null;result:ListResult|null;
  detail:DetailResult|null;detailLoading:string|null;message:string};
export class AttendanceAuditClient {
  private state:State={phase:"idle",query:null,result:null,detail:null,detailLoading:null,message:"选择日期和记录类型后查询。"};
  private generation=0;
  private controller:AbortController|null=null;
  private detailController:AbortController|null=null;
  private detailGeneration=0;
  private listeners=new Set<()=>void>();
  constructor(private readonly options:{siteId:string;apiFetch:AttendanceApiFetch;timeoutMs?:number}){}
  getSnapshot=()=>this.state;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private set(update:Partial<State>){this.state={...this.state,...update};for(const fn of this.listeners)fn();}
  closeDetail=()=>{this.detailGeneration++;this.detailController?.abort();this.detailController=null;this.set({detail:null,detailLoading:null});};
  invalidate=(forgetQuery=false)=>{this.generation++;this.controller?.abort();this.controller=null;this.closeDetail();
    this.set({phase:"idle",result:null,...(forgetQuery?{query:null}:{}),message:"返回页面后重新核验负责人权限。"});};
  private async request(query:AttendanceAuditQuery,signal:AbortSignal){
    const body=await attendanceManagementRequest(this.options.apiFetch,`/api/merchant-enterprise/attendance/audit?${attendanceAuditQueryString(query)}`,{},
      {signal,timeoutMs:this.options.timeoutMs,maxBytes:65536,errorStatuses:ATTENDANCE_AUDIT_ERRORS});
    return {...parseAttendanceAuditResult(body,query),moduleEnabled:body.moduleEnabled as boolean};
  }
  load=async(input:ListQuery)=>{
    this.invalidate();const g=this.generation,controller=new AbortController();this.controller=controller;
    this.set({phase:"loading",query:null,message:"正在核验负责人身份并读取变更记录…"});
    try{
      const query=parseAttendanceAuditQuery(`https://local.invalid/?${attendanceAuditQueryString(input)}`);
      if(query.mode!=="list"||query.siteId!==this.options.siteId)throw Error("attendance_invalid_request");
      this.set({query});const result=await this.request(query,controller.signal);
      if(result.mode!=="list")throw Error("invalid_response");
      if(g===this.generation)this.set({phase:"ready",result,message:result.items.length?`本页 ${result.items.length} 条变更记录；点击查看前后对比。`:"当前日期范围内没有此类变更记录。"});
    }catch(error){if(g===this.generation)this.set({phase:"blocked",result:null,message:auditMessage(error)});}
    finally{if(g===this.generation)this.controller=null;}
  };
  detail=async(entry:AttendanceAuditItem)=>{
    const list=this.state.result;
    if(this.state.phase!=="ready"||!list||!list.items.includes(entry))return;
    this.closeDetail();const g=this.generation,dg=this.detailGeneration,controller=new AbortController();this.detailController=controller;
    this.set({detailLoading:entry.operationId});
    try{
      const result=await this.request({siteId:this.options.siteId,source:list.source,mode:"detail",operationId:entry.operationId},controller.signal);
      if(result.mode!=="detail"||["kind","version","targetId","employeeId","actorRef","recordedAt"].some(k=>result.item[k as keyof AttendanceAuditItem]!==entry[k as keyof AttendanceAuditItem]))throw Error("invalid_response");
      if(g===this.generation&&dg===this.detailGeneration)this.set({detail:result,detailLoading:null});
    }catch(error){if(g===this.generation&&dg===this.detailGeneration){this.invalidate();this.set({phase:"blocked",message:auditMessage(error)});}}
    finally{if(g===this.generation&&dg===this.detailGeneration)this.detailController=null;}
  };
  next=async()=>{const {query,result,phase}=this.state;if(phase!=="ready"||!query||!result?.nextCursor)return;
    await this.load({...query,asOf:result.asOf,cursorAt:result.nextCursor.recordedAt,cursorId:result.nextCursor.operationId});};
  refresh=async(first=false)=>{const query=this.state.query;if(query)await this.load(first?{...query,asOf:null,cursorAt:null,cursorId:null}:query);};
}
function auditMessage(error:unknown){
  if(error instanceof Error&&error.message==="attendance_audit_not_found")return "未找到该变更记录，请重新查询；不会显示其他企业的同名编号。";
  const message=attendanceManagementMessage(error);
  return message.startsWith("未能确认服务器结果")?"未能读取变更记录，请稍后手动重试；未修改任何配置或历史。":message;
}
