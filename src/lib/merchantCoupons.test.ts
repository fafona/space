import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMerchantCouponCode,
  buildMerchantCouponClaimValidUntil,
  buildMerchantCouponSettlementCode,
  calculateMerchantCouponDiscount,
  claimMerchantCoupon,
  getMerchantCouponDisplayDescription,
  getMerchantCouponDisplayFieldOrder,
  getMerchantCouponDisplayMetaText,
  getMerchantCouponDisplayTitle,
  getContactCardVisibleMerchantCoupons,
  createMerchantCoupon,
  getMerchantCouponDiscountLabel,
  getMerchantCouponRemainingCount,
  getVisibleMerchantCoupons,
  isMerchantCouponDirectRedemptionDiscountType,
  isMerchantCouponDisplayFieldHidden,
  MERCHANT_COUPON_DIRECT_REDEMPTION_DISCOUNT_TYPES,
  merchantCouponRequiresClaimCode,
  merchantCouponRequiresPersonalClaim,
  merchantCouponSupportsUsageScenario,
  normalizeMerchantCouponRecord,
  redeemMerchantCoupon,
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

test("createMerchantCoupon supports voucher coupon types", () => {
  const storedValue = createMerchantCoupon({
    siteId: "10000000",
    title: "储值券",
    discountType: "stored_value",
    discountValue: 20,
  });
  assert.equal(storedValue.discountType, "stored_value");
  assert.equal(getMerchantCouponDiscountLabel(storedValue, "$"), "储值 $20.00");
  assert.deepEqual(calculateMerchantCouponDiscount(storedValue, 50), {
    ok: true,
    discountAmount: 20,
    payableAmount: 30,
    reason: "ok",
  });

  const product = createMerchantCoupon({
    siteId: "10000000",
    title: "商品券",
    discountType: "product_voucher",
  });
  assert.equal(product.discountType, "product_voucher");
  assert.equal(getMerchantCouponDiscountLabel(product), "商品券");
  assert.deepEqual(calculateMerchantCouponDiscount(product, 50), {
    ok: false,
    discountAmount: 0,
    payableAmount: 50,
    reason: "invalid_coupon",
  });

  assert.equal(getMerchantCouponDiscountLabel(createMerchantCoupon({ siteId: "10000000", title: "兑换", discountType: "exchange_voucher" })), "兑换券");
  assert.equal(getMerchantCouponDiscountLabel(createMerchantCoupon({ siteId: "10000000", title: "门票", discountType: "ticket_voucher" })), "门票券");
  const points = createMerchantCoupon({
    siteId: "10000000",
    title: "积分抵扣",
    discountType: "points_voucher",
    discountValue: 30.6,
  });
  assert.equal(points.discountType, "points_voucher");
  assert.equal(points.discountValue, 31);
  assert.equal(getMerchantCouponDiscountLabel(points), "积分券：抵扣 31 积分");
});

test("direct redemption coupon types are limited to point redemption vouchers", () => {
  assert.deepEqual([...MERCHANT_COUPON_DIRECT_REDEMPTION_DISCOUNT_TYPES], [
    "product_voucher",
    "exchange_voucher",
    "ticket_voucher",
    "points_voucher",
  ]);
  assert.equal(isMerchantCouponDirectRedemptionDiscountType("product_voucher"), true);
  assert.equal(isMerchantCouponDirectRedemptionDiscountType("exchange_voucher"), true);
  assert.equal(isMerchantCouponDirectRedemptionDiscountType("ticket_voucher"), true);
  assert.equal(isMerchantCouponDirectRedemptionDiscountType("points_voucher"), true);
  assert.equal(isMerchantCouponDirectRedemptionDiscountType("amount_off"), false);
  assert.equal(isMerchantCouponDirectRedemptionDiscountType("percent_off"), false);
  assert.equal(isMerchantCouponDirectRedemptionDiscountType("threshold_amount_off"), false);
  assert.equal(isMerchantCouponDirectRedemptionDiscountType("stored_value"), false);
});

test("createMerchantCoupon normalizes background image settings", () => {
  const coupon = createMerchantCoupon({
    siteId: "10000000",
    title: "背景券",
    discountValue: 5,
    backgroundImageUrl: " https://example.com/coupon.webp ",
    backgroundImageOpacity: 1.8,
  });

  assert.equal(coupon.backgroundImageUrl, "https://example.com/coupon.webp");
  assert.equal(coupon.backgroundImageOpacity, 1);
});

test("createMerchantCoupon normalizes usage scenarios", () => {
  const defaultCoupon = createMerchantCoupon({
    siteId: "10000000",
    title: "默认场景",
    discountValue: 5,
  });
  assert.deepEqual(defaultCoupon.usageScenarios, ["order_cart"]);

  const checkoutCoupon = createMerchantCoupon({
    siteId: "10000000",
    title: "结算场景",
    discountValue: 5,
    usageScenarios: ["checkout_qr", "checkout_qr", "checkout_barcode"],
  });
  assert.deepEqual(checkoutCoupon.usageScenarios, ["checkout_qr", "checkout_barcode"]);
  assert.equal(merchantCouponSupportsUsageScenario(checkoutCoupon, "checkout_qr"), true);
  assert.equal(merchantCouponSupportsUsageScenario(checkoutCoupon, "order_cart"), false);
  assert.match(buildMerchantCouponSettlementCode(checkoutCoupon, "checkout_qr", 3), /^QR000000/);

  const pointsCoupon = createMerchantCoupon({
    siteId: "10000000",
    title: "积分券",
    discountType: "points_voucher",
    discountValue: 20,
    pointsVoucherMaxPerRedemption: 2.4,
    pointsVoucherMinimumRedeemPoints: 100.4,
    usageScenarios: ["points_redemption", "checkout_qr"],
  });
  assert.equal(merchantCouponSupportsUsageScenario(pointsCoupon, "points_redemption"), true);
  assert.equal(pointsCoupon.pointsVoucherMaxPerRedemption, 2);
  assert.equal(pointsCoupon.pointsVoucherMinimumRedeemPoints, 100);
});

test("createMerchantCoupon normalizes display text and typography", () => {
  const coupon = createMerchantCoupon({
    siteId: "10000000",
    title: "默认标题",
    description: "默认说明",
    discountValue: 5,
    displayTitle: "  展示标题  ",
    displayDescription: "展示说明",
    displayDiscountText: "今日专享",
    displayMetaText: "到店可用",
    displayBoxColors: { discount: "#112233", button: "#000000" },
    displayFieldOrder: ["meta", "title"],
    displayHiddenFields: ["description"],
    contentFontFamily: "Georgia, serif;",
    discountTextColor: "#ff3366",
    discountFontSize: 88,
    titleTextColor: "red",
    titleFontSize: 6,
  });

  assert.equal(getMerchantCouponDisplayTitle(coupon), "展示标题");
  assert.equal(getMerchantCouponDisplayDescription(coupon), "展示说明");
  assert.equal(getMerchantCouponDisplayMetaText(coupon), "到店可用");
  assert.equal(getMerchantCouponDiscountLabel(coupon), "今日专享");
  assert.deepEqual(getMerchantCouponDisplayFieldOrder(coupon), ["meta", "title", "discount", "description", "button"]);
  assert.equal(isMerchantCouponDisplayFieldHidden(coupon, "description"), true);
  assert.equal(isMerchantCouponDisplayFieldHidden(coupon, "title"), false);
  assert.equal(coupon.contentFontFamily, "Georgia, serif");
  assert.equal(coupon.discountTextColor, "#ff3366");
  assert.equal(coupon.displayBoxColors.discount, "#112233");
  assert.equal(coupon.displayBoxColors.button, "#000000");
  assert.equal(coupon.discountFontSize, 72);
  assert.equal(coupon.titleTextColor, "");
  assert.equal(coupon.titleFontSize, 8);
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
  assert.deepEqual(calculateMerchantCouponDiscount(coupon, 100, "2026-05-15T00:00:00.000Z", "checkout_qr"), {
    ok: false,
    discountAmount: 0,
    payableAmount: 100,
    reason: "invalid_coupon",
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

test("coupon remaining and claim count use claimed inventory", () => {
  const coupon = normalizeMerchantCouponRecord({
    ...createMerchantCoupon({
      siteId: "10000000",
      title: "限量",
      discountValue: 1,
      totalQuantity: 2,
    }),
    claimedCount: 1,
  });
  assert.ok(coupon);
  assert.equal(getMerchantCouponRemainingCount(coupon), 1);

  const claimed = claimMerchantCoupon(coupon, "2026-05-15T00:00:00.000Z");
  assert.equal(claimed.claimedCount, 2);
  assert.equal(getMerchantCouponRemainingCount(claimed), 0);
  assert.deepEqual(getVisibleMerchantCoupons([claimed], "2026-05-15T00:00:00.000Z"), []);
  assert.throws(() => claimMerchantCoupon(claimed, "2026-05-15T00:00:00.000Z"), /coupon_not_claimable/);
});

test("claim rules normalize limits, windows, triggers, tasks, and claim events", () => {
  const coupon = createMerchantCoupon({
    siteId: "10000000",
    title: "rule coupon",
    discountValue: 1,
    claimAllowedCodes: [" abc123 "],
    claimPerUserTotalLimit: 3,
    claimPerUserDailyLimit: 1,
    claimDateTimeWindows: ["2026-06-01 09:00 ~ 2026-06-10 22:00"],
    claimDailyTimeWindows: ["09:00 ~ 12:00"],
    claimValidHoursAfterClaim: 24,
    claimMonthlyStockLimit: 30,
    claimWeeklyStockLimit: 10,
    claimDailyStockLimit: 5,
    claimHourlyStockLimit: 2,
    claimBehaviorTriggers: ["favorite_site", "favorite_site", "bad"] as never,
    claimTriggerAmount: 100,
    claimTaskRequirements: ["browse_page", "bad"] as never,
    claimTaskPageUrl: " /promo ",
    claimTaskInviteCount: 2,
  });

  assert.equal(merchantCouponRequiresClaimCode(coupon), true);
  assert.equal(merchantCouponRequiresPersonalClaim(coupon), true);
  assert.deepEqual(coupon.claimAllowedCodes, ["ABC123"]);
  assert.equal(coupon.claimPerUserTotalLimit, 3);
  assert.equal(coupon.claimPerUserDailyLimit, 1);
  assert.deepEqual(coupon.claimBehaviorTriggers, ["favorite_site"]);
  assert.deepEqual(coupon.claimTaskRequirements, ["browse_page"]);
  assert.equal(coupon.claimTaskPageUrl, "/promo");

  const claimed = claimMerchantCoupon(coupon, "2026-06-01T10:00:00.000Z", {
    accountId: "acct_1",
    userId: "user_1",
    email: "USER@EXAMPLE.COM",
    code: "abc123",
  });
  assert.equal(claimed.claimEvents.length, 1);
  assert.equal(claimed.claimEvents[0].accountId, "acct_1");
  assert.equal(claimed.claimEvents[0].email, "user@example.com");
  assert.equal(claimed.claimEvents[0].code, "ABC123");
  assert.equal(claimed.claimEvents[0].validUntil, "2026-06-02T10:00:00.000Z");
  assert.equal(buildMerchantCouponClaimValidUntil(claimed, "2026-06-01T10:00:00.000Z"), "2026-06-02T10:00:00.000Z");
  assert.match(buildMerchantCouponSettlementCode(claimed, "checkout_barcode", 1, "abc123"), /^BAR000000ABC1230001$/);
});

test("redeemMerchantCoupon validates claim state and validity", () => {
  const coupon = createMerchantCoupon({
    siteId: "10000000",
    title: "Redeem",
    discountValue: 5,
    claimValidHoursAfterClaim: 24,
    startsAt: "2026-06-01T00:00:00.000Z",
    expiresAt: "2026-06-30T00:00:00.000Z",
  });
  const claimed = claimMerchantCoupon(coupon, "2026-06-01T10:00:00.000Z", {
    accountId: "acct_1",
    userId: "user_1",
    email: "user@example.com",
    settlementType: "barcode",
    settlementCode: "BAR100000000001",
  });
  const settlementCode = claimed.claimEvents[0].settlementCode;
  const redeemed = redeemMerchantCoupon(claimed, {
    settlementCode,
    operatorId: "merchant@example.com",
    now: "2026-06-01T11:00:00.000Z",
  });

  assert.equal(redeemed.usedCount, 1);
  assert.equal(redeemed.redeemEvents[0].settlementCode, settlementCode);
  assert.throws(() => redeemMerchantCoupon(redeemed, { settlementCode, now: "2026-06-01T12:00:00.000Z" }), /coupon_already_redeemed/);
  assert.throws(() => redeemMerchantCoupon(claimed, { settlementCode, now: "2026-06-03T10:00:00.000Z" }), /coupon_claim_expired/);
  assert.throws(() => redeemMerchantCoupon({ ...claimed, status: "paused" }, { settlementCode, now: "2026-06-01T11:00:00.000Z" }), /coupon_not_active/);
});

test("getContactCardVisibleMerchantCoupons uses contact card visibility flag", () => {
  const now = "2026-05-15T00:00:00.000Z";
  const contactCard = createMerchantCoupon({
    siteId: "10000000",
    title: "联系卡",
    discountValue: 2,
    showOnWebsite: false,
    showOnContactCard: true,
    expiresAt: "2026-05-16T00:00:00.000Z",
  });
  const websiteOnly = createMerchantCoupon({
    siteId: "10000000",
    title: "网站",
    discountValue: 2,
    showOnWebsite: true,
    showOnContactCard: false,
    expiresAt: "2026-05-16T00:00:00.000Z",
  });
  const expired = createMerchantCoupon({
    siteId: "10000000",
    title: "过期",
    discountValue: 2,
    showOnContactCard: true,
    expiresAt: "2026-05-14T00:00:00.000Z",
  });

  assert.deepEqual(
    getContactCardVisibleMerchantCoupons([websiteOnly, contactCard, expired], now).map((item) => item.id),
    [contactCard.id],
  );
});
