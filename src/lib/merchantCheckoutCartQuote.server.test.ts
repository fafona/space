import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { cartQuoteFixture } from "../../scripts/fixtures/member-checkout-cart-quote";
import { checkoutCartQuoteIdentity, parseCheckoutCartQuoteRequest, previewCheckoutCart, quoteCheckoutCartSnapshot, type CheckoutCartQuoteRpc } from "./merchantCheckoutCartQuote.server";
import { checkoutSubmissionIdentity, parseCheckoutSubmissionRequest } from "./merchantCheckoutSubmissionPlan.server";
import { parseOnSiteSubmissionRequest } from "./merchantCheckoutOnSiteSubmissionPlan.server";

const quote = (f: ReturnType<typeof cartQuoteFixture>) => quoteCheckoutCartSnapshot(f.refresh(), f.identity(), f.principal);
test("cart selections canonicalize without accepting prices, identity, financial tokens, slots or duplicate offers", () => {
  const f = cartQuoteFixture(), first = f.identity(); f.request.lines.reverse(); assert.equal(f.identity().requestHash, first.requestHash);
  for (const extra of [{ totalPoints: 1 }, { principalKey: "other" }, { customer: {} }, { nonce: randomUUID() }, { confirmationHash: "0".repeat(64) }])
    assert.throws(() => parseCheckoutCartQuoteRequest({ ...f.request, ...extra }));
  for (const extra of [{ unitPrice: 1 }, { appointmentAt: "2099-01-01T12:00" }, { memberId: "other" }, { slotKey: "a".repeat(64) }])
    assert.throws(() => parseCheckoutCartQuoteRequest({ ...f.request, lines: [{ ...f.request.lines[0], ...extra }] }));
  for (const lines of [[], [...f.request.lines, f.request.lines[0]], Array(21).fill(f.request.lines[0]), [{ ...f.request.lines[0], quantity: 0 }], [{ ...f.request.lines[0], quantity: 1000 }],
    f.request.lines.map(line => ({ ...line, quantity: 500 }))]) assert.throws(() => parseCheckoutCartQuoteRequest({ ...f.request, lines }));
  assert.throws(() => parseCheckoutCartQuoteRequest({ ...f.request, method: "online" }));
  assert.notEqual(checkoutCartQuoteIdentity(f.request, { ...f.principal, accountId: "50010106" }).requestHash, first.requestHash);
});
test("two product points quote totals the cart, leaves every input byte unchanged, and is explicitly not submittable", async () => {
  const f = cartQuoteFixture(), before = structuredClone(f.snapshot), q = await quote(f);
  assert.equal(q.duePoints, 200); assert.equal(q.grossPoints, 200); assert.equal(q.ownPointBalance, 1000); assert.equal(q.methodAvailable, true);
  assert.equal(q.quantity, 2); assert.equal(q.canSubmit, false); assert.equal(q.previewOnly, true); assert.equal(q.capturedMinor, 0); assert.equal(q.reservationCreated, false);
  assert.equal(q.dueMinor, null); assert.equal(q.currency, null); assert.deepEqual(f.snapshot, before);
  assert.ok(!/private-cart|PRIVATE|example.invalid|sourceRows|domainRows|principalKey|requestHash|stock-|cart-synthetic/.test(JSON.stringify(q)));
  assert.equal("confirmationHash" in q, false); assert.equal("operationKey" in q, false);
  assert.throws(() => parseCheckoutSubmissionRequest(q)); assert.throws(() => parseOnSiteSubmissionRequest(q));
});
test("twenty lines are bounded and supported without creating any order, hold, coupon use or debit", async () => {
  const f = cartQuoteFixture("points", 20); f.member.pointBalance = 3000; const q = await quote(f);
  assert.equal(q.lines.length, 20); assert.equal(q.duePoints, 2000); assert.equal(q.methodAvailable, true);
});
test("individually affordable lines cannot overspend the shared balance", async () => {
  const f = cartQuoteFixture(); f.member.pointBalance = 150; const q = await quote(f);
  assert.equal(q.duePoints, 200); assert.equal(q.methodAvailable, false); assert.equal(q.reason, "insufficient_points");
  assert.equal(f.member.pointBalance, 150); assert.deepEqual(f.member.transactions, []);
});
test("read-only birthday preparation is counted once for the shared balance, not awarded per cart line", async () => {
  const f = cartQuoteFixture(); f.member.pointBalance = 50; f.settings.pointsRules.birthdayPoints = 200;
  const now = new Date(f.snapshot.databaseNow);
  f.member.birthday = `2000-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const q = await quote(f); assert.equal(q.ownPointBalance, 250); assert.equal(q.duePoints, 200); assert.equal(q.methodAvailable, true);
  assert.equal(f.member.pointBalance, 50); assert.deepEqual(f.member.transactions, []);
});
test("shared stock pools are aggregated, not counted independently for each product", async () => {
  const f = cartQuoteFixture(); f.offers[1].checkoutBinding.stockItemId = "stock-0"; f.settings.redemptionItems[0].stock = 1;
  await assert.rejects(quote(f), /checkout_quantity_unavailable/);
  f.settings.redemptionItems[0].stock = 2; assert.equal((await quote(f)).quantity, 2);
  f.settings.redemptionItems[0].stock = null; f.request.lines.forEach(line => line.quantity = 3); assert.equal((await quote(f)).quantity, 6);
});
test("a repeated wallet claim across products is rejected before doing any quote work", async () => {
  const f = cartQuoteFixture(), claim = { couponId: f.coupons[0].id, claimEventId: f.coupons[0].claimEvents[0].id };
  f.request.lines.forEach(line => line.couponClaims = [claim]); assert.throws(() => f.identity(), /checkout_cart_coupon_reused/);
});
test("points vouchers apply to selected lines once and enforce the per-redemption maximum across the WHOLE cart", async () => {
  const f = cartQuoteFixture(); f.request.lines.forEach((line, i) => line.couponClaims = [{ couponId: f.coupons[i].id, claimEventId: f.coupons[i].claimEvents[0].id }]);
  const q = await quote(f); assert.equal(q.duePoints, 160); assert.equal(q.discountPoints, 40); assert.equal(q.couponCount, 2);
  f.coupons[0].pointsVoucherMaxPerRedemption = 1; await assert.rejects(quote(f), /checkout_coupon_stack_not_allowed/);
  f.coupons[0].pointsVoucherMaxPerRedemption = 2; assert.equal((await quote(f)).duePoints, 160);
});
test("cash quote has integer EUR totals and zero captured amount, without touching point balances or benefits", async () => {
  const f = cartQuoteFixture("on_site"); f.site.permissionConfig!.allowPointsRedemption = false; f.snapshot.sourceRows[0].blocks = f.root();
  f.offers.forEach(offer => offer.unitPoints = null); f.member.pointBalance = 0;
  f.request.lines[0].couponClaims = [{ couponId: f.coupons[0].id, claimEventId: f.coupons[0].claimEvents[0].id }];
  f.refresh(); const before = structuredClone(f.snapshot), q = await quote(f);
  assert.equal(q.grossMinor, 2500); assert.equal(q.discountMinor, 200); assert.equal(q.dueMinor, 2300); assert.equal(q.currency, "eur");
  assert.equal(q.duePoints, null); assert.equal(q.ownPointBalance, null); assert.equal(q.capturedMinor, 0); assert.deepEqual(f.snapshot, before);
});
test("do not silently introduce stacking of two cash coupons across different lines", async () => {
  const f = cartQuoteFixture("on_site"); f.request.lines.forEach((line, i) => line.couponClaims = [{ couponId: f.coupons[i].id, claimEventId: f.coupons[i].claimEvents[0].id }]);
  await assert.rejects(quote(f), /checkout_coupon_stack_not_allowed/);
});
test("cash coupon threshold is checked against its allocated line, not an invented whole-cart threshold", async () => {
  const f = cartQuoteFixture("on_site"); f.coupons[0].minimumAmount = 20;
  f.request.lines[0].couponClaims = [{ couponId: f.coupons[0].id, claimEventId: f.coupons[0].claimEvents[0].id }];
  await assert.rejects(quote(f), /checkout_coupon_unavailable/);
});
test("raw coupon integrity is order-independent for JSONB fields but rejects repaired rules and foreign ownership", async () => {
  const f = cartQuoteFixture(); f.request.lines[0].couponClaims = [{ couponId: f.coupons[0].id, claimEventId: f.coupons[0].claimEvents[0].id }];
  const event = f.coupons[0].claimEvents[0]; f.coupons[0].claimEvents[0] = Object.fromEntries(Object.entries(event).reverse()) as typeof event;
  assert.equal((await quote(f)).duePoints, 180);
  f.coupons[0].claimEvents[0].accountId = "50010106"; await assert.rejects(quote(f), /checkout_coupon_unavailable/);
  f.coupons[0].claimEvents[0] = event;
  (f.coupons[0] as unknown as Record<string, unknown>).pointsVoucherMaxPerRedemption = "0"; await assert.rejects(quote(f), /checkout_coupon_unavailable/);
  f.coupons[0].pointsVoucherMaxPerRedemption = 0;
  (f.coupons[0] as unknown as Record<string, unknown>).pointsVoucherMinimumRedeemPoints = "0"; await assert.rejects(quote(f), /checkout_coupon_unavailable/);
});
test("one invalid or withdrawn line fails the WHOLE quote instead of pricing a partial cart", async () => {
  const f = cartQuoteFixture(); f.offers[1].enabled = false; await assert.rejects(quote(f), /checkout_quote_changed/);
  f.offers[1].enabled = true; f.offers[1].revision = randomUUID(); await assert.rejects(quote(f), /checkout_quote_changed/);
});
test("missing amounts are not free and no method silently falls back to another tender", async () => {
  const f = cartQuoteFixture(); f.offers[1].unitPoints = null; await assert.rejects(quote(f), /checkout_cart_method_unavailable/);
  const cash = cartQuoteFixture("on_site"); cash.offers[1].allowOnSite = false; await assert.rejects(quote(cash), /checkout_cart_method_unavailable/);
});
test("desktop/mobile aliases of one product cannot bypass quantity or coupon limits", async () => {
  const f = cartQuoteFixture(); f.offers[1].source = { ...f.offers[0].source }; f.offers[1].checkoutBinding = { ...f.offers[0].checkoutBinding };
  await assert.rejects(quote(f), /checkout_cart_duplicate_product/);
});
test("snapshot tenant, principal, timestamp, offer set, and raw document scope cannot be substituted", async () => {
  for (const field of ["siteId", "principalKey", "requestHash", "purpose", "databaseNow"]) {
    const f = cartQuoteFixture(); (f.snapshot as unknown as Record<string, unknown>)[field] = "wrong";
    await assert.rejects(quoteCheckoutCartSnapshot(f.snapshot, f.identity(), f.principal));
  }
  const f = cartQuoteFixture(); f.snapshot.domainRows[0].merchant_id = "10909993"; await assert.rejects(quote(f));
  const g = cartQuoteFixture(); g.snapshot.offers.pop(); await assert.rejects(quote(g));
  const h = cartQuoteFixture(); h.snapshot.domainRows[0].slug = `__merchant_orders__:${h.siteId}`; await assert.rejects(quote(h));
});
test("permission loss, service expiry, inactive membership and changed publication all refuse a quote", async () => {
  for (const kind of ["permission", "service", "member", "source"] as const) {
    const f = cartQuoteFixture();
    if (kind === "permission") f.site.permissionConfig!.allowProductBlock = false;
    if (kind === "service") f.site.serviceExpiresAt = "2000-01-01T00:00:00Z";
    if (kind === "member") f.member.status = "left";
    if (kind === "source") f.catalog.products[1].price = "18";
    f.snapshot.sourceRows[0].blocks = f.root(); await assert.rejects(quote(f));
  }
});
test("different line cancellation policies stay distinct and are included in display fingerprint", async () => {
  const f = cartQuoteFixture(); const first = await quote(f);
  f.offers[1].checkoutBinding.pointsReturnOnCancel = false; f.offers[1].couponReturnOnCancel = false;
  const second = await quote(f); assert.notEqual(first.quoteHash, second.quoteHash);
  assert.equal(second.lines.filter(line => line.cancellationPolicy.returnPoints).length, 1);
});
test("totals are bounded across the cart even when each individual offer total is valid", async () => {
  const f = cartQuoteFixture(); f.offers.forEach((offer, i) => { offer.unitPoints = 60_000_000; f.settings.redemptionItems[i].pointsCost = 60_000_000; });
  await assert.rejects(quote(f), /checkout_total_too_large/);
  const cash = cartQuoteFixture("on_site"); cash.offers.forEach((offer, i) => { offer.cash!.unitAmountMinor = 60_000_000; cash.catalog.products[i].price = "600000.00"; });
  // Rebind the synthetic published source revision, rather than bypassing the
  // trusted source/price check just to test the sum limit.
  const { buildCheckoutSourceChoices } = await import("./merchantCheckoutSources.server");
  const sources = buildCheckoutSourceChoices({ siteId: cash.siteId, siteName: "Synthetic", blocks: cash.blocks, catalog: cash.catalog, allowBooking: false, allowOrder: true });
  cash.offers.forEach(offer => { const source = sources.find(s => s.key === offer.checkoutBinding.sourceKey)!; offer.checkoutBinding.sourceVersion = source.sourceVersion; });
  await assert.rejects(quote(cash), /checkout_total_too_large/);
});
test("a mapped product voucher covers only its own product and is neither cash collected nor a second coupon use", async () => {
  const f = cartQuoteFixture(); const coupon = f.coupons[0]; coupon.discountType = "product_voucher"; coupon.usageScenarios = ["points_redemption"]; coupon.productQuantity = 1;
  f.offers[0].checkoutBinding.voucherCouponIds = [coupon.id]; f.request.lines[0].couponClaims = [{ couponId: coupon.id, claimEventId: coupon.claimEvents[0].id }];
  const q = await quote(f); assert.equal(q.duePoints, 100); assert.equal(q.discountPoints, 100); assert.equal(q.couponCount, 1); assert.equal(q.capturedMinor, 0);
  assert.deepEqual(coupon.redeemEvents, []);
});
test("turning the quote pilot off after the read prevents returning the stale result", async () => {
  const f = cartQuoteFixture(); let enabled = true;
  await assert.rejects(previewCheckoutCart({ request: f.request, principal: f.principal, authorize: async () => f.principal, enabled: () => enabled },
    async () => { enabled = false; return { data: f.snapshot, error: null }; }), /checkout_cart_unavailable/);
});
test("the service is default-off and does exactly one raw snapshot RPC, with fresh authentication on return", async () => {
  const f = cartQuoteFixture(); let calls = 0, auth = 0;
  const rpc: CheckoutCartQuoteRpc = async (name, args, signal) => {
    calls++; assert.equal(name, "faolla_member_checkout_cart_quote_snapshot_v1"); assert.ok(signal instanceof AbortSignal);
    assert.equal(args.p_principal_key, f.identity().principalKey); assert.deepEqual(args.p_offer_ids, f.identity().request.lines.map(line => line.offerId));
    return { data: f.snapshot, error: null };
  };
  const input = { request: f.request, principal: f.principal, authorize: async () => { auth++; return f.principal; } };
  await assert.rejects(previewCheckoutCart(input, rpc), /checkout_cart_unavailable/); assert.equal(calls, 0);
  const q = await previewCheckoutCart({ ...input, enabled: () => true }, rpc); assert.equal(q.duePoints, 200); assert.equal(calls, 1); assert.equal(auth, 3);
  assert.throws(() => checkoutSubmissionIdentity(q, f.principal));
});
test("identity loss after the read hides the result and does not retry or dispatch a write", async () => {
  const f = cartQuoteFixture(); let calls = 0;
  await assert.rejects(previewCheckoutCart({ request: f.request, principal: f.principal, enabled: () => true, authorize: async () => calls ? null : f.principal },
    async () => { calls++; return { data: f.snapshot, error: null }; }), /checkout_unauthorized/);
  assert.equal(calls, 1);
});
test("late, aborted, stale and failed reads never return financial data or retry", async () => {
  for (const kind of ["late", "abort", "stale", "future", "error"] as const) {
    const f = cartQuoteFixture(), controller = new AbortController(); let now = Date.parse(f.snapshot.databaseNow), calls = 0;
    await assert.rejects(previewCheckoutCart({ request: f.request, principal: f.principal, enabled: () => true, authorize: async () => f.principal, signal: controller.signal, now: () => now }, async () => {
      calls++; if (kind === "late") now += 13_000; if (kind === "abort") controller.abort();
      if (kind === "stale") f.snapshot.databaseNow = new Date(now - 13_000).toISOString();
      if (kind === "future") f.snapshot.databaseNow = new Date(now + 3_000).toISOString();
      return { data: f.snapshot, error: kind === "error" ? { message: "SQL PRIVATE secret" } : null };
    }), /checkout_cart_unavailable/); assert.equal(calls, 1);
  }
});
test("aborting a never-returning quote read settles the caller, with no lingering mutation path", async () => {
  const f = cartQuoteFixture(), controller = new AbortController(); let started!: () => void;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  const pending = previewCheckoutCart({ request: f.request, principal: f.principal, enabled: () => true, authorize: async () => f.principal, signal: controller.signal },
    async () => { started(); return new Promise(() => {}); });
  await waiting; controller.abort(); await assert.rejects(pending, /checkout_cart_unavailable/);
});
test("proposal is opt-in, invoker/STABLE, uses direct single-snapshot reads, and grants no API execute", async () => {
  const sql = await readFile("database/proposals/20261123_member_checkout_cart_quote.sql", "utf8");
  assert.match(sql, /LANGUAGE plpgsql STABLE/); assert.doesNotMatch(sql, /SECURITY DEFINER|PERFORM .*commit|FOR UPDATE|FOR SHARE/i);
  assert.match(sql, /FROM PUBLIC,anon,authenticated,service_role/); assert.match(sql, /enabled boolean NOT NULL DEFAULT false/);
  assert.doesNotMatch(sql, /submission_rows\(/); assert.doesNotMatch(sql, /INSERT INTO|UPDATE public|DELETE FROM/i);
});
