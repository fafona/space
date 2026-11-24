import assert from "node:assert/strict";
import test from "node:test";
import { parseLegacyOrderReview, parseLegacyReviewRequest } from "./merchantCheckoutLegacyReview";
import { handleCheckoutLegacyReview, type LegacyReviewDependencies } from "./merchantCheckoutLegacyReview.server";
import { isMemberCheckoutLegacyReviewEnabled } from "./merchantCheckoutLegacyReviewPilot.server";
import { createLegacyReviewController, legacyReviewStorageKey, legacyReviewTransport } from "./merchantCheckoutLegacyReviewClient";
const origin = "https://legacy-review.synthetic.invalid", q = { siteId: "10909994", blockId: "products", requestId: "ordinary-request-1" };
const record = { id: "O-synthetic-1", status: "pending", createdAt: "2026-11-24T10:00:00.000Z", updatedAt: "2026-11-24T10:00:00.000Z" };
const review = { version: 1, ...q, order: record }, envelope = { ok: true, readOnly: true, review };
function fixture() {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const session = { accountId: "58000001", userId: "legacy-synthetic-user", servicePaused: false, user: { email_confirmed_at: "2026-11-24T00:00:00Z" } } as unknown as NonNullable<Awaited<ReturnType<LegacyReviewDependencies["session"]>>>;
  const deps: LegacyReviewDependencies = { enabled: () => true, session: async () => session, call: async (name, args, signal) => { assert.ok(signal instanceof AbortSignal); calls.push({ name, args }); return { data: review, error: null }; } };
  const req = (body: unknown = q, headers: Record<string, string> = {}, query = "") => new Request(origin + "/api/member-checkout/legacy/review" + query, { method: "POST", headers: { origin, "content-type": "application/json", "x-checkout-account-scope": session.accountId, ...headers }, body: JSON.stringify(body) });
  return { calls, session, deps, req };
}
test("legacy review requires its own strict allowlist AND history-read access; enrollment never grants it", () => {
  const env = (history: string, legacy: string) => ({ MERCHANT_MEMBER_CHECKOUT_HISTORY_READ_SITES: history, MERCHANT_MEMBER_CHECKOUT_LEGACY_REVIEW_SITES: legacy });
  assert.equal(isMemberCheckoutLegacyReviewEnabled(q.siteId, env(q.siteId, q.siteId)), true);
  for (const bad of ["", "*", "all", "10909993", `${q.siteId},bad`, Array(51).fill(q.siteId).join(",")]) {
    assert.equal(isMemberCheckoutLegacyReviewEnabled(q.siteId, env(q.siteId, bad)), false);
    assert.equal(isMemberCheckoutLegacyReviewEnabled(q.siteId, env(bad, q.siteId)), false);
  }
  assert.equal(isMemberCheckoutLegacyReviewEnabled(q.siteId, {}), false);
});
test("DTO accepts only exact coordinates and four safe order fields, never payment or draft ownership claims", () => {
  assert.deepEqual(parseLegacyReviewRequest(q), q); assert.deepEqual(parseLegacyOrderReview(review, q), review);
  assert.deepEqual(parseLegacyOrderReview({ ...review, order: null }, q), { ...review, order: null });
  for (const patch of [{ accountId: "58000001" }, { nonce: "private" }, { requestId: " bad" }, { blockId: "products/other" }, { siteId: 10909994 }]) assert.throws(() => parseLegacyReviewRequest({ ...q, ...patch }));
  for (const patch of [{ status: ["pending"] }, { status: "paid" }, { paymentStatus: "paid" }, { memberId: "private" }, { totalAmount: 10 }, { customer: {} }, { createdAt: "2026-11-24T10:00:00Z" }, { updatedAt: "2026-11-24T09:59:59.999Z" }, { createdAt: "2026-02-30T00:00:00.000Z" }]) assert.throws(() => parseLegacyOrderReview({ ...review, order: { ...record, ...patch } }, q));
  for (const patch of [{ siteId: "00000000" }, { requestId: "different" }, { blockId: "different" }, { version: 2 }, { mayMigrate: true }]) assert.throws(() => parseLegacyOrderReview({ ...review, ...patch }, q));
});
test("actual HTTP uses only the verified dual principal and one bounded readonly RPC; it exposes no contacts/products", async () => {
  const x = fixture(), before = Date.now(), response = await handleCheckoutLegacyReview(x.req(), x.deps);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), envelope); assert.equal(x.calls.length, 1);
  assert.equal(x.calls[0].name, "faolla_member_checkout_legacy_review_v1");
  const { p_not_after, ...args } = x.calls[0].args;
  assert.deepEqual(args, { p_site_id: q.siteId, p_block_id: q.blockId, p_request_id: q.requestId, p_principal_key: `account:${x.session.accountId}:${x.session.userId}` });
  assert.ok(Date.parse(String(p_not_after)) >= before + 11_400 && Date.parse(String(p_not_after)) <= Date.now() + 11_500);
  assert.match(response.headers.get("cache-control")!, /private, no-store/); assert.match(response.headers.get("vary")!, /X-Checkout-Account-Scope/);
});
test("wrong verb/origin/query/body/UTF8 and forged token cannot query identity or SQL", async () => {
  const x = fixture(); let auth = 0;
  for (const [request, status] of [[new Request(origin), 405], [x.req(undefined, { origin: "https://foreign.invalid" }), 403], [x.req(undefined, { "x-merchant-access-token": "private" }), 401], [x.req(undefined, { "x-checkout-account-scope": "" }), 401],
    [x.req(q, {}, "?account=58000001"), 400], [x.req({ ...q, principalKey: "forged" }), 400], [x.req({ ...q, requestId: "x".repeat(1100) }), 400],
    [new Request(x.req(), { body: "{" }), 400], [new Request(x.req(), { body: new Uint8Array([123, 255, 125]) }), 400], [x.req(undefined, { "content-type": "text/plain" }), 400]] as const) {
    assert.equal((await handleCheckoutLegacyReview(request, { ...x.deps, session: async () => { auth++; return x.session; } })).status, status);
  }
  assert.equal(auth, 0); assert.equal(x.calls.length, 0);
});
test("closed gate, unverified/paused/foreign/malformed identities cannot read orders", async () => {
  const x = fixture(); let auth = 0;
  assert.equal((await handleCheckoutLegacyReview(x.req(), { ...x.deps, enabled: () => false, session: async () => { auth++; return x.session; } })).status, 503); assert.equal(auth, 0);
  for (const patch of [null, { servicePaused: true }, { accountId: "59999999" }, { userId: "short" }, { user: {} }, { user: { email_confirmed_at: "invalid" } }]) {
    assert.equal((await handleCheckoutLegacyReview(x.req(), { ...x.deps, session: async () => patch ? { ...x.session, ...patch } as typeof x.session : null })).status, 401);
  } assert.equal(x.calls.length, 0);
});
test("post-read identity/gate changes suppress every fact, including same account with a different userId", async () => {
  for (const mode of ["account", "user", "paused", "gate"]) {
    const x = fixture(); let called = false;
    const r = await handleCheckoutLegacyReview(x.req(), { ...x.deps, enabled: () => mode !== "gate" || !called,
      session: async () => called ? { ...x.session, ...(mode === "account" ? { accountId: "59999999" } : mode === "user" ? { userId: "another-synthetic-user" } : mode === "paused" ? { servicePaused: true } : {}) } : x.session,
      call: async (...args) => { called = true; return x.deps.call(...args); } });
    assert.equal(r.status, mode === "gate" ? 503 : 401); assert.ok(!(await r.text()).includes(record.id));
  }
});
test("unconfirmed result is explicit; failed/unsafe/wrong-scope SQL responses are unavailable, never absence or payment success", async () => {
  const x = fixture(), empty = { ...review, order: null };
  assert.deepEqual(await (await handleCheckoutLegacyReview(x.req(), { ...x.deps, call: async () => ({ data: empty, error: null }) })).json(), { ...envelope, review: empty });
  for (const value of [{ data: null, error: null }, { data: review, error: { message: "PRIVATE SQL" } }, { data: {}, error: null }, { data: { ...review, siteId: "00000000" }, error: null }, { data: { ...review, order: { ...record, memberId: "PRIVATE" } }, error: null }]) {
    const response = await handleCheckoutLegacyReview(x.req(), { ...x.deps, call: async () => value }); assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "checkout_legacy_review_unavailable" });
  }
  assert.equal((await handleCheckoutLegacyReview(x.req(), { ...x.deps, call: async () => { throw Error("PRIVATE"); } })).status, 503);
});
test("stalled body/session/RPC and late wall-clock responses cannot dispatch or expose a late result", async t => {
  const x = fixture();
  for (const stage of ["body", "session", "rpc"]) {
    const abort = new AbortController(); let start!: () => void, release!: (value: unknown) => void, calls = 0;
    const began = new Promise<void>(r => { start = r; }), held = new Promise<unknown>(r => { release = r; });
    const request = new Request(x.req(), { signal: abort.signal, ...(stage === "body" ? { body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("{")); start(); } }), duplex: "half" } : {}) } as RequestInit);
    const run = handleCheckoutLegacyReview(request, { ...x.deps, session: async () => { if (stage === "session") { start(); return await held as typeof x.session; } return x.session; }, call: async () => { calls++; start(); return await held as Awaited<ReturnType<typeof x.deps.call>>; } });
    await began; abort.abort(); assert.equal((await run).status, 503); assert.equal(calls, stage === "rpc" ? 1 : 0); release(stage === "session" ? x.session : { data: review, error: null }); await new Promise(r => setImmediate(r)); assert.equal(calls, stage === "rpc" ? 1 : 0);
  }
  const now = Date.now(); let expired = false; const clock = t.mock.method(Date, "now", () => now + (expired ? 12_001 : 0));
  try { assert.equal((await handleCheckoutLegacyReview(x.req(), { ...x.deps, session: async () => { expired = true; return x.session; } })).status, 503); assert.equal(x.calls.length, 0); } finally { clock.mock.restore(); }
});
function local() {
  const key = legacyReviewStorageKey(q.siteId, q.blockId); let value: string | null = JSON.stringify({ clientRequestId: q.requestId, customer: { name: "PRIVATE", email: "private@example.invalid" }, items: [{ productId: "PRIVATE" }] });
  const reads: string[] = [], storage = { getItem(k: string) { reads.push(k); assert.equal(k, key); return value; } };
  return { key, storage, reads, raw: () => value, change: (v: string | null) => { value = v; } };
}
test("get-only controller captures reference with NO automatic request; manual actual HTTP review never writes/adopts/releases", async () => {
  const x = fixture(), s = local(), before = s.raw(); let calls = 0;
  const c = createLegacyReviewController({ ...q, accountId: x.session.accountId, storage: s.storage, request: async (path, body, signal) => { calls++; assert.equal(path, "/api/member-checkout/legacy/review"); assert.deepEqual(body, q); const response = await handleCheckoutLegacyReview(new Request(x.req(body), { signal }), x.deps); assert.equal(response.status, 200); return response.json(); } });
  c.activate(); assert.equal(c.getSnapshot().phase, "ready"); assert.equal(calls, 0); await c.read(); assert.equal(c.getSnapshot().phase, "owned"); assert.deepEqual(c.getSnapshot().review, review);
  assert.deepEqual(Object.keys(c).sort(), ["activate", "deactivate", "getSnapshot", "read", "subscribe"]); assert.equal(s.raw(), before); assert.equal(calls, 1); c.deactivate(); assert.equal(s.raw(), before);
});
test("absent, malformed and oversize local carts never issue a query or clear original bytes", async () => {
  const x = fixture(), s = local(); let calls = 0;
  for (const raw of [null, "{", "", JSON.stringify({}), JSON.stringify({ clientRequestId: 123 }), JSON.stringify({ clientRequestId: " bad" }), JSON.stringify({ clientRequestId: "" }), "x".repeat(1_048_577)]) {
    s.change(raw); const c = createLegacyReviewController({ ...q, accountId: x.session.accountId, storage: s.storage, request: async () => { calls++; return envelope; } });
    c.activate(); await c.read(); assert.equal(c.getSnapshot().phase, raw === null || raw === JSON.stringify({ clientRequestId: "" }) ? "empty" : "error"); assert.equal(s.raw(), raw); c.deactivate();
  } assert.equal(calls, 0);
});
test("cart changes during/before manual read invalidate facts and never silently adopt another local order", async () => {
  const x = fixture();
  for (const timing of ["before", "during"]) {
    const s = local(); let calls = 0; const c = createLegacyReviewController({ ...q, accountId: x.session.accountId, storage: s.storage, request: async () => { calls++; if (timing === "during") s.change(null); return envelope; } });
    c.activate(); if (timing === "before") s.change(JSON.stringify({ clientRequestId: "other-request" })); await c.read(); assert.equal(c.getSnapshot().phase, "error"); assert.equal(c.getSnapshot().review, null); assert.equal(calls, timing === "before" ? 0 : 1); c.deactivate();
  }
});
test("inactive/duplicate read and a transport ignoring abort cannot expose an old account's result", async () => {
  const x = fixture(), s = local(); let started!: () => void, release!: (v: unknown) => void, calls = 0; const began = new Promise<void>(r => { started = r; });
  const c = createLegacyReviewController({ ...q, accountId: x.session.accountId, storage: s.storage, request: async () => { calls++; started(); return new Promise(r => { release = r; }); } });
  await c.read(); assert.equal(calls, 0); c.activate(); const run = c.read(); await began; await c.read(); assert.equal(calls, 1); c.deactivate(); await run; release(envelope); await new Promise(r => setImmediate(r)); assert.equal(c.getSnapshot().review, null); assert.equal(c.getSnapshot().phase, "idle");
});
test("unknown and unsafe envelopes clear old facts while retaining local data", async () => {
  const x = fixture(), s = local(), before = s.raw(); let value: unknown = envelope;
  const c = createLegacyReviewController({ ...q, accountId: x.session.accountId, storage: s.storage, request: async () => value }); c.activate(); await c.read(); assert.equal(c.getSnapshot().phase, "owned");
  value = { ...envelope, review: { ...review, order: null } }; await c.read(); assert.equal(c.getSnapshot().phase, "unconfirmed");
  for (const invalid of [{ ...envelope, readOnly: false }, { ...envelope, review: { ...review, blockId: "other" } }, { ...envelope, review: { ...review, order: { ...record, paid: true } } }]) { value = invalid; await c.read(); assert.equal(c.getSnapshot().phase, "error"); assert.equal(c.getSnapshot().review, null); }
  assert.equal(s.raw(), before); c.deactivate();
});
test("controller timeout and full wall-clock budget settle safely even when transport ignores cancellation", async t => {
  const x = fixture(), s = local(), before = s.raw(), timeout = AbortSignal.timeout.bind(AbortSignal), keep = setTimeout(() => {}, 1000);
  const timed = t.mock.method(AbortSignal, "timeout", () => timeout(10)); const c = createLegacyReviewController({ ...q, accountId: x.session.accountId, storage: s.storage, request: async () => new Promise(() => {}) });
  try { c.activate(); await c.read(); assert.equal(c.getSnapshot().phase, "error"); assert.equal(s.raw(), before); } finally { clearTimeout(keep); c.deactivate(); timed.mock.restore(); }
  const now = Date.now(); let expired = false; const clock = t.mock.method(Date, "now", () => now + (expired ? 12_001 : 0));
  const late = createLegacyReviewController({ ...q, accountId: x.session.accountId, storage: s.storage, request: async () => { expired = true; return envelope; } });
  try { late.activate(); await late.read(); assert.equal(late.getSnapshot().phase, "error"); assert.equal(late.getSnapshot().review, null); assert.equal(s.raw(), before); } finally { late.deactivate(); clock.mock.restore(); }
});
test("production review transport has one exact path and private same-origin POST, never financial/replay authority", async t => {
  const x = fixture(), calls: Array<{ path: string; init: RequestInit }> = []; t.mock.method(globalThis, "fetch", async (path: string, init: RequestInit) => { calls.push({ path, init }); return Response.json(envelope); });
  const request = legacyReviewTransport(x.session.accountId), signal = new AbortController().signal;
  await request("/api/member-checkout/legacy/review", q, signal); assert.equal(calls.length, 1); const init = calls[0].init;
  assert.equal(init.credentials, "same-origin"); assert.equal(init.cache, "no-store"); assert.equal(init.method, "POST"); assert.equal(new Headers(init.headers).get("x-checkout-account-scope"), x.session.accountId); assert.deepEqual(JSON.parse(init.body as string), q);
  for (const p of ["/api/member-checkout/intent/acknowledge", "/api/member-checkout/cart/submit", "/api/orders", "https://foreign.invalid"]) await assert.rejects(request(p, {}, signal)); assert.equal(calls.length, 1);
});
