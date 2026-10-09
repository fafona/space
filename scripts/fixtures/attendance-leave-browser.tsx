import { createRoot } from "react-dom/client";
import { useState } from "react";
import LeaveLauncher from "../../src/components/enterprise/MerchantAttendanceLeaveLauncher";
import { attendanceSelfSite, attendanceSelfUuid } from "../../src/lib/merchantAttendanceSelf";

const params = new URL(window.location.href).searchParams;
const siteId = attendanceSelfSite(params.get("siteId"));
const access = params.get("access") === "owner" ? "owner" : "self";
const identityId = attendanceSelfUuid(params.get(access === "self" ? "employeeId" : "actorId"));
const apiFetch = (path: string, init?: RequestInit) => {
  const url = new URL(path, window.location.origin), method = init?.method ?? "GET";
  if (url.origin !== window.location.origin || url.pathname !== "/api/merchant-enterprise/attendance/leave"
    || !["GET", "POST"].includes(method)) throw Error("synthetic_leave_route_required");
  return fetch(path, { ...init, credentials: "same-origin" });
};

function Demo() {
  const [mounted, setMounted] = useState(true), [active, setActive] = useState(true);
  const launcher = access === "self"
    ? <LeaveLauncher enabled active={active} siteId={siteId} access="self" employeeId={identityId} apiFetch={apiFetch}/>
    : <LeaveLauncher enabled active={active} siteId={siteId} access="owner" actorId={identityId} apiFetch={apiFetch}/>;
  return <>
    <header className="qa-toolbar">请假流程隔离验收 · 真实组件／SQL，合成认证；仅允许本机请假端点。
      <div className="qa-controls">
        <button type="button" onClick={() => setActive(value => !value)}>{active ? "隐藏请假入口" : "显示请假入口"}</button>
        <button type="button" onClick={() => setMounted(value => !value)}>{mounted ? "卸载测试请假页" : "重挂测试请假页"}</button>
      </div>
    </header>
    <main className="qa-main">{mounted && launcher}</main>
  </>;
}

createRoot(document.getElementById("qa-root")!).render(<Demo/>);
