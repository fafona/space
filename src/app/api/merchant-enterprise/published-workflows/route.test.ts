import assert from "node:assert/strict";
import test from "node:test";
import {
  handleMerchantEnterprisePublishedWorkflowsGet,
  type MerchantEnterprisePublishedWorkflowsRouteDependencies,
} from "@/app/api/merchant-enterprise/published-workflows/route";
import type { MerchantEnterpriseActor } from "@/lib/merchantEnterprise";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";

const actor: Extract<MerchantEnterpriseActor, { type: "employee" }> = {
  type: "employee",
  id: "77777777-7777-4777-8777-777777777777",
  siteId: "10000000",
  displayName: "Employee",
  email: "employee@example.com",
  roleId: "99999999-9999-4999-8999-999999999999",
  permissions: ["enterprise.view", "workflows.view"],
  accessScope: "all",
  allowedBoardIds: [],
};

const choices = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Customer complaint",
    scenario: "A customer reports a damaged product",
    revisionId: "22222222-2222-4222-8222-222222222222",
    revisionNo: 3,
    stepCount: 4,
  },
];

function dependencies(
  overrides: Partial<MerchantEnterprisePublishedWorkflowsRouteDependencies> = {},
): MerchantEnterprisePublishedWorkflowsRouteDependencies {
  return {
    async resolveActor() {
      return actor;
    },
    async requireEnterpriseEntitlement() {
      return {};
    },
    async loadChoices() {
      return choices;
    },
    ...overrides,
  };
}

test("published workflow GET requires workflows.view and returns only choice DTOs", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const response = await handleMerchantEnterprisePublishedWorkflowsGet(
    new Request(
      "https://www.faolla.com/api/merchant-enterprise/published-workflows?siteId=10000000",
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
      async loadChoices(input) {
        calls.push({ load: input });
        return choices;
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { ok: true, choices });
  assert.deepEqual(calls, [
    {
      resolve: {
        siteId: "10000000",
        requiredPermission: "workflows.view",
      },
    },
    { entitlement: "10000000" },
    { load: { siteId: "10000000", actor } },
  ]);
});

test("published workflow GET rejects missing, duplicate, padded, and extra query values", async () => {
  const urls = [
    "https://www.faolla.com/api/merchant-enterprise/published-workflows",
    "https://www.faolla.com/api/merchant-enterprise/published-workflows?siteId=10000000&siteId=10000000",
    "https://www.faolla.com/api/merchant-enterprise/published-workflows?siteId=%2010000000%20",
    "https://www.faolla.com/api/merchant-enterprise/published-workflows?siteId=10000000&scope=published",
    "https://www.faolla.com/api/merchant-enterprise/published-workflows?siteId=not-a-site",
  ];
  let authorizationCalls = 0;
  const deps = dependencies({
    async resolveActor() {
      authorizationCalls += 1;
      return actor;
    },
  });

  for (const url of urls) {
    const response = await handleMerchantEnterprisePublishedWorkflowsGet(
      new Request(url),
      deps,
    );
    assert.equal(response.status, 400, url);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "invalid_published_workflow_choice_query",
    });
  }
  assert.equal(authorizationCalls, 0);
});

test("published workflow GET stops before storage when access or entitlement fails", async () => {
  let storageCalls = 0;
  const forbidden = await handleMerchantEnterprisePublishedWorkflowsGet(
    new Request(
      "https://www.faolla.com/api/merchant-enterprise/published-workflows?siteId=10000000",
    ),
    dependencies({
      async resolveActor() {
        throw new MerchantEnterpriseAccessError("permission_denied", 403);
      },
      async loadChoices() {
        storageCalls += 1;
        return choices;
      },
    }),
  );
  assert.equal(forbidden.status, 403);
  assert.deepEqual(await forbidden.json(), {
    ok: false,
    error: "permission_denied",
  });

  const disabled = await handleMerchantEnterprisePublishedWorkflowsGet(
    new Request(
      "https://www.faolla.com/api/merchant-enterprise/published-workflows?siteId=10000000",
    ),
    dependencies({
      async requireEnterpriseEntitlement() {
        throw new MerchantEnterpriseAccessError(
          "enterprise_management_disabled",
          403,
        );
      },
      async loadChoices() {
        storageCalls += 1;
        return choices;
      },
    }),
  );
  assert.equal(disabled.status, 403);
  assert.equal(storageCalls, 0);
});

test("published workflow GET maps RPC authorization and availability failures", async () => {
  const permission = await handleMerchantEnterprisePublishedWorkflowsGet(
    new Request(
      "https://www.faolla.com/api/merchant-enterprise/published-workflows?siteId=10000000",
    ),
    dependencies({
      async loadChoices() {
        throw new Error("permission_denied");
      },
    }),
  );
  assert.equal(permission.status, 403);

  const unavailable = await handleMerchantEnterprisePublishedWorkflowsGet(
    new Request(
      "https://www.faolla.com/api/merchant-enterprise/published-workflows?siteId=10000000",
    ),
    dependencies({
      async loadChoices() {
        throw new Error("enterprise_schema_unavailable");
      },
    }),
  );
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {
    ok: false,
    error: "enterprise_schema_unavailable",
  });

  const unknown = await handleMerchantEnterprisePublishedWorkflowsGet(
    new Request(
      "https://www.faolla.com/api/merchant-enterprise/published-workflows?siteId=10000000",
    ),
    dependencies({
      async loadChoices() {
        throw new Error("enterprise_published_workflows_read_failed");
      },
    }),
  );
  assert.equal(unknown.status, 503);
  assert.deepEqual(await unknown.json(), {
    ok: false,
    error: "enterprise_request_failed",
  });
});
