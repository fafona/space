import { useState } from "react";
import { createRoot } from "react-dom/client";
import RulesPreview from "../../src/components/enterprise/MerchantAttendanceRulesPreview";

function visibility(value: "hidden" | "visible") {
  Object.defineProperty(document, "hidden", { configurable: true, value: value === "hidden" });
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
  document.dispatchEvent(new Event("visibilitychange"));
}

function Harness() {
  const [timeZone, setTimeZone] = useState("Europe/Madrid"), [mounted, setMounted] = useState(true);
  return <>
    <header className="qa-toolbar">
      <strong>隔离规则草稿试算 · 不连接生产、认证或业务接口 · 不保存／发布</strong>
      <div className="qa-controls">
        <label>验收时区<select aria-label="验收时区" value={timeZone} onChange={event => setTimeZone(event.target.value)}>
          <option>Europe/Madrid</option><option>America/Los_Angeles</option><option>UTC</option>
        </select></label>
        <button type="button" onClick={() => visibility("hidden")}>隐藏验收文档</button>
        <button type="button" onClick={() => visibility("visible")}>显示验收文档</button>
        <button type="button" onClick={() => window.dispatchEvent(new PageTransitionEvent("pagehide"))}>离开验收文档</button>
        <button type="button" onClick={() => setMounted(false)}>卸载验收草稿</button>
        <button type="button" onClick={() => setMounted(true)}>重挂验收草稿</button>
      </div>
    </header>
    <main className="qa-main">{mounted
      ? <RulesPreview timeZone={timeZone} now={() => "2026-10-04T10:00:00.000Z"}/>
      : <p>已卸载，草稿未保存</p>}
    </main>
  </>;
}

createRoot(document.getElementById("qa-root")!).render(<Harness/>);
