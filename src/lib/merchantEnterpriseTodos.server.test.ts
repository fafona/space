import assert from "node:assert/strict";
import test from "node:test";
import type { MerchantEnterpriseActor } from "@/lib/merchantEnterprise";
import {
  loadMerchantEnterpriseTodos,
  type MerchantEnterpriseTodoStoreClient,
} from "@/lib/merchantEnterpriseTodos.server";

const SITE_ID = "10000000";
const TASK_ID = "11111111-1111-4111-8111-111111111111";
const BOARD_ID = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-08-04T10:00:00.000Z";

const actor: Extract<MerchantEnterpriseActor, { type: "employee" }> = {
  type: "employee",
  id: "77777777-7777-4777-8777-777777777777",
  siteId: SITE_ID,
  displayName: "Employee",
  email: "employee@example.com",
  roleId: "99999999-9999-4999-8999-999999999999",
  permissions: ["enterprise.view", "tasks.view"],
  accessScope: "all",
  allowedBoardIds: [],
};

const task = {
  id: `task:${TASK_ID}`,
  entityId: TASK_ID,
  siteId: SITE_ID,
  kind: "task",
  title: "Confirm stock",
  subtitle: "Operations · In progress",
  urgency: "overdue",
  reasons: ["assigned_to_me", "overdue"],
  attentionAt: NOW,
  dueAt: NOW,
  taskId: TASK_ID,
  boardId: BOARD_ID,
  boardName: "Operations",
  priority: "urgent",
  version: 3,
};

const counts = {
  openCount: 1,
  taskCount: 1,
  overdueCount: 1,
  dueSoonCount: 0,
  acknowledgementCount: 0,
  executionCount: 0,
  feedbackCount: 0,
};

test("todo store sends the tenant actor, filter and keyset in one RPC", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client: MerchantEnterpriseTodoStoreClient = {
    async rpc(name, args) {
      calls.push({ name, args });
      return {
        data: {
          merchantId: SITE_ID,
          items: [task],
          counts,
          nextCursor: {
            category: "tasks",
            bucket: 0,
            sortAt: NOW,
            kind: "task",
            entityId: TASK_ID,
          },
        },
        error: null,
      };
    },
  };
  const inputCursor = {
    category: "tasks" as const,
    bucket: 0,
    sortAt: "2026-08-03T10:00:00.000Z",
    kind: "task" as const,
    entityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  };
  const page = await loadMerchantEnterpriseTodos(client, {
    siteId: SITE_ID,
    actor,
    category: "tasks",
    limit: 1,
    cursor: inputCursor,
  });
  assert.equal(page.items[0]?.id, `task:${TASK_ID}`);
  assert.deepEqual(calls, [
    {
      name: "faolla_list_merchant_enterprise_todos_v1",
      args: {
        p_input: {
          merchant_id: SITE_ID,
          actor_type: "employee",
          actor_id: actor.id,
          category: "tasks",
          limit: 1,
          cursor_bucket: 0,
          cursor_sort_at: inputCursor.sortAt,
          cursor_kind: "task",
          cursor_id: inputCursor.entityId,
        },
      },
    },
  ]);
});

test("todo store rejects cross-tenant, malformed and category-crossed responses", async () => {
  async function rejects(data: unknown) {
    const client: MerchantEnterpriseTodoStoreClient = {
      async rpc() {
        return { data, error: null };
      },
    };
    await assert.rejects(
      loadMerchantEnterpriseTodos(client, {
        siteId: SITE_ID,
        actor,
        category: "tasks",
      }),
      /enterprise_todos_read_failed/,
    );
  }
  await rejects({ merchantId: "20000000", items: [], counts, nextCursor: null });
  await rejects({ merchantId: SITE_ID, items: [{ ...task, boardId: "bad" }], counts, nextCursor: null });
  await rejects({
    merchantId: SITE_ID,
    items: [{ ...task, kind: "workflow_execution" }],
    counts,
    nextCursor: null,
  });
  await rejects({ merchantId: SITE_ID, items: [task, task], counts, nextCursor: null });
});

test("todo store binds a next cursor to the final row, category and requested page size", async () => {
  for (const nextCursor of [
    {
      category: "all",
      bucket: 0,
      sortAt: NOW,
      kind: "task",
      entityId: TASK_ID,
    },
    {
      category: "tasks",
      bucket: 1,
      sortAt: NOW,
      kind: "task",
      entityId: TASK_ID,
    },
    {
      category: "tasks",
      bucket: 0,
      sortAt: NOW,
      kind: "task",
      entityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
  ]) {
    const client: MerchantEnterpriseTodoStoreClient = {
      async rpc() {
        return {
          data: { merchantId: SITE_ID, items: [task], counts, nextCursor },
          error: null,
        };
      },
    };
    await assert.rejects(
      loadMerchantEnterpriseTodos(client, {
        siteId: SITE_ID,
        actor,
        category: "tasks",
        limit: 1,
      }),
      /enterprise_todos_read_failed/,
    );
  }

  const shortPage: MerchantEnterpriseTodoStoreClient = {
    async rpc() {
      return {
        data: {
          merchantId: SITE_ID,
          items: [task],
          counts,
          nextCursor: {
            category: "tasks",
            bucket: 0,
            sortAt: NOW,
            kind: "task",
            entityId: TASK_ID,
          },
        },
        error: null,
      };
    },
  };
  await assert.rejects(
    loadMerchantEnterpriseTodos(shortPage, {
      siteId: SITE_ID,
      actor,
      category: "tasks",
      limit: 2,
    }),
    /enterprise_todos_read_failed/,
  );
});

test("todo store validates request scope before making an RPC", async () => {
  let calls = 0;
  const client: MerchantEnterpriseTodoStoreClient = {
    async rpc() {
      calls += 1;
      return { data: null, error: null };
    },
  };
  await assert.rejects(
    loadMerchantEnterpriseTodos(client, { siteId: "bad", actor }),
    /invalid_enterprise_todo_query/,
  );
  await assert.rejects(
    loadMerchantEnterpriseTodos(client, {
      siteId: SITE_ID,
      actor,
      limit: 51,
    }),
    /invalid_enterprise_todo_query/,
  );
  await assert.rejects(
    loadMerchantEnterpriseTodos(client, {
      siteId: SITE_ID,
      actor,
      category: "tasks",
      cursor: {
        category: "workflows",
        bucket: 3,
        sortAt: NOW,
        kind: "workflow_acknowledgement",
        entityId: "33333333-3333-4333-8333-333333333333",
      },
    }),
    /invalid_enterprise_todo_cursor/,
  );
  assert.equal(calls, 0);
});

test("todo store maps permission, query and missing migration errors", async () => {
  async function rejects(error: unknown, pattern: RegExp) {
    const client: MerchantEnterpriseTodoStoreClient = {
      async rpc() {
        return { data: null, error };
      },
    };
    await assert.rejects(
      loadMerchantEnterpriseTodos(client, { siteId: SITE_ID, actor }),
      pattern,
    );
  }
  await rejects({ code: "P0001", message: "permission_denied" }, /permission_denied/);
  await rejects(
    { code: "P0001", message: "invalid_enterprise_todo_query" },
    /invalid_enterprise_todo_query/,
  );
  await rejects(
    {
      code: "PGRST202",
      message: "Could not find the function public.faolla_list_merchant_enterprise_todos_v1",
    },
    /enterprise_schema_unavailable/,
  );
});
