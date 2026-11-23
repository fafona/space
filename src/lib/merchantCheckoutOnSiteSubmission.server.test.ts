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
import { checkoutSubmissionIdentity, checkoutSubmissionRecoveryIdentity } from "./merchantCheckoutSubmissionPlan.server";
import { onSiteSubmissionIdentity, parseOnSiteSubmissionRequest, parseOnSiteSubmissionSnapshot, quoteOnSiteSubmissionSnapshot, planOnSiteSubmission, type OnSiteSubmissionSnapshot } from "./merchantCheckoutOnSiteSubmissionPlan.server";
import { previewOnSiteCheckout, submitOnSiteCheckout, recoverOnSiteCheckout, type OnSiteSubmissionRpc } from "./merchantCheckoutOnSiteSubmission.server";

const siteId = "10909095", principal = { accountId: "50010105", userId: "cash-customer-synthetic" };
function fixture({ withCoupon = true, covered = false, points = true } = {}) {
  const at = new Date().toISOString(), blocks = [{ id: "cash-booking", type: "booking", props: { bookingStoreOptions: ["Store"], bookingItemOptions: ["Play"], bookingTitleOptions: ["Mx"],
    bookingTimeSlotRules: [{ timeRange: "10:00-18:00", maxBookings: 1 }] } }] as Block[];
  const source = buildCheckoutSourceChoices({ siteId, siteName: "Synthetic", blocks, catalog: null, allowBooking: true, allowOrder: false })[0];
  const site = buildPlatformMerchantSnapshotSite({ id: siteId, name: "Synthetic", status: "online", serviceExpiresAt: "2099-01-01T00:00:00Z", permissionConfig: {
    ...createDefaultMerchantPermissionConfig(), allowBookingBlock: true, allowMembershipManagement: true, allowPointsRedemption: false, allowCouponModule: withCoupon } })!;
  const settings = createEmptyMerchantMembershipSettings(siteId), member = normalizeMerchantMembershipRecord({ id: "cash-private-member", siteId, ...principal, status: "active", joinedAt: at, pointBalance: 0, balanceAmount: 12, growthValue: 0, transactions: [] })!;
  const coupon = normalizeMerchantCouponRecord({ id: "cash-coupon", siteId, code: "TEST", title: "Synthetic", discountType: "amount_off", discountValue: covered ? 10 : 2,
    usageScenarios: ["order_cart"], createdAt: at, updatedAt: at, claimEvents: [{ id: "cash-claim", at, ...principal, email: "private@example.invalid", customerName: "Private",
      code: "", settlementCode: "PRIVATE-CODE", settlementType: "qr", validUntil: null }] })!;
  const row = (slug: string, merchant_id: string | null, value: unknown) => ({ id: randomUUID(), slug, merchant_id, blocks: structuredClone(value), updated_at: at });
  const request = { siteId, offerId: randomUUID(), offerRevision: randomUUID(), quantity: 1,
    appointmentAt: `${bookingWallTimeAt(new Date(Date.now() + 3 * 86_400_000), "Europe/Madrid").slice(0, 10)}T12:00`, couponClaims: withCoupon ? [{ couponId: coupon.id, claimEventId: "cash-claim" }] : [],
    nonce: randomUUID(), confirmationHash: "0".repeat(64), method: "on_site", customer: { name: "Synthetic", title: "Mx", phone: "000", email: "synthetic@example.invalid", note: "" } };
  let identity = onSiteSubmissionIdentity(request, principal);
  const snapshot: OnSiteSubmissionSnapshot = { version: 3, method: "on_site", siteId, principalKey: identity.principalKey, operationKey: identity.operationKey, requestHash: identity.requestHash, databaseNow: at,
    offer: { version: 1, id: request.offerId, revision: request.offerRevision, siteId, enabled: true, title: "Synthetic", source: { kind: "booking", blockId: source.blockId, serviceId: request.offerId, timeZone: "Europe/Madrid" }, maxQuantity: 1,
      unitPoints: points ? 100 : null, cash: { currency: "eur", unitAmountMinor: 1000, initialPolicy: { mode: "full" } }, allowOnSite: true, couponReturnOnCancel: true,
      checkoutBinding: { sourceKey: source.key, sourceVersion: source.sourceVersion, viewport: source.viewport, store: source.store, item: source.item, stockItemId: null,
        voucherCouponIds: [], durationMinutes: 60, pointsReturnOnCancel: true, cancellationAdvanceMinutes: 60 } },
    sourceRows: [row("__platform_merchant_snapshot__", null, buildPlatformMerchantSnapshotBlocks(normalizePlatformMerchantSnapshotPayload({ revision: randomUUID(), snapshot: [site], defaultSortRule: "created_desc", merchantConfigHistoryBySiteId: {} }))), row("synthetic", siteId, blocks)],
    domainRows: [row(`__merchant_memberships__:${siteId}`, siteId, [member]), row(`__merchant_membership_settings__:${siteId}`, siteId, settings), row(`__merchant_coupons__:${siteId}`, siteId, [coupon])],
    booking: { generation: randomUUID(), revision: "1", rows: [row("__merchant_booking_records__:v1", "__faolla_booking_persistence__", { version: 1, records: [] }),
      row("__merchant_booking_rules__:v1", "__faolla_booking_persistence__", { version: 1, snapshots: { [siteId]: buildMerchantBookingRulesSnapshot(siteId, blocks, at) } }),
      row("__merchant_booking_workbench__:v1", "__faolla_booking_persistence__", { version: 1, settingsBySiteId: { [siteId]: { ...createDefaultMerchantBookingWorkbenchSettings(), timeZone: "Europe/Madrid" } } })] } };
  const quote = quoteOnSiteSubmissionSnapshot(snapshot, identity, principal); request.confirmationHash = quote.confirmationHash;
  identity = onSiteSubmissionIdentity(request, principal); snapshot.requestHash = identity.requestHash;
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const rpc: OnSiteSubmissionRpc = async (name, args, signal) => {
    assert.ok(signal instanceof AbortSignal); calls.push({ name, args: structuredClone(args) });
    if (name.includes("snapshot")) return { data: { replayed: false, snapshot: structuredClone(snapshot) }, error: null };
    const plan = args.p_plan as ReturnType<typeof planOnSiteSubmission>["plan"];
    return { data: { replayed: false, result: { version: 2, siteId, operationKey: identity.operationKey, terms: plan.receipt, closed: false, resource: { status: "active", updatedAt: at }, termsMatch: true,
      collection: null, cancellation: null, cancellationAvailable: true, cancellationPolicy: { returnCoupons: true, advanceMinutes: 60, cancellableUntil: "2099-01-01T00:00:00Z" } } }, error: null };
  };
  const input = { request, principal: { ...principal }, authorize: async () => ({ ...principal }) as typeof principal | null };
  const refreshSite = () => { snapshot.sourceRows[0].blocks = buildPlatformMerchantSnapshotBlocks(normalizePlatformMerchantSnapshotPayload({ revision: randomUUID(), snapshot: [site], defaultSortRule: "created_desc", merchantConfigHistoryBySiteId: {} })); };
  return { request, identity, snapshot, quote, calls, rpc, input, member, coupon, site, refreshSite };
}

test("cash preview and submit use cash cents with zero points and without the points module", async () => {
  for (const points of [true, false]) {
    const f = fixture({ points }), before = structuredClone(f.snapshot), result = await submitOnSiteCheckout(f.input, f.rpc);
    assert.ok("result" in result); assert.equal(result.result!.terms.dueMinor, 800); assert.equal(result.result!.terms.totalPoints, null); assert.equal(result.result!.terms.capturedMinor, 0);
    assert.equal(result.result!.terms.paymentState, "unpaid"); assert.deepEqual(f.snapshot, before); assert.equal(f.calls.length, 2);
    assert.ok(!/cash-private-member|PRIVATE|sourceRows|cash-customer-synthetic/.test(JSON.stringify(result)));
    const plan = f.calls[1].args.p_plan as Record<string, unknown>;
    assert.deepEqual(Object.keys(plan.membership as object).sort(), ["expectedUpdatedAt", "id"]); assert.equal("transactions" in plan, false);
  }
});
test("a preview only reads, reveals a safe confirmation, and creates no slot hold", async () => {
  const f = fixture(), result = await previewOnSiteCheckout(f.input, f.rpc);
  assert.ok("quote" in result); assert.equal(result.quote!.confirmationHash, f.quote.confirmationHash); assert.equal(result.quote!.reservationCreated, false);
  assert.equal(result.quote!.slot!.reserved, false); assert.equal(f.calls.length, 1);
  assert.ok(!/PRIVATE|cash-private-member|sourceRows|principalKey/.test(JSON.stringify(result)));
});
test("coupon coverage is not cash captured or point consumption, and no-coupon cash needs no coupon permission", async () => {
  for (const options of [{ covered: true }, { withCoupon: false }]) {
    const f = fixture(options), prepared = planOnSiteSubmission(f.snapshot, f.identity, principal);
    assert.equal(prepared.plan.receipt.capturedMinor, 0); assert.equal(prepared.plan.receipt.totalPoints, null);
    assert.equal(prepared.plan.receipt.dueMinor, options.covered ? 0 : 1000);
    assert.equal(prepared.plan.receipt.paymentState, options.covered ? "coupon_covered" : "unpaid");
    if (options.withCoupon === false) assert.equal("coupons" in prepared.plan, false);
  }
});
test("cash and points share the original nonce key but not the financial request hash", () => {
  const f = fixture(), points = checkoutSubmissionIdentity({ ...f.request, method: "points" }, principal);
  assert.equal(points.operationKey, f.identity.operationKey); assert.notEqual(points.requestHash, f.identity.requestHash);
  assert.equal(checkoutSubmissionRecoveryIdentity({ siteId, nonce: f.request.nonce }, principal).operationKey, f.identity.operationKey);
  for (const extra of [{ method: "points" }, { dueMinor: 1 }, { accountId: "50010106" }, { nonce: "bad" }, { appointmentAt: "2099-01-01T12:00Z" }]) assert.throws(() => parseOnSiteSubmissionRequest({ ...f.request, ...extra }));
  for (const extra of [{ name: "" }, { name: "first\nlast" }, { phone: "" }, { email: "wrong" }, { title: "x".repeat(161) }]) assert.throws(() => parseOnSiteSubmissionRequest({ ...f.request, customer: { ...f.request.customer, ...extra } }));
  assert.equal(parseOnSiteSubmissionRequest({ ...f.request, customer: { ...f.request.customer, note: "first\nlast" } }).customer.note, "first\nlast");
});
test("method, tenant, physical rows, member, raw coupon and booking documents fail closed", () => {
  const variants: Array<(f: ReturnType<typeof fixture>) => void> = [
    f => { (f.snapshot as unknown as Record<string, unknown>).version = 2; }, f => { f.snapshot.siteId = "10909096"; },
    f => { f.snapshot.sourceRows.push(f.snapshot.sourceRows[1]); }, f => { f.snapshot.domainRows[0].merchant_id = "10909096"; },
    f => { (f.snapshot.domainRows[0].blocks as Array<Record<string, unknown>>)[0].status = "left"; },
    f => { (f.snapshot.domainRows[0].blocks as Array<Record<string, unknown>>)[0].accountId = "50010106"; },
    f => { (f.snapshot.domainRows[2].blocks as Array<Record<string, unknown>>)[0].discountValue = "2"; },
    f => { const c = (f.snapshot.domainRows[2].blocks as Array<Record<string, unknown>>)[0]; (c.claimEvents as Array<Record<string, unknown>>)[0].accountId = "50010106"; },
    f => { (f.snapshot.booking!.rows[0].blocks as { records: unknown[] }).records = [{ id: "broken", siteId, status: "unknown" }]; },
  ];
  for (const change of variants) { const f = fixture(); change(f); assert.throws(() => planOnSiteSubmission(f.snapshot, f.identity, principal)); }
});
test("changed cash price or original return policy requires a new confirmation", () => {
  for (const change of [(f: ReturnType<typeof fixture>) => { f.snapshot.offer.cash!.unitAmountMinor = 1500; }, (f: ReturnType<typeof fixture>) => { f.snapshot.offer.couponReturnOnCancel = false; }]) {
    const f = fixture(); change(f); assert.throws(() => planOnSiteSubmission(f.snapshot, f.identity, principal), /checkout_quote_changed/);
  }
});
test("current service and cash module permissions are required, without borrowing points permission", () => {
  for (const field of ["allowBookingBlock", "allowMembershipManagement", "allowCouponModule"] as const) {
    const f = fixture(); f.site.permissionConfig![field] = false; f.refreshSite();
    assert.throws(() => planOnSiteSubmission(f.snapshot, f.identity, principal), /checkout_module_unavailable/);
  }
  const expired = fixture(); expired.site.serviceExpiresAt = "2000-01-01T00:00:00.000Z"; expired.refreshSite();
  assert.throws(() => planOnSiteSubmission(expired.snapshot, expired.identity, principal), /checkout_module_unavailable/);
  const paused = fixture(); paused.site.status = "offline"; paused.refreshSite();
  assert.throws(() => planOnSiteSubmission(paused.snapshot, paused.identity, principal), /checkout_module_unavailable/);
});
test("submission deadline cannot outlive the service or selected claim", () => {
  for (const boundary of ["service", "claim"]) {
    const f = fixture(), until = new Date(Date.parse(f.snapshot.databaseNow) + 8000).toISOString();
    if (boundary === "service") { f.site.serviceExpiresAt = until; f.refreshSite(); }
    else { const coupon = (f.snapshot.domainRows[2].blocks as Array<{ claimEvents: Array<{ validUntil: string | null }> }>)[0]; coupon.claimEvents[0].validUntil = until; }
    assert.equal(planOnSiteSubmission(f.snapshot, f.identity, principal).notAfter, until);
  }
});
test("appointment capacity, current published rules and workbench timezone remain authoritative", () => {
  const occupied = fixture(); (occupied.snapshot.booking!.rows[0].blocks as { records: unknown[] }).records = [{ id: "occupied", siteId, status: "active", bookingBlockId: "cash-booking", bookingViewport: "desktop",
    appointmentAt: occupied.request.appointmentAt, appointmentTimeZone: "Europe/Madrid", store: "Store", item: "Play" }];
  assert.throws(() => planOnSiteSubmission(occupied.snapshot, occupied.identity, principal), /checkout_quantity_unavailable/);
  const changed = fixture(), changedBlock = (changed.snapshot.sourceRows[1].blocks as Block[])[0];
  assert.equal(changedBlock.type, "booking"); if (changedBlock.type !== "booking") throw new Error("invalid test fixture");
  changedBlock.props.bookingItemOptions = ["Different"];
  assert.throws(() => planOnSiteSubmission(changed.snapshot, changed.identity, principal), /checkout_source_changed/);
  const zone = fixture(); (zone.snapshot.booking!.rows[2].blocks as { settingsBySiteId: Record<string, { timeZone: string }> }).settingsBySiteId[siteId].timeZone = "UTC";
  assert.throws(() => planOnSiteSubmission(zone.snapshot, zone.identity, principal), /checkout_source_changed/);
});
test("cloned inputs cannot be replaced during snapshot IO", async () => {
  const f = fixture(), result = await submitOnSiteCheckout(f.input, async (name, args, signal) => {
    const response = await f.rpc(name, args, signal);
    if (name.includes("snapshot")) { f.request.customer.name = "Tampered later"; f.input.principal.accountId = "50010106"; }
    return response;
  });
  assert.ok(result.result); const record = (f.calls[1].args.p_plan as { booking: { record: Record<string, unknown> } }).booking.record;
  assert.equal(record.customerName, "Synthetic"); assert.equal(record.customerAccountId, principal.accountId);
});
test("slow or aborted reads and auth loss never dispatch a late write", async () => {
  const f = fixture(); let now = Date.now();
  await assert.rejects(submitOnSiteCheckout({ ...f.input, now: () => now }, async (...args) => { const result = await f.rpc(...args); now += 13_000; return result; }));
  assert.equal(f.calls.length, 1);
  const auth = fixture(); auth.input.authorize = async () => auth.calls.length ? null : principal;
  await assert.rejects(submitOnSiteCheckout(auth.input, auth.rpc), /checkout_unauthorized/); assert.equal(auth.calls.length, 1);
  const abort = fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(submitOnSiteCheckout({ ...abort.input, signal: controller.signal }, abort.rpc)); assert.equal(abort.calls.length, 0);
});
test("lost, malformed and changed-identity write results stay unknown without retry or compensation", async () => {
  for (const mode of ["lost", "malformed", "amount", "auth"]) {
    const f = fixture(); let writes = 0;
    if (mode === "auth") f.input.authorize = async () => writes ? null : principal;
    await assert.rejects(submitOnSiteCheckout(f.input, async (name, args, signal) => {
      if (name.includes("snapshot")) return f.rpc(name, args, signal); writes++;
      if (mode === "lost") throw new Error("lost response");
      if (mode === "malformed") return { data: {}, error: null };
      const response = await f.rpc(name, args, signal);
      if (mode === "amount") (response.data as { result: { terms: { grossMinor: number; dueMinor: number } } }).result.terms.grossMinor++;
      return response;
    }), /checkout_unconfirmed/); assert.equal(writes, 1);
  }
});
test("definite SQL rejection preserves the original key and never retries", async () => {
  const f = fixture(); let writes = 0;
  await assert.rejects(submitOnSiteCheckout(f.input, async (name, args, signal) => {
    if (name.includes("snapshot")) return f.rpc(name, args, signal); writes++; return { data: null, error: { message: "checkout_conflict" } };
  }), /checkout_conflict/); assert.equal(writes, 1);
});
test("original replay bypasses fresh offer and membership planning but still reauthorizes and allowlists", async () => {
  const f = fixture(), result = await submitOnSiteCheckout(f.input, f.rpc); assert.ok(result.result);
  const next = await submitOnSiteCheckout(f.input, async () => ({ data: { replayed: true, result: { ...result.result, privateTokens: "SECRET" } }, error: null }));
  assert.equal(next.replayed, true); assert.ok(!JSON.stringify(next).includes("SECRET"));
  const wrong = { ...f.identity, principalKey: "account:50010106:foreign-customer" };
  assert.throws(() => parseOnSiteSubmissionSnapshot(f.snapshot, wrong));
});
test("nonce recovery is one bounded original read, no financial inputs and no late identity response", async () => {
  const f = fixture(), original = (await submitOnSiteCheckout(f.input, f.rpc)).result; assert.ok(original);
  const input = { siteId, nonce: f.request.nonce }; let calls = 0;
  const ports = { authorize: async () => principal as typeof principal | null,
    call: async (name: string, args: Record<string, unknown>, signal: AbortSignal) => {
      calls++; assert.equal(name, "faolla_member_checkout_on_site_result_v1"); assert.ok(signal instanceof AbortSignal);
      assert.deepEqual(args, { p_site_id: siteId, p_operation_key: f.identity.operationKey, p_principal_key: f.identity.principalKey });
      return { data: original as unknown, error: null };
    } };
  assert.deepEqual(await recoverOnSiteCheckout(input, ports), original); assert.equal(calls, 1);
  await assert.rejects(recoverOnSiteCheckout({ ...input, dueMinor: 1 }, ports), /checkout_invalid_request/); assert.equal(calls, 1);
  await assert.rejects(recoverOnSiteCheckout(input, { ...ports, authorize: async () => null }), /checkout_unauthorized/); assert.equal(calls, 1);
  assert.equal(await recoverOnSiteCheckout(input, { ...ports, call: async () => ({ data: null, error: null }) }), null);
  let checks = 0;
  await assert.rejects(recoverOnSiteCheckout(input, { ...ports, authorize: async () => ++checks < 3 ? principal : { ...principal, accountId: "50010106" } }), /checkout_identity_changed/);
  await assert.rejects(recoverOnSiteCheckout(input, { ...ports, call: async () => { throw new Error("lost read"); } }), /checkout_unavailable/);
});
