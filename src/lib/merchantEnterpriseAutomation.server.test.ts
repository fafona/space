import assert from "node:assert/strict";
import test from "node:test";
import type { MerchantEnterpriseActor } from "@/lib/merchantEnterprise";
import {
  archiveMerchantEnterpriseAutomationRule,
  createMerchantEnterpriseAutomationRule,
  isMerchantEnterpriseAutomationWorkerEnabled,
  loadMerchantEnterpriseAutomationRules,
  updateMerchantEnterpriseAutomationRule,
  type MerchantEnterpriseAutomationStoreClient,
} from "@/lib/merchantEnterpriseAutomation.server";

const ids = {
  rule: "11111111-1111-4111-8111-111111111111",
  board: "22222222-2222-4222-8222-222222222222",
  column: "33333333-3333-4333-8333-333333333333",
  workflow: "44444444-4444-4444-8444-444444444444",
  revision: "55555555-5555-4555-8555-555555555555",
  employee: "66666666-6666-4666-8666-666666666666",
  run: "77777777-7777-4777-8777-777777777777",
  task: "88888888-8888-4888-8888-888888888888",
  actor: "99999999-9999-4999-8999-999999999999",
};

const actor: Extract<MerchantEnterpriseActor, { type: "employee" }> = {
  type: "employee",
  id: ids.actor,
  siteId: "10000000",
  displayName: "Supervisor",
  email: "supervisor@example.com",
  roleId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  permissions: [
    "enterprise.view",
    "tasks.view",
    "tasks.create",
    "tasks.assign",
    "workflows.view",
    "automations.view",
    "automations.manage",
  ],
  accessScope: "all",
  allowedBoardIds: [],
};

const ruleRow = {
  id: ids.rule,
  merchant_id: "10000000",
  name: "New booking preparation",
  source_type: "booking",
  event_type: "status_changed",
  from_status: "active",
  to_status: "confirmed",
  board_id: ids.board,
  column_id: ids.column,
  workflow_id: ids.workflow,
  workflow_revision_id: ids.revision,
  workflow_revision_no: 2,
  task_title: "Prepare booking {eventRef}",
  task_description: "",
  priority: "normal",
  due_offset_minutes: null,
  status: "paused",
  assignee_ids: [ids.employee],
  version: 1,
  enabled_at: "2026-08-04T10:00:00.000Z",
  archived_at: null,
  created_at: "2026-08-04T10:00:00.000Z",
  updated_at: "2026-08-04T10:00:00.000Z",
};

const runRow = {
  id: ids.run,
  merchant_id: "10000000",
  rule_id: ids.rule,
  rule_version: 1,
  source_type: "booking",
  source_event_key: "booking:event-1",
  event_ref: `booking-${ids.run}`,
  event_type: "status_changed",
  from_status: "active",
  to_status: "confirmed",
  status: "completed",
  task_id: ids.task,
  workflow_id: ids.workflow,
  workflow_revision_id: ids.revision,
  error_code: "",
  attempt_count: 1,
  source_event_at: "2026-08-04T10:10:00.000Z",
  completed_at: "2026-08-04T10:10:01.000Z",
  created_at: "2026-08-04T10:10:00.100Z",
};

const draft = {
  siteId: "10000000",
  name: "New booking preparation",
  sourceType: "booking" as const,
  eventType: "status_changed" as const,
  fromStatus: "active",
  toStatus: "confirmed",
  boardId: ids.board,
  columnId: ids.column,
  workflowId: ids.workflow,
  workflowRevisionId: ids.revision,
  taskTitle: "Prepare booking {eventRef}",
  taskDescription: "",
  priority: "normal" as const,
  dueOffsetMinutes: null,
  status: "paused" as const,
  assigneeIds: [ids.employee],
  operationId: "enterprise-automation:test-1",
};

test("automation store lists tenant-scoped rules and recent runs", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client: MerchantEnterpriseAutomationStoreClient = {
    async rpc(name, args) {
      calls.push({ name, args });
      return {
        data: { merchantId: "10000000", rules: [ruleRow], runs: [runRow] },
        error: null,
      };
    },
  };
  const page = await loadMerchantEnterpriseAutomationRules(client, {
    siteId: "10000000",
    actor,
  });
  assert.deepEqual(calls, [
    {
      name: "faolla_list_merchant_enterprise_automation_rules_v1",
      args: {
        p_input: {
          merchant_id: "10000000",
          actor_type: "employee",
          actor_id: ids.actor,
        },
      },
    },
  ]);
  assert.equal(page.merchantId, "10000000");
  assert.equal(page.rules[0]?.workflowRevisionNo, 2);
  assert.equal(page.runs[0]?.eventRef, `booking-${ids.run}`);
  assert.equal(page.runs[0]?.attemptCount, 1);
});

test("automation worker gate parses only an explicit true value", () => {
  assert.equal(
    isMerchantEnterpriseAutomationWorkerEnabled({
      MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED: " TRUE ",
    }),
    true,
  );
  for (const value of [undefined, "", "1", "yes", "false"]) {
    assert.equal(
      isMerchantEnterpriseAutomationWorkerEnabled({
        MERCHANT_ENTERPRISE_AUTOMATION_WORKER_ENABLED: value,
      }),
      false,
    );
  }
});

test("automation store sends full create and CAS update RPC payloads", async () => {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const client: MerchantEnterpriseAutomationStoreClient = {
    async rpc(name, args) {
      calls.push({
        name,
        input: args.p_input as Record<string, unknown>,
      });
      return {
        data: {
          merchantId: "10000000",
          rule: name.includes("update") ? { ...ruleRow, version: 2 } : ruleRow,
        },
        error: null,
      };
    },
  };
  const created = await createMerchantEnterpriseAutomationRule(client, {
    ...draft,
    actor,
  });
  const updated = await updateMerchantEnterpriseAutomationRule(client, {
    ...draft,
    actor,
    ruleId: ids.rule,
    expectedVersion: 1,
    operationId: "enterprise-automation:test-2",
  });
  assert.equal(created.id, ids.rule);
  assert.equal(updated.version, 2);
  assert.deepEqual(calls[0], {
    name: "faolla_create_merchant_enterprise_automation_rule_v1",
    input: {
      merchant_id: "10000000",
      actor_type: "employee",
      actor_id: ids.actor,
      name: draft.name,
      source_type: "booking",
      event_type: "status_changed",
      from_status: "active",
      to_status: "confirmed",
      board_id: ids.board,
      column_id: ids.column,
      workflow_id: ids.workflow,
      workflow_revision_id: ids.revision,
      task_title: draft.taskTitle,
      task_description: "",
      priority: "normal",
      due_offset_minutes: null,
      status: "paused",
      assignee_ids: [ids.employee],
      operation_id: "enterprise-automation:test-1",
    },
  });
  assert.equal(calls[1]?.input.rule_id, ids.rule);
  assert.equal(calls[1]?.input.expected_version, 1);
  assert.equal(calls[1]?.input.operation_id, "enterprise-automation:test-2");
});

test("automation store archives through the dedicated CAS RPC and keeps archive state", async () => {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const archivedAt = "2026-08-04T11:00:00.000Z";
  const client: MerchantEnterpriseAutomationStoreClient = {
    async rpc(name, args) {
      calls.push({
        name,
        input: args.p_input as Record<string, unknown>,
      });
      return {
        data: {
          merchantId: "10000000",
          rule: {
            ...ruleRow,
            status: "archived",
            archived_at: archivedAt,
            version: 2,
          },
        },
        error: null,
      };
    },
  };
  const archived = await archiveMerchantEnterpriseAutomationRule(client, {
    siteId: "10000000",
    ruleId: ids.rule,
    expectedVersion: 1,
    operationId: "enterprise-automation:archive-1",
    actor,
  });
  assert.equal(archived.status, "archived");
  assert.equal(archived.archivedAt, archivedAt);
  assert.deepEqual(calls, [
    {
      name: "faolla_archive_merchant_enterprise_automation_rule_v1",
      input: {
        merchant_id: "10000000",
        actor_type: "employee",
        actor_id: ids.actor,
        rule_id: ids.rule,
        expected_version: 1,
        operation_id: "enterprise-automation:archive-1",
      },
    },
  ]);
});

test("automation store maps archive conflicts and rejects malformed archive responses", async () => {
  const conflict: MerchantEnterpriseAutomationStoreClient = {
    async rpc() {
      return {
        data: null,
        error: { code: "P0001", message: "automation_rule_archived" },
      };
    },
  };
  await assert.rejects(
    archiveMerchantEnterpriseAutomationRule(conflict, {
      siteId: "10000000",
      ruleId: ids.rule,
      expectedVersion: 1,
      operationId: "enterprise-automation:archive-conflict",
      actor,
    }),
    /automation_rule_archived/,
  );

  const malformed: MerchantEnterpriseAutomationStoreClient = {
    async rpc() {
      return {
        data: {
          merchantId: "10000000",
          rule: { ...ruleRow, status: "archived", archived_at: null },
        },
        error: null,
      };
    },
  };
  await assert.rejects(
    archiveMerchantEnterpriseAutomationRule(malformed, {
      siteId: "10000000",
      ruleId: ids.rule,
      expectedVersion: 1,
      operationId: "enterprise-automation:archive-malformed",
      actor,
    }),
    /enterprise_automation_write_failed/,
  );
});

test("automation store rejects malformed or cross-tenant RPC responses", async () => {
  for (const data of [
    { merchantId: "20000000", rules: [ruleRow], runs: [] },
    { merchantId: "10000000", rules: [{ ...ruleRow, id: "bad" }], runs: [] },
    { merchantId: "10000000", rules: [ruleRow, ruleRow], runs: [] },
    { merchantId: "10000000", rules: [ruleRow], runs: [{ ...runRow, task_id: null }] },
  ]) {
    const client: MerchantEnterpriseAutomationStoreClient = {
      async rpc() {
        return { data, error: null };
      },
    };
    await assert.rejects(
      loadMerchantEnterpriseAutomationRules(client, {
        siteId: "10000000",
        actor,
      }),
      /enterprise_automations_read_failed/,
    );
  }
});

test("automation store validates caller scope and maps database errors", async () => {
  let calls = 0;
  const unused: MerchantEnterpriseAutomationStoreClient = {
    async rpc() {
      calls += 1;
      return { data: null, error: null };
    },
  };
  await assert.rejects(
    loadMerchantEnterpriseAutomationRules(unused, {
      siteId: "bad",
      actor,
    }),
    /invalid_automation_query/,
  );
  assert.equal(calls, 0);

  const permission: MerchantEnterpriseAutomationStoreClient = {
    async rpc() {
      return { data: null, error: { code: "P0001", message: "permission_denied" } };
    },
  };
  await assert.rejects(
    createMerchantEnterpriseAutomationRule(permission, { ...draft, actor }),
    /permission_denied/,
  );

  const capped: MerchantEnterpriseAutomationStoreClient = {
    async rpc() {
      return {
        data: null,
        error: {
          code: "P0001",
          message: "automation_rule_limit_reached",
        },
      };
    },
  };
  await assert.rejects(
    createMerchantEnterpriseAutomationRule(capped, { ...draft, actor }),
    /automation_rule_limit_reached/,
  );

  const missing: MerchantEnterpriseAutomationStoreClient = {
    async rpc() {
      return {
        data: null,
        error: {
          code: "PGRST202",
          message: "Could not find the function in the schema cache",
        },
      };
    },
  };
  await assert.rejects(
    loadMerchantEnterpriseAutomationRules(missing, {
      siteId: "10000000",
      actor,
    }),
    /enterprise_schema_unavailable/,
  );
});
