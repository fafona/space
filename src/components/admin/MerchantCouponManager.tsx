"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type ReactNode } from "react";
import { getBackgroundStyle } from "@/components/blocks/backgroundStyle";
import { loadEuropeLocationOptionsApi, type EuropeLocationOptionsApi } from "@/lib/europeLocationOptionsLoader";
import { showGlobalToast } from "@/lib/globalToast";
import {
  MERCHANT_ADMIN_DATA_CACHE_TTL_MS,
  fetchMerchantAdminDataWithCache,
  makeMerchantAdminDataCacheKey,
  readMerchantAdminDataCacheSnapshot,
} from "@/lib/merchantAdminDataCache";
import { createClientMutationOperationId } from "@/lib/mutationOperationId";
import { normalizePublicAssetUrl } from "@/lib/publicAssetUrl";
import {
  MERCHANT_COUPON_BEHAVIOR_TRIGGERS,
  MERCHANT_COUPON_DISPLAY_BOX_STYLES,
  MERCHANT_COUPON_DISPLAY_FIELDS,
  MERCHANT_COUPON_TASK_REQUIREMENTS,
  MERCHANT_COUPON_USAGE_SCENARIOS,
  getContactCardVisibleMerchantCoupons,
  getMerchantCouponDisplayBoxColor,
  getMerchantCouponDisplayBoxStyle,
  getMerchantCouponDisplayButtonText,
  getMerchantCouponDisplayDescription,
  getMerchantCouponDisplayFieldOrder,
  getMerchantCouponDisplayMetaText,
  getMerchantCouponDisplayTitle,
  getMerchantCouponDiscountLabel,
  getVisibleMerchantCoupons,
  isMerchantCouponDisplayFieldHidden,
  normalizeMerchantCouponRecords,
  type MerchantCouponBehaviorTrigger,
  type MerchantCouponDisplayBoxStyle,
  type MerchantCouponDisplayField,
  type MerchantCouponDiscountType,
  type MerchantCouponInput,
  type MerchantCouponRecord,
  type MerchantCouponStatus,
  type MerchantCouponTaskRequirement,
  type MerchantCouponUsageScenario,
} from "@/lib/merchantCoupons";

type MerchantCouponManagerProps = {
  siteId: string;
  siteName?: string;
  publicSiteUrl?: string;
  couponPageId?: string;
  pricePrefix?: string;
  view?: "list" | "redeemWorkbench" | "claims" | "redemptions" | "dailyStats";
  onCouponsChange?: (coupons: MerchantCouponRecord[]) => void;
  onClose?: () => void;
  className?: string;
  listOnly?: boolean;
};

type LocationRuleField = "claimAllowedCountries" | "claimAllowedProvinces" | "claimAllowedCities";

type CouponFormState = {
  id: string;
  title: string;
  code: string;
  description: string;
  discountType: MerchantCouponDiscountType;
  discountValue: string;
  minimumAmount: string;
  pointsVoucherMaxPerRedemption: string;
  pointsVoucherMinimumRedeemPoints: string;
  productName: string;
  productBarcode: string;
  productQuantity: string;
  productAmount: string;
  exchangeItem: string;
  exchangeQuantity: string;
  ticketVenue: string;
  ticketDurationMinutes: string;
  maxDiscountAmount: string;
  totalQuantity: string;
  perCustomerLimit: string;
  startsAt: string;
  expiresAt: string;
  status: MerchantCouponStatus;
  showOnWebsite: boolean;
  showOnContactCard: boolean;
  backgroundImageUrl: string;
  backgroundImageOpacity: string;
  usageScenarios: MerchantCouponUsageScenario[];
  displayTitle: string;
  displayDescription: string;
  displayDiscountText: string;
  displayMetaText: string;
  displayButtonText: string;
  displayFieldOrder: MerchantCouponDisplayField[];
  displayHiddenFields: MerchantCouponDisplayField[];
  displayBoxStyles: Record<MerchantCouponDisplayField, MerchantCouponDisplayBoxStyle>;
  displayBoxColors: Record<MerchantCouponDisplayField, string>;
  contentFontFamily: string;
  discountTextColor: string;
  discountFontSize: string;
  titleTextColor: string;
  titleFontSize: string;
  descriptionTextColor: string;
  descriptionFontSize: string;
  metaTextColor: string;
  metaFontSize: string;
  buttonTextColor: string;
  buttonFontSize: string;
  claimRequiresMember: boolean;
  claimOldUserOnly: boolean;
  claimMinRegisteredDays: string;
  claimMinSpendAmount: string;
  claimMinOrderCount: string;
  claimAllowedAccountIds: string;
  claimAllowedCountries: string;
  claimAllowedProvinces: string;
  claimAllowedCities: string;
  claimAllowedCodes: string;
  claimPerUserTotalLimit: string;
  claimPerUserDailyLimit: string;
  claimPerUserWeeklyLimit: string;
  claimPerUserMonthlyLimit: string;
  claimDateTimeWindows: string;
  claimDailyTimeWindows: string;
  claimValidHoursAfterClaim: string;
  claimValidDaysAfterClaim: string;
  claimMonthlyStockLimit: string;
  claimWeeklyStockLimit: string;
  claimDailyStockLimit: string;
  claimHourlyStockLimit: string;
  claimBehaviorTriggers: MerchantCouponBehaviorTrigger[];
  claimTriggerAmount: string;
  claimTriggerCount: string;
  claimTriggerDate: string;
  claimTaskRequirements: MerchantCouponTaskRequirement[];
  claimTaskPageUrl: string;
  claimTaskInviteCount: string;
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
  pointsVoucherMaxPerRedemption: "",
  pointsVoucherMinimumRedeemPoints: "",
  productName: "",
  productBarcode: "",
  productQuantity: "",
  productAmount: "",
  exchangeItem: "",
  exchangeQuantity: "",
  ticketVenue: "",
  ticketDurationMinutes: "",
  maxDiscountAmount: "",
  totalQuantity: "",
  perCustomerLimit: "",
  startsAt: "",
  expiresAt: "",
  status: "active",
  showOnWebsite: true,
  showOnContactCard: false,
  backgroundImageUrl: "",
  backgroundImageOpacity: "0.35",
  usageScenarios: ["order_cart", "checkout_qr"],
  displayTitle: "",
  displayDescription: "",
  displayDiscountText: "",
  displayMetaText: "",
  displayButtonText: "立即领取",
  displayFieldOrder: [...MERCHANT_COUPON_DISPLAY_FIELDS],
  displayHiddenFields: [],
  displayBoxStyles: {
    discount: "none",
    title: "none",
    description: "none",
    meta: "none",
    button: "solid",
  },
  displayBoxColors: {
    discount: "#f43f5e",
    title: "#020617",
    description: "#64748b",
    meta: "#64748b",
    button: "#020617",
  },
  contentFontFamily: "",
  discountTextColor: "#f43f5e",
  discountFontSize: "12",
  titleTextColor: "#020617",
  titleFontSize: "16",
  descriptionTextColor: "#64748b",
  descriptionFontSize: "14",
  metaTextColor: "#64748b",
  metaFontSize: "12",
  buttonTextColor: "#ffffff",
  buttonFontSize: "14",
  claimRequiresMember: false,
  claimOldUserOnly: false,
  claimMinRegisteredDays: "",
  claimMinSpendAmount: "",
  claimMinOrderCount: "",
  claimAllowedAccountIds: "",
  claimAllowedCountries: "",
  claimAllowedProvinces: "",
  claimAllowedCities: "",
  claimAllowedCodes: "",
  claimPerUserTotalLimit: "",
  claimPerUserDailyLimit: "",
  claimPerUserWeeklyLimit: "",
  claimPerUserMonthlyLimit: "",
  claimDateTimeWindows: "",
  claimDailyTimeWindows: "",
  claimValidHoursAfterClaim: "",
  claimValidDaysAfterClaim: "",
  claimMonthlyStockLimit: "",
  claimWeeklyStockLimit: "",
  claimDailyStockLimit: "",
  claimHourlyStockLimit: "",
  claimBehaviorTriggers: [],
  claimTriggerAmount: "",
  claimTriggerCount: "",
  claimTriggerDate: "",
  claimTaskRequirements: [],
  claimTaskPageUrl: "",
  claimTaskInviteCount: "",
  applicableTags: "",
};

const GENERATED_DISCOUNT_TEXT_FIELDS = new Set<keyof CouponFormState>([
  "discountType",
  "discountValue",
  "minimumAmount",
  "productName",
  "exchangeItem",
  "ticketVenue",
]);

const GENERATED_META_TEXT_FIELDS = new Set<keyof CouponFormState>([
  "discountValue",
  "minimumAmount",
  "pointsVoucherMaxPerRedemption",
  "pointsVoucherMinimumRedeemPoints",
  "productBarcode",
  "productQuantity",
  "productAmount",
  "exchangeQuantity",
  "ticketDurationMinutes",
  "expiresAt",
]);

type CouponLifecycleStatus = "running" | "ended" | "paused" | "not_started";
type CouponLifecycleStatusFilter = "all" | CouponLifecycleStatus;
type CouponSettingSummaryGroup = {
  title: string;
  items: Array<{ label: string; value: string }>;
};

const COUPON_LIFECYCLE_STATUS_LABELS: Record<CouponLifecycleStatus, string> = {
  running: "进行中",
  ended: "已结束",
  paused: "已暂停",
  not_started: "未开始",
};

const COUPON_LIFECYCLE_STATUS_CLASS_NAMES: Record<CouponLifecycleStatus, string> = {
  running: "border-emerald-200 bg-emerald-50 text-emerald-700",
  ended: "border-slate-200 bg-slate-100 text-slate-500",
  paused: "border-amber-200 bg-amber-50 text-amber-700",
  not_started: "border-cyan-200 bg-cyan-50 text-cyan-700",
};

const COUPON_LIFECYCLE_STATUS_FILTER_OPTIONS: Array<{ value: CouponLifecycleStatusFilter; label: string }> = [
  { value: "all", label: "全部状态" },
  { value: "running", label: "进行中" },
  { value: "not_started", label: "未开始" },
  { value: "ended", label: "已结束" },
  { value: "paused", label: "已暂停" },
];

const USAGE_SCENARIO_LABELS: Record<MerchantCouponUsageScenario, string> = {
  order_cart: "订单",
  checkout_qr: "二维码",
  checkout_barcode: "条码",
  points_redemption: "积分兑换",
};

const COUPON_FONT_OPTIONS = [
  { value: "", label: "默认字体" },
  { value: "Inter, system-ui, sans-serif", label: "系统无衬线" },
  { value: "Microsoft YaHei, PingFang SC, sans-serif", label: "中文清晰" },
  { value: "Georgia, Times New Roman, serif", label: "经典衬线" },
  { value: "Arial Rounded MT Bold, Microsoft YaHei, sans-serif", label: "圆润标题" },
  { value: "Courier New, monospace", label: "等宽代码" },
];

const BEHAVIOR_TRIGGER_OPTIONS: Array<{ value: MerchantCouponBehaviorTrigger; label: string }> = [
  { value: "favorite_site", label: "收藏送券" },
  { value: "first_order", label: "首单送券" },
  { value: "purchase", label: "消费送券" },
  { value: "amount_reached", label: "满额送券" },
  { value: "count_reached", label: "满次送券" },
  { value: "check_in", label: "签到送券" },
  { value: "review", label: "评价送券" },
  { value: "share", label: "分享送券" },
  { value: "favorite_birthday", label: "收藏用户生日送券" },
  { value: "specific_date", label: "指定日期送券" },
];

const TASK_REQUIREMENT_OPTIONS: Array<{ value: MerchantCouponTaskRequirement; label: string }> = [
  { value: "browse_page", label: "浏览指定页面" },
  { value: "questionnaire", label: "完成问卷" },
  { value: "contact_card_added", label: "通过联系卡添加通讯录" },
  { value: "watch_ad", label: "观看广告" },
  { value: "invite_people", label: "邀请X人领取" },
  { value: "share_moments", label: "分享朋友圈领取" },
  { value: "share_tiktok", label: "分享tiktok领取" },
  { value: "share_instagram", label: "分享instagram领取" },
];

const COUPON_DISCOUNT_TYPE_OPTIONS: Array<{ value: MerchantCouponDiscountType; label: string }> = [
  { value: "threshold_amount_off", label: "满减" },
  { value: "amount_off", label: "立减" },
  { value: "percent_off", label: "折扣比例" },
  { value: "product_voucher", label: "商品券" },
  { value: "stored_value", label: "储值券" },
  { value: "exchange_voucher", label: "兑换券" },
  { value: "ticket_voucher", label: "门票券" },
  { value: "points_voucher", label: "积分券" },
];

const DISCOUNT_VALUE_REQUIRED_TYPES: MerchantCouponDiscountType[] = [
  "threshold_amount_off",
  "amount_off",
  "percent_off",
  "stored_value",
  "points_voucher",
];

const COUPON_DISCOUNT_TYPE_LABELS = Object.fromEntries(
  COUPON_DISCOUNT_TYPE_OPTIONS.map((option) => [option.value, option.label]),
) as Record<MerchantCouponDiscountType, string>;

const DISPLAY_BOX_STYLE_LABELS: Record<MerchantCouponDisplayBoxStyle, string> = {
  none: "无框",
  soft: "浅底",
  outline: "描边",
  solid: "实底",
};
const DISPLAY_BOX_STYLE_OPTIONS = MERCHANT_COUPON_DISPLAY_BOX_STYLES.map((value) => ({
  value,
  label: DISPLAY_BOX_STYLE_LABELS[value],
}));

const DISPLAY_FIELD_CONFIG: Record<
  MerchantCouponDisplayField,
  {
    label: string;
    valueKey: "displayDiscountText" | "displayTitle" | "displayDescription" | "displayMetaText" | "displayButtonText";
    colorKey: "discountTextColor" | "titleTextColor" | "descriptionTextColor" | "metaTextColor" | "buttonTextColor";
    sizeKey: "discountFontSize" | "titleFontSize" | "descriptionFontSize" | "metaFontSize" | "buttonFontSize";
    multiline?: boolean;
  }
> = {
  discount: {
    label: "折扣文案",
    valueKey: "displayDiscountText",
    colorKey: "discountTextColor",
    sizeKey: "discountFontSize",
  },
  title: {
    label: "标题",
    valueKey: "displayTitle",
    colorKey: "titleTextColor",
    sizeKey: "titleFontSize",
  },
  description: {
    label: "说明",
    valueKey: "displayDescription",
    colorKey: "descriptionTextColor",
    sizeKey: "descriptionFontSize",
    multiline: true,
  },
  meta: {
    label: "辅助信息",
    valueKey: "displayMetaText",
    colorKey: "metaTextColor",
    sizeKey: "metaFontSize",
    multiline: true,
  },
  button: {
    label: "按钮",
    valueKey: "displayButtonText",
    colorKey: "buttonTextColor",
    sizeKey: "buttonFontSize",
  },
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

function isInvalidDateTimeTextValue(value: string) {
  const raw = value.trim();
  return Boolean(raw) && !fromDateTimeTextValue(raw);
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

function getCouponLifecycleStatusFromValues(
  status: MerchantCouponStatus,
  startsAt: string | null | undefined,
  expiresAt: string | null | undefined,
  nowInput: Date | string = new Date(),
): CouponLifecycleStatus {
  if (status !== "active") return "paused";
  const now = nowInput instanceof Date ? nowInput.getTime() : new Date(nowInput).getTime();
  if (startsAt && Date.parse(startsAt) > now) return "not_started";
  if (expiresAt && Date.parse(expiresAt) < now) return "ended";
  return "running";
}

function getCouponLifecycleStatus(coupon: MerchantCouponRecord, nowInput: Date | string = new Date()): CouponLifecycleStatus {
  return getCouponLifecycleStatusFromValues(coupon.status, coupon.startsAt, coupon.expiresAt, nowInput);
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

function splitRuleList(value: string) {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeLocationOptionText(value: string) {
  return value.trim().toLowerCase();
}

function filterLocationOptions(options: Array<{ value: string; label: string }>, query: string, limit = 40) {
  const normalizedQuery = normalizeLocationOptionText(query);
  if (!normalizedQuery) return options.slice(0, limit);
  const starts: Array<{ value: string; label: string }> = [];
  const includes: Array<{ value: string; label: string }> = [];
  for (const option of options) {
    const value = normalizeLocationOptionText(option.value);
    const label = normalizeLocationOptionText(option.label);
    if (value.startsWith(normalizedQuery) || label.startsWith(normalizedQuery)) {
      starts.push(option);
    } else if (value.includes(normalizedQuery) || label.includes(normalizedQuery)) {
      includes.push(option);
    }
    if (starts.length + includes.length >= limit * 3) break;
  }
  return [...starts, ...includes].slice(0, limit);
}

function normalizeFormUsageScenarios(value: MerchantCouponUsageScenario[]) {
  const selected = value.filter((item) => MERCHANT_COUPON_USAGE_SCENARIOS.includes(item));
  return Array.from(new Set(selected));
}

function normalizeFormUsageScenariosWithDefaultCheckout(value: MerchantCouponUsageScenario[]): MerchantCouponUsageScenario[] {
  const selected = normalizeFormUsageScenarios(value);
  if (selected.includes("checkout_qr") || selected.includes("checkout_barcode")) return selected;
  return [...selected, "checkout_qr"];
}

function formatUsageScenarios(value: MerchantCouponUsageScenario[]) {
  const selected = normalizeFormUsageScenarios(value);
  return selected.map((item) => USAGE_SCENARIO_LABELS[item]).join(" / ") || "未设置";
}

function buildRecordDefaultMetaText(coupon: MerchantCouponRecord, pricePrefix: string) {
  return [
    coupon.discountType === "product_voucher" && coupon.productBarcode ? `条码 ${coupon.productBarcode}` : "",
    coupon.discountType === "product_voucher" && coupon.productQuantity > 0 ? `数量 ${coupon.productQuantity}` : "",
    coupon.discountType === "product_voucher" && coupon.productAmount > 0 ? `商品金额 ${pricePrefix}${coupon.productAmount.toFixed(2)}` : "",
    coupon.discountType === "exchange_voucher" && coupon.exchangeQuantity > 0 ? `数量 ${coupon.exchangeQuantity}` : "",
    coupon.discountType === "ticket_voucher" && coupon.ticketDurationMinutes > 0 ? `时长 ${coupon.ticketDurationMinutes} min` : "",
    coupon.discountType === "points_voucher" && coupon.discountValue > 0 ? `抵扣 ${Math.round(coupon.discountValue)} 积分` : "",
    coupon.discountType === "points_voucher" && coupon.pointsVoucherMinimumRedeemPoints > 0
      ? `满 ${coupon.pointsVoucherMinimumRedeemPoints} 积分可用`
      : "",
    coupon.discountType === "points_voucher" && coupon.pointsVoucherMaxPerRedemption > 0
      ? `单次最多 ${coupon.pointsVoucherMaxPerRedemption} 张`
      : "",
    coupon.discountType !== "points_voucher" && coupon.minimumAmount > 0
      ? `门槛 ${pricePrefix}${coupon.minimumAmount.toFixed(2)}`
      : "",
    formatUsageScenarios(coupon.usageScenarios),
    coupon.expiresAt ? `至 ${formatDateTime(coupon.expiresAt)}` : "",
  ]
    .filter(Boolean)
    .join("  ");
}

function buildCouponClaimUrl(publicSiteUrl: string | undefined, siteId: string, coupon: MerchantCouponRecord, couponPageId?: string) {
  if (typeof window === "undefined") return "";
  const fallbackPath = siteId ? `/site/${encodeURIComponent(siteId)}` : window.location.pathname;
  try {
    const url = new URL(publicSiteUrl?.trim() || fallbackPath, window.location.origin);
    const targetPageId = couponPageId?.trim();
    if (targetPageId) {
      url.searchParams.set("couponPageId", targetPageId);
    }
    url.searchParams.set("claimCoupon", coupon.id);
    url.hash = `coupon-${coupon.id}`;
    return url.toString();
  } catch {
    return "";
  }
}

function buildShareableCouponText(coupon: MerchantCouponRecord, pricePrefix: string, siteName?: string, claimUrl?: string) {
  const lines = [
    siteName ? `【${siteName}】优惠券` : "优惠券",
    getMerchantCouponDisplayTitle(coupon),
    `优惠内容：${getMerchantCouponDiscountLabel(coupon, pricePrefix)}`,
    claimUrl ? `领取链接：${claimUrl}` : "",
    getMerchantCouponDisplayDescription(coupon) ? `说明：${getMerchantCouponDisplayDescription(coupon)}` : "",
    coupon.expiresAt ? `有效期至：${formatDateTime(coupon.expiresAt)}` : "",
  ];
  return lines.filter((line) => line.trim()).join("\n");
}

function buildFormGeneratedDiscountText(form: CouponFormState, pricePrefix: string) {
  const discountValue = toNumberValue(form.discountValue);
  const minimumAmount = toNumberValue(form.minimumAmount);
  if (form.discountType === "percent_off") return `${discountValue || 0}% OFF`;
  if (form.discountType === "threshold_amount_off") return `满 ${pricePrefix}${minimumAmount.toFixed(2)} 减 ${pricePrefix}${discountValue.toFixed(2)}`;
  if (form.discountType === "product_voucher") return form.productName.trim() ? `商品券：${form.productName.trim()}` : "商品券";
  if (form.discountType === "stored_value") return `储值 ${pricePrefix}${discountValue.toFixed(2)}`;
  if (form.discountType === "exchange_voucher") return form.exchangeItem.trim() ? `兑换券：${form.exchangeItem.trim()}` : "兑换券";
  if (form.discountType === "ticket_voucher") return form.ticketVenue.trim() ? `门票券：${form.ticketVenue.trim()}` : "门票券";
  if (form.discountType === "points_voucher") return `积分券：抵扣 ${Math.max(0, Math.round(discountValue))} 积分`;
  return `减 ${pricePrefix}${discountValue.toFixed(2)}`;
}

function buildFormDefaultMetaText(form: CouponFormState, pricePrefix: string) {
  const minimumAmount = toNumberValue(form.minimumAmount);
  return [
    form.discountType === "product_voucher" && form.productBarcode.trim() ? `条码 ${form.productBarcode.trim()}` : "",
    form.discountType === "product_voucher" && toIntValue(form.productQuantity) > 0 ? `数量 ${toIntValue(form.productQuantity)}` : "",
    form.discountType === "product_voucher" && toNumberValue(form.productAmount) > 0 ? `商品金额 ${pricePrefix}${toNumberValue(form.productAmount).toFixed(2)}` : "",
    form.discountType === "exchange_voucher" && toIntValue(form.exchangeQuantity) > 0 ? `数量 ${toIntValue(form.exchangeQuantity)}` : "",
    form.discountType === "ticket_voucher" && toIntValue(form.ticketDurationMinutes) > 0 ? `时长 ${toIntValue(form.ticketDurationMinutes)} min` : "",
    form.discountType === "points_voucher" && toNumberValue(form.discountValue) > 0
      ? `抵扣 ${Math.round(toNumberValue(form.discountValue))} 积分`
      : "",
    form.discountType === "points_voucher" && toIntValue(form.pointsVoucherMinimumRedeemPoints) > 0
      ? `满 ${toIntValue(form.pointsVoucherMinimumRedeemPoints)} 积分可用`
      : "",
    form.discountType === "points_voucher" && toIntValue(form.pointsVoucherMaxPerRedemption) > 0
      ? `单次最多 ${toIntValue(form.pointsVoucherMaxPerRedemption)} 张`
      : "",
    form.discountType !== "points_voucher" && minimumAmount > 0 ? `门槛 ${pricePrefix}${minimumAmount.toFixed(2)}` : "",
    formatUsageScenarios(form.usageScenarios),
    fromDateTimeTextValue(form.expiresAt) ? `至 ${formatDateTime(fromDateTimeTextValue(form.expiresAt))}` : "",
  ]
    .filter(Boolean)
    .join("  ");
}

function buildNewCouponForm(pricePrefix: string): CouponFormState {
  const next = {
    ...EMPTY_FORM,
    displayFieldOrder: [...MERCHANT_COUPON_DISPLAY_FIELDS],
    displayHiddenFields: [],
    displayBoxStyles: { ...EMPTY_FORM.displayBoxStyles },
    displayBoxColors: { ...EMPTY_FORM.displayBoxColors },
    usageScenarios: [...EMPTY_FORM.usageScenarios],
    claimBehaviorTriggers: [...EMPTY_FORM.claimBehaviorTriggers],
    claimTaskRequirements: [...EMPTY_FORM.claimTaskRequirements],
    displayTitle: EMPTY_FORM.title || "优惠券",
    displayDescription: "展示给客户看的使用说明",
  };
  next.displayDiscountText = buildFormGeneratedDiscountText(next, pricePrefix);
  next.displayMetaText = buildFormDefaultMetaText(next, pricePrefix);
  return next;
}

function buildFormFromCoupon(coupon: MerchantCouponRecord, pricePrefix: string): CouponFormState {
  const hiddenFields = MERCHANT_COUPON_DISPLAY_FIELDS.filter((field) => isMerchantCouponDisplayFieldHidden(coupon, field));
  return {
    id: coupon.id,
    title: coupon.title,
    code: coupon.code,
    description: coupon.description,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue > 0 ? String(coupon.discountValue) : "",
    minimumAmount: coupon.minimumAmount > 0 ? String(coupon.minimumAmount) : "",
    pointsVoucherMaxPerRedemption:
      coupon.pointsVoucherMaxPerRedemption > 0 ? String(coupon.pointsVoucherMaxPerRedemption) : "",
    pointsVoucherMinimumRedeemPoints:
      coupon.pointsVoucherMinimumRedeemPoints > 0 ? String(coupon.pointsVoucherMinimumRedeemPoints) : "",
    productName: coupon.productName,
    productBarcode: coupon.productBarcode,
    productQuantity: coupon.productQuantity > 0 ? String(coupon.productQuantity) : "",
    productAmount: coupon.productAmount > 0 ? String(coupon.productAmount) : "",
    exchangeItem: coupon.exchangeItem,
    exchangeQuantity: coupon.exchangeQuantity > 0 ? String(coupon.exchangeQuantity) : "",
    ticketVenue: coupon.ticketVenue,
    ticketDurationMinutes: coupon.ticketDurationMinutes > 0 ? String(coupon.ticketDurationMinutes) : "",
    maxDiscountAmount: "",
    totalQuantity: coupon.totalQuantity > 0 ? String(coupon.totalQuantity) : "",
    perCustomerLimit: "",
    startsAt: toDateTimeTextValue(coupon.startsAt),
    expiresAt: toDateTimeTextValue(coupon.expiresAt),
    status: coupon.status,
    showOnWebsite: coupon.showOnWebsite,
    showOnContactCard: coupon.showOnContactCard,
    backgroundImageUrl: coupon.backgroundImageUrl,
    backgroundImageOpacity: String(coupon.backgroundImageOpacity),
    usageScenarios: normalizeFormUsageScenariosWithDefaultCheckout(coupon.usageScenarios),
    displayTitle: hiddenFields.includes("title") ? "" : getMerchantCouponDisplayTitle(coupon),
    displayDescription: hiddenFields.includes("description") ? "" : getMerchantCouponDisplayDescription(coupon),
    displayDiscountText: hiddenFields.includes("discount") ? "" : getMerchantCouponDiscountLabel(coupon, pricePrefix),
    displayMetaText: hiddenFields.includes("meta") ? "" : getMerchantCouponDisplayMetaText(coupon) || buildRecordDefaultMetaText(coupon, pricePrefix),
    displayButtonText: hiddenFields.includes("button") ? "" : getMerchantCouponDisplayButtonText(coupon),
    displayFieldOrder: getMerchantCouponDisplayFieldOrder(coupon),
    displayHiddenFields: hiddenFields,
    displayBoxStyles: {
      discount: getMerchantCouponDisplayBoxStyle(coupon, "discount"),
      title: getMerchantCouponDisplayBoxStyle(coupon, "title"),
      description: getMerchantCouponDisplayBoxStyle(coupon, "description"),
      meta: getMerchantCouponDisplayBoxStyle(coupon, "meta"),
      button: getMerchantCouponDisplayBoxStyle(coupon, "button"),
    },
    displayBoxColors: {
      discount: getMerchantCouponDisplayBoxColor(coupon, "discount"),
      title: getMerchantCouponDisplayBoxColor(coupon, "title"),
      description: getMerchantCouponDisplayBoxColor(coupon, "description"),
      meta: getMerchantCouponDisplayBoxColor(coupon, "meta"),
      button: getMerchantCouponDisplayBoxColor(coupon, "button"),
    },
    contentFontFamily: coupon.contentFontFamily,
    discountTextColor: coupon.discountTextColor || "#f43f5e",
    discountFontSize: coupon.discountFontSize > 0 ? String(coupon.discountFontSize) : "12",
    titleTextColor: coupon.titleTextColor || "#020617",
    titleFontSize: coupon.titleFontSize > 0 ? String(coupon.titleFontSize) : "16",
    descriptionTextColor: coupon.descriptionTextColor || "#64748b",
    descriptionFontSize: coupon.descriptionFontSize > 0 ? String(coupon.descriptionFontSize) : "14",
    metaTextColor: coupon.metaTextColor || "#64748b",
    metaFontSize: coupon.metaFontSize > 0 ? String(coupon.metaFontSize) : "12",
    buttonTextColor: coupon.buttonTextColor || "#ffffff",
    buttonFontSize: coupon.buttonFontSize > 0 ? String(coupon.buttonFontSize) : "14",
    claimRequiresMember: coupon.claimRequiresMember,
    claimOldUserOnly: coupon.claimOldUserOnly,
    claimMinRegisteredDays: coupon.claimMinRegisteredDays > 0 ? String(coupon.claimMinRegisteredDays) : "",
    claimMinSpendAmount: coupon.claimMinSpendAmount > 0 ? String(coupon.claimMinSpendAmount) : "",
    claimMinOrderCount: coupon.claimMinOrderCount > 0 ? String(coupon.claimMinOrderCount) : "",
    claimAllowedAccountIds: coupon.claimAllowedAccountIds.join("\n"),
    claimAllowedCountries: coupon.claimAllowedCountries.join("\n"),
    claimAllowedProvinces: coupon.claimAllowedProvinces.join("\n"),
    claimAllowedCities: coupon.claimAllowedCities.join("\n"),
    claimAllowedCodes: coupon.claimAllowedCodes.join("\n"),
    claimPerUserTotalLimit: coupon.claimPerUserTotalLimit > 0 ? String(coupon.claimPerUserTotalLimit) : "",
    claimPerUserDailyLimit: coupon.claimPerUserDailyLimit > 0 ? String(coupon.claimPerUserDailyLimit) : "",
    claimPerUserWeeklyLimit: coupon.claimPerUserWeeklyLimit > 0 ? String(coupon.claimPerUserWeeklyLimit) : "",
    claimPerUserMonthlyLimit: coupon.claimPerUserMonthlyLimit > 0 ? String(coupon.claimPerUserMonthlyLimit) : "",
    claimDateTimeWindows: coupon.claimDateTimeWindows.join("\n"),
    claimDailyTimeWindows: coupon.claimDailyTimeWindows.join("\n"),
    claimValidHoursAfterClaim: coupon.claimValidHoursAfterClaim > 0 ? String(coupon.claimValidHoursAfterClaim) : "",
    claimValidDaysAfterClaim: coupon.claimValidDaysAfterClaim > 0 ? String(coupon.claimValidDaysAfterClaim) : "",
    claimMonthlyStockLimit: coupon.claimMonthlyStockLimit > 0 ? String(coupon.claimMonthlyStockLimit) : "",
    claimWeeklyStockLimit: coupon.claimWeeklyStockLimit > 0 ? String(coupon.claimWeeklyStockLimit) : "",
    claimDailyStockLimit: coupon.claimDailyStockLimit > 0 ? String(coupon.claimDailyStockLimit) : "",
    claimHourlyStockLimit: coupon.claimHourlyStockLimit > 0 ? String(coupon.claimHourlyStockLimit) : "",
    claimBehaviorTriggers: coupon.claimBehaviorTriggers.filter((item) => MERCHANT_COUPON_BEHAVIOR_TRIGGERS.includes(item)),
    claimTriggerAmount: coupon.claimTriggerAmount > 0 ? String(coupon.claimTriggerAmount) : "",
    claimTriggerCount: coupon.claimTriggerCount > 0 ? String(coupon.claimTriggerCount) : "",
    claimTriggerDate: toDateTimeTextValue(coupon.claimTriggerDate),
    claimTaskRequirements: coupon.claimTaskRequirements.filter((item) => MERCHANT_COUPON_TASK_REQUIREMENTS.includes(item)),
    claimTaskPageUrl: coupon.claimTaskPageUrl,
    claimTaskInviteCount: coupon.claimTaskInviteCount > 0 ? String(coupon.claimTaskInviteCount) : "",
    applicableTags: coupon.applicableTags.join("\n"),
  };
}

function buildCouponVisualDataFromRecord(coupon: MerchantCouponRecord, pricePrefix: string): CouponVisualCardData {
  const customMeta = getMerchantCouponDisplayMetaText(coupon);
  const defaultMetaText = [
    coupon.discountType === "product_voucher" && coupon.productBarcode ? `条码 ${coupon.productBarcode}` : "",
    coupon.discountType === "product_voucher" && coupon.productQuantity > 0 ? `数量 ${coupon.productQuantity}` : "",
    coupon.discountType === "product_voucher" && coupon.productAmount > 0 ? `商品金额 ${pricePrefix}${coupon.productAmount.toFixed(2)}` : "",
    coupon.discountType === "exchange_voucher" && coupon.exchangeQuantity > 0 ? `数量 ${coupon.exchangeQuantity}` : "",
    coupon.discountType === "ticket_voucher" && coupon.ticketDurationMinutes > 0 ? `时长 ${coupon.ticketDurationMinutes} min` : "",
    coupon.discountType === "points_voucher" && coupon.discountValue > 0 ? `抵扣 ${Math.round(coupon.discountValue)} 积分` : "",
    coupon.discountType === "points_voucher" && coupon.pointsVoucherMinimumRedeemPoints > 0
      ? `满 ${coupon.pointsVoucherMinimumRedeemPoints} 积分可用`
      : "",
    coupon.discountType === "points_voucher" && coupon.pointsVoucherMaxPerRedemption > 0
      ? `单次最多 ${coupon.pointsVoucherMaxPerRedemption} 张`
      : "",
    coupon.discountType !== "points_voucher" && coupon.minimumAmount > 0
      ? `门槛 ${pricePrefix}${coupon.minimumAmount.toFixed(2)}`
      : "",
    formatUsageScenarios(coupon.usageScenarios),
    coupon.expiresAt ? `至 ${formatDateTime(coupon.expiresAt)}` : "",
  ]
    .filter(Boolean)
    .join("  ");
  const itemText: Record<MerchantCouponDisplayField, string> = {
    discount: getMerchantCouponDiscountLabel(coupon, pricePrefix),
    title: getMerchantCouponDisplayTitle(coupon),
    description: getMerchantCouponDisplayDescription(coupon),
    meta: customMeta || defaultMetaText,
    button: getMerchantCouponDisplayButtonText(coupon),
  };
  const displayItems = getMerchantCouponDisplayFieldOrder(coupon)
    .filter((field) => !isMerchantCouponDisplayFieldHidden(coupon, field))
    .map((field) => ({
      field,
      text: itemText[field],
      boxStyle: getMerchantCouponDisplayBoxStyle(coupon, field),
      boxColor: getMerchantCouponDisplayBoxColor(coupon, field),
    }))
    .filter((item) => item.text.trim());
  return {
    displayItems,
    backgroundImageUrl: coupon.backgroundImageUrl,
    backgroundImageOpacity: coupon.backgroundImageOpacity,
    contentFontFamily: coupon.contentFontFamily,
    discountTextColor: coupon.discountTextColor,
    discountFontSize: coupon.discountFontSize,
    titleTextColor: coupon.titleTextColor,
    titleFontSize: coupon.titleFontSize,
    descriptionTextColor: coupon.descriptionTextColor,
    descriptionFontSize: coupon.descriptionFontSize,
    metaTextColor: coupon.metaTextColor,
    metaFontSize: coupon.metaFontSize,
    buttonTextColor: coupon.buttonTextColor,
    buttonFontSize: coupon.buttonFontSize,
  };
}

async function writeClipboardText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  textarea.remove();
  if (!ok) throw new Error("copy_failed");
}

function getCouponRedeemErrorMessage(message: string | undefined) {
  switch (message) {
    case "invalid_coupon_redeem":
    case "invalid_settlement_code":
      return "请输入有效券码";
    case "coupon_claim_not_found":
      return "未找到该券码";
    case "coupon_already_redeemed":
      return "该优惠券已核销";
    case "coupon_not_active":
      return "该优惠券未启用";
    case "coupon_not_started":
      return "该优惠券还未开始";
    case "coupon_expired":
    case "coupon_claim_expired":
      return "该优惠券已过期";
    case "coupon_module_disabled":
      return "当前商户未开通优惠券模块";
    case "unauthorized":
      return "登录状态已失效";
    default:
      return message || "核销失败";
  }
}

function validateCouponForm(form: CouponFormState) {
  const discountValue = toNumberValue(form.discountValue);
  const minimumAmount = toNumberValue(form.minimumAmount);
  const startsAt = fromDateTimeTextValue(form.startsAt);
  const expiresAt = fromDateTimeTextValue(form.expiresAt);

  if (form.discountType === "points_voucher" && Math.round(discountValue) <= 0) return "请填写大于 0 的抵扣积分";
  if (DISCOUNT_VALUE_REQUIRED_TYPES.includes(form.discountType) && discountValue <= 0) return "请填写大于 0 的优惠值";
  if (normalizeFormUsageScenarios(form.usageScenarios).length === 0) return "请至少选择一个使用场景";
  if (form.discountType === "percent_off" && discountValue > 100) return "折扣百分比不能超过 100";
  if (form.discountType === "threshold_amount_off" && minimumAmount <= 0) return "满减券需要填写大于 0 的门槛金额";
  if (form.discountType === "product_voucher" && toIntValue(form.productQuantity) < 0) return "商品数量不能小于 0";
  if (isInvalidDateTimeTextValue(form.startsAt)) return "开始时间格式不正确，请使用 2026-05-16 18:30";
  if (isInvalidDateTimeTextValue(form.expiresAt)) return "结束时间格式不正确，请使用 2026-12-31 23:59";
  if (startsAt && expiresAt && Date.parse(startsAt) > Date.parse(expiresAt)) return "结束时间不能早于开始时间";
  return "";
}

function formatOpacityPercent(value: string) {
  return `${Math.round(Math.max(0, Math.min(1, toNumberValue(value))) * 100)}%`;
}

function normalizeFontSizeInput(value: string) {
  const next = Number.parseFloat(value);
  if (!Number.isFinite(next) || next <= 0) return 0;
  return Math.max(8, Math.min(72, Math.round(next)));
}

type CouponVisualCardData = {
  displayItems: Array<{
    field: MerchantCouponDisplayField;
    text: string;
    boxStyle: MerchantCouponDisplayBoxStyle;
    boxColor: string;
  }>;
  backgroundImageUrl: string;
  backgroundImageOpacity: number;
  contentFontFamily: string;
  discountTextColor: string;
  discountFontSize: number;
  titleTextColor: string;
  titleFontSize: number;
  descriptionTextColor: string;
  descriptionFontSize: number;
  metaTextColor: string;
  metaFontSize: number;
  buttonTextColor: string;
  buttonFontSize: number;
};

function getVisualTextColor(data: CouponVisualCardData, role: MerchantCouponDisplayField) {
  if (role === "discount") return data.discountTextColor;
  if (role === "title") return data.titleTextColor;
  if (role === "description") return data.descriptionTextColor;
  if (role === "button") return data.buttonTextColor;
  return data.metaTextColor;
}

function getVisualFontSize(data: CouponVisualCardData, role: MerchantCouponDisplayField) {
  if (role === "discount") return data.discountFontSize;
  if (role === "title") return data.titleFontSize;
  if (role === "description") return data.descriptionFontSize;
  if (role === "button") return data.buttonFontSize;
  return data.metaFontSize;
}

function colorWithAlpha(color: string, alpha: number) {
  const raw = color.trim();
  const match = raw.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!match) return "";
  const hex =
    match[1].length === 3
      ? match[1]
          .split("")
          .map((item) => `${item}${item}`)
          .join("")
      : match[1];
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function buildTextStyle(data: CouponVisualCardData, role: MerchantCouponDisplayField): CSSProperties {
  const style: CSSProperties = {};
  if (data.contentFontFamily) style.fontFamily = data.contentFontFamily;
  const color = getVisualTextColor(data, role);
  const fontSize = getVisualFontSize(data, role);
  if (color) style.color = color;
  if (fontSize > 0) style.fontSize = `${fontSize}px`;
  return style;
}

function buildBoxStyle(boxColor: string, boxStyle: MerchantCouponDisplayBoxStyle): CSSProperties {
  const color = boxColor || "#020617";
  if (boxStyle === "solid") {
    return {
      backgroundColor: color,
      borderColor: color,
    };
  }
  if (boxStyle === "outline") {
    return {
      borderColor: color,
    };
  }
  if (boxStyle === "soft") {
    return {
      backgroundColor: colorWithAlpha(color, 0.12),
      borderColor: colorWithAlpha(color, 0.22) || color,
    };
  }
  return {};
}

function CouponVisualCard({
  data,
  className = "",
  actionLabel = "立即领取",
  layout = "card",
}: {
  data: CouponVisualCardData;
  className?: string;
  actionLabel?: string;
  layout?: "card" | "list";
}) {
  const isList = layout === "list";
  const cardStyle = getBackgroundStyle({
    imageUrl: data.backgroundImageUrl,
    fillMode: "cover",
    position: "center",
    imageOpacity: data.backgroundImageOpacity,
  });
  return (
    <div
      className={`overflow-hidden rounded-lg border border-slate-200 bg-white/90 p-4 shadow-sm ${
        isList ? "grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" : ""
      } ${className}`}
      style={cardStyle}
    >
      <div className="min-w-0">
        {data.displayItems.map((item, index) => {
          const marginClass = index === 0 ? "" : item.field === "meta" ? "mt-3" : "mt-2";
          const frameClass =
            item.boxStyle === "none"
              ? ""
              : item.field === "button"
                ? "border px-4 py-2"
                : "inline-block max-w-full rounded-md border px-2 py-1";
          const framedStyle = { ...buildTextStyle(data, item.field), ...buildBoxStyle(item.boxColor, item.boxStyle) };
          if (item.field === "button") {
            return (
              <div
                key={item.field}
                className={`${marginClass} inline-flex h-10 w-full items-center justify-center rounded-lg text-sm font-semibold ${frameClass}`}
                style={framedStyle}
              >
                {item.text}
              </div>
            );
          }
          if (item.field === "title") {
            return (
              <div key={item.field} className={`${marginClass} truncate text-base font-bold text-slate-950 ${frameClass}`} style={framedStyle}>
                {item.text}
              </div>
            );
          }
          if (item.field === "description") {
            return (
              <div key={item.field} className={`${marginClass} line-clamp-2 text-sm text-slate-500 ${frameClass}`} style={framedStyle}>
                {item.text}
              </div>
            );
          }
          if (item.field === "meta") {
            return (
              <div key={item.field} className={`${marginClass} text-xs text-slate-500 ${frameClass}`} style={framedStyle}>
                {item.text}
              </div>
            );
          }
          return (
            <div
              key={item.field}
              className={`${marginClass} text-xs font-semibold uppercase tracking-[0.18em] text-rose-500 ${frameClass}`}
              style={framedStyle}
            >
              {item.text}
            </div>
          );
        })}
      </div>
      {data.displayItems.some((item) => item.field === "button") ? null : (
        <div
          className={`inline-flex h-10 w-full items-center justify-center rounded-lg border border-slate-950 bg-slate-950 px-4 text-sm font-semibold text-white ${
            isList ? "sm:w-auto" : "mt-4"
          }`}
        >
          {actionLabel}
        </div>
      )}
    </div>
  );
}

function CouponCalendarIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M6 2.75v2.5M14 2.75v2.5M3.75 7.25h12.5M5.5 4.5h9a1.75 1.75 0 0 1 1.75 1.75v8.25A1.75 1.75 0 0 1 14.5 16.25h-9A1.75 1.75 0 0 1 3.75 14.5V6.25A1.75 1.75 0 0 1 5.5 4.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function openNativeDateTimePicker(input: HTMLInputElement | null) {
  if (!input) return;
  const pickerInput = input as HTMLInputElement & { showPicker?: () => void };
  try {
    pickerInput.focus({ preventScroll: true });
  } catch {
    pickerInput.focus();
  }
  if (typeof pickerInput.showPicker === "function") {
    try {
      pickerInput.showPicker();
      return;
    } catch {
      // Fall back to the native click path when showPicker is blocked.
    }
  }
  try {
    pickerInput.click();
  } catch {
    // Some embedded browsers do not expose a picker for datetime-local.
  }
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
  const pickerInputRef = useRef<HTMLInputElement>(null);

  return (
    <label className="space-y-1 text-sm">
      <span className="block text-slate-600">{label}</span>
      <span className="relative block">
        <input
          type="text"
          inputMode="numeric"
          data-no-translate="1"
          translate="no"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-12 outline-none focus:border-slate-500"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
        />
        <button
          type="button"
          className="absolute inset-y-0 right-2 inline-flex w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
          aria-label={`${label}选择器`}
          onClick={() => openNativeDateTimePicker(pickerInputRef.current)}
        >
          <CouponCalendarIcon />
        </button>
        <input
          ref={pickerInputRef}
          type="datetime-local"
          tabIndex={-1}
          aria-hidden="true"
          className="pointer-events-none absolute right-2 top-1/2 h-8 w-8 -translate-y-1/2 opacity-0"
          value={toDateTimePickerValue(value)}
          onChange={(event) => onChange(toDateTimeTextFromPickerValue(event.target.value))}
        />
      </span>
    </label>
  );
}

function CouponNativePickerField({
  label,
  value,
  pickerType,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  pickerType: "datetime-local" | "time";
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const pickerInputRef = useRef<HTMLInputElement>(null);
  const displayValue = pickerType === "datetime-local" ? toDateTimeTextFromPickerValue(value) : value;

  return (
    <label className="space-y-1 text-xs text-slate-600">
      <span className="block">{label}</span>
      <span className="relative block">
        <input
          type="text"
          readOnly
          data-no-translate="1"
          translate="no"
          className="h-10 w-full cursor-pointer rounded-lg border border-slate-300 bg-white px-2 pr-9 text-sm outline-none focus:border-slate-500"
          value={displayValue}
          placeholder={placeholder}
          onClick={() => openNativeDateTimePicker(pickerInputRef.current)}
        />
        <button
          type="button"
          className="absolute inset-y-0 right-1 inline-flex w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
          aria-label={`${label}选择器`}
          onClick={() => openNativeDateTimePicker(pickerInputRef.current)}
        >
          <CouponCalendarIcon />
        </button>
        <input
          ref={pickerInputRef}
          type={pickerType}
          tabIndex={-1}
          aria-hidden="true"
          className="pointer-events-none absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 opacity-0"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </span>
    </label>
  );
}

function CouponFormSection({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
      <summary className="cursor-pointer select-none text-sm font-semibold text-slate-900">{title}</summary>
      <div className="mt-3 grid gap-3">{children}</div>
    </details>
  );
}

function CouponStatusSwitch({
  checked,
  onChange,
  disabled = false,
  className = "",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"
      } ${className}`}
      onClick={() => onChange(!checked)}
      disabled={disabled}
    >
      <span className={`relative h-5 w-9 rounded-full transition ${checked ? "bg-emerald-500" : "bg-amber-400"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${checked ? "left-4" : "left-0.5"}`} />
      </span>
      {checked ? "启用" : "暂停"}
    </button>
  );
}

export default function MerchantCouponManager({
  siteId,
  siteName,
  publicSiteUrl,
  couponPageId,
  pricePrefix = "",
  view = "list",
  onCouponsChange,
  onClose,
  className = "",
  listOnly = false,
}: MerchantCouponManagerProps) {
  const [coupons, setCoupons] = useState<MerchantCouponRecord[]>([]);
  const [form, setForm] = useState<CouponFormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingBackground, setUploadingBackground] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState("");
  const [tip, setTip] = useState("");
  const [couponStatusFilter, setCouponStatusFilter] = useState<CouponLifecycleStatusFilter>("all");
  const [selectedDisplayFields, setSelectedDisplayFields] = useState<MerchantCouponDisplayField[]>(["discount"]);
  const [locationOptionsApi, setLocationOptionsApi] = useState<EuropeLocationOptionsApi | null>(null);
  const [countryRuleInput, setCountryRuleInput] = useState("");
  const [provinceRuleInput, setProvinceRuleInput] = useState("");
  const [cityRuleInput, setCityRuleInput] = useState("");
  const [claimDateWindowStart, setClaimDateWindowStart] = useState("");
  const [claimDateWindowEnd, setClaimDateWindowEnd] = useState("");
  const [claimDailyWindowStart, setClaimDailyWindowStart] = useState("");
  const [claimDailyWindowEnd, setClaimDailyWindowEnd] = useState("");
  const [redeemCodeInput, setRedeemCodeInput] = useState("");
  const [redeemNote, setRedeemNote] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const backgroundFileInputRef = useRef<HTMLInputElement>(null);
  const couponLoadRequestIdRef = useRef(0);

  const selectedCoupon = useMemo(
    () => coupons.find((coupon) => coupon.id === form.id) ?? null,
    [coupons, form.id],
  );

  const activeVisibleCount = useMemo(
    () => getVisibleMerchantCoupons(coupons).length,
    [coupons],
  );
  const contactCardVisibleCount = useMemo(
    () => getContactCardVisibleMerchantCoupons(coupons).length,
    [coupons],
  );
  const activeCouponCount = useMemo(
    () => coupons.filter((coupon) => coupon.status !== "archived").length,
    [coupons],
  );
  const displayCoupons = useMemo(
    () =>
      coupons
        .filter((coupon) => coupon.status !== "archived")
        .filter((coupon) => couponStatusFilter === "all" || getCouponLifecycleStatus(coupon) === couponStatusFilter)
        .sort((left, right) => {
          const leftCreatedAt = Date.parse(left.createdAt);
          const rightCreatedAt = Date.parse(right.createdAt);
          const leftTime = Number.isFinite(leftCreatedAt) ? leftCreatedAt : 0;
          const rightTime = Number.isFinite(rightCreatedAt) ? rightCreatedAt : 0;
          if (leftTime !== rightTime) return rightTime - leftTime;
          return left.title.localeCompare(right.title, "zh-CN");
        }),
    [couponStatusFilter, coupons],
  );
  const claimRecordRows = useMemo(
    () =>
      coupons
        .flatMap((coupon) =>
          coupon.claimEvents.map((event) => ({
            coupon,
            event,
          })),
        )
        .sort((left, right) => Date.parse(right.event.at) - Date.parse(left.event.at))
        .slice(0, 50),
    [coupons],
  );
  const redeemRecordRows = useMemo(
    () =>
      coupons
        .flatMap((coupon) =>
          coupon.redeemEvents.map((event) => ({
            coupon,
            event,
          })),
        )
        .sort((left, right) => Date.parse(right.event.at) - Date.parse(left.event.at))
        .slice(0, 50),
    [coupons],
  );
  const dailyStatsRows = useMemo(() => {
    const stats = new Map<string, { date: string; claimed: number; redeemed: number }>();
    const ensure = (date: string) => {
      const current = stats.get(date) ?? { date, claimed: 0, redeemed: 0 };
      stats.set(date, current);
      return current;
    };
    coupons.forEach((coupon) => {
      coupon.claimEvents.forEach((event) => {
        const date = event.at.slice(0, 10);
        if (date) ensure(date).claimed += 1;
      });
      coupon.redeemEvents.forEach((event) => {
        const date = event.at.slice(0, 10);
        if (date) ensure(date).redeemed += 1;
      });
    });
    return Array.from(stats.values()).sort((left, right) => right.date.localeCompare(left.date)).slice(0, 30);
  }, [coupons]);
  const redeemLookup = useMemo(() => {
    const query = redeemCodeInput.trim();
    if (!query) return null;
    const normalizedQuery = query.toLowerCase();
    for (const coupon of coupons) {
      const claimEvent = coupon.claimEvents.find(
        (event) => event.settlementCode.toLowerCase() === normalizedQuery,
      );
      if (!claimEvent) continue;
      const redeemEvent = coupon.redeemEvents.find(
        (event) => event.settlementCode === claimEvent.settlementCode || event.claimEventId === claimEvent.id,
      );
      const lifecycleStatus = getCouponLifecycleStatus(coupon);
      const claimValidUntilTime = claimEvent.validUntil ? Date.parse(claimEvent.validUntil) : Number.NaN;
      const claimExpired = Number.isFinite(claimValidUntilTime) && claimValidUntilTime < Date.now();
      return {
        coupon,
        claimEvent,
        redeemEvent,
        lifecycleStatus,
        claimExpired,
      };
    }
    return null;
  }, [coupons, redeemCodeInput]);
  const redeemLookupStatus = useMemo(() => {
    if (!redeemCodeInput.trim()) return { label: "等待输入", className: "border-slate-200 bg-slate-50 text-slate-600", redeemable: false };
    if (!redeemLookup) return { label: "未找到", className: "border-rose-200 bg-rose-50 text-rose-700", redeemable: false };
    if (redeemLookup.redeemEvent) return { label: "已核销", className: "border-slate-200 bg-slate-100 text-slate-600", redeemable: false };
    if (redeemLookup.claimExpired) return { label: "已过期", className: "border-rose-200 bg-rose-50 text-rose-700", redeemable: false };
    if (redeemLookup.lifecycleStatus !== "running") {
      return { label: COUPON_LIFECYCLE_STATUS_LABELS[redeemLookup.lifecycleStatus], className: COUPON_LIFECYCLE_STATUS_CLASS_NAMES[redeemLookup.lifecycleStatus], redeemable: false };
    }
    return { label: "可核销", className: "border-emerald-200 bg-emerald-50 text-emerald-700", redeemable: true };
  }, [redeemCodeInput, redeemLookup]);
  const showCouponList = view === "list";
  const showRedeemWorkbench = view === "redeemWorkbench";
  const showClaimRecords = view === "claims";
  const showRedeemRecords = view === "redemptions";
  const showDailyStats = view === "dailyStats";
  const showRecordSections = showClaimRecords || showRedeemRecords || showDailyStats;
  const recordSectionClassName = "grid gap-4";
  const recordScrollClassName = view === "list" ? "mt-3 max-h-72 space-y-2 overflow-auto text-xs" : "mt-3 max-h-[calc(100vh-22rem)] space-y-2 overflow-auto text-xs";
  const formPreviewData = useMemo<CouponVisualCardData>(() => {
    const itemText: Record<MerchantCouponDisplayField, string> = {
      discount: form.displayDiscountText.trim(),
      title: form.displayTitle.trim(),
      description: form.displayDescription.trim(),
      meta: form.displayMetaText.trim(),
      button: form.displayButtonText.trim(),
    };
    const displayItems = form.displayFieldOrder
      .filter((field) => !form.displayHiddenFields.includes(field))
      .map((field) => ({ field, text: itemText[field], boxStyle: form.displayBoxStyles[field], boxColor: form.displayBoxColors[field] }))
      .filter((item) => item.text);
    return {
      displayItems,
      backgroundImageUrl: normalizePublicAssetUrl(form.backgroundImageUrl),
      backgroundImageOpacity: Math.max(0, Math.min(1, toNumberValue(form.backgroundImageOpacity))),
      contentFontFamily: form.contentFontFamily.trim(),
      discountTextColor: form.discountTextColor.trim(),
      discountFontSize: normalizeFontSizeInput(form.discountFontSize),
      titleTextColor: form.titleTextColor.trim(),
      titleFontSize: normalizeFontSizeInput(form.titleFontSize),
      descriptionTextColor: form.descriptionTextColor.trim(),
      descriptionFontSize: normalizeFontSizeInput(form.descriptionFontSize),
      metaTextColor: form.metaTextColor.trim(),
      metaFontSize: normalizeFontSizeInput(form.metaFontSize),
      buttonTextColor: form.buttonTextColor.trim(),
      buttonFontSize: normalizeFontSizeInput(form.buttonFontSize),
    };
  }, [form]);
  const formSettingSummary = useMemo<CouponSettingSummaryGroup[]>(() => {
    const startsAt = fromDateTimeTextValue(form.startsAt);
    const expiresAt = fromDateTimeTextValue(form.expiresAt);
    const lifecycleStatus = getCouponLifecycleStatusFromValues(form.status, startsAt, expiresAt);
    const displayScopes = [
      form.showOnWebsite ? "网站" : "",
      form.showOnContactCard ? "联系卡" : "",
    ].filter(Boolean);
    const claimTargets = [
      form.claimRequiresMember ? "会员领取" : "",
      form.claimOldUserOnly ? "老用户专享" : "",
      splitRuleList(form.claimAllowedAccountIds).length > 0 ? "指定用户" : "",
      splitRuleList(form.claimAllowedCountries).length > 0 ||
      splitRuleList(form.claimAllowedProvinces).length > 0 ||
      splitRuleList(form.claimAllowedCities).length > 0
        ? "指定地区"
        : "",
      splitRuleList(form.claimAllowedCodes).length > 0 ? "指定优惠码" : "",
    ].filter(Boolean);
    const stockLimits = [
      form.claimMonthlyStockLimit.trim() ? `月 ${form.claimMonthlyStockLimit}` : "",
      form.claimWeeklyStockLimit.trim() ? `周 ${form.claimWeeklyStockLimit}` : "",
      form.claimDailyStockLimit.trim() ? `日 ${form.claimDailyStockLimit}` : "",
      form.claimHourlyStockLimit.trim() ? `时 ${form.claimHourlyStockLimit}` : "",
    ].filter(Boolean);
    const claimLimits = [
      form.claimPerUserTotalLimit.trim() ? `每人 ${form.claimPerUserTotalLimit}` : "",
      form.claimPerUserDailyLimit.trim() ? `每日 ${form.claimPerUserDailyLimit}` : "",
      form.claimPerUserWeeklyLimit.trim() ? `每周 ${form.claimPerUserWeeklyLimit}` : "",
      form.claimPerUserMonthlyLimit.trim() ? `每月 ${form.claimPerUserMonthlyLimit}` : "",
    ].filter(Boolean);
    const triggerLabels = form.claimBehaviorTriggers
      .map((value) => BEHAVIOR_TRIGGER_OPTIONS.find((option) => option.value === value)?.label ?? "")
      .filter(Boolean);
    const taskLabels = form.claimTaskRequirements
      .map((value) => TASK_REQUIREMENT_OPTIONS.find((option) => option.value === value)?.label ?? "")
      .filter(Boolean);
    return [
      {
        title: "基础设置",
        items: [
          { label: "名称", value: form.title.trim() || "未命名" },
          { label: "类型", value: COUPON_DISCOUNT_TYPE_LABELS[form.discountType] },
          { label: "优惠内容", value: buildFormGeneratedDiscountText(form, pricePrefix) },
          { label: "状态", value: COUPON_LIFECYCLE_STATUS_LABELS[lifecycleStatus] },
          {
            label: "有效期",
            value: startsAt || expiresAt ? `${startsAt ? formatDateTime(startsAt) : "不限"} 至 ${expiresAt ? formatDateTime(expiresAt) : "不限"}` : "永久有效",
          },
        ],
      },
      {
        title: "展示设置",
        items: [
          { label: "展示范围", value: displayScopes.join(" / ") || "未展示" },
          { label: "使用场景", value: normalizeFormUsageScenarios(form.usageScenarios).map((item) => USAGE_SCENARIO_LABELS[item]).join(" / ") || "未设置" },
          { label: "背景图", value: form.backgroundImageUrl.trim() ? `已设置，透明度 ${formatOpacityPercent(form.backgroundImageOpacity)}` : "未设置" },
          { label: "文案项", value: form.displayFieldOrder.filter((field) => !form.displayHiddenFields.includes(field)).map((field) => DISPLAY_FIELD_CONFIG[field].label).join(" / ") || "未设置" },
        ],
      },
      {
        title: "领取规则",
        items: [
          { label: "领取对象", value: claimTargets.join(" / ") || "不限" },
          { label: "库存限制", value: stockLimits.join(" / ") || "不限" },
          { label: "领取次数", value: claimLimits.join(" / ") || "不限" },
          { label: "领取时间", value: splitRuleList(form.claimDateTimeWindows).length || splitRuleList(form.claimDailyTimeWindows).length ? "已设置" : "不限" },
          {
            label: "生效时间",
            value:
              form.claimValidHoursAfterClaim.trim() || form.claimValidDaysAfterClaim.trim()
                ? [form.claimValidHoursAfterClaim.trim() ? `${form.claimValidHoursAfterClaim} 小时` : "", form.claimValidDaysAfterClaim.trim() ? `${form.claimValidDaysAfterClaim} 天` : ""]
                    .filter(Boolean)
                    .join(" / ")
                : "不限",
          },
          { label: "行为触发", value: triggerLabels.join(" / ") || "未设置" },
          { label: "任务领取", value: taskLabels.join(" / ") || "未设置" },
        ],
      },
    ];
  }, [form, pricePrefix]);

  const notifyCouponsChange = useCallback(
    (nextCoupons: MerchantCouponRecord[]) => {
      setCoupons(nextCoupons);
      onCouponsChange?.(nextCoupons);
    },
    [onCouponsChange],
  );

  const loadCoupons = useCallback(async (force = false) => {
    if (!siteId) {
      notifyCouponsChange([]);
      return;
    }
    const cacheKey = makeMerchantAdminDataCacheKey("merchant-coupons", siteId);
    const requestId = ++couponLoadRequestIdRef.current;
    let loadedCouponsVersion: string | null = null;
    const cachedSnapshot = force
      ? null
      : readMerchantAdminDataCacheSnapshot<MerchantCouponRecord[]>(cacheKey, MERCHANT_ADMIN_DATA_CACHE_TTL_MS);
    const loadCouponsFromServer = async () => {
      const params = new URLSearchParams({ siteId });
      if (cachedSnapshot?.version) params.set("knownVersion", cachedSnapshot.version);
      const response = await fetch(`/api/coupons?${params.toString()}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as {
        coupons?: unknown;
        message?: string;
        error?: string;
        notModified?: unknown;
        version?: unknown;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || "优惠券加载失败");
      }
      loadedCouponsVersion = typeof payload?.version === "string" && payload.version.trim() ? payload.version.trim() : null;
      if (payload?.notModified === true && cachedSnapshot) return cachedSnapshot.data;
      return normalizeMerchantCouponRecords(payload?.coupons);
    };
    if (cachedSnapshot) {
      setError("");
      notifyCouponsChange(cachedSnapshot.data);
      void fetchMerchantAdminDataWithCache(cacheKey, loadCouponsFromServer, {
        force: true,
        allowStaleOnError: true,
        dedupe: true,
        cacheVersion: () => loadedCouponsVersion,
      })
        .then((nextCoupons) => {
          if (couponLoadRequestIdRef.current === requestId) notifyCouponsChange(nextCoupons);
        })
        .catch(() => {});
      return;
    }
    setLoading(true);
    setError("");
    try {
      const nextCoupons = await fetchMerchantAdminDataWithCache(
        cacheKey,
        loadCouponsFromServer,
        { force, allowStaleOnError: true, cacheVersion: () => loadedCouponsVersion },
      );
      if (couponLoadRequestIdRef.current === requestId) notifyCouponsChange(nextCoupons);
    } catch (loadError) {
      if (couponLoadRequestIdRef.current === requestId) {
        setError(loadError instanceof Error ? loadError.message : "优惠券加载失败");
        notifyCouponsChange([]);
      }
    } finally {
      if (couponLoadRequestIdRef.current === requestId) setLoading(false);
    }
  }, [notifyCouponsChange, siteId]);

  useEffect(() => {
    void loadCoupons();
  }, [loadCoupons]);

  useEffect(() => {
    const refreshOnVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void loadCoupons();
    };
    window.addEventListener("focus", refreshOnVisible);
    document.addEventListener("visibilitychange", refreshOnVisible);
    return () => {
      window.removeEventListener("focus", refreshOnVisible);
      document.removeEventListener("visibilitychange", refreshOnVisible);
    };
  }, [loadCoupons]);

  useEffect(() => {
    let active = true;
    loadEuropeLocationOptionsApi()
      .then((api) => {
        if (active) setLocationOptionsApi(api);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!error && !tip) return;
    showGlobalToast(error || tip);
    const timer = window.setTimeout(() => {
      setError("");
      setTip("");
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [error, tip]);

  const locationCountryOptions = useMemo(() => locationOptionsApi?.getEuropeCountryOptions() ?? [], [locationOptionsApi]);
  const selectedLocationCountryCodes = useMemo(() => {
    const selected = new Set(splitRuleList(form.claimAllowedCountries).map(normalizeLocationOptionText));
    if (selected.size === 0) return [] as string[];
    return locationCountryOptions
      .filter((country) => selected.has(normalizeLocationOptionText(country.name)) || selected.has(normalizeLocationOptionText(country.code)))
      .map((country) => country.code);
  }, [form.claimAllowedCountries, locationCountryOptions]);
  const countryRuleOptions = useMemo(
    () =>
      filterLocationOptions(
        locationCountryOptions.map((country) => ({ value: country.name, label: `${country.name} / ${country.code}` })),
        countryRuleInput,
      ),
    [countryRuleInput, locationCountryOptions],
  );
  const allProvinceRuleOptions = useMemo(() => {
    if (!locationOptionsApi) return [] as Array<{ value: string; label: string; countryCode: string; provinceCode: string }>;
    const countryCodes = selectedLocationCountryCodes.length > 0 ? selectedLocationCountryCodes : locationCountryOptions.map((country) => country.code);
    const countryNameByCode = new Map(locationCountryOptions.map((country) => [country.code, country.name]));
    const options: Array<{ value: string; label: string; countryCode: string; provinceCode: string }> = [];
    countryCodes.forEach((countryCode) => {
      locationOptionsApi.getEuropeProvinceOptions(countryCode).forEach((province) => {
        options.push({
          value: province.name,
          label: `${province.name} / ${countryNameByCode.get(countryCode) ?? countryCode}`,
          countryCode,
          provinceCode: province.code,
        });
      });
    });
    return options;
  }, [locationCountryOptions, locationOptionsApi, selectedLocationCountryCodes]);
  const provinceRuleOptions = useMemo(
    () => filterLocationOptions(allProvinceRuleOptions, provinceRuleInput),
    [allProvinceRuleOptions, provinceRuleInput],
  );
  const cityRuleOptions = useMemo(() => {
    if (!locationOptionsApi) return [] as Array<{ value: string; label: string }>;
    const selectedProvinceNames = new Set(splitRuleList(form.claimAllowedProvinces).map(normalizeLocationOptionText));
    const normalizedQuery = normalizeLocationOptionText(cityRuleInput);
    const options: Array<{ value: string; label: string }> = [];
    const countryCodes = selectedLocationCountryCodes.length > 0 ? selectedLocationCountryCodes : locationCountryOptions.map((country) => country.code);
    const countryNameByCode = new Map(locationCountryOptions.map((country) => [country.code, country.name]));
    for (const countryCode of countryCodes) {
      const provinces = locationOptionsApi.getEuropeProvinceOptions(countryCode);
      for (const province of provinces) {
        if (
          selectedProvinceNames.size > 0 &&
          !selectedProvinceNames.has(normalizeLocationOptionText(province.name)) &&
          !selectedProvinceNames.has(normalizeLocationOptionText(province.code))
        ) {
          continue;
        }
        const cities = locationOptionsApi.getEuropeCityOptions(countryCode, province.code);
        for (const city of cities) {
          const cityValue = normalizeLocationOptionText(city);
          const label = `${city} / ${province.name} / ${countryNameByCode.get(countryCode) ?? countryCode}`;
          const labelValue = normalizeLocationOptionText(label);
          if (normalizedQuery && !cityValue.includes(normalizedQuery) && !labelValue.includes(normalizedQuery)) continue;
          options.push({ value: city, label });
          if (options.length >= 40) return options;
        }
      }
    }
    return options.slice(0, 40);
  }, [cityRuleInput, form.claimAllowedProvinces, locationCountryOptions, locationOptionsApi, selectedLocationCountryCodes]);

  function updateField<K extends keyof CouponFormState>(key: K, value: CouponFormState[K]) {
    setForm((current) => {
      const previousGeneratedDiscountText = buildFormGeneratedDiscountText(current, pricePrefix);
      const previousGeneratedMetaText = buildFormDefaultMetaText(current, pricePrefix);
      const next = { ...current, [key]: value };
      if (
        GENERATED_DISCOUNT_TEXT_FIELDS.has(key) &&
        (!current.displayDiscountText.trim() || current.displayDiscountText.trim() === previousGeneratedDiscountText)
      ) {
        next.displayDiscountText = buildFormGeneratedDiscountText(next, pricePrefix);
      }
      if (
        GENERATED_META_TEXT_FIELDS.has(key) &&
        (!current.displayMetaText.trim() || current.displayMetaText.trim() === previousGeneratedMetaText)
      ) {
        next.displayMetaText = buildFormDefaultMetaText(next, pricePrefix);
      }
      return next;
    });
  }

  function addRuleListItem(field: LocationRuleField, value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setForm((current) => {
      const currentItems = splitRuleList(current[field]);
      const exists = currentItems.some((item) => normalizeLocationOptionText(item) === normalizeLocationOptionText(trimmed));
      if (exists) return current;
      return { ...current, [field]: [...currentItems, trimmed].join("\n") };
    });
  }

  function appendClaimWindow(field: "claimDateTimeWindows" | "claimDailyTimeWindows", value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setForm((current) => {
      const currentValue = current[field].trim();
      return { ...current, [field]: currentValue ? `${currentValue}\n${trimmed}` : trimmed };
    });
  }

  function addDateTimeClaimWindow() {
    const startText = toDateTimeTextFromPickerValue(claimDateWindowStart);
    const endText = toDateTimeTextFromPickerValue(claimDateWindowEnd);
    if (!startText || !endText) return;
    appendClaimWindow("claimDateTimeWindows", `${startText} ~ ${endText}`);
    setClaimDateWindowStart("");
    setClaimDateWindowEnd("");
  }

  function addDailyClaimWindow() {
    const startText = claimDailyWindowStart.trim();
    const endText = claimDailyWindowEnd.trim();
    if (!startText || !endText) return;
    appendClaimWindow("claimDailyTimeWindows", `${startText} ~ ${endText}`);
    setClaimDailyWindowStart("");
    setClaimDailyWindowEnd("");
  }

  function renderLocationRulePicker(input: {
    label: string;
    field: LocationRuleField;
    placeholder: string;
    inputValue: string;
    onInputChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
    datalistId: string;
  }) {
    const addCurrentInput = () => {
      addRuleListItem(input.field, input.inputValue);
      input.onInputChange("");
    };
    return (
      <label className="space-y-1 text-sm">
        <span className="block text-slate-600">{input.label}</span>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <input
            className="min-w-0 rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
            value={input.inputValue}
            list={input.datalistId}
            onChange={(event) => {
              const nextValue = event.target.value;
              input.onInputChange(nextValue);
              const matched = input.options.find((option) => normalizeLocationOptionText(option.value) === normalizeLocationOptionText(nextValue));
              if (matched) {
                addRuleListItem(input.field, matched.value);
                input.onInputChange("");
              }
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              addCurrentInput();
            }}
            placeholder="输入搜索或直接填写"
          />
          <button
            type="button"
            className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
            onClick={addCurrentInput}
            disabled={!input.inputValue.trim()}
          >
            添加
          </button>
        </div>
        <datalist id={input.datalistId}>
          {input.options.map((option, index) => (
            <option key={`${option.value}-${option.label}-${index}`} value={option.value}>
              {option.label}
            </option>
          ))}
        </datalist>
        <textarea
          className="min-h-[60px] w-full resize-y rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
          value={form[input.field]}
          onChange={handleInputChange(input.field)}
          placeholder={input.placeholder}
        />
      </label>
    );
  }

  function updateDiscountType(value: MerchantCouponDiscountType) {
    setForm((current) => {
      const previousGeneratedText = buildFormGeneratedDiscountText(current, pricePrefix);
      const previousGeneratedMetaText = buildFormDefaultMetaText(current, pricePrefix);
      const nextUsageScenarios: MerchantCouponUsageScenario[] =
        value === "points_voucher"
          ? Array.from(new Set([...normalizeFormUsageScenarios(current.usageScenarios), "points_redemption"]))
          : current.usageScenarios;
      const next = { ...current, discountType: value, usageScenarios: nextUsageScenarios };
      const shouldRefreshDisplayText = !current.displayDiscountText.trim() || current.displayDiscountText.trim() === previousGeneratedText;
      const shouldRefreshMetaText = !current.displayMetaText.trim() || current.displayMetaText.trim() === previousGeneratedMetaText;
      return {
        ...next,
        displayDiscountText: shouldRefreshDisplayText ? buildFormGeneratedDiscountText(next, pricePrefix) : current.displayDiscountText,
        displayMetaText: shouldRefreshMetaText ? buildFormDefaultMetaText(next, pricePrefix) : current.displayMetaText,
      };
    });
  }

  function handleInputChange<K extends keyof CouponFormState>(key: K) {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      updateField(key, event.target.value as CouponFormState[K]);
    };
  }

  function updateDisplayText(field: MerchantCouponDisplayField, value: string) {
    const config = DISPLAY_FIELD_CONFIG[field];
    setForm((current) => ({
      ...current,
      [config.valueKey]: value,
      displayHiddenFields: value.trim()
        ? current.displayHiddenFields.filter((item) => item !== field)
        : Array.from(new Set([...current.displayHiddenFields, field])),
    }));
  }

  function updateDisplayBoxStyle(field: MerchantCouponDisplayField, value: MerchantCouponDisplayBoxStyle) {
    setForm((current) => ({
      ...current,
      displayBoxStyles: { ...current.displayBoxStyles, [field]: value },
    }));
  }

  function toggleDisplayFieldSelection(field: MerchantCouponDisplayField, checked: boolean) {
    setSelectedDisplayFields((current) => {
      const next = checked ? Array.from(new Set([...current, field])) : current.filter((item) => item !== field);
      return next.length > 0 ? next : [field];
    });
  }

  function moveDisplayField(field: MerchantCouponDisplayField, direction: -1 | 1) {
    setForm((current) => {
      const order = [...current.displayFieldOrder];
      const index = order.indexOf(field);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return current;
      [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
      return { ...current, displayFieldOrder: order };
    });
  }

  function applySelectedTextStyle(kind: "color" | "size", value: string) {
    setForm((current) => {
      const patch: Partial<CouponFormState> = {};
      selectedDisplayFields.forEach((field) => {
        const config = DISPLAY_FIELD_CONFIG[field];
        patch[kind === "color" ? config.colorKey : config.sizeKey] = value;
      });
      return { ...current, ...patch };
    });
  }

  function applySelectedBoxColor(value: string) {
    setForm((current) => {
      const nextBoxColors = { ...current.displayBoxColors };
      selectedDisplayFields.forEach((field) => {
        nextBoxColors[field] = value;
      });
      return { ...current, displayBoxColors: nextBoxColors };
    });
  }

  function toggleUsageScenario(scenario: MerchantCouponUsageScenario, checked: boolean) {
    setForm((current) => {
      const currentScenarios = normalizeFormUsageScenarios(current.usageScenarios);
      const nextScenarios = checked
        ? Array.from(new Set([...currentScenarios, scenario]))
        : currentScenarios.filter((item) => item !== scenario);
      return { ...current, usageScenarios: nextScenarios };
    });
  }

  function setCheckoutUsageScenario(scenario: Extract<MerchantCouponUsageScenario, "checkout_qr" | "checkout_barcode">) {
    setForm((current) => {
      const currentScenarios = normalizeFormUsageScenarios(current.usageScenarios).filter(
        (item) => item !== "checkout_qr" && item !== "checkout_barcode",
      );
      return { ...current, usageScenarios: [...currentScenarios, scenario] };
    });
  }

  function toggleBehaviorTrigger(trigger: MerchantCouponBehaviorTrigger, checked: boolean) {
    setForm((current) => ({
      ...current,
      claimBehaviorTriggers: checked
        ? Array.from(new Set([...current.claimBehaviorTriggers, trigger]))
        : current.claimBehaviorTriggers.filter((item) => item !== trigger),
    }));
  }

  function toggleTaskRequirement(task: MerchantCouponTaskRequirement, checked: boolean) {
    setForm((current) => ({
      ...current,
      claimTaskRequirements: checked
        ? Array.from(new Set([...current.claimTaskRequirements, task]))
        : current.claimTaskRequirements.filter((item) => item !== task),
    }));
  }

  function buildPayload(): MerchantCouponInput {
    const hiddenFields = MERCHANT_COUPON_DISPLAY_FIELDS.filter((field) => {
      const valueKey = DISPLAY_FIELD_CONFIG[field].valueKey;
      return !form[valueKey].trim();
    });
    return {
      siteId,
      title: form.title.trim() || "优惠券",
      code: form.code.trim(),
      description: form.displayDescription.trim(),
      discountType: form.discountType,
      discountValue: toNumberValue(form.discountValue),
      minimumAmount: toNumberValue(form.minimumAmount),
      pointsVoucherMaxPerRedemption: toIntValue(form.pointsVoucherMaxPerRedemption),
      pointsVoucherMinimumRedeemPoints: toIntValue(form.pointsVoucherMinimumRedeemPoints),
      productName: form.productName.trim(),
      productBarcode: form.productBarcode.trim(),
      productQuantity: toIntValue(form.productQuantity),
      productAmount: toNumberValue(form.productAmount),
      exchangeItem: form.exchangeItem.trim(),
      exchangeQuantity: toIntValue(form.exchangeQuantity),
      ticketVenue: form.ticketVenue.trim(),
      ticketDurationMinutes: toIntValue(form.ticketDurationMinutes),
      maxDiscountAmount: 0,
      totalQuantity: toIntValue(form.totalQuantity),
      perCustomerLimit: 0,
      startsAt: fromDateTimeTextValue(form.startsAt),
      expiresAt: fromDateTimeTextValue(form.expiresAt),
      status: form.status === "archived" ? "paused" : form.status,
      showOnWebsite: form.showOnWebsite,
      showOnContactCard: form.showOnContactCard,
      backgroundImageUrl: normalizePublicAssetUrl(form.backgroundImageUrl),
      backgroundImageOpacity: Math.max(0, Math.min(1, toNumberValue(form.backgroundImageOpacity))),
      usageScenarios: normalizeFormUsageScenarios(form.usageScenarios),
      displayTitle: form.displayTitle.trim(),
      displayDescription: form.displayDescription.trim(),
      displayDiscountText: form.displayDiscountText.trim(),
      displayMetaText: form.displayMetaText.trim(),
      displayButtonText: form.displayButtonText.trim(),
      displayFieldOrder: form.displayFieldOrder,
      displayHiddenFields: hiddenFields,
      displayBoxStyles: form.displayBoxStyles,
      displayBoxColors: form.displayBoxColors,
      contentFontFamily: form.contentFontFamily.trim(),
      discountTextColor: form.discountTextColor.trim(),
      discountFontSize: normalizeFontSizeInput(form.discountFontSize),
      titleTextColor: form.titleTextColor.trim(),
      titleFontSize: normalizeFontSizeInput(form.titleFontSize),
      descriptionTextColor: form.descriptionTextColor.trim(),
      descriptionFontSize: normalizeFontSizeInput(form.descriptionFontSize),
      metaTextColor: form.metaTextColor.trim(),
      metaFontSize: normalizeFontSizeInput(form.metaFontSize),
      buttonTextColor: form.buttonTextColor.trim(),
      buttonFontSize: normalizeFontSizeInput(form.buttonFontSize),
      claimRequiresMember: form.claimRequiresMember,
      claimOldUserOnly: form.claimOldUserOnly,
      claimMinRegisteredDays: toIntValue(form.claimMinRegisteredDays),
      claimMinSpendAmount: toNumberValue(form.claimMinSpendAmount),
      claimMinOrderCount: toIntValue(form.claimMinOrderCount),
      claimAllowedAccountIds: splitRuleList(form.claimAllowedAccountIds),
      claimAllowedCountries: splitRuleList(form.claimAllowedCountries),
      claimAllowedProvinces: splitRuleList(form.claimAllowedProvinces),
      claimAllowedCities: splitRuleList(form.claimAllowedCities),
      claimAllowedCodes: splitRuleList(form.claimAllowedCodes),
      claimPerUserTotalLimit: toIntValue(form.claimPerUserTotalLimit),
      claimPerUserDailyLimit: toIntValue(form.claimPerUserDailyLimit),
      claimPerUserWeeklyLimit: toIntValue(form.claimPerUserWeeklyLimit),
      claimPerUserMonthlyLimit: toIntValue(form.claimPerUserMonthlyLimit),
      claimDateTimeWindows: splitRuleList(form.claimDateTimeWindows),
      claimDailyTimeWindows: splitRuleList(form.claimDailyTimeWindows),
      claimValidHoursAfterClaim: toIntValue(form.claimValidHoursAfterClaim),
      claimValidDaysAfterClaim: toIntValue(form.claimValidDaysAfterClaim),
      claimMonthlyStockLimit: toIntValue(form.claimMonthlyStockLimit),
      claimWeeklyStockLimit: toIntValue(form.claimWeeklyStockLimit),
      claimDailyStockLimit: toIntValue(form.claimDailyStockLimit),
      claimHourlyStockLimit: toIntValue(form.claimHourlyStockLimit),
      claimBehaviorTriggers: form.claimBehaviorTriggers,
      claimTriggerAmount: toNumberValue(form.claimTriggerAmount),
      claimTriggerCount: toIntValue(form.claimTriggerCount),
      claimTriggerDate: fromDateTimeTextValue(form.claimTriggerDate),
      claimTaskRequirements: form.claimTaskRequirements,
      claimTaskPageUrl: form.claimTaskPageUrl.trim(),
      claimTaskInviteCount: toIntValue(form.claimTaskInviteCount),
      applicableTags: splitTags(form.applicableTags),
    };
  }

  async function uploadCouponBackground(file: File | null | undefined) {
    if (!file || uploadingBackground) return;
    setUploadingBackground(true);
    setError("");
    setTip("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("folder", "merchant-assets");
      formData.append("merchantHint", siteId || "coupon");
      formData.append("usage", "generic-image");
      const response = await fetch("/api/assets/upload", {
        method: "POST",
        credentials: "same-origin",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as { url?: string; message?: string; error?: string } | null;
      if (!response.ok || !payload?.url) {
        throw new Error(payload?.message || payload?.error || "背景图上传失败");
      }
      updateField("backgroundImageUrl", normalizePublicAssetUrl(payload.url));
      setTip("优惠券背景图已上传");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "背景图上传失败");
    } finally {
      if (backgroundFileInputRef.current) backgroundFileInputRef.current.value = "";
      setUploadingBackground(false);
    }
  }

  async function saveCoupon() {
    if (!siteId || saving) return;
    const validationError = validateCouponForm(form);
    if (validationError) {
      setError(validationError);
      setTip("");
      return;
    }
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
        setForm(buildFormFromCoupon(payload.coupon, pricePrefix));
      }
      await loadCoupons(true);
      setFormOpen(false);
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
        setForm(buildFormFromCoupon(payload.coupon, pricePrefix));
      }
      await loadCoupons(true);
      setTip(successMessage);
    } catch (patchError) {
      setError(patchError instanceof Error ? patchError.message : "优惠券更新失败");
    } finally {
      setSaving(false);
    }
  }

  async function redeemCurrentCouponCode() {
    if (!siteId || redeeming) return;
    if (!redeemCodeInput.trim()) {
      setError("请输入券码");
      setTip("");
      return;
    }
    if (!redeemLookup) {
      setError("未找到该券码");
      setTip("");
      return;
    }
    if (!redeemLookupStatus.redeemable) {
      setError(redeemLookupStatus.label);
      setTip("");
      return;
    }
    setRedeeming(true);
    setError("");
    setTip("");
    try {
      const operationId = createClientMutationOperationId("coupon-redeem");
      const response = await fetch("/api/coupons/redeem", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId,
          settlementCode: redeemLookup.claimEvent.settlementCode,
          note: redeemNote.trim(),
          operationId,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { coupon?: MerchantCouponRecord; message?: string; error?: string } | null;
      if (!response.ok) {
        throw new Error(getCouponRedeemErrorMessage(payload?.message || payload?.error));
      }
      await loadCoupons(true);
      setRedeemCodeInput("");
      setRedeemNote("");
      setTip("核销成功");
    } catch (redeemError) {
      setError(redeemError instanceof Error ? redeemError.message : "核销失败");
    } finally {
      setRedeeming(false);
    }
  }

  async function archiveCoupon(coupon: MerchantCouponRecord) {
    if (!siteId || saving) return;
    if (typeof window !== "undefined" && !window.confirm(`确定删除优惠券「${coupon.title}」吗？删除后不会再展示给客户。`)) {
      return;
    }
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
        setForm(buildNewCouponForm(pricePrefix));
        setFormOpen(false);
      }
      await loadCoupons(true);
      setTip("优惠券已删除");
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "优惠券删除失败");
    } finally {
      setSaving(false);
    }
  }

  async function copyCoupon(coupon: MerchantCouponRecord) {
    try {
      const claimUrl = buildCouponClaimUrl(publicSiteUrl, siteId, coupon, couponPageId);
      await writeClipboardText(buildShareableCouponText(coupon, pricePrefix, siteName, claimUrl));
      setTip("优惠券已复制，可粘贴到其他应用发送");
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
        : form.discountType === "stored_value"
          ? "储值券按储值金额抵扣订单；也可以用于结算二维码/条码核销。"
          : form.discountType === "points_voucher"
            ? "积分券在积分兑换台使用，按券中积分值抵扣本次应扣积分。"
          : form.discountType === "product_voucher"
            ? "商品券用于指定商品权益或核销，不会自动抵扣购物车金额。"
            : form.discountType === "exchange_voucher"
              ? "兑换券用于兑换权益或服务，不会自动抵扣购物车金额。"
              : form.discountType === "ticket_voucher"
                ? "门票券用于入场或活动核销，不会自动抵扣购物车金额。"
                : "立减金额不要求订单达到门槛。";
  const discountValueLabel =
    form.discountType === "percent_off"
      ? "折扣百分比"
      : form.discountType === "stored_value"
        ? "储值金额"
        : form.discountType === "points_voucher"
          ? "抵扣积分"
        : form.discountType === "product_voucher" ||
            form.discountType === "exchange_voucher" ||
            form.discountType === "ticket_voucher"
          ? "券面数值（可选）"
          : "优惠金额";
  const canEditCoupons = !listOnly;
  const rootClassName = listOnly ? `space-y-4 ${className}` : `min-h-[calc(100vh-14rem)] space-y-4 py-6 ${className}`;

  return (
    <div className={rootClassName}>
      {!listOnly ? (
      <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_18px_48px_rgba(15,23,42,0.08)]">
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
              onClick={() => void loadCoupons(true)}
              disabled={loading || !siteId}
            >
              {loading ? "刷新中..." : "刷新"}
            </button>
            <button
              type="button"
              className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50"
              onClick={() => {
                setForm(buildNewCouponForm(pricePrefix));
                setSelectedDisplayFields(["discount"]);
                setError("");
                setTip("");
                setFormOpen(true);
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
            <div className="text-xs text-slate-500">未删除优惠券</div>
            <div className="mt-1 text-xl font-semibold text-slate-900">{activeCouponCount}</div>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <div className="text-xs text-emerald-700">网站可展示</div>
            <div className="mt-1 text-xl font-semibold text-emerald-700">{activeVisibleCount}</div>
          </div>
          <div className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3">
            <div className="text-xs text-cyan-700">联系卡可展示</div>
            <div className="mt-1 text-xl font-semibold text-cyan-700">{contactCardVisibleCount}</div>
          </div>
        </div>
      </section>
      ) : null}

      {!listOnly && formOpen ? (
        <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6">
          <button
            type="button"
            aria-label="关闭优惠券编辑"
            className="fixed inset-0 cursor-default"
            onClick={() => {
              if (!saving && !uploadingBackground) setFormOpen(false);
            }}
          />
          <section className="relative z-10 w-full max-w-7xl rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-2xl">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-base font-semibold text-slate-900">{formTitle}</div>
              <div className="mt-1 text-xs text-slate-500">{discountHelper}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {selectedCoupon ? (
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${COUPON_LIFECYCLE_STATUS_CLASS_NAMES[getCouponLifecycleStatus(selectedCoupon)]}`}>
                  {COUPON_LIFECYCLE_STATUS_LABELS[getCouponLifecycleStatus(selectedCoupon)]}
                </span>
              ) : null}
              <button
                type="button"
                className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                onClick={() => setFormOpen(false)}
                disabled={saving || uploadingBackground}
              >
                关闭
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="grid gap-3">
              <CouponFormSection title="基础设置">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_140px_220px_220px] md:items-end">
                  <label className="space-y-1 text-sm">
                    <span className="block text-slate-600">优惠券名称</span>
                    <input
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                      value={form.title}
                      onChange={handleInputChange("title")}
                      placeholder="例如：新客户优惠"
                    />
                  </label>
                  <div className="space-y-1 text-sm">
                    <span className="block text-slate-600">状态</span>
                    <CouponStatusSwitch checked={form.status === "active"} onChange={(checked) => updateField("status", checked ? "active" : "paused")} />
                  </div>
                  <div className="space-y-1 text-sm">
                    <span className="block text-slate-600">结算码</span>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        ["checkout_qr", "二维码"],
                        ["checkout_barcode", "条形码"],
                      ].map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                            form.usageScenarios.includes(value as MerchantCouponUsageScenario)
                              ? "border-slate-900 bg-slate-900 text-white"
                              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                          }`}
                          onClick={() => setCheckoutUsageScenario(value as Extract<MerchantCouponUsageScenario, "checkout_qr" | "checkout_barcode">)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="flex min-h-[42px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.usageScenarios.includes("order_cart")}
                      onChange={(event) => toggleUsageScenario("order_cart", event.target.checked)}
                    />
                    订单（购物车中扣除）
                  </label>
                  <label className="flex min-h-[42px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.usageScenarios.includes("points_redemption")}
                      onChange={(event) => toggleUsageScenario("points_redemption", event.target.checked)}
                    />
                    积分兑换
                  </label>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
                  <div className="text-sm font-semibold text-slate-900">卡片背景图</div>
                  <div className="mt-2 grid gap-3 md:grid-cols-[160px_minmax(0,1fr)] md:items-center">
                    <div
                      className="h-24 rounded-lg border border-slate-200 bg-white bg-cover bg-center"
                      style={{
                        backgroundImage: normalizePublicAssetUrl(form.backgroundImageUrl)
                          ? `linear-gradient(rgba(255,255,255,${(1 - Math.max(0, Math.min(1, toNumberValue(form.backgroundImageOpacity)))).toFixed(
                              3,
                            )}), rgba(255,255,255,${(1 - Math.max(0, Math.min(1, toNumberValue(form.backgroundImageOpacity)))).toFixed(
                              3,
                            )})), url("${normalizePublicAssetUrl(form.backgroundImageUrl)}")`
                          : undefined,
                      }}
                      aria-label="优惠券背景预览"
                    />
                    <div className="grid gap-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded border bg-white px-3 py-2 text-xs hover:bg-slate-50 disabled:opacity-50"
                          onClick={() => backgroundFileInputRef.current?.click()}
                          disabled={uploadingBackground || !siteId}
                        >
                          {uploadingBackground ? "上传中..." : "上传图片"}
                        </button>
                        <button
                          type="button"
                          className="rounded border bg-white px-3 py-2 text-xs hover:bg-slate-50 disabled:opacity-50"
                          onClick={() => updateField("backgroundImageUrl", "")}
                          disabled={!form.backgroundImageUrl || uploadingBackground}
                        >
                          清除
                        </button>
                      </div>
                      <label className="block text-sm">
                        <span className="flex items-center gap-3 rounded-lg border border-slate-300 bg-white px-3 py-2">
                          <span className="shrink-0 text-xs text-slate-600">透明度</span>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            className="min-w-0 flex-1"
                            value={form.backgroundImageOpacity}
                            onChange={handleInputChange("backgroundImageOpacity")}
                          />
                          <span className="w-12 shrink-0 text-right text-xs text-slate-500">{formatOpacityPercent(form.backgroundImageOpacity)}</span>
                        </span>
                      </label>
                    </div>
                  </div>
                  <input
                    ref={backgroundFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => void uploadCouponBackground(event.target.files?.[0])}
                  />
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

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.showOnWebsite}
                      onChange={(event) => updateField("showOnWebsite", event.target.checked)}
                    />
                    网站区块展示
                  </label>
                  <label className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.showOnContactCard}
                      onChange={(event) => updateField("showOnContactCard", event.target.checked)}
                    />
                    联系卡展示
                  </label>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
                  <div className="text-sm font-semibold text-slate-900">领取对象</div>
                  <div className="mt-2 grid gap-3 md:grid-cols-2">
                    <label className="flex items-start gap-2 rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={form.claimRequiresMember}
                        onChange={(event) => updateField("claimRequiresMember", event.target.checked)}
                      />
                      <span>
                        <span className="block font-medium text-slate-800">会员领取</span>
                        <span className="mt-1 block text-xs leading-5 text-slate-500">未登录用户点击领取会跳转登录；领取后自动收藏该站点。</span>
                      </span>
                    </label>
                    <div className="rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={form.claimOldUserOnly}
                          onChange={(event) => updateField("claimOldUserOnly", event.target.checked)}
                        />
                        <span className="font-medium text-slate-800">老用户专享</span>
                      </label>
                      <div className="mt-3 grid gap-3 lg:grid-cols-3">
                        <label className="space-y-1">
                          <span className="block text-slate-600">注册超过天数</span>
                          <input
                            type="number"
                            min={0}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                            value={form.claimMinRegisteredDays}
                            onChange={handleInputChange("claimMinRegisteredDays")}
                            placeholder="0 表示不限制"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="block text-slate-600">消费超过金额</span>
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                            value={form.claimMinSpendAmount}
                            onChange={handleInputChange("claimMinSpendAmount")}
                            placeholder="0 表示不限制"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="block text-slate-600">下单超过次数</span>
                          <input
                            type="number"
                            min={0}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                            value={form.claimMinOrderCount}
                            onChange={handleInputChange("claimMinOrderCount")}
                            placeholder="0 表示不限制"
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {[
                      ["指定用户 ID", "claimAllowedAccountIds", "一行一个用户 ID"],
                      ["指定优惠码", "claimAllowedCodes", "用户领取时需输入，二维码/条形码会带该码"],
                    ].map(([label, key, placeholder]) => (
                      <label key={key} className="space-y-1 text-sm">
                        <span className="block text-slate-600">{label}</span>
                        <textarea
                          className="min-h-[60px] w-full resize-y rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                          value={form[key as keyof CouponFormState] as string}
                          onChange={handleInputChange(key as keyof CouponFormState)}
                          placeholder={placeholder}
                        />
                      </label>
                    ))}
                    {renderLocationRulePicker({
                      label: "指定国家",
                      field: "claimAllowedCountries",
                      placeholder: "一行一个国家",
                      inputValue: countryRuleInput,
                      onInputChange: setCountryRuleInput,
                      options: countryRuleOptions,
                      datalistId: "coupon-country-rule-options",
                    })}
                    {renderLocationRulePicker({
                      label: "指定省",
                      field: "claimAllowedProvinces",
                      placeholder: "一行一个省",
                      inputValue: provinceRuleInput,
                      onInputChange: setProvinceRuleInput,
                      options: provinceRuleOptions,
                      datalistId: "coupon-province-rule-options",
                    })}
                    {renderLocationRulePicker({
                      label: "指定市",
                      field: "claimAllowedCities",
                      placeholder: "一行一个城市",
                      inputValue: cityRuleInput,
                      onInputChange: setCityRuleInput,
                      options: cityRuleOptions,
                      datalistId: "coupon-city-rule-options",
                    })}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
                  <div className="text-sm font-semibold text-slate-900">库存</div>
                  <div className="mt-2 grid gap-3 md:grid-cols-5">
                    {[
                      ["总库存", "totalQuantity"],
                      ["每月库存", "claimMonthlyStockLimit"],
                      ["每周库存", "claimWeeklyStockLimit"],
                      ["每日库存", "claimDailyStockLimit"],
                      ["每小时库存", "claimHourlyStockLimit"],
                    ].map(([label, key]) => (
                      <label key={key} className="space-y-1 text-sm">
                        <span className="block text-slate-600">{label}</span>
                        <input
                          type="number"
                          min={0}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                          value={form[key as "totalQuantity" | "claimMonthlyStockLimit" | "claimWeeklyStockLimit" | "claimDailyStockLimit" | "claimHourlyStockLimit"]}
                          onChange={handleInputChange(key as "totalQuantity" | "claimMonthlyStockLimit" | "claimWeeklyStockLimit" | "claimDailyStockLimit" | "claimHourlyStockLimit")}
                          placeholder="0 不限制"
                        />
                      </label>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
                  <div className="text-sm font-semibold text-slate-900">领取次数</div>
                  <div className="mt-2 grid gap-3 md:grid-cols-4">
                    {[
                      ["每人领取总数", "claimPerUserTotalLimit"],
                      ["每日领取数", "claimPerUserDailyLimit"],
                      ["每周领取数", "claimPerUserWeeklyLimit"],
                      ["每月领取数", "claimPerUserMonthlyLimit"],
                    ].map(([label, key]) => (
                      <label key={key} className="space-y-1 text-sm">
                        <span className="block text-slate-600">{label}</span>
                        <input
                          type="number"
                          min={0}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                          value={form[key as "claimPerUserTotalLimit" | "claimPerUserDailyLimit" | "claimPerUserWeeklyLimit" | "claimPerUserMonthlyLimit"]}
                          onChange={handleInputChange(key as "claimPerUserTotalLimit" | "claimPerUserDailyLimit" | "claimPerUserWeeklyLimit" | "claimPerUserMonthlyLimit")}
                          placeholder="0 不限制"
                        />
                      </label>
                    ))}
                  </div>
                </div>

                <div
                  className={`grid gap-3 ${
                    form.discountType === "product_voucher"
                      ? "md:grid-cols-2 xl:grid-cols-5"
                      : form.discountType === "stored_value" ||
                          form.discountType === "points_voucher" ||
                          form.discountType === "exchange_voucher"
                        ? "md:grid-cols-2"
                        : form.discountType === "ticket_voucher"
                          ? "md:grid-cols-2"
                        : "md:grid-cols-3"
                  }`}
                >
                  <label className="space-y-1 text-sm">
                    <span className="block text-slate-600">优惠类型</span>
                    <select
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                      value={form.discountType}
                      onChange={(event) => updateDiscountType(event.target.value as MerchantCouponDiscountType)}
                    >
                      {COUPON_DISCOUNT_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {form.discountType === "product_voucher" ? (
                    <>
                      <label className="space-y-1 text-sm">
                        <span className="block text-slate-600">商品名称</span>
                        <input
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                          value={form.productName}
                          onChange={handleInputChange("productName")}
                          placeholder="例如：指定商品"
                        />
                      </label>
                      <label className="space-y-1 text-sm">
                        <span className="block text-slate-600">商品条码</span>
                        <input
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                          value={form.productBarcode}
                          onChange={handleInputChange("productBarcode")}
                          placeholder="可选"
                        />
                      </label>
                      <label className="space-y-1 text-sm">
                        <span className="block text-slate-600">商品数量</span>
                        <input
                          type="number"
                          min={0}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                          value={form.productQuantity}
                          onChange={handleInputChange("productQuantity")}
                          placeholder="可选"
                        />
                      </label>
                      <label className="space-y-1 text-sm">
                        <span className="block text-slate-600">商品金额</span>
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                          value={form.productAmount}
                          onChange={handleInputChange("productAmount")}
                          placeholder="可选"
                        />
                      </label>
                    </>
                  ) : form.discountType === "stored_value" ? (
                    <label className="space-y-1 text-sm">
                      <span className="block text-slate-600">储值金额</span>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                        value={form.discountValue}
                        onChange={handleInputChange("discountValue")}
                      />
                    </label>
                  ) : form.discountType === "points_voucher" ? (
                    <>
                      <label className="space-y-1 text-sm">
                        <span className="block text-slate-600">抵扣积分</span>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                          value={form.discountValue}
                          onChange={handleInputChange("discountValue")}
                          placeholder="例如：50"
                        />
                      </label>
                      <label className="space-y-1 text-sm">
                        <span className="block text-slate-600">使用门槛积分</span>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                          value={form.pointsVoucherMinimumRedeemPoints}
                          onChange={handleInputChange("pointsVoucherMinimumRedeemPoints")}
                          placeholder="空为不限制"
                        />
                      </label>
                      <label className="space-y-1 text-sm">
                        <span className="block text-slate-600">单次最多使用张数</span>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                          value={form.pointsVoucherMaxPerRedemption}
                          onChange={handleInputChange("pointsVoucherMaxPerRedemption")}
                          placeholder="空为不限制"
                        />
                      </label>
                    </>
                  ) : form.discountType === "exchange_voucher" ? (
                    <>
                      <label className="space-y-1 text-sm">
                        <span className="block text-slate-600">兑换项目</span>
                        <input
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                          value={form.exchangeItem}
                          onChange={handleInputChange("exchangeItem")}
                          placeholder="填写项目内容"
                        />
                      </label>
                      <label className="space-y-1 text-sm">
                        <span className="block text-slate-600">项目数量</span>
                        <input
                          type="number"
                          min={0}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                          value={form.exchangeQuantity}
                          onChange={handleInputChange("exchangeQuantity")}
                          placeholder="可选"
                        />
                      </label>
                    </>
                  ) : form.discountType === "ticket_voucher" ? (
                    <>
                      <label className="space-y-1 text-sm">
                        <span className="block text-slate-600">场地</span>
                        <input
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                          value={form.ticketVenue}
                          onChange={handleInputChange("ticketVenue")}
                          placeholder="填写场地名称"
                        />
                      </label>
                      <label className="space-y-1 text-sm">
                        <span className="block text-slate-600">时长（min）</span>
                        <input
                          type="number"
                          min={0}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                          value={form.ticketDurationMinutes}
                          onChange={handleInputChange("ticketDurationMinutes")}
                          placeholder="单位：min"
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <label className="space-y-1 text-sm">
                        <span className="block text-slate-600">{discountValueLabel}</span>
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
                    </>
                  )}
                </div>
              </CouponFormSection>

              <CouponFormSection title="展示文案">
                <div className="grid gap-2">
                  {form.displayFieldOrder.map((field, index) => {
                    const config = DISPLAY_FIELD_CONFIG[field];
                    const selected = selectedDisplayFields.includes(field);
                    return (
                      <div
                        key={field}
                        className={`grid grid-cols-[104px_minmax(0,1fr)_116px_auto] items-center gap-2 rounded-lg border bg-white px-3 py-2 ${selected ? "border-slate-900" : "border-slate-200"}`}
                      >
                        <label className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-800">
                          <input
                            type="checkbox"
                            className="shrink-0"
                            checked={selected}
                            onChange={(event) => toggleDisplayFieldSelection(field, event.target.checked)}
                          />
                          <span className="truncate">{config.label}</span>
                        </label>
                        <input
                          className="min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                          value={form[config.valueKey]}
                          onChange={(event) => updateDisplayText(field, event.target.value)}
                        />
                        <select
                          className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none focus:border-slate-500"
                          value={form.displayBoxStyles[field]}
                          onChange={(event) => updateDisplayBoxStyle(field, event.target.value as MerchantCouponDisplayBoxStyle)}
                          aria-label={`${config.label}底框样式`}
                        >
                          {DISPLAY_BOX_STYLE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <div className="flex shrink-0 gap-1">
                          <button
                            type="button"
                            className="rounded border bg-white px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-40"
                            onClick={() => moveDisplayField(field, -1)}
                            disabled={index === 0}
                          >
                            上移
                          </button>
                          <button
                            type="button"
                            className="rounded border bg-white px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-40"
                            onClick={() => moveDisplayField(field, 1)}
                            disabled={index === form.displayFieldOrder.length - 1}
                          >
                            下移
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
                  <div className="text-sm font-semibold text-slate-900">选中文案样式</div>
                  <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_140px_140px_120px]">
                    <label className="space-y-1 text-sm">
                      <span className="block text-slate-600">字体</span>
                      <select
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                        value={form.contentFontFamily}
                        onChange={handleInputChange("contentFontFamily")}
                      >
                        {COUPON_FONT_OPTIONS.map((option) => (
                          <option key={option.value || "default"} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1 text-sm">
                      <span className="block text-slate-600">文案颜色</span>
                      <input
                        type="color"
                        className="h-10 w-full rounded border border-slate-300 bg-white px-1"
                        value={form[DISPLAY_FIELD_CONFIG[selectedDisplayFields[0] ?? "discount"].colorKey]}
                        onChange={(event) => applySelectedTextStyle("color", event.target.value)}
                      />
                    </label>
                    <label className="space-y-1 text-sm">
                      <span className="block text-slate-600">底框颜色</span>
                      <input
                        type="color"
                        className="h-10 w-full rounded border border-slate-300 bg-white px-1"
                        value={form.displayBoxColors[selectedDisplayFields[0] ?? "discount"]}
                        onChange={(event) => applySelectedBoxColor(event.target.value)}
                      />
                    </label>
                    <label className="space-y-1 text-sm">
                      <span className="block text-slate-600">字号</span>
                      <input
                        type="number"
                        min={8}
                        max={72}
                        className="h-10 w-full rounded border border-slate-300 px-2 outline-none focus:border-slate-500"
                        value={form[DISPLAY_FIELD_CONFIG[selectedDisplayFields[0] ?? "discount"].sizeKey]}
                        onChange={(event) => applySelectedTextStyle("size", event.target.value)}
                      />
                    </label>
                  </div>
                </div>
              </CouponFormSection>

              <CouponFormSection title="领取规则">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2 rounded-lg border border-slate-200 bg-white px-3 py-3">
                    <label className="block space-y-1 text-sm">
                      <span className="block text-slate-600">日期时间段</span>
                      <textarea
                        className="min-h-[68px] w-full resize-y rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                        value={form.claimDateTimeWindows}
                        onChange={handleInputChange("claimDateTimeWindows")}
                        placeholder="2026-06-01 09:00 ~ 2026-06-10 22:00，一行一段"
                      />
                    </label>
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                      <CouponNativePickerField
                        label="开始"
                        pickerType="datetime-local"
                        value={claimDateWindowStart}
                        onChange={setClaimDateWindowStart}
                        placeholder="选择开始时间"
                      />
                      <CouponNativePickerField
                        label="结束"
                        pickerType="datetime-local"
                        value={claimDateWindowEnd}
                        onChange={setClaimDateWindowEnd}
                        placeholder="选择结束时间"
                      />
                      <button
                        type="button"
                        className="h-10 rounded border bg-white px-3 text-sm hover:bg-slate-50 disabled:opacity-40"
                        onClick={addDateTimeClaimWindow}
                        disabled={!claimDateWindowStart || !claimDateWindowEnd}
                      >
                        加入
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2 rounded-lg border border-slate-200 bg-white px-3 py-3">
                    <label className="block space-y-1 text-sm">
                      <span className="block text-slate-600">每日时间段</span>
                      <textarea
                        className="min-h-[68px] w-full resize-y rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                        value={form.claimDailyTimeWindows}
                        onChange={handleInputChange("claimDailyTimeWindows")}
                        placeholder="09:00 ~ 12:00，一行一段"
                      />
                    </label>
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                      <CouponNativePickerField
                        label="开始"
                        pickerType="time"
                        value={claimDailyWindowStart}
                        onChange={setClaimDailyWindowStart}
                        placeholder="选择开始"
                      />
                      <CouponNativePickerField
                        label="结束"
                        pickerType="time"
                        value={claimDailyWindowEnd}
                        onChange={setClaimDailyWindowEnd}
                        placeholder="选择结束"
                      />
                      <button
                        type="button"
                        className="h-10 rounded border bg-white px-3 text-sm hover:bg-slate-50 disabled:opacity-40"
                        onClick={addDailyClaimWindow}
                        disabled={!claimDailyWindowStart || !claimDailyWindowEnd}
                      >
                        加入
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1 text-sm">
                    <span className="block text-slate-600">领取后多少小时内有效</span>
                    <input
                      type="number"
                      min={0}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                      value={form.claimValidHoursAfterClaim}
                      onChange={handleInputChange("claimValidHoursAfterClaim")}
                      placeholder="0 不限制"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="block text-slate-600">领取后多少天内有效</span>
                    <input
                      type="number"
                      min={0}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                      value={form.claimValidDaysAfterClaim}
                      onChange={handleInputChange("claimValidDaysAfterClaim")}
                      placeholder="0 不限制"
                    />
                  </label>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
                  <div className="text-sm font-semibold text-slate-900">行为触发领取</div>
                  <div className="mt-2 grid gap-2 md:grid-cols-3">
                    {BEHAVIOR_TRIGGER_OPTIONS.map((option) => (
                      <label key={option.value} className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                        <input
                          type="checkbox"
                          checked={form.claimBehaviorTriggers.includes(option.value)}
                          onChange={(event) => toggleBehaviorTrigger(option.value, event.target.checked)}
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                  <div className="mt-2 grid gap-3 md:grid-cols-3">
                    <label className="space-y-1 text-sm">
                      <span className="block text-slate-600">满额金额</span>
                      <input type="number" min={0} step={0.01} className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500" value={form.claimTriggerAmount} onChange={handleInputChange("claimTriggerAmount")} />
                    </label>
                    <label className="space-y-1 text-sm">
                      <span className="block text-slate-600">满次次数</span>
                      <input type="number" min={0} className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500" value={form.claimTriggerCount} onChange={handleInputChange("claimTriggerCount")} />
                    </label>
                    <CouponDateTimeField label="指定日期" value={form.claimTriggerDate} onChange={(value) => updateField("claimTriggerDate", value)} placeholder="2026-06-01 00:00" />
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
                  <div className="text-sm font-semibold text-slate-900">任务领取</div>
                  <div className="mt-2 grid gap-2 md:grid-cols-3">
                    {TASK_REQUIREMENT_OPTIONS.map((option) => (
                      <label key={option.value} className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                        <input
                          type="checkbox"
                          checked={form.claimTaskRequirements.includes(option.value)}
                          onChange={(event) => toggleTaskRequirement(option.value, event.target.checked)}
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                  <div className="mt-2 grid gap-3 md:grid-cols-2">
                    <label className="space-y-1 text-sm">
                      <span className="block text-slate-600">指定页面</span>
                      <input className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500" value={form.claimTaskPageUrl} onChange={handleInputChange("claimTaskPageUrl")} placeholder="页面路径或完整 URL" />
                    </label>
                    <label className="space-y-1 text-sm">
                      <span className="block text-slate-600">邀请人数</span>
                      <input type="number" min={0} className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500" value={form.claimTaskInviteCount} onChange={handleInputChange("claimTaskInviteCount")} />
                    </label>
                  </div>
                </div>

                <label className="block space-y-1 text-sm">
                  <span className="block text-slate-600">适用标签</span>
                  <textarea
                    className="min-h-[70px] w-full resize-y rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                    value={form.applicableTags}
                    onChange={handleInputChange("applicableTags")}
                    placeholder="可选，一行一个或用逗号分隔"
                  />
                  <span className="block text-xs text-slate-500">
                    预留给后续按产品、场景或客户标签筛选；当前不影响网站区块或联系卡展示。
                  </span>
                </label>
              </CouponFormSection>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                onClick={() => void saveCoupon()}
                disabled={saving || !siteId}
              >
                {saving ? "保存中..." : form.id ? "保存修改" : "创建优惠券"}
              </button>
              <button
                type="button"
                className="rounded-lg border bg-white px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                onClick={() => {
                  setFormOpen(false);
                  setForm(buildNewCouponForm(pricePrefix));
                  setError("");
                  setTip("");
                }}
                disabled={saving || uploadingBackground}
              >
                取消
              </button>
            </div>
          </div>
          <aside className="lg:sticky lg:top-6 self-start rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="text-sm font-semibold text-slate-900">实时预览</div>
            <div className="mt-1 text-xs text-slate-500">这里显示客户在优惠券区块里看到的卡片效果。</div>
            <div className="mt-3">
              <CouponVisualCard data={formPreviewData} />
            </div>
            <div className="mt-4 rounded-lg border border-slate-200 bg-white px-3 py-3">
              <div className="text-sm font-semibold text-slate-900">当前设置</div>
              <div className="mt-3 grid gap-3">
                {formSettingSummary.map((group) => (
                  <div key={group.title} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                    <div className="text-xs font-semibold text-slate-800">{group.title}</div>
                    <dl className="mt-2 grid gap-1.5 text-xs">
                      {group.items.map((item) => (
                        <div key={`${group.title}-${item.label}`} className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
                          <dt className="text-slate-400">{item.label}</dt>
                          <dd className="min-w-0 break-words font-medium text-slate-700">{item.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>
            </div>
          </aside>
          </div>
          </section>
        </div>
      ) : null}

      {showRedeemWorkbench ? (
        <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_18px_48px_rgba(15,23,42,0.08)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-base font-semibold text-slate-900">核销工作台</div>
              <div className="mt-1 text-xs text-slate-500">输入客户出示的券码，确认后写入核销记录。</div>
            </div>
            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${redeemLookupStatus.className}`}>
              {redeemLookupStatus.label}
            </span>
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                <label className="min-w-0 space-y-1 text-sm">
                  <span className="block font-semibold text-slate-700">券码</span>
                  <input
                    className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold tracking-wide text-slate-900 outline-none focus:border-slate-500"
                    value={redeemCodeInput}
                    onChange={(event) => setRedeemCodeInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      void redeemCurrentCouponCode();
                    }}
                    placeholder="输入二维码 / 条码 / 核销码"
                  />
                </label>
                <button
                  type="button"
                  className="self-end rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                  onClick={() => void redeemCurrentCouponCode()}
                  disabled={redeeming || !redeemLookupStatus.redeemable}
                >
                  {redeeming ? "核销中..." : "确认核销"}
                </button>
              </div>
              <label className="mt-3 block space-y-1 text-sm">
                <span className="block font-semibold text-slate-700">备注</span>
                <input
                  className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-slate-500"
                  value={redeemNote}
                  onChange={(event) => setRedeemNote(event.target.value)}
                  placeholder="可选"
                />
              </label>

              {redeemCodeInput.trim() && !redeemLookup ? (
                <div className="mt-4 rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 py-6 text-center text-sm font-semibold text-rose-700">
                  未找到该券码
                </div>
              ) : null}

              {redeemLookup ? (
                <div className="mt-4 grid gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm md:grid-cols-2">
                  <div>
                    <div className="text-xs text-slate-400">优惠券</div>
                    <div className="mt-1 font-semibold text-slate-900">{getMerchantCouponDisplayTitle(redeemLookup.coupon)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">优惠内容</div>
                    <div className="mt-1 font-semibold text-slate-900">{getMerchantCouponDiscountLabel(redeemLookup.coupon, pricePrefix)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">领取人</div>
                    <div className="mt-1 break-all font-semibold text-slate-900">
                      {redeemLookup.claimEvent.customerName || redeemLookup.claimEvent.email || redeemLookup.claimEvent.accountId || "访客"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">领取时间</div>
                    <div className="mt-1 font-semibold text-slate-900">{formatDateTime(redeemLookup.claimEvent.at)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">有效期</div>
                    <div className="mt-1 font-semibold text-slate-900">
                      {redeemLookup.claimEvent.validUntil ? formatDateTime(redeemLookup.claimEvent.validUntil) : "不限"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">核销码</div>
                    <div className="mt-1 break-all font-mono font-semibold text-slate-900">{redeemLookup.claimEvent.settlementCode}</div>
                  </div>
                  {redeemLookup.redeemEvent ? (
                    <div className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600">
                      已于 {formatDateTime(redeemLookup.redeemEvent.at)} 核销
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <aside className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="text-sm font-semibold text-slate-900">预览</div>
              <div className="mt-3">
                {redeemLookup ? (
                  <CouponVisualCard data={buildCouponVisualDataFromRecord(redeemLookup.coupon, pricePrefix)} className="min-h-[188px]" />
                ) : (
                  <div className="flex min-h-[188px] items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-sm text-slate-500">
                    等待券码
                  </div>
                )}
              </div>
              <div className="mt-4 text-sm font-semibold text-slate-900">最近核销</div>
              <div className="mt-2 max-h-56 space-y-2 overflow-auto text-xs">
                {redeemRecordRows.slice(0, 6).length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-slate-500">暂无核销记录</div>
                ) : (
                  redeemRecordRows.slice(0, 6).map(({ coupon, event }) => (
                    <div key={`workbench-${coupon.id}-${event.id}`} className="rounded-lg border border-slate-100 bg-white px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-semibold text-slate-800">{getMerchantCouponDisplayTitle(coupon)}</span>
                        <span className="shrink-0 text-slate-400">{formatDateTime(event.at)}</span>
                      </div>
                      <div className="mt-1 break-all font-mono text-slate-600">{event.settlementCode}</div>
                    </div>
                  ))
                )}
              </div>
            </aside>
          </div>
        </section>
      ) : null}

      {showCouponList ? (
      <section className="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_18px_48px_rgba(15,23,42,0.08)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-base font-semibold text-slate-900">优惠券列表</div>
              <div className="mt-1 text-xs text-slate-500">启用、未过期、且勾选网站展示的优惠券会显示到优惠券区块。</div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="coupon-status-filter">
                按状态筛选
              </label>
              <select
                id="coupon-status-filter"
                className="rounded border border-slate-300 bg-white px-3 py-2 text-xs outline-none hover:bg-slate-50 focus:border-slate-500"
                value={couponStatusFilter}
                onChange={(event) => setCouponStatusFilter(event.target.value as CouponLifecycleStatusFilter)}
              >
                {COUPON_LIFECYCLE_STATUS_FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {listOnly ? (
              <button
                type="button"
                className="shrink-0 rounded border bg-white px-3 py-2 text-xs hover:bg-slate-50 disabled:opacity-50"
                onClick={() => void loadCoupons(true)}
                disabled={loading || !siteId}
              >
                {loading ? "刷新中" : "刷新"}
              </button>
              ) : null}
            </div>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {loading ? (
              <div className="col-span-full rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">正在加载优惠券...</div>
            ) : displayCoupons.length === 0 ? (
              <div className="col-span-full rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                {couponStatusFilter === "all" ? "还没有优惠券。先创建一张，并保持“网站区块展示”开启。" : "当前状态下没有优惠券。"}
              </div>
            ) : (
              displayCoupons.map((coupon) => {
                const selected = coupon.id === form.id;
                const visualData = buildCouponVisualDataFromRecord(coupon, pricePrefix);
                const totalQuantityLabel = coupon.totalQuantity > 0 ? String(coupon.totalQuantity) : "不限";
                const lifecycleStatus = getCouponLifecycleStatus(coupon);
                const displayScopes = [
                  coupon.showOnWebsite ? "网站" : "",
                  coupon.showOnContactCard ? "联系卡" : "",
                ].filter(Boolean);
                return (
                  <article
                    key={coupon.id}
                    className={`flex min-w-0 flex-col gap-2 transition ${
                      selected ? "rounded-lg ring-2 ring-slate-950 ring-offset-2" : ""
                    }`}
                  >
                    <button
                      type="button"
                      className={`block w-full rounded-lg text-left transition ${canEditCoupons ? "hover:ring-1 hover:ring-slate-300" : ""}`}
                      onClick={() => {
                        if (!canEditCoupons) return;
                        setForm(buildFormFromCoupon(coupon, pricePrefix));
                        setSelectedDisplayFields(["discount"]);
                        setError("");
                        setTip("");
                        setFormOpen(true);
                      }}
                    >
                      <CouponVisualCard data={visualData} className="min-h-[188px]" />
                    </button>
                      <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 sm:grid-cols-6">
                        <div className="min-w-0">
                          <span className="block text-[11px] text-slate-400">优惠类型</span>
                          <span className="mt-0.5 block truncate font-semibold text-slate-800">
                            {COUPON_DISCOUNT_TYPE_LABELS[coupon.discountType]}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <span className="block text-[11px] text-slate-400">状态</span>
                          <span className={`mt-0.5 inline-flex rounded-full border px-2 py-0.5 font-semibold ${COUPON_LIFECYCLE_STATUS_CLASS_NAMES[lifecycleStatus]}`}>
                            {COUPON_LIFECYCLE_STATUS_LABELS[lifecycleStatus]}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <span className="block text-[11px] text-slate-400">总数量</span>
                          <span className="mt-0.5 block truncate font-semibold text-slate-800">{totalQuantityLabel}</span>
                        </div>
                        <div className="min-w-0">
                          <span className="block text-[11px] text-slate-400">领取数量</span>
                          <span className="mt-0.5 block truncate font-semibold text-slate-800">{coupon.claimedCount}</span>
                        </div>
                        <div className="min-w-0">
                          <span className="block text-[11px] text-slate-400">使用数量</span>
                          <span className="mt-0.5 block truncate font-semibold text-slate-800">{coupon.usedCount}</span>
                        </div>
                        <div className="min-w-0">
                          <span className="block text-[11px] text-slate-400">展示范围</span>
                          <span className="mt-0.5 flex flex-wrap gap-1">
                            {displayScopes.length > 0 ? (
                              displayScopes.map((scope) => (
                                <span key={scope} className="inline-flex rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 font-semibold text-cyan-700">
                                  {scope}
                                </span>
                              ))
                            ) : (
                              <span className="font-semibold text-slate-500">未展示</span>
                            )}
                          </span>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          className="rounded border bg-white px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"
                          onClick={() => void copyCoupon(coupon)}
                          disabled={saving}
                        >
                          复制券
                        </button>
                        <>
                          <CouponStatusSwitch
                            checked={coupon.status === "active"}
                            onChange={(checked) =>
                              void patchCoupon(coupon, { status: checked ? "active" : "paused" }, checked ? "优惠券已启用" : "优惠券已暂停")
                            }
                            disabled={saving}
                          />
                          <button
                            type="button"
                            className="rounded border border-rose-200 bg-white px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                            onClick={() => void archiveCoupon(coupon)}
                            disabled={saving}
                          >
                            删除
                          </button>
                        </>
                      </div>
                  </article>
                );
              })
            )}
          </div>
      </section>
      ) : null}

      {showRecordSections ? (
      <section className={recordSectionClassName}>
        {showClaimRecords ? (
        <div className="rounded-[28px] border border-slate-200 bg-white px-4 py-4 shadow-[0_18px_48px_rgba(15,23,42,0.08)]">
          <div className="text-sm font-semibold text-slate-900">领取记录</div>
          <div className={recordScrollClassName}>
            {claimRecordRows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-slate-500">暂无领取记录</div>
            ) : (
              claimRecordRows.map(({ coupon, event }) => (
                <div key={`${coupon.id}-${event.id}`} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold text-slate-800">{coupon.title}</span>
                    <span className="shrink-0 text-slate-400">{formatDateTime(event.at)}</span>
                  </div>
                  <div className="mt-1 break-all text-slate-500">{event.customerName || event.email || event.accountId || "访客"}</div>
                  <div className="mt-1 break-all font-mono text-slate-700">{event.settlementCode || "-"}</div>
                </div>
              ))
            )}
          </div>
        </div>
        ) : null}

        {showRedeemRecords ? (
        <div className="rounded-[28px] border border-slate-200 bg-white px-4 py-4 shadow-[0_18px_48px_rgba(15,23,42,0.08)]">
          <div className="text-sm font-semibold text-slate-900">核销记录</div>
          <div className={recordScrollClassName}>
            {redeemRecordRows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-slate-500">暂无核销记录</div>
            ) : (
              redeemRecordRows.map(({ coupon, event }) => (
                <div key={`${coupon.id}-${event.id}`} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold text-slate-800">{coupon.title}</span>
                    <span className="shrink-0 text-slate-400">{formatDateTime(event.at)}</span>
                  </div>
                  <div className="mt-1 break-all font-mono text-slate-700">{event.settlementCode}</div>
                  <div className="mt-1 break-all text-slate-500">{event.operatorId || "-"}</div>
                </div>
              ))
            )}
          </div>
        </div>
        ) : null}

        {showDailyStats ? (
        <div className="rounded-[28px] border border-slate-200 bg-white px-4 py-4 shadow-[0_18px_48px_rgba(15,23,42,0.08)]">
          <div className="text-sm font-semibold text-slate-900">日报统计</div>
          <div className={recordScrollClassName}>
            {dailyStatsRows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-slate-500">暂无统计</div>
            ) : (
              dailyStatsRows.map((row) => (
                <div key={row.date} className="grid grid-cols-3 gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                  <div className="font-semibold text-slate-800">{row.date}</div>
                  <div className="text-slate-600">领取 {row.claimed}</div>
                  <div className="text-slate-600">核销 {row.redeemed}</div>
                </div>
              ))
            )}
          </div>
        </div>
        ) : null}
      </section>
      ) : null}
    </div>
  );
}
