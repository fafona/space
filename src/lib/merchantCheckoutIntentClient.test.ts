import assert from "node:assert/strict";
import test from "node:test";
import { cartReviewFixture } from "../../scripts/fixtures/member-checkout-cart-review";
import { createCartCheckoutController } from "./merchantCheckoutCartClient";
import { CheckoutClientError, checkoutClientStorageKey, type CheckoutClientRequest } from "./merchantCheckoutClient";
import { checkoutIntentTransport } from "./merchantCheckoutIntentTransport";
import { assertCheckoutDraftLease, type CheckoutDraftReleaseCheck } from "./merchantCheckoutDraftLease";
const nonce = "33333333-3333-4333-8333-333333333333";
async function fixture(existing = false) {
  const x = await cartReviewFixture(), store = new Map<string, string>(), calls: string[] = [], events: string[] = [];
  let original = existing, acknowledged = false, generation = 1, hash = "a".repeat(64), reviewRequired = false, locked = false;
  const reviewed = () => ({ operationKey: x.result.operationKey, generation, reviewHash: hash, reviewRequired, original: { kind: "cart", result: x.result }, acknowledged });
  const request: CheckoutClientRequest = async (path, body) => { calls.push(path);
    if (path.endsWith("intent/pending")) return { ok: true, snapshot: { version: 1, siteId: x.f.siteId, pending: original && !acknowledged ? reviewed() : null } };
    if (path.endsWith("intent/review")) return { ok: true, review: original ? reviewed() : null };
    if (path.endsWith("intent/acknowledge")) { assert.equal((body as { reviewHash: string }).reviewHash, hash); events.push("ack"); acknowledged = true;
      return { ok: true, acknowledgement: { version: 1, siteId: x.f.siteId, operationKey: x.result.operationKey, generation, acknowledged: true, replayed: false } }; }
    if (path.endsWith("preview")) return x.review;
    if (path.endsWith("submit")) { original = true; return { ok: true, replayed: false, result: x.result }; }
    if (path.endsWith("recover")) return original ? { ok: true, state: "confirmed", original: { kind: "cart", result: x.result } } : { ok: true, state: "unconfirmed" };
    throw new Error("unexpected synthetic path");
  };
  const key = checkoutClientStorageKey(x.f.siteId, x.f.principal.accountId);
  const options = { siteId: x.f.siteId, accountId: x.f.principal.accountId, intentEnabled: true, request, randomNonce: () => nonce,
    storage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { events.push("release"); store.delete(k); } },
    exclusive: async (_key: string, run: () => Promise<void>) => { if (locked) return false; locked = true; try { await run(); return true; } finally { locked = false; } } };
  return { ...x, key, store, calls, events, options, request, reviewed, create: (override: Partial<typeof options> = {}) => createCartCheckoutController({ ...options, ...override }),
    change(next: { original?: boolean; acknowledged?: boolean; generation?: number; hash?: string; reviewRequired?: boolean }) {
      if (next.original !== undefined) original = next.original; if (next.acknowledged !== undefined) acknowledged = next.acknowledged;
      if (next.generation !== undefined) generation = next.generation; if (next.hash !== undefined) hash = next.hash; if (next.reviewRequired !== undefined) reviewRequired = next.reviewRequired;
    } };
}
test("new device reads the original without inventing/persisting a nonce and cannot preview/submit over it", async () => {
  const x = await fixture(true), c = x.create(); await c.activate();
  assert.equal(c.getSnapshot().pending, true); assert.equal(c.getSnapshot().original?.kind, "cart"); assert.equal(x.store.size, 0);
  await c.preview(x.f.request, x.customer); await c.submit(); assert.deepEqual(x.calls, ["/api/member-checkout/intent/pending"]);
  await c.startAnother((_original, context) => { assert.equal(context.createdHere, false); x.events.push("draft"); });
  assert.deepEqual(x.events, ["draft", "ack"]); assert.equal(c.getSnapshot().pending, false);
});
test("fresh original persists cart before server ack and only then releases its nonce under the common lock", async () => {
  const x = await fixture(), c = x.create(); await c.activate(); await c.preview(x.f.request, x.customer); await c.submit();
  assert.equal(c.getSnapshot().phase, "confirmed"); assert.ok(x.store.has(x.key));
  await c.startAnother(async (_original, context) => { assert.equal(context.createdHere, true); assert.ok(x.store.has(x.key));
    assert.equal(await x.options.exclusive(x.key, async () => {}), false); x.events.push("draft"); });
  assert.deepEqual(x.events, ["draft", "ack", "release"]); assert.equal(c.getSnapshot().phase, "idle"); assert.equal(x.calls.filter(p => p.endsWith("submit")).length, 1);
});
test("pending:null never clears a locally unknown financial nonce and missing review proof never releases a known original", async () => {
  const x = await fixture(); x.store.set(x.key, JSON.stringify({ version: 1, nonce })); const c = x.create(); await c.activate();
  assert.equal(c.getSnapshot().pending, true); assert.equal(c.getSnapshot().phase, "unconfirmed"); assert.ok(x.store.has(x.key));
  x.change({ original: true }); const missing = x.create({ request: async (p, b, s) => p.endsWith("intent/review") ? { ok: true, review: null } : x.request(p, b, s) });
  await missing.activate(); await missing.startAnother(); assert.equal(missing.getSnapshot().original, null); assert.ok(x.store.has(x.key)); assert.ok(!x.events.includes("ack"));
});
test("lost ack response retains nonce; own-operation proof after reload releases explicitly without repeating ack or consuming old draft", async () => {
  const x = await fixture(), c = x.create({ request: async (p, b, s) => { const result = await x.request(p, b, s); if (p.endsWith("acknowledge")) throw new Error("lost ack"); return result; } });
  await c.activate(); await c.preview(x.f.request, x.customer); await c.submit(); await c.startAnother(() => { x.events.push("draft"); });
  assert.equal(c.getSnapshot().phase, "unconfirmed"); assert.equal(c.getSnapshot().original, null); assert.ok(x.store.has(x.key)); c.deactivate();
  const reloaded = x.create(); await reloaded.activate(); assert.equal(reloaded.getSnapshot().phase, "confirmed");
  await reloaded.startAnother((_original, context) => { assert.equal(context.createdHere, false); x.events.push("preserve"); });
  assert.deepEqual(x.events, ["draft", "ack", "preserve", "release"]); assert.equal(x.calls.filter(p => p.endsWith("acknowledge")).length, 1); assert.equal(x.store.size, 0);
});
test("same-instance ack recovery does not repeat a successful draft cleanup after acknowledgement is lost", async () => {
  const x = await fixture(), c = x.create({ request: async (p, b, s) => { const result = await x.request(p, b, s); if (p.endsWith("acknowledge")) throw new Error("lost"); return result; } });
  await c.activate(); await c.preview(x.f.request, x.customer); await c.submit(); let saved = 0; await c.startAnother(() => { saved++; });
  await c.recover(); await c.startAnother(() => { saved++; }); assert.equal(saved, 1); assert.equal(x.store.size, 0); assert.equal(x.events.filter(e => e === "ack").length, 1);
});
test("a retained draft must still be verifiable before acknowledgement dispatch", async () => {
  const x = await fixture(), c = x.create(); await c.activate(); await c.preview(x.f.request, x.customer); await c.submit();
  let prepared = 0;
  await c.startAnother(() => { prepared++; }, () => { throw new Error("draft no longer available"); });
  assert.equal(prepared, 1); assert.ok(x.store.has(x.key)); assert.equal(c.getSnapshot().phase, "unconfirmed");
  assert.equal(c.getSnapshot().error, "checkout_draft_unconfirmed");
  assert.equal(x.events.filter(e => e === "ack" || e === "release").length, 0);
});
test("draft proof is rechecked after ack and on retry without repeating cleanup or acknowledgement", async () => {
  const x = await fixture(); let intact = true, checks = 0, prepared = 0;
  const c = x.create({ request: async (p, b, s) => { const result = await x.request(p, b, s); if (p.endsWith("acknowledge")) intact = false; return result; } });
  const verify = () => { checks++; if (!intact) throw new Error("draft changed while ack was in flight"); return undefined; };
  await c.activate(); await c.preview(x.f.request, x.customer); await c.submit();
  await c.startAnother(() => { prepared++; }, verify);
  assert.equal(checks, 2); assert.equal(prepared, 1); assert.ok(x.store.has(x.key)); assert.equal(c.getSnapshot().phase, "unconfirmed");
  assert.equal(c.getSnapshot().error, "checkout_draft_unconfirmed");
  await c.recover(); await c.startAnother(() => { prepared++; }, verify);
  assert.equal(prepared, 1); assert.equal(checks, 3); assert.ok(x.store.has(x.key));
  intact = true; await c.recover(); await c.startAnother(() => { prepared++; }, verify);
  assert.equal(prepared, 1); assert.equal(checks, 5); assert.equal(c.getSnapshot().pending, false);
  assert.deepEqual(x.events, ["ack", "release"]);
});
test("lost ack response cannot bypass a new draft check on same-instance recovery", async () => {
  const x = await fixture(); let intact = true, prepared = 0, checked = 0;
  const c = x.create({ request: async (p, b, s) => { const result = await x.request(p, b, s); if (p.endsWith("acknowledge")) throw new Error("lost ack"); return result; } });
  const verify = () => { checked++; if (!intact) throw new Error("changed"); return undefined; };
  await c.activate(); await c.preview(x.f.request, x.customer); await c.submit(); await c.startAnother(() => { prepared++; }, verify);
  intact = false; await c.recover(); await c.startAnother(() => { prepared++; }, verify);
  assert.equal(prepared, 1); assert.equal(checked, 2); assert.ok(x.store.has(x.key)); assert.equal(c.getSnapshot().phase, "unconfirmed");
  intact = true; await c.recover(); await c.startAnother(() => { prepared++; }, verify);
  assert.equal(prepared, 1); assert.equal(checked, 4); assert.equal(c.getSnapshot().pending, false);
  assert.deepEqual(x.events, ["ack", "release"]);
});
test("a draft verification callback receives a live matching lease and identity invalidation cannot continue ack or release", async () => {
  const x = await fixture(), c = x.create(); await c.activate(); await c.preview(x.f.request, x.customer); await c.submit();
  let checked = 0;
  await c.startAnother(() => {}, lease => { assertCheckoutDraftLease(lease, x.key); checked++; c.deactivate(); return undefined; });
  assert.equal(checked, 1); assert.ok(x.store.has(x.key)); assert.deepEqual(x.events, []); assert.equal(c.getSnapshot().original, null);
});
test("an accidental asynchronous draft verifier is not accepted as synchronous release proof", async () => {
  const x = await fixture(), c = x.create(); await c.activate(); await c.preview(x.f.request, x.customer); await c.submit();
  await c.startAnother(() => {}, (async () => {}) as unknown as CheckoutDraftReleaseCheck);
  assert.ok(x.store.has(x.key)); assert.deepEqual(x.events, []); assert.equal(c.getSnapshot().phase, "unconfirmed");
});
test("changed original view requires another explicit review and no draft/ack runs on the first stale click", async () => {
  const x = await fixture(true), c = x.create(); await c.activate(); x.change({ hash: "b".repeat(64) });
  await c.startAnother(() => { x.events.push("draft"); }); assert.equal(c.getSnapshot().error, "checkout_intent_changed"); assert.deepEqual(x.events, []);
  await c.startAnother(() => { x.events.push("draft"); }); assert.deepEqual(x.events, ["draft", "ack"]);
});
test("review-required singles/carts and an unavailable initial lookup cannot authorize new checkout", async () => {
  const x = await fixture(true); x.change({ reviewRequired: true }); const c = x.create(); await c.activate(); await c.startAnother(); assert.equal(x.events.length, 0);
  const broken = x.create({ request: async () => { throw new Error("no metadata"); } }); await broken.activate(); await broken.preview(x.f.request, x.customer); await broken.submit();
  assert.equal(broken.getSnapshot().pending, true); assert.equal(broken.getSnapshot().original, null); assert.equal(x.store.size, 0);
});
test("second device winning during preview is adopted before any local financial nonce exists", async () => {
  const x = await fixture(), c = x.create(); await c.activate(); await c.preview(x.f.request, x.customer); x.change({ original: true }); await c.submit();
  assert.equal(c.getSnapshot().phase, "confirmed"); assert.equal(x.store.size, 0); assert.equal(x.calls.filter(p => p.endsWith("submit")).length, 0);
});
test("commit-time original-pending rollback releases only this fresh nonce, then adopts the actual server original", async () => {
  const x = await fixture(), c = x.create({ request: async (p, b, s) => { if (p.endsWith("submit")) { x.change({ original: true }); throw new CheckoutClientError("checkout_original_pending", 409); } return x.request(p, b, s); } });
  await c.activate(); await c.preview(x.f.request, x.customer); await c.submit(); assert.equal(x.store.size, 0); assert.equal(c.getSnapshot().phase, "confirmed");
  await c.startAnother((_original, context) => { assert.equal(context.createdHere, false); }); assert.equal(x.events.filter(e => e === "ack").length, 1);
});
test("unknown 503 or unproven original-pending never clears the retained original nonce", async () => {
  for (const [code, status] of [["checkout_original_pending", 503], ["checkout_unconfirmed", 503]] as const) {
    const x = await fixture(), c = x.create({ request: async (p, b, s) => p.endsWith("submit") ? Promise.reject(new CheckoutClientError(code, status)) : x.request(p, b, s) });
    await c.activate(); await c.preview(x.f.request, x.customer); await c.submit(); assert.ok(x.store.has(x.key)); assert.equal(c.getSnapshot().phase, "unconfirmed");
  }
});
test("failed draft save and identity invalidation cannot dispatch ack or remove the original", async () => {
  for (const kind of ["fail", "identity"] as const) {
    const x = await fixture(), c = x.create(); await c.activate(); await c.preview(x.f.request, x.customer); await c.submit();
    await c.startAnother(() => { if (kind === "identity") c.deactivate(); else throw new Error("denied"); });
    assert.ok(x.store.has(x.key)); assert.equal(x.events.filter(e => e === "ack").length, 0);
  }
});
test("preview remains frozen while metadata is in flight and late lookup after identity loss cannot restore an original", async () => {
  const x = await fixture(); let hold = false, resolve!: (v: unknown) => void;
  const c = x.create({ request: async (p, b, s) => hold && p.endsWith("pending") ? new Promise(r => { resolve = r; }) : x.request(p, b, s) });
  await c.activate(); hold = true; const pending = c.preview(x.f.request, x.customer); await new Promise(r => setImmediate(r)); assert.equal(c.getSnapshot().phase, "quoting");
  c.deactivate(); resolve({ ok: true, snapshot: { version: 1, siteId: x.f.siteId, pending: x.reviewed() } }); await pending;
  assert.equal(c.getSnapshot().original, null); assert.equal(c.getSnapshot().phase, "idle");
});
test("account-scoped transport uses same-origin POST and rejects arbitrary URLs without fetching", async context => {
  const seen: Array<{ path: unknown; init: RequestInit }> = [];
  context.mock.method(globalThis, "fetch", async (path: unknown, init: RequestInit) => { seen.push({ path, init }); return Response.json({ ok: true }); });
  const request = checkoutIntentTransport("50010105"), signal = new AbortController().signal;
  await request("/api/member-checkout/intent/pending", { siteId: "10909994" }, signal);
  assert.equal(seen[0].init.credentials, "same-origin"); assert.equal((seen[0].init.headers as Record<string, string>)["x-checkout-account-scope"], "50010105");
  await assert.rejects(request("https://foreign.invalid/", {}, signal)); assert.equal(seen.length, 1);
});
test("a replayed pre-existing original is never treated as a freshly created local draft", async () => {
  const x = await fixture(), c = x.create({ request: async (p, b, s) => { const value = await x.request(p, b, s); return p.endsWith("submit") ? { ...value as object, replayed: true } : value; } });
  await c.activate(); await c.preview(x.f.request, x.customer); await c.submit();
  await c.startAnother((_original, context) => { assert.equal(context.createdHere, false); }); assert.equal(x.store.size, 0);
});
test("a same-key but different financial resource in the metadata view stays unknown without ack or nonce release", async () => {
  const x = await fixture(), c = x.create({ request: async (p, b, s) => p.endsWith("intent/review") ? { ok: true, review: { ...x.reviewed(), original: { kind: "cart", result: { ...x.result, resourceId: "different-order" } } } } : x.request(p, b, s) });
  await c.activate(); await c.preview(x.f.request, x.customer); await c.submit(); assert.equal(c.getSnapshot().phase, "unconfirmed"); assert.ok(x.store.has(x.key)); await c.startAnother(); assert.equal(x.events.length, 0);
});
test("finishing an older original adopts a newer cross-device original instead of acknowledging it implicitly", async () => {
  const x = await fixture(true), newer = { ...x.reviewed(), operationKey: "b".repeat(64), generation: 2, acknowledged: false,
    original: { kind: "cart", result: { ...x.result, operationKey: "b".repeat(64), resourceId: "newer-order" } } };
  let acked = false;
  const c = x.create({ request: async (p, b, s) => { if (acked && p.endsWith("intent/pending")) return { ok: true, snapshot: { version: 1, siteId: x.f.siteId, pending: newer } };
    const value = await x.request(p, b, s); if (p.endsWith("acknowledge")) acked = true; return value; } });
  await c.activate(); await c.startAnother(); assert.equal(c.getSnapshot().pending, true); assert.equal(c.getSnapshot().phase, "confirmed");
  const original = c.getSnapshot().original; assert.equal(original?.kind === "cart" && original.result.operationKey, newer.operationKey); assert.equal(x.events.filter(e => e === "ack").length, 1);
});
test("post-submit metadata errors are not proof that the financial commit rolled back and never clear its nonce", async () => {
  const x = await fixture(), c = x.create({ request: async (p, b, s) => p.endsWith("intent/review") ? Promise.reject(new CheckoutClientError("checkout_original_pending", 409)) : x.request(p, b, s) });
  await c.activate(); await c.preview(x.f.request, x.customer); await c.submit();
  assert.ok(x.store.has(x.key)); assert.equal(c.getSnapshot().phase, "unconfirmed"); assert.equal(c.getSnapshot().original, null); assert.equal(x.events.length, 0);
});
test("invalid contact fields before any write remain editable rather than inventing a pending financial operation", async () => {
  const x = await fixture(), c = x.create(); await c.activate(); await c.preview(x.f.request, { ...x.customer, name: "" });
  assert.equal(c.getSnapshot().phase, "error"); assert.equal(c.getSnapshot().pending, false); assert.equal(c.getSnapshot().error, "checkout_invalid_customer");
  await c.preview(x.f.request, x.customer); assert.equal(c.getSnapshot().phase, "ready"); assert.equal(x.store.size, 0);
});
test("cross-device whole-cart cancellation uses the original operation without creating a nonce and rereads its closed proof", async () => {
  const x = await fixture(true); let closed = false;
  const result = { ...x.result, closed: true, cancellationAvailable: false, resource: { ...x.result.resource!, status: "cancelled" },
    cancellation: { pointsReturned: x.result.totalPoints!, couponsReturned: 0, stockReleased: 2, cancelledAt: new Date().toISOString() } };
  const c = x.create({ request: async (p, b, s) => {
    if (p.endsWith("cancel")) { closed = true; return { ok: true, replayed: false, result }; }
    if (closed && p.endsWith("intent/review")) return { ok: true, review: { ...x.reviewed(), original: { kind: "cart", result } } };
    return x.request(p, b, s);
  } });
  await c.activate(); await c.cancel(); const original = c.getSnapshot().original;
  assert.equal(original?.kind === "cart" && original.result.closed, true); assert.equal(x.store.size, 0); assert.equal(c.getSnapshot().pending, true);
});
test("owned cart preparation runs inside the common live lock before nonce and finance", async () => {
  const x = await fixture(), c = x.create(); await c.activate(); await c.preview(x.f.request, x.customer);
  await c.submit(lease => { assertCheckoutDraftLease(lease, x.key); assert.equal(x.store.size, 0); assert.equal(x.calls.filter(p => p.endsWith("submit")).length, 0); });
  assert.equal(c.getSnapshot().phase, "confirmed");
});
test("a failed or identity-invalidated owned draft preparation dispatches no financial request and creates no nonce", async () => {
  for (const mode of ["failure", "identity"] as const) {
    const x = await fixture(), c = x.create(); await c.activate(); await c.preview(x.f.request, x.customer);
    await c.submit(() => { if (mode === "failure") throw new Error("draft failure"); c.deactivate(); });
    assert.equal(x.store.size, 0); assert.equal(x.calls.filter(p => p.endsWith("submit")).length, 0);
  }
});
test("draft acknowledgement receives the same live lock lease and that lease expires afterward", async () => {
  const x = await fixture(true), c = x.create(); await c.activate(); let saved: Parameters<typeof assertCheckoutDraftLease>[0];
  await c.startAnother((_original, context) => { saved = context.lease; assertCheckoutDraftLease(saved, x.key); });
  assert.throws(() => assertCheckoutDraftLease(saved, x.key)); assert.equal(x.events.filter(e => e === "ack").length, 1);
});
