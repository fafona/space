import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
test("admin entry is lazy/opt-in and preserves unsaved ordinary configuration while review is open", () => {
  const s = read("src/components/enterprise/MerchantAttendanceAdminPanel.tsx");
  assert.match(s, /NEXT_PUBLIC_FAOLLA_ATTENDANCE_CORRECTION_REVIEW_ENABLED === "1"/);
  assert.match(s, /lazy\(\(\) => import\("\.\/MerchantAttendanceCorrectionReviewPanel"\)\)/);
  assert.match(s, /hidden=\{missingOpen \|\| exceptionOpen \|\| correctionReviewOpen \|\| correctionControlsOpen \|\| revisionApprovalOpen \|\| \(timesheetEnabled && timesheetOpen\)\}/);
  assert.match(s, /ownerId=\{ownerId\}/);
});
test("review screen distinguishes original snapshot/current evidence; decisions stay in a separate double-opt-in lazy workspace", () => {
  const s = read("src/components/enterprise/MerchantAttendanceCorrectionReviewPanel.tsx");
  for (const text of ["目前不能在这里批准或驳回", "核对结果 · 不能作为批准凭证", "尚未完成的审批条件", "不是实时总数或锁定报表", "原始记录与声明明细", "在职日期核对", "无可核对记录", "仍有后续候选"])
    assert.ok(s.includes(text), text);
  assert.match(s, /key=\{`\$\{props.siteId\}:\$\{props.ownerId\}:\$\{props.initialRequestId \?\? "list"\}`\}/);
  assert.match(s, /const DecisionPanel=lazy\(\(\)=>import\("\.\/MerchantAttendanceCorrectionDecisionPanel"\)\)/);
  assert.match(s, /decisionsEnabled=process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_CORRECTION_DECISIONS_ENABLED === "1" && process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_CURRENT_CORRECTION_DECISIONS_ENABLED === "1"/);
  assert.match(s, /if\(decisionsEnabled&&decisionTarget!==undefined\)return <Suspense/);
  assert.match(s, /if\(decisionsEnabled&&decisionTarget!==undefined\)return; const visible/);
  assert.match(s, /document.visibilityState === "hidden"\) client.invalidate\(\); else void client.refresh/);
  assert.match(s, /const changed = \(\) => \{ client.invalidate\(true\)/);
  assert.doesNotMatch(s, /method: "POST"|navigator.geolocation|localStorage|sessionStorage|setInterval|dangerouslySetInnerHTML/);
});
test("read-only controller cannot persist employee notes or retry a write; synthetic fixture forbids all writes", () => {
  const s = read("src/lib/merchantAttendanceCorrectionReviewClient.ts");
  assert.match(s, /method: "GET"/); assert.match(s, /maxBytes: 262144/); assert.match(s, /if \(g !== this.generation\) return/);
  assert.doesNotMatch(s, /method: "POST"|localStorage|sessionStorage|setInterval|approve\s*=|withdraw\s*=/);
  const fixture = read("scripts/fixtures/attendance-correction-review-model.ts");
  assert.match(fixture, /init\?\.method && init.method !== "GET"/); assert.match(fixture, /synthetic_writes_forbidden/);
});
