//196 actual Panel and actual page component, synthetic paired cookie/API only.
import { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import Page from "../../src/app/enterprise/attendance-terminal/independent/page";
import Panel from "../../src/components/enterprise/MerchantAttendanceIndependentTerminalPanel";
declare global { interface Window { __independentTerminalHarness: { mount(flagoff?: boolean): void; hide(hidden: boolean): void; unmount(): void } } }
function Harness() {
  const [config, setConfig] = useState({ open: true, flagoff: false, key: 0 });
  useLayoutEffect(() => { window.__independentTerminalHarness = {
    mount: (flagoff = false) => flushSync(() => setConfig(c => ({ open: true, flagoff, key: c.key + 1 }))),
    unmount: () => flushSync(() => setConfig(c => ({ ...c, open: false }))),
    hide: hidden => { Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
      Object.defineProperty(document, "visibilityState", { configurable: true, value: hidden ? "hidden" : "visible" }); document.dispatchEvent(new Event("visibilitychange")); } }; }, []);
  return <><p className="p-3 text-sm">196 真实页面／组件；合成HttpOnly配对cookie和API，不代表实际设备、Auth、SQL或KDF。</p>
    {config.open && (config.flagoff ? <Panel key={config.key} allowNew={false}/> : <Page key={config.key}/>)}</>;
}
createRoot(document.getElementById("qa-root")!).render(<Harness/>);
