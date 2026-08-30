import assert from "node:assert/strict";
import test from "node:test";
import {
  __getMerchantRedemptionCashierSearchRateLimitEntryCountForTests,
  __resetMerchantRedemptionCashierSearchRateLimitsForTests,
  consumeMerchantRedemptionCashierSearchRateLimit,
} from "@/lib/merchantRedemptionCashierSearchRateLimit.server";

test("cashier member search rate limits each employee and site independently", () => {
  __resetMerchantRedemptionCashierSearchRateLimitsForTests();
  const input = { siteId: "10000000", principalKey: "employee:employee-1" };
  for (let index = 0; index < 30; index += 1) {
    assert.equal(consumeMerchantRedemptionCashierSearchRateLimit(input, 1_000).allowed, true);
  }
  const limited = consumeMerchantRedemptionCashierSearchRateLimit(input, 1_000);
  assert.equal(limited.allowed, false);
  assert.equal(limited.retryAfterSeconds, 60);
  assert.equal(
    consumeMerchantRedemptionCashierSearchRateLimit(
      { ...input, principalKey: "employee:employee-2" },
      1_000,
    ).allowed,
    true,
  );
  assert.equal(
    consumeMerchantRedemptionCashierSearchRateLimit(
      { ...input, siteId: "10000001" },
      1_000,
    ).allowed,
    true,
  );
});

test("cashier member search rate limit resets after the fixed window", () => {
  __resetMerchantRedemptionCashierSearchRateLimitsForTests();
  const input = { siteId: "10000000", principalKey: "employee:employee-1" };
  for (let index = 0; index < 31; index += 1) {
    consumeMerchantRedemptionCashierSearchRateLimit(input, 5_000);
  }
  assert.equal(consumeMerchantRedemptionCashierSearchRateLimit(input, 65_000).allowed, true);
});

test("cashier member search rate limit keeps a strict bounded principal cache", () => {
  __resetMerchantRedemptionCashierSearchRateLimitsForTests();
  for (let index = 0; index < 2_001; index += 1) {
    consumeMerchantRedemptionCashierSearchRateLimit(
      { siteId: "10000000", principalKey: `employee:employee-${index}` },
      1_000,
    );
    assert.ok(__getMerchantRedemptionCashierSearchRateLimitEntryCountForTests() <= 2_000);
  }
  assert.equal(__getMerchantRedemptionCashierSearchRateLimitEntryCountForTests(), 2_000);
});
