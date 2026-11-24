import assert from "node:assert/strict";
import test from "node:test";
import { singleIntentFixture } from "../../scripts/fixtures/member-checkout-single-intent";
import { cartReviewFixture } from "../../scripts/fixtures/member-checkout-cart-review";
import { createBoundCartCheckoutController, createBoundPointsCheckoutController, createBoundOnSiteCheckoutController, checkoutReferenceBindingKey, type BoundCheckoutRequest } from "./merchantCheckoutBoundClient";
import { checkoutClientStorageKey, CheckoutClientError } from "./merchantCheckoutClient";
import { assertCheckoutDraftLease, type CheckoutDraftReleaseCheck } from "./merchantCheckoutDraftLease";
import { cartClientOriginalKey } from "./merchantCheckoutCartReview";

type Kind = "points" | "on-site" | "cart";
async function fixture(kind: Kind = "points", mode = "lost") {
  const single = await singleIntentFixture(kind === "on-site" ? "on_site" : "points"), cart = await cartReviewFixture();
  const siteId = kind === "cart" ? cart.f.siteId : single.siteId, accountId = kind === "cart" ? cart.f.principal.accountId : single.accountId;
  const nonce = kind === "cart" ? cart.request.nonce : single.nonce, operationKey = kind === "cart" ? cart.result.operationKey : cartClientOriginalKey(single.original);
  const key = checkoutClientStorageKey(siteId, accountId), bindingKey = checkoutReferenceBindingKey(siteId, accountId), store = new Map([["host-cart", "KEEP member, products and contact"], ["host-form", "KEEP booking note"]]);
  const calls: Array<{ path: string; body: unknown; pinned?: string }> = [], writes: string[] = [], events: string[] = [];
  let closed = false, committed = false, acknowledged = false, locked = false, block = false, hold: ((path: string) => Promise<void>) | null = null, onClose: (() => void) | null = null;
  const original = kind === "cart" ? { kind: "cart" as const, result: cart.result } : single.original;
  const originalReview = () => ({ operationKey, generation: 1, reviewHash: "c".repeat(64), original, reviewRequired: false, acknowledged });
  const request: BoundCheckoutRequest = async (path, body, _signal, pinned) => {
    calls.push({ path, body, pinned }); if (hold) await hold(path);
    if (path.endsWith("intent/unused-review")) return { ok: true, readOnly: mode !== "badPreflight", review: { version: 1, siteId, operationKey, state: committed ? "original" : closed ? "closed" : "unused", reviewHash: committed ? null : "d".repeat(64), closedAt: closed ? "2026-11-24T12:00:00Z" : null } };
    if (path.includes("bound-submit/")) { assert.equal(pinned, operationKey); assert.ok(store.has(bindingKey)); events.push("financial");
      if (mode === "normal") { committed = true; return { ok: true, replayed: false, result: kind === "cart" ? cart.result : single.original.kind === "single" ? single.original.original.result : null }; }
      if (mode === "committed") committed = true; throw new CheckoutClientError("checkout_unconfirmed", 503);
    }
    if (path.endsWith("close-unused")) { assert.equal(pinned, operationKey); events.push("close"); if (onClose) onClose();
      if (committed) throw new CheckoutClientError("checkout_original_exists", 409);
      const replayed = closed; closed = true; if (mode === "closeLost" && !replayed) throw new CheckoutClientError("checkout_unused_unconfirmed", 503);
      return { ok: true, closure: { version: 1, siteId, operationKey, reviewHash: (mode === "badClosure" ? "e" : "d").repeat(64), closed: true, replayed, closedAt: "2026-11-24T12:00:00Z" } };
    }
    if (path.endsWith("intent/pending")) return { ok: true, snapshot: { version: 1, siteId, pending: committed && !acknowledged ? originalReview() : null } };
    if (path.endsWith("intent/review")) return { ok: true, review: committed ? originalReview() : null };
    if (path.endsWith("intent/acknowledge")) { acknowledged = true; events.push("ack"); return { ok: true, acknowledgement: { version: 1, siteId, operationKey, generation: 1, acknowledged: true, replayed: false } }; }
    if (path.endsWith("cart/recover")) return committed ? { ok: true, state: "confirmed", original } : { ok: true, state: "unconfirmed" };
    if (path.endsWith("preview")) return kind === "cart" ? cart.review : kind === "on-site" ? single.cashPreview : single.pointsPreview;
    throw Error("unexpected " + path);
  };
  const options = { siteId, accountId, randomNonce: () => nonce, boundRequest: request,
    storage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { writes.push(k); if (!(mode === "undurable" && k === bindingKey)) store.set(k, v); }, removeItem: (k: string) => { writes.push("remove:" + k); store.delete(k); } },
    exclusive: async (_key: string, run: () => Promise<void>) => { if (locked || block) return false; locked = true; try { await run(); return true; } finally { locked = false; } } };
  const make = () => kind === "cart" ? createBoundCartCheckoutController(options) : kind === "on-site" ? createBoundOnSiteCheckoutController(options) : createBoundPointsCheckoutController(options);
  const prepare = async (c: ReturnType<typeof make>) => {
    if (kind === "cart") await (c as ReturnType<typeof createBoundCartCheckoutController>).preview(cart.f.request, cart.customer);
    else if (kind === "on-site") await (c as ReturnType<typeof createBoundOnSiteCheckoutController>).preview(single.selection, single.customer);
    else await (c as ReturnType<typeof createBoundPointsCheckoutController>).preview(single.selection);
  };
  const submit = (c: ReturnType<typeof make>) => kind === "cart" ? (c as ReturnType<typeof createBoundCartCheckoutController>).submit() : (c as ReturnType<typeof createBoundPointsCheckoutController>).submit(single.customer);
  const verify: CheckoutDraftReleaseCheck = lease => { assertCheckoutDraftLease(lease, key); assert.equal(store.get("host-cart"), "KEEP member, products and contact"); return undefined; };
  return { kind, key, bindingKey, store, calls, writes, events, options, make, prepare, submit, verify, operationKey, nonce,
    closeState: () => closed, setHold: (fn: typeof hold) => { hold = fn; }, setClose: (fn: typeof onClose) => { onClose = fn; }, block: () => { block = true; }, commit: () => { committed = true; } };
}

for (const kind of ["points", "on-site", "cart"] as const) {
  test(`${kind}: fresh locked submission binds before dispatch; explicit close releases only nonce and keeps every draft`, async () => {
    const x = await fixture(kind), c = x.make(); await c.activate(); await x.prepare(c); await x.submit(c);
    assert.equal(c.getSnapshot().phase, "unconfirmed"); assert.ok(x.store.has(x.bindingKey));
    assert.equal(x.calls.filter(v => v.path.includes("bound-submit/")).length, 1);
    assert.equal(x.calls.filter(v => v.path.endsWith("unused-review")).length, 1);
    await c.reviewUnused(); assert.equal(c.getSnapshot().unusedReferenceReview?.state, "unused"); await c.closeUnused(false, x.verify); assert.equal(x.closeState(), false);
    await Promise.all([c.closeUnused(true, x.verify), c.closeUnused(true, x.verify)]);
    assert.equal(c.getSnapshot().phase, "idle"); assert.equal(x.store.has(x.key), false); assert.ok(x.store.has(x.bindingKey));
    assert.equal(x.events.filter(v => v === "close").length, 1); assert.equal(x.events.filter(v => v === "financial").length, 1);
    assert.deepEqual([...x.store.keys()].sort(), ["host-cart", "host-form", x.bindingKey].sort()); assert.equal(x.store.get("host-form"), "KEEP booking note");
    c.deactivate();
  });
  test(`${kind}: reopening reads a real bound unknown; lost close response needs explicit reread/replay, never a new financial request`, async () => {
    const x = await fixture(kind, "closeLost"); let c = x.make(); await c.activate(); await x.prepare(c); await x.submit(c); c.deactivate(); c = x.make(); await c.activate();
    await c.reviewUnused(); await c.closeUnused(true, x.verify); assert.equal(c.getSnapshot().unusedReferenceError, "checkout_unused_unconfirmed"); assert.ok(x.store.has(x.key));
    await c.reviewUnused(); assert.equal(c.getSnapshot().unusedReferenceReview?.state, "closed"); assert.ok(x.store.has(x.key)); await c.closeUnused(true, x.verify);
    assert.equal(c.getSnapshot().phase, "idle"); assert.equal(x.events.filter(v => v === "financial").length, 1); assert.equal(x.store.get("host-cart"), "KEEP member, products and contact"); c.deactivate();
  });
  test(`${kind}: legacy nonce without an exact sidecar cannot be rebound, closed or discarded`, async () => {
    const x = await fixture(kind); x.store.set(x.key, JSON.stringify({ version: 1, nonce: x.nonce })); const c = x.make(); await c.activate(); await c.reviewUnused(); await c.closeUnused(true, x.verify);
    assert.equal(c.getSnapshot().unusedReferenceError, "checkout_reference_unbound"); assert.equal(x.calls.some(v => /unused-review|close-unused|bound-submit/.test(v.path)), false); assert.ok(x.store.has(x.key)); assert.deepEqual(x.writes, []); c.deactivate();
  });
  test(`${kind}: an actual original uses its existing review/ack path, not unused closure`, async () => {
    const x = await fixture(kind, "committed"), c = x.make(); await c.activate(); await x.prepare(c); await x.submit(c);
    await c.recover();
    assert.equal(c.getSnapshot().phase, "confirmed"); await c.reviewUnused(); await c.closeUnused(true, x.verify); assert.equal(x.events.includes("close"), false); assert.ok(x.store.has(x.key)); c.deactivate();
  });
}

test("binding must durably match the nonce before any bound financial dispatch", async () => {
  const x = await fixture("points", "undurable"), c = x.make(); await c.activate(); await x.prepare(c); await x.submit(c);
  assert.equal(c.getSnapshot().pending, true); assert.equal(x.events.includes("financial"), false); assert.ok(x.store.has(x.key)); c.deactivate();
});

test("invalid preflight cannot dispatch and mismatched closure cannot release the reference", async () => {
  for (const mode of ["badPreflight", "badClosure"]) {
    const x = await fixture("points", mode), c = x.make(); await c.activate(); await x.prepare(c); await x.submit(c);
    if (mode === "badPreflight") { assert.equal(x.events.includes("financial"), false); assert.equal(x.store.has(x.bindingKey), false); }
    else { await c.reviewUnused(); await c.closeUnused(true, x.verify); assert.equal(x.closeState(), true); assert.equal(c.getSnapshot().phase, "unconfirmed"); }
    assert.ok(x.store.has(x.key)); assert.equal(x.store.get("host-cart"), "KEEP member, products and contact"); c.deactivate();
  }
});
test("changed binding/nonce bytes, missing binding and lock contention keep the reference and never close", async () => {
  for (const mode of ["nonce", "binding", "missing", "locked"] as const) {
    const x = await fixture(), c = x.make(); await c.activate(); await x.prepare(c); await x.submit(c); await c.reviewUnused();
    if (mode === "nonce") x.store.set(x.key, JSON.stringify({ version: 1, nonce: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }));
    if (mode === "binding") x.store.set(x.bindingKey, x.store.get(x.bindingKey)! + " "); if (mode === "missing") x.store.delete(x.bindingKey); if (mode === "locked") x.block();
    await c.closeUnused(true, x.verify); assert.ok(x.store.has(x.key)); assert.equal(x.events.includes("close"), false); c.deactivate();
  }
});
test("cart verification is required, and missing/changed host drafts pause both before and after closure", async () => {
  for (const mode of ["missing-port", "before", "after"] as const) {
    const x = await fixture("cart"), c = x.make(); await c.activate(); await x.prepare(c); await x.submit(c); await c.reviewUnused();
    if (mode === "before") x.store.delete("host-cart"); if (mode === "after") x.setClose(() => { x.store.set("host-cart", "CHANGED"); });
    await c.closeUnused(true, mode === "missing-port" ? undefined : x.verify); assert.ok(x.store.has(x.key)); assert.equal(c.getSnapshot().unusedReferenceError, "checkout_draft_unconfirmed");
    assert.equal(x.events.includes("close"), mode === "after"); c.deactivate();
  }
});
test("deactivation during preflight prevents a late binding write or financial dispatch", async () => {
  const x = await fixture(), c = x.make(); await c.activate(); await x.prepare(c);
  let release!: () => void, began!: () => void; const started = new Promise<void>(r => { began = r; });
  x.setHold(async path => { if (path.endsWith("unused-review")) { began(); await new Promise<void>(r => { release = r; }); } });
  const pending = x.submit(c); await started; c.deactivate(); await pending; release(); await new Promise(r => setImmediate(r));
  assert.equal(x.store.has(x.bindingKey), false); assert.equal(x.events.includes("financial"), false); assert.ok(x.store.has(x.key));
});
test("deactivation or nonce replacement during close keeps the nonce even after the server closes it", async () => {
  for (const mode of ["dispose", "replace"] as const) {
    const x = await fixture(), c = x.make(); await c.activate(); await x.prepare(c); await x.submit(c); await c.reviewUnused();
    x.setClose(() => { if (mode === "dispose") c.deactivate(); else x.store.set(x.key, JSON.stringify({ version: 1, nonce: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })); });
    await c.closeUnused(true, x.verify); assert.ok(x.store.has(x.key)); assert.equal(x.closeState(), true); c.deactivate();
  }
});
