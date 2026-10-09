import { createRoot } from "react-dom/client";
import { useState } from "react";
import CalendarLauncher from "../../src/components/enterprise/MerchantAttendanceCalendarLauncher";
import { attendanceSelfSite, attendanceSelfUuid } from "../../src/lib/merchantAttendanceSelf";

const params = new URL(window.location.href).searchParams;
const siteId = attendanceSelfSite(params.get("siteId"));
const ownerId = attendanceSelfUuid(params.get("ownerId"));
const apiFetch = (path: string, init?: RequestInit) => {
  const url = new URL(path, window.location.origin), method = init?.method ?? "GET";
  if (url.origin !== window.location.origin
    || !["/api/merchant-enterprise/attendance/calendar", "/api/merchant-enterprise/attendance/admin"].includes(url.pathname)
    || !["GET", "POST"].includes(method)
    || url.pathname.endsWith("/admin") && method !== "GET") throw Error("synthetic_calendar_route_required");
  return fetch(path, { ...init, credentials: "same-origin" });
};

function Demo() {
  const [mounted, setMounted] = useState(true), [active, setActive] = useState(true);
  return <>
    <header className="qa-toolbar">节假日／停业日隔离验收 · 真实组件／SQL，合成认证；仅允许本机日历及地点读取端点。
      <div className="qa-controls">
        <button type="button" onClick={() => setActive(value => !value)}>{active ? "隐藏日历入口" : "显示日历入口"}</button>
        <button type="button" onClick={() => setMounted(value => !value)}>{mounted ? "卸载测试日历页" : "重挂测试日历页"}</button>
      </div>
    </header>
    <main className="qa-main">{mounted && <CalendarLauncher enabled active={active} siteId={siteId} ownerId={ownerId} apiFetch={apiFetch}/>}</main>
  </>;
}

createRoot(document.getElementById("qa-root")!).render(<Demo/>);
// Actual calendar launcher/client plus default handlers/SDK and owned synthetic SQL.
// No production, real Auth service, Next server, phone, screenshots or recordings.
