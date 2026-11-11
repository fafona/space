import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  cashierCheckoutBlocksNewSale, cashierCheckoutErrorAfterRecovery, cashierCheckoutPrintReceipt, createCashierCheckoutRequestGuard,
  cashierCheckoutRequestQuantity, cashierCouponQuantityLabel,
  readCashierCheckoutReceipt, readCashierCheckoutSummary, readCashierCheckoutAcknowledgement,
} from "./merchantRedemptionCheckoutRecovery";

const receipt = {
  version: 1, operationId: "original-operation", siteId: "10000000", membershipId: "member-one", transactionId: "transaction-one",
  createdAt: "2026-09-08T10:00:00.000Z", beforePointBalance: 100, afterPointBalance: 20,
  totalQuantity: 1, grossPoints: 90, couponPointDiscountTotal: 10, totalPoints: 80, couponCount: 1, note: "Original note",
  lines: [{ code: "one", name: "Original item", categoryName: "Original category", quantity: 1, unitPoints: 90,
    subtotalPoints: 90, couponDiscountLabel: "10 points", couponPointDiscount: 10 }],
};
const pending = { operationId: receipt.operationId, status: "pending", createdAt: receipt.createdAt, acknowledgedAt: null, result: null };

test("ordinary background checks keep the original checkout gate closed", () => {
  assert.equal(cashierCheckoutBlocksNewSale("checking", null), true);
  assert.equal(cashierCheckoutBlocksNewSale("ready", null), false);
});

test("failed checks and unacknowledged originals still block a new financial operation", () => {
  assert.equal(cashierCheckoutBlocksNewSale("error", null), true);
  for (const status of ["pending", "committed", "cancelled"]) {
    const checkout = readCashierCheckoutSummary({ ok: true, checkout: { ...pending, status, result: status === "committed" ? receipt : null } }, receipt.siteId);
    assert.equal(cashierCheckoutBlocksNewSale("ready", checkout), true);
  }
});

test("an intact pending cart keeps the original cashier layout without a recovery banner or unlocking a new sale", () => {
  const checkout = readCashierCheckoutSummary({ ok: true, checkout: { ...pending, pendingCart: {
    version: 1, siteId: receipt.siteId, operationId: receipt.operationId,
    quote: { totalQuantity: 1, grossPoints: 90, couponPointDiscountTotal: 10, totalPoints: 80, couponCount: 1, lines: receipt.lines },
  } } }, receipt.siteId);
  assert.equal(cashierCheckoutBlocksNewSale("error", checkout), true);
  assert.equal(cashierCheckoutBlocksNewSale("ready", checkout), true);
  assert.doesNotMatch(cashierSource, /待结算原单|原单会员积分|原单待扣积分|继续原单结算|pending-sale-summary/);
});

test("terminal acknowledgement must prove the same original outcome before unlocking the cashier", () => {
  for (const status of ["committed", "cancelled"] as const) {
    const original = readCashierCheckoutSummary({ ok: true, checkout: { ...pending, status, result: status === "committed" ? receipt : null } }, receipt.siteId)!;
    const acknowledged = { ...original, acknowledgedAt: receipt.createdAt };
    assert.equal(cashierCheckoutBlocksNewSale("ready", readCashierCheckoutAcknowledgement({ ok: true, checkout: acknowledged }, receipt.siteId, original)), false);
    for (const checkout of [null, original, { ...acknowledged, operationId: "another-operation" },
      { ...acknowledged, status: "pending" }, { ...acknowledged, status: status === "committed" ? "cancelled" : "committed" }]) {
      assert.throws(() => readCashierCheckoutAcknowledgement({ ok: true, checkout }, receipt.siteId, original));
    }
    if (status === "committed") {
      // A new checkout response carries receipt time; the context itself was
      // staged earlier. Their timestamps are not operation identity.
      assert.doesNotThrow(() => readCashierCheckoutAcknowledgement({ ok: true, checkout: { ...acknowledged, createdAt: "2026-09-08T09:59:00.000Z" } }, receipt.siteId, original));
      assert.throws(() => readCashierCheckoutAcknowledgement({ ok: true, checkout: { ...acknowledged, result: { ...receipt, totalPoints: 79 } } }, receipt.siteId, original));
      const reorderedReceipt = Object.fromEntries(Object.entries(receipt).reverse());
      assert.doesNotThrow(() => readCashierCheckoutAcknowledgement({ ok: true, checkout: { ...acknowledged, result: reorderedReceipt } }, receipt.siteId, original));
    }
    assert.throws(() => readCashierCheckoutAcknowledgement({ ok: false, checkout: acknowledged }, receipt.siteId, original));
  }
  const unfinished = readCashierCheckoutSummary({ ok: true, checkout: pending }, receipt.siteId)!;
  assert.throws(() => readCashierCheckoutAcknowledgement({ ok: true, checkout: { ...pending, status: "cancelled", acknowledgedAt: receipt.createdAt } }, receipt.siteId, unfinished));
});

test("loading or failed recovery and all unacknowledged results block new checkout", () => {
  for (const phase of ["checking", "error"] as const) assert.equal(cashierCheckoutBlocksNewSale(phase, null), true);
  for (const status of ["pending", "committed", "cancelled"]) {
    const value = readCashierCheckoutSummary({ ok: true, checkout: { ...pending, status, result: status === "committed" ? receipt : null } }, receipt.siteId);
    assert.equal(cashierCheckoutBlocksNewSale("ready", value), true);
  }
  assert.equal(cashierCheckoutBlocksNewSale("ready", null), false);
  assert.equal(cashierCheckoutBlocksNewSale("ready", readCashierCheckoutSummary({ ok: true, checkout: {
    ...pending, status: "cancelled", acknowledgedAt: receipt.createdAt,
  } }, receipt.siteId)), false);
});

test("a product or exchange claim containing two items submits one voucher without changing its displayed quantity", () => {
  for (const couponClaimId of ["product-voucher-claim", "exchange-voucher-claim"]) {
    const row = { couponClaimId, quantity: 2 };
    assert.equal(cashierCheckoutRequestQuantity(row), 1);
    assert.deepEqual(row, { couponClaimId, quantity: 2 });
    assert.equal(cashierCouponQuantityLabel(row.quantity), "1 张券（含 2 件）");
  }
  assert.equal(cashierCheckoutRequestQuantity({ quantity: 3 }), 3);
  assert.equal(cashierCheckoutRequestQuantity({ couponClaimId: "", quantity: 5 }), 5);
  assert.equal(cashierCouponQuantityLabel(1), "1 张券");
});

test("committed receipt must be bound to the displayed site and original operation", () => {
  assert.deepEqual(readCashierCheckoutReceipt(receipt, receipt.siteId, receipt.operationId), receipt);
  assert.throws(() => readCashierCheckoutReceipt(receipt, "20000000"));
  assert.throws(() => readCashierCheckoutReceipt(receipt, receipt.siteId, "another-operation"));
  for (const value of [null, {}, { ...receipt, totalPoints: -1 }, { ...receipt, totalPoints: "80" },
    { ...receipt, beforePointBalance: Number.MAX_SAFE_INTEGER + 1 }, { ...receipt, createdAt: "invalid" },
    { ...receipt, lines: [{ ...receipt.lines[0], subtotalPoints: null }] }]) {
    assert.throws(() => readCashierCheckoutReceipt(value, receipt.siteId));
  }
});

test("a verified original terminal result clears its old unknown alert but preserves pending and unrelated errors", () => {
  const message = "暂时无法确认结算结果";
  const failure = { operationId: receipt.operationId, message };
  for (const status of ["committed", "cancelled"]) {
    const checkout = readCashierCheckoutSummary({ ok: true, checkout: {
      ...pending, status, result: status === "committed" ? receipt : null,
    } }, receipt.siteId);
    assert.equal(cashierCheckoutErrorAfterRecovery(message, checkout, failure), "");
    assert.equal(cashierCheckoutErrorAfterRecovery("小票打印失败", checkout, failure), "小票打印失败");
    assert.equal(cashierCheckoutErrorAfterRecovery(message, checkout, { ...failure, operationId: "other-operation" }), message);
  }
  const stillPending = readCashierCheckoutSummary({ ok: true, checkout: pending }, receipt.siteId);
  const quoteError = "原单价格或规则已变化";
  assert.equal(cashierCheckoutErrorAfterRecovery(quoteError, stillPending, { ...failure, message: quoteError }), quoteError);
  assert.equal(cashierCheckoutErrorAfterRecovery(message, null, failure), message);
});

test("malformed recovery cannot be mistaken for an empty active checkout", () => {
  for (const value of [null, {}, { ok: false, checkout: null }, { ok: true },
    { ok: true, checkout: { ...pending, status: "unknown" } },
    { ok: true, checkout: { ...pending, status: "committed" } },
    { ok: true, checkout: { ...pending, acknowledgedAt: receipt.createdAt } }]) {
    assert.throws(() => readCashierCheckoutSummary(value, receipt.siteId));
  }
  assert.equal(readCashierCheckoutSummary({ ok: true, checkout: null }, receipt.siteId), null);
});

test("print conversion only uses original server amounts and time, not a current balance or changed cart", () => {
  const parsed = readCashierCheckoutReceipt(receipt, receipt.siteId);
  const printed = cashierCheckoutPrintReceipt(parsed, { siteName: "Current shop name", memberName: "Member", memberNo: "Redacted number" });
  assert.equal(printed.totalPoints, 80); assert.equal(printed.beforePointBalance, 100); assert.equal(printed.afterPointBalance, 20);
  assert.equal(printed.createdAt.toISOString(), receipt.createdAt); assert.deepEqual(printed.lines, receipt.lines);
  printed.lines[0].name = "Modified preview";
  assert.equal(parsed.lines[0].name, "Original item");
});

test("out-of-order results and prior token/site/API epochs cannot restore another identity's checkout", () => {
  const guard = createCashierCheckoutRequestGuard(); guard.setScope({});
  const first = guard.begin(); const second = guard.begin();
  assert.equal(guard.isCurrent(first), false); assert.equal(guard.isCurrent(second), true);
  guard.setScope({}); assert.equal(guard.isCurrent(second), false);
  const next = guard.begin(); guard.invalidate(); assert.equal(guard.isCurrent(next), false);
});

test("recovery helper never persists financial requests or reads browser storage", () => {
  const source = readFileSync(new URL("./merchantRedemptionCheckoutRecovery.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie/);
});

const cashierSource = readFileSync(new URL("../components/admin/MerchantPointRedemptionCashier.tsx", import.meta.url), "utf8");

test("the normal cashier contains no recovery banner or extra manual acknowledgement step", () => {
  assert.doesNotMatch(cashierSource, /checkout-recovery|aria-label="原结算恢复"|确认并开始下一单|等待确认|正在核对原结算/);
  assert.match(cashierSource, /checkout-inline-status is-error/);
  assert.match(cashierSource, /const checkoutRecoveryBlocksNewSale = !activeCheckoutRecovery \|\| cashierCheckoutBlocksNewSale/);
  assert.match(cashierSource, /!checkoutRecoveryBlocksNewSale &&\s*!checkoutRecoveryBusy/);
});
function section(start: string, end: string) {
  const startIndex = cashierSource.indexOf(start);
  const endIndex = cashierSource.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex);
  return cashierSource.slice(startIndex, endIndex);
}

test("recovery actions send only the original operation ID and never use current cart eligibility", () => {
  const actions = section("async function handleCheckoutRecoveryAction", "async function submitCheckout");
  assert.match(actions, /JSON\.stringify\(\{ siteId: normalizedSiteId, operationId: checkout\.operationId, action \}\)/);
  assert.doesNotMatch(actions, /cartRows|selectedInsight|stock|totalPoints|createClientMutationOperationId|printConfirmedCheckout/);
  assert.match(actions, /acceptConfirmedCheckout\(receipt, payload\.membership \?\? null, scope\)/);
  assert.doesNotMatch(actions, /action === "ack"/);
});

test("background terminal sync never retries or cancels a checkout, and failures stay closed without a retry loop", () => {
  const sync = section("const finishTerminalCheckout = useCallback", "useEffect(() => {\n    const guard = checkoutRecoveryGuardRef.current");
  assert.match(sync, /checkout.status === "pending"/);
  assert.match(sync, /action: "ack"/);
  assert.match(sync, /readCashierCheckoutAcknowledgement\(payload, normalizedSiteId, checkout\)/);
  assert.match(sync, /phase: "error", checkout/);
  assert.match(sync, /isCurrent\(ticket\)/);
  assert.doesNotMatch(sync, /action: "retry"|action: "cancel"|createClientMutationOperationId|printConfirmedCheckout|refreshCheckoutRecovery\(/);
  assert.match(sync, /checkoutMutationRef.current.operationId === checkout.operationId && checkoutPresentedReceiptRef.current !== checkout.operationId/);
});

test("new checkout is recovery-gated and includes preflight mutual exclusion and scoped response checks", () => {
  const submit = section("async function submitCheckout", "useEffect(() => {\n    submitCheckoutRef.current");
  assert.match(submit, /checkoutSubmittingRef\.current \|\| checkoutPreflightRef\.current/);
  assert.match(submit, /if \(checkoutRecoveryBlocksNewSale/);
  assert.match(submit, /checkoutPreflightRef\.current = true/);
  assert.ok(submit.indexOf("await refreshCheckoutRecovery()") < submit.indexOf('requestRedemptionApi("/api/memberships"'));
  assert.match(submit, /checkoutRecoveryGuardRef\.current\.isCurrent\(ticket\)/);
  assert.match(submit, /afterUncertainMutation: true/);
  assert.doesNotMatch(submit, /checkoutMutationRef\.current = \{ fingerprint: "", operationId: "" \}/);
});

test("only the submitted coupon claim quantity is normalized and confirmation distinguishes voucher count from included products", () => {
  const submit = section("async function submitCheckout", "useEffect(() => {\n    submitCheckoutRef.current");
  assert.match(submit, /quantity: cashierCheckoutRequestQuantity\(row\)/);
  assert.match(submit, /couponClaimId: row\.couponClaimId \|\| undefined/);
  assert.match(cashierSource, /每条领取记录为一张券/);
  assert.match(cashierSource, /cashierCouponQuantityLabel\(row\.quantity\)/);
  assert.match(cashierSource, /含券内商品数量/);
  assert.match(cashierSource, /const quantity = getCouponCartQuantity\(coupon\)/);
});

test("verified GET recovery reconciles a tracked mutation alert only after scope and response validation", () => {
  const refresh = section("const refreshCheckoutRecovery = useCallback", "useEffect(() => {\n    const guard = checkoutRecoveryGuardRef.current");
  assert.ok(refresh.indexOf("isCurrent(ticket)") < refresh.indexOf("cashierCheckoutErrorAfterRecovery"));
  assert.ok(refresh.indexOf("readCashierCheckoutSummary") < refresh.indexOf("cashierCheckoutErrorAfterRecovery"));
  assert.match(refresh, /setError\(\(current\) => cashierCheckoutErrorAfterRecovery\(current, checkout, failedMutation\)\)/);
  assert.match(cashierSource, /checkoutRecoveryFailureRef\.current = \{ operationId: checkout\.operationId, message \}/);
  assert.match(cashierSource, /checkoutRecoveryFailureRef\.current = \{ operationId, message \}/);
});

test("success and printing use verified server receipt, while replay never automatically prints", () => {
  const submit = section("async function submitCheckout", "useEffect(() => {\n    submitCheckoutRef.current");
  assert.match(submit, /readCashierCheckoutReceipt\(payload\.receipt, normalizedSiteId, operationId\)/);
  assert.match(submit, /if \(canPrint && !payload\.replayed\) void printConfirmedCheckout/);
  assert.doesNotMatch(submit, /receiptBeforePointBalance|receiptCreatedAt|receiptLines|afterPointBalance: updatedMembership/);
  assert.match(cashierSource, /printConfirmedCheckout\(lastConfirmedReceipt, checkoutScope, true\)/);
  assert.doesNotMatch(cashierSource, /确认并开始下一单/);
});

test("the synthetic browser harness is opt-in and uses no production business client", () => {
  const page = readFileSync(new URL("../app/test-harness/redemption-checkout/page.tsx", import.meta.url), "utf8");
  const client = readFileSync(new URL("../app/test-harness/redemption-checkout/RedemptionCheckoutHarness.tsx", import.meta.url), "utf8");
  assert.match(page, /FAOLLA_ENTERPRISE_E2E_HARNESS !== "enabled-for-local-browser-tests"\) notFound\(\)/);
  assert.doesNotMatch(client, /createServerSupabase|SUPABASE_SERVICE|localStorage|sessionStorage|fetch\(/);
});
