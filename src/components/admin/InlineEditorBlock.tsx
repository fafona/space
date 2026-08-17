"use client";

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import NextImage from "next/image";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import {
  type BlockBorderStyle,
  type Block,
  type ButtonHoverAnimation,
  type CommonProps,
  type CouponActionMode,
  type CouponDisplayMode,
  type GoogleReviewDisplayMode,
  type GoogleReviewItem,
  type ImageFillMode,
  type MerchantCardTextLayoutConfig,
  type MerchantCardTextRole,
  type TypographyEditableProps,
} from "@/data/homeBlocks";
import {
  MERCHANT_INDUSTRY_OPTIONS,
  loadPlatformState,
} from "@/data/platformControlStore";
import { resolveCommonCanvasLayout } from "@/lib/commonCanvasLayout";
import { getBackgroundStyle } from "@/components/blocks/backgroundStyle";
import { BLOCK_BORDER_STYLE_OPTIONS, getBlockBorderClass, getBlockBorderInlineStyle } from "@/components/blocks/borderStyle";
import { stripInlineTextColorStylesFromHtml, toInlineHeadingHtmlSegments, toRichHtml } from "@/components/blocks/richText";
import {
  CUSTOM_GALLERY_FRAME_WIDTHS,
  GALLERY_LAYOUT_PRESETS,
  buildCustomGalleryRows,
  createDefaultCustomGalleryLayout,
  frameWidthToSpan,
  getGalleryCardLayout,
  normalizeCustomGalleryLayout,
  normalizeGalleryLayoutPreset,
  type CustomGalleryFrameWidth,
  type CustomGalleryLayout,
  type GalleryCardLayout,
  type GalleryLayoutPreset,
  type GalleryRowAlign,
} from "@/lib/galleryLayout";
import type { EuropeLocationOptionsApi } from "@/lib/europeLocationOptionsLoader";
import {
  createMerchantCatalogRuntimeContextKey,
  isMerchantCatalogRuntimeContextCurrent,
  MERCHANT_CATALOG_CHANGED_EVENT,
  parseMerchantCatalogChangedEventDetail,
  type MerchantCatalogBrowsingRules,
  type MerchantCatalogTarget,
} from "@/lib/merchantCatalog";
import {
  buildMerchantCardPlacement,
  clampMerchantCardLayoutValue,
  getMerchantTabKey,
  getMerchantLayoutCanvasHeight,
  getMerchantLayoutCanvasWidth,
  getMerchantLayoutContainerHeight,
  resolveAdaptiveMerchantListEntries,
  resolveMerchantListLayoutEntries,
  type MerchantCardLayoutConfig,
  type MerchantListLayoutKey,
} from "@/lib/merchantCardLayout";
import {
  normalizeMerchantIndustryTabs,
  toMerchantIndustryTabInputs,
  type MerchantIndustryTabIndustry,
  type MerchantIndustryTab,
} from "@/lib/merchantIndustryTabs";
import {
  arrangeProductItemsByTag,
  groupArrangedProductItemsByTag,
  PRODUCT_CART_BUTTON_POSITION_OPTIONS,
  PRODUCT_CART_QUANTITY_MODE_OPTIONS,
  PRODUCT_CONTAINER_MODE_OPTIONS,
  PRODUCT_CARD_HEIGHT_MAX,
  PRODUCT_CARD_HEIGHT_MIN,
  PRODUCT_IMAGE_SIZE_MAX,
  PRODUCT_IMAGE_SIZE_MIN,
  PRODUCT_LIST_CARD_VERTICAL_PADDING,
  PRODUCT_IMAGE_ASPECT_OPTIONS,
  PRODUCT_LAYOUT_OPTIONS,
  PRODUCT_PRICE_ALIGN_OPTIONS,
  PRODUCT_PRICE_PREFIX_OPTIONS,
  PRODUCT_TAG_BORDER_STYLE_OPTIONS,
  PRODUCT_TAG_POSITION_OPTIONS,
  createProductItemId,
  defaultProductItemsPerPage,
  filterProductItemsByKeyword,
  isMeaningfulProductItem,
  normalizeProductCartQuantityMode,
  normalizeProductCartButtonPosition,
  normalizeProductCardHeight,
  normalizeProductContainerMode,
  normalizeProductImageSize,
  normalizeProductImageAspectRatio,
  normalizeProductItems,
  normalizeProductItemsPerPage,
  normalizeProductLayoutPreset,
  normalizeProductPriceAlign,
  normalizeProductSpacing,
  normalizeProductTagBorderStyle,
  normalizeProductTagOptions,
  normalizeProductTagPosition,
  productListImageEdgeGap,
  productListImageMaxSize,
  productContainerViewportHeight,
  productGridClass,
  productPriceText,
  type ProductCartQuantityMode,
  type ProductCartButtonPosition,
  type ProductContainerMode,
  type ProductImageAspectRatio,
  type ProductItem,
  type ProductLayoutPreset,
  type ProductPriceAlign,
  type ProductTagBorderStyle,
  type ProductTagPosition,
} from "@/lib/productBlock";
import {
  createGoogleReviewItemId,
  normalizeGoogleReviewAverage,
  normalizeGoogleReviewItems,
  normalizeGoogleReviewRating,
  normalizeGoogleReviewTotalCount,
} from "@/lib/googleReviews";
import { normalizePublicAssetUrl } from "@/lib/publicAssetUrl";
import {
  getMerchantCouponDiscountLabel,
  getVisibleMerchantCoupons,
  type MerchantCouponRecord,
} from "@/lib/merchantCoupons";
import {
  BUTTON_BLOCK_MIN_HEIGHT,
  BUTTON_BLOCK_MIN_WIDTH,
  BUTTON_HOVER_ANIMATION_OPTIONS,
  buildButtonLabelPatch,
  getButtonHoverAnimationClassName,
  normalizeButtonHoverAnimation,
  resolveButtonContentPadding,
  resolveButtonLabel,
  type ButtonJumpBlock,
} from "@/lib/buttonBlock";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { useI18n } from "@/components/I18nProvider";
import { localizeSystemDefaultText, resolveLocalizedSystemDefaultText } from "@/lib/editorSystemDefaults";
import { isGradientToken } from "@/lib/editorColors";
import { flushBufferedEditorTextCommits } from "@/lib/editorTextCommitBuffer";
import { useBufferedEditorTextCommit } from "@/components/admin/useBufferedEditorTextCommit";
import { BufferedEditorInput, BufferedEditorTextarea } from "@/components/admin/BufferedEditorControls";

function MoveArrowIcon({ direction }: { direction: "up" | "down" }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
      {direction === "up" ? (
        <path fill="currentColor" d="M10 4.5 4.75 10l1.1 1.05 3.37-3.53V16h1.56V7.52l3.37 3.53L15.25 10 10 4.5Z" />
      ) : (
        <path fill="currentColor" d="M10 15.5 15.25 10l-1.1-1.05-3.37 3.53V4H9.22v8.48L5.85 8.95 4.75 10 10 15.5Z" />
      )}
    </svg>
  );
}

function DeferredAdminPanelLoading({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-500 shadow-sm">
      {label}
    </div>
  );
}

function DeferredEditorPreviewLoading({ label }: { label: string }) {
  return (
    <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white/70 px-4 text-xs text-slate-500">
      {label}
    </div>
  );
}

const loadGoogleBusinessProfileReviewsPanel = () =>
  import("@/components/admin/GoogleBusinessProfileReviewsPanel");

const loadEditorColorControls = () => import("@/components/admin/EditorColorControls");

const loadEditorFormControls = () => import("@/components/admin/EditorFormControls");

const loadEditorBookingBlock = () => import("@/components/blocks/BookingBlock");

const loadEditorCouponBlock = () => import("@/components/blocks/CouponBlock");

const loadEditorGoogleReviewsBlock = () => import("@/components/blocks/GoogleReviewsBlock");

const loadEditorPollBlock = () => import("@/components/blocks/PollBlock");

const loadPollBlockEditor = () => import("@/components/admin/PollBlockEditor");

const BookingTimeSlotRulesEditor = dynamic(() => import("@/components/admin/BookingTimeSlotRulesEditor"), {
  ssr: false,
  loading: () => <DeferredAdminPanelLoading label="时间规则加载中..." />,
});

const BookingDateCalendarEditor = dynamic(() => import("@/components/admin/BookingDateCalendarEditor"), {
  ssr: false,
  loading: () => <DeferredAdminPanelLoading label="日期规则加载中..." />,
});

const GoogleBusinessProfileReviewsPanel = dynamic(loadGoogleBusinessProfileReviewsPanel, {
  ssr: false,
  loading: () => <DeferredAdminPanelLoading label="Google 评论配置加载中..." />,
});

const ColorOrGradientPicker = dynamic(
  () => loadEditorColorControls().then((module) => module.ColorOrGradientPicker),
  {
    ssr: false,
    loading: () => <div className="h-10 w-full animate-pulse rounded border bg-white/70" />,
  },
);

const RecentColorBar = dynamic(
  () => loadEditorColorControls().then((module) => module.RecentColorBar),
  {
    ssr: false,
    loading: () => <div className="h-8 w-full animate-pulse rounded border border-dashed bg-white/70" />,
  },
);

const FontSizeComboInput = dynamic(
  () => loadEditorFormControls().then((module) => module.FontSizeComboInput),
  {
    ssr: false,
    loading: () => <div className="h-10 w-full animate-pulse rounded border bg-white/70" />,
  },
);

const BookingOptionsTextarea = dynamic(
  () => loadEditorFormControls().then((module) => module.BookingOptionsTextarea),
  {
    ssr: false,
    loading: () => <div className="h-24 w-full animate-pulse rounded border bg-white/70" />,
  },
);

const CompositionSafeTextInput = dynamic(
  () => loadEditorFormControls().then((module) => module.CompositionSafeTextInput),
  {
    ssr: false,
    loading: () => <div className="h-10 w-full animate-pulse rounded border bg-white/70" />,
  },
);

const BookingBlock = dynamic(loadEditorBookingBlock, {
  ssr: false,
  loading: () => <DeferredEditorPreviewLoading label="预约区块预览加载中..." />,
});

const CouponBlock = dynamic(loadEditorCouponBlock, {
  ssr: false,
  loading: () => <DeferredEditorPreviewLoading label="优惠券区块预览加载中..." />,
});

const GoogleReviewsBlock = dynamic(loadEditorGoogleReviewsBlock, {
  ssr: false,
  loading: () => <DeferredEditorPreviewLoading label="Google 评论区块预览加载中..." />,
});

const PollBlock = dynamic(loadEditorPollBlock, {
  ssr: false,
  loading: () => <DeferredEditorPreviewLoading label="投票区块预览加载中..." />,
});

const PollBlockEditor = dynamic(loadPollBlockEditor, {
  ssr: false,
  loading: () => <DeferredAdminPanelLoading label="投票配置加载中..." />,
});

const IMAGE_FILL_VALUES: ImageFillMode[] = [
  "cover",
  "contain",
  "fill",
  "repeat",
  "repeat-x",
  "repeat-y",
];

const BACKGROUND_POSITION_OPTIONS = [
  "center",
  "top",
  "bottom",
  "left",
  "right",
  "left top",
  "left center",
  "left bottom",
  "right top",
  "right center",
  "right bottom",
];

const FONT_FAMILY_OPTIONS = [
  "Microsoft YaHei, Segoe UI, SimHei, sans-serif",
  "SimSun, Times New Roman, serif",
  "SimHei, Arial, sans-serif",
  "KaiTi, STKaiti, Georgia, serif",
  "FangSong, STFangsong, Georgia, serif",
  "YouYuan, Trebuchet MS, sans-serif",
  "STXingkai, Brush Script MT, KaiTi, cursive, serif",
  "STCaiyun, Papyrus, SimHei, fantasy, sans-serif",
  "Arial, Helvetica, sans-serif",
  "Times New Roman, Times, serif",
  "Georgia, serif",
  "Trebuchet MS, sans-serif",
  "Verdana, Geneva, sans-serif",
  "Impact, Haettenschweiler, sans-serif",
  "Comic Sans MS, cursive, sans-serif",
  "Brush Script MT, cursive",
  "Lucida Handwriting, cursive",
  "Papyrus, fantasy",
  "Copperplate, Papyrus, fantasy",
  "monospace",
];

function normalizeFontFamilyOptionKey(value: string) {
  return value
    .replaceAll('"', "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .join(",");
}

function resolveFontFamilyOptionValue(value: string) {
  const cleaned = value.replaceAll('"', "").trim();
  if (!cleaned) return "";
  const normalized = normalizeFontFamilyOptionKey(cleaned);
  const exactMatch = FONT_FAMILY_OPTIONS.find((option) => normalizeFontFamilyOptionKey(option) === normalized);
  if (exactMatch) return exactMatch;
  const candidateFamilies = normalized.split(",").filter(Boolean);
  for (const family of candidateFamilies) {
    const matchedOption = FONT_FAMILY_OPTIONS.find((option) => {
      const optionFamilies = normalizeFontFamilyOptionKey(option).split(",").filter(Boolean);
      return optionFamilies[0] === family;
    });
    if (matchedOption) return matchedOption;
  }
  return cleaned;
}

const MAX_TYPOGRAPHY_FONT_SIZE = 80;

const FONT_SIZE_OPTIONS = [12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72, 80];

const INLINE_TYPOGRAPHY_STYLE_PROPERTIES = [
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-decoration",
  "color",
  "background-image",
  "background-clip",
  "-webkit-background-clip",
  "-webkit-text-fill-color",
  "text-fill-color",
] as const;

function clampTypographyFontSizeInput(value: unknown) {
  const numericValue =
    typeof value === "string" ? Number.parseInt(value.replace(/[^\d]/g, ""), 10) : Number(value);
  if (!Number.isFinite(numericValue)) return 16;
  return Math.max(8, Math.min(MAX_TYPOGRAPHY_FONT_SIZE, Math.round(numericValue)));
}

function normalizeTypographyFontSizeInputValue(value: unknown) {
  if (value === "") return "";
  const numericValue =
    typeof value === "string" ? Number.parseInt(value.replace(/[^\d]/g, ""), 10) : Number(value);
  if (!Number.isFinite(numericValue)) return "";
  return String(Math.round(numericValue));
}

function clampTypographyFontSizeInputToString(value: unknown) {
  return String(clampTypographyFontSizeInput(value));
}

function clampMerchantCardTypographyFontSizeInput(value: unknown) {
  const numericValue =
    typeof value === "string" ? Number.parseInt(value.replace(/[^\d]/g, ""), 10) : Number(value);
  if (!Number.isFinite(numericValue)) return 16;
  return Math.max(8, Math.min(120, Math.round(numericValue)));
}

function normalizeMerchantCardTypographyFontSizeInputValue(value: unknown) {
  if (value === "") return "";
  const numericValue =
    typeof value === "string" ? Number.parseInt(value.replace(/[^\d]/g, ""), 10) : Number(value);
  if (!Number.isFinite(numericValue)) return "";
  return String(Math.round(numericValue));
}

function clampMerchantCardTypographyFontSizeInputToString(value: unknown) {
  return String(clampMerchantCardTypographyFontSizeInput(value));
}

const GOOGLE_REVIEW_DISPLAY_MODE_OPTIONS: Array<{ value: GoogleReviewDisplayMode; label: string }> = [
  { value: "cards", label: "卡片" },
  { value: "list", label: "列表" },
  { value: "compact", label: "紧凑" },
];

const MIN_BLOCK_WIDTH = 240;

const MIN_BLOCK_HEIGHT = 120;

const MAX_ORIGINAL_IMAGE_DATA_URL_LENGTH = 6_000_000;

const PRODUCT_EXCEL_IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;

type EditorImageUploadPurpose = "common" | "gallery" | "page-background";

type PersistedEditorAssetResult = {
  value: string;
  thumbnailUrl?: string;
  externalized: boolean;
};

const GALLERY_FRAME_WIDTH_LABELS: Record<CustomGalleryFrameWidth, string> = {
  "1": "1",
  "1/2": "1/2",
  "1/3": "1/3",
  "2/3": "2/3",
};

type ViewportKey = "desktop" | "mobile";

type ProductSettingsSectionKey = "basic" | "behavior" | "typography" | "tags" | "card" | "detail" | "products";

type ProductTypographyRole = "code" | "name" | "description" | "price";

function readProductOperatingBrowsingRules(
  value: unknown,
): Partial<MerchantCatalogBrowsingRules> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const rules: Partial<MerchantCatalogBrowsingRules> = {};
  if (typeof record.searchEnabled === "boolean") rules.searchEnabled = record.searchEnabled;
  if (typeof record.searchPlaceholder === "string") {
    rules.searchPlaceholder = record.searchPlaceholder;
  }
  if (typeof record.hideUnselectedCategory === "boolean") {
    rules.hideUnselectedCategory = record.hideUnselectedCategory;
  }
  if (typeof record.groupByCategory === "boolean") {
    rules.groupByCategory = record.groupByCategory;
  }
  return rules;
}

function getPreviewColSpan(itemClass: string) {
  const match = itemClass.match(/col-span-(\d+)/);
  const value = Number(match?.[1] ?? 4);
  if (!Number.isFinite(value)) return 4;
  return Math.max(1, Math.min(12, value));
}

function getPreviewBlockHeight(layout: GalleryCardLayout, minHeight: number, maxHeight: number) {
  if (layout.frameStyle.aspectRatio) return undefined;
  const height = typeof layout.frameStyle.height === "number" ? layout.frameStyle.height : minHeight;
  if (maxHeight <= minHeight) return 12;
  const ratio = (height - minHeight) / (maxHeight - minHeight);
  return Math.round(10 + ratio * 8);
}

function getCustomPreviewBlankSpans(row: { align: GalleryRowAlign; items: Array<{ span: number }> }) {
  const used = row.items.reduce((sum, item) => sum + Math.max(0, Math.min(12, Math.round(item.span))), 0);
  const remain = Math.max(0, 12 - used);
  if (row.align === "right") return { leading: remain, trailing: 0 };
  if (row.align === "center") {
    const leading = Math.floor(remain / 2);
    return { leading, trailing: remain - leading };
  }
  return { leading: 0, trailing: remain };
}

function getGalleryLayoutLabel(preset: GalleryLayoutPreset) {
  if (preset === "three-wide") return "三列";
  if (preset === "two-wide") return "双列";
  if (preset === "single-wide") return "通栏";
  if (preset === "three-square") return "三列等宽";
  if (preset === "mosaic") return "拼接";
  return "自定义样式";
}

function isCommonCanvasBlockType(type: Block["type"]): type is "common" {
  return type === "common";
}

function getBlockMinWidth(type: Block["type"]) {
  return type === "button" ? BUTTON_BLOCK_MIN_WIDTH : MIN_BLOCK_WIDTH;
}

function getBlockMinHeight(type: Block["type"]) {
  return type === "button" ? BUTTON_BLOCK_MIN_HEIGHT : MIN_BLOCK_HEIGHT;
}

function normalizeBlockWidth(value?: number, type: Block["type"] = "common") {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(getBlockMinWidth(type), Math.round(value));
}

function normalizeBlockHeight(value?: number, type: Block["type"] = "common") {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(getBlockMinHeight(type), Math.round(value));
}

function toDateInputValue(value?: string) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function fromDateInputValue(value: string) {
  const text = value.trim();
  return text ? `${text}T00:00:00.000Z` : "";
}

function clampGoogleReviewMaxItemsInput(value: unknown) {
  const numericValue = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(numericValue)) return 6;
  return Math.max(1, Math.min(12, Math.round(numericValue)));
}

function createEditorGoogleReviewItem(index: number): GoogleReviewItem {
  return {
    id: createGoogleReviewItemId(),
    reviewerName: `客户${index + 1}`,
    rating: 5,
    comment: "",
    createTime: new Date().toISOString(),
  };
}

function toPlainText(value: string | undefined, fallback = "") {
  const source = (value ?? "").trim();
  if (!source) return fallback;
  const noTags = source
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  return noTags.trim() || fallback;
}

function hasVisibleRichText(value?: string) {
  const raw = String(value ?? "");
  if (!raw.trim()) return false;
  const stripped = raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .trim();
  return stripped.length > 0;
}

function toRgba(hex: string, alpha: number) {
  const value = /^#([0-9a-fA-F]{6})$/.test(hex) ? hex : "#ffffff";
  const r = Number.parseInt(value.slice(1, 3), 16);
  const g = Number.parseInt(value.slice(3, 5), 16);
  const b = Number.parseInt(value.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

function normalizeNavBorderColor(value: string, fallback: string) {
  const trimmed = value.trim();
  if (/^#([0-9a-fA-F]{6})$/.test(trimmed)) return trimmed;
  const firstHex = trimmed.match(/#([0-9a-fA-F]{6})/);
  if (firstHex) return `#${firstHex[1]}`;
  return fallback;
}

function gradientWithOpacity(value: string, opacity: number) {
  const alpha = Math.max(0, Math.min(1, opacity));
  let next = value.replace(/#([0-9a-fA-F]{6})/g, (match, hex: string) => {
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return match;
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
  });
  next = next.replace(/rgba?\(([^)]+)\)/gi, (match, content: string) => {
    const parts = content.split(",").map((item) => item.trim());
    const r = Number(parts[0]);
    const g = Number(parts[1]);
    const b = Number(parts[2]);
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return match;
    return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha.toFixed(3)})`;
  });
  return next;
}

function getColorLayerStyle(value: string, opacity: number) {
  const trimmed = value.trim();
  if (isGradientToken(trimmed)) {
    return {
      backgroundImage: opacity < 1 ? gradientWithOpacity(trimmed, opacity) : trimmed,
    };
  }
  return {
    backgroundColor: toRgba(trimmed, opacity),
  };
}

function getProductStyleFirstHexColor(value: string, fallback: string) {
  const trimmed = value.trim();
  if (/^#([0-9a-fA-F]{6})$/.test(trimmed)) return trimmed;
  const firstHex = trimmed.match(/#([0-9a-fA-F]{6})/);
  return firstHex ? `#${firstHex[1]}` : fallback;
}

function getProductStyleBorderColor(value: string, opacity = 0.5) {
  return toRgba(getProductStyleFirstHexColor(value, "#ffffff"), opacity);
}

function getProductStyleReadableTextColor(value: string) {
  const trimmed = value.trim();
  if (!/^#([0-9a-fA-F]{6})$/.test(trimmed)) return "#ffffff";
  const r = Number.parseInt(trimmed.slice(1, 3), 16);
  const g = Number.parseInt(trimmed.slice(3, 5), 16);
  const b = Number.parseInt(trimmed.slice(5, 7), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.68 ? "#0f172a" : "#ffffff";
}

function getProductStyleTagTextColor(borderStyle: ProductTagBorderStyle, value: string) {
  if (borderStyle === "none" || borderStyle === "divider") {
    return getProductStyleFirstHexColor(value, "#0f172a");
  }
  return getProductStyleReadableTextColor(value);
}

function getProductStyleTagJustifyContent(align: ProductPriceAlign) {
  if (align === "center") return "center";
  if (align === "right") return "flex-end";
  return "flex-start";
}

function buildProductTagButtonStyle(options: {
  borderStyle: ProductTagBorderStyle;
  active: boolean;
  bgColor: string;
  bgOpacity: number;
  activeBgColor: string;
  activeBgOpacity: number;
  fontSize: number;
  textAlign: ProductPriceAlign;
  width: number;
}): CSSProperties {
  const color = options.active ? options.activeBgColor : options.bgColor;
  const opacity = options.active ? options.activeBgOpacity : options.bgOpacity;
  const base: CSSProperties = {
    width: `${options.width}px`,
    color: getProductStyleTagTextColor(options.borderStyle, color),
    fontSize: `${options.fontSize}px`,
    justifyContent: getProductStyleTagJustifyContent(options.textAlign),
    textAlign: options.textAlign,
  };

  if (options.borderStyle === "none") {
    return {
      ...base,
      backgroundColor: "transparent",
      backgroundImage: "none",
      border: "1px solid transparent",
      boxShadow: "none",
    };
  }

  if (options.borderStyle === "divider") {
    return {
      ...base,
      backgroundColor: "transparent",
      backgroundImage: "none",
      border: "0",
      borderRadius: 0,
      boxShadow: "none",
      paddingLeft: "0.5rem",
      paddingRight: "0.5rem",
    };
  }

  const borderStyle = options.borderStyle === "dashed" ? "dashed" : options.borderStyle === "double" ? "double" : "solid";
  return {
    ...base,
    ...getColorLayerStyle(color, opacity),
    border: `${options.borderStyle === "double" ? 3 : 1}px ${borderStyle} ${
      options.borderStyle === "glass" ? "rgba(255,255,255,0.36)" : getProductStyleBorderColor(color, options.active ? 0.72 : 0.5)
    }`,
    borderRadius: options.borderStyle === "rectangle" ? "6px" : "9999px",
    backdropFilter: options.borderStyle === "glass" ? "blur(12px)" : undefined,
  };
}

function buildProductTagDividerStyle(
  borderStyle: ProductTagBorderStyle,
  color: string,
  position: ProductTagPosition,
  index: number,
  total: number,
): CSSProperties {
  if (borderStyle !== "divider" || index >= total - 1) return {};
  const borderColor = getProductStyleBorderColor(color, 0.44);
  if (position === "top") {
    return {
      borderRight: `1px solid ${borderColor}`,
      marginRight: "2px",
      paddingRight: "12px",
    };
  }
  return {
    borderBottom: `1px solid ${borderColor}`,
    marginBottom: "2px",
    paddingBottom: "8px",
  };
}

type MerchantCardIndustryStyleConfig = {
  bgColor?: string;
  bgOpacity?: number;
  borderStyle?: BlockBorderStyle;
  borderColor?: string;
};

const DEFAULT_MERCHANT_CARD_TEXT_LAYOUT: Record<MerchantCardTextRole, { x: number; y: number }> = {
  name: { x: 0, y: 0 },
  industry: { x: 0, y: 30 },
  domain: { x: 0, y: 52 },
};

function resolveMerchantCardTextPosition(layout: MerchantCardTextLayoutConfig | undefined, role: MerchantCardTextRole) {
  const fallback = DEFAULT_MERCHANT_CARD_TEXT_LAYOUT[role];
  const current = layout?.[role] ?? {};
  const x = typeof current.x === "number" && Number.isFinite(current.x) ? Math.max(0, Math.round(current.x)) : fallback.x;
  const y = typeof current.y === "number" && Number.isFinite(current.y) ? Math.max(0, Math.round(current.y)) : fallback.y;
  return { x, y };
}

function normalizeMerchantCardTextLayoutConfig(layout: MerchantCardTextLayoutConfig | undefined): MerchantCardTextLayoutConfig {
  return {
    name: resolveMerchantCardTextPosition(layout, "name"),
    industry: resolveMerchantCardTextPosition(layout, "industry"),
    domain: resolveMerchantCardTextPosition(layout, "domain"),
  };
}

function resolveMerchantIndustryCardStyle(
  stylesByIndustry: Partial<Record<MerchantIndustryTabIndustry, MerchantCardIndustryStyleConfig>> | undefined,
  targetIndustry: MerchantIndustryTabIndustry,
  legacy: {
    bgColor: string;
    bgOpacity: number;
    borderStyle: BlockBorderStyle;
    borderColor: string;
  },
) {
  const scoped = stylesByIndustry?.[targetIndustry];
  const fallback = stylesByIndustry?.all;
  const candidate = scoped ?? fallback;
  if (!candidate) return legacy;
  return {
    bgColor: (candidate.bgColor ?? "").trim() || legacy.bgColor,
    bgOpacity:
      typeof candidate.bgOpacity === "number" && Number.isFinite(candidate.bgOpacity)
        ? Math.max(0, Math.min(1, candidate.bgOpacity))
        : legacy.bgOpacity,
    borderStyle: (candidate.borderStyle ?? legacy.borderStyle) as BlockBorderStyle,
    borderColor: (candidate.borderColor ?? "").trim() || legacy.borderColor,
  };
}

function buildTypographyInlineStyle(style: TypographyEditableProps | undefined): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  const fontFamily = (style?.fontFamily ?? "").trim();
  const fontColor = (style?.fontColor ?? "").trim();
  if (fontFamily) result.fontFamily = fontFamily;
  if (typeof style?.fontSize === "number" && Number.isFinite(style.fontSize) && style.fontSize > 0) {
    result.fontSize = Math.max(8, Math.min(120, style.fontSize));
  }
  if (style?.fontWeight) result.fontWeight = style.fontWeight;
  if (style?.fontStyle) result.fontStyle = style.fontStyle;
  if (style?.textDecoration) result.textDecoration = style.textDecoration;
  if (fontColor) {
    if (isGradientToken(fontColor)) {
      result.backgroundImage = fontColor;
      result.backgroundClip = "text";
      result.WebkitBackgroundClip = "text";
      result.color = "transparent";
    } else {
      result.color = fontColor;
    }
  }
  return result;
}

function isInlineDataImageUrl(value: string) {
  return /^data:image\//i.test(value);
}

function ensureSafeImageUrlSize(value: string | undefined) {
  if (!value) return value;
  if (isInlineDataImageUrl(value) && value.length > MAX_ORIGINAL_IMAGE_DATA_URL_LENGTH) {
    throw new Error("图片数据过大，上传较小图片或使用URL");
  }
  return value;
}


function InlineEditorBlock({
  block,
  publicBlockId,
  draggingBlockId,
  isSelected,
  onDragHandleMouseDown,
  onNudge,
  onLayerToFront,
  onLayerUp,
  onLayerDown,
  onLayerToBack,
  onSelect,
  onChange,
  onResizePreview,
  onResizeCommit,
  previewOffsetY,
  onDelete,
  onAlert,
  availablePages,
  availableBlocks,
  currentPageId,
  maxNavItems = 12,
  recentColors,
  onRecordColor,
  onClearRecentColors,
  onApplyNavSettingsToOtherPages,
  onPersistImageFile,
  onPersistProductImageFile,
  onPersistAudioFile,
  previewViewport,
  runtimeSiteId = "",
  runtimeSiteName = "",
  merchantCouponRecords = [],
  onOpenMerchantCoupons,
  onOpenOrderCatalog,
  europeLocationOptionsApi,
  onGoogleBusinessProfileRequest,
}: {
  block: Block;
  publicBlockId: string;
  draggingBlockId: string | null;
  isSelected: boolean;
  onDragHandleMouseDown: (point: { x: number; y: number }) => void;
  onNudge: (deltaX: number, deltaY: number) => void;
  onLayerToFront: () => void;
  onLayerUp: () => void;
  onLayerDown: () => void;
  onLayerToBack: () => void;
  onSelect: () => void;
  onChange: (patch: Partial<Block["props"]>) => void;
  onResizePreview: (heightDelta: number) => void;
  onResizeCommit: (patch: Partial<Block["props"]>, heightDelta: number) => void;
  previewOffsetY: number;
  onDelete: () => void;
  onAlert: (message: string) => void;
  availablePages: Array<{ id: string; name: string }>;
  availableBlocks: ButtonJumpBlock[];
  currentPageId: string;
  maxNavItems?: number;
  recentColors: string[];
  onRecordColor: (color: string) => void;
  onClearRecentColors: () => void;
  onApplyNavSettingsToOtherPages: (blockId: string) => void;
  onPersistImageFile: (
    file: File,
    options?: { purpose?: EditorImageUploadPurpose; viewport?: ViewportKey },
  ) => Promise<PersistedEditorAssetResult>;
  onPersistProductImageFile: (file: File) => Promise<PersistedEditorAssetResult>;
  onPersistAudioFile: (file: File) => Promise<PersistedEditorAssetResult>;
  previewViewport: "desktop" | "mobile";
  runtimeSiteId?: string;
  runtimeSiteName?: string;
  merchantCouponRecords?: MerchantCouponRecord[];
  onOpenMerchantCoupons?: () => void;
  onOpenOrderCatalog?: (target: MerchantCatalogTarget) => void;
  europeLocationOptionsApi?: EuropeLocationOptionsApi | null;
  onGoogleBusinessProfileRequest?: (path: string, init: RequestInit) => Promise<Response>;
}) {
  const { locale } = useI18n();
  type CommonEditorTextBox = {
    id: string;
    html: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotateDeg: number;
  };
type GalleryEditorImage = {
    id: string;
    url: string;
    featured: boolean;
    fitToFrame: boolean;
    offsetX: number;
    offsetY: number;
    scaleX: number;
    scaleY: number;
  };
  type ProductEditorItem = ProductItem;
  type NavEditorItem = {
    id: string;
    label: string;
    pageId: string;
  };

  const imageInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const productExcelInputRef = useRef<HTMLInputElement>(null);
  const productImageBatchInputRef = useRef<HTMLInputElement>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);
  const commonCanvasRef = useRef<HTMLDivElement | null>(null);
  const commonBoxDragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    boxStartX: number;
    boxStartY: number;
  } | null>(null);
  const commonBoxResizeRef = useRef<{
    id: string;
    mode: "left" | "right" | "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
    startX: number;
    startY: number;
    boxStartX: number;
    boxStartY: number;
    boxStartWidth: number;
    boxStartHeight: number;
  } | null>(null);
  const commonBoxRotateRef = useRef<{
    id: string;
    centerX: number;
    centerY: number;
    startMouseAngle: number;
    startRotateDeg: number;
  } | null>(null);
  const activeEditorRef = useRef<HTMLDivElement | null>(null);
  const selectedRangeRef = useRef<Range | null>(null);
  const getRichFieldPatchRef = useRef(getRichFieldPatch);
  const updateNavItemRef = useRef(updateNavItem);
  const updateCommonTextBoxRef = useRef(updateCommonTextBox);
  const persistEditorTypographyChangeRef = useRef<(editor: HTMLDivElement, options?: { includeBlockLevelPatch?: boolean }) => void>(() => {});
  const typographyEditorSnapshotRef = useRef<{
    html: string;
    range: SerializedEditorRange | null;
  } | null>(null);
  const typographyDialogInitialValuesRef = useRef<TypographyDialogValues | null>(null);
  const typographyPreviewAppliedRef = useRef(false);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [imageUrlInput, setImageUrlInput] = useState("");
  const [imageUploading, setImageUploading] = useState(false);
  const [galleryUploading, setGalleryUploading] = useState(false);
  const [productImageUploading, setProductImageUploading] = useState(false);
  const [typographyDialogOpen, setTypographyDialogOpen] = useState(false);
  const [typoFontFamily, setTypoFontFamily] = useState("");
  const [typoFontSize, setTypoFontSize] = useState("16");
  const [typoFontColor, setTypoFontColor] = useState("#111111");
  const [typoBold, setTypoBold] = useState(false);
  const [typoItalic, setTypoItalic] = useState(false);
  const [typoUnderline, setTypoUnderline] = useState(false);
  const [, setTypoRememberLast] = useState(false);
  const [typographyTarget, setTypographyTarget] = useState<"editor" | "button-controls" | "search-controls" | "merchant-controls">("editor");
  const [imageSettingsOpen, setImageSettingsOpen] = useState(false);
  const [borderSettingsOpen, setBorderSettingsOpen] = useState(false);
  const [layerSettingsOpen, setLayerSettingsOpen] = useState(false);
  const [borderColorInput, setBorderColorInput] = useState("#6b7280");
  const [navItemStyleDialogOpen, setNavItemStyleDialogOpen] = useState(false);
  const [navItemBgColorInput, setNavItemBgColorInput] = useState("#ffffff");
  const [navItemBgOpacityInput, setNavItemBgOpacityInput] = useState(1);
  const [navItemBorderStyleInput, setNavItemBorderStyleInput] = useState<BlockBorderStyle>("solid");
  const [navItemBorderColorInput, setNavItemBorderColorInput] = useState("#6b7280");
  const [mobileNavButtonBgColorInput, setMobileNavButtonBgColorInput] = useState("#ffffff");
  const [mobileNavButtonBgOpacityInput, setMobileNavButtonBgOpacityInput] = useState(0.8);
  const [mobileNavButtonBorderStyleInput, setMobileNavButtonBorderStyleInput] = useState<BlockBorderStyle>("solid");
  const [mobileNavButtonLineColorInput, setMobileNavButtonLineColorInput] = useState("#334155");
  const [navItemActiveBgColorInput, setNavItemActiveBgColorInput] = useState("#e5e7eb");
  const [navItemActiveBgOpacityInput, setNavItemActiveBgOpacityInput] = useState(1);
  const [navItemActiveBorderStyleInput, setNavItemActiveBorderStyleInput] = useState<BlockBorderStyle>("solid");
  const [navItemActiveBorderColorInput, setNavItemActiveBorderColorInput] = useState("#111827");
  const [navItemActiveTextColorInput, setNavItemActiveTextColorInput] = useState("#111827");
  const [searchButtonStyleDialogOpen, setSearchButtonStyleDialogOpen] = useState(false);
  const [searchButtonBgColorInput, setSearchButtonBgColorInput] = useState("#ffffff");
  const [searchButtonBgOpacityInput, setSearchButtonBgOpacityInput] = useState(1);
  const [searchButtonBorderStyleInput, setSearchButtonBorderStyleInput] = useState<BlockBorderStyle>("solid");
  const [searchButtonBorderColorInput, setSearchButtonBorderColorInput] = useState("#6b7280");
  const [searchButtonActiveBgColorInput, setSearchButtonActiveBgColorInput] = useState("#000000");
  const [searchButtonActiveBgOpacityInput, setSearchButtonActiveBgOpacityInput] = useState(1);
  const [searchButtonActiveBorderStyleInput, setSearchButtonActiveBorderStyleInput] = useState<BlockBorderStyle>("solid");
  const [searchButtonActiveBorderColorInput, setSearchButtonActiveBorderColorInput] = useState("#111827");
  const [merchantButtonStyleDialogOpen, setMerchantButtonStyleDialogOpen] = useState(false);
  const [merchantTabButtonBgColorInput, setMerchantTabButtonBgColorInput] = useState("#ffffff");
  const [merchantTabButtonBgOpacityInput, setMerchantTabButtonBgOpacityInput] = useState(1);
  const [merchantTabButtonBorderStyleInput, setMerchantTabButtonBorderStyleInput] = useState<BlockBorderStyle>("solid");
  const [merchantTabButtonBorderColorInput, setMerchantTabButtonBorderColorInput] = useState("#cbd5e1");
  const [merchantTabButtonActiveBgColorInput, setMerchantTabButtonActiveBgColorInput] = useState("#000000");
  const [merchantTabButtonActiveBgOpacityInput, setMerchantTabButtonActiveBgOpacityInput] = useState(1);
  const [merchantTabButtonActiveBorderStyleInput, setMerchantTabButtonActiveBorderStyleInput] = useState<BlockBorderStyle>("solid");
  const [merchantTabButtonActiveBorderColorInput, setMerchantTabButtonActiveBorderColorInput] = useState("#111827");
  const [merchantPagerButtonBgColorInput, setMerchantPagerButtonBgColorInput] = useState("#ffffff");
  const [merchantPagerButtonBgOpacityInput, setMerchantPagerButtonBgOpacityInput] = useState(1);
  const [merchantPagerButtonBorderStyleInput, setMerchantPagerButtonBorderStyleInput] = useState<BlockBorderStyle>("solid");
  const [merchantPagerButtonBorderColorInput, setMerchantPagerButtonBorderColorInput] = useState("#cbd5e1");
  const [merchantPagerButtonDisabledBgColorInput, setMerchantPagerButtonDisabledBgColorInput] = useState("#e5e7eb");
  const [merchantPagerButtonDisabledBgOpacityInput, setMerchantPagerButtonDisabledBgOpacityInput] = useState(1);
  const [merchantPagerButtonDisabledBorderStyleInput, setMerchantPagerButtonDisabledBorderStyleInput] = useState<BlockBorderStyle>("solid");
  const [merchantPagerButtonDisabledBorderColorInput, setMerchantPagerButtonDisabledBorderColorInput] = useState("#cbd5e1");
  const [merchantCardStyleDialogOpen, setMerchantCardStyleDialogOpen] = useState(false);
  const [merchantCardStyleIndustryTarget, setMerchantCardStyleIndustryTarget] = useState<MerchantIndustryTabIndustry>("all");
  const [merchantCardBgColorInput, setMerchantCardBgColorInput] = useState("#f8fafc");
  const [merchantCardBgOpacityInput, setMerchantCardBgOpacityInput] = useState(1);
  const [merchantCardBorderStyleInput, setMerchantCardBorderStyleInput] = useState<BlockBorderStyle>("solid");
  const [merchantCardBorderColorInput, setMerchantCardBorderColorInput] = useState("#cbd5e1");
  const [merchantCardTypographyDialogOpen, setMerchantCardTypographyDialogOpen] = useState(false);
  const [merchantCardTypographyTarget, setMerchantCardTypographyTarget] = useState<MerchantCardTextRole>("name");
  const [merchantCardTypoFontFamilyInput, setMerchantCardTypoFontFamilyInput] = useState("");
  const [merchantCardTypoFontSizeInput, setMerchantCardTypoFontSizeInput] = useState("16");
  const [merchantCardTypoFontColorInput, setMerchantCardTypoFontColorInput] = useState("#111111");
  const [merchantCardTypoBoldInput, setMerchantCardTypoBoldInput] = useState(false);
  const [merchantCardTypoItalicInput, setMerchantCardTypoItalicInput] = useState(false);
  const [merchantCardTypoUnderlineInput, setMerchantCardTypoUnderlineInput] = useState(false);
  const [merchantCardTypoTextBoxVisibleInput, setMerchantCardTypoTextBoxVisibleInput] = useState(false);
  const [merchantCardTypoLayoutDraft, setMerchantCardTypoLayoutDraft] = useState<MerchantCardTextLayoutConfig>(
    normalizeMerchantCardTextLayoutConfig(undefined),
  );
  const merchantCardTypographyPreviewRef = useRef<HTMLDivElement | null>(null);
  const merchantCardTypographyDragRef = useRef<{
    role: MerchantCardTextRole;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const [settingsFillMode, setSettingsFillMode] = useState<ImageFillMode>("cover");
  const [settingsPosition, setSettingsPosition] = useState("center");
  const [settingsColor, setSettingsColor] = useState("");
  const [settingsImageOpacity, setSettingsImageOpacity] = useState(1);
  const [settingsColorOpacity, setSettingsColorOpacity] = useState(1);
  const resizeTargetRef = useRef<HTMLDivElement | null>(null);
  const [draftResize, setDraftResize] = useState<{ width?: number; height?: number; offsetX?: number; offsetY?: number } | null>(null);
  const [commonInsertMode, setCommonInsertMode] = useState(false);
  const [activeCommonTextBoxId, setActiveCommonTextBoxId] = useState<string | null>(null);
  const [buttonJumpDialogOpen, setButtonJumpDialogOpen] = useState(false);
  const [buttonAnimationDialogOpen, setButtonAnimationDialogOpen] = useState(false);
  const [buttonJumpTargetInput, setButtonJumpTargetInput] = useState("");
  const [galleryEditorOpen, setGalleryEditorOpen] = useState(false);
  const [previewNavPageId, setPreviewNavPageId] = useState(currentPageId);
  const [previewNavMobileMenuOpen, setPreviewNavMobileMenuOpen] = useState(false);
  const [previewNavMobileMenuPosition, setPreviewNavMobileMenuPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const previewNavButtonRef = useRef<HTMLButtonElement | null>(null);
  const previewNavMobileDisplayMode = block.type === "nav" ? block.props.mobileNavDisplayMode : undefined;
  const [layoutPanelOpen, setLayoutPanelOpen] = useState(false);
  const [customLayoutDialogOpen, setCustomLayoutDialogOpen] = useState(false);
  const [customLayoutDraft, setCustomLayoutDraft] = useState<CustomGalleryLayout>(createDefaultCustomGalleryLayout());
  const [selectedCustomRowIndex, setSelectedCustomRowIndex] = useState(0);
  const [activeGalleryImageId, setActiveGalleryImageId] = useState<string | null>(null);
  useEffect(() => {
    setPreviewNavMobileMenuOpen(false);
  }, [block.id, currentPageId, previewViewport]);
  useEffect(() => {
    if (!(previewViewport === "mobile" && block.type === "nav" && previewNavMobileDisplayMode === "hidden" && previewNavMobileMenuOpen)) return;
    if (typeof window === "undefined") return;
    const updatePopupPosition = () => {
      const rect = previewNavButtonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(256, Math.max(180, window.innerWidth - 32));
      const left = Math.min(Math.max(16, rect.left), Math.max(16, window.innerWidth - width - 16));
      const top = Math.max(16, rect.bottom + 10);
      setPreviewNavMobileMenuPosition({ top, left, width });
    };
    updatePopupPosition();
    window.addEventListener("resize", updatePopupPosition);
    window.addEventListener("scroll", updatePopupPosition, true);
    return () => {
      window.removeEventListener("resize", updatePopupPosition);
      window.removeEventListener("scroll", updatePopupPosition, true);
    };
  }, [block.type, previewNavMobileDisplayMode, previewNavMobileMenuOpen, previewViewport]);
  useEffect(() => {
    if (!(previewViewport === "mobile" && block.type === "nav" && previewNavMobileDisplayMode === "hidden" && previewNavMobileMenuOpen)) return;
    if (typeof window === "undefined") return;
    const closeMenu = (event: PointerEvent) => {
      const target = event.target as Node | null;
      const button = previewNavButtonRef.current;
      if (button?.contains(target)) return;
      const popup = document.querySelector("[data-mobile-nav-popup='preview']");
      if (popup instanceof HTMLElement && popup.contains(target)) return;
      setPreviewNavMobileMenuOpen(false);
    };
    window.addEventListener("pointerdown", closeMenu, true);
    return () => window.removeEventListener("pointerdown", closeMenu, true);
  }, [block.type, previewNavMobileDisplayMode, previewNavMobileMenuOpen, previewViewport]);
  const [activeContactEntryKeys, setActiveContactEntryKeys] = useState<
    Array<
      | "phone"
      | "address"
      | "map"
      | "email"
      | "whatsapp"
      | "wechat"
      | "twitter"
      | "weibo"
      | "telegram"
      | "linkedin"
      | "discord"
      | "tiktok"
      | "xiaohongshu"
      | "facebook"
      | "instagram"
    >
  >([]);
  const [contactSnapEnabled, setContactSnapEnabled] = useState(true);
  const [contactSnapStep, setContactSnapStep] = useState(8);
  const contactCanvasFocusRef = useRef<HTMLDivElement | null>(null);
  const [activeSearchLayoutKeys, setActiveSearchLayoutKeys] = useState<
    Array<"locate" | "country" | "province" | "city" | "keyword" | "action">
  >([]);
  const [activeMerchantIndustryTabId, setActiveMerchantIndustryTabId] = useState("tab-recommended");
  const [merchantPreviewPageIndex, setMerchantPreviewPageIndex] = useState(0);
  const [productPreviewPageByBlockId, setProductPreviewPageByBlockId] = useState<Record<string, number>>({});
  const [productPreviewTagByBlockId, setProductPreviewTagByBlockId] = useState<Record<string, string | null>>({});
  const [productPreviewSearchByBlockId, setProductPreviewSearchByBlockId] = useState<Record<string, string>>({});
  const [productTagOptionsDraftByBlockId, setProductTagOptionsDraftByBlockId] = useState<Record<string, string>>({});
  const productOperatingCatalogContextKey = block.type === "product"
    ? createMerchantCatalogRuntimeContextKey(runtimeSiteId, block.id, previewViewport)
    : "";
  const [resolvedProductOperatingCatalogState, setProductOperatingCatalogState] = useState<"loading" | "active" | "legacy" | "blocked">("loading");
  const [resolvedProductOperatingCatalogContextKey, setResolvedProductOperatingCatalogContextKey] = useState("");
  const [resolvedProductOperatingCatalog, setProductOperatingCatalog] = useState<{
    pricePrefix: string;
    products: ProductEditorItem[];
    categoryNames: string[];
    browsingRules: Partial<MerchantCatalogBrowsingRules> | null;
  } | null>(null);
  const productOperatingCatalogContextMatches = isMerchantCatalogRuntimeContextCurrent(
    resolvedProductOperatingCatalogContextKey,
    productOperatingCatalogContextKey,
  );
  const productOperatingCatalogState = productOperatingCatalogContextMatches
    ? resolvedProductOperatingCatalogState
    : "loading";
  const productOperatingCatalog = productOperatingCatalogContextMatches
    ? resolvedProductOperatingCatalog
    : null;
  const productOperatingCatalogStateRef = useRef(productOperatingCatalogState);
  productOperatingCatalogStateRef.current = productOperatingCatalogState;
  const [productOperatingCatalogRefreshSequence, setProductOperatingCatalogRefreshSequence] = useState(0);
  const productOperatingCatalogRequestSequenceRef = useRef(0);
  const productOperatingCatalogContextKeyRef = useRef(productOperatingCatalogContextKey);
  productOperatingCatalogContextKeyRef.current = productOperatingCatalogContextKey;
  const [productDetailPreview, setProductDetailPreview] = useState<{ blockId: string; itemId: string } | null>(null);
  const [productEditorDialogState, setProductEditorDialogState] = useState<
    | { blockId: string; itemId: string; mode: "create" | "edit" }
    | null
  >(null);
  const [productEditorDraft, setProductEditorDraft] = useState<ProductEditorItem | null>(null);
  const [productSettingsCollapsedByBlockId, setProductSettingsCollapsedByBlockId] = useState<
    Record<string, Partial<Record<ProductSettingsSectionKey, boolean>>>
  >({});
  const productPreviewScrollViewportRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const productPreviewRootRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [activeMerchantCardLayoutKeys, setActiveMerchantCardLayoutKeys] = useState<MerchantListLayoutKey[]>([]);
  const [merchantCardLayoutSnapEnabled, setMerchantCardLayoutSnapEnabled] = useState(true);
  const [merchantCardLayoutSnapStep, setMerchantCardLayoutSnapStep] = useState(8);
  const merchantCardLayoutCanvasFocusRef = useRef<HTMLDivElement | null>(null);
  const [searchLayoutSnapEnabled, setSearchLayoutSnapEnabled] = useState(true);
  const [searchLayoutSnapStep, setSearchLayoutSnapStep] = useState(8);
  const searchLayoutCanvasFocusRef = useRef<HTMLDivElement | null>(null);
  const effectiveMaxNavItems = Math.max(1, Math.min(12, Math.round(Number(maxNavItems) || 12)));
  const galleryEditorPanelRef = useRef<HTMLDivElement | null>(null);
  const galleryDragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    startOffsetX: number;
    startOffsetY: number;
  } | null>(null);
  const galleryFrameRef = useRef<HTMLDivElement | null>(null);
  const galleryFrameResizeRef = useRef<{
    direction: "left" | "right" | "top" | "bottom";
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);
  const galleryLayoutDefs: Array<{ id: GalleryLayoutPreset }> = GALLERY_LAYOUT_PRESETS.map((id) => ({ id }));

  useEffect(() => {
    setPreviewNavPageId(currentPageId);
  }, [currentPageId, block.id]);

  useEffect(() => {
    const siteId = runtimeSiteId.trim();
    if (block.type !== "product" || !siteId) return;
    const refreshCatalog = (event: Event) => {
      const detail = parseMerchantCatalogChangedEventDetail(
        (event as CustomEvent<unknown>).detail,
      );
      if (detail?.siteId !== siteId) return;
      setProductOperatingCatalogRefreshSequence((current) => current + 1);
    };
    window.addEventListener(MERCHANT_CATALOG_CHANGED_EVENT, refreshCatalog);
    return () => window.removeEventListener(MERCHANT_CATALOG_CHANGED_EVENT, refreshCatalog);
  }, [block.type, runtimeSiteId]);

  useEffect(() => {
    const siteId = runtimeSiteId.trim();
    const requestSequence = productOperatingCatalogRequestSequenceRef.current + 1;
    productOperatingCatalogRequestSequenceRef.current = requestSequence;
    setResolvedProductOperatingCatalogContextKey(productOperatingCatalogContextKey);
    if (block.type !== "product" || !siteId) {
      setProductOperatingCatalogState("legacy");
      setProductOperatingCatalog(null);
      return;
    }
    const controller = new AbortController();
    const requestContextKey = productOperatingCatalogContextKey;
    const requestIsActive = () =>
      !controller.signal.aborted &&
      productOperatingCatalogRequestSequenceRef.current === requestSequence &&
      productOperatingCatalogContextKeyRef.current === requestContextKey;
    setProductOperatingCatalogState("loading");
    setProductOperatingCatalog(null);
    const query = new URLSearchParams({
      siteId,
      blockId: block.id.trim(),
      viewport: previewViewport,
    });
    void fetch(`/api/orders/catalog/public?${query.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as {
          catalog?: {
            pricePrefix?: unknown;
            products?: unknown;
            categories?: unknown;
            browsingRules?: unknown;
          } | null;
        } | null;
        if (!requestIsActive()) return;
        if (!response.ok) {
          setProductOperatingCatalogState("blocked");
          setProductOperatingCatalog(null);
          return;
        }
        if (payload?.catalog) {
          const categoryNames = Array.isArray(payload.catalog.categories)
            ? payload.catalog.categories
                .map((category) =>
                  category && typeof category === "object" && !Array.isArray(category)
                    ? String((category as { name?: unknown }).name ?? "").trim()
                    : "",
                )
                .filter(Boolean)
            : [];
          setProductOperatingCatalog({
            pricePrefix: String(payload.catalog.pricePrefix ?? "").trim(),
            products: normalizeProductItems(
              Array.isArray(payload.catalog.products) ? payload.catalog.products : undefined,
            ),
            categoryNames: [...new Set(categoryNames)],
            browsingRules: readProductOperatingBrowsingRules(payload.catalog.browsingRules),
          });
          setProductOperatingCatalogState("active");
        } else {
          setProductOperatingCatalog(null);
          setProductOperatingCatalogState("legacy");
        }
      })
      .catch(() => {
        if (requestIsActive()) {
          setProductOperatingCatalog(null);
          setProductOperatingCatalogState("blocked");
        }
      });
    return () => controller.abort();
  }, [block.id, block.type, previewViewport, productOperatingCatalogContextKey, productOperatingCatalogRefreshSequence, runtimeSiteId]);

  function normalizeGalleryImages(
    source: Array<
      | string
      | {
          id?: string;
          url?: string;
          featured?: boolean;
          fitToFrame?: boolean;
          offsetX?: number;
          offsetY?: number;
          scaleX?: number;
          scaleY?: number;
        }
    > | undefined,
  ): GalleryEditorImage[] {
    if (!Array.isArray(source)) return [];
    return source
      .map((item, idx) => {
        if (typeof item === "string") {
          const url = item.trim();
          if (!url) return null;
          return {
            id: `legacy-${idx}`,
            url,
            featured: idx === 0,
            fitToFrame: true,
            offsetX: 0,
            offsetY: 0,
            scaleX: 1,
            scaleY: 1,
          } as GalleryEditorImage;
        }
        if (!item || typeof item !== "object") return null;
        const url = (item.url ?? "").trim();
        if (!url) return null;
        const scaleX = typeof item.scaleX === "number" && Number.isFinite(item.scaleX) ? item.scaleX : 1;
        const scaleY = typeof item.scaleY === "number" && Number.isFinite(item.scaleY) ? item.scaleY : 1;
        return {
          id: item.id?.trim() || `gallery-${idx}`,
          url,
          featured: !!item.featured,
          fitToFrame: typeof item.fitToFrame === "boolean" ? item.fitToFrame : true,
          offsetX: typeof item.offsetX === "number" && Number.isFinite(item.offsetX) ? item.offsetX : 0,
          offsetY: typeof item.offsetY === "number" && Number.isFinite(item.offsetY) ? item.offsetY : 0,
          scaleX: Math.max(0.2, Math.min(3, scaleX)),
          scaleY: Math.max(0.2, Math.min(3, scaleY)),
        };
      })
      .filter((item): item is GalleryEditorImage => !!item);
  }

  function getGalleryImages() {
    if (block.type !== "gallery") return [];
    return normalizeGalleryImages(block.props.images);
  }

  function getProductItems(): ProductEditorItem[] {
    if (block.type !== "product") return [];
    if (productOperatingCatalogState === "active" && productOperatingCatalog) {
      return normalizeProductItems(productOperatingCatalog.products);
    }
    if (productOperatingCatalogState === "blocked" || productOperatingCatalogState === "loading") return [];
    return normalizeProductItems(block.props.products);
  }

  function commitProductItems(items: ProductEditorItem[]) {
    if (block.type !== "product") return;
    onChange({
      products: items.map((item) => ({
        id: item.id,
        code: item.code,
        name: item.name,
        description: item.description,
        price: item.price,
        imageUrl: item.imageUrl,
        thumbnailUrl: item.thumbnailUrl,
        tag: item.tag,
      })),
    });
  }

  function addProductItem() {
    if (block.type !== "product") return;
    const nextItem: ProductEditorItem = {
      id: createProductItemId(),
      code: "",
      name: "",
      description: "",
      price: "",
      imageUrl: "",
      thumbnailUrl: "",
      tag: "",
    };
    setProductEditorDraft(nextItem);
    setProductEditorDialogState({ blockId: block.id, itemId: nextItem.id, mode: "create" });
  }

  function removeProductItem(id: string) {
    if (block.type !== "product") return;
    commitProductItems(getProductItems().filter((item) => item.id !== id));
  }

  function commitGalleryImages(nextItems: GalleryEditorImage[]) {
    if (block.type !== "gallery") return;
    onChange({ images: nextItems });
  }

  function updateGalleryImage(id: string, patch: Partial<GalleryEditorImage>) {
    if (block.type !== "gallery") return;
    const next = getGalleryImages().map((item) => (item.id === id ? { ...item, ...patch } : item));
    commitGalleryImages(next);
  }

  function nudgeGalleryImage(id: string, deltaX: number, deltaY: number) {
    if (block.type !== "gallery") return;
    const current = getGalleryImages().find((item) => item.id === id);
    if (!current) return;
    updateGalleryImage(id, {
      offsetX: Math.round(current.offsetX + deltaX),
      offsetY: Math.round(current.offsetY + deltaY),
    });
  }

  function getGalleryScalePercent(item: GalleryEditorImage) {
    if (item.fitToFrame) return 100;
    const avgScale = (item.scaleX + item.scaleY) / 2;
    const boundedScale = Math.max(0.2, Math.min(2, avgScale));
    return Math.round(boundedScale * 100);
  }

  function stepGalleryScale(id: string, stepPercent: number) {
    if (block.type !== "gallery") return;
    const current = getGalleryImages().find((item) => item.id === id);
    if (!current || current.fitToFrame) return;
    const avgScale = (current.scaleX + current.scaleY) / 2;
    const boundedScale = Math.max(0.2, Math.min(2, avgScale));
    const nextScale = Math.max(0.2, Math.min(2, boundedScale + stepPercent / 100));
    updateGalleryImage(id, {
      scaleX: Number(nextScale.toFixed(3)),
      scaleY: Number(nextScale.toFixed(3)),
    });
  }

  function applyGalleryLayoutPreset(presetId: GalleryLayoutPreset) {
    if (block.type !== "gallery") return;
    if (presetId === "custom") {
      openCustomLayoutDialog();
      return;
    }
    const layout = galleryLayoutDefs.find((item) => item.id === presetId);
    if (!layout) return;
    onChange({
      galleryLayoutPreset: layout.id,
    });
    setLayoutPanelOpen(false);
  }

  function openCustomLayoutDialog() {
    if (block.type !== "gallery") return;
    setCustomLayoutDraft(normalizeCustomGalleryLayout(block.props.galleryCustomLayout));
    setSelectedCustomRowIndex(0);
    setCustomLayoutDialogOpen(true);
  }

  function setCustomRowHeight(rowIndex: number, height: number) {
    setCustomLayoutDraft((prev) => {
      const nextRows = prev.rows.map((row, idx) =>
        idx === rowIndex ? { ...row, height: Math.max(120, Math.min(600, Math.round(height))) } : row,
      ) as CustomGalleryLayout["rows"];
      return { rows: nextRows };
    });
  }

  function setCustomRowAlign(rowIndex: number, align: GalleryRowAlign) {
    setCustomLayoutDraft((prev) => {
      const nextRows = prev.rows.map((row, idx) => (idx === rowIndex ? { ...row, align } : row)) as CustomGalleryLayout["rows"];
      return { rows: nextRows };
    });
  }

  function appendFrameToSelectedRow(width: CustomGalleryFrameWidth) {
    const row = customLayoutDraft.rows[selectedCustomRowIndex];
    if (!row) return;
    const currentSpan = row.frames.reduce((sum, item) => sum + frameWidthToSpan(item), 0);
    const nextSpan = currentSpan + frameWidthToSpan(width);
    if (nextSpan > 12) return;
    setCustomLayoutDraft((prev) => {
      const nextRows = prev.rows.map((item, idx) =>
        idx === selectedCustomRowIndex ? { ...item, frames: [...item.frames, width] } : item,
      ) as CustomGalleryLayout["rows"];
      return { rows: nextRows };
    });
  }

  function removeSelectedRowLastFrame() {
    setCustomLayoutDraft((prev) => {
      const row = prev.rows[selectedCustomRowIndex];
      if (!row || row.frames.length === 0) return prev;
      const nextRows = prev.rows.map((item, idx) =>
        idx === selectedCustomRowIndex ? { ...item, frames: item.frames.slice(0, -1) } : item,
      ) as CustomGalleryLayout["rows"];
      return { rows: nextRows };
    });
  }

  function clearSelectedRowFrames() {
    setCustomLayoutDraft((prev) => {
      const nextRows = prev.rows.map((item, idx) =>
        idx === selectedCustomRowIndex ? { ...item, frames: [] } : item,
      ) as CustomGalleryLayout["rows"];
      return { rows: nextRows };
    });
  }

  function getNavItems(): NavEditorItem[] {
    if (block.type !== "nav") return [];
    const source = Array.isArray(block.props.navItems) ? block.props.navItems : [];
    const fallbackPages = availablePages.length > 0 ? availablePages : [
      { id: "page-1", name: "页面1" },
    ];
    const normalized = source
      .map((item, idx) => {
        const rawPageId = typeof item?.pageId === "string" ? item.pageId.trim() : "";
        const pageId = rawPageId || fallbackPages[idx % fallbackPages.length].id;
        return {
          id: item?.id?.trim() || `nav-item-${idx}`,
          label: (item?.label ?? "") || `页面${idx + 1}`,
          pageId,
        };
      })
      .filter((item) => !!item.pageId);
    if (normalized.length > 0) return normalized;
    return fallbackPages.map((page, idx) => ({
      id: `nav-item-default-${idx}`,
      label: page.name,
      pageId: page.id,
    }));
  }

  function commitNavItems(nextItems: NavEditorItem[]) {
    if (block.type !== "nav") return;
    onChange({ navItems: nextItems });
  }

  function updateNavItem(id: string, patch: Partial<NavEditorItem>) {
    if (block.type !== "nav") return;
    const next = getNavItems().map((item) => (item.id === id ? { ...item, ...patch } : item));
    commitNavItems(next);
  }

  function addNavItem() {
    if (block.type !== "nav") return;
    const current = getNavItems();
    if (current.length >= effectiveMaxNavItems) return;
    const nextPageId = `page-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    commitNavItems([
      ...current,
      {
        id: `nav-item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label: `页面${current.length + 1}`,
        pageId: nextPageId,
      },
    ]);
  }

  function removeNavItem() {
    if (block.type !== "nav") return;
    const current = getNavItems();
    if (current.length <= 1) return;
    commitNavItems(current.slice(0, -1));
  }

  function confirmCustomLayout() {
    if (block.type !== "gallery") return;
    const normalized = normalizeCustomGalleryLayout(customLayoutDraft);
    onChange({
      galleryLayoutPreset: "custom",
      galleryCustomLayout: normalized,
    });
    setCustomLayoutDialogOpen(false);
    setLayoutPanelOpen(false);
  }

  const hasOverlayOpen =
    imageDialogOpen ||
    typographyDialogOpen ||
    buttonJumpDialogOpen ||
    imageSettingsOpen ||
    borderSettingsOpen ||
    navItemStyleDialogOpen ||
    searchButtonStyleDialogOpen ||
    merchantButtonStyleDialogOpen ||
    merchantCardStyleDialogOpen ||
    merchantCardTypographyDialogOpen ||
    layerSettingsOpen ||
    galleryEditorOpen;

  useEffect(() => {
    if (typeof document === "undefined" || !hasOverlayOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [hasOverlayOpen]);

  function stopOverlayEvent(event: { stopPropagation: () => void }) {
    event.stopPropagation();
  }

  function renderOverlay(content: ReactNode) {
    if (typeof window === "undefined") return content;
    return createPortal(
      <div
        onMouseDown={stopOverlayEvent}
        onClick={stopOverlayEvent}
        onPointerDown={stopOverlayEvent}
        onWheel={stopOverlayEvent}
      >
        {content}
      </div>,
      document.body,
    );
  }

  useEffect(() => {
    if (isSelected) return;
    setImageDialogOpen(false);
    if (typographyDialogOpen) {
      const editor = activeEditorRef.current;
      if (typographyTarget === "editor" && typographyPreviewAppliedRef.current && editor && typographyEditorSnapshotRef.current) {
        editor.innerHTML = typographyEditorSnapshotRef.current.html;
        persistEditorTypographyChangeRef.current(editor);
      }
      typographyEditorSnapshotRef.current = null;
      typographyDialogInitialValuesRef.current = null;
      typographyPreviewAppliedRef.current = false;
      setTypographyDialogOpen(false);
    } else {
      typographyEditorSnapshotRef.current = null;
      typographyDialogInitialValuesRef.current = null;
      typographyPreviewAppliedRef.current = false;
    }
    setImageSettingsOpen(false);
    setBorderSettingsOpen(false);
    setLayerSettingsOpen(false);
    setGalleryEditorOpen(false);
    setLayoutPanelOpen(false);
    setCustomLayoutDialogOpen(false);
    setCommonInsertMode(false);
    setActiveCommonTextBoxId(null);
    setButtonJumpDialogOpen(false);
    galleryDragRef.current = null;
    setActiveGalleryImageId(null);
    commonBoxDragRef.current = null;
    commonBoxResizeRef.current = null;
    commonBoxRotateRef.current = null;
    onResizePreview(0);
    activeEditorRef.current = null;
    selectedRangeRef.current = null;
  }, [isSelected, onResizePreview, typographyDialogOpen, typographyTarget]);

  useEffect(() => {
    getRichFieldPatchRef.current = getRichFieldPatch;
    updateNavItemRef.current = updateNavItem;
    updateCommonTextBoxRef.current = updateCommonTextBox;
  });

  useEffect(() => {
    if (!isCommonCanvasBlockType(block.type)) return;
    const commonProps = block.props as CommonProps;

    const readBoxes = (): CommonEditorTextBox[] => {
      const fromBoxes = Array.isArray(commonProps.commonTextBoxes) ? commonProps.commonTextBoxes : [];
      if (fromBoxes.length > 0) {
        return fromBoxes.map((item) => ({
          id: item.id,
          html: item.html ?? "",
          x: Number.isFinite(item.x) ? Math.round(item.x) : 0,
          y: Number.isFinite(item.y) ? Math.round(item.y) : 0,
        width: Number.isFinite(item.width) ? Math.max(80, Math.round(item.width)) : 240,
        height: Number.isFinite(item.height) ? Math.max(40, Math.round(item.height)) : 80,
        rotateDeg: Number.isFinite(item.rotateDeg) ? Number(item.rotateDeg) : 0,
      }));
      }
      const legacyItems = Array.isArray(commonProps.commonItems)
        ? commonProps.commonItems.map((item) => item.trim()).filter(Boolean)
        : [];
      const fallbackItems =
        legacyItems.length > 0
          ? legacyItems
          : [commonProps.heading, commonProps.text].map((item) => (item ?? "").trim()).filter(Boolean);
      return fallbackItems.map((item, idx) => ({
        id: `legacy-${idx}`,
        html: item,
        x: 0,
        y: idx * 88,
        width: 360,
        height: 72,
        rotateDeg: 0,
      }));
    };

    const commitBoxes = (nextBoxes: CommonEditorTextBox[]) => {
      onChange({
        commonTextBoxes: nextBoxes,
        commonItems: undefined,
        heading: undefined,
        text: undefined,
      });
    };
    const currentBlockWidth = normalizeBlockWidth(block.props.blockWidth, block.type);
    const currentBlockHeight = normalizeBlockHeight(block.props.blockHeight, block.type);
    const resolveCanvasMetrics = (boxes: CommonEditorTextBox[]) =>
      resolveCommonCanvasLayout(boxes, {
        availableWidth: typeof currentBlockWidth === "number" ? Math.max(120, currentBlockWidth - 48) : undefined,
        availableHeight: typeof currentBlockHeight === "number" ? Math.max(72, currentBlockHeight - 56) : undefined,
        minCanvasWidth: 280,
        minCanvasHeight: 280,
      });

    const onMove = (event: MouseEvent) => {
      const dragging = commonBoxDragRef.current;
      if (dragging) {
        const boxes = readBoxes();
        const metrics = resolveCanvasMetrics(boxes);
        const scale = metrics.scale > 0 ? metrics.scale : 1;
        const deltaX = event.clientX - dragging.startX;
        const deltaY = event.clientY - dragging.startY;
        const current = boxes.find((item) => item.id === dragging.id);
        if (!current) return;
        const nextX = Math.round(dragging.boxStartX + deltaX / scale);
        const nextY = Math.round(dragging.boxStartY + deltaY / scale);
        commitBoxes(boxes.map((item) => (item.id === dragging.id ? { ...item, x: nextX, y: nextY } : item)));
        return;
      }

      const rotating = commonBoxRotateRef.current;
      if (rotating) {
        const boxes = readBoxes();
        const current = boxes.find((item) => item.id === rotating.id);
        if (!current) return;
        const currentMouseAngle = Math.atan2(event.clientY - rotating.centerY, event.clientX - rotating.centerX);
        const deltaAngle = currentMouseAngle - rotating.startMouseAngle;
        const nextDeg = Math.round((rotating.startRotateDeg + (deltaAngle * 180) / Math.PI) * 10) / 10;
        commitBoxes(boxes.map((item) => (item.id === rotating.id ? { ...item, rotateDeg: nextDeg } : item)));
        return;
      }

      const resizing = commonBoxResizeRef.current;
      if (resizing) {
        const boxes = readBoxes();
        const metrics = resolveCanvasMetrics(boxes);
        const scale = metrics.scale > 0 ? metrics.scale : 1;
        const deltaX = event.clientX - resizing.startX;
        const deltaY = event.clientY - resizing.startY;
        const current = boxes.find((item) => item.id === resizing.id);
        if (!current) return;
        const minWidth = 80;
        const minHeight = 40;
        const resizeFromLeft = resizing.mode === "left" || resizing.mode === "top-left" || resizing.mode === "bottom-left";
        const resizeFromRight = resizing.mode === "right" || resizing.mode === "top-right" || resizing.mode === "bottom-right";
        const resizeFromTop = resizing.mode === "top" || resizing.mode === "top-left" || resizing.mode === "top-right";
        const resizeFromBottom = resizing.mode === "bottom" || resizing.mode === "bottom-left" || resizing.mode === "bottom-right";

        let nextX = resizing.boxStartX;
        let nextY = resizing.boxStartY;
        let nextWidth = resizing.boxStartWidth;
        let nextHeight = resizing.boxStartHeight;
        const normalizedDeltaX = deltaX / scale;
        const normalizedDeltaY = deltaY / scale;

        if (resizeFromLeft) {
          const rawWidth = resizing.boxStartWidth - normalizedDeltaX;
          if (rawWidth >= minWidth) {
            nextWidth = rawWidth;
            nextX = resizing.boxStartX + normalizedDeltaX;
          } else {
            nextWidth = minWidth;
            nextX = resizing.boxStartX + (resizing.boxStartWidth - minWidth);
          }
        } else if (resizeFromRight) {
          nextWidth = Math.max(minWidth, resizing.boxStartWidth + normalizedDeltaX);
        }

        if (resizeFromTop) {
          const rawHeight = resizing.boxStartHeight - normalizedDeltaY;
          if (rawHeight >= minHeight) {
            nextHeight = rawHeight;
            nextY = resizing.boxStartY + normalizedDeltaY;
          } else {
            nextHeight = minHeight;
            nextY = resizing.boxStartY + (resizing.boxStartHeight - minHeight);
          }
        } else if (resizeFromBottom) {
          nextHeight = Math.max(minHeight, resizing.boxStartHeight + normalizedDeltaY);
        }

        const patch: Partial<CommonEditorTextBox> = {
          x: Math.round(nextX),
          y: Math.round(nextY),
          width: Math.round(nextWidth),
          height: Math.round(nextHeight),
        };
        commitBoxes(boxes.map((item) => (item.id === resizing.id ? { ...item, ...patch } : item)));
      }
    };

    const onUp = () => {
      commonBoxDragRef.current = null;
      commonBoxResizeRef.current = null;
      commonBoxRotateRef.current = null;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [block, onChange]);

  useEffect(() => {
    if (block.type !== "gallery") return;
    const normalizeLocal = (): GalleryEditorImage[] => {
      const source = block.props.images;
      if (!Array.isArray(source)) return [];
      return source
        .map((item, idx) => {
          if (typeof item === "string") {
            const url = item.trim();
            if (!url) return null;
            return {
              id: `legacy-${idx}`,
              url,
              featured: idx === 0,
              fitToFrame: true,
              offsetX: 0,
              offsetY: 0,
              scaleX: 1,
              scaleY: 1,
            } as GalleryEditorImage;
          }
          if (!item || typeof item !== "object") return null;
          const url = (item.url ?? "").trim();
          if (!url) return null;
          return {
            id: item.id?.trim() || `gallery-${idx}`,
            url,
            featured: !!item.featured,
            fitToFrame: typeof item.fitToFrame === "boolean" ? item.fitToFrame : true,
            offsetX: typeof item.offsetX === "number" && Number.isFinite(item.offsetX) ? item.offsetX : 0,
            offsetY: typeof item.offsetY === "number" && Number.isFinite(item.offsetY) ? item.offsetY : 0,
            scaleX:
              typeof item.scaleX === "number" && Number.isFinite(item.scaleX) ? Math.max(0.2, Math.min(3, item.scaleX)) : 1,
            scaleY:
              typeof item.scaleY === "number" && Number.isFinite(item.scaleY) ? Math.max(0.2, Math.min(3, item.scaleY)) : 1,
          } as GalleryEditorImage;
        })
        .filter((item): item is GalleryEditorImage => !!item);
    };
    const onMove = (event: MouseEvent) => {
      const dragging = galleryDragRef.current;
      if (dragging) {
        const deltaX = event.clientX - dragging.startX;
        const deltaY = event.clientY - dragging.startY;
        const items = normalizeLocal();
        const current = items.find((item) => item.id === dragging.id);
        if (!current) return;
        const nextX = Math.round(dragging.startOffsetX + deltaX);
        const nextY = Math.round(dragging.startOffsetY + deltaY);

        const next = items.map((item) =>
          item.id === dragging.id
            ? {
                ...item,
                offsetX: nextX,
                offsetY: nextY,
              }
            : item,
        );
        onChange({ images: next });
        return;
      }
    };
    const onUp = () => {
      galleryDragRef.current = null;
      galleryFrameResizeRef.current = null;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [block, onChange]);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (block.type !== "gallery") return;
      const resizing = galleryFrameResizeRef.current;
      if (!resizing) return;
      event.preventDefault();
      const deltaX = event.clientX - resizing.startX;
      const deltaY = event.clientY - resizing.startY;
      const minWidth = 220;
      const maxWidth = 2000;
      const minHeight = 140;
      const maxHeight = 1600;
      let nextWidth = resizing.startWidth;
      let nextHeight = resizing.startHeight;

      if (resizing.direction === "left") nextWidth = resizing.startWidth - deltaX;
      if (resizing.direction === "right") nextWidth = resizing.startWidth + deltaX;
      if (resizing.direction === "top") nextHeight = resizing.startHeight - deltaY;
      if (resizing.direction === "bottom") nextHeight = resizing.startHeight + deltaY;

      onChange({
        galleryFrameWidth: Math.max(minWidth, Math.min(maxWidth, Math.round(nextWidth))),
        galleryFrameHeight: Math.max(minHeight, Math.min(maxHeight, Math.round(nextHeight))),
      });
    };

    const onUp = () => {
      galleryFrameResizeRef.current = null;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [block, onChange]);

  function startGalleryImageDrag(item: GalleryEditorImage, event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setActiveGalleryImageId(item.id);
    galleryDragRef.current = {
      id: item.id,
      startX: event.clientX,
      startY: event.clientY,
      startOffsetX: item.offsetX,
      startOffsetY: item.offsetY,
    };
  }

  function startGalleryFrameResize(
    direction: "left" | "right" | "top" | "bottom",
    event: ReactMouseEvent<HTMLElement>,
  ) {
    if (block.type !== "gallery") return;
    event.preventDefault();
    event.stopPropagation();
    const node = galleryFrameRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    galleryFrameResizeRef.current = {
      direction,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: rect.width,
      startHeight: rect.height,
    };
  }

  function beginResize(direction: "left" | "right" | "top" | "bottom", event: ReactMouseEvent<HTMLDivElement>) {
    if (isBlockLocked) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect();
    const node = resizeTargetRef.current;
    if (!node) return;

    const rect = node.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = rect.width;
    const startHeight = rect.height;
    const startOffsetX =
      typeof block.props.blockOffsetX === "number" && Number.isFinite(block.props.blockOffsetX)
        ? Math.round(block.props.blockOffsetX)
        : 0;
    const startOffsetY =
      typeof block.props.blockOffsetY === "number" && Number.isFinite(block.props.blockOffsetY)
        ? Math.round(block.props.blockOffsetY)
        : 0;
    let latestWidth = startWidth;
    let latestHeight = startHeight;
    let latestOffsetX = startOffsetX;
    let latestOffsetY = startOffsetY;

    const onMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      const resizeFromLeft = direction === "left";
      const resizeFromRight = direction === "right";
      const resizeFromTop = direction === "top";
      const resizeFromBottom = direction === "bottom";

      if (resizeFromLeft) {
        latestWidth = Math.max(getBlockMinWidth(block.type), startWidth - deltaX);
        latestOffsetX = Math.round(startOffsetX + (startWidth - latestWidth));
      } else if (resizeFromRight) {
        latestWidth = Math.max(getBlockMinWidth(block.type), startWidth + deltaX);
        latestOffsetX = startOffsetX;
      } else {
        latestWidth = startWidth;
      }

      if (resizeFromTop) {
        latestHeight = Math.max(getBlockMinHeight(block.type), startHeight - deltaY);
        latestOffsetY = Math.round(startOffsetY + (startHeight - latestHeight));
      } else if (resizeFromBottom) {
        latestHeight = Math.max(getBlockMinHeight(block.type), startHeight + deltaY);
        latestOffsetY = startOffsetY;
      } else {
        latestHeight = startHeight;
      }

      setDraftResize({
        width: resizeFromLeft || resizeFromRight ? Math.round(latestWidth) : undefined,
        height: resizeFromTop || resizeFromBottom ? Math.round(latestHeight) : undefined,
        offsetX: resizeFromLeft ? latestOffsetX : undefined,
        offsetY: resizeFromTop ? latestOffsetY : undefined,
      });
      const liveHeightDelta = resizeFromTop || resizeFromBottom ? Math.round(latestHeight - startHeight) : 0;
      onResizePreview(liveHeightDelta);
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const patch: Partial<Block["props"]> = {};
      const nextWidth = normalizeBlockWidth(Math.round(latestWidth), block.type);
      const nextHeight = normalizeBlockHeight(Math.round(latestHeight), block.type);
      if (direction === "left" || direction === "right") {
        patch.blockWidth = nextWidth;
      }
      if (direction === "top" || direction === "bottom") {
        patch.blockHeight = nextHeight;
      }
      if (direction === "left") {
        patch.blockOffsetX = latestOffsetX;
      }
      if (direction === "top") {
        patch.blockOffsetY = latestOffsetY;
      }
      const heightDelta =
        direction === "top" || direction === "bottom" ? Math.round(latestHeight - startHeight) : 0;
      setDraftResize(null);
      onResizePreview(0);
      onResizeCommit(patch, heightDelta);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function getRichFieldPatch(field: RichFieldName, html: string): Partial<Block["props"]> | null {
    if (field === "buttonLabel" && block.type === "button") {
      return buildButtonLabelPatch(html);
    }
    if (field === "title" && block.type === "hero") {
      return { title: html };
    }
    if (field === "subtitle" && block.type === "hero") {
      return { subtitle: html };
    }
    if (
      field === "text" &&
      (block.type === "text" ||
        block.type === "common" ||
        block.type === "chart" ||
        block.type === "merchant-list" ||
        block.type === "search-bar" ||
        block.type === "product" ||
        block.type === "coupon" ||
        block.type === "google-reviews" ||
        block.type === "booking" ||
        block.type === "poll")
    ) {
      return { text: html };
    }
    if (
      field === "heading" &&
      (block.type === "text" ||
        block.type === "list" ||
        block.type === "contact" ||
        block.type === "common" ||
        block.type === "gallery" ||
        block.type === "chart" ||
        block.type === "music" ||
        block.type === "nav" ||
        block.type === "merchant-list" ||
        block.type === "search-bar" ||
        block.type === "product" ||
        block.type === "coupon" ||
        block.type === "google-reviews" ||
        block.type === "booking" ||
        block.type === "poll")
    ) {
      return { heading: html };
    }
    if (field === "phone" && block.type === "contact") {
      return { phone: html };
    }
    if (field === "address" && block.type === "contact") {
      const plain = toPlainText(html, "").trim();
      const fromArray = Array.isArray(block.props.addresses) ? [...block.props.addresses] : [];
      if (plain) {
        if (fromArray.length > 0) fromArray[0] = plain;
        else fromArray.push(plain);
      } else if (fromArray.length > 0) {
        fromArray.shift();
      }
      return { address: html, addresses: fromArray };
    }
    return null;
  }

  function handleRichFieldChange(field: RichFieldName, html: string) {
    const patch = getRichFieldPatch(field, html);
    if (patch) onChange(patch);
  }

  function updateSelectionRange(range: Range | null) {
    selectedRangeRef.current = range ? range.cloneRange() : null;
  }

  function registerActiveEditor(editor: HTMLDivElement | null) {
    activeEditorRef.current = editor;
  }

  function clearTypographyPreviewSession() {
    typographyEditorSnapshotRef.current = null;
    typographyDialogInitialValuesRef.current = null;
    typographyPreviewAppliedRef.current = false;
  }

  const getCurrentTypographyDialogValues = useCallback(
    () =>
      ({
        fontFamily: typoFontFamily,
        fontSize: clampTypographyFontSizeInput(typoFontSize),
        fontColor: typoFontColor,
        bold: typoBold,
        italic: typoItalic,
        underline: typoUnderline,
      }) satisfies TypographyDialogValues,
    [typoBold, typoFontColor, typoFontFamily, typoFontSize, typoItalic, typoUnderline],
  );

  function setTypographyDialogValues(next: TypographyDialogValues) {
    setTypoFontFamily(next.fontFamily);
    setTypoFontSize(clampTypographyFontSizeInputToString(next.fontSize));
    setTypoFontColor(next.fontColor);
    setTypoBold(next.bold);
    setTypoItalic(next.italic);
    setTypoUnderline(next.underline);
  }

  function readTypographyDialogValuesFromSelection(
    editor: HTMLDivElement,
    range: Range | null,
  ): TypographyDialogValues {
    const rangeInCurrentEditor = !!range && editor.contains(range.commonAncestorContainer);
    const selectedNode = (rangeInCurrentEditor ? range.commonAncestorContainer : editor) as HTMLElement;
    const element = selectedNode.nodeType === Node.ELEMENT_NODE ? selectedNode : selectedNode.parentElement;
    const computedStyle = element ? window.getComputedStyle(element) : null;

    const readInlineStyle = (pick: (node: HTMLElement) => string) => {
      let current = element;
      while (current && editor.contains(current)) {
        const value = pick(current).trim();
        if (value) return value;
        current = current.parentElement;
      }
      return "";
    };

    const inlineFontFamily = readInlineStyle((node) => node.style.fontFamily);
    const inlineFontSize = readInlineStyle((node) => node.style.fontSize);
    const inlineColor = readInlineStyle((node) => node.style.color);
    const inlineBackgroundImage = readInlineStyle((node) => node.style.backgroundImage);
    const inlineFontWeight = readInlineStyle((node) => node.style.fontWeight);
    const inlineFontStyle = readInlineStyle((node) => node.style.fontStyle);
    const inlineTextDecoration = readInlineStyle((node) => node.style.textDecoration);

    const resolvedFontColor =
      inlineBackgroundImage && inlineBackgroundImage !== "none"
        ? inlineBackgroundImage
        : inlineColor || computedStyle?.color || "#111111";

    return {
      fontFamily: resolveFontFamilyOptionValue(inlineFontFamily || computedStyle?.fontFamily || ""),
      fontSize: Math.max(
        8,
        clampTypographyFontSizeInput(Math.round(Number.parseFloat(inlineFontSize || computedStyle?.fontSize || "16")) || 16),
      ),
      fontColor: resolvedFontColor,
      bold:
        (inlineFontWeight || computedStyle?.fontWeight || "").toString() === "700" ||
        inlineFontWeight === "bold" ||
        computedStyle?.fontWeight === "bold",
      italic: (inlineFontStyle || computedStyle?.fontStyle || "") === "italic",
      underline: (inlineTextDecoration || computedStyle?.textDecorationLine || "").includes("underline"),
    } satisfies TypographyDialogValues;
  }

  function buildBlockLevelTypographyPatch(values: TypographyDialogValues): Partial<Block["props"]> {
    return {
      fontFamily: values.fontFamily.trim() || undefined,
      fontColor: values.fontColor.trim() || undefined,
      fontSize: values.fontSize,
      fontWeight: values.bold ? "bold" : "normal",
      fontStyle: values.italic ? "italic" : "normal",
      textDecoration: values.underline ? "underline" : "none",
    };
  }

  function applyTypographyStylesToSpan(span: HTMLSpanElement, values: TypographyDialogValues) {
    const fontFamily = values.fontFamily.trim();
    const fontColor = values.fontColor.trim();
    span.style.fontFamily = fontFamily || "";
    span.style.backgroundImage = "";
    span.style.backgroundClip = "";
    span.style.webkitBackgroundClip = "";
    span.style.color = "";
    if (fontColor) {
      if (isGradientToken(fontColor)) {
        span.style.backgroundImage = fontColor;
        span.style.backgroundClip = "text";
        span.style.webkitBackgroundClip = "text";
        span.style.color = "transparent";
      } else {
        span.style.color = fontColor;
      }
    }
    span.style.fontSize = `${values.fontSize}px`;
    span.style.fontWeight = values.bold ? "bold" : "normal";
    span.style.fontStyle = values.italic ? "italic" : "normal";
    span.style.textDecoration = values.underline ? "underline" : "none";
  }

  function clearInlineTypographyStylesWithinSpan(span: HTMLSpanElement) {
    const descendants = span.querySelectorAll<HTMLElement>("*");
    descendants.forEach((element) => {
      INLINE_TYPOGRAPHY_STYLE_PROPERTIES.forEach((property) => {
        element.style.removeProperty(property);
      });
      element.removeAttribute("color");
      element.removeAttribute("face");
      element.removeAttribute("size");
      if (!element.getAttribute("style")?.trim()) {
        element.removeAttribute("style");
      }
    });
    const presentationalElements = Array.from(span.querySelectorAll("font, small, big, sup, sub"));
    presentationalElements.forEach((element) => {
      const parent = element.parentNode;
      if (!parent) return;
      while (element.firstChild) {
        parent.insertBefore(element.firstChild, element);
      }
      parent.removeChild(element);
    });
  }

  const persistEditorTypographyChange = useCallback((editor: HTMLDivElement, options?: { includeBlockLevelPatch?: boolean }) => {
    flushBufferedEditorTextCommits();
    const commonBoxId = editor.dataset.commonBoxId?.trim();
    const fieldName = editor.dataset.field as RichFieldName | undefined;
    const blockLevelTypographyPatch = options?.includeBlockLevelPatch ? buildBlockLevelTypographyPatch(getCurrentTypographyDialogValues()) : null;

    if (isCommonCanvasBlockType(block.type) && commonBoxId) {
      updateCommonTextBoxRef.current(commonBoxId, { html: editor.innerHTML });
    } else {
      const contentPatch = fieldName ? getRichFieldPatchRef.current(fieldName, editor.innerHTML) : null;
      const mergedPatch: Partial<Block["props"]> = {
        ...(contentPatch ?? {}),
        ...(block.type !== "nav" ? (blockLevelTypographyPatch ?? {}) : {}),
      };
      if (Object.keys(mergedPatch).length > 0) {
        onChange(mergedPatch);
      }
    }
    if (block.type === "nav") {
      const navItemId = editor.dataset.navItemId?.trim();
      if (navItemId) {
        updateNavItemRef.current(navItemId, { label: editor.innerHTML });
      }
    }
  }, [block.type, getCurrentTypographyDialogValues, onChange]);
  persistEditorTypographyChangeRef.current = persistEditorTypographyChange;

  const applyTypographyPreviewToEditor = useCallback((values: TypographyDialogValues) => {
    const editor = activeEditorRef.current;
    const snapshot = typographyEditorSnapshotRef.current;
    if (!editor || !snapshot) return;
    editor.innerHTML = snapshot.html;
    const range = restoreEditorRange(editor, snapshot.range);
    if (!range) return;

    const span = document.createElement("span");
    applyTypographyStylesToSpan(span, values);
    if (range.collapsed) {
      const marker = document.createTextNode("");
      span.appendChild(marker);
      range.insertNode(span);
      if (!marker.data) {
        marker.data = "\u200B";
      }
    } else {
      span.appendChild(range.extractContents());
      clearInlineTypographyStylesWithinSpan(span);
      range.insertNode(span);
    }

    persistEditorTypographyChangeRef.current(editor);
  }, []);

  const cancelTypographyEditing = useCallback(() => {
    const editor = activeEditorRef.current;
    if (typographyTarget === "editor" && typographyPreviewAppliedRef.current && editor && typographyEditorSnapshotRef.current) {
      editor.innerHTML = typographyEditorSnapshotRef.current.html;
      persistEditorTypographyChange(editor);
    }
    clearTypographyPreviewSession();
    setTypographyDialogOpen(false);
  }, [persistEditorTypographyChange, typographyTarget]);

  function editTypography() {
    const editor = activeEditorRef.current;
    const liveSelection = typeof window !== "undefined" ? window.getSelection() : null;
    const liveRange =
      editor && liveSelection && liveSelection.rangeCount > 0 ? liveSelection.getRangeAt(0) : null;
    const liveRangeInCurrentEditor = !!editor && !!liveRange && editor.contains(liveRange.commonAncestorContainer);
    if (liveRangeInCurrentEditor && liveRange) {
      updateSelectionRange(liveRange);
    }
    const currentRange = liveRangeInCurrentEditor && liveRange ? liveRange.cloneRange() : selectedRangeRef.current;
    const canUseEditor = !!editor && !!currentRange && editor.contains(currentRange.commonAncestorContainer);
    if (block.type === "search-bar" && !canUseEditor) {
      clearTypographyPreviewSession();
      setTypoFontFamily((block.props.fontFamily ?? "").trim());
      setTypoFontSize(
        typeof block.props.fontSize === "number" && Number.isFinite(block.props.fontSize)
          ? clampTypographyFontSizeInputToString(block.props.fontSize)
          : "16",
      );
      setTypoFontColor((block.props.fontColor ?? "").trim() || "#111111");
      setTypoBold((block.props.fontWeight ?? "normal") === "bold");
      setTypoItalic((block.props.fontStyle ?? "normal") === "italic");
      setTypoUnderline((block.props.textDecoration ?? "none") === "underline");
      setTypoRememberLast(true);
      setTypographyTarget("search-controls");
      setTypographyDialogOpen(true);
      return;
    }
    if (block.type === "merchant-list" && !canUseEditor) {
      clearTypographyPreviewSession();
      setTypoFontFamily((block.props.fontFamily ?? "").trim());
      setTypoFontSize(
        typeof block.props.fontSize === "number" && Number.isFinite(block.props.fontSize)
          ? clampTypographyFontSizeInputToString(block.props.fontSize)
          : "16",
      );
      setTypoFontColor((block.props.fontColor ?? "").trim() || "#111111");
      setTypoBold((block.props.fontWeight ?? "normal") === "bold");
      setTypoItalic((block.props.fontStyle ?? "normal") === "italic");
      setTypoUnderline((block.props.textDecoration ?? "none") === "underline");
      setTypoRememberLast(true);
      setTypographyTarget("merchant-controls");
      setTypographyDialogOpen(true);
      return;
    }
    if (block.type === "button" && !canUseEditor) {
      clearTypographyPreviewSession();
      setTypoFontFamily((block.props.fontFamily ?? "").trim());
      setTypoFontSize(
        typeof block.props.fontSize === "number" && Number.isFinite(block.props.fontSize)
          ? clampTypographyFontSizeInputToString(block.props.fontSize)
          : "16",
      );
      setTypoFontColor((block.props.fontColor ?? "").trim() || "#111111");
      setTypoBold((block.props.fontWeight ?? "normal") === "bold");
      setTypoItalic((block.props.fontStyle ?? "normal") === "italic");
      setTypoUnderline((block.props.textDecoration ?? "none") === "underline");
      setTypoRememberLast(true);
      setTypographyTarget("button-controls");
      setTypographyDialogOpen(true);
      return;
    }
    if (!editor) {
      onAlert("请先点击要编辑的文本");
      return;
    }

    const dialogValuesFromSelection = readTypographyDialogValuesFromSelection(editor, currentRange);
    typographyDialogInitialValuesRef.current = dialogValuesFromSelection;
    typographyEditorSnapshotRef.current = {
      html: editor.innerHTML,
      range: currentRange && editor.contains(currentRange.commonAncestorContainer) ? serializeEditorRange(editor, currentRange) : null,
    };
    typographyPreviewAppliedRef.current = false;

    setTypographyDialogValues(dialogValuesFromSelection);
    setTypographyTarget("editor");
    setTypographyDialogOpen(true);
  }

  function applyTypography() {
    const values = getCurrentTypographyDialogValues();
    const blockLevelTypographyPatch = buildBlockLevelTypographyPatch(values);
    if (typographyTarget === "search-controls" && block.type === "search-bar") {
      onChange(blockLevelTypographyPatch);
      onRecordColor(values.fontColor);
      setTypoRememberLast(true);
      clearTypographyPreviewSession();
      setTypographyDialogOpen(false);
      return;
    }
    if (typographyTarget === "merchant-controls" && block.type === "merchant-list") {
      onChange(blockLevelTypographyPatch);
      onRecordColor(values.fontColor);
      setTypoRememberLast(true);
      clearTypographyPreviewSession();
      setTypographyDialogOpen(false);
      return;
    }
    if (typographyTarget === "button-controls" && block.type === "button") {
      onChange(blockLevelTypographyPatch);
      onRecordColor(values.fontColor);
      setTypoRememberLast(true);
      clearTypographyPreviewSession();
      setTypographyDialogOpen(false);
      return;
    }
    if (typographyPreviewAppliedRef.current) {
      onRecordColor(values.fontColor);
      setTypoRememberLast(true);
      clearTypographyPreviewSession();
      setTypographyDialogOpen(false);
      return;
    }
    if (areTypographyDialogValuesEqual(typographyDialogInitialValuesRef.current, values)) {
      clearTypographyPreviewSession();
      setTypographyDialogOpen(false);
      return;
    }
    const editor = activeEditorRef.current;
    if (!editor) {
      onAlert("请先点击要编辑的文本");
      return;
    }

    editor.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const savedRange = selectedRangeRef.current;
    let range: Range;
    if (savedRange && editor.contains(savedRange.commonAncestorContainer)) {
      selection.removeAllRanges();
      selection.addRange(savedRange);
      range = selection.getRangeAt(0);
    } else {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    const span = document.createElement("span");
    applyTypographyStylesToSpan(span, values);
    if (range.collapsed) {
      const marker = document.createTextNode("");
      span.appendChild(marker);
      range.insertNode(span);
      const caretRange = document.createRange();
      caretRange.setStart(marker, 0);
      caretRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(caretRange);

      // If no text is selected, set a styled typing anchor so subsequent input uses this style.
      if (!marker.data) {
        marker.data = "\u200B";
        const typingRange = document.createRange();
        typingRange.setStart(marker, 1);
        typingRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(typingRange);
      }
    } else {
      span.appendChild(range.extractContents());
      range.insertNode(span);
    }
    persistEditorTypographyChange(editor, { includeBlockLevelPatch: range.collapsed });
    onRecordColor(values.fontColor);
    setTypoRememberLast(true);
    clearTypographyPreviewSession();
    setTypographyDialogOpen(false);
  }

  useEffect(() => {
    if (!typographyDialogOpen || typographyTarget !== "editor") return;
    const editor = activeEditorRef.current;
    const snapshot = typographyEditorSnapshotRef.current;
    if (!editor || !snapshot || !typographyDialogInitialValuesRef.current) return;

    const currentValues = getCurrentTypographyDialogValues();
    const unchanged = areTypographyDialogValuesEqual(typographyDialogInitialValuesRef.current, currentValues);
    if (unchanged && !typographyPreviewAppliedRef.current) return;

    if (unchanged) {
      editor.innerHTML = snapshot.html;
      persistEditorTypographyChangeRef.current(editor);
      typographyPreviewAppliedRef.current = false;
      return;
    }

    applyTypographyPreviewToEditor(currentValues);
    typographyPreviewAppliedRef.current = true;
  }, [
    applyTypographyPreviewToEditor,
    getCurrentTypographyDialogValues,
    typoBold,
    typoFontColor,
    typoFontFamily,
    typoFontSize,
    typoItalic,
    typoUnderline,
    typographyDialogOpen,
    typographyTarget,
  ]);

  function insertImage() {
    setImageUrlInput(block.props.bgImageUrl ?? "");
    setImageDialogOpen(true);
  }

  function applyImageUrl() {
    const trimmed = imageUrlInput.trim();
    try {
      const nextUrl = ensureSafeImageUrlSize(trimmed || undefined);
      onChange({
        bgImageUrl: nextUrl,
        bgImageOpacity:
          typeof block.props.bgImageOpacity === "number" && Number.isFinite(block.props.bgImageOpacity)
            ? Math.max(0, Math.min(1, block.props.bgImageOpacity))
            : typeof block.props.bgOpacity === "number" && Number.isFinite(block.props.bgOpacity)
              ? Math.max(0, Math.min(1, block.props.bgOpacity))
              : 1,
        bgColorOpacity:
          typeof block.props.bgColorOpacity === "number" && Number.isFinite(block.props.bgColorOpacity)
            ? Math.max(0, Math.min(1, block.props.bgColorOpacity))
            : 1,
        bgFillMode: block.props.bgFillMode ?? "cover",
        bgPosition: block.props.bgPosition ?? "center",
      });
      setImageDialogOpen(false);
    } catch (error) {
      onAlert(error instanceof Error ? error.message : "图片设置失败，请重试");
    }
  }

  function clearImage() {
    onChange({ bgImageUrl: undefined });
    setImageDialogOpen(false);
  }

  async function onUploadImage(event: ChangeEvent<HTMLInputElement>) {
    if (imageUploading) return;
    const inputEl = event.currentTarget;
    const file = event.target.files?.[0];
    if (!file) return;
    setImageUploading(true);
    try {
      const result = await onPersistImageFile(file, block.type === "common" ? { purpose: "common" } : undefined);
      onChange({
        bgImageUrl: result.value,
        bgImageOpacity:
          typeof block.props.bgImageOpacity === "number" && Number.isFinite(block.props.bgImageOpacity)
            ? Math.max(0, Math.min(1, block.props.bgImageOpacity))
            : typeof block.props.bgOpacity === "number" && Number.isFinite(block.props.bgOpacity)
              ? Math.max(0, Math.min(1, block.props.bgOpacity))
              : 1,
        bgColorOpacity:
          typeof block.props.bgColorOpacity === "number" && Number.isFinite(block.props.bgColorOpacity)
            ? Math.max(0, Math.min(1, block.props.bgColorOpacity))
            : 1,
        bgFillMode: block.props.bgFillMode ?? "cover",
        bgPosition: block.props.bgPosition ?? "center",
      });
      setImageDialogOpen(false);
      if (!result.externalized) {
        onAlert("图片已写入当前草稿，但未上传到存储；发布前会再次尝试外链化。");
      }
    } catch (error) {
      onAlert(error instanceof Error ? error.message : "上传失败，请重试");
    } finally {
      setImageUploading(false);
      inputEl.value = "";
    }
  }

  async function onUploadGalleryImages(event: ChangeEvent<HTMLInputElement>) {
    if (block.type !== "gallery" || galleryUploading) return;
    const inputEl = event.currentTarget;
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    setGalleryUploading(true);
    try {
      const uploaded = await Promise.all(files.map((file) => onPersistImageFile(file, { purpose: "gallery" })));
      const existing = getGalleryImages();
      const uploadedItems = uploaded.map((result, idx) => ({
        id: `img-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
        url: result.value,
        featured: existing.length === 0 && idx === 0,
        fitToFrame: false,
        offsetX: 0,
        offsetY: 0,
        scaleX: 1,
        scaleY: 1,
      }));
      onChange({
        images: [...existing, ...uploadedItems],
      });
      if (uploaded.some((item) => !item.externalized)) {
        onAlert("部分图片未上传到存储，当前先保存在草稿中；发布前会再次尝试外链化。");
      }
    } catch (error) {
      onAlert(error instanceof Error ? error.message : "上传失败，请重试");
    } finally {
      setGalleryUploading(false);
      inputEl.value = "";
    }
  }

  async function onReplaceGalleryImage(id: string, event: ChangeEvent<HTMLInputElement>) {
    if (block.type !== "gallery" || galleryUploading) return;
    const inputEl = event.currentTarget;
    const file = event.target.files?.[0];
    if (!file) return;
    setGalleryUploading(true);
    try {
      const result = await onPersistImageFile(file, { purpose: "gallery" });
      updateGalleryImage(id, { url: result.value });
      if (!result.externalized) {
        onAlert("图片已替换到草稿，但未上传到存储；发布前会再次尝试外链化。");
      }
    } catch (error) {
      onAlert(error instanceof Error ? error.message : "上传失败，请重试");
    } finally {
      setGalleryUploading(false);
      inputEl.value = "";
    }
  }

  async function onUploadMusic(event: ChangeEvent<HTMLInputElement>) {
    if (block.type !== "music") return;
    const inputEl = event.currentTarget;
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const result = await onPersistAudioFile(file);
      onChange({ audioUrl: result.value });
      if (!result.externalized) {
        onAlert("音频已写入当前草稿，但未上传到存储；发布前会阻止内嵌音频。");
      }
    } catch (error) {
      onAlert(error instanceof Error ? error.message : "上传失败，请重试");
    } finally {
      inputEl.value = "";
    }
  }

  async function persistProductImageUpload(event: ChangeEvent<HTMLInputElement>) {
    if (productImageUploading) return null;
    const inputEl = event.currentTarget;
    const file = event.target.files?.[0];
    if (!file) return null;
    setProductImageUploading(true);
    try {
      const result = await onPersistProductImageFile(file);
      if (!result.externalized) {
        onAlert("产品图片已写入草稿，但未上传到存储；发布前会再次尝试外链化。");
      }
      return result;
    } catch (error) {
      onAlert(error instanceof Error ? error.message : "上传失败，请重试");
      return null;
    } finally {
      setProductImageUploading(false);
      inputEl.value = "";
    }
  }

  async function onImportProductSheet(event: ChangeEvent<HTMLInputElement>) {
    const inputEl = event.currentTarget;
    if (block.type !== "product" || productOperatingCatalogStateRef.current !== "legacy") {
      inputEl.value = "";
      return;
    }
    const file = inputEl.files?.[0];
    if (!file) return;
    if (file.size > PRODUCT_EXCEL_IMPORT_MAX_FILE_BYTES) {
      onAlert("Excel 文件不能超过 10 MB，请删除无关工作表、图片或格式后重试。");
      inputEl.value = "";
      return;
    }
    try {
      const buffer = await file.arrayBuffer();
      const { mergeImportedProductRows, parseProductWorkbook } = await import("@/lib/productImport");
      const parsed = parseProductWorkbook(buffer);
      if (productOperatingCatalogStateRef.current !== "legacy") {
        onAlert("商品经营数据已切换到工作台目录，本次网站草稿导入已取消。请前往订单工作台导入。");
        return;
      }
      if (parsed.truncated || parsed.items.length > 1_000) {
        onAlert("Excel 首个工作表超过 1000 条读取上限，或有效范围中包含过多空白/格式行。请清理工作表后重试。");
        return;
      }
      if (parsed.items.length === 0) {
        onAlert("表格中没有可导入的产品数据。");
        return;
      }
      const merged = mergeImportedProductRows(getProductItems(), parsed.items);
      commitProductItems(normalizeProductItems(merged));
      onAlert(`已导入 ${parsed.rowCount} 条产品文字信息。`);
    } catch (error) {
      onAlert(error instanceof Error ? error.message : "Excel 导入失败，请检查文件格式。");
    } finally {
      inputEl.value = "";
    }
  }

  async function onImportProductImages(event: ChangeEvent<HTMLInputElement>) {
    if (block.type !== "product" || productImageUploading) return;
    const inputEl = event.currentTarget;
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    setProductImageUploading(true);
    try {
      const uploaded = await Promise.all(files.map(async (file) => ({
        fileName: file.name,
        uploaded: await onPersistProductImageFile(file),
      })));
      const { mergeImportedProductImages } = await import("@/lib/productImport");
      const merged = mergeImportedProductImages(
        getProductItems(),
        uploaded.map((entry) => ({
          fileName: entry.fileName,
          imageUrl: entry.uploaded.value,
          thumbnailUrl: entry.uploaded.thumbnailUrl,
        })),
      );
      commitProductItems(merged.items);
      const baseMessage = `按编号匹配完成：成功 ${merged.matched} 张，未匹配 ${merged.unmatched} 张。`;
      if (uploaded.some((entry) => !entry.uploaded.externalized)) {
        onAlert(`${baseMessage} 部分图片仍保存在草稿中，发布前会再次尝试外链化。`);
      } else {
        onAlert(baseMessage);
      }
    } catch (error) {
      onAlert(error instanceof Error ? error.message : "图片导入失败，请重试");
    } finally {
      setProductImageUploading(false);
      inputEl.value = "";
    }
  }

  function editImageSettings() {
    setSettingsFillMode(block.props.bgFillMode ?? "cover");
    setSettingsPosition(block.props.bgPosition ?? "center");
    setSettingsColor(block.props.bgColor ?? "");
    setSettingsImageOpacity(
      typeof block.props.bgImageOpacity === "number" && Number.isFinite(block.props.bgImageOpacity)
        ? Math.max(0, Math.min(1, block.props.bgImageOpacity))
        : typeof block.props.bgOpacity === "number" && Number.isFinite(block.props.bgOpacity)
          ? Math.max(0, Math.min(1, block.props.bgOpacity))
          : 1,
    );
    setSettingsColorOpacity(
      typeof block.props.bgColorOpacity === "number" && Number.isFinite(block.props.bgColorOpacity)
        ? Math.max(0, Math.min(1, block.props.bgColorOpacity))
        : typeof block.props.bgOpacity === "number" && Number.isFinite(block.props.bgOpacity)
          ? Math.max(0, Math.min(1, block.props.bgOpacity))
        : 1,
    );
    setImageSettingsOpen(true);
  }

  function applyImageSettings() {
    onChange({
      bgFillMode: settingsFillMode,
      bgPosition: settingsPosition.trim() || "center",
      bgColor: settingsColor.trim() || undefined,
      bgImageOpacity: settingsImageOpacity,
      bgColorOpacity: settingsColorOpacity,
      bgOpacity: undefined,
    });
    onRecordColor(settingsColor);
    setImageSettingsOpen(false);
  }

  function getCommonTextBoxes(): CommonEditorTextBox[] {
    if (!isCommonCanvasBlockType(block.type)) return [];
    const commonProps = block.props as CommonProps;
    const fromBoxes = Array.isArray(commonProps.commonTextBoxes) ? commonProps.commonTextBoxes : [];
    if (fromBoxes.length > 0) {
      return fromBoxes
        .filter((item) => item && typeof item.id === "string")
        .map((item) => ({
          id: item.id,
          html: item.html ?? "",
          x: Number.isFinite(item.x) ? Math.round(item.x) : 0,
          y: Number.isFinite(item.y) ? Math.round(item.y) : 0,
          width: Number.isFinite(item.width) ? Math.max(80, Math.round(item.width)) : 240,
          height: Number.isFinite(item.height) ? Math.max(40, Math.round(item.height)) : 80,
          rotateDeg: Number.isFinite(item.rotateDeg) ? Number(item.rotateDeg) : 0,
        }));
    }
    const legacyItems = Array.isArray(commonProps.commonItems) ? commonProps.commonItems.map((item) => item.trim()).filter(Boolean) : [];
    const fallbackItems = legacyItems;
    return fallbackItems.map((item, idx) => ({
      id: `legacy-${idx}`,
      html: item,
      x: 0,
      y: idx * 88,
      width: 360,
      height: 72,
      rotateDeg: 0,
    }));
  }

  function getCommonCanvasMetrics() {
    if (!isCommonCanvasBlockType(block.type)) return null;
    const availableWidth = typeof blockWidth === "number" ? Math.max(120, blockWidth - 48) : undefined;
    const availableHeight = typeof blockHeight === "number" ? Math.max(72, blockHeight - 48) : undefined;
    return resolveCommonCanvasLayout(getCommonTextBoxes(), {
      availableWidth,
      availableHeight,
      minCanvasWidth: 280,
      minCanvasHeight: 240,
    });
  }

  function commitCommonTextBoxes(nextBoxes: CommonEditorTextBox[]) {
    if (!isCommonCanvasBlockType(block.type)) return;
    onChange({
      commonTextBoxes: nextBoxes,
      commonItems: undefined,
      heading: undefined,
      text: undefined,
    });
  }

  function updateCommonTextBox(id: string, patch: Partial<CommonEditorTextBox>) {
    if (!isCommonCanvasBlockType(block.type)) return;
    const next = getCommonTextBoxes().map((item) => (item.id === id ? { ...item, ...patch } : item));
    commitCommonTextBoxes(next);
  }

  function deleteCommonTextBox(id: string) {
    if (!isCommonCanvasBlockType(block.type)) return;
    const next = getCommonTextBoxes().filter((item) => item.id !== id);
    commitCommonTextBoxes(next);
    if (activeCommonTextBoxId === id) {
      setActiveCommonTextBoxId(null);
    }
  }

  function insertTextBox() {
    if (isCommonCanvasBlockType(block.type)) {
      setCommonInsertMode(true);
      setActiveCommonTextBoxId(null);
      return;
    }
    if (block.type === "chart") {
      const baseText = block.props.text ?? "";
      const nextText = baseText ? `${baseText}<div><br></div>` : "";
      onChange({ text: nextText });
      return;
    }
    onAlert("当前区块类型不支持插入文字");
  }

  function handleCommonCanvasMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    if (!isCommonCanvasBlockType(block.type)) return;
    if (!commonInsertMode) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-common-box]")) return;
    const canvas = commonCanvasRef.current;
    if (!canvas) return;
    const metrics = getCommonCanvasMetrics();
    const scale = metrics?.scale && metrics.scale > 0 ? metrics.scale : 1;
    const translateX = metrics?.translateX ?? 0;
    const translateY = metrics?.translateY ?? 0;
    const rect = canvas.getBoundingClientRect();
    const clickX = Math.round((event.clientX - rect.left) / scale - translateX);
    const clickY = Math.round((event.clientY - rect.top) / scale - translateY);
    const newBox: CommonEditorTextBox = {
      id: `txt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      html: "",
      x: clickX,
      y: clickY,
      width: 260,
      height: 90,
      rotateDeg: 0,
    };
    const next = [...getCommonTextBoxes(), newBox];
    commitCommonTextBoxes(next);
    setCommonInsertMode(false);
    setActiveCommonTextBoxId(newBox.id);
    event.preventDefault();
    event.stopPropagation();
  }

  function startCommonBoxDrag(box: CommonEditorTextBox, event: ReactMouseEvent<HTMLElement>) {
    if (!isCommonCanvasBlockType(block.type)) return;
    event.preventDefault();
    event.stopPropagation();
    setActiveCommonTextBoxId(box.id);
    commonBoxDragRef.current = {
      id: box.id,
      startX: event.clientX,
      startY: event.clientY,
      boxStartX: box.x,
      boxStartY: box.y,
    };
  }

  function startCommonBoxResize(
    box: CommonEditorTextBox,
    mode: "left" | "right" | "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right",
    event: ReactMouseEvent<HTMLDivElement>,
  ) {
    if (!isCommonCanvasBlockType(block.type)) return;
    event.preventDefault();
    event.stopPropagation();
    setActiveCommonTextBoxId(box.id);
    commonBoxResizeRef.current = {
      id: box.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      boxStartX: box.x,
      boxStartY: box.y,
      boxStartWidth: box.width,
      boxStartHeight: box.height,
    };
  }

  function startCommonBoxRotate(box: CommonEditorTextBox, event: ReactMouseEvent<HTMLElement>) {
    if (!isCommonCanvasBlockType(block.type)) return;
    event.preventDefault();
    event.stopPropagation();
    const canvas = commonCanvasRef.current;
    if (!canvas) return;
    const metrics = getCommonCanvasMetrics();
    const scale = metrics?.scale && metrics.scale > 0 ? metrics.scale : 1;
    const translateX = metrics?.translateX ?? 0;
    const translateY = metrics?.translateY ?? 0;
    const rect = canvas.getBoundingClientRect();
    const centerX = rect.left + (box.x + translateX + box.width / 2) * scale;
    const centerY = rect.top + (box.y + translateY + box.height / 2) * scale;
    commonBoxRotateRef.current = {
      id: box.id,
      centerX,
      centerY,
      startMouseAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX),
      startRotateDeg: box.rotateDeg,
    };
    setActiveCommonTextBoxId(box.id);
  }

  function openButtonJumpDialog() {
    if (block.type !== "button") return;
    setButtonJumpTargetInput((block.props.buttonJumpTarget ?? "").trim());
    setButtonJumpDialogOpen(true);
  }

  function applyButtonJumpTarget() {
    if (block.type !== "button") return;
    onChange({
      buttonJumpTarget: buttonJumpTargetInput.trim() || undefined,
    });
    setButtonJumpDialogOpen(false);
  }

  function openButtonAnimationDialog() {
    if (block.type !== "button") return;
    setButtonAnimationDialogOpen(true);
  }

  function applyButtonHoverAnimation(value: ButtonHoverAnimation) {
    if (block.type !== "button") return;
    onChange({
      buttonHoverAnimation: normalizeButtonHoverAnimation(value),
    });
    setButtonAnimationDialogOpen(false);
  }

  function editBorderSettings() {
    const current = (block.props.blockBorderColor ?? "").trim();
    setBorderColorInput(/^#([0-9a-fA-F]{6})$/.test(current) ? current : "#6b7280");
    setBorderSettingsOpen(true);
  }

  function editNavItemStyle() {
    if (block.type !== "nav") return;
    const currentBgColor = (block.props.navItemBgColor ?? "").trim();
    const currentBorderColor = (block.props.navItemBorderColor ?? "").trim();
    const currentActiveBgColor = (block.props.navItemActiveBgColor ?? "").trim();
    const currentActiveBorderColor = (block.props.navItemActiveBorderColor ?? "").trim();
    const currentActiveTextColor = (block.props.navItemActiveTextColor ?? "").trim();
    const currentMobileButtonBgColor = (block.props.mobileNavButtonBgColor ?? "").trim();
    const currentMobileButtonLineColor = (block.props.mobileNavButtonLineColor ?? "").trim();
    setNavItemBgColorInput(currentBgColor || "#ffffff");
    setNavItemBgOpacityInput(
      typeof block.props.navItemBgOpacity === "number" && Number.isFinite(block.props.navItemBgOpacity)
        ? Math.max(0, Math.min(1, block.props.navItemBgOpacity))
        : 1,
    );
    setNavItemBorderStyleInput((block.props.navItemBorderStyle ?? "solid") as BlockBorderStyle);
    setNavItemBorderColorInput(currentBorderColor || "#6b7280");
    setMobileNavButtonBgColorInput(currentMobileButtonBgColor || "#ffffff");
    setMobileNavButtonBgOpacityInput(
      typeof block.props.mobileNavButtonBgOpacity === "number" && Number.isFinite(block.props.mobileNavButtonBgOpacity)
        ? Math.max(0, Math.min(1, block.props.mobileNavButtonBgOpacity))
        : 0.8,
    );
    setMobileNavButtonBorderStyleInput((block.props.mobileNavButtonBorderStyle ?? "solid") as BlockBorderStyle);
    setMobileNavButtonLineColorInput(currentMobileButtonLineColor || "#334155");
    setNavItemActiveBgColorInput(currentActiveBgColor || "#e5e7eb");
    setNavItemActiveBgOpacityInput(
      typeof block.props.navItemActiveBgOpacity === "number" && Number.isFinite(block.props.navItemActiveBgOpacity)
        ? Math.max(0, Math.min(1, block.props.navItemActiveBgOpacity))
        : 1,
    );
    setNavItemActiveBorderStyleInput((block.props.navItemActiveBorderStyle ?? "solid") as BlockBorderStyle);
    setNavItemActiveBorderColorInput(currentActiveBorderColor || "#111827");
    setNavItemActiveTextColorInput(currentActiveTextColor || "#111827");
    setNavItemStyleDialogOpen(true);
  }

  function editSearchButtonStyle() {
    if (block.type !== "search-bar") return;
    const currentBgColor = (block.props.searchButtonBgColor ?? "").trim();
    const currentBorderColor = (block.props.searchButtonBorderColor ?? "").trim();
    const currentActiveBgColor = (block.props.searchButtonActiveBgColor ?? "").trim();
    const currentActiveBorderColor = (block.props.searchButtonActiveBorderColor ?? "").trim();
    setSearchButtonBgColorInput(currentBgColor || "#ffffff");
    setSearchButtonBgOpacityInput(
      typeof block.props.searchButtonBgOpacity === "number" && Number.isFinite(block.props.searchButtonBgOpacity)
        ? Math.max(0, Math.min(1, block.props.searchButtonBgOpacity))
        : 1,
    );
    setSearchButtonBorderStyleInput((block.props.searchButtonBorderStyle ?? "solid") as BlockBorderStyle);
    setSearchButtonBorderColorInput(currentBorderColor || "#6b7280");
    setSearchButtonActiveBgColorInput(currentActiveBgColor || "#000000");
    setSearchButtonActiveBgOpacityInput(
      typeof block.props.searchButtonActiveBgOpacity === "number" && Number.isFinite(block.props.searchButtonActiveBgOpacity)
        ? Math.max(0, Math.min(1, block.props.searchButtonActiveBgOpacity))
        : 1,
    );
    setSearchButtonActiveBorderStyleInput((block.props.searchButtonActiveBorderStyle ?? "solid") as BlockBorderStyle);
    setSearchButtonActiveBorderColorInput(currentActiveBorderColor || "#111827");
    setSearchButtonStyleDialogOpen(true);
  }

  function editMerchantButtonStyle() {
    if (block.type !== "merchant-list") return;
    const tabBgColor = (block.props.merchantTabButtonBgColor ?? "").trim();
    const tabBorderColor = (block.props.merchantTabButtonBorderColor ?? "").trim();
    const tabActiveBgColor = (block.props.merchantTabButtonActiveBgColor ?? "").trim();
    const tabActiveBorderColor = (block.props.merchantTabButtonActiveBorderColor ?? "").trim();
    const pagerBgColor = (block.props.merchantPagerButtonBgColor ?? "").trim();
    const pagerBorderColor = (block.props.merchantPagerButtonBorderColor ?? "").trim();
    const pagerDisabledBgColor = (block.props.merchantPagerButtonDisabledBgColor ?? "").trim();
    const pagerDisabledBorderColor = (block.props.merchantPagerButtonDisabledBorderColor ?? "").trim();
    setMerchantTabButtonBgColorInput(tabBgColor || "#ffffff");
    setMerchantTabButtonBgOpacityInput(
      typeof block.props.merchantTabButtonBgOpacity === "number" && Number.isFinite(block.props.merchantTabButtonBgOpacity)
        ? Math.max(0, Math.min(1, block.props.merchantTabButtonBgOpacity))
        : 1,
    );
    setMerchantTabButtonBorderStyleInput((block.props.merchantTabButtonBorderStyle ?? "solid") as BlockBorderStyle);
    setMerchantTabButtonBorderColorInput(tabBorderColor || "#cbd5e1");
    setMerchantTabButtonActiveBgColorInput(tabActiveBgColor || "#000000");
    setMerchantTabButtonActiveBgOpacityInput(
      typeof block.props.merchantTabButtonActiveBgOpacity === "number" &&
      Number.isFinite(block.props.merchantTabButtonActiveBgOpacity)
        ? Math.max(0, Math.min(1, block.props.merchantTabButtonActiveBgOpacity))
        : 1,
    );
    setMerchantTabButtonActiveBorderStyleInput(
      (block.props.merchantTabButtonActiveBorderStyle ?? "solid") as BlockBorderStyle,
    );
    setMerchantTabButtonActiveBorderColorInput(tabActiveBorderColor || "#111827");
    setMerchantPagerButtonBgColorInput(pagerBgColor || "#ffffff");
    setMerchantPagerButtonBgOpacityInput(
      typeof block.props.merchantPagerButtonBgOpacity === "number" && Number.isFinite(block.props.merchantPagerButtonBgOpacity)
        ? Math.max(0, Math.min(1, block.props.merchantPagerButtonBgOpacity))
        : 1,
    );
    setMerchantPagerButtonBorderStyleInput((block.props.merchantPagerButtonBorderStyle ?? "solid") as BlockBorderStyle);
    setMerchantPagerButtonBorderColorInput(pagerBorderColor || "#cbd5e1");
    setMerchantPagerButtonDisabledBgColorInput(pagerDisabledBgColor || "#e5e7eb");
    setMerchantPagerButtonDisabledBgOpacityInput(
      typeof block.props.merchantPagerButtonDisabledBgOpacity === "number" &&
      Number.isFinite(block.props.merchantPagerButtonDisabledBgOpacity)
        ? Math.max(0, Math.min(1, block.props.merchantPagerButtonDisabledBgOpacity))
        : 1,
    );
    setMerchantPagerButtonDisabledBorderStyleInput(
      (block.props.merchantPagerButtonDisabledBorderStyle ?? "solid") as BlockBorderStyle,
    );
    setMerchantPagerButtonDisabledBorderColorInput(pagerDisabledBorderColor || "#cbd5e1");
    setMerchantButtonStyleDialogOpen(true);
  }

  function editMerchantCardStyle() {
    if (block.type !== "merchant-list") return;
    const cardBgColor = (block.props.merchantCardBgColor ?? "#f8fafc").trim() || "#f8fafc";
    const cardBgOpacity =
      typeof block.props.merchantCardBgOpacity === "number" && Number.isFinite(block.props.merchantCardBgOpacity)
        ? Math.max(0, Math.min(1, block.props.merchantCardBgOpacity))
        : 1;
    const cardBorderStyle = (block.props.merchantCardBorderStyle ?? "solid") as BlockBorderStyle;
    const cardBorderColor = normalizeNavBorderColor(block.props.merchantCardBorderColor ?? "#cbd5e1", "#cbd5e1");
    const legacyStyle = {
      bgColor: cardBgColor,
      bgOpacity: cardBgOpacity,
      borderStyle: cardBorderStyle,
      borderColor: cardBorderColor,
    };
    const tabs = normalizeMerchantIndustryTabs(block.props.industryTabs);
    const activeTab = tabs.find((item) => item.id === activeMerchantIndustryTabId) ?? tabs[0];
    const targetIndustry = (activeTab?.industry ?? "all") as MerchantIndustryTabIndustry;
    const scopedStyle = resolveMerchantIndustryCardStyle(
      block.props.merchantCardIndustryStyles,
      targetIndustry,
      legacyStyle,
    );
    setMerchantCardStyleIndustryTarget(targetIndustry);
    setMerchantCardBgColorInput(scopedStyle.bgColor);
    setMerchantCardBgOpacityInput(scopedStyle.bgOpacity);
    setMerchantCardBorderStyleInput(scopedStyle.borderStyle);
    setMerchantCardBorderColorInput(scopedStyle.borderColor);
    setMerchantCardStyleDialogOpen(true);
  }

  function onMerchantCardStyleIndustryTargetChange(nextTarget: MerchantIndustryTabIndustry) {
    if (block.type !== "merchant-list") return;
    setMerchantCardStyleIndustryTarget(nextTarget);
    const cardBgColor = (block.props.merchantCardBgColor ?? "#f8fafc").trim() || "#f8fafc";
    const cardBgOpacity =
      typeof block.props.merchantCardBgOpacity === "number" && Number.isFinite(block.props.merchantCardBgOpacity)
        ? Math.max(0, Math.min(1, block.props.merchantCardBgOpacity))
        : 1;
    const cardBorderStyle = (block.props.merchantCardBorderStyle ?? "solid") as BlockBorderStyle;
    const cardBorderColor = normalizeNavBorderColor(block.props.merchantCardBorderColor ?? "#cbd5e1", "#cbd5e1");
    const legacyStyle = {
      bgColor: cardBgColor,
      bgOpacity: cardBgOpacity,
      borderStyle: cardBorderStyle,
      borderColor: cardBorderColor,
    };
    const scopedStyle = resolveMerchantIndustryCardStyle(
      block.props.merchantCardIndustryStyles,
      nextTarget,
      legacyStyle,
    );
    setMerchantCardBgColorInput(scopedStyle.bgColor);
    setMerchantCardBgOpacityInput(scopedStyle.bgOpacity);
    setMerchantCardBorderStyleInput(scopedStyle.borderStyle);
    setMerchantCardBorderColorInput(scopedStyle.borderColor);
  }

  function openLayerSettings() {
    setLayerSettingsOpen(true);
  }

  function applyBorderStyle(style: BlockBorderStyle) {
    onChange({
      blockBorderStyle: style,
      blockBorderColor: borderColorInput.trim() || undefined,
    });
    onRecordColor(borderColorInput);
    setBorderSettingsOpen(false);
  }

  const renderCompactBorderStyleOptions = (
    selectedStyle: BlockBorderStyle,
    borderColor: string,
    onSelectStyle: (style: BlockBorderStyle) => void,
  ) => (
    <div className="grid grid-cols-6 gap-1.5">
      {BLOCK_BORDER_STYLE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`min-w-0 rounded px-1.5 py-1.5 text-[11px] leading-tight whitespace-nowrap ${getBlockBorderClass(option.value)} ${
            selectedStyle === option.value ? "ring-2 ring-black" : "bg-white"
          }`}
          style={getBlockBorderInlineStyle(option.value, borderColor)}
          onClick={() => onSelectStyle(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );

  function applyNavItemStyle() {
    if (block.type !== "nav") return;
    onChange({
      navItemBgColor: navItemBgColorInput.trim() || undefined,
      navItemBgOpacity: Math.max(0, Math.min(1, navItemBgOpacityInput)),
      navItemBorderStyle: navItemBorderStyleInput,
      navItemBorderColor: navItemBorderColorInput.trim() || undefined,
      mobileNavButtonBgColor: mobileNavButtonBgColorInput.trim() || undefined,
      mobileNavButtonBgOpacity: Math.max(0, Math.min(1, mobileNavButtonBgOpacityInput)),
      mobileNavButtonBorderStyle: mobileNavButtonBorderStyleInput,
      mobileNavButtonLineColor: mobileNavButtonLineColorInput.trim() || undefined,
      navItemActiveBgColor: navItemActiveBgColorInput.trim() || undefined,
      navItemActiveBgOpacity: Math.max(0, Math.min(1, navItemActiveBgOpacityInput)),
      navItemActiveBorderStyle: navItemActiveBorderStyleInput,
      navItemActiveBorderColor: navItemActiveBorderColorInput.trim() || undefined,
      navItemActiveTextColor: navItemActiveTextColorInput.trim() || undefined,
    });
    onRecordColor(navItemBgColorInput);
    onRecordColor(navItemBorderColorInput);
    onRecordColor(mobileNavButtonBgColorInput);
    onRecordColor(mobileNavButtonLineColorInput);
    onRecordColor(navItemActiveBgColorInput);
    onRecordColor(navItemActiveBorderColorInput);
    onRecordColor(navItemActiveTextColorInput);
    setNavItemStyleDialogOpen(false);
  }

  function applySearchButtonStyle() {
    if (block.type !== "search-bar") return;
    onChange({
      searchButtonBgColor: searchButtonBgColorInput.trim() || undefined,
      searchButtonBgOpacity: Math.max(0, Math.min(1, searchButtonBgOpacityInput)),
      searchButtonBorderStyle: searchButtonBorderStyleInput,
      searchButtonBorderColor: searchButtonBorderColorInput.trim() || undefined,
      searchButtonActiveBgColor: searchButtonActiveBgColorInput.trim() || undefined,
      searchButtonActiveBgOpacity: Math.max(0, Math.min(1, searchButtonActiveBgOpacityInput)),
      searchButtonActiveBorderStyle: searchButtonActiveBorderStyleInput,
      searchButtonActiveBorderColor: searchButtonActiveBorderColorInput.trim() || undefined,
    });
    onRecordColor(searchButtonBgColorInput);
    onRecordColor(searchButtonBorderColorInput);
    onRecordColor(searchButtonActiveBgColorInput);
    onRecordColor(searchButtonActiveBorderColorInput);
    setSearchButtonStyleDialogOpen(false);
  }

  function applyMerchantButtonStyle() {
    if (block.type !== "merchant-list") return;
    onChange({
      merchantTabButtonBgColor: merchantTabButtonBgColorInput.trim() || undefined,
      merchantTabButtonBgOpacity: Math.max(0, Math.min(1, merchantTabButtonBgOpacityInput)),
      merchantTabButtonBorderStyle: merchantTabButtonBorderStyleInput,
      merchantTabButtonBorderColor: merchantTabButtonBorderColorInput.trim() || undefined,
      merchantTabButtonActiveBgColor: merchantTabButtonActiveBgColorInput.trim() || undefined,
      merchantTabButtonActiveBgOpacity: Math.max(0, Math.min(1, merchantTabButtonActiveBgOpacityInput)),
      merchantTabButtonActiveBorderStyle: merchantTabButtonActiveBorderStyleInput,
      merchantTabButtonActiveBorderColor: merchantTabButtonActiveBorderColorInput.trim() || undefined,
      merchantPagerButtonBgColor: merchantPagerButtonBgColorInput.trim() || undefined,
      merchantPagerButtonBgOpacity: Math.max(0, Math.min(1, merchantPagerButtonBgOpacityInput)),
      merchantPagerButtonBorderStyle: merchantPagerButtonBorderStyleInput,
      merchantPagerButtonBorderColor: merchantPagerButtonBorderColorInput.trim() || undefined,
      merchantPagerButtonDisabledBgColor: merchantPagerButtonDisabledBgColorInput.trim() || undefined,
      merchantPagerButtonDisabledBgOpacity: Math.max(0, Math.min(1, merchantPagerButtonDisabledBgOpacityInput)),
      merchantPagerButtonDisabledBorderStyle: merchantPagerButtonDisabledBorderStyleInput,
      merchantPagerButtonDisabledBorderColor: merchantPagerButtonDisabledBorderColorInput.trim() || undefined,
    });
    onRecordColor(merchantTabButtonBgColorInput);
    onRecordColor(merchantTabButtonBorderColorInput);
    onRecordColor(merchantTabButtonActiveBgColorInput);
    onRecordColor(merchantTabButtonActiveBorderColorInput);
    onRecordColor(merchantPagerButtonBgColorInput);
    onRecordColor(merchantPagerButtonBorderColorInput);
    onRecordColor(merchantPagerButtonDisabledBgColorInput);
    onRecordColor(merchantPagerButtonDisabledBorderColorInput);
    setMerchantButtonStyleDialogOpen(false);
  }

  function applyMerchantCardStyle() {
    if (block.type !== "merchant-list") return;
    const nextBgColor = merchantCardBgColorInput.trim() || undefined;
    const nextBgOpacity = Math.max(0, Math.min(1, merchantCardBgOpacityInput));
    const nextBorderColor = merchantCardBorderColorInput.trim() || undefined;
    const nextIndustryStyles: Partial<Record<MerchantIndustryTabIndustry, MerchantCardIndustryStyleConfig>> = {
      ...(block.props.merchantCardIndustryStyles ?? {}),
      [merchantCardStyleIndustryTarget]: {
        bgColor: nextBgColor,
        bgOpacity: nextBgOpacity,
        borderStyle: merchantCardBorderStyleInput,
        borderColor: nextBorderColor,
      },
    };
    onChange({
      merchantCardIndustryStyles: nextIndustryStyles,
      ...(merchantCardStyleIndustryTarget === "all"
        ? {
            merchantCardBgColor: nextBgColor,
            merchantCardBgOpacity: nextBgOpacity,
            merchantCardBorderStyle: merchantCardBorderStyleInput,
            merchantCardBorderColor: nextBorderColor,
          }
        : {}),
    });
    onRecordColor(merchantCardBgColorInput);
    onRecordColor(merchantCardBorderColorInput);
    setMerchantCardStyleDialogOpen(false);
  }

  function merchantCardTypographyDefaults(role: MerchantCardTextRole) {
    if (role === "name") {
      return { fontSize: 16, fontColor: "#0f172a", fontWeight: "bold" as const };
    }
    return { fontSize: 12, fontColor: "#64748b", fontWeight: "normal" as const };
  }

  function loadMerchantCardTypographyInputs(role: MerchantCardTextRole) {
    if (block.type !== "merchant-list") return;
    const defaults = merchantCardTypographyDefaults(role);
    const style = (block.props.merchantCardTypography?.[role] ?? {}) as TypographyEditableProps;
    setMerchantCardTypoFontFamilyInput((style.fontFamily ?? "").trim());
    setMerchantCardTypoFontSizeInput(
      typeof style.fontSize === "number" && Number.isFinite(style.fontSize) && style.fontSize > 0
        ? clampMerchantCardTypographyFontSizeInputToString(style.fontSize)
        : String(defaults.fontSize),
    );
    setMerchantCardTypoFontColorInput((style.fontColor ?? "").trim() || defaults.fontColor);
    setMerchantCardTypoBoldInput((style.fontWeight ?? defaults.fontWeight) === "bold");
    setMerchantCardTypoItalicInput((style.fontStyle ?? "normal") === "italic");
    setMerchantCardTypoUnderlineInput((style.textDecoration ?? "none") === "underline");
  }

  function loadMerchantCardTypographyLayoutInputs() {
    if (block.type !== "merchant-list") return;
    setMerchantCardTypoLayoutDraft(normalizeMerchantCardTextLayoutConfig(block.props.merchantCardTextLayout));
    setMerchantCardTypoTextBoxVisibleInput(block.props.merchantCardTextBoxVisible === true);
  }

  function editMerchantCardTypography() {
    if (block.type !== "merchant-list") return;
    const target: MerchantCardTextRole = "name";
    setMerchantCardTypographyTarget(target);
    loadMerchantCardTypographyInputs(target);
    loadMerchantCardTypographyLayoutInputs();
    setMerchantCardTypographyDialogOpen(true);
  }

  function onMerchantCardTypographyTargetChange(nextTarget: MerchantCardTextRole) {
    if (block.type !== "merchant-list") return;
    setMerchantCardTypographyTarget(nextTarget);
    loadMerchantCardTypographyInputs(nextTarget);
  }

  function applyMerchantCardTypography() {
    if (block.type !== "merchant-list") return;
    const nextStyle: TypographyEditableProps = {
      fontFamily: merchantCardTypoFontFamilyInput.trim() || undefined,
      fontSize: clampMerchantCardTypographyFontSizeInput(merchantCardTypoFontSizeInput),
      fontColor: merchantCardTypoFontColorInput.trim() || undefined,
      fontWeight: merchantCardTypoBoldInput ? "bold" : "normal",
      fontStyle: merchantCardTypoItalicInput ? "italic" : "normal",
      textDecoration: merchantCardTypoUnderlineInput ? "underline" : "none",
    };
    onChange({
      merchantCardTypography: {
        ...(block.props.merchantCardTypography ?? {}),
        [merchantCardTypographyTarget]: nextStyle,
      },
      merchantCardTextLayout: normalizeMerchantCardTextLayoutConfig(merchantCardTypoLayoutDraft),
      merchantCardTextBoxVisible: merchantCardTypoTextBoxVisibleInput,
    });
    onRecordColor(merchantCardTypoFontColorInput);
    setMerchantCardTypographyDialogOpen(false);
  }

  function startMerchantCardTypographyPreviewDrag(role: MerchantCardTextRole, event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (merchantCardTypographyTarget !== role) {
      onMerchantCardTypographyTargetChange(role);
    }
    const start = resolveMerchantCardTextPosition(merchantCardTypoLayoutDraft, role);
    merchantCardTypographyDragRef.current = {
      role,
      startX: event.clientX,
      startY: event.clientY,
      originX: start.x,
      originY: start.y,
    };
    const onMove = (moveEvent: MouseEvent) => {
      const dragging = merchantCardTypographyDragRef.current;
      if (!dragging) return;
      const dx = Math.round(moveEvent.clientX - dragging.startX);
      const dy = Math.round(moveEvent.clientY - dragging.startY);
      setMerchantCardTypoLayoutDraft((prev) => ({
        ...normalizeMerchantCardTextLayoutConfig(prev),
        [dragging.role]: {
          x: Math.max(0, dragging.originX + dx),
          y: Math.max(0, dragging.originY + dy),
        },
      }));
    };
    const onUp = () => {
      merchantCardTypographyDragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const isMobileInlineEditorViewport = previewViewport === "mobile";
  const mobileFitScreenWidth = isMobileInlineEditorViewport && block.props.mobileFitScreenWidth === true;
  const shellClass =
    block.type === "hero"
      ? `${mobileFitScreenWidth ? "mobile-editor-fit-screen-section " : ""}relative bg-white mx-auto`
      : `${mobileFitScreenWidth ? "mobile-editor-fit-screen-section " : ""}relative max-w-6xl mx-auto px-6 py-6`;
  const borderClass = getBlockBorderClass(block.props.blockBorderStyle);
  const borderInlineStyle = getBlockBorderInlineStyle(block.props.blockBorderStyle, block.props.blockBorderColor);
  const previewBorderInlineStyle: CSSProperties = mobileFitScreenWidth
    ? {
        ...borderInlineStyle,
        borderLeftWidth: 0,
        borderRightWidth: 0,
        borderTopLeftRadius: 0,
        borderTopRightRadius: 0,
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
      }
    : borderInlineStyle;
  const cardClass =
    block.type === "hero"
      ? `${mobileFitScreenWidth ? "mobile-editor-fit-screen-card " : ""}max-w-6xl mx-auto px-6 py-10 pointer-events-auto`
      : `${mobileFitScreenWidth ? "mobile-editor-fit-screen-card " : ""}bg-white rounded-xl shadow-sm p-6 pointer-events-auto ${isSelected ? "overflow-visible" : "overflow-hidden"} ${borderClass}`;
  const blockBackgroundStyle = getBackgroundStyle({
    imageUrl: block.props.bgImageUrl,
    fillMode: block.props.bgFillMode,
    position: block.props.bgPosition,
    color: block.props.bgColor,
    opacity: block.props.bgOpacity,
    imageOpacity: block.props.bgImageOpacity,
    colorOpacity: block.props.bgColorOpacity,
  });
  const selectedEditorMinWidth =
    isMobileInlineEditorViewport
      ? "min(760px, calc(100vw - 2rem))"
      : block.type === "merchant-list" || block.type === "search-bar"
        ? "min(980px, calc(100vw - 2rem))"
        : block.type === "product" || block.type === "coupon" || block.type === "google-reviews" || block.type === "booking" || block.type === "poll"
          ? "min(760px, calc(100vw - 2rem))"
          : "min(760px, calc(100vw - 2rem))";
  const selectedEditorPreferredWidth =
    isMobileInlineEditorViewport
      ? "min(840px, calc(100vw - 2rem))"
      : block.type === "merchant-list" || block.type === "search-bar"
        ? "min(980px, calc(100vw - 2rem))"
        : block.type === "product" || block.type === "coupon" || block.type === "google-reviews" || block.type === "booking" || block.type === "poll"
          ? "min(820px, calc(100vw - 2rem))"
          : undefined;
  const blockWidth = draftResize?.width ?? normalizeBlockWidth(block.props.blockWidth, block.type);
  const blockHeight = draftResize?.height ?? normalizeBlockHeight(block.props.blockHeight, block.type);
  const isDraggingSource = draggingBlockId === block.id;
  const isBlockLocked = block.props.blockLocked === true;
  const offsetX =
    typeof block.props.blockOffsetX === "number" && Number.isFinite(block.props.blockOffsetX)
      ? Math.round(block.props.blockOffsetX)
      : 0;
  const offsetY =
    typeof block.props.blockOffsetY === "number" && Number.isFinite(block.props.blockOffsetY)
      ? Math.round(block.props.blockOffsetY)
      : 0;
  const effectiveOffsetX = mobileFitScreenWidth ? 0 : draftResize?.offsetX ?? offsetX;
  const effectiveOffsetY = (draftResize?.offsetY ?? offsetY) + previewOffsetY;
  const isEditingBlock = isSelected || hasOverlayOpen;
  const offsetStyle = {
    position: "relative" as const,
    transform:
      effectiveOffsetX || effectiveOffsetY ? `translate(${effectiveOffsetX}px, ${effectiveOffsetY}px)` : undefined,
    zIndex: isDraggingSource ? 10000 : isEditingBlock ? 9999 : undefined,
  };
  const blockSizeStyle = {
    width: mobileFitScreenWidth ? "100%" : blockWidth ? `${blockWidth}px` : undefined,
    height: blockHeight ? `${blockHeight}px` : undefined,
  };
  const blockPreviewOverflowStyle: CSSProperties = isEditingBlock
    ? { overflow: "visible" }
    : blockHeight
      ? block.type === "poll"
        ? { overflowX: "hidden", overflowY: "auto" }
        : { overflow: "auto" }
      : block.type === "search-bar"
        ? { overflow: "visible" }
        : {};
  const blockPreviewShellStyle = {
    ...blockBackgroundStyle,
    ...blockSizeStyle,
    ...blockPreviewOverflowStyle,
    ...previewBorderInlineStyle,
  };
  const handleToggleMobileFitScreenWidth = () => {
    const nextValue = block.props.mobileFitScreenWidth !== true;
    onChange({
      mobileFitScreenWidth: nextValue,
      ...(nextValue ? { blockOffsetX: 0 } : {}),
    });
  };
  const blockOpenByButton = block.props.blockOpenMode === "button";
  const toggleBlockOpenMode = () => {
    onChange({
      blockOpenMode: blockOpenByButton ? undefined : "button",
    });
  };
  function renderSelectedEditor(content: ReactNode) {
    return (
      <div
        data-editor-panel
        className={`relative pointer-events-auto max-w-[calc(100vw-2rem)] rounded-xl border border-white/70 p-3 shadow-[0_12px_32px_rgba(15,23,42,0.14)] ${selectedEditorPreferredWidth ? "w-full" : "w-max"}`}
        style={{
          minWidth: selectedEditorMinWidth,
          width: selectedEditorPreferredWidth,
          backgroundColor: "rgba(255, 255, 255, 0.78)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
        }}
      >
        {content}
      </div>
    );
  }
  const resizeHandles = isBlockLocked ? null : (
    <>
      {!mobileFitScreenWidth ? (
        <>
          <div
            className="absolute top-0 left-0 h-full w-2 cursor-ew-resize z-10"
            title={"拖拽调整宽度"}
            onMouseDown={(event) => beginResize("left", event)}
          />
          <div
            className="absolute top-0 right-0 h-full w-2 cursor-ew-resize z-10"
            title={"拖拽调整宽度"}
            onMouseDown={(event) => beginResize("right", event)}
          />
        </>
      ) : null}
      <div
        className="absolute top-0 left-0 w-full h-2 cursor-ns-resize z-10"
        title={"拖拽调整高度"}
        onMouseDown={(event) => beginResize("top", event)}
      />
      <div
        className="absolute bottom-0 left-0 w-full h-2 cursor-ns-resize z-10"
        title={"拖拽调整高度"}
        onMouseDown={(event) => beginResize("bottom", event)}
      />
    </>
  );
  const imageDialog = imageDialogOpen ? renderOverlay(
    <div data-editor-overlay className="fixed inset-0 z-[2147483600] bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-xl border p-4 space-y-3">
        <div className="text-sm font-semibold">{"插入图片"}</div>
        <div className="space-y-1">
          <div className="text-xs text-gray-600">图片 URL</div>
          <BufferedEditorInput
            className="border p-2 rounded w-full text-sm"
            value={imageUrlInput}
            placeholder="https://example.com/bg.jpg"
            onChange={(e) => setImageUrlInput(e.target.value)}
            disabled={imageUploading}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <label
            className={`px-3 py-2 rounded border bg-white text-sm ${
              imageUploading ? "cursor-wait opacity-60" : "cursor-pointer hover:bg-gray-50"
            }`}
          >
            {imageUploading ? "正在上传..." : "上传图片"}
            <BufferedEditorInput
              ref={imageInputRef}
              className="hidden"
              type="file"
              accept="image/*"
              disabled={imageUploading}
              onChange={onUploadImage}
            />
          </label>
          <button
            className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            disabled={imageUploading}
            onClick={clearImage}
          >
            {"清除图片"}
          </button>
          <button
            className="px-3 py-2 rounded bg-black text-white text-sm disabled:cursor-not-allowed disabled:opacity-50"
            disabled={imageUploading}
            onClick={applyImageUrl}
          >
            {"应用"}
          </button>
          <button
            className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            disabled={imageUploading}
            onClick={() => setImageDialogOpen(false)}
          >
            {"取消"}
          </button>
        </div>
        <div className="text-xs text-gray-500">
          {imageUploading ? "正在上传图片，请勿关闭窗口。" : "选择文件后会立即上传并应用到区块背景。"}
        </div>
      </div>
    </div>
  ) : null;
  const imageSettingsDialog = imageSettingsOpen ? renderOverlay(
    <div data-editor-overlay className="fixed inset-0 z-[2147483600] bg-transparent flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-xl border p-4 space-y-3">
        <div className="text-sm font-semibold">{"图片设置"}</div>
        <div className="space-y-1">
          <div className="text-xs text-gray-600">{"填充方式"}</div>
          <select
            className="border p-2 rounded w-full text-sm"
            value={settingsFillMode}
            onChange={(e) => setSettingsFillMode(e.target.value as ImageFillMode)}
          >
            {IMAGE_FILL_VALUES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-gray-600">{"图片透明度："}{settingsImageOpacity.toFixed(2)}</div>
          <BufferedEditorInput
            className="w-full"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={settingsImageOpacity}
            onChange={(e) => setSettingsImageOpacity(Number(e.target.value))}
          />
        </div>
        <div className="space-y-1">
          <div className="text-xs text-gray-600">{"颜色透明度："}{settingsColorOpacity.toFixed(2)}</div>
          <BufferedEditorInput
            className="w-full"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={settingsColorOpacity}
            onChange={(e) => setSettingsColorOpacity(Number(e.target.value))}
          />
        </div>
        <div className="space-y-1">
          <div className="text-xs text-gray-600">{"背景位置"}</div>
          <select
            className="border p-2 rounded w-full text-sm"
            value={settingsPosition}
            onChange={(e) => setSettingsPosition(e.target.value)}
          >
            {!BACKGROUND_POSITION_OPTIONS.includes(settingsPosition) ? (
              <option value={settingsPosition}>{settingsPosition}</option>
            ) : null}
            {BACKGROUND_POSITION_OPTIONS.map((position) => (
              <option key={position} value={position}>
                {position}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-gray-600">{"色彩（可选）"}</div>
          <ColorOrGradientPicker value={settingsColor} onChange={setSettingsColor} />
          <RecentColorBar
            colors={recentColors}
                onClear={onClearRecentColors}
                onPick={(color) => setSettingsColor(color)}
                allowGradients
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="px-3 py-2 rounded bg-black text-white text-sm"
            onClick={applyImageSettings}
          >
            {"应用"}
          </button>
          <button
            className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
            onClick={() => setImageSettingsOpen(false)}
          >
            {"取消"}
          </button>
        </div>
      </div>
    </div>
  ) : null;
  const borderSettingsDialog = borderSettingsOpen ? renderOverlay(
    <div data-editor-overlay className="fixed inset-0 z-[2147483600] bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-xl border p-4 space-y-3">
        <div className="text-sm font-semibold">{"边框样式"}</div>
        <div className="space-y-1">
          <div className="text-xs text-gray-600">{"颜色"}</div>
          <ColorOrGradientPicker value={borderColorInput} onChange={setBorderColorInput} />
          <RecentColorBar
            colors={recentColors}
                onClear={onClearRecentColors}
                onPick={(color) => setBorderColorInput(color)}
          />
        </div>
        {renderCompactBorderStyleOptions(
          ((block.props.blockBorderStyle ?? "glass") === "soft" ? "glass" : (block.props.blockBorderStyle ?? "glass")) as BlockBorderStyle,
          borderColorInput,
          applyBorderStyle,
        )}
        <div className="flex justify-end">
          <button
            className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
            onClick={() => setBorderSettingsOpen(false)}
          >
            {"取消"}
          </button>
        </div>
      </div>
    </div>
  ) : null;
  const navItemStyleDialog = navItemStyleDialogOpen ? renderOverlay(
    <div data-editor-overlay className="fixed inset-0 z-[2147483600] bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-5xl bg-white rounded-xl border p-4 space-y-3">
        <div className="text-sm font-semibold">栏目样式</div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-3 rounded-lg border p-3">
            <div className="text-xs font-semibold text-gray-700">默认样式</div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">颜色</div>
              <ColorOrGradientPicker value={navItemBgColorInput} onChange={setNavItemBgColorInput} />
              <RecentColorBar
                colors={recentColors}
                    onClear={onClearRecentColors}
                    onPick={(color) => setNavItemBgColorInput(color)}
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">透明度：{navItemBgOpacityInput.toFixed(2)}</div>
              <BufferedEditorInput
                className="w-full"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={navItemBgOpacityInput}
                onChange={(e) => setNavItemBgOpacityInput(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">栏目框样式</div>
              {renderCompactBorderStyleOptions(navItemBorderStyleInput, navItemBorderColorInput, setNavItemBorderStyleInput)}
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">栏目框颜色</div>
              <ColorOrGradientPicker value={navItemBorderColorInput} onChange={setNavItemBorderColorInput} />
              <RecentColorBar
                colors={recentColors}
                    onClear={onClearRecentColors}
                    onPick={(color) => setNavItemBorderColorInput(color)}
              />
            </div>
            <div className="space-y-2 rounded-lg border border-dashed p-3">
              <div className="text-xs font-semibold text-gray-700">手机隐藏按钮</div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${getBlockBorderClass(
                    mobileNavButtonBorderStyleInput,
                  )}`}
                  style={{
                    ...getBlockBorderInlineStyle(mobileNavButtonBorderStyleInput, "#cbd5e1"),
                    ...getColorLayerStyle(mobileNavButtonBgColorInput, mobileNavButtonBgOpacityInput),
                  }}
                  aria-label="手机隐藏按钮预览"
                >
                  <span className="inline-flex flex-col items-center justify-center gap-1.5">
                    <span className="block h-0.5 w-4 rounded-full" style={{ backgroundColor: mobileNavButtonLineColorInput }} />
                    <span className="block h-0.5 w-4 rounded-full" style={{ backgroundColor: mobileNavButtonLineColorInput }} />
                    <span className="block h-0.5 w-4 rounded-full" style={{ backgroundColor: mobileNavButtonLineColorInput }} />
                  </span>
                </button>
                <div className="text-xs text-gray-500">隐藏式导航左侧按钮预览</div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-gray-600">按钮底色</div>
                <ColorOrGradientPicker value={mobileNavButtonBgColorInput} onChange={setMobileNavButtonBgColorInput} allowGradient={false} />
                <RecentColorBar
                  colors={recentColors}
                  onClear={onClearRecentColors}
                  onPick={(color) => setMobileNavButtonBgColorInput(color)}
                  allowGradients={false}
                />
              </div>
              <div className="space-y-1">
                <div className="text-xs text-gray-600">按钮底色透明度：{mobileNavButtonBgOpacityInput.toFixed(2)}</div>
                <BufferedEditorInput
                  className="w-full"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={mobileNavButtonBgOpacityInput}
                  onChange={(e) => setMobileNavButtonBgOpacityInput(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1">
                <div className="text-xs text-gray-600">按钮边框样式</div>
                {renderCompactBorderStyleOptions(mobileNavButtonBorderStyleInput, "#cbd5e1", setMobileNavButtonBorderStyleInput)}
              </div>
              <div className="space-y-1">
                <div className="text-xs text-gray-600">横杠颜色</div>
                <ColorOrGradientPicker value={mobileNavButtonLineColorInput} onChange={setMobileNavButtonLineColorInput} allowGradient={false} />
                <RecentColorBar
                  colors={recentColors}
                  onClear={onClearRecentColors}
                  onPick={(color) => setMobileNavButtonLineColorInput(color)}
                  allowGradients={false}
                />
              </div>
            </div>
          </div>
          <div className="space-y-3 rounded-lg border p-3">
            <div className="text-xs font-semibold text-gray-700">选中样式</div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">选中背景色</div>
              <ColorOrGradientPicker value={navItemActiveBgColorInput} onChange={setNavItemActiveBgColorInput} />
              <RecentColorBar
                colors={recentColors}
                    onClear={onClearRecentColors}
                    onPick={(color) => setNavItemActiveBgColorInput(color)}
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">选中透明度：{navItemActiveBgOpacityInput.toFixed(2)}</div>
              <BufferedEditorInput
                className="w-full"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={navItemActiveBgOpacityInput}
                onChange={(e) => setNavItemActiveBgOpacityInput(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">选中栏目框样式</div>
              {renderCompactBorderStyleOptions(
                navItemActiveBorderStyleInput,
                navItemActiveBorderColorInput,
                setNavItemActiveBorderStyleInput,
              )}
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">选中栏目框颜色</div>
              <ColorOrGradientPicker value={navItemActiveBorderColorInput} onChange={setNavItemActiveBorderColorInput} />
              <RecentColorBar
                colors={recentColors}
                    onClear={onClearRecentColors}
                    onPick={(color) => setNavItemActiveBorderColorInput(color)}
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">选中文字颜色</div>
              <ColorOrGradientPicker value={navItemActiveTextColorInput} onChange={setNavItemActiveTextColorInput} />
              <RecentColorBar
                colors={recentColors}
                    onClear={onClearRecentColors}
                    onPick={(color) => setNavItemActiveTextColorInput(color)}
              />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="px-3 py-2 rounded bg-black text-white text-sm" onClick={applyNavItemStyle}>
            应用
          </button>
          <button
            type="button"
            className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
            onClick={() => setNavItemStyleDialogOpen(false)}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  ) : null;
  const searchButtonStyleDialog = searchButtonStyleDialogOpen ? renderOverlay(
    <div data-editor-overlay className="fixed inset-0 z-[2147483600] bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-5xl bg-white rounded-xl border p-4 space-y-3">
        <div className="text-sm font-semibold">按钮样式</div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-3 rounded-lg border p-3">
            <div className="text-xs font-semibold text-gray-700">定位按钮样式</div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">颜色</div>
              <ColorOrGradientPicker value={searchButtonBgColorInput} onChange={setSearchButtonBgColorInput} />
              <RecentColorBar
                colors={recentColors}
                onClear={onClearRecentColors}
                onPick={(color) => setSearchButtonBgColorInput(color)}
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">透明度：{searchButtonBgOpacityInput.toFixed(2)}</div>
              <BufferedEditorInput
                className="w-full"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={searchButtonBgOpacityInput}
                onChange={(e) => setSearchButtonBgOpacityInput(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">按钮框样式</div>
              {renderCompactBorderStyleOptions(
                searchButtonBorderStyleInput,
                searchButtonBorderColorInput,
                setSearchButtonBorderStyleInput,
              )}
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">按钮框颜色</div>
              <ColorOrGradientPicker value={searchButtonBorderColorInput} onChange={setSearchButtonBorderColorInput} />
              <RecentColorBar
                colors={recentColors}
                onClear={onClearRecentColors}
                onPick={(color) => setSearchButtonBorderColorInput(color)}
              />
            </div>
          </div>
          <div className="space-y-3 rounded-lg border p-3">
            <div className="text-xs font-semibold text-gray-700">搜索按钮样式</div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">颜色</div>
              <ColorOrGradientPicker value={searchButtonActiveBgColorInput} onChange={setSearchButtonActiveBgColorInput} />
              <RecentColorBar
                colors={recentColors}
                onClear={onClearRecentColors}
                onPick={(color) => setSearchButtonActiveBgColorInput(color)}
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">透明度：{searchButtonActiveBgOpacityInput.toFixed(2)}</div>
              <BufferedEditorInput
                className="w-full"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={searchButtonActiveBgOpacityInput}
                onChange={(e) => setSearchButtonActiveBgOpacityInput(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">按钮边框样式</div>
              {renderCompactBorderStyleOptions(
                searchButtonActiveBorderStyleInput,
                searchButtonActiveBorderColorInput,
                setSearchButtonActiveBorderStyleInput,
              )}
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">按钮边框颜色</div>
              <ColorOrGradientPicker value={searchButtonActiveBorderColorInput} onChange={setSearchButtonActiveBorderColorInput} />
              <RecentColorBar
                colors={recentColors}
                onClear={onClearRecentColors}
                onPick={(color) => setSearchButtonActiveBorderColorInput(color)}
              />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="px-3 py-2 rounded bg-black text-white text-sm" onClick={applySearchButtonStyle}>
            应用
          </button>
          <button
            type="button"
            className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
            onClick={() => setSearchButtonStyleDialogOpen(false)}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  ) : null;
  const merchantButtonStyleDialog = merchantButtonStyleDialogOpen ? renderOverlay(
    <div data-editor-overlay className="fixed inset-0 z-[2147483600] bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-6xl bg-white rounded-xl border p-4 space-y-3">
        <div className="text-sm font-semibold">按钮样式</div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-3 rounded-lg border p-3">
            <div className="text-xs font-semibold text-gray-700">标签按钮样式</div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">颜色</div>
              <ColorOrGradientPicker value={merchantTabButtonBgColorInput} onChange={setMerchantTabButtonBgColorInput} />
              <RecentColorBar
                colors={recentColors}
                onClear={onClearRecentColors}
                onPick={(color) => setMerchantTabButtonBgColorInput(color)}
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">透明度：{merchantTabButtonBgOpacityInput.toFixed(2)}</div>
              <BufferedEditorInput
                className="w-full"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={merchantTabButtonBgOpacityInput}
                onChange={(e) => setMerchantTabButtonBgOpacityInput(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">按钮边框样式</div>
              {renderCompactBorderStyleOptions(
                merchantTabButtonBorderStyleInput,
                merchantTabButtonBorderColorInput,
                setMerchantTabButtonBorderStyleInput,
              )}
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">按钮边框颜色</div>
              <ColorOrGradientPicker value={merchantTabButtonBorderColorInput} onChange={setMerchantTabButtonBorderColorInput} />
              <RecentColorBar
                colors={recentColors}
                onClear={onClearRecentColors}
                onPick={(color) => setMerchantTabButtonBorderColorInput(color)}
              />
            </div>
          </div>
          <div className="space-y-3 rounded-lg border p-3">
            <div className="text-xs font-semibold text-gray-700">选中标签样式</div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">颜色</div>
              <ColorOrGradientPicker value={merchantTabButtonActiveBgColorInput} onChange={setMerchantTabButtonActiveBgColorInput} />
              <RecentColorBar
                colors={recentColors}
                onClear={onClearRecentColors}
                onPick={(color) => setMerchantTabButtonActiveBgColorInput(color)}
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">透明度：{merchantTabButtonActiveBgOpacityInput.toFixed(2)}</div>
              <BufferedEditorInput
                className="w-full"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={merchantTabButtonActiveBgOpacityInput}
                onChange={(e) => setMerchantTabButtonActiveBgOpacityInput(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">按钮边框样式</div>
              {renderCompactBorderStyleOptions(
                merchantTabButtonActiveBorderStyleInput,
                merchantTabButtonActiveBorderColorInput,
                setMerchantTabButtonActiveBorderStyleInput,
              )}
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">按钮边框颜色</div>
              <ColorOrGradientPicker value={merchantTabButtonActiveBorderColorInput} onChange={setMerchantTabButtonActiveBorderColorInput} />
              <RecentColorBar
                colors={recentColors}
                onClear={onClearRecentColors}
                onPick={(color) => setMerchantTabButtonActiveBorderColorInput(color)}
              />
            </div>
          </div>
          <div className="space-y-3 rounded-lg border p-3">
            <div className="text-xs font-semibold text-gray-700">分页按钮样式</div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">颜色</div>
              <ColorOrGradientPicker value={merchantPagerButtonBgColorInput} onChange={setMerchantPagerButtonBgColorInput} />
              <RecentColorBar
                colors={recentColors}
                onClear={onClearRecentColors}
                onPick={(color) => setMerchantPagerButtonBgColorInput(color)}
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">透明度：{merchantPagerButtonBgOpacityInput.toFixed(2)}</div>
              <BufferedEditorInput
                className="w-full"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={merchantPagerButtonBgOpacityInput}
                onChange={(e) => setMerchantPagerButtonBgOpacityInput(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">按钮边框样式</div>
              {renderCompactBorderStyleOptions(
                merchantPagerButtonBorderStyleInput,
                merchantPagerButtonBorderColorInput,
                setMerchantPagerButtonBorderStyleInput,
              )}
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">按钮边框颜色</div>
              <ColorOrGradientPicker value={merchantPagerButtonBorderColorInput} onChange={setMerchantPagerButtonBorderColorInput} />
              <RecentColorBar
                colors={recentColors}
                onClear={onClearRecentColors}
                onPick={(color) => setMerchantPagerButtonBorderColorInput(color)}
              />
            </div>
          </div>
          <div className="space-y-3 rounded-lg border p-3">
            <div className="text-xs font-semibold text-gray-700">分页禁用样式</div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">颜色</div>
              <ColorOrGradientPicker value={merchantPagerButtonDisabledBgColorInput} onChange={setMerchantPagerButtonDisabledBgColorInput} />
              <RecentColorBar
                colors={recentColors}
                onClear={onClearRecentColors}
                onPick={(color) => setMerchantPagerButtonDisabledBgColorInput(color)}
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">透明度：{merchantPagerButtonDisabledBgOpacityInput.toFixed(2)}</div>
              <BufferedEditorInput
                className="w-full"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={merchantPagerButtonDisabledBgOpacityInput}
                onChange={(e) => setMerchantPagerButtonDisabledBgOpacityInput(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">按钮边框样式</div>
              {renderCompactBorderStyleOptions(
                merchantPagerButtonDisabledBorderStyleInput,
                merchantPagerButtonDisabledBorderColorInput,
                setMerchantPagerButtonDisabledBorderStyleInput,
              )}
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">按钮边框颜色</div>
              <ColorOrGradientPicker
                value={merchantPagerButtonDisabledBorderColorInput}
                onChange={setMerchantPagerButtonDisabledBorderColorInput}
              />
              <RecentColorBar
                colors={recentColors}
                onClear={onClearRecentColors}
                onPick={(color) => setMerchantPagerButtonDisabledBorderColorInput(color)}
              />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="px-3 py-2 rounded bg-black text-white text-sm" onClick={applyMerchantButtonStyle}>
            应用
          </button>
          <button
            type="button"
            className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
            onClick={() => setMerchantButtonStyleDialogOpen(false)}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  ) : null;
  const merchantCardStyleDialog = merchantCardStyleDialogOpen ? renderOverlay(
    <div data-editor-overlay className="fixed inset-0 z-[2147483600] bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl bg-white rounded-xl border p-4 space-y-3">
        <div className="text-sm font-semibold">商户卡片样式</div>
        <div className="grid grid-cols-1 sm:grid-cols-[96px_minmax(0,1fr)] gap-2 items-center">
          <div className="text-xs text-gray-600">行业</div>
          <select
            className="w-full rounded border px-2 py-2 text-sm bg-white"
            value={merchantCardStyleIndustryTarget}
            onChange={(e) => onMerchantCardStyleIndustryTargetChange(e.target.value as MerchantIndustryTabIndustry)}
          >
            <option value="all">推荐（全部）</option>
            {MERCHANT_INDUSTRY_OPTIONS.map((industry) => (
              <option key={`merchant-card-style-${industry}`} value={industry}>
                {industry}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-3 rounded-lg border p-3">
            <div className="space-y-1">
              <div className="text-xs text-gray-600">颜色</div>
              <ColorOrGradientPicker value={merchantCardBgColorInput} onChange={setMerchantCardBgColorInput} />
              <RecentColorBar
                colors={recentColors}
                onClear={onClearRecentColors}
                onPick={(color) => setMerchantCardBgColorInput(color)}
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">透明度：{merchantCardBgOpacityInput.toFixed(2)}</div>
              <BufferedEditorInput
                className="w-full"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={merchantCardBgOpacityInput}
                onChange={(e) => setMerchantCardBgOpacityInput(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="space-y-3 rounded-lg border p-3">
            <div className="space-y-1">
              <div className="text-xs text-gray-600">商户卡片样式</div>
              {renderCompactBorderStyleOptions(
                merchantCardBorderStyleInput,
                merchantCardBorderColorInput,
                setMerchantCardBorderStyleInput,
              )}
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">商户卡片颜色</div>
              <ColorOrGradientPicker value={merchantCardBorderColorInput} onChange={setMerchantCardBorderColorInput} />
              <RecentColorBar
                colors={recentColors}
                onClear={onClearRecentColors}
                onPick={(color) => setMerchantCardBorderColorInput(color)}
              />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="px-3 py-2 rounded bg-black text-white text-sm" onClick={applyMerchantCardStyle}>
            应用
          </button>
          <button
            type="button"
            className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
            onClick={() => setMerchantCardStyleDialogOpen(false)}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  ) : null;
  const merchantCardTypographyMap =
    block.type === "merchant-list"
      ? ((block.props.merchantCardTypography ?? {}) as Partial<Record<MerchantCardTextRole, TypographyEditableProps>>)
      : {};
  const merchantCardTypographyDraftStyle = buildTypographyInlineStyle({
    fontFamily: merchantCardTypoFontFamilyInput.trim() || undefined,
    fontSize: clampMerchantCardTypographyFontSizeInput(merchantCardTypoFontSizeInput),
    fontColor: merchantCardTypoFontColorInput.trim() || undefined,
    fontWeight: merchantCardTypoBoldInput ? "bold" : "normal",
    fontStyle: merchantCardTypoItalicInput ? "italic" : "normal",
    textDecoration: merchantCardTypoUnderlineInput ? "underline" : "none",
  });
  const merchantCardNameStylePreview =
    merchantCardTypographyTarget === "name"
      ? merchantCardTypographyDraftStyle
      : buildTypographyInlineStyle(merchantCardTypographyMap.name);
  const merchantCardIndustryStylePreview =
    merchantCardTypographyTarget === "industry"
      ? merchantCardTypographyDraftStyle
      : buildTypographyInlineStyle(merchantCardTypographyMap.industry);
  const merchantCardDomainStylePreview =
    merchantCardTypographyTarget === "domain"
      ? merchantCardTypographyDraftStyle
      : buildTypographyInlineStyle(merchantCardTypographyMap.domain);
  const merchantCardTextLayoutDraftResolved = normalizeMerchantCardTextLayoutConfig(merchantCardTypoLayoutDraft);
  const merchantCardNamePreviewPosition = resolveMerchantCardTextPosition(merchantCardTextLayoutDraftResolved, "name");
  const merchantCardIndustryPreviewPosition = resolveMerchantCardTextPosition(merchantCardTextLayoutDraftResolved, "industry");
  const merchantCardDomainPreviewPosition = resolveMerchantCardTextPosition(merchantCardTextLayoutDraftResolved, "domain");
  const merchantCardPreviewTextBoxClass = merchantCardTypoTextBoxVisibleInput
    ? "inline-flex w-fit max-w-full rounded border border-slate-300 bg-white/90 px-1.5 py-0.5"
    : "inline-flex w-fit max-w-full";
  const merchantCardTypographyDialog = merchantCardTypographyDialogOpen ? renderOverlay(
    <div data-editor-overlay className="fixed inset-0 z-[2147483600] bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white rounded-xl border p-4 space-y-3">
        <div className="text-sm font-semibold">商户卡片字体</div>
        <div className="grid grid-cols-1 sm:grid-cols-[96px_minmax(0,1fr)] gap-2 items-center">
          <div className="text-xs text-gray-600">璁剧疆椤</div>
          <select
            className="w-full rounded border px-2 py-2 text-sm bg-white"
            value={merchantCardTypographyTarget}
            onChange={(e) => onMerchantCardTypographyTargetChange(e.target.value as MerchantCardTextRole)}
          >
            <option value="name">名称</option>
            <option value="industry">行业</option>
            <option value="domain">域名</option>
          </select>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-2">
          <div className="space-y-1">
            <div className="text-xs text-gray-600">字体</div>
            <select
              className="border p-2 rounded w-full text-sm"
              value={merchantCardTypoFontFamilyInput}
              onChange={(e) => setMerchantCardTypoFontFamilyInput(e.target.value)}
            >
              <option value="">默认</option>
              {FONT_FAMILY_OPTIONS.map((font) => (
                <option key={`merchant-card-typo-${font}`} value={font}>
                  {font}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-gray-600">字号</div>
            <FontSizeComboInput
              className="border p-2 rounded w-full text-sm pr-10"
              value={merchantCardTypoFontSizeInput}
              onChange={(value) => {
                setMerchantCardTypoFontSizeInput(normalizeMerchantCardTypographyFontSizeInputValue(value));
              }}
              onCommit={(value) => {
                setMerchantCardTypoFontSizeInput(clampMerchantCardTypographyFontSizeInputToString(value));
              }}
              options={FONT_SIZE_OPTIONS}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`px-3 py-2 rounded border text-sm ${merchantCardTypoBoldInput ? "bg-black text-white" : "bg-white"}`}
            onClick={() => setMerchantCardTypoBoldInput((prev) => !prev)}
          >
            B
          </button>
          <button
            type="button"
            className={`px-3 py-2 rounded border text-sm ${merchantCardTypoItalicInput ? "bg-black text-white" : "bg-white"}`}
            onClick={() => setMerchantCardTypoItalicInput((prev) => !prev)}
          >
            I
          </button>
          <button
            type="button"
            className={`px-3 py-2 rounded border text-sm ${merchantCardTypoUnderlineInput ? "bg-black text-white" : "bg-white"}`}
            onClick={() => setMerchantCardTypoUnderlineInput((prev) => !prev)}
          >
            U
          </button>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-gray-600">字体颜色</div>
          <ColorOrGradientPicker value={merchantCardTypoFontColorInput} onChange={setMerchantCardTypoFontColorInput} />
          <RecentColorBar
            colors={recentColors}
            onClear={onClearRecentColors}
            onPick={(color) => setMerchantCardTypoFontColorInput(color)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-xs text-gray-600">文本框</div>
          <label className="inline-flex items-center gap-1 text-xs rounded border px-2 py-1 bg-white">
            <BufferedEditorInput
              type="checkbox"
              checked={merchantCardTypoTextBoxVisibleInput}
              onChange={(e) => setMerchantCardTypoTextBoxVisibleInput(e.target.checked)}
            />
            <span>{merchantCardTypoTextBoxVisibleInput ? "开启" : "关闭"}</span>
          </label>
        </div>
        <div ref={merchantCardTypographyPreviewRef} className="relative rounded border bg-gray-50 p-3 h-36 overflow-hidden">
          <div
            className={`${merchantCardPreviewTextBoxClass} text-base font-semibold text-slate-900 ${merchantCardTypographyTarget === "name" ? "ring-2 ring-blue-400/55" : ""} cursor-move`}
            style={{
              left: `${merchantCardNamePreviewPosition.x}px`,
              top: `${merchantCardNamePreviewPosition.y}px`,
              position: "absolute",
              ...merchantCardNameStylePreview,
            }}
            onMouseDown={(event) => startMerchantCardTypographyPreviewDrag("name", event)}
          >
            <span className="truncate">商户名称</span>
          </div>
          <div
            className={`${merchantCardPreviewTextBoxClass} text-xs text-slate-500 ${merchantCardTypographyTarget === "industry" ? "ring-2 ring-blue-400/55" : ""} cursor-move`}
            style={{
              left: `${merchantCardIndustryPreviewPosition.x}px`,
              top: `${merchantCardIndustryPreviewPosition.y}px`,
              position: "absolute",
              ...merchantCardIndustryStylePreview,
            }}
            onMouseDown={(event) => startMerchantCardTypographyPreviewDrag("industry", event)}
          >
            <span className="truncate">餐饮</span>
          </div>
          <div
            className={`${merchantCardPreviewTextBoxClass} text-xs text-slate-500 ${merchantCardTypographyTarget === "domain" ? "ring-2 ring-blue-400/55" : ""} cursor-move`}
            style={{
              left: `${merchantCardDomainPreviewPosition.x}px`,
              top: `${merchantCardDomainPreviewPosition.y}px`,
              position: "absolute",
              ...merchantCardDomainStylePreview,
            }}
            onMouseDown={(event) => startMerchantCardTypographyPreviewDrag("domain", event)}
          >
            <span className="truncate">faolla.com/abc</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="px-3 py-2 rounded bg-black text-white text-sm" onClick={applyMerchantCardTypography}>
            应用
          </button>
          <button
            type="button"
            className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
            onClick={() => setMerchantCardTypographyDialogOpen(false)}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  ) : null;
  const layerSettingsDialog = layerSettingsOpen ? renderOverlay(
    <div data-editor-overlay className="fixed inset-0 z-[2147483600] bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-xs bg-white rounded-xl border p-4 space-y-2">
        <div className="text-sm font-semibold">{"层级"}</div>
        <button
          className="w-full px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm text-left"
          onClick={() => {
            onLayerToFront();
            setLayerSettingsOpen(false);
          }}
        >
          {"置于顶层"}
        </button>
        <button
          aria-label="上移"
          title="上移"
          className="flex w-full items-center justify-center px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
          onClick={() => {
            onLayerUp();
            setLayerSettingsOpen(false);
          }}
        >
          <MoveArrowIcon direction="up" />
        </button>
        <button
          aria-label="下移"
          title="下移"
          className="flex w-full items-center justify-center px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
          onClick={() => {
            onLayerDown();
            setLayerSettingsOpen(false);
          }}
        >
          <MoveArrowIcon direction="down" />
        </button>
        <button
          className="w-full px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm text-left"
          onClick={() => {
            onLayerToBack();
            setLayerSettingsOpen(false);
          }}
        >
          {"置于底层"}
        </button>
        <div className="flex justify-end pt-1">
          <button
            className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
            onClick={() => setLayerSettingsOpen(false)}
          >
            {"关闭"}
          </button>
        </div>
      </div>
    </div>
  ) : null;
  const typographyDialog = typographyDialogOpen ? renderOverlay(
    <div data-editor-overlay className="fixed inset-0 z-[2147483600] bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-xl bg-white rounded-xl border p-4 space-y-3">
        <div className="text-sm font-semibold">{"字体样式"}</div>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-2">
          <div className="space-y-1">
            <div className="text-xs text-gray-600">{"字体"}</div>
            <select
              className="border p-2 rounded w-full text-sm"
              value={typoFontFamily}
              onChange={(e) => setTypoFontFamily(e.target.value)}
            >
              <option value="">{"默认"}</option>
              {FONT_FAMILY_OPTIONS.map((font) => (
                <option key={font} value={font}>
                  {font}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-gray-600">{"字号"}</div>
            <FontSizeComboInput
              className="border p-2 rounded w-full text-sm pr-10"
              value={typoFontSize}
              onChange={(value) => {
                setTypoFontSize(normalizeTypographyFontSizeInputValue(value));
              }}
              onCommit={(value) => {
                setTypoFontSize(clampTypographyFontSizeInputToString(value));
              }}
              options={FONT_SIZE_OPTIONS}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className={`px-3 py-2 rounded border text-sm ${typoBold ? "bg-black text-white" : "bg-white"}`}
            onClick={() => setTypoBold((prev) => !prev)}
          >
            B
          </button>
          <button
            className={`px-3 py-2 rounded border text-sm ${typoItalic ? "bg-black text-white" : "bg-white"}`}
            onClick={() => setTypoItalic((prev) => !prev)}
          >
            I
          </button>
          <button
            className={`px-3 py-2 rounded border text-sm ${typoUnderline ? "bg-black text-white" : "bg-white"}`}
            onClick={() => setTypoUnderline((prev) => !prev)}
          >
            U
          </button>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-gray-600">{"字体颜色"}</div>
          <ColorOrGradientPicker value={typoFontColor} onChange={setTypoFontColor} />
        </div>
        <RecentColorBar
                colors={recentColors}
                onClear={onClearRecentColors}
                onPick={(color) => setTypoFontColor(color)}
        />
        <div
          className="rounded border p-3 text-sm"
          style={{
            fontFamily: typoFontFamily || undefined,
            fontSize: clampTypographyFontSizeInput(typoFontSize),
            color: isGradientToken(typoFontColor) ? "transparent" : typoFontColor || undefined,
            backgroundImage: isGradientToken(typoFontColor) ? typoFontColor : undefined,
            backgroundClip: isGradientToken(typoFontColor) ? ("text" as const) : undefined,
            WebkitBackgroundClip: isGradientToken(typoFontColor) ? ("text" as const) : undefined,
            fontWeight: typoBold ? "bold" : undefined,
            fontStyle: typoItalic ? "italic" : undefined,
            textDecoration: typoUnderline ? "underline" : undefined,
          }}
        >
          {"预览文本 Preview: 艺术字体 Art Font 示例 ABC abc 123"}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="px-3 py-2 rounded bg-black text-white text-sm"
            onClick={applyTypography}
          >
            {"应用"}
          </button>
          <button
            className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
            onClick={cancelTypographyEditing}
          >
            {"取消"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const currentButtonHoverAnimation =
    block.type === "button" ? normalizeButtonHoverAnimation(block.props.buttonHoverAnimation) : "none";
  const buttonOpenTargetBlocks =
    block.type === "button"
      ? availableBlocks.filter((item) => item.openByButton === true && item.id !== block.id)
      : [];

  const buttonJumpDialog =
    buttonJumpDialogOpen && block.type === "button"
      ? renderOverlay(
          <div data-editor-overlay className="fixed inset-0 z-[2147483600] bg-black/40 flex items-center justify-center p-4">
            <div className="w-full max-w-lg rounded-xl border bg-white p-4 space-y-3">
              <div className="text-sm font-semibold">{"跳转目标"}</div>
              <div className="space-y-1">
                <div className="text-xs text-gray-600">{"支持区块 ID、锚点、页面 ID、站内路径或完整网址"}</div>
                <BufferedEditorInput
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={buttonJumpTargetInput}
                  onChange={(event) => setButtonJumpTargetInput(event.target.value)}
                  placeholder={"例如：#0101 / page:页面ID / /site/10000000 / https://example.com"}
                  autoFocus
                />
              </div>
              <div className="rounded-lg border bg-slate-50 p-3 text-xs text-slate-600 space-y-2">
                <div>{"区块 ID 规则：页面两位 + 区块两位，例如页面1的第1个区块是 `0101`。"}</div>
                <div>{"按钮打开：目标区块开启“按钮打开”后，填写 `block:0101` 或直接点击下方目标。"}</div>
                <div>{"锚点：滚动到当前页面某个直接展示区块。填写 `#0101`，也可以直接填 `0101`。"}</div>
                <div>{"页面：切换到本站其他页面，格式是 `page:页面ID`，这里的页面不是链接地址。"}</div>
                <div>{"路径：打开站内地址或完整网址。站内路径来源就是浏览器地址栏里域名后面的部分，例如 `/site/10000000`。"}</div>
              </div>
              {buttonOpenTargetBlocks.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-xs text-gray-600">{"可通过按钮打开的区块"}</div>
                  <div className="flex flex-wrap gap-2">
                    {buttonOpenTargetBlocks.map((targetBlock) => (
                      <button
                        key={targetBlock.id}
                        type="button"
                        className="rounded border bg-white px-2 py-1 text-xs hover:bg-gray-50"
                        onClick={() => setButtonJumpTargetInput(`block:${targetBlock.publicId ?? targetBlock.id}`)}
                        title={targetBlock.id}
                      >
                        {targetBlock.label ?? targetBlock.publicId ?? targetBlock.id}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-xs text-slate-500">
                  当前页还没有开启“按钮打开”的其他区块。
                </div>
              )}
              {availablePages.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-xs text-gray-600">{"本站页面 ID"}</div>
                  <div className="flex flex-wrap gap-2">
                    {availablePages.map((page) => (
                      <button
                        key={page.id}
                        type="button"
                        className="rounded border bg-white px-2 py-1 text-xs hover:bg-gray-50"
                        onClick={() => setButtonJumpTargetInput(`page:${page.id}`)}
                        title={page.id}
                      >
                        {`${page.name} (${page.id})`}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
                  onClick={() => setButtonJumpDialogOpen(false)}
                >
                  {"取消"}
                </button>
                <button
                  className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
                  onClick={() => setButtonJumpTargetInput("")}
                >
                  {"清空"}
                </button>
                <button
                  className="px-3 py-2 rounded bg-black text-white text-sm"
                  onClick={applyButtonJumpTarget}
                >
                  {"确认"}
                </button>
              </div>
            </div>
          </div>,
        )
      : null;

  const buttonAnimationDialog =
    buttonAnimationDialogOpen && block.type === "button"
      ? renderOverlay(
          <div data-editor-overlay className="fixed inset-0 z-[2147483600] bg-black/40 flex items-center justify-center p-4">
            <div className="w-full max-w-lg rounded-xl border bg-white p-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold">{"鼠标移入动画"}</div>
                <button
                  type="button"
                  className="rounded border bg-white px-3 py-1.5 text-xs hover:bg-gray-50"
                  onClick={() => setButtonAnimationDialogOpen(false)}
                >
                  {"关闭"}
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {BUTTON_HOVER_ANIMATION_OPTIONS.map((item) => {
                  const active = currentButtonHoverAnimation === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      className={`rounded-xl border px-4 py-3 text-left text-sm font-semibold transition ${
                        active ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                      } ${getButtonHoverAnimationClassName(item.value)}`}
                      onClick={() => applyButtonHoverAnimation(item.value)}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>,
        )
      : null;

  if (block.type === "button") {
    const buttonLabel = resolveButtonLabel(block.props);
    const buttonFontColor = (block.props.fontColor ?? "").trim();
    const buttonLabelStyle: CSSProperties = {
      fontFamily: block.props.fontFamily?.trim() || undefined,
      fontSize:
        typeof block.props.fontSize === "number" && Number.isFinite(block.props.fontSize) && block.props.fontSize > 0
          ? block.props.fontSize
          : undefined,
      fontWeight: block.props.fontWeight,
      fontStyle: block.props.fontStyle,
      textDecoration: block.props.textDecoration,
    };
    if (buttonFontColor) {
      if (isGradientToken(buttonFontColor)) {
        buttonLabelStyle.backgroundImage = buttonFontColor;
        buttonLabelStyle.backgroundClip = "text";
        buttonLabelStyle.WebkitBackgroundClip = "text";
        buttonLabelStyle.color = "transparent";
      } else {
        buttonLabelStyle.color = buttonFontColor;
      }
    }
    const buttonHoverAnimationClassName = getButtonHoverAnimationClassName(block.props.buttonHoverAnimation);

    return (
      <section
        data-block-id={block.id}
        data-jump-target={publicBlockId}
        data-block-public-id={publicBlockId}
        className={`${shellClass} pointer-events-none`}
        style={offsetStyle}
      >
        <EditorBlockHeader
          blockId={publicBlockId}
          draggingBlockId={draggingBlockId}
          isSelected={isSelected}
          onDragHandleMouseDown={onDragHandleMouseDown}
          onNudge={onNudge}
          onOpenLayerSettings={openLayerSettings}
          onEditTypography={editTypography}
          onInsertImage={insertImage}
          onConfigureJump={openButtonJumpDialog}
          onEditButtonAnimation={openButtonAnimationDialog}
          onEditImageSettings={editImageSettings}
          onEditBorderStyle={editBorderSettings}
          isMobileViewport={previewViewport === "mobile"}
          mobileFitScreenWidth={block.props.mobileFitScreenWidth === true}
          onToggleMobileFitScreenWidth={handleToggleMobileFitScreenWidth}
          blockOpenByButton={blockOpenByButton}
          onToggleBlockOpenMode={toggleBlockOpenMode}
          onDelete={onDelete}
        />
        <div
          ref={resizeTargetRef}
          data-block-visual-boundary
          className={`relative rounded-xl shadow-sm pointer-events-auto ${buttonHoverAnimationClassName} ${isSelected ? "overflow-visible" : "overflow-hidden"} ${borderClass}`}
          onClick={onSelect}
          style={{
            ...blockPreviewShellStyle,
            overflow: isEditingBlock ? "visible" : "hidden",
            minHeight: blockHeight ? undefined : "44px",
          }}
        >
          {imageDialog}
          {imageSettingsDialog}
          {borderSettingsDialog}
          {layerSettingsDialog}
          {typographyDialog}
          {buttonJumpDialog}
          {buttonAnimationDialog}
          <div
            className="absolute inset-0 box-border flex min-h-0 min-w-0 items-center justify-center overflow-hidden text-center"
            style={resolveButtonContentPadding(blockWidth, blockHeight)}
          >
            {isSelected ? (
              <RichTextEditor
                field="buttonLabel"
                className="block min-h-0 min-w-0 w-full overflow-hidden break-words text-center text-gray-700"
                style={buttonLabelStyle}
                value={buttonLabel}
                onChange={handleRichFieldChange}
                onActivate={registerActiveEditor}
                onSelectionChange={updateSelectionRange}
              />
            ) : (
              <div
                className="block min-h-0 min-w-0 w-full overflow-hidden break-words whitespace-pre-wrap text-center text-gray-700"
                style={buttonLabelStyle}
                dangerouslySetInnerHTML={{ __html: toRichHtml(buttonLabel, "") }}
              />
            )}
          </div>
          {resizeHandles}
        </div>
      </section>
    );
  }

  if (isCommonCanvasBlockType(block.type)) {
    const commonBoxes = getCommonTextBoxes();
    const commonCanvasMetrics = getCommonCanvasMetrics();
    return (
      <section
        data-block-id={block.id}
        data-jump-target={publicBlockId}
        data-block-public-id={publicBlockId}
        className={`${shellClass} pointer-events-none`}
        style={offsetStyle}
      >
        <EditorBlockHeader
          blockId={publicBlockId}
          draggingBlockId={draggingBlockId}
          isSelected={isSelected}
          onDragHandleMouseDown={onDragHandleMouseDown}
          onNudge={onNudge}
          onOpenLayerSettings={openLayerSettings}
          onEditTypography={editTypography}
          onInsertText={insertTextBox}
          onInsertImage={insertImage}
          onEditImageSettings={editImageSettings}
          onEditBorderStyle={editBorderSettings}
          isMobileViewport={previewViewport === "mobile"}
          mobileFitScreenWidth={block.props.mobileFitScreenWidth === true}
          onToggleMobileFitScreenWidth={handleToggleMobileFitScreenWidth}
          blockOpenByButton={blockOpenByButton}
          onToggleBlockOpenMode={toggleBlockOpenMode}
          onDelete={onDelete}
        />
        <div
          ref={resizeTargetRef}
          data-block-visual-boundary
          className={`${cardClass} relative !overflow-visible`}
          onClick={onSelect}
          style={blockPreviewShellStyle}
        >
          {imageDialog}
          {imageSettingsDialog}
          {borderSettingsDialog}
          {layerSettingsDialog}
          {typographyDialog}
          {buttonJumpDialog}
          <div
            ref={commonCanvasRef}
            className={`mt-2 relative rounded overflow-visible ${isSelected && commonInsertMode ? "cursor-crosshair" : ""}`}
            style={{
              minHeight: blockHeight ? undefined : `${commonCanvasMetrics?.renderHeight ?? 280}px`,
              width: `${commonCanvasMetrics?.renderWidth ?? 280}px`,
              height: `${commonCanvasMetrics?.renderHeight ?? 280}px`,
              maxWidth: "100%",
            }}
            onMouseDown={handleCommonCanvasMouseDown}
          >
            <div
              className="absolute left-0 top-0"
              style={{
                width: `${commonCanvasMetrics?.bounds.width ?? 280}px`,
                height: `${commonCanvasMetrics?.bounds.height ?? 280}px`,
                transform: `scale(${commonCanvasMetrics?.scale ?? 1})`,
                transformOrigin: "top left",
              }}
            >
              {commonBoxes.map((box) => (
                <div
                  key={box.id}
                  data-common-box
                  className={`absolute bg-transparent ${isSelected ? "border" : "border-transparent"} ${
                    activeCommonTextBoxId === box.id ? "border-black" : "border-gray-300/70"
                  }`}
                  style={{
                    left: `${box.x + (commonCanvasMetrics?.translateX ?? 0)}px`,
                    top: `${box.y + (commonCanvasMetrics?.translateY ?? 0)}px`,
                    width: `${box.width}px`,
                    height: `${box.height}px`,
                    transform: `rotate(${box.rotateDeg}deg)`,
                    transformOrigin: "center center",
                  }}
                  onMouseDownCapture={(event) => {
                    const target = event.target as HTMLElement | null;
                    if (target?.closest("[contenteditable='true']")) {
                      event.stopPropagation();
                    }
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect();
                    setActiveCommonTextBoxId(box.id);
                  }}
                >
                  {isSelected ? (
                    <RichTextEditor
                      field="text"
                      className="w-full h-full p-2 text-gray-700"
                      value={box.html}
                      dataCommonBoxId={box.id}
                      onChange={(_, html, editorEl) => {
                        const patch: Partial<CommonEditorTextBox> = { html };
                        if (editorEl) {
                          const nextWidth = Math.max(box.width, Math.ceil(editorEl.scrollWidth));
                          const nextHeight = Math.max(box.height, Math.ceil(editorEl.scrollHeight));
                          if (nextWidth > box.width) patch.width = nextWidth;
                          if (nextHeight > box.height) patch.height = nextHeight;
                        }
                        updateCommonTextBox(box.id, patch);
                      }}
                      onActivate={registerActiveEditor}
                      onSelectionChange={updateSelectionRange}
                    />
                  ) : (
                    <div
                      className="w-full h-full p-2 text-gray-700 whitespace-pre-wrap break-words overflow-hidden"
                      dangerouslySetInnerHTML={{ __html: toRichHtml(box.html, "") }}
                    />
                  )}
                  {isSelected ? (
                    <>
                      <button
                        type="button"
                        className="absolute -top-2 -left-2 z-30 flex h-5 w-5 cursor-move items-center justify-center rounded-full border border-black bg-white text-black"
                        onMouseDown={(event) => startCommonBoxDrag(box, event)}
                        title={"拖动"}
                      >
                        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                          <path d="M8 2 L6.5 3.5 M8 2 L9.5 3.5 M8 2 V14" />
                          <path d="M14 8 L12.5 6.5 M14 8 L12.5 9.5 M14 8 H2" />
                          <path d="M8 14 L6.5 12.5 M8 14 L9.5 12.5" />
                          <path d="M2 8 L3.5 6.5 M2 8 L3.5 9.5" />
                        </svg>
                      </button>
                      <button
                        className="absolute -top-2 -right-2 z-30 w-5 h-5 rounded-full bg-black text-white text-xs leading-none"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          deleteCommonTextBox(box.id);
                        }}
                        aria-label="删除"
                        title="删除"
                      >
                        {"删"}
                      </button>
                      <div
                        className="absolute top-2 bottom-2 left-0 w-2 -translate-x-1 cursor-ew-resize"
                        onMouseDown={(event) => startCommonBoxResize(box, "left", event)}
                      />
                      <div
                        className="absolute top-2 bottom-2 right-0 w-2 cursor-ew-resize"
                        onMouseDown={(event) => startCommonBoxResize(box, "right", event)}
                      />
                      <div
                        className="absolute top-0 left-2 right-2 h-2 -translate-y-1 cursor-ns-resize"
                        onMouseDown={(event) => startCommonBoxResize(box, "top", event)}
                      />
                      <div
                        className="absolute bottom-0 left-0 w-full h-2 cursor-ns-resize"
                        onMouseDown={(event) => startCommonBoxResize(box, "bottom", event)}
                      />
                      <div
                        className="absolute -bottom-1 -left-1 w-3 h-3 rounded-full border border-black bg-white cursor-nesw-resize"
                        onMouseDown={(event) => startCommonBoxResize(box, "bottom-left", event)}
                      />
                      <div
                        className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full border border-black bg-white cursor-nwse-resize"
                        onMouseDown={(event) => startCommonBoxResize(box, "bottom-right", event)}
                      />
                      <div
                        className="absolute left-1/2 -top-7 -translate-x-1/2 flex items-center justify-center"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                      >
                        <button
                          type="button"
                          className="w-5 h-5 rounded-full border border-black bg-white text-[10px] leading-none"
                          onMouseDown={(event) => startCommonBoxRotate(box, event)}
                          title={"旋转"}
                        >
                          ?
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
              ))}
            </div>
            {null}
          </div>
          {resizeHandles}
        </div>
      </section>
    );
  }

  if (block.type === "gallery") {
    const galleryImages = getGalleryImages();
    const activePreset = normalizeGalleryLayoutPreset(block.props.galleryLayoutPreset);
    const activeCustomLayout = normalizeCustomGalleryLayout(block.props.galleryCustomLayout);
    const customRowsForImages = buildCustomGalleryRows(activeCustomLayout, galleryImages.length);
    const customDraftPreviewCount = Math.max(
      1,
      customLayoutDraft.rows.reduce((sum, row) => sum + Math.max(1, row.frames.length), 0),
    );
    const customDraftRows = buildCustomGalleryRows(customLayoutDraft, customDraftPreviewCount);
    const featuredImages = galleryImages.filter((item) => item.featured);
    const homeImages = featuredImages.length > 0 ? featuredImages : galleryImages;
    const previewImage = homeImages[0] ?? galleryImages[0] ?? null;
    const galleryFrameWidth =
      typeof block.props.galleryFrameWidth === "number" && Number.isFinite(block.props.galleryFrameWidth)
        ? Math.max(220, Math.round(block.props.galleryFrameWidth))
        : undefined;
    const galleryContentMaxWidth =
      typeof block.props.blockWidth === "number" && Number.isFinite(block.props.blockWidth)
        ? Math.max(120, Math.round(block.props.blockWidth) - 48)
        : undefined;
    const effectiveGalleryFrameWidth =
      typeof galleryFrameWidth === "number"
        ? typeof galleryContentMaxWidth === "number"
          ? Math.min(galleryFrameWidth, galleryContentMaxWidth)
          : galleryFrameWidth
        : undefined;
    const galleryFrameHeight =
      typeof block.props.galleryFrameHeight === "number" && Number.isFinite(block.props.galleryFrameHeight)
        ? Math.max(140, Math.round(block.props.galleryFrameHeight))
        : 260;
    const galleryFrameStyle = {
      width: effectiveGalleryFrameWidth ? `${effectiveGalleryFrameWidth}px` : "100%",
      maxWidth: "100%",
      height: `${galleryFrameHeight}px`,
    };
    const galleryHeadingStyle = {
      width: effectiveGalleryFrameWidth ? `${effectiveGalleryFrameWidth}px` : "100%",
      maxWidth: "100%",
    };
    const renderGalleryEditorCard = (
      item: GalleryEditorImage,
      idx: number,
      options: { outerClass?: string; outerStyle?: { gridColumn?: string }; frameStyle: { height?: number; aspectRatio?: string } },
    ) => (
      <div
        key={item.id}
        className={`space-y-2 ${options.outerClass ?? ""}`.trim()}
        style={options.outerStyle}
      >
        <div
          className={`relative overflow-hidden rounded border bg-gray-50 ${
            activeGalleryImageId === item.id ? "ring-2 ring-black/20" : ""
          }`}
          style={options.frameStyle}
          data-gallery-layer-id={item.id}
          onMouseDown={() => setActiveGalleryImageId(item.id)}
        >
          <div
            className="absolute inset-0"
            style={{
              transform: item.fitToFrame
                ? undefined
                : `translate(${item.offsetX}px, ${item.offsetY}px) scale(${item.scaleX}, ${item.scaleY})`,
              transformOrigin: item.fitToFrame ? undefined : "center center",
            }}
          >
            <NextImage
              src={item.url}
              alt=""
              fill
              unoptimized
              sizes="100vw"
              className={`select-none pointer-events-none ${item.fitToFrame ? "object-cover" : "object-contain"}`}
              style={
                item.fitToFrame
                  ? {
                      objectPosition: `calc(50% + ${item.offsetX}px) calc(50% + ${item.offsetY}px)`,
                    }
                  : undefined
              }
              draggable={false}
            />
          </div>
          <div className="absolute inset-0 z-20 pointer-events-none">
            <div className="absolute left-2 top-2 w-[96px] h-[90px] shrink-0 pointer-events-auto">
              <button
                type="button"
                className="absolute left-1/2 top-[6px] -translate-x-1/2 w-8 h-8 flex items-center justify-center"
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={() => nudgeGalleryImage(item.id, 0, -4)}
                title={"左移微调"}
              >
                <span className="block w-0 h-0 border-l-[7px] border-r-[7px] border-b-[11px] border-l-transparent border-r-transparent border-b-black" />
              </button>
              <button
                type="button"
                className="absolute left-1 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center"
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={() => nudgeGalleryImage(item.id, -4, 0)}
                title={"右移微调"}
              >
                <span className="block w-0 h-0 border-t-[7px] border-b-[7px] border-r-[11px] border-t-transparent border-b-transparent border-r-black" />
              </button>
              <button
                type="button"
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 px-2 py-1 text-xs rounded border select-none bg-white hover:bg-gray-50 cursor-grab active:cursor-grabbing"
                onMouseDown={(event) => startGalleryImageDrag(item, event)}
              >
                {"拖动"}
              </button>
              <button
                type="button"
                className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center"
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={() => nudgeGalleryImage(item.id, 4, 0)}
                title={"上移微调"}
              >
                <span className="block w-0 h-0 border-t-[7px] border-b-[7px] border-l-[11px] border-t-transparent border-b-transparent border-l-black" />
              </button>
              <button
                type="button"
                className="absolute left-1/2 bottom-[6px] -translate-x-1/2 w-8 h-8 flex items-center justify-center"
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={() => nudgeGalleryImage(item.id, 0, 4)}
                title={"下移微调"}
              >
                <span className="block w-0 h-0 border-l-[7px] border-r-[7px] border-t-[11px] border-l-transparent border-r-transparent border-t-black" />
              </button>
            </div>
            <label
              className={`absolute right-[56px] top-2 pointer-events-auto px-2 py-1 text-[11px] rounded border bg-white ${
                galleryUploading ? "cursor-wait opacity-60" : "cursor-pointer hover:bg-gray-50"
              }`}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              {galleryUploading ? "上传中" : "更改"}
              <BufferedEditorInput
                className="hidden"
                type="file"
                accept="image/*"
                disabled={galleryUploading}
                onChange={(event) => {
                  void onReplaceGalleryImage(item.id, event);
                }}
              />
            </label>
            <button
              type="button"
              className="absolute right-2 top-2 pointer-events-auto px-2 py-1 text-[11px] rounded border bg-white hover:bg-gray-50"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={() => commitGalleryImages(galleryImages.filter((it) => it.id !== item.id))}
            >
                {"删除"}
            </button>
            <label
              className="absolute left-2 bottom-2 pointer-events-auto text-[11px] text-gray-700 inline-flex items-center gap-1 rounded border bg-white px-2 py-1"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              <BufferedEditorInput
                type="checkbox"
                checked={item.featured}
                onChange={(e) => updateGalleryImage(item.id, { featured: e.target.checked })}
              />
              {"首屏展示"}
            </label>
            <label
              className="absolute left-[90px] bottom-2 pointer-events-auto text-[11px] text-gray-700 inline-flex items-center gap-1 rounded border bg-white px-2 py-1"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              <BufferedEditorInput
                type="checkbox"
                checked={item.fitToFrame}
                onChange={(e) =>
                  updateGalleryImage(item.id, {
                    fitToFrame: e.target.checked,
                    ...(e.target.checked
                      ? { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 }
                      : {}),
                  })
                }
              />
              {"适应框体"}
            </label>
            <div
              className="absolute right-2 bottom-2 pointer-events-auto inline-flex items-center gap-1 rounded border bg-white px-2 py-1"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              <button
                type="button"
                className={`w-6 h-6 text-xs rounded border ${
                  item.fitToFrame ? "cursor-not-allowed opacity-50" : "hover:bg-gray-50"
                }`}
                onClick={() => stepGalleryScale(item.id, -10)}
                disabled={item.fitToFrame || getGalleryScalePercent(item) <= 20}
                title={"缩小 10%"}
              >
                -
              </button>
              <span className="min-w-[52px] text-center text-[11px] text-gray-700 select-none">
                {getGalleryScalePercent(item)}%
              </span>
              <button
                type="button"
                className={`w-6 h-6 text-xs rounded border ${
                  item.fitToFrame ? "cursor-not-allowed opacity-50" : "hover:bg-gray-50"
                }`}
                onClick={() => stepGalleryScale(item.id, 10)}
                disabled={item.fitToFrame || getGalleryScalePercent(item) >= 200}
                title={"放大 10%"}
              >
                +
              </button>
            </div>
          </div>
        </div>
      </div>
    );
    return (
      <section
        data-block-id={block.id}
        data-jump-target={publicBlockId}
        data-block-public-id={publicBlockId}
        className={`${shellClass} pointer-events-none`}
        style={offsetStyle}
      >
        <EditorBlockHeader
          blockId={publicBlockId}
          draggingBlockId={draggingBlockId}
          isSelected={isSelected}
          onDragHandleMouseDown={onDragHandleMouseDown}
          onNudge={onNudge}
          onOpenLayerSettings={openLayerSettings}
          onEditTypography={editTypography}
          onInsertText={insertTextBox}
          onInsertImage={insertImage}
          onEditImageSettings={editImageSettings}
          onEditBorderStyle={editBorderSettings}
          isMobileViewport={previewViewport === "mobile"}
          mobileFitScreenWidth={block.props.mobileFitScreenWidth === true}
          onToggleMobileFitScreenWidth={handleToggleMobileFitScreenWidth}
          blockOpenByButton={blockOpenByButton}
          onToggleBlockOpenMode={toggleBlockOpenMode}
          onDelete={onDelete}
        />
        <div
          ref={resizeTargetRef}
          data-block-visual-boundary
          className={`${cardClass} relative`}
          onClick={onSelect}
          style={{ ...blockBackgroundStyle, ...blockSizeStyle, ...previewBorderInlineStyle }}
        >
          {imageDialog}
          {imageSettingsDialog}
          {borderSettingsDialog}
          {layerSettingsDialog}
          {typographyDialog}
          {isSelected ? renderSelectedEditor(
            <>
              <div className="space-y-1 mt-3 mx-auto" style={galleryHeadingStyle}>
                <RichTextEditor
                  field="heading"
                  className="border p-2 rounded w-full text-xl font-bold"
                  value={block.props.heading ?? ""}
                  onChange={handleRichFieldChange}
                  onActivate={registerActiveEditor}
                  onSelectionChange={updateSelectionRange}
                />
              </div>
              <div className="space-y-2 mt-3 mx-auto" style={galleryHeadingStyle}>
                <div
                  ref={galleryFrameRef}
                  className="relative rounded-lg border border-gray-200 overflow-hidden bg-transparent"
                  style={galleryFrameStyle}
                >
                  {previewImage ? (
                    <div className="relative w-full h-full overflow-hidden">
                      {previewImage.fitToFrame ? (
                        <div
                          className="absolute inset-0"
                          style={{ overflow: "hidden" }}
                        >
                          <NextImage
                            src={previewImage.url}
                            alt=""
                            fill
                            unoptimized
                            sizes="100vw"
                            className="object-cover"
                            style={{
                              objectPosition: `calc(50% + ${previewImage.offsetX}px) calc(50% + ${previewImage.offsetY}px)`,
                            }}
                          />
                        </div>
                      ) : (
                        <div
                          className="absolute inset-0"
                          style={{
                            transform: `translate(${previewImage.offsetX}px, ${previewImage.offsetY}px) scale(${previewImage.scaleX}, ${previewImage.scaleY})`,
                            transformOrigin: "center center",
                          }}
                        >
                          <NextImage src={previewImage.url} alt="" fill unoptimized sizes="100vw" className="object-contain" />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="h-full flex items-center justify-center text-sm text-gray-500">{"暂无变示图"}</div>
                  )}
                  <div
                    className="absolute top-0 left-0 h-full w-2 cursor-ew-resize z-10"
                    onMouseDown={(event) => startGalleryFrameResize("left", event)}
                  />
                  <div
                    className="absolute top-0 right-0 h-full w-2 cursor-ew-resize z-10"
                    onMouseDown={(event) => startGalleryFrameResize("right", event)}
                  />
                  <div
                    className="absolute top-0 left-0 w-full h-2 cursor-ns-resize z-10"
                    onMouseDown={(event) => startGalleryFrameResize("top", event)}
                  />
                  <div
                    className="absolute bottom-0 left-0 w-full h-2 cursor-ns-resize z-10"
                    onMouseDown={(event) => startGalleryFrameResize("bottom", event)}
                  />
                </div>
                <div className="mx-auto" style={galleryHeadingStyle}>
                  <button
                    type="button"
                    className="inline-flex items-center px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
                    onClick={() => setGalleryEditorOpen(true)}
                  >
                    {"编辑画廊"}
                  </button>
                </div>
              </div>
              {galleryEditorOpen
                ? renderOverlay(
                    <div data-editor-overlay className="fixed inset-0 z-[2147483600] bg-black/40 flex items-center justify-center p-4">
                      <div ref={galleryEditorPanelRef} className="w-full max-w-6xl max-h-[86vh] rounded-xl border bg-white overflow-hidden flex flex-col">
                        <div className="shrink-0 px-4 py-3 bg-white border-b flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold">{"编辑画廊"}</div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
                              onClick={() => setLayoutPanelOpen((prev) => !prev)}
                            >
                              {"布局"}
                            </button>
                            <label
                              className={`inline-flex items-center px-3 py-2 rounded border bg-white text-sm ${
                                galleryUploading ? "cursor-wait opacity-60" : "cursor-pointer hover:bg-gray-50"
                              }`}
                            >
                              {galleryUploading ? "正在上传..." : "上传图片"}
                              <BufferedEditorInput
                                ref={galleryInputRef}
                                className="hidden"
                                type="file"
                                accept="image/*"
                                multiple
                                disabled={galleryUploading}
                                onChange={onUploadGalleryImages}
                              />
                            </label>
                            <button
                              type="button"
                              className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
                              onClick={() => {
                                setLayoutPanelOpen(false);
                                setCustomLayoutDialogOpen(false);
                                setGalleryEditorOpen(false);
                              }}
                            >
                              {"关闭"}
                            </button>
                          </div>
                        </div>
                        <div className="flex-1 overflow-auto p-4">
                        {layoutPanelOpen ? (
                          <div className="rounded border bg-white p-3 mb-3">
                            <div className="grid grid-cols-6 gap-2">
                              {galleryLayoutDefs.map((layout) => {
                                const previewCount = layout.id === "mosaic" ? 6 : layout.id === "custom" ? 7 : 3;
                                const previewLayouts = Array.from({ length: previewCount }, (_, idx) =>
                                  getGalleryCardLayout(layout.id, idx, activeCustomLayout),
                                );
                                const numericHeights = previewLayouts
                                  .map((item) => item.frameStyle.height)
                                  .filter((height): height is number => typeof height === "number");
                                const minHeight = numericHeights.length > 0 ? Math.min(...numericHeights) : 180;
                                const maxHeight = numericHeights.length > 0 ? Math.max(...numericHeights) : 180;
                                const customPreviewRows =
                                  layout.id === "custom" ? buildCustomGalleryRows(activeCustomLayout, previewCount) : [];

                                return (
                                  <button
                                    key={layout.id}
                                    type="button"
                                    className={`h-24 rounded border p-2 transition ${
                                      activePreset === layout.id
                                        ? "border-black bg-blue-50 shadow-sm ring-2 ring-blue-200"
                                        : "bg-white hover:bg-gray-50"
                                    }`}
                                    onClick={() => applyGalleryLayoutPreset(layout.id)}
                                  >
                                    <div className="w-full h-[calc(100%-16px)] border border-dashed border-gray-400 rounded overflow-hidden p-1">
                                      {layout.id === "custom" ? (
                                        <div className="space-y-1">
                                          {customPreviewRows.map((row) => {
                                            const blank = getCustomPreviewBlankSpans(row);
                                            const itemHeight = Math.max(8, Math.min(16, Math.round((row.items[0]?.height ?? 220) / 600 * 16)));
                                            return (
                                              <div key={row.key} className="flex gap-1">
                                                {blank.leading > 0 ? (
                                                  <div
                                                    className="rounded-sm bg-white"
                                                    style={{ width: `${(blank.leading / 12) * 100}%`, height: itemHeight }}
                                                  />
                                                ) : null}
                                                {row.items.map((sample, idx) => (
                                                  <div
                                                    key={idx}
                                                    className="border border-gray-400 bg-gray-100/80 rounded-sm"
                                                    style={{
                                                      width: `${(sample.span / 12) * 100}%`,
                                                      height: itemHeight,
                                                    }}
                                                  />
                                                ))}
                                                {blank.trailing > 0 ? (
                                                  <div
                                                    className="rounded-sm bg-white"
                                                    style={{ width: `${(blank.trailing / 12) * 100}%`, height: itemHeight }}
                                                  />
                                                ) : null}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      ) : (
                                        <div className="grid grid-cols-12 gap-1 items-start">
                                          {previewLayouts.map((sample, idx) => (
                                            <div
                                              key={idx}
                                              className="border border-gray-400 bg-gray-100/80 rounded-sm"
                                              style={{
                                                gridColumn: `span ${getPreviewColSpan(sample.itemClass)} / span ${getPreviewColSpan(sample.itemClass)}`,
                                                aspectRatio: sample.frameStyle.aspectRatio,
                                                height: getPreviewBlockHeight(sample, minHeight, maxHeight),
                                              }}
                                            />
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                    <div className="mt-1 text-[10px] text-gray-600 text-center">{getGalleryLayoutLabel(layout.id)}</div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                        {customLayoutDialogOpen ? (
                          <div className="fixed inset-0 z-[2147483601] bg-black/40 flex items-center justify-center p-4">
                            <div className="w-full max-w-6xl bg-white rounded-xl border shadow-xl overflow-hidden">
                              <div className="px-4 py-3 border-b flex items-center justify-between">
                                <div className="text-sm font-semibold">{"臮义样"}</div>
                                <button
                                  type="button"
                                  className="px-3 py-1 text-sm rounded border bg-white hover:bg-gray-50"
                                  onClick={() => setCustomLayoutDialogOpen(false)}
                                >
                                  {"关闭"}
                                </button>
                              </div>
                              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-4">
                                <div className="rounded border p-3 space-y-2">
                                  <div className="text-xs text-gray-500">{"预览样式"}</div>
                                  <div className="rounded border border-dashed border-gray-400 p-2 min-h-[220px]">
                                    <div className="space-y-2">
                                      {customDraftRows.map((row) => {
                                        const blank = getCustomPreviewBlankSpans(row);
                                        const itemHeight = Math.max(20, Math.min(72, Math.round((row.items[0]?.height ?? 220) / 600 * 72)));
                                        return (
                                          <div key={row.key} className="flex gap-2">
                                            {blank.leading > 0 ? (
                                              <div
                                                className="rounded bg-white"
                                                style={{ width: `${(blank.leading / 12) * 100}%`, height: itemHeight }}
                                              />
                                            ) : null}
                                            {row.items.map((item, idx) => (
                                              <div
                                                key={idx}
                                                className="border border-gray-400 bg-gray-100 rounded"
                                                style={{
                                                  width: `${(item.span / 12) * 100}%`,
                                                  height: itemHeight,
                                                }}
                                              />
                                            ))}
                                            {blank.trailing > 0 ? (
                                              <div
                                                className="rounded bg-white"
                                                style={{ width: `${(blank.trailing / 12) * 100}%`, height: itemHeight }}
                                              />
                                            ) : null}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </div>
                                <div className="rounded border p-3 space-y-3">
                                  <div className="text-xs text-gray-500">{"编辑布局（先选中行）"}</div>
                                  <div className="flex gap-2">
                                    {[0, 1, 2].map((rowIdx) => (
                                      <button
                                        key={rowIdx}
                                        type="button"
                                        className={`px-3 py-1 text-sm rounded border transition ${
                                          selectedCustomRowIndex === rowIdx
                                            ? "border-black bg-blue-50 shadow-sm ring-2 ring-blue-200 font-semibold"
                                            : "bg-white hover:bg-gray-50"
                                        }`}
                                        onClick={() => setSelectedCustomRowIndex(rowIdx)}
                                      >
                                        {"第"}{rowIdx + 1}{"行"}
                                      </button>
                                    ))}
                                  </div>
                                  <div className="space-y-1">
                                    <div className="text-xs text-gray-600">{"行高"}</div>
                                    <div className="flex items-center gap-2">
                                      <BufferedEditorInput
                                        type="range"
                                        min={120}
                                        max={600}
                                        step={10}
                                        className="flex-1"
                                        value={customLayoutDraft.rows[selectedCustomRowIndex]?.height ?? 220}
                                        onChange={(event) => setCustomRowHeight(selectedCustomRowIndex, Number(event.target.value))}
                                      />
                                      <BufferedEditorInput
                                        type="number"
                                        className="w-20 border rounded px-2 py-1 text-sm"
                                        min={120}
                                        max={600}
                                        value={customLayoutDraft.rows[selectedCustomRowIndex]?.height ?? 220}
                                        onChange={(event) => setCustomRowHeight(selectedCustomRowIndex, Number(event.target.value))}
                                      />
                                    </div>
                                  </div>
                                  <div className="space-y-1">
                                    <div className="text-xs text-gray-600">{"对齐方式"}</div>
                                    <div className="flex gap-2">
                                      {[
                                        { id: "left", label: "左对齐" },
                                        { id: "center", label: "居中" },
                                        { id: "right", label: "右对齐" },
                                      ].map((align) => (
                                        <button
                                          key={align.id}
                                          type="button"
                                          className={`px-3 py-1 text-sm rounded border transition ${
                                            customLayoutDraft.rows[selectedCustomRowIndex]?.align === align.id
                                              ? "border-black bg-blue-50 shadow-sm ring-2 ring-blue-200 font-semibold"
                                              : "bg-white hover:bg-gray-50"
                                          }`}
                                          onClick={() => setCustomRowAlign(selectedCustomRowIndex, align.id as GalleryRowAlign)}
                                        >
                                          {align.label}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                  <div className="space-y-1">
                                    <div className="text-xs text-gray-600">{"当前帧列"}</div>
                                    <div className="min-h-10 rounded border bg-gray-50 px-2 py-2 text-sm">
                                      {(customLayoutDraft.rows[selectedCustomRowIndex]?.frames ?? []).length > 0
                                        ? customLayoutDraft.rows[selectedCustomRowIndex].frames
                                            .map((item) => GALLERY_FRAME_WIDTH_LABELS[item])
                                            .join(" | ")
                                        : "当前为空"}
                                    </div>
                                  </div>
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      className="px-3 py-1 text-sm rounded border bg-white hover:bg-gray-50"
                                      onClick={removeSelectedRowLastFrame}
                                    >
                                      {"删除后一"}
                                    </button>
                                    <button
                                      type="button"
                                      className="px-3 py-1 text-sm rounded border bg-white hover:bg-gray-50"
                                      onClick={clearSelectedRowFrames}
                                    >
                                      {"清空当前"}
                                    </button>
                                  </div>
                                </div>
                                <div className="rounded border p-3 flex flex-col">
                                  <div className="text-xs text-gray-500 mb-2">{"点击样式按钮即可添加到中行"}</div>
                                  <div className="grid grid-cols-2 gap-3">
                                    {CUSTOM_GALLERY_FRAME_WIDTHS.map((width) => (
                                      <button
                                        key={width}
                                        type="button"
                                        className={`rounded border p-2 text-sm ${
                                          (() => {
                                            const row = customLayoutDraft.rows[selectedCustomRowIndex];
                                            if (!row) return "bg-gray-100 text-gray-400 cursor-not-allowed";
                                            const currentSpan = row.frames.reduce((sum, item) => sum + frameWidthToSpan(item), 0);
                                            const canAppend = currentSpan + frameWidthToSpan(width) <= 12;
                                            return canAppend
                                              ? "bg-white hover:bg-gray-50"
                                              : "bg-gray-100 text-gray-400 cursor-not-allowed";
                                          })()
                                        }`}
                                        disabled={
                                          (() => {
                                            const row = customLayoutDraft.rows[selectedCustomRowIndex];
                                            if (!row) return true;
                                            const currentSpan = row.frames.reduce((sum, item) => sum + frameWidthToSpan(item), 0);
                                            return currentSpan + frameWidthToSpan(width) > 12;
                                          })()
                                        }
                                        onClick={() => appendFrameToSelectedRow(width)}
                                      >
                                        <div className="text-xs text-gray-500 mb-1">{GALLERY_FRAME_WIDTH_LABELS[width]}</div>
                                        <div className="h-8 border border-gray-400 bg-gray-100 rounded" style={{ width: `${(frameWidthToSpan(width) / 12) * 100}%` }} />
                                      </button>
                                    ))}
                                  </div>
                                  <div className="mt-auto flex justify-end pt-4">
                                    <button
                                      type="button"
                                      className="px-4 py-2 rounded bg-black text-white text-sm hover:bg-gray-800"
                                      onClick={confirmCustomLayout}
                                    >
                                      {"确定"}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : null}
                        {galleryImages.length > 0 ? (
                          activePreset === "custom" ? (
                            <div className="space-y-4">
                              {customRowsForImages.map((row) => {
                                const blank = getCustomPreviewBlankSpans(row);
                                return (
                                  <div key={row.key} className="grid grid-cols-12 gap-4 items-start">
                                    {blank.leading > 0 ? (
                                      <div style={{ gridColumn: `span ${blank.leading} / span ${blank.leading}` }} />
                                    ) : null}
                                    {row.items.map((slot) => {
                                      const item = galleryImages[slot.index];
                                      if (!item) return null;
                                      return renderGalleryEditorCard(item, slot.index, {
                                        outerStyle: { gridColumn: `span ${slot.span} / span ${slot.span}` },
                                        frameStyle: { height: slot.height },
                                      });
                                    })}
                                    {blank.trailing > 0 ? (
                                      <div style={{ gridColumn: `span ${blank.trailing} / span ${blank.trailing}` }} />
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-4">
                              {galleryImages.map((item, idx) =>
                                renderGalleryEditorCard(item, idx, {
                                  outerClass: getGalleryCardLayout(activePreset, idx, activeCustomLayout).itemClass,
                                  frameStyle: getGalleryCardLayout(activePreset, idx, activeCustomLayout).frameStyle,
                                }),
                              )}
                            </div>
                          )
                        ) : (
                          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">
                            {"暂无图片，先上传图"}
                          </div>
                        )}
                        </div>
                      </div>
                    </div>,
                  )
                : null}
            </>
          ) : (
            <>
              <h2
                className="text-xl font-bold whitespace-pre-wrap break-words mx-auto"
                style={galleryHeadingStyle}
                dangerouslySetInnerHTML={{ __html: toRichHtml(block.props.heading, "") }}
              />
              {previewImage ? (
                <div className="mt-3 mx-auto" style={galleryHeadingStyle}>
                  <div className="relative rounded-lg border border-gray-200 overflow-hidden" style={galleryFrameStyle}>
                  <div className="relative w-full h-full overflow-hidden">
                    {previewImage.fitToFrame ? (
                      <div
                        className="absolute inset-0"
                        style={{ overflow: "hidden" }}
                      >
                        <NextImage
                          src={previewImage.url}
                          alt=""
                          fill
                          unoptimized
                          sizes="100vw"
                          className="object-cover"
                          style={{
                            objectPosition: `calc(50% + ${previewImage.offsetX}px) calc(50% + ${previewImage.offsetY}px)`,
                          }}
                        />
                      </div>
                    ) : (
                      <div
                        className="absolute inset-0"
                        style={{
                          transform: `translate(${previewImage.offsetX}px, ${previewImage.offsetY}px) scale(${previewImage.scaleX}, ${previewImage.scaleY})`,
                          transformOrigin: "center center",
                        }}
                      >
                        <NextImage src={previewImage.url} alt="" fill unoptimized sizes="100vw" className="object-contain" />
                      </div>
                    )}
                  </div>
                  </div>
                </div>
              ) : (
                <div className="mt-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">
                  {"暂无图片"}
                </div>
              )}
            </>
          )}
          {resizeHandles}
        </div>
      </section>
    );
  }

  if (block.type === "nav") {
    const navItems = getNavItems();
    const localizedNavItems = navItems.map((item) => ({
      ...item,
      label: localizeSystemDefaultText(item.label ?? "", locale),
    }));
    const localizedNavHeading = resolveLocalizedSystemDefaultText(block.props.heading, "页面导航", locale);
    const selectedNavPageId = previewNavPageId || currentPageId;
    const orientation = block.props.navOrientation === "vertical" ? "vertical" : "horizontal";
    const navItemBgColor = (block.props.navItemBgColor ?? "#ffffff").trim() || "#ffffff";
    const navItemBgOpacity =
      typeof block.props.navItemBgOpacity === "number" && Number.isFinite(block.props.navItemBgOpacity)
        ? Math.max(0, Math.min(1, block.props.navItemBgOpacity))
        : 1;
    const navItemBorderStyle = (block.props.navItemBorderStyle ?? "solid") as BlockBorderStyle;
    const navItemBorderColor = normalizeNavBorderColor(block.props.navItemBorderColor ?? "#6b7280", "#6b7280");
    const navItemActiveBgColor = (block.props.navItemActiveBgColor ?? navItemBgColor).trim() || navItemBgColor;
    const navItemActiveBgOpacity =
      typeof block.props.navItemActiveBgOpacity === "number" && Number.isFinite(block.props.navItemActiveBgOpacity)
        ? Math.max(0, Math.min(1, block.props.navItemActiveBgOpacity))
        : navItemBgOpacity;
    const navItemActiveBorderStyle = (block.props.navItemActiveBorderStyle ?? navItemBorderStyle) as BlockBorderStyle;
    const navItemActiveBorderColor = normalizeNavBorderColor(
      block.props.navItemActiveBorderColor ?? navItemBorderColor,
      navItemBorderColor,
    );
    const navItemActiveTextColor = (block.props.navItemActiveTextColor ?? "").trim();
    const navItemButtonClass =
      "inline-flex max-w-full items-center justify-center rounded px-3 py-2 text-center text-sm leading-tight";
    const navItemButtonStyle = {
      ...getBlockBorderInlineStyle(navItemBorderStyle, navItemBorderColor),
      ...getColorLayerStyle(navItemBgColor, navItemBgOpacity),
    };
    const navItemActiveButtonStyle = {
      ...getBlockBorderInlineStyle(navItemActiveBorderStyle, navItemActiveBorderColor),
      ...getColorLayerStyle(navItemActiveBgColor, navItemActiveBgOpacity),
    };
    const navItemActiveLabelStyle = buildTypographyInlineStyle({
      fontColor: navItemActiveTextColor,
    });
    const mobileNavButtonBgColor = (block.props.mobileNavButtonBgColor ?? "#ffffff").trim() || "#ffffff";
    const mobileNavButtonBgOpacity =
      typeof block.props.mobileNavButtonBgOpacity === "number" && Number.isFinite(block.props.mobileNavButtonBgOpacity)
        ? Math.max(0, Math.min(1, block.props.mobileNavButtonBgOpacity))
        : 0.8;
    const mobileNavButtonBorderStyle = (block.props.mobileNavButtonBorderStyle ?? "solid") as BlockBorderStyle;
    const mobileNavButtonLineColor = (block.props.mobileNavButtonLineColor ?? "#334155").trim() || "#334155";
    const mobileNavButtonStyle = {
      ...getBlockBorderInlineStyle(mobileNavButtonBorderStyle, "#cbd5e1"),
      ...getColorLayerStyle(mobileNavButtonBgColor, mobileNavButtonBgOpacity),
    };
    const mobileHiddenNavMode = previewViewport === "mobile" && block.props.mobileNavDisplayMode === "hidden";
    const navCardClass = `${cardClass.replace("bg-white", "").trim()} relative`;
    const navBlockSizeStyle =
      orientation === "vertical"
        ? blockWidth
          ? blockSizeStyle
          : { ...blockSizeStyle, width: "max-content", maxWidth: "100%" }
        : blockSizeStyle;
    const renderNavPreviewButtons = (options?: { closeMenuOnClick?: boolean }) =>
      localizedNavItems.map((item) => {
        const isActive = item.pageId === selectedNavPageId;
        const labelHtml = toRichHtml(item.label, "");
        const renderedLabelHtml = isActive ? stripInlineTextColorStylesFromHtml(labelHtml) : labelHtml;
        return (
          <button
            key={`${options?.closeMenuOnClick ? "mobile" : "preview"}-${item.id}`}
            type="button"
            className={`${navItemButtonClass} ${options?.closeMenuOnClick ? "w-full" : ""} ${getBlockBorderClass(isActive ? navItemActiveBorderStyle : navItemBorderStyle)} ${
              isActive ? "" : "hover:brightness-[0.98]"
            }`}
            style={isActive ? navItemActiveButtonStyle : navItemButtonStyle}
            onClick={() => {
              onSelect();
              setPreviewNavPageId(item.pageId);
              if (options?.closeMenuOnClick) setPreviewNavMobileMenuOpen(false);
            }}
          >
            <span
              className="block w-full break-words whitespace-normal"
              style={isActive ? navItemActiveLabelStyle : undefined}
              dangerouslySetInnerHTML={{ __html: renderedLabelHtml }}
            />
          </button>
        );
      });
    const renderHiddenMobileNavPreview = () => {
      const hiddenMobileHeadingSegments = toInlineHeadingHtmlSegments(
        block.props.heading ? localizeSystemDefaultText(block.props.heading, locale) : "",
        localizedNavItems.find((item) => item.pageId === selectedNavPageId)?.label ?? localizedNavHeading,
        2,
      );
      return (
        <div>
          <div className="flex items-center justify-between gap-3">
            <button
              ref={previewNavButtonRef}
              type="button"
              className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition hover:brightness-[0.98] ${getBlockBorderClass(
                mobileNavButtonBorderStyle,
              )}`}
              aria-label={previewNavMobileMenuOpen ? "收起导航" : "展开导航"}
              style={mobileNavButtonStyle}
              onClick={() => {
                onSelect();
                setPreviewNavMobileMenuOpen((current) => !current);
              }}
            >
              <span className="inline-flex flex-col items-center justify-center gap-1.5">
                <span className="block h-0.5 w-4 rounded-full" style={{ backgroundColor: mobileNavButtonLineColor }} />
                <span className="block h-0.5 w-4 rounded-full" style={{ backgroundColor: mobileNavButtonLineColor }} />
                <span className="block h-0.5 w-4 rounded-full" style={{ backgroundColor: mobileNavButtonLineColor }} />
              </span>
            </button>
            <div className="min-w-0 flex-1 text-slate-700">
              <div
                className="truncate font-semibold leading-none [&_span]:inline [&_span]:align-middle"
                dangerouslySetInnerHTML={{ __html: hiddenMobileHeadingSegments[0] ?? "" }}
              />
              {hiddenMobileHeadingSegments[1] ? (
                <div
                  className="mt-1 truncate text-[11px] leading-tight text-slate-600 [&_span]:inline [&_span]:align-middle"
                  dangerouslySetInnerHTML={{ __html: hiddenMobileHeadingSegments[1] }}
                />
              ) : null}
            </div>
          </div>
        </div>
      );
    };
    const hiddenMobileNavPreviewPopup =
      mobileHiddenNavMode && previewNavMobileMenuOpen && previewNavMobileMenuPosition ? (
        createPortal(
          <div
            data-mobile-nav-popup="preview"
            className="pointer-events-auto fixed z-[2147483600] rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-2xl backdrop-blur"
            style={{
              top: `${previewNavMobileMenuPosition.top}px`,
              left: `${previewNavMobileMenuPosition.left}px`,
              width: `${previewNavMobileMenuPosition.width}px`,
            }}
          >
            <div className="flex flex-col items-stretch gap-2">{renderNavPreviewButtons({ closeMenuOnClick: true })}</div>
          </div>,
          document.body,
        )
      ) : null;
    return (
      <section
        data-block-id={block.id}
        data-jump-target={publicBlockId}
        data-block-public-id={publicBlockId}
        className={`${shellClass} pointer-events-none`}
        style={offsetStyle}
      >
        <EditorBlockHeader
          blockId={publicBlockId}
          draggingBlockId={draggingBlockId}
          isSelected={isSelected}
          onDragHandleMouseDown={onDragHandleMouseDown}
          onNudge={onNudge}
          onOpenLayerSettings={openLayerSettings}
          onEditTypography={editTypography}
          onInsertText={insertTextBox}
          onInsertImage={insertImage}
          onEditImageSettings={editImageSettings}
          onEditBorderStyle={editBorderSettings}
          isMobileViewport={previewViewport === "mobile"}
          mobileFitScreenWidth={block.props.mobileFitScreenWidth === true}
          onToggleMobileFitScreenWidth={handleToggleMobileFitScreenWidth}
          blockOpenByButton={blockOpenByButton}
          onToggleBlockOpenMode={toggleBlockOpenMode}
          onDelete={onDelete}
        />
        <div
          ref={resizeTargetRef}
          data-block-visual-boundary
          className={`${navCardClass} ${isSelected ? "!overflow-visible" : ""}`}
          onClick={onSelect}
          style={{ ...blockBackgroundStyle, ...navBlockSizeStyle, ...previewBorderInlineStyle }}
        >
          {imageDialog}
          {imageSettingsDialog}
          {borderSettingsDialog}
          {navItemStyleDialog}
          {layerSettingsDialog}
          {typographyDialog}
          {isSelected ? renderSelectedEditor(
            <div className="space-y-3">
              <RichTextEditor
                field="heading"
                className="border p-2 rounded w-full text-lg font-semibold"
                value={block.props.heading ?? ""}
                onChange={handleRichFieldChange}
                onActivate={registerActiveEditor}
                onSelectionChange={updateSelectionRange}
              />
              <div className="flex items-center gap-2 flex-nowrap overflow-visible">
                <span className="text-sm text-gray-600 whitespace-nowrap shrink-0">{"方向"}</span>
                <button
                  type="button"
                  className={`px-3 py-1 rounded border text-sm whitespace-nowrap shrink-0 ${
                    orientation === "horizontal" ? "bg-black text-white border-black" : "bg-white hover:bg-gray-50"
                  }`}
                  onClick={() => onChange({ navOrientation: "horizontal" })}
                >
                  {"横向"}
                </button>
                <button
                  type="button"
                  className={`px-3 py-1 rounded border text-sm whitespace-nowrap shrink-0 ${
                    orientation === "vertical" ? "bg-black text-white border-black" : "bg-white hover:bg-gray-50"
                  }`}
                  onClick={() => onChange({ navOrientation: "vertical" })}
                >
                  {"纵向"}
                </button>
                <span className="ml-4 text-sm text-gray-600 whitespace-nowrap shrink-0">{"栏目数量"}</span>
                <button
                  type="button"
                  className="w-8 h-8 rounded border bg-white hover:bg-gray-50 disabled:opacity-40 shrink-0"
                  onClick={removeNavItem}
                  disabled={navItems.length <= 1}
                >
                  -
                </button>
                <span className="min-w-[78px] text-center text-sm whitespace-nowrap shrink-0">
                  {navItems.length}/{effectiveMaxNavItems}
                </span>
                <button
                  type="button"
                  className="w-8 h-8 rounded border bg-white hover:bg-gray-50 disabled:opacity-40 shrink-0"
                  onClick={addNavItem}
                  disabled={navItems.length >= effectiveMaxNavItems}
                >
                  +
                </button>
                <button
                  type="button"
                  className="ml-3 px-3 py-1 rounded border bg-white hover:bg-gray-50 text-sm whitespace-nowrap shrink-0"
                  onClick={editNavItemStyle}
                >
                  栏目样式
                </button>
                <button
                  type="button"
                  className="px-3 py-1 rounded border bg-white hover:bg-gray-50 text-sm whitespace-nowrap shrink-0 disabled:opacity-40"
                  onClick={() => onApplyNavSettingsToOtherPages(block.id)}
                  disabled={availablePages.length <= 1}
                  title={availablePages.length <= 1 ? "当前只有一个页面" : "将当前页导航设置应用到其他页面"}
                >
                  导航栏对齐
                </button>
              </div>
              {previewViewport === "mobile" ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-gray-600 whitespace-nowrap shrink-0">{"手机导航"}</span>
                  <button
                    type="button"
                    className={`px-3 py-1 rounded border text-sm whitespace-nowrap shrink-0 ${
                      block.props.mobileNavDisplayMode === "hidden" ? "bg-white hover:bg-gray-50" : "bg-black text-white border-black"
                    }`}
                    onClick={() => {
                      setPreviewNavMobileMenuOpen(false);
                      onChange({ mobileNavDisplayMode: "inline" });
                    }}
                  >
                    {"常规"}
                  </button>
                  <button
                    type="button"
                    className={`px-3 py-1 rounded border text-sm whitespace-nowrap shrink-0 ${
                      block.props.mobileNavDisplayMode === "hidden" ? "bg-black text-white border-black" : "bg-white hover:bg-gray-50"
                    }`}
                    onClick={() => onChange({ mobileNavDisplayMode: "hidden" })}
                  >
                    {"隐藏式"}
                  </button>
                </div>
              ) : null}
              <div className="space-y-2">
                {navItems.map((item, idx) => (
                  <div key={item.id} className="grid grid-cols-[56px_1fr] gap-2 items-center">
                    <div className="text-xs text-gray-500">{"栏目"}{idx + 1}</div>
                    <RichTextEditor
                      field="text"
                      className="border rounded px-2 py-1 text-sm min-h-[34px]"
                      value={item.label}
                      dataNavItemId={item.id}
                      onChange={(_, html) => updateNavItem(item.id, { label: html })}
                      onActivate={registerActiveEditor}
                      onSelectionChange={updateSelectionRange}
                    />
                  </div>
                ))}
              </div>
              <div className={orientation === "vertical" ? "flex flex-col items-start gap-2 pt-1" : "flex flex-wrap gap-2 pt-1"}>
                {mobileHiddenNavMode ? renderHiddenMobileNavPreview() : renderNavPreviewButtons()}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {!mobileHiddenNavMode && block.props.heading ? (
                <div
                  className="text-sm font-semibold whitespace-pre-wrap break-words"
                  dangerouslySetInnerHTML={{ __html: toRichHtml(block.props.heading, localizedNavHeading) }}
                />
              ) : null}
              <div className={orientation === "vertical" ? "flex flex-col items-start gap-2" : "flex flex-wrap gap-2"}>
                {mobileHiddenNavMode ? renderHiddenMobileNavPreview() : renderNavPreviewButtons()}
              </div>
            </div>
          )}
          {resizeHandles}
        </div>
        {hiddenMobileNavPreviewPopup}
      </section>
    );
  }

  if (block.type === "chart") {
    const labels = Array.isArray(block.props.labels) ? block.props.labels.map((item) => item.trim()).filter(Boolean) : [];
    const values = Array.isArray(block.props.values)
      ? block.props.values
          .map((item) => (typeof item === "number" && Number.isFinite(item) ? item : Number(item)))
          .filter((item) => Number.isFinite(item))
      : [];
    const size = Math.min(labels.length, values.length);
    const pairs = labels.slice(0, size).map((label, idx) => ({ label, value: values[idx] }));
    const maxValue = pairs.length > 0 ? Math.max(...pairs.map((item) => item.value), 1) : 1;
    const chartType = block.props.chartType ?? "bar";

    return (
      <section
        data-block-id={block.id}
        data-jump-target={publicBlockId}
        data-block-public-id={publicBlockId}
        className={`${shellClass} pointer-events-none`}
        style={offsetStyle}
      >
        <EditorBlockHeader
          blockId={publicBlockId}
          draggingBlockId={draggingBlockId}
          isSelected={isSelected}
          onDragHandleMouseDown={onDragHandleMouseDown}
          onNudge={onNudge}
          onOpenLayerSettings={openLayerSettings}
          onEditTypography={editTypography}
          onInsertText={insertTextBox}
          onInsertImage={insertImage}
          onEditImageSettings={editImageSettings}
          onEditBorderStyle={editBorderSettings}
          isMobileViewport={previewViewport === "mobile"}
          mobileFitScreenWidth={block.props.mobileFitScreenWidth === true}
          onToggleMobileFitScreenWidth={handleToggleMobileFitScreenWidth}
          blockOpenByButton={blockOpenByButton}
          onToggleBlockOpenMode={toggleBlockOpenMode}
          onDelete={onDelete}
        />
        <div
          ref={resizeTargetRef}
          data-block-visual-boundary
          className={`${cardClass} relative`}
          onClick={onSelect}
          style={{ ...blockBackgroundStyle, ...blockSizeStyle, ...previewBorderInlineStyle }}
        >
          {imageDialog}
          {imageSettingsDialog}
          {borderSettingsDialog}
          {layerSettingsDialog}
          {typographyDialog}
          {isSelected ? renderSelectedEditor(
            <>
              <div className="space-y-1 mt-3">
                <RichTextEditor
                  field="heading"
                  className="border p-2 rounded w-full text-xl font-bold"
                  value={block.props.heading ?? ""}
                  onChange={handleRichFieldChange}
                  onActivate={registerActiveEditor}
                  onSelectionChange={updateSelectionRange}
                />
              </div>
              <div className="space-y-1 mt-3">
                <RichTextEditor
                  field="text"
                  className="border p-2 rounded w-full min-h-[90px] text-gray-700"
                  value={block.props.text ?? ""}
                  onChange={handleRichFieldChange}
                  onActivate={registerActiveEditor}
                  onSelectionChange={updateSelectionRange}
                />
              </div>
              <div className="space-y-2 mt-3">
                <select
                  className="border p-2 rounded w-full text-sm"
                  value={chartType}
                  onChange={(e) => onChange({ chartType: e.target.value as "bar" | "line" | "pie" })}
                >
                  <option value="bar">{"柱状"}</option>
                  <option value="line">{"折线"}</option>
                  <option value="pie">{"饼图"}</option>
                </select>
                <BufferedEditorTextarea
                  className="border p-2 rounded w-full min-h-[100px] text-gray-700"
                  placeholder={"标签：每行一个"}
                  value={labels.join("\n")}
                  onChange={(e) =>
                    onChange({
                      labels: e.target.value
                        .split("\n")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    })
                  }
                />
                <BufferedEditorTextarea
                  className="border p-2 rounded w-full min-h-[100px] text-gray-700"
                  placeholder={"数值：每行一个"}
                  value={values.join("\n")}
                  onChange={(e) =>
                    onChange({
                      values: e.target.value
                        .split("\n")
                        .map((item) => Number(item.trim()))
                        .filter((item) => Number.isFinite(item)),
                    })
                  }
                />
              </div>
            </>,
          ) : (
            <>
              <h2 className="text-xl font-bold whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: toRichHtml(block.props.heading, "") }} />
              <div
                className="mt-2 text-gray-600 whitespace-pre-wrap break-words"
                dangerouslySetInnerHTML={{ __html: toRichHtml(block.props.text, "") }}
              />
              {pairs.length > 0 ? (
                <div className="mt-3">
                  {chartType === "bar" ? (
                    <div className="space-y-2">
                      {pairs.map((item, idx) => (
                        <div key={`${item.label}-${idx}`} className="grid grid-cols-[90px_1fr_56px] items-center gap-2 text-sm">
                          <div className="truncate text-gray-500">{item.label}</div>
                          <div className="h-5 rounded bg-gray-100 overflow-hidden">
                            <div className="h-full bg-blue-500" style={{ width: `${Math.max(4, (item.value / maxValue) * 100)}%` }} />
                          </div>
                          <div className="text-right text-gray-700">{item.value}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {chartType === "line" ? (
                    <div className="rounded-lg border border-gray-200 p-3">
                      <svg viewBox="0 0 100 40" className="w-full h-36">
                        <polyline
                          fill="none"
                          stroke="#2563eb"
                          strokeWidth="2"
                          points={pairs
                            .map((item, idx) => {
                              const x = pairs.length <= 1 ? 50 : (idx / (pairs.length - 1)) * 100;
                              const y = 36 - (Math.max(0, item.value) / maxValue) * 32;
                              return `${x.toFixed(2)},${y.toFixed(2)}`;
                            })
                            .join(" ")}
                        />
                      </svg>
                    </div>
                  ) : null}
                  {chartType === "pie" ? (
                    <div className="text-sm text-gray-600 space-y-1">
                      {pairs.map((item, idx) => (
                        <div key={`${item.label}-${idx}`}>
                          {item.label}：{item.value}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="mt-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">
                  {"暂无图表数据"}
                </div>
              )}
            </>
          )}
          {resizeHandles}
        </div>
      </section>
    );
  }

  if (block.type === "music") {
    const musicStyle = block.props.musicPlayerStyle ?? "classic";
    const audioUrl = block.props.audioUrl ?? "";
    const musicWrapClass =
      musicStyle === "minimal"
        ? "mt-3 rounded-md border border-gray-200 bg-white/70 p-3"
        : musicStyle === "card"
          ? "mt-3 rounded-xl border border-gray-300 bg-gradient-to-r from-gray-50 to-white p-4 shadow-sm"
          : "mt-3";

    return (
      <section
        data-block-id={block.id}
        data-jump-target={publicBlockId}
        data-block-public-id={publicBlockId}
        className={`${shellClass} pointer-events-none`}
        style={offsetStyle}
      >
        <EditorBlockHeader
          blockId={publicBlockId}
          draggingBlockId={draggingBlockId}
          isSelected={isSelected}
          onDragHandleMouseDown={onDragHandleMouseDown}
          onNudge={onNudge}
          onOpenLayerSettings={openLayerSettings}
          onEditTypography={editTypography}
          onInsertText={insertTextBox}
          onInsertImage={insertImage}
          onEditImageSettings={editImageSettings}
          onEditBorderStyle={editBorderSettings}
          isMobileViewport={previewViewport === "mobile"}
          mobileFitScreenWidth={block.props.mobileFitScreenWidth === true}
          onToggleMobileFitScreenWidth={handleToggleMobileFitScreenWidth}
          blockOpenByButton={blockOpenByButton}
          onToggleBlockOpenMode={toggleBlockOpenMode}
          onDelete={onDelete}
        />
        <div
          ref={resizeTargetRef}
          data-block-visual-boundary
          className={`${cardClass} relative`}
          onClick={onSelect}
          style={{ ...blockBackgroundStyle, ...blockSizeStyle, ...previewBorderInlineStyle }}
        >
          {imageDialog}
          {imageSettingsDialog}
          {borderSettingsDialog}
          {layerSettingsDialog}
          {typographyDialog}
          {isSelected ? renderSelectedEditor(
            <>
              <div className="space-y-1 mt-3">
                <RichTextEditor
                  field="heading"
                  className="border p-2 rounded w-full text-xl font-bold"
                  value={block.props.heading ?? ""}
                  onChange={handleRichFieldChange}
                  onActivate={registerActiveEditor}
                  onSelectionChange={updateSelectionRange}
                />
              </div>
              <div className="space-y-2 mt-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
                    onClick={() => musicInputRef.current?.click()}
                  >
                    {"上传音频"}
                  </button>
                  <BufferedEditorInput
                    ref={musicInputRef}
                    className="hidden"
                    type="file"
                    accept="audio/*"
                    onChange={onUploadMusic}
                  />
                  <BufferedEditorInput
                    className="border p-2 rounded flex-1 min-w-[260px] text-sm"
                    placeholder={"输入音频 URL"}
                    value={audioUrl}
                    onChange={(e) => onChange({ audioUrl: e.target.value })}
                  />
                </div>
                <select
                  className="border p-2 rounded w-full text-sm"
                  value={musicStyle}
                  onChange={(e) =>
                    onChange({
                      musicPlayerStyle: e.target.value as "classic" | "minimal" | "card" | "hidden",
                    })
                  }
                >
                  <option value="classic">{"经典样式"}</option>
                  <option value="minimal">{"简约样式"}</option>
                  <option value="card">{"卡片样式"}</option>
                  <option value="hidden">{"隐藏样式"}</option>
                </select>
              </div>
              {musicStyle === "hidden" ? (
                <div className="mt-3 text-sm text-gray-500">{"当前样式为隐藏播放器"}</div>
              ) : audioUrl ? (
                <div className={musicWrapClass}>
                  <audio controls className="w-full" src={audioUrl} preload="metadata" />
                </div>
              ) : (
                <div className="mt-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">
                  {"暂无音频，请先上传音频"}
                </div>
              )}
            </>,
          ) : (
            <>
              <h2
                className="text-xl font-bold whitespace-pre-wrap break-words"
                dangerouslySetInnerHTML={{ __html: toRichHtml(block.props.heading, "") }}
              />
              {musicStyle === "hidden" ? (
                <div className="mt-3 text-sm text-gray-500">{"播放器已隐藏"}</div>
              ) : audioUrl ? (
                <div className={musicWrapClass}>
                  <audio controls className="w-full" src={audioUrl} preload="metadata" />
                </div>
              ) : (
                <div className="mt-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">
                  {"暂无音频"}
                </div>
              )}
            </>
          )}
          {resizeHandles}
        </div>
      </section>
    );
  }

  if (block.type === "hero") {
    return (
      <section
        ref={resizeTargetRef}
        data-block-visual-boundary
        data-block-id={block.id}
        data-jump-target={publicBlockId}
        data-block-public-id={publicBlockId}
        className={`${shellClass} pointer-events-none relative rounded-xl overflow-visible ${borderClass}`}
        style={{ ...blockBackgroundStyle, ...blockSizeStyle, ...offsetStyle, ...previewBorderInlineStyle }}
      >
        <EditorBlockHeader
          blockId={publicBlockId}
          draggingBlockId={draggingBlockId}
          isSelected={isSelected}
          onDragHandleMouseDown={onDragHandleMouseDown}
          onNudge={onNudge}
          onOpenLayerSettings={openLayerSettings}
          onEditTypography={editTypography}
          onInsertText={insertTextBox}
          onInsertImage={insertImage}
          onEditImageSettings={editImageSettings}
          onEditBorderStyle={editBorderSettings}
          isMobileViewport={previewViewport === "mobile"}
          mobileFitScreenWidth={block.props.mobileFitScreenWidth === true}
          onToggleMobileFitScreenWidth={handleToggleMobileFitScreenWidth}
          blockOpenByButton={blockOpenByButton}
          onToggleBlockOpenMode={toggleBlockOpenMode}
          onDelete={onDelete}
        />
        <div className={cardClass} onClick={onSelect}>
          {imageDialog}
          {imageSettingsDialog}
          {borderSettingsDialog}
          {layerSettingsDialog}
          {typographyDialog}
          {isSelected ? renderSelectedEditor(
            <>
              <div className="space-y-1 mt-3">
                <RichTextEditor
                  field="title"
                  className="border p-2 rounded w-full text-3xl font-bold"
                  value={block.props.title ?? ""}
                  onChange={handleRichFieldChange}
                  onActivate={registerActiveEditor}
                  onSelectionChange={updateSelectionRange}
                />
              </div>
              <div className="space-y-1 mt-3">
                <RichTextEditor
                  field="subtitle"
                  className="border p-2 rounded w-full text-gray-700 min-h-[90px]"
                  value={block.props.subtitle ?? ""}
                  onChange={handleRichFieldChange}
                  onActivate={registerActiveEditor}
                  onSelectionChange={updateSelectionRange}
                />
              </div>
            </>,
          ) : (
            <>
              <h1 className="text-3xl font-bold whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: toRichHtml(block.props.title, "") }} />
              <div
                className="mt-3 text-gray-600 whitespace-pre-wrap break-words"
                dangerouslySetInnerHTML={{ __html: toRichHtml(block.props.subtitle, "") }}
              />
            </>
          )}
        </div>
        {resizeHandles}
      </section>
    );
  }

  if (block.type === "text") {
    return (
      <section
        data-block-id={block.id}
        data-jump-target={publicBlockId}
        data-block-public-id={publicBlockId}
        className={`${shellClass} pointer-events-none`}
        style={offsetStyle}
      >
        <EditorBlockHeader
          blockId={publicBlockId}
          draggingBlockId={draggingBlockId}
          isSelected={isSelected}
          onDragHandleMouseDown={onDragHandleMouseDown}
          onNudge={onNudge}
          onOpenLayerSettings={openLayerSettings}
          onEditTypography={editTypography}
          onInsertText={insertTextBox}
          onInsertImage={insertImage}
          onEditImageSettings={editImageSettings}
          onEditBorderStyle={editBorderSettings}
          isMobileViewport={previewViewport === "mobile"}
          mobileFitScreenWidth={block.props.mobileFitScreenWidth === true}
          onToggleMobileFitScreenWidth={handleToggleMobileFitScreenWidth}
          blockOpenByButton={blockOpenByButton}
          onToggleBlockOpenMode={toggleBlockOpenMode}
          onDelete={onDelete}
        />
        <div
          ref={resizeTargetRef}
          data-block-visual-boundary
          className={`${cardClass} relative`}
          onClick={onSelect}
          style={{ ...blockBackgroundStyle, ...blockSizeStyle, ...previewBorderInlineStyle }}
        >
          {imageDialog}
          {imageSettingsDialog}
          {borderSettingsDialog}
          {layerSettingsDialog}
          {typographyDialog}
          {isSelected ? renderSelectedEditor(
            <>
              <div className="space-y-1 mt-3">
                <RichTextEditor
                  field="heading"
                  className="border p-2 rounded w-full text-xl font-bold"
                  value={block.props.heading ?? ""}
                  onChange={handleRichFieldChange}
                  onActivate={registerActiveEditor}
                  onSelectionChange={updateSelectionRange}
                />
              </div>
              <div className="space-y-1 mt-3">
                <RichTextEditor
                  field="text"
                  className="border p-2 rounded w-full min-h-[120px] text-gray-700"
                  value={block.props.text ?? ""}
                  onChange={handleRichFieldChange}
                  onActivate={registerActiveEditor}
                  onSelectionChange={updateSelectionRange}
                />
              </div>
            </>,
          ) : (
            <>
              <h2
                className="text-xl font-bold whitespace-pre-wrap break-words"
                dangerouslySetInnerHTML={{ __html: toRichHtml(block.props.heading, "") }}
              />
              <div
                className="mt-2 text-gray-600 whitespace-pre-wrap break-words"
                dangerouslySetInnerHTML={{ __html: toRichHtml(block.props.text, "") }}
              />
            </>
          )}
          {resizeHandles}
        </div>
      </section>
    );
  }

  if (block.type === "list") {
    const items = block.props.items ?? [];
    return (
      <section
        data-block-id={block.id}
        data-jump-target={publicBlockId}
        data-block-public-id={publicBlockId}
        className={`${shellClass} pointer-events-none`}
        style={offsetStyle}
      >
        <EditorBlockHeader
          blockId={publicBlockId}
          draggingBlockId={draggingBlockId}
          isSelected={isSelected}
          onDragHandleMouseDown={onDragHandleMouseDown}
          onNudge={onNudge}
          onOpenLayerSettings={openLayerSettings}
          onEditTypography={editTypography}
          onInsertText={insertTextBox}
          onInsertImage={insertImage}
          onEditImageSettings={editImageSettings}
          onEditBorderStyle={editBorderSettings}
          isMobileViewport={previewViewport === "mobile"}
          mobileFitScreenWidth={block.props.mobileFitScreenWidth === true}
          onToggleMobileFitScreenWidth={handleToggleMobileFitScreenWidth}
          blockOpenByButton={blockOpenByButton}
          onToggleBlockOpenMode={toggleBlockOpenMode}
          onDelete={onDelete}
        />
        <div
          ref={resizeTargetRef}
          data-block-visual-boundary
          className={`${cardClass} relative`}
          onClick={onSelect}
          style={{ ...blockBackgroundStyle, ...blockSizeStyle, ...previewBorderInlineStyle }}
        >
          {imageDialog}
          {imageSettingsDialog}
          {borderSettingsDialog}
          {layerSettingsDialog}
          {typographyDialog}
          {isSelected ? renderSelectedEditor(
            <>
              <div className="space-y-1 mt-3">
                <RichTextEditor
                  field="heading"
                  className="border p-2 rounded w-full text-xl font-bold"
                  value={block.props.heading ?? ""}
                  onChange={handleRichFieldChange}
                  onActivate={registerActiveEditor}
                  onSelectionChange={updateSelectionRange}
                />
              </div>
              <div className="space-y-2 mt-3">
                <BufferedEditorTextarea
                  className="border p-2 rounded w-full min-h-[140px] text-gray-700"
                  value={items.join("\n")}
                  onChange={(e) =>
                    onChange({
                      items: e.target.value
                        .split("\n")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </div>
            </>,
          ) : (
            <>
              <h2
                className="text-xl font-bold whitespace-pre-wrap break-words"
                dangerouslySetInnerHTML={{ __html: toRichHtml(block.props.heading, "") }}
              />
              {items.length > 0 ? (
                <ul className="mt-3 list-disc pl-6 text-gray-700 space-y-1">
                  {items.map((it, idx) => (
                    <li key={idx} dangerouslySetInnerHTML={{ __html: toRichHtml(it, "") }} />
                  ))}
                </ul>
              ) : null}
            </>
          )}
          {resizeHandles}
        </div>
      </section>
    );
  }

  if (block.type === "product") {
    const productItems = getProductItems();
    const productOperatingFieldsEditable = productOperatingCatalogState === "legacy";
    const productOperatingBrowsingRules =
      productOperatingCatalogState === "active" && productOperatingCatalog
        ? productOperatingCatalog.browsingRules
        : null;
    const hasProductOperatingBrowsingRules =
      productOperatingCatalogState === "active" && productOperatingBrowsingRules !== null;
    const productBrowsingRulesEditable =
      productOperatingCatalogState === "legacy" ||
      (productOperatingCatalogState === "active" && !hasProductOperatingBrowsingRules);
    const publishedProductSearchPlaceholder =
      (block.props.productSearchPlaceholder ?? "").trim();
    const productSearchEnabled =
      productOperatingBrowsingRules?.searchEnabled ??
      (block.props.productSearchEnabled !== false);
    const productBrowsingRulesSearchPlaceholder =
      (productOperatingBrowsingRules?.searchPlaceholder ?? publishedProductSearchPlaceholder).trim();
    const productSearchPlaceholder =
      productBrowsingRulesSearchPlaceholder || "搜索产品名称/编号/介绍";
    const productTagHideUnselected =
      productOperatingBrowsingRules?.hideUnselectedCategory ??
      (block.props.productTagHideUnselected !== false);
    const productGroupByTag =
      productOperatingBrowsingRules?.groupByCategory ??
      (block.props.productGroupByTag === true);
    const currentProductBrowsingRules: MerchantCatalogBrowsingRules = {
      searchEnabled: productSearchEnabled,
      searchPlaceholder: productBrowsingRulesSearchPlaceholder,
      hideUnselectedCategory: productTagHideUnselected,
      groupByCategory: productGroupByTag,
    };
    const openProductOperatingCatalog = () => {
      if (!onOpenOrderCatalog) return;
      onOpenOrderCatalog({
        blockId: block.id,
        viewport: previewViewport,
        productIds: [
          ...new Set(
            normalizeProductItems(block.props.products)
              .filter((product) => isMeaningfulProductItem(product))
              .map((product) => product.id),
          ),
        ],
        browsingRules: currentProductBrowsingRules,
      });
    };
    const productLayoutPreset = normalizeProductLayoutPreset(block.props.productLayoutPreset);
    const productContainerMode = normalizeProductContainerMode(block.props.productContainerMode);
    const productItemsPerPage = normalizeProductItemsPerPage(block.props.productItemsPerPage, productLayoutPreset);
    const productImageAspectRatio = normalizeProductImageAspectRatio(block.props.productImageAspectRatio);
    const rawProductImageSize =
      typeof block.props.productImageSize === "number" && Number.isFinite(block.props.productImageSize)
        ? Math.round(block.props.productImageSize)
        : 220;
    const productCardHeight = normalizeProductCardHeight(block.props.productCardHeight, rawProductImageSize + PRODUCT_LIST_CARD_VERTICAL_PADDING);
    const productImageMaxSize = productLayoutPreset === "list" ? productListImageMaxSize(productCardHeight) : PRODUCT_IMAGE_SIZE_MAX;
    const productImageSize = normalizeProductImageSize(rawProductImageSize, productImageMaxSize);
    const productPricePrefix =
      productOperatingCatalogState === "active" && productOperatingCatalog
        ? productOperatingCatalog.pricePrefix
        : productOperatingCatalogState === "legacy"
          ? (block.props.productPricePrefix ?? "").trim()
          : "";
    const productShowCode = block.props.productShowCode !== false;
    const productShowDescription = block.props.productShowDescription !== false;
    const productPriceAlign = normalizeProductPriceAlign(block.props.productPriceAlign);
    const productTagPosition = normalizeProductTagPosition(block.props.productTagPosition);
    const productTagBorderStyle = normalizeProductTagBorderStyle(block.props.productTagBorderStyle);
    const productTagTextAlign = normalizeProductPriceAlign(block.props.productTagTextAlign);
    const productTagFontSize =
      typeof block.props.productTagFontSize === "number" && Number.isFinite(block.props.productTagFontSize)
        ? Math.max(10, Math.min(28, Math.round(block.props.productTagFontSize)))
        : 12;
    const productTagWidth =
      typeof block.props.productTagWidth === "number" && Number.isFinite(block.props.productTagWidth)
        ? Math.max(56, Math.min(220, Math.round(block.props.productTagWidth)))
        : 92;
    const productTagRowGap = normalizeProductSpacing(block.props.productTagRowGap, 8, 0, 48);
    const productTagBgColor = (block.props.productTagBgColor ?? "#0f172a").trim() || "#0f172a";
    const productTagBgOpacity =
      typeof block.props.productTagBgOpacity === "number" && Number.isFinite(block.props.productTagBgOpacity)
        ? Math.max(0, Math.min(1, block.props.productTagBgOpacity))
        : 0.82;
    const productTagActiveBgColor = (block.props.productTagActiveBgColor ?? "#1d4ed8").trim() || "#1d4ed8";
    const productTagActiveBgOpacity =
      typeof block.props.productTagActiveBgOpacity === "number" && Number.isFinite(block.props.productTagActiveBgOpacity)
        ? Math.max(0, Math.min(1, block.props.productTagActiveBgOpacity))
        : 0.94;
    const productItemGap = normalizeProductSpacing(block.props.productItemGap, 16, 0, 48);
    const productCartQuantityMode = normalizeProductCartQuantityMode(block.props.productCartQuantityMode);
    const productCartButtonPosition = normalizeProductCartButtonPosition(block.props.productCartButtonPosition);
    const productHideScrollbar = block.props.productHideScrollbar === true;
    const productDetailImageSize =
      typeof block.props.productDetailImageSize === "number" && Number.isFinite(block.props.productDetailImageSize)
        ? Math.max(180, Math.min(720, Math.round(block.props.productDetailImageSize)))
        : 420;
    const productDetailShowCode = block.props.productDetailShowCode !== false;
    const productDetailShowName = block.props.productDetailShowName !== false;
    const productDetailShowDescription = block.props.productDetailShowDescription !== false;
    const productDetailShowPrice = block.props.productDetailShowPrice !== false;
    const productDetailFullImage = block.props.productDetailFullImage === true;
    const productCardBgColor = (block.props.productCardBgColor ?? "#ffffff").trim() || "#ffffff";
    const productCardBgOpacity =
      typeof block.props.productCardBgOpacity === "number" && Number.isFinite(block.props.productCardBgOpacity)
        ? Math.max(0, Math.min(1, block.props.productCardBgOpacity))
        : 0.9;
    const productCardBorderStyle = block.props.productCardBorderStyle ?? "solid";
    const productCardBorderColor = (block.props.productCardBorderColor ?? "#e2e8f0").trim() || "#e2e8f0";
    const productTypographyMeta: Record<
      ProductTypographyRole,
      { label: string; sample: string; helperText: string }
    > = {
      code: { label: "编号", sample: "SKU-001", helperText: "用于产品编号，例如 SKU-001。" },
      name: { label: "名称", sample: "示例产品", helperText: "用于产品名称标题。" },
      description: { label: "介绍", sample: "在这里填写产品卖点、规格或简短介绍。", helperText: "用于产品简介和详情介绍。" },
      price: { label: "价格", sample: `${productPricePrefix || "€"}39.90`, helperText: "用于价格文本。" },
    };
    const getProductTypographyStyle = (role: ProductTypographyRole): TypographyEditableProps | undefined => {
      switch (role) {
        case "code":
          return block.props.productCodeTypography;
        case "name":
          return block.props.productNameTypography;
        case "description":
          return block.props.productDescriptionTypography;
        case "price":
          return block.props.productPriceTypography;
      }
    };
    const normalizeProductTypographyStyle = (style: TypographyEditableProps): TypographyEditableProps => {
      const next: TypographyEditableProps = {};
      const fontFamily = (style.fontFamily ?? "").trim();
      const fontColor = (style.fontColor ?? "").trim();
      if (fontFamily) next.fontFamily = fontFamily;
      if (typeof style.fontSize === "number" && Number.isFinite(style.fontSize) && style.fontSize > 0) next.fontSize = style.fontSize;
      if (style.fontWeight) next.fontWeight = style.fontWeight;
      if (style.fontStyle) next.fontStyle = style.fontStyle;
      if (style.textDecoration) next.textDecoration = style.textDecoration;
      if (fontColor) next.fontColor = fontColor;
      return next;
    };
    const updateProductTypographyStyle = (
      role: ProductTypographyRole,
      patch: Partial<TypographyEditableProps> | null,
    ) => {
      const current = getProductTypographyStyle(role) ?? {};
      const nextStyle = patch === null ? {} : normalizeProductTypographyStyle({ ...current, ...patch } as TypographyEditableProps);
      switch (role) {
        case "code":
          onChange({ productCodeTypography: nextStyle });
          return;
        case "name":
          onChange({ productNameTypography: nextStyle });
          return;
        case "description":
          onChange({ productDescriptionTypography: nextStyle });
          return;
        case "price":
          onChange({ productPriceTypography: nextStyle });
          return;
      }
    };
    const productCodeTextStyle = buildTypographyInlineStyle(block.props.productCodeTypography);
    const productNameTextStyle = buildTypographyInlineStyle(block.props.productNameTypography);
    const productDescriptionTextStyle = buildTypographyInlineStyle(block.props.productDescriptionTypography);
    const productPriceTextStyle = buildTypographyInlineStyle(block.props.productPriceTypography);
    const updateProductImageSize = (nextValue: number) => {
      onChange({
        productImageSize: normalizeProductImageSize(nextValue, productImageMaxSize),
        productCardHeight,
      });
    };
    const updateProductCardHeight = (nextValue: number) => {
      const nextCardHeight = normalizeProductCardHeight(nextValue, productImageSize + PRODUCT_LIST_CARD_VERTICAL_PADDING);
      const nextImageMaxSize = productLayoutPreset === "list" ? productListImageMaxSize(nextCardHeight) : PRODUCT_IMAGE_SIZE_MAX;
      onChange({
        productCardHeight: nextCardHeight,
        productImageSize: normalizeProductImageSize(productImageSize, nextImageMaxSize),
      });
    };
    const productPricePrefixMode = PRODUCT_PRICE_PREFIX_OPTIONS.some((item) => item.value === productPricePrefix)
      ? productPricePrefix
      : "__custom__";
    const compactProductEditor = typeof blockWidth === "number" && blockWidth <= 420;
    const hasProductHeading = hasVisibleRichText(block.props.heading);
    const hasProductText = hasVisibleRichText(block.props.text);
    const productSearchKeyword = productPreviewSearchByBlockId[block.id] ?? "";
    const savedProductTagOptions =
      productOperatingCatalogState === "active" && productOperatingCatalog
        ? normalizeProductTagOptions(productOperatingCatalog.categoryNames)
        : productOperatingCatalogState === "legacy"
          ? normalizeProductTagOptions(block.props.productTagOptions)
          : [];
    const productTagOptionsText = productOperatingFieldsEditable
      ? productTagOptionsDraftByBlockId[block.id] ?? savedProductTagOptions.join("\n")
      : savedProductTagOptions.join("\n");
    const productTagOptions = Array.from(
      new Set([
        ...normalizeProductTagOptions(productTagOptionsText.split(/\r?\n/)),
        ...savedProductTagOptions,
        ...productItems.map((item) => item.tag).filter(Boolean),
      ]),
    );
    const productTags = productTagOptions;
    const arrangedProductItems = arrangeProductItemsByTag(productItems, productTags, productGroupByTag);
    const productSectionCollapsed = productSettingsCollapsedByBlockId[block.id] ?? {};
    const isProductSectionCollapsed = (section: ProductSettingsSectionKey) =>
      productSectionCollapsed[section] ?? (section !== "basic");
    const toggleProductSettingsSection = (section: ProductSettingsSectionKey) => {
      setProductSettingsCollapsedByBlockId((current) => ({
        ...current,
        [block.id]: {
          ...(current[block.id] ?? {}),
          [section]: !(current[block.id]?.[section] ?? (section !== "basic")),
        },
      }));
    };
    const rawActiveProductTag = productPreviewTagByBlockId[block.id] ?? null;
    const activeProductTag = rawActiveProductTag && productTags.includes(rawActiveProductTag) ? rawActiveProductTag : null;
    const searchMatchedProductItems = productSearchEnabled
      ? filterProductItemsByKeyword(arrangedProductItems, productSearchKeyword)
      : arrangedProductItems;
    const filteredProductItems =
      productTagHideUnselected && activeProductTag
        ? searchMatchedProductItems.filter((item) => item.tag === activeProductTag)
        : searchMatchedProductItems;
    const previewPageCount =
      productContainerMode === "paged" ? Math.max(1, Math.ceil(filteredProductItems.length / productItemsPerPage)) : 1;
    const rawPreviewPageIndex = productPreviewPageByBlockId[block.id] ?? 0;
    const previewPageIndex = Math.min(rawPreviewPageIndex, Math.max(0, previewPageCount - 1));
    const previewStartIndex = previewPageIndex * productItemsPerPage;
    const previewItems =
      productContainerMode === "paged"
        ? filteredProductItems.slice(previewStartIndex, previewStartIndex + productItemsPerPage)
        : filteredProductItems;
    const previewScrollViewportHeight =
      productContainerMode === "scroll"
        ? productContainerViewportHeight(productLayoutPreset, productImageSize, productItemsPerPage, productItemGap, productCardHeight)
        : null;
    const detailPreviewProduct =
      productDetailPreview?.blockId === block.id
        ? arrangedProductItems.find((item) => item.id === productDetailPreview.itemId) ?? arrangedProductItems[0] ?? null
        : null;
    const editingProductItem =
      productEditorDialogState?.blockId === block.id && productEditorDialogState.mode === "edit"
        ? getProductItems().find((item) => item.id === productEditorDialogState.itemId) ?? null
        : null;
    const activeProductEditorDraft =
      productEditorDialogState?.blockId === block.id ? productEditorDraft : null;
    const productPlaceholderCount =
      productContainerMode === "paged" && productLayoutPreset !== "spotlight"
        ? Math.max(0, productItemsPerPage - previewItems.length)
        : 0;
    const productRatioPair =
      productImageAspectRatio === "landscape"
        ? { width: 4, height: 3 }
        : productImageAspectRatio === "portrait"
          ? { width: 3, height: 4 }
          : { width: 1, height: 1 };
    const productDetailImageWidth = Math.max(
      180,
      Math.round((productDetailImageSize * productRatioPair.width) / productRatioPair.height),
    );
    const productListImageWidth = Math.max(1, Math.round((productImageSize * productRatioPair.width) / productRatioPair.height));
    const productListImageEdgeInset = productListImageEdgeGap(productCardHeight, productImageSize);
    const productCardBackgroundStyle = getColorLayerStyle(productCardBgColor, productCardBgOpacity);
    const productCardBorderClass = getBlockBorderClass(productCardBorderStyle);
    const productCardBorderInlineStyle = getBlockBorderInlineStyle(productCardBorderStyle, productCardBorderColor);
    const productPriceAlignClass =
      productPriceAlign === "center"
        ? "justify-center text-center"
        : productPriceAlign === "right"
          ? "justify-end text-right"
          : "justify-start text-left";
    const productDetailPriceAlignClass = productPriceAlignClass;
    const applyProductTagOptions = (rawValue: string) => {
      if (!productOperatingFieldsEditable) return;
      const nextOptions = Array.from(new Set(rawValue.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)));
      const allowed = new Set(nextOptions);
      const nextItems = getProductItems().map((item) => (item.tag && !allowed.has(item.tag) ? { ...item, tag: "" } : item));
      commitProductItems(nextItems);
      onChange({ productTagOptions: nextOptions });
      setProductTagOptionsDraftByBlockId((current) => ({
        ...current,
        [block.id]: nextOptions.join("\n"),
      }));
      setProductPreviewTagByBlockId((current) => ({
        ...current,
        [block.id]: current[block.id] && allowed.has(current[block.id] as string) ? current[block.id] : null,
      }));
    };
    const openProductItemEditor = (itemId: string) => {
      const targetItem = getProductItems().find((item) => item.id === itemId);
      if (!targetItem) return;
      setProductEditorDraft({ ...targetItem });
      setProductEditorDialogState({ blockId: block.id, itemId, mode: "edit" });
    };
    const closeProductItemEditor = () => {
      setProductEditorDialogState((current) => (current?.blockId === block.id ? null : current));
      setProductEditorDraft(null);
    };
    const deleteEditingProductItem = () => {
      if (!editingProductItem) return;
      removeProductItem(editingProductItem.id);
      closeProductItemEditor();
    };
    const updateProductEditorDraft = (patch: Partial<ProductEditorItem>) => {
      setProductEditorDraft((current) => (current ? { ...current, ...patch } : current));
    };
    const saveProductEditorDraft = () => {
      if (block.type !== "product" || productEditorDialogState?.blockId !== block.id || !activeProductEditorDraft) return;
      const normalizedDraft = normalizeProductItems([activeProductEditorDraft])[0];
      if (!normalizedDraft) return;
      const nextItems =
        productEditorDialogState.mode === "create"
          ? [...getProductItems(), normalizedDraft]
          : getProductItems().map((item) => (item.id === normalizedDraft.id ? normalizedDraft : item));
      commitProductItems(nextItems);
      closeProductItemEditor();
    };
    const handleProductTagOptionsDraftChange = (rawValue: string) => {
      if (!productOperatingFieldsEditable) return;
      setProductTagOptionsDraftByBlockId((current) => ({
        ...current,
        [block.id]: rawValue,
      }));
    };
    const getProductGroupTagKey = (tag: string) => encodeURIComponent((tag || "untagged").trim() || "untagged");
    const handlePreviewTagSelect = (tag: string | null) => {
      setProductPreviewTagByBlockId((current) => ({
        ...current,
        [block.id]: tag,
      }));
      const scrollToPreviewItem = (targetId: string | null) => {
        if (!targetId) return;
        requestAnimationFrame(() => {
          const viewport = productPreviewScrollViewportRefs.current[block.id];
          const selector = `[data-product-preview-item-id="${targetId}"]`;
          const target = viewport?.querySelector<HTMLElement>(selector) ?? document.querySelector<HTMLElement>(selector);
          if (!target) return;
          if (viewport) {
            const offset = target.offsetTop - viewport.offsetTop;
            viewport.scrollTo({ top: Math.max(0, offset), behavior: "smooth" });
            return;
          }
          target.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
        });
      };
      const scrollToPreviewGroup = (targetTag: string | null) => {
        if (!targetTag) return;
        const targetKey = getProductGroupTagKey(targetTag);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const viewport = productPreviewScrollViewportRefs.current[block.id];
            const root = productPreviewRootRefs.current[block.id];
            const selector = `[data-product-preview-group-key="${targetKey}"]`;
            const target = root?.querySelector<HTMLElement>(selector) ?? document.querySelector<HTMLElement>(selector);
            if (!target) return;
            if (viewport && viewport.contains(target)) {
              const offset = target.offsetTop - viewport.offsetTop;
              viewport.scrollTo({ top: Math.max(0, offset), behavior: "smooth" });
              return;
            }
            target.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
          });
        });
      };
      if (tag == null) {
        setProductPreviewPageByBlockId((current) => ({
          ...current,
          [block.id]: 0,
        }));
        requestAnimationFrame(() => {
          productPreviewScrollViewportRefs.current[block.id]?.scrollTo({ top: 0, behavior: "smooth" });
        });
        return;
      }
      const sourceItems = searchMatchedProductItems;
      const firstMatchIndex = sourceItems.findIndex((item) => item.tag === tag);
      if (firstMatchIndex < 0) return;
      if (productContainerMode === "paged") {
        setProductPreviewPageByBlockId((current) => ({
          ...current,
          [block.id]: Math.floor(firstMatchIndex / productItemsPerPage),
        }));
        if (productGroupByTag) {
          scrollToPreviewGroup(tag);
          return;
        }
        requestAnimationFrame(() => {
          productPreviewScrollViewportRefs.current[block.id]?.scrollTo({ top: 0, behavior: "smooth" });
        });
        return;
      }
      if (productGroupByTag) {
        scrollToPreviewGroup(tag);
        return;
      }
      scrollToPreviewItem(sourceItems[firstMatchIndex]?.id ?? null);
    };
    const handleProductPreviewSearchChange = (rawValue: string) => {
      setProductPreviewSearchByBlockId((current) => ({
        ...current,
        [block.id]: rawValue,
      }));
      setProductPreviewPageByBlockId((current) => ({
        ...current,
        [block.id]: 0,
      }));
      requestAnimationFrame(() => {
        productPreviewScrollViewportRefs.current[block.id]?.scrollTo({ top: 0, behavior: "auto" });
      });
    };
    const getProductLineClampStyle = (lines: number) =>
      ({
        display: "-webkit-box",
        WebkitLineClamp: lines,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
      }) as CSSProperties;
    const getProductImageFrameStyle = (options: { list?: boolean; featured?: boolean; editor?: boolean } = {}) => {
      if (options.list) {
        return {
          width: `${productListImageWidth}px`,
          maxWidth: "100%",
          height: `${productImageSize}px`,
        };
      }
      if (options.editor) {
        return {
          width: `${Math.max(40, Math.round((productImageSize * productRatioPair.width) / productRatioPair.height))}px`,
          maxWidth: "100%",
          height: `${productImageSize}px`,
        };
      }
      return {
        width: "100%",
        height: `${options.featured ? productImageSize + 60 : productImageSize}px`,
      };
    };

    const renderProductPlaceholder = (key: string, options: { list?: boolean } = {}) => {
      const placeholderCardStyle = options.list
        ? ({
            "--product-list-card-height": `${productCardHeight}px`,
            paddingTop: `${productListImageEdgeInset}px`,
            paddingBottom: `${productListImageEdgeInset}px`,
            paddingLeft: `${productListImageEdgeInset}px`,
          } as CSSProperties)
        : undefined;
      return (
        <div
          key={key}
          aria-hidden="true"
          className={
            options.list
              ? "invisible flex h-[var(--product-list-card-height)] max-h-[var(--product-list-card-height)] w-full flex-col gap-4 p-4 sm:flex-row"
              : "invisible flex h-full w-full flex-col"
          }
          style={placeholderCardStyle}
        >
          <div
            className={`relative overflow-hidden bg-slate-100 ${options.list ? "shrink-0 self-center rounded-lg" : ""}`}
            style={getProductImageFrameStyle(options)}
          />
          <div className={options.list ? "flex min-w-0 flex-1 flex-col" : "flex min-h-[170px] flex-1 flex-col p-4"} />
        </div>
      );
    };

    const renderProductCard = (
      item: ProductEditorItem,
      options: { list?: boolean; featured?: boolean; editable?: boolean } = {},
    ) => {
      const priceText = productPriceText(item.price, productPricePrefix);
      const textWrapStyle = { overflowWrap: "anywhere" as const, wordBreak: "break-word" as const };
      const productDescriptionClampStyle = getProductLineClampStyle(options.featured ? 5 : options.list ? 4 : 3);
      const productCartButtonPositionClass = productCartButtonPosition === "bottom" ? "bottom-3" : "top-3";
      const productListCardStyle = options.list
        ? ({
            "--product-list-card-height": `${productCardHeight}px`,
            paddingTop: `${productListImageEdgeInset}px`,
            paddingBottom: `${productListImageEdgeInset}px`,
            paddingLeft: `${productListImageEdgeInset}px`,
          } as CSSProperties)
        : undefined;
      const productListPricePositionStyle = options.list
        ? ({
            left: `${productListImageEdgeInset + productListImageWidth + 16}px`,
            right: productCartButtonPosition === "bottom" ? "4rem" : "0.75rem",
            bottom: `${Math.max(8, productListImageEdgeInset)}px`,
          } as CSSProperties)
        : undefined;
      return (
        <article
          key={item.id}
          data-product-preview-item-id={item.id}
          className={`relative overflow-hidden rounded-xl shadow-sm ${productCardBorderClass} ${
            options.list
              ? "flex h-[var(--product-list-card-height)] max-h-[var(--product-list-card-height)] flex-col gap-4 p-4 sm:flex-row"
              : "flex h-full flex-col"
          } ${options.featured ? "lg:min-h-[360px]" : ""} ${options.editable ? "cursor-pointer transition hover:-translate-y-0.5 hover:shadow-md" : ""}`}
          style={{ ...productCardBackgroundStyle, ...productCardBorderInlineStyle, ...productListCardStyle }}
          onClick={options.editable ? () => openProductItemEditor(item.id) : undefined}
        >
          {productCartQuantityMode === "plus-only" ? (
              <button
                type="button"
                className={`absolute right-3 ${productCartButtonPositionClass} z-[2] flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-lg font-semibold text-slate-700 shadow-sm backdrop-blur transition hover:bg-slate-100`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                aria-label="增加购买数量"
              >
                +
              </button>
            ) : (
              <div className={`absolute right-3 ${productCartButtonPositionClass} z-[2] flex items-center gap-1 rounded-full border border-slate-200 bg-white/95 px-1.5 py-1 shadow-sm backdrop-blur`}>
                <button
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-base font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  disabled
                  aria-label="减少购买数量"
                >
                  -
                </button>
                <div className="min-w-[1.5rem] text-center text-xs font-semibold text-slate-700">0</div>
                <button
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-base font-semibold text-slate-700 transition hover:bg-slate-100"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  aria-label="增加购买数量"
                >
                  +
                </button>
              </div>
            )}
          <div
            className={`relative overflow-hidden bg-slate-100 ${options.list ? "shrink-0 self-center rounded-lg" : ""}`}
            style={getProductImageFrameStyle(options)}
          >
            {item.imageUrl ? (
              <NextImage
                src={normalizePublicAssetUrl(item.imageUrl)}
                alt={item.name || item.code || "产品图片"}
                fill
                unoptimized
                sizes="100vw"
                className="object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">{"暂无图片"}</div>
            )}
          </div>
          <div className={options.list ? "flex min-w-0 flex-1 flex-col pb-10" : "flex min-h-[170px] flex-1 flex-col p-4"}>
            {productShowCode && item.code ? (
              <div
                className="text-[11px] uppercase tracking-[0.2em] text-slate-500"
                style={{ ...textWrapStyle, ...productCodeTextStyle }}
              >
                {item.code}
              </div>
            ) : null}
            <div className="mt-2 text-lg font-semibold text-slate-900" style={{ ...textWrapStyle, ...productNameTextStyle }}>
              {item.name || "未命名产品"}
            </div>
            {productShowDescription && item.description ? (
              <div
                className="mt-2 text-sm leading-6 text-slate-600"
                style={{ ...textWrapStyle, ...productDescriptionClampStyle, ...productDescriptionTextStyle }}
              >
                {item.description}
              </div>
            ) : null}
            {priceText ? (
              <div
                className={`${
                  options.list
                    ? "absolute z-[1] flex min-h-[2rem] items-end text-lg font-semibold text-sky-700"
                    : "mt-auto flex min-h-[2.75rem] w-full shrink-0 items-end pt-4 text-lg font-semibold text-sky-700"
                } ${productPriceAlignClass}`}
                style={productListPricePositionStyle}
              >
                <div className="w-full" style={productPriceTextStyle}>
                  {priceText}
                </div>
              </div>
            ) : null}
          </div>
        </article>
      );
    };

    const renderProductGroupHeading = (label: string, key: string) => (
      <div key={key} data-product-preview-group-key={getProductGroupTagKey(label)} className="flex items-center gap-3">
        <div className="h-px flex-1 bg-slate-200" />
        <div className="shrink-0 text-sm font-semibold tracking-[0.08em] text-slate-700">{label || "未分类"}</div>
        <div className="h-px flex-1 bg-slate-200" />
      </div>
    );

    const renderProductSearchBar = () =>
      productSearchEnabled && productItems.length > 0 ? (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <BufferedEditorInput
              type="search"
              value={productSearchKeyword}
              onChange={(event) => handleProductPreviewSearchChange(event.target.value)}
              placeholder={productSearchPlaceholder}
              className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-700 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-200 md:px-3 md:py-2 md:text-sm"
            />
            {productSearchKeyword.trim() ? (
              <button
                type="button"
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-700 transition hover:bg-slate-50 md:px-3 md:py-2"
                onClick={() => handleProductPreviewSearchChange("")}
              >
                清空
              </button>
            ) : null}
          </div>
        </div>
      ) : null;

    const renderProductPreviewCollection = (
      items: ProductEditorItem[],
      options: { placeholderPrefix: string; includePlaceholders: boolean },
    ) => {
      if (productLayoutPreset === "spotlight" && items[0]) {
        const featured = items[0];
        const secondary = items.slice(1);
        return (
          <div className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]" style={{ gap: `${productItemGap}px` }}>
            {renderProductCard(featured, { featured: true, editable: true })}
            <div className="grid sm:grid-cols-2 lg:grid-cols-1" style={{ gap: `${productItemGap}px` }}>
              {secondary.map((item) => renderProductCard(item, { editable: true }))}
            </div>
          </div>
        );
      }
      if (productLayoutPreset === "list") {
        return (
          <div className="flex flex-col" style={{ gap: `${productItemGap}px` }}>
            {items.map((item) => renderProductCard(item, { list: true, editable: true }))}
            {options.includePlaceholders
              ? Array.from({ length: productPlaceholderCount }, (_, index) =>
                  renderProductPlaceholder(`${options.placeholderPrefix}-list-${index}`, { list: true }),
                )
              : null}
          </div>
        );
      }
      return (
        <div className={productGridClass(productLayoutPreset)} style={{ gap: `${productItemGap}px` }}>
          {items.map((item) => renderProductCard(item, { editable: true }))}
          {options.includePlaceholders
            ? Array.from({ length: productPlaceholderCount }, (_, index) =>
                renderProductPlaceholder(`${options.placeholderPrefix}-grid-${index}`),
              )
            : null}
        </div>
      );
    };

    const renderProductPreview = () => {
      if (filteredProductItems.length === 0) {
        return (
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">
            {productSearchKeyword.trim()
              ? `未找到与“${productSearchKeyword.trim()}”匹配的产品。`
              : activeProductTag
                ? `当前分类“${activeProductTag}”下暂无产品。`
                : "暂无产品，请先新增产品或导入数据。"}
          </div>
        );
      }

      if (productGroupByTag) {
        const groups = groupArrangedProductItemsByTag(previewItems);
        return (
          <div className="mt-4 space-y-6">
            {groups.map((group, index) => (
              <div key={`${group.tag || "untagged"}-${index}`} className="space-y-4">
                {renderProductGroupHeading(group.tag, `product-preview-group-${group.tag || "untagged"}-${index}`)}
                {renderProductPreviewCollection(group.items, {
                  placeholderPrefix: `product-preview-group-${group.tag || "untagged"}-${index}`,
                  includePlaceholders: false,
                })}
              </div>
            ))}
          </div>
        );
      }

      return (
        <div className="mt-4">
          {renderProductPreviewCollection(previewItems, {
            placeholderPrefix: "product-preview",
            includePlaceholders: true,
          })}
        </div>
      );
    };

    const renderProductPreviewWithFilters = () => {
      const contentBody = (
        <div
          ref={(node) => {
            productPreviewRootRefs.current[block.id] = node;
          }}
        >
          {renderProductPreview()}
        </div>
      );
      const content = productContainerMode === "scroll" && previewScrollViewportHeight ? (
        <div
          ref={(node) => {
            productPreviewScrollViewportRefs.current[block.id] = node;
          }}
          className={`min-w-0 overflow-y-auto ${productHideScrollbar ? "faolla-hide-scrollbar pr-0" : "pr-1"}`}
          style={{ maxHeight: `${previewScrollViewportHeight}px` }}
        >
          {contentBody}
        </div>
      ) : (
        contentBody
      );

      if (productTagPosition === "left") {
        return (
          <>
            {renderProductSearchBar()}
            <div className="mt-4 grid gap-4 lg:grid-cols-[auto_minmax(0,1fr)]">
              {renderProductTagFilters()}
              <div className="min-w-0">{content}</div>
            </div>
          </>
        );
      }

      if (productTagPosition === "right") {
        return (
          <>
            {renderProductSearchBar()}
            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0">{content}</div>
              {renderProductTagFilters()}
            </div>
          </>
        );
      }

      return (
        <>
          {renderProductSearchBar()}
          {renderProductTagFilters()}
          {content}
        </>
      );
    };

    const renderProductTagFilters = () => {
      if (productTags.length === 0) return null;
      const filterItems = [
        ...(productTagHideUnselected ? [{ key: "__all__", label: "全部", value: null as string | null }] : []),
        ...productTags.map((tag) => ({ key: tag, label: tag, value: tag })),
      ];
      return (
        <div
          className={
            productTagPosition === "top"
              ? "mt-4 flex flex-wrap"
              : productTagPosition === "left"
                ? "mt-4 mr-4 flex float-left w-max flex-col items-start"
                : "mt-4 ml-4 flex float-right w-max flex-col items-end"
          }
          style={{ gap: `${productTagRowGap}px` }}
        >
          {filterItems.map((filter, index) => {
            const active = filter.value === null ? activeProductTag === null : activeProductTag === filter.value;
            const color = active ? productTagActiveBgColor : productTagBgColor;
            return (
              <button
                key={filter.key}
                type="button"
                className={`inline-flex min-h-[2.25rem] items-center truncate px-3 py-1.5 transition-opacity ${
                  active ? "ring-2 ring-slate-900/30 shadow-sm" : ""
                }`}
                style={{
                  ...buildProductTagButtonStyle({
                    borderStyle: productTagBorderStyle,
                    active,
                    bgColor: productTagBgColor,
                    bgOpacity: productTagBgOpacity,
                    activeBgColor: productTagActiveBgColor,
                    activeBgOpacity: productTagActiveBgOpacity,
                    fontSize: productTagFontSize,
                    textAlign: productTagTextAlign,
                    width: productTagWidth,
                  }),
                  ...buildProductTagDividerStyle(productTagBorderStyle, color, productTagPosition, index, filterItems.length),
                }}
                onClick={() => handlePreviewTagSelect(filter.value)}
              >
                <span className="min-w-0 truncate" style={{ width: "100%", textAlign: productTagTextAlign }}>
                  {filter.label}
                </span>
              </button>
            );
          })}
        </div>
      );
    };

    const renderProductSettingsHeader = (section: ProductSettingsSectionKey, title: string) => {
      const collapsed = isProductSectionCollapsed(section);
      return (
        <button
          type="button"
          className="flex w-full items-center justify-between text-left"
          onClick={() => toggleProductSettingsSection(section)}
        >
          <div className="text-sm font-medium text-slate-700">{title}</div>
          <div className="text-xs text-slate-500">{collapsed ? "展开" : "收起"}</div>
        </button>
      );
    };

    const renderProductSettingsSection = (
      section: ProductSettingsSectionKey,
      title: string,
      content: ReactNode,
      options: { wrapperClassName?: string; bodyClassName?: string } = {},
    ) => {
      const collapsed = isProductSectionCollapsed(section);
      return (
        <div className={options.wrapperClassName ?? "rounded-lg border border-slate-200 bg-slate-50 p-4"}>
          {renderProductSettingsHeader(section, title)}
          {!collapsed ? <div className={options.bodyClassName ?? "mt-3"}>{content}</div> : null}
        </div>
      );
    };

    const renderProductBrowsingRulesOwnershipNotice = () => {
      if (productOperatingCatalogState === "legacy") return null;
      const message =
        productOperatingCatalogState === "active"
          ? hasProductOperatingBrowsingRules
            ? "浏览规则由订单工作台管理，此处按经营目录设置真实预览。"
            : "浏览规则尚由网站设置，可迁入工作台。"
          : productOperatingCatalogState === "loading"
            ? "正在核对工作台浏览规则，完成前暂不可编辑。"
            : "浏览规则绑定待修复，为避免覆盖经营设置暂不可编辑。";
      return (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-800">
          <span>{message}</span>
          {onOpenOrderCatalog && productOperatingCatalogState !== "loading" ? (
            <button
              type="button"
              onClick={openProductOperatingCatalog}
              className="shrink-0 rounded border border-sky-300 bg-white px-2.5 py-1.5 font-semibold text-sky-800 hover:bg-sky-100"
            >
              {productOperatingCatalogState === "active" && !hasProductOperatingBrowsingRules
                ? "迁入工作台"
                : productOperatingCatalogState === "blocked"
                  ? "去工作台修复"
                  : "去工作台管理"}
            </button>
          ) : null}
        </div>
      );
    };

    const renderProductInventorySection = (compact = false) =>
      renderProductSettingsSection(
        "products",
        "产品",
        <div className="space-y-3">
          <div className={`rounded-xl border px-4 py-3 ${
            productOperatingCatalogState === "active"
              ? "border-emerald-200 bg-emerald-50"
              : productOperatingCatalogState === "blocked"
                ? "border-amber-200 bg-amber-50"
                : productOperatingCatalogState === "loading"
                  ? "border-slate-200 bg-slate-50"
                  : "border-sky-200 bg-sky-50"
          }`}>
            <div className="text-sm font-semibold text-slate-900">
              {productOperatingCatalogState === "active"
                ? "商品经营数据已移至订单工作台"
                : productOperatingCatalogState === "blocked"
                  ? "商品目录绑定需要修复"
                  : productOperatingCatalogState === "loading"
                    ? "正在核对工作台商品目录"
                    : "在订单工作台管理商品经营数据"}
            </div>
            <div className="mt-1 text-xs leading-5 text-slate-600">
              {productOperatingCatalogState === "active"
                ? "该区块的名称、编号、价格、分类和可售状态以工作台目录为准；这里继续管理布局、样式和展示文案。"
                : productOperatingCatalogState === "blocked"
                  ? "当前区块无法安全解析工作台目录。为避免旧商品或旧价格重新上线，经营字段已锁定；请打开工作台修复区块绑定。"
                  : productOperatingCatalogState === "loading"
                    ? "核对完成前暂不开放旧商品编辑，以免覆盖已经迁移的经营数据。"
                    : "建立经营目录后，商品和价格可直接在工作台更新，无需修改并重新发布网站。建立前仍可使用下方兼容编辑。"}
            </div>
            {onOpenOrderCatalog ? (
              <button
                type="button"
                className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
                onClick={openProductOperatingCatalog}
              >
                打开订单工作台商品目录
              </button>
            ) : null}
          </div>
          {productOperatingCatalogState !== "legacy" ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
              {productOperatingCatalogState === "blocked"
                ? "旧商品草稿不会用于修复当前绑定，也不会重新控制线上报价。请使用上方入口完成绑定。"
                : productOperatingCatalogState === "loading"
                  ? "正在读取经营目录，旧商品草稿暂时锁定。"
                  : "兼容商品草稿已不再控制该区块的线上商品与报价。如需修改商品，请使用上方入口。"}
            </div>
          ) : (
            <>
          <div className={compact ? "grid grid-cols-2 gap-3" : "grid grid-cols-3 gap-3"}>
            <button
              type="button"
              className="rounded border bg-white px-3 py-2 text-sm hover:bg-gray-50"
              onClick={() => productExcelInputRef.current?.click()}
            >
              {"导入 Excel"}
            </button>
            <button
              type="button"
              className="rounded border bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={productImageUploading}
              onClick={() => productImageBatchInputRef.current?.click()}
            >
              {productImageUploading ? "正在上传..." : "按编号导入图片"}
            </button>
            <button
              type="button"
              className={`${compact ? "col-span-2 " : ""}rounded border bg-white px-3 py-2 text-sm hover:bg-gray-50`}
              onClick={addProductItem}
            >
              {"新增产品"}
            </button>
          </div>
          <div className="text-xs text-gray-500">
            {"图片批量导入会按文件名匹配产品编号，例如 SKU-001.jpg -> SKU-001。Excel 支持列名：编号、名称、介绍、价格、分类/标签。"}
          </div>
          {renderProductPreviewWithFilters()}
          {renderProductPager()}
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
            {productItems.length === 0
              ? "暂无产品，点击“新增产品”后会直接打开编辑弹窗。"
              : "点击上方产品预览中的任意产品，可直接弹窗编辑该产品；新增产品也会直接打开编辑弹窗。"}
          </div>
            </>
          )}
        </div>,
        { bodyClassName: "mt-3" },
      );

    const getProductTypographyPreviewClassName = (role: ProductTypographyRole) => {
      switch (role) {
        case "code":
          return "text-[11px] uppercase tracking-[0.2em] text-slate-500";
        case "name":
          return "text-lg font-semibold text-slate-900";
        case "description":
          return "text-sm leading-6 text-slate-600";
        case "price":
          return "text-lg font-semibold text-sky-700";
      }
    };

    const renderProductTypographyControls = (compact = false) => (
      <div className="space-y-4">
        {(Object.keys(productTypographyMeta) as ProductTypographyRole[]).map((role) => {
          const currentStyle = getProductTypographyStyle(role) ?? {};
          const previewStyle = buildTypographyInlineStyle(currentStyle);
          const hasCustomTypography =
            !!currentStyle.fontFamily ||
            typeof currentStyle.fontSize === "number" ||
            !!currentStyle.fontWeight ||
            !!currentStyle.fontStyle ||
            !!currentStyle.textDecoration ||
            !!currentStyle.fontColor;
          return (
            <div key={role} className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
              <div className={`flex flex-wrap items-center gap-3 ${compact ? "" : "justify-between"}`}>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
                  <div className="shrink-0 text-sm font-medium text-slate-700">{productTypographyMeta[role].label}</div>
                  <div className="shrink-0 text-xs text-slate-500">预览</div>
                  <div className="min-w-[140px] flex-1 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2">
                    <div className={getProductTypographyPreviewClassName(role)} style={previewStyle}>
                      {productTypographyMeta[role].sample}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="rounded border bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!hasCustomTypography}
                  onClick={() => updateProductTypographyStyle(role, null)}
                >
                  恢复默认
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex min-w-[240px] flex-1 items-center gap-2 text-sm">
                  <span className="shrink-0 text-gray-600">字体</span>
                  <select
                    className="min-w-0 flex-1 rounded border bg-white px-3 py-2"
                    value={currentStyle.fontFamily ?? ""}
                    onChange={(event) => updateProductTypographyStyle(role, { fontFamily: event.target.value })}
                  >
                    <option value="">默认</option>
                    {FONT_FAMILY_OPTIONS.map((font) => (
                      <option key={`product-typography-${role}-${font}`} value={font}>
                        {font}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <span className="shrink-0 text-gray-600">字号</span>
                  <select
                    className="min-w-[96px] rounded border bg-white px-3 py-2"
                    value={typeof currentStyle.fontSize === "number" ? String(currentStyle.fontSize) : ""}
                    onChange={(event) =>
                      updateProductTypographyStyle(role, {
                        fontSize: event.target.value ? Number(event.target.value) : undefined,
                      })
                    }
                  >
                    <option value="">默认</option>
                    {FONT_SIZE_OPTIONS.map((size) => (
                      <option key={`product-typography-size-${role}-${size}`} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={`rounded border px-3 py-2 text-sm ${currentStyle.fontWeight === "bold" ? "bg-black text-white" : "bg-white"}`}
                    onClick={() => updateProductTypographyStyle(role, { fontWeight: currentStyle.fontWeight === "bold" ? undefined : "bold" })}
                  >
                    B
                  </button>
                  <button
                    type="button"
                    className={`rounded border px-3 py-2 text-sm ${currentStyle.fontStyle === "italic" ? "bg-black text-white" : "bg-white"}`}
                    onClick={() => updateProductTypographyStyle(role, { fontStyle: currentStyle.fontStyle === "italic" ? undefined : "italic" })}
                  >
                    I
                  </button>
                  <button
                    type="button"
                    className={`rounded border px-3 py-2 text-sm ${currentStyle.textDecoration === "underline" ? "bg-black text-white" : "bg-white"}`}
                    onClick={() =>
                      updateProductTypographyStyle(role, {
                        textDecoration: currentStyle.textDecoration === "underline" ? undefined : "underline",
                      })
                    }
                  >
                    U
                  </button>
                </div>
              </div>
              <div className={`grid gap-3 ${compact ? "grid-cols-1" : "lg:grid-cols-[240px_minmax(312px,auto)]"}`}>
                <label className="flex min-w-0 items-center gap-2 text-sm">
                  <span className="shrink-0 text-gray-600">颜色</span>
                  <div className="w-[180px] min-w-0">
                    <ColorOrGradientPicker
                      value={(currentStyle.fontColor ?? "#111827").trim() || "#111827"}
                      onChange={(value) => updateProductTypographyStyle(role, { fontColor: value })}
                    />
                  </div>
                </label>
                <div className="flex min-w-0 items-center gap-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <RecentColorBar
                      colors={recentColors}
                      onClear={onClearRecentColors}
                      onPick={(color) => updateProductTypographyStyle(role, { fontColor: color })}
                      allowGradients
                      selectedValue={(currentStyle.fontColor ?? "#111827").trim() || "#111827"}
                      compact
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );

    const renderProductPager = () =>
      productContainerMode === "paged" && previewPageCount > 1 ? (
        <div className="mt-5 flex items-center justify-center gap-3">
          <button
            type="button"
            className="rounded-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() =>
              setProductPreviewPageByBlockId((current) => ({
                ...current,
                [block.id]: Math.max(0, previewPageIndex - 1),
              }))
            }
            disabled={previewPageIndex === 0}
          >
            上一页
          </button>
          <div className="text-sm text-slate-600">{`${previewPageIndex + 1} / ${previewPageCount}`}</div>
          <button
            type="button"
            className="rounded-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() =>
              setProductPreviewPageByBlockId((current) => ({
                ...current,
                [block.id]: Math.min(previewPageCount - 1, previewPageIndex + 1),
              }))
            }
            disabled={previewPageIndex >= previewPageCount - 1}
          >
            下一页
          </button>
        </div>
      ) : null;

    const openProductDetailPreview = () => {
      const target = productItems[0];
      if (!target) {
        onAlert("请先新增产品后再预览详情页。");
        return;
      }
      setProductDetailPreview({ blockId: block.id, itemId: target.id });
    };

    const productDetailPreviewDialog =
      detailPreviewProduct !== null
        ? renderOverlay(
            <div data-editor-overlay className="fixed inset-0 z-[2147483600] bg-black/50 p-4">
              <div className="mx-auto flex h-full max-w-5xl items-center justify-center">
                <div className="relative max-h-[90vh] w-full overflow-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-6">
                  <button
                    type="button"
                    className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-2xl leading-none text-slate-600 hover:bg-slate-50"
                    onClick={() => setProductDetailPreview(null)}
                    aria-label="关闭"
                  >
                    ×
                  </button>
                  <div className="mb-4 text-sm font-medium text-slate-500">详情页预览</div>
                  {productDetailFullImage ? (
                    <div className="relative overflow-hidden rounded-[1.25rem] bg-slate-100" style={{ height: "min(88vh, 960px)", minHeight: "min(88vh, 960px)" }}>
                      {detailPreviewProduct.imageUrl ? (
                        <NextImage
                          src={normalizePublicAssetUrl(detailPreviewProduct.imageUrl)}
                          alt={detailPreviewProduct.name || detailPreviewProduct.code || "产品图片"}
                          fill
                          unoptimized
                          sizes="100vw"
                          className="object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-sm text-slate-400">暂无图片</div>
                      )}
                      {productDetailShowCode || productDetailShowName || productDetailShowDescription || productDetailShowPrice ? (
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent p-5 text-white sm:p-7">
                          <div className="mx-auto max-w-3xl">
                            {productDetailShowCode && detailPreviewProduct.code ? (
                              <div className="text-xs uppercase tracking-[0.24em] text-white/75" style={productCodeTextStyle}>
                                {detailPreviewProduct.code}
                              </div>
                            ) : null}
                            {productDetailShowName ? (
                              <h3 className="mt-2 break-words text-2xl font-semibold text-white sm:text-3xl" style={productNameTextStyle}>
                                {detailPreviewProduct.name || "未命名产品"}
                              </h3>
                            ) : null}
                            {productDetailShowDescription && detailPreviewProduct.description ? (
                              <div
                                className="mt-3 break-words whitespace-pre-wrap text-sm leading-7 text-white/90 sm:text-base"
                                style={productDescriptionTextStyle}
                              >
                                {detailPreviewProduct.description}
                              </div>
                            ) : null}
                            {productDetailShowPrice && productPriceText(detailPreviewProduct.price, productPricePrefix) ? (
                              <div className={`mt-4 flex w-full text-2xl font-semibold text-white ${productDetailPriceAlignClass}`}>
                                <div className="w-full" style={productPriceTextStyle}>
                                  {productPriceText(detailPreviewProduct.price, productPricePrefix)}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
                      <div
                        className="relative overflow-hidden rounded-2xl bg-slate-100"
                        style={{
                          width: "100%",
                          maxWidth: `${productDetailImageWidth}px`,
                          aspectRatio: `${productRatioPair.width} / ${productRatioPair.height}`,
                        }}
                      >
                        {detailPreviewProduct.imageUrl ? (
                          <NextImage
                            src={detailPreviewProduct.imageUrl}
                            alt={detailPreviewProduct.name || detailPreviewProduct.code || "产品图片"}
                            fill
                            unoptimized
                            sizes="100vw"
                            className="object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-sm text-slate-400">暂无图片</div>
                        )}
                      </div>
                      <div className="flex min-h-full flex-col">
                        {productDetailShowCode && detailPreviewProduct.code ? (
                          <div className="text-xs uppercase tracking-[0.24em] text-slate-500" style={productCodeTextStyle}>
                            {detailPreviewProduct.code}
                          </div>
                        ) : null}
                        {productDetailShowName ? (
                          <h3 className="mt-2 break-words text-2xl font-semibold text-slate-900" style={productNameTextStyle}>
                            {detailPreviewProduct.name || "未命名产品"}
                          </h3>
                        ) : null}
                        {productDetailShowDescription && detailPreviewProduct.description ? (
                          <div className="mt-4 break-words whitespace-pre-wrap text-sm leading-7 text-slate-600" style={productDescriptionTextStyle}>
                            {detailPreviewProduct.description}
                          </div>
                        ) : null}
                        {productDetailShowPrice && productPriceText(detailPreviewProduct.price, productPricePrefix) ? (
                          <div className={`mt-auto flex w-full pt-6 text-2xl font-semibold text-sky-700 ${productDetailPriceAlignClass}`}>
                            <div className="w-full" style={productPriceTextStyle}>
                              {productPriceText(detailPreviewProduct.price, productPricePrefix)}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        : null;
    const productItemEditorDialog =
      activeProductEditorDraft !== null
        ? renderOverlay(
            <div data-editor-overlay className="fixed inset-0 z-[2147483600] bg-black/50 p-4">
              <div className="mx-auto flex h-full max-w-4xl items-center justify-center">
                <div className="relative max-h-[90vh] w-full overflow-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-6">
                  <button
                    type="button"
                    className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-2xl leading-none text-slate-600 hover:bg-slate-50"
                    onClick={closeProductItemEditor}
                    aria-label="关闭"
                  >
                    ×
                  </button>
                  <div className="flex flex-wrap items-start justify-between gap-3 pr-12">
                    <div>
                      <div className="text-xs font-medium uppercase tracking-[0.2em] text-slate-400">
                        {productEditorDialogState?.mode === "create" ? "新增产品" : "产品编辑"}
                      </div>
                      <div className="mt-1 text-lg font-semibold text-slate-900">
                        {activeProductEditorDraft.name || activeProductEditorDraft.code || "未命名产品"}
                      </div>
                    </div>
                    {productEditorDialogState?.mode === "edit" ? (
                      <button
                        type="button"
                        className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600 hover:bg-rose-100"
                        onClick={deleteEditingProductItem}
                      >
                        删除产品
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-5 grid gap-5 lg:grid-cols-[200px_minmax(0,1fr)]">
                    <div>
                      <div
                        className={`relative overflow-hidden rounded-lg border bg-slate-100 ${productLayoutPreset === "list" ? "shrink-0 self-start" : ""}`}
                        style={getProductImageFrameStyle({ list: productLayoutPreset === "list", editor: true })}
                      >
                        {activeProductEditorDraft.imageUrl ? (
                          <NextImage
                            src={normalizePublicAssetUrl(activeProductEditorDraft.imageUrl)}
                            alt={activeProductEditorDraft.name || activeProductEditorDraft.code || "产品图片"}
                            fill
                            unoptimized
                            sizes="240px"
                            className="object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-sm text-slate-400">暂无图片</div>
                        )}
                      </div>
                      <label
                        className={`mt-3 inline-flex items-center rounded border bg-white px-3 py-2 text-sm ${
                          productImageUploading ? "cursor-wait opacity-60" : "cursor-pointer hover:bg-gray-50"
                        }`}
                      >
                        {productImageUploading ? "正在上传..." : "上传图片"}
                        <BufferedEditorInput
                          className="hidden"
                          type="file"
                          accept="image/*"
                          disabled={productImageUploading}
                          onChange={async (event) => {
                            const uploadedImage = await persistProductImageUpload(event);
                            if (!uploadedImage?.value) return;
                            updateProductEditorDraft({
                              imageUrl: uploadedImage.value,
                              thumbnailUrl: uploadedImage.thumbnailUrl ?? "",
                            });
                          }}
                        />
                      </label>
                    </div>
                    <div className={`grid gap-3 ${compactProductEditor ? "grid-cols-1" : "md:grid-cols-2"}`}>
                      <label className="text-sm text-gray-600">
                        <div className="mb-1">编号</div>
                        <BufferedEditorInput
                          className="w-full rounded border px-3 py-2"
                          value={activeProductEditorDraft.code}
                          onChange={(event) => updateProductEditorDraft({ code: event.target.value })}
                          placeholder="SKU-001"
                        />
                      </label>
                      <label className="text-sm text-gray-600">
                        <div className="mb-1">价格</div>
                        <BufferedEditorInput
                          className="w-full rounded border px-3 py-2"
                          value={activeProductEditorDraft.price}
                          onChange={(event) => updateProductEditorDraft({ price: event.target.value })}
                          placeholder="39.90"
                        />
                      </label>
                      <label className={`text-sm text-gray-600 ${compactProductEditor ? "" : "md:col-span-2"}`}>
                        <div className="mb-1">选择分类</div>
                        <select
                          className="w-full rounded border px-3 py-2 bg-white"
                          value={activeProductEditorDraft.tag}
                          onChange={(event) => updateProductEditorDraft({ tag: event.target.value })}
                        >
                          <option value="">未分类</option>
                          {productTagOptions.map((tag) => (
                            <option key={`${activeProductEditorDraft.id}-${tag}`} value={tag}>
                              {tag}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={`text-sm text-gray-600 ${compactProductEditor ? "" : "md:col-span-2"}`}>
                        <div className="mb-1">名称</div>
                        <BufferedEditorInput
                          className="w-full rounded border px-3 py-2"
                          value={activeProductEditorDraft.name}
                          onChange={(event) => updateProductEditorDraft({ name: event.target.value })}
                          placeholder="输入产品名称"
                        />
                      </label>
                      <label className={`text-sm text-gray-600 ${compactProductEditor ? "" : "md:col-span-2"}`}>
                        <div className="mb-1">介绍</div>
                        <BufferedEditorTextarea
                          className="min-h-[150px] w-full rounded border px-3 py-2"
                          value={activeProductEditorDraft.description}
                          onChange={(event) => updateProductEditorDraft({ description: event.target.value })}
                          placeholder="输入产品介绍、规格或卖点"
                        />
                      </label>
                    </div>
                  </div>
                  <div className="mt-6 flex justify-end gap-3">
                    <button
                      type="button"
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                      onClick={closeProductItemEditor}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800"
                      onClick={saveProductEditorDraft}
                    >
                      保存产品
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )
        : null;

    return (
      <section
        data-block-id={block.id}
        data-jump-target={publicBlockId}
        data-block-public-id={publicBlockId}
        className={`${shellClass} pointer-events-none`}
        style={offsetStyle}
      >
        <EditorBlockHeader
          blockId={publicBlockId}
          draggingBlockId={draggingBlockId}
          isSelected={isSelected}
          onDragHandleMouseDown={onDragHandleMouseDown}
          onNudge={onNudge}
          onOpenLayerSettings={openLayerSettings}
          onEditTypography={editTypography}
          onInsertText={insertTextBox}
          onInsertImage={insertImage}
          onEditImageSettings={editImageSettings}
          onEditBorderStyle={editBorderSettings}
          isMobileViewport={previewViewport === "mobile"}
          mobileFitScreenWidth={block.props.mobileFitScreenWidth === true}
          onToggleMobileFitScreenWidth={handleToggleMobileFitScreenWidth}
          blockOpenByButton={blockOpenByButton}
          onToggleBlockOpenMode={toggleBlockOpenMode}
          onDelete={onDelete}
        />
        <div
          ref={resizeTargetRef}
          data-block-visual-boundary
          className={`${cardClass} relative`}
          onClick={onSelect}
          style={blockPreviewShellStyle}
        >
          {imageDialog}
          {imageSettingsDialog}
          {borderSettingsDialog}
          {layerSettingsDialog}
          {typographyDialog}
          {isSelected ? renderSelectedEditor(
            <div className={compactProductEditor ? "pb-1" : undefined}>
              <BufferedEditorInput
                ref={productExcelInputRef}
                className="hidden"
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(event) => {
                  void onImportProductSheet(event);
                }}
              />
              <BufferedEditorInput
                ref={productImageBatchInputRef}
                className="hidden"
                type="file"
                accept="image/*"
                multiple
                disabled={productImageUploading}
                onChange={(event) => {
                  void onImportProductImages(event);
                }}
              />
              <div className="space-y-1 mt-3">
                <RichTextEditor
                  field="heading"
                  className="border p-2 rounded w-full text-xl font-bold"
                  value={block.props.heading ?? ""}
                  onChange={handleRichFieldChange}
                  onActivate={registerActiveEditor}
                  onSelectionChange={updateSelectionRange}
                />
              </div>
              <div className="space-y-1 mt-3">
                <RichTextEditor
                  field="text"
                  className="border p-2 rounded w-full min-h-[90px] text-gray-700"
                  value={block.props.text ?? ""}
                  onChange={handleRichFieldChange}
                  onActivate={registerActiveEditor}
                  onSelectionChange={updateSelectionRange}
                />
              </div>
              {compactProductEditor ? (
                <div className="mt-4 space-y-4">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    {renderProductSettingsHeader("basic", "基础展示")}
                    {!isProductSectionCollapsed("basic") ? (
                      <div className="mt-3 space-y-3">
                  <div className="grid gap-3 md:grid-cols-4">
                    <label className="space-y-1 text-sm">
                      <span className="block text-gray-600">排列方式</span>
                      <select
                        className="w-full rounded border bg-white px-3 py-1.5"
                        value={productLayoutPreset}
                        onChange={(event) => onChange({ productLayoutPreset: event.target.value as ProductLayoutPreset })}
                      >
                        {PRODUCT_LAYOUT_OPTIONS.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1 text-sm">
                      <span className="block text-gray-600">图片比例</span>
                      <select
                        className="w-full rounded border bg-white px-3 py-1.5"
                        value={productImageAspectRatio}
                        onChange={(event) => onChange({ productImageAspectRatio: event.target.value as ProductImageAspectRatio })}
                      >
                        {PRODUCT_IMAGE_ASPECT_OPTIONS.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="block space-y-1.5 text-sm">
                    <span className="block text-gray-600">图片尺寸</span>
                    <div className="flex items-center gap-2.5">
                      <BufferedEditorInput
                        type="range"
                        min={PRODUCT_IMAGE_SIZE_MIN}
                        max={productImageMaxSize}
                        step={1}
                        className="flex-1"
                        value={productImageSize}
                        onChange={(event) => updateProductImageSize(Number(event.target.value))}
                      />
                      <BufferedEditorInput
                        type="number"
                        min={PRODUCT_IMAGE_SIZE_MIN}
                        max={productImageMaxSize}
                        className="w-20 rounded border px-2 py-1.5"
                        value={productImageSize}
                        onChange={(event) =>
                          updateProductImageSize(Number(event.target.value))
                        }
                      />
                    </div>
                  </label>
                  <div className="grid gap-2 text-sm text-gray-700 sm:grid-cols-2">
                    <label className="flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-1.5">
                      <BufferedEditorInput
                        type="checkbox"
                        checked={productShowCode}
                        onChange={(event) => onChange({ productShowCode: event.target.checked })}
                      />
                      <span>显示编号</span>
                    </label>
                    <label className="flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-1.5">
                      <BufferedEditorInput
                        type="checkbox"
                        checked={productShowDescription}
                        onChange={(event) => onChange({ productShowDescription: event.target.checked })}
                      />
                      <span>显示介绍</span>
                    </label>
                  </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                    {renderProductSettingsHeader("tags", "分类标签样式")}
                    {!isProductSectionCollapsed("tags") ? (
                      <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-3">
                    <label className="space-y-1 text-sm">
                      <span className="block text-gray-600">标签位置</span>
                      <select
                        className="w-full rounded border px-3 py-2 bg-white"
                        value={productTagPosition}
                        onChange={(event) => onChange({ productTagPosition: event.target.value as ProductTagPosition })}
                      >
                        {PRODUCT_TAG_POSITION_OPTIONS.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1 text-sm">
                      <span className="block text-gray-600">底框样式</span>
                      <select
                        className="w-full rounded border px-3 py-2 bg-white"
                        value={productTagBorderStyle}
                        onChange={(event) => onChange({ productTagBorderStyle: event.target.value as ProductTagBorderStyle })}
                      >
                        {PRODUCT_TAG_BORDER_STYLE_OPTIONS.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1 text-sm">
                      <span className="block text-gray-600">文字对齐</span>
                      <select
                        className="w-full rounded border px-3 py-2 bg-white"
                        value={productTagTextAlign}
                        onChange={(event) => onChange({ productTagTextAlign: event.target.value as ProductPriceAlign })}
                      >
                        {PRODUCT_PRICE_ALIGN_OPTIONS.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block space-y-2 text-sm">
                      <span className="block text-gray-600">字体大小</span>
                      <div className="flex items-center gap-3">
                        <BufferedEditorInput
                          type="range"
                          min={10}
                          max={28}
                          step={1}
                          className="flex-1"
                          value={productTagFontSize}
                          onChange={(event) => onChange({ productTagFontSize: Number(event.target.value) })}
                        />
                        <BufferedEditorInput
                          type="number"
                          min={10}
                          max={28}
                          className="w-20 rounded border px-2 py-2"
                          value={productTagFontSize}
                          onChange={(event) =>
                            onChange({ productTagFontSize: Math.max(10, Math.min(28, Number(event.target.value) || 10)) })
                          }
                        />
                      </div>
                    </label>
                    <label className="block space-y-2 text-sm">
                      <span className="block text-gray-600">标签尺寸</span>
                      <div className="flex items-center gap-3">
                        <BufferedEditorInput
                          type="range"
                          min={56}
                          max={220}
                          step={4}
                          className="flex-1"
                          value={productTagWidth}
                          onChange={(event) => onChange({ productTagWidth: Number(event.target.value) })}
                        />
                        <BufferedEditorInput
                          type="number"
                          min={56}
                          max={220}
                          className="w-20 rounded border px-2 py-2"
                          value={productTagWidth}
                          onChange={(event) =>
                            onChange({ productTagWidth: Math.max(56, Math.min(220, Number(event.target.value) || 56)) })
                          }
                        />
                      </div>
                    </label>
                    <label className="block space-y-2 text-sm">
                      <span className="block text-gray-600">分类行距</span>
                      <div className="flex items-center gap-3">
                        <BufferedEditorInput
                          type="range"
                          min={0}
                          max={48}
                          step={1}
                          className="flex-1"
                          value={productTagRowGap}
                          onChange={(event) => onChange({ productTagRowGap: Number(event.target.value) })}
                        />
                        <BufferedEditorInput
                          type="number"
                          min={0}
                          max={48}
                          className="w-20 rounded border px-2 py-2"
                          value={productTagRowGap}
                          onChange={(event) =>
                            onChange({ productTagRowGap: Math.max(0, Math.min(48, Number(event.target.value) || 0)) })
                          }
                        />
                      </div>
                    </label>
                    </div>
                    {renderProductBrowsingRulesOwnershipNotice()}
                    <div className="grid gap-3 text-sm text-gray-700 sm:grid-cols-2">
                      <label className="flex items-center gap-2">
                        <BufferedEditorInput
                          type="checkbox"
                          checked={productTagHideUnselected}
                          disabled={!productBrowsingRulesEditable}
                          onChange={(event) => onChange({ productTagHideUnselected: event.target.checked })}
                        />
                        <span>隐藏未选中</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <BufferedEditorInput
                          type="checkbox"
                          checked={productGroupByTag}
                          disabled={!productBrowsingRulesEditable}
                          onChange={(event) => onChange({ productGroupByTag: event.target.checked })}
                        />
                        <span>按分类排列</span>
                      </label>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                        <div className="text-xs font-medium text-slate-700">默认样式</div>
                        <ColorOrGradientPicker value={productTagBgColor} onChange={(value) => onChange({ productTagBgColor: value })} />
                        <RecentColorBar
                          colors={recentColors}
                          onClear={onClearRecentColors}
                          onPick={(color) => onChange({ productTagBgColor: color })}
                          allowGradients
                          selectedValue={productTagBgColor}
                        />
                        <label className="block space-y-2 text-sm">
                          <span className="block text-gray-600">透明度：{productTagBgOpacity.toFixed(2)}</span>
                          <BufferedEditorInput
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            className="w-full"
                            value={productTagBgOpacity}
                            onChange={(event) => onChange({ productTagBgOpacity: Number(event.target.value) })}
                          />
                        </label>
                      </div>
                      <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                        <div className="text-xs font-medium text-slate-700">选中样式</div>
                        <ColorOrGradientPicker
                          value={productTagActiveBgColor}
                          onChange={(value) => onChange({ productTagActiveBgColor: value })}
                        />
                        <RecentColorBar
                          colors={recentColors}
                          onClear={onClearRecentColors}
                          onPick={(color) => onChange({ productTagActiveBgColor: color })}
                          allowGradients
                          selectedValue={productTagActiveBgColor}
                        />
                        <label className="block space-y-2 text-sm">
                          <span className="block text-gray-600">透明度：{productTagActiveBgOpacity.toFixed(2)}</span>
                          <BufferedEditorInput
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            className="w-full"
                            value={productTagActiveBgOpacity}
                            onChange={(event) => onChange({ productTagActiveBgOpacity: Number(event.target.value) })}
                          />
                        </label>
                      </div>
                    </div>
                    <label className="block space-y-2 text-sm">
                      <span className="block text-gray-600">分类列表</span>
                      <BufferedEditorTextarea
                        className={`min-h-[110px] w-full rounded border px-3 py-2 ${productOperatingFieldsEditable ? "" : "border-slate-200 bg-slate-100 text-slate-600"}`}
                        value={productTagOptionsText}
                        readOnly={!productOperatingFieldsEditable}
                        aria-label={productOperatingFieldsEditable ? "商品分类列表" : "工作台商品分类列表（只读）"}
                        onChange={(event) => handleProductTagOptionsDraftChange(event.target.value)}
                        onBlur={(event) => applyProductTagOptions(event.target.value)}
                        placeholder={productOperatingFieldsEditable ? "每行一个分类，例如：\n推荐\n新品\n热卖" : productOperatingCatalogState === "loading" ? "正在核对工作台目录" : productOperatingCatalogState === "blocked" ? "目录绑定待修复" : "工作台目录暂未设置分类"}
                      />
                      <div className="text-xs leading-5 text-gray-500">{productOperatingFieldsEditable ? "产品编辑卡里会从这里下拉选择分类。" : "经营分类由订单工作台目录管理，此处只读；分类标签的布局和样式仍可在本节调整。"}</div>
                    </label>
                    {!productOperatingFieldsEditable && onOpenOrderCatalog ? <button type="button" onClick={openProductOperatingCatalog} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">去工作台修改经营分类</button> : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                    {renderProductSettingsHeader("card", "产品框样式")}
                    {!isProductSectionCollapsed("card") ? (
                      <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                        <div className="text-xs font-medium text-slate-700">底色</div>
                        <ColorOrGradientPicker value={productCardBgColor} onChange={(value) => onChange({ productCardBgColor: value })} />
                        <RecentColorBar
                          colors={recentColors}
                          onClear={onClearRecentColors}
                          onPick={(color) => onChange({ productCardBgColor: color })}
                          allowGradients
                          selectedValue={productCardBgColor}
                        />
                        <label className="block space-y-2 text-sm">
                          <span className="block text-gray-600">透明度：{productCardBgOpacity.toFixed(2)}</span>
                          <BufferedEditorInput
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            className="w-full"
                            value={productCardBgOpacity}
                            onChange={(event) => onChange({ productCardBgOpacity: Number(event.target.value) })}
                          />
                        </label>
                      </div>
                      <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                        <div className="text-xs font-medium text-slate-700">边框颜色</div>
                        <ColorOrGradientPicker
                          value={productCardBorderColor}
                          onChange={(value) => onChange({ productCardBorderColor: value })}
                        />
                        <RecentColorBar
                          colors={recentColors}
                          onClear={onClearRecentColors}
                          onPick={(color) => onChange({ productCardBorderColor: color })}
                          allowGradients
                          selectedValue={productCardBorderColor}
                        />
                      </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
                        <span className="block text-gray-600">产品框高度</span>
                        <div className="flex items-center gap-3">
                          <BufferedEditorInput
                            type="range"
                            min={PRODUCT_CARD_HEIGHT_MIN}
                            max={PRODUCT_CARD_HEIGHT_MAX}
                            step={4}
                            className="flex-1"
                            value={productCardHeight}
                            onChange={(event) => updateProductCardHeight(Number(event.target.value))}
                          />
                          <BufferedEditorInput
                            type="number"
                            min={PRODUCT_CARD_HEIGHT_MIN}
                            max={PRODUCT_CARD_HEIGHT_MAX}
                            className="w-20 rounded border px-2 py-2"
                            value={productCardHeight}
                            onChange={(event) => updateProductCardHeight(Number(event.target.value))}
                          />
                        </div>
                      </label>
                      <label className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
                        <span className="block text-gray-600">产品行距</span>
                        <div className="flex items-center gap-3">
                          <BufferedEditorInput
                            type="range"
                            min={0}
                            max={48}
                            step={1}
                            className="flex-1"
                            value={productItemGap}
                            onChange={(event) => onChange({ productItemGap: Number(event.target.value) })}
                          />
                          <BufferedEditorInput
                            type="number"
                            min={0}
                            max={48}
                            className="w-20 rounded border px-2 py-2"
                            value={productItemGap}
                            onChange={(event) =>
                              onChange({ productItemGap: Math.max(0, Math.min(48, Number(event.target.value) || 0)) })
                            }
                          />
                        </div>
                      </label>
                      <label className="space-y-1 rounded-lg border border-slate-200 bg-white p-3 text-sm">
                        <span className="block text-gray-600">数量按钮</span>
                        <select
                          className="w-full rounded border bg-white px-3 py-2"
                          value={productCartQuantityMode}
                          onChange={(event) => onChange({ productCartQuantityMode: event.target.value as ProductCartQuantityMode })}
                        >
                          {PRODUCT_CART_QUANTITY_MODE_OPTIONS.map((item) => (
                            <option key={item.value} value={item.value}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-1 rounded-lg border border-slate-200 bg-white p-3 text-sm">
                        <span className="block text-gray-600">按钮位置</span>
                        <select
                          className="w-full rounded border bg-white px-3 py-2"
                          value={productCartButtonPosition}
                          onChange={(event) => onChange({ productCartButtonPosition: event.target.value as ProductCartButtonPosition })}
                        >
                          {PRODUCT_CART_BUTTON_POSITION_OPTIONS.map((item) => (
                            <option key={item.value} value={item.value}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                      <div className="text-xs font-medium text-slate-700">边框样式</div>
                      {renderCompactBorderStyleOptions(productCardBorderStyle, productCardBorderColor, (style) =>
                        onChange({ productCardBorderStyle: style }),
                      )}
                    </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                    {renderProductSettingsHeader("typography", "文字样式")}
                    {!isProductSectionCollapsed("typography") ? <div className="mt-3">{renderProductTypographyControls(true)}</div> : null}
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    {renderProductSettingsHeader("behavior", "价格与搜索")}
                    {!isProductSectionCollapsed("behavior") ? (
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="space-y-1 text-sm">
                    <span className="block text-gray-600">价格前缀</span>
                    <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
                      {productOperatingFieldsEditable ? (
                        <>
                          <select
                            className="w-full rounded border px-3 py-2 bg-white"
                            value={productPricePrefixMode}
                            onChange={(event) => {
                              const next = event.target.value;
                              if (next === "__custom__") {
                                onChange({ productPricePrefix: "" });
                                return;
                              }
                              onChange({ productPricePrefix: next });
                            }}
                          >
                            {PRODUCT_PRICE_PREFIX_OPTIONS.map((item) => (
                              <option key={item.value} value={item.value}>{item.label}</option>
                            ))}
                            <option value="__custom__">自定义</option>
                          </select>
                          {productPricePrefixMode === "__custom__" ? (
                            <BufferedEditorInput
                              className="w-full rounded border px-3 py-2"
                              value={productPricePrefix}
                              onChange={(event) => onChange({ productPricePrefix: event.target.value })}
                              placeholder="自定义"
                            />
                          ) : <div />}
                        </>
                      ) : (
                        <>
                          <BufferedEditorInput
                            readOnly
                            aria-label="工作台商品目录价格前缀（只读）"
                            className="w-full rounded border border-slate-200 bg-slate-100 px-3 py-2 text-slate-600"
                            value={productOperatingCatalogState === "active" ? productPricePrefix || "未设置" : productOperatingCatalogState === "loading" ? "正在核对目录" : "绑定待修复"}
                          />
                          {onOpenOrderCatalog ? <button type="button" onClick={openProductOperatingCatalog} className="rounded border border-slate-300 bg-white px-2 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">去工作台</button> : <div />}
                        </>
                      )}
                    </div>
                    {!productOperatingFieldsEditable ? <span className="block text-xs leading-5 text-slate-500">经营价格由订单工作台目录管理，此处只读。</span> : null}
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="block text-gray-600">价格位置</span>
                    <select
                      className="w-full rounded border px-3 py-2 bg-white"
                      value={productPriceAlign}
                      onChange={(event) => onChange({ productPriceAlign: event.target.value as ProductPriceAlign })}
                    >
                      {PRODUCT_PRICE_ALIGN_OPTIONS.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                        ))}
                      </select>
                  </label>
                  <div className="md:col-span-2">{renderProductBrowsingRulesOwnershipNotice()}</div>
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-gray-700">
                    <BufferedEditorInput
                      type="checkbox"
                      checked={productSearchEnabled}
                      disabled={!productBrowsingRulesEditable}
                      onChange={(event) => onChange({ productSearchEnabled: event.target.checked })}
                    />
                    <span>启用搜索</span>
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="block text-gray-600">搜索提示词</span>
                    <BufferedEditorInput
                      className={`w-full rounded border px-3 py-2 ${productBrowsingRulesEditable ? "" : "border-slate-200 bg-slate-100 text-slate-600"}`}
                      value={productSearchPlaceholder}
                      readOnly={!productBrowsingRulesEditable}
                      onChange={(event) => onChange({ productSearchPlaceholder: event.target.value })}
                      placeholder="搜索产品名称/编号/介绍"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="block text-gray-600">区块模式</span>
                    <select
                      className="w-full rounded border px-3 py-2 bg-white"
                      value={productContainerMode}
                      onChange={(event) =>
                        onChange({
                          productContainerMode: event.target.value as ProductContainerMode,
                          productItemsPerPage:
                            event.target.value === "auto"
                              ? block.props.productItemsPerPage
                              : block.props.productItemsPerPage ?? defaultProductItemsPerPage(productLayoutPreset),
                        })
                      }
                    >
                      {PRODUCT_CONTAINER_MODE_OPTIONS.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {productContainerMode !== "auto" ? (
                    <label className="space-y-1 text-sm">
                      <span className="block text-gray-600">{productContainerMode === "paged" ? "每页数量" : "可视数量"}</span>
                      <BufferedEditorInput
                        type="number"
                        min={1}
                        max={24}
                        className="w-full rounded border px-3 py-2"
                        value={productItemsPerPage}
                        onChange={(event) =>
                          onChange({ productItemsPerPage: Math.max(1, Math.min(24, Number(event.target.value) || 1)) })
                        }
                      />
                    </label>
                  ) : null}
                  {productContainerMode === "scroll" ? (
                    <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-gray-700">
                      <BufferedEditorInput
                        type="checkbox"
                        checked={productHideScrollbar}
                        onChange={(event) => onChange({ productHideScrollbar: event.target.checked })}
                      />
                      <span>隐藏产品滚动条</span>
                    </label>
                  ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                    {renderProductSettingsHeader("detail", "详情页设置")}
                    {!isProductSectionCollapsed("detail") ? (
                      <div className="mt-3 space-y-3">
                    <label className="block space-y-2 text-sm">
                      <span className="block text-gray-600">详情图尺寸</span>
                      <div className="flex items-center gap-3">
                        <BufferedEditorInput
                          type="range"
                          min={180}
                          max={720}
                          step={20}
                          className="flex-1"
                          value={productDetailImageSize}
                          onChange={(event) => onChange({ productDetailImageSize: Number(event.target.value) })}
                        />
                        <BufferedEditorInput
                          type="number"
                          min={180}
                          max={720}
                          className="w-20 rounded border px-2 py-2"
                          value={productDetailImageSize}
                          onChange={(event) =>
                            onChange({ productDetailImageSize: Math.max(180, Math.min(720, Number(event.target.value) || 180)) })
                          }
                        />
                      </div>
                    </label>
                    <div className="grid grid-cols-2 gap-2 text-sm text-gray-700">
                      <label className="col-span-2 flex items-center gap-2">
                        <BufferedEditorInput
                          type="checkbox"
                          checked={productDetailFullImage}
                          onChange={(event) => onChange({ productDetailFullImage: event.target.checked })}
                        />
                        <span>全图展示</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <BufferedEditorInput
                          type="checkbox"
                          checked={productDetailShowCode}
                          onChange={(event) => onChange({ productDetailShowCode: event.target.checked })}
                        />
                        <span>显示编号</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <BufferedEditorInput
                          type="checkbox"
                          checked={productDetailShowName}
                          onChange={(event) => onChange({ productDetailShowName: event.target.checked })}
                        />
                        <span>显示名称</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <BufferedEditorInput
                          type="checkbox"
                          checked={productDetailShowDescription}
                          onChange={(event) => onChange({ productDetailShowDescription: event.target.checked })}
                        />
                        <span>显示介绍</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <BufferedEditorInput
                          type="checkbox"
                          checked={productDetailShowPrice}
                          onChange={(event) => onChange({ productDetailShowPrice: event.target.checked })}
                        />
                        <span>显示价格</span>
                      </label>
                    </div>
                    <button
                      type="button"
                      className="w-full rounded border bg-white px-3 py-2 text-sm hover:bg-gray-50"
                      onClick={openProductDetailPreview}
                    >
                      预览详情
                    </button>
                      </div>
                    ) : null}
                  </div>
                  {renderProductInventorySection(true)}
                </div>
              ) : (
                <div className="mt-4 grid gap-4">
                  {renderProductSettingsSection(
                    "basic",
                    "基础展示",
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <label className="space-y-1 text-sm">
                      <span className="block text-gray-600">排列方式</span>
                      <select
                        className="w-full rounded border bg-white px-3 py-1.5"
                        value={productLayoutPreset}
                        onChange={(event) => onChange({ productLayoutPreset: event.target.value as ProductLayoutPreset })}
                      >
                        {PRODUCT_LAYOUT_OPTIONS.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1 text-sm">
                      <span className="block text-gray-600">图片比例</span>
                      <select
                        className="w-full rounded border bg-white px-3 py-1.5"
                        value={productImageAspectRatio}
                        onChange={(event) => onChange({ productImageAspectRatio: event.target.value as ProductImageAspectRatio })}
                      >
                        {PRODUCT_IMAGE_ASPECT_OPTIONS.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1.5 text-sm md:col-span-2">
                      <span className="block text-gray-600">图片尺寸</span>
                      <div className="flex items-center gap-2.5">
                        <BufferedEditorInput
                          type="range"
                          min={PRODUCT_IMAGE_SIZE_MIN}
                          max={productImageMaxSize}
                          step={1}
                          className="flex-1"
                          value={productImageSize}
                          onChange={(event) => updateProductImageSize(Number(event.target.value))}
                        />
                        <BufferedEditorInput
                          type="number"
                          min={PRODUCT_IMAGE_SIZE_MIN}
                          max={productImageMaxSize}
                          className="w-20 rounded border px-2 py-1.5"
                          value={productImageSize}
                          onChange={(event) =>
                            updateProductImageSize(Number(event.target.value))
                          }
                        />
                      </div>
                    </label>
                    <label className="space-y-1 text-sm md:col-span-2">
                      <span className="block text-gray-600">价格前缀</span>
                      <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-2.5">
                        {productOperatingFieldsEditable ? (
                          <>
                            <select
                              className="w-full rounded border bg-white px-3 py-1.5"
                              value={productPricePrefixMode}
                              onChange={(event) => {
                                const next = event.target.value;
                                if (next === "__custom__") {
                                  onChange({ productPricePrefix: "" });
                                  return;
                                }
                                onChange({ productPricePrefix: next });
                              }}
                            >
                              {PRODUCT_PRICE_PREFIX_OPTIONS.map((item) => (
                                <option key={item.value} value={item.value}>{item.label}</option>
                              ))}
                              <option value="__custom__">自定义</option>
                            </select>
                            {productPricePrefixMode === "__custom__" ? (
                              <BufferedEditorInput
                                className="w-full rounded border px-3 py-1.5"
                                value={productPricePrefix}
                                onChange={(event) => onChange({ productPricePrefix: event.target.value })}
                                placeholder="自定义"
                              />
                            ) : <div />}
                          </>
                        ) : (
                          <>
                            <BufferedEditorInput
                              readOnly
                              aria-label="工作台商品目录价格前缀（只读）"
                              className="w-full rounded border border-slate-200 bg-slate-100 px-3 py-1.5 text-slate-600"
                              value={productOperatingCatalogState === "active" ? productPricePrefix || "未设置" : productOperatingCatalogState === "loading" ? "正在核对目录" : "绑定待修复"}
                            />
                            {onOpenOrderCatalog ? <button type="button" onClick={openProductOperatingCatalog} className="rounded border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">去工作台</button> : <div />}
                          </>
                        )}
                      </div>
                      {!productOperatingFieldsEditable ? <span className="block text-xs leading-5 text-slate-500">经营价格由订单工作台目录管理，此处只读。</span> : null}
                    </label>
                    <label className="space-y-1 text-sm">
                      <span className="block text-gray-600">价格位置</span>
                      <select
                        className="w-full rounded border bg-white px-3 py-1.5"
                        value={productPriceAlign}
                        onChange={(event) => onChange({ productPriceAlign: event.target.value as ProductPriceAlign })}
                      >
                        {PRODUCT_PRICE_ALIGN_OPTIONS.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                          ))}
                      </select>
                    </label>
                    <div className="md:col-span-2">{renderProductBrowsingRulesOwnershipNotice()}</div>
                    <label className="flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-gray-700">
                      <BufferedEditorInput
                        type="checkbox"
                        checked={productSearchEnabled}
                        disabled={!productBrowsingRulesEditable}
                        onChange={(event) => onChange({ productSearchEnabled: event.target.checked })}
                      />
                      <span>启用搜索</span>
                    </label>
                    <label className="space-y-1 text-sm md:col-span-2">
                      <span className="block text-gray-600">搜索提示词</span>
                      <BufferedEditorInput
                        className={`w-full rounded border px-3 py-1.5 ${productBrowsingRulesEditable ? "" : "border-slate-200 bg-slate-100 text-slate-600"}`}
                        value={productSearchPlaceholder}
                        readOnly={!productBrowsingRulesEditable}
                        onChange={(event) => onChange({ productSearchPlaceholder: event.target.value })}
                        placeholder="搜索产品名称/编号/介绍"
                      />
                    </label>
                    <label className="space-y-1 text-sm">
                      <span className="block text-gray-600">区块模式</span>
                      <select
                        className="w-full rounded border bg-white px-3 py-1.5"
                        value={productContainerMode}
                        onChange={(event) =>
                          onChange({
                            productContainerMode: event.target.value as ProductContainerMode,
                            productItemsPerPage:
                              event.target.value === "auto"
                                ? block.props.productItemsPerPage
                                : block.props.productItemsPerPage ?? defaultProductItemsPerPage(productLayoutPreset),
                          })
                        }
                      >
                        {PRODUCT_CONTAINER_MODE_OPTIONS.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {productContainerMode !== "auto" ? (
                      <label className="space-y-1 text-sm">
                        <span className="block text-gray-600">{productContainerMode === "paged" ? "每页数量" : "可视数量"}</span>
                        <BufferedEditorInput
                          type="number"
                          min={1}
                          max={24}
                          className="w-full rounded border px-3 py-1.5"
                          value={productItemsPerPage}
                          onChange={(event) =>
                            onChange({ productItemsPerPage: Math.max(1, Math.min(24, Number(event.target.value) || 1)) })
                          }
                        />
                      </label>
                    ) : (
                      <div />
                    )}
                    {productContainerMode === "scroll" ? (
                      <label className="flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-gray-700">
                        <BufferedEditorInput
                          type="checkbox"
                          checked={productHideScrollbar}
                          onChange={(event) => onChange({ productHideScrollbar: event.target.checked })}
                        />
                        <span>隐藏产品滚动条</span>
                      </label>
                    ) : (
                      <div />
                    )}
                    <div className="grid gap-2 text-sm text-gray-700 sm:grid-cols-2 xl:col-span-4">
                      <label className="flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-1.5">
                        <BufferedEditorInput
                          type="checkbox"
                          checked={productShowCode}
                          onChange={(event) => onChange({ productShowCode: event.target.checked })}
                        />
                        <span>显示编号</span>
                      </label>
                      <label className="flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-1.5">
                        <BufferedEditorInput
                          type="checkbox"
                          checked={productShowDescription}
                          onChange={(event) => onChange({ productShowDescription: event.target.checked })}
                        />
                        <span>显示介绍</span>
                      </label>
                    </div>
                    </div>,
                  )}
                  {renderProductSettingsSection(
                    "tags",
                    "分类标签样式",
                    <div className="space-y-4">
                    <div className="grid gap-4 lg:grid-cols-3">
                    <label className="space-y-1 text-sm">
                      <span className="block text-gray-600">标签位置</span>
                      <select
                        className="w-full rounded border px-3 py-2 bg-white"
                        value={productTagPosition}
                        onChange={(event) => onChange({ productTagPosition: event.target.value as ProductTagPosition })}
                      >
                        {PRODUCT_TAG_POSITION_OPTIONS.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1 text-sm">
                      <span className="block text-gray-600">底框样式</span>
                      <select
                        className="w-full rounded border px-3 py-2 bg-white"
                        value={productTagBorderStyle}
                        onChange={(event) => onChange({ productTagBorderStyle: event.target.value as ProductTagBorderStyle })}
                      >
                        {PRODUCT_TAG_BORDER_STYLE_OPTIONS.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1 text-sm">
                      <span className="block text-gray-600">文字对齐</span>
                      <select
                        className="w-full rounded border px-3 py-2 bg-white"
                        value={productTagTextAlign}
                        onChange={(event) => onChange({ productTagTextAlign: event.target.value as ProductPriceAlign })}
                      >
                        {PRODUCT_PRICE_ALIGN_OPTIONS.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-2 text-sm">
                      <span className="block text-gray-600">字体大小</span>
                      <div className="flex items-center gap-3">
                        <BufferedEditorInput
                          type="range"
                          min={10}
                          max={28}
                          step={1}
                          className="flex-1"
                          value={productTagFontSize}
                          onChange={(event) => onChange({ productTagFontSize: Number(event.target.value) })}
                        />
                        <BufferedEditorInput
                          type="number"
                          min={10}
                          max={28}
                          className="w-20 rounded border px-2 py-2"
                          value={productTagFontSize}
                          onChange={(event) =>
                            onChange({ productTagFontSize: Math.max(10, Math.min(28, Number(event.target.value) || 10)) })
                          }
                        />
                      </div>
                    </label>
                    <label className="space-y-2 text-sm">
                      <span className="block text-gray-600">标签尺寸</span>
                      <div className="flex items-center gap-3">
                        <BufferedEditorInput
                          type="range"
                          min={56}
                          max={220}
                          step={4}
                          className="flex-1"
                          value={productTagWidth}
                          onChange={(event) => onChange({ productTagWidth: Number(event.target.value) })}
                        />
                        <BufferedEditorInput
                          type="number"
                          min={56}
                          max={220}
                          className="w-20 rounded border px-2 py-2"
                          value={productTagWidth}
                          onChange={(event) =>
                            onChange({ productTagWidth: Math.max(56, Math.min(220, Number(event.target.value) || 56)) })
                          }
                        />
                      </div>
                    </label>
                    <label className="space-y-2 text-sm">
                      <span className="block text-gray-600">分类行距</span>
                      <div className="flex items-center gap-3">
                        <BufferedEditorInput
                          type="range"
                          min={0}
                          max={48}
                          step={1}
                          className="flex-1"
                          value={productTagRowGap}
                          onChange={(event) => onChange({ productTagRowGap: Number(event.target.value) })}
                        />
                        <BufferedEditorInput
                          type="number"
                          min={0}
                          max={48}
                          className="w-20 rounded border px-2 py-2"
                          value={productTagRowGap}
                          onChange={(event) =>
                            onChange({ productTagRowGap: Math.max(0, Math.min(48, Number(event.target.value) || 0)) })
                          }
                        />
                      </div>
                    </label>
                    </div>
                    {renderProductBrowsingRulesOwnershipNotice()}
                    <div className="grid gap-2 text-sm text-gray-700 sm:grid-cols-2">
                      <label className="flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
                        <BufferedEditorInput
                          type="checkbox"
                          checked={productTagHideUnselected}
                          disabled={!productBrowsingRulesEditable}
                          onChange={(event) => onChange({ productTagHideUnselected: event.target.checked })}
                        />
                        <span>隐藏未选中</span>
                      </label>
                      <label className="flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
                        <BufferedEditorInput
                          type="checkbox"
                          checked={productGroupByTag}
                          disabled={!productBrowsingRulesEditable}
                          onChange={(event) => onChange({ productGroupByTag: event.target.checked })}
                        />
                        <span>按分类排列</span>
                      </label>
                    </div>
                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                        <div className="text-sm font-medium text-slate-700">默认样式</div>
                        <ColorOrGradientPicker value={productTagBgColor} onChange={(value) => onChange({ productTagBgColor: value })} />
                        <RecentColorBar
                          colors={recentColors}
                          onClear={onClearRecentColors}
                          onPick={(color) => onChange({ productTagBgColor: color })}
                          allowGradients
                          selectedValue={productTagBgColor}
                        />
                        <div className="pt-2 text-xs text-gray-600">透明度：{productTagBgOpacity.toFixed(2)}</div>
                        <BufferedEditorInput
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          className="w-full"
                          value={productTagBgOpacity}
                          onChange={(event) => onChange({ productTagBgOpacity: Number(event.target.value) })}
                        />
                      </div>
                      <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                        <div className="text-sm font-medium text-slate-700">选中样式</div>
                        <ColorOrGradientPicker
                          value={productTagActiveBgColor}
                          onChange={(value) => onChange({ productTagActiveBgColor: value })}
                        />
                        <RecentColorBar
                          colors={recentColors}
                          onClear={onClearRecentColors}
                          onPick={(color) => onChange({ productTagActiveBgColor: color })}
                          allowGradients
                          selectedValue={productTagActiveBgColor}
                        />
                        <div className="pt-2 text-xs text-gray-600">透明度：{productTagActiveBgOpacity.toFixed(2)}</div>
                        <BufferedEditorInput
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          className="w-full"
                          value={productTagActiveBgOpacity}
                          onChange={(event) => onChange({ productTagActiveBgOpacity: Number(event.target.value) })}
                        />
                      </div>
                    </div>
                    <label className="space-y-2 text-sm">
                      <span className="block text-gray-600">分类列表</span>
                      <BufferedEditorTextarea
                        className={`min-h-[110px] w-full rounded border px-3 py-2 ${productOperatingFieldsEditable ? "" : "border-slate-200 bg-slate-100 text-slate-600"}`}
                        value={productTagOptionsText}
                        readOnly={!productOperatingFieldsEditable}
                        aria-label={productOperatingFieldsEditable ? "商品分类列表" : "工作台商品分类列表（只读）"}
                        onChange={(event) => handleProductTagOptionsDraftChange(event.target.value)}
                        onBlur={(event) => applyProductTagOptions(event.target.value)}
                        placeholder={productOperatingFieldsEditable ? "每行一个分类，例如：\n推荐\n新品\n热卖" : productOperatingCatalogState === "loading" ? "正在核对工作台目录" : productOperatingCatalogState === "blocked" ? "目录绑定待修复" : "工作台目录暂未设置分类"}
                      />
                      <div className="text-xs leading-5 text-gray-500">{productOperatingFieldsEditable ? "产品编辑卡里会从这里下拉选择分类。" : "经营分类由订单工作台目录管理，此处只读；分类标签的布局和样式仍可在本节调整。"}</div>
                    </label>
                    {!productOperatingFieldsEditable && onOpenOrderCatalog ? <button type="button" onClick={openProductOperatingCatalog} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">去工作台修改经营分类</button> : null}
                    </div>,
                  )}
                  {renderProductSettingsSection(
                    "card",
                    "产品框样式",
                    <div className="space-y-4">
                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                        <div className="text-sm font-medium text-slate-700">产品框底色</div>
                        <ColorOrGradientPicker value={productCardBgColor} onChange={(value) => onChange({ productCardBgColor: value })} />
                        <RecentColorBar
                          colors={recentColors}
                          onClear={onClearRecentColors}
                          onPick={(color) => onChange({ productCardBgColor: color })}
                          allowGradients
                          selectedValue={productCardBgColor}
                        />
                        <label className="block space-y-2 text-sm">
                          <span className="block text-gray-600">透明度：{productCardBgOpacity.toFixed(2)}</span>
                          <BufferedEditorInput
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            className="w-full"
                            value={productCardBgOpacity}
                            onChange={(event) => onChange({ productCardBgOpacity: Number(event.target.value) })}
                          />
                        </label>
                      </div>
                      <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                        <div className="text-sm font-medium text-slate-700">边框颜色</div>
                        <ColorOrGradientPicker
                          value={productCardBorderColor}
                          onChange={(value) => onChange({ productCardBorderColor: value })}
                        />
                        <RecentColorBar
                          colors={recentColors}
                          onClear={onClearRecentColors}
                          onPick={(color) => onChange({ productCardBorderColor: color })}
                          allowGradients
                          selectedValue={productCardBorderColor}
                        />
                      </div>
                    </div>
                    <div className="grid gap-4 lg:grid-cols-2">
                      <label className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
                        <span className="block text-gray-600">产品框高度</span>
                        <div className="flex items-center gap-3">
                          <BufferedEditorInput
                            type="range"
                            min={PRODUCT_CARD_HEIGHT_MIN}
                            max={PRODUCT_CARD_HEIGHT_MAX}
                            step={4}
                            className="flex-1"
                            value={productCardHeight}
                            onChange={(event) => updateProductCardHeight(Number(event.target.value))}
                          />
                          <BufferedEditorInput
                            type="number"
                            min={PRODUCT_CARD_HEIGHT_MIN}
                            max={PRODUCT_CARD_HEIGHT_MAX}
                            className="w-20 rounded border px-2 py-2"
                            value={productCardHeight}
                            onChange={(event) => updateProductCardHeight(Number(event.target.value))}
                          />
                        </div>
                      </label>
                      <label className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
                        <span className="block text-gray-600">产品行距</span>
                        <div className="flex items-center gap-3">
                          <BufferedEditorInput
                            type="range"
                            min={0}
                            max={48}
                            step={1}
                            className="flex-1"
                            value={productItemGap}
                            onChange={(event) => onChange({ productItemGap: Number(event.target.value) })}
                          />
                          <BufferedEditorInput
                            type="number"
                            min={0}
                            max={48}
                            className="w-20 rounded border px-2 py-2"
                            value={productItemGap}
                            onChange={(event) =>
                              onChange({ productItemGap: Math.max(0, Math.min(48, Number(event.target.value) || 0)) })
                            }
                          />
                        </div>
                      </label>
                      <label className="space-y-1 rounded-lg border border-slate-200 bg-white p-3 text-sm">
                        <span className="block text-gray-600">数量按钮</span>
                        <select
                          className="w-full rounded border bg-white px-3 py-2"
                          value={productCartQuantityMode}
                          onChange={(event) => onChange({ productCartQuantityMode: event.target.value as ProductCartQuantityMode })}
                        >
                          {PRODUCT_CART_QUANTITY_MODE_OPTIONS.map((item) => (
                            <option key={item.value} value={item.value}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-1 rounded-lg border border-slate-200 bg-white p-3 text-sm">
                        <span className="block text-gray-600">按钮位置</span>
                        <select
                          className="w-full rounded border bg-white px-3 py-2"
                          value={productCartButtonPosition}
                          onChange={(event) => onChange({ productCartButtonPosition: event.target.value as ProductCartButtonPosition })}
                        >
                          {PRODUCT_CART_BUTTON_POSITION_OPTIONS.map((item) => (
                            <option key={item.value} value={item.value}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                      <div className="text-sm font-medium text-slate-700">产品框边框</div>
                      {renderCompactBorderStyleOptions(productCardBorderStyle, productCardBorderColor, (style) =>
                        onChange({ productCardBorderStyle: style }),
                      )}
                    </div>
                    </div>,
                  )}
                  {renderProductSettingsSection(
                    "typography",
                    "文字样式",
                    renderProductTypographyControls(false),
                  )}
                  {renderProductSettingsSection(
                    "detail",
                    "详情页设置",
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
                      <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2 text-sm text-gray-700">
                        <label className="col-span-2 flex items-center gap-2">
                          <BufferedEditorInput
                            type="checkbox"
                            checked={productDetailFullImage}
                            onChange={(event) => onChange({ productDetailFullImage: event.target.checked })}
                          />
                          <span>全图展示</span>
                        </label>
                        <label className="flex items-center gap-2">
                          <BufferedEditorInput
                            type="checkbox"
                            checked={productDetailShowCode}
                            onChange={(event) => onChange({ productDetailShowCode: event.target.checked })}
                          />
                          <span>显示编号</span>
                        </label>
                        <label className="flex items-center gap-2">
                          <BufferedEditorInput
                            type="checkbox"
                            checked={productDetailShowName}
                            onChange={(event) => onChange({ productDetailShowName: event.target.checked })}
                          />
                          <span>显示名称</span>
                        </label>
                        <label className="flex items-center gap-2">
                          <BufferedEditorInput
                            type="checkbox"
                            checked={productDetailShowDescription}
                            onChange={(event) => onChange({ productDetailShowDescription: event.target.checked })}
                          />
                          <span>显示介绍</span>
                        </label>
                        <label className="flex items-center gap-2">
                          <BufferedEditorInput
                            type="checkbox"
                            checked={productDetailShowPrice}
                            onChange={(event) => onChange({ productDetailShowPrice: event.target.checked })}
                          />
                          <span>显示价格</span>
                        </label>
                      </div>
                      <button
                        type="button"
                        className="rounded border bg-white px-3 py-2 text-sm hover:bg-gray-50"
                        onClick={openProductDetailPreview}
                      >
                        预览详情
                      </button>
                      </div>
                      <label className="space-y-2 text-sm">
                        <span className="block text-gray-600">详情图尺寸</span>
                        <div className="flex items-center gap-3">
                          <BufferedEditorInput
                            type="range"
                            min={180}
                            max={720}
                            step={20}
                            className="flex-1"
                            value={productDetailImageSize}
                            onChange={(event) => onChange({ productDetailImageSize: Number(event.target.value) })}
                          />
                          <BufferedEditorInput
                            type="number"
                            min={180}
                            max={720}
                            className="w-24 rounded border px-2 py-2"
                            value={productDetailImageSize}
                            onChange={(event) =>
                              onChange({ productDetailImageSize: Math.max(180, Math.min(720, Number(event.target.value) || 180)) })
                            }
                          />
                        </div>
                      </label>
                    </div>,
                    { bodyClassName: "mt-3" },
                  )}
                  {renderProductInventorySection(false)}
                </div>
              )}
              {productDetailPreviewDialog}
              {productItemEditorDialog}
            </div>
          ) : (
            <>
              {hasProductHeading ? (
                <h2
                  className="text-xl font-bold whitespace-pre-wrap break-words"
                  dangerouslySetInnerHTML={{ __html: toRichHtml(block.props.heading, "产品展示") }}
                />
              ) : null}
              {hasProductText ? (
                <div
                  className="mt-2 text-sm text-gray-600 whitespace-pre-wrap break-words"
                  dangerouslySetInnerHTML={{ __html: toRichHtml(block.props.text, "") }}
                />
              ) : null}
              {renderProductPreviewWithFilters()}
            </>
          )}
          {resizeHandles}
        </div>
      </section>
    );
  }

  if (block.type === "coupon") {
    const couponDisplayMode = block.props.couponDisplayMode === "list" ? "list" : "cards";
    const couponActionMode: CouponActionMode =
      block.props.couponActionMode === "claim" || block.props.couponActionMode === "order" || block.props.couponActionMode === "none"
        ? block.props.couponActionMode
        : "copy";
    const previewCoupons: MerchantCouponRecord[] = [
      {
        id: "preview-coupon-1",
        siteId: runtimeSiteId || "preview",
        title: "新客户优惠",
        code: "WELCOME5",
        description: "首次下单可使用。",
        discountType: "threshold_amount_off",
        discountValue: 5,
        minimumAmount: 30,
        pointsVoucherMaxPerRedemption: 0,
        pointsVoucherMinimumRedeemPoints: 0,
        productName: "",
        productBarcode: "",
        productQuantity: 0,
        productAmount: 0,
        exchangeItem: "",
        exchangeQuantity: 0,
        ticketVenue: "",
        ticketDurationMinutes: 0,
        maxDiscountAmount: 0,
        totalQuantity: 100,
        claimedCount: 0,
        usedCount: 12,
        perCustomerLimit: 1,
        startsAt: null,
        expiresAt: "2026-12-31T23:59:59.000Z",
        status: "active",
        showOnWebsite: true,
        showOnContactCard: false,
        backgroundImageUrl: "",
        backgroundImageOpacity: 0.35,
        usageScenarios: ["order_cart"],
        displayTitle: "",
        displayDescription: "",
        displayDiscountText: "",
        displayMetaText: "",
        displayButtonText: "立即领取",
        displayFieldOrder: ["discount", "title", "description", "meta", "button"],
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
        discountTextColor: "",
        discountFontSize: 0,
        titleTextColor: "",
        titleFontSize: 0,
        descriptionTextColor: "",
        descriptionFontSize: 0,
        metaTextColor: "",
        metaFontSize: 0,
        buttonTextColor: "#ffffff",
        buttonFontSize: 0,
        claimRequiresMember: false,
        claimOldUserOnly: false,
        claimMinRegisteredDays: 0,
        claimMinSpendAmount: 0,
        claimMinOrderCount: 0,
        claimAllowedAccountIds: [],
        claimAllowedCountries: [],
        claimAllowedProvinces: [],
        claimAllowedCities: [],
        claimAllowedCodes: [],
        claimPerUserTotalLimit: 0,
        claimPerUserDailyLimit: 0,
        claimPerUserWeeklyLimit: 0,
        claimPerUserMonthlyLimit: 0,
        claimDateTimeWindows: [],
        claimDailyTimeWindows: [],
        claimValidHoursAfterClaim: 0,
        claimValidDaysAfterClaim: 0,
        claimMonthlyStockLimit: 0,
        claimWeeklyStockLimit: 0,
        claimDailyStockLimit: 0,
        claimHourlyStockLimit: 0,
        claimBehaviorTriggers: [],
        claimTriggerAmount: 0,
        claimTriggerCount: 0,
        claimTriggerDate: null,
        claimTaskRequirements: [],
        claimTaskPageUrl: "",
        claimTaskInviteCount: 0,
        claimEvents: [],
        redeemEvents: [],
        applicableProductIds: [],
        applicableTags: [],
        createdAt: "2026-05-15T00:00:00.000Z",
        updatedAt: "2026-05-15T00:00:00.000Z",
      },
    ];
    const visibleMerchantCoupons = getVisibleMerchantCoupons(merchantCouponRecords);
    const editorPreviewCoupons = visibleMerchantCoupons.length > 0 ? visibleMerchantCoupons : previewCoupons;
    const couponSelectionCoupons = merchantCouponRecords.filter((coupon) => coupon.status !== "archived");
    const selectedCouponIds = Array.isArray(block.props.couponSelectedIds)
      ? block.props.couponSelectedIds.map((item) => String(item).trim()).filter(Boolean)
      : [];
    const selectedCouponIdSet = new Set(selectedCouponIds);
    const couponAutoSelectAll = selectedCouponIds.length === 0;
    const couponSelectionIds = couponSelectionCoupons.map((coupon) => coupon.id);
    const toggleCouponSelection = (couponId: string, checked: boolean) => {
      const nextSet = new Set(couponAutoSelectAll ? couponSelectionIds : selectedCouponIds);
      if (checked) {
        nextSet.add(couponId);
      } else {
        nextSet.delete(couponId);
      }
      onChange({ couponSelectedIds: Array.from(nextSet) });
    };
    return (
      <section
        data-block-id={block.id}
        data-jump-target={publicBlockId}
        data-block-public-id={publicBlockId}
        className={`${shellClass} pointer-events-none`}
        style={offsetStyle}
      >
        <EditorBlockHeader
          blockId={publicBlockId}
          draggingBlockId={draggingBlockId}
          isSelected={isSelected}
          onDragHandleMouseDown={onDragHandleMouseDown}
          onNudge={onNudge}
          onOpenLayerSettings={openLayerSettings}
          onEditTypography={editTypography}
          onInsertImage={insertImage}
          onEditImageSettings={editImageSettings}
          onEditBorderStyle={editBorderSettings}
          isMobileViewport={previewViewport === "mobile"}
          mobileFitScreenWidth={block.props.mobileFitScreenWidth === true}
          onToggleMobileFitScreenWidth={handleToggleMobileFitScreenWidth}
          blockOpenByButton={blockOpenByButton}
          onToggleBlockOpenMode={toggleBlockOpenMode}
          onDelete={onDelete}
        />
        <div
          ref={resizeTargetRef}
          data-block-visual-boundary
          className={`${cardClass} relative`}
          onClick={onSelect}
          style={{ ...blockBackgroundStyle, ...blockSizeStyle, ...previewBorderInlineStyle }}
        >
          {imageDialog}
          {imageSettingsDialog}
          {borderSettingsDialog}
          {layerSettingsDialog}
          {typographyDialog}
          {isSelected ? renderSelectedEditor(
            <div className="grid gap-4">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="block text-gray-600">标题</span>
                  <RichTextEditor
                    field="heading"
                    className="border p-2 rounded w-full text-xl font-bold"
                    value={block.props.heading ?? ""}
                    onChange={handleRichFieldChange}
                    onActivate={registerActiveEditor}
                    onSelectionChange={updateSelectionRange}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="block text-gray-600">展示样式</span>
                  <select
                    className="w-full rounded border px-3 py-2"
                    value={couponDisplayMode}
                    onChange={(event) => onChange({ couponDisplayMode: event.target.value as CouponDisplayMode })}
                  >
                    <option value="cards">卡片</option>
                    <option value="list">列表</option>
                  </select>
                </label>
              </div>
              <label className="space-y-1 text-sm">
                <span className="block text-gray-600">说明</span>
                <RichTextEditor
                  field="text"
                  className="border p-2 rounded w-full min-h-[88px] text-gray-700"
                  value={block.props.text ?? ""}
                  onChange={handleRichFieldChange}
                  onActivate={registerActiveEditor}
                  onSelectionChange={updateSelectionRange}
                />
              </label>
              <div className="grid gap-3 md:grid-cols-3">
                <label className="space-y-1 text-sm">
                  <span className="block text-gray-600">按钮动作</span>
                  <select
                    className="w-full rounded border px-3 py-2"
                    value={couponActionMode}
                    onChange={(event) => onChange({ couponActionMode: event.target.value as CouponActionMode })}
                  >
                    <option value="copy">复制优惠码</option>
                    <option value="claim">立即领取</option>
                    <option value="order">立即使用</option>
                    <option value="none">只展示</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
                  <BufferedEditorInput
                    type="checkbox"
                    checked={block.props.couponShowRemaining !== false}
                    onChange={(event) => onChange({ couponShowRemaining: event.target.checked })}
                  />
                  显示剩余数量
                </label>
                <label className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
                  <BufferedEditorInput
                    type="checkbox"
                    checked={block.props.couponShowExpiresAt !== false}
                    onChange={(event) => onChange({ couponShowExpiresAt: event.target.checked })}
                  />
                  显示有效期
                </label>
              </div>
              <label className="space-y-1 text-sm">
                <span className="block text-gray-600">空状态文案</span>
                <BufferedEditorInput
                  className="w-full rounded border px-3 py-2"
                  value={block.props.couponEmptyText ?? ""}
                  onChange={(event) => onChange({ couponEmptyText: event.target.value })}
                />
              </label>
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                优惠券内容来自经营中心，区块只控制展示样式和点击动作。
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">优惠券内容</div>
                    <div className="mt-1 text-xs leading-5 text-slate-500">
                      在经营中心创建和修改优惠券；这里选择当前区块展示哪些优惠券。
                    </div>
                  </div>
                  {onOpenMerchantCoupons ? (
                    <button
                      type="button"
                      className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50"
                      onClick={onOpenMerchantCoupons}
                    >
                      管理优惠券
                    </button>
                  ) : null}
                </div>
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <BufferedEditorInput
                      type="checkbox"
                      checked={couponAutoSelectAll}
                      onChange={(event) => {
                        if (event.target.checked) {
                          onChange({ couponSelectedIds: [] });
                        } else if (couponSelectionIds.length > 0) {
                          onChange({ couponSelectedIds: couponSelectionIds });
                        }
                      }}
                    />
                    自动展示全部可用优惠券
                  </label>
                </div>
                {couponSelectionCoupons.length > 0 ? (
                  <div className="mt-3 grid gap-2">
                    {couponSelectionCoupons.map((coupon) => (
                      <label
                        key={coupon.id}
                        className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                      >
                        <BufferedEditorInput
                          className="mt-1"
                          type="checkbox"
                          checked={couponAutoSelectAll || selectedCouponIdSet.has(coupon.id)}
                          onChange={(event) => toggleCouponSelection(coupon.id, event.target.checked)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-slate-900">{coupon.title}</span>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                              {coupon.status === "active" ? "启用" : "暂停"}
                            </span>
                          </span>
                          <span className="mt-1 block text-xs text-slate-500">
                            {coupon.code} · {getMerchantCouponDiscountLabel(coupon)}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-500">
                    经营中心还没有优惠券。创建后这里会显示可选择的优惠券。
                  </div>
                )}
              </div>
              <CouponBlock {...block.props} previewCoupons={editorPreviewCoupons} interactive={false} />
            </div>,
          ) : (
            <CouponBlock {...block.props} previewCoupons={editorPreviewCoupons} interactive={false} />
          )}
          {resizeHandles}
        </div>
      </section>
    );
  }

  if (block.type === "google-reviews") {
    const reviewItems = normalizeGoogleReviewItems(block.props.googleReviewItems, 24);
    const googleReviewDisplayMode: GoogleReviewDisplayMode =
      block.props.googleReviewDisplayMode === "list" || block.props.googleReviewDisplayMode === "compact"
        ? block.props.googleReviewDisplayMode
        : "cards";
    const googleReviewAverageRating = normalizeGoogleReviewAverage(block.props.googleReviewAverageRating, 0);
    const googleReviewTotalCount = normalizeGoogleReviewTotalCount(block.props.googleReviewTotalCount, reviewItems.length);
    const googleReviewMaxItems = clampGoogleReviewMaxItemsInput(block.props.googleReviewMaxItems);
    const commitReviewItems = (nextItems: GoogleReviewItem[]) => {
      onChange({ googleReviewItems: nextItems });
    };
    const updateReviewItem = (itemId: string, patch: Partial<GoogleReviewItem>) => {
      commitReviewItems(reviewItems.map((item) => ((item.id ?? "") === itemId ? { ...item, ...patch } : item)));
    };
    const removeReviewItem = (itemId: string) => {
      commitReviewItems(reviewItems.filter((item) => (item.id ?? "") !== itemId));
    };
    const moveReviewItem = (itemId: string, direction: -1 | 1) => {
      const currentIndex = reviewItems.findIndex((item) => (item.id ?? "") === itemId);
      const nextIndex = currentIndex + direction;
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= reviewItems.length) return;
      const nextItems = [...reviewItems];
      const [movedItem] = nextItems.splice(currentIndex, 1);
      if (!movedItem) return;
      nextItems.splice(nextIndex, 0, movedItem);
      commitReviewItems(nextItems);
    };
    const addReviewItem = () => {
      commitReviewItems([...reviewItems, createEditorGoogleReviewItem(reviewItems.length)]);
    };
    const googleReviewsPreviewProps = {
      ...block.props,
      blockWidth: undefined,
      blockHeight: undefined,
      blockOffsetX: undefined,
      blockOffsetY: undefined,
      blockLayer: undefined,
      mobileFitScreenWidth: false,
    };
    const googleReviewsPreviewShellStyle = {
      ...blockSizeStyle,
      ...blockPreviewOverflowStyle,
    };
    const googleReviewsPreviewShellClass = `relative pointer-events-auto ${
      isSelected ? "overflow-visible" : blockHeight ? "overflow-auto" : "overflow-visible"
    }`;

    return (
      <section
        data-block-id={block.id}
        data-jump-target={publicBlockId}
        data-block-public-id={publicBlockId}
        className={`${shellClass} pointer-events-none`}
        style={offsetStyle}
      >
        <EditorBlockHeader
          blockId={publicBlockId}
          draggingBlockId={draggingBlockId}
          isSelected={isSelected}
          onDragHandleMouseDown={onDragHandleMouseDown}
          onNudge={onNudge}
          onOpenLayerSettings={openLayerSettings}
          onEditTypography={editTypography}
          onInsertImage={insertImage}
          onEditImageSettings={editImageSettings}
          onEditBorderStyle={editBorderSettings}
          isMobileViewport={previewViewport === "mobile"}
          mobileFitScreenWidth={block.props.mobileFitScreenWidth === true}
          onToggleMobileFitScreenWidth={handleToggleMobileFitScreenWidth}
          blockOpenByButton={blockOpenByButton}
          onToggleBlockOpenMode={toggleBlockOpenMode}
          onDelete={onDelete}
        />
        <div
          ref={resizeTargetRef}
          data-block-visual-boundary
          className={googleReviewsPreviewShellClass}
          onClick={onSelect}
          style={googleReviewsPreviewShellStyle}
        >
          {imageDialog}
          {imageSettingsDialog}
          {borderSettingsDialog}
          {layerSettingsDialog}
          {typographyDialog}
          {isSelected ? renderSelectedEditor(
            <div className="grid gap-4">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="block text-gray-600">标题</span>
                  <RichTextEditor
                    field="heading"
                    className="border p-2 rounded w-full text-xl font-bold"
                    value={block.props.heading ?? ""}
                    onChange={handleRichFieldChange}
                    onActivate={registerActiveEditor}
                    onSelectionChange={updateSelectionRange}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="block text-gray-600">展示样式</span>
                  <select
                    className="w-full rounded border px-3 py-2"
                    value={googleReviewDisplayMode}
                    onChange={(event) => onChange({ googleReviewDisplayMode: event.target.value as GoogleReviewDisplayMode })}
                  >
                    {GOOGLE_REVIEW_DISPLAY_MODE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="space-y-1 text-sm">
                <span className="block text-gray-600">说明</span>
                <RichTextEditor
                  field="text"
                  className="border p-2 rounded w-full min-h-[88px] text-gray-700"
                  value={block.props.text ?? ""}
                  onChange={handleRichFieldChange}
                  onActivate={registerActiveEditor}
                  onSelectionChange={updateSelectionRange}
                />
              </label>
              <div className="grid gap-3 md:grid-cols-3">
                <label className="space-y-1 text-sm">
                  <span className="block text-gray-600">平均评分</span>
                  <BufferedEditorInput
                    className="w-full rounded border px-3 py-2"
                    type="number"
                    min={0}
                    max={5}
                    step={0.1}
                    value={googleReviewAverageRating || ""}
                    onChange={(event) => onChange({ googleReviewAverageRating: normalizeGoogleReviewAverage(event.target.value, 0) })}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="block text-gray-600">评论总数</span>
                  <BufferedEditorInput
                    className="w-full rounded border px-3 py-2"
                    type="number"
                    min={0}
                    step={1}
                    value={googleReviewTotalCount || ""}
                    onChange={(event) => onChange({ googleReviewTotalCount: normalizeGoogleReviewTotalCount(event.target.value, 0) })}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="block text-gray-600">最多显示</span>
                  <BufferedEditorInput
                    className="w-full rounded border px-3 py-2"
                    type="number"
                    min={1}
                    max={12}
                    step={1}
                    value={googleReviewMaxItems}
                    onChange={(event) => onChange({ googleReviewMaxItems: clampGoogleReviewMaxItemsInput(event.target.value) })}
                  />
                </label>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="block text-gray-600">Google 评论页链接</span>
                  <BufferedEditorInput
                    className="w-full rounded border px-3 py-2"
                    value={block.props.googleReviewUrl ?? ""}
                    placeholder="https://www.google.com/maps/place/..."
                    onChange={(event) => onChange({ googleReviewUrl: event.target.value })}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="block text-gray-600">写评价链接</span>
                  <BufferedEditorInput
                    className="w-full rounded border px-3 py-2"
                    value={block.props.googleReviewWriteUrl ?? ""}
                    placeholder="https://g.page/r/..."
                    onChange={(event) => onChange({ googleReviewWriteUrl: event.target.value })}
                  />
                </label>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="block text-gray-600">来源名称</span>
                  <BufferedEditorInput
                    className="w-full rounded border px-3 py-2"
                    value={block.props.googleReviewSourceLabel ?? ""}
                    placeholder="Google"
                    onChange={(event) => onChange({ googleReviewSourceLabel: event.target.value })}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="block text-gray-600">空状态文案</span>
                  <BufferedEditorInput
                    className="w-full rounded border px-3 py-2"
                    value={block.props.googleReviewEmptyText ?? ""}
                    onChange={(event) => onChange({ googleReviewEmptyText: event.target.value })}
                  />
                </label>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <label className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
                  <BufferedEditorInput
                    type="checkbox"
                    checked={block.props.googleReviewShowAuthorPhoto !== false}
                    onChange={(event) => onChange({ googleReviewShowAuthorPhoto: event.target.checked })}
                  />
                  显示头像
                </label>
                <label className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
                  <BufferedEditorInput
                    type="checkbox"
                    checked={block.props.googleReviewShowDates !== false}
                    onChange={(event) => onChange({ googleReviewShowDates: event.target.checked })}
                  />
                  显示日期
                </label>
                <label className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
                  <BufferedEditorInput
                    type="checkbox"
                    checked={block.props.googleReviewShowReplies !== false}
                    onChange={(event) => onChange({ googleReviewShowReplies: event.target.checked })}
                  />
                  显示商家回复
                </label>
              </div>
              <GoogleBusinessProfileReviewsPanel
                siteId={runtimeSiteId}
                request={onGoogleBusinessProfileRequest}
                currentSyncedAt={block.props.googleReviewSyncedAt}
                currentLocationName={block.props.googleReviewLocationName}
                autoSync={block.props.googleReviewAutoSync === true}
                onApply={(patch) => onChange(patch)}
              />
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">手动备用评论</div>
                    <div className="mt-1 text-xs leading-5 text-slate-500">未连接 Google 时可手动维护；官方同步成功后会自动替换这组快照。</div>
                  </div>
                  <button
                    type="button"
                    className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50"
                    onClick={addReviewItem}
                  >
                    新增评论
                  </button>
                </div>
                {reviewItems.length > 0 ? (
                  <div className="mt-3 grid gap-3">
                    {reviewItems.map((item, index) => {
                      const itemId = item.id || `google-review-${index + 1}`;
                      return (
                        <div key={itemId} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm font-semibold text-slate-900">评论 {index + 1}</div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="rounded border bg-white px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                                disabled={index === 0}
                                onClick={() => moveReviewItem(itemId, -1)}
                              >
                                上移
                              </button>
                              <button
                                type="button"
                                className="rounded border bg-white px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                                disabled={index >= reviewItems.length - 1}
                                onClick={() => moveReviewItem(itemId, 1)}
                              >
                                下移
                              </button>
                              <button
                                type="button"
                                className="rounded border border-rose-200 bg-white px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
                                onClick={() => removeReviewItem(itemId)}
                              >
                                删除
                              </button>
                            </div>
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-3">
                            <label className="space-y-1 text-sm md:col-span-1">
                              <span className="block text-gray-600">作者名</span>
                              <BufferedEditorInput
                                className="w-full rounded border px-3 py-2"
                                value={item.reviewerName ?? ""}
                                onChange={(event) => updateReviewItem(itemId, { reviewerName: event.target.value })}
                              />
                            </label>
                            <label className="space-y-1 text-sm">
                              <span className="block text-gray-600">评分</span>
                              <BufferedEditorInput
                                className="w-full rounded border px-3 py-2"
                                type="number"
                                min={1}
                                max={5}
                                step={1}
                                value={item.rating || 5}
                                onChange={(event) => updateReviewItem(itemId, { rating: normalizeGoogleReviewRating(event.target.value, 5) })}
                              />
                            </label>
                            <label className="space-y-1 text-sm">
                              <span className="block text-gray-600">日期</span>
                              <BufferedEditorInput
                                className="w-full rounded border px-3 py-2"
                                type="date"
                                value={toDateInputValue(item.createTime)}
                                onChange={(event) => updateReviewItem(itemId, { createTime: fromDateInputValue(event.target.value) })}
                              />
                            </label>
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <label className="space-y-1 text-sm">
                              <span className="block text-gray-600">头像 URL</span>
                              <BufferedEditorInput
                                className="w-full rounded border px-3 py-2"
                                value={item.reviewerPhotoUrl ?? ""}
                                onChange={(event) => updateReviewItem(itemId, { reviewerPhotoUrl: event.target.value })}
                              />
                            </label>
                            <label className="space-y-1 text-sm">
                              <span className="block text-gray-600">作者主页 URL</span>
                              <BufferedEditorInput
                                className="w-full rounded border px-3 py-2"
                                value={item.reviewerProfileUrl ?? ""}
                                onChange={(event) => updateReviewItem(itemId, { reviewerProfileUrl: event.target.value })}
                              />
                            </label>
                          </div>
                          <label className="mt-3 block space-y-1 text-sm">
                            <span className="block text-gray-600">评论正文</span>
                            <BufferedEditorTextarea
                              className="min-h-[86px] w-full rounded border px-3 py-2"
                              value={item.comment ?? ""}
                              onChange={(event) => updateReviewItem(itemId, { comment: event.target.value })}
                            />
                          </label>
                          <label className="mt-3 block space-y-1 text-sm">
                            <span className="block text-gray-600">商家回复</span>
                            <BufferedEditorTextarea
                              className="min-h-[68px] w-full rounded border px-3 py-2"
                              value={item.replyComment ?? ""}
                              onChange={(event) => updateReviewItem(itemId, { replyComment: event.target.value })}
                            />
                          </label>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-500">
                    还没有评论。点击“新增评论”后填写内容。
                  </div>
                )}
              </div>
              <GoogleReviewsBlock {...googleReviewsPreviewProps} googleReviewItems={reviewItems} />
            </div>,
          ) : (
            <GoogleReviewsBlock {...googleReviewsPreviewProps} />
          )}
          {resizeHandles}
        </div>
      </section>
    );
  }

  if (block.type === "merchant-list") {
    const maxItems =
      typeof block.props.maxItems === "number" && Number.isFinite(block.props.maxItems)
        ? Math.max(1, Math.min(24, Math.round(block.props.maxItems)))
        : 6;
    const emptyText = resolveLocalizedSystemDefaultText(block.props.emptyText, "暂无商户", locale);
    const merchantTabs = normalizeMerchantIndustryTabs(block.props.industryTabs).map((item) => ({
      ...item,
      label: localizeSystemDefaultText(item.label, locale),
    }));
    const activeMerchantTab = merchantTabs.find((item) => item.id === activeMerchantIndustryTabId) ?? merchantTabs[0];
    const activeIndustry = activeMerchantTab?.industry ?? "all";
    const filteredMerchantSites = [...loadPlatformState().sites]
      .filter((site) => isMerchantNumericId(String(site.id ?? "").trim()))
      .filter((site) => (activeIndustry === "all" ? true : site.industry === activeIndustry))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const merchantTotalPages = Math.max(1, Math.ceil(filteredMerchantSites.length / maxItems));
    const safeMerchantPreviewPageIndex = Math.min(merchantPreviewPageIndex, merchantTotalPages - 1);
    const merchantSites = filteredMerchantSites.slice(
      safeMerchantPreviewPageIndex * maxItems,
      safeMerchantPreviewPageIndex * maxItems + maxItems,
    );
    const hasMerchantHeading = hasVisibleRichText(block.props.heading);
    const hasMerchantText = hasVisibleRichText(block.props.text);
    const localizedMerchantHeading = resolveLocalizedSystemDefaultText(block.props.heading, "商户列表", locale);
    const localizedMerchantText = resolveLocalizedSystemDefaultText(block.props.text, "展示平台注册商户的前台入口", locale);
    const prevPageLabel = resolveLocalizedSystemDefaultText(undefined, "上一页", locale);
    const nextPageLabel = resolveLocalizedSystemDefaultText(undefined, "下一页", locale);
    const merchantTabButtonBgColor = (block.props.merchantTabButtonBgColor ?? "#ffffff").trim() || "#ffffff";
    const merchantTabButtonBgOpacity =
      typeof block.props.merchantTabButtonBgOpacity === "number" && Number.isFinite(block.props.merchantTabButtonBgOpacity)
        ? Math.max(0, Math.min(1, block.props.merchantTabButtonBgOpacity))
        : 1;
    const merchantTabButtonBorderStyle = (block.props.merchantTabButtonBorderStyle ?? "solid") as BlockBorderStyle;
    const merchantTabButtonBorderColor = normalizeNavBorderColor(
      block.props.merchantTabButtonBorderColor ?? "#cbd5e1",
      "#cbd5e1",
    );
    const merchantTabButtonActiveBgColor =
      (block.props.merchantTabButtonActiveBgColor ?? "#000000").trim() || "#000000";
    const merchantTabButtonActiveBgOpacity =
      typeof block.props.merchantTabButtonActiveBgOpacity === "number" &&
      Number.isFinite(block.props.merchantTabButtonActiveBgOpacity)
        ? Math.max(0, Math.min(1, block.props.merchantTabButtonActiveBgOpacity))
        : 1;
    const merchantTabButtonActiveBorderStyle =
      (block.props.merchantTabButtonActiveBorderStyle ?? "solid") as BlockBorderStyle;
    const merchantTabButtonActiveBorderColor = normalizeNavBorderColor(
      block.props.merchantTabButtonActiveBorderColor ?? "#111827",
      "#111827",
    );
    const merchantPagerButtonBgColor = (block.props.merchantPagerButtonBgColor ?? "#ffffff").trim() || "#ffffff";
    const merchantPagerButtonBgOpacity =
      typeof block.props.merchantPagerButtonBgOpacity === "number" && Number.isFinite(block.props.merchantPagerButtonBgOpacity)
        ? Math.max(0, Math.min(1, block.props.merchantPagerButtonBgOpacity))
        : 1;
    const merchantPagerButtonBorderStyle = (block.props.merchantPagerButtonBorderStyle ?? "solid") as BlockBorderStyle;
    const merchantPagerButtonBorderColor = normalizeNavBorderColor(
      block.props.merchantPagerButtonBorderColor ?? "#cbd5e1",
      "#cbd5e1",
    );
    const merchantPagerButtonDisabledBgColor =
      (block.props.merchantPagerButtonDisabledBgColor ?? "#e5e7eb").trim() || "#e5e7eb";
    const merchantPagerButtonDisabledBgOpacity =
      typeof block.props.merchantPagerButtonDisabledBgOpacity === "number" &&
      Number.isFinite(block.props.merchantPagerButtonDisabledBgOpacity)
        ? Math.max(0, Math.min(1, block.props.merchantPagerButtonDisabledBgOpacity))
        : 1;
    const merchantPagerButtonDisabledBorderStyle =
      (block.props.merchantPagerButtonDisabledBorderStyle ?? "solid") as BlockBorderStyle;
    const merchantPagerButtonDisabledBorderColor = normalizeNavBorderColor(
      block.props.merchantPagerButtonDisabledBorderColor ?? "#cbd5e1",
      "#cbd5e1",
    );
    const merchantCardBgColor = (block.props.merchantCardBgColor ?? "#f8fafc").trim() || "#f8fafc";
    const merchantCardBgOpacity =
      typeof block.props.merchantCardBgOpacity === "number" && Number.isFinite(block.props.merchantCardBgOpacity)
        ? Math.max(0, Math.min(1, block.props.merchantCardBgOpacity))
        : 1;
    const merchantCardBorderStyle = (block.props.merchantCardBorderStyle ?? "solid") as BlockBorderStyle;
    const merchantCardBorderColor = normalizeNavBorderColor(block.props.merchantCardBorderColor ?? "#cbd5e1", "#cbd5e1");
    const merchantTabButtonStyle = {
      ...getBlockBorderInlineStyle(merchantTabButtonBorderStyle, merchantTabButtonBorderColor),
      ...getColorLayerStyle(merchantTabButtonBgColor, merchantTabButtonBgOpacity),
    };
    const merchantTabButtonActiveStyle = {
      ...getBlockBorderInlineStyle(merchantTabButtonActiveBorderStyle, merchantTabButtonActiveBorderColor),
      ...getColorLayerStyle(merchantTabButtonActiveBgColor, merchantTabButtonActiveBgOpacity),
    };
    const merchantPagerButtonStyle = {
      ...getBlockBorderInlineStyle(merchantPagerButtonBorderStyle, merchantPagerButtonBorderColor),
      ...getColorLayerStyle(merchantPagerButtonBgColor, merchantPagerButtonBgOpacity),
    };
    const merchantPagerButtonDisabledStyle = {
      ...getBlockBorderInlineStyle(merchantPagerButtonDisabledBorderStyle, merchantPagerButtonDisabledBorderColor),
      ...getColorLayerStyle(merchantPagerButtonDisabledBgColor, merchantPagerButtonDisabledBgOpacity),
    };
    const legacyMerchantCardStyle = {
      bgColor: merchantCardBgColor,
      bgOpacity: merchantCardBgOpacity,
      borderStyle: merchantCardBorderStyle,
      borderColor: merchantCardBorderColor,
    };
    const merchantTabButtonBaseClass =
      "absolute flex items-center justify-center rounded px-3 py-1.5 text-center text-xs leading-tight transition pointer-events-auto";
    const merchantPagerButtonBaseClass =
      "absolute flex items-center justify-center rounded px-3 py-1.5 text-center text-xs leading-tight transition pointer-events-auto disabled:cursor-not-allowed";
    const merchantTypographyBaseStyle: Record<string, string | number> = {};
    if (block.props.fontFamily?.trim()) merchantTypographyBaseStyle.fontFamily = block.props.fontFamily.trim();
    if (typeof block.props.fontSize === "number" && Number.isFinite(block.props.fontSize) && block.props.fontSize > 0) {
      merchantTypographyBaseStyle.fontSize = block.props.fontSize;
    }
    if (block.props.fontWeight) merchantTypographyBaseStyle.fontWeight = block.props.fontWeight;
    if (block.props.fontStyle) merchantTypographyBaseStyle.fontStyle = block.props.fontStyle;
    if (block.props.textDecoration) merchantTypographyBaseStyle.textDecoration = block.props.textDecoration;
    const merchantFontColor = (block.props.fontColor ?? "").trim();
    const merchantFontColorIsGradient = !!merchantFontColor && isGradientToken(merchantFontColor);
    const merchantButtonLabelStyle: Record<string, string | number> = {
      ...merchantTypographyBaseStyle,
      ...(merchantFontColor
        ? merchantFontColorIsGradient
          ? {
              backgroundImage: merchantFontColor,
              backgroundClip: "text",
              WebkitBackgroundClip: "text",
              color: "transparent",
            }
          : { color: merchantFontColor }
        : {}),
    };
    const merchantInputTextStyle: Record<string, string | number> = {
      ...merchantTypographyBaseStyle,
      ...(merchantFontColor && !merchantFontColorIsGradient ? { color: merchantFontColor } : {}),
    };
    const merchantCardTypographyMap = (block.props.merchantCardTypography ??
      {}) as Partial<Record<MerchantCardTextRole, TypographyEditableProps>>;
    const merchantCardNameTextStyle = buildTypographyInlineStyle(merchantCardTypographyMap.name);
    const merchantCardIndustryTextStyle = buildTypographyInlineStyle(merchantCardTypographyMap.industry);
    const merchantCardDomainTextStyle = buildTypographyInlineStyle(merchantCardTypographyMap.domain);
    const merchantCardTextLayout = (block.props.merchantCardTextLayout ?? {}) as MerchantCardTextLayoutConfig;
    const merchantCardNameTextPosition = resolveMerchantCardTextPosition(merchantCardTextLayout, "name");
    const merchantCardIndustryTextPosition = resolveMerchantCardTextPosition(merchantCardTextLayout, "industry");
    const merchantCardDomainTextPosition = resolveMerchantCardTextPosition(merchantCardTextLayout, "domain");
    const merchantCardTextBoxVisible = block.props.merchantCardTextBoxVisible === true;
    const merchantCardTextBoxClass = merchantCardTextBoxVisible
      ? "inline-flex w-fit max-w-full rounded border border-slate-300 bg-white/90 px-1.5 py-0.5"
      : "inline-flex w-fit max-w-full";
    const merchantCardLayout = (block.props.merchantCardLayout ?? {}) as MerchantCardLayoutConfig;
    const merchantLayoutEntries = resolveMerchantListLayoutEntries(merchantCardLayout, maxItems, merchantTabs.length);
    const adaptiveMerchantLayoutEntries = resolveAdaptiveMerchantListEntries(merchantLayoutEntries, {
      availableWidth: typeof blockWidth === "number" ? Math.max(160, blockWidth - 48) : undefined,
      tabLabels: merchantTabs.map((item) => item.label),
      prevLabel: prevPageLabel,
      nextLabel: nextPageLabel,
    });
    const merchantCardEntries = adaptiveMerchantLayoutEntries.filter((item) => item.kind === "card");
    const merchantPrevLayout = adaptiveMerchantLayoutEntries.find((item) => item.kind === "prev");
    const merchantNextLayout = adaptiveMerchantLayoutEntries.find((item) => item.kind === "next");
    const merchantCardCanvasWidth = getMerchantLayoutCanvasWidth(adaptiveMerchantLayoutEntries);
    const merchantCardCanvasHeight = getMerchantLayoutCanvasHeight(adaptiveMerchantLayoutEntries);
    const merchantCardsContainerHeight = getMerchantLayoutContainerHeight(adaptiveMerchantLayoutEntries);
    const merchantCardSnapStep = Math.max(2, Math.min(40, Math.round(merchantCardLayoutSnapStep) || 8));
    const maybeSnapMerchantCard = (value: number, min = 0) => {
      const clamped = Math.max(min, Math.round(value));
      if (!merchantCardLayoutSnapEnabled) return clamped;
      return Math.max(min, Math.round(clamped / merchantCardSnapStep) * merchantCardSnapStep);
    };
    const findMerchantCardEntry = (key: MerchantListLayoutKey) =>
      merchantLayoutEntries.find((item) => item.key === key);
    const saveMerchantTabs = (tabs: MerchantIndustryTab[]) => {
      const normalized = normalizeMerchantIndustryTabs(tabs);
      onChange({ industryTabs: toMerchantIndustryTabInputs(normalized) });
      setActiveMerchantIndustryTabId((prev) =>
        normalized.some((item) => item.id === prev) ? prev : (normalized[0]?.id ?? "tab-recommended"),
      );
    };
    const selectMerchantCardLayoutEntry = (key: MerchantListLayoutKey, multi: boolean) => {
      if (multi) {
        setActiveMerchantCardLayoutKeys((prev) =>
          prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key],
        );
      } else {
        setActiveMerchantCardLayoutKeys([key]);
      }
    };
    const startMerchantCardLayoutDrag = (key: MerchantListLayoutKey, event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const source = findMerchantCardEntry(key);
      if (!source) return;
      if (event.ctrlKey) {
        selectMerchantCardLayoutEntry(key, true);
        return;
      }
      const selectedKeys =
        activeMerchantCardLayoutKeys.includes(key) && activeMerchantCardLayoutKeys.length > 0
          ? activeMerchantCardLayoutKeys
          : [key];
      setActiveMerchantCardLayoutKeys(selectedKeys);
      merchantCardLayoutCanvasFocusRef.current?.focus();
      const startX = event.clientX;
      const startY = event.clientY;
      const originMap = new Map(
        selectedKeys.map((selectedKey) => {
          const found = findMerchantCardEntry(selectedKey);
          return [
            selectedKey,
            { x: found?.x ?? 0, y: found?.y ?? 0, width: found?.width ?? 300, height: found?.height ?? 180 },
          ] as const;
        }),
      );
      const onMove = (e: MouseEvent) => {
        const dx = Math.round(e.clientX - startX);
        const dy = Math.round(e.clientY - startY);
        const nextLayout: MerchantCardLayoutConfig = { ...merchantCardLayout };
        selectedKeys.forEach((selectedKey) => {
          const origin = originMap.get(selectedKey);
          const found = findMerchantCardEntry(selectedKey);
          if (!origin || !found) return;
          nextLayout[selectedKey] = {
            x: maybeSnapMerchantCard(origin.x + dx),
            y: maybeSnapMerchantCard(origin.y + dy),
            width: clampMerchantCardLayoutValue(
              (merchantCardLayout[selectedKey] ?? {}).width,
              origin.width,
              found.minWidth,
            ),
            height: clampMerchantCardLayoutValue(
              (merchantCardLayout[selectedKey] ?? {}).height,
              origin.height,
              found.minHeight,
            ),
          };
        });
        onChange({ merchantCardLayout: nextLayout });
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
    const startMerchantCardLayoutResize = (
      key: MerchantListLayoutKey,
      direction: "width" | "height",
      event: ReactMouseEvent<HTMLDivElement>,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      const source = findMerchantCardEntry(key);
      if (!source) return;
      const selectedKeys =
        activeMerchantCardLayoutKeys.includes(key) && activeMerchantCardLayoutKeys.length > 0
          ? activeMerchantCardLayoutKeys
          : [key];
      setActiveMerchantCardLayoutKeys(selectedKeys);
      merchantCardLayoutCanvasFocusRef.current?.focus();
      const startX = event.clientX;
      const startY = event.clientY;
      const originWidths = new Map(
        selectedKeys.map((selectedKey) => {
          const found = findMerchantCardEntry(selectedKey);
          return [selectedKey, found?.width ?? 300] as const;
        }),
      );
      const originHeights = new Map(
        selectedKeys.map((selectedKey) => {
          const found = findMerchantCardEntry(selectedKey);
          return [selectedKey, found?.height ?? 180] as const;
        }),
      );
      const onMove = (e: MouseEvent) => {
        const deltaWidth = Math.round(e.clientX - startX);
        const deltaHeight = Math.round(e.clientY - startY);
        const nextLayout: MerchantCardLayoutConfig = { ...merchantCardLayout };
        selectedKeys.forEach((selectedKey) => {
          const found = findMerchantCardEntry(selectedKey);
          if (!found) return;
          const current = merchantCardLayout[selectedKey] ?? {};
          const originWidth = originWidths.get(selectedKey) ?? found.width;
          const originHeight = originHeights.get(selectedKey) ?? found.height;
          nextLayout[selectedKey] = {
            x: clampMerchantCardLayoutValue(current.x, found.x),
            y: clampMerchantCardLayoutValue(current.y, found.y),
            width:
              direction === "width"
                ? maybeSnapMerchantCard(originWidth + deltaWidth, found.minWidth)
                : clampMerchantCardLayoutValue(current.width, found.width, found.minWidth),
            height:
              direction === "height"
                ? maybeSnapMerchantCard(originHeight + deltaHeight, found.minHeight)
                : clampMerchantCardLayoutValue(current.height, found.height, found.minHeight),
          };
        });
        onChange({ merchantCardLayout: nextLayout });
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
    const handleMerchantCardLayoutCanvasKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (activeMerchantCardLayoutKeys.length === 0) return;
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const step = event.shiftKey
        ? merchantCardLayoutSnapEnabled
          ? Math.max(merchantCardSnapStep * 2, 10)
          : 10
        : merchantCardLayoutSnapEnabled
          ? merchantCardSnapStep
          : 2;
      const deltaX = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const deltaY = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      const nextLayout: MerchantCardLayoutConfig = { ...merchantCardLayout };
      activeMerchantCardLayoutKeys.forEach((selectedKey) => {
        const source = findMerchantCardEntry(selectedKey);
        if (!source) return;
        const current = merchantCardLayout[selectedKey] ?? {};
        nextLayout[selectedKey] = {
          x: maybeSnapMerchantCard(clampMerchantCardLayoutValue(current.x, source.x) + deltaX),
          y: maybeSnapMerchantCard(clampMerchantCardLayoutValue(current.y, source.y) + deltaY),
          width: clampMerchantCardLayoutValue(current.width, source.width, source.minWidth),
          height: clampMerchantCardLayoutValue(current.height, source.height, source.minHeight),
        };
      });
      onChange({ merchantCardLayout: nextLayout });
    };
    const alignSelectedMerchantCardEntries = (
      mode: "left" | "right" | "same-width" | "same-height" | "distribute-x" | "distribute-y",
    ) => {
      const selected = merchantLayoutEntries.filter((item) => activeMerchantCardLayoutKeys.includes(item.key));
      if (selected.length === 0) return;
      const nextLayout: MerchantCardLayoutConfig = { ...merchantCardLayout };
      if (mode === "left") {
        const selectedMinLeft = Math.min(...selected.map((item) => item.x));
        const deltaX = Math.max(0, selectedMinLeft);
        selected.forEach((item) => {
          const current = merchantCardLayout[item.key] ?? {};
          nextLayout[item.key] = {
            x: maybeSnapMerchantCard(Math.max(0, clampMerchantCardLayoutValue(current.x, item.x) - deltaX)),
            y: clampMerchantCardLayoutValue(current.y, item.y),
            width: clampMerchantCardLayoutValue(current.width, item.width, item.minWidth),
            height: clampMerchantCardLayoutValue(current.height, item.height, item.minHeight),
          };
        });
      }
      if (mode === "right") {
        const selectedMaxRight = Math.max(...selected.map((item) => item.x + item.width));
        const deltaX = Math.max(0, merchantCardCanvasWidth - selectedMaxRight);
        selected.forEach((item) => {
          const current = merchantCardLayout[item.key] ?? {};
          nextLayout[item.key] = {
            x: maybeSnapMerchantCard(clampMerchantCardLayoutValue(current.x, item.x) + deltaX),
            y: clampMerchantCardLayoutValue(current.y, item.y),
            width: clampMerchantCardLayoutValue(current.width, item.width, item.minWidth),
            height: clampMerchantCardLayoutValue(current.height, item.height, item.minHeight),
          };
        });
      }
      if (mode === "same-width") {
        const width = Math.max(...selected.map((item) => item.width));
        selected.forEach((item) => {
          const current = merchantCardLayout[item.key] ?? {};
          nextLayout[item.key] = {
            x: clampMerchantCardLayoutValue(current.x, item.x),
            y: clampMerchantCardLayoutValue(current.y, item.y),
            width: Math.max(item.minWidth, width),
            height: clampMerchantCardLayoutValue(current.height, item.height, item.minHeight),
          };
        });
      }
      if (mode === "same-height") {
        const height = Math.max(...selected.map((item) => item.height));
        selected.forEach((item) => {
          const current = merchantCardLayout[item.key] ?? {};
          nextLayout[item.key] = {
            x: clampMerchantCardLayoutValue(current.x, item.x),
            y: clampMerchantCardLayoutValue(current.y, item.y),
            width: clampMerchantCardLayoutValue(current.width, item.width, item.minWidth),
            height: Math.max(item.minHeight, height),
          };
        });
      }
      if (mode === "distribute-x") {
        if (selected.length < 2) return;
        const sorted = [...selected].sort((a, b) => a.x - b.x);
        const totalWidth = sorted.reduce((sum, item) => sum + item.width, 0);
        const gap = sorted.length > 1 ? Math.max(0, (merchantCardCanvasWidth - totalWidth) / (sorted.length - 1)) : 0;
        const baselineY = Math.min(...sorted.map((item) => item.y));
        let cursorX = 0;
        sorted.forEach((item) => {
          const current = merchantCardLayout[item.key] ?? {};
          nextLayout[item.key] = {
            x: Math.max(0, Math.round(cursorX)),
            y: Math.max(0, Math.round(baselineY)),
            width: clampMerchantCardLayoutValue(current.width, item.width, item.minWidth),
            height: clampMerchantCardLayoutValue(current.height, item.height, item.minHeight),
          };
          cursorX += item.width + gap;
        });
      }
      if (mode === "distribute-y") {
        if (selected.length < 2) return;
        const sorted = [...selected].sort((a, b) => a.y - b.y);
        const totalHeight = sorted.reduce((sum, item) => sum + item.height, 0);
        const gap = sorted.length > 1 ? Math.max(0, (merchantCardCanvasHeight - totalHeight) / (sorted.length - 1)) : 0;
        const baselineX = Math.min(...sorted.map((item) => item.x));
        let cursorY = 0;
        sorted.forEach((item) => {
          const current = merchantCardLayout[item.key] ?? {};
          nextLayout[item.key] = {
            x: Math.max(0, Math.round(baselineX)),
            y: Math.max(0, Math.round(cursorY)),
            width: clampMerchantCardLayoutValue(current.width, item.width, item.minWidth),
            height: clampMerchantCardLayoutValue(current.height, item.height, item.minHeight),
          };
          cursorY += item.height + gap;
        });
      }
      onChange({ merchantCardLayout: nextLayout });
    };
    const applyMerchantCardLayoutTemplate = (mode: "single-tight" | "single-wide" | "double-column") => {
      if (merchantCardEntries.length === 0) return;
      const safeCanvasWidth = Math.max(
        260,
        Math.min(
          1200,
          typeof block.props.blockWidth === "number" && Number.isFinite(block.props.blockWidth)
            ? Math.round(block.props.blockWidth) - 64
            : merchantCardCanvasWidth,
        ),
      );
      const nextLayout: MerchantCardLayoutConfig = { ...merchantCardLayout };
      if (mode === "single-tight") {
        const width = Math.max(220, Math.min(safeCanvasWidth, 360));
        merchantCardEntries.forEach((item, idx) => {
          nextLayout[item.key] = {
            x: 0,
            y: maybeSnapMerchantCard(idx * 204),
            width: Math.max(item.minWidth, width),
            height: Math.max(item.minHeight, 190),
          };
        });
      }
      if (mode === "single-wide") {
        const width = Math.max(260, safeCanvasWidth);
        merchantCardEntries.forEach((item, idx) => {
          nextLayout[item.key] = {
            x: 0,
            y: maybeSnapMerchantCard(idx * 214),
            width: Math.max(item.minWidth, width),
            height: Math.max(item.minHeight, 190),
          };
        });
      }
      if (mode === "double-column") {
        const gap = 14;
        const width = Math.max(220, Math.floor((safeCanvasWidth - gap) / 2));
        merchantCardEntries.forEach((item, idx) => {
          const col = idx % 2;
          const row = Math.floor(idx / 2);
          nextLayout[item.key] = {
            x: maybeSnapMerchantCard(col * (width + gap)),
            y: maybeSnapMerchantCard(row * 204),
            width: Math.max(item.minWidth, width),
            height: Math.max(item.minHeight, 190),
          };
        });
      }
      setActiveMerchantCardLayoutKeys(merchantCardEntries.map((item) => item.key));
      onChange({ merchantCardLayout: nextLayout });
    };

    return (
      <section
        data-block-id={block.id}
        data-jump-target={publicBlockId}
        data-block-public-id={publicBlockId}
        className={`${shellClass} pointer-events-none`}
        style={offsetStyle}
      >
        <EditorBlockHeader
          blockId={publicBlockId}
          draggingBlockId={draggingBlockId}
          isSelected={isSelected}
          onDragHandleMouseDown={onDragHandleMouseDown}
          onNudge={onNudge}
          onOpenLayerSettings={openLayerSettings}
          onEditTypography={editTypography}
          onInsertText={insertTextBox}
          onInsertImage={insertImage}
          onEditImageSettings={editImageSettings}
          onEditBorderStyle={editBorderSettings}
          isMobileViewport={previewViewport === "mobile"}
          mobileFitScreenWidth={block.props.mobileFitScreenWidth === true}
          onToggleMobileFitScreenWidth={handleToggleMobileFitScreenWidth}
          blockOpenByButton={blockOpenByButton}
          onToggleBlockOpenMode={toggleBlockOpenMode}
          onDelete={onDelete}
        />
        <div
          ref={resizeTargetRef}
          data-block-visual-boundary
          className={`${cardClass} relative`}
          onClick={onSelect}
          style={blockPreviewShellStyle}
        >
          {imageDialog}
          {imageSettingsDialog}
          {borderSettingsDialog}
          {merchantButtonStyleDialog}
          {merchantCardStyleDialog}
          {merchantCardTypographyDialog}
          {layerSettingsDialog}
          {typographyDialog}
          {isSelected ? renderSelectedEditor(
            <>
              <div className="space-y-1 mt-3">
                <RichTextEditor
                  field="heading"
                  className="border p-2 rounded w-full text-xl font-bold"
                  value={block.props.heading ?? ""}
                  onChange={handleRichFieldChange}
                  onActivate={registerActiveEditor}
                  onSelectionChange={updateSelectionRange}
                />
              </div>
              <div className="space-y-1 mt-3">
                <RichTextEditor
                  field="text"
                  className="border p-2 rounded w-full min-h-[90px] text-gray-700"
                  value={block.props.text ?? ""}
                  onChange={handleRichFieldChange}
                  onActivate={registerActiveEditor}
                  onSelectionChange={updateSelectionRange}
                />
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="space-y-1 text-sm text-gray-600">
                  <span>显示数量</span>
                  <BufferedEditorInput
                    type="number"
                    min={1}
                    max={24}
                    className="w-full rounded border p-2"
                    value={maxItems}
                    onChange={(e) =>
                      onChange({
                        maxItems: Math.max(1, Math.min(24, Number(e.target.value) || 1)),
                      })
                    }
                  />
                </label>
                <label className="space-y-1 text-sm text-gray-600">
                  <span>空状态文案</span>
                  <BufferedEditorTextarea
                    className="min-h-[88px] w-full rounded border p-2"
                    value={block.props.emptyText ?? ""}
                    onChange={(e) => onChange({ emptyText: e.target.value })}
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
                  onClick={editMerchantButtonStyle}
                >
                  按钮样式
                </button>
                <button
                  type="button"
                  className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
                  onClick={editMerchantCardStyle}
                >
                  商户框样式
                </button>
                <button
                  type="button"
                  className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
                  onClick={editMerchantCardTypography}
                >
                  商户框字体
                </button>
              </div>
              <div className="mt-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-gray-800">标签行业设置</div>
                  <button
                    type="button"
                    className="rounded border bg-white px-2 py-1 text-xs hover:bg-gray-100"
                    onClick={() => {
                      const next = [
                        ...merchantTabs,
                        {
                          id: `tab-${Date.now()}`,
                          label: `标签${merchantTabs.length + 1}`,
                          industry: (MERCHANT_INDUSTRY_OPTIONS[0] ?? "餐饮") as MerchantIndustryTab["industry"],
                        },
                      ];
                      saveMerchantTabs(next);
                    }}
                  >
                    新增标签
                  </button>
                </div>
                <div className="mt-2 space-y-2">
                  {merchantTabs.map((tab, index) => {
                    const locked = index === 0;
                    return (
                      <div key={tab.id} className="grid gap-2 rounded border bg-white p-2 md:grid-cols-[1fr_140px_88px]">
                        <BufferedEditorInput
                          className={`rounded border px-2 py-1.5 text-sm ${locked ? "bg-gray-100 text-gray-500" : ""}`}
                          value={tab.label}
                          disabled={locked}
                          style={merchantInputTextStyle}
                          onChange={(event) => {
                            const nextLabel = event.target.value;
                            const next = merchantTabs.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, label: nextLabel } : item,
                            );
                            saveMerchantTabs(next);
                          }}
                        />
                        <select
                          className={`rounded border px-2 py-1.5 text-sm ${locked ? "bg-gray-100 text-gray-500" : ""}`}
                          value={tab.industry}
                          disabled={locked}
                          onChange={(event) => {
                            const nextIndustry = event.target.value as MerchantIndustryTab["industry"];
                            const next = merchantTabs.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, industry: nextIndustry } : item,
                            );
                            saveMerchantTabs(next);
                          }}
                        >
                          <option value="all">全部商户</option>
                          {MERCHANT_INDUSTRY_OPTIONS.map((item) => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className={`rounded border px-2 py-1.5 text-xs ${
                            locked ? "cursor-not-allowed bg-gray-100 text-gray-400" : "bg-white hover:bg-gray-100"
                          }`}
                          disabled={locked}
                          onClick={() => {
                            if (locked) return;
                            saveMerchantTabs(merchantTabs.filter((_, itemIndex) => itemIndex !== index));
                          }}
                        >
                          删除
                        </button>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-gray-500">首个标签固定为“推荐”，对应全部商户。</p>
              </div>
              <div className="mt-3">
                <div className="text-xs text-gray-500 mb-2">拖动可改位置，拉伸右边缘改宽度，拉伸下边缘改高度</div>
                <div className="mb-2 flex flex-wrap gap-2">
                  <label className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border bg-white">
                    <BufferedEditorInput
                      type="checkbox"
                      checked={merchantCardLayoutSnapEnabled}
                      onChange={(e) => setMerchantCardLayoutSnapEnabled(e.target.checked)}
                    />
                    {"吸附网格"}
                  </label>
                  <select
                    className="px-2 py-1 text-xs rounded border bg-white"
                    value={merchantCardLayoutSnapStep}
                    onChange={(e) => setMerchantCardLayoutSnapStep(Math.max(2, Math.min(40, Number(e.target.value) || 8)))}
                  >
                    {[4, 6, 8, 10, 12, 16, 20].map((step) => (
                      <option key={step} value={step}>
                        {`网格 ${step}px`}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                    onClick={() => applyMerchantCardLayoutTemplate("single-tight")}
                  >
                    {"紧凑单列"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                    onClick={() => applyMerchantCardLayoutTemplate("single-wide")}
                  >
                    {"宽松单列"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                    onClick={() => applyMerchantCardLayoutTemplate("double-column")}
                  >
                    {"双列"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                    onClick={() => alignSelectedMerchantCardEntries("left")}
                  >
                    {"左"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                    onClick={() => alignSelectedMerchantCardEntries("right")}
                  >
                    {"右"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                    onClick={() => alignSelectedMerchantCardEntries("same-width")}
                  >
                    {"统一宽度"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                    onClick={() => alignSelectedMerchantCardEntries("same-height")}
                  >
                    {"统一高度"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                    onClick={() => alignSelectedMerchantCardEntries("distribute-x")}
                  >
                    {"横向均分"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                    onClick={() => alignSelectedMerchantCardEntries("distribute-y")}
                  >
                    {"纵向均分"}
                  </button>
                </div>
                <div
                  ref={merchantCardLayoutCanvasFocusRef}
                  className="relative rounded border border-dashed border-gray-300 bg-transparent"
                  style={{
                    minHeight: `${merchantCardCanvasHeight}px`,
                    width: `${merchantCardCanvasWidth}px`,
                    maxWidth: "100%",
                    backgroundImage: merchantCardLayoutSnapEnabled
                      ? "linear-gradient(to right, rgba(17,24,39,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(17,24,39,0.08) 1px, transparent 1px)"
                      : undefined,
                    backgroundSize: merchantCardLayoutSnapEnabled
                      ? `${Math.max(2, Math.min(40, merchantCardLayoutSnapStep))}px ${Math.max(2, Math.min(40, merchantCardLayoutSnapStep))}px`
                      : undefined,
                  }}
                  tabIndex={0}
                  onKeyDown={handleMerchantCardLayoutCanvasKeyDown}
                >
                  {merchantLayoutEntries.map((item) => (
                    <div
                      key={item.key}
                      className={`absolute rounded border bg-white px-2 py-1 shadow-sm cursor-move overflow-hidden ${
                        activeMerchantCardLayoutKeys.includes(item.key)
                          ? "border-blue-500 bg-blue-50/70 ring-4 ring-blue-400/45 shadow-md"
                          : "border-gray-300"
                      }`}
                      style={{ left: `${item.x}px`, top: `${item.y}px`, width: `${item.width}px`, height: `${item.height}px` }}
                      onMouseDown={(event) => startMerchantCardLayoutDrag(item.key, event)}
                    >
                      <div className="text-[11px] text-gray-500 truncate">{item.label}</div>
                      <div className="text-xs text-gray-800 truncate">{`宽${item.width} 高${item.height}`}</div>
                      <div
                        className="absolute top-0 right-0 h-full w-2 cursor-ew-resize"
                        onMouseDown={(event) => startMerchantCardLayoutResize(item.key, "width", event)}
                      />
                      <div
                        className="absolute bottom-0 left-0 h-2 w-full cursor-ns-resize"
                        onMouseDown={(event) => startMerchantCardLayoutResize(item.key, "height", event)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </>,
          ) : (
            <>
              {hasMerchantHeading ? (
                <h2
                  className="text-xl font-bold whitespace-pre-wrap break-words"
                  dangerouslySetInnerHTML={{ __html: toRichHtml(block.props.heading, localizedMerchantHeading) }}
                />
              ) : null}
              {hasMerchantText ? (
                <div
                  className="mt-2 text-sm text-gray-600 whitespace-pre-wrap break-words"
                  dangerouslySetInnerHTML={{ __html: toRichHtml(block.props.text, localizedMerchantText) }}
                />
              ) : null}
              <div className={`${hasMerchantHeading || hasMerchantText ? "mt-4 " : ""}max-w-full overflow-x-auto pb-1`}>
                <div className="relative" style={{ width: `${merchantCardCanvasWidth}px`, minHeight: `${merchantCardsContainerHeight}px` }}>
                  {merchantTabs.map((tab, index) => {
                    const layout = adaptiveMerchantLayoutEntries.find(
                      (item) => item.kind === "tab" && item.key === getMerchantTabKey(index),
                    );
                    if (!layout) return null;
                    const active = tab.id === activeMerchantTab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        className={`${merchantTabButtonBaseClass} ${getBlockBorderClass(
                          active ? merchantTabButtonActiveBorderStyle : merchantTabButtonBorderStyle,
                        )} ${active ? "text-white" : "text-slate-700 hover:brightness-[0.98]"}`}
                        style={{
                          left: `${layout.x}px`,
                          top: `${layout.y}px`,
                          width: `${layout.width}px`,
                          height: `${layout.height}px`,
                          ...(active ? merchantTabButtonActiveStyle : merchantTabButtonStyle),
                        }}
                        onClick={() => {
                          setActiveMerchantIndustryTabId(tab.id);
                          setMerchantPreviewPageIndex(0);
                        }}
                      >
                        <span className="block w-full break-words whitespace-normal" style={merchantButtonLabelStyle}>{tab.label}</span>
                      </button>
                    );
                  })}
                  {merchantSites.map((site, index) => {
                    const layout = buildMerchantCardPlacement(adaptiveMerchantLayoutEntries, index);
                    const targetIndustry = (site.industry || "all") as MerchantIndustryTabIndustry;
                    const styleConfig = resolveMerchantIndustryCardStyle(
                      block.props.merchantCardIndustryStyles,
                      targetIndustry,
                      legacyMerchantCardStyle,
                    );
                    const merchantCardStyle = {
                      ...getBlockBorderInlineStyle(styleConfig.borderStyle, styleConfig.borderColor),
                      ...getColorLayerStyle(styleConfig.bgColor, styleConfig.bgOpacity),
                    };
                    return (
                      <article
                        key={site.id}
                        className={`absolute rounded-xl p-4 overflow-auto ${getBlockBorderClass(styleConfig.borderStyle)}`}
                        style={{
                          left: `${layout.x}px`,
                          top: `${layout.y}px`,
                          width: `${layout.width}px`,
                          height: `${layout.height}px`,
                          ...merchantCardStyle,
                        }}
                      >
                        <div className="relative min-w-0 h-full">
                          <div
                            className={`${merchantCardTextBoxClass} text-base font-semibold text-slate-900`}
                            style={{
                              left: `${merchantCardNameTextPosition.x}px`,
                              top: `${merchantCardNameTextPosition.y}px`,
                              position: "absolute",
                              ...merchantCardNameTextStyle,
                            }}
                          >
                            <span className="truncate">{(site.merchantName ?? "").trim() || site.name}</span>
                          </div>
                          <div
                            className={`${merchantCardTextBoxClass} text-xs text-slate-500`}
                            style={{
                              left: `${merchantCardIndustryTextPosition.x}px`,
                              top: `${merchantCardIndustryTextPosition.y}px`,
                              position: "absolute",
                              ...merchantCardIndustryTextStyle,
                            }}
                          >
                            <span className="truncate">{site.industry || site.category || "月"}</span>
                          </div>
                          <div
                            className={`${merchantCardTextBoxClass} text-xs text-slate-500`}
                            style={{
                              left: `${merchantCardDomainTextPosition.x}px`,
                              top: `${merchantCardDomainTextPosition.y}px`,
                              position: "absolute",
                              ...merchantCardDomainTextStyle,
                            }}
                          >
                            <span className="truncate">{(site.location?.country ?? "") || "-"} / {(site.location?.province ?? "") || "-"} / {(site.location?.city ?? "") || "-"}</span>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                  {merchantSites.length === 0 ? (
                    <div
                      className="absolute rounded-lg border border-dashed px-4 py-6 text-sm text-slate-500"
                      style={{
                        left: "0px",
                        top: `${merchantCardEntries.length > 0 ? Math.min(...merchantCardEntries.map((item) => item.y)) : 52}px`,
                        width: `${merchantCardCanvasWidth}px`,
                        minHeight: `${Math.max(72, merchantCardEntries[0]?.height ?? 72)}px`,
                      }}
                    >
                      {emptyText}
                    </div>
                  ) : null}
                  {merchantPrevLayout ? (
                    <button
                      type="button"
                      className={`${merchantPagerButtonBaseClass} ${getBlockBorderClass(
                        safeMerchantPreviewPageIndex <= 0 ? merchantPagerButtonDisabledBorderStyle : merchantPagerButtonBorderStyle,
                      )} ${safeMerchantPreviewPageIndex <= 0 ? "text-slate-500" : "text-slate-700 hover:brightness-[0.98]"}`}
                      style={{
                        left: `${merchantPrevLayout.x}px`,
                        top: `${merchantPrevLayout.y}px`,
                        width: `${merchantPrevLayout.width}px`,
                        height: `${merchantPrevLayout.height}px`,
                        ...(safeMerchantPreviewPageIndex <= 0 ? merchantPagerButtonDisabledStyle : merchantPagerButtonStyle),
                      }}
                      disabled={safeMerchantPreviewPageIndex <= 0}
                      onClick={() => setMerchantPreviewPageIndex((prev) => Math.max(0, prev - 1))}
                    >
                      <span className="block w-full break-words whitespace-normal" style={merchantButtonLabelStyle}>{prevPageLabel}</span>
                    </button>
                  ) : null}
                  {merchantNextLayout ? (
                    <button
                      type="button"
                      className={`${merchantPagerButtonBaseClass} ${getBlockBorderClass(
                        safeMerchantPreviewPageIndex >= merchantTotalPages - 1
                          ? merchantPagerButtonDisabledBorderStyle
                          : merchantPagerButtonBorderStyle,
                      )} ${safeMerchantPreviewPageIndex >= merchantTotalPages - 1 ? "text-slate-500" : "text-slate-700 hover:brightness-[0.98]"}`}
                      style={{
                        left: `${merchantNextLayout.x}px`,
                        top: `${merchantNextLayout.y}px`,
                        width: `${merchantNextLayout.width}px`,
                        height: `${merchantNextLayout.height}px`,
                        ...(safeMerchantPreviewPageIndex >= merchantTotalPages - 1
                          ? merchantPagerButtonDisabledStyle
                          : merchantPagerButtonStyle),
                      }}
                      disabled={safeMerchantPreviewPageIndex >= merchantTotalPages - 1}
                      onClick={() => setMerchantPreviewPageIndex((prev) => Math.min(merchantTotalPages - 1, prev + 1))}
                    >
                      <span className="block w-full break-words whitespace-normal" style={merchantButtonLabelStyle}>{nextPageLabel}</span>
                    </button>
                  ) : null}
                </div>
              </div>
            </>
          )}
          {resizeHandles}
        </div>
      </section>
    );
  }

  if (block.type === "search-bar") {
    type SearchLayoutKey = "locate" | "country" | "province" | "city" | "keyword" | "action";
    const locateLabel = resolveLocalizedSystemDefaultText(block.props.locateLabel, "定位", locale);
    const actionLabel = resolveLocalizedSystemDefaultText(block.props.actionLabel, "搜索", locale);
    const cityPlaceholder = resolveLocalizedSystemDefaultText(block.props.cityPlaceholder, "选择城市", locale);
    const searchPlaceholder = resolveLocalizedSystemDefaultText(block.props.searchPlaceholder, "请输入关键词", locale);
    const countryLabel = resolveLocalizedSystemDefaultText(undefined, "国家", locale);
    const provinceLabel = resolveLocalizedSystemDefaultText(undefined, "省份", locale);
    const searchHintLabel = resolveLocalizedSystemDefaultText(undefined, "可点击定位，或手动选择国家/省份/城市。", locale);
    const locationOptionsApi = europeLocationOptionsApi;
    const countryOptions = locationOptionsApi?.getEuropeCountryOptions() ?? [];
    const resolvedCountryCode = (() => {
      const fromProps = (block.props.defaultCountryCode ?? "").toUpperCase();
      if (countryOptions.some((item) => item.code === fromProps)) return fromProps;
      return "";
    })();
    const provinceOptions = locationOptionsApi?.getEuropeProvinceOptions(resolvedCountryCode) ?? [];
    const resolvedProvinceCode = (() => {
      const fromProps = (block.props.defaultProvinceCode ?? "").trim();
      if (provinceOptions.some((item) => item.code === fromProps)) return fromProps;
      return "";
    })();
    const cityOptions = locationOptionsApi?.getEuropeCityOptions(resolvedCountryCode, resolvedProvinceCode) ?? [];
    const resolvedCity = (() => {
      const fromProps = (block.props.defaultCity ?? "").trim();
      if (cityOptions.includes(fromProps)) return fromProps;
      return "";
    })();
    const resolvedCountryName = countryOptions.find((item) => item.code === resolvedCountryCode)?.name ?? countryLabel;
    const resolvedProvinceName =
      provinceOptions.find((item) => item.code === resolvedProvinceCode)?.name ?? provinceLabel;
    const hasSearchHeading = hasVisibleRichText(block.props.heading);
    const hasSearchText = hasVisibleRichText(block.props.text);
    const localizedSearchHeading = resolveLocalizedSystemDefaultText(block.props.heading, "搜索", locale);
    const localizedSearchText = resolveLocalizedSystemDefaultText(block.props.text, "城市定位与内容搜索", locale);
    const searchButtonBgColor = (block.props.searchButtonBgColor ?? "#ffffff").trim() || "#ffffff";
    const searchButtonBgOpacity =
      typeof block.props.searchButtonBgOpacity === "number" && Number.isFinite(block.props.searchButtonBgOpacity)
        ? Math.max(0, Math.min(1, block.props.searchButtonBgOpacity))
        : 1;
    const searchButtonBorderStyle = (block.props.searchButtonBorderStyle ?? "solid") as BlockBorderStyle;
    const searchButtonBorderColor = normalizeNavBorderColor(block.props.searchButtonBorderColor ?? "#6b7280", "#6b7280");
    const searchButtonActiveBgColor = (block.props.searchButtonActiveBgColor ?? "#000000").trim() || "#000000";
    const searchButtonActiveBgOpacity =
      typeof block.props.searchButtonActiveBgOpacity === "number" && Number.isFinite(block.props.searchButtonActiveBgOpacity)
        ? Math.max(0, Math.min(1, block.props.searchButtonActiveBgOpacity))
        : 1;
    const searchButtonActiveBorderStyle = (block.props.searchButtonActiveBorderStyle ?? "solid") as BlockBorderStyle;
    const searchButtonActiveBorderColor = normalizeNavBorderColor(
      block.props.searchButtonActiveBorderColor ?? "#111827",
      "#111827",
    );
    const locateButtonClass = `flex h-full w-full items-center justify-center rounded px-3 text-sm hover:brightness-[0.98] ${getBlockBorderClass(searchButtonBorderStyle)}`;
    const locateButtonStyle = {
      ...getBlockBorderInlineStyle(searchButtonBorderStyle, searchButtonBorderColor),
      ...getColorLayerStyle(searchButtonBgColor, searchButtonBgOpacity),
    };
    const actionButtonClass = `flex h-full w-full items-center justify-center whitespace-nowrap rounded px-4 text-sm text-white hover:brightness-[0.98] ${getBlockBorderClass(searchButtonActiveBorderStyle)}`;
    const actionButtonStyle = {
      ...getBlockBorderInlineStyle(searchButtonActiveBorderStyle, searchButtonActiveBorderColor),
      ...getColorLayerStyle(searchButtonActiveBgColor, searchButtonActiveBgOpacity),
    };
    const searchTypographyBaseStyle: Record<string, string | number> = {};
    if (block.props.fontFamily?.trim()) searchTypographyBaseStyle.fontFamily = block.props.fontFamily.trim();
    if (typeof block.props.fontSize === "number" && Number.isFinite(block.props.fontSize) && block.props.fontSize > 0) {
      searchTypographyBaseStyle.fontSize = block.props.fontSize;
    }
    if (block.props.fontWeight) searchTypographyBaseStyle.fontWeight = block.props.fontWeight;
    if (block.props.fontStyle) searchTypographyBaseStyle.fontStyle = block.props.fontStyle;
    if (block.props.textDecoration) searchTypographyBaseStyle.textDecoration = block.props.textDecoration;
    const searchFontColor = (block.props.fontColor ?? "").trim();
    const searchFontColorIsGradient = !!searchFontColor && isGradientToken(searchFontColor);
    const searchButtonLabelStyle: Record<string, string | number> = {
      ...searchTypographyBaseStyle,
      ...(searchFontColor
        ? searchFontColorIsGradient
          ? {
              backgroundImage: searchFontColor,
              backgroundClip: "text",
              WebkitBackgroundClip: "text",
              color: "transparent",
            }
          : { color: searchFontColor }
        : {}),
    };
    const searchInputTextStyle: Record<string, string | number> = {
      ...searchTypographyBaseStyle,
    };
    const resolvedSearchInputFontSize =
      typeof searchTypographyBaseStyle.fontSize === "number" && Number.isFinite(searchTypographyBaseStyle.fontSize)
        ? searchTypographyBaseStyle.fontSize
        : undefined;
    if (previewViewport === "mobile") {
      searchInputTextStyle.fontSize = Math.max(16, resolvedSearchInputFontSize ?? 16);
    }
    const searchLayout = block.props.searchLayout ?? {};
    const clampSearchLayoutValue = (value: unknown, fallback: number, min = 0) =>
      typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.round(value)) : fallback;
    const searchEntries = [
      {
        key: "locate" as SearchLayoutKey,
        label: "定位按钮",
        value: locateLabel,
        x: clampSearchLayoutValue(searchLayout.locate?.x, 0),
        y: clampSearchLayoutValue(searchLayout.locate?.y, 0),
        width: clampSearchLayoutValue(searchLayout.locate?.width, 72, 56),
        height: clampSearchLayoutValue(searchLayout.locate?.height, 40, 32),
        minWidth: 56,
        minHeight: 32,
      },
      {
        key: "country" as SearchLayoutKey,
        label: "国",
        value: resolvedCountryName,
        x: clampSearchLayoutValue(searchLayout.country?.x, 82),
        y: clampSearchLayoutValue(searchLayout.country?.y, 0),
        width: clampSearchLayoutValue(searchLayout.country?.width, 190, 130),
        height: clampSearchLayoutValue(searchLayout.country?.height, 40, 32),
        minWidth: 130,
        minHeight: 32,
      },
      {
        key: "province" as SearchLayoutKey,
        label: "省份",
        value: resolvedProvinceName,
        x: clampSearchLayoutValue(searchLayout.province?.x, 282),
        y: clampSearchLayoutValue(searchLayout.province?.y, 0),
        width: clampSearchLayoutValue(searchLayout.province?.width, 190, 130),
        height: clampSearchLayoutValue(searchLayout.province?.height, 40, 32),
        minWidth: 130,
        minHeight: 32,
      },
      {
        key: "city" as SearchLayoutKey,
        label: "城市",
        value: resolvedCity || cityPlaceholder,
        x: clampSearchLayoutValue(searchLayout.city?.x, 482),
        y: clampSearchLayoutValue(searchLayout.city?.y, 0),
        width: clampSearchLayoutValue(searchLayout.city?.width, 190, 130),
        height: clampSearchLayoutValue(searchLayout.city?.height, 40, 32),
        minWidth: 130,
        minHeight: 32,
      },
      {
        key: "keyword" as SearchLayoutKey,
        label: "搜索输入",
        value: searchPlaceholder,
        x: clampSearchLayoutValue(searchLayout.keyword?.x, 0),
        y: clampSearchLayoutValue(searchLayout.keyword?.y, 52),
        width: clampSearchLayoutValue(searchLayout.keyword?.width, 670, 180),
        height: clampSearchLayoutValue(searchLayout.keyword?.height, 40, 32),
        minWidth: 180,
        minHeight: 32,
      },
      {
        key: "action" as SearchLayoutKey,
        label: "搜索按钮",
        value: actionLabel,
        x: clampSearchLayoutValue(searchLayout.action?.x, 680),
        y: clampSearchLayoutValue(searchLayout.action?.y, 52),
        width: clampSearchLayoutValue(searchLayout.action?.width, 72, 64),
        height: clampSearchLayoutValue(searchLayout.action?.height, 40, 32),
        minWidth: 64,
        minHeight: 32,
      },
    ];
    const findSearchEntry = (key: SearchLayoutKey) => searchEntries.find((item) => item.key === key);
    const locateEntry = findSearchEntry("locate") ?? { x: 0, y: 0, width: 72, height: 40 };
    const countryEntry = findSearchEntry("country") ?? { x: 82, y: 0, width: 190, height: 40 };
    const provinceEntry = findSearchEntry("province") ?? { x: 282, y: 0, width: 190, height: 40 };
    const cityEntry = findSearchEntry("city") ?? { x: 482, y: 0, width: 190, height: 40 };
    const keywordEntry = findSearchEntry("keyword") ?? { x: 0, y: 52, width: 670, height: 40 };
    const actionEntry = findSearchEntry("action") ?? { x: 680, y: 52, width: 72, height: 40 };
    const searchCanvasHeight = Math.max(52, ...searchEntries.map((item) => item.y + item.height));
    const searchPreviewOffsetY = Math.min(...searchEntries.map((item) => item.y));
    const getSearchPreviewY = (value: number) => Math.max(0, value - searchPreviewOffsetY);
    const searchPreviewCanvasHeight = Math.max(52, ...searchEntries.map((item) => getSearchPreviewY(item.y) + item.height));
    const searchCanvasWidth = Math.max(260, ...searchEntries.map((item) => item.x + item.width));
    const snapStep = Math.max(2, Math.min(40, Math.round(searchLayoutSnapStep) || 8));
    const maybeSnap = (value: number, min = 0) => {
      const clamped = Math.max(min, Math.round(value));
      if (!searchLayoutSnapEnabled) return clamped;
      return Math.max(min, Math.round(clamped / snapStep) * snapStep);
    };
    const selectSearchLayoutEntry = (key: SearchLayoutKey, multi: boolean) => {
      if (multi) {
        setActiveSearchLayoutKeys((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
      } else {
        setActiveSearchLayoutKeys([key]);
      }
    };
    const startSearchLayoutDrag = (key: SearchLayoutKey, event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const source = findSearchEntry(key);
      if (!source) return;
      if (event.ctrlKey) {
        selectSearchLayoutEntry(key, true);
        return;
      }
      const selectedKeys =
        activeSearchLayoutKeys.includes(key) && activeSearchLayoutKeys.length > 0 ? activeSearchLayoutKeys : [key];
      setActiveSearchLayoutKeys(selectedKeys);
      searchLayoutCanvasFocusRef.current?.focus();
      const startX = event.clientX;
      const startY = event.clientY;
      const originMap = new Map(
        selectedKeys.map((selectedKey) => {
          const found = findSearchEntry(selectedKey);
          return [
            selectedKey,
            { x: found?.x ?? 0, y: found?.y ?? 0, width: found?.width ?? 160, height: found?.height ?? 40 },
          ] as const;
        }),
      );
      const onMove = (e: MouseEvent) => {
        const dx = Math.round(e.clientX - startX);
        const dy = Math.round(e.clientY - startY);
        const nextLayout = { ...searchLayout };
        selectedKeys.forEach((selectedKey) => {
          const origin = originMap.get(selectedKey);
          const found = findSearchEntry(selectedKey);
          if (!origin || !found) return;
          nextLayout[selectedKey] = {
            x: maybeSnap(origin.x + dx),
            y: maybeSnap(origin.y + dy),
            width: clampSearchLayoutValue((searchLayout[selectedKey] ?? {}).width, origin.width, found.minWidth),
            height: clampSearchLayoutValue((searchLayout[selectedKey] ?? {}).height, origin.height, found.minHeight),
          };
        });
        onChange({ searchLayout: nextLayout });
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
    const startSearchLayoutResize = (
      key: SearchLayoutKey,
      direction: "width" | "height",
      event: ReactMouseEvent<HTMLDivElement>,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      const source = findSearchEntry(key);
      if (!source) return;
      const selectedKeys =
        activeSearchLayoutKeys.includes(key) && activeSearchLayoutKeys.length > 0 ? activeSearchLayoutKeys : [key];
      setActiveSearchLayoutKeys(selectedKeys);
      searchLayoutCanvasFocusRef.current?.focus();
      const startX = event.clientX;
      const startY = event.clientY;
      const originWidths = new Map(
        selectedKeys.map((selectedKey) => {
          const found = findSearchEntry(selectedKey);
          return [selectedKey, found?.width ?? 160] as const;
        }),
      );
      const originHeights = new Map(
        selectedKeys.map((selectedKey) => {
          const found = findSearchEntry(selectedKey);
          return [selectedKey, found?.height ?? 40] as const;
        }),
      );
      const onMove = (e: MouseEvent) => {
        const deltaWidth = Math.round(e.clientX - startX);
        const deltaHeight = Math.round(e.clientY - startY);
        const nextLayout = { ...searchLayout };
        selectedKeys.forEach((selectedKey) => {
          const found = findSearchEntry(selectedKey);
          if (!found) return;
          const current = searchLayout[selectedKey] ?? {};
          const originWidth = originWidths.get(selectedKey) ?? found.width;
          const originHeight = originHeights.get(selectedKey) ?? found.height;
          nextLayout[selectedKey] = {
            x: clampSearchLayoutValue(current.x, found.x),
            y: clampSearchLayoutValue(current.y, found.y),
            width:
              direction === "width"
                ? maybeSnap(originWidth + deltaWidth, found.minWidth)
                : clampSearchLayoutValue(current.width, found.width, found.minWidth),
            height:
              direction === "height"
                ? maybeSnap(originHeight + deltaHeight, found.minHeight)
                : clampSearchLayoutValue(current.height, found.height, found.minHeight),
          };
        });
        onChange({ searchLayout: nextLayout });
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
    const handleSearchLayoutCanvasKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (activeSearchLayoutKeys.length === 0) return;
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const step = event.shiftKey ? (searchLayoutSnapEnabled ? Math.max(snapStep * 2, 10) : 10) : searchLayoutSnapEnabled ? snapStep : 2;
      const deltaX = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const deltaY = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      const nextLayout = { ...searchLayout };
      activeSearchLayoutKeys.forEach((selectedKey) => {
        const source = findSearchEntry(selectedKey);
        if (!source) return;
        const current = searchLayout[selectedKey] ?? {};
        nextLayout[selectedKey] = {
          x: maybeSnap(clampSearchLayoutValue(current.x, source.x) + deltaX),
          y: maybeSnap(clampSearchLayoutValue(current.y, source.y) + deltaY),
          width: clampSearchLayoutValue(current.width, source.width, source.minWidth),
          height: clampSearchLayoutValue(current.height, source.height, source.minHeight),
        };
      });
      onChange({ searchLayout: nextLayout });
    };
    const alignSelectedSearchLayoutEntries = (
      mode: "left" | "right" | "same-width" | "same-height" | "distribute-x" | "distribute-y",
    ) => {
      const selected = searchEntries.filter((item) => activeSearchLayoutKeys.includes(item.key));
      if (selected.length === 0) return;
      const nextLayout = { ...searchLayout };
      if (mode === "left") {
        const selectedMinLeft = Math.min(...selected.map((item) => item.x));
        const deltaX = Math.max(0, selectedMinLeft);
        selected.forEach((item) => {
          const current = searchLayout[item.key] ?? {};
          nextLayout[item.key] = {
            x: maybeSnap(Math.max(0, clampSearchLayoutValue(current.x, item.x) - deltaX)),
            y: clampSearchLayoutValue(current.y, item.y),
            width: clampSearchLayoutValue(current.width, item.width, item.minWidth),
            height: clampSearchLayoutValue(current.height, item.height, item.minHeight),
          };
        });
      }
      if (mode === "right") {
        const selectedMaxRight = Math.max(...selected.map((item) => item.x + item.width));
        const deltaX = Math.max(0, searchCanvasWidth - selectedMaxRight);
        selected.forEach((item) => {
          const current = searchLayout[item.key] ?? {};
          nextLayout[item.key] = {
            x: maybeSnap(clampSearchLayoutValue(current.x, item.x) + deltaX),
            y: clampSearchLayoutValue(current.y, item.y),
            width: clampSearchLayoutValue(current.width, item.width, item.minWidth),
            height: clampSearchLayoutValue(current.height, item.height, item.minHeight),
          };
        });
      }
      if (mode === "same-width") {
        const width = Math.max(...selected.map((item) => item.width));
        selected.forEach((item) => {
          const current = searchLayout[item.key] ?? {};
          nextLayout[item.key] = {
            x: clampSearchLayoutValue(current.x, item.x),
            y: clampSearchLayoutValue(current.y, item.y),
            width: Math.max(item.minWidth, width),
            height: clampSearchLayoutValue(current.height, item.height, item.minHeight),
          };
        });
      }
      if (mode === "same-height") {
        const height = Math.max(...selected.map((item) => item.height));
        selected.forEach((item) => {
          const current = searchLayout[item.key] ?? {};
          nextLayout[item.key] = {
            x: clampSearchLayoutValue(current.x, item.x),
            y: clampSearchLayoutValue(current.y, item.y),
            width: clampSearchLayoutValue(current.width, item.width, item.minWidth),
            height: Math.max(item.minHeight, height),
          };
        });
      }
      if (mode === "distribute-x") {
        if (selected.length < 2) return;
        const sorted = [...selected].sort((a, b) => a.x - b.x);
        const totalWidth = sorted.reduce((sum, item) => sum + item.width, 0);
        const gap = sorted.length > 1 ? Math.max(0, (searchCanvasWidth - totalWidth) / (sorted.length - 1)) : 0;
        const baselineY = Math.min(...sorted.map((item) => item.y));
        let cursorX = 0;
        sorted.forEach((item) => {
          const current = searchLayout[item.key] ?? {};
          nextLayout[item.key] = {
            x: Math.max(0, Math.round(cursorX)),
            y: Math.max(0, Math.round(baselineY)),
            width: clampSearchLayoutValue(current.width, item.width, item.minWidth),
            height: clampSearchLayoutValue(current.height, item.height, item.minHeight),
          };
          cursorX += item.width + gap;
        });
      }
      if (mode === "distribute-y") {
        if (selected.length < 2) return;
        const sorted = [...selected].sort((a, b) => a.y - b.y);
        const totalHeight = sorted.reduce((sum, item) => sum + item.height, 0);
        const gap = sorted.length > 1 ? Math.max(0, (searchCanvasHeight - totalHeight) / (sorted.length - 1)) : 0;
        const baselineX = Math.min(...sorted.map((item) => item.x));
        let cursorY = 0;
        sorted.forEach((item) => {
          const current = searchLayout[item.key] ?? {};
          nextLayout[item.key] = {
            x: Math.max(0, Math.round(baselineX)),
            y: Math.max(0, Math.round(cursorY)),
            width: clampSearchLayoutValue(current.width, item.width, item.minWidth),
            height: clampSearchLayoutValue(current.height, item.height, item.minHeight),
          };
          cursorY += item.height + gap;
        });
      }
      onChange({ searchLayout: nextLayout });
    };
    const applySearchLayoutTemplate = (mode: "single-tight" | "single-wide" | "double-column") => {
      if (searchEntries.length === 0) return;
      const safeCanvasWidth = Math.max(
        260,
        Math.min(
          1200,
          typeof block.props.blockWidth === "number" && Number.isFinite(block.props.blockWidth)
            ? Math.round(block.props.blockWidth) - 64
            : searchCanvasWidth,
        ),
      );
      const nextLayout = { ...searchLayout };
      if (mode === "single-tight") {
        const width = Math.max(220, Math.min(safeCanvasWidth, 360));
        searchEntries.forEach((item, idx) => {
          nextLayout[item.key] = {
            x: 0,
            y: maybeSnap(idx * 48),
            width: Math.max(item.minWidth, width),
            height: Math.max(item.minHeight, 40),
          };
        });
      }
      if (mode === "single-wide") {
        const width = Math.max(240, safeCanvasWidth);
        searchEntries.forEach((item, idx) => {
          nextLayout[item.key] = {
            x: 0,
            y: maybeSnap(idx * 56),
            width: Math.max(item.minWidth, width),
            height: Math.max(item.minHeight, 40),
          };
        });
      }
      if (mode === "double-column") {
        const gap = 14;
        const width = Math.max(160, Math.floor((safeCanvasWidth - gap) / 2));
        searchEntries.forEach((item, idx) => {
          const col = idx % 2;
          const row = Math.floor(idx / 2);
          nextLayout[item.key] = {
            x: maybeSnap(col * (width + gap)),
            y: maybeSnap(row * 56),
            width: Math.max(item.minWidth, width),
            height: Math.max(item.minHeight, 40),
          };
        });
      }
      setActiveSearchLayoutKeys(searchEntries.map((item) => item.key));
      onChange({ searchLayout: nextLayout });
    };

    return (
      <section
        data-block-id={block.id}
        data-jump-target={publicBlockId}
        data-block-public-id={publicBlockId}
        className={`${shellClass} pointer-events-none`}
        style={offsetStyle}
      >
        <EditorBlockHeader
          blockId={publicBlockId}
          draggingBlockId={draggingBlockId}
          isSelected={isSelected}
          onDragHandleMouseDown={onDragHandleMouseDown}
          onNudge={onNudge}
          onOpenLayerSettings={openLayerSettings}
          onEditTypography={editTypography}
          onInsertText={insertTextBox}
          onInsertImage={insertImage}
          onEditImageSettings={editImageSettings}
          onEditBorderStyle={editBorderSettings}
          isMobileViewport={previewViewport === "mobile"}
          mobileFitScreenWidth={block.props.mobileFitScreenWidth === true}
          onToggleMobileFitScreenWidth={handleToggleMobileFitScreenWidth}
          blockOpenByButton={blockOpenByButton}
          onToggleBlockOpenMode={toggleBlockOpenMode}
          onDelete={onDelete}
        />
        <div
          ref={resizeTargetRef}
          data-block-visual-boundary
          className={`${cardClass} relative`}
          onClick={onSelect}
          style={blockPreviewShellStyle}
        >
          {imageDialog}
          {imageSettingsDialog}
          {borderSettingsDialog}
          {searchButtonStyleDialog}
          {layerSettingsDialog}
          {typographyDialog}
          {isSelected ? renderSelectedEditor(
            <>
              <div className="space-y-1 mt-3">
                <RichTextEditor
                  field="heading"
                  className="border p-2 rounded w-full text-xl font-bold"
                  value={block.props.heading ?? ""}
                  onChange={handleRichFieldChange}
                  onActivate={registerActiveEditor}
                  onSelectionChange={updateSelectionRange}
                />
              </div>
              <div className="space-y-1 mt-3">
                <RichTextEditor
                  field="text"
                  className="border p-2 rounded w-full min-h-[86px] text-gray-700"
                  value={block.props.text ?? ""}
                  onChange={handleRichFieldChange}
                  onActivate={registerActiveEditor}
                  onSelectionChange={updateSelectionRange}
                />
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-3">
                <label className="space-y-1 text-sm text-gray-600">
                  <span>默认国家</span>
                  <select
                    className="w-full rounded border p-2"
                    value={resolvedCountryCode}
                    disabled={!locationOptionsApi}
                    onChange={(event) => {
                      const nextCountryCode = event.target.value;
                      const nextProvinceCode = locationOptionsApi?.getEuropeProvinceOptions(nextCountryCode)[0]?.code ?? "";
                      const nextCity = locationOptionsApi?.getEuropeCityOptions(nextCountryCode, nextProvinceCode)[0] ?? "";
                      onChange({
                        defaultCountryCode: nextCountryCode,
                        defaultProvinceCode: nextProvinceCode,
                        defaultCity: nextCity,
                      });
                    }}
                  >
                    {countryOptions.length > 0 ? (
                      countryOptions.map((item) => (
                        <option key={item.code} value={item.code}>
                          {item.name}
                        </option>
                      ))
                    ) : (
                      <option value="">{countryLabel}</option>
                    )}
                  </select>
                </label>
                <label className="space-y-1 text-sm text-gray-600">
                  <span>默认省份</span>
                  <select
                    className="w-full rounded border p-2"
                    value={resolvedProvinceCode}
                    disabled={!locationOptionsApi}
                    onChange={(event) => {
                      const nextProvinceCode = event.target.value;
                      const nextCity = locationOptionsApi?.getEuropeCityOptions(resolvedCountryCode, nextProvinceCode)[0] ?? "";
                      onChange({
                        defaultCountryCode: resolvedCountryCode,
                        defaultProvinceCode: nextProvinceCode,
                        defaultCity: nextCity,
                      });
                    }}
                  >
                    {provinceOptions.length > 0 ? (
                      provinceOptions.map((item) => (
                        <option key={item.code} value={item.code}>
                          {item.name}
                        </option>
                      ))
                    ) : (
                      <option value="">{provinceLabel}</option>
                    )}
                  </select>
                </label>
                <label className="space-y-1 text-sm text-gray-600">
                  <span>默认城市</span>
                  <select
                    className="w-full rounded border p-2"
                    value={resolvedCity}
                    disabled={!locationOptionsApi}
                    onChange={(event) => onChange({ defaultCity: event.target.value })}
                  >
                    {cityOptions.length > 0 ? (
                      cityOptions.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))
                    ) : (
                      <option value="">{cityPlaceholder}</option>
                    )}
                  </select>
                </label>
                <label className="space-y-1 text-sm text-gray-600">
                  <span>城市占位文案</span>
                  <BufferedEditorInput
                    className="w-full rounded border p-2"
                    value={block.props.cityPlaceholder ?? ""}
                    onChange={(e) => onChange({ cityPlaceholder: e.target.value })}
                  />
                </label>
                <label className="space-y-1 text-sm text-gray-600">
                  <span>搜索框占位文案</span>
                  <BufferedEditorInput
                    className="w-full rounded border p-2"
                    value={block.props.searchPlaceholder ?? ""}
                    onChange={(e) => onChange({ searchPlaceholder: e.target.value })}
                  />
                </label>
                <label className="space-y-1 text-sm text-gray-600">
                  <span>定位按钮文案</span>
                  <BufferedEditorInput
                    className="w-full rounded border p-2"
                    value={block.props.locateLabel ?? ""}
                    onChange={(e) => onChange({ locateLabel: e.target.value })}
                  />
                </label>
                <label className="space-y-1 text-sm text-gray-600">
                  <span>搜索按钮文案</span>
                  <BufferedEditorInput
                    className="w-full rounded border p-2"
                    value={block.props.actionLabel ?? ""}
                    onChange={(e) => onChange({ actionLabel: e.target.value })}
                  />
                </label>
                <div className="md:col-span-3">
                  <button
                    type="button"
                    className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
                    onClick={editSearchButtonStyle}
                  >
                    按钮样式
                  </button>
                </div>
              </div>
              <div className="mt-3">
                <div className="text-xs text-gray-500 mb-2">拖动可改位置，拉伸右边缘改宽度，拉伸下边缘改高度</div>
                <div className="mb-2 flex flex-wrap gap-2">
                  <label className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border bg-white">
                    <BufferedEditorInput
                      type="checkbox"
                      checked={searchLayoutSnapEnabled}
                      onChange={(e) => setSearchLayoutSnapEnabled(e.target.checked)}
                    />
                    {"吸附网格"}
                  </label>
                  <select
                    className="px-2 py-1 text-xs rounded border bg-white"
                    value={searchLayoutSnapStep}
                    onChange={(e) => setSearchLayoutSnapStep(Math.max(2, Math.min(40, Number(e.target.value) || 8)))}
                  >
                    {[4, 6, 8, 10, 12, 16, 20].map((step) => (
                      <option key={step} value={step}>
                        {`网格 ${step}px`}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                    onClick={() => applySearchLayoutTemplate("single-tight")}
                  >
                    {"紧凑单列"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                    onClick={() => applySearchLayoutTemplate("single-wide")}
                  >
                    {"宽松单列"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                    onClick={() => applySearchLayoutTemplate("double-column")}
                  >
                    {"双列"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                    onClick={() => alignSelectedSearchLayoutEntries("left")}
                  >
                    {"左"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                    onClick={() => alignSelectedSearchLayoutEntries("right")}
                  >
                    {"右"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                    onClick={() => alignSelectedSearchLayoutEntries("same-width")}
                  >
                    {"统一宽度"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                    onClick={() => alignSelectedSearchLayoutEntries("same-height")}
                  >
                    {"统一高度"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                    onClick={() => alignSelectedSearchLayoutEntries("distribute-x")}
                  >
                    {"横向均分"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                    onClick={() => alignSelectedSearchLayoutEntries("distribute-y")}
                  >
                    {"纵向均分"}
                  </button>
                </div>
                <div
                  ref={searchLayoutCanvasFocusRef}
                  className="relative rounded border border-dashed border-gray-300 bg-transparent"
                  style={{
                    minHeight: `${searchPreviewCanvasHeight}px`,
                    width: `${searchCanvasWidth}px`,
                    maxWidth: "100%",
                    backgroundImage: searchLayoutSnapEnabled
                      ? "linear-gradient(to right, rgba(17,24,39,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(17,24,39,0.08) 1px, transparent 1px)"
                      : undefined,
                    backgroundSize: searchLayoutSnapEnabled
                      ? `${Math.max(2, Math.min(40, searchLayoutSnapStep))}px ${Math.max(2, Math.min(40, searchLayoutSnapStep))}px`
                      : undefined,
                  }}
                  tabIndex={0}
                  onKeyDown={handleSearchLayoutCanvasKeyDown}
                >
                  {searchEntries.map((item) => (
                    <div
                      key={item.key}
                      className={`absolute rounded border bg-white px-2 py-1 shadow-sm cursor-move overflow-hidden ${
                        activeSearchLayoutKeys.includes(item.key)
                          ? "border-blue-500 bg-blue-50/70 ring-4 ring-blue-400/45 shadow-md"
                          : "border-gray-300"
                      }`}
                      style={{
                        left: `${item.x}px`,
                        top: `${getSearchPreviewY(item.y)}px`,
                        width: `${item.width}px`,
                        height: `${item.height}px`,
                      }}
                      onMouseDown={(event) => startSearchLayoutDrag(item.key, event)}
                    >
                      <div className="text-[11px] text-gray-500 truncate">{item.label}</div>
                      <div className="text-xs text-gray-800 truncate">{item.value}</div>
                      <div
                        className="absolute top-0 right-0 h-full w-2 cursor-ew-resize"
                        onMouseDown={(event) => startSearchLayoutResize(item.key, "width", event)}
                      />
                      <div
                        className="absolute bottom-0 left-0 h-2 w-full cursor-ns-resize"
                        onMouseDown={(event) => startSearchLayoutResize(item.key, "height", event)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </>,
          ) : (
            <>
              {hasSearchHeading ? (
                <h2
                  className="text-xl font-bold whitespace-pre-wrap break-words"
                  dangerouslySetInnerHTML={{ __html: toRichHtml(block.props.heading, localizedSearchHeading) }}
                />
              ) : null}
              {hasSearchText ? (
                <div
                  className="mt-2 text-gray-600 whitespace-pre-wrap break-words"
                  dangerouslySetInnerHTML={{ __html: toRichHtml(block.props.text, localizedSearchText) }}
                />
              ) : null}
              <form onSubmit={(event) => event.preventDefault()} className={`${hasSearchHeading || hasSearchText ? "mt-4 " : ""}space-y-3`}>
                <div
                  className="relative"
                  style={{ minHeight: `${searchPreviewCanvasHeight}px`, width: `${searchCanvasWidth}px`, maxWidth: "100%" }}
                >
                  <div
                    className="absolute"
                    style={{
                      left: `${locateEntry.x}px`,
                      top: `${getSearchPreviewY(locateEntry.y)}px`,
                      width: `${locateEntry.width}px`,
                      height: `${locateEntry.height}px`,
                    }}
                  >
                    <button
                      type="button"
                      className={locateButtonClass}
                      style={locateButtonStyle}
                    >
                      <span style={searchButtonLabelStyle}>{locateLabel}</span>
                    </button>
                  </div>
                  <div
                    className="absolute"
                    style={{
                      left: `${countryEntry.x}px`,
                      top: `${getSearchPreviewY(countryEntry.y)}px`,
                      width: `${countryEntry.width}px`,
                      height: `${countryEntry.height}px`,
                    }}
                  >
                    <BufferedEditorInput
                      readOnly
                      className="h-full w-full rounded border bg-white px-2 text-sm text-slate-600 outline-none placeholder:text-current"
                      style={searchInputTextStyle}
                      value={resolvedCountryName}
                      aria-label={countryLabel}
                    />
                  </div>
                  <div
                    className="absolute"
                    style={{
                      left: `${provinceEntry.x}px`,
                      top: `${getSearchPreviewY(provinceEntry.y)}px`,
                      width: `${provinceEntry.width}px`,
                      height: `${provinceEntry.height}px`,
                    }}
                  >
                    <BufferedEditorInput
                      readOnly
                      className="h-full w-full rounded border bg-white px-2 text-sm text-slate-600 outline-none placeholder:text-current"
                      style={searchInputTextStyle}
                      value={resolvedProvinceName}
                      aria-label={provinceLabel}
                    />
                  </div>
                  <div
                    className="absolute"
                    style={{
                      left: `${cityEntry.x}px`,
                      top: `${getSearchPreviewY(cityEntry.y)}px`,
                      width: `${cityEntry.width}px`,
                      height: `${cityEntry.height}px`,
                    }}
                  >
                    <BufferedEditorInput
                      readOnly
                      className="h-full w-full rounded border bg-white px-2 text-sm text-slate-600 outline-none placeholder:text-current"
                      style={searchInputTextStyle}
                      value={resolvedCity || cityPlaceholder}
                      aria-label="城市"
                    />
                  </div>
                  <div
                    className="absolute"
                    style={{
                      left: `${keywordEntry.x}px`,
                      top: `${getSearchPreviewY(keywordEntry.y)}px`,
                      width: `${keywordEntry.width}px`,
                      height: `${keywordEntry.height}px`,
                    }}
                  >
                    <BufferedEditorInput
                      readOnly
                      className="h-full w-full rounded border bg-white px-3 text-sm text-slate-500 outline-none placeholder:text-current"
                      style={searchInputTextStyle}
                      placeholder={searchPlaceholder}
                    />
                  </div>
                  <div
                    className="absolute"
                    style={{
                      left: `${actionEntry.x}px`,
                      top: `${getSearchPreviewY(actionEntry.y)}px`,
                      width: `${actionEntry.width}px`,
                      height: `${actionEntry.height}px`,
                    }}
                  >
                    <button
                      type="button"
                      className={actionButtonClass}
                      style={actionButtonStyle}
                    >
                      <span style={searchButtonLabelStyle}>{actionLabel}</span>
                    </button>
                  </div>
                </div>
              </form>
              <div className="mt-2 text-xs text-slate-500">{searchHintLabel}</div>
            </>
          )}
          {resizeHandles}
        </div>
      </section>
    );
  }

  if (block.type === "poll") {
    const pollPreview = (
      <PollBlock
        {...block.props}
        runtimeSiteId={runtimeSiteId}
        runtimeBlockId={block.id}
        interactive={false}
      />
    );

    return (
      <section
        data-block-id={block.id}
        data-jump-target={publicBlockId}
        data-block-public-id={publicBlockId}
        className={`${shellClass} pointer-events-none`}
        style={offsetStyle}
      >
        <EditorBlockHeader
          blockId={publicBlockId}
          draggingBlockId={draggingBlockId}
          isSelected={isSelected}
          onDragHandleMouseDown={onDragHandleMouseDown}
          onNudge={onNudge}
          onOpenLayerSettings={openLayerSettings}
          onEditTypography={editTypography}
          onInsertText={insertTextBox}
          onInsertImage={insertImage}
          onEditImageSettings={editImageSettings}
          onEditBorderStyle={editBorderSettings}
          isMobileViewport={previewViewport === "mobile"}
          mobileFitScreenWidth={block.props.mobileFitScreenWidth === true}
          onToggleMobileFitScreenWidth={handleToggleMobileFitScreenWidth}
          blockOpenByButton={blockOpenByButton}
          onToggleBlockOpenMode={toggleBlockOpenMode}
          onDelete={onDelete}
        />
        <div
          ref={resizeTargetRef}
          data-block-visual-boundary
          className={`${cardClass} relative`}
          onClick={onSelect}
          style={blockPreviewShellStyle}
        >
          {imageDialog}
          {imageSettingsDialog}
          {borderSettingsDialog}
          {layerSettingsDialog}
          {typographyDialog}
          {isSelected ? renderSelectedEditor(
            <div className="grid gap-4">
              <div className="grid gap-3 border-b border-slate-200 pb-4">
                <RichTextEditor
                  field="heading"
                  className="w-full rounded-lg border p-2 text-xl font-bold"
                  value={block.props.heading ?? ""}
                  onChange={handleRichFieldChange}
                  onActivate={registerActiveEditor}
                  onSelectionChange={updateSelectionRange}
                />
                <RichTextEditor
                  field="text"
                  className="min-h-[84px] w-full rounded-lg border p-2 text-gray-700"
                  value={block.props.text ?? ""}
                  onChange={handleRichFieldChange}
                  onActivate={registerActiveEditor}
                  onSelectionChange={updateSelectionRange}
                />
              </div>
              <PollBlockEditor
                props={block.props}
                runtimeSiteId={runtimeSiteId}
                runtimeBlockId={block.id}
                onChange={(patch) => onChange(patch)}
              />
              <div className="grid gap-3 border-t border-slate-200 pt-4">
                <div className="text-sm font-medium text-slate-700">前台预览</div>
                {pollPreview}
              </div>
            </div>,
          ) : (
            pollPreview
          )}
          {resizeHandles}
        </div>
      </section>
    );
  }

  if (block.type === "booking") {
    const bookingPreview = (
      <BookingBlock
        {...block.props}
        runtimeSiteId={runtimeSiteId}
        runtimeSiteName={runtimeSiteName}
        interactive={false}
      />
    );

    return (
      <section
        data-block-id={block.id}
        data-jump-target={publicBlockId}
        data-block-public-id={publicBlockId}
        className={`${shellClass} pointer-events-none`}
        style={offsetStyle}
      >
        <EditorBlockHeader
          blockId={publicBlockId}
          draggingBlockId={draggingBlockId}
          isSelected={isSelected}
          onDragHandleMouseDown={onDragHandleMouseDown}
          onNudge={onNudge}
          onOpenLayerSettings={openLayerSettings}
          onEditTypography={editTypography}
          onInsertText={insertTextBox}
          onInsertImage={insertImage}
          onEditImageSettings={editImageSettings}
          onEditBorderStyle={editBorderSettings}
          isMobileViewport={previewViewport === "mobile"}
          mobileFitScreenWidth={block.props.mobileFitScreenWidth === true}
          onToggleMobileFitScreenWidth={handleToggleMobileFitScreenWidth}
          blockOpenByButton={blockOpenByButton}
          onToggleBlockOpenMode={toggleBlockOpenMode}
          onDelete={onDelete}
        />
        <div
          ref={resizeTargetRef}
          data-block-visual-boundary
          className={`${cardClass} relative`}
          onClick={onSelect}
          style={blockPreviewShellStyle}
        >
          {imageDialog}
          {imageSettingsDialog}
          {borderSettingsDialog}
          {layerSettingsDialog}
          {typographyDialog}
          {isSelected ? renderSelectedEditor(
            <div className="space-y-4">
              <div className="space-y-1 mt-3">
                <RichTextEditor
                  field="heading"
                  className="border p-2 rounded w-full text-xl font-bold"
                  value={block.props.heading ?? ""}
                  onChange={handleRichFieldChange}
                  onActivate={registerActiveEditor}
                  onSelectionChange={updateSelectionRange}
                />
              </div>
              <div className="space-y-1">
                <RichTextEditor
                  field="text"
                  className="border p-2 rounded w-full min-h-[96px] text-gray-700"
                  value={block.props.text ?? ""}
                  onChange={handleRichFieldChange}
                  onActivate={registerActiveEditor}
                  onSelectionChange={updateSelectionRange}
                />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <label className="space-y-1 text-sm text-gray-700">
                  <span className="block text-gray-600">A名称</span>
                  <CompositionSafeTextInput
                    className="w-full rounded border px-3 py-2"
                    value={block.props.bookingStoreLabel ?? ""}
                    placeholder="预约店铺"
                    onChange={(nextValue) => onChange({ bookingStoreLabel: nextValue })}
                  />
                </label>
                <label className="space-y-1 text-sm text-gray-700">
                  <span className="block text-gray-600">B名称</span>
                  <CompositionSafeTextInput
                    className="w-full rounded border px-3 py-2"
                    value={block.props.bookingItemLabel ?? ""}
                    placeholder="项目或类型"
                    onChange={(nextValue) => onChange({ bookingItemLabel: nextValue })}
                  />
                </label>
                <label className="space-y-1 text-sm text-gray-700">
                  <span className="block text-gray-600">A选项</span>
                  <BookingOptionsTextarea
                    className="min-h-[120px] w-full rounded border px-3 py-2"
                    value={block.props.bookingStoreOptions}
                    placeholder={"每行一个选项，例如：\n主店\n分店 A"}
                    onChange={(nextOptions) => onChange({ bookingStoreOptions: nextOptions })}
                  />
                </label>
                <label className="space-y-1 text-sm text-gray-700">
                  <span className="block text-gray-600">B选项</span>
                  <BookingOptionsTextarea
                    className="min-h-[120px] w-full rounded border px-3 py-2"
                    value={block.props.bookingItemOptions}
                    placeholder={"每行一个选项，例如：\n咨询预约\n到店服务"}
                    onChange={(nextOptions) => onChange({ bookingItemOptions: nextOptions })}
                  />
                </label>
                <label className="space-y-1 text-sm text-gray-700">
                  <span className="block text-gray-600">称谓选项</span>
                  <BookingOptionsTextarea
                    className="min-h-[96px] w-full rounded border px-3 py-2"
                    value={block.props.bookingTitleOptions}
                    placeholder={"每行一个称谓，例如：\n先生\n女士"}
                    onChange={(nextOptions) => onChange({ bookingTitleOptions: nextOptions })}
                  />
                </label>
                <div className="space-y-1 text-sm text-gray-700 lg:col-span-2">
                  <BookingTimeSlotRulesEditor
                    value={block.props.bookingTimeSlotRules}
                    legacyRanges={block.props.bookingAvailableTimeRanges}
                    onChange={(nextRules) =>
                      onChange({
                        bookingTimeSlotRules: nextRules,
                        bookingAvailableTimeRanges: nextRules.map((item) => item.timeRange),
                      })
                    }
                  />
                </div>
                <div className="grid gap-4 lg:col-span-2 xl:grid-cols-2">
                  <BookingDateCalendarEditor
                    label="黑名单日期"
                    helperText="点击日历日期即可加入或移出黑名单，这些日期前台将不可预约。"
                    value={block.props.bookingBlockedDates}
                    tone="blocked"
                    onChange={(nextDates) => onChange({ bookingBlockedDates: nextDates })}
                  />
                  <BookingDateCalendarEditor
                    label="节假日"
                    helperText="节假日也会作为不可预约日期处理，并提供全年周六和周日的一键勾选。"
                    value={block.props.bookingHolidayDates}
                    tone="holiday"
                    allowYearWeekendShortcut
                    onChange={(nextDates) => onChange({ bookingHolidayDates: nextDates })}
                  />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1 text-sm text-gray-700">
                    <span className="block text-gray-600">提交按钮文案</span>
                    <BufferedEditorInput
                      className="w-full rounded border px-3 py-2"
                      value={block.props.bookingSubmitLabel ?? ""}
                      onChange={(event) => onChange({ bookingSubmitLabel: event.target.value })}
                    />
                  </label>
                  <label className="space-y-1 text-sm text-gray-700">
                    <span className="block text-gray-600">修改按钮文案</span>
                    <BufferedEditorInput
                      className="w-full rounded border px-3 py-2"
                      value={block.props.bookingUpdateLabel ?? ""}
                      onChange={(event) => onChange({ bookingUpdateLabel: event.target.value })}
                    />
                  </label>
                  <label className="space-y-1 text-sm text-gray-700">
                    <span className="block text-gray-600">取消按钮文案</span>
                    <BufferedEditorInput
                      className="w-full rounded border px-3 py-2"
                      value={block.props.bookingCancelLabel ?? ""}
                      onChange={(event) => onChange({ bookingCancelLabel: event.target.value })}
                    />
                  </label>
                  <label className="space-y-1 text-sm text-gray-700">
                    <span className="block text-gray-600">姓名占位提示</span>
                    <BufferedEditorInput
                      className="w-full rounded border px-3 py-2"
                      value={block.props.bookingNamePlaceholder ?? ""}
                      onChange={(event) => onChange({ bookingNamePlaceholder: event.target.value })}
                    />
                  </label>
                </div>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <label className="space-y-1 text-sm text-gray-700">
                  <span className="block text-gray-600">提交成功标题</span>
                  <BufferedEditorInput
                    className="w-full rounded border px-3 py-2"
                    value={block.props.bookingSuccessTitle ?? ""}
                    onChange={(event) => onChange({ bookingSuccessTitle: event.target.value })}
                  />
                </label>
                <label className="space-y-1 text-sm text-gray-700">
                  <span className="block text-gray-600">备注占位提示</span>
                  <BufferedEditorInput
                    className="w-full rounded border px-3 py-2"
                    value={block.props.bookingNotePlaceholder ?? ""}
                    onChange={(event) => onChange({ bookingNotePlaceholder: event.target.value })}
                  />
                </label>
                <label className="space-y-1 text-sm text-gray-700 lg:col-span-2">
                  <span className="block text-gray-600">提交成功说明</span>
                  <BufferedEditorTextarea
                    className="min-h-[100px] w-full rounded border px-3 py-2"
                    value={block.props.bookingSuccessText ?? ""}
                    onChange={(event) => onChange({ bookingSuccessText: event.target.value })}
                  />
                </label>
              </div>
              <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-sm font-medium text-slate-700">预约预览</div>
                {bookingPreview}
              </div>
            </div>,
          ) : (
            bookingPreview
          )}
          {resizeHandles}
        </div>
      </section>
    );
  }

  if (block.type === "contact") {
    type ContactEntryKey =
      | "phone"
      | "address"
      | "map"
      | "email"
      | "whatsapp"
      | "wechat"
      | "twitter"
      | "weibo"
      | "telegram"
      | "linkedin"
      | "discord"
      | "tiktok"
      | "xiaohongshu"
      | "facebook"
      | "instagram";
    const contactLayout = block.props.contactLayout ?? {};
    const contactPhoneEditorValues = (() => {
      const fromArray = Array.isArray(block.props.phones)
        ? block.props.phones.map((item) => toPlainText(String(item ?? ""), ""))
        : [];
      if (fromArray.length > 0) return fromArray;
      const fallback = toPlainText(block.props.phone, "").trim();
      return fallback ? [fallback] : [""];
    })();
    const contactPhones = contactPhoneEditorValues.map((item) => item.trim()).filter(Boolean);
    const contactAddressEditorValues = (() => {
      const fromArray = Array.isArray(block.props.addresses)
        ? block.props.addresses.map((item) => toPlainText(String(item ?? ""), ""))
        : [];
      if (fromArray.length > 0) return fromArray;
      const fallback = toPlainText(block.props.address, "").trim();
      return [fallback];
    })();
    const contactAddresses = contactAddressEditorValues.map((item) => item.trim()).filter(Boolean);
    const contactAddressEntryMinHeight = Math.max(42, contactAddresses.length * 44 || 42);
    const contactEntries = [
      {
        key: "address",
        label: "地址",
        value: contactAddresses.join("\n"),
        platformLabel: "Address",
        minHeight: contactAddressEntryMinHeight,
      },
      { key: "phone", label: "电话", value: contactPhones.join(" / "), platformLabel: "Phone" },
      { key: "email", label: "Email", value: (block.props.email ?? "").trim(), platformLabel: "Email" },
      { key: "whatsapp", label: "WhatsApp", value: (block.props.whatsapp ?? "").trim(), platformLabel: "WhatsApp" },
      { key: "wechat", label: "WeChat", value: (block.props.wechat ?? "").trim(), platformLabel: "WeChat" },
      { key: "twitter", label: "Twitter", value: (block.props.twitter ?? "").trim(), platformLabel: "Twitter" },
      { key: "weibo", label: "微博", value: (block.props.weibo ?? "").trim(), platformLabel: "微博" },
      { key: "telegram", label: "Telegram", value: (block.props.telegram ?? "").trim(), platformLabel: "Telegram" },
      { key: "linkedin", label: "LinkedIn", value: (block.props.linkedin ?? "").trim(), platformLabel: "LinkedIn" },
      { key: "discord", label: "Discord", value: (block.props.discord ?? "").trim(), platformLabel: "Discord" },
      { key: "tiktok", label: "TikTok", value: (block.props.tiktok ?? "").trim(), platformLabel: "TikTok" },
      { key: "xiaohongshu", label: "小红书", value: (block.props.xiaohongshu ?? "").trim(), platformLabel: "小红书" },
      { key: "facebook", label: "Facebook", value: (block.props.facebook ?? "").trim(), platformLabel: "Facebook" },
      { key: "instagram", label: "Instagram", value: (block.props.instagram ?? "").trim(), platformLabel: "Instagram" },
    ]
      .filter((item) => item.value)
      .map((item, index) => {
        const pos = contactLayout[item.key as keyof typeof contactLayout];
        const minHeight = typeof item.minHeight === "number" && Number.isFinite(item.minHeight) ? Math.max(32, Math.round(item.minHeight)) : 32;
        const x = typeof pos?.x === "number" && Number.isFinite(pos.x) ? Math.max(0, Math.round(pos.x)) : 0;
        const y = typeof pos?.y === "number" && Number.isFinite(pos.y) ? Math.max(0, Math.round(pos.y)) : index * 48;
        const width = typeof pos?.width === "number" && Number.isFinite(pos.width) ? Math.max(200, Math.round(pos.width)) : 360;
        const defaultHeight = Math.max(minHeight, 42);
        const height = typeof pos?.height === "number" && Number.isFinite(pos.height) ? Math.max(minHeight, Math.round(pos.height)) : defaultHeight;
        return { ...item, x, y, width, height, minHeight };
      });
    const contactCanvasHeight = Math.max(180, ...contactEntries.map((item) => item.y + item.height));
    const contactCanvasWidth = Math.max(280, ...contactEntries.map((item) => item.x + item.width));
    const contactTypographyStyle = buildTypographyInlineStyle(block.props);
    if (!("color" in contactTypographyStyle) && !("backgroundImage" in contactTypographyStyle)) {
      contactTypographyStyle.color = "#374151";
    }
    const socialIconUrl = (label: string) => {
      if (label === "Email") return "/social-icons/maildotru.svg";
      if (label === "WhatsApp") return "/social-icons/whatsapp.svg";
      if (label === "WeChat") return "/social-icons/wechat.svg";
      if (label === "Twitter") return "/social-icons/twitter.svg";
      if (label === "微博") return "/social-icons/weibo.svg";
      if (label === "Telegram") return "/social-icons/telegram.svg";
      if (label === "LinkedIn") return "/social-icons/linkedin.svg";
      if (label === "Discord") return "/social-icons/discord.svg";
      if (label === "TikTok") return "/social-icons/tiktok.svg";
      if (label === "小红书") return "/social-icons/xiaohongshu.svg";
      if (label === "Facebook") return "/social-icons/facebook.svg";
      if (label === "Instagram") return "/social-icons/instagram.svg";
      return "/social-icons/facebook.svg";
    };
    const socialIconClass = (label: string) => {
      const base = "inline-flex h-7 w-7 items-center justify-center rounded-full shadow-sm";
      if (label === "Phone") return `${base} bg-[#007AFF] text-white`;
      if (label === "Email") return `${base} bg-[#0A84FF]`;
      if (label === "WhatsApp") return `${base} bg-[#25D366]`;
      if (label === "WeChat") return `${base} bg-[#07C160]`;
      if (label === "Twitter") return `${base} bg-[#111827]`;
      if (label === "微博") return `${base} bg-[#E6162D]`;
      if (label === "Telegram") return `${base} bg-[#229ED9]`;
      if (label === "LinkedIn") return `${base} bg-[#0A66C2]`;
      if (label === "Discord") return `${base} bg-[#5865F2]`;
      if (label === "TikTok") return `${base} bg-black`;
      if (label === "小红书") return `${base} bg-[#FF2442]`;
      if (label === "Facebook") return `${base} bg-[#1877F2]`;
      if (label === "Instagram") return `${base} bg-[#E4405F]`;
      return `${base} bg-gray-500`;
    };
	    const clampContactLayoutValue = (value: unknown, fallback: number, min = 0) =>
	      typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.round(value)) : fallback;
	    const snapStep = Math.max(2, Math.min(40, Math.round(contactSnapStep) || 8));
	    const maybeSnap = (value: number, min = 0) => {
	      const clamped = Math.max(min, Math.round(value));
	      if (!contactSnapEnabled) return clamped;
	      return Math.max(min, Math.round(clamped / snapStep) * snapStep);
	    };
    const selectContactEntry = (key: ContactEntryKey, multi: boolean) => {
      if (multi) {
        setActiveContactEntryKeys((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
      } else {
        setActiveContactEntryKeys([key]);
      }
    };
    const startContactEntryDrag = (key: ContactEntryKey, event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const source = contactEntries.find((item) => item.key === key);
      if (!source) return;
      if (event.ctrlKey) {
        selectContactEntry(key, true);
        return;
      }
      const selectedKeys =
        activeContactEntryKeys.includes(key) && activeContactEntryKeys.length > 0 ? activeContactEntryKeys : [key];
      setActiveContactEntryKeys(selectedKeys);
      contactCanvasFocusRef.current?.focus();
      const startX = event.clientX;
      const startY = event.clientY;
      const originMap = new Map(selectedKeys.map((selectedKey) => {
        const found = contactEntries.find((item) => item.key === selectedKey);
        return [selectedKey, { x: found?.x ?? 0, y: found?.y ?? 0, width: found?.width ?? 360, height: found?.height ?? 42 }] as const;
      }));
      const onMove = (e: MouseEvent) => {
        const dx = Math.round(e.clientX - startX);
        const dy = Math.round(e.clientY - startY);
        const nextLayout = { ...contactLayout };
	        selectedKeys.forEach((selectedKey) => {
	          const origin = originMap.get(selectedKey);
          const found = contactEntries.find((item) => item.key === selectedKey);
	          if (!origin) return;
	          nextLayout[selectedKey] = {
	            x: maybeSnap(origin.x + dx),
	            y: maybeSnap(origin.y + dy),
	            width: clampContactLayoutValue((contactLayout[selectedKey] ?? {}).width, origin.width, 200),
              height: clampContactLayoutValue((contactLayout[selectedKey] ?? {}).height, origin.height, found?.minHeight ?? 32),
	          };
	        });
        onChange({ contactLayout: nextLayout });
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
    const startContactEntryResize = (
      key: ContactEntryKey,
      direction: "width" | "height",
      event: ReactMouseEvent<HTMLDivElement>,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      const source = contactEntries.find((item) => item.key === key);
      if (!source) return;
      const selectedKeys =
        activeContactEntryKeys.includes(key) && activeContactEntryKeys.length > 0 ? activeContactEntryKeys : [key];
      setActiveContactEntryKeys(selectedKeys);
      contactCanvasFocusRef.current?.focus();
      const startX = event.clientX;
      const startY = event.clientY;
      const originWidths = new Map(selectedKeys.map((selectedKey) => {
        const found = contactEntries.find((item) => item.key === selectedKey);
        return [selectedKey, found?.width ?? 360] as const;
      }));
      const originHeights = new Map(selectedKeys.map((selectedKey) => {
        const found = contactEntries.find((item) => item.key === selectedKey);
        return [selectedKey, found?.height ?? 42] as const;
      }));
      const onMove = (e: MouseEvent) => {
        const deltaWidth = Math.round(e.clientX - startX);
        const deltaHeight = Math.round(e.clientY - startY);
        const nextLayout = { ...contactLayout };
        selectedKeys.forEach((selectedKey) => {
          const found = contactEntries.find((item) => item.key === selectedKey);
	          const current = contactLayout[selectedKey] ?? {};
	          const originWidth = originWidths.get(selectedKey) ?? found?.width ?? 360;
            const originHeight = originHeights.get(selectedKey) ?? found?.height ?? 42;
          nextLayout[selectedKey] = {
	            x: clampContactLayoutValue(current.x, found?.x ?? 0),
	            y: clampContactLayoutValue(current.y, found?.y ?? 0),
            width:
              direction === "width"
                ? maybeSnap(originWidth + deltaWidth, 200)
                : clampContactLayoutValue(current.width, found?.width ?? 360, 200),
            height:
              direction === "height"
                ? maybeSnap(originHeight + deltaHeight, found?.minHeight ?? 32)
                : clampContactLayoutValue(current.height, found?.height ?? 42, found?.minHeight ?? 32),
          };
        });
        onChange({ contactLayout: nextLayout });
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
    const handleContactCanvasKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (activeContactEntryKeys.length === 0) return;
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
	      const step = event.shiftKey ? (contactSnapEnabled ? Math.max(snapStep * 2, 10) : 10) : (contactSnapEnabled ? snapStep : 2);
	      const deltaX = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
	      const deltaY = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
	      const nextLayout = { ...contactLayout };
      activeContactEntryKeys.forEach((selectedKey) => {
        const source = contactEntries.find((item) => item.key === selectedKey);
        if (!source) return;
	        const current = contactLayout[selectedKey] ?? {};
	        nextLayout[selectedKey] = {
	          x: maybeSnap(clampContactLayoutValue(current.x, source.x) + deltaX),
	          y: maybeSnap(clampContactLayoutValue(current.y, source.y) + deltaY),
	          width: clampContactLayoutValue(current.width, source.width, 200),
            height: clampContactLayoutValue(current.height, source.height, source.minHeight),
	        };
	      });
      onChange({ contactLayout: nextLayout });
    };
    const getSelectedContactEntries = () => {
      const keys = activeContactEntryKeys.length > 0 ? activeContactEntryKeys : [];
      return contactEntries.filter((item) => keys.includes(item.key as ContactEntryKey));
    };
    const alignSelectedContactEntries = (
      mode: "left" | "right" | "same-width" | "same-height" | "distribute-x" | "distribute-y",
    ) => {
      const selected = getSelectedContactEntries();
      if (selected.length === 0) return;
      const selectedKeys = selected.map((item) => item.key as ContactEntryKey);
      const nextLayout = { ...contactLayout };
      if (mode === "left") {
        const selectedMinLeft = Math.min(...selected.map((item) => item.x));
        const deltaX = Math.max(0, selectedMinLeft);
        selected.forEach((item) => {
          const current = contactLayout[item.key as ContactEntryKey] ?? {};
          nextLayout[item.key as ContactEntryKey] = {
            x: maybeSnap(Math.max(0, clampContactLayoutValue(current.x, item.x) - deltaX)),
            y: clampContactLayoutValue(current.y, item.y),
            width: clampContactLayoutValue(current.width, item.width, 200),
            height: clampContactLayoutValue(current.height, item.height, item.minHeight),
          };
        });
      }
      if (mode === "right") {
        const selectedMaxRight = Math.max(...selected.map((item) => item.x + item.width));
        const deltaX = Math.max(0, contactCanvasWidth - selectedMaxRight);
        selected.forEach((item) => {
          const current = contactLayout[item.key as ContactEntryKey] ?? {};
          nextLayout[item.key as ContactEntryKey] = {
            x: maybeSnap(clampContactLayoutValue(current.x, item.x) + deltaX),
            y: clampContactLayoutValue(current.y, item.y),
            width: clampContactLayoutValue(current.width, item.width, 200),
            height: clampContactLayoutValue(current.height, item.height, item.minHeight),
          };
        });
      }
      if (mode === "same-width") {
        const width = Math.max(...selected.map((item) => item.width));
        selected.forEach((item) => {
          const current = contactLayout[item.key as ContactEntryKey] ?? {};
          nextLayout[item.key as ContactEntryKey] = {
            x: clampContactLayoutValue(current.x, item.x),
            y: clampContactLayoutValue(current.y, item.y),
            width: Math.max(200, width),
            height: clampContactLayoutValue(current.height, item.height, item.minHeight),
          };
        });
      }
      if (mode === "same-height") {
        const height = Math.max(...selected.map((item) => item.height));
        selected.forEach((item) => {
          const current = contactLayout[item.key as ContactEntryKey] ?? {};
          nextLayout[item.key as ContactEntryKey] = {
            x: clampContactLayoutValue(current.x, item.x),
            y: clampContactLayoutValue(current.y, item.y),
            width: clampContactLayoutValue(current.width, item.width, 200),
            height: Math.max(item.minHeight, height),
          };
        });
      }
      if (mode === "distribute-x") {
        if (selected.length < 2) return;
        const sorted = [...selected].sort((a, b) => a.x - b.x);
        const totalWidth = sorted.reduce((sum, item) => sum + item.width, 0);
        const gap = sorted.length > 1 ? Math.max(0, (contactCanvasWidth - totalWidth) / (sorted.length - 1)) : 0;
        const baselineY = Math.min(...sorted.map((item) => item.y));
        let cursorX = 0;
        sorted.forEach((item) => {
          const current = contactLayout[item.key as ContactEntryKey] ?? {};
          nextLayout[item.key as ContactEntryKey] = {
            x: Math.max(0, Math.round(cursorX)),
            y: Math.max(0, Math.round(baselineY)),
            width: clampContactLayoutValue(current.width, item.width, 200),
            height: clampContactLayoutValue(current.height, item.height, item.minHeight),
          };
          cursorX += item.width + gap;
        });
      }
      if (mode === "distribute-y") {
        if (selected.length < 2) return;
        const sorted = [...selected].sort((a, b) => a.y - b.y);
        const totalHeight = sorted.reduce((sum, item) => sum + item.height, 0);
        const gap = sorted.length > 1 ? Math.max(0, (contactCanvasHeight - totalHeight) / (sorted.length - 1)) : 0;
        const baselineX = Math.min(...sorted.map((item) => item.x));
        let cursorY = 0;
        sorted.forEach((item) => {
          const current = contactLayout[item.key as ContactEntryKey] ?? {};
          nextLayout[item.key as ContactEntryKey] = {
            x: Math.max(0, Math.round(baselineX)),
            y: Math.max(0, Math.round(cursorY)),
            width: clampContactLayoutValue(current.width, item.width, 200),
            height: clampContactLayoutValue(current.height, item.height, item.minHeight),
          };
          cursorY += item.height + gap;
        });
      }
      setActiveContactEntryKeys(selectedKeys);
      onChange({ contactLayout: nextLayout });
    };
    const applyContactLayoutTemplate = (mode: "single-tight" | "single-wide" | "double-column") => {
      if (contactEntries.length === 0) return;
      const safeCanvasWidth = Math.max(
        280,
        Math.min(
          960,
          typeof block.props.blockWidth === "number" && Number.isFinite(block.props.blockWidth)
            ? Math.round(block.props.blockWidth) - 64
            : contactCanvasWidth,
        ),
      );
      const nextLayout = { ...contactLayout };
      if (mode === "single-tight") {
        const width = Math.max(220, Math.min(safeCanvasWidth, 360));
        let cursorY = 0;
        contactEntries.forEach((item) => {
          const height = Math.max(item.minHeight, 42);
          nextLayout[item.key as ContactEntryKey] = { x: 0, y: maybeSnap(cursorY), width, height };
          cursorY += height + 6;
        });
      }
      if (mode === "single-wide") {
        const width = Math.max(240, safeCanvasWidth);
        let cursorY = 0;
        contactEntries.forEach((item) => {
          const height = Math.max(item.minHeight, 42);
          nextLayout[item.key as ContactEntryKey] = { x: 0, y: maybeSnap(cursorY), width, height };
          cursorY += height + 14;
        });
      }
      if (mode === "double-column") {
        const gap = 14;
        const width = Math.max(200, Math.floor((safeCanvasWidth - gap) / 2));
        let rowY = 0;
        for (let idx = 0; idx < contactEntries.length; idx += 2) {
          const rowItems = contactEntries.slice(idx, idx + 2);
          const rowHeight = Math.max(...rowItems.map((item) => Math.max(item.minHeight, 42)));
          rowItems.forEach((item, itemIndex) => {
            const col = itemIndex;
            nextLayout[item.key as ContactEntryKey] = {
              x: maybeSnap(col * (width + gap)),
              y: maybeSnap(rowY),
              width,
              height: Math.max(item.minHeight, 42),
            };
          });
          rowY += rowHeight + 14;
        }
      }
      setActiveContactEntryKeys(contactEntries.map((item) => item.key as ContactEntryKey));
      onChange({ contactLayout: nextLayout });
    };
    const updateContactAddresses = (nextRawAddresses: string[]) => {
      const normalized = nextRawAddresses.map((item) => item.replace(/\r?\n/g, " ").trim());
      const firstNonEmpty = normalized.find((item) => !!item) ?? "";
      onChange({
        address: firstNonEmpty,
        addresses: normalized.length > 0 ? normalized : [""],
      });
    };
    const updateContactPhones = (nextRawPhones: string[]) => {
      const normalized = nextRawPhones.map((item) => item.replace(/\r?\n/g, " ").trim());
      const filtered = normalized.filter(Boolean);
      onChange({
        phone: filtered[0] ?? "",
        phones: normalized.length > 0 ? normalized : [""],
      });
    };
    const renderAddressPreviewRows = () => (
      <div className="min-w-0 flex-1 space-y-2 overflow-hidden">
        {contactAddresses.map((line, idx) => {
          const isActive = idx === 0;
          return (
            <div key={`contact-address-preview-${idx}`} className="flex min-w-0 items-start gap-2">
              <div
                className={`min-w-0 flex-1 rounded px-1 py-0.5 whitespace-pre-wrap break-words ${isActive ? "bg-black/5" : ""}`}
                style={contactTypographyStyle}
              >
                {`地址${contactAddresses.length > 1 ? idx + 1 : ""}：${line}`}
              </div>
              <span
                className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white shadow-sm ${
                  isActive ? "bg-[#EA4335]" : "bg-[#EA4335]/80"
                }`}
                aria-hidden="true"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                  <path d="M12 2a7 7 0 0 0-7 7c0 4.74 6.14 11.84 6.4 12.14a.8.8 0 0 0 1.2 0C12.86 20.84 19 13.74 19 9a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z" />
                </svg>
              </span>
            </div>
          );
        })}
      </div>
    );
    const renderContactEntryPreviewContent = (item: (typeof contactEntries)[number]) => {
      if (item.key === "address") {
        return renderAddressPreviewRows();
      }
      return (
        <>
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words" style={contactTypographyStyle}>
            {item.label}：{item.value}
          </span>
          <span className={socialIconClass(item.platformLabel)}>
            {item.platformLabel === "Phone" ? (
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
                <path d="M6.62 10.79a15.53 15.53 0 0 0 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.4 21 3 13.6 3 4c0-.55.45-1 1-1h3.49c.55 0 1 .45 1 1 0 1.24.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.19 2.2z" />
              </svg>
            ) : (
              <NextImage
                src={socialIconUrl(item.platformLabel)}
                alt=""
                width={16}
                height={16}
                className="h-4 w-4 object-contain"
              />
            )}
          </span>
        </>
      );
    };
    return (
      <section
        data-block-id={block.id}
        data-jump-target={publicBlockId}
        data-block-public-id={publicBlockId}
        className={`${shellClass} pointer-events-none`}
        style={offsetStyle}
      >
        <EditorBlockHeader
          blockId={publicBlockId}
          draggingBlockId={draggingBlockId}
          isSelected={isSelected}
          onDragHandleMouseDown={onDragHandleMouseDown}
          onNudge={onNudge}
          onOpenLayerSettings={openLayerSettings}
          onEditTypography={editTypography}
          onInsertText={insertTextBox}
          onInsertImage={insertImage}
          onEditImageSettings={editImageSettings}
          onEditBorderStyle={editBorderSettings}
          isMobileViewport={previewViewport === "mobile"}
          mobileFitScreenWidth={block.props.mobileFitScreenWidth === true}
          onToggleMobileFitScreenWidth={handleToggleMobileFitScreenWidth}
          blockOpenByButton={blockOpenByButton}
          onToggleBlockOpenMode={toggleBlockOpenMode}
          onDelete={onDelete}
        />
        <div
          ref={resizeTargetRef}
          data-block-visual-boundary
          className={`${cardClass} relative`}
          onClick={onSelect}
          style={{ ...blockBackgroundStyle, ...blockSizeStyle, ...previewBorderInlineStyle }}
        >
          {imageDialog}
          {imageSettingsDialog}
          {borderSettingsDialog}
          {layerSettingsDialog}
          {typographyDialog}
          {isSelected ? renderSelectedEditor(
            <>
              <div className="space-y-1 mt-3">
                <RichTextEditor
                  field="heading"
                  className="border p-2 rounded w-full text-xl font-bold"
                  value={block.props.heading ?? ""}
                  onChange={handleRichFieldChange}
                  onActivate={registerActiveEditor}
                  onSelectionChange={updateSelectionRange}
                />
              </div>
              <div className="space-y-1 mt-3">
                <div className="border rounded p-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm text-gray-700">电话列表（可增加）</div>
                    <button
                      type="button"
                      className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        updateContactPhones([...contactPhoneEditorValues, ""]);
                      }}
                    >
                      添加电话
                    </button>
                  </div>
                  {contactPhoneEditorValues.length > 0 ? (
                    contactPhoneEditorValues.map((phone, idx) => (
                      <div key={`contact-phone-${idx}`} className="flex items-center gap-2">
                        <BufferedEditorInput
                          className="border p-2 rounded text-sm flex-1"
                          value={phone}
                          placeholder={`电话${idx + 1}`}
                          onChange={(e) => {
                            const next = [...contactPhoneEditorValues];
                            next[idx] = e.target.value;
                            updateContactPhones(next);
                          }}
                        />
                        <button
                          type="button"
                          className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            const next = contactPhoneEditorValues.filter((_, removeIdx) => removeIdx !== idx);
                            updateContactPhones(next.length > 0 ? next : [""]);
                          }}
                        >
                          删除
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-gray-500">暂无电话，点击“添加电话”</div>
                  )}
                </div>
              </div>
              <div className="space-y-1 mt-3">
                <div className="border rounded p-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm text-gray-700">地址列表（可增加）</div>
                    <button
                      type="button"
                      className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        updateContactAddresses([
                          ...contactAddressEditorValues,
                          `地址${contactAddressEditorValues.length + 1}`,
                        ]);
                      }}
                    >
                      添加地址
                    </button>
                  </div>
                  {contactAddressEditorValues.length > 0 ? (
                    contactAddressEditorValues.map((line, idx) => (
                      <div key={`contact-address-${idx}`} className="flex items-center gap-2">
                        <BufferedEditorInput
                          className="border p-2 rounded text-sm flex-1"
                          value={line}
                          placeholder={`地址${idx + 1}`}
                          onChange={(e) => {
                            const next = [...contactAddressEditorValues];
                            next[idx] = e.target.value;
                            updateContactAddresses(next);
                          }}
                        />
                        <button
                          type="button"
                          className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            const next = contactAddressEditorValues.filter((_, removeIdx) => removeIdx !== idx);
                            updateContactAddresses(next.length > 0 ? next : [""]);
                          }}
                        >
                          删除
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-gray-500">暂无地址，点击“添加地址”</div>
                  )}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                <div className="flex items-center gap-2 border p-2 rounded text-sm">
                  <span className="text-gray-600 whitespace-nowrap">地图缩放</span>
                  <BufferedEditorInput
                    type="number"
                    min={2}
                    max={20}
                    className="border p-1 rounded w-20"
                    value={
                      typeof block.props.mapZoom === "number" && Number.isFinite(block.props.mapZoom)
                        ? Math.max(2, Math.min(20, Math.round(block.props.mapZoom)))
                        : 5
                    }
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      if (!Number.isFinite(next)) return;
                      onChange({ mapZoom: Math.max(2, Math.min(20, Math.round(next))) });
                    }}
                  />
                </div>
                <div className="flex items-center gap-2 border p-2 rounded text-sm">
                  <span className="text-gray-600 whitespace-nowrap">地图类型</span>
                  <select
                    className="border p-1 rounded flex-1"
                    value={block.props.mapType === "satellite" ? "satellite" : "roadmap"}
                    onChange={(e) => onChange({ mapType: e.target.value as "roadmap" | "satellite" })}
                  >
                    <option value="roadmap">标准地图</option>
                    <option value="satellite">卫星图</option>
                  </select>
                </div>
                <label className="md:col-span-2 inline-flex items-center gap-2 text-sm border p-2 rounded">
                  <BufferedEditorInput
                    type="checkbox"
                    checked={block.props.mapShowMarker !== false}
                    onChange={(e) => onChange({ mapShowMarker: e.target.checked })}
                  />
                  <span>地图使用地址标记</span>
                </label>
                <BufferedEditorInput
                  className="border p-2 rounded text-sm"
                  placeholder="邮箱"
                  value={block.props.email ?? ""}
                  onChange={(e) => onChange({ email: e.target.value })}
                />
                <BufferedEditorInput
                  className="border p-2 rounded text-sm"
                  placeholder="WhatsApp"
                  value={block.props.whatsapp ?? ""}
                  onChange={(e) => onChange({ whatsapp: e.target.value })}
                />
                <BufferedEditorInput
                  className="border p-2 rounded text-sm"
                  placeholder="WeChat"
                  value={block.props.wechat ?? ""}
                  onChange={(e) => onChange({ wechat: e.target.value })}
                />
                <BufferedEditorInput
                  className="border p-2 rounded text-sm"
                  placeholder="Twitter"
                  value={block.props.twitter ?? ""}
                  onChange={(e) => onChange({ twitter: e.target.value })}
                />
                <BufferedEditorInput
                  className="border p-2 rounded text-sm"
                  placeholder="微博"
                  value={block.props.weibo ?? ""}
                  onChange={(e) => onChange({ weibo: e.target.value })}
                />
                <BufferedEditorInput
                  className="border p-2 rounded text-sm"
                  placeholder="Telegram"
                  value={block.props.telegram ?? ""}
                  onChange={(e) => onChange({ telegram: e.target.value })}
                />
                <BufferedEditorInput
                  className="border p-2 rounded text-sm"
                  placeholder="LinkedIn"
                  value={block.props.linkedin ?? ""}
                  onChange={(e) => onChange({ linkedin: e.target.value })}
                />
                <BufferedEditorInput
                  className="border p-2 rounded text-sm"
                  placeholder="Discord"
                  value={block.props.discord ?? ""}
                  onChange={(e) => onChange({ discord: e.target.value })}
                />
                <BufferedEditorInput
                  className="border p-2 rounded text-sm"
                  placeholder="TikTok"
                  value={block.props.tiktok ?? ""}
                  onChange={(e) => onChange({ tiktok: e.target.value })}
                />
                <BufferedEditorInput
                  className="border p-2 rounded text-sm"
                  placeholder="小红书"
                  value={block.props.xiaohongshu ?? ""}
                  onChange={(e) => onChange({ xiaohongshu: e.target.value })}
                />
                <BufferedEditorInput
                  className="border p-2 rounded text-sm"
                  placeholder="Facebook"
                  value={block.props.facebook ?? ""}
                  onChange={(e) => onChange({ facebook: e.target.value })}
                />
                <BufferedEditorInput
                  className="border p-2 rounded text-sm md:col-span-2"
                  placeholder="Instagram"
                  value={block.props.instagram ?? ""}
                  onChange={(e) => onChange({ instagram: e.target.value })}
                />
              </div>
              <div className="mt-3">
                <div className="text-xs text-gray-500 mb-2">拖动条目可改位置，拉伸右边缘改宽度，拉伸下边缘改高度</div>
                <div className="mb-2 flex flex-wrap gap-2">
                  <label className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border bg-white">
                    <BufferedEditorInput
                      type="checkbox"
                      checked={contactSnapEnabled}
                      onChange={(e) => setContactSnapEnabled(e.target.checked)}
                    />
                    {"吸附网格"}
                  </label>
                  <select
                    className="px-2 py-1 text-xs rounded border bg-white"
                    value={contactSnapStep}
                    onChange={(e) => setContactSnapStep(Math.max(2, Math.min(40, Number(e.target.value) || 8)))}
                  >
                    {[4, 6, 8, 10, 12, 16, 20].map((step) => (
                      <option key={step} value={step}>
                        {`网格 ${step}px`}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                    onClick={() => applyContactLayoutTemplate("single-tight")}
                  >
                    {"紧凑单列"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                    onClick={() => applyContactLayoutTemplate("single-wide")}
                  >
                    {"宽松单列"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                    onClick={() => applyContactLayoutTemplate("double-column")}
                  >
                    {"双列"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                    onClick={() => alignSelectedContactEntries("left")}
                  >
                    {"左"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                    onClick={() => alignSelectedContactEntries("right")}
                  >
                    {"右"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                    onClick={() => alignSelectedContactEntries("same-width")}
                  >
                    {"统一宽度"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                    onClick={() => alignSelectedContactEntries("same-height")}
                  >
                    {"统一高度"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                    onClick={() => alignSelectedContactEntries("distribute-x")}
                  >
                    {"横向均分"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                    onClick={() => alignSelectedContactEntries("distribute-y")}
                  >
                    {"纵向均分"}
                  </button>
                </div>
                <div
                  ref={contactCanvasFocusRef}
                  className="relative rounded border border-dashed border-gray-300 bg-transparent"
                  style={{
                    minHeight: `${contactCanvasHeight}px`,
                    width: `${contactCanvasWidth}px`,
                    maxWidth: "100%",
                    backgroundImage: contactSnapEnabled
                      ? "linear-gradient(to right, rgba(17,24,39,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(17,24,39,0.08) 1px, transparent 1px)"
                      : undefined,
                    backgroundSize: contactSnapEnabled
                      ? `${Math.max(2, Math.min(40, contactSnapStep))}px ${Math.max(2, Math.min(40, contactSnapStep))}px`
                      : undefined,
                  }}
                  tabIndex={0}
                  onKeyDown={handleContactCanvasKeyDown}
                >
                  {contactEntries.map((item) => (
                    <div
                      key={item.key}
                      className={`absolute flex gap-2 rounded border bg-white px-2 py-1 shadow-sm cursor-move overflow-hidden ${
                        item.key === "address" ? "items-start" : "items-center justify-between"
                      } ${
                        activeContactEntryKeys.includes(item.key as ContactEntryKey)
                          ? "border-blue-500 bg-blue-50/70 ring-4 ring-blue-400/45 shadow-md"
                          : "border-gray-300"
                      }`}
                      style={{ left: `${item.x}px`, top: `${item.y}px`, width: `${item.width}px`, height: `${item.height}px` }}
                      onMouseDown={(event) => startContactEntryDrag(item.key as ContactEntryKey, event)}
                    >
                      {renderContactEntryPreviewContent(item)}
                      <div
                        className="absolute top-0 right-0 h-full w-2 cursor-ew-resize"
                        onMouseDown={(event) => startContactEntryResize(item.key as ContactEntryKey, "width", event)}
                      />
                      <div
                        className="absolute bottom-0 left-0 h-2 w-full cursor-ns-resize"
                        onMouseDown={(event) => startContactEntryResize(item.key as ContactEntryKey, "height", event)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </>,
          ) : (
            <>
              <h2
                className="text-xl font-bold whitespace-pre-wrap break-words"
                dangerouslySetInnerHTML={{ __html: toRichHtml(block.props.heading, "") }}
              />
              <div
                className="mt-3 relative bg-transparent"
                style={{ minHeight: `${contactCanvasHeight}px`, width: `${contactCanvasWidth}px`, maxWidth: "100%" }}
              >
                {contactEntries.map((item) => (
                  <div
                    key={item.key}
                    className={`absolute flex gap-2 px-1 py-1 overflow-hidden ${
                      item.key === "address" ? "items-start" : "items-center justify-between"
                    }`}
                    style={{ left: `${item.x}px`, top: `${item.y}px`, width: `${item.width}px`, height: `${item.height}px` }}
                  >
                    {renderContactEntryPreviewContent(item)}
                  </div>
                ))}
              </div>
            </>
          )}
          {resizeHandles}
        </div>
      </section>
    );
  }

  return null;
}

const MemoizedInlineEditorBlock = memo(InlineEditorBlock, (previousProps, nextProps) => {
  return (
    previousProps.block === nextProps.block &&
    previousProps.publicBlockId === nextProps.publicBlockId &&
    previousProps.draggingBlockId === nextProps.draggingBlockId &&
    previousProps.isSelected === nextProps.isSelected &&
    previousProps.previewOffsetY === nextProps.previewOffsetY &&
    previousProps.availablePages === nextProps.availablePages &&
    previousProps.availableBlocks === nextProps.availableBlocks &&
    previousProps.currentPageId === nextProps.currentPageId &&
    previousProps.maxNavItems === nextProps.maxNavItems &&
    previousProps.recentColors === nextProps.recentColors &&
    previousProps.previewViewport === nextProps.previewViewport &&
    previousProps.runtimeSiteId === nextProps.runtimeSiteId &&
    previousProps.runtimeSiteName === nextProps.runtimeSiteName &&
    previousProps.merchantCouponRecords === nextProps.merchantCouponRecords &&
    previousProps.europeLocationOptionsApi === nextProps.europeLocationOptionsApi &&
    previousProps.onGoogleBusinessProfileRequest === nextProps.onGoogleBusinessProfileRequest
  );
});

type RichFieldName = "title" | "subtitle" | "heading" | "text" | "phone" | "address" | "buttonLabel";

type SerializedEditorRange = {
  start: number;
  end: number;
  collapsed: boolean;
};

type TypographyDialogValues = {
  fontFamily: string;
  fontSize: number;
  fontColor: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
};

function serializeEditorRange(root: HTMLElement, range: Range): SerializedEditorRange | null {
  if (!root.contains(range.commonAncestorContainer)) return null;
  const startRange = document.createRange();
  startRange.selectNodeContents(root);
  startRange.setEnd(range.startContainer, range.startOffset);
  const endRange = document.createRange();
  endRange.selectNodeContents(root);
  endRange.setEnd(range.endContainer, range.endOffset);
  const start = startRange.toString().length;
  const end = endRange.toString().length;
  return {
    start,
    end: Math.max(start, end),
    collapsed: range.collapsed,
  };
}

function resolveEditorTextPosition(root: HTMLElement, targetOffset: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let consumed = 0;
  let lastTextNode: Text | null = null;
  let currentNode = walker.nextNode();
  while (currentNode) {
    const textNode = currentNode as Text;
    lastTextNode = textNode;
    const length = textNode.data.length;
    if (targetOffset <= consumed + length) {
      return {
        node: textNode,
        offset: Math.max(0, targetOffset - consumed),
      };
    }
    consumed += length;
    currentNode = walker.nextNode();
  }
  if (lastTextNode) {
    return {
      node: lastTextNode,
      offset: lastTextNode.data.length,
    };
  }
  const fallback = document.createTextNode("");
  root.appendChild(fallback);
  return {
    node: fallback,
    offset: 0,
  };
}

function restoreEditorRange(root: HTMLElement, serialized: SerializedEditorRange | null) {
  if (!serialized) return null;
  const start = resolveEditorTextPosition(root, serialized.start);
  const end = resolveEditorTextPosition(root, serialized.end);
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

function areTypographyDialogValuesEqual(left: TypographyDialogValues | null, right: TypographyDialogValues) {
  if (!left) return false;
  return (
    left.fontFamily === right.fontFamily &&
    left.fontSize === right.fontSize &&
    left.fontColor === right.fontColor &&
    left.bold === right.bold &&
    left.italic === right.italic &&
    left.underline === right.underline
  );
}

function RichTextEditor({
  field,
  value,
  dataNavItemId,
  dataCommonBoxId,
  className,
  style,
  onChange,
  onActivate,
  onSelectionChange,
}: {
  field: RichFieldName;
  value: string;
  dataNavItemId?: string;
  dataCommonBoxId?: string;
  className: string;
  style?: CSSProperties;
  onChange: (field: RichFieldName, html: string, editor: HTMLDivElement | null) => void;
  onActivate: (editor: HTMLDivElement | null) => void;
  onSelectionChange: (range: Range | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const { scheduleCommit, flushCommit } = useBufferedEditorTextCommit((html: string) => {
    onChange(field, html, ref.current);
  });

  useEffect(() => {
    if (!ref.current) return;
    if (ref.current.innerHTML !== value) {
      ref.current.innerHTML = value;
    }
  }, [value]);

  function readCurrentHtml() {
    if (!ref.current) return;
    return ref.current.innerHTML.replaceAll("\u200B", "");
  }

  function emitChange() {
    if (composingRef.current) return;
    const html = readCurrentHtml();
    if (typeof html === "string") scheduleCommit(html);
  }

  function updateSelection() {
    const editor = ref.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) {
      onSelectionChange(null);
      return;
    }

    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) {
      onSelectionChange(null);
      return;
    }
    onSelectionChange(range);
  }

  return (
    <div
      ref={ref}
      data-field={field}
      data-nav-item-id={dataNavItemId}
      data-common-box-id={dataCommonBoxId}
      data-no-translate="1"
      className={`${className} whitespace-pre-wrap break-words focus:outline-none`}
      style={style}
      contentEditable
      suppressContentEditableWarning
      onFocus={() => onActivate(ref.current)}
      onInput={emitChange}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={() => {
        composingRef.current = false;
        emitChange();
      }}
      onBlur={() => {
        composingRef.current = false;
        const html = readCurrentHtml();
        if (typeof html === "string") scheduleCommit(html);
        flushCommit();
      }}
      onKeyUp={updateSelection}
      onMouseUp={updateSelection}
    />
  );
}

function EditorBlockHeader({
  blockId,
  draggingBlockId,
  isSelected,
  onDragHandleMouseDown,
  onNudge,
  onOpenLayerSettings,
  onEditTypography,
  onInsertText,
  onInsertImage,
  onConfigureJump,
  onEditButtonAnimation,
  onEditImageSettings,
  onEditBorderStyle,
  isMobileViewport,
  mobileFitScreenWidth,
  onToggleMobileFitScreenWidth,
  blockOpenByButton,
  onToggleBlockOpenMode,
  onDelete,
  toolbarAnchorClassName,
  toolbarAnchorStyle,
}: {
  blockId?: string;
  draggingBlockId: string | null;
  isSelected: boolean;
  onDragHandleMouseDown: (point: { x: number; y: number }) => void;
  onNudge: (deltaX: number, deltaY: number) => void;
  onOpenLayerSettings: () => void;
  onEditTypography: () => void;
  onInsertText?: (() => void) | undefined;
  onInsertImage?: (() => void) | undefined;
  onConfigureJump?: (() => void) | undefined;
  onEditButtonAnimation?: (() => void) | undefined;
  onEditImageSettings: () => void;
  onEditBorderStyle: () => void;
  isMobileViewport?: boolean;
  mobileFitScreenWidth?: boolean;
  onToggleMobileFitScreenWidth?: (() => void) | undefined;
  blockOpenByButton?: boolean;
  onToggleBlockOpenMode?: (() => void) | undefined;
  onDelete: () => void;
  toolbarAnchorClassName?: string;
  toolbarAnchorStyle?: React.CSSProperties;
}) {
  const anchorClassName =
    toolbarAnchorClassName ?? "absolute left-0 bottom-full mb-[2px] z-[80] flex items-end gap-3 w-max max-w-none";
  void onNudge;
  function preserveEditorSelection(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
  }
  return (
    <div data-editor-toolbar className="absolute inset-0 h-full w-full overflow-visible pointer-events-none">
      {isSelected ? (
        <>
          <button
            type="button"
            title={mobileFitScreenWidth ? "按住并拖动此按钮可上下拖动区块" : "按住并拖动此按钮可自由拖动区块"}
            aria-label={mobileFitScreenWidth ? "拖动区块（仅上下）" : "拖动区块"}
            className={`pointer-events-auto absolute -top-2 -left-2 z-[90] flex h-6 w-6 select-none items-center justify-center rounded-full border border-black bg-white text-black shadow-sm ${
              draggingBlockId ? "cursor-grabbing bg-gray-100" : "cursor-grab hover:bg-gray-50"
            }`}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDragHandleMouseDown({ x: e.clientX, y: e.clientY });
            }}
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
              <path d="M8 2 L6.5 3.5 M8 2 L9.5 3.5 M8 2 V14" />
              <path d="M14 8 L12.5 6.5 M14 8 L12.5 9.5 M14 8 H2" />
              <path d="M8 14 L6.5 12.5 M8 14 L9.5 12.5" />
              <path d="M2 8 L3.5 6.5 M2 8 L3.5 9.5" />
            </svg>
          </button>
          <div className={`${anchorClassName} pointer-events-auto`} style={toolbarAnchorStyle}>
            {blockId ? (
              <div className="z-30 mb-1 rounded border bg-white px-2 py-1 text-[11px] font-mono text-gray-700 whitespace-nowrap">
                {`ID: ${blockId}`}
              </div>
            ) : null}
            <div className="z-30 flex items-center gap-2 flex-nowrap overflow-visible pr-1 pb-1">
            <button
              className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50 shrink-0 whitespace-nowrap"
              onMouseDown={preserveEditorSelection}
              onClick={(e) => {
                e.stopPropagation();
                onEditTypography();
              }}
            >
              {"字体样式"}
            </button>
            {onInsertText ? (
              <button
                className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50 shrink-0 whitespace-nowrap"
                onClick={(e) => {
                  e.stopPropagation();
                  onInsertText();
                }}
              >
                {"插入文字"}
              </button>
            ) : null}
            {onInsertImage ? (
              <button
                className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50 shrink-0 whitespace-nowrap"
                onClick={(e) => {
                  e.stopPropagation();
                  onInsertImage();
                }}
              >
                {"插入图片"}
              </button>
            ) : null}
            {onConfigureJump ? (
              <button
                className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50 shrink-0 whitespace-nowrap"
                onClick={(e) => {
                  e.stopPropagation();
                  onConfigureJump();
                }}
              >
                {"跳转"}
              </button>
            ) : null}
            {onEditButtonAnimation ? (
              <button
                className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50 shrink-0 whitespace-nowrap"
                onClick={(e) => {
                  e.stopPropagation();
                  onEditButtonAnimation();
                }}
              >
                {"动画"}
              </button>
            ) : null}
            <button
              className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50 shrink-0 whitespace-nowrap"
              onClick={(e) => {
                e.stopPropagation();
                onEditImageSettings();
              }}
            >
              {"图片参数"}
            </button>
            <button
              className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50 shrink-0 whitespace-nowrap"
              onClick={(e) => {
                e.stopPropagation();
                onOpenLayerSettings();
              }}
            >
              {"层级"}
            </button>
            <button
              className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50 shrink-0 whitespace-nowrap"
              onClick={(e) => {
                e.stopPropagation();
                onEditBorderStyle();
              }}
            >
              {"边框样式"}
            </button>
            {isMobileViewport && onToggleMobileFitScreenWidth ? (
              <button
                className={`px-2 py-1 text-xs rounded border shrink-0 whitespace-nowrap ${
                  mobileFitScreenWidth ? "border-black bg-black text-white" : "bg-white hover:bg-gray-50"
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleMobileFitScreenWidth();
                }}
              >
                {mobileFitScreenWidth ? "取消适应屏宽" : "适应屏宽"}
              </button>
            ) : null}
            {onToggleBlockOpenMode ? (
              <button
                className={`px-2 py-1 text-xs rounded border shrink-0 whitespace-nowrap ${
                  blockOpenByButton ? "border-black bg-black text-white" : "bg-white hover:bg-gray-50"
                }`}
                title={blockOpenByButton ? "前台隐藏，通过按钮区块打开" : "前台直接展示在页面中"}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleBlockOpenMode();
                }}
              >
                {blockOpenByButton ? "按钮打开" : "直接展示"}
              </button>
            ) : null}
            <button
              className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50 shrink-0 whitespace-nowrap"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              {"删除"}
            </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default MemoizedInlineEditorBlock;
