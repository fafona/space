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

test("employee task notifications are permission-aware and open the source task", () => {
  assert.match(managerSource, /import\s+MerchantEnterpriseNotificationCenter\s+from/);
  assert.match(
    managerSource,
    /actor\.type\s*===\s*["']employee["']\s*&&\s*can\(actor,\s*["']tasks\.view["']\)[\s\S]{0,700}<MerchantEnterpriseNotificationCenter/,
  );
  for (const binding of [
    "siteId={siteId}",
    "actor={actor}",
    "employees={snapshot.employees}",
    "tasks={snapshot.tasks}",
    "apiFetch={apiFetch}",
    "onOpenTask={openTaskFromOverview}",
  ]) {
    assert.ok(managerSource.includes(binding), `notification center must receive ${binding}`);
  }
});

test("notification center supports unread polling, pagination and non-blocking direct actions", () => {
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
    /if\s*\(\s*!task\s*\|\|\s*!onOpenTask\(task\)\s*\)\s*return;[\s\S]{0,500}void\s+markRead\(\{\s*notificationId:\s*notification\.id\s*\}\)/,
    "a cancelled dirty-form navigation must keep the notification unread",
  );
  assert.match(notificationSource, /unreadCount\s*>\s*99\s*\?\s*["']99\+["']/);
  for (const type of [
    "task_assigned",
    "task_unassigned",
    "task_commented",
    "task_due_changed",
  ]) {
    assert.ok(notificationSource.includes(type), `missing notification presentation for ${type}`);
  }
  assert.match(
    managerSource,
    /editingTaskId\s*!==\s*task\.id[\s\S]{0,220}!canAutoRefreshOnFocus[\s\S]{0,220}window\.confirm\([\s\S]{0,180}return\s+false/,
    "notification task navigation must confirm before discarding any active enterprise draft",
  );
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
  assert.match(browserCheckSource, /scrollWidth\s*<=\s*viewport\.innerWidth\s*\+\s*1/);
});
