import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { Block } from "@/data/homeBlocks";
import { createDefaultMerchantPermissionConfig } from "@/data/platformControlStore";
import { buildPlatformMerchantSnapshotBlocks, buildPlatformMerchantSnapshotSite, normalizePlatformMerchantSnapshotPayload } from "./platformMerchantSnapshot";
import { buildCheckoutSourceChoices } from "./merchantCheckoutSources.server";
import { buildMerchantBookingRulesSnapshot } from "./merchantBookingRules";
import { createDefaultMerchantBookingWorkbenchSettings } from "./merchantBookingWorkbench";
import { bookingWallTimeAt } from "./merchantBookingTime";
import { createEmptyMerchantMembershipSettings } from "./merchantMembershipSettings";
import { normalizeMerchantMembershipRecord } from "./merchantMemberships";
import { normalizeMerchantCouponRecord } from "./merchantCoupons";
import { checkoutSubmissionIdentity, parseCheckoutSubmissionRequest, quoteCheckoutSubmissionSnapshot, planCheckoutSubmission, type CheckoutSubmissionSnapshot } from "./merchantCheckoutSubmissionPlan.server";
import { submitMemberCheckout, type CheckoutSubmissionRpc } from "./merchantCheckoutSubmission.server";
import type { MemberCheckoutResult } from "./merchantMemberCheckoutResult";

const siteId = "10909095", principal = { accountId: "50010105", userId: "customer-synthetic" };
async function fixture(couponAmount = 20) {
  const at = new Date().toISOString(), blocks = [{ id: "booking-test", type: "booking", props: { bookingStoreOptions: ["Store"], bookingItemOptions: ["Play"], bookingTitleOptions: ["Mx"],
    bookingTimeSlotRules: [{ timeRange: "10:00-18:00", maxBookings: 1 }] } }] as Block[];
  const source = buildCheckoutSourceChoices({ siteId, siteName: "Synthetic", blocks, catalog: null, allowBooking: true, allowOrder: false })[0];
  const site = buildPlatformMerchantSnapshotSite({ id: siteId, name: "Synthetic", status: "online", serviceExpiresAt: "2099-01-01T00:00:00Z", permissionConfig: {
    ...createDefaultMerchantPermissionConfig(), allowBookingBlock: true, allowMembershipManagement: true, allowPointsRedemption: true, allowCouponModule: true } })!;
  const settings = createEmptyMerchantMembershipSettings(siteId), member = normalizeMerchantMembershipRecord({ id: "member-private", siteId, ...principal, status: "active", joinedAt: at, pointBalance: 1000, balanceAmount: 12, growthValue: 0, transactions: [] })!;
  const coupon = normalizeMerchantCouponRecord({ id: "coupon-test", siteId, code: "TEST", title: "Synthetic", discountType: "points_voucher", discountValue: couponAmount,
    usageScenarios: ["points_redemption"], createdAt: at, updatedAt: at, claimEvents: [{ id: "claim-test", at, ...principal, email: "private@example.invalid", customerName: "Private",
      code: "", settlementCode: "PRIVATE-CODE", settlementType: "qr", validUntil: null }] })!;
  const row = (slug: string, merchant_id: string | null, value: unknown) => ({ id: randomUUID(), slug, merchant_id, blocks: JSON.parse(JSON.stringify(value)) as unknown, updated_at: at });
  const request = { siteId, offerId: randomUUID(), offerRevision: randomUUID(), quantity: 1,
    appointmentAt: `${bookingWallTimeAt(new Date(Date.now() + 3 * 86_400_000), "Europe/Madrid").slice(0, 10)}T12:00`, couponClaims: [{ couponId: coupon.id, claimEventId: "claim-test" }],
    nonce: randomUUID(), confirmationHash: "0".repeat(64), method: "points", customer: { name: "Synthetic", title: "Mx", phone: "000", email: "synthetic@example.invalid", note: "" } };
  let identity = checkoutSubmissionIdentity(request, principal);
  const snapshot: CheckoutSubmissionSnapshot = { version: 2, siteId, principalKey: identity.principalKey, operationKey: identity.operationKey, requestHash: identity.requestHash, databaseNow: at,
    offer: { version: 1, id: request.offerId, revision: request.offerRevision, siteId, enabled: true, title: "Synthetic", source: { kind: "booking", blockId: source.blockId, serviceId: request.offerId, timeZone: "Europe/Madrid" }, maxQuantity: 1,
      unitPoints: 100, cash: { currency: "eur", unitAmountMinor: 1000, initialPolicy: { mode: "full" } }, allowOnSite: true, couponReturnOnCancel: true,
      checkoutBinding: { sourceKey: source.key, sourceVersion: source.sourceVersion, viewport: source.viewport, store: source.store, item: source.item, stockItemId: null,
        voucherCouponIds: [], durationMinutes: 60, pointsReturnOnCancel: true, cancellationAdvanceMinutes: 60 } },
    sourceRows: [row("__platform_merchant_snapshot__", null, buildPlatformMerchantSnapshotBlocks(normalizePlatformMerchantSnapshotPayload({ revision: randomUUID(), snapshot: [site], defaultSortRule: "created_desc", merchantConfigHistoryBySiteId: {} }))), row("synthetic", siteId, blocks)],
    domainRows: [row(`__merchant_memberships__:${siteId}`, siteId, [member]), row(`__merchant_membership_settings__:${siteId}`, siteId, settings), row(`__merchant_coupons__:${siteId}`, siteId, [coupon])],
    booking: { generation: randomUUID(), revision: "1", rows: [row("__merchant_booking_records__:v1", "__faolla_booking_persistence__", { version: 1, records: [] }),
      row("__merchant_booking_rules__:v1", "__faolla_booking_persistence__", { version: 1, snapshots: { [siteId]: buildMerchantBookingRulesSnapshot(siteId, blocks, at) } }),
      row("__merchant_booking_workbench__:v1", "__faolla_booking_persistence__", { version: 1, settingsBySiteId: { [siteId]: { ...createDefaultMerchantBookingWorkbenchSettings(), timeZone: "Europe/Madrid" } } })] } };
  const quote = await quoteCheckoutSubmissionSnapshot(snapshot, identity, principal); request.confirmationHash = quote.confirmationHash!;
  identity = checkoutSubmissionIdentity(request, principal); snapshot.requestHash = identity.requestHash;
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let result: MemberCheckoutResult | null = null;
  const rpc: CheckoutSubmissionRpc = async (name, args) => {
    calls.push({ name, args: structuredClone(args) });
    if (name.includes("snapshot")) return { data: { replayed: false, snapshot: structuredClone(snapshot) }, error: null };
    const plan = args.p_plan as { receipt: { resourceId: string; totalPoints: number; couponCount: number } };
    result = { version: 1, siteId, operationKey: identity.operationKey, resourceKind: "booking", ...plan.receipt, closed: false, resource: { status: "active", updatedAt: at }, cancellation: null,
      cancellationAvailable: true, cancellationPolicy: { returnPoints: true, returnCoupons: true, advanceMinutes: 60, cancellableUntil: "2099-01-01T00:00:00Z" } };
    return { data: { replayed: false, result }, error: null };
  };
  const input = { request, principal: { ...principal }, authorize: async () => ({ ...principal }) as typeof principal | null };
  return { request, identity, snapshot, calls, rpc, input, outcome: () => result };
}
test("v2 plans the actual selected coupon and point debit with one composite write, not old independent APIs", async () => {
  const f = await fixture(), before = structuredClone(f.snapshot), result = await submitMemberCheckout(f.input, f.rpc);
  assert.equal(result.result.totalPoints, 80); assert.equal(result.result.couponCount, 1); assert.equal(result.result.resource!.status, "active");
  assert.deepEqual(f.snapshot, before); assert.equal(f.calls.length, 2);
  const plan = f.calls[1].args.p_plan as { membership: { transactions: Array<{ pointDelta: number; balanceDelta: number }> }; coupons: unknown; booking: { record: { customerAccountId: string; customerUserId: string } } };
  assert.equal(plan.membership.transactions[0].pointDelta, -80); assert.equal(plan.membership.transactions[0].balanceDelta, 0); assert.ok(plan.coupons);
  assert.equal(plan.booking.record.customerAccountId, principal.accountId); assert.equal(plan.booking.record.customerUserId, principal.userId);
  assert.ok(!/PRIVATE|member-private|sourceRows|customer-synthetic/.test(JSON.stringify(result)));
});
test("request identity is nonce/site/principal bound, canonicalizes coupons, and changes when customer intent changes", async () => {
  const f = await fixture(), original = checkoutSubmissionIdentity(f.request, principal);
  const edit = checkoutSubmissionIdentity({ ...f.request, customer: { ...f.request.customer, note: "Different" } }, principal);
  assert.equal(edit.operationKey, original.operationKey); assert.notEqual(edit.requestHash, original.requestHash);
  assert.notEqual(checkoutSubmissionIdentity({ ...f.request, nonce: randomUUID() }, principal).operationKey, original.operationKey);
  assert.notEqual(checkoutSubmissionIdentity(f.request, { ...principal, userId: "other-synthetic" }).operationKey, original.operationKey);
  for (const extra of [{ totalPoints: 1 }, { principalKey: "other" }, { method: "online" }, { nonce: "fixed" }]) assert.throws(() => parseCheckoutSubmissionRequest({ ...f.request, ...extra }));
  for (const key of ["name", "title", "phone", "email"]) assert.throws(() => parseCheckoutSubmissionRequest({ ...f.request, customer: { ...f.request.customer, [key]: "first\nsecond" } }));
  assert.equal(parseCheckoutSubmissionRequest({ ...f.request, customer: { ...f.request.customer, note: "first\nsecond" } }).customer.note, "first\nsecond");
});
test("confirmation cannot authorize a changed real price, scope or cancellation-source revision", async () => {
  const f = await fixture(); f.snapshot.offer.unitPoints = 200;
  await assert.rejects(submitMemberCheckout(f.input, f.rpc), /checkout_quote_changed/); assert.equal(f.calls.length, 1);
  const other = await fixture(); other.snapshot.siteId = "10909096";
  await assert.rejects(submitMemberCheckout(other.input, other.rpc)); assert.equal(other.calls.length, 1);
});
test("a fully covered coupon uses zero actual points without a cash paid or business completed flag", async () => {
  const f = await fixture(100), plan = await planCheckoutSubmission(f.snapshot, f.identity, principal), receipt = plan.plan.receipt as Record<string, unknown>;
  assert.equal(receipt.totalPoints, 0); assert.equal(receipt.couponCount, 1); assert.equal("paid" in receipt, false);
  assert.deepEqual((plan.plan.membership as { transactions: unknown[] }).transactions, []);
});
test("ambiguous write, malformed receipt and SQL failures never retry or compensate", async () => {
  for (const mode of ["lost", "invalid", "sql"]) {
    const f = await fixture(); let writes = 0;
    await assert.rejects(submitMemberCheckout(f.input, async (name, args) => {
      if (name.includes("snapshot")) return f.rpc(name, args); writes++;
      if (mode === "lost") throw new Error("lost response");
      return mode === "invalid" ? { data: { replayed: false, result: {} }, error: null } : { data: null, error: { message: "SQL private_account secret" } };
    }), /checkout_unconfirmed/);
    assert.equal(writes, 1); assert.equal(f.calls.filter(call => call.name.includes("snapshot")).length, 1);
  }
});
test("definite SQL conflicts preserve the operation and do not silently reprice or retry", async () => {
  const f = await fixture(); let writes = 0;
  await assert.rejects(submitMemberCheckout(f.input, async (name, args) => {
    if (name.includes("snapshot")) return f.rpc(name, args); writes++; return { data: null, error: { message: "checkout_conflict" } };
  }), /checkout_conflict/); assert.equal(writes, 1);
});
test("authorization loss and exceeded deadline after a slow snapshot cannot dispatch a late write", async () => {
  const auth = await fixture(); auth.input.authorize = async () => auth.calls.length ? null : principal;
  await assert.rejects(submitMemberCheckout(auth.input, auth.rpc), /checkout_unauthorized/); assert.equal(auth.calls.length, 1);
  const timed = await fixture(); let now = Date.now();
  await assert.rejects(submitMemberCheckout({ ...timed.input, now: () => now }, async (name, args) => { const result = await timed.rpc(name, args); now += 13_000; return result; }));
  assert.equal(timed.calls.length, 1);
});
test("account loss after a committed write hides the result and leaves it unknown, without another write", async () => {
  const f = await fixture(); f.input.authorize = async () => f.calls.length === 2 ? null : principal;
  await assert.rejects(submitMemberCheckout(f.input, f.rpc), /checkout_unconfirmed/); assert.equal(f.calls.length, 2);
});
test("captured input cannot be replaced while snapshot I/O waits", async () => {
  const f = await fixture(); const result = await submitMemberCheckout(f.input, async (name, args) => {
    if (name.includes("snapshot")) { const read = await f.rpc(name, args); f.request.customer.name = "Changed later"; f.input.principal.accountId = "50010106"; return read; }
    return f.rpc(name, args);
  });
  assert.equal(result.result.totalPoints, 80);
  const plan = f.calls[1].args.p_plan as { booking: { record: { customerName: string; customerAccountId: string } } };
  assert.equal(plan.booking.record.customerName, "Synthetic"); assert.equal(plan.booking.record.customerAccountId, principal.accountId);
});
test("a committed result replay reauthorizes without consulting changed catalog, member or private mutation data", async () => {
  const f = await fixture(); await submitMemberCheckout(f.input, f.rpc); const receipt = f.outcome()!; let calls = 0;
  const result = await submitMemberCheckout(f.input, async () => { calls++; return { data: { replayed: true, result: { ...receipt, memberId: "PRIVATE", sourceRows: [] } }, error: null }; });
  assert.equal(calls, 1); assert.equal(result.replayed, true); assert.deepEqual(result.result, receipt);
});
test("commit-phase replay returns the first original resource ID, not a freshly planned ID", async () => {
  const f = await fixture(); await submitMemberCheckout(f.input, f.rpc); const original = f.outcome()!;
  const result = await submitMemberCheckout(f.input, async (name, args) => name.includes("snapshot") ? f.rpc(name, args)
    : { data: { replayed: true, result: { ...original, resourceId: "original-already-committed" } }, error: null });
  assert.equal(result.replayed, true); assert.equal(result.result.resourceId, "original-already-committed");
});
test("standalone trusted planner captures caller identity and customer fields before yielding", async () => {
  const f = await fixture(), who = { ...principal }, identity = structuredClone(f.identity);
  const pending = planCheckoutSubmission(f.snapshot, identity, who);
  who.accountId = "50010106"; identity.request.customer.name = "Changed later";
  const prepared = await pending, record = (prepared.plan.booking as { record: Record<string, unknown> }).record;
  assert.equal(record.customerAccountId, principal.accountId); assert.equal(record.customerName, "Synthetic");
});
test("trusted commit deadline includes service and selected claim expiry, not just a 30-second quote age", async () => {
  const f = await fixture(), now = Date.parse(f.snapshot.databaseNow), serviceEnd = new Date(now + 8000).toISOString(), claimEnd = new Date(now + 4000).toISOString();
  const platform = f.snapshot.sourceRows.find(row => row.slug === "__platform_merchant_snapshot__")!.blocks as Array<{ props: { publishedMerchantSnapshot: Array<{ serviceExpiresAt: string }> } }>;
  platform[0].props.publishedMerchantSnapshot[0].serviceExpiresAt = serviceEnd;
  let prepared = await planCheckoutSubmission(f.snapshot, f.identity, principal); assert.equal(prepared.notAfter, serviceEnd);
  const coupons = f.snapshot.domainRows.find(row => row.slug === `__merchant_coupons__:${siteId}`)!.blocks as Array<{ claimEvents: Array<{ validUntil: string | null }> }>;
  coupons[0].claimEvents[0].validUntil = claimEnd;
  prepared = await planCheckoutSubmission(f.snapshot, f.identity, principal); assert.equal(prepared.notAfter, claimEnd);
});
