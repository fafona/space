import { createRoot } from "react-dom/client";
import { useState } from "react";
import MerchantCatalogManagerPanel from "../../src/components/admin/MerchantCatalogManagerPanel";
import MerchantCustomerManager from "../../src/components/admin/MerchantCustomerManager";

function Harness() {
  const [site, setSite] = useState("qa-merchant-a");
  const [view, setView] = useState("catalog");
  const [dark, setDark] = useState(false);
  return <>
    <aside className="qa-toolbar">
      <strong>隔离测试：1000 件模拟商品 / 123 位模拟客户，不连接真实后台，禁止写入</strong>
      <div className="flex flex-wrap gap-3 py-3">
        <button type="button" onClick={() => setView("catalog")}>商品目录</button>
        <button type="button" onClick={() => setView("customers")}>客户列表</button>
        <button type="button" onClick={() => setSite(site === "qa-merchant-a" ? "qa-merchant-b" : "qa-merchant-a")}>切换模拟商户（{site}）</button>
        <button type="button" onClick={() => setDark(!dark)}>切换明暗</button>
      </div>
    </aside>
    <main className="p-4">
      {view === "catalog" ? <MerchantCatalogManagerPanel siteId={site} darkMode={dark} /> : <MerchantCustomerManager siteId={site} siteName="模拟商户" />}
    </main>
  </>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness />);
