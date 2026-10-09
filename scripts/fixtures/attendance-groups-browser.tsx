import { createRoot } from "react-dom/client";
import { useState } from "react";
import GroupsLauncher from "../../src/components/enterprise/MerchantAttendanceGroupsLauncher";
import { attendanceSelfSite, attendanceSelfUuid } from "../../src/lib/merchantAttendanceSelf";

const params = new URL(window.location.href).searchParams;
const siteId = attendanceSelfSite(params.get("siteId"));
const ownerId = attendanceSelfUuid(params.get("ownerId"));
const apiFetch = (path: string, init?: RequestInit) => {
  const url = new URL(path, window.location.origin), method = init?.method ?? "GET";
  if (url.origin !== window.location.origin
    || !["/api/merchant-enterprise/attendance/groups", "/api/merchant-enterprise/attendance/admin"].includes(url.pathname)
    || !["GET", "POST"].includes(method)
    || url.pathname.endsWith("/admin") && method !== "GET") throw Error("synthetic_groups_route_required");
  return fetch(path, { ...init, credentials: "same-origin" });
};

function Demo() {
  const [mounted, setMounted] = useState(true), [active, setActive] = useState(true);
  return <>
    <header className="qa-toolbar">考勤组与人员归组隔离验收 · 真实组件／SQL，合成认证；仅允许本机分组及人员读取端点。
      <div className="qa-controls">
        <button type="button" onClick={() => setActive(value => !value)}>{active ? "隐藏归组入口" : "显示归组入口"}</button>
        <button type="button" onClick={() => setMounted(value => !value)}>{mounted ? "卸载测试归组页" : "重挂测试归组页"}</button>
      </div>
    </header>
    <main className="qa-main">{mounted && <GroupsLauncher enabled active={active} siteId={siteId} ownerId={ownerId} apiFetch={apiFetch}/>}</main>
  </>;
}

createRoot(document.getElementById("qa-root")!).render(<Demo/>);
// Actual groups launcher/client plus default handlers/SDK and owned synthetic SQL.
// No production, real Auth service, Next server, phone, screenshots or recordings.
