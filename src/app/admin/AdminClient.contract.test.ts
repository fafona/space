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

test("merchant editor ids are authorized by an exact server session before any hint is used", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const resolverStart = source.indexOf("async function resolveMerchantIds(");
  const resolverEnd = source.indexOf(
    "async function loadBlocksFromSupabaseFallback",
    resolverStart,
  );
  assert.ok(resolverStart >= 0 && resolverEnd > resolverStart);
  const resolver = source.slice(resolverStart, resolverEnd);

  assert.match(resolver, /resolveAuthorizedMerchantIds\(payload, sessionUserId/);
  assert.match(resolver, /readMerchantIdsFromMetadata\(metadataRecord\)/);
  assert.match(resolver, /readCachedMerchantIds\(sessionUserId, email\)/);
  assert.doesNotMatch(resolver, /Keep cached \+ metadata ids/);
  assert.doesNotMatch(resolver, /payloadMatchesCurrentUser/);

  assert.match(
    source,
    /const initialCached = isPlatformEditor \? applyCachedEditorBlocks\(\) : \[\]/,
  );
  assert.match(
    source,
    /preferredByScope && !merchantIds\.includes\(preferredByScope\)/,
  );
  assert.match(source, /scopedSiteId && !merchantIds\.includes\(scopedSiteId\)/);
  assert.doesNotMatch(
    source,
    /preferredByScope \? \[preferredByScope\] : mergePreferredMerchantIds\(merchantIdsRef\.current\)/,
  );
  assert.doesNotMatch(source, /if \(scopedSiteId\) return Promise\.resolve\(\[scopedSiteId\]\)/);
  assert.doesNotMatch(source, /return Promise\.resolve\(hintedMerchantIds\)/);

  const clearStart = source.indexOf("const clearMerchantAuthorizedIdentity = useCallback");
  const clearEnd = source.indexOf("const themeBaseBlocksByPageRef", clearStart);
  assert.ok(clearStart >= 0 && clearEnd > clearStart);
  const clearBoundary = source.slice(clearStart, clearEnd);
  assert.match(clearBoundary, /merchantIdsRef\.current = \[\]/);
  assert.match(clearBoundary, /merchantSessionIdentityRef\.current = \{/);
  assert.match(clearBoundary, /merchantId: ""/);
  assert.match(clearBoundary, /setMerchantSiteIdOverride\(""\)/);

  assert.match(
    source,
    /const authorizedOverrideSiteId = authorizedMerchantSiteIds\.includes\(merchantSiteIdOverride\)/,
  );
  assert.match(
    source,
    /const authorizedScopedSiteId = authorizedMerchantSiteIds\.includes\(scopedSiteId\)/,
  );
  assert.match(
    source,
    /\? authorizedOverrideSiteId \|\| authorizedScopedSiteId \|\| fallbackMerchantSiteId/,
  );
  assert.match(source, /clearMerchantAuthorizedIdentity\(\);\s+const merchantGatewayReady/);
  assert.match(source, /function selectAuthorizedMerchantSiteId\(/);
  assert.doesNotMatch(source, /readRecentMerchantLaunchMerchantId/);
  assert.doesNotMatch(
    source,
    /editingSiteId \|\|\s+merchantSessionIdentityRef\.current\.merchantId/,
  );
  assert.doesNotMatch(
    source,
    /setMerchantSiteIdOverride\(\(current\) => current \|\| merchantId\)/,
  );
});
