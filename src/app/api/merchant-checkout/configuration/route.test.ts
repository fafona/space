import assert from "node:assert/strict";
import test from "node:test";
import { handleCheckoutConfiguration, type CheckoutConfigurationRouteDependencies } from "./route-handler";
import { buildConfiguredCheckoutOffer, type CheckoutConfigurationEdit, type CheckoutConfigurationOptions, type CheckoutConfigurationSnapshot } from "@/lib/merchantCheckoutConfiguration";
import type { MerchantBusinessActor } from "@/lib/merchantBusinessActor.server";

const id = "12345678-1234-4234-8234-123456789abc", revision = "87654321-4321-4321-8321-cba987654321", version = "abcdefab-abcd-4abc-8abc-abcdefabcdef", origin = "https://launch.faolla.com";
function fixture() {
  const calls: string[] = [], actor: MerchantBusinessActor = { type: "owner", siteId: "10909095", authUserId: "synthetic-owner", principalKey: "owner:synthetic-owner", authorizationVersion: "owner", displayName: "Private", email: "private@example.invalid", authorizationSource: "database", businessPermissions: [], collaborationPermissions: [] };
  const site = { id: "10909095", name: "Synthetic", status: "online", serviceExpiresAt: "2099-01-01T00:00:00Z", permissionConfig: { allowBookingBlock: true, allowMembershipManagement: true, allowPointsRedemption: true, allowCouponModule: true } } as unknown as NonNullable<Awaited<ReturnType<CheckoutConfigurationRouteDependencies["site"]>>>;
  const options: CheckoutConfigurationOptions = { sources: [{ key: "a".repeat(64), sourceVersion: "b".repeat(64), title: "Synthetic play", kind: "booking", viewport: "mobile", blockId: "booking-test", store: "Synthetic", item: "Play", cashMinor: null }], stockItems: [], vouchers: [] };
  const edit: CheckoutConfigurationEdit = { offerId: null, sourceKey: options.sources[0].key, sourceVersion: options.sources[0].sourceVersion,
    title: "Synthetic play", enabled: false, cashMinor: 10000, unitPoints: 500, allowOnSite: true, maxQuantity: 1, timeZone: "Europe/Madrid", stockItemId: null, voucherCouponIds: [], durationMinutes: 60,
    pointsReturnOnCancel: true, couponReturnOnCancel: false, cancellationAdvanceMinutes: 60 };
  let snapshot: CheckoutConfigurationSnapshot = { version: null, offers: [] }, uuidIndex = 0;
  const deps: CheckoutConfigurationRouteDependencies = {
    enabled: () => true, actor: async () => { calls.push("actor"); return actor; }, site: async () => { calls.push("site"); return site; },
    options: async () => { calls.push("options"); return options; }, load: async () => { calls.push("load"); return snapshot; },
    save: async input => { calls.push("save"); assert.equal(input.actorKey, actor.principalKey); assert.equal(input.siteId, site.id); snapshot = { version: input.nextVersion, offers: [input.offer] }; return snapshot; },
    uuid: () => [id, revision, version][uuidIndex++],
  };
  const request = (method = "GET", patch: unknown = {}, headers: HeadersInit = {}) => new Request(`${origin}/api/merchant-checkout/configuration?siteId=10909095`, { method,
    headers: { origin, "content-type": "application/json", ...headers }, ...(method === "GET" ? {} : { body: JSON.stringify({ expectedVersion: null, edit, ...(patch as object) }) }) });
  return { deps, actor, site, edit, options, calls, request, snapshot: () => snapshot };
}
test("owner reads current settings/options without any writes and without customer or credential fields", async () => {
  const f = fixture(), response = await handleCheckoutConfiguration(f.request(), f.deps), json = await response.json();
  assert.equal(response.status, 200); assert.equal(json.snapshot.version, null); assert.equal(json.options.sources.length, 1);
  assert.equal(f.calls.includes("save"), false); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.ok(!/private@example|principalKey|membership|claimEvents|settlementCode/.test(JSON.stringify(json)));
});
test("save is one owner-bound, versioned config command, preserving explicit policies", async () => {
  const f = fixture(), response = await handleCheckoutConfiguration(f.request("PUT"), f.deps), payload = await response.json();
  assert.equal(response.status, 200); assert.equal(payload.snapshot.version, version);
  assert.equal(f.calls.filter(call => call === "save").length, 1); assert.equal(f.calls.filter(call => call === "actor").length, 3);
  assert.equal(payload.snapshot.offers[0].couponReturnOnCancel, false); assert.equal(payload.snapshot.offers[0].checkoutBinding.pointsReturnOnCancel, true);
  assert.equal(payload.snapshot.offers[0].enabled, false);
});
test("cross-origin, disabled pilot, wrong site, staff and revoked owners never save", async () => {
  for (const mode of ["origin", "off", "site", "staff", "revoked"] as const) {
    const f = fixture();
    if (mode === "off") f.deps.enabled = () => false;
    if (mode === "site") f.actor.siteId = "10909096";
    if (mode === "staff") f.deps.actor = async () => ({ ...f.actor, type: "employee" } as unknown as MerchantBusinessActor);
    if (mode === "revoked") { let reads = 0; f.deps.actor = async () => ++reads === 1 ? f.actor : { ...f.actor, principalKey: "owner:other-owner" }; }
    const response = await handleCheckoutConfiguration(f.request("PUT", {}, mode === "origin" ? { origin: "https://evil.invalid" } : {}), f.deps);
    assert.ok(response.status >= 400); assert.equal(f.calls.includes("save"), false);
  }
});
test("stale catalog, source edits, invalid identity/price extras and unavailable modules are refused before commit", async () => {
  for (const mode of ["version", "source", "extra", "module", "policy"] as const) {
    const f = fixture();
    if (mode === "module") f.site.permissionConfig!.allowPointsRedemption = false;
    const edit = { ...f.edit, ...(mode === "source" ? { sourceVersion: "c".repeat(64) } : {}), ...(mode === "extra" ? { membershipId: "foreign" } : {}), ...(mode === "policy" ? { couponReturnOnCancel: "true" } : {}) };
    const response = await handleCheckoutConfiguration(f.request("PUT", { edit, ...(mode === "version" ? { expectedVersion: version } : {}) }), f.deps);
    assert.ok(response.status >= 400); assert.equal(f.calls.includes("save"), false);
  }
});
test("a lost save result is sanitized and never retried or replaced by a legacy settings write", async () => {
  const f = fixture(); let writes = 0;
  f.deps.save = async () => { writes++; throw new Error("SQL private_secret lost connection"); };
  const response = await handleCheckoutConfiguration(f.request("PUT"), f.deps);
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "checkout_configuration_unavailable" }); assert.equal(writes, 1);
});
test("changed service/module permissions during saving prevent dispatch", async () => {
  const f = fixture(); let reads = 0;
  f.deps.site = async () => ++reads === 1 ? f.site : { ...f.site, permissionConfig: { ...f.site.permissionConfig!, allowPointsRedemption: false } };
  const response = await handleCheckoutConfiguration(f.request("PUT"), f.deps);
  assert.equal(response.status, 403); assert.equal(f.calls.includes("save"), false);
});
test("an update retains stable offer identity but produces a new immutable revision", async () => {
  const f = fixture(), offer = buildConfiguredCheckoutOffer({ siteId: f.site.id, edit: f.edit, options: f.options, current: { version: null, offers: [] }, newId: id, newRevision: revision });
  f.deps.load = async () => ({ version, offers: [offer] });
  const response = await handleCheckoutConfiguration(f.request("PUT", { expectedVersion: version, edit: { ...f.edit, offerId: id, title: "New title" } }), f.deps);
  assert.equal(response.status, 200); assert.equal((await response.json()).snapshot.offers[0].id, id);
});
