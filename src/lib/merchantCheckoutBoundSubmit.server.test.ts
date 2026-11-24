import assert from "node:assert/strict";
import test from "node:test";
import { singleIntentFixture } from "../../scripts/fixtures/member-checkout-single-intent";
import { cartReviewFixture } from "../../scripts/fixtures/member-checkout-cart-review";
import { checkoutSubmissionRecoveryIdentity } from "./merchantCheckoutSubmissionPlan.server";
import { handleBoundCheckoutSubmit } from "./merchantCheckoutBoundSubmit.server";

for (const kind of ["points", "on-site", "cart"] as const) {
  test(`${kind}: operation binding is checked before any actual financial-service snapshot/commit dispatch`, async () => {
    const s = await singleIntentFixture(kind === "on-site" ? "on_site" : "points"), c = await cartReviewFixture();
    const principal = kind === "cart" ? c.f.principal : { accountId: s.accountId, userId: s.userId }, siteId = kind === "cart" ? c.f.siteId : s.siteId;
    const body = kind === "cart" ? c.request : { ...s.selection, nonce: s.nonce, method: kind === "points" ? "points" : "on_site", confirmationHash: "b".repeat(64), customer: s.customer };
    const operationKey = checkoutSubmissionRecoveryIdentity({ siteId, nonce: body.nonce }, principal).operationKey;
    const result = kind === "cart" ? c.result : s.original.kind === "single" ? { ...s.original.original.result, operationKey } : assert.fail();
    const session = { ...principal, servicePaused: false, user: { email_confirmed_at: "2026-01-01T00:00:00Z" } };
    const origin = "https://bound-submit.synthetic.invalid", req = (pin = operationKey, patch: Record<string, string> = {}) => new Request(origin + "/api/member-checkout/intent/bound-submit/" + kind,
      { method: "POST", headers: { origin, "content-type": "application/json", "x-checkout-account-scope": principal.accountId, "x-checkout-operation-scope": pin, ...patch }, body: JSON.stringify(body) });
    let calls = 0;
    const deps = { enabled: () => true, call: async (name: string) => { calls++; assert.match(name, /snapshot/); return { data: { replayed: true, result }, error: null }; },
      single: { session: async () => session, cashEnabled: () => true }, cart: { session: async () => session, enabled: () => true, intentEnabled: () => true } } as unknown as Parameters<typeof handleBoundCheckoutSubmit>[2];
    assert.equal((await handleBoundCheckoutSubmit(kind, req("bad"), deps)).status, 401); assert.equal(calls, 0);
    assert.notEqual((await handleBoundCheckoutSubmit(kind, req("f".repeat(64)), deps)).status, 200); assert.equal(calls, 0);
    assert.equal((await handleBoundCheckoutSubmit(kind, req(operationKey, { "x-merchant-access-token": "staff" }), deps)).status, 401); assert.equal(calls, 0);
    assert.equal((await handleBoundCheckoutSubmit(kind, req(), { ...deps, enabled: () => false })).status, 503); assert.equal(calls, 0);
    const changed = { ...session, userId: "changed-synthetic-user" };
    assert.notEqual((await handleBoundCheckoutSubmit(kind, req(), { ...deps, single: { ...deps!.single, session: async () => changed } as never, cart: { ...deps!.cart, session: async () => changed } as never })).status, 200); assert.equal(calls, 0);
    const response = await handleBoundCheckoutSubmit(kind, req(), deps); assert.equal(response.status, 200, JSON.stringify(await response.clone().json())); assert.equal(calls, 1);
  });
}
