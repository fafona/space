import assert from "node:assert/strict";
import test from "node:test";
import { handleMerchantOrdersGet, type MerchantOrdersGetRouteDependencies } from "./route-handler";
import type { MerchantBusinessActor } from "@/lib/merchantBusinessActor.server";

const owner: MerchantBusinessActor = {
  type: "owner", siteId: "10000000", authUserId: "synthetic-owner", principalKey: "owner:synthetic-owner",
  authorizationVersion: "owner", displayName: "Synthetic", email: "", authorizationSource: "database",
  collaborationPermissions: [], businessPermissions: ["orders.view"],
};
const employee: MerchantBusinessActor = {
  type: "employee", siteId: "10000000", authUserId: "synthetic-employee", principalKey: "employee:synthetic-employee",
  employeeId: "synthetic-employee", roleId: "synthetic-role", employeeVersion: 1, roleVersion: 1,
  authorizationVersion: "1", displayName: "Synthetic", email: "", collaborationPermissions: [], businessPermissions: ["orders.view"],
};
function fixture(overrides: Partial<MerchantOrdersGetRouteDependencies> = {}) {
  const calls: string[] = [];
  const dependencies: Partial<MerchantOrdersGetRouteDependencies> = {
    resolveAdminSession: async (_request, site, permissions) => {
      calls.push("auth"); assert.equal(site, "10000000"); assert.deepEqual(permissions, ["orders.view"]);
      return { merchantId: site, actor: owner };
    },
    isManagementEnabled: async () => { calls.push("module"); return true; },
    loadAttentionSummary: async () => { calls.push("summary"); return { count: 0, latest: null }; },
    listOrders: async () => { calls.push("legacy"); return []; },
    getOrder: async () => { calls.push("detail"); return null; },
    listOrdersWindow: async () => { calls.push("window"); return null; },
    ...overrides,
  };
  const request = (query = "siteId=10000000&attention=1") => handleMerchantOrdersGet(new Request(`https://launch.faolla.com/api/orders?${query}`), dependencies);
  return { calls, request };
}

test("summary is read only after owner authorization and module availability; response stays private", async () => {
  const { calls, request } = fixture();
  const response = await request();
  assert.deepEqual(calls, ["auth", "module", "summary"]);
  assert.deepEqual(await response.json(), { ok: true, attention: { count: 0, latest: null } });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
});

test("unavailable projection retains the existing order response instead of pretending count zero", async () => {
  const { calls, request } = fixture({ loadAttentionSummary: async () => null });
  const response = await request();
  assert.deepEqual(await response.json(), { ok: true, orders: [] });
  assert.deepEqual(calls, ["auth", "module", "legacy"]);
});

test("employee, untyped legacy session and inconsistent owner never access the owner summary", async () => {
  for (const session of [
    { merchantId: "10000000", actor: employee }, { merchantId: "10000000" },
    { merchantId: "20000000", actor: owner },
    { merchantId: "10000000", actor: { ...owner, siteId: "20000000" } },
  ]) {
    const { calls, request } = fixture({ resolveAdminSession: async () => session });
    assert.equal((await request()).status, 200);
    assert.deepEqual(calls, ["module", "legacy"]);
  }
});

test("invalid site, no session and disabled order module never read the projection", async () => {
  const cases: Array<[Partial<MerchantOrdersGetRouteDependencies>, number]> = [
    [{ resolveAdminSession: async () => null }, 401], [{ isManagementEnabled: async () => false }, 403],
  ];
  for (const [overrides, status] of cases) {
    const { calls, request } = fixture(overrides);
    assert.equal((await request()).status, status);
    assert.equal(calls.includes("summary"), false);
    assert.equal(calls.includes("legacy"), false);
  }
  const { calls, request } = fixture();
  assert.equal((await request("siteId=10000000&siteId=20000000&attention=1")).status, 400);
  assert.deepEqual(calls, []);
});

test("detail, window and unrequested/ambiguous summary queries retain existing paths", async () => {
  for (const [query, expected] of [
    ["siteId=10000000&attention=1&orderId=x", "detail"],
    ["siteId=10000000&attention=1&limit=20", "window"],
    ["siteId=10000000", "legacy"],
    ["siteId=10000000&attention=1&attention=0", "legacy"],
    ["siteId=10000000&attention=true", "legacy"],
  ]) {
    const { calls, request } = fixture();
    await request(query);
    assert.deepEqual(calls, ["auth", "module", expected]);
  }
});

test("personal scope never uses a merchant summary even with its flag", async () => {
  const { calls, request } = fixture({ resolvePersonalSession: async () => null });
  assert.equal((await request("scope=personal&siteId=10000000&attention=1")).status, 401);
  assert.deepEqual(calls, []);
});
