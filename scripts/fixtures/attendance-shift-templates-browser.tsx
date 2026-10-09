import { createRoot } from "react-dom/client";
import { useState } from "react";
import SchedulePanel from "../../src/components/enterprise/MerchantAttendanceSchedulePanel";
import { attendanceSelfSite, attendanceSelfUuid } from "../../src/lib/merchantAttendanceSelf";
const params = new URL(window.location.href).searchParams;
const siteId = attendanceSelfSite(params.get("siteId")), ownerId = attendanceSelfUuid(params.get("ownerId"));
const apiFetch = (path: string, init?: RequestInit) => {
  const url = new URL(path, window.location.origin), method = init?.method ?? "GET";
  if (url.origin !== window.location.origin || !["GET", "POST"].includes(method)
    || !["/api/merchant-enterprise/attendance/admin", "/api/merchant-enterprise/attendance/schedule", "/api/merchant-enterprise/attendance/shift-templates"].includes(url.pathname)
    || url.pathname.endsWith("/admin") && method !== "GET") throw Error("synthetic_template_route_required");
  return fetch(path, { ...init, credentials: "same-origin" });
};
function Demo() {
  const [mounted, setMounted] = useState(true);
  return <><header className="qa-toolbar">班次模板隔离验收 · 真实排班组件和SQL，合成认证，禁止生产连接。
    <div className="qa-controls"><button onClick={() => setMounted(v => !v)}>{mounted ? "卸载测试排班" : "重挂测试排班"}</button></div>
  </header><main className="qa-main">{mounted && <SchedulePanel siteId={siteId} actorId={ownerId} access="owner" apiFetch={apiFetch} onClose={() => setMounted(false)}/>}</main></>;
}
createRoot(document.getElementById("qa-root")!).render(<Demo/>);
