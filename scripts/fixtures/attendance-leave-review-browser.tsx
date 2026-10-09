import { createRoot } from "react-dom/client";
import { useState } from "react";
import LeaveLauncher from "../../src/components/enterprise/MerchantAttendanceLeaveLauncher";
import LeavePanel from "../../src/components/enterprise/MerchantAttendanceLeavePanel";
import { attendanceSelfSite, attendanceSelfUuid } from "../../src/lib/merchantAttendanceSelf";

const params = new URL(window.location.href).searchParams;
const siteId = attendanceSelfSite(params.get("siteId"));
const access = params.get("access") === "self" ? "self" : "owner";
const forceReviewOff = access === "owner" && params.get("reviewOff") === "1";
const identityId = attendanceSelfUuid(params.get(access === "self" ? "employeeId" : "actorId"));
const allowed = new Set(access === "owner"
  ? ["/api/merchant-enterprise/attendance/leave", "/api/merchant-enterprise/attendance/leave-review"]
  : ["/api/merchant-enterprise/attendance/leave"]);
const apiFetch = (input: string, init?: RequestInit) => {
  const url = new URL(input, window.location.origin), method = init?.method ?? "GET";
  if (url.origin !== window.location.origin || !allowed.has(url.pathname) || !["GET", "POST"].includes(method)) {
    throw Error("synthetic_leave_review_route_required");
  }
  return fetch(input, { ...init, credentials: "same-origin" });
};

function Demo() {
  const [mounted, setMounted] = useState(true), [active, setActive] = useState(true), [directOpen, setDirectOpen] = useState(false);
  const launcher = forceReviewOff
    ? active && (directOpen
      ? <LeavePanel siteId={siteId} access="owner" actorId={identityId} apiFetch={apiFetch} reviewEnabled={false} onClose={() => setDirectOpen(false)}/>
      : <button type="button" onClick={() => setDirectOpen(true)}>请假申请审批</button>)
    : access === "owner"
      ? <LeaveLauncher enabled active={active} siteId={siteId} access="owner" actorId={identityId} apiFetch={apiFetch}/>
      : <LeaveLauncher enabled active={active} siteId={siteId} access="self" employeeId={identityId} apiFetch={apiFetch}/>;
  return <>
    <header className="qa-toolbar">负责人请假待审隔离验收 · 真实单工作区／默认处理接口／合成认证；仅允许本机请假端点。
      <div className="qa-controls">
        <button type="button" onClick={() => setActive(value => !value)}>{active ? "隐藏请假入口" : "显示请假入口"}</button>
        <button type="button" onClick={() => setMounted(value => !value)}>{mounted ? "卸载测试请假页" : "重挂测试请假页"}</button>
      </div>
    </header>
    <main className="qa-main">{mounted && launcher}</main>
  </>;
}

createRoot(document.getElementById("qa-root")!).render(<Demo/>);
