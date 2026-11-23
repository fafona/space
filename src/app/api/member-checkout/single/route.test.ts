import assert from "node:assert/strict";
import test from "node:test";
import { handleSingleIntentCheckout, type SingleIntentHttpDependencies } from "./route-handler";
import { singleIntentFixture } from "../../../../../scripts/fixtures/member-checkout-single-intent";
import { checkoutSubmissionRecoveryIdentity } from "@/lib/merchantCheckoutSubmissionPlan.server";
const origin = "https://single.synthetic.invalid";
async function fixture(method: "points" | "on_site" = "points") {
  const x = await singleIntentFixture(method), calls: string[] = [], session = { accountId: x.accountId, userId: x.userId, servicePaused: false, user: { id: x.userId, email_confirmed_at: "2026-11-24T12:00:00Z" } } as unknown as NonNullable<Awaited<ReturnType<NonNullable<SingleIntentHttpDependencies["session"]>>>>;
  const body = { ...x.selection, method, nonce: x.nonce, confirmationHash: "b".repeat(64), customer: x.customer };
  const request = (action = "submit", raw: unknown = action === "preview" && method === "points" ? x.selection : body, headers: HeadersInit = {}) => new Request(`${origin}/api/member-checkout/single/${method === "points" ? "points" : "on-site"}/${action}`, {
    method: "POST", headers: { origin, "content-type": "application/json", "x-checkout-account-scope": x.accountId, ...headers }, body: JSON.stringify(raw) });
  const deps: SingleIntentHttpDependencies = { enabled: () => true, cashEnabled: () => true, session: async () => { calls.push("session"); return session; },
    pointsSubmit: { submit: async input => { calls.push("submit"); assert.deepEqual(input.request, body); assert.deepEqual(input.principal, { accountId: x.accountId, userId: x.userId }); const current = await input.authorize(); assert.deepEqual(current, input.principal);
      return { replayed: false, result: x.original.kind === "single" && x.original.original.method === "points" ? x.original.original.result : null as never }; } },
    pointsPreview: { preview: async input => { calls.push("preview"); assert.deepEqual(input.request, x.selection); await input.authorize(); return x.pointsPreview as unknown as Awaited<ReturnType<NonNullable<SingleIntentHttpDependencies["pointsPreview"]>["preview"] & object>>; } },
    onSite: { call: async name => { calls.push(name); return { data: { replayed: true, result: x.original.kind === "single" ? { ...x.original.original.result, operationKey: checkoutSubmissionRecoveryIdentity({ siteId: x.siteId, nonce: x.nonce }, { accountId: x.accountId, userId: x.userId }).operationKey } : null }, error: null }; } } };
  return { ...x, calls, session, body, request, deps };
}
test("new single adapter reuses real preview/submit handlers and actual repeated account checks; old requests are not rerouted", async () => {
  const x = await fixture(); const preview = await handleSingleIntentCheckout("points", "preview", x.request("preview"), x.deps);
  assert.equal(preview.status, 200); assert.equal((await preview.json()).quote.siteId, x.siteId);
  const written = await handleSingleIntentCheckout("points", "submit", x.request(), x.deps); assert.equal(written.status, 200); assert.equal((await written.json()).result.resourceId, "R-original-synthetic");
  assert.equal(x.calls.filter(c => c === "submit").length, 1); assert.match(written.headers.get("cache-control")!, /no-store/); assert.match(written.headers.get("vary")!, /X-Checkout-Account-Scope/);
});
test("on-site adapter preserves the actual original replay and never marks cash as collected or calls the points path", async () => {
  const x = await fixture("on_site"), response = await handleSingleIntentCheckout("on-site", "submit", x.request(), x.deps);
  assert.equal(response.status, 200); const value = await response.json(); assert.equal(value.result.terms.capturedMinor, 0); assert.equal(value.result.terms.paymentState, "unpaid");
  assert.equal(x.calls.filter(c => c.includes("snapshot")).length, 1); assert.ok(!x.calls.includes("submit")); assert.ok(!x.calls.some(c => c.includes("commit")));
});
test("default closed and cash gate denial make no session or financial requests", async () => {
  for (const method of ["points", "on_site"] as const) { const x = await fixture(method); x.deps.enabled = () => false;
    assert.equal((await handleSingleIntentCheckout(method === "points" ? "points" : "on-site", "submit", x.request(), x.deps)).status, 503); assert.deepEqual(x.calls, []); }
  const cash = await fixture("on_site"); cash.deps.cashEnabled = () => false; assert.equal((await handleSingleIntentCheckout("on-site", "submit", cash.request(), cash.deps)).status, 503); assert.deepEqual(cash.calls, []);
});
test("foreign origin, absent/wrong account, token, unknown route and browser authority cannot reach financial ports", async () => {
  const x = await fixture();
  for (const [method, action, req, status] of [
    ["points", "submit", x.request("submit", x.body, { origin: "https://foreign.invalid" }), 403],
    ["points", "submit", x.request("submit", x.body, { "x-checkout-account-scope": "" }), 401],
    ["points", "submit", x.request("submit", x.body, { "x-checkout-account-scope": "50010106" }), 401],
    ["points", "submit", x.request("submit", x.body, { "x-merchant-access-token": "other" }), 401],
    ["points", "acknowledge", x.request(), 400], ["stripe", "submit", x.request(), 400],
    ["points", "submit", x.request("submit", { ...x.body, paid: true }), 400],
  ] as const) assert.equal((await handleSingleIntentCheckout(method, action, req, x.deps)).status, status);
  assert.ok(!x.calls.includes("submit")); assert.ok(!x.calls.includes("preview"));
});
test("unverified/paused identities and account/user changes before or after dispatch fail closed", async () => {
  for (const mode of ["paused", "unverified", "user", "after"] as const) {
    const x = await fixture(); let count = 0;
    if (mode === "paused") x.session.servicePaused = true;
    if (mode === "unverified") (x.session.user as { email_confirmed_at: string }).email_confirmed_at = "";
    if (mode === "user") x.deps.session = async () => ++count > 1 ? { ...x.session, userId: "different-user" } : x.session;
    if (mode === "after") { x.deps.session = async () => count ? { ...x.session, accountId: "50010106" } : x.session; x.deps.pointsSubmit!.submit = async () => { count++; if (x.original.kind !== "single" || x.original.original.method !== "points") throw Error("synthetic fixture"); return { replayed: false, result: x.original.original.result }; }; }
    const response = await handleSingleIntentCheckout("points", "submit", x.request(), x.deps); assert.ok(response.status >= 400); assert.ok(!JSON.stringify(await response.json()).includes("different-user"));
    if (mode === "paused" || mode === "unverified") assert.ok(!x.calls.includes("submit"));
  }
});
test("closing the intent gate during authorization cannot dispatch the old single submit service", async () => {
  const x = await fixture(); let enabled = true; x.deps.enabled = () => enabled; x.deps.session = async () => { enabled = false; return x.session; };
  const response = await handleSingleIntentCheckout("points", "submit", x.request(), x.deps); assert.equal(response.status, 503); assert.ok(!x.calls.includes("submit"));
});
test("aborted or stalled auth returns bounded unknown status, and late auth cannot dispatch any single submit", async () => {
  const x = await fixture(), abort = new AbortController(); let release!: (value: typeof x.session) => void, began!: () => void; const started = new Promise<void>(r => { began = r; });
  x.deps.session = async () => { began(); return new Promise(resolve => { release = resolve; }); };
  const result = handleSingleIntentCheckout("points", "submit", new Request(x.request(), { signal: abort.signal }), x.deps); await started; abort.abort(); const response = await result;
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "checkout_unconfirmed" }); release(x.session); await new Promise(r => setImmediate(r)); assert.ok(!x.calls.includes("submit"));
});
