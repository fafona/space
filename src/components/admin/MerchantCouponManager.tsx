"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent } from "react";
import { getBackgroundStyle } from "@/components/blocks/backgroundStyle";
import { normalizePublicAssetUrl } from "@/lib/publicAssetUrl";
import {
  MERCHANT_COUPON_BEHAVIOR_TRIGGERS,
  MERCHANT_COUPON_DISPLAY_FIELDS,
  MERCHANT_COUPON_TASK_REQUIREMENTS,
  MERCHANT_COUPON_USAGE_SCENARIOS,
  getContactCardVisibleMerchantCoupons,
  getMerchantCouponDisplayDescription,
  getMerchantCouponDisplayFieldOrder,
  getMerchantCouponDisplayMetaText,
  getMerchantCouponDisplayTitle,
  getMerchantCouponDiscountLabel,
  getVisibleMerchantCoupons,
  isMerchantCouponDisplayFieldHidden,
  normalizeMerchantCouponRecords,
  type MerchantCouponBehaviorTrigger,
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
  pricePrefix?: string;
  onCouponsChange?: (coupons: MerchantCouponRecord[]) => void;
  onClose?: () => void;
  className?: string;
  listOnly?: boolean;
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
  backgroundImageUrl: string;
  backgroundImageOpacity: string;
  usageScenarios: MerchantCouponUsageScenario[];
  displayTitle: string;
  displayDescription: string;
  displayDiscountText: string;
  displayMetaText: string;
  displayFieldOrder: MerchantCouponDisplayField[];
  displayHiddenFields: MerchantCouponDisplayField[];
  contentFontFamily: string;
  discountTextColor: string;
  discountFontSize: string;
  titleTextColor: string;
  titleFontSize: string;
  descriptionTextColor: string;
  descriptionFontSize: string;
  metaTextColor: string;
  metaFontSize: string;
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
  usageScenarios: ["order_cart"],
  displayTitle: "",
  displayDescription: "",
  displayDiscountText: "",
  displayMetaText: "",
  displayFieldOrder: [...MERCHANT_COUPON_DISPLAY_FIELDS],
  displayHiddenFields: [],
  contentFontFamily: "",
  discountTextColor: "#f43f5e",
  discountFontSize: "12",
  titleTextColor: "#020617",
  titleFontSize: "16",
  descriptionTextColor: "#64748b",
  descriptionFontSize: "14",
  metaTextColor: "#64748b",
  metaFontSize: "12",
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

const USAGE_SCENARIO_OPTIONS: Array<{
  value: MerchantCouponUsageScenario;
  label: string;
  description: string;
}> = [
  {
    value: "order_cart",
    label: "订单（购物车中扣除）",
    description: "用于顾客下单时从购物车金额中抵扣。",
  },
  {
    value: "checkout_qr",
    label: "结算二维码",
    description: "领取后可生成唯一二维码核销码。",
  },
  {
    value: "checkout_barcode",
    label: "结算条码",
    description: "领取后可生成唯一一维码核销码。",
  },
];

const USAGE_SCENARIO_LABELS: Record<MerchantCouponUsageScenario, string> = {
  order_cart: "订单",
  checkout_qr: "二维码",
  checkout_barcode: "条码",
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
];

const DISCOUNT_VALUE_REQUIRED_TYPES: MerchantCouponDiscountType[] = [
  "threshold_amount_off",
  "amount_off",
  "percent_off",
  "stored_value",
];

const COUPON_DISCOUNT_TYPE_LABELS = Object.fromEntries(
  COUPON_DISCOUNT_TYPE_OPTIONS.map((option) => [option.value, option.label]),
) as Record<MerchantCouponDiscountType, string>;

const DISPLAY_FIELD_CONFIG: Record<
  MerchantCouponDisplayField,
  {
    label: string;
    valueKey: "displayDiscountText" | "displayTitle" | "displayDescription" | "displayMetaText";
    colorKey: "discountTextColor" | "titleTextColor" | "descriptionTextColor" | "metaTextColor";
    sizeKey: "discountFontSize" | "titleFontSize" | "descriptionFontSize" | "metaFontSize";
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

function toNumberValue(value: string) {
  const next = Number.parseFloat(value);
  return Number.isFinite(next) ? Math.max(0, next) : 0;
}

function toIntValue(value: string) {
  const next = Number.parseInt(value, 10);
  return Number.isFinite(next) ? Math.max(0, Math.round(next)) : 0;
}

function normalizeCodeInput(value: string) {
  return value.replace(/\s+/g, "").toUpperCase();
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

function normalizeFormUsageScenarios(value: MerchantCouponUsageScenario[]) {
  const selected = value.filter((item) => MERCHANT_COUPON_USAGE_SCENARIOS.includes(item));
  return Array.from(new Set(selected));
}

function formatUsageScenarios(value: MerchantCouponUsageScenario[]) {
  const selected = normalizeFormUsageScenarios(value);
  return selected.map((item) => USAGE_SCENARIO_LABELS[item]).join(" / ") || "未设置";
}

function buildRecordDefaultMetaText(coupon: MerchantCouponRecord, pricePrefix: string) {
  return [
    coupon.minimumAmount > 0 ? `门槛 ${pricePrefix}${coupon.minimumAmount.toFixed(2)}` : "",
    formatUsageScenarios(coupon.usageScenarios),
    coupon.expiresAt ? `至 ${formatDateTime(coupon.expiresAt)}` : "",
  ]
    .filter(Boolean)
    .join("  ");
}

function buildCouponClaimUrl(publicSiteUrl: string | undefined, siteId: string, coupon: MerchantCouponRecord) {
  if (typeof window === "undefined") return "";
  const fallbackPath = siteId ? `/site/${encodeURIComponent(siteId)}` : window.location.pathname;
  try {
    const url = new URL(publicSiteUrl?.trim() || fallbackPath, window.location.origin);
    url.searchParams.set("claimCoupon", coupon.id);
    if (coupon.code) {
      url.searchParams.set("claimCode", coupon.code);
    }
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
    `优惠码：${coupon.code}`,
    claimUrl ? `领取链接：${claimUrl}` : "",
    getMerchantCouponDisplayDescription(coupon) ? `说明：${getMerchantCouponDisplayDescription(coupon)}` : "",
    `使用场景：${formatUsageScenarios(coupon.usageScenarios)}`,
    coupon.expiresAt ? `有效期至：${formatDateTime(coupon.expiresAt)}` : "",
  ];
  return lines.filter((line) => line.trim()).join("\n");
}

function buildFormGeneratedDiscountText(form: CouponFormState, pricePrefix: string) {
  const discountValue = toNumberValue(form.discountValue);
  const minimumAmount = toNumberValue(form.minimumAmount);
  if (form.discountType === "percent_off") return `${discountValue || 0}% OFF`;
  if (form.discountType === "threshold_amount_off") return `满 ${pricePrefix}${minimumAmount.toFixed(2)} 减 ${pricePrefix}${discountValue.toFixed(2)}`;
  if (form.discountType === "product_voucher") return "商品券";
  if (form.discountType === "stored_value") return `储值 ${pricePrefix}${discountValue.toFixed(2)}`;
  if (form.discountType === "exchange_voucher") return "兑换券";
  if (form.discountType === "ticket_voucher") return "门票券";
  return `减 ${pricePrefix}${discountValue.toFixed(2)}`;
}

function buildFormDefaultMetaText(form: CouponFormState, pricePrefix: string) {
  const minimumAmount = toNumberValue(form.minimumAmount);
  return [
    minimumAmount > 0 ? `门槛 ${pricePrefix}${minimumAmount.toFixed(2)}` : "",
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
    maxDiscountAmount: "",
    totalQuantity: "",
    perCustomerLimit: "",
    startsAt: toDateTimeTextValue(coupon.startsAt),
    expiresAt: toDateTimeTextValue(coupon.expiresAt),
    status: coupon.status,
    showOnWebsite: coupon.showOnWebsite,
    showOnContactCard: coupon.showOnContactCard,
    backgroundImageUrl: coupon.backgroundImageUrl,
    backgroundImageOpacity: String(coupon.backgroundImageOpacity),
    usageScenarios: normalizeFormUsageScenarios(coupon.usageScenarios),
    displayTitle: hiddenFields.includes("title") ? "" : getMerchantCouponDisplayTitle(coupon),
    displayDescription: hiddenFields.includes("description") ? "" : getMerchantCouponDisplayDescription(coupon),
    displayDiscountText: hiddenFields.includes("discount") ? "" : getMerchantCouponDiscountLabel(coupon, pricePrefix),
    displayMetaText: hiddenFields.includes("meta") ? "" : getMerchantCouponDisplayMetaText(coupon) || buildRecordDefaultMetaText(coupon, pricePrefix),
    displayFieldOrder: getMerchantCouponDisplayFieldOrder(coupon),
    displayHiddenFields: hiddenFields,
    contentFontFamily: coupon.contentFontFamily,
    discountTextColor: coupon.discountTextColor || "#f43f5e",
    discountFontSize: coupon.discountFontSize > 0 ? String(coupon.discountFontSize) : "12",
    titleTextColor: coupon.titleTextColor || "#020617",
    titleFontSize: coupon.titleFontSize > 0 ? String(coupon.titleFontSize) : "16",
    descriptionTextColor: coupon.descriptionTextColor || "#64748b",
    descriptionFontSize: coupon.descriptionFontSize > 0 ? String(coupon.descriptionFontSize) : "14",
    metaTextColor: coupon.metaTextColor || "#64748b",
    metaFontSize: coupon.metaFontSize > 0 ? String(coupon.metaFontSize) : "12",
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
    coupon.minimumAmount > 0 ? `门槛 ${pricePrefix}${coupon.minimumAmount.toFixed(2)}` : "",
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
  };
  const displayItems = getMerchantCouponDisplayFieldOrder(coupon)
    .filter((field) => !isMerchantCouponDisplayFieldHidden(coupon, field))
    .map((field) => ({ field, text: itemText[field] }))
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

function validateCouponForm(form: CouponFormState) {
  const discountValue = toNumberValue(form.discountValue);
  const minimumAmount = toNumberValue(form.minimumAmount);
  const startsAt = fromDateTimeTextValue(form.startsAt);
  const expiresAt = fromDateTimeTextValue(form.expiresAt);

  if (DISCOUNT_VALUE_REQUIRED_TYPES.includes(form.discountType) && discountValue <= 0) return "请填写大于 0 的优惠值";
  if (normalizeFormUsageScenarios(form.usageScenarios).length === 0) return "请至少选择一个使用场景";
  if (form.discountType === "percent_off" && discountValue > 100) return "折扣百分比不能超过 100";
  if (form.discountType === "threshold_amount_off" && minimumAmount <= 0) return "满减券需要填写大于 0 的门槛金额";
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
};

function buildTextStyle(data: CouponVisualCardData, role: "discount" | "title" | "description" | "meta"): CSSProperties {
  const style: CSSProperties = {};
  if (data.contentFontFamily) style.fontFamily = data.contentFontFamily;
  const color =
    role === "discount"
      ? data.discountTextColor
      : role === "title"
        ? data.titleTextColor
        : role === "description"
          ? data.descriptionTextColor
          : data.metaTextColor;
  const fontSize =
    role === "discount"
      ? data.discountFontSize
      : role === "title"
        ? data.titleFontSize
        : role === "description"
          ? data.descriptionFontSize
          : data.metaFontSize;
  if (color) style.color = color;
  if (fontSize > 0) style.fontSize = `${fontSize}px`;
  return style;
}

function CouponVisualCard({
  data,
  className = "",
  actionLabel = "复制优惠码",
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
          if (item.field === "title") {
            return (
              <div key={item.field} className={`${marginClass} truncate text-base font-bold text-slate-950`} style={buildTextStyle(data, item.field)}>
                {item.text}
              </div>
            );
          }
          if (item.field === "description") {
            return (
              <div key={item.field} className={`${marginClass} line-clamp-2 text-sm text-slate-500`} style={buildTextStyle(data, item.field)}>
                {item.text}
              </div>
            );
          }
          if (item.field === "meta") {
            return (
              <div key={item.field} className={`${marginClass} text-xs text-slate-500`} style={buildTextStyle(data, item.field)}>
                {item.text}
              </div>
            );
          }
          return (
            <div
              key={item.field}
              className={`${marginClass} text-xs font-semibold uppercase tracking-[0.18em] text-rose-500`}
              style={buildTextStyle(data, item.field)}
            >
              {item.text}
            </div>
          );
        })}
      </div>
      <div
        className={`inline-flex h-10 w-full items-center justify-center rounded-lg border border-slate-950 bg-slate-950 px-4 text-sm font-semibold text-white ${
          isList ? "sm:w-auto" : "mt-4"
        }`}
      >
        {actionLabel}
      </div>
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

export default function MerchantCouponManager({
  siteId,
  siteName,
  publicSiteUrl,
  pricePrefix = "",
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
  const [selectedDisplayFields, setSelectedDisplayFields] = useState<MerchantCouponDisplayField[]>(["discount"]);
  const backgroundFileInputRef = useRef<HTMLInputElement>(null);

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
    () => coupons.filter((coupon) => coupon.status !== "archived"),
    [coupons],
  );
  const formPreviewData = useMemo<CouponVisualCardData>(() => {
    const itemText: Record<MerchantCouponDisplayField, string> = {
      discount: form.displayDiscountText.trim(),
      title: form.displayTitle.trim(),
      description: form.displayDescription.trim(),
      meta: form.displayMetaText.trim(),
    };
    const displayItems = form.displayFieldOrder
      .filter((field) => !form.displayHiddenFields.includes(field))
      .map((field) => ({ field, text: itemText[field] }))
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
    };
  }, [form]);

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

  function updateDiscountType(value: MerchantCouponDiscountType) {
    setForm((current) => {
      const previousGeneratedText = buildFormGeneratedDiscountText(current, pricePrefix);
      const next = { ...current, discountType: value };
      const shouldRefreshDisplayText = !current.displayDiscountText.trim() || current.displayDiscountText.trim() === previousGeneratedText;
      return {
        ...next,
        displayDiscountText: shouldRefreshDisplayText ? buildFormGeneratedDiscountText(next, pricePrefix) : current.displayDiscountText,
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

  function toggleUsageScenario(scenario: MerchantCouponUsageScenario, checked: boolean) {
    setForm((current) => {
      const currentScenarios = normalizeFormUsageScenarios(current.usageScenarios);
      const nextScenarios = checked
        ? Array.from(new Set([...currentScenarios, scenario]))
        : currentScenarios.filter((item) => item !== scenario);
      return { ...current, usageScenarios: nextScenarios };
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
      maxDiscountAmount: 0,
      totalQuantity: 0,
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
      displayFieldOrder: form.displayFieldOrder,
      displayHiddenFields: hiddenFields,
      contentFontFamily: form.contentFontFamily.trim(),
      discountTextColor: form.discountTextColor.trim(),
      discountFontSize: normalizeFontSizeInput(form.discountFontSize),
      titleTextColor: form.titleTextColor.trim(),
      titleFontSize: normalizeFontSizeInput(form.titleFontSize),
      descriptionTextColor: form.descriptionTextColor.trim(),
      descriptionFontSize: normalizeFontSizeInput(form.descriptionFontSize),
      metaTextColor: form.metaTextColor.trim(),
      metaFontSize: normalizeFontSizeInput(form.metaFontSize),
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
      await loadCoupons();
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
      await loadCoupons();
      setTip("优惠券已删除");
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "优惠券删除失败");
    } finally {
      setSaving(false);
    }
  }

  async function copyCoupon(coupon: MerchantCouponRecord) {
    try {
      const claimUrl = buildCouponClaimUrl(publicSiteUrl, siteId, coupon);
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
        : form.discountType === "product_voucher" ||
            form.discountType === "exchange_voucher" ||
            form.discountType === "ticket_voucher"
          ? "券面数值（可选）"
          : "优惠金额";
  const canEditCoupons = !listOnly;
  const rootClassName = listOnly ? `space-y-4 ${className}` : `min-h-[calc(100vh-14rem)] space-y-4 ${className}`;

  return (
    <div className={rootClassName}>
      {!listOnly ? (
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
        {error ? <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</div> : null}
        {tip ? <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{tip}</div> : null}
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
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_CLASS_NAMES[selectedCoupon.status]}`}>
                  {STATUS_LABELS[selectedCoupon.status]}
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
            <div className="grid gap-3 md:grid-cols-2">
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
                onChange={(event) => updateField("code", normalizeCodeInput(event.target.value))}
                placeholder="留空会自动生成"
              />
            </label>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="text-sm font-semibold text-slate-900">卡片展示文案</div>
              <div className="mt-3 grid gap-2">
                {form.displayFieldOrder.map((field, index) => {
                  const config = DISPLAY_FIELD_CONFIG[field];
                  const selected = selectedDisplayFields.includes(field);
                  return (
                    <div
                      key={field}
                      className={`grid grid-cols-[104px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border bg-white px-3 py-2 ${selected ? "border-slate-900" : "border-slate-200"}`}
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
              <div className="mt-4 rounded-lg border border-slate-200 bg-white px-3 py-3">
                <div className="text-sm font-semibold text-slate-900">选中文案样式</div>
                <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_140px_120px]">
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
                    <span className="block text-slate-600">颜色</span>
                    <input
                      type="color"
                      className="h-10 w-full rounded border border-slate-300 bg-white px-1"
                      value={form[DISPLAY_FIELD_CONFIG[selectedDisplayFields[0] ?? "discount"].colorKey]}
                      onChange={(event) => applySelectedTextStyle("color", event.target.value)}
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
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
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

            <div className="grid gap-3 md:grid-cols-3">
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
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="text-sm font-semibold text-slate-900">使用场景</div>
              <div className="mt-1 text-xs leading-5 text-slate-500">
                订单场景用于购物车抵扣；结算二维码/条码会按领取关系生成唯一核销码。
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-3">
                {USAGE_SCENARIO_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className="flex min-h-20 items-start gap-2 rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={form.usageScenarios.includes(option.value)}
                      onChange={(event) => toggleUsageScenario(option.value, event.target.checked)}
                    />
                    <span>
                      <span className="block font-medium text-slate-800">{option.label}</span>
                      <span className="mt-1 block text-xs leading-5 text-slate-500">{option.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="text-sm font-semibold text-slate-900">领取规则</div>
              <div className="mt-1 text-xs leading-5 text-slate-500">
                有效期、身份限制、领取次数、库存和任务要求会控制网站区块“立即领取”的可领取状态。
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-2">
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

              <div className="mt-3 grid gap-3 md:grid-cols-3">
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

              <div className="mt-3 grid gap-3 md:grid-cols-2">
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
                <label className="flex items-start gap-2 rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={form.claimOldUserOnly}
                    onChange={(event) => updateField("claimOldUserOnly", event.target.checked)}
                  />
                  <span>
                    <span className="block font-medium text-slate-800">老用户专享</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">可按注册天数、累计消费、下单次数设置门槛。</span>
                  </span>
                </label>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <label className="space-y-1 text-sm">
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
                <label className="space-y-1 text-sm">
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
                <label className="space-y-1 text-sm">
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

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {[
                  ["指定用户 ID", "claimAllowedAccountIds", "一行一个用户 ID"],
                  ["指定国家", "claimAllowedCountries", "一行一个国家"],
                  ["指定省", "claimAllowedProvinces", "一行一个省"],
                  ["指定市", "claimAllowedCities", "一行一个城市"],
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
              </div>

              <div className="mt-4 border-t border-slate-200 pt-3">
                <div className="text-sm font-semibold text-slate-900">领取次数限制</div>
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

              <div className="mt-4 border-t border-slate-200 pt-3">
                <div className="text-sm font-semibold text-slate-900">领取时间限制</div>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  <label className="space-y-1 text-sm">
                    <span className="block text-slate-600">日期时间段</span>
                    <textarea
                      className="min-h-[68px] w-full resize-y rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                      value={form.claimDateTimeWindows}
                      onChange={handleInputChange("claimDateTimeWindows")}
                      placeholder="2026-06-01 09:00 ~ 2026-06-10 22:00，一行一段"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="block text-slate-600">每日时间段</span>
                    <textarea
                      className="min-h-[68px] w-full resize-y rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
                      value={form.claimDailyTimeWindows}
                      onChange={handleInputChange("claimDailyTimeWindows")}
                      placeholder="09:00 ~ 12:00，一行一段"
                    />
                  </label>
                </div>
              </div>

              <div className="mt-4 border-t border-slate-200 pt-3">
                <div className="text-sm font-semibold text-slate-900">生效时间限制</div>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
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
              </div>

              <div className="mt-4 border-t border-slate-200 pt-3">
                <div className="text-sm font-semibold text-slate-900">库存限制</div>
                <div className="mt-2 grid gap-3 md:grid-cols-4">
                  {[
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
                        value={form[key as "claimMonthlyStockLimit" | "claimWeeklyStockLimit" | "claimDailyStockLimit" | "claimHourlyStockLimit"]}
                        onChange={handleInputChange(key as "claimMonthlyStockLimit" | "claimWeeklyStockLimit" | "claimDailyStockLimit" | "claimHourlyStockLimit")}
                        placeholder="0 不限制"
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div className="mt-4 border-t border-slate-200 pt-3">
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

              <div className="mt-4 border-t border-slate-200 pt-3">
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

              <label className="mt-3 block space-y-1 text-sm">
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
            </div>

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
          </aside>
          </div>
          </section>
        </div>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-base font-semibold text-slate-900">优惠券列表</div>
              <div className="mt-1 text-xs text-slate-500">启用、未过期、且勾选网站展示的优惠券会显示到优惠券区块。</div>
            </div>
            {listOnly ? (
              <button
                type="button"
                className="shrink-0 rounded border bg-white px-3 py-2 text-xs hover:bg-slate-50 disabled:opacity-50"
                onClick={() => void loadCoupons()}
                disabled={loading || !siteId}
              >
                {loading ? "刷新中" : "刷新"}
              </button>
            ) : null}
          </div>
          {listOnly && error ? <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</div> : null}
          {listOnly && tip ? <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{tip}</div> : null}

          <div className="mt-4 grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {loading ? (
              <div className="col-span-full rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">正在加载优惠券...</div>
            ) : displayCoupons.length === 0 ? (
              <div className="col-span-full rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                还没有优惠券。先创建一张，并保持“网站区块展示”开启。
              </div>
            ) : (
              displayCoupons.map((coupon) => {
                const selected = coupon.id === form.id;
                const visualData = buildCouponVisualDataFromRecord(coupon, pricePrefix);
                const totalQuantityLabel = coupon.totalQuantity > 0 ? String(coupon.totalQuantity) : "不限";
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
                      <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 sm:grid-cols-5">
                        <div className="min-w-0">
                          <span className="block text-[11px] text-slate-400">优惠类型</span>
                          <span className="mt-0.5 block truncate font-semibold text-slate-800">
                            {COUPON_DISCOUNT_TYPE_LABELS[coupon.discountType]}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <span className="block text-[11px] text-slate-400">状态</span>
                          <span className={`mt-0.5 inline-flex rounded-full border px-2 py-0.5 font-semibold ${STATUS_CLASS_NAMES[coupon.status]}`}>
                            {STATUS_LABELS[coupon.status]}
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
                      </div>
                  </article>
                );
              })
            )}
          </div>
      </section>
    </div>
  );
}
