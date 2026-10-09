import {ATTENDANCE_SESSION_ERRORS,attendanceSessionQueryString,parseAttendanceSessionQuery,parseAttendanceSessionResult,
  summarizeAttendanceSessionRecords,type AttendanceSessionQuery,type AttendanceSessionResult,type AttendanceSessionReport} from "./merchantAttendanceSession";
import {attendanceManagementRequest,attendanceManagementMessage,AttendanceManagementRejected} from "./merchantAttendanceManagementClient";
import type {AttendanceApiFetch} from "./merchantAttendanceSelfClient";
import {attendanceSelfSite,attendanceSelfUuid} from "./merchantAttendanceSelf";
class SessionIdentityInvalidated extends Error{}
type State={phase:"idle"|"loading"|"ready"|"blocked";result:(AttendanceSessionResult&{moduleEnabled:boolean})|null;report:AttendanceSessionReport|null;message:string};
export class AttendanceSessionClient{
  private state:State={phase:"idle",result:null,report:null,message:"展开后核验本人权限并读取这次班次。"};
  private generation=0;
  private controller:AbortController|null=null;
  private listeners=new Set<()=>void>();
  private disposed=false;
  constructor(private readonly options:{siteId:string;employeeId:string;startEventId:string;expectedWorkerId?:string;apiFetch:AttendanceApiFetch;timeoutMs?:number;onIdentityInvalidated?:()=>void}){}
  getSnapshot=()=>this.state;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private set(update:Partial<State>){this.state={...this.state,...update};for(const fn of this.listeners)fn();}
  invalidate=()=>{this.generation++;this.controller?.abort();this.controller=null;this.set({phase:"idle",result:null,report:null,message:"返回页面后重新核验本人权限。"});};
  dispose=()=>{this.disposed=true;this.invalidate();};
  initialize=async()=>{this.disposed=false;await this.load();};
  load=async()=>{
    if(this.disposed)return;
    this.invalidate();const g=this.generation,controller=new AbortController();this.controller=controller;
    this.set({phase:"loading",message:"正在读取本班次原始记录…"});
    try{
      attendanceSelfUuid(this.options.employeeId);
      if(this.options.expectedWorkerId!==undefined)attendanceSelfUuid(this.options.expectedWorkerId);
      const input:AttendanceSessionQuery={siteId:this.options.siteId,startEventId:this.options.startEventId};
      const query=parseAttendanceSessionQuery(`https://local.invalid/?${attendanceSessionQueryString(input)}`);
      const raw=await attendanceManagementRequest(async(url,init)=>{
        const response=await this.options.apiFetch(url,init);
        // Authentication errors need not have an attendance JSON envelope.
        if(response.status===401||response.status===403){
          void response.body?.cancel().catch(()=>{});throw new SessionIdentityInvalidated("attendance_access_denied");
        }
        return response;
      },`/api/merchant-enterprise/attendance/session?${attendanceSessionQueryString(query)}`,{},
        {signal:controller.signal,timeoutMs:this.options.timeoutMs,maxBytes:1048576,errorStatuses:{...ATTENDANCE_SESSION_ERRORS,attendance_worker_changed:409}});
      // Validate the returned segment before comparing its identity. A malformed
      // success body is a protocol failure, not evidence of changed authority.
      if(!Array.isArray(raw.events)||!raw.events.length||!raw.events[0]||typeof raw.events[0]!=="object")
        throw Error("attendance_session_invalid_records");
      const returnedQuery={siteId:attendanceSelfSite(raw.siteId),startEventId:attendanceSelfUuid(raw.events[0].id)};
      const result={...parseAttendanceSessionResult(raw,returnedQuery),moduleEnabled:raw.moduleEnabled as boolean};
      if(result.siteId!==query.siteId||result.employeeId!==this.options.employeeId||result.events[0].id!==query.startEventId
        ||this.options.expectedWorkerId!==undefined&&result.workerId!==this.options.expectedWorkerId)
        throw new SessionIdentityInvalidated("attendance_access_denied");
      const report=summarizeAttendanceSessionRecords(result);
      if(!this.disposed&&g===this.generation)this.set({phase:"ready",result,report,message:report.status==="completed"?"已按该班次完整原始记录核对；不是审批、锁定或工资结果。":"本班次尚未结束：不生成完整时长，不自动补下班。"});
    }catch(error){if(!this.disposed&&g===this.generation){
      this.set({phase:"blocked",result:null,report:null,message:attendanceSessionMessage(error)});
      if(!this.disposed&&g===this.generation&&(error instanceof SessionIdentityInvalidated||error instanceof AttendanceManagementRejected
        &&["attendance_access_denied","attendance_session_not_found","attendance_worker_changed"].includes(error.message)))this.options.onIdentityInvalidated?.();
    }}
    finally{if(g===this.generation)this.controller=null;}
  };
}
function attendanceSessionMessage(error:unknown){
  const code=error instanceof Error?error.message:"";
  if(code==="attendance_session_not_found")return "无法确认当前本人可查看的完整班次，请重新查询历史或联系负责人核验；不会切换人员或修改记录。";
  if(["attendance_session_too_large","attendance_session_span_too_long","attendance_session_invalid_records"].includes(code))return "本班次记录不完整、顺序异常或超出核对范围，请联系负责人核查；未生成推测时长，也未修改原始记录。";
  const message=attendanceManagementMessage(error);
  return message.startsWith("未能确认服务器结果")?"暂时无法核对本班次，请手动重试；没有新增或修改打卡。":message;
}
