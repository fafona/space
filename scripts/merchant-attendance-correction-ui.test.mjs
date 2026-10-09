import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
test("employee correction entry is opt-in/lazy and leaves ordinary clocking paused only while workspace is open", () => {
  const s = read("src/components/enterprise/MerchantAttendanceSelfPanel.tsx");
  assert.match(s, /NEXT_PUBLIC_FAOLLA_ATTENDANCE_CORRECTIONS_ENABLED === "1"/);
  assert.match(s, /lazy\(\(\) => import\("\.\/MerchantAttendanceCorrectionWorkspace"\)\)/);
  assert.match(s, /if \(correctionOpen\) return;/); assert.match(s, /if \(!checkLocationPending\(\)\) setCorrectionOpen\(true\)/);
  assert.doesNotMatch(s, /correctionPendingKey|hasCorrectionPending/); // Declaration uncertainty cannot block actual shift clock-out.
});
test("history correction action is optional and selects parsed clock-in records from either supported source", () => {
  const s = read("src/components/enterprise/MerchantAttendanceHistoryPanel.tsx");
  assert.match(s, /onRequestCorrection\?:\(startEventId:string\)=>void/);
  assert.match(s, /onRequestCorrection&&record.action==="clock_in"&&<button/);
  assert.doesNotMatch(s, /onRequestCorrection&&record.action==="clock_in"&&record.source==="web"/);
  assert.match(s, /onRequestCorrection\(record.id\)/);
});
test("workspace explicit actions, draft guards, independent clocking and uncertain receipt warnings remain visible", () => {
  const s = read("src/components/enterprise/MerchantAttendanceCorrectionWorkspace.tsx");
  for (const text of ["beforeunload", "data-correction-dirty", "window.confirm", "未查到申请也不代表提交失败", "不替代正常下班打卡", "未绑定本人身份的终端记录不能在此申请", "仅暂存当前浏览器标签页", "这里不代为审批，不改原始记录"])
    assert.ok(s.includes(text), text);
  assert.match(s, /document.visibilityState === "hidden"\) client.pause/);
  assert.match(s, /if \(proposal && ack && reasonValid && !disabled\) submit/);
  assert.doesNotMatch(s, /navigator.geolocation|setInterval|dangerouslySetInnerHTML|method: "POST"|localStorage/);
});
test("retry terminal fences follow receipt lookup in existing SQL and only exact named conflicts clear old uncertainty", () => {
  const sql = read("scripts/supabase-migrations/202609300082_merchant_attendance_correction_requests.sql"), client = read("src/lib/merchantAttendanceCorrectionClient.ts");
  assert.ok(sql.indexOf("if receipt.command<>p_command") < sql.indexOf("raise exception 'attendance_version_conflict'"));
  assert.ok(sql.indexOf("if receipt.command<>p_command") < sql.indexOf("raise exception 'attendance_correction_basis_changed'"));
  assert.match(client, /first \|\| \["attendance_version_conflict", "attendance_correction_basis_changed", "attendance_correction_policy_changed", "attendance_correction_policy_required", "attendance_correction_decided"\]/);
  assert.match(client, /e.message !== "attendance_operation_conflict"/);
});
