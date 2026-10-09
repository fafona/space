// Actual Unified launcher/panel -> period launcher/workspace; synthetic login
// identity and HTTP bridge are injected by the owned native runner.
import { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import UnifiedLauncher from "../../src/components/enterprise/MerchantAttendanceUnifiedTimesheetLauncher";
import type { UnifiedQuery } from "../../src/lib/merchantAttendanceUnifiedTimesheet";
declare global { interface Window { __periodClosureSeed: { site: string; owner: string; employee: string; worker: string; fromDate: string; throughDate: string } } }
const visibility = (hidden: boolean) => { Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: hidden ? "hidden" : "visible" }); document.dispatchEvent(new Event("visibilitychange")); };
function Harness() {
  const seed = window.__periodClosureSeed, [access, setAccess] = useState<"owner" | "self">("owner"), [generation, setGeneration] = useState(0), [epoch, setEpoch] = useState(0);
  const [paused, setPaused] = useState(false), [mounted, setMounted] = useState(true), guard = useRef<(() => boolean) | null>(null);
  const query: UnifiedQuery = access === "owner" ? { siteId: seed.site, access, workerId: seed.worker, fromDate: seed.fromDate, throughDate: seed.throughDate }
    : { siteId: seed.site, access, expectedWorkerId: seed.worker, fromDate: seed.fromDate, throughDate: seed.throughDate };
  const apiFetch = useMemo(() => async (url: string, init?: RequestInit) => { const headers = new Headers(init?.headers); headers.set("x-qa-access", access);
    headers.set("x-qa-paused", String(paused)); headers.set("x-qa-generation", String(generation)); return fetch(url, { ...init, headers, credentials: "omit" }); }, [access, paused, generation]);
  const change = (next: typeof access) => { if (guard.current && !guard.current()) return; setAccess(next); setMounted(true); };
  return <><header className="qa-toolbar"><strong>周期核对 · 隔离真实 SQL · 合成认证，非生产</strong><div className="qa-controls">
    <button data-testid="owner" onClick={() => change("owner")}>负责人</button><button data-testid="self" onClick={() => change("self")}>本人</button>
    <button data-testid="paused" onClick={() => setPaused(true)}>暂停新操作</button><button data-testid="enabled" onClick={() => setPaused(false)}>恢复新操作</button>
    <button data-testid="api-change" onClick={() => setGeneration(n => n + 1)}>替换请求函数</button><button data-testid="epoch" onClick={() => setEpoch(n => n + 1)}>强制授权变化</button>
    <button data-testid="hide" onClick={() => visibility(true)}>隐藏</button><button data-testid="show" onClick={() => visibility(false)}>显示</button>
    <button data-testid="pagehide" onClick={() => window.dispatchEvent(new Event("pagehide"))}>pagehide</button><button data-testid="pageshow" onClick={() => window.dispatchEvent(new Event("pageshow"))}>pageshow</button>
    <button data-testid="unmount" onClick={() => setMounted(false)}>强制卸载</button><button data-testid="mount" onClick={() => setMounted(true)}>重新挂载</button>
  </div></header><main className="qa-main" data-qa-access={access} data-qa-paused={String(paused)}>{mounted && <UnifiedLauncher key={`${access}:${epoch}`} query={query}
    actorId={access === "owner" ? seed.owner : seed.employee} apiFetch={apiFetch} enabled registerLeaveGuard={value => { guard.current = value; }}/>}</main></>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness/>);
