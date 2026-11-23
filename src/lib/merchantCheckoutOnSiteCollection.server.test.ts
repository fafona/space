import assert from "node:assert/strict";
import test from "node:test";
import { handleOnSiteCollection, type OnSiteCollectionDependencies } from "./merchantCheckoutOnSiteCollection.server";
import { parseOnSiteCollectionReceipt } from "./merchantCheckoutOnSiteCollection";
import { isMemberCheckoutOnSiteCollectionEnabled } from "./merchantCheckoutOnSitePilot.server";
const siteId = "10909095", operationKey = "a".repeat(64), origin = "https://synthetic.faolla.invalid", at = "2026-11-23T12:00:00Z";
const input = { siteId, operationKey, expectedUpdatedAt: at, expectedDueMinor: 800, received: true };
const receipt = () => ({ version: 1, siteId, operationKey, resourceKind: "order", resourceId: "O123", replayed: false, amountMinor: 800, currency: "eur", recordedAt: at });
function fixture() {
  const writes: unknown[] = [];
  const actor: Extract<Awaited<ReturnType<OnSiteCollectionDependencies["actor"]>>, { type: "owner" }> = { type: "owner", siteId, authUserId: "synthetic-owner", principalKey: "owner:synthetic-owner", authorizationVersion: "owner", displayName: "Synthetic", email: "synthetic@example.invalid", authorizationSource: "database", collaborationPermissions: [], businessPermissions: [] };
  const site = { id: siteId, status: "online", serviceExpiresAt: "2099-01-01T00:00:00Z", permissionConfig: { allowOrderManagement: true } } as unknown as NonNullable<Awaited<ReturnType<OnSiteCollectionDependencies["site"]>>>;
  const deps: OnSiteCollectionDependencies = { enabled: () => true, actor: async () => actor, site: async () => site, call: async (args, signal) => {
    assert.ok(signal instanceof AbortSignal); writes.push(args); return { data: { ...receipt(), actorKey: "SECRET", membershipId: "SECRET" }, error: null };
  } };
  const request = (value: unknown = input, headers: HeadersInit = {}, suffix = "") => new Request(origin + "/api/merchant-checkout/on-site/collect" + suffix, { method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: typeof value === "string" ? value : JSON.stringify(value) });
  return { deps, writes, actor, site, request };
}
test("receipt recording is independently default-off; points/cash pilot alone never enables it", () => {
  const env = { MERCHANT_MEMBER_CHECKOUT_PILOT_SITES: siteId, MERCHANT_MEMBER_CHECKOUT_ON_SITE_PILOT_SITES: siteId };
  assert.equal(isMemberCheckoutOnSiteCollectionEnabled(siteId, env), false);
  for (const raw of ["", "*", `${siteId},`, "bad", "10909096"]) assert.equal(isMemberCheckoutOnSiteCollectionEnabled(siteId, { ...env, MERCHANT_MEMBER_CHECKOUT_ON_SITE_COLLECTION_PILOT_SITES: raw }), false);
  assert.equal(isMemberCheckoutOnSiteCollectionEnabled(siteId, { ...env, MERCHANT_MEMBER_CHECKOUT_ON_SITE_COLLECTION_PILOT_SITES: siteId }), true);
  assert.equal(isMemberCheckoutOnSiteCollectionEnabled(siteId, { MERCHANT_MEMBER_CHECKOUT_ON_SITE_COLLECTION_PILOT_SITES: siteId }), false);
});
test("disabled and invalid recording requests have no authorization or database IO", async () => {
  const f = fixture(); let authCalls = 0; f.deps.actor = async () => { authCalls++; throw new Error("unexpected auth"); }; f.deps.enabled = () => false;
  assert.equal((await handleOnSiteCollection(f.request(), f.deps)).status, 503);
  f.deps.enabled = () => true;
  for (const req of [new Request(origin), f.request(input, { origin: "https://foreign.invalid" }), f.request(input, {}, "?paid=true"), f.request({ ...input, actorKey: "owner:fake" }), f.request({ ...input, received: false }),
    f.request({ ...input, expectedDueMinor: 0 }), f.request({ ...input, expectedDueMinor: 0.5 }), f.request({ ...input, expectedUpdatedAt: "bad" }), f.request(" ".repeat(4097)), f.request("{"),
    new Request(origin, { method: "POST", headers: { origin, "content-type": "application/json" }, body: new Uint8Array([255]) })]) assert.ok((await handleOnSiteCollection(req, f.deps)).status >= 400);
  assert.equal(f.writes.length, 0); assert.equal(authCalls, 0);
});
test("employee, foreign/revoked owner, stale scope and inactive service cannot record a receipt", async () => {
  for (const mode of ["employee", "foreign", "revoked", "scope", "paused", "permissions", "gate"]) {
    const f = fixture(); let auth = 0;
    if (mode === "employee") f.deps.actor = async () => ({ type: "employee", siteId, authUserId: "synthetic-employee", employeeId: "synthetic-employee", roleId: "synthetic-role", employeeVersion: 1, roleVersion: 1,
      principalKey: "employee:synthetic-employee", authorizationVersion: "synthetic-role-v1", displayName: "Synthetic", email: "synthetic@example.invalid", collaborationPermissions: [], businessPermissions: [] });
    if (mode === "foreign") f.actor.siteId = "10909096";
    if (mode === "revoked") f.deps.actor = async () => ++auth > 1 ? { ...f.actor, principalKey: "owner:revoked-owner" } : f.actor;
    if (mode === "paused") f.site.status = "offline";
    if (mode === "permissions") { let reads = 0; f.deps.site = async () => ++reads > 1 ? { ...f.site, permissionConfig: { ...f.site.permissionConfig!, allowOrderManagement: false } } : f.site; }
    if (mode === "gate") { let n = 0; f.deps.enabled = () => ++n < 2; }
    const response = await handleOnSiteCollection(f.request(input, mode === "scope" ? { "x-checkout-owner-scope": "stale" } : {}), f.deps);
    assert.ok(response.status >= 400, mode); assert.equal(f.writes.length, 0, mode);
  }
});
test("one explicit receipt uses the trusted owner, bounded deadline and safe amount-bound projection", async () => {
  const f = fixture(), response = await handleOnSiteCollection(f.request(), f.deps);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, receipt: receipt() }); assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.equal(f.writes.length, 1); const args = f.writes[0] as Record<string, unknown>;
  assert.equal(args.p_actor_key, "owner:synthetic-owner"); assert.equal(args.p_expected_due_minor, 800); assert.equal(args.p_operation_key, operationKey);
  assert.ok(Date.parse(String(args.p_not_after)) > Date.now() && Date.parse(String(args.p_not_after)) <= Date.now() + 12_000);
  for (const patch of [{ amountMinor: 799 }, { amountMinor: 0 }, { currency: "usd" }, { siteId: "10909096" }, { replayed: null }]) assert.throws(() => parseOnSiteCollectionReceipt({ ...receipt(), ...patch }, { siteId, operationKey, amountMinor: 800 }));
});
test("write loss, malformed response or write-time owner/gate change stays unknown without retries", async () => {
  for (const mode of ["lost", "sql", "malformed", "owner", "gate"]) {
    const f = fixture(), call = f.deps.call; let enabled = true; f.deps.enabled = () => enabled;
    f.deps.call = async (args, signal) => { await call(args, signal); if (mode === "lost") throw new Error("SECRET SQL");
      if (mode === "owner") f.actor.principalKey = "owner:changed-owner"; if (mode === "gate") enabled = false;
      return mode === "sql" ? { data: null, error: { message: "SECRET SQL" } } : { data: mode === "malformed" ? {} : receipt(), error: null }; };
    const response = await handleOnSiteCollection(f.request(), f.deps); assert.equal(response.status, 503, mode); assert.deepEqual(await response.json(), { error: "checkout_unconfirmed" }); assert.equal(f.writes.length, 1);
  }
});
test("only recognized whole-transaction rejection is a safe conflict; private SQL is never exposed", async () => {
  const f = fixture(); f.deps.call = async () => ({ data: null, error: { message: "checkout_collection_not_allowed" } });
  const response = await handleOnSiteCollection(f.request(), f.deps); assert.equal(response.status, 409); assert.deepEqual(await response.json(), { error: "checkout_collection_not_allowed" });
});
