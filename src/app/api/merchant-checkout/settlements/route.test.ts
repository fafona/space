import assert from "node:assert/strict";
import test from "node:test";
import { handleCheckoutReporting, handleCheckoutReportingAccess, type CheckoutReportingDependencies } from "./route-handler";
import { MerchantBusinessAccessError, type MerchantBusinessActor } from "@/lib/merchantBusinessActor.server";
const origin = "https://launch.faolla.com", siteId = "10909095";
function fixture() {
  const calls: string[] = [], scope = { siteId, resources: [{ kind: "order" as const, id: "O123" }] };
  const actor: MerchantBusinessActor = { type: "owner", siteId, authUserId: "synthetic-owner", principalKey: "owner:synthetic-owner", authorizationVersion: "owner", displayName: "Private", email: "private@example.invalid", authorizationSource: "database", collaborationPermissions: [], businessPermissions: [] };
  const site = { id: siteId, status: "online", serviceExpiresAt: "2099-01-01T00:00:00Z", permissionConfig: { allowOrderManagement: true } } as unknown as NonNullable<Awaited<ReturnType<CheckoutReportingDependencies["site"]>>>;
  const report = { version: 1 as const, siteId, rows: [{ ...scope.resources[0], termsMatch: false, result: null }] };
  const deps: CheckoutReportingDependencies = { enabled: () => true, mixedEnabled: () => false, collectionEnabled: () => false, readMixed: async () => { throw new Error("unexpected mixed read"); }, actor: async () => { calls.push("actor"); return actor; }, site: async () => { calls.push("site"); return site; }, read: async input => { calls.push("read"); assert.deepEqual(input, scope); return report; } };
  const request = (input: unknown = scope, headers: HeadersInit = {}, suffix = "", method = "POST") => new Request(origin + "/api/merchant-checkout/settlements" + suffix,
    { method, headers: { origin, "content-type": "application/json", ...headers }, ...(method === "GET" ? {} : { body: typeof input === "string" ? input : JSON.stringify(input) }) });
  return { calls, scope, actor, site, report, deps, request };
}
test("owner reads bounded records with pre/post auth, no cache or leaked fields", async () => {
  const f = fixture(), response = await handleCheckoutReporting(f.request(), f.deps);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, snapshot: f.report });
  assert.deepEqual(f.calls, ["actor", "site", "actor", "site", "read", "actor", "site"]);
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("referrer-policy"), "no-referrer");
});
test("mixed mode is separately gated, owner-bound and never falls back to a points report", async () => {
  const f = fixture(); let mixed = 0; f.deps.mixedEnabled = () => true;
  f.deps.readMixed = async () => { mixed++; return { ...f.report, version: 2 }; };
  const response = await handleCheckoutReporting(f.request(), f.deps); assert.equal(response.status, 200); assert.equal((await response.json()).snapshot.version, 2); assert.equal(mixed, 1); assert.equal(f.calls.includes("read"), false);
  f.deps.readMixed = async () => { throw new Error("private mixed SQL"); }; assert.equal((await handleCheckoutReporting(f.request(), f.deps)).status, 503); assert.equal(f.calls.includes("read"), false);
  let enabled = true; f.deps.mixedEnabled = () => enabled;
  f.deps.readMixed = async () => { enabled = false; return { ...f.report, version: 2 }; };
  assert.equal((await handleCheckoutReporting(f.request(), f.deps)).status, 503);
});
test("receipt capability is only a separately gated UI hint and disappears if its gate changes during the read", async () => {
  const f = fixture(); let allowed = true; f.deps.mixedEnabled = () => true; f.deps.collectionEnabled = () => allowed; f.deps.readMixed = async () => ({ ...f.report, version: 2 });
  assert.equal((await (await handleCheckoutReporting(f.request(), f.deps)).json()).canRecordOnSiteReceipt, true);
  allowed = false; assert.equal((await (await handleCheckoutReporting(f.request(), f.deps)).json()).canRecordOnSiteReceipt, undefined);
  allowed = true; f.deps.readMixed = async () => { allowed = false; return { ...f.report, version: 2 }; }; assert.equal((await handleCheckoutReporting(f.request(), f.deps)).status, 503);
});
test("disabled, foreign, employee and paused/expired access never query the ledger", async () => {
  for (const mode of ["off", "foreign", "employee", "paused", "expired", "unauthenticated"] as const) {
    const f = fixture();
    if (mode === "off") f.deps.enabled = () => false;
    if (mode === "foreign") f.actor.siteId = "10909096";
    if (mode === "employee") f.deps.actor = async () => ({ ...f.actor, type: "employee" } as unknown as MerchantBusinessActor);
    if (mode === "paused") f.site.status = "offline";
    if (mode === "expired") f.site.serviceExpiresAt = "2000-01-01T00:00:00Z";
    if (mode === "unauthenticated") f.deps.actor = async () => { throw new MerchantBusinessAccessError("unauthorized", 401); };
    assert.ok((await handleCheckoutReporting(f.request(), f.deps)).status >= 400); assert.equal(f.calls.includes("read"), false);
  }
});
test("strict method/origin/query/content/size/body validation is before auth or reads", async () => {
  const f = fixture();
  for (const req of [f.request(f.scope, {}, "", "GET"), f.request(f.scope, { origin: "https://evil.invalid" }), f.request(f.scope, {}, "?siteId=10909096"),
    f.request(f.scope, { "content-type": "application/jsonp" }), f.request("{"), f.request({ ...f.scope, paid: true }),
    f.request({ ...f.scope, resources: [...f.scope.resources, ...f.scope.resources] }), f.request(" ".repeat(16385))]) assert.ok((await handleCheckoutReporting(req, f.deps)).status >= 400);
  assert.deepEqual(f.calls, []);
});
test("account, permissions, pilot and site revocation before or after reading never return data", async () => {
  for (const stage of [2, 3]) for (const mode of ["identity", "site", "permission", "pilot"] as const) {
    const f = fixture(); let actors = 0, sites = 0;
    f.deps.actor = async () => { actors++; return actors >= stage && mode === "identity" ? { ...f.actor, authUserId: "other-owner" } : f.actor; };
    f.deps.site = async () => { sites++; return sites >= stage && mode === "site" ? null : sites >= stage && mode === "permission" ? { ...f.site, permissionConfig: { ...f.site.permissionConfig!, allowOrderManagement: false } } : f.site; };
    f.deps.enabled = () => mode !== "pilot" || actors < stage;
    const response = await handleCheckoutReporting(f.request(), f.deps);
    assert.equal(response.status, 403); assert.deepEqual(await response.json(), { error: "permission_denied" });
    if (stage === 2) assert.equal(f.calls.includes("read"), false);
  }
});
test("unavailable or malformed ledger is not converted into an unlinked/unpaid result", async () => {
  for (const malformed of [false, true]) {
    const f = fixture(); let reads = 0;
    f.deps.read = async () => { reads++; if (!malformed) throw new Error("SQL private-contact@example.invalid"); return { ...f.report, rows: [] }; };
    const response = await handleCheckoutReporting(f.request(), f.deps);
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "checkout_reporting_unavailable" }); assert.equal(reads, 1);
  }
});
test("mutated shared actor/site objects cannot rewrite the original authorization baseline during a read", async () => {
  for (const mode of ["actor", "permission", "during-site"] as const) {
    const f = fixture();
    if (mode === "during-site") f.deps.site = async () => { f.actor.principalKey = "owner:changed-during-site"; return f.site; };
    f.deps.read = async () => {
      if (mode === "actor") f.actor.principalKey = "owner:changed-in-flight";
      if (mode === "permission") f.site.permissionConfig!.allowOrderManagement = false;
      return f.report;
    };
    const response = await handleCheckoutReporting(f.request(), f.deps);
    assert.equal(response.status, 403); assert.deepEqual(await response.json(), { error: "permission_denied" });
  }
});

test("async manager discovery is private, owner-bound and never reads the financial ledger", async () => {
  const f = fixture(), request = () => f.request(undefined, {}, `?siteId=${siteId}`, "GET");
  const response = await handleCheckoutReportingAccess(request(), f.deps), payload = await response.json();
  assert.equal(response.status, 200); assert.equal(payload.access.siteId, siteId); assert.match(payload.access.identityKey, /^[a-f0-9]{64}$/);
  assert.equal(f.calls.includes("read"), false); assert.ok(!/synthetic-owner|Private|private@example/.test(JSON.stringify(payload)));
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  f.calls.length = 0;
  assert.equal((await handleCheckoutReporting(f.request(f.scope, { "x-checkout-owner-scope": payload.access.identityKey }), f.deps)).status, 200);
  f.calls.length = 0; f.actor.authUserId = "different-owner";
  assert.equal((await handleCheckoutReporting(f.request(f.scope, { "x-checkout-owner-scope": payload.access.identityKey }), f.deps)).status, 403);
  assert.equal(f.calls.includes("read"), false);
});

test("disabled discovery has no auth/storage IO; malformed, cross-origin, staff and revoked discovery cannot mount finance", async () => {
  const off = fixture(); off.deps.enabled = () => false;
  assert.deepEqual(await (await handleCheckoutReportingAccess(off.request(undefined, {}, `?siteId=${siteId}`, "GET"), off.deps)).json(), { ok: true, access: null });
  assert.deepEqual(off.calls, []);
  for (const suffix of ["", `?siteId=${siteId}&siteId=${siteId}`, `?siteId=${siteId}&owner=1`, "?siteId=invalid"]) {
    const f = fixture(); assert.equal((await handleCheckoutReportingAccess(f.request(undefined, {}, suffix, "GET"), f.deps)).status, 400); assert.deepEqual(f.calls, []);
  }
  for (const mode of ["foreign-origin", "employee", "revoked", "mutated-expiry"]) {
    const f = fixture(); let count = 0;
    if (mode === "employee") f.deps.actor = async () => ({ ...f.actor, type: "employee" } as unknown as MerchantBusinessActor);
    if (mode === "revoked") f.deps.actor = async () => ++count > 1 ? { ...f.actor, authUserId: "different" } : f.actor;
    if (mode === "mutated-expiry") f.deps.site = async () => { if (++count > 1) f.site.serviceExpiresAt = "2098-01-01T00:00:00Z"; return f.site; };
    const response = await handleCheckoutReportingAccess(f.request(undefined, mode === "foreign-origin" ? { origin: "https://foreign.invalid" } : {}, `?siteId=${siteId}`, "GET"), f.deps);
    assert.equal(response.status, 403); assert.equal(f.calls.includes("read"), false);
  }
});
