import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import MerchantAttendanceLocationCheckPanel from "../../src/components/enterprise/MerchantAttendanceLocationCheckPanel";
import { parseAttendanceLocationCommand, parseAttendanceLocationQuery } from "../../src/lib/merchantAttendanceLocationCheck";
import { evaluateAttendanceLocation } from "../../src/lib/merchantAttendanceLocation";
import type { AttendanceLocationEnvironment } from "../../src/lib/merchantAttendanceLocationCheckClient";

// No real device API, credentials, DB, fetch or application endpoint. Even when
// opened in a browser, this fixture cannot request a real person's location.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const target = { siteId: "99990001", expectedWorkerId: id(2), expectedLocationId: id(3) };
const fence = { latitude: 37.3, longitude: -5.9, radiusMeters: 100, maxAgeMs: 60000 };
let scenario = "inside", deviceCalls = 0, gets = 0, posts = 0;
let latePosition: (() => void) | null = null;
const geo: Pick<Geolocation, "getCurrentPosition"> = {
  getCurrentPosition(success, error) {
    deviceCalls++;
    const reply = () => {
      if (scenario === "denied") { error?.({ code: 1 } as GeolocationPositionError); return; }
      success({ timestamp: Date.now() + (scenario === "stale" ? -61000 : scenario === "future" ? 60000 : 0),
        coords: { latitude: scenario === "outside" ? 38 : fence.latitude, longitude: fence.longitude, accuracy: scenario === "uncertain" ? 150 : 10 } } as GeolocationPosition);
    };
    if (scenario === "hold") latePosition = reply; else queueMicrotask(reply);
  },
};
const environment: AttendanceLocationEnvironment = { isSecureContext: () => true, isVisible: () => document.visibilityState === "visible", geolocation: () => geo };
async function apiFetch(path: string, init: RequestInit = {}) {
  const url = new URL(path, "http://127.0.0.1:3131");
  if (url.pathname !== "/api/merchant-enterprise/attendance/location-check") throw Error("synthetic_route_only");
  const post = init.method === "POST";
  if (post) posts++; else gets++;
  if (scenario === "offline") throw Error("synthetic_offline");
  if (scenario === "closed") return Response.json({ ok: false, error: "attendance_location_check_disabled" }, { status: 403 });
  if (post && scenario === "changed") return Response.json({ ok: false, error: "attendance_location_policy_changed" }, { status: 409 });
  const policy = { ...target, siteId: target.siteId, workerId: id(2), locationId: id(3), employeeId: id(1), settingsVersion: 1, workerVersion: 1, locationVersion: 1,
    maxAgeMs: 60000, checkedAt: new Date().toISOString(), diagnosticOnly: true, punchRecorded: false };
  if (!post) { parseAttendanceLocationQuery(url.href); return Response.json({ ok: true, moduleEnabled: true, ...policy }); }
  const command = parseAttendanceLocationCommand(JSON.parse(String(init.body)));
  const result = evaluateAttendanceLocation(fence, command.position, policy.checkedAt);
  return Response.json({ ok: true, moduleEnabled: true, ...policy, ...result, distanceMeters: result.distanceMeters === null ? null : Math.round(result.distanceMeters) });
}
function Fixture() {
  const [selected, setSelected] = useState("inside"), [mount, setMount] = useState(0), [metrics, setMetrics] = useState("");
  return <><div className="qa-toolbar"><strong>定位通路隔离原型 · 合成坐标 · 不调用真实定位／生产接口 · 不产生打卡</strong>
    <div className="qa-controls"><label>场景 <select value={selected} onChange={event => { scenario = event.target.value; setSelected(scenario); setMount(mount + 1); }}>
      {[["inside", "范围内"], ["outside", "范围外"], ["uncertain", "精度不足"], ["denied", "拒绝权限"], ["hold", "等待／超时"], ["stale", "过期位置"], ["future", "设备时间超前"], ["closed", "服务端关闭"], ["changed", "检查中规则变更"], ["offline", "断网"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label><button type="button" onClick={() => { const release = latePosition; latePosition = null; release?.(); }}>释放迟到位置</button>
      <button type="button" onClick={() => setMount(mount + 1)}>重新挂载</button>
      <button type="button" onClick={() => setMetrics(`准备 GET ${gets} · 模拟定位 ${deviceCalls} · 检查 POST ${posts} · 打卡 0`)}>查看调用计数</button></div><p>{metrics}</p></div>
    <main className="qa-main"><MerchantAttendanceLocationCheckPanel key={mount} {...target} employeeId={id(1)} apiFetch={apiFetch} environment={environment} /></main></>;
}
createRoot(document.getElementById("qa-root")!).render(<StrictMode><Fixture /></StrictMode>);
