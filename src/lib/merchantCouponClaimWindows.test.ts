import assert from "node:assert/strict";
import test from "node:test";
import {
  parseMerchantCouponDailyTimeWindow,
  parseMerchantCouponDateTimeWindow,
} from "@/lib/merchantCouponClaimWindows";

test("coupon date-time windows accept all supported separators", () => {
  const expected = parseMerchantCouponDateTimeWindow("2026-07-21 09:00 ~ 2026-07-21 18:00");
  assert.ok(expected);
  assert.deepEqual(
    parseMerchantCouponDateTimeWindow("2026-07-21 09:00 至 2026-07-21 18:00"),
    expected,
  );
  assert.deepEqual(
    parseMerchantCouponDateTimeWindow("2026-07-21 09:00 | 2026-07-21 18:00"),
    expected,
  );
});

test("coupon daily windows validate clock values and overnight ranges", () => {
  assert.deepEqual(parseMerchantCouponDailyTimeWindow("09:30 ~ 18:45"), {
    start: 570,
    end: 1125,
  });
  assert.deepEqual(parseMerchantCouponDailyTimeWindow("22:00 至 02:00"), {
    start: 1320,
    end: 120,
  });
  assert.equal(parseMerchantCouponDailyTimeWindow("25:00 ~ 26:00"), null);
  assert.equal(parseMerchantCouponDailyTimeWindow("09:00 ~ 12:00 ~ 18:00"), null);
});
