// Actual owner Admin/Launcher/Panel and independent RecoveryPanel. Auth/API only
// are synthetic; no real login, database, production endpoint or runtime rules.
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import Admin from "../../src/components/enterprise/MerchantAttendanceAdminPanel";
import Recovery from "../../src/components/enterprise/MerchantAttendanceDelegationRecoveryPanel";
import type { AttendanceApiFetch } from "../../src/lib/merchantAttendanceSelfClient";
declare const __RULES_BROWSER_SEED__: { siteId: string; actor: string; other: string; endpoint: string };
declare global { interface Window { __rulesHarness: { configure(v: { enabled?: boolean; recovery?: boolean; other?: boolean }): void; hold(): void; held(): boolean; release(): void; visibility(v: boolean): void } } }
const seed = __RULES_BROWSER_SEED__, transport = { hold: false, held: false, release: null as (() => void) | null };
/* eslint-disable react-hooks/refs -- Synthetic Auth revocation is synchronous before rendering a new actual host; effects would leave a late-response window. */
function Harness() {
  const [config, setConfig] = useState({ enabled: true, recovery: false, other: false });
  const identity = config.other ? seed.other : seed.actor, live = useRef(identity); live.current = identity;
  const current = useCallback(() => live.current === identity, [identity]);
  const apiFetch = useCallback<AttendanceApiFetch>(async (path, init) => {
    const url = new URL(path, location.origin); if (url.origin !== location.origin) throw Error("external_fetch");
    const hold = transport.hold && url.pathname === seed.endpoint; if (hold) transport.hold = false;
    const response = await fetch(path, { ...init, headers: { ...init?.headers, "x-synthetic-actor": identity, "x-synthetic-owner": String(!config.recovery && !config.other), "x-synthetic-rules-enabled": String(config.enabled) } });
    if (!hold) return response; const bytes = new Uint8Array(await response.arrayBuffer()); let canceled = false;
    return new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(0, 1)); transport.held = true; transport.release = () => { transport.held = false; transport.release = null; if (!canceled) { c.enqueue(bytes.slice(1)); c.close(); } }; }, cancel() { canceled = true; } }), { status: response.status, headers: response.headers });
  }, [identity, config.recovery, config.other, config.enabled]);
  useLayoutEffect(() => { window.__rulesHarness = { configure: v => flushSync(() => setConfig(c => ({ ...c, ...v }))), hold: () => { transport.hold = true; }, held: () => transport.held, release: () => transport.release?.(), visibility: v => { Object.defineProperty(document, "hidden", { configurable: true, value: v }); Object.defineProperty(document, "visibilityState", { configurable: true, value: v ? "hidden" : "visible" }); document.dispatchEvent(new Event("visibilitychange")); } }; }, []);
  return <main className="qa-main"><header className="m-2 rounded border bg-amber-50 p-3 text-sm">运营规则台账 · 真实负责人及独立恢复页面；仅合成 Auth/API，不代表 SQL 或实际打卡消费。</header>
    {config.recovery || config.other ? <Recovery key={identity} authUserId={identity} apiFetch={apiFetch} isCurrentAuth={current}/> : <Admin key={identity} siteId={seed.siteId} ownerId={identity} authUserId={identity} isCurrentAuth={current} apiFetch={apiFetch} operationalRulesEnabled={config.enabled}/>}</main>;
}
/* eslint-enable react-hooks/refs */
createRoot(document.getElementById("qa-root")!).render(<Harness/>);
