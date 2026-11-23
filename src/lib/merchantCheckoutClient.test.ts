import assert from "node:assert/strict";
import test from "node:test";
import { createCheckoutClientController, checkoutClientStorageKey, CheckoutClientError, parseCheckoutClientPreview, parseCheckoutStartQuery, buildCheckoutStartHref, type CheckoutClientRequest, type CheckoutClientSelection } from "./merchantCheckoutClient";

const selection: CheckoutClientSelection = { siteId: "10909095", offerId: "11111111-1111-4111-8111-111111111111", offerRevision: "22222222-2222-4222-8222-222222222222", quantity: 1, appointmentAt: "2030-01-01T12:00", couponClaims: [] };
const person = { name: "Private name", title: "Mx", email: "private@example.invalid", phone: "000000000", note: "Private note" };
const nonce = "33333333-3333-4333-8333-333333333333", key = checkoutClientStorageKey(selection.siteId, "50010105");
const result = { version: 1 as const, siteId: selection.siteId, operationKey: "a".repeat(64), resourceKind: "booking" as const, resourceId: "original-booking", totalPoints: 100, couponCount: 0,
  resource: { status: "active", updatedAt: "2026-11-23T12:00:00Z" }, closed: false, cancellation: null, cancellationAvailable: false, cancellationPolicy: null };
function preview(input = selection) {
  const couponCount = input.couponClaims?.length ?? 0;
  return { ok: true, confirmationHash: "b".repeat(64), quote: { version: 1, siteId: input.siteId, offerId: input.offerId, offerRevision: input.offerRevision,
    quantity: input.quantity, title: "Synthetic booking", resourceKind: "booking", ownPointBalance: 500, reservationCreated: false,
    options: [{ method: "points", available: true, totalPoints: 100 - 20 * couponCount, couponCount }],
    coupons: { previewOnly: true, selected: input.couponClaims ?? [], returnOnCancel: true, points: [{ couponId: "coupon-one", claimEventId: "claim-one", title: "20 points",
      kind: "points_voucher", available: true, singleUse: true, validUntil: null, pointsDiscount: 20, cashDiscountMinor: 0, coveredQuantity: 0 }] } },
    bookingForm: { store: "Store", item: "Play", titles: ["Mx"], timeZone: "Europe/Madrid" }, cancellationPolicy: { returnPoints: true, returnCoupons: true, advanceMinutes: 60 }, slot: { appointmentAt: input.appointmentAt, timeZone: "Europe/Madrid", reserved: false } };
}
function fixture() {
  const stored = new Map<string, string>(), calls: Array<{ path: string; body: unknown }> = [];
  const storage = { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value); }, removeItem: (key: string) => { stored.delete(key); } };
  let locked = false;
  const exclusive = async (_key: string, run: () => Promise<void>) => { if (locked) return false; locked = true; try { await run(); return true; } finally { locked = false; } };
  const request: CheckoutClientRequest = async (path, body) => {
    calls.push({ path, body: structuredClone(body) });
    if (path.endsWith("preview")) return preview(body as CheckoutClientSelection);
    if (path.endsWith("recover")) return { ok: true, state: "confirmed", result };
    return { ok: true, replayed: false, result };
  };
  const options = { siteId: selection.siteId, accountId: "50010105", storage, exclusive, randomNonce: () => nonce, request };
  const create = (overrides: Partial<typeof options> = {}) => createCheckoutClientController({ ...options, ...overrides });
  return { stored, calls, storage, options, request, create };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(fn => { resolve = fn; }); return { promise, resolve }; }
test("one confirmed client intent submits once, preserves only a nonce, and requires explicit original acknowledgement", async () => {
  const f = fixture(), c = f.create(); await c.activate(); await c.preview(selection); await c.submit(person);
  assert.equal(c.getSnapshot().phase, "confirmed"); assert.deepEqual(JSON.parse(f.stored.get(key)!), { version: 1, nonce });
  assert.ok(!/Private|private@|100|500|coupon/.test(f.stored.get(key)!));
  await c.submit(person); assert.equal(f.calls.filter(call => call.path.endsWith("submit")).length, 1);
  await c.startAnother(); assert.equal(c.getSnapshot().phase, "idle"); assert.equal(f.stored.has(key), false);
  assert.deepEqual(f.calls.map(call => call.path.split("/").pop()), ["preview", "submit", "recover"]);
});
test("double clicks and caller mutation cannot change a request while its one write waits", async () => {
  const f = fixture(), started = deferred<void>(), response = deferred<unknown>();
  const c = f.create({ request: async (path, body, signal) => { if (!path.endsWith("submit")) return f.request(path, body, signal);
    f.calls.push({ path, body: structuredClone(body) }); started.resolve(); return response.promise; } });
  await c.activate(); const chosen = structuredClone(selection), customer = { ...person }; await c.preview(chosen);
  const pending = c.submit(customer); await started.promise; customer.name = "Changed later"; chosen.quantity = 5; await c.submit(customer);
  response.resolve({ ok: true, replayed: false, result }); await pending;
  assert.equal(f.calls.filter(call => call.path.endsWith("submit")).length, 1);
  assert.equal((f.calls[1].body as { customer: typeof person }).customer.name, person.name);
  assert.equal((f.calls[1].body as { quantity: number }).quantity, 1);
});
test("unknown transport result stays blocked across controller destruction and reload; empty recovery never clears it", async () => {
  const f = fixture(), c = f.create({ request: async (path, body, signal) => path.endsWith("submit") ? Promise.reject(new Error("lost")) : f.request(path, body, signal) });
  await c.activate(); await c.preview(selection); await c.submit(person); assert.equal(c.getSnapshot().phase, "unconfirmed"); c.deactivate();
  const after = f.create({ request: async () => ({ ok: true, state: "unconfirmed" }) }); await after.activate();
  await after.preview(selection); await after.submit(person); await after.startAnother();
  assert.equal(after.getSnapshot().phase, "unconfirmed"); assert.ok(f.stored.has(key));
  assert.equal(f.calls.filter(call => call.path.endsWith("submit")).length, 0);
});
test("a restored original result is safely projected without a new preview or submit", async () => {
  const f = fixture(); f.stored.set(key, JSON.stringify({ version: 1, nonce }));
  const c = f.create({ request: async (path, body) => { f.calls.push({ path, body }); return { ok: true, state: "confirmed", result: { ...result, memberId: "PRIVATE" } }; } });
  await c.activate(); assert.equal(c.getSnapshot().phase, "confirmed"); assert.deepEqual(c.getSnapshot().result, result);
  assert.equal(f.calls.length, 1); assert.ok(f.calls[0].path.endsWith("recover"));
});
test("only a definite no-write business rejection releases the nonce and demands a fresh quote", async () => {
  for (const [code, status, cleared] of [["checkout_quote_changed", 409, true], ["checkout_invalid_customer", 400, true], ["checkout_unconfirmed", 503, false], ["checkout_conflict", 503, false], ["private SQL", 409, false], ["checkout_unauthorized", 401, false]] as const) {
    const f = fixture(), c = f.create({ request: async (path, body, signal) => { if (path.endsWith("submit")) throw new CheckoutClientError(code, status); return f.request(path, body, signal); } });
    await c.activate(); await c.preview(selection); await c.submit(person);
    assert.equal(!f.stored.has(key), cleared); assert.equal(c.getSnapshot().phase, cleared ? "error" : "unconfirmed");
    await c.submit(person); assert.equal(c.getSnapshot().phase, cleared ? "error" : "unconfirmed");
  }
});
test("blocked, corrupted or non-durable storage prevents a financial request, never falls back to a fresh in-memory nonce", async () => {
  for (const mode of ["get", "set", "silent", "corrupt"]) {
    const f = fixture(); if (mode === "corrupt") f.stored.set(key, "garbage");
    const storage = { ...f.storage, getItem: (key: string) => { if (mode === "get") throw new Error("blocked"); return f.storage.getItem(key); },
      setItem: (key: string, value: string) => { if (mode === "set") throw new Error("full"); if (mode !== "silent") f.storage.setItem(key, value); } };
    const c = f.create({ storage }); await c.activate(); await c.preview(selection); await c.submit(person);
    assert.equal(f.calls.some(call => call.path.endsWith("submit")), false); assert.equal(c.getSnapshot().error, "checkout_storage_unavailable");
  }
});
test("another same-origin tab cannot issue a second write while an original write owns the lock", async () => {
  const f = fixture(), started = deferred<void>(), response = deferred<unknown>();
  const first = f.create({ request: async (path, body, signal) => { if (!path.endsWith("submit")) return f.request(path, body, signal); started.resolve(); return response.promise; } });
  const second = f.create(); await first.activate(); await second.activate(); await first.preview(selection); await second.preview(selection);
  const pending = first.submit(person); await started.promise; await second.submit(person);
  assert.equal(second.getSnapshot().error, "checkout_other_tab"); assert.equal(f.calls.some(call => call.path.endsWith("submit")), false);
  response.resolve({ ok: true, replayed: false, result }); await pending;
  await second.recover(); assert.equal(second.getSnapshot().phase, "confirmed");
});
test("an original discovered before submit is recovered, never overwritten with another nonce", async () => {
  const f = fixture(), c = f.create(); await c.activate(); await c.preview(selection); f.stored.set(key, JSON.stringify({ version: 1, nonce }));
  await c.submit(person); assert.equal(c.getSnapshot().phase, "confirmed"); assert.equal(f.calls.some(call => call.path.endsWith("submit")), false);
});
test("account/site scopes differ and a late deactivated quote or receipt never restores old-account data", async () => {
  const f = fixture(), response = deferred<unknown>(), started = deferred<void>(), c = f.create({ request: async () => { started.resolve(); return response.promise; } });
  await c.activate(); const pending = c.preview(selection); await started.promise; c.deactivate(); response.resolve(preview()); await pending;
  assert.deepEqual(c.getSnapshot(), { phase: "idle", quote: null, result: null, pending: false, error: "" });
  assert.notEqual(checkoutClientStorageKey(selection.siteId, "50010106"), key); assert.notEqual(checkoutClientStorageKey("10909096", "50010105"), key);
});
test("editing invalidates the old quote; unavailable or malformed previews cannot dispatch", async () => {
  const f = fixture(), c = f.create(); await c.activate(); await c.preview(selection); c.edit(); await c.submit(person);
  assert.equal(f.calls.some(call => call.path.endsWith("submit")), false); assert.equal(c.getSnapshot().quote, null);
  const wrong = preview(); wrong.quote.offerRevision = selection.offerId; assert.throws(() => parseCheckoutClientPreview(wrong, selection));
  const omitted = preview({ ...selection, couponClaims: [{ couponId: "coupon-one", claimEventId: "claim-one" }] }); omitted.quote.coupons.selected = [];
  assert.throws(() => parseCheckoutClientPreview(omitted, { ...selection, couponClaims: [{ couponId: "coupon-one", claimEventId: "claim-one" }] }));
});
test("invalid or mismatched financial success remains unknown and cannot start another checkout", async () => {
  const f = fixture(), c = f.create({ request: async (path, body, signal) => path.endsWith("submit") ? { ok: true, replayed: false, result: { ...result, totalPoints: 99 } } : f.request(path, body, signal) });
  await c.activate(); await c.preview(selection); await c.submit(person); assert.equal(c.getSnapshot().phase, "unconfirmed"); assert.ok(f.stored.has(key));
  await c.startAnother(); assert.ok(f.stored.has(key));
});
test("starting another checkout rechecks the same original and cannot clear a different tab's reference", async () => {
  const f = fixture(), c = f.create(); await c.activate(); await c.preview(selection); await c.submit(person);
  const other = "44444444-4444-4444-8444-444444444444"; f.stored.set(key, JSON.stringify({ version: 1, nonce: other }));
  await c.startAnother(); assert.equal(JSON.parse(f.stored.get(key)!).nonce, other); assert.equal(c.getSnapshot().phase, "unconfirmed"); assert.equal(c.getSnapshot().result, null);
});
test("local storage disappearing never releases an in-memory original or enables another write", async () => {
  const f = fixture(), c = f.create({ request: async (path, body, signal) => path.endsWith("submit") ? Promise.reject(new Error("lost")) : f.request(path, body, signal) });
  await c.activate(); await c.preview(selection); await c.submit(person); f.stored.clear(); await c.recover();
  assert.equal(c.getSnapshot().phase, "unconfirmed"); assert.equal(c.getSnapshot().pending, true); assert.equal(c.getSnapshot().error, "checkout_storage_unavailable");
  await c.preview(selection); await c.submit(person); assert.equal(f.calls.length, 1);
});
test("late write responses after sign-out cannot restore a receipt and keep the original nonce for the next sign-in", async () => {
  const f = fixture(), started = deferred<void>(), response = deferred<unknown>();
  const c = f.create({ request: async (path, body, signal) => { if (!path.endsWith("submit")) return f.request(path, body, signal); started.resolve(); return response.promise; } });
  await c.activate(); await c.preview(selection); const pending = c.submit(person); await started.promise; c.deactivate(); response.resolve({ ok: true, replayed: false, result }); await pending;
  assert.equal(c.getSnapshot().result, null); assert.equal(c.getSnapshot().phase, "idle"); assert.ok(f.stored.has(key));
  const returned = f.create(); await returned.activate(); assert.equal(returned.getSnapshot().phase, "confirmed"); assert.deepEqual(returned.getSnapshot().result, result);
});
test("entry URLs retain only selection and language, allow the existing login return marker, and reject authoritative/customer extras", () => {
  const { couponClaims: _claims, siteId, ...base } = selection; void _claims;
  const href = buildCheckoutStartHref({ ...base, siteId }, "es-ES"), url = new URL(href, "https://synthetic.faolla.invalid");
  assert.deepEqual(parseCheckoutStartQuery(siteId, { ...Object.fromEntries(url.searchParams), entry: "web" }), { ...selection, couponClaims: undefined });
  for (const extra of [{ accountId: "50010106" }, { email: "private@example.invalid" }, { paid: "true" }, { quantity: ["1", "2"] }, { entry: "app" }, { uiLocale: "<script>" }]) {
    assert.throws(() => parseCheckoutStartQuery(siteId, { ...Object.fromEntries(url.searchParams), ...extra }));
  }
  assert.ok(!/private|50010105|claim/.test(href));
});
test("product quantities and full-voucher zero-point quotes do not become cash payments or booking-time requests", () => {
  const selected = { ...selection, appointmentAt: undefined, quantity: 2, couponClaims: [{ couponId: "coupon-one", claimEventId: "claim-one" }] };
  const raw = preview(selected); raw.quote.resourceKind = "order"; raw.quote.options[0].totalPoints = 0;
  const product = { ...raw, slot: null, bookingForm: null };
  const quote = parseCheckoutClientPreview(product, selected); assert.equal(quote.kind, "order"); assert.equal(quote.quantity, 2); assert.equal(quote.points, 0); assert.equal(quote.couponCount, 1);
  assert.equal(quote.bookingForm, null); assert.equal("paid" in quote, false); assert.equal("cash" in quote, false);
});
