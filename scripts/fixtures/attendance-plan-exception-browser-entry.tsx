// Local174 harness. The owner uses the real SourcesLauncher/Panel/PlanCoverage;
// self uses the actual workflow component, not a claim of full SelfPanel Auth.
import { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import SourcesLauncher from "../../src/components/enterprise/MerchantAttendanceSourcesLauncher";
import Workspace from "../../src/components/enterprise/MerchantAttendancePlanExceptionWorkspace";
declare global { interface Window { __planExceptionSeed: { site: string; owner: string; auth: string; employee: string; worker: string; slotId: string } } }
const visibility = (hidden: boolean) => {
  Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: hidden ? "hidden" : "visible" });
  document.dispatchEvent(new Event("visibilitychange"));
};
function Harness() {
  const seed = window.__planExceptionSeed, [mode, setMode] = useState<"parent" | "owner" | "self">("parent"), [mounted, setMounted] = useState(true);
  const [generation, setGeneration] = useState(0), [epoch, setEpoch] = useState(0), [enabled, setEnabled] = useState(true), [closed, setClosed] = useState(false);
  const guard = useRef<(() => boolean) | null>(null);
  const apiFetch = useMemo(() => async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers); headers.set("x-qa-access", mode === "self" ? "self" : "owner"); headers.set("x-qa-generation", String(generation));
    return fetch(url, { ...init, headers, credentials: "omit" });
  }, [generation, mode]);
  const change = (next: typeof mode) => { if (guard.current && !guard.current()) return; setMode(next); setMounted(true); setClosed(false); };
  return <><header className="qa-toolbar"><strong>排班异常处理 · 隔离真实 SQL · 合成认证，非生产</strong><div className="qa-controls">
    <button data-testid="parent" onClick={() => change("parent")}>实际负责人资料入口</button>
    <button data-testid="owner" onClick={() => change("owner")}>负责人异常工作区</button>
    <button data-testid="self" onClick={() => change("self")}>本人异常工作区</button>
    <button data-testid="api-change" onClick={() => setGeneration(n => n + 1)}>替换请求函数</button>
    <button data-testid="epoch" onClick={() => setEpoch(n => n + 1)}>强制授权代次变化</button>
    <button data-testid="hide" onClick={() => visibility(true)}>隐藏</button><button data-testid="show" onClick={() => visibility(false)}>显示</button>
    <button data-testid="pagehide" onClick={() => window.dispatchEvent(new Event("pagehide"))}>pagehide</button>
    <button data-testid="pageshow" onClick={() => window.dispatchEvent(new Event("pageshow"))}>pageshow</button>
    <button data-testid="unmount" onClick={() => setMounted(false)}>强制卸载</button><button data-testid="mount" onClick={() => { setMounted(true); setClosed(false); }}>重新挂载</button>
    <button data-testid="feature-off" onClick={() => setEnabled(false)}>关闭新操作入口</button><button data-testid="feature-on" onClick={() => setEnabled(true)}>恢复新操作入口</button>
  </div></header><main className="qa-main" data-qa-mode={mode} data-qa-mounted={String(mounted)} data-qa-closed={String(closed)} data-qa-generation={generation}>{mounted && !closed && (mode === "parent"
    ? <SourcesLauncher key={`parent:${epoch}`} siteId={seed.site} ownerId={seed.owner} workerId={seed.worker} apiFetch={apiFetch} enabled/>
    : <Workspace key={`${mode}:${epoch}`} siteId={seed.site} access={mode} actorId={mode === "self" ? seed.employee : seed.owner} apiFetch={apiFetch} enabled={enabled}
      initialTarget={mode === "owner" ? { workerId: seed.worker, slotId: seed.slotId } : undefined}
      registerLeaveGuard={value => { guard.current = value; }} onClose={() => setClosed(true)}/>)}
    {(!mounted || closed) && <p data-testid="closed">工作区已关闭</p>}</main></>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness/>);
