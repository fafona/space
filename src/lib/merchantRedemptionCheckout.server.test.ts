import assert from "node:assert/strict";
import test from "node:test";
import { ackMerchantRedemptionCheckout, cancelMerchantRedemptionCheckout, commitMerchantRedemptionCheckout,
  getMerchantRedemptionCheckout, stageMerchantRedemptionCheckout } from "./merchantRedemptionCheckout.server";
import { isMerchantRedemptionCheckoutReceipt, summarizeMerchantRedemptionCheckout,
  type MerchantRedemptionCheckoutContext, type MerchantRedemptionCheckoutReceipt } from "./merchantRedemptionCheckout";
import type { MerchantTransactionClient } from "./merchantOrderMembershipTransaction.server";

const SITE = "10000000";
const OPERATOR = "employee:synthetic";
const stamp = "2026-09-08T10:00:00.000Z";
function fixture() {
  const receipt: MerchantRedemptionCheckoutReceipt = { version: 1, siteId: SITE, operationId: "checkout-1", membershipId: "member-1",
    transactionId: "transaction-1", createdAt: stamp, beforePointBalance: 100, afterPointBalance: 80,
    totalQuantity: 1, grossPoints: 20, couponPointDiscountTotal: 0, totalPoints: 20, couponCount: 0, note: "",
    lines: [{ code: "item-1", name: "Item", categoryName: "", quantity: 1, unitPoints: 20, subtotalPoints: 20, couponDiscountLabel: "", couponPointDiscount: 0 }] };
  const operation = { id: receipt.operationId, fingerprint: "a".repeat(64), membershipId: "member-1" };
  const context: MerchantRedemptionCheckoutContext = { operationId: receipt.operationId, fingerprint: operation.fingerprint, membershipId: operation.membershipId,
    status: "pending", result: null, createdAt: stamp, acknowledgedAt: null,
    request: { membershipId: "member-1", items: [{ redemptionItemId: "item-1", quantity: 1 }], note: "",
      settingsVersion: stamp, couponVersion: null,
      quote: { totalQuantity: 1, grossPoints: 20, couponPointDiscountTotal: 0, totalPoints: 20, couponCount: 0, lines: receipt.lines } } };
  return { receipt, operation, context };
}

test("checkout lifecycle helpers bind server actor/site and exact operation without direct table fallback", async () => {
  const f = fixture(); const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client: MerchantTransactionClient = { rpc: async (name, args) => { calls.push({ name, args }); return { data: { checkout: f.context } }; } };
  assert.deepEqual(await stageMerchantRedemptionCheckout(client, SITE, OPERATOR, f.operation, f.context.request), f.context);
  assert.deepEqual(await getMerchantRedemptionCheckout(SITE, OPERATOR, undefined, client), f.context);
  f.context.status = "cancelled";
  await cancelMerchantRedemptionCheckout(SITE, OPERATOR, "checkout-1", client);
  f.context.acknowledgedAt = stamp;
  await ackMerchantRedemptionCheckout(SITE, OPERATOR, "checkout-1", client);
  assert.deepEqual(calls.map((call) => call.name), ["faolla_stage_redemption_checkout_v1", "faolla_get_redemption_checkout_v1", "faolla_cancel_redemption_checkout_v1", "faolla_ack_redemption_checkout_v1"]);
  for (const call of calls) { assert.equal(call.args.p_site_id, SITE); assert.equal(call.args.p_operator_id, OPERATOR); }
  assert.equal(calls[1].args.p_operation_id, null);
});

test("missing/malformed contexts are not silently treated as no unresolved checkout", async () => {
  const f = fixture();
  for (const data of [null, {}, { checkout: {} }, { checkout: { ...f.context, operationId: "wrong" } },
    { checkout: { ...f.context, status: "committed", result: null } },
    { checkout: { ...f.context, status: "committed", result: { ...f.receipt, siteId: "other-site" } } }]) {
    await assert.rejects(() => getMerchantRedemptionCheckout(SITE, OPERATOR, "checkout-1", { rpc: async () => ({ data }) }), /merchant_transaction_unavailable/);
  }
  assert.equal(await getMerchantRedemptionCheckout(SITE, OPERATOR, undefined, { rpc: async () => ({ data: { checkout: null } }) }), null);
  await assert.rejects(() => getMerchantRedemptionCheckout(SITE, OPERATOR, undefined, {}), /merchant_transaction_unavailable/);
});

test("ambiguous response loss is sanitized without retry or lifecycle compensation", async () => {
  const f = fixture(); let calls = 0;
  const client: MerchantTransactionClient = { rpc: async () => { calls += 1; throw new Error("private SQL values after COMMIT"); } };
  assert.deepEqual(await commitMerchantRedemptionCheckout(client, SITE, OPERATOR, { operation: f.operation }, f.receipt), { error: "merchant_transaction_unavailable" });
  assert.equal(calls, 1);
  await assert.rejects(() => cancelMerchantRedemptionCheckout(SITE, OPERATOR, f.operation.id, client), /merchant_transaction_unavailable/);
  assert.equal(calls, 2);
});

test("v2 returns the stored authoritative receipt on replay rather than the new attempted amount", async () => {
  const f = fixture();
  const response = await commitMerchantRedemptionCheckout({ rpc: async (name, args) => {
    assert.equal(name, "faolla_commit_redemption_v2"); assert.equal(args.p_operator_id, OPERATOR);
    return { data: { replayed: true, result: f.receipt } };
  } }, SITE, OPERATOR, { operation: f.operation }, { ...f.receipt, afterPointBalance: 5 });
  assert.equal(response.error, null); assert.equal(response.result?.afterPointBalance, 80);
  assert.equal(response.replayed, true);
});

test("invalid or cross-operation v2 receipts fail closed", async () => {
  const f = fixture();
  for (const data of [null, { result: f.receipt }, { replayed: false, result: { ...f.receipt, operationId: "other" } },
    { replayed: false, result: { ...f.receipt, totalPoints: 25 } }]) {
    const response = await commitMerchantRedemptionCheckout({ rpc: async () => ({ data }) }, SITE, OPERATOR, { operation: f.operation }, f.receipt);
    assert.equal(response.error, "merchant_transaction_unavailable");
  }
});

test("receipt validator requires exact safe arithmetic and does not forbid legitimate upgrade gifts", () => {
  const f = fixture(); assert.equal(isMerchantRedemptionCheckoutReceipt(f.receipt), true);
  assert.equal(isMerchantRedemptionCheckoutReceipt({ ...f.receipt, afterPointBalance: 110 }), true);
  for (const patch of [{ totalPoints: -1 }, { totalQuantity: 2 }, { grossPoints: 0 }, { couponPointDiscountTotal: 25 },
    { createdAt: "invalid" }, { beforePointBalance: Number.MAX_SAFE_INTEGER + 1 }, { email: "should-not-leak@example.test" },
    { lines: [{ ...f.receipt.lines[0], unitPoints: 2 }] }]) {
    assert.equal(isMerchantRedemptionCheckoutReceipt({ ...f.receipt, ...patch }), false);
  }
  const summary = summarizeMerchantRedemptionCheckout(f.context);
  assert.equal("request" in summary, false); assert.equal("fingerprint" in summary, false); assert.equal("membershipId" in summary, false);
});
