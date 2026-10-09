// Actual React component; explicitly synthetic identities/HTTP ledger.
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import OutageLauncher from "../../src/components/enterprise/MerchantAttendanceOutageLauncher";
import { OUTAGE_RELATIONS_MODEL as m, outageRelationsModelId } from "./attendance-outage-relations-model";
import type { AttendanceApiFetch } from "../../src/lib/merchantAttendanceSelfClient";

type Config = { access: "owner" | "self"; other: boolean; enabled: boolean; mount: number; shown: boolean };
type Call = { method: string; path: string; status: number | "network-error" };
declare global { interface Window { __outageRelationsHarness: {
  configure(value: Partial<Omit<Config, "mount">>): void; visibility(hidden: boolean): void;
  armDrop(): void; armDelay(): void; snapshot(): { calls: Call[]; pageErrors: string[]; syntheticOnly: true };
} } }
function Harness() {
  const [config, setConfig] = useState<Config>({ access: "owner", other: false, enabled: false, mount: 0, shown: true });
  const [calls, setCalls] = useState<Call[]>([]), [notice, setNotice] = useState("尚无请求。组件初始化不读取 HTTP。");
  const drop = useRef(false), delay = useRef(false), log = useRef<Call[]>([]), errors = useRef<string[]>([]), transportEpoch = useRef(0);
  const configure = useCallback((value: Partial<Config>) => { transportEpoch.current++; flushSync(() => { setCalls([]); setConfig(c => ({ ...c, ...value })); }); }, []);
  const visibility = useCallback((hidden: boolean) => {
    transportEpoch.current++; setCalls([]);
    Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: hidden ? "hidden" : "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    setNotice(hidden ? "已触发合成 visibilitychange(hidden)，不是实际浏览器切换标签页。" : "已触发合成 visibilitychange(visible)，须明确重新读取。");
  }, []);
  useLayoutEffect(() => {
    window.__outageRelationsHarness = { configure, visibility, armDrop: () => { drop.current = true; }, armDelay: () => { delay.current = true; },
      snapshot: () => ({ calls: [...log.current], pageErrors: [...errors.current], syntheticOnly: true }) };
    const failure = (event: ErrorEvent) => { errors.current.push(event.message); };
    window.addEventListener("error", failure); return () => window.removeEventListener("error", failure);
  }, [configure, visibility]);
  const actor = config.other ? outageRelationsModelId(99) : config.access === "owner" ? m.owner : m.auth;
  const apiFetch = useMemo<AttendanceApiFetch>(() => async (path, init) => {
    const u = new URL(path, location.origin), method = init?.method ?? "GET", epoch = transportEpoch.current;
    if (u.origin !== location.origin || !["/api/merchant-enterprise/attendance/outages", "/api/merchant-enterprise/attendance/outage-relations"].includes(u.pathname)) throw Error("qa_route_refused");
    const lose = method === "POST" && drop.current, hold = method === "GET" && delay.current;
    if (lose) drop.current = false; if (hold) delay.current = false;
    const push = (status: Call["status"]) => { const call = { method, path, status }; log.current.push(call);
      if (epoch === transportEpoch.current) setCalls(current => [...current, call]); };
    try {
      const r = await fetch(u.href, { ...init, credentials: "omit", redirect: "error", headers: { ...init?.headers,
        "x-outage-relations-qa-actor": actor, "x-outage-relations-qa-enabled": config.enabled ? "1" : "0",
        ...(lose ? { "x-outage-relations-qa-drop": "1" } : {}), ...(hold ? { "x-outage-relations-qa-delay": "1" } : {}) } });
      push(r.status); return r;
    } catch (error) { push("network-error"); throw error; }
  }, [actor, config.enabled]);
  const controls = "rounded border bg-white px-3 py-2 text-sm";
  return <main className="qa-main space-y-4"><header className="space-y-3 rounded border bg-amber-50 p-3">
    <h1 className="text-xl font-bold">223 · 声明关系合成浏览器验收</h1>
    <p>真实 React Launcher → 父工作区 → RelationsPanel；合成 Auth、内存 HTTP 账本，无数据库、真实账号或生产数据。不代表实际 SQL／登录验收。</p>
    <p className="break-all">本声明：<code>{m.declaration}</code><br/>另一声明：<code>{m.related}</code></p>
    <p>当前：{config.other ? "其他身份（预期拒绝）" : config.access === "owner" ? "合成负责人" : "合成本人"}；新写：{config.enabled ? "开" : "关"}。</p>
    <div className="flex flex-wrap gap-2">
      <button className={controls} onClick={() => configure({ access: "owner", other: false })}>切换合成负责人</button>
      <button className={controls} onClick={() => configure({ access: "self", other: false })}>切换合成本人</button>
      <button className={controls} onClick={() => configure({ other: true })}>切换其他合成身份</button>
      <button className={controls} onClick={() => configure({ enabled: !config.enabled })}>{config.enabled ? "关闭合成新写" : "开启合成新写"}</button>
      <button className={controls} onClick={() => { drop.current = true; setNotice("下一次 POST 会先保存合成账本，再断开响应；不会自动重发。"); }}>下一次提交保存后丢响应</button>
      <button className={controls} onClick={() => { delay.current = true; setNotice("下一次 GET 将延迟 2 秒，供隐藏或切身份后检查迟到回复。"); }}>下一次读取延迟 2 秒</button>
      <button className={controls} onClick={() => visibility(true)}>合成隐藏页面</button>
      <button className={controls} onClick={() => visibility(false)}>合成恢复页面</button>
      <button className={controls} onClick={() => configure({ mount: config.mount + 1 })}>重新挂载（保留原号）</button>
      <button className={controls} onClick={() => configure({ shown: !config.shown })}>{config.shown ? "卸载实际子页" : "挂载实际子页"}</button>
    </div><p role="status">{notice}</p>
  </header>
    {config.shown && <OutageLauncher key={config.mount} siteId={m.siteId} actorId={actor} access={config.access}
      workerId={config.access === "owner" ? m.worker : null} enabled={false} printEnabled={false} relationsEnabled={config.enabled}
      apiFetch={apiFetch}/>} 
    <section aria-label="合成请求日志" className="rounded border p-3 text-xs"><h2>合成 HTTP 日志：{calls.length} 次（真实业务请求只有明确点击触发）</h2>
      <ol className="space-y-1">{calls.map((c, i) => <li key={i} className="break-all">{i + 1}. {c.method} {c.status} {c.path}</li>)}</ol>
    </section>
  </main>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness/>);
