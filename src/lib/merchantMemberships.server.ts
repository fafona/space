import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import {
  buildMerchantMemberNo,
  buildMerchantMembershipQrValue,
  normalizeMerchantMemberAllergens,
  normalizeMerchantMembershipRecords,
  normalizeMerchantMembershipProfileDraft,
  toMerchantMembershipListItem,
  toPersonalMembershipCard,
  writePersonalMembershipCardToUserMetadata,
  type MerchantMemberAccountTransactionType,
  type MerchantMembershipProfileDraft,
  type MerchantMembershipListItem,
  type MerchantMembershipRecord,
  type PersonalMembershipCard,
} from "@/lib/merchantMemberships";
import {
  getMerchantMembershipSettings,
  updateMerchantMembershipSettings,
} from "@/lib/merchantMembershipSettings.server";
import {
  calculateMerchantMemberPointDeduction,
  getMerchantMemberHolidayNamesForDate,
  parseMerchantMemberPointDiscountRate,
  type MerchantMemberLevel,
  type MerchantMembershipSettings,
} from "@/lib/merchantMembershipSettings";
import type { MerchantOrderRecord } from "@/lib/merchantOrders";
import { loadStoredMerchantMemberships, saveStoredMerchantMemberships } from "@/lib/merchantMembershipsStore";
import { readPersonalCustomerProfileFromSession } from "@/lib/personalCustomerProfile";
import type { PersonalAccountSession } from "@/lib/personalAccountSession.server";

function requireMembershipsStoreClient() {
  const supabase = createServerSupabaseServiceClient();
  if (!supabase) {
    throw new Error("memberships_store_unavailable");
  }
  return supabase;
}

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizePositiveInteger(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(trimText(value));
  if (!Number.isFinite(numberValue) || numberValue <= 0) return 0;
  return Math.round(numberValue);
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
}) {
  const at = input.at ?? new Date().toISOString();
  return {
    id: `MT${Date.parse(at).toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    type: input.type,
    at,
    pointDelta: Math.round(input.pointDelta),
    balanceDelta: Number((input.balanceDelta ?? 0).toFixed(2)),
    growthDelta: normalizeGrowthValue(input.growthDelta ?? 0),
    note: trimText(input.note, 500),
    operatorId: trimText(input.operatorId, 120),
  };
}

function transactionHasMarker(membership: MerchantMembershipRecord, marker: string) {
  return membership.transactions.some((transaction) => transaction.note.includes(marker));
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
  const matchedDateRule = settings.pointsRules.holidayRules.some((rule) => rule.enabled && rule.date === orderDateText);
  const holidayNames = getMerchantMemberHolidayNamesForDate(orderDate);
  const matchedLegacyHoliday = holidayNames.some((holidayName) => settings.pointsRules.holidayNames.includes(holidayName));
  const shouldApplyHolidayMultiplier = matchedDateRule || matchedLegacyHoliday;
  const multiplier = shouldApplyHolidayMultiplier ? Math.max(0, settings.pointsRules.holidayMultiplier || 1) : 1;
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
        return Number.isFinite(timestamp) && new Date(timestamp).getFullYear() === currentYear;
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
  item: { pointsCost: number },
  membership: MerchantMembershipRecord,
  settings: MerchantMembershipSettings | null,
) {
  if (!settings) return item.pointsCost;
  const level = getMembershipLevel(settings, membership);
  const rate = parseMerchantMemberPointDiscountRate(level?.benefit.pointDiscount);
  return Math.max(0, Math.ceil(item.pointsCost * rate));
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
    ].slice(0, 500),
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
    ].slice(0, 500),
    updatedAt: now,
  };
}

async function applyScheduledPointRules(siteId: string, memberships: MerchantMembershipRecord[]) {
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
        ].slice(0, 500),
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
      const expiredPositive = next.transactions
        .filter((transaction) => transaction.pointDelta > 0 && Date.parse(transaction.at) < cutoff)
        .reduce((sum, transaction) => sum + transaction.pointDelta, 0);
      const alreadyExpired = next.transactions
        .filter((transaction) => transaction.note.includes("[points-expired]"))
        .reduce((sum, transaction) => sum + Math.abs(Math.min(0, transaction.pointDelta)), 0);
      const expiredDelta = Math.min(next.pointBalance, Math.max(0, expiredPositive - alreadyExpired));
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
          ].slice(0, 500),
          updatedAt: now,
        };
        changed = true;
      }
    }
    return next;
  });
  if (!changed) return memberships;
  const supabase = requireMembershipsStoreClient();
  const saved = await saveStoredMerchantMemberships(supabase, { siteId, memberships: nextMemberships, updatedAt: now });
  if (saved.error) throw new Error(saved.error);
  return nextMemberships;
}

export async function listMerchantMemberships(siteId: string): Promise<MerchantMembershipListItem[]> {
  const supabase = requireMembershipsStoreClient();
  const stored = await loadStoredMerchantMemberships(supabase, siteId);
  const memberships = normalizeMerchantMembershipRecords(stored?.memberships ?? []);
  const nextMemberships = await applyScheduledPointRules(siteId, memberships);
  return nextMemberships.map(toMerchantMembershipListItem);
}

export async function updateMerchantMembershipAllergens(input: {
  siteId: string;
  membershipId: string;
  allergens: unknown;
}): Promise<MerchantMembershipListItem> {
  const supabase = requireMembershipsStoreClient();
  const siteId = trimText(input.siteId, 64);
  const membershipId = trimText(input.membershipId, 160);
  if (!siteId || !membershipId) throw new Error("membership_not_found");
  const stored = await loadStoredMerchantMemberships(supabase, siteId);
  const current = normalizeMerchantMembershipRecords(stored?.memberships ?? []);
  const index = current.findIndex((membership) => membership.id === membershipId);
  if (index < 0) throw new Error("membership_not_found");
  const now = new Date().toISOString();
  const nextMembership = {
    ...current[index],
    allergens: normalizeMerchantMemberAllergens(input.allergens),
    updatedAt: now,
  };
  const nextMemberships = [...current];
  nextMemberships[index] = nextMembership;
  const saved = await saveStoredMerchantMemberships(supabase, {
    siteId,
    memberships: nextMemberships,
    updatedAt: now,
  });
  if (saved.error) throw new Error(saved.error);
  return toMerchantMembershipListItem(nextMembership);
}

type MerchantMembershipPointRuleAction = "checkin" | "invitation" | "review";

function findActiveMembershipIndex(
  memberships: MerchantMembershipRecord[],
  input: { membershipId?: unknown; session?: PersonalAccountSession | null },
) {
  const membershipId = trimText(input.membershipId, 160);
  return memberships.findIndex((membership) => {
    if (membership.status !== "active") return false;
    if (membershipId && membership.id === membershipId) return true;
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

export async function awardMerchantMembershipRulePoints(input: {
  siteId: string;
  membershipId?: unknown;
  session?: PersonalAccountSession | null;
  action: MerchantMembershipPointRuleAction;
  referenceId?: unknown;
  operatorId?: unknown;
}): Promise<MerchantMembershipListItem> {
  const supabase = requireMembershipsStoreClient();
  const siteId = trimText(input.siteId, 64);
  if (!siteId) throw new Error("invalid_site_id");
  const [stored, settings] = await Promise.all([
    loadStoredMerchantMemberships(supabase, siteId),
    getMerchantMembershipSettings(siteId),
  ]);
  const current = normalizeMerchantMembershipRecords(stored?.memberships ?? []);
  const index = findActiveMembershipIndex(current, input);
  if (index < 0) throw new Error("membership_not_found");
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const dayKey = formatDateYmd(nowDate);
  const currentMembership = current[index];
  let points = 0;
  let marker = "";
  let note = "";

  if (input.action === "checkin") {
    points = settings.pointsRules.checkinPoints;
    const previousMarker = `[checkin-points:${getPreviousDateYmd(nowDate)}]`;
    const continuousPoints = transactionHasMarker(currentMembership, previousMarker)
      ? settings.pointsRules.continuousCheckinPoints
      : 0;
    points += continuousPoints;
    marker = `[checkin-points:${dayKey}]`;
    note = continuousPoints > 0 ? `签到积分，含连续签到 ${continuousPoints} 分 ${marker}` : `签到积分 ${marker}`;
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
  if (points <= 0 && !shouldRecordZeroCheckin) return toMerchantMembershipListItem(currentMembership);
  if (transactionHasMarker(currentMembership, marker)) return toMerchantMembershipListItem(currentMembership);
  const nextMembership = {
    ...currentMembership,
    pointBalance: currentMembership.pointBalance + points,
    transactions: [
      createMerchantMemberTransaction({
        type: "recharge",
        at: now,
        pointDelta: points,
        note,
        operatorId: trimText(input.operatorId, 120) || (input.session ? input.session.accountId : "system"),
      }),
      ...currentMembership.transactions,
    ].slice(0, 500),
    updatedAt: now,
  };
  const nextMemberships = [...current];
  nextMemberships[index] = nextMembership;
  const saved = await saveStoredMerchantMemberships(supabase, {
    siteId,
    memberships: nextMemberships,
    updatedAt: now,
  });
  if (saved.error) throw new Error(saved.error);
  return toMerchantMembershipListItem(nextMembership);
}

export async function applyMerchantMembershipAccountOperation(input: {
  siteId: string;
  membershipId: string;
  type: MerchantMemberAccountTransactionType;
  points?: unknown;
  balanceAmount?: unknown;
  note?: unknown;
  operatorId?: unknown;
  rechargePlanId?: unknown;
  redemptionItemId?: unknown;
  redemptionQuantity?: unknown;
}): Promise<MerchantMembershipListItem> {
  const supabase = requireMembershipsStoreClient();
  const siteId = trimText(input.siteId, 64);
  const membershipId = trimText(input.membershipId, 160);
  if (!siteId || !membershipId) throw new Error("membership_not_found");
  const stored = await loadStoredMerchantMemberships(supabase, siteId);
  const current = normalizeMerchantMembershipRecords(stored?.memberships ?? []);
  const index = current.findIndex((membership) => membership.id === membershipId);
  if (index < 0) throw new Error("membership_not_found");
  if (current[index].status !== "active") throw new Error("membership_not_active");
  const type: MerchantMemberAccountTransactionType = input.type === "recharge" ? "recharge" : "redeem";
  const settings = await getMerchantMembershipSettings(siteId).catch(() => null);
  const rechargePlanId = trimText(input.rechargePlanId, 120);
  const rechargePlan =
    type === "recharge" && rechargePlanId
      ? settings?.rechargePlans.find((plan) => plan.enabled && plan.id === rechargePlanId)
      : null;
  const redemptionItemId = trimText(input.redemptionItemId, 120);
  const redemptionItem =
    type === "redeem" && redemptionItemId
      ? settings?.redemptionItems.find((item) => item.enabled && item.id === redemptionItemId)
      : null;
  const redemptionQuantity = Math.max(1, normalizePositiveInteger(input.redemptionQuantity) || 1);
  const currentMembership = current[index];
  if (redemptionItem && redemptionItem.stock > 0 && redemptionQuantity > redemptionItem.stock) {
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
  let nextMembership: MerchantMembershipRecord = {
    ...currentMembership,
    pointBalance: nextPointBalance,
    balanceAmount: nextBalanceAmount,
    transactions: [
      {
        id: `MT${Date.parse(now).toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        type,
        at: now,
        pointDelta,
        balanceDelta,
        growthDelta: normalizeGrowthValue(growthDelta),
        note:
          trimText(input.note, 500) ||
          (rechargePlan
            ? `充值方案：${rechargePlan.title}`
            : redemptionItem
              ? `兑换项目：${redemptionItem.name} x ${redemptionQuantity}${
                  redemptionPointCost !== redemptionItem.pointsCost
                    ? `（等级折扣 ${redemptionItem.pointsCost}→${redemptionPointCost} 积分/件）`
                    : ""
                }`
              : ""),
        operatorId: trimText(input.operatorId, 120),
      },
      ...currentMembership.transactions,
    ].slice(0, 500),
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
  });
  if (saved.error) throw new Error(saved.error);
  if (settings && redemptionItem && redemptionItem.stock > 0) {
    await updateMerchantMembershipSettings({
      siteId,
      settings: {
        ...settings,
        redemptionItems: settings.redemptionItems.map((item) =>
          item.id === redemptionItem.id ? { ...item, stock: Math.max(0, item.stock - redemptionQuantity) } : item,
        ),
      },
    });
  }
  return toMerchantMembershipListItem(nextMembership);
}

export async function awardMerchantMembershipPointsForOrder(order: MerchantOrderRecord) {
  if (order.status !== "completed") return null;
  const siteId = trimText(order.siteId, 64);
  if (!siteId) return null;
  const settings = await getMerchantMembershipSettings(siteId).catch(() => null);
  if (!settings) return null;
  const points = calculateOrderPoints(order, settings);
  const growthDelta = order.totalAmount * settings.growthRules.spendAmountGrowth + points * settings.growthRules.spendPointGrowth;
  if (points <= 0 && growthDelta <= 0) return null;
  const supabase = requireMembershipsStoreClient();
  const stored = await loadStoredMerchantMemberships(supabase, siteId);
  const current = normalizeMerchantMembershipRecords(stored?.memberships ?? []);
  const normalizedEmail = trimText(order.customerLoginEmail || order.customer.email).toLowerCase();
  const index = current.findIndex((membership) => {
    if (membership.status !== "active") return false;
    if (order.customerAccountId && membership.accountId === order.customerAccountId) return true;
    if (order.customerUserId && membership.userId === order.customerUserId) return true;
    return Boolean(normalizedEmail) && membership.email.toLowerCase() === normalizedEmail;
  });
  if (index < 0) return null;
  const marker = `[order-points:${order.id}]`;
  const currentMembership = current[index];
  if (transactionHasMarker(currentMembership, marker)) return toMerchantMembershipListItem(currentMembership);
  const now = new Date().toISOString();
  let nextMembership: MerchantMembershipRecord = {
    ...currentMembership,
    pointBalance: currentMembership.pointBalance + points,
    transactions: [
      createMerchantMemberTransaction({
        type: "recharge",
        at: now,
        pointDelta: points,
        growthDelta,
        note: points > 0 ? `订单实付赠送积分 ${marker}` : `订单成长值记录 ${marker}`,
        operatorId: "system",
      }),
      ...currentMembership.transactions,
    ].slice(0, 500),
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
  const saved = await saveStoredMerchantMemberships(supabase, { siteId, memberships: nextMemberships, updatedAt: now });
  if (saved.error) throw new Error(saved.error);
  return toMerchantMembershipListItem(nextMembership);
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
  const membership = normalizeMerchantMembershipRecords(stored?.memberships ?? []).find((item) => item.id === membershipId);
  if (!membership || membership.status !== "active") throw new Error("membership_not_found");
  return calculateMerchantMemberPointDeduction({
    orderAmount: normalizePositiveMoney(input.orderAmount),
    pointBalance: membership.pointBalance,
    requestedPoints: normalizePositiveInteger(input.requestedPoints),
    settings,
  });
}

export async function applyMerchantMembershipPointDeduction(input: {
  siteId: string;
  membershipId: string;
  orderAmount: unknown;
  requestedPoints: unknown;
  orderId?: unknown;
  operatorId?: string;
}) {
  const supabase = requireMembershipsStoreClient();
  const siteId = trimText(input.siteId, 64);
  const membershipId = trimText(input.membershipId, 160);
  if (!siteId || !membershipId) throw new Error("membership_not_found");
  const [stored, settings] = await Promise.all([
    loadStoredMerchantMemberships(supabase, siteId),
    getMerchantMembershipSettings(siteId),
  ]);
  const current = normalizeMerchantMembershipRecords(stored?.memberships ?? []);
  const membershipIndex = current.findIndex((item) => item.id === membershipId);
  if (membershipIndex < 0 || current[membershipIndex]?.status !== "active") throw new Error("membership_not_found");
  const currentMembership = current[membershipIndex];
  const orderId = trimText(input.orderId, 160);
  const marker = orderId ? `[point-deduction:${orderId}]` : "";
  if (marker && transactionHasMarker(currentMembership, marker)) {
    throw new Error("point_deduction_already_applied");
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
        note: `订单积分抵扣 ${quote.amount.toFixed(2)}${marker ? ` ${marker}` : ""}`,
        operatorId: trimText(input.operatorId, 120) || "system",
      }),
      ...currentMembership.transactions,
    ].slice(0, 500),
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
  const saved = await saveStoredMerchantMemberships(supabase, { siteId, memberships: nextMemberships, updatedAt: now });
  if (saved.error) throw new Error(saved.error);
  return { membership: toMerchantMembershipListItem(nextMembership), quote };
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
  const stored = await loadStoredMerchantMemberships(supabase, siteId);
  const current = normalizeMerchantMembershipRecords(stored?.memberships ?? []);
  const settings = await getMerchantMembershipSettings(siteId).catch(() => null);
  const profile = normalizeMerchantMembershipProfileDraft(input.profile, readPersonalMembershipProfileFromSession(input.session));
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

  let nextMembership: MerchantMembershipRecord =
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
    nextMembership = applyJoinPoints(nextMembership, settings, now);
    nextMembership = applyMembershipGrowthAndLevel({
      membership: nextMembership,
      settings,
      now,
    });
  }
  const nextMemberships = existingIndex >= 0 ? [...current] : [nextMembership, ...current];
  if (existingIndex >= 0) nextMemberships[existingIndex] = nextMembership;
  const saved = await saveStoredMerchantMemberships(supabase, {
    siteId,
    memberships: nextMemberships,
    updatedAt: now,
  });
  if (saved.error) throw new Error(saved.error);
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
  const stored = await loadStoredMerchantMemberships(supabase, siteId);
  const current = normalizeMerchantMembershipRecords(stored?.memberships ?? []);
  const index = current.findIndex(
    (membership) =>
      (membership.accountId && membership.accountId === input.session.accountId) ||
      (membership.userId && membership.userId === input.session.userId),
  );
  if (index < 0) throw new Error("membership_not_found");
  const now = new Date().toISOString();
  const nextMembership = {
    ...current[index],
    status: "left" as const,
    leftAt: now,
    updatedAt: now,
  };
  const nextMemberships = [...current];
  nextMemberships[index] = nextMembership;
  const saved = await saveStoredMerchantMemberships(supabase, {
    siteId,
    memberships: nextMemberships,
    updatedAt: now,
  });
  if (saved.error) throw new Error(saved.error);
  await writePersonalMembershipToMetadata(input.session, toPersonalMembershipCard(nextMembership));
  return nextMembership;
}
