import {attendanceManagementRequest} from "./merchantAttendanceManagementClient";
import {attendanceTimesheetMessage} from "./merchantAttendanceTimesheetClient";
import type {AttendanceApiFetch} from "./merchantAttendanceSelfClient";
import {attendanceSelfSite,attendanceSelfUuid} from "./merchantAttendanceSelf";
import {attendanceLocalDate} from "./merchantAttendanceTime";
import {currentAttendanceReportVersion} from "./merchantAttendanceCurrentReportVersion";
import {ATTENDANCE_SCOPED_TIMESHEET_ERRORS,attendanceScopedTimesheetQueryString,parseAttendanceScopedTimesheetQuery,type AttendanceScopedTimesheetQuery} from "./merchantAttendanceScopedTimesheet";
import {parseScopedContext,parseScopedContextQuery,scopedContextQueryString,scopedPairKey,type ScopedContext,type ScopedPair} from "./merchantAttendanceScopedTimesheetContext";
import {parseScopedTimesheetResponse} from "./merchantAttendanceScopedTimesheetResponse";
type State={phase:"idle"|"loading"|"ready"|"blocked";context:ScopedContext|null;pair:ScopedPair|null;search:string;searchDraft:string;fromDate:string;throughDate:string;
  result:ReturnType<typeof parseScopedTimesheetResponse>|null;message:string};
const initial=():State=>({phase:"idle",context:null,pair:null,search:"",searchDraft:"",fromDate:"",throughDate:"",result:null,message:"请读取当前授权范围。"});
const errors={...ATTENDANCE_SCOPED_TIMESHEET_ERRORS,attendance_version_conflict:409};
export class AttendanceScopedTimesheetClient{
  private state=initial();private generation=0;private controller:AbortController|null=null;private listeners=new Set<()=>void>();
  private expiryTimer:ReturnType<typeof setTimeout>|null=null;private deadline=0;
  constructor(private readonly options:{siteId:string;actorId:string;access:"self"|"manager";apiFetch:AttendanceApiFetch;timeoutMs?:number;monotonicNow?:()=>number;displayMs?:number}){}
  getSnapshot=()=>this.state;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private now(){return this.options.monotonicNow?.()??performance.now();}
  private set(p:Partial<State>){this.state={...this.state,...p};for(const fn of this.listeners)fn();}
  private cancel(){this.generation++;this.controller?.abort();this.controller=null;}
  invalidate=()=>{this.cancel();if(this.expiryTimer!==null)clearTimeout(this.expiryTimer);this.expiryTimer=null;this.deadline=0;this.set({...initial(),message:"已清除工时资料，请重新读取权限和范围。"});};
  private expired(){this.invalidate();this.set({phase:"blocked",message:"资料显示时限或授权已到期，请重新读取；未自动请求或延长授权。"});}
  private valid(){if(this.deadline&&this.now()>=this.deadline){this.expired();return false;}return true;}
  private arm(deadline:number){
    if(deadline<=this.now())throw Error("attendance_scope_expired");
    this.deadline=deadline;if(this.expiryTimer!==null)clearTimeout(this.expiryTimer);
    const check=()=>{const remaining=this.deadline-this.now();if(remaining<=0)this.expired();else this.expiryTimer=setTimeout(check,Math.min(remaining,2147483647));};
    this.expiryTimer=setTimeout(check,Math.min(deadline-this.now(),2147483647));
  }
  private budget(asOf:string,until:string|null,started:number){
    // Monotonic relative deadline: local wall-clock skew cannot prolong a grant.
    // Subtract full round trip conservatively by anchoring at request start.
    return started+Math.min(this.options.displayMs??300000,until===null?Infinity:Date.parse(until)-Date.parse(asOf)-1);
  }
  clearReport=()=>{this.cancel();if(!this.valid())return;this.set({phase:"ready",result:null,message:"条件已改变，请明确查询；不会自动读取工时。"});};
  setDates=(fromDate:string,throughDate:string)=>{this.clearReport();if(this.state.context)this.set({fromDate,throughDate});};
  setSearch=(searchDraft:string)=>{this.clearReport();if(this.state.context)this.set({searchDraft});};
  selectPair=(key:string)=>{this.clearReport();const pair=this.state.context?.items.find(p=>scopedPairKey(p)===key);if(pair)this.set({pair});};
  private request(url:string,signal:AbortSignal,maxBytes=32768){return attendanceManagementRequest(this.options.apiFetch,url,{method:"GET"},{signal,maxBytes,timeoutMs:this.options.timeoutMs,errorStatuses:errors});}
  private async run(task:(signal:AbortSignal,g:number,started:number)=>Promise<void>){
    this.cancel();const g=this.generation,controller=new AbortController();this.controller=controller;
    this.set({phase:"loading",result:null,message:"正在核验当前权限并读取…"});
    try{attendanceSelfSite(this.options.siteId);attendanceSelfUuid(this.options.actorId);await task(controller.signal,g,this.now());}
    catch(e){if(g===this.generation){this.invalidate();const code=e instanceof Error?e.message:"";
      this.set({phase:"blocked",message:code==="attendance_scope_expired"?"授权或显示时限已到期，请重新读取。":code==="attendance_worker_changed"?"本人考勤档案已换绑，请重新读取；没有沿用旧档案。":code==="attendance_version_conflict"?"主管授权已更新，请重新读取人员和地点。":attendanceTimesheetMessage(e)});}}
    finally{if(g===this.generation)this.controller=null;}
  }
  initialize=async()=>{this.invalidate();await this.loadContext("");};
  loadContext=async(search:string,cursor:string|null=null)=>{
    const old=this.state.context;if(cursor&&(!old||!this.valid()))return;
    const revision=cursor?old!.scopeRevision:null;
    this.set({context:null,pair:null,search:search.trim(),searchDraft:search.trim()});
    await this.run(async(signal,g,started)=>{
      const q=parseScopedContextQuery("https://local.invalid/?"+scopedContextQueryString({siteId:this.options.siteId,access:this.options.access,search:search.trim(),cursor,scopeRevision:revision}));
      const raw=await this.request("/api/merchant-enterprise/attendance/scoped-timesheet-context?"+scopedContextQueryString(q),signal),context=parseScopedContext(raw,q);
      if(context.viewerEmployeeId!==this.options.actorId)throw Error("attendance_access_denied");
      if(g!==this.generation)return;
      const throughDate=attendanceLocalDate(new Date(context.asOf).toISOString(),context.timeZone),fromDate=new Date(Date.parse(throughDate+"T00:00:00Z")-6*86400000).toISOString().slice(0,10);
      this.arm(this.budget(context.asOf,context.accessValidUntil,started));
      this.set({phase:"ready",context,fromDate,throughDate,message:this.options.access==="self"?"已核实本人档案，请选择日期并查询。":"请选择一组获授权的人员与地点，再查询工时。"});
    });
  };
  load=async()=>{
    if(!this.valid())return;const {context,pair,fromDate,throughDate}=this.state;if(!context||(this.options.access==="manager"&&!pair))return;
    let query:AttendanceScopedTimesheetQuery;
    try{const common={siteId:this.options.siteId,fromDate,throughDate};
      query=this.options.access==="self"?{...common,access:"self",expectedWorkerId:context.worker!.id}:{...common,access:"manager",workerId:pair!.workerId,locationId:pair!.locationId};
      query=parseAttendanceScopedTimesheetQuery("https://local.invalid/?"+attendanceScopedTimesheetQueryString(query));
    }catch{this.clearReport();this.set({message:"请核对日期，一次最多查询 31 个自然日。"});return;}
    await this.run(async(signal,g,started)=>{
      const raw=await this.request("/api/merchant-enterprise/attendance/scoped-timesheet?"+attendanceScopedTimesheetQueryString(query),signal,1048576);
      const result=parseScopedTimesheetResponse(raw,query,this.options.actorId,currentAttendanceReportVersion(raw));
      if(result.timeZone!==context.timeZone)throw Error("attendance_report_zone_changed");
      if(result.scopeRevision!==context.scopeRevision)throw Error("attendance_version_conflict");
      if(g!==this.generation)return;
      this.arm(Math.min(this.deadline,this.budget(result.asOf,result.accessValidUntil,started)));
      this.set({phase:"ready",result,message:"已核对当前可完整查看的班次。此子集不是完整个人月报，零值不能判断缺勤。"});
    });
  };
}
