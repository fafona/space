"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import NextImage from "next/image";
import { createPortal } from "react-dom";
import {
  homeBlocks,
  type BlockBorderStyle,
  type BackgroundEditableProps,
  type Block,
  type ImageFillMode,
} from "@/data/homeBlocks";
import {
  loadPublishedBlocksFromStorage,
  saveBlocksToStorage,
  savePublishedBlocksToStorage,
  savePublishFailureSnapshot,
  readPublishFailureSnapshots,
} from "@/data/blockStore";
import { supabase } from "@/lib/supabase";
import { getBackgroundStyle } from "@/components/blocks/backgroundStyle";
import { BLOCK_BORDER_STYLE_OPTIONS, getBlockBorderClass, getBlockBorderInlineStyle } from "@/components/blocks/borderStyle";
import { toRichHtml } from "@/components/blocks/richText";
import {
  buildPersistedBlocksFromPlanConfig,
  cloneBlocks,
  getBlocksForPage,
  getPagePlanConfigFromBlocks,
  setBlocksForPage,
  type PagePlanConfig,
  type PlanId,
} from "@/lib/pagePlans";
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
import { sanitizeBlocksForRuntime } from "@/lib/blocksSanitizer";
import {
  readContactClickStats,
  readContactClickDailyStats,
  readPageViewDailyStats,
  readPublishEvents,
  readRemoteAnalyticsSummary,
  trackPublishEvent,
} from "@/lib/analytics";
import BlockRenderer from "@/components/blocks/BlockRenderer";

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
  "Microsoft YaHei, SimHei, sans-serif",
  "SimSun, serif",
  "SimHei, sans-serif",
  "KaiTi, STKaiti, serif",
  "FangSong, STFangsong, serif",
  "YouYuan, sans-serif",
  "STXingkai, KaiTi, serif",
  "STCaiyun, SimHei, sans-serif",
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
const FONT_SIZE_OPTIONS = [12, 14, 16, 18, 20, 24, 28, 32, 36, 48];
const BLOCK_TYPE_LABELS: Record<Block["type"], string> = {
  common: "通用",
  gallery: "相册",
  chart: "图表",
  nav: "导航",
  music: "音乐",
  hero: "通用",
  text: "通用",
  list: "通用",
  contact: "联系方式",
};
const MIN_BLOCK_WIDTH = 240;
const MIN_BLOCK_HEIGHT = 120;
const NUDGE_STEP = 4;
const HISTORY_LIMIT = 120;
const DEFAULT_TIP_DURATION_MS = 2600;
const SAVE_PUBLISH_TIP_DURATION_MS = 5200;

const MAX_ORIGINAL_IMAGE_DATA_URL_LENGTH = 6_000_000;
const MAX_AUDIO_DATA_URL_LENGTH = 4_000_000;
const MAX_PUBLISH_PAYLOAD_BYTES = 30_000_000;
const MAX_IMAGE_FILE_BYTES = 10_000_000;
const EXTERNALIZE_MIN_IMAGE_BYTES = 300_000;
type UploadCompressionPreset = "high" | "balanced" | "compact";
const IMAGE_COMPRESSION_OPTIONS: Record<UploadCompressionPreset, { label: string; maxSide: number; quality: number }> = {
  high: { label: "高质量", maxSide: 3200, quality: 0.92 },
  balanced: { label: "平衡", maxSide: 2600, quality: 0.88 },
  compact: { label: "压缩优先", maxSide: 2000, quality: 0.8 },
};
type ThemePresetKey = "none" | "cartoon" | "retro" | "minimal" | "future" | "luxury" | "magazine" | "commerce" | "cinema";
type ThemePreset = {
  label: string;
  noop?: boolean;
  fontFamily?: string;
  fontColor?: string;
  blockBgColor?: string;
  borderStyle?: BlockBorderStyle;
  borderColor?: string;
  pageBgColor?: string;
};
const THEME_PRESETS: Record<
  ThemePresetKey,
  ThemePreset
> = {
  none: {
    label: "无效果",
    noop: true,
  },
  cartoon: {
    label: "卡通活力",
    fontFamily: "Trebuchet MS, sans-serif",
    fontColor: "#1f2937",
    blockBgColor: "#fff7cc",
    borderStyle: "accent",
    borderColor: "#fb7185",
    pageBgColor: "#dbeafe",
  },
  retro: {
    label: "经典怀旧",
    fontFamily: "Georgia, serif",
    fontColor: "#4a3f35",
    blockBgColor: "#f4e7d3",
    borderStyle: "double",
    borderColor: "#8b5a2b",
    pageBgColor: "#e8d6b9",
  },
  minimal: {
    label: "极简风格",
    fontFamily: "Microsoft YaHei, SimHei, sans-serif",
    fontColor: "#111827",
    blockBgColor: "#ffffff",
    borderStyle: "none",
    borderColor: "#d1d5db",
    pageBgColor: "#f3f4f6",
  },
  future: {
    label: "未来科技",
    fontFamily: "Verdana, Geneva, sans-serif",
    fontColor: "#e0f2fe",
    blockBgColor: "#0f172a",
    borderStyle: "glass",
    borderColor: "#22d3ee",
    pageBgColor: "#020617",
  },
  luxury: {
    label: "高端奢华",
    fontFamily: "Times New Roman, Times, serif",
    fontColor: "#fef3c7",
    blockBgColor: "#111111",
    borderStyle: "solid",
    borderColor: "#d4af37",
    pageBgColor: "#0a0a0a",
  },
  magazine: {
    label: "杂志风格",
    fontFamily: "Arial, Helvetica, sans-serif",
    fontColor: "#111827",
    blockBgColor: "#ffffff",
    borderStyle: "dashed",
    borderColor: "#111827",
    pageBgColor: "#fefce8",
  },
  commerce: {
    label: "电商风格",
    fontFamily: "Microsoft YaHei, SimHei, sans-serif",
    fontColor: "#111827",
    blockBgColor: "#fff1f2",
    borderStyle: "soft",
    borderColor: "#fb7185",
    pageBgColor: "#ffe4e6",
  },
  cinema: {
    label: "电影感",
    fontFamily: "Trebuchet MS, sans-serif",
    fontColor: "#f8fafc",
    blockBgColor: "#111827",
    borderStyle: "glass",
    borderColor: "#374151",
    pageBgColor: "#030712",
  },
};
const RECENT_COLORS_KEY = "merchant-space:recent-colors:v1";
const MAX_RECENT_COLORS = 10;
type GradientDirection = "to right" | "to left" | "to bottom" | "to top" | "to bottom right" | "to bottom left" | "to top right" | "to top left";
const GRADIENT_DIRECTION_OPTIONS: Array<{ value: GradientDirection; label: string }> = [
  { value: "to right", label: "向右" },
  { value: "to left", label: "向左" },
  { value: "to bottom", label: "向下" },
  { value: "to top", label: "向上" },
  { value: "to bottom right", label: "右下" },
  { value: "to bottom left", label: "左下" },
  { value: "to top right", label: "右上" },
  { value: "to top left", label: "左上" },
];
const GALLERY_FRAME_WIDTH_LABELS: Record<CustomGalleryFrameWidth, string> = {
  "1": "1",
  "1/2": "1/2",
  "1/3": "1/3",
  "2/3": "2/3",
};
type ViewportKey = "desktop" | "mobile";
const MOBILE_SIZE_SCALE = 0.82;
const MOBILE_CONTENT_MAX_WIDTH = 340;
const MOBILE_SAFE_PADDING = 12;
const STYLE_SYNC_KEYS = [
  "fontFamily",
  "fontColor",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "textDecoration",
  "bgImageUrl",
  "bgFillMode",
  "bgPosition",
  "bgColor",
  "bgOpacity",
  "bgImageOpacity",
  "bgColorOpacity",
  "blockWidth",
  "blockHeight",
  "blockOffsetX",
  "blockOffsetY",
  "blockLayer",
  "blockBorderStyle",
  "blockBorderColor",
  "galleryFrameWidth",
  "galleryFrameHeight",
  "contactLayout",
  "mapZoom",
  "mapType",
  "mapShowMarker",
] as const;

function getEmbeddedMobilePlanConfig(sourceBlocks: Block[]): PagePlanConfig | null {
  const carrier = sourceBlocks.find((block) => !!(block?.props as { pagePlanConfigMobile?: unknown } | undefined)?.pagePlanConfigMobile);
  const rawMobile = (carrier?.props as { pagePlanConfigMobile?: unknown } | undefined)?.pagePlanConfigMobile;
  if (!rawMobile) return null;
  const cloned = cloneBlocks(sourceBlocks);
  const carrierIndex = cloned.findIndex((block) => !!(block?.props as { pagePlanConfigMobile?: unknown } | undefined)?.pagePlanConfigMobile);
  if (carrierIndex >= 0) {
    cloned[carrierIndex] = {
      ...cloned[carrierIndex],
      props: {
        ...cloned[carrierIndex].props,
        pagePlanConfig: rawMobile as never,
      } as never,
    } as Block;
    delete (cloned[carrierIndex].props as { pagePlanConfigMobile?: unknown }).pagePlanConfigMobile;
  }
  return getPagePlanConfigFromBlocks(cloned);
}

function scaleValue(value: unknown, min?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  const scaled = Math.round(value * MOBILE_SIZE_SCALE);
  return typeof min === "number" ? Math.max(min, scaled) : scaled;
}

function adaptBlockForMobile(block: Block): Block {
  const next = cloneBlocks([block])[0];
  const props = { ...(next.props as Record<string, unknown>) };
  const originalWidth =
    typeof props.blockWidth === "number" && Number.isFinite(props.blockWidth) ? Math.max(1, Math.round(props.blockWidth)) : undefined;
  const scaledWidth = typeof originalWidth === "number" ? Math.round(originalWidth * MOBILE_SIZE_SCALE) : undefined;
  const fittedWidth =
    typeof scaledWidth === "number"
      ? Math.max(120, Math.min(MOBILE_CONTENT_MAX_WIDTH, scaledWidth))
      : undefined;
  props.blockWidth = fittedWidth;
  props.blockHeight = scaleValue(props.blockHeight, 80);
  const scaledOffsetX = scaleValue(props.blockOffsetX);
  if (typeof scaledOffsetX === "number") {
    const maxX = Math.max(0, MOBILE_CONTENT_MAX_WIDTH - (typeof fittedWidth === "number" ? fittedWidth : MOBILE_CONTENT_MAX_WIDTH)) + MOBILE_SAFE_PADDING;
    const minX = -MOBILE_SAFE_PADDING;
    props.blockOffsetX = Math.max(minX, Math.min(maxX, scaledOffsetX));
  } else {
    props.blockOffsetX = scaledOffsetX;
  }
  props.blockOffsetY = scaleValue(props.blockOffsetY);
  props.fontSize = scaleValue(props.fontSize, 10);
  const galleryFrameWidth = scaleValue(props.galleryFrameWidth, 120);
  props.galleryFrameWidth =
    typeof galleryFrameWidth === "number" ? Math.min(MOBILE_CONTENT_MAX_WIDTH, galleryFrameWidth) : galleryFrameWidth;
  props.galleryFrameHeight = scaleValue(props.galleryFrameHeight, 80);
  if (Array.isArray(props.commonTextBoxes)) {
    props.commonTextBoxes = props.commonTextBoxes.map((item) => {
      const box = { ...(item as Record<string, unknown>) };
      box.x = scaleValue(box.x);
      box.y = scaleValue(box.y);
      box.width = scaleValue(box.width, 60);
      box.height = scaleValue(box.height, 40);
      return box;
    });
  }
  next.props = props as never;
  return next;
}

function fitBlocksIntoMobileWidth(blocks: Block[]): Block[] {
  if (blocks.length === 0) return blocks;
  const adapted = cloneBlocks(blocks);
  const metrics = adapted.map((block) => {
    const props = block.props as Record<string, unknown>;
    const x =
      typeof props.blockOffsetX === "number" && Number.isFinite(props.blockOffsetX)
        ? Math.round(props.blockOffsetX)
        : 0;
    const width =
      typeof props.blockWidth === "number" && Number.isFinite(props.blockWidth)
        ? Math.max(120, Math.round(props.blockWidth))
        : MOBILE_CONTENT_MAX_WIDTH;
    return { x, width, right: x + width };
  });
  const minLeft = Math.min(...metrics.map((item) => item.x));
  const maxRight = Math.max(...metrics.map((item) => item.right));
  const contentWidth = Math.max(1, maxRight - minLeft);
  const availableWidth = MOBILE_CONTENT_MAX_WIDTH;
  const scale = contentWidth > availableWidth ? availableWidth / contentWidth : 1;

  return adapted.map((block, idx) => {
    const props = { ...(block.props as Record<string, unknown>) };
    const originalX = metrics[idx].x;
    const originalWidth = metrics[idx].width;
    const normalizedX = Math.round((originalX - minLeft) * scale);
    const normalizedWidth = Math.max(120, Math.min(availableWidth, Math.round(originalWidth * scale)));
    props.blockOffsetX = normalizedX;
    props.blockWidth = normalizedWidth;
    if (typeof props.fontSize === "number" && Number.isFinite(props.fontSize)) {
      props.fontSize = Math.max(10, Math.round(Number(props.fontSize) * scale));
    }
    if (typeof props.galleryFrameWidth === "number" && Number.isFinite(props.galleryFrameWidth)) {
      props.galleryFrameWidth = Math.max(120, Math.min(availableWidth, Math.round(Number(props.galleryFrameWidth) * scale)));
    }
    if (Array.isArray(props.commonTextBoxes)) {
      props.commonTextBoxes = props.commonTextBoxes.map((item) => {
        const box = { ...(item as Record<string, unknown>) };
        if (typeof box.x === "number" && Number.isFinite(box.x)) box.x = Math.round(Number(box.x) * scale);
        if (typeof box.width === "number" && Number.isFinite(box.width)) {
          box.width = Math.max(60, Math.round(Number(box.width) * scale));
        }
        if (typeof box.height === "number" && Number.isFinite(box.height)) {
          box.height = Math.max(40, Math.round(Number(box.height) * scale));
        }
        return box;
      });
    }
    return {
      ...block,
      props: props as never,
    } as Block;
  });
}

function adaptPlanConfigForMobile(config: PagePlanConfig): PagePlanConfig {
  return {
    ...config,
    plans: config.plans.map((plan) => ({
      ...plan,
      blocks: fitBlocksIntoMobileWidth(plan.blocks.map(adaptBlockForMobile)),
      pages: plan.pages.map((page) => ({
        ...page,
        blocks: fitBlocksIntoMobileWidth(page.blocks.map(adaptBlockForMobile)),
      })),
    })),
  };
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

function getFirstNavBlock(blocks: Block[]) {
  return blocks.find((item) => item.type === "nav") ?? null;
}

function stripNavBlocks(blocks: Block[]) {
  return blocks.filter((item) => item.type !== "nav");
}

function hasNavBlock(blocks: Block[]) {
  return blocks.some((item) => item.type === "nav");
}

function getNavSyncKey(blocks: Block[]) {
  const nav = getFirstNavBlock(blocks);
  if (!nav || nav.type !== "nav") return "";
  const items = Array.isArray(nav.props.navItems)
    ? nav.props.navItems.map((item) => ({
        pageId: typeof item?.pageId === "string" ? item.pageId : "",
        label: typeof item?.label === "string" ? item.label : "",
      }))
    : [];
  return JSON.stringify(items);
}

function normalizeBlockWidth(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(MIN_BLOCK_WIDTH, Math.round(value));
}

function normalizeBlockHeight(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(MIN_BLOCK_HEIGHT, Math.round(value));
}

function getBlockTypeLabel(type: string) {
  return (BLOCK_TYPE_LABELS as Record<string, string>)[type] ?? type;
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

function toRgba(hex: string, alpha: number) {
  const value = /^#([0-9a-fA-F]{6})$/.test(hex) ? hex : "#ffffff";
  const r = Number.parseInt(value.slice(1, 3), 16);
  const g = Number.parseInt(value.slice(3, 5), 16);
  const b = Number.parseInt(value.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

function normalizeHexColor(value: string) {
  const trimmed = value.trim();
  return /^#([0-9a-fA-F]{6})$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

function buildLinearGradient(direction: GradientDirection, start: string, end: string) {
  const startHex = normalizeHexColor(start) ?? "#ffffff";
  const endHex = normalizeHexColor(end) ?? "#000000";
  return `linear-gradient(${direction}, ${startHex} 0%, ${endHex} 100%)`;
}

function parseGradientValue(value: string | undefined) {
  const raw = (value ?? "").trim();
  const solidHex = normalizeHexColor(raw);
  if (solidHex) {
    return {
      mode: "solid" as const,
      solidColor: solidHex,
      startColor: solidHex,
      endColor: "#000000",
      direction: "to right" as GradientDirection,
    };
  }

  const gradientMatch = raw.match(
    /^linear-gradient\(\s*(to\s+(?:left|right|top|bottom)(?:\s+(?:left|right|top|bottom))?)\s*,\s*(#[0-9a-fA-F]{6})(?:\s+\d+%?)?\s*,\s*(#[0-9a-fA-F]{6})(?:\s+\d+%?)?\s*\)$/i,
  );
  if (gradientMatch) {
    const parsedDirection = gradientMatch[1].toLowerCase() as GradientDirection;
    const direction = GRADIENT_DIRECTION_OPTIONS.some((item) => item.value === parsedDirection)
      ? parsedDirection
      : "to right";
    return {
      mode: "gradient" as const,
      solidColor: "#ffffff",
      startColor: gradientMatch[2].toLowerCase(),
      endColor: gradientMatch[3].toLowerCase(),
      direction,
    };
  }

  return {
    mode: "solid" as const,
    solidColor: "#ffffff",
    startColor: "#ffffff",
    endColor: "#000000",
    direction: "to right" as GradientDirection,
  };
}

function normalizeRecentColorToken(value: string) {
  const hex = normalizeHexColor(value);
  if (hex) return hex;
  const trimmed = value.trim();
  if (/^linear-gradient\(/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function isGradientToken(value: string) {
  return /^linear-gradient\(/i.test(value.trim());
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

function loadRecentColors(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_COLORS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => (typeof item === "string" ? normalizeRecentColorToken(item) : null))
      .filter((item): item is string => !!item)
      .slice(0, MAX_RECENT_COLORS);
  } catch {
    return [];
  }
}

function isInlineDataImageUrl(value: string) {
  return /^data:image\//i.test(value);
}

function ensureSafeImageUrlSize(value: string | undefined) {
  if (!value) return value;
  if (isInlineDataImageUrl(value) && value.length > MAX_ORIGINAL_IMAGE_DATA_URL_LENGTH) {
    throw new Error("图片数据过大，请上传较小图片或使用外链 URL");
  }
  return value;
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("图片读取失败，请重新选择图片后重试"));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(new Error("图片读取失败，请重新选择图片后重试"));
    reader.readAsDataURL(file);
  });
}

async function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片解析失败，请更换图片"));
    image.src = dataUrl;
  });
}

async function compressImageDataUrl(dataUrl: string, options: { maxSide: number; quality: number }): Promise<string> {
  const image = await loadImageFromDataUrl(dataUrl);
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  if (!naturalWidth || !naturalHeight) {
    throw new Error("图片尺寸异常，请更换图片");
  }

  const scale = Math.min(1, options.maxSide / Math.max(naturalWidth, naturalHeight));
  const targetWidth = Math.max(1, Math.round(naturalWidth * scale));
  const targetHeight = Math.max(1, Math.round(naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("图片处理失败，请重试");

  ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
  return canvas.toDataURL("image/webp", options.quality);
}

async function fileToOriginalImageDataUrl(
  file: File,
  options: { maxSide: number; quality: number } = IMAGE_COMPRESSION_OPTIONS.high,
): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("请选择图片文件");
  }
  if (file.size > MAX_IMAGE_FILE_BYTES) {
    throw new Error("图片文件过大，请选择 10MB 以内图片");
  }

  const dataUrl = await fileToDataUrl(file);
  if (dataUrl.length <= MAX_ORIGINAL_IMAGE_DATA_URL_LENGTH) return dataUrl;

  const compressedDataUrl = await compressImageDataUrl(dataUrl, options);
  if (compressedDataUrl.length > MAX_ORIGINAL_IMAGE_DATA_URL_LENGTH) {
    throw new Error("图片过大，请更换更小分辨率图片");
  }
  return compressedDataUrl;
}

async function fileToAudioDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("audio/")) {
    throw new Error("请选择音频文件");
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("音频读取失败，请重试"));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(new Error("音频读取失败，请重试"));
    reader.readAsDataURL(file);
  });
  if (dataUrl.length > MAX_AUDIO_DATA_URL_LENGTH) {
    throw new Error("音频文件过大，请选择较小文件");
  }
  return dataUrl;
}

function parseImageDataUrlMeta(dataUrl: string) {
  const matched = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/i);
  if (!matched) return null;
  const mime = matched[1].toLowerCase();
  const extension = (() => {
    if (mime === "image/jpeg") return "jpg";
    if (mime === "image/png") return "png";
    if (mime === "image/webp") return "webp";
    if (mime === "image/gif") return "gif";
    if (mime === "image/bmp") return "bmp";
    if (mime === "image/svg+xml") return "svg";
    return "img";
  })();
  return { mime, extension, prefixLength: matched[0].length };
}

function dataUrlToBlob(dataUrl: string, mime: string) {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

async function uploadImageDataUrlToSupabase(dataUrl: string, merchantHint = "public"): Promise<string | null> {
  const meta = parseImageDataUrlMeta(dataUrl);
  if (!meta) return null;
  const blob = dataUrlToBlob(dataUrl, meta.mime);
  const now = new Date();
  const yyyy = `${now.getFullYear()}`;
  const mm = `${now.getMonth() + 1}`.padStart(2, "0");
  const bucketCandidates = ["page-assets", "assets", "uploads", "public"];

  for (const bucket of bucketCandidates) {
    const objectPath = `merchant-assets/${merchantHint}/${yyyy}/${mm}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${meta.extension}`;
    const uploaded = await supabase.storage.from(bucket).upload(objectPath, blob, {
      contentType: meta.mime,
      upsert: false,
    });
    if (uploaded.error) continue;
    const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
    if (data?.publicUrl) return data.publicUrl;
  }
  return null;
}

type PageBackgroundPatch = Pick<
  BackgroundEditableProps,
  | "pageBgImageUrl"
  | "pageBgFillMode"
  | "pageBgPosition"
  | "pageBgColor"
  | "pageBgOpacity"
  | "pageBgImageOpacity"
  | "pageBgColorOpacity"
>;
type SaveErrorLike = { message: string } | null;
type CenterDialog =
  | {
      type: "alert";
      title: string;
      message: string;
      resolve: () => void;
    }
  | {
      type: "confirm";
      title: string;
      message: string;
      resolve: (confirmed: boolean) => void;
    }
  | {
      type: "compression-preset";
      title: string;
      message: string;
      currentPreset: UploadCompressionPreset;
      resolve: (preset: UploadCompressionPreset | null) => void;
    };
type EditorSnapshot = {
  previewViewport: ViewportKey;
  viewportStates: Record<ViewportKey, ViewportEditorState>;
};
type ViewportEditorState = {
  planConfig: PagePlanConfig;
  editingPlanId: PlanId;
  editingPageId: string;
  blocks: Block[];
  selectedId: string;
};

let pagesSlugColumnSupported: boolean | null = null;
let pagesUpdatedAtColumnSupported: boolean | null = null;

function isMissingSlugColumn(message: string) {
  return (
    /column\s+pages\.slug\s+does\s+not\s+exist/i.test(message) ||
    /could not find the ['"]slug['"] column of ['"]pages['"] in the schema cache/i.test(message)
  );
}

function isMissingUpdatedAtColumn(message: string) {
  return (
    /column\s+pages\.updated_at\s+does\s+not\s+exist/i.test(message) ||
    /could not find the ['"]updated_at['"] column of ['"]pages['"] in the schema cache/i.test(message)
  );
}

function normalizeSaveErrorMessage(message: string) {
  return message.replace(/^保存失败[:：]\s*/u, "");
}

function estimateUtf8Size(value: string) {
  return new TextEncoder().encode(value).length;
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

type LargeStringField = {
  path: string;
  bytes: number;
};

function collectLargeStringFields(
  value: unknown,
  path: string,
  output: LargeStringField[],
  minBytes = 50 * 1024,
) {
  if (typeof value === "string") {
    const bytes = estimateUtf8Size(value);
    if (bytes >= minBytes) output.push({ path, bytes });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectLargeStringFields(item, `${path}[${index}]`, output, minBytes);
    });
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
      collectLargeStringFields(child, `${path}.${key}`, output, minBytes);
    });
  }
}

function getPublishSizeBreakdown(blocks: Block[]) {
  const largeFields: LargeStringField[] = [];
  const blockTotals = blocks.map((block, index) => {
    const blockPath = `blocks[${index}](${block.type}:${block.id})`;
    collectLargeStringFields(block, blockPath, largeFields);
    return {
      path: blockPath,
      bytes: estimateUtf8Size(JSON.stringify(block)),
    };
  });

  largeFields.sort((a, b) => b.bytes - a.bytes);
  blockTotals.sort((a, b) => b.bytes - a.bytes);
  return {
    largeFields: largeFields.slice(0, 12),
    blockTotals: blockTotals.slice(0, 8),
  };
}

type PublishDiffSummary = {
  changedCount: number;
  addedCount: number;
  removedCount: number;
  changedPaths: string[];
};

function computePublishDiffSummary(nextBlocks: Block[], previousBlocks: Block[]): PublishDiffSummary {
  const toKey = (block: Block) => `${block.type}:${block.id}`;
  const previousMap = new Map(previousBlocks.map((block) => [toKey(block), JSON.stringify(block)]));
  const nextMap = new Map(nextBlocks.map((block) => [toKey(block), JSON.stringify(block)]));
  let changedCount = 0;
  let addedCount = 0;
  let removedCount = 0;
  const changedPaths: string[] = [];

  nextBlocks.forEach((block, index) => {
    const key = toKey(block);
    const before = previousMap.get(key);
    if (!before) {
      addedCount += 1;
      changedPaths.push(`blocks[${index}](${key})`);
      return;
    }
    const after = nextMap.get(key);
    if (before !== after) {
      changedCount += 1;
      changedPaths.push(`blocks[${index}](${key})`);
    }
  });

  previousBlocks.forEach((block) => {
    if (!nextMap.has(toKey(block))) removedCount += 1;
  });

  return { changedCount, addedCount, removedCount, changedPaths: changedPaths.slice(0, 8) };
}

type PublishPreflightResult = {
  errors: string[];
  warnings: string[];
};

function runPublishPreflight(blocks: Block[], payloadBytes: number): PublishPreflightResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (payloadBytes > MAX_PUBLISH_PAYLOAD_BYTES) {
    warnings.push(`发布体积接近或超过上限：${formatBytes(payloadBytes)} / ${formatBytes(MAX_PUBLISH_PAYLOAD_BYTES)}`);
  }

  let inlineImageCount = 0;
  let inlineAudioCount = 0;
  let maybeBrokenLinkCount = 0;

  const visit = (value: unknown) => {
    if (typeof value === "string") {
      if (/^data:image\//i.test(value)) inlineImageCount += 1;
      if (/^data:audio\//i.test(value)) inlineAudioCount += 1;
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach(visit);
    }
  };
  visit(blocks);

  blocks.forEach((block) => {
    if (block.type === "gallery" && (!Array.isArray(block.props.images) || block.props.images.length === 0)) {
      warnings.push(`相册区块为空：${block.id}`);
    }
    if (block.type === "music" && !((block.props.audioUrl ?? "").trim())) {
      warnings.push(`音乐区块未设置音频：${block.id}`);
    }
    if (block.type === "chart" && (block.props.labels?.length ?? 0) !== (block.props.values?.length ?? 0)) {
      warnings.push(`图表标签和值数量不一致：${block.id}`);
    }
    if (block.type === "contact") {
      const email = (block.props.email ?? "").trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) maybeBrokenLinkCount += 1;
      const instagram = (block.props.instagram ?? "").trim();
      if (instagram && /\s/.test(instagram)) maybeBrokenLinkCount += 1;
      const tiktok = (block.props.tiktok ?? "").trim();
      if (tiktok && /\s/.test(tiktok)) maybeBrokenLinkCount += 1;
    }
  });

  if (inlineImageCount >= 24) warnings.push(`内嵌图片较多：${inlineImageCount} 张，建议外链或批量压缩`);
  if (inlineAudioCount >= 2) warnings.push(`内嵌音频较多：${inlineAudioCount} 个，建议外链`);
  if (maybeBrokenLinkCount > 0) warnings.push(`检测到 ${maybeBrokenLinkCount} 条联系方式可能无法跳转`);

  return { errors, warnings };
}

type RecompressStats = {
  visited: number;
  changed: number;
  failed: number;
  beforeBytes: number;
  afterBytes: number;
};

type ExternalizeStats = {
  visited: number;
  replaced: number;
  failed: number;
  beforeBytes: number;
  afterBytes: number;
};

async function recompressInlineImagesUnknown(
  input: unknown,
  options: { maxSide: number; quality: number },
  stats: RecompressStats,
): Promise<unknown> {
  if (typeof input === "string") {
    if (!/^data:image\//i.test(input)) return input;
    stats.visited += 1;
    const beforeBytes = estimateUtf8Size(input);
    stats.beforeBytes += beforeBytes;
    try {
      const compressed = await compressImageDataUrl(input, options);
      const output = compressed.length > 0 ? compressed : input;
      const afterBytes = estimateUtf8Size(output);
      stats.afterBytes += afterBytes;
      if (output !== input) stats.changed += 1;
      return output;
    } catch {
      stats.failed += 1;
      stats.afterBytes += beforeBytes;
      return input;
    }
  }

  if (Array.isArray(input)) {
    const next: unknown[] = [];
    for (const item of input) {
      next.push(await recompressInlineImagesUnknown(item, options, stats));
    }
    return next;
  }

  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    const nextRecord: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      nextRecord[key] = await recompressInlineImagesUnknown(value, options, stats);
    }
    return nextRecord;
  }

  return input;
}

async function recompressInlineImagesInBlocks(
  blocks: Block[],
  options: { maxSide: number; quality: number },
): Promise<{ blocks: Block[]; stats: RecompressStats }> {
  const stats: RecompressStats = {
    visited: 0,
    changed: 0,
    failed: 0,
    beforeBytes: 0,
    afterBytes: 0,
  };
  const next = (await recompressInlineImagesUnknown(blocks, options, stats)) as Block[];
  return { blocks: next, stats };
}

async function externalizeInlineImagesUnknown(
  input: unknown,
  merchantHint: string,
  stats: ExternalizeStats,
): Promise<unknown> {
  if (typeof input === "string") {
    if (!/^data:image\//i.test(input)) return input;
    const bytes = estimateUtf8Size(input);
    if (bytes < EXTERNALIZE_MIN_IMAGE_BYTES) return input;
    stats.visited += 1;
    stats.beforeBytes += bytes;
    try {
      const url = await uploadImageDataUrlToSupabase(input, merchantHint);
      if (!url) {
        stats.failed += 1;
        stats.afterBytes += bytes;
        return input;
      }
      stats.replaced += 1;
      const after = estimateUtf8Size(url);
      stats.afterBytes += after;
      return url;
    } catch {
      stats.failed += 1;
      stats.afterBytes += bytes;
      return input;
    }
  }
  if (Array.isArray(input)) {
    const next: unknown[] = [];
    for (const item of input) {
      next.push(await externalizeInlineImagesUnknown(item, merchantHint, stats));
    }
    return next;
  }
  if (input && typeof input === "object") {
    const nextRecord: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      nextRecord[key] = await externalizeInlineImagesUnknown(value, merchantHint, stats);
    }
    return nextRecord;
  }
  return input;
}

async function externalizeInlineImagesInBlocks(blocks: Block[], merchantHint: string) {
  const stats: ExternalizeStats = {
    visited: 0,
    replaced: 0,
    failed: 0,
    beforeBytes: 0,
    afterBytes: 0,
  };
  const next = (await externalizeInlineImagesUnknown(blocks, merchantHint, stats)) as Block[];
  return { blocks: next, stats };
}

function sumDailyValues(stats: Record<string, number>, days: number, now = new Date()) {
  let total = 0;
  for (let i = 0; i < days; i += 1) {
    const date = new Date(now);
    date.setDate(now.getDate() - i);
    const key = `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
    total += stats[key] ?? 0;
  }
  return total;
}

async function resolveMerchantIds(sessionUserId?: string, email?: string, metadata?: Record<string, unknown>): Promise<string[]> {
  const ids: string[] = [];
  const pushId = (value: unknown) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed) return;
    if (!ids.includes(trimmed)) ids.push(trimmed);
  };

  pushId(sessionUserId);
  pushId(metadata?.merchant_id);
  pushId(metadata?.merchantId);
  pushId(metadata?.merchantID);
  pushId(metadata?.store_id);
  pushId(metadata?.storeId);
  pushId(metadata?.shop_id);
  pushId(metadata?.shopId);

  if (!sessionUserId) return ids;

  const lookupColumns = [
    "user_id",
    "auth_user_id",
    "owner_user_id",
    "owner_id",
    "auth_id",
    "created_by",
    "created_by_user_id",
  ];
  for (const column of lookupColumns) {
    const result = await supabase.from("merchants").select("id").eq(column, sessionUserId).limit(1).maybeSingle();
    if (!result.error) pushId(result.data?.id);
  }

  const byId = await supabase.from("merchants").select("id").eq("id", sessionUserId).limit(1).maybeSingle();
  if (!byId.error) pushId(byId.data?.id);

  if (email) {
    const emailColumns = ["email", "owner_email", "contact_email", "user_email"];
    for (const column of emailColumns) {
      const byEmail = await supabase.from("merchants").select("id").eq(column, email).limit(1).maybeSingle();
      if (!byEmail.error) pushId(byEmail.data?.id);
    }
  }

  const fallbackRow = await supabase.from("merchants").select("id").limit(1).maybeSingle();
  if (!fallbackRow.error) {
    pushId(fallbackRow.data?.id);
  }

  return ids;
}

async function loadBlocksFromSupabaseFallback(merchantIds: string[]) {
  if (pagesSlugColumnSupported !== false) {
    const bySlug = await supabase.from("pages").select("blocks").eq("slug", "home").single();
    if (!bySlug.error && bySlug.data?.blocks && Array.isArray(bySlug.data.blocks)) {
      pagesSlugColumnSupported = true;
      return sanitizeBlocksForRuntime(bySlug.data.blocks as Block[]).blocks;
    }

    if (!bySlug.error || !isMissingSlugColumn(bySlug.error.message)) {
      return null;
    }
    pagesSlugColumnSupported = false;
  }

  for (const merchantId of merchantIds) {
    const byMerchant = await supabase
      .from("pages")
      .select("blocks")
      .eq("merchant_id", merchantId)
      .limit(1)
      .maybeSingle();
    if (!byMerchant.error && byMerchant.data?.blocks && Array.isArray(byMerchant.data.blocks)) {
      return sanitizeBlocksForRuntime(byMerchant.data.blocks as Block[]).blocks;
    }
  }

  const byFirstRow = await supabase.from("pages").select("blocks").limit(1).maybeSingle();
  if (!byFirstRow.error && byFirstRow.data?.blocks && Array.isArray(byFirstRow.data.blocks)) {
    return sanitizeBlocksForRuntime(byFirstRow.data.blocks as Block[]).blocks;
  }
  return null;
}

async function saveBlocksToSupabaseFallback(
  payload: { blocks: Block[]; updated_at: string },
  merchantIds: string[],
): Promise<SaveErrorLike> {
  const sanitizedBlocks = sanitizeBlocksForRuntime(payload.blocks).blocks;

  async function trySaveWithPayload(sanitizedPayload: { blocks: Block[]; updated_at?: string }): Promise<SaveErrorLike> {
    if (pagesSlugColumnSupported !== false) {
      const bySlug = await supabase.from("pages").update(sanitizedPayload).eq("slug", "home");
      if (!bySlug.error) {
        pagesSlugColumnSupported = true;
        return null;
      }
      if (!isMissingSlugColumn(bySlug.error.message)) return bySlug.error;
      pagesSlugColumnSupported = false;
    }

    for (const merchantId of merchantIds) {
      const byMerchant = await supabase
        .from("pages")
        .select("id")
        .eq("merchant_id", merchantId)
        .limit(1)
        .maybeSingle();
      if (byMerchant.error) continue;

      if (byMerchant.data?.id !== undefined && byMerchant.data?.id !== null) {
        const byId = await supabase.from("pages").update(sanitizedPayload).eq("id", byMerchant.data.id);
        if (!byId.error) return null;
        return byId.error;
      }
    }

    const anyRow = await supabase.from("pages").select("id").limit(1).maybeSingle();
    if (anyRow.error) return anyRow.error;
    const targetId = anyRow.data?.id;
    if (targetId === undefined || targetId === null) {
      const initErrors: string[] = [];

      for (const merchantId of merchantIds) {
        const withSlug = await supabase.from("pages").insert({
          ...sanitizedPayload,
          merchant_id: merchantId,
          slug: "home",
        });
        if (!withSlug.error) return null;
        initErrors.push(`pages 初始化(含 slug)失败(${merchantId}): ${withSlug.error.message}`);

        if (isMissingSlugColumn(withSlug.error.message)) {
          const withoutSlug = await supabase.from("pages").insert({
            ...sanitizedPayload,
            merchant_id: merchantId,
          });
          if (!withoutSlug.error) return null;
          initErrors.push(`pages 初始化(不含 slug)失败(${merchantId}): ${withoutSlug.error.message}`);
        }

        // Fallback: let DB default/trigger populate merchant_id when explicit id is invalid.
        const autoMerchantWithSlug = await supabase.from("pages").insert({
          ...sanitizedPayload,
          slug: "home",
        });
        if (!autoMerchantWithSlug.error) return null;
        initErrors.push(`pages 初始化(自动 merchant_id, 含 slug)失败(${merchantId}): ${autoMerchantWithSlug.error.message}`);

        if (isMissingSlugColumn(autoMerchantWithSlug.error.message)) {
          const autoMerchantWithoutSlug = await supabase.from("pages").insert(sanitizedPayload);
          if (!autoMerchantWithoutSlug.error) return null;
          initErrors.push(
            `pages 初始化(自动 merchant_id, 不含 slug)失败(${merchantId}): ${autoMerchantWithoutSlug.error.message}`,
          );
        }
      }

      return {
        message:
          initErrors.length > 0
            ? `未找到可更新的 pages 记录，自动初始化失败。${initErrors.join("；")}`
            : "未找到可更新的 pages 记录，且自动初始化失败。",
      };
    }

    const byId = await supabase.from("pages").update(sanitizedPayload).eq("id", targetId);
    return byId.error ?? null;
  }

  const withUpdatedAt = { blocks: sanitizedBlocks, updated_at: payload.updated_at };
  if (pagesUpdatedAtColumnSupported !== false) {
    const first = await trySaveWithPayload(withUpdatedAt);
    if (!first) {
      pagesUpdatedAtColumnSupported = true;
      return null;
    }
    if (!isMissingUpdatedAtColumn(first.message)) return first;
    pagesUpdatedAtColumnSupported = false;
  }

  return trySaveWithPayload({ blocks: sanitizedBlocks });
}

export default function AdminClient() {
  const initialPlanConfig = getPagePlanConfigFromBlocks(homeBlocks);
  const initialMobilePlanConfig =
    getEmbeddedMobilePlanConfig(homeBlocks) ?? adaptPlanConfigForMobile(JSON.parse(JSON.stringify(initialPlanConfig)) as PagePlanConfig);
  const initialEditingPlanId = initialPlanConfig.activePlanId;
  const initialEditingPageId =
    initialPlanConfig.plans.find((plan) => plan.id === initialEditingPlanId)?.activePageId ?? "page-1";
  const initialBlocks = cloneBlocks(
    getBlocksForPage(
      initialPlanConfig.plans.find((plan) => plan.id === initialEditingPlanId) ?? initialPlanConfig.plans[0],
      initialEditingPageId,
    ),
  );
  const [planConfig, setPlanConfig] = useState<PagePlanConfig>(initialPlanConfig);
  const [editingPlanId, setEditingPlanId] = useState<PlanId>(initialEditingPlanId);
  const [editingPageId, setEditingPageId] = useState<string>(initialEditingPageId);
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
  const [selectedId, setSelectedId] = useState<string>(initialBlocks[0]?.id ?? "");
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const dragStartRef = useRef<{
    blockId: string;
    blockIds: string[];
    pointerX: number;
    pointerY: number;
    startOffsets: Record<string, { x: number; y: number }>;
    historyRecorded: boolean;
  } | null>(null);
  const blocksRef = useRef<Block[]>(initialBlocks);
  const [newBlockType, setNewBlockType] = useState<Block["type"]>("common");
  const [previewViewport, setPreviewViewport] = useState<"desktop" | "mobile">("desktop");
  const [tip, setTip] = useState<string>("");
  const tipDurationMsRef = useRef<number | null>(DEFAULT_TIP_DURATION_MS);
  const tipDismissByPointerRef = useRef<boolean>(true);
  const [dialog, setDialog] = useState<CenterDialog | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [topBarCollapsed, setTopBarCollapsed] = useState(false);
  const topBarRef = useRef<HTMLDivElement>(null);
  const [topBarHeight, setTopBarHeight] = useState(0);
  const [uploadCompressionPreset, setUploadCompressionPreset] = useState<UploadCompressionPreset>("high");
  const [themePreset, setThemePreset] = useState<ThemePresetKey>("none");
  const pageImageInputRef = useRef<HTMLInputElement>(null);
  const [pageImageDialogOpen, setPageImageDialogOpen] = useState(false);
  const [pageImageUrlInput, setPageImageUrlInput] = useState("");
  const [pageImageSettingsOpen, setPageImageSettingsOpen] = useState(false);
  const [pageSettingsFillMode, setPageSettingsFillMode] = useState<ImageFillMode>("cover");
  const [pageSettingsPosition, setPageSettingsPosition] = useState("center");
  const [pageSettingsColor, setPageSettingsColor] = useState("");
  const [pageSettingsImageOpacity, setPageSettingsImageOpacity] = useState(1);
  const [pageSettingsColorOpacity, setPageSettingsColorOpacity] = useState(1);
  const [recentColors, setRecentColors] = useState<string[]>([]);
  const [resizePreview, setResizePreview] = useState<{ blockId: string; heightDelta: number } | null>(null);
  const selectedIdRef = useRef(selectedId);
  const planConfigRef = useRef(planConfig);
  const editingPlanIdRef = useRef(editingPlanId);
  const editingPageIdRef = useRef(editingPageId);
  const undoStackRef = useRef<EditorSnapshot[]>([]);
  const redoStackRef = useRef<EditorSnapshot[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const merchantIdsRef = useRef<string[]>([]);
  const themeBaseBlocksByPageRef = useRef<Map<string, Block[]>>(new Map());
  const backgroundLayerRef = useRef<HTMLDivElement>(null);
  const [backgroundLayerMinHeight, setBackgroundLayerMinHeight] = useState(0);
  const applyPersistedBlocksToEditorRef = useRef<(loaded: Block[], options?: { resetHistory?: boolean }) => void>(() => {});
  const recordDragHistoryRef = useRef<() => void>(() => {});
  const persistDraggingDraftRef = useRef<() => void>(() => {});
  const viewportStatesRef = useRef<Record<ViewportKey, ViewportEditorState>>({
    desktop: {
      planConfig: JSON.parse(JSON.stringify(initialPlanConfig)) as PagePlanConfig,
      editingPlanId: initialEditingPlanId,
      editingPageId: initialEditingPageId,
      blocks: cloneBlocks(initialBlocks),
      selectedId: initialBlocks[0]?.id ?? "",
    },
    mobile: {
      planConfig: JSON.parse(JSON.stringify(initialMobilePlanConfig)) as PagePlanConfig,
      editingPlanId: initialMobilePlanConfig.activePlanId,
      editingPageId:
        initialMobilePlanConfig.plans.find((plan) => plan.id === initialMobilePlanConfig.activePlanId)?.activePageId ?? "page-1",
      blocks: cloneBlocks(
        getBlocksForPage(
          initialMobilePlanConfig.plans.find((plan) => plan.id === initialMobilePlanConfig.activePlanId) ??
            initialMobilePlanConfig.plans[0],
          initialMobilePlanConfig.plans.find((plan) => plan.id === initialMobilePlanConfig.activePlanId)?.activePageId ?? "page-1",
        ),
      ),
      selectedId:
        getBlocksForPage(
          initialMobilePlanConfig.plans.find((plan) => plan.id === initialMobilePlanConfig.activePlanId) ??
            initialMobilePlanConfig.plans[0],
          initialMobilePlanConfig.plans.find((plan) => plan.id === initialMobilePlanConfig.activePlanId)?.activePageId ?? "page-1",
        )[0]?.id ?? "",
    },
  });

  function recordRecentColor(value: string) {
    const normalized = normalizeRecentColorToken(value);
    if (!normalized) return;
    setRecentColors((prev) => {
      const next = [normalized, ...prev.filter((item) => item !== normalized)].slice(0, MAX_RECENT_COLORS);
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(next));
        } catch {
          // ignore storage write failures
        }
      }
      return next;
    });
  }

  function showTip(message: string, options?: { durationMs?: number | null; dismissOnPointer?: boolean }) {
    tipDurationMsRef.current = options?.durationMs ?? DEFAULT_TIP_DURATION_MS;
    tipDismissByPointerRef.current = options?.dismissOnPointer ?? true;
    setTip(message);
  }

  function showSavePublishTip(message: string) {
    showTip(message, {
      durationMs: SAVE_PUBLISH_TIP_DURATION_MS,
      dismissOnPointer: false,
    });
  }

  function showPublishFailedTip(message: string) {
    showTip(message, {
      durationMs: null,
      dismissOnPointer: true,
    });
  }

  function getCurrentImageCompressionOptions() {
    return IMAGE_COMPRESSION_OPTIONS[uploadCompressionPreset] ?? IMAGE_COMPRESSION_OPTIONS.high;
  }

  function clearRecentColors() {
    setRecentColors([]);
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem(RECENT_COLORS_KEY);
      } catch {
        // ignore storage write failures
      }
    }
  }

  function clonePlanConfig(source: PagePlanConfig): PagePlanConfig {
    if (typeof structuredClone === "function") {
      return structuredClone(source) as PagePlanConfig;
    }
    return JSON.parse(JSON.stringify(source)) as PagePlanConfig;
  }

  function buildCombinedPersistedBlocks(desktopConfig: PagePlanConfig, mobileConfig: PagePlanConfig) {
    const desktopBlocks = buildPersistedBlocksFromPlanConfig(desktopConfig);
    const mobileBlocks = buildPersistedBlocksFromPlanConfig(mobileConfig);
    const mobileRaw = (mobileBlocks[0]?.props as { pagePlanConfig?: unknown } | undefined)?.pagePlanConfig;
    if (desktopBlocks[0] && mobileRaw) {
      desktopBlocks[0] = {
        ...desktopBlocks[0],
        props: {
          ...desktopBlocks[0].props,
          pagePlanConfigMobile: mobileRaw as never,
        } as never,
      } as Block;
    }
    return desktopBlocks;
  }

  function isBlockLocked(block: Block | undefined) {
    return block?.props?.blockLocked === true;
  }

  function applyPersistedBlocksToEditor(loaded: Block[], options?: { resetHistory?: boolean }) {
    const loadedPlanConfig = getPagePlanConfigFromBlocks(loaded);
    const loadedMobilePlanConfig = getEmbeddedMobilePlanConfig(loaded) ?? adaptPlanConfigForMobile(clonePlanConfig(loadedPlanConfig));

    const loadedEditingPlanId = loadedPlanConfig.activePlanId;
    const loadedEditingPageId = loadedPlanConfig.plans.find((plan) => plan.id === loadedEditingPlanId)?.activePageId ?? "page-1";
    const desktopBlocks = cloneBlocks(
      getBlocksForPage(loadedPlanConfig.plans.find((plan) => plan.id === loadedEditingPlanId) ?? loadedPlanConfig.plans[0], loadedEditingPageId),
    );

    const mobilePlanId = loadedMobilePlanConfig.activePlanId;
    const mobilePageId = loadedMobilePlanConfig.plans.find((plan) => plan.id === mobilePlanId)?.activePageId ?? "page-1";
    const mobileBlocks = cloneBlocks(
      getBlocksForPage(loadedMobilePlanConfig.plans.find((plan) => plan.id === mobilePlanId) ?? loadedMobilePlanConfig.plans[0], mobilePageId),
    );

    viewportStatesRef.current.desktop = {
      planConfig: clonePlanConfig(loadedPlanConfig),
      editingPlanId: loadedEditingPlanId,
      editingPageId: loadedEditingPageId,
      blocks: cloneBlocks(desktopBlocks),
      selectedId: desktopBlocks[0]?.id ?? "",
    };
    viewportStatesRef.current.mobile = {
      planConfig: clonePlanConfig(loadedMobilePlanConfig),
      editingPlanId: mobilePlanId,
      editingPageId: mobilePageId,
      blocks: cloneBlocks(mobileBlocks),
      selectedId: mobileBlocks[0]?.id ?? "",
    };

    const target = previewViewport === "desktop" ? viewportStatesRef.current.desktop : viewportStatesRef.current.mobile;
    setPlanConfig(clonePlanConfig(target.planConfig));
    setEditingPlanId(target.editingPlanId);
    setEditingPageId(target.editingPageId);
    setBlocks(cloneBlocks(target.blocks));
    setSelectedId(target.selectedId || target.blocks[0]?.id || "");

    const combinedLoaded = buildCombinedPersistedBlocks(loadedPlanConfig, loadedMobilePlanConfig);
    saveBlocksToStorage(combinedLoaded);
    themeBaseBlocksByPageRef.current.clear();
    if (options?.resetHistory !== false) {
      undoStackRef.current = [];
      redoStackRef.current = [];
      syncHistoryFlags();
    }
  }

  function toggleSelectedBlockLock() {
    const id = selectedIdRef.current;
    if (!id) {
      showTip("请先选中一个区块");
      return;
    }
    const index = blocksRef.current.findIndex((block) => block.id === id);
    if (index < 0) return;
    const target = blocksRef.current[index];
    const next = [...blocksRef.current];
    next[index] = {
      ...target,
      props: {
        ...target.props,
        blockLocked: !isBlockLocked(target),
      } as never,
    } as Block;
    applyBlocks(next, { selectedId: id });
    showTip(isBlockLocked(target) ? "已解锁区块" : "已锁定区块");
  }

  function copySelectedBlockStyleToViewport(targetViewport: ViewportKey) {
    const id = selectedIdRef.current;
    if (!id) {
      showTip("请先选中一个区块");
      return;
    }
    const sourceBlock = blocksRef.current.find((item) => item.id === id);
    if (!sourceBlock) return;
    const targetState = viewportStatesRef.current[targetViewport];
    const targetIndex = targetState.blocks.findIndex((item) => item.id === id);
    if (targetIndex < 0) {
      showTip("目标端未找到同名区块");
      return;
    }
    pushUndoSnapshot(createSnapshot());
    const stylePatch: Record<string, unknown> = {};
    STYLE_SYNC_KEYS.forEach((key) => {
      const value = (sourceBlock.props as Record<string, unknown>)[key];
      if (typeof value !== "undefined") stylePatch[key] = value;
    });
    const nextBlocks = cloneBlocks(targetState.blocks);
    nextBlocks[targetIndex] = {
      ...nextBlocks[targetIndex],
      props: {
        ...nextBlocks[targetIndex].props,
        ...stylePatch,
      } as never,
    } as Block;
    const targetPlan = targetState.planConfig.plans.find((plan) => plan.id === targetState.editingPlanId) ?? targetState.planConfig.plans[0];
    const nextPlan = setBlocksForPage(
      { ...targetPlan, activePageId: targetState.editingPageId },
      targetState.editingPageId,
      nextBlocks,
    );
    const nextPlanConfig: PagePlanConfig = {
      ...targetState.planConfig,
      plans: targetState.planConfig.plans.map((plan) => (plan.id === targetState.editingPlanId ? nextPlan : plan)),
    };
    viewportStatesRef.current[targetViewport] = {
      ...targetState,
      planConfig: nextPlanConfig,
      blocks: nextBlocks,
      selectedId: id,
    };
    if (previewViewport === targetViewport) {
      setPlanConfig(clonePlanConfig(nextPlanConfig));
      setEditingPlanId(targetState.editingPlanId);
      setEditingPageId(targetState.editingPageId);
      setBlocks(cloneBlocks(nextBlocks));
      setSelectedId(id);
    }
    persistDraftForConfigs(previewViewport === targetViewport ? nextPlanConfig : planConfigRef.current);
    showTip(targetViewport === "mobile" ? "已复制样式到手机端" : "已复制样式到PC端");
  }

  function rollbackToLastSuccessfulPublished() {
    const published = loadPublishedBlocksFromStorage(homeBlocks);
    if (!published || published.length === 0) {
      showTip("未找到可回滚的已发布版本");
      return;
    }
    pushUndoSnapshot(createSnapshot());
    applyPersistedBlocksToEditor(published, { resetHistory: false });
    showSavePublishTip("已回滚到上次成功发布版本");
  }

  function restoreLatestFailedSnapshot() {
    const snapshots = readPublishFailureSnapshots();
    if (snapshots.length === 0) {
      showTip("暂无发布失败快照");
      return;
    }
    pushUndoSnapshot(createSnapshot());
    applyPersistedBlocksToEditor(snapshots[0].blocks, { resetHistory: false });
    showSavePublishTip("已恢复最近失败快照");
  }

  async function recompressCurrentPageImages() {
    const options = getCurrentImageCompressionOptions();
    showSavePublishTip("正在重压当前页图片...");
    try {
      const { blocks: nextBlocks, stats } = await recompressInlineImagesInBlocks(blocksRef.current, options);
      if (stats.visited === 0) {
        showTip("当前页没有可重压的内嵌图片");
        return;
      }
      applyBlocks(nextBlocks, { selectedId: selectedIdRef.current || nextBlocks[0]?.id || "" });
      showSavePublishTip(
        `重压完成：${stats.changed}/${stats.visited} 张，${formatBytes(stats.beforeBytes)} -> ${formatBytes(stats.afterBytes)}`,
      );
    } catch (error) {
      showTip(error instanceof Error ? error.message : "重压失败，请重试");
    }
  }

  async function resolveFirstMerchantHint() {
    let merchantIds = merchantIdsRef.current;
    if (merchantIds.length === 0) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      merchantIds = await resolveMerchantIds(session?.user?.id, session?.user?.email, {
        ...(session?.user?.user_metadata ?? {}),
        ...(session?.user?.app_metadata ?? {}),
      });
      merchantIdsRef.current = merchantIds;
    }
    return merchantIds[0] ?? "public";
  }

  async function externalizeCurrentPageLargeImages() {
    showSavePublishTip("正在外链化大图...");
    try {
      const merchantHint = await resolveFirstMerchantHint();
      const { blocks: nextBlocks, stats } = await externalizeInlineImagesInBlocks(blocksRef.current, merchantHint);
      if (stats.visited === 0) {
        showTip(`当前页没有超过 ${formatBytes(EXTERNALIZE_MIN_IMAGE_BYTES)} 的内嵌图片`);
        return;
      }
      applyBlocks(nextBlocks, { selectedId: selectedIdRef.current || nextBlocks[0]?.id || "" });
      showSavePublishTip(
        `外链化完成：${stats.replaced}/${stats.visited} 张，${formatBytes(stats.beforeBytes)} -> ${formatBytes(stats.afterBytes)}`,
      );
    } catch (error) {
      showTip(error instanceof Error ? error.message : "外链化失败，请检查存储配置");
    }
  }

  function getThemeSnapshotKey() {
    return `${previewViewport}:${editingPlanIdRef.current}:${editingPageIdRef.current}`;
  }

  function applyThemePresetToCurrentPage(presetKey: ThemePresetKey) {
    const preset = THEME_PRESETS[presetKey];
    if (!preset) return;
    const snapshotKey = getThemeSnapshotKey();
    if (preset.noop) {
      const snapshot = themeBaseBlocksByPageRef.current.get(snapshotKey);
      if (!snapshot) {
        showSavePublishTip("当前页未应用主题，无需还原");
        return;
      }
      const restored = cloneBlocks(snapshot);
      applyBlocks(restored, { selectedId: selectedIdRef.current || restored[0]?.id || "" });
      themeBaseBlocksByPageRef.current.delete(snapshotKey);
      showSavePublishTip("已清除主题效果，恢复到应用前状态");
      return;
    }
    if (!themeBaseBlocksByPageRef.current.has(snapshotKey)) {
      themeBaseBlocksByPageRef.current.set(snapshotKey, cloneBlocks(blocksRef.current));
    }
    const next = blocksRef.current.map((block, index) => {
      const patch: Record<string, unknown> = {};
      if (preset.fontFamily) patch.fontFamily = preset.fontFamily;
      if (preset.fontColor) patch.fontColor = preset.fontColor;
      if (preset.borderStyle) patch.blockBorderStyle = preset.borderStyle;
      if (preset.borderColor) patch.blockBorderColor = preset.borderColor;
      if (block.type !== "music" && preset.blockBgColor) {
        patch.bgColor = preset.blockBgColor;
        patch.bgImageUrl = undefined;
      }
      if (index === 0 && preset.pageBgColor) {
        patch.pageBgColor = preset.pageBgColor;
      }
      return {
        ...block,
        props: {
          ...block.props,
          ...patch,
        } as never,
      } as Block;
    });
    applyBlocks(next, { selectedId: selectedIdRef.current || next[0]?.id || "" });
    showSavePublishTip(`已应用：${preset.label}`);
  }

  function persistDraftForConfigs(activeConfig: PagePlanConfig) {
    const desktopConfig = previewViewport === "desktop" ? activeConfig : viewportStatesRef.current.desktop.planConfig;
    const mobileConfig = previewViewport === "mobile" ? activeConfig : viewportStatesRef.current.mobile.planConfig;
    saveBlocksToStorage(buildCombinedPersistedBlocks(desktopConfig, mobileConfig));
  }

  function switchPreviewViewport(nextViewport: ViewportKey) {
    if (nextViewport === previewViewport) return;
    viewportStatesRef.current[previewViewport] = {
      planConfig: clonePlanConfig(planConfigRef.current),
      editingPlanId: editingPlanIdRef.current,
      editingPageId: editingPageIdRef.current,
      blocks: cloneBlocks(blocksRef.current),
      selectedId: selectedIdRef.current,
    };
    const target = viewportStatesRef.current[nextViewport];
    setPreviewViewport(nextViewport);
    setPlanConfig(clonePlanConfig(target.planConfig));
    setEditingPlanId(target.editingPlanId);
    setEditingPageId(target.editingPageId);
    setBlocks(cloneBlocks(target.blocks));
    setSelectedId(target.selectedId || target.blocks[0]?.id || "");
  }

  async function readDesktopIntoMobile() {
    const confirmed = await openConfirm("读取 PC 配置将覆盖当前手机配置，是否继续？", "读取PC");
    if (!confirmed) return;
    const desktopConfig = clonePlanConfig(viewportStatesRef.current.desktop.planConfig);
    const mobileConfig = adaptPlanConfigForMobile(desktopConfig);
    const mobilePlanId = mobileConfig.activePlanId;
    const mobilePageId = mobileConfig.plans.find((plan) => plan.id === mobilePlanId)?.activePageId ?? "page-1";
    const mobileBlocks = cloneBlocks(
      getBlocksForPage(
        mobileConfig.plans.find((plan) => plan.id === mobilePlanId) ?? mobileConfig.plans[0],
        mobilePageId,
      ),
    );
    pushUndoSnapshot(createSnapshot());
    viewportStatesRef.current.mobile = {
      planConfig: clonePlanConfig(mobileConfig),
      editingPlanId: mobilePlanId,
      editingPageId: mobilePageId,
      blocks: cloneBlocks(mobileBlocks),
      selectedId: mobileBlocks[0]?.id ?? "",
    };
    if (previewViewport === "mobile") {
      setPlanConfig(clonePlanConfig(mobileConfig));
      setEditingPlanId(mobilePlanId);
      setEditingPageId(mobilePageId);
      setBlocks(cloneBlocks(mobileBlocks));
      setSelectedId(mobileBlocks[0]?.id ?? "");
    }
    persistDraftForConfigs(mobileConfig);
    setTip("已读取PC配置到手机端");
  }

  function mergePlanConfigWithEditingBlocks(
    baseConfig: PagePlanConfig,
    currentEditingPlanId: PlanId,
    currentEditingPageId: string,
    currentBlocks: Block[],
    options?: { syncNavPages?: boolean },
  ): PagePlanConfig {
    const syncNavPages = options?.syncNavPages ?? true;
    const canonicalNavBlock = getFirstNavBlock(currentBlocks);
    const cleanedCurrentBlocks = (() => {
      const withoutNav = stripNavBlocks(currentBlocks);
      return canonicalNavBlock ? [canonicalNavBlock, ...withoutNav] : withoutNav;
    })();

    return {
      ...baseConfig,
      plans: baseConfig.plans.map((plan) => {
        if (plan.id !== currentEditingPlanId) return plan;
        const withCurrentPage = setBlocksForPage(
          {
            ...plan,
            activePageId: currentEditingPageId,
          },
          currentEditingPageId,
          cleanedCurrentBlocks,
        );
        if (!syncNavPages) {
          const activePage =
            withCurrentPage.pages.find((page) => page.id === withCurrentPage.activePageId) ?? withCurrentPage.pages[0];
          return {
            ...withCurrentPage,
            blocks: cloneBlocks(activePage?.blocks ?? withCurrentPage.blocks),
          };
        }

        let syncedPages = withCurrentPage.pages.map((page) => {
          const pageBackgroundPatch = getPageBackgroundPatch(page.blocks[0]);
          const base = stripNavBlocks(page.blocks);
          const navClone = canonicalNavBlock ? cloneBlocks([canonicalNavBlock])[0] : null;
          const rebuiltBlocks = navClone ? [navClone, ...base] : base;
          if (rebuiltBlocks[0]) {
            rebuiltBlocks[0] = {
              ...rebuiltBlocks[0],
              props: { ...rebuiltBlocks[0].props, ...pageBackgroundPatch } as never,
            } as Block;
          }
          return {
            ...page,
            blocks: rebuiltBlocks,
          };
        });
        if (canonicalNavBlock?.type === "nav") {
          const navItems = Array.isArray(canonicalNavBlock.props.navItems) ? canonicalNavBlock.props.navItems : [];
          const desiredPages = navItems
            .map((item, idx) => ({
              pageId: typeof item?.pageId === "string" ? item.pageId.trim() : "",
              label: typeof item?.label === "string" ? toPlainText(item.label, `页面${idx + 1}`) : `页面${idx + 1}`,
            }))
            .filter((item) => !!item.pageId);
          if (desiredPages.length > 0) {
            const pageMap = new Map(syncedPages.map((page) => [page.id, page] as const));
            syncedPages = desiredPages.map((desired, idx) => {
              const existing = pageMap.get(desired.pageId) ?? syncedPages[idx];
              const pageBackgroundPatch = getPageBackgroundPatch(existing?.blocks?.[0]);
              const base = existing ? stripNavBlocks(existing.blocks) : [];
              const navClone = cloneBlocks([canonicalNavBlock])[0];
              const rebuiltBlocks = [navClone, ...base];
              if (rebuiltBlocks[0]) {
                rebuiltBlocks[0] = {
                  ...rebuiltBlocks[0],
                  props: { ...rebuiltBlocks[0].props, ...pageBackgroundPatch } as never,
                } as Block;
              }
              return {
                id: desired.pageId,
                name: desired.label || toPlainText(existing?.name, `页面${idx + 1}`),
                blocks: rebuiltBlocks,
              };
            });
          }
        }
        const activePageId =
          syncedPages.find((page) => page.id === currentEditingPageId)?.id ??
          syncedPages.find((page) => page.id === withCurrentPage.activePageId)?.id ??
          syncedPages[0]?.id ??
          withCurrentPage.activePageId;
        const activePage = syncedPages.find((page) => page.id === activePageId) ?? syncedPages[0];
        return {
          ...withCurrentPage,
          pages: syncedPages,
          activePageId,
          blocks: cloneBlocks(activePage?.blocks ?? withCurrentPage.blocks),
        };
      }),
    };
  }

  function syncHistoryFlags() {
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(redoStackRef.current.length > 0);
  }

  function cloneViewportEditorState(state: ViewportEditorState): ViewportEditorState {
    return {
      planConfig: clonePlanConfig(state.planConfig),
      editingPlanId: state.editingPlanId,
      editingPageId: state.editingPageId,
      blocks: cloneBlocks(state.blocks),
      selectedId: state.selectedId,
    };
  }

  function cloneViewportStates(states: Record<ViewportKey, ViewportEditorState>): Record<ViewportKey, ViewportEditorState> {
    return {
      desktop: cloneViewportEditorState(states.desktop),
      mobile: cloneViewportEditorState(states.mobile),
    };
  }

  function pushUndoSnapshot(snapshot: EditorSnapshot) {
    undoStackRef.current.push(snapshot);
    if (undoStackRef.current.length > HISTORY_LIMIT) {
      undoStackRef.current.shift();
    }
    redoStackRef.current = [];
    syncHistoryFlags();
  }

  function createSnapshot(): EditorSnapshot {
    const mergedPlanConfig = mergePlanConfigWithEditingBlocks(
      planConfigRef.current,
      editingPlanIdRef.current,
      editingPageIdRef.current,
      blocksRef.current,
      { syncNavPages: false },
    );
    const previewState: ViewportEditorState = {
      planConfig: clonePlanConfig(mergedPlanConfig),
      editingPlanId: editingPlanIdRef.current,
      editingPageId: editingPageIdRef.current,
      blocks: cloneBlocks(blocksRef.current),
      selectedId: selectedIdRef.current,
    };
    const otherViewport: ViewportKey = previewViewport === "desktop" ? "mobile" : "desktop";
    const otherState = cloneViewportEditorState(viewportStatesRef.current[otherViewport]);
    return {
      previewViewport,
      viewportStates:
        previewViewport === "desktop"
          ? { desktop: previewState, mobile: otherState }
          : { desktop: otherState, mobile: previewState },
    };
  }

  function applySnapshot(snapshot: EditorSnapshot) {
    const clonedStates = cloneViewportStates(snapshot.viewportStates);
    viewportStatesRef.current = clonedStates;
    const target = clonedStates[snapshot.previewViewport];
    setPreviewViewport(snapshot.previewViewport);
    setPlanConfig(clonePlanConfig(target.planConfig));
    setEditingPlanId(target.editingPlanId);
    setEditingPageId(target.editingPageId);
    setBlocks(cloneBlocks(target.blocks));
    setSelectedId(target.selectedId || target.blocks[0]?.id || "");
    saveBlocksToStorage(buildCombinedPersistedBlocks(clonedStates.desktop.planConfig, clonedStates.mobile.planConfig));
  }

  function applyBlocks(next: Block[], options?: { selectedId?: string; recordHistory?: boolean }) {
    if (options?.recordHistory !== false) {
      pushUndoSnapshot(createSnapshot());
    }
    const navSyncKeyBefore = getNavSyncKey(blocksRef.current);
    const navSyncKeyAfter = getNavSyncKey(next);
    const shouldSyncNavPages = navSyncKeyBefore !== navSyncKeyAfter;
    const nextPlanConfig = mergePlanConfigWithEditingBlocks(
      planConfigRef.current,
      editingPlanIdRef.current,
      editingPageIdRef.current,
      next,
      { syncNavPages: shouldSyncNavPages },
    );
    setPlanConfig(nextPlanConfig);
    setBlocks(next);
    if (typeof options?.selectedId === "string") {
      setSelectedId(options.selectedId);
    }
    persistDraftForConfigs(nextPlanConfig);
  }

  function undoEdit() {
    const previous = undoStackRef.current.pop();
    if (!previous) return;
    const current = createSnapshot();
    redoStackRef.current.push(current);
    if (redoStackRef.current.length > HISTORY_LIMIT) {
      redoStackRef.current.shift();
    }
    applySnapshot(previous);
    syncHistoryFlags();
  }

  function redoEdit() {
    const next = redoStackRef.current.pop();
    if (!next) return;
    const current = createSnapshot();
    undoStackRef.current.push(current);
    if (undoStackRef.current.length > HISTORY_LIMIT) {
      undoStackRef.current.shift();
    }
    applySnapshot(next);
    syncHistoryFlags();
  }

  async function trySaveWithResolvedMerchantIds(
    payload: { blocks: Block[]; updated_at: string },
    timeoutMs = 45000,
  ) {
    let merchantIds = merchantIdsRef.current;
    if (merchantIds.length === 0) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      merchantIds = await resolveMerchantIds(session?.user?.id, session?.user?.email, {
        ...(session?.user?.user_metadata ?? {}),
        ...(session?.user?.app_metadata ?? {}),
      });
      merchantIdsRef.current = merchantIds;
    }
    return withTimeout(saveBlocksToSupabaseFallback(payload, merchantIds), timeoutMs);
  }

  function openAlert(message: string, title = "提示"): Promise<void> {
    return new Promise((resolve) => {
      setDialog({ type: "alert", title, message, resolve });
    });
  }

  function openConfirm(message: string, title = "确认"): Promise<boolean> {
    return new Promise((resolve) => {
      setDialog({ type: "confirm", title, message, resolve });
    });
  }

  function openCompressionPresetDialog(
    message: string,
    title = "发布失败",
  ): Promise<UploadCompressionPreset | null> {
    return new Promise((resolve) => {
      setDialog({
        type: "compression-preset",
        title,
        message,
        currentPreset: uploadCompressionPreset,
        resolve,
      });
    });
  }

  applyPersistedBlocksToEditorRef.current = applyPersistedBlocksToEditor;
  recordDragHistoryRef.current = () => {
    pushUndoSnapshot(createSnapshot());
  };
  persistDraggingDraftRef.current = () => {
    persistDraftForConfigs(
      mergePlanConfigWithEditingBlocks(
        planConfigRef.current,
        editingPlanIdRef.current,
        editingPageIdRef.current,
        blocksRef.current,
        { syncNavPages: false },
      ),
    );
  };

  useEffect(() => {
    let mounted = true;

    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!mounted) return;
      if (!session) {
        window.location.href = "/login";
        return;
      }

      const merchantIds = await resolveMerchantIds(
        session.user.id,
        session.user.email,
        {
          ...(session.user.user_metadata ?? {}),
          ...(session.user.app_metadata ?? {}),
        },
      );
      merchantIdsRef.current = merchantIds;
      const loaded = await loadBlocksFromSupabaseFallback(merchantIds);
      if (loaded && Array.isArray(loaded)) {
        applyPersistedBlocksToEditorRef.current(loaded);
        const desktopLoaded = viewportStatesRef.current.desktop.planConfig;
        const mobileLoaded = viewportStatesRef.current.mobile.planConfig;
        savePublishedBlocksToStorage(buildCombinedPersistedBlocks(desktopLoaded, mobileLoaded));
      }

      setCheckingAuth(false);
    })();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) window.location.href = "/login";
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
      merchantIdsRef.current = [];
    };
  }, []);

  function updateBlockProps(blockId: string, patch: Partial<Block["props"]>) {
    const currentBlocks = blocksRef.current;
    const index = currentBlocks.findIndex((b) => b.id === blockId);
    if (index < 0) return;

    const next = [...currentBlocks];
    next[index] = {
      ...next[index],
      props: { ...next[index].props, ...patch } as never,
    } as Block;

    applyBlocks(next);
  }

  function resizeBlockWithoutAffectingOthers(
    blockId: string,
    patch: Partial<Block["props"]>,
    heightDelta: number,
  ) {
    const currentBlocks = blocksRef.current;
    const index = currentBlocks.findIndex((b) => b.id === blockId);
    if (index < 0) return;

    const next = [...currentBlocks];
    next[index] = {
      ...next[index],
      props: { ...next[index].props, ...patch } as never,
    } as Block;

    if (heightDelta !== 0) {
      for (let i = index + 1; i < next.length; i += 1) {
        const rawOffsetY = next[i].props.blockOffsetY;
        const currentOffsetY =
          typeof rawOffsetY === "number" && Number.isFinite(rawOffsetY)
            ? Math.round(rawOffsetY)
            : 0;
        next[i] = {
          ...next[i],
          props: {
            ...next[i].props,
            blockOffsetY: Math.round(currentOffsetY - heightDelta),
          } as never,
        } as Block;
      }
    }

    applyBlocks(next);
  }

  function previewResizeWithoutAffectingOthers(blockId: string, heightDelta: number) {
    if (!heightDelta) {
      setResizePreview((prev) => (prev?.blockId === blockId ? null : prev));
      return;
    }
    setResizePreview({ blockId, heightDelta });
  }

  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    setRecentColors(loadRecentColors());
  }, []);

  useEffect(() => {
    if (!tip) return;

    const onPointerDown = () => {
      if (!tipDismissByPointerRef.current) return;
      setTip("");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTip("");
      }
    };
    const timeoutId =
      typeof tipDurationMsRef.current === "number"
        ? window.setTimeout(() => {
            setTip("");
          }, tipDurationMsRef.current)
        : null;

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      if (typeof timeoutId === "number") window.clearTimeout(timeoutId);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [tip]);

  useEffect(() => {
    planConfigRef.current = planConfig;
  }, [planConfig]);

  useEffect(() => {
    editingPlanIdRef.current = editingPlanId;
  }, [editingPlanId]);

  useEffect(() => {
    editingPageIdRef.current = editingPageId;
  }, [editingPageId]);

  useEffect(() => {
    viewportStatesRef.current[previewViewport] = {
      planConfig: clonePlanConfig(planConfig),
      editingPlanId,
      editingPageId,
      blocks: cloneBlocks(blocks),
      selectedId,
    };
  }, [blocks, editingPageId, editingPlanId, planConfig, previewViewport, selectedId]);

  useEffect(() => {
    const topBarNode = topBarRef.current;
    if (!topBarNode) return;
    const updateTopBarHeight = () => {
      setTopBarHeight(Math.ceil(topBarNode.getBoundingClientRect().height));
    };
    updateTopBarHeight();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateTopBarHeight) : null;
    if (observer) observer.observe(topBarNode);
    window.addEventListener("resize", updateTopBarHeight);
    return () => {
      if (observer) observer.disconnect();
      window.removeEventListener("resize", updateTopBarHeight);
    };
  }, [previewViewport, topBarCollapsed]);

  useEffect(() => {
    const measureBackgroundHeight = () => {
      const layer = backgroundLayerRef.current;
      if (!layer) return;
      const layerRect = layer.getBoundingClientRect();
      const viewportMinHeight = Math.max(0, Math.ceil(window.innerHeight - layerRect.top));
      const measuredNodes = layer.querySelectorAll<HTMLElement>("[data-block-id], [data-block-id] *");
      let visualBottom = 0;
      measuredNodes.forEach((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 && rect.height <= 0) return;
        visualBottom = Math.max(visualBottom, rect.bottom - layerRect.top);
      });
      const nextMinHeight = Math.max(viewportMinHeight, Math.ceil(visualBottom + 160));
      setBackgroundLayerMinHeight((prev) => (prev === nextMinHeight ? prev : nextMinHeight));
    };

    const rafId = window.requestAnimationFrame(measureBackgroundHeight);
    window.addEventListener("resize", measureBackgroundHeight);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", measureBackgroundHeight);
    };
  }, [blocks, resizePreview, selectedId, draggingBlockId]);

function getPageBackgroundPatch(source: Block | undefined): PageBackgroundPatch {
    return {
      pageBgImageUrl: source?.props.pageBgImageUrl ?? "",
      pageBgFillMode: source?.props.pageBgFillMode ?? "cover",
      pageBgPosition: source?.props.pageBgPosition ?? "center",
      pageBgColor: source?.props.pageBgColor ?? "",
      pageBgOpacity: source?.props.pageBgOpacity ?? 1,
      pageBgImageOpacity: source?.props.pageBgImageOpacity ?? source?.props.pageBgOpacity ?? 1,
      pageBgColorOpacity: source?.props.pageBgColorOpacity ?? source?.props.pageBgOpacity ?? 1,
    };
  }

  function updatePageBackground(patch: Partial<PageBackgroundPatch>) {
    if (blocks.length === 0) return;

    const next = [...blocks];
    next[0] = {
      ...next[0],
      props: { ...next[0].props, ...patch } as never,
    } as Block;

    applyBlocks(next);
  }

  function startDraggingBlock(blockId: string, point: { x: number; y: number }) {
    const block = blocksRef.current.find((b) => b.id === blockId);
    if (!block || isBlockLocked(block)) return;
    const blockIds = [blockId];
    const startOffsets: Record<string, { x: number; y: number }> = {};
    blockIds.forEach((id) => {
      const item = blocksRef.current.find((candidate) => candidate.id === id);
      const startOffsetX =
        item && typeof item.props.blockOffsetX === "number" && Number.isFinite(item.props.blockOffsetX)
          ? Math.round(item.props.blockOffsetX)
          : 0;
      const startOffsetY =
        item && typeof item.props.blockOffsetY === "number" && Number.isFinite(item.props.blockOffsetY)
          ? Math.round(item.props.blockOffsetY)
          : 0;
      startOffsets[id] = { x: startOffsetX, y: startOffsetY };
    });

    setSelectedId(blockId);
    dragStartRef.current = {
      blockId,
      blockIds,
      pointerX: point.x,
      pointerY: point.y,
      startOffsets,
      historyRecorded: false,
    };
    setDraggingBlockId(blockId);
  }

  function clampBlockOffsetToViewport(
    blockId: string,
    currentOffsetX: number,
    currentOffsetY: number,
    nextOffsetX: number,
    nextOffsetY: number,
    options?: { allowDragDownOverflow?: boolean },
  ) {
    const element = document.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`);
    if (!element) {
      return {
        x: nextOffsetX,
        y: nextOffsetY,
      };
    }

    const rect = element.getBoundingClientRect();
    const desiredDeltaX = nextOffsetX - currentOffsetX;
    const desiredDeltaY = nextOffsetY - currentOffsetY;
    const minDeltaX = -rect.left;
    const maxDeltaX = window.innerWidth - rect.right;
    const minDeltaY = -rect.top;
    const maxDeltaY = options?.allowDragDownOverflow ? Number.POSITIVE_INFINITY : window.innerHeight - rect.bottom;
    const clampedDeltaX =
      minDeltaX > maxDeltaX ? 0 : Math.min(Math.max(desiredDeltaX, minDeltaX), maxDeltaX);
    const clampedDeltaY =
      minDeltaY > maxDeltaY ? 0 : Math.min(Math.max(desiredDeltaY, minDeltaY), maxDeltaY);

    return {
      x: Math.round(currentOffsetX + clampedDeltaX),
      y: Math.round(currentOffsetY + clampedDeltaY),
    };
  }

  function nudgeBlock(blockId: string, deltaX: number, deltaY: number) {
    if (!deltaX && !deltaY) return;
    const targetBlock = blocks.find((item) => item.id === blockId);
    if (!targetBlock || isBlockLocked(targetBlock)) return;
    const movableIds = [blockId];
    if (movableIds.length === 0) return;
    const next = [...blocks];
    let changed = false;
    movableIds.forEach((id) => {
      const index = next.findIndex((item) => item.id === id);
      if (index < 0) return;
      const current = next[index];
      const currentX =
        typeof current.props.blockOffsetX === "number" && Number.isFinite(current.props.blockOffsetX)
          ? Math.round(current.props.blockOffsetX)
          : 0;
      const currentY =
        typeof current.props.blockOffsetY === "number" && Number.isFinite(current.props.blockOffsetY)
          ? Math.round(current.props.blockOffsetY)
          : 0;
      const clampedOffset = clampBlockOffsetToViewport(id, currentX, currentY, currentX + deltaX, currentY + deltaY);
      if (clampedOffset.x === currentX && clampedOffset.y === currentY) return;
      next[index] = {
        ...current,
        props: {
          ...current.props,
          blockOffsetX: clampedOffset.x,
          blockOffsetY: clampedOffset.y,
        } as never,
      } as Block;
      changed = true;
    });
    if (changed) applyBlocks(next);
  }

  function handleEditorMouseDownCapture(event: ReactMouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest("[data-editor-toolbar]")) return;
    if (target.closest("[data-editor-overlay]")) return;
    if (target.closest("[data-block-id]")) return;
    if (selectedIdRef.current) {
      setSelectedId("");
    }
  }

  function getBlockLayer(block: Block) {
    return typeof block.props.blockLayer === "number" && Number.isFinite(block.props.blockLayer)
      ? Math.max(1, Math.round(block.props.blockLayer))
      : 1;
  }

  function normalizeBlockLayers(input: Block[]) {
    const ranked = input
      .map((block, index) => ({ block, index, layer: getBlockLayer(block) }))
      .sort((a, b) => (a.layer === b.layer ? a.index - b.index : a.layer - b.layer));
    const assigned = new Map<string, number>();
    ranked.forEach((item, idx) => {
      assigned.set(item.block.id, idx + 1);
    });

    return input.map((block) => ({
      ...block,
      props: {
        ...block.props,
        blockLayer: assigned.get(block.id) ?? 1,
      } as never,
    })) as Block[];
  }

  function moveBlockToLayerEdge(blockId: string, edge: "front" | "back") {
    const index = blocks.findIndex((b) => b.id === blockId);
    if (index < 0) return;
    const current = blocks[index];
    const layers = blocks.map(getBlockLayer);
    const targetLayer = edge === "front" ? Math.max(...layers) + 1 : Math.min(...layers) - 1;
    if (getBlockLayer(current) === targetLayer) return;
    const next = [...blocks];
    next[index] = {
      ...current,
      props: { ...current.props, blockLayer: targetLayer } as never,
    } as Block;
    applyBlocks(normalizeBlockLayers(next));
  }

  function moveBlockLayerByOne(blockId: string, direction: "up" | "down") {
    const index = blocks.findIndex((b) => b.id === blockId);
    if (index < 0) return;
    const current = blocks[index];
    const currentLayer = getBlockLayer(current);
    const otherLayers = blocks
      .filter((b) => b.id !== blockId)
      .map(getBlockLayer)
      .sort((a, b) => a - b);
    const targetLayer =
      direction === "up"
        ? otherLayers.find((layer) => layer > currentLayer)
        : [...otherLayers].reverse().find((layer) => layer < currentLayer);
    if (typeof targetLayer !== "number") return;

    const swapIndex = blocks.findIndex((b) => b.id !== blockId && getBlockLayer(b) === targetLayer);
    const next = [...blocks];
    next[index] = {
      ...current,
      props: { ...current.props, blockLayer: targetLayer } as never,
    } as Block;
    if (swapIndex >= 0) {
      const swap = blocks[swapIndex];
      next[swapIndex] = {
        ...swap,
        props: { ...swap.props, blockLayer: currentLayer } as never,
      } as Block;
    }
    applyBlocks(normalizeBlockLayers(next));
  }

  useEffect(() => {
    if (!draggingBlockId) return;

    const onPointerMove = (event: MouseEvent) => {
      const start = dragStartRef.current;
      if (!start || start.blockId !== draggingBlockId) return;
      const deltaX = event.clientX - start.pointerX;
      const deltaY = event.clientY - start.pointerY;
      if (!start.historyRecorded && (deltaX !== 0 || deltaY !== 0)) {
        recordDragHistoryRef.current();
        start.historyRecorded = true;
      }
      setBlocks((prev) => {
        const next = [...prev];
        start.blockIds.forEach((id) => {
          const index = next.findIndex((b) => b.id === id);
          if (index < 0) return;
          const origin = start.startOffsets[id];
          if (!origin) return;
          const current = next[index];
          const currentOffsetX =
            typeof current.props.blockOffsetX === "number" && Number.isFinite(current.props.blockOffsetX)
              ? Math.round(current.props.blockOffsetX)
              : 0;
          const currentOffsetY =
            typeof current.props.blockOffsetY === "number" && Number.isFinite(current.props.blockOffsetY)
              ? Math.round(current.props.blockOffsetY)
              : 0;
          const clampedOffset = clampBlockOffsetToViewport(
            id,
            currentOffsetX,
            currentOffsetY,
            Math.round(origin.x + deltaX),
            Math.round(origin.y + deltaY),
            { allowDragDownOverflow: true },
          );
          next[index] = {
            ...current,
            props: {
              ...current.props,
              blockOffsetX: clampedOffset.x,
              blockOffsetY: clampedOffset.y,
            } as never,
          } as Block;
        });
        return next;
      });
    };

    const onPointerUp = () => {
      dragStartRef.current = null;
      setDraggingBlockId(null);
      persistDraggingDraftRef.current();
    };
    const onBlur = () => {
      dragStartRef.current = null;
      setDraggingBlockId(null);
      persistDraggingDraftRef.current();
    };
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onPointerMove);
    window.addEventListener("mouseup", onPointerUp);
    window.addEventListener("blur", onBlur);

    return () => {
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("mousemove", onPointerMove);
      window.removeEventListener("mouseup", onPointerUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [draggingBlockId]);

  function makeDefaultBlock(type: Block["type"]): Block {
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    if (type === "common") {
      return {
        id,
        type,
        props: { commonTextBoxes: [] },
      };
    }

    if (type === "gallery") {
      return {
        id,
        type,
        props: { heading: "新的画廊区块", images: [], autoplayMs: 3000, galleryFrameHeight: 260, galleryLayoutPreset: "three-wide" },
      };
    }

    if (type === "chart") {
      return {
        id,
        type,
        props: {
          heading: "新的图表区块",
          text: "图表说明文本",
          chartType: "bar",
          labels: ["A", "B", "C"],
          values: [10, 20, 15],
        },
      };
    }

    if (type === "nav") {
      return {
        id,
        type,
        props: {
          heading: "页面导航",
          navOrientation: "horizontal",
          navItems: [
            { id: `nav-item-${Date.now()}-1`, label: "页面1", pageId: "page-1" },
          ],
        },
      };
    }

    if (type === "music") {
      return {
        id,
        type,
        props: {
          heading: "新的音乐区块",
          audioUrl: "",
          musicPlayerStyle: "classic",
        },
      };
    }

    if (type === "hero") {
      return {
        id,
        type,
        props: { title: "新的视觉横幅", subtitle: "在这里编写副标题说明文案" },
      };
    }

    if (type === "text") {
      return {
        id,
        type,
        props: { heading: "新的文本区块", text: "在这里输入文本内容。" },
      };
    }

    if (type === "list") {
      return {
        id,
        type,
        props: { heading: "新的列表区块", items: ["列表项 1", "列表项 2"] },
      };
    }

    return {
      id,
      type,
      props: {
        heading: "联系方式",
        phone: "123-456-7890",
        address: "中国",
        addresses: ["中国"],
        mapZoom: 5,
        mapType: "roadmap",
        mapShowMarker: true,
        email: "",
        whatsapp: "",
        wechat: "",
        tiktok: "",
        xiaohongshu: "",
        facebook: "",
        instagram: "",
        contactLayout: {},
      },
    };
  }

  function addBlock() {
    if (newBlockType === "nav") {
      const mergedConfig = mergePlanConfigWithEditingBlocks(
        planConfigRef.current,
        editingPlanIdRef.current,
        editingPageIdRef.current,
        blocksRef.current,
        { syncNavPages: false },
      );
      const currentPlan = mergedConfig.plans.find((plan) => plan.id === editingPlanIdRef.current) ?? mergedConfig.plans[0];
      const exists = currentPlan?.pages?.some((page) => hasNavBlock(page.blocks));
      if (exists) {
        setTip("导航区块只能有一个");
        setTimeout(() => setTip(""), 1200);
        return;
      }
    }
    const nextBlock = makeDefaultBlock(newBlockType);
    const next = [...blocks, nextBlock];
    applyBlocks(next, { selectedId: nextBlock.id });
    setTip("已新增区块");
    setTimeout(() => setTip(""), 1200);
  }

  function switchEditingPlan(planId: PlanId) {
    if (planId === editingPlanIdRef.current) return;
    const mergedConfig = mergePlanConfigWithEditingBlocks(
      planConfigRef.current,
      editingPlanIdRef.current,
      editingPageIdRef.current,
      blocksRef.current,
      { syncNavPages: false },
    );
    const targetPlan = mergedConfig.plans.find((plan) => plan.id === planId) ?? mergedConfig.plans[0];
    const targetPageId = targetPlan?.activePageId ?? "page-1";
    const targetBlocks = cloneBlocks(getBlocksForPage(targetPlan, targetPageId));
    const nextConfig = clonePlanConfig(mergedConfig);
    pushUndoSnapshot(createSnapshot());
    setPlanConfig(nextConfig);
    setEditingPlanId(planId);
    setEditingPageId(targetPageId);
    setBlocks(targetBlocks);
    setSelectedId(targetBlocks[0]?.id ?? "");
    persistDraftForConfigs(nextConfig);
  }

  function switchEditingPage(pageId: string) {
    if (pageId === editingPageIdRef.current) return;
    const mergedConfig = mergePlanConfigWithEditingBlocks(
      planConfigRef.current,
      editingPlanIdRef.current,
      editingPageIdRef.current,
      blocksRef.current,
      { syncNavPages: false },
    );
    const currentPlan = mergedConfig.plans.find((plan) => plan.id === editingPlanIdRef.current) ?? mergedConfig.plans[0];
    const canonicalNav =
      currentPlan.pages.map((page) => getFirstNavBlock(page.blocks)).find((item) => !!item) ??
      getFirstNavBlock(currentPlan.blocks) ??
      null;
    const rawTargetBlocks = cloneBlocks(getBlocksForPage(currentPlan, pageId));
    const targetBlocks =
      canonicalNav && !hasNavBlock(rawTargetBlocks)
        ? [cloneBlocks([canonicalNav])[0], ...stripNavBlocks(rawTargetBlocks)]
        : rawTargetBlocks;
    const patchedPlan =
      canonicalNav && !hasNavBlock(rawTargetBlocks)
        ? setBlocksForPage({ ...currentPlan, activePageId: pageId }, pageId, targetBlocks)
        : { ...currentPlan, activePageId: pageId };
    const nextConfig: PagePlanConfig = {
      ...mergedConfig,
      plans: mergedConfig.plans.map((plan) => (plan.id === editingPlanIdRef.current ? patchedPlan : plan)),
    };
    pushUndoSnapshot(createSnapshot());
    setPlanConfig(nextConfig);
    setEditingPageId(pageId);
    setBlocks(targetBlocks);
    setSelectedId(targetBlocks[0]?.id ?? "");
    persistDraftForConfigs(nextConfig);
  }

  async function deleteBlock(blockId: string) {
    const currentIndex = blocks.findIndex((b) => b.id === blockId);
    if (currentIndex < 0) return;
    const target = blocks[currentIndex];
    const confirmed = await openConfirm(
      `确认删除区块 ${currentIndex + 1}：${getBlockTypeLabel(target.type)}？`,
      "删除确认",
    );
    if (!confirmed) return;

    const pageBackgroundPatch = getPageBackgroundPatch(blocks[0]);
    const next = blocks.filter((b) => b.id !== blockId);

    if (currentIndex === 0 && next[0]) {
      next[0] = {
        ...next[0],
        props: { ...next[0].props, ...pageBackgroundPatch } as never,
      } as Block;
    }

    const nextSelected = next[Math.min(currentIndex, next.length - 1)];
    if (target.type === "nav") {
      const mergedConfig = mergePlanConfigWithEditingBlocks(
        planConfigRef.current,
        editingPlanIdRef.current,
        editingPageIdRef.current,
        blocksRef.current,
        { syncNavPages: false },
      );
      const currentPlan = mergedConfig.plans.find((plan) => plan.id === editingPlanIdRef.current) ?? mergedConfig.plans[0];
      const nextPlan = {
        ...currentPlan,
        pages: currentPlan.pages.map((page) => ({
          ...page,
          blocks: stripNavBlocks(page.blocks),
        })),
      };
      const activeBlocks = getBlocksForPage(nextPlan, editingPageIdRef.current);
      const nextConfig: PagePlanConfig = {
        ...mergedConfig,
        plans: mergedConfig.plans.map((plan) => (plan.id === editingPlanIdRef.current ? nextPlan : plan)),
      };
      pushUndoSnapshot(createSnapshot());
      setPlanConfig(nextConfig);
      setBlocks(activeBlocks);
      setSelectedId(nextSelected?.id ?? activeBlocks[0]?.id ?? "");
      persistDraftForConfigs(nextConfig);
    } else {
      applyBlocks(next, { selectedId: nextSelected?.id ?? "" });
    }
    setTip("已删除区块");
    setTimeout(() => setTip(""), 1200);
  }

  function insertPageImage() {
    setPageImageUrlInput(blocks[0]?.props.pageBgImageUrl ?? "");
    setPageImageDialogOpen(true);
  }

  function applyPageImageFromInput() {
    const trimmed = pageImageUrlInput.trim();
    try {
      const nextUrl = ensureSafeImageUrlSize(trimmed || undefined);
      updatePageBackground({ pageBgImageUrl: nextUrl });
      setPageImageDialogOpen(false);
    } catch (error) {
      setTip(error instanceof Error ? error.message : "图片设置失败，请重试");
      setTimeout(() => setTip(""), 1600);
    }
  }

  function clearPageImage() {
    updatePageBackground({ pageBgImageUrl: undefined });
    setPageImageDialogOpen(false);
  }

  async function handlePageImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const inputEl = event.currentTarget;
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const result = await fileToOriginalImageDataUrl(file, imageCompressionOptions);
      updatePageBackground({ pageBgImageUrl: result });
      setPageImageDialogOpen(false);
      setTip("页面背景图片已更新");
      setTimeout(() => setTip(""), 1200);
    } catch (error) {
      setTip(error instanceof Error ? error.message : "上传失败，请重试");
      setTimeout(() => setTip(""), 1600);
    } finally {
      inputEl.value = "";
    }
  }

  function editPageImageSettings() {
    setPageSettingsFillMode(blocks[0]?.props.pageBgFillMode ?? "cover");
    setPageSettingsPosition(blocks[0]?.props.pageBgPosition ?? "center");
    setPageSettingsColor(blocks[0]?.props.pageBgColor ?? "");
    setPageSettingsImageOpacity(
      typeof blocks[0]?.props.pageBgImageOpacity === "number" && Number.isFinite(blocks[0]?.props.pageBgImageOpacity)
        ? Math.max(0, Math.min(1, blocks[0]?.props.pageBgImageOpacity ?? 1))
        : typeof blocks[0]?.props.pageBgOpacity === "number" && Number.isFinite(blocks[0]?.props.pageBgOpacity)
          ? Math.max(0, Math.min(1, blocks[0]?.props.pageBgOpacity ?? 1))
          : 1,
    );
    setPageSettingsColorOpacity(
      typeof blocks[0]?.props.pageBgColorOpacity === "number" && Number.isFinite(blocks[0]?.props.pageBgColorOpacity)
        ? Math.max(0, Math.min(1, blocks[0]?.props.pageBgColorOpacity ?? 1))
        : typeof blocks[0]?.props.pageBgOpacity === "number" && Number.isFinite(blocks[0]?.props.pageBgOpacity)
          ? Math.max(0, Math.min(1, blocks[0]?.props.pageBgOpacity ?? 1))
        : 1,
    );
    setPageImageSettingsOpen(true);
  }

  function applyPageImageSettings() {
    updatePageBackground({
      pageBgFillMode: pageSettingsFillMode,
      pageBgPosition: pageSettingsPosition.trim() || "center",
      pageBgColor: pageSettingsColor.trim() || undefined,
      pageBgImageOpacity: pageSettingsImageOpacity,
      pageBgColorOpacity: pageSettingsColorOpacity,
      pageBgOpacity: undefined,
    });
    recordRecentColor(pageSettingsColor);
    setPageImageSettingsOpen(false);
  }

  async function withTimeout<T>(task: PromiseLike<T>, timeoutMs = 45000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeoutTask = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("保存超时，请稍后重试")), timeoutMs);
    });

    try {
      return await Promise.race([Promise.resolve(task), timeoutTask]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function saveDraft() {
    const mergedConfig = mergePlanConfigWithEditingBlocks(
      planConfigRef.current,
      editingPlanIdRef.current,
      editingPageIdRef.current,
      blocksRef.current,
    );
    setPlanConfig(mergedConfig);
    persistDraftForConfigs(mergedConfig);
    showSavePublishTip("草稿已保存");
  }

  async function showAnalyticsSummary() {
    const mergedConfig = mergePlanConfigWithEditingBlocks(
      planConfigRef.current,
      editingPlanIdRef.current,
      editingPageIdRef.current,
      blocksRef.current,
    );
    const desktopConfig = previewViewport === "desktop" ? mergedConfig : viewportStatesRef.current.desktop.planConfig;
    const mobileConfig = previewViewport === "mobile" ? mergedConfig : viewportStatesRef.current.mobile.planConfig;
    const combinedBlocks = buildCombinedPersistedBlocks(desktopConfig, mobileConfig);
    const payloadBytes = estimateUtf8Size(JSON.stringify(combinedBlocks));
    const diffSummary = computePublishDiffSummary(combinedBlocks, loadPublishedBlocksFromStorage(homeBlocks));
    const byType = new Map<string, number>();
    blocksRef.current.forEach((item) => {
      byType.set(item.type, (byType.get(item.type) ?? 0) + 1);
    });
    const clickStats = readContactClickStats();
    const clickDaily = readContactClickDailyStats();
    const clickPairs = Object.entries(clickStats).sort((a, b) => b[1] - a[1]);
    const viewDailyByPath = readPageViewDailyStats();
    const mergedViewDaily: Record<string, number> = {};
    Object.values(viewDailyByPath).forEach((daily) => {
      Object.entries(daily).forEach(([day, count]) => {
        mergedViewDaily[day] = (mergedViewDaily[day] ?? 0) + count;
      });
    });
    const visit1d = sumDailyValues(mergedViewDaily, 1);
    const visit7d = sumDailyValues(mergedViewDaily, 7);
    const visit30d = sumDailyValues(mergedViewDaily, 30);
    const topClick7d = Object.entries(clickDaily)
      .map(([channel, daily]) => ({ channel, count: sumDailyValues(daily, 7) }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    const publishEvents = readPublishEvents();
    const nowMs = Date.now();
    const inLastDays = (iso: string, days: number) => {
      const at = new Date(iso).getTime();
      if (!Number.isFinite(at)) return false;
      return nowMs - at <= days * 24 * 60 * 60 * 1000;
    };
    const publish7d = publishEvents.filter((item) => inLastDays(item.at, 7));
    const publish30d = publishEvents.filter((item) => inLastDays(item.at, 30));
    const successRate7d =
      publish7d.length > 0 ? `${Math.round((publish7d.filter((item) => item.success).length / publish7d.length) * 100)}%` : "暂无";
    const successRate30d =
      publish30d.length > 0 ? `${Math.round((publish30d.filter((item) => item.success).length / publish30d.length) * 100)}%` : "暂无";
    const remoteSummary = await readRemoteAnalyticsSummary(30);
    const failureSnapshots = readPublishFailureSnapshots();
    const lines = [
      `当前页区块数量：${blocksRef.current.length}`,
      `发布体积估算：${formatBytes(payloadBytes)}`,
      `相对已发布变化：改动${diffSummary.changedCount}，新增${diffSummary.addedCount}，删除${diffSummary.removedCount}`,
      "",
      "访问趋势：",
      `- 今日：${visit1d}`,
      `- 7日：${visit7d}`,
      `- 30日：${visit30d}`,
      "",
      "发布趋势：",
      `- 7日成功率：${successRate7d}（${publish7d.length}次）`,
      `- 30日成功率：${successRate30d}（${publish30d.length}次）`,
      "",
      "发布失败快照：",
      `- 本地保留：${failureSnapshots.length} 条`,
      ...(failureSnapshots[0]
        ? [`- 最近失败：${failureSnapshots[0].at} / ${failureSnapshots[0].reason}`]
        : ["- 最近失败：暂无"]),
      "",
      "区块类型统计（当前页）：",
      ...(Array.from(byType.entries()).length > 0
        ? Array.from(byType.entries()).map(([type, count]) => `- ${type}: ${count}`)
        : ["- 无"]),
      "",
      "联系方式点击统计（本设备）：",
      ...(clickPairs.length > 0 ? clickPairs.map(([key, count]) => `- ${key}: ${count}`) : ["- 暂无"]),
      "",
      "联系方式7日趋势：",
      ...(topClick7d.length > 0 ? topClick7d.map((item) => `- ${item.channel}: ${item.count}`) : ["- 暂无"]),
      "",
      "远端统计（Supabase）：",
      ...(remoteSummary
        ? [
            `- 访问：今日 ${remoteSummary.pageView1d} / 7日 ${remoteSummary.pageView7d} / 30日 ${remoteSummary.pageView30d}`,
            `- 发布成功率(7日)：${
              remoteSummary.publishTotal7d > 0
                ? `${Math.round((remoteSummary.publishSuccess7d / remoteSummary.publishTotal7d) * 100)}%`
                : "暂无"
            }`,
            `- 发布成功率(30日)：${
              remoteSummary.publishTotal30d > 0
                ? `${Math.round((remoteSummary.publishSuccess30d / remoteSummary.publishTotal30d) * 100)}%`
                : "暂无"
            }`,
            ...(remoteSummary.contactTop7d.length > 0
              ? remoteSummary.contactTop7d.map((item) => `- 联系方式7日：${item.channel} ${item.count}`)
              : ["- 联系方式7日：暂无"]),
          ]
        : ["- 未启用或未检测到 page_events 表（已自动回退本地统计）"]),
    ];
    await openAlert(lines.join("\n"), "数据统计");
  }

  async function runPublishPreflightDialog(blocks: Block[], payloadBytes: number) {
    const result = runPublishPreflight(blocks, payloadBytes);
    if (result.errors.length > 0) {
      await openAlert(
        [
          "发布体检未通过：",
          ...result.errors.map((item) => `- ${item}`),
          "",
          "请先处理后再发布。",
        ].join("\n"),
        "发布体检",
      );
      return false;
    }
    if (result.warnings.length > 0) {
      const confirmed = await openConfirm(
        [
          "发布体检发现风险：",
          ...result.warnings.map((item) => `- ${item}`),
          "",
          "是否仍继续发布？",
        ].join("\n"),
        "发布体检",
      );
      return confirmed;
    }
    return true;
  }

  async function publishToFrontend() {
    if (publishing) return;
    setPublishing(true);
    showSavePublishTip("发布中...");

    try {
      const mergedConfig = mergePlanConfigWithEditingBlocks(
        planConfigRef.current,
        editingPlanIdRef.current,
        editingPageIdRef.current,
        blocksRef.current,
      );
      const desktopConfig = previewViewport === "desktop" ? mergedConfig : viewportStatesRef.current.desktop.planConfig;
      const mobileConfig = previewViewport === "mobile" ? mergedConfig : viewportStatesRef.current.mobile.planConfig;
      const combinedBlocks = buildCombinedPersistedBlocks(desktopConfig, mobileConfig);
      const payload = {
        blocks: combinedBlocks,
        updated_at: new Date().toISOString(),
      };
      const payloadBytes = estimateUtf8Size(JSON.stringify(payload.blocks));
      const publishedBlocks = loadPublishedBlocksFromStorage(homeBlocks);
      const diffSummary = computePublishDiffSummary(combinedBlocks, publishedBlocks);
      const totalChanges = diffSummary.changedCount + diffSummary.addedCount + diffSummary.removedCount;
      if (totalChanges === 0) {
        showSavePublishTip("无变更，已跳过发布");
        trackPublishEvent({
          success: true,
          bytes: payloadBytes,
          changedBlocks: 0,
          reason: "skip-no-change",
        });
        return;
      }

      const preflightPassed = await runPublishPreflightDialog(payload.blocks, payloadBytes);
      if (!preflightPassed) {
        trackPublishEvent({
          success: false,
          bytes: payloadBytes,
          changedBlocks: totalChanges,
          reason: "preflight-blocked",
        });
        return;
      }

      if (payloadBytes > MAX_PUBLISH_PAYLOAD_BYTES) {
        const breakdown = getPublishSizeBreakdown(payload.blocks);
        showPublishFailedTip(
          `发布内容过大（${(payloadBytes / 1024 / 1024).toFixed(2)}MB），请压缩图片/音频或改为外链后再发布`,
        );
        savePublishFailureSnapshot({
          reason: "体积超限",
          bytes: payloadBytes,
          blocks: combinedBlocks,
        });
        trackPublishEvent({
          success: false,
          bytes: payloadBytes,
          changedBlocks: totalChanges,
          reason: "size-limit",
        });
        const lines: string[] = [
          `当前发布体积：${formatBytes(payloadBytes)}（上限：${formatBytes(MAX_PUBLISH_PAYLOAD_BYTES)}）`,
          "",
          "占用最大的区块：",
          ...(breakdown.blockTotals.length > 0
            ? breakdown.blockTotals.map((item) => `- ${item.path}: ${formatBytes(item.bytes)}`)
            : ["- 无"]),
        ];
        await openAlert(lines.join("\n"), "发布体积明细");
        const nextPreset = await openCompressionPresetDialog(
          "请选择上传压缩策略。切换后会作用于后续上传的新图片，已有图片不会自动重压缩。",
          "发布失败：内容过大",
        );
        if (nextPreset) {
          setUploadCompressionPreset(nextPreset);
          showTip(`已切换上传压缩：${IMAGE_COMPRESSION_OPTIONS[nextPreset].label}`, {
            durationMs: 3200,
            dismissOnPointer: true,
          });
        }
        return;
      }
      // Keep draft locally first regardless of publish result.
      saveBlocksToStorage(combinedBlocks);
      let error: SaveErrorLike = null;
      try {
        error = await trySaveWithResolvedMerchantIds(payload, 45000);
      } catch (firstError) {
        if (!(firstError instanceof Error) || !firstError.message.includes("保存超时")) {
          throw firstError;
        }
        showSavePublishTip("首次发布超时，正在自动重试...");
        error = await trySaveWithResolvedMerchantIds(payload, 60000);
      }

      if (error) {
        showPublishFailedTip(`草稿已保存，发布失败：${normalizeSaveErrorMessage(error.message)}`);
        savePublishFailureSnapshot({
          reason: normalizeSaveErrorMessage(error.message),
          bytes: payloadBytes,
          blocks: combinedBlocks,
        });
        trackPublishEvent({
          success: false,
          bytes: payloadBytes,
          changedBlocks: totalChanges,
          reason: normalizeSaveErrorMessage(error.message),
        });
        const nextPreset = await openCompressionPresetDialog(
          "可先切换上传压缩策略，再重新上传大图后发布。",
          "发布失败",
        );
        if (nextPreset) {
          setUploadCompressionPreset(nextPreset);
          showTip(`已切换上传压缩：${IMAGE_COMPRESSION_OPTIONS[nextPreset].label}`, {
            durationMs: 3200,
            dismissOnPointer: true,
          });
        }
        return;
      }

      setPlanConfig(mergedConfig);
      savePublishedBlocksToStorage(combinedBlocks);
      trackPublishEvent({
        success: true,
        bytes: payloadBytes,
        changedBlocks: totalChanges,
      });
      showSavePublishTip("已发布到前台");
    } catch (error) {
      const mergedConfig = mergePlanConfigWithEditingBlocks(
        planConfigRef.current,
        editingPlanIdRef.current,
        editingPageIdRef.current,
        blocksRef.current,
      );
      const desktopConfig = previewViewport === "desktop" ? mergedConfig : viewportStatesRef.current.desktop.planConfig;
      const mobileConfig = previewViewport === "mobile" ? mergedConfig : viewportStatesRef.current.mobile.planConfig;
      const combinedBlocks = buildCombinedPersistedBlocks(desktopConfig, mobileConfig);
      const payloadBytes = estimateUtf8Size(JSON.stringify(combinedBlocks));
      const message = error instanceof Error ? error.message : "发布失败，请检查网络后重试";
      savePublishFailureSnapshot({
        reason: message,
        bytes: payloadBytes,
        blocks: combinedBlocks,
      });
      trackPublishEvent({
        success: false,
        bytes: payloadBytes,
        changedBlocks: Math.max(
          1,
          (() => {
            const diff = computePublishDiffSummary(combinedBlocks, loadPublishedBlocksFromStorage(homeBlocks));
            return diff.changedCount + diff.addedCount + diff.removedCount;
          })(),
        ),
        reason: message,
      });
      if (error instanceof Error && error.message.includes("保存超时")) {
        showPublishFailedTip("发布超时，请压缩图片或减少数据量");
      } else {
        showPublishFailedTip(error instanceof Error ? error.message : "发布失败，请检查网络后重试");
      }
      const nextPreset = await openCompressionPresetDialog(
        "是否切换上传压缩策略后再试？切换后会作用于后续上传的新图片。",
      );
      if (nextPreset) {
        setUploadCompressionPreset(nextPreset);
        showTip(`已切换上传压缩：${IMAGE_COMPRESSION_OPTIONS[nextPreset].label}`, {
          durationMs: 3200,
          dismissOnPointer: true,
        });
      }
    } finally {
      setPublishing(false);
    }
  }

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    const { error } = await supabase.auth.signOut();
    setLoggingOut(false);

    if (error) {
      setTip(`退出失败：${error.message}`);
      return;
    }

    window.location.href = "/login";
  }

  if (checkingAuth) {
    return (
      <main className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-sm text-gray-600">{"正在检查登录状态..."}</div>
      </main>
    );
  }

  const pageBackgroundSource = blocks[0]?.props;
  const pageBackgroundStyle = getBackgroundStyle({
    imageUrl: pageBackgroundSource?.pageBgImageUrl,
    fillMode: pageBackgroundSource?.pageBgFillMode,
    position: pageBackgroundSource?.pageBgPosition,
    color: pageBackgroundSource?.pageBgColor,
    opacity: pageBackgroundSource?.pageBgOpacity,
    imageOpacity: pageBackgroundSource?.pageBgImageOpacity,
    colorOpacity: pageBackgroundSource?.pageBgColorOpacity,
  });
  const editingPlan = planConfig.plans.find((plan) => plan.id === editingPlanId) ?? planConfig.plans[0];
  const editingPages = editingPlan?.pages?.length
    ? editingPlan.pages
    : [{ id: "page-1", name: "页面1", blocks: editingPlan?.blocks ?? homeBlocks }];
  const imageCompressionOptions = getCurrentImageCompressionOptions();
  const selectedBlock = blocks.find((item) => item.id === selectedId) ?? null;
  const selectedBlockLocked = selectedBlock?.props.blockLocked === true;
  const maxBlockOffsetY = blocks.reduce((max, block) => {
    const value =
      typeof block.props.blockOffsetY === "number" && Number.isFinite(block.props.blockOffsetY)
        ? Math.round(block.props.blockOffsetY)
        : 0;
    return Math.max(max, value);
  }, 0);
  const mobileFrontendPreviewPadding = Math.max(120, Math.max(0, maxBlockOffsetY) + 100);
  return (
    <main
      className="min-h-screen bg-gray-100"
      style={{ paddingTop: `${Math.max(topBarHeight, 56)}px` }}
      onMouseDownCapture={handleEditorMouseDownCapture}
    >
      <div ref={topBarRef} data-editor-toolbar className="fixed inset-x-0 top-0 z-[15000] bg-white border-b shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-lg font-bold">{"页面编辑器"}</div>
            <button
              type="button"
              className="px-2 py-1 rounded border bg-white hover:bg-gray-50 text-xs"
              onClick={() => setTopBarCollapsed((prev) => !prev)}
            >
              {topBarCollapsed ? "展开" : "收起"}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="px-3 py-2 rounded border bg-white hover:bg-gray-50"
              onClick={() => (window.location.href = "/")}
            >
              {"去前台"}
            </button>
            <button
              className="px-3 py-2 rounded border bg-white hover:bg-gray-50"
              onClick={() => void showAnalyticsSummary()}
            >
              {"数据统计"}
            </button>
            <button
              className="px-3 py-2 rounded border bg-white hover:bg-gray-50"
              onClick={async () => {
                const mergedConfig = mergePlanConfigWithEditingBlocks(
                  planConfigRef.current,
                  editingPlanIdRef.current,
                  editingPageIdRef.current,
                  blocksRef.current,
                );
                const desktopConfig = previewViewport === "desktop" ? mergedConfig : viewportStatesRef.current.desktop.planConfig;
                const mobileConfig = previewViewport === "mobile" ? mergedConfig : viewportStatesRef.current.mobile.planConfig;
                const combinedBlocks = buildCombinedPersistedBlocks(desktopConfig, mobileConfig);
                const payloadBytes = estimateUtf8Size(JSON.stringify(combinedBlocks));
                const passed = await runPublishPreflightDialog(combinedBlocks, payloadBytes);
                if (passed) showTip("发布体检通过");
              }}
            >
              {"发布体检"}
            </button>
            <button
              className="px-3 py-2 rounded border bg-white hover:bg-gray-50"
              onClick={rollbackToLastSuccessfulPublished}
            >
              {"回滚发布"}
            </button>
            <button
              className="px-3 py-2 rounded border bg-white hover:bg-gray-50"
              onClick={restoreLatestFailedSnapshot}
            >
              {"恢复失败草稿"}
            </button>
            <button
              className="px-3 py-2 rounded bg-black text-white disabled:opacity-50"
              onClick={publishToFrontend}
              disabled={publishing}
            >
              {publishing ? "发布中..." : "发布"}
            </button>
          </div>
          <button
            className="px-3 py-2 rounded border bg-white hover:bg-gray-50 disabled:opacity-50"
            onClick={logout}
            disabled={loggingOut}
          >
            {loggingOut ? "退出中..." : "退出登录"}
          </button>
        </div>
        {!topBarCollapsed ? (
          <>
            <div className="border-t">
              <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 flex-wrap">
              <select
                className="border p-2 rounded min-w-[140px]"
                value={editingPlanId}
                onChange={(e) => switchEditingPlan(e.target.value as PlanId)}
                title="选择要编辑的方案"
              >
                {planConfig.plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {"编辑："}{plan.name}
                  </option>
                ))}
              </select>
              <select
                className="border p-2 rounded min-w-[140px]"
                value={editingPageId}
                onChange={(e) => switchEditingPage(e.target.value)}
                title="选择要编辑的页面"
              >
                {editingPages.map((page) => (
                  <option key={page.id} value={page.id}>
                    {"页面："}{toPlainText(page.name, page.id)}
                  </option>
                ))}
              </select>
	              <div className="inline-flex items-center rounded border overflow-hidden">
	                <button
	                  type="button"
	                  className={`px-3 py-2 text-sm ${previewViewport === "desktop" ? "bg-black text-white" : "bg-white hover:bg-gray-50"}`}
	                  onClick={() => switchPreviewViewport("desktop")}
                >
                  PC
                </button>
                <button
                  type="button"
                  className={`px-3 py-2 text-sm border-l ${previewViewport === "mobile" ? "bg-black text-white" : "bg-white hover:bg-gray-50"}`}
                  onClick={() => switchPreviewViewport("mobile")}
                >
	                  手机
	                </button>
	              </div>
	              <button
	                className="px-2 py-2 rounded border bg-white hover:bg-gray-50 text-xs"
	                onClick={() => copySelectedBlockStyleToViewport("mobile")}
	                title="将当前选中区块样式复制到手机端"
	              >
	                {"样式->手机"}
	              </button>
	              <button
	                className="px-2 py-2 rounded border bg-white hover:bg-gray-50 text-xs"
	                onClick={() => copySelectedBlockStyleToViewport("desktop")}
	                title="将当前选中区块样式复制到PC端"
	              >
	                {"样式->PC"}
	              </button>
	              <div className="w-px h-6 bg-gray-200 mx-1" />
              <button
                className="px-3 py-2 rounded bg-black text-white disabled:opacity-50"
                onClick={saveDraft}
                title="保存草稿"
                aria-label="保存草稿"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M5 4h12l2 2v14H5z" />
                  <path d="M8 4v6h8V4" />
                  <path d="M8 18h8" />
                </svg>
              </button>
              <button
                className="px-3 py-2 rounded border bg-white hover:bg-gray-50 disabled:opacity-50"
                onClick={undoEdit}
                disabled={!canUndo}
                title="撤销"
                aria-label="撤销"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M9 8 5 12l4 4" />
                  <path d="M6 12h8a5 5 0 0 1 0 10h-1" />
                </svg>
              </button>
              <button
                className="px-3 py-2 rounded border bg-white hover:bg-gray-50 disabled:opacity-50"
                onClick={redoEdit}
                disabled={!canRedo}
                title="重复"
                aria-label="重复"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="m15 8 4 4-4 4" />
                  <path d="M18 12h-8a5 5 0 0 0 0 10h1" />
                </svg>
              </button>
              <div className="w-px h-6 bg-gray-200 mx-1" />
              <button
                className="px-3 py-2 rounded border bg-white hover:bg-gray-50"
                onClick={insertPageImage}
              >
                {"插入背景"}
              </button>
              <button
                className="px-3 py-2 rounded border bg-white hover:bg-gray-50"
                onClick={() => void editPageImageSettings()}
              >
                {"背景参数"}
              </button>
	              <select
	                className="border p-2 rounded min-w-[120px]"
	                value={uploadCompressionPreset}
	                onChange={(e) => setUploadCompressionPreset(e.target.value as UploadCompressionPreset)}
	                title="上传压缩策略"
              >
                <option value="high">上传压缩：高质量</option>
	                <option value="balanced">上传压缩：平衡</option>
	                <option value="compact">上传压缩：压缩优先</option>
	              </select>
	              <button
	                className="px-3 py-2 rounded border bg-white hover:bg-gray-50"
	                onClick={() => void externalizeCurrentPageLargeImages()}
	                title="把当前页大图转为外链 URL"
	              >
	                {"外链化大图"}
	              </button>
	              <button
	                className="px-3 py-2 rounded border bg-white hover:bg-gray-50"
	                onClick={() => void recompressCurrentPageImages()}
	                title="批量重压当前页内嵌图片"
	              >
	                {"重压当前页"}
	              </button>
              <select
                className="border p-2 rounded min-w-[130px]"
                value={themePreset}
                onChange={(e) => {
                  const nextPreset = e.target.value as ThemePresetKey;
                  setThemePreset(nextPreset);
                  applyThemePresetToCurrentPage(nextPreset);
                }}
                title="风格"
              >
                {(Object.entries(THEME_PRESETS) as Array<[ThemePresetKey, ThemePreset]>).map(([key, item]) => (
                  <option key={key} value={key}>
                    {item.label}
                  </option>
                ))}
              </select>
              <button
                className="px-3 py-2 rounded border bg-white hover:bg-gray-50"
                onClick={toggleSelectedBlockLock}
                title="锁定后不可拖动微调"
              >
                {"锁定/解锁"}
              </button>
              <div className="text-xs text-gray-600 px-1">
                {selectedBlock ? (selectedBlockLocked ? "已锁定" : "未锁定") : "未选中区块"}
              </div>
              <div className="w-px h-6 bg-gray-200 mx-1" />
              <select
                className="border p-2 rounded min-w-[180px]"
                value={newBlockType}
                onChange={(e) => setNewBlockType(e.target.value as Block["type"])}
              >
                <option value="common">{"通用"}</option>
                <option value="gallery">{"相册"}</option>
                <option value="chart">{"图表"}</option>
                <option value="nav">{"导航"}</option>
                <option value="music">{"音乐"}</option>
                <option value="contact">{"联系方式"}</option>
              </select>
              <button
                className="px-3 py-2 rounded border bg-white hover:bg-gray-50"
                onClick={addBlock}
                title="新增区块"
                aria-label="新增区块"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
              </button>
                  <input
                    ref={pageImageInputRef}
                    className="hidden"
                    type="file"
                    accept="image/*"
                    onChange={handlePageImageUpload}
                  />
                </div>
              </div>
            </div>
            {previewViewport === "mobile" ? (
              <div className="border-t">
                <div className="max-w-6xl mx-auto px-6 py-2">
                  <button
                    type="button"
                    className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
                    onClick={() => void readDesktopIntoMobile()}
                  >
                    读取PC
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      {previewViewport === "mobile" ? (
        <div className="min-h-screen bg-gray-200 py-6">
          <div className="mx-auto w-full max-w-[1280px] px-3 lg:px-4 flex items-start justify-center gap-20">
            <div className="hidden lg:block w-[430px] shrink-0">
              <div className="sticky" style={{ top: `${Math.max(topBarHeight + 16, 72)}px` }}>
                <div className="rounded-[36px] border-8 border-gray-900 bg-black p-2 shadow-2xl">
                  <div
                    className="relative rounded-[28px] overflow-hidden min-h-[780px]"
                    style={{ ...pageBackgroundStyle, paddingBottom: `${mobileFrontendPreviewPadding}px` }}
                  >
                    <div className="relative z-10 w-full px-3 py-4">
                      <BlockRenderer
                        blocks={blocks}
                        currentPageId={editingPageId}
                        onNavigatePage={(pageId) => {
                          if (editingPages.some((page) => page.id === pageId)) switchEditingPage(pageId);
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="w-full max-w-[430px] px-1">
              <div className="rounded-[36px] border-8 border-gray-900 bg-black p-2 shadow-2xl">
                <div
                  ref={backgroundLayerRef}
                  className="relative rounded-[28px] overflow-visible"
                  style={{ minHeight: `${Math.max(backgroundLayerMinHeight, 780)}px` }}
                >
                  <div className="absolute inset-0 rounded-[28px] overflow-hidden pointer-events-none" style={pageBackgroundStyle} />
                  <div className="relative z-10 w-full px-3 py-4 space-y-4">
                    <div className="space-y-4">
                      {blocks.map((block, index) => {
                        const sourceIndex = resizePreview ? blocks.findIndex((item) => item.id === resizePreview.blockId) : -1;
                        const previewOffsetY = sourceIndex >= 0 && index > sourceIndex ? -resizePreview!.heightDelta : 0;
                        return (
                          <InlineEditorBlock
                            key={block.id}
                            block={block}
                            draggingBlockId={draggingBlockId}
                            isSelected={block.id === selectedId}
                            onDragHandleMouseDown={(point) => startDraggingBlock(block.id, point)}
                            onNudge={(dx, dy) => nudgeBlock(block.id, dx, dy)}
                            onLayerToFront={() => moveBlockToLayerEdge(block.id, "front")}
                            onLayerUp={() => moveBlockLayerByOne(block.id, "up")}
                            onLayerDown={() => moveBlockLayerByOne(block.id, "down")}
                            onLayerToBack={() => moveBlockToLayerEdge(block.id, "back")}
                            onSelect={() => setSelectedId(block.id)}
                            onChange={(patch) => updateBlockProps(block.id, patch)}
                            onResizePreview={(heightDelta) => previewResizeWithoutAffectingOthers(block.id, heightDelta)}
                            onResizeCommit={(patch, heightDelta) => resizeBlockWithoutAffectingOthers(block.id, patch, heightDelta)}
                            previewOffsetY={previewOffsetY}
                            onDelete={() => void deleteBlock(block.id)}
                            onAlert={(message) => {
                              void openAlert(message);
                            }}
                            availablePages={editingPages.map((page) => ({ id: page.id, name: toPlainText(page.name, page.id) }))}
                            currentPageId={editingPageId}
                            recentColors={recentColors}
                            onRecordColor={recordRecentColor}
                            onClearRecentColors={clearRecentColors}
                            imageCompressionOptions={imageCompressionOptions}
                          />
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div
          ref={backgroundLayerRef}
          className="min-h-screen"
          style={{ ...pageBackgroundStyle, minHeight: `${Math.max(backgroundLayerMinHeight, 0)}px` }}
        >
          <div className="max-w-6xl mx-auto px-6 py-6 space-y-4">
            <div className="space-y-4">
              {blocks.map((block, index) => {
                const sourceIndex = resizePreview ? blocks.findIndex((item) => item.id === resizePreview.blockId) : -1;
                const previewOffsetY = sourceIndex >= 0 && index > sourceIndex ? -resizePreview!.heightDelta : 0;
                return (
                  <InlineEditorBlock
                    key={block.id}
                    block={block}
                    draggingBlockId={draggingBlockId}
                    isSelected={block.id === selectedId}
                    onDragHandleMouseDown={(point) => startDraggingBlock(block.id, point)}
                    onNudge={(dx, dy) => nudgeBlock(block.id, dx, dy)}
                    onLayerToFront={() => moveBlockToLayerEdge(block.id, "front")}
                    onLayerUp={() => moveBlockLayerByOne(block.id, "up")}
                    onLayerDown={() => moveBlockLayerByOne(block.id, "down")}
                    onLayerToBack={() => moveBlockToLayerEdge(block.id, "back")}
                    onSelect={() => setSelectedId(block.id)}
                    onChange={(patch) => updateBlockProps(block.id, patch)}
                    onResizePreview={(heightDelta) => previewResizeWithoutAffectingOthers(block.id, heightDelta)}
                    onResizeCommit={(patch, heightDelta) => resizeBlockWithoutAffectingOthers(block.id, patch, heightDelta)}
                    previewOffsetY={previewOffsetY}
                    onDelete={() => void deleteBlock(block.id)}
                    onAlert={(message) => {
                      void openAlert(message);
                    }}
                    availablePages={editingPages.map((page) => ({ id: page.id, name: toPlainText(page.name, page.id) }))}
                    currentPageId={editingPageId}
                    recentColors={recentColors}
                    onRecordColor={recordRecentColor}
                    onClearRecentColors={clearRecentColors}
                    imageCompressionOptions={imageCompressionOptions}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}

      {pageImageDialogOpen ? (
        <div className="fixed inset-0 z-[95] bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-xl border p-4 space-y-3">
            <div className="text-sm font-semibold">{"插入背景"}</div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">图片 URL</div>
              <input
                className="border p-2 rounded w-full text-sm"
                value={pageImageUrlInput}
                placeholder="https://example.com/bg.jpg"
                onChange={(e) => setPageImageUrlInput(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm cursor-pointer">
                {"上传背景图"}
                <input
                  className="hidden"
                  type="file"
                  accept="image/*"
                  onChange={handlePageImageUpload}
                />
              </label>
              <button
                className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
                onClick={clearPageImage}
              >
                {"清除背景"}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="px-3 py-2 rounded bg-black text-white text-sm"
                onClick={applyPageImageFromInput}
              >
                {"应用"}
              </button>
              <button
                className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
                onClick={() => setPageImageDialogOpen(false)}
              >
                {"取消"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pageImageSettingsOpen ? (
        <div className="fixed inset-0 z-[96] bg-transparent flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-xl border p-4 space-y-3">
            <div className="text-sm font-semibold">{"背景设置"}</div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">{"填充方式"}</div>
              <select
                className="border p-2 rounded w-full text-sm"
                value={pageSettingsFillMode}
                onChange={(e) => setPageSettingsFillMode(e.target.value as ImageFillMode)}
              >
                {IMAGE_FILL_VALUES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">{"图片透明度："}{pageSettingsImageOpacity.toFixed(2)}</div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                className="w-full"
                value={pageSettingsImageOpacity}
                onChange={(e) => setPageSettingsImageOpacity(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">{"颜色透明度："}{pageSettingsColorOpacity.toFixed(2)}</div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                className="w-full"
                value={pageSettingsColorOpacity}
                onChange={(e) => setPageSettingsColorOpacity(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-600">{"背景位置（如 center, top, left top）"}</div>
              <select
                className="border p-2 rounded w-full text-sm"
                value={pageSettingsPosition}
                onChange={(e) => setPageSettingsPosition(e.target.value)}
              >
                {!BACKGROUND_POSITION_OPTIONS.includes(pageSettingsPosition) ? (
                  <option value={pageSettingsPosition}>{pageSettingsPosition}</option>
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
              <ColorOrGradientPicker value={pageSettingsColor} onChange={setPageSettingsColor} />
              <RecentColorBar
                colors={recentColors}
                onClear={clearRecentColors}
                onPick={(color) => setPageSettingsColor(color)}
                allowGradients
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="px-3 py-2 rounded bg-black text-white text-sm"
                onClick={applyPageImageSettings}
              >
                {"应用"}
              </button>
              <button
                className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
                onClick={() => setPageImageSettingsOpen(false)}
              >
                {"取消"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {dialog ? (
        <div className="fixed inset-0 z-[20000] bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-xl border shadow-xl p-4 space-y-3">
            <div className="text-base font-semibold">{dialog.title}</div>
            <div className="text-sm text-gray-700 whitespace-pre-wrap">{dialog.message}</div>
            <div className="flex justify-end gap-2 flex-wrap">
              {dialog.type === "compression-preset" ? (
                <>
                  <button
                    type="button"
                    className={`px-3 py-2 rounded border text-sm ${
                      dialog.currentPreset === "high" ? "bg-black text-white border-black" : "bg-white hover:bg-gray-50"
                    }`}
                    onClick={() => {
                      if (dialog.type === "compression-preset") dialog.resolve("high");
                      setDialog(null);
                    }}
                  >
                    {"高质量"}
                  </button>
                  <button
                    type="button"
                    className={`px-3 py-2 rounded border text-sm ${
                      dialog.currentPreset === "balanced" ? "bg-black text-white border-black" : "bg-white hover:bg-gray-50"
                    }`}
                    onClick={() => {
                      if (dialog.type === "compression-preset") dialog.resolve("balanced");
                      setDialog(null);
                    }}
                  >
                    {"平衡"}
                  </button>
                  <button
                    type="button"
                    className={`px-3 py-2 rounded border text-sm ${
                      dialog.currentPreset === "compact" ? "bg-black text-white border-black" : "bg-white hover:bg-gray-50"
                    }`}
                    onClick={() => {
                      if (dialog.type === "compression-preset") dialog.resolve("compact");
                      setDialog(null);
                    }}
                  >
                    {"压缩优先"}
                  </button>
                </>
              ) : null}
              {dialog.type === "confirm" ? (
                <button
                  type="button"
                  className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
                  onClick={() => {
                    if (dialog.type === "confirm") dialog.resolve(false);
                    setDialog(null);
                  }}
                >
                  {"取消"}
                </button>
              ) : null}
              {dialog.type === "compression-preset" ? (
                <button
                  type="button"
                  className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
                  onClick={() => {
                    if (dialog.type === "compression-preset") dialog.resolve(null);
                    setDialog(null);
                  }}
                >
                  {"暂不切换"}
                </button>
              ) : null}
              <button
                type="button"
                className="px-3 py-2 rounded bg-black text-white text-sm"
                onClick={() => {
                  if (dialog.type === "alert") dialog.resolve();
                  if (dialog.type === "confirm") dialog.resolve(true);
                  if (dialog.type === "compression-preset") dialog.resolve(dialog.currentPreset);
                  setDialog(null);
                }}
              >
                {"确定"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {tip ? (
        <div className="fixed inset-0 z-[110] pointer-events-none flex items-center justify-center p-4">
          <div className="px-4 py-2 rounded-lg bg-black/85 text-white text-sm shadow-lg">{tip}</div>
        </div>
      ) : null}
    </main>
  );
}

function InlineEditorBlock({
  block,
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
  currentPageId,
  recentColors,
  onRecordColor,
  onClearRecentColors,
  imageCompressionOptions,
}: {
  block: Block;
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
  currentPageId: string;
  recentColors: string[];
  onRecordColor: (color: string) => void;
  onClearRecentColors: () => void;
  imageCompressionOptions: { maxSide: number; quality: number };
}) {
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
  type NavEditorItem = {
    id: string;
    label: string;
    pageId: string;
  };

  const imageInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
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
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [imageUrlInput, setImageUrlInput] = useState("");
  const [typographyDialogOpen, setTypographyDialogOpen] = useState(false);
  const [typoFontFamily, setTypoFontFamily] = useState("");
  const [typoFontSize, setTypoFontSize] = useState(16);
  const [typoFontColor, setTypoFontColor] = useState("#111111");
  const [typoBold, setTypoBold] = useState(false);
  const [typoItalic, setTypoItalic] = useState(false);
  const [typoUnderline, setTypoUnderline] = useState(false);
  const [typoRememberLast, setTypoRememberLast] = useState(false);
  const [imageSettingsOpen, setImageSettingsOpen] = useState(false);
  const [borderSettingsOpen, setBorderSettingsOpen] = useState(false);
  const [layerSettingsOpen, setLayerSettingsOpen] = useState(false);
  const [borderColorInput, setBorderColorInput] = useState("#6b7280");
  const [navItemStyleDialogOpen, setNavItemStyleDialogOpen] = useState(false);
  const [navItemBgColorInput, setNavItemBgColorInput] = useState("#ffffff");
  const [navItemBgOpacityInput, setNavItemBgOpacityInput] = useState(1);
  const [navItemBorderStyleInput, setNavItemBorderStyleInput] = useState<BlockBorderStyle>("solid");
  const [navItemBorderColorInput, setNavItemBorderColorInput] = useState("#6b7280");
  const [navItemActiveBgColorInput, setNavItemActiveBgColorInput] = useState("#e5e7eb");
  const [navItemActiveBgOpacityInput, setNavItemActiveBgOpacityInput] = useState(1);
  const [navItemActiveBorderStyleInput, setNavItemActiveBorderStyleInput] = useState<BlockBorderStyle>("solid");
  const [navItemActiveBorderColorInput, setNavItemActiveBorderColorInput] = useState("#111827");
  const [settingsFillMode, setSettingsFillMode] = useState<ImageFillMode>("cover");
  const [settingsPosition, setSettingsPosition] = useState("center");
  const [settingsColor, setSettingsColor] = useState("");
  const [settingsImageOpacity, setSettingsImageOpacity] = useState(1);
  const [settingsColorOpacity, setSettingsColorOpacity] = useState(1);
  const resizeTargetRef = useRef<HTMLDivElement | null>(null);
  const [draftResize, setDraftResize] = useState<{ width?: number; height?: number; offsetX?: number; offsetY?: number } | null>(null);
  const [commonInsertMode, setCommonInsertMode] = useState(false);
  const [activeCommonTextBoxId, setActiveCommonTextBoxId] = useState<string | null>(null);
  const [galleryEditorOpen, setGalleryEditorOpen] = useState(false);
  const [previewNavPageId, setPreviewNavPageId] = useState(currentPageId);
  const [layoutPanelOpen, setLayoutPanelOpen] = useState(false);
  const [customLayoutDialogOpen, setCustomLayoutDialogOpen] = useState(false);
  const [customLayoutDraft, setCustomLayoutDraft] = useState<CustomGalleryLayout>(createDefaultCustomGalleryLayout());
  const [selectedCustomRowIndex, setSelectedCustomRowIndex] = useState(0);
  const [activeGalleryImageId, setActiveGalleryImageId] = useState<string | null>(null);
  const [activeContactEntryKeys, setActiveContactEntryKeys] = useState<
    Array<"phone" | "email" | "whatsapp" | "wechat" | "tiktok" | "xiaohongshu" | "facebook" | "instagram">
  >([]);
  const [contactSnapEnabled, setContactSnapEnabled] = useState(true);
  const [contactSnapStep, setContactSnapStep] = useState(8);
  const contactCanvasFocusRef = useRef<HTMLDivElement | null>(null);
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
    if (current.length >= 12) return;
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
    imageDialogOpen || typographyDialogOpen || imageSettingsOpen || borderSettingsOpen || layerSettingsOpen || galleryEditorOpen;

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
    setTypographyDialogOpen(false);
    setImageSettingsOpen(false);
    setBorderSettingsOpen(false);
    setLayerSettingsOpen(false);
    setGalleryEditorOpen(false);
    setLayoutPanelOpen(false);
    setCustomLayoutDialogOpen(false);
    setCommonInsertMode(false);
    setActiveCommonTextBoxId(null);
    galleryDragRef.current = null;
    setActiveGalleryImageId(null);
    commonBoxDragRef.current = null;
    commonBoxResizeRef.current = null;
    commonBoxRotateRef.current = null;
    onResizePreview(0);
    activeEditorRef.current = null;
    selectedRangeRef.current = null;
  }, [isSelected, onResizePreview]);

  useEffect(() => {
    if (block.type !== "common") return;

    const readBoxes = (): CommonEditorTextBox[] => {
      const fromBoxes = Array.isArray(block.props.commonTextBoxes) ? block.props.commonTextBoxes : [];
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
      const legacyItems = Array.isArray(block.props.commonItems)
        ? block.props.commonItems.map((item) => item.trim()).filter(Boolean)
        : [];
      const fallbackItems =
        legacyItems.length > 0
          ? legacyItems
          : [block.props.heading, block.props.text].map((item) => (item ?? "").trim()).filter(Boolean);
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

    const onMove = (event: MouseEvent) => {
      const dragging = commonBoxDragRef.current;
      if (dragging) {
        const deltaX = event.clientX - dragging.startX;
        const deltaY = event.clientY - dragging.startY;
        const boxes = readBoxes();
        const current = boxes.find((item) => item.id === dragging.id);
        if (!current) return;
        const nextX = Math.round(dragging.boxStartX + deltaX);
        const nextY = Math.round(dragging.boxStartY + deltaY);
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
        const deltaX = event.clientX - resizing.startX;
        const deltaY = event.clientY - resizing.startY;
        const boxes = readBoxes();
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

        if (resizeFromLeft) {
          const rawWidth = resizing.boxStartWidth - deltaX;
          if (rawWidth >= minWidth) {
            nextWidth = rawWidth;
            nextX = resizing.boxStartX + deltaX;
          } else {
            nextWidth = minWidth;
            nextX = resizing.boxStartX + (resizing.boxStartWidth - minWidth);
          }
        } else if (resizeFromRight) {
          nextWidth = Math.max(minWidth, resizing.boxStartWidth + deltaX);
        }

        if (resizeFromTop) {
          const rawHeight = resizing.boxStartHeight - deltaY;
          if (rawHeight >= minHeight) {
            nextHeight = rawHeight;
            nextY = resizing.boxStartY + deltaY;
          } else {
            nextHeight = minHeight;
            nextY = resizing.boxStartY + (resizing.boxStartHeight - minHeight);
          }
        } else if (resizeFromBottom) {
          nextHeight = Math.max(minHeight, resizing.boxStartHeight + deltaY);
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
        latestWidth = Math.max(MIN_BLOCK_WIDTH, startWidth - deltaX);
        latestOffsetX = Math.round(startOffsetX + (startWidth - latestWidth));
      } else if (resizeFromRight) {
        latestWidth = Math.max(MIN_BLOCK_WIDTH, startWidth + deltaX);
        latestOffsetX = startOffsetX;
      } else {
        latestWidth = startWidth;
      }

      if (resizeFromTop) {
        latestHeight = Math.max(MIN_BLOCK_HEIGHT, startHeight - deltaY);
        latestOffsetY = Math.round(startOffsetY + (startHeight - latestHeight));
      } else if (resizeFromBottom) {
        latestHeight = Math.max(MIN_BLOCK_HEIGHT, startHeight + deltaY);
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
      const nextWidth = normalizeBlockWidth(Math.round(latestWidth));
      const nextHeight = normalizeBlockHeight(Math.round(latestHeight));
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
    if (field === "title" && block.type === "hero") {
      return { title: html };
    }
    if (field === "subtitle" && block.type === "hero") {
      return { subtitle: html };
    }
    if (field === "text" && (block.type === "text" || block.type === "common" || block.type === "chart")) {
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
        block.type === "nav")
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

  function editTypography() {
    const editor = activeEditorRef.current;
    if (!editor) {
      onAlert("请先点击要编辑的文本框");
      return;
    }

    if (typoRememberLast) {
      setTypographyDialogOpen(true);
      return;
    }

    const range = selectedRangeRef.current;
    const rangeInCurrentEditor = !!range && editor.contains(range.commonAncestorContainer);
    const selectedNode = (rangeInCurrentEditor ? range.commonAncestorContainer : editor) as HTMLElement;
    const element = selectedNode.nodeType === Node.ELEMENT_NODE ? selectedNode : selectedNode.parentElement;
    const style = element ? window.getComputedStyle(element) : null;
    setTypoFontFamily(style?.fontFamily?.replaceAll('"', "") ?? "");
    setTypoFontSize(Math.round(Number.parseFloat(style?.fontSize ?? "16")) || 16);
    setTypoFontColor(style?.color ?? "#111111");
    setTypoBold((style?.fontWeight ?? "").toString() === "700" || style?.fontWeight === "bold");
    setTypoItalic(style?.fontStyle === "italic");
    setTypoUnderline((style?.textDecorationLine ?? "").includes("underline"));
    setTypoRememberLast(true);
    setTypographyDialogOpen(true);
  }

  function applyTypography() {
    const editor = activeEditorRef.current;
    if (!editor) {
      onAlert("请先点击要编辑的文本框");
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
    const size = Math.max(8, Math.min(96, Number(typoFontSize) || 16));
    if (typoFontFamily.trim()) span.style.fontFamily = typoFontFamily.trim();
    if (typoFontColor.trim()) {
      if (isGradientToken(typoFontColor.trim())) {
        span.style.backgroundImage = typoFontColor.trim();
        span.style.backgroundClip = "text";
        span.style.webkitBackgroundClip = "text";
        span.style.color = "transparent";
      } else {
        span.style.color = typoFontColor.trim();
      }
    }
    span.style.fontSize = `${size}px`;
    span.style.fontWeight = typoBold ? "bold" : "normal";
    span.style.fontStyle = typoItalic ? "italic" : "normal";
    span.style.textDecoration = typoUnderline ? "underline" : "none";
    const blockLevelTypographyPatch: Partial<Block["props"]> = {
      fontFamily: typoFontFamily.trim() || undefined,
      fontColor: typoFontColor.trim() || undefined,
      fontSize: size,
      fontWeight: typoBold ? "bold" : "normal",
      fontStyle: typoItalic ? "italic" : "normal",
      textDecoration: typoUnderline ? "underline" : "none",
    };
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

    const commonBoxId = editor.dataset.commonBoxId?.trim();
    const fieldName = editor.dataset.field as RichFieldName | undefined;

    if (block.type === "common" && commonBoxId) {
      updateCommonTextBox(commonBoxId, { html: editor.innerHTML });
    } else {
      const contentPatch = fieldName ? getRichFieldPatch(fieldName, editor.innerHTML) : null;
      const mergedPatch: Partial<Block["props"]> = {
        ...(contentPatch ?? {}),
        ...(block.type !== "nav" ? blockLevelTypographyPatch : {}),
      };
      if (Object.keys(mergedPatch).length > 0) {
        onChange(mergedPatch);
      }
    }
    if (block.type === "nav") {
      const navItemId = editor.dataset.navItemId?.trim();
      if (navItemId) {
        updateNavItem(navItemId, { label: editor.innerHTML });
      }
    }
    onRecordColor(typoFontColor);
    setTypoRememberLast(true);

    setTypographyDialogOpen(false);
  }

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
    const inputEl = event.currentTarget;
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const result = await fileToOriginalImageDataUrl(file, imageCompressionOptions);
      onChange({
        bgImageUrl: result,
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
      onAlert(error instanceof Error ? error.message : "上传失败，请重试");
    } finally {
      inputEl.value = "";
    }
  }

  async function onUploadGalleryImages(event: ChangeEvent<HTMLInputElement>) {
    if (block.type !== "gallery") return;
    const inputEl = event.currentTarget;
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    try {
      const uploaded = await Promise.all(files.map((file) => fileToOriginalImageDataUrl(file, imageCompressionOptions)));
      const existing = getGalleryImages();
      const uploadedItems = uploaded.map((url, idx) => ({
        id: `img-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
        url,
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
    } catch (error) {
      onAlert(error instanceof Error ? error.message : "上传失败，请重试");
    } finally {
      inputEl.value = "";
    }
  }

  async function onReplaceGalleryImage(id: string, event: ChangeEvent<HTMLInputElement>) {
    if (block.type !== "gallery") return;
    const inputEl = event.currentTarget;
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const result = await fileToOriginalImageDataUrl(file, imageCompressionOptions);
      updateGalleryImage(id, { url: result });
    } catch (error) {
      onAlert(error instanceof Error ? error.message : "上传失败，请重试");
    } finally {
      inputEl.value = "";
    }
  }

  async function onUploadMusic(event: ChangeEvent<HTMLInputElement>) {
    if (block.type !== "music") return;
    const inputEl = event.currentTarget;
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const result = await fileToAudioDataUrl(file);
      onChange({ audioUrl: result });
    } catch (error) {
      onAlert(error instanceof Error ? error.message : "上传失败，请重试");
    } finally {
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
    if (block.type !== "common") return [];
    const fromBoxes = Array.isArray(block.props.commonTextBoxes) ? block.props.commonTextBoxes : [];
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
    const legacyItems = Array.isArray(block.props.commonItems) ? block.props.commonItems.map((item) => item.trim()).filter(Boolean) : [];
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

  function commitCommonTextBoxes(nextBoxes: CommonEditorTextBox[]) {
    if (block.type !== "common") return;
    onChange({
      commonTextBoxes: nextBoxes,
      commonItems: undefined,
      heading: undefined,
      text: undefined,
    });
  }

  function updateCommonTextBox(id: string, patch: Partial<CommonEditorTextBox>) {
    if (block.type !== "common") return;
    const next = getCommonTextBoxes().map((item) => (item.id === id ? { ...item, ...patch } : item));
    commitCommonTextBoxes(next);
  }

  function deleteCommonTextBox(id: string) {
    if (block.type !== "common") return;
    const next = getCommonTextBoxes().filter((item) => item.id !== id);
    commitCommonTextBoxes(next);
    if (activeCommonTextBoxId === id) {
      setActiveCommonTextBoxId(null);
    }
  }

  function insertTextBox() {
    if (block.type === "common") {
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
    onAlert("当前区块类型不支持插入文本");
  }

  function handleCommonCanvasMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    if (block.type !== "common") return;
    if (!commonInsertMode) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-common-box]")) return;
    const canvas = commonCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = Math.max(0, Math.round(event.clientX - rect.left));
    const clickY = Math.max(0, Math.round(event.clientY - rect.top));
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
    if (block.type !== "common") return;
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
    if (block.type !== "common") return;
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
    if (block.type !== "common") return;
    event.preventDefault();
    event.stopPropagation();
    const canvas = commonCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const centerX = rect.left + box.x + box.width / 2;
    const centerY = rect.top + box.y + box.height / 2;
    commonBoxRotateRef.current = {
      id: box.id,
      centerX,
      centerY,
      startMouseAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX),
      startRotateDeg: box.rotateDeg,
    };
    setActiveCommonTextBoxId(box.id);
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
    setNavItemBgColorInput(currentBgColor || "#ffffff");
    setNavItemBgOpacityInput(
      typeof block.props.navItemBgOpacity === "number" && Number.isFinite(block.props.navItemBgOpacity)
        ? Math.max(0, Math.min(1, block.props.navItemBgOpacity))
        : 1,
    );
    setNavItemBorderStyleInput((block.props.navItemBorderStyle ?? "solid") as BlockBorderStyle);
    setNavItemBorderColorInput(currentBorderColor || "#6b7280");
    setNavItemActiveBgColorInput(currentActiveBgColor || "#e5e7eb");
    setNavItemActiveBgOpacityInput(
      typeof block.props.navItemActiveBgOpacity === "number" && Number.isFinite(block.props.navItemActiveBgOpacity)
        ? Math.max(0, Math.min(1, block.props.navItemActiveBgOpacity))
        : 1,
    );
    setNavItemActiveBorderStyleInput((block.props.navItemActiveBorderStyle ?? "solid") as BlockBorderStyle);
    setNavItemActiveBorderColorInput(currentActiveBorderColor || "#111827");
    setNavItemStyleDialogOpen(true);
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

  function applyNavItemStyle() {
    if (block.type !== "nav") return;
    onChange({
      navItemBgColor: navItemBgColorInput.trim() || undefined,
      navItemBgOpacity: Math.max(0, Math.min(1, navItemBgOpacityInput)),
      navItemBorderStyle: navItemBorderStyleInput,
      navItemBorderColor: navItemBorderColorInput.trim() || undefined,
      navItemActiveBgColor: navItemActiveBgColorInput.trim() || undefined,
      navItemActiveBgOpacity: Math.max(0, Math.min(1, navItemActiveBgOpacityInput)),
      navItemActiveBorderStyle: navItemActiveBorderStyleInput,
      navItemActiveBorderColor: navItemActiveBorderColorInput.trim() || undefined,
    });
    onRecordColor(navItemBgColorInput);
    onRecordColor(navItemBorderColorInput);
    onRecordColor(navItemActiveBgColorInput);
    onRecordColor(navItemActiveBorderColorInput);
    setNavItemStyleDialogOpen(false);
  }

  const shellClass =
    block.type === "hero" ? "bg-white mx-auto" : "max-w-6xl mx-auto px-6 py-6";
  const borderClass = getBlockBorderClass(block.props.blockBorderStyle);
  const borderInlineStyle = getBlockBorderInlineStyle(block.props.blockBorderStyle, block.props.blockBorderColor);
  const cardClass =
    block.type === "hero"
      ? "max-w-6xl mx-auto px-6 py-10 pointer-events-auto"
      : `bg-white rounded-xl shadow-sm p-6 overflow-hidden pointer-events-auto ${borderClass}`;
  const blockBackgroundStyle = getBackgroundStyle({
    imageUrl: block.props.bgImageUrl,
    fillMode: block.props.bgFillMode,
    position: block.props.bgPosition,
    color: block.props.bgColor,
    opacity: block.props.bgOpacity,
    imageOpacity: block.props.bgImageOpacity,
    colorOpacity: block.props.bgColorOpacity,
  });
  const blockWidth = draftResize?.width ?? normalizeBlockWidth(block.props.blockWidth);
  const blockHeight = draftResize?.height ?? normalizeBlockHeight(block.props.blockHeight);
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
  const blockLayer =
    typeof block.props.blockLayer === "number" && Number.isFinite(block.props.blockLayer)
      ? Math.max(1, Math.round(block.props.blockLayer))
      : 1;
  const effectiveOffsetX = draftResize?.offsetX ?? offsetX;
  const effectiveOffsetY = (draftResize?.offsetY ?? offsetY) + previewOffsetY;
  const isEditingBlock = isSelected || hasOverlayOpen;
  const offsetStyle = {
    position: "relative" as const,
    transform:
      effectiveOffsetX || effectiveOffsetY ? `translate(${effectiveOffsetX}px, ${effectiveOffsetY}px)` : undefined,
    zIndex: isDraggingSource ? 10000 : isEditingBlock ? 9999 : blockLayer,
  };
  const blockSizeStyle = {
    width: blockWidth ? `${blockWidth}px` : undefined,
    height: blockHeight ? `${blockHeight}px` : undefined,
  };
  const resizeHandles = isBlockLocked ? null : (
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
    <div data-editor-overlay className="fixed inset-0 z-[12000] bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-xl border p-4 space-y-3">
        <div className="text-sm font-semibold">{"插入图片"}</div>
        <div className="space-y-1">
          <div className="text-xs text-gray-600">图片 URL</div>
          <input
            className="border p-2 rounded w-full text-sm"
            value={imageUrlInput}
            placeholder="https://example.com/bg.jpg"
            onChange={(e) => setImageUrlInput(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm cursor-pointer">
            {"上传图片"}
            <input
              ref={imageInputRef}
              className="hidden"
              type="file"
              accept="image/*"
              onChange={onUploadImage}
            />
          </label>
          <button
            className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
            onClick={clearImage}
          >
            {"清除图片"}
          </button>
          <button
            className="px-3 py-2 rounded bg-black text-white text-sm"
            onClick={applyImageUrl}
          >
            {"应用"}
          </button>
          <button
            className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
            onClick={() => setImageDialogOpen(false)}
          >
            {"取消"}
          </button>
        </div>
        <div className="text-xs text-gray-500">{"选择文件后会立即读取，不会自动覆盖原图片。"}</div>
      </div>
    </div>
  ) : null;
  const imageSettingsDialog = imageSettingsOpen ? renderOverlay(
    <div data-editor-overlay className="fixed inset-0 z-[12000] bg-transparent flex items-center justify-center p-4">
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
          <input
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
          <input
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
    <div data-editor-overlay className="fixed inset-0 z-[12000] bg-black/40 flex items-center justify-center p-4">
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
        <div className="grid grid-cols-2 gap-2">
          {BLOCK_BORDER_STYLE_OPTIONS.map((option) => (
            <button
              key={option.value}
              className={`px-3 py-2 rounded text-sm border ${getBlockBorderClass(option.value)} ${
                ((block.props.blockBorderStyle ?? "glass") === "soft" ? "glass" : (block.props.blockBorderStyle ?? "glass")) ===
                option.value
                  ? "ring-2 ring-black"
                  : "bg-white"
              }`}
              style={getBlockBorderInlineStyle(option.value, borderColorInput)}
              onClick={() => applyBorderStyle(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
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
    <div data-editor-overlay className="fixed inset-0 z-[12000] bg-black/40 flex items-center justify-center p-4">
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
              <input
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
              <div className="grid grid-cols-3 gap-2">
                {BLOCK_BORDER_STYLE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`px-3 py-2 rounded text-sm border ${getBlockBorderClass(option.value)} ${
                      navItemBorderStyleInput === option.value ? "ring-2 ring-black" : "bg-white"
                    }`}
                    style={getBlockBorderInlineStyle(option.value, navItemBorderColorInput)}
                    onClick={() => setNavItemBorderStyleInput(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
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
              <input
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
              <div className="grid grid-cols-3 gap-2">
                {BLOCK_BORDER_STYLE_OPTIONS.map((option) => (
                  <button
                    key={`active-${option.value}`}
                    type="button"
                    className={`px-3 py-2 rounded text-sm border ${getBlockBorderClass(option.value)} ${
                      navItemActiveBorderStyleInput === option.value ? "ring-2 ring-black" : "bg-white"
                    }`}
                    style={getBlockBorderInlineStyle(option.value, navItemActiveBorderColorInput)}
                    onClick={() => setNavItemActiveBorderStyleInput(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
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
  const layerSettingsDialog = layerSettingsOpen ? renderOverlay(
    <div data-editor-overlay className="fixed inset-0 z-[12000] bg-black/40 flex items-center justify-center p-4">
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
          className="w-full px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm text-left"
          onClick={() => {
            onLayerUp();
            setLayerSettingsOpen(false);
          }}
        >
          {"上移一层"}
        </button>
        <button
          className="w-full px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm text-left"
          onClick={() => {
            onLayerDown();
            setLayerSettingsOpen(false);
          }}
        >
          {"下移一层"}
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
    <div data-editor-overlay className="fixed inset-0 z-[12000] bg-black/40 flex items-center justify-center p-4">
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
            <select
              className="border p-2 rounded w-full text-sm"
              value={String(typoFontSize)}
              onChange={(e) => setTypoFontSize(Number(e.target.value))}
            >
              {FONT_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
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
            fontSize: typoFontSize,
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
            onClick={() => setTypographyDialogOpen(false)}
          >
            {"取消"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  if (block.type === "common") {
    const commonBoxes = getCommonTextBoxes();
    return (
      <section data-block-id={block.id} className={`${shellClass} pointer-events-none`} style={offsetStyle}>
        <EditorBlockHeader
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
          onDelete={onDelete}
        />
        <div
          ref={resizeTargetRef}
          className={`${cardClass} relative !overflow-visible`}
          onClick={onSelect}
          style={{ ...blockBackgroundStyle, ...blockSizeStyle, ...borderInlineStyle }}
        >
          {imageDialog}
          {imageSettingsDialog}
          {borderSettingsDialog}
          {layerSettingsDialog}
          {typographyDialog}
          <div
            ref={commonCanvasRef}
            className={`mt-2 relative min-h-[280px] rounded overflow-visible ${isSelected && commonInsertMode ? "cursor-crosshair" : ""}`}
            onMouseDown={handleCommonCanvasMouseDown}
          >
            {commonBoxes.map((box) => (
              <div
                key={box.id}
                data-common-box
                className={`absolute bg-transparent ${isSelected ? "border" : "border-transparent"} ${
                  activeCommonTextBoxId === box.id ? "border-black" : "border-gray-300/70"
                }`}
                style={{
                  left: `${box.x}px`,
                  top: `${box.y}px`,
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
                      {"×"}
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
              className="absolute right-[56px] top-2 pointer-events-auto px-2 py-1 text-[11px] rounded border bg-white hover:bg-gray-50 cursor-pointer"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              {"更改"}
              <input
                className="hidden"
                type="file"
                accept="image/*"
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
              <input
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
              <input
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
      <section data-block-id={block.id} className={`${shellClass} pointer-events-none`} style={offsetStyle}>
        <EditorBlockHeader
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
          onDelete={onDelete}
        />
        <div
          ref={resizeTargetRef}
          className={`${cardClass} relative`}
          onClick={onSelect}
          style={{ ...blockBackgroundStyle, ...blockSizeStyle, ...borderInlineStyle }}
        >
          {imageDialog}
          {imageSettingsDialog}
          {borderSettingsDialog}
          {layerSettingsDialog}
          {typographyDialog}
          {isSelected ? (
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
                    <div className="h-full flex items-center justify-center text-sm text-gray-500">{"暂无可显示图片"}</div>
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
                    <div data-editor-overlay className="fixed inset-0 z-[12000] bg-black/40 flex items-center justify-center p-4">
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
                            <label className="inline-flex items-center px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm cursor-pointer">
                              {"上传图片"}
                              <input
                                ref={galleryInputRef}
                                className="hidden"
                                type="file"
                                accept="image/*"
                                multiple
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
                          <div className="fixed inset-0 z-[13000] bg-black/40 flex items-center justify-center p-4">
                            <div className="w-full max-w-6xl bg-white rounded-xl border shadow-xl overflow-hidden">
                              <div className="px-4 py-3 border-b flex items-center justify-between">
                                <div className="text-sm font-semibold">{"自定义样式"}</div>
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
                                    <div className="text-xs text-gray-600">{"行高度"}</div>
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="range"
                                        min={120}
                                        max={600}
                                        step={10}
                                        className="flex-1"
                                        value={customLayoutDraft.rows[selectedCustomRowIndex]?.height ?? 220}
                                        onChange={(event) => setCustomRowHeight(selectedCustomRowIndex, Number(event.target.value))}
                                      />
                                      <input
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
                                      {"删除最后一帧"}
                                    </button>
                                    <button
                                      type="button"
                                      className="px-3 py-1 text-sm rounded border bg-white hover:bg-gray-50"
                                      onClick={clearSelectedRowFrames}
                                    >
                                      {"清空当前行"}
                                    </button>
                                  </div>
                                </div>
                                <div className="rounded border p-3 flex flex-col">
                                  <div className="text-xs text-gray-500 mb-2">{"点击样式按钮即可添加到选中行。"}</div>
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
                            {"暂无图片，请先上传图片"}
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
    const navItemButtonClass = "px-3 py-2 rounded overflow-hidden text-sm whitespace-pre-wrap";
    const navItemButtonStyle = {
      ...getBlockBorderInlineStyle(navItemBorderStyle, navItemBorderColor),
      ...getColorLayerStyle(navItemBgColor, navItemBgOpacity),
    };
    const navItemActiveButtonStyle = {
      ...getBlockBorderInlineStyle(navItemActiveBorderStyle, navItemActiveBorderColor),
      ...getColorLayerStyle(navItemActiveBgColor, navItemActiveBgOpacity),
    };
    const navCardClass = `${cardClass.replace("bg-white", "").trim()} relative`;
    const navBlockSizeStyle =
      orientation === "vertical"
        ? blockWidth
          ? blockSizeStyle
          : { ...blockSizeStyle, width: "max-content", maxWidth: "100%" }
        : blockSizeStyle;
    return (
      <section data-block-id={block.id} className={`${shellClass} pointer-events-none`} style={offsetStyle}>
        <EditorBlockHeader
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
          onDelete={onDelete}
        />
        <div
          ref={resizeTargetRef}
          className={`${navCardClass} ${isSelected ? "!overflow-visible" : ""}`}
          onClick={onSelect}
          style={{ ...blockBackgroundStyle, ...navBlockSizeStyle, ...borderInlineStyle }}
        >
          {imageDialog}
          {imageSettingsDialog}
          {borderSettingsDialog}
          {navItemStyleDialog}
          {layerSettingsDialog}
          {typographyDialog}
          {isSelected ? (
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
                <span className="min-w-[32px] text-center text-sm whitespace-nowrap shrink-0">{navItems.length}</span>
                <button
                  type="button"
                  className="w-8 h-8 rounded border bg-white hover:bg-gray-50 disabled:opacity-40 shrink-0"
                  onClick={addNavItem}
                  disabled={navItems.length >= 12}
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
              </div>
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
                {navItems.map((item) => (
                  <button
                    key={`preview-${item.id}`}
                    type="button"
                    className={`${navItemButtonClass} ${getBlockBorderClass(item.pageId === selectedNavPageId ? navItemActiveBorderStyle : navItemBorderStyle)} ${
                      item.pageId === selectedNavPageId ? "" : "hover:brightness-[0.98]"
                    }`}
                    style={item.pageId === selectedNavPageId ? navItemActiveButtonStyle : navItemButtonStyle}
                    onClick={() => {
                      onSelect();
                      setPreviewNavPageId(item.pageId);
                    }}
                  >
                    <span dangerouslySetInnerHTML={{ __html: toRichHtml(item.label, "") }} />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {block.props.heading ? (
                <div className="text-sm font-semibold whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: toRichHtml(block.props.heading, "页面导航") }} />
              ) : null}
              <div className={orientation === "vertical" ? "flex flex-col items-start gap-2" : "flex flex-wrap gap-2"}>
                {navItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`${navItemButtonClass} ${getBlockBorderClass(item.pageId === selectedNavPageId ? navItemActiveBorderStyle : navItemBorderStyle)} ${
                      item.pageId === selectedNavPageId ? "" : "hover:brightness-[0.98]"
                    }`}
                    style={item.pageId === selectedNavPageId ? navItemActiveButtonStyle : navItemButtonStyle}
                    onClick={() => {
                      onSelect();
                      setPreviewNavPageId(item.pageId);
                    }}
                  >
                    <span dangerouslySetInnerHTML={{ __html: toRichHtml(item.label, "") }} />
                  </button>
                ))}
              </div>
            </div>
          )}
          {resizeHandles}
        </div>
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
      <section data-block-id={block.id} className={`${shellClass} pointer-events-none`} style={offsetStyle}>
        <EditorBlockHeader
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
          onDelete={onDelete}
        />
        <div
          ref={resizeTargetRef}
          className={`${cardClass} relative`}
          onClick={onSelect}
          style={{ ...blockBackgroundStyle, ...blockSizeStyle, ...borderInlineStyle }}
        >
          {imageDialog}
          {imageSettingsDialog}
          {borderSettingsDialog}
          {layerSettingsDialog}
          {typographyDialog}
          {isSelected ? (
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
                  <option value="bar">{"柱状图"}</option>
                  <option value="line">{"折线图"}</option>
                  <option value="pie">{"饼图"}</option>
                </select>
                <textarea
                  className="border p-2 rounded w-full min-h-[100px] text-gray-700"
                  placeholder={"标签：每行一项"}
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
                <textarea
                  className="border p-2 rounded w-full min-h-[100px] text-gray-700"
                  placeholder={"数值：每行一个数字"}
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
            </>
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
                          {item.label}{"："}{item.value}
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
        className={`${shellClass} pointer-events-none`}
        style={offsetStyle}
      >
        <EditorBlockHeader
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
          onDelete={onDelete}
        />
        <div
          ref={resizeTargetRef}
          className={`${cardClass} relative`}
          onClick={onSelect}
          style={{ ...blockBackgroundStyle, ...blockSizeStyle, ...borderInlineStyle }}
        >
          {imageDialog}
          {imageSettingsDialog}
          {borderSettingsDialog}
          {layerSettingsDialog}
          {typographyDialog}
          {isSelected ? (
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
                  <input
                    ref={musicInputRef}
                    className="hidden"
                    type="file"
                    accept="audio/*"
                    onChange={onUploadMusic}
                  />
                  <input
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
                  <option value="hidden">{"隐藏播放器"}</option>
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
            </>
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
        data-block-id={block.id}
        className={`${shellClass} pointer-events-none relative rounded-xl overflow-visible ${borderClass}`}
        style={{ ...blockBackgroundStyle, ...blockSizeStyle, ...offsetStyle, ...borderInlineStyle }}
      >
        <EditorBlockHeader
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
          onDelete={onDelete}
        />
        <div className={cardClass} onClick={onSelect}>
          {imageDialog}
          {imageSettingsDialog}
          {borderSettingsDialog}
          {layerSettingsDialog}
          {typographyDialog}
          {isSelected ? (
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
            </>
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
        className={`${shellClass} pointer-events-none`}
        style={offsetStyle}
      >
        <EditorBlockHeader
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
          onDelete={onDelete}
        />
        <div
          ref={resizeTargetRef}
          className={`${cardClass} relative`}
          onClick={onSelect}
          style={{ ...blockBackgroundStyle, ...blockSizeStyle, ...borderInlineStyle }}
        >
          {imageDialog}
          {imageSettingsDialog}
          {borderSettingsDialog}
          {layerSettingsDialog}
          {typographyDialog}
          {isSelected ? (
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
            </>
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
        className={`${shellClass} pointer-events-none`}
        style={offsetStyle}
      >
        <EditorBlockHeader
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
          onDelete={onDelete}
        />
        <div
          ref={resizeTargetRef}
          className={`${cardClass} relative`}
          onClick={onSelect}
          style={{ ...blockBackgroundStyle, ...blockSizeStyle, ...borderInlineStyle }}
        >
          {imageDialog}
          {imageSettingsDialog}
          {borderSettingsDialog}
          {layerSettingsDialog}
          {typographyDialog}
          {isSelected ? (
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
                <textarea
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
            </>
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

  if (block.type === "contact") {
    type ContactEntryKey = "phone" | "email" | "whatsapp" | "wechat" | "tiktok" | "xiaohongshu" | "facebook" | "instagram";
    const contactLayout = block.props.contactLayout ?? {};
    const contactAddressEditorValues = (() => {
      const fromArray = Array.isArray(block.props.addresses)
        ? block.props.addresses.map((item) => toPlainText(String(item ?? ""), ""))
        : [];
      if (fromArray.length > 0) return fromArray;
      const fallback = toPlainText(block.props.address, "").trim();
      return [fallback];
    })();
    const contactAddresses = contactAddressEditorValues.map((item) => item.trim()).filter(Boolean);
    const contactEntries = [
      { key: "phone", label: "电话", value: toPlainText(block.props.phone, ""), platformLabel: "Phone" },
      { key: "email", label: "Email", value: (block.props.email ?? "").trim(), platformLabel: "Email" },
      { key: "whatsapp", label: "WhatsApp", value: (block.props.whatsapp ?? "").trim(), platformLabel: "WhatsApp" },
      { key: "wechat", label: "WeChat", value: (block.props.wechat ?? "").trim(), platformLabel: "WeChat" },
      { key: "tiktok", label: "TikTok", value: (block.props.tiktok ?? "").trim(), platformLabel: "TikTok" },
      { key: "xiaohongshu", label: "小红书", value: (block.props.xiaohongshu ?? "").trim(), platformLabel: "小红书" },
      { key: "facebook", label: "Facebook", value: (block.props.facebook ?? "").trim(), platformLabel: "Facebook" },
      { key: "instagram", label: "Instagram", value: (block.props.instagram ?? "").trim(), platformLabel: "Instagram" },
    ]
      .filter((item) => item.value)
      .map((item, index) => {
        const pos = contactLayout[item.key as keyof typeof contactLayout];
        const x = typeof pos?.x === "number" && Number.isFinite(pos.x) ? Math.max(0, Math.round(pos.x)) : 0;
        const y = typeof pos?.y === "number" && Number.isFinite(pos.y) ? Math.max(0, Math.round(pos.y)) : index * 48;
        const width = typeof pos?.width === "number" && Number.isFinite(pos.width) ? Math.max(200, Math.round(pos.width)) : 360;
        return { ...item, x, y, width };
      });
    const contactCanvasHeight = Math.max(180, ...contactEntries.map((item) => item.y + 42));
    const contactCanvasWidth = Math.max(280, ...contactEntries.map((item) => item.x + item.width));
    const socialIconUrl = (label: string) => {
      if (label === "Email") return "/social-icons/maildotru.svg";
      if (label === "WhatsApp") return "/social-icons/whatsapp.svg";
      if (label === "WeChat") return "/social-icons/wechat.svg";
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
        return [selectedKey, { x: found?.x ?? 0, y: found?.y ?? 0, width: found?.width ?? 360 }] as const;
      }));
      const onMove = (e: MouseEvent) => {
        const dx = Math.round(e.clientX - startX);
        const dy = Math.round(e.clientY - startY);
        const nextLayout = { ...contactLayout };
	        selectedKeys.forEach((selectedKey) => {
	          const origin = originMap.get(selectedKey);
	          if (!origin) return;
	          nextLayout[selectedKey] = {
	            x: maybeSnap(origin.x + dx),
	            y: maybeSnap(origin.y + dy),
	            width: clampContactLayoutValue((contactLayout[selectedKey] ?? {}).width, origin.width, 200),
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
    const startContactEntryResize = (key: ContactEntryKey, event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const source = contactEntries.find((item) => item.key === key);
      if (!source) return;
      const selectedKeys =
        activeContactEntryKeys.includes(key) && activeContactEntryKeys.length > 0 ? activeContactEntryKeys : [key];
      setActiveContactEntryKeys(selectedKeys);
      contactCanvasFocusRef.current?.focus();
      const startX = event.clientX;
      const originWidths = new Map(selectedKeys.map((selectedKey) => {
        const found = contactEntries.find((item) => item.key === selectedKey);
        return [selectedKey, found?.width ?? 360] as const;
      }));
      const onMove = (e: MouseEvent) => {
        const delta = Math.round(e.clientX - startX);
        const nextLayout = { ...contactLayout };
        selectedKeys.forEach((selectedKey) => {
          const found = contactEntries.find((item) => item.key === selectedKey);
	          const current = contactLayout[selectedKey] ?? {};
	          const originWidth = originWidths.get(selectedKey) ?? found?.width ?? 360;
	          const nextWidth = maybeSnap(originWidth + delta, 200);
	          nextLayout[selectedKey] = {
	            x: clampContactLayoutValue(current.x, found?.x ?? 0),
	            y: clampContactLayoutValue(current.y, found?.y ?? 0),
            width: nextWidth,
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
	        };
	      });
      onChange({ contactLayout: nextLayout });
    };
    const getSelectedContactEntries = () => {
      const keys = activeContactEntryKeys.length > 0 ? activeContactEntryKeys : [];
      return contactEntries.filter((item) => keys.includes(item.key as ContactEntryKey));
    };
    const alignSelectedContactEntries = (mode: "left" | "right" | "same-width" | "distribute-y") => {
      const selected = getSelectedContactEntries();
      if (selected.length === 0) return;
      const selectedKeys = selected.map((item) => item.key as ContactEntryKey);
      const nextLayout = { ...contactLayout };
      if (mode === "left") {
        const left = Math.min(...selected.map((item) => item.x));
        selected.forEach((item) => {
          const current = contactLayout[item.key as ContactEntryKey] ?? {};
          nextLayout[item.key as ContactEntryKey] = {
            x: left,
            y: clampContactLayoutValue(current.y, item.y),
            width: clampContactLayoutValue(current.width, item.width, 200),
          };
        });
      }
      if (mode === "right") {
        const right = Math.max(...selected.map((item) => item.x + item.width));
        selected.forEach((item) => {
          const current = contactLayout[item.key as ContactEntryKey] ?? {};
          nextLayout[item.key as ContactEntryKey] = {
            x: Math.max(0, right - item.width),
            y: clampContactLayoutValue(current.y, item.y),
            width: clampContactLayoutValue(current.width, item.width, 200),
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
          };
        });
      }
      if (mode === "distribute-y") {
        if (selected.length < 3) return;
        const sorted = [...selected].sort((a, b) => a.y - b.y);
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        const step = (last.y - first.y) / (sorted.length - 1);
        sorted.forEach((item, index) => {
          const current = contactLayout[item.key as ContactEntryKey] ?? {};
          nextLayout[item.key as ContactEntryKey] = {
            x: clampContactLayoutValue(current.x, item.x),
            y: Math.max(0, Math.round(first.y + step * index)),
            width: clampContactLayoutValue(current.width, item.width, 200),
          };
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
        contactEntries.forEach((item, idx) => {
          nextLayout[item.key as ContactEntryKey] = { x: 0, y: maybeSnap(idx * 48), width };
        });
      }
      if (mode === "single-wide") {
        const width = Math.max(240, safeCanvasWidth);
        contactEntries.forEach((item, idx) => {
          nextLayout[item.key as ContactEntryKey] = { x: 0, y: maybeSnap(idx * 56), width };
        });
      }
      if (mode === "double-column") {
        const gap = 14;
        const width = Math.max(200, Math.floor((safeCanvasWidth - gap) / 2));
        contactEntries.forEach((item, idx) => {
          const col = idx % 2;
          const row = Math.floor(idx / 2);
          nextLayout[item.key as ContactEntryKey] = {
            x: maybeSnap(col * (width + gap)),
            y: maybeSnap(row * 56),
            width,
          };
        });
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
    return (
      <section
        data-block-id={block.id}
        className={`${shellClass} pointer-events-none`}
        style={offsetStyle}
      >
        <EditorBlockHeader
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
          onDelete={onDelete}
        />
        <div
          ref={resizeTargetRef}
          className={`${cardClass} relative`}
          onClick={onSelect}
          style={{ ...blockBackgroundStyle, ...blockSizeStyle, ...borderInlineStyle }}
        >
          {imageDialog}
          {imageSettingsDialog}
          {borderSettingsDialog}
          {layerSettingsDialog}
          {typographyDialog}
          {isSelected ? (
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
                  field="phone"
                  className="border p-2 rounded w-full text-gray-700"
                  value={block.props.phone ?? ""}
                  onChange={handleRichFieldChange}
                  onActivate={registerActiveEditor}
                  onSelectionChange={updateSelectionRange}
                />
              </div>
              <div className="space-y-1 mt-3">
                <div className="border rounded p-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm text-gray-700">地址列表（可增加）</div>
                    <button
                      type="button"
                      className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                      onClick={() =>
                        updateContactAddresses([
                          ...contactAddressEditorValues,
                          `地址${contactAddressEditorValues.length + 1}`,
                        ])
                      }
                    >
                      添加地址
                    </button>
                  </div>
                  {contactAddressEditorValues.length > 0 ? (
                    contactAddressEditorValues.map((line, idx) => (
                      <div key={`${idx}-${line}`} className="flex items-center gap-2">
                        <input
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
                          onClick={() => {
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
                  <input
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
                  <input
                    type="checkbox"
                    checked={block.props.mapShowMarker !== false}
                    onChange={(e) => onChange({ mapShowMarker: e.target.checked })}
                  />
                  <span>地图使用地址标记</span>
                </label>
                <input
                  className="border p-2 rounded text-sm"
                  placeholder="邮箱"
                  value={block.props.email ?? ""}
                  onChange={(e) => onChange({ email: e.target.value })}
                />
                <input
                  className="border p-2 rounded text-sm"
                  placeholder="WhatsApp"
                  value={block.props.whatsapp ?? ""}
                  onChange={(e) => onChange({ whatsapp: e.target.value })}
                />
                <input
                  className="border p-2 rounded text-sm"
                  placeholder="WeChat"
                  value={block.props.wechat ?? ""}
                  onChange={(e) => onChange({ wechat: e.target.value })}
                />
                <input
                  className="border p-2 rounded text-sm"
                  placeholder="TikTok"
                  value={block.props.tiktok ?? ""}
                  onChange={(e) => onChange({ tiktok: e.target.value })}
                />
                <input
                  className="border p-2 rounded text-sm"
                  placeholder="小红书"
                  value={block.props.xiaohongshu ?? ""}
                  onChange={(e) => onChange({ xiaohongshu: e.target.value })}
                />
                <input
                  className="border p-2 rounded text-sm"
                  placeholder="Facebook"
                  value={block.props.facebook ?? ""}
                  onChange={(e) => onChange({ facebook: e.target.value })}
                />
                <input
                  className="border p-2 rounded text-sm md:col-span-2"
                  placeholder="Instagram"
                  value={block.props.instagram ?? ""}
                  onChange={(e) => onChange({ instagram: e.target.value })}
                />
              </div>
              <div className="mt-3">
                <div className="text-xs text-gray-500 mb-2">拖动条目可在联系方式区块内调整位置</div>
                <div className="mb-2 flex flex-wrap gap-2">
                  <label className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border bg-white">
                    <input
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
                    {"模板: 紧凑单列"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                    onClick={() => applyContactLayoutTemplate("single-wide")}
                  >
                    {"模板: 宽松单列"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                    onClick={() => applyContactLayoutTemplate("double-column")}
                  >
                    {"模板: 双列"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                    onClick={() => alignSelectedContactEntries("left")}
                  >
                    {"左对齐"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50"
                    onClick={() => alignSelectedContactEntries("right")}
                  >
                    {"右对齐"}
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
                      className={`absolute flex items-center justify-between gap-2 rounded border bg-white px-2 py-1 shadow-sm cursor-move ${
                        activeContactEntryKeys.includes(item.key as ContactEntryKey)
                          ? "border-blue-500 bg-blue-50/70 ring-4 ring-blue-400/45 shadow-md"
                          : "border-gray-300"
                      }`}
                      style={{ left: `${item.x}px`, top: `${item.y}px`, width: `${item.width}px` }}
                      onMouseDown={(event) => startContactEntryDrag(item.key as ContactEntryKey, event)}
                    >
                      <span className="text-sm text-gray-700 min-w-0 break-all flex-1">{item.label}：{item.value}</span>
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
                      <div
                        className="absolute top-0 right-0 h-full w-2 cursor-ew-resize"
                        onMouseDown={(event) => startContactEntryResize(item.key as ContactEntryKey, event)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <h2
                className="text-xl font-bold whitespace-pre-wrap break-words"
                dangerouslySetInnerHTML={{ __html: toRichHtml(block.props.heading, "") }}
              />
              <div className="mt-2 text-gray-700 space-y-1">
                {contactAddresses.length > 0 ? (
                  contactAddresses.map((line, idx) => (
                    <div key={`${line}-${idx}`} className="break-all">
                      {`地址${contactAddresses.length > 1 ? idx + 1 : ""}：${line}`}
                    </div>
                  ))
                ) : (
                  <div dangerouslySetInnerHTML={{ __html: `地址：${toRichHtml(block.props.address, "")}` }} />
                )}
              </div>
              <div
                className="mt-3 relative rounded border border-gray-200 bg-transparent"
                style={{ minHeight: `${contactCanvasHeight}px`, width: `${contactCanvasWidth}px`, maxWidth: "100%" }}
              >
                {contactEntries.map((item) => (
                  <div
                    key={item.key}
                    className="absolute flex items-center justify-between gap-2 rounded border bg-white px-2 py-1 shadow-sm"
                    style={{ left: `${item.x}px`, top: `${item.y}px`, width: `${item.width}px` }}
                  >
                    <span className="text-sm text-gray-700 min-w-0 break-all flex-1">{item.label}：{item.value}</span>
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

type RichFieldName = "title" | "subtitle" | "heading" | "text" | "phone" | "address";

function RecentColorBar({
  colors,
  onPick,
  onClear,
  allowGradients = true,
}: {
  colors: string[];
  onPick: (color: string) => void;
  onClear?: () => void;
  allowGradients?: boolean;
}) {
  const shownColors = allowGradients ? colors : colors.filter((item) => !isGradientToken(item));
  return (
    <div className="pt-1 space-y-1">
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-600">最近颜色</div>
        {onClear ? (
          <button type="button" className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={onClear}>
            清空
          </button>
        ) : null}
      </div>
      {shownColors.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {shownColors.map((color) => (
            <button
              key={color}
              type="button"
              className="w-6 h-6 rounded border border-gray-300"
              style={isGradientToken(color) ? { backgroundImage: color } : { backgroundColor: color }}
              title={color}
              onClick={() => onPick(color)}
            />
          ))}
        </div>
      ) : (
        <div className="text-xs text-gray-400 border border-dashed rounded px-2 py-2">暂无最近颜色</div>
      )}
    </div>
  );
}

function ColorOrGradientPicker({
  value,
  onChange,
  allowGradient = true,
}: {
  value: string;
  onChange: (next: string) => void;
  allowGradient?: boolean;
}) {
  return <ColorOrGradientPickerInner key={`${allowGradient ? "g" : "s"}:${value}`} value={value} onChange={onChange} allowGradient={allowGradient} />;
}

function ColorOrGradientPickerInner({
  value,
  onChange,
  allowGradient = true,
}: {
  value: string;
  onChange: (next: string) => void;
  allowGradient?: boolean;
}) {
  const parsed = parseGradientValue(value);
  const [mode, setMode] = useState<"solid" | "gradient">(allowGradient ? parsed.mode : "solid");
  const [solidColor, setSolidColor] = useState(parsed.solidColor);
  const [startColor, setStartColor] = useState(parsed.startColor);
  const [endColor, setEndColor] = useState(parsed.endColor);
  const [direction, setDirection] = useState<GradientDirection>(parsed.direction);

  return (
    <div className="space-y-2 rounded border p-2">
      <div className="flex gap-2">
        <button
          type="button"
          className={`px-2 py-1 text-xs rounded border ${mode === "solid" ? "bg-black text-white border-black" : "bg-white"}`}
          onClick={() => {
            setMode("solid");
            onChange(normalizeHexColor(solidColor) ?? "#ffffff");
          }}
        >
          纯色
        </button>
        {allowGradient ? (
          <button
            type="button"
            className={`px-2 py-1 text-xs rounded border ${mode === "gradient" ? "bg-black text-white border-black" : "bg-white"}`}
            onClick={() => {
              setMode("gradient");
              onChange(buildLinearGradient(direction, startColor, endColor));
            }}
          >
            渐变
          </button>
        ) : null}
      </div>
      {mode === "solid" || !allowGradient ? (
        <div className="grid grid-cols-[120px_1fr] gap-2 items-end">
          <input
            className="border p-1 rounded w-full h-10"
            type="color"
            value={normalizeHexColor(solidColor) ?? "#ffffff"}
            onChange={(e) => {
              setSolidColor(e.target.value);
              onChange(e.target.value);
            }}
          />
          <input
            className="border p-2 rounded w-full text-sm"
            value={solidColor}
            placeholder="#ffffff"
            onChange={(e) => {
              const next = e.target.value;
              setSolidColor(next);
              onChange(next);
            }}
          />
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="grid grid-cols-[44px_1fr] gap-2">
                <input
                  className="border p-1 rounded w-11 h-10"
                  type="color"
                  value={normalizeHexColor(startColor) ?? "#ffffff"}
                  onChange={(e) => {
                    const next = e.target.value;
                    setStartColor(next);
                    onChange(buildLinearGradient(direction, next, endColor));
                  }}
                />
                <input
                  className="border p-2 rounded w-full text-sm"
                  value={startColor}
                  onChange={(e) => {
                    const next = e.target.value;
                    setStartColor(next);
                    const normalized = normalizeHexColor(next);
                    if (normalized) {
                      onChange(buildLinearGradient(direction, normalized, endColor));
                    }
                  }}
                />
              </div>
            </div>
            <div className="space-y-1">
              <div className="grid grid-cols-[44px_1fr] gap-2">
                <input
                  className="border p-1 rounded w-11 h-10"
                  type="color"
                  value={normalizeHexColor(endColor) ?? "#000000"}
                  onChange={(e) => {
                    const next = e.target.value;
                    setEndColor(next);
                    onChange(buildLinearGradient(direction, startColor, next));
                  }}
                />
                <input
                  className="border p-2 rounded w-full text-sm"
                  value={endColor}
                  onChange={(e) => {
                    const next = e.target.value;
                    setEndColor(next);
                    const normalized = normalizeHexColor(next);
                    if (normalized) {
                      onChange(buildLinearGradient(direction, startColor, normalized));
                    }
                  }}
                />
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <select
              className="border p-2 rounded w-full text-sm"
              value={direction}
              onChange={(e) => {
                const next = e.target.value as GradientDirection;
                setDirection(next);
                onChange(buildLinearGradient(next, startColor, endColor));
              }}
            >
              {GRADIENT_DIRECTION_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div className="h-8 rounded border" style={{ backgroundImage: buildLinearGradient(direction, startColor, endColor) }} />
        </div>
      )}
    </div>
  );
}

function RichTextEditor({
  field,
  value,
  dataNavItemId,
  dataCommonBoxId,
  className,
  onChange,
  onActivate,
  onSelectionChange,
}: {
  field: RichFieldName;
  value: string;
  dataNavItemId?: string;
  dataCommonBoxId?: string;
  className: string;
  onChange: (field: RichFieldName, html: string, editor: HTMLDivElement | null) => void;
  onActivate: (editor: HTMLDivElement | null) => void;
  onSelectionChange: (range: Range | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    if (ref.current.innerHTML !== value) {
      ref.current.innerHTML = value;
    }
  }, [value]);

  function emitChange() {
    if (!ref.current) return;
    const html = ref.current.innerHTML.replaceAll("\u200B", "");
    onChange(field, html, ref.current);
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
      className={`${className} whitespace-pre-wrap break-words focus:outline-none`}
      contentEditable
      suppressContentEditableWarning
      onFocus={() => onActivate(ref.current)}
      onInput={emitChange}
      onKeyUp={updateSelection}
      onMouseUp={updateSelection}
    />
  );
}

function EditorBlockHeader({
  draggingBlockId,
  isSelected,
  onDragHandleMouseDown,
  onNudge,
  onOpenLayerSettings,
  onEditTypography,
  onInsertText,
  onInsertImage,
  onEditImageSettings,
  onEditBorderStyle,
  onDelete,
  toolbarAnchorClassName,
  toolbarAnchorStyle,
}: {
  draggingBlockId: string | null;
  isSelected: boolean;
  onDragHandleMouseDown: (point: { x: number; y: number }) => void;
  onNudge: (deltaX: number, deltaY: number) => void;
  onOpenLayerSettings: () => void;
  onEditTypography: () => void;
  onInsertText: () => void;
  onInsertImage: () => void;
  onEditImageSettings: () => void;
  onEditBorderStyle: () => void;
  onDelete: () => void;
  toolbarAnchorClassName?: string;
  toolbarAnchorStyle?: React.CSSProperties;
}) {
  const anchorClassName =
    toolbarAnchorClassName ?? "absolute left-0 bottom-full mb-[2px] z-[80] flex items-end gap-3 w-max max-w-none";
  return (
    <div data-editor-toolbar className="relative h-0 overflow-visible pointer-events-auto">
      {isSelected ? (
        <div className={anchorClassName} style={toolbarAnchorStyle}>
          <div className="z-30 translate-y-3">
            <div className="relative w-[96px] h-[90px] shrink-0">
              <button
                className="absolute left-1/2 top-[6px] -translate-x-1/2 w-8 h-8 flex items-center justify-center"
                onClick={(e) => {
                  e.stopPropagation();
                  onNudge(0, -NUDGE_STEP);
                }}
                title="上移微调"
                aria-label="上移微调"
              >
                <span className="block w-0 h-0 border-l-[7px] border-r-[7px] border-b-[11px] border-l-transparent border-r-transparent border-b-black" />
              </button>
              <button
                className="absolute left-1 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center"
                onClick={(e) => {
                  e.stopPropagation();
                  onNudge(-NUDGE_STEP, 0);
                }}
                title="左移微调"
                aria-label="左移微调"
              >
                <span className="block w-0 h-0 border-t-[7px] border-b-[7px] border-r-[11px] border-t-transparent border-b-transparent border-r-black" />
              </button>
              <button
                title="按住并拖动此按钮可自由拖动区块"
                className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 px-2 py-1 text-xs rounded border select-none ${
                  draggingBlockId ? "bg-gray-100" : "bg-white hover:bg-gray-50"
                } cursor-grab active:cursor-grabbing`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDragHandleMouseDown({ x: e.clientX, y: e.clientY });
                }}
              >
                {"拖动"}
              </button>
              <button
                className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center"
                onClick={(e) => {
                  e.stopPropagation();
                  onNudge(NUDGE_STEP, 0);
                }}
                title="右移微调"
                aria-label="右移微调"
              >
                <span className="block w-0 h-0 border-t-[7px] border-b-[7px] border-l-[11px] border-t-transparent border-b-transparent border-l-black" />
              </button>
              <button
                className="absolute left-1/2 bottom-[6px] -translate-x-1/2 w-8 h-8 flex items-center justify-center"
                onClick={(e) => {
                  e.stopPropagation();
                  onNudge(0, NUDGE_STEP);
                }}
                title="下移微调"
                aria-label="下移微调"
              >
                <span className="block w-0 h-0 border-l-[7px] border-r-[7px] border-t-[11px] border-l-transparent border-r-transparent border-t-black" />
              </button>
            </div>
          </div>
          <div className="z-30 flex items-center gap-2 flex-nowrap overflow-visible pr-1 pb-1">
            <button
              className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50 shrink-0 whitespace-nowrap"
              onClick={(e) => {
                e.stopPropagation();
                onEditTypography();
              }}
            >
              {"字体样式"}
            </button>
            <button
              className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50 shrink-0 whitespace-nowrap"
              onClick={(e) => {
                e.stopPropagation();
                onInsertText();
              }}
            >
              {"插入文字"}
            </button>
            <button
              className="px-2 py-1 text-xs rounded border bg-white hover:bg-gray-50 shrink-0 whitespace-nowrap"
              onClick={(e) => {
                e.stopPropagation();
                onInsertImage();
              }}
            >
              {"插入图片"}
            </button>
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
      ) : null}
    </div>
  );
}













