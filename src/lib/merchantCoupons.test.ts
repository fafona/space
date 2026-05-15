import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMerchantCouponCode,
  calculateMerchantCouponDiscount,
  createMerchantCoupon,
  getVisibleMerchantCoupons,
  normalizeMerchantCouponRecord,
} from "@/lib/merchantCoupons";

test("buildMerchantCouponCode creates unique uppercase codes", () => {
  assert.equal(buildMerchantCouponCode("summer sale", ["SUMMERSALE"]), "SUMMERSALE2");
  assert.equal(buildMerchantCouponCode("  ", []), "COUPON");
});

test("createMerchantCoupon normalizes threshold and percent coupons", () => {
  const threshold = createMerchantCoupon({
    siteId: "10000000",
    title: "满减券",
    discountType: "threshold_amount_off",
    discountValue: 5,
    minimumAmount: 30,
  });
  assert.equal(threshold.minimumAmount, 30);
  assert.equal(threshold.discountValue, 5);

  const percent = createMerchantCoupon({
    siteId: "10000000",
    title: "折扣券",
    discountType: "percent_off",
    discountValue: 120,
  });
  assert.equal(percent.discountValue, 100);
});

test("calculateMerchantCouponDiscount applies caps and minimums", () => {
  const coupon = createMerchantCoupon({
    siteId: "10000000",
    title: "折扣",
    discountType: "percent_off",
    discountValue: 20,
    minimumAmount: 50,
    maxDiscountAmount: 8,
  });

  assert.deepEqual(calculateMerchantCouponDiscount(coupon, 40, "2026-05-15T00:00:00.000Z"), {
    ok: false,
    discountAmount: 0,
    payableAmount: 40,
    reason: "minimum_not_met",
  });
  assert.deepEqual(calculateMerchantCouponDiscount(coupon, 100, "2026-05-15T00:00:00.000Z"), {
    ok: true,
    discountAmount: 8,
    payableAmount: 92,
    reason: "ok",
  });
});

test("getVisibleMerchantCoupons hides paused, expired, hidden, and exhausted coupons", () => {
  const now = "2026-05-15T00:00:00.000Z";
  const visible = createMerchantCoupon({
    siteId: "10000000",
    title: "可用",
    discountValue: 1,
    expiresAt: "2026-05-16T00:00:00.000Z",
  });
  const rows = [
    visible,
    createMerchantCoupon({ siteId: "10000000", title: "暂停", discountValue: 1, status: "paused" }),
    createMerchantCoupon({ siteId: "10000000", title: "过期", discountValue: 1, expiresAt: "2026-05-14T00:00:00.000Z" }),
    createMerchantCoupon({ siteId: "10000000", title: "隐藏", discountValue: 1, showOnWebsite: false }),
    normalizeMerchantCouponRecord({
      ...createMerchantCoupon({ siteId: "10000000", title: "用完", discountValue: 1, totalQuantity: 2 }),
      usedCount: 2,
    }),
  ];

  assert.deepEqual(
    getVisibleMerchantCoupons(rows.filter(Boolean) as NonNullable<(typeof rows)[number]>[], now).map((item) => item.id),
    [visible.id],
  );
});
