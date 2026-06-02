"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import Image from "next/image";
import {
  buildMerchantMemberHolidayPresets,
  createEmptyMerchantMembershipSettings,
  createMerchantMemberSettingsId,
  normalizeMerchantMembershipSettings,
  type MerchantMemberHolidayPointRule,
  type MerchantMemberRedemptionCategory,
  type MerchantMemberRedemptionItem,
  type MerchantMemberSettingsView,
  type MerchantMembershipSettings,
} from "@/lib/merchantMembershipSettings";
import { uploadFileToPublicStorage } from "@/lib/publicAssetUpload";

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
  redemptionCategories: "项目分类",
  redemptionItems: "兑换项目",
  levels: "等级&权益",
  pointsRules: "积分规则",
};

const REDEMPTION_ITEM_ICON_OPTIONS = [
  ["none", "无"],
  ["tag", "标签"],
  ["category", "分类"],
  ["box", "商品"],
  ["gift", "礼品"],
  ["hot", "热卖"],
  ["star", "新品"],
  ["like", "推荐"],
  ["cluster", "落客"],
  ["package", "套餐"],
  ["check", "必选"],
  ["badge", "纪念品"],
  ["figure", "手办"],
  ["toy", "玩具"],
  ["pen", "文具"],
  ["spark", "精选"],
  ["ticket", "门票"],
  ["door", "入场"],
  ["coffee", "咖啡"],
  ["drink", "饮料"],
  ["food", "餐饮"],
  ["light", "轻食"],
  ["pizza", "披萨"],
  ["dessert", "甜品"],
] as const;

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

function parseMultiplier(value: unknown, fallback = 1) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? Math.max(0, Number(parsed.toFixed(2))) : fallback;
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

function DatePickerInput({
  value,
  onChange,
  label,
  placeholder = "选择日期",
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label
      className={`relative flex h-10 w-full cursor-pointer items-center rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 transition focus-within:border-slate-900 ${className}`}
    >
      <span className={value ? "font-mono" : "text-slate-400"}>{value || placeholder}</span>
      <span className="ml-auto text-xs font-semibold text-slate-500" aria-hidden="true">
        日历
      </span>
      <input
        type="date"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onClick={(event) => {
          (event.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
        }}
      />
    </label>
  );
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

function SummaryPill({ label, value, tone = "slate" }: { label: string; value: ReactNode; tone?: "slate" | "green" | "cyan" | "amber" }) {
  const toneClassName =
    tone === "green"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "cyan"
        ? "border-cyan-200 bg-cyan-50 text-cyan-800"
        : tone === "amber"
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClassName}`}>
      <div className="text-xs font-medium">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function RedemptionIconGlyph({ name }: { name: string }) {
  const label = REDEMPTION_ITEM_ICON_OPTIONS.find(([value]) => value === name)?.[1] ?? "无";
  if (!name || name === "none") {
    return (
      <span className="grid h-5 w-5 place-items-center text-xs font-semibold leading-none text-teal-700">
        无
      </span>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 text-teal-700">
      <title>{label}</title>
      {name === "tag" ? (
        <path d="M4 12V5h7l9 9-6 6-10-8Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      ) : name === "category" ? (
        <path d="M6 6h5v5H6V6Zm7 0h5v5h-5V6ZM6 13h5v5H6v-5Zm7 0h5v5h-5v-5Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      ) : name === "box" || name === "package" ? (
        <path d="m4 8 8-4 8 4v9l-8 4-8-4V8Zm0 0 8 4 8-4M12 12v9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      ) : name === "gift" ? (
        <path d="M4 10h16v10H4V10Zm8 0v10M4 14h16M8 10c-2 0-3-1-3-2s1-2 2.4-2C9 6 10 8 12 10c2-2 3-4 4.6-4C18 6 19 7 19 8s-1 2-3 2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      ) : name === "hot" ? (
        <path d="M13 3c1 4-4 5-1 9 1-2 4-2 5 1 1.5 4-1.4 8-5 8s-6-2.5-6-6c0-3 2-5 4-7 1.2-1.2 2-2.5 3-5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      ) : name === "star" || name === "spark" ? (
        <path d="m12 3 2.6 5.7 6.2.7-4.6 4.2 1.2 6.1L12 16.6l-5.4 3.1 1.2-6.1-4.6-4.2 6.2-.7L12 3Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      ) : name === "like" ? (
        <path d="M7 11v9H4v-9h3Zm0 0 4-7c1.2.4 1.8 1.5 1.4 3l-.5 2H19c1 0 1.8.9 1.6 2l-1.2 6.8c-.2 1.2-1.2 2.2-2.5 2.2H7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      ) : name === "ticket" ? (
        <path d="M4 8h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4V8Zm8 1v10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      ) : name === "coffee" || name === "drink" ? (
        <path d="M7 8h9v8a4 4 0 0 1-4 4h-1a4 4 0 0 1-4-4V8Zm9 2h2a2 2 0 0 1 0 4h-2M6 4h12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      ) : name === "food" ? (
        <path d="M7 3v18M4 3v6a3 3 0 0 0 6 0V3M17 3v18M17 3c2 2 3 4 3 7 0 2-1 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      ) : (
        <path d="M12 4v16M4 12h16M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      )}
    </svg>
  );
}

function DialogShell({
  title,
  children,
  onClose,
  onConfirm,
  confirmText = "保存",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  onConfirm: () => void;
  confirmText?: string;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[24px] bg-white p-5 shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <h3 className="text-lg font-semibold text-slate-950">{title}</h3>
          <button
            type="button"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
        <div className="py-4">{children}</div>
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button
            type="button"
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
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
  const [redemptionKeyword, setRedemptionKeyword] = useState("");
  const [redemptionCategoryFilter, setRedemptionCategoryFilter] = useState("");
  const [categoryDialog, setCategoryDialog] = useState<{
    mode: "create" | "edit";
    draft: MerchantMemberRedemptionCategory;
  } | null>(null);
  const [itemDialog, setItemDialog] = useState<{
    mode: "create" | "edit";
    draft: MerchantMemberRedemptionItem;
  } | null>(null);
  const [itemImageUploading, setItemImageUploading] = useState(false);
  const currentYear = new Date().getFullYear();
  const [holidayPresetYear, setHolidayPresetYear] = useState(currentYear);
  const [holidayDraft, setHolidayDraft] = useState({ date: "", name: "", multiplier: "1" });

  const activeSettings = useMemo(
    () => normalizeMerchantMembershipSettings(normalizedSiteId, settings),
    [normalizedSiteId, settings],
  );
  const holidayPresets = useMemo(() => buildMerchantMemberHolidayPresets(holidayPresetYear), [holidayPresetYear]);

  function patchSettings(recipe: (current: MerchantMembershipSettings) => MerchantMembershipSettings) {
    setSettings((current) => recipe(current));
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
    if (settings.levels.some((level) => !trimText(level.name, 120))) {
      setError("等级名称不能为空，请填写后再保存。");
      setNotice("");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const normalized = normalizeMerchantMembershipSettings(normalizedSiteId, activeSettings);
      normalized.pointsRules.holidayNames = [];
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

  function redemptionCategoryName(categoryId: string) {
    return activeSettings.redemptionCategories.find((category) => category.id === categoryId)?.name || "未分类";
  }

  function redemptionCategoryReferenced(categoryId: string) {
    return activeSettings.redemptionItems.some((item) => item.categoryId === categoryId);
  }

  function redemptionStockText(stock: number) {
    return stock > 0 ? String(stock) : "不限";
  }

  function patchCategoryDraft(patch: Partial<MerchantMemberRedemptionCategory>) {
    setCategoryDialog((current) => (current ? { ...current, draft: { ...current.draft, ...patch } } : current));
  }

  function patchItemDraft(patch: Partial<MerchantMemberRedemptionItem>) {
    setItemDialog((current) => (current ? { ...current, draft: { ...current.draft, ...patch } } : current));
  }

  function openCategoryCreate() {
    setCategoryDialog({
      mode: "create",
      draft: {
        id: createMerchantMemberSettingsId("category"),
        name: "",
        enabled: true,
        sort: activeSettings.redemptionCategories.length,
      },
    });
  }

  function openCategoryEdit(category: MerchantMemberRedemptionCategory) {
    setCategoryDialog({ mode: "edit", draft: { ...category } });
  }

  function saveCategoryDialog() {
    if (!categoryDialog) return;
    const draft = { ...categoryDialog.draft, name: trimText(categoryDialog.draft.name, 120) };
    if (!draft.name) {
      setError("请填写分类名称。");
      return;
    }
    const duplicate = activeSettings.redemptionCategories.some(
      (category) => category.id !== draft.id && category.name.trim().toLowerCase() === draft.name.toLowerCase(),
    );
    if (duplicate) {
      setError("分类名称不能重复。");
      return;
    }
    patchSettings((current) => ({
      ...current,
      redemptionCategories:
        categoryDialog.mode === "create"
          ? [...current.redemptionCategories, draft]
          : current.redemptionCategories.map((category) => (category.id === draft.id ? draft : category)),
    }));
    setCategoryDialog(null);
    setError("");
  }

  function deleteRedemptionCategory(category: MerchantMemberRedemptionCategory) {
    if (redemptionCategoryReferenced(category.id)) return;
    patchSettings((current) => ({
      ...current,
      redemptionCategories: current.redemptionCategories
        .filter((item) => item.id !== category.id)
        .map((item, index) => ({ ...item, sort: index })),
    }));
  }

  function openItemCreate() {
    setItemDialog({
      mode: "create",
      draft: {
        id: createMerchantMemberSettingsId("item"),
        categoryId: activeSettings.redemptionCategories[0]?.id ?? "",
        code: "",
        barcode: "",
        name: "",
        imageUrl: "",
        iconName: "none",
        description: "",
        enabled: true,
        pointsCost: 0,
        referenceAmount: 0,
        memberPrice: 0,
        taxRate: 10,
        stock: 0,
        pointProduct: true,
        recommended: false,
        sort: activeSettings.redemptionItems.length,
      },
    });
  }

  function openItemEdit(item: MerchantMemberRedemptionItem) {
    setItemDialog({ mode: "edit", draft: { ...item } });
  }

  function saveItemDialog() {
    if (!itemDialog) return;
    const draft = {
      ...itemDialog.draft,
      code: trimText(itemDialog.draft.code, 120),
      barcode: trimText(itemDialog.draft.barcode, 120),
      name: trimText(itemDialog.draft.name, 160),
      imageUrl: trimText(itemDialog.draft.imageUrl, 1000),
      iconName: trimText(itemDialog.draft.iconName, 80) || "none",
      description: trimText(itemDialog.draft.description, 500),
    };
    if (!draft.code || !draft.name) {
      setError("请填写兑换项目编号和名称。");
      return;
    }
    const duplicate = activeSettings.redemptionItems.some(
      (item) => item.id !== draft.id && item.code.trim().toLowerCase() === draft.code.toLowerCase(),
    );
    if (duplicate) {
      setError("兑换项目编号不能重复。");
      return;
    }
    patchSettings((current) => ({
      ...current,
      redemptionItems:
        itemDialog.mode === "create"
          ? [...current.redemptionItems, draft]
          : current.redemptionItems.map((item) => (item.id === draft.id ? draft : item)),
    }));
    setItemDialog(null);
    setError("");
  }

  async function handleItemImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || itemImageUploading) return;
    if (!file.type.toLowerCase().startsWith("image/")) {
      setError("仅支持上传图片文件");
      return;
    }
    setItemImageUploading(true);
    setError("");
    try {
      const uploadedUrl = await uploadFileToPublicStorage(file, {
        merchantHint: normalizedSiteId || "membership",
        folder: "merchant-assets",
        usage: "generic-image",
      });
      if (!uploadedUrl) throw new Error("商品图片上传失败，请稍后重试");
      patchItemDraft({ imageUrl: uploadedUrl });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "商品图片上传失败，请稍后重试");
    } finally {
      setItemImageUploading(false);
    }
  }

  const renderRedemptionCategories = () => {
    const categoryRows = activeSettings.redemptionCategories.filter((category) => category.id);
    return (
      <div className="space-y-4">
        <SectionCard
          title="项目分类"
          action={
            <button
              type="button"
              className="rounded-xl border border-slate-900 bg-white px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-slate-50"
              onClick={openCategoryCreate}
            >
              新增分类
            </button>
          }
        >
          <div className="mb-3 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-sm text-slate-600">
            分类用于会员兑换项目分组；分类下已有项目时不能删除，可以通过状态停用。
          </div>
          <div className="mb-3 grid gap-3 md:grid-cols-3">
            <SummaryPill label="项目分类" value={categoryRows.length} tone="slate" />
            <SummaryPill label="启用分类" value={categoryRows.filter((category) => category.enabled).length} tone="green" />
            <SummaryPill
              label="未分类项目"
              value={activeSettings.redemptionItems.filter((item) => !item.categoryId).length}
              tone="amber"
            />
          </div>
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-[760px] w-full border-collapse text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
                <tr>
                  <th className="px-4 py-3">分类名称</th>
                  <th className="px-4 py-3">排序</th>
                  <th className="px-4 py-3">项目数</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {categoryRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                      还没有分类，可先新增分类再添加项目。
                    </td>
                  </tr>
                ) : (
                  categoryRows.map((category) => {
                    const referenced = redemptionCategoryReferenced(category.id);
                    return (
                      <tr key={category.id} className="bg-white">
                        <td className="px-4 py-3 font-semibold text-slate-950">{category.name}</td>
                        <td className="px-4 py-3 text-slate-700">{category.sort + 1}</td>
                        <td className="px-4 py-3 text-slate-700">
                          {activeSettings.redemptionItems.filter((item) => item.categoryId === category.id).length}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${
                              category.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                            }`}
                            onClick={() =>
                              patchSettings((current) => ({
                                ...current,
                                redemptionCategories: current.redemptionCategories.map((item) =>
                                  item.id === category.id ? { ...item, enabled: !item.enabled } : item,
                                ),
                              }))
                            }
                          >
                            {category.enabled ? "启用" : "停用"}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                              onClick={() => openCategoryEdit(category)}
                            >
                              编辑
                            </button>
                            <button
                              type="button"
                              disabled={referenced}
                              title={referenced ? "分类下已有兑换项目，不能删除" : ""}
                              className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300 disabled:hover:bg-white"
                              onClick={() => deleteRedemptionCategory(category)}
                            >
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>

        {categoryDialog ? (
          <DialogShell
            title={categoryDialog.mode === "create" ? "新增商品分类" : "编辑商品分类"}
            onClose={() => setCategoryDialog(null)}
            onConfirm={saveCategoryDialog}
          >
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="分类名称" className="md:col-span-2">
                <input
                  className={inputClassName()}
                  value={categoryDialog.draft.name}
                  onChange={(event) => patchCategoryDraft({ name: event.target.value })}
                />
              </Field>
              <Field label="排序">
                <input
                  type="number"
                  min="0"
                  step="1"
                  className={inputClassName()}
                  value={toNumberInputValue(categoryDialog.draft.sort)}
                  onChange={(event) => patchCategoryDraft({ sort: parseInteger(event.target.value) })}
                />
              </Field>
              <label className="mt-6 flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={categoryDialog.draft.enabled}
                  onChange={(event) => patchCategoryDraft({ enabled: event.target.checked })}
                />
                启用分类
              </label>
            </div>
          </DialogShell>
        ) : null}
      </div>
    );
  };

  const renderRedemptionItems = () => {
    const categoryRows = activeSettings.redemptionCategories.filter((category) => category.id);
    const redemptionKeywordText = redemptionKeyword.trim().toLowerCase();
    const filteredItems = activeSettings.redemptionItems.filter((item) => {
      const matchesCategory = !redemptionCategoryFilter || item.categoryId === redemptionCategoryFilter;
      const matchesKeyword =
        !redemptionKeywordText ||
        item.code.toLowerCase().includes(redemptionKeywordText) ||
        item.name.toLowerCase().includes(redemptionKeywordText) ||
        item.description.toLowerCase().includes(redemptionKeywordText);
      return matchesCategory && matchesKeyword;
    });
    const itemCategoryCount = new Set(activeSettings.redemptionItems.map((item) => item.categoryId).filter(Boolean)).size;
    return (
      <div className="space-y-4">
        <SectionCard
          title="兑换项目"
          action={
            <button
              type="button"
              className="rounded-xl bg-slate-950 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              onClick={openItemCreate}
            >
              新增兑换项目
            </button>
          }
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              className="h-10 min-w-[240px] flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-900"
              value={redemptionKeyword}
              onChange={(event) => setRedemptionKeyword(event.target.value)}
              placeholder="项目编号 / 名称 / 说明"
            />
            <select
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-900 sm:w-48"
              value={redemptionCategoryFilter}
              onChange={(event) => setRedemptionCategoryFilter(event.target.value)}
            >
              <option value="">全部分类</option>
              {categoryRows.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
          <div className="mb-3 grid gap-3 md:grid-cols-4">
            <SummaryPill label="兑换项目" value={activeSettings.redemptionItems.length} tone="slate" />
            <SummaryPill label="启用项目" value={activeSettings.redemptionItems.filter((item) => item.enabled).length} tone="green" />
            <SummaryPill label="不限库存" value={activeSettings.redemptionItems.filter((item) => item.stock <= 0).length} tone="cyan" />
            <SummaryPill label="项目分类" value={itemCategoryCount} tone="amber" />
          </div>
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-[980px] w-full border-collapse text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
                <tr>
                  <th className="px-4 py-3">编号</th>
                  <th className="px-4 py-3">名称</th>
                  <th className="px-4 py-3">积分</th>
                  <th className="px-4 py-3">参考金额</th>
                  <th className="px-4 py-3">库存</th>
                  <th className="px-4 py-3">分类</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                      还没有匹配的兑换项目。
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item) => (
                    <tr key={item.id} className="bg-white align-top">
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">{item.code || "-"}</td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-950">{item.name}</div>
                        {item.description ? <div className="mt-1 line-clamp-2 text-xs text-slate-500">{item.description}</div> : null}
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-950">{item.pointsCost}</td>
                      <td className="px-4 py-3 text-slate-700">
                        {item.referenceAmount > 0 ? item.referenceAmount.toFixed(2) : "-"}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{redemptionStockText(item.stock)}</td>
                      <td className="px-4 py-3 text-slate-700">{redemptionCategoryName(item.categoryId)}</td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${
                            item.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                          }`}
                          onClick={() =>
                            patchSettings((current) => ({
                              ...current,
                              redemptionItems: current.redemptionItems.map((entry) =>
                                entry.id === item.id ? { ...entry, enabled: !entry.enabled } : entry,
                              ),
                            }))
                          }
                        >
                          {item.enabled ? "启用" : "停用"}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            onClick={() => openItemEdit(item)}
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                            onClick={() =>
                              patchSettings((current) => ({
                                ...current,
                                redemptionItems: current.redemptionItems
                                  .filter((entry) => entry.id !== item.id)
                                  .map((entry, index) => ({ ...entry, sort: index })),
                              }))
                            }
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>

        {itemDialog ? (
          <DialogShell
            title={itemDialog.mode === "create" ? "新增积分兑换商品" : "编辑积分兑换商品"}
            onClose={() => setItemDialog(null)}
            onConfirm={saveItemDialog}
          >
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-[108px_minmax(0,1fr)]">
                <label className="group relative grid h-[108px] cursor-pointer place-items-center overflow-hidden rounded-lg border border-teal-100 bg-teal-50 text-sm font-semibold text-teal-800 transition hover:border-teal-300">
                  {itemDialog.draft.imageUrl ? (
                    <Image
                      src={itemDialog.draft.imageUrl}
                      alt={itemDialog.draft.name || "商品图片"}
                      fill
                      unoptimized
                      sizes="108px"
                      className="object-cover"
                    />
                  ) : (
                    <span className="grid place-items-center gap-2">
                      <span className="text-2xl leading-none">⇧</span>
                      <span>{itemImageUploading ? "上传中..." : "上传图片"}</span>
                    </span>
                  )}
                  <input type="file" accept="image/*" className="sr-only" disabled={itemImageUploading} onChange={handleItemImageUpload} />
                </label>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="商品编号">
                    <input
                      className={inputClassName()}
                      value={itemDialog.draft.code}
                      onChange={(event) => patchItemDraft({ code: event.target.value })}
                    />
                  </Field>
                  <Field label="条码">
                    <input
                      className={inputClassName()}
                      value={itemDialog.draft.barcode}
                      onChange={(event) => patchItemDraft({ barcode: event.target.value })}
                    />
                  </Field>
                  <Field label="商品名称" className="md:col-span-2">
                    <input
                      className={inputClassName()}
                      value={itemDialog.draft.name}
                      onChange={(event) => patchItemDraft({ name: event.target.value })}
                    />
                  </Field>
                </div>
              </div>

              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">商品图标</div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
                  {REDEMPTION_ITEM_ICON_OPTIONS.map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={[
                        "flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-lg border px-2 text-xs font-semibold transition",
                        itemDialog.draft.iconName === value
                          ? "border-teal-600 bg-teal-50 text-teal-800 shadow-[0_0_0_1px_rgba(13,148,136,0.25)]"
                          : "border-slate-200 bg-slate-50 text-slate-700 hover:border-teal-200 hover:bg-teal-50",
                      ].join(" ")}
                      onClick={() => patchItemDraft({ iconName: value })}
                    >
                      <RedemptionIconGlyph name={value} />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Field label="分类">
                  <select
                    className={inputClassName()}
                    value={itemDialog.draft.categoryId}
                    onChange={(event) => patchItemDraft({ categoryId: event.target.value })}
                  >
                    <option value="">未分类</option>
                    {categoryRows.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="价格">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className={inputClassName()}
                    value={toNumberInputValue(itemDialog.draft.referenceAmount)}
                    onChange={(event) => patchItemDraft({ referenceAmount: parseMoney(event.target.value) })}
                  />
                </Field>
                <Field label="会员价">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className={inputClassName()}
                    value={toNumberInputValue(itemDialog.draft.memberPrice)}
                    onChange={(event) => patchItemDraft({ memberPrice: parseMoney(event.target.value) })}
                    placeholder="留空则使用普通价格"
                  />
                </Field>
                <Field label="库存">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className={inputClassName()}
                    value={toNumberInputValue(itemDialog.draft.stock)}
                    onChange={(event) => patchItemDraft({ stock: parseInteger(event.target.value) })}
                    placeholder="留空表示不限库存"
                  />
                </Field>
                <Field label="税率">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className={inputClassName()}
                    value={toNumberInputValue(itemDialog.draft.taxRate)}
                    onChange={(event) => patchItemDraft({ taxRate: parseMoney(event.target.value) })}
                  />
                </Field>
                <Field label="兑换积分">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className={inputClassName()}
                    value={toNumberInputValue(itemDialog.draft.pointsCost)}
                    onChange={(event) => patchItemDraft({ pointsCost: parseInteger(event.target.value) })}
                  />
                </Field>
              </div>

              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">商品标记</div>
                <div className="flex flex-wrap gap-3">
                  {[
                    ["pointProduct", "积分商品"],
                    ["recommended", "推荐商品"],
                    ["enabled", "启用项目"],
                  ].map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={Boolean(itemDialog.draft[key as keyof MerchantMemberRedemptionItem])}
                        onChange={(event) => patchItemDraft({ [key]: event.target.checked } as Partial<MerchantMemberRedemptionItem>)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              <Field label="说明">
                <textarea
                  className={textareaClassName("min-h-[80px]")}
                  value={itemDialog.draft.description}
                  onChange={(event) => patchItemDraft({ description: event.target.value })}
                />
              </Field>
            </div>
          </DialogShell>
        ) : null}
      </div>
    );
  };

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
                      oneTimeGiftPoints: 0,
                      oneTimeGiftItem: "",
                      oneTimeGiftProduct: "",
                      recurringGiftPoints: 0,
                      recurringGiftItem: "",
                      recurringGiftProduct: "",
                      birthdayGiftPoints: 0,
                      birthdayGiftItem: "",
                      birthdayGiftProduct: "",
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
                <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <Field label="积分折扣">
                    <input
                      className={inputClassName()}
                      value={level.benefit.pointDiscount}
                      onChange={(event) =>
                        patchSettings((current) => ({
                          ...current,
                          levels: current.levels.map((item) =>
                            item.id === level.id
                              ? { ...item, benefit: { ...item.benefit, pointDiscount: event.target.value } }
                              : item,
                          ),
                        }))
                      }
                    />
                  </Field>
                  {[
                    ["一次性赠送积分", "oneTimeGiftPoints"],
                    ["定期赠送积分", "recurringGiftPoints"],
                    ["生日赠送积分", "birthdayGiftPoints"],
                  ].map(([label, key]) => (
                    <Field key={key} label={label}>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        className={inputClassName()}
                        value={toNumberInputValue(level.benefit[key as keyof typeof level.benefit] as number)}
                        onChange={(event) =>
                          patchSettings((current) => ({
                            ...current,
                            levels: current.levels.map((item) =>
                              item.id === level.id
                                ? { ...item, benefit: { ...item.benefit, [key]: parseInteger(event.target.value) } }
                                : item,
                            ),
                          }))
                        }
                      />
                    </Field>
                  ))}
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {[
                    ["一次性赠送项目", "oneTimeGiftItem"],
                    ["一次性赠送产品", "oneTimeGiftProduct"],
                    ["定期赠送项目", "recurringGiftItem"],
                    ["定期赠送产品", "recurringGiftProduct"],
                    ["生日赠送项目", "birthdayGiftItem"],
                    ["生日赠送产品", "birthdayGiftProduct"],
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

  function normalizeHolidayDraftRule(input: { date: string; name: string; multiplier?: unknown }): MerchantMemberHolidayPointRule | null {
    const date = trimText(input.date, 32);
    const name = trimText(input.name, 120);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name) return null;
    return {
      id: createMerchantMemberSettingsId("holiday"),
      date,
      name,
      multiplier: parseMultiplier(input.multiplier, activeSettings.pointsRules.holidayMultiplier ?? 1),
      enabled: true,
      sort: activeSettings.pointsRules.holidayRules.length,
    };
  }

  function addHolidayRule(input: { date: string; name: string; multiplier?: unknown }) {
    const rule = normalizeHolidayDraftRule(input);
    if (!rule) {
      setError("请选择日期并填写节日名称。");
      return;
    }
    patchSettings((current) => {
      const currentRules = current.pointsRules.holidayRules ?? [];
      const exists = currentRules.some((item) => item.date === rule.date && item.name.trim() === rule.name);
      return {
        ...current,
        pointsRules: {
          ...current.pointsRules,
          holidayRules: exists ? currentRules : [...currentRules, rule],
        },
      };
    });
    setHolidayDraft({ date: "", name: "", multiplier: String(activeSettings.pointsRules.holidayMultiplier ?? 1) });
    setError("");
  }

  function patchHolidayRule(ruleId: string, patch: Partial<MerchantMemberHolidayPointRule>) {
    patchSettings((current) => ({
      ...current,
      pointsRules: {
        ...current.pointsRules,
        holidayRules: (current.pointsRules.holidayRules ?? []).map((rule) =>
          rule.id === ruleId ? { ...rule, ...patch } : rule,
        ),
      },
    }));
  }

  function deleteHolidayRule(ruleId: string) {
    patchSettings((current) => ({
      ...current,
      pointsRules: {
        ...current.pointsRules,
        holidayRules: (current.pointsRules.holidayRules ?? [])
          .filter((rule) => rule.id !== ruleId)
          .map((rule, index) => ({ ...rule, sort: index })),
      },
    }));
  }

  const renderPointsRules = () => (
    <SectionCard title="积分规则">
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
          <div className="text-sm font-semibold text-slate-800">消费得积分</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-700">
            <span>实付金额</span>
            <input
              type="number"
              min="0"
              step="0.01"
              className="h-10 w-32 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-900"
              value={toNumberInputValue(activeSettings.pointsRules.paidAmount)}
              onChange={(event) =>
                patchSettings((current) => ({
                  ...current,
                  pointsRules: { ...current.pointsRules, paidAmount: parseMoney(event.target.value) },
                }))
              }
            />
            <span>获得</span>
            <input
              type="number"
              min="0"
              step="1"
              className="h-10 w-32 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-900"
              value={toNumberInputValue(activeSettings.pointsRules.paidPoints)}
              onChange={(event) =>
                patchSettings((current) => ({
                  ...current,
                  pointsRules: { ...current.pointsRules, paidPoints: parseInteger(event.target.value) },
                }))
              }
            />
            <span>积分</span>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            ["入会得积分", "joinPoints"],
            ["签到得积分", "checkinPoints"],
            ["连续签到积分", "continuousCheckinPoints"],
            ["生日自动赠送积分", "birthdayPoints"],
            ["邀请积分", "invitationPoints"],
            ["评价积分", "reviewPoints"],
          ].map(([label, key]) => (
            <Field key={key} label={label}>
              <input
                type="number"
                min="0"
                step="1"
                className={inputClassName()}
                value={toNumberInputValue(activeSettings.pointsRules[key as keyof typeof activeSettings.pointsRules] as number)}
                onChange={(event) =>
                  patchSettings((current) => ({
                    ...current,
                    pointsRules: { ...current.pointsRules, [key]: parseInteger(event.target.value) },
                  }))
                }
              />
            </Field>
          ))}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
          <div className="grid gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-800">指定日期积分倍数</div>
              <div className="mt-2 grid gap-2 md:grid-cols-[170px_1fr_120px_auto]">
                <DatePickerInput
                  label="指定日期"
                  value={holidayDraft.date}
                  onChange={(value) => setHolidayDraft((current) => ({ ...current, date: value }))}
                />
                <input
                  className={inputClassName()}
                  value={holidayDraft.name}
                  placeholder="节日名称，可自定义"
                  onChange={(event) => setHolidayDraft((current) => ({ ...current, name: event.target.value }))}
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className={inputClassName()}
                  value={holidayDraft.multiplier}
                  placeholder="倍数"
                  onChange={(event) => setHolidayDraft((current) => ({ ...current, multiplier: event.target.value }))}
                />
                <button
                  type="button"
                  className="h-10 rounded-xl border border-slate-900 bg-white px-4 text-sm font-semibold text-slate-950 hover:bg-slate-50"
                  onClick={() => addHolidayRule(holidayDraft)}
                >
                  添加
                </button>
              </div>
              <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-slate-500">内置节日标注</div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <button
                      type="button"
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50"
                      onClick={() => setHolidayPresetYear((year) => year - 1)}
                    >
                      上一年
                    </button>
                    <span className="font-semibold text-slate-900">{holidayPresetYear}</span>
                    <button
                      type="button"
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50"
                      onClick={() => setHolidayPresetYear((year) => year + 1)}
                    >
                      下一年
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex max-h-36 flex-wrap gap-2 overflow-y-auto">
                  {holidayPresets.map((preset) => {
                    const selected = activeSettings.pointsRules.holidayRules.some(
                      (rule) => rule.enabled && rule.date === preset.date && rule.name === preset.name,
                    );
                    return (
                      <button
                        type="button"
                        key={`${preset.date}:${preset.name}`}
                        className={`rounded-xl border px-3 py-2 text-left text-xs font-semibold ${
                          selected
                            ? "border-slate-950 bg-slate-950 text-white"
                            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                        }`}
                        onClick={() => addHolidayRule(preset)}
                      >
                        <span className="font-mono">{preset.date}</span>
                        <span className="ml-2">{preset.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {activeSettings.pointsRules.holidayRules.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-white px-3 py-4 text-center text-sm text-slate-500">
                    还没有指定日期，订单完成日命中这里的日期时才使用节日倍数。
                  </div>
                ) : (
                  activeSettings.pointsRules.holidayRules.map((rule) => (
                    <div key={rule.id} className="grid gap-2 rounded-xl border border-slate-200 bg-white p-2 md:grid-cols-[170px_1fr_120px_auto_auto]">
                      <DatePickerInput
                        label={`${rule.name || "指定日期"}日期`}
                        value={rule.date}
                        onChange={(value) => patchHolidayRule(rule.id, { date: value })}
                      />
                      <input
                        className={inputClassName()}
                        value={rule.name}
                        onChange={(event) => patchHolidayRule(rule.id, { name: event.target.value })}
                      />
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className={inputClassName()}
                        value={toNumberInputValue(rule.multiplier)}
                        aria-label={`${rule.name || "指定日期"}倍数`}
                        onChange={(event) => patchHolidayRule(rule.id, { multiplier: parseMultiplier(event.target.value) })}
                      />
                      <label className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700">
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          onChange={(event) => patchHolidayRule(rule.id, { enabled: event.target.checked })}
                        />
                        启用
                      </label>
                      <button
                        type="button"
                        className="h-10 rounded-xl border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-600 hover:bg-rose-50"
                        onClick={() => deleteHolidayRule(rule.id)}
                      >
                        删除
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="每积分抵扣金额">
            <input
              type="number"
              min="0"
              step="0.01"
              className={inputClassName()}
              value={toNumberInputValue(activeSettings.pointsRules.deductionAmountPerPoint)}
              onChange={(event) =>
                patchSettings((current) => ({
                  ...current,
                  pointsRules: { ...current.pointsRules, deductionAmountPerPoint: parseMoney(event.target.value) },
                }))
              }
            />
          </Field>
          <Field label="最低可抵扣订单金额">
            <input
              type="number"
              min="0"
              step="0.01"
              className={inputClassName()}
              value={toNumberInputValue(activeSettings.pointsRules.deductionMinOrderAmount)}
              onChange={(event) =>
                patchSettings((current) => ({
                  ...current,
                  pointsRules: { ...current.pointsRules, deductionMinOrderAmount: parseMoney(event.target.value) },
                }))
              }
            />
          </Field>
          <Field label="每单最高抵扣金额">
            <input
              type="number"
              min="0"
              step="0.01"
              className={inputClassName()}
              value={toNumberInputValue(activeSettings.pointsRules.deductionMaxAmount)}
              onChange={(event) =>
                patchSettings((current) => ({
                  ...current,
                  pointsRules: { ...current.pointsRules, deductionMaxAmount: parseMoney(event.target.value) },
                }))
              }
            />
          </Field>
          <Field label="每单最高抵扣比例（%）">
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              className={inputClassName()}
              value={toNumberInputValue(activeSettings.pointsRules.deductionMaxPercent)}
              onChange={(event) =>
                patchSettings((current) => ({
                  ...current,
                  pointsRules: { ...current.pointsRules, deductionMaxPercent: Math.min(100, parseMoney(event.target.value)) },
                }))
              }
            />
          </Field>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={activeSettings.pointsRules.pointsNeverExpire}
              onChange={(event) =>
                patchSettings((current) => ({
                  ...current,
                  pointsRules: {
                    ...current.pointsRules,
                    pointsNeverExpire: event.target.checked,
                    pointsValidDays: event.target.checked ? 0 : current.pointsRules.pointsValidDays || 365,
                  },
                }))
              }
            />
            积分永久有效
          </label>
          {!activeSettings.pointsRules.pointsNeverExpire ? (
            <Field label="积分有效期（天）" className="mt-3 max-w-xs">
              <input
                type="number"
                min="1"
                step="1"
                className={inputClassName()}
                value={toNumberInputValue(activeSettings.pointsRules.pointsValidDays || 365)}
                onChange={(event) =>
                  patchSettings((current) => ({
                    ...current,
                    pointsRules: { ...current.pointsRules, pointsValidDays: parseInteger(event.target.value) },
                  }))
                }
              />
            </Field>
          ) : null}
        </div>
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
        : view === "redemptionCategories"
          ? renderRedemptionCategories()
        : view === "redemptionItems"
          ? renderRedemptionItems()
          : view === "levels"
            ? renderLevels()
            : renderPointsRules()}
    </section>
  );
}
