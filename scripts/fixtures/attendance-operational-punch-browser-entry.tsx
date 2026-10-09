// Real shared Host/Workspace. All identity and HTTP replies are synthetic.
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import Host from "../../src/components/enterprise/MerchantAttendanceOperationalPunchHost";
import type { AttendanceApiFetch } from "../../src/lib/merchantAttendanceSelfClient";
declare const __PUNCH_SEED__: { siteId: string; auth: string; other: string; worker: string; employee: string; terminal: string };
declare global { interface Window { __punchHarness: { configure(v: { enabled?: boolean; other?: boolean; pin?: boolean; onsite?: boolean }): void; scan(token: string | null): void; consumed(): number; hold(): void; held(): boolean; release(): void; visibility(v: boolean): void } } }
const seed = __PUNCH_SEED__, held = { armed: false, active: false, release: null as (() => void) | null };
function Harness() {
  const [config, setConfig] = useState({ enabled: true, other: false, pin: false, onsite: false }), [token, setToken] = useState<string | null>(null), consumed = useRef(0);
  // Synthetic scan bridge, not a camera/HMAC/device authentication substitute.
  const consumeToken = useCallback(() => { consumed.current++; }, []);
  const apiFetch = useCallback<AttendanceApiFetch>(async (path, init) => {
    if (new URL(path, location.origin).origin !== location.origin) throw Error("external_request");
    const pause = held.armed; held.armed = false;
    const response = await fetch(path, init); if (!pause) return response;
    const bytes = new Uint8Array(await response.arrayBuffer()); let canceled = false;
    return new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(0, 1)); held.active = true;
      held.release = () => { held.active = false; held.release = null; if (!canceled) { c.enqueue(bytes.slice(1)); c.close(); } }; }, cancel() { canceled = true; } }), { status: response.status, headers: response.headers });
  }, []);
  useLayoutEffect(() => { window.__punchHarness = { configure: v => flushSync(() => { setConfig(c => ({ ...c, ...v })); setToken(null); }), scan: value => flushSync(() => setToken(value)), consumed: () => consumed.current, hold: () => { held.armed = true; }, held: () => held.active, release: () => held.release?.(),
    visibility: v => { Object.defineProperty(document, "hidden", { configurable: true, value: v }); document.dispatchEvent(new Event("visibilitychange")); } }; }, []);
  return <main className="qa-main"><p className="p-3 text-sm">242 合成身份／HTTP；真实共享入口和打卡组件，不代表真实登录、设备或 SQL。</p>
    <Host scope={{ siteId: seed.siteId, channel: config.pin ? "pin" : config.onsite ? "onsite" : "self", authUserId: config.pin ? null : config.other ? seed.other : seed.auth,
      terminalId: config.pin ? seed.terminal : null, workerNo: config.pin ? config.other ? "qa-other" : "qa-worker" : null }}
      workerId={seed.worker} employeeId={seed.employee} apiFetch={apiFetch} enabled={config.enabled} token={token} consumeToken={consumeToken}>
      <section aria-label="合成旧入口占位">旧入口占位（未挂真实旧客户端）</section>
    </Host></main>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness/>);
