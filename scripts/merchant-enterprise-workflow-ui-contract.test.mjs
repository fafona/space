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
    /openWorkflowFromNotification[\s\S]{0,700}workflowHasDraft[\s\S]{0,500}requestViewChange\(["']workflows["']\)[\s\S]{0,300}setWorkflowFocusRequest/,
  );
  assert.match(
    workflowSource,
    /focusRequestId[\s\S]{0,300}setDraft\(null\)[\s\S]{0,420}setSelectedId\(focused\.id\)[\s\S]{0,200}onFocusHandled\?\.\(focusRequestId\)/,
  );
  assert.match(
    managerSource,
    /handleWorkflowFocusHandled[\s\S]{0,220}current\?\.requestId\s*===\s*requestId\s*\?\s*null/,
  );
  assert.match(
    notificationSource,
    /notification\.type\s*===\s*["']workflow_published["'][\s\S]{0,220}!notification\.workflowId\s*\|\|\s*!onOpenWorkflow\?\.\(notification\.workflowId\)\)\s*return;/,
  );
  assert.match(
    notificationSource,
    /if\s*\(!notification\.readAt\)[\s\S]{0,520}markRead\(\{\s*notificationId:\s*notification\.id\s*\}\)/,
  );
  assert.match(notificationSource, /aria-label=\{`企业通知/);
  assert.match(notificationSource, /aria-label=["']企业通知["']/);
  assert.match(notificationSource, />企业通知<\/h2>/);
});

test("browser acceptance models immutable publish snapshots and workflow mobile layout", () => {
  for (const marker of [
    "owner_workflow_draft_step_and_publish",
    "workflow_published_snapshot_isolated_from_new_draft",
    "workflow_manage_and_publish_ui_separation",
    "workflow_archive_refresh_and_restore",
    "workflow_menu_dirty_navigation_guard",
    "workflow_cas_conflict_keeps_local_body",
    "workflow_notification_dirty_cancel_and_target_navigation",
    "workflow_notification_same_view_dirty_guard_and_single_focus",
    "mobile_task_and_workflow_horizontal_layout",
  ]) {
    assert.ok(browserCheckSource.includes(marker), `missing browser acceptance marker: ${marker}`);
  }
  assert.match(browserCheckSource, /function publishedWorkflowDto\(/);
  assert.match(browserCheckSource, /state\.workflowConflictNextSave\s*=\s*true/);
  assert.match(browserCheckSource, /notificationPatches\s*===\s*0/);
  assert.match(browserCheckSource, /workflowViewport\.scrollWidth\s*<=\s*workflowViewport\.innerWidth/);
  assert.match(browserCheckSource, /enterprise workflow mobile layout overflows horizontally/);
});
