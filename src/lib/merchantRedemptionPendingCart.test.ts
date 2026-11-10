import assert from "node:assert/strict";
import test from "node:test";
import type { MerchantRedemptionCheckoutContext } from "@/lib/merchantRedemptionCheckout";
import { buildMerchantRedemptionPendingCart, isMerchantRedemptionCheckoutQuote, isMerchantRedemptionPendingCart } from "@/lib/merchantRedemptionPendingCart";
import { cashierCheckoutBlocksNewSale, readCashierCheckoutSummary } from "@/lib/merchantRedemptionCheckoutRecovery";

const site = "10000000", operation = "original-operation";
const context = (): MerchantRedemptionCheckoutContext => ({
  operationId: operation, status: "pending", createdAt: "2026-11-04T00:00:00.000Z", acknowledgedAt: null, result: null,
  fingerprint: "f".repeat(64), membershipId: "PRIVATE-MEMBER",
  request: { membershipId: "PRIVATE-MEMBER", items: [{ couponClaimId: "PRIVATE-CLAIM", couponSettlementCode: "PRIVATE-TOKEN" }],
    note: "PRIVATE-NOTE", settingsVersion: "PRIVATE-VERSION", couponVersion: "PRIVATE-VERSION",
    quote: { totalQuantity: 3, grossPoints: 80, couponPointDiscountTotal: 10, totalPoints: 70, couponCount: 1,
      lines: [{ code: "old-item", name: "已下架的原单商品", categoryName: "原分类", quantity: 2, unitPoints: 40, subtotalPoints: 80, couponDiscountLabel: "", couponPointDiscount: 0 },
        { code: "coupon", name: "积分券", categoryName: "", quantity: 1, unitPoints: 0, subtotalPoints: 0, couponDiscountLabel: "抵扣10积分", couponPointDiscount: 10 }] },
  },
});

test("pending cart retains original server lines and totals, not raw intent or private account data", () => {
  const saved = context(), pending = buildMerchantRedemptionPendingCart(saved, site);
  assert.equal(isMerchantRedemptionPendingCart(pending, site, operation), true);
  assert.deepEqual(pending.quote, saved.request.quote);
  assert.doesNotMatch(JSON.stringify(pending), /PRIVATE-|fingerprint|membershipId|couponClaimId|couponSettlementCode|settingsVersion|note/);
  pending.quote.lines[0].name = "Changed display";
  assert.equal(saved.request.quote.lines[0].name, "已下架的原单商品");
});

test("pending display is actor/site/operation-bound and never unlocks a new checkout", () => {
  const saved = context(), pendingCart = buildMerchantRedemptionPendingCart(saved, site);
  const summary = readCashierCheckoutSummary({ ok: true, checkout: { ...saved, pendingCart } }, site);
  assert.equal(summary?.pendingCart?.quote.totalPoints, 70);
  assert.equal(cashierCheckoutBlocksNewSale("ready", summary), true);
  assert.throws(() => readCashierCheckoutSummary({ ok: true, checkout: { ...saved, pendingCart } }, "20000000"));
  assert.equal(isMerchantRedemptionPendingCart(pendingCart, site, "other-operation"), false);
  assert.equal(isMerchantRedemptionPendingCart({ ...pendingCart, privateNote: "secret" }, site, operation), false);
  assert.throws(() => buildMerchantRedemptionPendingCart({ ...saved, status: "cancelled" }, site));
});

test("the permission-filtered original member heading is validated and cloned, never used as new intent", () => {
  const member = { name: "合成会员", memberNo: "CARD-ONE", pointBalance: 100, balanceAmount: 10.5 };
  const pending = buildMerchantRedemptionPendingCart(context(), site, member);
  assert.equal(isMerchantRedemptionPendingCart(pending, site, operation), true);
  member.name = "Changed";
  assert.equal(pending.member?.name, "合成会员");
  for (const bad of [{ ...member, membershipId: "private" }, { ...member, pointBalance: -1 }, { ...member, balanceAmount: NaN },
    { ...member, balanceAmount: -1 }, { ...member, memberNo: "" }, { ...member, name: "" }]) {
    assert.equal(isMerchantRedemptionPendingCart({ ...pending, member: bad }, site, operation), false);
  }
  assert.equal(buildMerchantRedemptionPendingCart(context(), site, null).member, null);
});

test("malformed lines, totals, unknown fields and unsafe integers cannot be shown as a valid pending cart", () => {
  const good = context().request.quote;
  for (const bad of [null, {}, { ...good, totalPoints: 71 }, { ...good, totalQuantity: 0 }, { ...good, totalPoints: "70" },
    { ...good, totalPoints: Number.MAX_SAFE_INTEGER + 1 }, { ...good, privateToken: "secret" },
    { ...good, lines: [] }, { ...good, lines: [{ ...good.lines[0], quantity: 0 }] },
    { ...good, lines: [{ ...good.lines[0], subtotalPoints: 79 }, good.lines[1]] },
    { ...good, lines: [{ ...good.lines[0], couponSettlementCode: "secret" }, good.lines[1]] },
    { ...good, lines: [{ ...good.lines[0], name: " " }, good.lines[1]] },
  ]) assert.equal(isMerchantRedemptionCheckoutQuote(bad), false);
  assert.equal(isMerchantRedemptionCheckoutQuote(good), true);
});

test("old summary payloads stay recovery-gated and cannot invent a cart from missing quote data", () => {
  const saved = context();
  const summary = readCashierCheckoutSummary({ ok: true, checkout: {
    operationId: saved.operationId, status: saved.status, createdAt: saved.createdAt, acknowledgedAt: null, result: null,
  } }, site);
  assert.equal(summary?.pendingCart, undefined);
  assert.equal(cashierCheckoutBlocksNewSale("ready", summary), true);
  const pendingCart = buildMerchantRedemptionPendingCart(saved, site);
  assert.throws(() => readCashierCheckoutSummary({ ok: true, checkout: { ...saved, status: "cancelled", pendingCart } }, site));
});
