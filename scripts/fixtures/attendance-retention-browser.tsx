// Actual React UI with synthetic actor headers and a loopback-only transport.
import { StrictMode, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import RetentionLauncher from "../../src/components/enterprise/MerchantAttendanceRetentionLauncher";
import type { AttendanceApiFetch } from "../../src/lib/merchantAttendanceSelfClient";
declare const __RETENTION_SEED__: { siteId: string; owner: string; other: string; recordId: string; at: string };
type Config = { other: boolean; enabled: boolean; shown: boolean; mount: number };
declare global { interface Window { __retentionHarness: { configure(value: Partial<Config>): void; visibility(hidden: boolean): void;
  snapshot(): { syntheticOnly: true; calls: { method: string; path: string }[] }; }; } }
const seed = __RETENTION_SEED__;
function Harness() {
  const [config, setConfig] = useState<Config>({ other: false, enabled: false, shown: true, mount: 0 });
  const calls = useRef<{ method: string; path: string }[]>([]);
  const configure = useCallback((value: Partial<Config>) => { flushSync(() => setConfig(c => ({ ...c, ...value }))); }, []);
  const visibility = useCallback((value: boolean) => {
    Object.defineProperty(document, "hidden", { configurable: true, value });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: value ? "hidden" : "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  }, []);
  useLayoutEffect(() => { window.__retentionHarness = { configure, visibility, snapshot: () => ({ syntheticOnly: true, calls: [...calls.current] }) }; }, [configure, visibility]);
  const actor = config.other ? seed.other : seed.owner;
  const apiFetch = useMemo<AttendanceApiFetch>(() => async (path, init) => {
    const url = new URL(path, location.origin), method = init?.method ?? "GET";
    if (url.origin !== location.origin || !["/api/merchant-enterprise/attendance/retention", "/api/merchant-enterprise/attendance/admin",
      "/api/merchant-enterprise/attendance/period-closures"].includes(url.pathname)) throw Error("retention_qa_route_refused");
    calls.current.push({ method, path });
    return fetch(url.href, { ...init, credentials: "omit", redirect: "error", headers: { ...init?.headers,
      "x-retention-qa-actor": actor, "x-retention-qa-enabled": config.enabled ? "1" : "0" } });
  }, [actor, config.enabled]);
  return <main className="qa-main space-y-4"><header className="rounded border bg-amber-50 p-3">
    <h1 className="text-xl font-bold">C23 · 资料保留合成浏览器验收</h1>
    <p>真实 React Launcher/Panel，合成元数据、负责人身份与内存 HTTP。没有数据库、真实账号、生产数据或删除行为；不代表 SQL/Auth 验证。</p>
    <p className="break-all">合成历史事件：{seed.recordId} · 新写{config.enabled ? "开" : "关"}</p>
  </header>{config.shown && <RetentionLauncher key={config.mount} siteId={seed.siteId} actorId={actor} enabled={config.enabled} apiFetch={apiFetch}/>}</main>;
}
createRoot(document.getElementById("qa-root")!).render(<StrictMode><Harness/></StrictMode>);
