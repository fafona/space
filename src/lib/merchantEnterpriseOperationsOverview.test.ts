import assert from "node:assert/strict";
import test from "node:test";

import { buildMerchantEnterpriseOperationsOverview } from "./merchantEnterpriseOperationsOverview";

const NOW = Date.parse("2026-08-18T12:00:00.000Z");

const boards = [
  { id: "board-a", name: "接待", position: 0, status: "active" as const },
  { id: "board-b", name: "交付", position: 1, status: "active" as const },
  { id: "board-off", name: "停用", position: 2, status: "archived" as const },
];

const task = (
  id: string,
  overrides: Partial<{
    boardId: string;
    assigneeIds: string[];
    archivedAt: string | null;
    completedAt: string | null;
    dueAt: string | null;
  }> = {},
) => ({
  id,
  boardId: overrides.boardId ?? "board-a",
  assigneeIds: overrides.assigneeIds ?? [],
  archivedAt: overrides.archivedAt ?? null,
  completedAt: overrides.completedAt ?? null,
  dueAt: overrides.dueAt ?? null,
});

test("builds a current as-of inventory and excludes completed, archived, and inactive-board tasks", () => {
  const overview = buildMerchantEnterpriseOperationsOverview(
    {
      boards,
      tasks: [
        task("overdue", { dueAt: "2026-08-18T11:59:59.999Z" }),
        task("due-now", { dueAt: "2026-08-18T12:00:00.000Z" }),
        task("due-soon", { boardId: "board-b", dueAt: "2026-08-25T11:59:59.999Z" }),
        task("outside-window", { dueAt: "2026-08-25T12:00:00.000Z" }),
        task("completed", {
          completedAt: "2026-08-18T10:00:00.000Z",
          dueAt: "2026-08-17T10:00:00.000Z",
        }),
        task("archived", { archivedAt: "2026-08-18T10:00:00.000Z" }),
        task("inactive", { boardId: "board-off" }),
      ],
    },
    NOW,
  );

  assert.equal(overview.openTaskCount, 4);
  assert.equal(overview.overdueTaskCount, 1);
  assert.equal(overview.dueSoonTaskCount, 2);
  assert.equal(overview.unassignedTaskCount, 4);
  assert.equal(overview.involvedBoardCount, 2);
  assert.deepEqual(
    overview.boardSummaries.map((board) => [
      board.boardId,
      board.openTaskCount,
      board.overdueTaskCount,
      board.dueSoonTaskCount,
    ]),
    [
      ["board-a", 3, 1, 1],
      ["board-b", 1, 0, 1],
    ],
  );
});

test("employee scope counts each assigned task once even when it has multiple assignees", () => {
  const overview = buildMerchantEnterpriseOperationsOverview(
    {
      boards,
      assigneeId: "employee-a",
      tasks: [
        task("shared", { assigneeIds: ["employee-a", "employee-b"] }),
        task("mine", { boardId: "board-b", assigneeIds: ["employee-a"] }),
        task("other", { assigneeIds: ["employee-b"] }),
        task("unassigned"),
      ],
    },
    NOW,
  );

  assert.equal(overview.openTaskCount, 2);
  assert.equal(overview.unassignedTaskCount, 0);
  assert.equal(overview.involvedBoardCount, 2);
});

test("uses a safe seven-day default when a due-soon window is invalid", () => {
  const overview = buildMerchantEnterpriseOperationsOverview(
    {
      boards,
      dueSoonWindowMs: 0,
      tasks: [task("within-default", { dueAt: "2026-08-24T12:00:00.000Z" })],
    },
    NOW,
  );

  assert.equal(overview.dueSoonTaskCount, 1);
});
