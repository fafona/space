// Actual Admin/Launcher/Panel/independent recovery; synthetic Auth/HTTP only.
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import Admin from "../../src/components/enterprise/MerchantAttendanceAdminPanel";
import RecoveryPage from "../../src/components/enterprise/MerchantAttendanceDelegationRecoveryPage";
import type { AttendanceApiFetch } from "../../src/lib/merchantAttendanceSelfClient";
declare const __RD_SEED__: { siteId: string; owner: string; other: string };
type Config = { mode: "idle" | "admin" | "recovery"; actor: string };
declare global { interface Window {
  __disposalAuth: { actor: string; verified: number; setActor(actor: string): void };
  __disposalHarness: { configure(value: Partial<Config>): void; hold(): void; held(): boolean; release(): void; visibility(hidden: boolean): void; leave(): boolean };
} }
const held = { armed: false, active: false, release: null as (() => void) | null }, nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
  if (url.origin !== location.origin || !["/api/merchant-enterprise/attendance/admin", "/api/merchant-enterprise/attendance/retention-disposal"].includes(url.pathname)) throw Error("external_or_unknown_fetch");
  const pause = held.armed && init?.method === "POST"; if (pause) held.armed = false;
  const response = await nativeFetch(input, init); if (!pause) return response;
  const bytes = new Uint8Array(await response.arrayBuffer()); let cancelled = false;
  return new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(0, 1)); held.active = true;
    held.release = () => { held.active = false; held.release = null; if (!cancelled) { c.enqueue(bytes.slice(1)); c.close(); } }; }, cancel() { cancelled = true; } }), { status: response.status, headers: response.headers });
};
function Harness() {
  const [config, setConfig] = useState<Config>({ mode: "idle", actor: __RD_SEED__.owner });
  const guard = useRef<(() => boolean) | null>(null), register = useCallback((value: (() => boolean) | null) => { guard.current = value; }, []);
  const current = useCallback(() => window.__disposalAuth.actor === config.actor, [config.actor]);
  const apiFetch = useCallback<AttendanceApiFetch>((path, init) => { if (!current()) return Promise.reject(Error("synthetic_auth_changed"));
    const headers = new Headers(init?.headers); headers.set("X-Synthetic-Actor", config.actor); return fetch(path, { ...init, headers }); }, [config.actor, current]);
  useLayoutEffect(() => {
    const auth = () => flushSync(() => setConfig(c => ({ ...c, mode: "idle", actor: window.__disposalAuth.actor })));
    window.addEventListener("disposal-auth", auth);
    window.__disposalHarness = { configure: value => flushSync(() => setConfig(c => ({ ...c, ...value }))), hold: () => { held.armed = true; }, held: () => held.active, release: () => held.release?.(),
      visibility: hidden => { Object.defineProperty(document, "hidden", { configurable: true, value: hidden }); Object.defineProperty(document, "visibilityState", { configurable: true, value: hidden ? "hidden" : "visible" }); document.dispatchEvent(new Event("visibilitychange")); }, leave: () => !guard.current || guard.current() };
    return () => window.removeEventListener("disposal-auth", auth);
  }, []);
  return <main className="qa-main"><p className="p-3 text-sm">197 真实组件／合成密码认证与API；不是实际登录或SQL处置。</p>
    {config.mode === "idle" ? <button onClick={() => setConfig(c => ({ ...c, mode: "admin" }))}>打开负责人合成宿主</button>
      : config.mode === "recovery" ? <RecoveryPage/> : <Admin key={config.actor} siteId={__RD_SEED__.siteId} ownerId={__RD_SEED__.owner} authUserId={config.actor} apiFetch={apiFetch} isCurrentAuth={current}
        registerLeaveGuard={register} locationWorkspaceEnabled={false} exceptionWorkspaceEnabled={false} planExceptionsEnabled={false} workArrangementsEnabled={false}
        missingDelegationEnabled={false} applicationDelegationEnabled={false} scheduleDelegationEnabled={false} periodDelegationEnabled={false} correctionDelegationEnabled={false}
        operationalRulesEnabled={false} ownerNotificationsEnabled={false} employmentLifecycleEnabled={false} outageEnabled={false} retentionEnabled={false} administrativeClosureEnabled={false} reviewRoutingEnabled={false}
        correctionReviewEnabled={false} correctionControlsEnabled={false} timesheetEnabled={false} ownerBacklogEnabled={false} missingEnabled={false} correctionDecisionsEnabled={false} revisionApprovalEnabled={false}/>}</main>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness/>);
