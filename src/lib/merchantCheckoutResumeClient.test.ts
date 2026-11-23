import assert from "node:assert/strict";
import test from "node:test";
import { checkoutResumeFixture } from "../../scripts/fixtures/member-checkout-resume";
import { createCheckoutResumeController, buildCheckoutResumeHref, checkoutResumeOriginalHref } from "./merchantCheckoutResumeClient";
import type { CheckoutClientRequest } from "./merchantCheckoutClient";

test("four original types use the one read-only discovery path; navigation carries no offer, contact, member or nonce", async () => {
  for (const kind of ["cart_points", "cart_on_site", "single_points", "single_on_site"] as const) {
    const x = await checkoutResumeFixture(kind), calls: unknown[] = [], c = createCheckoutResumeController({ ...x, request: async (path, body, signal) => { calls.push({ path, body }); assert.ok(signal instanceof AbortSignal); return { ok: true, snapshot: x.snapshot }; } });
    await c.activate(); assert.equal(c.getSnapshot().phase, "ready"); assert.deepEqual(c.getSnapshot().snapshot, x.snapshot);
    assert.deepEqual(calls, [{ path: "/api/member-checkout/intent/pending", body: { siteId: x.siteId } }]);
    assert.deepEqual(Object.keys(c).sort(), ["activate", "deactivate", "getSnapshot", "read", "subscribe"]);
    const url = new URL(buildCheckoutResumeHref(x.siteId, "es-ES"), "https://original.synthetic.invalid"); assert.equal(url.pathname, `/member-checkout/${x.siteId}/resume`); assert.deepEqual([...url.searchParams], [["uiLocale", "es-ES"]]);
    const path = checkoutResumeOriginalHref(x.original, x.siteId, "zh-CN"); assert.equal(path, `/member-checkout/${x.siteId}/${kind.startsWith("cart") ? "cart/" : kind.endsWith("on_site") ? "on-site/" : ""}${x.snapshot.pending!.operationKey}?uiLocale=zh-CN`);
    c.deactivate(); assert.equal(c.getSnapshot().snapshot, null);
  }
});
test("none never creates/replaces a reference or acknowledges a result", async () => {
  const x = await checkoutResumeFixture(), calls: string[] = [], c = createCheckoutResumeController({ ...x, request: async path => { calls.push(path); return { ok: true, snapshot: { version: 1, siteId: x.siteId, pending: null } }; } });
  await c.activate(); await c.read(); assert.equal(c.getSnapshot().snapshot?.pending, null); assert.ok(calls.every(p => p.endsWith("intent/pending"))); assert.equal(calls.length, 2); c.deactivate();
});
test("malformed/foreign/private responses fail closed without retaining or leaking an earlier original", async () => {
  const x = await checkoutResumeFixture(); let raw: unknown = { ok: true, snapshot: x.snapshot };
  const c = createCheckoutResumeController({ ...x, request: async () => raw }); await c.activate(); assert.ok(c.getSnapshot().snapshot?.pending);
  for (raw of [null, {}, { ok: false }, { ok: true, snapshot: { ...x.snapshot, siteId: "00000000" } }, { ok: true, snapshot: { ...x.snapshot, pending: { ...x.snapshot.pending, operationKey: "f".repeat(64) } } }]) {
    const pending = c.read(); assert.equal(c.getSnapshot().snapshot, null); await pending; assert.deepEqual(c.getSnapshot(), { phase: "error", snapshot: null, error: "checkout_intent_unavailable" });
  } c.deactivate();
});
test("double read is single-dispatch, deactivation aborts an uncooperative request and late results cannot reveal old identity", async () => {
  const x = await checkoutResumeFixture(); let release!: (raw: unknown) => void, started!: () => void; const began = new Promise<void>(r => { started = r; }); let calls = 0, heldSignal!: AbortSignal;
  const c = createCheckoutResumeController({ ...x, request: async (_p, _b, signal) => { calls++; heldSignal = signal; started(); return new Promise(r => { release = r; }); } });
  const active = c.activate(); await began; await c.read(); assert.equal(calls, 1); c.deactivate(); assert.equal(heldSignal.aborted, true); await active;
  release({ ok: true, snapshot: x.snapshot }); await Promise.resolve(); assert.equal(c.getSnapshot().snapshot, null); assert.equal(c.getSnapshot().phase, "idle");
});
test("a bounded read settles even if transport ignores abort; no stale result or raw failure escapes", async t => {
  const x = await checkoutResumeFixture(), timeout = AbortSignal.timeout.bind(AbortSignal); t.mock.method(AbortSignal, "timeout", () => timeout(10));
  const c = createCheckoutResumeController({ ...x, request: async () => new Promise(() => {}) }); const keepAlive = setTimeout(() => {}, 1000);
  try { await c.activate(); assert.equal(c.getSnapshot().phase, "error"); assert.equal(c.getSnapshot().snapshot, null); assert.equal(c.getSnapshot().error, "checkout_intent_unavailable"); } finally { clearTimeout(keepAlive); c.deactivate(); }
});
test("production transport sends the exact account consistency hint and only same-origin private POST reads", async t => {
  const x = await checkoutResumeFixture(), calls: unknown[] = []; t.mock.method(globalThis, "fetch", async (path: string, options: RequestInit) => { calls.push({ path, options }); return new Response(JSON.stringify({ ok: true, snapshot: x.snapshot }), { headers: { "content-type": "application/json" } }); });
  const c = createCheckoutResumeController(x); await c.activate(); assert.equal(calls.length, 1);
  const request = calls[0] as { path: string; options: RequestInit }; assert.equal(request.path, "/api/member-checkout/intent/pending"); assert.equal(request.options.method, "POST"); assert.equal(request.options.cache, "no-store"); assert.equal(request.options.credentials, "same-origin"); assert.equal(new Headers(request.options.headers).get("x-checkout-account-scope"), x.accountId); assert.equal(request.options.body, JSON.stringify({ siteId: x.siteId })); c.deactivate();
});
test("unsafe routes/identity/locale and cross-site original links are never navigable", async () => {
  const x = await checkoutResumeFixture(); for (const siteId of ["", "../other", "https://other.invalid", "10909994?x=1"]) assert.throws(() => buildCheckoutResumeHref(siteId, "es-ES"));
  for (const locale of ["", "es_ES", "x?memberId=secret", "a".repeat(41)]) assert.throws(() => buildCheckoutResumeHref(x.siteId, locale));
  assert.throws(() => checkoutResumeOriginalHref(x.original, "10909993", "zh-CN")); assert.throws(() => createCheckoutResumeController({ siteId: x.siteId, accountId: "guest" }));
  const c = createCheckoutResumeController({ ...x, request: (async () => { throw Error("PRIVATE database contacts"); }) as CheckoutClientRequest }); await c.activate(); assert.ok(!JSON.stringify(c.getSnapshot()).includes("PRIVATE")); c.deactivate();
});
