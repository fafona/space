// Inert196 entry: actual owner AdminPanel and lazy lifecycle workflow.
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Admin from "../../src/components/enterprise/MerchantAttendanceAdminPanel";
declare global { interface Window { __employmentLifecycleSeed: { subjects: { site: string; owner: string; worker: string; name: string }[] } } }
function Harness() {
  const subjects = window.__employmentLifecycleSeed.subjects;
  const [index, setIndex] = useState(0), [enabled, setEnabled] = useState(false), guard = useRef<(() => boolean) | null>(null);
  const apiFetch = useCallback((path: string, init?: RequestInit) => fetch(path, { ...init, credentials: "omit", cache: "no-store", redirect: "error" }), []);
  const registerLeaveGuard = useCallback((value: (() => boolean) | null) => { guard.current = value; }, []);
  useEffect(() => {
    const rollout = (event: Event) => { const value = (event as CustomEvent<unknown>).detail; if (typeof value === "boolean") setEnabled(value); };
    window.addEventListener("qa-employment-rollout", rollout); return () => window.removeEventListener("qa-employment-rollout", rollout);
  }, []);
  const subject = subjects[index];
  return <><header className="qa-toolbar"><p>隔离验收：真实负责人考勤配置与任职页面，认证为合成，读取和操作走真实处理器／SQL。日期前进使用无事件人员的真实时区配置更新，不声称等待跨夜。</p>
    <div className="qa-controls">{subjects.map((value, n) => <button key={value.site} data-testid={`subject-${n}`} onClick={() => { if (!guard.current || guard.current()) setIndex(n); }}>{n ? "无事项人员" : "未来排班阻断人员"}</button>)}
      <button data-testid="feature-on" onClick={() => setEnabled(true)}>启用任职入口</button><span data-testid="feature-state">{enabled ? "on" : "off"}</span></div></header>
    <main className="qa-main"><Admin key={`${subject.site}:${subject.owner}`} siteId={subject.site} ownerId={subject.owner} siteName="合成隔离企业"
      apiFetch={apiFetch} registerLeaveGuard={registerLeaveGuard} employmentLifecycleEnabled={enabled} workArrangementsEnabled/></main></>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness/>);
