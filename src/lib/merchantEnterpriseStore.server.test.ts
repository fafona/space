import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  createMerchantTask,
  loadMerchantEnterpriseSnapshot,
  updateMerchantEnterpriseEmployee,
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

test("bootstrap uses stable system-key upserts and rechecks every default column", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src", "lib", "merchantEnterpriseStore.server.ts"),
    "utf8",
  );
  assert.match(source, /onConflict:\s*"merchant_id,system_key"/);
  assert.match(source, /onConflict:\s*"merchant_id,board_id,system_key"/);
  assert.match(source, /DEFAULT_COLUMN_SYSTEM_KEYS\.some\(\(key\) => !columnKeys\.has\(key\)\)/);
  assert.match(source, /return loadMerchantEnterpriseSnapshot\(client, siteId\)/);
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
