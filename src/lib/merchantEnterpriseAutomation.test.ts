import assert from "node:assert/strict";
import test from "node:test";
import {
  hasOnlyMerchantEnterpriseAutomationTemplateTokens,
  normalizeMerchantEnterpriseAutomationRule,
  normalizeMerchantEnterpriseAutomationRun,
} from "@/lib/merchantEnterpriseAutomation";

const ids = {
  rule: "11111111-1111-4111-8111-111111111111",
  board: "22222222-2222-4222-8222-222222222222",
  column: "33333333-3333-4333-8333-333333333333",
  workflow: "44444444-4444-4444-8444-444444444444",
  revision: "55555555-5555-4555-8555-555555555555",
  employee: "66666666-6666-4666-8666-666666666666",
  run: "77777777-7777-4777-8777-777777777777",
  task: "88888888-8888-4888-8888-888888888888",
};

const ruleRow = {
  id: ids.rule,
  merchant_id: "10000000",
  name: "New order handoff",
  source_type: "order",
  event_type: "created",
  from_status: null,
  to_status: null,
  board_id: ids.board,
  column_id: ids.column,
  workflow_id: ids.workflow,
  workflow_revision_id: ids.revision,
  workflow_revision_no: 3,
  task_title: "Handle order {eventRef}",
  task_description: "Move from {fromStatus} to {toStatus}",
  priority: "high",
  due_offset_minutes: 120,
  status: "paused",
  assignee_ids: [ids.employee],
  version: 4,
  enabled_at: "2026-08-04T10:00:00.000Z",
  archived_at: null,
  created_at: "2026-08-04T09:00:00.000Z",
  updated_at: "2026-08-04T10:00:00.000Z",
};

const runRow = {
  id: ids.run,
  merchant_id: "10000000",
  rule_id: ids.rule,
  rule_version: 4,
  source_type: "order",
  source_event_key: "order:1234",
  event_ref: `order-${ids.run}`,
  event_type: "created",
  from_status: null,
  to_status: null,
  status: "completed",
  task_id: ids.task,
  workflow_id: ids.workflow,
  workflow_revision_id: ids.revision,
  error_code: "",
  attempt_count: 2,
  source_event_at: "2026-08-04T10:00:00.000Z",
  completed_at: "2026-08-04T10:00:01.000Z",
  created_at: "2026-08-04T10:00:00.100Z",
};

test("automation normalizers produce bounded camel-case rule and run DTOs", () => {
  assert.deepEqual(normalizeMerchantEnterpriseAutomationRule(ruleRow), {
    id: ids.rule,
    siteId: "10000000",
    name: "New order handoff",
    sourceType: "order",
    eventType: "created",
    fromStatus: null,
    toStatus: null,
    boardId: ids.board,
    columnId: ids.column,
    workflowId: ids.workflow,
    workflowRevisionId: ids.revision,
    workflowRevisionNo: 3,
    taskTitle: "Handle order {eventRef}",
    taskDescription: "Move from {fromStatus} to {toStatus}",
    priority: "high",
    dueOffsetMinutes: 120,
    status: "paused",
    assigneeIds: [ids.employee],
    version: 4,
    enabledAt: "2026-08-04T10:00:00.000Z",
    archivedAt: null,
    createdAt: "2026-08-04T09:00:00.000Z",
    updatedAt: "2026-08-04T10:00:00.000Z",
  });
  assert.deepEqual(normalizeMerchantEnterpriseAutomationRun(runRow), {
    id: ids.run,
    siteId: "10000000",
    ruleId: ids.rule,
    ruleVersion: 4,
    sourceType: "order",
    eventRef: `order-${ids.run}`,
    eventType: "created",
    fromStatus: null,
    toStatus: null,
    status: "completed",
    taskId: ids.task,
    workflowId: ids.workflow,
    workflowRevisionId: ids.revision,
    errorCode: "",
    attemptCount: 2,
    sourceEventAt: "2026-08-04T10:00:00.000Z",
    completedAt: "2026-08-04T10:00:01.000Z",
    createdAt: "2026-08-04T10:00:00.100Z",
  });
});

test("automation rule normalizer rejects cross-source states and malformed data", () => {
  for (const value of [
    { ...ruleRow, merchant_id: "another-site" },
    { ...ruleRow, workflow_revision_id: "not-a-uuid" },
    { ...ruleRow, source_type: "booking", to_status: "pending" },
    { ...ruleRow, to_status: "pending" },
    { ...ruleRow, event_type: "status_changed", to_status: null },
    { ...ruleRow, assignee_ids: [ids.employee, ids.employee] },
    { ...ruleRow, due_offset_minutes: 525_601 },
    { ...ruleRow, enabled_at: "not-a-timestamp" },
    { ...ruleRow, status: "archived", archived_at: null },
    {
      ...ruleRow,
      status: "paused",
      archived_at: "2026-08-04T11:00:00.000Z",
    },
  ]) {
    assert.equal(normalizeMerchantEnterpriseAutomationRule(value), null);
  }
});

test("created automation runs may retain the observed destination status", () => {
  const normalized = normalizeMerchantEnterpriseAutomationRun({
    ...runRow,
    to_status: "pending",
  });

  assert.equal(normalized?.fromStatus, null);
  assert.equal(normalized?.toStatus, "pending");
  assert.equal(
    normalizeMerchantEnterpriseAutomationRun({
      ...runRow,
      from_status: "pending",
      to_status: "processing",
    }),
    null,
  );
});

test("automation rule normalizer preserves a valid soft archive timestamp", () => {
  const archivedAt = "2026-08-04T11:00:00.000Z";
  const archived = normalizeMerchantEnterpriseAutomationRule({
    ...ruleRow,
    status: "archived",
    archived_at: archivedAt,
  });
  assert.equal(archived?.status, "archived");
  assert.equal(archived?.archivedAt, archivedAt);
});

test("automation run normalizer enforces terminal result invariants", () => {
  assert.equal(
    normalizeMerchantEnterpriseAutomationRun({
      ...runRow,
      status: "failed",
      task_id: null,
      error_code: "automation_target_unavailable",
    })?.status,
    "failed",
  );
  assert.equal(
    normalizeMerchantEnterpriseAutomationRun({
      ...runRow,
      status: "processing",
      task_id: null,
      error_code: "",
      completed_at: null,
    })?.completedAt,
    null,
  );
  for (const value of [
    { ...runRow, status: "processing", task_id: ids.task, completed_at: null },
    { ...runRow, status: "processing", task_id: null, completed_at: runRow.completed_at },
    { ...runRow, status: "completed", task_id: null },
    { ...runRow, status: "failed", task_id: ids.task, error_code: "failed" },
    { ...runRow, status: "skipped", task_id: null, error_code: "" },
    { ...runRow, event_ref: "order-short" },
    { ...runRow, attempt_count: 0 },
    { ...runRow, attempt_count: 51 },
    { ...runRow, rule_version: 0 },
    { ...runRow, customer_name: "must not affect the DTO", task_id: "bad" },
  ]) {
    assert.equal(normalizeMerchantEnterpriseAutomationRun(value), null);
  }
});

test("automation templates accept only the documented non-PII tokens", () => {
  for (const value of [
    "Handle {eventRef}",
    "{fromStatus} -> {toStatus}",
    "Literal text without a token",
    "An unmatched { brace is plain text",
  ]) {
    assert.equal(hasOnlyMerchantEnterpriseAutomationTemplateTokens(value), true);
  }
  for (const value of [
    "Handle {sourceId}",
    "Handle {customer.name}",
    "Handle {unknown-token}",
    "Handle {}",
    "Handle {{eventRef}}",
  ]) {
    assert.equal(hasOnlyMerchantEnterpriseAutomationTemplateTokens(value), false);
  }
});
