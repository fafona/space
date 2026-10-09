import { createRoot } from "react-dom/client";
import { useState } from "react";
import MerchantAttendanceCorrectionReviewPanel from "../../src/components/enterprise/MerchantAttendanceCorrectionReviewPanel";
import { createCorrectionReviewFixture } from "./attendance-correction-review-model";
import { correctionSite, correctionId } from "./attendance-correction-model";
const fixture = createCorrectionReviewFixture();
function Demo() {
  const [mount, setMount] = useState(0), [open, setOpen] = useState(true), [count, setCount] = useState("");
  return <><header className="qa-toolbar">负责人补正预核对 · 纯内存合成资料 · 查询提交日期需包含 2026-09-30 · 无审批写入，无生产连接。
    <div className="qa-controls"><select aria-label="合成场景" onChange={e => fixture.mode(e.target.value)}>{[["normal", "基本核对"], ["changed", "原始打卡已变化"], ["overlap", "后班次冲突"], ["gap", "缺在职日期"], ["binding", "身份绑定变化"], ["own", "负责人本人申请"], ["denied", "权限撤销"], ["offline", "断网"]].map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
      <button onClick={() => { setOpen(true); setMount(n => n + 1); }}>重新进入</button><button onClick={() => setCount(`只读请求 ${fixture.calls.length} · 写入 ${fixture.calls.filter(c => c.method !== "GET").length}`)}>读取计数</button><span>{count}</span></div></header>
    <main className="qa-main">{open ? <MerchantAttendanceCorrectionReviewPanel key={mount} siteId={correctionSite} ownerId={correctionId(1)} apiFetch={fixture.apiFetch} onClose={() => setOpen(false)}/> : <p>已返回，未提交任何审批。</p>}</main></>;
}
createRoot(document.getElementById("qa-root")!).render(<Demo/>);
