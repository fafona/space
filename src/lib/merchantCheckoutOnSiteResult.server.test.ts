import assert from "node:assert/strict";
import test from "node:test";
import { parseOnSiteCancellation, parseOnSiteCheckoutResult, readOnSiteCheckoutResult, cancelOnSiteCheckout } from "./merchantCheckoutOnSiteResult.server";
import type { MemberCheckoutResultRpc } from "./merchantMemberCheckoutResult.server";

const scope = { siteId: "10909095", operationKey: "a".repeat(64) }, at = "2026-11-23T12:00:00Z";
const principal = { accountId: "50010105", userId: "synthetic-customer" }, principalKey = `account:${principal.accountId}:${principal.userId}`;
const terms = { version: 2, method: "on_site", resourceKind: "booking", resourceId: "booking-synthetic", currency: "eur", grossMinor: 1000,
  discountMinor: 200, dueMinor: 800, capturedMinor: 0, totalPoints: null, couponCount: 1, paymentState: "unpaid" };
const view = () => ({ version: 2, ...scope, terms: { ...terms }, resource: { status: "active", updatedAt: at }, termsMatch: true,
  closed: false, cancellationAvailable: true, cancellationPolicy: { returnCoupons: true, advanceMinutes: 60, cancellableUntil: "2026-11-26T11:00:00Z" }, collection: null, cancellation: null });
const cancellation = () => ({ version: 2, method: "on_site", ...scope, resourceKind: "booking", resourceId: terms.resourceId, closed: true,
  pointsReturned: 0, cashReturnedMinor: 0, couponsReturned: 1, stockReleased: 1, cancelledAt: at });
test("cash result is allowlisted; business completion does not manufacture cash receipt", () => {
  const original = view(), contaminatedScope = { ...scope, secret: "SECRET" };
  const parsed = parseOnSiteCheckoutResult({ ...original, membershipId: "SECRET", terms: { ...original.terms, couponUses: "SECRET" } }, contaminatedScope);
  assert.deepEqual(parsed, original); assert.ok(!JSON.stringify(parsed).includes("SECRET"));
  const completed = parseOnSiteCheckoutResult({ ...original, cancellationAvailable: false, resource: { status: "completed", updatedAt: at } }, scope);
  assert.equal(completed.collection, null); assert.equal(completed.terms.capturedMinor, 0);
});
test("recorded full cash, coupon-only and cancellation facts stay separate", () => {
  const received = parseOnSiteCheckoutResult({ ...view(), cancellationAvailable: false, collection: { amountMinor: 800, currency: "eur", recordedAt: at } }, scope);
  assert.equal(received.collection?.amountMinor, 800); assert.equal(received.terms.capturedMinor, 0);
  const covered = parseOnSiteCheckoutResult({ ...view(), terms: { ...terms, discountMinor: 1000, dueMinor: 0, paymentState: "coupon_covered" } }, scope);
  assert.equal(covered.collection, null);
  const closed = parseOnSiteCheckoutResult({ ...view(), closed: true, cancellationAvailable: false, resource: { status: "cancelled", updatedAt: at }, cancellation: cancellation() }, scope);
  assert.equal(closed.cancellation?.pointsReturned, 0); assert.equal(closed.cancellation?.cashReturnedMinor, 0);
});
test("cancelled cash is not a points refund or arbitrary cash refund and cannot cross scope", () => {
  assert.deepEqual(parseOnSiteCancellation({ ...cancellation(), privateClaimCode: "SECRET" }, scope), cancellation());
  for (const patch of [{ version: 1 }, { method: "points" }, { siteId: "10909096" }, { operationKey: "b".repeat(64) }, { pointsReturned: 1 }, { cashReturnedMinor: 800 }, { couponsReturned: 2 }, { stockReleased: 1000 }, { cancelledAt: "bad" }])
    assert.throws(() => parseOnSiteCancellation({ ...cancellation(), ...patch }, scope), /checkout_invalid_response/);
});
test("inconsistent result states and duplicate return implications fail closed", () => {
  for (const patch of [{ version: 1 }, { closed: true }, { termsMatch: true, resource: null }, { resource: { status: "completed", updatedAt: at } },
    { collection: { amountMinor: 800, currency: "eur", recordedAt: at } }, { cancellationAvailable: false, collection: { amountMinor: 799, currency: "eur", recordedAt: at } },
    { closed: true, cancellationAvailable: false, cancellation: cancellation(), cancellationPolicy: { ...view().cancellationPolicy, returnCoupons: false } }])
    assert.throws(() => parseOnSiteCheckoutResult({ ...view(), ...patch }, scope));
  assert.throws(() => parseOnSiteCheckoutResult({ ...view(), closed: true, cancellationAvailable: false, cancellation: { ...cancellation(), resourceId: "wrong-original" } }, scope));
});
test("read uses server principal and rejects identity change or missing authorization without IO", async () => {
  let calls = 0;
  const call = async (name: string, args: Record<string, unknown>) => {
    calls++; assert.equal(name, "faolla_member_checkout_on_site_result_v1"); assert.deepEqual(args, { p_site_id: scope.siteId, p_operation_key: scope.operationKey, p_principal_key: principalKey });
    return { data: view(), error: null };
  };
  assert.deepEqual(await readOnSiteCheckoutResult(scope, { authorize: async () => principal, call }), view());
  assert.equal(calls, 1);
  await assert.rejects(readOnSiteCheckoutResult(scope, { authorize: async () => null, call }), /checkout_unauthorized/); assert.equal(calls, 1);
  let checks = 0;
  await assert.rejects(readOnSiteCheckoutResult(scope, { authorize: async () => ++checks === 1 ? principal : { ...principal, userId: "different-user" }, call }), /checkout_identity_changed/);
});
test("read failures are not absence, and extra financial/identity body fields never reach RPC", async () => {
  let calls = 0;
  const ports = { authorize: async () => principal, call: async () => { calls++; return { data: null, error: null }; } };
  assert.equal(await readOnSiteCheckoutResult(scope, ports), null);
  for (const input of [{ ...scope, principalKey }, { ...scope, totalPoints: 0 }, { ...scope, siteId: "bad" }]) await assert.rejects(readOnSiteCheckoutResult(input, ports), /checkout_invalid_request/);
  assert.equal(calls, 1);
  await assert.rejects(readOnSiteCheckoutResult(scope, { ...ports, call: () => { throw new Error("socket"); } }), /checkout_unavailable/);
  await assert.rejects(readOnSiteCheckoutResult(scope, { ...ports, call: async () => ({ data: null, error: { message: "private-sql-error" } }) }), /checkout_unavailable/);
});
test("cancellation makes exactly one original command, parses scope and never returns private fields", async () => {
  let calls = 0;
  const result = await cancelOnSiteCheckout({ ...scope, expectedUpdatedAt: at }, { authorize: async () => principal, call: async (name, args) => {
    calls++; assert.equal(name, "faolla_member_checkout_on_site_cancel_v1"); assert.equal(args.p_principal_key, principalKey); assert.equal(args.p_expected_updated_at, at);
    return { data: { replayed: false, receipt: { ...cancellation(), couponUses: "SECRET" } }, error: null };
  } });
  assert.equal(calls, 1); assert.deepEqual(result, { replayed: false, cancellation: cancellation() });
});
test("invalid or unauthenticated cancellation never dispatches a command", async () => {
  let calls = 0;
  const call = async () => { calls++; return { data: null, error: null }; };
  for (const input of [{ ...scope, expectedUpdatedAt: "bad" }, { ...scope, expectedUpdatedAt: at, principalKey }, { ...scope, expectedUpdatedAt: at, couponsReturned: 1 }])
    await assert.rejects(cancelOnSiteCheckout(input, { authorize: async () => principal, call }), /checkout_invalid_request/);
  await assert.rejects(cancelOnSiteCheckout({ ...scope, expectedUpdatedAt: at }, { authorize: async () => null, call }), /checkout_unauthorized/);
  assert.equal(calls, 0);
});
test("lost/malformed response or post-dispatch logout preserves unknown outcome without retry/compensation", async () => {
  for (const mode of ["throw", "malformed", "logout"] as const) {
    let calls = 0, checks = 0;
    await assert.rejects(cancelOnSiteCheckout({ ...scope, expectedUpdatedAt: at }, {
      authorize: async () => mode === "logout" && ++checks > 1 ? null : principal,
      call: () => { calls++; if (mode === "throw") throw new Error("lost response"); return Promise.resolve({ data: mode === "malformed" ? {} : { replayed: false, receipt: cancellation() }, error: null }); },
    }), /checkout_unconfirmed/);
    assert.equal(calls, 1);
  }
});
test("known refusal and old CAS conflicts map safely; unknown errors are unconfirmed", async () => {
  for (const message of ["checkout_cancellation_requires_refund", "checkout_cancellation_deadline", "checkout_cancellation_review_required", "merchant_coupons_conflict", "private-error"]) {
    const expected = message === "merchant_coupons_conflict" ? "checkout_conflict" : message === "private-error" ? "checkout_unconfirmed" : message;
    await assert.rejects(cancelOnSiteCheckout({ ...scope, expectedUpdatedAt: at }, { authorize: async () => principal,
      call: async () => ({ data: null, error: { message } }) }), new RegExp(expected));
  }
});
test("malformed transport envelopes cannot become not-found or a confirmed cancellation", async () => {
  for (const envelope of [null, {}, { data: null }, { data: null, error: "bad" }]) {
    let calls = 0;
    const call = (async () => { calls++; return envelope; }) as unknown as MemberCheckoutResultRpc;
    await assert.rejects(readOnSiteCheckoutResult(scope, { authorize: async () => principal, call }), /checkout_unavailable/);
    await assert.rejects(cancelOnSiteCheckout({ ...scope, expectedUpdatedAt: at }, { authorize: async () => principal, call }), /checkout_unconfirmed/);
    assert.equal(calls, 2);
  }
});
