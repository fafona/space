import assert from "node:assert/strict";
import test from "node:test";
import {
  addMerchantTaskComment,
  authorizeMerchantLinkedOrderSummarySource,
  bootstrapMerchantEnterpriseWorkspace,
  createMerchantEnterpriseEmployee,
  createMerchantEnterpriseRole,
  createMerchantEnterpriseWorkflow,
  createMerchantTaskChecklistItem,
  createMerchantTaskBoard,
  createMerchantTaskColumn,
  createMerchantTask,
  createOrGetMerchantOrderTask,
  loadMerchantEnterpriseAuditEvents,
  loadMerchantEnterpriseArchivedWorkflowPage,
  loadMerchantEnterpriseWorkflowById,
  loadMerchantEnterpriseSnapshot,
  loadMerchantEnterpriseNotifications,
  loadMerchantEnterpriseWorkflows,
  loadMerchantTaskChecklistItems,
  loadMerchantTaskEvents,
  loadMerchantTaskBoardIdForAccess,
  loadMerchantTaskBySource,
  moveMerchantTask,
  markMerchantEnterpriseNotificationsRead,
  updateMerchantEnterpriseEmployee,
  updateMerchantEnterpriseRole,
  updateMerchantEnterpriseWorkflow,
  updateMerchantTaskBoard,
  updateMerchantTaskColumn,
  updateMerchantTaskChecklistItem,
  updateMerchantTask,
  type MerchantEnterpriseStoreClient,
} from "@/lib/merchantEnterpriseStore.server";

const WORKSPACE_OWNER_ACTOR = {
  actorType: "owner" as const,
  actorId: "88888888-8888-4888-8888-888888888888",
};
const WORKSPACE_EMPLOYEE_ACTOR = {
  actorType: "employee" as const,
  actorId: "77777777-7777-4777-8777-777777777777",
};

function workflowRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    merchant_id: "10000000",
    title: "客户投诉处理",
    scenario: "客户反馈商品存在问题时",
    description: "先确认事实，再给出解决方案。",
    category: "客户服务",
    tags: ["投诉", "售后"],
    status: "draft",
    steps: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        title: "记录情况",
        instruction: "记录订单号和具体问题。",
        position: 0,
      },
    ],
    version: 1,
    published_version: 0,
    published_at: null,
    has_unpublished_changes: true,
    created_at: "2026-08-03T08:00:00.000Z",
    updated_at: "2026-08-03T08:00:00.000Z",
    ...overrides,
  };
}

function taskRow(version: number) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    merchant_id: "10000000",
    board_id: "22222222-2222-4222-8222-222222222222",
    column_id: "33333333-3333-4333-8333-333333333333",
    title: "Prepare launch",
    description: "",
    priority: "normal",
    due_at: null,
    completed_at: null,
    archived_at: null,
    position: 1,
    source_type: "",
    source_id: "",
    created_by_employee_id: null,
    version,
    created_at: "2026-07-31T08:00:00.000Z",
    updated_at: "2026-07-31T08:00:00.000Z",
  };
}

function employeeRow(
  version: number,
  invitedAt: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    merchant_id: "10000000",
    auth_user_id: "88888888-8888-4888-8888-888888888888",
    email: "staff@example.com",
    display_name: "Staff",
    role_id: "99999999-9999-4999-8999-999999999999",
    status: "invited",
    invited_at: invitedAt,
    accepted_at: null,
    last_active_at: null,
    invitation_version: 1,
    invitation_expires_at: null,
    invitation_revoked_at: null,
    invitation_sent_at: invitedAt,
    invitation_delivery_status: "sent",
    version,
    created_at: "2026-07-31T08:00:00.000Z",
    updated_at: invitedAt,
    ...overrides,
  };
}

function orderTaskRow(version = 1, archivedAt: string | null = null) {
  return {
    ...taskRow(version),
    title: "Process order O-1001",
    source_type: "order",
    source_id: "O-1001",
    archived_at: archivedAt,
  };
}

function roleRow(version: number, accessScope: "all" | "restricted" = "all") {
  return {
    id: "99999999-9999-4999-8999-999999999999",
    merchant_id: "10000000",
    name: "Staff",
    description: "",
    permissions: ["enterprise.view", "tasks.view"],
    access_scope: accessScope,
    status: "active",
    is_system: false,
    version,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
  };
}

function taskEventRow(eventType = "commented") {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    merchant_id: "10000000",
    task_id: "11111111-1111-4111-8111-111111111111",
    operation_id: "task-comment-1",
    event_type: eventType,
    actor_type: "employee",
    actor_id: "55555555-5555-4555-8555-555555555555",
    payload: { text: "Ready for review" },
    created_at: "2026-07-31T10:00:00.000Z",
  };
}

function checklistItemRow(
  version = 1,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    merchant_id: "10000000",
    task_id: "11111111-1111-4111-8111-111111111111",
    text: "Confirm inventory",
    position: 1024,
    completed_at: null,
    archived_at: null,
    version,
    created_at: "2026-07-31T08:30:00.000Z",
    updated_at: "2026-07-31T08:30:00.000Z",
    ...overrides,
  };
}

function boardRow(
  id = "22222222-2222-4222-8222-222222222222",
  version = 1,
  position = 0,
) {
  return {
    id,
    merchant_id: "10000000",
    name: "Operations",
    description: "",
    position,
    status: "active",
    version,
    created_at: "2026-07-31T08:00:00.000Z",
    updated_at: "2026-07-31T08:00:00.000Z",
  };
}

function columnRow(
  id = "33333333-3333-4333-8333-333333333333",
  version = 1,
  position = 0,
) {
  return {
    id,
    merchant_id: "10000000",
    board_id: "22222222-2222-4222-8222-222222222222",
    name: "To do",
    color: "#64748b",
    position,
    is_done: false,
    status: "active",
    version,
    created_at: "2026-07-31T08:00:00.000Z",
    updated_at: "2026-07-31T08:00:00.000Z",
  };
}

test("employee creation strictly validates normalized auth email input", async () => {
  let called = false;
  const client = {
    from() {
      throw new Error("employee creation must not use direct table writes");
    },
    async rpc() {
      called = true;
      throw new Error("invalid email must stop before persistence");
    },
  } as unknown as MerchantEnterpriseStoreClient;

  for (const email of ["missing-domain@", "two words@example.com", "x".repeat(255)]) {
    await assert.rejects(
      createMerchantEnterpriseEmployee(client, {
        siteId: "10000000",
        email,
        displayName: "Staff",
        roleId: "99999999-9999-4999-8999-999999999999",
        actorType: "owner",
        actorId: "88888888-8888-4888-8888-888888888888",
      }),
      /invalid_employee_email/,
    );
  }
  assert.equal(called, false);
});

test("employee create and offboarding update use atomic RPCs with actor context", async () => {
  const calls: Array<{ functionName: string; input: Record<string, unknown> }> = [];
  const invitedAt = "2026-07-31T09:30:00.000Z";
  const replacementEmployeeId = "66666666-6666-4666-8666-666666666666";
  const client = {
    from() {
      throw new Error("employee lifecycle mutations must stay transactional");
    },
    async rpc(functionName: string, args: Record<string, unknown>) {
      const input = args.p_input as Record<string, unknown>;
      calls.push({ functionName, input });
      return {
        data: {
          employee: employeeRow(
            functionName === "faolla_create_merchant_enterprise_employee_v1" ? 1 : 2,
            invitedAt,
            functionName === "faolla_update_merchant_enterprise_employee_v1"
              ? { status: "disabled" }
              : {},
          ),
        },
        error: null,
      };
    },
  } as unknown as MerchantEnterpriseStoreClient;

  const created = await createMerchantEnterpriseEmployee(client, {
    siteId: "10000000",
    email: " Staff@Example.com ",
    displayName: "Staff",
    roleId: "99999999-9999-4999-8999-999999999999",
    actorType: "owner",
    actorId: "88888888-8888-4888-8888-888888888888",
  });
  const updated = await updateMerchantEnterpriseEmployee(client, {
    siteId: "10000000",
    employeeId: created.id,
    version: created.version,
    displayName: "Former Staff",
    status: "disabled",
    offboardingMode: "reassign",
    replacementEmployeeId,
    actorType: "employee",
    actorId: "55555555-5555-4555-8555-555555555555",
  });

  assert.equal(created.email, "staff@example.com");
  assert.equal(updated.status, "disabled");
  assert.deepEqual(calls, [
    {
      functionName: "faolla_create_merchant_enterprise_employee_v1",
      input: {
        merchant_id: "10000000",
        email: "staff@example.com",
        display_name: "Staff",
        role_id: "99999999-9999-4999-8999-999999999999",
        actor_type: "owner",
        actor_id: "88888888-8888-4888-8888-888888888888",
      },
    },
    {
      functionName: "faolla_update_merchant_enterprise_employee_v1",
      input: {
        merchant_id: "10000000",
        employee_id: created.id,
        expected_version: 1,
        actor_type: "employee",
        actor_id: "55555555-5555-4555-8555-555555555555",
        display_name: "Former Staff",
        status: "disabled",
        offboarding_mode: "reassign",
        replacement_employee_id: replacementEmployeeId,
      },
    },
  ]);
});

test("employee display-name updates send only identity, version, actor, and the new name", async () => {
  const employeeId = "77777777-7777-4777-8777-777777777777";
  const actorId = "88888888-8888-4888-8888-888888888888";
  let rpcCall: { functionName: string; args: Record<string, unknown> } | null = null;
  const client = {
    from() {
      throw new Error("employee profile mutations must stay transactional");
    },
    async rpc(functionName: string, args: Record<string, unknown>) {
      rpcCall = { functionName, args };
      return {
        data: {
          employee: employeeRow(8, "2026-07-31T09:30:00.000Z", {
            display_name: "Updated Staff",
          }),
        },
        error: null,
      };
    },
  } as unknown as MerchantEnterpriseStoreClient;

  const employee = await updateMerchantEnterpriseEmployee(client, {
    siteId: "10000000",
    employeeId,
    version: 7,
    displayName: "Updated Staff",
    actorType: "owner",
    actorId,
  });

  assert.equal(employee.displayName, "Updated Staff");
  assert.deepEqual(rpcCall, {
    functionName: "faolla_update_merchant_enterprise_employee_v1",
    args: {
      p_input: {
        merchant_id: "10000000",
        employee_id: employeeId,
        expected_version: 7,
        actor_type: "owner",
        actor_id: actorId,
        display_name: "Updated Staff",
      },
    },
  });
});

test("employee RPC failures preserve lifecycle conflict and authorization codes", async () => {
  for (const code of [
    "enterprise_version_conflict",
    "employee_not_found",
    "employee_open_tasks_require_resolution",
    "employee_offboarding_replacement_invalid",
    "employee_offboarding_scope_denied",
    "employee_role_transition_required",
    "employee_role_transition_replacement_invalid",
    "employee_role_transition_scope_denied",
    "permission_escalation_denied",
    "permission_denied",
    "employee_board_access_in_use",
    "employee_email_in_use",
  ]) {
    const client = {
      from() {
        throw new Error("employee lifecycle mutations must stay transactional");
      },
      async rpc() {
        return { data: null, error: { code: "P0001", message: code } };
      },
    } as unknown as MerchantEnterpriseStoreClient;
    await assert.rejects(
      updateMerchantEnterpriseEmployee(client, {
        siteId: "10000000",
        employeeId: "77777777-7777-4777-8777-777777777777",
        version: 7,
        displayName: "Updated Staff",
        actorType: "owner",
        actorId: "88888888-8888-4888-8888-888888888888",
      }),
      new RegExp(`^Error: ${code}$`),
    );
  }

  const duplicateClient = {
    from() {
      throw new Error("employee lifecycle mutations must stay transactional");
    },
    async rpc() {
      return {
        data: null,
        error: {
          code: "23505",
          message:
            'duplicate key value violates unique constraint "merchant_enterprise_employees_email_unique_idx"',
        },
      };
    },
  } as unknown as MerchantEnterpriseStoreClient;
  await assert.rejects(
    createMerchantEnterpriseEmployee(duplicateClient, {
      siteId: "10000000",
      email: "staff@example.com",
      displayName: "Staff",
      roleId: "99999999-9999-4999-8999-999999999999",
      actorType: "owner",
      actorId: "88888888-8888-4888-8888-888888888888",
    }),
    /^Error: employee_email_in_use$/,
  );
});

test("employee offboarding payload combinations are validated before the RPC", async () => {
  let calls = 0;
  const client = {
    from() {
      throw new Error("employee lifecycle mutations must stay transactional");
    },
    async rpc() {
      calls += 1;
      throw new Error("invalid payload must stop before persistence");
    },
  } as unknown as MerchantEnterpriseStoreClient;
  const base = {
    siteId: "10000000",
    employeeId: "77777777-7777-4777-8777-777777777777",
    version: 7,
    actorType: "owner" as const,
    actorId: "88888888-8888-4888-8888-888888888888",
  };
  for (const payload of [
    { status: "active" as const, offboardingMode: "unassign" as const },
    { status: "disabled" as const, offboardingMode: "reassign" as const },
    {
      status: "disabled" as const,
      offboardingMode: "unassign" as const,
      replacementEmployeeId: "66666666-6666-4666-8666-666666666666",
    },
    {
      status: "disabled" as const,
      replacementEmployeeId: "66666666-6666-4666-8666-666666666666",
    },
  ]) {
    await assert.rejects(
      updateMerchantEnterpriseEmployee(client, { ...base, ...payload }),
      /^Error: invalid_employee_offboarding$/,
    );
  }
  await assert.rejects(
    updateMerchantEnterpriseEmployee(client, {
      ...base,
      status: "disabled",
      offboardingMode: "reassign",
      replacementEmployeeId: base.employeeId,
    }),
    /^Error: employee_offboarding_replacement_invalid$/,
  );
  assert.equal(calls, 0);
});

test("employee role transitions carry target-role CAS and task resolution to the atomic RPC", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const employeeId = "77777777-7777-4777-8777-777777777777";
  const roleId = "44444444-4444-4444-8444-444444444444";
  const replacementEmployeeId = "66666666-6666-4666-8666-666666666666";
  const client = {
    from() {
      throw new Error("employee role transitions must stay transactional");
    },
    async rpc(functionName: string, args: Record<string, unknown>) {
      assert.equal(functionName, "faolla_update_merchant_enterprise_employee_v1");
      calls.push(args.p_input as Record<string, unknown>);
      return {
        data: { employee: employeeRow(8, "2026-07-31T09:30:00.000Z", { role_id: roleId }) },
        error: null,
      };
    },
  } as unknown as MerchantEnterpriseStoreClient;

  const employee = await updateMerchantEnterpriseEmployee(client, {
    siteId: "10000000",
    employeeId,
    version: 7,
    roleId,
    roleVersion: 3,
    roleTransitionMode: "reassign",
    replacementEmployeeId,
    actorType: "owner",
    actorId: "88888888-8888-4888-8888-888888888888",
  });

  assert.equal(employee.roleId, roleId);
  assert.deepEqual(calls, [
    {
      merchant_id: "10000000",
      employee_id: employeeId,
      expected_version: 7,
      actor_type: "owner",
      actor_id: "88888888-8888-4888-8888-888888888888",
      role_id: roleId,
      expected_role_version: 3,
      role_transition_mode: "reassign",
      replacement_employee_id: replacementEmployeeId,
    },
  ]);
});

test("employee role transition payloads fail closed before persistence", async () => {
  let calls = 0;
  const employeeId = "77777777-7777-4777-8777-777777777777";
  const roleId = "44444444-4444-4444-8444-444444444444";
  const replacementEmployeeId = "66666666-6666-4666-8666-666666666666";
  const client = {
    from() {
      throw new Error("employee role transitions must stay transactional");
    },
    async rpc() {
      calls += 1;
      throw new Error("invalid payload must stop before persistence");
    },
  } as unknown as MerchantEnterpriseStoreClient;
  const base = {
    siteId: "10000000",
    employeeId,
    version: 7,
    actorType: "owner" as const,
    actorId: "88888888-8888-4888-8888-888888888888",
  };
  for (const payload of [
    { roleId },
    { roleVersion: 3 },
    { roleId, roleVersion: 0 },
    { roleId, roleVersion: 3, roleTransitionMode: "reassign" as const },
    { roleId, roleVersion: 3, roleTransitionMode: "unassign" as const, replacementEmployeeId },
    {
      roleId,
      roleVersion: 3,
      roleTransitionMode: "unassign" as const,
      offboardingMode: "unassign" as const,
      status: "disabled" as const,
    },
  ]) {
    await assert.rejects(
      updateMerchantEnterpriseEmployee(client, { ...base, ...payload }),
      /^Error: invalid_employee_role_transition$/,
    );
  }
  await assert.rejects(
    updateMerchantEnterpriseEmployee(client, {
      ...base,
      roleId,
      roleVersion: 3,
      roleTransitionMode: "reassign",
      replacementEmployeeId: employeeId,
    }),
    /^Error: employee_role_transition_replacement_invalid$/,
  );
  assert.equal(calls, 0);
});

test("role creation and updates persist board access through atomic RPCs", async () => {
  const boardId = "22222222-2222-4222-8222-222222222222";
  const calls: Array<{ functionName: string; input: Record<string, unknown> }> = [];
  const client = {
    from() {
      throw new Error("role mutations must stay transactional");
    },
    async rpc(functionName: string, args: Record<string, unknown>) {
      const input = args.p_input as Record<string, unknown>;
      calls.push({ functionName, input });
      const isCreate = functionName === "faolla_create_merchant_enterprise_role_v3";
      return {
        data: {
          role: roleRow(isCreate ? 1 : 2, "restricted"),
          allowed_board_ids: [boardId],
        },
        error: null,
      };
    },
  } as unknown as MerchantEnterpriseStoreClient;

  const created = await createMerchantEnterpriseRole(client, {
    siteId: "10000000",
    name: "Staff",
    permissions: ["enterprise.view", "tasks.view"],
    accessScope: "restricted",
    allowedBoardIds: [boardId],
    actorType: "employee",
    actorId: "77777777-7777-4777-8777-777777777777",
  });
  const updated = await updateMerchantEnterpriseRole(client, {
    siteId: "10000000",
    roleId: created.id,
    version: created.version,
    accessScope: "restricted",
    allowedBoardIds: [boardId],
    actorType: "owner",
    actorId: "88888888-8888-4888-8888-888888888888",
  });

  assert.equal(created.accessScope, "restricted");
  assert.deepEqual(created.allowedBoardIds, [boardId]);
  assert.equal(updated.version, 2);
  assert.deepEqual(calls, [
    {
      functionName: "faolla_create_merchant_enterprise_role_v3",
      input: {
        merchant_id: "10000000",
        name: "Staff",
        description: "",
        permissions: ["enterprise.view", "tasks.view"],
        access_scope: "restricted",
        allowed_board_ids: [boardId],
        actor_type: "employee",
        actor_id: "77777777-7777-4777-8777-777777777777",
      },
    },
    {
      functionName: "faolla_update_merchant_enterprise_role_v3",
      input: {
        merchant_id: "10000000",
        role_id: created.id,
        expected_version: 1,
        actor_type: "owner",
        actor_id: "88888888-8888-4888-8888-888888888888",
        access_scope: "restricted",
        allowed_board_ids: [boardId],
      },
    },
  ]);
});

test("role RPC lifecycle conflicts keep their public error codes", async () => {
  for (const code of [
    "role_not_found",
    "system_role_protected",
    "role_in_use",
    "role_board_access_in_use",
    "permission_escalation_denied",
    "permission_denied",
  ]) {
    const client = {
      from() {
        throw new Error("role mutations must stay transactional");
      },
      async rpc() {
        return { data: null, error: { code: "P0001", message: code } };
      },
    } as unknown as MerchantEnterpriseStoreClient;

    await assert.rejects(
      updateMerchantEnterpriseRole(client, {
        siteId: "10000000",
        roleId: "11111111-1111-4111-8111-111111111111",
        version: 1,
        description: "Updated",
        actorType: "owner",
        actorId: "88888888-8888-4888-8888-888888888888",
      }),
      new RegExp(code),
    );
  }
});

test("role updates reject invalid optimistic-lock versions before RPC", async () => {
  let calls = 0;
  const client = {
    from() {
      throw new Error("role mutations must stay transactional");
    },
    async rpc() {
      calls += 1;
      return { data: null, error: null };
    },
  } as unknown as MerchantEnterpriseStoreClient;

  for (const version of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(
      updateMerchantEnterpriseRole(client, {
        siteId: "10000000",
        roleId: "11111111-1111-4111-8111-111111111111",
        version,
        description: "Updated",
        actorType: "owner",
        actorId: "88888888-8888-4888-8888-888888888888",
      }),
      /^Error: invalid_role_version$/,
    );
  }
  assert.equal(calls, 0);
});

test("task access lookup resolves the board without exposing task contents", async () => {
  const calls: string[] = [];
  const builder = {
    select(columns: string) {
      calls.push(columns);
      return builder;
    },
    eq() {
      return builder;
    },
    limit() {
      return builder;
    },
    async maybeSingle() {
      return {
        data: { board_id: "22222222-2222-4222-8222-222222222222" },
        error: null,
      };
    },
  };
  const client = {
    from(table: string) {
      assert.equal(table, "merchant_tasks");
      return builder;
    },
    async rpc() {
      throw new Error("unexpected RPC");
    },
  } as unknown as MerchantEnterpriseStoreClient;

  assert.equal(
    await loadMerchantTaskBoardIdForAccess(
      client,
      "10000000",
      "11111111-1111-4111-8111-111111111111",
    ),
    "22222222-2222-4222-8222-222222222222",
  );
  assert.deepEqual(calls, ["board_id"]);
});

test("board and column creation use operation-scoped transactional RPCs", async () => {
  const calls: Array<{ functionName: string; input: Record<string, unknown> }> = [];
  const client = {
    from() {
      throw new Error("workspace mutations must not issue direct table writes");
    },
    async rpc(functionName: string, args: Record<string, unknown>) {
      const input = args.p_input as Record<string, unknown>;
      calls.push({ functionName, input });
      if (functionName === "faolla_create_merchant_task_board_v1") {
        return {
          data: {
            board: boardRow(),
            columns: [
              columnRow(),
              columnRow("44444444-4444-4444-8444-444444444444", 1, 1),
            ],
          },
          error: null,
        };
      }
      return {
        data: { column: columnRow() },
        error: null,
      };
    },
  } as unknown as MerchantEnterpriseStoreClient;

  const boardResult = await createMerchantTaskBoard(client, {
    siteId: "10000000",
    ...WORKSPACE_OWNER_ACTOR,
    name: "Operations",
    description: "Daily work",
    position: 2,
    operationId: "board-create-1",
  });
  const column = await createMerchantTaskColumn(client, {
    siteId: "10000000",
    ...WORKSPACE_EMPLOYEE_ACTOR,
    boardId: boardResult.board.id,
    name: "To do",
    color: "#64748b",
    isDone: false,
    position: 3,
    operationId: "column-create-1",
  });

  assert.equal(boardResult.columns.length, 2);
  assert.equal(column.position, 0);
  assert.deepEqual(calls, [
    {
      functionName: "faolla_create_merchant_task_board_v1",
      input: {
        merchant_id: "10000000",
        actor_type: "owner",
        actor_id: WORKSPACE_OWNER_ACTOR.actorId,
        name: "Operations",
        description: "Daily work",
        position: 2,
        operation_id: "board-create-1",
      },
    },
    {
      functionName: "faolla_create_merchant_task_column_v1",
      input: {
        merchant_id: "10000000",
        actor_type: "employee",
        actor_id: WORKSPACE_EMPLOYEE_ACTOR.actorId,
        board_id: "22222222-2222-4222-8222-222222222222",
        name: "To do",
        color: "#64748b",
        is_done: false,
        position: 3,
        operation_id: "column-create-1",
      },
    },
  ]);
});

test("board and column updates carry versions, positions and operation ids", async () => {
  const calls: Array<{ functionName: string; input: Record<string, unknown> }> = [];
  const client = {
    from() {
      throw new Error("workspace mutations must not issue direct table writes");
    },
    async rpc(functionName: string, args: Record<string, unknown>) {
      calls.push({
        functionName,
        input: args.p_input as Record<string, unknown>,
      });
      return functionName === "faolla_update_merchant_task_board_v1"
        ? { data: { board: boardRow(undefined, 8, 4) }, error: null }
        : { data: { column: columnRow(undefined, 9, 2) }, error: null };
    },
  } as unknown as MerchantEnterpriseStoreClient;

  const board = await updateMerchantTaskBoard(client, {
    siteId: "10000000",
    ...WORKSPACE_OWNER_ACTOR,
    boardId: "22222222-2222-4222-8222-222222222222",
    version: 7,
    status: "archived",
    position: 4,
    operationId: "board-update-1",
  });
  const column = await updateMerchantTaskColumn(client, {
    siteId: "10000000",
    ...WORKSPACE_OWNER_ACTOR,
    boardId: "22222222-2222-4222-8222-222222222222",
    columnId: "33333333-3333-4333-8333-333333333333",
    version: 8,
    color: "#2563eb",
    isDone: true,
    position: 2,
    operationId: "column-update-1",
  });

  assert.equal(board.version, 8);
  assert.equal(board.position, 4);
  assert.equal(column.version, 9);
  assert.deepEqual(calls[0], {
    functionName: "faolla_update_merchant_task_board_v1",
    input: {
      merchant_id: "10000000",
      actor_type: "owner",
      actor_id: WORKSPACE_OWNER_ACTOR.actorId,
      board_id: "22222222-2222-4222-8222-222222222222",
      expected_version: 7,
      operation_id: "board-update-1",
      status: "archived",
      position: 4,
    },
  });
  assert.deepEqual(calls[1], {
    functionName: "faolla_update_merchant_task_column_v1",
    input: {
      merchant_id: "10000000",
      actor_type: "owner",
      actor_id: WORKSPACE_OWNER_ACTOR.actorId,
      board_id: "22222222-2222-4222-8222-222222222222",
      column_id: "33333333-3333-4333-8333-333333333333",
      expected_version: 8,
      operation_id: "column-update-1",
      color: "#2563eb",
      is_done: true,
      position: 2,
    },
  });
});

test("workspace RPC errors preserve explicit conflict and validation codes", async () => {
  const makeClient = (message: string) =>
    ({
      from() {
        throw new Error("unexpected table access");
      },
      async rpc() {
        return { data: null, error: { code: "P0001", message } };
      },
    }) as unknown as MerchantEnterpriseStoreClient;

  await assert.rejects(
    createMerchantTaskBoard(makeClient("board_limit_reached"), {
      siteId: "10000000",
      ...WORKSPACE_OWNER_ACTOR,
      name: "Overflow",
      operationId: "board-create-limit",
    }),
    /board_limit_reached/,
  );
  await assert.rejects(
    updateMerchantTaskColumn(makeClient("enterprise_version_conflict"), {
      siteId: "10000000",
      ...WORKSPACE_OWNER_ACTOR,
      boardId: "22222222-2222-4222-8222-222222222222",
      columnId: "33333333-3333-4333-8333-333333333333",
      version: 2,
      name: "Updated",
      operationId: "column-update-conflict",
    }),
    /enterprise_version_conflict/,
  );
  await assert.rejects(
    createMerchantTaskColumn(makeClient("invalid_column_color"), {
      siteId: "10000000",
      ...WORKSPACE_OWNER_ACTOR,
      boardId: "22222222-2222-4222-8222-222222222222",
      name: "Invalid",
      operationId: "column-create-invalid",
    }),
    /invalid_column_color/,
  );
  await assert.rejects(
    updateMerchantTaskColumn(makeClient("invalid_column_done_state"), {
      siteId: "10000000",
      ...WORKSPACE_OWNER_ACTOR,
      boardId: "22222222-2222-4222-8222-222222222222",
      columnId: "33333333-3333-4333-8333-333333333333",
      version: 2,
      isDone: true,
      operationId: "column-update-done-state",
    }),
    /invalid_column_is_done/,
  );
});

test("workspace mutation stores reject malformed actors before calling an RPC", async () => {
  let rpcCalls = 0;
  const client = {
    from() {
      throw new Error("unexpected table access");
    },
    async rpc() {
      rpcCalls += 1;
      throw new Error("unexpected RPC");
    },
  } as unknown as MerchantEnterpriseStoreClient;
  const invalidActor = {
    actorType: "employee" as const,
    actorId: "not-a-uuid",
  };
  const cases = [
    () =>
      bootstrapMerchantEnterpriseWorkspace(client, {
        siteId: "10000000",
        ...invalidActor,
      }),
    () =>
      createMerchantTaskBoard(client, {
        siteId: "10000000",
        ...invalidActor,
        name: "Operations",
      }),
    () =>
      updateMerchantTaskBoard(client, {
        siteId: "10000000",
        ...invalidActor,
        boardId: "22222222-2222-4222-8222-222222222222",
        version: 1,
        name: "Updated",
      }),
    () =>
      createMerchantTaskColumn(client, {
        siteId: "10000000",
        ...invalidActor,
        boardId: "22222222-2222-4222-8222-222222222222",
        name: "To do",
      }),
    () =>
      updateMerchantTaskColumn(client, {
        siteId: "10000000",
        ...invalidActor,
        boardId: "22222222-2222-4222-8222-222222222222",
        columnId: "33333333-3333-4333-8333-333333333333",
        version: 1,
        name: "Doing",
      }),
  ];

  for (const invoke of cases) {
    await assert.rejects(invoke(), { message: "invalid_enterprise_actor" });
  }
  await assert.rejects(
    createMerchantTaskBoard(client, {
      siteId: "10000000",
      actorType: "system" as never,
      actorId: WORKSPACE_OWNER_ACTOR.actorId,
      name: "Operations",
    }),
    { message: "invalid_enterprise_actor" },
  );
  assert.equal(rpcCalls, 0);
});

test("workspace atomic authorization errors stay non-disclosing and actionable", async () => {
  const makeClient = (message: string) =>
    ({
      from() {
        throw new Error("unexpected table access");
      },
      async rpc() {
        return { data: null, error: { code: "P0001", message } };
      },
    }) as unknown as MerchantEnterpriseStoreClient;

  await assert.rejects(
    bootstrapMerchantEnterpriseWorkspace(makeClient("permission_denied"), {
      siteId: "10000000",
      ...WORKSPACE_OWNER_ACTOR,
    }),
    { message: "permission_denied" },
  );
  for (const internalCode of [
    "employee_not_found",
    "employee_account_disabled",
    "role_not_found",
    "role_inactive",
  ]) {
    await assert.rejects(
      createMerchantTaskBoard(makeClient(internalCode), {
        siteId: "10000000",
        ...WORKSPACE_OWNER_ACTOR,
        name: "Operations",
      }),
      { message: "permission_denied" },
    );
  }
  await assert.rejects(
    updateMerchantTaskBoard(makeClient("board_not_found"), {
      siteId: "10000000",
      ...WORKSPACE_OWNER_ACTOR,
      boardId: "22222222-2222-4222-8222-222222222222",
      version: 1,
      name: "Updated",
    }),
    { message: "board_not_found" },
  );
  await assert.rejects(
    updateMerchantTaskColumn(makeClient("column_not_found"), {
      siteId: "10000000",
      ...WORKSPACE_OWNER_ACTOR,
      boardId: "22222222-2222-4222-8222-222222222222",
      columnId: "33333333-3333-4333-8333-333333333333",
      version: 1,
      name: "Doing",
    }),
    { message: "column_not_found" },
  );
  await assert.rejects(
    createMerchantTaskColumn(makeClient("invalid_workspace_actor"), {
      siteId: "10000000",
      ...WORKSPACE_OWNER_ACTOR,
      boardId: "22222222-2222-4222-8222-222222222222",
      name: "To do",
    }),
    { message: "invalid_enterprise_actor" },
  );
});

test("task creation sends task, assignees and event through one idempotent RPC", async () => {
  const calls: Array<{ functionName: string; args: Record<string, unknown> }> = [];
  const client = {
    from() {
      throw new Error("task creation must not issue direct table writes");
    },
    async rpc(functionName: string, args: Record<string, unknown>) {
      calls.push({ functionName, args });
      return {
        data: {
          task: taskRow(1),
          assignee_ids: [
            "55555555-5555-4555-8555-555555555555",
            "66666666-6666-4666-8666-666666666666",
          ],
        },
        error: null,
      };
    },
  } as unknown as MerchantEnterpriseStoreClient;

  const task = await createMerchantTask(client, {
    siteId: "10000000",
    boardId: "22222222-2222-4222-8222-222222222222",
    columnId: "33333333-3333-4333-8333-333333333333",
    title: "Prepare launch",
    assigneeIds: [
      "66666666-6666-4666-8666-666666666666",
      "55555555-5555-4555-8555-555555555555",
    ],
    actorType: "owner",
    actorId: "44444444-4444-4444-8444-444444444444",
    operationId: "task-create-1",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.functionName, "faolla_create_merchant_task_v1");
  const input = calls[0]?.args.p_input as Record<string, unknown>;
  assert.equal(input.operation_id, "task-create-1");
  assert.equal("position" in input, false);
  assert.deepEqual(input.assignee_ids, [
    "55555555-5555-4555-8555-555555555555",
    "66666666-6666-4666-8666-666666666666",
  ]);
  assert.equal(input.actor_type, "owner");
  assert.equal(input.actor_id, "44444444-4444-4444-8444-444444444444");
  assert.equal(task.assigneeIds.length, 2);
});

test("source task lookup is merchant scoped, includes archived tasks, and loads assignees", async () => {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const archivedAt = "2026-08-01T09:00:00.000Z";
  const client = {
    from(table: string) {
      const builder = {
        select(...args: unknown[]) {
          calls.push({ table, method: "select", args });
          return builder;
        },
        eq(...args: unknown[]) {
          calls.push({ table, method: "eq", args });
          return builder;
        },
        order(...args: unknown[]) {
          calls.push({ table, method: "order", args });
          return builder;
        },
        limit(...args: unknown[]) {
          calls.push({ table, method: "limit", args });
          if (table === "merchant_task_assignees") {
            return Promise.resolve({
              data: [
                { employee_id: "55555555-5555-4555-8555-555555555555" },
                { employee_id: "66666666-6666-4666-8666-666666666666" },
              ],
              error: null,
            });
          }
          return builder;
        },
        async maybeSingle() {
          calls.push({ table, method: "maybeSingle", args: [] });
          return { data: orderTaskRow(4, archivedAt), error: null };
        },
      };
      return builder;
    },
    async rpc() {
      throw new Error("source lookup must not call RPCs");
    },
  } as unknown as MerchantEnterpriseStoreClient;

  const task = await loadMerchantTaskBySource(client, "10000000", "order", "O-1001");

  assert.equal(task?.archivedAt, archivedAt);
  assert.deepEqual(task?.assigneeIds, [
    "55555555-5555-4555-8555-555555555555",
    "66666666-6666-4666-8666-666666666666",
  ]);
  assert.deepEqual(
    calls.filter((call) => call.method === "eq"),
    [
      { table: "merchant_tasks", method: "eq", args: ["merchant_id", "10000000"] },
      { table: "merchant_tasks", method: "eq", args: ["source_type", "order"] },
      { table: "merchant_tasks", method: "eq", args: ["source_id", "O-1001"] },
      {
        table: "merchant_task_assignees",
        method: "eq",
        args: ["merchant_id", "10000000"],
      },
      {
        table: "merchant_task_assignees",
        method: "eq",
        args: ["task_id", "11111111-1111-4111-8111-111111111111"],
      },
    ],
  );
  assert.equal(calls.some((call) => call.method === "is"), false);
});

test("order task creation fixes the source and reports a new task", async () => {
  const rpcInputs: Record<string, unknown>[] = [];
  const client = {
    from(table: string) {
      assert.equal(table, "merchant_tasks");
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        order() { return builder; },
        limit() { return builder; },
        async maybeSingle() { return { data: null, error: null }; },
      };
      return builder;
    },
    async rpc(functionName: string, args: Record<string, unknown>) {
      assert.equal(functionName, "faolla_create_merchant_task_v1");
      rpcInputs.push(args.p_input as Record<string, unknown>);
      return {
        data: { task: orderTaskRow(), assignee_ids: [] },
        error: null,
      };
    },
  } as unknown as MerchantEnterpriseStoreClient;

  const result = await createOrGetMerchantOrderTask(client, {
    siteId: "10000000",
    orderId: "O-1001",
    boardId: "22222222-2222-4222-8222-222222222222",
    columnId: "33333333-3333-4333-8333-333333333333",
    title: "Process order O-1001",
    actorType: "owner",
    actorId: "44444444-4444-4444-8444-444444444444",
    operationId: "order-task-create-1",
  });

  assert.equal(result.created, true);
  assert.equal(result.task.sourceType, "order");
  assert.equal(result.task.sourceId, "O-1001");
  assert.equal(rpcInputs[0]?.source_type, "order");
  assert.equal(rpcInputs[0]?.source_id, "O-1001");
  assert.equal(rpcInputs[0]?.operation_id, "order-task-create-1");
});

test("order task creation returns an existing task without writing", async () => {
  let rpcCalls = 0;
  const client = {
    from(table: string) {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        order() { return builder; },
        limit() {
          return table === "merchant_task_assignees"
            ? Promise.resolve({ data: [], error: null })
            : builder;
        },
        async maybeSingle() { return { data: orderTaskRow(2), error: null }; },
      };
      return builder;
    },
    async rpc() {
      rpcCalls += 1;
      throw new Error("existing order tasks must not be recreated");
    },
  } as unknown as MerchantEnterpriseStoreClient;

  const result = await createOrGetMerchantOrderTask(client, {
    siteId: "10000000",
    orderId: "O-1001",
    boardId: "22222222-2222-4222-8222-222222222222",
    columnId: "33333333-3333-4333-8333-333333333333",
    title: "Ignored because the task exists",
    actorType: "owner",
    actorId: "44444444-4444-4444-8444-444444444444",
  });

  assert.equal(result.created, false);
  assert.equal(result.task.version, 2);
  assert.equal(rpcCalls, 0);
});

test("order task creation rereads after a stable concurrent-create conflict", async () => {
  const taskReads = [null, orderTaskRow(3)];
  let rpcCalls = 0;
  const client = {
    from(table: string) {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        order() { return builder; },
        limit() {
          return table === "merchant_task_assignees"
            ? Promise.resolve({
                data: [{ employee_id: "55555555-5555-4555-8555-555555555555" }],
                error: null,
              })
            : builder;
        },
        async maybeSingle() { return { data: taskReads.shift() ?? null, error: null }; },
      };
      return builder;
    },
    async rpc() {
      rpcCalls += 1;
      return {
        data: null,
        error: { code: "P0001", message: "merchant_order_task_exists" },
      };
    },
  } as unknown as MerchantEnterpriseStoreClient;

  const result = await createOrGetMerchantOrderTask(client, {
    siteId: "10000000",
    orderId: "O-1001",
    boardId: "22222222-2222-4222-8222-222222222222",
    columnId: "33333333-3333-4333-8333-333333333333",
    title: "Process order O-1001",
    actorType: "owner",
    actorId: "44444444-4444-4444-8444-444444444444",
  });

  assert.equal(result.created, false);
  assert.equal(result.task.version, 3);
  assert.deepEqual(result.task.assigneeIds, ["55555555-5555-4555-8555-555555555555"]);
  assert.equal(rpcCalls, 1);
  assert.equal(taskReads.length, 0);
});

test("order task creation preserves non-conflict errors and missing conflict rereads", async () => {
  for (const errorMessage of ["invalid_task_board", "merchant_order_task_exists"]) {
    const client = {
      from(table: string) {
        assert.equal(table, "merchant_tasks");
        const builder = {
          select() { return builder; },
          eq() { return builder; },
          order() { return builder; },
          limit() { return builder; },
          async maybeSingle() { return { data: null, error: null }; },
        };
        return builder;
      },
      async rpc() {
        return { data: null, error: { code: "P0001", message: errorMessage } };
      },
    } as unknown as MerchantEnterpriseStoreClient;

    await assert.rejects(
      createOrGetMerchantOrderTask(client, {
        siteId: "10000000",
        orderId: "O-1001",
        boardId: "22222222-2222-4222-8222-222222222222",
        columnId: "33333333-3333-4333-8333-333333333333",
        title: "Process order O-1001",
        actorType: "owner",
        actorId: "44444444-4444-4444-8444-444444444444",
      }),
      new RegExp(`^Error: ${errorMessage}$`),
    );
  }
});

test("task activity reads only the latest 50 merchant-scoped events", async () => {
  const filters: Array<[string, unknown]> = [];
  const orders: Array<[string, { ascending: boolean }]> = [];
  let selectedColumns = "";
  let requestedLimit = 0;
  const client = {
    from(table: string) {
      assert.equal(table, "merchant_task_events");
      const builder = {
        select(columns: string) {
          selectedColumns = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return builder;
        },
        order(column: string, options: { ascending: boolean }) {
          orders.push([column, options]);
          return builder;
        },
        async limit(value: number) {
          requestedLimit = value;
          return { data: [taskEventRow()], error: null };
        },
      };
      return builder;
    },
    async rpc() {
      throw new Error("activity reads must not call RPCs");
    },
  } as unknown as MerchantEnterpriseStoreClient;

  const events = await loadMerchantTaskEvents(
    client,
    "10000000",
    "11111111-1111-4111-8111-111111111111",
  );

  assert.match(selectedColumns, /event_type,actor_type,actor_id,payload,created_at/);
  assert.deepEqual(filters, [
    ["merchant_id", "10000000"],
    ["task_id", "11111111-1111-4111-8111-111111111111"],
  ]);
  assert.deepEqual(orders, [
    ["created_at", { ascending: false }],
    ["id", { ascending: false }],
  ]);
  assert.equal(requestedLimit, 50);
  assert.equal(events[0]?.payload.text, "Ready for review");
});

test("task comments use the append-only idempotent event RPC", async () => {
  const calls: Array<{ functionName: string; args: Record<string, unknown> }> = [];
  const client = {
    from() {
      throw new Error("task comments must not issue direct table writes");
    },
    async rpc(functionName: string, args: Record<string, unknown>) {
      calls.push({ functionName, args });
      return { data: { event: taskEventRow() }, error: null };
    },
  } as unknown as MerchantEnterpriseStoreClient;

  const event = await addMerchantTaskComment(client, {
    siteId: "10000000",
    taskId: "11111111-1111-4111-8111-111111111111",
    text: " Ready for review ",
    actorType: "employee",
    actorId: "55555555-5555-4555-8555-555555555555",
    operationId: "task-comment-1",
  });

  assert.equal(calls[0]?.functionName, "faolla_add_merchant_task_comment_v1");
  assert.deepEqual(calls[0]?.args.p_input, {
    merchant_id: "10000000",
    task_id: "11111111-1111-4111-8111-111111111111",
    text: "Ready for review",
    actor_type: "employee",
    actor_id: "55555555-5555-4555-8555-555555555555",
    operation_id: "task-comment-1",
  });
  assert.equal(event.eventType, "commented");
  assert.equal(event.payload.text, "Ready for review");
});

test("task comments reject empty and oversized text before the RPC", async () => {
  let rpcCalled = false;
  const client = {
    from() {
      throw new Error("unexpected table access");
    },
    async rpc() {
      rpcCalled = true;
      throw new Error("unexpected RPC");
    },
  } as unknown as MerchantEnterpriseStoreClient;

  for (const text of ["   ", "x".repeat(2001)]) {
    await assert.rejects(
      addMerchantTaskComment(client, {
        siteId: "10000000",
        taskId: "11111111-1111-4111-8111-111111111111",
        text,
        actorType: "owner",
        actorId: "44444444-4444-4444-8444-444444444444",
      }),
      /invalid_task_comment/,
    );
  }
  assert.equal(rpcCalled, false);
});

test("task checklist reads stay merchant and task scoped with a bounded stable order", async () => {
  const filters: Array<[string, unknown]> = [];
  const nullFilters: Array<[string, unknown]> = [];
  const orders: Array<[string, { ascending: boolean }]> = [];
  let selectedColumns = "";
  let requestedLimit = 0;
  const client = {
    from(table: string) {
      assert.equal(table, "merchant_task_checklist_items");
      const builder = {
        select(columns: string) {
          selectedColumns = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return builder;
        },
        is(column: string, value: unknown) {
          nullFilters.push([column, value]);
          return builder;
        },
        order(column: string, options: { ascending: boolean }) {
          orders.push([column, options]);
          return builder;
        },
        async limit(value: number) {
          requestedLimit = value;
          return {
            data: [
              checklistItemRow(2, {
                completed_at: "2026-07-31T09:00:00.000Z",
              }),
              checklistItemRow(3, {
                id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                merchant_id: "99999999",
              }),
            ],
            error: null,
          };
        },
      };
      return builder;
    },
    async rpc() {
      throw new Error("checklist reads must not call RPCs");
    },
  } as unknown as MerchantEnterpriseStoreClient;

  const items = await loadMerchantTaskChecklistItems(
    client,
    "10000000",
    "11111111-1111-4111-8111-111111111111",
  );

  assert.match(selectedColumns, /completed_at,archived_at,version/);
  assert.deepEqual(filters, [
    ["merchant_id", "10000000"],
    ["task_id", "11111111-1111-4111-8111-111111111111"],
  ]);
  assert.deepEqual(nullFilters, [["archived_at", null]]);
  assert.deepEqual(orders, [
    ["position", { ascending: true }],
    ["created_at", { ascending: true }],
    ["id", { ascending: true }],
  ]);
  assert.equal(requestedLimit, 100);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.siteId, "10000000");
  assert.equal(items[0]?.completed, true);
});

test("task checklist creation uses one scoped idempotent RPC", async () => {
  const calls: Array<{ functionName: string; args: Record<string, unknown> }> = [];
  const client = {
    from() {
      throw new Error("checklist creation must not issue direct table writes");
    },
    async rpc(functionName: string, args: Record<string, unknown>) {
      calls.push({ functionName, args });
      return { data: { item: checklistItemRow() }, error: null };
    },
  } as unknown as MerchantEnterpriseStoreClient;

  const item = await createMerchantTaskChecklistItem(client, {
    siteId: "10000000",
    taskId: "11111111-1111-4111-8111-111111111111",
    text: " Confirm inventory ",
    actorType: "owner",
    actorId: "44444444-4444-4444-8444-444444444444",
    operationId: "task-checklist-create-1",
  });

  assert.equal(calls[0]?.functionName, "faolla_create_merchant_task_checklist_item_v1");
  assert.deepEqual(calls[0]?.args.p_input, {
    merchant_id: "10000000",
    task_id: "11111111-1111-4111-8111-111111111111",
    text: "Confirm inventory",
    actor_type: "owner",
    actor_id: "44444444-4444-4444-8444-444444444444",
    operation_id: "task-checklist-create-1",
  });
  assert.equal(item.text, "Confirm inventory");
  assert.equal(item.version, 1);
});

test("task checklist updates carry task scope, item CAS and each supported action", async () => {
  const changes = [
    { text: "Count final stock" },
    { completed: true },
    { completed: false },
    { archived: true },
    { archived: false },
  ] as const;

  for (const [index, change] of changes.entries()) {
    const calls: Array<{ functionName: string; args: Record<string, unknown> }> = [];
    const client = {
      from() {
        throw new Error("checklist updates must not issue direct table writes");
      },
      async rpc(functionName: string, args: Record<string, unknown>) {
        calls.push({ functionName, args });
        return {
          data: {
            item: checklistItemRow(8, {
              ...(change && "completed" in change && change.completed
                ? { completed_at: "2026-07-31T09:00:00.000Z" }
                : {}),
              ...(change && "archived" in change && change.archived
                ? { archived_at: "2026-07-31T09:00:00.000Z" }
                : {}),
            }),
          },
          error: null,
        };
      },
    } as unknown as MerchantEnterpriseStoreClient;

    const item = await updateMerchantTaskChecklistItem(client, {
      siteId: "10000000",
      taskId: "11111111-1111-4111-8111-111111111111",
      itemId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      version: 7,
      actorType: "employee",
      actorId: "55555555-5555-4555-8555-555555555555",
      operationId: `task-checklist-update-${index}`,
      ...change,
    });

    assert.equal(calls[0]?.functionName, "faolla_update_merchant_task_checklist_item_v1");
    assert.deepEqual(calls[0]?.args.p_input, {
      merchant_id: "10000000",
      task_id: "11111111-1111-4111-8111-111111111111",
      item_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      expected_version: 7,
      actor_type: "employee",
      actor_id: "55555555-5555-4555-8555-555555555555",
      operation_id: `task-checklist-update-${index}`,
      ...change,
    });
    assert.equal(item.version, 8);
  }
});

test("task checklist rejects invalid text and versions before persistence", async () => {
  let rpcCalled = false;
  const client = {
    from() {
      throw new Error("unexpected table access");
    },
    async rpc() {
      rpcCalled = true;
      throw new Error("unexpected RPC");
    },
  } as unknown as MerchantEnterpriseStoreClient;

  for (const text of ["   ", "x".repeat(501)]) {
    await assert.rejects(
      createMerchantTaskChecklistItem(client, {
        siteId: "10000000",
        taskId: "11111111-1111-4111-8111-111111111111",
        text,
        actorType: "owner",
        actorId: "44444444-4444-4444-8444-444444444444",
      }),
      /invalid_task_checklist_create/,
    );
  }
  await assert.rejects(
    updateMerchantTaskChecklistItem(client, {
      siteId: "10000000",
      taskId: "11111111-1111-4111-8111-111111111111",
      itemId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      version: 0,
      text: "Updated",
      actorType: "owner",
      actorId: "44444444-4444-4444-8444-444444444444",
    }),
    /invalid_task_checklist_update/,
  );
  assert.equal(rpcCalled, false);
});

test("task checklist RPC errors preserve actionable public codes", async () => {
  for (const code of [
    "enterprise_version_conflict",
    "enterprise_operation_in_progress",
    "task_not_found",
    "task_checklist_item_not_found",
    "task_checklist_limit_reached",
    "invalid_task_checklist_archived",
  ]) {
    const client = {
      from() {
        throw new Error("unexpected table access");
      },
      async rpc() {
        return { data: null, error: { code: "P0001", message: code } };
      },
    } as unknown as MerchantEnterpriseStoreClient;

    await assert.rejects(
      updateMerchantTaskChecklistItem(client, {
        siteId: "10000000",
        taskId: "11111111-1111-4111-8111-111111111111",
        itemId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        version: 7,
        completed: true,
        actorType: "owner",
        actorId: "44444444-4444-4444-8444-444444444444",
        operationId: `task-checklist-error-${code}`,
      }),
      new RegExp(code),
    );
  }
});

test("assignee-only task update still goes through the version-locking RPC", async () => {
  const calls: Array<{ functionName: string; args: Record<string, unknown> }> = [];
  const client = {
    from() {
      throw new Error("assignee replacement must not issue direct table writes");
    },
    async rpc(functionName: string, args: Record<string, unknown>) {
      calls.push({ functionName, args });
      return {
        data: {
          task: taskRow(8),
          assignee_ids: ["55555555-5555-4555-8555-555555555555"],
        },
        error: null,
      };
    },
  } as unknown as MerchantEnterpriseStoreClient;

  const task = await updateMerchantTask(client, {
    siteId: "10000000",
    taskId: "11111111-1111-4111-8111-111111111111",
    version: 7,
    actorType: "employee",
    actorId: "55555555-5555-4555-8555-555555555555",
    assigneeIds: ["55555555-5555-4555-8555-555555555555"],
    operationId: "task-assign-1",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.functionName, "faolla_update_merchant_task_v1");
  const input = calls[0]?.args.p_input as Record<string, unknown>;
  assert.equal(input.expected_version, 7);
  assert.equal(input.replace_assignees, true);
  assert.equal(input.operation_id, "task-assign-1");
  assert.equal(task.version, 8);
});

test("task reordering sends a zero-based target index through one atomic RPC", async () => {
  const calls: Array<{ functionName: string; args: Record<string, unknown> }> = [];
  const client = {
    from() {
      throw new Error("task reordering must not issue direct table writes");
    },
    async rpc(functionName: string, args: Record<string, unknown>) {
      calls.push({ functionName, args });
      return {
        data: {
          task: { ...taskRow(8), position: 2_048 },
          assignee_ids: ["55555555-5555-4555-8555-555555555555"],
        },
        error: null,
      };
    },
  } as unknown as MerchantEnterpriseStoreClient;

  const task = await moveMerchantTask(client, {
    siteId: "10000000",
    taskId: "11111111-1111-4111-8111-111111111111",
    version: 7,
    columnId: "33333333-3333-4333-8333-333333333333",
    targetIndex: 2,
    actorType: "employee",
    actorId: "55555555-5555-4555-8555-555555555555",
    operationId: "task-reorder-1",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.functionName, "faolla_move_merchant_task_v1");
  assert.deepEqual(calls[0]?.args.p_input, {
    merchant_id: "10000000",
    task_id: "11111111-1111-4111-8111-111111111111",
    expected_version: 7,
    target_column_id: "33333333-3333-4333-8333-333333333333",
    target_index: 2,
    actor_type: "employee",
    actor_id: "55555555-5555-4555-8555-555555555555",
    operation_id: "task-reorder-1",
  });
  assert.equal(task.position, 2_048);
  assert.deepEqual(task.assigneeIds, ["55555555-5555-4555-8555-555555555555"]);
});

test("task reordering rejects invalid target indices before calling the RPC", async () => {
  let rpcCalled = false;
  const client = {
    from() {
      throw new Error("unexpected table access");
    },
    async rpc() {
      rpcCalled = true;
      throw new Error("unexpected RPC");
    },
  } as unknown as MerchantEnterpriseStoreClient;

  await assert.rejects(
    moveMerchantTask(client, {
      siteId: "10000000",
      taskId: "11111111-1111-4111-8111-111111111111",
      version: 7,
      columnId: "33333333-3333-4333-8333-333333333333",
      targetIndex: -1,
      actorType: "owner",
      actorId: "44444444-4444-4444-8444-444444444444",
    }),
    /invalid_task_move/,
  );
  assert.equal(rpcCalled, false);
});

test("task archive and restore use versioned idempotent RPC events", async () => {
  for (const archived of [true, false]) {
    const calls: Array<{ functionName: string; args: Record<string, unknown> }> = [];
    const client = {
      from() {
        throw new Error("task archive must not issue direct table writes");
      },
      async rpc(functionName: string, args: Record<string, unknown>) {
        calls.push({ functionName, args });
        return {
          data: {
            task: taskRow(8),
            assignee_ids: [],
          },
          error: null,
        };
      },
    } as unknown as MerchantEnterpriseStoreClient;

    await updateMerchantTask(client, {
      siteId: "10000000",
      taskId: "11111111-1111-4111-8111-111111111111",
      version: 7,
      actorType: "owner",
      actorId: "44444444-4444-4444-8444-444444444444",
      archived,
      operationId: archived ? "task-archive-1" : "task-restore-1",
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.functionName, "faolla_update_merchant_task_v1");
    const input = calls[0]?.args.p_input as Record<string, unknown>;
    assert.equal(input.merchant_id, "10000000");
    assert.equal(input.task_id, "11111111-1111-4111-8111-111111111111");
    assert.equal(input.expected_version, 7);
    assert.equal(input.archived, archived);
    assert.equal(input.replace_assignees, false);
    assert.equal(input.event_type, archived ? "archived" : "restored");
    assert.equal(
      input.operation_id,
      archived ? "task-archive-1" : "task-restore-1",
    );
  }
});

test("task store rejects more than the supported assignee limit before RPC", async () => {
  let rpcCalled = false;
  const client = {
    from() {
      throw new Error("unexpected table access");
    },
    async rpc() {
      rpcCalled = true;
      throw new Error("unexpected RPC");
    },
  } as unknown as MerchantEnterpriseStoreClient;
  const assigneeIds = Array.from(
    { length: 51 },
    (_, index) => `employee-${index}`,
  );

  await assert.rejects(
    updateMerchantTask(client, {
      siteId: "10000000",
      taskId: "11111111-1111-4111-8111-111111111111",
      version: 7,
      actorType: "owner",
      actorId: "44444444-4444-4444-8444-444444444444",
      assigneeIds,
    }),
    /invalid_task_assignees/,
  );
  assert.equal(rpcCalled, false);
});

test("task RPC version errors preserve the public conflict code", async () => {
  const client = {
    from() {
      throw new Error("unexpected table access");
    },
    async rpc() {
      return {
        data: null,
        error: { code: "P0001", message: "enterprise_version_conflict" },
      };
    },
  } as unknown as MerchantEnterpriseStoreClient;

  await assert.rejects(
    updateMerchantTask(client, {
      siteId: "10000000",
      taskId: "11111111-1111-4111-8111-111111111111",
      version: 7,
      actorType: "owner",
      actorId: "44444444-4444-4444-8444-444444444444",
      title: "Updated",
      operationId: "task-update-1",
    }),
    /enterprise_version_conflict/,
  );
});

test("bootstrap uses one transactional idempotent RPC before reading the snapshot", async () => {
  const calls: Array<{ functionName: string; args: Record<string, unknown> }> = [];
  const client = {
    from() {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        order() {
          return builder;
        },
        async range() {
          return { data: [], error: null };
        },
      };
      return builder;
    },
    async rpc(functionName: string, args: Record<string, unknown>) {
      calls.push({ functionName, args });
      return {
        data: {
          board: boardRow(),
          columns: [columnRow()],
          roles: [],
        },
        error: null,
      };
    },
  } as unknown as MerchantEnterpriseStoreClient;

  const snapshot = await bootstrapMerchantEnterpriseWorkspace(client, {
    siteId: "10000000",
    ...WORKSPACE_OWNER_ACTOR,
    operationId: "bootstrap-1",
  });

  assert.deepEqual(snapshot, {
    roles: [],
    employees: [],
    boards: [],
    columns: [],
    tasks: [],
  });
  assert.deepEqual(calls, [
    {
      functionName: "faolla_bootstrap_merchant_enterprise_v2",
      args: {
        p_input: {
          merchant_id: "10000000",
          actor_type: "owner",
          actor_id: WORKSPACE_OWNER_ACTOR.actorId,
          operation_id: "bootstrap-1",
        },
      },
    },
  ]);
});

test("enterprise snapshot reads use explicit bounded pagination", async () => {
  const ranges: Array<{ table: string; from: number; to: number }> = [];
  const client = {
    from(table: string) {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        order() {
          return builder;
        },
        async range(from: number, to: number) {
          ranges.push({ table, from, to });
          return { data: [], error: null };
        },
      };
      return builder;
    },
    async rpc() {
      throw new Error("snapshot reads must not call RPCs");
    },
  } as unknown as MerchantEnterpriseStoreClient;

  const snapshot = await loadMerchantEnterpriseSnapshot(client, "10000000");
  assert.deepEqual(snapshot, {
    roles: [],
    employees: [],
    boards: [],
    columns: [],
    tasks: [],
  });
  assert.equal(ranges.length, 7);
  ranges.forEach((range) => {
    assert.equal(range.from, 0);
    assert.equal(range.to, 499);
  });
});

test("enterprise snapshot sorts boards and columns by position with stable ids", async () => {
  const client = {
    from(table: string) {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        order() {
          return builder;
        },
        async range() {
          if (table === "merchant_task_boards") {
            return {
              data: [
                boardRow("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", 1, 2),
                boardRow("cccccccc-cccc-4ccc-8ccc-cccccccccccc", 1, 0),
                boardRow("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 1, 2),
              ],
              error: null,
            };
          }
          if (table === "merchant_task_columns") {
            return {
              data: [
                columnRow("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", 1, 3),
                columnRow("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 1, 3),
                columnRow("cccccccc-cccc-4ccc-8ccc-cccccccccccc", 1, 1),
              ],
              error: null,
            };
          }
          return { data: [], error: null };
        },
      };
      return builder;
    },
    async rpc() {
      throw new Error("snapshot reads must not call RPCs");
    },
  } as unknown as MerchantEnterpriseStoreClient;

  const snapshot = await loadMerchantEnterpriseSnapshot(client, "10000000");
  assert.deepEqual(
    snapshot.boards.map((board) => [board.position, board.id]),
    [
      [0, "cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
      [2, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
      [2, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
    ],
  );
  assert.deepEqual(
    snapshot.columns.map((column) => [column.position, column.id]),
    [
      [1, "cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
      [3, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
      [3, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
    ],
  );
});

test("task mutation stores reject malformed actors before calling an RPC", async () => {
  let rpcCalls = 0;
  const client = {
    from() {
      throw new Error("unexpected table access");
    },
    async rpc() {
      rpcCalls += 1;
      throw new Error("unexpected RPC");
    },
  } as unknown as MerchantEnterpriseStoreClient;

  const cases: Array<{ expected: RegExp; invoke: () => Promise<unknown> }> = [
    {
      expected: /invalid_task_actor/,
      invoke: () =>
        createMerchantTask(client, {
          siteId: "10000000",
          boardId: "22222222-2222-4222-8222-222222222222",
          columnId: "33333333-3333-4333-8333-333333333333",
          title: "Prepare launch",
          actorType: "owner",
          actorId: "not-a-uuid",
        }),
    },
    {
      expected: /invalid_task_actor/,
      invoke: () =>
        createOrGetMerchantOrderTask(client, {
          siteId: "10000000",
          orderId: "order-1001",
          boardId: "22222222-2222-4222-8222-222222222222",
          columnId: "33333333-3333-4333-8333-333333333333",
          title: "Process order",
          actorType: "owner",
          actorId: "not-a-uuid",
        }),
    },
    {
      expected: /invalid_task_actor/,
      invoke: () =>
        updateMerchantTask(client, {
          siteId: "10000000",
          taskId: "11111111-1111-4111-8111-111111111111",
          version: 7,
          title: "Updated",
          actorType: "employee",
          actorId: "not-a-uuid",
        }),
    },
    {
      expected: /invalid_task_actor/,
      invoke: () =>
        moveMerchantTask(client, {
          siteId: "10000000",
          taskId: "11111111-1111-4111-8111-111111111111",
          version: 7,
          columnId: "33333333-3333-4333-8333-333333333333",
          targetIndex: 2,
          actorType: "employee",
          actorId: "not-a-uuid",
        }),
    },
    {
      expected: /invalid_task_comment/,
      invoke: () =>
        addMerchantTaskComment(client, {
          siteId: "10000000",
          taskId: "11111111-1111-4111-8111-111111111111",
          text: "Ready",
          actorType: "employee",
          actorId: "not-a-uuid",
        }),
    },
    {
      expected: /invalid_task_checklist_create/,
      invoke: () =>
        createMerchantTaskChecklistItem(client, {
          siteId: "10000000",
          taskId: "11111111-1111-4111-8111-111111111111",
          text: "Confirm stock",
          actorType: "employee",
          actorId: "not-a-uuid",
        }),
    },
    {
      expected: /invalid_task_checklist_update/,
      invoke: () =>
        updateMerchantTaskChecklistItem(client, {
          siteId: "10000000",
          taskId: "11111111-1111-4111-8111-111111111111",
          itemId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          version: 7,
          completed: true,
          actorType: "employee",
          actorId: "not-a-uuid",
        }),
    },
  ];

  for (const taskCase of cases) {
    await assert.rejects(taskCase.invoke(), taskCase.expected);
  }
  assert.equal(rpcCalls, 0);
});

test("atomic task authorization errors remain stable across every mutation store", async () => {
  const cases: Array<{
    code: string;
    invoke: (client: MerchantEnterpriseStoreClient) => Promise<unknown>;
  }> = [
    {
      code: "permission_denied",
      invoke: (client) =>
        createMerchantTask(client, {
          siteId: "10000000",
          boardId: "22222222-2222-4222-8222-222222222222",
          columnId: "33333333-3333-4333-8333-333333333333",
          title: "Prepare launch",
          actorType: "employee",
          actorId: "55555555-5555-4555-8555-555555555555",
        }),
    },
    {
      code: "board_not_found",
      invoke: (client) =>
        createMerchantTask(client, {
          siteId: "10000000",
          boardId: "22222222-2222-4222-8222-222222222222",
          columnId: "33333333-3333-4333-8333-333333333333",
          title: "Prepare launch",
          actorType: "employee",
          actorId: "55555555-5555-4555-8555-555555555555",
        }),
    },
    {
      code: "invalid_task_actor",
      invoke: (client) =>
        createMerchantTask(client, {
          siteId: "10000000",
          boardId: "22222222-2222-4222-8222-222222222222",
          columnId: "33333333-3333-4333-8333-333333333333",
          title: "Prepare launch",
          actorType: "owner",
          actorId: "44444444-4444-4444-8444-444444444444",
        }),
    },
    {
      code: "task_not_found",
      invoke: (client) =>
        updateMerchantTask(client, {
          siteId: "10000000",
          taskId: "11111111-1111-4111-8111-111111111111",
          version: 7,
          title: "Updated",
          actorType: "employee",
          actorId: "55555555-5555-4555-8555-555555555555",
        }),
    },
    {
      code: "permission_denied",
      invoke: (client) =>
        moveMerchantTask(client, {
          siteId: "10000000",
          taskId: "11111111-1111-4111-8111-111111111111",
          version: 7,
          columnId: "33333333-3333-4333-8333-333333333333",
          targetIndex: 2,
          actorType: "employee",
          actorId: "55555555-5555-4555-8555-555555555555",
        }),
    },
    {
      code: "permission_denied",
      invoke: (client) =>
        addMerchantTaskComment(client, {
          siteId: "10000000",
          taskId: "11111111-1111-4111-8111-111111111111",
          text: "Ready",
          actorType: "employee",
          actorId: "55555555-5555-4555-8555-555555555555",
        }),
    },
    {
      code: "task_not_found",
      invoke: (client) =>
        addMerchantTaskComment(client, {
          siteId: "10000000",
          taskId: "11111111-1111-4111-8111-111111111111",
          text: "Ready",
          actorType: "employee",
          actorId: "55555555-5555-4555-8555-555555555555",
        }),
    },
    {
      code: "permission_denied",
      invoke: (client) =>
        createMerchantTaskChecklistItem(client, {
          siteId: "10000000",
          taskId: "11111111-1111-4111-8111-111111111111",
          text: "Confirm stock",
          actorType: "employee",
          actorId: "55555555-5555-4555-8555-555555555555",
        }),
    },
    {
      code: "task_not_found",
      invoke: (client) =>
        updateMerchantTaskChecklistItem(client, {
          siteId: "10000000",
          taskId: "11111111-1111-4111-8111-111111111111",
          itemId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          version: 7,
          completed: true,
          actorType: "employee",
          actorId: "55555555-5555-4555-8555-555555555555",
        }),
    },
  ];

  for (const taskCase of cases) {
    const client = {
      from() {
        throw new Error("unexpected table access");
      },
      async rpc() {
        return {
          data: null,
          error: { code: "P0001", message: taskCase.code },
        };
      },
    } as unknown as MerchantEnterpriseStoreClient;
    await assert.rejects(taskCase.invoke(client), { message: taskCase.code });
  }
});

test("task assignment board-scope errors remain actionable", async () => {
  const client = {
    from() {
      throw new Error("unexpected table access");
    },
    async rpc() {
      return {
        data: null,
        error: { code: "P0001", message: "task_assignee_board_access_denied" },
      };
    },
  } as unknown as MerchantEnterpriseStoreClient;

  await assert.rejects(
    updateMerchantTask(client, {
      siteId: "10000000",
      taskId: "11111111-1111-4111-8111-111111111111",
      version: 7,
      actorType: "owner",
      actorId: "44444444-4444-4444-8444-444444444444",
      assigneeIds: ["22222222-2222-4222-8222-222222222222"],
      operationId: "task-assignment-scope-1",
    }),
    /task_assignee_board_access_denied/,
  );
});

test("linked-order summary authorization uses one atomic source-derivation RPC", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    from() {
      throw new Error("linked-order authorization must not use direct table reads");
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return {
        data: { source_id: "O10000000202608010001" },
        error: null,
      };
    },
  } as unknown as MerchantEnterpriseStoreClient;

  const sourceId = await authorizeMerchantLinkedOrderSummarySource(client, {
    siteId: "10000000",
    taskId: "11111111-1111-4111-8111-111111111111",
    employeeId: "77777777-7777-4777-8777-777777777777",
  });

  assert.equal(sourceId, "O10000000202608010001");
  assert.deepEqual(calls, [
    {
      name: "faolla_authorize_merchant_linked_order_summary_v1",
      args: {
        p_input: {
          merchant_id: "10000000",
          task_id: "11111111-1111-4111-8111-111111111111",
          employee_id: "77777777-7777-4777-8777-777777777777",
        },
      },
    },
  ]);
});

test("linked-order summary authorization fails closed before exposing a source", async () => {
  let rpcCalls = 0;
  const invalidInputClient = {
    from() {
      throw new Error("unexpected table access");
    },
    async rpc() {
      rpcCalls += 1;
      return { data: { source_id: "O-1001" }, error: null };
    },
  } as unknown as MerchantEnterpriseStoreClient;

  await assert.rejects(
    authorizeMerchantLinkedOrderSummarySource(invalidInputClient, {
      siteId: "10000000",
      taskId: "not-a-task",
      employeeId: "77777777-7777-4777-8777-777777777777",
    }),
    { message: "invalid_linked_order_summary_query" },
  );
  assert.equal(rpcCalls, 0);

  const invisibleTaskClient = {
    from() {
      throw new Error("unexpected table access");
    },
    async rpc() {
      return {
        data: null,
        error: { code: "P0001", message: "task_not_found" },
      };
    },
  } as unknown as MerchantEnterpriseStoreClient;
  await assert.rejects(
    authorizeMerchantLinkedOrderSummarySource(invisibleTaskClient, {
      siteId: "10000000",
      taskId: "11111111-1111-4111-8111-111111111111",
      employeeId: "77777777-7777-4777-8777-777777777777",
    }),
    { message: "task_not_found" },
  );

  const malformedResponseClient = {
    from() {
      throw new Error("unexpected table access");
    },
    async rpc() {
      return { data: { source_id: "../private-order" }, error: null };
    },
  } as unknown as MerchantEnterpriseStoreClient;
  await assert.rejects(
    authorizeMerchantLinkedOrderSummarySource(malformedResponseClient, {
      siteId: "10000000",
      taskId: "11111111-1111-4111-8111-111111111111",
      employeeId: "77777777-7777-4777-8777-777777777777",
    }),
    /enterprise_linked_order_summary_authorization_failed:invalid_response/,
  );
});

test("notification listing derives the recipient from the validated employee actor and paginates", async () => {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const firstCreatedAt = "2026-08-02T12:00:00.000Z";
  const secondCreatedAt = "2026-08-02T11:00:00.000Z";
  const thirdCreatedAt = "2026-08-02T10:00:00.000Z";
  const row = (id: string, createdAt: string, type = "task_commented") => ({
    id,
    merchant_id: "10000000",
    task_id: "11111111-1111-4111-8111-111111111111",
    notification_type: type,
    actor_type: "employee",
    actor_id: "66666666-6666-4666-8666-666666666666",
    payload: {},
    read_at: null,
    created_at: createdAt,
  });
  const client = {
    from() {
      throw new Error("notification reads must stay behind the recipient RPC");
    },
    async rpc(name: string, args: Record<string, unknown>) {
      const input = args.p_input as Record<string, unknown>;
      calls.push({ name, input });
      return {
        data: {
          notifications: [
            row("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", firstCreatedAt),
            row(
              "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              secondCreatedAt,
              "task_due_changed",
            ),
            row("cccccccc-cccc-4ccc-8ccc-cccccccccccc", thirdCreatedAt),
          ],
          unread_count: 9,
        },
        error: null,
      };
    },
  } as unknown as MerchantEnterpriseStoreClient;

  const page = await loadMerchantEnterpriseNotifications(client, {
    siteId: "10000000",
    actorType: "employee",
    actorId: "77777777-7777-4777-8777-777777777777",
    limit: 2,
    cursor: {
      createdAt: "2026-08-02T13:00:00.000Z",
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    },
  });

  assert.deepEqual(calls, [
    {
      name: "faolla_list_merchant_enterprise_notifications_v1",
      input: {
        merchant_id: "10000000",
        actor_type: "employee",
        actor_id: "77777777-7777-4777-8777-777777777777",
        limit: 2,
        cursor_created_at: "2026-08-02T13:00:00.000Z",
        cursor_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      },
    },
  ]);
  assert.equal("recipient_id" in calls[0]!.input, false);
  assert.equal(page.notifications.length, 2);
  assert.equal(page.notifications[1]?.type, "task_due_changed");
  assert.equal(page.unreadCount, 9);
  assert.deepEqual(page.nextCursor, {
    createdAt: secondCreatedAt,
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  });
});

test("notification mark-read is monotonic, recipient-derived and validates one-or-all", async () => {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const client = {
    from() {
      throw new Error("notification updates must stay behind the recipient RPC");
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({
        name,
        input: args.p_input as Record<string, unknown>,
      });
      return {
        data: { marked_count: 1, unread_count: 3 },
        error: null,
      };
    },
  } as unknown as MerchantEnterpriseStoreClient;

  const result = await markMerchantEnterpriseNotificationsRead(client, {
    siteId: "10000000",
    actorType: "employee",
    actorId: "77777777-7777-4777-8777-777777777777",
    notificationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  assert.deepEqual(result, { markedCount: 1, unreadCount: 3 });
  assert.deepEqual(calls, [
    {
      name: "faolla_mark_merchant_enterprise_notifications_read_v1",
      input: {
        merchant_id: "10000000",
        actor_type: "employee",
        actor_id: "77777777-7777-4777-8777-777777777777",
        mark_all: false,
        notification_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
    },
  ]);
  assert.equal("recipient_id" in calls[0]!.input, false);

  await assert.rejects(
    markMerchantEnterpriseNotificationsRead(client, {
      siteId: "10000000",
      actorType: "employee",
      actorId: "77777777-7777-4777-8777-777777777777",
      notificationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      all: true,
    }),
    { message: "invalid_notification_request" },
  );
});

test("notification store fails closed on forged actors, oversized pages and malformed rows", async () => {
  let calls = 0;
  const client = {
    from() {
      throw new Error("unexpected table access");
    },
    async rpc() {
      calls += 1;
      return {
        data: { notifications: [{ recipient_employee_id: "leak" }], unread_count: 1 },
        error: null,
      };
    },
  } as unknown as MerchantEnterpriseStoreClient;

  await assert.rejects(
    loadMerchantEnterpriseNotifications(client, {
      siteId: "10000000",
      actorType: "owner" as "employee",
      actorId: "77777777-7777-4777-8777-777777777777",
    }),
    { message: "invalid_notification_actor" },
  );
  await assert.rejects(
    loadMerchantEnterpriseNotifications(client, {
      siteId: "10000000",
      actorType: "employee",
      actorId: "77777777-7777-4777-8777-777777777777",
      limit: 51,
    }),
    { message: "invalid_notification_request" },
  );
  assert.equal(calls, 0);

  await assert.rejects(
    loadMerchantEnterpriseNotifications(client, {
      siteId: "10000000",
      actorType: "employee",
      actorId: "77777777-7777-4777-8777-777777777777",
    }),
    /enterprise_notifications_read_failed:invalid_response/,
  );
  assert.equal(calls, 1);
});

function auditEventRow(
  id: string,
  createdAt: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    merchant_id: "10000000",
    event_type: "employee.renamed",
    entity_type: "employee",
    entity_id: "77777777-7777-4777-8777-777777777777",
    actor_type: "owner",
    actor_id: null,
    actor_label: "企业负责人",
    target_label: "仓库员工",
    before_data: { display_name: "旧名称" },
    after_data: { display_name: "新名称" },
    operation_id: "",
    created_at: createdAt,
    ...overrides,
  };
}

test("audit loader uses one bounded actor-authorized RPC with exact filters and cursor", async () => {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const secondCreatedAt = "2026-08-02T11:00:00.000Z";
  const filteredActorId = "77777777-7777-4777-8777-777777777777";
  const client = {
    from() {
      throw new Error("audit reads must stay behind the authorized RPC");
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, input: args.p_input as Record<string, unknown> });
      return {
        data: {
          events: [
            auditEventRow(
              "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
              "2026-08-02T12:00:00.000Z",
              { actor_type: "employee", actor_id: filteredActorId },
            ),
            auditEventRow(
              "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              secondCreatedAt,
              { actor_type: "employee", actor_id: filteredActorId },
            ),
          ],
          next_cursor: {
            before_created_at: secondCreatedAt,
            before_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          },
        },
        error: null,
      };
    },
  } as unknown as MerchantEnterpriseStoreClient;

  const page = await loadMerchantEnterpriseAuditEvents(client, {
    siteId: "10000000",
    actorType: "owner",
    actorId: WORKSPACE_OWNER_ACTOR.actorId,
    limit: 2,
    entityType: "employee",
    eventType: "employee.renamed",
    filterActorType: "employee",
    filterActorId: filteredActorId,
    createdFrom: "2026-08-02T11:00:00Z",
    createdToExclusive: "2026-08-02T13:00:00.000Z",
    cursor: {
      beforeCreatedAt: "2026-08-02T13:00:00.000Z",
      beforeId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    },
  });

  assert.deepEqual(calls, [
    {
      name: "faolla_list_merchant_enterprise_audit_events_v1",
      input: {
        merchant_id: "10000000",
        actor_type: "owner",
        actor_id: WORKSPACE_OWNER_ACTOR.actorId,
        limit: 2,
        entity_type: "employee",
        event_type: "employee.renamed",
        filter_actor_type: "employee",
        filter_actor_id: filteredActorId,
        created_from: "2026-08-02T11:00:00.000Z",
        created_to_exclusive: "2026-08-02T13:00:00.000Z",
        before_created_at: "2026-08-02T13:00:00.000Z",
        before_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      },
    },
  ]);
  assert.equal(page.events.length, 2);
  assert.equal(page.events[0]?.actorId, filteredActorId);
  assert.deepEqual(page.nextCursor, {
    beforeCreatedAt: secondCreatedAt,
    beforeId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  });
});

test("audit loader preserves the legacy RPC payload when new filters are omitted", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    from() {
      throw new Error("audit reads must stay behind the authorized RPC");
    },
    async rpc(_name: string, args: Record<string, unknown>) {
      calls.push(args.p_input as Record<string, unknown>);
      return { data: { events: [], next_cursor: null }, error: null };
    },
  } as unknown as MerchantEnterpriseStoreClient;

  await loadMerchantEnterpriseAuditEvents(client, {
    siteId: "10000000",
    actorType: "owner",
    actorId: WORKSPACE_OWNER_ACTOR.actorId,
  });

  assert.deepEqual(calls, [
    {
      merchant_id: "10000000",
      actor_type: "owner",
      actor_id: WORKSPACE_OWNER_ACTOR.actorId,
      limit: 50,
    },
  ]);
});

test("audit loader preserves PostgreSQL microseconds for ordering and keyset cursors", async () => {
  const firstCreatedAt = "2026-08-02T12:00:00.789456Z";
  const secondCreatedAt = "2026-08-02T12:00:00.789455Z";
  const firstId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const secondId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const client = {
    from() {
      throw new Error("audit reads must stay behind the authorized RPC");
    },
    async rpc() {
      return {
        data: {
          events: [
            auditEventRow(firstId, firstCreatedAt),
            auditEventRow(secondId, secondCreatedAt),
          ],
          next_cursor: {
            before_created_at: secondCreatedAt,
            before_id: secondId,
          },
        },
        error: null,
      };
    },
  } as unknown as MerchantEnterpriseStoreClient;

  const page = await loadMerchantEnterpriseAuditEvents(client, {
    siteId: "10000000",
    actorType: "owner",
    actorId: WORKSPACE_OWNER_ACTOR.actorId,
    limit: 2,
  });

  assert.deepEqual(
    page.events.map((event) => event.createdAt),
    [firstCreatedAt, secondCreatedAt],
  );
  assert.deepEqual(page.nextCursor, {
    beforeCreatedAt: secondCreatedAt,
    beforeId: secondId,
  });
});

test("audit loader rejects forged input before RPC and maps database permission denial", async () => {
  let calls = 0;
  const client = {
    from() {
      throw new Error("unexpected table access");
    },
    async rpc() {
      calls += 1;
      return { data: null, error: { message: "permission_denied" } };
    },
  } as unknown as MerchantEnterpriseStoreClient;

  await assert.rejects(
    loadMerchantEnterpriseAuditEvents(client, {
      siteId: "10000000",
      actorType: "owner",
      actorId: "not-a-uuid",
    }),
    { message: "invalid_enterprise_audit_query" },
  );
  await assert.rejects(
    loadMerchantEnterpriseAuditEvents(client, {
      siteId: "10000000",
      actorType: "employee",
      actorId: WORKSPACE_EMPLOYEE_ACTOR.actorId,
      limit: 101,
    }),
    { message: "invalid_enterprise_audit_query" },
  );
  await assert.rejects(
    loadMerchantEnterpriseAuditEvents(client, {
      siteId: "10000000",
      actorType: "employee",
      actorId: WORKSPACE_EMPLOYEE_ACTOR.actorId,
      cursor: { beforeCreatedAt: "invalid", beforeId: "invalid" },
    }),
    { message: "invalid_enterprise_audit_cursor" },
  );
  await assert.rejects(
    loadMerchantEnterpriseAuditEvents(client, {
      siteId: "10000000",
      actorType: "employee",
      actorId: WORKSPACE_EMPLOYEE_ACTOR.actorId,
      filterActorType: "owner",
      filterActorId: WORKSPACE_EMPLOYEE_ACTOR.actorId,
    }),
    { message: "invalid_enterprise_audit_query" },
  );
  await assert.rejects(
    loadMerchantEnterpriseAuditEvents(client, {
      siteId: "10000000",
      actorType: "employee",
      actorId: WORKSPACE_EMPLOYEE_ACTOR.actorId,
      createdFrom: "2026-08-02T00:00:00+00:00",
    }),
    { message: "invalid_enterprise_audit_query" },
  );
  await assert.rejects(
    loadMerchantEnterpriseAuditEvents(client, {
      siteId: "10000000",
      actorType: "employee",
      actorId: WORKSPACE_EMPLOYEE_ACTOR.actorId,
      createdFrom: "2026-08-03T00:00:00Z",
      createdToExclusive: "2026-08-02T00:00:00Z",
    }),
    { message: "invalid_enterprise_audit_query" },
  );
  assert.equal(calls, 0);

  await assert.rejects(
    loadMerchantEnterpriseAuditEvents(client, {
      siteId: "10000000",
      actorType: "employee",
      actorId: WORKSPACE_EMPLOYEE_ACTOR.actorId,
    }),
    { message: "permission_denied" },
  );
  assert.equal(calls, 1);
});

test("audit loader fails closed on secret fields, cross-merchant rows and forged cursors", async () => {
  let response: Record<string, unknown> = {
    events: [
      auditEventRow(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "2026-08-02T12:00:00.000Z",
        { before_data: { display_name: "员工", token_hash: "secret" } },
      ),
    ],
    next_cursor: null,
  };
  const client = {
    from() {
      throw new Error("unexpected table access");
    },
    async rpc() {
      return { data: response, error: null };
    },
  } as unknown as MerchantEnterpriseStoreClient;

  const invoke = () =>
    loadMerchantEnterpriseAuditEvents(client, {
      siteId: "10000000",
      actorType: "owner",
      actorId: WORKSPACE_OWNER_ACTOR.actorId,
      limit: 1,
    });
  await assert.rejects(invoke(), /enterprise_audit_read_failed:invalid_response/);

  response = {
    events: [
      auditEventRow(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "2026-08-02T12:00:00.000Z",
        { merchant_id: "20000000" },
      ),
    ],
    next_cursor: null,
  };
  await assert.rejects(invoke(), /enterprise_audit_read_failed:invalid_response/);

  response = {
    events: [
      auditEventRow(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "2026-08-02T12:00:00.000Z",
      ),
    ],
    next_cursor: {
      before_created_at: "2026-08-02T11:00:00.000Z",
      before_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    },
  };
  await assert.rejects(invoke(), /enterprise_audit_read_failed:invalid_response/);

  response = {
    events: [
      auditEventRow(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "2026-08-02T12:00:00.000Z",
      ),
    ],
    next_cursor: null,
  };
  await assert.rejects(invoke(), /enterprise_audit_read_failed:invalid_response/);

  response = {
    events: [
      auditEventRow(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "2026-08-02T12:00:00.000Z",
      ),
    ],
    next_cursor: null,
  };
  await assert.rejects(
    loadMerchantEnterpriseAuditEvents(client, {
      siteId: "10000000",
      actorType: "owner",
      actorId: WORKSPACE_OWNER_ACTOR.actorId,
      filterActorType: "employee",
      filterActorId: WORKSPACE_EMPLOYEE_ACTOR.actorId,
      createdFrom: "2026-08-02T12:00:00.001Z",
    }),
    /enterprise_audit_read_failed:invalid_response/,
  );
});

test("workflow listing requests only active rows while delegating safe projection to the authorized RPC", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    from() {
      throw new Error("unexpected table access");
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return { data: { workflows: [workflowRow()] }, error: null };
    },
  } as unknown as MerchantEnterpriseStoreClient;
  const workflows = await loadMerchantEnterpriseWorkflows(client, {
    siteId: "10000000",
    ...WORKSPACE_EMPLOYEE_ACTOR,
  });
  assert.equal(workflows.length, 1);
  assert.equal(workflows[0]?.title, "客户投诉处理");
  assert.deepEqual(calls, [
    {
      name: "faolla_list_merchant_enterprise_workflows_v1",
      args: {
        p_input: {
          merchant_id: "10000000",
          actor_type: "employee",
          actor_id: WORKSPACE_EMPLOYEE_ACTOR.actorId,
          include_archived: false,
        },
      },
    },
  ]);
});

test("legacy workflow listing can request the bounded mixed active/archive projection", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    from() {
      throw new Error("unexpected table access");
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return {
        data: { workflows: [workflowRow({ status: "archived" })] },
        error: null,
      };
    },
  } as unknown as MerchantEnterpriseStoreClient;
  const workflows = await loadMerchantEnterpriseWorkflows(client, {
    siteId: "10000000",
    ...WORKSPACE_OWNER_ACTOR,
    includeArchived: true,
  });
  assert.equal(workflows[0]?.status, "archived");
  assert.deepEqual(calls, [
    {
      name: "faolla_list_merchant_enterprise_workflows_v1",
      args: {
        p_input: {
          merchant_id: "10000000",
          actor_type: "owner",
          actor_id: WORKSPACE_OWNER_ACTOR.actorId,
          include_archived: true,
        },
      },
    },
  ]);
});

test("workflow exact lookup delegates tenant scoping and current authorization to the RPC", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const workflowId = "11111111-1111-4111-8111-111111111111";
  const client = {
    from() {
      throw new Error("exact workflow lookup must stay inside its authorized RPC");
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return {
        data: { workflow: workflowRow({ status: "archived" }) },
        error: null,
      };
    },
  } as unknown as MerchantEnterpriseStoreClient;
  const result = await loadMerchantEnterpriseWorkflowById(client, {
    siteId: "10000000",
    workflowId,
    ...WORKSPACE_EMPLOYEE_ACTOR,
  });
  assert.equal(result.id, workflowId);
  assert.equal(result.status, "archived");
  assert.deepEqual(calls, [
    {
      name: "faolla_get_merchant_enterprise_workflow_v1",
      args: {
        p_input: {
          merchant_id: "10000000",
          workflow_id: workflowId,
          actor_type: "employee",
          actor_id: WORKSPACE_EMPLOYEE_ACTOR.actorId,
        },
      },
    },
  ]);
});

test("workflow exact lookup rejects invalid ids, RPC misses, and cross-tenant responses", async () => {
  let response: { data: unknown; error: unknown } = {
    data: null,
    error: { message: "workflow_not_found" },
  };
  let calls = 0;
  const client = {
    from() {
      throw new Error("unexpected table access");
    },
    async rpc() {
      calls += 1;
      return response;
    },
  } as unknown as MerchantEnterpriseStoreClient;
  await assert.rejects(
    loadMerchantEnterpriseWorkflowById(client, {
      siteId: "10000000",
      workflowId: "not-a-workflow-id",
      ...WORKSPACE_OWNER_ACTOR,
    }),
    { message: "invalid_workflow_request" },
  );
  assert.equal(calls, 0);

  await assert.rejects(
    loadMerchantEnterpriseWorkflowById(client, {
      siteId: "10000000",
      workflowId: "11111111-1111-4111-8111-111111111111",
      ...WORKSPACE_OWNER_ACTOR,
    }),
    { message: "workflow_not_found" },
  );

  response = {
    data: { workflow: workflowRow({ merchant_id: "20000000" }) },
    error: null,
  };
  await assert.rejects(
    loadMerchantEnterpriseWorkflowById(client, {
      siteId: "10000000",
      workflowId: "11111111-1111-4111-8111-111111111111",
      ...WORKSPACE_OWNER_ACTOR,
    }),
    /enterprise_workflow_read_failed:invalid_response/,
  );
});

test("archived workflow listing preserves precise keyset cursors and strict filters", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const preciseTimestamp = "2026-08-03 08:00:00.123456+00";
  const cursorId = "33333333-3333-4333-8333-333333333333";
  const client = {
    from() {
      throw new Error("unexpected table access");
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return {
        data: {
          workflows: [workflowRow({ status: "archived" })],
          next_cursor: {
            updated_at: preciseTimestamp,
            id: cursorId,
          },
        },
        error: null,
      };
    },
  } as unknown as MerchantEnterpriseStoreClient;
  const page = await loadMerchantEnterpriseArchivedWorkflowPage(client, {
    siteId: "10000000",
    ...WORKSPACE_OWNER_ACTOR,
    limit: 20,
    cursor: { beforeUpdatedAt: preciseTimestamp, beforeId: cursorId },
    query: "客诉",
    scenario: "售后",
    tag: "紧急",
  });
  assert.equal(page.workflows.length, 1);
  assert.deepEqual(page.nextCursor, {
    beforeUpdatedAt: preciseTimestamp,
    beforeId: cursorId,
  });
  assert.deepEqual(calls, [
    {
      name: "faolla_list_merchant_enterprise_archived_workflows_v1",
      args: {
        p_input: {
          merchant_id: "10000000",
          actor_type: "owner",
          actor_id: WORKSPACE_OWNER_ACTOR.actorId,
          limit: 20,
          cursor: {
            updated_at: preciseTimestamp,
            id: cursorId,
          },
          query: "客诉",
          scenario: "售后",
          tag: "紧急",
        },
      },
    },
  ]);
});

test("archived workflow listing rejects invalid limits, cursors and response scope", async () => {
  let data: unknown = {
    workflows: [workflowRow({ status: "draft" })],
    next_cursor: null,
  };
  const client = {
    from() {
      throw new Error("unexpected table access");
    },
    async rpc() {
      return { data, error: null };
    },
  } as unknown as MerchantEnterpriseStoreClient;
  await assert.rejects(
    loadMerchantEnterpriseArchivedWorkflowPage(client, {
      siteId: "10000000",
      ...WORKSPACE_OWNER_ACTOR,
      limit: 51,
    }),
    { message: "invalid_workflow_query" },
  );
  await assert.rejects(
    loadMerchantEnterpriseArchivedWorkflowPage(client, {
      siteId: "10000000",
      ...WORKSPACE_OWNER_ACTOR,
      cursor: { beforeUpdatedAt: "bad", beforeId: "bad" },
    }),
    { message: "invalid_workflow_cursor" },
  );
  await assert.rejects(
    loadMerchantEnterpriseArchivedWorkflowPage(client, {
      siteId: "10000000",
      ...WORKSPACE_OWNER_ACTOR,
    }),
    /enterprise_workflows_read_failed:invalid_response/,
  );
  data = {
    workflows: [workflowRow({ status: "archived" })],
    next_cursor: {
      updated_at: "not-a-date",
      id: "33333333-3333-4333-8333-333333333333",
    },
  };
  await assert.rejects(
    loadMerchantEnterpriseArchivedWorkflowPage(client, {
      siteId: "10000000",
      ...WORKSPACE_OWNER_ACTOR,
    }),
    /enterprise_workflows_read_failed:invalid_response/,
  );
});

test("workflow create and save use scoped idempotent CAS RPC payloads", async () => {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const client = {
    from() {
      throw new Error("unexpected table access");
    },
    async rpc(name: string, args: Record<string, unknown>) {
      const input = args.p_input as Record<string, unknown>;
      calls.push({ name, input });
      return {
        data: {
          workflow: workflowRow({
            version: name.includes("update") ? 2 : 1,
          }),
        },
        error: null,
      };
    },
  } as unknown as MerchantEnterpriseStoreClient;
  const draft = {
    title: "客户投诉处理",
    scenario: "客户反馈商品存在问题时",
    description: "先确认事实，再给出解决方案。",
    category: "客户服务",
    tags: ["投诉", "售后"],
    steps: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        title: "记录情况",
        instruction: "记录订单号和具体问题。",
        position: 0,
      },
    ],
  };
  await createMerchantEnterpriseWorkflow(client, {
    siteId: "10000000",
    ...WORKSPACE_OWNER_ACTOR,
    ...draft,
    operationId: "workflow-create:test",
  });
  await updateMerchantEnterpriseWorkflow(client, {
    siteId: "10000000",
    ...WORKSPACE_OWNER_ACTOR,
    workflowId: "11111111-1111-4111-8111-111111111111",
    version: 1,
    action: "save",
    ...draft,
    operationId: "workflow-save:test",
  });
  assert.equal(calls[0]?.name, "faolla_create_merchant_enterprise_workflow_v1");
  assert.equal(calls[0]?.input.operation_id, "workflow-create:test");
  assert.equal(calls[1]?.name, "faolla_update_merchant_enterprise_workflow_v1");
  assert.equal(calls[1]?.input.expected_version, 1);
  assert.equal(calls[1]?.input.action, "save");
  assert.equal(calls[1]?.input.operation_id, "workflow-save:test");
});

test("workflow lifecycle actions carry only identity and CAS while failures stay actionable", async () => {
  let responseError: { message: string } | null = null;
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    from() {
      throw new Error("unexpected table access");
    },
    async rpc(_name: string, args: Record<string, unknown>) {
      calls.push(args.p_input as Record<string, unknown>);
      return responseError
        ? { data: null, error: responseError }
        : {
            data: {
              workflow: workflowRow({
                status: "published",
                version: 2,
                published_version: 1,
                published_at: "2026-08-03T09:00:00.000Z",
                has_unpublished_changes: false,
              }),
            },
            error: null,
          };
    },
  } as unknown as MerchantEnterpriseStoreClient;
  await updateMerchantEnterpriseWorkflow(client, {
    siteId: "10000000",
    ...WORKSPACE_OWNER_ACTOR,
    workflowId: "11111111-1111-4111-8111-111111111111",
    version: 1,
    action: "publish",
    operationId: "workflow-publish:test",
  });
  assert.deepEqual(Object.keys(calls[0] ?? {}).sort(), [
    "action",
    "actor_id",
    "actor_type",
    "expected_version",
    "merchant_id",
    "operation_id",
    "workflow_id",
  ]);
  responseError = { message: "enterprise_version_conflict" };
  await assert.rejects(
    updateMerchantEnterpriseWorkflow(client, {
      siteId: "10000000",
      ...WORKSPACE_OWNER_ACTOR,
      workflowId: "11111111-1111-4111-8111-111111111111",
      version: 1,
      action: "archive",
    }),
    { message: "enterprise_version_conflict" },
  );
  responseError = { message: "permission_denied" };
  await assert.rejects(
    loadMerchantEnterpriseWorkflows(client, {
      siteId: "10000000",
      ...WORKSPACE_EMPLOYEE_ACTOR,
    }),
    { message: "permission_denied" },
  );
  responseError = { message: "invalid_workflow_step" };
  await assert.rejects(
    updateMerchantEnterpriseWorkflow(client, {
      siteId: "10000000",
      ...WORKSPACE_OWNER_ACTOR,
      workflowId: "11111111-1111-4111-8111-111111111111",
      version: 1,
      action: "publish",
    }),
    { message: "invalid_workflow_payload" },
  );
});

test("workflow store rejects malformed drafts and forged responses before exposure", async () => {
  let calls = 0;
  let data: unknown = { workflows: [workflowRow({ merchant_id: "20000000" })] };
  const client = {
    from() {
      throw new Error("unexpected table access");
    },
    async rpc() {
      calls += 1;
      return { data, error: null };
    },
  } as unknown as MerchantEnterpriseStoreClient;
  await assert.rejects(
    createMerchantEnterpriseWorkflow(client, {
      siteId: "10000000",
      ...WORKSPACE_OWNER_ACTOR,
      title: "流程",
      scenario: "场景",
      description: "",
      category: "",
      tags: ["重复", "重复"],
      steps: [],
    }),
    { message: "invalid_workflow_payload" },
  );
  assert.equal(calls, 0);
  await assert.rejects(
    loadMerchantEnterpriseWorkflows(client, {
      siteId: "10000000",
      ...WORKSPACE_EMPLOYEE_ACTOR,
    }),
    /enterprise_workflows_read_failed:invalid_response/,
  );
  data = { workflows: [workflowRow({ steps: [{ id: "bad" }] })] };
  await assert.rejects(
    loadMerchantEnterpriseWorkflows(client, {
      siteId: "10000000",
      ...WORKSPACE_EMPLOYEE_ACTOR,
    }),
    /enterprise_workflows_read_failed:invalid_response/,
  );
});
