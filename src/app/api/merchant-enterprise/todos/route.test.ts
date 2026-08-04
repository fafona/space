import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeMerchantEnterpriseTodoCursor,
  handleMerchantEnterpriseTodosGet,
  parseMerchantEnterpriseTodoCursor,
  type MerchantEnterpriseTodoRouteDependencies,
} from "@/app/api/merchant-enterprise/todos/route";
import type { MerchantEnterpriseActor } from "@/lib/merchantEnterprise";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import type {
  MerchantEnterpriseTodoCursor,
  MerchantEnterpriseTodoStorePage,
} from "@/lib/merchantEnterpriseTodos";

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

const cursor: MerchantEnterpriseTodoCursor = {
  category: "tasks",
  bucket: 0,
  sortAt: NOW,
  kind: "task",
  entityId: TASK_ID,
};

const page: MerchantEnterpriseTodoStorePage = {
  merchantId: SITE_ID,
  items: [
    {
      id: `task:${TASK_ID}`,
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
    },
  ],
  counts: {
    openCount: 1,
    taskCount: 1,
    overdueCount: 1,
    dueSoonCount: 0,
    acknowledgementCount: 0,
    executionCount: 0,
    feedbackCount: 0,
  },
  nextCursor: cursor,
};

function dependencies(
  overrides: Partial<MerchantEnterpriseTodoRouteDependencies> = {},
): MerchantEnterpriseTodoRouteDependencies {
  return {
    async resolveActor() {
      return actor;
    },
    async requireEnterpriseEntitlement() {
      return {};
    },
    async loadTodos() {
      return page;
    },
    ...overrides,
  };
}

test("todo cursor is opaque, canonical, category-bound and round-trips", () => {
  const encoded = encodeMerchantEnterpriseTodoCursor(cursor);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(parseMerchantEnterpriseTodoCursor(encoded, "tasks"), cursor);
  assert.throws(
    () => parseMerchantEnterpriseTodoCursor(encoded, "all"),
    /invalid_enterprise_todo_cursor/,
  );
  assert.throws(
    () => parseMerchantEnterpriseTodoCursor(`${encoded}=`, "tasks"),
    /invalid_enterprise_todo_cursor/,
  );
});

test("todo GET authorizes enterprise access, checks entitlement and returns an opaque cursor", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const response = await handleMerchantEnterpriseTodosGet(
    new Request(
      `https://www.faolla.com/api/merchant-enterprise/todos?siteId=${SITE_ID}&category=tasks&limit=1`,
    ),
    dependencies({
      async resolveActor(_request, input) {
        calls.push({ resolve: input });
        return actor;
      },
      async requireEnterpriseEntitlement(siteId) {
        calls.push({ entitlement: siteId });
        return {};
      },
      async loadTodos(input) {
        calls.push({ load: input });
        return page;
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.merchantId, SITE_ID);
  assert.deepEqual(body.items, page.items);
  assert.deepEqual(body.counts, page.counts);
  assert.deepEqual(parseMerchantEnterpriseTodoCursor(body.nextCursor, "tasks"), cursor);
  assert.deepEqual(calls, [
    { resolve: { siteId: SITE_ID, requiredPermission: "enterprise.view" } },
    { entitlement: SITE_ID },
    {
      load: {
        siteId: SITE_ID,
        category: "tasks",
        limit: 1,
        cursor: null,
        actor,
      },
    },
  ]);
});

test("todo GET forwards a validated cursor and defaults category and limit", async () => {
  const token = encodeMerchantEnterpriseTodoCursor({ ...cursor, category: "all" });
  let received: Record<string, unknown> | null = null;
  const response = await handleMerchantEnterpriseTodosGet(
    new Request(
      `https://www.faolla.com/api/merchant-enterprise/todos?siteId=${SITE_ID}&cursor=${token}`,
    ),
    dependencies({
      async loadTodos(input) {
        received = input;
        return { ...page, nextCursor: null };
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.ok(received);
  const receivedInput = received as Record<string, unknown>;
  assert.equal(receivedInput.category, "all");
  assert.equal(receivedInput.limit, 20);
  assert.deepEqual(receivedInput.cursor, { ...cursor, category: "all" });
});

test("todo GET rejects unknown, duplicate, padded and invalid query values before auth", async () => {
  const urls = [
    "https://www.faolla.com/api/merchant-enterprise/todos",
    `https://www.faolla.com/api/merchant-enterprise/todos?siteId=${SITE_ID}&siteId=${SITE_ID}`,
    `https://www.faolla.com/api/merchant-enterprise/todos?siteId=%20${SITE_ID}%20`,
    `https://www.faolla.com/api/merchant-enterprise/todos?siteId=${SITE_ID}&category=other`,
    `https://www.faolla.com/api/merchant-enterprise/todos?siteId=${SITE_ID}&limit=0`,
    `https://www.faolla.com/api/merchant-enterprise/todos?siteId=${SITE_ID}&limit=51`,
    `https://www.faolla.com/api/merchant-enterprise/todos?siteId=${SITE_ID}&cursor=`,
    `https://www.faolla.com/api/merchant-enterprise/todos?siteId=${SITE_ID}&cursor=bad!`,
    `https://www.faolla.com/api/merchant-enterprise/todos?siteId=${SITE_ID}&status=open`,
  ];
  let authCalls = 0;
  const deps = dependencies({
    async resolveActor() {
      authCalls += 1;
      return actor;
    },
  });
  for (const url of urls) {
    const response = await handleMerchantEnterpriseTodosGet(
      new Request(url),
      deps,
    );
    assert.equal(response.status, 400, url);
    assert.equal((await response.json()).ok, false);
  }
  assert.equal(authCalls, 0);
});

test("todo GET stops before storage on access or entitlement failures", async () => {
  let storeCalls = 0;
  const url = `https://www.faolla.com/api/merchant-enterprise/todos?siteId=${SITE_ID}`;
  const forbidden = await handleMerchantEnterpriseTodosGet(
    new Request(url),
    dependencies({
      async resolveActor() {
        throw new MerchantEnterpriseAccessError("permission_denied", 403);
      },
      async loadTodos() {
        storeCalls += 1;
        return page;
      },
    }),
  );
  assert.equal(forbidden.status, 403);

  const disabled = await handleMerchantEnterpriseTodosGet(
    new Request(url),
    dependencies({
      async requireEnterpriseEntitlement() {
        throw new MerchantEnterpriseAccessError(
          "enterprise_management_disabled",
          403,
        );
      },
      async loadTodos() {
        storeCalls += 1;
        return page;
      },
    }),
  );
  assert.equal(disabled.status, 403);
  assert.equal(storeCalls, 0);
});

test("todo GET rejects a cross-tenant store marker and maps unavailable schema", async () => {
  const url = `https://www.faolla.com/api/merchant-enterprise/todos?siteId=${SITE_ID}`;
  const crossed = await handleMerchantEnterpriseTodosGet(
    new Request(url),
    dependencies({
      async loadTodos() {
        return { ...page, merchantId: "20000000" };
      },
    }),
  );
  assert.equal(crossed.status, 503);
  assert.deepEqual(await crossed.json(), {
    ok: false,
    error: "enterprise_request_failed",
  });

  const unavailable = await handleMerchantEnterpriseTodosGet(
    new Request(url),
    dependencies({
      async loadTodos() {
        throw new Error("enterprise_schema_unavailable");
      },
    }),
  );
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {
    ok: false,
    error: "enterprise_schema_unavailable",
  });
});
