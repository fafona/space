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
};

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

function getMemberDisplayName(membership: MerchantMembershipListItem) {
  if (!membership.profileVisible) return "已退会会员";
  return membership.nickname || membership.name || membership.email || membership.accountId || membership.memberNo;
}

function getAvatarInitial(membership: MerchantMembershipListItem) {
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

function inputClassName(extra = "") {
  return `h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-900 ${extra}`;
}

function buttonClassName(active = false) {
  return `rounded-xl border px-3 py-2 text-sm font-semibold transition ${
    active ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
  }`;
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
    if (!keyword) return activeMembers.slice(0, 20);
    return activeMembers.filter((membership) => buildMemberSearchText(membership).includes(keyword)).slice(0, 40);
  }, [activeMembers, memberKeyword]);
  const selectedMember = useMemo(
    () => activeMembers.find((membership) => membership.id === selectedMemberId) ?? null,
    [activeMembers, selectedMemberId],
  );
  const selectedInsight = selectedMember?.insight ?? EMPTY_MEMBER_INSIGHT;
  const cartQuantityByItemId = useMemo(() => {
    const quantities = new Map<string, number>();
    cart.forEach((line) => quantities.set(line.itemId, (quantities.get(line.itemId) ?? 0) + line.quantity));
    return quantities;
  }, [cart]);
  const filteredItems = useMemo(() => {
    const keyword = itemKeyword.trim().toLowerCase();
    return enabledItems.filter((item) => {
      if (categoryId && item.categoryId !== categoryId) return false;
      if (!keyword) return true;
      return [item.code, item.name, item.description].join(" ").toLowerCase().includes(keyword);
    });
  }, [categoryId, enabledItems, itemKeyword]);
  const cartRows = useMemo(() => {
    return cart
      .map((line) => {
        const item = enabledItems.find((entry) => entry.id === line.itemId);
        if (!item) return null;
        const unitPoints = getRedemptionPointCostForMember(item, selectedMember, settings);
        return {
          item,
          quantity: line.quantity,
          unitPoints,
          subtotalPoints: unitPoints * line.quantity,
        };
      })
      .filter((row): row is { item: MerchantMemberRedemptionItem; quantity: number; unitPoints: number; subtotalPoints: number } =>
        Boolean(row),
      );
  }, [cart, enabledItems, selectedMember, settings]);
  const totalPoints = cartRows.reduce((sum, row) => sum + row.subtotalPoints, 0);
  const canCheckout = Boolean(selectedMember) && cartRows.length > 0 && totalPoints > 0 && totalPoints <= selectedInsight.pointBalance && !saving;

  const categoryName = useCallback(
    (id: string) => enabledCategories.find((category) => category.id === id)?.name || "未分类",
    [enabledCategories],
  );

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
      if (!membersResponse.ok || membersPayload?.ok !== true) {
        throw new Error(readPayloadMessage(membersPayload?.message, "会员列表加载失败，请稍后重试"));
      }
      const settingsPayload = (await settingsResponse.json().catch(() => null)) as MembershipSettingsPayload | null;
      if (!settingsResponse.ok || settingsPayload?.ok !== true || !settingsPayload.settings) {
        throw new Error(readPayloadMessage(settingsPayload?.message, "兑换项目加载失败，请先检查会员配置"));
      }
      const nextMemberships = Array.isArray(membersPayload.memberships) ? membersPayload.memberships : [];
      setMemberships(nextMemberships);
      setSettings(settingsPayload.settings);
      setSelectedMemberId((current) => {
        if (current && nextMemberships.some((membership) => membership.id === current && membership.status === "active")) return current;
        return nextMemberships.find((membership) => membership.profileVisible && membership.status === "active")?.id ?? "";
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "积分兑换数据加载失败，请稍后重试");
      setMemberships([]);
      setSettings(null);
    } finally {
      setLoading(false);
    }
  }, [normalizedSiteId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  function addItemToCart(item: MerchantMemberRedemptionItem) {
    setNotice("");
    setError("");
    setCart((current) => {
      const currentQuantity = current.find((line) => line.itemId === item.id)?.quantity ?? 0;
      if (item.stock > 0 && currentQuantity >= item.stock) {
        setError(`${item.name} 库存不足。`);
        return current;
      }
      if (currentQuantity > 0) {
        return current.map((line) => (line.itemId === item.id ? { ...line, quantity: line.quantity + 1 } : line));
      }
      return [...current, { itemId: item.id, quantity: 1 }];
    });
  }

  function updateCartQuantity(item: MerchantMemberRedemptionItem, quantity: number) {
    const nextQuantity = Math.max(1, Math.round(quantity || 1));
    setCart((current) =>
      current.map((line) =>
        line.itemId === item.id ? { ...line, quantity: item.stock > 0 ? Math.min(nextQuantity, item.stock) : nextQuantity } : line,
      ),
    );
  }

  function removeCartItem(itemId: string) {
    setCart((current) => current.filter((line) => line.itemId !== itemId));
  }

  function readOperationErrorMessage(value: unknown, fallback: string) {
    const message = trimText(value);
    if (message === "membership_balance_insufficient") return "会员积分不足，不能兑换。";
    if (message === "membership_redemption_stock_insufficient") return "兑换项目库存不足。";
    if (message === "membership_operation_empty") return "请选择兑换项目。";
    if (message === "membership_not_active") return "该会员不是正常状态，不能兑换。";
    if (message === "membership_redemption_item_not_found") return "兑换项目不存在或已停用。";
    if (message === "membership_settings_unavailable") return "会员兑换配置不可用。";
    return message || fallback;
  }

  async function submitCheckout() {
    if (!selectedMember || saving) return;
    if (cartRows.length === 0) {
      setError("请先选择兑换项目。");
      return;
    }
    if (totalPoints > selectedInsight.pointBalance) {
      setError("会员积分不足，不能兑换。");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/memberships", {
        method: "PATCH",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          action: "member_redemption_checkout",
          siteId: normalizedSiteId,
          membershipId: selectedMember.id,
          redemptionItems: cartRows.map((row) => ({ redemptionItemId: row.item.id, quantity: row.quantity })),
          note,
        }),
      });
      const payload = (await response.json().catch(() => null)) as MembershipPatchPayload | null;
      if (!response.ok || payload?.ok !== true || !payload.membership) {
        throw new Error(readOperationErrorMessage(payload?.message, "积分兑换失败，请稍后重试"));
      }
      setMemberships((current) =>
        current.map((membership) => {
          if (membership.id !== selectedMember.id || !payload.membership) return membership;
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
      setCart([]);
      setNote("");
      setNotice(`兑换完成，已扣减 ${totalPoints} 积分。`);
      void loadData();
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "积分兑换失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={`space-y-4 py-6 ${className}`}>
      <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_12px_32px_rgba(15,23,42,0.05)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">积分兑换</h2>
            <p className="mt-1 text-sm text-slate-500">
              {siteName || normalizedSiteId} · 选择会员和兑换项目后，直接扣减会员积分并同步库存。
            </p>
          </div>
          <button
            type="button"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            onClick={() => void loadData()}
            disabled={loading || saving}
          >
            {loading ? "刷新中..." : "刷新"}
          </button>
        </div>
        {error ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
        {notice ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div> : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
        <div className="space-y-4">
          <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_12px_32px_rgba(15,23,42,0.05)]">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-slate-950">会员</h3>
              <div className="text-xs text-slate-500">可兑换会员 {activeMembers.length}</div>
            </div>
            <input
              className={`mt-3 ${inputClassName()}`}
              value={memberKeyword}
              onChange={(event) => setMemberKeyword(event.target.value)}
              placeholder="会员手机号 / 会员卡号 / 昵称 / 邮箱"
            />
            <div className="mt-3 grid max-h-72 gap-2 overflow-y-auto pr-1">
              {filteredMembers.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-500">
                  没有匹配的正常会员。
                </div>
              ) : (
                filteredMembers.map((membership) => {
                  const selected = selectedMember?.id === membership.id;
                  const insight = membership.insight ?? EMPTY_MEMBER_INSIGHT;
                  const displayName = getMemberDisplayName(membership);
                  return (
                    <button
                      key={membership.id}
                      type="button"
                      className={`flex items-center gap-3 rounded-2xl border px-3 py-2 text-left transition ${
                        selected ? "border-slate-950 bg-slate-50" : "border-slate-200 bg-white hover:border-slate-300"
                      }`}
                      onClick={() => {
                        setSelectedMemberId(membership.id);
                        setNotice("");
                        setError("");
                      }}
                    >
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-950 bg-cover bg-center text-sm font-semibold text-white"
                        style={membership.avatarUrl ? { backgroundImage: `url(${membership.avatarUrl})` } : undefined}
                        aria-label={displayName}
                      >
                        {membership.avatarUrl ? null : getAvatarInitial(membership)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-slate-950">{displayName}</span>
                        <span className="block truncate font-mono text-xs text-slate-500">{membership.memberNo}</span>
                      </span>
                      <span className="text-right">
                        <span className="block text-xs text-slate-400">积分</span>
                        <span className="block text-sm font-semibold text-slate-950">{insight.pointBalance}</span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_12px_32px_rgba(15,23,42,0.05)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-950">当前兑换</h3>
                {selectedMember ? (
                  <div className="mt-1 text-sm text-slate-500">
                    {getMemberDisplayName(selectedMember)} · 可用积分 {selectedInsight.pointBalance}
                  </div>
                ) : (
                  <div className="mt-1 text-sm text-slate-500">请先选择会员。</div>
                )}
              </div>
              <button
                type="button"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                onClick={() => setCart([])}
                disabled={cartRows.length === 0 || saving}
              >
                清空
              </button>
            </div>
            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2">项目</th>
                    <th className="px-3 py-2">单价</th>
                    <th className="px-3 py-2">数量</th>
                    <th className="px-3 py-2">小计</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {cartRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-sm text-slate-500">
                        从右侧选择兑换项目。
                      </td>
                    </tr>
                  ) : (
                    cartRows.map((row) => (
                      <tr key={row.item.id} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          <div className="font-semibold text-slate-950">{row.item.name}</div>
                          <div className="font-mono text-xs text-slate-500">{row.item.code || "-"}</div>
                        </td>
                        <td className="px-3 py-2 font-semibold text-slate-700">{row.unitPoints}</td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="1"
                            step="1"
                            className="h-9 w-20 rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-slate-900"
                            value={row.quantity}
                            onChange={(event) => updateCartQuantity(row.item, Number.parseInt(event.target.value, 10) || 1)}
                            disabled={saving}
                          />
                        </td>
                        <td className="px-3 py-2 font-semibold text-slate-950">{row.subtotalPoints}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            className="rounded-lg border border-rose-200 bg-white px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                            onClick={() => removeCartItem(row.item.id)}
                            disabled={saving}
                          >
                            删除
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <label className="mt-4 block text-sm font-medium text-slate-700">
              备注
              <textarea
                className="mt-1 min-h-20 w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-900"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="例如：前台积分兑换"
                disabled={saving}
              />
            </label>
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-slate-600">应扣积分</span>
                <span className="text-3xl font-semibold text-slate-950">{totalPoints}</span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-500">兑换后剩余</span>
                <span className={totalPoints > selectedInsight.pointBalance ? "font-semibold text-rose-600" : "font-semibold text-slate-800"}>
                  {selectedMember ? selectedInsight.pointBalance - totalPoints : "-"}
                </span>
              </div>
              <button
                type="button"
                className="mt-4 h-12 w-full rounded-xl bg-slate-950 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => void submitCheckout()}
                disabled={!canCheckout}
              >
                {saving ? "兑换中..." : "确认兑换"}
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_12px_32px_rgba(15,23,42,0.05)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-950">兑换项目</h3>
              <div className="mt-1 text-sm text-slate-500">读取会员管理里的已启用兑换项目。</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
              {enabledItems.length} 项
            </div>
          </div>
          <input
            className={`mt-4 ${inputClassName()}`}
            value={itemKeyword}
            onChange={(event) => setItemKeyword(event.target.value)}
            placeholder="项目编号 / 名称 / 描述"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={buttonClassName(!categoryId)} onClick={() => setCategoryId("")}>
              全部
            </button>
            {enabledCategories.map((category: MerchantMemberRedemptionCategory) => (
              <button
                key={category.id}
                type="button"
                className={buttonClassName(categoryId === category.id)}
                onClick={() => setCategoryId(category.id)}
              >
                {category.name}
              </button>
            ))}
          </div>
          <div className="mt-4 grid max-h-[calc(100vh-18rem)] gap-3 overflow-y-auto pr-1 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            {filteredItems.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 px-3 py-8 text-center text-sm text-slate-500 md:col-span-2 xl:col-span-1 2xl:col-span-2">
                还没有匹配的兑换项目。
              </div>
            ) : (
              filteredItems.map((item) => {
                const cartQuantity = cartQuantityByItemId.get(item.id) ?? 0;
                const stockLeft = item.stock > 0 ? Math.max(0, item.stock - cartQuantity) : null;
                const unitPoints = getRedemptionPointCostForMember(item, selectedMember, settings);
                const disabled = saving || (item.stock > 0 && stockLeft === 0);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="rounded-2xl border border-slate-200 bg-white p-3 text-left transition hover:border-slate-300 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => addItemToCart(item)}
                    disabled={disabled}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-950">{item.name}</div>
                        <div className="mt-1 font-mono text-xs text-slate-500">{item.code || "-"}</div>
                      </div>
                      <div className="shrink-0 rounded-xl bg-slate-950 px-2 py-1 text-xs font-semibold text-white">
                        {unitPoints} 积分
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="rounded-full bg-slate-100 px-2 py-1">{categoryName(item.categoryId)}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-1">库存 {stockLeft === null ? "不限" : stockLeft}</span>
                      {unitPoints !== item.pointsCost ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">原 {item.pointsCost}</span>
                      ) : null}
                    </div>
                    {item.description ? <div className="mt-3 line-clamp-2 text-xs leading-5 text-slate-500">{item.description}</div> : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
