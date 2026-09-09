import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PlatformAdminBackupRestoreInspectionPanel, { type PlatformAdminBackupRestoreInspectionPanelProps } from "./PlatformAdminBackupRestoreInspectionPanel";
import type { PlatformAdminBackupRestoreInspectionResult } from "@/lib/platformAdminBackupRestoreInspectionClient";

const result: PlatformAdminBackupRestoreInspectionResult = { ok: true, outcome: "committed",
  receipt: { version: 1, operationId: "11111111-2222-4333-8444-555555555555", scope: "user_manage", backupId: "synthetic",
    confirmationToken: `v1.${"a".repeat(64)}`, planHash: "b".repeat(64), resultHash: "c".repeat(64), committedAt: "2026-09-09T12:00:00Z" },
  inspection: { version: 1, observedAt: "2026-09-09T12:01:00Z", targetState: "matches_commit", targetHash: "c".repeat(64) } };
function render(extra: Partial<PlatformAdminBackupRestoreInspectionPanelProps> = {}) {
  return renderToStaticMarkup(<PlatformAdminBackupRestoreInspectionPanel result={null} inspecting={false} onInspect={() => assert.fail("render must not query")} {...extra} />);
}
test("inspection panel has only an explicit read-only action and no automatic work", () => {
  const html = render();
  assert.match(html, /尚未进行当前数据核对/); assert.match(html, /只读核对当前数据/);
  assert.equal((html.match(/<button\b/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<button[^>]*>[^<]*(清除|解除|恢复同步|重试恢复)/);
});
test("matching observation is not a current-state or browser-application guarantee", () => {
  const html = render({ result });
  assert.match(html, /本次核对时与提交结果一致/);
  assert.match(html, /不代表页面已正确应用，也不保证之后未再变化/);
  assert.match(html, /<time dateTime="2026-09-09T12:01:00Z"/);
  assert.match(html, /不会清除操作记录、自动恢复数据或解除现有保护/);
});
test("changed observation acknowledges legitimate later changes and never suggests rollback", () => {
  const html = render({ result: { ...result, inspection: { ...result.inspection, targetState: "differs_from_commit", targetHash: "d".repeat(64) } } });
  assert.match(html, /本次核对时与提交结果不同/);
  assert.match(html, /后续正常修改，不能直接认定恢复失败/);
  assert.match(html, /不会自动覆盖或回滚/);
});
test("unknown receipt reports target uninspected, not not-executed", () => {
  const html = render({ result: { ok: true, outcome: "unknown", receipt: null, inspection: null } });
  assert.match(html, /当前数据未核对/); assert.match(html, /缺少凭据不等于未执行/);
  assert.doesNotMatch(html, /<time|本次核对时与提交结果一致/);
});
test("pending and caller-disabled states prevent another inspection", () => {
  assert.match(render({ inspecting: true }), /disabled=""/);
  assert.match(render({ inspecting: true }), /正在只读核对/);
  assert.match(render({ disabled: true }), /disabled=""/);
});
test("inspection panel limits scope, hides hashes and keeps failures generic", () => {
  const html = render({ result, error: true });
  assert.match(html, /不涵盖备份目录、浏览器状态、其他业务模块或迟到写入/);
  assert.match(html, /本次核对未获得可靠结果/);
  assert.doesNotMatch(html, /[a-f0-9]{64}|actorKey|confirmationToken|targetHash|resultHash/);
});
