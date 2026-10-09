import { StrictMode, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import MerchantAttendanceSelfPanel from "../../src/components/enterprise/MerchantAttendanceSelfPanel";
import { applyAttendanceEvent, initialAttendanceState, type AttendanceEvent } from "../../src/lib/merchantAttendance";
import { parseAttendanceSelfCommand, type AttendanceSelfResult } from "../../src/lib/merchantAttendanceSelf";
import { attendanceActionAllowed } from "../../src/lib/merchantAttendanceEntitlement";
import { parseAttendanceHistoryQuery } from "../../src/lib/merchantAttendanceHistory";
import { attendanceRecordInstant } from "../../src/lib/merchantAttendanceManagement";
import {parseAttendanceSessionQuery} from "../../src/lib/merchantAttendanceSession";

// Entirely synthetic local component QA. No application credentials or real API.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", workerId = id(2), employeeId = id(1), locationId = id(3);
let state = initialAttendanceState(siteId, workerId);
let last: AttendanceEvent | null = null;
const events = new Map<string, AttendanceEvent>();
let scenario = "normal"; let posts = 0; let gets = 0; let release: (() => void) | null = null; let moduleEnabled = true;
const listeners = new Set<() => void>(); let revision = 0;
const notify = () => { revision++; for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const result = (receipt: AttendanceEvent | null = null, replayed = false): AttendanceSelfResult => ({
  workerId, locationId, state: { sequence: state.sequence, status: state.status, lastEvent: last }, receipt, replayed,
});
async function apiFetch(path: string, init: RequestInit = {}) {
  const url = new URL(path, "http://127.0.0.1:3131");
  if(url.pathname==="/api/merchant-enterprise/attendance/session"){
    if(init.method&&init.method!=="GET")throw Error("synthetic_read_only");
    gets++;notify();
    if(scenario==="offline")throw Error("synthetic_offline");
    if(scenario==="denied")return Response.json({ok:false,error:"attendance_access_denied"},{status:403});
    const q=parseAttendanceSessionQuery(url.href);if(q.siteId!==siteId)throw Error("synthetic_site_only");
    const all=[...events.values()].sort((a,b)=>a.sequence-b.sequence),start=all.findIndex(e=>e.id===q.startEventId&&e.action==="clock_in");
    if(start<0)return Response.json({ok:false,error:"attendance_session_not_found"},{status:404});
    const rest=all.slice(start),end=rest.findIndex(e=>e.action==="clock_out"),segment=end<0?rest:rest.slice(0,end+1);
    if(segment.length>2002)return Response.json({ok:false,error:"attendance_session_too_large"},{status:422});
    return Response.json({ok:true,moduleEnabled,siteId,employeeId,workerId,asOf:attendanceRecordInstant(new Date().toISOString()),
      events:segment.map(e=>({...e,source:"web",occurredAt:attendanceRecordInstant(e.occurredAt)}))});
  }
  if (url.pathname === "/api/merchant-enterprise/attendance/history") {
    if (init.method && init.method !== "GET") throw Error("synthetic_read_only");
    gets++; notify();
    if (scenario === "offline") throw Error("synthetic_offline");
    if (scenario === "denied") return Response.json({ok:false,error:"attendance_access_denied"},{status:403});
    const q=parseAttendanceHistoryQuery(url.href),asOf=q.asOf??attendanceRecordInstant(new Date().toISOString());
    if(q.expectedWorkerId&&q.expectedWorkerId!==workerId)return Response.json({ok:false,error:"attendance_worker_changed"},{status:409});
    const all=[...events.values()].map(e=>({...e,occurredAt:attendanceRecordInstant(e.occurredAt),workerName:"测试员工",workerNo:"TEST-1",locationName:"合成门店",source:"web"}))
      .filter(e=>e.occurredAt>=q.fromAt&&e.occurredAt<q.toAt&&e.occurredAt<asOf&&(!q.cursorAt||e.occurredAt<q.cursorAt||(e.occurredAt===q.cursorAt&&e.id<q.cursorId!)))
      .sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt)||b.id.localeCompare(a.id));
    const items=all.slice(0,50),tail=items.at(-1);
    return Response.json({ok:true,moduleEnabled,siteId,employeeId,workerId,asOf,items,
      nextCursor:all.length>50&&tail?{id:tail.id,occurredAt:tail.occurredAt}:null});
  }
  if (url.pathname !== "/api/merchant-enterprise/attendance/self") throw Error("synthetic_route_only");
  if (init.method !== "POST") {
    gets++; notify();
    if (scenario === "offline") throw Error("synthetic_offline");
    return Response.json({ ok: true, moduleEnabled, ...result(events.get(url.searchParams.get("operationId") || "") ?? null) });
  }
  posts++; notify();
  if (scenario === "offline") throw Error("synthetic_offline");
  if (scenario === "denied") return Response.json({ ok: false, error: "attendance_access_denied" }, { status: 403 });
  if (scenario === "hold") await new Promise<void>((resolve) => { release = resolve; notify(); });
  const { command } = parseAttendanceSelfCommand(JSON.parse(init.body as string));
  if (!attendanceActionAllowed(moduleEnabled, command.action)) return Response.json({ ok: false, error: "attendance_platform_paused" }, { status: 403 });
  if (command.expectedWorkerId !== workerId) return Response.json({ ok: false, error: "attendance_worker_changed" }, { status: 409 });
  const saved = events.get(command.operationId);
  if (saved) return Response.json({ ok: true, moduleEnabled, ...result(saved, true) });
  if (command.expectedSequence !== state.sequence) return Response.json({ ok: false, error: "attendance_sequence_conflict" }, { status: 409 });
  const event: AttendanceEvent = { id: crypto.randomUUID(), siteId, workerId, locationId, operationId: command.operationId,
    sequence: state.sequence + 1, action: command.action, occurredAt: new Date().toISOString(), timeZone: "Europe/Madrid",
    breakPaid: command.action === "break_start" ? false : null };
  state = applyAttendanceEvent(state, event).state; last = event; events.set(command.operationId, event); notify();
  if (scenario === "lost") throw Error("synthetic_response_lost_after_commit");
  return Response.json({ ok: true, moduleEnabled, ...result(event) });
}
function Fixture() {
  useSyncExternalStore(subscribe, () => revision);
  const [mount, setMount] = useState(0); const [readonly, setReadonly] = useState(false);
  return <>
    <div className="qa-toolbar">
      <strong>隔离合成数据测试 · 真实考勤组件 · 禁止生产连接</strong>
      <div className="qa-controls">
        <label>模拟网络情况 <select aria-label="模拟网络情况" value={scenario} onChange={(event) => { scenario = event.target.value; notify(); }}>
          <option value="normal">正常</option><option value="offline">断网</option><option value="lost">已记录但响应丢失</option><option value="hold">等待提交</option><option value="denied">权限拒绝</option>
        </select></label>
        <button type="button" onClick={() => setMount((value) => value + 1)}>重新挂载页面</button>
        <button type="button" onClick={() => setReadonly((value) => !value)}>切换仅查看权限</button>
        <label><input type="checkbox" checked={moduleEnabled} onChange={e=>{moduleEnabled=e.target.checked;notify();}} />平台考勤开关（合成）</label>
        <button type="button" disabled={!release} onClick={() => { const complete = release; release = null; complete?.(); notify(); }}>释放等待中的提交</button>
      </div>
      <p data-testid="metrics">GET {gets} · POST {posts} · 已记录 {events.size} · 仅查看 {String(readonly)}</p>
    </div>
    <main className="qa-main"><MerchantAttendanceSelfPanel key={`${mount}:${readonly}`} siteId={siteId} siteName="演示企业 · 马德里门店"
      employeeId={employeeId} employeeName="测试员工" canClock={!readonly} apiFetch={apiFetch} /></main>
  </>;
}
createRoot(document.getElementById("qa-root")!).render(<StrictMode><Fixture /></StrictMode>);
