// Actual attendance parents; only authentication and build-time feature flags
// are synthetic. Allowed HTTP requests reach the root's real owned SQL ports.
import { useCallback, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import AdminPanel from "../../src/components/enterprise/MerchantAttendanceAdminPanel";
import SelfPanel from "../../src/components/enterprise/MerchantAttendanceSelfPanel";

declare global { interface Window {
  __planClearanceSeed: { site: string; owner: string; employee: string };
  __planClearanceFlag: string;
} }
function Harness() {
  const seed = window.__planClearanceSeed, [access, setAccess] = useState<"owner" | "self">("owner"), [flag, setFlag] = useState(false);
  const guard = useRef<(() => boolean) | null>(null), register = useCallback((value: (() => boolean) | null) => { guard.current = value; }, []);
  const apiFetch = useMemo(() => async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers); headers.set("x-plan-clearance-access", access);
    return fetch(url, { ...init, headers, credentials: "omit" });
  }, [access]);
  const changeAccess = (next: "owner" | "self") => { if (!guard.current || guard.current()) setAccess(next); };
  const changeFlag = (value: boolean) => { if (!guard.current || guard.current()) { window.__planClearanceFlag = value ? "1" : "0"; setFlag(value); } };
  const common = { siteId: seed.site, siteName: "隔离合成企业", apiFetch, registerLeaveGuard: register, planExceptionsEnabled: true,
    locationWorkspaceEnabled: false, exceptionWorkspaceEnabled: false, workArrangementsEnabled: false, missingDelegationEnabled: false,
    applicationDelegationEnabled: false, scheduleDelegationEnabled: false };
  return <><header className="qa-toolbar"><strong>结案隔离验收：真实负责人／员工父组件与服务 SQL；合成已验证身份，不是真实登录</strong><div className="qa-controls">
    <button data-testid="owner-parent" onClick={() => changeAccess("owner")}>负责人父页</button>
    <button data-testid="self-parent" onClick={() => changeAccess("self")}>本人父页</button>
    <button data-testid="clearance-on" onClick={() => changeFlag(true)}>启用本轮新结案入口</button>
    <button data-testid="clearance-off" onClick={() => changeFlag(false)}>关闭本轮新结案入口</button>
  </div></header><main className="qa-main" data-qa-clearance={String(flag)} data-qa-access={access}>
    {access === "owner" ? <AdminPanel {...common} ownerId={seed.owner} employmentLifecycleEnabled={false} correctionReviewEnabled={false} correctionControlsEnabled={false} timesheetEnabled={false} revisionApprovalEnabled={false}/>
      : <SelfPanel {...common} employeeId={seed.employee} employeeName="合成本人" canClock={false} eventNotificationsEnabled
        correctionWorkspaceEnabled={false} selfScheduleEnabled={false} selfScheduleAdoptionEnabled={false}/>}</main></>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness/>);
