import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMerchantEnterpriseCurrentOperationsAuthorizationFingerprint,
  buildMerchantEnterpriseCurrentOperationsFallback,
  buildMerchantEnterpriseCurrentOperationsRequestKey,
  normalizeMerchantEnterpriseCurrentOperations,
} from "./merchantEnterpriseCurrentOperations";

type FingerprintActor = Parameters<
  typeof buildMerchantEnterpriseCurrentOperationsAuthorizationFingerprint
>[0];

function response(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    asOf: "2026-08-19T10:00:00.000Z",
    scope: "enterprise",
    employeeId: null,
    scopeRestricted: false,
    boardSummaryTotalCount: 1,
    boardsTruncated: false,
    summary: {
      openTaskCount: 2,
      overdueTaskCount: 1,
      dueSoonTaskCount: 1,
      unassignedTaskCount: 1,
      involvedBoardCount: 1,
      sharedAssignmentTaskCount: null,
    },
    boards: [
      {
        boardId: "10000000-0000-4000-8000-000000000001",
        boardName: "交付",
        openTaskCount: 2,
        overdueTaskCount: 1,
        dueSoonTaskCount: 1,
      },
    ],
    priorityTasks: [
      {
        id: "20000000-0000-4000-8000-000000000001",
        boardId: "10000000-0000-4000-8000-000000000001",
        boardName: "交付",
        columnId: "30000000-0000-4000-8000-000000000001",
        columnName: "进行中",
        title: "确认物料",
        priority: "high",
        dueAt: "2026-08-20T12:00:00.000Z",
        updatedAt: "2026-08-19T09:00:00.000Z",
        assigneeCount: 2,
      },
      {
        id: "20000000-0000-4000-8000-000000000002",
        boardId: "10000000-0000-4000-8000-000000000001",
        boardName: "交付",
        columnId: "30000000-0000-4000-8000-000000000001",
        columnName: "进行中",
        title: "安排发货",
        priority: "normal",
        dueAt: null,
        updatedAt: "2026-08-19T08:00:00.000Z",
        assigneeCount: 2,
      },
    ],
    ...overrides,
  };
}

test("authorization fingerprints invalidate cached scopes without depending on array order", () => {
  const actor: FingerprintActor = {
    type: "employee",
    id: "40000000-0000-4000-8000-000000000001",
    accessScope: "all",
    allowedBoardIds: [],
    permissions: ["employees.view", "tasks.view", "enterprise.view"],
  };
  const allScope = buildMerchantEnterpriseCurrentOperationsAuthorizationFingerprint(actor);
  const restrictedA = buildMerchantEnterpriseCurrentOperationsAuthorizationFingerprint({
    ...actor,
    accessScope: "restricted",
    allowedBoardIds: [
      "10000000-0000-4000-8000-000000000002",
      "10000000-0000-4000-8000-000000000001",
    ],
  });
  const restrictedAReordered =
    buildMerchantEnterpriseCurrentOperationsAuthorizationFingerprint({
      ...actor,
      accessScope: "restricted",
      allowedBoardIds: [
        "10000000-0000-4000-8000-000000000001",
        "10000000-0000-4000-8000-000000000002",
      ],
      permissions: ["enterprise.view", "tasks.view", "employees.view"],
    });
  const restrictedB = buildMerchantEnterpriseCurrentOperationsAuthorizationFingerprint({
    ...actor,
    accessScope: "restricted",
    allowedBoardIds: ["10000000-0000-4000-8000-000000000003"],
  });
  const tasksRevoked = buildMerchantEnterpriseCurrentOperationsAuthorizationFingerprint({
    ...actor,
    permissions: ["enterprise.view", "employees.view"],
  });
  const employeesRevoked = buildMerchantEnterpriseCurrentOperationsAuthorizationFingerprint({
    ...actor,
    permissions: ["enterprise.view", "tasks.view"],
  });

  assert.notEqual(allScope, restrictedA);
  assert.equal(restrictedA, restrictedAReordered);
  assert.notEqual(restrictedA, restrictedB);
  assert.notEqual(allScope, tasksRevoked);
  assert.notEqual(allScope, employeesRevoked);

  const requestKey = (fingerprint: string) =>
    buildMerchantEnterpriseCurrentOperationsRequestKey({
      siteId: "10000000",
      actorAuthorizationFingerprint: fingerprint,
      scope: "employee",
      employeeId: actor.id,
    });
  assert.notEqual(requestKey(allScope), requestKey(restrictedA));
  assert.notEqual(requestKey(restrictedA), requestKey(restrictedB));
  assert.notEqual(requestKey(allScope), requestKey(tasksRevoked));
  assert.notEqual(requestKey(allScope), requestKey(employeesRevoked));
});

test("rollout fallback uses only the authorized snapshot and preserves current inventory semantics", () => {
  const employeeId = "40000000-0000-4000-8000-000000000001";
  const boardId = "10000000-0000-4000-8000-000000000001";
  const columnId = "30000000-0000-4000-8000-000000000001";
  const nowMs = Date.parse("2026-08-19T10:00:00.000Z");
  const input = {
    boards: [
      { id: boardId, name: "交付", position: 0, status: "active" as const },
    ],
    columns: [{ id: columnId, boardId, name: "进行中" }],
    tasks: [
      {
        id: "20000000-0000-4000-8000-000000000001",
        boardId,
        columnId,
        title: "已逾期的协作任务",
        priority: "urgent" as const,
        dueAt: "2026-08-19T09:59:59.000Z",
        updatedAt: "2026-08-19T09:30:00.000Z",
        archivedAt: null,
        completedAt: null,
        assigneeIds: [employeeId, "40000000-0000-4000-8000-000000000002"],
      },
      {
        id: "20000000-0000-4000-8000-000000000002",
        boardId,
        columnId,
        title: "七日边界外任务",
        priority: "normal" as const,
        dueAt: "2026-08-26T10:00:00.000Z",
        updatedAt: "2026-08-19T08:30:00.000Z",
        archivedAt: null,
        completedAt: null,
        assigneeIds: [],
      },
    ],
  };

  const owner = buildMerchantEnterpriseCurrentOperationsFallback(
    {
      actor: { type: "owner", id: "10000000", accessScope: "all" },
      ...input,
    },
    nowMs,
  );
  assert.ok(normalizeMerchantEnterpriseCurrentOperations(owner));
  assert.deepEqual(owner.summary, {
    openTaskCount: 2,
    overdueTaskCount: 1,
    dueSoonTaskCount: 0,
    unassignedTaskCount: 1,
    involvedBoardCount: 1,
    sharedAssignmentTaskCount: null,
  });

  const employee = buildMerchantEnterpriseCurrentOperationsFallback(
    {
      actor: { type: "employee", id: employeeId, accessScope: "restricted" },
      ...input,
    },
    nowMs,
  );
  assert.ok(normalizeMerchantEnterpriseCurrentOperations(employee));
  assert.equal(employee.scope, "employee");
  assert.equal(employee.scopeRestricted, true);
  assert.equal(employee.summary.openTaskCount, 1);
  assert.equal(employee.summary.sharedAssignmentTaskCount, 1);
  assert.equal(employee.priorityTasks[0]?.title, "已逾期的协作任务");
});

test("normalizes the frozen current-operations response contract", () => {
  assert.deepEqual(
    normalizeMerchantEnterpriseCurrentOperations(response()),
    response(),
  );
  const employeeResponse = response({
    scope: "employee",
    employeeId: "40000000-0000-4000-8000-000000000001",
    summary: {
      ...response().summary as Record<string, unknown>,
      unassignedTaskCount: null,
      sharedAssignmentTaskCount: 1,
    },
  });
  assert.deepEqual(
    normalizeMerchantEnterpriseCurrentOperations(employeeResponse),
    employeeResponse,
  );
  const unicodeResponse = response({
    boards: [
      {
        ...(response().boards as Record<string, unknown>[])[0],
        boardName: "😀".repeat(120),
      },
    ],
  });
  assert.ok(normalizeMerchantEnterpriseCurrentOperations(unicodeResponse));
});

test("rejects inconsistent scope, counts, timestamps, and truncation metadata", () => {
  for (const candidate of [
    response({ employeeId: "not-a-uuid" }),
    response({ employeeId: "40000000-0000-4000-8000-000000000001" }),
    response({ scope: "employee", employeeId: null }),
    response({ asOf: "08/19/2026" }),
    response({ boardSummaryTotalCount: 0 }),
    response({ boardsTruncated: true }),
    response({
      summary: {
        ...response().summary as Record<string, unknown>,
        unassignedTaskCount: -1,
      },
    }),
    response({
      summary: {
        ...response().summary as Record<string, unknown>,
        overdueTaskCount: 3,
      },
    }),
  ]) {
    assert.equal(normalizeMerchantEnterpriseCurrentOperations(candidate), null);
  }
});

test("rejects duplicate, oversized, or malformed result rows", () => {
  const base = response();
  const board = (base.boards as Record<string, unknown>[])[0];
  const task = (base.priorityTasks as Record<string, unknown>[])[0];
  assert.equal(
    normalizeMerchantEnterpriseCurrentOperations(
      response({
        boardSummaryTotalCount: 2,
        boards: [board, board],
      }),
    ),
    null,
  );
  assert.equal(
    normalizeMerchantEnterpriseCurrentOperations(
      response({
        boardSummaryTotalCount: 2,
        boardsTruncated: true,
        summary: {
          ...response().summary as Record<string, unknown>,
          openTaskCount: 1,
        },
      }),
    ),
    null,
  );
  assert.equal(
    normalizeMerchantEnterpriseCurrentOperations(
      response({ priorityTasks: [task, task] }),
    ),
    null,
  );
  assert.equal(
    normalizeMerchantEnterpriseCurrentOperations(
      response({ priorityTasks: [task] }),
    ),
    null,
  );
  assert.equal(
    normalizeMerchantEnterpriseCurrentOperations(
      response({
        boardSummaryTotalCount: 101,
        boardsTruncated: true,
      }),
    ),
    null,
  );
  assert.equal(
    normalizeMerchantEnterpriseCurrentOperations(
      response({
        priorityTasks: Array.from({ length: 7 }, (_, index) => ({
          ...task,
          id: `20000000-0000-4000-8000-${String(index + 2).padStart(12, "0")}`,
        })),
      }),
    ),
    null,
  );
  assert.equal(
    normalizeMerchantEnterpriseCurrentOperations(
      response({
        priorityTasks: [{ ...task, priority: "critical" }],
      }),
    ),
    null,
  );
});
