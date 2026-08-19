import assert from "node:assert/strict";
import test from "node:test";
import {
  handleMerchantEnterpriseCurrentOperationsGet,
  parseMerchantEnterpriseCurrentOperationsQuery,
  type MerchantEnterpriseCurrentOperationsRouteDependencies,
} from "@/app/api/merchant-enterprise/current-operations/route-handler";
import type { MerchantEnterpriseActor } from "@/lib/merchantEnterprise";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import {
  buildMerchantEnterpriseCurrentOperationsAuthorizationFingerprint,
  type MerchantEnterpriseCurrentOperations,
} from "@/lib/merchantEnterpriseCurrentOperations";

const SITE_ID = "10000000";
const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const EMPLOYEE_ID = "20000000-0000-4000-8000-000000000002";
const OTHER_EMPLOYEE_ID = "30000000-0000-4000-8000-000000000003";
const BOARD_ID = "40000000-0000-4000-8000-000000000004";
const COLUMN_ID = "50000000-0000-4000-8000-000000000005";
const TASK_ID = "60000000-0000-4000-8000-000000000006";

const owner: Extract<MerchantEnterpriseActor, { type: "owner" }> = {
  type: "owner",
  id: OWNER_ID,
  siteId: SITE_ID,
  displayName: "Owner",
  email: "owner@example.test",
  permissions: ["enterprise.view", "tasks.view"],
  accessScope: "all",
  allowedBoardIds: [],
};

function employeeActor(
  permissions: Extract<MerchantEnterpriseActor, { type: "employee" }>["permissions"] = [
    "enterprise.view",
    "tasks.view",
  ],
): Extract<MerchantEnterpriseActor, { type: "employee" }> {
  return {
    type: "employee",
    id: EMPLOYEE_ID,
    siteId: SITE_ID,
    displayName: "Employee",
    email: "employee@example.test",
    roleId: "70000000-0000-4000-8000-000000000007",
    permissions,
    accessScope: "all",
    allowedBoardIds: [],
  };
}

function operations(
  overrides: Partial<MerchantEnterpriseCurrentOperations> = {},
): MerchantEnterpriseCurrentOperations {
  return {
    ok: true,
    asOf: "2026-08-19T10:00:00.000Z",
    scope: "enterprise",
    employeeId: null,
    scopeRestricted: false,
    boardSummaryTotalCount: 1,
    boardsTruncated: false,
    summary: {
      openTaskCount: 1,
      overdueTaskCount: 0,
      dueSoonTaskCount: 1,
      unassignedTaskCount: 0,
      involvedBoardCount: 1,
      sharedAssignmentTaskCount: null,
    },
    boards: [
      {
        boardId: BOARD_ID,
        boardName: "Operations",
        openTaskCount: 1,
        overdueTaskCount: 0,
        dueSoonTaskCount: 1,
      },
    ],
    priorityTasks: [
      {
        id: TASK_ID,
        boardId: BOARD_ID,
        boardName: "Operations",
        columnId: COLUMN_ID,
        columnName: "In progress",
        title: "Confirm shipment",
        priority: "high",
        dueAt: "2026-08-20T10:00:00.000Z",
        updatedAt: "2026-08-19T09:00:00.000Z",
        assigneeCount: 1,
      },
    ],
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<MerchantEnterpriseCurrentOperationsRouteDependencies> = {},
): MerchantEnterpriseCurrentOperationsRouteDependencies {
  return {
    async resolveActor() {
      return owner;
    },
    async requireEnterpriseEntitlement() {
      return {};
    },
    async loadCurrentOperations() {
      return operations();
    },
    ...overrides,
  };
}

test("current operations GET authorizes tasks, checks entitlement and returns private data", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const response = await handleMerchantEnterpriseCurrentOperationsGet(
    new Request(
      `https://www.faolla.com/api/merchant-enterprise/current-operations?siteId=${SITE_ID}`,
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
      async loadCurrentOperations(input) {
        calls.push({ load: input });
        return operations();
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), operations());
  assert.deepEqual(calls, [
    { resolve: { siteId: SITE_ID, requiredPermission: "tasks.view" } },
    { entitlement: SITE_ID },
    {
      load: {
        siteId: SITE_ID,
        employeeId: null,
        actor: owner,
      },
    },
  ]);
});

test("current operations GET forwards a canonical employee target", async () => {
  let received: Record<string, unknown> | null = null;
  const actor = employeeActor([
    "enterprise.view",
    "tasks.view",
    "roles.view",
    "employees.view",
  ]);
  const employeeOperations = operations({
    scope: "employee",
    employeeId: OTHER_EMPLOYEE_ID,
    summary: {
      ...operations().summary,
      unassignedTaskCount: null,
      sharedAssignmentTaskCount: 0,
    },
  });
  const response = await handleMerchantEnterpriseCurrentOperationsGet(
    new Request(
      `https://www.faolla.com/api/merchant-enterprise/current-operations?siteId=${SITE_ID}&employeeId=${OTHER_EMPLOYEE_ID.toUpperCase()}`,
    ),
    dependencies({
      async resolveActor() {
        return actor;
      },
      async loadCurrentOperations(input) {
        received = input;
        return employeeOperations;
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.ok(received);
  assert.equal(
    (received as Record<string, unknown>).employeeId,
    OTHER_EMPLOYEE_ID,
  );
});

test("employee may load self without employees.view but cannot enumerate another employee", async () => {
  const actor = employeeActor();
  let storeCalls = 0;
  const deps = dependencies({
    async resolveActor() {
      return actor;
    },
    async loadCurrentOperations() {
      storeCalls += 1;
      return operations({
        scope: "employee",
        employeeId: EMPLOYEE_ID,
        summary: {
          ...operations().summary,
          unassignedTaskCount: null,
          sharedAssignmentTaskCount: 0,
        },
      });
    },
  });
  const self = await handleMerchantEnterpriseCurrentOperationsGet(
    new Request(
      `https://www.faolla.com/api/merchant-enterprise/current-operations?siteId=${SITE_ID}&employeeId=${EMPLOYEE_ID}`,
    ),
    deps,
  );
  assert.equal(self.status, 200);

  const other = await handleMerchantEnterpriseCurrentOperationsGet(
    new Request(
      `https://www.faolla.com/api/merchant-enterprise/current-operations?siteId=${SITE_ID}&employeeId=${OTHER_EMPLOYEE_ID}`,
    ),
    deps,
  );
  assert.equal(other.status, 403);
  assert.deepEqual(await other.json(), {
    ok: false,
    error: "permission_denied",
  });
  assert.equal(storeCalls, 1);
});

test("current operations query rejects unknown, duplicate, missing, padded and invalid values before auth", async () => {
  const urls = [
    "https://www.faolla.com/api/merchant-enterprise/current-operations",
    `https://www.faolla.com/api/merchant-enterprise/current-operations?siteId=${SITE_ID}&siteId=${SITE_ID}`,
    `https://www.faolla.com/api/merchant-enterprise/current-operations?siteId=%20${SITE_ID}%20`,
    `https://www.faolla.com/api/merchant-enterprise/current-operations?siteId=${SITE_ID}&employeeId=`,
    `https://www.faolla.com/api/merchant-enterprise/current-operations?siteId=${SITE_ID}&employeeId=bad`,
    `https://www.faolla.com/api/merchant-enterprise/current-operations?siteId=${SITE_ID}&employeeId=${EMPLOYEE_ID}&employeeId=${EMPLOYEE_ID}`,
    `https://www.faolla.com/api/merchant-enterprise/current-operations?siteId=${SITE_ID}&limit=10`,
  ];
  let authCalls = 0;
  const deps = dependencies({
    async resolveActor() {
      authCalls += 1;
      return owner;
    },
  });
  for (const url of urls) {
    const response = await handleMerchantEnterpriseCurrentOperationsGet(
      new Request(url),
      deps,
    );
    assert.equal(response.status, 400, url);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "invalid_current_operations_query",
    });
  }
  assert.equal(authCalls, 0);
});

test("query parser keeps employeeId optional and canonical", () => {
  assert.deepEqual(
    parseMerchantEnterpriseCurrentOperationsQuery(
      new Request(
        `https://www.faolla.com/api/merchant-enterprise/current-operations?siteId=${SITE_ID}`,
      ),
    ),
    { siteId: SITE_ID, employeeId: null },
  );
  assert.deepEqual(
    parseMerchantEnterpriseCurrentOperationsQuery(
      new Request(
        `https://www.faolla.com/api/merchant-enterprise/current-operations?siteId=${SITE_ID}&employeeId=${EMPLOYEE_ID.toUpperCase()}`,
      ),
    ),
    { siteId: SITE_ID, employeeId: EMPLOYEE_ID },
  );
});

test("current operations GET stops before storage on access or entitlement failures", async () => {
  const url = `https://www.faolla.com/api/merchant-enterprise/current-operations?siteId=${SITE_ID}`;
  let storeCalls = 0;
  const forbidden = await handleMerchantEnterpriseCurrentOperationsGet(
    new Request(url),
    dependencies({
      async resolveActor() {
        throw new MerchantEnterpriseAccessError("permission_denied", 403);
      },
      async loadCurrentOperations() {
        storeCalls += 1;
        return operations();
      },
    }),
  );
  assert.equal(forbidden.status, 403);

  const disabled = await handleMerchantEnterpriseCurrentOperationsGet(
    new Request(url),
    dependencies({
      async requireEnterpriseEntitlement() {
        throw new MerchantEnterpriseAccessError(
          "enterprise_management_disabled",
          403,
        );
      },
      async loadCurrentOperations() {
        storeCalls += 1;
        return operations();
      },
    }),
  );
  assert.equal(disabled.status, 403);
  assert.equal(storeCalls, 0);
});

test("current operations GET maps target, schema and unexpected store failures", async () => {
  const url = `https://www.faolla.com/api/merchant-enterprise/current-operations?siteId=${SITE_ID}`;
  const cases = [
    ["employee_not_found", 404, "employee_not_found"],
    ["enterprise_schema_unavailable", 503, "enterprise_schema_unavailable"],
    ["enterprise_current_operations_read_failed", 503, "enterprise_request_failed"],
  ] as const;
  for (const [code, status, publicCode] of cases) {
    const response = await handleMerchantEnterpriseCurrentOperationsGet(
      new Request(url),
      dependencies({
        async loadCurrentOperations() {
          throw new Error(code);
        },
      }),
    );
    assert.equal(response.status, status);
    const expected: Record<string, unknown> = {
      ok: false,
      error: publicCode,
    };
    if (code === "enterprise_schema_unavailable") {
      expected.authorizationFingerprint =
        buildMerchantEnterpriseCurrentOperationsAuthorizationFingerprint(
          owner,
        );
    }
    assert.deepEqual(await response.json(), expected);
  }
});
