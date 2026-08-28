import assert from "node:assert/strict";
import test from "node:test";
import {
  getMerchantMembershipPatchRequiredPermission,
  getMerchantMembershipSettingsScopePermission,
  isMerchantMembershipSettingsViewAllowedForScope,
  redactMerchantMembershipForCashier,
  redactMerchantMembershipListItem,
  selectMerchantMembershipSettingsForEmployeeScope,
} from "@/lib/merchantMembershipBusinessPermissions";
import { createEmptyMerchantMembershipSettings } from "@/lib/merchantMembershipSettings";
import type { MerchantMembershipListItem } from "@/lib/merchantMemberships";

function membership(): MerchantMembershipListItem {
  return {
    id: "10000000:PII-ACCOUNT",
    siteId: "10000000",
    siteName: "Merchant",
    memberNo: "MEMBER-100",
    serial: 100,
    accountId: "PII-ACCOUNT",
    userId: "PII-USER",
    email: "pii-email@example.test",
    nickname: "PII-NICKNAME",
    name: "PII-NAME",
    phone: "PII-PHONE",
    avatarUrl: "https://example.test/PII-AVATAR",
    birthday: "PII-BIRTHDAY",
    birthdayMonthDayOnly: false,
    gender: "PII-GENDER",
    country: "PII-COUNTRY",
    province: "PII-PROVINCE",
    city: "PII-CITY",
    address: "PII-ADDRESS",
    taxName: "PII-TAX-NAME",
    taxNumber: "PII-TAX-NUMBER",
    taxCountry: "PII-TAX-COUNTRY",
    taxProvince: "PII-TAX-PROVINCE",
    taxCity: "PII-TAX-CITY",
    taxAddress: "PII-TAX-ADDRESS",
    allergens: ["PII-ALLERGEN"],
    pointBalance: 120,
    balanceAmount: 45.5,
    growthValue: 30,
    levelId: "level-vip",
    transactions: [
      {
        id: "transaction-1",
        type: "recharge",
        status: "completed",
        at: "2026-08-28T00:00:00.000Z",
        pointDelta: 120,
        balanceDelta: 45.5,
        growthDelta: 30,
        note: "PII-TRANSACTION-NOTE",
        operatorId: "employee:operator",
        cancelledAt: null,
        cancellationNote: "PII-CANCELLATION-NOTE",
        cancelledBy: "",
        cancellationOperationMarker: "",
        relatedTransactionId: "",
        adjustmentKind: "",
      },
    ],
    status: "active",
    joinedAt: "2026-01-01T00:00:00.000Z",
    leftAt: null,
    updatedAt: "2026-08-28T00:00:00.000Z",
    profileVisible: true,
    insight: {
      pointBalance: 120,
      balanceAmount: 45.5,
      availableCouponCount: 0,
      availableCoupons: [],
      couponHistory: [],
      totalSpendAmount: 200,
      totalOrderCount: 2,
      consumptionFrequencyPerMonth: 1,
      averageOrderAmount: 100,
      recentPurchaseAt: null,
      firstPurchaseAt: null,
      yearlySpendAmount: 200,
      productPreferences: ["Product"],
    },
  };
}

test("membership merchant action permission matrix is exact", () => {
  assert.equal(getMerchantMembershipPatchRequiredPermission({ action: "update_allergens" }), "members.allergens.manage");
  assert.equal(getMerchantMembershipPatchRequiredPermission({ action: "member_operation", type: "recharge" }), "redemptions.recharge");
  assert.equal(getMerchantMembershipPatchRequiredPermission({ action: "member_operation", type: "redeem" }), "redemptions.checkout");
  assert.equal(getMerchantMembershipPatchRequiredPermission({ action: "cancel_recharge" }), "redemptions.recharge.cancel");
  assert.equal(getMerchantMembershipPatchRequiredPermission({ action: "adjust_recharge" }), "members.account.adjust");
  assert.equal(getMerchantMembershipPatchRequiredPermission({ action: "award_invitation_points" }), "members.account.adjust");
  assert.equal(getMerchantMembershipPatchRequiredPermission({ action: "award_review_points" }), "members.account.adjust");
  assert.equal(getMerchantMembershipPatchRequiredPermission({ action: "member_redemption_checkout" }), "redemptions.checkout");
  assert.equal(getMerchantMembershipPatchRequiredPermission({ action: "point_deduction_quote" }), "redemptions.checkout");
  assert.equal(getMerchantMembershipPatchRequiredPermission({ action: "point_deduction_apply" }), "redemptions.checkout");
  assert.equal(getMerchantMembershipPatchRequiredPermission({ action: "member_checkin" }), null);
  assert.equal(getMerchantMembershipPatchRequiredPermission({ action: "leave" }), null);
});

test("membership PII redaction removes every full-text marker and account data", () => {
  const redacted = redactMerchantMembershipListItem(membership(), {
    customerData: false,
    account: false,
    insights: false,
  });
  const serialized = JSON.stringify(redacted);
  [
    "PII-ACCOUNT",
    "PII-USER",
    "pii-email",
    "PII-NICKNAME",
    "PII-NAME",
    "PII-PHONE",
    "PII-AVATAR",
    "PII-BIRTHDAY",
    "PII-GENDER",
    "PII-COUNTRY",
    "PII-PROVINCE",
    "PII-CITY",
    "PII-ADDRESS",
    "PII-TAX",
    "PII-ALLERGEN",
    "PII-TRANSACTION-NOTE",
    "PII-CANCELLATION-NOTE",
  ].forEach((marker) => assert.equal(serialized.includes(marker), false, marker));
  assert.equal(redacted.memberNo, "MEMBER-100");
  assert.equal(redacted.pointBalance, 0);
  assert.equal(redacted.balanceAmount, 0);
  assert.deepEqual(redacted.transactions, []);
  assert.equal(redacted.insight, undefined);
});

test("cashier redaction preserves settlement balances but removes customer data", () => {
  const redacted = redactMerchantMembershipForCashier(membership(), false);
  assert.equal(redacted.memberNo, "MEMBER-100");
  assert.equal(redacted.pointBalance, 120);
  assert.equal(redacted.balanceAmount, 45.5);
  assert.equal(redacted.email, "");
  assert.equal(redacted.accountId, "");
  assert.equal(redacted.transactions[0]?.pointDelta, 120);
  assert.equal(redacted.transactions[0]?.note, "");
});

test("membership settings scopes cannot cross-write or expose print settings", () => {
  assert.equal(getMerchantMembershipSettingsScopePermission("members"), "members.settings.manage");
  assert.equal(getMerchantMembershipSettingsScopePermission("redemptions"), "redemptions.catalog.manage");
  assert.equal(getMerchantMembershipSettingsScopePermission(""), null);
  assert.equal(isMerchantMembershipSettingsViewAllowedForScope("members", "levels"), true);
  assert.equal(isMerchantMembershipSettingsViewAllowedForScope("members", "rechargePlans"), false);
  assert.equal(isMerchantMembershipSettingsViewAllowedForScope("redemptions", "redemptionItems"), true);
  assert.equal(isMerchantMembershipSettingsViewAllowedForScope("redemptions", "pointsRules"), false);

  const settings = createEmptyMerchantMembershipSettings("10000000");
  const members = selectMerchantMembershipSettingsForEmployeeScope(settings, "members");
  const redemptions = selectMerchantMembershipSettingsForEmployeeScope(settings, "redemptions");
  assert.equal("printSettings" in members, false);
  assert.equal("rechargePlans" in members, false);
  assert.equal("printSettings" in redemptions, false);
  assert.equal("pointsRules" in redemptions, false);
});
