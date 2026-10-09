import {ATTENDANCE_AUDIT_EXPORT_ERRORS,attendanceAuditExportQueryString,buildAttendanceAuditCsv,parseAttendanceAuditExportQuery,
  parseAttendanceAuditExportResult,type AttendanceAuditExportQuery} from "./merchantAttendanceAuditExport";
import {attendanceManagementMessage,attendanceManagementRequest} from "./merchantAttendanceManagementClient";
import type {AttendanceApiFetch} from "./merchantAttendanceSelfClient";

type State={phase:"idle"|"loading"|"ready"|"blocked";message:string};
export class AttendanceAuditExportClient {
  private state:State={phase:"idle",message:"导出当前筛选条件，不限于正在浏览的这一页。"};
  private generation=0;
  private controller:AbortController|null=null;
  private listeners=new Set<()=>void>();
  constructor(private readonly options:{siteId:string;apiFetch:AttendanceApiFetch;timeoutMs?:number;
    deliver:(file:ReturnType<typeof buildAttendanceAuditCsv>)=>void;available:()=>boolean;onDenied?:()=>void}){}
  getSnapshot=()=>this.state;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private set(update:State){this.state=update;for(const fn of this.listeners)fn();}
  invalidate=()=>{this.generation++;this.controller?.abort();this.controller=null;
    this.set({phase:"idle",message:"筛选或页面发生变化后，需重新点击导出；不自动下载或重试。"});};
  invalidInput=()=>{this.invalidate();this.set({phase:"blocked",message:"请检查日期和时区后重新导出（最多 30 个自然日）。"});};
  download=async(input:AttendanceAuditExportQuery)=>{
    if(this.state.phase==="loading"||!this.options.available())return;
    this.invalidate();const g=this.generation,controller=new AbortController();this.controller=controller;
    let dispatched=false;
    this.set({phase:"loading",message:"正在核验当前负责人身份并生成受限快照…"});
    try{
      const q=parseAttendanceAuditExportQuery(`https://local.invalid/?${attendanceAuditExportQueryString(input)}`);
      if(q.siteId!==this.options.siteId)throw Error("attendance_invalid_request");
      const body=await attendanceManagementRequest(this.options.apiFetch,`/api/merchant-enterprise/attendance/audit-export?${attendanceAuditExportQueryString(q)}`,{},
        {signal:controller.signal,timeoutMs:this.options.timeoutMs,maxBytes:2097152,errorStatuses:{...ATTENDANCE_AUDIT_EXPORT_ERRORS,
          unauthorized:401,enterprise_management_disabled:403,forbidden_origin:403}});
      const result=parseAttendanceAuditExportResult(body,q);
      if(g!==this.generation||!this.options.available())return;
      const file=buildAttendanceAuditCsv(result);
      dispatched=true;
      this.options.deliver(file);
      this.set({phase:"ready",message:`已发起 CSV 下载：${file.count} 条变更。请在浏览器下载记录确认文件已保存；这是读取时可见的快照，不是工资报表。`});
    }catch(error){
      if(g!==this.generation)return;
      const code=error instanceof Error?error.message:"";
      if(["unauthorized","attendance_access_denied","enterprise_management_disabled","forbidden_origin"].includes(code))this.options.onDenied?.();
      const message=dispatched?"无法确认浏览器是否已开始下载，请先检查下载记录，再决定是否重试。":
        code==="attendance_export_too_large"?"所选范围超过 250 条或文件大小上限，请缩小日期范围后重新导出；没有下载不完整文件。":
        code==="unauthorized"?"登录已失效，请重新登录后导出；未发起文件下载。":
        ["attendance_invalid_request","attendance_invalid_instant","attendance_access_denied","attendance_rate_limited","attendance_not_available","enterprise_management_disabled","forbidden_origin"].includes(code)?attendanceManagementMessage(error):
        "未完成导出，未发起文件下载。请稍后手动重试；不会自动重试或保留导出内容。";
      this.set({phase:"blocked",message});
    }finally{if(g===this.generation){this.controller=null;if(this.getSnapshot().phase==="loading")this.invalidate();}}
  };
}
