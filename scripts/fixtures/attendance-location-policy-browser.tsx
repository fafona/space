import { createRoot } from "react-dom/client";
import { useState } from "react";
import MerchantAttendanceLocationPolicyPanel from "../../src/components/enterprise/MerchantAttendanceLocationPolicyPanel";
import { parseAttendanceLocationPolicyCommand, type AttendanceLocationPolicyResult } from "../../src/lib/merchantAttendanceLocationPolicy";
import type { AttendanceApiFetch } from "../../src/lib/merchantAttendanceSelfClient";
const siteId = "99990001", ownerId = "00000000-0000-4000-8000-000000000001", locationId = "00000000-0000-4000-8000-000000000002";
let data: AttendanceLocationPolicyResult = { siteId, locationId, draftOnly: true, settingsVersion: 1, location: { name: "合成门店", active: true, version: 1 }, current: null, previous: null, receipt: null };
const receipts = new Map<string, { command: string; receipt: NonNullable<AttendanceLocationPolicyResult["receipt"]> }>();
let scenario = "normal", moduleEnabled = true, requests = 0, writes = 0;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const apiFetch: AttendanceApiFetch = async (url, init) => {
  requests++;
  if (scenario === "offline") throw Error("synthetic_offline");
  if (scenario === "denied") return response({ ok: false, error: "attendance_access_denied" }, 403);
  const q = new URL(String(url), "http://127.0.0.1").searchParams;
  let op = q.get("operationId");
  if (init?.method === "POST") {
    const { command } = parseAttendanceLocationPolicyCommand(JSON.parse(String(init.body))); op = command.operationId;
    const existing = receipts.get(op);
    if (existing && existing.command !== JSON.stringify(command)) return response({ ok: false, error: "attendance_operation_conflict" }, 409);
    if (!existing) {
      if (!moduleEnabled) return response({ ok: false, error: "attendance_platform_paused" }, 403);
      if (scenario === "conflict" || command.expectedRevision !== (data.current?.revision ?? 0) || command.expectedSettingsVersion !== data.settingsVersion || command.expectedLocationVersion !== data.location.version) return response({ ok: false, error: "attendance_version_conflict" }, 409);
      const recordedAt = new Date().toISOString(), revision = command.expectedRevision + 1;
      data = { ...data, previous: data.current, current: { revision, recordedAt, settingsVersion: data.settingsVersion, locationVersion: data.location.version, values: command.values } };
      receipts.set(op, { command: JSON.stringify(command), receipt: { operationId: op, revision, recordedAt } }); writes++;
      if (scenario === "lost") throw Error("synthetic_lost_response");
    }
  }
  return response({ ...data, receipt: op ? receipts.get(op)?.receipt ?? null : null, ok: true, moduleEnabled });
};
function Demo() {
  const [mount, setMount] = useState(0), [count, setCount] = useState("");
  return <><header className="qa-toolbar">合成政策草稿测试 · 无真实账号／员工定位／业务接口<div className="qa-controls">
    <select aria-label="模拟场景" onChange={e => { scenario = e.target.value; }}><option value="normal">正常</option><option value="lost">保存后丢响应</option><option value="conflict">配置冲突</option><option value="offline">离线</option><option value="denied">负责人撤权</option></select>
    <label><input type="checkbox" defaultChecked onChange={e => { moduleEnabled = e.target.checked; }}/>允许保存草稿</label>
    <button onClick={() => setMount(n => n + 1)}>重挂载／恢复收据</button><button onClick={() => setCount(`请求 ${requests}，实际新增草稿 ${writes}`)}>读取计数</button><span>{count}</span>
    <button onClick={() => { data = { ...data, settingsVersion: data.settingsVersion + 1 }; }}>模拟基础设置变更</button>
  </div></header><main className="qa-main"><MerchantAttendanceLocationPolicyPanel key={mount} siteId={siteId} ownerId={ownerId} locationId={locationId} apiFetch={apiFetch}/></main></>;
}
createRoot(document.getElementById("qa-root")!).render(<Demo/>);
