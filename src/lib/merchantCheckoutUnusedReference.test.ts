import assert from "node:assert/strict";
import test from "node:test";
import { parseUnusedReferenceRequest, parseUnusedReferenceReview, parseClosedUnusedReference } from "./merchantCheckoutUnusedReference";
import { handleUnusedCheckoutReference, isMemberCheckoutUnusedReferenceEnabled, type UnusedReferenceDependencies } from "./merchantCheckoutUnusedReference.server";
import { checkoutSubmissionRecoveryIdentity } from "./merchantCheckoutSubmissionPlan.server";

function fixture() {
  const siteId = "10909992", principal = { accountId: "57000001", userId: "unused-synthetic-user" }, nonce = "12345678-1234-4234-8234-123456789abc";
  const { operationKey } = checkoutSubmissionRecoveryIdentity({ siteId, nonce }, principal), reviewHash = "a".repeat(64), scope = { siteId, operationKey, reviewHash };
  const input = { siteId, nonce }, review = { version: 1, siteId, operationKey, state: "unused", reviewHash, closedAt: null };
  const closure = { version: 1, siteId, operationKey, closed: true, replayed: false, reviewHash, closedAt: "2026-11-24T12:00:00Z" };
  const session = { ...principal, servicePaused: false, user: { email_confirmed_at: "2026-01-01T00:00:00Z" } } as unknown as Awaited<ReturnType<UnusedReferenceDependencies["session"]>>;
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const deps: UnusedReferenceDependencies = { enabled: () => true, session: async () => session, call: async (name, args, signal) => {
    assert.ok(signal instanceof AbortSignal); assert.equal(signal.aborted, false); calls.push({ name, args });
    return { data: name === "faolla_member_checkout_unused_reference_review_v1" ? review : closure, error: null };
  } };
  const origin = "https://unused.synthetic.invalid", req = (body: unknown, headers: Record<string, string> = {}, query = "") => new Request(origin + "/api/member-checkout/intent/test" + query,
    { method: "POST", headers: { origin, "content-type": "application/json", "x-checkout-account-scope": principal.accountId, ...headers }, body: JSON.stringify(body) });
  return { siteId, principal, scope, input, review, closure, session, calls, deps, req, reviewHash, operationKey };
}

test("unused-reference capability is closed unless its independent and every existing intent gate is exact", () => {
  const site = "10909992", env = Object.fromEntries(["PILOT", "CART_PILOT", "CART_UI_PILOT", "INTENT_PILOT"].map(k => [`MERCHANT_MEMBER_CHECKOUT_${k}_SITES`, site]));
  assert.equal(isMemberCheckoutUnusedReferenceEnabled(site, env), false); env.MERCHANT_MEMBER_CHECKOUT_UNUSED_REFERENCE_SITES = site;
  assert.equal(isMemberCheckoutUnusedReferenceEnabled(site, env), true);
  for (const value of ["", "*", site + ",", "invalid", new Array(51).fill(site).join(",")]) assert.equal(isMemberCheckoutUnusedReferenceEnabled(site, { ...env, MERCHANT_MEMBER_CHECKOUT_UNUSED_REFERENCE_SITES: value }), false);
  for (const key of Object.keys(env)) assert.equal(isMemberCheckoutUnusedReferenceEnabled(site, { ...env, [key]: "" }), false, key);
});

test("strict unused/original/closed projections cannot be confused with a release or payment proof", () => {
  const x = fixture(); assert.equal(parseUnusedReferenceReview(x.review, x.scope).state, "unused");
  assert.equal(parseUnusedReferenceReview({ ...x.review, state: "original", reviewHash: null }, x.scope).state, "original");
  assert.equal(parseUnusedReferenceReview({ ...x.review, state: "closed", closedAt: x.closure.closedAt }, x.scope).state, "closed");
  assert.equal(parseClosedUnusedReference(x.closure, x.scope).closed, true);
  for (const patch of [{ state: "closed" }, { state: "original" }, { closedAt: x.closure.closedAt }, { siteId: "10909993" }, { operationKey: "b".repeat(64) }, { nonce: x.input.nonce }])
    assert.throws(() => parseUnusedReferenceReview({ ...x.review, ...patch }, x.scope));
  for (const patch of [{ closed: false }, { replayed: null }, { closedAt: "" }, { reviewHash: "b".repeat(64) }, { resource: {} }])
    assert.throws(() => parseClosedUnusedReference({ ...x.closure, ...patch }, x.scope));
  assert.throws(() => parseClosedUnusedReference(x.review, x.scope));
  assert.throws(() => parseClosedUnusedReference({ ...x.review, state: "closed", closedAt: x.closure.closedAt }, x.scope));
});

test("strict body uses only site and UUID nonce; browser cannot supply principal, operation, deadline or amount", () => {
  const x = fixture(); assert.deepEqual(parseUnusedReferenceRequest(x.input, false), x.input);
  assert.deepEqual(parseUnusedReferenceRequest({ ...x.input, reviewHash: x.reviewHash }, true), { ...x.input, reviewHash: x.reviewHash });
  for (const close of [false, true]) for (const patch of [{ nonce: "" }, { principal: "forged" }, { operationKey: x.operationKey }, { amount: 0 }, { notAfter: "2099-01-01" }])
    assert.throws(() => parseUnusedReferenceRequest({ ...x.input, ...(close ? { reviewHash: x.reviewHash } : {}), ...patch }, close));
  assert.throws(() => parseUnusedReferenceRequest({ ...x.input, reviewHash: x.reviewHash }, false));
  assert.throws(() => parseUnusedReferenceRequest(x.input, true));
});

test("HTTP dispatches only exact read or explicit close with derived dual principal, never a financial writer", async () => {
  const x = fixture();
  for (const close of [false, true]) {
    const r = await handleUnusedCheckoutReference(close, x.req({ ...x.input, ...(close ? { reviewHash: x.reviewHash } : {}) }), x.deps);
    assert.equal(r.status, 200); const value = await r.json(); assert.equal(value.ok, true); assert.equal(value.readOnly, close ? undefined : true);
    assert.match(r.headers.get("cache-control")!, /private, no-store/); assert.match(r.headers.get("vary")!, /X-Checkout-Account-Scope/i);
    const call = x.calls.at(-1)!; assert.equal(call.args.p_operation_key, x.operationKey); assert.equal(call.args.p_principal_key, `account:${x.principal.accountId}:${x.principal.userId}`);
    assert.equal("nonce" in call.args, false); if (close) assert.ok(Date.parse(String(call.args.p_not_after)) <= Date.now() + 11_000);
    assert.ok(!JSON.stringify(value).includes(x.input.nonce)); assert.ok(!JSON.stringify(value).includes(x.principal.userId));
  }
  assert.deepEqual(x.calls.map(c => c.name), ["faolla_member_checkout_unused_reference_review_v1", "faolla_member_checkout_close_unused_reference_v1"]);
});

test("HTTP rejects foreign origin, staff, malformed input, disabled rollout and unverified identities before dispatch", async () => {
  const x = fixture(), body = { ...x.input, reviewHash: x.reviewHash };
  for (const [request, status] of [[x.req(body, { origin: "https://foreign.invalid" }), 403], [x.req(body, { "x-merchant-access-token": "private" }), 401],
    [x.req(body, { "x-checkout-account-scope": "" }), 401], [x.req(body, {}, "?release=1"), 400], [x.req({ ...body, operationKey: x.operationKey }), 400],
    [x.req({ ...body, extra: "x".repeat(1024) }), 400], [new Request(x.req(body), { body: new Uint8Array([123, 255, 125]) }), 400]] as const)
    assert.equal((await handleUnusedCheckoutReference(true, request, x.deps)).status, status);
  assert.equal((await handleUnusedCheckoutReference(true, x.req(body), { ...x.deps, enabled: () => false })).status, 503);
  for (const session of [null, { ...x.session!, accountId: "59999999" }, { ...x.session!, servicePaused: true }, { ...x.session!, user: { email_confirmed_at: "" } }])
    assert.equal((await handleUnusedCheckoutReference(true, x.req(body), { ...x.deps, session: async () => session as typeof x.session })).status, 401);
  assert.equal(x.calls.length, 0);
});

test("lost close response, malformed proof, abort or post-dispatch identity/rollout loss stays unknown with no retry", async () => {
  for (const mode of ["lost", "malformed", "identity", "gate", "abort"] as const) {
    const x = fixture(), abort = new AbortController(); let sent = 0;
    const response = await handleUnusedCheckoutReference(true, new Request(x.req({ ...x.input, reviewHash: x.reviewHash }), { signal: abort.signal }), { ...x.deps,
      enabled: () => !(sent && mode === "gate"), session: async () => sent && mode === "identity" ? null : x.session,
      call: async () => { sent++; if (mode === "lost") throw new Error("PRIVATE"); if (mode === "abort") { abort.abort(); return new Promise(() => {}); }
        return { data: mode === "malformed" ? {} : x.closure, error: null }; } });
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "checkout_unused_unconfirmed" }); assert.equal(sent, 1);
  }
});

test("only explicit SQL rollback conflicts are exposed, never storage/private errors or a release permission", async () => {
  const x = fixture();
  for (const code of ["checkout_unused_busy", "checkout_unused_disabled", "checkout_unused_changed", "checkout_unused_expired", "checkout_original_exists", "PRIVATE"] ) {
    const r = await handleUnusedCheckoutReference(true, x.req({ ...x.input, reviewHash: x.reviewHash }), { ...x.deps, call: async () => ({ data: null, error: { message: code } }) });
    assert.equal(r.status, code === "PRIVATE" ? 503 : 409); assert.deepEqual(await r.json(), { error: code === "PRIVATE" ? "checkout_unused_unconfirmed" : code });
  }
});

test("stalled authentication or body cancellation cannot resume a late close", async () => {
  const x = fixture(), abort = new AbortController(); let release!: (v: typeof x.session) => void;
  const p = handleUnusedCheckoutReference(true, new Request(x.req({ ...x.input, reviewHash: x.reviewHash }), { signal: abort.signal }), { ...x.deps, session: () => new Promise(resolve => { release = resolve; }) });
  while (!release) await new Promise(resolve => setImmediate(resolve)); abort.abort(); assert.equal((await p).status, 503); release(x.session);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(x.calls.length, 0);
  const stop = new AbortController(), body = new Request(x.req(x.input), { signal: stop.signal, body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("{")); } }), duplex: "half" } as RequestInit);
  const pending = handleUnusedCheckoutReference(false, body, x.deps); stop.abort(); assert.equal((await pending).status, 503); assert.equal(x.calls.length, 0);
});

test("slow session checks cannot renew the 11-second write dispatch deadline", async context => {
  const x = fixture(); let now = Date.now(); context.mock.method(Date, "now", () => now);
  const r = await handleUnusedCheckoutReference(true, x.req({ ...x.input, reviewHash: x.reviewHash }), { ...x.deps, session: async () => { now += 11_500; return x.session; } });
  assert.equal(r.status, 503); assert.equal(x.calls.length, 0);
});
