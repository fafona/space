import assert from "node:assert/strict";
import test from "node:test";
import { singleHttpFixture } from "../../scripts/fixtures/member-checkout-single-http";
import { createIntentPointsCheckoutController, createIntentOnSiteCheckoutController, checkoutSingleIntentTransport } from "./merchantCheckoutSingleIntentClient";
import { checkoutResumeFixture } from "../../scripts/fixtures/member-checkout-resume";
const origin = "https://single.synthetic.invalid";
test("actual single transports, repeated session HTTP guards, financial planners and shared original/ack flow agree for points and venue payment", async t => {
  for (const method of ["points", "on_site"] as const) {
    const f = singleHttpFixture(method), stored = new Map<string, string>();
    t.mock.method(globalThis, "fetch", async (path: string, init: RequestInit) => {
      const headers = new Headers(init.headers); headers.set("origin", origin); return f.handle(origin + path, JSON.parse(String(init.body)), headers, init.signal ?? undefined);
    });
    const options = { siteId: f.siteId, accountId: f.principal.accountId, request: checkoutSingleIntentTransport(f.principal.accountId), randomNonce: () => f.nonce,
      storage: { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => { stored.set(k, v); }, removeItem: (k: string) => { stored.delete(k); } }, exclusive: async (_k: string, run: () => Promise<void>) => { await run(); return true; } };
    const c = method === "points" ? createIntentPointsCheckoutController(options) : createIntentOnSiteCheckoutController(options);
    await c.activate(); await c.preview(f.selection, f.customer); assert.equal(c.getSnapshot().phase, "ready", JSON.stringify(c.getSnapshot())); await c.submit(f.customer);
    assert.equal(c.getSnapshot().phase, "confirmed", JSON.stringify(c.getSnapshot())); assert.equal(c.getSnapshot().originalReview?.kind, "single");
    assert.equal(f.events.filter(e => e === "submit").length, 1); assert.equal(stored.size, 1); await c.startAnother(); assert.deepEqual(f.events, ["submit", "ack"]); assert.equal(stored.size, 0); assert.equal(c.getSnapshot().phase, "idle");
    if (method === "on_site") { const o = f.getOriginal(); assert.ok(o?.kind === "single" && o.original.method === "on_site"); assert.equal(o.original.result.terms.capturedMinor, 0); assert.equal(o.original.result.terms.paymentState, "unpaid"); }
    c.deactivate(); t.mock.restoreAll();
  }
});
test("only proven commit rollback adopts the other-device winner; a transport exception with identical text retains the fresh nonce", async t => {
  for (const method of ["points", "on_site"] as const) for (const failure of ["checkout_original_pending", "throw"] as const) {
    const f = singleHttpFixture(method), stored = new Map<string, string>(), winner = (await checkoutResumeFixture("cart_points")).original;
    t.mock.method(globalThis, "fetch", async (path: string, init: RequestInit) => {
      if (path.endsWith("/submit")) { f.setOriginal(winner); f.setCommitError(failure); }
      const headers = new Headers(init.headers); headers.set("origin", origin); return f.handle(origin + path, JSON.parse(String(init.body)), headers, init.signal ?? undefined);
    });
    const options = { siteId: f.siteId, accountId: f.principal.accountId, randomNonce: () => f.nonce,
      storage: { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => { stored.set(k, v); }, removeItem: (k: string) => { stored.delete(k); } }, exclusive: async (_k: string, run: () => Promise<void>) => { await run(); return true; } };
    const c = method === "points" ? createIntentPointsCheckoutController(options) : createIntentOnSiteCheckoutController(options);
    await c.activate(); await c.preview(f.selection, f.customer); await c.submit(f.customer);
    if (failure === "checkout_original_pending") { assert.deepEqual(c.getSnapshot().originalReview, winner); assert.equal(stored.size, 0); }
    else { assert.equal(c.getSnapshot().phase, "unconfirmed"); assert.equal(stored.size, 1); assert.equal(c.getSnapshot().originalReview, undefined); }
    await c.startAnother(); assert.deepEqual(f.events, []); assert.equal(f.calls.filter(n => n.includes("commit")).length, 1); c.deactivate(); t.mock.restoreAll();
  }
});
