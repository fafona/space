import assert from "node:assert/strict";
import test from "node:test";
import { applyMerchantMembershipRedemptionCart, retryMerchantMembershipRedemptionCheckout } from "./merchantMemberships.server";
import { normalizeMerchantMembershipRecord } from "./merchantMemberships";
import { normalizeMerchantMembershipSettings } from "./merchantMembershipSettings";
import { claimMerchantCoupon, createMerchantCoupon } from "./merchantCoupons";
import { prepareMerchantCouponRedemptions } from "./merchantCoupons.server";
import { buildMutationOperationMarker } from "./mutationOperationId";
import type { MerchantRedemptionMutation } from "./merchantRedemptionTransaction.server";
import { buildMerchantRedemptionFingerprint } from "./merchantRedemptionTransaction.server";
import type { MerchantRedemptionCheckoutContext, MerchantRedemptionCheckoutReceipt } from "./merchantRedemptionCheckout";

const SITE = "10000000";
const VERSION = "2026-09-08T09:00:00.000Z";
const NOW = "2026-09-08T10:00:00.000Z";
type Dependencies = NonNullable<Parameters<typeof applyMerchantMembershipRedemptionCart>[1]>;
type Input = Parameters<typeof applyMerchantMembershipRedemptionCart>[0];

function fixture() {
  const member = normalizeMerchantMembershipRecord({
    id: "member-one", siteId: SITE, memberNo: "10000000000001", serial: 1,
    accountId: "account-one", userId: "user-one", email: "one@example.test", status: "active",
    joinedAt: VERSION, updatedAt: VERSION, pointBalance: 100, balanceAmount: 0, growthValue: 0, transactions: [],
  });
  assert.ok(member);
  const settings = normalizeMerchantMembershipSettings(SITE, {
    updatedAt: VERSION,
    redemptionItems: [{ id: "item-one", name: "One", enabled: true, pointsCost: 20, stock: 1 }],
  });
  const coupon = claimMerchantCoupon(createMerchantCoupon({
    id: "coupon-one", siteId: SITE, title: "Ten points", discountType: "points_voucher", discountValue: 10,
    status: "active", totalQuantity: 100, createdAt: VERSION, updatedAt: VERSION,
  }), VERSION, { id: "claim-one", settlementCode: "code-one", accountId: "account-one" });
  const snapshot = { siteId: SITE, memberships: [member], updatedAt: VERSION, existingRowId: "row-one" };
  const events: string[] = [];
  const commits: MerchantRedemptionMutation[] = [];
  const receipt: MerchantRedemptionCheckoutReceipt = {
    version: 1, siteId: SITE, operationId: "checkout-one", membershipId: member.id, transactionId: "transaction-one", createdAt: NOW,
    beforePointBalance: 100, afterPointBalance: 80, totalQuantity: 1, grossPoints: 20, couponPointDiscountTotal: 0,
    totalPoints: 20, couponCount: 0, note: "", lines: [{ code: "item-one", name: "One", categoryName: "", quantity: 1,
      unitPoints: 20, subtotalPoints: 20, couponDiscountLabel: "", couponPointDiscount: 0 }],
  };
  const context: MerchantRedemptionCheckoutContext = {
    operationId: "checkout-one", status: "committed", createdAt: NOW, acknowledgedAt: null, membershipId: member.id,
    fingerprint: buildMerchantRedemptionFingerprint({ siteId: SITE, membershipId: member.id, operatorId: "operator-one", note: "", items: [{
      itemId: "item-one", quantity: 1, customName: "", customCode: "", customPoints: 0, couponId: "", couponClaimId: "",
      couponSettlementCode: "", couponTitle: "", couponDiscountLabel: "",
    }] }),
    request: { membershipId: member.id, items: [{ redemptionItemId: "item-one", quantity: 1 }], note: "", settingsVersion: VERSION,
      couponVersion: null, quote: { totalQuantity: 1, grossPoints: 20, couponPointDiscountTotal: 0, totalPoints: 20, couponCount: 0, lines: receipt.lines } },
    result: receipt,
  };
  const input: Input = {
    siteId: SITE, membershipId: member.id, operationId: "checkout-one", operatorId: "operator-one",
    items: [{ itemId: "item-one", quantity: 1 }],
    assertAuthorizationCurrent: async () => { events.push("authorize"); },
  };
  const dependencies: Dependencies = {
    createClient: () => ({} as ReturnType<NonNullable<Dependencies["createClient"]>>),
    loadMemberships: async () => { events.push("read-members"); return structuredClone(snapshot); },
    loadSettings: async () => { events.push("read-settings"); return structuredClone(settings); },
    getCheckout: async () => { events.push("receipt"); return null; },
    stage: async (_client, _site, _operator, operation, request) => {
      events.push("stage");
      return { ...context, status: "pending", result: null, fingerprint: operation.fingerprint, request };
    },
    prepareCoupons: async (request) => {
      events.push("prepare-coupons");
      assert.equal(request.rejectExistingOperation, true);
      return prepareMerchantCouponRedemptions(request, {
        loadCoupons: async () => ({ siteId: SITE, coupons: [coupon], updatedAt: VERSION, existingRowId: "coupon-row" }),
        now: () => NOW,
      });
    },
    commit: async (_client, site, _operator, mutation, result) => {
      assert.equal(site, SITE); events.push("commit"); commits.push(mutation);
      return { error: null, replayed: false, result };
    },
    mirrorMemberships: async () => { events.push("mirror-members"); },
    mirrorCoupons: async () => { events.push("mirror-coupons"); },
    now: () => NOW,
  };
  return { member, settings, coupon, snapshot, events, commits, input, dependencies, receipt, context };
}
const couponItem = { customName: "Voucher", couponId: "coupon-one", couponClaimId: "claim-one", couponSettlementCode: "code-one" };

test("checkout prepares all three domains, reauthorizes, and commits exactly once before any mirror", async () => {
  const f = fixture();
  f.input.items = [{ itemId: "item-one", quantity: 1 }, couponItem];
  const result = await applyMerchantMembershipRedemptionCart(f.input, f.dependencies);
  assert.equal(result.membership?.pointBalance, 90);
  assert.equal(result.receipt.totalPoints, 10);
  assert.equal(result.receipt.lines[1].couponPointDiscount, 10);
  assert.equal(f.commits.length, 1);
  const mutation = f.commits[0];
  assert.equal(mutation.settings?.expectedUpdatedAt, VERSION);
  assert.equal(mutation.memberships?.expectedUpdatedAt, VERSION);
  assert.equal(mutation.coupons?.expectedUpdatedAt, VERSION);
  assert.equal(mutation.settings?.next.redemptionItems[0].stock, 0);
  assert.equal(mutation.coupons?.next[0].usedCount, 1);
  assert.equal(mutation.memberships?.next[0].pointBalance, 90);
  assert.match(mutation.operation?.fingerprint ?? "", /^[a-f0-9]{64}$/);
  assert.deepEqual(f.events, ["authorize", "read-members", "receipt", "read-settings", "prepare-coupons", "authorize", "stage", "authorize", "commit", "mirror-members", "mirror-coupons"]);
  assert.equal(f.member.pointBalance, 100);
  assert.equal(f.settings.redemptionItems[0].stock, 1);
  assert.equal(f.coupon.usedCount, 0);
});

test("unlimited stock still pins settings version so price/rule edits cannot race a checkout", async () => {
  const f = fixture(); f.settings.redemptionItems[0].stock = null;
  await applyMerchantMembershipRedemptionCart(f.input, f.dependencies);
  assert.equal(f.commits[0].settings?.expectedUpdatedAt, VERSION);
  assert.equal(f.commits[0].settings?.next.redemptionItems[0].stock, null);
  assert.equal(f.commits[0].coupons, undefined);
});

test("long coupon display labels fit the durable quote without changing identity or amounts", async () => {
  const f = fixture();
  f.coupon.displayTitle = "券".repeat(350);
  f.coupon.displayDiscountText = "说明".repeat(200);
  f.input.items = [{ itemId: "item-one", quantity: 1 }, couponItem];
  const result = await applyMerchantMembershipRedemptionCart(f.input, f.dependencies);
  assert.equal(result.receipt.lines[1].name, "券".repeat(200));
  assert.equal(result.receipt.lines[1].couponDiscountLabel, "说明".repeat(100));
  assert.equal(result.receipt.lines[1].code, f.coupon.code);
  assert.equal(result.receipt.totalPoints, 10);
  assert.equal(result.receipt.couponPointDiscountTotal, 10);
  assert.equal(f.commits[0].coupons?.next[0].displayTitle, f.coupon.displayTitle);
});

for (const kind of ["product_voucher", "exchange_voucher"] as const) {
  test(`${kind} records one claim while retaining the authoritative included quantity`, async () => {
    const f = fixture();
    f.coupon.discountType = kind;
    f.coupon.productQuantity = 2;
    f.coupon.exchangeQuantity = 2;
    f.coupon.displayDiscountText = "说明".repeat(200);
    f.input.items = [{ itemId: "item-one", quantity: 1 }, { ...couponItem, quantity: 1 }];
    const result = await applyMerchantMembershipRedemptionCart(f.input, f.dependencies);
    assert.equal(result.receipt.couponCount, 1);
    assert.equal(result.receipt.lines[1].quantity, 1);
    assert.equal(result.receipt.lines[1].couponDiscountLabel.length, 200);
    assert.ok(result.receipt.lines[1].couponDiscountLabel.endsWith(kind === "product_voucher" ? "（1 张券，含 2 件）" : "（1 张券，含 2 次）"));
    assert.equal(result.receipt.totalPoints, 20);
    assert.equal(f.commits[0].coupons?.next[0].usedCount, 1);
  });
}

test("receipt replay reloads committed member without consulting changed price, sold-out stock or expired coupon", async () => {
  const f = fixture();
  let reads = 0;
  f.dependencies.loadMemberships = async () => {
    reads += 1; return { ...f.snapshot, memberships: [{ ...f.member, pointBalance: reads === 1 ? 100 : 80 }] };
  };
  f.dependencies.getCheckout = async () => f.context;
  f.dependencies.loadSettings = async () => { assert.fail("replay must not check sold-out stock"); };
  f.dependencies.prepareCoupons = async () => { assert.fail("replay must not check coupon expiry"); };
  const result = await applyMerchantMembershipRedemptionCart(f.input, f.dependencies);
  assert.equal(result.membership?.pointBalance, 80); assert.equal(reads, 2); assert.equal(f.commits.length, 0);
  assert.deepEqual(result.receipt, f.receipt);
  assert.equal(f.events.includes("mirror-members"), false);
});

test("commit-side replay also reloads member and never mirrors speculative mutations", async () => {
  const f = fixture(); let reads = 0;
  f.dependencies.loadMemberships = async () => ({ ...f.snapshot, memberships: [{ ...f.member, pointBalance: ++reads === 1 ? 100 : 60 }] });
  f.dependencies.commit = async () => ({ error: null, replayed: true, result: f.receipt });
  const result = await applyMerchantMembershipRedemptionCart(f.input, f.dependencies);
  assert.equal(result.membership?.pointBalance, 60); assert.equal(reads, 2);
  assert.equal(result.receipt.afterPointBalance, 80);
  assert.equal(f.events.includes("mirror-members"), false);
});

test("inactive member can confirm an existing receipt but cannot start a new checkout", async () => {
  const f = fixture(); f.member.status = "left";
  f.dependencies.getCheckout = async () => f.context;
  assert.equal((await applyMerchantMembershipRedemptionCart(f.input, f.dependencies)).membership?.status, "left");
  f.dependencies.getCheckout = async () => null;
  await assert.rejects(() => applyMerchantMembershipRedemptionCart(f.input, f.dependencies), /membership_not_active/);
  assert.equal(f.commits.length, 0);
});

for (const error of ["merchant_transaction_unavailable", "merchant_coupons_conflict", "merchant_membership_settings_conflict", "merchant_memberships_conflict"]) {
  test(`failed commit ${error} does not retry, compensate or mirror any domain`, async () => {
    const f = fixture(); let calls = 0;
    f.input.items = [{ itemId: "item-one" }, couponItem];
    f.dependencies.commit = async () => { calls += 1; return { error }; };
    await assert.rejects(() => applyMerchantMembershipRedemptionCart(f.input, f.dependencies), { message: error });
    assert.equal(calls, 1);
    assert.equal(f.events.some((event) => event.startsWith("mirror")), false);
    assert.equal(f.member.pointBalance, 100); assert.equal(f.coupon.usedCount, 0);
  });
}

test("same id with another fingerprint/member is rejected before loading settings or preparing coupons", async () => {
  const f = fixture();
  f.dependencies.getCheckout = async () => { throw new Error("redemption_operation_conflict"); };
  await assert.rejects(() => applyMerchantMembershipRedemptionCart(f.input, f.dependencies), /redemption_operation_conflict/);
  assert.equal(f.events.includes("read-settings"), false); assert.equal(f.commits.length, 0);
});

test("old unverified membership or inventory markers fail closed without adopting a new receipt", async () => {
  for (const domain of ["member", "stock"]) {
    const f = fixture();
    if (domain === "stock") f.settings.redemptionStockOperationIds = [buildMutationOperationMarker("member-redemption-stock", f.input.operationId)];
    else {
      f.member.transactions = [{ id: "old", type: "redeem", status: "completed", at: VERSION, pointDelta: -20,
        balanceDelta: 0, growthDelta: 0, note: buildMutationOperationMarker("member-redemption-checkout", f.input.operationId), operatorId: "operator-one" } as typeof f.member.transactions[number]];
    }
    await assert.rejects(() => applyMerchantMembershipRedemptionCart(f.input, f.dependencies), /redemption_legacy_operation_requires_review/);
    assert.equal(f.commits.length, 0);
  }
});

test("authorization revoked while preparing prevents the atomic commit", async () => {
  const f = fixture(); let checks = 0;
  f.input.assertAuthorizationCurrent = async () => { if (++checks === 2) throw new Error("permission_revoked"); };
  await assert.rejects(() => applyMerchantMembershipRedemptionCart(f.input, f.dependencies), /permission_revoked/);
  assert.equal(checks, 2); assert.equal(f.commits.length, 0);
});

for (const scenario of ["stock", "balance", "quantity", "operation", "conflicting-item", "duplicate-coupon", "voucher-only", "wrong-owner"]) {
  test(`invalid ${scenario} checkout has zero business writes`, async () => {
    const f = fixture();
    if (scenario === "stock") f.settings.redemptionItems[0].stock = 0;
    if (scenario === "balance") f.member.pointBalance = 1;
    if (scenario === "quantity") f.input.items = [{ itemId: "item-one", quantity: 10000 }];
    if (scenario === "operation") f.input.operationId = "a/b";
    if (scenario === "conflicting-item") f.input.items = [{ customName: "Manual", customPoints: 20, customCode: "A" }, { customName: "Manual", customPoints: 20, customCode: "B" }];
    if (scenario === "duplicate-coupon") f.input.items = [{ itemId: "item-one" }, couponItem, couponItem];
    if (scenario === "voucher-only") f.input.items = [couponItem];
    if (scenario === "wrong-owner") { f.member.accountId = "different"; f.input.items = [{ itemId: "item-one" }, couponItem]; }
    await assert.rejects(() => applyMerchantMembershipRedemptionCart(f.input, f.dependencies));
    assert.equal(f.commits.length, 0);
  });
}

test("custom points checkout works with no persisted settings and pins the absent version", async () => {
  const f = fixture();
  f.settings.updatedAt = null;
  f.input.items = [{ customName: "Manual", customPoints: 25, quantity: 2 }];
  assert.equal((await applyMerchantMembershipRedemptionCart(f.input, f.dependencies)).membership?.pointBalance, 50);
  assert.equal(f.commits[0].settings?.expectedUpdatedAt, null);
});

test("restored committed checkout retains original pricing even when member is deleted", async () => {
  const f = fixture();
  f.dependencies.getCheckout = async () => f.context;
  f.dependencies.loadMemberships = async () => null;
  f.dependencies.loadSettings = async () => { assert.fail("committed recovery does not reprice"); };
  const result = await retryMerchantMembershipRedemptionCheckout({ siteId: SITE, operatorId: "operator-one", operationId: "checkout-one" }, f.dependencies);
  assert.equal(result.membership, null); assert.deepEqual(result.receipt, f.receipt); assert.equal(result.replayed, true);
  assert.equal(f.commits.length, 0);
});

test("pending recovery uses the server-stored original cart instead of a new browser cart", async () => {
  const f = fixture(); f.context.status = "pending"; f.context.result = null;
  f.dependencies.getCheckout = async () => f.context;
  const result = await retryMerchantMembershipRedemptionCheckout({ siteId: SITE, operatorId: "operator-one", operationId: "checkout-one" }, f.dependencies);
  assert.equal(result.receipt.totalPoints, 20); assert.equal(f.commits.length, 1);
});

test("pending quote pins refuse changed settings or coupon versions before committing", async () => {
  for (const domain of ["settings", "coupons"]) {
    const f = fixture(); f.context.status = "pending"; f.context.result = null;
    if (domain === "settings") f.context.request.settingsVersion = "2026-01-01T00:00:00.000Z";
    else f.context.request.couponVersion = "2026-01-01T00:00:00.000Z";
    f.dependencies.getCheckout = async () => f.context;
    await assert.rejects(() => retryMerchantMembershipRedemptionCheckout({ siteId: SITE, operatorId: "operator-one", operationId: "checkout-one" }, f.dependencies), /redemption_checkout_quote_changed/);
    assert.equal(f.commits.length, 0);
  }
});

test("cancelled contexts cannot resume and a failed stage never reaches commit", async () => {
  const f = fixture(); f.context.status = "cancelled"; f.context.result = null;
  f.dependencies.getCheckout = async () => f.context;
  await assert.rejects(() => retryMerchantMembershipRedemptionCheckout({ siteId: SITE, operatorId: "operator-one", operationId: "checkout-one" }, f.dependencies), /redemption_checkout_cancelled/);
  f.dependencies.getCheckout = async () => null;
  f.dependencies.stage = async () => { throw new Error("redemption_pending_checkout_exists"); };
  await assert.rejects(() => applyMerchantMembershipRedemptionCart(f.input, f.dependencies), /redemption_pending_checkout_exists/);
  assert.equal(f.commits.length, 0);
});

test("authorization revoked after staging prevents commit but does not delete the recoverable context", async () => {
  const f = fixture(); let checks = 0;
  f.input.assertAuthorizationCurrent = async () => { if (++checks === 3) throw new Error("permission_revoked"); };
  await assert.rejects(() => applyMerchantMembershipRedemptionCart(f.input, f.dependencies), /permission_revoked/);
  assert.equal(f.events.includes("stage"), true); assert.equal(f.commits.length, 0);
});
