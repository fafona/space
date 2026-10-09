import { createRoot } from "react-dom/client";
import { useState } from "react";
import MerchantAttendanceCorrectionWorkspace from "../../src/components/enterprise/MerchantAttendanceCorrectionWorkspace";
import { createCorrectionFixture, correctionSite, correctionEmployee } from "./attendance-correction-model";
const fixture = createCorrectionFixture();
function Demo() {
  const [mount, setMount] = useState(0), [open, setOpen] = useState(true), [count, setCount] = useState("");
  return <><header className="qa-toolbar">补正申请 · 纯内存合成资料 · 原始班次 2026-09-28 · 不接生产或 GPS。模拟时钟固定 2026-09-30。
    <div className="qa-controls"><select aria-label="模拟场景" onChange={e => fixture.mode(e.target.value)}>{[["normal", "正常"], ["lost", "提交后丢响应"], ["unsent", "请求未送达"], ["stale", "申请版本变化"], ["basis_changed", "原始班次变化"], ["denied", "撤权"], ["rebound", "档案换绑"], ["offline", "离线"]].map(([v, text]) => <option key={v} value={v}>{text}</option>)}</select>
      <label><input type="checkbox" defaultChecked onChange={e => fixture.enabled(e.target.checked)}/>允许新申请</label><label><input type="checkbox" defaultChecked onChange={e => fixture.canRequest(e.target.checked)}/>允许本人申请／撤回</label>
      <button onClick={() => { setMount(n => n + 1); setOpen(true); }}>重挂载／重新进入</button><button onClick={() => setCount(`请求 ${fixture.calls.length} · 申请及撤回写入 ${fixture.writes()}`)}>读取计数</button><span>{count}</span></div></header>
    <main className="qa-main">{open ? <MerchantAttendanceCorrectionWorkspace key={mount} siteId={correctionSite} employeeId={correctionEmployee} apiFetch={fixture.apiFetch} onClose={() => setOpen(false)}/> : <p>已返回，可点击“重新进入”核对原操作。</p>}</main></>;
}
createRoot(document.getElementById("qa-root")!).render(<Demo/>);
