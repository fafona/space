//198 actual Admin/routing/original WorkArrangement/recovery React; synthetic Auth/API.
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import Admin from "../../src/components/enterprise/MerchantAttendanceAdminPanel";
import RecoveryPage from "../../src/components/enterprise/MerchantAttendanceDelegationRecoveryPage";
import RoutingSelf from "../../src/components/enterprise/MerchantAttendanceReviewRoutingSelf";
import type { AttendanceApiFetch } from "../../src/lib/merchantAttendanceSelfClient";
declare const __RR_SEED__: { siteId: string; owner: string; self: string; other: string; request: string; handover: string };
type Config = { mode: "idle" | "admin" | "recovery" | "self"; enabled: boolean };
declare global { interface Window {
  __routingAuth: { actor: string; verified: number; setActor(actor: string): void };
  __routingHarness: { configure(value: Partial<Config>): void; hold(): void; held(): boolean; release(): void; visibility(hidden: boolean): void; leave(): boolean };
} }
const held = { armed: false, active: false, release: null as (() => void) | null }, nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
  if (url.origin !== location.origin || !["/api/merchant-enterprise/attendance/admin", "/api/merchant-enterprise/attendance/review-routing", "/api/merchant-enterprise/attendance/work-arrangements"].includes(url.pathname)) throw Error("external_or_unknown_fetch");
  const pause = held.armed && init?.method === "POST"; if (pause) held.armed = false;
  const response = await nativeFetch(input, init); if (!pause) return response;
  const bytes = new Uint8Array(await response.arrayBuffer()); let cancelled = false;
  return new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(0, 1)); held.active = true;
    held.release = () => { held.active = false; held.release = null; if (!cancelled) { c.enqueue(bytes.slice(1)); c.close(); } }; }, cancel() { cancelled = true; } }), { status: response.status, headers: response.headers });
};
function Harness() {
  const [config, setConfig] = useState<Config>({ mode: "idle", enabled: true }), [actor, setActor] = useState(__RR_SEED__.owner);
  const guard = useRef<(() => boolean) | null>(null), register = useCallback((value: (() => boolean) | null) => { guard.current = value; }, []);
  const current = useCallback(() => window.__routingAuth.actor === actor, [actor]);
  const apiFetch = useCallback<AttendanceApiFetch>((path, init) => { if (!current()) return Promise.reject(Error("synthetic_auth_changed")); const headers = new Headers(init?.headers); headers.set("X-Synthetic-Actor", actor); return fetch(path, { ...init, headers }); }, [actor, current]);
  useLayoutEffect(() => {
    const auth = () => flushSync(() => { setActor(window.__routingAuth.actor); setConfig(c => ({ ...c, mode: "idle" })); }); window.addEventListener("routing-auth", auth);
    window.__routingHarness = { configure: value => flushSync(() => setConfig(c => ({ ...c, ...value }))), hold: () => { held.armed = true; }, held: () => held.active, release: () => held.release?.(),
      visibility: hidden => { Object.defineProperty(document, "hidden", { configurable: true, value: hidden }); Object.defineProperty(document, "visibilityState", { configurable: true, value: hidden ? "hidden" : "visible" }); document.dispatchEvent(new Event("visibilitychange")); }, leave: () => !guard.current || guard.current() };
    return () => window.removeEventListener("routing-auth", auth);
  }, []);
  return <main className="qa-main"><p className="p-3 text-sm">198 真实组件／合成密码认证与API，不代表实际登录或SQL。</p>
    {config.mode === "idle" ? <button onClick={() => setConfig(c => ({ ...c, mode: "admin" }))}>打开负责人合成宿主</button>
      : config.mode === "recovery" ? <RecoveryPage/>
      : config.mode === "self" ? <RoutingSelf key={actor} siteId={__RR_SEED__.siteId} authUserId={actor} family="work_arrangement" requestId={__RR_SEED__.request} apiFetch={apiFetch} isCurrentAuth={current}/>
      : <Admin key={actor} siteId={__RR_SEED__.siteId} ownerId={__RR_SEED__.owner} authUserId={actor} apiFetch={apiFetch} isCurrentAuth={current}
        reviewRoutingEnabled={config.enabled} registerLeaveGuard={register} workArrangementsEnabled locationWorkspaceEnabled={false} exceptionWorkspaceEnabled={false} planExceptionsEnabled={false}
        missingDelegationEnabled={false} applicationDelegationEnabled={false} scheduleDelegationEnabled={false} periodDelegationEnabled={false} correctionDelegationEnabled={false}
        operationalRulesEnabled={false} ownerNotificationsEnabled={false} employmentLifecycleEnabled={false} outageEnabled={false} retentionEnabled={false} administrativeClosureEnabled={false}
        correctionReviewEnabled={false} correctionControlsEnabled={false} timesheetEnabled={false} ownerBacklogEnabled={false} missingEnabled={false} correctionDecisionsEnabled={false} revisionApprovalEnabled={false}/>}</main>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness/>);
