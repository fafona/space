import assert from "node:assert/strict";
import test from "node:test";
import {
  handleMerchantTaskWorkflowGet,
  handleMerchantTaskWorkflowPost,
  type MerchantTaskWorkflowRouteDependencies,
} from "@/app/api/merchant-enterprise/task-workflow/route";
import type { MerchantEnterpriseActor } from "@/lib/merchantEnterprise";
import type {
  MerchantTaskWorkflowBinding,
  MerchantTaskWorkflowChecklistItem,
} from "@/lib/merchantTaskWorkflow";

const SITE_ID = "10000000";
const TASK_ID = "11111111-1111-4111-8111-111111111111";
const WORKFLOW_ID = "22222222-2222-4222-8222-222222222222";
const REVISION_ID = "33333333-3333-4333-8333-333333333333";

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

const binding: MerchantTaskWorkflowBinding = {
  siteId: SITE_ID,
  taskId: TASK_ID,
  workflowId: WORKFLOW_ID,
  revisionId: REVISION_ID,
  revisionNo: 2,
  title: "Damaged product",
  scenario: "A customer reports damaged goods",
  description: "Confirm the facts and resolve the complaint.",
  category: "Support",
  tags: ["complaint"],
  steps: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      title: "Record the incident",
      instruction: "Record the order number and damage.",
      position: 0,
    },
  ],
  boundAt: "2026-08-04T10:00:00.000Z",
  generatedChecklistCount: 1,
};

const item: MerchantTaskWorkflowChecklistItem = {
  id: "55555555-5555-4555-8555-555555555555",
  siteId: SITE_ID,
  taskId: TASK_ID,
  text: "Record the incident",
  position: 1024,
  completed: false,
  completedAt: null,
  archivedAt: null,
  version: 1,
  createdAt: "2026-08-04T10:00:00.000Z",
  updatedAt: "2026-08-04T10:00:00.000Z",
};

function dependencies(
  overrides: Partial<MerchantTaskWorkflowRouteDependencies> = {},
): MerchantTaskWorkflowRouteDependencies {
  return {
    async resolveActor() {
      return actor;
    },
    async requireEnterpriseEntitlement() {
      return {};
    },
    async loadBinding() {
      return binding;
    },
    async bindWorkflow() {
      return { binding, createdChecklistItems: [item] };
    },
    ...overrides,
  };
}

function mutationRequest(body: unknown, origin = "https://www.faolla.com") {
  return new Request(
    "https://www.faolla.com/api/merchant-enterprise/task-workflow",
    {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(body),
    },
  );
}

const validBody = {
  siteId: SITE_ID,
  taskId: TASK_ID,
  workflowId: WORKFLOW_ID,
  expectedTaskVersion: 7,
  expectedRevisionId: REVISION_ID,
  operationId: "task-workflow-bind:route-test",
};

test("task workflow GET requires both read permissions and returns a binding", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const response = await handleMerchantTaskWorkflowGet(
    new Request(
      `https://www.faolla.com/api/merchant-enterprise/task-workflow?siteId=${SITE_ID}&taskId=${TASK_ID}`,
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
      async loadBinding(input) {
        calls.push({ load: input });
        return binding;
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { ok: true, binding });
  assert.deepEqual(calls, [
    { resolve: { siteId: SITE_ID, requiredPermission: "tasks.view" } },
    { entitlement: SITE_ID },
    { load: { siteId: SITE_ID, taskId: TASK_ID, actor } },
  ]);
});

test("task workflow GET returns null for an authorized unbound task", async () => {
  const response = await handleMerchantTaskWorkflowGet(
    new Request(
      `https://www.faolla.com/api/merchant-enterprise/task-workflow?siteId=${SITE_ID}&taskId=${TASK_ID}`,
    ),
    dependencies({
      async loadBinding() {
        return null;
      },
    }),
  );
  assert.deepEqual(await response.json(), { ok: true, binding: null });
});

test("task workflow POST requires update plus workflow view and forwards CAS fields", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const response = await handleMerchantTaskWorkflowPost(
    mutationRequest(validBody),
    dependencies({
      async resolveActor(_request, input) {
        calls.push({ resolve: input });
        return actor;
      },
      async requireEnterpriseEntitlement(siteId) {
        calls.push({ entitlement: siteId });
        return {};
      },
      async bindWorkflow(input) {
        calls.push({ bind: input });
        return { binding, createdChecklistItems: [item] };
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    binding,
    createdChecklistItems: [item],
  });
  assert.deepEqual(calls, [
    { resolve: { siteId: SITE_ID, requiredPermission: "tasks.update" } },
    { entitlement: SITE_ID },
    { bind: { ...validBody, actor } },
  ]);
});

test("task workflow routes deny actors without workflows.view before storage", async () => {
  let storageCalls = 0;
  const actorWithoutWorkflow: Extract<
    MerchantEnterpriseActor,
    { type: "employee" }
  > = {
    ...actor,
    permissions: ["enterprise.view", "tasks.view", "tasks.update"],
  };
  const getResponse = await handleMerchantTaskWorkflowGet(
    new Request(
      `https://www.faolla.com/api/merchant-enterprise/task-workflow?siteId=${SITE_ID}&taskId=${TASK_ID}`,
    ),
    dependencies({
      async resolveActor() {
        return actorWithoutWorkflow;
      },
      async loadBinding() {
        storageCalls += 1;
        return binding;
      },
    }),
  );
  assert.equal(getResponse.status, 403);

  const postResponse = await handleMerchantTaskWorkflowPost(
    mutationRequest(validBody),
    dependencies({
      async resolveActor() {
        return actorWithoutWorkflow;
      },
      async bindWorkflow() {
        storageCalls += 1;
        return { binding, createdChecklistItems: [item] };
      },
    }),
  );
  assert.equal(postResponse.status, 403);
  assert.equal(storageCalls, 0);
});

test("task workflow GET strictly validates tenant/task query shape", async () => {
  const urls = [
    `https://www.faolla.com/api/merchant-enterprise/task-workflow?siteId=${SITE_ID}`,
    `https://www.faolla.com/api/merchant-enterprise/task-workflow?siteId=${SITE_ID}&taskId=bad`,
    `https://www.faolla.com/api/merchant-enterprise/task-workflow?siteId=${SITE_ID}&siteId=${SITE_ID}&taskId=${TASK_ID}`,
    `https://www.faolla.com/api/merchant-enterprise/task-workflow?siteId=${SITE_ID}&taskId=${TASK_ID}&extra=1`,
  ];
  let calls = 0;
  for (const url of urls) {
    const response = await handleMerchantTaskWorkflowGet(
      new Request(url),
      dependencies({
        async resolveActor() {
          calls += 1;
          return actor;
        },
      }),
    );
    assert.equal(response.status, 400, url);
  }
  assert.equal(calls, 0);
});

test("task workflow POST rejects CSRF, smuggled fields, and invalid versions", async () => {
  const crossOrigin = await handleMerchantTaskWorkflowPost(
    mutationRequest(validBody, "https://evil.example"),
    dependencies(),
  );
  assert.equal(crossOrigin.status, 403);

  for (const body of [
    { ...validBody, expectedTaskVersion: 0 },
    { ...validBody, expectedRevisionId: "bad" },
    { ...validBody, steps: [] },
    { ...validBody, operationId: "" },
  ]) {
    const response = await handleMerchantTaskWorkflowPost(
      mutationRequest(body),
      dependencies(),
    );
    assert.equal(response.status, 400);
  }
});

test("task workflow POST maps stale, capacity, and duplicate binding conflicts", async () => {
  for (const code of [
    "enterprise_version_conflict",
    "workflow_revision_changed",
    "workflow_not_published",
    "task_workflow_already_bound",
    "task_workflow_checklist_source_exists",
    "task_checklist_limit_reached",
    "invalid_task_archived",
  ]) {
    const response = await handleMerchantTaskWorkflowPost(
      mutationRequest(validBody),
      dependencies({
        async bindWorkflow() {
          throw new Error(code);
        },
      }),
    );
    assert.equal(response.status, 409, code);
    assert.deepEqual(await response.json(), { ok: false, error: code });
  }
});
