import assert from "node:assert/strict";
import test from "node:test";
import {
  handleMerchantEnterpriseWorkflowsGet,
  handleMerchantEnterpriseWorkflowsPatch,
  handleMerchantEnterpriseWorkflowsPost,
  type MerchantEnterpriseWorkflowRouteDependencies,
} from "@/app/api/merchant-enterprise/workflows/route";
import type {
  MerchantEnterpriseActor,
  MerchantEnterpriseWorkflow,
} from "@/lib/merchantEnterprise";

const actor: Extract<MerchantEnterpriseActor, { type: "employee" }> = {
  type: "employee",
  id: "77777777-7777-4777-8777-777777777777",
  siteId: "10000000",
  displayName: "Manager",
  email: "manager@example.com",
  roleId: "99999999-9999-4999-8999-999999999999",
  permissions: [
    "enterprise.view",
    "workflows.view",
    "workflows.manage",
    "workflows.publish",
  ],
  accessScope: "all",
  allowedBoardIds: [],
};

function workflow(
  overrides: Partial<MerchantEnterpriseWorkflow> = {},
): MerchantEnterpriseWorkflow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    siteId: "10000000",
    title: "客户投诉处理",
    scenario: "客户反馈商品存在问题时",
    description: "先确认事实，再给出解决方案。",
    category: "客户服务",
    tags: ["投诉", "售后"],
    status: "draft",
    steps: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        title: "记录情况",
        instruction: "记录客户联系方式、订单号和具体问题。",
        position: 0,
      },
    ],
    version: 1,
    publishedVersion: 0,
    publishedAt: null,
    hasUnpublishedChanges: true,
    createdAt: "2026-08-03T08:00:00.000Z",
    updatedAt: "2026-08-03T08:00:00.000Z",
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<MerchantEnterpriseWorkflowRouteDependencies> = {},
): MerchantEnterpriseWorkflowRouteDependencies {
  return {
    async resolveActor() {
      return actor;
    },
    async requireEnterpriseEntitlement() {
      return {};
    },
    async loadWorkflows() {
      return [];
    },
    async createWorkflow() {
      return workflow();
    },
    async updateWorkflow() {
      return workflow({ version: 2 });
    },
    ...overrides,
  };
}

function mutationRequest(method: "POST" | "PATCH", body: unknown) {
  return new Request("https://www.faolla.com/api/merchant-enterprise/workflows", {
    method,
    headers: {
      "content-type": "application/json",
      origin: "https://www.faolla.com",
    },
    body: JSON.stringify(body),
  });
}

const draft = {
  title: " 客户投诉处理 ",
  scenario: " 客户反馈商品存在问题时 ",
  description: " 先确认事实，再给出解决方案。 ",
  category: " 客户服务 ",
  tags: ["投诉", "售后"],
  steps: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      title: " 记录情况 ",
      instruction: " 记录订单号和具体问题。 ",
      position: 0,
    },
  ],
};

test("workflow GET requires view permission and returns no-store data", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const response = await handleMerchantEnterpriseWorkflowsGet(
    new Request(
      "https://www.faolla.com/api/merchant-enterprise/workflows?siteId=10000000",
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
      async loadWorkflows(input) {
        calls.push({ load: input });
        return [workflow()];
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await response.json()).workflows.length, 1);
  assert.deepEqual(calls[0], {
    resolve: { siteId: "10000000", requiredPermission: "workflows.view" },
  });
  assert.deepEqual(calls[1], { entitlement: "10000000" });
  assert.deepEqual(calls[2], { load: { siteId: "10000000", actor } });
});

test("workflow GET rejects unexpected or repeated query parameters before loading", async () => {
  let resolved = false;
  const deps = dependencies({
    async resolveActor() {
      resolved = true;
      return actor;
    },
  });
  for (const query of [
    "siteId=10000000&extra=1",
    "siteId=10000000&siteId=10000000",
    "siteId=wrong",
  ]) {
    const response = await handleMerchantEnterpriseWorkflowsGet(
      new Request(
        `https://www.faolla.com/api/merchant-enterprise/workflows?${query}`,
      ),
      deps,
    );
    assert.equal(response.status, 400);
  }
  assert.equal(resolved, false);
});

test("workflow POST normalizes a complete draft and requires manage permission", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const response = await handleMerchantEnterpriseWorkflowsPost(
    mutationRequest("POST", {
      siteId: "10000000",
      ...draft,
      operationId: "workflow-create:test",
    }),
    dependencies({
      async resolveActor(_request, input) {
        calls.push({ resolve: input });
        return actor;
      },
      async createWorkflow(input) {
        calls.push({ create: input });
        return workflow();
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0], {
    resolve: { siteId: "10000000", requiredPermission: "workflows.manage" },
  });
  const create = calls[1]?.create as {
    draft: { title: string; scenario: string; steps: Array<{ title: string }> };
  };
  assert.equal(create.draft.title, "客户投诉处理");
  assert.equal(create.draft.scenario, "客户反馈商品存在问题时");
  assert.equal(create.draft.steps[0]?.title, "记录情况");
});

test("workflow POST rejects malformed steps and unknown fields before authorization", async () => {
  let resolved = false;
  const deps = dependencies({
    async resolveActor() {
      resolved = true;
      return actor;
    },
  });
  const badStepsResponse = await handleMerchantEnterpriseWorkflowsPost(
    mutationRequest("POST", {
      siteId: "10000000",
      ...draft,
      steps: [{ ...draft.steps[0], position: 2 }],
    }),
    deps,
  );
  assert.equal(badStepsResponse.status, 400);
  const unknownResponse = await handleMerchantEnterpriseWorkflowsPost(
    mutationRequest("POST", { siteId: "10000000", ...draft, admin: true }),
    deps,
  );
  assert.equal(unknownResponse.status, 400);
  assert.equal(resolved, false);
});

test("workflow PATCH separates draft editing from every visibility-changing action", async () => {
  const cases: Array<[WorkflowAction, string]> = [
    ["save", "workflows.manage"],
    ["publish", "workflows.publish"],
    ["archive", "workflows.publish"],
    ["restore", "workflows.publish"],
  ];
  for (const [action, requiredPermission] of cases) {
    const calls: Array<Record<string, unknown>> = [];
    const response = await handleMerchantEnterpriseWorkflowsPatch(
      mutationRequest("PATCH", {
        siteId: "10000000",
        workflowId: "11111111-1111-4111-8111-111111111111",
        version: 1,
        action,
        ...(action === "save" ? draft : {}),
        operationId: `workflow-${action}:test`,
      }),
      dependencies({
        async resolveActor(_request, input) {
          calls.push({ resolve: input });
          return actor;
        },
        async updateWorkflow(input) {
          calls.push({ update: input });
          return workflow({ version: 2 });
        },
      }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(calls[0], {
      resolve: { siteId: "10000000", requiredPermission },
    });
    assert.equal((calls[1]?.update as { action: string }).action, action);
  }
});

type WorkflowAction = "save" | "publish" | "archive" | "restore";

test("workflow PATCH rejects stale conflicts, cross-origin requests and action smuggling", async () => {
  const stale = await handleMerchantEnterpriseWorkflowsPatch(
    mutationRequest("PATCH", {
      siteId: "10000000",
      workflowId: "11111111-1111-4111-8111-111111111111",
      version: 1,
      action: "publish",
    }),
    dependencies({
      async updateWorkflow() {
        throw new Error("enterprise_version_conflict");
      },
    }),
  );
  assert.equal(stale.status, 409);

  const crossOrigin = await handleMerchantEnterpriseWorkflowsPatch(
    new Request("https://www.faolla.com/api/merchant-enterprise/workflows", {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: "{}",
    }),
    dependencies(),
  );
  assert.equal(crossOrigin.status, 403);

  const smuggled = await handleMerchantEnterpriseWorkflowsPatch(
    mutationRequest("PATCH", {
      siteId: "10000000",
      workflowId: "11111111-1111-4111-8111-111111111111",
      version: 1,
      action: "publish",
      title: "不能随发布动作偷偷修改",
    }),
    dependencies(),
  );
  assert.equal(smuggled.status, 400);
});
