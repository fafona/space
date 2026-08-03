import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const managerSource = readFileSync(
  path.join(root, "src", "components", "admin", "MerchantEnterpriseManager.tsx"),
  "utf8",
);
const workflowSource = readFileSync(
  path.join(
    root,
    "src",
    "app",
    "enterprise",
    "[siteId]",
    "EnterpriseWorkflowsPanel.tsx",
  ),
  "utf8",
);
const notificationSource = readFileSync(
  path.join(
    root,
    "src",
    "components",
    "admin",
    "MerchantEnterpriseNotificationCenter.tsx",
  ),
  "utf8",
);
const browserCheckSource = readFileSync(
  path.join(root, "scripts", "check-merchant-enterprise-browser.mjs"),
  "utf8",
);

test("workflow navigation and UI keep view, manage and publish permissions separate", () => {
  assert.match(
    managerSource,
    /key:\s*["']workflows["'][^\n]+permission:\s*["']workflows\.view["']/,
  );
  assert.match(managerSource, /<EnterpriseWorkflowsPanel[\s\S]{0,700}onDirtyChange=\{setWorkflowHasDraft\}/);
  assert.match(
    workflowSource,
    /const canManage\s*=\s*Boolean\([\s\S]{0,180}permissions\.includes\(["']workflows\.manage["']\)/,
  );
  assert.match(
    workflowSource,
    /const canPublish\s*=\s*Boolean\([\s\S]{0,180}permissions\.includes\(["']workflows\.publish["']\)/,
  );
  assert.match(workflowSource, /\{canManage\s*\?\s*\([\s\S]{0,450}>\s*新建流程\s*</);
  assert.match(workflowSource, /\{canManage\s*&&[\s\S]{0,420}>\s*编辑草稿\s*</);
  assert.match(workflowSource, /\{canPublish\s*&&[\s\S]{0,520}>\s*发布当前草稿\s*</);
  assert.match(workflowSource, /\{canPublish\s*&&[\s\S]{0,420}>\s*归档\s*</);
});

test("workflow drafts participate in menu and browser-leave protection", () => {
  assert.match(
    workflowSource,
    /useEffect\(\(\)\s*=>\s*\{\s*onDirtyChange\?\.\(isDirty\);\s*\},\s*\[isDirty,\s*onDirtyChange\]\)/,
  );
  assert.match(
    workflowSource,
    /if\s*\(!isDirty\)\s*return;[\s\S]{0,260}addEventListener\(["']beforeunload["'],\s*handleBeforeUnload\)/,
  );
  assert.match(
    managerSource,
    /tab\s*===\s*["']workflows["']\s*&&\s*!workflowHasDraft/,
  );
  assert.match(
    managerSource,
    /当前页面有未保存的内容。切换功能将放弃这些修改，是否继续？/,
  );
  assert.match(workflowSource, /当前流程有尚未保存的修改，确定放弃这些修改吗？/);
});

test("workflow CAS conflicts require an explicit reload while retaining the editor", () => {
  assert.match(
    workflowSource,
    /response\.status\s*===\s*409[\s\S]{0,240}throw new WorkflowVersionConflictError\(\)/,
  );
  assert.match(
    workflowSource,
    /error instanceof WorkflowVersionConflictError[\s\S]{0,120}setConflict\(true\)[\s\S]{0,320}请重新加载最新版本后再编辑/,
  );
  assert.match(
    workflowSource,
    /\{conflict\s*\?\s*\([\s\S]{0,260}reloadAfterConflict[\s\S]{0,180}>\s*重新加载\s*</,
  );
  assert.match(workflowSource, /保存不会影响员工正在查看的已发布版本，重新发布后才会生效。/);
});

test("workflow notifications navigate first and only then become read", () => {
  assert.match(managerSource, /onOpenWorkflow=\{openWorkflowFromNotification\}/);
  assert.match(
    managerSource,
    /openWorkflowFromNotification[\s\S]{0,700}Promise<boolean>[\s\S]{0,700}workflowHasDraft[\s\S]{0,500}requestViewChange\(["']workflows["']\)[\s\S]{0,700}setWorkflowFocusRequest/,
  );
  assert.match(
    managerSource,
    /test\(workflowId\)[\s\S]{0,120}Promise\.resolve\(false\)[\s\S]{0,420}window\.confirm\([\s\S]{0,220}Promise\.resolve\(false\)[\s\S]{0,180}!requestViewChange\(["']workflows["']\)\)\s*return\s+Promise\.resolve\(false\)/,
    "invalid targets and cancelled navigation must resolve false without creating a focus request",
  );
  assert.match(
    workflowSource,
    /onFocusHandled\?:\s*\(requestId:\s*number,\s*opened:\s*boolean\)\s*=>\s*void/,
  );
  assert.match(
    managerSource,
    /settleWorkflowFocusRequest[\s\S]{0,420}pending\.requestId\s*!==\s*requestId[\s\S]{0,260}clearTimeout\(pending\.timeoutId\)[\s\S]{0,260}pending\.resolve\(opened\)/,
  );
  assert.match(
    managerSource,
    /previousRequest[\s\S]{0,180}settleWorkflowFocusRequest\(previousRequest\.requestId,\s*false\)[\s\S]{0,420}setTimeout\([\s\S]{0,180}settleWorkflowFocusRequest\(requestId,\s*false\)/,
  );
  assert.match(
    managerSource,
    /handleWorkflowFocusHandled[\s\S]{0,180}opened:\s*boolean[\s\S]{0,180}settleWorkflowFocusRequest\(requestId,\s*opened\)/,
  );
  assert.match(
    managerSource,
    /return\s*\(\)\s*=>\s*\{[\s\S]{0,260}workflowFocusResolverRef\.current\s*=\s*null[\s\S]{0,180}clearTimeout\(pending\.timeoutId\)[\s\S]{0,180}pending\.resolve\(false\)/,
    "unmounting must not leave a workflow focus promise unresolved",
  );
  assert.match(
    managerSource,
    /if\s*\(tab\s*===\s*["']workflows["']\)\s*return;[\s\S]{0,220}settleWorkflowFocusRequest\(pending\.requestId,\s*false\)/,
    "leaving the workflow view must cancel an unresolved notification focus immediately",
  );
  assert.match(
    notificationSource,
    /await\s+onOpenWorkflow\(notification\.workflowId\)[\s\S]{0,180}if\s*\(!workflowOpened\)\s*return;[\s\S]{0,380}setOpen\(false\)[\s\S]{0,520}markRead\(\{\s*notificationId:\s*notification\.id\s*\}\)/,
  );
  assert.match(notificationSource, /aria-label=\{`企业通知/);
  assert.match(notificationSource, /aria-label=["']企业通知["']/);
  assert.match(notificationSource, />企业通知<\/h2>/);
});

test("workflow archive history is lazy, server-filtered and append-only paginated", () => {
  assert.match(
    workflowSource,
    /new URLSearchParams\(\{\s*siteId,\s*scope:\s*["']active["']\s*\}\)/,
    "new clients must request active workflows explicitly while bare GET stays rollout-compatible",
  );
  assert.match(
    workflowSource,
    /scope:\s*["']archived["'][\s\S]{0,180}limit:\s*String\(ARCHIVE_PAGE_SIZE\)/,
  );
  assert.match(
    workflowSource,
    /normalizedQuery[\s\S]{0,180}params\.set\(["']q["'][\s\S]{0,220}params\.set\(["']scenario["'][\s\S]{0,160}params\.set\(["']tag["']/,
  );
  assert.match(
    workflowSource,
    /options\.append[\s\S]{0,180}params\.set\(["']cursor["'],\s*options\.cursor\)/,
  );
  assert.match(
    workflowSource,
    /const activeIds = new Set\(active\.map[\s\S]{0,700}const archivedById = new Map[\s\S]{0,260}!activeIds\.has\(workflow\.id\)[\s\S]{0,220}\[\.\.\.active,\s*\.\.\.archivedById\.values\(\)\]/,
    "archive pages must deduplicate globally and never replace an active row with stale archive data",
  );
  assert.match(
    workflowSource,
    />\s*加载更多归档流程\s*</,
  );
  assert.match(
    workflowSource,
    /archiveLoadError[\s\S]{0,1200}>\s*重试归档加载\s*</,
  );
  assert.match(
    workflowSource,
    /new URLSearchParams\(\{\s*siteId,\s*workflowId:\s*focusWorkflowId\s*\}\)[\s\S]{0,1400}setFocusReady\(\{\s*requestId:\s*focusRequestId,\s*workflowId:\s*focused\.id\s*\}\)/,
    "notification targets must use the exact workflow endpoint before becoming ready",
  );
  assert.match(
    workflowSource,
    /focusReady\.workflowId\s*!==\s*selectedId[\s\S]{0,360}onFocusHandledRef\.current\?\.\(focusReady\.requestId,\s*true\)/,
    "a notification may be acknowledged only after its exact target is selected in rendered state",
  );
  assert.match(
    workflowSource,
    /const startingDraftEpoch = draftEpochRef\.current[\s\S]{0,1600}draftEpochRef\.current\s*!==\s*startingDraftEpoch[\s\S]{0,260}settle\(false\)/,
    "a slow exact lookup must not overwrite draft changes made after navigation was confirmed",
  );
  assert.match(
    workflowSource,
    /return\s*\(\)\s*=>\s*\{[\s\S]{0,120}controller\.abort\(\);[\s\S]{0,120}settle\(false\);/,
    "an exact focus request must settle false when its effect is replaced or unmounted",
  );
  assert.match(
    workflowSource,
    /cancelArchiveLoad[\s\S]{0,500}archiveAbortRef\.current\?\.abort\(\)[\s\S]{0,300}setArchiveLoading\(false\)/,
    "leaving or superseding archive mode must not leave its loading state stuck",
  );
});

test("browser acceptance models immutable publish snapshots and workflow mobile layout", () => {
  for (const marker of [
    "owner_workflow_draft_step_and_publish",
    "workflow_published_snapshot_isolated_from_new_draft",
    "workflow_manage_and_publish_ui_separation",
    "workflow_archive_refresh_and_restore",
    "workflow_archive_keyset_pagination_without_duplicates",
    "workflow_archive_selection_survives_filter_and_refresh",
    "workflow_menu_dirty_navigation_guard",
    "workflow_cas_conflict_keeps_local_body",
    "workflow_notification_dirty_cancel_and_target_navigation",
    "workflow_notification_same_view_dirty_guard_and_single_focus",
    "workflow_notification_slow_exact_preserves_newer_draft",
    "mobile_task_and_workflow_horizontal_layout",
    "mobile_workflow_archive_pager_and_second_page",
  ]) {
    assert.ok(browserCheckSource.includes(marker), `missing browser acceptance marker: ${marker}`);
  }
  assert.match(browserCheckSource, /function publishedWorkflowDto\(/);
  assert.match(browserCheckSource, /state\.workflowConflictNextSave\s*=\s*true/);
  assert.match(browserCheckSource, /notificationPatches\s*===\s*0/);
  assert.match(browserCheckSource, /workflowViewport\.scrollWidth\s*<=\s*workflowViewport\.innerWidth/);
  assert.match(browserCheckSource, /enterprise workflow mobile layout overflows horizontally/);
});
