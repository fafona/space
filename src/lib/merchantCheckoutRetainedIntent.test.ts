import assert from "node:assert/strict";
import test from "node:test";
import { cartReviewFixture } from "../../scripts/fixtures/member-checkout-cart-review";
import { createCartCheckoutController } from "./merchantCheckoutCartClient";
import { checkoutClientStorageKey, CheckoutClientError, type CheckoutClientRequest } from "./merchantCheckoutClient";
import { parseRetainedIntentRequest, parseRetainedIntentReview, parseRetainedIntentRegistration } from "./merchantCheckoutRetainedIntent";
import { handleRetainedCheckoutIntent, isMemberCheckoutRetainedIntentEnabled, type RetainedIntentDependencies } from "./merchantCheckoutRetainedIntent.server";
import { handleCartCheckoutEntry } from "../app/api/member-checkout/cart/entry/route-handler";

async function fixture() {
  const x = await cartReviewFixture(), siteId = x.f.siteId, operationKey = x.result.operationKey, reviewHash = "a".repeat(64), original = { kind: "cart" as const, result: x.result };
  const scope = { siteId, operationKey, reviewHash }, input = { siteId, nonce: x.request.nonce }, proposal = { reviewHash, original, reviewRequired: false };
  const review = { operationKey, reviewHash, original, reviewRequired: false, generation: 1, acknowledged: false };
  const registration = { version: 1, siteId, replayed: false, review }, session = { ...x.f.principal, servicePaused: false, user: { email_confirmed_at: new Date().toISOString() } } as unknown as Awaited<ReturnType<RetainedIntentDependencies["session"]>>;
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const deps: RetainedIntentDependencies = { enabled: () => true, session: async () => session, call: async (name, args, signal) => {
    assert.ok(signal instanceof AbortSignal); calls.push({ name, args });
    return { data: name === "faolla_member_checkout_retained_intent_review_v1" ? { version: 1, siteId, operationKey, proposal } : registration, error: null };
  } };
  const origin = "https://retained.synthetic.invalid", req = (body: unknown, headers: Record<string, string> = {}, query = "") => new Request(origin + "/api/member-checkout/intent/test" + query,
    { method: "POST", headers: { origin, "content-type": "application/json", "x-checkout-account-scope": x.f.principal.accountId, ...headers }, body: JSON.stringify(body) });
  return { ...x, siteId, operationKey, reviewHash, original, scope, input, proposal, review, registration, session, deps, calls, req };
}
test("retained registration is independently closed, with all financial and owned-draft prerequisites", () => {
  const s = "10909994", env = Object.fromEntries(["PILOT", "CART_PILOT", "CART_UI_PILOT", "INTENT_PILOT", "ACCOUNT_DRAFT_PILOT"].map(k => [`MERCHANT_MEMBER_CHECKOUT_${k}_SITES`, s]));
  assert.equal(isMemberCheckoutRetainedIntentEnabled(s, env), false); env.MERCHANT_MEMBER_CHECKOUT_RETAINED_INTENT_SITES = s;
  assert.equal(isMemberCheckoutRetainedIntentEnabled(s, env), true);
  for (const value of ["*", s + ",", new Array(51).fill(s).join(","), "other"])
    assert.equal(isMemberCheckoutRetainedIntentEnabled(s, { ...env, MERCHANT_MEMBER_CHECKOUT_RETAINED_INTENT_SITES: value }), false);
  for (const key of Object.keys(env)) assert.equal(isMemberCheckoutRetainedIntentEnabled(s, { ...env, [key]: "" }), false, key);
});
test("strict proposals cannot masquerade as acknowledgement, wrong originals or unsafe registration", async () => {
  const x = await fixture(); assert.equal(parseRetainedIntentRequest(x.input, false).nonce, x.input.nonce);
  assert.equal(parseRetainedIntentReview({ version: 1, siteId: x.siteId, operationKey: x.operationKey, proposal: null }, x.scope), null);
  assert.equal(parseRetainedIntentRegistration(x.registration, x.scope).review.acknowledged, false);
  for (const raw of [{ ...x.input, confirmed: true }, { ...x.input, reviewHash: x.reviewHash }, { ...x.input, nonce: "" }]) assert.throws(() => parseRetainedIntentRequest(raw, false));
  for (const raw of [{ ...x.input, operationKey: x.operationKey }, { ...x.input, reviewHash: "x" }]) assert.throws(() => parseRetainedIntentRequest(raw, true));
  for (const proposal of [{ ...x.proposal, acknowledged: true }, { ...x.proposal, reviewHash: "x" }, { ...x.proposal, original: null }])
    assert.throws(() => parseRetainedIntentReview({ version: 1, siteId: x.siteId, operationKey: x.operationKey, proposal }, x.scope));
  assert.throws(() => parseRetainedIntentRegistration({ ...x.registration, review: { ...x.review, reviewRequired: true } }, x.scope));
});
test("HTTP uses one fixed proposal/read or explicit append RPC, derived nonce operation and real dual principal", async () => {
  const x = await fixture();
  for (const register of [false, true]) {
    const response = await handleRetainedCheckoutIntent(register, x.req(register ? { ...x.input, reviewHash: x.reviewHash } : x.input), x.deps);
    assert.equal(response.status, 200); const v = await response.json(); assert.equal(v.ok, true); assert.equal(v.readOnly, register ? undefined : true);
    if (!register) assert.deepEqual(Object.keys(v.proposal).sort(), ["original", "reviewHash", "reviewRequired"]);
    assert.match(response.headers.get("cache-control")!, /private, no-store/); assert.equal(x.calls.at(-1)!.args.p_operation_key, x.operationKey);
    assert.equal(x.calls.at(-1)!.args.p_principal_key, `account:${x.f.principal.accountId}:${x.f.principal.userId}`);
    assert.equal("nonce" in x.calls.at(-1)!.args, false); if (register) assert.ok(Date.parse(String(x.calls.at(-1)!.args.p_not_after)) <= Date.now() + 11_000);
  } assert.equal(x.calls.length, 2);
});
test("HTTP rejects foreign origin, staff token, queries, excess fields, malformed bytes and disabled/unverified identities before dispatch", async () => {
  const x = await fixture(), body = { ...x.input, reviewHash: x.reviewHash };
  for (const [req, status] of [[x.req(body, { origin: "https://other.invalid" }), 403], [x.req(body, { "x-merchant-access-token": "private" }), 401],
    [x.req(body, { "x-checkout-account-scope": "" }), 401], [x.req(body, {}, "?confirm=true"), 400], [x.req({ ...body, principal: "forged" }), 400],
    [new Request(x.req(body), { body: new Uint8Array([123, 255, 125]) }), 400], [x.req({ ...body, extra: "x".repeat(1024) }), 400]] as const)
    assert.equal((await handleRetainedCheckoutIntent(true, req, x.deps)).status, status);
  assert.equal((await handleRetainedCheckoutIntent(true, x.req(body), { ...x.deps, enabled: () => false })).status, 503);
  for (const session of [null, { ...x.session!, accountId: "59999999" }, { ...x.session!, servicePaused: true }, { ...x.session!, user: { email_confirmed_at: "" } }])
    assert.equal((await handleRetainedCheckoutIntent(true, x.req(body), { ...x.deps, session: async () => session as typeof x.session })).status, 401);
  assert.equal(x.calls.length, 0);
});
test("lost append reply, malformed proof and post-dispatch identity/gate loss remain unknown without retry or acknowledgement", async () => {
  for (const mode of ["lost", "malformed", "identity", "gate", "abort"] as const) {
    const x = await fixture(), abort = new AbortController(); let dispatched = 0;
    const response = await handleRetainedCheckoutIntent(true, new Request(x.req({ ...x.input, reviewHash: x.reviewHash }), { signal: abort.signal }), { ...x.deps,
      enabled: () => !(dispatched && mode === "gate"), session: async () => dispatched && mode === "identity" ? null : x.session,
      call: async () => { dispatched++; if (mode === "lost") throw new Error("PRIVATE"); if (mode === "abort") { abort.abort(); return new Promise(() => {}); }
        return { data: mode === "malformed" ? {} : x.registration, error: null }; } });
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "checkout_intent_unconfirmed" }); assert.equal(dispatched, 1);
  }
});
test("stalled auth and body cancellation cannot produce a late registration", async () => {
  const x = await fixture(); let release!: (v: typeof x.session) => void; const abort = new AbortController();
  const pending = handleRetainedCheckoutIntent(true, new Request(x.req({ ...x.input, reviewHash: x.reviewHash }), { signal: abort.signal }), { ...x.deps, session: () => new Promise(resolve => { release = resolve; }) });
  while (!release) await new Promise(resolve => setImmediate(resolve)); abort.abort(); assert.equal((await pending).status, 503); release(x.session);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(x.calls.length, 0);
  const stop = new AbortController(), body = new Request(x.req(x.input), { signal: stop.signal, body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("{")); } }), duplex: "half" } as RequestInit);
  const p = handleRetainedCheckoutIntent(false, body, x.deps); stop.abort(); assert.equal((await p).status, 503); assert.equal(x.calls.length, 0);
});
test("discovery exposes registration only to a verified owned-draft entry and rejects rollout changes during lookup", async () => {
  const x = await fixture(), body = { siteId: x.siteId, kind: "order", blockId: "products", viewport: "desktop" }; let enabled = true;
  const deps = { enabled: () => true, intentEnabled: () => true, draftEnabled: () => true, retainedIntentEnabled: () => enabled, session: async () => x.session, read: async () => [] };
  assert.equal((await (await handleCartCheckoutEntry(x.req(body), deps)).json()).retainedIntent, true);
  for (const patch of [{ session: async () => null }, { draftEnabled: () => false }, { intentEnabled: () => false, draftEnabled: () => false }])
    assert.equal((await (await handleCartCheckoutEntry(x.req(body), { ...deps, ...patch })).json()).retainedIntent, undefined);
  const response = await handleCartCheckoutEntry(x.req(body), { ...deps, read: async () => { enabled = false; return []; } }); assert.equal(response.status, 503);
});
test("slow identity cannot renew the overall dispatch deadline", async context => {
  const x = await fixture(); let now = Date.now(); context.mock.method(Date, "now", () => now);
  const response = await handleRetainedCheckoutIntent(true, x.req({ ...x.input, reviewHash: x.reviewHash }), { ...x.deps, session: async () => { now += 11_500; return x.session; } });
  assert.equal(response.status, 503); assert.equal(x.calls.length, 0);
});

async function clientFixture(mode = "normal", enabled = true) {
  const x = await fixture(), key = checkoutClientStorageKey(x.siteId, x.f.principal.accountId), stored = JSON.stringify({ version: 1, nonce: x.input.nonce }), store = new Map([[key, stored]]);
  let registered = false, acknowledged = false, changed = false, disposed = false; const calls: string[] = [], writes: string[] = [];
  const request: CheckoutClientRequest = async path => {
    calls.push(path);
    if (path.endsWith("cart/recover")) return { ok: true, state: "confirmed", original: x.original };
    if (path.endsWith("intent/review")) { if (mode === "reviewFailure") throw new CheckoutClientError("checkout_intent_unconfirmed", 503); return { ok: true, review: registered ? { ...x.review, acknowledged } : null }; }
    if (path.endsWith("intent/retained-review")) return { ok: true, readOnly: true, proposal: { ...x.proposal, reviewHash: changed ? "b".repeat(64) : x.reviewHash, reviewRequired: mode === "manual" } };
    if (path.endsWith("intent/register-retained")) { registered = true; if (mode === "lost") throw new Error("lost"); if (mode === "storage") store.set(key, "changed"); if (mode === "dispose") { disposed = true; c.deactivate(); }
      return { ok: true, registration: { review: x.review, replayed: false } }; }
    if (path.endsWith("intent/acknowledge")) { acknowledged = true; return { ok: true, acknowledgement: { version: 1, siteId: x.siteId, operationKey: x.operationKey, generation: 1, acknowledged: true, replayed: false } }; }
    if (path.endsWith("intent/pending")) return { ok: true, snapshot: { version: 1, siteId: x.siteId, pending: null } };
    throw new Error("unexpected write");
  };
  const c = createCartCheckoutController({ siteId: x.siteId, accountId: x.f.principal.accountId, intentEnabled: true, retainedIntentEnabled: enabled, request,
    storage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => { writes.push(k); store.set(k, v); }, removeItem: k => { writes.push(k); store.delete(k); } },
    exclusive: async (_key, run) => { if (mode === "locked") return false; await run(); return true; } });
  await c.activate(); return { ...x, c, key, stored, store, calls, writes, change: () => { changed = true; }, disposed: () => disposed };
}
test("unknown original can be reviewed and explicitly registered once, but only existing host-verified ack releases its nonce", async () => {
  const x = await clientFixture(); assert.equal(x.c.getSnapshot().retainedRegistrationRequired, true); assert.equal(x.c.getSnapshot().pending, true);
  await x.c.preview(x.f.request, x.customer); await x.c.submit(); await x.c.cancel(); await x.c.startAnother(); await x.c.registerRetained(false);
  assert.equal(x.calls.some(p => /register-retained|submit|cancel|acknowledge|preview/.test(p)), false);
  await Promise.all([x.c.registerRetained(true), x.c.registerRetained(true)]); assert.equal(x.calls.filter(p => p.endsWith("register-retained")).length, 1);
  assert.equal(x.c.getSnapshot().retainedRegistrationRequired, false); assert.equal(x.c.getSnapshot().pending, true); assert.equal(x.store.get(x.key), x.stored); assert.deepEqual(x.writes, []);
  let prepared = 0, verified = 0; await x.c.startAnother((_original, ctx) => { assert.equal(ctx.createdHere, false); prepared++; }, () => { verified++; });
  assert.equal(prepared, 1); assert.equal(verified, 3); assert.equal(x.calls.filter(p => p.endsWith("acknowledge")).length, 1); assert.equal(x.c.getSnapshot().pending, false); assert.deepEqual(x.writes, [x.key]);
});
test("lost registration response is read back through the existing exact claim, never registered or charged twice", async () => {
  const x = await clientFixture("lost"); await x.c.registerRetained(true); assert.equal(x.c.getSnapshot().phase, "unconfirmed"); assert.equal(x.store.get(x.key), x.stored);
  await x.c.recover(); assert.equal(x.c.getSnapshot().phase, "confirmed"); assert.equal(x.c.getSnapshot().retainedRegistrationRequired, false);
  await x.c.registerRetained(true); assert.equal(x.calls.filter(p => p.endsWith("register-retained")).length, 1); assert.deepEqual(x.writes, []);
});
test("closed capability and failed tracked read cannot fall back to registration; changed/manual/locked originals cannot append", async () => {
  for (const [mode, enabled] of [["normal", false], ["reviewFailure", true], ["manual", true], ["locked", true], ["changed", true]] as const) {
    const x = await clientFixture(mode, enabled); if (mode === "changed") x.change(); await x.c.registerRetained(true);
    assert.equal(x.calls.some(p => p.endsWith("register-retained")), false, mode); assert.equal(x.store.get(x.key), x.stored); assert.deepEqual(x.writes, []);
    if (!enabled || mode === "reviewFailure") assert.equal(x.calls.some(p => p.endsWith("retained-review")), false);
  }
});
test("post-registration storage changes or deactivation never clear a reference or restore stale visible identity", async () => {
  for (const mode of ["storage", "dispose"]) {
    const x = await clientFixture(mode); await x.c.registerRetained(true); assert.deepEqual(x.writes, []); assert.equal(x.c.getSnapshot().original, null);
    assert.equal(x.store.get(x.key), mode === "storage" ? "changed" : x.stored); if (mode === "dispose") assert.equal(x.disposed(), true);
  }
});
