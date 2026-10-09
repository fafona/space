// Synthetic identity/lifecycle controls around the real capture feature. This
// is not full Admin rendering or real authentication; no production is used.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import RuleCapturesLauncher from "../../src/components/enterprise/MerchantAttendanceRuleCapturesLauncher";

const owner = "00000000-0000-4000-8000-000000000099", otherOwner = "00000000-0000-4000-8000-000000000098";
const worker = "00000000-0000-4000-8000-000000000201", secondWorker = "00000000-0000-4000-8000-000000000202";
type BodyGate = { used: boolean; released: boolean; promise: Promise<void>; release: () => void };
function visibility(value: "hidden" | "visible") {
  Object.defineProperty(document, "hidden", { configurable: true, value: value === "hidden" });
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
  document.dispatchEvent(new Event("visibilitychange"));
}

function Harness() {
  const [enabled, setEnabled] = useState(false), [mounted, setMounted] = useState(true);
  const [ownerId, setOwnerId] = useState(owner), [workerId, setWorkerId] = useState(worker);
  const [epoch, setEpoch] = useState(0), [fetchGeneration, setFetchGeneration] = useState(0), [bodyPhase, setBodyPhase] = useState("idle");
  const bodyGate = useRef<BodyGate | null>(null);
  useLayoutEffect(() => () => bodyGate.current?.release(), []);
  const apiFetch = useMemo(() => async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers); headers.set("x-qa-owner", ownerId); headers.set("x-qa-fetch-generation", String(fetchGeneration));
    const response = await fetch(url, { ...init, headers, credentials: "omit" }), gate = bodyGate.current;
    if (!gate || gate.used || gate.released) return response;
    gate.used = true;
    // Delay only actual handler/SQL bytes, delivered as a real stream. The
    // extra stream intentionally ignores network abort until its local release.
    const bytes = new Uint8Array(await response.arrayBuffer()); setBodyPhase("held");
    const body = new ReadableStream<Uint8Array>({ async start(controller) {
      await gate.promise; try { controller.enqueue(bytes); controller.close(); } catch { /* Reader already cancelled. */ }
    } });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  }, [ownerId, fetchGeneration]);
  const armBody = () => {
    bodyGate.current?.release(); let release!: () => void;
    const gate: BodyGate = { used: false, released: false, promise: new Promise<void>(resolve => { release = resolve; }), release: () => undefined };
    gate.release = () => { gate.released = true; release(); }; bodyGate.current = gate; setBodyPhase("armed");
  };
  return <>
    <header className="qa-toolbar"><strong>隔离来源留存页面验收 · 合成身份与数据 · 非生产认证</strong><div className="qa-controls">
      <button type="button" data-testid="enable" onClick={() => setEnabled(true)}>开启验收入口</button>
      <select aria-label="验收人员" data-testid="worker" value={workerId} onChange={event => setWorkerId(event.target.value)}>
        <option value={worker}>合成人员甲</option><option value={secondWorker}>合成人员乙</option>
      </select>
      <select aria-label="验收身份" data-testid="owner" value={ownerId} onChange={event => setOwnerId(event.target.value)}>
        <option value={owner}>当前合成负责人</option><option value={otherOwner}>另一合成身份</option>
      </select>
      <button type="button" data-testid="hide" onClick={() => visibility("hidden")}>隐藏验收页面</button>
      <button type="button" data-testid="show" onClick={() => visibility("visible")}>显示验收页面</button>
      <button type="button" data-testid="pagehide" onClick={() => window.dispatchEvent(new Event("pagehide"))}>验收 pagehide</button>
      <button type="button" data-testid="pageshow" onClick={() => window.dispatchEvent(new Event("pageshow"))}>验收 pageshow</button>
      <button type="button" data-testid="unmount" onClick={() => setMounted(false)}>卸载验收入口</button>
      <button type="button" data-testid="mount" onClick={() => setMounted(true)}>挂载验收入口</button>
      <button type="button" data-testid="epoch" onClick={() => setEpoch(value => value + 1)}>递增授权代次</button>
      <button type="button" data-testid="api-change" onClick={() => setFetchGeneration(value => value + 1)}>替换请求函数</button>
      <button type="button" data-testid="arm-body" onClick={armBody}>延迟下次真实响应体</button>
      <button type="button" data-testid="release-body" onClick={() => { bodyGate.current?.release(); setBodyPhase("released"); }}>释放真实响应体</button>
      <output data-testid="body-phase">{bodyPhase}</output><output data-testid="fetch-generation">{fetchGeneration}</output>
    </div></header>
    <main className="qa-main">{mounted
      ? <RuleCapturesLauncher key={epoch} siteId="99990001" ownerId={ownerId} workerId={workerId} apiFetch={apiFetch} enabled={enabled ? true : undefined}/>
      : <p>留存验收组件已卸载</p>}</main>
  </>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness/>);
