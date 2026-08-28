import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMerchantBusinessCapabilitiesMountKey,
  getMerchantEmployeeBusinessMenuIds,
  parseMerchantBusinessCapabilitiesPayload,
} from "@/lib/merchantBusinessCapabilities";

function payload(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    schemaVersion: 1,
    actor: {
      type: "employee",
      displayName: "Employee",
      principalKey: "employee:employee-1",
      authorizationVersion: "2:3",
    },
    cacheNamespace: "employee-capability-version",
    collaborationPermissions: ["enterprise.view"],
    permissions: ["orders.view", "orders.status.manage"],
    workspace: {
      siteId: "10000000",
      siteName: "Store",
      siteCountryCode: "ES",
    },
    ...overrides,
  };
}

test("capability parser accepts an exact dependency-complete employee payload", () => {
  const parsed = parseMerchantBusinessCapabilitiesPayload(payload());
  assert.ok(parsed);
  assert.deepEqual(getMerchantEmployeeBusinessMenuIds(parsed.permissions), [
    "orders",
  ]);
});

test("capability parser rejects owner, unknown, duplicate, and dependency-broken payloads", () => {
  assert.equal(
    parseMerchantBusinessCapabilitiesPayload(
      payload({ actor: { ...payload().actor, type: "owner" } }),
    ),
    null,
  );
  assert.equal(
    parseMerchantBusinessCapabilitiesPayload(
      payload({ permissions: ["orders.view", "unknown.permission"] }),
    ),
    null,
  );
  assert.equal(
    parseMerchantBusinessCapabilitiesPayload(
      payload({ permissions: ["orders.view", "orders.view"] }),
    ),
    null,
  );
  assert.equal(
    parseMerchantBusinessCapabilitiesPayload(
      payload({ permissions: ["orders.status.manage"] }),
    ),
    null,
  );
});

test("menu derivation never invents unmentioned owner menus", () => {
  assert.deepEqual(
    getMerchantEmployeeBusinessMenuIds([
      "redemptions.view",
      "bookings.view",
      "orders.view",
      "conversations.view",
      "members.view",
    ]),
    ["redemptions", "bookings", "orders", "conversations", "members"],
  );
});

test("booking capability payload requires exact-site normalized published options", () => {
  const valid = parseMerchantBusinessCapabilitiesPayload(
    payload({
      permissions: ["bookings.view"],
      workspace: {
        siteId: "10000000",
        siteName: "Store",
        siteCountryCode: "ES",
        booking: {
          storeOptions: ["Main"],
          itemOptions: ["Consultation"],
          titleOptions: ["Ms"],
          bookingRulesSnapshot: null,
          allowBookingEmailPrefill: false,
          allowCustomerAutoEmail: true,
        },
      },
    }),
  );
  assert.equal(valid?.workspace.booking?.storeOptions[0], "Main");
  assert.equal(
    parseMerchantBusinessCapabilitiesPayload(
      payload({
        permissions: ["bookings.view"],
        workspace: {
          siteId: "10000000",
          siteName: "Store",
          siteCountryCode: "ES",
        },
      }),
    ),
    null,
  );
});

test("mount key changes for every authorization boundary and ignores permission order", () => {
  const base = parseMerchantBusinessCapabilitiesPayload(payload());
  assert.ok(base);
  const reordered = parseMerchantBusinessCapabilitiesPayload(
    payload({ permissions: ["orders.status.manage", "orders.view"] }),
  );
  assert.ok(reordered);
  assert.equal(
    buildMerchantBusinessCapabilitiesMountKey(base),
    buildMerchantBusinessCapabilitiesMountKey(reordered),
  );

  for (const changed of [
    payload({
      actor: {
        ...payload().actor,
        principalKey: "employee:employee-2",
      },
    }),
    payload({
      actor: {
        ...payload().actor,
        authorizationVersion: "2:4",
      },
    }),
    payload({ permissions: ["orders.view"] }),
    payload({ collaborationPermissions: ["enterprise.view", "tasks.view"] }),
    payload({
      workspace: {
        siteId: "20000000",
        siteName: "Store",
        siteCountryCode: "ES",
      },
    }),
  ]) {
    const parsed = parseMerchantBusinessCapabilitiesPayload(changed);
    assert.ok(parsed);
    assert.notEqual(
      buildMerchantBusinessCapabilitiesMountKey(base),
      buildMerchantBusinessCapabilitiesMountKey(parsed),
    );
  }
});
