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
  if (!membership) return "散";
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
  return trimText(item.name, 2) || trimText(item.code, 2) || "兑";
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

  return (
    <section className={`min-h-[calc(100vh-120px)] bg-slate-50 p-0 text-slate-950 ${className}`}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-normal text-slate-950">积分兑换工作台</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span>{formatDateYmd()}</span>
            <span>{siteName || normalizedSiteId}</span>
            {loading ? <span>正在刷新...</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold" onClick={loadData}>
            刷新
          </button>
        </div>
      </div>

      {error ? (
        <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
          {notice}
        </div>
      ) : null}

      <div className="grid min-h-[720px] grid-cols-[minmax(620px,1fr)_500px] gap-4">
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 p-4">
            <div className="min-w-[240px]">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-base font-bold text-white">
                  {getAvatarInitial(selectedMember)}
                </div>
                <div>
                  <div className="text-sm text-slate-500">{selectedMember ? "当前会员" : "散客"}</div>
                  <div className="text-base font-bold text-slate-950">
                    {selectedMember ? getMemberDisplayName(selectedMember) : "请先选择会员"}
                  </div>
                  {selectedMember ? (
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                      <span>卡号：{selectedMember.memberNo}</span>
                      <span>积分：{formatPoints(selectedInsight.pointBalance)}</span>
                      <span>余额：€{formatMoney(selectedInsight.balanceAmount)}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex flex-1 flex-wrap items-start justify-end gap-2">
              <div className="relative min-w-[260px] flex-1">
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
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-teal-700"
                  placeholder="会员手机号 / 卡号 / 昵称 / 邮箱"
                />
                {memberPickerOpen && filteredMembers.length ? (
                  <div className="absolute left-0 top-12 z-20 max-h-80 w-full overflow-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
                    {filteredMembers.map((membership) => (
                      <button
                        key={membership.id}
                        type="button"
                        className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectMember(membership)}
                      >
                        <span>
                          <span className="block font-semibold text-slate-950">{getMemberDisplayName(membership)}</span>
                          <span className="block text-xs text-slate-500">
                            {membership.phone || "-"} / {membership.memberNo}
                          </span>
                        </span>
                        <span className="text-xs font-semibold text-teal-700">{formatPoints(membership.pointBalance)} 积分</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <button type="button" className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold" onClick={lookupMember}>
                选择会员
              </button>
              {selectedMember ? (
                <button type="button" className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold" onClick={clearMember}>
                  清除
                </button>
              ) : null}
            </div>
          </div>

          <div className="p-4">
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div className="grid grid-cols-[110px_minmax(220px,1fr)_120px_150px_120px_150px_72px] bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
                <span>编号</span>
                <span>产品/项目</span>
                <span className="text-right">单价</span>
                <span className="text-center">数量</span>
                <span className="text-right">小计</span>
                <span>备注</span>
                <span className="text-right">操作</span>
              </div>
              <div className="min-h-[370px]">
                {cartRows.length ? (
                  cartRows.map((row, index) => (
                    <div
                      key={`${row.item.id}-${index}`}
                      className="grid grid-cols-[110px_minmax(220px,1fr)_120px_150px_120px_150px_72px] items-center gap-0 border-t border-slate-100 px-4 py-3 text-sm"
                    >
                      <span className="truncate font-mono text-xs text-slate-500">{row.item.code || row.item.id}</span>
                      <span>
                        <strong className="block text-slate-950">{row.item.name}</strong>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {categoryName(enabledCategories, row.item.categoryId)} / {stockLabel(row.item)}
                        </span>
                      </span>
                      <span className="text-right font-semibold">{formatPoints(row.unitPoints)}</span>
                      <span className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          className="h-8 w-8 rounded-lg border border-slate-200 bg-white text-base font-bold"
                          onClick={() => changeQuantity(index, row.quantity - 1)}
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min={1}
                          value={row.quantity}
                          onChange={(event) => changeQuantity(index, Number(event.target.value))}
                          className="h-8 w-14 rounded-lg border border-slate-200 text-center text-sm outline-none focus:border-teal-700"
                        />
                        <button
                          type="button"
                          className="h-8 w-8 rounded-lg border border-slate-200 bg-white text-base font-bold"
                          onClick={() => changeQuantity(index, row.quantity + 1)}
                        >
                          +
                        </button>
                      </span>
                      <span className="text-right font-semibold">{formatPoints(row.subtotalPoints)}</span>
                      <input
                        value={row.nickname}
                        onChange={(event) => changeNickname(index, event.target.value)}
                        className="h-9 rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-teal-700"
                        placeholder="备注"
                      />
                      <span className="text-right">
                        <button
                          type="button"
                          className="rounded-lg border border-rose-200 px-3 py-1.5 text-sm font-semibold text-rose-600"
                          onClick={() => removeCartItem(index)}
                        >
                          删除
                        </button>
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="flex min-h-[370px] flex-col items-center justify-center text-sm text-slate-500">
                    <div className="mb-4 h-20 w-20 rounded-3xl bg-slate-100" />
                    <div>请从右侧选择兑换项目</div>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <div className="relative flex items-center gap-2">
                <button type="button" className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold" onClick={holdCurrentSale}>
                  挂单
                </button>
                <button
                  type="button"
                  className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold"
                  onClick={() => setHeldOpen((open) => !open)}
                >
                  提单
                  {heldSales.length ? (
                    <span className="ml-2 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-bold text-teal-700">
                      {heldSales.length}
                    </span>
                  ) : null}
                </button>
                {heldOpen ? (
                  <div className="absolute bottom-12 left-0 z-20 w-96 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
                    <div className="mb-2 text-sm font-bold text-slate-950">挂单列表</div>
                    {heldSales.length ? (
                      <div className="grid max-h-72 gap-2 overflow-auto">
                        {heldSales.map((sale) => (
                          <button
                            key={sale.id}
                            type="button"
                            className="rounded-xl border border-slate-100 px-3 py-2 text-left text-sm hover:bg-slate-50"
                            onClick={() => restoreHeldSale(sale)}
                          >
                            <strong className="block text-slate-950">{sale.title}</strong>
                            <span className="mt-0.5 block text-xs text-slate-500">{sale.createdAt}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-slate-500">暂无挂单。</div>
                    )}
                  </div>
                ) : null}
              </div>

              <div className="ml-auto flex flex-wrap items-end justify-end gap-8">
                <div className="text-center">
                  <div className="text-xs text-slate-500">项目</div>
                  <div className="text-xl font-bold text-slate-950">{totalQuantity}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-slate-500">参考金额</div>
                  <div className="text-xl font-bold text-slate-950">€{formatMoney(totalReferenceAmount)}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-slate-500">会员积分</div>
                  <div className="text-xl font-bold text-slate-950">{formatPoints(selectedInsight.pointBalance)}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-slate-500">合计积分</div>
                  <div className="text-4xl font-bold text-teal-700">{formatPoints(totalPoints)}</div>
                </div>
                <button
                  type="button"
                  className="h-12 rounded-xl bg-teal-700 px-7 text-base font-bold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                  disabled={!canCheckout}
                  onClick={submitCheckout}
                >
                  {saving ? "结算中" : "结账"}
                </button>
              </div>
            </div>

            <div className="mt-4">
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-teal-700"
                placeholder="兑换备注，例如：前台积分兑换"
              />
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                value={itemKeyword}
                onChange={(event) => setItemKeyword(event.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 pl-9 text-sm outline-none transition focus:border-teal-700"
                placeholder="商品编号 / 门票码 / 订单码 / 名称"
              />
              <span className="pointer-events-none absolute left-3 top-2.5 text-sm text-slate-400">⌕</span>
            </div>
            <button
              type="button"
              className={`h-11 w-11 rounded-xl border text-sm font-bold ${
                viewMode === "image" ? "border-teal-200 bg-teal-50 text-teal-700" : "border-slate-200 bg-white text-slate-600"
              }`}
              onClick={() => setViewMode("image")}
              title="图片模式"
            >
              图
            </button>
            <button
              type="button"
              className={`h-11 w-11 rounded-xl border text-sm font-bold ${
                viewMode === "text" ? "border-teal-200 bg-teal-50 text-teal-700" : "border-slate-200 bg-white text-slate-600"
              }`}
              onClick={() => setViewMode("text")}
              title="列表模式"
            >
              列
            </button>
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
            <button
              type="button"
              className={`shrink-0 rounded-xl border px-4 py-2 text-sm font-semibold ${
                !categoryId ? "border-teal-300 bg-teal-50 text-teal-800" : "border-slate-200 bg-white text-slate-700"
              }`}
              onClick={() => setCategoryId("")}
            >
              全部
            </button>
            {enabledCategories.map((category) => (
              <button
                key={category.id}
                type="button"
                className={`shrink-0 rounded-xl border px-4 py-2 text-sm font-semibold ${
                  categoryId === category.id
                    ? "border-teal-300 bg-teal-50 text-teal-800"
                    : "border-slate-200 bg-white text-slate-700"
                }`}
                onClick={() => setCategoryId(category.id)}
              >
                {category.name}
              </button>
            ))}
          </div>

          <div className={viewMode === "image" ? "mt-4 grid grid-cols-3 gap-3" : "mt-4 grid gap-2"}>
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
                      className="grid grid-cols-[110px_minmax(0,1fr)_90px_90px] items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm transition hover:border-teal-200 hover:bg-teal-50 disabled:opacity-50"
                      disabled={outOfStock}
                      onClick={() => addToCart(item)}
                    >
                      <span className="truncate font-mono text-xs text-slate-500">{item.code || item.id}</span>
                      <strong className="truncate text-slate-950">{item.name}</strong>
                      <span className="text-right font-bold text-teal-700">{formatPoints(unitPoints)}</span>
                      <span className="text-right text-xs text-slate-500">{stockLabel(item)}</span>
                    </button>
                  );
                }
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="group min-h-44 rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-teal-200 hover:bg-teal-50 disabled:opacity-50"
                    disabled={outOfStock}
                    onClick={() => addToCart(item)}
                  >
                    <div className="flex h-24 items-center justify-center rounded-xl bg-gradient-to-br from-teal-50 via-slate-100 to-slate-200 text-3xl font-bold text-teal-800">
                      {productInitial(item)}
                    </div>
                    <div className="mt-3 flex items-start justify-between gap-2">
                      <strong className="line-clamp-2 text-sm text-slate-950">{item.name}</strong>
                      <span className="shrink-0 text-base font-bold text-teal-700">{formatPoints(unitPoints)}</span>
                    </div>
                    <div className="mt-1 truncate text-xs text-slate-500">{item.code || categoryName(enabledCategories, item.categoryId)}</div>
                    <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                      <span>{stockLabel(item)}</span>
                      {inCartQuantity ? <span>已选 {inCartQuantity}</span> : null}
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="col-span-3 rounded-2xl border border-dashed border-slate-200 px-4 py-12 text-center text-sm text-slate-500">
                暂无匹配项目。请在会员管理的兑换项目中添加并启用。
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
