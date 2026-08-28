import assert from "node:assert/strict";
import test from "node:test";
import {
  handleMerchantBusinessCapabilitiesGet,
  toPublicMerchantBusinessCapabilities,
  toPublicMerchantBusinessWorkspace,
} from "@/app/api/merchant-business/capabilities/route";
import { MerchantBusinessAccessError } from "@/lib/merchantBusinessActor.server";

const SITE_ID = "10000000";

test("capabilities expose only enabled menus and an authorization-scoped cache namespace", () => {
  const payload = toPublicMerchantBusinessCapabilities({
    type: "employee",
    siteId: SITE_ID,
    authUserId: "11111111-1111-4111-8111-111111111111",
    employeeId: "22222222-2222-4222-8222-222222222222",
    roleId: "33333333-3333-4333-8333-333333333333",
    employeeVersion: 4,
    roleVersion: 8,
    principalKey: "employee:22222222-2222-4222-8222-222222222222",
    authorizationVersion: "4:8",
    displayName: "员工",
    email: "private@example.com",
    collaborationPermissions: ["enterprise.view", "tasks.view"],
    businessPermissions: [
      "orders.view",
      "orders.status.manage",
      "members.view",
    ],
  });
  assert.deepEqual(payload.menus, ["订单管理", "会员管理"]);
  assert.deepEqual(payload.permissions, [
    "orders.view",
    "orders.status.manage",
    "members.view",
  ]);
  assert.deepEqual(payload.collaborationPermissions, [
    "enterprise.view",
    "tasks.view",
  ]);
  assert.equal(JSON.stringify(payload).includes("private@example.com"), false);
  assert.equal(JSON.stringify(payload).includes("11111111-1111"), false);
  assert.match(payload.cacheNamespace, /10000000/);
  assert.match(payload.cacheNamespace, /orders\.status\.manage/);
});

test("capabilities require one exact site id and are private no-store", async () => {
  let calls = 0;
  const resolveActor = async () => {
    calls += 1;
    throw new Error("must not run");
  };
  for (const url of [
    "https://www.faolla.com/api/merchant-business/capabilities",
    "https://www.faolla.com/api/merchant-business/capabilities?siteId=10000000&siteId=10000001",
    "https://www.faolla.com/api/merchant-business/capabilities?siteId=%2010000000",
  ]) {
    const response = await handleMerchantBusinessCapabilitiesGet(
      new Request(url),
      { resolveActor: resolveActor as never },
    );
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.equal(calls, 0);
});

test("capabilities use the strict business actor and bound public errors", async () => {
  const response = await handleMerchantBusinessCapabilitiesGet(
    new Request(
      `https://www.faolla.com/api/merchant-business/capabilities?siteId=${SITE_ID}`,
    ),
    {
      resolveActor: async (_request, input) => {
        assert.deepEqual(input, { siteId: SITE_ID });
        throw new MerchantBusinessAccessError("permission_denied", 403);
      },
    },
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "permission_denied",
  });
});

test("workspace bootstrap exposes only safe site data and exact booking rules", () => {
  const actor = {
    type: "employee" as const,
    siteId: SITE_ID,
    authUserId: "11111111-1111-4111-8111-111111111111",
    employeeId: "22222222-2222-4222-8222-222222222222",
    roleId: "33333333-3333-4333-8333-333333333333",
    employeeVersion: 4,
    roleVersion: 8,
    principalKey: "employee:22222222-2222-4222-8222-222222222222" as const,
    authorizationVersion: "4:8",
    displayName: "Employee",
    email: "private@example.com",
    collaborationPermissions: [],
    businessPermissions: ["bookings.view" as const],
  };
  const workspace = toPublicMerchantBusinessWorkspace(
    actor,
    {
      id: SITE_ID,
      merchantName: "Store",
      name: "Fallback",
      domain: "",
      category: "",
      industry: "其他",
      location: {
        countryCode: "ES",
        country: "Spain",
        provinceCode: "",
        province: "",
        city: "Madrid",
      },
      permissionConfig: {
        allowBookingEmailPrefill: true,
        allowBookingAutoEmail: false,
      },
      sortConfig: { rule: "created_desc", monthlyViews: 0 },
      createdAt: "2026-08-28T00:00:00.000Z",
    } as never,
    {
      version: 1,
      siteId: SITE_ID,
      publishedAt: "2026-08-28T00:00:00.000Z",
      entries: [
        {
          viewport: "desktop",
          blockId: "booking-1",
          storeOptions: ["Main"],
          itemOptions: ["Consultation"],
          titleOptions: ["Ms"],
          availableTimeRanges: [],
          timeSlotRules: [],
          blockedDates: [],
          holidayDates: [],
          maxBookingsPerSlot: null,
        },
      ],
    },
  );
  assert.equal(workspace.siteName, "Store");
  assert.equal(workspace.siteCountryCode, "ES");
  assert.deepEqual(
    (workspace.booking as { storeOptions: string[] }).storeOptions,
    ["Main"],
  );
  assert.equal(JSON.stringify(workspace).includes("private@example.com"), false);
});
