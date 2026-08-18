import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("./AdminClient.tsx", import.meta.url);

async function readBusinessCardChangeHandler() {
  const source = await readFile(sourceUrl, "utf8");
  const start = source.indexOf("const handleMerchantBusinessCardsChange");
  const end = source.indexOf("const merchantProfileDialogCommonProps", start);
  assert.ok(start >= 0 && end > start, "business-card change handler should remain a distinct audited boundary");
  return { source, handler: source.slice(start, end) };
}

test("business-card logging compares the persisted current site and skips no-op writes", async () => {
  const { handler } = await readBusinessCardChangeHandler();
  const noOpGuard = handler.indexOf(
    "if (JSON.stringify(previousCards) === JSON.stringify(normalizedCards)) return;",
  );
  const stateWrite = handler.indexOf("savePlatformState");

  assert.match(handler, /const currentSite = platformState\.sites\.find/);
  assert.match(handler, /normalizeMerchantBusinessCards\(currentSite\.businessCards \?\? \[\]\)/);
  assert.match(handler, /const normalizedCards = normalizeMerchantBusinessCards\(cards\)/);
  assert.ok(noOpGuard >= 0, "equal normalized card lists should be recognized");
  assert.ok(stateWrite > noOpGuard, "no-op changes should return before writing state");
  assert.doesNotMatch(handler, /editingSite\?\.businessCards/);
});

test("business-card system synchronization is persisted without an artificial user log", async () => {
  const { handler } = await readBusinessCardChangeHandler();
  const systemGuard = handler.indexOf('meta?.type === "system_sync" || meta?.type === "normalize"');
  const auditWrite = handler.indexOf("recordMerchantOperationLog");

  assert.ok(systemGuard >= 0, "system and normalization changes should be recognized");
  assert.ok(auditWrite > systemGuard, "system changes should return before the user audit write");
});

test("business-card user changes have specific actions and use the stable callback", async () => {
  const { source, handler } = await readBusinessCardChangeHandler();

  assert.match(handler, /action: "新增名片"/);
  assert.match(handler, /action: "更新名片"/);
  assert.match(handler, /action: "删除名片"/);
  assert.match(handler, /action: "设置聊天展示名片"/);
  assert.match(source, /onCardsChange: handleMerchantBusinessCardsChange/);
  assert.doesNotMatch(source, /action: "更新名片夹"/);
});
