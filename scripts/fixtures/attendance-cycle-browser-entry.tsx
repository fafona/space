// Actual owner Admin and real 185 grant-selection host; synthetic viewer/API.
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import Admin from "../../src/components/enterprise/MerchantAttendanceAdminPanel";
import Delegation from "../../src/components/enterprise/MerchantAttendancePeriodDelegationLauncher";
import type { AttendanceApiFetch } from "../../src/lib/merchantAttendanceSelfClient";
declare const __CYCLE_SEED__: { siteId: string; owner: string; delegate: string; delegateEmployee: string };
type Config = { mode: "idle" | "admin" | "delegate"; enabled: boolean; requester: number };
declare global { interface Window { __cycleHarness: {
  configure(value: Partial<Config>): void; authValid(value: boolean): void; leave(): boolean;
  hold(path: string, method: "GET" | "POST"): void; held(): boolean; release(): void;
  visibility(hidden: boolean): void; pagehide(): void;
} } }
const paths = ["/api/merchant-enterprise/attendance/admin", "/api/merchant-enterprise/attendance/period-delegation",
  "/api/merchant-enterprise/attendance/operational-cycle", "/api/merchant-enterprise/attendance/operational-cycle/send",
  "/api/merchant-enterprise/attendance/period-closures-v2", "/api/merchant-enterprise/attendance/period-delegated-closure"];
const held = { path: "", method: "" as string, active: false, release: null as (() => void) | null };
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
  if (url.origin !== location.origin || !paths.includes(url.pathname)) throw Error("external_or_unknown_fetch");
  const pause = url.pathname === held.path && (init?.method ?? "GET") === held.method;
  if (pause) { held.path = ""; held.method = ""; }
  const response = await nativeFetch(input, init); if (!pause) return response;
  const bytes = new Uint8Array(await response.arrayBuffer()); let cancelled = false;
  return new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(0, 1)); held.active = true;
    held.release = () => { held.active = false; held.release = null; if (!cancelled) { c.enqueue(bytes.slice(1)); c.close(); } }; }, cancel() { cancelled = true; } }),
  { status: response.status, headers: response.headers });
};
function Harness() {
  const [config, setConfig] = useState<Config>({ mode: "idle", enabled: true, requester: 0 });
  const [, renderAuth] = useState(0), valid = useRef(true), guard = useRef<(() => boolean) | null>(null);
  const enabled = useRef(config.enabled); useLayoutEffect(() => { enabled.current = config.enabled; }, [config.enabled]);
  const current = useCallback(() => valid.current, []), register = useCallback((value: (() => boolean) | null) => { guard.current = value; }, []);
  const actor = config.mode === "delegate" ? __CYCLE_SEED__.delegate : __CYCLE_SEED__.owner;
  const apiFetch = useCallback<AttendanceApiFetch>((path, init) => { const headers = new Headers(init?.headers);
    headers.set("X-Synthetic-Actor", actor); headers.set("X-Synthetic-Requester", String(config.requester)); headers.set("X-Synthetic-Enabled", String(enabled.current));
    return fetch(path, { ...init, headers }); }, [actor, config.requester]);
  useLayoutEffect(() => { window.__cycleHarness = {
    configure: value => flushSync(() => setConfig(c => ({ ...c, ...value }))), authValid: value => { valid.current = value; flushSync(() => renderAuth(n => n + 1)); },
    leave: () => !guard.current || guard.current(), hold: (path, method) => { if (!paths.includes(path)) throw Error("invalid_hold"); held.path = path; held.method = method; },
    held: () => held.active, release: () => held.release?.(),
    visibility: hidden => { Object.defineProperty(document, "hidden", { configurable: true, value: hidden }); Object.defineProperty(document, "visibilityState", { configurable: true, value: hidden ? "hidden" : "visible" }); document.dispatchEvent(new Event("visibilitychange")); },
    pagehide: () => window.dispatchEvent(new Event("pagehide")),
  }; }, []);
  return <main className="qa-main"><p className="p-3 text-sm">200 真实组件与授权选择路径／合成当前身份与 API；不代表真实 Auth、SQL 或权限验收。</p>
    {config.mode === "idle" ? <button onClick={() => setConfig(c => ({ ...c, mode: "admin" }))}>打开负责人合成父入口</button>
      : config.mode === "admin" ? <Admin siteId={__CYCLE_SEED__.siteId} ownerId={__CYCLE_SEED__.owner} authUserId={actor} apiFetch={apiFetch} isCurrentAuth={current} registerLeaveGuard={register}
        operationalCycleEnabled={config.enabled} locationWorkspaceEnabled={false} exceptionWorkspaceEnabled={false} planExceptionsEnabled={false} workArrangementsEnabled={false}
        missingDelegationEnabled={false} applicationDelegationEnabled={false} scheduleDelegationEnabled={false} periodDelegationEnabled={false}
        correctionDelegationEnabled={false} operationalRulesEnabled={false} ownerNotificationsEnabled={false} employmentLifecycleEnabled={false}
        administrativeClosureEnabled={false} reviewRoutingEnabled={false} independentWorkersEnabled={false} outageEnabled={false} retentionEnabled={false}
        correctionReviewEnabled={false} correctionControlsEnabled={false} timesheetEnabled={false} ownerBacklogEnabled={false} missingEnabled={false} correctionDecisionsEnabled={false} revisionApprovalEnabled={false}/>
      : <Delegation siteId={__CYCLE_SEED__.siteId} access="delegate" actorId={__CYCLE_SEED__.delegateEmployee} authUserId={actor}
        apiFetch={apiFetch} isCurrentAuth={current} enabled periodsEnabled cycleEnabled={config.enabled} registerLeaveGuard={register}/>}</main>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness/>);
