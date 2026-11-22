import assert from "node:assert/strict";
import test from "node:test";
import { parseCheckoutPreviewRows } from "./merchantCheckoutPreview.server";
import { normalizeMerchantMembershipSettings } from "./merchantMembershipSettings";
import { normalizeMerchantMembershipRecord } from "./merchantMemberships";
import { normalizeMerchantCouponRecord } from "./merchantCoupons";
const siteId = "10909095", at = "2026-11-22T12:00:00Z";
const row = (prefix: string, blocks: unknown) => ({ slug: `${prefix}:${siteId}`, merchant_id: siteId, blocks });
const member = () => normalizeMerchantMembershipRecord({ id: "member-private", siteId, accountId: "50010105", userId: "customer-synthetic", status: "active",
  pointBalance: 100, balanceAmount: 1, growthValue: 0, joinedAt: at, transactions: [] })!;
const settings = () => normalizeMerchantMembershipSettings(siteId, { redemptionItems: [{ id: "stock-test", name: "Synthetic", enabled: true, pointsCost: 100, stock: 3 }] });

test("read material parser accepts actual saved shapes without changing any original row", () => {
  const rows = [row("__merchant_memberships__", [member()]), row("__merchant_membership_settings__", settings()), row("__merchant_coupons__", [])];
  const before = structuredClone(rows), parsed = parseCheckoutPreviewRows(siteId, rows);
  assert.equal(parsed.memberships[0].pointBalance, 100); assert.equal(parsed.settings!.redemptionItems[0].stock, 3);
  assert.deepEqual(rows, before); assert.deepEqual(parseCheckoutPreviewRows(siteId, []), { catalog: null, settings: null, memberships: [], coupons: [] });
});
test("duplicate/cross-merchant/wrong-slug data is refused instead of merged or silently filtered", () => {
  const own = row("__merchant_memberships__", [member()]);
  for (const rows of [[own, own], [{ ...own, merchant_id: "10909096" }], [{ ...own, slug: "__other__:10909095" }], [{ ...own, blocks: [member(), member()] }]]) {
    assert.throws(() => parseCheckoutPreviewRows(siteId, rows), /checkout_unavailable/);
  }
});
test("missing, negative and malformed stock cannot normalize to unlimited inventory, zero points or enabled merchandise", () => {
  for (const change of [{ stock: undefined }, { stock: -1 }, { stock: "3" }, { pointsCost: "100" }, { enabled: 1 }]) {
    const value = settings(); Object.assign(value.redemptionItems[0], change);
    assert.throws(() => parseCheckoutPreviewRows(siteId, [row("__merchant_membership_settings__", value)]), /checkout_unavailable/);
  }
  const value = settings(); value.redemptionItems[0].stock = null;
  assert.equal(parseCheckoutPreviewRows(siteId, [row("__merchant_membership_settings__", value)]).settings!.redemptionItems[0].stock, null);
});
test("damaged balances and histories cannot silently turn into another member's usable points", () => {
  for (const change of [{ pointBalance: "100" }, { pointBalance: -1 }, { status: "unknown" }, { transactions: [null] }]) {
    assert.throws(() => parseCheckoutPreviewRows(siteId, [row("__merchant_memberships__", [{ ...member(), ...change }])]), /checkout_unavailable/);
  }
});
test("malformed claim history or catalog envelope is not a blank or repaired wallet/catalog", () => {
  const coupon = normalizeMerchantCouponRecord({ id: "coupon-test", siteId, code: "TEST", title: "Synthetic", createdAt: at, updatedAt: at })!;
  for (const blocks of [[{ ...coupon, claimEvents: [null] }], [{ ...coupon, redeemEvents: null }], [coupon, coupon]]) {
    assert.throws(() => parseCheckoutPreviewRows(siteId, [row("__merchant_coupons__", blocks)]), /checkout_unavailable/);
  }
  assert.throws(() => parseCheckoutPreviewRows(siteId, [row("__merchant_catalog__", { kind: "merchant_catalog", siteId: "10909096", catalog: {} })]), /checkout_unavailable/);
});
