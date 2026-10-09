// Synthetic lifecycle controls around the real, default-off source-reader UI.
// The caller supplies the isolated database; this fixture owns no data or auth.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import SourcesLauncher from "../../src/components/enterprise/MerchantAttendanceSourcesLauncher";

const owner = "00000000-0000-4000-8000-000000000099";
const otherOwner = "00000000-0000-4000-8000-000000000098";
const worker = "00000000-0000-4000-8000-000000000201";
const otherWorker = "00000000-0000-4000-8000-000000000202";
const apiFetch = (url: string, init?: RequestInit) => fetch(url, { ...init, credentials: "omit" });

function visibility(value: "hidden" | "visible") {
  Object.defineProperty(document, "hidden", { configurable: true, value: value === "hidden" });
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
  document.dispatchEvent(new Event("visibilitychange"));
}

function Harness() {
  const [enabled, setEnabled] = useState(false), [mounted, setMounted] = useState(true);
  const [ownerId, setOwnerId] = useState(owner), [workerId, setWorkerId] = useState(worker);
  const [authorizationEpoch, setAuthorizationEpoch] = useState(0);
  return <>
    <header className="qa-toolbar">
      <strong>隔离资料核查验收 · 合成身份与数据库 · 非真实认证或生产访问</strong>
      <div className="qa-controls">
        <button type="button" onClick={() => setEnabled(true)}>开启验收入口</button>
        <label>验收身份<select aria-label="验收身份" value={ownerId} onChange={event => setOwnerId(event.target.value)}>
          <option value={owner}>当前合成负责人</option><option value={otherOwner}>其他合成身份</option>
        </select></label>
        <label>验收员工<select aria-label="验收员工" value={workerId} onChange={event => setWorkerId(event.target.value)}>
          <option value={worker}>当前合成员工</option><option value={otherWorker}>其他合成档案</option>
        </select></label>
        <button type="button" onClick={() => visibility("hidden")}>隐藏验收文档</button>
        <button type="button" onClick={() => visibility("visible")}>显示验收文档</button>
        <button type="button" onClick={() => window.dispatchEvent(new Event("pagehide"))}>触发验收 pagehide</button>
        <button type="button" onClick={() => setMounted(false)}>卸载验收资料</button>
        <button type="button" onClick={() => setMounted(true)}>重挂验收资料</button>
        <button type="button" onClick={() => setAuthorizationEpoch(value => value + 1)}>递增验收授权代次</button>
      </div>
    </header>
    <main className="qa-main">{mounted
      ? <SourcesLauncher key={authorizationEpoch} siteId="99990001" ownerId={ownerId} workerId={workerId} apiFetch={apiFetch} enabled={enabled ? true : undefined}/>
      : <p>验收资料组件已卸载</p>}
    </main>
  </>;
}

createRoot(document.getElementById("qa-root")!).render(<Harness/>);
