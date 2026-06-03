"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import {
  getMerchantCouponDiscountLabel,
  getMerchantCouponDisplayTitle,
  type MerchantCouponRecord,
} from "@/lib/merchantCoupons";
import { LANGUAGE_OPTIONS, resolveSupportedLocale } from "@/lib/i18n";
import type { MerchantMembershipInsight, MerchantMembershipListItem } from "@/lib/merchantMemberships";
import type {
  MerchantMemberRedemptionCategory,
  MerchantMemberRedemptionItem,
  MerchantMembershipSettings,
} from "@/lib/merchantMembershipSettings";
import { parseMerchantMemberPointDiscountRate } from "@/lib/merchantMembershipSettings";

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

type MembershipSettingsPayload = {
  ok?: unknown;
  settings?: MerchantMembershipSettings;
  message?: unknown;
};

type CouponsPayload = {
  ok?: unknown;
  coupons?: MerchantCouponRecord[];
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
  quantity: number;
};

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

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function readPayloadMessage(value: unknown, fallback: string) {
  return trimText(value, 1000) || fallback;
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

function getMemberDisplayName(membership: MerchantMembershipListItem) {
  if (!membership.profileVisible) return "已退会会员";
  return membership.nickname || membership.name || membership.email || membership.accountId || membership.memberNo;
}

function getAvatarInitial(membership: MerchantMembershipListItem | null) {
  if (!membership) return "客";
  return getMemberDisplayName(membership).slice(0, 1).toUpperCase() || "会";
}

function buildMemberSearchText(membership: MerchantMembershipListItem) {
  return [
    membership.memberNo,
    membership.nickname,
    membership.name,
    membership.accountId,
    membership.phone,
    membership.email,
    membership.country,
    membership.province,
    membership.city,
  ]
    .join(" ")
    .toLowerCase();
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
  const levels = (settings?.levels ?? [])
    .filter((level) => level.enabled && trimText(level.name, 120))
    .sort((left, right) => left.requiredGrowthValue - right.requiredGrowthValue || left.sort - right.sort);
  const level =
    levels.find((entry) => entry.id === membership?.levelId) ??
    levels.reduce<(typeof levels)[number] | null>((matched, entry) => {
      return (membership?.growthValue ?? 0) >= entry.requiredGrowthValue ? entry : matched;
    }, null);
  const rate = parseMerchantMemberPointDiscountRate(level?.benefit.pointDiscount);
  return Math.max(0, Math.ceil(item.pointsCost * rate));
}

function productInitial(item: MerchantMemberRedemptionItem) {
  return trimText(item.name, 2) || trimText(item.code, 2) || "项";
}

function stockLabel(item: MerchantMemberRedemptionItem) {
  return item.stock > 0 ? `库存 ${item.stock}` : "不限库存";
}

function operationErrorMessage(message: unknown, fallback: string) {
  const text = trimText(message, 1000);
  if (text === "membership_balance_insufficient") return "会员积分不足，不能兑换。";
  if (text === "membership_redemption_stock_insufficient") return "兑换项目库存不足。";
  if (text === "membership_operation_empty") return "请选择兑换项目。";
  if (text === "membership_not_active") return "该会员不是正常状态，不能兑换。";
  if (text === "membership_redemption_item_not_found") return "兑换项目不存在或已停用。";
  if (text === "membership_settings_unavailable") return "会员兑换配置不可用。";
  return text || fallback;
}

function couponStatusLabel(status: MerchantMembershipInsight["couponHistory"][number]["status"]) {
  if (status === "available") return "可用";
  if (status === "used") return "已核销";
  if (status === "expired") return "已过期";
  return "不可用";
}

function storageKey(siteId: string) {
  return `faolla.memberPointRedemption.heldSales.${siteId}`;
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

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 12 4.2 4.2L19 6.8" />
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

function IconCup() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 4h10l-1.2 16H8.2L7 4Z" />
      <path d="M6 8h12" />
      <path d="M10 4V2h4v2" />
    </svg>
  );
}

function IconThumbsUp() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 11v9H4v-9h3Z" />
      <path d="M7 11 11 4c.8-1.4 3-.8 3 1v4h4.2c1.2 0 2.1 1 1.9 2.2l-1.1 6A3 3 0 0 1 16 20H7" />
    </svg>
  );
}

function IconBean() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.5 15.5c-2.8-2.8-3.4-6.8-1.3-8.9s6.1-1.5 8.9 1.3 3.4 6.8 1.3 8.9-6.1 1.5-8.9-1.3Z" />
      <path d="M9 7c.6 3.3 3.8 3 5 6" />
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

function CategoryIcon({ name }: { name: string }) {
  if (!name) return <IconGrid />;
  if (name.includes("饮")) return <IconCup />;
  if (name.includes("推荐") || name.includes("热")) return <IconThumbsUp />;
  if (name.includes("零") || name.includes("食")) return <IconBean />;
  return <IconGrid />;
}

export default function MerchantPointRedemptionCashier({
  siteId,
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
  const [categoryId, setCategoryId] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [note, setNote] = useState("");
  const [viewMode, setViewMode] = useState<ProductViewMode>("image");
  const [productImageSize, setProductImageSize] = useState<ProductImageSize>("medium");
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [imageSizeMenuOpen, setImageSizeMenuOpen] = useState(false);
  const [catalogFilterTab, setCatalogFilterTab] = useState<CatalogFilterTab>("hot");
  const [catalogSortMode, setCatalogSortMode] = useState<CatalogSortMode>("code");
  const [heldSales, setHeldSales] = useState<HeldSale[]>([]);
  const [heldOpen, setHeldOpen] = useState(false);
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [rechargeDialogOpen, setRechargeDialogOpen] = useState(false);
  const [selectedRechargePlanId, setSelectedRechargePlanId] = useState("");
  const [quickRedeemDialogOpen, setQuickRedeemDialogOpen] = useState(false);
  const [quickRedeemName, setQuickRedeemName] = useState("临时项目");
  const [quickRedeemPoints, setQuickRedeemPoints] = useState("");
  const quickRedeemPointsInputRef = useRef<HTMLInputElement | null>(null);
  const [checkoutConfirmOpen, setCheckoutConfirmOpen] = useState(false);
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

  const filteredMembers = useMemo(() => {
    const keyword = memberKeyword.trim().toLowerCase();
    if (!keyword) return activeMembers.slice(0, 12);
    return activeMembers.filter((membership) => buildMemberSearchText(membership).includes(keyword)).slice(0, 20);
  }, [activeMembers, memberKeyword]);

  const selectedMember = useMemo(
    () => activeMembers.find((membership) => membership.id === selectedMemberId) ?? null,
    [activeMembers, selectedMemberId],
  );

  const selectedInsight = selectedMember?.insight ?? EMPTY_MEMBER_INSIGHT;

  const couponSearchResults = useMemo(() => {
    const keyword = itemKeyword.trim().toLowerCase();
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
  }, [coupons, itemKeyword, selectedInsight.availableCoupons, selectedInsight.couponHistory, selectedMember]);

  const filteredItems = useMemo(() => {
    const keyword = itemKeyword.trim().toLowerCase();
    const recommendedCategoryIds = new Set(
      enabledCategories
        .filter((category) => {
          const name = category.name.toLowerCase();
          return name.includes("推荐") || name.includes("热卖") || name.includes("recommended") || name.includes("hot");
        })
        .map((category) => category.id),
    );
    return enabledItems
      .filter((item) => {
      if (categoryId && item.categoryId !== categoryId) return false;
      if (catalogFilterTab === "recommend") {
        const text = [item.name, item.code, item.description].join(" ").toLowerCase();
        if (!recommendedCategoryIds.has(item.categoryId) && !text.includes("推荐") && !text.includes("热卖") && !text.includes("recommended")) {
          return false;
        }
      }
      if (!keyword) return true;
      return [item.code, item.name, item.description, categoryName(enabledCategories, item.categoryId)]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    })
      .sort((left, right) => {
        if (catalogSortMode === "name") return left.name.localeCompare(right.name) || left.sort - right.sort;
        return (left.code || left.id).localeCompare(right.code || right.id) || left.sort - right.sort;
      });
  }, [catalogFilterTab, catalogSortMode, categoryId, enabledCategories, enabledItems, itemKeyword]);

  const cartRows = useMemo(() => {
    return cart
      .map((line) => {
        const item = enabledItems.find((entry) => entry.id === line.itemId);
        const unitPoints = item
          ? getRedemptionPointCostForMember(item, selectedMember, settings)
          : parsePositiveInteger(line.customPoints);
        if (!item && (!line.customName || unitPoints <= 0)) return null;
        return {
          item,
          itemId: line.itemId,
          code: item?.code || line.customCode || line.itemId,
          name: item?.name || line.customName || "快捷兑换",
          categoryId: item?.categoryId || "",
          stock: item?.stock ?? 0,
          custom: !item,
          quantity: line.quantity,
          unitPoints,
          subtotalPoints: unitPoints * line.quantity,
        };
      })
      .filter(
        (row): row is {
          item: MerchantMemberRedemptionItem | undefined;
          itemId: string;
          code: string;
          name: string;
          categoryId: string;
          stock: number;
          custom: boolean;
          quantity: number;
          unitPoints: number;
          subtotalPoints: number;
        } => Boolean(row),
      );
  }, [cart, enabledItems, selectedMember, settings]);

  const cartQuantityByItemId = useMemo(() => {
    const quantities = new Map<string, number>();
    cart.forEach((line) => quantities.set(line.itemId, (quantities.get(line.itemId) ?? 0) + line.quantity));
    return quantities;
  }, [cart]);

  const totalPoints = cartRows.reduce((sum, row) => sum + row.subtotalPoints, 0);
  const totalQuantity = cartRows.reduce((sum, row) => sum + row.quantity, 0);
  const canCheckout =
    Boolean(selectedMember) &&
    cartRows.length > 0 &&
    totalPoints > 0 &&
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
    const keyword = recordsKeyword.trim().toLowerCase();
    return transactionRecords.filter((record) => {
      if (!isInRecordsTimeFilter(record.at, recordsTimeFilter)) return false;
      if (!keyword) return true;
      return [record.id, record.memberName, record.memberNo, record.note, record.points, record.balanceAmount]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    });
  }, [recordsKeyword, recordsTimeFilter, transactionRecords]);

  const recordsPageSize = 30;
  const recordsTotalPages = Math.max(1, Math.ceil(filteredTransactionRecords.length / recordsPageSize));
  const normalizedRecordsPage = Math.min(recordsPage, recordsTotalPages);
  const pagedTransactionRecords = filteredTransactionRecords.slice(
    (normalizedRecordsPage - 1) * recordsPageSize,
    normalizedRecordsPage * recordsPageSize,
  );
  const selectedRecord = transactionRecords.find((record) => record.id === selectedRecordId) ?? null;

  const loadData = useCallback(async () => {
    if (!/^\d{8}$/.test(normalizedSiteId)) {
      setError("当前商户资料还没准备好，请稍后重试。");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [membersResponse, settingsResponse, couponsResponse] = await Promise.all([
        fetch(`/api/memberships?siteId=${encodeURIComponent(normalizedSiteId)}`, {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          headers: { accept: "application/json" },
        }),
        fetch(`/api/membership-settings?siteId=${encodeURIComponent(normalizedSiteId)}`, {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          headers: { accept: "application/json" },
        }),
        fetch(`/api/coupons?siteId=${encodeURIComponent(normalizedSiteId)}`, {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          headers: { accept: "application/json" },
        }).catch(() => null),
      ]);
      const membersPayload = (await membersResponse.json().catch(() => null)) as MembershipsPayload | null;
      const settingsPayload = (await settingsResponse.json().catch(() => null)) as MembershipSettingsPayload | null;
      const couponsPayload = couponsResponse
        ? ((await couponsResponse.json().catch(() => null)) as CouponsPayload | null)
        : null;
      if (!membersResponse.ok || !membersPayload?.ok) {
        throw new Error(readPayloadMessage(membersPayload?.message, "会员列表加载失败"));
      }
      if (!settingsResponse.ok || !settingsPayload?.ok || !settingsPayload.settings) {
        throw new Error(readPayloadMessage(settingsPayload?.message, "兑换项目加载失败，请先检查会员配置"));
      }
      setMemberships(Array.isArray(membersPayload.memberships) ? membersPayload.memberships : []);
      setSettings(settingsPayload.settings);
      setCoupons(couponsResponse?.ok && Array.isArray(couponsPayload?.coupons) ? couponsPayload.coupons : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "积分兑换数据加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [normalizedSiteId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

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
    if (!selectedMemberId) return;
    if (!activeMembers.some((membership) => membership.id === selectedMemberId)) {
      setSelectedMemberId("");
    }
  }, [activeMembers, selectedMemberId]);

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
    if (!error && !notice) return;
    const timer = window.setTimeout(() => {
      setError("");
      setNotice("");
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [error, notice]);

  function selectMember(membership: MerchantMembershipListItem) {
    setSelectedMemberId(membership.id);
    setMemberKeyword(
      [getMemberDisplayName(membership), membership.phone, membership.memberNo].filter(Boolean).join(" / "),
    );
    setMemberPickerOpen(false);
    setNotice("");
    setError("");
  }

  function lookupMember() {
    const exact =
      filteredMembers.find((membership) => {
        const keyword = memberKeyword.trim().toLowerCase();
        return (
          keyword &&
          [membership.memberNo, membership.phone, membership.email, membership.accountId]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase() === keyword)
        );
      }) ?? filteredMembers[0];
    if (exact) {
      selectMember(exact);
      return;
    }
    setMemberPickerOpen(true);
    setError("没有找到匹配的会员。");
  }

  function clearMember() {
    setSelectedMemberId("");
    setMemberKeyword("");
    setMemberPickerOpen(false);
  }

  function addToCart(item: MerchantMemberRedemptionItem) {
    setError("");
    setNotice("");
    setCart((current) => {
      const existingQuantity = current
        .filter((line) => line.itemId === item.id)
        .reduce((sum, line) => sum + line.quantity, 0);
      if (item.stock > 0 && existingQuantity + 1 > item.stock) {
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

  function changeQuantity(index: number, nextQuantity: number) {
    setCart((current) => {
      const line = current[index];
      if (!line) return current;
      const item = enabledItems.find((entry) => entry.id === line.itemId);
      const quantity = Math.max(0, Math.floor(nextQuantity));
      if (quantity <= 0) return current.filter((_, lineIndex) => lineIndex !== index);
      if (item?.stock && item.stock > 0 && quantity > item.stock) {
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
      const response = await fetch("/api/memberships", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          siteId: normalizedSiteId,
          action: "member_operation",
          type: "recharge",
          membershipId: selectedMember.id,
          rechargePlanId: plan.id,
          note: `积分兑换充值：${plan.title}`,
        }),
      });
      const payload = (await response.json().catch(() => null)) as MembershipPatchPayload | null;
      if (!response.ok || !payload?.ok || !payload.membership) {
        throw new Error(operationErrorMessage(payload?.message, "充值失败，请稍后重试"));
      }
      setMemberships((current) =>
        current.map((membership) => (membership.id === payload.membership?.id ? payload.membership : membership)),
      );
      setRechargeDialogOpen(false);
      setNotice(`充值完成，余额增加 €${formatMoney(plan.rechargeAmount + plan.giftAmount)}，积分增加 ${formatPoints(plan.giftPoints)}。`);
      await loadData();
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
    if (totalPoints > selectedInsight.pointBalance) {
      setError("会员积分不足，不能兑换。");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/memberships", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          siteId: normalizedSiteId,
          action: "member_redemption_checkout",
          membershipId: selectedMember.id,
          redemptionItems: cartRows.map((row) => ({
            redemptionItemId: row.item?.id,
            customName: row.custom ? row.name : undefined,
            customCode: row.custom ? row.code : undefined,
            customPoints: row.custom ? row.unitPoints : undefined,
            quantity: row.quantity,
          })),
          note: note.trim(),
        }),
      });
      const payload = (await response.json().catch(() => null)) as MembershipPatchPayload | null;
      if (!response.ok || !payload?.ok || !payload.membership) {
        throw new Error(operationErrorMessage(payload?.message, "积分兑换失败，请稍后重试"));
      }
      setMemberships((current) =>
        current.map((membership) => (membership.id === payload.membership?.id ? payload.membership : membership)),
      );
      setCart([]);
      setNote("");
      setCheckoutConfirmOpen(false);
      setNotice(`兑换完成，已扣减 ${formatPoints(totalPoints)} 积分。`);
      await loadData();
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "积分兑换失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  function notifyUnavailable(label: string) {
    setNotice(`积分兑换暂不需要${label}。`);
  }

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

        .merchant-pos-cashier .cashier-title small {
          display: block;
          margin-top: 4px;
          color: var(--pos-muted);
          font-weight: 700;
        }

        .merchant-pos-cashier .cashier-refresh-line {
          display: flex;
          align-items: center;
          gap: 8px;
          height: 36px;
          margin-top: 2px;
          color: var(--pos-muted);
          font-size: 14px;
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

        .merchant-pos-cashier .pos-alert {
          position: fixed;
          left: 50%;
          top: 50%;
          z-index: 120;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          max-width: min(520px, calc(100vw - 48px));
          min-height: 46px;
          border-radius: 8px;
          padding: 12px 18px;
          font-weight: 800;
          text-align: center;
          box-shadow: 0 24px 70px rgba(15, 23, 42, 0.24);
          transform: translate(-50%, -50%);
          animation: pos-toast-in 0.16s ease-out;
        }

        .merchant-pos-cashier .pos-alert.error {
          border: 1px solid #fecdd3;
          background: #fff1f2;
          color: #be123c;
        }

        .merchant-pos-cashier .pos-alert.notice {
          border: 1px solid #a7f3d0;
          background: #ecfdf5;
          color: #047857;
        }

        @keyframes pos-toast-in {
          from {
            opacity: 0;
            transform: translate(-50%, calc(-50% + 10px));
          }
          to {
            opacity: 1;
            transform: translate(-50%, -50%);
          }
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
          flex: 0 1 360px;
          width: min(360px, 34vw);
          gap: 8px;
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

        .merchant-pos-cashier .member-action-buttons {
          display: flex;
          flex: 0 0 auto;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
          margin-left: auto;
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

        .merchant-pos-cashier .category-check-row {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          min-height: 34px;
          border: 1px solid var(--pos-line);
          border-radius: 6px;
          background: var(--pos-surface-soft);
          padding: 0 9px;
          color: var(--pos-text);
          font-weight: 820;
          text-align: left;
          cursor: pointer;
        }

        .merchant-pos-cashier .category-check-row.active {
          border-color: var(--pos-primary);
          background: var(--pos-primary-soft);
          color: var(--pos-primary-dark);
          box-shadow: var(--pos-focus-inset);
        }

        .merchant-pos-cashier .category-check-box {
          display: grid;
          place-items: center;
          width: 17px;
          height: 17px;
          border: 1px solid var(--pos-line);
          border-radius: 4px;
          color: transparent;
          background: var(--pos-surface);
        }

        .merchant-pos-cashier .category-check-row.active .category-check-box {
          border-color: var(--pos-primary);
          background: var(--pos-primary);
          color: white;
        }

        .merchant-pos-cashier .category-check-box svg,
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
          width: 152px;
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
          min-height: 52px;
          padding: 10px 12px;
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
          </div>
          <div className="cashier-refresh-line">
            <span>{formatDateYmd()}</span>
            <button type="button" className="pos-button" onClick={loadData}>
              刷新
            </button>
            {loading ? <span>正在刷新...</span> : null}
          </div>
        </div>
        <div className="cashier-actions">
          <button type="button" className="el-button el-button--default" onClick={() => notifyUnavailable("开钱箱")}>
            开钱箱
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

      {error || notice ? (
        <div className={`pos-alert ${error ? "error" : "notice"}`} role={error ? "alert" : "status"} aria-live="polite">
          {error || notice}
        </div>
      ) : null}

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
                  <strong>{getMemberDisplayName(selectedMember)}</strong>
                  <span>会员卡号: {selectedMember.memberNo}</span>
                  <span>积分: {formatPoints(selectedInsight.pointBalance)}</span>
                  <span>余额: €{formatMoney(selectedInsight.balanceAmount)}</span>
                  <button type="button" className="link-button" onClick={clearMember}>
                    清除
                  </button>
                </>
              ) : (
                <span>散客</span>
              )}
            </div>
            <div className="member-actions">
              <div className="member-search">
                <input
                  value={memberKeyword}
                  onChange={(event) => {
                    setMemberKeyword(event.target.value);
                    setMemberPickerOpen(true);
                  }}
                  onFocus={() => setMemberPickerOpen(true)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") lookupMember();
                  }}
                  placeholder="会员手机号 / 卡号"
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
                            {row.custom ? "快捷兑换" : `${categoryName(enabledCategories, row.categoryId)} / ${row.item ? stockLabel(row.item) : "不限库存"}`}
                          </span>
                        </strong>
                        <span>{formatPoints(row.unitPoints)}</span>
                        <div className="quantity-control">
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
                        </div>
                        <span>{formatPoints(row.subtotalPoints)}</span>
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
                <span>合计积分</span>
                <strong>{formatPoints(totalPoints)}</strong>
              </div>
              <button type="button" className="checkout-button" disabled={!canCheckout} onClick={() => setCheckoutConfirmOpen(true)}>
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
                  setViewMode("image");
                  setImageSizeMenuOpen((current) => !current);
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
                  <div className="catalog-popover-stack">
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
            <div className="category-menu-anchor">
            <button
              type="button"
              className={`category-chip ${!categoryId ? "active" : ""}`}
              onClick={() => setCategoryMenuOpen((current) => !current)}
            >
              <span className="category-button-icon">
                <IconGrid />
              </span>
              <span className="category-button-label">全部</span>
            </button>
              {categoryMenuOpen ? (
                <div className="catalog-popover catalog-popover-left">
                  <div className="catalog-popover-stack">
                    {([
                      ["hot", "热卖"],
                      ["category", "分类"],
                      ["recommend", "推荐"],
                    ] as Array<[CatalogFilterTab, string]>).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        className={`catalog-panel-button ${catalogFilterTab === value ? "active" : ""}`}
                        onClick={() => setCatalogFilterTab(value)}
                      >
                        {label}
                      </button>
                    ))}
                    <div className="catalog-panel-label">默认</div>
                    <div className="catalog-sort-row">
                      <button
                        type="button"
                        className={`catalog-panel-button ${catalogSortMode === "code" ? "active" : ""}`}
                        onClick={() => setCatalogSortMode("code")}
                      >
                        编号
                      </button>
                      <button
                        type="button"
                        className={`catalog-panel-button ${catalogSortMode === "name" ? "active" : ""}`}
                        onClick={() => setCatalogSortMode("name")}
                      >
                        字母
                      </button>
                    </div>
                    <button
                      type="button"
                      className={`category-check-row ${!categoryId ? "active" : ""}`}
                      onClick={() => setCategoryId("")}
                    >
                      <span className="category-check-box">
                        <IconCheck />
                      </span>
                      <span className="category-button-icon">
                        <IconGrid />
                      </span>
                      <span className="category-button-label">全部</span>
                    </button>
                    {enabledCategories.map((category) => (
                      <button
                        key={category.id}
                        type="button"
                        className={`category-check-row ${categoryId === category.id ? "active" : ""}`}
                        onClick={() => setCategoryId(category.id)}
                      >
                        <span className="category-check-box">
                          <IconCheck />
                        </span>
                        <span className="category-button-icon">
                          <CategoryIcon name={category.name} />
                        </span>
                        <span className="category-button-label">{category.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            {enabledCategories.map((category) => (
              <button
                key={category.id}
                type="button"
                className={`category-chip ${categoryId === category.id ? "active" : ""}`}
                onClick={() => setCategoryId(category.id)}
              >
                <span className="category-button-icon">
                  <CategoryIcon name={category.name} />
                </span>
                <span className="category-button-label">{category.name}</span>
              </button>
            ))}
          </div>
            {categoryMenuOpen ? (
              <div className="catalog-popover catalog-popover-left">
                <div className="catalog-popover-stack">
                  {([
                    ["hot", "热卖"],
                    ["category", "分类"],
                    ["recommend", "推荐"],
                  ] as Array<[CatalogFilterTab, string]>).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={`catalog-panel-button ${catalogFilterTab === value ? "active" : ""}`}
                      onClick={() => setCatalogFilterTab(value)}
                    >
                      {label}
                    </button>
                  ))}
                  <div className="catalog-panel-label">默认</div>
                  <div className="catalog-sort-row">
                    <button
                      type="button"
                      className={`catalog-panel-button ${catalogSortMode === "code" ? "active" : ""}`}
                      onClick={() => setCatalogSortMode("code")}
                    >
                      编号
                    </button>
                    <button
                      type="button"
                      className={`catalog-panel-button ${catalogSortMode === "name" ? "active" : ""}`}
                      onClick={() => setCatalogSortMode("name")}
                    >
                      字母
                    </button>
                  </div>
                  <button
                    type="button"
                    className={`category-check-row ${!categoryId ? "active" : ""}`}
                    onClick={() => setCategoryId("")}
                  >
                    <span className="category-check-box">
                      <IconCheck />
                    </span>
                    <span className="category-button-icon">
                      <IconGrid />
                    </span>
                    <span className="category-button-label">全部</span>
                  </button>
                  {enabledCategories.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      className={`category-check-row ${categoryId === category.id ? "active" : ""}`}
                      onClick={() => setCategoryId(category.id)}
                    >
                      <span className="category-check-box">
                        <IconCheck />
                      </span>
                      <span className="category-button-icon">
                        <CategoryIcon name={category.name} />
                      </span>
                      <span className="category-button-label">{category.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className={`catalog-products ${viewMode === "image" ? `goods-grid goods-grid-${productImageSize}` : "goods-list"}`}>
            {filteredItems.length ? (
              filteredItems.map((item) => {
                const unitPoints = getRedemptionPointCostForMember(item, selectedMember, settings);
                const inCartQuantity = cartQuantityByItemId.get(item.id) ?? 0;
                const outOfStock = item.stock > 0 && inCartQuantity >= item.stock;

                if (viewMode === "text") {
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`product-tile product-tile-text ${outOfStock ? "is-out-of-stock" : ""}`}
                      disabled={outOfStock}
                      onClick={() => addToCart(item)}
                    >
                      <span className="product-code">{item.code || item.id}</span>
                      <strong>{item.name}</strong>
                      <span className={`product-stock ${outOfStock ? "danger" : ""}`}>{stockLabel(item)}</span>
                      <span className="product-price">{formatPoints(unitPoints)}</span>
                    </button>
                  );
                }

                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`product-tile ${outOfStock ? "is-out-of-stock" : ""}`}
                    disabled={outOfStock}
                    onClick={() => addToCart(item)}
                  >
                    <div className="product-visual">
                      {item.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.imageUrl} alt={item.name || item.code || "兑换项目"} />
                      ) : (
                        <span>{productInitial(item)}</span>
                      )}
                    </div>
                    <div className="product-footer">
                      <strong>{item.name}</strong>
                      <span className="product-price">{formatPoints(unitPoints)}</span>
                      <span className={`product-stock ${outOfStock ? "danger" : ""}`}>
                        {stockLabel(item)}
                        {inCartQuantity ? ` / 已选 ${inCartQuantity}` : ""}
                      </span>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="catalog-empty">暂无匹配项目。请在会员管理的兑换项目中添加并启用。</div>
            )}
          </div>
        </section>
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
