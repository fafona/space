import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMerchantEnterpriseTaskOverview,
  buildMerchantTaskEditChanges,
  DEFAULT_MERCHANT_ENTERPRISE_ROLES,
  canMerchantEnterpriseEmployeeCoverBoards,
  canCreateMerchantEnterpriseBoards,
  filterMerchantEnterpriseSnapshotByBoardAccess,
  filterMerchantTasks,
  getMerchantEmployeeRoleTransitionAffectedTasks,
  getMerchantEnterpriseDefaultRoleBoardAccess,
  getMerchantEnterpriseDefaultTaskAssigneeFilter,
  getMerchantTaskCompletionTransition,
  getMissingMerchantEnterprisePermissionDependencies,
  hasMerchantEnterprisePermission,
  hasMerchantEnterpriseBoardAccess,
  isMerchantEnterpriseSchemaMissingError,
  isMerchantEnterpriseVersion,
  MERCHANT_ENTERPRISE_PERMISSIONS,
  merchantEnterprisePermissionsFitActor,
  merchantEnterpriseBoardAccessFitsActor,
  merchantEnterpriseRoleFitsActor,
  normalizeMerchantEnterpriseEmployee,
  normalizeMerchantEnterpriseAuditEvent,
  normalizeMerchantEnterprisePermissions,
  normalizeMerchantEnterpriseRole,
  normalizeMerchantTaskBoard,
  normalizeMerchantTask,
  normalizeMerchantTaskEvent,
  parseMerchantEnterprisePermissionsStrict,
  parseMerchantEnterpriseBoardAccessStrict,
  toggleMerchantEnterprisePermissionSelection,
  type MerchantEnterpriseActor,
  type MerchantEnterpriseSnapshot,
  type MerchantTask,
  type MerchantTaskColumn,
} from "@/lib/merchantEnterprise";

test("enterprise permission normalization removes unknown and duplicate permissions", () => {
  assert.deepEqual(
    normalizeMerchantEnterprisePermissions([
      "tasks.view",
      "tasks.view",
      "unknown.permission",
      "employees.manage",
    ]),
    ["tasks.view", "employees.manage"],
  );
});

test("owner has every enterprise permission while employees use their assigned permissions", () => {
  const owner = {
    type: "owner" as const,
    id: "owner-1",
    siteId: "10000000",
    displayName: "Owner",
    email: "owner@example.com",
    permissions: [],
    accessScope: "all" as const,
    allowedBoardIds: [],
  };
  assert.equal(hasMerchantEnterprisePermission(owner, "roles.manage"), true);
  assert.equal(hasMerchantEnterprisePermission(owner, "orders.linked.view"), true);
  assert.equal(
    hasMerchantEnterprisePermission(
      {
        type: "employee",
        id: "employee-1",
        siteId: "10000000",
        displayName: "Employee",
        email: "employee@example.com",
        roleId: "role-1",
        permissions: ["tasks.view"],
        accessScope: "all",
        allowedBoardIds: [],
      },
      "roles.manage",
    ),
    false,
  );
});

test("linked order summaries remain opt-in for every default employee role", () => {
  assert.ok(MERCHANT_ENTERPRISE_PERMISSIONS.includes("orders.linked.view"));
  for (const role of DEFAULT_MERCHANT_ENTERPRISE_ROLES) {
    assert.equal(role.permissions.includes("orders.linked.view"), false);
  }
});

test("enterprise audit permission is explicit and depends on workspace access", () => {
  assert.ok(MERCHANT_ENTERPRISE_PERMISSIONS.includes("audit.view"));
  assert.deepEqual(
    getMissingMerchantEnterprisePermissionDependencies(["audit.view"]),
    ["enterprise.view"],
  );
  for (const role of DEFAULT_MERCHANT_ENTERPRISE_ROLES) {
    assert.equal(role.permissions.includes("audit.view"), false);
  }
});

test("enterprise audit normalization accepts only sanitized immutable event rows", () => {
  const event = normalizeMerchantEnterpriseAuditEvent({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    merchant_id: "10000000",
    event_type: "employee.renamed",
    entity_type: "employee",
    entity_id: "77777777-7777-4777-8777-777777777777",
    actor_type: "owner",
    actor_id: null,
    actor_label: "企业负责人",
    target_label: "仓库员工",
    before_data: { display_name: "旧名称", role_id: null },
    after_data: { display_name: "新名称", role_id: null },
    operation_id: "employee-update-1",
    created_at: "2026-08-02T12:00:00+00:00",
  });
  assert.ok(event);
  assert.deepEqual(event, {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    siteId: "10000000",
    eventType: "employee.renamed",
    entityType: "employee",
    entityId: "77777777-7777-4777-8777-777777777777",
    actorType: "owner",
    actorId: null,
    actorLabel: "企业负责人",
    targetLabel: "仓库员工",
    beforeData: { display_name: "旧名称", role_id: null },
    afterData: { display_name: "新名称", role_id: null },
    operationId: "employee-update-1",
    createdAt: "2026-08-02T12:00:00.000Z",
  });

  assert.equal(
    normalizeMerchantEnterpriseAuditEvent({
      ...event,
      eventType: "employee.renamed",
      entityType: "employee",
      actorType: "owner",
      actorId: "88888888-8888-4888-8888-888888888888",
    }),
    null,
  );
  assert.equal(
    normalizeMerchantEnterpriseAuditEvent({
      ...event,
      beforeData: { display_name: "旧名称", invitation_token_hash: "secret" },
    }),
    null,
  );
  assert.equal(
    normalizeMerchantEnterpriseAuditEvent({
      ...event,
      eventType: "role.updated",
      entityType: "employee",
    }),
    null,
  );
});

test("enterprise role board access normalization is backward compatible and fail-closed", () => {
  const boardA = "11111111-1111-4111-8111-111111111111";
  const baseRole = {
    id: "22222222-2222-4222-8222-222222222222",
    merchant_id: "10000000",
    name: "仓库员工",
    permissions: ["enterprise.view", "tasks.view"],
    status: "active",
    is_system: false,
    version: 1,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
  };

  const legacy = normalizeMerchantEnterpriseRole(baseRole);
  assert.equal(legacy?.accessScope, "all");
  assert.deepEqual(legacy?.allowedBoardIds, []);

  const restricted = normalizeMerchantEnterpriseRole({
    ...baseRole,
    access_scope: "restricted",
    allowed_board_ids: [boardA, boardA, "invalid"],
  });
  assert.equal(restricted?.accessScope, "restricted");
  assert.deepEqual(restricted?.allowedBoardIds, [boardA]);

  assert.equal(normalizeMerchantEnterpriseRole({ ...baseRole, access_scope: null }), null);
  assert.equal(normalizeMerchantEnterpriseRole({ ...baseRole, access_scope: "unknown" }), null);
  assert.deepEqual(
    normalizeMerchantEnterpriseRole({
      ...baseRole,
      access_scope: "all",
      allowed_board_ids: [boardA],
    })?.allowedBoardIds,
    [],
  );
});

test("strict role board access parsing rejects ambiguous or malformed scopes", () => {
  const boardA = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(parseMerchantEnterpriseBoardAccessStrict("all", []), {
    accessScope: "all",
    allowedBoardIds: [],
  });
  assert.deepEqual(parseMerchantEnterpriseBoardAccessStrict("restricted", [boardA]), {
    accessScope: "restricted",
    allowedBoardIds: [boardA],
  });
  assert.equal(parseMerchantEnterpriseBoardAccessStrict("all", [boardA]), null);
  assert.equal(parseMerchantEnterpriseBoardAccessStrict("restricted", [boardA, boardA]), null);
  assert.equal(parseMerchantEnterpriseBoardAccessStrict("restricted", ["invalid"]), null);
  assert.equal(parseMerchantEnterpriseBoardAccessStrict(null, []), null);
});

test("role board access cannot exceed a restricted employee's own boards", () => {
  const boardA = "11111111-1111-4111-8111-111111111111";
  const boardB = "22222222-2222-4222-8222-222222222222";
  const actor: MerchantEnterpriseActor = {
    type: "employee",
    id: "employee-1",
    siteId: "10000000",
    displayName: "区域主管",
    email: "lead@example.com",
    roleId: "role-lead",
    permissions: ["enterprise.view", "tasks.view", "boards.manage", "roles.view", "roles.manage"],
    accessScope: "restricted",
    allowedBoardIds: [boardA],
  };

  assert.equal(hasMerchantEnterpriseBoardAccess(actor, boardA), true);
  assert.equal(hasMerchantEnterpriseBoardAccess(actor, boardB), false);
  assert.equal(
    merchantEnterpriseBoardAccessFitsActor(actor, {
      accessScope: "restricted",
      allowedBoardIds: [],
    }),
    true,
  );
  assert.equal(
    merchantEnterpriseBoardAccessFitsActor(actor, {
      accessScope: "restricted",
      allowedBoardIds: [boardA],
    }),
    true,
  );
  assert.equal(
    merchantEnterpriseBoardAccessFitsActor(actor, {
      accessScope: "restricted",
      allowedBoardIds: [boardB],
    }),
    false,
  );
  assert.equal(
    merchantEnterpriseBoardAccessFitsActor(actor, {
      accessScope: "all",
      allowedBoardIds: [],
    }),
    false,
  );
  assert.equal(
    merchantEnterpriseRoleFitsActor(actor, {
      permissions: ["enterprise.view", "tasks.view"],
      accessScope: "restricted",
      allowedBoardIds: [boardA],
    }),
    true,
  );
  assert.equal(canCreateMerchantEnterpriseBoards(actor), false);
  assert.deepEqual(getMerchantEnterpriseDefaultRoleBoardAccess(actor), {
    accessScope: "restricted",
    allowedBoardIds: [boardA],
  });
});

test("role transitions report only assigned open tasks the target role cannot view", () => {
  const employee = { id: "employee-1" };
  const baseTask = {
    id: "task-covered",
    siteId: "10000000",
    boardId: "board-covered",
    columnId: "column-1",
    title: "Covered task",
    description: "",
    priority: "normal",
    dueAt: null,
    completedAt: null,
    archivedAt: null,
    position: 0,
    sourceType: "",
    sourceId: "",
    createdByEmployeeId: "",
    assigneeIds: [employee.id],
    version: 1,
    createdAt: "2026-07-31T08:00:00.000Z",
    updatedAt: "2026-07-31T08:00:00.000Z",
  } satisfies MerchantTask;
  const tasks = [
    baseTask,
    { ...baseTask, id: "task-uncovered", boardId: "board-uncovered" },
    {
      ...baseTask,
      id: "task-completed",
      boardId: "board-uncovered",
      completedAt: "2026-07-31T09:00:00.000Z",
    },
    {
      ...baseTask,
      id: "task-archived",
      boardId: "board-uncovered",
      archivedAt: "2026-07-31T09:00:00.000Z",
    },
    {
      ...baseTask,
      id: "task-other-assignee",
      boardId: "board-uncovered",
      assigneeIds: ["employee-2"],
    },
  ] satisfies MerchantTask[];

  assert.deepEqual(
    getMerchantEmployeeRoleTransitionAffectedTasks(
      employee,
      {
        permissions: ["enterprise.view", "tasks.view"],
        accessScope: "restricted",
        allowedBoardIds: ["board-covered"],
      },
      tasks,
    ).map((task) => task.id),
    ["task-uncovered"],
  );
});

test("all-board task viewing preserves assignments while missing tasks.view affects every open assignment", () => {
  const tasks = [
    {
      id: "task-a",
      siteId: "10000000",
      boardId: "board-a",
      columnId: "column-a",
      title: "Task A",
      description: "",
      priority: "normal",
      dueAt: null,
      completedAt: null,
      archivedAt: null,
      position: 0,
      sourceType: "",
      sourceId: "",
      createdByEmployeeId: "",
      assigneeIds: ["employee-1"],
      version: 1,
      createdAt: "2026-07-31T08:00:00.000Z",
      updatedAt: "2026-07-31T08:00:00.000Z",
    },
    {
      id: "task-b",
      siteId: "10000000",
      boardId: "board-b",
      columnId: "column-b",
      title: "Task B",
      description: "",
      priority: "high",
      dueAt: null,
      completedAt: null,
      archivedAt: null,
      position: 1,
      sourceType: "",
      sourceId: "",
      createdByEmployeeId: "",
      assigneeIds: ["employee-1", "employee-2"],
      version: 1,
      createdAt: "2026-07-31T08:00:00.000Z",
      updatedAt: "2026-07-31T08:00:00.000Z",
    },
  ] satisfies MerchantTask[];

  assert.deepEqual(
    getMerchantEmployeeRoleTransitionAffectedTasks(
      { id: "employee-1" },
      {
        permissions: ["enterprise.view", "tasks.view"],
        accessScope: "all",
        allowedBoardIds: [],
      },
      tasks,
    ),
    [],
  );
  assert.deepEqual(
    getMerchantEmployeeRoleTransitionAffectedTasks(
      { id: "employee-1" },
      {
        permissions: ["enterprise.view"],
        accessScope: "all",
        allowedBoardIds: [],
      },
      tasks,
    ).map((task) => task.id),
    ["task-a", "task-b"],
  );
});

test("active replacement employees cover boards only through their matching active view role", () => {
  const employee = {
    roleId: "role-1",
    status: "active" as const,
  };
  const restrictedRole = {
    id: "role-1",
    status: "active" as const,
    permissions: ["enterprise.view", "tasks.view"] as const,
    accessScope: "restricted" as const,
    allowedBoardIds: ["board-a", "board-b"],
  };

  assert.equal(
    canMerchantEnterpriseEmployeeCoverBoards(employee, restrictedRole, ["board-a", "board-b"]),
    true,
  );
  assert.equal(
    canMerchantEnterpriseEmployeeCoverBoards(employee, restrictedRole, ["board-a", "board-c"]),
    false,
  );
  assert.equal(
    canMerchantEnterpriseEmployeeCoverBoards(
      employee,
      { ...restrictedRole, accessScope: "all", allowedBoardIds: [] },
      ["board-a", "board-c"],
    ),
    true,
  );
  assert.equal(
    canMerchantEnterpriseEmployeeCoverBoards(
      employee,
      { ...restrictedRole, permissions: ["enterprise.view"] },
      [],
    ),
    false,
  );
});

test("invalid replacement employees or roles cannot cover boards", () => {
  const activeRole = {
    id: "role-1",
    status: "active" as const,
    permissions: ["enterprise.view", "tasks.view"] as const,
    accessScope: "all" as const,
    allowedBoardIds: [],
  };

  assert.equal(canMerchantEnterpriseEmployeeCoverBoards(null, activeRole, []), false);
  assert.equal(
    canMerchantEnterpriseEmployeeCoverBoards(
      { roleId: "role-1", status: "disabled" },
      activeRole,
      [],
    ),
    false,
  );
  assert.equal(
    canMerchantEnterpriseEmployeeCoverBoards(
      { roleId: "role-2", status: "active" },
      activeRole,
      [],
    ),
    false,
  );
  assert.equal(
    canMerchantEnterpriseEmployeeCoverBoards(
      { roleId: "role-1", status: "active" },
      { ...activeRole, status: "archived" },
      [],
    ),
    false,
  );
});

test("restricted enterprise snapshots expose only allowed board resources", () => {
  const boardA = "11111111-1111-4111-8111-111111111111";
  const boardB = "22222222-2222-4222-8222-222222222222";
  const actor: MerchantEnterpriseActor = {
    type: "employee",
    id: "employee-1",
    siteId: "10000000",
    displayName: "员工",
    email: "employee@example.com",
    roleId: "role-1",
    permissions: ["enterprise.view", "tasks.view"],
    accessScope: "restricted",
    allowedBoardIds: [boardA],
  };
  const snapshot = {
    roles: [],
    employees: [],
    boards: [
      { id: boardA, siteId: "10000000" },
      { id: boardB, siteId: "10000000" },
    ],
    columns: [
      { id: "column-a", boardId: boardA },
      { id: "column-b", boardId: boardB },
    ],
    tasks: [
      { id: "task-a", boardId: boardA },
      { id: "task-b", boardId: boardB },
    ],
  } as unknown as MerchantEnterpriseSnapshot;

  const visible = filterMerchantEnterpriseSnapshotByBoardAccess(actor, snapshot);
  assert.deepEqual(visible.boards.map((board) => board.id), [boardA]);
  assert.deepEqual(visible.columns.map((column) => column.id), ["column-a"]);
  assert.deepEqual(visible.tasks.map((task) => task.id), ["task-a"]);
});

test("enterprise row normalization accepts database snake-case fields", () => {
  const employee = normalizeMerchantEnterpriseEmployee({
    id: "employee-1",
    merchant_id: "10000000",
    auth_user_id: "auth-1",
    email: "STAFF@EXAMPLE.COM",
    display_name: "Staff",
    role_id: "role-1",
    status: "active",
    version: 2,
    created_at: "2026-07-31T08:00:00.000Z",
    updated_at: "2026-07-31T09:00:00.000Z",
  });
  assert.equal(employee?.email, "staff@example.com");
  assert.equal(employee?.roleId, "role-1");
  assert.equal(employee?.version, 2);

  const board = normalizeMerchantTaskBoard({
    id: "board-1",
    merchant_id: "10000000",
    name: "Operations",
    description: "",
    position: 7,
    status: "active",
    version: 3,
    created_at: "2026-07-31T08:00:00.000Z",
    updated_at: "2026-07-31T09:00:00.000Z",
  });
  assert.equal(board?.position, 7);
  assert.equal(board?.version, 3);
});

test("task normalization keeps assignees unique and rejects incomplete rows", () => {
  const task = normalizeMerchantTask(
    {
      id: "task-1",
      merchant_id: "10000000",
      board_id: "board-1",
      column_id: "column-1",
      title: "Prepare order",
      priority: "high",
      created_at: "2026-07-31T08:00:00.000Z",
      updated_at: "2026-07-31T08:00:00.000Z",
    },
    ["employee-1", "employee-1"],
  );
  assert.deepEqual(task?.assigneeIds, ["employee-1"]);
  assert.equal(normalizeMerchantTask({ title: "missing scope" }), null);
});

test("task event normalization exposes only bounded activity payload fields", () => {
  const event = normalizeMerchantTaskEvent({
    id: "event-1",
    merchant_id: "10000000",
    task_id: "task-1",
    event_type: "commented",
    actor_type: "employee",
    actor_id: "employee-1",
    payload: {
      text: `  ${"x".repeat(2100)}  `,
      fields: ["title", "title", 17, "description"],
      fromColumnId: "column-1",
      toColumnId: "column-2",
      assigneeIds: ["employee-1", "employee-1"],
      targetIndex: 3,
      checklistItemId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      employeeId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      offboardedEmployeeId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      replacementEmployeeId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      oldRoleId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      newRoleId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      completed: true,
      previousCompleted: false,
      archived: "false",
      previousArchived: false,
      unsafe: { nested: "secret" },
    },
    created_at: "2026-07-31T08:00:00.000Z",
  });

  assert.equal(event?.payload.text?.length, 2000);
  assert.deepEqual(event?.payload.fields, ["title", "description"]);
  assert.deepEqual(event?.payload.assigneeIds, ["employee-1"]);
  assert.equal(event?.payload.targetIndex, 3);
  assert.equal(
    event?.payload.checklistItemId,
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  );
  assert.equal(event?.payload.employeeId, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  assert.equal(
    event?.payload.offboardedEmployeeId,
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  );
  assert.equal(
    event?.payload.replacementEmployeeId,
    "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  );
  assert.equal(event?.payload.oldRoleId, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
  assert.equal(event?.payload.newRoleId, "ffffffff-ffff-4fff-8fff-ffffffffffff");
  assert.equal(event?.payload.completed, true);
  assert.equal(event?.payload.previousCompleted, false);
  assert.equal(event?.payload.previousArchived, false);
  assert.equal("archived" in (event?.payload ?? {}), false);
  assert.equal("unsafe" in (event?.payload ?? {}), false);
  assert.equal(normalizeMerchantTaskEvent({ event_type: "commented" }), null);
});

test("enterprise schema missing errors are recognized without masking unrelated failures", () => {
  assert.equal(isMerchantEnterpriseSchemaMissingError({ code: "42P01" }), true);
  assert.equal(isMerchantEnterpriseSchemaMissingError({ code: "PGRST205" }), true);
  assert.equal(isMerchantEnterpriseSchemaMissingError({ message: "permission denied" }), false);
});

test("strict enterprise permission parsing rejects unknown and malformed values", () => {
  assert.deepEqual(
    parseMerchantEnterprisePermissionsStrict([
      "enterprise.view",
      "tasks.view",
      "orders.linked.view",
    ]),
    ["enterprise.view", "tasks.view", "orders.linked.view"],
  );
  assert.equal(parseMerchantEnterprisePermissionsStrict(["enterprise.view", "unknown"]), null);
  assert.equal(parseMerchantEnterprisePermissionsStrict("enterprise.view"), null);
  assert.equal(parseMerchantEnterprisePermissionsStrict(["enterprise.view", 1]), null);
});

test("employee permission grants cannot exceed the acting employee", () => {
  const actor: MerchantEnterpriseActor = {
    type: "employee",
    id: "employee-1",
    siteId: "10000000",
    displayName: "主管",
    email: "lead@example.com",
    roleId: "role-1",
    permissions: ["enterprise.view", "tasks.view", "tasks.assign"],
    accessScope: "all",
    allowedBoardIds: [],
  };
  assert.equal(
    merchantEnterprisePermissionsFitActor(actor, ["enterprise.view", "tasks.view"]),
    true,
  );
  assert.equal(
    merchantEnterprisePermissionsFitActor(actor, ["enterprise.view", "roles.manage"]),
    false,
  );
});

test("enterprise mutations require a positive safe integer version", () => {
  assert.equal(isMerchantEnterpriseVersion(1), true);
  assert.equal(isMerchantEnterpriseVersion(Number.MAX_SAFE_INTEGER), true);
  assert.equal(isMerchantEnterpriseVersion(0), false);
  assert.equal(isMerchantEnterpriseVersion(1.5), false);
  assert.equal(isMerchantEnterpriseVersion("1"), false);
  assert.equal(isMerchantEnterpriseVersion(undefined), false);
});

test("role permission selection adds dependencies and removes unreachable dependents", () => {
  assert.deepEqual(
    toggleMerchantEnterprisePermissionSelection([], "orders.linked.view", true),
    ["enterprise.view", "tasks.view", "orders.linked.view"],
  );
  assert.deepEqual(
    toggleMerchantEnterprisePermissionSelection([], "tasks.assign", true),
    ["enterprise.view", "tasks.view", "tasks.assign"],
  );
  assert.deepEqual(
    toggleMerchantEnterprisePermissionSelection(
      ["enterprise.view", "tasks.view", "tasks.create", "tasks.assign"],
      "tasks.view",
      false,
    ),
    ["enterprise.view"],
  );
  assert.deepEqual(
    getMissingMerchantEnterprisePermissionDependencies(["employees.manage"]),
    ["enterprise.view", "employees.view", "roles.view"],
  );
  assert.deepEqual(
    getMissingMerchantEnterprisePermissionDependencies([
      "enterprise.view",
      "employees.view",
      "employees.manage",
      "roles.view",
    ]),
    [],
  );
});

test("task filters combine archive, priority, assignee and text criteria", () => {
  const task = {
    id: "task-1",
    siteId: "10000000",
    boardId: "board-1",
    columnId: "column-1",
    title: "联系 VIP 客户",
    description: "确认周五交付",
    priority: "urgent",
    dueAt: null,
    completedAt: null,
    archivedAt: null,
    position: 1,
    sourceType: "",
    sourceId: "",
    createdByEmployeeId: "",
    assigneeIds: ["employee-1", "employee-2"],
    version: 1,
    createdAt: "2026-07-31T08:00:00.000Z",
    updatedAt: "2026-07-31T08:00:00.000Z",
  } satisfies MerchantTask;
  const archived = {
    ...task,
    id: "task-2",
    title: "归档任务",
    archivedAt: "2026-07-31T09:00:00.000Z",
    assigneeIds: [],
  } satisfies MerchantTask;

  assert.deepEqual(
    filterMerchantTasks([task, archived], {
      query: "vip",
      priority: "urgent",
      assigneeId: "employee-2",
      archive: "active",
    }).map((item) => item.id),
    ["task-1"],
  );
  assert.deepEqual(
    filterMerchantTasks([task, archived], {
      assigneeId: "unassigned",
      archive: "archived",
    }).map((item) => item.id),
    ["task-2"],
  );
});

test("task completion transitions use the first active opposite-state column in the same board", () => {
  const task = {
    id: "task-1",
    siteId: "10000000",
    boardId: "board-1",
    columnId: "doing",
    title: "准备库存",
    description: "",
    priority: "normal",
    dueAt: null,
    completedAt: null,
    archivedAt: null,
    position: 1,
    sourceType: "",
    sourceId: "",
    createdByEmployeeId: "",
    assigneeIds: [],
    version: 1,
    createdAt: "2026-07-31T08:00:00.000Z",
    updatedAt: "2026-07-31T08:00:00.000Z",
  } satisfies MerchantTask;
  const column = (
    id: string,
    boardId: string,
    position: number,
    isDone: boolean,
    status: "active" | "archived" = "active",
  ) =>
    ({
      id,
      siteId: "10000000",
      boardId,
      name: id,
      color: "#64748b",
      position,
      isDone,
      status,
      version: 1,
      createdAt: "2026-07-31T08:00:00.000Z",
      updatedAt: "2026-07-31T08:00:00.000Z",
    }) satisfies MerchantTaskColumn;
  const columns = [
    column("todo", "board-1", 0, false),
    column("doing", "board-1", 1, false),
    column("done-archived", "board-1", 2, true, "archived"),
    column("done-first", "board-1", 3, true),
    column("done-second", "board-1", 4, true),
    column("other-board-done", "board-2", 0, true),
  ];

  assert.deepEqual(getMerchantTaskCompletionTransition(task, columns), {
    action: "complete",
    targetColumnId: "done-first",
    targetColumnName: "done-first",
  });
  assert.deepEqual(
    getMerchantTaskCompletionTransition(
      { ...task, columnId: "done-first" },
      columns,
    ),
    {
      action: "reopen",
      targetColumnId: "todo",
      targetColumnName: "todo",
    },
  );
});

test("task completion transitions reject archived tasks and incomplete column structures", () => {
  const task = {
    boardId: "board-1",
    columnId: "doing",
    archivedAt: null,
  };
  const columns = [
    {
      id: "doing",
      boardId: "board-1",
      name: "进行中",
      position: 0,
      status: "active" as const,
      isDone: false,
    },
  ];

  assert.equal(getMerchantTaskCompletionTransition(task, columns), null);
  assert.equal(
    getMerchantTaskCompletionTransition(
      { ...task, archivedAt: "2026-08-01T08:00:00.000Z" },
      columns,
    ),
    null,
  );
  assert.equal(
    getMerchantTaskCompletionTransition(
      { ...task, columnId: "missing" },
      columns,
    ),
    null,
  );
});

test("enterprise overview aggregates active tasks across every active board", () => {
  const task = {
    id: "task-open-a",
    siteId: "10000000",
    boardId: "board-a",
    columnId: "column-a",
    title: "看板 A 待处理",
    description: "",
    priority: "normal",
    dueAt: "2026-07-30T08:00:00.000Z",
    completedAt: null,
    archivedAt: null,
    position: 0,
    sourceType: "",
    sourceId: "",
    createdByEmployeeId: "",
    assigneeIds: [],
    version: 1,
    createdAt: "2026-07-29T08:00:00.000Z",
    updatedAt: "2026-07-29T08:00:00.000Z",
  } satisfies MerchantTask;
  const summary = buildMerchantEnterpriseTaskOverview(
    {
      boards: [
        { id: "board-a", status: "active" },
        { id: "board-b", status: "active" },
        { id: "board-archived", status: "archived" },
      ],
      tasks: [
        task,
        {
          ...task,
          id: "task-done-b",
          boardId: "board-b",
          columnId: "column-b",
          title: "看板 B 已完成",
          completedAt: "2026-07-30T09:00:00.000Z",
        },
        {
          ...task,
          id: "task-archived",
          archivedAt: "2026-07-30T10:00:00.000Z",
        },
        {
          ...task,
          id: "task-in-archived-board",
          boardId: "board-archived",
        },
      ],
    },
    Date.parse("2026-07-31T08:00:00.000Z"),
  );

  assert.deepEqual(summary.tasks.map((item) => item.id), ["task-open-a", "task-done-b"]);
  assert.equal(summary.incompleteTaskCount, 1);
  assert.equal(summary.completedTaskCount, 1);
  assert.equal(summary.overdueTaskCount, 1);
  assert.deepEqual(
    summary.recentTasks.map((item) => item.id),
    ["task-done-b", "task-open-a"],
    "equal due and update times must use a deterministic id tie-breaker",
  );
});

test("enterprise task overview defaults owners to the team and employees to their own work", () => {
  const owner: MerchantEnterpriseActor = {
    type: "owner",
    id: "owner-1",
    siteId: "10000000",
    displayName: "负责人",
    email: "owner@example.com",
    permissions: MERCHANT_ENTERPRISE_PERMISSIONS.slice(),
    accessScope: "all",
    allowedBoardIds: [],
  };
  const employee: MerchantEnterpriseActor = {
    type: "employee",
    id: "employee-1",
    siteId: "10000000",
    displayName: "员工一",
    email: "employee-1@example.com",
    roleId: "role-employee",
    permissions: ["enterprise.view", "tasks.view"],
    accessScope: "all",
    allowedBoardIds: [],
  };

  assert.equal(getMerchantEnterpriseDefaultTaskAssigneeFilter(owner), "all");
  assert.equal(getMerchantEnterpriseDefaultTaskAssigneeFilter(employee), "employee-1");
});

test("enterprise task overview keeps the owner team view and scopes employee work across boards", () => {
  const baseTask = {
    id: "task-mine-a",
    siteId: "10000000",
    boardId: "board-a",
    columnId: "column-a",
    title: "我的看板 A 任务",
    description: "",
    priority: "normal",
    dueAt: "2026-07-30T08:00:00.000Z",
    completedAt: null,
    archivedAt: null,
    position: 0,
    sourceType: "",
    sourceId: "",
    createdByEmployeeId: "",
    assigneeIds: ["employee-1"],
    version: 1,
    createdAt: "2026-07-29T08:00:00.000Z",
    updatedAt: "2026-07-29T08:00:00.000Z",
  } satisfies MerchantTask;
  const input = {
    boards: [
      { id: "board-a", status: "active" as const },
      { id: "board-b", status: "active" as const },
    ],
    tasks: [
      baseTask,
      {
        ...baseTask,
        id: "task-mine-b",
        boardId: "board-b",
        columnId: "column-b",
        title: "我的看板 B 已完成任务",
        completedAt: "2026-07-30T09:00:00.000Z",
      },
      {
        ...baseTask,
        id: "task-other",
        title: "其他员工任务",
        assigneeIds: ["employee-2"],
      },
      {
        ...baseTask,
        id: "task-unassigned",
        title: "未分派任务",
        assigneeIds: [],
      },
    ],
  };
  const nowMs = Date.parse("2026-07-31T08:00:00.000Z");
  const ownerSummary = buildMerchantEnterpriseTaskOverview(
    {
      ...input,
      assigneeId: getMerchantEnterpriseDefaultTaskAssigneeFilter({
        type: "owner",
        id: "owner-1",
      }),
    },
    nowMs,
  );
  const summary = buildMerchantEnterpriseTaskOverview(
    {
      ...input,
      assigneeId: getMerchantEnterpriseDefaultTaskAssigneeFilter({
        type: "employee",
        id: "employee-1",
      }),
    },
    nowMs,
  );

  assert.deepEqual(
    ownerSummary.tasks.map((task) => task.id),
    ["task-mine-a", "task-mine-b", "task-other", "task-unassigned"],
  );
  assert.equal(ownerSummary.incompleteTaskCount, 3);
  assert.equal(ownerSummary.completedTaskCount, 1);
  assert.deepEqual(summary.tasks.map((task) => task.id), ["task-mine-a", "task-mine-b"]);
  assert.equal(summary.incompleteTaskCount, 1);
  assert.equal(summary.completedTaskCount, 1);
  assert.equal(summary.overdueTaskCount, 1);
  assert.deepEqual(summary.recentTasks.map((task) => task.id), ["task-mine-a", "task-mine-b"]);
});

test("task edit changes honor update and assignment permissions independently", () => {
  const task = {
    id: "task-1",
    siteId: "10000000",
    boardId: "board-1",
    columnId: "column-1",
    title: "原任务",
    description: "",
    priority: "normal",
    dueAt: null,
    completedAt: null,
    archivedAt: null,
    position: 1,
    sourceType: "",
    sourceId: "",
    createdByEmployeeId: "",
    assigneeIds: ["employee-1"],
    version: 1,
    createdAt: "2026-07-31T08:00:00.000Z",
    updatedAt: "2026-07-31T08:00:00.000Z",
  } satisfies MerchantTask;
  const values = {
    title: "新任务",
    description: "",
    priority: "normal" as const,
    dueAt: null,
    columnId: "column-1",
    assigneeIds: ["employee-2"],
  };
  const employees = [
    { id: "employee-1", status: "active" as const },
    { id: "employee-2", status: "active" as const },
    { id: "employee-3", status: "disabled" as const },
  ];
  const updateActor: MerchantEnterpriseActor = {
    type: "employee",
    id: "employee-1",
    siteId: "10000000",
    displayName: "更新者",
    email: "update@example.com",
    roleId: "role-update",
    permissions: ["enterprise.view", "tasks.view", "tasks.update"],
    accessScope: "all",
    allowedBoardIds: [],
  };
  const assignActor: MerchantEnterpriseActor = {
    ...updateActor,
    roleId: "role-assign",
    permissions: ["enterprise.view", "tasks.view", "tasks.assign"],
  };

  assert.deepEqual(
    buildMerchantTaskEditChanges(updateActor, task, values, employees),
    { ok: true, changes: { title: "新任务" } },
  );
  assert.deepEqual(
    buildMerchantTaskEditChanges(assignActor, task, values, employees),
    { ok: true, changes: { assigneeIds: ["employee-2"] } },
  );
  assert.deepEqual(
    buildMerchantTaskEditChanges(
      assignActor,
      task,
      { ...values, assigneeIds: ["employee-3"] },
      employees,
    ),
    {
      ok: false,
      error: "inactive_assignee",
      employeeId: "employee-3",
    },
  );
});
