import assert from "node:assert/strict";
import test from "node:test";
import { handlePersonalCheckoutResource } from "./route-handler";
import { CheckoutLegacyBoundaryError } from "@/lib/merchantCheckoutLegacyBoundary.server";
const origin = "https://launch.faolla.com", query = "?siteId=10909095&kind=booking&id=B-synthetic";
const request = (suffix = query, headers = {}) => new Request(origin + "/api/member-checkout/resource" + suffix, { headers: { origin, ...headers } });

test("resource entry is a private read carrying only an original record key and expected account hint", async () => {
  let calls = 0;
  const response = await handlePersonalCheckoutResource(request(query, { "x-checkout-account-scope": "50010105" }), async input => {
    calls++; assert.equal(input.siteId, "10909095"); assert.equal(input.id, "B-synthetic"); assert.equal(input.kind, "booking"); assert.equal(input.expectedAccountId, "50010105"); return null;
  });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, result: null }); assert.equal(calls, 1);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});
test("bad, authority-bearing, duplicate, cross-origin and business-token lookups do not dispatch", async () => {
  const read = async () => { assert.fail("must not read"); };
  for (const suffix of [query + "&principalKey=other", query + "&id=B-synthetic", query.replace("booking", "cash"), query.replace("B-synthetic", "bad%2Fid"), ""]) {
    assert.equal((await handlePersonalCheckoutResource(request(suffix), read)).status, 400);
  }
  assert.equal((await handlePersonalCheckoutResource(request(query, { origin: "https://evil.invalid" }), read)).status, 403);
  assert.equal((await handlePersonalCheckoutResource(request(query, { "x-merchant-access-token": "not-a-personal-session" }), read)).status, 401);
  assert.equal((await handlePersonalCheckoutResource(request(query, { "x-checkout-account-scope": "invalid" }), read)).status, 400);
});
test("resource errors are sanitized; not found never becomes an unlinked/unpaid answer", async () => {
  for (const mode of ["private", "foreign"] as const) {
    const response = await handlePersonalCheckoutResource(request(), async () => { throw mode === "private" ? new Error("PRIVATE SQL customer@example.invalid") : new CheckoutLegacyBoundaryError("checkout_not_found", 404); });
    assert.equal(response.status, mode === "private" ? 503 : 404); assert.deepEqual(await response.json(), { error: mode === "private" ? "checkout_unavailable" : "checkout_not_found" });
  }
});
test("HTTP allowlist strips future private source fields and rejects a mismatched resource", async () => {
  const result = { version: 1 as const, siteId: "10909095", operationKey: "a".repeat(64), resourceKind: "booking" as const, resourceId: "B-synthetic", totalPoints: 100, couponCount: 0, closed: false,
    resource: { status: "active", updatedAt: "2026-11-23T12:00:00Z" }, cancellationAvailable: false, cancellation: null,
    cancellationPolicy: { returnPoints: true, returnCoupons: false, advanceMinutes: 0, cancellableUntil: "2030-01-01T00:00:00Z" } };
  const response = await handlePersonalCheckoutResource(request(), async () => ({ ...result, privateSnapshot: "PRIVATE", editToken: "PRIVATE" }));
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, result });
  const foreign = await handlePersonalCheckoutResource(request(), async () => ({ ...result, resourceId: "different-resource" }));
  assert.equal(foreign.status, 503); assert.deepEqual(await foreign.json(), { error: "checkout_unavailable" });
});
