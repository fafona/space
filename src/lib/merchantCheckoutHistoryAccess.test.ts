import assert from "node:assert/strict";
import test from "node:test";
import { cartReviewFixture } from "../../scripts/fixtures/member-checkout-cart-review";
import { handleCheckoutReporting, handleCheckoutReportingAccess, type CheckoutReportingDependencies } from "../app/api/merchant-checkout/settlements/route-handler";
import { handlePersonalCheckoutResource } from "../app/api/member-checkout/resource/route-handler";
import type { MerchantBusinessActor } from "./merchantBusinessActor.server";
import { isMemberCheckoutHistoryReadEnabled } from "./merchantCheckoutHistoryPilot.server";
import { readPersonalCheckoutHistoryResource } from "./merchantCheckoutHistoryRead.server";
import { checkoutResumeFixture } from "../../scripts/fixtures/member-checkout-resume";
import { personalCheckoutEntryHint } from "./merchantCheckoutLegacyBoundary.server";
import { parsePersonalCheckoutEntryHint } from "./merchantCheckoutRecordEntry";
import { isMemberCheckoutPilotEnabled } from "./merchantMemberCheckoutPilot.server";
import { isMemberCheckoutCartPilotEnabled, isMemberCheckoutIntentPilotEnabled, isMemberCheckoutCartCollectionEnabled } from "./merchantCheckoutCartPilot.server";

async function fixture() {
  const x = await cartReviewFixture(), siteId = x.f.siteId, origin = "https://history.synthetic.invalid", identity = { accountId: x.f.principal.accountId, userId: x.f.principal.userId };
  const actor = { type: "owner", siteId, authUserId: "synthetic-owner", principalKey: "owner:synthetic-owner", authorizationVersion: "owner", authorizationSource: "database", businessPermissions: [], collaborationPermissions: [], displayName: "Synthetic", email: "synthetic@example.invalid" } as MerchantBusinessActor;
  const scope = { siteId, resources: [{ kind: "order" as const, id: x.result.resourceId }] };
  const snapshot = { version: 3 as const, siteId, rows: [{ ...scope.resources[0], result: null, cart: x.result, termsMatch: true }] };
  const calls: string[] = [];
  const deps = { enabled: () => false, historyEnabled: () => true, cartEnabled: () => false, mixedEnabled: () => false, collectionEnabled: () => true, cartCollectionEnabled: () => true,
    actor: async () => { calls.push("actor"); return actor; }, site: async () => { calls.push("site"); return x.f.site; },
    read: async () => { throw new Error("incomplete v1 forbidden"); }, readMixed: async () => { throw new Error("incomplete v2 forbidden"); },
    readCart: async () => { calls.push("v3"); return snapshot; },
  } as CheckoutReportingDependencies & { historyEnabled(siteId: string): boolean };
  const request = (method = "POST", headers = {}) => new Request(`${origin}/api/merchant-checkout/settlements${method === "GET" ? `?siteId=${siteId}` : ""}`,
    { method, headers: { origin, "content-type": "application/json", ...headers }, ...(method === "POST" ? { body: JSON.stringify(scope) } : {}) });
  return { ...x, identity, actor, siteId, origin, scope, snapshot, calls, deps, request };
}

test("an independently allowed history reader remains visible and reads complete v3 after purchase gates close, without receipt capability", async () => {
  const f = await fixture(), access = await handleCheckoutReportingAccess(f.request("GET"), f.deps);
  assert.equal(access.status, 200); const payload = await access.json(); assert.equal(payload.access?.siteId, f.siteId);
  f.deps.cartEnabled = () => true; f.deps.mixedEnabled = () => true;
  const response = await handleCheckoutReporting(f.request("POST", { "x-checkout-owner-scope": payload.access.identityKey }), f.deps);
  assert.equal(response.status, 200); const body = await response.json(); assert.deepEqual(body.snapshot, f.snapshot);
  assert.equal(body.canRecordOnSiteReceipt, undefined); assert.equal(body.canRecordCartReceipt, undefined); assert.equal(f.calls.filter(v => v === "v3").length, 1);
});

test("history allowlist is independently default closed, exact and bounded, never a purchase or browser-derived grant", () => {
  const siteId = "10909994";
  assert.equal(isMemberCheckoutHistoryReadEnabled(siteId, {}), false);
  assert.equal(isMemberCheckoutHistoryReadEnabled(siteId, { MERCHANT_MEMBER_CHECKOUT_PILOT_SITES: siteId, MERCHANT_MEMBER_CHECKOUT_CART_PILOT_SITES: siteId }), false);
  for (const value of ["", "*", `${siteId},bad`, ` ${siteId}, `, Array(51).fill(siteId).join(",")]) assert.equal(isMemberCheckoutHistoryReadEnabled(siteId, { MERCHANT_MEMBER_CHECKOUT_HISTORY_READ_SITES: value }), false);
  assert.equal(isMemberCheckoutHistoryReadEnabled(siteId, { MERCHANT_MEMBER_CHECKOUT_HISTORY_READ_SITES: ` ${siteId} ` }), true);
  const readOnly = { MERCHANT_MEMBER_CHECKOUT_HISTORY_READ_SITES: siteId };
  assert.equal(isMemberCheckoutPilotEnabled(siteId, readOnly), false); assert.equal(isMemberCheckoutCartPilotEnabled(siteId, "points", readOnly), false);
  assert.equal(isMemberCheckoutIntentPilotEnabled(siteId, readOnly), false); assert.equal(isMemberCheckoutCartCollectionEnabled(siteId, readOnly), false);
  assert.equal(isMemberCheckoutHistoryReadEnabled("10909993", { MERCHANT_MEMBER_CHECKOUT_HISTORY_READ_SITES: siteId }), false);
});

test("history visibility is only a current verified account hint and stays bounded across two independent server scopes", async () => {
  const f = await fixture(), session = { ...f.identity, servicePaused: false, user: { email_confirmed_at: new Date().toISOString() } };
  const sites = Array.from({ length: 100 }, (_, i) => String(10000000 + i)), records = sites.map(siteId => ({ siteId }));
  const hint = personalCheckoutEntryHint(records, session as never, () => true);
  assert.deepEqual(parsePersonalCheckoutEntryHint(hint, f.identity.accountId), sites);
  assert.deepEqual(parsePersonalCheckoutEntryHint({ ...hint, siteIds: [...sites, "10909999"] }, f.identity.accountId), []);
  assert.equal(personalCheckoutEntryHint([...records, { siteId: "10909999" }], session as never, () => true), undefined);
  assert.equal(personalCheckoutEntryHint(records, { ...session, servicePaused: true } as never, () => true), undefined);
  assert.equal(personalCheckoutEntryHint(records, { ...session, user: {} } as never, () => true), undefined);
});

test("history reads v3 even when only some purchase gates remain open; complete projection never grants cart collection", async () => {
  const f = await fixture(); f.deps.enabled = () => true; f.deps.mixedEnabled = () => true;
  const response = await handleCheckoutReporting(f.request(), f.deps), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.snapshot.version, 3); assert.equal(body.canRecordCartReceipt, undefined);
  assert.equal(body.canRecordOnSiteReceipt, true, "only the existing separately enabled single receipt capability survives");
  assert.deepEqual(f.calls.filter(c => c === "v3"), ["v3"]);
});

test("history owner discovery denies staff, wrong site, paused service and changed identity before exposing any original", async () => {
  for (const mode of ["staff", "foreign", "paused", "revoked", "permission", "expired"] as const) {
    const f = await fixture(); let actors = 0, sites = 0;
    f.deps.actor = async () => { actors++; return mode === "staff" ? { ...f.actor, type: "employee" } as unknown as MerchantBusinessActor
      : mode === "foreign" ? { ...f.actor, siteId: "99999999" } : mode === "revoked" && actors > 1 ? { ...f.actor, authUserId: "other-owner" } : f.actor; };
    f.deps.site = async () => { sites++; return mode === "paused" ? { ...f.f.site, status: "offline" } : mode === "expired" ? { ...f.f.site, serviceExpiresAt: "2000-01-01T00:00:00Z" }
      : mode === "permission" && sites > 1 ? { ...f.f.site, permissionConfig: { ...f.f.site.permissionConfig!, allowOrderManagement: false } } : f.f.site; };
    const response = await handleCheckoutReportingAccess(f.request("GET"), f.deps);
    assert.equal(response.status, 403); assert.equal(f.calls.includes("v3"), false); assert.ok(!JSON.stringify(await response.json()).includes(f.result.resourceId));
  }
});

test("history read rejects revoked gates/owner generation, older projection and private errors without incomplete retries", async () => {
  for (const mode of ["history", "purchase", "owner", "old", "throw"] as const) {
    const f = await fixture(); let allowed = true, purchase = false;
    f.deps.historyEnabled = () => allowed; f.deps.enabled = () => purchase;
    f.deps.readCart = async () => { f.calls.push("v3"); if (mode === "history") allowed = false; if (mode === "purchase") purchase = true;
      if (mode === "owner") f.actor.authUserId = "other-owner"; if (mode === "throw") throw new Error("PRIVATE SQL synthetic@example.invalid");
      return { ...f.snapshot, version: mode === "old" ? 2 : 3 }; };
    const response = await handleCheckoutReporting(f.request(), f.deps); assert.ok(response.status >= 400);
    assert.equal(f.calls.filter(c => c === "v3").length, 1); assert.ok(!/PRIVATE|synthetic@example|operationKey/.test(JSON.stringify(await response.json())));
  }
});

test("aborted or expired history ownership cannot dispatch a late ledger read", async context => {
  const f = await fixture(); let now = Date.now(); context.mock.method(Date, "now", () => now);
  f.deps.actor = async () => { now += 12_001; return f.actor; };
  assert.equal((await handleCheckoutReporting(f.request(), f.deps)).status, 503); assert.equal(f.calls.includes("v3"), false);
  let lookups = 0;
  await assert.rejects(readPersonalCheckoutHistoryResource({ request: f.request("GET"), siteId: f.siteId, kind: "order", id: f.result.resourceId }, {
    enabled: () => true, session: async () => { now += 12_001; return { ...f.identity, servicePaused: false, user: { email_confirmed_at: new Date().toISOString() } } as never; },
    call: async () => { lookups++; throw new Error("no late personal lookup"); },
  }), /checkout_unavailable/); assert.equal(lookups, 0);
  const x = await fixture(), abort = new AbortController(); let begin!: () => void, finish!: (a: typeof x.actor) => void;
  const started = new Promise<void>(r => { begin = r; }), pending = new Promise<typeof x.actor>(r => { finish = r; });
  x.deps.actor = () => { begin(); return pending; };
  const reading = handleCheckoutReporting(new Request(x.request(), { signal: abort.signal }), x.deps);
  await started; abort.abort(); assert.equal((await reading).status, 503); finish(x.actor); await new Promise(r => setImmediate(r)); assert.equal(x.calls.includes("v3"), false);
  const y = await fixture(), eligibilityAbort = new AbortController(); let sites = 0, beginSite!: () => void, finishSite!: (site: typeof y.f.site) => void;
  const siteStarted = new Promise<void>(r => { beginSite = r; }), sitePending = new Promise<typeof y.f.site>(r => { finishSite = r; });
  y.deps.enabled = () => true; y.deps.cartEnabled = () => true; y.deps.mixedEnabled = () => true;
  y.deps.site = async () => { if (++sites === 3) { beginSite(); return sitePending; } return y.f.site; };
  const eligibility = handleCheckoutReporting(new Request(y.request(), { signal: eligibilityAbort.signal }), y.deps);
  await siteStarted; eligibilityAbort.abort(); assert.equal((await eligibility).status, 503); finishSite(y.f.site); await new Promise(r => setImmediate(r));
  assert.equal(y.calls.includes("v3"), false, "receipt eligibility metadata cannot outlive the same read budget");
});

test("personal history reuses exact verified principal lookup for every receipt type and rejects changed identity without writes", async () => {
  for (const kind of ["cart_points", "cart_on_site", "single_points", "single_on_site"] as const) {
    const x = await checkoutResumeFixture(kind), value = x.original.kind === "cart" ? x.original.result : x.original.original.method === "on_site" ? x.original.original.result.terms : x.original.original.result;
    const request = new Request(`https://personal-history.synthetic.invalid/api/member-checkout/resource?siteId=${x.siteId}&kind=${value.resourceKind}&id=${value.resourceId}`,
      { headers: { origin: "https://personal-history.synthetic.invalid", "x-checkout-account-scope": x.accountId } });
    const session = { accountId: x.accountId, userId: x.userId, user: { email_confirmed_at: new Date().toISOString() }, servicePaused: false };
    let calls = 0;
    const ports = { enabled: () => true, session: async () => session as never, call: async (args: Record<string, unknown>) => {
      calls++; assert.deepEqual(args, { p_site_id: x.siteId, p_kind: value.resourceKind, p_id: value.resourceId, p_principal_key: `account:${x.accountId}:${x.userId}` });
      return { data: { ...x.original, PRIVATE: "discarded" }, error: null }; } };
    const read = (input: Parameters<typeof readPersonalCheckoutHistoryResource>[0]) => readPersonalCheckoutHistoryResource(input, ports);
    const response = await handlePersonalCheckoutResource(request, async () => { throw new Error("no old fallback"); }, { historyEnabled: () => true, readHistory: read });
    const body = await response.json(); assert.equal(response.status, 200); assert.equal(body.readOnly, true); assert.equal(calls, 1); assert.ok(!/PRIVATE|principalKey|userId/.test(JSON.stringify(body)));
    let sessions = 0; const changed = (input: Parameters<typeof readPersonalCheckoutHistoryResource>[0]) => readPersonalCheckoutHistoryResource(input,
      { ...ports, session: async () => (++sessions > 1 ? { ...session, userId: "other-synthetic-user" } : session) as never });
    assert.equal((await handlePersonalCheckoutResource(request, undefined, { historyEnabled: () => true, readHistory: changed })).status, 401);
  }
});

test("personal history refuses signed out, unverified, paused, mismatched and revoked scopes before private lookup", async () => {
  for (const mode of ["guest", "unverified", "paused", "account", "disabled"] as const) {
    const f = await fixture(), request = new Request(`${f.origin}/api/member-checkout/resource?siteId=${f.siteId}&kind=order&id=${f.result.resourceId}`,
      { headers: { origin: f.origin, "x-checkout-account-scope": f.identity.accountId } });
    let calls = 0;
    const response = await handlePersonalCheckoutResource(request, undefined, { historyEnabled: () => true,
      readHistory: input => readPersonalCheckoutHistoryResource(input, { enabled: () => mode !== "disabled", session: async () => mode === "guest" ? null
        : { ...f.identity, accountId: mode === "account" ? "59999999" : f.identity.accountId, servicePaused: mode === "paused", user: mode === "unverified" ? {} : { email_confirmed_at: new Date().toISOString() } } as never,
        call: async () => { calls++; throw new Error("must not read"); } }) });
    assert.equal(response.status, mode === "disabled" ? 503 : 401); assert.equal(calls, 0);
  }
});

test("personal history can show an own cart original while purchases are closed, never falling back to incomplete legacy reads", async () => {
  const f = await fixture(); let calls = 0;
  const deps = { enabled: () => false, cartEnabled: () => false, historyEnabled: () => true,
    readHistory: async () => { calls++; return { kind: "cart" as const, result: f.result }; } };
  const response = await handlePersonalCheckoutResource(new Request(`${f.origin}/api/member-checkout/resource?siteId=${f.siteId}&kind=order&id=${f.result.resourceId}`,
    { headers: { origin: f.origin, "x-checkout-account-scope": f.identity.accountId } }), async () => { throw new Error("old disabled lookup forbidden"); }, deps);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, result: null, cart: f.result, readOnly: true }); assert.equal(calls, 1);
});
