import assert from "node:assert/strict";
import test from "node:test";
import { handleCheckoutEntry, type CheckoutEntryHttpDependencies } from "./route-handler";
const origin = "https://launch.faolla.com", query = { siteId: "10909095", kind: "booking" as const, blockId: "b1", viewport: "desktop" as const };
const request = (body: unknown = query, headers: HeadersInit = {}, suffix = "") => new Request(origin + "/api/member-checkout/entry" + suffix, { method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
function fixture() {
  const calls: string[] = [], session = { accountId: "50010105", userId: "synthetic-user", servicePaused: false, user: { email_confirmed_at: "2026-11-23T00:00:00Z" } } as unknown as Awaited<ReturnType<CheckoutEntryHttpDependencies["session"]>>;
  const offers = [{ offerId: "11111111-1111-4111-8111-111111111111", offerRevision: "22222222-2222-4222-8222-222222222222", title: "Synthetic", maxQuantity: 1, source: { kind: "booking" as const, store: "Store", item: "Play" }, private: "PRIVATE" }];
  const deps: CheckoutEntryHttpDependencies = { enabled: () => true, session: async () => { calls.push("session"); return session; }, read: async received => { calls.push("read"); assert.deepEqual(received, query); return offers; } };
  return { session: session!, offers, calls, deps };
}
test("entry is private read-only discovery, double-checks the real account and allowlists its reply", async () => {
  const f = fixture(), response = await handleCheckoutEntry(request(), f.deps), value = await response.json();
  assert.equal(response.status, 200); assert.equal(value.entry.accountId, f.session.accountId); assert.deepEqual(value.entry.query, query);
  assert.ok(!JSON.stringify(value).includes("PRIVATE")); assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.deepEqual(f.calls, ["session", "read", "session"]);
});
test("default-off entry performs no auth/source IO; guest/unverified/paused accounts do not read configuration", async () => {
  const off = fixture(); off.deps.enabled = () => false; assert.deepEqual(await (await handleCheckoutEntry(request(), off.deps)).json(), { ok: true, entry: null }); assert.deepEqual(off.calls, []);
  for (const mode of ["guest", "unverified", "paused"] as const) {
    const f = fixture();
    if (mode === "guest") f.deps.session = async () => null;
    if (mode === "unverified") (f.session.user as { email_confirmed_at?: string }).email_confirmed_at = undefined;
    if (mode === "paused") f.session.servicePaused = true;
    assert.deepEqual(await (await handleCheckoutEntry(request(), f.deps)).json(), { ok: true, entry: null }); assert.equal(f.calls.includes("read"), false);
  }
});
test("duplicate/wrong/oversized/authority-bearing/cross-origin requests cannot dispatch a read", async () => {
  for (const body of [{ ...query, price: 1 }, { ...query, memberId: "someone" }, { ...query, viewport: ["desktop"] }, { ...query, blockId: "x".repeat(3000) }]) {
    const f = fixture(); assert.equal((await handleCheckoutEntry(request(body), f.deps)).status, 400); assert.deepEqual(f.calls, []);
  }
  for (const [headers, suffix, expected] of [[{ origin: "https://foreign.invalid" }, "", 403], [{ "x-merchant-access-token": "other" }, "", 401], [{}, "?siteId=10909095", 400]] as const) {
    const f = fixture(); assert.equal((await handleCheckoutEntry(request(query, headers, suffix), f.deps)).status, expected); assert.deepEqual(f.calls, []);
  }
});
test("late identity/verification/gate changes and private exceptions cannot expose old account entries", async () => {
  for (const mode of ["account", "verify", "gate", "private", "malformed"] as const) {
    const f = fixture(); let count = 0;
    if (mode === "account") f.deps.session = async () => ++count > 1 ? { ...f.session, accountId: "50010106" } : f.session;
    if (mode === "verify") f.deps.session = async () => ++count > 1 ? null : f.session;
    if (mode === "gate") { let enabled = true; f.deps.enabled = () => enabled; f.deps.read = async () => { enabled = false; return f.offers; }; }
    if (mode === "private") f.deps.read = async () => { throw new Error("PRIVATE DATABASE"); };
    if (mode === "malformed") f.deps.read = async () => [{ ...f.offers[0], maxQuantity: 0 }];
    const response = await handleCheckoutEntry(request(), f.deps); assert.equal(response.status, mode === "private" || mode === "malformed" ? 503 : 401); assert.ok(!JSON.stringify(await response.json()).includes("PRIVATE"));
  }
});
