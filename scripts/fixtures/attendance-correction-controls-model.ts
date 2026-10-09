import type { AttendanceApiFetch } from "../../src/lib/merchantAttendanceSelfClient";
import { attendanceDayUtcRange } from "../../src/lib/merchantAttendanceTime";
import { attendanceRecordInstant } from "../../src/lib/merchantAttendanceManagement";
import { parseCorrectionControlCommand, type CorrectionControlEntry, type CorrectionControlResult } from "../../src/lib/merchantAttendanceCorrectionControls";
export const controlSite = "99990001", controlId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`, controlOwner = controlId(1);
export function createCorrectionControlsFixture() {
  const entries: CorrectionControlEntry[] = [], commands = new Map<string,string>(), calls: { path: string; method: string; body?: string }[] = [];
  let mode = "normal", moduleEnabled = true, settingsVersion = 1;
  const response = (operationId: string | null, before: number | null): CorrectionControlResult & { moduleEnabled: boolean } => {
    const active = new Map<string, Extract<CorrectionControlEntry,{ action: "lock_period" | "unlock_period" }>>();
    for (const e of entries) if (e.action === "lock_period") active.set(e.values.periodId, e); else if (e.action === "unlock_period") active.delete(e.values.periodId);
    const history = [...entries].reverse().filter(e => before === null || e.revision < before), page = history.slice(0,25);
    return { siteId: controlSite, asOf: "2026-09-30T13:00:00.000000Z", controlsOnly: true, approvalAvailable: false, rulesEnforced: true,
      revision: entries.length, settingsVersion, timeZone: "Europe/Madrid", policy: [...entries].reverse().find(e => e.action === "set_policy") as Extract<CorrectionControlEntry,{action:"set_policy"}> ?? null,
      activePeriods: [...active.values()].map(e => ({ ...e.values, revision: e.revision })).sort((a,b) => a.startAt.localeCompare(b.startAt)),
      entries: page, nextBeforeRevision: history.length>25 ? page.at(-1)!.revision : null, receipt: entries.find(e => e.operationId === operationId) ?? null, moduleEnabled };
  };
  const apiFetch: AttendanceApiFetch = async (path, init) => {
    const method=init?.method ?? "GET", body=typeof init?.body === "string" ? init.body : undefined; calls.push({path,method,body});
    const reject=(error:string,status=409)=>Response.json({ok:false,error},{status});
    if (!path.startsWith("/api/merchant-enterprise/attendance/correction-controls")) throw Error("synthetic_route_missing");
    if (mode === "denied") return reject("attendance_access_denied",403);
    if (mode === "offline" || mode === "unsent" && method === "POST") throw Error("offline");
    if (method === "POST") {
      const {siteId,command:c}=parseCorrectionControlCommand(JSON.parse(body!));if(siteId!==controlSite)throw Error("synthetic_tenant");
      const saved=commands.get(c.operationId);
      if(saved) { if(saved!==JSON.stringify(c))return reject("attendance_operation_conflict"); }
      else {
        if(!moduleEnabled)return reject("attendance_platform_paused",403);
        if(c.expectedRevision!==entries.length||c.expectedSettingsVersion!==settingsVersion)return reject("attendance_version_conflict");
        const base={revision:entries.length+1,operationId:c.operationId,recordedAt:attendanceRecordInstant(new Date(Date.UTC(2026,8,30,12,0,entries.length+1)).toISOString()),reason:c.reason};
        let entry:CorrectionControlEntry;
        if(c.action==="set_policy")entry={...base,action:c.action,values:{submissionWindowDays:c.submissionWindowDays,timeZone:"Europe/Madrid"}};
        else if(c.action==="lock_period"){
          const values={periodId:c.operationId,fromDate:c.fromDate,throughDate:c.throughDate,timeZone:"Europe/Madrid",startAt:attendanceRecordInstant(attendanceDayUtcRange(c.fromDate,"Europe/Madrid").startAt),endAt:attendanceRecordInstant(attendanceDayUtcRange(c.throughDate,"Europe/Madrid").endAt)};
          if(response(null,null).activePeriods.some(p=>p.startAt<values.endAt&&p.endAt>values.startAt))return reject("attendance_period_overlap");
          entry={...base,action:c.action,values};
        }else{const p=response(null,null).activePeriods.find(p=>p.periodId===c.periodId);if(!p)return reject("attendance_period_not_locked");entry={...base,action:c.action,values:p};}
        entries.push(entry);commands.set(c.operationId,JSON.stringify(c));
      }
      if(mode==="lost")throw Error("lost_response");
      return Response.json({ok:true,...response(c.operationId,null)});
    }
    if(method!=="GET")throw Error("synthetic_method");
    const q=new URL(path,"https://synthetic.invalid").searchParams;
    return Response.json({ok:true,...response(q.get("operationId"),q.has("beforeRevision")?Number(q.get("beforeRevision")):null)});
  };
  return {apiFetch,calls,entries,response,mode:(v:string)=>{mode=v;},enabled:(v:boolean)=>{moduleEnabled=v;},bumpSettings:()=>{settingsVersion++;}};
}
