//237 actual RetentionPanel + picker; only Auth and transport are synthetic.
import { StrictMode, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import Panel from "../../src/components/enterprise/MerchantAttendanceRetentionPanel";
import type { AttendanceApiFetch } from "../../src/lib/merchantAttendanceSelfClient";
declare const __RETENTION_PERIODS_SEED__: { siteId: string; actorId: string; otherActorId: string; endpoints: string[] };
declare global { interface Window { __retentionPeriodsHarness: {
 configure(patch: { other?: boolean; apiEpoch?: number; enabled?: boolean }): void;
 visibility(visible: boolean): void; holdNext(): void; release(): void; snapshot(): { calls: number; held: boolean; closed: boolean };
}; } }
const seed = __RETENTION_PERIODS_SEED__;
function Harness() {
 const [config, setConfig] = useState({ other: false, apiEpoch: 0, enabled: true }), [closed, setClosed] = useState(false);
 const calls = useRef(0), hold = useRef(false), held = useRef(false), release = useRef<(() => void) | null>(null);
 const actorId = config.other ? seed.otherActorId : seed.actorId;
 const apiFetch = useMemo<AttendanceApiFetch>(() => async (urlValue, init = {}) => {
  const url = new URL(urlValue, location.origin);
  if (url.origin !== location.origin || !seed.endpoints.includes(url.pathname) || init.method !== "GET") throw Error("qa_only_explicit_get");
  const delayed = hold.current; hold.current = false; calls.current++;
  const response = await fetch(url, { ...init, credentials: "omit", redirect: "error", headers: { ...init.headers, "x-retention-periods-qa-auth": actorId } });
  if (!delayed) return response;
  const bytes = new Uint8Array(await response.arrayBuffer()); let canceled = false;
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
   controller.enqueue(bytes.slice(0, 1)); held.current = true;
   release.current = () => { held.current = false; release.current = null; if (!canceled) { controller.enqueue(bytes.slice(1)); controller.close(); } };
  }, cancel() { canceled = true; } }), { status: response.status, headers: response.headers });
 }, [actorId, config.apiEpoch]);
 useLayoutEffect(() => { window.__retentionPeriodsHarness = {
  configure: patch => flushSync(() => setConfig(old => ({ ...old, ...patch }))),
  visibility: visible => { Object.defineProperty(document, "hidden", { configurable: true, get: () => !visible }); document.dispatchEvent(new Event("visibilitychange")); },
  holdNext: () => { hold.current = true; }, release: () => release.current?.(), snapshot: () => ({ calls: calls.current, held: held.current, closed }),
 }; }, [closed]);
 return <main className="qa-main min-w-0"><header className="mb-3 rounded border bg-amber-50 p-3 text-sm">237长期归档发现 · 实际保留父组件；合成Auth/API，无SQL、删除或保全提交。</header>
  {!closed && <Panel key={actorId} siteId={seed.siteId} actorId={actorId} apiFetch={apiFetch} enabled periodsV2Enabled={config.enabled} onClose={() => setClosed(true)}/>}
 </main>;
}
createRoot(document.getElementById("qa-root")!).render(<StrictMode><Harness/></StrictMode>);
