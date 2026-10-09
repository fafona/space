// Local172 lifecycle controls around actual existing owner components. Source
// seed and every HTTP response come from the same root-owned SQL namespace.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { SourcesResponse } from "../../src/lib/merchantAttendanceSources";
import SourcesPanel from "../../src/components/enterprise/MerchantAttendanceSourcesPanel";
import ShiftCheck from "../../src/components/enterprise/MerchantAttendanceShiftCheck";
import PlanCoverage from "../../src/components/enterprise/MerchantAttendancePlanCoverage";

declare global { interface Window { __planAdoptionViewSeed: { source: SourcesResponse; owner: string; otherOwner: string } } }
type Gate = { used: boolean; promise: Promise<void>; release: () => void };
const visibility = (hidden: boolean) => {
  Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: hidden ? "hidden" : "visible" });
  document.dispatchEvent(new Event("visibilitychange"));
};
function Harness() {
  const seed = window.__planAdoptionViewSeed;
  const [source, setSource] = useState(seed.source), [owner, setOwner] = useState(seed.owner), [epoch, setEpoch] = useState(0);
  const [mounted, setMounted] = useState(true), [parent, setParent] = useState(true), [generation, setGeneration] = useState(0);
  const [adoption, setAdoption] = useState<boolean | undefined>(undefined), [bodyPhase, setBodyPhase] = useState("idle"), gate = useRef<Gate | null>(null);
  useLayoutEffect(() => () => gate.current?.release(), []);
  const apiFetch = useMemo(() => async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers); headers.set("x-qa-owner", owner); headers.set("x-qa-generation", String(generation));
    const response = await fetch(url, { ...init, headers, credentials: "omit" }), held = gate.current;
    if (!held || held.used) return response;
    held.used = true; const bytes = new Uint8Array(await response.arrayBuffer()); setBodyPhase("held");
    return new Response(new ReadableStream<Uint8Array>({ async start(controller) {
      await held.promise; try { controller.enqueue(bytes); controller.close(); } catch { /* canceled reader */ }
    } }), { status: response.status, statusText: response.statusText, headers: response.headers });
  }, [owner, generation]);
  const arm = () => { gate.current?.release(); let release!: () => void;
    const promise = new Promise<void>(resolve => { release = resolve; }); gate.current = { used: false, promise, release }; setBodyPhase("armed"); };
  return <><header className="qa-toolbar"><strong>负责人固定采用引用 · 实际父页面／本地 SQL · 合成认证 · 非生产</strong><div className="qa-controls">
    <button data-testid="parent" onClick={() => { setParent(true); setMounted(true); }}>真实资料父页面</button>
    <button data-testid="direct" onClick={() => { setParent(false); setMounted(true); }}>原两个子组件生命周期验收</button>
    <button data-testid="source-change" onClick={() => setSource(value => structuredClone(value))}>替换来源引用</button>
    <button data-testid="owner-change" onClick={() => setOwner(seed.otherOwner)}>切换负责人</button>
    <button data-testid="owner-restore" onClick={() => setOwner(seed.owner)}>恢复负责人</button>
    <button data-testid="api-change" onClick={() => setGeneration(value => value + 1)}>替换请求函数</button>
    <button data-testid="epoch" onClick={() => setEpoch(value => value + 1)}>授权代次变化</button>
    <button data-testid="reference-off" onClick={() => setAdoption(false)}>关闭新引用读取</button>
    <button data-testid="reference-on" onClick={() => setAdoption(true)}>开启新引用读取</button>
    <button data-testid="hide" onClick={() => visibility(true)}>隐藏</button><button data-testid="show" onClick={() => visibility(false)}>显示</button>
    <button data-testid="pagehide" onClick={() => window.dispatchEvent(new Event("pagehide"))}>pagehide</button>
    <button data-testid="pageshow" onClick={() => window.dispatchEvent(new Event("pageshow"))}>pageshow</button>
    <button data-testid="unmount" onClick={() => setMounted(false)}>卸载</button><button data-testid="mount" onClick={() => setMounted(true)}>挂载</button>
    <button data-testid="arm-body" onClick={arm}>延迟真实响应体</button>
    <button data-testid="release-body" onClick={() => { gate.current?.release(); setBodyPhase("released"); }}>释放真实响应体</button>
    <output data-testid="body-phase">{bodyPhase}</output>
  </div></header><main className="qa-main">{mounted && (parent
    ? <SourcesPanel key={`parent:${epoch}`} siteId={source.siteId} workerId={source.worker.workerId} ownerId={owner} apiFetch={apiFetch} onClose={() => setMounted(false)}/>
    : <div key={`direct:${epoch}`} className="min-w-0 space-y-4"><ShiftCheck source={source} ownerId={owner} apiFetch={apiFetch} enabled adoptionEnabled={adoption}/>
      <PlanCoverage source={source} ownerId={owner} apiFetch={apiFetch} enabled adoptionEnabled={adoption}/></div>)}
    {!mounted && <p data-testid="closed">资料已关闭</p>}</main></>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness/>);
