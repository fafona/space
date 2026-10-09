import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import MerchantAttendanceLocationClockPanel from "../../src/components/enterprise/MerchantAttendanceLocationClockPanel";
import { applyAttendanceEvent, initialAttendanceState, type AttendanceEvent } from "../../src/lib/merchantAttendance";
import { parseAttendanceLocationClockCommand, parseAttendanceLocationClockQuery } from "../../src/lib/merchantAttendanceLocationClock";
import { evaluateAttendanceLocation } from "../../src/lib/merchantAttendanceLocation";
import type { AttendanceLocationEnvironment } from "../../src/lib/merchantAttendanceLocationCheckClient";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", employeeId = id(1), workerId = id(2), locationId = id(3);
let state = initialAttendanceState(siteId, workerId), last: AttendanceEvent | null = null;
const records = new Map<string, { event: AttendanceEvent; summary: Record<string, unknown>; gate: Record<string, unknown> }>();
let scenario = "normal", moduleEnabled = true, canClock = true, deviceCalls = 0, gets = 0, posts = 0, release: (() => void) | null = null;
const fence = { latitude: 37.3, longitude: -5.9, radiusMeters: 100, maxAgeMs: 60000 };
const policy = { settingsVersion: 1, workerVersion: 1, locationVersion: 1, mode: "record_and_review", maxAgeMs: 60000, algorithmVersion: 1 };
// Synthetic only: the fixture never invokes navigator.geolocation, fetch or DB.
const geo: Pick<Geolocation, "getCurrentPosition"> = { getCurrentPosition(success, error) {
  deviceCalls++;
  const reply = () => scenario === "denied" ? error?.({ code: 1 } as GeolocationPositionError) : success({ timestamp: Date.now(),
    coords: { latitude: scenario === "outside" ? 38 : fence.latitude, longitude: fence.longitude, accuracy: scenario === "uncertain" ? 150 : 10 } } as GeolocationPosition);
  if (scenario === "hold") release = reply; else queueMicrotask(reply);
} };
const environment: AttendanceLocationEnvironment = { isSecureContext: () => true, isVisible: () => document.visibilityState === "visible", geolocation: () => geo };
const response = (operation: string | null, replayed = false) => {
  const row = records.get(operation ?? "");
  return { ok: true, siteId, employeeId, workerId, locationId, state: { sequence: state.sequence, status: state.status, lastEvent: last },
    noticeGate: { ready: true, reason: "ready", revision: 1 }, receiptGate: row?.gate ?? null,
    finish: canClock && last && last.action !== "clock_out" ? { locationId, settingsVersion: 1, workerVersion: 1, locationVersion: 1 } : null,
    receipt: row?.event ?? null, locationResult: row?.summary ?? null, channelEnabled: canClock, moduleEnabled, replayed, policy };
};
async function apiFetch(path: string, init: RequestInit = {}) {
  const url = new URL(path, "http://127.0.0.1:3131");
  if (url.pathname !== "/api/merchant-enterprise/attendance/location-clock") throw Error("synthetic_route_only");
  if (init.method !== "POST") {
    gets++; const q = parseAttendanceLocationClockQuery(url.href);
    if (q.siteId !== siteId || q.expectedWorkerId !== workerId) throw Error("synthetic_target_only");
    if (scenario === "offline") throw Error("synthetic_offline");
    return Response.json(response(q.operationId));
  }
  posts++; if (scenario === "offline") throw Error("synthetic_offline");
  if (!canClock) return Response.json({ ok: false, error: "attendance_access_denied" }, { status: 403 });
  const { command } = parseAttendanceLocationClockCommand(JSON.parse(String(init.body)));
  const prior = records.get(command.operationId);
  if (prior) return prior.event.action === command.action && prior.event.locationId === command.locationId
    ? Response.json(response(command.operationId, true)) : Response.json({ ok: false, error: "attendance_operation_conflict" }, { status: 409 });
  if (!moduleEnabled && ["clock_in", "break_start"].includes(command.action)) return Response.json({ ok: false, error: "attendance_platform_paused" }, { status: 403 });
  if (scenario === "changed") return Response.json({ ok: false, error: "attendance_location_policy_changed" }, { status: 409 });
  if (command.expectedSequence !== state.sequence) return Response.json({ ok: false, error: "attendance_sequence_conflict" }, { status: 409 });
  const now = new Date().toISOString(), range = evaluateAttendanceLocation(fence, command.position, now);
  const spatial = evaluateAttendanceLocation(fence, command.position, command.position?.capturedAt ?? now);
  const event: AttendanceEvent = { id: crypto.randomUUID(), siteId, workerId, locationId, sequence: state.sequence + 1, operationId: command.operationId,
    action: command.action, breakPaid: command.action === "break_start" ? false : null, occurredAt: now, timeZone: "Europe/Madrid" };
  state = applyAttendanceEvent(state, event).state; last = event;
  const sqlCommand = Object.fromEntries(Object.entries(command).filter(([key]) => !["expectedWorkerId", "position", "positionFailure"].includes(key)));
  records.set(command.operationId, { event, gate: { safeFinish: command.safeFinish, noticeRevision: command.noticeRevision, command: sqlCommand }, summary: { eventId: event.id, settingsVersion: 1, workerVersion: 1, locationVersion: 1, algorithmVersion: 1,
    reason: command.position ? range.reason : command.positionFailure, needsReview: !command.position || range.needsReview,
    capturedAt: command.position?.capturedAt ?? null, accuracyMeters: command.position?.accuracyMeters ?? null,
    distanceMeters: spatial.distanceMeters === null ? null : Math.round(spatial.distanceMeters) } });
  if (scenario === "lost") throw Error("synthetic_response_lost_after_commit");
  return Response.json(response(command.operationId));
}
function Fixture() {
  const [selected, setSelected] = useState("normal"), [mount, setMount] = useState(0), [enabled, setEnabled] = useState(true), [clock, setClock] = useState(true), [metrics, setMetrics] = useState("");
  return <><div className="qa-toolbar"><strong>定位打卡隔离原型 · 全部合成坐标与记录 · 不调用真实定位／生产接口</strong>
    <div className="qa-controls"><label>场景 <select value={selected} onChange={event => { scenario = event.target.value; setSelected(scenario); }}>
      {[["normal", "正常"], ["outside", "范围外待核查"], ["uncertain", "精度不足"], ["denied", "权限拒绝"], ["hold", "迟到位置"], ["lost", "已记但响应丢失"], ["changed", "提交期间规则变化"], ["offline", "断网"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label><button type="button" onClick={() => { const done = release; release = null; done?.(); }}>释放迟到位置</button>
      <button type="button" onClick={() => setMount(mount + 1)}>重新挂载／恢复原编号</button>
      <label><input type="checkbox" checked={enabled} onChange={e => { moduleEnabled = e.target.checked; setEnabled(moduleEnabled); }} />允许新班次</label>
      <label><input type="checkbox" checked={clock} onChange={e => { canClock = e.target.checked; setClock(canClock); }} />本人打卡权限</label>
      <button type="button" onClick={() => setMetrics(`GET ${gets} · 模拟定位 ${deviceCalls} · POST ${posts} · 合成记录 ${records.size}`)}>读取计数</button></div><p>{metrics}</p></div>
    <main className="qa-main"><MerchantAttendanceLocationClockPanel key={`${mount}:${clock}`} siteId={siteId} employeeId={employeeId} workerId={workerId} canClock={clock} apiFetch={apiFetch} environment={environment} /></main></>;
}
createRoot(document.getElementById("qa-root")!).render(<StrictMode><Fixture /></StrictMode>);
