import assert from "node:assert/strict";
import test from "node:test";
import {
  handleMerchantMembershipsGet,
  type MerchantMembershipGetRouteDependencies,
} from "@/app/api/memberships/route";
import {
  MerchantBusinessAccessError,
  type MerchantBusinessActor,
} from "@/lib/merchantBusinessActor.server";
import type { MerchantMembershipListItem } from "@/lib/merchantMemberships";
import type { MerchantStaffBusinessPermission } from "@/lib/merchantStaffBusiness";

const SITE_ID = "10000000";

function employeeActor(
  permissions: readonly MerchantStaffBusinessPermission[],
): MerchantBusinessActor {
  return {
    type: "employee",
    siteId: SITE_ID,
    authUserId: "auth-employee-1",
    employeeId: "employee-1",
    roleId: "role-1",
    employeeVersion: 2,
    roleVersion: 3,
    principalKey: "employee:employee-1",
    authorizationVersion: "2:3",
    displayName: "Employee",
    email: "employee@example.test",
    collaborationPermissions: [],
    businessPermissions: [...permissions],
  };
}

function membership(): MerchantMembershipListItem {
  return {
    id: "membership-private-id",
    siteId: SITE_ID,
    siteName: "Merchant",
    memberNo: "CARD-0001",
    serial: 1,
    accountId: "private-account",
    userId: "private-user",
    email: "hidden.person@example.test",
    nickname: "Hidden Nickname",
    name: "Hidden Person",
    phone: "+34 600 000 001",
    avatarUrl: "https://example.test/private-avatar",
    birthday: "1990-01-01",
    birthdayMonthDayOnly: false,
    gender: "private-gender",
    country: "private-country",
    province: "private-province",
    city: "private-city",
    address: "private-address",
    taxName: "private-tax-name",
    taxNumber: "private-tax-number",
    taxCountry: "private-tax-country",
    taxProvince: "private-tax-province",
    taxCity: "private-tax-city",
    taxAddress: "private-tax-address",
    allergens: ["private-allergen"],
    pointBalance: 120,
    balanceAmount: 45.5,
    growthValue: 30,
    levelId: "level-1",
    transactions: [],
    status: "active",
    joinedAt: "2026-01-01T00:00:00.000Z",
    leftAt: null,
    updatedAt: "2026-08-01T00:00:00.000Z",
    profileVisible: true,
  };
}

function assertPrivateHeaders(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
}

function getDependencies(
  actor: MerchantBusinessActor,
  overrides: Partial<MerchantMembershipGetRouteDependencies> = {},
): Partial<MerchantMembershipGetRouteDependencies> {
  return {
    authorizeActor: async () => actor,
    reauthorizeActor: async () => actor,
    loadMembershipsSnapshot: async (_siteId, options) => {
      assert.equal(options?.applyScheduledRules, false);
      return { memberships: [membership()], updatedAt: "membership-version-1" };
    },
    listOrders: async () => [],
    listCoupons: async () => [],
    getRechargeCancellationQuote: async () => ({ quote: true } as never),
    ...overrides,
  };
}

test("members.view-only employee gets a fresh independently redacted list", async () => {
  const actor = employeeActor(["members.view"]);
  let orderCalls = 0;
  let couponCalls = 0;
  let requiredPermission = "";
  const response = await handleMerchantMembershipsGet(
    new Request(
      `https://launch.faolla.com/api/memberships?siteId=${SITE_ID}&knownVersion=membership-version-1&includeInsights=1`,
    ),
    getDependencies(actor, {
      authorizeActor: async (_request, input) => {
        requiredPermission = input.requiredPermission;
        return actor;
      },
      listOrders: async () => {
        orderCalls += 1;
        return [];
      },
      listCoupons: async () => {
        couponCalls += 1;
        return [];
      },
    }),
  );

  assert.equal(response.status, 200);
  assertPrivateHeaders(response);
  assert.equal(requiredPermission, "members.view");
  const payload = await response.json();
  assert.equal(payload.notModified, undefined);
  assert.equal(payload.memberships.length, 1);
  assert.equal(payload.memberships[0].memberNo, "CARD-0001");
  assert.equal(payload.memberships[0].email, "");
  assert.equal(payload.memberships[0].name, "");
  assert.equal(payload.memberships[0].pointBalance, 0);
  assert.equal(payload.memberships[0].balanceAmount, 0);
  assert.equal(payload.memberships[0].insight, undefined);
  assert.equal(orderCalls, 0);
  assert.equal(couponCalls, 0);
});

test("hidden customer fields never act as a membership search oracle", async () => {
  const actor = employeeActor(["members.view"]);
  const response = await handleMerchantMembershipsGet(
    new Request(
      `https://launch.faolla.com/api/memberships?siteId=${SITE_ID}&query=hidden.person%40example.test&includeInsights=0`,
    ),
    getDependencies(actor),
  );
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(payload.memberships, []);
  assert.equal(payload.total, 0);
  assert.equal(payload.allTotal, 1);
});

test("member insights load orders and coupons only with the explicit permission", async () => {
  const actor = employeeActor([
    "members.view",
    "members.customer_data.view",
    "members.account.view",
    "members.insights.view",
  ]);
  let orderCalls = 0;
  let couponCalls = 0;
  const response = await handleMerchantMembershipsGet(
    new Request(`https://launch.faolla.com/api/memberships?siteId=${SITE_ID}&includeInsights=1`),
    getDependencies(actor, {
      listOrders: async () => {
        orderCalls += 1;
        return [];
      },
      listCoupons: async () => {
        couponCalls += 1;
        return [];
      },
    }),
  );
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(orderCalls, 1);
  assert.equal(couponCalls, 1);
  assert.equal(payload.memberships[0].email, "hidden.person@example.test");
  assert.equal(payload.memberships[0].pointBalance, 120);
  assert.equal(typeof payload.memberships[0].insight, "object");
});

test("recharge cancellation quote reauthorizes before touching quote storage", async () => {
  const actor = employeeActor(["redemptions.recharge.cancel"]);
  let requiredPermission = "";
  let reauthorizeCalls = 0;
  let quoteCalls = 0;
  const response = await handleMerchantMembershipsGet(
    new Request(
      `https://launch.faolla.com/api/memberships?siteId=${SITE_ID}&action=recharge_cancellation_quote&membershipId=membership-private-id&transactionId=transaction-1`,
    ),
    getDependencies(actor, {
      authorizeActor: async (_request, input) => {
        requiredPermission = input.requiredPermission;
        return actor;
      },
      reauthorizeActor: async () => {
        reauthorizeCalls += 1;
        throw new MerchantBusinessAccessError("permission_denied", 403);
      },
      getRechargeCancellationQuote: async () => {
        quoteCalls += 1;
        return { quote: true } as never;
      },
    }),
  );
  assert.equal(requiredPermission, "redemptions.recharge.cancel");
  assert.equal(reauthorizeCalls, 1);
  assert.equal(quoteCalls, 0);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "permission_denied" });
  assertPrivateHeaders(response);
});

test("membership authorization denial prevents every list read", async () => {
  let snapshotCalls = 0;
  const response = await handleMerchantMembershipsGet(
    new Request(`https://launch.faolla.com/api/memberships?siteId=${SITE_ID}`),
    {
      authorizeActor: async () => {
        throw new MerchantBusinessAccessError("permission_denied", 403);
      },
      loadMembershipsSnapshot: async () => {
        snapshotCalls += 1;
        return { memberships: [], updatedAt: null };
      },
    },
  );
  assert.equal(response.status, 403);
  assert.equal(snapshotCalls, 0);
  assert.deepEqual(await response.json(), { error: "permission_denied" });
});
