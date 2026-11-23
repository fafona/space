import assert from "node:assert/strict";
import test from "node:test";
import { cartReviewFixture } from "../../scripts/fixtures/member-checkout-cart-review";
import { readPersonalCheckoutCartResource, type CartHistoryDependencies } from "./merchantCheckoutCartHistory.server";
async function fixture() {
  const x = await cartReviewFixture(), session = { ...x.f.principal, servicePaused: false, user: { email_confirmed_at: new Date().toISOString() } } as unknown as Awaited<ReturnType<CartHistoryDependencies["session"]>>;
  const input = { request: new Request("https://synthetic.invalid/"), siteId: x.f.siteId, kind: "order" as const, id: x.result.resourceId, expectedAccountId: x.f.principal.accountId };
  let calls = 0;
  const deps: CartHistoryDependencies = { enabled: () => true, session: async () => session, call: async (args, signal) => {
    calls++; assert.ok(signal instanceof AbortSignal); assert.deepEqual(args, { p_site_id: input.siteId, p_kind: input.kind, p_id: input.id, p_principal_key: `account:${x.f.principal.accountId}:${x.f.principal.userId}` });
    return { data: { kind: "cart", result: { ...x.result, memberId: "PRIVATE", claimEvents: "PRIVATE" } }, error: null };
  } };
  return { ...x, input, deps, session, calls: () => calls };
}
test("cart history reads one actual own resource and strips private metadata", async () => {
  const x = await fixture(), original = await readPersonalCheckoutCartResource(x.input, x.deps);
  assert.equal(original!.kind, "cart"); assert.equal(x.calls(), 1); assert.ok(!JSON.stringify(original).includes("PRIVATE"));
});
test("history rejects default-off, malformed scope and unverified/paused/other-account identity before RPC", async () => {
  const x = await fixture(); await assert.rejects(readPersonalCheckoutCartResource(x.input, { ...x.deps, enabled: () => false }));
  for (const session of [null, { ...x.session!, servicePaused: true }, { ...x.session!, user: { email_confirmed_at: "" } }, { ...x.session!, accountId: "50010106" }]) {
    await assert.rejects(readPersonalCheckoutCartResource(x.input, { ...x.deps, session: async () => session as typeof x.session }), /checkout_unauthorized/);
  }
  await assert.rejects(readPersonalCheckoutCartResource({ ...x.input, id: "bad/id" }, x.deps)); assert.equal(x.calls(), 0);
});
test("identity, principal, site or gate loss after read cannot disclose a previous result", async () => {
  for (const mode of ["identity", "user", "gate", "scope"] as const) {
    const x = await fixture(); let read = false;
    await assert.rejects(readPersonalCheckoutCartResource(x.input, { ...x.deps, enabled: () => mode !== "gate" || !read,
      session: async () => read && mode === "identity" ? null : read && mode === "user" ? { ...x.session!, userId: "other-synthetic-user" } : x.session,
      call: async (args, signal) => { const response = await x.deps.call(args, signal); read = true; return mode === "scope" ? { data: { kind: "cart", result: { ...x.result, siteId: "10909993" } }, error: null } : response; } }));
    assert.equal(x.calls(), 1);
  }
});
test("missing, failed or inconsistent resource reads are not interchangeable", async () => {
  const x = await fixture(); assert.equal(await readPersonalCheckoutCartResource(x.input, { ...x.deps, call: async () => ({ data: null, error: null }) }), null);
  for (const response of [{ data: null, error: "PRIVATE" }, { data: { kind: "cart", result: { ...x.result, resourceId: "other" } }, error: null }, { data: {}, error: null }]) {
    await assert.rejects(readPersonalCheckoutCartResource(x.input, { ...x.deps, call: async () => response }), /checkout_unavailable/);
  }
});
test("an aborted unresponsive history read settles without returning any late account data", async () => {
  const x = await fixture(), abort = new AbortController(); let started!: () => void;
  const start = new Promise<void>(resolve => { started = resolve; });
  const pending = readPersonalCheckoutCartResource({ ...x.input, request: new Request(x.input.request, { signal: abort.signal }) }, { ...x.deps,
    call: async () => { started(); return new Promise(() => {}); } }); await start; abort.abort(); await assert.rejects(pending, /checkout_unavailable/);
});
