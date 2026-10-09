//187 Actual SelfPanel/AdminPanel entry -> actual work-arrangement UI. Parent
//initialization is synthetic and read-only; work-arrangement requests use SQL.
import { useCallback, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import SelfPanel from "../../src/components/enterprise/MerchantAttendanceSelfPanel";
import AdminPanel from "../../src/components/enterprise/MerchantAttendanceAdminPanel";
declare global { interface Window { __workArrangementSeed: { site: string; owner: string; employee: string } } }
function Harness() {
  const seed = window.__workArrangementSeed, [access, setAccess] = useState<"owner" | "self">("self"), [enabled, setEnabled] = useState(false);
  const guard = useRef<(() => boolean) | null>(null), register = useCallback((value: (() => boolean) | null) => { guard.current = value; }, []);
  const apiFetch = useMemo(() => async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers); headers.set("x-qa-access", access);
    return fetch(url, { ...init, headers, credentials: "omit" });
  }, [access]);
  const change = (next: typeof access) => { if (!guard.current || guard.current()) setAccess(next); };
  return <><header className="qa-toolbar"><strong>工作安排隔离验收：真实父组件；父初始化及认证为合成，新申请接口为真实 SQL</strong><div className="qa-controls">
    <button data-testid="self" onClick={() => change("self")}>本人</button><button data-testid="owner" onClick={() => change("owner")}>负责人</button>
    <button data-testid="feature-on" onClick={() => setEnabled(true)}>启用新入口</button><button data-testid="feature-off" onClick={() => setEnabled(false)}>关闭新入口</button>
  </div></header><main className="qa-main" data-qa-access={access} data-qa-enabled={String(enabled)}>{access === "self"
    ? <SelfPanel key="self" siteId={seed.site} employeeId={seed.employee} employeeName="合成工作安排员工" siteName="隔离测试企业" canClock={false} apiFetch={apiFetch}
        registerLeaveGuard={register} workArrangementsEnabled={enabled} selfScheduleEnabled={false} selfScheduleAdoptionEnabled={false}
        locationWorkspaceEnabled={false} exceptionWorkspaceEnabled={false} planExceptionsEnabled={false} correctionWorkspaceEnabled={false}/>
    : <AdminPanel key="owner" siteId={seed.site} ownerId={seed.owner} siteName="隔离测试企业" apiFetch={apiFetch} registerLeaveGuard={register}
        workArrangementsEnabled={enabled} locationWorkspaceEnabled={false} exceptionWorkspaceEnabled={false} planExceptionsEnabled={false}
        correctionReviewEnabled={false} correctionControlsEnabled={false} timesheetEnabled={false} revisionApprovalEnabled={false}/>}</main></>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness/>);
