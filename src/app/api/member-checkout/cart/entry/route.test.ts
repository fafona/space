import assert from "node:assert/strict";
import test from "node:test";
import { handleCartCheckoutEntry } from "./route-handler";
import type { CheckoutEntryHttpDependencies } from "../../entry/route-handler";
const origin = "https://launch.faolla.com", query = { siteId: "10909994", kind: "order", blockId: "products", viewport: "mobile" };
const req = (body: unknown = query, headers: HeadersInit = {}) => new Request(origin + "/api/member-checkout/cart/entry", { method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
function fixture() {
  const calls: string[] = [], session = { accountId: "50010105", userId: "synthetic-user", servicePaused: false, user: { email_confirmed_at: "2026-11-23T00:00:00Z" } } as unknown as NonNullable<Awaited<ReturnType<CheckoutEntryHttpDependencies["session"]>>>;
  const deps: CheckoutEntryHttpDependencies = { enabled: () => true, recoveryEnabled: () => false, session: async () => { calls.push("session"); return session; }, read: async () => { calls.push("read"); return []; } };
  return { calls, session, deps };
}
test("empty bindings preserve verified own account discovery so an old original can still be recovered", async () => {
  const x = fixture(), response = await handleCartCheckoutEntry(req(), x.deps), value = await response.json();
  assert.equal(response.status, 200); assert.deepEqual(value, { ok: true, entry: { siteId: query.siteId, accountId: x.session.accountId, offers: [], query } });
  assert.deepEqual(x.calls, ["session", "read", "session"]); assert.match(response.headers.get("cache-control")!, /no-store/);
});
test("closed UI gate and failed reads cannot masquerade as a guest eligible for legacy checkout", async () => {
  for (const mode of ["off", "read", "changed"] as const) {
    const x = fixture(); if (mode === "off") x.deps.enabled = () => false;
    if (mode === "read") x.deps.read = async () => { throw new Error("PRIVATE"); };
    if (mode === "changed") { let count = 0; x.deps.session = async () => ++count > 1 ? { ...x.session, accountId: "50010106" } : x.session; }
    const response = await handleCartCheckoutEntry(req(), x.deps); assert.equal(response.status, mode === "changed" ? 401 : 503);
    const value = await response.json(); assert.ok(value.error); assert.equal(Object.hasOwn(value, "entry"), false); assert.ok(!JSON.stringify(value).includes("PRIVATE"));
    if (mode === "off") assert.deepEqual(x.calls, []);
  }
});
test("guest/unverified/paused cannot read offers; malformed or foreign requests cannot read sessions", async () => {
  for (const mode of ["guest", "unverified", "paused"] as const) {
    const x = fixture(); x.deps.session = async () => mode === "guest" ? null : { ...x.session, servicePaused: mode === "paused", user: { ...x.session.user, email_confirmed_at: undefined } } as typeof x.session;
    assert.deepEqual(await (await handleCartCheckoutEntry(req(), x.deps)).json(), { ok: true, entry: null }); assert.deepEqual(x.calls, []);
  }
  for (const [request, status] of [[req({ ...query, price: 1 }), 400], [req(query, { origin: "https://foreign.invalid" }), 403], [req(query, { "x-merchant-access-token": "other" }), 401]] as const) {
    const x = fixture(); assert.equal((await handleCartCheckoutEntry(request, x.deps)).status, status); assert.deepEqual(x.calls, []);
  }
});
test("aborted discovery cannot reveal a late private account response", async () => {
  const x = fixture(), controller = new AbortController(); let release!: (value: typeof x.session) => void;
  x.deps.session = async () => new Promise(resolve => { release = resolve; });
  const request = new Request(req(), { signal: controller.signal }), run = handleCartCheckoutEntry(request, x.deps);
  while (!release) await new Promise(resolve => setImmediate(resolve)); controller.abort();
  const response = await run; assert.equal(response.status, 503); release(x.session); assert.deepEqual(x.calls, []);
});

test("public recovery navigation cannot grant cart intent/draft authority or turn failed private discovery into a guest", async () => {
  const visitor = fixture(); visitor.deps.session = async () => null;
  const gates = { recoveryEnabled: () => true, intentEnabled: () => true, draftEnabled: () => true };
  const guest = await handleCartCheckoutEntry(req(), { ...visitor.deps, ...gates });
  assert.deepEqual(await guest.json(), { ok: true, entry: null, recovery: { siteId: query.siteId } }); assert.deepEqual(visitor.calls, []);
  const verified = fixture(), own = await handleCartCheckoutEntry(req(), { ...verified.deps, ...gates });
  assert.deepEqual(await own.json(), { ok: true, entry: { siteId: query.siteId, accountId: verified.session.accountId, offers: [], query, recoveryEnabled: true }, recovery: { siteId: query.siteId }, intent: true, ownedDraft: true });
  assert.deepEqual(verified.calls, ["session", "read", "session"]);
  verified.deps.read = async () => { throw new Error("PRIVATE"); };
  const failed = await handleCartCheckoutEntry(req(), { ...verified.deps, ...gates }); assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: "checkout_entry_unavailable" });
});

test("legacy record-review capability is independently closed and available only with verified account intent/draft access", async () => {
  const gates = { intentEnabled: () => true, draftEnabled: () => true, legacyReviewEnabled: () => true };
  const x = fixture(), r = await handleCartCheckoutEntry(req(), { ...x.deps, ...gates }); assert.equal((await r.json()).legacyReview, true);
  for (const patch of [{ legacyReviewEnabled: () => false }, { draftEnabled: () => false }, { draftEnabled: () => false, intentEnabled: () => false }, { session: async () => null }]) {
    const response = await handleCartCheckoutEntry(req(), { ...x.deps, ...gates, ...patch }); assert.equal(response.status, 200); assert.equal(Object.hasOwn(await response.json(), "legacyReview"), false);
  }
  let n = 0; const changed = await handleCartCheckoutEntry(req(), { ...x.deps, ...gates, legacyReviewEnabled: () => ++n === 1 }); assert.equal(changed.status, 503); assert.deepEqual(await changed.json(), { error: "checkout_entry_unavailable" });
});

test("explicit legacy handoff is separate from readonly discovery and cannot be granted to guests or incomplete modes", async () => {
  const x = fixture(), gates = { intentEnabled: () => true, draftEnabled: () => true, legacyReviewEnabled: () => true, legacyHandoffEnabled: () => true };
  const r = await handleCartCheckoutEntry(req(), { ...x.deps, ...gates }); assert.equal((await r.json()).legacyHandoff, true);
  for (const patch of [{ legacyHandoffEnabled: () => false }, { legacyReviewEnabled: () => false }, { draftEnabled: () => false }, { draftEnabled: () => false, intentEnabled: () => false }, { session: async () => null }]) {
    const response = await handleCartCheckoutEntry(req(), { ...x.deps, ...gates, ...patch }); assert.equal(response.status, 200); assert.equal(Object.hasOwn(await response.json(), "legacyHandoff"), false);
  }
  let n = 0; assert.equal((await handleCartCheckoutEntry(req(), { ...x.deps, ...gates, legacyHandoffEnabled: () => ++n === 1 })).status, 503);
});
