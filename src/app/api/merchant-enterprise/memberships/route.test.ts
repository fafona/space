import assert from "node:assert/strict";
import test from "node:test";
import {
  handleMerchantEnterpriseMembershipsGet,
  type MerchantEnterpriseMembershipsRouteDependencies,
} from "@/app/api/merchant-enterprise/memberships/route";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import {
  loadMerchantEnterpriseMembershipRecords,
  type MerchantEnterpriseMembershipDirectoryClient,
  type MerchantEnterpriseMembershipRecord,
} from "@/lib/merchantEnterpriseMemberships.server";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EMPLOYEE_A = "11111111-1111-4111-8111-111111111111";
const EMPLOYEE_B = "22222222-2222-4222-8222-222222222222";
const ROLE_A = "33333333-3333-4333-8333-333333333333";
const ROLE_B = "44444444-4444-4444-8444-444444444444";

function request(accessToken: string | null = "enterprise-token") {
  const headers = new Headers();
  if (accessToken !== null) headers.set("x-merchant-access-token", accessToken);
  return new Request(
    "https://www.faolla.com/api/merchant-enterprise/memberships",
    { headers },
  );
}

function role(
  id = ROLE_A,
  input: Partial<NonNullable<MerchantEnterpriseMembershipRecord["role"]>> = {},
): NonNullable<MerchantEnterpriseMembershipRecord["role"]> {
  return {
    id,
    name: "Employee",
    status: "active",
    permissions: ["enterprise.view"],
    ...input,
  };
}

function membership(
  input: Partial<MerchantEnterpriseMembershipRecord> = {},
): MerchantEnterpriseMembershipRecord {
  return {
    siteId: "10000000",
    employeeId: EMPLOYEE_A,
    employeeDisplayName: "Employee A",
    employeeStatus: "active",
    role: role(),
    ...input,
  };
}

function dependencies(
  overrides: Partial<MerchantEnterpriseMembershipsRouteDependencies> = {},
): MerchantEnterpriseMembershipsRouteDependencies {
  return {
    resolveAuthUser: async () => ({ id: USER_A }),
    loadMemberships: async () => [membership()],
    loadCurrentSites: async () => [
      {
        id: "10000000",
        merchantName: "Merchant A",
        permissionConfig: { allowEnterpriseManagement: true },
      },
    ],
    ...overrides,
  };
}

test("membership directory requires an explicit enterprise token and never falls back to cookies", async () => {
  let authCalls = 0;
  const response = await handleMerchantEnterpriseMembershipsGet(
    new Request(
      "https://www.faolla.com/api/merchant-enterprise/memberships",
      { headers: { cookie: "merchant-space-merchant-auth=owner-token" } },
    ),
    dependencies({
      resolveAuthUser: async () => {
        authCalls += 1;
        return { id: USER_A };
      },
    }),
  );

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { ok: false, error: "unauthorized" });
  assert.equal(authCalls, 0);
});

test("membership directory keeps authentication and backend failures private and unavailable", async () => {
  const authUnavailable = await handleMerchantEnterpriseMembershipsGet(
    request(),
    dependencies({
      resolveAuthUser: async () => {
        throw new MerchantEnterpriseAccessError(
          "enterprise_auth_unavailable",
          503,
        );
      },
    }),
  );
  assert.equal(authUnavailable.status, 503);
  assert.deepEqual(await authUnavailable.json(), {
    ok: false,
    error: "enterprise_auth_unavailable",
  });

  const membershipUnavailable = await handleMerchantEnterpriseMembershipsGet(
    request(),
    dependencies({
      loadMemberships: async () => {
        throw new Error("database detail must not leak");
      },
    }),
  );
  assert.equal(membershipUnavailable.status, 503);
  assert.equal(
    membershipUnavailable.headers.get("cache-control"),
    "private, no-store",
  );
  assert.deepEqual(await membershipUnavailable.json(), {
    ok: false,
    error: "enterprise_memberships_unavailable",
  });

  const entitlementUnavailable = await handleMerchantEnterpriseMembershipsGet(
    request(),
    dependencies({
      loadCurrentSites: async () => {
        throw new Error("snapshot detail must not leak");
      },
    }),
  );
  assert.equal(entitlementUnavailable.status, 503);
  assert.deepEqual(await entitlementUnavailable.json(), {
    ok: false,
    error: "enterprise_memberships_unavailable",
  });

  const ambiguousSnapshot = await handleMerchantEnterpriseMembershipsGet(
    request(),
    dependencies({
      loadCurrentSites: async () => [
        {
          id: "10000000",
          name: "Merchant A",
          permissionConfig: { allowEnterpriseManagement: true },
        },
        {
          id: "10000000",
          name: "Conflicting Merchant A",
          permissionConfig: { allowEnterpriseManagement: false },
        },
      ],
    }),
  );
  assert.equal(ambiguousSnapshot.status, 503);
  assert.deepEqual(await ambiguousSnapshot.json(), {
    ok: false,
    error: "enterprise_memberships_unavailable",
  });
});

test("malformed employee directory rows fail the whole private response closed", async () => {
  const client: MerchantEnterpriseMembershipDirectoryClient = {
    from(table: string) {
      if (table === "merchant_enterprise_employees") {
        const builder = {
          select() {
            return builder;
          },
          eq() {
            return builder;
          },
          order() {
            return builder;
          },
          async range() {
            return {
              data: [
                {
                  id: "not-an-employee-uuid",
                  merchant_id: "10000000",
                  display_name: "Malformed Employee",
                  role_id: ROLE_A,
                  status: "active",
                },
              ],
              error: null,
            };
          },
        };
        return builder;
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };

  const response = await handleMerchantEnterpriseMembershipsGet(
    request(),
    dependencies({
      loadMemberships: (authUserId) =>
        loadMerchantEnterpriseMembershipRecords(client, authUserId),
    }),
  );

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "enterprise_memberships_unavailable",
  });
});

test("membership directory queries only the authenticated user and omits identity secrets", async () => {
  const employeeRows = [
    {
      id: EMPLOYEE_A,
      merchant_id: "10000000",
      auth_user_id: USER_A,
      display_name: "Employee A",
      role_id: ROLE_A,
      status: "active",
      email: "a@example.com",
      invitation_token_hash: "secret-a",
    },
    {
      id: EMPLOYEE_B,
      merchant_id: "20000000",
      auth_user_id: USER_B,
      display_name: "Employee B",
      role_id: ROLE_B,
      status: "active",
      email: "b@example.com",
      invitation_token_hash: "secret-b",
    },
  ];
  const roleRows = [
    {
      id: ROLE_A,
      merchant_id: "10000000",
      name: "Employee",
      permissions: ["enterprise.view"],
      access_scope: "all",
      status: "active",
    },
    {
      id: ROLE_B,
      merchant_id: "20000000",
      name: "Other tenant role",
      permissions: ["enterprise.view"],
      access_scope: "all",
      status: "active",
    },
  ];
  let selectedEmployeeColumns = "";
  let filteredAuthUserId = "";
  const client: MerchantEnterpriseMembershipDirectoryClient = {
    from(table: string) {
      if (table === "merchant_enterprise_employees") {
        const builder = {
          select(columns: string) {
            selectedEmployeeColumns = columns;
            return builder;
          },
          eq(column: string, value: string) {
            assert.equal(column, "auth_user_id");
            filteredAuthUserId = value;
            return builder;
          },
          order() {
            return builder;
          },
          async range(from: number, to: number) {
            const data = employeeRows
              .filter((row) => row.auth_user_id === filteredAuthUserId)
              .slice(from, to + 1)
              .map(
                ({
                  id,
                  merchant_id,
                  display_name,
                  role_id,
                  status,
                }) => ({ id, merchant_id, display_name, role_id, status }),
              );
            return { data, error: null };
          },
        };
        return builder;
      }
      if (table === "merchant_enterprise_roles") {
        const builder = {
          select() {
            return builder;
          },
          async in(column: string, values: string[]) {
            assert.equal(column, "id");
            return {
              data: roleRows.filter((row) => values.includes(row.id)),
              error: null,
            };
          },
        };
        return builder;
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };

  const response = await handleMerchantEnterpriseMembershipsGet(
    request(),
    dependencies({
      loadMemberships: (authUserId) =>
        loadMerchantEnterpriseMembershipRecords(client, authUserId),
    }),
  );
  const body = (await response.json()) as {
    memberships: Array<{
      siteId: string;
      displayName: string;
    }>;
  };

  assert.equal(response.status, 200);
  assert.equal(filteredAuthUserId, USER_A);
  assert.doesNotMatch(selectedEmployeeColumns, /auth_user_id|email|token/i);
  assert.deepEqual(
    body.memberships.map((item) => [item.siteId, item.displayName]),
    [["10000000", "Employee A"]],
  );
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, new RegExp(USER_A, "i"));
  assert.doesNotMatch(serialized, new RegExp(USER_B, "i"));
  assert.doesNotMatch(serialized, /example\.com|secret-[ab]|permissions/i);
});

test("membership directory lists multiple enterprises with minimal enterable records", async () => {
  const response = await handleMerchantEnterpriseMembershipsGet(
    request(),
    dependencies({
      loadMemberships: async (authUserId) => {
        assert.equal(authUserId, USER_A);
        return [
          membership({
            siteId: "20000000",
            employeeId: EMPLOYEE_B,
            role: role(ROLE_B),
          }),
          membership(),
        ];
      },
      loadCurrentSites: async () => [
        {
          id: "10000000",
          merchantName: "Merchant A",
          permissionConfig: { allowEnterpriseManagement: true },
        },
        {
          id: "20000000",
          name: "Merchant B",
          permissionConfig: { allowEnterpriseManagement: true },
        },
      ],
    }),
  );
  const body = (await response.json()) as {
    ok: boolean;
    memberships: Array<{
      siteId: string;
      siteName: string;
      status: string;
      enterable: boolean;
    }>;
  };

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(body.ok, true);
  assert.deepEqual(
    body.memberships.map((item) => ({
      siteId: item.siteId,
      siteName: item.siteName,
      status: item.status,
      enterable: item.enterable,
    })),
    [
      {
        siteId: "10000000",
        siteName: "Merchant A",
        status: "active",
        enterable: true,
      },
      {
        siteId: "20000000",
        siteName: "Merchant B",
        status: "active",
        enterable: true,
      },
    ],
  );
  assert.deepEqual(Object.keys(body.memberships[0] ?? {}).sort(), [
    "displayName",
    "employeeId",
    "enterable",
    "roleId",
    "roleName",
    "siteId",
    "siteName",
    "status",
  ]);
});

test("disabled memberships remain listed but cannot enter", async () => {
  const response = await handleMerchantEnterpriseMembershipsGet(
    request(),
    dependencies({
      loadMemberships: async () => [
        membership({ employeeStatus: "disabled" }),
      ],
    }),
  );
  const body = (await response.json()) as {
    memberships: Array<{ status: string; enterable: boolean; reason?: string }>;
  };

  assert.equal(response.status, 200);
  assert.equal(body.memberships.length, 1);
  assert.equal(body.memberships[0]?.status, "disabled");
  assert.equal(body.memberships[0]?.enterable, false);
  assert.equal(body.memberships[0]?.reason, "employee_account_disabled");
});

test("missing, archived, and permission-invalid roles cannot enter", async () => {
  const response = await handleMerchantEnterpriseMembershipsGet(
    request(),
    dependencies({
      loadMemberships: async () => [
        membership({ siteId: "10000000", role: null }),
        membership({
          siteId: "20000000",
          employeeId: EMPLOYEE_B,
          role: role(ROLE_B, { status: "archived" }),
        }),
        membership({
          siteId: "30000000",
          employeeId: "55555555-5555-4555-8555-555555555555",
          role: role("66666666-6666-4666-8666-666666666666", {
            permissions: ["tasks.view"],
          }),
        }),
      ],
      loadCurrentSites: async () =>
        ["10000000", "20000000", "30000000"].map((id) => ({
          id,
          name: id,
          permissionConfig: { allowEnterpriseManagement: true },
        })),
    }),
  );
  const body = (await response.json()) as {
    memberships: Array<{ enterable: boolean; reason?: string }>;
  };

  assert.equal(response.status, 200);
  assert.deepEqual(
    body.memberships.map((item) => item.enterable),
    [false, false, false],
  );
  assert.deepEqual(
    body.memberships.map((item) => item.reason),
    ["merchant_access_denied", "role_disabled", "merchant_access_denied"],
  );
});

test("enterprise entitlement disabled memberships remain visible but cannot enter", async () => {
  const response = await handleMerchantEnterpriseMembershipsGet(
    request(),
    dependencies({
      loadCurrentSites: async () => [
        {
          id: "10000000",
          name: "Merchant A",
          permissionConfig: { allowEnterpriseManagement: false },
        },
      ],
    }),
  );
  const body = (await response.json()) as {
    memberships: Array<Record<string, unknown>>;
  };

  assert.equal(response.status, 200);
  assert.deepEqual(body.memberships, [
    {
      siteId: "10000000",
      siteName: "Merchant A",
      employeeId: EMPLOYEE_A,
      displayName: "Employee A",
      roleId: ROLE_A,
      roleName: "Employee",
      status: "active",
      enterable: false,
      reason: "enterprise_management_disabled",
    },
  ]);
});
