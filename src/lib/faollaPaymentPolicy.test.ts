import assert from "node:assert/strict";
import test from "node:test";
import {
  quoteMerchantBalancePayment,
  quoteMerchantInitialPayment,
  resolveFaollaRenewalChoice,
  type FaollaPaymentRuleResult,
} from "./faollaPaymentPolicy";

// Illustrative test amounts/rates only; no approved commercial prices or fees.
const testCommission = { basisPoints: 250 };
function unwrap<T>(result: FaollaPaymentRuleResult<T>): T {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
}

test("full payment quotes the full trusted total", () => {
  assert.deepEqual(unwrap(quoteMerchantInitialPayment(10_000, { mode: "full" }, testCommission)), {
    totalMinor: 10_000, payNowMinor: 10_000, remainingMinor: 0,
    applicationFeeMinor: 250, commissionBasisPoints: 250,
  });
});

test("a merchant can choose a fixed deposit or a percentage deposit", () => {
  const fixed = unwrap(quoteMerchantInitialPayment(10_000, { mode: "deposit_fixed", amountMinor: 2_000 }, testCommission));
  const percentage = unwrap(quoteMerchantInitialPayment(10_000, { mode: "deposit_percent", basisPoints: 3_000 }, testCommission));
  assert.equal(fixed.payNowMinor, 2_000);
  assert.equal(fixed.remainingMinor, 8_000);
  assert.equal(fixed.applicationFeeMinor, 50);
  assert.equal(percentage.payNowMinor, 3_000);
  assert.equal(percentage.remainingMinor, 7_000);
  assert.equal(percentage.applicationFeeMinor, 75);
});

test("a balance payment charges only the unpaid amount, not the whole order", () => {
  const balance = unwrap(quoteMerchantBalancePayment(10_000, 3_000, testCommission));
  assert.equal(balance.payNowMinor, 7_000);
  assert.equal(balance.remainingMinor, 0);
  assert.equal(balance.applicationFeeMinor, 175);
  assert.equal(balance.applicationFeeMinor + 75, 250);
});

test("an unpriced commission blocks quoting; an explicitly approved zero is distinct", () => {
  for (const commission of [null, undefined]) {
    assert.deepEqual(quoteMerchantInitialPayment(100, { mode: "full" }, commission), {
      ok: false, error: "commission_not_configured",
    });
    assert.deepEqual(quoteMerchantBalancePayment(100, 20, commission), {
      ok: false, error: "commission_not_configured",
    });
  }
  assert.equal(unwrap(quoteMerchantInitialPayment(100, { mode: "full" }, { basisPoints: 0 })).applicationFeeMinor, 0);
});

test("invalid commission configurations never become a zero-fee default", () => {
  for (const commission of [{}, [], "2.5", { basisPoints: -1 }, { basisPoints: 2.5 }, { basisPoints: "250" }, { basisPoints: 10_000 }, { basisPoints: NaN }, { basisPoints: Infinity }]) {
    assert.deepEqual(quoteMerchantInitialPayment(100, { mode: "full" }, commission), {
      ok: false, error: "invalid_commission",
    });
  }
});

test("rejects unsafe totals rather than coercing, rounding or clamping them", () => {
  for (const total of [null, undefined, "10000", true, 0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(quoteMerchantInitialPayment(total, { mode: "full" }, testCommission), { ok: false, error: "invalid_total" });
    assert.deepEqual(quoteMerchantBalancePayment(total, 0, testCommission), { ok: false, error: "invalid_total" });
  }
});

test("invalid or unknown policies never fall back to full payment", () => {
  for (const policy of [null, undefined, [], "full", {}, { mode: "deposit" }, { mode: "FULL" }]) {
    assert.deepEqual(quoteMerchantInitialPayment(100, policy, testCommission), { ok: false, error: "invalid_payment_policy" });
  }
});

test("fixed deposits reject missing, negative, fractional and excessive values", () => {
  for (const amountMinor of [undefined, null, 0, -1, 1.2, "20", Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(quoteMerchantInitialPayment(100, { mode: "deposit_fixed", amountMinor }, testCommission), { ok: false, error: "invalid_deposit" });
  }
  assert.deepEqual(quoteMerchantInitialPayment(100, { mode: "deposit_fixed", amountMinor: 101 }, testCommission), { ok: false, error: "deposit_exceeds_total" });
});

test("percentage deposits validate basis points and reject values that round to zero", () => {
  for (const basisPoints of [undefined, null, 0, -1, 1.2, "2000", 10_001, NaN]) {
    assert.deepEqual(quoteMerchantInitialPayment(100, { mode: "deposit_percent", basisPoints }, testCommission), { ok: false, error: "invalid_deposit" });
  }
  assert.deepEqual(quoteMerchantInitialPayment(1, { mode: "deposit_percent", basisPoints: 1 }, testCommission), { ok: false, error: "deposit_rounds_to_zero" });
  assert.equal(unwrap(quoteMerchantInitialPayment(1, { mode: "deposit_percent", basisPoints: 5_000 }, testCommission)).payNowMinor, 1);
});

test("100 percent and a fixed deposit equal to total leave no balance", () => {
  for (const policy of [{ mode: "deposit_percent", basisPoints: 10_000 }, { mode: "deposit_fixed", amountMinor: 10_000 }]) {
    const result = unwrap(quoteMerchantInitialPayment(10_000, policy, testCommission));
    assert.equal(result.payNowMinor, 10_000);
    assert.equal(result.remainingMinor, 0);
  }
});

test("balances reject invalid paid history and never re-charge a fully paid order", () => {
  for (const paid of [-1, 0.5, "20", null, NaN, Infinity, 101]) {
    assert.deepEqual(quoteMerchantBalancePayment(100, paid, testCommission), { ok: false, error: "invalid_paid_amount" });
  }
  assert.deepEqual(quoteMerchantBalancePayment(100, 100, testCommission), { ok: false, error: "nothing_to_pay" });
});

test("integer arithmetic remains exact even when intermediate products exceed safe Numbers", () => {
  const total = Number.MAX_SAFE_INTEGER;
  const result = unwrap(quoteMerchantInitialPayment(total, { mode: "deposit_percent", basisPoints: 3_333 }, { basisPoints: 9_999 }));
  const deposit = (BigInt(total) * BigInt(3_333) + BigInt(5_000)) / BigInt(10_000);
  assert.equal(result.payNowMinor, Number(deposit));
  assert.equal(result.applicationFeeMinor, Number(deposit * BigInt(9_999) / BigInt(10_000)));
  assert.equal(BigInt(result.payNowMinor) + BigInt(result.remainingMinor), BigInt(total));
});

test("small-amount matrix conserves principal and never quotes a fee equal to a charge", () => {
  for (let total = 1; total <= 150; total++) {
    for (const percentage of [1, 100, 250, 2_500, 3_333, 5_000, 9_999, 10_000]) {
      for (const fee of [0, 1, 250, 9_999]) {
        const result = quoteMerchantInitialPayment(total, { mode: "deposit_percent", basisPoints: percentage }, { basisPoints: fee });
        if (!result.ok) {
          assert.equal(result.error, "deposit_rounds_to_zero");
          continue;
        }
        const value = result.value;
        assert.equal(value.payNowMinor + value.remainingMinor, total);
        assert.ok(value.payNowMinor > 0 && value.payNowMinor <= total);
        assert.ok(value.applicationFeeMinor >= 0 && value.applicationFeeMinor < value.payNowMinor);
      }
    }
  }
});

test("no explicit renewal opt-in means one purchase, not a recurring subscription", () => {
  for (const choice of [undefined, null, false]) {
    assert.deepEqual(resolveFaollaRenewalChoice(choice), { ok: true, value: { autoRenew: false, checkoutMode: "payment" } });
  }
  assert.deepEqual(resolveFaollaRenewalChoice(true), { ok: true, value: { autoRenew: true, checkoutMode: "subscription" } });
});

test("truthy strings and numbers are not consent to recurring billing", () => {
  for (const choice of ["false", "true", "", 0, 1, [], {}]) {
    assert.deepEqual(resolveFaollaRenewalChoice(choice), { ok: false, error: "invalid_renewal_choice" });
  }
});

test("quoting does not mutate merchant settings or a previously captured quote", () => {
  const policy = Object.freeze({ mode: "deposit_fixed", amountMinor: 20 });
  const commission = Object.freeze({ basisPoints: 250 });
  const initial = unwrap(quoteMerchantInitialPayment(100, policy, commission));
  quoteMerchantInitialPayment(200, { mode: "full" }, { basisPoints: 500 });
  assert.deepEqual(policy, { mode: "deposit_fixed", amountMinor: 20 });
  assert.deepEqual(commission, { basisPoints: 250 });
  assert.deepEqual(initial, { totalMinor: 100, payNowMinor: 20, remainingMinor: 80, applicationFeeMinor: 0, commissionBasisPoints: 250 });
});
