import assert from "node:assert/strict";
import test from "node:test";
import type { MerchantEnterpriseActor } from "@/lib/merchantEnterprise";
import {
  bindMerchantTaskToPublishedWorkflow,
  loadMerchantTaskWorkflowBinding,
  type MerchantTaskWorkflowStoreClient,
} from "@/lib/merchantTaskWorkflow.server";

const SITE_ID = "10000000";
const TASK_ID = "11111111-1111-4111-8111-111111111111";
const WORKFLOW_ID = "22222222-2222-4222-8222-222222222222";
const REVISION_ID = "33333333-3333-4333-8333-333333333333";
const STEP_ID = "44444444-4444-4444-8444-444444444444";
const ITEM_ID = "55555555-5555-4555-8555-555555555555";

const actor: Extract<MerchantEnterpriseActor, { type: "employee" }> = {
  type: "employee",
  id: "77777777-7777-4777-8777-777777777777",
  siteId: SITE_ID,
  displayName: "Employee",
  email: "employee@example.com",
  roleId: "99999999-9999-4999-8999-999999999999",
  permissions: ["enterprise.view", "tasks.view", "tasks.update", "workflows.view"],
  accessScope: "all",
  allowedBoardIds: [],
};

const bindingRow = {
  merchant_id: SITE_ID,
  task_id: TASK_ID,
  workflow_id: WORKFLOW_ID,
  revision_id: REVISION_ID,
  revision_no: 2,
  title: "Damaged product",
  scenario: "A customer reports damaged goods",
  description: "Confirm the facts and resolve the complaint.",
  category: "Support",
  tags: ["complaint"],
  steps: [
    {
      id: STEP_ID,
      title: "Record the incident",
      instruction: "Record the order number and reported damage.",
      position: 0,
    },
  ],
  bound_at: "2026-08-04T10:00:00.000Z",
  generated_checklist_count: 1,
};

const itemRow = {
  id: ITEM_ID,
  merchant_id: SITE_ID,
  task_id: TASK_ID,
  text: "Record the incident",
  position: 1024,
  completed_at: null,
  archived_at: null,
  version: 1,
  created_at: "2026-08-04T10:00:00.000Z",
  updated_at: "2026-08-04T10:00:00.000Z",
};

test("task workflow store loads a tenant/task-scoped immutable binding", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client: MerchantTaskWorkflowStoreClient = {
    async rpc(name, args) {
      calls.push({ name, args });
      return {
        data: {
          merchantId: SITE_ID,
          binding: { ...bindingRow, draft: "not returned" },
        },
        error: null,
      };
    },
  };
  const binding = await loadMerchantTaskWorkflowBinding(client, {
    siteId: SITE_ID,
    taskId: TASK_ID,
    actor,
  });
  assert.deepEqual(calls, [
    {
      name: "faolla_get_merchant_task_workflow_binding_v1",
      args: {
        p_input: {
          merchant_id: SITE_ID,
          task_id: TASK_ID,
          actor_type: "employee",
          actor_id: actor.id,
        },
      },
    },
  ]);
  assert.equal(binding?.revisionId, REVISION_ID);
  assert.equal(binding?.siteId, SITE_ID);
  assert.equal(binding?.steps[0]?.instruction, bindingRow.steps[0].instruction);
  assert.equal("draft" in (binding ?? {}), false);
});

test("task workflow store distinguishes an unbound task", async () => {
  const client: MerchantTaskWorkflowStoreClient = {
    async rpc() {
      return { data: { merchantId: SITE_ID, binding: null }, error: null };
    },
  };
  assert.equal(
    await loadMerchantTaskWorkflowBinding(client, {
      siteId: SITE_ID,
      taskId: TASK_ID,
      actor,
    }),
    null,
  );
});

test("task workflow store sends CAS and idempotency fields and normalizes atomic output", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client: MerchantTaskWorkflowStoreClient = {
    async rpc(name, args) {
      calls.push({ name, args });
      return {
        data: { binding: bindingRow, created_items: [itemRow] },
        error: null,
      };
    },
  };
  const result = await bindMerchantTaskToPublishedWorkflow(client, {
    siteId: SITE_ID,
    taskId: TASK_ID,
    workflowId: WORKFLOW_ID,
    expectedTaskVersion: 7,
    expectedRevisionId: REVISION_ID,
    operationId: "task-workflow-bind:test-1",
    actor,
  });
  assert.deepEqual(calls, [
    {
      name: "faolla_bind_merchant_task_workflow_v1",
      args: {
        p_input: {
          merchant_id: SITE_ID,
          task_id: TASK_ID,
          workflow_id: WORKFLOW_ID,
          expected_task_version: 7,
          expected_revision_id: REVISION_ID,
          operation_id: "task-workflow-bind:test-1",
          actor_type: "employee",
          actor_id: actor.id,
        },
      },
    },
  ]);
  assert.equal(result.binding.generatedChecklistCount, 1);
  assert.deepEqual(result.createdChecklistItems, [
    {
      id: ITEM_ID,
      siteId: SITE_ID,
      taskId: TASK_ID,
      text: itemRow.text,
      position: 1024,
      completed: false,
      completedAt: null,
      archivedAt: null,
      version: 1,
      createdAt: itemRow.created_at,
      updatedAt: itemRow.updated_at,
    },
  ]);
});

test("task workflow store rejects partial or cross-task atomic responses", async () => {
  for (const data of [
    { binding: bindingRow, created_items: [] },
    {
      binding: { ...bindingRow, merchant_id: "20000000" },
      created_items: [itemRow],
    },
    {
      binding: bindingRow,
      created_items: [{ ...itemRow, task_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
    },
    {
      binding: { ...bindingRow, generated_checklist_count: 2 },
      created_items: [itemRow],
    },
    { binding: { ...bindingRow, revision_id: STEP_ID }, created_items: [itemRow] },
  ]) {
    const client: MerchantTaskWorkflowStoreClient = {
      async rpc() {
        return { data, error: null };
      },
    };
    await assert.rejects(
      bindMerchantTaskToPublishedWorkflow(client, {
        siteId: SITE_ID,
        taskId: TASK_ID,
        workflowId: WORKFLOW_ID,
        expectedTaskVersion: 7,
        expectedRevisionId: REVISION_ID,
        operationId: "task-workflow-bind:test-invalid",
        actor,
      }),
      /enterprise_task_workflow_request_failed/,
    );
  }
});

test("task workflow store rejects a cross-tenant binding GET response", async () => {
  const client: MerchantTaskWorkflowStoreClient = {
    async rpc() {
      return {
        data: {
          merchantId: SITE_ID,
          binding: { ...bindingRow, merchant_id: "20000000" },
        },
        error: null,
      };
    },
  };
  await assert.rejects(
    loadMerchantTaskWorkflowBinding(client, {
      siteId: SITE_ID,
      taskId: TASK_ID,
      actor,
    }),
    /enterprise_task_workflow_request_failed/,
  );
});

test("task workflow store rejects a missing or cross-tenant GET marker, including null", async () => {
  for (const data of [
    { binding: null },
    { merchantId: "20000000", binding: null },
    { merchantId: "20000000", binding: bindingRow },
  ]) {
    const client: MerchantTaskWorkflowStoreClient = {
      async rpc() {
        return { data, error: null };
      },
    };
    await assert.rejects(
      loadMerchantTaskWorkflowBinding(client, {
        siteId: SITE_ID,
        taskId: TASK_ID,
        actor,
      }),
      /enterprise_task_workflow_request_failed/,
    );
  }
});

test("task workflow store maps binding conflicts and missing migration", async () => {
  for (const code of [
    "task_workflow_already_bound",
    "task_workflow_checklist_source_exists",
  ]) {
    const conflictClient: MerchantTaskWorkflowStoreClient = {
      async rpc() {
        return {
          data: null,
          error: { code: "P0001", message: code },
        };
      },
    };
    await assert.rejects(
      bindMerchantTaskToPublishedWorkflow(conflictClient, {
        siteId: SITE_ID,
        taskId: TASK_ID,
        workflowId: WORKFLOW_ID,
        expectedTaskVersion: 7,
        expectedRevisionId: REVISION_ID,
        operationId: `task-workflow-bind:test-${code}`,
        actor,
      }),
      new RegExp(code),
    );
  }

  const missingClient: MerchantTaskWorkflowStoreClient = {
    async rpc() {
      return {
        data: null,
        error: { code: "PGRST202", message: "Could not find the function in schema cache" },
      };
    },
  };
  await assert.rejects(
    loadMerchantTaskWorkflowBinding(missingClient, {
      siteId: SITE_ID,
      taskId: TASK_ID,
      actor,
    }),
    /enterprise_schema_unavailable/,
  );
});
