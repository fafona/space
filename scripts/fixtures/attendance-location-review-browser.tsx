import { createRoot } from "react-dom/client";
import { useState } from "react";
import MerchantAttendanceLocationReviewPanel from "../../src/components/enterprise/MerchantAttendanceLocationReviewPanel";
import { createAttendanceReviewFixture, reviewFixtureSite, reviewFixtureOwner } from "./attendance-location-review-model";
const fixture = createAttendanceReviewFixture();
function Demo() {
  const [mount, setMount] = useState(0), [count, setCount] = useState("");
  return <><header className="qa-toolbar">定位异常核查 · 合成记录 · 无员工数据／定位／业务网络。查询日期请包含 2026-09-30。<div className="qa-controls">
    <select aria-label="模拟场景" onChange={e => fixture.mode(e.target.value)}><option value="normal">正常</option><option value="lost">保存成功后丢响应</option><option value="unsent">请求未送达</option><option value="denied">负责人撤权</option><option value="empty_page">首批无匹配／下一批有异常</option><option value="offline">离线</option></select>
    <label><input type="checkbox" defaultChecked onChange={e => fixture.enabled(e.target.checked)}/>允许新考勤（关闭后仍能核查旧异常）</label>
    <button onClick={() => setMount(n => n + 1)}>重挂载／恢复收据</button><button onClick={() => setCount(`请求 ${fixture.calls.length}，核查记录 ${fixture.writes()}`)}>读取计数</button><span>{count}</span>
  </div></header><main className="qa-main"><MerchantAttendanceLocationReviewPanel key={mount} siteId={reviewFixtureSite} ownerId={reviewFixtureOwner} apiFetch={fixture.apiFetch}/></main></>;
}
createRoot(document.getElementById("qa-root")!).render(<Demo/>);
