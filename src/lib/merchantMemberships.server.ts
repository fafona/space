import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import { matchesMerchantMembershipBusinessId } from "@/lib/merchantMembershipBusinessPermissions";
import {
  buildMerchantMemberNo,
  buildMerchantMembershipQrValue,
  calculateExpiredMerchantMemberPoints,
  getMerchantMembershipProfileValidationError,
  adjustMerchantMemberRechargeTransaction,
  cancelMerchantMemberRechargeTransaction,
  normalizeMerchantMemberAllergens,
  normalizeMerchantMembershipRecords,
  normalizeMerchantMembershipProfileDraft,
  quoteMerchantMemberRechargeCancellation,
  toMerchantMembershipListItem,
  toPersonalMembershipCard,
  writePersonalMembershipCardToUserMetadata,
  type MerchantMemberAccountTransaction,
  type MerchantMemberAccountTransactionType,
  type MerchantMembershipProfileDraft,
  type MerchantMembershipListItem,
  type MerchantMembershipRecord,
  type PersonalMembershipCard,
} from "@/lib/merchantMemberships";
import {
  getMerchantMembershipSettings,
  releaseMerchantMembershipRedemptionStock,
  reserveMerchantMembershipRedemptionStock,
} from "@/lib/merchantMembershipSettings.server";
import {
  calculateMerchantMemberPointDeduction,
  getMerchantMemberHolidayNamesForDate,
  parseMerchantMemberPointDiscountRate,
  type MerchantMemberLevel,
  type MerchantMembershipSettings,
} from "@/lib/merchantMembershipSettings";
import type { MerchantOrderRecord } from "@/lib/merchantOrders";
import { MERCHANT_COUPON_DIRECT_REDEMPTION_DISCOUNT_TYPES } from "@/lib/merchantCoupons";
import { redeemMerchantCouponRecords, releaseMerchantCouponRedemptions } from "@/lib/merchantCoupons.server";
import { loadStoredMerchantMemberships, saveStoredMerchantMemberships } from "@/lib/merchantMembershipsStore";
import {
  loadMerchantMembershipV1VerificationData,
  readMerchantMembershipsWithV1Verification,
  resolveMerchantMembershipV1ReadConfig,
  type MerchantMembershipV1ReadClient,
} from "@/lib/merchantMembershipLedgerV1Read.server";
import { appendMutationOperationMarker, buildMutationOperationMarker } from "@/lib/mutationOperationId";
import { readPersonalCustomerProfileFromSession } from "@/lib/personalCustomerProfile";
import type { PersonalAccountSession } from "@/lib/personalAccountSession.server";

function requireMembershipsStoreClient() {
  const supabase = createServerSupabaseServiceClient();
  if (!supabase) {
    throw new Error("memberships_store_unavailable");
  }
  return supabase;
}

const merchantMembershipMutationTails = new Map<string, Promise<void>>();

export async function withMerchantMembershipMutationLock<T>(
  siteId: string,
  task: () => Promise<T>,
  beforeMutation?: () => Promise<void>,
) {
  const normalizedSiteId = trimText(siteId, 64);
  if (!normalizedSiteId) throw new Error("invalid_site_id");
  const previous = merchantMembershipMutationTails.get(normalizedSiteId) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => gate);
  merchantMembershipMutationTails.set(normalizedSiteId, tail);
  await previous.catch(() => undefined);
  try {
    await beforeMutation?.();
    return await task();
  } finally {
    release();
    if (merchantMembershipMutationTails.get(normalizedSiteId) === tail) {
      merchantMembershipMutationTails.delete(normalizedSiteId);
    }
  }
}

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizePositiveInteger(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(trimText(value));
  if (!Number.isFinite(numberValue) || numberValue <= 0) return 0;
  return Math.round(numberValue);
}

function isPointsVoucherCoupon(coupon: { discountType: string }) {
  return coupon.discountType === "points_voucher";
}

function readPointsVoucherDiscount(coupon: { discountType: string; discountValue: number }) {
  return isPointsVoucherCoupon(coupon) ? Math.max(0, Math.round(Number(coupon.discountValue) || 0)) : 0;
}

function readPointsVoucherLimit(coupon: { discountType: string; pointsVoucherMaxPerRedemption: number }) {
  return isPointsVoucherCoupon(coupon) ? normalizePositiveInteger(coupon.pointsVoucherMaxPerRedemption) : 0;
}

function readPointsVoucherMinimumRedeemPoints(coupon: {
  discountType: string;
  pointsVoucherMinimumRedeemPoints: number;
}) {
  return isPointsVoucherCoupon(coupon) ? normalizePositiveInteger(coupon.pointsVoucherMinimumRedeemPoints) : 0;
}

function normalizePositiveMoney(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(numberValue) || numberValue <= 0) return 0;
  return Number(numberValue.toFixed(2));
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readProfileAvatarUrl(session: PersonalAccountSession) {
  const metadata = readRecord(session.user.user_metadata);
  const profile = readRecord(metadata?.personal_profile) ?? {};
  return trimText(profile.avatarUrl) || trimText(profile.avatar_url) || trimText(metadata?.avatarUrl) || trimText(metadata?.avatar_url);
}

function findMerchantMembershipIndexByIdentity(
  memberships: MerchantMembershipRecord[],
  input: { membershipId?: unknown; memberNo?: unknown },
) {
  const membershipId = trimText(input.membershipId, 160);
  if (membershipId) {
    const index = memberships.findIndex((membership) =>
      matchesMerchantMembershipBusinessId(toMerchantMembershipListItem(membership), membershipId),
    );
    if (index >= 0) return index;
  }
  const memberNo = trimText(input.memberNo, 120);
  if (!memberNo) return -1;
  const memberNoMatches = memberships
    .map((membership, index) => ({ membership, index }))
    .filter((entry) => entry.membership.memberNo === memberNo);
  return memberNoMatches.find((entry) => entry.membership.status === "active")?.index ?? memberNoMatches[0]?.index ?? -1;
}

export function readPersonalMembershipProfileFromSession(session: PersonalAccountSession): MerchantMembershipProfileDraft {
  const metadata = readRecord(session.user.user_metadata);
  const profile = readRecord(metadata?.personal_profile) ?? {};
  const customerProfile = readPersonalCustomerProfileFromSession({
    authenticated: true,
    accountType: "personal",
    accountId: session.accountId,
    user: session.user,
  });
  return normalizeMerchantMembershipProfileDraft(profile, {
    nickname:
      trimText(profile.nickname, 120) ||
      trimText(profile.displayName, 120) ||
      trimText(profile.display_name, 120) ||
      customerProfile.name,
    name: customerProfile.name,
    phone: customerProfile.phone,
    email: session.email || customerProfile.email || customerProfile.loginEmail,
    avatarUrl: readProfileAvatarUrl(session),
    birthday: trimText(profile.birthday, 32),
    birthdayMonthDayOnly:
      profile.birthdayMonthDayOnly === true ||
      profile.birthday_month_day_only === true ||
      profile.birthdayMonthDayOnly === "true" ||
      profile.birthday_month_day_only === "true",
    gender: trimText(profile.gender, 32),
    country: trimText(profile.country, 80),
    province: trimText(profile.province, 80),
    city: trimText(profile.city, 80),
    address: trimText(profile.address, 240),
    taxName: trimText(profile.taxName, 160) || trimText(profile.invoiceName, 160),
    taxNumber: trimText(profile.taxNumber, 120) || trimText(profile.invoiceTaxNumber, 120),
    taxCountry: trimText(profile.taxCountry, 80) || trimText(profile.invoiceCountry, 80),
    taxProvince: trimText(profile.taxProvince, 80) || trimText(profile.invoiceProvince, 80),
    taxCity: trimText(profile.taxCity, 80) || trimText(profile.invoiceCity, 80),
    taxAddress: trimText(profile.taxAddress, 240) || trimText(profile.invoiceAddress, 240),
    allergens: [],
  });
}

async function writePersonalMembershipToMetadata(session: PersonalAccountSession, membership: PersonalMembershipRecordLike) {
  const card = {
    id: membership.id,
    siteId: membership.siteId,
    siteName: membership.siteName,
    memberNo: membership.memberNo,
    qrValue: buildMerchantMembershipQrValue(membership.siteId, membership.memberNo),
    status: membership.status,
    joinedAt: membership.joinedAt,
    leftAt: membership.leftAt,
  } satisfies PersonalMembershipCard;
  const nextMetadata = writePersonalMembershipCardToUserMetadata(session.user.user_metadata ?? {}, card);
  const { error } = await session.adminSupabase.auth.admin.updateUserById(session.userId, { user_metadata: nextMetadata });
  if (error) throw error;
}

type PersonalMembershipRecordLike = Pick<
  MerchantMembershipRecord,
  "id" | "siteId" | "siteName" | "memberNo" | "status" | "joinedAt" | "leftAt"
>;

function createMerchantMemberTransaction(input: {
  type: MerchantMemberAccountTransactionType;
  pointDelta: number;
  balanceDelta?: number;
  growthDelta?: number;
  note: string;
  operatorId?: string;
  at?: string;
}): MerchantMemberAccountTransaction {
  const at = input.at ?? new Date().toISOString();
  return {
    id: `MT${Date.parse(at).toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    type: input.type,
    status: "completed",
    at,
    pointDelta: Math.round(input.pointDelta),
    balanceDelta: Number((input.balanceDelta ?? 0).toFixed(2)),
    growthDelta: normalizeGrowthValue(input.growthDelta ?? 0),
    note: trimText(input.note, 500),
    operatorId: trimText(input.operatorId, 120),
    cancelledAt: null,
    cancellationNote: "",
    cancelledBy: "",
    cancellationOperationMarker: "",
    relatedTransactionId: "",
    adjustmentKind: "",
  };
}

function transactionHasMarker(membership: MerchantMembershipRecord, marker: string) {
  return membership.transactions.some((transaction) => transaction.note.includes(marker));
}

function buildMembershipMutationNote(note: unknown, fallback: string, marker: string) {
  return appendMutationOperationMarker(trimText(note, 500) || fallback, marker);
}

function readBirthdayMonthDay(value: string) {
  const parts = trimText(value, 32).match(/\d+/g) ?? [];
  if (parts.length >= 3) return `${parts[1]?.padStart(2, "0")}-${parts[2]?.padStart(2, "0")}`;
  if (parts.length >= 2) return `${parts[0]?.padStart(2, "0")}-${parts[1]?.padStart(2, "0")}`;
  return "";
}

function formatMonthDay(date: Date) {
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDateYmd(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function calculateOrderPoints(order: MerchantOrderRecord, settings: MerchantMembershipSettings) {
  const paidAmount = settings.pointsRules.paidAmount;
  const paidPoints = settings.pointsRules.paidPoints;
  if (paidAmount <= 0 || paidPoints <= 0 || order.totalAmount <= 0) return 0;
  const basePoints = Math.floor(order.totalAmount / paidAmount) * paidPoints;
  const orderDate = new Date(order.completedAt || order.confirmedAt || order.createdAt);
  const orderDateText = formatDateYmd(orderDate);
  const matchedDateRule = settings.pointsRules.holidayRules
    .filter((rule) => rule.enabled && rule.date === orderDateText)
    .sort((left, right) => right.multiplier - left.multiplier || left.sort - right.sort)[0];
  const holidayNames = getMerchantMemberHolidayNamesForDate(orderDate);
  const matchedLegacyHoliday = holidayNames.some((holidayName) => settings.pointsRules.holidayNames.includes(holidayName));
  const multiplier = matchedDateRule
    ? Math.max(0, matchedDateRule.multiplier ?? 1)
    : matchedLegacyHoliday
      ? Math.max(0, settings.pointsRules.holidayMultiplier ?? 1)
      : 1;
  return Math.max(0, Math.floor(basePoints * multiplier));
}

function normalizeGrowthValue(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Number(value.toFixed(2));
}

function getEnabledLevels(settings: MerchantMembershipSettings) {
  return settings.levels
    .filter((level) => level.enabled && trimText(level.name, 120))
    .sort((left, right) => left.requiredGrowthValue - right.requiredGrowthValue || left.sort - right.sort);
}

function resolveMembershipLevel(settings: MerchantMembershipSettings, growthValue: number) {
  return getEnabledLevels(settings).reduce<MerchantMemberLevel | null>((matched, level) => {
    return growthValue >= level.requiredGrowthValue ? level : matched;
  }, null);
}

function calculateAnnualGrowthValue(membership: MerchantMembershipRecord, now: string) {
  const currentYear = new Date(now).getFullYear();
  return normalizeGrowthValue(
    membership.transactions
      .filter((transaction) => {
        const timestamp = Date.parse(transaction.at);
        return (
          transaction.status !== "cancelled" &&
          Number.isFinite(timestamp) &&
          new Date(timestamp).getFullYear() === currentYear
        );
      })
      .reduce((sum, transaction) => sum + Math.max(0, transaction.growthDelta), 0),
  );
}

function getMembershipLevel(settings: MerchantMembershipSettings, membership: MerchantMembershipRecord) {
  const enabledLevels = getEnabledLevels(settings);
  return (
    enabledLevels.find((level) => level.id === membership.levelId) ??
    resolveMembershipLevel(settings, membership.growthValue)
  );
}

function getRedemptionPointCostForMember(
  item: { pointsCost: number | null },
  membership: MerchantMembershipRecord,
  settings: MerchantMembershipSettings | null,
) {
  const basePoints = item.pointsCost ?? 0;
  if (!settings) return basePoints;
  const level = getMembershipLevel(settings, membership);
  const rate = parseMerchantMemberPointDiscountRate(level?.benefit.pointDiscount);
  return Math.max(0, Math.ceil(basePoints * rate));
}

function hasLevelGiftBenefit(level: MerchantMemberLevel, kind: "oneTime" | "recurring" | "birthday") {
  const benefit = level.benefit;
  if (kind === "oneTime") {
    return Boolean(benefit.oneTimeGiftPoints > 0 || benefit.oneTimeGiftItem || benefit.oneTimeGiftProduct);
  }
  if (kind === "recurring") {
    return Boolean(benefit.recurringGiftPoints > 0 || benefit.recurringGiftItem || benefit.recurringGiftProduct);
  }
  return Boolean(benefit.birthdayGiftPoints > 0 || benefit.birthdayGiftItem || benefit.birthdayGiftProduct);
}

function buildLevelGiftNote(level: MerchantMemberLevel, kind: "oneTime" | "recurring" | "birthday", marker: string) {
  const benefit = level.benefit;
  const parts =
    kind === "oneTime"
      ? [
          benefit.oneTimeGiftPoints > 0 ? `积分 ${benefit.oneTimeGiftPoints}` : "",
          benefit.oneTimeGiftItem ? `项目 ${benefit.oneTimeGiftItem}` : "",
          benefit.oneTimeGiftProduct ? `产品 ${benefit.oneTimeGiftProduct}` : "",
        ]
      : kind === "recurring"
        ? [
            benefit.recurringGiftPoints > 0 ? `积分 ${benefit.recurringGiftPoints}` : "",
            benefit.recurringGiftItem ? `项目 ${benefit.recurringGiftItem}` : "",
            benefit.recurringGiftProduct ? `产品 ${benefit.recurringGiftProduct}` : "",
          ]
        : [
            benefit.birthdayGiftPoints > 0 ? `积分 ${benefit.birthdayGiftPoints}` : "",
            benefit.birthdayGiftItem ? `项目 ${benefit.birthdayGiftItem}` : "",
            benefit.birthdayGiftProduct ? `产品 ${benefit.birthdayGiftProduct}` : "",
          ];
  const label = kind === "oneTime" ? "一次性权益" : kind === "recurring" ? "定期权益" : "生日权益";
  return `${level.name}${label}${parts.filter(Boolean).length > 0 ? `：${parts.filter(Boolean).join(" / ")}` : ""} ${marker}`;
}

function getLevelGiftPoints(level: MerchantMemberLevel, kind: "oneTime" | "recurring" | "birthday") {
  if (kind === "oneTime") return level.benefit.oneTimeGiftPoints;
  if (kind === "recurring") return level.benefit.recurringGiftPoints;
  return level.benefit.birthdayGiftPoints;
}

function applyLevelGift(
  membership: MerchantMembershipRecord,
  level: MerchantMemberLevel,
  kind: "oneTime" | "recurring" | "birthday",
  marker: string,
  now: string,
) {
  if (!hasLevelGiftBenefit(level, kind) || transactionHasMarker(membership, marker)) return membership;
  const points = getLevelGiftPoints(level, kind);
  return {
    ...membership,
    pointBalance: membership.pointBalance + points,
    transactions: [
      createMerchantMemberTransaction({
        type: "recharge",
        at: now,
        pointDelta: points,
        note: buildLevelGiftNote(level, kind, marker),
        operatorId: "system",
      }),
      ...membership.transactions,
    ],
    updatedAt: now,
  };
}

function applyMembershipGrowthAndLevel(input: {
  membership: MerchantMembershipRecord;
  settings: MerchantMembershipSettings | null;
  growthDelta?: number;
  now: string;
}) {
  if (!input.settings) return input.membership;
  const growthDelta = normalizeGrowthValue(input.growthDelta ?? 0);
  const nextGrowthValue = normalizeGrowthValue((input.membership.growthValue || 0) + growthDelta);
  let next: MerchantMembershipRecord = {
    ...input.membership,
    growthValue: input.settings.growthRules.annualRecalculate
      ? calculateAnnualGrowthValue(input.membership, input.now)
      : nextGrowthValue,
  };
  const matchedLevel = resolveMembershipLevel(input.settings, next.growthValue);
  next.levelId = matchedLevel?.id ?? "";
  getEnabledLevels(input.settings)
    .filter((level) => next.growthValue >= level.requiredGrowthValue)
    .forEach((level) => {
      next = applyLevelGift(next, level, "oneTime", `[level-one-time:${level.id}]`, input.now);
    });
  return next;
}

function applyScheduledLevelBenefits(input: {
  membership: MerchantMembershipRecord;
  settings: MerchantMembershipSettings;
  nowDate: Date;
  now: string;
}) {
  let next = applyMembershipGrowthAndLevel({
    membership: input.membership,
    settings: input.settings,
    now: input.now,
  });
  const level = getMembershipLevel(input.settings, next);
  if (!level) return next;
  const monthKey = `${input.nowDate.getFullYear()}-${String(input.nowDate.getMonth() + 1).padStart(2, "0")}`;
  next = applyLevelGift(next, level, "recurring", `[level-recurring:${level.id}:${monthKey}]`, input.now);
  return next;
}

function applyJoinPoints(membership: MerchantMembershipRecord, settings: MerchantMembershipSettings, now: string) {
  const points = settings.pointsRules.joinPoints;
  const marker = "[join-points]";
  if (points <= 0 || transactionHasMarker(membership, marker)) return membership;
  return {
    ...membership,
    pointBalance: membership.pointBalance + points,
    transactions: [
      createMerchantMemberTransaction({
        type: "recharge",
        at: now,
        pointDelta: points,
        note: `入会赠送积分 ${marker}`,
        operatorId: "system",
      }),
      ...membership.transactions,
    ],
    updatedAt: now,
  };
}

async function applyScheduledPointRules(
  siteId: string,
  memberships: MerchantMembershipRecord[],
  expectedUpdatedAt: string | null,
  retryAttempt = 0,
) {
  const settings = await getMerchantMembershipSettings(siteId).catch(() => null);
  if (!settings) return memberships;
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const currentMonthDay = formatMonthDay(nowDate);
  const currentYear = String(nowDate.getFullYear());
  const expiryDays = settings.pointsRules.pointsNeverExpire ? 0 : settings.pointsRules.pointsValidDays;
  let changed = false;
  const nextMemberships = memberships.map((membership) => {
    if (membership.status !== "active") return membership;
    let next = applyScheduledLevelBenefits({ membership, settings, nowDate, now });
    if (
      next.pointBalance !== membership.pointBalance ||
      next.growthValue !== membership.growthValue ||
      next.levelId !== membership.levelId ||
      next.transactions.length !== membership.transactions.length
    ) {
      changed = true;
    }
    const birthdayMonthDay = readBirthdayMonthDay(next.birthday);
    const birthdayPoints = settings.pointsRules.birthdayPoints;
    const birthdayMarker = `[birthday-points:${currentYear}]`;
    if (birthdayPoints > 0 && birthdayMonthDay && birthdayMonthDay === currentMonthDay && !transactionHasMarker(next, birthdayMarker)) {
      next = {
        ...next,
        pointBalance: next.pointBalance + birthdayPoints,
        transactions: [
          createMerchantMemberTransaction({
            type: "recharge",
            at: now,
            pointDelta: birthdayPoints,
            note: `生日自动赠送积分 ${birthdayMarker}`,
            operatorId: "system",
          }),
          ...next.transactions,
        ],
        updatedAt: now,
      };
      changed = true;
    }
    if (birthdayMonthDay && birthdayMonthDay === currentMonthDay) {
      const level = getMembershipLevel(settings, next);
      if (level) {
        const beforeTransactions = next.transactions.length;
        const beforePointBalance = next.pointBalance;
        next = applyLevelGift(next, level, "birthday", `[level-birthday:${level.id}:${currentYear}]`, now);
        if (next.transactions.length !== beforeTransactions || next.pointBalance !== beforePointBalance) changed = true;
      }
    }
    if (expiryDays > 0 && next.pointBalance > 0) {
      const cutoff = nowDate.getTime() - expiryDays * 24 * 60 * 60 * 1000;
      const expiredDelta = calculateExpiredMerchantMemberPoints({
        transactions: next.transactions,
        pointBalance: next.pointBalance,
        cutoffTimestamp: cutoff,
      });
      if (expiredDelta > 0) {
        next = {
          ...next,
          pointBalance: next.pointBalance - expiredDelta,
          transactions: [
            createMerchantMemberTransaction({
              type: "redeem",
              at: now,
              pointDelta: -expiredDelta,
              note: `积分过期 [points-expired]`,
              operatorId: "system",
            }),
            ...next.transactions,
          ],
          updatedAt: now,
        };
        changed = true;
      }
    }
    return next;
  });
  if (!changed) return memberships;
  const supabase = requireMembershipsStoreClient();
  const saved = await saveStoredMerchantMemberships(supabase, {
    siteId,
    memberships: nextMemberships,
    updatedAt: now,
    expectedUpdatedAt,
  });
  if (saved.error === "merchant_memberships_conflict" && retryAttempt < 2) {
    const latest = await loadStoredMerchantMemberships(supabase, siteId);
    return applyScheduledPointRules(
      siteId,
      normalizeMerchantMembershipRecords(latest?.memberships ?? []),
      latest?.updatedAt ?? null,
      retryAttempt + 1,
    );
  }
  if (saved.error) throw new Error(saved.error);
  return nextMemberships;
}

function resolveMerchantMembershipsVersion(memberships: MerchantMembershipRecord[], fallback: string | null) {
  return memberships.reduce<string | null>((latest, membership) => {
    const updatedAt = trimText(membership.updatedAt, 64);
    if (!updatedAt) return latest;
    if (!latest) return updatedAt;
    return Date.parse(updatedAt) > Date.parse(latest) ? updatedAt : latest;
  }, fallback);
}

export async function getMerchantMembershipsSnapshot(
  siteId: string,
  options: { applyScheduledRules?: boolean } = {},
): Promise<{
  memberships: MerchantMembershipListItem[];
  updatedAt: string | null;
}> {
  const supabase = requireMembershipsStoreClient();
  const stored = await loadStoredMerchantMemberships(supabase, siteId);
  const memberships = normalizeMerchantMembershipRecords(stored?.memberships ?? []);
  const nextMemberships =
    options.applyScheduledRules === false
      ? memberships
      : await applyScheduledPointRules(siteId, memberships, stored?.updatedAt ?? null);
  const legacy = {
    memberships: nextMemberships,
    updatedAt: resolveMerchantMembershipsVersion(
      nextMemberships,
      stored?.updatedAt ?? null,
    ),
  };
  const readConfig = resolveMerchantMembershipV1ReadConfig();
  const verified = await readMerchantMembershipsWithV1Verification({
    siteId,
    legacy,
    loadV1: () =>
      loadMerchantMembershipV1VerificationData(
        supabase as unknown as MerchantMembershipV1ReadClient,
        siteId,
        readConfig.currency,
      ),
    config: readConfig,
  });
  return {
    memberships: verified.memberships.map(toMerchantMembershipListItem),
    updatedAt: verified.updatedAt,
  };
}

export async function listMerchantMemberships(siteId: string): Promise<MerchantMembershipListItem[]> {
  const snapshot = await getMerchantMembershipsSnapshot(siteId);
  return snapshot.memberships;
}

async function updateMerchantMembershipAllergensUnlocked(input: {
  siteId: string;
  membershipId: string;
  allergens: unknown;
  assertAuthorizationCurrent?: () => Promise<void>;
}): Promise<MerchantMembershipListItem> {
  const supabase = requireMembershipsStoreClient();
  const siteId = trimText(input.siteId, 64);
  const membershipId = trimText(input.membershipId, 160);
  if (!siteId || !membershipId) throw new Error("membership_not_found");
  const allergens = normalizeMerchantMemberAllergens(input.allergens);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stored = await loadStoredMerchantMemberships(supabase, siteId);
    const current = normalizeMerchantMembershipRecords(stored?.memberships ?? []);
    const index = current.findIndex((membership) =>
      matchesMerchantMembershipBusinessId(toMerchantMembershipListItem(membership), membershipId),
    );
    if (index < 0) throw new Error("membership_not_found");
    if (current[index]?.status !== "active") throw new Error("membership_not_active");
    const now = new Date().toISOString();
    const nextMembership = {
      ...current[index],
      allergens,
      updatedAt: now,
    };
    const nextMemberships = [...current];
    nextMemberships[index] = nextMembership;
    const saved = await saveStoredMerchantMemberships(supabase, {
      siteId,
      memberships: nextMemberships,
      updatedAt: now,
      expectedUpdatedAt: stored?.updatedAt ?? null,
    });
    if (!saved.error) return toMerchantMembershipListItem(nextMembership);
    if (saved.error !== "merchant_memberships_conflict" || attempt >= 2) throw new Error(saved.error);
  }
  throw new Error("merchant_memberships_conflict");
}

export async function updateMerchantMembershipAllergens(
  input: Parameters<typeof updateMerchantMembershipAllergensUnlocked>[0],
) {
  const siteId = trimText(input.siteId, 64);
  return withMerchantMembershipMutationLock(
    siteId,
    () => updateMerchantMembershipAllergensUnlocked({ ...input, siteId }),
    input.assertAuthorizationCurrent,
  );
}

type MerchantMembershipPointRuleAction = "checkin" | "invitation" | "review";

function findActiveMembershipIndex(
  memberships: MerchantMembershipRecord[],
  input: { membershipId?: unknown; session?: PersonalAccountSession | null },
) {
  const membershipId = trimText(input.membershipId, 160);
  return memberships.findIndex((membership) => {
    if (membership.status !== "active") return false;
    if (
      membershipId &&
      matchesMerchantMembershipBusinessId(toMerchantMembershipListItem(membership), membershipId)
    ) return true;
    if (!input.session) return false;
    if (membership.accountId && membership.accountId === input.session.accountId) return true;
    if (membership.userId && membership.userId === input.session.userId) return true;
    return Boolean(input.session.email && membership.email.toLowerCase() === input.session.email.toLowerCase());
  });
}

function getPreviousDateYmd(date: Date) {
  const previous = new Date(date);
  previous.setDate(date.getDate() - 1);
  return formatDateYmd(previous);
}

function normalizeReferenceId(value: unknown, fallback: string) {
  return trimText(value, 160) || fallback;
}

async function awardMerchantMembershipRulePointsUnlocked(input: {
  siteId: string;
  membershipId?: unknown;
  session?: PersonalAccountSession | null;
  action: MerchantMembershipPointRuleAction;
  referenceId?: unknown;
  operatorId?: unknown;
  assertAuthorizationCurrent?: () => Promise<void>;
}): Promise<MerchantMembershipListItem> {
  const supabase = requireMembershipsStoreClient();
  const siteId = trimText(input.siteId, 64);
  if (!siteId) throw new Error("invalid_site_id");
  const settings = await getMerchantMembershipSettings(siteId);
  const nowDate = new Date();
  const dayKey = formatDateYmd(nowDate);
  let points = 0;
  let marker = "";
  let note = "";

  if (input.action === "checkin") {
    marker = `[checkin-points:${dayKey}]`;
  } else if (input.action === "invitation") {
    points = settings.pointsRules.invitationPoints;
    const referenceId = normalizeReferenceId(input.referenceId, "");
    if (!referenceId) throw new Error("membership_reference_required");
    marker = `[invitation-points:${referenceId}]`;
    note = `邀请积分 ${marker}`;
  } else {
    points = settings.pointsRules.reviewPoints;
    const referenceId = normalizeReferenceId(input.referenceId, "");
    if (!referenceId) throw new Error("membership_reference_required");
    marker = `[review-points:${referenceId}]`;
    note = `评价积分 ${marker}`;
  }

  const shouldRecordZeroCheckin = input.action === "checkin" && settings.pointsRules.continuousCheckinPoints > 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stored = await loadStoredMerchantMemberships(supabase, siteId);
    const current = normalizeMerchantMembershipRecords(stored?.memberships ?? []);
    const index = findActiveMembershipIndex(current, input);
    if (index < 0) throw new Error("membership_not_found");
    const currentMembership = current[index];
    if (transactionHasMarker(currentMembership, marker)) return toMerchantMembershipListItem(currentMembership);
    let operationPoints = points;
    let operationNote = note;
    if (input.action === "checkin") {
      const previousMarker = `[checkin-points:${getPreviousDateYmd(nowDate)}]`;
      const continuousPoints = transactionHasMarker(currentMembership, previousMarker)
        ? settings.pointsRules.continuousCheckinPoints
        : 0;
      operationPoints = settings.pointsRules.checkinPoints + continuousPoints;
      operationNote =
        continuousPoints > 0
          ? `签到积分，含连续签到 ${continuousPoints} 分 ${marker}`
          : `签到积分 ${marker}`;
    }
    if (operationPoints <= 0 && !shouldRecordZeroCheckin) return toMerchantMembershipListItem(currentMembership);
    const now = new Date().toISOString();
    const nextMembership = {
      ...currentMembership,
      pointBalance: currentMembership.pointBalance + operationPoints,
      transactions: [
        createMerchantMemberTransaction({
          type: "recharge",
          at: now,
          pointDelta: operationPoints,
          note: operationNote,
          operatorId: trimText(input.operatorId, 120) || (input.session ? input.session.accountId : "system"),
        }),
        ...currentMembership.transactions,
      ],
      updatedAt: now,
    };
    const nextMemberships = [...current];
    nextMemberships[index] = nextMembership;
    const saved = await saveStoredMerchantMemberships(supabase, {
      siteId,
      memberships: nextMemberships,
      updatedAt: now,
      expectedUpdatedAt: stored?.updatedAt ?? null,
    });
    if (!saved.error) return toMerchantMembershipListItem(nextMembership);
    if (saved.error !== "merchant_memberships_conflict" || attempt >= 2) throw new Error(saved.error);
  }
  throw new Error("merchant_memberships_conflict");
}

export async function awardMerchantMembershipRulePoints(
  input: Parameters<typeof awardMerchantMembershipRulePointsUnlocked>[0],
) {
  const siteId = trimText(input.siteId, 64);
  return withMerchantMembershipMutationLock(
    siteId,
    () => awardMerchantMembershipRulePointsUnlocked({ ...input, siteId }),
    input.assertAuthorizationCurrent,
  );
}

async function applyMerchantMembershipAccountOperationUnlocked(input: {
  siteId: string;
  membershipId: string;
  memberNo?: unknown;
  type: MerchantMemberAccountTransactionType;
  points?: unknown;
  balanceAmount?: unknown;
  note?: unknown;
  operatorId?: unknown;
  rechargePlanId?: unknown;
  redemptionItemId?: unknown;
  redemptionQuantity?: unknown;
  operationId?: unknown;
  retryAttempt?: number;
  assertAuthorizationCurrent?: () => Promise<void>;
}): Promise<MerchantMembershipListItem> {
  const supabase = requireMembershipsStoreClient();
  const siteId = trimText(input.siteId, 64);
  const membershipId = trimText(input.membershipId, 160);
  const memberNo = trimText(input.memberNo, 120);
  if (!siteId || (!membershipId && !memberNo)) throw new Error("membership_not_found");
  const type: MerchantMemberAccountTransactionType = input.type === "recharge" ? "recharge" : "redeem";
  const redemptionItemId = trimText(input.redemptionItemId, 120);
  if (type === "redeem" && redemptionItemId) {
    return applyMerchantMembershipRedemptionCart({
      siteId,
      membershipId,
      memberNo,
      items: [{ redemptionItemId, quantity: input.redemptionQuantity }],
      note: input.note,
      operatorId: input.operatorId,
      operationId: input.operationId,
      assertAuthorizationCurrent: input.assertAuthorizationCurrent,
    });
  }
  const stored = await loadStoredMerchantMemberships(supabase, siteId);
  const current = normalizeMerchantMembershipRecords(stored?.memberships ?? []);
  const index = findMerchantMembershipIndexByIdentity(current, { membershipId, memberNo });
  if (index < 0) throw new Error("membership_not_found");
  const currentMembership = current[index];
  const operationMarker = buildMutationOperationMarker("member-operation", input.operationId);
  if (!operationMarker) throw new Error("mutation_operation_id_required");
  if (transactionHasMarker(currentMembership, operationMarker)) {
    return toMerchantMembershipListItem(currentMembership);
  }
  if (currentMembership.status !== "active") throw new Error("membership_not_active");
  const settings = await getMerchantMembershipSettings(siteId).catch(() => null);
  const rechargePlanId = trimText(input.rechargePlanId, 120);
  const rechargePlan =
    type === "recharge" && rechargePlanId
      ? settings?.rechargePlans.find((plan) => plan.enabled && plan.id === rechargePlanId)
      : null;
  const redemptionItem =
    type === "redeem" && redemptionItemId
      ? settings?.redemptionItems.find((item) => item.enabled && item.id === redemptionItemId)
      : null;
  const redemptionQuantity = Math.max(1, normalizePositiveInteger(input.redemptionQuantity) || 1);
  if (redemptionItem && redemptionItem.stock !== null && redemptionQuantity > redemptionItem.stock) {
    throw new Error("membership_redemption_stock_insufficient");
  }
  const redemptionPointCost = redemptionItem
    ? getRedemptionPointCostForMember(redemptionItem, currentMembership, settings)
    : 0;
  const rawPoints = redemptionItem
    ? redemptionPointCost * redemptionQuantity
    : rechargePlan
      ? rechargePlan.giftPoints
      : normalizePositiveInteger(input.points);
  const rawBalance = rechargePlan
    ? Number((rechargePlan.rechargeAmount + rechargePlan.giftAmount).toFixed(2))
    : normalizePositiveMoney(input.balanceAmount);
  if (rawPoints <= 0 && rawBalance <= 0) throw new Error("membership_operation_empty");
  const pointDelta = type === "recharge" ? rawPoints : -rawPoints;
  const balanceDelta = type === "recharge" ? rawBalance : -rawBalance;
  const nextPointBalance = currentMembership.pointBalance + pointDelta;
  const nextBalanceAmount = Number((currentMembership.balanceAmount + balanceDelta).toFixed(2));
  if (nextPointBalance < 0 || nextBalanceAmount < 0) throw new Error("membership_balance_insufficient");
  const now = new Date().toISOString();
  const rechargeGrowthAmount = rechargePlan ? rechargePlan.rechargeAmount : type === "recharge" ? rawBalance : 0;
  const growthDelta =
    settings && type === "recharge"
      ? rechargeGrowthAmount * settings.growthRules.rechargeAmountGrowth + rawPoints * settings.growthRules.rechargePointGrowth
      : settings && type === "redeem"
        ? rawPoints * settings.growthRules.spendPointGrowth
        : 0;
  const fallbackNote = rechargePlan
    ? `充值方案：${rechargePlan.title}`
    : redemptionItem
      ? `兑换项目：${redemptionItem.name} x ${redemptionQuantity}${
          redemptionItem.pointsCost !== null && redemptionPointCost !== redemptionItem.pointsCost
            ? `（等级折扣 ${redemptionItem.pointsCost}→${redemptionPointCost} 积分/件）`
            : ""
        }`
      : "";
  let nextMembership: MerchantMembershipRecord = {
    ...currentMembership,
    pointBalance: nextPointBalance,
    balanceAmount: nextBalanceAmount,
    transactions: [
      createMerchantMemberTransaction({
        type,
        at: now,
        pointDelta,
        balanceDelta,
        growthDelta,
        note: buildMembershipMutationNote(input.note, fallbackNote, operationMarker),
        operatorId: trimText(input.operatorId, 120),
      }),
      ...currentMembership.transactions,
    ],
    updatedAt: now,
  };
  nextMembership = applyMembershipGrowthAndLevel({
    membership: nextMembership,
    settings,
    growthDelta,
    now,
  });
  const nextMemberships = [...current];
  nextMemberships[index] = nextMembership;
  const saved = await saveStoredMerchantMemberships(supabase, {
    siteId,
    memberships: nextMemberships,
    updatedAt: now,
    expectedUpdatedAt: stored?.updatedAt ?? null,
  });
  if (saved.error === "merchant_memberships_conflict" && (input.retryAttempt ?? 0) < 2) {
    return applyMerchantMembershipAccountOperationUnlocked({
      ...input,
      retryAttempt: (input.retryAttempt ?? 0) + 1,
    });
  }
  if (saved.error) throw new Error(saved.error);
  return toMerchantMembershipListItem(nextMembership);
}

export async function applyMerchantMembershipAccountOperation(
  input: Parameters<typeof applyMerchantMembershipAccountOperationUnlocked>[0],
) {
  const siteId = trimText(input.siteId, 64);
  const redemptionItemId = trimText(input.redemptionItemId, 120);
  if (input.type !== "recharge" && redemptionItemId) {
    return applyMerchantMembershipRedemptionCart({
      siteId,
      membershipId: input.membershipId,
      memberNo: input.memberNo,
      items: [{ redemptionItemId, quantity: input.redemptionQuantity }],
      note: input.note,
      operatorId: input.operatorId,
      operationId: input.operationId,
      assertAuthorizationCurrent: input.assertAuthorizationCurrent,
    });
  }
  return withMerchantMembershipMutationLock(
    siteId,
    () => applyMerchantMembershipAccountOperationUnlocked({ ...input, siteId }),
    input.assertAuthorizationCurrent,
  );
}

async function cancelMerchantMembershipRechargeUnlocked(input: {
  siteId: string;
  membershipId: string;
  memberNo?: unknown;
  transactionId?: unknown;
  note?: unknown;
  operatorId?: unknown;
  operationId?: unknown;
  assertAuthorizationCurrent?: () => Promise<void>;
}): Promise<MerchantMembershipListItem> {
  const supabase = requireMembershipsStoreClient();
  const siteId = trimText(input.siteId, 64);
  const membershipId = trimText(input.membershipId, 160);
  const memberNo = trimText(input.memberNo, 120);
  if (!siteId || (!membershipId && !memberNo)) throw new Error("membership_not_found");
  const settings = await getMerchantMembershipSettings(siteId).catch(() => null);
  const operationMarker = buildMutationOperationMarker("member-recharge-cancel", input.operationId);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stored = await loadStoredMerchantMemberships(supabase, siteId);
    const current = normalizeMerchantMembershipRecords(stored?.memberships ?? []);
    const index = findMerchantMembershipIndexByIdentity(current, { membershipId, memberNo });
    if (index < 0) throw new Error("membership_not_found");
    const currentMembership = current[index];
    if (currentMembership.status !== "active") throw new Error("membership_not_active");

    const now = new Date().toISOString();
    const cancellation = cancelMerchantMemberRechargeTransaction({
      membership: currentMembership,
      transactionId: input.transactionId,
      cancelledAt: now,
      cancellationNote: input.note,
      cancelledBy: input.operatorId,
      cancellationOperationMarker: operationMarker,
    });
    if (cancellation.alreadyCancelled) return toMerchantMembershipListItem(currentMembership);

    const nextMembership = applyMembershipGrowthAndLevel({
      membership: cancellation.membership,
      settings,
      growthDelta: 0,
      now,
    });
    const nextMemberships = [...current];
    nextMemberships[index] = nextMembership;
    const saved = await saveStoredMerchantMemberships(supabase, {
      siteId,
      memberships: nextMemberships,
      updatedAt: now,
      expectedUpdatedAt: stored?.updatedAt ?? null,
    });
    if (!saved.error) return toMerchantMembershipListItem(nextMembership);
    if (saved.error !== "merchant_memberships_conflict" || attempt >= 2) throw new Error(saved.error);
  }
  throw new Error("merchant_memberships_conflict");
}

export async function cancelMerchantMembershipRecharge(
  input: Parameters<typeof cancelMerchantMembershipRechargeUnlocked>[0],
) {
  const siteId = trimText(input.siteId, 64);
  return withMerchantMembershipMutationLock(
    siteId,
    () => cancelMerchantMembershipRechargeUnlocked({ ...input, siteId }),
    input.assertAuthorizationCurrent,
  );
}

export async function getMerchantMembershipRechargeCancellationQuote(input: {
  siteId: string;
  membershipId: string;
  memberNo?: unknown;
  transactionId?: unknown;
}) {
  const supabase = requireMembershipsStoreClient();
  const siteId = trimText(input.siteId, 64);
  const membershipId = trimText(input.membershipId, 160);
  const memberNo = trimText(input.memberNo, 120);
  if (!siteId || (!membershipId && !memberNo)) throw new Error("membership_not_found");
  const stored = await loadStoredMerchantMemberships(supabase, siteId);
  const current = normalizeMerchantMembershipRecords(stored?.memberships ?? []);
  const index = findMerchantMembershipIndexByIdentity(current, { membershipId, memberNo });
  if (index < 0) throw new Error("membership_not_found");
  const membership = current[index];
  if (membership.status !== "active") throw new Error("membership_not_active");
  return quoteMerchantMemberRechargeCancellation({
    membership,
    transactionId: input.transactionId,
  });
}

async function adjustMerchantMembershipRechargeUnlocked(input: {
  siteId: string;
  membershipId: string;
  memberNo?: unknown;
  transactionId?: unknown;
  pointAmount?: unknown;
  balanceAmount?: unknown;
  note?: unknown;
  operatorId?: unknown;
  operationId?: unknown;
  confirmationTransactionId?: unknown;
  assertAuthorizationCurrent?: () => Promise<void>;
}): Promise<MerchantMembershipListItem> {
  const supabase = requireMembershipsStoreClient();
  const siteId = trimText(input.siteId, 64);
  const membershipId = trimText(input.membershipId, 160);
  const memberNo = trimText(input.memberNo, 120);
  if (!siteId || (!membershipId && !memberNo)) throw new Error("membership_not_found");
  const settings = await getMerchantMembershipSettings(siteId).catch(() => null);
  const operationMarker = buildMutationOperationMarker("member-recharge-adjustment", input.operationId);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stored = await loadStoredMerchantMemberships(supabase, siteId);
    const current = normalizeMerchantMembershipRecords(stored?.memberships ?? []);
    const index = findMerchantMembershipIndexByIdentity(current, { membershipId, memberNo });
    if (index < 0) throw new Error("membership_not_found");
    const currentMembership = current[index];
    if (currentMembership.status !== "active") throw new Error("membership_not_active");

    const now = new Date().toISOString();
    const adjustment = adjustMerchantMemberRechargeTransaction({
      membership: currentMembership,
      transactionId: input.transactionId,
      adjustedAt: now,
      pointAmount: input.pointAmount,
      balanceAmount: input.balanceAmount,
      adjustmentNote: input.note,
      adjustedBy: input.operatorId,
      adjustmentOperationMarker: operationMarker,
      confirmationTransactionId: input.confirmationTransactionId,
    });
    if (adjustment.alreadyAdjusted) return toMerchantMembershipListItem(currentMembership);

    const nextMembership = applyMembershipGrowthAndLevel({
      membership: adjustment.membership,
      settings,
      growthDelta: 0,
      now,
    });
    const nextMemberships = [...current];
    nextMemberships[index] = nextMembership;
    const saved = await saveStoredMerchantMemberships(supabase, {
      siteId,
      memberships: nextMemberships,
      updatedAt: now,
      expectedUpdatedAt: stored?.updatedAt ?? null,
    });
    if (!saved.error) return toMerchantMembershipListItem(nextMembership);
    if (saved.error !== "merchant_memberships_conflict" || attempt >= 2) throw new Error(saved.error);
  }
  throw new Error("merchant_memberships_conflict");
}

export async function adjustMerchantMembershipRecharge(
  input: Parameters<typeof adjustMerchantMembershipRechargeUnlocked>[0],
) {
  const siteId = trimText(input.siteId, 64);
  return withMerchantMembershipMutationLock(
    siteId,
    () => adjustMerchantMembershipRechargeUnlocked({ ...input, siteId }),
    input.assertAuthorizationCurrent,
  );
}

type MerchantMembershipRedemptionCartInput = {
  siteId: string;
  membershipId: string;
  memberNo?: unknown;
  items?: unknown;
  note?: unknown;
  operatorId?: unknown;
  operationId?: unknown;
  assertAuthorizationCurrent?: () => Promise<void>;
};

async function applyMerchantMembershipRedemptionCartUnlocked(
  input: MerchantMembershipRedemptionCartInput,
  attempt = 0,
): Promise<MerchantMembershipListItem> {
  const supabase = requireMembershipsStoreClient();
  const siteId = trimText(input.siteId, 64);
  const membershipId = trimText(input.membershipId, 160);
  const memberNo = trimText(input.memberNo, 120);
  if (!siteId || (!membershipId && !memberNo)) throw new Error("membership_not_found");
  const settings = await getMerchantMembershipSettings(siteId).catch(() => null);
  if (!settings) throw new Error("membership_settings_unavailable");
  const requestedItems = Array.isArray(input.items)
    ? input.items
        .map((entry) => {
          const record = readRecord(entry);
          if (!record) return null;
          const itemId = trimText(record.redemptionItemId ?? record.itemId ?? record.id, 120);
          const normalizedQuantity = normalizePositiveInteger(record.quantity) || 1;
          if (normalizedQuantity > 9999) throw new Error("membership_redemption_quantity_invalid");
          const quantity = Math.max(1, normalizedQuantity);
          const customName = trimText(record.customName, 120);
          const customCode = trimText(record.customCode, 120);
          const customPoints = normalizePositiveInteger(record.customPoints);
          const couponId = trimText(record.couponId, 160);
          const couponClaimId = trimText(record.couponClaimId, 160);
          const couponSettlementCode = trimText(record.couponSettlementCode ?? record.settlementCode, 200);
          const couponTitle = trimText(record.couponTitle, 120);
          const couponDiscountLabel = trimText(record.couponDiscountLabel, 160);
          if (itemId) {
            return {
              itemId,
              quantity,
              customName: "",
              customCode: "",
              customPoints: 0,
              couponId: "",
              couponClaimId: "",
              couponSettlementCode: "",
              couponTitle: "",
              couponDiscountLabel: "",
            };
          }
          if (customName && (customPoints > 0 || couponSettlementCode)) {
            return {
              itemId: couponSettlementCode
                ? `coupon:${couponClaimId || couponSettlementCode}`
                : `custom:${customName}:${customPoints}`,
              quantity,
              customName,
              customCode,
              customPoints,
              couponId,
              couponClaimId,
              couponSettlementCode,
              couponTitle,
              couponDiscountLabel,
            };
          }
          return null;
        })
        .filter(
          (
            entry,
          ): entry is {
            itemId: string;
            quantity: number;
            customName: string;
            customCode: string;
            customPoints: number;
            couponId: string;
            couponClaimId: string;
            couponSettlementCode: string;
            couponTitle: string;
            couponDiscountLabel: string;
          } => Boolean(entry),
        )
    : [];
  const quantityByItemId = new Map<
    string,
    {
      quantity: number;
      customName: string;
      customCode: string;
      customPoints: number;
      couponId: string;
      couponClaimId: string;
      couponSettlementCode: string;
      couponTitle: string;
      couponDiscountLabel: string;
    }
  >();
  requestedItems.forEach((entry) => {
    const current = quantityByItemId.get(entry.itemId) ?? {
      quantity: 0,
      customName: entry.customName,
      customCode: entry.customCode,
      customPoints: entry.customPoints,
      couponId: entry.couponId,
      couponClaimId: entry.couponClaimId,
      couponSettlementCode: entry.couponSettlementCode,
      couponTitle: entry.couponTitle,
      couponDiscountLabel: entry.couponDiscountLabel,
    };
    quantityByItemId.set(entry.itemId, {
      ...current,
      quantity: current.quantity + entry.quantity,
    });
  });
  const cartItems = Array.from(quantityByItemId.entries()).map(([itemId, entry]) => ({ itemId, ...entry }));
  if (cartItems.length === 0) throw new Error("membership_operation_empty");
  if (cartItems.length > 100 || cartItems.some((item) => item.quantity > 9999)) {
    throw new Error("membership_redemption_quantity_invalid");
  }

  const stored = await loadStoredMerchantMemberships(supabase, siteId);
  const current = normalizeMerchantMembershipRecords(stored?.memberships ?? []);
  const index = findMerchantMembershipIndexByIdentity(current, { membershipId, memberNo });
  if (index < 0) throw new Error("membership_not_found");
  const currentMembership = current[index];
  const operationMarker = buildMutationOperationMarker("member-redemption-checkout", input.operationId);
  if (!operationMarker) throw new Error("mutation_operation_id_required");
  const alreadyApplied = transactionHasMarker(currentMembership, operationMarker);
  if (currentMembership.status !== "active") throw new Error("membership_not_active");

  const redemptionRows = cartItems.map((cartItem) => {
    const item = settings.redemptionItems.find((entry) => entry.enabled && entry.id === cartItem.itemId);
    if (!item && cartItem.customName && cartItem.customPoints > 0) {
      return {
        item: {
          id: cartItem.itemId,
          categoryId: "",
          code: cartItem.customCode,
          barcode: "",
          name: cartItem.customName,
          imageUrl: "",
          iconName: "",
          description: "",
          enabled: true,
          pointsCost: cartItem.customPoints,
          referenceAmount: null,
          memberPrice: null,
          taxRate: null,
          stock: null,
          pointProduct: true,
          recommended: false,
          sort: 0,
        },
        quantity: cartItem.quantity,
        unitPoints: cartItem.customPoints,
        subtotalPoints: cartItem.customPoints * cartItem.quantity,
        custom: true,
        couponId: "",
        couponClaimId: "",
        couponSettlementCode: "",
        couponTitle: "",
        couponDiscountLabel: "",
      };
    }
    if (!item && cartItem.customName && cartItem.couponSettlementCode) {
      if (cartItem.quantity !== 1) throw new Error("membership_redemption_quantity_invalid");
      return {
        item: {
          id: cartItem.itemId,
          categoryId: "",
          code: cartItem.customCode,
          barcode: "",
          name: cartItem.customName,
          imageUrl: "",
          iconName: "",
          description: cartItem.couponDiscountLabel || cartItem.couponTitle,
          enabled: true,
          pointsCost: 0,
          referenceAmount: null,
          memberPrice: null,
          taxRate: null,
          stock: null,
          pointProduct: true,
          recommended: false,
          sort: 0,
        },
        quantity: cartItem.quantity,
        unitPoints: 0,
        subtotalPoints: 0,
        custom: true,
        couponId: cartItem.couponId,
        couponClaimId: cartItem.couponClaimId,
        couponSettlementCode: cartItem.couponSettlementCode,
        couponTitle: cartItem.couponTitle,
        couponDiscountLabel: cartItem.couponDiscountLabel,
      };
    }
    if (!item) throw new Error("membership_redemption_item_not_found");
    if (item.stock !== null && cartItem.quantity > item.stock) throw new Error("membership_redemption_stock_insufficient");
    const unitPoints = getRedemptionPointCostForMember(item, currentMembership, settings);
    return {
      item,
      quantity: cartItem.quantity,
      unitPoints,
      subtotalPoints: unitPoints * cartItem.quantity,
      custom: false,
      couponId: "",
      couponClaimId: "",
      couponSettlementCode: "",
      couponTitle: "",
      couponDiscountLabel: "",
    };
  });
  const stockDeltas = redemptionRows
    .filter((row) => !row.custom && row.item.stock !== null)
    .map((row) => ({ itemId: row.item.id, quantity: row.quantity }));
  const grossPoints = redemptionRows.reduce((sum, row) => sum + row.subtotalPoints, 0);
  const couponRedemptionRows = redemptionRows.filter((row) => row.couponSettlementCode);
  if (grossPoints <= 0 && couponRedemptionRows.length === 0) throw new Error("membership_operation_empty");
  const fallbackNote = trimText(input.note, 500);
  const couponRedemptionRequests = couponRedemptionRows.map((row) => ({
    settlementCode: row.couponSettlementCode,
    expectedCouponId: row.couponId,
    expectedClaimEventId: row.couponClaimId,
    operationId: input.operationId,
    operationScope: "member-redemption-checkout",
    note: fallbackNote || `积分兑换使用卡券：${row.couponTitle || row.item.name}`,
    expectedAccountId: currentMembership.accountId,
    expectedUserId: currentMembership.userId,
    expectedEmail: currentMembership.email,
    allowedDiscountTypes: MERCHANT_COUPON_DIRECT_REDEMPTION_DISCOUNT_TYPES,
  }));
  const couponPreviews =
    couponRedemptionRequests.length > 0
      ? await redeemMerchantCouponRecords({
          siteId,
          operatorId: trimText(input.operatorId, 120),
          redemptions: couponRedemptionRequests,
          commit: false,
        })
      : [];
  const pointsVoucherPreviews = couponPreviews.filter(isPointsVoucherCoupon);
  const rawCouponPointDiscountTotal = couponPreviews.reduce(
    (sum, coupon) => sum + readPointsVoucherDiscount(coupon),
    0,
  );
  if (grossPoints <= 0 && rawCouponPointDiscountTotal > 0) throw new Error("coupon_points_voucher_requires_points");
  const pointsVoucherLimit = pointsVoucherPreviews.reduce((limit, coupon) => {
    const couponLimit = readPointsVoucherLimit(coupon);
    if (couponLimit <= 0) return limit;
    return limit <= 0 ? couponLimit : Math.min(limit, couponLimit);
  }, 0);
  if (pointsVoucherLimit > 0 && pointsVoucherPreviews.length > pointsVoucherLimit) {
    throw new Error("coupon_points_voucher_limit_exceeded");
  }
  if (
    pointsVoucherPreviews.some((coupon) => {
      const minimumRedeemPoints = readPointsVoucherMinimumRedeemPoints(coupon);
      return minimumRedeemPoints > 0 && grossPoints < minimumRedeemPoints;
    })
  ) {
    throw new Error("coupon_points_voucher_minimum_not_met");
  }
  const couponPointDiscountTotal = Math.min(grossPoints, rawCouponPointDiscountTotal);
  const totalPoints = Math.max(0, grossPoints - couponPointDiscountTotal);
  if (![grossPoints, couponPointDiscountTotal, totalPoints].every(Number.isSafeInteger)) {
    throw new Error("membership_redemption_quantity_invalid");
  }

  const commitCouponRedemptions = async () => {
    if (couponRedemptionRows.length === 0) return;
    let lastError: unknown = null;
    for (let commitAttempt = 0; commitAttempt < 3; commitAttempt += 1) {
      try {
        await redeemMerchantCouponRecords({
          siteId,
          operatorId: trimText(input.operatorId, 120),
          redemptions: couponRedemptionRequests,
        });
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("coupon_redeem_failed");
  };
  const rollbackCouponRedemptions = async () => {
    if (couponRedemptionRows.length === 0) return;
    await releaseMerchantCouponRedemptions({ siteId, redemptions: couponRedemptionRequests });
  };

  if (alreadyApplied) {
    await commitCouponRedemptions();
    return toMerchantMembershipListItem(currentMembership);
  }
  const nextPointBalance = currentMembership.pointBalance - totalPoints;
  if (nextPointBalance < 0) throw new Error("membership_balance_insufficient");

  await commitCouponRedemptions();
  if (stockDeltas.length > 0) {
    try {
      await reserveMerchantMembershipRedemptionStock({
        siteId,
        operationId: input.operationId,
        deltas: stockDeltas,
        expectedUpdatedAt: settings.updatedAt,
      });
    } catch (error) {
      try {
        await rollbackCouponRedemptions();
      } catch {
        throw new Error("membership_redemption_rollback_failed");
      }
      if (error instanceof Error && error.message === "merchant_membership_settings_conflict" && attempt < 2) {
        return applyMerchantMembershipRedemptionCartUnlocked(input, attempt + 1);
      }
      throw error;
    }
  }

  const now = new Date().toISOString();
  const growthDelta = settings ? totalPoints * settings.growthRules.spendPointGrowth : 0;
  const summary = redemptionRows.map((row) => `${row.item.name} x ${row.quantity}`).join(" / ");
  let nextMembership: MerchantMembershipRecord = {
    ...currentMembership,
    pointBalance: nextPointBalance,
    transactions: [
      createMerchantMemberTransaction({
        type: "redeem",
        at: now,
        pointDelta: -totalPoints,
        balanceDelta: 0,
        growthDelta,
        note: buildMembershipMutationNote(input.note, `积分兑换：${summary}`, operationMarker),
        operatorId: trimText(input.operatorId, 120),
      }),
      ...currentMembership.transactions,
    ],
    updatedAt: now,
  };
  nextMembership = applyMembershipGrowthAndLevel({
    membership: nextMembership,
    settings,
    growthDelta,
    now,
  });
  const nextMemberships = [...current];
  nextMemberships[index] = nextMembership;
  const saved = await saveStoredMerchantMemberships(supabase, {
    siteId,
    memberships: nextMemberships,
    updatedAt: now,
    expectedUpdatedAt: stored?.updatedAt ?? null,
  });
  if (saved.error) {
    let rollbackFailed = false;
    if (stockDeltas.length > 0) {
      try {
        await releaseMerchantMembershipRedemptionStock({
          siteId,
          operationId: input.operationId,
          deltas: stockDeltas,
        });
      } catch {
        rollbackFailed = true;
      }
    }
    try {
      await rollbackCouponRedemptions();
    } catch {
      rollbackFailed = true;
    }
    if (rollbackFailed) throw new Error("membership_redemption_rollback_failed");
    if (saved.error === "merchant_memberships_conflict" && attempt < 2) {
      return applyMerchantMembershipRedemptionCartUnlocked(input, attempt + 1);
    }
    throw new Error(saved.error);
  }

  return toMerchantMembershipListItem(nextMembership);
}

export async function applyMerchantMembershipRedemptionCart(
  input: MerchantMembershipRedemptionCartInput,
): Promise<MerchantMembershipListItem> {
  const siteId = trimText(input.siteId, 64);
  if (!siteId) throw new Error("invalid_site_id");
  return withMerchantMembershipMutationLock(
    siteId,
    () => applyMerchantMembershipRedemptionCartUnlocked({ ...input, siteId }),
    input.assertAuthorizationCurrent,
  );
}

function findMembershipIndexForOrder(memberships: MerchantMembershipRecord[], order: MerchantOrderRecord) {
  const normalizedEmail = trimText(order.customerLoginEmail || order.customer.email).toLowerCase();
  return memberships.findIndex((membership) => {
    if (membership.status !== "active") return false;
    if (order.customerAccountId && membership.accountId === order.customerAccountId) return true;
    if (order.customerUserId && membership.userId === order.customerUserId) return true;
    return Boolean(normalizedEmail) && membership.email.toLowerCase() === normalizedEmail;
  });
}

function findActiveOrderPointAward(membership: MerchantMembershipRecord, orderId: string) {
  const marker = `[order-points:${orderId}]`;
  return membership.transactions.find(
    (transaction) =>
      transaction.type === "recharge" &&
      transaction.status === "completed" &&
      !transaction.adjustmentKind &&
      transaction.note.includes(marker),
  );
}

export function awardOrderPointsToMembership(input: {
  membership: MerchantMembershipRecord;
  order: MerchantOrderRecord;
  settings: MerchantMembershipSettings;
  now: string;
}) {
  if (findActiveOrderPointAward(input.membership, input.order.id)) return input.membership;
  const points = calculateOrderPoints(input.order, input.settings);
  const growthDelta =
    input.order.totalAmount * input.settings.growthRules.spendAmountGrowth +
    points * input.settings.growthRules.spendPointGrowth;
  if (points <= 0 && growthDelta <= 0) return input.membership;
  const marker = `[order-points:${input.order.id}]`;
  let nextMembership: MerchantMembershipRecord = {
    ...input.membership,
    pointBalance: input.membership.pointBalance + points,
    transactions: [
      createMerchantMemberTransaction({
        type: "recharge",
        at: input.now,
        pointDelta: points,
        growthDelta,
        note: points > 0 ? `订单实付赠送积分 ${marker}` : `订单成长值记录 ${marker}`,
        operatorId: "system",
      }),
      ...input.membership.transactions,
    ],
    updatedAt: input.now,
  };
  nextMembership = applyMembershipGrowthAndLevel({
    membership: nextMembership,
    settings: input.settings,
    growthDelta,
    now: input.now,
  });
  return nextMembership;
}

export function revokeOrderPointsFromMembership(input: {
  membership: MerchantMembershipRecord;
  order: MerchantOrderRecord;
  settings: MerchantMembershipSettings | null;
  now: string;
}) {
  const activeAward = findActiveOrderPointAward(input.membership, input.order.id);
  if (!activeAward) return input.membership;
  const marker = `[order-points-reversal:${input.order.id}]`;
  const cancellation = cancelMerchantMemberRechargeTransaction({
    membership: input.membership,
    transactionId: activeAward.id,
    cancelledAt: input.now,
    cancellationNote: `订单 ${input.order.id} 状态回退`,
    cancelledBy: "system",
    cancellationOperationMarker: marker,
    allowGrowthOnly: true,
  });
  return applyMembershipGrowthAndLevel({
    membership: cancellation.membership,
    settings: input.settings,
    growthDelta: 0,
    now: input.now,
  });
}

export async function syncMerchantMembershipPointsForOrderTransitions(
  transitions: Array<{ previous: MerchantOrderRecord; next: MerchantOrderRecord }>,
) {
  const relevant = transitions.filter(
    ({ previous, next }) =>
      (previous.status !== "completed" && next.status === "completed") ||
      (previous.status === "completed" && next.status !== "completed"),
  );
  if (relevant.length === 0) return [];
  const siteId = trimText(relevant[0]?.next.siteId || relevant[0]?.previous.siteId, 64);
  if (!siteId || relevant.some(({ previous, next }) => previous.siteId !== siteId || next.siteId !== siteId)) {
    throw new Error("invalid_site_id");
  }

  const supabase = requireMembershipsStoreClient();
  let settings: MerchantMembershipSettings | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stored = await loadStoredMerchantMemberships(supabase, siteId);
    const memberships = normalizeMerchantMembershipRecords(stored?.memberships ?? []);
    const hasMatchingMembership = relevant.some(({ previous, next }) => {
      const order = next.status === "completed" ? next : previous;
      return findMembershipIndexForOrder(memberships, order) >= 0;
    });
    if (!hasMatchingMembership) return memberships.map(toMerchantMembershipListItem);
    settings = settings ?? (await getMerchantMembershipSettings(siteId));
    const nextMemberships = [...memberships];
    const now = new Date().toISOString();
    let changed = false;

    for (const transition of relevant) {
      const order = transition.next.status === "completed" ? transition.next : transition.previous;
      const index = findMembershipIndexForOrder(nextMemberships, order);
      if (index < 0) continue;
      const currentMembership = nextMemberships[index];
      const nextMembership = transition.next.status === "completed"
        ? awardOrderPointsToMembership({ membership: currentMembership, order: transition.next, settings, now })
        : revokeOrderPointsFromMembership({ membership: currentMembership, order: transition.previous, settings, now });
      if (nextMembership === currentMembership) continue;
      nextMemberships[index] = nextMembership;
      changed = true;
    }

    if (!changed) return nextMemberships.map(toMerchantMembershipListItem);
    const saved = await saveStoredMerchantMemberships(supabase, {
      siteId,
      memberships: nextMemberships,
      updatedAt: now,
      expectedUpdatedAt: stored?.updatedAt ?? null,
    });
    if (!saved.error) return nextMemberships.map(toMerchantMembershipListItem);
    if (saved.error !== "merchant_memberships_conflict" || attempt >= 2) throw new Error(saved.error);
  }
  throw new Error("merchant_memberships_conflict");
}

export async function awardMerchantMembershipPointsForOrder(order: MerchantOrderRecord) {
  if (order.status !== "completed") return null;
  const previous = { ...order, status: "confirmed" as const };
  const memberships = await syncMerchantMembershipPointsForOrderTransitions([{ previous, next: order }]);
  const index = memberships.findIndex((membership) => membership.siteId === order.siteId && findMembershipIndexForOrder([membership], order) === 0);
  return index >= 0 ? memberships[index] : null;
}

export async function quoteMerchantMembershipPointDeduction(input: {
  siteId: string;
  membershipId: string;
  orderAmount: unknown;
  requestedPoints: unknown;
}) {
  const supabase = requireMembershipsStoreClient();
  const siteId = trimText(input.siteId, 64);
  const membershipId = trimText(input.membershipId, 160);
  if (!siteId || !membershipId) throw new Error("membership_not_found");
  const [stored, settings] = await Promise.all([
    loadStoredMerchantMemberships(supabase, siteId),
    getMerchantMembershipSettings(siteId),
  ]);
  const membership = normalizeMerchantMembershipRecords(stored?.memberships ?? []).find((item) =>
    matchesMerchantMembershipBusinessId(toMerchantMembershipListItem(item), membershipId),
  );
  if (!membership || membership.status !== "active") throw new Error("membership_not_found");
  return calculateMerchantMemberPointDeduction({
    orderAmount: normalizePositiveMoney(input.orderAmount),
    pointBalance: membership.pointBalance,
    requestedPoints: normalizePositiveInteger(input.requestedPoints),
    settings,
  });
}

async function applyMerchantMembershipPointDeductionUnlocked(input: {
  siteId: string;
  membershipId: string;
  orderAmount: unknown;
  requestedPoints: unknown;
  orderId?: unknown;
  operationId?: unknown;
  operatorId?: string;
  assertAuthorizationCurrent?: () => Promise<void>;
}) {
  const supabase = requireMembershipsStoreClient();
  const siteId = trimText(input.siteId, 64);
  const membershipId = trimText(input.membershipId, 160);
  if (!siteId || !membershipId) throw new Error("membership_not_found");
  const settings = await getMerchantMembershipSettings(siteId);
  const orderId = trimText(input.orderId, 160);
  const marker = orderId
    ? `[point-deduction:${orderId}]`
    : buildMutationOperationMarker("point-deduction", input.operationId);
  if (!marker) throw new Error("mutation_operation_id_required");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stored = await loadStoredMerchantMemberships(supabase, siteId);
    const current = normalizeMerchantMembershipRecords(stored?.memberships ?? []);
    const membershipIndex = current.findIndex((item) =>
      matchesMerchantMembershipBusinessId(toMerchantMembershipListItem(item), membershipId),
    );
    if (membershipIndex < 0 || current[membershipIndex]?.status !== "active") throw new Error("membership_not_found");
    const currentMembership = current[membershipIndex];
    const existingTransaction = currentMembership.transactions.find((transaction) => transaction.note.includes(marker));
    if (existingTransaction) {
      const existingPoints = Math.abs(Math.min(0, existingTransaction.pointDelta));
      const existingAmount = Number.parseFloat(
        existingTransaction.note.match(/订单积分抵扣\s+([0-9]+(?:\.[0-9]+)?)/)?.[1] ?? "0",
      );
      const amount = Number.isFinite(existingAmount) ? existingAmount : 0;
      return {
        membership: toMerchantMembershipListItem(currentMembership),
        quote: { points: existingPoints, amount, maxPoints: existingPoints, maxAmount: amount },
        alreadyApplied: true,
      };
    }
    const quote = calculateMerchantMemberPointDeduction({
      orderAmount: normalizePositiveMoney(input.orderAmount),
      pointBalance: currentMembership.pointBalance,
      requestedPoints: normalizePositiveInteger(input.requestedPoints),
      settings,
    });
    if (quote.points <= 0 || quote.amount <= 0) {
      throw new Error("point_deduction_unavailable");
    }
    const now = new Date().toISOString();
    const growthDelta = quote.points * settings.growthRules.spendPointGrowth;
    let nextMembership: MerchantMembershipRecord = {
      ...currentMembership,
      pointBalance: Math.max(0, currentMembership.pointBalance - quote.points),
      transactions: [
        createMerchantMemberTransaction({
          type: "redeem",
          at: now,
          pointDelta: -quote.points,
          growthDelta,
          note: `订单积分抵扣 ${quote.amount.toFixed(2)} ${marker}`,
          operatorId: trimText(input.operatorId, 120) || "system",
        }),
        ...currentMembership.transactions,
      ],
      updatedAt: now,
    };
    nextMembership = applyMembershipGrowthAndLevel({
      membership: nextMembership,
      settings,
      growthDelta,
      now,
    });
    const nextMemberships = [...current];
    nextMemberships[membershipIndex] = nextMembership;
    const saved = await saveStoredMerchantMemberships(supabase, {
      siteId,
      memberships: nextMemberships,
      updatedAt: now,
      expectedUpdatedAt: stored?.updatedAt ?? null,
    });
    if (!saved.error) {
      return { membership: toMerchantMembershipListItem(nextMembership), quote, alreadyApplied: false };
    }
    if (saved.error !== "merchant_memberships_conflict" || attempt >= 2) throw new Error(saved.error);
  }
  throw new Error("merchant_memberships_conflict");
}

export async function applyMerchantMembershipPointDeduction(
  input: Parameters<typeof applyMerchantMembershipPointDeductionUnlocked>[0],
) {
  const siteId = trimText(input.siteId, 64);
  return withMerchantMembershipMutationLock(
    siteId,
    () => applyMerchantMembershipPointDeductionUnlocked({ ...input, siteId }),
    input.assertAuthorizationCurrent,
  );
}

export async function joinMerchantMembership(input: {
  siteId: string;
  siteName: string;
  session: PersonalAccountSession;
  profile?: unknown;
}): Promise<MerchantMembershipRecord> {
  const supabase = requireMembershipsStoreClient();
  const siteId = trimText(input.siteId, 64);
  if (!siteId) throw new Error("invalid_site_id");
  const siteName = trimText(input.siteName, 120) || siteId;
  const settings = await getMerchantMembershipSettings(siteId).catch(() => null);
  const profile = normalizeMerchantMembershipProfileDraft(input.profile, readPersonalMembershipProfileFromSession(input.session));
  const profileValidationError = getMerchantMembershipProfileValidationError(profile);
  if (profileValidationError) throw new Error(profileValidationError);
  const nextMembership = await withMerchantMembershipMutationLock(siteId, async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const stored = await loadStoredMerchantMemberships(supabase, siteId);
      const current = normalizeMerchantMembershipRecords(stored?.memberships ?? []);
      const existingIndex = current.findIndex(
        (membership) =>
          (membership.accountId && membership.accountId === input.session.accountId) ||
          (membership.userId && membership.userId === input.session.userId),
      );
      const now = new Date().toISOString();
      const baseProfile = {
        siteName,
        accountId: input.session.accountId,
        userId: input.session.userId,
        email: profile.email || input.session.email,
        nickname: profile.nickname,
        name: profile.name,
        phone: profile.phone,
        avatarUrl: profile.avatarUrl,
        birthday: profile.birthday,
        birthdayMonthDayOnly: profile.birthdayMonthDayOnly,
        gender: profile.gender,
        country: profile.country,
        province: profile.province,
        city: profile.city,
        address: profile.address,
        taxName: profile.taxName,
        taxNumber: profile.taxNumber,
        taxCountry: profile.taxCountry,
        taxProvince: profile.taxProvince,
        taxCity: profile.taxCity,
        taxAddress: profile.taxAddress,
        allergens: profile.allergens,
        status: "active" as const,
        leftAt: null,
        updatedAt: now,
      };

      let membership: MerchantMembershipRecord =
        existingIndex >= 0
          ? {
              ...current[existingIndex],
              ...baseProfile,
            }
          : (() => {
              const serial = current.reduce((max, item) => Math.max(max, item.serial), 0) + 1;
              return {
                id: `${siteId}:${input.session.accountId || input.session.userId}`,
                siteId,
                memberNo: buildMerchantMemberNo(siteId, serial),
                serial,
                joinedAt: now,
                pointBalance: 0,
                balanceAmount: 0,
                growthValue: 0,
                levelId: "",
                transactions: [],
                ...baseProfile,
              } satisfies MerchantMembershipRecord;
            })();
      if (settings) {
        membership = applyJoinPoints(membership, settings, now);
        membership = applyMembershipGrowthAndLevel({ membership, settings, now });
      }
      const nextMemberships = existingIndex >= 0 ? [...current] : [membership, ...current];
      if (existingIndex >= 0) nextMemberships[existingIndex] = membership;
      const saved = await saveStoredMerchantMemberships(supabase, {
        siteId,
        memberships: nextMemberships,
        updatedAt: now,
        expectedUpdatedAt: stored?.updatedAt ?? null,
      });
      if (!saved.error) return membership;
      if (saved.error !== "merchant_memberships_conflict" || attempt >= 2) throw new Error(saved.error);
    }
    throw new Error("merchant_memberships_conflict");
  });
  await writePersonalMembershipToMetadata(input.session, nextMembership);
  return nextMembership;
}

export async function leaveMerchantMembership(input: {
  siteId: string;
  session: PersonalAccountSession;
}): Promise<MerchantMembershipRecord> {
  const supabase = requireMembershipsStoreClient();
  const siteId = trimText(input.siteId, 64);
  if (!siteId) throw new Error("invalid_site_id");
  const nextMembership = await withMerchantMembershipMutationLock(siteId, async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const stored = await loadStoredMerchantMemberships(supabase, siteId);
      const current = normalizeMerchantMembershipRecords(stored?.memberships ?? []);
      const index = current.findIndex(
        (membership) =>
          (membership.accountId && membership.accountId === input.session.accountId) ||
          (membership.userId && membership.userId === input.session.userId),
      );
      if (index < 0) throw new Error("membership_not_found");
      if (current[index]?.status === "left") return current[index];
      const now = new Date().toISOString();
      const membership = {
        ...current[index],
        status: "left" as const,
        leftAt: now,
        updatedAt: now,
      };
      const nextMemberships = [...current];
      nextMemberships[index] = membership;
      const saved = await saveStoredMerchantMemberships(supabase, {
        siteId,
        memberships: nextMemberships,
        updatedAt: now,
        expectedUpdatedAt: stored?.updatedAt ?? null,
      });
      if (!saved.error) return membership;
      if (saved.error !== "merchant_memberships_conflict" || attempt >= 2) throw new Error(saved.error);
    }
    throw new Error("merchant_memberships_conflict");
  });
  await writePersonalMembershipToMetadata(input.session, toPersonalMembershipCard(nextMembership));
  return nextMembership;
}
