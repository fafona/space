// Synthetic Auth host, not the Supabase-authenticated recovery Page.
import { StrictMode, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import RecoveryPanel from "../../src/components/enterprise/MerchantAttendanceDelegationRecoveryPanel";
import type { AttendanceApiFetch } from "../../src/lib/merchantAttendanceSelfClient";

declare const __PERIOD_RECOVERY_SEED__: { authUserId: string; otherAuthUserId: string; endpoints: string[] };
declare global { interface Window { __periodRecoveryHarness: {
  configure(other: boolean): void; holdNext(): void; release(): void;
  snapshot(): { calls: number; held: boolean; featureFlagsEnabled: false };
}; } }
const seed = __PERIOD_RECOVERY_SEED__;
function Harness() {
  const [identity, setIdentity] = useState({ other: false, generation: 0 }), calls = useRef(0), hold = useRef(false), held = useRef(false);
  const release = useRef<(() => void) | null>(null), scope = useRef({ other: false, generation: 0 });
  const { other, generation } = identity, authUserId = other ? seed.otherAuthUserId : seed.authUserId;
  const isCurrentAuth = useMemo(() => () => scope.current.generation === generation && scope.current.other === other, [generation, other]);
  const configure = useCallback((value: boolean) => {
    if (scope.current.other === value) return;
    const next = { other: value, generation: scope.current.generation + 1 };
    // Revoke old requests synchronously, including A -> B -> A transitions.
    scope.current = next;
    flushSync(() => setIdentity(next));
  }, []);
  useLayoutEffect(() => { window.__periodRecoveryHarness = { configure, holdNext: () => { hold.current = true; },
    release: () => release.current?.(), snapshot: () => ({ calls: calls.current, held: held.current, featureFlagsEnabled: false }) }; }, [configure]);
  const apiFetch = useMemo<AttendanceApiFetch>(() => async (path, init) => {
    const url = new URL(path, location.origin);
    if (url.origin !== location.origin || !seed.endpoints.includes(url.pathname) || init?.method !== "GET" || init.body != null)
      throw Error("period_recovery_qa_get_only");
    const delay = hold.current; hold.current = false; calls.current++;
    const response = await fetch(url.href, { ...init, credentials: "omit", redirect: "error", headers: { ...init.headers,
      "x-period-recovery-qa-auth": authUserId } });
    if (!delay) return response;
    // A genuine strict server reply is held after headers and the first byte.
    // This is a controlled browser transport fault, not a SQL/network claim.
    const bytes = new Uint8Array(await response.arrayBuffer());
    let canceled = false;
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 1)); held.current = true;
        release.current = () => { held.current = false; release.current = null;
          if (!canceled) { controller.enqueue(bytes.slice(1)); controller.close(); } };
      }, cancel() { canceled = true; },
    }), { status: response.status, headers: response.headers });
  }, [authUserId]);
  return <main className="qa-main space-y-3"><header className="rounded border bg-amber-50 p-3">
    <h1 className="text-lg font-bold">独立原编号恢复 · 合成浏览器验收</h1>
    <p className="text-sm">实际恢复组件、聚合器和客户端；身份与回执为合成资料，全部功能开关关闭。未测试真实登录或数据库。</p>
  </header>{/* The actual Page also keys its Panel by verified Auth generation. */}
    <RecoveryPanel key={generation} authUserId={authUserId} apiFetch={apiFetch} isCurrentAuth={isCurrentAuth}/></main>;
}
createRoot(document.getElementById("qa-root")!).render(<StrictMode><Harness/></StrictMode>);
