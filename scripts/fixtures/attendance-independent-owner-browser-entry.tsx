//196 actual Admin/Launcher/Panel. Auth/current viewer and HTTP are synthetic.
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import Admin from "../../src/components/enterprise/MerchantAttendanceAdminPanel";
import Launcher from "../../src/components/enterprise/MerchantAttendanceIndependentAdminLauncher";
import type { AttendanceApiFetch } from "../../src/lib/merchantAttendanceSelfClient";
declare const __INDEPENDENT_OWNER_SEED__: { siteId: string; owner: string };
type Config = { mode: "idle" | "admin" | "isolated"; actor: string; enabled: boolean; requester: number; active: boolean };
type Observation = { confirms: { kind: "leave" | "other"; result: boolean }[]; visibility: boolean[]; pagehides: number; modalCloses: number; modalCancels: number;
  hidden: boolean; modalPresent: boolean; modalOpen: boolean; reasonPresent: boolean; reasonNonempty: boolean; pinPresent: boolean; pinNonempty: boolean; pauseStatus: boolean };
declare global { interface Window { __independentOwnerHarness: {
  configure(value: Partial<Config>): void; authValid(valid: boolean): void; hold(method: "GET" | "POST"): void;
  held(): boolean; release(): void; visibility(hidden: boolean): void; pagehide(): void; leave(): boolean; observations(): Observation; resetObservations(): void;
} } }
const api = "/api/merchant-enterprise/attendance/independent", admin = "/api/merchant-enterprise/attendance/admin";
const held = { method: null as "GET" | "POST" | null, active: false, release: null as (() => void) | null };
const nativeFetch = window.fetch.bind(window);
// Preserve the real native confirm. Only booleans/categories are observed;
// never serialize a PIN, reason, input value or full confirmation message.
const events = { confirms: [] as Observation["confirms"], visibility: [] as boolean[], pagehides: 0, modalCloses: 0, modalCancels: 0 };
const nativeConfirm = window.confirm.bind(window);
window.confirm = message => { const result = nativeConfirm(message); events.confirms.push({ kind: String(message).startsWith("仍有草稿或待确认原编号") ? "leave" : "other", result }); return result; };
document.addEventListener("visibilitychange", () => events.visibility.push(document.hidden));
window.addEventListener("pagehide", () => { events.pagehides++; });
document.addEventListener("close", event => { if (event.target instanceof HTMLDialogElement) events.modalCloses++; }, true);
document.addEventListener("cancel", event => { if (event.target instanceof HTMLDialogElement) events.modalCancels++; }, true);
function observations(): Observation {
  const modal = document.querySelector<HTMLDialogElement>('dialog[aria-label="独立员工管理工作区"]'), reason = modal?.querySelector<HTMLTextAreaElement>("textarea"), pin = modal?.querySelector<HTMLInputElement>('input[type="password"]');
  return { ...events, confirms: events.confirms.map(e => ({ ...e })), visibility: [...events.visibility], hidden: document.hidden,
    modalPresent: !!modal, modalOpen: !!modal?.open, reasonPresent: !!reason, reasonNonempty: !!reason?.value, pinPresent: !!pin, pinNonempty: !!pin?.value,
    pauseStatus: !!modal?.textContent?.includes("已暂停并清除正文、草稿和 PIN") };
}
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
  if (url.origin !== location.origin || ![api, admin].includes(url.pathname)) throw Error("external_or_unknown_fetch");
  const pause = url.pathname === api && (init?.method ?? "GET") === held.method; if (pause) held.method = null;
  const response = await nativeFetch(input, init); if (!pause) return response;
  const bytes = new Uint8Array(await response.arrayBuffer()); let cancelled = false;
  return new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(0, 1)); held.active = true;
    held.release = () => { held.active = false; held.release = null; if (!cancelled) { c.enqueue(bytes.slice(1)); c.close(); } }; }, cancel() { cancelled = true; } }), { status: response.status, headers: response.headers });
};
function Harness() {
  const [config, setConfig] = useState<Config>({ mode: "idle", actor: __INDEPENDENT_OWNER_SEED__.owner, enabled: true, requester: 0, active: true });
  const [, renderAuth] = useState(0), valid = useRef(true), guard = useRef<(() => boolean) | null>(null);
  const register = useCallback((value: (() => boolean) | null) => { guard.current = value; }, []), current = useCallback(() => valid.current, []);
  const apiFetch = useCallback<AttendanceApiFetch>((path, init) => {
    const headers = new Headers(init?.headers); headers.set("X-Synthetic-Actor", config.actor); headers.set("X-Synthetic-Requester", String(config.requester));
    return fetch(path, { ...init, headers });
  }, [config.actor, config.requester]);
  useLayoutEffect(() => { window.__independentOwnerHarness = {
    configure: value => flushSync(() => setConfig(c => ({ ...c, ...value }))), authValid: value => { valid.current = value; flushSync(() => renderAuth(n => n + 1)); },
    hold: method => { held.method = method; }, held: () => held.active, release: () => held.release?.(),
    visibility: hidden => { Object.defineProperty(document, "hidden", { configurable: true, value: hidden }); Object.defineProperty(document, "visibilityState", { configurable: true, value: hidden ? "hidden" : "visible" }); document.dispatchEvent(new Event("visibilitychange")); },
    pagehide: () => window.dispatchEvent(new PageTransitionEvent("pagehide")), leave: () => !guard.current || guard.current(), observations,
    resetObservations: () => { events.confirms.length = 0; events.visibility.length = 0; events.pagehides = 0; events.modalCloses = 0; events.modalCancels = 0; },
  }; }, []);
  return <main className="qa-main"><p className="p-3 text-sm">196 实际负责人组件／合成 API 和当前身份；非真实 Auth、SQL 或 PIN 派生验收。</p>
    {config.mode === "idle" ? <button className="m-3" onClick={() => setConfig(c => ({ ...c, mode: "admin" }))}>打开独立员工合成父入口</button>
      : config.mode === "admin" ? <Admin siteId={__INDEPENDENT_OWNER_SEED__.siteId} ownerId={__INDEPENDENT_OWNER_SEED__.owner} authUserId={config.actor}
        apiFetch={apiFetch} isCurrentAuth={current} registerLeaveGuard={register} independentWorkersEnabled={config.enabled}
        locationWorkspaceEnabled={false} exceptionWorkspaceEnabled={false} planExceptionsEnabled={false} workArrangementsEnabled={false}
        missingDelegationEnabled={false} applicationDelegationEnabled={false} scheduleDelegationEnabled={false} periodDelegationEnabled={false}
        correctionDelegationEnabled={false} operationalRulesEnabled={false} ownerNotificationsEnabled={false} employmentLifecycleEnabled={false}
        administrativeClosureEnabled={false} reviewRoutingEnabled={false} outageEnabled={false} retentionEnabled={false} correctionReviewEnabled={false}
        correctionControlsEnabled={false} timesheetEnabled={false} ownerBacklogEnabled={false} missingEnabled={false} correctionDecisionsEnabled={false} revisionApprovalEnabled={false}/>
      : <Launcher siteId={__INDEPENDENT_OWNER_SEED__.siteId} actorId={config.actor} apiFetch={apiFetch} isCurrentAuth={current}
        enabled={config.enabled} active={config.active} registerLeaveGuard={register}/>}</main>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness/>);
