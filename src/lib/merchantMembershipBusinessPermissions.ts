import { createHash } from "node:crypto";
import type { MerchantMembershipSettings } from "@/lib/merchantMembershipSettings";
import type { MerchantMembershipListItem } from "@/lib/merchantMemberships";
import type { MerchantStaffBusinessPermission } from "@/lib/merchantStaffBusiness";

export type MerchantMembershipSettingsEmployeeScope = "members" | "redemptions";

export function buildMerchantMembershipBusinessId(
  membership: Pick<MerchantMembershipListItem, "siteId" | "id">,
) {
  return `member_${createHash("sha256")
    .update(`${membership.siteId}\u0000${membership.id}`)
    .digest("hex")}`;
}

export function matchesMerchantMembershipBusinessId(
  membership: Pick<MerchantMembershipListItem, "siteId" | "id">,
  candidate: string,
) {
  return membership.id === candidate || buildMerchantMembershipBusinessId(membership) === candidate;
}

export function getMerchantMembershipPatchRequiredPermission(input: {
  action: unknown;
  type?: unknown;
}): MerchantStaffBusinessPermission | null {
  if (input.action === "update_allergens") return "members.allergens.manage";
  if (input.action === "member_operation") {
    return input.type === "recharge"
      ? "redemptions.recharge"
      : "redemptions.checkout";
  }
  if (input.action === "cancel_recharge") return "redemptions.recharge.cancel";
  if (
    input.action === "adjust_recharge" ||
    input.action === "award_invitation_points" ||
    input.action === "award_review_points"
  ) {
    return "members.account.adjust";
  }
  if (
    input.action === "member_redemption_checkout" ||
    input.action === "point_deduction_quote" ||
    input.action === "point_deduction_apply"
  ) {
    return "redemptions.checkout";
  }
  return null;
}

export function getMerchantMembershipSettingsScopePermission(
  scope: unknown,
): MerchantStaffBusinessPermission | null {
  if (scope === "members") return "members.settings.manage";
  if (scope === "redemptions") return "redemptions.catalog.manage";
  return null;
}

export function isMerchantMembershipSettingsViewAllowedForScope(
  scope: MerchantMembershipSettingsEmployeeScope,
  view: unknown,
) {
  return scope === "members"
    ? view === "levels" || view === "pointsRules"
    : view === "rechargePlans" ||
        view === "redemptionCategories" ||
        view === "redemptionItems";
}

export function selectMerchantMembershipSettingsForEmployeeScope(
  settings: MerchantMembershipSettings,
  scope: MerchantMembershipSettingsEmployeeScope,
) {
  return scope === "members"
    ? {
        siteId: settings.siteId,
        growthRules: settings.growthRules,
        levels: settings.levels,
        pointsRules: settings.pointsRules,
        updatedAt: settings.updatedAt,
      }
    : {
        siteId: settings.siteId,
        rechargePlans: settings.rechargePlans,
        redemptionCategories: settings.redemptionCategories,
        redemptionItems: settings.redemptionItems,
        redemptionShowStock: settings.redemptionShowStock,
        updatedAt: settings.updatedAt,
      };
}

export function redactMerchantMembershipListItem(
  membership: MerchantMembershipListItem,
  access: {
    customerData: boolean;
    account: boolean;
    insights: boolean;
  },
): MerchantMembershipListItem {
  const customerSafe = access.customerData
    ? membership
    : {
        ...membership,
        id: buildMerchantMembershipBusinessId(membership),
        accountId: "",
        userId: "",
        email: "",
        nickname: "",
        name: "",
        phone: "",
        avatarUrl: "",
        birthday: "",
        birthdayMonthDayOnly: false,
        gender: "",
        country: "",
        province: "",
        city: "",
        address: "",
        taxName: "",
        taxNumber: "",
        taxCountry: "",
        taxProvince: "",
        taxCity: "",
        taxAddress: "",
        allergens: [],
        transactions: membership.transactions.map((transaction) => ({
          ...transaction,
          note: "",
          cancellationNote: "",
        })),
      };
  const accountSafe = access.account
    ? customerSafe
    : {
        ...customerSafe,
        pointBalance: 0,
        balanceAmount: 0,
        growthValue: 0,
        levelId: "",
        transactions: [],
      };
  const insight = access.insights ? accountSafe.insight : undefined;
  return {
    ...accountSafe,
    ...(insight
      ? {
          insight: access.account
            ? insight
            : { ...insight, pointBalance: 0, balanceAmount: 0 },
        }
      : { insight: undefined }),
  };
}

export function redactMerchantMembershipForCashier(
  membership: MerchantMembershipListItem,
  canViewCustomerData: boolean,
) {
  return redactMerchantMembershipListItem(membership, {
    customerData: canViewCustomerData,
    account: true,
    insights: false,
  });
}
