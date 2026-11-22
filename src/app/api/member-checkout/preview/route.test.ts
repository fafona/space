import assert from "node:assert/strict";
import test from "node:test";
import type { Block, MerchantListPublishedSite } from "@/data/homeBlocks";
import { handleMemberCheckoutPreview, type MemberCheckoutPreviewHttpDependencies } from "./route-handler";
import { previewMemberCheckout, parseMemberCheckoutPreviewRequest, type MemberCheckoutPreviewDependencies, type CheckoutPreviewData } from "@/lib/merchantCheckoutPreview.server";
import { buildCheckoutSourceChoices } from "@/lib/merchantCheckoutSources.server";
import type { ConfiguredCheckoutOffer } from "@/lib/merchantCheckoutConfiguration";
import { buildMerchantBookingRulesSnapshot } from "@/lib/merchantBookingRules";
import { createDefaultMerchantBookingWorkbenchSettings } from "@/lib/merchantBookingWorkbench";
import type { CheckoutAvailabilityMaterial } from "@/lib/merchantCheckoutAvailability.server";
import { normalizeMerchantMembershipSettings } from "@/lib/merchantMembershipSettings";
import { normalizeMerchantMembershipRecord } from "@/lib/merchantMemberships";
import { normalizeMerchantCouponRecord } from "@/lib/merchantCoupons";

const siteId = "10909095", accountId = "50010105", userId = "customer-synthetic", at = "2026-11-22T12:00:00.000Z";
function fixture() {
  const calls: string[] = [], blocks = [{ id: "booking-test", type: "booking", props: { bookingStoreOptions: ["Store"], bookingItemOptions: ["Play"],
    bookingTitleOptions: ["Mx"], bookingTimeSlotRules: [{ timeRange: "10:00-18:00", maxBookings: 1 }] } }] as Block[];
  const source = buildCheckoutSourceChoices({ siteId, siteName: "Synthetic", blocks, catalog: null, allowBooking: true, allowOrder: false })[0];
  const offer: ConfiguredCheckoutOffer = { version: 1, id: "12345678-1234-4234-8234-123456789abc", revision: "87654321-4321-4321-8321-cba987654321",
    siteId, enabled: true, title: "Synthetic appointment", maxQuantity: 5, source: { kind: "booking", blockId: source.blockId, serviceId: "service-test", timeZone: "Europe/Madrid" },
    cash: { currency: "eur", unitAmountMinor: 1000, initialPolicy: { mode: "full" } }, unitPoints: 101, allowOnSite: true, couponReturnOnCancel: true,
    checkoutBinding: { sourceKey: source.key, sourceVersion: source.sourceVersion, viewport: source.viewport, store: source.store, item: source.item,
      stockItemId: null, voucherCouponIds: [], durationMinutes: 60, pointsReturnOnCancel: true, cancellationAdvanceMinutes: 60 } };
  const site = { id: siteId, name: "Synthetic", status: "online", serviceExpiresAt: "2035-01-01T00:00:00Z", permissionConfig: {
    allowBookingBlock: true, allowProductBlock: true, allowOrderManagement: true, allowMembershipManagement: true, allowPointsRedemption: true, allowCouponModule: true,
  } } as unknown as MerchantListPublishedSite;
  const data: CheckoutPreviewData = { catalog: null, coupons: [], settings: normalizeMerchantMembershipSettings(siteId, {
    levels: [{ id: "silver", name: "Silver", enabled: true, requiredGrowthValue: 0, benefit: { pointDiscount: "9折" } }],
  }), memberships: [normalizeMerchantMembershipRecord({ id: "member-private", siteId, accountId, userId, status: "active", joinedAt: at,
    pointBalance: 1000, balanceAmount: 5, growthValue: 0, transactions: [] })!] };
  const booking: NonNullable<CheckoutAvailabilityMaterial["booking"]> = { rules: buildMerchantBookingRulesSnapshot(siteId, blocks, at),
    workbench: { ...createDefaultMerchantBookingWorkbenchSettings(), timeZone: "Europe/Madrid" }, records: [] };
  const user = { id: userId, email_confirmed_at: at };
  const session = { accountId, userId, servicePaused: false, user } as unknown as NonNullable<Awaited<ReturnType<MemberCheckoutPreviewHttpDependencies["session"]>>>;
  const core: MemberCheckoutPreviewDependencies = { enabled: () => true, now: () => new Date(at),
    sites: async () => { calls.push("sites"); return [site]; }, configuration: async () => ({ version: offer.revision, offers: [offer] }),
    published: async () => ({ siteId, blocks, slug: "synthetic", orderManagementEnabled: true }),
    data: async () => { calls.push("data-read"); return data; }, booking: async () => { calls.push("booking-read"); return booking; } };
  const deps: MemberCheckoutPreviewHttpDependencies = { enabled: () => true, session: async () => { calls.push("auth"); return session; },
    preview: input => previewMemberCheckout(input, core) };
  const body = { siteId, offerId: offer.id, offerRevision: offer.revision, quantity: 1, appointmentAt: "2026-11-24T12:00" };
  const request = (value: unknown = body, headers: HeadersInit = {}) => new Request("https://synthetic.faolla.invalid/api/member-checkout/preview", {
    method: "POST", headers: { origin: "https://synthetic.faolla.invalid", "content-type": "application/json", ...headers }, body: JSON.stringify(value) });
  return { calls, blocks, offer, site, data, booking, user, session, core, deps, body, request };
}
test("actual HTTP handler and quote rules use the server's live point discount and never create a reservation or payment", async () => {
  const f = fixture(), before = structuredClone([f.data, f.booking]), response = await handleMemberCheckoutPreview(f.request(), f.deps);
  assert.equal(response.status, 200); const result = await response.json();
  assert.equal(result.quote.totalPoints, 91); assert.equal(result.quote.ownPointBalance, 1000);
  assert.equal(result.quote.reservationCreated, false); assert.equal(result.slot.reserved, false); assert.equal(result.slot.timeZone, "Europe/Madrid");
  assert.deepEqual(result.quote.options.map((option: { method: string }) => option.method), ["points", "on_site"]);
  assert.equal(result.quote.options[0].available, true); assert.deepEqual([f.data, f.booking], before);
  assert.ok(!/member-private|customer-synthetic|50010105|transactions|balanceAmount|principalKey/.test(JSON.stringify(result)));
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(f.calls.filter(call => call === "auth").length, 4);
});
test("real membership balance and point voucher determine the quote; original claim is never consumed by preview", async () => {
  const f = fixture(); f.data.memberships[0].pointBalance = 20;
  const coupon = normalizeMerchantCouponRecord({ id: "coupon-test", siteId, title: "Synthetic", code: "PRIVATE", discountType: "points_voucher", discountValue: 80,
    usageScenarios: ["points_redemption"], createdAt: at, updatedAt: at, claimEvents: [{ id: "claim-test", at, accountId, userId,
      customerName: "Private", email: "private@example.invalid", settlementCode: "PRIVATE-CODE", settlementType: "qr", code: "", validUntil: null }] })!;
  f.data.coupons = [coupon]; const before = structuredClone(f.data);
  const response = await handleMemberCheckoutPreview(f.request({ ...f.body, couponClaims: [{ couponId: coupon.id, claimEventId: "claim-test" }] }), f.deps);
  assert.equal(response.status, 200); const result = await response.json();
  assert.equal(result.quote.options[0].totalPoints, 11); assert.equal(result.quote.options[0].available, true);
  assert.equal(result.quote.coupons.previewOnly, true); assert.deepEqual(f.data, before);
  assert.ok(!/PRIVATE|private@example/.test(JSON.stringify(result)));
});
test("module removal, stopped service and missing authoritative site never fall back to old cached permissions", async () => {
  for (const mode of ["module", "paused", "missing", "duplicate"]) {
    const f = fixture(); if (mode === "module") f.site.permissionConfig!.allowBookingBlock = false;
    if (mode === "paused") f.site.status = "offline";
    if (mode === "missing") f.core.sites = async () => [];
    if (mode === "duplicate") f.core.sites = async () => [f.site, f.site];
    const response = await handleMemberCheckoutPreview(f.request(), f.deps);
    assert.equal(response.status, 403); assert.equal(f.calls.includes("data-read"), false);
  }
});
test("source edits, price revision, invalid slots and unsupported group quantity are not silent quote changes", async () => {
  for (const mode of ["source", "revision", "past", "group"]) {
    const f = fixture(), body = { ...f.body };
    if (mode === "source") f.offer.checkoutBinding.sourceVersion = "a".repeat(64);
    if (mode === "revision") body.offerRevision = f.offer.id;
    if (mode === "past") body.appointmentAt = "2026-11-20T12:00";
    if (mode === "group") body.quantity = 2;
    const response = await handleMemberCheckoutPreview(f.request(body), f.deps); assert.equal(response.status, 409, mode);
  }
});
test("ambiguous membership IDs, left members and foreign member identities cannot enable a point transaction", async () => {
  const ambiguous = fixture(); ambiguous.data.memberships.push({ ...ambiguous.data.memberships[0], id: "duplicate-private" });
  assert.equal((await handleMemberCheckoutPreview(ambiguous.request(), ambiguous.deps)).status, 409);
  for (const change of [{ status: "left" as const }, { accountId: "50010106", userId: "foreign-account" }]) {
    const f = fixture(); Object.assign(f.data.memberships[0], change);
    const response = await handleMemberCheckoutPreview(f.request(), f.deps); assert.equal(response.status, 200);
    assert.equal((await response.json()).quote.options[0].reason, "membership_required");
  }
});
test("account switch during the slow source read suppresses all previous-account balances and coupon choices", async () => {
  const f = fixture(); f.core.data = async () => { f.session.servicePaused = true; return f.data; };
  const response = await handleMemberCheckoutPreview(f.request(), f.deps); assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "checkout_unauthorized" });
});
test("disabled, unverified, paused, business-token and signed-out callers never reach sources", async () => {
  for (const mode of ["off", "unverified", "paused", "business", "signed-out"]) {
    const f = fixture(); if (mode === "off") f.deps.enabled = () => false;
    if (mode === "unverified") f.user.email_confirmed_at = "";
    if (mode === "paused") f.session.servicePaused = true;
    if (mode === "signed-out") f.deps.session = async () => null;
    const response = await handleMemberCheckoutPreview(f.request(undefined, mode === "business" ? { "x-merchant-access-token": "synthetic" } : {}), f.deps);
    assert.equal(response.status, mode === "off" ? 503 : 401); assert.equal(f.calls.includes("sites"), false);
  }
});
test("caller-supplied totals, ownership, slot tickets, invalid dates and oversized/cross-origin bodies are refused", async () => {
  const f = fixture();
  for (const extra of [{ totalPoints: 1 }, { membershipId: "other" }, { paid: true }, { slotKey: "invented" }, { appointmentAt: "2026-02-30T12:00" }]) {
    const response = await handleMemberCheckoutPreview(f.request({ ...f.body, ...extra }), f.deps); assert.equal(response.status, 400);
  }
  assert.equal((await handleMemberCheckoutPreview(f.request({ ...f.body, padding: "x".repeat(5000) }), f.deps)).status, 400);
  assert.equal((await handleMemberCheckoutPreview(f.request(undefined, { origin: "https://foreign.invalid" }), f.deps)).status, 403);
  assert.equal(f.calls.includes("sites"), false);
  assert.throws(() => parseMemberCheckoutPreviewRequest({ ...f.body, quantity: "1" }), /checkout_invalid_selection/);
});
test("private read errors are sanitized and never trigger a write, repair or retry", async () => {
  const f = fixture(); let calls = 0; f.core.data = async () => { calls++; throw new Error("SQL private_email service_role secret"); };
  const response = await handleMemberCheckoutPreview(f.request(), f.deps);
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "checkout_unavailable" }); assert.equal(calls, 1);
});
