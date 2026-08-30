import assert from "node:assert/strict";
import test from "node:test";
import {
  handleMerchantRedemptionCashierGet,
  handleMerchantRedemptionCashierPost,
  type MerchantRedemptionCashierRouteDependencies,
} from "@/app/api/merchant-admin/redemption-cashier/route";
import {
  MerchantBusinessAccessError,
  type MerchantBusinessActor,
} from "@/lib/merchantBusinessActor.server";
import { createEmptyMerchantMembershipSettings } from "@/lib/merchantMembershipSettings";
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
    employeeVersion: 1,
    roleVersion: 1,
    principalKey: "employee:employee-1",
    authorizationVersion: "1:1",
    displayName: "Cashier",
    email: "cashier@example.test",
    collaborationPermissions: [],
    businessPermissions: [...permissions],
  };
}

function membership(overrides: Partial<MerchantMembershipListItem> = {}): MerchantMembershipListItem {
  return {
    id: "membership-private-id",
    siteId: SITE_ID,
    siteName: "Merchant",
    memberNo: "CARD-0001",
    serial: 1,
    accountId: "private-account",
    userId: "private-user",
    email: "private@example.test",
    nickname: "Private Nickname",
    name: "Private Name",
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
    transactions: [
      {
        id: "transaction-1",
        type: "recharge",
        status: "completed",
        at: "2026-08-01T00:00:00.000Z",
        pointDelta: 120,
        balanceDelta: 45.5,
        growthDelta: 30,
        note: "private-note",
        operatorId: "owner:owner-1",
        cancelledAt: null,
        cancellationNote: "",
        cancelledBy: "",
        cancellationOperationMarker: "",
        relatedTransactionId: "",
        adjustmentKind: "",
      },
    ],
    status: "active",
    joinedAt: "2026-01-01T00:00:00.000Z",
    leftAt: null,
    updatedAt: "2026-08-01T00:00:00.000Z",
    profileVisible: true,
    ...overrides,
  };
}

function assertPrivateHeaders(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
}

function memberSearchRequest(
  query: string,
  options: { origin?: string; limit?: number } = {},
) {
  return new Request(
    "https://launch.faolla.com/api/merchant-admin/redemption-cashier",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: options.origin ?? "https://launch.faolla.com",
        "x-merchant-access-token": "employee-token",
      },
      body: JSON.stringify({
        siteId: SITE_ID,
        action: "member_search",
        query,
        limit: options.limit ?? 20,
      }),
    },
  );
}

function routeDependencies(
  actor: MerchantBusinessActor,
  overrides: Partial<MerchantRedemptionCashierRouteDependencies> = {},
): Partial<MerchantRedemptionCashierRouteDependencies> {
  return {
    authorizeActor: async () => actor,
    loadMembershipsSnapshot: async (_siteId, options) => {
      assert.equal(options?.applyScheduledRules, false);
      return {
        memberships: [membership()],
        updatedAt: "membership-version-1",
      };
    },
    loadSettings: async () => ({
      ...createEmptyMerchantMembershipSettings(SITE_ID),
      updatedAt: "settings-version-1",
    }),
    loadCouponsSnapshot: async () => ({
      coupons: [
        {
          id: "coupon-1",
          claimEvents: [{ id: "private-claim" }],
          redeemEvents: [{ id: "private-redeem" }],
        } as never,
      ],
      updatedAt: "coupon-version-1",
    }),
    consumeSearchRateLimit: () => ({ allowed: true, retryAfterSeconds: 60 }),
    ...overrides,
  };
}

test("restricted cashier always receives a fresh redacted no-store snapshot", async () => {
  let requiredPermission = "";
  const actor = employeeActor(["redemptions.view"]);
  const response = await handleMerchantRedemptionCashierGet(
    new Request(
      `https://launch.faolla.com/api/merchant-admin/redemption-cashier?siteId=${SITE_ID}&knownMembershipVersion=membership-version-1`,
    ),
    routeDependencies(actor, {
      authorizeActor: async (_request, input) => {
        requiredPermission = input.requiredPermission;
        return actor;
      },
    }),
  );

  assert.equal(response.status, 200);
  assertPrivateHeaders(response);
  assert.equal(requiredPermission, "redemptions.view");
  const payload = await response.json();
  assert.equal(payload.membershipsNotModified, false);
  assert.equal(payload.memberships.length, 1);
  assert.equal(payload.memberships[0].memberNo, "CARD-0001");
  assert.equal(payload.memberships[0].pointBalance, 120);
  assert.equal(payload.memberships[0].balanceAmount, 45.5);
  assert.equal(payload.memberships[0].email, "");
  assert.equal(payload.memberships[0].name, "");
  assert.deepEqual(payload.memberships[0].transactions, []);
  assert.deepEqual(payload.coupons[0].claimEvents, []);
  assert.deepEqual(payload.coupons[0].redeemEvents, []);
});

test("customer-data cashier may reuse only its own matching membership version", async () => {
  const actor = employeeActor([
    "redemptions.view",
    "redemptions.customer_data.view",
  ]);
  const response = await handleMerchantRedemptionCashierGet(
    new Request(
      `https://launch.faolla.com/api/merchant-admin/redemption-cashier?siteId=${SITE_ID}&knownMembershipVersion=membership-version-1`,
    ),
    routeDependencies(actor),
  );
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.membershipsNotModified, true);
  assert.equal("memberships" in payload, false);
});

test("cashier member search needs no members menu permission and never loads unrelated stores", async () => {
  const actor = employeeActor(["redemptions.view"]);
  let membershipCalls = 0;
  let settingsCalls = 0;
  let couponCalls = 0;
  let rateLimitCalls = 0;
  const response = await handleMerchantRedemptionCashierPost(
    memberSearchRequest("CARD-0001", { limit: 300 }),
    routeDependencies(actor, {
      loadMembershipsSnapshot: async (_siteId, options) => {
        membershipCalls += 1;
        assert.equal(options?.applyScheduledRules, false);
        return { memberships: [membership()], updatedAt: "version" };
      },
      loadSettings: async () => {
        settingsCalls += 1;
        return createEmptyMerchantMembershipSettings(SITE_ID);
      },
      loadCouponsSnapshot: async () => {
        couponCalls += 1;
        return { coupons: [], updatedAt: null };
      },
      consumeSearchRateLimit: () => {
        rateLimitCalls += 1;
        return { allowed: true, retryAfterSeconds: 60 };
      },
    }),
  );
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(payload).sort(), ["memberships", "ok"]);
  assert.equal(payload.memberships.length, 1);
  assert.equal(payload.memberships[0].memberNo, "CARD-0001");
  assert.equal(payload.memberships[0].email, "");
  assert.deepEqual(payload.memberships[0].transactions, []);
  assert.equal(membershipCalls, 1);
  assert.equal(settingsCalls, 0);
  assert.equal(couponCalls, 0);
  assert.equal(rateLimitCalls, 1);
});

test("cashier member search returns PII only with the redemption customer-data permission", async () => {
  const query = "private@example.test";
  const restricted = await handleMerchantRedemptionCashierPost(
    memberSearchRequest(query),
    routeDependencies(employeeActor(["redemptions.view"])),
  );
  assert.equal(restricted.status, 200);
  assert.deepEqual((await restricted.json()).memberships, []);

  const permitted = await handleMerchantRedemptionCashierPost(
    memberSearchRequest(query),
    routeDependencies(
      employeeActor([
        "redemptions.view",
        "redemptions.customer_data.view",
      ]),
    ),
  );
  const payload = await permitted.json();
  assert.equal(permitted.status, 200);
  assert.equal(payload.memberships.length, 1);
  assert.equal(payload.memberships[0].email, "private@example.test");
  assert.equal(payload.memberships[0].name, "Private Name");
  assert.deepEqual(payload.memberships[0].transactions, []);
});

test("cashier member search rejects cross-origin POST before authorization", async () => {
  let authorizationCalls = 0;
  const response = await handleMerchantRedemptionCashierPost(
    memberSearchRequest("CARD-0001", { origin: "https://attacker.example" }),
    {
      authorizeActor: async () => {
        authorizationCalls += 1;
        return employeeActor(["redemptions.view"]);
      },
    },
  );
  assert.equal(response.status, 403);
  assert.equal(authorizationCalls, 0);
  assertPrivateHeaders(response);
});

test("cashier member search contains storage failures behind a bounded private error", async () => {
  const response = await handleMerchantRedemptionCashierPost(
    memberSearchRequest("CARD-0001"),
    routeDependencies(employeeActor(["redemptions.view"]), {
      loadMembershipsSnapshot: async () => {
        throw new Error("sensitive storage diagnostics");
      },
    }),
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "redemption_cashier_search_failed",
  });
  assertPrivateHeaders(response);
});

test("authorization denial and search throttling happen before every data read", async () => {
  let dataCalls = 0;
  const denied = await handleMerchantRedemptionCashierGet(
    new Request(
      `https://launch.faolla.com/api/merchant-admin/redemption-cashier?siteId=${SITE_ID}`,
    ),
    {
      authorizeActor: async () => {
        throw new MerchantBusinessAccessError("permission_denied", 403);
      },
      loadMembershipsSnapshot: async () => {
        dataCalls += 1;
        return { memberships: [], updatedAt: null };
      },
      loadSettings: async () => {
        dataCalls += 1;
        return createEmptyMerchantMembershipSettings(SITE_ID);
      },
      loadCouponsSnapshot: async () => {
        dataCalls += 1;
        return { coupons: [], updatedAt: null };
      },
    },
  );
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { error: "permission_denied" });
  assert.equal(dataCalls, 0);

  const limited = await handleMerchantRedemptionCashierPost(
    memberSearchRequest("CARD-0001"),
    routeDependencies(employeeActor(["redemptions.view"]), {
      loadMembershipsSnapshot: async () => {
        dataCalls += 1;
        return { memberships: [], updatedAt: null };
      },
      consumeSearchRateLimit: () => ({ allowed: false, retryAfterSeconds: 17 }),
    }),
  );
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "17");
  assert.deepEqual(await limited.json(), { error: "member_search_rate_limited" });
  assert.equal(dataCalls, 0);
  assertPrivateHeaders(limited);
});
