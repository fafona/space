import assert from "node:assert/strict";
import test from "node:test";
import { cartReviewFixture } from "../../scripts/fixtures/member-checkout-cart-review";
import { handleCartCollection, type CartCollectionDependencies } from "./merchantCheckoutCartCollection.server";
import { isMemberCheckoutCartCollectionEnabled } from "./merchantCheckoutCartPilot.server";
import { parseCartCheckoutResult } from "./merchantCheckoutCartResult";
import { checkoutReportingTsv, parseCheckoutReportingSnapshot } from "./merchantCheckoutReporting";
const origin = "https://cart-receipt.synthetic.invalid";
async function fixture() {
  const x = await cartReviewFixture("on_site"), siteId = x.f.siteId, calls: string[] = [], writes: Record<string, unknown>[] = [];
  let original = x.result;
  const actor: Extract<Awaited<ReturnType<CartCollectionDependencies["actor"]>>, { type: "owner" }> = { type: "owner", siteId, authUserId: "synthetic-owner", principalKey: "owner:synthetic-owner", authorizationVersion: "owner", displayName: "Synthetic", email: "owner@synthetic.invalid", authorizationSource: "database", collaborationPermissions: [], businessPermissions: [] };
  const input = { siteId, operationKey: original.operationKey, expectedUpdatedAt: original.resource!.updatedAt, expectedDueMinor: original.dueMinor!, received: true };
  const receipt = () => ({ version: 1, siteId, operationKey: original.operationKey, resourceKind: "order", resourceId: original.resourceId, replayed: false, amountMinor: original.dueMinor!, currency: "eur", recordedAt: "2026-11-23T12:00:00Z" });
  const close = () => { original = { ...original, cancellationAvailable: false, collection: { amountMinor: original.dueMinor!, currency: "eur", recordedAt: receipt().recordedAt } }; };
  const deps: CartCollectionDependencies = { enabled: () => true, actor: async () => actor, site: async () => x.f.site, call: async (name, args, signal) => {
    calls.push(name); assert.ok(signal instanceof AbortSignal);
    if (name.endsWith("read_v1")) return { data: structuredClone(original), error: null };
    assert.equal(name, "faolla_checkout_cart_collect_v1"); writes.push(args); close(); return { data: { ...receipt(), actorKey: "PRIVATE" }, error: null };
  } };
  const request = (value: unknown = input, extra: HeadersInit = {}, suffix = "") => new Request(origin + "/api/merchant-checkout/cart/collect" + suffix, { method: "POST", headers: { origin, "content-type": "application/json", ...extra }, body: typeof value === "string" ? value : JSON.stringify(value) });
  return { ...x, siteId, actor, input, deps, calls, writes, request, receipt, close, result: () => original, setResult: (r: typeof original) => { original = r; } };
}
test("cart receipt has its own default-closed exact allowlist, independent of single receipt collection", () => {
  const s = "10909994", env = { MERCHANT_MEMBER_CHECKOUT_PILOT_SITES: s, MERCHANT_MEMBER_CHECKOUT_CART_PILOT_SITES: s, MERCHANT_MEMBER_CHECKOUT_ON_SITE_PILOT_SITES: s, MERCHANT_MEMBER_CHECKOUT_CART_MANAGEMENT_PILOT_SITES: s };
  assert.equal(isMemberCheckoutCartCollectionEnabled(s, env), false);
  assert.equal(isMemberCheckoutCartCollectionEnabled(s, { ...env, MERCHANT_MEMBER_CHECKOUT_CART_COLLECTION_PILOT_SITES: s }), true);
  for (const raw of ["", "*", s + ",", "bad", "10909993", Array(51).fill(s).join(",")]) assert.equal(isMemberCheckoutCartCollectionEnabled(s, { ...env, MERCHANT_MEMBER_CHECKOUT_CART_COLLECTION_PILOT_SITES: raw }), false);
  assert.equal(isMemberCheckoutCartCollectionEnabled(s, { MERCHANT_MEMBER_CHECKOUT_CART_COLLECTION_PILOT_SITES: s, MERCHANT_MEMBER_CHECKOUT_ON_SITE_COLLECTION_PILOT_SITES: s }), false);
});
test("strict original body, method/origin/content/query and disabled gate deny before authorization/IO", async () => {
  const f = await fixture(); let auth = 0; f.deps.actor = async () => { auth++; return f.actor; };
  for (const req of [new Request(origin), f.request(f.input, { origin: "https://foreign.invalid" }), f.request(f.input, {}, "?paid=1"), f.request(f.input, { "content-type": "text/plain" }), f.request({ ...f.input, amountMinor: 10 }),
    f.request({ ...f.input, received: false }), f.request({ ...f.input, expectedDueMinor: 0 }), f.request({ ...f.input, expectedDueMinor: 1.2 }), f.request({ ...f.input, expectedUpdatedAt: "bad" }), f.request("{"), f.request(" ".repeat(4097))]) assert.ok((await handleCartCollection(req, f.deps)).status >= 400);
  f.deps.enabled = () => false; assert.equal((await handleCartCollection(f.request(), f.deps)).status, 503); assert.equal(auth, 0); assert.deepEqual(f.calls, []);
});
test("actual owner reauthorization surrounds exactly one cart-only receipt write and a frozen post-read", async () => {
  const f = await fixture(), r = await handleCartCollection(f.request(), f.deps); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true, receipt: f.receipt() });
  assert.match(r.headers.get("cache-control")!, /no-store/); assert.equal(f.writes.length, 1); assert.equal(f.writes[0].p_actor_key, f.actor.principalKey);
  assert.equal(f.writes[0].p_expected_due_minor, f.input.expectedDueMinor); assert.ok(Date.parse(String(f.writes[0].p_not_after)) > Date.now() && Date.parse(String(f.writes[0].p_not_after)) <= Date.now() + 11_000);
  assert.deepEqual(f.calls, ["faolla_checkout_cart_collection_read_v1", "faolla_checkout_cart_collect_v1", "faolla_checkout_cart_collection_read_v1"]);
  const replay = await handleCartCollection(f.request(), f.deps); assert.equal((await replay.json()).receipt.replayed, true); assert.equal(f.writes.length, 1);
});
test("employee, foreign/revoked owner, inactive service, stale owner scope and service generation changes cannot write", async () => {
  for (const mode of ["employee", "foreign", "revoked", "inactive", "scope", "service", "module"] as const) {
    const f = await fixture(); let count = 0;
    if (mode === "employee") f.deps.actor = async () => ({ ...f.actor, type: "employee", principalKey: "employee:synthetic-employee", employeeId: "synthetic-employee", roleId: "synthetic-role", roleVersion: 1, employeeVersion: 1, authorizationVersion: "v1", businessPermissions: [], collaborationPermissions: [] });
    if (mode === "foreign") f.actor.siteId = "10909993";
    if (mode === "revoked") f.deps.actor = async () => ++count > 1 ? { ...f.actor, authUserId: "other" } : f.actor;
    if (mode === "inactive") f.deps.site = async () => ({ ...f.f.site, status: "offline" });
    if (mode === "module") f.deps.site = async () => ({ ...f.f.site, permissionConfig: { ...f.f.site.permissionConfig!, allowOrderManagement: false } });
    if (mode === "service") f.deps.site = async () => ++count > 1 ? { ...f.f.site, serviceExpiresAt: "2098-01-01T00:00:00Z" } : f.f.site;
    assert.ok((await handleCartCollection(f.request(f.input, mode === "scope" ? { "x-checkout-owner-scope": "old" } : {}), f.deps)).status >= 400, mode); assert.equal(f.writes.length, 0);
  }
});
test("stale amount/version, review or closed original and point-only originals cannot record venue cash", async () => {
  for (const mode of ["amount", "version", "review", "closed", "points"] as const) {
    const f = await fixture(), body = { ...f.input };
    if (mode === "amount") body.expectedDueMinor++;
    if (mode === "version") body.expectedUpdatedAt = "2000-01-01T00:00:00Z";
    if (mode === "review") f.setResult({ ...f.result(), reviewRequired: true, cancellationAvailable: false });
    if (mode === "closed") f.setResult({ ...f.result(), closed: true, cancellationAvailable: false, resource: { ...f.result().resource!, status: "cancelled" }, cancellation: { pointsReturned: 0, couponsReturned: 0, stockReleased: 2, cancelledAt: new Date().toISOString() } });
    if (mode === "points") f.setResult((await cartReviewFixture()).result);
    assert.ok((await handleCartCollection(f.request(body), f.deps)).status >= 400); assert.equal(f.writes.length, 0);
  }
});
test("lost receipt, safe-looking post-read errors, wrong resource/amount and frozen terms changes stay unknown without retry", async () => {
  for (const mode of ["lost", "read", "resource", "amount", "terms"] as const) {
    const f = await fixture(), call = f.deps.call; let wrote = false;
    f.deps.call = async (...args) => {
      if (wrote && mode === "read") return { data: null, error: { message: "checkout_conflict" } };
      const response = await call(...args);
      if (args[0].includes("collect_v1")) { wrote = true;
        if (mode === "lost") throw new Error("PRIVATE");
        if (mode === "resource") return { data: { ...f.receipt(), resourceId: "wrong" }, error: null };
        if (mode === "amount") return { data: { ...f.receipt(), amountMinor: 1 }, error: null };
        if (mode === "terms") f.setResult({ ...f.result(), lines: [...f.result().lines].reverse() });
      } return response;
    };
    const r = await handleCartCollection(f.request(), f.deps); assert.equal(r.status, 503, mode); assert.deepEqual(await r.json(), { error: "checkout_unconfirmed" }); assert.equal(f.writes.length, 1);
  }
});
test("owner or gate changing after write never returns a known success", async () => {
  for (const mode of ["owner", "gate", "module"] as const) {
    const f = await fixture(), call = f.deps.call; let enabled = true; f.deps.enabled = () => enabled;
    f.deps.call = async (...args) => { const r = await call(...args); if (args[0].includes("collect_v1")) { if (mode === "owner") f.actor.principalKey = "owner:other-owner"; else if (mode === "module") f.f.site.permissionConfig!.allowOrderManagement = false; else enabled = false; } return r; };
    const r = await handleCartCollection(f.request(), f.deps); assert.equal(r.status, 503); assert.deepEqual(await r.json(), { error: "checkout_unconfirmed" }); assert.equal(f.writes.length, 1);
  }
});
test("only financial RPC known atomic rejection is a safe conflict; SQL details remain hidden", async () => {
  for (const error of ["checkout_conflict", "checkout_collection_not_allowed", "checkout_disabled", "PRIVATE"] as const) {
    const f = await fixture(), call = f.deps.call; let writes = 0;
    f.deps.call = async (...args) => args[0].includes("collect_v1") ? (writes++, { data: null, error: { message: error } }) : call(...args);
    const r = await handleCartCollection(f.request(), f.deps); assert.equal(r.status, error === "PRIVATE" || error === "checkout_disabled" ? 503 : 409); assert.equal((await r.json()).error, error === "PRIVATE" ? "checkout_unconfirmed" : error); assert.equal(writes, 1);
  }
});
test("the original overall deadline and request abort stop late authorization before any SQL", async context => {
  const f = await fixture(); let now = Date.now(); context.mock.method(Date, "now", () => now);
  f.deps.actor = async () => { now += 13_000; return f.actor; }; assert.equal((await handleCartCollection(f.request(), f.deps)).status, 503); assert.deepEqual(f.calls, []);
  const abort = new AbortController(); let resolve!: (actor: typeof f.actor) => void, started!: () => void;
  const began = new Promise<void>(r => { started = r; }), actor = new Promise<typeof f.actor>(r => { resolve = r; }); f.deps.actor = async () => { started(); return actor; };
  const pending = handleCartCollection(new Request(f.request(), { signal: abort.signal }), f.deps); await began; abort.abort(); assert.equal((await pending).status, 503); resolve(f.actor); await new Promise(r => setImmediate(r)); assert.deepEqual(f.calls, []);
});
test("safe result/report parser and TSV expose recorded receipt without private attribution or invented Stripe capture", async () => {
  const f = await fixture(); f.close(); const raw = { ...f.result(), collection: { ...f.result().collection!, actorKey: "PRIVATE" } };
  const parsed = parseCartCheckoutResult(raw, raw); assert.equal(parsed.capturedMinor, 0); assert.equal(parsed.collection?.amountMinor, 2500); assert.ok(!JSON.stringify(parsed).includes("PRIVATE"));
  for (const collection of [null, { ...raw.collection, amountMinor: 2499 }, { ...raw.collection, currency: "usd" }, { ...raw.collection, recordedAt: "bad" }]) assert.throws(() => parseCartCheckoutResult({ ...raw, collection }, raw));
  assert.throws(() => parseCartCheckoutResult({ ...raw, cancellationAvailable: true }, raw));
  const scope = { siteId: f.siteId, resources: [{ kind: "order" as const, id: raw.resourceId }] }, snapshot = parseCheckoutReportingSnapshot({ version: 3, siteId: f.siteId, rows: [{ ...scope.resources[0], result: null, termsMatch: true, cart: raw }] }, scope);
  const rows = checkoutReportingTsv(snapshot).split("\r\n").map(r => r.split("\t")); assert.equal(rows[1][rows[0].indexOf("merchant_recorded_cash_minor")], "2500");
  snapshot.rows[0].cart!.reviewRequired = true; assert.equal(checkoutReportingTsv(snapshot).split("\r\n")[1].split("\t")[rows[0].indexOf("merchant_recorded_cash_minor")], "");
});
