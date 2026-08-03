import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteId = "10000000";
const ownerId = "10000000-0000-4000-8000-000000000001";
const roleId = "10000000-0000-4000-8000-000000000002";
const employeeId = "10000000-0000-4000-8000-000000000003";
const boardId = "10000000-0000-4000-8000-000000000004";
const todoColumnId = "10000000-0000-4000-8000-000000000005";
const doneColumnId = "10000000-0000-4000-8000-000000000006";
const secondEmployeeId = "10000000-0000-4000-8000-000000000008";
const secondBoardId = "10000000-0000-4000-8000-000000000009";
const allPermissions = [
  "enterprise.view",
  "tasks.view",
  "tasks.create",
  "tasks.update",
  "tasks.assign",
  "tasks.archive",
  "orders.linked.view",
  "boards.manage",
  "employees.view",
  "employees.manage",
  "roles.view",
  "roles.manage",
  "audit.view",
];

function timestamp() {
  return new Date().toISOString();
}

function createSharedState() {
  const createdAt = timestamp();
  return {
    taskSequence: 10,
    actor: {
      type: "owner",
      id: ownerId,
      siteId,
      displayName: "浏览器测试负责人",
      email: "owner@example.test",
      permissions: allPermissions,
      accessScope: "all",
      allowedBoardIds: [],
    },
    snapshot: {
      roles: [
        {
          id: roleId,
          siteId,
          name: "管理员",
          description: "浏览器验收角色",
          permissions: allPermissions,
          accessScope: "all",
          allowedBoardIds: [],
          status: "active",
          isSystem: true,
          version: 1,
          createdAt,
          updatedAt: createdAt,
        },
      ],
      employees: [
        {
          id: employeeId,
          siteId,
          authUserId: "10000000-0000-4000-8000-000000000007",
          email: "employee@example.test",
          displayName: "浏览器测试员工",
          roleId,
          status: "active",
          invitedAt: createdAt,
          acceptedAt: createdAt,
          lastActiveAt: createdAt,
          invitationVersion: 1,
          invitationExpiresAt: null,
          invitationRevokedAt: null,
          invitationSentAt: createdAt,
          invitationDeliveryStatus: "sent",
          version: 1,
          createdAt,
          updatedAt: createdAt,
        },
        {
          id: secondEmployeeId,
          siteId,
          authUserId: "10000000-0000-4000-8000-000000000010",
          email: "employee-two@example.test",
          displayName: "浏览器测试员工二",
          roleId,
          status: "active",
          invitedAt: createdAt,
          acceptedAt: createdAt,
          lastActiveAt: createdAt,
          invitationVersion: 1,
          invitationExpiresAt: null,
          invitationRevokedAt: null,
          invitationSentAt: createdAt,
          invitationDeliveryStatus: "sent",
          version: 1,
          createdAt,
          updatedAt: createdAt,
        },
      ],
      boards: [
        {
          id: boardId,
          siteId,
          name: "双会话协作看板",
          description: "用于浏览器验收，不连接真实商户数据",
          position: 0,
          status: "active",
          version: 1,
          createdAt,
          updatedAt: createdAt,
        },
        {
          id: secondBoardId,
          siteId,
          name: "浏览器测试第二看板",
          description: "用于验证设置草稿不会串看板",
          position: 1,
          status: "active",
          version: 1,
          createdAt,
          updatedAt: createdAt,
        },
      ],
      columns: [
        {
          id: todoColumnId,
          siteId,
          boardId,
          name: "待处理",
          color: "#64748b",
          position: 0,
          isDone: false,
          status: "active",
          version: 1,
          createdAt,
          updatedAt: createdAt,
        },
        {
          id: doneColumnId,
          siteId,
          boardId,
          name: "已完成",
          color: "#16a34a",
          position: 1,
          isDone: true,
          status: "active",
          version: 1,
          createdAt,
          updatedAt: createdAt,
        },
      ],
      tasks: [],
    },
  };
}

function nextTaskId(state) {
  const suffix = String(state.taskSequence++).padStart(12, "0");
  return `10000000-0000-4000-8000-${suffix}`;
}

function appendTask(state, input) {
  const now = timestamp();
  const task = {
    id: nextTaskId(state),
    siteId,
    boardId,
    columnId: todoColumnId,
    title: String(input.title || "浏览器验收任务"),
    description: String(input.description || ""),
    priority: ["low", "normal", "high", "urgent"].includes(input.priority)
      ? input.priority
      : "normal",
    dueAt: typeof input.dueAt === "string" ? input.dueAt : null,
    completedAt: null,
    archivedAt: null,
    position: state.snapshot.tasks.length,
    sourceType: "",
    sourceId: "",
    createdByEmployeeId: "",
    assigneeIds: Array.isArray(input.assigneeIds) ? input.assigneeIds : [],
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  state.snapshot.tasks.push(task);
  return task;
}

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function installEnterpriseApiMock(
  context,
  state,
  stats = { overviewRequests: 0 },
  options = {},
) {
  const actor = options.actor || state.actor;
  const notifications = options.notifications || [];
  const auditPages = options.auditPages || [[]];
  await context.route("**/api/merchant-enterprise/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const respond = (status, body) =>
      route.fulfill({
        status,
        contentType: "application/json; charset=utf-8",
        headers: { "cache-control": "no-store" },
        body: JSON.stringify(body),
      });

    if (url.pathname === "/api/merchant-enterprise/overview" && request.method() === "GET") {
      stats.overviewRequests += 1;
      return respond(200, {
        ok: true,
        actor: jsonClone(actor),
        snapshot: jsonClone(state.snapshot),
        needsBootstrap: false,
      });
    }
    if (url.pathname === "/api/merchant-enterprise/tasks" && request.method() === "POST") {
      const input = request.postDataJSON();
      return respond(200, { ok: true, task: jsonClone(appendTask(state, input)) });
    }
    if (url.pathname === "/api/merchant-enterprise/notifications" && request.method() === "GET") {
      stats.notificationGets = (stats.notificationGets || 0) + 1;
      return respond(200, {
        ok: true,
        notifications: jsonClone(notifications),
        unreadCount: notifications.filter((notification) => !notification.readAt).length,
        nextCursor: null,
      });
    }
    if (url.pathname === "/api/merchant-enterprise/notifications" && request.method() === "PATCH") {
      stats.notificationPatches = (stats.notificationPatches || 0) + 1;
      const input = request.postDataJSON();
      const readAt = timestamp();
      notifications.forEach((notification) => {
        if (input.all === true || input.notificationId === notification.id) {
          notification.readAt = notification.readAt || readAt;
        }
      });
      return respond(200, {
        ok: true,
        unreadCount: notifications.filter((notification) => !notification.readAt).length,
      });
    }
    if (url.pathname === "/api/merchant-enterprise/audit-events" && request.method() === "GET") {
      stats.auditGets = (stats.auditGets || 0) + 1;
      const pageIndex = url.searchParams.has("cursor") ? 1 : 0;
      const events = auditPages[pageIndex] || [];
      return respond(200, {
        ok: true,
        events: jsonClone(events),
        nextCursor: pageIndex === 0 && auditPages.length > 1 ? "browser-audit-page-2" : null,
      });
    }
    if (url.pathname === "/api/merchant-enterprise/task-events" && request.method() === "GET") {
      return respond(200, { ok: true, events: [] });
    }
    if (url.pathname === "/api/merchant-enterprise/task-checklist" && request.method() === "GET") {
      return respond(200, { ok: true, items: [] });
    }
    return respond(404, { ok: false, error: "browser_test_unhandled_request" });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForServer(baseUrl, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "server_not_ready";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/test-harness/enterprise`, {
        redirect: "manual",
      });
      if (response.status > 0) return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`enterprise_browser_server_timeout:${lastError}`);
}

async function startServer() {
  const configuredBaseUrl = String(process.env.FAOLLA_ENTERPRISE_E2E_BASE_URL || "").trim();
  if (configuredBaseUrl) {
    return { baseUrl: configuredBaseUrl.replace(/\/+$/, ""), child: null };
  }
  const port = Number(process.env.FAOLLA_ENTERPRISE_E2E_PORT || 3117);
  const baseUrl = `http://127.0.0.1:${port}`;
  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root,
    env: {
      ...process.env,
      FAOLLA_ENTERPRISE_E2E_HARNESS: "enabled-for-local-browser-tests",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverError = "";
  child.stderr.on("data", (chunk) => {
    serverError = `${serverError}${String(chunk)}`.slice(-4000);
  });
  child.on("exit", (code) => {
    if (code && !serverError) serverError = `next_start_exit_${code}`;
  });
  try {
    await waitForServer(baseUrl);
    return { baseUrl, child };
  } catch (error) {
    child.kill();
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}${serverError ? `:${serverError}` : ""}`,
    );
  }
}

async function openHarness(context, baseUrl) {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/test-harness/enterprise`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "企业管理" }).waitFor();
  return page;
}

async function run() {
  const state = createSharedState();
  const statsA = { overviewRequests: 0 };
  const statsB = { overviewRequests: 0 };
  const auditCreatedAt = timestamp();
  const auditPages = [
    [
      {
        id: "10000000-0000-4000-8000-000000000020",
        siteId,
        eventType: "role.created",
        entityType: "role",
        entityId: roleId,
        actorType: "owner",
        actorId: null,
        actorLabel: "浏览器测试负责人",
        targetLabel: "仓库主管",
        beforeData: {},
        afterData: { name: "仓库主管", permissions: ["enterprise.view", "tasks.view"] },
        operationId: "browser-audit-role-create",
        createdAt: auditCreatedAt,
      },
    ],
    [
      {
        id: "10000000-0000-4000-8000-000000000021",
        siteId,
        eventType: "board.updated",
        entityType: "board",
        entityId: boardId,
        actorType: "owner",
        actorId: null,
        actorLabel: "浏览器测试负责人",
        targetLabel: "双会话协作看板",
        beforeData: { description: "旧说明" },
        afterData: { description: "新说明" },
        operationId: "browser-audit-board-update",
        createdAt: auditCreatedAt,
      },
    ],
  ];
  const { baseUrl, child } = await startServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const ownerContextA = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "block",
    });
    const ownerContextB = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "block",
    });
    const acceleratePolling = () => {
      const nativeSetInterval = window.setInterval.bind(window);
      window.setInterval = (handler, timeout = 0, ...args) =>
        nativeSetInterval(handler, timeout === 30_000 ? 400 : timeout, ...args);
    };
    await Promise.all([
      ownerContextA.addInitScript(acceleratePolling),
      ownerContextB.addInitScript(acceleratePolling),
      installEnterpriseApiMock(ownerContextA, state, statsA),
      installEnterpriseApiMock(ownerContextB, state, statsB, { auditPages }),
    ]);
    const [pageA, pageB] = await Promise.all([
      openHarness(ownerContextA, baseUrl),
      openHarness(ownerContextB, baseUrl),
    ]);
    let pageBNavigationCount = 0;
    pageB.on("framenavigated", (frame) => {
      if (frame === pageB.mainFrame()) pageBNavigationCount += 1;
    });

    await pageA.getByRole("button", { name: "任务看板", exact: true }).click();
    await pageA.getByLabel("任务标题").fill("双会话创建任务");
    await pageA.getByRole("button", { name: "新建任务", exact: true }).click();
    await pageA.getByText("任务已创建。", { exact: true }).waitFor();
    await pageB.getByText("双会话创建任务", { exact: true }).waitFor({ timeout: 5_000 });

    await pageB.getByRole("button", { name: "任务看板", exact: true }).click();
    const draft = pageB.getByLabel("任务标题");
    await draft.fill("本地未保存草稿");
    await pageB.evaluate(() => {
      globalThis.__enterpriseDraftNavigationMarker = true;
    });
    const activeViewImmediatelyAfterDraft = await pageB
      .locator('[aria-current="page"]')
      .textContent();
    await pageB.waitForTimeout(50);
    const activeViewAtDraft = await pageB.locator('[aria-current="page"]').textContent();
    const overviewRequestsAtDraft = statsB.overviewRequests;
    appendTask(state, { title: "草稿期间的外部更新", priority: "high" });
    await pageB.waitForTimeout(1_000);
    const remoteTaskCount = await pageB
      .getByText("草稿期间的外部更新", { exact: true })
      .count();
    const draftCount = await draft.count();
    const draftValue = draftCount > 0 ? await draft.inputValue({ timeout: 1_000 }) : null;
    assert(
      remoteTaskCount === 0,
      `foreground polling overwrote or exposed remote data while a local draft was active:${JSON.stringify({
        draftCount,
        draftValue,
        currentUrl: pageB.url(),
        pageBNavigationCount,
        navigationMarkerSurvived: await pageB.evaluate(
          () => globalThis.__enterpriseDraftNavigationMarker === true,
        ),
        activeViewImmediatelyAfterDraft,
        activeViewAtDraft,
        activeViewAfterWait: await pageB.locator('[aria-current="page"]').textContent(),
        bodyText: (await pageB.locator("body").innerText()).slice(0, 600),
        overviewRequestsAtDraft,
        overviewRequestsAfterWait: statsB.overviewRequests,
        remoteTaskCount,
      })}`,
    );
    await draft.fill("");
    await pageB.getByText("草稿期间的外部更新", { exact: true }).waitFor({ timeout: 5_000 });

    await pageA.getByRole("button", { name: "管理看板与工作列", exact: true }).click();
    const boardSelector = pageA.getByLabel("当前看板");
    const newColumnDraft = pageA.getByPlaceholder("新工作列名称");
    await newColumnDraft.fill("不可串板的工作列草稿");
    pageA.once("dialog", (dialog) => void dialog.dismiss());
    await boardSelector.selectOption(secondBoardId);
    assert(
      (await boardSelector.inputValue()) === boardId &&
        (await newColumnDraft.inputValue()) === "不可串板的工作列草稿",
      "canceling a board switch discarded or moved the local board-settings draft",
    );
    pageA.once("dialog", (dialog) => void dialog.accept());
    await boardSelector.selectOption(secondBoardId);
    assert(
      (await boardSelector.inputValue()) === secondBoardId &&
        (await pageA.getByPlaceholder("新工作列名称").inputValue()) === "",
      "confirming a board switch did not reset the discarded column draft",
    );
    await pageA.getByPlaceholder("新工作列名称").fill("收起前的工作列草稿");
    pageA.once("dialog", (dialog) => void dialog.dismiss());
    await pageA.getByRole("button", { name: "收起看板设置", exact: true }).click();
    assert(
      (await pageA.getByPlaceholder("新工作列名称").inputValue()) === "收起前的工作列草稿",
      "canceling board-settings collapse discarded its local draft",
    );
    pageA.once("dialog", (dialog) => void dialog.accept());
    await pageA.getByRole("button", { name: "收起看板设置", exact: true }).click();
    await pageA.getByPlaceholder("新工作列名称").waitFor({ state: "hidden" });

    await pageA.getByRole("button", { name: "员工账号", exact: true }).click();
    const firstEmployeeRow = pageA.locator("div.px-5.py-4").filter({
      hasText: "浏览器测试员工",
    }).first();
    const secondEmployeeRow = pageA.locator("div.px-5.py-4").filter({
      hasText: "浏览器测试员工二",
    }).first();
    await firstEmployeeRow.getByRole("button", { name: "编辑姓名", exact: true }).click();
    const firstProfileEditor = pageA.locator(`#employee-profile-editor-${employeeId}`);
    const firstProfileName = firstProfileEditor.getByLabel("员工姓名");
    await firstProfileName.fill("未保存的员工姓名");
    pageA.once("dialog", (dialog) => void dialog.dismiss());
    await secondEmployeeRow.getByRole("button", { name: "编辑姓名", exact: true }).click();
    assert(
      (await firstProfileName.inputValue()) === "未保存的员工姓名" &&
        (await pageA.locator(`#employee-profile-editor-${secondEmployeeId}`).count()) === 0,
      "canceling an employee-editor switch discarded the active employee draft",
    );
    pageA.once("dialog", (dialog) => void dialog.accept());
    await secondEmployeeRow.getByRole("button", { name: "编辑姓名", exact: true }).click();
    await pageA.locator(`#employee-profile-editor-${secondEmployeeId}`).waitFor();
    await firstProfileEditor.waitFor({ state: "hidden" });

    await pageB.getByRole("button", { name: "操作记录", exact: true }).click();
    await pageB.getByRole("heading", { name: "企业操作记录" }).waitFor();
    await pageB.getByText("仓库主管", { exact: true }).first().waitFor();
    await pageB.getByRole("button", { name: "查看更多记录", exact: true }).click();
    await pageB.getByText("“双会话协作看板”", { exact: true }).waitFor();
    assert(statsB.auditGets >= 2, "audit view did not load and paginate through the API mock");

    const notificationTask = state.snapshot.tasks[0];
    notificationTask.assigneeIds = [employeeId];
    const employeeActor = {
      type: "employee",
      id: employeeId,
      siteId,
      displayName: "浏览器测试员工",
      email: "employee@example.test",
      permissions: [
        "enterprise.view",
        "tasks.view",
        "tasks.create",
        "tasks.update",
        "tasks.assign",
      ],
      accessScope: "all",
      allowedBoardIds: [],
    };
    const notifications = [
      {
        id: "10000000-0000-4000-8000-000000000022",
        siteId,
        taskId: notificationTask.id,
        type: "task_assigned",
        actorType: "owner",
        actorId: ownerId,
        payload: {},
        readAt: null,
        createdAt: timestamp(),
      },
    ];
    const employeeStats = {
      overviewRequests: 0,
      notificationGets: 0,
      notificationPatches: 0,
    };
    const employeeContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "block",
    });
    await Promise.all([
      employeeContext.addInitScript(acceleratePolling),
      installEnterpriseApiMock(employeeContext, state, employeeStats, {
        actor: employeeActor,
        notifications,
      }),
    ]);
    const employeePage = await openHarness(employeeContext, baseUrl);
    await employeePage.getByRole("button", { name: "任务看板", exact: true }).click();
    const employeeDraft = employeePage.getByLabel("任务标题");
    await employeeDraft.fill("通知打开前的未保存草稿");
    await employeePage.getByRole("button", { name: /任务通知，1 条未读/ }).click();
    const notificationDialog = employeePage.getByRole("dialog", { name: "任务通知" });
    const notificationButton = notificationDialog
      .getByRole("button")
      .filter({ hasText: notificationTask.title });
    employeePage.once("dialog", (dialog) => void dialog.dismiss());
    await notificationButton.click();
    assert(
      (await employeePage.getByRole("dialog", { name: "编辑任务" }).count()) === 0,
      "canceling notification navigation discarded the local task draft",
    );
    assert(
      (await employeeDraft.inputValue()) === "通知打开前的未保存草稿",
      "canceling notification navigation changed the local task draft",
    );
    assert(
      employeeStats.notificationPatches === 0,
      "a notification was marked read even though opening its task was canceled",
    );

    employeePage.once("dialog", (dialog) => void dialog.accept());
    await notificationButton.click();
    const taskEditor = employeePage.getByRole("dialog", { name: "编辑任务" });
    await taskEditor.waitFor();
    await employeePage.waitForTimeout(100);
    assert(
      employeeStats.notificationPatches === 1,
      "opening a notification task did not persist its read state",
    );
    const taskEditorTitle = taskEditor.getByLabel("任务标题");
    await taskEditorTitle.fill("尚未保存的任务详情标题");
    employeePage.once("dialog", (dialog) => void dialog.dismiss());
    await taskEditor.getByRole("button", { name: "关闭", exact: true }).click();
    await taskEditor.waitFor();
    assert(
      (await taskEditorTitle.inputValue()) === "尚未保存的任务详情标题",
      "canceling task-editor close discarded the local edit",
    );
    employeePage.once("dialog", (dialog) => void dialog.accept());
    await taskEditor.getByRole("button", { name: "关闭", exact: true }).click();
    await taskEditor.waitFor({ state: "hidden" });

    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      serviceWorkers: "block",
    });
    await Promise.all([
      mobileContext.addInitScript(acceleratePolling),
      installEnterpriseApiMock(mobileContext, state),
    ]);
    const mobilePage = await openHarness(mobileContext, baseUrl);
    await mobilePage.getByRole("button", { name: "任务看板", exact: true }).click();
    await mobilePage.getByRole("button", { name: "新建任务", exact: true }).click();
    await mobilePage.getByLabel("任务标题").waitFor();
    const viewport = await mobilePage.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    assert(
      viewport.scrollWidth <= viewport.innerWidth + 1,
      `enterprise mobile layout overflows horizontally:${JSON.stringify(viewport)}`,
    );

    await Promise.all([
      ownerContextA.close(),
      ownerContextB.close(),
      employeeContext.close(),
      mobileContext.close(),
    ]);
    process.stdout.write(
      JSON.stringify({
        ok: true,
        checks: [
          "desktop_owner_task_creation",
          "two_context_foreground_refresh",
          "draft_safe_refresh_pause_and_resume",
          "board_settings_dirty_switch_and_collapse_guards",
          "employee_inline_editor_dirty_switch_guard",
          "owner_audit_listing_and_pagination",
          "employee_notification_dirty_cancel_and_mark_read",
          "task_editor_unsaved_close_guard",
          "mobile_task_composer_and_horizontal_layout",
        ],
      }) + "\n",
    );
  } finally {
    await browser.close().catch(() => undefined);
    child?.kill();
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[enterprise-browser] ${message}\n`);
  process.exitCode = 1;
});
