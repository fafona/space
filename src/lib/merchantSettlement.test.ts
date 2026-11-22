import assert from "node:assert/strict";
import test from "node:test";
import { summarizeMerchantSettlement as summary, merchantSettlementLabel, formatSettlementMoney,
  type MerchantSettlementSnapshot } from "./merchantSettlement";

const cash = (patch: Partial<Extract<MerchantSettlementSnapshot, { method: "online" | "on_site" }>> = {}): MerchantSettlementSnapshot => ({
  version: 1, method: "online", currency: "eur", closed: false, totalMinor: 10_000, initialDueMinor: 3_000,
  capturedMinor: 0, refundedMinor: 0, refundPendingMinor: 0, paymentPending: false, refundFailed: false, disputed: false, ...patch,
});
const points = (patch: Partial<Extract<MerchantSettlementSnapshot, { method: "points" }>> = {}): MerchantSettlementSnapshot => ({
  version: 1, method: "points", closed: false, totalPoints: 500, debitedPoints: 0, returnedPoints: 0, returnPending: false, ...patch,
});

test("settlement is independent of booking/order lifecycle and does not mutate a snapshot", () => {
  const s = Object.freeze(cash({ capturedMinor: 3_000 }));
  const value = summary(s);
  assert.equal(value.state, "deposit_paid"); assert.equal(value.collectibleMinor, 7_000); assert.equal(value.canPayBalance, true);
  assert.equal("bookingStatus" in value, false); assert.equal("orderStatus" in value, false);
  assert.equal(JSON.stringify(s), JSON.stringify(cash({ capturedMinor: 3_000 })));
});
test("unpaid, processing, deposit and fully paid are distinct", () => {
  for (const [patch, state] of [[{}, "unpaid"], [{ paymentPending: true }, "processing"], [{ capturedMinor: 3_000 }, "deposit_paid"],
    [{ capturedMinor: 10_000 }, "paid"]] as const) assert.equal(summary(cash(patch)).state, state);
  assert.equal(summary(cash({ paymentPending: true })).collectibleMinor, 0);
  assert.equal(summary(cash()).originalUnpaidMinor, 10_000);
  assert.equal(summary(cash()).collectibleMinor, 3_000, "first payment is the configured deposit, not the full principal");
  assert.equal(summary(cash({ initialDueMinor: 10_000 })).collectibleMinor, 10_000);
  assert.equal(summary(cash({ capturedMinor: 10_000 })).canPayBalance, false);
});
test("an underpaid deposit is not shown as paid and cannot silently trigger another charge", () => {
  const s = summary(cash({ capturedMinor: 100 }));
  assert.equal(s.state, "partially_paid"); assert.equal(s.collectibleMinor, 0); assert.equal(s.canPayBalance, false);
});
test("refund, refund failure, dispute and closure never reopen an already collected charge", () => {
  const cases = [
    [{ capturedMinor: 3_000, refundPendingMinor: 3_000 }, "refund_pending"],
    [{ capturedMinor: 3_000, refundedMinor: 1_000 }, "partially_refunded"],
    [{ capturedMinor: 3_000, refundedMinor: 3_000 }, "refunded"],
    [{ capturedMinor: 3_000, refundFailed: true }, "refund_failed"],
    [{ capturedMinor: 3_000, disputed: true }, "disputed"],
    [{ closed: true }, "cancelled"],
  ] as const;
  for (const [patch, state] of cases) {
    const result = summary(cash(patch));
    assert.equal(result.state, state); assert.equal(result.collectibleMinor, 0); assert.equal(result.canPayBalance, false);
  }
  assert.equal(summary(cash({ closed: true, capturedMinor: 3_000 })).collectibleMinor, 0);
});
test("on-site collection is not an online paid flag or permission to charge Stripe", () => {
  assert.equal(summary(cash({ method: "on_site" })).state, "unpaid");
  assert.equal(summary(cash({ method: "on_site", capturedMinor: 3_000 })).canPayBalance, false);
  assert.equal(summary(cash({ method: "on_site", capturedMinor: 10_000 })).state, "paid");
});
test("cash principal and refundable remainder stay bounded", () => {
  for (const patch of [{ totalMinor: 0 }, { totalMinor: 0.1 }, { capturedMinor: 10_001 }, { refundedMinor: 1 },
    { capturedMinor: 100, refundedMinor: 50, refundPendingMinor: 51 }, { initialDueMinor: 0 }, { initialDueMinor: 10_001 },
    { refundFailed: true }, { capturedMinor: NaN }, { totalMinor: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.throws(() => summary(cash(patch)), /settlement_invalid_snapshot/);
  }
});
test("points never become money or an unpaid cash balance", () => {
  const s = summary(points({ debitedPoints: 500 }));
  assert.equal(s.state, "points_redeemed"); assert.equal(s.totalMinor, null); assert.equal(s.capturedMinor, null);
  assert.equal(s.originalUnpaidMinor, null); assert.equal(s.collectibleMinor, 0); assert.equal(s.canPayBalance, false);
});
test("points return has separate pending, partial and complete states", () => {
  for (const [patch, state] of [[{}, "points_due"], [{ debitedPoints: 500, returnPending: true }, "points_return_pending"],
    [{ debitedPoints: 500, returnedPoints: 200 }, "points_partially_returned"], [{ debitedPoints: 500, returnedPoints: 500 }, "points_returned"],
    [{ closed: true }, "cancelled"]] as const) assert.equal(summary(points(patch)).state, state);
});
test("partial debits, fractional points and over-returns are rejected", () => {
  for (const patch of [{ totalPoints: 0 }, { debitedPoints: 1 }, { totalPoints: 0.5 }, { returnedPoints: 1 },
    { debitedPoints: 500, returnedPoints: 501 }, { debitedPoints: 500, returnedPoints: 500, returnPending: true }]) {
    assert.throws(() => summary(points(patch)), /settlement_invalid_snapshot/);
  }
});
test("compact labels and currency formatting cover the Chinese, Spanish and English pilot", () => {
  assert.equal(merchantSettlementLabel("points_redeemed", "es-ES"), "Puntos canjeados");
  assert.equal(merchantSettlementLabel("deposit_paid", "en-GB"), "Deposit paid");
  assert.equal(merchantSettlementLabel("paid", "zh-TW"), "已结清");
  assert.match(formatSettlementMoney(12345, "en-GB"), /123\.45/);
  assert.throws(() => formatSettlementMoney(-1), /settlement_invalid_snapshot/);
});
