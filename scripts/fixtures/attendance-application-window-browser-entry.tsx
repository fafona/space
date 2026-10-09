//243 Real self application hosts; synthetic Auth/HTTP, no real session login.
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import Correction from "../../src/components/enterprise/MerchantAttendanceCorrectionWorkspace";
import Revision from "../../src/components/enterprise/MerchantAttendanceRevisionWorkspace";
import Missing from "../../src/components/enterprise/MerchantAttendanceMissingPanel";
import type { AttendanceApiFetch } from "../../src/lib/merchantAttendanceSelfClient";
declare const __AW_SEED__: { siteId: string; employee: string; auth: string; other: string; worker: string; root: string };
type Kind = "correction" | "correction_revision" | "missing";
declare global { interface Window { __awHarness: { configure(v: { kind?: Kind; enabled?: boolean; other?: boolean; open?: boolean }): void; hold(): void; held(): boolean; release(): void; visibility(v: boolean): void; leave(): boolean } } }
const seed = __AW_SEED__, held = { armed: false, active: false, release: null as (() => void) | null };
function Harness() {
  const [config, setConfig] = useState({ kind: "correction" as Kind, enabled: true, other: false, open: false });
  const guard = useRef<(() => boolean) | null>(null), register = useCallback((value: (() => boolean) | null) => { guard.current = value; }, []);
  const actor = config.other ? seed.other : seed.auth;
  const apiFetch = useCallback<AttendanceApiFetch>(async (path, init) => {
    if (new URL(path, location.origin).origin !== location.origin) throw Error("external"); const pause = held.armed; held.armed = false;
    const response = await fetch(path, { ...init, headers: { ...init?.headers, "X-Synthetic-Actor": actor } }); if (!pause) return response;
    const bytes = new Uint8Array(await response.arrayBuffer()); let cancelled = false;
    return new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(0, 1)); held.active = true; held.release = () => { held.active = false; held.release = null; if (!cancelled) { c.enqueue(bytes.slice(1)); c.close(); } }; }, cancel() { cancelled = true; } }), { status: response.status, headers: response.headers });
  }, [actor]);
  useLayoutEffect(() => { window.__awHarness = { configure: v => flushSync(() => setConfig(c => ({ ...c, ...v }))), hold: () => { held.armed = true; }, held: () => held.active, release: () => held.release?.(),
    visibility: v => { Object.defineProperty(document, "hidden", { configurable: true, value: v }); Object.defineProperty(document, "visibilityState", { configurable: true, value: v ? "hidden" : "visible" }); document.dispatchEvent(new Event("visibilitychange")); }, leave: () => !guard.current || guard.current() }; }, []);
  const props = { siteId: seed.siteId, authUserId: actor, apiFetch, applicationWindowEnabled: config.enabled, registerLeaveGuard: register, onClose: () => setConfig(c => ({ ...c, open: false })) };
  return <main className="qa-main"><p className="p-3 text-sm">243 合成身份与HTTP，真实申请宿主和窗口；不代表真实登录或SQL。</p>
    {!config.open ? <button className="m-3 rounded border bg-white p-3" onClick={() => setConfig(c => ({ ...c, open: true }))}>打开合成申请宿主</button>
      : config.kind === "correction" ? <Correction {...props} employeeId={seed.employee} /> : config.kind === "correction_revision" ? <Revision {...props} employeeId={seed.employee} initialTarget={{ workerId: seed.worker, baseRequestId: seed.root }} />
        : <Missing {...props} actorId={seed.employee} access="self" />}
  </main>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness />);
