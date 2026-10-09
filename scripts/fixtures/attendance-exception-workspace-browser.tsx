import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import MerchantAttendanceExceptionWorkspace from "../../src/components/enterprise/MerchantAttendanceExceptionWorkspace";
import { createExceptionWorkspaceFixture, siteId, ownerId, employeeId } from "./attendance-exception-workspace-model";
const fixture = createExceptionWorkspaceFixture();
function Demo() {
  const [access, setAccess] = useState<"owner" | "self">("owner"), [mount, setMount] = useState(0), [open, setOpen] = useState(true), [metrics, setMetrics] = useState("");
  return <><header className="qa-toolbar"><strong>异常核查／公开说明整页 · 同一条合成异常 · 不访问真实员工、定位或业务网络</strong><div className="qa-controls">
    <select aria-label="合成身份" value={access} onChange={e => { setAccess(e.target.value as typeof access); setOpen(true); }}><option value="owner">负责人</option><option value="self">员工本人</option></select>
    <select aria-label="合成场景" onChange={e => fixture.mode(e.target.value)}>{[["normal", "正常"], ["lost", "写入后丢响应"], ["unsent", "未送达"], ["offline", "离线"], ["denied", "撤权"]].map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select>
    <label><input type="checkbox" defaultChecked onChange={e => fixture.enabled(e.target.checked)}/>允许新考勤</label><button onClick={() => { setMount(v => v + 1); setOpen(true); }}>重新进入</button>
    <button onClick={() => setMetrics(`内部意见 ${fixture.review.writes()} · 公开说明 ${fixture.discussion.writes()} · 请求 ${fixture.review.calls.length + fixture.discussion.calls.length}`)}>读取计数</button></div><p>{metrics}</p></header>
    <main className="qa-main">{open ? <MerchantAttendanceExceptionWorkspace key={`${access}:${mount}`} siteId={siteId} access={access} actorId={access === "owner" ? ownerId : employeeId} apiFetch={fixture.apiFetch} onClose={() => setOpen(false)}/>
      : <p>已返回，原操作恢复数据未删除。</p>}</main></>;
}
createRoot(document.getElementById("qa-root")!).render(<StrictMode><Demo/></StrictMode>);
