import assert from "node:assert/strict";
import test from "node:test";
import {
  planMerchantTaskReorder,
  type MerchantTaskOrderItem,
} from "./merchantTaskOrdering";

function task(
  id: string,
  columnId: string,
  position: number,
  createdAt = "2026-07-31T10:00:00.000Z",
): MerchantTaskOrderItem {
  return { id, columnId, position, createdAt };
}

test("same-column moves calculate indices after removing the active task", () => {
  const tasks = [
    task("a", "todo", 1_000),
    task("b", "todo", 3_000),
    task("c", "todo", 5_000),
  ];

  assert.deepEqual(
    planMerchantTaskReorder(tasks, {
      taskId: "c",
      targetColumnId: "todo",
      targetTaskId: "a",
      placement: "before",
    }),
    {
      kind: "move",
      columnId: "todo",
      targetIndex: 0,
      orderedTaskIds: ["c", "a", "b"],
    },
  );
  assert.deepEqual(
    planMerchantTaskReorder(tasks, {
      taskId: "a",
      targetColumnId: "todo",
      targetTaskId: "b",
      placement: "after",
    }),
    {
      kind: "move",
      columnId: "todo",
      targetIndex: 1,
      orderedTaskIds: ["b", "a", "c"],
    },
  );
  assert.deepEqual(
    planMerchantTaskReorder(tasks, {
      taskId: "a",
      targetColumnId: "todo",
      placement: "end",
    }),
    {
      kind: "move",
      columnId: "todo",
      targetIndex: 2,
      orderedTaskIds: ["b", "c", "a"],
    },
  );
});

test("same-column placements that preserve the final order are no-ops", () => {
  const tasks = [
    task("a", "todo", 1_000),
    task("b", "todo", 3_000),
    task("c", "todo", 5_000),
  ];

  assert.deepEqual(
    planMerchantTaskReorder(tasks, {
      taskId: "b",
      targetColumnId: "todo",
      targetTaskId: "c",
      placement: "before",
    }),
    { kind: "noop" },
  );
  assert.deepEqual(
    planMerchantTaskReorder(tasks, {
      taskId: "b",
      targetColumnId: "todo",
      targetTaskId: "a",
      placement: "after",
    }),
    { kind: "noop" },
  );
});

test("cross-column moves support before, after and end placements", () => {
  const tasks = [
    task("source", "todo", 2_000),
    task("x", "doing", 1_000),
    task("y", "doing", 5_000),
  ];

  assert.deepEqual(
    planMerchantTaskReorder(tasks, {
      taskId: "source",
      targetColumnId: "doing",
      targetTaskId: "y",
      placement: "before",
    }),
    {
      kind: "move",
      columnId: "doing",
      targetIndex: 1,
      orderedTaskIds: ["x", "source", "y"],
    },
  );
  assert.deepEqual(
    planMerchantTaskReorder(tasks, {
      taskId: "source",
      targetColumnId: "doing",
      targetTaskId: "x",
      placement: "after",
    }),
    {
      kind: "move",
      columnId: "doing",
      targetIndex: 1,
      orderedTaskIds: ["x", "source", "y"],
    },
  );
  assert.deepEqual(
    planMerchantTaskReorder(tasks, {
      taskId: "source",
      targetColumnId: "doing",
      placement: "end",
    }),
    {
      kind: "move",
      columnId: "doing",
      targetIndex: 2,
      orderedTaskIds: ["x", "y", "source"],
    },
  );
});

test("moving into an empty column produces index zero", () => {
  assert.deepEqual(
    planMerchantTaskReorder([task("source", "todo", 2_000)], {
      taskId: "source",
      targetColumnId: "doing",
      placement: "end",
    }),
    {
      kind: "move",
      columnId: "doing",
      targetIndex: 0,
      orderedTaskIds: ["source"],
    },
  );
});

test("position collisions are ordered by creation time and then id without mutating input", () => {
  const tasks = [
    task("z", "doing", 1_000, "2026-07-31T12:00:00.000Z"),
    task("b", "doing", 1_000, "2026-07-31T10:00:00.000Z"),
    task("source", "todo", 50),
    task("a", "doing", 1_000, "2026-07-31T10:00:00.000Z"),
  ];
  const originalIds = tasks.map((item) => item.id);

  assert.deepEqual(
    planMerchantTaskReorder(tasks, {
      taskId: "source",
      targetColumnId: "doing",
      placement: "end",
    }),
    {
      kind: "move",
      columnId: "doing",
      targetIndex: 3,
      orderedTaskIds: ["a", "b", "z", "source"],
    },
  );
  assert.deepEqual(tasks.map((item) => item.id), originalIds);
});

test("missing tasks and targets outside the requested column are invalid", () => {
  const tasks = [
    task("a", "todo", 1_000),
    task("b", "doing", 2_000),
  ];

  assert.deepEqual(
    planMerchantTaskReorder(tasks, {
      taskId: "missing",
      targetColumnId: "todo",
      placement: "end",
    }),
    { kind: "invalid" },
  );
  assert.deepEqual(
    planMerchantTaskReorder(tasks, {
      taskId: "a",
      targetColumnId: "todo",
      placement: "before",
    }),
    { kind: "invalid" },
  );
  assert.deepEqual(
    planMerchantTaskReorder(tasks, {
      taskId: "a",
      targetColumnId: "todo",
      targetTaskId: "missing",
      placement: "before",
    }),
    { kind: "invalid" },
  );
  assert.deepEqual(
    planMerchantTaskReorder(tasks, {
      taskId: "a",
      targetColumnId: "todo",
      targetTaskId: "b",
      placement: "before",
    }),
    { kind: "invalid" },
  );
  assert.deepEqual(
    planMerchantTaskReorder(tasks, {
      taskId: "a",
      targetColumnId: "todo",
      targetTaskId: "b",
      placement: "end",
    }),
    { kind: "invalid" },
  );
});

test("dropping a task on itself is a no-op only within its current column", () => {
  const tasks = [task("a", "todo", 1_000)];

  assert.deepEqual(
    planMerchantTaskReorder(tasks, {
      taskId: "a",
      targetColumnId: "todo",
      targetTaskId: "a",
      placement: "before",
    }),
    { kind: "noop" },
  );
  assert.deepEqual(
    planMerchantTaskReorder(tasks, {
      taskId: "a",
      targetColumnId: "doing",
      targetTaskId: "a",
      placement: "before",
    }),
    { kind: "invalid" },
  );
});
