import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMerchantBusinessCapabilitiesMountKey,
  getMerchantEmployeeBusinessMenuIds,
  getMerchantEmployeeWorkspaceRoots,
  parseMerchantBusinessCapabilitiesPayload,
  resolveMerchantEmployeeWorkspaceRoot,
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

test("capability parser accepts every valid workspace-root shape", () => {
  for (const validPayload of [
    payload({
      collaborationPermissions: [],
      permissions: ["orders.view"],
    }),
    payload({
      collaborationPermissions: ["enterprise.view"],
      permissions: [],
    }),
    payload({
      collaborationPermissions: ["enterprise.view"],
      permissions: ["orders.view"],
    }),
    payload({ collaborationPermissions: [], permissions: [] }),
  ]) {
    assert.ok(parseMerchantBusinessCapabilitiesPayload(validPayload));
  }
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

test("workspace roots expose only explicitly granted collaboration and business entries", () => {
  assert.deepEqual(
    getMerchantEmployeeWorkspaceRoots([], ["orders.view"]),
    ["orders"],
  );
  assert.deepEqual(
    getMerchantEmployeeWorkspaceRoots(["enterprise.view"], []),
    ["collaboration"],
  );
  assert.deepEqual(
    getMerchantEmployeeWorkspaceRoots(
      ["enterprise.view"],
      ["bookings.view", "members.view"],
    ),
    ["collaboration", "bookings", "members"],
  );
  assert.deepEqual(getMerchantEmployeeWorkspaceRoots([], []), []);
});

test("workspace root resolution never preserves a revoked or unavailable root", () => {
  assert.equal(
    resolveMerchantEmployeeWorkspaceRoot(
      "collaboration",
      [],
      ["orders.view"],
    ),
    "orders",
  );
  assert.equal(
    resolveMerchantEmployeeWorkspaceRoot(
      "orders",
      ["enterprise.view"],
      ["members.view"],
    ),
    "collaboration",
  );
  assert.equal(
    resolveMerchantEmployeeWorkspaceRoot("orders", [], ["members.view"]),
    "members",
  );
  assert.equal(
    resolveMerchantEmployeeWorkspaceRoot("orders", [], ["orders.view"]),
    "orders",
  );
  assert.equal(
    resolveMerchantEmployeeWorkspaceRoot(
      "members",
      ["enterprise.view"],
      ["bookings.view", "members.view"],
    ),
    "members",
  );
  assert.equal(
    resolveMerchantEmployeeWorkspaceRoot(null, ["enterprise.view"], []),
    "collaboration",
  );
  assert.equal(
    resolveMerchantEmployeeWorkspaceRoot(
      null,
      ["enterprise.view"],
      ["orders.view"],
    ),
    "collaboration",
  );
  assert.equal(resolveMerchantEmployeeWorkspaceRoot("orders", [], []), null);
  assert.equal(resolveMerchantEmployeeWorkspaceRoot(null, [], []), null);
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
