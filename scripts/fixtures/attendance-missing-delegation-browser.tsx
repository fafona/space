//189 Actual parent entry points; parent initialization/auth are explicitly
//synthetic. The new delegation endpoint is bridged to caller-owned real SQL.
import { useCallback, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import SelfPanel from "../../src/components/enterprise/MerchantAttendanceSelfPanel";
import AdminPanel from "../../src/components/enterprise/MerchantAttendanceAdminPanel";
declare global { interface Window { __missingDelegationSeed: { site: string; owner: string; employee: string } } }
function Harness() {
  const seed = window.__missingDelegationSeed, [access, setAccess] = useState<"owner" | "delegate">("delegate"), [enabled, setEnabled] = useState(false);
  const guard = useRef<(() => boolean) | null>(null), register = useCallback((value: (() => boolean) | null) => { guard.current = value; }, []);
  const apiFetch = useMemo(() => async (url: string, init?: RequestInit) => { const headers = new Headers(init?.headers); headers.set("x-qa-access", access);
    return fetch(url, { ...init, headers, credentials: "omit" }); }, [access]);
  const change = (next: typeof access) => { if (!guard.current || guard.current()) setAccess(next); };
  return <><header className="qa-toolbar"><strong>漏卡委托隔离验收：真实父组件；父初始化及认证合成；新接口真实 SQL</strong><div className="qa-controls">
    <button data-testid="owner" onClick={() => change("owner")}>负责人</button><button data-testid="delegate" onClick={() => change("delegate")}>受托员工</button>
    <button data-testid="feature-on" onClick={() => setEnabled(true)}>启用新入口</button><button data-testid="feature-off" onClick={() => setEnabled(false)}>关闭新入口</button>
  </div></header><main className="qa-main" data-qa-access={access} data-qa-enabled={String(enabled)}>{access === "delegate"
    ? <SelfPanel key="delegate" siteId={seed.site} employeeId={seed.employee} employeeName="合成受托审批员工" siteName="隔离测试企业" canClock={false} apiFetch={apiFetch}
        registerLeaveGuard={register} missingDelegationEnabled={enabled} workArrangementsEnabled={false} selfScheduleEnabled={false} selfScheduleAdoptionEnabled={false}
        locationWorkspaceEnabled={false} exceptionWorkspaceEnabled={false} planExceptionsEnabled={false} correctionWorkspaceEnabled={false}/>
    : <AdminPanel key="owner" siteId={seed.site} ownerId={seed.owner} siteName="隔离测试企业" apiFetch={apiFetch} registerLeaveGuard={register}
        missingDelegationEnabled={enabled} workArrangementsEnabled={false} locationWorkspaceEnabled={false} exceptionWorkspaceEnabled={false} planExceptionsEnabled={false}
        correctionReviewEnabled={false} correctionControlsEnabled={false} timesheetEnabled={false} revisionApprovalEnabled={false}/>}</main></>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness/>);
