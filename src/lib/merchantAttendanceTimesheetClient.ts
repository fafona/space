import {parseAttendanceAdminResult} from "./merchantAttendanceAdmin";
import {parseAttendanceChoicesQuery,parseAttendanceChoicesResult,type AttendanceChoice,type AttendanceChoicesResult} from "./merchantAttendanceChoices";
import {attendanceManagementRequest,attendanceManagementMessage} from "./merchantAttendanceManagementClient";
import {attendanceSelfSite,attendanceSelfUuid} from "./merchantAttendanceSelf";
import type {AttendanceApiFetch} from "./merchantAttendanceSelfClient";
import {attendanceLocalDate} from "./merchantAttendanceTime";
import {ATTENDANCE_TIMESHEET_ERRORS,attendanceTimesheetQueryString,parseAttendanceTimesheetQuery,type AttendanceTimesheetQuery} from "./merchantAttendanceTimesheet";
import {currentAttendanceReportVersion} from "./merchantAttendanceCurrentReportVersion";
import {parseAttendanceTimesheetResponse} from "./merchantAttendanceTimesheetResponse";

type State={phase:"idle"|"loading"|"ready"|"blocked";timeZone:string|null;fromDate:string;throughDate:string;
  choices:AttendanceChoicesResult|null;search:string;worker:AttendanceChoice|null;result:ReturnType<typeof parseAttendanceTimesheetResponse>|null;message:string};
export class AttendanceTimesheetClient{
  private state:State={phase:"idle",timeZone:null,fromDate:"",throughDate:"",choices:null,search:"",worker:null,result:null,message:"读取企业时区后选择人员和日期。"};
  private generation=0;private controller:AbortController|null=null;private listeners=new Set<()=>void>();
  constructor(private readonly options:{siteId:string;ownerId:string;apiFetch:AttendanceApiFetch;timeoutMs?:number;now?:()=>Date}){}
  getSnapshot=()=>this.state;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private set(update:Partial<State>){this.state={...this.state,...update};for(const fn of this.listeners)fn();}
  private cancel(){this.generation++;this.controller?.abort();this.controller=null;}
  invalidate=()=>{this.cancel();this.set({phase:"idle",timeZone:null,fromDate:"",throughDate:"",choices:null,search:"",worker:null,result:null,message:"已隐藏工时资料；返回后重新读取权限和人员。"});};
  clearReport=()=>{this.cancel();this.set({phase:"ready",result:null,message:"条件已改变，请重新查询工时。"});};
  setDates=(fromDate:string,throughDate:string)=>{this.clearReport();this.set({fromDate,throughDate});};
  selectWorker=(id:string)=>{
    const worker=this.state.choices?.items.find(c=>c.id===id);if(!worker)return;
    this.clearReport();this.set({worker});
  };
  private async run(task:(signal:AbortSignal,g:number)=>Promise<void>){
    this.cancel();const g=this.generation,controller=new AbortController();this.controller=controller;
    this.set({phase:"loading",result:null,message:"正在核验当前负责人权限并读取…"});
    try{attendanceSelfSite(this.options.siteId);attendanceSelfUuid(this.options.ownerId);await task(controller.signal,g);}
    catch(e){if(g===this.generation)this.set({phase:"blocked",choices:null,worker:null,result:null,message:attendanceTimesheetMessage(e)});}
    finally{if(g===this.generation)this.controller=null;}
  }
  private request(url:string,signal:AbortSignal,maxBytes=32768){return attendanceManagementRequest(this.options.apiFetch,url,{method:"GET"},
    {signal,maxBytes,timeoutMs:this.options.timeoutMs,errorStatuses:ATTENDANCE_TIMESHEET_ERRORS});}
  initialize=async()=>{
    this.invalidate();await this.run(async(signal,g)=>{
      const q=new URLSearchParams({siteId:this.options.siteId,view:"settings"});
      const raw=await this.request(`/api/merchant-enterprise/attendance/admin?${q}`,signal);
      const result=parseAttendanceAdminResult(raw,{siteId:this.options.siteId,view:"settings",operationId:null});
      if(!result.settings)throw Error("attendance_settings_required");
      const timeZone=result.settings.timeZone,throughDate=attendanceLocalDate((this.options.now?.()??new Date()).toISOString(),timeZone);
      const fromDate=new Date(Date.parse(throughDate+"T00:00:00Z")-6*86400000).toISOString().slice(0,10);
      const choices=await this.choices("",null,signal);
      if(g===this.generation)this.set({phase:"ready",timeZone,fromDate,throughDate,choices,message:"请选择考勤人员，再查询最多 31 个自然日。停用或未绑定账号的人员也可核对历史。"});
    });
  };
  private async choices(search:string,cursor:string|null,signal:AbortSignal){
    const q=new URLSearchParams({siteId:this.options.siteId,kind:"workers",search});if(cursor)q.set("cursor",cursor);
    const expected=parseAttendanceChoicesQuery(`https://local.invalid/?${q}`);
    const raw=await this.request(`/api/merchant-enterprise/attendance/choices?${q}`,signal);
    return parseAttendanceChoicesResult(raw,expected);
  }
  loadChoices=async(search:string,cursor:string|null=null)=>{
    if(!this.state.timeZone)return;
    this.set({choices:null,worker:null});await this.run(async(signal,g)=>{
      const choices=await this.choices(search.trim(),cursor,signal);
      if(g===this.generation)this.set({phase:"ready",choices,search:search.trim(),message:choices.items.length?"每批最多 25 人；请选择人员后查询。":"没有匹配的考勤人员。"});
    });
  };
  load=async()=>{
    const {timeZone,worker,fromDate,throughDate}=this.state;
    if(!timeZone||!worker){this.set({result:null,message:"请先读取设置并选择考勤人员。"});return;}
    let query:AttendanceTimesheetQuery;
    try{query=parseAttendanceTimesheetQuery(`https://local.invalid/?${attendanceTimesheetQueryString({siteId:this.options.siteId,workerId:worker.id,fromDate,throughDate})}`);}
    catch{this.cancel();this.set({phase:"ready",result:null,message:"请核对开始和结束日期，一次最多查询 31 个自然日。"});return;}
    await this.run(async(signal,g)=>{
      const raw=await this.request(`/api/merchant-enterprise/attendance/timesheet?${attendanceTimesheetQueryString(query)}`,signal,1048576);
      const result=parseAttendanceTimesheetResponse(raw,query,currentAttendanceReportVersion(raw));
      if(result.timeZone!==timeZone)throw Error("attendance_report_zone_changed");
      if(g===this.generation)this.set({phase:"ready",result,worker:{...worker,label:result.workerName,detail:result.workerNo},message:"工时已核对。核定口径仅替换已批准班次，不重复相加；此结果不是工资、排班或锁定报表。"});
    });
  };
}
export function attendanceTimesheetMessage(e:unknown){
  const code=e instanceof Error?e.message:"";
  if(code==="attendance_worker_not_found")return "该人员不存在或已不在当前企业，请重新读取人员。";
  if(code==="attendance_report_too_large")return "记录超出单次核对上限，请缩短日期范围；没有展示不完整的合计。";
  if(code==="attendance_report_zone_changed")return "企业时区已经改变，请重新读取设置与人员后查询；未显示旧时区结果。";
  if(["attendance_report_invalid_data","attendance_report_overlap","attendance_session_invalid_records","attendance_session_span_too_long"].includes(code))return "工时记录、核定区间或合计无法完整核对，请联系负责人核查；没有显示推测或部分工时。";
  const message=attendanceManagementMessage(e);
  return message.startsWith("未能确认服务器结果")?"暂时无法读取工时报表，请手动重读；旧结果已清除，没有改动打卡记录。":message;
}
