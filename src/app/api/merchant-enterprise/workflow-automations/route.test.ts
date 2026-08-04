import assert from "node:assert/strict";
import test from "node:test";
import {
  handleMerchantEnterpriseWorkflowAutomationsGet,
  handleMerchantEnterpriseWorkflowAutomationsPatch,
  handleMerchantEnterpriseWorkflowAutomationsPost,
  type MerchantEnterpriseAutomationRouteDependencies,
} from "@/app/api/merchant-enterprise/workflow-automations/route";
import type { MerchantEnterpriseActor } from "@/lib/merchantEnterprise";

const ids = {
  rule: "11111111-1111-4111-8111-111111111111",
  board: "22222222-2222-4222-8222-222222222222",
  column: "33333333-3333-4333-8333-333333333333",
  workflow: "44444444-4444-4444-8444-444444444444",
  revision: "55555555-5555-4555-8555-555555555555",
  employee: "66666666-6666-4666-8666-666666666666",
  actor: "77777777-7777-4777-8777-777777777777",
};

const actor: Extract<MerchantEnterpriseActor, { type: "employee" }> = {
  type: "employee",
  id: ids.actor,
  siteId: "10000000",
  displayName: "Supervisor",
  email: "supervisor@example.com",
  roleId: "88888888-8888-4888-8888-888888888888",
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

const rule = {
  id: ids.rule,
  siteId: "10000000",
  name: "New order handoff",
  sourceType: "order" as const,
  eventType: "created" as const,
  fromStatus: null,
  toStatus: null,
  boardId: ids.board,
  columnId: ids.column,
  workflowId: ids.workflow,
  workflowRevisionId: ids.revision,
  workflowRevisionNo: 1,
  taskTitle: "Handle order {eventRef}",
  taskDescription: "",
  priority: "normal" as const,
  dueOffsetMinutes: null,
  status: "paused" as const,
  assigneeIds: [ids.employee],
  version: 1,
  enabledAt: "2026-08-04T10:00:00.000Z",
  archivedAt: null,
  createdAt: "2026-08-04T10:00:00.000Z",
  updatedAt: "2026-08-04T10:00:00.000Z",
};

const pausedBody = {
  siteId: "10000000",
  name: "New order handoff",
  sourceType: "order",
  eventType: "created",
  boardId: ids.board,
  columnId: ids.column,
  workflowId: ids.workflow,
  workflowRevisionId: ids.revision,
  taskTitle: "Handle order {eventRef}",
  taskDescription: "",
  priority: "normal",
  dueOffsetMinutes: null,
  status: "paused",
  assigneeIds: [ids.employee],
  operationId: "enterprise-automation:test",
};

function dependencies(
  overrides: Partial<MerchantEnterpriseAutomationRouteDependencies> = {},
): MerchantEnterpriseAutomationRouteDependencies {
  return {
    async resolveActor() {
      return actor;
    },
    async requireEnterpriseEntitlement() {
      return {};
    },
    sourceAvailability() {
      return { order: "inactive", booking: "inactive" };
    },
    async loadRules() {
      return { merchantId: "10000000", rules: [rule], runs: [] };
    },
    async createRule() {
      return rule;
    },
    async updateRule() {
      return { ...rule, version: 2 };
    },
    async archiveRule() {
      return {
        ...rule,
        status: "archived",
        archivedAt: "2026-08-04T11:00:00.000Z",
        version: 2,
      };
    },
    ...overrides,
  };
}

function mutation(
  method: "POST" | "PATCH",
  body: Record<string, unknown>,
  origin = "https://www.faolla.com",
) {
  return new Request(
    "https://www.faolla.com/api/merchant-enterprise/workflow-automations",
    {
      method,
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(body),
    },
  );
}

test("automation GET authorizes view access and returns source availability", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const response = await handleMerchantEnterpriseWorkflowAutomationsGet(
    new Request(
      "https://www.faolla.com/api/merchant-enterprise/workflow-automations?siteId=10000000",
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
      sourceAvailability(siteId) {
        calls.push({ availability: siteId });
        return { order: "active", booking: "inactive" };
      },
      async loadRules(input) {
        calls.push({ load: input });
        return { merchantId: "10000000", rules: [rule], runs: [] };
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), {
    ok: true,
    rules: [rule],
    runs: [],
    sourceAvailability: { order: "active", booking: "inactive" },
  });
  assert.deepEqual(calls.slice(0, 2), [
    {
      resolve: {
        siteId: "10000000",
        requiredPermission: "automations.view",
      },
    },
    { entitlement: "10000000" },
  ]);
  assert.ok(calls.some((call) => "load" in call));
  assert.ok(calls.some((call) => "availability" in call));
});

test("automation GET rejects ambiguous query input before authorization", async () => {
  const urls = [
    "https://www.faolla.com/api/merchant-enterprise/workflow-automations",
    "https://www.faolla.com/api/merchant-enterprise/workflow-automations?siteId=10000000&siteId=10000000",
    "https://www.faolla.com/api/merchant-enterprise/workflow-automations?siteId=%2010000000%20",
    "https://www.faolla.com/api/merchant-enterprise/workflow-automations?siteId=10000000&scope=all",
  ];
  let authorizationCalls = 0;
  const deps = dependencies({
    async resolveActor() {
      authorizationCalls += 1;
      return actor;
    },
  });
  for (const url of urls) {
    const response = await handleMerchantEnterpriseWorkflowAutomationsGet(
      new Request(url),
      deps,
    );
    assert.equal(response.status, 400, url);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "invalid_automation_query",
    });
  }
  assert.equal(authorizationCalls, 0);
});

test("paused rules can be saved while the source event stream is inactive", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const response = await handleMerchantEnterpriseWorkflowAutomationsPost(
    mutation("POST", pausedBody),
    dependencies({
      async resolveActor(_request, input) {
        calls.push({ resolve: input });
        return actor;
      },
      async createRule(input) {
        calls.push({ create: input });
        return rule;
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.deepEqual(calls[0], {
    resolve: {
      siteId: "10000000",
      requiredPermission: "automations.manage",
    },
  });
  const create = calls.find((call) => "create" in call)?.create as
    | Record<string, unknown>
    | undefined;
  assert.equal(create?.actor, actor);
  assert.equal(create?.fromStatus, null);
  assert.equal(create?.toStatus, null);
  assert.equal(create?.operationId, "enterprise-automation:test");
});

test("active rules fail closed when their source event stream is inactive", async () => {
  let writes = 0;
  const response = await handleMerchantEnterpriseWorkflowAutomationsPost(
    mutation("POST", { ...pausedBody, status: "active" }),
    dependencies({
      async createRule() {
        writes += 1;
        return { ...rule, status: "active" };
      },
    }),
  );
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "source_event_stream_unavailable",
    sourceAvailability: { order: "inactive", booking: "inactive" },
  });
  assert.equal(writes, 0);
});

test("active rules are forwarded only when the matching source is active", async () => {
  let receivedStatus = "";
  const response = await handleMerchantEnterpriseWorkflowAutomationsPost(
    mutation("POST", { ...pausedBody, status: "active" }),
    dependencies({
      sourceAvailability() {
        return { order: "active", booking: "inactive" };
      },
      async createRule(input) {
        receivedStatus = input.status;
        return { ...rule, status: "active" };
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(receivedStatus, "active");
});

test("automation rule caps are reported as conflicts", async () => {
  for (const code of [
    "automation_active_rule_limit_reached",
    "automation_rule_limit_reached",
  ]) {
    const result = await handleMerchantEnterpriseWorkflowAutomationsPost(
      mutation("POST", pausedBody),
      dependencies({
        async createRule() {
          throw new Error(code);
        },
      }),
    );
    assert.equal(result.status, 409, code);
    assert.deepEqual(await result.json(), { ok: false, error: code });
  }
});

test("automation PATCH requires a strict rule id and CAS version", async () => {
  const updateInputs: Array<Record<string, unknown>> = [];
  const valid = await handleMerchantEnterpriseWorkflowAutomationsPatch(
    mutation("PATCH", {
      ...pausedBody,
      ruleId: ids.rule,
      expectedVersion: 1,
    }),
    dependencies({
      async updateRule(input) {
        updateInputs.push(input);
        return { ...rule, version: 2 };
      },
    }),
  );
  assert.equal(valid.status, 200);
  assert.equal(updateInputs[0]?.ruleId, ids.rule);
  assert.equal(updateInputs[0]?.expectedVersion, 1);

  for (const patch of [
    { ruleId: "bad", expectedVersion: 1 },
    { ruleId: ids.rule, expectedVersion: 0 },
    { ruleId: ids.rule, expectedVersion: "1" },
  ]) {
    const invalid = await handleMerchantEnterpriseWorkflowAutomationsPatch(
      mutation("PATCH", { ...pausedBody, ...patch }),
      dependencies(),
    );
    assert.equal(invalid.status, 400);
  }

  const conflict = await handleMerchantEnterpriseWorkflowAutomationsPatch(
    mutation("PATCH", {
      ...pausedBody,
      ruleId: ids.rule,
      expectedVersion: 1,
    }),
    dependencies({
      async updateRule() {
        throw new Error("enterprise_version_conflict");
      },
    }),
  );
  assert.equal(conflict.status, 409);
});

test("automation PATCH archives with manage authorization and a strict action contract", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const archivedRule = {
    ...rule,
    status: "archived" as const,
    archivedAt: "2026-08-04T11:00:00.000Z",
    version: 2,
  };
  const valid = await handleMerchantEnterpriseWorkflowAutomationsPatch(
    mutation("PATCH", {
      siteId: "10000000",
      action: "archive",
      ruleId: ids.rule,
      expectedVersion: 1,
      operationId: "enterprise-automation:archive-test",
    }),
    dependencies({
      sourceAvailability(siteId) {
        calls.push({ availability: siteId });
        return { order: "active", booking: "inactive" };
      },
      async resolveActor(_request, input) {
        calls.push({ resolve: input });
        return actor;
      },
      async archiveRule(input) {
        calls.push({ archive: input });
        return archivedRule;
      },
    }),
  );
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), {
    ok: true,
    rule: archivedRule,
    sourceAvailability: { order: "active", booking: "inactive" },
  });
  assert.deepEqual(calls[0], {
    resolve: {
      siteId: "10000000",
      requiredPermission: "automations.manage",
    },
  });
  const archive = calls.find((call) => "archive" in call)?.archive as
    | Record<string, unknown>
    | undefined;
  assert.equal(archive?.siteId, "10000000");
  assert.equal(archive?.ruleId, ids.rule);
  assert.equal(archive?.expectedVersion, 1);
  assert.equal(archive?.operationId, "enterprise-automation:archive-test");
  assert.equal(archive?.actor, actor);

  for (const body of [
    {
      siteId: "10000000",
      action: "delete",
      ruleId: ids.rule,
      expectedVersion: 1,
      operationId: "enterprise-automation:bad-action",
    },
    {
      siteId: "10000000",
      action: "archive",
      ruleId: ids.rule,
      expectedVersion: 1,
      operationId: "enterprise-automation:extra",
      status: "archived",
    },
  ]) {
    const invalid = await handleMerchantEnterpriseWorkflowAutomationsPatch(
      mutation("PATCH", body),
      dependencies(),
    );
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error, "invalid_automation_request");
  }
});

test("automation archive maps archived and CAS errors to conflicts", async () => {
  for (const code of ["automation_rule_archived", "enterprise_version_conflict"]) {
    const result = await handleMerchantEnterpriseWorkflowAutomationsPatch(
      mutation("PATCH", {
        siteId: "10000000",
        action: "archive",
        ruleId: ids.rule,
        expectedVersion: 1,
        operationId: `enterprise-automation:${code}`,
      }),
      dependencies({
        async archiveRule() {
          throw new Error(code);
        },
      }),
    );
    assert.equal(result.status, 409, code);
    assert.deepEqual(await result.json(), { ok: false, error: code });
  }
});

test("automation mutations reject cross-origin and unknown body fields", async () => {
  let authorizationCalls = 0;
  const deps = dependencies({
    async resolveActor() {
      authorizationCalls += 1;
      return actor;
    },
  });
  const crossOrigin = await handleMerchantEnterpriseWorkflowAutomationsPost(
    mutation("POST", pausedBody, "https://evil.example"),
    deps,
  );
  assert.equal(crossOrigin.status, 403);
  assert.equal((await crossOrigin.json()).error, "forbidden_origin");

  const extra = await handleMerchantEnterpriseWorkflowAutomationsPost(
    mutation("POST", { ...pausedBody, customerName: "must-not-enter-rules" }),
    deps,
  );
  assert.equal(extra.status, 400);
  assert.deepEqual(await extra.json(), {
    ok: false,
    error: "invalid_automation_request",
  });
  assert.equal(authorizationCalls, 0);
});

test("automation mutations reject every undocumented template token before authorization", async () => {
  let authorizationCalls = 0;
  const deps = dependencies({
    async resolveActor() {
      authorizationCalls += 1;
      return actor;
    },
  });
  for (const token of ["{sourceId}", "{customer.name}", "{unknown-token}", "{}"] ) {
    const result = await handleMerchantEnterpriseWorkflowAutomationsPost(
      mutation("POST", { ...pausedBody, taskTitle: `Handle ${token}` }),
      deps,
    );
    assert.equal(result.status, 400, token);
    assert.equal((await result.json()).error, "invalid_automation_rule");
  }
  assert.equal(authorizationCalls, 0);
});
