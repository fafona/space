import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("poll statistics live in the operation center between customers and logs", async () => {
  const [adminClient, deferred, panel, editor, route] = await Promise.all([
    read("src/app/admin/AdminClient.tsx"),
    read("src/components/admin/AdminDeferredComponents.tsx"),
    read("src/components/admin/MerchantPollStatsPanel.tsx"),
    read("src/components/admin/PollBlockEditor.tsx"),
    read("src/app/api/polls/route.ts"),
  ]);

  const customerMenu = adminClient.indexOf("客户管理", adminClient.indexOf("merchantDesktopOperationCenterActive"));
  const pollMenu = adminClient.indexOf("投票统计", customerMenu);
  const logMenu = adminClient.indexOf("日志", pollMenu);
  assert.ok(customerMenu >= 0 && pollMenu > customerMenu && logMenu > pollMenu);
  assert.match(adminClient, /merchantDesktopSection === "pollStats"/);
  assert.match(deferred, /MerchantPollStatsPanel/);
  assert.match(panel, /导出 Excel/);
  assert.match(panel, /buildPollExportRows/);
  assert.match(panel, /逐票明细/);
  assert.match(panel, /确认删除投票记录/);
  assert.match(panel, /method: "DELETE"/);
  assert.doesNotMatch(editor, /buildPollExportRows/);
  assert.match(editor, /经营中心的“投票统计”/);
  assert.match(editor, /开放时间（可选）/);
  assert.match(editor, /结束时间（可选）/);
  assert.match(editor, /投票对象/);
  assert.match(editor, /POLL_MAX_OPTIONS/);
  assert.match(route, /if \(!pollId\)/);
  assert.match(route, /buildPollRoundOverviews/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /getPollAvailability/);
  assert.match(route, /getPollAudienceAccessError/);
  assert.match(route, /getMerchantMembershipsSnapshot/);
  assert.match(route, /participant_type: isMerchantMember \? "member" : isRegistered \? "registered" : "guest"/);
});

test("all inline block text controls use the buffered editor adapters", async () => {
  const [inlineEditor, controls] = await Promise.all([
    read("src/components/admin/InlineEditorBlock.tsx"),
    read("src/components/admin/BufferedEditorControls.tsx"),
  ]);
  assert.doesNotMatch(inlineEditor, /<input\b/);
  assert.doesNotMatch(inlineEditor, /<textarea\b/);
  assert.match(inlineEditor, /BufferedEditorInput/);
  assert.match(inlineEditor, /BufferedEditorTextarea/);
  assert.match(controls, /onCompositionStart/);
  assert.match(controls, /onCompositionEnd/);
  assert.match(controls, /useBufferedEditorTextCommit/);
});
