import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteId = "10000000";
const ownerId = "10000000-0000-4000-8000-000000000001";
const roleId = "10000000-0000-4000-8000-000000000002";
const employeeRoleId = "10000000-0000-4000-8000-000000000012";
const supervisorRoleId = "10000000-0000-4000-8000-000000000013";
const employeeId = "10000000-0000-4000-8000-000000000003";
const boardId = "10000000-0000-4000-8000-000000000004";
const todoColumnId = "10000000-0000-4000-8000-000000000005";
const doneColumnId = "10000000-0000-4000-8000-000000000006";
const secondEmployeeId = "10000000-0000-4000-8000-000000000008";
const secondBoardId = "10000000-0000-4000-8000-000000000009";
const workflowId = "10000000-0000-4000-8000-000000000030";
const firstTodoExecutionId = "10000000-0000-4000-8000-000000000041";
const focusedTodoExecutionId = "10000000-0000-4000-8000-000000000042";
const feedbackTodoExecutionId = "10000000-0000-4000-8000-000000000043";
const automationRuleId = "10000000-0000-4000-8000-000000000051";
const automationRevisionTwoId = "10000000-0000-4000-8000-000000000052";
const automationCompletedRunId = "10000000-0000-4000-8000-000000000053";
const automationFailedRunId = "10000000-0000-4000-8000-000000000054";
const automationAutoPausedRunId = "10000000-0000-4000-8000-000000000055";
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
  "workflows.view",
  "workflows.manage",
  "workflows.publish",
  "automations.view",
  "automations.manage",
];

function timestamp() {
  return new Date().toISOString();
}

function createSharedState() {
  const createdAt = timestamp();
  return {
    taskSequence: 10,
    workflowSequence: 30,
    workflowRevisionSequence: 38,
    checklistSequence: 40,
    taskEventSequence: 50,
    workflowConflictNextSave: false,
    workflows: [],
    taskWorkflowBindings: {},
    taskChecklistItems: {},
    taskEvents: {},
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
        {
          id: employeeRoleId,
          siteId,
          name: "员工",
          description: "浏览器验收员工角色",
          permissions: ["enterprise.view", "tasks.view"],
          accessScope: "all",
          allowedBoardIds: [],
          status: "active",
          isSystem: true,
          version: 1,
          createdAt,
          updatedAt: createdAt,
        },
        {
          id: supervisorRoleId,
          siteId,
          name: "主管",
          description: "浏览器验收主管角色",
          permissions: ["enterprise.view", "tasks.view", "tasks.create", "tasks.update"],
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

function buildCurrentOperationsResponse(snapshot, actor, requestedEmployeeId = "") {
  const asOf = timestamp();
  const nowMs = Date.parse(asOf);
  const dueSoonBoundaryMs = nowMs + 7 * 24 * 60 * 60 * 1000;
  const employeeId = requestedEmployeeId || (actor.type === "employee" ? actor.id : null);
  const boards = snapshot.boards
    .filter((board) => board.status === "active")
    .filter(
      (board) =>
        actor.type === "owner" ||
        actor.accessScope === "all" ||
        actor.allowedBoardIds.includes(board.id),
    );
  const activeBoardIds = new Set(boards.map((board) => board.id));
  const tasks = snapshot.tasks.filter(
    (task) =>
      !task.archivedAt &&
      !task.completedAt &&
      activeBoardIds.has(task.boardId) &&
      (!employeeId || task.assigneeIds.includes(employeeId)),
  );
  const urgencyCounts = (items) => {
    let overdueTaskCount = 0;
    let dueSoonTaskCount = 0;
    for (const task of items) {
      const dueAtMs = task.dueAt ? Date.parse(task.dueAt) : Number.NaN;
      if (!Number.isFinite(dueAtMs)) continue;
      if (dueAtMs < nowMs) overdueTaskCount += 1;
      else if (dueAtMs < dueSoonBoundaryMs) dueSoonTaskCount += 1;
    }
    return { overdueTaskCount, dueSoonTaskCount };
  };
  const boardSummaries = boards
    .map((board) => {
      const boardTasks = tasks.filter((task) => task.boardId === board.id);
      return {
        boardId: board.id,
        boardName: board.name,
        openTaskCount: boardTasks.length,
        ...urgencyCounts(boardTasks),
      };
    })
    .sort(
      (left, right) =>
        right.overdueTaskCount - left.overdueTaskCount ||
        right.openTaskCount - left.openTaskCount ||
        left.boardName.localeCompare(right.boardName) ||
        left.boardId.localeCompare(right.boardId),
    );
  const totalUrgency = urgencyCounts(tasks);
  const priorityTasks = [...tasks]
    .sort((left, right) => {
      const dueSort = (task) => {
        const dueAtMs = task.dueAt ? Date.parse(task.dueAt) : Number.NaN;
        if (!Number.isFinite(dueAtMs)) return 2;
        return dueAtMs < nowMs ? 0 : dueAtMs < dueSoonBoundaryMs ? 1 : 2;
      };
      return (
        dueSort(left) - dueSort(right) ||
        String(right.updatedAt).localeCompare(String(left.updatedAt)) ||
        left.id.localeCompare(right.id)
      );
    })
    .slice(0, 6)
    .map((task) => ({
      id: task.id,
      boardId: task.boardId,
      boardName: boards.find((board) => board.id === task.boardId)?.name || "未知看板",
      columnId: task.columnId,
      columnName:
        snapshot.columns.find((column) => column.id === task.columnId)?.name || "未分类",
      title: task.title,
      priority: task.priority,
      dueAt: task.dueAt,
      updatedAt: task.updatedAt,
      assigneeCount: task.assigneeIds.length,
    }));
  return {
    ok: true,
    asOf,
    scope: employeeId ? "employee" : "enterprise",
    employeeId,
    scopeRestricted: actor.type === "employee" && actor.accessScope !== "all",
    boardSummaryTotalCount: boardSummaries.length,
    boardsTruncated: false,
    summary: {
      openTaskCount: tasks.length,
      ...totalUrgency,
      unassignedTaskCount: employeeId
        ? null
        : tasks.filter((task) => task.assigneeIds.length === 0).length,
      involvedBoardCount: boardSummaries.filter((board) => board.openTaskCount > 0).length,
      sharedAssignmentTaskCount: employeeId
        ? tasks.filter((task) => task.assigneeIds.length > 1).length
        : null,
    },
    boards: boardSummaries,
    priorityTasks,
  };
}

function nextWorkflowId(state) {
  const suffix = String(state.workflowSequence++).padStart(12, "0");
  return `10000000-0000-4000-8000-${suffix}`;
}

function nextWorkflowRevisionId(state) {
  const suffix = String(state.workflowRevisionSequence++).padStart(12, "0");
  return `10000000-0000-4000-8000-${suffix}`;
}

function nextChecklistId(state) {
  const suffix = String(state.checklistSequence++).padStart(12, "0");
  return `10000000-0000-4000-8000-${suffix}`;
}

function nextTaskEventId(state) {
  const suffix = String(state.taskEventSequence++).padStart(12, "0");
  return `10000000-0000-4000-8000-${suffix}`;
}

function workflowFields(input) {
  return {
    title: String(input.title || ""),
    scenario: String(input.scenario || ""),
    description: String(input.description || ""),
    category: String(input.category || ""),
    tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
    steps: Array.isArray(input.steps)
      ? input.steps.map((step, position) => ({
          id: String(step.id || ""),
          title: String(step.title || ""),
          instruction: String(step.instruction || ""),
          position,
        }))
      : [],
  };
}

function currentWorkflowDto(workflow) {
  return {
    id: workflow.id,
    siteId: workflow.siteId,
    ...jsonClone(workflow.draft),
    status: workflow.status,
    version: workflow.version,
    publishedVersion: workflow.publishedVersion,
    publishedAt: workflow.publishedAt,
    hasUnpublishedChanges: workflow.hasUnpublishedChanges,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
  };
}

function publishedWorkflowDto(workflow) {
  if (!workflow.published || workflow.status !== "published") return null;
  return {
    id: workflow.id,
    siteId: workflow.siteId,
    ...jsonClone(workflow.published.fields),
    status: "published",
    version: workflow.published.version,
    publishedVersion: workflow.published.version,
    publishedAt: workflow.published.publishedAt,
    hasUnpublishedChanges: false,
    createdAt: workflow.createdAt,
    updatedAt: workflow.published.publishedAt,
  };
}

function workflowListForActor(state, actor) {
  const canReadDrafts =
    actor.type === "owner" ||
    actor.permissions.includes("workflows.manage") ||
    actor.permissions.includes("workflows.publish");
  return state.workflows
    .map((workflow) =>
      canReadDrafts ? currentWorkflowDto(workflow) : publishedWorkflowDto(workflow),
    )
    .filter(Boolean)
    .filter((workflow) => workflow.status !== "archived");
}

function archivedWorkflowListForActor(state, actor, url) {
  const canReadDrafts =
    actor.type === "owner" ||
    actor.permissions.includes("workflows.manage") ||
    actor.permissions.includes("workflows.publish");
  if (!canReadDrafts) return null;
  const query = (url.searchParams.get("q") || "").trim().toLocaleLowerCase();
  const scenario = url.searchParams.get("scenario") || "";
  const tag = url.searchParams.get("tag") || "";
  return state.workflows
    .filter((workflow) => workflow.status === "archived")
    .map(currentWorkflowDto)
    .filter((workflow) => !scenario || workflow.scenario === scenario)
    .filter((workflow) => !tag || workflow.tags.includes(tag))
    .filter((workflow) => {
      if (!query) return true;
      return [
        workflow.title,
        workflow.scenario,
        workflow.description,
        workflow.category,
        ...workflow.tags,
        ...workflow.steps.flatMap((step) => [step.title, step.instruction]),
      ]
        .join("\n")
        .toLocaleLowerCase()
        .includes(query);
    })
    .sort(
      (left, right) =>
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
        right.id.localeCompare(left.id),
    );
}

function actorCan(actor, permission) {
  return actor.type === "owner" || actor.permissions.includes(permission);
}

function todoCounts(items) {
  const tasks = items.filter((item) => item.kind === "task");
  return {
    openCount: items.length,
    taskCount: tasks.length,
    overdueCount: tasks.filter((item) => item.urgency === "overdue").length,
    dueSoonCount: tasks.filter((item) => item.urgency === "due_soon").length,
    acknowledgementCount: items.filter(
      (item) => item.kind === "workflow_acknowledgement",
    ).length,
    executionCount: items.filter((item) => item.kind === "workflow_execution").length,
    feedbackCount: items.filter((item) => item.kind === "workflow_feedback").length,
  };
}

function createWorkflow(state, input) {
  const now = timestamp();
  const workflow = {
    id: nextWorkflowId(state),
    siteId,
    draft: workflowFields(input),
    published: null,
    status: "draft",
    version: 1,
    publishedVersion: 0,
    publishedAt: null,
    hasUnpublishedChanges: true,
    createdAt: now,
    updatedAt: now,
  };
  state.workflows.unshift(workflow);
  return workflow;
}

function updateWorkflowDraft(workflow, input) {
  workflow.draft = workflowFields(input);
  workflow.version += 1;
  workflow.updatedAt = timestamp();
  workflow.hasUnpublishedChanges = true;
  return workflow;
}

function publishWorkflow(state, workflow) {
  const publishedAt = timestamp();
  const publishedVersion = workflow.publishedVersion + 1;
  workflow.version += 1;
  workflow.publishedVersion = publishedVersion;
  workflow.publishedAt = publishedAt;
  workflow.published = {
    fields: jsonClone(workflow.draft),
    revisionId: nextWorkflowRevisionId(state),
    version: publishedVersion,
    publishedAt,
  };
  workflow.status = "published";
  workflow.hasUnpublishedChanges = false;
  workflow.updatedAt = publishedAt;
  return workflow;
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
  const overviewSnapshot = options.snapshot || state.snapshot;
  const automationState = options.automationState || {
    rules: [],
    runs: [],
    sourceAvailability: { order: "inactive", booking: "inactive" },
  };
  const publishedWorkflowChoices = () =>
    options.publishedWorkflowChoices ||
    state.workflows
      .filter((workflow) => workflow.status === "published" && workflow.published)
      .map((workflow) => ({
        id: workflow.id,
        title: workflow.published.fields.title,
        scenario: workflow.published.fields.scenario,
        revisionId: workflow.published.revisionId,
        revisionNo: workflow.published.version,
        stepCount: workflow.published.fields.steps.length,
      }));
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
        snapshot: jsonClone(overviewSnapshot),
        needsBootstrap: false,
      });
    }
    if (
      url.pathname === "/api/merchant-enterprise/current-operations" &&
      request.method() === "GET"
    ) {
      stats.currentOperationsGets = (stats.currentOperationsGets || 0) + 1;
      const requestedEmployeeId = url.searchParams.get("employeeId") || "";
      stats.currentOperationsRequests = [
        ...(stats.currentOperationsRequests || []),
        { siteId: url.searchParams.get("siteId") || "", employeeId: requestedEmployeeId },
      ];
      if (url.searchParams.get("siteId") !== siteId) {
        return respond(400, { ok: false, error: "invalid_site_id" });
      }
      return respond(
        200,
        buildCurrentOperationsResponse(overviewSnapshot, actor, requestedEmployeeId),
      );
    }
    if (url.pathname === "/api/merchant-enterprise/todos" && request.method() === "GET") {
      stats.todoGets = (stats.todoGets || 0) + 1;
      const category = url.searchParams.get("category") || "";
      const limit = Number(url.searchParams.get("limit") || "0");
      const cursor = url.searchParams.get("cursor");
      stats.todoRequests = [
        ...(stats.todoRequests || []),
        { category, limit, cursor },
      ];
      if (!actorCan(actor, "enterprise.view")) {
        return respond(403, { ok: false, error: "permission_denied" });
      }
      const cursorMatch = cursor?.match(/^browser_todo_(\d+)$/) || null;
      if (
        url.searchParams.get("siteId") !== siteId ||
        !["all", "tasks", "workflows"].includes(category) ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 50 ||
        (cursor !== null && !cursorMatch)
      ) {
        return respond(400, { ok: false, error: "invalid_enterprise_todo_query" });
      }
      const allItems = options.todoItems || [];
      const categoryItems = allItems.filter((item) =>
        category === "all"
          ? true
          : category === "tasks"
            ? item.kind === "task"
            : item.kind !== "task",
      );
      const offset = cursorMatch ? Number(cursorMatch[1]) : 0;
      const items = categoryItems.slice(offset, offset + limit);
      const nextOffset = offset + items.length;
      return respond(200, {
        ok: true,
        merchantId: siteId,
        items: jsonClone(items),
        counts: todoCounts(allItems),
        nextCursor:
          nextOffset < categoryItems.length ? `browser_todo_${nextOffset}` : null,
      });
    }
    if (url.pathname === "/api/merchant-enterprise/workflows" && request.method() === "GET") {
      stats.workflowGets = (stats.workflowGets || 0) + 1;
      const exactWorkflowId = url.searchParams.get("workflowId");
      if (exactWorkflowId) {
        stats.workflowExactGets = (stats.workflowExactGets || 0) + 1;
        if (options.workflowExactDelayMs) {
          await new Promise((resolve) => setTimeout(resolve, options.workflowExactDelayMs));
        }
        const source = state.workflows.find((workflow) => workflow.id === exactWorkflowId);
        const canReadDrafts =
          actor.type === "owner" ||
          actor.permissions.includes("workflows.manage") ||
          actor.permissions.includes("workflows.publish");
        const workflow = source
          ? canReadDrafts
            ? currentWorkflowDto(source)
            : publishedWorkflowDto(source)
          : null;
        if (!workflow) return respond(404, { ok: false, error: "workflow_not_found" });
        return respond(200, { ok: true, workflow: jsonClone(workflow) });
      }
      if (url.searchParams.get("scope") === "archived") {
        stats.workflowArchiveGets = (stats.workflowArchiveGets || 0) + 1;
        if (options.workflowArchiveDelayMs) {
          await new Promise((resolve) => setTimeout(resolve, options.workflowArchiveDelayMs));
        }
        const archived = archivedWorkflowListForActor(state, actor, url);
        if (!archived) return respond(403, { ok: false, error: "permission_denied" });
        const limit = Number(url.searchParams.get("limit") || "20");
        const cursorText = url.searchParams.get("cursor") || "0";
        const offset = Number(cursorText);
        if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(offset) || offset < 0) {
          return respond(400, { ok: false, error: "invalid_workflow_cursor" });
        }
        const workflows = archived.slice(offset, offset + limit);
        const nextOffset = offset + workflows.length;
        return respond(200, {
          ok: true,
          workflows: jsonClone(workflows),
          nextCursor: nextOffset < archived.length ? String(nextOffset) : null,
        });
      }
      if (!url.searchParams.has("scope")) {
        const canReadDrafts =
          actor.type === "owner" ||
          actor.permissions.includes("workflows.manage") ||
          actor.permissions.includes("workflows.publish");
        return respond(200, {
          ok: true,
          workflows: jsonClone(
            canReadDrafts
              ? state.workflows.map(currentWorkflowDto)
              : workflowListForActor(state, actor),
          ),
          nextCursor: null,
        });
      }
      return respond(200, {
        ok: true,
        workflows: jsonClone(workflowListForActor(state, actor)),
        nextCursor: null,
      });
    }
    if (url.pathname === "/api/merchant-enterprise/workflows" && request.method() === "POST") {
      stats.workflowPosts = (stats.workflowPosts || 0) + 1;
      if (!actorCan(actor, "workflows.manage")) {
        return respond(403, { ok: false, error: "permission_denied" });
      }
      const input = request.postDataJSON();
      const workflow = createWorkflow(state, input);
      stats.workflowMutations = [
        ...(stats.workflowMutations || []),
        { method: "POST", action: "create", body: jsonClone(input) },
      ];
      return respond(200, { ok: true, workflow: currentWorkflowDto(workflow) });
    }
    if (url.pathname === "/api/merchant-enterprise/workflows" && request.method() === "PATCH") {
      const input = request.postDataJSON();
      const action = String(input.action || "");
      const requiredPermission = action === "save" ? "workflows.manage" : "workflows.publish";
      stats.workflowPatches = (stats.workflowPatches || 0) + 1;
      stats.workflowMutations = [
        ...(stats.workflowMutations || []),
        { method: "PATCH", action, body: jsonClone(input) },
      ];
      if (!actorCan(actor, requiredPermission)) {
        return respond(403, { ok: false, error: "permission_denied" });
      }
      const workflow = state.workflows.find((item) => item.id === input.workflowId);
      if (!workflow) return respond(404, { ok: false, error: "workflow_not_found" });
      if (action === "save" && state.workflowConflictNextSave) {
        state.workflowConflictNextSave = false;
        return respond(409, { ok: false, error: "enterprise_version_conflict" });
      }
      if (Number(input.version) !== workflow.version) {
        return respond(409, { ok: false, error: "enterprise_version_conflict" });
      }
      if (action === "save") {
        updateWorkflowDraft(workflow, input);
      } else if (action === "publish") {
        publishWorkflow(state, workflow);
      } else if (action === "archive") {
        workflow.status = "archived";
        workflow.version += 1;
        workflow.updatedAt = timestamp();
      } else if (action === "restore") {
        workflow.status = workflow.published ? "published" : "draft";
        workflow.version += 1;
        workflow.updatedAt = timestamp();
      } else {
        return respond(400, { ok: false, error: "invalid_request" });
      }
      return respond(200, { ok: true, workflow: currentWorkflowDto(workflow) });
    }
    if (
      url.pathname === "/api/merchant-enterprise/workflow-permission-gaps" &&
      request.method() === "GET"
    ) {
      stats.workflowPermissionGapGets = (stats.workflowPermissionGapGets || 0) + 1;
      return respond(200, { ok: true, gaps: [] });
    }
    if (
      url.pathname === "/api/merchant-enterprise/workflow-executions" &&
      request.method() === "GET"
    ) {
      const workflow = state.workflows.find(
        (item) => item.id === url.searchParams.get("workflowId"),
      );
      if (!workflow?.published || workflow.status !== "published") {
        return respond(404, { ok: false, error: "workflow_not_found" });
      }
      if (url.searchParams.get("scope") === "stats") {
        stats.workflowStatsGets = (stats.workflowStatsGets || 0) + 1;
        if (options.workflowExecutionStats) {
          return respond(200, {
            ok: true,
            stats: jsonClone(options.workflowExecutionStats),
          });
        }
        return respond(200, {
          ok: true,
          stats: {
            merchantId: siteId,
            workflowId: workflow.id,
            currentRevisionNo: workflow.published.version,
            eligibleEmployeeCount: state.snapshot.employees.filter(
              (employee) => employee.status === "active",
            ).length,
            acknowledgedEmployeeCount: 0,
            executionCount: 0,
            inProgressCount: 0,
            completedCount: 0,
            taskLinkedExecutionCount: 0,
            generatedChecklistCount: 0,
            feedbackCount: 0,
            openFeedbackCount: 0,
            averageRating: null,
            participants: state.snapshot.employees
              .filter((employee) => employee.status === "active")
              .map((employee) => ({
                employeeId: employee.id,
                employeeName: employee.displayName,
                acknowledgedAt: null,
                executionCount: 0,
                completedCount: 0,
                lastActivityAt: null,
              })),
            recentFeedback: [],
          },
        });
      }
      stats.workflowMineGets = (stats.workflowMineGets || 0) + 1;
      return respond(200, {
        ok: true,
        currentRevisionNo: workflow.published.version,
        acknowledgement: options.workflowAcknowledgement
          ? jsonClone(options.workflowAcknowledgement)
          : null,
        executions: jsonClone(options.workflowExecutions || []),
      });
    }
    if (
      url.pathname === "/api/merchant-enterprise/workflow-revisions" &&
      request.method() === "GET"
    ) {
      stats.workflowRevisionGets = (stats.workflowRevisionGets || 0) + 1;
      const workflow = state.workflows.find(
        (item) => item.id === url.searchParams.get("workflowId"),
      );
      if (!workflow?.published) {
        return respond(404, { ok: false, error: "workflow_not_found" });
      }
      const revision = {
        id: workflow.published.revisionId,
        revisionNo: workflow.published.version,
        publishedAt: workflow.published.publishedAt,
        snapshot: jsonClone(workflow.published.fields),
      };
      if (url.searchParams.has("revision")) {
        if (Number(url.searchParams.get("revision")) !== revision.revisionNo) {
          return respond(404, { ok: false, error: "workflow_revision_not_found" });
        }
        return respond(200, {
          ok: true,
          revision,
          previousRevision: null,
          workflow: { canRestore: true },
        });
      }
      return respond(200, {
        ok: true,
        revisions: [
          {
            id: revision.id,
            revisionNo: revision.revisionNo,
            publishedAt: revision.publishedAt,
            title: revision.snapshot.title,
            scenario: revision.snapshot.scenario,
            category: revision.snapshot.category,
            tags: revision.snapshot.tags,
            stepCount: revision.snapshot.steps.length,
            isCurrent: true,
          },
        ],
        nextBeforeRevision: null,
      });
    }
    if (
      url.pathname === "/api/merchant-enterprise/published-workflows" &&
      request.method() === "GET"
    ) {
      stats.publishedWorkflowGets = (stats.publishedWorkflowGets || 0) + 1;
      const choices = publishedWorkflowChoices();
      return respond(200, { ok: true, choices: jsonClone(choices) });
    }
    if (
      url.pathname === "/api/merchant-enterprise/workflow-automations" &&
      request.method() === "GET"
    ) {
      stats.automationGets = (stats.automationGets || 0) + 1;
      if (
        url.searchParams.get("siteId") !== siteId ||
        !actorCan(actor, "automations.view")
      ) {
        return respond(403, { ok: false, error: "permission_denied" });
      }
      return respond(200, {
        ok: true,
        rules: jsonClone(
          automationState.rules.filter((rule) => rule.status !== "archived"),
        ),
        runs: jsonClone(automationState.runs),
        sourceAvailability: jsonClone(automationState.sourceAvailability),
      });
    }
    if (
      url.pathname === "/api/merchant-enterprise/workflow-automations" &&
      ["POST", "PATCH"].includes(request.method())
    ) {
      const method = request.method();
      const input = request.postDataJSON();
      stats.automationMutations = [
        ...(stats.automationMutations || []),
        { method, body: jsonClone(input) },
      ];
      if (!actorCan(actor, "automations.manage")) {
        return respond(403, { ok: false, error: "permission_denied" });
      }
      if (method === "PATCH" && input.action === "archive") {
        const index = automationState.rules.findIndex(
          (candidate) => candidate.id === input.ruleId,
        );
        const current = automationState.rules[index];
        if (!current) return respond(404, { ok: false, error: "automation_rule_not_found" });
        if (current.status === "archived") {
          return respond(409, { ok: false, error: "automation_rule_archived" });
        }
        if (Number(input.expectedVersion) !== current.version) {
          return respond(409, { ok: false, error: "enterprise_version_conflict" });
        }
        const now = timestamp();
        const archivedRule = {
          ...current,
          status: "archived",
          archivedAt: now,
          version: current.version + 1,
          updatedAt: now,
        };
        automationState.rules[index] = archivedRule;
        stats.automationPatches = (stats.automationPatches || 0) + 1;
        return respond(200, {
          ok: true,
          rule: jsonClone(archivedRule),
          sourceAvailability: jsonClone(automationState.sourceAvailability),
        });
      }
      if (
        input.status === "active" &&
        automationState.sourceAvailability[input.sourceType] !== "active"
      ) {
        return respond(409, {
          ok: false,
          error: "source_event_stream_unavailable",
          sourceAvailability: jsonClone(automationState.sourceAvailability),
        });
      }
      if (
        /\{(?!eventRef\}|fromStatus\}|toStatus\})[^{}]*\}/.test(
          `${input.taskTitle || ""}\n${input.taskDescription || ""}`,
        )
      ) {
        return respond(400, { ok: false, error: "invalid_request" });
      }
      const workflow = publishedWorkflowChoices().find(
        (choice) => choice.id === input.workflowId,
      );
      if (!workflow) {
        return respond(409, { ok: false, error: "workflow_not_published" });
      }
      const selectedRevision =
        input.workflowRevisionId === workflow.revisionId
          ? workflow.revisionNo
          : automationState.rules.find((rule) => rule.id === input.ruleId)
              ?.workflowRevisionNo;
      if (!selectedRevision) {
        return respond(409, { ok: false, error: "workflow_revision_changed" });
      }
      const now = timestamp();
      let rule;
      if (method === "POST") {
        rule = {
          id: automationRuleId,
          siteId,
          name: input.name,
          sourceType: input.sourceType,
          eventType: input.eventType,
          fromStatus: input.fromStatus ?? null,
          toStatus: input.toStatus ?? null,
          boardId: input.boardId,
          columnId: input.columnId,
          workflowId: input.workflowId,
          workflowRevisionId: input.workflowRevisionId,
          workflowRevisionNo: selectedRevision,
          taskTitle: input.taskTitle,
          taskDescription: input.taskDescription,
          priority: input.priority,
          dueOffsetMinutes: input.dueOffsetMinutes,
          status: input.status,
          assigneeIds: input.assigneeIds,
          version: 1,
          enabledAt: now,
          archivedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        automationState.rules.unshift(rule);
        stats.automationPosts = (stats.automationPosts || 0) + 1;
      } else {
        const index = automationState.rules.findIndex(
          (candidate) => candidate.id === input.ruleId,
        );
        const current = automationState.rules[index];
        if (!current) return respond(404, { ok: false, error: "automation_rule_not_found" });
        if (Number(input.expectedVersion) !== current.version) {
          return respond(409, { ok: false, error: "enterprise_version_conflict" });
        }
        rule = {
          ...current,
          name: input.name,
          sourceType: input.sourceType,
          eventType: input.eventType,
          fromStatus: input.fromStatus ?? null,
          toStatus: input.toStatus ?? null,
          boardId: input.boardId,
          columnId: input.columnId,
          workflowId: input.workflowId,
          workflowRevisionId: input.workflowRevisionId,
          workflowRevisionNo: selectedRevision,
          taskTitle: input.taskTitle,
          taskDescription: input.taskDescription,
          priority: input.priority,
          dueOffsetMinutes: input.dueOffsetMinutes,
          status: input.status,
          assigneeIds: input.assigneeIds,
          version: current.version + 1,
          updatedAt: now,
        };
        automationState.rules[index] = rule;
        stats.automationPatches = (stats.automationPatches || 0) + 1;
      }
      return respond(200, {
        ok: true,
        rule: jsonClone(rule),
        sourceAvailability: jsonClone(automationState.sourceAvailability),
      });
    }
    if (
      url.pathname === "/api/merchant-enterprise/task-workflow" &&
      request.method() === "GET"
    ) {
      stats.taskWorkflowGets = (stats.taskWorkflowGets || 0) + 1;
      const taskId = url.searchParams.get("taskId") || "";
      return respond(200, {
        ok: true,
        binding: state.taskWorkflowBindings[taskId]
          ? jsonClone(state.taskWorkflowBindings[taskId])
          : null,
      });
    }
    if (
      url.pathname === "/api/merchant-enterprise/task-workflow" &&
      request.method() === "POST"
    ) {
      stats.taskWorkflowPosts = (stats.taskWorkflowPosts || 0) + 1;
      const input = request.postDataJSON();
      const task = state.snapshot.tasks.find((item) => item.id === input.taskId);
      const workflow = state.workflows.find((item) => item.id === input.workflowId);
      if (!task) return respond(404, { ok: false, error: "task_not_found" });
      if (!workflow?.published || workflow.status !== "published") {
        return respond(409, { ok: false, error: "workflow_not_published" });
      }
      if (state.taskWorkflowBindings[task.id]) {
        return respond(409, { ok: false, error: "task_workflow_already_bound" });
      }
      if (workflow.published.revisionId !== input.expectedRevisionId) {
        return respond(409, { ok: false, error: "workflow_revision_changed" });
      }
      const boundAt = timestamp();
      const steps = jsonClone(workflow.published.fields.steps);
      const binding = {
        siteId,
        taskId: task.id,
        workflowId: workflow.id,
        revisionId: workflow.published.revisionId,
        revisionNo: workflow.published.version,
        title: workflow.published.fields.title,
        scenario: workflow.published.fields.scenario,
        description: workflow.published.fields.description,
        category: workflow.published.fields.category,
        tags: jsonClone(workflow.published.fields.tags),
        steps,
        boundAt,
        generatedChecklistCount: steps.length,
      };
      const checklistItems = steps.map((step, index) => ({
        id: nextChecklistId(state),
        siteId,
        taskId: task.id,
        text: step.title,
        position: (index + 1) * 1024,
        completed: false,
        completedAt: null,
        archivedAt: null,
        version: 1,
        createdAt: boundAt,
        updatedAt: boundAt,
      }));
      const event = {
        id: nextTaskEventId(state),
        siteId,
        taskId: task.id,
        eventType: "workflow_bound",
        actorType: actor.type,
        actorId: actor.type === "employee" ? actor.id : "",
        payload: {
          workflowId: workflow.id,
          revisionId: workflow.published.revisionId,
          revisionNo: workflow.published.version,
          generatedChecklistCount: steps.length,
        },
        createdAt: boundAt,
      };
      state.taskWorkflowBindings[task.id] = binding;
      state.taskChecklistItems[task.id] = checklistItems;
      state.taskEvents[task.id] = [event];
      return respond(200, {
        ok: true,
        binding: jsonClone(binding),
        createdChecklistItems: jsonClone(checklistItems),
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
      stats.taskEventGets = (stats.taskEventGets || 0) + 1;
      const taskId = url.searchParams.get("taskId") || "";
      return respond(200, {
        ok: true,
        events: jsonClone(state.taskEvents[taskId] || []),
      });
    }
    if (url.pathname === "/api/merchant-enterprise/task-checklist" && request.method() === "GET") {
      stats.taskChecklistGets = (stats.taskChecklistGets || 0) + 1;
      const taskId = url.searchParams.get("taskId") || "";
      return respond(200, {
        ok: true,
        items: jsonClone(state.taskChecklistItems[taskId] || []),
      });
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
    return {
      baseUrl: configuredBaseUrl.replace(/\/+$/, ""),
      child: null,
      readServerOutput: () => "",
    };
  }
  const port = Number(process.env.FAOLLA_ENTERPRISE_E2E_PORT || 3117);
  const baseUrl = `http://127.0.0.1:${port}`;
  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const serverMode = process.env.FAOLLA_ENTERPRISE_E2E_SERVER_MODE === "dev"
    ? "dev"
    : "start";
  const child = spawn(process.execPath, [
    nextBin,
    serverMode,
    ...(serverMode === "dev" ? ["--webpack"] : []),
    "-H",
    "127.0.0.1",
    "-p",
    String(port),
  ], {
    cwd: root,
    env: {
      ...process.env,
      FAOLLA_ENTERPRISE_E2E_HARNESS: "enabled-for-local-browser-tests",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverError = "";
  let serverOutput = "";
  child.stdout.on("data", (chunk) => {
    serverOutput = `${serverOutput}${String(chunk)}`.slice(-8000);
  });
  child.stderr.on("data", (chunk) => {
    serverError = `${serverError}${String(chunk)}`.slice(-4000);
    serverOutput = `${serverOutput}${String(chunk)}`.slice(-8000);
  });
  child.on("exit", (code) => {
    if (code && !serverError) serverError = `next_start_exit_${code}`;
  });
  try {
    await waitForServer(baseUrl);
    return { baseUrl, child, readServerOutput: () => serverOutput };
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

async function installEmployeeWorkspaceApiMock(context, mode, stats) {
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const respond = (status, payload) =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
        body: JSON.stringify(payload),
      });

    if (
      url.pathname === "/api/merchant-business/capabilities" &&
      request.method() === "GET"
    ) {
      stats.capabilityRequests += 1;
      if (mode === "unavailable") {
        return respond(503, { ok: false, error: "temporarily_unavailable" });
      }
      const fiveMenus = mode === "five-menus";
      return respond(200, {
        ok: true,
        schemaVersion: 1,
        actor: {
          type: "employee",
          displayName: "浏览器验收员工",
          principalKey: "employee:10000000-0000-4000-8000-000000000099",
          authorizationVersion: "1:1",
        },
        cacheNamespace: fiveMenus
          ? "employee-workspace-browser-five-menus"
          : "employee-workspace-browser-members-only",
        collaborationPermissions: [],
        permissions: fiveMenus
          ? [
              "redemptions.view",
              "bookings.view",
              "orders.view",
              "conversations.view",
              "members.view",
            ]
          : ["members.view"],
        workspace: {
          siteId,
          siteName: "浏览器验收商户",
          siteCountryCode: "ES",
          ...(fiveMenus
            ? {
                booking: {
                  storeOptions: [],
                  itemOptions: [],
                  titleOptions: [],
                  bookingRulesSnapshot: null,
                  allowBookingEmailPrefill: false,
                  allowCustomerAutoEmail: false,
                },
              }
            : {}),
        },
      });
    }

    if (
      url.pathname === "/api/merchant-enterprise/overview" &&
      request.method() === "GET"
    ) {
      stats.enterpriseOverviewRequests += 1;
      return respond(500, { ok: false, error: "unexpected_enterprise_mount" });
    }

    if (url.pathname === "/api/memberships" && request.method() === "GET") {
      stats.membershipRequests += 1;
      return respond(200, {
        ok: true,
        memberships: [],
        total: 0,
        allTotal: 0,
        hasMore: false,
        version: "employee-workspace-browser-memberships-v1",
      });
    }

    return respond(404, { ok: false, error: "employee_workspace_browser_unhandled_request" });
  });
}

async function runEmployeeWorkspaceRootRegression(browser, baseUrl, screenshotDirectory) {
  const fiveMenuStats = {
    capabilityRequests: 0,
    enterpriseOverviewRequests: 0,
    membershipRequests: 0,
  };
  const fiveMenuContext = await browser.newContext({
    viewport: { width: 1920, height: 944 },
    serviceWorkers: "block",
    locale: "zh-CN",
  });
  try {
    await installEmployeeWorkspaceApiMock(fiveMenuContext, "five-menus", fiveMenuStats);
    const fiveMenuPage = await fiveMenuContext.newPage();
    await fiveMenuPage.goto(`${baseUrl}/test-harness/employee-workspace`, {
      waitUntil: "domcontentloaded",
    });
    const fiveMenuNavigation = fiveMenuPage
      .locator('[data-employee-merchant-sidebar="1"]')
      .getByRole("navigation", { name: "员工工作区主导航" });
    await fiveMenuNavigation
      .getByRole("button", { name: "积分兑换", exact: true })
      .waitFor();
    const redemptionContextNavigation = fiveMenuPage
      .locator('[data-employee-merchant-sidebar="1"]')
      .getByRole("navigation", { name: "积分兑换子菜单" });
    await redemptionContextNavigation
      .getByRole("button", { name: "兑换记录", exact: true })
      .waitFor();
    const fiveMenuSidebar = fiveMenuPage.locator(
      '[data-employee-merchant-sidebar="1"]',
    );
    const fiveMenuCashier = fiveMenuPage.locator(
      '[data-employee-merchant-content="business"] .merchant-pos-cashier',
    );
    await fiveMenuCashier.waitFor();
    const fiveMenuSidebarBox = await fiveMenuSidebar.boundingBox();
    const fiveMenuCashierBox = await fiveMenuCashier.boundingBox();
    const fiveMenuLayoutMetrics = await fiveMenuPage.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    const fiveMenuLabels = await fiveMenuNavigation
      .getByRole("button")
      .allTextContents();
    assert(
      JSON.stringify(fiveMenuLabels.map((label) => label.trim())) ===
        JSON.stringify(["积分兑换", "预约管理", "订单管理", "会话", "会员管理"]) &&
        (await fiveMenuNavigation.getByRole("button", { name: "积分兑换", exact: true }).getAttribute("aria-current")) === "page" &&
        (await redemptionContextNavigation.getByRole("button").allTextContents()).map((label) => label.trim()).join("|") === "兑换记录|充值记录" &&
        fiveMenuSidebarBox !== null &&
        fiveMenuCashierBox !== null &&
        Math.abs(
          fiveMenuCashierBox.x -
            (fiveMenuSidebarBox.x + fiveMenuSidebarBox.width + 24),
        ) <= 1 &&
        Math.abs(fiveMenuCashierBox.y) <= 1 &&
        Math.abs(
          fiveMenuCashierBox.width -
            (fiveMenuLayoutMetrics.innerWidth -
              fiveMenuSidebarBox.x -
              fiveMenuSidebarBox.width -
              48),
        ) <= 1 &&
        fiveMenuLayoutMetrics.scrollWidth <=
          fiveMenuLayoutMetrics.innerWidth + 1 &&
        fiveMenuStats.capabilityRequests > 0 &&
        fiveMenuStats.enterpriseOverviewRequests === 0,
      `five-menu employee navigation or merchant-width layout did not match:${JSON.stringify({ fiveMenuLabels, fiveMenuStats, fiveMenuSidebarBox, fiveMenuCashierBox, fiveMenuLayoutMetrics })}`,
    );
    await redemptionContextNavigation
      .getByRole("button", { name: "兑换记录", exact: true })
      .click();
    assert(
      (await redemptionContextNavigation
        .getByRole("button", { name: "兑换记录", exact: true })
        .getAttribute("aria-current")) === "page",
      "employee redemption submenu did not become the active merchant-style context entry",
    );
    if (screenshotDirectory) {
      await fiveMenuPage.screenshot({
        path: path.join(screenshotDirectory, "employee-merchant-shell-desktop.png"),
        fullPage: true,
      });
    }
  } finally {
    await fiveMenuContext.close();
  }

  const membersStats = {
    capabilityRequests: 0,
    enterpriseOverviewRequests: 0,
    membershipRequests: 0,
  };
  const membersContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "block",
    locale: "zh-CN",
  });
  try {
    await installEmployeeWorkspaceApiMock(membersContext, "members-only", membersStats);
    const membersPage = await membersContext.newPage();
    await membersPage.goto(`${baseUrl}/test-harness/employee-workspace`, {
      waitUntil: "domcontentloaded",
    });
    const membersRoot = membersPage.getByRole("button", {
      name: "会员管理",
      exact: true,
    });
    await membersRoot.waitFor();
    await membersPage
      .getByRole("heading", { name: "会员列表", exact: true })
      .waitFor();
    const desktopShell = membersPage.locator('[data-employee-merchant-shell="1"]');
    const desktopSidebar = membersPage.locator('[data-employee-merchant-sidebar="1"]');
    const desktopNavigation = desktopSidebar.getByRole("navigation", {
      name: "员工工作区主导航",
    });
    const desktopSidebarBox = await desktopSidebar.boundingBox();
    const desktopMetrics = await membersPage.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    assert(
      (await membersRoot.getAttribute("aria-current")) === "page" &&
        (await desktopShell.count()) === 1 &&
        desktopSidebarBox !== null &&
        Math.abs(desktopSidebarBox.x) <= 1 &&
        Math.abs(desktopSidebarBox.width - 228) <= 1 &&
        (await desktopNavigation.getByRole("button").count()) === 1 &&
        (await desktopSidebar.getByRole("navigation", { name: "会员管理子菜单" }).count()) === 0 &&
        desktopMetrics.scrollWidth <= desktopMetrics.innerWidth + 1 &&
        (await membersPage.getByRole("button", { name: "企业协作", exact: true }).count()) === 0 &&
        (await membersPage.getByRole("button", { name: "优惠券", exact: true }).count()) === 0 &&
        (await membersPage.getByRole("button", { name: "经营中心", exact: true }).count()) === 0 &&
        membersStats.capabilityRequests > 0 &&
        membersStats.enterpriseOverviewRequests === 0,
      `members-only employee did not land directly in the permitted business root:${JSON.stringify(membersStats)}`,
    );
    const collapseSidebar = membersPage.getByRole("button", {
      name: "收起员工工作区侧栏",
      exact: true,
    });
    await collapseSidebar.click();
    await membersPage.getByRole("button", {
      name: "展开员工工作区侧栏",
      exact: true,
    }).waitFor();
    await membersPage.waitForTimeout(250);
    assert(
      await desktopSidebar.isHidden(),
      "desktop employee sidebar did not become non-interactive after collapsing",
    );
    await membersPage.getByRole("button", {
      name: "展开员工工作区侧栏",
      exact: true,
    }).click();
  } finally {
    await membersContext.close();
  }

  const mobileStats = {
    capabilityRequests: 0,
    enterpriseOverviewRequests: 0,
    membershipRequests: 0,
  };
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: "block",
    locale: "zh-CN",
  });
  try {
    await installEmployeeWorkspaceApiMock(mobileContext, "five-menus", mobileStats);
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(`${baseUrl}/test-harness/employee-workspace`, {
      waitUntil: "domcontentloaded",
    });
    const mobileMenuTrigger = mobilePage.getByRole("button", {
      name: "打开员工工作区导航",
      exact: true,
    });
    await mobileMenuTrigger.waitFor();
    const mobileSidebar = mobilePage.locator('[data-employee-merchant-sidebar="1"]');
    const mobileSidebarStartedHidden = await mobileSidebar.isHidden();
    await mobileMenuTrigger.click();
    await mobilePage.waitForTimeout(250);
    const openMobileSidebarBox = await mobileSidebar.boundingBox();
    const mobileNavigation = mobileSidebar.getByRole("navigation", {
      name: "员工工作区主导航",
    });
    const mobileFocusState = await mobileSidebar.evaluate((sidebar) => ({
      enteredSidebar: sidebar.contains(document.activeElement),
      activeLabel: document.activeElement?.getAttribute("aria-label") || "",
      activeText: document.activeElement?.textContent?.trim().slice(0, 80) || "",
      activeTag: document.activeElement?.tagName || "",
    }));
    const mobileFocusEnteredSidebar = mobileFocusState.enteredSidebar;
    const mobileMetrics = await mobilePage.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    assert(
      mobileSidebarStartedHidden &&
        openMobileSidebarBox !== null &&
        Math.abs(openMobileSidebarBox.x) <= 1 &&
        Math.abs(openMobileSidebarBox.width - 228) <= 1 &&
        (await mobileNavigation.getByRole("button").count()) === 5 &&
        (await mobileNavigation.getByRole("button", { name: "会员管理", exact: true }).count()) === 1 &&
        mobileFocusEnteredSidebar &&
        mobileMetrics.scrollWidth <= mobileMetrics.innerWidth + 1 &&
        mobileStats.enterpriseOverviewRequests === 0,
      `mobile employee sidebar was not permission-filtered or responsive:${JSON.stringify({ mobileSidebarStartedHidden, openMobileSidebarBox, mobileFocusState, mobileMetrics, mobileStats })}`,
    );
    if (screenshotDirectory) {
      await mobilePage.screenshot({
        path: path.join(screenshotDirectory, "employee-merchant-shell-mobile.png"),
        fullPage: true,
      });
    }
    await mobilePage.keyboard.press("Shift+Tab");
    assert(
      await mobileSidebar.evaluate((sidebar) =>
        sidebar.contains(document.activeElement),
      ),
      "mobile employee sidebar did not trap keyboard focus",
    );
    const mobileContextNavigation = mobileSidebar.getByRole("navigation", {
      name: "积分兑换子菜单",
    });
    await mobileContextNavigation
      .getByRole("button", { name: "兑换记录", exact: true })
      .click();
    await mobilePage.waitForTimeout(250);
    assert(
      (await mobileSidebar.isHidden()) &&
        (await mobileMenuTrigger.evaluate(
          (trigger) => document.activeElement === trigger,
        )),
      "mobile employee sidebar did not close after context navigation",
    );
    await mobileMenuTrigger.click();
    await mobilePage.waitForTimeout(250);
    await mobileNavigation
      .getByRole("button", { name: "会员管理", exact: true })
      .click();
    await mobilePage.waitForTimeout(250);
    assert(
      (await mobileSidebar.isHidden()) &&
        (await mobileMenuTrigger.evaluate(
          (trigger) => document.activeElement === trigger,
        )),
      "mobile employee sidebar did not become non-interactive after navigation",
    );
    await mobilePage.evaluate(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await mobilePage.keyboard.press("Escape");
    assert(
      await mobilePage.evaluate(() => document.activeElement === document.body),
      "Escape moved focus while the mobile employee sidebar was already closed",
    );
    await mobileMenuTrigger.click();
    await mobilePage.waitForTimeout(250);
    await mobilePage.setViewportSize({ width: 1100, height: 844 });
    await mobilePage.waitForTimeout(250);
    assert(
      (await mobilePage
        .locator('button[aria-label="打开员工工作区导航"]')
        .getAttribute("aria-expanded")) === "false",
      "mobile drawer state remained active after entering the desktop viewport",
    );
  } finally {
    await mobileContext.close();
  }

  const unavailableStats = {
    capabilityRequests: 0,
    enterpriseOverviewRequests: 0,
    membershipRequests: 0,
  };
  const unavailableContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "block",
    locale: "zh-CN",
  });
  try {
    await installEmployeeWorkspaceApiMock(unavailableContext, "unavailable", unavailableStats);
    const unavailablePage = await unavailableContext.newPage();
    await unavailablePage.goto(`${baseUrl}/test-harness/employee-workspace`, {
      waitUntil: "domcontentloaded",
    });
    await unavailablePage
      .getByRole("button", { name: "重新核验权限", exact: true })
      .first()
      .waitFor();
    const unavailableNavigation = unavailablePage
      .locator('[data-employee-merchant-sidebar="1"]')
      .getByRole("navigation", { name: "员工工作区主导航" });
    assert(
      (await unavailablePage.getByRole("button", { name: "企业协作", exact: true }).count()) === 0 &&
        (await unavailableNavigation.getByRole("button").count()) === 0 &&
        unavailableStats.capabilityRequests > 0 &&
        unavailableStats.membershipRequests === 0 &&
        unavailableStats.enterpriseOverviewRequests === 0,
      `unavailable capabilities mounted a collaboration or business workspace:${JSON.stringify(unavailableStats)}`,
    );
  } finally {
    await unavailableContext.close();
  }
}

async function run() {
  const state = createSharedState();
  const screenshotDirectory = String(
    process.env.FAOLLA_ENTERPRISE_E2E_SCREENSHOT_DIR || "",
  ).trim();
  if (screenshotDirectory) mkdirSync(screenshotDirectory, { recursive: true });
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
  const { baseUrl, child, readServerOutput } = await startServer();
  const browser = await chromium.launch({ headless: true });
  try {
    await runEmployeeWorkspaceRootRegression(browser, baseUrl, screenshotDirectory);
    const ownerContextA = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "block",
      locale: "zh-CN",
    });
    const ownerContextB = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "block",
      locale: "zh-CN",
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

    await pageA.getByRole("button", { name: "角色权限", exact: true }).click();
    await pageA.getByRole("heading", { name: "现有角色", exact: true }).waitFor();
    const newRoleEditorBody = pageA.locator("#new-role-editor-body");
    const primaryRoleEditorBody = pageA.locator(`#role-editor-${roleId}-body`);
    assert(
      await newRoleEditorBody.isHidden() && await primaryRoleEditorBody.isHidden(),
      "role page did not start with creation and existing editors collapsed",
    );
    const roleDefaultMetrics = await pageA.evaluate(() => ({
      innerHeight: window.innerHeight,
      scrollHeight: document.documentElement.scrollHeight,
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    assert(
      roleDefaultMetrics.scrollHeight <= roleDefaultMetrics.innerHeight * 2 &&
        roleDefaultMetrics.scrollWidth <= roleDefaultMetrics.innerWidth + 1,
      `compact desktop role page exceeded its height or width budget:${JSON.stringify(roleDefaultMetrics)}`,
    );
    if (screenshotDirectory) {
      await pageA.screenshot({
        path: path.join(screenshotDirectory, "role-permissions-desktop-default.png"),
        fullPage: true,
      });
    }

    const primaryRoleDisclosure = pageA.locator(
      `button[aria-controls="role-editor-${roleId}-body"]`,
    );
    await primaryRoleDisclosure.click();
    await primaryRoleEditorBody.waitFor();
    const permissionNavigation = primaryRoleEditorBody.getByRole("navigation", {
      name: "权限主要板块",
    });
    assert(
      await permissionNavigation.getByRole("button").count() === 12,
      "expanded role editor did not expose all 12 permission groups as compact navigation",
    );
    await permissionNavigation.getByRole("button", { name: /订单管理/ }).click();
    const orderPermissionGroup = primaryRoleEditorBody.locator(
      '[data-role-permission-group="订单管理"]',
    );
    assert(
      await orderPermissionGroup.getByRole("checkbox").count() === 11,
      "order permission group did not expose its 11 granular permissions",
    );
    const orderViewHelp = orderPermissionGroup.getByRole("button", {
      name: "查看“查看订单”权限说明",
      exact: true,
    });
    const orderViewTooltip = orderPermissionGroup.getByRole("tooltip").first();
    assert(
      await orderViewTooltip.evaluate((element) => getComputedStyle(element).opacity) === "0",
      "permission description was visible before hover or focus",
    );
    await orderViewHelp.hover();
    await pageA.waitForTimeout(200);
    assert(
      await orderViewTooltip.evaluate((element) => getComputedStyle(element).opacity) === "1",
      "permission description did not appear on desktop hover",
    );
    if (screenshotDirectory) {
      await pageA.screenshot({
        path: path.join(screenshotDirectory, "role-permissions-desktop-expanded.png"),
        fullPage: true,
      });
    }
    await pageA.mouse.move(0, 0);
    await pageA.waitForTimeout(200);
    await orderViewHelp.focus();
    await pageA.waitForTimeout(200);
    assert(
      await orderViewTooltip.evaluate((element) => getComputedStyle(element).opacity) === "1",
      "permission description did not appear when its information button received keyboard focus",
    );
    await orderViewHelp.press("Escape");
    await pageA.waitForTimeout(200);
    assert(
      await orderViewTooltip.evaluate((element) => getComputedStyle(element).opacity) === "0",
      "permission description did not close with Escape",
    );

    const orderViewPermission = orderPermissionGroup.getByLabel("查看订单", { exact: true });
    await orderViewPermission.check();
    await primaryRoleDisclosure.click();
    assert(
      await primaryRoleEditorBody.isHidden() && await orderViewPermission.isChecked() &&
        (await primaryRoleDisclosure.innerText()).includes("有未保存修改"),
      "collapsing an edited role discarded its local permission draft or dirty summary",
    );
    await primaryRoleDisclosure.click();
    assert(
      await orderViewPermission.isChecked(),
      "reopening a role did not preserve its unsaved permission draft",
    );
    await orderViewPermission.uncheck();
    const employeeRoleDisclosure = pageA.locator(
      `button[aria-controls="role-editor-${employeeRoleId}-body"]`,
    );
    await employeeRoleDisclosure.click();
    const employeeRoleBody = pageA.locator(`#role-editor-${employeeRoleId}-body`);
    assert(
      await primaryRoleEditorBody.isHidden() &&
        await employeeRoleBody.isVisible(),
      "opening another role did not keep the role list to one expanded editor",
    );

    const employeePermissionNavigation = employeeRoleBody.getByRole("navigation", {
      name: "权限主要板块",
    });
    const workbenchSelection = employeePermissionNavigation.getByRole("button", {
      name: /^工作台，/,
    });
    const taskSelection = employeePermissionNavigation.getByRole("button", {
      name: /^任务与看板，/,
    });
    const linkedOrderSelection = employeePermissionNavigation.getByRole("button", {
      name: /^任务关联订单，/,
    });
    const collaborationSelectionSummary = employeePermissionNavigation.locator(
      '[data-role-permission-section="collaboration"] [data-role-permission-section-count]',
    );
    const businessSelectionSummary = employeePermissionNavigation.locator(
      '[data-role-permission-section="business"] [data-role-permission-section-count]',
    );
    const totalSelectionSummary = employeeRoleBody.locator('[data-role-permission-summary]');
    assert(
      await workbenchSelection.getAttribute("data-role-permission-selection") === "complete" &&
        await taskSelection.getAttribute("data-role-permission-selection") === "partial" &&
        await linkedOrderSelection.getAttribute("data-role-permission-selection") === "empty" &&
        /已全选\s*1\s*\/\s*1/.test(await workbenchSelection.innerText()) &&
        /已选\s*1\s*\/\s*6/.test(await taskSelection.innerText()) &&
        /未选择\s*0\s*\/\s*1/.test(await linkedOrderSelection.innerText()),
      "permission group navigation did not expose clear empty, partial, and complete selection states",
    );
    assert(
      /已选\s*2\/18[\s\S]*2\/7\s*组/.test(await collaborationSelectionSummary.innerText()) &&
        /已选\s*0\/39[\s\S]*0\/5\s*组/.test(await businessSelectionSummary.innerText()) &&
        /已选权限\s*2\s*\/\s*57\s*项[\s\S]*已配置\s*2\s*\/\s*12\s*个功能组/.test(
          await totalSelectionSummary.innerText(),
        ),
      "permission section or total selection summaries were not immediately readable",
    );
    const selectionCountStyles = await Promise.all(
      [workbenchSelection, taskSelection, linkedOrderSelection].map((selection) =>
        selection.locator("[data-role-permission-selection-count]").evaluate((element) => {
          const style = getComputedStyle(element);
          const colorCanvas = document.createElement("canvas");
          colorCanvas.width = 1;
          colorCanvas.height = 1;
          const colorContext = colorCanvas.getContext("2d", { willReadFrequently: true });
          const parseColor = (value) => {
            colorContext.clearRect(0, 0, 1, 1);
            colorContext.fillStyle = value;
            colorContext.fillRect(0, 0, 1, 1);
            const channels = colorContext.getImageData(0, 0, 1, 1).data;
            return {
              red: channels[0],
              green: channels[1],
              blue: channels[2],
              alpha: channels[3] / 255,
            };
          };
          const compositeOver = (foreground, background) => {
            const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
            if (alpha === 0) {
              return { red: 0, green: 0, blue: 0, alpha: 0 };
            }
            return {
              red:
                (foreground.red * foreground.alpha +
                  background.red * background.alpha * (1 - foreground.alpha)) /
                alpha,
              green:
                (foreground.green * foreground.alpha +
                  background.green * background.alpha * (1 - foreground.alpha)) /
                alpha,
              blue:
                (foreground.blue * foreground.alpha +
                  background.blue * background.alpha * (1 - foreground.alpha)) /
                alpha,
              alpha,
            };
          };
          const button = element.closest("button");
          let renderedBackground = { red: 0, green: 0, blue: 0, alpha: 0 };
          for (let ancestor = button; ancestor; ancestor = ancestor.parentElement) {
            renderedBackground = compositeOver(
              renderedBackground,
              parseColor(getComputedStyle(ancestor).backgroundColor),
            );
            if (renderedBackground.alpha >= 0.999) break;
          }
          renderedBackground = compositeOver(renderedBackground, {
            red: 255,
            green: 255,
            blue: 255,
            alpha: 1,
          });
          const renderedForeground = compositeOver(parseColor(style.color), renderedBackground);
          const relativeLuminance = ({ red, green, blue }) => {
            const linearChannels = [red, green, blue].map((channel) => {
              const normalized = channel / 255;
              return normalized <= 0.04045
                ? normalized / 12.92
                : ((normalized + 0.055) / 1.055) ** 2.4;
            });
            return (
              0.2126 * linearChannels[0] +
              0.7152 * linearChannels[1] +
              0.0722 * linearChannels[2]
            );
          };
          const foregroundLuminance = relativeLuminance(renderedForeground);
          const backgroundLuminance = relativeLuminance(renderedBackground);
          const contrastRatio =
            (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
            (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
          return {
            fontSize: Number.parseFloat(style.fontSize),
            fontWeight: Number.parseInt(style.fontWeight, 10),
            color: style.color,
            backgroundColor: getComputedStyle(button).backgroundColor,
            contrastRatio,
          };
        }),
      ),
    );
    assert(
      selectionCountStyles.every(
        (style) =>
          style.fontSize >= 12 &&
          style.fontWeight >= 600 &&
          style.contrastRatio >= 4.5,
      ) &&
        new Set(selectionCountStyles.map((style) => `${style.color}|${style.backgroundColor}`)).size === 3,
      `permission selection counts were not visually distinct, prominent, and WCAG-readable:${JSON.stringify(selectionCountStyles)}`,
    );

    let roleNavigationMutationCount = 0;
    const countRoleNavigationMutations = (request) => {
      const url = new URL(request.url());
      if (
        url.pathname.startsWith("/api/merchant-enterprise/roles") &&
        !["GET", "HEAD", "OPTIONS"].includes(request.method())
      ) {
        roleNavigationMutationCount += 1;
      }
    };
    pageA.on("request", countRoleNavigationMutations);
    await linkedOrderSelection.click();
    assert(
      await linkedOrderSelection.getAttribute("aria-pressed") === "true" &&
        await linkedOrderSelection.getAttribute("data-role-permission-selection") === "empty" &&
        await workbenchSelection.getAttribute("aria-pressed") === "false" &&
        await workbenchSelection.getAttribute("data-role-permission-selection") === "complete",
      "the current permission group was still visually or semantically confused with its selection state",
    );
    await taskSelection.focus();
    await taskSelection.press("Enter");
    assert(
      await taskSelection.getAttribute("aria-pressed") === "true" &&
        await taskSelection.getAttribute("data-role-permission-selection") === "partial" &&
        (await taskSelection.getAttribute("aria-label"))?.includes("已选 1 项，共 6 项") === true,
      "keyboard navigation did not preserve the partial selection state or announce its count",
    );
    const employeeTaskPermissionGroup = employeeRoleBody.locator(
      '[data-role-permission-group="任务"]',
    );
    const taskCreatePermission = employeeTaskPermissionGroup.getByLabel("新建任务", {
      exact: true,
    });
    await taskCreatePermission.check();
    assert(
      /已选\s*2\s*\/\s*6/.test(await taskSelection.innerText()) &&
        /已选\s*3\/18/.test(await collaborationSelectionSummary.innerText()) &&
        /已选权限\s*3\s*\/\s*57\s*项/.test(await totalSelectionSummary.innerText()),
      "permission counts did not update from the local permission draft",
    );
    await employeeRoleDisclosure.click();
    assert(
      await employeeRoleBody.isHidden() &&
        (await employeeRoleDisclosure.innerText()).includes("有未保存修改"),
      "collapsing the employee role did not retain its dirty permission-count draft",
    );
    await employeeRoleDisclosure.click();
    assert(
      await taskCreatePermission.isChecked() &&
        /已选\s*2\s*\/\s*6/.test(await taskSelection.innerText()) &&
        /已选权限\s*3\s*\/\s*57\s*项/.test(await totalSelectionSummary.innerText()),
      "reopening the employee role lost its permission counts or local selection draft",
    );
    await taskCreatePermission.uncheck();
    assert(
      roleNavigationMutationCount === 0 &&
        /已选\s*1\s*\/\s*6/.test(await taskSelection.innerText()) &&
        /已选权限\s*2\s*\/\s*57\s*项/.test(await totalSelectionSummary.innerText()),
      "permission navigation caused a role mutation or failed to restore the original counts",
    );

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
    await secondEmployeeRow.getByRole("button", { name: "收起资料", exact: true }).click();

    state.snapshot.tasks[0].assigneeIds = [employeeId, secondEmployeeId];
    await firstEmployeeRow
      .getByRole("button", { name: "查看当前工作", exact: true })
      .click();
    const currentWorkDrawer = pageA.getByRole("dialog", {
      name: "浏览器测试员工",
    });
    await currentWorkDrawer.getByText("不是绩效考核", { exact: false }).waitFor();
    await currentWorkDrawer.getByText("1 项由多人共同负责", { exact: false }).waitFor();
    assert(
      (statsA.currentOperationsRequests || []).some(
        (request) => request.siteId === siteId && request.employeeId === employeeId,
      ),
      "employee current-work drawer did not issue a site- and employee-scoped request",
    );
    await currentWorkDrawer.getByRole("button", { name: "关闭", exact: true }).click();
    await currentWorkDrawer.waitFor({ state: "hidden" });
    state.snapshot.tasks[0].assigneeIds = [];

    const publishedWorkflowTitle = "客户到店接待流程";
    const publishedStepTitle = "确认预约信息";
    const draftWorkflowTitle = "客户到店接待流程（内部草稿）";
    const draftOnlyDescription = "尚未发布的内部接待说明";
    const conflictDraftDescription = "CAS 冲突时必须保留的本地正文";
    await pageA.getByRole("button", { name: "工作流程", exact: true }).click();
    const ownerWorkflowPanel = pageA.locator('section[aria-label="工作流程与标准作业程序"]');
    await ownerWorkflowPanel.getByRole("heading", { name: "工作流程", exact: true }).waitFor();
    await ownerWorkflowPanel.getByRole("button", { name: "新建流程", exact: true }).first().click();
    await ownerWorkflowPanel.getByLabel("流程名称 *").fill(publishedWorkflowTitle);
    await ownerWorkflowPanel.getByLabel("适用场景 *").fill("客户按预约时间到店");
    await ownerWorkflowPanel.getByLabel("流程说明").fill("首个对员工公开的接待版本");
    await ownerWorkflowPanel.getByRole("button", { name: "添加步骤", exact: true }).click();
    await ownerWorkflowPanel.getByLabel("步骤标题 *").fill(publishedStepTitle);
    await ownerWorkflowPanel.getByLabel("操作说明 *").fill("核对客户姓名和预约时间。");
    await ownerWorkflowPanel.getByRole("button", { name: "保存并发布", exact: true }).click();
    await ownerWorkflowPanel
      .getByText("流程已发布，员工现在可以查看最新版本。", { exact: true })
      .waitFor();
    assert(state.workflows[0]?.id === workflowId, "owner workflow creation did not reach the API mock");
    assert(
      state.workflows[0]?.published?.fields.steps[0]?.title === publishedStepTitle,
      "owner workflow publish did not persist its first step snapshot",
    );
    assert(
      (statsA.workflowMutations || []).map((item) => item.action).slice(-2).join(",") ===
        "create,publish",
      "owner create-and-publish did not use separate draft and publish mutations",
    );

    await ownerWorkflowPanel.getByRole("button", { name: "关闭", exact: true }).click();
    const executionStatsPanel = ownerWorkflowPanel.locator(
      "[data-workflow-execution-stats]",
    );
    await executionStatsPanel
      .getByRole("heading", { name: "执行与培训统计", exact: true })
      .waitFor();
    await executionStatsPanel.getByText("0/2", { exact: true }).waitFor();

    const revisionHistory = ownerWorkflowPanel.locator(
      "[data-workflow-revision-history]",
    );
    await revisionHistory
      .getByRole("button", { name: "查看版本历史", exact: true })
      .click();
    const currentRevisionButton = revisionHistory
      .getByRole("button")
      .filter({ hasText: "v1" })
      .first();
    await currentRevisionButton.waitFor();
    await currentRevisionButton.click();
    await revisionHistory
      .getByRole("heading", { name: "v1 发布内容", exact: true })
      .waitFor();
    assert(
      (statsA.workflowStatsGets || 0) >= 1 &&
        (statsA.workflowRevisionGets || 0) >= 2,
      "manager workflow statistics or immutable revision detail did not load through the API mock",
    );

    await pageA.getByRole("button", { name: "任务看板", exact: true }).click();
    await pageA.getByLabel("当前看板").selectOption(boardId);
    const workflowTaskCard = pageA
      .locator("article")
      .filter({ hasText: "双会话创建任务" })
      .first();
    await workflowTaskCard.getByRole("button", { name: "管理任务", exact: true }).click();
    const workflowTaskEditor = pageA.getByRole("dialog", { name: "编辑任务" });
    await workflowTaskEditor.waitFor();
    const taskWorkflowCard = workflowTaskEditor.locator(
      "[data-enterprise-task-workflow]",
    );
    await taskWorkflowCard
      .getByRole("heading", { name: "执行标准工作流程", exact: true })
      .waitFor();
    const publishedWorkflowSelector = taskWorkflowCard.getByLabel("选择已发布流程");
    await publishedWorkflowSelector.waitFor();
    await publishedWorkflowSelector.selectOption(workflowId);
    pageA.once("dialog", (dialog) => void dialog.accept());
    await taskWorkflowCard
      .getByRole("button", { name: "应用流程并生成清单", exact: true })
      .click();
    await taskWorkflowCard.getByText("版本已固定", { exact: true }).waitFor();
    await taskWorkflowCard
      .getByText(`已固定“${publishedWorkflowTitle}”v1，并生成 1 项任务清单。`, {
        exact: true,
      })
      .waitFor();
    await workflowTaskEditor
      .locator('section[aria-labelledby="enterprise-task-checklist-title"]')
      .getByText(publishedStepTitle, { exact: true })
      .waitFor();
    await workflowTaskEditor
      .locator('section[aria-labelledby="enterprise-task-events-title"]')
      .getByText("应用了工作流程 v1，生成 1 项清单", { exact: false })
      .waitFor();
    assert(
      (statsA.taskWorkflowPosts || 0) === 1 &&
        state.taskWorkflowBindings[state.snapshot.tasks[0].id]?.siteId === siteId &&
        state.taskChecklistItems[state.snapshot.tasks[0].id]?.length === 1 &&
        state.taskEvents[state.snapshot.tasks[0].id]?.[0]?.eventType === "workflow_bound",
      "task binding did not atomically expose the tenant-scoped binding, generated checklist, and event",
    );
    await workflowTaskEditor.getByRole("button", { name: "关闭", exact: true }).click();
    await workflowTaskEditor.waitFor({ state: "hidden" });
    await pageA.getByRole("button", { name: "工作流程", exact: true }).click();
    await ownerWorkflowPanel
      .getByRole("heading", { name: publishedWorkflowTitle, exact: true })
      .waitFor();
    await ownerWorkflowPanel.getByRole("button", { name: "编辑草稿", exact: true }).click();
    const ownerWorkflowTitle = ownerWorkflowPanel.getByLabel("流程名称 *");
    const ownerWorkflowDescription = ownerWorkflowPanel.getByLabel("流程说明");
    await ownerWorkflowTitle.fill(draftWorkflowTitle);
    await ownerWorkflowDescription.fill(draftOnlyDescription);
    await ownerWorkflowPanel.getByRole("button", { name: "保存草稿", exact: true }).click();
    await ownerWorkflowPanel.getByText("草稿已保存。", { exact: true }).waitFor();
    assert(
      state.workflows[0]?.draft.title === draftWorkflowTitle &&
        state.workflows[0]?.published?.fields.title === publishedWorkflowTitle,
      "saving a new draft overwrote the employee-facing published snapshot",
    );

    await ownerWorkflowDescription.fill(conflictDraftDescription);
    await ownerWorkflowPanel.getByText("有尚未保存的修改", { exact: true }).waitFor();
    pageA.once("dialog", (dialog) => void dialog.dismiss());
    await pageA.getByRole("button", { name: "任务看板", exact: true }).click();
    assert(
      (await pageA.locator('[aria-current="page"]').textContent()) === "工作流程" &&
        (await ownerWorkflowDescription.inputValue()) === conflictDraftDescription,
      "canceling workflow menu navigation discarded or left the local workflow draft",
    );

    state.workflowConflictNextSave = true;
    await ownerWorkflowPanel.getByRole("button", { name: "保存草稿", exact: true }).click();
    await ownerWorkflowPanel
      .getByText("该流程已被其他成员更新。请重新加载最新版本后再编辑。", { exact: true })
      .waitFor();
    assert(
      (await ownerWorkflowDescription.inputValue()) === conflictDraftDescription,
      "a workflow CAS conflict replaced the editor's local body",
    );
    await ownerWorkflowPanel.getByRole("button", { name: "重新加载", exact: true }).waitFor();

    const workflowViewActor = {
      type: "employee",
      id: "10000000-0000-4000-8000-000000000031",
      siteId,
      displayName: "流程只读员工",
      email: "workflow-view@example.test",
      permissions: ["enterprise.view", "workflows.view"],
      accessScope: "all",
      allowedBoardIds: [],
    };
    const workflowManageActor = {
      ...workflowViewActor,
      id: "10000000-0000-4000-8000-000000000032",
      displayName: "流程编辑员工",
      email: "workflow-manage@example.test",
      permissions: ["enterprise.view", "workflows.view", "workflows.manage"],
    };
    const workflowPublishActor = {
      ...workflowViewActor,
      id: "10000000-0000-4000-8000-000000000033",
      displayName: "流程发布员工",
      email: "workflow-publish@example.test",
      permissions: ["enterprise.view", "workflows.view", "workflows.publish"],
    };
    const workflowViewContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "block",
      locale: "zh-CN",
    });
    const workflowManageContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "block",
      locale: "zh-CN",
    });
    const workflowPublishContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "block",
      locale: "zh-CN",
    });
    const workflowPublishStats = { overviewRequests: 0 };
    await Promise.all([
      installEnterpriseApiMock(workflowViewContext, state, { overviewRequests: 0 }, {
        actor: workflowViewActor,
      }),
      installEnterpriseApiMock(workflowManageContext, state, { overviewRequests: 0 }, {
        actor: workflowManageActor,
      }),
      installEnterpriseApiMock(workflowPublishContext, state, workflowPublishStats, {
        actor: workflowPublishActor,
      }),
    ]);
    const [workflowViewPage, workflowManagePage, workflowPublishPage] = await Promise.all([
      openHarness(workflowViewContext, baseUrl),
      openHarness(workflowManageContext, baseUrl),
      openHarness(workflowPublishContext, baseUrl),
    ]);
    await Promise.all([
      workflowViewPage.getByRole("button", { name: "工作流程", exact: true }).click(),
      workflowManagePage.getByRole("button", { name: "工作流程", exact: true }).click(),
      workflowPublishPage.getByRole("button", { name: "工作流程", exact: true }).click(),
    ]);
    const viewPanel = workflowViewPage.locator('section[aria-label="工作流程与标准作业程序"]');
    const managePanel = workflowManagePage.locator('section[aria-label="工作流程与标准作业程序"]');
    const publishPanel = workflowPublishPage.locator('section[aria-label="工作流程与标准作业程序"]');
    await viewPanel.getByRole("heading", { name: publishedWorkflowTitle, exact: true }).waitFor();
    assert(
      (await viewPanel.getByText(publishedStepTitle, { exact: true }).count()) === 1 &&
        (await viewPanel.getByText(draftWorkflowTitle, { exact: true }).count()) === 0 &&
        (await viewPanel.getByText(draftOnlyDescription, { exact: true }).count()) === 0,
      "a view-only employee received draft fields instead of the prior published snapshot",
    );

    await managePanel
      .getByRole("heading", { name: draftWorkflowTitle, exact: true })
      .waitFor()
      .catch((error) => {
        throw new Error(`manage-only workflow did not load: ${error.message}`);
      });
    assert(
      (await managePanel.getByRole("button", { name: "新建流程", exact: true }).count()) >= 1 &&
        (await managePanel.getByRole("button", { name: "编辑草稿", exact: true }).count()) === 1 &&
        (await managePanel.getByRole("button", { name: "发布当前草稿", exact: true }).count()) === 0 &&
        (await managePanel.getByRole("button", { name: "归档", exact: true }).count()) === 0,
      "workflow manage-only UI exposed publish or visibility actions",
    );
    await managePanel.getByRole("button", { name: "编辑草稿", exact: true }).click();
    assert(
      (await managePanel.getByRole("button", { name: "保存草稿", exact: true }).count()) === 1 &&
        (await managePanel.getByRole("button", { name: "保存并发布", exact: true }).count()) === 0,
      "workflow manage-only editor exposed save-and-publish",
    );

    await publishPanel
      .getByRole("heading", { name: draftWorkflowTitle, exact: true })
      .waitFor()
      .catch((error) => {
        throw new Error(`publish-only workflow did not load: ${error.message}`);
      });
    assert(
      (await publishPanel.getByRole("button", { name: "新建流程", exact: true }).count()) === 0 &&
        (await publishPanel.getByRole("button", { name: "编辑草稿", exact: true }).count()) === 0 &&
        (await publishPanel.getByRole("button", { name: "发布当前草稿", exact: true }).count()) === 1 &&
        (await publishPanel.getByRole("button", { name: "归档", exact: true }).count()) === 1,
      "workflow publish-only UI did not keep draft editing separate from publication",
    );
    workflowPublishPage.once("dialog", (dialog) => void dialog.accept());
    await publishPanel.getByRole("button", { name: "归档", exact: true }).click();
    await publishPanel.getByText("流程已归档。", { exact: true }).waitFor();
    await publishPanel.getByRole("button", { name: "刷新", exact: true }).click();
    await publishPanel.getByLabel("状态").selectOption("all");
    await publishPanel
      .getByRole("heading", { name: draftWorkflowTitle, exact: true })
      .waitFor()
      .catch(async (error) => {
        throw new Error(
          `archived workflow did not reload: ${error.message}; stats=${JSON.stringify(workflowPublishStats)}; status=${JSON.stringify(await publishPanel.getByLabel("状态").inputValue())}; panel=${JSON.stringify(await publishPanel.innerText())}`,
        );
      });
    await publishPanel.getByRole("button", { name: "恢复流程", exact: true }).click();
    await publishPanel.getByText("流程已恢复。", { exact: true }).waitFor();
    assert(
      state.workflows[0]?.status === "published" &&
        state.workflows[0]?.hasUnpublishedChanges === true,
      "an archived workflow did not survive refresh and restore its prior publication state",
    );

    const archiveTemplate = state.workflows[0];
    for (let index = 1; index <= 25; index += 1) {
      const archiveTime = new Date(Date.UTC(2026, 7, 3, 10, 0, index)).toISOString();
      state.workflows.push({
        ...jsonClone(archiveTemplate),
        id: `10000000-0000-4000-8000-${String(100 + index).padStart(12, "0")}`,
        draft: {
          ...jsonClone(archiveTemplate.draft),
          title: `历史流程 ${String(index).padStart(2, "0")}`,
          scenario: "历史归档验收",
          tags: ["历史"],
        },
        published: null,
        status: "archived",
        version: 1,
        publishedVersion: 0,
        publishedAt: null,
        hasUnpublishedChanges: true,
        createdAt: archiveTime,
        updatedAt: archiveTime,
      });
    }
    await publishPanel.getByRole("button", { name: "刷新", exact: true }).click();
    await publishPanel
      .getByRole("button", { name: "加载更多归档流程", exact: true })
      .waitFor();
    assert(
      (await publishPanel.getByRole("heading", { name: draftWorkflowTitle, exact: true }).count()) ===
        1,
      "loading the first archive page changed the selected active workflow",
    );
    await publishPanel
      .getByRole("button", { name: "加载更多归档流程", exact: true })
      .click();
    await publishPanel.getByText("历史流程 01", { exact: true }).waitFor();
    assert(
      (await publishPanel.locator('aside[aria-label="流程列表"] > button').count()) === 26 &&
        (await publishPanel.getByText("已加载全部符合条件的归档流程", { exact: true }).count()) ===
          1,
      "archive pagination omitted or duplicated workflows",
    );
    await publishPanel
      .locator('aside[aria-label="流程列表"] > button')
      .filter({ hasText: "历史流程 01" })
      .click();
    await publishPanel.getByRole("heading", { name: "历史流程 01", exact: true }).waitFor();
    await publishPanel.getByLabel("搜索").fill("历史流程");
    await publishPanel
      .getByRole("button", { name: "加载更多归档流程", exact: true })
      .waitFor();
    assert(
      (await publishPanel.getByRole("heading", { name: "历史流程 01", exact: true }).count()) ===
        1,
      "a matching archive search replaced the selected workflow",
    );
    await publishPanel.getByRole("button", { name: "刷新", exact: true }).click();
    await publishPanel.getByRole("heading", { name: "历史流程 01", exact: true }).waitFor();
    assert(
      (await publishPanel.getByLabel("搜索").inputValue()) === "历史流程",
      "refreshing an archived selection reset its server-side filter",
    );
    await Promise.all([
      workflowViewContext.close(),
      workflowManageContext.close(),
      workflowPublishContext.close(),
    ]);

    await pageB.getByRole("button", { name: "操作记录", exact: true }).click();
    await pageB.getByRole("heading", { name: "企业操作记录" }).waitFor();
    await pageB.getByText("仓库主管", { exact: true }).first().waitFor();
    await pageB.getByRole("button", { name: "查看更多记录", exact: true }).click();
    await pageB.getByText("“双会话协作看板”", { exact: true }).waitFor();
    assert(statsB.auditGets >= 2, "audit view did not load and paginate through the API mock");

    const todoTask = state.snapshot.tasks[0];
    const todoWorkflow = state.workflows.find((workflow) => workflow.id === workflowId);
    if (!todoTask || !todoWorkflow?.published) {
      throw new Error("todo browser fixtures require a task and a published workflow");
    }
    const todoAttentionAt = timestamp();
    const todoDueAt = new Date(Date.now() - 60 * 60 * 1_000).toISOString();
    const todoEmployeeActor = {
      type: "employee",
      id: employeeId,
      siteId,
      displayName: "待办验收员工",
      email: "todo-employee@example.test",
      permissions: ["enterprise.view", "tasks.view", "workflows.view"],
      accessScope: "all",
      allowedBoardIds: [],
    };
    const todoTaskItem = {
      id: `task:${todoTask.id}`,
      entityId: todoTask.id,
      siteId,
      kind: "task",
      title: todoTask.title,
      subtitle: "双会话协作看板 · 待处理",
      urgency: "overdue",
      reasons: ["assigned_to_me", "overdue"],
      attentionAt: todoAttentionAt,
      dueAt: todoDueAt,
      taskId: todoTask.id,
      boardId,
      boardName: "双会话协作看板",
      priority: "high",
      version: todoTask.version,
    };
    const todoAcknowledgementItem = {
      id: `workflow_acknowledgement:${workflowId}`,
      entityId: workflowId,
      siteId,
      kind: "workflow_acknowledgement",
      title: publishedWorkflowTitle,
      subtitle: "客户按预约时间到店",
      urgency: "normal",
      reasons: ["acknowledgement_required"],
      attentionAt: todoWorkflow.published.publishedAt,
      dueAt: null,
      workflowId,
      revisionNo: todoWorkflow.published.version,
    };
    const todoExecutionItem = {
      id: `workflow_execution:${focusedTodoExecutionId}`,
      entityId: focusedTodoExecutionId,
      siteId,
      kind: "workflow_execution",
      title: publishedWorkflowTitle,
      subtitle: "待办定位的执行记录",
      urgency: "normal",
      reasons: ["execution_in_progress"],
      attentionAt: todoAttentionAt,
      dueAt: null,
      taskId: null,
      workflowId,
      executionId: focusedTodoExecutionId,
      revisionNo: todoWorkflow.published.version,
      completedSteps: 0,
      totalSteps: todoWorkflow.published.fields.steps.length,
      version: 1,
    };
    const buildTodoExecution = (id, subject) => ({
      id,
      siteId,
      workflowId,
      revisionId: todoWorkflow.published.revisionId,
      revisionNo: todoWorkflow.published.version,
      employeeId,
      taskId: null,
      subject,
      status: "in_progress",
      workflowSnapshot: jsonClone(todoWorkflow.published.fields),
      steps: todoWorkflow.published.fields.steps.map((step) => ({
        stepId: step.id,
        title: step.title,
        instruction: step.instruction,
        position: step.position,
        completedAt: null,
        note: "",
        evidence: [],
      })),
      completedSteps: 0,
      totalSteps: todoWorkflow.published.fields.steps.length,
      feedbackRating: null,
      feedbackText: "",
      feedbackStatus: "none",
      feedbackSubmittedAt: null,
      feedbackResolutionNote: "",
      feedbackResolvedAt: null,
      feedbackResolverType: null,
      feedbackResolverId: null,
      generatedChecklistCount: 0,
      startedAt: todoAttentionAt,
      completedAt: null,
      version: 1,
      createdAt: todoAttentionAt,
      updatedAt: todoAttentionAt,
    });
    const todoEmployeeStats = { overviewRequests: 0 };
    const todoEmployeeContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "block",
      locale: "zh-CN",
    });
    await Promise.all([
      todoEmployeeContext.addInitScript(acceleratePolling),
      installEnterpriseApiMock(todoEmployeeContext, state, todoEmployeeStats, {
        actor: todoEmployeeActor,
        todoItems: [todoTaskItem, todoAcknowledgementItem, todoExecutionItem],
        workflowExecutions: [
          buildTodoExecution(firstTodoExecutionId, "普通执行记录"),
          buildTodoExecution(focusedTodoExecutionId, "待办定位的执行记录"),
        ],
      }),
    ]);
    const todoEmployeePage = await openHarness(todoEmployeeContext, baseUrl);
    const todoEmployeeNavigation = todoEmployeePage.locator(
      'nav[aria-label="企业管理功能"]',
    );
    assert(
      (await todoEmployeeNavigation
        .getByRole("button", { name: "待办中心", exact: true })
        .count()) === 1 &&
        (await todoEmployeeNavigation
          .getByRole("button", { name: "员工账号", exact: true })
          .count()) === 0 &&
        (await todoEmployeeNavigation
          .getByRole("button", { name: "角色权限", exact: true })
          .count()) === 0,
      "enterprise.view did not expose only the employee's permitted todo navigation",
    );
    await todoEmployeeNavigation
      .getByRole("button", { name: "待办中心", exact: true })
      .click();
    const todoEmployeeCenter = todoEmployeePage.locator(
      "[data-enterprise-todo-center]",
    );
    await todoEmployeeCenter
      .getByRole("heading", { name: "统一待办", exact: true })
      .waitFor();
    await todoEmployeeCenter
      .locator('[data-todo-kind="workflow_execution"]')
      .waitFor();
    assert(
      (await todoEmployeeCenter.locator("[data-todo-kind]").count()) === 3 &&
        (await todoEmployeeCenter.getByText("已逾期 1", { exact: true }).count()) === 1,
      "employee todo center did not render its permission-filtered counts and actionable kinds",
    );
    await todoEmployeeCenter
      .getByRole("tab")
      .filter({ hasText: "任务" })
      .click();
    await todoEmployeeCenter.locator('[data-todo-kind="task"]').waitFor();
    await todoEmployeeCenter
      .locator('[data-todo-kind="workflow_acknowledgement"]')
      .waitFor({ state: "detached" });
    assert(
      (await todoEmployeeCenter.locator('[data-todo-kind="task"]').count()) === 1 &&
        (await todoEmployeeCenter
          .locator('[data-todo-kind="workflow_acknowledgement"]')
          .count()) === 0,
      "task todo category leaked workflow items",
    );
    await todoEmployeeCenter
      .getByRole("tab")
      .filter({ hasText: "工作流程" })
      .click();
    await todoEmployeeCenter
      .locator('[data-todo-kind="workflow_acknowledgement"]')
      .waitFor();
    await todoEmployeeCenter
      .locator('[data-todo-kind="task"]')
      .waitFor({ state: "detached" });
    assert(
      (await todoEmployeeCenter.locator('[data-todo-kind="task"]').count()) === 0 &&
        (await todoEmployeeCenter.locator("[data-todo-kind]").count()) === 2 &&
        (todoEmployeeStats.todoRequests || []).some(
          (request) => request.category === "tasks" && request.limit === 20,
        ) &&
        (todoEmployeeStats.todoRequests || []).some(
          (request) => request.category === "workflows" && request.limit === 20,
        ),
      "workflow todo category or strict category requests are incorrect",
    );
    await todoEmployeeCenter
      .getByRole("tab")
      .filter({ hasText: "全部" })
      .click();
    await todoEmployeeCenter.locator('[data-todo-kind="task"]').waitFor();
    await todoEmployeeCenter
      .getByRole("button", { name: "打开任务", exact: true })
      .click();
    const todoTaskEditor = todoEmployeePage.getByRole("dialog", { name: "任务详情" });
    await todoTaskEditor.waitFor();
    assert(
      (await todoEmployeePage.locator('[aria-current="page"]').textContent()) === "任务看板" &&
        (await todoTaskEditor.getByLabel("任务标题").inputValue()) === todoTask.title,
      "task todo action did not open the tenant task editor",
    );
    await todoTaskEditor.getByRole("button", { name: "关闭", exact: true }).click();
    await todoTaskEditor.waitFor({ state: "hidden" });

    await todoEmployeeNavigation
      .getByRole("button", { name: "待办中心", exact: true })
      .click();
    await todoEmployeeCenter
      .getByRole("button", { name: "阅读并确认", exact: true })
      .click();
    const todoEmployeeWorkflowPanel = todoEmployeePage.locator(
      'section[aria-label="工作流程与标准作业程序"]',
    );
    await todoEmployeeWorkflowPanel
      .getByRole("heading", { name: publishedWorkflowTitle, exact: true })
      .waitFor();
    await todoEmployeeWorkflowPanel
      .getByRole("button", {
        name: `确认已阅读 v${todoWorkflow.published.version}`,
        exact: true,
      })
      .waitFor();
    assert(
      (await todoEmployeePage.locator('[aria-current="page"]').textContent()) === "工作流程",
      "acknowledgement todo action did not navigate to the published workflow",
    );

    await todoEmployeeNavigation
      .getByRole("button", { name: "待办中心", exact: true })
      .click();
    await todoEmployeeCenter
      .getByRole("button", { name: "继续执行", exact: true })
      .click();
    await todoEmployeeWorkflowPanel
      .getByRole("heading", { name: "待办定位的执行记录", exact: true })
      .waitFor();
    assert(
      (await todoEmployeeWorkflowPanel.getByLabel("执行记录").inputValue()) ===
        focusedTodoExecutionId,
      "execution todo action did not focus the requested execution record",
    );
    await todoEmployeeContext.close();

    const feedbackTodoItem = {
      id: `workflow_feedback:${feedbackTodoExecutionId}`,
      entityId: feedbackTodoExecutionId,
      siteId,
      kind: "workflow_feedback",
      title: publishedWorkflowTitle,
      subtitle: "待处理员工反馈",
      urgency: "normal",
      reasons: ["feedback_open"],
      attentionAt: todoAttentionAt,
      dueAt: null,
      workflowId,
      executionId: feedbackTodoExecutionId,
      revisionNo: todoWorkflow.published.version,
      employeeName: "待办验收员工",
      version: 2,
    };
    const todoOwnerStats = { overviewRequests: 0 };
    const todoOwnerContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "block",
      locale: "zh-CN",
    });
    await Promise.all([
      todoOwnerContext.addInitScript(acceleratePolling),
      installEnterpriseApiMock(todoOwnerContext, state, todoOwnerStats, {
        todoItems: [feedbackTodoItem],
        workflowExecutionStats: {
          merchantId: siteId,
          workflowId,
          currentRevisionNo: todoWorkflow.published.version,
          eligibleEmployeeCount: 2,
          acknowledgedEmployeeCount: 1,
          executionCount: 1,
          inProgressCount: 0,
          completedCount: 1,
          taskLinkedExecutionCount: 0,
          generatedChecklistCount: 0,
          feedbackCount: 1,
          openFeedbackCount: 1,
          averageRating: 3,
          participants: [],
          recentFeedback: [
            {
              executionId: feedbackTodoExecutionId,
              executionVersion: 2,
              employeeId,
              employeeName: "待办验收员工",
              revisionNo: todoWorkflow.published.version,
              rating: 3,
              text: "反馈需要主管处理",
              status: "open",
              submittedAt: todoAttentionAt,
              resolutionNote: "",
              resolvedAt: null,
              resolverType: null,
              resolverId: null,
            },
          ],
        },
      }),
    ]);
    const todoOwnerPage = await openHarness(todoOwnerContext, baseUrl);
    await todoOwnerPage
      .getByRole("button", { name: "待办中心", exact: true })
      .click();
    const todoOwnerCenter = todoOwnerPage.locator("[data-enterprise-todo-center]");
    await todoOwnerCenter
      .getByRole("button", { name: "处理反馈", exact: true })
      .click();
    const focusedFeedback = todoOwnerPage
      .locator("[data-workflow-execution-stats] article")
      .filter({ hasText: "反馈需要主管处理" });
    await focusedFeedback.waitFor();
    assert(
      (await focusedFeedback.getAttribute("class"))?.includes("ring-2") === true &&
        (await focusedFeedback
          .getByRole("button", { name: "标记已处理", exact: true })
          .count()) === 1 &&
        (todoOwnerStats.workflowStatsGets || 0) >= 1,
      "feedback todo action did not focus an actionable manager feedback record",
    );
    await todoOwnerContext.close();

    const automationPublishedChoices = [
      {
        id: workflowId,
        title: publishedWorkflowTitle,
        scenario: todoWorkflow.published.fields.scenario,
        revisionId: todoWorkflow.published.revisionId,
        revisionNo: todoWorkflow.published.version,
        stepCount: todoWorkflow.published.fields.steps.length,
      },
    ];
    const completedEventRef = "order-10000000-0000-4000-8000-000000000061";
    const failedEventRef = "order-10000000-0000-4000-8000-000000000062";
    const autoPausedEventRef = "order-10000000-0000-4000-8000-000000000063";
    const automationRunAt = timestamp();
    const automationState = {
      rules: [],
      runs: [
        {
          id: automationCompletedRunId,
          siteId,
          ruleId: automationRuleId,
          ruleVersion: 1,
          sourceType: "order",
          eventRef: completedEventRef,
          eventType: "created",
          fromStatus: null,
          toStatus: "pending",
          status: "completed",
          taskId: todoTask.id,
          workflowId,
          workflowRevisionId: todoWorkflow.published.revisionId,
          errorCode: "",
          attemptCount: 1,
          sourceEventAt: automationRunAt,
          completedAt: automationRunAt,
          createdAt: automationRunAt,
        },
        {
          id: automationFailedRunId,
          siteId,
          ruleId: automationRuleId,
          ruleVersion: 1,
          sourceType: "order",
          eventRef: failedEventRef,
          eventType: "created",
          fromStatus: null,
          toStatus: null,
          status: "failed",
          taskId: null,
          workflowId,
          workflowRevisionId: todoWorkflow.published.revisionId,
          errorCode: "automation_execution_failed",
          attemptCount: 2,
          sourceEventAt: automationRunAt,
          completedAt: automationRunAt,
          createdAt: automationRunAt,
        },
        {
          id: automationAutoPausedRunId,
          siteId,
          ruleId: automationRuleId,
          ruleVersion: 1,
          sourceType: "order",
          eventRef: autoPausedEventRef,
          eventType: "status_changed",
          fromStatus: "pending",
          toStatus: "confirmed",
          status: "failed",
          taskId: null,
          workflowId,
          workflowRevisionId: todoWorkflow.published.revisionId,
          errorCode: "automation_assignee_unavailable",
          attemptCount: 1,
          sourceEventAt: automationRunAt,
          completedAt: automationRunAt,
          createdAt: automationRunAt,
        },
      ],
      sourceAvailability: { order: "inactive", booking: "inactive" },
    };
    const automationStats = { overviewRequests: 0 };
    const automationSnapshot = jsonClone(state.snapshot);
    const automationIneligibleEmployee = automationSnapshot.employees.find(
      (employee) => employee.id === secondEmployeeId,
    );
    if (automationIneligibleEmployee) {
      automationIneligibleEmployee.roleId = "10000000-0000-4000-8000-000000000099";
    }
    const automationContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "block",
      locale: "zh-CN",
    });
    await Promise.all([
      automationContext.addInitScript(acceleratePolling),
      installEnterpriseApiMock(automationContext, state, automationStats, {
        automationState,
        publishedWorkflowChoices: automationPublishedChoices,
        snapshot: automationSnapshot,
      }),
    ]);
    const automationPage = await openHarness(automationContext, baseUrl);
    await automationPage
      .getByRole("button", { name: "流程自动化", exact: true })
      .click();
    const automationManager = automationPage.locator(
      "[data-enterprise-automation-manager]",
    );
    await automationManager.getByText(completedEventRef, { exact: false }).waitFor();
    await automationManager.getByText(failedEventRef, { exact: false }).waitFor();
    await automationManager.getByText(autoPausedEventRef, { exact: false }).waitFor();
    const createdRunText = await automationManager
      .locator("article")
      .filter({ hasText: completedEventRef })
      .textContent();
    const autoPausedRunText = await automationManager
      .locator("article")
      .filter({ hasText: autoPausedEventRef })
      .textContent();
    assert(
      (await automationManager.getByText("第 2 次尝试", { exact: true }).count()) === 1 &&
        (await automationManager
          .getByText(
            "系统会自动重试；如持续失败，请检查规则目标、流程版本和事件服务配置。",
            { exact: true },
          )
          .count()) === 1 &&
        (await automationManager.getByRole("button", { name: /重试/ }).count()) === 0 &&
        createdRunText?.includes("新建事件") === true &&
        createdRunText.includes("状态 — → pending") === false &&
        autoPausedRunText?.includes("负责人权限已失效") === true &&
        autoPausedRunText.includes("automation_assignee_unavailable") === false &&
        (await automationManager
          .getByText("automation_execution_failed", { exact: false })
          .count()) === 0 &&
        (await automationManager
          .getByText("规则已自动暂停，请修复目标、流程或负责人配置后再启用。", {
            exact: true,
          })
          .count()) === 1,
      "automation runs did not expose opaque references and passive retry state",
    );

    await automationManager
      .getByRole("button", { name: "新建规则", exact: true })
      .click();
    let automationEditor = automationManager.locator(
      "[data-enterprise-automation-editor]",
    );
    assert(
      (await automationEditor
        .getByLabel("初始工作列")
        .locator(`option[value="${doneColumnId}"]`)
        .count()) === 0 &&
        (await automationEditor.getByText("浏览器测试员工二", { exact: false }).count()) ===
          0,
      "automation editor offered a completed column or an unauthorized employee",
    );
    await automationEditor.getByLabel("规则名称").fill("新订单流程自动化");
    await automationEditor.getByLabel("任务标题").fill("处理订单 {sourceId}");
    await automationEditor
      .getByRole("button", { name: "保存规则", exact: true })
      .click();
    await automationManager
      .getByText(
        "任务模板只能使用 {eventRef}、{fromStatus}、{toStatus} 三个安全占位符。",
        { exact: true },
      )
      .waitFor();
    assert(
      (automationStats.automationPosts || 0) === 0 &&
        (automationStats.automationMutations || []).length === 0,
      "unsafe automation template reached the API mock",
    );
    await automationEditor
      .getByLabel("任务标题")
      .fill("处理订单事件 {eventRef}");
    const automationStatus = automationEditor.getByLabel("运行状态");
    assert(
      (await automationStatus
        .locator('option[value="active"]')
        .getAttribute("disabled")) !== null,
      "inactive event source allowed selecting an active automation rule",
    );
    await automationStatus.evaluate((element) => {
      const select = element;
      select.value = "active";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await automationEditor
      .getByRole("button", { name: "保存规则", exact: true })
      .click();
    await automationManager
      .getByText("当前来源的事件接入尚未启用，请先保存为暂停规则。", {
        exact: true,
      })
      .waitFor();
    assert(
      (automationStats.automationPosts || 0) === 0 &&
        (automationStats.automationMutations || []).length === 0,
      "active automation rule reached the API while its source was inactive",
    );
    await automationStatus.selectOption("paused");
    await automationEditor
      .getByRole("button", { name: "保存规则", exact: true })
      .click();
    await automationManager
      .getByText("自动化规则已创建。待新业务事件到达后会按规则执行。", {
        exact: true,
      })
      .waitFor();
    assert(
      automationStats.automationPosts === 1 &&
        automationState.rules[0]?.status === "paused" &&
        automationState.rules[0]?.workflowRevisionId ===
          todoWorkflow.published.revisionId &&
        !JSON.stringify((automationStats.automationMutations || [])[0]?.body).includes(
          "sourceId",
        ),
      "paused automation rule creation did not preserve its safe pinned contract",
    );

    automationPublishedChoices[0] = {
      ...automationPublishedChoices[0],
      revisionId: automationRevisionTwoId,
      revisionNo: todoWorkflow.published.version + 1,
    };
    await automationManager
      .getByRole("button", { name: "刷新", exact: true })
      .click();
    await automationManager
      .getByText("有新流程版本", { exact: true })
      .waitFor();
    await automationManager
      .getByRole("button", { name: "编辑", exact: true })
      .click();
    automationEditor = automationManager.locator(
      "[data-enterprise-automation-editor]",
    );
    await automationEditor
      .getByLabel("规则名称")
      .fill("新订单流程自动化（已核对）");
    await automationEditor
      .getByRole("button", { name: "保存规则", exact: true })
      .click();
    await automationManager
      .getByText("自动化规则已更新。", { exact: true })
      .waitFor();
    const pinnedMutation = (automationStats.automationMutations || []).at(-1);
    assert(
      pinnedMutation?.method === "PATCH" &&
        pinnedMutation.body.workflowRevisionId === todoWorkflow.published.revisionId &&
        automationState.rules[0]?.workflowRevisionNo === todoWorkflow.published.version,
      "ordinary automation edit silently upgraded the pinned workflow revision",
    );

    await automationManager
      .getByRole("button", { name: "编辑", exact: true })
      .click();
    automationEditor = automationManager.locator(
      "[data-enterprise-automation-editor]",
    );
    await automationEditor
      .getByRole("button", {
        name: `升级到 v${todoWorkflow.published.version + 1}`,
        exact: true,
      })
      .click();
    await automationEditor
      .getByRole("button", { name: "保存规则", exact: true })
      .click();
    await automationManager
      .getByText("自动化规则已更新。", { exact: true })
      .waitFor();
    const upgradedMutation = (automationStats.automationMutations || []).at(-1);
    assert(
      upgradedMutation?.method === "PATCH" &&
        upgradedMutation.body.workflowRevisionId === automationRevisionTwoId &&
        automationState.rules[0]?.workflowRevisionNo ===
          todoWorkflow.published.version + 1,
      "automation rule was not upgraded only after the explicit revision action",
    );

    automationState.rules[0].assigneeIds = [secondEmployeeId];
    await automationManager
      .getByRole("button", { name: "刷新", exact: true })
      .click();
    await automationManager
      .getByRole("button", { name: "编辑", exact: true })
      .click();
    automationEditor = automationManager.locator(
      "[data-enterprise-automation-editor]",
    );
    await automationEditor
      .getByText("旧规则中存在已失效负责人。保存前请取消其勾选，或先恢复员工、角色及看板权限。", {
        exact: true,
      })
      .waitFor();
    await automationEditor
      .locator("label")
      .filter({ hasText: "浏览器测试员工二" })
      .getByRole("checkbox")
      .click();
    await automationEditor
      .getByRole("button", { name: "保存规则", exact: true })
      .click();
    await automationManager
      .getByText("自动化规则已更新。", { exact: true })
      .waitFor();
    assert(
      automationState.rules[0]?.assigneeIds.length === 0,
      "automation editor did not let the owner remove an invalid legacy assignee",
    );

    automationState.rules[0].status = "active";
    await automationManager
      .getByRole("button", { name: "刷新", exact: true })
      .click();
    await automationManager
      .getByText("已启用·等待事件服务", { exact: true })
      .waitFor();
    const completedRun = automationManager
      .locator("article")
      .filter({ hasText: completedEventRef });
    await completedRun
      .getByRole("button", { name: "打开任务", exact: true })
      .click();
    const automationTaskEditor = automationPage.getByRole("dialog", {
      name: "编辑任务",
    });
    await automationTaskEditor.waitFor();
    assert(
      (await automationTaskEditor.getByLabel("任务标题").inputValue()) ===
        todoTask.title,
      "completed automation run did not open its generated task",
    );
    await automationTaskEditor
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await automationPage
      .getByRole("button", { name: "流程自动化", exact: true })
      .click();
    await automationManager
      .getByText("新订单流程自动化（已核对）", { exact: true })
      .waitFor();
    automationPage.once("dialog", (dialog) => void dialog.accept());
    await automationManager
      .locator("article")
      .filter({ hasText: "新订单流程自动化（已核对）" })
      .getByRole("button", { name: "归档", exact: true })
      .click();
    await automationManager
      .getByText("自动化规则已归档；已有运行记录和审计记录会继续保留。", {
        exact: true,
      })
      .waitFor();
    assert(
      automationState.rules[0]?.status === "archived" &&
        Boolean(automationState.rules[0]?.archivedAt) &&
        (await automationManager
          .getByText("新订单流程自动化（已核对）", { exact: true })
          .count()) === 0 &&
        (await automationManager.getByText(completedEventRef, { exact: false }).count()) === 1 &&
        (automationStats.automationMutations || []).at(-1)?.body.action === "archive",
      "automation archive did not hide the rule while preserving its run history",
    );
    await automationContext.close();

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
      locale: "zh-CN",
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
    await employeePage.getByRole("button", { name: /企业通知，1 条未读/ }).click();
    const notificationDialog = employeePage.getByRole("dialog", { name: "企业通知" });
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

    const workflowNotificationActor = {
      type: "employee",
      id: "10000000-0000-4000-8000-000000000034",
      siteId,
      displayName: "流程通知员工",
      email: "workflow-notification@example.test",
      permissions: ["enterprise.view", "tasks.view", "tasks.create", "workflows.view"],
      accessScope: "all",
      allowedBoardIds: [],
    };
    const workflowNotifications = [
      {
        id: "10000000-0000-4000-8000-000000000035",
        siteId,
        taskId: null,
        workflowId,
        type: "workflow_published",
        actorType: "owner",
        actorId: ownerId,
        payload: {
          workflowTitle: publishedWorkflowTitle,
          publishedVersion: 1,
        },
        readAt: null,
        createdAt: timestamp(),
      },
    ];
    const workflowNotificationStats = {
      overviewRequests: 0,
      notificationGets: 0,
      notificationPatches: 0,
    };
    const workflowNotificationContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "block",
      locale: "zh-CN",
    });
    await Promise.all([
      workflowNotificationContext.addInitScript(acceleratePolling),
      installEnterpriseApiMock(
        workflowNotificationContext,
        state,
        workflowNotificationStats,
        {
          actor: workflowNotificationActor,
          notifications: workflowNotifications,
        },
      ),
    ]);
    const workflowNotificationPage = await openHarness(workflowNotificationContext, baseUrl);
    await workflowNotificationPage
      .getByRole("button", { name: "任务看板", exact: true })
      .click();
    const workflowNotificationDraft = workflowNotificationPage.getByLabel("任务标题");
    await workflowNotificationDraft.fill("流程通知跳转前的未保存任务");
    await workflowNotificationPage
      .getByRole("button", { name: /企业通知，1 条未读/ })
      .click();
    const workflowNotificationDialog = workflowNotificationPage.getByRole("dialog", {
      name: "企业通知",
    });
    const workflowNotificationButton = workflowNotificationDialog
      .getByRole("button")
      .filter({ hasText: publishedWorkflowTitle });
    workflowNotificationPage.once("dialog", (dialog) => void dialog.dismiss());
    await workflowNotificationButton.click();
    assert(
      (await workflowNotificationPage.locator('[aria-current="page"]').textContent()) ===
        "任务看板" &&
        (await workflowNotificationDraft.inputValue()) ===
          "流程通知跳转前的未保存任务" &&
        workflowNotificationStats.notificationPatches === 0,
      "canceling workflow-notification navigation discarded the local draft or marked it read",
    );
    workflowNotificationPage.once("dialog", (dialog) => void dialog.accept());
    await workflowNotificationButton.click();
    await workflowNotificationPage
      .locator('section[aria-label="工作流程与标准作业程序"]')
      .getByRole("heading", { name: publishedWorkflowTitle, exact: true })
      .waitFor();
    await workflowNotificationPage.waitForTimeout(100);
    assert(
      (await workflowNotificationPage.locator('[aria-current="page"]').textContent()) ===
        "工作流程" && workflowNotificationStats.notificationPatches === 1,
      "workflow-published notification did not open its workflow and persist read state",
    );

    const workflowDraftNotificationActor = {
      ...workflowNotificationActor,
      id: "10000000-0000-4000-8000-000000000036",
      displayName: "流程编辑通知员工",
      email: "workflow-draft-notification@example.test",
      permissions: ["enterprise.view", "workflows.view", "workflows.manage"],
    };
    const workflowDraftNotifications = [
      {
        ...workflowNotifications[0],
        id: "10000000-0000-4000-8000-000000000037",
        workflowId: "10000000-0000-4000-8000-000000000101",
        payload: {
          workflowTitle: "历史流程 01",
          publishedVersion: 1,
        },
        readAt: null,
      },
    ];
    const workflowDraftNotificationStats = {
      overviewRequests: 0,
      notificationGets: 0,
      notificationPatches: 0,
    };
    const workflowDraftNotificationContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "block",
      locale: "zh-CN",
    });
    await Promise.all([
      workflowDraftNotificationContext.addInitScript(acceleratePolling),
      installEnterpriseApiMock(
        workflowDraftNotificationContext,
        state,
        workflowDraftNotificationStats,
        {
          actor: workflowDraftNotificationActor,
          notifications: workflowDraftNotifications,
          workflowArchiveDelayMs: 2_000,
          workflowExactDelayMs: 600,
        },
      ),
    ]);
    const workflowDraftNotificationPage = await openHarness(
      workflowDraftNotificationContext,
      baseUrl,
    );
    await workflowDraftNotificationPage
      .getByRole("button", { name: "工作流程", exact: true })
      .click();
    const workflowDraftNotificationPanel = workflowDraftNotificationPage.locator(
      'section[aria-label="工作流程与标准作业程序"]',
    );
    await workflowDraftNotificationPanel
      .getByRole("heading", { name: draftWorkflowTitle, exact: true })
      .waitFor();
    await workflowDraftNotificationPanel
      .getByRole("button", { name: "编辑草稿", exact: true })
      .click();
    const sameViewDirtyDescription = "同页通知跳转前未保存的流程正文";
    const workflowDraftDescription = workflowDraftNotificationPanel.getByLabel("流程说明");
    await workflowDraftDescription.fill(sameViewDirtyDescription);
    const preservedWorkflowFilter = "保留这个筛选条件";
    await workflowDraftNotificationPanel.getByLabel("搜索").fill(preservedWorkflowFilter);
    await workflowDraftNotificationPanel.getByLabel("状态").selectOption("all");
    await workflowDraftNotificationPage
      .getByRole("button", { name: /企业通知，1 条未读/ })
      .click();
    const workflowDraftNotificationDialog = workflowDraftNotificationPage.getByRole("dialog", {
      name: "企业通知",
    });
    const workflowDraftNotificationButton = workflowDraftNotificationDialog
      .getByRole("button")
      .filter({ hasText: "历史流程 01" });
    workflowDraftNotificationPage.once("dialog", (dialog) => void dialog.dismiss());
    await workflowDraftNotificationButton.click();
    assert(
      (await workflowDraftDescription.inputValue()) === sameViewDirtyDescription &&
        workflowDraftNotificationStats.notificationPatches === 0,
      "canceling same-view workflow notification navigation discarded the draft or marked it read",
    );
    workflowDraftNotificationPage.once("dialog", (dialog) => void dialog.accept());
    await workflowDraftNotificationButton.click();
    await workflowDraftNotificationPage.waitForTimeout(100);
    const changedDuringFocus = "精确查询期间产生的新修改";
    await workflowDraftDescription.fill(changedDuringFocus);
    await workflowDraftNotificationPage.waitForTimeout(650);
    assert(
      (await workflowDraftDescription.inputValue()) === changedDuringFocus &&
        workflowDraftNotificationStats.notificationPatches === 0,
      "a slow exact workflow lookup discarded a newer draft or marked its notification read",
    );
    workflowDraftNotificationPage.once("dialog", (dialog) => void dialog.accept());
    await workflowDraftNotificationButton.click();
    await workflowDraftNotificationPanel
      .getByRole("heading", { name: "历史流程 01", exact: true })
      .waitFor();
    await workflowDraftNotificationPage.waitForTimeout(100);
    assert(
      (await workflowDraftNotificationPanel.getByLabel("流程说明").count()) === 0 &&
        (await workflowDraftNotificationPanel.getByLabel("搜索").inputValue()) ===
          preservedWorkflowFilter &&
        workflowDraftNotificationStats.workflowExactGets === 2 &&
        workflowDraftNotificationStats.notificationPatches === 1,
      "confirming same-view workflow notification navigation did not consume focus exactly once",
    );

    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      serviceWorkers: "block",
      locale: "zh-CN",
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
    await mobilePage.getByRole("button", { name: "收起新建任务", exact: true }).click();
    await mobilePage.getByRole("button", { name: "工作流程", exact: true }).click();
    const mobileWorkflowPanel = mobilePage.locator(
      'section[aria-label="工作流程与标准作业程序"]',
    );
    await mobileWorkflowPanel
      .getByRole("heading", { name: draftWorkflowTitle, exact: true })
      .waitFor();
    await mobileWorkflowPanel.getByLabel("状态").selectOption("all");
    await mobileWorkflowPanel
      .getByRole("button", { name: "加载更多归档流程", exact: true })
      .waitFor();
    const archivePagerViewport = await mobilePage.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    assert(
      archivePagerViewport.scrollWidth <= archivePagerViewport.innerWidth + 1,
      `enterprise archive pager mobile layout overflows horizontally:${JSON.stringify(archivePagerViewport)}`,
    );
    await mobileWorkflowPanel
      .getByRole("button", { name: "加载更多归档流程", exact: true })
      .click();
    await mobileWorkflowPanel.getByText("历史流程 01", { exact: true }).waitFor();
    await mobileWorkflowPanel.getByLabel("状态").selectOption("current");
    await mobileWorkflowPanel.getByRole("button", { name: "编辑草稿", exact: true }).click();
    await mobileWorkflowPanel.getByLabel("流程名称 *").waitFor();
    const workflowViewport = await mobilePage.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    assert(
      workflowViewport.scrollWidth <= workflowViewport.innerWidth + 1,
      `enterprise workflow mobile layout overflows horizontally:${JSON.stringify(workflowViewport)}`,
    );

    await mobilePage.getByRole("button", { name: "角色权限", exact: true }).click();
    await mobilePage.getByRole("heading", { name: "现有角色", exact: true }).waitFor();
    const mobileRoleBody = mobilePage.locator(`#role-editor-${roleId}-body`);
    await mobilePage.locator(`button[aria-controls="role-editor-${roleId}-body"]`).click();
    const mobilePermissionNavigation = mobileRoleBody.getByRole("navigation", {
      name: "权限主要板块",
    });
    await mobilePermissionNavigation.getByRole("button", { name: /订单管理/ }).click();
    const mobileOrderGroup = mobileRoleBody.locator(
      '[data-role-permission-group="订单管理"]',
    );
    const mobileOrderViewHelp = mobileOrderGroup.getByRole("button", {
      name: "查看“查看订单”权限说明",
      exact: true,
    });
    const mobileOrderTooltip = mobileOrderGroup.getByRole("tooltip").first();
    await mobileOrderViewHelp.click();
    await mobilePage.waitForTimeout(200);
    const mobileRoleMetrics = await mobilePage.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    const mobileTooltipBounds = await mobileOrderTooltip.boundingBox();
    assert(
      mobileRoleMetrics.scrollWidth <= mobileRoleMetrics.innerWidth + 1 &&
        mobileTooltipBounds &&
        mobileTooltipBounds.x >= -1 &&
        mobileTooltipBounds.x + mobileTooltipBounds.width <= mobileRoleMetrics.innerWidth + 1 &&
        await mobileOrderTooltip.evaluate((element) => getComputedStyle(element).opacity) === "1",
      `mobile role tooltip overflowed or did not open:${JSON.stringify({ mobileRoleMetrics, mobileTooltipBounds })}`,
    );
    if (screenshotDirectory) {
      await mobilePage.screenshot({
        path: path.join(screenshotDirectory, "role-permissions-mobile-expanded.png"),
        fullPage: true,
      });
    }
    await mobileOrderViewHelp.click();
    await mobilePage.waitForTimeout(200);
    assert(
      await mobileOrderTooltip.evaluate((element) => getComputedStyle(element).opacity) === "0",
      "mobile permission description did not close on its second tap",
    );

    const mobileEmployeeRoleBody = mobilePage.locator(`#role-editor-${employeeRoleId}-body`);
    await mobilePage
      .locator(`button[aria-controls="role-editor-${employeeRoleId}-body"]`)
      .click();
    await mobileEmployeeRoleBody.waitFor();
    const mobileEmployeePermissionNavigation = mobileEmployeeRoleBody.getByRole("navigation", {
      name: "权限主要板块",
    });
    const mobileWorkbenchSelection = mobileEmployeePermissionNavigation.getByRole("button", {
      name: /^工作台，/,
    });
    const mobileTaskSelection = mobileEmployeePermissionNavigation.getByRole("button", {
      name: /^任务与看板，/,
    });
    const mobileLinkedOrderSelection = mobileEmployeePermissionNavigation.getByRole("button", {
      name: /^任务关联订单，/,
    });
    assert(
      await mobileWorkbenchSelection.getAttribute("data-role-permission-selection") === "complete" &&
        await mobileTaskSelection.getAttribute("data-role-permission-selection") === "partial" &&
        await mobileLinkedOrderSelection.getAttribute("data-role-permission-selection") === "empty",
      "mobile role navigation did not expose complete, partial, and empty selection states",
    );
    await mobileLinkedOrderSelection.click();
    const mobileSelectionLayout = await Promise.all(
      [mobileWorkbenchSelection, mobileTaskSelection, mobileLinkedOrderSelection].map(
        (selection) =>
          selection.evaluate((element) => {
            const count = element.querySelector("[data-role-permission-selection-count]");
            const buttonBounds = element.getBoundingClientRect();
            const countBounds = count?.getBoundingClientRect();
            return {
              buttonClientWidth: element.clientWidth,
              buttonScrollWidth: element.scrollWidth,
              buttonLeft: buttonBounds.left,
              buttonRight: buttonBounds.right,
              countClientWidth: count?.clientWidth ?? 0,
              countScrollWidth: count?.scrollWidth ?? 0,
              countLeft: countBounds?.left ?? -1,
              countRight: countBounds?.right ?? -1,
              countFontSize: count ? Number.parseFloat(getComputedStyle(count).fontSize) : 0,
              countFontWeight: count ? Number.parseInt(getComputedStyle(count).fontWeight, 10) : 0,
            };
          }),
      ),
    );
    const mobileSelectionViewport = await mobilePage.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    assert(
      await mobileLinkedOrderSelection.getAttribute("aria-pressed") === "true" &&
        await mobileLinkedOrderSelection.getAttribute("data-role-permission-selection") === "empty" &&
        mobileSelectionViewport.scrollWidth <= mobileSelectionViewport.innerWidth + 1 &&
        mobileSelectionLayout.every(
          (item) =>
            item.buttonScrollWidth <= item.buttonClientWidth + 1 &&
            item.countScrollWidth <= item.countClientWidth + 1 &&
            item.buttonLeft >= -1 &&
            item.buttonRight <= mobileSelectionViewport.innerWidth + 1 &&
            item.countLeft >= item.buttonLeft - 1 &&
            item.countRight <= item.buttonRight + 1 &&
            item.countFontSize >= 12 &&
            item.countFontWeight >= 600,
        ),
      `mobile permission selection counts overflowed or were not prominent:${JSON.stringify({ mobileSelectionViewport, mobileSelectionLayout })}`,
    );
    if (screenshotDirectory) {
      await mobilePage.screenshot({
        path: path.join(screenshotDirectory, "role-permissions-mobile-selection-states.png"),
        fullPage: true,
      });
    }

    await pageA.waitForTimeout(100);
    assert(
      roleNavigationMutationCount === 0,
      `permission navigation or local draft changes caused a delayed role mutation:${roleNavigationMutationCount}`,
    );
    pageA.off("request", countRoleNavigationMutations);

    await Promise.all([
      ownerContextA.close(),
      ownerContextB.close(),
      employeeContext.close(),
      workflowNotificationContext.close(),
      workflowDraftNotificationContext.close(),
      mobileContext.close(),
    ]);
    process.stdout.write(
      JSON.stringify({
        ok: true,
        checks: [
          "employee_members_only_business_root_without_enterprise_mount",
          "employee_capabilities_unavailable_fail_closed",
          "desktop_owner_task_creation",
          "desktop_compact_role_permissions_and_draft_retention",
          "desktop_permission_selection_counts_and_state_separation",
          "desktop_role_permission_hover_keyboard_help",
          "two_context_foreground_refresh",
          "draft_safe_refresh_pause_and_resume",
          "board_settings_dirty_switch_and_collapse_guards",
          "employee_inline_editor_dirty_switch_guard",
          "owner_workflow_draft_step_and_publish",
          "workflow_manager_execution_stats",
          "workflow_immutable_revision_history",
          "task_published_workflow_binding_checklist_and_event",
          "workflow_published_snapshot_isolated_from_new_draft",
          "workflow_manage_and_publish_ui_separation",
          "workflow_archive_refresh_and_restore",
          "workflow_archive_keyset_pagination_without_duplicates",
          "workflow_archive_selection_survives_filter_and_refresh",
          "workflow_menu_dirty_navigation_guard",
          "workflow_cas_conflict_keeps_local_body",
          "owner_audit_listing_and_pagination",
          "todo_employee_permission_navigation_and_category_filters",
          "todo_task_acknowledgement_and_execution_actions",
          "todo_manager_feedback_focus_action",
          "automation_paused_create_and_inactive_source_guard",
          "automation_pinned_revision_edit_and_explicit_upgrade",
          "automation_opaque_runs_retry_state_and_task_navigation",
          "automation_archive_hides_rule_and_retains_history",
          "employee_notification_dirty_cancel_and_mark_read",
          "workflow_notification_dirty_cancel_and_target_navigation",
          "workflow_notification_same_view_dirty_guard_and_single_focus",
          "workflow_notification_slow_exact_preserves_newer_draft",
          "task_editor_unsaved_close_guard",
          "mobile_task_and_workflow_horizontal_layout",
          "mobile_role_permission_help_and_horizontal_layout",
          "mobile_permission_selection_counts_without_overflow",
          "mobile_workflow_archive_pager_and_second_page",
        ],
      }) + "\n",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const serverOutput = readServerOutput().trim();
    throw new Error(serverOutput ? `${message}\n${serverOutput}` : message);
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
