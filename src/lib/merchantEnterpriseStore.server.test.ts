import assert from "node:assert/strict";
import test from "node:test";
import {
  addMerchantTaskComment,
  bootstrapMerchantEnterpriseWorkspace,
  createMerchantEnterpriseEmployee,
  createMerchantEnterpriseRole,
  createMerchantTaskChecklistItem,
  createMerchantTaskBoard,
  createMerchantTaskColumn,
  createMerchantTask,
  loadMerchantEnterpriseSnapshot,
  loadMerchantTaskChecklistItems,
  loadMerchantTaskEvents,
  loadMerchantTaskBoardIdForAccess,
  moveMerchantTask,
  updateMerchantEnterpriseEmployee,
  updateMerchantEnterpriseRole,
  updateMerchantTaskBoard,
  updateMerchantTaskColumn,
  updateMerchantTaskChecklistItem,
  updateMerchantTask,
  type MerchantEnterpriseStoreClient,
} from "@/lib/merchantEnterpriseStore.server";

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

test("employee RPC failures preserve lifecycle conflict and authorization codes", async () => {
  for (const code of [
    "enterprise_version_conflict",
    "employee_not_found",
    "employee_open_tasks_require_resolution",
    "employee_offboarding_replacement_invalid",
    "employee_offboarding_scope_denied",
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
      const isCreate = functionName === "faolla_create_merchant_enterprise_role_v1";
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
  });
  const updated = await updateMerchantEnterpriseRole(client, {
    siteId: "10000000",
    roleId: created.id,
    version: created.version,
    accessScope: "restricted",
    allowedBoardIds: [boardId],
  });

  assert.equal(created.accessScope, "restricted");
  assert.deepEqual(created.allowedBoardIds, [boardId]);
  assert.equal(updated.version, 2);
  assert.deepEqual(calls, [
    {
      functionName: "faolla_create_merchant_enterprise_role_v1",
      input: {
        merchant_id: "10000000",
        name: "Staff",
        description: "",
        permissions: ["enterprise.view", "tasks.view"],
        access_scope: "restricted",
        allowed_board_ids: [boardId],
      },
    },
    {
      functionName: "faolla_update_merchant_enterprise_role_v1",
      input: {
        merchant_id: "10000000",
        role_id: created.id,
        expected_version: 1,
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
      }),
      new RegExp(code),
    );
  }
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
    name: "Operations",
    description: "Daily work",
    position: 2,
    operationId: "board-create-1",
  });
  const column = await createMerchantTaskColumn(client, {
    siteId: "10000000",
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
    boardId: "22222222-2222-4222-8222-222222222222",
    version: 7,
    status: "archived",
    position: 4,
    operationId: "board-update-1",
  });
  const column = await updateMerchantTaskColumn(client, {
    siteId: "10000000",
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
      name: "Overflow",
      operationId: "board-create-limit",
    }),
    /board_limit_reached/,
  );
  await assert.rejects(
    updateMerchantTaskColumn(makeClient("enterprise_version_conflict"), {
      siteId: "10000000",
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
      boardId: "22222222-2222-4222-8222-222222222222",
      name: "Invalid",
      operationId: "column-create-invalid",
    }),
    /invalid_column_color/,
  );
  await assert.rejects(
    updateMerchantTaskColumn(makeClient("invalid_column_done_state"), {
      siteId: "10000000",
      boardId: "22222222-2222-4222-8222-222222222222",
      columnId: "33333333-3333-4333-8333-333333333333",
      version: 2,
      isDone: true,
      operationId: "column-update-done-state",
    }),
    /invalid_column_is_done/,
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
  assert.equal(task.assigneeIds.length, 2);
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

  const snapshot = await bootstrapMerchantEnterpriseWorkspace(
    client,
    "10000000",
    "bootstrap-1",
  );

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
      assigneeIds: ["22222222-2222-4222-8222-222222222222"],
      operationId: "task-assignment-scope-1",
    }),
    /task_assignee_board_access_denied/,
  );
});
