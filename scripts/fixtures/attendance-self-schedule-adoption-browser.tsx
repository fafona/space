// Actual171 parent. Identity is synthetic; every clock/selection/adoption
// response is handled by the real local route -> service -> owned SQL chain.
import { useCallback } from "react";
import { createRoot } from "react-dom/client";
import SelfPanel from "../../src/components/enterprise/MerchantAttendanceSelfPanel";

declare global {
  interface Window { __selfScheduleAdoptionSeed: { siteId: string; employeeId: string } }
}
function Harness() {
  const seed = window.__selfScheduleAdoptionSeed;
  const apiFetch = useCallback((url: string, init?: RequestInit) => fetch(url, { ...init, credentials: "omit" }), []);
  return <><header className="qa-toolbar">普通网页选班与核准引用 · 实际父组件／处理器／SQL · 合成认证 · 隔离非生产</header>
    <main className="qa-main"><SelfPanel siteId={seed.siteId} employeeId={seed.employeeId} employeeName="合成选班员工"
      siteName="合成验收企业" canClock apiFetch={apiFetch} locationWorkspaceEnabled={false} exceptionWorkspaceEnabled={false} correctionWorkspaceEnabled={false}/></main></>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness/>);
