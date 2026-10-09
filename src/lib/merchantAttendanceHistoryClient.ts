import { attendanceManagementMessage, attendanceManagementRequest } from "./merchantAttendanceManagementClient";
import { ATTENDANCE_HISTORY_ERRORS, parseAttendanceHistoryQuery, parseAttendanceHistoryResult, type AttendanceHistoryQuery, type AttendanceHistoryResult } from "./merchantAttendanceHistory";
import { attendanceDayUtcRange } from "./merchantAttendanceTime";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";

export function attendanceHistoryQueryString(query: AttendanceHistoryQuery) {
  const q = new URLSearchParams();
  for (const [key,value] of Object.entries(query)) if (value !== null) q.set(key,value);
  return q.toString();
}
export function attendanceHistoryDateQuery(siteId: string, startDate: string, endDate: string, timeZone: string) {
  const start = attendanceDayUtcRange(startDate,timeZone), end = attendanceDayUtcRange(endDate,timeZone);
  if (endDate < startDate || Date.parse(`${endDate}T00:00Z`) - Date.parse(`${startDate}T00:00Z`) >= 30 * 86400000) throw Error("attendance_invalid_request");
  return parseAttendanceHistoryQuery(`https://local.invalid/?${new URLSearchParams({siteId,fromAt:start.startAt,toAt:end.endAt})}`);
}
type HistoryState = { phase: "idle" | "loading" | "ready" | "blocked"; query: AttendanceHistoryQuery | null;
  result: (AttendanceHistoryResult & {moduleEnabled:boolean}) | null; message: string };
export class AttendanceHistoryClient {
  private state: HistoryState = {phase:"idle",query:null,result:null,message:"选择日期和显示时区，查询本人原始打卡记录。"};
  private generation = 0;
  private controller: AbortController | null = null;
  private listeners = new Set<() => void>();
  private explicitRefreshRequired = false;
  constructor(private readonly options: {siteId:string;employeeId:string;apiFetch:AttendanceApiFetch;timeoutMs?:number}) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {this.listeners.add(listener);return () => {this.listeners.delete(listener);};};
  private set(update: Partial<HistoryState>) {this.state={...this.state,...update};for (const listener of this.listeners) listener();}
  invalidate = (forgetQuery = false) => {
    this.generation++;this.controller?.abort();this.controller=null;
    this.set({phase:"idle",result:null,...(forgetQuery ? {query:null} : {}),message:"返回此页面后重新核验本人访问权限。"});
  };
  // A session may invalidate only the exact page that launched it. Keep the
  // worker/cursor preconditions, and never turn denial into an automatic reset.
  invalidateFromSession = (expected: HistoryState["result"]) => {
    if (!expected || this.state.result !== expected) return false;
    this.explicitRefreshRequired = true;this.invalidate();
    this.set({phase:"blocked",message:"无法确认当前本人可查看的完整班次，已清除历史和班次资料。请重新查询首页或联系负责人核验；不会自动切换人员或修改记录。"});
    return true;
  };
  load = async (input: AttendanceHistoryQuery) => {
    this.explicitRefreshRequired = false;
    this.invalidate();const generation=this.generation,controller=new AbortController();this.controller=controller;
    this.set({phase:"loading",query:null,message:"正在核验本人身份并读取记录…"});
    try {
      attendanceSelfUuid(this.options.employeeId);
      const query=parseAttendanceHistoryQuery(`https://local.invalid/?${attendanceHistoryQueryString(input)}`);
      if(query.siteId!==this.options.siteId) throw Error("attendance_invalid_request");
      this.set({query});
      const body=await attendanceManagementRequest(this.options.apiFetch,`/api/merchant-enterprise/attendance/history?${attendanceHistoryQueryString(query)}`,
        {},{signal:controller.signal,timeoutMs:this.options.timeoutMs,maxBytes:98304,errorStatuses:ATTENDANCE_HISTORY_ERRORS});
      const result={...parseAttendanceHistoryResult(body,query),moduleEnabled:body.moduleEnabled as boolean};
      if(result.employeeId!==this.options.employeeId) throw Error("attendance_access_denied");
      if(generation===this.generation) this.set({phase:"ready",result,query:{...query,expectedWorkerId:result.workerId},
        message:result.items.length ? `本页 ${result.items.length} 条本人打卡记录。` : "当前日期范围内暂无本人打卡记录。"});
    } catch(error) {
      if(generation===this.generation) this.set({phase:"blocked",result:null,message: error instanceof Error && error.message==="attendance_worker_changed"
        ? "账号绑定的考勤档案已变化，请重新查询首页；不会继续显示旧档案。" : historyMessage(error)});
    } finally {if(generation===this.generation)this.controller=null;}
  };
  next = async () => {
    const {phase,query,result}=this.state;
    if(phase!=="ready"||!query||!result?.nextCursor)return;
    await this.load({...query,expectedWorkerId:result.workerId,asOf:result.asOf,cursorAt:result.nextCursor.occurredAt,cursorId:result.nextCursor.id});
  };
  refresh = async (first = false) => {
    if(this.explicitRefreshRequired&&!first)return;
    const query=this.state.query;
    if(query)await this.load(first ? {...query,expectedWorkerId:null,asOf:null,cursorAt:null,cursorId:null} : query);
  };
}
function historyMessage(error: unknown) {
  const message=attendanceManagementMessage(error);
  return message.startsWith("未能确认服务器结果") ? "未能读取本人历史，请检查网络后手动重试；没有提交或修改打卡记录。" : message;
}
