import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PlatformAdminBackupRestoreReceiptPanel, { type PlatformAdminBackupRestoreReceiptPanelProps } from "./PlatformAdminBackupRestoreReceiptPanel";

const base: PlatformAdminBackupRestoreReceiptPanelProps = {
  operationId: "00000000-0000-0000-0000-000000000001",
  backupId: "synthetic-backup-1",
  scope: "user_manage",
  status: "unknown",
  application: "unconfirmed",
  querying: false,
  onQuery() { assert.fail("Static rendering must not initiate a query"); },
};
function render(overrides: Partial<PlatformAdminBackupRestoreReceiptPanelProps> = {}) {
  return renderToStaticMarkup(<PlatformAdminBackupRestoreReceiptPanel {...base} {...overrides} />);
}
function onlyButton(html: string) {
  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  assert.equal(buttons.length, 1);
  return { attributes: buttons[0][1], label: buttons[0][2] };
}

test("receipt panel separates historical server evidence from unconfirmed page application", () => {
  const html = render({ status: "committed", committedAt: "2026-09-09T12:00:00.123456Z" });
  assert.match(html, /服务器提交凭据/); assert.match(html, /页面应用状态/);
  assert.match(html, /已确认历史提交/); assert.match(html, /页面应用尚未确认/);
  assert.match(html, /不代表当前服务器数据仍与当时一致/);
  assert.match(html, /不会根据凭据自动补写/);
  assert.match(html, /<time dateTime="2026-09-09T12:00:00.123456Z">/);
});

test("receipt panel never equates unknown with not executed and keeps the only action read-only", () => {
  const html = render(); const button = onlyButton(html);
  assert.match(html, /未知不等于未执行/); assert.match(html, /服务器可能已提交/);
  assert.equal(button.label, "只读查询提交结果"); assert.doesNotMatch(button.attributes, /\sdisabled=""/);
  assert.match(html, /查询不会重新恢复，也不会解除本页或其他未知写入的保护/);
});

test("receipt panel disables queries while pending, rejected or already querying", () => {
  for (const status of ["pending", "committed", "unknown", "rejected"] as const) {
    for (const querying of [false, true]) {
      const html = render({ status, querying }); const button = onlyButton(html);
      assert.equal(/\sdisabled=""/.test(button.attributes), querying || status === "pending" || status === "rejected");
      assert.equal(button.label, querying ? "正在只读查询…" : "只读查询提交结果");
    }
  }
});

test("receipt panel shows a definite pre-commit rejection without clearing other uncertain writes", () => {
  const html = render({ status: "rejected" });
  assert.match(html, /提交前已拒绝/);
  assert.match(html, /该请求在提交前已被拒绝，未开始本次恢复/);
  assert.match(html, /其他不明写入仍需单独核对/);
  assert.match(onlyButton(html).attributes, /\sdisabled=""/);
});

test("receipt panel confirms application only from its independent application prop", () => {
  assert.match(render({ status: "committed", application: "unconfirmed" }), /页面应用尚未确认/);
  const applied = render({ status: "committed", application: "applied" });
  assert.match(applied, /页面已确认应用/);
  assert.match(applied, /不由提交凭据查询推定/);
});

test("receipt panel explains absence of a retained journal and keeps the operation ID selectable", () => {
  const html = render();
  assert.match(html, /当前没有待核对的浏览器接续记录/);
  assert.match(html, /刷新后不会从已清理记录推定服务器结果/);
  assert.match(html, /<code class="[^"]*select-all[^\"]*">00000000-0000-0000-0000-000000000001<\/code>/);
  assert.match(html, /synthetic-backup-1/); assert.match(html, /用户管理范围/);
  assert.match(render({ scope: "support_messages" }), /客服消息范围/);
});

test("retained receipt panel explains identity-bound reopen and storage/device limitations", () => {
  const html = render({ retained: true });
  assert.match(html, /本浏览器已保留待核对操作信息/);
  assert.match(html, /需原登录身份核验才会显示/);
  assert.match(html, /不会自动重发恢复或解除保护/);
  assert.match(html, /清除浏览器数据或换设备无法接续/);
  assert.match(html, /页面应用尚未确认/);
  assert.equal((html.match(/<button\b/g) ?? []).length, 1);
  assert.doesNotMatch(html, /confirmationToken|deviceId|actorKey/);
});

test("receipt panel never displays raw error details, internal actor fields or hashes", () => {
  const html = render({ queryError: "PRIVATE actorKey=deviceId confirmationToken planHash resultHash" });
  assert.match(html, /role="alert"/); assert.match(html, /查询未获得可靠结果/);
  assert.doesNotMatch(html, /PRIVATE|actorKey|deviceId|confirmationToken|planHash|resultHash/);
  assert.doesNotMatch(render(), /role="alert"/);
});

test("receipt panel escapes displayed identifiers and omits invalid or noncommitted timestamps", () => {
  const html = render({ operationId: "<script>unsafe()</script>", backupId: '<img src=x onerror="unsafe()">',
    status: "committed", committedAt: "not-a-date" });
  assert.doesNotMatch(html, /<script|<img|<time/); assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(render({ status: "unknown", committedAt: "2026-09-09T12:00:00Z" }), /<time/);
});
