import type {AttendanceApiFetch} from "./merchantAttendanceSelfClient";
import {attendanceSelfSite,attendanceSelfUuid} from "./merchantAttendanceSelf";
import {attendanceManagementRequest} from "./merchantAttendanceManagementClient";
import {parseRevisionHistoryQuery,parseRevisionHistoryResponse,revisionHistoryQueryString,REVISION_HISTORY_ERRORS,type RevisionHistoryQuery} from "./merchantAttendanceRevisionHistory";
type Result=ReturnType<typeof parseRevisionHistoryResponse>;
type State={phase:"idle"|"loading"|"ready"|"blocked";query:RevisionHistoryQuery|null;result:Result|null;message:string;page:number};
export class AttendanceRevisionHistoryClient{
  private state:State={phase:"idle",query:null,result:null,message:"请选择修订列表范围。",page:1};
  private generation=0;private controller:AbortController|null=null;private listeners=new Set<()=>void>();
  constructor(private readonly options:{siteId:string;actorId:string;access:"owner"|"self";apiFetch:AttendanceApiFetch;timeoutMs?:number}){attendanceSelfSite(options.siteId);attendanceSelfUuid(options.actorId);}
  getSnapshot=()=>this.state;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private set(p:Partial<State>){this.state={...this.state,...p};this.listeners.forEach(fn=>fn());}
  pause=()=>{this.generation++;this.controller?.abort();this.controller=null;this.set({result:null,phase:"idle",message:"列表已隐藏；返回后重新核对当前权限。"});};
  initialize=async(input:RevisionHistoryQuery)=>{this.pause();await this.load(input,1);};
  refresh=async()=>{if(this.state.query)await this.initialize({...this.state.query,asOf:null,cursorAt:null,cursorId:null});};
  next=async()=>{const s=this.state;if(s.phase!=="ready"||!s.query||!s.result?.nextCursor||this.controller)return;
    await this.load({...s.query,asOf:s.result.asOf,cursorAt:s.result.nextCursor.recordedAt,cursorId:s.result.nextCursor.requestId},s.page+1);};
  private async load(input:RevisionHistoryQuery,page:number){
    const g=++this.generation,controller=new AbortController();this.controller=controller;this.set({result:null,phase:"loading"});
    try{
      const query=parseRevisionHistoryQuery(input);if(query.siteId!==this.options.siteId||query.access!==this.options.access)throw Error("attendance_access_denied");this.set({query,page});
      const raw=await attendanceManagementRequest(this.options.apiFetch,'/api/merchant-enterprise/attendance/revision-history?'+revisionHistoryQueryString(query),{method:"GET"},
        {signal:controller.signal,timeoutMs:this.options.timeoutMs,maxBytes:131072,errorStatuses:REVISION_HISTORY_ERRORS});
      if(g!==this.generation)return;const result=parseRevisionHistoryResponse(raw,query);
      if(query.access==="self"&&result.employeeId!==this.options.actorId)throw Error("attendance_access_denied");
      this.set({result,phase:"ready",message:result.items.length?"列表按查询时点展示；进入详情后重新核验，列表不能作为批准凭证。":result.nextCursor?"本页候选中没有符合状态的申请，仍有下一页；不表示整个范围没有记录。":"本页没有符合条件的申请，当前查询范围已到末页。"});
    }catch(e){if(g!==this.generation)return;const code=e instanceof Error?e.message:"";this.set({result:null,phase:"blocked",message:
      code==="attendance_access_denied"?"当前身份没有此列表的访问权限，资料已隐藏。":code==="attendance_worker_changed"?"员工与考勤档案关联已变更，请返回重新核对。":code==="attendance_revision_base_not_found"?"无法读取此班次的本人修订历史，请返回核对班次。":code==="attendance_not_available"?"修订列表候选入口尚未开放。":"列表未能可靠读取，请核对范围后手动重试；没有提交或修改任何考勤。"});
    }finally{if(g===this.generation)this.controller=null;}
  }
}
