import assert from "node:assert/strict";
import test from "node:test";
import { quoteMerchantCheckout, type CheckoutPrincipal, type MerchantCheckoutQuoteRepository, type CheckoutMembership,
  type CheckoutOnlineReadiness } from "./merchantCheckoutQuote.server";
import type { MerchantCheckoutOffer } from "./merchantCheckoutCatalog";
import { normalizeMerchantCouponRecord } from "./merchantCoupons";

const principal: CheckoutPrincipal = { accountId: "50010105", userId: "user-synthetic-1001" };
const id = "12345678-1234-4234-8234-123456789abc", revision = "87654321-4321-4321-8321-cba987654321", now = 1_800_000_000_000;
function setup() {
  const offer: MerchantCheckoutOffer = { version: 1, id, revision, siteId: "10909095", enabled: true, title: "Synthetic session",
    source: { kind: "booking", blockId: "booking-test", serviceId: "service-test", timeZone: "Europe/Madrid" }, maxQuantity: 5,
    cash: { currency: "eur", unitAmountMinor: 10_000, initialPolicy: { mode: "deposit_percent", basisPoints: 3000 } }, unitPoints: 500, allowOnSite: true, couponReturnOnCancel: true };
  const member: CheckoutMembership = { id: "member-synthetic-1", siteId: offer.siteId, ...principal, status: "active", pointBalance: 1500, unitPoints: 500 };
  const readiness: CheckoutOnlineReadiness = { siteId: offer.siteId, connectedAccountId: "acct_synthetic", verifiedAt: now,
    settlementCurrency: "eur",
    chargesEnabled: true, platformFee: { policyId: "synthetic-fee-policy", basisPoints: 250 } };
  const counts = { members: 0, visible: 0, readiness: 0 };
  const pilot = { enabled: true, bookings: true, orders: true, points: true, onlinePayments: true, coupons: false };
  const repository: MerchantCheckoutQuoteRepository = {
    pilot: async () => pilot, offer: async () => offer, sourceVisible: async () => { counts.visible++; return true; },
    availability: async () => ({ available: 5 }), ownMembership: async () => { counts.members++; return member; },
    onlineReadiness: async () => { counts.readiness++; return readiness; },
  };
  const input = { siteId: offer.siteId, selection: { offerId: id, offerRevision: revision, quantity: 2, slotKey: "slot-test" },
    authorize: async (): Promise<CheckoutPrincipal | null> => principal, repository, now: () => now };
  return { input, offer, member, readiness, pilot, counts };
}
test("trusted catalog determines full/point totals, deposit and unpaid remainder; a quote never reserves or debits", async () => {
  const f = setup(), before = structuredClone([f.offer, f.member]);
  const result = await quoteMerchantCheckout(f.input);
  assert.deepEqual(result.options, [
    { method: "online", available: true, payNowMinor: 6000, remainingMinor: 14000, totalPoints: null },
    { method: "points", available: true, payNowMinor: null, remainingMinor: null, totalPoints: 1000 },
    { method: "on_site", available: true, payNowMinor: 0, remainingMinor: 20000, totalPoints: null },
  ]);
  assert.equal(result.ownPointBalance, 1500); assert.equal(result.reservationCreated, false);
  assert.deepEqual([f.offer, f.member], before);
  assert.ok(!/member-synthetic|50010105|acct_synthetic|synthetic-fee-policy|user-synthetic/.test(JSON.stringify(result)));
});
test("guests can preview configured cash payment but cannot pretend to have membership points", async () => {
  const f = setup(); f.input.authorize = async () => null;
  const result = await quoteMerchantCheckout(f.input);
  assert.equal(result.ownPointBalance, null); assert.equal(f.counts.members, 0);
  assert.equal(result.options.find(row => row.method === "points")?.reason, "login_required");
  assert.equal(result.options.find(row => row.method === "online")?.available, true);
});
test("membership ownership uses authenticated IDs, not matching names or email addresses", async () => {
  const mutations = [
    { siteId: "10909096" }, { accountId: "50010106" }, { userId: "someone-else" }, { accountId: "", userId: "" },
    { pointBalance: -1 }, { pointBalance: 2.5 },
  ];
  for (const change of mutations) {
    const f = setup(); Object.assign(f.member, change);
    await assert.rejects(() => quoteMerchantCheckout(f.input), /checkout_membership_scope_mismatch/);
  }
  const f = setup(); f.member.accountId = "";
  assert.equal((await quoteMerchantCheckout(f.input)).options.find(x => x.method === "points")?.available, true);
});
test("a left, missing or insufficient membership never enables a free booking", async () => {
  const f = setup(); f.member.status = "left";
  assert.equal((await quoteMerchantCheckout(f.input)).options.find(x => x.method === "points")?.reason, "membership_required");
  f.input.repository.ownMembership = async () => null;
  assert.equal((await quoteMerchantCheckout(f.input)).options.find(x => x.method === "points")?.reason, "membership_required");
  f.input.repository.ownMembership = async () => ({ ...f.member, status: "active", pointBalance: 999 });
  assert.equal((await quoteMerchantCheckout(f.input)).options.find(x => x.method === "points")?.reason, "insufficient_points");
});
test("pilot and module gates fail closed without changing legacy functionality", async () => {
  const f = setup(); f.pilot.enabled = false;
  await assert.rejects(() => quoteMerchantCheckout(f.input), /checkout_disabled/); assert.equal(f.counts.visible, 0);
  f.pilot.enabled = true; f.pilot.bookings = false;
  await assert.rejects(() => quoteMerchantCheckout(f.input), /checkout_module_unavailable/);
  f.pilot.bookings = true; f.pilot.points = false;
  const r = await quoteMerchantCheckout(f.input);
  assert.equal(r.options.find(x => x.method === "points")?.reason, "module_unavailable"); assert.equal(f.counts.members, 0);
});
test("unpublished, wrong-merchant, changed-price and sold-out offers do not produce usable quotes", async () => {
  const f = setup(); f.input.repository.sourceVisible = async () => false;
  await assert.rejects(() => quoteMerchantCheckout(f.input), /checkout_offer_not_found/);
  f.input.repository.sourceVisible = async () => true; f.offer.siteId = "10909096";
  await assert.rejects(() => quoteMerchantCheckout(f.input), /checkout_offer_not_found/);
  f.offer.siteId = "10909095"; f.offer.revision = id;
  await assert.rejects(() => quoteMerchantCheckout(f.input), /checkout_quote_changed/);
  f.offer.revision = revision; f.input.repository.availability = async () => ({ available: 1 });
  await assert.rejects(() => quoteMerchantCheckout(f.input), /checkout_quantity_unavailable/);
});
test("unready/stale merchant accounts and unapproved fees disable cash, not points or on-site", async () => {
  for (const change of [{ siteId: "10909096" }, { verifiedAt: now - 300_001 }, { verifiedAt: now + 1 }, { chargesEnabled: false }, { connectedAccountId: "" }, { settlementCurrency: "usd" }]) {
    const f = setup(); Object.assign(f.readiness, change);
    const r = await quoteMerchantCheckout(f.input);
    assert.equal(r.options.find(x => x.method === "online")?.reason, "merchant_payments_unavailable");
    assert.equal(r.options.find(x => x.method === "points")?.available, true);
  }
  const f = setup(); f.readiness.platformFee = null;
  assert.equal((await quoteMerchantCheckout(f.input)).options[0].reason, "commission_not_configured");
  f.readiness.platformFee = { policyId: "synthetic-approved-zero", basisPoints: 0 };
  assert.equal((await quoteMerchantCheckout(f.input)).options[0].available, true);
});
test("a tiny deposit is disabled rather than silently increased or switched to full payment", async () => {
  const f = setup(); f.offer.cash = { currency: "eur", unitAmountMinor: 100, initialPolicy: { mode: "deposit_fixed", amountMinor: 20 } };
  const r = await quoteMerchantCheckout(f.input);
  assert.equal(r.options[0].reason, "amount_below_minimum"); assert.equal(r.options[0].payNowMinor, 20);
});
test("changing identity while a quote loads does not expose the previous account's point balance", async () => {
  const f = setup(); let attempts = 0;
  f.input.authorize = async () => ++attempts === 1 ? principal : { ...principal, accountId: "50010106" };
  await assert.rejects(() => quoteMerchantCheckout(f.input), /checkout_identity_changed/);
});
test("no merchant credential, provider object or SQL error is exposed from a repository failure", async () => {
  const f = setup(); f.input.repository.offer = async () => { throw new Error("SQL SELECT private_customer_email test_secret"); };
  await assert.rejects(() => quoteMerchantCheckout(f.input), { message: "checkout_unavailable" });
});

test("Stripe is not a prerequisite: disabled/unset online pilot makes no readiness call", async () => {
  const f = setup(); f.pilot.onlinePayments = false;
  f.input.repository.onlineReadiness = async () => { throw new Error("must not contact a payment provider"); };
  const quote = await quoteMerchantCheckout(f.input);
  assert.deepEqual(quote.options.map(row => row.method), ["points", "on_site"]);
  assert.equal(quote.options.every(row => row.available), true);
});

function withCoupon(type: "points_voucher" | "amount_off" | "exchange_voucher" = "points_voucher") {
  const f = setup(); f.pilot.onlinePayments = false; f.pilot.coupons = true;
  const at = new Date(now).toISOString();
  const coupon = normalizeMerchantCouponRecord({ id: "coupon-test", code: "TEST", siteId: f.offer.siteId,
    title: "Synthetic member coupon", discountType: type, discountValue: type === "points_voucher" ? 900 : 20,
    exchangeQuantity: 2, usageScenarios: ["order_cart", "points_redemption"],
    claimEvents: [{ id: "claim-test", at, ...principal, email: "private@example.invalid", code: "", customerName: "Private",
      settlementType: "qr", settlementCode: "PRIVATE-CODE", validUntil: null }], createdAt: at, updatedAt: at })!;
  f.input.repository.coupons = async () => ({ rows: [coupon], tags: [], voucherCouponIds: [coupon.id] });
  const selection = { ...f.input.selection, couponClaims: [{ couponId: coupon.id, claimEventId: "claim-test" }] };
  return { ...f, coupon, selection };
}

test("points coupon reduces the actual points preview before balance check, never the cash amount", async () => {
  const f = withCoupon(); f.member.pointBalance = 100;
  const result = await quoteMerchantCheckout({ ...f.input, selection: f.selection });
  const points = result.options.find(row => row.method === "points")!;
  assert.equal(points.totalPoints, 100); assert.equal(points.available, true); assert.equal(points.couponDiscountPoints, 900);
  assert.equal(result.cashTotalMinor, 20000); assert.equal(result.options.find(row => row.method === "on_site")?.reason, "coupon_not_applicable");
  assert.equal(result.coupons?.previewOnly, true); assert.equal(result.coupons?.selected.length, 1);
  assert.ok(!/PRIVATE-CODE|private@example|claimEvents|redeemEvents/.test(JSON.stringify(result)));
});

test("member-level per-unit discount precedes point coupons and the same price drives the balance check", async () => {
  const f = withCoupon(); f.member.unitPoints = 450; f.member.pointBalance = 800; f.coupon.discountValue = 100;
  f.input.repository.ownMembership = async (site, p, offer) => {
    assert.equal(site, f.offer.siteId); assert.deepEqual(p, principal); assert.deepEqual(offer, f.offer); return f.member;
  };
  const quote = await quoteMerchantCheckout({ ...f.input, selection: f.selection });
  assert.equal(quote.totalPoints, 900); assert.equal(quote.ownPointBalance, 800);
  assert.equal(quote.options.find(row => row.method === "points")?.totalPoints, 800);
  assert.equal(quote.options.find(row => row.method === "points")?.available, true); assert.equal(quote.cashTotalMinor, 20000);
  for (const invalid of [null, 0, 501, 1.5, Number.NaN]) {
    f.member.unitPoints = invalid; await assert.rejects(() => quoteMerchantCheckout(f.input), /checkout_membership_pricing_unavailable/);
  }
});

test("amount coupon reduces on-site due; points-only collection cannot silently ignore it", async () => {
  const f = withCoupon("amount_off");
  const result = await quoteMerchantCheckout({ ...f.input, selection: f.selection });
  assert.equal(result.options.find(row => row.method === "on_site")?.remainingMinor, 18000);
  assert.equal(result.options.find(row => row.method === "points")?.reason, "coupon_not_applicable");
  assert.equal(result.totalPoints, 1000);
});

test("fully covered service previews zero points without pretending the service is completed", async () => {
  const f = withCoupon("exchange_voucher");
  const result = await quoteMerchantCheckout({ ...f.input, selection: f.selection });
  assert.equal(result.options.find(row => row.method === "points")?.totalPoints, 0);
  assert.equal(result.reservationCreated, false); assert.equal(result.coupons?.previewOnly, true);
  assert.equal("bookingStatus" in result, false);
});

test("coupon inventory requires an active own membership, including for cash-only items", async () => {
  const f = withCoupon("amount_off"); f.offer.unitPoints = null;
  const result = await quoteMerchantCheckout({ ...f.input, selection: f.selection });
  assert.equal(result.options[0].remainingMinor, 18000); assert.equal(f.counts.members, 1);
  f.member.status = "left";
  await assert.rejects(() => quoteMerchantCheckout({ ...f.input, selection: f.selection }), /checkout_coupon_unavailable/);
});

test("stolen, used, unapproved and incompatible coupon selections fail instead of disappearing from a charge", async () => {
  for (const mode of ["foreign", "used", "module", "binding"] as const) {
    const f = withCoupon(mode === "binding" ? "exchange_voucher" : "points_voucher");
    if (mode === "foreign") f.coupon.claimEvents[0].accountId = "50010106";
    if (mode === "used") f.coupon.redeemEvents.push({ id: "used-test", at: new Date(now).toISOString(), claimEventId: "claim-test",
      settlementCode: "PRIVATE-CODE", accountId: principal.accountId, userId: principal.userId, operatorId: "merchant", note: "" });
    if (mode === "module") f.pilot.coupons = false;
    if (mode === "binding") f.input.repository.coupons = async () => ({ rows: [f.coupon], tags: [], voucherCouponIds: [] });
    await assert.rejects(() => quoteMerchantCheckout({ ...f.input, selection: f.selection }), /checkout_coupon_unavailable/);
  }
});

test("valid coupon with still-insufficient points shows the shortage rather than allowing a new charge", async () => {
  const f = withCoupon(); f.member.pointBalance = 99;
  const result = await quoteMerchantCheckout({ ...f.input, selection: f.selection });
  assert.equal(result.options.find(row => row.method === "points")?.reason, "insufficient_points");
});

test("coupon return policy must be explicitly configured and is shown from the trusted offer, not browser choice", async () => {
  const f = withCoupon(); delete f.offer.couponReturnOnCancel;
  await assert.rejects(() => quoteMerchantCheckout({ ...f.input, selection: f.selection }), /checkout_coupon_policy_required/);
  assert.equal((await quoteMerchantCheckout(f.input)).coupons?.returnOnCancel, null);
  f.offer.couponReturnOnCancel = false;
  assert.equal((await quoteMerchantCheckout({ ...f.input, selection: f.selection })).coupons?.returnOnCancel, false);
  f.offer.couponReturnOnCancel = true;
  assert.equal((await quoteMerchantCheckout({ ...f.input, selection: f.selection })).coupons?.returnOnCancel, true);
  await assert.rejects(() => quoteMerchantCheckout({ ...f.input, selection: { ...f.selection, couponReturnOnCancel: true } }), /checkout_invalid_selection/);
});
