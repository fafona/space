"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  createEmptyMerchantMembershipSettings,
  createMerchantMemberSettingsId,
  normalizeMerchantMembershipSettings,
  type MerchantMemberSettingsView,
  type MerchantMembershipSettings,
} from "@/lib/merchantMembershipSettings";

type MerchantMembershipSettingsPanelProps = {
  siteId: string;
  view: Exclude<MerchantMemberSettingsView, "list">;
  className?: string;
};

type MembershipSettingsPayload = {
  ok?: unknown;
  settings?: MerchantMembershipSettings;
  message?: unknown;
};

const VIEW_TITLES: Record<Exclude<MerchantMemberSettingsView, "list">, string> = {
  rechargePlans: "充值方案",
  redemptionItems: "兑换项目",
  levels: "等级&权益",
  pointsRules: "积分规则",
};

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function readPayloadMessage(value: unknown, fallback: string) {
  return trimText(value, 1000) || fallback;
}

function toNumberInputValue(value: number | null | undefined) {
  const normalized = Number(value ?? 0);
  return Number.isFinite(normalized) ? String(normalized) : "0";
}

function parseMoney(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.max(0, Number(parsed.toFixed(2))) : 0;
}

function parseInteger(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block text-sm font-medium text-slate-700 ${className}`}>
      <span>{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function inputClassName(extra = "") {
  return `h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-900 ${extra}`;
}

function textareaClassName(extra = "") {
  return `min-h-20 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900 ${extra}`;
}

function SectionCard({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.04)]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-slate-950">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function MerchantMembershipSettingsPanel({
  siteId,
  view,
  className = "",
}: MerchantMembershipSettingsPanelProps) {
  const normalizedSiteId = siteId.trim();
  const [settings, setSettings] = useState<MerchantMembershipSettings>(() =>
    createEmptyMerchantMembershipSettings(normalizedSiteId),
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const activeSettings = useMemo(
    () => normalizeMerchantMembershipSettings(normalizedSiteId, settings),
    [normalizedSiteId, settings],
  );

  function patchSettings(recipe: (current: MerchantMembershipSettings) => MerchantMembershipSettings) {
    setSettings((current) => normalizeMerchantMembershipSettings(normalizedSiteId, recipe(current)));
    setNotice("");
  }

  async function loadSettings() {
    if (!/^\d{8}$/.test(normalizedSiteId)) {
      setSettings(createEmptyMerchantMembershipSettings(normalizedSiteId));
      setError("当前商户资料还没准备好，请稍后重试。");
      return;
    }
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/membership-settings?siteId=${encodeURIComponent(normalizedSiteId)}`, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      const payload = (await response.json().catch(() => null)) as MembershipSettingsPayload | null;
      if (!response.ok || payload?.ok !== true || !payload.settings) {
        throw new Error(readPayloadMessage(payload?.message, "会员配置加载失败，请稍后重试"));
      }
      setSettings(normalizeMerchantMembershipSettings(normalizedSiteId, payload.settings));
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "会员配置加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings() {
    if (saving) return;
    if (!/^\d{8}$/.test(normalizedSiteId)) {
      setError("当前商户资料还没准备好，请稍后重试。");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const normalized = normalizeMerchantMembershipSettings(normalizedSiteId, activeSettings);
      const response = await fetch("/api/membership-settings", {
        method: "PUT",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ siteId: normalizedSiteId, settings: normalized }),
      });
      const payload = (await response.json().catch(() => null)) as MembershipSettingsPayload | null;
      if (!response.ok || payload?.ok !== true || !payload.settings) {
        throw new Error(readPayloadMessage(payload?.message, "会员配置保存失败，请稍后重试"));
      }
      setSettings(normalizeMerchantMembershipSettings(normalizedSiteId, payload.settings));
      setNotice("已保存。");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "会员配置保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    void loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedSiteId]);

  const renderRechargePlans = () => (
    <SectionCard
      title="充值方案"
      action={
        <button
          type="button"
          className="rounded-xl border border-slate-900 bg-white px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-slate-50"
          onClick={() =>
            patchSettings((current) => ({
              ...current,
              rechargePlans: [
                ...current.rechargePlans,
                {
                  id: createMerchantMemberSettingsId("recharge"),
                  title: `充值方案 ${current.rechargePlans.length + 1}`,
                  enabled: true,
                  rechargeAmount: 0,
                  giftAmount: 0,
                  giftPoints: 0,
                  sort: current.rechargePlans.length,
                },
              ],
            }))
          }
        >
          新增方案
        </button>
      }
    >
      <div className="space-y-3">
        {activeSettings.rechargePlans.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            还没有充值方案。
          </div>
        ) : (
          activeSettings.rechargePlans.map((plan, index) => (
            <div key={plan.id} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
              <div className="grid gap-3 lg:grid-cols-[minmax(180px,1.4fr)_repeat(3,minmax(120px,1fr))_auto]">
                <Field label="方案名称">
                  <input
                    className={inputClassName()}
                    value={plan.title}
                    onChange={(event) =>
                      patchSettings((current) => ({
                        ...current,
                        rechargePlans: current.rechargePlans.map((item) =>
                          item.id === plan.id ? { ...item, title: event.target.value } : item,
                        ),
                      }))
                    }
                  />
                </Field>
                <Field label="充值金额">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className={inputClassName()}
                    value={toNumberInputValue(plan.rechargeAmount)}
                    onChange={(event) =>
                      patchSettings((current) => ({
                        ...current,
                        rechargePlans: current.rechargePlans.map((item) =>
                          item.id === plan.id ? { ...item, rechargeAmount: parseMoney(event.target.value) } : item,
                        ),
                      }))
                    }
                  />
                </Field>
                <Field label="赠送金额">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className={inputClassName()}
                    value={toNumberInputValue(plan.giftAmount)}
                    onChange={(event) =>
                      patchSettings((current) => ({
                        ...current,
                        rechargePlans: current.rechargePlans.map((item) =>
                          item.id === plan.id ? { ...item, giftAmount: parseMoney(event.target.value) } : item,
                        ),
                      }))
                    }
                  />
                </Field>
                <Field label="赠送积分">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className={inputClassName()}
                    value={toNumberInputValue(plan.giftPoints)}
                    onChange={(event) =>
                      patchSettings((current) => ({
                        ...current,
                        rechargePlans: current.rechargePlans.map((item) =>
                          item.id === plan.id ? { ...item, giftPoints: parseInteger(event.target.value) } : item,
                        ),
                      }))
                    }
                  />
                </Field>
                <div className="flex items-end gap-2">
                  <label className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={plan.enabled}
                      onChange={(event) =>
                        patchSettings((current) => ({
                          ...current,
                          rechargePlans: current.rechargePlans.map((item) =>
                            item.id === plan.id ? { ...item, enabled: event.target.checked } : item,
                          ),
                        }))
                      }
                    />
                    启用
                  </label>
                  <button
                    type="button"
                    className="h-10 rounded-xl border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-600 hover:bg-rose-50"
                    onClick={() =>
                      patchSettings((current) => ({
                        ...current,
                        rechargePlans: current.rechargePlans
                          .filter((item) => item.id !== plan.id)
                          .map((item, itemIndex) => ({ ...item, sort: itemIndex })),
                      }))
                    }
                  >
                    删除
                  </button>
                </div>
              </div>
              <div className="mt-2 text-xs text-slate-500">方案 {index + 1} 会在会员充值弹窗中可选。</div>
            </div>
          ))
        )}
      </div>
    </SectionCard>
  );

  const renderRedemptionItems = () => (
    <div className="space-y-4">
      <SectionCard
        title="项目分类"
        action={
          <button
            type="button"
            className="rounded-xl border border-slate-900 bg-white px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-slate-50"
            onClick={() =>
              patchSettings((current) => ({
                ...current,
                redemptionCategories: [
                  ...current.redemptionCategories,
                  {
                    id: createMerchantMemberSettingsId("category"),
                    name: `分类 ${current.redemptionCategories.length + 1}`,
                    enabled: true,
                    sort: current.redemptionCategories.length,
                  },
                ],
              }))
            }
          >
            新增分类
          </button>
        }
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {activeSettings.redemptionCategories.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 md:col-span-2 xl:col-span-3">
              还没有分类，可先新增分类再添加项目。
            </div>
          ) : (
            activeSettings.redemptionCategories.map((category) => (
              <div key={category.id} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
                <Field label="分类名称">
                  <input
                    className={inputClassName()}
                    value={category.name}
                    onChange={(event) =>
                      patchSettings((current) => ({
                        ...current,
                        redemptionCategories: current.redemptionCategories.map((item) =>
                          item.id === category.id ? { ...item, name: event.target.value } : item,
                        ),
                      }))
                    }
                  />
                </Field>
                <div className="mt-3 flex gap-2">
                  <label className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={category.enabled}
                      onChange={(event) =>
                        patchSettings((current) => ({
                          ...current,
                          redemptionCategories: current.redemptionCategories.map((item) =>
                            item.id === category.id ? { ...item, enabled: event.target.checked } : item,
                          ),
                        }))
                      }
                    />
                    启用
                  </label>
                  <button
                    type="button"
                    className="rounded-xl border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-600 hover:bg-rose-50"
                    onClick={() =>
                      patchSettings((current) => ({
                        ...current,
                        redemptionCategories: current.redemptionCategories.filter((item) => item.id !== category.id),
                        redemptionItems: current.redemptionItems.map((item) =>
                          item.categoryId === category.id ? { ...item, categoryId: "" } : item,
                        ),
                      }))
                    }
                  >
                    删除
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="兑换项目"
        action={
          <button
            type="button"
            className="rounded-xl border border-slate-900 bg-white px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-slate-50"
            onClick={() =>
              patchSettings((current) => ({
                ...current,
                redemptionItems: [
                  ...current.redemptionItems,
                  {
                    id: createMerchantMemberSettingsId("item"),
                    categoryId: current.redemptionCategories[0]?.id ?? "",
                    code: "",
                    name: `兑换项目 ${current.redemptionItems.length + 1}`,
                    description: "",
                    enabled: true,
                    pointsCost: 0,
                    stock: 0,
                    sort: current.redemptionItems.length,
                  },
                ],
              }))
            }
          >
            新增项目
          </button>
        }
      >
        <div className="space-y-3">
          {activeSettings.redemptionItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              还没有兑换项目。
            </div>
          ) : (
            activeSettings.redemptionItems.map((item) => (
              <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
                <div className="grid gap-3 xl:grid-cols-[1fr_1.2fr_1.6fr_120px_120px_auto]">
                  <Field label="分类">
                    <select
                      className={inputClassName()}
                      value={item.categoryId}
                      onChange={(event) =>
                        patchSettings((current) => ({
                          ...current,
                          redemptionItems: current.redemptionItems.map((entry) =>
                            entry.id === item.id ? { ...entry, categoryId: event.target.value } : entry,
                          ),
                        }))
                      }
                    >
                      <option value="">未分类</option>
                      {activeSettings.redemptionCategories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="项目名称">
                    <input
                      className={inputClassName()}
                      value={item.name}
                      onChange={(event) =>
                        patchSettings((current) => ({
                          ...current,
                          redemptionItems: current.redemptionItems.map((entry) =>
                            entry.id === item.id ? { ...entry, name: event.target.value } : entry,
                          ),
                        }))
                      }
                    />
                  </Field>
                  <Field label="项目编号">
                    <input
                      className={inputClassName()}
                      value={item.code}
                      onChange={(event) =>
                        patchSettings((current) => ({
                          ...current,
                          redemptionItems: current.redemptionItems.map((entry) =>
                            entry.id === item.id ? { ...entry, code: event.target.value } : entry,
                          ),
                        }))
                      }
                    />
                  </Field>
                  <Field label="所需积分">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      className={inputClassName()}
                      value={toNumberInputValue(item.pointsCost)}
                      onChange={(event) =>
                        patchSettings((current) => ({
                          ...current,
                          redemptionItems: current.redemptionItems.map((entry) =>
                            entry.id === item.id ? { ...entry, pointsCost: parseInteger(event.target.value) } : entry,
                          ),
                        }))
                      }
                    />
                  </Field>
                  <Field label="库存">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      className={inputClassName()}
                      value={toNumberInputValue(item.stock)}
                      onChange={(event) =>
                        patchSettings((current) => ({
                          ...current,
                          redemptionItems: current.redemptionItems.map((entry) =>
                            entry.id === item.id ? { ...entry, stock: parseInteger(event.target.value) } : entry,
                          ),
                        }))
                      }
                    />
                  </Field>
                  <div className="flex items-end gap-2">
                    <label className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={item.enabled}
                        onChange={(event) =>
                          patchSettings((current) => ({
                            ...current,
                            redemptionItems: current.redemptionItems.map((entry) =>
                              entry.id === item.id ? { ...entry, enabled: event.target.checked } : entry,
                            ),
                          }))
                        }
                      />
                      启用
                    </label>
                    <button
                      type="button"
                      className="h-10 rounded-xl border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-600 hover:bg-rose-50"
                      onClick={() =>
                        patchSettings((current) => ({
                          ...current,
                          redemptionItems: current.redemptionItems.filter((entry) => entry.id !== item.id),
                        }))
                      }
                    >
                      删除
                    </button>
                  </div>
                </div>
                <Field label="项目说明" className="mt-3">
                  <textarea
                    className={textareaClassName()}
                    value={item.description}
                    onChange={(event) =>
                      patchSettings((current) => ({
                        ...current,
                        redemptionItems: current.redemptionItems.map((entry) =>
                          entry.id === item.id ? { ...entry, description: event.target.value } : entry,
                        ),
                      }))
                    }
                  />
                </Field>
              </div>
            ))
          )}
        </div>
      </SectionCard>
    </div>
  );

  const renderLevels = () => (
    <div className="space-y-4">
      <SectionCard title="成长值规则">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            ["消费金额成长值", "spendAmountGrowth"],
            ["充值金额成长值", "rechargeAmountGrowth"],
            ["充值积分成长值", "rechargePointGrowth"],
            ["消费积分成长值", "spendPointGrowth"],
          ].map(([label, key]) => (
            <Field key={key} label={label}>
              <input
                type="number"
                min="0"
                step="0.01"
                className={inputClassName()}
                value={toNumberInputValue(activeSettings.growthRules[key as keyof typeof activeSettings.growthRules] as number)}
                onChange={(event) =>
                  patchSettings((current) => ({
                    ...current,
                    growthRules: {
                      ...current.growthRules,
                      [key]: parseMoney(event.target.value),
                    },
                  }))
                }
                placeholder="例如：消费 1 元 = 10 成长值，则填 10"
              />
            </Field>
          ))}
        </div>
        <label className="mt-4 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={activeSettings.growthRules.annualRecalculate}
            onChange={(event) =>
              patchSettings((current) => ({
                ...current,
                growthRules: { ...current.growthRules, annualRecalculate: event.target.checked },
              }))
            }
          />
          每年重新计算并评定会员等级
        </label>
      </SectionCard>

      <SectionCard
        title="会员等级和权益"
        action={
          <button
            type="button"
            className="rounded-xl border border-slate-900 bg-white px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-slate-50"
            onClick={() =>
              patchSettings((current) => ({
                ...current,
                levels: [
                  ...current.levels,
                  {
                    id: createMerchantMemberSettingsId("level"),
                    name: `等级 ${current.levels.length + 1}`,
                    requiredGrowthValue: 0,
                    enabled: true,
                    sort: current.levels.length,
                    benefit: {
                      pointDiscount: "",
                      oneTimeGift: "",
                      recurringGift: "",
                      birthdayGift: "",
                      servicePriority: false,
                      inStoreService: false,
                      dedicatedSupport: false,
                      nextYearKeepLevel: false,
                    },
                  },
                ],
              }))
            }
          >
            新增等级
          </button>
        }
      >
        <div className="space-y-3">
          {activeSettings.levels.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              还没有会员等级。
            </div>
          ) : (
            activeSettings.levels.map((level) => (
              <div key={level.id} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
                <div className="grid gap-3 lg:grid-cols-[1fr_160px_auto]">
                  <Field label="等级名称">
                    <input
                      className={inputClassName()}
                      value={level.name}
                      onChange={(event) =>
                        patchSettings((current) => ({
                          ...current,
                          levels: current.levels.map((item) =>
                            item.id === level.id ? { ...item, name: event.target.value } : item,
                          ),
                        }))
                      }
                    />
                  </Field>
                  <Field label="所需成长值">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      className={inputClassName()}
                      value={toNumberInputValue(level.requiredGrowthValue)}
                      onChange={(event) =>
                        patchSettings((current) => ({
                          ...current,
                          levels: current.levels.map((item) =>
                            item.id === level.id ? { ...item, requiredGrowthValue: parseInteger(event.target.value) } : item,
                          ),
                        }))
                      }
                    />
                  </Field>
                  <div className="flex items-end gap-2">
                    <label className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={level.enabled}
                        onChange={(event) =>
                          patchSettings((current) => ({
                            ...current,
                            levels: current.levels.map((item) =>
                              item.id === level.id ? { ...item, enabled: event.target.checked } : item,
                            ),
                          }))
                        }
                      />
                      启用
                    </label>
                    <button
                      type="button"
                      className="h-10 rounded-xl border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-600 hover:bg-rose-50"
                      onClick={() =>
                        patchSettings((current) => ({
                          ...current,
                          levels: current.levels.filter((item) => item.id !== level.id),
                        }))
                      }
                    >
                      删除
                    </button>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {[
                    ["积分折扣", "pointDiscount"],
                    ["一次性赠送积分或项目、产品", "oneTimeGift"],
                    ["定期赠送积分或项目、产品", "recurringGift"],
                    ["生日赠送积分或项目、产品", "birthdayGift"],
                  ].map(([label, key]) => (
                    <Field key={key} label={label}>
                      <input
                        className={inputClassName()}
                        value={level.benefit[key as keyof typeof level.benefit] as string}
                        onChange={(event) =>
                          patchSettings((current) => ({
                            ...current,
                            levels: current.levels.map((item) =>
                              item.id === level.id
                                ? { ...item, benefit: { ...item.benefit, [key]: event.target.value } }
                                : item,
                            ),
                          }))
                        }
                      />
                    </Field>
                  ))}
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-4">
                  {[
                    ["服务优先权", "servicePriority"],
                    ["到店服务", "inStoreService"],
                    ["专属客服", "dedicatedSupport"],
                    ["次年保级", "nextYearKeepLevel"],
                  ].map(([label, key]) => (
                    <label
                      key={key}
                      className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(level.benefit[key as keyof typeof level.benefit])}
                        onChange={(event) =>
                          patchSettings((current) => ({
                            ...current,
                            levels: current.levels.map((item) =>
                              item.id === level.id
                                ? { ...item, benefit: { ...item.benefit, [key]: event.target.checked } }
                                : item,
                            ),
                          }))
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </SectionCard>
    </div>
  );

  const renderPointsRules = () => (
    <SectionCard title="积分规则">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label="实付金额">
          <input
            type="number"
            min="0"
            step="0.01"
            className={inputClassName()}
            value={toNumberInputValue(activeSettings.pointsRules.paidAmount)}
            onChange={(event) =>
              patchSettings((current) => ({
                ...current,
                pointsRules: { ...current.pointsRules, paidAmount: parseMoney(event.target.value) },
              }))
            }
          />
        </Field>
        <Field label="对应积分">
          <input
            type="number"
            min="0"
            step="1"
            className={inputClassName()}
            value={toNumberInputValue(activeSettings.pointsRules.paidPoints)}
            onChange={(event) =>
              patchSettings((current) => ({
                ...current,
                pointsRules: { ...current.pointsRules, paidPoints: parseInteger(event.target.value) },
              }))
            }
          />
        </Field>
        {[
          ["入会得积分", "joinPoints"],
          ["签到得积分", "checkinPoints"],
          ["连续签到积分", "continuousCheckinPoints"],
          ["生日积分", "birthdayPoints"],
          ["邀请积分", "invitationPoints"],
          ["评价积分", "reviewPoints"],
          ["指定节日积分倍数", "holidayMultiplier"],
          ["每积分抵扣金额", "deductionAmountPerPoint"],
          ["积分有效期（天）", "pointsValidDays"],
        ].map(([label, key]) => (
          <Field key={key} label={label}>
            <input
              type="number"
              min="0"
              step={key === "holidayMultiplier" || key === "deductionAmountPerPoint" ? "0.01" : "1"}
              className={inputClassName()}
              value={toNumberInputValue(activeSettings.pointsRules[key as keyof typeof activeSettings.pointsRules] as number)}
              onChange={(event) =>
                patchSettings((current) => ({
                  ...current,
                  pointsRules: {
                    ...current.pointsRules,
                    [key]:
                      key === "holidayMultiplier" || key === "deductionAmountPerPoint"
                        ? parseMoney(event.target.value)
                        : parseInteger(event.target.value),
                  },
                }))
              }
            />
          </Field>
        ))}
        <Field label="抵扣限制" className="md:col-span-2 xl:col-span-4">
          <input
            className={inputClassName()}
            value={activeSettings.pointsRules.deductionLimit}
            onChange={(event) =>
              patchSettings((current) => ({
                ...current,
                pointsRules: { ...current.pointsRules, deductionLimit: event.target.value },
              }))
            }
            placeholder="例如：每单最多抵扣 50%，或满 100 可抵扣"
          />
        </Field>
      </div>
    </SectionCard>
  );

  return (
    <section className={`space-y-4 py-6 ${className}`}>
      <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_12px_32px_rgba(15,23,42,0.05)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">{VIEW_TITLES[view]}</h2>
            <p className="mt-1 text-sm text-slate-500">这里配置会员功能，会员列表中的充值和兑换会读取已启用内容。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              onClick={() => void loadSettings()}
              disabled={loading || saving}
            >
              {loading ? "刷新中..." : "刷新"}
            </button>
            <button
              type="button"
              className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void saveSettings()}
              disabled={loading || saving}
            >
              {saving ? "保存中..." : "保存配置"}
            </button>
          </div>
        </div>
        {error ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
        ) : null}
        {notice ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {notice}
          </div>
        ) : null}
      </div>

      {view === "rechargePlans"
        ? renderRechargePlans()
        : view === "redemptionItems"
          ? renderRedemptionItems()
          : view === "levels"
            ? renderLevels()
            : renderPointsRules()}
    </section>
  );
}
