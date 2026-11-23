import assert from "node:assert/strict";
import test from "node:test";
import { cartReviewFixture } from "../../scripts/fixtures/member-checkout-cart-review";
import { createCartCheckoutController } from "./merchantCheckoutCartClient";
import { parseCartClientReview, parseCartClientSelection } from "./merchantCheckoutCartReview";
import { checkoutClientStorageKey, createCheckoutClientController, CheckoutClientError, type CheckoutClientRequest } from "./merchantCheckoutClient";
const nonce = "33333333-3333-4333-8333-333333333333";
async function fixture(method: "points" | "on_site" = "points") {
  const x = await cartReviewFixture(method), stored = new Map<string, string>(), calls: string[] = [];
  const storage = { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value); }, removeItem: (key: string) => { stored.delete(key); } };
  let locked = false;
  const exclusive = async (_: string, run: () => Promise<void>) => { if (locked) return false; locked = true; try { await run(); return true; } finally { locked = false; } };
  const request: CheckoutClientRequest = async path => { calls.push(path); return path.endsWith("preview") ? x.review : path.endsWith("recover")
    ? { ok: true, state: "confirmed", original: { kind: "cart", result: x.result } } : { ok: true, replayed: false, result: x.result }; };
  const options = { siteId: x.f.siteId, accountId: x.f.principal.accountId, storage, exclusive, request, randomNonce: () => nonce };
  const key = checkoutClientStorageKey(options.siteId, options.accountId);
  return { ...x, stored, calls, options, key, create: (overrides: Partial<typeof options> = {}) => createCartCheckoutController({ ...options, ...overrides }) };
}
test("cart browser parser canonicalizes selections and rejects aliases, injected fields and reused coupons", async () => {
  const x = await fixture(), selection = x.f.request;
  assert.deepEqual(parseCartClientSelection({ ...selection, lines: [...selection.lines].reverse() }), parseCartClientSelection(selection));
  for (const bad of [{ ...selection, paid: true }, { ...selection, lines: [selection.lines[0], selection.lines[0]] }, { ...selection, lines: selection.lines.map(l => ({ ...l, slotKey: "secret" })) },
    { ...selection, lines: selection.lines.map(l => ({ ...l, couponClaims: [{ couponId: "same", claimEventId: "same" }] })) }]) assert.throws(() => parseCartClientSelection(bad));
});
test("review whitelists line choices and totals, no raw members or coupon history in state", async () => {
  const x = await fixture(), review = parseCartClientReview({ ...x.review, rawMember: "SECRET", quote: { ...x.review.quote, rawMember: "SECRET" } }, x.f.request);
  assert.equal(review.quote.duePoints, 200); assert.equal(review.couponChoices.length, 2); assert.ok(!JSON.stringify(review).includes("SECRET"));
  for (const q of [{ ...x.review.quote, duePoints: 1 }, { ...x.review.quote, method: "on_site" }, { ...x.review.quote, methodAvailable: false },
    { ...x.review.quote, lines: [...x.review.quote.lines].reverse() }, { ...x.review.quote, siteId: "10909993" }]) assert.throws(() => parseCartClientReview({ ...x.review, quote: q }, x.f.request));
  assert.throws(() => parseCartClientReview({ ...x.review, couponChoices: [] }, x.f.request));
});
test("preview is read-only; whole cart dispatches once and persists only the common nonce", async () => {
  for (const method of ["points", "on_site"] as const) {
    const x = await fixture(method), c = x.create(); await c.activate(); await c.preview(x.f.request, x.customer);
    assert.equal(c.getSnapshot().phase, "ready"); assert.equal(x.stored.size, 0); await Promise.all([c.submit(), c.submit()]);
    assert.equal(c.getSnapshot().phase, "confirmed"); assert.equal(x.calls.filter(p => p.endsWith("submit")).length, 1);
    assert.deepEqual(JSON.parse(x.stored.get(x.key)!), { version: 1, nonce }); assert.ok(!/synthetic|points|coupon|offer|email|phone/i.test(x.stored.get(x.key)!));
    await c.startAnother(); assert.equal(c.getSnapshot().phase, "idle"); assert.equal(x.stored.size, 0);
  }
});
test("embedding cart acknowledgement runs under the common lock after reread, before nonce removal", async () => {
  const x = await fixture(), c = x.create(); await c.activate(); await c.preview(x.f.request, x.customer); await c.submit();
  let acks = 0; await c.startAnother(async original => { acks++; assert.equal(original.kind, "cart"); assert.ok(x.stored.has(x.key));
    assert.ok(x.calls.at(-1)?.endsWith("recover")); assert.equal(await x.options.exclusive(x.key, async () => { throw new Error("must not run"); }), false); });
  assert.equal(acks, 1); assert.equal(c.getSnapshot().pending, false); assert.equal(x.stored.size, 0);
});
test("failed/late draft acknowledgement cannot release original or permit a new financial submit", async () => {
  for (const mode of ["failed", "late"] as const) {
    const x = await fixture(), c = x.create(); await c.activate(); await c.preview(x.f.request, x.customer); await c.submit();
    await c.startAnother(() => { if (mode === "late") c.deactivate(); else throw new Error("draft save denied"); });
    assert.ok(x.stored.has(x.key)); if (mode === "failed") assert.equal(c.getSnapshot().pending, true);
    await c.preview(x.f.request, x.customer); await c.submit(); assert.equal(x.calls.filter(p => p.endsWith("submit")).length, 1);
  }
});
test("unknown submit stays blocked after reload and method switch; null does not release nonce", async () => {
  const x = await fixture(), c = x.create({ request: async (path, body, signal) => path.endsWith("submit") ? Promise.reject(new Error("lost")) : x.options.request(path, body, signal) });
  await c.activate(); await c.preview(x.f.request, x.customer); await c.submit(); assert.equal(c.getSnapshot().phase, "unconfirmed"); c.deactivate();
  const reload = x.create({ request: async () => ({ ok: true, state: "unconfirmed" }) }); await reload.activate(); await reload.preview({ ...x.f.request, method: "on_site" }, x.customer); await reload.submit(); await reload.startAnother();
  assert.equal(reload.getSnapshot().pending, true); assert.equal(x.stored.size, 1); assert.equal(x.calls.filter(p => p.endsWith("submit")).length, 0);
});
test("previous single-item original is reviewed instead of overwritten; old client cannot overwrite a cart nonce", async () => {
  const x = await fixture(); x.stored.set(x.key, JSON.stringify({ version: 1, nonce }));
  const result = { version: 1, siteId: x.f.siteId, operationKey: "a".repeat(64), resourceKind: "order", resourceId: "old-original", totalPoints: 10, couponCount: 0,
    closed: false, resource: { status: "pending", updatedAt: new Date().toISOString() }, cancellationAvailable: false, cancellationPolicy: null, cancellation: null };
  const c = x.create({ request: async () => ({ ok: true, state: "confirmed", original: { kind: "single", original: { method: "points", result } } }) });
  await c.activate(); assert.equal(c.getSnapshot().original?.kind, "single"); await c.preview(x.f.request, x.customer); await c.submit(); assert.equal(x.calls.length, 0);
  const old = createCheckoutClientController({ ...x.options, request: async () => ({ ok: true, state: "unconfirmed" }) }); await old.activate();
  await old.preview({ siteId: x.f.siteId, ...x.f.request.lines[0] }); await old.submit(x.customer); assert.equal(old.getSnapshot().pending, true); assert.equal(x.stored.size, 1);
});
test("shared lock denies dispatch; concurrent controllers serialize different methods", async () => {
  const x = await fixture(), denied = x.create({ exclusive: async () => false }); await denied.activate(); await denied.preview(x.f.request, x.customer); await denied.submit();
  assert.equal(denied.getSnapshot().error, "checkout_other_tab"); assert.equal(x.stored.size, 0);
  const a = x.create(), b = x.create(); await a.activate(); await b.activate(); await a.preview(x.f.request, x.customer); await b.preview(x.f.request, x.customer);
  await Promise.all([a.submit(), b.submit()]); assert.equal(x.calls.filter(p => p.endsWith("submit")).length, 1);
});
test("definite server rejection releases nonce but transport failures, 5xx and wrong receipt never do", async () => {
  for (const kind of ["definite", "transport", "server", "existing", "wrong"] as const) {
    const x = await fixture(), c = x.create({ request: async (path, body, signal) => {
      if (!path.endsWith("submit")) return x.options.request(path, body, signal);
      if (kind === "definite") throw new CheckoutClientError("checkout_quote_changed", 409);
      if (kind === "server") throw new CheckoutClientError("checkout_unconfirmed", 503);
      if (kind === "existing") throw new CheckoutClientError("checkout_operation_conflict", 409);
      if (kind === "transport") throw new Error("lost");
      return { ok: true, replayed: false, result: { ...x.result, lines: x.result.lines.map(l => ({ ...l, title: "Other" })) } };
    } }); await c.activate(); await c.preview(x.f.request, x.customer); await c.submit();
    assert.equal(c.getSnapshot().pending, kind !== "definite"); assert.equal(x.stored.size, kind === "definite" ? 0 : 1);
  }
});
test("storage loss, malformed record or failed durability cannot dispatch financial write", async () => {
  for (const kind of ["bad", "denied", "silent"] as const) {
    const x = await fixture(); if (kind === "bad") x.stored.set(x.key, "{}");
    const c = x.create({ storage: kind === "bad" ? x.options.storage : { ...x.options.storage, setItem: () => { if (kind === "denied") throw new Error("denied"); } } });
    await c.activate(); await c.preview(x.f.request, x.customer); await c.submit();
    assert.equal(x.calls.filter(p => p.endsWith("submit")).length, 0); assert.equal(c.getSnapshot().error, "checkout_storage_unavailable");
  }
});
test("late preview/submit after deactivation cannot restore personal state", async () => {
  for (const phase of ["preview", "submit"] as const) {
    const x = await fixture(); let release!: (value: unknown) => void;
    const wait = new Promise<unknown>(resolve => { release = resolve; });
    const c = x.create({ request: async (path, body, signal) => path.endsWith(phase) ? wait : x.options.request(path, body, signal) });
    await c.activate(); if (phase === "submit") await c.preview(x.f.request, x.customer);
    const pending = phase === "preview" ? c.preview(x.f.request, x.customer) : c.submit(); await new Promise(resolve => setImmediate(resolve)); c.deactivate();
    release(phase === "preview" ? x.review : { ok: true, replayed: false, result: x.result }); await pending;
    assert.equal(c.getSnapshot().review, null); assert.equal(c.getSnapshot().original, null); assert.equal(c.getSnapshot().phase, "idle");
  }
});
test("unknown cancellation hides stale payment facts and only a read restores closed original", async () => {
  const x = await fixture(); x.stored.set(x.key, JSON.stringify({ version: 1, nonce })); let closed = false, writes = 0;
  const c = x.create({ request: async path => {
    if (path.endsWith("cancel")) { writes++; closed = true; throw new Error("lost"); }
    return { ok: true, state: "confirmed", original: { kind: "cart", result: closed ? { ...x.result, closed: true, cancellationAvailable: false, resource: { ...x.result.resource!, status: "cancelled" },
      cancellation: { pointsReturned: 200, couponsReturned: 0, stockReleased: 2, cancelledAt: new Date().toISOString() } } : x.result } };
  } }); await c.activate(); await Promise.all([c.cancel(), c.cancel()]); assert.equal(writes, 1); assert.equal(c.getSnapshot().original, null);
  await c.cancel(); assert.equal(writes, 1); await c.recover(); const original = c.getSnapshot().original; assert.equal(original?.kind === "cart" && original.result.closed, true);
});
test("review-required original cannot be acknowledged away; acknowledgement rechecks and retains on null", async () => {
  const x = await fixture(); x.stored.set(x.key, JSON.stringify({ version: 1, nonce })); let reads = 0;
  const c = x.create({ request: async () => { reads++; return { ok: true, state: "confirmed", original: { kind: "cart", result: { ...x.result, reviewRequired: true, cancellationAvailable: false } } }; } });
  await c.activate(); await c.startAnother(); assert.equal(reads, 1); assert.equal(x.stored.size, 1);
  const other = x.create({ request: async () => ++reads === 2 ? { ok: true, state: "confirmed", original: { kind: "cart", result: x.result } } : { ok: true, state: "unconfirmed" } });
  await other.activate(); await other.startAnother(); assert.equal(x.stored.size, 1); assert.equal(other.getSnapshot().phase, "unconfirmed");
});
test("removing a pending nonce elsewhere cannot erase the in-memory original or authorize a new submit", async () => {
  const x = await fixture(), c = x.create({ request: async (path, body, signal) => path.endsWith("submit") ? Promise.reject(new Error("lost")) : x.options.request(path, body, signal) });
  await c.activate(); await c.preview(x.f.request, x.customer); await c.submit(); x.stored.delete(x.key);
  await c.recover(); await c.preview(x.f.request, x.customer); await c.submit(); await c.startAnother();
  assert.equal(c.getSnapshot().pending, true); assert.equal(c.getSnapshot().error, "checkout_storage_unavailable"); assert.equal(c.getSnapshot().original, null);
});
test("a self-consistent cancelled result with changed immutable financial facts is still unknown", async () => {
  const x = await fixture(); x.stored.set(x.key, JSON.stringify({ version: 1, nonce }));
  const c = x.create({ request: async path => path.endsWith("recover") ? { ok: true, state: "confirmed", original: { kind: "cart", result: x.result } }
    : { ok: true, replayed: false, result: { ...x.result, closed: true, cancellationAvailable: false, lines: x.result.lines.map(l => ({ ...l, title: "Other original" })),
      resource: { ...x.result.resource!, status: "cancelled" }, cancellation: { pointsReturned: 200, couponsReturned: 0, stockReleased: 2, cancelledAt: new Date().toISOString() } } } });
  await c.activate(); await c.cancel(); assert.equal(c.getSnapshot().phase, "unconfirmed"); assert.equal(c.getSnapshot().original, null); assert.equal(x.stored.size, 1);
});
test("review preserves permitted multiline notes in memory while rejecting controls in contact fields", async () => {
  const x = await fixture(); let note = "";
  const c = x.create({ request: async (path, body, signal) => { note = (body as { customer?: { note: string } }).customer?.note ?? note; return x.options.request(path, body, signal); } });
  await c.activate(); await c.preview(x.f.request, { ...x.customer, note: "First line\nSecond line" }); assert.equal(c.getSnapshot().phase, "ready");
  assert.equal(note, "First line\nSecond line"); assert.equal(x.stored.size, 0);
  c.edit(); await c.preview(x.f.request, { ...x.customer, name: "First\nOther" }); assert.equal(c.getSnapshot().error, "checkout_invalid_customer");
});
