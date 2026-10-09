// Synthetic loopback harness; real React Launcher/Workspace, no real Auth/SQL.
import { StrictMode, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import Launcher from "../../src/components/enterprise/MerchantAttendancePeriodClosureLauncher";
import type { AttendanceApiFetch } from "../../src/lib/merchantAttendanceSelfClient";
declare const __CONTINUATION_SEED__: { siteId: string; owner: string; other: string; workerId: string; fromDate: string; throughDate: string };
type Config = { other: boolean; enabled: boolean; continuation: boolean; shown: boolean; mount: number };
declare global { interface Window { __continuationHarness: { configure(p: Partial<Config>): void; visibility(hidden: boolean): void;
  holdNext(): void; release(): void; snapshot(): { calls: number; held: boolean; mockedData: true; actualSql: false }; }; } }
const seed = __CONTINUATION_SEED__;
function Harness() {
  const [config, setConfig] = useState<Config>(() => ({ other: false, enabled: sessionStorage.getItem("qa-disabled") !== "1", continuation: sessionStorage.getItem("qa-disabled") !== "1", shown: true, mount: 0 }));
  const guard = useRef<(() => boolean) | null>(null), calls = useRef(0), held = useRef(false), next = useRef(false), release = useRef<(() => void) | null>(null);
  const configure = useCallback((p: Partial<Config>) => { flushSync(() => setConfig(c => ({ ...c, ...p }))); }, []);
  const registerLeaveGuard = useCallback((value: (() => boolean) | null) => { guard.current = value; }, []);
  const visibility = useCallback((hidden: boolean) => {
    Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: hidden ? "hidden" : "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  }, []);
  useLayoutEffect(() => { window.__continuationHarness = { configure, visibility, holdNext: () => { next.current = true; }, release: () => release.current?.(),
    snapshot: () => ({ calls: calls.current, held: held.current, mockedData: true, actualSql: false }) }; }, [configure, visibility]);
  const actor = config.other ? seed.other : seed.owner;
  const apiFetch = useMemo<AttendanceApiFetch>(() => async (path, init) => {
    const url = new URL(path, location.origin);
    if (url.origin !== location.origin || url.pathname !== "/api/merchant-enterprise/attendance/period-closures-v2" || init?.method !== "GET") throw Error("continuation_qa_route_refused");
    calls.current++; const delay = next.current; next.current = false;
    const response = await fetch(url.href, { ...init, credentials: "omit", redirect: "error", headers: { ...init.headers,
      "x-continuation-qa-actor": actor, "x-continuation-qa-enabled": config.enabled && config.continuation ? "1" : "0" } });
    if (delay) { held.current = true; await new Promise<void>(resolve => { release.current = resolve; }); held.current = false; release.current = null; }
    return response;
  }, [actor, config.enabled, config.continuation]);
  return <main className="qa-main space-y-4"><header className="rounded border bg-amber-50 p-3"><h1 className="text-xl font-bold">周期长期续办 · 合成浏览器验收</h1>
    <p>真实 React 页面；身份、周期、版本与回执均为合成 DTO，不代表数据库、真实授权或生产验收。</p>
    <button type="button" onClick={() => { if (!guard.current || guard.current()) configure({ shown: false }); }}>离开合成宿主</button></header>
    {config.shown && <Launcher key={config.mount} siteId={seed.siteId} access="owner" actorId={actor} workerId={seed.workerId} fromDate={seed.fromDate} throughDate={seed.throughDate}
      apiFetch={apiFetch} enabled={config.enabled} continuationEnabled={config.continuation} registerLeaveGuard={registerLeaveGuard}/>}</main>;
}
createRoot(document.getElementById("qa-root")!).render(<StrictMode><Harness/></StrictMode>);
