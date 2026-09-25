import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import BlockRenderer from "../../src/components/blocks/BlockRenderer";
import type { Block } from "../../src/data/homeBlocks";

type RequestNote = { method: string; request: string; status?: number; bytes?: number; held?: boolean };
const notes: RequestNote[] = [];
let holdBodies = false;
const releases: Array<() => void> = [];
const notify = () => window.dispatchEvent(new Event("qa-catalog-metrics"));
const nativeFetch = window.fetch.bind(window);
// Preserve real transport and response bodies. Deliberately delay only their
// JSON completion to exercise the real coordinator's post-decode generation guard.
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (url.origin !== location.origin) throw new Error("QA outbound browser request forbidden");
  const catalog = url.pathname === "/api/orders/catalog/public" || url.pathname === "/api/orders/catalog/public/batch";
  const note: RequestNote = { method: init?.method ?? "GET", request: typeof init?.body === "string" ? init.body : url.search };
  if (catalog) { notes.push(note); notify(); }
  const response = await nativeFetch(input, { ...init, credentials: "omit" });
  if (catalog) {
    note.status = response.status;
    Object.defineProperty(response, "json", { value: async () => {
      const text = await response.text();
      note.bytes = new TextEncoder().encode(text).byteLength;
      const data: unknown = JSON.parse(text);
      if (holdBodies) {
        note.held = true; notify();
        await new Promise<void>((resolve) => releases.push(() => { note.held = false; resolve(); }));
      }
      notify(); return data;
    } });
    notify();
  }
  return response;
};

function product(id: string, heading: string, opened = false): Block {
  return { id, type: "product", props: {
    heading, products: [{ id: "p1", code: "LEGACY", name: "旧发布占位商品（应被运营目录替换）", price: "1" }],
    productSearchEnabled: true, productLayoutPreset: "grid-3", productShowDescription: true, productItemsPerPage: 3,
    productContainerMode: "paged", productImageSize: 70, productCardHeight: 180,
    productCartButtonPosition: "bottom", bgColor: "#ffffff", ...(opened ? { blockOpenMode: "button" as const } : {}),
  } };
}
function Harness() {
  const [site, setSite] = useState("99990001");
  const [page, setPage] = useState("page-a");
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");
  const [batch, setBatch] = useState(true);
  const [epoch, setEpoch] = useState(0);
  const [tick, setTick] = useState(0);
  const [, repaintMetrics] = useState(0);
  const [error, setError] = useState(false);
  const [serverMetrics, setServerMetrics] = useState("");
  const [mounted, setMounted] = useState(true);
  useEffect(() => {
    const handler = () => repaintMetrics((value) => value + 1);
    window.addEventListener("qa-catalog-metrics", handler);
    return () => window.removeEventListener("qa-catalog-metrics", handler);
  }, []);
  const blocks: Block[] = page === "page-a" ? [
    product("inline-a", "内联商品 A"), product("inline-b", "内联商品 B"),
    { id: "open-products", type: "button", props: { buttonLabel: "打开商品弹层", buttonJumpTarget: "block:modal-products", blockWidth: 320, blockHeight: 48, bgColor: "#dbeafe" } },
    product("modal-products", "弹层商品", true),
  ] : [product("inline-a", "另一页同 ID 商品 A"), product("inline-c", "内联商品 C")];
  return <>
    <aside className="qa-toolbar">
      <strong>隔离真实组件测试 · 两个合成商户 · 内存通讯存储 · 禁止生产连接及所有业务写入</strong>
      <div className="qa-controls">
        <button onClick={() => setPage("page-a")} aria-pressed={page === "page-a"}>Page A</button>
        <button onClick={() => setPage("page-b")} aria-pressed={page === "page-b"}>Page B</button>
        <button onClick={() => setViewport("desktop")} aria-pressed={viewport === "desktop"}>Desktop</button>
        <button onClick={() => setViewport("mobile")} aria-pressed={viewport === "mobile"}>Mobile</button>
        <button onClick={() => setSite((value) => value === "99990001" ? "99990002" : "99990001")}>切换模拟商户</button>
        <button onClick={() => setTick((value) => value + 1)}>无关重绘</button>
        <button onClick={() => { setBatch((value) => !value); setEpoch((value) => value + 1); }}>切换旧 GET / 批量 POST</button>
        <button onClick={() => setEpoch((value) => value + 1)}>重新挂载本页</button>
        <button onClick={() => setMounted((value) => !value)}>{mounted ? "卸载区块" : "挂载区块"}</button>
      </div>
      <div className="qa-controls">
        <button onClick={() => { holdBodies = true; notify(); }}>暂停目录 JSON 完成</button>
        <button onClick={() => { releases.pop()?.(); notify(); }}>仅释放最新 JSON</button>
        <button onClick={() => { releases.shift()?.(); notify(); }}>仅释放最旧 JSON</button>
        <button onClick={() => { holdBodies = false; releases.splice(0).forEach((release) => release()); notify(); }}>释放全部旧 JSON</button>
        <button onClick={async () => { const next = !error; await fetch(`/qa/control?error=${next ? "1" : "0"}`); setError(next); }}>503 错误：{error ? "开" : "关"}</button>
        <button onClick={async () => setServerMetrics(JSON.stringify(await (await fetch("/qa/metrics")).json(), null, 2))}>读取服务器计数</button>
        <button onClick={async () => { const result = await fetch("/api/orders", { method: "POST", body: "{}" }); setServerMetrics(`测试写入被拒绝：HTTP ${result.status}`); }}>验证写入被拒绝</button>
      </div>
      <div className="qa-status" data-testid="qa-scope">商户 {site} · {page} · {viewport} · {batch ? "POST batch" : "GET baseline"} · 重绘 {tick} · JSON 暂停 {String(holdBodies)} · 等待释放 {releases.length}</div>
      <div className="qa-metrics" data-testid="qa-request-metrics">{notes.map((note, index) => `${index + 1}. ${note.method} ${note.status ?? "pending"} bytes=${note.bytes ?? "pending"} held=${Boolean(note.held)} ${note.request}`).join("\n")}</div>
      {serverMetrics ? <details open><summary>服务器计数 / 写入结果</summary><pre className="qa-metrics">{serverMetrics}</pre></details> : null}
    </aside>
    <main className="qa-main" style={{ maxWidth: viewport === "mobile" ? 430 : 1050 }}>
      {mounted ? <BlockRenderer key={epoch} blocks={blocks} currentPageId={page} currentPageIndex={page === "page-a" ? 0 : 1}
        availablePages={[{ id: "page-a", name: "Page A" }, { id: "page-b", name: "Page B" }]} onNavigatePage={setPage}
        bookingSiteId={site} bookingSiteName="合成商户" bookingViewport={viewport} forceMobileViewport={viewport === "mobile"}
        productCartEnabled productCatalogBatchEnabled={batch} productCatalogPlanId="qa-plan" bookingInteractive /> : <p>区块已卸载</p>}
    </main>
  </>;
}
createRoot(document.getElementById("qa-root")!).render(<StrictMode><Harness /></StrictMode>);
