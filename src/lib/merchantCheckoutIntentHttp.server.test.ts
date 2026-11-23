import assert from "node:assert/strict";
import test from "node:test";
import { cartReviewFixture } from "../../scripts/fixtures/member-checkout-cart-review";
import { handleCheckoutIntent, type CheckoutIntentHttpDependencies } from "./merchantCheckoutIntentHttp.server";
import { handleCartCheckout } from "./merchantCheckoutCartHttp.server";
import { isMemberCheckoutIntentPilotEnabled } from "./merchantCheckoutCartPilot.server";
import { handleCartCheckoutEntry } from "../app/api/member-checkout/cart/entry/route-handler";
const origin = "https://intent.synthetic.invalid";
async function fixture() {
  const x = await cartReviewFixture(), siteId = x.f.siteId, scope = { siteId, operationKey: x.result.operationKey };
  const review = { ...scope, generation: 1, reviewHash: "a".repeat(64), reviewRequired: false, acknowledged: false, original: { kind: "cart", result: x.result } };
  const ack = { ...scope, generation: review.generation, reviewHash: review.reviewHash };
  const session = { ...x.f.principal, servicePaused: false, user: { email_confirmed_at: new Date().toISOString() } } as unknown as Awaited<ReturnType<CheckoutIntentHttpDependencies["session"]>>;
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const deps: CheckoutIntentHttpDependencies = { enabled: () => true, session: async () => session, call: async (name, args, signal) => {
    assert.ok(signal instanceof AbortSignal); calls.push({ name, args });
    return { data: name.endsWith("pending_intent_v1") ? { version: 1, siteId, pending: review }
      : name.endsWith("intent_review_v1") ? { version: 1, siteId, review }
        : { version: 1, ...scope, generation: 1, acknowledged: true, replayed: false }, error: null };
  } };
  const req = (body: unknown, headers: Record<string, string> = {}, query = "") => new Request(origin + "/api/member-checkout/intent/test" + query,
    { method: "POST", headers: { origin, "content-type": "application/json", "x-checkout-account-scope": x.f.principal.accountId, ...headers }, body: JSON.stringify(body) });
  return { ...x, siteId, scope, review, ack, session, calls, deps, req };
}
test("intent mode needs its own exact allowlist plus all prior UI gates; no single flag activates it", () => {
  const site = "10909994", env = { MERCHANT_MEMBER_CHECKOUT_PILOT_SITES: site, MERCHANT_MEMBER_CHECKOUT_CART_PILOT_SITES: site, MERCHANT_MEMBER_CHECKOUT_CART_UI_PILOT_SITES: site };
  assert.equal(isMemberCheckoutIntentPilotEnabled(site, env), false);
  assert.equal(isMemberCheckoutIntentPilotEnabled(site, { ...env, MERCHANT_MEMBER_CHECKOUT_INTENT_PILOT_SITES: site }), true);
  for (const value of ["*", site + ",", "other", new Array(51).fill(site).join(",")]) assert.equal(isMemberCheckoutIntentPilotEnabled(site, { ...env, MERCHANT_MEMBER_CHECKOUT_INTENT_PILOT_SITES: value }), false);
  assert.equal(isMemberCheckoutIntentPilotEnabled(site, { MERCHANT_MEMBER_CHECKOUT_INTENT_PILOT_SITES: site }), false);
});
test("new HTTP returns safe pending/review/ack envelopes once with private cache and actual session scope", async () => {
  const x = await fixture();
  for (const [action, body, key] of [["pending", { siteId: x.siteId }, "snapshot"], ["review", x.scope, "review"], ["acknowledge", x.ack, "acknowledgement"]] as const) {
    const response = await handleCheckoutIntent(action, x.req(body), x.deps); assert.equal(response.status, 200); const value = await response.json(); assert.equal(value.ok, true); assert.ok(value[key]);
    assert.match(response.headers.get("cache-control")!, /private, no-store/); assert.match(response.headers.get("vary")!, /X-Checkout-Account-Scope/);
    assert.equal(x.calls.at(-1)!.args.p_principal_key, `account:${x.f.principal.accountId}:${x.f.principal.userId}`);
  } assert.equal(x.calls.length, 3);
});
test("foreign origin, staff tokens, missing account hint, queries, excess input and wrong verbs never reach RPC", async () => {
  const x = await fixture();
  for (const [request, status] of [[x.req(x.ack, { origin: "https://other.invalid" }), 403], [x.req(x.ack, { "x-merchant-access-token": "private" }), 401],
    [x.req(x.ack, { "x-checkout-account-scope": "" }), 401], [x.req(x.ack, {}, "?member=other"), 400], [x.req({ ...x.ack, nonce: "untrusted" }), 400], [new Request(origin), 405]] as const)
    assert.equal((await handleCheckoutIntent("acknowledge", request, x.deps)).status, status);
  assert.equal(x.calls.length, 0);
});
test("closed gate, paused/unverified sessions and browser hint mismatch cannot read an original", async () => {
  const x = await fixture(); let sessions = 0;
  assert.equal((await handleCheckoutIntent("pending", x.req({ siteId: x.siteId }), { ...x.deps, enabled: () => false, session: async () => { sessions++; return x.session; } })).status, 503);
  assert.equal(sessions, 0);
  for (const session of [null, { ...x.session!, servicePaused: true }, { ...x.session!, accountId: "59999999" }, { ...x.session!, user: { email_confirmed_at: "" } }])
    assert.equal((await handleCheckoutIntent("review", x.req(x.scope), { ...x.deps, session: async () => session as typeof x.session })).status, 401);
  assert.equal(x.calls.length, 0);
});
test("strict bounded UTF-8 streaming body never turns malformed input into an acknowledgement", async () => {
  const x = await fixture();
  for (const request of [x.req(x.ack, { "content-type": "text/plain" }), x.req({ ...x.ack, other: "x".repeat(2100) }),
    new Request(x.req(x.ack), { body: new Uint8Array([123, 255, 125]) }), new Request(x.req(x.ack), { body: "{" })])
    assert.equal((await handleCheckoutIntent("acknowledge", request, x.deps)).status, 400);
  assert.equal(x.calls.length, 0);
});
test("aborted stalled body cannot later authorize or write", async () => {
  const x = await fixture(), abort = new AbortController(); let sessions = 0;
  const request = new Request(x.req(x.ack), { signal: abort.signal, body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("{")); } }), duplex: "half" } as RequestInit);
  const pending = handleCheckoutIntent("acknowledge", request, { ...x.deps, session: async () => { sessions++; return x.session; } });
  setImmediate(() => abort.abort()); assert.equal((await pending).status, 503); assert.equal(sessions, 0); assert.equal(x.calls.length, 0);
});
test("identity/gate loss after reading hides the original; after an ack append stays unknown", async () => {
  for (const action of ["review", "acknowledge"] as const) for (const mode of ["identity", "gate", "bad", "lost"] as const) {
    const x = await fixture(); let dispatched = false;
    const response = await handleCheckoutIntent(action, x.req(action === "review" ? x.scope : x.ack), { ...x.deps,
      session: async () => dispatched && mode === "identity" ? null : x.session, enabled: () => !(dispatched && mode === "gate"),
      call: async (...args) => { dispatched = true; if (mode === "lost") throw new Error("PRIVATE SQL"); if (mode === "bad") return { data: {}, error: null }; return x.deps.call(...args); } });
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: action === "review" ? "checkout_intent_unavailable" : "checkout_intent_unconfirmed" });
  }
});
test("atomic changed/busy errors remain conflicts without leaking internal SQL", async () => {
  const x = await fixture();
  for (const error of ["checkout_intent_changed", "checkout_intent_busy", "checkout_intent_review_required"])
    assert.equal((await handleCheckoutIntent("acknowledge", x.req(x.ack), { ...x.deps, call: async () => ({ data: null, error: { message: error } }) })).status, 409);
});
test("intent cart HTTP uses only the protected commit wrapper and rejects stale account hints", async () => {
  const x = await fixture(), names: string[] = [];
  const deps = { enabled: () => true, intentEnabled: () => true, session: async () => x.session, call: async (name: string, args: Record<string, unknown>) => {
    names.push(name); return name.includes("snapshot") ? { data: { replayed: false, snapshot: x.snapshotFor(x.request) }, error: null }
      : { data: { replayed: false, result: { ...x.result, resourceId: (args.p_plan as { record: { id: string } }).record.id } }, error: null };
  } };
  assert.equal((await handleCartCheckout("submit", x.req(x.request, { "x-checkout-account-scope": "59999999" }), deps)).status, 401); assert.equal(names.length, 0);
  assert.equal((await handleCartCheckout("submit", x.req(x.request), deps)).status, 200);
  assert.deepEqual(names, ["faolla_member_checkout_cart_submission_snapshot_v1", "faolla_member_checkout_intent_cart_commit_v1"]);
});
test("only newly rolled-back original-pending/disabled replies get their explicit code; no unconfirmed retry", async () => {
  const x = await fixture();
  for (const error of ["checkout_original_pending", "checkout_intent_disabled"] as const) {
    const response = await handleCartCheckout("submit", x.req(x.request), { enabled: () => true, intentEnabled: () => true, session: async () => x.session,
      call: async name => name.includes("snapshot") ? { data: { replayed: false, snapshot: x.snapshotFor(x.request) }, error: null } : { data: null, error: { message: error } } });
    assert.equal(response.status, error === "checkout_original_pending" ? 409 : 503); assert.deepEqual(await response.json(), { error });
  }
});
test("real cart discovery advertises the new mode only after verified source discovery and its separate server gate", async () => {
  const x = await fixture(), body = { siteId: x.siteId, kind: "order", blockId: "products", viewport: "desktop" };
  const response = await handleCartCheckoutEntry(x.req(body), { enabled: () => true, intentEnabled: () => true, session: async () => x.session, read: async () => [] });
  assert.equal(response.status, 200); const value = await response.json(); assert.equal(value.intent, true); assert.equal(value.entry.accountId, x.f.principal.accountId);
});
test("mode change during cart discovery cannot silently downgrade to the old browser protocol", async () => {
  const x = await fixture(); let enabled = true;
  const response = await handleCartCheckoutEntry(x.req({ siteId: x.siteId, kind: "order", blockId: "products", viewport: "desktop" }), { enabled: () => true,
    intentEnabled: () => enabled, session: async () => x.session, read: async () => { enabled = false; return []; } });
  assert.equal(response.status, 503); assert.equal((await response.json()).entry, undefined);
});
test("ack deadline includes time already spent resolving HTTP identity rather than restarting that budget", async context => {
  const x = await fixture(); let now = Date.now(), sessions = 0;
  context.mock.method(Date, "now", () => now);
  const response = await handleCheckoutIntent("acknowledge", x.req(x.ack), { ...x.deps, session: async () => { if (++sessions === 1) now += 9_000; return x.session; },
    call: async (name, args, signal) => { assert.ok(Date.parse(String(args.p_not_after)) - now <= 2000); return x.deps.call(name, args, signal); } });
  assert.equal(response.status, 200);
});
test("aborting the first identity lookup cannot dispatch a late ack after that session promise resolves", async () => {
  const x = await fixture(), abort = new AbortController(); let resolve!: (value: typeof x.session) => void, started!: () => void;
  const began = new Promise<void>(r => { started = r; }), session = new Promise<typeof x.session>(r => { resolve = r; });
  const pending = handleCheckoutIntent("acknowledge", new Request(x.req(x.ack), { signal: abort.signal }), { ...x.deps, session: async () => { started(); return session; } });
  await began; abort.abort(); assert.equal((await pending).status, 503); resolve(x.session); await new Promise(r => setImmediate(r)); assert.equal(x.calls.length, 0);
});
test("whole HTTP deadline is not renewed by creating the inner service after slow identity lookup", async context => {
  const x = await fixture(); let now = Date.now(), sessions = 0; context.mock.method(Date, "now", () => now);
  const response = await handleCheckoutIntent("pending", x.req({ siteId: x.siteId }), { ...x.deps, session: async () => { if (++sessions === 1) now += 13_000; return x.session; } });
  assert.equal(response.status, 503); assert.equal(x.calls.length, 0);
});
