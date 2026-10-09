// Synthetic identity/lifecycle controls only. The launcher, panel and client are
// the real candidate feature; this is not full Admin or real-authentication E2E.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import PersonalRulesLauncher from "../../src/components/enterprise/MerchantAttendancePersonalRulesLauncher";

const owner = "00000000-0000-4000-8000-000000000099";
const otherOwner = "00000000-0000-4000-8000-000000000098";
const worker = "00000000-0000-4000-8000-000000000201";
const secondWorker = "00000000-0000-4000-8000-000000000202";

function visibility(value: "hidden" | "visible") {
  Object.defineProperty(document, "hidden", { configurable: true, value: value === "hidden" });
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
  document.dispatchEvent(new Event("visibilitychange"));
}

function Harness() {
  const [enabled, setEnabled] = useState(false), [mounted, setMounted] = useState(true);
  const [workerId, setWorkerId] = useState(worker), [ownerId, setOwnerId] = useState(owner);
  const [epoch, setEpoch] = useState(0);
  const [fetchGeneration, setFetchGeneration] = useState(0);
  const apiFetch = useMemo(() => (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers); headers.set("x-qa-fetch-generation", String(fetchGeneration));
    return fetch(url, { ...init, headers, credentials: "omit" });
  }, [fetchGeneration]);
  const restoreConfirm = useRef<(() => void) | null>(null);
  useLayoutEffect(() => () => restoreConfirm.current?.(), []);
  const changeFetchInsideNextConfirm = () => {
    restoreConfirm.current?.();
    const original = window.confirm;
    const restore = () => { if (window.confirm === hook) window.confirm = original; restoreConfirm.current = null; };
    const hook = (message?: string) => {
      restore();
      // Explicit synthetic re-entrancy, not a claim that a native dialog itself
      // changes dependencies. Site/owner/worker and both component keys remain.
      flushSync(() => setFetchGeneration(value => value + 1));
      return original(message);
    };
    restoreConfirm.current = restore; window.confirm = hook;
  };
  return <>
    <header className="qa-toolbar">
      <strong>隔离个人例外验收 · 合成身份与隔离数据库 · 不连接生产或实际认证</strong>
      <div className="qa-controls">
        <button type="button" data-testid="enable" onClick={() => setEnabled(true)}>开启验收入口</button>
        <label>验收人员<select aria-label="验收人员" data-testid="worker" value={workerId} onChange={event => setWorkerId(event.target.value)}>
          <option value={worker}>合成人员甲</option><option value={secondWorker}>合成人员乙</option>
        </select></label>
        <label>验收身份<select aria-label="验收身份" data-testid="owner" value={ownerId} onChange={event => setOwnerId(event.target.value)}>
          <option value={owner}>当前合成 owner</option><option value={otherOwner}>另一合成身份</option>
        </select></label>
        <button type="button" data-testid="hide" onClick={() => visibility("hidden")}>隐藏验收文档</button>
        <button type="button" data-testid="show" onClick={() => visibility("visible")}>显示验收文档</button>
        <button type="button" data-testid="pagehide" onClick={() => window.dispatchEvent(new Event("pagehide"))}>发送验收 pagehide</button>
        <button type="button" data-testid="unmount" onClick={() => setMounted(false)}>卸载验收例外</button>
        <button type="button" data-testid="mount" onClick={() => setMounted(true)}>重挂验收例外</button>
        <button type="button" data-testid="epoch" onClick={() => setEpoch(value => value + 1)}>递增验收授权代次</button>
        <button type="button" data-testid="confirm-api-change" onClick={changeFetchInsideNextConfirm}>下次确认中同步更换请求函数</button>
        <output data-testid="fetch-generation">{fetchGeneration}</output>
      </div>
    </header>
    <main className="qa-main">{mounted
      ? <PersonalRulesLauncher key={epoch} siteId="99990001" ownerId={ownerId} workerId={workerId} apiFetch={apiFetch} enabled={enabled ? true : undefined}/>
      : <p>验收个人例外组件已卸载</p>}
    </main>
  </>;
}

createRoot(document.getElementById("qa-root")!).render(<Harness/>);
