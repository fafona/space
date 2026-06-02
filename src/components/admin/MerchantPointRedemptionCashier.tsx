"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

type MembershipPatchPayload = {
  ok?: unknown;
  membership?: MerchantMembershipListItem;
  message?: unknown;
};

type CartLine = {
  itemId: string;
  quantity: number;
  nickname: string;
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

function storageKey(siteId: string) {
  return `faolla.memberPointRedemption.heldSales.${siteId}`;
}

export default function MerchantPointRedemptionCashier({
  siteId,
  siteName = "",
  className = "",
}: MerchantPointRedemptionCashierProps) {
  const normalizedSiteId = siteId.trim();
  const [memberships, setMemberships] = useState<MerchantMembershipListItem[]>([]);
  const [settings, setSettings] = useState<MerchantMembershipSettings | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [memberKeyword, setMemberKeyword] = useState("");
  const [itemKeyword, setItemKeyword] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [note, setNote] = useState("");
  const [viewMode, setViewMode] = useState<ProductViewMode>("image");
  const [heldSales, setHeldSales] = useState<HeldSale[]>([]);
  const [heldOpen, setHeldOpen] = useState(false);
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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

  const filteredItems = useMemo(() => {
    const keyword = itemKeyword.trim().toLowerCase();
    return enabledItems.filter((item) => {
      if (categoryId && item.categoryId !== categoryId) return false;
      if (!keyword) return true;
      return [item.code, item.name, item.description, categoryName(enabledCategories, item.categoryId)]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    });
  }, [categoryId, enabledCategories, enabledItems, itemKeyword]);

  const cartRows = useMemo(() => {
    return cart
      .map((line) => {
        const item = enabledItems.find((entry) => entry.id === line.itemId);
        if (!item) return null;
        const unitPoints = getRedemptionPointCostForMember(item, selectedMember, settings);
        return {
          item,
          quantity: line.quantity,
          nickname: line.nickname,
          unitPoints,
          subtotalPoints: unitPoints * line.quantity,
        };
      })
      .filter(
        (row): row is {
          item: MerchantMemberRedemptionItem;
          quantity: number;
          nickname: string;
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
  const totalReferenceAmount = cartRows.reduce((sum, row) => sum + row.item.referenceAmount * row.quantity, 0);
  const totalQuantity = cartRows.reduce((sum, row) => sum + row.quantity, 0);
  const canCheckout =
    Boolean(selectedMember) &&
    cartRows.length > 0 &&
    totalPoints > 0 &&
    totalPoints <= selectedInsight.pointBalance &&
    !saving;

  const loadData = useCallback(async () => {
    if (!/^\d{8}$/.test(normalizedSiteId)) {
      setError("当前商户资料还没准备好，请稍后重试。");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [membersResponse, settingsResponse] = await Promise.all([
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
      ]);
      const membersPayload = (await membersResponse.json().catch(() => null)) as MembershipsPayload | null;
      const settingsPayload = (await settingsResponse.json().catch(() => null)) as MembershipSettingsPayload | null;
      if (!membersResponse.ok || !membersPayload?.ok) {
        throw new Error(readPayloadMessage(membersPayload?.message, "会员列表加载失败"));
      }
      if (!settingsResponse.ok || !settingsPayload?.ok || !settingsPayload.settings) {
        throw new Error(readPayloadMessage(settingsPayload?.message, "兑换项目加载失败，请先检查会员配置"));
      }
      setMemberships(Array.isArray(membersPayload.memberships) ? membersPayload.memberships : []);
      setSettings(settingsPayload.settings);
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
        return [...current, { itemId: item.id, quantity: 1, nickname: "" }];
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

  function changeNickname(index: number, nickname: string) {
    setCart((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, nickname: nickname.slice(0, 80) } : line)),
    );
  }

  function removeCartItem(index: number) {
    setCart((current) => current.filter((_, lineIndex) => lineIndex !== index));
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
            redemptionItemId: row.item.id,
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
      setNotice(`兑换完成，已扣减 ${formatPoints(totalPoints)} 积分。`);
      await loadData();
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "积分兑换失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  function notifyUnavailable(label: string) {
    setNotice(`积分兑换工作台暂不需要${label}。`);
  }

  return (
    <section className={`merchant-pos-cashier ${className}`}>
      <style>{`
        .merchant-pos-cashier {
          --pos-bg: #f4f6f8;
          --pos-surface: #ffffff;
          --pos-surface-soft: #f8fafc;
          --pos-line: #dfe7ee;
          --pos-line-strong: #b7c5d0;
          --pos-text: #17212b;
          --pos-muted: #657487;
          --pos-primary: #0e7666;
          --pos-primary-dark: #075e53;
          --pos-primary-soft: #e7f6f2;
          --pos-danger: #d92d20;
          --pos-danger-soft: #fff1ef;
          --pos-shadow: 0 1px 2px rgba(20, 28, 38, 0.05), 0 14px 34px rgba(20, 28, 38, 0.08);
          --pos-shadow-soft: 0 1px 2px rgba(20, 28, 38, 0.05), 0 8px 22px rgba(20, 28, 38, 0.055);
          --pos-focus-inset: 0 0 0 3px rgba(14, 118, 102, 0.18) inset;
          min-height: calc(100vh - 120px);
          padding: 0;
          color: var(--pos-text);
          background: var(--pos-bg);
          font-size: 14px;
          line-height: 1.45;
        }

        .merchant-pos-cashier * {
          box-sizing: border-box;
        }

        .merchant-pos-cashier button,
        .merchant-pos-cashier input {
          font: inherit;
          letter-spacing: 0;
        }

        .merchant-pos-cashier button {
          cursor: pointer;
        }

        .merchant-pos-cashier button:disabled {
          cursor: not-allowed;
        }

        .merchant-pos-cashier .cashier-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 16px;
        }

        .merchant-pos-cashier .cashier-title {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .merchant-pos-cashier .cashier-title h2 {
          margin: 0;
          color: var(--pos-text);
          font-size: 28px;
          font-weight: 900;
          line-height: 1.15;
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
          margin-top: 4px;
          color: var(--pos-muted);
          font-size: 14px;
        }

        .merchant-pos-cashier .cashier-actions {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .merchant-pos-cashier .pos-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          min-height: 38px;
          padding: 0 14px;
          border: 1px solid var(--pos-line);
          border-radius: 8px;
          background: var(--pos-surface);
          color: var(--pos-text);
          font-weight: 800;
          box-shadow: 0 1px 1px rgba(20, 28, 38, 0.04);
          transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
        }

        .merchant-pos-cashier .pos-button:hover {
          border-color: var(--pos-primary);
          background: var(--pos-primary-soft);
          color: var(--pos-primary-dark);
          box-shadow: var(--pos-focus-inset);
        }

        .merchant-pos-cashier .pos-button.primary {
          border-color: var(--pos-primary);
          background: var(--pos-primary);
          color: #fff;
        }

        .merchant-pos-cashier .pos-button.primary:hover {
          background: var(--pos-primary-dark);
          color: #fff;
          box-shadow: var(--pos-shadow-soft);
        }

        .merchant-pos-cashier .pos-alert {
          margin-bottom: 12px;
          border-radius: 8px;
          padding: 10px 12px;
          font-weight: 800;
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

        .merchant-pos-cashier .cashier-workbench {
          display: grid;
          grid-template-columns: minmax(660px, 1fr) minmax(460px, 500px);
          gap: 16px;
          align-items: start;
        }

        .merchant-pos-cashier .panel {
          border: 1px solid var(--pos-line);
          border-radius: 8px;
          background: var(--pos-surface);
          box-shadow: var(--pos-shadow);
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
          justify-content: space-between;
          gap: 10px;
          min-width: 0;
          width: 100%;
        }

        .merchant-pos-cashier .member-search {
          position: relative;
          width: min(420px, 45vw);
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
        .merchant-pos-cashier .cart-nickname-input:focus,
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
          grid-template-columns: 120px minmax(190px, 1fr) 96px 190px 110px 130px;
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
          transition: transform 0.16s ease;
        }

        .merchant-pos-cashier .cart-row-shell:hover .cart-row {
          transform: translateX(-84px);
        }

        .merchant-pos-cashier .cart-delete-action {
          position: absolute;
          top: 0;
          right: 0;
          bottom: 0;
          width: 84px;
          border: 0;
          background: var(--pos-danger);
          color: #fff;
          font-weight: 900;
        }

        .merchant-pos-cashier .cart-code,
        .merchant-pos-cashier .cart-name,
        .merchant-pos-cashier .cart-nickname {
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

        .merchant-pos-cashier .cart-nickname-input {
          width: 100%;
          height: 34px;
          border: 1px solid var(--pos-line);
          border-radius: 8px;
          padding: 0 8px;
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

        .merchant-pos-cashier .product-view-toggle {
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
          font-weight: 900;
        }

        .merchant-pos-cashier .view-mode-button:hover,
        .merchant-pos-cashier .view-mode-button.active {
          background: var(--pos-surface);
          color: var(--pos-primary-dark);
          box-shadow: 0 0 0 1px var(--pos-line) inset;
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
          font-weight: 800;
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
          display: grid;
          place-items: center;
          width: 16px;
          height: 16px;
          border: 1px solid currentColor;
          border-radius: 4px;
          font-size: 10px;
          line-height: 1;
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
        }
      `}</style>

      <div className="cashier-header">
        <div>
          <div className="cashier-title">
            <h2>积分兑换工作台</h2>
          </div>
          <div className="cashier-refresh-line">
            <span>{formatDateYmd()}</span>
            <button type="button" className="pos-button" onClick={loadData}>
              刷新
            </button>
            <span>{siteName || normalizedSiteId}</span>
            {loading ? <span>正在刷新...</span> : null}
          </div>
        </div>
        <div className="cashier-actions">
          <button type="button" className="pos-button" onClick={() => notifyUnavailable("开钱箱")}>
            开钱箱
          </button>
          <button type="button" className="pos-button" onClick={() => notifyUnavailable("存取现金")}>
            存取现金
          </button>
        </div>
      </div>

      {error ? <div className="pos-alert error">{error}</div> : null}
      {notice ? <div className="pos-alert notice">{notice}</div> : null}

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
                <button type="button" className="pos-button" onClick={lookupMember}>
                  选择会员
                </button>
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
                <button type="button" className="pos-button" onClick={() => notifyUnavailable("绑定手机")}>
                  绑定手机
                </button>
                <button type="button" className="pos-button primary" onClick={() => setNotice("请从右侧选择兑换项目。")}>
                  兑换项目
                </button>
                <button type="button" className="pos-button" onClick={() => notifyUnavailable("临时项目")}>
                  临时项目
                </button>
              </div>
            </div>
          </div>

          <div className="cart-area">
            <div className="cart-table">
              <div className="cart-header">
                <span>编号</span>
                <span>产品/项目</span>
                <span>单价</span>
                <span>数量</span>
                <span>小计</span>
                <span>昵称</span>
              </div>
              <div className="cart-body">
                {cartRows.length ? (
                  cartRows.map((row, index) => (
                    <div key={`${row.item.id}-${index}`} className="cart-row-shell">
                      <div className="cart-row">
                        <span className="cart-code">{row.item.code || row.item.id}</span>
                        <strong className="cart-name">
                          {row.item.name}
                          <span className="cart-meta">
                            {categoryName(enabledCategories, row.item.categoryId)} / {stockLabel(row.item)}
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
                        <input
                          value={row.nickname}
                          onChange={(event) => changeNickname(index, event.target.value)}
                          className="cart-nickname-input"
                          placeholder="-"
                        />
                      </div>
                      <button type="button" className="cart-delete-action" onClick={() => removeCartItem(index)}>
                        删除
                      </button>
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
                <button type="button" className="pos-button" onClick={holdCurrentSale}>
                  挂单
                </button>
                <button type="button" className="pos-button" onClick={() => setHeldOpen((open) => !open)}>
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
                <span>参考金额</span>
                <strong>{formatMoney(totalReferenceAmount)}</strong>
              </div>
              <div className="summary-item">
                <span>会员积分</span>
                <strong>{formatPoints(selectedInsight.pointBalance)}</strong>
              </div>
              <div className="summary-total">
                <span>合计积分</span>
                <strong>{formatPoints(totalPoints)}</strong>
              </div>
              <button type="button" className="checkout-button" disabled={!canCheckout} onClick={submitCheckout}>
                {saving ? "结算中" : "结账"}
              </button>
            </div>
          </div>
        </section>

        <section className="panel catalog-panel">
          <div className="catalog-toolbar">
            <div className="product-search-wrap">
              <span className="product-search-prefix">⌕</span>
              <input
                value={itemKeyword}
                onChange={(event) => setItemKeyword(event.target.value)}
                className="product-search-input"
                placeholder="商品条码 / 门票码 / 订单码 / 名称"
              />
            </div>
            <div className="product-view-toggle">
              <button
                type="button"
                className={`view-mode-button ${viewMode === "image" ? "active" : ""}`}
                onClick={() => setViewMode("image")}
                title="图片模式"
              >
                图
              </button>
              <button
                type="button"
                className={`view-mode-button ${viewMode === "text" ? "active" : ""}`}
                onClick={() => setViewMode("text")}
                title="列表模式"
              >
                列
              </button>
            </div>
          </div>

          <div className="category-row">
            <button
              type="button"
              className={`category-chip ${!categoryId ? "active" : ""}`}
              onClick={() => setCategoryId("")}
            >
              <span className="category-button-icon">全</span>
              <span>全部</span>
            </button>
            {enabledCategories.map((category) => (
              <button
                key={category.id}
                type="button"
                className={`category-chip ${categoryId === category.id ? "active" : ""}`}
                onClick={() => setCategoryId(category.id)}
              >
                <span className="category-button-icon">{trimText(category.name, 1) || "类"}</span>
                <span>{category.name}</span>
              </button>
            ))}
          </div>

          <div className={`catalog-products ${viewMode === "image" ? "goods-grid" : "goods-list"}`}>
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
                      <span>{productInitial(item)}</span>
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
      </section>
    </section>
  );
}
