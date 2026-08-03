import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const managerSource = readFileSync(
  path.join(root, "src", "components", "admin", "MerchantEnterpriseManager.tsx"),
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
const harnessSource = readFileSync(
  path.join(root, "src", "app", "test-harness", "enterprise", "page.tsx"),
  "utf8",
);
const browserCheckSource = readFileSync(
  path.join(root, "scripts", "check-merchant-enterprise-browser.mjs"),
  "utf8",
);

test("employee enterprise notifications are permission-aware and open task or workflow targets", () => {
  assert.match(managerSource, /import\s+MerchantEnterpriseNotificationCenter\s+from/);
  assert.match(
    managerSource,
    /actor\.type\s*===\s*["']employee["']\s*&&[\s\S]{0,120}can\(actor,\s*["']tasks\.view["']\)\s*\|\|\s*can\(actor,\s*["']workflows\.view["']\)[\s\S]{0,700}<MerchantEnterpriseNotificationCenter/,
  );
  for (const binding of [
    "siteId={siteId}",
    "actor={actor}",
    "employees={snapshot.employees}",
    "tasks={snapshot.tasks}",
    "apiFetch={apiFetch}",
    "onOpenTask={openTaskFromOverview}",
    "onOpenWorkflow={openWorkflowFromNotification}",
  ]) {
    assert.ok(managerSource.includes(binding), `notification center must receive ${binding}`);
  }
});

test("enterprise notification center supports unread polling, pagination and guarded direct actions", () => {
  assert.match(
    notificationSource,
    /\/api\/merchant-enterprise\/notifications\?\$\{query\.toString\(\)\}/,
  );
  assert.match(
    notificationSource,
    /document\.visibilityState\s*===\s*["']visible["'][\s\S]{0,220}loadNotifications\(\{\s*silent:\s*true\s*\}\)/,
  );
  assert.match(notificationSource, /window\.setInterval\(refreshIfVisible,\s*intervalMs\)/);
  assert.match(notificationSource, /nextCursor[\s\S]{0,500}append:\s*true/);
  assert.match(
    notificationSource,
    /method:\s*["']PATCH["'][\s\S]{0,140}JSON\.stringify\(\{\s*siteId,\s*\.\.\.input\s*\}\)/,
  );
  assert.match(
    notificationSource,
    /onOpenWorkflow\?:\s*\(workflowId:\s*string\)\s*=>\s*Promise<boolean>/,
    "workflow notification navigation must expose its eventual open result",
  );
  const openNotificationStart = notificationSource.indexOf(
    "async function openNotification",
  );
  const openNotificationEnd = notificationSource.indexOf(
    "\n  return (",
    openNotificationStart,
  );
  const openNotificationSource = notificationSource.slice(
    openNotificationStart,
    openNotificationEnd,
  );
  const awaitWorkflowIndex = openNotificationSource.indexOf(
    "await onOpenWorkflow(notification.workflowId)",
  );
  const openedGuardIndex = openNotificationSource.indexOf(
    "if (!workflowOpened) return;",
  );
  const closeIndex = openNotificationSource.indexOf("setOpen(false)");
  const markReadIndex = openNotificationSource.indexOf(
    "markRead({ notificationId: notification.id })",
  );
  assert.ok(awaitWorkflowIndex >= 0, "workflow navigation must be awaited");
  assert.ok(
    openedGuardIndex > awaitWorkflowIndex,
    "cancelled or unavailable workflow navigation must stop before changing notification state",
  );
  assert.ok(
    closeIndex > openedGuardIndex && markReadIndex > closeIndex,
    "the notification may close and become read only after the workflow is actually open",
  );
  assert.match(
    notificationSource,
    /const task\s*=\s*notification\.taskId[\s\S]{0,160}!task\s*\|\|\s*!onOpenTask\(task\)\)\s*return;/,
  );
  assert.match(notificationSource, /unreadCount\s*>\s*99\s*\?\s*["']99\+["']/);
  for (const type of [
    "task_assigned",
    "task_unassigned",
    "task_commented",
    "task_due_changed",
    "workflow_published",
  ]) {
    assert.ok(notificationSource.includes(type), `missing notification presentation for ${type}`);
  }
  assert.match(
    managerSource,
    /editingTaskId\s*!==\s*task\.id[\s\S]{0,220}!canAutoRefreshOnFocus[\s\S]{0,220}window\.confirm\([\s\S]{0,180}return\s+false/,
    "notification task navigation must confirm before discarding any active enterprise draft",
  );
  assert.match(notificationSource, /aria-label=\{`企业通知/);
  assert.match(notificationSource, /aria-label=["']企业通知["']/);
  assert.match(notificationSource, />企业通知<\/h2>/);
});

test("browser harness is production-closed and exercises two isolated contexts", () => {
  assert.match(
    harnessSource,
    /FAOLLA_ENTERPRISE_E2E_HARNESS[\s\S]{0,120}enabled-for-local-browser-tests[\s\S]{0,100}notFound\(\)/,
  );
  assert.match(harnessSource, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
  assert.match(harnessSource, /collaborationRefreshIntervalMs=\{400\}/);
  assert.match(browserCheckSource, /browser\.newContext\([\s\S]*1440/);
  assert.match(browserCheckSource, /viewport:\s*\{\s*width:\s*390,\s*height:\s*844\s*\}/);
  assert.match(browserCheckSource, /双会话创建任务/);
  assert.match(browserCheckSource, /本地未保存草稿/);
  assert.match(browserCheckSource, /foreground polling overwrote or exposed remote data/);
  assert.match(browserCheckSource, /企业通知，1 条未读/);
  assert.match(browserCheckSource, /workflow_notification_dirty_cancel_and_target_navigation/);
  assert.match(browserCheckSource, /scrollWidth\s*<=\s*viewport\.innerWidth\s*\+\s*1/);
});
