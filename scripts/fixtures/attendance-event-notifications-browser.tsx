//200 Actual self attendance parent. The authenticated subject is synthetic;
//the runner maps allowed local requests to actual handlers and owned SQL.
import { useCallback, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import SelfPanel from "../../src/components/enterprise/MerchantAttendanceSelfPanel";

declare global { interface Window { __eventNotificationsSeed: { site: string; employee: string } } }
function Harness() {
  const seed = window.__eventNotificationsSeed, [enabled, setEnabled] = useState(false), [mounted, setMounted] = useState(true);
  const guard = useRef<(() => boolean) | null>(null), register = useCallback((value: (() => boolean) | null) => { guard.current = value; }, []);
  const apiFetch = useMemo(() => async (url: string, init?: RequestInit) => fetch(url, { ...init, credentials: "omit" }), []);
  return <><header className="qa-toolbar"><strong>考勤消息隔离验收：真实员工父组件和接口／SQL；合成已验证身份，不是真实登录</strong><div className="qa-controls">
    <button data-testid="feature-on" onClick={() => setEnabled(true)}>启用考勤消息入口</button>
    <button data-testid="feature-off" onClick={() => setEnabled(false)}>关闭考勤消息入口</button>
    <button data-testid="leave-parent" onClick={() => { if (!guard.current || guard.current()) setMounted(false); }}>离开员工父页</button>
  </div></header><main className="qa-main" data-qa-enabled={String(enabled)}>{mounted ? <SelfPanel siteId={seed.site} employeeId={seed.employee} employeeName="合成本人" siteName="隔离验收企业" canClock={false} apiFetch={apiFetch}
    registerLeaveGuard={register} eventNotificationsEnabled={enabled} scheduleDelegationEnabled={false} applicationDelegationEnabled={false} missingDelegationEnabled={false} workArrangementsEnabled={false}
    selfScheduleEnabled={false} selfScheduleAdoptionEnabled={false} locationWorkspaceEnabled={false} exceptionWorkspaceEnabled={false} planExceptionsEnabled={false} correctionWorkspaceEnabled={false}/>
    : <p data-testid="left-parent">已明确离开员工父页</p>}</main></>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness/>);
