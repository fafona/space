import assert from "node:assert/strict";
import test from "node:test";
import { createOnSiteCheckoutController, parseOnSiteClientQuote, buildOnSiteCheckoutStartHref } from "./merchantCheckoutOnSiteClient";
import { checkoutClientStorageKey, createCheckoutClientController, CheckoutClientError, type CheckoutClientRequest, type CheckoutClientSelection } from "./merchantCheckoutClient";
const selection: CheckoutClientSelection = { siteId: "10909095", offerId: "11111111-1111-4111-8111-111111111111", offerRevision: "22222222-2222-4222-8222-222222222222", quantity: 1, appointmentAt: "2030-01-01T12:00", couponClaims: [] };
const person = { name: "Private name", title: "Mx", email: "private@example.invalid", phone: "000000000", note: "Private note" }, nonce = "33333333-3333-4333-8333-333333333333", key = checkoutClientStorageKey(selection.siteId, "50010105");
const result = () => ({ version: 2 as const, siteId: selection.siteId, operationKey: "a".repeat(64), terms: { version: 2, method: "on_site", resourceKind: "booking", resourceId: "original-booking", currency: "eur", grossMinor: 1000, discountMinor: 0, dueMinor: 1000, capturedMinor: 0, totalPoints: null, couponCount: 0, paymentState: "unpaid" },
  resource: { status: "active", updatedAt: "2026-11-23T12:00:00Z" }, closed: false, termsMatch: true, cancellation: null, collection: null, cancellationAvailable: true, cancellationPolicy: { returnCoupons: true, advanceMinutes: 60, cancellableUntil: "2030-01-01T11:00:00Z" } });
const preview = (s = selection) => ({ ok: true, quote: { version: 1, method: "on_site", siteId: s.siteId, offerId: s.offerId, offerRevision: s.offerRevision, quantity: s.quantity, resourceKind: "booking", title: "Synthetic booking", grossMinor: 1000, discountMinor: 0, dueMinor: 1000,
  capturedMinor: 0, totalPoints: null, couponCount: 0, selected: [], coupons: [], confirmationHash: "b".repeat(64), reservationCreated: false, cancellationPolicy: { returnCoupons: true, advanceMinutes: 60 }, bookingForm: { store: "Store", item: "Play", titles: ["Mx"], timeZone: "Europe/Madrid" }, slot: { appointmentAt: s.appointmentAt, timeZone: "Europe/Madrid", reserved: false } } });
function fixture() {
  const stored = new Map<string, string>(), calls: Array<{ path: string; body: unknown }> = [];
  const storage = { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => { stored.set(k, v); }, removeItem: (k: string) => { stored.delete(k); } };
  let locked = false;
  const exclusive = async (_key: string, run: () => Promise<void>) => { if (locked) return false; locked = true; try { await run(); return true; } finally { locked = false; } };
  const request: CheckoutClientRequest = async (path, body) => { calls.push({ path, body: structuredClone(body) }); return path.endsWith("preview") ? preview(body as CheckoutClientSelection)
    : path.endsWith("recover") ? { ok: true, state: "confirmed", original: { method: "on_site", result: result() } } : { ok: true, replayed: false, result: result() }; };
  const options = { siteId: selection.siteId, accountId: "50010105", storage, exclusive, randomNonce: () => nonce, request };
  return { stored, calls, options, request, create: (overrides: Partial<typeof options> = {}) => createOnSiteCheckoutController({ ...options, ...overrides }) };
}
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
test("cash preview persists nothing; one submit keeps only the same shared nonce until explicit acknowledgement", async () => {
  const f = fixture(), c = f.create(); await c.activate(); await c.preview(selection, person); assert.equal(f.stored.size, 0); await c.submit(person); await c.submit(person);
  assert.equal(c.getSnapshot().phase, "confirmed"); assert.equal(c.getSnapshot().original!.method, "on_site"); assert.equal(f.calls.filter(r => r.path.endsWith("submit")).length, 1);
  assert.deepEqual(JSON.parse(f.stored.get(key)!), { version: 1, nonce }); assert.ok(!/Private|private@|coupon|1000/.test(f.stored.get(key)!));
  await c.startAnother(); assert.equal(c.getSnapshot().phase, "idle"); assert.equal(f.stored.size, 0);
});
test("lost submit stays blocked across reload; null recovery is not permission to discard it", async () => {
  const f = fixture(), c = f.create({ request: async (path, body, signal) => path.endsWith("submit") ? Promise.reject(new Error("lost")) : f.request(path, body, signal) });
  await c.activate(); await c.preview(selection, person); await c.submit(person); c.deactivate();
  const reload = f.create({ request: async () => ({ ok: true, state: "unconfirmed" }) }); await reload.activate(); await reload.preview(selection, person); await reload.submit(person); await reload.startAnother();
  assert.equal(reload.getSnapshot().phase, "unconfirmed"); assert.ok(f.stored.has(key));
});
test("cash respects an original points nonce; points also cannot overwrite an unresolved cash nonce", async () => {
  const f = fixture(); f.stored.set(key, JSON.stringify({ version: 1, nonce }));
  const pointResult = { version: 1, siteId: selection.siteId, operationKey: "a".repeat(64), resourceKind: "booking", resourceId: "point-original", totalPoints: 100, couponCount: 0, closed: false, resource: { status: "active", updatedAt: "2026-11-23T12:00:00Z" }, cancellationAvailable: false, cancellationPolicy: null, cancellation: null };
  const cash = f.create({ request: async () => ({ ok: true, state: "confirmed", original: { method: "points", result: pointResult } }) }); await cash.activate(); assert.equal(cash.getSnapshot().original?.method, "points"); await cash.submit(person); assert.equal(f.calls.length, 0);
  const old = createCheckoutClientController({ ...f.options, request: async () => ({ ok: true, state: "unconfirmed" }) }); await old.activate(); await old.preview(selection); await old.submit(person);
  assert.equal(old.getSnapshot().phase, "unconfirmed"); assert.equal(f.stored.size, 1);
});
test("native shared lock denies cash dispatch, and stale account/intent responses cannot restore a quote", async () => {
  const f = fixture(), c = f.create({ exclusive: async () => false }); await c.activate(); await c.preview(selection, person); await c.submit(person); assert.equal(c.getSnapshot().error, "checkout_other_tab"); assert.equal(f.stored.size, 0);
  const wait = deferred<unknown>(), late = f.create({ request: async () => wait.promise }); await late.activate(); const quoting = late.preview(selection, person); late.deactivate(); wait.resolve(preview()); await quoting;
  assert.equal(late.getSnapshot().quote, null); assert.equal(late.getSnapshot().phase, "idle");
});
test("double submit captures customer and selection; malformed or contradictory success remains unknown", async () => {
  const f = fixture(), wait = deferred<unknown>(), started = deferred<void>();
  const c = f.create({ request: async (path, body, signal) => { if (!path.endsWith("submit")) return f.request(path, body, signal); f.calls.push({ path, body: structuredClone(body) }); started.resolve(); return wait.promise; } });
  await c.activate(); const draft = { ...person }; await c.preview(selection, draft); const pending = c.submit(draft); await started.promise; draft.name = "Changed"; await c.submit(draft);
  wait.resolve({ ok: true, replayed: false, result: { ...result(), terms: { ...result().terms, grossMinor: 1200, dueMinor: 1200 } } }); await pending;
  assert.equal(c.getSnapshot().phase, "unconfirmed"); assert.equal((f.calls[1].body as { customer: typeof person }).customer.name, person.name); assert.equal(f.calls.filter(r => r.path.endsWith("submit")).length, 1); assert.ok(f.stored.has(key));
});
test("only definite no-write errors release a nonce; operation conflicts and unavailable replies keep it", async () => {
  for (const [code, status, pending] of [["checkout_quote_changed", 409, false], ["checkout_operation_conflict", 409, true], ["checkout_unconfirmed", 503, true]] as const) {
    const f = fixture(), c = f.create({ request: async (path, body, signal) => { if (path.endsWith("submit")) throw new CheckoutClientError(code, status); return f.request(path, body, signal); } });
    await c.activate(); await c.preview(selection, person); await c.submit(person); assert.equal(c.getSnapshot().pending, pending); assert.equal(f.stored.has(key), pending);
  }
});
test("cash display rejects wrong units, prices, reservation claims, tenant and policy; links contain no contacts", () => {
  assert.equal(parseOnSiteClientQuote(preview(), selection).dueMinor, 1000);
  for (const patch of [{ method: "points" }, { totalPoints: 100 }, { capturedMinor: 1 }, { dueMinor: 1 }, { siteId: "10909096" }, { reservationCreated: true }, { cancellationPolicy: { returnCoupons: null, advanceMinutes: 60 } }, { couponCount: 1 }]) assert.throws(() => parseOnSiteClientQuote({ ok: true, quote: { ...preview().quote, ...patch } }, selection));
  const href = buildOnSiteCheckoutStartHref(selection, "es-ES"); assert.ok(href.includes("/on-site/start?")); assert.ok(!/Private|private@|phone|couponClaims/.test(href));
});
