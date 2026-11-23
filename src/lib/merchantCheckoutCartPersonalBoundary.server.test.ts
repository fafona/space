import assert from "node:assert/strict";
import test from "node:test";
import { cartReviewFixture } from "../../scripts/fixtures/member-checkout-cart-review";
import { bridgeLegacyCheckoutMutation, type CheckoutLegacyBoundaryDependencies } from "./merchantCheckoutLegacyBoundary.server";
import { handleMerchantOrderPatch } from "../app/api/orders/route-handler";
import type { PersonalAccountSession } from "./personalAccountSession.server";
import { bridgeCartCheckoutPersonalCancellation } from "./merchantCheckoutCartPersonalBoundary.server";
import { checkoutPrincipalKey } from "./merchantCheckoutQuote.server";
import type { CartCheckoutResult } from "./merchantCheckoutCartResult";
import type { CartPersonalBoundaryDependencies } from "./merchantCheckoutCartPersonalBoundary.server";

const origin = "https://personal.synthetic.invalid";
async function fixture(method: "points" | "on_site" = "points") {
  const x = await cartReviewFixture(method), siteId = x.f.siteId, calls: Array<[string, Record<string, unknown>]> = [];
  const user = { email_confirmed_at: "2026-11-23T10:00:00Z" as string | undefined };
  const session = { accountId: x.f.principal.accountId, userId: x.f.principal.userId, servicePaused: false, user } as unknown as PersonalAccountSession;
  let result: CartCheckoutResult = { ...x.result, resource: { ...x.result.resource!, updatedAt: x.prepared.plan.record.updatedAt } }, record = { ...x.prepared.plan.record, editToken: "PRIVATE", futurePrivate: "PRIVATE" };
  let linked = true, refundRequired = false, personalEnabled = true;
  const deps: { enabled(siteId: string): boolean; cartPersonalEnabled(siteId: string): boolean; cashEnabled(siteId: string): boolean;
    session: CartPersonalBoundaryDependencies["session"]; rpc: CheckoutLegacyBoundaryDependencies["rpc"] } = { enabled: () => true, cartPersonalEnabled: () => personalEnabled, cashEnabled: () => true, session: async () => session,
    rpc: (signal?: AbortSignal) => async (name: string, args: Record<string, unknown>) => {
      if (signal) assert.ok(signal instanceof AbortSignal);
      calls.push([name, args]);
      if (name === "faolla_checkout_cart_personal_resource_link_v1") return { data: linked ? { siteId, kind: "order", id: record.id, operationKey: result.operationKey, record, cart: result, refundRequired } : null, error: null };
      if (name === "faolla_checkout_resource_link_v2") return { data: null, error: linked ? { message: "checkout_cancellation_review_required" } : null };
      assert.equal(name, "faolla_member_checkout_cart_cancel_v1");
      result = { ...result, closed: true, cancellationAvailable: false, resource: { ...result.resource!, status: "cancelled" },
        cancellation: { pointsReturned: result.lines.reduce((s, l) => s + (l.returnPoints ? l.points ?? 0 : 0), 0), couponsReturned: result.lines.reduce((s, l) => s + (l.returnCoupons ? l.couponCount : 0), 0), stockReleased: 2, cancelledAt: new Date().toISOString() } };
      record = { ...record, status: "cancelled" }; return { data: { replayed: false, result }, error: null };
    } };
  const request = (extra: Record<string, unknown> = {}) => new Request(origin + "/api/orders", { method: "PATCH", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ scope: "personal", siteId, orderId: record.id, action: "cancel", ...extra }) });
  let legacy = 0;
  const route = (req = request()) => handleMerchantOrderPatch(req, { resolvePersonalSession: async () => session,
    checkoutBridge: input => bridgeLegacyCheckoutMutation(input, deps), cancelPersonalOrder: async () => { legacy++; throw new Error("raw writer forbidden"); } });
  const input = () => ({ request: request(), mode: "personal" as const, siteId, kind: "order" as const, ids: [record.id], action: "cancel" });
  const ports = () => ({ enabled: deps.cartPersonalEnabled, session: deps.session, call: (name: string, args: Record<string, unknown>, signal: AbortSignal) => deps.rpc(signal)(name, args) });
  return { ...x, siteId, session, user, calls, deps, request, route, input, ports, legacy: () => legacy, result: () => result, record: () => record,
    replace: (value: CartCheckoutResult) => { result = value; }, missing: () => { linked = false; }, paid: () => { refundRequired = true; }, disable: () => { personalEnabled = false; } };
}
const writes = (x: Awaited<ReturnType<typeof fixture>>) => x.calls.filter(([name]) => name === "faolla_member_checkout_cart_cancel_v1");
test("personal legacy PATCH cancels a whole original through its own ledger, not the single lookup or raw order writer", async () => {
  for (const method of ["points", "on_site"] as const) {
    const x = await fixture(method), response = await x.route();
    assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.order.status, "cancelled");
    assert.equal(x.legacy(), 0); assert.equal(writes(x).length, 1);
    assert.ok(!/PRIVATE|operationKey|couponClaims|pointTransactionId|membershipId/.test(JSON.stringify(body)));
    const command = writes(x)[0][1]; assert.equal(command.p_principal_key, checkoutPrincipalKey(x.session)); assert.equal(Object.hasOwn(command, "p_actor_key"), false);
    assert.equal(command.p_expected_updated_at, x.prepared.plan.record.updatedAt);
    assert.ok(Date.parse(command.p_not_after as string) > Date.now() && Date.parse(command.p_not_after as string) <= Date.now() + 11_000);
    assert.equal((await x.route()).status, 200); assert.equal(writes(x).length, 1, "closed original is read-only replay");
    assert.ok(!x.calls.some(([name]) => name.includes("merchant_cancel") || name === "faolla_checkout_resource_link_v2"));
  }
});
test("default-off/ineligible paths do not resolve identity or SQL; explicitly unlinked originals retain legacy fallback", async () => {
  const x = await fixture(), input = x.input(), denied = { ...x.ports(), session: async () => { throw new Error("unexpected auth"); } };
  assert.equal(await bridgeCartCheckoutPersonalCancellation(input, { ...denied, enabled: () => false }), null);
  for (const i of [{ ...input, mode: "merchant" as const }, { ...input, kind: "booking" as const }, { ...input, ids: ["old/id"] }]) assert.equal(await bridgeCartCheckoutPersonalCancellation(i, denied), null);
  assert.equal(x.calls.length, 0); x.missing(); assert.equal(await bridgeLegacyCheckoutMutation(input, x.deps), null); assert.equal(writes(x).length, 0);
});
test("business header, cross-origin, stale account hint and foreign raw account mapping cannot write or fall back", async () => {
  for (const mode of ["business", "origin", "hint", "account", "user", "site", "resource"] as const) {
    const x = await fixture(), input = x.input(), original = x.deps.rpc;
    if (["business", "origin", "hint"].includes(mode)) {
      const headers = new Headers({ origin, "content-type": "application/json" });
      if (mode === "business") headers.set("x-merchant-access-token", "synthetic");
      if (mode === "origin") headers.set("origin", "https://foreign.invalid");
      if (mode === "hint") headers.set("x-checkout-account-scope", "99999999");
      input.request = new Request(origin + "/api/orders", { method: "PATCH", headers });
    } else x.deps.rpc = signal => async (name, args) => {
      const response = await original(signal)(name, args);
      const data = response.data as Record<string, unknown> | null;
      if (name.includes("resource_link") && data) return { ...response, data: { ...data,
        ...(mode === "site" ? { siteId: "10909995" } : {}), ...(mode === "resource" ? { id: "foreign" } : {}),
        record: { ...data.record as Record<string, unknown>, ...(mode === "account" ? { customerAccountId: "99999999" } : mode === "user" ? { customerUserId: "foreign-user" } : {}) } } };
      return response;
    };
    await assert.rejects(bridgeLegacyCheckoutMutation(input, x.deps)); assert.equal(writes(x).length, 0); assert.equal(x.legacy(), 0);
  }
});
test("unverified/paused identities and changed personal session never cancel a linked cart", async () => {
  for (const mode of ["unverified", "paused", "changed", "lost"] as const) {
    const x = await fixture();
    if (mode === "unverified") x.user.email_confirmed_at = undefined;
    if (mode === "paused") x.session.servicePaused = true;
    if (mode === "changed" || mode === "lost") { let calls = 0; x.deps.session = async () => ++calls === 1 ? x.session : mode === "changed" ? { ...x.session, accountId: "99999999" } : null; }
    const response = await x.route(); assert.ok(response.status >= 400); assert.equal(writes(x).length, 0); assert.equal(x.legacy(), 0);
  }
});
test("stale UI version, completed/reviewed/collected originals and unsupported changes cannot enter unpaid cancellation", async () => {
  for (const mode of ["stale", "completed", "review", "paid", "collection", "items", "restore", "batch"] as const) {
    const x = await fixture("on_site"), input = { ...x.input(), expectedUpdatedAt: x.result().resource!.updatedAt };
    if (mode === "stale") input.expectedUpdatedAt = "2020-01-01T00:00:00Z";
    if (mode === "completed") x.replace({ ...x.result(), cancellationAvailable: false });
    if (mode === "review") x.replace({ ...x.result(), cancellationAvailable: false, reviewRequired: true });
    if (mode === "paid") x.paid();
    if (mode === "collection") x.replace({ ...x.result(), cancellationAvailable: false, collection: { amountMinor: x.result().dueMinor!, currency: "eur", recordedAt: new Date().toISOString() } });
    const changed = { ...input, ...(mode === "items" ? { items: [] } : {}), ...(mode === "restore" ? { action: "restore" } : {}), ...(mode === "batch" ? { ids: [...input.ids, "other"] } : {}) };
    await assert.rejects(bridgeLegacyCheckoutMutation(changed, x.deps)); assert.equal(writes(x).length, 0);
  }
});
test("paid-original rejection reaches the old personal HTTP client as a private explicit refund requirement", async () => {
  const x = await fixture("on_site"); x.paid(); const response = await x.route(), body = await response.json();
  assert.equal(response.status, 409); assert.equal(body.error, "checkout_cancellation_requires_refund"); assert.match(body.message, /退款/);
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(x.legacy(), 0); assert.equal(writes(x).length, 0);
});
test("only the cancellation RPC's own explicit atomic rejection is known; later safe-looking failure is unknown", async () => {
  for (const mode of ["atomic", "read", "lost", "record", "terms", "receipt"] as const) {
    const x = await fixture(), original = x.deps.rpc; let wrote = false;
    x.deps.rpc = signal => async (name, args) => {
      if (name === "faolla_member_checkout_cart_cancel_v1" && mode === "atomic") { x.calls.push([name, args]); return { data: null, error: { message: "checkout_refund_required" } }; }
      const response = await original(signal)(name, args);
      if (name === "faolla_member_checkout_cart_cancel_v1") {
        wrote = true; if (mode === "lost") throw new Error("PRIVATE SQL transport error");
        if (mode === "terms") return { data: { replayed: false, result: { ...x.result(), lines: [...x.result().lines].reverse() } }, error: null };
        if (mode === "receipt") return { data: {}, error: null };
      } else if (wrote) {
        if (mode === "read") return { data: null, error: { message: "checkout_conflict" } };
        if (mode === "record" && response.data) { const data = response.data as Record<string, unknown>;
          return { ...response, data: { ...data, record: { ...data.record as Record<string, unknown>, customerUserId: "other" } } }; }
      }
      return response;
    };
    const response = await x.route(), body = await response.json(); assert.equal(response.status, mode === "atomic" ? 409 : 503);
    assert.equal(body.error, mode === "atomic" ? "checkout_cancellation_requires_refund" : "checkout_unconfirmed");
    assert.equal(writes(x).length, 1); assert.equal(x.legacy(), 0); assert.ok(!JSON.stringify(body).includes("PRIVATE"));
  }
});
test("lost cancellation response can be explicitly reread without a second financial command", async () => {
  const x = await fixture(), original = x.deps.rpc;
  x.deps.rpc = signal => async (name, args) => { const response = await original(signal)(name, args); if (name === "faolla_member_checkout_cart_cancel_v1") throw new Error("lost"); return response; };
  assert.equal((await x.route()).status, 503); assert.equal((await x.route()).status, 200); assert.equal(writes(x).length, 1); assert.equal(x.legacy(), 0);
});
test("gate/session loss after dispatch remains unknown and never falls back or retries", async () => {
  for (const mode of ["gate", "session"] as const) {
    const x = await fixture(), original = x.deps.rpc;
    x.deps.rpc = signal => async (name, args) => { const response = await original(signal)(name, args); if (name === "faolla_member_checkout_cart_cancel_v1") {
      if (mode === "gate") x.disable(); else x.session.servicePaused = true;
    } return response; };
    const response = await x.route(); assert.equal(response.status, 503); assert.equal((await response.json()).error, "checkout_unconfirmed"); assert.equal(writes(x).length, 1); assert.equal(x.legacy(), 0);
  }
});
test("initial slow/aborted authorization cannot dispatch a late read or financial command", async () => {
  const x = await fixture(), controller = new AbortController();
  let release!: (s: PersonalAccountSession) => void;
  const pending = new Promise<PersonalAccountSession>(resolve => { release = resolve; });
  const input = { ...x.input(), request: new Request(origin + "/api/orders", { method: "PATCH", headers: { origin }, signal: controller.signal }) };
  const result = bridgeCartCheckoutPersonalCancellation(input, { ...x.ports(), session: () => pending });
  await new Promise(resolve => setTimeout(resolve, 0)); controller.abort();
  await assert.rejects(result, /checkout_unavailable/); release(x.session); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(x.calls.length, 0);
});
test("slow authentication consumes the original budget and cannot renew the trusted SQL deadline", async () => {
  const realNow = Date.now;
  try {
    const x = await fixture(); let clock = realNow(); const start = clock; Date.now = () => clock;
    const session = x.deps.session; x.deps.session = async req => { clock += 2_000; return session(req); };
    assert.equal((await x.route()).status, 200); assert.equal(writes(x).length, 1);
    assert.equal(Date.parse(writes(x)[0][1].p_not_after as string), start + 11_000);
    const y = await fixture(); y.deps.session = async () => { clock += 13_000; return y.session; };
    assert.equal((await y.route()).status, 503); assert.equal(y.calls.length, 0); assert.equal(y.legacy(), 0);
  } finally { Date.now = realNow; }
});
