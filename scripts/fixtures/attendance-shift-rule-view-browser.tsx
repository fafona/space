// Synthetic lifecycle shell around the actual156 child and existing SourcesPanel.
// Seed sources come from actual128; credentials/production Auth are not exercised.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { SourcesResponse } from "../../src/lib/merchantAttendanceSources";
import ShiftRuleReview from "../../src/components/enterprise/MerchantAttendanceShiftRuleReview";
import SourcesPanel from "../../src/components/enterprise/MerchantAttendanceSourcesPanel";

declare global {
  interface Window {
    __shiftRuleSeed: { source: SourcesResponse; emptySource: SourcesResponse; owner: string; otherOwner: string; flagOffRun: boolean };
  }
}
type BodyGate = { used: boolean; released: boolean; promise: Promise<void>; release: () => void };
const visibility = (value: "hidden" | "visible") => {
  Object.defineProperty(document, "hidden", { configurable: true, value: value === "hidden" });
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
  document.dispatchEvent(new Event("visibilitychange"));
};
function Harness() {
  const seed = window.__shiftRuleSeed;
  const [enabled, setEnabled] = useState(false), [mounted, setMounted] = useState(true), [mode, setMode] = useState("direct");
  const [source, setSource] = useState(seed.source), [ownerId, setOwner] = useState(seed.owner), [epoch, setEpoch] = useState(0);
  const [fetchGeneration, setFetchGeneration] = useState(0), [bodyPhase, setBodyPhase] = useState("idle");
  const bodyGate = useRef<BodyGate | null>(null);
  useLayoutEffect(() => () => bodyGate.current?.release(), []);
  const apiFetch = useMemo(() => async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers); headers.set("x-qa-owner", ownerId); headers.set("x-qa-fetch-generation", String(fetchGeneration));
    const response = await fetch(url, { ...init, headers, credentials: "omit" }), gate = bodyGate.current;
    if (!gate || gate.used || gate.released) return response;
    gate.used = true; const bytes = new Uint8Array(await response.arrayBuffer()); setBodyPhase("held");
    const body = new ReadableStream<Uint8Array>({ async start(controller) {
      await gate.promise; try { controller.enqueue(bytes); controller.close(); } catch { /* Invalidated reader was cancelled. */ }
    } });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  }, [ownerId, fetchGeneration]);
  const arm = () => {
    bodyGate.current?.release(); let release!: () => void;
    const gate: BodyGate = { used: false, released: false, promise: new Promise<void>(resolve => { release = resolve; }), release: () => undefined };
    gate.release = () => { gate.released = true; release(); }; bodyGate.current = gate; setBodyPhase("armed");
  };
  return <>
    <header className="qa-toolbar"><strong>隔离原班次依据验收 · 实际本地 SQL · 合成身份 · 非生产认证</strong><div className="qa-controls">
      <button type="button" data-testid="enable" onClick={() => setEnabled(true)}>开启独立验收</button>
      <button type="button" data-testid="disable" onClick={() => setEnabled(false)}>关闭独立验收</button>
      <button type="button" data-testid="parent" onClick={() => { setMode("parent"); setMounted(true); }}>打开实际资料核查父组件</button>
      <button type="button" data-testid="direct" onClick={() => setMode("direct")}>打开独立子组件</button>
      <button type="button" data-testid="source-change" onClick={() => setSource(value => structuredClone(value))}>替换同范围资料引用</button>
      <button type="button" data-testid="worker-change" onClick={() => setSource(seed.emptySource)}>切换另一实际空档案</button>
      <button type="button" data-testid="worker-restore" onClick={() => setSource(seed.source)}>恢复实际原档案</button>
      <button type="button" data-testid="owner-change" onClick={() => setOwner(seed.otherOwner)}>切换负责人身份</button>
      <button type="button" data-testid="owner-restore" onClick={() => setOwner(seed.owner)}>恢复负责人身份</button>
      <button type="button" data-testid="epoch" onClick={() => setEpoch(value => value + 1)}>递增授权代次</button>
      <button type="button" data-testid="api-change" onClick={() => setFetchGeneration(value => value + 1)}>替换请求函数</button>
      <button type="button" data-testid="hide" onClick={() => visibility("hidden")}>隐藏</button>
      <button type="button" data-testid="show" onClick={() => visibility("visible")}>显示</button>
      <button type="button" data-testid="pagehide" onClick={() => window.dispatchEvent(new Event("pagehide"))}>pagehide</button>
      <button type="button" data-testid="pageshow" onClick={() => window.dispatchEvent(new Event("pageshow"))}>pageshow</button>
      <button type="button" data-testid="unmount" onClick={() => setMounted(false)}>卸载</button>
      <button type="button" data-testid="mount" onClick={() => setMounted(true)}>挂载</button>
      <button type="button" data-testid="arm-body" onClick={arm}>延迟真实响应体</button>
      <button type="button" data-testid="release-body" onClick={() => { bodyGate.current?.release(); setBodyPhase("released"); }}>释放真实响应体</button>
      <output data-testid="body-phase">{bodyPhase}</output>
    </div></header>
    <main className="qa-main">{mounted && (mode === "parent"
      ? <SourcesPanel key={`parent:${epoch}`} siteId={source.siteId} ownerId={ownerId} workerId={source.worker.workerId} apiFetch={apiFetch} onClose={() => setMounted(false)}/>
      : <ShiftRuleReview key={`direct:${epoch}`} source={source} ownerId={ownerId} apiFetch={apiFetch} enabled={enabled ? true : seed.flagOffRun ? undefined : false}/>)}
      {!mounted && <p data-testid="closed">核查组件已关闭</p>}
    </main>
  </>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness/>);
