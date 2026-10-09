import { createRoot } from "react-dom/client";
import { useCallback, useRef, useState } from "react";
import AdminPanel from "../../src/components/enterprise/MerchantAttendanceAdminPanel";
import type { AttendanceApiFetch } from "../../src/lib/merchantAttendanceSelfClient";
declare const __BACKLOG_NAV_SEED__: { siteId: string; owner: string; other: string };
const seed = __BACKLOG_NAV_SEED__;
const paths = new Set(["admin", "owner-backlog", "correction-decisions", "revision-decisions", "missing"].map(p => `/api/merchant-enterprise/attendance/${p}`));
const attempts: { method: string; path: string }[] = [];
declare global { interface Window { backlogNavigationAttempts: () => { method: string; path: string }[] } }
Object.defineProperty(window, "backlogNavigationAttempts", { value: () => attempts.map(v => ({ ...v })), writable: false });
function App() {
  const [mounted, setMounted] = useState(true), [owner, setOwner] = useState(seed.owner), [enabled, setEnabled] = useState(true);
  const leaveGuard = useRef<(() => boolean) | null>(null);
  const registerLeaveGuard = useCallback((guard: (() => boolean) | null) => { leaveGuard.current = guard; }, []);
  const apiFetch: AttendanceApiFetch = useCallback((raw, init) => {
    const url = new URL(raw, location.origin);
    attempts.push({ method: init?.method ?? "GET", path: url.pathname });
    if (url.origin !== location.origin || !paths.has(url.pathname) || (init?.method ?? "GET") !== "GET" || init?.body) throw Error("backlog_navigation_get_only");
    const headers = new Headers(init?.headers); headers.set("x-backlog-navigation-actor", owner);
    return fetch(url.href, { ...init, headers, credentials: "same-origin" });
  }, [owner]);
  return <><header className="qa-toolbar"><p>229 负责人待审导航 · 实际 React 组件／合成 GET 协议。没有真实登录、SQL、审批提交或生产连接。</p>
    <div className="qa-controls"><button onClick={() => setMounted(v => !v)}>{mounted ? "卸载测试管理页" : "重挂测试管理页"}</button>
      <button disabled={!mounted} onClick={() => { if (leaveGuard.current?.()) setMounted(false); }}>尝试离开测试管理页</button>
      <button onClick={() => setOwner(v => v === seed.owner ? seed.other : seed.owner)}>{owner === seed.owner ? "切换测试负责人" : "恢复测试负责人"}</button>
      <button onClick={() => setEnabled(v => !v)}>{enabled ? "关闭测试导航开关" : "开启测试导航开关"}</button></div></header>
    <main className="qa-main">{mounted && <AdminPanel key={owner} siteId={seed.siteId} ownerId={owner} siteName="229 合成验收企业" apiFetch={apiFetch}
      registerLeaveGuard={registerLeaveGuard} ownerBacklogEnabled missingEnabled={enabled} correctionReviewEnabled correctionDecisionsEnabled={enabled} revisionApprovalEnabled={enabled}/>}</main></>;
}
createRoot(document.getElementById("qa-root")!).render(<App/>);
