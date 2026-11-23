import assert from "node:assert/strict";
import test from "node:test";
import { singleIntentFixture } from "../../scripts/fixtures/member-checkout-single-intent";
import { checkoutResumeFixture } from "../../scripts/fixtures/member-checkout-resume";
import { createIntentPointsCheckoutController, createIntentOnSiteCheckoutController, checkoutSingleIntentTransport } from "./merchantCheckoutSingleIntentClient";
import { createCheckoutClientController, checkoutClientStorageKey, CheckoutClientError, type CheckoutClientRequest } from "./merchantCheckoutClient";
import { createOnSiteCheckoutController } from "./merchantCheckoutOnSiteClient";
import type { CartClientOriginal } from "./merchantCheckoutCartReview";
import { cartClientOriginalKey } from "./merchantCheckoutCartReview";

async function fixture(method: "points" | "on_site" = "points", existing: CartClientOriginal | null = null) {
  const x = await singleIntentFixture(method), key = checkoutClientStorageKey(x.siteId, x.accountId), stored = new Map<string, string>(), events: string[] = [], calls: string[] = [];
  let original = existing, acknowledged = false, hash = "a".repeat(64), reviewRequired = false, locked = false;
  const review = () => original ? { operationKey: cartClientOriginalKey(original), generation: 1, reviewHash: hash, original, reviewRequired, acknowledged } : null;
  const request: CheckoutClientRequest = async (path, body) => {
    calls.push(path);
    if (path.endsWith("intent/pending")) return { ok: true, snapshot: { version: 1, siteId: x.siteId, pending: acknowledged ? null : review() } };
    if (path.endsWith("intent/review")) return { ok: true, review: review() };
    if (path.endsWith("intent/acknowledge")) { assert.equal((body as { reviewHash: string }).reviewHash, hash); assert.equal((body as { operationKey: string }).operationKey, review()!.operationKey); events.push("ack"); acknowledged = true; return { ok: true, acknowledgement: { version: 1, siteId: x.siteId, operationKey: review()!.operationKey, generation: 1, acknowledged: true, replayed: false } }; }
    if (path.endsWith("cart/recover")) return { ok: true, state: original ? "confirmed" : "unconfirmed", ...(original ? { original } : {}) };
    if (path.endsWith("preview")) return path.includes("on-site") ? x.cashPreview : x.pointsPreview;
    if (path.endsWith("submit")) { events.push("submit"); assert.ok(stored.has(key)); original = x.original; return { ok: true, replayed: false, result: x.original.kind === "single" ? x.original.original.result : null }; }
    throw new Error("unexpected synthetic path");
  };
  const options = { siteId: x.siteId, accountId: x.accountId, request, randomNonce: () => x.nonce,
    storage: { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => { stored.set(k, v); }, removeItem: (k: string) => { events.push("release"); stored.delete(k); } },
    exclusive: async (_key: string, run: () => Promise<void>) => { if (locked) return false; locked = true; try { await run(); return true; } finally { locked = false; } } };
  return { ...x, key, stored, events, calls, request, options, review, change: (patch: { original?: CartClientOriginal | null; hash?: string; reviewRequired?: boolean }) => {
    if (patch.original !== undefined) original = patch.original; if (patch.hash) hash = patch.hash; if (patch.reviewRequired !== undefined) reviewRequired = patch.reviewRequired;
  }, create: (overrides: Partial<typeof options> = {}) => method === "points" ? createIntentPointsCheckoutController({ ...options, ...overrides }) : createIntentOnSiteCheckoutController({ ...options, ...overrides }) };
}
async function preview(x: Awaited<ReturnType<typeof fixture>>, c: ReturnType<Awaited<ReturnType<typeof fixture>>["create"]>) {
  // Supplying a customer to the points controller is harmless; it only quotes
  // the selection. On-site preview requires the exact captured customer.
  await c.preview(x.selection, x.customer);
}

test("root cause: legacy activation without a local nonce never asks the server for another-device original", async () => {
  for (const factory of [createCheckoutClientController, createOnSiteCheckoutController]) {
    const x = await fixture(), c = factory(x.options); await c.activate(); assert.deepEqual(x.calls, []); assert.equal(c.getSnapshot().phase, "idle"); c.deactivate();
  }
});
test("both single methods recover all four original kinds before quoting or submitting; whole carts cannot be acknowledged here", async () => {
  for (const method of ["points", "on_site"] as const) for (const kind of ["cart_points", "cart_on_site", "single_points", "single_on_site"] as const) {
    const original = (await checkoutResumeFixture(kind)).original, x = await fixture(method, original), c = x.create(); await c.activate();
    assert.deepEqual(c.getSnapshot().originalReview, original); assert.equal(c.getSnapshot().pending, true); assert.equal(x.stored.size, 0);
    await preview(x, c); await c.submit(x.customer); assert.deepEqual(x.calls, ["/api/member-checkout/intent/pending"]);
    await c.startAnother(); assert.deepEqual(x.events, original.kind === "cart" ? [] : ["ack"]); assert.equal(c.getSnapshot().pending, original.kind === "cart"); c.deactivate();
  }
});
test("single submission uses its old validated planner once, then shared original review and server acknowledgement before releasing the nonce", async () => {
  for (const method of ["points", "on_site"] as const) {
    const x = await fixture(method), c = x.create(); x.stored.set("native-cart", "UNCHANGED member/products/note"); await c.activate(); await preview(x, c); assert.equal(c.getSnapshot().phase, "ready");
    await c.submit(x.customer); assert.equal(c.getSnapshot().phase, "confirmed"); assert.equal(c.getSnapshot().originalReview?.kind, "single"); assert.ok(x.stored.has(x.key));
    await c.submit(x.customer); await c.startAnother(); assert.deepEqual(x.events, ["submit", "ack", "release"]); assert.equal(c.getSnapshot().phase, "idle");
    assert.equal(x.stored.get("native-cart"), "UNCHANGED member/products/note"); assert.ok(!x.calls.some(p => p.endsWith("/recover") && !p.endsWith("/cart/recover"))); c.deactivate();
  }
});
test("another-device winner under the common lock prevents a fresh local nonce and any single financial dispatch", async () => {
  const x = await fixture(), c = x.create(); await c.activate(); await preview(x, c); x.change({ original: x.original }); await c.submit(x.customer);
  assert.equal(c.getSnapshot().originalReview?.kind, "single"); assert.deepEqual(x.events, []); assert.equal(x.stored.size, 0); c.deactivate();
});
test("unknown local nonce and pending:null are never permission to discard or resubmit", async () => {
  const x = await fixture(); x.stored.set(x.key, JSON.stringify({ version: 1, nonce: x.nonce })); const c = x.create(); await c.activate();
  await preview(x, c); await c.submit(x.customer); await c.startAnother(); assert.equal(c.getSnapshot().phase, "unconfirmed"); assert.ok(x.stored.has(x.key)); assert.deepEqual(x.events, []); c.deactivate();
});
test("lost submit response recovers only the original nonce and never repeats submission", async () => {
  const x = await fixture(), c = x.create({ request: async (p, b, s) => { const raw = await x.request(p, b, s); if (p.endsWith("submit")) throw Error("response lost"); return raw; } });
  await c.activate(); await preview(x, c); await c.submit(x.customer); assert.equal(c.getSnapshot().originalReview?.kind, "single"); await c.recover(); assert.equal(x.events.filter(e => e === "submit").length, 1); assert.ok(x.stored.has(x.key)); c.deactivate();
});
test("lost acknowledgement retains nonce; exact acknowledged original after reload releases without a second acknowledgement", async () => {
  const x = await fixture(), c = x.create({ request: async (p, b, s) => { const raw = await x.request(p, b, s); if (p.endsWith("acknowledge")) throw Error("ack lost"); return raw; } });
  await c.activate(); await preview(x, c); await c.submit(x.customer); await c.startAnother(); assert.ok(x.stored.has(x.key)); assert.equal(c.getSnapshot().phase, "unconfirmed"); c.deactivate();
  const reload = x.create(); await reload.activate(); await reload.startAnother(); assert.equal(x.events.filter(e => e === "ack").length, 1); assert.equal(reload.getSnapshot().phase, "idle"); assert.ok(!x.stored.has(x.key)); reload.deactivate();
});
test("manual review, changed review hash, missing proof and private failures cannot release an original", async () => {
  const x = await fixture("on_site"), c = x.create(); x.change({ original: x.original, reviewRequired: true }); await c.activate(); await c.startAnother(); assert.deepEqual(x.events, []);
  x.change({ reviewRequired: false }); await c.recover(); x.change({ hash: "c".repeat(64) }); await c.startAnother(); assert.equal(c.getSnapshot().error, "checkout_intent_changed"); assert.deepEqual(x.events, []); c.deactivate();
  const bad = x.create({ request: async (p, b, s) => p.endsWith("intent/review") ? { ok: true, review: null } : x.request(p, b, s) }); await bad.activate(); await bad.startAnother(); assert.deepEqual(x.events, []); assert.equal(bad.getSnapshot().phase, "unconfirmed"); bad.deactivate();
});
test("account invalidation during a held original read prevents stale display and any late financial dispatch", async () => {
  const x = await fixture(); let release!: (v: unknown) => void, began!: () => void; const started = new Promise<void>(r => { began = r; });
  const c = x.create({ request: async () => { began(); return new Promise(r => { release = r; }); } }); const run = c.activate(); await started; c.deactivate(); await run;
  release({ ok: true, snapshot: x.snapshot }); await preview(x, c); await c.submit(x.customer); assert.equal(c.getSnapshot().originalReview, undefined); assert.deepEqual(x.events, []);
});
test("bounded original reads cannot leave a single checkout falsely editable when a transport ignores abort", async t => {
  const x = await fixture(), timeout = AbortSignal.timeout.bind(AbortSignal); t.mock.method(AbortSignal, "timeout", () => timeout(10)); const alive = setTimeout(() => {}, 1000);
  const c = x.create({ request: async () => new Promise(() => {}) }); try { await c.activate(); await preview(x, c); await c.submit(x.customer); assert.equal(c.getSnapshot().pending, true); assert.deepEqual(x.events, []); } finally { clearTimeout(alive); c.deactivate(); }
});
test("single transport uses only new fixed endpoints with account consistency and private same-origin requests", async t => {
  const calls: Array<{ path: string; init: RequestInit }> = []; t.mock.method(globalThis, "fetch", async (path: string, init: RequestInit) => { calls.push({ path, init }); return new Response('{"ok":true}'); });
  const send = checkoutSingleIntentTransport("50010105"), signal = new AbortController().signal;
  for (const method of ["", "on-site/"]) for (const action of ["preview", "submit"]) await send(`/api/member-checkout/${method}${action}`, { synthetic: true }, signal);
  assert.deepEqual(calls.map(c => c.path), ["/api/member-checkout/single/points/preview", "/api/member-checkout/single/points/submit", "/api/member-checkout/single/on-site/preview", "/api/member-checkout/single/on-site/submit"]);
  for (const c of calls) { assert.equal(c.init.method, "POST"); assert.equal(c.init.cache, "no-store"); assert.equal(c.init.credentials, "same-origin"); assert.equal(new Headers(c.init.headers).get("x-checkout-account-scope"), "50010105"); }
  await assert.rejects(send("/api/member-checkout/submit?paid=1", {}, signal), (e: unknown) => e instanceof CheckoutClientError); assert.equal(calls.length, 4);
});
