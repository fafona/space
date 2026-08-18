import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeMerchantEnterpriseTodo,
  normalizeMerchantEnterpriseTodoCounts,
  normalizeMerchantEnterpriseTodoPage,
  normalizeMerchantEnterpriseTodoStorePage,
} from "@/lib/merchantEnterpriseTodos";

const SITE_ID = "10000000";
const TASK_ID = "11111111-1111-4111-8111-111111111111";
const BOARD_ID = "22222222-2222-4222-8222-222222222222";
const WORKFLOW_ID = "33333333-3333-4333-8333-333333333333";
const EXECUTION_ID = "44444444-4444-4444-8444-444444444444";
const NOW = "2026-08-04T10:00:00.000Z";

const taskTodo = {
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

const acknowledgementTodo = {
  id: `workflow_acknowledgement:${WORKFLOW_ID}`,
  entity_id: WORKFLOW_ID,
  merchant_id: SITE_ID,
  kind: "workflow_acknowledgement",
  title: "Damaged delivery",
  subtitle: "When a damaged delivery arrives",
  urgency: "normal",
  reasons: ["acknowledgement_required"],
  attention_at: NOW,
  due_at: null,
  workflow_id: WORKFLOW_ID,
  revision_no: 2,
};

const executionTodo = {
  id: `workflow_execution:${EXECUTION_ID}`,
  entityId: EXECUTION_ID,
  siteId: SITE_ID,
  kind: "workflow_execution",
  title: "Damaged delivery",
  subtitle: "Order 1001",
  urgency: "normal",
  reasons: ["execution_in_progress"],
  attentionAt: NOW,
  dueAt: null,
  workflowId: WORKFLOW_ID,
  executionId: EXECUTION_ID,
  taskId: TASK_ID,
  revisionNo: 2,
  completedSteps: 1,
  totalSteps: 3,
  version: 4,
};

const feedbackTodo = {
  id: `workflow_feedback:${EXECUTION_ID}`,
  entityId: EXECUTION_ID,
  siteId: SITE_ID,
  kind: "workflow_feedback",
  title: "Damaged delivery",
  subtitle: "Employee submitted feedback",
  urgency: "normal",
  reasons: ["feedback_open"],
  attentionAt: NOW,
  dueAt: null,
  workflowId: WORKFLOW_ID,
  executionId: EXECUTION_ID,
  revisionNo: 2,
  employeeName: "Employee",
  version: 5,
};

const counts = {
  openCount: 4,
  taskCount: 1,
  overdueCount: 1,
  dueSoonCount: 0,
  acknowledgementCount: 1,
  executionCount: 1,
  feedbackCount: 1,
};

test("todo normalizer accepts each strict discriminated item and strips foreign fields", () => {
  const task = normalizeMerchantEnterpriseTodo({ ...taskTodo, secret: "no" });
  const acknowledgement = normalizeMerchantEnterpriseTodo(acknowledgementTodo);
  const execution = normalizeMerchantEnterpriseTodo(executionTodo);
  const feedback = normalizeMerchantEnterpriseTodo(feedbackTodo);
  assert.equal(task?.kind, "task");
  assert.equal(acknowledgement?.kind, "workflow_acknowledgement");
  assert.equal(execution?.kind, "workflow_execution");
  assert.equal(feedback?.kind, "workflow_feedback");
  assert.equal("secret" in (task ?? {}), false);
});

test("non-empty task and workflow pages survive normalization and a JSON round trip", () => {
  const normalized = normalizeMerchantEnterpriseTodoPage({
    merchantId: SITE_ID,
    items: [taskTodo, acknowledgementTodo, executionTodo, feedbackTodo],
    counts,
    nextCursor: null,
  });
  assert.ok(normalized);
  assert.deepEqual(
    normalized.items.map((item) => item.entityId),
    [TASK_ID, WORKFLOW_ID, EXECUTION_ID, EXECUTION_ID],
  );

  const serialized = JSON.parse(JSON.stringify(normalized)) as unknown;
  assert.deepEqual(normalizeMerchantEnterpriseTodoPage(serialized), normalized);
});

test("todo normalizer rejects crossed ids, invalid progress, duplicate reasons and bad tenant data", () => {
  assert.equal(
    normalizeMerchantEnterpriseTodo({ ...taskTodo, id: `task:${BOARD_ID}` }),
    null,
  );
  assert.equal(
    normalizeMerchantEnterpriseTodo({
      ...executionTodo,
      completedSteps: 3,
      totalSteps: 3,
    }),
    null,
  );
  assert.equal(
    normalizeMerchantEnterpriseTodo({
      ...taskTodo,
      reasons: ["overdue", "overdue"],
    }),
    null,
  );
  assert.equal(
    normalizeMerchantEnterpriseTodo({ ...feedbackTodo, siteId: "another" }),
    null,
  );
});

test("todo counts require a coherent exact total", () => {
  assert.deepEqual(normalizeMerchantEnterpriseTodoCounts(counts), counts);
  assert.equal(
    normalizeMerchantEnterpriseTodoCounts({ ...counts, openCount: 5 }),
    null,
  );
  assert.equal(
    normalizeMerchantEnterpriseTodoCounts({ ...counts, dueSoonCount: 1 }),
    null,
  );
});

test("store page validates tenant rows, uniqueness and structured cursor", () => {
  const page = normalizeMerchantEnterpriseTodoStorePage({
    merchantId: SITE_ID,
    items: [taskTodo, acknowledgementTodo, executionTodo, feedbackTodo],
    counts,
    nextCursor: {
      category: "all",
      bucket: 2,
      sortAt: NOW,
      kind: "workflow_feedback",
      entityId: EXECUTION_ID,
    },
  });
  assert.equal(page?.merchantId, SITE_ID);
  assert.equal(page?.items.length, 4);
  assert.equal(page?.nextCursor?.kind, "workflow_feedback");

  assert.equal(
    normalizeMerchantEnterpriseTodoStorePage({
      merchantId: SITE_ID,
      items: [taskTodo, { ...taskTodo }],
      counts,
      nextCursor: null,
    }),
    null,
  );
  assert.equal(
    normalizeMerchantEnterpriseTodoStorePage({
      merchantId: "20000000",
      items: [taskTodo],
      counts,
      nextCursor: null,
    }),
    null,
  );
});

test("public page accepts only opaque string cursors", () => {
  const page = normalizeMerchantEnterpriseTodoPage({
    merchantId: SITE_ID,
    items: [taskTodo],
    counts,
    nextCursor: "eyJjdXJzb3IiOjF9",
  });
  assert.equal(page?.nextCursor, "eyJjdXJzb3IiOjF9");
  assert.equal(
    normalizeMerchantEnterpriseTodoPage({
      merchantId: SITE_ID,
      items: [taskTodo],
      counts,
      nextCursor: { bucket: 1 },
    }),
    null,
  );
});
