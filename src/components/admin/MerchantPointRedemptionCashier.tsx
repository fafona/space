"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { CategoryIconGlyph, normalizeCategoryIconName } from "./CategoryIconGlyph";
import { useI18n } from "@/components/I18nProvider";
import {
  getMerchantCouponDiscountLabel,
  getMerchantCouponDisplayTitle,
  isMerchantCouponDirectRedemptionDiscountType,
  type MerchantCouponRecord,
} from "@/lib/merchantCoupons";
import { showGlobalToast } from "@/lib/globalToast";
import {
  MERCHANT_ADMIN_DATA_CACHE_TTL_MS,
  invalidateMerchantAdminDataCachePrefix,
  makeMerchantAdminDataCacheKey,
  readMerchantAdminDataCacheSnapshot,
  writeMerchantAdminDataCache,
} from "@/lib/merchantAdminDataCache";
import { LANGUAGE_OPTIONS, resolveSupportedLocale } from "@/lib/i18n";
import { createClientMutationOperationId } from "@/lib/mutationOperationId";
import { normalizePublicAssetUrl } from "@/lib/publicAssetUrl";
import type { MerchantMembershipInsight, MerchantMembershipListItem } from "@/lib/merchantMemberships";
import type {
  MerchantMemberRedemptionCategory,
  MerchantMemberRedemptionItem,
  MerchantMembershipSettings,
  MerchantReceiptPrintSettings,
} from "@/lib/merchantMembershipSettings";
import { parseMerchantMemberPointDiscountRate } from "@/lib/merchantMembershipSettings";
import { printRedemptionReceipt, type MerchantRedemptionReceiptData } from "@/lib/merchantReceiptPrint";

type MerchantPointRedemptionCashierProps = {
  siteId: string;
  siteName?: string;
  className?: string;
  view?: "cashier" | "records" | "rechargeRecords";
};

type MembershipsPayload = {
  ok?: unknown;
  memberships?: MerchantMembershipListItem[];
  message?: unknown;
};

type RedemptionCashierPayload = {
  ok?: unknown;
  memberships?: MerchantMembershipListItem[];
  searchMemberships?: MerchantMembershipListItem[];
  settings?: MerchantMembershipSettings;
  coupons?: MerchantCouponRecord[];
  membershipsNotModified?: unknown;
  settingsNotModified?: unknown;
  couponsNotModified?: unknown;
  membershipVersion?: unknown;
  settingsVersion?: unknown;
  couponVersion?: unknown;
  message?: unknown;
};

type MembershipPatchPayload = {
  ok?: unknown;
  membership?: MerchantMembershipListItem;
  message?: unknown;
};

type CartLine = {
  itemId: string;
  customName?: string;
  customCode?: string;
  customPoints?: number;
  couponId?: string;
  couponClaimId?: string;
  couponSettlementCode?: string;
  couponTitle?: string;
  couponDiscountLabel?: string;
  couponPointDiscount?: number;
  couponPointsVoucherMaxPerRedemption?: number;
  couponPointsVoucherMinimumRedeemPoints?: number;
  quantity: number;
};

type MemberCouponClaim = MerchantMembershipInsight["couponHistory"][number];

type HeldSale = {
  id: string;
  title: string;
  createdAt: string;
  selectedMemberId: string;
  memberKeyword: string;
  itemKeyword: string;
  categoryId: string;
  cart: CartLine[];
  note: string;
};

type ProductViewMode = "image" | "text";
type ProductImageSize = "large" | "medium" | "small";
type CatalogFilterTab = "hot" | "category" | "recommend";
type CatalogSortMode = "code" | "name";
type RecordsTimeFilter = "today" | "yesterday" | "week" | "month" | "all";
type CashierShortcutKey = "enter" | "minus" | "plus";
type CashierShortcutActions = {
  blocked: () => boolean;
  openQuickRedeem: () => void;
  openRecharge: () => void;
  openCheckout: () => void;
};

function flagImageUrl(countryCode: string) {
  return `https://flagcdn.com/${countryCode.toLowerCase()}.svg`;
}

const EMPTY_MEMBER_INSIGHT: MerchantMembershipInsight = {
  pointBalance: 0,
  balanceAmount: 0,
  availableCouponCount: 0,
  availableCoupons: [],
  couponHistory: [],
  totalSpendAmount: 0,
  totalOrderCount: 0,
  consumptionFrequencyPerMonth: 0,
  averageOrderAmount: 0,
  recentPurchaseAt: null,
  firstPurchaseAt: null,
  yearlySpendAmount: 0,
  productPreferences: [],
};

const MERCHANT_REDEMPTION_ITEM_RENDER_LIMIT = 300;
const MERCHANT_POINT_REDEMPTION_REQUEST_TIMEOUT_MS = 12_000;
const MEMBER_SEARCH_REQUEST_TIMEOUT_MS = 4_500;
const MEMBER_REMOTE_SEARCH_LIMIT = 20;

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function readPayloadMessage(value: unknown, fallback: string) {
  return trimText(value, 1000) || fallback;
}

async function fetchPointRedemptionJson(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = MERCHANT_POINT_REDEMPTION_REQUEST_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("请求超时，请刷新后重试");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function formatDateYmd(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}

function formatDateTime(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

function formatPoints(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return "0";
  return String(Math.round(numberValue));
}

function formatMoney(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return "0.00";
  return numberValue.toFixed(2);
}

function parsePositiveInteger(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.max(0, Math.floor(numberValue));
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isSameLocalDay(left: Date, right: Date) {
  return startOfLocalDay(left).getTime() === startOfLocalDay(right).getTime();
}

function isInRecordsTimeFilter(dateValue: string, filter: RecordsTimeFilter) {
  if (filter === "all") return true;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  const today = startOfLocalDay(now);
  if (filter === "today") return isSameLocalDay(date, today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (filter === "yesterday") return isSameLocalDay(date, yesterday);
  if (filter === "week") {
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - 6);
    return date >= weekStart && date <= now;
  }
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  return date >= monthStart && date <= now;
}

function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

function normalizeCashierShortcutKey(event: KeyboardEvent): CashierShortcutKey | "" {
  if (event.key === "Enter" || event.code === "NumpadEnter") return "enter";
  if (event.key === "+" || event.code === "NumpadAdd") return "plus";
  if (event.key === "-" || event.key === "−" || event.code === "Minus" || event.code === "NumpadSubtract") return "minus";
  return "";
}

function getMemberDisplayName(membership: MerchantMembershipListItem) {
  if (!membership.profileVisible) return "已退会会员";
  return membership.nickname || membership.name || membership.email || membership.accountId || membership.memberNo;
}

function getAvatarInitial(membership: MerchantMembershipListItem | null) {
  if (!membership) return "客";
  return getMemberDisplayName(membership).slice(0, 1).toUpperCase() || "会";
}

function buildMemberSearchText(membership: MerchantMembershipListItem) {
  const publicParts = [membership.id, membership.memberNo, membership.status, membership.joinedAt, membership.leftAt];
  if (!membership.profileVisible) return publicParts.join(" ").toLowerCase();
  return [
    ...publicParts,
    membership.memberNo,
    membership.nickname,
    membership.name,
    membership.accountId,
    membership.phone,
    membership.email,
    membership.birthday,
    membership.gender,
    membership.country,
    membership.province,
    membership.city,
    membership.address,
    membership.taxName,
    membership.taxNumber,
    membership.taxCountry,
    membership.taxProvince,
    membership.taxCity,
    membership.taxAddress,
  ]
    .join(" ")
    .toLowerCase();
}

function mergeMemberLists(
  current: MerchantMembershipListItem[],
  incoming: MerchantMembershipListItem[],
): MerchantMembershipListItem[] {
  if (!incoming.length) return current;
  const merged = new Map(current.map((membership) => [membership.id, membership]));
  let changed = false;
  incoming.forEach((membership) => {
    const sameMemberNoId =
      trimText(membership.memberNo, 120) &&
      Array.from(merged.values()).find((entry) => entry.memberNo === membership.memberNo)?.id;
    const existing = merged.get(membership.id) ?? (sameMemberNoId ? merged.get(sameMemberNoId) : undefined);
    if (sameMemberNoId && sameMemberNoId !== membership.id) {
      merged.delete(sameMemberNoId);
    }
    if (existing) {
      merged.set(membership.id, {
        ...existing,
        ...membership,
        insight: membership.insight ?? existing.insight,
        transactions:
          membership.transactions.length > 0 || existing.transactions.length === 0
            ? membership.transactions
            : existing.transactions,
      });
    } else {
      merged.set(membership.id, membership);
    }
    changed = true;
  });
  return changed ? Array.from(merged.values()) : current;
}

function isSameMembershipRecord(left: MerchantMembershipListItem, right: MerchantMembershipListItem) {
  if (left.id && right.id && left.id === right.id) return true;
  const leftMemberNo = trimText(left.memberNo, 120);
  const rightMemberNo = trimText(right.memberNo, 120);
  return Boolean(leftMemberNo && rightMemberNo && leftMemberNo === rightMemberNo);
}

function categoryName(categories: MerchantMemberRedemptionCategory[], categoryId: string) {
  if (!categoryId) return "全部";
  return categories.find((category) => category.id === categoryId)?.name || "未分类";
}

function getRedemptionPointCostForMember(
  item: MerchantMemberRedemptionItem,
  membership: MerchantMembershipListItem | null,
  settings: MerchantMembershipSettings | null,
) {
  const basePoints = item.pointsCost ?? 0;
  const levels = (settings?.levels ?? [])
    .filter((level) => level.enabled && trimText(level.name, 120))
    .sort((left, right) => left.requiredGrowthValue - right.requiredGrowthValue || left.sort - right.sort);
  const level =
    levels.find((entry) => entry.id === membership?.levelId) ??
    levels.reduce<(typeof levels)[number] | null>((matched, entry) => {
      return (membership?.growthValue ?? 0) >= entry.requiredGrowthValue ? entry : matched;
    }, null);
  const rate = parseMerchantMemberPointDiscountRate(level?.benefit.pointDiscount);
  return Math.max(0, Math.ceil(basePoints * rate));
}

function productInitial(item: MerchantMemberRedemptionItem) {
  return trimText(item.name, 2) || trimText(item.code, 2) || "项";
}

function stockLabel(item: MerchantMemberRedemptionItem) {
  if (item.stock === null) return "∞";
  return item.stock > 0 ? `库存 ${item.stock}` : "无库存";
}

function shouldShowStock(settings: MerchantMembershipSettings | null) {
  return settings?.redemptionShowStock !== false;
}

function operationErrorMessage(message: unknown, fallback: string, operationType: "redeem" | "recharge" = "redeem") {
  const text = trimText(message, 1000);
  if (text === "membership_not_found") return "会员不存在或数据已更新，请刷新后重新选择会员。";
  if (text === "membership_balance_insufficient") return "会员积分不足，不能兑换。";
  if (text === "membership_redemption_stock_insufficient") return "兑换项目库存不足。";
  if (text === "membership_operation_empty") {
    return operationType === "recharge" ? "充值方案金额和积分不能都为空" : "请选择兑换项目。";
  }
  if (text === "membership_not_active") return "该会员不是正常状态，不能兑换。";
  if (text === "membership_redemption_item_not_found") return "兑换项目不存在或已停用";
  if (text === "membership_settings_unavailable") return "会员兑换配置不可用。";
  if (text === "coupon_already_redeemed") return "所选卡券已核销，不能重复使用。";
  if (text === "coupon_expired" || text === "coupon_claim_expired") return "所选卡券已过期，不能使用。";
  if (text === "coupon_not_active" || text === "coupon_not_started") return "所选卡券暂不可用。";
  if (text === "coupon_claim_not_found") return "没有找到所选卡券领取记录。";
  if (text === "coupon_claim_member_mismatch") return "所选卡券不属于当前会员。";
  if (text === "coupon_not_direct_redeemable") return "此券不能在积分兑换中直接使用，请在订单中使用。";
  if (text === "coupon_points_voucher_requires_points") return "积分券需要和兑换项目一起使用。";
  if (text === "coupon_points_voucher_limit_exceeded") return "本次积分兑换使用的积分券数量超过限制。";
  if (text === "coupon_points_voucher_minimum_not_met") return "本次兑换积分未达到积分券使用门槛。";
  return text || fallback;
}

function couponStatusLabel(status: MerchantMembershipInsight["couponHistory"][number]["status"]) {
  if (status === "available") return "可用";
  if (status === "used") return "已核销";
  if (status === "expired") return "已过期";
  return "不可用";
}

function getCouponCartItemName(coupon: MemberCouponClaim) {
  if (coupon.discountType === "product_voucher") return trimText(coupon.productName, 120) || coupon.title;
  if (coupon.discountType === "exchange_voucher") return trimText(coupon.exchangeItem, 120) || coupon.title;
  if (coupon.discountType === "ticket_voucher") return trimText(coupon.ticketVenue, 120) || coupon.title;
  if (coupon.discountType === "points_voucher") return "积分抵扣";
  return coupon.title;
}

function getCouponCartQuantity(coupon: MemberCouponClaim) {
  const quantity =
    coupon.discountType === "product_voucher"
      ? coupon.productQuantity
      : coupon.discountType === "exchange_voucher"
        ? coupon.exchangeQuantity
        : 1;
  return Math.max(1, Math.floor(Number(quantity) || 1));
}

function getCouponPointDiscount(coupon: MemberCouponClaim) {
  return coupon.discountType === "points_voucher" ? Math.max(0, Math.round(Number(coupon.discountValue) || 0)) : 0;
}

function getCouponPointsVoucherMaxPerRedemption(coupon: MemberCouponClaim) {
  return coupon.discountType === "points_voucher"
    ? Math.max(0, Math.round(Number(coupon.pointsVoucherMaxPerRedemption) || 0))
    : 0;
}

function getCouponPointsVoucherMinimumRedeemPoints(coupon: MemberCouponClaim) {
  return coupon.discountType === "points_voucher"
    ? Math.max(0, Math.round(Number(coupon.pointsVoucherMinimumRedeemPoints) || 0))
    : 0;
}

function getCouponPointsVoucherRuleText(coupon: Pick<MemberCouponClaim, "discountType" | "pointsVoucherMaxPerRedemption" | "pointsVoucherMinimumRedeemPoints">) {
  if (coupon.discountType !== "points_voucher") return "";
  const rules = [
    Math.max(0, Math.round(Number(coupon.pointsVoucherMinimumRedeemPoints) || 0)) > 0
      ? `满 ${Math.max(0, Math.round(Number(coupon.pointsVoucherMinimumRedeemPoints) || 0))} 积分可用`
      : "",
    Math.max(0, Math.round(Number(coupon.pointsVoucherMaxPerRedemption) || 0)) > 0
      ? `单次最多 ${Math.max(0, Math.round(Number(coupon.pointsVoucherMaxPerRedemption) || 0))} 张积分券`
      : "",
  ].filter(Boolean);
  return rules.join(" / ");
}

function getCouponDirectUseUnavailableReason(coupon: MemberCouponClaim) {
  if (coupon.status !== "available") return couponStatusLabel(coupon.status);
  if (!coupon.settlementCode) return "无核销码";
  if (!isMerchantCouponDirectRedemptionDiscountType(coupon.discountType)) return "需在订单中使用";
  return "";
}

function storageKey(siteId: string) {
  return `faolla.memberPointRedemption.heldSales.${siteId}`;
}

function allCategoryFilterStorageKey(siteId: string) {
  return `faolla.memberPointRedemption.allCategoryExcluded.${siteId}`;
}

function IconSearch() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m16.5 16.5 4 4" />
    </svg>
  );
}

function IconImage() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m7 17 4.5-4.5 3 3L17 13l2 2" />
    </svg>
  );
}

function IconList() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 6h12" />
      <path d="M8 12h12" />
      <path d="M8 18h12" />
      <path d="M4 6h.01" />
      <path d="M4 12h.01" />
      <path d="M4 18h.01" />
    </svg>
  );
}

function IconGrid() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </svg>
  );
}

function IconDoorOpen() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 21h16" />
      <path d="M6 21V4a1 1 0 0 1 1-1h8v18" />
      <path d="M15 5h2a1 1 0 0 1 1 1v15" />
      <path d="M11 12h.01" />
    </svg>
  );
}

function IconWallet() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="6" width="18" height="14" rx="2" />
      <path d="M3 10h18" />
      <path d="M16 15h2" />
    </svg>
  );
}

function IconX() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export default function MerchantPointRedemptionCashier({
  siteId,
  siteName = "",
  className = "",
  view = "cashier",
}: MerchantPointRedemptionCashierProps) {
  const { locale, setLocale, t } = useI18n();
  const normalizedSiteId = siteId.trim();
  const [memberships, setMemberships] = useState<MerchantMembershipListItem[]>([]);
  const [settings, setSettings] = useState<MerchantMembershipSettings | null>(null);
  const [coupons, setCoupons] = useState<MerchantCouponRecord[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [memberKeyword, setMemberKeyword] = useState("");
  const [itemKeyword, setItemKeyword] = useState("");
  const [itemRenderLimit, setItemRenderLimit] = useState(MERCHANT_REDEMPTION_ITEM_RENDER_LIMIT);
  const [categoryId, setCategoryId] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [note, setNote] = useState("");
  const [viewMode, setViewMode] = useState<ProductViewMode>("image");
  const [productImageSize, setProductImageSize] = useState<ProductImageSize>("medium");
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [imageSizeMenuOpen, setImageSizeMenuOpen] = useState(false);
  const [catalogFilterTab, setCatalogFilterTab] = useState<CatalogFilterTab>("hot");
  const [catalogSortMode, setCatalogSortMode] = useState<CatalogSortMode>("code");
  const [allCategoryExcludedIds, setAllCategoryExcludedIds] = useState<Set<string>>(() => new Set());
  const [heldSales, setHeldSales] = useState<HeldSale[]>([]);
  const [heldOpen, setHeldOpen] = useState(false);
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [remoteMemberSearchKeyword, setRemoteMemberSearchKeyword] = useState("");
  const [remoteMemberSearchResults, setRemoteMemberSearchResults] = useState<MerchantMembershipListItem[]>([]);
  const [memberSearchLoading, setMemberSearchLoading] = useState(false);
  const [memberSearchSkippedKeyword, setMemberSearchSkippedKeyword] = useState("");
  const [memberSearchFailedKeyword, setMemberSearchFailedKeyword] = useState("");
  const [rechargeDialogOpen, setRechargeDialogOpen] = useState(false);
  const [selectedRechargePlanId, setSelectedRechargePlanId] = useState("");
  const [quickRedeemDialogOpen, setQuickRedeemDialogOpen] = useState(false);
  const [quickRedeemName, setQuickRedeemName] = useState("临时项目");
  const [quickRedeemPoints, setQuickRedeemPoints] = useState("");
  const quickRedeemPointsInputRef = useRef<HTMLInputElement | null>(null);
  const [checkoutConfirmOpen, setCheckoutConfirmOpen] = useState(false);
  const [couponWalletOpen, setCouponWalletOpen] = useState(false);
  const [memberInsightLoadingIds, setMemberInsightLoadingIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [recordsKeyword, setRecordsKeyword] = useState("");
  const [recordsTimeFilter, setRecordsTimeFilter] = useState<RecordsTimeFilter>("today");
  const [recordsPage, setRecordsPage] = useState(1);
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const languageRootRef = useRef<HTMLDivElement | null>(null);
  const languageMenuRef = useRef<HTMLDivElement | null>(null);
  const membershipsRef = useRef<MerchantMembershipListItem[]>([]);
  const memberInsightRequestIdsRef = useRef<Set<string>>(new Set());
  const cashierLoadRequestIdRef = useRef(0);
  const memberSearchRequestIdRef = useRef(0);
  const memberSearchCacheRef = useRef<Map<string, MerchantMembershipListItem[]>>(new Map());
  const cashierShortcutPressedKeysRef = useRef<Set<CashierShortcutKey>>(new Set());
  const cashierShortcutEnterTimerRef = useRef<number | null>(null);
  const cashierShortcutActionsRef = useRef<CashierShortcutActions>({
    blocked: () => true,
    openQuickRedeem: () => undefined,
    openRecharge: () => undefined,
    openCheckout: () => undefined,
  });
  const submitCheckoutRef = useRef<() => Promise<void>>(async () => undefined);
  const selectedMemberIdRef = useRef("");
  const deferredMemberKeyword = useDeferredValue(memberKeyword);
  const deferredItemKeyword = useDeferredValue(itemKeyword);
  const deferredRecordsKeyword = useDeferredValue(recordsKeyword);
  const resolvedLocale = useMemo(() => resolveSupportedLocale(locale), [locale]);
  const currentLanguage = useMemo(
    () => LANGUAGE_OPTIONS.find((item) => item.code === resolvedLocale) ?? LANGUAGE_OPTIONS[0],
    [resolvedLocale],
  );

  const enabledCategories = useMemo(
    () => (settings?.redemptionCategories ?? []).filter((category) => category.enabled),
    [settings],
  );

  const enabledItems = useMemo(
    () =>
      (settings?.redemptionItems ?? [])
        .filter((item) => item.enabled)
        .sort((left, right) => left.sort - right.sort || left.name.localeCompare(right.name)),
    [settings],
  );

  const enabledRechargePlans = useMemo(
    () =>
      (settings?.rechargePlans ?? [])
        .filter((plan) => plan.enabled)
        .sort((left, right) => left.sort - right.sort || left.title.localeCompare(right.title)),
    [settings],
  );

  const activeMembers = useMemo(
    () => memberships.filter((membership) => membership.profileVisible && membership.status === "active"),
    [memberships],
  );

  const activeMemberSearchRows = useMemo(
    () => activeMembers.map((membership) => ({ membership, searchText: buildMemberSearchText(membership) })),
    [activeMembers],
  );

  const activeMemberById = useMemo(
    () => new Map(activeMembers.map((membership) => [membership.id, membership])),
    [activeMembers],
  );

  const enabledItemById = useMemo(
    () => new Map(enabledItems.map((item) => [item.id, item])),
    [enabledItems],
  );

  const categoryNameById = useMemo(
    () => new Map(enabledCategories.map((category) => [category.id, category.name])),
    [enabledCategories],
  );

  const filteredMembers = useMemo(() => {
    const keyword = deferredMemberKeyword.trim().toLowerCase();
    if (!keyword) return [];
    const unique = new Map<string, MerchantMembershipListItem>();
    activeMemberSearchRows.forEach((row) => {
      if (row.searchText.includes(keyword)) unique.set(row.membership.id, row.membership);
    });
    if (remoteMemberSearchKeyword === keyword) {
      remoteMemberSearchResults.forEach((membership) => {
        if (buildMemberSearchText(membership).includes(keyword)) unique.set(membership.id, membership);
      });
    }
    return Array.from(unique.values()).slice(0, MEMBER_REMOTE_SEARCH_LIMIT);
  }, [activeMemberSearchRows, deferredMemberKeyword, remoteMemberSearchKeyword, remoteMemberSearchResults]);

  const selectedMember = useMemo(
    () => activeMemberById.get(selectedMemberId) ?? null,
    [activeMemberById, selectedMemberId],
  );

  const selectedInsight = selectedMember?.insight ?? EMPTY_MEMBER_INSIGHT;
  const selectedMemberInsightLoading = selectedMember ? memberInsightLoadingIds.has(selectedMember.id) : false;
  const selectedAvailableCouponClaims = useMemo(
    () =>
      selectedMember
        ? selectedInsight.couponHistory
            .filter((coupon) => coupon.status === "available")
            .sort((left, right) => Date.parse(left.validUntil || left.claimedAt) - Date.parse(right.validUntil || right.claimedAt))
        : [],
    [selectedInsight.couponHistory, selectedMember],
  );
  const directlyUsableCouponClaims = useMemo(
    () => selectedAvailableCouponClaims.filter((coupon) => !getCouponDirectUseUnavailableReason(coupon)),
    [selectedAvailableCouponClaims],
  );
  const unavailableCouponClaims = useMemo(
    () =>
      selectedMember
        ? selectedInsight.couponHistory
            .filter((coupon) => coupon.status !== "available" || Boolean(getCouponDirectUseUnavailableReason(coupon)))
            .sort((left, right) => Date.parse(right.claimedAt) - Date.parse(left.claimedAt))
        : [],
    [selectedInsight.couponHistory, selectedMember],
  );
  const couponClaimIdsInCart = useMemo(
    () => new Set(cart.map((line) => line.couponClaimId).filter((id): id is string => Boolean(id))),
    [cart],
  );

  const couponSearchResults = useMemo(() => {
    const keyword = deferredItemKeyword.trim().toLowerCase();
    if (!keyword) return [];
    const merchantCouponRows = coupons.map((coupon) => ({
      key: `coupon:${coupon.id}`,
      title: getMerchantCouponDisplayTitle(coupon),
      subtitle: getMerchantCouponDiscountLabel(coupon),
      code: [
        coupon.code,
        coupon.productBarcode,
        coupon.productName,
        coupon.exchangeItem,
        coupon.ticketVenue,
        coupon.discountType,
      ]
        .filter(Boolean)
        .join(" / "),
      status: coupon.status === "active" ? "可发放" : coupon.status === "paused" ? "已暂停" : "已归档",
    }));
    const availableRows = selectedMember
      ? selectedInsight.availableCoupons.map((coupon) => ({
      key: `available:${coupon.couponId}`,
      title: coupon.title,
      subtitle: `${coupon.discountLabel}${coupon.count > 1 ? ` x${coupon.count}` : ""}`,
      code: coupon.couponId,
      status: "可用",
    }))
      : [];
    const historyRows = selectedMember
      ? selectedInsight.couponHistory.map((coupon) => ({
      key: `history:${coupon.id}`,
      title: coupon.title,
      subtitle: coupon.discountLabel,
      code: coupon.settlementCode || coupon.couponId,
      status: couponStatusLabel(coupon.status),
    }))
      : [];
    const unique = new Map<string, (typeof merchantCouponRows)[number]>();
    [...merchantCouponRows, ...availableRows, ...historyRows].forEach((coupon) => {
      const searchText = [coupon.title, coupon.subtitle, coupon.code, coupon.status].join(" ").toLowerCase();
      if (searchText.includes(keyword)) unique.set(coupon.key, coupon);
    });
    return Array.from(unique.values()).slice(0, 8);
  }, [coupons, deferredItemKeyword, selectedInsight.availableCoupons, selectedInsight.couponHistory, selectedMember]);

  const filteredItems = useMemo(() => {
    const keyword = deferredItemKeyword.trim().toLowerCase();
    const recommendedCategoryIds = new Set(
      enabledCategories
        .filter((category) => {
          const name = category.name.toLowerCase();
          return name.includes("推荐") || name.includes("热卖") || name.includes("recommended") || name.includes("hot");
        })
        .map((category) => category.id),
    );
    const getRecommendPriority = (item: MerchantMemberRedemptionItem) => {
      if (item.recommended) return 0;
      const text = [item.name, item.code, item.description].join(" ").toLowerCase();
      if (recommendedCategoryIds.has(item.categoryId)) return 1;
      if (text.includes("推荐") || text.includes("热卖") || text.includes("recommended") || text.includes("hot")) return 1;
      return 2;
    };
    const sortByDefault = (left: MerchantMemberRedemptionItem, right: MerchantMemberRedemptionItem) =>
      catalogSortMode === "name"
        ? left.name.localeCompare(right.name) || left.sort - right.sort
        : (left.code || left.id).localeCompare(right.code || right.id) || left.sort - right.sort;
    const categorySortIndex = new Map(enabledCategories.map((category, index) => [category.id, index]));
    return enabledItems
      .filter((item) => {
        if (categoryId && item.categoryId !== categoryId) return false;
        if (!categoryId && allCategoryExcludedIds.has(item.categoryId)) return false;
        if (!keyword) return true;
        return [item.code, item.name, item.description, categoryNameById.get(item.categoryId) ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(keyword);
      })
      .sort((left, right) => {
        if (catalogFilterTab === "recommend") {
          return getRecommendPriority(left) - getRecommendPriority(right) || sortByDefault(left, right);
        }
        if (catalogSortMode === "name") return sortByDefault(left, right);
        if (!categoryId && catalogFilterTab === "category") {
          return (
            (categorySortIndex.get(left.categoryId) ?? Number.MAX_SAFE_INTEGER) -
              (categorySortIndex.get(right.categoryId) ?? Number.MAX_SAFE_INTEGER) ||
            (left.code || left.id).localeCompare(right.code || right.id) ||
            left.sort - right.sort
          );
        }
        return (left.code || left.id).localeCompare(right.code || right.id) || left.sort - right.sort;
      });
  }, [allCategoryExcludedIds, catalogFilterTab, catalogSortMode, categoryId, categoryNameById, deferredItemKeyword, enabledCategories, enabledItems]);

  const renderedItems = useMemo(
    () => filteredItems.slice(0, itemRenderLimit),
    [filteredItems, itemRenderLimit],
  );

  useEffect(() => {
    setItemRenderLimit(MERCHANT_REDEMPTION_ITEM_RENDER_LIMIT);
  }, [allCategoryExcludedIds, catalogFilterTab, catalogSortMode, categoryId, deferredItemKeyword]);

  const cartRows = useMemo(() => {
    return cart
      .map((line) => {
        const item = enabledItemById.get(line.itemId);
        const unitPoints = item
          ? getRedemptionPointCostForMember(item, selectedMember, settings)
          : parsePositiveInteger(line.customPoints);
        const couponSettlementCode = trimText(line.couponSettlementCode, 200);
        if (!item && (!line.customName || (unitPoints <= 0 && !couponSettlementCode))) return null;
        return {
          item,
          itemId: line.itemId,
          code: item?.code || line.customCode || line.itemId,
          name: item?.name || line.customName || "快捷兑换",
          categoryId: item?.categoryId || "",
          stock: item?.stock ?? null,
          custom: !item,
          quantity: line.quantity,
          unitPoints,
          subtotalPoints: unitPoints * line.quantity,
          couponId: trimText(line.couponId, 160),
          couponClaimId: trimText(line.couponClaimId, 160),
          couponSettlementCode,
          couponTitle: trimText(line.couponTitle, 120),
          couponDiscountLabel: trimText(line.couponDiscountLabel, 160),
          couponPointDiscount: couponSettlementCode ? parsePositiveInteger(line.couponPointDiscount) : 0,
          couponPointsVoucherMaxPerRedemption: couponSettlementCode
            ? parsePositiveInteger(line.couponPointsVoucherMaxPerRedemption)
            : 0,
          couponPointsVoucherMinimumRedeemPoints: couponSettlementCode
            ? parsePositiveInteger(line.couponPointsVoucherMinimumRedeemPoints)
            : 0,
        };
      })
      .filter(
        (row): row is {
          item: MerchantMemberRedemptionItem | undefined;
          itemId: string;
          code: string;
          name: string;
          categoryId: string;
          stock: number | null;
          custom: boolean;
          quantity: number;
          unitPoints: number;
          subtotalPoints: number;
          couponId: string;
          couponClaimId: string;
          couponSettlementCode: string;
          couponTitle: string;
          couponDiscountLabel: string;
          couponPointDiscount: number;
          couponPointsVoucherMaxPerRedemption: number;
          couponPointsVoucherMinimumRedeemPoints: number;
        } => Boolean(row),
      );
  }, [cart, enabledItemById, selectedMember, settings]);

  const cartQuantityByItemId = useMemo(() => {
    const quantities = new Map<string, number>();
    cart.forEach((line) => quantities.set(line.itemId, (quantities.get(line.itemId) ?? 0) + line.quantity));
    return quantities;
  }, [cart]);

  const grossPoints = cartRows.reduce((sum, row) => sum + row.subtotalPoints, 0);
  const rawCouponPointDiscountTotal = cartRows.reduce((sum, row) => sum + row.couponPointDiscount, 0);
  const pointVoucherRows = cartRows.filter((row) => row.couponSettlementCode && row.couponPointDiscount > 0);
  const pointVoucherLimit = pointVoucherRows.reduce((limit, row) => {
    const rowLimit = row.couponPointsVoucherMaxPerRedemption;
    if (rowLimit <= 0) return limit;
    return limit <= 0 ? rowLimit : Math.min(limit, rowLimit);
  }, 0);
  const pointVoucherLimitExceeded = pointVoucherLimit > 0 && pointVoucherRows.length > pointVoucherLimit;
  const pointVoucherMinimumViolation = pointVoucherRows.find(
    (row) => row.couponPointsVoucherMinimumRedeemPoints > 0 && grossPoints < row.couponPointsVoucherMinimumRedeemPoints,
  );
  const couponPointDiscountTotal = Math.min(grossPoints, rawCouponPointDiscountTotal);
  const totalPoints = Math.max(0, grossPoints - couponPointDiscountTotal);
  const totalQuantity = cartRows.reduce((sum, row) => sum + row.quantity, 0);
  const hasRedeemableCartEffect = cartRows.some((row) => row.subtotalPoints > 0 || (row.couponSettlementCode && row.couponPointDiscount <= 0));
  const canCheckout =
    Boolean(selectedMember) &&
    cartRows.length > 0 &&
    hasRedeemableCartEffect &&
    !(grossPoints <= 0 && rawCouponPointDiscountTotal > 0) &&
    !pointVoucherLimitExceeded &&
    !pointVoucherMinimumViolation &&
    totalPoints <= selectedInsight.pointBalance &&
    !saving;

  const transactionRecordTypeLabel = view === "rechargeRecords" ? "充值" : "兑换";
  const recordsTimeOptions: Array<{ value: RecordsTimeFilter; label: string }> = [
    { value: "today", label: "今天" },
    { value: "yesterday", label: "昨天" },
    { value: "week", label: "近7天" },
    { value: "month", label: "本月" },
    { value: "all", label: "全部" },
  ];

  const productImageSizeOptions: Array<{ value: ProductImageSize; label: string }> = [
    { value: "large", label: "大" },
    { value: "medium", label: "中" },
    { value: "small", label: "小" },
  ];

  const transactionRecords = useMemo(() => {
    const transactionType = view === "rechargeRecords" ? "recharge" : "redeem";
    return memberships
      .flatMap((membership) =>
        membership.transactions
          .filter((transaction) => transaction.type === transactionType)
          .map((transaction) => ({
            id: `${membership.id}:${transaction.id}`,
            at: transaction.at,
            memberName: getMemberDisplayName(membership),
            memberNo: membership.memberNo,
            points: Math.abs(transaction.pointDelta),
            balanceAmount: Math.abs(transaction.balanceDelta),
            note: transaction.note || "-",
            rawPointDelta: transaction.pointDelta,
            rawBalanceDelta: transaction.balanceDelta,
            type: transaction.type,
          })),
      )
      .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
      .slice(0, 200);
  }, [memberships, view]);

  const filteredTransactionRecords = useMemo(() => {
    const keyword = deferredRecordsKeyword.trim().toLowerCase();
    return transactionRecords.filter((record) => {
      if (!isInRecordsTimeFilter(record.at, recordsTimeFilter)) return false;
      if (!keyword) return true;
      return [record.id, record.memberName, record.memberNo, record.note, record.points, record.balanceAmount]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    });
  }, [deferredRecordsKeyword, recordsTimeFilter, transactionRecords]);

  const recordsPageSize = 30;
  const recordsTotalPages = Math.max(1, Math.ceil(filteredTransactionRecords.length / recordsPageSize));
  const normalizedRecordsPage = Math.min(recordsPage, recordsTotalPages);
  const pagedTransactionRecords = filteredTransactionRecords.slice(
    (normalizedRecordsPage - 1) * recordsPageSize,
    normalizedRecordsPage * recordsPageSize,
  );
  const selectedRecord = transactionRecords.find((record) => record.id === selectedRecordId) ?? null;

  useEffect(() => {
    membershipsRef.current = memberships;
  }, [memberships]);

  useEffect(() => {
    selectedMemberIdRef.current = selectedMemberId;
  }, [selectedMemberId]);

  useEffect(() => {
    const keyword = deferredMemberKeyword.trim();
    const normalizedKeyword = keyword.toLowerCase();
    const requestId = ++memberSearchRequestIdRef.current;
    if (!keyword || !/^\d{8}$/.test(normalizedSiteId)) {
      setRemoteMemberSearchKeyword("");
      setRemoteMemberSearchResults([]);
      setMemberSearchLoading(false);
      setMemberSearchSkippedKeyword("");
      setMemberSearchFailedKeyword("");
      return;
    }
    const cacheKey = `${normalizedSiteId}:${normalizedKeyword}`;
    const cachedSearchResults = memberSearchCacheRef.current.get(cacheKey);
    if (cachedSearchResults) {
      setRemoteMemberSearchKeyword(normalizedKeyword);
      setRemoteMemberSearchResults(cachedSearchResults);
      setMemberSearchLoading(false);
      setMemberSearchSkippedKeyword("");
      setMemberSearchFailedKeyword("");
      return;
    }
    const localMatches = membershipsRef.current.filter(
      (membership) =>
        membership.profileVisible &&
        membership.status === "active" &&
        buildMemberSearchText(membership).includes(normalizedKeyword),
    );
    if (normalizedKeyword.length < 2 && localMatches.length > 0) {
      setRemoteMemberSearchKeyword("");
      setRemoteMemberSearchResults([]);
      setMemberSearchLoading(false);
      setMemberSearchSkippedKeyword("");
      setMemberSearchFailedKeyword("");
      return;
    }
    if (normalizedKeyword.length < 2) {
      setRemoteMemberSearchKeyword("");
      setRemoteMemberSearchResults([]);
      setMemberSearchLoading(false);
      setMemberSearchSkippedKeyword(normalizedKeyword);
      setMemberSearchFailedKeyword("");
      return;
    }
    setMemberSearchLoading(true);
    setMemberSearchSkippedKeyword("");
    setMemberSearchFailedKeyword("");
    const timeoutId = window.setTimeout(() => {
      const params = new URLSearchParams({
        siteId: normalizedSiteId,
        status: "active",
        query: keyword,
        limit: String(MEMBER_REMOTE_SEARCH_LIMIT),
        includeInsights: "0",
        lean: "1",
      });
      void fetchPointRedemptionJson(`/api/memberships?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: { accept: "application/json" },
      }, MEMBER_SEARCH_REQUEST_TIMEOUT_MS)
        .then(async (response) => {
          const payload = (await response.json().catch(() => null)) as MembershipsPayload | null;
          if (memberSearchRequestIdRef.current !== requestId) return;
          const nextMemberships =
            response.ok && payload?.ok === true && Array.isArray(payload.memberships)
              ? payload.memberships.filter(
                  (membership) => membership.profileVisible && membership.status === "active",
                )
              : [];
          setRemoteMemberSearchKeyword(normalizedKeyword);
          setRemoteMemberSearchResults(nextMemberships);
          memberSearchCacheRef.current.set(cacheKey, nextMemberships);
          setMemberships((current) => mergeMemberLists(current, nextMemberships));
        })
        .catch(() => {
          if (memberSearchRequestIdRef.current !== requestId) return;
          setRemoteMemberSearchKeyword("");
          setRemoteMemberSearchResults([]);
          setMemberSearchFailedKeyword(normalizedKeyword);
        })
        .finally(() => {
          if (memberSearchRequestIdRef.current === requestId) setMemberSearchLoading(false);
        });
    }, 220);
    return () => window.clearTimeout(timeoutId);
  }, [deferredMemberKeyword, normalizedSiteId]);

  const loadData = useCallback(async (force = false, options: { silent?: boolean } = {}) => {
    if (!/^\d{8}$/.test(normalizedSiteId)) {
      setError("当前商户资料还没准备好，请稍后重试。");
      return;
    }
    const membersCacheKey = makeMerchantAdminDataCacheKey("merchant-memberships", normalizedSiteId, "cashier-active-v2", 0, 300);
    const settingsCacheKey = makeMerchantAdminDataCacheKey(
      "merchant-membership-settings",
      normalizedSiteId,
      "redemption-cashier",
    );
    const couponsCacheKey = makeMerchantAdminDataCacheKey("merchant-coupons", normalizedSiteId, "cashier-catalog");
    const requestId = ++cashierLoadRequestIdRef.current;
    const cachedMemberships = force
      ? null
      : readMerchantAdminDataCacheSnapshot<MerchantMembershipListItem[]>(membersCacheKey, MERCHANT_ADMIN_DATA_CACHE_TTL_MS);
    const cachedSettings = force
      ? null
      : readMerchantAdminDataCacheSnapshot<MerchantMembershipSettings>(settingsCacheKey, MERCHANT_ADMIN_DATA_CACHE_TTL_MS);
    const cachedCoupons = force
      ? null
      : readMerchantAdminDataCacheSnapshot<MerchantCouponRecord[]>(couponsCacheKey, MERCHANT_ADMIN_DATA_CACHE_TTL_MS);
    const cachedSettingsHasEnabledItems = (cachedSettings?.data.redemptionItems ?? []).some((item) => item.enabled);
    const applyLoadedData = (
      nextMemberships: MerchantMembershipListItem[],
      nextSettings: MerchantMembershipSettings,
      nextCoupons: MerchantCouponRecord[],
    ) => {
      setMemberships((current) => {
        const insightById = new Map(
          current
            .map((membership) => [membership.id, membership.insight] as const)
            .filter((entry): entry is readonly [string, MerchantMembershipInsight] => Boolean(entry[1])),
        );
        const selectedMembershipId = selectedMemberIdRef.current;
        const currentSelectedMembership = selectedMembershipId
          ? current.find(
              (membership) =>
                membership.id === selectedMembershipId &&
                membership.profileVisible &&
                membership.status === "active",
            )
          : undefined;
        const safeMemberships =
          currentSelectedMembership &&
          !nextMemberships.some((membership) => isSameMembershipRecord(membership, currentSelectedMembership))
            ? mergeMemberLists(nextMemberships, [currentSelectedMembership])
            : nextMemberships;
        return safeMemberships.map((membership) => {
          const insight = membership.insight ?? insightById.get(membership.id);
          return insight ? { ...membership, insight } : membership;
        });
      });
      setSettings(nextSettings);
      setCoupons(nextCoupons);
    };
    const loadCashierDataFromServer = async () => {
      const params = new URLSearchParams({
        siteId: normalizedSiteId,
        limit: "300",
      });
      if (cachedMemberships?.version) params.set("knownMembershipVersion", cachedMemberships.version);
      if (cachedSettings?.version && cachedSettingsHasEnabledItems) {
        params.set("knownSettingsVersion", cachedSettings.version);
      }
      if (cachedCoupons?.version) params.set("knownCouponVersion", cachedCoupons.version);
      const response = await fetchPointRedemptionJson(`/api/merchant-admin/redemption-cashier?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      const payload = (await response.json().catch(() => null)) as RedemptionCashierPayload | null;
      if (!response.ok || payload?.ok !== true) {
        throw new Error(readPayloadMessage(payload?.message, "积分兑换数据加载失败，请稍后重试"));
      }
      const membershipVersion =
        typeof payload.membershipVersion === "string" && payload.membershipVersion.trim()
          ? payload.membershipVersion.trim()
          : null;
      const settingsVersion =
        typeof payload.settingsVersion === "string" && payload.settingsVersion.trim() ? payload.settingsVersion.trim() : null;
      const couponVersion =
        typeof payload.couponVersion === "string" && payload.couponVersion.trim() ? payload.couponVersion.trim() : null;
      const nextMemberships =
        payload.membershipsNotModified === true && cachedMemberships
          ? cachedMemberships.data
          : Array.isArray(payload.memberships)
            ? payload.memberships
            : [];
      const nextSearchMemberships =
        payload.membershipsNotModified === true && cachedMemberships
          ? []
          : Array.isArray(payload.searchMemberships)
            ? payload.searchMemberships
            : [];
      const mergedMemberships = mergeMemberLists(nextMemberships, nextSearchMemberships);
      const nextSettings =
        payload.settingsNotModified === true && cachedSettings ? cachedSettings.data : payload.settings;
      if (!nextSettings) {
        throw new Error(readPayloadMessage(payload.message, "积分兑换数据加载失败，请稍后重试"));
      }
      const nextCoupons =
        payload.couponsNotModified === true && cachedCoupons
          ? cachedCoupons.data
          : Array.isArray(payload.coupons)
            ? payload.coupons
            : [];
      if (cashierLoadRequestIdRef.current !== requestId) return;
      writeMerchantAdminDataCache(membersCacheKey, mergedMemberships, {
        version: membershipVersion ?? cachedMemberships?.version ?? null,
      });
      writeMerchantAdminDataCache(settingsCacheKey, nextSettings, {
        version: settingsVersion ?? cachedSettings?.version ?? null,
      });
      writeMerchantAdminDataCache(couponsCacheKey, nextCoupons, {
        version: couponVersion ?? cachedCoupons?.version ?? null,
      });
      applyLoadedData(mergedMemberships, nextSettings, nextCoupons);
    };
    if (cachedMemberships && cachedSettings && cachedCoupons) {
      setError("");
      applyLoadedData(cachedMemberships.data, cachedSettings.data, cachedCoupons.data);
      void loadCashierDataFromServer().catch(() => {});
      return;
    }
    if (!options.silent) setLoading(true);
    setError("");
    try {
      await loadCashierDataFromServer();
    } catch (loadError) {
      if (cashierLoadRequestIdRef.current === requestId) {
        setError(loadError instanceof Error ? loadError.message : "积分兑换数据加载失败，请稍后重试");
      }
    } finally {
      if (!options.silent && cashierLoadRequestIdRef.current === requestId) setLoading(false);
    }
  }, [normalizedSiteId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const refreshOnVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void loadData();
    };
    window.addEventListener("focus", refreshOnVisible);
    document.addEventListener("visibilitychange", refreshOnVisible);
    return () => {
      window.removeEventListener("focus", refreshOnVisible);
      document.removeEventListener("visibilitychange", refreshOnVisible);
    };
  }, [loadData]);

  const ensureMembershipInsight = useCallback(async (membershipId: string) => {
    const normalizedMembershipId = trimText(membershipId, 160);
    if (!/^\d{8}$/.test(normalizedSiteId) || !normalizedMembershipId) return;
    const currentMembership = membershipsRef.current.find((membership) => membership.id === normalizedMembershipId);
    if (!currentMembership || currentMembership.insight) return;
    if (memberInsightRequestIdsRef.current.has(normalizedMembershipId)) return;
    const cacheKey = makeMerchantAdminDataCacheKey("merchant-membership-detail", normalizedSiteId, normalizedMembershipId);
    const cachedMembership = readMerchantAdminDataCacheSnapshot<MerchantMembershipListItem>(
      cacheKey,
      MERCHANT_ADMIN_DATA_CACHE_TTL_MS,
    );
    if (cachedMembership) {
      setMemberships((current) =>
        current.map((membership) =>
          membership.id === cachedMembership.data.id ? { ...membership, ...cachedMembership.data } : membership,
        ),
      );
    }

    memberInsightRequestIdsRef.current.add(normalizedMembershipId);
    setMemberInsightLoadingIds((current) => new Set(current).add(normalizedMembershipId));
    try {
      const params = new URLSearchParams({
        siteId: normalizedSiteId,
        membershipId: normalizedMembershipId,
        limit: "1",
        includeInsights: "1",
      });
      const response = await fetchPointRedemptionJson(`/api/memberships?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
        },
      });
      const payload = (await response.json().catch(() => null)) as MembershipsPayload | null;
      const detailedMembership = Array.isArray(payload?.memberships) ? payload.memberships[0] : null;
      if (!response.ok || payload?.ok !== true || !detailedMembership) return;
      writeMerchantAdminDataCache(cacheKey, detailedMembership);
      setMemberships((current) =>
        current.map((membership) =>
          membership.id === detailedMembership.id ? { ...membership, ...detailedMembership } : membership,
        ),
      );
    } catch {
      // The cashier stays usable; member details can be retried by selecting the member again.
    } finally {
      memberInsightRequestIdsRef.current.delete(normalizedMembershipId);
      setMemberInsightLoadingIds((current) => {
        const next = new Set(current);
        next.delete(normalizedMembershipId);
        return next;
      });
    }
  }, [normalizedSiteId]);

  useEffect(() => {
    if (!normalizedSiteId || typeof window === "undefined") return;
    const raw = window.localStorage.getItem(storageKey(normalizedSiteId));
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setHeldSales(parsed.slice(0, 20) as HeldSale[]);
    } catch {
      setHeldSales([]);
    }
  }, [normalizedSiteId]);

  useEffect(() => {
    if (!normalizedSiteId || typeof window === "undefined") return;
    window.localStorage.setItem(storageKey(normalizedSiteId), JSON.stringify(heldSales.slice(0, 20)));
  }, [heldSales, normalizedSiteId]);

  useEffect(() => {
    if (!normalizedSiteId || typeof window === "undefined") return;
    const validIds = new Set(enabledCategories.map((category) => category.id));
    const raw = window.localStorage.getItem(allCategoryFilterStorageKey(normalizedSiteId));
    if (!raw) {
      setAllCategoryExcludedIds(new Set());
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      const next = new Set<string>(
        Array.isArray(parsed) ? parsed.map((item) => String(item)).filter((id) => validIds.has(id)) : [],
      );
      setAllCategoryExcludedIds(next);
    } catch {
      setAllCategoryExcludedIds(new Set());
    }
  }, [enabledCategories, normalizedSiteId]);

  useEffect(() => {
    if (!selectedMemberId) return;
    if (!activeMembers.some((membership) => membership.id === selectedMemberId)) {
      setSelectedMemberId("");
    }
  }, [activeMembers, selectedMemberId]);

  useEffect(() => {
    if (!selectedMemberId || !selectedMember || selectedMember.insight) return;
    void ensureMembershipInsight(selectedMemberId);
  }, [ensureMembershipInsight, selectedMember, selectedMemberId]);

  useEffect(() => {
    setCouponWalletOpen(false);
  }, [selectedMemberId]);

  useEffect(() => {
    if (!quickRedeemDialogOpen) return;
    setQuickRedeemName((current) => (current.trim() ? current : "临时项目"));
    const timer = window.setTimeout(() => {
      quickRedeemPointsInputRef.current?.focus();
      quickRedeemPointsInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [quickRedeemDialogOpen]);

  useEffect(() => {
    if (!languageMenuOpen || typeof document === "undefined") return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (languageRootRef.current?.contains(target) || languageMenuRef.current?.contains(target)) return;
      setLanguageMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLanguageMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [languageMenuOpen]);

  useEffect(() => {
    if (!categoryMenuOpen || typeof document === "undefined") return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (target.closest(".category-floating-panel") || target.closest(".category-chip.is-all-category")) return;
      setCategoryMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCategoryMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [categoryMenuOpen]);

  useEffect(() => {
    if (!error && !notice) return;
    showGlobalToast(error || notice);
    const timer = window.setTimeout(() => {
      setError("");
      setNotice("");
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [error, notice]);

  function selectCategory(id: string) {
    setCategoryId(id);
  }

  function isCategoryIncludedInAll(id: string) {
    if (!id) {
      return enabledCategories.length > 0 && enabledCategories.every((category) => !allCategoryExcludedIds.has(category.id));
    }
    return !allCategoryExcludedIds.has(id);
  }

  function setCategoryIncludedInAll(id: string, checked: boolean) {
    const next = new Set(allCategoryExcludedIds);
    if (!id) {
      if (checked) {
        next.clear();
      } else {
        enabledCategories.forEach((category) => next.add(category.id));
      }
    } else if (checked) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setAllCategoryExcludedIds(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(allCategoryFilterStorageKey(normalizedSiteId), JSON.stringify(Array.from(next)));
    }
  }

  function selectMember(membership: MerchantMembershipListItem) {
    setMemberships((current) => mergeMemberLists(current, [membership]));
    selectedMemberIdRef.current = membership.id;
    setSelectedMemberId(membership.id);
    setMemberKeyword("");
    setMemberPickerOpen(false);
    setRemoteMemberSearchKeyword("");
    setRemoteMemberSearchResults([]);
    setMemberSearchLoading(false);
    setMemberSearchSkippedKeyword("");
    setMemberSearchFailedKeyword("");
    setNotice("");
    setError("");
  }

  function lookupMember() {
    const keyword = memberKeyword.trim().toLowerCase();
    if (!keyword) {
      setMemberPickerOpen(false);
      return;
    }
    const matches = new Map<string, MerchantMembershipListItem>();
    activeMemberSearchRows.forEach((row) => {
      if (row.searchText.includes(keyword)) matches.set(row.membership.id, row.membership);
    });
    if (remoteMemberSearchKeyword === keyword) {
      remoteMemberSearchResults.forEach((membership) => {
        if (buildMemberSearchText(membership).includes(keyword)) matches.set(membership.id, membership);
      });
    }
    const matchList = Array.from(matches.values());
    const exact =
      matchList.find((membership) => {
        return (
          keyword &&
          [
            membership.memberNo,
            membership.phone,
            membership.email,
            membership.accountId,
            membership.nickname,
            membership.name,
          ]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase() === keyword)
        );
      }) ?? matchList[0];
    if (exact) {
      selectMember(exact);
      return;
    }
    setMemberPickerOpen(true);
    if (memberSearchLoading || remoteMemberSearchKeyword !== keyword) return;
    setError("没有找到匹配的会员。");
  }

  function clearMember() {
    selectedMemberIdRef.current = "";
    setSelectedMemberId("");
    setMemberKeyword("");
    setMemberPickerOpen(false);
    setRemoteMemberSearchKeyword("");
    setRemoteMemberSearchResults([]);
    setMemberSearchLoading(false);
    setMemberSearchSkippedKeyword("");
    setMemberSearchFailedKeyword("");
    setCouponWalletOpen(false);
  }

  function openSelectedMemberCouponWallet() {
    if (!selectedMember) return;
    setCouponWalletOpen(true);
    void ensureMembershipInsight(selectedMember.id);
  }

  function addToCart(item: MerchantMemberRedemptionItem) {
    setError("");
    setNotice("");
    if (item.pointsCost === null) {
      setError("请先设置兑换积分。");
      return;
    }
    setCart((current) => {
      const existingQuantity = current
        .filter((line) => line.itemId === item.id)
        .reduce((sum, line) => sum + line.quantity, 0);
      if (item.stock !== null && existingQuantity + 1 > item.stock) {
        setError("兑换项目库存不足。");
        return current;
      }
      const index = current.findIndex((line) => line.itemId === item.id);
      if (index < 0) {
        return [...current, { itemId: item.id, quantity: 1 }];
      }
      return current.map((line, lineIndex) =>
        lineIndex === index ? { ...line, quantity: line.quantity + 1 } : line,
      );
    });
  }

  function addCouponClaimToCart(coupon: MemberCouponClaim) {
    setError("");
    setNotice("");
    if (!selectedMember) {
      setError("请先选择会员。");
      setMemberPickerOpen(true);
      return;
    }
    const unavailableReason = getCouponDirectUseUnavailableReason(coupon);
    if (unavailableReason) {
      setError(`此券暂不能直接使用：${unavailableReason}`);
      return;
    }
    if (couponClaimIdsInCart.has(coupon.id)) {
      setNotice("这张券已在购物车中。");
      return;
    }
    const itemName = getCouponCartItemName(coupon);
    const quantity = getCouponCartQuantity(coupon);
    const couponPointDiscount = getCouponPointDiscount(coupon);
    if (couponPointDiscount > 0) {
      const couponLimit = getCouponPointsVoucherMaxPerRedemption(coupon);
      const effectiveLimit = [pointVoucherLimit, couponLimit].filter((limit) => limit > 0).reduce(
        (limit, nextLimit) => (limit <= 0 ? nextLimit : Math.min(limit, nextLimit)),
        0,
      );
      if (effectiveLimit > 0 && pointVoucherRows.length + 1 > effectiveLimit) {
        setError(`本次积分兑换最多可使用 ${effectiveLimit} 张积分券。`);
        return;
      }
    }
    setCart((current) => [
      ...current,
      {
        itemId: `coupon-${coupon.id}`,
        customName: itemName,
        customCode: coupon.discountType === "points_voucher" ? "积分券" : coupon.productBarcode || coupon.couponCode || "卡券",
        customPoints: 0,
        couponId: coupon.couponId,
        couponClaimId: coupon.id,
        couponSettlementCode: coupon.settlementCode,
        couponTitle: coupon.title,
        couponDiscountLabel: coupon.discountLabel,
        couponPointDiscount,
        couponPointsVoucherMaxPerRedemption: getCouponPointsVoucherMaxPerRedemption(coupon),
        couponPointsVoucherMinimumRedeemPoints: getCouponPointsVoucherMinimumRedeemPoints(coupon),
        quantity,
      },
    ]);
    setNote((current) => current || `卡券兑换：${coupon.title}`);
    setNotice(`已加入购物车：${itemName} x ${quantity}`);
  }

  function changeQuantity(index: number, nextQuantity: number) {
    setCart((current) => {
      const line = current[index];
      if (!line) return current;
      const item = enabledItems.find((entry) => entry.id === line.itemId);
      const quantity = Math.max(0, Math.floor(nextQuantity));
      if (quantity <= 0) return current.filter((_, lineIndex) => lineIndex !== index);
      if (item?.stock !== null && item?.stock !== undefined && quantity > item.stock) {
        setError("兑换项目库存不足。");
        return current;
      }
      return current.map((entry, lineIndex) => (lineIndex === index ? { ...entry, quantity } : entry));
    });
  }

  function openRechargeDialog() {
    setError("");
    setNotice("");
    if (!selectedMember) {
      setError("请先选择会员。");
      setMemberPickerOpen(true);
      return;
    }
    setSelectedRechargePlanId((current) => current || enabledRechargePlans[0]?.id || "");
    setRechargeDialogOpen(true);
  }

  async function submitRechargePlan() {
    if (!selectedMember) {
      setError("请先选择会员。");
      setRechargeDialogOpen(false);
      return;
    }
    const plan = enabledRechargePlans.find((entry) => entry.id === selectedRechargePlanId);
    if (!plan) {
      setError("请选择充值方案。");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const operationId = createClientMutationOperationId("member-recharge");
      const response = await fetch("/api/memberships", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          siteId: normalizedSiteId,
          action: "member_operation",
          type: "recharge",
          membershipId: selectedMember.id,
          memberNo: selectedMember.memberNo,
          rechargePlanId: plan.id,
          operationId,
          note: `积分兑换充值：${plan.title}`,
        }),
      });
      const payload = (await response.json().catch(() => null)) as MembershipPatchPayload | null;
      if (!response.ok || !payload?.ok || !payload.membership) {
        throw new Error(operationErrorMessage(payload?.message, "充值失败，请稍后重试", "recharge"));
      }
      const updatedMembership = payload.membership;
      setMemberships((current) =>
        current.map((membership) => (isSameMembershipRecord(membership, updatedMembership) ? updatedMembership : membership)),
      );
      selectedMemberIdRef.current = updatedMembership.id;
      setSelectedMemberId(updatedMembership.id);
      invalidateMerchantAdminDataCachePrefix(makeMerchantAdminDataCacheKey("merchant-memberships", normalizedSiteId));
      invalidateMerchantAdminDataCachePrefix(
        makeMerchantAdminDataCacheKey("merchant-membership-detail", normalizedSiteId, selectedMember.id),
      );
      invalidateMerchantAdminDataCachePrefix(
        makeMerchantAdminDataCacheKey("merchant-membership-detail", normalizedSiteId, updatedMembership.id),
      );
      setRechargeDialogOpen(false);
      setNotice(`充值完成，余额增加 €${formatMoney(plan.rechargeAmount + plan.giftAmount)}，积分增加 ${formatPoints(plan.giftPoints)}。`);
      void loadData(true, { silent: true });
    } catch (rechargeError) {
      setError(rechargeError instanceof Error ? rechargeError.message : "充值失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  function submitQuickRedeemItem() {
    const points = parsePositiveInteger(quickRedeemPoints);
    const name = trimText(quickRedeemName, 120) || "临时项目";
    if (points <= 0) {
      setError("请填写快捷兑换积分。");
      return;
    }
    setCart((current) => [
      ...current,
      {
        itemId: `quick-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        customName: name,
        customCode: "快捷兑换",
        customPoints: points,
        quantity: 1,
      },
    ]);
    setQuickRedeemName("临时项目");
    setQuickRedeemPoints("");
    setQuickRedeemDialogOpen(false);
    setError("");
    setNotice("快捷兑换已加入兑换。");
  }

  function clearSale() {
    setCart([]);
    setNote("");
    setNotice("");
    setError("");
  }

  function holdCurrentSale() {
    if (!cart.length) {
      setError("当前没有可挂起的兑换。");
      return;
    }
    const memberName = selectedMember ? getMemberDisplayName(selectedMember) : "散客";
    const sale: HeldSale = {
      id: `held-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      title: `${memberName} / ${totalQuantity} 项 / ${totalPoints} 积分`,
      createdAt: formatDateTime(),
      selectedMemberId,
      memberKeyword,
      itemKeyword,
      categoryId,
      cart,
      note,
    };
    setHeldSales((current) => [sale, ...current].slice(0, 20));
    clearSale();
    setNotice("已挂单。");
  }

  function restoreHeldSale(sale: HeldSale) {
    selectedMemberIdRef.current = sale.selectedMemberId;
    setSelectedMemberId(sale.selectedMemberId);
    setMemberKeyword(sale.memberKeyword);
    setItemKeyword(sale.itemKeyword);
    setCategoryId(sale.categoryId);
    setCart(sale.cart);
    setNote(sale.note);
    setHeldSales((current) => current.filter((item) => item.id !== sale.id));
    setHeldOpen(false);
    setNotice("已提单。");
  }

  function handleRetrieveHeldSale() {
    if (heldSales.length === 0) {
      setError("暂无挂单。");
      setHeldOpen(false);
      return;
    }
    if (heldSales.length === 1) {
      restoreHeldSale(heldSales[0]);
      return;
    }
    setHeldOpen((current) => !current);
  }

  async function submitCheckout() {
    setError("");
    setNotice("");
    if (!selectedMember) {
      setError("请先选择会员。");
      setMemberPickerOpen(true);
      return;
    }
    if (!cartRows.length) {
      setError("请先选择兑换项目。");
      return;
    }
    if (!hasRedeemableCartEffect) {
      setError("积分券需要和兑换项目一起使用。");
      return;
    }
    if (grossPoints <= 0 && rawCouponPointDiscountTotal > 0) {
      setError("积分券需要和需扣积分的兑换项目一起使用。");
      return;
    }
    if (pointVoucherLimitExceeded) {
      setError(`本次积分兑换最多可使用 ${pointVoucherLimit} 张积分券。`);
      return;
    }
    if (pointVoucherMinimumViolation) {
      setError(`本次兑换需满 ${formatPoints(pointVoucherMinimumViolation.couponPointsVoucherMinimumRedeemPoints)} 积分才可使用所选积分券。`);
      return;
    }
    if (totalPoints > selectedInsight.pointBalance) {
      setError("会员积分不足，不能兑换。");
      return;
    }
    const receiptCreatedAt = new Date();
    const receiptBeforePointBalance = selectedInsight.pointBalance;
    const receiptLines = cartRows.map((row) => ({
      code: row.code || row.itemId,
      name: row.name,
      categoryName: row.categoryId ? categoryName(enabledCategories, row.categoryId) : "",
      quantity: row.quantity,
      unitPoints: row.unitPoints,
      subtotalPoints: row.subtotalPoints,
      couponDiscountLabel: row.couponDiscountLabel,
      couponPointDiscount: row.couponPointDiscount,
    }));
    const receiptNote = note.trim();
    setSaving(true);
    try {
      const operationId = createClientMutationOperationId("member-redemption-checkout");
      const response = await fetch("/api/memberships", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          siteId: normalizedSiteId,
          action: "member_redemption_checkout",
          membershipId: selectedMember.id,
          memberNo: selectedMember.memberNo,
          redemptionItems: cartRows.map((row) => ({
            redemptionItemId: row.item?.id,
            customName: row.custom ? row.name : undefined,
            customCode: row.custom ? row.code : undefined,
            customPoints: row.custom ? row.unitPoints : undefined,
            couponId: row.couponId || undefined,
            couponClaimId: row.couponClaimId || undefined,
            couponSettlementCode: row.couponSettlementCode || undefined,
            couponTitle: row.couponTitle || undefined,
            couponDiscountLabel: row.couponDiscountLabel || undefined,
            couponPointDiscount: row.couponPointDiscount || undefined,
            quantity: row.quantity,
          })),
          note: note.trim(),
          operationId,
        }),
      });
      const payload = (await response.json().catch(() => null)) as MembershipPatchPayload | null;
      if (!response.ok || !payload?.ok || !payload.membership) {
        throw new Error(operationErrorMessage(payload?.message, "积分兑换失败，请稍后重试"));
      }
      const updatedMembership = payload.membership;
      const receiptData: MerchantRedemptionReceiptData = {
        receiptNo: operationId.slice(-12).toUpperCase(),
        siteId: normalizedSiteId,
        siteName: trimText(siteName, 120) || normalizedSiteId,
        memberName: getMemberDisplayName(updatedMembership),
        memberNo: updatedMembership.memberNo,
        beforePointBalance: receiptBeforePointBalance,
        afterPointBalance: updatedMembership.pointBalance,
        totalQuantity,
        grossPoints,
        couponPointDiscountTotal,
        totalPoints,
        note: receiptNote,
        createdAt: receiptCreatedAt,
        lines: receiptLines,
      };
      setMemberships((current) =>
        current.map((membership) => (isSameMembershipRecord(membership, updatedMembership) ? updatedMembership : membership)),
      );
      selectedMemberIdRef.current = updatedMembership.id;
      setSelectedMemberId(updatedMembership.id);
      invalidateMerchantAdminDataCachePrefix(makeMerchantAdminDataCacheKey("merchant-memberships", normalizedSiteId));
      invalidateMerchantAdminDataCachePrefix(makeMerchantAdminDataCacheKey("merchant-membership-settings", normalizedSiteId));
      invalidateMerchantAdminDataCachePrefix(makeMerchantAdminDataCacheKey("merchant-coupons", normalizedSiteId));
      invalidateMerchantAdminDataCachePrefix(
        makeMerchantAdminDataCacheKey("merchant-membership-detail", normalizedSiteId, selectedMember.id),
      );
      invalidateMerchantAdminDataCachePrefix(
        makeMerchantAdminDataCacheKey("merchant-membership-detail", normalizedSiteId, updatedMembership.id),
      );
      setCart([]);
      setNote("");
      const couponLineCount = cartRows.filter((row) => row.couponSettlementCode).length;
      setNotice(
        totalPoints > 0 && couponLineCount > 0
          ? `兑换完成，已扣减 ${formatPoints(totalPoints)} 积分，并核销 ${couponLineCount} 张卡券。`
          : totalPoints === 0 && couponPointDiscountTotal > 0 && couponLineCount > 0
            ? `兑换完成，积分券已抵扣 ${formatPoints(couponPointDiscountTotal)} 积分，并核销 ${couponLineCount} 张卡券。`
          : totalPoints > 0
          ? `兑换完成，已扣减 ${formatPoints(totalPoints)} 积分。`
          : `兑换完成，已核销 ${couponLineCount} 张卡券。`,
      );
      printRedemptionReceipt(settings?.printSettings as MerchantReceiptPrintSettings | undefined, receiptData);
      void loadData(true, { silent: true });
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "积分兑换失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    submitCheckoutRef.current = submitCheckout;
  });

  useEffect(() => {
    cashierShortcutActionsRef.current = {
      blocked: () =>
        view !== "cashier" ||
        saving ||
        rechargeDialogOpen ||
        quickRedeemDialogOpen ||
        couponWalletOpen ||
        languageMenuOpen ||
        categoryMenuOpen ||
        imageSizeMenuOpen ||
        heldOpen ||
        Boolean(selectedRecordId),
      openQuickRedeem: () => {
        setError("");
        setNotice("");
        setQuickRedeemDialogOpen(true);
      },
      openRecharge: () => {
        setError("");
        setNotice("");
        if (!selectedMember) {
          setError("请先选择会员。");
          setMemberPickerOpen(true);
          return;
        }
        setSelectedRechargePlanId((current) => current || enabledRechargePlans[0]?.id || "");
        setRechargeDialogOpen(true);
      },
      openCheckout: () => {
        if (canCheckout) void submitCheckoutRef.current();
      },
    };
  }, [
    canCheckout,
    categoryMenuOpen,
    couponWalletOpen,
    enabledRechargePlans,
    heldOpen,
    imageSizeMenuOpen,
    languageMenuOpen,
    quickRedeemDialogOpen,
    rechargeDialogOpen,
    saving,
    selectedMember,
    selectedRecordId,
    view,
  ]);

  useEffect(() => {
    if (view !== "cashier" || typeof document === "undefined") return;
    const pressedKeys = cashierShortcutPressedKeysRef.current;
    const clearEnterTimer = () => {
      if (cashierShortcutEnterTimerRef.current === null) return;
      window.clearTimeout(cashierShortcutEnterTimerRef.current);
      cashierShortcutEnterTimerRef.current = null;
    };
    const clearShortcutState = () => {
      clearEnterTimer();
      pressedKeys.clear();
    };
    const runShortcutAction = (event: KeyboardEvent, action: () => void) => {
      event.preventDefault();
      event.stopPropagation();
      clearShortcutState();
      action();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      const shortcutKey = normalizeCashierShortcutKey(event);
      if (!shortcutKey) return;
      pressedKeys.add(shortcutKey);
      const actions = cashierShortcutActionsRef.current;
      if (actions.blocked()) {
        clearEnterTimer();
        return;
      }
      if ((shortcutKey === "minus" && pressedKeys.has("enter")) || (shortcutKey === "enter" && pressedKeys.has("minus"))) {
        runShortcutAction(event, actions.openQuickRedeem);
        return;
      }
      if ((shortcutKey === "plus" && pressedKeys.has("enter")) || (shortcutKey === "enter" && pressedKeys.has("plus"))) {
        runShortcutAction(event, actions.openRecharge);
        return;
      }
      if (shortcutKey !== "enter") return;
      if (isEditableShortcutTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      clearEnterTimer();
      cashierShortcutEnterTimerRef.current = window.setTimeout(() => {
        cashierShortcutEnterTimerRef.current = null;
        pressedKeys.delete("enter");
        const latestActions = cashierShortcutActionsRef.current;
        if (!latestActions.blocked()) latestActions.openCheckout();
      }, 120);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const shortcutKey = normalizeCashierShortcutKey(event);
      if (shortcutKey) pressedKeys.delete(shortcutKey);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearShortcutState);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearShortcutState);
      clearShortcutState();
    };
  }, [view]);

  return (
    <section className={`merchant-pos-cashier ${className}`}>
      <style>{`
        .merchant-pos-cashier {
          --pos-bg: #f3f6fb;
          --pos-surface: #ffffff;
          --pos-surface-soft: #f8fafc;
          --pos-line: #dfe7ee;
          --pos-line-strong: #b7c5d0;
          --pos-text: #17212b;
          --pos-muted: #657487;
          --pos-primary: #2f5f9f;
          --pos-primary-dark: #1f477e;
          --pos-primary-soft: #eaf2ff;
          --pos-danger: #d92d20;
          --pos-danger-soft: #fff1ef;
          --pos-shadow: 0 18px 48px rgba(15, 23, 42, 0.08);
          --pos-shadow-soft: 0 1px 2px rgba(20, 28, 38, 0.05), 0 8px 22px rgba(20, 28, 38, 0.055);
          --pos-focus-inset: 0 0 0 3px rgba(47, 95, 159, 0.18) inset;
          min-height: calc(100vh - 120px);
          padding: 0;
          color: var(--pos-text);
          background: var(--pos-bg);
          font-family:
            Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei",
            sans-serif;
          font-size: 14px;
          line-height: 1.45;
          font-synthesis: none;
          text-rendering: optimizeLegibility;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }

        .merchant-pos-cashier * {
          box-sizing: border-box;
        }

        .merchant-pos-cashier button,
        .merchant-pos-cashier input,
        .merchant-pos-cashier textarea,
        .merchant-pos-cashier select {
          font: inherit;
          letter-spacing: 0;
        }

        .merchant-pos-cashier svg {
          width: 17px;
          height: 17px;
          stroke: currentColor;
          stroke-width: 2;
          stroke-linecap: round;
          stroke-linejoin: round;
          fill: none;
        }

        .merchant-pos-cashier button {
          cursor: pointer;
        }

        .merchant-pos-cashier button:disabled {
          cursor: not-allowed;
        }

        .merchant-pos-cashier .cashier-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          min-height: 96px;
          margin-bottom: 18px;
          padding: 20px 22px;
          border: 1px solid var(--pos-line);
          border-radius: 28px;
          background: var(--pos-surface);
          box-shadow: var(--pos-shadow);
        }

        .merchant-pos-cashier .cashier-title {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .merchant-pos-cashier .cashier-title h2 {
          margin: 0;
          color: var(--pos-text);
          font-size: 26px;
          font-weight: 800;
          line-height: 32px;
          letter-spacing: 0;
        }

        .merchant-pos-cashier .cashier-date {
          color: var(--pos-muted);
          font-size: 14px;
          font-weight: 700;
        }

        .merchant-pos-cashier .cashier-loading {
          display: flex;
          align-items: center;
          min-height: 20px;
          margin-top: 6px;
          color: var(--pos-muted);
          font-size: 13px;
        }

        .merchant-pos-cashier .cashier-actions {
          display: flex;
          align-items: center;
          gap: 10px;
          min-height: 40px;
        }

        .merchant-pos-cashier .cashier-actions .el-button {
          min-height: 40px;
          padding: 0 12px;
          font-size: 13px;
          font-weight: 740;
        }

        .merchant-pos-cashier .language-menu-wrap {
          position: relative;
        }

        .merchant-pos-cashier .language-flag-icon {
          display: block;
          width: 32px;
          height: 22px;
          flex: 0 0 auto;
          overflow: hidden;
          border: 1px solid rgba(148, 163, 184, 0.45);
          border-radius: 4px;
          object-fit: cover;
          background: #fff;
          box-shadow: 0 1px 2px rgba(20, 28, 38, 0.08);
        }

        .merchant-pos-cashier .language-flag-icon.small {
          width: 18px;
          height: 14px;
          border: 1px solid rgba(148, 163, 184, 0.55);
          border-radius: 3px;
        }

        .merchant-pos-cashier .language-dropdown-menu {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          z-index: 90;
          width: 230px;
          max-height: 380px;
          overflow-y: auto;
          padding: 6px;
          border: 1px solid var(--pos-line);
          border-radius: 8px;
          background: var(--pos-surface);
          box-shadow: 0 22px 60px rgba(15, 23, 42, 0.22);
        }

        .merchant-pos-cashier .language-dropdown-item {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          min-height: 34px;
          padding: 0 9px;
          border: 0;
          border-radius: 6px;
          background: transparent;
          color: var(--pos-text);
          text-align: left;
          font-size: 13px;
          font-weight: 650;
        }

        .merchant-pos-cashier .language-dropdown-item:hover,
        .merchant-pos-cashier .language-dropdown-item.is-active-language {
          color: var(--pos-primary-dark);
          background: var(--pos-primary-soft);
        }

        .merchant-pos-cashier .language-dropdown-item.is-active-language {
          font-weight: 800;
        }

        .merchant-pos-cashier .language-dropdown-item span {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .merchant-pos-cashier .el-button,
        .merchant-pos-cashier .pos-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          min-height: 36px;
          padding: 0 14px;
          border: 1px solid var(--pos-line);
          border-radius: 8px;
          background: var(--pos-surface);
          color: var(--pos-text);
          font-weight: 720;
          white-space: nowrap;
          box-shadow: inset 0 -1px 0 rgba(20, 28, 38, 0.05);
          transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease, color 0.15s ease;
        }

        .merchant-pos-cashier .el-button:hover,
        .merchant-pos-cashier .pos-button:hover {
          border-color: #9ecfc4;
          background: var(--pos-primary-soft);
          color: var(--pos-primary-dark);
        }

        .merchant-pos-cashier .cashier-actions .el-button.language-action-button {
          width: 44px;
          min-width: 44px;
          height: 40px;
          min-height: 40px;
          padding: 0;
          justify-content: center;
          overflow: visible;
          box-shadow: var(--pos-shadow-soft);
        }

        .merchant-pos-cashier .cashier-actions .el-button.language-action-button .language-flag-icon {
          width: 32px;
          height: 22px;
          max-width: none;
          max-height: none;
        }

        .merchant-pos-cashier .el-button--primary,
        .merchant-pos-cashier .pos-button.primary {
          border-color: var(--pos-primary);
          background: var(--pos-primary);
          color: #fff;
        }

        .merchant-pos-cashier .el-button--primary:hover,
        .merchant-pos-cashier .pos-button.primary:hover {
          border-color: var(--pos-primary-dark);
          background: var(--pos-primary-dark);
          color: #fff;
        }

        .merchant-pos-cashier .cashier-workbench {
          display: grid;
          grid-template-columns: minmax(660px, 1fr) minmax(460px, 500px);
          gap: 16px;
          align-items: start;
        }

        .merchant-pos-cashier .panel {
          border: 1px solid var(--pos-line);
          border-radius: 28px;
          background: var(--pos-surface);
          box-shadow: var(--pos-shadow);
          overflow: hidden;
        }

        .merchant-pos-cashier .sale-panel,
        .merchant-pos-cashier .catalog-panel {
          min-height: calc(100vh - 176px);
        }

        .merchant-pos-cashier .panel-heading.compact {
          display: grid;
          grid-template-columns: minmax(150px, auto) minmax(0, 1fr);
          align-items: center;
          gap: 14px;
          padding: 16px 18px;
          border-bottom: 1px solid var(--pos-line);
        }

        .merchant-pos-cashier .member-line,
        .merchant-pos-cashier .member-search,
        .merchant-pos-cashier .catalog-toolbar,
        .merchant-pos-cashier .quantity-control,
        .merchant-pos-cashier .sale-summary {
          display: flex;
          align-items: center;
        }

        .merchant-pos-cashier .member-line {
          min-height: 28px;
          gap: 10px;
          color: var(--pos-muted);
          font-size: 13px;
          font-weight: 760;
        }

        .merchant-pos-cashier .member-avatar {
          display: grid;
          place-items: center;
          width: 30px;
          height: 30px;
          border-radius: 999px;
          background: #10201d;
          color: #fff;
          font-weight: 900;
        }

        .merchant-pos-cashier .member-line strong {
          color: var(--pos-text);
          font-size: 14px;
        }

        .merchant-pos-cashier .member-name-button {
          min-width: 0;
          max-width: 180px;
          overflow: hidden;
          border: 0;
          background: transparent;
          color: var(--pos-text);
          font-size: 14px;
          font-weight: 900;
          text-align: left;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .merchant-pos-cashier .member-name-button:hover {
          color: var(--pos-primary-dark);
          text-decoration: underline;
          text-underline-offset: 3px;
        }

        .merchant-pos-cashier .link-button {
          border: 0;
          background: transparent;
          color: var(--pos-primary-dark);
          font-weight: 800;
        }

        .merchant-pos-cashier .member-actions {
          display: flex;
          flex-wrap: nowrap;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
          min-width: 0;
          width: 100%;
        }

        .merchant-pos-cashier .member-search {
          position: relative;
          flex: 0 1 306px;
          width: min(306px, 29vw);
          gap: 8px;
        }

        .merchant-pos-cashier .member-clear-button {
          display: inline-grid;
          place-items: center;
          flex: 0 0 auto;
          width: 38px;
          height: 38px;
          border: 1px solid var(--pos-line);
          border-radius: 8px;
          background: var(--pos-surface);
          color: var(--pos-muted);
          transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
        }

        .merchant-pos-cashier .member-clear-button:hover {
          border-color: #9ecfc4;
          background: var(--pos-primary-soft);
          color: var(--pos-primary-dark);
        }

        .merchant-pos-cashier .member-clear-button svg {
          width: 18px;
          height: 18px;
        }

        .merchant-pos-cashier .member-search input,
        .merchant-pos-cashier .product-search-input {
          width: 100%;
          height: 38px;
          border: 1px solid var(--pos-line);
          border-radius: 8px;
          background: var(--pos-surface);
          color: var(--pos-text);
          outline: none;
          padding: 0 12px;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }

        .merchant-pos-cashier .member-search input:focus,
        .merchant-pos-cashier .product-search-input:focus,
        .merchant-pos-cashier .checkout-note input:focus,
        .merchant-pos-cashier .quick-input:focus,
        .merchant-pos-cashier .cart-qty-input:focus {
          border-color: var(--pos-primary);
          box-shadow: 0 0 0 3px rgba(14, 118, 102, 0.12);
        }

        .merchant-pos-cashier .member-suggestions {
          position: absolute;
          top: 44px;
          left: 0;
          z-index: 30;
          display: grid;
          width: 100%;
          max-height: 320px;
          overflow-y: auto;
          padding: 6px;
          border: 1px solid var(--pos-line);
          border-radius: 8px;
          background: var(--pos-surface);
          box-shadow: 0 12px 34px rgba(20, 28, 38, 0.14);
        }

        .merchant-pos-cashier .member-suggestion {
          display: grid;
          grid-template-columns: minmax(90px, 1fr) minmax(90px, 1fr) minmax(70px, 0.8fr);
          gap: 10px;
          align-items: center;
          width: 100%;
          min-height: 38px;
          padding: 6px 8px;
          border: 0;
          border-radius: 7px;
          background: transparent;
          color: var(--pos-text);
          text-align: left;
        }

        .merchant-pos-cashier .member-suggestion:hover {
          background: var(--pos-primary-soft);
        }

        .merchant-pos-cashier .member-suggestion strong,
        .merchant-pos-cashier .member-suggestion span {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .merchant-pos-cashier .member-suggestion span {
          color: var(--pos-muted);
          font-size: 12px;
        }

        .merchant-pos-cashier .member-suggestion-note {
          padding: 8px 10px;
          color: var(--pos-muted);
          font-size: 12px;
        }

        .merchant-pos-cashier .member-action-buttons {
          display: flex;
          flex: 0 0 auto;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
        }

        .merchant-pos-cashier .member-coupon-wallet {
          display: grid;
          gap: 10px;
          margin-bottom: 12px;
          padding: 12px;
          border: 1px solid var(--pos-line);
          border-radius: 8px;
          background: var(--pos-surface-soft);
        }

        .merchant-pos-cashier .member-coupon-wallet-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .merchant-pos-cashier .member-coupon-wallet-title {
          color: var(--pos-text);
          font-weight: 900;
        }

        .merchant-pos-cashier .member-coupon-wallet-count {
          color: var(--pos-muted);
          font-size: 12px;
          font-weight: 800;
        }

        .merchant-pos-cashier .member-coupon-list {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          padding-bottom: 2px;
          overscroll-behavior-x: contain;
        }

        .merchant-pos-cashier .member-coupon-card {
          display: grid;
          flex: 0 0 240px;
          gap: 7px;
          min-height: 116px;
          padding: 10px;
          border: 1px solid var(--pos-line);
          border-radius: 8px;
          background: var(--pos-surface);
        }

        .merchant-pos-cashier .member-coupon-card.is-in-cart {
          border-color: var(--pos-primary);
          background: var(--pos-primary-soft);
          box-shadow: var(--pos-focus-inset);
        }

        .merchant-pos-cashier .member-coupon-card strong,
        .merchant-pos-cashier .member-coupon-card span,
        .merchant-pos-cashier .member-coupon-card small {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .merchant-pos-cashier .member-coupon-card strong {
          color: var(--pos-text);
          font-size: 14px;
        }

        .merchant-pos-cashier .member-coupon-card span,
        .merchant-pos-cashier .member-coupon-card small {
          color: var(--pos-muted);
          font-size: 12px;
          font-weight: 760;
        }

        .merchant-pos-cashier .member-coupon-card button {
          justify-self: start;
          min-height: 30px;
          padding: 0 10px;
          border: 1px solid var(--pos-primary);
          border-radius: 8px;
          background: var(--pos-primary);
          color: #fff;
          font-size: 12px;
          font-weight: 900;
        }

        .merchant-pos-cashier .member-coupon-card button:disabled {
          border-color: var(--pos-line);
          background: #e2e8f0;
          color: var(--pos-muted);
        }

        .merchant-pos-cashier .member-coupon-empty {
          display: grid;
          place-items: center;
          min-height: 78px;
          border: 1px dashed var(--pos-line);
          border-radius: 8px;
          color: var(--pos-muted);
          font-weight: 720;
        }

        .merchant-pos-cashier .cart-area {
          padding: 18px;
        }

        .merchant-pos-cashier .cart-table {
          overflow: hidden;
          border: 1px solid var(--pos-line);
          border-radius: 8px;
          background: var(--pos-surface);
        }

        .merchant-pos-cashier .cart-header,
        .merchant-pos-cashier .cart-row {
          display: grid;
          grid-template-columns: 120px minmax(190px, 1fr) 96px 190px 110px;
          align-items: center;
          gap: 12px;
        }

        .merchant-pos-cashier .cart-header {
          min-height: 40px;
          padding: 0 14px;
          border-bottom: 1px solid var(--pos-line);
          background: var(--pos-surface-soft);
          color: #4b5a6b;
          font-weight: 900;
        }

        .merchant-pos-cashier .cart-header span:nth-child(3),
        .merchant-pos-cashier .cart-header span:nth-child(4),
        .merchant-pos-cashier .cart-header span:nth-child(5) {
          text-align: center;
        }

        .merchant-pos-cashier .cart-body {
          min-height: 340px;
          max-height: calc(100vh - 420px);
          overflow-y: auto;
          overscroll-behavior: contain;
        }

        .merchant-pos-cashier .cart-row-shell {
          position: relative;
          overflow: hidden;
          border-bottom: 1px solid var(--pos-line);
        }

        .merchant-pos-cashier .cart-row-shell:last-child {
          border-bottom: 0;
        }

        .merchant-pos-cashier .cart-row {
          position: relative;
          z-index: 1;
          min-height: 56px;
          padding: 7px 14px;
          background: var(--pos-surface);
        }

        .merchant-pos-cashier .cart-code,
        .merchant-pos-cashier .cart-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .merchant-pos-cashier .cart-code {
          color: var(--pos-muted);
          font-size: 12px;
        }

        .merchant-pos-cashier .cart-name {
          color: var(--pos-text);
        }

        .merchant-pos-cashier .cart-meta {
          display: block;
          margin-top: 2px;
          color: var(--pos-muted);
          font-size: 12px;
          font-weight: 600;
        }

        .merchant-pos-cashier .cart-row > span:nth-child(3),
        .merchant-pos-cashier .cart-row > span:nth-child(5) {
          text-align: center;
          font-weight: 900;
        }

        .merchant-pos-cashier .quantity-control {
          justify-content: center;
          gap: 8px;
        }

        .merchant-pos-cashier .qty-button {
          display: grid;
          place-items: center;
          width: 34px;
          height: 34px;
          border: 1px solid var(--pos-line-strong);
          border-radius: 999px;
          background: var(--pos-surface);
          color: var(--pos-primary-dark);
          font-size: 19px;
          font-weight: 900;
          transition: transform 0.12s ease, box-shadow 0.12s ease;
        }

        .merchant-pos-cashier .qty-button.plus {
          border-color: var(--pos-primary);
          background: var(--pos-primary);
          color: #fff;
        }

        .merchant-pos-cashier .qty-button:hover {
          transform: translateY(-1px);
          box-shadow: var(--pos-shadow-soft);
        }

        .merchant-pos-cashier .cart-qty-input {
          width: 62px;
          height: 34px;
          border: 1px solid var(--pos-line);
          border-radius: 8px;
          text-align: center;
          font-weight: 900;
          outline: none;
        }

        .merchant-pos-cashier .coupon-locked-quantity {
          display: inline-grid;
          place-items: center;
          min-width: 62px;
          height: 34px;
          border: 1px solid var(--pos-line);
          border-radius: 8px;
          background: var(--pos-surface-soft);
          color: var(--pos-primary-dark);
          font-weight: 900;
        }

        .merchant-pos-cashier .cart-empty {
          display: flex;
          min-height: 340px;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          color: var(--pos-muted);
          text-align: center;
        }

        .merchant-pos-cashier .cart-empty-box {
          width: 82px;
          height: 82px;
          border-radius: 18px;
          background:
            linear-gradient(135deg, transparent 44%, rgba(255, 255, 255, 0.4) 45%),
            #eef2f6;
        }

        .merchant-pos-cashier .checkout-note {
          margin-top: 12px;
        }

        .merchant-pos-cashier .checkout-note input {
          width: 100%;
          height: 38px;
          border: 1px solid var(--pos-line);
          border-radius: 8px;
          padding: 0 12px;
          outline: none;
        }

        .merchant-pos-cashier .sale-summary {
          position: relative;
          justify-content: flex-end;
          gap: 20px;
          min-height: 78px;
          margin-top: 16px;
          padding-top: 16px;
          border-top: 1px solid var(--pos-line);
        }

        .merchant-pos-cashier .summary-actions-left {
          position: relative;
          display: flex;
          align-items: center;
          gap: 8px;
          margin-right: auto;
        }

        .merchant-pos-cashier .held-count {
          display: inline-grid;
          place-items: center;
          min-width: 20px;
          height: 20px;
          margin-left: 4px;
          padding: 0 6px;
          border-radius: 999px;
          background: var(--pos-primary-soft);
          color: var(--pos-primary-dark);
          font-size: 12px;
          font-weight: 900;
        }

        .merchant-pos-cashier .held-sales-panel {
          position: absolute;
          bottom: 46px;
          left: 0;
          z-index: 25;
          display: grid;
          gap: 8px;
          width: 360px;
          max-height: 320px;
          overflow-y: auto;
          padding: 10px;
          border: 1px solid var(--pos-line);
          border-radius: 8px;
          background: var(--pos-surface);
          box-shadow: 0 12px 34px rgba(20, 28, 38, 0.14);
        }

        .merchant-pos-cashier .held-sales-title {
          color: var(--pos-text);
          font-weight: 900;
        }

        .merchant-pos-cashier .held-sale-item {
          display: grid;
          gap: 4px;
          width: 100%;
          padding: 10px;
          border: 1px solid var(--pos-line);
          border-radius: 8px;
          background: var(--pos-surface-soft);
          color: var(--pos-text);
          text-align: left;
        }

        .merchant-pos-cashier .held-sale-item:hover {
          border-color: var(--pos-primary);
          background: var(--pos-primary-soft);
        }

        .merchant-pos-cashier .held-sale-item span {
          color: var(--pos-muted);
          font-size: 12px;
        }

        .merchant-pos-cashier .summary-item,
        .merchant-pos-cashier .summary-total {
          display: grid;
          gap: 4px;
          min-width: 92px;
          text-align: right;
        }

        .merchant-pos-cashier .summary-item span,
        .merchant-pos-cashier .summary-total span {
          color: var(--pos-muted);
          font-size: 13px;
        }

        .merchant-pos-cashier .summary-item strong {
          font-size: 18px;
        }

        .merchant-pos-cashier .summary-total strong {
          color: var(--pos-primary);
          font-size: 30px;
          line-height: 1;
        }

        .merchant-pos-cashier .checkout-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-width: 96px;
          height: 44px;
          border: 0;
          border-radius: 8px;
          background: var(--pos-primary);
          color: #fff;
          font-size: 16px;
          font-weight: 900;
        }

        .merchant-pos-cashier .checkout-button:hover {
          background: var(--pos-primary-dark);
        }

        .merchant-pos-cashier .checkout-button:disabled {
          background: #cbd5e1;
          color: #f8fafc;
        }

        .merchant-pos-cashier .catalog-panel {
          position: relative;
          overflow: visible;
          padding: 16px;
        }

        .merchant-pos-cashier .catalog-toolbar {
          gap: 10px;
          margin-bottom: 14px;
        }

        .merchant-pos-cashier .product-search-wrap {
          position: relative;
          flex: 1;
        }

        .merchant-pos-cashier .product-search-prefix {
          position: absolute;
          left: 11px;
          top: 9px;
          color: var(--pos-muted);
          font-weight: 900;
        }

        .merchant-pos-cashier .product-search-input {
          padding-left: 34px;
        }

        .merchant-pos-cashier .coupon-results {
          display: grid;
          gap: 8px;
          margin-bottom: 14px;
        }

        .merchant-pos-cashier .coupon-result {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 6px 10px;
          align-items: center;
          padding: 10px 12px;
          border: 1px solid var(--pos-line);
          border-radius: 8px;
          background: #fffaf0;
          color: var(--pos-text);
        }

        .merchant-pos-cashier .coupon-result strong,
        .merchant-pos-cashier .coupon-result span {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .merchant-pos-cashier .coupon-result small {
          grid-column: 1 / -1;
          color: var(--pos-muted);
          font-weight: 700;
        }

        .merchant-pos-cashier .modal-backdrop {
          position: fixed;
          inset: 0;
          z-index: 80;
          display: grid;
          place-items: center;
          padding: 24px;
          background: rgba(15, 23, 42, 0.38);
        }

        .merchant-pos-cashier .pos-modal {
          width: min(560px, 100%);
          max-height: min(720px, calc(100vh - 48px));
          overflow-y: auto;
          border-radius: 10px;
          border: 1px solid var(--pos-line);
          background: var(--pos-surface);
          box-shadow: 0 24px 70px rgba(15, 23, 42, 0.28);
        }

        .merchant-pos-cashier .pos-modal-header,
        .merchant-pos-cashier .pos-modal-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 16px 18px;
        }

        .merchant-pos-cashier .pos-modal-header {
          border-bottom: 1px solid var(--pos-line);
        }

        .merchant-pos-cashier .pos-modal-header h3 {
          margin: 0;
          font-size: 18px;
          font-weight: 900;
        }

        .merchant-pos-cashier .pos-modal-body {
          display: grid;
          gap: 12px;
          padding: 16px 18px;
        }

        .merchant-pos-cashier .pos-modal-footer {
          justify-content: flex-end;
          border-top: 1px solid var(--pos-line);
        }

        .merchant-pos-cashier .member-coupon-modal {
          width: min(760px, 100%);
        }

        .merchant-pos-cashier .member-coupon-modal-member {
          margin-top: 4px;
          color: var(--pos-muted);
          font-size: 12px;
          font-weight: 760;
        }

        .merchant-pos-cashier .member-coupon-modal-summary {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .merchant-pos-cashier .member-coupon-modal-summary span,
        .merchant-pos-cashier .member-coupon-card .member-coupon-status-tag {
          display: inline-flex;
          align-items: center;
          width: max-content;
          min-height: 26px;
          padding: 0 9px;
          border-radius: 999px;
          background: var(--pos-primary-soft);
          color: var(--pos-primary-dark);
          font-size: 12px;
          font-weight: 850;
        }

        .merchant-pos-cashier .member-coupon-sections {
          display: grid;
          gap: 14px;
        }

        .merchant-pos-cashier .member-coupon-section {
          display: grid;
          gap: 10px;
          padding: 12px;
          border: 1px solid var(--pos-line);
          border-radius: 8px;
          background: var(--pos-surface-soft);
        }

        .merchant-pos-cashier .member-coupon-section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .merchant-pos-cashier .member-coupon-section-header strong {
          color: var(--pos-text);
          font-weight: 900;
        }

        .merchant-pos-cashier .member-coupon-section-header span {
          color: var(--pos-muted);
          font-size: 12px;
          font-weight: 800;
        }

        .merchant-pos-cashier .member-coupon-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 10px;
        }

        .merchant-pos-cashier .member-coupon-modal .member-coupon-card {
          flex: initial;
          min-width: 0;
        }

        .merchant-pos-cashier .member-coupon-card.is-disabled {
          background: #f8fafc;
        }

        .merchant-pos-cashier .member-coupon-card.is-disabled .member-coupon-status-tag {
          border: 1px solid var(--pos-line);
          background: #e2e8f0;
          color: var(--pos-muted);
        }

        .merchant-pos-cashier .member-coupon-loading {
          display: grid;
          place-items: center;
          min-height: 120px;
          border: 1px dashed var(--pos-line);
          border-radius: 8px;
          color: var(--pos-muted);
          font-weight: 800;
        }

        .merchant-pos-cashier .recharge-plan-option {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 10px;
          align-items: start;
          padding: 12px;
          border: 1px solid var(--pos-line);
          border-radius: 8px;
          cursor: pointer;
        }

        .merchant-pos-cashier .recharge-plan-option.is-active {
          border-color: var(--pos-primary);
          background: var(--pos-primary-soft);
          box-shadow: var(--pos-focus-inset);
        }

        .merchant-pos-cashier .recharge-plan-option strong {
          display: block;
          margin-bottom: 4px;
        }

        .merchant-pos-cashier .recharge-plan-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          color: var(--pos-muted);
          font-size: 13px;
          font-weight: 800;
        }

        .merchant-pos-cashier .quick-field {
          display: grid;
          gap: 6px;
          color: var(--pos-text);
          font-weight: 800;
        }

        .merchant-pos-cashier .quick-input {
          width: 100%;
          height: 40px;
          border: 1px solid var(--pos-line);
          border-radius: 8px;
          padding: 0 12px;
          outline: none;
        }

        .merchant-pos-cashier .records-panel {
          min-height: calc(100vh - 190px);
          padding: 18px;
        }

        .merchant-pos-cashier .record-filter-grid {
          display: grid;
          grid-template-columns: minmax(260px, 1.35fr) minmax(280px, 1.35fr) auto;
          gap: 12px;
          align-items: end;
          margin-bottom: 16px;
        }

        .merchant-pos-cashier .record-filter-field {
          display: grid;
          min-width: 0;
          gap: 6px;
        }

        .merchant-pos-cashier .record-filter-field label {
          color: var(--pos-muted);
          font-size: 12px;
          font-weight: 760;
        }

        .merchant-pos-cashier .record-search {
          position: relative;
        }

        .merchant-pos-cashier .record-search svg {
          position: absolute;
          left: 11px;
          top: 11px;
          width: 16px;
          height: 16px;
          color: var(--pos-muted);
        }

        .merchant-pos-cashier .record-search input {
          width: 100%;
          height: 40px;
          border: 1px solid var(--pos-line);
          border-radius: 8px;
          padding: 0 12px 0 34px;
          outline: none;
        }

        .merchant-pos-cashier .record-search input:focus {
          border-color: var(--pos-primary);
          box-shadow: var(--pos-focus-inset);
        }

        .merchant-pos-cashier .record-time-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
        }

        .merchant-pos-cashier .record-time-chip {
          min-height: 32px;
          padding: 0 12px;
          border: 1px solid var(--pos-line);
          border-radius: 999px;
          background: var(--pos-surface);
          color: var(--pos-text);
          font-size: 13px;
          font-weight: 740;
        }

        .merchant-pos-cashier .record-time-chip:hover,
        .merchant-pos-cashier .record-time-chip.active {
          border-color: var(--pos-primary);
          background: var(--pos-primary-soft);
          color: var(--pos-primary-dark);
        }

        .merchant-pos-cashier .record-filter-actions {
          display: flex;
          justify-content: flex-end;
        }

        .merchant-pos-cashier .records-table {
          max-height: 620px;
          overflow: auto;
          border: 1px solid var(--pos-line);
          border-radius: 8px;
          background: var(--pos-surface);
        }

        .merchant-pos-cashier .records-row {
          display: grid;
          grid-template-columns: 70px minmax(150px, 1fr) minmax(150px, 1fr) 110px 100px minmax(150px, 1fr) minmax(240px, 1.35fr) 100px;
          gap: 12px;
          align-items: center;
          min-height: 48px;
          padding: 10px 14px;
          border-bottom: 1px solid var(--pos-line);
        }

        .merchant-pos-cashier .records-row.header {
          background: var(--pos-surface-soft);
          color: #4b5a6b;
          font-weight: 900;
        }

        .merchant-pos-cashier .records-row:last-child {
          border-bottom: 0;
        }

        .merchant-pos-cashier .records-row span,
        .merchant-pos-cashier .records-row strong {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .merchant-pos-cashier .records-row .record-amount,
        .merchant-pos-cashier .records-row .record-points {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }

        .merchant-pos-cashier .record-status-tag {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: max-content;
          min-height: 24px;
          padding: 0 8px;
          border: 1px solid rgba(14, 118, 102, 0.28);
          border-radius: 999px;
          background: var(--pos-primary-soft);
          color: var(--pos-primary-dark);
          font-size: 12px;
          font-weight: 800;
        }

        .merchant-pos-cashier .record-row-actions {
          display: flex;
          justify-content: flex-end;
        }

        .merchant-pos-cashier .record-row-actions .pos-button {
          min-height: 28px;
          padding: 0 9px;
          font-size: 12px;
        }

        .merchant-pos-cashier .record-pagination {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
          padding-top: 14px;
          color: var(--pos-muted);
          font-size: 13px;
          font-weight: 720;
        }

        .merchant-pos-cashier .record-pagination .pos-button {
          min-height: 30px;
          padding: 0 10px;
          font-size: 12px;
        }

        .merchant-pos-cashier .record-detail-grid {
          display: grid;
          grid-template-columns: 120px minmax(0, 1fr);
          gap: 10px 14px;
          padding: 2px 0;
        }

        .merchant-pos-cashier .record-detail-grid span {
          color: var(--pos-muted);
          font-weight: 760;
        }

        .merchant-pos-cashier .record-detail-grid strong {
          min-width: 0;
          overflow-wrap: anywhere;
        }

        .merchant-pos-cashier .record-empty-row {
          display: grid;
          place-items: center;
          min-height: 180px;
          color: var(--pos-muted);
          font-weight: 720;
        }

        .merchant-pos-cashier .product-view-toggle {
          position: relative;
          display: flex;
          gap: 6px;
          padding: 3px;
          border: 1px solid var(--pos-line);
          border-radius: 8px;
          background: var(--pos-surface-soft);
        }

        .merchant-pos-cashier .view-mode-button {
          display: grid;
          place-items: center;
          width: 32px;
          height: 30px;
          border: 0;
          border-radius: 6px;
          background: transparent;
          color: var(--pos-muted);
          cursor: pointer;
        }

        .merchant-pos-cashier .view-mode-button:hover,
        .merchant-pos-cashier .view-mode-button.active {
          background: var(--pos-surface);
          color: var(--pos-primary-dark);
          box-shadow: 0 0 0 1px var(--pos-line) inset;
        }

        .merchant-pos-cashier .catalog-toolbar {
          position: relative;
        }

        .merchant-pos-cashier .catalog-popover {
          position: absolute;
          top: calc(100% + 10px);
          right: 0;
          z-index: 20;
          width: 220px;
          border: 1px solid var(--pos-line);
          border-radius: 8px;
          background: var(--pos-surface);
          padding: 7px;
          box-shadow: 0 20px 44px rgba(15, 23, 42, 0.16);
        }

        .merchant-pos-cashier .catalog-popover::before {
          content: "";
          position: absolute;
          right: 24px;
          top: -7px;
          width: 13px;
          height: 13px;
          border-left: 1px solid var(--pos-line);
          border-top: 1px solid var(--pos-line);
          background: var(--pos-surface);
          transform: rotate(45deg);
        }

        .merchant-pos-cashier .catalog-popover-left {
          left: 6px;
          right: auto;
          width: 210px;
        }

        .merchant-pos-cashier .catalog-popover-left::before {
          left: 88px;
          right: auto;
        }

        .merchant-pos-cashier .catalog-popover-stack {
          display: grid;
          gap: 6px;
        }

        .merchant-pos-cashier .catalog-panel-button {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          min-height: 31px;
          border: 1px solid var(--pos-line);
          border-radius: 6px;
          background: var(--pos-surface-soft);
          color: var(--pos-text);
          font-weight: 820;
          cursor: pointer;
          transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
        }

        .merchant-pos-cashier .catalog-panel-button:hover,
        .merchant-pos-cashier .catalog-panel-button.active {
          border-color: var(--pos-primary);
          background: var(--pos-primary-soft);
          color: var(--pos-primary-dark);
          box-shadow: var(--pos-focus-inset);
        }

        .merchant-pos-cashier .catalog-panel-label {
          margin-top: 2px;
          color: var(--pos-muted);
          font-size: 12px;
          font-weight: 820;
        }

        .merchant-pos-cashier .category-filter-shell {
          position: relative;
        }

        .merchant-pos-cashier .catalog-sort-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
        }

        .merchant-pos-cashier .category-floating-panel {
          position: absolute;
          top: 82px;
          right: calc(100% + 10px);
          z-index: 45;
          display: grid;
          gap: 8px;
          width: 220px;
          max-height: calc(100vh - 330px);
          overflow-y: auto;
          padding: 8px;
          border: 1px solid var(--pos-line);
          border-radius: 8px;
          background: var(--pos-surface);
          box-shadow: 0 20px 44px rgba(15, 23, 42, 0.16);
          overscroll-behavior: contain;
          scrollbar-width: thin;
          touch-action: pan-y;
          -webkit-overflow-scrolling: touch;
          user-select: none;
        }

        .merchant-pos-cashier .category-sort-panel {
          display: grid;
          gap: 7px;
          padding: 2px 0 4px;
        }

        .merchant-pos-cashier .category-sort-row {
          display: grid;
          grid-template-columns: 1fr;
          gap: 6px;
        }

        .merchant-pos-cashier .category-sort-row.compact {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          align-items: center;
        }

        .merchant-pos-cashier .category-sort-row span {
          grid-column: 1 / -1;
          color: var(--pos-muted);
          font-size: 12px;
          font-weight: 720;
        }

        .merchant-pos-cashier .category-sort-row button,
        .merchant-pos-cashier .product-size-menu button {
          min-height: 30px;
          height: auto;
          padding: 6px 8px;
          border: 1px solid var(--pos-line);
          border-radius: 8px;
          background: var(--pos-surface-soft);
          color: var(--pos-text);
          font-weight: 720;
          line-height: 1.15;
          overflow-wrap: anywhere;
          white-space: normal;
          cursor: pointer;
        }

        .merchant-pos-cashier .category-sort-row button.active,
        .merchant-pos-cashier .category-sort-row button:hover,
        .merchant-pos-cashier .product-size-menu button.active,
        .merchant-pos-cashier .product-size-menu button:hover {
          border-color: var(--pos-primary);
          background: var(--pos-primary-soft);
          color: var(--pos-primary-dark);
          box-shadow: var(--pos-focus-inset);
        }

        .merchant-pos-cashier .category-side-item {
          display: flex;
          align-items: center;
          gap: 6px;
          width: 100%;
          height: 36px;
          border: 1px solid var(--pos-line);
          border-radius: 8px;
          background: var(--pos-surface-soft);
          padding: 0 9px;
          color: var(--pos-text);
          font-weight: 720;
          text-align: left;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          cursor: pointer;
          transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
        }

        .merchant-pos-cashier .category-side-item.active,
        .merchant-pos-cashier .category-side-item:hover {
          border-color: var(--pos-primary);
          background: var(--pos-primary-soft);
          color: var(--pos-primary-dark);
          box-shadow: var(--pos-focus-inset);
        }

        .merchant-pos-cashier .category-side-checkbox {
          flex: 0 0 auto;
          display: inline-grid;
          place-items: center;
          width: 16px;
          height: 16px;
          cursor: pointer;
        }

        .merchant-pos-cashier .category-side-checkbox input {
          position: absolute;
          opacity: 0;
          pointer-events: none;
        }

        .merchant-pos-cashier .category-side-checkbox span {
          width: 15px;
          height: 15px;
          border: 1px solid var(--pos-line);
          border-radius: 4px;
          background: var(--pos-surface);
          box-shadow: 0 1px 1px rgba(15, 33, 29, 0.04);
        }

        .merchant-pos-cashier .category-side-checkbox input:checked + span {
          border-color: var(--pos-primary);
          background: linear-gradient(135deg, transparent 50%, rgba(255, 255, 255, 0.2) 50%), var(--pos-primary);
        }

        .merchant-pos-cashier .category-side-checkbox input:checked + span::after {
          content: "";
          display: block;
          width: 8px;
          height: 4px;
          margin: 3px 0 0 3px;
          border-left: 2px solid #fff;
          border-bottom: 2px solid #fff;
          transform: rotate(-45deg);
        }

        .merchant-pos-cashier .catalog-panel-button svg {
          width: 14px;
          height: 14px;
          fill: none;
          stroke: currentColor;
          stroke-width: 2.4;
          stroke-linecap: round;
          stroke-linejoin: round;
        }

        .merchant-pos-cashier .image-size-popover {
          right: 37px;
          width: 112px;
        }

        .merchant-pos-cashier .image-size-popover::before {
          right: 25px;
        }

        .merchant-pos-cashier .product-size-menu {
          display: grid;
          justify-items: stretch;
          gap: 6px;
          width: 100%;
        }

        .merchant-pos-cashier .product-size-menu button {
          display: flex;
          align-items: center;
          width: 100%;
          justify-content: center;
          text-align: center;
        }

        .merchant-pos-cashier .category-row {
          display: flex;
          flex-wrap: nowrap;
          gap: 9px;
          margin-bottom: 14px;
          overflow-x: auto;
          overflow-y: hidden;
          padding: 0 2px 5px 0;
          overscroll-behavior-x: contain;
        }

        .merchant-pos-cashier .category-menu-anchor {
          position: relative;
          flex: 0 0 auto;
        }

        .merchant-pos-cashier .category-chip {
          flex: 0 0 auto;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          min-width: 100px;
          height: 38px;
          padding: 0 13px;
          border: 1px solid var(--pos-line);
          border-radius: 8px;
          background: var(--pos-surface-soft);
          color: var(--pos-text);
          cursor: pointer;
          font-weight: 720;
          transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
        }

        .merchant-pos-cashier .category-chip.active,
        .merchant-pos-cashier .category-chip:hover {
          border-color: var(--pos-primary);
          background: var(--pos-primary-soft);
          color: var(--pos-primary-dark);
          box-shadow: var(--pos-focus-inset);
        }

        .merchant-pos-cashier .category-button-icon {
          flex: 0 0 auto;
          display: grid;
          place-items: center;
          width: 17px;
          height: 17px;
        }

        .merchant-pos-cashier .category-button-label {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .merchant-pos-cashier .catalog-products {
          min-width: 0;
        }

        .merchant-pos-cashier .goods-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
          max-height: calc(100vh - 330px);
          overflow-y: auto;
          padding: 3px 4px 4px 3px;
          overscroll-behavior: contain;
        }

        .merchant-pos-cashier .goods-grid.goods-grid-large {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .merchant-pos-cashier .goods-grid.goods-grid-small {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }

        .merchant-pos-cashier .goods-list {
          display: grid;
          gap: 8px;
          max-height: calc(100vh - 330px);
          overflow-y: auto;
          padding: 3px 4px 4px 3px;
          overscroll-behavior: contain;
        }

        .merchant-pos-cashier .product-tile {
          display: grid;
          grid-template-rows: auto auto;
          gap: 7px;
          padding: 10px;
          border: 1px solid var(--pos-line);
          border-radius: 8px;
          background: var(--pos-surface-soft);
          color: var(--pos-text);
          text-align: left;
          box-shadow: 0 1px 0 rgba(20, 28, 38, 0.03);
          transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
        }

        .merchant-pos-cashier .product-tile:hover {
          position: relative;
          z-index: 1;
          border-color: var(--pos-primary);
          background: var(--pos-primary-soft);
          box-shadow: var(--pos-focus-inset), var(--pos-shadow-soft);
        }

        .merchant-pos-cashier .product-tile:disabled,
        .merchant-pos-cashier .product-tile.is-out-of-stock {
          cursor: not-allowed;
          opacity: 0.58;
        }

        .merchant-pos-cashier .product-visual {
          display: grid;
          place-items: center;
          width: 100%;
          aspect-ratio: 1 / 1;
          overflow: hidden;
          border-radius: 7px;
          background:
            radial-gradient(circle at 25% 18%, rgba(255, 255, 255, 0.92), transparent 28%),
            linear-gradient(135deg, #dbeee9, #f8fafc 48%, #dfe7ee);
          color: var(--pos-primary-dark);
          font-size: 28px;
          font-weight: 900;
        }

        .merchant-pos-cashier .goods-grid-large .product-visual {
          font-size: 34px;
        }

        .merchant-pos-cashier .goods-grid-small .product-visual {
          font-size: 20px;
        }

        .merchant-pos-cashier .product-visual img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .merchant-pos-cashier .product-footer {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          grid-template-rows: auto auto;
          gap: 8px;
          align-items: end;
        }

        .merchant-pos-cashier .product-footer strong,
        .merchant-pos-cashier .product-tile-text strong {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .merchant-pos-cashier .product-tile strong {
          font-size: 14px;
          line-height: 1.32;
        }

        .merchant-pos-cashier .product-tile-text {
          grid-template-columns: 64px minmax(0, 1fr) auto auto;
          grid-template-rows: 1fr;
          align-items: center;
          min-height: 42px;
          padding: 8px 12px;
        }

        .merchant-pos-cashier .product-code {
          color: var(--pos-muted);
          font-size: 12px;
        }

        .merchant-pos-cashier .product-price {
          color: var(--pos-primary-dark);
          font-size: 16px;
          font-weight: 900;
        }

        .merchant-pos-cashier .product-stock {
          grid-column: 1 / -1;
          color: var(--pos-muted);
          font-size: 12px;
          font-weight: 800;
          text-align: right;
        }

        .merchant-pos-cashier .product-tile-text .product-stock {
          grid-column: auto;
          min-width: 58px;
          white-space: nowrap;
        }

        .merchant-pos-cashier .product-tile-text .product-price {
          min-width: 42px;
          justify-self: end;
        }

        .merchant-pos-cashier .product-stock.danger {
          color: var(--pos-danger);
        }

        .merchant-pos-cashier .catalog-empty {
          grid-column: 1 / -1;
          display: grid;
          place-items: center;
          min-height: 220px;
          border: 1px dashed var(--pos-line);
          border-radius: 8px;
          color: var(--pos-muted);
          text-align: center;
        }

        @media (max-width: 1280px) {
          .merchant-pos-cashier .cashier-workbench {
            grid-template-columns: 1fr;
          }

          .merchant-pos-cashier .sale-panel,
          .merchant-pos-cashier .catalog-panel {
            min-height: auto;
          }

          .merchant-pos-cashier .record-filter-grid {
            grid-template-columns: 1fr;
          }

          .merchant-pos-cashier .records-row {
            grid-template-columns: 60px 140px 170px 100px 90px 150px 220px 86px;
            min-width: 980px;
          }
        }
      `}</style>

      <div className="cashier-header">
        <div>
          <div className="cashier-title">
            <h2>{view === "records" ? "兑换记录" : view === "rechargeRecords" ? "充值记录" : "积分兑换"}</h2>
            <span className="cashier-date">{formatDateYmd()}</span>
          </div>
          {loading ? <div className="cashier-loading">正在刷新...</div> : null}
        </div>
        <div className="cashier-actions">
          <button type="button" className="el-button el-button--default" onClick={() => void loadData(true)} disabled={loading}>
            {loading ? "刷新中..." : "刷新"}
          </button>
          <div ref={languageRootRef} className="language-menu-wrap" data-no-translate="1">
            <button
              type="button"
              className="el-button el-button--default language-action-button"
              onClick={() => setLanguageMenuOpen((current) => !current)}
              aria-label={t("lang.placeholder")}
              aria-expanded={languageMenuOpen}
              title={currentLanguage.label}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="language-flag-icon"
                src={flagImageUrl(currentLanguage.countryCode)}
                alt={currentLanguage.label}
                width={24}
                height={18}
              />
            </button>
            {languageMenuOpen ? (
              <div ref={languageMenuRef} className="language-dropdown-menu" role="menu">
                {LANGUAGE_OPTIONS.map((item) => (
                  <button
                    key={item.code}
                    type="button"
                    className={`language-dropdown-item${item.code === currentLanguage.code ? " is-active-language" : ""}`}
                    onClick={() => {
                      setLocale(item.code);
                      setLanguageMenuOpen(false);
                    }}
                    role="menuitem"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      className="language-flag-icon small"
                      src={flagImageUrl(item.countryCode)}
                      alt={item.label}
                      width={18}
                      height={14}
                      loading="lazy"
                    />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {view === "records" || view === "rechargeRecords" ? (
        <>
          <section className="panel records-panel">
            <div className="record-filter-grid">
              <div className="record-filter-field">
                <label>搜索</label>
                <div className="record-search">
                  <IconSearch />
                  <input
                    value={recordsKeyword}
                    onChange={(event) => {
                      setRecordsKeyword(event.target.value);
                      setRecordsPage(1);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") setRecordsPage(1);
                    }}
                    placeholder="会员 / 卡号 / 记录 / 编号"
                  />
                </div>
              </div>
              <div className="record-filter-field">
                <label>时间</label>
                <div className="record-time-row">
                  {recordsTimeOptions.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      className={`record-time-chip${recordsTimeFilter === item.value ? " active" : ""}`}
                      onClick={() => {
                        setRecordsTimeFilter(item.value);
                        setRecordsPage(1);
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="record-filter-actions">
                <button
                  type="button"
                  className="pos-button"
                  onClick={() => {
                    setRecordsKeyword("");
                    setRecordsTimeFilter("today");
                    setRecordsPage(1);
                  }}
                >
                  重置
                </button>
              </div>
            </div>

            <div className="records-table" aria-busy={loading}>
              <div className="records-row header">
                <span>序号</span>
                <span>编号</span>
                <span>会员</span>
                <span className="record-amount">余额</span>
                <span className="record-points">积分</span>
                <span>时间</span>
                <span>记录</span>
                <span>操作</span>
              </div>
              {pagedTransactionRecords.length ? (
                pagedTransactionRecords.map((record, index) => (
                  <div key={record.id} className="records-row">
                    <span>{(normalizedRecordsPage - 1) * recordsPageSize + index + 1}</span>
                    <strong>{record.id.split(":").pop()}</strong>
                    <span>
                      {record.memberName} / {record.memberNo}
                    </span>
                    <span className="record-amount">
                      {view === "rechargeRecords" ? `€${formatMoney(record.balanceAmount)}` : "-"}
                    </span>
                    <span className="record-points">{formatPoints(record.points)}</span>
                    <span>{record.at ? formatDateTime(new Date(record.at)) : "-"}</span>
                    <span>
                      <span className="record-status-tag">{transactionRecordTypeLabel}</span>
                      {" "}
                      {record.note}
                    </span>
                    <span className="record-row-actions">
                      <button type="button" className="pos-button" onClick={() => setSelectedRecordId(record.id)}>
                        查看
                      </button>
                    </span>
                  </div>
                ))
              ) : (
                <div className="record-empty-row">暂无{transactionRecordTypeLabel}记录。</div>
              )}
            </div>

            <div className="record-pagination">
              <span>
                共 {filteredTransactionRecords.length} 条，第 {normalizedRecordsPage} / {recordsTotalPages} 页
              </span>
              <button
                type="button"
                className="pos-button"
                disabled={normalizedRecordsPage <= 1}
                onClick={() => setRecordsPage((current) => Math.max(1, current - 1))}
              >
                上一页
              </button>
              <button
                type="button"
                className="pos-button"
                disabled={normalizedRecordsPage >= recordsTotalPages}
                onClick={() => setRecordsPage((current) => Math.min(recordsTotalPages, current + 1))}
              >
                下一页
              </button>
            </div>
          </section>

          {selectedRecord ? (
            <div className="modal-backdrop" role="presentation">
              <section className="pos-modal" role="dialog" aria-modal="true" aria-label={`${transactionRecordTypeLabel}详情`}>
                <div className="pos-modal-header">
                  <h3>{transactionRecordTypeLabel}详情</h3>
                  <button type="button" className="link-button" onClick={() => setSelectedRecordId("")}>
                    关闭
                  </button>
                </div>
                <div className="pos-modal-body">
                  <div className="record-detail-grid">
                    <span>编号</span>
                    <strong>{selectedRecord.id.split(":").pop()}</strong>
                    <span>时间</span>
                    <strong>{selectedRecord.at ? formatDateTime(new Date(selectedRecord.at)) : "-"}</strong>
                    <span>会员</span>
                    <strong>
                      {selectedRecord.memberName} / {selectedRecord.memberNo}
                    </strong>
                    <span>类型</span>
                    <strong>{transactionRecordTypeLabel}</strong>
                    <span>余额变动</span>
                    <strong>
                      {selectedRecord.rawBalanceDelta >= 0 ? "+" : "-"}€{formatMoney(selectedRecord.balanceAmount)}
                    </strong>
                    <span>积分变动</span>
                    <strong>
                      {selectedRecord.rawPointDelta >= 0 ? "+" : "-"}
                      {formatPoints(selectedRecord.points)}
                    </strong>
                    <span>记录</span>
                    <strong>{selectedRecord.note}</strong>
                  </div>
                </div>
                <div className="pos-modal-footer">
                  <button type="button" className="pos-button primary" onClick={() => setSelectedRecordId("")}>
                    确定
                  </button>
                </div>
              </section>
            </div>
          ) : null}
        </>
      ) : (
      <section className="cashier-workbench">
        <section className="panel sale-panel">
          <div className="panel-heading compact">
            <div className="member-line">
              <span className="member-avatar">{getAvatarInitial(selectedMember)}</span>
              {selectedMember ? (
                <>
                  <button
                    type="button"
                    className="member-name-button"
                    onClick={openSelectedMemberCouponWallet}
                    title="查看会员卡券"
                  >
                    {getMemberDisplayName(selectedMember)}
                  </button>
                  <span>卡号: {selectedMember.memberNo}</span>
                  <span>积分: {formatPoints(selectedInsight.pointBalance)}</span>
                  <span>余额: €{formatMoney(selectedInsight.balanceAmount)}</span>
                </>
              ) : (
                <span>散客</span>
              )}
            </div>
            <div className="member-actions">
              {selectedMember ? (
                <button type="button" className="member-clear-button" onClick={clearMember} aria-label="清除会员" title="清除会员">
                  <IconX />
                </button>
              ) : null}
              <div className="member-search">
                <input
                  value={memberKeyword}
                  onChange={(event) => {
                    const nextKeyword = event.target.value;
                    setMemberKeyword(nextKeyword);
                    setMemberPickerOpen(nextKeyword.trim().length > 0);
                    setError("");
                  }}
                  onFocus={() => setMemberPickerOpen(memberKeyword.trim().length > 0)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") lookupMember();
                  }}
                  placeholder="会员姓名 / 手机 / 卡号 / 邮箱"
                />
                {memberPickerOpen && filteredMembers.length ? (
                  <div className="member-suggestions">
                    {filteredMembers.map((membership) => (
                      <button
                        key={membership.id}
                        type="button"
                        className="member-suggestion"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectMember(membership)}
                      >
                        <strong>{getMemberDisplayName(membership)}</strong>
                        <span>{membership.phone || "-"}</span>
                        <span>{membership.memberNo}</span>
                      </button>
                    ))}
                  </div>
                ) : memberPickerOpen && memberSearchLoading ? (
                  <div className="member-suggestions">
                    <div className="member-suggestion-note">正在搜索会员...</div>
                  </div>
                ) : memberPickerOpen &&
                  deferredMemberKeyword.trim() &&
                  memberSearchFailedKeyword === deferredMemberKeyword.trim().toLowerCase() ? (
                  <div className="member-suggestions">
                    <div className="member-suggestion-note">搜索较慢，请继续输入更多姓名 / 手机 / 卡号。</div>
                  </div>
                ) : memberPickerOpen &&
                  deferredMemberKeyword.trim() &&
                  memberSearchSkippedKeyword === deferredMemberKeyword.trim().toLowerCase() ? (
                  <div className="member-suggestions">
                    <div className="member-suggestion-note">继续输入至少 2 位，可搜索全部会员。</div>
                  </div>
                ) : memberPickerOpen &&
                  deferredMemberKeyword.trim() &&
                  remoteMemberSearchKeyword === deferredMemberKeyword.trim().toLowerCase() ? (
                  <div className="member-suggestions">
                    <div className="member-suggestion-note">没有找到匹配的会员。</div>
                  </div>
                ) : null}
              </div>
              <div className="member-action-buttons">
                <button type="button" className="el-button el-button--primary" onClick={openRechargeDialog}>
                  <IconDoorOpen />
                  充值
                </button>
                <button type="button" className="el-button el-button--default" onClick={() => setQuickRedeemDialogOpen(true)}>
                  <IconWallet />
                  快捷兑换
                </button>
              </div>
            </div>
          </div>

          <div className="cart-area">
            <div className="cart-table">
              <div className="cart-header">
                <span>编号</span>
                <span>产品/项目</span>
                <span>积分</span>
                <span>数量</span>
                <span>小计</span>
              </div>
              <div className="cart-body">
                {cartRows.length ? (
                  cartRows.map((row, index) => (
                    <div key={`${row.itemId}-${index}`} className="cart-row-shell">
                      <div className="cart-row">
                        <span className="cart-code">{row.code || row.itemId}</span>
                        <strong className="cart-name">
                          {row.name}
                          <span className="cart-meta">
                            {row.couponSettlementCode
                              ? row.couponDiscountLabel || "卡券兑换"
                              : row.custom
                                ? "快捷兑换"
                                : row.item && shouldShowStock(settings)
                                  ? `${categoryName(enabledCategories, row.categoryId)} / ${stockLabel(row.item)}`
                                  : categoryName(enabledCategories, row.categoryId)}
                          </span>
                        </strong>
                        <span>{row.couponPointDiscount > 0 ? `-${formatPoints(row.couponPointDiscount)}` : formatPoints(row.unitPoints)}</span>
                        <div className="quantity-control">
                          {row.couponSettlementCode ? (
                            <span className="coupon-locked-quantity">{row.quantity}</span>
                          ) : (
                            <>
                              <button type="button" className="qty-button" onClick={() => changeQuantity(index, row.quantity - 1)}>
                                -
                              </button>
                              <input
                                type="number"
                                min={1}
                                value={row.quantity}
                                onChange={(event) => changeQuantity(index, Number(event.target.value))}
                                className="cart-qty-input"
                              />
                              <button type="button" className="qty-button plus" onClick={() => changeQuantity(index, row.quantity + 1)}>
                                +
                              </button>
                            </>
                          )}
                        </div>
                        <span>
                          {row.couponPointDiscount > 0
                            ? `-${formatPoints(Math.min(grossPoints, row.couponPointDiscount))}`
                            : formatPoints(row.subtotalPoints)}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="cart-empty">
                    <div className="cart-empty-box" />
                    <span>请从右侧选择项目</span>
                  </div>
                )}
              </div>
            </div>

            <div className="checkout-note">
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="兑换备注，例如：前台积分兑换"
              />
            </div>

            <div className="sale-summary">
              <div className="summary-actions-left">
                <button type="button" className="el-button el-button--default" onClick={holdCurrentSale}>
                  挂单
                </button>
                <button type="button" className="el-button el-button--default" onClick={handleRetrieveHeldSale}>
                  提单
                  {heldSales.length ? <span className="held-count">{heldSales.length}</span> : null}
                </button>
                {heldOpen ? (
                  <div className="held-sales-panel">
                    <div className="held-sales-title">挂单列表</div>
                    {heldSales.length ? (
                      heldSales.map((sale) => (
                        <button key={sale.id} type="button" className="held-sale-item" onClick={() => restoreHeldSale(sale)}>
                          <strong>{sale.title}</strong>
                          <span>{sale.createdAt}</span>
                        </button>
                      ))
                    ) : (
                      <span>暂无挂单。</span>
                    )}
                  </div>
                ) : null}
              </div>
              <div className="summary-item">
                <span>项目</span>
                <strong>{totalQuantity}</strong>
              </div>
              <div className="summary-item">
                <span>会员积分</span>
                <strong>{formatPoints(selectedInsight.pointBalance)}</strong>
              </div>
              <div className="summary-total">
                <span>{couponPointDiscountTotal > 0 ? "扣减积分" : "合计积分"}</span>
                <strong>{formatPoints(totalPoints)}</strong>
              </div>
              {couponPointDiscountTotal > 0 ? (
                <div className="summary-item">
                  <span>积分券抵扣</span>
                  <strong>-{formatPoints(couponPointDiscountTotal)}</strong>
                </div>
              ) : null}
              <button type="button" className="checkout-button" disabled={!canCheckout} onClick={() => void submitCheckoutRef.current()}>
                {saving ? "结算中" : "结算"}
              </button>
            </div>
          </div>
        </section>

        <section className="panel catalog-panel">
          <div className="catalog-toolbar">
            <div className="product-search-wrap">
              <span className="product-search-prefix">
                <IconSearch />
              </span>
              <input
                value={itemKeyword}
                onChange={(event) => setItemKeyword(event.target.value)}
                className="product-search-input"
                placeholder="商品条码 / 名称 / 优惠券"
              />
            </div>
            <div className="product-view-toggle">
              <button
                type="button"
                className={`view-mode-button ${viewMode === "image" ? "active" : ""}`}
                onClick={() => {
                  if (viewMode === "image") {
                    setImageSizeMenuOpen((current) => !current);
                    return;
                  }
                  setViewMode("image");
                  setImageSizeMenuOpen(false);
                }}
                title="图片模式"
              >
                <IconImage />
              </button>
              <button
                type="button"
                className={`view-mode-button ${viewMode === "text" ? "active" : ""}`}
                onClick={() => {
                  setViewMode("text");
                  setImageSizeMenuOpen(false);
                }}
                title="列表模式"
              >
                <IconList />
              </button>
              {imageSizeMenuOpen && viewMode === "image" ? (
                <div className="catalog-popover image-size-popover">
                  <div className="product-size-menu">
                    {productImageSizeOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`catalog-panel-button ${productImageSize === option.value ? "active" : ""}`}
                        onClick={() => {
                          setProductImageSize(option.value);
                          setImageSizeMenuOpen(false);
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {couponSearchResults.length ? (
            <div className="coupon-results">
              {couponSearchResults.map((coupon) => (
                <div key={coupon.key} className="coupon-result">
                  <strong>{coupon.title}</strong>
                  <span>{coupon.status}</span>
                  <small>
                    {coupon.subtitle} / {coupon.code}
                  </small>
                </div>
              ))}
            </div>
          ) : null}

          <div className="category-filter-shell">
            <div className="category-row">
              <button
                type="button"
                className={`category-chip is-all-category ${!categoryId ? "active" : ""}`}
                onClick={() => selectCategory("")}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  setCategoryMenuOpen((current) => !current);
                }}
              >
                <span className="category-button-icon">
                  <IconGrid />
                </span>
                <span className="category-button-label">全部</span>
              </button>
              {enabledCategories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className={`category-chip ${categoryId === category.id ? "active" : ""}`}
                  onClick={() => selectCategory(category.id)}
                >
                  {normalizeCategoryIconName(category.iconName) ? (
                    <span className="category-button-icon">
                      <CategoryIconGlyph name={category.iconName} className="h-[17px] w-[17px]" emptyLabel="" />
                    </span>
                  ) : null}
                  <span className="category-button-label">{category.name}</span>
                </button>
              ))}
            </div>
            {categoryMenuOpen ? (
              <aside className="category-floating-panel" onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
                <div className="category-sort-panel">
                  <div className="category-sort-row">
                    {([
                      ["hot", "热卖"],
                      ["category", "分类"],
                      ["recommend", "推荐"],
                    ] as Array<[CatalogFilterTab, string]>).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        className={catalogFilterTab === value ? "active" : ""}
                        onClick={() => setCatalogFilterTab(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="category-sort-row compact">
                    <span>默认</span>
                    <button
                      type="button"
                      className={catalogSortMode === "code" ? "active" : ""}
                      onClick={() => setCatalogSortMode("code")}
                    >
                      编号
                    </button>
                    <button
                      type="button"
                      className={catalogSortMode === "name" ? "active" : ""}
                      onClick={() => setCatalogSortMode("name")}
                    >
                      字母
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  className={`category-side-item ${!categoryId ? "active" : ""}`}
                  onClick={() => selectCategory("")}
                >
                  <label className="category-side-checkbox" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isCategoryIncludedInAll("")}
                      onChange={(event) => setCategoryIncludedInAll("", event.currentTarget.checked)}
                    />
                    <span />
                  </label>
                  <span className="category-button-icon">
                    <IconGrid />
                  </span>
                  <span className="category-button-label">全部</span>
                </button>
                {enabledCategories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    className={`category-side-item ${categoryId === category.id ? "active" : ""}`}
                    onClick={() => selectCategory(category.id)}
                  >
                    <label className="category-side-checkbox" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isCategoryIncludedInAll(category.id)}
                        onChange={(event) => setCategoryIncludedInAll(category.id, event.currentTarget.checked)}
                      />
                      <span />
                    </label>
                    {normalizeCategoryIconName(category.iconName) ? (
                      <span className="category-button-icon">
                        <CategoryIconGlyph name={category.iconName} className="h-[17px] w-[17px]" emptyLabel="" />
                      </span>
                    ) : null}
                    <span className="category-button-label">{category.name}</span>
                  </button>
                ))}
              </aside>
            ) : null}
          </div>

          <div className={`catalog-products ${viewMode === "image" ? `goods-grid goods-grid-${productImageSize}` : "goods-list"}`}>
            {filteredItems.length ? (
              <>
              {renderedItems.map((item) => {
                const unitPoints = getRedemptionPointCostForMember(item, selectedMember, settings);
                const inCartQuantity = cartQuantityByItemId.get(item.id) ?? 0;
                const outOfStock = item.stock !== null && inCartQuantity >= item.stock;
                const itemImageUrl = normalizePublicAssetUrl(item.imageUrl || "");
                const pointsUnavailable = item.pointsCost === null;
                const itemDisabled = outOfStock || pointsUnavailable;
                const showStock = shouldShowStock(settings);

                if (viewMode === "text") {
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`product-tile product-tile-text ${itemDisabled ? "is-out-of-stock" : ""}`}
                      disabled={itemDisabled}
                      onClick={() => addToCart(item)}
                    >
                      <span className="product-code">{item.code || item.id}</span>
                      <strong>{item.name}</strong>
                      <span className="product-price">{pointsUnavailable ? "-" : formatPoints(unitPoints)}</span>
                      {showStock ? <span className={`product-stock ${outOfStock ? "danger" : ""}`}>{stockLabel(item)}</span> : null}
                    </button>
                  );
                }

                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`product-tile ${itemDisabled ? "is-out-of-stock" : ""}`}
                    disabled={itemDisabled}
                    onClick={() => addToCart(item)}
                  >
                    <div className="product-visual">
                      {itemImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={itemImageUrl}
                          alt={item.name || item.code || "兑换项目"}
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <span>{productInitial(item)}</span>
                      )}
                    </div>
                    <div className="product-footer">
                      <strong>{item.name}</strong>
                      <span className="product-price">{pointsUnavailable ? "-" : formatPoints(unitPoints)}</span>
                      {showStock ? (
                        <span className={`product-stock ${outOfStock ? "danger" : ""}`}>
                          {stockLabel(item)}
                          {inCartQuantity ? ` / 已选 ${inCartQuantity}` : ""}
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
              {filteredItems.length > renderedItems.length ? (
                <div className="catalog-empty">
                  <div>当前筛选结果 {filteredItems.length} 个，已显示 {renderedItems.length} 个。</div>
                  <button
                    type="button"
                    className="mt-3 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    onClick={() => setItemRenderLimit((current) => current + MERCHANT_REDEMPTION_ITEM_RENDER_LIMIT)}
                  >
                    显示更多
                  </button>
                </div>
              ) : null}
              </>
            ) : (
              <div className="catalog-empty">暂无匹配项目。请在会员管理的兑换项目中添加并启用。</div>
            )}
          </div>
        </section>
        {couponWalletOpen && selectedMember ? (
          <div className="modal-backdrop" role="presentation" onMouseDown={() => setCouponWalletOpen(false)}>
            <div
              className="pos-modal member-coupon-modal"
              role="dialog"
              aria-modal="true"
              aria-label="会员卡券"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="pos-modal-header">
                <div>
                  <h3>会员卡券</h3>
                  <div className="member-coupon-modal-member">
                    {getMemberDisplayName(selectedMember)} / {selectedMember.memberNo}
                  </div>
                </div>
                <button type="button" className="link-button" onClick={() => setCouponWalletOpen(false)}>
                  关闭
                </button>
              </div>
              <div className="pos-modal-body">
                <div className="member-coupon-modal-summary">
                  <span>可直接使用 {directlyUsableCouponClaims.length} 张</span>
                  <span>不可直接使用 {unavailableCouponClaims.length} 张</span>
                </div>
                {selectedMemberInsightLoading && !selectedMember.insight ? (
                  <div className="member-coupon-loading">正在加载会员卡券...</div>
                ) : (
                  <div className="member-coupon-sections">
                    <section className="member-coupon-section">
                      <div className="member-coupon-section-header">
                        <strong>可直接使用</strong>
                        <span>{directlyUsableCouponClaims.length} 张</span>
                      </div>
                      {directlyUsableCouponClaims.length ? (
                        <div className="member-coupon-grid">
                          {directlyUsableCouponClaims.map((coupon) => {
                            const inCart = couponClaimIdsInCart.has(coupon.id);
                            const itemName = getCouponCartItemName(coupon);
                            const quantity = getCouponCartQuantity(coupon);
                            const ruleText = getCouponPointsVoucherRuleText(coupon);
                            return (
                              <div key={coupon.id} className={`member-coupon-card${inCart ? " is-in-cart" : ""}`}>
                                <strong>{coupon.title}</strong>
                                <span>{coupon.discountLabel}</span>
                                <small>
                                  {itemName} x {quantity} / {coupon.settlementCode || coupon.couponCode}
                                </small>
                                {ruleText ? <small>{ruleText}</small> : null}
                                <button
                                  type="button"
                                  disabled={inCart || saving}
                                  onClick={() => addCouponClaimToCart(coupon)}
                                >
                                  {inCart ? "已加入" : "使用"}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="member-coupon-empty">暂无可直接使用的卡券。</div>
                      )}
                    </section>
                    <section className="member-coupon-section">
                      <div className="member-coupon-section-header">
                        <strong>不可直接使用</strong>
                        <span>{unavailableCouponClaims.length} 张</span>
                      </div>
                      {unavailableCouponClaims.length ? (
                        <div className="member-coupon-grid">
                          {unavailableCouponClaims.map((coupon) => {
                            const reason = getCouponDirectUseUnavailableReason(coupon) || "不可用";
                            const itemName = getCouponCartItemName(coupon);
                            const quantity = getCouponCartQuantity(coupon);
                            const ruleText = getCouponPointsVoucherRuleText(coupon);
                            return (
                              <div key={coupon.id} className="member-coupon-card is-disabled">
                                <strong>{coupon.title}</strong>
                                <span>{coupon.discountLabel}</span>
                                <small>
                                  {itemName} x {quantity} / {coupon.settlementCode || coupon.couponCode}
                                </small>
                                {ruleText ? <small>{ruleText}</small> : null}
                                <span className="member-coupon-status-tag">{reason}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="member-coupon-empty">暂无不可用卡券。</div>
                      )}
                    </section>
                  </div>
                )}
              </div>
              <div className="pos-modal-footer">
                <button type="button" className="el-button el-button--primary" onClick={() => setCouponWalletOpen(false)}>
                  确定
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {rechargeDialogOpen ? (
          <div className="modal-backdrop" role="presentation" onMouseDown={() => !saving && setRechargeDialogOpen(false)}>
            <div className="pos-modal" role="dialog" aria-modal="true" aria-label="充值方案" onMouseDown={(event) => event.stopPropagation()}>
              <div className="pos-modal-header">
                <h3>充值方案</h3>
                <button type="button" className="link-button" onClick={() => setRechargeDialogOpen(false)} disabled={saving}>
                  关闭
                </button>
              </div>
              <div className="pos-modal-body">
                {enabledRechargePlans.length ? (
                  enabledRechargePlans.map((plan) => (
                    <label
                      key={plan.id}
                      className={`recharge-plan-option ${selectedRechargePlanId === plan.id ? "is-active" : ""}`}
                    >
                      <input
                        type="radio"
                        name="rechargePlan"
                        checked={selectedRechargePlanId === plan.id}
                        onChange={() => setSelectedRechargePlanId(plan.id)}
                      />
                      <span>
                        <strong>{plan.title}</strong>
                        <span className="recharge-plan-meta">
                          <span>充值 €{formatMoney(plan.rechargeAmount)}</span>
                          <span>赠送 €{formatMoney(plan.giftAmount)}</span>
                          <span>赠送积分 {formatPoints(plan.giftPoints)}</span>
                        </span>
                      </span>
                    </label>
                  ))
                ) : (
                  <div className="catalog-empty">暂无启用充值方案，请先在会员管理中配置。</div>
                )}
              </div>
              <div className="pos-modal-footer">
                <button type="button" className="el-button el-button--default" onClick={() => setRechargeDialogOpen(false)} disabled={saving}>
                  取消
                </button>
                <button type="button" className="el-button el-button--primary" onClick={submitRechargePlan} disabled={saving || !enabledRechargePlans.length}>
                  {saving ? "充值中" : "确认充值"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {quickRedeemDialogOpen ? (
          <div className="modal-backdrop" role="presentation" onMouseDown={() => setQuickRedeemDialogOpen(false)}>
            <div className="pos-modal" role="dialog" aria-modal="true" aria-label="快捷兑换" onMouseDown={(event) => event.stopPropagation()}>
              <div className="pos-modal-header">
                <h3>快捷兑换</h3>
                <button type="button" className="link-button" onClick={() => setQuickRedeemDialogOpen(false)}>
                  关闭
                </button>
              </div>
              <div className="pos-modal-body">
                <label className="quick-field">
                  项目名称
                  <input
                    value={quickRedeemName}
                    onChange={(event) => setQuickRedeemName(event.target.value)}
                    className="quick-input"
                    placeholder="临时项目"
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        submitQuickRedeemItem();
                      }
                    }}
                  />
                </label>
                <label className="quick-field">
                  积分
                  <input
                    ref={quickRedeemPointsInputRef}
                    type="number"
                    min={1}
                    value={quickRedeemPoints}
                    onChange={(event) => setQuickRedeemPoints(event.target.value)}
                    className="quick-input"
                    placeholder="填写本次兑换所需积分"
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        submitQuickRedeemItem();
                      }
                    }}
                  />
                </label>
              </div>
              <div className="pos-modal-footer">
                <button type="button" className="el-button el-button--default" onClick={() => setQuickRedeemDialogOpen(false)}>
                  取消
                </button>
                <button type="button" className="el-button el-button--primary" onClick={submitQuickRedeemItem}>
                  加入兑换
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {checkoutConfirmOpen ? (
          <div className="modal-backdrop" role="presentation" onMouseDown={() => !saving && setCheckoutConfirmOpen(false)}>
            <div className="pos-modal" role="dialog" aria-modal="true" aria-label="确认结算" onMouseDown={(event) => event.stopPropagation()}>
              <div className="pos-modal-header">
                <h3>确认结算</h3>
                <button type="button" className="link-button" onClick={() => setCheckoutConfirmOpen(false)} disabled={saving}>
                  关闭
                </button>
              </div>
              <div className="pos-modal-body">
                <div>会员：{selectedMember ? `${getMemberDisplayName(selectedMember)} / ${selectedMember.memberNo}` : "-"}</div>
                <div>项目：{totalQuantity}</div>
                {couponPointDiscountTotal > 0 ? <div>积分券抵扣：-{formatPoints(couponPointDiscountTotal)}</div> : null}
                <div>扣减积分：{formatPoints(totalPoints)}</div>
              </div>
              <div className="pos-modal-footer">
                <button type="button" className="el-button el-button--default" onClick={() => setCheckoutConfirmOpen(false)} disabled={saving}>
                  取消
                </button>
                <button type="button" className="el-button el-button--primary" onClick={submitCheckout} disabled={saving}>
                  {saving ? "结算中" : "确认结算"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </section>
      )}
    </section>
  );
}
