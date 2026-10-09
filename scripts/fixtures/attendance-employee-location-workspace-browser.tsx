import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import MerchantAttendanceEmployeeLocationWorkspace from "../../src/components/enterprise/MerchantAttendanceEmployeeLocationWorkspace";
import { createEmployeeLocationFixture, siteId, employeeId } from "./attendance-employee-location-workspace-model";
const fixture = createEmployeeLocationFixture();
function Demo() {
  const [mount, setMount] = useState(0), [open, setOpen] = useState(true), [metrics, setMetrics] = useState("");
  return <><header className="qa-toolbar"><strong>员工定位工作区 · 合成告知／位置／打卡 · 禁止实际业务连接或真实设备定位</strong>
    <div className="qa-controls"><button onClick={() => void fixture.publish()}>模拟负责人发布告知</button>
      <select aria-label="合成场景" onChange={e => fixture.mode(e.target.value)}>{[["normal", "正常"], ["device_denied", "设备拒绝定位"], ["lost", "已提交但丢响应"], ["unsent", "未送达"], ["offline", "断网"], ["denied", "撤权"]].map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select>
      <label><input type="checkbox" defaultChecked onChange={e => fixture.enabled(e.target.checked)}/>允许新定位班次</label>
      <button onClick={() => { setMount(v => v + 1); setOpen(true); }}>重新进入</button><button onClick={() => setMetrics(JSON.stringify(fixture.metrics()))}>读取计数</button></div><p>{metrics}</p></header>
    <main className="qa-main">{open ? <MerchantAttendanceEmployeeLocationWorkspace key={mount} siteId={siteId} employeeId={employeeId} canClock apiFetch={fixture.apiFetch} environment={fixture.environment} onClose={() => setOpen(false)}/>
      : <p>已返回。未修改合成原操作存储；可再次进入。</p>}</main></>;
}
createRoot(document.getElementById("qa-root")!).render(<StrictMode><Demo/></StrictMode>);
