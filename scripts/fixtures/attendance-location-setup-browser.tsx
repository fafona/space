import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import MerchantAttendanceLocationSetupPanel from "../../src/components/enterprise/MerchantAttendanceLocationSetupPanel";
import { createLocationSetupModel, setupOwner, setupQuery } from "./attendance-location-setup-model";
const model = createLocationSetupModel();
function Fixture() {
  const [mode, setMode] = useState("normal"), [key, setKey] = useState(0), [enabled, setEnabled] = useState(true), [openWebShift, setOpenWebShift] = useState(false), [status, setStatus] = useState("");
  return <><div className="qa-toolbar"><strong>围栏设置隔离原型 · 只有合成配置 · 不连接生产、不定位</strong>
    <div className="qa-controls"><select value={mode} onChange={e => { model.mode(e.target.value); setMode(e.target.value); }}>
      {[["normal", "正常"], ["lost", "已保存但响应丢失"], ["unsent", "未送达"], ["timeout", "保存后超时"], ["offline", "离线"], ["denied", "撤权"], ["wrong_owner", "身份变化"], ["rejected", "明确拒绝"]].map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select>
      <button onClick={() => setKey(key + 1)}>重新挂载／恢复</button><button onClick={() => { model.editDraft(); setKey(key + 1); }}>模拟修改草稿</button>
      <button onClick={() => { try { model.publish(); setKey(key + 1); setStatus("模拟发布完成；不代替实际告知页面的确认流程"); } catch { setStatus("先应用草稿围栏"); } }}>模拟单独发布告知</button>
      <button onClick={() => { model.changeConfig(); setKey(key + 1); }}>模拟其他配置改变</button>
      <label><input type="checkbox" checked={enabled} onChange={e => { model.enabled(e.target.checked); setEnabled(e.target.checked); setKey(key + 1); }}/>允许新配置</label>
      <label><input type="checkbox" checked={openWebShift} onChange={e => { model.openWebShift(e.target.checked); setOpenWebShift(e.target.checked); setKey(key + 1); }}/>模拟普通网页未结束班次</label>
      <button onClick={() => setStatus(JSON.stringify(model.metrics()))}>请求计数</button></div><p>{status}</p></div>
    <main className="qa-main"><MerchantAttendanceLocationSetupPanel key={key} query={setupQuery} ownerId={setupOwner} apiFetch={model.apiFetch}/></main></>;
}
createRoot(document.getElementById("qa-root")!).render(<StrictMode><Fixture/></StrictMode>);
