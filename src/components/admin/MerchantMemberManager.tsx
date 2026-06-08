"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  MERCHANT_MEMBER_LEGAL_ALLERGENS,
  type MerchantMemberAccountTransaction,
  type MerchantMemberAccountTransactionType,
  type MerchantMembershipInsight,
  type MerchantMembershipListItem,
} from "@/lib/merchantMemberships";
import { showGlobalToast } from "@/lib/globalToast";
import {
  MERCHANT_ADMIN_DATA_CACHE_TTL_MS,
  fetchMerchantAdminDataWithCache,
  invalidateMerchantAdminDataCachePrefix,
  makeMerchantAdminDataCacheKey,
  readMerchantAdminDataCacheSnapshot,
  writeMerchantAdminDataCache,
} from "@/lib/merchantAdminDataCache";
import { createClientMutationOperationId } from "@/lib/mutationOperationId";
import type {
  MerchantMemberLevel,
  MerchantMemberRechargePlan,
  MerchantMemberRedemptionItem,
  MerchantMembershipSettings,
} from "@/lib/merchantMembershipSettings";
import { parseMerchantMemberPointDiscountRate } from "@/lib/merchantMembershipSettings";

type MerchantMemberManagerProps = {
  siteId: string;
  siteName?: string;
  className?: string;
};

type MembershipsPayload = {
  ok?: unknown;
  memberships?: MerchantMembershipListItem[];
  total?: unknown;
  allTotal?: unknown;
  hasMore?: unknown;
  message?: unknown;
};

type MembershipSettingsPayload = {
  ok?: unknown;
  settings?: MerchantMembershipSettings;
  message?: unknown;
};

type MembershipPatchPayload = {
  ok?: unknown;
  membership?: MerchantMembershipListItem;
  message?: unknown;
};

type MemberStatusFilter = "all" | "active" | "left";
type MemberOperationDialogState = {
  membershipId: string;
  type: MerchantMemberAccountTransactionType;
} | null;

const MERCHANT_MEMBER_PAGE_SIZE = 120;
const MERCHANT_MEMBER_REQUEST_TIMEOUT_MS = 12_000;

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

function formatDateTime(value: string | null | undefined) {
  const timestamp = Date.parse(String(value ?? ""));
  if (!Number.isFinite(timestamp)) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function formatMoney(value: number | null | undefined) {
  const normalized = Number(value ?? 0);
  return Number.isFinite(normalized) ? normalized.toFixed(2) : "0.00";
}

function formatFrequency(value: number | null | undefined) {
  const normalized = Number(value ?? 0);
  if (!Number.isFinite(normalized) || normalized <= 0) return "-";
  return `${normalized.toFixed(normalized >= 10 ? 1 : 2)} 单/月`;
}

function couponClaimStatusLabel(status: MerchantMembershipInsight["couponHistory"][number]["status"]) {
  if (status === "used") return "已使用";
  if (status === "expired") return "已过期";
  if (status === "inactive") return "未生效";
  return "有效未使用";
}

function couponBenefitTargetLabel(item: MerchantMembershipInsight["couponHistory"][number]) {
  if (item.discountType === "product_voucher") {
    return `${item.productName || item.title} x ${Math.max(1, item.productQuantity || 1)}`;
  }
  if (item.discountType === "exchange_voucher") {
    return `${item.exchangeItem || item.title} x ${Math.max(1, item.exchangeQuantity || 1)}`;
  }
  if (item.discountType === "ticket_voucher") {
    return item.ticketVenue || item.title;
  }
  return item.discountLabel;
}

function accountTransactionTypeLabel(type: MerchantMemberAccountTransactionType) {
  return type === "recharge" ? "充值" : "兑换";
}

function formatSignedNumber(value: number) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized === 0) return "0";
  return `${normalized > 0 ? "+" : ""}${Math.round(normalized)}`;
}

function formatSignedMoney(value: number) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized === 0) return "0.00";
  return `${normalized > 0 ? "+" : ""}${normalized.toFixed(2)}`;
}

function formatAccountTransactionChange(transaction: MerchantMemberAccountTransaction) {
  const parts = [];
  if (transaction.pointDelta !== 0) parts.push(`积分 ${formatSignedNumber(transaction.pointDelta)}`);
  if (transaction.balanceDelta !== 0) parts.push(`余额 ${formatSignedMoney(transaction.balanceDelta)}`);
  if (transaction.growthDelta !== 0) parts.push(`成长值 ${formatSignedMoney(transaction.growthDelta)}`);
  return parts.join(" / ") || "-";
}

function statusLabel(status: MerchantMembershipListItem["status"]) {
  return status === "left" ? "已退会" : "正常";
}

function statusBadgeClass(status: MerchantMembershipListItem["status"]) {
  return status === "left"
    ? "border-slate-200 bg-slate-100 text-slate-500"
    : "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function genderLabel(value: string | null | undefined) {
  if (value === "male") return "男";
  if (value === "female") return "女";
  if (value === "other") return "其他";
  return "-";
}

function joinLocation(...parts: Array<string | null | undefined>) {
  return parts.map((part) => trimText(part, 120)).filter(Boolean).join(" / ") || "-";
}

function getEnabledLevels(settings: MerchantMembershipSettings | null) {
  return (settings?.levels ?? [])
    .filter((level) => level.enabled && trimText(level.name, 120))
    .sort((left, right) => left.requiredGrowthValue - right.requiredGrowthValue || left.sort - right.sort);
}

function resolveMembershipLevel(
  settings: MerchantMembershipSettings | null,
  membership: Pick<MerchantMembershipListItem, "growthValue" | "levelId"> | null,
): MerchantMemberLevel | null {
  if (!membership) return null;
  const levels = getEnabledLevels(settings);
  return (
    levels.find((level) => level.id === membership.levelId) ??
    levels.reduce<MerchantMemberLevel | null>((matched, level) => {
      return membership.growthValue >= level.requiredGrowthValue ? level : matched;
    }, null)
  );
}

function getRedemptionPointCostForMember(
  item: MerchantMemberRedemptionItem,
  membership: MerchantMembershipListItem | null,
  settings: MerchantMembershipSettings | null,
) {
  const basePoints = item.pointsCost ?? 0;
  const level = resolveMembershipLevel(settings, membership);
  const rate = parseMerchantMemberPointDiscountRate(level?.benefit.pointDiscount);
  return Math.max(0, Math.ceil(basePoints * rate));
}

function redemptionStockText(stock: number | null) {
  if (stock === null) return "不限";
  return stock > 0 ? String(stock) : "无库存";
}

function formatBirthday(membership: MerchantMembershipListItem) {
  if (!membership.birthday) return "-";
  return membership.birthdayMonthDayOnly ? `${membership.birthday}（仅月日）` : membership.birthday;
}

function readPayloadMessage(value: unknown, fallback: string) {
  return trimText(value) || fallback;
}

async function fetchMemberJson(input: RequestInfo | URL, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), MERCHANT_MEMBER_REQUEST_TIMEOUT_MS);
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

function getMemberDisplayName(membership: MerchantMembershipListItem) {
  if (!membership.profileVisible) return "已退会会员";
  return membership.nickname || membership.name || membership.email || membership.accountId || membership.memberNo;
}

function getAvatarInitial(membership: MerchantMembershipListItem) {
  return getMemberDisplayName(membership).slice(0, 1).toUpperCase() || "会";
}

function ProfileField({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string | number | null | undefined;
  className?: string;
}) {
  const text = trimText(value, 1000) || "-";
  return (
    <div className={`rounded-xl bg-slate-50 px-3 py-2 ${className}`}>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold text-slate-800">{text}</div>
    </div>
  );
}

export default function MerchantMemberManager({ siteId, className = "" }: MerchantMemberManagerProps) {
  const [memberships, setMemberships] = useState<MerchantMembershipListItem[]>([]);
  const [selectedMembershipId, setSelectedMembershipId] = useState("");
  const [statusFilter, setStatusFilter] = useState<MemberStatusFilter>("all");
  const [keyword, setKeyword] = useState("");
  const [membershipTotal, setMembershipTotal] = useState(0);
  const [membershipAllTotal, setMembershipAllTotal] = useState(0);
  const [membershipHasMore, setMembershipHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const membershipsRef = useRef<MerchantMembershipListItem[]>([]);
  const membershipInsightRequestIdsRef = useRef<Set<string>>(new Set());
  const membershipLoadRequestIdRef = useRef(0);
  const memberSettingsLoadRequestIdRef = useRef(0);
  const [couponHistoryOpen, setCouponHistoryOpen] = useState(false);
  const [couponWalletMembershipId, setCouponWalletMembershipId] = useState("");
  const [allergenSaving, setAllergenSaving] = useState(false);
  const [allergenError, setAllergenError] = useState("");
  const [operationDialog, setOperationDialog] = useState<MemberOperationDialogState>(null);
  const [operationPoints, setOperationPoints] = useState("");
  const [operationBalance, setOperationBalance] = useState("");
  const [operationNote, setOperationNote] = useState("");
  const [operationRechargePlanId, setOperationRechargePlanId] = useState("");
  const [operationRedemptionItemId, setOperationRedemptionItemId] = useState("");
  const [operationRedemptionQuantity, setOperationRedemptionQuantity] = useState("1");
  const [operationSaving, setOperationSaving] = useState(false);
  const [operationError, setOperationError] = useState("");
  const [memberSettings, setMemberSettings] = useState<MerchantMembershipSettings | null>(null);
  const [memberSettingsError, setMemberSettingsError] = useState("");
  const normalizedSiteId = siteId.trim();
  const deferredKeyword = useDeferredValue(keyword);

  const membershipById = useMemo(
    () => new Map(memberships.map((membership) => [membership.id, membership])),
    [memberships],
  );

  const filteredMemberships = memberships;
  const renderedMemberships = memberships;

  useEffect(() => {
    membershipsRef.current = memberships;
  }, [memberships]);

  const selectedMembership = useMemo(() => {
    return membershipById.get(selectedMembershipId) ?? null;
  }, [membershipById, selectedMembershipId]);
  const selectedInsight = selectedMembership?.insight ?? EMPTY_MEMBER_INSIGHT;
  const couponWalletMembership = useMemo(() => {
    return membershipById.get(couponWalletMembershipId) ?? null;
  }, [couponWalletMembershipId, membershipById]);
  const couponWalletInsight = couponWalletMembership?.insight ?? EMPTY_MEMBER_INSIGHT;
  const selectedMembershipLevel = useMemo(
    () => resolveMembershipLevel(memberSettings, selectedMembership),
    [memberSettings, selectedMembership],
  );
  const operationMembership = useMemo(() => {
    return operationDialog ? membershipById.get(operationDialog.membershipId) ?? null : null;
  }, [membershipById, operationDialog]);
  const operationInsight = operationMembership?.insight ?? EMPTY_MEMBER_INSIGHT;
  const enabledRechargePlans = useMemo(
    () => (memberSettings?.rechargePlans ?? []).filter((plan) => plan.enabled),
    [memberSettings],
  );
  const enabledRedemptionItems = useMemo(
    () => (memberSettings?.redemptionItems ?? []).filter((item) => item.enabled),
    [memberSettings],
  );
  const selectedRechargePlan = useMemo(
    () => enabledRechargePlans.find((plan) => plan.id === operationRechargePlanId) ?? null,
    [enabledRechargePlans, operationRechargePlanId],
  );
  const selectedRedemptionItem = useMemo(
    () => enabledRedemptionItems.find((item) => item.id === operationRedemptionItemId) ?? null,
    [enabledRedemptionItems, operationRedemptionItemId],
  );
  const selectedRedemptionUnitPoints = useMemo(
    () =>
      selectedRedemptionItem
        ? getRedemptionPointCostForMember(selectedRedemptionItem, operationMembership, memberSettings)
        : 0,
    [memberSettings, operationMembership, selectedRedemptionItem],
  );

  useEffect(() => {
    const message = allergenError || operationError;
    if (!message) return;
    showGlobalToast(message, { tone: "error" });
    const timer = window.setTimeout(() => {
      setAllergenError("");
      setOperationError("");
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [allergenError, operationError]);

  const loadMemberships = useCallback(async (mode: "reset" | "append" = "reset", force = false) => {
    if (!/^\d{8}$/.test(normalizedSiteId)) {
      setMemberships([]);
      setSelectedMembershipId("");
      setMembershipTotal(0);
      setMembershipAllTotal(0);
      setMembershipHasMore(false);
      setLoadError("当前商户资料还没准备好，请稍后重试。");
      return;
    }
    const offset = mode === "append" ? membershipsRef.current.length : 0;
    const normalizedKeyword = deferredKeyword.trim();
    const params = new URLSearchParams({
      siteId: normalizedSiteId,
      offset: String(offset),
      limit: String(MERCHANT_MEMBER_PAGE_SIZE),
      includeInsights: "0",
    });
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (normalizedKeyword) params.set("query", normalizedKeyword);
    const cacheKey = makeMerchantAdminDataCacheKey(
      "merchant-memberships",
      normalizedSiteId,
      statusFilter,
      normalizedKeyword,
      offset,
      MERCHANT_MEMBER_PAGE_SIZE,
    );
    const requestId = ++membershipLoadRequestIdRef.current;
    const applyMembershipsPayload = (payload: MembershipsPayload) => {
      const nextMemberships = Array.isArray(payload.memberships) ? payload.memberships : [];
      setMemberships((current) => (mode === "append" ? [...current, ...nextMemberships] : nextMemberships));
      setMembershipTotal(Number(payload.total) || nextMemberships.length);
      setMembershipAllTotal(Number(payload.allTotal) || nextMemberships.length);
      setMembershipHasMore(payload.hasMore === true);
      setSelectedMembershipId((current) => {
        const candidateMemberships = mode === "append" ? [...membershipsRef.current, ...nextMemberships] : nextMemberships;
        if (current && candidateMemberships.some((membership) => membership.id === current)) return current;
        return "";
      });
    };
    const loadMembershipsFromServer = async () => {
      const response = await fetchMemberJson(`/api/memberships?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
        },
      });
      const payload = (await response.json().catch(() => null)) as MembershipsPayload | null;
      if (!response.ok || payload?.ok !== true) {
        throw new Error(readPayloadMessage(payload?.message, "会员列表加载失败，请稍后重试"));
      }
      return payload;
    };
    const cachedPayload = force
      ? null
      : readMerchantAdminDataCacheSnapshot<MembershipsPayload>(cacheKey, MERCHANT_ADMIN_DATA_CACHE_TTL_MS);
    if (cachedPayload) {
      setLoadError("");
      applyMembershipsPayload(cachedPayload.data);
      if (mode === "reset") {
        void fetchMerchantAdminDataWithCache(cacheKey, loadMembershipsFromServer, {
          force: true,
          allowStaleOnError: true,
          dedupe: true,
        })
          .then((payload) => {
            if (membershipLoadRequestIdRef.current === requestId) applyMembershipsPayload(payload);
          })
          .catch(() => {});
      }
      return;
    }
    setLoading(true);
    setLoadError("");
    try {
      const payload = await fetchMerchantAdminDataWithCache(
        cacheKey,
        async () => {
          const response = await fetchMemberJson(`/api/memberships?${params.toString()}`, {
            method: "GET",
            cache: "no-store",
            credentials: "same-origin",
            headers: {
              accept: "application/json",
            },
          });
          const payload = (await response.json().catch(() => null)) as MembershipsPayload | null;
          if (!response.ok || payload?.ok !== true) {
            throw new Error(readPayloadMessage(payload?.message, "会员列表加载失败，请稍后重试"));
          }
          return payload;
        },
        { force, allowStaleOnError: true },
      );
      if (membershipLoadRequestIdRef.current === requestId) applyMembershipsPayload(payload);
    } catch (error) {
      if (membershipLoadRequestIdRef.current === requestId) {
        if (mode === "reset") {
          setMemberships([]);
          setMembershipTotal(0);
          setMembershipAllTotal(0);
          setMembershipHasMore(false);
        }
        setSelectedMembershipId("");
        setLoadError(error instanceof Error ? error.message : "会员列表加载失败，请稍后重试");
      }
    } finally {
      if (membershipLoadRequestIdRef.current === requestId) setLoading(false);
    }
  }, [deferredKeyword, normalizedSiteId, statusFilter]);

  const loadMemberSettings = useCallback(async (force = false) => {
    if (!/^\d{8}$/.test(normalizedSiteId)) {
      setMemberSettings(null);
      setMemberSettingsError("");
      return;
    }
    const cacheKey = makeMerchantAdminDataCacheKey("merchant-membership-settings", normalizedSiteId, "full");
    const requestId = ++memberSettingsLoadRequestIdRef.current;
    const loadSettingsFromServer = async () => {
      const response = await fetchMemberJson(`/api/membership-settings?siteId=${encodeURIComponent(normalizedSiteId)}`, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
        },
      });
      const payload = (await response.json().catch(() => null)) as MembershipSettingsPayload | null;
      if (!response.ok || payload?.ok !== true || !payload.settings) {
        throw new Error(readPayloadMessage(payload?.message, "会员配置加载失败，充值和兑换将暂时使用手动输入。"));
      }
      return payload.settings;
    };
    const cachedSettings = force
      ? null
      : readMerchantAdminDataCacheSnapshot<MerchantMembershipSettings>(cacheKey, MERCHANT_ADMIN_DATA_CACHE_TTL_MS);
    if (cachedSettings) {
      setMemberSettingsError("");
      setMemberSettings(cachedSettings.data);
      void fetchMerchantAdminDataWithCache(cacheKey, loadSettingsFromServer, {
        force: true,
        allowStaleOnError: true,
        dedupe: true,
      })
        .then((settings) => {
          if (memberSettingsLoadRequestIdRef.current === requestId) setMemberSettings(settings);
        })
        .catch(() => {});
      return;
    }
    setMemberSettingsError("");
    try {
      const settings = await fetchMerchantAdminDataWithCache(
        cacheKey,
        async () => {
          const response = await fetchMemberJson(`/api/membership-settings?siteId=${encodeURIComponent(normalizedSiteId)}`, {
            method: "GET",
            cache: "no-store",
            credentials: "same-origin",
            headers: {
              accept: "application/json",
            },
          });
          const payload = (await response.json().catch(() => null)) as MembershipSettingsPayload | null;
          if (!response.ok || payload?.ok !== true || !payload.settings) {
            throw new Error(readPayloadMessage(payload?.message, "会员配置加载失败，充值和兑换将暂时使用手动输入。"));
          }
          return payload.settings;
        },
        { force, allowStaleOnError: true },
      );
      if (memberSettingsLoadRequestIdRef.current === requestId) setMemberSettings(settings);
    } catch (error) {
      if (memberSettingsLoadRequestIdRef.current === requestId) {
        setMemberSettings(null);
        setMemberSettingsError(error instanceof Error ? error.message : "会员配置加载失败，充值和兑换将暂时使用手动输入。");
      }
    }
  }, [normalizedSiteId]);

  const ensureMembershipInsight = useCallback(async (membershipId: string) => {
    const normalizedMembershipId = trimText(membershipId, 160);
    if (!/^\d{8}$/.test(normalizedSiteId) || !normalizedMembershipId) return;
    const currentMembership = membershipsRef.current.find((membership) => membership.id === normalizedMembershipId);
    if (!currentMembership || currentMembership.insight) return;
    if (membershipInsightRequestIdsRef.current.has(normalizedMembershipId)) return;
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

    membershipInsightRequestIdsRef.current.add(normalizedMembershipId);
    try {
      const params = new URLSearchParams({
        siteId: normalizedSiteId,
        membershipId: normalizedMembershipId,
        limit: "1",
        includeInsights: "1",
      });
      const response = await fetchMemberJson(`/api/memberships?${params.toString()}`, {
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
      // The list stays usable; insight data can be retried by reopening the member.
    } finally {
      membershipInsightRequestIdsRef.current.delete(normalizedMembershipId);
    }
  }, [normalizedSiteId]);

  useEffect(() => {
    void loadMemberships();
  }, [loadMemberships]);

  useEffect(() => {
    void loadMemberSettings();
  }, [loadMemberSettings]);

  useEffect(() => {
    const refreshOnVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void loadMemberships();
      void loadMemberSettings();
    };
    window.addEventListener("focus", refreshOnVisible);
    document.addEventListener("visibilitychange", refreshOnVisible);
    return () => {
      window.removeEventListener("focus", refreshOnVisible);
      document.removeEventListener("visibilitychange", refreshOnVisible);
    };
  }, [loadMemberSettings, loadMemberships]);

  useEffect(() => {
    setCouponHistoryOpen(false);
    setAllergenError("");
  }, [selectedMembershipId]);

  useEffect(() => {
    if (!selectedMembershipId) return;
    void ensureMembershipInsight(selectedMembershipId);
  }, [ensureMembershipInsight, selectedMembershipId]);

  useEffect(() => {
    if (!couponWalletMembershipId) return;
    void ensureMembershipInsight(couponWalletMembershipId);
  }, [couponWalletMembershipId, ensureMembershipInsight]);

  async function toggleMemberAllergen(allergen: string) {
    if (!selectedMembership || !selectedMembership.profileVisible || allergenSaving) return;
    const currentAllergens = Array.isArray(selectedMembership.allergens) ? selectedMembership.allergens : [];
    const currentSet = new Set(currentAllergens);
    if (currentSet.has(allergen)) currentSet.delete(allergen);
    else currentSet.add(allergen);
    const nextAllergens = Array.from(currentSet);
    const previousMemberships = memberships;
    setAllergenSaving(true);
    setAllergenError("");
    setMemberships((current) =>
      current.map((membership) =>
        membership.id === selectedMembership.id ? { ...membership, allergens: nextAllergens } : membership,
      ),
    );
    try {
      const response = await fetchMemberJson("/api/memberships", {
        method: "PATCH",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          action: "update_allergens",
          siteId: normalizedSiteId,
          membershipId: selectedMembership.id,
          allergens: nextAllergens,
        }),
      });
      const payload = (await response.json().catch(() => null)) as MembershipPatchPayload | null;
      if (!response.ok || payload?.ok !== true || !payload.membership) {
        throw new Error(readPayloadMessage(payload?.message, "过敏信息保存失败，请稍后重试"));
      }
      invalidateMerchantAdminDataCachePrefix(makeMerchantAdminDataCacheKey("merchant-memberships", normalizedSiteId));
      invalidateMerchantAdminDataCachePrefix(
        makeMerchantAdminDataCacheKey("merchant-membership-detail", normalizedSiteId, selectedMembership.id),
      );
      setMemberships((current) =>
        current.map((membership) =>
          membership.id === selectedMembership.id
            ? {
                ...membership,
                ...payload.membership,
                insight: membership.insight,
              }
            : membership,
        ),
      );
    } catch (error) {
      setMemberships(previousMemberships);
      setAllergenError(error instanceof Error ? error.message : "过敏信息保存失败，请稍后重试");
    } finally {
      setAllergenSaving(false);
    }
  }

  function openMemberOperation(membership: MerchantMembershipListItem, type: MerchantMemberAccountTransactionType) {
    if (!membership.profileVisible || membership.status !== "active") return;
    const defaultRechargePlan = type === "recharge" ? enabledRechargePlans[0] ?? null : null;
    const defaultRedemptionItem = type === "redeem" ? enabledRedemptionItems[0] ?? null : null;
    setOperationDialog({ membershipId: membership.id, type });
    setOperationPoints("");
    setOperationBalance("");
    setOperationNote("");
    setOperationRechargePlanId("");
    setOperationRedemptionItemId("");
    setOperationRedemptionQuantity("1");
    setOperationError("");
    if (defaultRechargePlan) applyRechargePlanSelection(defaultRechargePlan);
    if (defaultRedemptionItem) applyRedemptionItemSelection(defaultRedemptionItem, "1", membership);
  }

  function closeMemberOperation() {
    if (operationSaving) return;
    setOperationDialog(null);
    setOperationError("");
  }

  function openMemberCoupons(membership: MerchantMembershipListItem) {
    setCouponWalletMembershipId(membership.id);
  }

  function readOperationErrorMessage(value: unknown, fallback: string) {
    const message = trimText(value);
    if (message === "membership_balance_insufficient") return "积分或余额不足，不能兑换。";
    if (message === "membership_redemption_stock_insufficient") return "兑换项目库存不足。";
    if (message === "membership_operation_empty") return "请填写积分或金额。";
    if (message === "membership_not_active") return "该会员不是正常状态，不能操作。";
    return message || fallback;
  }

  function applyRechargePlanSelection(plan: MerchantMemberRechargePlan | null) {
    setOperationRechargePlanId(plan?.id ?? "");
    if (!plan) return;
    setOperationPoints(String(plan.giftPoints || 0));
    setOperationBalance(formatMoney((plan.rechargeAmount || 0) + (plan.giftAmount || 0)));
    setOperationNote((current) => current || `充值方案：${plan.title}`);
  }

  function applyRedemptionItemSelection(
    item: MerchantMemberRedemptionItem | null,
    quantityValue = operationRedemptionQuantity,
    membership: MerchantMembershipListItem | null = operationMembership,
  ) {
    const quantity = Math.max(1, Number.parseInt(quantityValue, 10) || 1);
    setOperationRedemptionItemId(item?.id ?? "");
    setOperationRedemptionQuantity(String(quantity));
    if (!item) return;
    setOperationPoints(String(getRedemptionPointCostForMember(item, membership, memberSettings) * quantity));
    setOperationBalance("");
    setOperationNote((current) => current || `兑换项目：${item.name} x ${quantity}`);
  }

  async function submitMemberOperation() {
    if (!operationDialog || !operationMembership || operationSaving) return;
    const redemptionQuantity = Math.max(1, Number.parseInt(operationRedemptionQuantity, 10) || 1);
    const points =
      operationDialog.type === "recharge" && selectedRechargePlan
        ? selectedRechargePlan.giftPoints
        : operationDialog.type === "redeem" && selectedRedemptionItem
          ? getRedemptionPointCostForMember(selectedRedemptionItem, operationMembership, memberSettings) * redemptionQuantity
          : Number.parseInt(operationPoints, 10) || 0;
    const balanceAmount =
      operationDialog.type === "recharge" && selectedRechargePlan
        ? (selectedRechargePlan.rechargeAmount || 0) + (selectedRechargePlan.giftAmount || 0)
        : operationDialog.type === "redeem" && selectedRedemptionItem
          ? 0
          : Number.parseFloat(operationBalance) || 0;
    if (points <= 0 && balanceAmount <= 0) {
      setOperationError("请填写积分或金额。");
      return;
    }
    if (operationDialog.type === "redeem") {
      if (points > operationMembership.pointBalance || balanceAmount > operationMembership.balanceAmount) {
        setOperationError("积分或余额不足，不能兑换。");
        return;
      }
    }
    setOperationSaving(true);
    setOperationError("");
    try {
      const operationId = createClientMutationOperationId("member-operation");
      const response = await fetchMemberJson("/api/memberships", {
        method: "PATCH",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          action: "member_operation",
          type: operationDialog.type,
          siteId: normalizedSiteId,
          membershipId: operationMembership.id,
          points,
          balanceAmount,
          note: operationNote,
          rechargePlanId: selectedRechargePlan?.id ?? "",
          redemptionItemId: selectedRedemptionItem?.id ?? "",
          redemptionQuantity,
          operationId,
        }),
      });
      const payload = (await response.json().catch(() => null)) as MembershipPatchPayload | null;
      if (!response.ok || payload?.ok !== true || !payload.membership) {
        throw new Error(readOperationErrorMessage(payload?.message, "会员账户操作失败，请稍后重试"));
      }
      invalidateMerchantAdminDataCachePrefix(makeMerchantAdminDataCacheKey("merchant-memberships", normalizedSiteId));
      invalidateMerchantAdminDataCachePrefix(
        makeMerchantAdminDataCacheKey("merchant-membership-detail", normalizedSiteId, operationMembership.id),
      );
      setMemberships((current) =>
        current.map((membership) => {
          if (membership.id !== operationMembership.id || !payload.membership) return membership;
          const currentInsight = membership.insight ?? EMPTY_MEMBER_INSIGHT;
          return {
            ...membership,
            ...payload.membership,
            insight: {
              ...currentInsight,
              pointBalance: payload.membership.pointBalance,
              balanceAmount: payload.membership.balanceAmount,
            },
          };
        }),
      );
      setOperationDialog(null);
      setOperationError("");
      if (operationDialog.type === "redeem" && selectedRedemptionItem && selectedRedemptionItem.stock !== null) {
        invalidateMerchantAdminDataCachePrefix(makeMerchantAdminDataCacheKey("merchant-membership-settings", normalizedSiteId));
        void loadMemberSettings(true);
      }
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "会员账户操作失败，请稍后重试");
    } finally {
      setOperationSaving(false);
    }
  }

  return (
    <section className={`space-y-4 ${className}`}>
      {loadError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{loadError}</div>
      ) : null}
      {memberSettingsError ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          {memberSettingsError}
        </div>
      ) : null}

      <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_12px_32px_rgba(15,23,42,0.05)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">会员列表</h2>
            <div className="mt-1 text-xs text-slate-500">当前筛选 {membershipTotal} / 全部 {membershipAllTotal}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              onClick={() => {
                void loadMemberships("reset", true);
                void loadMemberSettings(true);
              }}
              disabled={loading}
            >
              {loading ? "刷新中..." : "刷新"}
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            className="min-w-[260px] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400"
            placeholder="搜索昵称 / 姓名 / 手机 / 邮箱 / 会员卡号 / 地区"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <div className="flex flex-wrap gap-2 rounded-full border border-slate-200 bg-slate-50 p-1">
            {[
              { key: "all", label: "全部" },
              { key: "active", label: "正常" },
              { key: "left", label: "已退会" },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                className={`rounded-full px-3 py-1.5 text-sm transition ${
                  statusFilter === item.key ? "bg-slate-950 text-white shadow-sm" : "text-slate-600 hover:bg-white"
                }`}
                onClick={() => setStatusFilter(item.key as MemberStatusFilter)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="min-w-[1060px] w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600">
                  <tr>
                    <th className="px-3 py-2">序号</th>
                    <th className="px-3 py-2">会员</th>
                    <th className="px-3 py-2">会员卡号</th>
                    <th className="px-3 py-2">个人用户 ID</th>
                    <th className="px-3 py-2">手机</th>
                    <th className="px-3 py-2">邮箱</th>
                    <th className="px-3 py-2">加入时间</th>
                    <th className="px-3 py-2">状态</th>
                    <th className="px-3 py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && memberships.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-8 text-center text-xs text-slate-500">
                        正在加载会员列表...
                      </td>
                    </tr>
                  ) : filteredMemberships.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-8 text-center text-xs text-slate-500">
                        {keyword.trim() || statusFilter !== "all"
                          ? "没有匹配的会员，请调整搜索或筛选条件。"
                          : "还没有会员。个人用户在商户首页加入会员后会显示在这里。"}
                      </td>
                    </tr>
                  ) : (
                    <>
                    {renderedMemberships.map((membership, index) => {
                      const selected = selectedMembership?.id === membership.id;
                      const displayName = getMemberDisplayName(membership);
                      return (
                        <tr key={membership.id} className={`border-t ${selected ? "bg-blue-50/40" : "hover:bg-slate-50/70"}`}>
                          <td className="px-3 py-2 text-xs text-slate-500">{index + 1}</td>
                          <td className="px-3 py-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-900 text-xs font-semibold text-white">
                                {membership.profileVisible && membership.avatarUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={membership.avatarUrl} alt={displayName} className="h-full w-full object-cover" />
                                ) : (
                                  getAvatarInitial(membership)
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="max-w-[180px] truncate font-semibold text-slate-900">{displayName}</div>
                                <div className="text-xs text-slate-400">
                                  {membership.profileVisible ? membership.name || membership.nickname || "-" : "资料已隐藏"}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs font-semibold text-slate-700">{membership.memberNo}</td>
                          <td className="px-3 py-2 text-xs">{membership.profileVisible ? membership.accountId || "-" : "-"}</td>
                          <td className="px-3 py-2 text-xs">{membership.profileVisible ? membership.phone || "-" : "-"}</td>
                          <td className="px-3 py-2 text-xs">{membership.profileVisible ? membership.email || "-" : "-"}</td>
                          <td className="px-3 py-2 text-xs text-slate-500">{formatDateTime(membership.joinedAt)}</td>
                          <td className="px-3 py-2">
                            <span className={`rounded border px-2 py-0.5 text-xs ${statusBadgeClass(membership.status)}`}>
                              {statusLabel(membership.status)}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1.5">
                              <button
                                type="button"
                                className="rounded border bg-white px-2 py-1 text-xs hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() => openMemberOperation(membership, "redeem")}
                                disabled={!membership.profileVisible || membership.status !== "active"}
                              >
                                兑换
                              </button>
                              <button
                                type="button"
                                className="rounded border bg-white px-2 py-1 text-xs hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() => openMemberOperation(membership, "recharge")}
                                disabled={!membership.profileVisible || membership.status !== "active"}
                              >
                                充值
                              </button>
                              <button
                                type="button"
                                className="rounded border bg-white px-2 py-1 text-xs hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() => openMemberCoupons(membership)}
                                disabled={!membership.profileVisible}
                              >
                                卡券
                              </button>
                              <button
                                type="button"
                                className="rounded border bg-white px-2 py-1 text-xs hover:bg-slate-50"
                                onClick={() => setSelectedMembershipId(membership.id)}
                              >
                                详情
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {membershipHasMore ? (
                      <tr>
                        <td colSpan={9} className="px-3 py-4 text-center text-xs text-slate-500">
                          <div>当前筛选结果 {membershipTotal} 条，已加载 {renderedMemberships.length} 条。</div>
                          <button
                            type="button"
                            className="mt-3 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={loading}
                            onClick={() => void loadMemberships("append")}
                          >
                            {loading ? "加载中..." : "显示更多"}
                          </button>
                        </td>
                      </tr>
                    ) : null}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {selectedMembership ? (
        <div className="fixed inset-0 z-[120]">
          <button
            type="button"
            aria-label="关闭会员详情"
            className="absolute inset-0 cursor-default bg-slate-950/45"
            onClick={() => setSelectedMembershipId("")}
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
            <div className="pointer-events-auto max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-2xl">
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
                <div>
                  <div className="text-lg font-semibold text-slate-950">会员详情</div>
                  <div className="mt-1 text-xs text-slate-500">会员卡号：{selectedMembership.memberNo}</div>
                </div>
                <button
                  type="button"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  onClick={() => setSelectedMembershipId("")}
                >
                  关闭
                </button>
              </div>
              <div className="max-h-[calc(90vh-82px)] overflow-y-auto p-5">
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-slate-900 text-sm font-semibold text-white">
                          {selectedMembership.profileVisible && selectedMembership.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={selectedMembership.avatarUrl}
                              alt={getMemberDisplayName(selectedMembership)}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            getAvatarInitial(selectedMembership)
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-base font-semibold text-slate-950">
                            {getMemberDisplayName(selectedMembership)}
                          </div>
                          <div className="mt-1 font-mono text-xs text-slate-500">{selectedMembership.memberNo}</div>
                        </div>
                      </div>
                    </div>
                    <span className={`shrink-0 rounded border px-2 py-0.5 text-xs ${statusBadgeClass(selectedMembership.status)}`}>
                      {statusLabel(selectedMembership.status)}
                    </span>
                  </div>

                  <div className="grid gap-2 text-sm sm:grid-cols-2">
                    <ProfileField label="加入时间" value={formatDateTime(selectedMembership.joinedAt)} />
                    <ProfileField label="退会时间" value={selectedMembership.leftAt ? formatDateTime(selectedMembership.leftAt) : "-"} />
                  </div>

                  {selectedMembership.profileVisible ? (
                    <>
                      <div>
                        <div className="mb-2 text-sm font-semibold text-slate-900">会员数据</div>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          <ProfileField label="积分" value={selectedInsight.pointBalance} />
                          <ProfileField label="余额" value={formatMoney(selectedInsight.balanceAmount)} />
                          <ProfileField label="等级" value={selectedMembershipLevel?.name || "-"} />
                          <ProfileField label="成长值" value={formatMoney(selectedMembership.growthValue)} />
                          <ProfileField label="累计消费金额" value={formatMoney(selectedInsight.totalSpendAmount)} />
                          <ProfileField label="累计订单数" value={selectedInsight.totalOrderCount} />
                          <ProfileField label="消费频率" value={formatFrequency(selectedInsight.consumptionFrequencyPerMonth)} />
                          <ProfileField label="平均客单价" value={formatMoney(selectedInsight.averageOrderAmount)} />
                          <ProfileField label="最近消费时间" value={formatDateTime(selectedInsight.recentPurchaseAt)} />
                          <ProfileField label="首次消费时间" value={formatDateTime(selectedInsight.firstPurchaseAt)} />
                          <ProfileField label="年消费额" value={formatMoney(selectedInsight.yearlySpendAmount)} />
                          <ProfileField
                            label="产品偏好"
                            value={selectedInsight.productPreferences.length > 0 ? selectedInsight.productPreferences.join("、") : "-"}
                            className="sm:col-span-2 lg:col-span-3"
                          />
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-white p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-slate-900">账户记录</div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                              onClick={() => openMemberOperation(selectedMembership, "redeem")}
                            >
                              兑换
                            </button>
                            <button
                              type="button"
                              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                              onClick={() => openMemberOperation(selectedMembership, "recharge")}
                            >
                              充值
                            </button>
                            <button
                              type="button"
                              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                              onClick={() => openMemberCoupons(selectedMembership)}
                            >
                              卡券
                            </button>
                          </div>
                        </div>
                        <div className="mt-3 space-y-2">
                          {selectedMembership.transactions.length > 0 ? (
                            selectedMembership.transactions.slice(0, 8).map((transaction) => (
                              <div
                                key={transaction.id}
                                className="grid gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 sm:grid-cols-[110px_1fr_150px]"
                              >
                                <div className="font-semibold text-slate-900">{accountTransactionTypeLabel(transaction.type)}</div>
                                <div>
                                  <div className="font-semibold text-slate-800">{formatAccountTransactionChange(transaction)}</div>
                                  <div className="mt-0.5 text-slate-500">{transaction.note || "-"}</div>
                                </div>
                                <div className="text-slate-500 sm:text-right">{formatDateTime(transaction.at)}</div>
                              </div>
                            ))
                          ) : (
                            <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-500">暂无账户操作记录。</div>
                          )}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-semibold text-slate-900">优惠券</div>
                            <div className="mt-1 text-xs text-slate-500">
                              有效未使用：{selectedInsight.availableCouponCount} 张
                            </div>
                          </div>
                          <button
                            type="button"
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                            onClick={() => setCouponHistoryOpen((current) => !current)}
                          >
                            {couponHistoryOpen ? "收起历史" : "历史领取"}
                          </button>
                        </div>
                        <div className="mt-3 space-y-2">
                          {selectedInsight.availableCoupons.length > 0 ? (
                            selectedInsight.availableCoupons.map((coupon) => (
                              <div
                                key={coupon.couponId}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 text-sm"
                              >
                                <div className="min-w-0">
                                  <div className="truncate font-semibold text-slate-900">{coupon.title}</div>
                                  <div className="mt-0.5 text-xs text-slate-500">{coupon.discountLabel}</div>
                                </div>
                                <div className="shrink-0 font-semibold text-slate-900">x {coupon.count}</div>
                              </div>
                            ))
                          ) : (
                            <div className="rounded-xl bg-white px-3 py-2 text-sm text-slate-500">暂无有效未使用优惠券。</div>
                          )}
                        </div>
                        {couponHistoryOpen ? (
                          <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
                            <div className="max-h-72 overflow-auto">
                              <table className="min-w-[720px] w-full text-left text-xs">
                                <thead className="bg-slate-50 text-slate-500">
                                  <tr>
                                    <th className="px-3 py-2">优惠券</th>
                                    <th className="px-3 py-2">领取时间</th>
                                    <th className="px-3 py-2">有效期</th>
                                    <th className="px-3 py-2">核销码</th>
                                    <th className="px-3 py-2">状态</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {selectedInsight.couponHistory.length > 0 ? (
                                    selectedInsight.couponHistory.map((item) => (
                                      <tr key={item.id} className="border-t">
                                        <td className="px-3 py-2">
                                          <div className="font-semibold text-slate-900">{item.title}</div>
                                          <div className="text-slate-500">{item.discountLabel}</div>
                                        </td>
                                        <td className="px-3 py-2 text-slate-600">{formatDateTime(item.claimedAt)}</td>
                                        <td className="px-3 py-2 text-slate-600">{formatDateTime(item.validUntil)}</td>
                                        <td className="px-3 py-2 font-mono text-slate-600">{item.settlementCode || "-"}</td>
                                        <td className="px-3 py-2 text-slate-700">{couponClaimStatusLabel(item.status)}</td>
                                      </tr>
                                    ))
                                  ) : (
                                    <tr>
                                      <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                                        暂无领取记录。
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <div>
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-slate-900">过敏信息</div>
                          {allergenSaving ? <span className="text-xs text-slate-500">保存中...</span> : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {MERCHANT_MEMBER_LEGAL_ALLERGENS.map((allergen) => {
                            const active = selectedMembership.allergens.includes(allergen);
                            return (
                              <button
                                key={allergen}
                                type="button"
                                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                                  active
                                    ? "border-slate-950 bg-slate-950 text-white"
                                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-400"
                                }`}
                                onClick={() => void toggleMemberAllergen(allergen)}
                                disabled={allergenSaving}
                              >
                                {allergen}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div>
                        <div className="mb-2 text-sm font-semibold text-slate-900">会员资料</div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <ProfileField label="昵称" value={selectedMembership.nickname} />
                          <ProfileField label="姓名" value={selectedMembership.name} />
                          <ProfileField label="个人用户 ID" value={selectedMembership.accountId} />
                          <ProfileField label="手机" value={selectedMembership.phone} />
                          <ProfileField label="邮箱" value={selectedMembership.email} />
                          <ProfileField label="生日" value={formatBirthday(selectedMembership)} />
                          <ProfileField label="性别" value={genderLabel(selectedMembership.gender)} />
                          <ProfileField
                            label="地区"
                            value={joinLocation(selectedMembership.country, selectedMembership.province, selectedMembership.city)}
                          />
                          <ProfileField label="地址" value={selectedMembership.address} className="sm:col-span-2" />
                        </div>
                      </div>

                      <div>
                        <div className="mb-2 text-sm font-semibold text-slate-900">税务信息</div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <ProfileField label="税务名称" value={selectedMembership.taxName} />
                          <ProfileField label="税号" value={selectedMembership.taxNumber} />
                          <ProfileField
                            label="税务地区"
                            value={joinLocation(
                              selectedMembership.taxCountry,
                              selectedMembership.taxProvince,
                              selectedMembership.taxCity,
                            )}
                          />
                          <ProfileField label="税务详细地址" value={selectedMembership.taxAddress} />
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                      此会员已退会。按规则保留会员记录，但不再展示个人资料。
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {couponWalletMembership ? (
        <div className="fixed inset-0 z-[125]">
          <button
            type="button"
            aria-label="关闭会员卡券"
            className="absolute inset-0 cursor-default bg-slate-950/45"
            onClick={() => setCouponWalletMembershipId("")}
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
            <div className="pointer-events-auto max-h-[88vh] w-full max-w-3xl overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-2xl">
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
                <div>
                  <div className="text-lg font-semibold text-slate-950">会员卡券</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {getMemberDisplayName(couponWalletMembership)} · {couponWalletMembership.memberNo}
                  </div>
                </div>
                <button
                  type="button"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  onClick={() => setCouponWalletMembershipId("")}
                >
                  关闭
                </button>
              </div>
              <div className="max-h-[calc(88vh-82px)] overflow-y-auto p-5">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">有效未使用</div>
                      <div className="mt-1 text-xs text-slate-500">{couponWalletInsight.availableCouponCount} 张可用</div>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {couponWalletInsight.couponHistory.filter((item) => item.status === "available").length > 0 ? (
                      couponWalletInsight.couponHistory
                        .filter((item) => item.status === "available")
                        .map((item) => (
                          <div key={item.id} className="rounded-xl bg-white px-3 py-2 text-sm">
                            <div className="font-semibold text-slate-900">{item.title}</div>
                            <div className="mt-0.5 text-xs text-slate-500">{couponBenefitTargetLabel(item)}</div>
                            <div className="mt-1 font-mono text-xs text-slate-500">{item.settlementCode || item.couponCode}</div>
                          </div>
                        ))
                    ) : (
                      <div className="rounded-xl bg-white px-3 py-3 text-sm text-slate-500 sm:col-span-2">
                        暂无有效未使用卡券。
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">全部领取记录</div>
                  <div className="max-h-80 overflow-auto">
                    <table className="min-w-[760px] w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-3 py-2">卡券</th>
                          <th className="px-3 py-2">内容</th>
                          <th className="px-3 py-2">领取时间</th>
                          <th className="px-3 py-2">有效期</th>
                          <th className="px-3 py-2">核销码</th>
                          <th className="px-3 py-2">状态</th>
                        </tr>
                      </thead>
                      <tbody>
                        {couponWalletInsight.couponHistory.length > 0 ? (
                          couponWalletInsight.couponHistory.map((item) => (
                            <tr key={item.id} className="border-t">
                              <td className="px-3 py-2">
                                <div className="font-semibold text-slate-900">{item.title}</div>
                                <div className="text-slate-500">{item.discountLabel}</div>
                              </td>
                              <td className="px-3 py-2 text-slate-600">{couponBenefitTargetLabel(item)}</td>
                              <td className="px-3 py-2 text-slate-600">{formatDateTime(item.claimedAt)}</td>
                              <td className="px-3 py-2 text-slate-600">{formatDateTime(item.validUntil)}</td>
                              <td className="px-3 py-2 font-mono text-slate-600">{item.settlementCode || "-"}</td>
                              <td className="px-3 py-2 text-slate-700">{couponClaimStatusLabel(item.status)}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                              暂无领取记录。
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {operationDialog && operationMembership ? (
        <div className="fixed inset-0 z-[130]">
          <button
            type="button"
            aria-label="关闭会员账户操作"
            className="absolute inset-0 cursor-default bg-slate-950/45"
            onClick={closeMemberOperation}
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
            <form
              className="pointer-events-auto w-full max-w-lg overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-2xl"
              onSubmit={(event) => {
                event.preventDefault();
                void submitMemberOperation();
              }}
            >
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
                <div>
                  <div className="text-lg font-semibold text-slate-950">
                    会员{accountTransactionTypeLabel(operationDialog.type)}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {getMemberDisplayName(operationMembership)} · {operationMembership.memberNo}
                  </div>
                </div>
                <button
                  type="button"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  onClick={closeMemberOperation}
                  disabled={operationSaving}
                >
                  关闭
                </button>
              </div>
              <div className="space-y-4 px-5 py-4">
                <div className="grid gap-2 sm:grid-cols-2">
                  <ProfileField label="当前积分" value={operationInsight.pointBalance} />
                  <ProfileField label="当前余额" value={formatMoney(operationInsight.balanceAmount)} />
                </div>
                {operationDialog.type === "recharge" && enabledRechargePlans.length > 0 ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
                    <div className="text-sm font-semibold text-slate-800">充值方案</div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {enabledRechargePlans.map((plan) => (
                        <button
                          key={plan.id}
                          type="button"
                          className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
                            operationRechargePlanId === plan.id
                              ? "border-slate-950 bg-white shadow-sm"
                              : "border-slate-200 bg-white hover:border-slate-300"
                          }`}
                          onClick={() => applyRechargePlanSelection(plan)}
                          disabled={operationSaving}
                        >
                          <div className="font-semibold text-slate-950">{plan.title}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            充 {formatMoney(plan.rechargeAmount)} / 赠 {formatMoney(plan.giftAmount)} / 积分 {plan.giftPoints}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {operationDialog.type === "redeem" && enabledRedemptionItems.length > 0 ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
                    <div className="text-sm font-semibold text-slate-800">兑换项目</div>
                    <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_110px]">
                      <select
                        className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-900"
                        value={operationRedemptionItemId}
                        onChange={(event) => {
                          const nextItem = enabledRedemptionItems.find((item) => item.id === event.target.value) ?? null;
                          applyRedemptionItemSelection(nextItem);
                        }}
                        disabled={operationSaving}
                      >
                        {enabledRedemptionItems.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}（{item.pointsCost ?? "-"} 积分）
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-900"
                        value={operationRedemptionQuantity}
                        onChange={(event) => {
                          const nextQuantity = event.target.value;
                          setOperationRedemptionQuantity(nextQuantity);
                          applyRedemptionItemSelection(selectedRedemptionItem, nextQuantity);
                        }}
                        disabled={operationSaving}
                      />
                    </div>
                    {selectedRedemptionItem ? (
                      <div className="mt-2 text-xs text-slate-500">
                        库存 {redemptionStockText(selectedRedemptionItem.stock)}，本次扣减{" "}
                        {selectedRedemptionUnitPoints * (Number.parseInt(operationRedemptionQuantity, 10) || 1)} 积分
                        {selectedRedemptionItem.pointsCost !== null && selectedRedemptionUnitPoints !== selectedRedemptionItem.pointsCost
                          ? `（原 ${selectedRedemptionItem.pointsCost} 积分/件）`
                          : ""}
                        。
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-medium text-slate-700">
                    {operationDialog.type === "recharge" ? "增加积分" : "扣减积分"}
                    <input
                      type="number"
                      min="0"
                      step="1"
                      className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-900"
                      value={operationPoints}
                      onChange={(event) => setOperationPoints(event.target.value)}
                      placeholder="0"
                      disabled={operationSaving || Boolean(selectedRechargePlan) || Boolean(selectedRedemptionItem)}
                    />
                  </label>
                  <label className="block text-sm font-medium text-slate-700">
                    {operationDialog.type === "recharge" ? "充值金额" : "扣减余额"}
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-900"
                      value={operationBalance}
                      onChange={(event) => setOperationBalance(event.target.value)}
                      placeholder="0.00"
                      disabled={operationSaving || Boolean(selectedRechargePlan) || Boolean(selectedRedemptionItem)}
                    />
                  </label>
                </div>
                <label className="block text-sm font-medium text-slate-700">
                  备注
                  <textarea
                    className="mt-1 min-h-20 w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-900"
                    value={operationNote}
                    onChange={(event) => setOperationNote(event.target.value)}
                    placeholder={operationDialog.type === "recharge" ? "例如：线下充值" : "例如：兑换礼品"}
                    disabled={operationSaving}
                  />
                </label>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
                <button
                  type="button"
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  onClick={closeMemberOperation}
                  disabled={operationSaving}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={operationSaving}
                >
                  {operationSaving ? "保存中..." : "确认"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
