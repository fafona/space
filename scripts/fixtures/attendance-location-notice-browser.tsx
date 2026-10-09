import { createRoot } from "react-dom/client";
import { useState } from "react";
import MerchantAttendanceLocationNoticePanel from "../../src/components/enterprise/MerchantAttendanceLocationNoticePanel";
import { createNoticeFixture, noticeQuery, noticeOwner, noticeEmployee } from "./attendance-location-notice-model";
const fixture = createNoticeFixture();
function Demo() {
  const [access, setAccess] = useState<"owner" | "self">("owner"), [mount, setMount] = useState(0), [count, setCount] = useState("");
  return <><header className="qa-toolbar">政策发布／撤回／本人版本确认 · 纯内存合成资料 · 无实际定位／员工数据／业务网络<div className="qa-controls">
    <select aria-label="模拟身份" value={access} onChange={e => setAccess(e.target.value as typeof access)}><option value="owner">负责人</option><option value="self">员工本人</option></select>
    <select aria-label="模拟场景" onChange={e => fixture.mode(e.target.value)}>{[["normal", "正常"], ["lost", "保存后丢响应"], ["unsent", "请求未送达"], ["denied", "撤权"], ["rebound", "档案绑定改变"], ["offline", "离线"]].map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select>
    <label><input type="checkbox" defaultChecked onChange={e => fixture.enabled(e.target.checked)}/>允许新发布</label><button onClick={() => fixture.editDraft()}>模拟编辑新草稿</button><button onClick={() => fixture.advanceConfig()}>模拟配置版本改变</button>
    <button onClick={() => setMount(v => v + 1)}>重挂载／恢复收据</button><button onClick={() => setCount(`请求 ${fixture.calls.length}，写入 ${fixture.writes()}`)}>读取计数</button><span>{count}</span>
  </div></header><main className="qa-main"><MerchantAttendanceLocationNoticePanel key={`${access}:${mount}`} query={noticeQuery(access)} actorId={access === "owner" ? noticeOwner : noticeEmployee} apiFetch={fixture.apiFetch}/></main></>;
}
createRoot(document.getElementById("qa-root")!).render(<Demo/>);
