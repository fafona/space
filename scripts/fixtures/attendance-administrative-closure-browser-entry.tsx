//195 real Admin/Launcher/Panel and independent SelfPage; synthetic Auth only.
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import Admin from "../../src/components/enterprise/MerchantAttendanceAdminPanel";
import SelfPage from "../../src/components/enterprise/MerchantAttendanceAdministrativeClosurePage";
import type { AttendanceApiFetch } from "../../src/lib/merchantAttendanceSelfClient";
declare const __AC_SEED__: { siteId: string; owner: string; self: string; other: string };
type Config = { mode: "idle" | "admin" | "self"; enabled: boolean };
declare global { interface Window {
  __closureAuth: { actor: string; verified: number; setActor(actor: string): void };
  __closureHarness: { configure(value: Partial<Config>): void; hold(): void; held(): boolean; release(): void; visibility(hidden: boolean): void; leave(): boolean };
} }
const held = { armed: false, active: false, release: null as (() => void) | null }, nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
  if (url.origin !== location.origin || !["/api/merchant-enterprise/attendance/admin", "/api/merchant-enterprise/attendance/administrative-closures"].includes(url.pathname)) throw Error("external_or_unknown_fetch");
  const pause = held.armed && init?.method === "POST"; if (pause) held.armed = false;
  const response = await nativeFetch(input, init); if (!pause) return response;
  const bytes = new Uint8Array(await response.arrayBuffer()); let cancelled = false;
  return new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(0, 1)); held.active = true;
    held.release = () => { held.active = false; held.release = null; if (!cancelled) { c.enqueue(bytes.slice(1)); c.close(); } }; }, cancel() { cancelled = true; } }), { status: response.status, headers: response.headers });
};
function Harness() {
  const [config, setConfig] = useState<Config>({ mode: "idle", enabled: true });
  const guard = useRef<(() => boolean) | null>(null), register = useCallback((value: (() => boolean) | null) => { guard.current = value; }, []);
  const apiFetch = useCallback<AttendanceApiFetch>((path, init) => { const headers = new Headers(init?.headers); headers.set("X-Synthetic-Actor", __AC_SEED__.owner); return fetch(path, { ...init, headers }); }, []);
  const current = useCallback(() => true, []);
  useLayoutEffect(() => { window.__closureHarness = { configure: value => flushSync(() => setConfig(c => ({ ...c, ...value }))), hold: () => { held.armed = true; }, held: () => held.active, release: () => held.release?.(),
    visibility: hidden => { Object.defineProperty(document, "hidden", { configurable: true, value: hidden }); Object.defineProperty(document, "visibilityState", { configurable: true, value: hidden ? "hidden" : "visible" }); document.dispatchEvent(new Event("visibilitychange")); }, leave: () => !guard.current || guard.current() }; }, []);
  return <main className="qa-main"><p className="p-3 text-sm">195 真实组件／合成密码认证与API，不代表实际登录、暂停来源或SQL。</p>
    {config.mode === "idle" ? <div className="flex flex-wrap gap-3 p-3"><button onClick={() => setConfig(c => ({ ...c, mode: "admin" }))}>打开负责人合成宿主</button><button onClick={() => setConfig(c => ({ ...c, mode: "self" }))}>打开本人独立页面</button></div>
      : config.mode === "self" ? <SelfPage/> : <Admin siteId={__AC_SEED__.siteId} ownerId={__AC_SEED__.owner} authUserId={__AC_SEED__.owner} apiFetch={apiFetch} isCurrentAuth={current}
        administrativeClosureEnabled={config.enabled} registerLeaveGuard={register} locationWorkspaceEnabled={false} exceptionWorkspaceEnabled={false} planExceptionsEnabled={false}
        workArrangementsEnabled={false} missingDelegationEnabled={false} applicationDelegationEnabled={false} scheduleDelegationEnabled={false} periodDelegationEnabled={false}
        correctionDelegationEnabled={false} operationalRulesEnabled={false} ownerNotificationsEnabled={false} employmentLifecycleEnabled={false} outageEnabled={false} retentionEnabled={false}
        correctionReviewEnabled={false} correctionControlsEnabled={false} timesheetEnabled={false} ownerBacklogEnabled={false} missingEnabled={false} correctionDecisionsEnabled={false} revisionApprovalEnabled={false}/>}</main>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness/>);
