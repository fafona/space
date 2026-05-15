"use client";

import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  getMerchantCouponDiscountLabel,
  normalizeMerchantCouponRecords,
  type MerchantCouponDiscountType,
  type MerchantCouponInput,
  type MerchantCouponRecord,
  type MerchantCouponStatus,
} from "@/lib/merchantCoupons";

type MerchantCouponManagerProps = {
  siteId: string;
  siteName?: string;
  pricePrefix?: string;
  onCouponsChange?: (coupons: MerchantCouponRecord[]) => void;
  onClose?: () => void;
  className?: string;
};

type CouponFormState = {
  id: string;
  title: string;
  code: string;
  description: string;
  discountType: MerchantCouponDiscountType;
  discountValue: string;
  minimumAmount: string;
  maxDiscountAmount: string;
  totalQuantity: string;
  perCustomerLimit: string;
  startsAt: string;
  expiresAt: string;
  status: MerchantCouponStatus;
  showOnWebsite: boolean;
  showOnContactCard: boolean;
  applicableTags: string;
};

const EMPTY_FORM: CouponFormState = {
  id: "",
  title: "",
  code: "",
  description: "",
  discountType: "threshold_amount_off",
  discountValue: "5",
  minimumAmount: "30",
  maxDiscountAmount: "",
  totalQuantity: "100",
  perCustomerLimit: "1",
  startsAt: "",
  expiresAt: "",
  status: "active",
  showOnWebsite: true,
  showOnContactCard: false,
  applicableTags: "",
};

const STATUS_LABELS: Record<MerchantCouponStatus, string> = {
  active: "启用",
  paused: "暂停",
  archived: "已删除",
};

const STATUS_CLASS_NAMES: Record<MerchantCouponStatus, string> = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  paused: "border-amber-200 bg-amber-50 text-amber-700",
  archived: "border-slate-200 bg-slate-100 text-slate-500",
};

function toDateTimeTextValue(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function fromDateTimeTextValue(value: string) {
  const raw = value.trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2}))?$/);
  const date = match
    ? new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        Number(match[4] ?? "0"),
        Number(match[5] ?? "0"),
      )
    : new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function toDateTimePickerValue(value: string) {
  const raw = value.trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2}))?$/);
  if (match) {
    const year = match[1];
    const month = String(Number(match[2])).padStart(2, "0");
    const day = String(Number(match[3])).padStart(2, "0");
    const hour = String(Number(match[4] ?? "0")).padStart(2, "0");
    const minute = String(Number(match[5] ?? "0")).padStart(2, "0");
    return `${year}-${month}-${day}T${hour}:${minute}`;
  }
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function toDateTimeTextFromPickerValue(value: string) {
  return value.trim().replace("T", " ");
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "未设置";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "未设置";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toNumberValue(value: string) {
  const next = Number.parseFloat(value);
  return Number.isFinite(next) ? Math.max(0, next) : 0;
}

function toIntValue(value: string) {
  const next = Number.parseInt(value, 10);
  return Number.isFinite(next) ? Math.max(0, Math.round(next)) : 0;
}

function splitTags(value: string) {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildFormFromCoupon(coupon: MerchantCouponRecord): CouponFormState {
  return {
    id: coupon.id,
    title: coupon.title,
    code: coupon.code,
    description: coupon.description,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue > 0 ? String(coupon.discountValue) : "",
    minimumAmount: coupon.minimumAmount > 0 ? String(coupon.minimumAmount) : "",
    maxDiscountAmount: coupon.maxDiscountAmount > 0 ? String(coupon.maxDiscountAmount) : "",
    totalQuantity: coupon.totalQuantity > 0 ? String(coupon.totalQuantity) : "",
    perCustomerLimit: coupon.perCustomerLimit > 0 ? String(coupon.perCustomerLimit) : "1",
    startsAt: toDateTimeTextValue(coupon.startsAt),
    expiresAt: toDateTimeTextValue(coupon.expiresAt),
    status: coupon.status,
    showOnWebsite: coupon.showOnWebsite,
    showOnContactCard: coupon.showOnContactCard,
    applicableTags: coupon.applicableTags.join("\n"),
  };
}

function getRemainingCount(coupon: MerchantCouponRecord) {
  if (coupon.totalQuantity <= 0) return "不限";
  return String(Math.max(0, coupon.totalQuantity - coupon.usedCount));
}

function CouponDateTimeField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="block text-slate-600">{label}</span>
      <span className="relative block">
        <input
          type="text"
          inputMode="numeric"
          data-no-translate="1"
          translate="no"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-20 outline-none focus:border-slate-500"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
        />
        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center rounded-md px-2 text-xs font-semibold text-slate-600">
          选择
        </span>
        <input
          type="datetime-local"
          aria-label={`${label}选择器`}
          className="absolute inset-y-0 right-0 h-full w-16 cursor-pointer opacity-0"
          value={toDateTimePickerValue(value)}
          onChange={(event) => onChange(toDateTimeTextFromPickerValue(event.target.value))}
        />
      </span>
    </label>
  );
}

export default function MerchantCouponManager({
  siteId,
  siteName,
  pricePrefix = "",
  onCouponsChange,
  onClose,
  className = "",
}: MerchantCouponManagerProps) {
  const [coupons, setCoupons] = useState<MerchantCouponRecord[]>([]);
  const [form, setForm] = useState<CouponFormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [tip, setTip] = useState("");

  const selectedCoupon = useMemo(
    () => coupons.find((coupon) => coupon.id === form.id) ?? null,
    [coupons, form.id],
  );

  const activeVisibleCount = useMemo(
    () => coupons.filter((coupon) => coupon.status === "active" && coupon.showOnWebsite).length,
    [coupons],
  );

  const notifyCouponsChange = useCallback(
    (nextCoupons: MerchantCouponRecord[]) => {
      setCoupons(nextCoupons);
      onCouponsChange?.(nextCoupons);
    },
    [onCouponsChange],
  );

  const loadCoupons = useCallback(async () => {
    if (!siteId) {
      notifyCouponsChange([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/coupons?siteId=${encodeURIComponent(siteId)}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as { coupons?: unknown; message?: string; error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || "优惠券加载失败");
      }
      const nextCoupons = normalizeMerchantCouponRecords(payload?.coupons);
      notifyCouponsChange(nextCoupons);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "优惠券加载失败");
      notifyCouponsChange([]);
    } finally {
      setLoading(false);
    }
  }, [notifyCouponsChange, siteId]);

  useEffect(() => {
    void loadCoupons();
  }, [loadCoupons]);

  function updateField<K extends keyof CouponFormState>(key: K, value: CouponFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleInputChange<K extends keyof CouponFormState>(key: K) {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      updateField(key, event.target.value as CouponFormState[K]);
    };
  }

  function buildPayload(): MerchantCouponInput {
    return {
      siteId,
      title: form.title.trim() || "优惠券",
      code: form.code.trim(),
      description: form.description.trim(),
      discountType: form.discountType,
      discountValue: toNumberValue(form.discountValue),
      minimumAmount: toNumberValue(form.minimumAmount),
      maxDiscountAmount: toNumberValue(form.maxDiscountAmount),
      totalQuantity: toIntValue(form.totalQuantity),
      perCustomerLimit: Math.max(1, toIntValue(form.perCustomerLimit) || 1),
      startsAt: fromDateTimeTextValue(form.startsAt),
      expiresAt: fromDateTimeTextValue(form.expiresAt),
      status: form.status === "archived" ? "paused" : form.status,
      showOnWebsite: form.showOnWebsite,
      showOnContactCard: form.showOnContactCard,
      applicableTags: splitTags(form.applicableTags),
    };
  }

  async function saveCoupon() {
    if (!siteId || saving) return;
    setSaving(true);
    setError("");
    setTip("");
    try {
      const editing = Boolean(form.id);
      const response = await fetch("/api/coupons", {
        method: editing ? "PATCH" : "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editing
            ? {
                siteId,
                couponId: form.id,
                patch: buildPayload(),
              }
            : buildPayload(),
        ),
      });
      const payload = (await response.json().catch(() => null)) as { coupon?: MerchantCouponRecord; message?: string; error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || "优惠券保存失败");
      }
      if (payload?.coupon?.id) {
        setForm(buildFormFromCoupon(payload.coupon));
      }
      await loadCoupons();
      setTip(editing ? "优惠券已更新" : "优惠券已创建");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "优惠券保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function patchCoupon(coupon: MerchantCouponRecord, patch: MerchantCouponInput, successMessage: string) {
    if (!siteId || saving) return;
    setSaving(true);
    setError("");
    setTip("");
    try {
      const response = await fetch("/api/coupons", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, couponId: coupon.id, patch }),
      });
      const payload = (await response.json().catch(() => null)) as { coupon?: MerchantCouponRecord; message?: string; error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || "优惠券更新失败");
      }
      if (payload?.coupon?.id === form.id) {
        setForm(buildFormFromCoupon(payload.coupon));
      }
      await loadCoupons();
      setTip(successMessage);
    } catch (patchError) {
      setError(patchError instanceof Error ? patchError.message : "优惠券更新失败");
    } finally {
      setSaving(false);
    }
  }

  async function archiveCoupon(coupon: MerchantCouponRecord) {
    if (!siteId || saving) return;
    setSaving(true);
    setError("");
    setTip("");
    try {
      const response = await fetch("/api/coupons", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, couponId: coupon.id }),
      });
      const payload = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || "优惠券删除失败");
      }
      if (form.id === coupon.id) {
        setForm(EMPTY_FORM);
      }
      await loadCoupons();
      setTip("优惠券已删除");
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "优惠券删除失败");
    } finally {
      setSaving(false);
    }
  }

  async function copyCode(coupon: MerchantCouponRecord) {
    try {
      await navigator.clipboard?.writeText(coupon.code);
      setTip("优惠码已复制");
    } catch {
      setTip("复制失败，请手动复制");
    }
  }

  const formTitle = form.id ? "修改优惠券" : "新建优惠券";
  const discountHelper =
    form.discountType === "percent_off"
      ? "折扣值填百分比，例如 10 表示 10% off。"
      : form.discountType === "threshold_amount_off"
        ? "门槛金额和优惠金额都会展示在网站优惠券区块中。"
        : "立减金额不要求订单达到门槛。";

  return (
    <div className={`min-h-[calc(100vh-14rem)] space-y-4 ${className}`}>
      <section className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-slate-950">优惠券管理</div>
            <div className="mt-1 text-sm text-slate-500">
              {siteName ? `${siteName} · ` : ""}这里维护真实优惠券，网站编辑里的优惠券区块会读取启用且允许展示的优惠券。
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
              onClick={() => void loadCoupons()}
              disabled={loading || !siteId}
            >
              {loading ? "刷新中..." : "刷新"}
            </button>
            <button
              type="button"
              className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50"
              onClick={() => {
                setForm(EMPTY_FORM);
                setError("");
                setTip("");
              }}
            >
              新建优惠券
            </button>
            {onClose ? (
              <button type="button" className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50" onClick={onClose}>
                关闭
              </button>
            ) : null}
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-xs text-slate-500">优惠券总数</div>
            <div className="mt-1 text-xl font-semibold text-slate-900">{coupons.length}</div>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <div className="text-xs text-emerald-700">网站展示中</div>
            <div className="mt-1 text-xl font-semibold text-emerald-700">{activeVisibleCount}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-xs text-slate-500">当前状态</div>
            <div className="mt-1 text-xl font-semibold text-slate-900">{loading ? "加载中" : siteId ? "可编辑" : "未就绪"}</div>
          </div>
        </div>
        {error ? <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</div> : null}
        {tip ? <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{tip}</div> : null}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(360px,0.9fr)_minmax(0,1.1fr)]">
        <section className="rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-base font-semibold text-slate-900">{formTitle}</div>
              <div className="mt-1 text-xs text-slate-500">{discountHelper}</div>
            </div>
            {selectedCoupon ? (
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_CLASS_NAMES[selectedCoupon.status]}`}>
                {STATUS_LABELS[selectedCoupon.status]}
              </span>
            ) : null}
          </div>

          <div className="mt-5 grid gap-4">
            <label className="space-y-1 text-sm">
              <span className="block text-slate-600">优惠券名称</span>
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                value={form.title}
                onChange={handleInputChange("title")}
                placeholder="例如：新客户优惠"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="block text-slate-600">优惠码</span>
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 uppercase outline-none focus:border-slate-500"
                value={form.code}
                onChange={handleInputChange("code")}
                placeholder="留空会自动生成"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="block text-slate-600">说明</span>
              <textarea
                className="min-h-[86px] w-full resize-y rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                value={form.description}
                onChange={handleInputChange("description")}
                placeholder="展示给客户看的使用说明"
              />
            </label>

            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1 text-sm">
                <span className="block text-slate-600">优惠类型</span>
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                  value={form.discountType}
                  onChange={(event) => updateField("discountType", event.target.value as MerchantCouponDiscountType)}
                >
                  <option value="threshold_amount_off">满减</option>
                  <option value="amount_off">立减</option>
                  <option value="percent_off">折扣比例</option>
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="block text-slate-600">{form.discountType === "percent_off" ? "折扣百分比" : "优惠金额"}</span>
                <input
                  type="number"
                  min={0}
                  step={form.discountType === "percent_off" ? 1 : 0.01}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                  value={form.discountValue}
                  onChange={handleInputChange("discountValue")}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="block text-slate-600">门槛金额</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                  value={form.minimumAmount}
                  onChange={handleInputChange("minimumAmount")}
                  disabled={form.discountType === "amount_off"}
                />
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1 text-sm">
                <span className="block text-slate-600">总数量</span>
                <input
                  type="number"
                  min={0}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                  value={form.totalQuantity}
                  onChange={handleInputChange("totalQuantity")}
                  placeholder="0 表示不限"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="block text-slate-600">每人限制</span>
                <input
                  type="number"
                  min={1}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                  value={form.perCustomerLimit}
                  onChange={handleInputChange("perCustomerLimit")}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="block text-slate-600">最大优惠</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                  value={form.maxDiscountAmount}
                  onChange={handleInputChange("maxDiscountAmount")}
                  placeholder="比例折扣可用"
                />
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <CouponDateTimeField
                label="开始时间"
                value={form.startsAt}
                onChange={(value) => updateField("startsAt", value)}
                placeholder="例如：2026-05-16 18:30"
              />
              <CouponDateTimeField
                label="结束时间"
                value={form.expiresAt}
                onChange={(value) => updateField("expiresAt", value)}
                placeholder="例如：2026-12-31 23:59"
              />
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1 text-sm">
                <span className="block text-slate-600">状态</span>
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                  value={form.status}
                  onChange={(event) => updateField("status", event.target.value as MerchantCouponStatus)}
                >
                  <option value="active">启用</option>
                  <option value="paused">暂停</option>
                </select>
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.showOnWebsite}
                  onChange={(event) => updateField("showOnWebsite", event.target.checked)}
                />
                网站区块展示
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.showOnContactCard}
                  onChange={(event) => updateField("showOnContactCard", event.target.checked)}
                />
                联系卡展示
              </label>
            </div>

            <label className="space-y-1 text-sm">
              <span className="block text-slate-600">适用标签</span>
              <textarea
                className="min-h-[70px] w-full resize-y rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                value={form.applicableTags}
                onChange={handleInputChange("applicableTags")}
                placeholder="可选，一行一个或用逗号分隔"
              />
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                onClick={() => void saveCoupon()}
                disabled={saving || !siteId}
              >
                {saving ? "保存中..." : form.id ? "保存修改" : "创建优惠券"}
              </button>
              {form.id ? (
                <button
                  type="button"
                  className="rounded-lg border bg-white px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                  onClick={() => {
                    setForm(EMPTY_FORM);
                    setError("");
                    setTip("");
                  }}
                  disabled={saving}
                >
                  取消编辑
                </button>
              ) : null}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-base font-semibold text-slate-900">优惠券列表</div>
              <div className="mt-1 text-xs text-slate-500">启用、未过期、且勾选网站展示的优惠券会显示到优惠券区块。</div>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {loading ? (
              <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">正在加载优惠券...</div>
            ) : coupons.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                还没有优惠券。先创建一张，并保持“网站区块展示”开启。
              </div>
            ) : (
              coupons.map((coupon) => {
                const selected = coupon.id === form.id;
                const archived = coupon.status === "archived";
                return (
                  <article
                    key={coupon.id}
                    className={`rounded-2xl border px-4 py-4 transition ${
                      selected ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white hover:border-slate-300"
                    } ${archived ? "opacity-70" : ""}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setForm(buildFormFromCoupon(coupon))}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-base font-semibold text-slate-950">{coupon.title}</span>
                          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLASS_NAMES[coupon.status]}`}>
                            {STATUS_LABELS[coupon.status]}
                          </span>
                          {coupon.showOnWebsite && coupon.status === "active" ? (
                            <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[11px] font-semibold text-cyan-700">
                              网站展示
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-rose-500">
                          {getMerchantCouponDiscountLabel(coupon, pricePrefix)}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                          <span>优惠码：{coupon.code}</span>
                          <span>剩余：{getRemainingCount(coupon)}</span>
                          <span>已用：{coupon.usedCount}</span>
                          <span>有效期：{formatDateTime(coupon.expiresAt)}</span>
                        </div>
                      </button>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded border bg-white px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"
                          onClick={() => void copyCode(coupon)}
                          disabled={saving}
                        >
                          复制码
                        </button>
                        {archived ? (
                          <button
                            type="button"
                            className="rounded border bg-white px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"
                            onClick={() => void patchCoupon(coupon, { status: "active", showOnWebsite: true }, "优惠券已恢复")}
                            disabled={saving}
                          >
                            恢复
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="rounded border bg-white px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"
                              onClick={() =>
                                void patchCoupon(
                                  coupon,
                                  { status: coupon.status === "active" ? "paused" : "active" },
                                  coupon.status === "active" ? "优惠券已暂停" : "优惠券已启用",
                                )
                              }
                              disabled={saving}
                            >
                              {coupon.status === "active" ? "暂停" : "启用"}
                            </button>
                            <button
                              type="button"
                              className="rounded border border-rose-200 bg-white px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                              onClick={() => void archiveCoupon(coupon)}
                              disabled={saving}
                            >
                              删除
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
