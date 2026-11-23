import assert from "node:assert/strict";
import test from "node:test";
import { cartReviewFixture } from "../../scripts/fixtures/member-checkout-cart-review";
import { handleCartCheckout, type CartHttpDependencies } from "./merchantCheckoutCartHttp.server";
import { isMemberCheckoutCartPilotEnabled } from "./merchantCheckoutCartPilot.server";
const origin = "https://synthetic.faolla.invalid";
const req = (raw: unknown, headers: Record<string, string> = {}, query = "") => new Request(`${origin}/api/member-checkout/cart/submit${query}`, { method: "POST",
  headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(raw) });
async function fixture(method: "points" | "on_site" = "points") {
  const x = await cartReviewFixture(method), calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const session = { ...x.f.principal, servicePaused: false, user: { email_confirmed_at: new Date().toISOString() } } as unknown as Awaited<ReturnType<CartHttpDependencies["session"]>>;
  const deps: CartHttpDependencies = { enabled: () => true, session: async () => session, call: async (name, args, signal) => {
    calls.push({ name, args }); assert.ok(signal instanceof AbortSignal);
    if (name.includes("snapshot")) return { data: { replayed: false, snapshot: x.snapshotFor(x.request) }, error: null };
    if (name.includes("commit")) return { data: { replayed: false, result: { ...x.result, resourceId: (args.p_plan as { record: { id: string } }).record.id } }, error: null };
    if (name.includes("cancel")) return { data: { replayed: false, result: { ...x.result, closed: true, cancellationAvailable: false, resource: { ...x.result.resource!, status: "cancelled" },
      cancellation: { pointsReturned: method === "points" ? x.result.totalPoints : 0, couponsReturned: 0, stockReleased: 2, cancelledAt: new Date().toISOString() } } }, error: null };
    return { data: x.result, error: null };
  } };
  return { ...x, calls, session, deps };
}
test("cart HTTP gate is independently closed; on-site also needs its separate cash pilot", () => {
  const site = "10909994", base = { MERCHANT_MEMBER_CHECKOUT_PILOT_SITES: site };
  assert.equal(isMemberCheckoutCartPilotEnabled(site, "points", base), false);
  const cart = { ...base, MERCHANT_MEMBER_CHECKOUT_CART_PILOT_SITES: site };
  assert.equal(isMemberCheckoutCartPilotEnabled(site, "points", cart), true); assert.equal(isMemberCheckoutCartPilotEnabled(site, "on_site", cart), false);
  assert.equal(isMemberCheckoutCartPilotEnabled(site, "on_site", { ...cart, MERCHANT_MEMBER_CHECKOUT_ON_SITE_PILOT_SITES: site }), true);
  for (const value of ["*", site + ",", new Array(51).fill(site).join(","), "other"]) assert.equal(isMemberCheckoutCartPilotEnabled(site, "points", { ...cart, MERCHANT_MEMBER_CHECKOUT_CART_PILOT_SITES: value }), false);
});
test("cart HTTP refuses foreign origin, merchant token, query data, excess fields and wrong methods before any RPC", async () => {
  const x = await fixture();
  for (const [request, expected] of [[req(x.request, { origin: "https://foreign.invalid" }), 403], [req(x.request, { "x-merchant-access-token": "private" }), 401],
    [req(x.request, {}, "?memberId=other"), 400], [req({ ...x.request, paid: true }), 400], [new Request(origin), 405]] as const) {
    assert.equal((await handleCartCheckout("submit", request, x.deps)).status, expected);
  } assert.equal(x.calls.length, 0);
});
test("cart HTTP body is exact JSON, bounded by bytes and strict UTF-8", async () => {
  const x = await fixture();
  for (const request of [req(x.request, { "content-type": "text/plain" }), req({ ...x.request, customer: { ...x.customer, note: "x".repeat(17_000) } }),
    new Request(origin, { method: "POST", headers: { origin, "content-type": "application/json" }, body: new Uint8Array([123, 255, 125]) }),
    new Request(origin, { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{" })]) {
    assert.equal((await handleCartCheckout("submit", request, x.deps)).status, 400);
  } assert.equal(x.calls.length, 0);
});
test("aborted never-ending request body is bounded and cannot later reach session or writes", async () => {
  const x = await fixture(), abort = new AbortController(); let sessions = 0;
  const request = new Request(origin, { method: "POST", headers: { origin, "content-type": "application/json" }, signal: abort.signal,
    body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("{")); } }), duplex: "half" } as RequestInit);
  const pending = handleCartCheckout("submit", request, { ...x.deps, session: async () => { sessions++; return x.session; } });
  setImmediate(() => abort.abort()); assert.equal((await pending).status, 503); assert.equal(sessions, 0); assert.equal(x.calls.length, 0);
});
test("default closed route cannot reach a live client; preview/submit require verified unpaused personal identity", async () => {
  const x = await fixture(); let sessions = 0;
  const closed = await handleCartCheckout("submit", req(x.request), { ...x.deps, enabled: () => false, session: async () => { sessions++; return x.session; } });
  assert.equal(closed.status, 503); assert.equal(sessions, 0);
  for (const session of [null, { ...x.session!, servicePaused: true }, { ...x.session!, user: { email_confirmed_at: null } }]) {
    assert.equal((await handleCartCheckout("preview", req(x.request), { ...x.deps, session: async () => session as typeof x.session })).status, 401);
  } assert.equal(x.calls.length, 0);
});
test("trusted cart HTTP preview returns own safe choices from the same read; never writes or leaks raw rows", async () => {
  const x = await fixture(); const response = await handleCartCheckout("preview", req(x.request), x.deps), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.quote.lines.length, 2); assert.equal(body.couponChoices.length, 2); assert.equal(body.quote.canSubmit, false);
  assert.equal(x.calls.length, 1); assert.ok(!/memberId|rawMember|pointTransaction|sourceRows|domainRows|settlementCode|redeemEvents|claimEvents|synthetic@example/.test(JSON.stringify(body)));
  assert.match(response.headers.get("cache-control")!, /private, no-store/); assert.match(response.headers.get("vary")!, /Cookie/);
});
test("points and on-site cart HTTP submit one aggregate financial RPC, with no browser cash-paid state", async () => {
  for (const method of ["points", "on_site"] as const) {
    const x = await fixture(method), response = await handleCartCheckout("submit", req(x.request), x.deps), body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body)); assert.equal(body.result.method, method); assert.equal(body.result.capturedMinor, 0);
    assert.equal(x.calls.filter(c => c.name.includes("commit")).length, 1); assert.equal(x.calls.length, 2);
  }
});
test("identity or write gate loss after snapshot prevents any commit", async () => {
  for (const mode of ["identity", "gate"] as const) {
    const x = await fixture(), response = await handleCartCheckout("submit", req(x.request), { ...x.deps,
      enabled: () => mode !== "gate" || x.calls.length === 0,
      session: async () => mode === "identity" && x.calls.length ? null : x.session });
    assert.notEqual(response.status, 200); assert.equal(x.calls.filter(c => c.name.includes("commit")).length, 0);
  }
});
test("identity loss after commit, lost response or malformed response returns unknown without another write", async () => {
  for (const mode of ["identity", "lost", "bad"] as const) {
    const x = await fixture(), response = await handleCartCheckout("submit", req(x.request), { ...x.deps,
      session: async () => mode === "identity" && x.calls.some(c => c.name.includes("commit")) ? null : x.session,
      call: async (name, args, signal) => { const r = await x.deps.call(name, args, signal); if (!name.includes("commit")) return r;
        if (mode === "lost") throw new Error("PRIVATE SQL ERROR"); return mode === "bad" ? { data: {}, error: null } : r; } });
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "checkout_unconfirmed" }); assert.equal(x.calls.filter(c => c.name.includes("commit")).length, 1);
  }
});
test("cart recovery/result and cancellation remain available after closing new-purchase pilot", async () => {
  const x = await fixture(), deps = { ...x.deps, enabled: () => false };
  for (const [action, raw] of [["recover", { siteId: x.f.siteId, nonce: x.request.nonce }], ["result", { siteId: x.f.siteId, operationKey: x.result.operationKey }],
    ["cancel", { siteId: x.f.siteId, operationKey: x.result.operationKey, expectedUpdatedAt: x.result.resource!.updatedAt }]] as const) {
    const response = await handleCartCheckout(action, req(raw), deps); assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  }
  assert.equal(x.calls.filter(c => c.name.includes("cancel")).length, 1); assert.equal(x.calls.filter(c => c.name.includes("commit")).length, 0);
});
test("shared-nonce fallback reads only a safe old single original; null is explicitly unconfirmed", async () => {
  for (const found of [false, true]) {
    const x = await fixture(), single = { version: 1, siteId: x.f.siteId, operationKey: x.result.operationKey, resourceKind: "order", resourceId: "old-original", totalPoints: 10, couponCount: 0,
      closed: false, resource: { status: "pending", updatedAt: new Date().toISOString() }, cancellationAvailable: false, cancellationPolicy: null, cancellation: null };
    const response = await handleCartCheckout("recover", req({ siteId: x.f.siteId, nonce: x.request.nonce }), { ...x.deps, enabled: () => false,
      call: async (name, args) => { x.calls.push({ name, args }); return { data: name.includes("original_result") && found ? { method: "points", result: single } : null, error: null }; } });
    assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.state, found ? "confirmed" : "unconfirmed"); if (found) assert.equal(body.original.kind, "single");
    assert.deepEqual(x.calls.map(c => c.name), ["faolla_member_checkout_cart_result_v1", "faolla_member_checkout_original_result_v1"]);
    assert.equal(x.calls[0].args.p_principal_key, `account:${x.f.principal.accountId}:${x.f.principal.userId}`);
  }
});
test("read failure is not a null original and cross-account result is never exposed", async () => {
  for (const mode of ["error", "scope", "identity"] as const) {
    const x = await fixture(); let reads = 0;
    const response = await handleCartCheckout("recover", req({ siteId: x.f.siteId, nonce: x.request.nonce }), { ...x.deps,
      session: async () => reads && mode === "identity" ? null : x.session,
      call: async () => { reads++; return mode === "error" ? { data: null, error: { message: "PRIVATE" } } : { data: mode === "scope" ? { ...x.result, siteId: "10909993" } : x.result, error: null }; } });
    assert.notEqual(response.status, 200); assert.ok(!JSON.stringify(await response.json()).includes(x.result.resourceId)); assert.equal(reads, 1);
  }
});
