import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("poll statistics live in the operation center between customers and logs", async () => {
  const [adminClient, deferred, panel, editor, route, pollBlock, renderer, cardShare] = await Promise.all([
    read("src/app/admin/AdminClient.tsx"),
    read("src/components/admin/AdminDeferredComponents.tsx"),
    read("src/components/admin/MerchantPollStatsPanel.tsx"),
    read("src/components/admin/PollBlockEditor.tsx"),
    read("src/app/api/polls/route.ts"),
    read("src/components/blocks/PollBlock.tsx"),
    read("src/components/blocks/BlockRenderer.tsx"),
    read("src/app/share/business-card/page.tsx"),
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
  const desktopTable = panel.slice(panel.indexOf("<table"), panel.indexOf("</table>"));
  const desktopViewButton = desktopTable.indexOf("查看");
  const desktopBallotButton = desktopTable.indexOf("逐票明细", desktopViewButton);
  assert.ok(desktopViewButton >= 0 && desktopBallotButton > desktopViewButton, "逐票明细按钮应紧跟在查看按钮后面");
  assert.match(panel, /搜索姓名、身份、来源、选票编号、已选答案或填写内容/);
  assert.match(panel, />全部展开</);
  assert.match(panel, />全部收起</);
  assert.match(panel, /w-\[min\(96vw,1440px\)\]/);
  assert.doesNotMatch(panel, /<dt className="text-slate-400">投票时间<\/dt>/);
  assert.match(panel, /Excel 仅导出逐票明细，每张选票占一行/);
  assert.equal([...panel.matchAll(/book_append_sheet/g)].length, 1, "Excel 应只包含逐票明细工作表");
  assert.match(panel, /"逐票明细"/);
  assert.match(panel, /确认删除投票记录/);
  assert.match(panel, /method: "DELETE"/);
  assert.match(panel, /method: "PATCH"/);
  assert.match(panel, /作废/);
  assert.match(panel, /恢复/);
  assert.match(panel, /getPollSubmissionSourceLabel/);
  assert.doesNotMatch(editor, /buildPollExportRows/);
  assert.match(editor, /经营中心的“投票统计”/);
  assert.match(editor, /开放时间（可选）/);
  assert.match(editor, /结束时间（可选）/);
  assert.match(editor, /投票对象/);
  assert.match(editor, /POLL_MAX_OPTIONS/);
  assert.match(route, /if \(!pollId\)/);
  assert.match(route, /buildPollRoundOverviews/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /invalidated_at/);
  assert.match(route, /allocate_poll_id/);
  assert.match(route, /resolve_merchant_poll_id/);
  assert.match(route, /getPollAvailability/);
  assert.match(route, /getPollAudienceAccessError/);
  assert.match(route, /getMerchantMembershipsSnapshot/);
  assert.match(route, /participant_type: isMerchantMember \? "member" : isRegistered \? "registered" : "guest"/);
  assert.match(route, /source: source \|\| null/);
  assert.match(pollBlock, /source: runtimeSource/);
  assert.match(renderer, /runtimeSource=/);
  assert.match(cardShare, /runtimeSource="contact_card"/);
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
