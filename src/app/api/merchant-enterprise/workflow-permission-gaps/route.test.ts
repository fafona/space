import assert from "node:assert/strict";
import test from "node:test";
import {
  handleMerchantEnterpriseWorkflowPermissionGapsGet,
  handleMerchantEnterpriseWorkflowPermissionGapsPost,
  type MerchantEnterpriseWorkflowPermissionGapRouteDependencies,
} from "@/app/api/merchant-enterprise/workflow-permission-gaps/route";
import type { MerchantEnterpriseActor } from "@/lib/merchantEnterprise";
import type {
  MerchantEnterpriseWorkflowPermissionGap,
  MerchantEnterpriseWorkflowPermissionGrantResult,
} from "@/lib/merchantEnterpriseWorkflowRevisions";

const owner: Extract<MerchantEnterpriseActor, { type: "owner" }> = {
  type: "owner",
  id: "77777777-7777-4777-8777-777777777777",
  siteId: "10000000",
  displayName: "Owner",
  email: "owner@example.com",
  permissions: [],
  accessScope: "all",
  allowedBoardIds: [],
};

const employee: Extract<MerchantEnterpriseActor, { type: "employee" }> = {
  type: "employee",
  id: "66666666-6666-4666-8666-666666666666",
  siteId: "10000000",
  displayName: "Employee",
  email: "employee@example.com",
  roleId: "55555555-5555-4555-8555-555555555555",
  permissions: ["enterprise.view", "workflows.view"],
  accessScope: "all",
  allowedBoardIds: [],
};

const gap: MerchantEnterpriseWorkflowPermissionGap = {
  roleId: "99999999-9999-4999-8999-999999999999",
  name: "管理员",
  systemKey: "administrator",
  isSystem: true,
  version: 3,
  permissions: ["enterprise.view", "roles.view", "roles.manage"],
  recommendedWorkflowPermissions: [
    "workflows.view",
    "workflows.manage",
    "workflows.publish",
  ],
  missingWorkflowPermissions: [
    "workflows.view",
    "workflows.manage",
    "workflows.publish",
  ],
  classification: "system_default_gap",
  employeeCount: 2,
};

const granted: MerchantEnterpriseWorkflowPermissionGrantResult = {
  role: {
    id: gap.roleId,
    name: gap.name,
    status: "active",
    isSystem: true,
    version: 4,
    permissions: [
      "enterprise.view",
      "roles.view",
      "roles.manage",
      "workflows.view",
      "workflows.manage",
      "workflows.publish",
    ],
  },
  addedPermissions: [
    "workflows.view",
    "workflows.manage",
    "workflows.publish",
  ],
};

function dependencies(
  overrides: Partial<MerchantEnterpriseWorkflowPermissionGapRouteDependencies> = {},
): MerchantEnterpriseWorkflowPermissionGapRouteDependencies {
  return {
    async resolveActor() {
      return owner;
    },
    async requireEnterpriseEntitlement() {
      return {};
    },
    async loadGaps() {
      return [gap];
    },
    async grantPermissions() {
      return granted;
    },
    ...overrides,
  };
}

test("permission-gap GET is an owner-only read and returns explicit recommendations", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const response = await handleMerchantEnterpriseWorkflowPermissionGapsGet(
    new Request(
      "https://www.faolla.com/api/merchant-enterprise/workflow-permission-gaps?siteId=10000000",
    ),
    dependencies({
      async resolveActor(_request, input) {
        calls.push({ resolve: input });
        return owner;
      },
      async requireEnterpriseEntitlement(siteId) {
        calls.push({ entitlement: siteId });
        return {};
      },
      async loadGaps(input) {
        calls.push({ gaps: input });
        return [gap];
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(calls, [
    {
      resolve: { siteId: "10000000", requiredPermission: "enterprise.view" },
    },
    { entitlement: "10000000" },
    { gaps: { siteId: "10000000", actor: owner } },
  ]);
  const payload = await response.json();
  assert.deepEqual(payload.gaps[0].missingWorkflowPermissions, [
    "workflows.view",
    "workflows.manage",
    "workflows.publish",
  ]);
});

test("permission-gap GET rejects employees before the read RPC", async () => {
  let loaded = false;
  const response = await handleMerchantEnterpriseWorkflowPermissionGapsGet(
    new Request(
      "https://www.faolla.com/api/merchant-enterprise/workflow-permission-gaps?siteId=10000000",
    ),
    dependencies({
      async resolveActor() {
        return employee;
      },
      async loadGaps() {
        loaded = true;
        return [];
      },
    }),
  );
  assert.equal(response.status, 403);
  assert.equal(loaded, false);
});

test("permission grant forwards only the owner's explicit workflow permissions", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const response = await handleMerchantEnterpriseWorkflowPermissionGapsPost(
    new Request(
      "https://www.faolla.com/api/merchant-enterprise/workflow-permission-gaps",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://www.faolla.com",
        },
        body: JSON.stringify({
          siteId: "10000000",
          roleId: gap.roleId,
          version: 3,
          workflowPermissions: [
            "workflows.view",
            "workflows.manage",
            "workflows.publish",
          ],
          operationId: "grant-workflows:administrator",
        }),
      },
    ),
    dependencies({
      async grantPermissions(input) {
        calls.push(input);
        return granted;
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0], {
    siteId: "10000000",
    roleId: gap.roleId,
    version: 3,
    workflowPermissions: [
      "workflows.view",
      "workflows.manage",
      "workflows.publish",
    ],
    operationId: "grant-workflows:administrator",
    actor: owner,
  });
  const payload = await response.json();
  assert.deepEqual(payload.addedPermissions, granted.addedPermissions);
});

test("permission grant never silently accepts unknown, duplicate or cross-origin input", async () => {
  const crossOrigin = await handleMerchantEnterpriseWorkflowPermissionGapsPost(
    new Request(
      "https://www.faolla.com/api/merchant-enterprise/workflow-permission-gaps",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example" },
        body: "{}",
      },
    ),
    dependencies(),
  );
  assert.equal(crossOrigin.status, 403);

  for (const body of [
    {
      siteId: "10000000",
      roleId: gap.roleId,
      version: 3,
      workflowPermissions: ["workflows.view", "workflows.view"],
      operationId: "grant-workflows:duplicate",
    },
    {
      siteId: "10000000",
      roleId: gap.roleId,
      version: 3,
      workflowPermissions: ["roles.manage"],
      operationId: "grant-workflows:wrong-domain",
    },
    {
      siteId: "10000000",
      roleId: gap.roleId,
      version: 3,
      workflowPermissions: ["workflows.view"],
      operationId: "grant-workflows:smuggle",
      grantAll: true,
    },
    {
      siteId: "10000000",
      roleId: gap.roleId,
      version: 3,
      workflowPermissions: ["workflows.view"],
      operationId: "grant workflows",
    },
    {
      siteId: "10000000",
      roleId: gap.roleId,
      version: 3,
      workflowPermissions: ["workflows.view"],
      operationId: "g".repeat(121),
    },
  ]) {
    const response = await handleMerchantEnterpriseWorkflowPermissionGapsPost(
      new Request(
        "https://www.faolla.com/api/merchant-enterprise/workflow-permission-gaps",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://www.faolla.com",
          },
          body: JSON.stringify(body),
        },
      ),
      dependencies(),
    );
    assert.equal(response.status, 400);
  }
});

test("permission dependency and stale conflicts remain explicit", async () => {
  const request = (operationId: string) =>
    new Request(
      "https://www.faolla.com/api/merchant-enterprise/workflow-permission-gaps",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://www.faolla.com",
        },
        body: JSON.stringify({
          siteId: "10000000",
          roleId: gap.roleId,
          version: 3,
          workflowPermissions: ["workflows.manage"],
          operationId,
        }),
      },
    );
  const missingDependency = await handleMerchantEnterpriseWorkflowPermissionGapsPost(
    request("grant-workflows:dependency"),
    dependencies({
      async grantPermissions() {
        throw new Error("invalid_permission_dependencies");
      },
    }),
  );
  assert.equal(missingDependency.status, 400);

  const stale = await handleMerchantEnterpriseWorkflowPermissionGapsPost(
    request("grant-workflows:stale"),
    dependencies({
      async grantPermissions() {
        throw new Error("enterprise_version_conflict");
      },
    }),
  );
  assert.equal(stale.status, 409);

  const businessRole = await handleMerchantEnterpriseWorkflowPermissionGapsPost(
    request("grant-workflows:business-role"),
    dependencies({
      async grantPermissions() {
        throw new Error("business_role_workflow_grant_requires_role_editor");
      },
    }),
  );
  assert.equal(businessRole.status, 409);
  assert.deepEqual(await businessRole.json(), {
    ok: false,
    error: "business_role_workflow_grant_requires_role_editor",
  });
});
