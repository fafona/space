import assert from "node:assert/strict";
import test from "node:test";
import { historyRecoveryFixture } from "../../scripts/fixtures/member-checkout-history-recovery";
import { singleIntentFixture } from "../../scripts/fixtures/member-checkout-single-intent";
import { createIntentPointsCheckoutController, createIntentOnSiteCheckoutController } from "./merchantCheckoutSingleIntentClient";
import { checkoutClientStorageKey, CheckoutClientError, type CheckoutClientRequest } from "./merchantCheckoutClient";
import { handleRetainedCheckoutIntent, type RetainedIntentDependencies } from "./merchantCheckoutRetainedIntent.server";

async function fixture(method: "points" | "on_site" = "points", kind: Parameters<typeof historyRecoveryFixture>[0] = "single_points", enabled = true, mode = "normal") {
  const x = await historyRecoveryFixture(kind), f = await singleIntentFixture(method), key = checkoutClientStorageKey(x.siteId, x.accountId), original = x.recovery.original!, hash = "a".repeat(64);
  const stored = JSON.stringify({ version: 1, nonce: x.nonce }), store = new Map([[key, stored], ["native-form", "KEEP original booking/member/contact"], ["native-cart", "KEEP products, member, note"]]);
  const initial = new Map(store), calls: string[] = [], writes: string[] = [], rpc: string[] = []; let registered = false, acknowledged = false, changed = false;
  const review = () => ({ operationKey: x.identity.operationKey, generation: 1, reviewHash: changed ? "b".repeat(64) : hash, original, reviewRequired: mode === "manual", acknowledged });
  const origin = "https://single-retained.synthetic.invalid", session = { ...x.principal, servicePaused: false, user: { email_confirmed_at: new Date().toISOString() } } as unknown as Awaited<ReturnType<RetainedIntentDependencies["session"]>>;
  const request: CheckoutClientRequest = async (path, body, signal) => {
    calls.push(path);
    if (path.endsWith("cart/recover")) return { ok: true, state: "confirmed", original };
    if (path.endsWith("intent/review")) { if (mode === "failedRead") throw new CheckoutClientError("checkout_intent_unconfirmed", 503); return { ok: true, review: registered ? review() : null }; }
    if (/intent\/(retained-review|register-retained)$/.test(path)) {
      const register = path.endsWith("register-retained");
      const response = await handleRetainedCheckoutIntent(register, new Request(origin + path, { method: "POST", headers: { origin, "content-type": "application/json", "x-checkout-account-scope": x.accountId }, body: JSON.stringify(body), signal }), {
        enabled: () => mode !== "closed", session: async () => session, call: async (name, args) => {
          rpc.push(name); assert.equal(args.p_operation_key, x.identity.operationKey); assert.equal(args.p_principal_key, x.identity.principalKey);
          if (name.endsWith("retained_intent_review_v1")) return { data: { version: 1, siteId: x.siteId, operationKey: x.identity.operationKey,
            proposal: { reviewHash: changed ? "b".repeat(64) : hash, original, reviewRequired: mode === "manual" } }, error: null };
          registered = true;
          if (mode === "deactivate") c.deactivate();
          if (mode === "replacedNonce") store.set(key, JSON.stringify({ version: 1, nonce: "99999999-9999-4999-8999-999999999999" }));
          return { data: mode === "malformed" ? {} : { version: 1, siteId: x.siteId, replayed: false, review: review() }, error: null };
        },
      });
      if (register && mode === "lost") throw new Error("lost response");
      const value = await response.json(); if (!response.ok) throw new CheckoutClientError(value.error, response.status); return value;
    }
    if (path.endsWith("intent/acknowledge")) { assert.equal(registered, true); acknowledged = true; if (mode === "ackLost") throw new Error("ack lost"); return { ok: true, acknowledgement: { version: 1, siteId: x.siteId, operationKey: x.identity.operationKey, generation: 1, acknowledged: true, replayed: false } }; }
    if (path.endsWith("intent/pending")) return { ok: true, snapshot: { version: 1, siteId: x.siteId, pending: null } };
    throw new Error("Unexpected financial/form/cart action: " + path);
  };
  const options = { siteId: x.siteId, accountId: x.accountId, retainedIntentEnabled: enabled, request,
    storage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { writes.push(k); store.set(k, v); }, removeItem: (k: string) => { writes.push(k); store.delete(k); } },
    exclusive: async (_key: string, run: () => Promise<void>) => { if (mode === "locked") return false; await run(); return true; } };
  const c = method === "points" ? createIntentPointsCheckoutController(options) : createIntentOnSiteCheckoutController(options);
  const register = (confirmed: boolean) => (c as unknown as { registerRetained?: (confirmed: boolean) => Promise<void> }).registerRetained?.(confirmed);
  const state = () => c.getSnapshot() as ReturnType<typeof c.getSnapshot> & { retainedRegistrationRequired?: boolean };
  await c.activate(); return { ...x, f, c, state, register, store, initial, key, stored, calls, rpc, writes, changed: () => { changed = true; } };
}
test("both single entry methods expose explicit registration for exact old single originals, never auto-ack or alter host data", async () => {
  for (const method of ["points", "on_site"] as const) for (const kind of ["single_points", "single_on_site"] as const) {
    const x = await fixture(method, kind); try {
      assert.equal(x.state().retainedRegistrationRequired, true); assert.equal(x.state().originalReview?.kind, "single");
      await x.c.startAnother(); await x.register(false); assert.equal(x.rpc.some(n => n.endsWith("register_retained_intent_v1")), false);
      await Promise.all([x.register(true), x.register(true)]); assert.equal(x.rpc.filter(n => n.endsWith("register_retained_intent_v1")).length, 1);
      assert.equal(x.state().retainedRegistrationRequired, false); assert.equal(x.state().pending, true); assert.deepEqual(x.store, x.initial); assert.deepEqual(x.writes, []);
      await x.c.startAnother(); assert.equal(x.state().pending, false); assert.equal(x.calls.filter(p => p.endsWith("acknowledge")).length, 1);
      assert.deepEqual(x.writes, [x.key]); for (const [k, v] of x.initial) if (k !== x.key) assert.equal(x.store.get(k), v);
      assert.equal(x.calls.some(p => /\/(preview|submit|cancel)$/.test(p)), false);
    } finally { x.c.deactivate(); }
  }
});
test("untracked cart originals may be viewed but a single entry cannot register, acknowledge or release their reference", async () => {
  for (const kind of ["cart_points", "cart_on_site"] as const) {
    const x = await fixture("points", kind); try { assert.equal(x.state().originalReview?.kind, "cart"); assert.notEqual(x.state().retainedRegistrationRequired, true);
      await x.register(true); await x.c.startAnother(); assert.deepEqual(x.store, x.initial); assert.deepEqual(x.writes, []);
      assert.equal(x.rpc.some(n => n.endsWith("register_retained_intent_v1")), false); assert.equal(x.calls.some(p => p.endsWith("acknowledge")), false);
    } finally { x.c.deactivate(); }
  }
});
test("closed capability, failed tracked read, changed view, manual review and busy native lock retain every original byte", async () => {
  for (const [enabled, mode] of [[false, "normal"], [true, "failedRead"], [true, "closed"], [true, "manual"], [true, "locked"], [true, "changed"]] as const) {
    const x = await fixture("on_site", "single_on_site", enabled, mode); try { if (mode === "changed") x.changed(); await x.register(true); await x.c.startAnother();
      assert.deepEqual(x.store, x.initial); assert.deepEqual(x.writes, []); assert.equal(x.rpc.some(n => n.endsWith("register_retained_intent_v1")), false, mode);
      if (!enabled || mode === "failedRead") assert.equal(x.calls.some(p => p.endsWith("retained-review")), false);
    } finally { x.c.deactivate(); }
  }
});
test("lost registration reply is recovered by exact existing claim; neither registration nor finance is repeated", async () => {
  const x = await fixture("points", "single_on_site", true, "lost"); try { await x.register(true); assert.equal(x.state().phase, "unconfirmed"); assert.deepEqual(x.store, x.initial);
    await x.c.recover(); assert.equal(x.state().phase, "confirmed"); assert.equal(x.state().retainedRegistrationRequired, false); await x.register(true);
    assert.equal(x.rpc.filter(n => n.endsWith("register_retained_intent_v1")).length, 1); await x.c.startAnother(); assert.equal(x.calls.filter(p => p.endsWith("acknowledge")).length, 1);
    assert.equal(x.calls.some(p => p.endsWith("submit")), false); for (const [k, v] of x.initial) if (k !== x.key) assert.equal(x.store.get(k), v);
  } finally { x.c.deactivate(); }
});
test("a lost acknowledgement after registration needs exact read-back, never another acknowledgement or financial dispatch", async () => {
  const x = await fixture("on_site", "single_points", true, "ackLost"); try {
    await x.register(true); await x.c.startAnother(); assert.equal(x.state().phase, "unconfirmed"); assert.deepEqual(x.store, x.initial);
    await x.c.recover(); await x.c.startAnother(); assert.equal(x.state().pending, false); assert.equal(x.calls.filter(p => p.endsWith("acknowledge")).length, 1);
    assert.equal(x.rpc.filter(n => n.endsWith("register_retained_intent_v1")).length, 1); assert.deepEqual(x.writes, [x.key]);
    for (const [k, v] of x.initial) if (k !== x.key) assert.equal(x.store.get(k), v);
  } finally { x.c.deactivate(); }
});
test("registration cannot restore a deactivated identity, accept malformed proof or clear another tab's nonce", async () => {
  for (const mode of ["deactivate", "malformed", "replacedNonce"]) {
    const x = await fixture("points", "single_points", true, mode); try { await x.register(true); await x.c.startAnother();
      assert.equal(x.state().originalReview, undefined); assert.deepEqual(x.writes, []); assert.equal(x.calls.some(p => p.endsWith("acknowledge")), false);
      if (mode === "replacedNonce") assert.ok(x.store.get(x.key)!.includes("99999999-9999-4999-8999-999999999999")); else assert.equal(x.store.get(x.key), x.stored);
      for (const [k, v] of x.initial) if (k !== x.key) assert.equal(x.store.get(k), v);
    } finally { x.c.deactivate(); }
  }
});
