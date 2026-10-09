import {attendanceManagementRequest} from "./merchantAttendanceManagementClient";
import type {AttendanceApiFetch} from "./merchantAttendanceSelfClient";
import {attendanceRecordInstant} from "./merchantAttendanceManagement";
import {parseTimesheetExportCommand,parseTimesheetExportReceipt,timesheetExportFilename,TIMESHEET_EXPORT_MAX_BYTES,TIMESHEET_EXPORT_ERRORS,type TimesheetExportCommand} from "./merchantAttendanceTimesheetExport";
type State={phase:"idle"|"loading"|"ready"|"blocked";message:string;operationId:string|null};
export class AttendanceTimesheetExportClient{
  private state:State={phase:"idle",message:"导出时重新读取并核验，文件可能与上方较早的查询结果不同。",operationId:null};
  private generation=0;
  private controller:AbortController|null=null;
  private listeners=new Set<()=>void>();
  constructor(private readonly options:{selection:Omit<TimesheetExportCommand,"operationId">;actorId:string;apiFetch:AttendanceApiFetch;
    available:()=>boolean;deliver:(file:{csv:string;filename:string})=>void;onDenied?:()=>void;randomId?:()=>string;timeoutMs?:number;now?:()=>number}){}
  getSnapshot=()=>this.state;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private set(state:State){this.state=state;for(const fn of this.listeners)fn();}
  invalidate=()=>{this.generation++;this.controller?.abort();this.controller=null;
    this.set({phase:"idle",message:"页面或条件已变化，已取消本页下载；不自动重试，服务器可能已留下来源读取记录。",operationId:null});};
  download=async(acknowledged:boolean)=>{
    if(!acknowledged||this.state.phase==="loading"||!this.options.available())return;
    this.invalidate();const g=this.generation,controller=new AbortController();this.controller=controller;
    const now=this.options.now??(()=>performance.now()),started=now();let sent=false,dispatched=false,operationId:string|null=null;
    try{
      const command=parseTimesheetExportCommand({...this.options.selection,operationId:(this.options.randomId??(()=>crypto.randomUUID()))()});operationId=command.operationId;
      this.set({phase:"loading",message:"正在重新核验范围、读取来源并生成 CSV…",operationId});sent=true;
      const body=await attendanceManagementRequest(this.options.apiFetch,"/api/merchant-enterprise/attendance/timesheet-export",
        {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(command)},
        {signal:controller.signal,timeoutMs:this.options.timeoutMs,maxBytes:2*TIMESHEET_EXPORT_MAX_BYTES+8192,
          errorStatuses:{...TIMESHEET_EXPORT_ERRORS,unauthorized:401,enterprise_management_disabled:403,forbidden_origin:403}});
      if(g!==this.generation||!this.options.available())return;
      const keys=["ok","moduleEnabled","receipt","replayed","csv","filename","viewerEmployeeId","accessValidUntil"];
      if(Object.keys(body).length!==keys.length||keys.some(k=>!Object.hasOwn(body,k))||typeof body.replayed!=="boolean")throw Error("invalid_response");
      const receipt=parseTimesheetExportReceipt(body.receipt,command);
      if(body.replayed){
        if(body.csv!==null||body.filename!==null||body.viewerEmployeeId!==null||body.accessValidUntil!==null)throw Error("invalid_response");
        this.set({phase:"blocked",operationId,message:"此编号已有来源读取记录，本次不重复下载。请先检查浏览器下载记录；需要时再明确生成一个新文件。"});return;
      }
      if(body.viewerEmployeeId!==(command.query.access==="owner"?null:this.options.actorId))throw Error("attendance_access_denied");
      if(body.accessValidUntil!==null){
        const until=attendanceRecordInstant(body.accessValidUntil);
        if(command.query.access!=="manager"||until!==body.accessValidUntil||Date.parse(until)-Date.parse(receipt.asOf)<=now()-started)throw Error("attendance_access_denied");
      }
      if(now()-started>=300000)throw Error("attendance_access_denied");
      if(typeof body.csv!=="string"||!body.csv.startsWith('\ufeff"记录类型",')||!body.csv.endsWith("\r\n")
        ||new TextEncoder().encode(body.csv).byteLength>TIMESHEET_EXPORT_MAX_BYTES||body.filename!==timesheetExportFilename(command))throw Error("invalid_response");
      if(g!==this.generation||!this.options.available())return;
      dispatched=true;this.options.deliver({csv:body.csv,filename:body.filename as string});
      this.set({phase:"ready",operationId,message:`已请求浏览器下载。请在下载记录确认保存；来源读取时刻 UTC：${receipt.asOf}。服务器不保留 CSV 副本。`});
    }catch(e){
      if(g!==this.generation)return;
      const code=e instanceof Error?e.message:"";
      const denied=["unauthorized","attendance_access_denied","attendance_export_denied","enterprise_management_disabled","forbidden_origin","attendance_worker_changed","attendance_report_zone_changed","attendance_version_conflict"].includes(code);
      const message=dispatched?"无法确认浏览器是否保存文件，请先查看下载记录；不会自动重复下载。":
        denied?"当前导出权限、人员关联或范围已失效，请重新查询并核对授权；未发起本次下载。":
        code==="attendance_report_too_large"?"数据超过单次导出上限，请缩小日期范围；不会下载截断文件。":
        code==="attendance_rate_limited"?"请求较频繁，请等待一分钟后手动操作。":
        code==="attendance_not_available"?"工时报表导出尚未开放。":
        sent?"未能确认导出结果。服务器可能已有来源读取记录，请先检查下载记录；再次操作会明确生成新文件，不自动重试。":"导出参数无效，未发送请求。";
      this.set({phase:"blocked",operationId,message});if(denied)this.options.onDenied?.();
    }finally{if(g===this.generation)this.controller=null;}
  };
}
