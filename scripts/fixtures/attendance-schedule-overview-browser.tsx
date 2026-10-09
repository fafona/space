import { createRoot } from "react-dom/client";
import { useState } from "react";
import AdminPanel from "../../src/components/enterprise/MerchantAttendanceAdminPanel";
import { attendanceSelfSite, attendanceSelfUuid } from "../../src/lib/merchantAttendanceSelf";
const params = new URL(window.location.href).searchParams;
const siteId = attendanceSelfSite(params.get("siteId")), ownerId = attendanceSelfUuid(params.get("ownerId"));
const apiFetch = (path: string, init?: RequestInit) => {
  const url = new URL(path, location.origin);
  if (url.origin !== location.origin || (init?.method ?? "GET") !== "GET"
    || !["/api/merchant-enterprise/attendance/admin", "/api/merchant-enterprise/attendance/schedule-overview"].includes(url.pathname)) throw Error("synthetic_schedule_read_only");
  return fetch(path, { ...init, credentials: "same-origin" });
};
function Demo() {
  const [mounted, setMounted] = useState(true);
  return <><header className="qa-toolbar">多人排班隔离验收 · 真实组件／SQL，合成认证；仅允许本机只读查询。
    <div className="qa-controls"><button onClick={() => setMounted(v => !v)}>{mounted ? "卸载测试管理页" : "重挂测试管理页"}</button></div></header>
    <main className="qa-main">{mounted && <AdminPanel siteId={siteId} ownerId={ownerId} apiFetch={apiFetch}/>}</main></>;
}
createRoot(document.getElementById("qa-root")!).render(<Demo/>);
