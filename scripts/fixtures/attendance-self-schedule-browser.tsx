// Actual160 parent UI. Only synthetic identity/display and explicit lifecycle
// controls live here; every attendance response comes from real local SQL.
import { useCallback } from "react";
import { createRoot } from "react-dom/client";
import SelfPanel from "../../src/components/enterprise/MerchantAttendanceSelfPanel";

declare global {
  interface Window {
    __selfScheduleSeed: { siteId: string; employeeId: string };
  }
}
function Harness() {
  const seed = window.__selfScheduleSeed;
  const apiFetch = useCallback((url: string, init?: RequestInit) => fetch(url, { ...init, credentials: "omit" }), []);
  return <>
    <header className="qa-toolbar">普通网页选班隔离验收 · 实际父组件／处理器／SQL · 合成认证 · 非生产</header>
    <main className="qa-main"><SelfPanel siteId={seed.siteId} employeeId={seed.employeeId} employeeName="合成选班员工"
      siteName="合成验收企业" canClock apiFetch={apiFetch} locationWorkspaceEnabled={false} exceptionWorkspaceEnabled={false} correctionWorkspaceEnabled={false}/></main>
  </>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness/>);
