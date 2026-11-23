import assert from "node:assert/strict";
import test from "node:test";
import { readPersonalCheckoutOriginalResource } from "./merchantCheckoutOriginalResource.server";
import type { PersonalAccountSession } from "./personalAccountSession.server";
import { handlePersonalCheckoutResource } from "@/app/api/member-checkout/resource/route-handler";
const siteId = "10909095", operationKey = "a".repeat(64), accountId = "50010105", at = "2026-11-23T12:00:00Z";
const original = () => ({ method: "on_site" as const, result: { version: 2, siteId, operationKey, terms: { version: 2, method: "on_site", resourceKind: "order", resourceId: "O123", currency: "eur", grossMinor: 1000, discountMinor: 0, dueMinor: 1000, capturedMinor: 0, totalPoints: null, couponCount: 0, paymentState: "unpaid" },
  closed: false, termsMatch: true, resource: { status: "pending", updatedAt: at }, collection: null, cancellation: null, cancellationAvailable: true, cancellationPolicy: { returnCoupons: false, advanceMinutes: 0, cancellableUntil: null } } });
function fixture() {
  const request = new Request(`https://synthetic.faolla.invalid/api/member-checkout/resource?siteId=${siteId}&kind=order&id=O123`, { headers: { origin: "https://synthetic.faolla.invalid", "x-checkout-account-scope": accountId } });
  const session = { accountId, userId: "cash-resource-synthetic", servicePaused: false, user: { id: "cash-resource-synthetic", email_confirmed_at: at } } as unknown as PersonalAccountSession;
  const input = { request, siteId, kind: "order" as const, id: "O123", expectedAccountId: accountId }; let reads = 0;
  const deps = { enabled: () => true, session: async () => session, call: async (args: Record<string, unknown>, signal: AbortSignal) => {
    reads++; assert.ok(signal instanceof AbortSignal); assert.deepEqual(args, { p_site_id: siteId, p_kind: "order", p_id: "O123", p_principal_key: `account:${accountId}:cash-resource-synthetic` });
    return { data: { ...original(), privateData: "SECRET" }, error: null };
  } };
  return { input, deps, session, reads: () => reads };
}
test("personal history reads a scoped cash original once without trusting legacy email ownership or exposing raw records", async () => {
  const f = fixture(), result = await readPersonalCheckoutOriginalResource(f.input, f.deps);
  assert.deepEqual(result, original()); assert.equal(f.reads(), 1); assert.ok(!JSON.stringify(result).includes("SECRET"));
  const response = await handlePersonalCheckoutResource(f.input.request, async () => { throw new Error("no points fallback"); }, { enabled: () => true, read: input => readPersonalCheckoutOriginalResource(input, f.deps) });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, result: null, onSite: original().result });
});
test("disabled, mismatched account hint, unverified and changed identities never disclose history", async () => {
  const f = fixture(); await assert.rejects(readPersonalCheckoutOriginalResource(f.input, { ...f.deps, enabled: () => false })); assert.equal(f.reads(), 0);
  await assert.rejects(readPersonalCheckoutOriginalResource({ ...f.input, expectedAccountId: "50010106" }, f.deps), /checkout_unauthorized/); assert.equal(f.reads(), 0);
  await assert.rejects(readPersonalCheckoutOriginalResource(f.input, { ...f.deps, session: async () => ({ ...f.session, user: { ...f.session.user, email_confirmed_at: "" } }) }), /checkout_unauthorized/); assert.equal(f.reads(), 0);
  let n = 0; await assert.rejects(readPersonalCheckoutOriginalResource(f.input, { ...f.deps, session: async () => ++n === 1 ? f.session : { ...f.session, userId: "other-synthetic" } }), /checkout_unauthorized/);
});
test("failed lookup is not unlinked; scope and mixed DTO corruption fail closed without a points fallback", async () => {
  const f = fixture(); await assert.rejects(readPersonalCheckoutOriginalResource(f.input, { ...f.deps, call: async () => ({ data: null, error: { message: "SECRET" } }) }), /checkout_unavailable/);
  await assert.rejects(readPersonalCheckoutOriginalResource(f.input, { ...f.deps, call: async () => ({ data: { ...original(), result: { ...original().result, siteId: "10909096" } }, error: null }) }), /checkout_unavailable/);
  assert.equal(await readPersonalCheckoutOriginalResource(f.input, { ...f.deps, call: async () => ({ data: null, error: null }) }), null);
});
