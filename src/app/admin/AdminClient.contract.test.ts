import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DeferredFaollaFrame from "../../components/admin/DeferredFaollaFrame";
import { canShowMerchantWorkspaceBeforeEditor } from "../../lib/merchantWorkspaceLoading";

const sourceUrl = new URL("./AdminClient.tsx", import.meta.url);

test("desktop landing keeps the loading screen until the initial editor sentinel is resolved", async () => {
  const source = await readFile(sourceUrl, "utf8");
  assert.match(source, /const awaitingMerchantWorkspaceLanding =\s*isDesktopMerchantWorkspace && merchantDesktopSection === "editor" &&\s*!merchantDesktopDefaultSectionSiteRef.current;/);
  const guard = source.indexOf("if (checkingAuth || awaitingMerchantWorkspaceLanding || awaitingMerchantBookingConfiguration) {");
  const loadingScreen = source.indexOf("<LoadingProgressScreen", guard);
  const workspace = source.indexOf("const desktopMerchantWorkspaceContent");
  const editorPreview = source.indexOf("<MemoizedInlineEditorBlock");
  assert.ok(guard >= 0 && loadingScreen > guard, "pending landing must retain the existing loading screen");
  assert.ok(workspace > loadingScreen && editorPreview > workspace, "guard must precede workspace and editor rendering");
  assert.match(source, /setMerchantDesktopSection\(defaultMerchantDesktopSection\)/);
  assert.match(source, /setMerchantDesktopSection\("faolla"\)/);
});

test("fast workspace entry requires authenticated same-site identity and loaded permissions", () => {
  const input = {
    desktopWorkspace: true,
    authenticated: true,
    merchantId: "10000000",
    authorizedMerchantIds: ["10000000"],
    profile: { id: "10000000", permissionConfig: {} },
  };
  assert.equal(canShowMerchantWorkspaceBeforeEditor(input), true);
  for (const override of [
    { desktopWorkspace: false },
    { authenticated: false },
    { merchantId: "" },
    { merchantId: "site-main" },
    { authorizedMerchantIds: [] },
    { authorizedMerchantIds: ["10000001"] },
    { profile: null },
    { profile: { id: "10000001", permissionConfig: {} } },
    { profile: { id: "10000000" } },
    { profile: { id: "10000000", permissionConfig: null } },
  ]) {
    assert.equal(canShowMerchantWorkspaceBeforeEditor({ ...input, ...override }), false, JSON.stringify(override));
  }
});

test("fast entry does not cancel hydration and ignores late profile results", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const start = source.indexOf("void currentMerchantProfileTask.then((result) => {");
  const end = source.indexOf("const remoteDraft = await loadMerchantDraftSnapshotViaApi", start);
  assert.ok(start > source.indexOf("const identityNotice = getMerchantIdentityNotice(resolvedMerchantIds)"));
  assert.ok(end > start, "draft hydration must continue without awaiting the profile callback");
  const callback = source.slice(start, end);
  assert.match(callback, /if \(!mounted \|\| uiReleased \|\| editorHydrationFinished\) return;/);
  assert.match(callback, /desktopWorkspace: !isPlatformEditor && !merchantEditorOnly/);
  assert.match(callback, /authenticated: merchantPayload\?\.authenticated === true/);
  assert.match(callback, /authorizedMerchantIds: merchantIds/);
  assert.ok(callback.indexOf("setMerchantWorkspaceEditorPending(true)") < callback.indexOf("releaseCheckingScreen"));
  assert.match(source, /finally \{\s*editorHydrationFinished = true;\s*if \(mounted\) setMerchantWorkspaceEditorPending\(false\);/);
  assert.match(source, /const publishedSnapshot = await loadPublishedSiteSnapshotForMerchantIds\(resolvedMerchantIds\)/);
});

test("actual profile callback releases before editor completion, but not after cancellation or completion", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const start = source.indexOf("void currentMerchantProfileTask.then((result) => {");
  const end = source.indexOf("const remoteDraft = await loadMerchantDraftSnapshotViaApi", start);
  assert.ok(start > 0 && end > start);
  const callbackSource = source.slice(start, end);
  for (const scenario of ["ready", "unmounted", "already-released", "editor-finished", "unauthenticated", "editor-only", "platform", "mobile", "wrong-site", "missing-profile"] as const) {
    const events: string[] = [];
    let resolveProfile!: (value: unknown) => void;
    const currentMerchantProfileTask = new Promise((resolve) => { resolveProfile = resolve; });
    const context = {
      currentMerchantProfileTask,
      mounted: true, uiReleased: false, editorHydrationFinished: false,
      isPlatformEditor: scenario === "platform", merchantEditorOnly: scenario === "editor-only",
      forceDesktopEditorSidebar: false, isDesktopEditorSidebarRef: { current: scenario !== "mobile" },
      merchantPayload: { authenticated: scenario !== "unauthenticated" },
      currentMerchantSiteId: "10000000", merchantIds: scenario === "wrong-site" ? ["10000001"] : ["10000000"],
      canShowMerchantWorkspaceBeforeEditor,
      setMerchantWorkspaceEditorPending: (value: boolean) => events.push(`pending:${value}`),
      releaseCheckingScreen: () => events.push("release"),
    };
    runInNewContext(callbackSource, context);
    assert.deepEqual(events, [], "profile must finish before any early release");
    // These transitions occur while the profile request is still outstanding.
    if (scenario === "unmounted") context.mounted = false;
    if (scenario === "already-released") context.uiReleased = true;
    if (scenario === "editor-finished") context.editorHydrationFinished = true;
    resolveProfile(scenario === "missing-profile" ? null : { profile: { id: "10000000", permissionConfig: {} } });
    await currentMerchantProfileTask;
    await Promise.resolve();
    assert.deepEqual(events, scenario === "ready" ? ["pending:true", "release"] : [], scenario);
  }
});

test("booking remains gated during early entry on desktop, dialogs and mobile resize", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const start = source.indexOf("const awaitingMerchantBookingConfiguration");
  const end = source.indexOf("if (checkingAuth ||", start);
  const guard = source.slice(start, end);
  assert.match(guard, /merchantWorkspaceEditorPending/);
  assert.match(guard, /merchantBookingManagerOpen/);
  assert.match(guard, /isDesktopMerchantWorkspace && merchantDesktopSection === "booking"/);
  assert.match(guard, /isMobileMerchantSupportOnlyMode && supportMobileHomeTab === "business" && supportMobileBusinessSection === "booking"/);
});

test("inactive Faolla frame emits no iframe or page request target", () => {
  const render = (active: boolean) => renderToStaticMarkup(React.createElement(DeferredFaollaFrame, {
    active, title: "Faolla test", src: "/synthetic-faolla-frame", className: "frame-style",
  }));
  assert.equal(render(false), "");
  assert.match(render(true), /<iframe/);
  assert.match(render(true), /src="\/synthetic-faolla-frame"/);
  assert.match(render(true), /class="frame-style"/);
});

test("both actual Faolla surfaces use the deferred frame with existing ref and load handlers", async () => {
  const source = await readFile(sourceUrl, "utf8");
  for (const surface of ["Mobile", "Desktop"]) {
    assert.match(source, new RegExp(`<DeferredFaollaFrame\\s+active=\\{support${surface}FaollaActive\\}\\s+ref=\\{support${surface}FaollaFrameRef\\}`));
  }
  assert.equal((source.match(/onLoad=\{\(event\) => handleSupportFaollaFrameLoad\(event.currentTarget\)\}/g) ?? []).length, 2);
  assert.doesNotMatch(source, /<iframe\s+ref=\{support(?:Mobile|Desktop)FaollaFrameRef\}/);
});

test("landing guard excludes explicit website and platform editors", async () => {
  const source = await readFile(sourceUrl, "utf8");
  assert.match(source, /const desktopMerchantWorkspaceActive = !isPlatformEditor && \(forceDesktopEditorSidebar \|\| isDesktopEditorSidebar\);/);
  assert.match(source, /const isDesktopMerchantWorkspace = desktopMerchantWorkspaceActive && !merchantEditorOnly;/);
  assert.match(source, /editorHref.searchParams.set\("editorOnly", "1"\)/);
});

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
