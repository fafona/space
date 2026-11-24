import assert from "node:assert/strict";
import test from "node:test";
import { cartReviewFixture } from "../../scripts/fixtures/member-checkout-cart-review";
import { bridgeCartCheckoutManagement, type CartManagementDependencies } from "./merchantCheckoutCartManagement.server";
import { bridgeLegacyCheckoutMutation, legacyCheckoutPointTransitions, preserveCheckoutOrderStorage, saveCheckoutAwareMerchantOrders, type CheckoutLegacyBoundaryInput } from "./merchantCheckoutLegacyBoundary.server";
import { isMemberCheckoutCartManagementEnabled } from "./merchantCheckoutCartPilot.server";
import { normalizeMerchantOrderRecords } from "./merchantOrders";
import { handleMerchantOrderPatch } from "../app/api/orders/route-handler";
import type { MerchantBusinessActor } from "./merchantBusinessActor.server";

const origin = "https://merchant.synthetic.invalid";
async function fixture(method: "points" | "on_site" = "points") {
  const x = await cartReviewFixture(method), siteId = x.f.siteId, calls: Array<[string, Record<string, unknown>]> = [];
  const actor: Extract<MerchantBusinessActor, { type: "owner" }> = { type: "owner", siteId, authUserId: "synthetic-owner", principalKey: "owner:synthetic-owner", authorizationVersion: "owner",
    displayName: "Synthetic owner", email: "owner@synthetic.invalid", authorizationSource: "database", businessPermissions: [], collaborationPermissions: [] };
  let result = { ...x.result, resource: { ...x.result.resource!, updatedAt: x.prepared.plan.record.updatedAt } }, record = { ...x.prepared.plan.record, futurePrivate: { preserved: true }, editToken: "PRIVATE" }, linked = true;
  const closed = () => { result = { ...result, closed: true, cancellationAvailable: false, resource: { ...result.resource!, status: "cancelled" },
    cancellation: { pointsReturned: result.totalPoints ?? 0, couponsReturned: 0, stockReleased: 2, cancelledAt: new Date().toISOString() } };
    record = { ...record, status: "cancelled" }; };
  const deps: CartManagementDependencies = { enabled: () => true, actor: async () => actor, site: async () => x.f.site,
    call: async (name, args, signal) => { assert.ok(signal instanceof AbortSignal); calls.push([name, args]);
      if (name === "faolla_checkout_cart_resource_link_v1") return { data: linked ? { siteId, kind: "order", id: record.id, operationKey: result.operationKey, record, cart: result, refundRequired: false } : null, error: null };
      if (name === "faolla_member_checkout_reporting_v3") return { data: { version: 3, siteId, rows: (args.p_resources as Array<{ id: string; kind: string }>).map(r => r.id === record.id ? { ...r, result: null, cart: result, termsMatch: !result.reviewRequired } : { ...r, result: null, termsMatch: false }) }, error: null };
      assert.equal(name, "faolla_checkout_cart_merchant_cancel_v1"); closed(); return { data: { replayed: false, result }, error: null };
    } };
  const request = (body: unknown = { siteId, orderId: record.id, action: "cancel" }) => new Request(origin + "/api/orders", { method: "PATCH", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  const input: CheckoutLegacyBoundaryInput = { request: request(), mode: "merchant", siteId, kind: "order", ids: [record.id], action: "cancel", actor, assertAuthorizationCurrent: async () => {} };
  const oldDeps = { enabled: () => true, cartEnabled: () => true, cartSite: deps.site, actor: deps.actor, rpc: (signal?: AbortSignal) => (name: string, args: Record<string, unknown>) => deps.call(name, args, signal ?? new AbortController().signal) };
  return { ...x, siteId, actor, deps, input, calls, closed, request, oldDeps, result: () => result, record: () => record,
    replaceResult: (value: typeof result) => { result = value; }, missing: () => { linked = false; } };
}
const writes = (x: Awaited<ReturnType<typeof fixture>>) => x.calls.filter(([name]) => name === "faolla_checkout_cart_merchant_cancel_v1");

for (const method of ["points", "on_site"] as const) test(`${method}: a cancelled cart in a later batch page never reaches an operational writer`, async () => {
  const x = await fixture(method); x.closed();
  for (const cartEnabled of [false, true]) for (const patch of [{ action: undefined, status: "pending" }, { action: undefined, status: "confirmed" }, { action: undefined, status: "completed" }, { action: "confirm" }, { action: "complete" }]) {
    x.calls.length = 0;
    const input = { ...x.input, ...patch, ids: [...Array.from({ length: 50 }, (_, i) => `ordinary-${i}`), x.record().id], batch: true };
    await assert.rejects(bridgeLegacyCheckoutMutation(input, { ...x.oldDeps, cartEnabled: () => cartEnabled }), /checkout_original_cancellation_required/);
    assert.equal(writes(x).length, 0); assert.equal(x.calls.length, 2);
  }
});

test("actual merchant order PATCH rejects a mixed closed-original batch before touching any ordinary order", async () => {
  for (const cartEnabled of [false, true]) {
    const x = await fixture(); x.closed(); let legacy = 0;
    const response = await handleMerchantOrderPatch(x.request({ siteId: x.siteId, orderIds: ["ordinary", x.record().id], status: "completed" }), {
      resolveAdminSession: async () => ({ merchantId: x.siteId, actor: x.actor, assertAuthorizationCurrent: async () => {} }), isManagementEnabled: async () => true,
      checkoutBridge: input => bridgeLegacyCheckoutMutation(input, { ...x.oldDeps, cartEnabled: () => cartEnabled }),
      updateOrdersBatch: async () => { legacy++; throw Error("must not start a partial batch"); },
    });
    assert.equal(response.status, 409); assert.equal((await response.json()).error, "checkout_original_cancellation_required");
    assert.equal(legacy, 0); assert.equal(writes(x).length, 0);
  }
});
test("management has a separate exact default-closed allowlist and never enables cash collection", () => {
  const site = "10909994", env = { MERCHANT_MEMBER_CHECKOUT_PILOT_SITES: site, MERCHANT_MEMBER_CHECKOUT_CART_PILOT_SITES: site };
  assert.equal(isMemberCheckoutCartManagementEnabled(site, env), false);
  assert.equal(isMemberCheckoutCartManagementEnabled(site, { ...env, MERCHANT_MEMBER_CHECKOUT_CART_MANAGEMENT_PILOT_SITES: site }), true);
  for (const value of ["*", "", site + ",", "other", new Array(51).fill(site).join(",")]) assert.equal(isMemberCheckoutCartManagementEnabled(site, { ...env, MERCHANT_MEMBER_CHECKOUT_CART_MANAGEMENT_PILOT_SITES: value }), false);
  assert.equal(isMemberCheckoutCartManagementEnabled(site, { MERCHANT_MEMBER_CHECKOUT_CART_MANAGEMENT_PILOT_SITES: site }), false);
});
test("closed gate/personal/booking and ineligible old IDs do not resolve an actor or reach SQL", async () => {
  const x = await fixture(), none = { linked: false, value: null }, deps = { ...x.deps, enabled: () => false, actor: async () => { throw new Error("must not authenticate"); } };
  assert.deepEqual(await bridgeCartCheckoutManagement(x.input, deps), none);
  for (const input of [{ ...x.input, mode: "personal" as const }, { ...x.input, kind: "booking" as const }, { ...x.input, ids: ["old/id"] }]) assert.deepEqual(await bridgeCartCheckoutManagement(input, { ...deps, enabled: () => true }), none);
  assert.equal(x.calls.length, 0);
});
test("points and cash carts use one owner-audited whole-original cancellation and return only the normalized business record", async () => {
  for (const method of ["points", "on_site"] as const) {
    const x = await fixture(method), value = await bridgeLegacyCheckoutMutation(x.input, x.oldDeps);
    assert.equal(value?.record.status, "cancelled"); assert.equal(writes(x).length, 1);
    const args = writes(x)[0][1]; assert.equal(args.p_actor_key, x.actor.principalKey); assert.equal(Object.hasOwn(args, "p_principal_key"), false);
    assert.ok(Date.parse(args.p_not_after as string) > Date.now() && Date.parse(args.p_not_after as string) <= Date.now() + 11_000);
    assert.ok(!/PRIVATE|futurePrivate|editToken|couponClaims|membershipId|operationKey/.test(JSON.stringify(value)));
    await bridgeLegacyCheckoutMutation(x.input, x.oldDeps); assert.equal(writes(x).length, 1, "closed original is read-only replay");
  }
});
test("old merchant PATCH cancellation returns this cancelled original without calling the legacy raw writer", async () => {
  const x = await fixture(); let legacy = 0;
  const response = await handleMerchantOrderPatch(x.request(), { resolveAdminSession: async () => ({ merchantId: x.siteId, actor: x.actor, assertAuthorizationCurrent: async () => {} }),
    isManagementEnabled: async () => true, checkoutBridge: input => bridgeLegacyCheckoutMutation(input, x.oldDeps), updateOrder: async () => { legacy++; throw new Error("must not update twice"); } });
  assert.equal(response.status, 200); assert.equal((await response.json()).order.status, "cancelled"); assert.equal(legacy, 0); assert.equal(writes(x).length, 1);
});
test("employees cannot cancel financially, while authenticated operational completion remains a nonfinancial legacy transition", async () => {
  const x = await fixture(), employee: MerchantBusinessActor = { ...x.actor, type: "employee", principalKey: "employee:synthetic-employee", authorizationVersion: "employee-v1", employeeId: "employee", roleId: "role", roleVersion: 1, employeeVersion: 1, businessPermissions: [], collaborationPermissions: [] };
  const deps = { ...x.deps, actor: async () => employee };
  await assert.rejects(bridgeCartCheckoutManagement({ ...x.input, actor: employee }, deps), /checkout_owner_required/); assert.equal(writes(x).length, 0);
  assert.deepEqual(await bridgeCartCheckoutManagement({ ...x.input, actor: employee, action: "complete" }, deps), { linked: true, value: null });
  assert.equal(x.result().capturedMinor, 0); assert.equal(x.record().status, "pending");
});
test("foreign/stale/revoked actors, inactive service, origin and changed authorization cannot dispatch finance", async () => {
  for (const mode of ["foreign", "stale", "revoked", "service", "origin"] as const) {
    const x = await fixture(), input = { ...x.input }, deps = { ...x.deps };
    if (mode === "foreign") deps.actor = async () => ({ ...x.actor, siteId: "10909995" });
    if (mode === "stale") deps.actor = async () => ({ ...x.actor, authUserId: "different-owner" });
    if (mode === "revoked") input.assertAuthorizationCurrent = async () => { throw new Error("revoked"); };
    if (mode === "service") deps.site = async () => ({ ...x.f.site, status: "offline" });
    if (mode === "origin") input.request = new Request(origin + "/api/orders", { method: "PATCH", headers: { origin: "https://foreign.invalid" } });
    await assert.rejects(bridgeCartCheckoutManagement(input, deps)); assert.equal(writes(x).length, 0);
  }
});
test("changing immutable cart terms or resource mapping in a write/post-read response is unconfirmed, never raw fallback", async () => {
  for (const mode of ["resource", "terms", "post-read"] as const) {
    const x = await fixture(), originalCall = x.deps.call; let wrote = false;
    x.deps.call = async (name, args, signal) => { const response = await originalCall(name, args, signal);
      if (name.includes("merchant_cancel")) { wrote = true; if (mode === "resource") return { data: { replayed: false, result: { ...x.result(), resourceId: "other" } }, error: null };
        if (mode === "terms") return { data: { replayed: false, result: { ...x.result(), lines: [...x.result().lines].reverse() } }, error: null }; }
      if (wrote && mode === "post-read" && name.includes("resource_link")) return { data: null, error: null }; return response; };
    await assert.rejects(bridgeLegacyCheckoutMutation(x.input, x.oldDeps), /checkout_unconfirmed/); assert.equal(writes(x).length, 1);
  }
});
test("lost response stays unknown; explicit reread recovers without a second cancellation", async () => {
  const x = await fixture(), call = x.deps.call; let lose = true;
  x.deps.call = async (name, args, signal) => { const response = await call(name, args, signal); if (name.includes("merchant_cancel") && lose) { lose = false; throw new Error("PRIVATE SQL lost"); } return response; };
  await assert.rejects(bridgeLegacyCheckoutMutation(x.input, x.oldDeps), /checkout_unconfirmed/); assert.equal(writes(x).length, 1);
  assert.equal((await bridgeLegacyCheckoutMutation(x.input, x.oldDeps))?.record.status, "cancelled"); assert.equal(writes(x).length, 1);
});
test("a safe-looking SQL rejection from the post-write read is unknown, not proof of financial rollback", async () => {
  for (const code of ["checkout_conflict", "checkout_not_found", "checkout_cancellation_not_allowed"] as const) {
    const x = await fixture(), call = x.deps.call; let wrote = false;
    x.deps.call = async (...args: Parameters<typeof call>) => {
      if (wrote && args[0].includes("resource_link")) return { data: null, error: { message: code } };
      const response = await call(...args); if (args[0].includes("merchant_cancel")) wrote = true; return response;
    };
    await assert.rejects(bridgeLegacyCheckoutMutation(x.input, x.oldDeps), /checkout_unconfirmed/); assert.equal(writes(x).length, 1);
    x.deps.call = call;
    assert.equal((await bridgeLegacyCheckoutMutation(x.input, x.oldDeps))?.record.status, "cancelled"); assert.equal(writes(x).length, 1);
  }
});
test("role/service/gate change after dispatch hides the outcome without retrying", async () => {
  for (const mode of ["role", "service", "gate"] as const) {
    const x = await fixture(), call = x.deps.call; let dispatched = false;
    const deps = { ...x.deps, enabled: () => !(dispatched && mode === "gate"), actor: async () => ({ ...x.actor, ...(dispatched && mode === "role" ? { authUserId: "other" } : {}) }),
      site: async () => ({ ...x.f.site, ...(dispatched && mode === "service" ? { permissionConfig: { ...x.f.site.permissionConfig!, allowOrderManagement: false } } : {}) }),
      call: async (...args: Parameters<typeof call>) => { const response = await call(...args); if (args[0].includes("merchant_cancel")) dispatched = true; return response; } };
    await assert.rejects(bridgeCartCheckoutManagement(x.input, deps), /checkout_unconfirmed/); assert.equal(writes(x).length, 1);
  }
});
test("stale expected version, changed items/updates, restore, refund-required and completed originals do not write", async () => {
  const x = await fixture();
  for (const patch of [{ expectedUpdatedAt: "2000-01-01T00:00:00Z" }, { items: [] }, { updates: {} }]) await assert.rejects(bridgeCartCheckoutManagement({ ...x.input, ...patch }, x.deps));
  x.replaceResult({ ...x.result(), cancellationAvailable: false, resource: { ...x.result().resource!, status: "completed" } });
  // Keep the canonical resource check strict: a disagreeing record is not an
  // alternative permission to cancel a completed result.
  await assert.rejects(bridgeCartCheckoutManagement(x.input, x.deps)); assert.equal(writes(x).length, 0);
  x.closed(); await assert.rejects(bridgeCartCheckoutManagement({ ...x.input, action: "restore" }, x.deps), /checkout_original_cancellation_required/);
});
test("SQL conflict/refund rejection stays atomic while unknown SQL remains redacted and never retried", async () => {
  for (const code of ["checkout_conflict", "checkout_refund_required", "PRIVATE SQL ERROR"] as const) {
    const x = await fixture(), read = x.deps.call; let count = 0;
    const deps = { ...x.deps, call: async (...args: Parameters<typeof read>) => { if (args[0].includes("merchant_cancel")) { count++; return { data: null, error: { message: code } }; } return read(...args); } };
    await assert.rejects(bridgeCartCheckoutManagement(x.input, deps), code === "PRIVATE SQL ERROR" ? /checkout_unconfirmed/ : code === "checkout_refund_required" ? /checkout_cancellation_requires_refund/ : /checkout_conflict/); assert.equal(count, 1);
  }
});
test("authoritative receipt/refund boundary prevents cancellation before dispatch", async () => {
  const x = await fixture("on_site"), call = x.deps.call;
  const deps = { ...x.deps, call: async (...args: Parameters<typeof call>) => {
    const response = await call(...args);
    return args[0].includes("resource_link") ? { data: { ...(response.data as Record<string, unknown>), refundRequired: true }, error: null } : response;
  } };
  await assert.rejects(bridgeCartCheckoutManagement(x.input, deps), /checkout_cancellation_requires_refund/); assert.equal(writes(x).length, 0);
});
test("mixed linked batch cancel is refused as a whole; completion omits loyalty awards and preserves raw cart and unknown fields", async () => {
  const x = await fixture();
  await assert.rejects(bridgeLegacyCheckoutMutation({ ...x.input, ids: [x.record().id, "old-order"], batch: true }, x.oldDeps), /checkout_batch_requires_single/);
  assert.equal(writes(x).length, 0);
  const previous = normalizeMerchantOrderRecords([x.record()])[0], next = { ...previous, status: "completed" as const };
  assert.deepEqual(await legacyCheckoutPointTransitions([{ previous, next }], x.oldDeps), []);
  const source = [{ id: "synthetic-page-id", updated_at: new Date().toISOString(), slug: `__merchant_orders__:${x.siteId}:chunk:0`, blocks: [x.record()] }];
  const preserved = await preserveCheckoutOrderStorage(x.siteId, [next], source, x.oldDeps);
  assert.deepEqual(preserved[0].items, x.record().items); assert.equal(preserved[0].status, "completed"); assert.deepEqual((preserved[0] as unknown as Record<string, unknown>).futurePrivate, { preserved: true });
  const altered = structuredClone(next); altered.items[0].quantity++;
  await assert.rejects(preserveCheckoutOrderStorage(x.siteId, [altered], source, x.oldDeps), /checkout_change_requires_review/);
  const sent: unknown[] = [], client = { from: () => { throw new Error("no direct page writes"); }, rpc: async (name: string, args: Record<string, unknown>) => { assert.equal(name, "faolla_commit_order_membership_v1"); sent.push(args); return { data: { updatedAt: new Date().toISOString() }, error: null }; } };
  assert.equal((await saveCheckoutAwareMerchantOrders(client, { siteId: x.siteId, orders: [next], expectedRows: source }, x.oldDeps)).error, null); assert.equal(sent.length, 1); assert.equal(writes(x).length, 0);
});
test("unavailable v3 reporting never retries an older report or awards legacy completion points", async () => {
  const x = await fixture(), previous = normalizeMerchantOrderRecords([x.record()])[0], next = { ...previous, status: "completed" as const }; let calls = 0;
  await assert.rejects(legacyCheckoutPointTransitions([{ previous, next }], { ...x.oldDeps, rpc: () => async name => { calls++; assert.equal(name, "faolla_member_checkout_reporting_v3"); return { data: null, error: { message: "PRIVATE" } }; } }), /checkout_unavailable/); assert.equal(calls, 1);
});
test("slow or aborted initial authorization cannot dispatch a late financial command", async context => {
  const x = await fixture(); let now = Date.now(); context.mock.method(Date, "now", () => now);
  await assert.rejects(bridgeCartCheckoutManagement(x.input, { ...x.deps, actor: async () => { now += 13_000; return x.actor; } }), /checkout_unavailable/); assert.equal(x.calls.length, 0);
  const abort = new AbortController(); let resolve!: (actor: typeof x.actor) => void, start!: () => void;
  const began = new Promise<void>(r => { start = r; }), actor = new Promise<typeof x.actor>(r => { resolve = r; });
  const pending = bridgeCartCheckoutManagement({ ...x.input, request: new Request(x.input.request, { signal: abort.signal }) }, { ...x.deps, actor: async () => { start(); return actor; } });
  await began; abort.abort(); await assert.rejects(pending, /checkout_unavailable/); resolve(x.actor); await new Promise(r => setImmediate(r)); assert.equal(x.calls.length, 0);
});
