import { createRoot } from "react-dom/client";
import MerchantAttendanceAdminPanel from "../../src/components/enterprise/MerchantAttendanceAdminPanel";
import MerchantAttendanceSelfPanel from "../../src/components/enterprise/MerchantAttendanceSelfPanel";
import { attendanceSelfSite, attendanceSelfUuid } from "../../src/lib/merchantAttendanceSelf";

const params = new URL(window.location.href).searchParams;
const siteId = attendanceSelfSite(params.get("siteId"));
const access = params.get("access") === "owner" ? "owner" : "self";
const identityId = attendanceSelfUuid(params.get(access === "owner" ? "actorId" : "employeeId"));
const allowed = access === "owner"
  ? new Set(["/api/merchant-enterprise/attendance/admin", "/api/merchant-enterprise/attendance/leave"])
  : new Set(["/api/merchant-enterprise/attendance/self", "/api/merchant-enterprise/attendance/leave", "/api/merchant-enterprise/attendance/leave-notifications"]);

// Actual parent panels and their production clients. Network is restricted to
// the local synthetic handlers used by the diagnostic runner.
const apiFetch = async (input: string, init?: RequestInit) => {
  const url = new URL(input, window.location.origin);
  if (url.origin !== window.location.origin || !allowed.has(url.pathname) || (init?.method ?? "GET") !== "GET" || init?.body) {
    throw Error("synthetic_leave_parent_boundary_route_required");
  }
  return fetch(input, { ...init, credentials: "same-origin" });
};

function Demo() {
  return <>
    <header className="qa-toolbar">
      请假父壳授权清屏诊断 · 实际考勤配置／我的考勤父组件、真实处理器与隔离 SQL；只撤销和恢复合成身份，不提交页面写操作。
    </header>
    <main className="qa-main">
      {access === "owner"
        ? <MerchantAttendanceAdminPanel siteId={siteId} ownerId={identityId} siteName="合成父壳诊断企业" apiFetch={apiFetch}/>
        : <MerchantAttendanceSelfPanel siteId={siteId} employeeId={identityId} employeeName="合成请假员工甲"
            siteName="合成父壳诊断企业" canClock={false} apiFetch={apiFetch}/>
      }
    </main>
  </>;
}

createRoot(document.getElementById("qa-root")!).render(<Demo/>);
