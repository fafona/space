import { createRoot } from "react-dom/client";
import { useState } from "react";
import LeaveLauncher from "../../src/components/enterprise/MerchantAttendanceLeaveLauncher";
import LeaveNotificationsLauncher from "../../src/components/enterprise/MerchantAttendanceLeaveNotificationsLauncher";
import { attendanceSelfSite, attendanceSelfUuid } from "../../src/lib/merchantAttendanceSelf";

const params = new URL(window.location.href).searchParams;
const siteId = attendanceSelfSite(params.get("siteId"));
const access = params.get("access") === "owner" ? "owner" : "self";
const identityId = attendanceSelfUuid(params.get(access === "owner" ? "actorId" : "employeeId"));
const endpoint = access === "owner"
  ? "/api/merchant-enterprise/attendance/leave"
  : "/api/merchant-enterprise/attendance/leave-notifications";
const apiFetch = (input: string, init?: RequestInit) => {
  const url = new URL(input, window.location.origin), method = init?.method ?? "GET";
  if (url.origin !== window.location.origin || url.pathname !== endpoint || !["GET", "POST"].includes(method)) {
    throw Error("synthetic_leave_notifications_route_required");
  }
  return fetch(input, { ...init, credentials: "same-origin" });
};

function Demo() {
  const [mounted, setMounted] = useState(true), [active, setActive] = useState(true);
  const launcher = access === "owner"
    ? <LeaveLauncher enabled active={active} siteId={siteId} access="owner" actorId={identityId} apiFetch={apiFetch}/>
    : <LeaveNotificationsLauncher enabled active={active} siteId={siteId} employeeId={identityId} apiFetch={apiFetch}/>;
  const noun = access === "owner" ? "请假入口" : "结果通知入口";
  return <>
    <header className="qa-toolbar">请假结果通知隔离验收 · 真实组件／SQL，合成认证；仅允许本机请假端点。
      <div className="qa-controls">
        <button type="button" onClick={() => setActive(value => !value)}>{active ? `隐藏${noun}` : `显示${noun}`}</button>
        <button type="button" onClick={() => setMounted(value => !value)}>{mounted ? "卸载测试通知页" : "重挂测试通知页"}</button>
      </div>
    </header>
    <main className="qa-main">{mounted && launcher}</main>
  </>;
}

createRoot(document.getElementById("qa-root")!).render(<Demo/>);
