import assert from "node:assert/strict";
import test from "node:test";
import { handleOnSiteCheckout, type OnSiteHttpAction, type OnSiteHttpDependencies } from "./merchantCheckoutOnSiteHttp.server";
import { isMemberCheckoutOnSitePilotEnabled } from "./merchantCheckoutOnSitePilot.server";
import { checkoutSubmissionRecoveryIdentity } from "./merchantCheckoutSubmissionPlan.server";
const siteId = "10909095", operationKey = "a".repeat(64), at = "2026-11-23T12:00:00Z", nonce = "33333333-3333-4333-8333-333333333333", origin = "https://synthetic.faolla.invalid";
const principal = { accountId: "50010105", userId: "cash-http-synthetic" };
const view = () => ({ version: 2, siteId, operationKey, terms: { version: 2, method: "on_site", resourceKind: "order", resourceId: "O123", currency: "eur", grossMinor: 1000, discountMinor: 200, dueMinor: 800, capturedMinor: 0, totalPoints: null, couponCount: 1, paymentState: "unpaid" },
  closed: false, termsMatch: true, resource: { status: "pending", updatedAt: at }, collection: null, cancellation: null, cancellationAvailable: true, cancellationPolicy: { returnCoupons: true, advanceMinutes: 0, cancellableUntil: null } });
const cancellation = () => ({ version: 2, method: "on_site", siteId, operationKey, resourceKind: "order", resourceId: "O123", closed: true, cashReturnedMinor: 0, pointsReturned: 0, couponsReturned: 1, stockReleased: 1, cancelledAt: at });
const submit = { siteId, offerId: "11111111-1111-4111-8111-111111111111", offerRevision: "22222222-2222-4222-8222-222222222222", quantity: 1, couponClaims: [], method: "on_site", nonce, confirmationHash: "b".repeat(64), customer: { name: "Synthetic", title: "", email: "synthetic@example.invalid", phone: "000000000", note: "" } };
const input = (action: OnSiteHttpAction) => action === "preview" || action === "submit" ? submit : action === "recover" ? { siteId, nonce } : { siteId, operationKey, ...(action === "cancel" ? { expectedUpdatedAt: at } : {}) };
function fixture() {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [], user = { id: principal.userId, email_confirmed_at: at };
  const session = { ...principal, user, servicePaused: false } as unknown as NonNullable<Awaited<ReturnType<OnSiteHttpDependencies["session"]>>>;
  const deps: OnSiteHttpDependencies = { enabled: () => true, session: async () => session, call: async (name, args, signal) => {
    assert.ok(signal instanceof AbortSignal); calls.push({ name, args: structuredClone(args) });
    return { data: name.includes("cancel") ? { replayed: false, receipt: cancellation() } : view(), error: null };
  } };
  const request = (action: OnSiteHttpAction, value: unknown = input(action), headers: HeadersInit = {}, suffix = "") => new Request(`${origin}/api/member-checkout/on-site/${action}${suffix}`, { method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: typeof value === "string" ? value : JSON.stringify(value) });
  return { deps, calls, user, session, request };
}
test("cash needs both explicit allowlists; absent, malformed or ordinary points configuration never enables it", () => {
  assert.equal(isMemberCheckoutOnSitePilotEnabled(siteId, {}), false);
  assert.equal(isMemberCheckoutOnSitePilotEnabled(siteId, { MERCHANT_MEMBER_CHECKOUT_PILOT_SITES: siteId }), false);
  assert.equal(isMemberCheckoutOnSitePilotEnabled(siteId, { MERCHANT_MEMBER_CHECKOUT_ON_SITE_PILOT_SITES: siteId }), false);
  for (const raw of ["", "*", `${siteId},`, `${siteId},bad`, "10909096"]) assert.equal(isMemberCheckoutOnSitePilotEnabled(siteId, { MERCHANT_MEMBER_CHECKOUT_PILOT_SITES: siteId, MERCHANT_MEMBER_CHECKOUT_ON_SITE_PILOT_SITES: raw }), false);
  assert.equal(isMemberCheckoutOnSitePilotEnabled(siteId, { MERCHANT_MEMBER_CHECKOUT_PILOT_SITES: siteId, MERCHANT_MEMBER_CHECKOUT_ON_SITE_PILOT_SITES: siteId }), true);
});
test("all five disabled cash actions have no session or storage IO", async () => {
  for (const action of ["preview", "submit", "recover", "result", "cancel"] as OnSiteHttpAction[]) {
    const f = fixture(); f.deps.enabled = () => false; f.deps.session = async () => { throw new Error("unexpected session"); };
    const response = await handleOnSiteCheckout(action, f.request(action), f.deps); assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "checkout_disabled" }); assert.equal(f.calls.length, 0);
  }
});
test("origin, method, token, query, encoding, content, size and financial-body injection are rejected before IO", async () => {
  const f = fixture(); let sessions = 0; f.deps.session = async () => { sessions++; return f.session; };
  for (const request of [new Request(origin, { method: "GET" }), f.request("result", input("result"), { origin: "https://foreign.invalid" }), f.request("result", input("result"), { "x-merchant-access-token": "invalid" }),
    f.request("result", input("result"), {}, "?paid=true"), f.request("result", input("result"), { "content-type": "text/plain" }), f.request("result", "{"), f.request("result", " ".repeat(16385)),
    f.request("result", { ...input("result"), memberId: "foreign" }), f.request("cancel", { ...input("cancel"), amountMinor: 800 }), f.request("submit", { ...submit, dueMinor: 1 }),
    new Request(origin, { method: "POST", headers: { origin, "content-type": "application/json" }, body: new Uint8Array([0xff, 0xfe]) })]) assert.ok((await handleOnSiteCheckout("result", request, f.deps)).status >= 400);
  assert.equal(sessions, 0); assert.equal(f.calls.length, 0);
  for (const action of ["preview", "submit"] as const) assert.equal((await handleOnSiteCheckout(action, f.request(action, { ...submit, totalPoints: 0 }), f.deps)).status, 400);
  assert.equal(sessions, 0); assert.equal(f.calls.length, 0);
});
test("unverified, paused or absent personal identity never reaches any data port", async () => {
  for (const mode of ["none", "paused", "unverified"]) for (const action of ["preview", "submit", "recover", "result", "cancel"] as OnSiteHttpAction[]) {
    const f = fixture(); if (mode === "none") f.deps.session = async () => null; if (mode === "paused") f.session.servicePaused = true; if (mode === "unverified") f.user.email_confirmed_at = "";
    assert.equal((await handleOnSiteCheckout(action, f.request(action), f.deps)).status, 401); assert.equal(f.calls.length, 0);
  }
});
test("result and cancellation use actual principal, safe projections and one original mutation", async () => {
  const f = fixture(), read = await handleOnSiteCheckout("result", f.request("result"), f.deps);
  assert.equal(read.status, 200); assert.deepEqual((await read.json()).result, view()); assert.match(read.headers.get("cache-control")!, /no-store/);
  assert.equal(f.calls[0].args.p_principal_key, `account:${principal.accountId}:${principal.userId}`);
  assert.equal((await handleOnSiteCheckout("cancel", f.request("cancel"), f.deps)).status, 200); assert.equal(f.calls.length, 2); assert.equal(f.calls[1].args.p_expected_updated_at, at);
});
test("method-neutral recovery reads the exact original nonce, returns no financial authority and retains unknown", async () => {
  const f = fixture(), identity = checkoutSubmissionRecoveryIdentity({ siteId, nonce }, principal);
  f.deps.call = async (name, args) => { f.calls.push({ name, args }); assert.equal(name, "faolla_member_checkout_original_result_v1"); assert.equal(args.p_operation_key, identity.operationKey);
    return { data: { method: "on_site", result: { ...view(), operationKey: identity.operationKey, secret: "SECRET" } }, error: null }; };
  const response = await handleOnSiteCheckout("recover", f.request("recover"), f.deps), payload = await response.json();
  assert.equal(response.status, 200); assert.equal(payload.original.method, "on_site"); assert.ok(!JSON.stringify(payload).includes("SECRET"));
  f.deps.call = async () => ({ data: null, error: null }); assert.deepEqual(await (await handleOnSiteCheckout("recover", f.request("recover"), f.deps)).json(), { ok: true, state: "unconfirmed" });
});
test("late identity change hides reads and leaves written cancellation unknown without retries", async () => {
  for (const action of ["result", "cancel"] as OnSiteHttpAction[]) {
    const f = fixture(); f.deps.session = async () => f.calls.length ? { ...f.session, accountId: "50010106" } : f.session;
    const response = await handleOnSiteCheckout(action, f.request(action), f.deps); assert.equal(response.status, action === "cancel" ? 503 : 401); assert.equal(f.calls.length, 1);
    assert.ok(!JSON.stringify(await response.json()).includes("O123"));
  }
});
test("unavailable, malformed and unknown write results never leak SQL or retry", async () => {
  for (const mode of ["lost", "sql", "malformed"]) {
    const f = fixture(); let calls = 0; f.deps.call = async () => { calls++; if (mode === "lost") throw new Error("SECRET SQL"); return mode === "sql" ? { data: null, error: { message: "SECRET SQL" } } : { data: {}, error: null }; };
    const response = await handleOnSiteCheckout("cancel", f.request("cancel"), f.deps); assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "checkout_unconfirmed" }); assert.equal(calls, 1);
  }
});
