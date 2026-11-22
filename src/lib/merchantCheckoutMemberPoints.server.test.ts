import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMerchantMembershipRecord } from "./merchantMemberships";
import { normalizeMerchantMembershipSettings } from "./merchantMembershipSettings";
import { prepareMemberCheckoutAvailablePoints, prepareMemberCheckoutPointDebit } from "./merchantMemberships.server";

const siteId = "10909095", accountId = "50010105", userId = "customer-synthetic", now = "2026-11-22T12:00:00.000Z";
function fixture() {
  const settings = normalizeMerchantMembershipSettings(siteId, {
    growthRules: { spendPointGrowth: 0.5, annualRecalculate: false },
    levels: [{ id: "silver", name: "Silver", enabled: true, requiredGrowthValue: 0, benefit: { pointDiscount: "9折", oneTimeGiftPoints: 20, recurringGiftPoints: 30, birthdayGiftPoints: 40 } },
      { id: "gold", name: "Gold", enabled: true, requiredGrowthValue: 100, benefit: { pointDiscount: "8折", oneTimeGiftPoints: 100 } }],
    pointsRules: { birthdayPoints: 10, pointsNeverExpire: false, pointsValidDays: 30 },
  });
  const member = normalizeMerchantMembershipRecord({ id: "member-synthetic", siteId, accountId, userId, status: "active", birthday: "11-22",
    joinedAt: "2026-01-01T12:00:00Z", updatedAt: now, pointBalance: 1000, balanceAmount: 25, growthValue: 50, levelId: "silver", transactions: [
      { id: "recent-credit", type: "recharge", at: "2026-11-20T12:00:00Z", pointDelta: 600, balanceDelta: 25, growthDelta: 0, operatorId: "owner" },
      { id: "expired-credit", type: "recharge", at: "2026-01-01T12:00:00Z", pointDelta: 400, balanceDelta: 0, growthDelta: 50, operatorId: "owner" },
    ] });
  assert.ok(member);
  return { member, settings };
}
const prepare = (f: ReturnType<typeof fixture>, quantity = 2) => prepareMemberCheckoutAvailablePoints({ membership: f.member, settings: f.settings, now, unitPoints: 101, quantity });
function debit(f: ReturnType<typeof fixture>, prepared = prepare(f).membership, points = 182, couponCount = 0) {
  return prepareMemberCheckoutPointDebit({ original: f.member, prepared, settings: f.settings, points, couponCount, accountId, userId, operationKey: "a".repeat(64), now, title: "Synthetic" });
}

test("read-only preparation applies existing expiry, level/recurring/birthday rules without mutating input", () => {
  const f = fixture(), before = structuredClone(f), result = prepare(f);
  assert.deepEqual(f, before);
  assert.equal(result.expiredPoints, 400); assert.equal(result.spendablePoints, 700);
  assert.equal(result.unitPoints, 91); assert.equal(result.grossPoints, 182); // ceil EACH unit, not 181.8 rounded at cart level.
  assert.equal(result.membership.balanceAmount, 25);
  assert.ok(result.membership.transactions.some(t => t.note.includes("[level-recurring:silver:2026-11]")));
  const again = prepareMemberCheckoutAvailablePoints({ membership: result.membership, settings: f.settings, now, unitPoints: 101, quantity: 2 });
  assert.equal(again.spendablePoints, 700); assert.equal(again.expiredPoints, 0);
  assert.deepEqual(again.membership.transactions, result.membership.transactions);
});

test("actual discounted points debit grows level and awards existing one-time benefit exactly once", () => {
  const f = fixture(), prepared = prepare(f).membership, before = structuredClone(prepared), result = debit(f, prepared);
  assert.deepEqual(prepared, before); assert.equal(result.membership.pointBalance, 618); // 700 - 182 + Gold gift 100.
  assert.equal(result.membership.growthValue, 141); assert.equal(result.membership.levelId, "gold");
  const customer = result.mutation.transactions.filter(t => t.operatorId === `customer:${accountId}`);
  assert.equal(customer.length, 1); assert.equal(customer[0].pointDelta, -182); assert.equal(customer[0].growthDelta, 91);
  assert.deepEqual(result.membership.transactions.slice(-f.member.transactions.length), f.member.transactions);
  assert.deepEqual(result.mutation.nextState, { pointBalance: 618, growthValue: 141, levelId: "gold" });
  assert.throws(() => debit(f, result.membership), /checkout_operation_requires_receipt/);
});

test("coupon-only checkout never invents cash paid, point debit or spend growth", () => {
  const f = fixture(), result = debit(f, prepare(f).membership, 0, 1);
  assert.equal(result.membership.pointBalance, 700); assert.equal(result.membership.balanceAmount, 25);
  assert.equal(result.membership.growthValue, 50);
  assert.equal(result.mutation.transactions.some(t => t.operatorId.startsWith("customer:")), false);
  assert.throws(() => debit(f, prepare(f).membership, 0, 0), /checkout_invalid_plan/);
});

test("annual growth recalculates from uncancelled current-year history before selecting the current discount", () => {
  const f = fixture(); f.settings.growthRules.annualRecalculate = true;
  f.member.growthValue = 500; f.member.levelId = "gold";
  f.member.transactions = f.member.transactions.map(t => ({ ...t, at: "2025-01-01T12:00:00Z" }));
  f.member.transactions.unshift({ ...f.member.transactions[0], id: "cancelled-growth", at: now, growthDelta: 1000, status: "cancelled" });
  const result = prepare(f); assert.equal(result.membership.growthValue, 0); assert.equal(result.membership.levelId, "silver");
  assert.equal(result.unitPoints, 91);
});

test("expired or left membership cannot silently create a point payment and wrong ownership/history is rejected", () => {
  const f = fixture(), prepared = prepare(f).membership;
  assert.throws(() => debit(f, prepared, 701), /checkout_insufficient_points/);
  assert.throws(() => debit(f, { ...prepared, accountId: "50010106" }), /checkout_invalid_plan/);
  const altered = structuredClone(prepared); altered.transactions.at(-1)!.pointDelta += 1;
  assert.throws(() => debit(f, altered), /checkout_invalid_plan/);
  f.member.status = "left"; assert.throws(() => prepare(f), /checkout_membership_unavailable/);
});
