//199 actual parent/Launcher/Workspace, synthetic current viewer and HTTP only.
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import Admin from "../../src/components/enterprise/MerchantAttendanceAdminPanel";
import Self from "../../src/components/enterprise/MerchantAttendanceSelfPanel";
import Launcher from "../../src/components/enterprise/MerchantAttendanceDayReviewLauncher";
import type { AttendanceApiFetch } from "../../src/lib/merchantAttendanceSelfClient";
declare const __DAY_SEED__: { siteId: string; owner: string; self: string; employee: string; worker: string };
type Config = { mode: "idle" | "admin" | "self" | "isolated"; actor: string; access: "owner" | "self"; enabled: boolean; requester: number; active: boolean };
declare global { interface Window { __dayHarness: {
  configure(value: Partial<Config>): void; authValid(valid: boolean): void; hold(method: "GET" | "POST"): void;
  held(): boolean; release(): void; visibility(hidden: boolean): void; leave(): boolean;
} } }
const api = "/api/merchant-enterprise/attendance/day-reviews", held = { method: null as "GET" | "POST" | null, active: false, release: null as (() => void) | null };
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
  if (url.origin !== location.origin || ![api, "/api/merchant-enterprise/attendance/admin", "/api/merchant-enterprise/attendance/self"].includes(url.pathname)) throw Error("external_or_unknown_fetch");
  const pause = url.pathname === api && (init?.method ?? "GET") === held.method; if (pause) held.method = null;
  const response = await nativeFetch(input, init); if (!pause) return response;
  const bytes = new Uint8Array(await response.arrayBuffer()); let cancelled = false;
  return new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(0, 1)); held.active = true;
    held.release = () => { held.active = false; held.release = null; if (!cancelled) { c.enqueue(bytes.slice(1)); c.close(); } }; }, cancel() { cancelled = true; } }), { status: response.status, headers: response.headers });
};
function Harness() {
  const [config, setConfig] = useState<Config>({ mode: "idle", actor: __DAY_SEED__.owner, access: "owner", enabled: true, requester: 0, active: true });
  const [, renderAuth] = useState(0), valid = useRef(true), guard = useRef<(() => boolean) | null>(null);
  const register = useCallback((value: (() => boolean) | null) => { guard.current = value; }, []), current = useCallback(() => valid.current, []);
  const apiFetch = useCallback<AttendanceApiFetch>((path, init) => {
    const headers = new Headers(init?.headers); headers.set("X-Synthetic-Actor", config.actor); headers.set("X-Synthetic-Requester", String(config.requester));
    return fetch(path, { ...init, headers });
  }, [config.actor, config.requester]);
  useLayoutEffect(() => { window.__dayHarness = {
    configure: value => flushSync(() => setConfig(c => ({ ...c, ...value }))), authValid: value => { valid.current = value; flushSync(() => renderAuth(n => n + 1)); },
    hold: method => { held.method = method; }, held: () => held.active, release: () => held.release?.(),
    visibility: hidden => { Object.defineProperty(document, "hidden", { configurable: true, value: hidden }); Object.defineProperty(document, "visibilityState", { configurable: true, value: hidden ? "hidden" : "visible" }); document.dispatchEvent(new Event("visibilitychange")); },
    leave: () => !guard.current || guard.current(),
  }; }, []);
  return <main className="qa-main"><p className="p-3 text-sm">199 真实组件／合成当前身份与 API；不代表真实登录、来源完整性或 SQL 验收。</p>
    {config.mode === "idle" ? <div className="flex flex-wrap gap-3 p-3"><button onClick={() => setConfig(c => ({ ...c, mode: "admin" }))}>打开负责人合成父入口</button>
      <button onClick={() => setConfig(c => ({ ...c, mode: "self", actor: __DAY_SEED__.self, access: "self" }))}>打开本人合成父入口</button></div>
      : config.mode === "admin" ? <Admin siteId={__DAY_SEED__.siteId} ownerId={__DAY_SEED__.owner} authUserId={config.actor} apiFetch={apiFetch} isCurrentAuth={current} registerLeaveGuard={register}
        locationWorkspaceEnabled={false} exceptionWorkspaceEnabled={false} planExceptionsEnabled={false} workArrangementsEnabled={false}
        missingDelegationEnabled={false} applicationDelegationEnabled={false} scheduleDelegationEnabled={false} periodDelegationEnabled={false}
        correctionDelegationEnabled={false} operationalRulesEnabled={false} ownerNotificationsEnabled={false} employmentLifecycleEnabled={false}
        administrativeClosureEnabled={false} reviewRoutingEnabled={false} outageEnabled={false} retentionEnabled={false} correctionReviewEnabled={false}
        correctionControlsEnabled={false} timesheetEnabled={false} ownerBacklogEnabled={false} missingEnabled={false} correctionDecisionsEnabled={false} revisionApprovalEnabled={false}/>
      : config.mode === "self" ? <Self siteId={__DAY_SEED__.siteId} employeeId={__DAY_SEED__.employee} authUserId={config.actor} isCurrentAuth={current}
        employeeName="合成本人199" siteName="合成199" canClock={false} apiFetch={apiFetch} registerLeaveGuard={register}
        locationWorkspaceEnabled={false} exceptionWorkspaceEnabled={false} planExceptionsEnabled={false} workArrangementsEnabled={false}
        missingDelegationEnabled={false} applicationDelegationEnabled={false} scheduleDelegationEnabled={false} eventNotificationsEnabled={false}
        outageEnabled={false} correctionWorkspaceEnabled={false} selfScheduleEnabled={false} selfScheduleAdoptionEnabled={false}/>
      : <Launcher siteId={__DAY_SEED__.siteId} actorId={config.actor} access={config.access} workerId={config.access === "owner" ? __DAY_SEED__.worker : undefined}
        apiFetch={apiFetch} enabled={config.enabled} active={config.active} isCurrentAuth={current} registerLeaveGuard={register}/>}</main>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness/>);
