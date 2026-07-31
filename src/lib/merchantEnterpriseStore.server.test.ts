import assert from "node:assert/strict";
import test from "node:test";
import {
  bootstrapMerchantEnterpriseWorkspace,
  createMerchantTaskBoard,
  createMerchantTaskColumn,
  createMerchantTask,
  loadMerchantEnterpriseSnapshot,
  moveMerchantTask,
  updateMerchantEnterpriseEmployee,
  updateMerchantTaskBoard,
  updateMerchantTaskColumn,
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

function employeeRow(version: number, invitedAt: string) {
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
    version,
    created_at: "2026-07-31T08:00:00.000Z",
    updated_at: invitedAt,
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

test("employee invite reservation uses merchant, id and version CAS while updating invited_at", async () => {
  const invitedAt = "2026-07-31T09:30:00.000Z";
  const updates: Array<Record<string, unknown>> = [];
  const filters: Array<[string, unknown]> = [];
  const client = {
    from(table: string) {
      assert.equal(table, "merchant_enterprise_employees");
      const builder = {
        update(patch: Record<string, unknown>) {
          updates.push(patch);
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return builder;
        },
        select() {
          return builder;
        },
        async maybeSingle() {
          return { data: employeeRow(8, invitedAt), error: null };
        },
      };
      return builder;
    },
    async rpc() {
      throw new Error("employee updates must not call RPCs");
    },
  } as unknown as MerchantEnterpriseStoreClient;

  const employee = await updateMerchantEnterpriseEmployee(client, {
    siteId: "10000000",
    employeeId: "77777777-7777-4777-8777-777777777777",
    version: 7,
    invitedAt,
  });

  assert.deepEqual(updates, [{ invited_at: invitedAt }]);
  assert.deepEqual(filters, [
    ["merchant_id", "10000000"],
    ["id", "77777777-7777-4777-8777-777777777777"],
    ["version", 7],
  ]);
  assert.equal(employee.version, 8);
  assert.equal(employee.invitedAt, invitedAt);
});

test("replaying an employee invite reservation with the consumed version conflicts", async () => {
  const client = {
    from() {
      const builder = {
        update() {
          return builder;
        },
        eq() {
          return builder;
        },
        select() {
          return builder;
        },
        async maybeSingle() {
          return { data: null, error: null };
        },
      };
      return builder;
    },
    async rpc() {
      throw new Error("employee updates must not call RPCs");
    },
  } as unknown as MerchantEnterpriseStoreClient;

  await assert.rejects(
    updateMerchantEnterpriseEmployee(client, {
      siteId: "10000000",
      employeeId: "77777777-7777-4777-8777-777777777777",
      version: 7,
      invitedAt: "2026-07-31T09:30:00.000Z",
    }),
    /enterprise_version_conflict/,
  );
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
  assert.equal(ranges.length, 6);
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
