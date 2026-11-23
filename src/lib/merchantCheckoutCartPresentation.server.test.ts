import assert from "node:assert/strict";
import test from "node:test";
import { cartReviewFixture } from "../../scripts/fixtures/member-checkout-cart-review";
import { handleCheckoutReporting, type CheckoutReportingDependencies } from "../app/api/merchant-checkout/settlements/route-handler";
import { handlePersonalCheckoutResource } from "../app/api/member-checkout/resource/route-handler";
import { parseCheckoutReportingSnapshot } from "./merchantCheckoutReporting";
import type { MerchantBusinessActor } from "./merchantBusinessActor.server";
const origin = "https://cart.synthetic.invalid";
async function fixture() {
  const x = await cartReviewFixture(), scope = { siteId: x.f.siteId, resources: [{ kind: "order" as const, id: x.result.resourceId }] };
  const report = parseCheckoutReportingSnapshot({ version: 3, siteId: scope.siteId, rows: [{ ...scope.resources[0], result: null, termsMatch: true, cart: x.result }] }, scope);
  const owner: MerchantBusinessActor = { type: "owner", siteId: x.f.siteId, authUserId: "synthetic-owner", principalKey: "owner:synthetic-owner", authorizationVersion: "owner",
    displayName: "PRIVATE", email: "private@example.invalid", authorizationSource: "database", collaborationPermissions: [], businessPermissions: [] };
  const calls: string[] = [];
  const deps: CheckoutReportingDependencies = { enabled: () => true, cartEnabled: () => true, mixedEnabled: () => true, collectionEnabled: () => true,
    actor: async () => { calls.push("actor"); return owner; }, site: async () => { calls.push("site"); return x.f.site; },
    read: async () => { assert.fail("no old points fallback"); }, readMixed: async () => { assert.fail("no old cash fallback"); }, readCart: async () => { calls.push("cart"); return report; } };
  const request = () => new Request(origin + "/api/merchant-checkout/settlements", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(scope) });
  const personal = () => new Request(`${origin}/api/member-checkout/resource?siteId=${x.f.siteId}&kind=order&id=${encodeURIComponent(x.result.resourceId)}`, { headers: { origin, "x-checkout-account-scope": x.f.principal.accountId } });
  return { ...x, scope, report, deps, calls, owner, request, personal };
}
test("merchant v3 route is still actual-owner bound and does not fall back or expose private metadata", async () => {
  const x = await fixture(), response = await handleCheckoutReporting(x.request(), x.deps), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.snapshot.version, 3); assert.equal(body.snapshot.rows[0].cart.resourceId, x.result.resourceId);
  assert.ok(!JSON.stringify(body).includes("PRIVATE")); assert.deepEqual(x.calls, ["actor", "site", "actor", "site", "cart", "actor", "site"]);
  assert.match(response.headers.get("cache-control")!, /private, no-store/);
});
test("v3 report failure, old format or gate loss never retries incomplete old projections", async () => {
  for (const mode of ["error", "format", "gate"] as const) {
    const x = await fixture(); let enabled = true;
    const response = await handleCheckoutReporting(x.request(), { ...x.deps, cartEnabled: () => enabled,
      readCart: async () => { x.calls.push("cart"); if (mode === "error") throw new Error("PRIVATE SQL"); if (mode === "gate") enabled = false; return { ...x.report, version: mode === "format" ? 2 : 3 }; } });
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "checkout_reporting_unavailable" }); assert.equal(x.calls.filter(c => c === "cart").length, 1);
  }
});
test("a v3 report is refused by the old HTTP mode, not treated as an enabled cart capability", async () => {
  const x = await fixture(), response = await handleCheckoutReporting(x.request(), { ...x.deps, cartEnabled: () => false, mixedEnabled: () => false, read: async () => x.report });
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "checkout_reporting_unavailable" });
});
test("employees and changed owner generation cannot receive a cart report", async () => {
  for (const mode of ["employee", "changed"] as const) {
    const x = await fixture(); let actors = 0;
    const response = await handleCheckoutReporting(x.request(), { ...x.deps, actor: async () => {
      actors++; return mode === "employee" ? { ...x.owner, type: "employee" } as unknown as MerchantBusinessActor : actors >= 3 ? { ...x.owner, authUserId: "other-owner" } : x.owner;
    } }); assert.equal(response.status, 403); assert.ok(!JSON.stringify(await response.json()).includes(x.result.resourceId));
    if (mode === "employee") assert.equal(x.calls.includes("cart"), false);
  }
});
test("personal history selects v3 only under its independent gate and verifies the original resource", async () => {
  const x = await fixture(); let calls = 0;
  const response = await handlePersonalCheckoutResource(x.personal(), async () => { assert.fail("no old lookup"); }, {
    cartEnabled: () => true, readCart: async input => { calls++; assert.equal(input.expectedAccountId, x.f.principal.accountId); assert.equal(input.id, x.result.resourceId); return { kind: "cart", result: x.result }; } });
  assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.result, null); assert.equal(body.cart.resourceId, x.result.resourceId); assert.equal(calls, 1);
  assert.match(response.headers.get("vary")!, /Cookie/);
});
test("personal v3 history preserves old single result shape, but errors and contradictory keys stay unavailable", async () => {
  const x = await fixture(), single = { version: 1 as const, siteId: x.f.siteId, operationKey: x.result.operationKey, resourceKind: "order" as const, resourceId: x.result.resourceId,
    totalPoints: 100, couponCount: 0, closed: false, resource: x.result.resource, cancellationAvailable: false, cancellationPolicy: null, cancellation: null };
  const old = async () => { assert.fail("no legacy fallback"); };
  const response = await handlePersonalCheckoutResource(x.personal(), old, { cartEnabled: () => true, readCart: async () => ({ kind: "single", original: { method: "points", result: single } }) });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, result: single });
  for (const mode of ["error", "scope", "gate"] as const) {
    let enabled = true;
    const r = await handlePersonalCheckoutResource(x.personal(), old, { cartEnabled: () => enabled, readCart: async () => {
      if (mode === "error") throw new Error("PRIVATE"); if (mode === "gate") enabled = false; return { kind: "cart", result: { ...x.result, resourceId: mode === "scope" ? "other" : x.result.resourceId } };
    } }); assert.equal(r.status, 503); assert.deepEqual(await r.json(), { error: "checkout_unavailable" });
  }
});
