/* eslint-disable @next/next/no-location-assign-relative-destination -- Standalone React QA page: reload intentionally clears the native module cache; no Next router is mounted. */
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import MerchantCustomerManager from "../../src/components/admin/MerchantCustomerManager";
import { GLOBAL_TOAST_EVENT, type GlobalToastPayload } from "../../src/lib/globalToast";

function CustomerPerformanceHarness() {
  const [siteId, setSiteId] = useState("qa-merchant-a");
  const [mounted, setMounted] = useState(true);
  const [toasts, setToasts] = useState<string[]>([]);
  const [report, setReport] = useState("");

  useEffect(() => {
    const receiveToast = (event: Event) => {
      const detail = (event as CustomEvent<GlobalToastPayload>).detail;
      setToasts((previous) => [...previous.slice(-4), detail.message]);
    };
    window.addEventListener(GLOBAL_TOAST_EVENT, receiveToast);
    return () => window.removeEventListener(GLOBAL_TOAST_EVENT, receiveToast);
  }, []);

  return (
    <>
      <aside className="qa-toolbar" aria-label="Isolated QA controls">
        <strong>隔离测试 · 全部为模拟客户 · 不连接真实后台</strong>
        <p>真实客户组件与 Tailwind 工具类；不是完整后台视觉验收，也不是容量测试。保存/确认导入被测试服务器拒绝。</p>
        <div className="qa-actions">
          <button type="button" onClick={() => setSiteId((current) => current === "qa-merchant-a" ? "qa-merchant-b" : "qa-merchant-a")}>
            切换模拟商户（当前 {siteId.endsWith("a") ? "A" : "B"}）
          </button>
          <button type="button" onClick={() => setMounted((current) => !current)}>
            {mounted ? "卸载客户组件" : "挂载客户组件"}
          </button>
          <button type="button" onClick={() => {
            void fetch("/__qa/report").then((response) => response.json()).then((value) => setReport(JSON.stringify(value, null, 2)));
          }}>
            查看加载记录
          </button>
          <a href="/__qa/customers.csv" download>下载模拟导入 CSV</a>
          <button type="button" onClick={() => window.location.assign("/")}>普通加载（重载）</button>
          <button type="button" onClick={() => window.location.assign("/?slowWorkbook=1")}>工具加载延迟 3 秒（重载）</button>
        </div>
        <div aria-live="polite" className="qa-toasts">
          {toasts.map((message, index) => <p key={`${index}-${message}`}>{message}</p>)}
        </div>
        {report ? <details open><summary>加载记录：初始静态图与 XLSX 延迟块</summary><pre>{report}</pre></details> : null}
      </aside>
      <main className="qa-main">
        {mounted ? <MerchantCustomerManager siteId={siteId} siteName={`模拟商户 ${siteId.endsWith("a") ? "A" : "B"}`} /> : <p>客户组件已卸载；尚未完成的文件/模板准备不应下载或提示结果。</p>}
      </main>
    </>
  );
}

const root = document.getElementById("qa-root");
if (!root) throw new Error("qa_root_missing");
createRoot(root).render(<CustomerPerformanceHarness />);
