import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import MerchantAttendanceLocationWorkspace from "../../src/components/enterprise/MerchantAttendanceLocationWorkspace";
import { setupOwner, setupQuery } from "./attendance-location-setup-model";
import { createLocationWorkspaceModel } from "./attendance-location-workspace-model";
const model = createLocationWorkspaceModel();
function Fixture() {
  const [key, setKey] = useState(0), [open, setOpen] = useState(true), [mode, setMode] = useState("normal"), [message, setMessage] = useState("");
  return <><div className="qa-toolbar"><strong>负责人整页联动 · 合成资料 · 不连接生产、不采集位置</strong><div className="qa-controls">
    <select value={mode} onChange={e => { model.mode(e.target.value); setMode(e.target.value); }}>{[["normal", "正常"], ["lost", "保存成功但丢响应"], ["unsent", "未送达"], ["offline", "断网"], ["denied", "撤权"]].map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select>
    <button onClick={() => { setKey(key + 1); setOpen(true); }}>重开／恢复工作区</button><button onClick={() => setMessage(JSON.stringify(model.metrics()))}>请求计数</button>
    <label><input type="checkbox" onChange={e => model.setup.openWebShift(e.target.checked)}/>模拟普通网页未结束班次</label>
    <label><input type="checkbox" defaultChecked onChange={e => model.setup.enabled(e.target.checked)}/>允许新配置</label></div><p>{message}</p></div>
    <main className="qa-main">{open ? <MerchantAttendanceLocationWorkspace key={key} siteId={setupQuery.siteId} ownerId={setupOwner} locationId={setupQuery.locationId}
      locationName="合成门店" apiFetch={model.apiFetch} onClose={() => setOpen(false)}/> : <p>已返回地点列表占位；上方可重开。此合成页不代表完整企业登录态验收。</p>}</main></>;
}
createRoot(document.getElementById("qa-root")!).render(<StrictMode><Fixture/></StrictMode>);
