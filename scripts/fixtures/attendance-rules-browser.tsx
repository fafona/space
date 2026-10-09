// Isolated synthetic owner/target controls. Uses the real candidate ledger UI.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import RulesLauncher from "../../src/components/enterprise/MerchantAttendanceRulesLauncher";

const owner = "00000000-0000-4000-8000-000000000099";
const otherOwner = "00000000-0000-4000-8000-000000000098";
const group = "00000000-0000-4000-8000-000000007001";
const apiFetch = (url: string, init?: RequestInit) => fetch(url, { ...init, credentials: "omit" });

function visibility(value: "hidden" | "visible") {
  Object.defineProperty(document, "hidden", { configurable: true, value: value === "hidden" });
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
  document.dispatchEvent(new Event("visibilitychange"));
}

function Harness() {
  const [enabled, setEnabled] = useState(false), [mounted, setMounted] = useState(true);
  const [groupId, setGroupId] = useState<string | null>(null), [ownerId, setOwnerId] = useState(owner);
  const [authorizationEpoch, setAuthorizationEpoch] = useState(0);
  return <>
    <header className="qa-toolbar">
      <strong>隔离候选规则版本验收 · 合成身份与隔离数据库 · 不连接生产或实际认证</strong>
      <div className="qa-controls">
        <button type="button" onClick={() => setEnabled(true)}>开启验收入口</button>
        <label>验收目标<select aria-label="验收目标" value={groupId ?? "enterprise"} onChange={event => setGroupId(event.target.value === "enterprise" ? null : event.target.value)}>
          <option value="enterprise">企业候选层</option><option value={group}>合成考勤组</option>
        </select></label>
        <label>验收身份<select aria-label="验收身份" value={ownerId} onChange={event => setOwnerId(event.target.value)}>
          <option value={owner}>当前合成 owner</option><option value={otherOwner}>另一合成身份</option>
        </select></label>
        <button type="button" onClick={() => visibility("hidden")}>隐藏验收文档</button>
        <button type="button" onClick={() => visibility("visible")}>显示验收文档</button>
        <button type="button" onClick={() => setMounted(false)}>卸载验收规则</button>
        <button type="button" onClick={() => setMounted(true)}>重挂验收规则</button>
        <button type="button" onClick={() => setAuthorizationEpoch(value => value + 1)}>递增验收授权代次</button>
      </div>
    </header>
    <main className="qa-main">{mounted
      ? <RulesLauncher key={authorizationEpoch} siteId="99990001" ownerId={ownerId} groupId={groupId} apiFetch={apiFetch} enabled={enabled ? true : undefined}/>
      : <p>验收规则组件已卸载</p>}
    </main>
  </>;
}

createRoot(document.getElementById("qa-root")!).render(<Harness/>);
