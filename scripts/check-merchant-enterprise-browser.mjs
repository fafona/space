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
const workflowId = "10000000-0000-4000-8000-000000000030";
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
        acknowledgement: null,
        executions: [],
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
      const choices = state.workflows
        .filter((workflow) => workflow.status === "published" && workflow.published)
        .map((workflow) => ({
          id: workflow.id,
          title: workflow.published.fields.title,
          scenario: workflow.published.fields.scenario,
          revisionId: workflow.published.revisionId,
          revisionNo: workflow.published.version,
          stepCount: workflow.published.fields.steps.length,
        }));
      return respond(200, { ok: true, choices: jsonClone(choices) });
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
    await secondEmployeeRow.getByRole("button", { name: "收起资料", exact: true }).click();

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
    });
    const workflowManageContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "block",
    });
    const workflowPublishContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "block",
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
          "desktop_owner_task_creation",
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
          "employee_notification_dirty_cancel_and_mark_read",
          "workflow_notification_dirty_cancel_and_target_navigation",
          "workflow_notification_same_view_dirty_guard_and_single_focus",
          "workflow_notification_slow_exact_preserves_newer_draft",
          "task_editor_unsaved_close_guard",
          "mobile_task_and_workflow_horizontal_layout",
          "mobile_workflow_archive_pager_and_second_page",
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
