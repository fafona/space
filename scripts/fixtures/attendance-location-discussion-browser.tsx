import { createRoot } from "react-dom/client";
import { useState } from "react";
import MerchantAttendanceLocationDiscussionPanel from "../../src/components/enterprise/MerchantAttendanceLocationDiscussionPanel";
import { createDiscussionFixture, discussionSite, discussionEmployee, discussionOwner } from "./attendance-location-discussion-model";
const fixture = createDiscussionFixture();
function Demo() {
  const [mount, setMount] = useState(0), [access, setAccess] = useState<"self" | "owner">("self"), [count, setCount] = useState("");
  return <><header className="qa-toolbar">员工异常说明／负责人公开回复 · 纯内存合成资料 · 不访问真实接口或定位。查询日期请包含 2026-09-28。<div className="qa-controls">
    <select aria-label="模拟身份" value={access} onChange={e => setAccess(e.target.value as typeof access)}><option value="self">员工本人</option><option value="owner">企业负责人</option></select>
    <select aria-label="模拟场景" onChange={e => fixture.mode(e.target.value)}>{[["normal", "正常"], ["lost", "保存后丢响应"], ["unsent", "请求未送达"], ["denied", "撤权"], ["rebound", "档案绑定变化"], ["empty_page", "首批空匹配"], ["offline", "离线"]].map(([v, name]) => <option key={v} value={v}>{name}</option>)}</select>
    <label><input type="checkbox" defaultChecked onChange={e => fixture.canPost(e.target.checked)}/>本人有打卡／提交权限</label><label><input type="checkbox" defaultChecked onChange={e => fixture.enabled(e.target.checked)}/>允许新考勤</label>
    <button onClick={() => setMount(n => n + 1)}>重挂载／恢复收据</button><button onClick={() => setCount(`请求 ${fixture.calls.length}，公开说明 ${fixture.writes()}`)}>读取计数</button><span>{count}</span>
  </div></header><main className="qa-main"><MerchantAttendanceLocationDiscussionPanel key={`${mount}:${access}`} siteId={discussionSite} access={access} actorId={access === "self" ? discussionEmployee : discussionOwner} apiFetch={fixture.apiFetch}/></main></>;
}
createRoot(document.getElementById("qa-root")!).render(<Demo/>);
