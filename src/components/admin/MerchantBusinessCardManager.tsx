"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { showGlobalToast } from "@/lib/globalToast";
import {
  MERCHANT_BUSINESS_CARD_RATIO_OPTIONS,
  MERCHANT_BUSINESS_CARD_CUSTOM_CONTACT_ICON_PRESETS,
  MERCHANT_BUSINESS_CARD_PHONE_LIMIT,
  applyMerchantBusinessCardContactFieldOrderToTextLayout,
  createDefaultMerchantBusinessCardDraft,
  getMerchantBusinessCardRequiredFields,
  normalizeMerchantBusinessCardChatDisplaySelection,
  normalizeMerchantBusinessCardDraft,
  normalizeMerchantBusinessCardContactSectionOrder,
  normalizeMerchantBusinessCardContactFieldOrder,
  resolveMerchantBusinessCardForChatDisplay,
  selectMerchantBusinessCardForChat,
  stripMerchantBusinessCardShareMetadata,
  type MerchantBusinessCardAsset,
  type MerchantBusinessCardContactDisplayKey,
  type MerchantBusinessCardContactOnlyFieldKey,
  type MerchantBusinessCardContactSectionKey,
  type MerchantBusinessCardCustomContactLink,
  type MerchantBusinessCardCustomText,
  type MerchantBusinessCardDraft,
  type MerchantBusinessCardFieldKey,
  type MerchantBusinessCardMode,
  type MerchantBusinessCardProfileInput,
} from "@/lib/merchantBusinessCards";
import { ColorOrGradientPicker, ColorSwatchPalette } from "@/components/admin/ColorOrGradientPicker";
import {
  buildMerchantBusinessCardShareUrl,
  createMerchantBusinessCardShareKey,
  createMerchantBusinessCardShareKeyCode,
  normalizeMerchantBusinessCardShareImageUrl,
  normalizeMerchantBusinessCardShareTargetUrl,
  resolveMerchantBusinessCardShareOrigin,
  type MerchantBusinessCardShareContact,
} from "@/lib/merchantBusinessCardShare";
import {
  uploadFileToPublicStorageWithMetadata,
  uploadImageDataUrlToPublicStorage,
} from "@/lib/publicAssetUpload";
import { normalizePublicAssetUrl } from "@/lib/publicAssetUrl";
import { buildMerchantDomain } from "@/lib/siteRouting";

type MerchantBusinessCardManagerProps = {
  merchantId?: string | null;
  siteBaseDomain: string;
  profile: MerchantBusinessCardProfileInput;
  cards: MerchantBusinessCardAsset[];
  targetUrlOverride?: string | null;
  folderViewMode?: "overlay" | "page";
  cardLimit?: number;
  allowLinkMode?: boolean;
  allowIntroVideo?: boolean;
  backgroundImageLimitKb?: number;
  contactPageImageLimitKb?: number;
  exportImageLimitKb?: number;
  introVideoLimitMb?: number;
  onCardsChange: (cards: MerchantBusinessCardAsset[]) => void | Promise<void>;
};

type MerchantBusinessCardEditableContactFieldKey = MerchantBusinessCardContactDisplayKey;
type MerchantBusinessCardContactDisplayTargetKey = "businessCard" | "contactCard";
type MerchantBusinessCardBackgroundPatch = Partial<
  Pick<MerchantBusinessCardAsset, "imageUrl" | "shareImageUrl" | "contactPagePublicImageUrl" | "shareKey">
>;
type ContactPreviewRow = {
  label: string;
  value: string;
  key?: MerchantBusinessCardEditableContactFieldKey;
  customLink?: MerchantBusinessCardCustomContactLink;
};

const CONTACT_FIELDS: Array<{ key: MerchantBusinessCardEditableContactFieldKey; label: string }> = [
  { key: "contactName", label: "联系人" },
  { key: "phone", label: "电话" },
  { key: "email", label: "邮箱" },
  { key: "address", label: "地址" },
  { key: "wechat", label: "微信" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "twitter", label: "Twitter" },
  { key: "weibo", label: "微博" },
  { key: "telegram", label: "Telegram" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "discord", label: "Discord" },
  { key: "facebook", label: "Facebook" },
  { key: "instagram", label: "Instagram" },
  { key: "tiktok", label: "TikTok" },
  { key: "douyin", label: "抖音" },
  { key: "xiaohongshu", label: "小红书" },
  { key: "googleReview", label: "Google" },
];

const CONTACT_FIELD_LABELS = Object.fromEntries(CONTACT_FIELDS.map((item) => [item.key, item.label])) as Record<
  MerchantBusinessCardEditableContactFieldKey,
  string
>;
const GOOGLE_REVIEW_DISPLAY_TEXT = "欢迎评价";

const CONTACT_CARD_SECTION_LABELS: Record<MerchantBusinessCardContactSectionKey, string> = {
  image: "联系卡图片",
  contacts: "联系方式",
  coupons: "优惠券",
};

const CUSTOM_CONTACT_ICON_PRESET_LABELS: Record<(typeof MERCHANT_BUSINESS_CARD_CUSTOM_CONTACT_ICON_PRESETS)[number], string> = {
  link: "链接",
  star: "星标",
  heart: "爱心",
  chat: "聊天",
  map: "定位",
  gift: "礼物",
  google: "Google",
  download: "下载",
  review: "评论",
  favorite: "收藏",
  checkin: "签到",
};

const CUSTOM_CONTACT_ICON_PRESET_SYMBOLS: Record<(typeof MERCHANT_BUSINESS_CARD_CUSTOM_CONTACT_ICON_PRESETS)[number], string> = {
  link: "↗",
  star: "★",
  heart: "♥",
  chat: "●",
  map: "⌖",
  gift: "□",
  google: "G",
  download: "↓",
  review: "评",
  favorite: "♡",
  checkin: "✓",
};

const CONTACT_FIELD_ICON_META: Record<
  MerchantBusinessCardEditableContactFieldKey,
  { iconUrl?: string; symbol?: string; bgColor: string; textColor?: string }
> = {
  contactName: { symbol: "人", bgColor: "#0f172a" },
  phone: { symbol: "☎", bgColor: "#007AFF" },
  email: { iconUrl: "/social-icons/maildotru.svg", bgColor: "#0A84FF" },
  address: { symbol: "⌖", bgColor: "#EA4335" },
  wechat: { iconUrl: "/social-icons/wechat.svg", bgColor: "#07C160" },
  whatsapp: { iconUrl: "/social-icons/whatsapp.svg", bgColor: "#25D366" },
  twitter: { iconUrl: "/social-icons/twitter.svg", bgColor: "#111827" },
  weibo: { iconUrl: "/social-icons/weibo.svg", bgColor: "#E6162D" },
  telegram: { iconUrl: "/social-icons/telegram.svg", bgColor: "#229ED9" },
  linkedin: { iconUrl: "/social-icons/linkedin.svg", bgColor: "#0A66C2" },
  discord: { iconUrl: "/social-icons/discord.svg", bgColor: "#5865F2" },
  facebook: { iconUrl: "/social-icons/facebook.svg", bgColor: "#1877F2" },
  instagram: { iconUrl: "/social-icons/instagram.svg", bgColor: "#E4405F" },
  tiktok: { iconUrl: "/social-icons/tiktok.svg", bgColor: "#111827" },
  douyin: { iconUrl: "/social-icons/tiktok.svg", bgColor: "#161823" },
  xiaohongshu: { iconUrl: "/social-icons/xiaohongshu.svg", bgColor: "#FF2442" },
  googleReview: { iconUrl: "/social-icons/google.svg", bgColor: "#ffffff", textColor: "#0f172a" },
};

const INVOICE_FIELDS = [
  { key: "name", label: "名称", summaryLabel: "开票名称", placeholder: "请输入开票名称" },
  { key: "taxNumber", label: "税号", summaryLabel: "税号", placeholder: "请输入税号" },
  { key: "address", label: "地址", summaryLabel: "开票地址", placeholder: "请输入开票地址" },
] as const satisfies ReadonlyArray<{
  key: keyof MerchantBusinessCardDraft["invoice"];
  label: string;
  summaryLabel: string;
  placeholder: string;
}>;

const TEXT_LAYOUT_FIELDS: Array<{ key: MerchantBusinessCardFieldKey; label: string }> = [
  { key: "merchantName", label: "商户名称" },
  { key: "title", label: "职位" },
  { key: "website", label: "网站说明" },
  ...CONTACT_FIELDS,
];

const FONT_FAMILY_OPTIONS = [
  { value: "", label: "默认" },
  { value: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", label: "系统默认" },
  { value: "Microsoft YaHei, SimHei, sans-serif", label: "微软雅黑" },
  { value: "SimHei, 'Heiti SC', sans-serif", label: "黑体" },
  { value: "SimSun, Songti SC, serif", label: "宋体" },
  { value: "FangSong, STFangsong, serif", label: "仿宋" },
  { value: "KaiTi, STKaiti, serif", label: "楷体" },
  { value: "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif", label: "苹方" },
  { value: "'Noto Sans SC', 'Source Han Sans SC', 'Microsoft YaHei', sans-serif", label: "思源黑体" },
  { value: "'Noto Serif SC', 'Source Han Serif SC', SimSun, serif", label: "思源宋体" },
  { value: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", label: "Segoe UI" },
  { value: "Arial, Helvetica, sans-serif", label: "Arial" },
  { value: "Helvetica, Arial, sans-serif", label: "Helvetica" },
  { value: "Verdana, Geneva, sans-serif", label: "Verdana" },
  { value: "Tahoma, Geneva, sans-serif", label: "Tahoma" },
  { value: "'Trebuchet MS', Helvetica, sans-serif", label: "Trebuchet MS" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "Times New Roman, Times, serif", label: "Times New Roman" },
  { value: "'Palatino Linotype', 'Book Antiqua', Palatino, serif", label: "Palatino" },
  { value: "Garamond, 'Times New Roman', serif", label: "Garamond" },
  { value: "'Courier New', Courier, monospace", label: "Courier New" },
];

const MIN_TYPOGRAPHY_FONT_SIZE = 10;
const MAX_TYPOGRAPHY_FONT_SIZE = 80;
const MIN_BACKGROUND_IMAGE_SCALE = 0.25;
const MAX_BACKGROUND_IMAGE_SCALE = 3;
const BUSINESS_CARD_DRAFT_STORAGE_PREFIX = "merchant-space:business-card-draft:v1";
const FONT_SIZE_OPTIONS = [12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72, 80];
const TYPOGRAPHY_FONT_SIZE_INPUT_KEY = "merchant-business-card-typography-font-size";
const QR_MIN_READABLE_SIZE = 96;
const MIN_CARD_FRAME_WIDTH = 320;
const MAX_CARD_FRAME_WIDTH = 1600;
const MIN_CARD_FRAME_HEIGHT = 180;
const MAX_CARD_FRAME_HEIGHT = 1600;
const CONTACT_INTRO_VIDEO_SOURCE_LIMIT_BYTES = 80 * 1024 * 1024;
const DEFAULT_CONTACT_INTRO_VIDEO_OUTPUT_LIMIT_MB = 3;
const CONTACT_INTRO_VIDEO_ACCEPT =
  "video/mp4,video/x-m4v,video/webm,video/ogg,video/quicktime,video/x-matroska,video/x-msvideo,video/3gpp,video/3gpp2,video/mpeg,.mp4,.m4v,.mov,.webm,.ogv,.ogg,.mkv,.avi,.3gp,.3g2,.mpg,.mpeg";
const ALL_TYPOGRAPHY_KEYS: Array<keyof MerchantBusinessCardDraft["typography"]> = [
  "name",
  "title",
  "website",
  "info",
];
const ALL_FIELD_LAYOUT_KEYS: MerchantBusinessCardFieldKey[] = TEXT_LAYOUT_FIELDS.map((item) => item.key);
const CARD_MODE_OPTIONS: Array<{
  value: MerchantBusinessCardMode;
  label: string;
  description: string;
}> = [
  {
    value: "image",
    label: "图片模式",
    description: "生成普通名片图片，适合保存或复制。",
  },
  {
    value: "link",
    label: "链接模式",
    description: "生成电子联系卡链接，手机打开后可保存联系人，也可单独复制名片图片。",
  },
];

const CARD_BACKGROUND_COLOR_PRESETS = [
  "#ffffff",
  "#f8fafc",
  "#dbeafe",
  "#fef3c7",
  "#fee2e2",
  "#111827",
  "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
  "linear-gradient(135deg, #ffffff 0%, #fff1f2 52%, #ffedd5 100%)",
  "linear-gradient(135deg, #dbeafe 0%, #fce7f3 45%, #fff7cc 100%)",
  "linear-gradient(135deg, #082f49 0%, #0f172a 55%, #164e63 100%)",
  "linear-gradient(180deg, #fffdf8 0%, #f6efe4 100%)",
] as const;

const CUSTOM_TEXT_PREFIX = "custom:";

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeTypographyFontSize(value: number) {
  return clamp(Math.round(value), MIN_TYPOGRAPHY_FONT_SIZE, MAX_TYPOGRAPHY_FONT_SIZE);
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, Math.max(500, timeoutMs));
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function isShortBusinessCardShareLink(value: string) {
  const normalized = normalizeText(value);
  if (!normalized) return false;
  const baseOrigin = typeof window !== "undefined" ? window.location.origin : "https://faolla.com";
  try {
    const url = new URL(normalized, baseOrigin);
    return /^\/card\/[a-z0-9][a-z0-9_-]{5,63}\/?$/i.test(url.pathname) && !url.search;
  } catch {
    return false;
  }
}

function resolveSameOriginBusinessCardShareCheckUrl(value: string) {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  const baseOrigin = typeof window !== "undefined" ? window.location.origin : "https://faolla.com";
  try {
    const url = new URL(normalized, baseOrigin);
    if (!/^\/card\/[a-z0-9][a-z0-9_-]{5,63}\/?$/i.test(url.pathname) || url.search) return "";
    return new URL(url.pathname, `${baseOrigin}/`).toString();
  } catch {
    return "";
  }
}

async function verifyShortBusinessCardShareLink(value: string, timeoutMs = 8_000) {
  if (!isShortBusinessCardShareLink(value)) return false;
  const checkUrl = resolveSameOriginBusinessCardShareCheckUrl(value) || value;
  try {
    const response = await fetchWithTimeout(
      checkUrl,
      {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      },
      timeoutMs,
    );
    return response.ok;
  } catch {
    return false;
  }
}

function formatOpacityPercent(value: number) {
  return `${Math.round(clamp(value, 0, 1) * 100)}%`;
}

function normalizeBackgroundImageScale(value: number) {
  return Math.round(clamp(value, MIN_BACKGROUND_IMAGE_SCALE, MAX_BACKGROUND_IMAGE_SCALE) * 100) / 100;
}

function formatScalePercent(value: number) {
  return `${Math.round(normalizeBackgroundImageScale(value) * 100)}%`;
}

function getCardModeLabel(mode: MerchantBusinessCardMode) {
  return mode === "link" ? "链接模式" : "图片模式";
}

function resolveCardShortLink(card: MerchantBusinessCardAsset | null | undefined) {
  if (!card || card.mode !== "link") return "";
  return buildMerchantBusinessCardShareUrl({
    shareKey: normalizeText(card.shareKey),
    name: normalizeText(card.name),
    imageUrl: normalizeText(card.shareImageUrl) || normalizeText(card.imageUrl),
    detailImageUrl: normalizeText(card.contactPagePublicImageUrl) || normalizeText(card.contactPageImageUrl),
    detailImageHeight: card.contactPageImageHeight,
    detailImageLinkUrl: normalizeText(card.contactPageImageLinkUrl),
    detailImageX: card.contactPageImageX,
    detailImageY: card.contactPageImageY,
    detailImageScale: card.contactPageImageScale,
    detailImageOpacity: card.contactPageImageOpacity,
    introVideoUrl: normalizeText(card.contactIntroVideoUrl),
    introPosterUrl: normalizeText(card.contactIntroVideoPosterUrl),
    introVideoMuted: card.contactIntroVideoMuted,
    targetUrl: normalizeText(card.targetUrl),
  });
}

function overlay(children: ReactNode) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildBusinessCardDraftStorageKey(input: {
  merchantId?: string | null;
  targetUrl?: string | null;
  domainPrefix?: string | null;
}) {
  const identity =
    normalizeText(input.merchantId) ||
    normalizeText(input.targetUrl) ||
    normalizeText(input.domainPrefix) ||
    "default";
  return `${BUSINESS_CARD_DRAFT_STORAGE_PREFIX}:${encodeURIComponent(identity).slice(0, 240)}`;
}

function readSavedBusinessCardDraft(storageKey: string) {
  if (typeof window === "undefined" || !storageKey) return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { draft?: unknown } | unknown;
    const source = parsed && typeof parsed === "object" && "draft" in parsed ? (parsed as { draft?: unknown }).draft : parsed;
    return normalizeMerchantBusinessCardDraft(source);
  } catch {
    return null;
  }
}

function writeSavedBusinessCardDraft(storageKey: string, draft: MerchantBusinessCardDraft) {
  if (typeof window === "undefined" || !storageKey) {
    throw new Error("draft_storage_unavailable");
  }
  window.localStorage.setItem(
    storageKey,
    JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      draft: normalizeMerchantBusinessCardDraft(draft),
    }),
  );
}

async function renderCardNodeToImage(node: HTMLElement) {
  const images = Array.from(node.querySelectorAll("img"));
  await Promise.all(
    images.map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) return resolve();
          const done = () => resolve();
          image.addEventListener("load", done, { once: true });
          image.addEventListener("error", done, { once: true });
          window.setTimeout(done, 2200);
        }),
    ),
  );
  if (typeof document.fonts?.ready?.then === "function") {
    await document.fonts.ready.catch(() => undefined);
  }
  const { toPng } = await import("html-to-image");
  return toPng(node, {
    pixelRatio: 1,
    cacheBust: true,
    backgroundColor: "transparent",
  });
}

async function copyTextToClipboard(value: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  if (typeof document === "undefined") {
    throw new Error("clipboard_unavailable");
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-99999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("clipboard_unavailable");
  }
}

async function normalizeClipboardImageBlob(sourceImageUrl: string) {
  const response = await fetch(sourceImageUrl);
  if (!response.ok) {
    throw new Error("image_clipboard_unavailable");
  }
  const sourceBlob = await response.blob();
  if (sourceBlob.type === "image/png") {
    return sourceBlob;
  }
  return await convertImageBlobToPngBlob(sourceBlob);
}

async function blobToDataUrl(blob: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("image_clipboard_unavailable"));
    reader.readAsDataURL(blob);
  });
}

async function yieldToBrowser() {
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

async function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

async function readImageFileAsDataUrl(file: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

async function loadImageElement(dataUrl: string) {
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("读取图片失败"));
    image.decoding = "async";
    image.src = dataUrl;
  });
}

async function loadImageElementFromBlob(blob: Blob) {
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await loadImageElement(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function convertImageBlobToPngBlob(blob: Blob) {
  const image = await loadImageElementFromBlob(blob);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, image.naturalWidth);
  canvas.height = Math.max(1, image.naturalHeight);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("image_clipboard_unavailable");
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pngBlob = await canvasToBlob(canvas, "image/png", 1);
  if (!pngBlob) {
    throw new Error("image_clipboard_unavailable");
  }
  return pngBlob;
}

function uniqueDescendingNumbers(values: number[]) {
  return Array.from(new Set(values.map((value) => Math.round(value * 1000) / 1000)))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((first, second) => second - first);
}

function buildQualityFirstImageCompressionPlans(sourceBytes: number, limitBytes: number) {
  const estimatedScale = clamp(Math.sqrt(limitBytes / Math.max(sourceBytes, 1)) * 1.12, 0.06, 1);
  const scales = uniqueDescendingNumbers([
    1,
    0.8,
    0.64,
    0.48,
    0.4,
    0.32,
    0.24,
    0.16,
    0.06,
    estimatedScale * 1.8,
    estimatedScale * 1.5,
    estimatedScale * 1.28,
    estimatedScale * 1.16,
    estimatedScale * 1.08,
    estimatedScale,
    estimatedScale * 0.92,
    estimatedScale * 0.84,
  ].map((value) => clamp(value, 0.06, 1)));
  const highQuality = [0.96, 0.92, 0.88, 0.84, 0.78, 0.72];
  const fallbackQuality = [0.64, 0.56, 0.48, 0.4, 0.32, 0.3];
  const highQualityPlans = scales.flatMap((scale) =>
    highQuality.map((quality) => ({
      scale,
      quality,
    })),
  );
  const fallbackPlans = scales
    .filter((scale) => scale <= Math.max(estimatedScale * 1.2, 0.32))
    .flatMap((scale) => fallbackQuality.map((quality) => ({ scale, quality })));
  return [...highQualityPlans, ...fallbackPlans];
}

async function renderCompressedImageCandidate(
  image: HTMLImageElement,
  scale: number,
  quality: number,
) {
  const targetWidth = Math.max(1, Math.round(image.naturalWidth * scale));
  const targetHeight = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("读取图片失败");
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.clearRect(0, 0, targetWidth, targetHeight);
  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  const blob = await canvasToBlob(canvas, "image/webp", quality);
  if (blob) {
    return { blob, dataUrl: "", bytes: blob.size, scale, quality };
  }
  const dataUrl = canvas.toDataURL("image/webp", quality);
  return { blob: null, dataUrl, bytes: estimateDataUrlBytes(dataUrl), scale, quality };
}

async function finalizeCompressedImageCandidate(candidate: {
  blob: Blob | null;
  dataUrl: string;
  bytes: number;
}) {
  return {
    dataUrl: candidate.blob ? await blobToDataUrl(candidate.blob) : candidate.dataUrl,
    bytes: candidate.bytes,
  };
}

async function compressImageFileWithinLimit(file: Blob, limitBytes: number) {
  const originalBytes = file.size || 0;
  if (originalBytes > 0 && originalBytes <= limitBytes) {
    return {
      dataUrl: await readImageFileAsDataUrl(file),
      compressed: false,
      bytes: originalBytes,
    };
  }

  const image = await loadImageElementFromBlob(file);
  let smallestCandidate:
    | {
        blob: Blob | null;
        dataUrl: string;
        bytes: number;
        scale: number;
        quality: number;
      }
    | null = null;

  const plans = buildQualityFirstImageCompressionPlans(originalBytes || limitBytes + 1, limitBytes);
  for (let attempt = 0; attempt < plans.length; attempt += 1) {
    await yieldToBrowser();
    const plan = plans[attempt];
    if (!plan) continue;
    const candidate = await renderCompressedImageCandidate(image, plan.scale, plan.quality);
    if (!smallestCandidate || candidate.bytes < smallestCandidate.bytes) {
      smallestCandidate = candidate;
    }
    if (candidate.bytes <= limitBytes) {
      const finalized = await finalizeCompressedImageCandidate(candidate);
      return {
        dataUrl: finalized.dataUrl,
        compressed: true,
        bytes: finalized.bytes,
      };
    }
  }

  if (smallestCandidate) {
    const finalized = await finalizeCompressedImageCandidate(smallestCandidate);
    return {
      dataUrl: finalized.dataUrl,
      compressed: true,
      bytes: finalized.bytes,
    };
  }

  const originalDataUrl = await readImageFileAsDataUrl(file);
  return {
    dataUrl: originalDataUrl,
    compressed: false,
    bytes: originalBytes || estimateDataUrlBytes(originalDataUrl),
  };
}

async function compressImageDataUrlWithinLimit(dataUrl: string, limitBytes: number) {
  const originalBytes = estimateDataUrlBytes(dataUrl);
  if (originalBytes <= limitBytes) {
    return {
      dataUrl,
      compressed: false,
      bytes: originalBytes,
    };
  }

  const image = await loadImageElement(dataUrl);
  let smallestCandidate:
    | {
        blob: Blob | null;
        dataUrl: string;
        bytes: number;
        scale: number;
        quality: number;
      }
    | null = null;

  const plans = buildQualityFirstImageCompressionPlans(originalBytes || limitBytes + 1, limitBytes);
  for (let attempt = 0; attempt < plans.length; attempt += 1) {
    await yieldToBrowser();
    const plan = plans[attempt];
    if (!plan) continue;
    const candidate = await renderCompressedImageCandidate(image, plan.scale, plan.quality);
    if (!smallestCandidate || candidate.bytes < smallestCandidate.bytes) {
      smallestCandidate = candidate;
    }
    if (candidate.bytes <= limitBytes) {
      const finalized = await finalizeCompressedImageCandidate(candidate);
      return {
        dataUrl: finalized.dataUrl,
        compressed: true,
        bytes: finalized.bytes,
      };
    }
  }

  if (smallestCandidate) {
    const finalized = await finalizeCompressedImageCandidate(smallestCandidate);
    return {
      dataUrl: finalized.dataUrl,
      compressed: true,
      bytes: finalized.bytes,
    };
  }

  return {
    dataUrl,
    compressed: false,
    bytes: originalBytes,
  };
}

function estimateDataUrlBytes(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] ?? "";
  if (!base64) {
    return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(dataUrl).length : dataUrl.length;
  }
  return Math.max(0, Math.floor((base64.length * 3) / 4));
}

function getImageFileExtension(imageUrl: string) {
  const dataUrlType = imageUrl.match(/^data:image\/([a-z0-9.+-]+);/i)?.[1]?.toLowerCase();
  const type = dataUrlType || imageUrl.split(/[?#]/, 1)[0]?.split(".").pop()?.toLowerCase() || "";
  if (type === "jpeg" || type === "jpg") return "jpg";
  if (type === "webp") return "webp";
  return "png";
}

async function copyImageViaLegacyClipboard(blob: Blob) {
  if (typeof document === "undefined") {
    throw new Error("image_clipboard_unavailable");
  }
  const dataUrl = await blobToDataUrl(blob);
  await new Promise<void>((resolve, reject) => {
    let handled = false;
    const cleanup = () => {
      document.removeEventListener("copy", handleCopy, true);
    };
    const fail = () => {
      cleanup();
      reject(new Error("image_clipboard_unavailable"));
    };
    const succeed = () => {
      handled = true;
      cleanup();
      resolve();
    };
    const handleCopy = (event: ClipboardEvent) => {
      const clipboardData = event.clipboardData;
      if (!clipboardData) {
        fail();
        return;
      }
      event.preventDefault();
      try {
        clipboardData.setData(
          "text/html",
          `<img src="${dataUrl}" alt="business card" style="display:block;max-width:100%;" />`,
        );
        clipboardData.setData("text/plain", "");
        succeed();
      } catch {
        fail();
      }
    };

    document.addEventListener("copy", handleCopy, true);
    const copied = document.execCommand("copy");
    if (!copied && !handled) {
      fail();
      return;
    }
    window.setTimeout(() => {
      if (!handled) fail();
    }, 50);
  });
}

async function copyImageToClipboard(sourceImageUrl: string) {
  const blob = await normalizeClipboardImageBlob(sourceImageUrl);
  if (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    navigator.clipboard?.write &&
    typeof window.ClipboardItem === "function"
  ) {
    try {
      await navigator.clipboard.write([
        new window.ClipboardItem({
          "image/png": blob,
        }),
      ]);
      return;
    } catch {
      // Fall through to legacy clipboard path.
    }
  }
  await copyImageViaLegacyClipboard(blob);
}

function sanitizeShareAssetHint(value: string) {
  return (
    normalizeText(value)
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "business-card"
  );
}

function normalizePhoneList(values: string[]) {
  return values
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .slice(0, MERCHANT_BUSINESS_CARD_PHONE_LIMIT);
}

function getOrderedContactFields(order: MerchantBusinessCardDraft["contactFieldOrder"]) {
  return normalizeMerchantBusinessCardContactFieldOrder(order).map((key) => ({
    key,
    label: CONTACT_FIELD_LABELS[key],
  }));
}

function resolveDraftPhoneValues(contacts: MerchantBusinessCardDraft["contacts"]) {
  const fromArray = normalizePhoneList(Array.isArray(contacts.phones) ? contacts.phones : []);
  if (fromArray.length > 0) return fromArray;
  const fallback = normalizeText(contacts.phone);
  return fallback ? [fallback] : [""];
}

function buildPhoneContactValue(contacts: MerchantBusinessCardDraft["contacts"]) {
  return normalizePhoneList(resolveDraftPhoneValues(contacts)).join(" / ");
}

function resolveContactDisplayValue(
  contacts: MerchantBusinessCardDraft["contacts"],
  key: MerchantBusinessCardEditableContactFieldKey,
) {
  if (key === "googleReview") return normalizeText(contacts.googleReview) ? GOOGLE_REVIEW_DISPLAY_TEXT : "";
  return key === "phone" ? buildPhoneContactValue(contacts) : normalizeText(contacts[key]);
}

function resolveContactDisplayTarget(
  contactDisplayFields: MerchantBusinessCardDraft["contactDisplayFields"],
  key: MerchantBusinessCardContactOnlyFieldKey,
) {
  return contactDisplayFields[key] ?? { businessCard: true, contactCard: true };
}

function isContactFieldVisibleOnBusinessCard(
  contactDisplayFields: MerchantBusinessCardDraft["contactDisplayFields"],
  key: MerchantBusinessCardContactOnlyFieldKey,
) {
  return resolveContactDisplayTarget(contactDisplayFields, key).businessCard !== false;
}

function isContactFieldVisibleOnContactCard(
  contactDisplayFields: MerchantBusinessCardDraft["contactDisplayFields"],
  key: MerchantBusinessCardContactOnlyFieldKey,
) {
  return resolveContactDisplayTarget(contactDisplayFields, key).contactCard !== false;
}

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

function MoveIconButton({
  direction,
  disabled,
  onClick,
  className = "",
}: {
  direction: "up" | "down";
  disabled?: boolean;
  onClick: () => void;
  className?: string;
}) {
  const label = direction === "up" ? "上移" : "下移";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded border bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      <MoveArrowIcon direction={direction} />
    </button>
  );
}

function ContactDisplayCheckboxes({
  value,
  onChange,
}: {
  value: { businessCard: boolean; contactCard: boolean };
  onChange: (target: MerchantBusinessCardContactDisplayTargetKey, checked: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {([
        ["businessCard", "名片"],
        ["contactCard", "联系卡"],
      ] as const).map(([target, label]) => (
        <label key={target} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded border bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-700">
          <input
            type="checkbox"
            checked={value[target]}
            onChange={(event) => onChange(target, event.target.checked)}
          />
          {label}
        </label>
      ))}
    </div>
  );
}

function CustomContactPresetSymbol({ preset }: { preset?: string }) {
  return (
    <>
      {
        CUSTOM_CONTACT_ICON_PRESET_SYMBOLS[
          (MERCHANT_BUSINESS_CARD_CUSTOM_CONTACT_ICON_PRESETS as readonly string[]).includes(normalizeText(preset))
            ? (normalizeText(preset) as (typeof MERCHANT_BUSINESS_CARD_CUSTOM_CONTACT_ICON_PRESETS)[number])
            : "link"
        ]
      }
    </>
  );
}

function ContactDisplayIcon({
  fieldKey,
  customLink,
  className = "h-8 w-8 text-xs",
  imageClassName = "h-4 w-4",
}: {
  fieldKey?: MerchantBusinessCardEditableContactFieldKey;
  customLink?: MerchantBusinessCardCustomContactLink;
  className?: string;
  imageClassName?: string;
}) {
  const iconClassName = `inline-flex shrink-0 items-center justify-center rounded-full font-semibold shadow-sm ${className}`;
  if (customLink) {
    const bgColor = normalizeText(customLink.bgColor) || "#0f172a";
    return (
      <span className={`${iconClassName} text-white`} style={{ backgroundColor: bgColor }}>
        {normalizeText(customLink.iconUrl) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={customLink.iconUrl} alt="" className={`${imageClassName} object-contain`} />
        ) : (
          <CustomContactPresetSymbol preset={customLink.iconPreset} />
        )}
      </span>
    );
  }
  const meta = fieldKey ? CONTACT_FIELD_ICON_META[fieldKey] : null;
  if (!meta) return null;
  return (
    <span
      className={iconClassName}
      style={{ backgroundColor: meta.bgColor, color: meta.textColor || "#fff" }}
    >
      {meta.iconUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={meta.iconUrl} alt="" className={`${imageClassName} object-contain`} />
      ) : (
        meta.symbol
      )}
    </span>
  );
}

function ContactFieldEditorLabel({
  fieldKey,
  label,
}: {
  fieldKey: MerchantBusinessCardEditableContactFieldKey;
  label: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs font-medium leading-5 text-slate-700">
      <ContactDisplayIcon fieldKey={fieldKey} className="h-6 w-6 text-[10px]" imageClassName="h-3.5 w-3.5" />
      <span className="min-w-0">{label}</span>
    </div>
  );
}

function typographyStyle(
  style: MerchantBusinessCardDraft["fieldTypography"][MerchantBusinessCardFieldKey],
): CSSProperties {
  return {
    fontFamily: normalizeText(style.fontFamily) || undefined,
    fontSize: `${style.fontSize}px`,
    color: normalizeText(style.fontColor) || "#0f172a",
    fontWeight: normalizeText(style.fontWeight) || "normal",
    fontStyle: normalizeText(style.fontStyle) || "normal",
    textDecoration: normalizeText(style.textDecoration) || "none",
    lineHeight: 1.35,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  };
}

function CardSurface({
  draft,
  websiteUrl,
  qrCodeUrl,
  scale,
  renderMode = "preview",
  onBackgroundPointerDown,
  onBackgroundPointerMove,
  onBackgroundPointerEnd,
}: {
  draft: MerchantBusinessCardDraft;
  websiteUrl: string;
  qrCodeUrl: string;
  scale: number;
  renderMode?: "preview" | "export";
  onBackgroundPointerDown?: (event: ReactPointerEvent<HTMLDivElement>, scale: number) => void;
  onBackgroundPointerMove?: (event: ReactPointerEvent<HTMLDivElement>, scale: number) => void;
  onBackgroundPointerEnd?: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const isExport = renderMode === "export";
  const canDragBackground = !isExport && !!normalizeText(draft.backgroundImageUrl) && !!onBackgroundPointerDown;
  const orderedContactFields = getOrderedContactFields(draft.contactFieldOrder);
  const contacts = orderedContactFields.map(({ key, label }) => {
    const value = resolveContactDisplayValue(draft.contacts, key);
    if (!value || !isContactFieldVisibleOnBusinessCard(draft.contactDisplayFields, key)) return null;
    return { key, label, value };
  }).filter((item): item is { key: MerchantBusinessCardEditableContactFieldKey; label: string; value: string } => !!item);
  const websiteText = [
    normalizeText(draft.websiteLabel),
    draft.showWebsiteUrl ? websiteUrl.replace(/^https?:\/\//i, "") : "",
  ]
    .map((item) => item.trim())
    .filter(Boolean)
    .join("\n");
  const shouldShowQr = draft.showQr && !!qrCodeUrl;
  const exportHasBackgroundImage = isExport && !!normalizeText(draft.backgroundImageUrl);
  const isSnapshotBackgroundOnly =
    Boolean(draft.backgroundImageSnapshotOnly) && !!normalizeText(draft.backgroundImageUrl);
  const shouldRenderEditableLayers = !isSnapshotBackgroundOnly;
  const cardFrameBorderRadius = draft.cornerMode === "square" ? "0px" : "28px";
  return (
    <div style={{ width: `${draft.width * scale}px`, height: `${draft.height * scale}px` }}>
      <div
        style={{
          position: "relative",
          width: `${draft.width}px`,
          height: `${draft.height}px`,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          overflow: "hidden",
          borderRadius: cardFrameBorderRadius,
          border: isExport ? "none" : "1px solid rgba(15,23,42,.12)",
          background: "transparent",
          boxShadow: isExport ? "none" : "0 24px 60px rgba(15,23,42,.18)",
          cursor: canDragBackground ? "grab" : undefined,
          touchAction: canDragBackground ? "none" : undefined,
        }}
        onPointerDown={canDragBackground ? (event) => onBackgroundPointerDown(event, scale) : undefined}
        onPointerMove={canDragBackground ? (event) => onBackgroundPointerMove?.(event, scale) : undefined}
        onPointerUp={canDragBackground ? onBackgroundPointerEnd : undefined}
        onPointerCancel={canDragBackground ? onBackgroundPointerEnd : undefined}
      >
        <div
          className="absolute inset-0"
          style={{
            background: draft.backgroundColor || "#f8fafc",
            opacity: exportHasBackgroundImage ? 0 : draft.backgroundColorOpacity,
          }}
        />
        {draft.backgroundImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={draft.backgroundImageUrl}
            alt={draft.name}
            crossOrigin="anonymous"
            referrerPolicy="no-referrer"
            className="absolute h-full w-full object-contain"
            style={{
              left: `calc(50% + ${draft.backgroundImageX}px)`,
              top: `calc(50% + ${draft.backgroundImageY}px)`,
              maxWidth: "none",
              opacity: draft.backgroundImageOpacity,
              pointerEvents: "none",
              transform: `translate(-50%, -50%) scale(${normalizeBackgroundImageScale(draft.backgroundImageScale)})`,
              transformOrigin: "center",
              userSelect: "none",
              willChange: isExport ? undefined : "transform",
            }}
          />
        ) : null}
        {isExport ? null : <div className="absolute inset-0 bg-white/12" />}
        {shouldRenderEditableLayers ? (
          <>
            {TEXT_LAYOUT_FIELDS.filter(
              ({ key }) =>
                (key === "merchantName" && isContactFieldVisibleOnBusinessCard(draft.contactDisplayFields, "merchantName") && draft.name) ||
                (key === "title" && draft.title) ||
                (key === "website" && websiteText),
            ).map(({ key }) => {
              const value =
                key === "merchantName"
                  ? draft.name
                  : key === "title"
                    ? draft.title
                    : websiteText;
              return (
                <div
                  key={key}
                  style={{
                    position: "absolute",
                    left: `${draft.textLayout[key].x}px`,
                    top: `${draft.textLayout[key].y}px`,
                    maxWidth: `${Math.max(160, draft.width - draft.textLayout[key].x - 36)}px`,
                    ...typographyStyle(draft.fieldTypography[key]),
                  }}
                >
                  {value}
                </div>
              );
            })}
            {contacts.map(({ key, label, value }) => (
              <div
                key={key}
                style={{
                  position: "absolute",
                  left: `${draft.textLayout[key].x}px`,
                  top: `${draft.textLayout[key].y}px`,
                  maxWidth: `${Math.max(160, draft.width - draft.textLayout[key].x - 36)}px`,
                  ...typographyStyle(draft.fieldTypography[key]),
                }}
              >
                {key === "contactName" ? value : `${label}: ${value}`}
              </div>
            ))}
            {draft.customTexts
              .filter((item) => normalizeText(item.text))
              .map((item) => (
                <div
                  key={item.id}
                  style={{
                    position: "absolute",
                    left: `${item.x}px`,
                    top: `${item.y}px`,
                    maxWidth: `${Math.max(160, draft.width - item.x - 36)}px`,
                    ...typographyStyle(item.typography),
                  }}
                >
                  {item.text}
                </div>
              ))}
            {shouldShowQr ? (
              <div
                style={{
                  position: "absolute",
                  left: `${draft.qr.x}px`,
                  top: `${draft.qr.y}px`,
                  width: `${draft.qr.size}px`,
                  height: `${draft.qr.size}px`,
                  padding: "10px",
                  borderRadius: "18px",
                  background: "#fff",
                  boxShadow: "0 16px 36px rgba(15,23,42,.18)",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrCodeUrl} alt="商户网站二维码" className="h-full w-full object-contain" />
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function buildContactPreviewRows(
  name: string,
  contacts: MerchantBusinessCardDraft["contacts"],
  contactFieldOrder: MerchantBusinessCardDraft["contactFieldOrder"],
  contactDisplayFields: MerchantBusinessCardDraft["contactDisplayFields"],
  customContactLinks: MerchantBusinessCardCustomContactLink[] = [],
): ContactPreviewRow[] {
  const phoneValues = normalizePhoneList(Array.isArray(contacts.phones) ? contacts.phones : []);
  const primaryPhone = phoneValues[0] || normalizeText(contacts.phone);
  const contactRows = getOrderedContactFields(contactFieldOrder)
    .flatMap(({ key, label }): ContactPreviewRow[] => {
      if (!isContactFieldVisibleOnContactCard(contactDisplayFields, key)) return [];
      if (key === "phone") {
        const phoneRows: ContactPreviewRow[] = [];
        if (primaryPhone) phoneRows.push({ key, label: "电话", value: primaryPhone });
        phoneValues
          .slice(primaryPhone ? 1 : 0)
          .forEach((value, index) => {
            phoneRows.push({ key, label: index === 0 ? "工作" : `工作${index + 1}`, value });
          });
        return phoneRows;
      }

      const value =
        key === "contactName"
          ? normalizeText(contacts.contactName) || normalizeText(name)
          : normalizeText(contacts[key]);
      return value ? [{ key, label, value }] : [];
    });
  const customRows = customContactLinks
    .flatMap((item, index): ContactPreviewRow[] => {
      const value = normalizeText(item.displayText) || normalizeText(item.url);
      if (!value) return [];
      return [{
        label: normalizeText(item.label) || `自定义${index + 1}`,
        value,
        customLink: item,
      }];
    });
  return [...contactRows, ...customRows];
}

function buildInvoicePreviewRows(invoice: MerchantBusinessCardDraft["invoice"]) {
  const rows: Array<{ label: string; value: string }> = [];
  for (const { key, label } of INVOICE_FIELDS) {
    const value = normalizeText(invoice[key]);
    if (!value) continue;
    rows.push({ label, value });
  }
  return rows;
}

const videoPosterFrameCache = new Map<string, string>();
const videoPosterFramePending = new Map<string, Promise<string>>();

const BUSINESS_CARD_FRONT_RENDER_IGNORED_FIELDS = [
  "contactIntroVideoUrl",
  "contactIntroVideoPosterUrl",
  "contactIntroVideoMuted",
  "contactPageImageUrl",
  "contactPageImageHeight",
  "contactPageImageLinkUrl",
  "contactPageImageX",
  "contactPageImageY",
  "contactPageImageScale",
  "contactPageImageOpacity",
  "contactPageSectionOrder",
  "showContactSaveButton",
  "showContactWebsiteButton",
  "customContactLinks",
  "invoice",
  "contactOnlyFields",
] as const;

function buildBusinessCardFrontRenderSignature(value: MerchantBusinessCardDraft | MerchantBusinessCardAsset | null | undefined) {
  if (!value) return "";
  const normalized = normalizeMerchantBusinessCardDraft(value);
  const frontDraft = { ...normalized } as Record<string, unknown>;
  BUSINESS_CARD_FRONT_RENDER_IGNORED_FIELDS.forEach((key) => {
    delete frontDraft[key];
  });
  return JSON.stringify(frontDraft);
}

function extractVideoPosterFrame(src: string) {
  const normalizedSrc = normalizeText(src);
  if (!normalizedSrc || typeof document === "undefined") return Promise.resolve("");
  const cached = videoPosterFrameCache.get(normalizedSrc);
  if (cached) return Promise.resolve(cached);
  const pending = videoPosterFramePending.get(normalizedSrc);
  if (pending) return pending;

  const promise = new Promise<string>((resolve) => {
    const video = document.createElement("video");
    let settled = false;

    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeAttribute("src");
      try {
        video.load();
      } catch {}
      if (value) videoPosterFrameCache.set(normalizedSrc, value);
      videoPosterFramePending.delete(normalizedSrc);
      resolve(value);
    };

    const capture = () => {
      try {
        const width = Math.max(1, video.videoWidth || 640);
        const height = Math.max(1, video.videoHeight || 360);
        const maxWidth = 640;
        const scale = Math.min(1, maxWidth / width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext("2d");
        if (!context) {
          finish("");
          return;
        }
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL("image/jpeg", 0.82));
      } catch {
        finish("");
      }
    };

    const seekToFirstFrame = () => {
      try {
        if (Number.isFinite(video.duration) && video.duration > 0) {
          video.currentTime = Math.min(0.001, video.duration / 2);
          return;
        }
      } catch {}
      capture();
    };

    const timer = window.setTimeout(() => finish(""), 8000);
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.addEventListener("loadedmetadata", seekToFirstFrame, { once: true });
    video.addEventListener("seeked", capture, { once: true });
    video.addEventListener("error", () => finish(""), { once: true });
    video.src = normalizedSrc;
    try {
      video.load();
    } catch {
      finish("");
    }
  });

  videoPosterFramePending.set(normalizedSrc, promise);
  return promise;
}

async function uploadBusinessCardIntroVideoPosterFallback(dataUrl: string, merchantHint: string, cardName: string) {
  const normalizedDataUrl = normalizeText(dataUrl);
  if (!normalizedDataUrl) return "";
  const uploadedUrl = await uploadImageDataUrlToPublicStorage(
    normalizedDataUrl,
    sanitizeShareAssetHint(`${merchantHint}-intro-video-poster`),
    "business-card-contact",
    {
      operationModule: "经营中心 > 名片夹",
      operationAction: "生成联系卡开场视频封面",
      operationSummary: `在经营中心 > 名片夹为联系卡开场视频生成封面：${cardName || "未命名名片"}`,
    },
  ).catch(() => null);
  return normalizeText(uploadedUrl) || normalizedDataUrl;
}

function AutoPlayingVideoPreview({
  src,
  poster,
  className,
  controls = true,
  loop = true,
  muted = true,
  autoPlay = true,
}: {
  src: string;
  poster?: string;
  className: string;
  controls?: boolean;
  loop?: boolean;
  muted?: boolean;
  autoPlay?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const normalizedSrc = normalizeText(src);
  const normalizedPoster = normalizeText(poster);
  const [generatedPoster, setGeneratedPoster] = useState<{ src: string; poster: string }>({ src: "", poster: "" });
  const generatedPosterForSrc = generatedPoster.src === normalizedSrc ? normalizeText(generatedPoster.poster) : "";
  const resolvedPoster =
    (!autoPlay && generatedPosterForSrc) || normalizedPoster || generatedPosterForSrc;

  useEffect(() => {
    if (!normalizedSrc || autoPlay) return;
    let cancelled = false;
    void extractVideoPosterFrame(normalizedSrc).then((frame) => {
      if (!cancelled) setGeneratedPoster({ src: normalizedSrc, poster: frame });
    });
    return () => {
      cancelled = true;
    };
  }, [autoPlay, normalizedSrc]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !normalizeText(src)) return;
    if (muted) {
      video.muted = true;
      video.defaultMuted = true;
      video.setAttribute("muted", "");
    } else {
      video.muted = false;
      video.defaultMuted = false;
      video.removeAttribute("muted");
    }
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    try {
      video.load();
    } catch {}
    if (!autoPlay) {
      const showFirstFrame = () => {
        try {
          if (Number.isFinite(video.duration) && video.duration > 0) {
            video.currentTime = Math.min(0.001, video.duration);
          }
        } catch {}
      };
      video.pause();
      video.addEventListener("loadedmetadata", showFirstFrame, { once: true });
      video.addEventListener("loadeddata", showFirstFrame, { once: true });
      return () => {
        video.removeEventListener("loadedmetadata", showFirstFrame);
        video.removeEventListener("loadeddata", showFirstFrame);
      };
    }
    const timer = window.setTimeout(() => {
      try {
        void video.play?.().catch(() => undefined);
      } catch {}
    }, 60);
    return () => window.clearTimeout(timer);
  }, [autoPlay, muted, src]);

  if (!autoPlay && resolvedPoster) {
    const posterStyle: CSSProperties = {
      backgroundImage: `url("${resolvedPoster.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}")`,
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
      backgroundSize: "contain",
    };
    return (
      <div className={`${className} overflow-hidden`} style={posterStyle} aria-label="视频第一帧预览" />
    );
  }

  return (
    <video
      key={autoPlay ? src : `${src}-${resolvedPoster ? "poster" : "video"}`}
      ref={videoRef}
      className={className}
      src={src}
      controls={controls}
      autoPlay={autoPlay}
      loop={loop}
      muted={muted}
      poster={resolvedPoster || undefined}
      preload={autoPlay ? "auto" : "metadata"}
      playsInline
    />
  );
}

function ContactCardSurface({
  name,
  targetUrl,
  contacts,
  invoice,
  contactFieldOrder,
  contactDisplayFields,
  sectionOrder,
  showContactSaveButton = true,
  showContactWebsiteButton = true,
  customContactLinks = [],
  introVideoUrl,
  introVideoPosterUrl,
  introVideoMuted = true,
  imageUrl,
  imageHeight,
  imageLinkUrl,
  imageX = 0,
  imageY = 0,
  imageScale = 1,
  imageOpacity = 1,
  onContactImagePointerDown,
  onContactImagePointerMove,
  onContactImagePointerEnd,
}: {
  name: string;
  targetUrl: string;
  contacts: MerchantBusinessCardDraft["contacts"];
  invoice: MerchantBusinessCardDraft["invoice"];
  contactFieldOrder: MerchantBusinessCardDraft["contactFieldOrder"];
  contactDisplayFields: MerchantBusinessCardDraft["contactDisplayFields"];
  sectionOrder?: MerchantBusinessCardDraft["contactPageSectionOrder"];
  showContactSaveButton?: boolean;
  showContactWebsiteButton?: boolean;
  customContactLinks?: MerchantBusinessCardCustomContactLink[];
  introVideoUrl?: string;
  introVideoPosterUrl?: string;
  introVideoMuted?: boolean;
  imageUrl?: string;
  imageHeight: number;
  imageLinkUrl?: string;
  imageX?: number;
  imageY?: number;
  imageScale?: number;
  imageOpacity?: number;
  onContactImagePointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onContactImagePointerMove?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onContactImagePointerEnd?: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const rows = buildContactPreviewRows(name, contacts, contactFieldOrder, contactDisplayFields, customContactLinks);
  const invoiceRows = buildInvoicePreviewRows(invoice);
  const normalizedSectionOrder = normalizeMerchantBusinessCardContactSectionOrder(sectionOrder);
  const displayName = isContactFieldVisibleOnContactCard(contactDisplayFields, "merchantName") ? normalizeText(name) : "";
  const hasImage = Boolean(normalizeText(imageUrl));
  const normalizedImageLinkUrl = normalizeMerchantBusinessCardShareTargetUrl(imageLinkUrl);
  const canDragContactImage = hasImage && Boolean(onContactImagePointerDown);
  const normalizedIntroVideoUrl = normalizeText(introVideoUrl);
  const normalizedIntroVideoPosterUrl = normalizeText(introVideoPosterUrl);
  const hasIntroVideo = Boolean(normalizedIntroVideoUrl);
  const domainLabel = normalizeText(targetUrl).replace(/^https?:\/\//i, "");
  const shouldShowActions = showContactSaveButton || showContactWebsiteButton;

  const renderContactSection = (sectionKey: MerchantBusinessCardContactSectionKey) => {
    if (sectionKey === "image") {
      if (!hasImage) return null;
      const imageNode = (
        <div
          className={`relative overflow-hidden rounded-[28px] border border-slate-200 bg-slate-50 shadow-[0_16px_42px_rgba(15,23,42,.08)] ${
            canDragContactImage ? "cursor-grab touch-none" : ""
          }`}
          style={{ height: `${imageHeight}px` }}
          onPointerDown={canDragContactImage ? onContactImagePointerDown : undefined}
          onPointerMove={canDragContactImage ? onContactImagePointerMove : undefined}
          onPointerUp={canDragContactImage ? onContactImagePointerEnd : undefined}
          onPointerCancel={canDragContactImage ? onContactImagePointerEnd : undefined}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={displayName || "联系卡展示图"}
            className="absolute h-full w-full object-contain"
            style={{
              left: `calc(50% + ${Math.round(imageX)}px)`,
              top: `calc(50% + ${Math.round(imageY)}px)`,
              maxWidth: "none",
              opacity: clamp(imageOpacity, 0, 1),
              pointerEvents: "none",
              transform: `translate(-50%, -50%) scale(${normalizeBackgroundImageScale(imageScale)})`,
              transformOrigin: "center",
              userSelect: "none",
              willChange: canDragContactImage ? "transform" : undefined,
            }}
          />
        </div>
      );
      return normalizedImageLinkUrl && !canDragContactImage ? (
        <a href={normalizedImageLinkUrl} className="block" target="_blank" rel="noreferrer">
          {imageNode}
        </a>
      ) : (
        imageNode
      );
    }
    if (sectionKey === "coupons") {
      return (
        <div className="rounded-[28px] border border-dashed border-slate-200 bg-white p-5 text-center text-xs font-medium text-slate-400">
          优惠券展示位置
        </div>
      );
    }
    if (rows.length === 0 && invoiceRows.length === 0) return null;
    return (
      <div className="space-y-5">
        {rows.length > 0 ? (
          <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5 shadow-[0_16px_42px_rgba(15,23,42,.08)]">
            <div className="space-y-4 text-slate-800">
              {rows.map((row) => (
                <div key={`${row.label}-${row.value}`} className="text-sm leading-7 text-slate-700">
                  <span className="font-semibold text-slate-900">{row.label}：</span>
                  <span className="break-words">{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {invoiceRows.length > 0 ? (
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_16px_42px_rgba(15,23,42,.08)]">
            <div className="mb-3 text-sm font-semibold text-slate-900">开票信息</div>
            <div className="space-y-4 text-slate-800">
              {invoiceRows.map((row) => (
                <div key={`${row.label}-${row.value}`} className="text-sm leading-7 text-slate-700">
                  <span className="font-semibold text-slate-900">{row.label}：</span>
                  <span className="break-words">{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="mx-auto w-full max-w-[430px] rounded-[32px] border border-white/70 bg-white/95 p-5 shadow-[0_28px_90px_rgba(15,23,42,.12)]">
      {displayName ? (
        <div className="mb-4 text-center">
          <div className="text-[11px] font-medium uppercase tracking-[0.24em] text-slate-400">FAOLLA CARD</div>
          <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{displayName}</div>
        </div>
      ) : null}

      {hasIntroVideo ? (
        <div className="mb-5 overflow-hidden rounded-[28px] border border-slate-200 bg-black shadow-[0_16px_42px_rgba(15,23,42,.08)]">
          <AutoPlayingVideoPreview
            src={normalizedIntroVideoUrl}
            poster={normalizedIntroVideoPosterUrl || undefined}
            className="block aspect-video w-full bg-black object-contain"
            muted={introVideoMuted}
            autoPlay={false}
          />
        </div>
      ) : null}

      {normalizedSectionOrder.map((sectionKey) => {
        const section = renderContactSection(sectionKey);
        return section ? (
          <div key={sectionKey} className={hasIntroVideo || sectionKey !== normalizedSectionOrder[0] ? "mt-5" : ""}>
            {section}
          </div>
        ) : null;
      })}

      {shouldShowActions ? (
        <div className="mt-5 flex gap-3">
          {showContactSaveButton ? (
            <button
              type="button"
              className="flex-1 cursor-default rounded-full bg-slate-900 px-5 py-3 text-base font-semibold text-white"
            >
              一键保存到通讯录
            </button>
          ) : null}
          {showContactWebsiteButton ? (
            <button
              type="button"
              className="rounded-full border border-slate-300 bg-white px-5 py-3 text-base font-medium text-slate-900"
            >
              进入官网
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 border-t border-slate-200 pt-4 text-center text-xs text-slate-500">
        名片服务由 <span className="font-semibold text-slate-900">{domainLabel || "www.faolla.com"}</span> 提供
      </div>
    </div>
  );
}

function resolveFilePickerStatus(selectedFileName: string, assetUrl: string, uploadedLabel: string) {
  const selectedName = normalizeText(selectedFileName);
  if (selectedName) return selectedName;
  return normalizeText(assetUrl) ? uploadedLabel : "未选择任何文件";
}

function isSameAssetUrl(left: string, right: string) {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function buildEditableBusinessCardDraftFromAsset(card: MerchantBusinessCardAsset) {
  let draft = normalizeMerchantBusinessCardDraft(card);
  const normalizedBackgroundImageUrl = normalizePublicAssetUrl(normalizeText(draft.backgroundImageUrl));
  if (normalizedBackgroundImageUrl && normalizedBackgroundImageUrl !== normalizeText(draft.backgroundImageUrl)) {
    draft = normalizeMerchantBusinessCardDraft({
      ...draft,
      backgroundImageUrl: normalizedBackgroundImageUrl,
    });
  }
  const publicContactImageUrl = normalizePublicAssetUrl(normalizeText(card.contactPagePublicImageUrl));
  const renderedImageUrl = normalizePublicAssetUrl(normalizeText(card.imageUrl));
  const renderedShareImageUrl = normalizePublicAssetUrl(normalizeText(card.shareImageUrl));
  const fallbackSnapshotImageUrl = renderedImageUrl || renderedShareImageUrl;
  const currentBackgroundImageUrl = normalizeText(draft.backgroundImageUrl);
  const backgroundIsFallbackSnapshot =
    isSameAssetUrl(currentBackgroundImageUrl, renderedImageUrl) ||
    isSameAssetUrl(currentBackgroundImageUrl, renderedShareImageUrl);

  if (!currentBackgroundImageUrl && fallbackSnapshotImageUrl && draft.backgroundImageSnapshotOnly) {
    draft = normalizeMerchantBusinessCardDraft({
      ...draft,
      backgroundImageUrl: fallbackSnapshotImageUrl,
      backgroundImageSnapshotOnly: true,
      backgroundImageX: 0,
      backgroundImageY: 0,
      backgroundImageScale: 1,
      backgroundImageOpacity: 1,
    });
  } else if (currentBackgroundImageUrl && draft.backgroundImageSnapshotOnly && !backgroundIsFallbackSnapshot) {
    draft = normalizeMerchantBusinessCardDraft({
      ...draft,
      backgroundImageSnapshotOnly: false,
    });
  }

  if (publicContactImageUrl && !normalizeText(draft.contactPageImageUrl)) {
    draft = normalizeMerchantBusinessCardDraft({
      ...draft,
      contactPageImageUrl: publicContactImageUrl,
    });
  }

  return draft;
}

function formatImageResultSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const kb = bytes / 1024;
  if (kb >= 1024) {
    return `${(kb / 1024).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(kb))} KB`;
}

function ImageFilePicker({
  label,
  statusText,
  detailText,
  accept = "image/*",
  disabled = false,
  onChange,
}: {
  label: string;
  statusText: string;
  detailText?: string;
  accept?: string;
  disabled?: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="block text-xs text-slate-600">
      {label}
      <span className="mt-1 block">
        <span
          className={`flex w-full items-center gap-3 rounded border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-slate-700 transition focus-within:border-sky-300 focus-within:ring-2 focus-within:ring-sky-100 ${
            disabled ? "cursor-wait opacity-80" : "cursor-pointer hover:bg-sky-100"
          }`}
        >
          <input type="file" accept={accept} className="sr-only" onChange={onChange} disabled={disabled} />
          <span className="shrink-0 rounded border border-sky-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
            选择文件
          </span>
          <span className="min-w-0 flex-1 truncate text-slate-500">{statusText}</span>
          {detailText ? <span className="shrink-0 text-[11px] font-medium text-sky-700">{detailText}</span> : null}
        </span>
      </span>
    </label>
  );
}

function BusinessCardEditorSection({
  title,
  children,
  defaultOpen = true,
  className = "",
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-sm ${className}`}>
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 px-3 py-3 text-left"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="font-semibold text-slate-900">{title}</span>
        <span className="shrink-0 text-xs font-semibold text-slate-500">{open ? "收起" : "展开"}</span>
      </button>
      {open ? <div className="space-y-2.5 border-t border-white/70 p-3">{children}</div> : null}
    </section>
  );
}

export default function MerchantBusinessCardManager({
  merchantId,
  siteBaseDomain,
  profile,
  cards,
  targetUrlOverride,
  folderViewMode = "overlay",
  cardLimit = 1,
  allowLinkMode = true,
  allowIntroVideo = true,
  backgroundImageLimitKb = 200,
  contactPageImageLimitKb = 200,
  exportImageLimitKb = 400,
  introVideoLimitMb = DEFAULT_CONTACT_INTRO_VIDEO_OUTPUT_LIMIT_MB,
  onCardsChange,
}: MerchantBusinessCardManagerProps) {
  const isPageFolderView = folderViewMode === "page";
  const normalizedMerchantId = normalizeText(merchantId);
  const [draft, setDraft] = useState(() => createDefaultMerchantBusinessCardDraft(profile));
  const [draftShareCode, setDraftShareCode] = useState(() => createMerchantBusinessCardShareKeyCode());
  const [editorOpen, setEditorOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<MerchantBusinessCardAsset | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [deletingCardId, setDeletingCardId] = useState<string | null>(null);
  const [copyingLinkCardId, setCopyingLinkCardId] = useState<string | null>(null);
  const [tip, setTip] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDraftSaving, setIsDraftSaving] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [numberInputDrafts, setNumberInputDrafts] = useState<Record<string, string>>({});
  const [selectedFieldKeys, setSelectedFieldKeys] = useState<string[]>(["merchantName"]);
  const [fontStyleEditorOpen, setFontStyleEditorOpen] = useState(false);
  const [applyUnifiedTypography, setApplyUnifiedTypography] = useState(false);
  const [contactPhoneEditorValues, setContactPhoneEditorValues] = useState<string[]>(() =>
    resolveDraftPhoneValues(createDefaultMerchantBusinessCardDraft(profile).contacts),
  );
  const [backgroundImageFileName, setBackgroundImageFileName] = useState("");
  const [backgroundImageFileDetail, setBackgroundImageFileDetail] = useState("");
  const [isBackgroundImageProcessing, setIsBackgroundImageProcessing] = useState(false);
  const [contactPageImageFileName, setContactPageImageFileName] = useState("");
  const [contactPageImageFileDetail, setContactPageImageFileDetail] = useState("");
  const [isContactPageImageProcessing, setIsContactPageImageProcessing] = useState(false);
  const [contactIntroVideoFileName, setContactIntroVideoFileName] = useState("");
  const [contactIntroVideoFileDetail, setContactIntroVideoFileDetail] = useState("");
  const [isContactIntroVideoProcessing, setIsContactIntroVideoProcessing] = useState(false);
  const hiddenPreviewRef = useRef<HTMLDivElement | null>(null);
  const backgroundImageDragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    scale: number;
  } | null>(null);
  const contactPageImageDragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const normalizedTargetUrlOverride = normalizeText(targetUrlOverride);

  const normalizedCards = useMemo(
    () => normalizeMerchantBusinessCardChatDisplaySelection(cards),
    [cards],
  );
  const normalizedCardsRef = useRef<MerchantBusinessCardAsset[]>(normalizedCards);
  const draftRevisionRef = useRef(0);
  const backgroundSyncGenerationRef = useRef<Record<string, number>>({});
  useEffect(() => {
    normalizedCardsRef.current = normalizedCards;
  }, [normalizedCards]);
  const missingFields = useMemo(
    () => (normalizedTargetUrlOverride ? [] : getMerchantBusinessCardRequiredFields(profile)),
    [normalizedTargetUrlOverride, profile],
  );
  const canCreate = missingFields.length === 0;
  const websiteUrl = useMemo(
    () => normalizedTargetUrlOverride || buildMerchantDomain(siteBaseDomain, normalizeText(profile.domainPrefix), "https"),
    [normalizedTargetUrlOverride, siteBaseDomain, profile.domainPrefix],
  );
  const draftStorageKey = useMemo(
    () =>
      buildBusinessCardDraftStorageKey({
        merchantId: normalizedMerchantId,
        targetUrl: websiteUrl,
        domainPrefix: profile.domainPrefix,
      }),
    [normalizedMerchantId, profile.domainPrefix, websiteUrl],
  );
  const primarySelectedFieldKey = selectedFieldKeys[selectedFieldKeys.length - 1] ?? "merchantName";
  const selectedCustomTextId = useMemo(
    () => getCustomTextIdFromSelectionKey(primarySelectedFieldKey),
    [primarySelectedFieldKey],
  );
  const selectedCustomText = useMemo(
    () => draft.customTexts.find((item) => item.id === selectedCustomTextId) ?? null,
    [draft.customTexts, selectedCustomTextId],
  );
  const selectedFieldMeta = useMemo(() => {
    const standardField = TEXT_LAYOUT_FIELDS.find((item) => item.key === primarySelectedFieldKey);
    if (standardField) return { label: standardField.label, kind: "field" as const };
    if (selectedCustomText) {
      return {
        label: getCustomTextLabel(
          selectedCustomText.text,
          draft.customTexts.findIndex((item) => item.id === selectedCustomText.id),
        ),
        kind: "custom" as const,
      };
    }
    return { label: TEXT_LAYOUT_FIELDS[0]?.label ?? "", kind: "field" as const };
  }, [draft.customTexts, primarySelectedFieldKey, selectedCustomText]);
  const selectedFieldSummary = useMemo(() => {
    if (selectedFieldKeys.length <= 1) return selectedFieldMeta.label;
    return `${selectedFieldMeta.label} 等 ${selectedFieldKeys.length} 项`;
  }, [selectedFieldKeys.length, selectedFieldMeta.label]);
  const selectedTypography = selectedCustomText
    ? selectedCustomText.typography
    : draft.fieldTypography[primarySelectedFieldKey as MerchantBusinessCardFieldKey] ??
      draft.fieldTypography.merchantName ??
      draft.typography.info;
  const selectedTypographyFontSize =
    typeof selectedTypography.fontSize === "number" && Number.isFinite(selectedTypography.fontSize)
      ? normalizeTypographyFontSize(selectedTypography.fontSize)
      : 16;
  const selectedTypographyFontSizeInput = getNumberInputValue(
    TYPOGRAPHY_FONT_SIZE_INPUT_KEY,
    selectedTypographyFontSize,
  );
  const orderedContactFields = useMemo(() => getOrderedContactFields(draft.contactFieldOrder), [draft.contactFieldOrder]);
  const selectedTypographyFontSizeOptionValue = useMemo(() => {
    const parsed = Number(selectedTypographyFontSizeInput.trim());
    if (!Number.isFinite(parsed)) return "";
    const normalized = normalizeTypographyFontSize(parsed);
    return FONT_SIZE_OPTIONS.includes(normalized) ? String(normalized) : "";
  }, [selectedTypographyFontSizeInput]);
  const positionEditorItems = useMemo(
    () => [
      ...TEXT_LAYOUT_FIELDS.filter(
        (item) =>
          item.key === "merchantName" ||
          item.key === "title" ||
          item.key === "website",
      ).map((item) => ({
        id: item.key,
        label: item.label,
        kind: "field" as const,
      })),
      ...orderedContactFields.map((item) => ({
        id: item.key,
        label: item.label,
        kind: "field" as const,
      })),
      ...draft.customTexts.map((item, index) => ({
        id: getCustomTextSelectionKey(item.id),
        label: getCustomTextLabel(item.text, index),
        kind: "custom" as const,
        customTextId: item.id,
      })),
    ],
    [draft.customTexts, orderedContactFields],
  );
  const scale = useMemo(
    () => Math.min(1, 520 / Math.max(1, draft.width), 460 / Math.max(1, draft.height)),
    [draft.height, draft.width],
  );
  const normalizedCardLimit = useMemo(() => Math.max(1, Math.min(100, Math.round(Number(cardLimit) || 1))), [cardLimit]);
  const fullScale = useMemo(() => Math.min(1, 1000 / Math.max(1, draft.width)), [draft.width]);
  const qrMayBeUnreadable = draft.qr.size < QR_MIN_READABLE_SIZE;
  const qrReadyForCurrentDraft = !draft.showQr || !!qrCodeUrl;
  const selectedChatDisplayCard = useMemo(
    () => resolveMerchantBusinessCardForChatDisplay(normalizedCards),
    [normalizedCards],
  );
  const cardFolderCountLabel = `${normalizedCards.length}/${normalizedCardLimit}`;
  const cardLimitReached = !editingCardId && normalizedCards.length >= normalizedCardLimit;
  const canOpenCreateEditor = canCreate && !cardLimitReached;
  const normalizedBackgroundImageLimitKb = useMemo(
    () => Math.max(50, Math.min(5000, Math.round(Number(backgroundImageLimitKb) || 200))),
    [backgroundImageLimitKb],
  );
  const normalizedContactPageImageLimitKb = useMemo(
    () => Math.max(50, Math.min(5000, Math.round(Number(contactPageImageLimitKb) || 200))),
    [contactPageImageLimitKb],
  );
  const normalizedExportImageLimitKb = useMemo(
    () => Math.max(50, Math.min(5000, Math.round(Number(exportImageLimitKb) || 400))),
    [exportImageLimitKb],
  );
  const normalizedIntroVideoLimitMb = useMemo(
    () =>
      Math.max(
        1,
        Math.min(
          Math.round(CONTACT_INTRO_VIDEO_SOURCE_LIMIT_BYTES / 1024 / 1024),
          Math.round(Number(introVideoLimitMb) || DEFAULT_CONTACT_INTRO_VIDEO_OUTPUT_LIMIT_MB),
        ),
      ),
    [introVideoLimitMb],
  );
  const canUseIntroVideo = allowIntroVideo !== false;
  const editingCard = useMemo(
    () => (editingCardId ? normalizedCards.find((card) => card.id === editingCardId) ?? null : null),
    [editingCardId, normalizedCards],
  );
  const canUseDraftLinkMode = allowLinkMode || editingCard?.mode === "link";
  const activeLinkShareKey = useMemo(() => {
    if (draft.mode !== "link") return "";
    return (
      normalizeText(editingCard?.shareKey) ||
      createMerchantBusinessCardShareKey({
        contactName: draft.contacts.contactName,
        name: draft.name,
        targetUrl: websiteUrl,
        code: draftShareCode,
      })
    );
  }, [draft.contacts.contactName, draft.mode, draft.name, draftShareCode, editingCard, websiteUrl]);
  const draftLinkUrl = useMemo(() => {
    if (draft.mode !== "link" || !websiteUrl) return "";
    return buildMerchantBusinessCardShareUrl({
      origin: resolveMerchantBusinessCardShareOrigin(undefined, websiteUrl),
      shareKey: activeLinkShareKey,
      targetUrl: websiteUrl,
      name: normalizeText(draft.name),
      introVideoUrl: canUseIntroVideo ? normalizeText(draft.contactIntroVideoUrl) : "",
      introPosterUrl: canUseIntroVideo ? normalizeText(draft.contactIntroVideoPosterUrl) : "",
      introVideoMuted: draft.contactIntroVideoMuted,
      contactPageSectionOrder: draft.contactPageSectionOrder,
      showContactSaveButton: draft.showContactSaveButton,
      showContactWebsiteButton: draft.showContactWebsiteButton,
      contact: buildShareContactPayload({
        name: draft.name,
        title: draft.title,
        contacts: draft.contacts,
        invoice: draft.invoice,
        contactFieldOrder: draft.contactFieldOrder,
        contactDisplayFields: draft.contactDisplayFields,
        customContactLinks: draft.customContactLinks,
        targetUrl: websiteUrl,
      }),
    });
  }, [
    activeLinkShareKey,
    canUseIntroVideo,
    draft.contactFieldOrder,
    draft.contactDisplayFields,
    draft.contactIntroVideoPosterUrl,
    draft.contactIntroVideoMuted,
    draft.contactIntroVideoUrl,
    draft.contactPageSectionOrder,
    draft.contacts,
    draft.customContactLinks,
    draft.invoice,
    draft.mode,
    draft.name,
    draft.showContactSaveButton,
    draft.showContactWebsiteButton,
    draft.title,
    websiteUrl,
  ]);
  const qrTargetUrl = draft.mode === "link" ? draftLinkUrl || websiteUrl : websiteUrl;

  useEffect(() => {
    clearNumberInputDraft(TYPOGRAPHY_FONT_SIZE_INPUT_KEY);
  }, [primarySelectedFieldKey, selectedTypographyFontSize]);

  useEffect(() => {
    if (!tip) return;
    showGlobalToast(tip);
    const timer = window.setTimeout(() => setTip(""), 3000);
    return () => window.clearTimeout(timer);
  }, [tip]);

  useEffect(() => {
    let cancelled = false;
    if (!qrTargetUrl) {
      setQrCodeUrl("");
      return;
    }
    void import("qrcode")
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(qrTargetUrl, {
          width: clamp(draft.qr.size * 2, 96, 1200),
          margin: 1,
          errorCorrectionLevel: "M",
        }),
      )
      .then((url) => {
        if (!cancelled) setQrCodeUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrCodeUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [draft.qr.size, qrTargetUrl]);

  useEffect(() => {
    const validSelectionKeys = new Set<string>([
      ...ALL_FIELD_LAYOUT_KEYS,
      ...draft.customTexts.map((item) => getCustomTextSelectionKey(item.id)),
    ]);
    setSelectedFieldKeys((current) => {
      const next = current.filter((item) => validSelectionKeys.has(item));
      return next.length > 0 ? next : ["merchantName"];
    });
  }, [draft.customTexts]);

  useEffect(() => {
    if (canUseDraftLinkMode || draft.mode !== "link") return;
    draftRevisionRef.current += 1;
    setDraft((current) => normalizeMerchantBusinessCardDraft({ ...current, mode: "image" }));
    setPreviewAsset(null);
  }, [canUseDraftLinkMode, draft.mode]);

  useEffect(() => {
    if (normalizedCards.length === 0) return;
    const hasManualDisabledState = normalizedCards.some((card) => card.chatDisplayDisabled);
    if (!hasManualDisabledState) return;
    void Promise.resolve(
      onCardsChange(
        normalizeMerchantBusinessCardChatDisplaySelection(
          normalizedCards.map((card) => ({
            ...card,
            showInChat: false,
            chatDisplayDisabled: false,
          })),
        ),
      ),
    ).catch(() => undefined);
  }, [normalizedCards, onCardsChange]);

  const applyDraft = (recipe: (current: MerchantBusinessCardDraft) => MerchantBusinessCardDraft) => {
    setDraft((current) => {
      const next = recipe(current);
      if (next !== current) {
        draftRevisionRef.current += 1;
      }
      return next;
    });
  };

  const setSingleSelectedField = (selectionKey: string) => {
    setSelectedFieldKeys([selectionKey]);
  };

  const handleSelectedFieldClick = (selectionKey: string, event?: ReactMouseEvent<HTMLElement>) => {
    const appendSelection = Boolean(event?.ctrlKey || event?.metaKey);
    if (!appendSelection) {
      setSingleSelectedField(selectionKey);
      return;
    }
    setSelectedFieldKeys((current) => {
      if (current.includes(selectionKey)) {
        const next = current.filter((item) => item !== selectionKey);
        return next.length > 0 ? next : [selectionKey];
      }
      return [...current.filter((item) => item !== selectionKey), selectionKey];
    });
  };

  const openEditor = () => {
    if (!canCreate) return;
    if (cardLimitReached) {
      setTip(`名片夹已达到上限（${normalizedCardLimit} 张），请先删除旧名片或到超级后台调整数量限制`);
      return;
    }
    const nextDraft = readSavedBusinessCardDraft(draftStorageKey) ?? createDefaultMerchantBusinessCardDraft(profile);
    draftRevisionRef.current += 1;
    setDraft(nextDraft);
    setContactPhoneEditorValues(resolveDraftPhoneValues(nextDraft.contacts));
    setBackgroundImageFileName("");
    setBackgroundImageFileDetail("");
    setIsBackgroundImageProcessing(false);
    setContactPageImageFileName("");
    setContactPageImageFileDetail("");
    setIsContactPageImageProcessing(false);
    setContactIntroVideoFileName("");
    setContactIntroVideoFileDetail("");
    setIsContactIntroVideoProcessing(false);
    setDraftShareCode(createMerchantBusinessCardShareKeyCode());
    setSelectedFieldKeys(["merchantName"]);
    setEditingCardId(null);
    setPreviewAsset(null);
    setPreviewOpen(false);
    setEditorOpen(true);
  };

  const openEditorForCard = (card: MerchantBusinessCardAsset) => {
    if (!canCreate) return;
    const nextDraft = buildEditableBusinessCardDraftFromAsset(card);
    draftRevisionRef.current += 1;
    setDraft(nextDraft);
    setContactPhoneEditorValues(resolveDraftPhoneValues(nextDraft.contacts));
    setBackgroundImageFileName("");
    setBackgroundImageFileDetail("");
    setIsBackgroundImageProcessing(false);
    setContactPageImageFileName("");
    setContactPageImageFileDetail("");
    setIsContactPageImageProcessing(false);
    setContactIntroVideoFileName("");
    setContactIntroVideoFileDetail("");
    setIsContactIntroVideoProcessing(false);
    setDraftShareCode(createMerchantBusinessCardShareKeyCode());
    setSelectedFieldKeys(["merchantName"]);
    setEditingCardId(card.id);
    setPreviewAsset(null);
    setPreviewOpen(false);
    setFolderOpen(false);
    setEditorOpen(true);
  };

  const openDuplicateEditorForCard = (card: MerchantBusinessCardAsset) => {
    if (!canCreate) return;
    if (cardLimitReached) {
      setTip(`名片夹已达到上限（${normalizedCardLimit} 张），请先删除旧名片或到超级后台调整数量限制`);
      return;
    }
    const nextDraft = buildEditableBusinessCardDraftFromAsset(card);
    draftRevisionRef.current += 1;
    setDraft(nextDraft);
    setContactPhoneEditorValues(resolveDraftPhoneValues(nextDraft.contacts));
    setBackgroundImageFileName("");
    setBackgroundImageFileDetail("");
    setIsBackgroundImageProcessing(false);
    setContactPageImageFileName("");
    setContactPageImageFileDetail("");
    setIsContactPageImageProcessing(false);
    setContactIntroVideoFileName("");
    setContactIntroVideoFileDetail("");
    setIsContactIntroVideoProcessing(false);
    setDraftShareCode(createMerchantBusinessCardShareKeyCode());
    setSelectedFieldKeys(["merchantName"]);
    setEditingCardId(null);
    setPreviewAsset(null);
    setPreviewOpen(false);
    setFolderOpen(false);
    setEditorOpen(true);
  };

  const openCreateEditorFromFolder = () => {
    setFolderOpen(false);
    openEditor();
  };

  const handleBackgroundUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const previousFileName = backgroundImageFileName;
    const previousFileDetail = backgroundImageFileDetail;
    try {
      const fileName = normalizeText(file.name);
      setBackgroundImageFileName(fileName || "背景图");
      setBackgroundImageFileDetail("");
      setIsBackgroundImageProcessing(true);
      const optimized = await compressImageFileWithinLimit(file, normalizedBackgroundImageLimitKb * 1024);
      if (optimized.bytes > normalizedBackgroundImageLimitKb * 1024) {
        setBackgroundImageFileName(previousFileName);
        setBackgroundImageFileDetail(previousFileDetail);
        setTip(`名片背景图不能超过 ${normalizedBackgroundImageLimitKb} KB`);
        return;
      }
      applyDraft((current) => ({
        ...current,
        backgroundImageUrl: optimized.dataUrl,
        backgroundImageSnapshotOnly: false,
        backgroundImageX: 0,
        backgroundImageY: 0,
        backgroundImageScale: 1,
      }));
      setBackgroundImageFileName(fileName || "已上传背景图");
      setBackgroundImageFileDetail(`${optimized.compressed ? "压缩后" : "大小"} ${formatImageResultSize(optimized.bytes)}`);
    } catch {
      setBackgroundImageFileName(previousFileName);
      setBackgroundImageFileDetail(previousFileDetail);
      setTip("背景图上传失败，请重试");
    } finally {
      setIsBackgroundImageProcessing(false);
      event.target.value = "";
    }
  };

  const handleClearBackgroundImage = () => {
    setBackgroundImageFileName("");
    setBackgroundImageFileDetail("");
    setIsBackgroundImageProcessing(false);
    applyDraft((current) => ({
      ...current,
      backgroundImageUrl: "",
      backgroundImageSnapshotOnly: false,
      backgroundImageX: 0,
      backgroundImageY: 0,
      backgroundImageScale: 1,
    }));
  };

  const handleSaveDraft = async () => {
    if (isContactIntroVideoProcessing) {
      setTip("开场视频还在上传转换中，请完成后再保存");
      return;
    }
    setIsDraftSaving(true);
    try {
      writeSavedBusinessCardDraft(draftStorageKey, draft);
      const savedExistingCard = editingCardId
        ? await saveCurrentDraftSettingsToExistingCard({
            deferShareSync: true,
            refreshFrontImage: Boolean(websiteUrl && qrReadyForCurrentDraft),
          })
        : null;
      setTip(
        savedExistingCard
          ? savedExistingCard.mode === "link"
            ? "名片设置已保存，联系卡后台同步中"
            : "名片设置已保存"
          : "名片草稿已保存",
      );
    } catch (error) {
      if (error instanceof Error && error.message === "share_link_not_ready") {
        setTip("短链还没同步成功，请重试保存");
      } else if (error instanceof Error && error.message === "share_auth_unavailable") {
        setTip("登录状态还没准备好，请刷新后台后再试一次");
      } else if (error instanceof Error && error.message === "share_request_timeout") {
        setTip("短链保存超时，请重试");
      } else {
        setTip(editingCardId ? "名片设置同步失败，请点保存重试" : "草稿保存失败，请重试");
      }
    } finally {
      setIsDraftSaving(false);
    }
  };

  const handleBackgroundPointerDown = (event: ReactPointerEvent<HTMLDivElement>, surfaceScale: number) => {
    if (!normalizeText(draft.backgroundImageUrl) || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    backgroundImageDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: draft.backgroundImageX,
      startY: draft.backgroundImageY,
      scale: Math.max(0.01, surfaceScale),
    };
  };

  const handleBackgroundPointerMove = (event: ReactPointerEvent<HTMLDivElement>, surfaceScale: number) => {
    const drag = backgroundImageDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const activeScale = Math.max(0.01, drag.scale || surfaceScale);
    const nextX = Math.round(drag.startX + (event.clientX - drag.startClientX) / activeScale);
    const nextY = Math.round(drag.startY + (event.clientY - drag.startClientY) / activeScale);
    applyDraft((current) => ({
      ...current,
      backgroundImageX: clamp(nextX, -5000, 5000),
      backgroundImageY: clamp(nextY, -5000, 5000),
    }));
  };

  const handleBackgroundPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = backgroundImageDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    backgroundImageDragRef.current = null;
  };

  const handleContactPageImagePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!normalizeText(draft.contactPageImageUrl) || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    contactPageImageDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: draft.contactPageImageX,
      startY: draft.contactPageImageY,
    };
  };

  const handleContactPageImagePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = contactPageImageDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const nextX = Math.round(drag.startX + event.clientX - drag.startClientX);
    const nextY = Math.round(drag.startY + event.clientY - drag.startClientY);
    applyDraft((current) => ({
      ...current,
      contactPageImageX: clamp(nextX, -5000, 5000),
      contactPageImageY: clamp(nextY, -5000, 5000),
    }));
  };

  const handleContactPageImagePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = contactPageImageDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    contactPageImageDragRef.current = null;
  };

  const handleGenerate = async () => {
    if (!websiteUrl || !qrReadyForCurrentDraft) return;
    if (isContactIntroVideoProcessing) {
      setTip("开场视频还在上传转换中，请完成后再保存");
      return;
    }
    setIsGenerating(true);
    try {
      const asset = await saveCurrentDraftToFolder();
      if (!asset) {
        setTip("名片生成失败，请重试");
        return;
      }
      setPreviewOpen(false);
      setPreviewAsset(null);
      setEditorOpen(false);
      setFolderOpen(true);
      setPreviewAsset(asset);
      setTip(editingCardId ? "名片已更新并保存到名片夹" : "名片已生成并保存到名片夹");
    } catch (error) {
      if (error instanceof Error && error.message === "business_card_limit_reached") {
        setTip(`名片夹已达到上限（${normalizedCardLimit} 张），请先删除旧名片或到超级后台调整数量限制`);
      } else if (error instanceof Error && error.message === "export_image_limit_exceeded") {
        setTip(`自动压缩后仍超过 ${normalizedExportImageLimitKb} KB，请减少内容或更换背景后再试`);
      } else if (error instanceof Error && error.message === "share_auth_unavailable") {
        setTip("登录状态还没准备好，请刷新后台后再试一次");
      } else if (error instanceof Error && error.message === "share_request_timeout") {
        setTip("短链保存超时，请重试");
      } else if (error instanceof Error && error.message === "share_link_not_ready") {
        setTip("短链还没同步成功，请重试保存");
      } else if (error instanceof Error && error.message === "business_card_preview_unavailable") {
        setTip("名片预览还没准备好，请关闭后重新打开再试");
      } else {
        setTip("名片生成失败，请重试");
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleContactPageImageUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const previousFileName = contactPageImageFileName;
    const previousFileDetail = contactPageImageFileDetail;
    try {
      const fileName = normalizeText(file.name);
      setContactPageImageFileName(fileName || "联系卡图片");
      setContactPageImageFileDetail("");
      setIsContactPageImageProcessing(true);
      const optimized = await compressImageFileWithinLimit(file, normalizedContactPageImageLimitKb * 1024);
      if (optimized.bytes > normalizedContactPageImageLimitKb * 1024) {
        setContactPageImageFileName(previousFileName);
        setContactPageImageFileDetail(previousFileDetail);
        setTip(`联系卡展示图不能超过 ${normalizedContactPageImageLimitKb} KB`);
        return;
      }
      const imageUrl = optimized.dataUrl;
      applyDraft((current) => ({
        ...current,
        contactPageImageUrl: imageUrl,
        contactPageImageX: 0,
        contactPageImageY: 0,
        contactPageImageScale: 1,
        contactPageImageOpacity: 1,
      }));
      setContactPageImageFileName(fileName || "已上传联系卡图片");
      setContactPageImageFileDetail(`${optimized.compressed ? "压缩后" : "大小"} ${formatImageResultSize(optimized.bytes)}`);
    } catch {
      setContactPageImageFileName(previousFileName);
      setContactPageImageFileDetail(previousFileDetail);
      setTip("联系卡图片上传失败，请重试");
    } finally {
      setIsContactPageImageProcessing(false);
      event.target.value = "";
    }
  };

  const handleContactIntroVideoUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!canUseIntroVideo) {
      setTip("当前账号未开启联系卡开场视频权限");
      event.target.value = "";
      return;
    }
    const previousFileName = contactIntroVideoFileName;
    const previousFileDetail = contactIntroVideoFileDetail;
    try {
      const fileName = normalizeText(file.name);
      const fileType = normalizeText(file.type).toLowerCase();
      const looksLikeVideoFile = /\.(mp4|m4v|webm|ogv|ogg|mov|mkv|avi|3gp|3g2|mpg|mpeg)$/i.test(fileName);
      if (!fileType.startsWith("video/") && !looksLikeVideoFile) {
        setTip("请选择视频文件");
        return;
      }
      if (file.size > CONTACT_INTRO_VIDEO_SOURCE_LIMIT_BYTES) {
        setTip(`联系卡开场视频原文件不能超过 ${Math.round(CONTACT_INTRO_VIDEO_SOURCE_LIMIT_BYTES / 1024 / 1024)} MB`);
        return;
      }
      setContactIntroVideoFileName(fileName || "开场视频");
      setContactIntroVideoFileDetail("上传并压缩转换中...");
      setIsContactIntroVideoProcessing(true);
      const introVideoAssetHint = sanitizeShareAssetHint(
        `${normalizeText(profile.domainPrefix) || normalizeText(draft.name) || normalizeText(profile.merchantName)}-intro-video`,
      );
      const localPosterPromise =
        typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
          ? (() => {
              const objectUrl = URL.createObjectURL(file);
              return extractVideoPosterFrame(objectUrl).finally(() => {
                URL.revokeObjectURL(objectUrl);
              });
            })()
          : Promise.resolve("");
      const uploadedAsset = await uploadFileToPublicStorageWithMetadata(file, {
        merchantHint: introVideoAssetHint,
        folder: "merchant-assets",
        usage: "business-card-intro-video",
        operation: {
          operationModule: "经营中心 > 名片夹",
          operationAction: "上传联系卡开场视频",
          operationSummary: `在经营中心 > 名片夹上传联系卡开场视频：${draft.name || profile.merchantName || "未命名名片"}`,
        },
      });
      const uploadedUrl = normalizeText(uploadedAsset?.url);
      if (!uploadedUrl) {
        throw new Error("video_upload_failed");
      }
      let posterUrl = normalizeText(uploadedAsset?.posterUrl);
      if (!posterUrl) {
        const localPoster = normalizeText(await localPosterPromise.catch(() => ""));
        if (localPoster) {
          posterUrl = await uploadBusinessCardIntroVideoPosterFallback(
            localPoster,
            introVideoAssetHint,
            draft.name || profile.merchantName || "未命名名片",
          );
        }
      }
      applyDraft((current) => ({
        ...current,
        contactIntroVideoUrl: uploadedUrl,
        contactIntroVideoPosterUrl: posterUrl,
      }));
      setContactIntroVideoFileName(fileName || "已上传开场视频");
      setContactIntroVideoFileDetail(`原始 ${formatImageResultSize(file.size)}，已转为快速播放 MP4`);
    } catch (error) {
      setContactIntroVideoFileName(previousFileName);
      setContactIntroVideoFileDetail(previousFileDetail);
      const message = error instanceof Error ? normalizeText(error.message) : "";
      setTip(message || "开场视频上传失败，请重试");
    } finally {
      setIsContactIntroVideoProcessing(false);
      event.target.value = "";
    }
  };

  const handleClearContactIntroVideo = () => {
    setContactIntroVideoFileName("");
    setContactIntroVideoFileDetail("");
    setIsContactIntroVideoProcessing(false);
    applyDraft((current) => ({ ...current, contactIntroVideoUrl: "", contactIntroVideoPosterUrl: "" }));
  };

  const updateDraftPhones = (nextPhones: string[]) => {
    const cappedPhoneInputs = nextPhones.slice(0, MERCHANT_BUSINESS_CARD_PHONE_LIMIT);
    setContactPhoneEditorValues(cappedPhoneInputs.length > 0 ? cappedPhoneInputs : [""]);
    const normalizedPhones = normalizePhoneList(cappedPhoneInputs);
    applyDraft((current) => ({
      ...current,
      contacts: {
        ...current.contacts,
        phone: normalizedPhones[0] ?? "",
        phones: normalizedPhones,
      },
    }));
  };

  const moveContactField = (key: MerchantBusinessCardEditableContactFieldKey, direction: "up" | "down") => {
    applyDraft((current) => {
      const currentOrder = normalizeMerchantBusinessCardContactFieldOrder(current.contactFieldOrder);
      const currentIndex = currentOrder.indexOf(key);
      if (currentIndex < 0) return current;
      const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
      if (nextIndex < 0 || nextIndex >= currentOrder.length) return current;
      const nextOrder = [...currentOrder];
      [nextOrder[currentIndex], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[currentIndex]];
      return {
        ...current,
        contactFieldOrder: nextOrder,
        textLayout: applyMerchantBusinessCardContactFieldOrderToTextLayout(current.textLayout, nextOrder),
      };
    });
    setSingleSelectedField(key);
  };

  const updateContactDisplayField = (
    key: MerchantBusinessCardContactOnlyFieldKey,
    target: MerchantBusinessCardContactDisplayTargetKey,
    checked: boolean,
  ) => {
    applyDraft((current) => {
      const currentTarget = resolveContactDisplayTarget(current.contactDisplayFields, key);
      return normalizeMerchantBusinessCardDraft({
        ...current,
        contactDisplayFields: {
          ...current.contactDisplayFields,
          [key]: {
            ...currentTarget,
            [target]: checked,
          },
        },
      });
    });
  };

  const moveContactPageSection = (key: MerchantBusinessCardContactSectionKey, direction: "up" | "down") => {
    applyDraft((current) => {
      const currentOrder = normalizeMerchantBusinessCardContactSectionOrder(current.contactPageSectionOrder);
      const currentIndex = currentOrder.indexOf(key);
      const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= currentOrder.length) return current;
      const nextOrder = [...currentOrder];
      [nextOrder[currentIndex], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[currentIndex]];
      return {
        ...current,
        contactPageSectionOrder: nextOrder,
      };
    });
  };

  const addCustomContactLink = () => {
    applyDraft((current) => ({
      ...current,
      customContactLinks: [
        ...current.customContactLinks,
        {
          id: createId("custom-contact"),
          label: "自定义",
          displayText: "",
          url: "",
          iconPreset: "link",
          iconUrl: "",
          bgColor: "#0f172a",
        },
      ],
    }));
  };

  const updateCustomContactLink = (
    id: string,
    recipe: (current: MerchantBusinessCardCustomContactLink) => MerchantBusinessCardCustomContactLink,
  ) => {
    applyDraft((current) => ({
      ...current,
      customContactLinks: current.customContactLinks.map((item) => (item.id === id ? recipe(item) : item)),
    }));
  };

  const removeCustomContactLink = (id: string) => {
    applyDraft((current) => ({
      ...current,
      customContactLinks: current.customContactLinks.filter((item) => item.id !== id),
    }));
  };

  async function handleCustomContactIconUpload(id: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const shareOrigin = resolveMerchantBusinessCardShareOrigin(undefined, websiteUrl);
    const uploadedAsset = await uploadFileToPublicStorageWithMetadata(file, {
      merchantHint: sanitizeShareAssetHint(`${normalizeText(profile.domainPrefix) || normalizeText(draft.name) || "business-card"}-contact-icon`),
      folder: "merchant-assets",
      usage: "business-card-contact",
      operation: {
        operationModule: "经营中心 > 名片夹",
        operationAction: "上传自定义联系方式图标",
        operationSummary: `在经营中心 > 名片夹上传自定义联系方式图标：${draft.name || profile.merchantName || "未命名名片"}`,
      },
    });
    const iconUrl = normalizeMerchantBusinessCardShareImageUrl(normalizeText(uploadedAsset?.url), shareOrigin);
    if (!iconUrl) {
      setTip("图标上传失败，请重试");
      return;
    }
    updateCustomContactLink(id, (current) => ({ ...current, iconUrl }));
    setTip("自定义图标已上传");
  }

  function buildLegacySharePayload(card: MerchantBusinessCardAsset) {
    const targetUrl = normalizeText(card.targetUrl);
    if (card.mode !== "link" || !targetUrl) {
      return null;
    }

    return {
      name: normalizeText(card.name),
      imageUrl: normalizeText(card.shareImageUrl),
      detailImageUrl: normalizeText(card.contactPagePublicImageUrl),
      detailImageHeight: card.contactPageImageHeight,
      detailImageLinkUrl: normalizeText(card.contactPageImageLinkUrl),
      detailImageX: card.contactPageImageX,
      detailImageY: card.contactPageImageY,
      detailImageScale: card.contactPageImageScale,
      detailImageOpacity: card.contactPageImageOpacity,
      introVideoUrl: normalizeText(card.contactIntroVideoUrl),
      introPosterUrl: normalizeText(card.contactIntroVideoPosterUrl),
      introVideoMuted: card.contactIntroVideoMuted,
      contactPageSectionOrder: card.contactPageSectionOrder,
      showContactSaveButton: card.showContactSaveButton,
      showContactWebsiteButton: card.showContactWebsiteButton,
      targetUrl,
      imageWidth: card.width,
      imageHeight: card.height,
      contact: buildShareContactPayload({
        name: card.name,
        title: card.title,
        contacts: card.contacts,
        invoice: card.invoice,
        contactFieldOrder: card.contactFieldOrder,
        contactDisplayFields: card.contactDisplayFields,
        customContactLinks: card.customContactLinks,
        targetUrl,
      }),
    };
  }

  async function deleteCardShare(card: MerchantBusinessCardAsset) {
    const shareKey = normalizeText(card.shareKey);
    const legacyPayload = buildLegacySharePayload(card);
    if (card.mode !== "link" && !shareKey) {
      return;
    }
    if (!shareKey && !legacyPayload) {
      throw new Error("share_delete_failed");
    }

    let lastErrorCode = "";

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const headers: Record<string, string> = {
          "content-type": "application/json",
        };
        if (normalizedMerchantId) {
          headers["x-merchant-site-id"] = normalizedMerchantId;
        }

        const response = await fetchWithTimeout(
          "/api/business-card-share",
          {
            method: "DELETE",
            headers,
            credentials: "same-origin",
            body: JSON.stringify({
              ...(normalizedMerchantId ? { merchantId: normalizedMerchantId } : {}),
              ...(shareKey ? { key: shareKey } : {}),
              ...(legacyPayload ? { legacyPayload } : {}),
            }),
          },
          attempt === 0 ? 12_000 : 16_000,
        );
        const payload = (await response.json().catch(() => null)) as {
          ok?: unknown;
          error?: unknown;
        } | null;
        lastErrorCode = typeof payload?.error === "string" ? payload.error.trim() : "";
        if (response.ok) {
          return;
        }
        if (attempt === 0 && (response.status === 401 || response.status === 503 || lastErrorCode === "unauthorized")) {
          await delay(500);
          continue;
        }
        if (attempt === 0 && response.status >= 500) {
          await delay(400);
          continue;
        }
      } catch (error) {
        lastErrorCode = error instanceof Error && error.name === "AbortError" ? "share_delete_timeout" : "share_delete_failed";
        if (attempt === 0) {
          await delay(400);
          continue;
        }
      }
      break;
    }

    throw new Error(
      lastErrorCode === "unauthorized"
        ? "share_delete_unauthorized"
        : lastErrorCode === "share_delete_timeout"
          ? "share_delete_timeout"
          : "share_delete_failed",
    );
  }

  const deleteCard = async (card: MerchantBusinessCardAsset) => {
    if (deletingCardId === card.id) return;
    if (typeof window !== "undefined" && !window.confirm(`确认删除名片“${card.name}”吗？`)) {
      return;
    }

    setDeletingCardId(card.id);
    const hasPublicShare = card.mode === "link" || Boolean(normalizeText(card.shareKey));
    try {
      await deleteCardShare(card);

      const nextCards = normalizedCards.filter((item) => item.id !== card.id);
      await Promise.resolve(onCardsChange(normalizeMerchantBusinessCardChatDisplaySelection(nextCards)));
      if (previewAsset?.id === card.id) {
        setPreviewAsset(null);
        setPreviewOpen(false);
      }
      if (editingCardId === card.id) {
        setEditingCardId(null);
        setEditorOpen(false);
        draftRevisionRef.current += 1;
        setDraft(createDefaultMerchantBusinessCardDraft(profile));
      }
      setTip(hasPublicShare ? "名片已删除，二维码和联系卡链接已失效" : "名片已删除");
    } catch (error) {
      if (error instanceof Error && error.message === "share_delete_unauthorized") {
        setTip("登录状态失效，联系卡链接未删除，请重新登录后重试");
      } else if (error instanceof Error && error.message === "share_delete_timeout") {
        setTip("删除超时，二维码和联系卡链接暂未失效，请稍后重试");
      } else if (hasPublicShare) {
        setTip("删除失败，二维码和联系卡链接未失效，请重试");
      } else {
        setTip("删除失败，请重试");
      }
    } finally {
      setDeletingCardId((current) => (current === card.id ? null : current));
    }
  };

  const markCardAsChatDisplay = async (cardId: string) => {
    try {
      await Promise.resolve(onCardsChange(selectMerchantBusinessCardForChat(normalizedCards, cardId)));
      setTip("这张名片会在聊天模块中展示");
    } catch {
      setTip("聊天名片设置保存失败，请重试");
    }
  };

  const previewMode = previewAsset?.mode || draft.mode;
  const previewTargetUrl = normalizeText(previewAsset?.targetUrl) || websiteUrl;
  const previewCardName = previewAsset ? normalizeText(previewAsset.name) : normalizeText(draft.name);
  const previewName = previewCardName || "名片预览";
  const previewTitle = normalizeText(previewAsset?.title) || normalizeText(draft.title);
  const previewContacts = previewAsset?.contacts || draft.contacts;
  const previewContactFieldOrder = previewAsset?.contactFieldOrder || draft.contactFieldOrder;
  const previewContactDisplayFields = previewAsset?.contactDisplayFields || draft.contactDisplayFields;
  const previewContactSectionOrder = previewAsset?.contactPageSectionOrder || draft.contactPageSectionOrder;
  const previewShowContactSaveButton = previewAsset?.showContactSaveButton ?? draft.showContactSaveButton;
  const previewShowContactWebsiteButton = previewAsset?.showContactWebsiteButton ?? draft.showContactWebsiteButton;
  const previewCustomContactLinks = previewAsset?.customContactLinks || draft.customContactLinks;
  const previewContactImageUrl =
    normalizeText(previewAsset?.contactPagePublicImageUrl) ||
    normalizeText(previewAsset?.contactPageImageUrl) ||
    normalizeText(draft.contactPageImageUrl);
  const previewContactImageHeight = previewAsset?.contactPageImageHeight || draft.contactPageImageHeight;
  const previewContactImageLinkUrl =
    normalizeText(previewAsset?.contactPageImageLinkUrl) || normalizeText(draft.contactPageImageLinkUrl);
  const previewContactImageX = previewAsset?.contactPageImageX ?? draft.contactPageImageX;
  const previewContactImageY = previewAsset?.contactPageImageY ?? draft.contactPageImageY;
  const previewContactImageScale = previewAsset?.contactPageImageScale ?? draft.contactPageImageScale;
  const previewContactImageOpacity = previewAsset?.contactPageImageOpacity ?? draft.contactPageImageOpacity;
  const previewIntroVideoUrl = canUseIntroVideo
    ? normalizeText(previewAsset?.contactIntroVideoUrl) || normalizeText(draft.contactIntroVideoUrl)
    : "";
  const previewIntroVideoPosterUrl = canUseIntroVideo
    ? normalizeText(previewAsset?.contactIntroVideoPosterUrl) || normalizeText(draft.contactIntroVideoPosterUrl)
    : "";
  const showPreviewGenerateButton = !previewAsset;
  const backgroundImagePickerStatus = resolveFilePickerStatus(
    backgroundImageFileName,
    normalizeText(draft.backgroundImageUrl),
    "已上传背景图，可重新选择",
  );
  const backgroundImagePickerDetail = isBackgroundImageProcessing ? "压缩中..." : backgroundImageFileDetail;
  const canAddPhone = contactPhoneEditorValues.length < MERCHANT_BUSINESS_CARD_PHONE_LIMIT;
  const contactPageImagePickerStatus = resolveFilePickerStatus(
    contactPageImageFileName,
    normalizeText(draft.contactPageImageUrl),
    "已上传联系卡图片，可重新选择",
  );
  const contactPageImagePickerDetail = isContactPageImageProcessing ? "压缩中..." : contactPageImageFileDetail;
  const contactIntroVideoPickerStatus = resolveFilePickerStatus(
    contactIntroVideoFileName,
    normalizeText(draft.contactIntroVideoUrl),
    "已上传开场视频，可重新选择",
  );
  const contactIntroVideoPickerDetail = isContactIntroVideoProcessing ? "上传中..." : contactIntroVideoFileDetail;
  const folderGridContent =
    normalizedCards.length > 0 ? (
      <div className="space-y-4">
        <div className="rounded-2xl border bg-slate-50 px-4 py-3 text-sm text-slate-600">
          聊天展示名片：
          <span className="ml-1 font-medium text-slate-900">
            {selectedChatDisplayCard ? selectedChatDisplayCard.name : "暂无"}
          </span>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {normalizedCards.map((card) => (
            <article key={card.id} className="overflow-hidden rounded-2xl border bg-slate-50 shadow-sm">
              <div className="space-y-4 p-4">
                <button
                  type="button"
                  className={`block w-full overflow-hidden border bg-transparent text-left ${
                    card.cornerMode === "square" ? "rounded-none" : "rounded-2xl"
                  }`}
                  onClick={() => {
                    setPreviewAsset(card);
                    setPreviewOpen(true);
                  }}
                >
                  {/* 名片夹封面来自用户已生成内容，保留原始地址和比例比 next/image 更稳。 */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={card.imageUrl} alt={card.name} className="block h-auto w-full object-cover bg-transparent" />
                </button>
                <div>
                  <div className="flex items-center gap-2">
                    <div className="text-base font-semibold text-slate-900">{card.name}</div>
                    <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] text-white">
                      {getCardModeLabel(card.mode)}
                    </span>
                    {card.showInChat ? (
                      <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] text-white">
                        聊天展示中
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-slate-500">
                    {new Date(card.createdAt).toLocaleString("zh-CN", { hour12: false })}
                  </div>
                </div>
                {card.mode === "link" ? (
                  <div className="space-y-2">
                    {resolveCardShortLink(card) ? (
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                        <div className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2">
                          <div className="break-all text-xs text-slate-900">{resolveCardShortLink(card)}</div>
                        </div>
                        <button
                          type="button"
                          className="shrink-0 rounded bg-black px-3 py-2 text-sm text-white hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60"
                          onClick={() => void copyCardLink(card)}
                          disabled={copyingLinkCardId === card.id}
                        >
                          {copyingLinkCardId === card.id ? "生成链接中..." : "复制联系卡链接"}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="w-full rounded bg-black px-3 py-2 text-sm text-white hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60"
                        onClick={() => void copyCardLink(card)}
                        disabled={copyingLinkCardId === card.id}
                      >
                        {copyingLinkCardId === card.id ? "生成链接中..." : "生成联系卡链接"}
                      </button>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50"
                        onClick={() => {
                          setPreviewAsset(card);
                          setPreviewOpen(true);
                        }}
                      >
                        预览
                      </button>
                      <button
                        type="button"
                        className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => openDuplicateEditorForCard(card)}
                        disabled={!canCreate || cardLimitReached}
                      >
                        生成新名片
                      </button>
                      <button
                        type="button"
                        className="rounded bg-black px-3 py-2 text-sm text-white hover:bg-slate-800"
                        onClick={() => void copyCardImage(card)}
                      >
                        复制名片图片
                      </button>
                      <button
                        type="button"
                        className={`rounded border px-3 py-2 text-sm ${
                          card.showInChat ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "bg-white hover:bg-slate-50"
                        }`}
                        onClick={() => markCardAsChatDisplay(card.id)}
                      >
                        {card.showInChat ? "当前聊天展示" : "设为聊天展示"}
                      </button>
                      <button
                        type="button"
                        className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50"
                        onClick={() => openEditorForCard(card)}
                      >
                        修改
                      </button>
                      <button
                        type="button"
                        className="rounded border border-rose-200 bg-white px-3 py-2 text-sm text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => void deleteCard(card)}
                        disabled={deletingCardId === card.id}
                      >
                        {deletingCardId === card.id ? "删除中..." : "删除"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50"
                      onClick={() => {
                        setPreviewAsset(card);
                        setPreviewOpen(true);
                      }}
                    >
                      预览
                    </button>
                    <button
                      type="button"
                      className="rounded bg-black px-3 py-2 text-sm text-white hover:bg-slate-800"
                      onClick={() => void saveCard(card)}
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      className={`rounded border px-3 py-2 text-sm ${
                        card.showInChat ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "bg-white hover:bg-slate-50"
                      }`}
                      onClick={() => markCardAsChatDisplay(card.id)}
                    >
                      {card.showInChat ? "当前聊天展示" : "设为聊天展示"}
                    </button>
                    <button
                      type="button"
                      className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50"
                      onClick={() => openEditorForCard(card)}
                    >
                      修改
                    </button>
                    <button
                      type="button"
                      className="rounded border border-rose-200 bg-white px-3 py-2 text-sm text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => void deleteCard(card)}
                      disabled={deletingCardId === card.id}
                    >
                      {deletingCardId === card.id ? "删除中..." : "删除"}
                    </button>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
    ) : (
      <div className="flex min-h-[240px] items-center justify-center rounded-2xl border border-dashed bg-slate-50 px-6 text-center text-sm text-slate-500">
        还没有生成名片。请先在上方点击“生成名片”制作一张。
      </div>
    );
  const folderPageSurface = (
    <div className="flex min-h-[calc(100vh-14rem)] flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_12px_32px_rgba(15,23,42,0.05)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[26px] font-bold leading-8 text-slate-950">名片夹</div>
            <div className="text-sm font-medium text-slate-500">（{cardFolderCountLabel}）</div>
            <button
              type="button"
              className="rounded bg-black px-3 py-2 text-sm text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={openCreateEditorFromFolder}
              disabled={!canOpenCreateEditor}
            >
              生成名片
            </button>
          </div>
          <div className="text-sm text-slate-500">查看已生成的图片名片或链接名片，可预览并继续操作。</div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{folderGridContent}</div>
    </div>
  );

  return (
    <div className={isPageFolderView ? "space-y-4 py-6" : "space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4"}>
      {!isPageFolderView ? (
        <div className="flex">
          <button
            type="button"
            className="group inline-flex w-full max-w-[460px] items-center gap-4 rounded-2xl border-2 border-slate-800 bg-[linear-gradient(180deg,#ffffff_0%,#f3f4f6_100%)] px-4 py-3 text-left text-slate-900 shadow-[0_10px_24px_rgba(15,23,42,0.14)] transition hover:-translate-y-px hover:bg-[linear-gradient(180deg,#ffffff_0%,#e9edf3_100%)]"
            onClick={() => setFolderOpen(true)}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 72 56"
              className="h-12 w-16 shrink-0 text-slate-900 transition group-hover:scale-[1.03]"
              fill="none"
            >
              <rect x="18" y="5" width="38" height="24" rx="5" stroke="currentColor" strokeWidth="3" />
              <path d="M25 13h21" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              <path d="M25 20h16" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              <path d="M11 22h50a6 6 0 0 1 6 6v15a6 6 0 0 1-6 6H11a6 6 0 0 1-6-6V28a6 6 0 0 1 6-6Z" stroke="currentColor" strokeWidth="3" />
              <path d="M7 27 29 40a10 10 0 0 0 10 0l22-13" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2 leading-none">
                <span className="text-base font-semibold tracking-[0.02em]">名片夹</span>
                <span className="text-sm font-medium text-slate-500">{cardFolderCountLabel}</span>
              </span>
              <span className="mt-1.5 block text-xs leading-5 text-slate-500">
                完善商户信息后可生成名片。链接模式会生成联系卡链接，对方手机打开后可保存联系人。
              </span>
            </span>
          </button>
        </div>
      ) : null}
      {!canCreate ? <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">{`需先完善以下商户信息后才能生成名片：${missingFields.join(" / ")}`}</div> : null}
      {canCreate && cardLimitReached ? <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">{`名片夹已达到上限（${normalizedCardLimit} 张），请先删除旧名片，或到超级后台调整名片夹数量限制。`}</div> : null}
      {isPageFolderView ? folderPageSurface : null}
      <div className="pointer-events-none fixed left-[-20000px] top-0"><div ref={hiddenPreviewRef}><CardSurface draft={draft} websiteUrl={websiteUrl} qrCodeUrl={qrCodeUrl} scale={1} renderMode="export" /></div></div>

      {editorOpen ? overlay(
        <div
          className="fixed inset-0 z-[2147482900] bg-black/45 p-4"
          onMouseDown={() => {
            setEditorOpen(false);
            setEditingCardId(null);
          }}
        >
          <div className="mx-auto flex h-full max-h-[calc(100vh-2rem)] w-full max-w-[1600px] flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
              <div><div className="text-lg font-semibold text-slate-900">{editingCardId ? "修改名片" : "生成名片"}</div><div className="text-sm text-slate-500">先选择图片模式或链接模式，再调整样式后生成。</div></div>
              <div className="flex flex-wrap gap-2">
                {editingCardId ? (
                  <button
                    type="button"
                    className="min-w-[88px] rounded bg-black px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => void handleSaveDraft()}
                    disabled={isGenerating || isDraftSaving || isContactIntroVideoProcessing}
                  >
                    {isDraftSaving ? "保存中..." : "保存"}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="min-w-[88px] rounded border bg-white px-4 py-2 text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => void handleSaveDraft()}
                      disabled={isGenerating || isDraftSaving || isContactIntroVideoProcessing}
                    >
                      {isDraftSaving ? "保存中..." : "保存"}
                    </button>
                    <button
                      type="button"
                      className="min-w-[118px] rounded bg-black px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => void handleGenerate()}
                      disabled={!websiteUrl || !qrReadyForCurrentDraft || isGenerating || isDraftSaving || isContactIntroVideoProcessing}
                    >
                      {isGenerating ? "生成中..." : "生成"}
                    </button>
                  </>
                )}
                <button type="button" className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50" onClick={() => { setEditorOpen(false); setEditingCardId(null); }}>关闭</button>
              </div>
            </div>
            <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(520px,680px)]">
              <div className="min-h-0 overflow-y-auto px-4 py-4">
                <div className="grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                  <BusinessCardEditorSection title="基础设置" className="xl:col-span-2">
                    <div className="space-y-2">
                      <div className="text-xs text-slate-600">名片模式</div>
                      <div className="grid gap-2 md:grid-cols-2">
                        {CARD_MODE_OPTIONS.map((option) => {
                          const active = draft.mode === option.value;
                          const locked = option.value === "link" && !canUseDraftLinkMode;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              disabled={locked}
                              className={`rounded-xl border px-3 py-3 text-left transition ${
                                active
                                  ? "border-slate-900 bg-slate-900 text-white"
                                  : locked
                                    ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                                    : "border-slate-300 bg-white text-slate-900 hover:border-slate-400"
                              }`}
                              onClick={() => {
                                if (locked) return;
                                applyDraft((current) => ({ ...current, mode: option.value }));
                              }}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-sm font-semibold">{option.label}</div>
                                {locked ? (
                                  <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500">
                                    未开通
                                  </span>
                                ) : null}
                              </div>
                              <div className={`mt-1 text-xs ${active ? "text-slate-200" : locked ? "text-slate-400" : "text-slate-500"}`}>
                                {option.description}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="block text-xs text-slate-600">
                        <label className="block">
                          名片名称
                          <input className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm" value={draft.name} onFocus={() => setSingleSelectedField("merchantName")} onChange={(event) => applyDraft((current) => ({ ...current, name: event.target.value }))} />
                        </label>
                        <div className="mt-2">
                          <ContactDisplayCheckboxes
                            value={resolveContactDisplayTarget(draft.contactDisplayFields, "merchantName")}
                            onChange={(target, checked) => updateContactDisplayField("merchantName", target, checked)}
                          />
                        </div>
                      </div>
                      <label className="block text-xs text-slate-600">职位<input className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm" value={draft.title} onFocus={() => setSingleSelectedField("title")} onChange={(event) => applyDraft((current) => ({ ...current, title: event.target.value }))} /></label>
                    </div>
                    <div className="grid gap-3 md:grid-cols-4">
                      <label className="block text-xs text-slate-600">
                        名片框
                        <select
                          className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm"
                          value={draft.cornerMode === "square" ? "square" : "rounded"}
                          onChange={(event) =>
                            applyDraft((current) => ({
                              ...current,
                              cornerMode: event.target.value === "square" ? "square" : "rounded",
                            }))
                          }
                        >
                          <option value="rounded">圆角</option>
                          <option value="square">方角</option>
                        </select>
                      </label>
                      <label className="block text-xs text-slate-600">比例<select className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm" value={draft.ratioMode} onChange={(event) => applyDraft((current) => ({ ...current, ratioMode: event.target.value as MerchantBusinessCardDraft["ratioMode"], ...(() => resolveRatioDimensions(event.target.value as MerchantBusinessCardDraft["ratioMode"], current.width, current.height))() }))}>{MERCHANT_BUSINESS_CARD_RATIO_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}<option value="custom">自定义</option></select></label>
                      <label className="block text-xs text-slate-600">
                        名片框宽度
                        <input
                          type="number"
                          inputMode="numeric"
                          step={1}
                          min={MIN_CARD_FRAME_WIDTH}
                          max={MAX_CARD_FRAME_WIDTH}
                          className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm"
                          value={getNumberInputValue("card-width", draft.width)}
                          onChange={(event) =>
                            handleNumberInputChange("card-width", event.target.value, draft.width, MIN_CARD_FRAME_WIDTH, MAX_CARD_FRAME_WIDTH, (value) =>
                              handleSize(value, "width"),
                            )
                          }
                          onBlur={() => commitNumberInput("card-width", draft.width, MIN_CARD_FRAME_WIDTH, MAX_CARD_FRAME_WIDTH, (value) => handleSize(value, "width"))}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                          }}
                        />
                      </label>
                      <label className="block text-xs text-slate-600">
                        名片框高度
                        <input
                          type="number"
                          inputMode="numeric"
                          step={1}
                          min={MIN_CARD_FRAME_HEIGHT}
                          max={MAX_CARD_FRAME_HEIGHT}
                          className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm"
                          value={getNumberInputValue("card-height", draft.height)}
                          onChange={(event) =>
                            handleNumberInputChange("card-height", event.target.value, draft.height, MIN_CARD_FRAME_HEIGHT, MAX_CARD_FRAME_HEIGHT, (value) =>
                              handleSize(value, "height"),
                            )
                          }
                          onBlur={() => commitNumberInput("card-height", draft.height, MIN_CARD_FRAME_HEIGHT, MAX_CARD_FRAME_HEIGHT, (value) => handleSize(value, "height"))}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                          }}
                        />
                      </label>
                    </div>
                    <div className="space-y-3 rounded-xl border bg-white px-3 py-3">
                      <div className="text-xs font-semibold text-slate-700">背景图与背景色</div>
                      <div className="grid gap-3 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                        <div className="space-y-3">
                          <div>
                            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_76px]">
                              <ImageFilePicker
                                label="背景图"
                                statusText={backgroundImagePickerStatus}
                                detailText={backgroundImagePickerDetail}
                                disabled={isBackgroundImageProcessing}
                                onChange={(event) => void handleBackgroundUpload(event)}
                              />
                              <button
                                type="button"
                                className="self-end rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                onClick={handleClearBackgroundImage}
                                disabled={isBackgroundImageProcessing || !normalizeText(draft.backgroundImageUrl)}
                              >
                                清除
                              </button>
                            </div>
                            <div className="mt-1 text-[11px] text-slate-400">默认上限 {normalizedBackgroundImageLimitKb} KB，超过上限时会自动压缩到限制内。</div>
                          </div>
                          <label className="block text-xs text-slate-600">图片透明度<div className="mt-1 flex items-center gap-3 rounded border bg-white px-3 py-2"><input type="range" min="0" max="1" step="0.01" className="min-w-0 flex-1" value={draft.backgroundImageOpacity} onChange={(event) => applyDraft((current) => ({ ...current, backgroundImageOpacity: clamp(Number(event.target.value), 0, 1) }))} /><span className="w-12 shrink-0 text-right text-xs text-slate-500">{formatOpacityPercent(draft.backgroundImageOpacity)}</span></div></label>
                          {normalizeText(draft.backgroundImageUrl) ? (
                            <div className="block text-xs text-slate-600">
                              <div>图片缩放</div>
                              <div className="mt-1 flex items-center gap-3 rounded border bg-white px-3 py-2">
                                <input
                                  type="range"
                                  min={MIN_BACKGROUND_IMAGE_SCALE}
                                  max={MAX_BACKGROUND_IMAGE_SCALE}
                                  step="0.01"
                                  className="min-w-0 flex-1"
                                  value={normalizeBackgroundImageScale(draft.backgroundImageScale)}
                                  onChange={(event) =>
                                    applyDraft((current) => ({
                                      ...current,
                                      backgroundImageScale: normalizeBackgroundImageScale(Number(event.target.value)),
                                    }))
                                  }
                                />
                                <span className="w-12 shrink-0 text-right text-xs text-slate-500">{formatScalePercent(draft.backgroundImageScale)}</span>
                                <button
                                  type="button"
                                  className="shrink-0 rounded border bg-white px-2 py-1 text-[11px] hover:bg-slate-50"
                                  onClick={() =>
                                    applyDraft((current) => ({
                                      ...current,
                                      backgroundImageX: 0,
                                      backgroundImageY: 0,
                                      backgroundImageScale: 1,
                                    }))
                                  }
                                >
                                  重置
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <div className="text-xs text-slate-600">背景色板</div>
                            <ColorOrGradientPicker value={draft.backgroundColor} onChange={(value) => applyDraft((current) => ({ ...current, backgroundColor: value }))} />
                          </div>
                          <div className="space-y-1">
                            <div className="text-xs text-slate-600">常用色板</div>
                            <ColorSwatchPalette colors={[...CARD_BACKGROUND_COLOR_PRESETS]} selectedValue={draft.backgroundColor} onPick={(value) => applyDraft((current) => ({ ...current, backgroundColor: value }))} />
                          </div>
                          <label className="block text-xs text-slate-600">背景色透明度<div className="mt-1 flex items-center gap-3 rounded border bg-white px-3 py-2"><input type="range" min="0" max="1" step="0.01" className="min-w-0 flex-1" value={draft.backgroundColorOpacity} onChange={(event) => applyDraft((current) => ({ ...current, backgroundColorOpacity: clamp(Number(event.target.value), 0, 1) }))} /><span className="w-12 shrink-0 text-right text-xs text-slate-500">{formatOpacityPercent(draft.backgroundColorOpacity)}</span></div></label>
                        </div>
                      </div>
                    </div>
                    {draft.mode === "link" ? (
                      canUseIntroVideo ? (
                      <div className="rounded-xl border bg-white px-3 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="text-xs font-semibold text-slate-700">联系卡开场视频</div>
                          <label className="flex items-center gap-2 text-xs text-slate-700">
                            <input
                              type="checkbox"
                              checked={draft.contactIntroVideoMuted}
                              onChange={(event) =>
                                applyDraft((current) => ({
                                  ...current,
                                  contactIntroVideoMuted: event.target.checked,
                                }))
                              }
                            />
                            <span>静音播放</span>
                          </label>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_120px]">
                          <ImageFilePicker
                            label="上传视频"
                            statusText={contactIntroVideoPickerStatus}
                            detailText={contactIntroVideoPickerDetail}
                            accept={CONTACT_INTRO_VIDEO_ACCEPT}
                            disabled={isContactIntroVideoProcessing}
                            onChange={(event) => void handleContactIntroVideoUpload(event)}
                          />
                          <button
                            type="button"
                            className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                            onClick={handleClearContactIntroVideo}
                            disabled={isContactIntroVideoProcessing || !normalizeText(draft.contactIntroVideoUrl)}
                        >
                          清除
                        </button>
                      </div>
                        <div className="mt-1 text-[11px] text-slate-400">
                          原文件上限 {Math.round(CONTACT_INTRO_VIDEO_SOURCE_LIMIT_BYTES / 1024 / 1024)} MB，上传后会自动压缩转换为适合网页快速播放的 MP4，成品上限 {normalizedIntroVideoLimitMb} MB。
                        </div>
                        {normalizeText(draft.contactIntroVideoUrl) ? (
                          <AutoPlayingVideoPreview
                            className="mt-3 block aspect-video w-full rounded-xl border bg-black object-contain"
                            src={draft.contactIntroVideoUrl}
                            poster={normalizeText(draft.contactIntroVideoPosterUrl) || undefined}
                            muted={draft.contactIntroVideoMuted}
                            autoPlay={false}
                          />
                        ) : null}
                      </div>
                      ) : (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-800">
                          当前账号未开启联系卡开场视频权限，超级后台开启后可上传开场视频。
                        </div>
                      )
                    ) : null}
                    {draft.mode === "link" ? (
                      <div className="rounded-xl border bg-white px-3 py-3">
                        <div className="text-xs font-semibold text-slate-700">联系卡中间展示图</div>
                        <div className="mt-1 text-xs leading-5 text-slate-500">这里可以单独上传一张图片给收到名片的人看。不上传时，联系卡页面会默认展示姓名、电话、邮箱这些名片信息。右侧名片预览下方会同步显示联系卡图片预览。</div>
                        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_120px_140px]">
                          <ImageFilePicker
                            label="上传图片"
                            statusText={contactPageImagePickerStatus}
                            detailText={contactPageImagePickerDetail}
                            disabled={isContactPageImageProcessing}
                            onChange={(event) => void handleContactPageImageUpload(event)}
                          />
                          <button
                            type="button"
                            className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                            onClick={() => {
                              setContactPageImageFileName("");
                              setContactPageImageFileDetail("");
                              setIsContactPageImageProcessing(false);
                              applyDraft((current) => ({
                                ...current,
                                contactPageImageUrl: "",
                                contactPageImageLinkUrl: "",
                                contactPageImageX: 0,
                                contactPageImageY: 0,
                                contactPageImageScale: 1,
                                contactPageImageOpacity: 1,
                              }));
                            }}
                            disabled={!normalizeText(draft.contactPageImageUrl)}
                          >
                            恢复默认
                          </button>
                          <label className="block text-xs text-slate-600">
                            图片高度
                            <input
                              type="number"
                              inputMode="numeric"
                              step={1}
                              min={120}
                              max={1200}
                              className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm"
                              value={getNumberInputValue("contact-page-image-height", draft.contactPageImageHeight)}
                              onChange={(event) =>
                                handleNumberInputChange(
                                  "contact-page-image-height",
                                  event.target.value,
                                  draft.contactPageImageHeight,
                                  120,
                                  1200,
                                  (value) => applyDraft((current) => ({ ...current, contactPageImageHeight: value })),
                                )
                              }
                              onBlur={() =>
                                commitNumberInput(
                                  "contact-page-image-height",
                                  draft.contactPageImageHeight,
                                  120,
                                  1200,
                                  (value) => applyDraft((current) => ({ ...current, contactPageImageHeight: value })),
                                )
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") event.currentTarget.blur();
                              }}
                            />
                          </label>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                          <label className="block text-xs text-slate-600">
                            点击图片跳转链接
                            <input
                              className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm"
                              value={draft.contactPageImageLinkUrl}
                              placeholder="https://..."
                              onBlur={(event) => {
                                const normalizedUrl = normalizeMerchantBusinessCardShareTargetUrl(event.target.value);
                                if (normalizedUrl && normalizedUrl !== event.target.value) {
                                  applyDraft((current) => ({
                                    ...current,
                                    contactPageImageLinkUrl: normalizedUrl,
                                  }));
                                }
                              }}
                              onChange={(event) =>
                                applyDraft((current) => ({
                                  ...current,
                                  contactPageImageLinkUrl: event.target.value,
                                }))
                              }
                            />
                          </label>
                          <label className="block text-xs text-slate-600">
                            图片透明度
                            <div className="mt-1 flex items-center gap-3 rounded border bg-white px-3 py-2">
                              <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.01"
                                className="min-w-0 flex-1"
                                value={draft.contactPageImageOpacity}
                                onChange={(event) =>
                                  applyDraft((current) => ({
                                    ...current,
                                    contactPageImageOpacity: clamp(Number(event.target.value), 0, 1),
                                  }))
                                }
                              />
                              <span className="w-12 shrink-0 text-right text-xs text-slate-500">
                                {formatOpacityPercent(draft.contactPageImageOpacity)}
                              </span>
                            </div>
                          </label>
                        </div>
                        {normalizeText(draft.contactPageImageUrl) ? (
                          <div className="mt-3 flex flex-wrap items-center gap-3">
                            <label className="min-w-[260px] flex-1 text-xs text-slate-600">
                              图片缩放
                              <div className="mt-1 flex items-center gap-3 rounded border bg-white px-3 py-2">
                                <input
                                  type="range"
                                  min={MIN_BACKGROUND_IMAGE_SCALE}
                                  max={MAX_BACKGROUND_IMAGE_SCALE}
                                  step="0.01"
                                  className="min-w-0 flex-1"
                                  value={normalizeBackgroundImageScale(draft.contactPageImageScale)}
                                  onChange={(event) =>
                                    applyDraft((current) => ({
                                      ...current,
                                      contactPageImageScale: normalizeBackgroundImageScale(Number(event.target.value)),
                                    }))
                                  }
                                />
                                <span className="w-12 shrink-0 text-right text-xs text-slate-500">
                                  {formatScalePercent(draft.contactPageImageScale)}
                                </span>
                              </div>
                            </label>
                            <button
                              type="button"
                              className="self-end rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50"
                              onClick={() =>
                                applyDraft((current) => ({
                                  ...current,
                                  contactPageImageX: 0,
                                  contactPageImageY: 0,
                                  contactPageImageScale: 1,
                                  contactPageImageOpacity: 1,
                                }))
                              }
                            >
                              重置图片位置
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {draft.mode === "link" ? (
                      <div className="rounded-xl border bg-white px-3 py-3">
                        <div className="text-xs font-semibold text-slate-700">联系卡展示设置</div>
                        <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                          <div>
                            <div className="mb-2 text-xs text-slate-500">联系卡内容顺序</div>
                            <div className="space-y-2">
                              {normalizeMerchantBusinessCardContactSectionOrder(draft.contactPageSectionOrder).map((key, index, order) => (
                                <div key={key} className="flex items-center gap-2 rounded-xl border bg-slate-50 px-3 py-2 text-xs text-slate-700">
                                  <div className="min-w-0 flex-1 font-medium">{CONTACT_CARD_SECTION_LABELS[key]}</div>
                                  <MoveIconButton
                                    direction="up"
                                    onClick={() => moveContactPageSection(key, "up")}
                                    disabled={index === 0}
                                    className="h-7 w-7"
                                  />
                                  <MoveIconButton
                                    direction="down"
                                    onClick={() => moveContactPageSection(key, "down")}
                                    disabled={index === order.length - 1}
                                    className="h-7 w-7"
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                          <div>
                            <div className="mb-2 text-xs text-slate-500">底部按钮</div>
                            <div className="space-y-2">
                              <label className="flex items-center gap-2 rounded-xl border bg-slate-50 px-3 py-2 text-xs text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={draft.showContactSaveButton}
                                  onChange={(event) =>
                                    applyDraft((current) => ({
                                      ...current,
                                      showContactSaveButton: event.target.checked,
                                    }))
                                  }
                                />
                                显示保存通讯录
                              </label>
                              <label className="flex items-center gap-2 rounded-xl border bg-slate-50 px-3 py-2 text-xs text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={draft.showContactWebsiteButton}
                                  onChange={(event) =>
                                    applyDraft((current) => ({
                                      ...current,
                                      showContactWebsiteButton: event.target.checked,
                                    }))
                                  }
                                />
                                显示进入官网
                              </label>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                    <div className="rounded-xl border bg-white px-3 py-3">
                      <div className="text-xs font-semibold text-slate-700">网址与二维码</div>
                      <div className="mt-1 text-xs leading-5 text-slate-500">网站说明、网址显示和二维码都在右侧实时预览中查看，这里只保留设置，不再重复预览。</div>
                      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
                        <div className="space-y-3">
                          <label className="block text-xs text-slate-600">网站说明<input className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm" value={draft.websiteLabel} placeholder="扫码进入网站" onFocus={() => setSingleSelectedField("website")} onChange={(event) => applyDraft((current) => ({ ...current, websiteLabel: event.target.value }))} /></label>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <label className="flex items-center gap-2 rounded border bg-slate-50 px-3 py-2 text-xs text-slate-700"><input type="checkbox" checked={draft.showWebsiteUrl} onChange={(event) => applyDraft((current) => ({ ...current, showWebsiteUrl: event.target.checked }))} />显示域名</label>
                            <label className="flex items-center gap-2 rounded border bg-slate-50 px-3 py-2 text-xs text-slate-700"><input type="checkbox" checked={draft.showQr} onChange={(event) => applyDraft((current) => ({ ...current, showQr: event.target.checked }))} />显示二维码</label>
                          </div>
                          <div className="rounded border bg-slate-50 px-3 py-2 text-xs text-slate-500 break-all">{`当前网址：${websiteUrl || "请先填写域名前缀"}`}</div>
                        </div>
                        <div className="space-y-3">
                          <div className="grid gap-3 sm:grid-cols-3">
                            {(["x", "y", "size"] as const).map((key) => (
                              <label key={key} className="block text-xs text-slate-600">
                                {key === "size" ? "大小" : key.toUpperCase()}
                                <input
                                  type="number"
                                  inputMode="numeric"
                                  step={1}
                                  min={key === "size" ? 48 : 0}
                                  max={key === "size" ? 600 : 2000}
                                  className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm"
                                  value={getNumberInputValue(`qr-${key}`, draft.qr[key])}
                                  onChange={(event) =>
                                    handleNumberInputChange(
                                      `qr-${key}`,
                                      event.target.value,
                                      draft.qr[key],
                                      key === "size" ? 48 : 0,
                                      key === "size" ? 600 : 2000,
                                      (value) => applyDraft((current) => ({ ...current, qr: { ...current.qr, [key]: value } })),
                                    )
                                  }
                                  onBlur={() =>
                                    commitNumberInput(`qr-${key}`, draft.qr[key], key === "size" ? 48 : 0, key === "size" ? 600 : 2000, (value) =>
                                      applyDraft((current) => ({ ...current, qr: { ...current.qr, [key]: value } })),
                                    )
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") event.currentTarget.blur();
                                  }}
                                />
                              </label>
                            ))}
                          </div>
                          <div className={`rounded border px-3 py-2 text-xs ${draft.showQr && qrMayBeUnreadable ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
                            {draft.showQr
                              ? qrMayBeUnreadable
                                ? `当前二维码尺寸偏小，可能无法识别，建议至少保持在 ${QR_MIN_READABLE_SIZE}px。`
                                : "二维码只在右侧实时预览里显示，左侧不再重复占位置。"
                              : "已隐藏二维码；生成和预览都会同步隐藏。"}
                          </div>
                        </div>
                      </div>
                    </div>
                  </BusinessCardEditorSection>
                  <BusinessCardEditorSection title="联系方式" className="xl:col-span-2">
                    <div className="space-y-2">
                      {orderedContactFields.map(({ key, label }, index) => {
                        const canMoveUp = index > 0;
                        const canMoveDown = index < orderedContactFields.length - 1;
                        return (
                          <div key={key} className="rounded-xl border bg-white px-3 py-2.5 text-xs text-slate-600">
                            {key === "phone" ? (
                              <div className="space-y-1.5">
                                {contactPhoneEditorValues.map((phone, phoneIndex) => (
                                  <div
                                    key={`phone-${phoneIndex}`}
                                    className="flex flex-col gap-2 md:grid md:grid-cols-[140px_minmax(0,1fr)_auto_auto_auto_auto_auto] md:items-center"
                                  >
                                    <ContactFieldEditorLabel
                                      fieldKey="phone"
                                      label={
                                        phoneIndex === 0
                                          ? `电话（最多 ${MERCHANT_BUSINESS_CARD_PHONE_LIMIT} 个）`
                                          : phoneIndex === 1
                                            ? "工作电话"
                                            : `电话${phoneIndex + 1}`
                                      }
                                    />
                                    <input
                                      className="min-w-0 rounded border bg-white px-3 py-2 text-sm"
                                      value={phone}
                                      onFocus={() => setSingleSelectedField("phone")}
                                      onChange={(event) => {
                                        const next = [...contactPhoneEditorValues];
                                        next[phoneIndex] = event.target.value;
                                        updateDraftPhones(next);
                                      }}
                                      placeholder={`请输入电话${contactPhoneEditorValues.length > 1 ? phoneIndex + 1 : ""}`}
                                    />
                                    {phoneIndex === 0 ? (
                                      <button
                                        type="button"
                                        className="rounded border bg-white px-2 py-1 text-[11px] whitespace-nowrap hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                        onClick={() => updateDraftPhones([...contactPhoneEditorValues, ""])}
                                        disabled={!canAddPhone}
                                      >
                                        增加
                                      </button>
                                    ) : (
                                      <div className="hidden md:block" />
                                    )}
                                    {phoneIndex === 0 ? (
                                      <MoveIconButton
                                        direction="up"
                                        onClick={() => moveContactField(key, "up")}
                                        disabled={!canMoveUp}
                                      />
                                    ) : (
                                      <div className="hidden md:block" />
                                    )}
                                    {phoneIndex === 0 ? (
                                      <MoveIconButton
                                        direction="down"
                                        onClick={() => moveContactField(key, "down")}
                                        disabled={!canMoveDown}
                                      />
                                    ) : (
                                      <div className="hidden md:block" />
                                    )}
                                    {phoneIndex === 0 ? (
                                      <ContactDisplayCheckboxes
                                        value={resolveContactDisplayTarget(draft.contactDisplayFields, key)}
                                        onChange={(target, checked) => updateContactDisplayField(key, target, checked)}
                                      />
                                    ) : (
                                      <div className="hidden md:block" />
                                    )}
                                    <button
                                      type="button"
                                      className="rounded border bg-white px-2 py-1 text-[11px] whitespace-nowrap hover:bg-slate-50 disabled:opacity-50"
                                      onClick={() => {
                                        const next = contactPhoneEditorValues.filter((_, removeIndex) => removeIndex !== phoneIndex);
                                        updateDraftPhones(next.length > 0 ? next : [""]);
                                      }}
                                      disabled={contactPhoneEditorValues.length <= 1}
                                    >
                                      删除
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="flex flex-col gap-2 md:grid md:grid-cols-[88px_minmax(0,1fr)_auto_auto_auto] md:items-center">
                                <ContactFieldEditorLabel fieldKey={key} label={label} />
                                <input
                                  className="min-w-0 rounded border bg-white px-3 py-2 text-sm"
                                  value={draft.contacts[key]}
                                  onFocus={() => setSingleSelectedField(key)}
                                  onChange={(event) =>
                                    applyDraft((current) => ({ ...current, contacts: { ...current.contacts, [key]: event.target.value } }))
                                  }
                                  placeholder={key === "googleReview" ? "请输入Google评价链接" : `请输入${label}`}
                                />
                                <MoveIconButton
                                  direction="up"
                                  onClick={() => moveContactField(key, "up")}
                                  disabled={!canMoveUp}
                                />
                                <MoveIconButton
                                  direction="down"
                                  onClick={() => moveContactField(key, "down")}
                                  disabled={!canMoveDown}
                                />
                                <ContactDisplayCheckboxes
                                  value={resolveContactDisplayTarget(draft.contactDisplayFields, key)}
                                  onChange={(target, checked) => updateContactDisplayField(key, target, checked)}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-4 rounded-xl border bg-white px-3 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-semibold text-slate-700">自定义联系方式</div>
                          <div className="mt-1 text-[11px] text-slate-500">可填写跳转链接和显示内容，适合评价链接、菜单链接或第三方页面。</div>
                        </div>
                        <button type="button" className="rounded border bg-white px-3 py-2 text-xs hover:bg-slate-50" onClick={addCustomContactLink}>
                          新增自定义项
                        </button>
                      </div>
                      {draft.customContactLinks.length > 0 ? (
                        <div className="mt-3 space-y-3">
                          {draft.customContactLinks.map((item, index) => (
                            <div key={item.id} className="rounded-xl border bg-slate-50 p-3">
                              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                <div className="text-xs font-medium text-slate-700">{normalizeText(item.label) || `自定义${index + 1}`}</div>
                                <button
                                  type="button"
                                  className="rounded border border-rose-200 bg-white px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
                                  onClick={() => removeCustomContactLink(item.id)}
                                >
                                  删除
                                </button>
                              </div>
                              <div className="grid gap-3 md:grid-cols-2">
                                <label className="block text-xs text-slate-600">
                                  标签
                                  <input
                                    className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm"
                                    value={item.label}
                                    onChange={(event) => updateCustomContactLink(item.id, (current) => ({ ...current, label: event.target.value }))}
                                    placeholder="例如 Google"
                                  />
                                </label>
                                <label className="block text-xs text-slate-600">
                                  显示内容
                                  <input
                                    className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm"
                                    value={item.displayText}
                                    onChange={(event) =>
                                      updateCustomContactLink(item.id, (current) => ({ ...current, displayText: event.target.value }))
                                    }
                                    placeholder="例如 欢迎评价"
                                  />
                                </label>
                                <label className="block text-xs text-slate-600 md:col-span-2">
                                  跳转链接
                                  <input
                                    className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm"
                                    value={item.url}
                                    onChange={(event) => updateCustomContactLink(item.id, (current) => ({ ...current, url: event.target.value }))}
                                    placeholder="https://..."
                                  />
                                </label>
                                <label className="block text-xs text-slate-600">
                                  预设图标
                                  <select
                                    className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm"
                                    value={item.iconPreset}
                                    onChange={(event) =>
                                      updateCustomContactLink(item.id, (current) => ({
                                        ...current,
                                        iconPreset: event.target.value,
                                      }))
                                    }
                                  >
                                    {MERCHANT_BUSINESS_CARD_CUSTOM_CONTACT_ICON_PRESETS.map((preset) => (
                                      <option key={preset} value={preset}>
                                        {CUSTOM_CONTACT_ICON_PRESET_LABELS[preset]}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="block text-xs text-slate-600">
                                  按钮底色
                                  <div className="mt-1 flex items-center gap-2 rounded border bg-white px-3 py-2">
                                    <input
                                      type="color"
                                      className="h-8 w-10 shrink-0 border-0 bg-transparent p-0"
                                      value={/^#[0-9a-f]{6}$/i.test(item.bgColor) ? item.bgColor : "#0f172a"}
                                      onChange={(event) => updateCustomContactLink(item.id, (current) => ({ ...current, bgColor: event.target.value }))}
                                    />
                                    <input
                                      className="min-w-0 flex-1 text-sm outline-none"
                                      value={item.bgColor}
                                      onChange={(event) => updateCustomContactLink(item.id, (current) => ({ ...current, bgColor: event.target.value }))}
                                      placeholder="#0f172a"
                                    />
                                  </div>
                                </label>
                              </div>
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <div
                                  className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white"
                                  style={{ backgroundColor: normalizeText(item.bgColor) || "#0f172a" }}
                                >
                                  {normalizeText(item.iconUrl) ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={item.iconUrl} alt="" className="h-5 w-5 object-contain" />
                                  ) : (
                                    CUSTOM_CONTACT_ICON_PRESET_SYMBOLS[
                                      (MERCHANT_BUSINESS_CARD_CUSTOM_CONTACT_ICON_PRESETS as readonly string[]).includes(item.iconPreset)
                                        ? (item.iconPreset as (typeof MERCHANT_BUSINESS_CARD_CUSTOM_CONTACT_ICON_PRESETS)[number])
                                        : "link"
                                    ]
                                  )}
                                </div>
                                <label className="rounded border bg-white px-3 py-2 text-xs hover:bg-slate-50">
                                  上传图标
                                  <input type="file" accept="image/*" className="hidden" onChange={(event) => void handleCustomContactIconUpload(item.id, event)} />
                                </label>
                                <button
                                  type="button"
                                  className="rounded border bg-white px-3 py-2 text-xs hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                  onClick={() => updateCustomContactLink(item.id, (current) => ({ ...current, iconUrl: "" }))}
                                  disabled={!normalizeText(item.iconUrl)}
                                >
                                  使用预设
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-3 rounded border border-dashed bg-slate-50 px-3 py-4 text-xs text-slate-500">
                          还没有自定义联系方式。
                        </div>
                      )}
                    </div>
                  </BusinessCardEditorSection>
                  <BusinessCardEditorSection title="开票信息" className="xl:col-span-2">
                    <div className="text-[11px] text-slate-500">联系卡中会显示复制按钮，方便客户直接复制。</div>
                    <div className="space-y-2">
                      {INVOICE_FIELDS.map(({ key, label, placeholder }) => (
                        <div
                          key={key}
                          className="flex flex-col gap-2 rounded-xl border bg-white px-3 py-2.5 text-xs text-slate-600 md:grid md:grid-cols-[88px_minmax(0,1fr)] md:items-center"
                        >
                          <div className="text-xs font-medium text-slate-700">{label}</div>
                          <input
                            className="min-w-0 rounded border bg-white px-3 py-2 text-sm"
                            value={draft.invoice[key]}
                            onChange={(event) =>
                              applyDraft((current) => ({
                                ...current,
                                invoice: {
                                  ...current.invoice,
                                  [key]: event.target.value,
                                },
                              }))
                            }
                            placeholder={placeholder}
                          />
                        </div>
                      ))}
                    </div>
                  </BusinessCardEditorSection>
                  <BusinessCardEditorSection title="自定义文本" className="xl:col-span-2">
                    <div className="flex flex-wrap items-center justify-end gap-3">
                      <button type="button" className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50" onClick={addCustomText}>新增文本</button>
                    </div>
                    {draft.customTexts.length > 0 ? (
                      <div className="space-y-3">
                        {draft.customTexts.map((item, index) => (
                          <div
                            key={item.id}
                            className={`rounded-xl border p-3 ${
                              selectedFieldKeys.includes(getCustomTextSelectionKey(item.id))
                                ? "border-sky-200 bg-sky-50 ring-2 ring-sky-100"
                                : "bg-white"
                            }`}
                            onClick={(event) => handleSelectedFieldClick(getCustomTextSelectionKey(item.id), event)}
                          >
                            <div className="mb-2 flex items-center justify-between gap-3">
                              <div className="text-xs font-medium text-slate-700">{getCustomTextLabel(item.text, index)}</div>
                              <button
                                type="button"
                                className="rounded border border-rose-200 bg-white px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  removeCustomText(item.id);
                                }}
                              >
                                删除
                              </button>
                            </div>
                            <input
                              className="w-full rounded border bg-white px-3 py-2 text-sm"
                              value={item.text}
                              placeholder={`请输入自定义文本 ${index + 1}`}
                              onFocus={() => setSingleSelectedField(getCustomTextSelectionKey(item.id))}
                              onChange={(event) =>
                                updateCustomText(item.id, (current) => ({ ...current, text: event.target.value }))
                              }
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded border border-dashed bg-white px-3 py-4 text-xs text-slate-500">还没有自定义文本，点击“新增文本”即可添加。</div>
                    )}
                  </BusinessCardEditorSection>
                  <BusinessCardEditorSection title="位置与字体样式" className="xl:col-span-2">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                        <div className="text-xs text-slate-500">{`当前选中：${selectedFieldSummary}`}</div>
                        <div className="text-[11px] text-slate-400">按住 Ctrl 再点击字段，可多选后一起修改字体样式。</div>
                      </div>
                      <button type="button" className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50" onClick={() => setFontStyleEditorOpen((current) => !current)}>字体样式</button>
                    </div>
                    {fontStyleEditorOpen ? (
                      <div className="space-y-3 rounded-xl border bg-white p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="text-sm font-medium text-slate-900">
                            {applyUnifiedTypography ? "统一设置" : selectedFieldSummary}
                          </div>
                          <label className="flex items-center gap-2 text-xs text-slate-600">
                            <input
                              type="checkbox"
                              checked={applyUnifiedTypography}
                              onChange={(event) => setApplyUnifiedTypography(event.target.checked)}
                            />
                            统一设置
                          </label>
                        </div>
                        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,220px)]">
                          <label className="block text-xs text-slate-600">字体<select className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm" value={selectedTypography.fontFamily || ""} onChange={(event) => updateTypography({ fontFamily: event.target.value })}>{FONT_FAMILY_OPTIONS.map((option) => <option key={option.label} value={option.value}>{option.label}</option>)}</select></label>
                          <label className="block text-xs text-slate-600">
                            字号
                            <div className="mt-1 grid gap-2 md:grid-cols-[minmax(0,1fr)_96px]">
                              <input
                                type="number"
                                inputMode="numeric"
                                min={MIN_TYPOGRAPHY_FONT_SIZE}
                                max={MAX_TYPOGRAPHY_FONT_SIZE}
                                step={1}
                                className="w-full rounded border bg-white px-3 py-2 text-sm"
                                value={selectedTypographyFontSizeInput}
                                onChange={(event) =>
                                  setNumberInputDrafts((current) => ({
                                    ...current,
                                    [TYPOGRAPHY_FONT_SIZE_INPUT_KEY]: event.target.value,
                                  }))
                                }
                                onBlur={() =>
                                  commitNumberInput(
                                    TYPOGRAPHY_FONT_SIZE_INPUT_KEY,
                                    selectedTypographyFontSize,
                                    MIN_TYPOGRAPHY_FONT_SIZE,
                                    MAX_TYPOGRAPHY_FONT_SIZE,
                                    (value) => updateTypography({ fontSize: value }),
                                  )
                                }
                                onKeyDown={(event) => {
                                  if (event.key !== "Enter") return;
                                  event.preventDefault();
                                  event.currentTarget.blur();
                                }}
                              />
                              <select
                                className="w-full rounded border bg-white px-3 py-2 text-sm"
                                value={selectedTypographyFontSizeOptionValue}
                                onChange={(event) => {
                                  const nextSize = Number(event.target.value);
                                  if (!Number.isFinite(nextSize)) return;
                                  clearNumberInputDraft(TYPOGRAPHY_FONT_SIZE_INPUT_KEY);
                                  updateTypography({ fontSize: normalizeTypographyFontSize(nextSize) });
                                }}
                              >
                                <option value="">常用值</option>
                                {FONT_SIZE_OPTIONS.map((size) => (
                                  <option key={size} value={size}>
                                    {size}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="mt-1 text-[11px] text-slate-400">可直接输入，范围 10 到 80。</div>
                          </label>
                        </div>
                        <div className="grid gap-3 md:grid-cols-[120px_repeat(3,minmax(0,1fr))]">
                          <label className="block text-xs text-slate-600">颜色<input type="color" className="mt-1 h-[42px] w-full rounded border bg-white px-2 py-1" value={selectedTypography.fontColor || "#0f172a"} onChange={(event) => updateTypography({ fontColor: event.target.value })} /></label>
                          <label className="flex items-center gap-2 rounded border bg-slate-50 px-3 py-2 text-xs text-slate-700"><input type="checkbox" checked={normalizeText(selectedTypography.fontWeight) === "bold"} onChange={(event) => updateTypography({ fontWeight: event.target.checked ? "bold" : "normal" })} />加粗</label>
                          <label className="flex items-center gap-2 rounded border bg-slate-50 px-3 py-2 text-xs text-slate-700"><input type="checkbox" checked={normalizeText(selectedTypography.fontStyle) === "italic"} onChange={(event) => updateTypography({ fontStyle: event.target.checked ? "italic" : "normal" })} />斜体</label>
                          <label className="flex items-center gap-2 rounded border bg-slate-50 px-3 py-2 text-xs text-slate-700"><input type="checkbox" checked={normalizeText(selectedTypography.textDecoration) === "underline"} onChange={(event) => updateTypography({ textDecoration: event.target.checked ? "underline" : "none" })} />下划线</label>
                        </div>
                      </div>
                    ) : null}
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {positionEditorItems.map((item) => {
                        const isSelected = selectedFieldKeys.includes(item.id);
                        const isCurrent = primarySelectedFieldKey === item.id;
                        const currentPosition =
                          item.kind === "field"
                            ? draft.textLayout[item.id as MerchantBusinessCardFieldKey]
                            : draft.customTexts.find((custom) => custom.id === item.customTextId);
                        if (!currentPosition) return null;
                        return (
                          <div
                            key={item.id}
                            className={`rounded-xl border p-3 transition ${
                              isCurrent
                                ? "border-sky-200 bg-sky-50 ring-2 ring-sky-100"
                                : isSelected
                                  ? "border-sky-200 bg-sky-50 ring-2 ring-sky-100"
                                  : "bg-white hover:border-slate-300"
                            }`}
                            onClick={(event) => handleSelectedFieldClick(item.id, event)}
                          >
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <div className="text-xs font-medium text-slate-700">{item.label}</div>
                              {isCurrent ? <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] text-sky-700">当前</span> : isSelected ? <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] text-sky-700">已选</span> : null}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              {(["x", "y"] as const).map((axis) => (
                                <label key={axis} className="flex items-center gap-2 text-xs text-slate-600">
                                  <span className="w-3 shrink-0 text-center">{axis.toUpperCase()}</span>
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    step={1}
                                    min={0}
                                    max={2000}
                                    className="min-w-0 flex-1 rounded border bg-white px-2 py-2 text-sm"
                                    value={getNumberInputValue(`layout-${item.id}-${axis}`, currentPosition[axis])}
                                    onFocus={() => setSingleSelectedField(item.id)}
                                    onChange={(event) =>
                                      handleNumberInputChange(
                                        `layout-${item.id}-${axis}`,
                                        event.target.value,
                                        currentPosition[axis],
                                        0,
                                        2000,
                                        (value) =>
                                          item.kind === "field"
                                            ? applyDraft((current) => ({
                                                ...current,
                                                textLayout: {
                                                  ...current.textLayout,
                                                  [item.id]: {
                                                    ...current.textLayout[item.id as MerchantBusinessCardFieldKey],
                                                    [axis]: value,
                                                  },
                                                },
                                              }))
                                            : updateCustomText(item.customTextId, (current) => ({
                                                ...current,
                                                [axis]: value,
                                              })),
                                      )
                                    }
                                    onBlur={() =>
                                      commitNumberInput(
                                        `layout-${item.id}-${axis}`,
                                        currentPosition[axis],
                                        0,
                                        2000,
                                        (value) =>
                                          item.kind === "field"
                                            ? applyDraft((current) => ({
                                                ...current,
                                                textLayout: {
                                                  ...current.textLayout,
                                                  [item.id]: {
                                                    ...current.textLayout[item.id as MerchantBusinessCardFieldKey],
                                                    [axis]: value,
                                                  },
                                                },
                                              }))
                                            : updateCustomText(item.customTextId, (current) => ({
                                                ...current,
                                                [axis]: value,
                                              })),
                                      )
                                    }
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") event.currentTarget.blur();
                                    }}
                                  />
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </BusinessCardEditorSection>
                </div>
              </div>
              <aside className="min-h-0 overflow-y-auto border-l bg-slate-50 px-4 py-4">
                <div className="sticky top-0 space-y-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">实时预览</div>
                  </div>
                  <div className="overflow-hidden rounded-2xl border bg-slate-900/5 p-3">
                    <div className="flex justify-center">
                      <CardSurface
                        draft={draft}
                        websiteUrl={websiteUrl}
                        qrCodeUrl={qrCodeUrl}
                        scale={scale}
                        onBackgroundPointerDown={handleBackgroundPointerDown}
                        onBackgroundPointerMove={handleBackgroundPointerMove}
                        onBackgroundPointerEnd={handleBackgroundPointerEnd}
                      />
                    </div>
                  </div>
                  {draft.backgroundImageSnapshotOnly ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                      当前使用旧名片成品图作为预览底图，文字和二维码不会重复叠加。需要重新排版时，请清除或重新上传背景图。
                    </div>
                  ) : null}
                  {draft.mode === "link" ? (
                    <div className="overflow-hidden rounded-2xl border bg-white p-3">
                      <div className="mb-2 text-xs font-semibold text-slate-700">联系卡预览</div>
                      <div className="flex justify-center rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <ContactCardSurface
                          name={normalizeText(draft.name)}
                          targetUrl={websiteUrl}
                          contacts={draft.contacts}
                          invoice={draft.invoice}
                          contactFieldOrder={draft.contactFieldOrder}
                          contactDisplayFields={draft.contactDisplayFields}
                          sectionOrder={draft.contactPageSectionOrder}
                          showContactSaveButton={draft.showContactSaveButton}
                          showContactWebsiteButton={draft.showContactWebsiteButton}
                          customContactLinks={draft.customContactLinks}
                          introVideoUrl={canUseIntroVideo ? normalizeText(draft.contactIntroVideoUrl) || undefined : undefined}
                          introVideoPosterUrl={
                            canUseIntroVideo ? normalizeText(draft.contactIntroVideoPosterUrl) || undefined : undefined
                          }
                          introVideoMuted={draft.contactIntroVideoMuted}
                          imageUrl={normalizeText(draft.contactPageImageUrl) || undefined}
                          imageHeight={draft.contactPageImageHeight}
                          imageLinkUrl={normalizeText(draft.contactPageImageLinkUrl) || undefined}
                          imageX={draft.contactPageImageX}
                          imageY={draft.contactPageImageY}
                          imageScale={draft.contactPageImageScale}
                          imageOpacity={draft.contactPageImageOpacity}
                          onContactImagePointerDown={handleContactPageImagePointerDown}
                          onContactImagePointerMove={handleContactPageImagePointerMove}
                          onContactImagePointerEnd={handleContactPageImagePointerEnd}
                        />
                      </div>
                    </div>
                  ) : null}
                  <div className="rounded-xl border bg-white px-3 py-2 text-xs text-slate-600">
                    {draft.mode === "link"
                      ? "当前为链接模式：二维码和链接都会进入联系卡，对方手机打开后可保存到通讯录。"
                      : "当前为图片模式：生成后可保存或复制名片图片。"}
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </div>,
      ) : null}

      {!isPageFolderView && folderOpen ? overlay(
        <div className="fixed inset-0 z-[2147483000] bg-black/45 p-4" onMouseDown={() => setFolderOpen(false)}>
          <div className="mx-auto flex h-full max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"><div><div className="flex flex-wrap items-center gap-2"><div className="text-lg font-semibold text-slate-900">名片夹</div><div className="text-sm font-medium text-slate-500">（{cardFolderCountLabel}）</div><button type="button" className="rounded bg-black px-3 py-2 text-sm text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50" onClick={openCreateEditorFromFolder} disabled={!canOpenCreateEditor}>生成名片</button></div><div className="text-sm text-slate-500">查看已生成的图片名片或链接名片，可预览并继续操作。</div></div><div className="flex flex-wrap gap-2"><button type="button" className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50" onClick={() => setFolderOpen(false)}>关闭</button></div></div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {folderGridContent}
            </div>
          </div>
        </div>,
      ) : null}

      {previewOpen ? overlay(
        <div className="fixed inset-0 z-[2147483100] bg-black/65 p-4" onMouseDown={() => { setPreviewOpen(false); setPreviewAsset(null); }}>
          <div className="mx-auto flex h-full max-h-[calc(100vh-2rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <div className="text-base font-semibold text-slate-900">{previewName}</div>
                <div className="text-xs text-slate-500">
                  {getCardModeLabel(previewMode)}
                  {previewTitle ? ` · ${previewTitle}` : ""}
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50" onClick={() => { setPreviewOpen(false); setPreviewAsset(null); }}>
                  关闭
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-black p-4">
              {previewMode === "link" ? (
                <div className="mx-auto grid min-h-full max-w-[1400px] items-start gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(380px,430px)]">
                  <div className="flex min-h-full items-center justify-center rounded-3xl border border-slate-200/70 bg-slate-100 p-6">
                    {previewAsset ? (
                      <div className="overflow-hidden rounded-[32px] bg-white p-3 shadow-[0_18px_48px_rgba(15,23,42,.16)]">
                        {/* 预览的是用户刚生成或上传的实际图片资源，这里需要按原样显示，但背后补白底避免透明区域被黑底压暗。 */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={previewAsset.imageUrl}
                          alt={previewAsset.name}
                          className="block h-auto max-h-[calc(100vh-12rem)] max-w-full bg-white object-contain"
                        />
                      </div>
                    ) : (
                      <CardSurface
                        draft={draft}
                        websiteUrl={websiteUrl}
                        qrCodeUrl={qrCodeUrl}
                        scale={fullScale}
                        onBackgroundPointerDown={handleBackgroundPointerDown}
                        onBackgroundPointerMove={handleBackgroundPointerMove}
                        onBackgroundPointerEnd={handleBackgroundPointerEnd}
                      />
                    )}
                  </div>
                  <div className="flex min-h-full items-start justify-center rounded-3xl border border-white/10 bg-white/5 p-4">
                    <div className="flex w-full max-w-[430px] flex-col gap-4">
                      <ContactCardSurface
                        name={previewCardName}
                        targetUrl={previewTargetUrl}
                        contacts={previewContacts}
                        invoice={previewAsset?.invoice || draft.invoice}
                        contactFieldOrder={previewContactFieldOrder}
                        contactDisplayFields={previewContactDisplayFields}
                        sectionOrder={previewContactSectionOrder}
                        showContactSaveButton={previewShowContactSaveButton}
                        showContactWebsiteButton={previewShowContactWebsiteButton}
                        customContactLinks={previewCustomContactLinks}
                        introVideoUrl={previewIntroVideoUrl || undefined}
                        introVideoPosterUrl={previewIntroVideoPosterUrl || undefined}
                        introVideoMuted={previewAsset?.contactIntroVideoMuted ?? draft.contactIntroVideoMuted}
                        imageUrl={previewContactImageUrl}
                        imageHeight={previewContactImageHeight}
                        imageLinkUrl={previewContactImageLinkUrl || undefined}
                        imageX={previewContactImageX}
                        imageY={previewContactImageY}
                        imageScale={previewContactImageScale}
                        imageOpacity={previewContactImageOpacity}
                      />
                      {resolveCardShortLink(previewAsset) ? (
                        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-[0_14px_36px_rgba(15,23,42,0.12)]">
                          <div className="text-xs font-semibold text-slate-500">短链</div>
                          <div className="mt-2 break-all text-sm">{resolveCardShortLink(previewAsset)}</div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mx-auto flex min-h-full w-full items-center justify-center rounded-3xl border border-slate-200/70 bg-slate-100 p-6">
                  {previewAsset ? (
                    <div className="overflow-hidden rounded-[32px] bg-white p-3 shadow-[0_18px_48px_rgba(15,23,42,.16)]">
                      {/* 预览的是用户刚生成或上传的实际图片资源，这里需要按原样显示，但背后补白底避免透明区域被黑底压暗。 */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={previewAsset.imageUrl}
                        alt={previewAsset.name}
                        className="block h-auto max-h-[calc(100vh-12rem)] max-w-full bg-white object-contain"
                      />
                    </div>
                  ) : (
                    <CardSurface
                      draft={draft}
                      websiteUrl={websiteUrl}
                      qrCodeUrl={qrCodeUrl}
                      scale={fullScale}
                      onBackgroundPointerDown={handleBackgroundPointerDown}
                      onBackgroundPointerMove={handleBackgroundPointerMove}
                      onBackgroundPointerEnd={handleBackgroundPointerEnd}
                    />
                  )}
                </div>
              )}
            </div>
            {showPreviewGenerateButton ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-slate-50 px-5 py-4">
                <div className="text-sm text-slate-500">
                  {previewMode === "link"
                    ? "链接模式下会同时生成名片和联系卡。"
                    : "确认预览无误后即可生成名片。"}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50"
                    onClick={() => {
                      setPreviewOpen(false);
                      setPreviewAsset(null);
                    }}
                  >
                    返回编辑
                  </button>
                  {editingCardId ? (
                    <button
                      type="button"
                      className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
                      onClick={() => void handleSaveDraft()}
                      disabled={isGenerating || isDraftSaving || isContactIntroVideoProcessing}
                    >
                      {isDraftSaving ? "保存中..." : "保存"}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                        onClick={() => void handleSaveDraft()}
                        disabled={isGenerating || isDraftSaving || isContactIntroVideoProcessing}
                      >
                        {isDraftSaving ? "保存中..." : "保存"}
                      </button>
                      <button
                        type="button"
                        className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
                        onClick={() => void handleGenerate()}
                        disabled={!websiteUrl || !qrReadyForCurrentDraft || isGenerating || isDraftSaving || isContactIntroVideoProcessing}
                      >
                        {isGenerating ? "生成中..." : "生成"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>,
      ) : null}

    </div>
  );

  function resolveRatioDimensions(
    ratioMode: MerchantBusinessCardDraft["ratioMode"],
    width: number,
    height: number,
    anchor: "width" | "height" = "width",
  ) {
    const normalizedWidth = clamp(Math.round(width), MIN_CARD_FRAME_WIDTH, MAX_CARD_FRAME_WIDTH);
    const normalizedHeight = clamp(Math.round(height), MIN_CARD_FRAME_HEIGHT, MAX_CARD_FRAME_HEIGHT);
    if (ratioMode === "custom") return { width: normalizedWidth, height: normalizedHeight };
    const ratio = MERCHANT_BUSINESS_CARD_RATIO_OPTIONS.find((item) => item.id === ratioMode);
    if (!ratio) return { width: normalizedWidth, height: normalizedHeight };

    if (anchor === "height") {
      let nextHeight = normalizedHeight;
      let nextWidth = Math.round((nextHeight * ratio.width) / ratio.height);
      if (nextWidth < MIN_CARD_FRAME_WIDTH) {
        nextWidth = MIN_CARD_FRAME_WIDTH;
        nextHeight = Math.round((nextWidth * ratio.height) / ratio.width);
      }
      if (nextWidth > MAX_CARD_FRAME_WIDTH) {
        nextWidth = MAX_CARD_FRAME_WIDTH;
        nextHeight = Math.round((nextWidth * ratio.height) / ratio.width);
      }
      return {
        width: clamp(nextWidth, MIN_CARD_FRAME_WIDTH, MAX_CARD_FRAME_WIDTH),
        height: clamp(nextHeight, MIN_CARD_FRAME_HEIGHT, MAX_CARD_FRAME_HEIGHT),
      };
    }

    let nextWidth = normalizedWidth;
    let nextHeight = Math.round((nextWidth * ratio.height) / ratio.width);
    if (nextHeight < MIN_CARD_FRAME_HEIGHT) {
      nextHeight = MIN_CARD_FRAME_HEIGHT;
      nextWidth = Math.round((nextHeight * ratio.width) / ratio.height);
    }
    if (nextHeight > MAX_CARD_FRAME_HEIGHT) {
      nextHeight = MAX_CARD_FRAME_HEIGHT;
      nextWidth = Math.round((nextHeight * ratio.width) / ratio.height);
    }
    return {
      width: clamp(nextWidth, MIN_CARD_FRAME_WIDTH, MAX_CARD_FRAME_WIDTH),
      height: clamp(nextHeight, MIN_CARD_FRAME_HEIGHT, MAX_CARD_FRAME_HEIGHT),
    };
  }

  function getNumberInputValue(key: string, value: number) {
    return numberInputDrafts[key] ?? String(value);
  }

  function handleNumberInputChange(
    key: string,
    raw: string,
    fallback: number,
    min: number,
    max: number,
    onCommit: (value: number) => void,
  ) {
    setNumberInputDrafts((current) => ({ ...current, [key]: raw }));
    const trimmed = raw.trim();
    if (!trimmed) return;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return;
    onCommit(clamp(Math.round(parsed), min, max));
  }

  function clearNumberInputDraft(key: string) {
    setNumberInputDrafts((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function normalizeNumberInput(raw: string, fallback: number, min: number, max: number) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return fallback;
    return clamp(Math.round(parsed), min, max);
  }

  function commitNumberInput(
    key: string,
    fallback: number,
    min: number,
    max: number,
    onCommit: (value: number) => void,
  ) {
    const raw = numberInputDrafts[key];
    if (typeof raw !== "string") return;
    const trimmed = raw.trim();
    if (!trimmed) {
      clearNumberInputDraft(key);
      return;
    }
    const nextValue = normalizeNumberInput(trimmed, fallback, min, max);
    onCommit(nextValue);
    clearNumberInputDraft(key);
  }

  function handleSize(nextValue: number, field: "width" | "height") {
    applyDraft((current) => {
      if (current.ratioMode === "custom") return { ...current, [field]: nextValue };
      const next = resolveRatioDimensions(
        current.ratioMode,
        field === "width" ? nextValue : current.width,
        field === "height" ? nextValue : current.height,
        field,
      );
      return { ...current, width: next.width, height: next.height };
    });
  }

  function addCustomText() {
    const id = createId("custom-text");
    applyDraft((current) => ({
      ...current,
      customTexts: [
        ...current.customTexts,
        {
          id,
          text: "",
          x: 36,
          y: 334 + current.customTexts.length * 36,
          typography: { ...current.fieldTypography.contactName },
        },
      ],
    }));
    setSelectedFieldKeys([getCustomTextSelectionKey(id)]);
  }

  function updateCustomText(
    id: string,
    recipe: (current: MerchantBusinessCardCustomText) => MerchantBusinessCardCustomText,
  ) {
    applyDraft((current) => ({
      ...current,
      customTexts: current.customTexts.map((item) => (item.id === id ? recipe(item) : item)),
    }));
  }

  function removeCustomText(id: string) {
    clearNumberInputDraft(`layout-${getCustomTextSelectionKey(id)}-x`);
    clearNumberInputDraft(`layout-${getCustomTextSelectionKey(id)}-y`);
    applyDraft((current) => ({
      ...current,
      customTexts: current.customTexts.filter((item) => item.id !== id),
    }));
    setSelectedFieldKeys((current) => {
      const next = current.filter((item) => item !== getCustomTextSelectionKey(id));
      return next.length > 0 ? next : ["merchantName"];
    });
  }

  function updateTypography(
    patch: Partial<MerchantBusinessCardDraft["fieldTypography"][MerchantBusinessCardFieldKey]>,
  ) {
    const selectedStandardFieldKeys = selectedFieldKeys.filter((item): item is MerchantBusinessCardFieldKey =>
      ALL_FIELD_LAYOUT_KEYS.includes(item as MerchantBusinessCardFieldKey),
    );
    const selectedCustomTextIds = selectedFieldKeys.map(getCustomTextIdFromSelectionKey).filter(Boolean);

    applyDraft((current) => ({
      ...current,
      typography: {
        ...current.typography,
        ...(applyUnifiedTypography
          ? Object.fromEntries(
              ALL_TYPOGRAPHY_KEYS.map((typographyKey) => [
                typographyKey,
                {
                  ...current.typography[typographyKey],
                  ...patch,
                },
              ]),
            )
          : current.typography),
      },
      fieldTypography: applyUnifiedTypography
        ? Object.fromEntries(
            ALL_FIELD_LAYOUT_KEYS.map((fieldKey) => [
              fieldKey,
              {
                ...current.fieldTypography[fieldKey],
                ...patch,
              },
            ]),
          ) as MerchantBusinessCardDraft["fieldTypography"]
        : {
            ...current.fieldTypography,
            ...Object.fromEntries(
              selectedStandardFieldKeys.map((fieldKey) => [
                fieldKey,
                {
                  ...current.fieldTypography[fieldKey],
                  ...patch,
                },
              ]),
            ),
          },
      customTexts: applyUnifiedTypography
        ? current.customTexts.map((item) => ({
            ...item,
            typography: {
              ...item.typography,
              ...patch,
            },
          }))
        : selectedCustomTextIds.length > 0
          ? current.customTexts.map((item) =>
              selectedCustomTextIds.includes(item.id)
                ? {
                    ...item,
                    typography: {
                      ...item.typography,
                      ...patch,
                    },
                  }
                : item,
            )
          : current.customTexts,
    }));
  }

  function buildCardFileName(card: MerchantBusinessCardAsset) {
    const rawContactName = normalizeText(card.contacts.contactName) || normalizeText(card.name) || "business card";
    const normalizedContactName = rawContactName
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
    const safeBaseName = normalizedContactName.replace(/[\\/:*?"<>|]+/g, "").trim() || "business card";
    return `${safeBaseName}'s card.${getImageFileExtension(card.imageUrl)}`;
  }

  async function saveCard(card: MerchantBusinessCardAsset) {
    try {
      const response = await fetch(card.imageUrl);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = buildCardFileName(card);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setTip("名片已开始保存");
    } catch {
      setTip("保存失败，请重试");
    }
  }

  function updateCardShareMeta(
    cardId: string,
    patch: Partial<Pick<MerchantBusinessCardAsset, "shareImageUrl" | "shareKey" | "contactPagePublicImageUrl">>,
  ) {
    void mergeSavedBusinessCardAssetPatch({ cardId, patch }).catch(() => undefined);
  }

  function persistBusinessCardList(cardsToSave: MerchantBusinessCardAsset[]) {
    const normalizedNextCards = normalizeMerchantBusinessCardChatDisplaySelection(cardsToSave);
    normalizedCardsRef.current = normalizedNextCards;
    return Promise.resolve(onCardsChange(normalizedNextCards));
  }

  function beginBusinessCardBackgroundSync(cardId: string) {
    const nextGeneration = (backgroundSyncGenerationRef.current[cardId] ?? 0) + 1;
    backgroundSyncGenerationRef.current[cardId] = nextGeneration;
    return nextGeneration;
  }

  function isCurrentBusinessCardBackgroundSync(cardId: string, syncGeneration?: number) {
    return syncGeneration === undefined || backgroundSyncGenerationRef.current[cardId] === syncGeneration;
  }

  async function mergeSavedBusinessCardAssetPatch(input: {
    cardId: string;
    patch: MerchantBusinessCardBackgroundPatch;
    expectedFrontSignature?: string;
    syncGeneration?: number;
  }) {
    if (!isCurrentBusinessCardBackgroundSync(input.cardId, input.syncGeneration)) return false;
    const currentCards = normalizedCardsRef.current.length ? normalizedCardsRef.current : normalizedCards;
    const currentCard = currentCards.find((card) => card.id === input.cardId);
    if (!currentCard) return false;

    const safePatch: MerchantBusinessCardBackgroundPatch = {};
    const imageUrl = normalizeText(input.patch.imageUrl);
    if (
      imageUrl &&
      normalizeText(currentCard.imageUrl) !== imageUrl &&
      (!input.expectedFrontSignature || buildBusinessCardFrontRenderSignature(currentCard) === input.expectedFrontSignature)
    ) {
      safePatch.imageUrl = imageUrl;
    }

    const shareImageUrl = normalizeText(input.patch.shareImageUrl);
    if (shareImageUrl && normalizeText(currentCard.shareImageUrl) !== shareImageUrl) {
      safePatch.shareImageUrl = shareImageUrl;
    }

    const contactPagePublicImageUrl = normalizeText(input.patch.contactPagePublicImageUrl);
    if (contactPagePublicImageUrl && normalizeText(currentCard.contactPagePublicImageUrl) !== contactPagePublicImageUrl) {
      safePatch.contactPagePublicImageUrl = contactPagePublicImageUrl;
    }

    const shareKey = normalizeText(input.patch.shareKey);
    if (shareKey && normalizeText(currentCard.shareKey) !== shareKey) {
      safePatch.shareKey = shareKey;
    }

    if (Object.keys(safePatch).length === 0 || !isCurrentBusinessCardBackgroundSync(input.cardId, input.syncGeneration)) {
      return false;
    }

    let updatedCard: MerchantBusinessCardAsset | null = null;
    const nextCards = currentCards.map((card) => {
      if (card.id !== input.cardId) return card;
      updatedCard = { ...card, ...safePatch };
      return updatedCard;
    });
    await persistBusinessCardList(nextCards);
    if (updatedCard) {
      setPreviewAsset((current) => (current?.id === input.cardId ? updatedCard : current));
    }
    return true;
  }

  async function resolveShareImageUrl(input: {
    card?: MerchantBusinessCardAsset | null;
    renderedImageUrl?: string;
    cardName?: string;
    targetUrl?: string;
    syncCardMeta?: boolean;
  }) {
    const shareOrigin = resolveMerchantBusinessCardShareOrigin(undefined, input.targetUrl);
    const syncCardMeta = input.syncCardMeta !== false;
    const renderedImageUrl = normalizeText(input.renderedImageUrl);
    if (/^data:image\//i.test(renderedImageUrl)) {
      const uploadedUrl = await uploadImageDataUrlToPublicStorage(
        renderedImageUrl,
        sanitizeShareAssetHint(
          normalizeText(profile.domainPrefix) ||
            normalizeText(input.cardName) ||
            normalizeText(input.card?.name) ||
            normalizeText(profile.merchantName),
        ),
        "business-card-export",
        {
          skipOperationLog: true,
        },
      );
      const publicUrl = normalizeMerchantBusinessCardShareImageUrl(uploadedUrl, shareOrigin);
      if (publicUrl) {
        if (syncCardMeta && input.card) {
          updateCardShareMeta(input.card.id, { shareImageUrl: publicUrl });
        }
        return publicUrl;
      }
    }
    const renderedPublicUrl = normalizeMerchantBusinessCardShareImageUrl(renderedImageUrl, shareOrigin);
    if (renderedPublicUrl) {
      if (syncCardMeta && input.card && normalizeText(input.card.shareImageUrl) !== renderedPublicUrl) {
        updateCardShareMeta(input.card.id, { shareImageUrl: renderedPublicUrl });
      }
      return renderedPublicUrl;
    }
    const existingPublicUrl = normalizeMerchantBusinessCardShareImageUrl(
      normalizeText(input.card?.shareImageUrl) || normalizeText(input.card?.imageUrl),
      shareOrigin,
    );
    if (existingPublicUrl) {
      if (syncCardMeta && input.card && normalizeText(input.card.shareImageUrl) !== existingPublicUrl) {
        updateCardShareMeta(input.card.id, { shareImageUrl: existingPublicUrl });
      }
      return existingPublicUrl;
    }

    const sourceImageUrl =
      normalizeText(input.renderedImageUrl) ||
      normalizeText(input.card?.shareImageUrl) ||
      normalizeText(input.card?.imageUrl);
    if (!/^data:image\//i.test(sourceImageUrl)) return "";

    const uploadedUrl = await uploadImageDataUrlToPublicStorage(
      sourceImageUrl,
      sanitizeShareAssetHint(
        normalizeText(profile.domainPrefix) ||
          normalizeText(input.cardName) ||
          normalizeText(input.card?.name) ||
          normalizeText(profile.merchantName),
      ),
      "business-card-export",
      {
        skipOperationLog: true,
      },
    );
    const publicUrl = normalizeMerchantBusinessCardShareImageUrl(uploadedUrl, shareOrigin);
    if (publicUrl && syncCardMeta && input.card) {
      updateCardShareMeta(input.card.id, { shareImageUrl: publicUrl });
    }
    return publicUrl;
  }

  async function resolveContactPageImageUrl(input: {
    card?: MerchantBusinessCardAsset | null;
    imageUrl?: string;
    cardName?: string;
    targetUrl?: string;
    syncCardMeta?: boolean;
    preferImageUrl?: boolean;
  }) {
    const shareOrigin = resolveMerchantBusinessCardShareOrigin(undefined, input.targetUrl);
    const syncCardMeta = input.syncCardMeta !== false;
    const sourceImageUrl = normalizeText(input.imageUrl) || normalizeText(input.card?.contactPageImageUrl);
    const resolveSourceImageUrl = async () => {
      if (/^data:image\//i.test(sourceImageUrl)) {
        const uploadedUrl = await uploadImageDataUrlToPublicStorage(
          sourceImageUrl,
          sanitizeShareAssetHint(
            `${normalizeText(profile.domainPrefix) || normalizeText(input.cardName) || normalizeText(input.card?.name) || normalizeText(profile.merchantName)}-contact`,
          ),
          "business-card-contact",
          {
            operationModule: "经营中心 > 名片夹",
            operationAction: "上传联系卡图片",
            operationSummary: `在经营中心 > 名片夹上传联系卡图片：${input.cardName || input.card?.name || profile.merchantName || "未命名名片"}`,
          },
        );
        const publicUrl = normalizeMerchantBusinessCardShareImageUrl(uploadedUrl, shareOrigin);
        if (publicUrl && syncCardMeta && input.card) {
          updateCardShareMeta(input.card.id, { contactPagePublicImageUrl: publicUrl });
        }
        return publicUrl;
      }
      const publicUrl = normalizeMerchantBusinessCardShareImageUrl(sourceImageUrl, shareOrigin);
      if (publicUrl && syncCardMeta && input.card && normalizeText(input.card.contactPagePublicImageUrl) !== publicUrl) {
        updateCardShareMeta(input.card.id, { contactPagePublicImageUrl: publicUrl });
      }
      return publicUrl;
    };
    if (input.preferImageUrl) {
      const explicitUrl = await resolveSourceImageUrl();
      if (explicitUrl) return explicitUrl;
    }
    const existingPublicUrl = normalizeMerchantBusinessCardShareImageUrl(
      normalizeText(input.card?.contactPagePublicImageUrl) || normalizeText(input.imageUrl) || normalizeText(input.card?.contactPageImageUrl),
      shareOrigin,
    );
    if (existingPublicUrl) {
      if (syncCardMeta && input.card && normalizeText(input.card.contactPagePublicImageUrl) !== existingPublicUrl) {
        updateCardShareMeta(input.card.id, { contactPagePublicImageUrl: existingPublicUrl });
      }
      return existingPublicUrl;
    }
    return resolveSourceImageUrl();
  }

  async function buildShareBundle(input: {
    targetUrl: string;
    cardName: string;
    shareKey?: string;
    allowLegacyFallback?: boolean;
    card?: MerchantBusinessCardAsset | null;
    renderedImageUrl?: string;
    contactPageImageUrl?: string;
    contactPageImageHeight?: number;
    contactPageImageLinkUrl?: string;
    contactPageImageX?: number;
    contactPageImageY?: number;
    contactPageImageScale?: number;
    contactPageImageOpacity?: number;
    introVideoUrl?: string;
    introVideoPosterUrl?: string;
    introVideoMuted?: boolean;
    contactPageSectionOrder?: MerchantBusinessCardDraft["contactPageSectionOrder"];
    showContactSaveButton?: boolean;
    showContactWebsiteButton?: boolean;
    imageWidth?: number;
    imageHeight?: number;
    contact?: MerchantBusinessCardShareContact;
    syncCardMeta?: boolean;
    preferContactPageImage?: boolean;
    requireVerifiedShortLink?: boolean;
    verifyShortLink?: boolean;
    shareRequestAttempts?: number;
    shareRequestTimeoutMs?: number;
  }) {
    const targetUrl = normalizeText(input.targetUrl);
    if (!targetUrl) {
      throw new Error("missing_target");
    }
    const allowLegacyFallback = input.allowLegacyFallback !== false;
    const shareImageUrl = await resolveShareImageUrl({
      card: input.card,
      renderedImageUrl: input.renderedImageUrl,
      cardName: input.cardName,
      targetUrl,
      syncCardMeta: input.syncCardMeta,
    });
    const detailImageUrl = await resolveContactPageImageUrl({
      card: input.card,
      imageUrl: input.contactPageImageUrl,
      cardName: input.cardName,
      targetUrl,
      syncCardMeta: input.syncCardMeta,
      preferImageUrl: input.preferContactPageImage,
    });
    const introVideoUrl = canUseIntroVideo ? normalizeText(input.introVideoUrl) : "";
    const introPosterUrl = introVideoUrl && canUseIntroVideo ? normalizeText(input.introVideoPosterUrl) : "";
    const fallbackShareUrl = buildMerchantBusinessCardShareUrl({
      origin: resolveMerchantBusinessCardShareOrigin(undefined, targetUrl),
      imageUrl: shareImageUrl,
      detailImageUrl,
      detailImageHeight: input.contactPageImageHeight,
      detailImageLinkUrl: input.contactPageImageLinkUrl,
      detailImageX: input.contactPageImageX,
      detailImageY: input.contactPageImageY,
      detailImageScale: input.contactPageImageScale,
      detailImageOpacity: input.contactPageImageOpacity,
      introVideoUrl,
      introPosterUrl,
      introVideoMuted: input.introVideoMuted,
      contactPageSectionOrder: input.contactPageSectionOrder,
      showContactSaveButton: input.showContactSaveButton,
      showContactWebsiteButton: input.showContactWebsiteButton,
      targetUrl,
      name: input.cardName,
      contact: input.contact,
    });
    if (!shareImageUrl) {
      if (allowLegacyFallback && fallbackShareUrl) {
        return {
          shareUrl: fallbackShareUrl,
          shareImageUrl: "",
          detailImageUrl,
          shareKey: "",
        };
      }
      throw new Error("share_image_unavailable");
    }
    let shareUrl = "";
    let shareKey = "";
    let lastErrorCode = "";
    const maxShareRequestAttempts = Math.max(1, Math.min(2, Math.round(input.shareRequestAttempts ?? 2)));
    const shareRequestTimeoutMs = Math.max(5_000, Math.round(input.shareRequestTimeoutMs ?? 15_000));
    const shouldVerifyShortLink = input.verifyShortLink !== false;
    for (let attempt = 0; attempt < maxShareRequestAttempts; attempt += 1) {
      try {
        const headers: Record<string, string> = {
          "content-type": "application/json",
        };
        if (normalizedMerchantId) {
          headers["x-merchant-site-id"] = normalizedMerchantId;
        }
        const response = await fetchWithTimeout("/api/business-card-share", {
          method: "POST",
          headers,
          credentials: "same-origin",
          body: JSON.stringify({
            ...(normalizedMerchantId ? { merchantId: normalizedMerchantId } : {}),
            key: normalizeText(input.shareKey),
            name: input.cardName,
            imageUrl: shareImageUrl,
            detailImageUrl,
            detailImageHeight:
              typeof input.contactPageImageHeight === "number"
                ? Math.round(input.contactPageImageHeight)
                : undefined,
            detailImageLinkUrl: normalizeText(input.contactPageImageLinkUrl) || undefined,
            detailImageX: typeof input.contactPageImageX === "number" ? Math.round(input.contactPageImageX) : undefined,
            detailImageY: typeof input.contactPageImageY === "number" ? Math.round(input.contactPageImageY) : undefined,
            detailImageScale:
              typeof input.contactPageImageScale === "number"
                ? Math.round(input.contactPageImageScale * 100) / 100
                : undefined,
            detailImageOpacity:
              typeof input.contactPageImageOpacity === "number"
                ? Math.round(Math.max(0, Math.min(1, input.contactPageImageOpacity)) * 100) / 100
                : undefined,
            introVideoUrl: introVideoUrl || undefined,
            introPosterUrl: introPosterUrl || undefined,
            introVideoMuted: input.introVideoMuted,
            contactPageSectionOrder: input.contactPageSectionOrder,
            showContactSaveButton: input.showContactSaveButton,
            showContactWebsiteButton: input.showContactWebsiteButton,
            targetUrl,
            imageWidth: typeof input.imageWidth === "number" ? Math.round(input.imageWidth) : undefined,
            imageHeight: typeof input.imageHeight === "number" ? Math.round(input.imageHeight) : undefined,
            contact: input.contact,
          }),
        }, attempt === 0 ? shareRequestTimeoutMs : Math.max(shareRequestTimeoutMs, 20_000));
        const payload = (await response.json().catch(() => null)) as {
          ok?: unknown;
          error?: unknown;
          shareKey?: unknown;
          shareUrl?: unknown;
        } | null;
        shareUrl = typeof payload?.shareUrl === "string" ? payload.shareUrl.trim() : "";
        shareKey = typeof payload?.shareKey === "string" ? payload.shareKey.trim() : "";
        lastErrorCode = typeof payload?.error === "string" ? payload.error.trim() : "";
        if (response.ok && shareUrl && shareKey) {
          if (!shouldVerifyShortLink) {
            break;
          }
          const linkReady = await verifyShortBusinessCardShareLink(shareUrl, attempt === 0 ? 8_000 : 12_000);
          if (linkReady) {
            break;
          }
          lastErrorCode = "share_link_not_ready";
          if (attempt + 1 < maxShareRequestAttempts) {
            await delay(600);
            continue;
          }
          if (input.requireVerifiedShortLink) {
            shareUrl = "";
            shareKey = "";
          }
          break;
        }
        if (attempt + 1 < maxShareRequestAttempts && (response.status === 401 || response.status === 503 || lastErrorCode === "unauthorized")) {
          await delay(500);
          continue;
        }
        if (attempt + 1 < maxShareRequestAttempts && response.status >= 500) {
          await delay(400);
          continue;
        }
      } catch (error) {
        lastErrorCode = error instanceof Error && error.name === "AbortError" ? "share_request_timeout" : "share_link_unavailable";
        if (attempt + 1 < maxShareRequestAttempts) {
          await delay(400);
          continue;
        }
      }
      shareUrl = "";
      shareKey = "";
      break;
    }
    if (!shareUrl || !shareKey) {
      if (allowLegacyFallback && fallbackShareUrl) {
        return {
          shareUrl: fallbackShareUrl,
          shareImageUrl,
          detailImageUrl,
          shareKey: "",
        };
      }
      throw new Error(
        lastErrorCode === "unauthorized"
          ? "share_auth_unavailable"
          : lastErrorCode === "share_request_timeout"
            ? "share_request_timeout"
            : lastErrorCode === "share_link_not_ready"
              ? "share_link_not_ready"
            : "share_link_unavailable",
      );
    }
    if (input.syncCardMeta !== false && input.card && (shareKey || shareImageUrl || detailImageUrl)) {
      updateCardShareMeta(input.card.id, {
        ...(shareImageUrl ? { shareImageUrl } : {}),
        ...(shareKey ? { shareKey } : {}),
        ...(detailImageUrl ? { contactPagePublicImageUrl: detailImageUrl } : {}),
      });
    }
    return {
      shareUrl,
      shareImageUrl,
      detailImageUrl,
      shareKey,
    };
  }

  function buildDraftShareContactPayload(source: MerchantBusinessCardDraft, targetUrl: string) {
    return buildShareContactPayload({
      name: source.name,
      title: source.title,
      contacts: source.contacts,
      invoice: source.invoice,
      contactFieldOrder: source.contactFieldOrder,
      contactDisplayFields: source.contactDisplayFields,
      customContactLinks: source.customContactLinks,
      targetUrl,
    });
  }

  async function renderCurrentDraftExportImage() {
    const node = hiddenPreviewRef.current;
    if (!node) {
      throw new Error("business_card_preview_unavailable");
    }
    const exportedImage = await compressImageDataUrlWithinLimit(
      await renderCardNodeToImage(node),
      normalizedExportImageLimitKb * 1024,
    );
    if (exportedImage.bytes > normalizedExportImageLimitKb * 1024) {
      throw new Error("export_image_limit_exceeded");
    }
    return exportedImage.dataUrl;
  }

  async function syncSavedBusinessCardAssetInBackground(input: {
    asset: MerchantBusinessCardAsset;
    refreshFrontImage?: boolean;
    expectedFrontSignature?: string;
    syncGeneration?: number;
    draftRevision?: number;
  }) {
    const asset = input.asset;
    let renderedImageUrl = "";
    let refreshedFrontImage = false;
    const patch: MerchantBusinessCardBackgroundPatch = {};

    if (input.refreshFrontImage) {
      try {
        if (
          isCurrentBusinessCardBackgroundSync(asset.id, input.syncGeneration) &&
          (input.draftRevision === undefined || draftRevisionRef.current === input.draftRevision)
        ) {
          setTip("名片设置已保存，正在后台更新名片图片...");
          const nextRenderedImageUrl = await renderCurrentDraftExportImage();
          if (
            nextRenderedImageUrl &&
            isCurrentBusinessCardBackgroundSync(asset.id, input.syncGeneration) &&
            (input.draftRevision === undefined || draftRevisionRef.current === input.draftRevision)
          ) {
            renderedImageUrl = nextRenderedImageUrl;
            patch.imageUrl = renderedImageUrl;
            refreshedFrontImage = true;
          }
        }
        if (renderedImageUrl) {
          refreshedFrontImage = true;
        }
      } catch {
        setTip("名片设置已保存，图片后台更新失败，联系卡继续同步");
      }
    }

    if (asset.mode === "link") {
      try {
        if (!isCurrentBusinessCardBackgroundSync(asset.id, input.syncGeneration)) return;
        const shareContactPayload = buildDraftShareContactPayload(asset, asset.targetUrl);
        const shareBundle = await buildShareBundle({
          targetUrl: asset.targetUrl,
          cardName: normalizeText(asset.name),
          shareKey: normalizeText(asset.shareKey),
          allowLegacyFallback: false,
          card: asset,
          renderedImageUrl,
          contactPageImageUrl: normalizeText(asset.contactPageImageUrl),
          contactPageImageHeight: asset.contactPageImageHeight,
          contactPageImageLinkUrl: normalizeText(asset.contactPageImageLinkUrl),
          contactPageImageX: asset.contactPageImageX,
          contactPageImageY: asset.contactPageImageY,
          contactPageImageScale: asset.contactPageImageScale,
          contactPageImageOpacity: asset.contactPageImageOpacity,
          introVideoUrl: normalizeText(asset.contactIntroVideoUrl),
          introVideoPosterUrl: normalizeText(asset.contactIntroVideoPosterUrl),
          introVideoMuted: asset.contactIntroVideoMuted,
          contactPageSectionOrder: asset.contactPageSectionOrder,
          showContactSaveButton: asset.showContactSaveButton,
          showContactWebsiteButton: asset.showContactWebsiteButton,
          imageWidth: asset.width,
          imageHeight: asset.height,
          contact: shareContactPayload,
          syncCardMeta: false,
          preferContactPageImage: true,
          requireVerifiedShortLink: false,
          verifyShortLink: false,
          shareRequestAttempts: 1,
          shareRequestTimeoutMs: 8_000,
        });
        if (shareBundle.shareImageUrl) {
          patch.shareImageUrl = shareBundle.shareImageUrl;
        }
        if (shareBundle.detailImageUrl) {
          patch.contactPagePublicImageUrl = shareBundle.detailImageUrl;
        }
        if (normalizeText(shareBundle.shareKey)) {
          patch.shareKey = normalizeText(shareBundle.shareKey);
        }
        await mergeSavedBusinessCardAssetPatch({
          cardId: asset.id,
          patch,
          expectedFrontSignature: input.expectedFrontSignature,
          syncGeneration: input.syncGeneration,
        });
        setTip(refreshedFrontImage ? "名片图片和联系卡已后台更新" : "联系卡短链已后台同步");
        return;
      } catch {
        if (refreshedFrontImage) {
          await mergeSavedBusinessCardAssetPatch({
            cardId: asset.id,
            patch: { imageUrl: renderedImageUrl },
            expectedFrontSignature: input.expectedFrontSignature,
            syncGeneration: input.syncGeneration,
          });
        }
        setTip("名片设置已保存，联系卡后台同步失败，稍后可再点保存");
        return;
      }
    }

    if (refreshedFrontImage) {
      await mergeSavedBusinessCardAssetPatch({
        cardId: asset.id,
        patch: { imageUrl: renderedImageUrl },
        expectedFrontSignature: input.expectedFrontSignature,
        syncGeneration: input.syncGeneration,
      });
      setTip("名片图片已后台更新");
    }
  }

  async function saveCurrentDraftToFolder() {
    if (!websiteUrl || !qrReadyForCurrentDraft) return null;
    const currentCards = normalizedCardsRef.current.length ? normalizedCardsRef.current : normalizedCards;
    if (!editingCardId && currentCards.length >= normalizedCardLimit) {
      throw new Error("business_card_limit_reached");
    }

    const nextDraftBase = normalizeMerchantBusinessCardDraft(draft);
    const normalizedContactPageImageLinkUrl = normalizeMerchantBusinessCardShareTargetUrl(nextDraftBase.contactPageImageLinkUrl);
    const nextDraft =
      normalizedContactPageImageLinkUrl && normalizedContactPageImageLinkUrl !== nextDraftBase.contactPageImageLinkUrl
        ? { ...nextDraftBase, contactPageImageLinkUrl: normalizedContactPageImageLinkUrl }
        : nextDraftBase;
    const existingCard = editingCardId ? currentCards.find((card) => card.id === editingCardId) ?? null : null;
    if (existingCard) {
      beginBusinessCardBackgroundSync(existingCard.id);
    }
    const reusableSnapshotImageUrl =
      existingCard && nextDraft.backgroundImageSnapshotOnly
        ? normalizePublicAssetUrl(normalizeText(existingCard.imageUrl) || normalizeText(existingCard.shareImageUrl))
        : "";
    const existingFrontImageUrl = existingCard
      ? normalizeText(existingCard.imageUrl) || normalizePublicAssetUrl(normalizeText(existingCard.shareImageUrl))
      : "";
    const reusableUnchangedFrontImageUrl =
      existingCard &&
      existingFrontImageUrl &&
      buildBusinessCardFrontRenderSignature(existingCard) === buildBusinessCardFrontRenderSignature(nextDraft)
        ? existingFrontImageUrl
        : "";
    const imageUrl =
      reusableSnapshotImageUrl ||
      reusableUnchangedFrontImageUrl ||
      (await (async () => {
        setTip("正在生成名片图片...");
        return renderCurrentDraftExportImage();
      })());
    const resolvedShareKey =
      nextDraft.mode === "link"
        ? normalizeText(existingCard?.shareKey) ||
          createMerchantBusinessCardShareKey({
            contactName: nextDraft.contacts.contactName,
            name: nextDraft.name,
            targetUrl: websiteUrl,
            code: draftShareCode,
          })
        : "";
    const shareContactPayload =
      nextDraft.mode === "link"
        ? buildDraftShareContactPayload(nextDraft, websiteUrl)
        : undefined;
    if (nextDraft.mode === "link") {
      setTip("正在同步联系卡短链...");
    }
    const shareBundle =
      nextDraft.mode === "link"
        ? await buildShareBundle({
            targetUrl: websiteUrl,
            cardName: normalizeText(nextDraft.name),
            shareKey: resolvedShareKey,
            allowLegacyFallback: false,
            card: existingCard,
            renderedImageUrl: imageUrl,
            contactPageImageUrl: normalizeText(nextDraft.contactPageImageUrl),
            contactPageImageHeight: nextDraft.contactPageImageHeight,
            contactPageImageLinkUrl: normalizeText(nextDraft.contactPageImageLinkUrl),
            contactPageImageX: nextDraft.contactPageImageX,
            contactPageImageY: nextDraft.contactPageImageY,
            contactPageImageScale: nextDraft.contactPageImageScale,
            contactPageImageOpacity: nextDraft.contactPageImageOpacity,
            introVideoUrl: normalizeText(nextDraft.contactIntroVideoUrl),
            introVideoPosterUrl: normalizeText(nextDraft.contactIntroVideoPosterUrl),
            introVideoMuted: nextDraft.contactIntroVideoMuted,
            contactPageSectionOrder: nextDraft.contactPageSectionOrder,
            showContactSaveButton: nextDraft.showContactSaveButton,
            showContactWebsiteButton: nextDraft.showContactWebsiteButton,
            imageWidth: nextDraft.width,
            imageHeight: nextDraft.height,
            contact: shareContactPayload,
            syncCardMeta: false,
            preferContactPageImage: true,
            requireVerifiedShortLink: true,
            verifyShortLink: false,
            shareRequestAttempts: 1,
            shareRequestTimeoutMs: 12_000,
          })
        : null;
    if (nextDraft.mode === "link" && !normalizeText(shareBundle?.shareKey)) {
      throw new Error("share_link_unavailable");
    }
    if (
      existingCard &&
      nextDraft.mode !== "link" &&
      (existingCard.mode === "link" || Boolean(normalizeText(existingCard.shareKey)))
    ) {
      setTip("正在停用原联系卡短链...");
      await deleteCardShare(existingCard);
    }
    const assetWithPossibleShareMetadata: MerchantBusinessCardAsset = {
      ...nextDraft,
      id: existingCard?.id ?? createId("business-card"),
      createdAt: existingCard?.createdAt ?? new Date().toISOString(),
      imageUrl,
      ...(nextDraft.mode === "link" && (shareBundle?.shareImageUrl || existingCard?.shareImageUrl)
        ? { shareImageUrl: shareBundle?.shareImageUrl || existingCard?.shareImageUrl }
        : {}),
      ...(nextDraft.mode === "link" && (shareBundle?.detailImageUrl || existingCard?.contactPagePublicImageUrl)
        ? { contactPagePublicImageUrl: shareBundle?.detailImageUrl || existingCard?.contactPagePublicImageUrl }
        : {}),
      ...(nextDraft.mode === "link" && normalizeText(shareBundle?.shareKey) ? { shareKey: normalizeText(shareBundle?.shareKey) } : {}),
      targetUrl: websiteUrl,
      ...(existingCard?.showInChat ? { showInChat: true } : {}),
      ...(existingCard?.chatDisplayDisabled ? { chatDisplayDisabled: true } : {}),
    };
    const asset =
      nextDraft.mode === "link"
        ? assetWithPossibleShareMetadata
        : stripMerchantBusinessCardShareMetadata(assetWithPossibleShareMetadata);

    const nextCards = existingCard
      ? currentCards.map((card) => (card.id === existingCard.id ? asset : card))
      : [asset, ...currentCards];
    await persistBusinessCardList(nextCards);
    setEditingCardId(asset.id);
    return asset;
  }

  async function saveCurrentDraftSettingsToExistingCard(options?: {
    deferShareSync?: boolean;
    refreshFrontImage?: boolean;
  }) {
    if (!editingCardId || !websiteUrl) return null;
    const currentCards = normalizedCardsRef.current.length ? normalizedCardsRef.current : normalizedCards;
    const existingCard = currentCards.find((card) => card.id === editingCardId) ?? null;
    if (!existingCard) return null;

    const nextDraftBase = normalizeMerchantBusinessCardDraft(draft);
    const savedDraftRevision = draftRevisionRef.current;
    const normalizedContactPageImageLinkUrl = normalizeMerchantBusinessCardShareTargetUrl(nextDraftBase.contactPageImageLinkUrl);
    const nextDraft =
      normalizedContactPageImageLinkUrl && normalizedContactPageImageLinkUrl !== nextDraftBase.contactPageImageLinkUrl
        ? { ...nextDraftBase, contactPageImageLinkUrl: normalizedContactPageImageLinkUrl }
        : nextDraftBase;
    const syncGeneration = beginBusinessCardBackgroundSync(existingCard.id);
    const resolvedShareKey =
      nextDraft.mode === "link"
        ? normalizeText(existingCard.shareKey) ||
          createMerchantBusinessCardShareKey({
            contactName: nextDraft.contacts.contactName,
            name: nextDraft.name,
            targetUrl: websiteUrl,
            code: draftShareCode,
          })
        : "";
    const shareContactPayload =
      nextDraft.mode === "link"
        ? buildDraftShareContactPayload(nextDraft, websiteUrl)
        : undefined;
    if (nextDraft.mode === "link" && !options?.deferShareSync) {
      setTip("正在同步联系卡短链...");
    }
    const shareBundle =
      nextDraft.mode === "link" && !options?.deferShareSync
        ? await buildShareBundle({
            targetUrl: websiteUrl,
            cardName: normalizeText(nextDraft.name),
            shareKey: resolvedShareKey,
            allowLegacyFallback: false,
            card: existingCard,
            contactPageImageUrl: normalizeText(nextDraft.contactPageImageUrl),
            contactPageImageHeight: nextDraft.contactPageImageHeight,
            contactPageImageLinkUrl: normalizeText(nextDraft.contactPageImageLinkUrl),
            contactPageImageX: nextDraft.contactPageImageX,
            contactPageImageY: nextDraft.contactPageImageY,
            contactPageImageScale: nextDraft.contactPageImageScale,
            contactPageImageOpacity: nextDraft.contactPageImageOpacity,
            introVideoUrl: normalizeText(nextDraft.contactIntroVideoUrl),
            introVideoPosterUrl: normalizeText(nextDraft.contactIntroVideoPosterUrl),
            introVideoMuted: nextDraft.contactIntroVideoMuted,
            contactPageSectionOrder: nextDraft.contactPageSectionOrder,
            showContactSaveButton: nextDraft.showContactSaveButton,
            showContactWebsiteButton: nextDraft.showContactWebsiteButton,
            imageWidth: nextDraft.width,
            imageHeight: nextDraft.height,
            contact: shareContactPayload,
            syncCardMeta: false,
            preferContactPageImage: true,
            requireVerifiedShortLink: true,
            verifyShortLink: false,
            shareRequestAttempts: 1,
            shareRequestTimeoutMs: 12_000,
          })
        : null;
    if (nextDraft.mode === "link" && !options?.deferShareSync && !normalizeText(shareBundle?.shareKey)) {
      throw new Error("share_link_unavailable");
    }
    if (
      nextDraft.mode !== "link" &&
      (existingCard.mode === "link" || Boolean(normalizeText(existingCard.shareKey)))
    ) {
      setTip("正在停用原联系卡短链...");
      await deleteCardShare(existingCard);
    }
    const savedShareKey = normalizeText(shareBundle?.shareKey) || resolvedShareKey;
    const shouldRefreshFrontImage =
      Boolean(options?.refreshFrontImage) &&
      Boolean(normalizeText(existingCard.imageUrl) || normalizeText(existingCard.shareImageUrl)) &&
      buildBusinessCardFrontRenderSignature(existingCard) !== buildBusinessCardFrontRenderSignature(nextDraft);

    const assetWithPossibleShareMetadata: MerchantBusinessCardAsset = {
      ...existingCard,
      ...nextDraft,
      id: existingCard.id,
      createdAt: existingCard.createdAt,
      imageUrl: existingCard.imageUrl,
      ...(nextDraft.mode === "link" && (shareBundle?.shareImageUrl || existingCard.shareImageUrl)
        ? { shareImageUrl: shareBundle?.shareImageUrl || existingCard.shareImageUrl }
        : {}),
      ...(nextDraft.mode === "link" && (shareBundle?.detailImageUrl || existingCard.contactPagePublicImageUrl)
        ? { contactPagePublicImageUrl: shareBundle?.detailImageUrl || existingCard.contactPagePublicImageUrl }
        : {}),
      ...(nextDraft.mode === "link" && savedShareKey ? { shareKey: savedShareKey } : {}),
      targetUrl: websiteUrl,
      ...(existingCard.showInChat ? { showInChat: true } : {}),
      ...(existingCard.chatDisplayDisabled ? { chatDisplayDisabled: true } : {}),
    };
    const asset =
      nextDraft.mode === "link"
        ? assetWithPossibleShareMetadata
        : stripMerchantBusinessCardShareMetadata(assetWithPossibleShareMetadata);
    const nextCards = currentCards.map((card) => (card.id === existingCard.id ? asset : card));
    await persistBusinessCardList(nextCards);
    setPreviewAsset((current) => (current?.id === asset.id ? asset : current));
    if (options?.deferShareSync) {
      void syncSavedBusinessCardAssetInBackground({
        asset,
        refreshFrontImage: shouldRefreshFrontImage,
        expectedFrontSignature: buildBusinessCardFrontRenderSignature(asset),
        syncGeneration,
        draftRevision: savedDraftRevision,
      }).catch(() => undefined);
    }
    return asset;
  }

  async function copyCardImage(card: MerchantBusinessCardAsset) {
    try {
      await copyImageToClipboard(card.imageUrl);
      setTip("名片图片已复制，可直接发送");
    } catch {
      setTip("复制失败，请重试");
    }
  }

  async function copyCardLink(card: MerchantBusinessCardAsset) {
    if (copyingLinkCardId === card.id) return;
    const targetUrl = normalizeText(card.targetUrl);
    if (!targetUrl) {
      setTip("当前名片没有可复制的网站链接");
      return;
    }
    const readyShareUrl = normalizeText(card.shareKey) ? resolveCardShortLink(card) : "";
    if (readyShareUrl) {
      try {
        await copyTextToClipboard(readyShareUrl);
        setTip("联系卡链接已复制，手机打开后可保存联系人");
      } catch {
        setTip("浏览器阻止自动复制，请手动复制上方短链");
      }
      return;
    }

    setTip("正在生成联系卡链接...");
    setCopyingLinkCardId(card.id);
    try {
      const { shareUrl, shareKey } = await buildShareBundle({
        targetUrl,
        cardName: normalizeText(card.name),
        shareKey: normalizeText(card.shareKey),
        allowLegacyFallback: false,
        card,
        contactPageImageUrl: normalizeText(card.contactPageImageUrl),
        contactPageImageHeight: card.contactPageImageHeight,
        contactPageImageLinkUrl: normalizeText(card.contactPageImageLinkUrl),
        contactPageImageX: card.contactPageImageX,
        contactPageImageY: card.contactPageImageY,
        contactPageImageScale: card.contactPageImageScale,
        contactPageImageOpacity: card.contactPageImageOpacity,
        introVideoUrl: normalizeText(card.contactIntroVideoUrl),
        introVideoPosterUrl: normalizeText(card.contactIntroVideoPosterUrl),
        introVideoMuted: card.contactIntroVideoMuted,
        contactPageSectionOrder: card.contactPageSectionOrder,
        showContactSaveButton: card.showContactSaveButton,
        showContactWebsiteButton: card.showContactWebsiteButton,
        imageWidth: card.width,
        imageHeight: card.height,
        contact: buildShareContactPayload({
          name: card.name,
          title: card.title,
          contacts: card.contacts,
          invoice: card.invoice,
          contactFieldOrder: card.contactFieldOrder,
          contactDisplayFields: card.contactDisplayFields,
          customContactLinks: card.customContactLinks,
          targetUrl,
        }),
      });
      const linkToCopy =
        normalizeText(shareKey)
          ? buildMerchantBusinessCardShareUrl({
              shareKey,
              targetUrl,
            })
          : shareUrl;
      const linkVerified = await verifyShortBusinessCardShareLink(linkToCopy);
      try {
        await copyTextToClipboard(linkToCopy);
        setTip(linkVerified ? "联系卡链接已复制，手机打开后可保存联系人" : "联系卡链接已复制，短链可能仍在同步，请稍后打开");
      } catch {
        setTip("浏览器阻止自动复制，请手动复制上方短链");
      }
      return;
    } catch {
      setTip("短链生成失败，请重试");
    } finally {
      setCopyingLinkCardId((current) => (current === card.id ? null : current));
    }
  }

  function buildShareContactPayload(input: {
    name: string;
    title: string;
    contacts: MerchantBusinessCardDraft["contacts"];
    invoice: MerchantBusinessCardDraft["invoice"];
    contactFieldOrder: MerchantBusinessCardDraft["contactFieldOrder"];
    contactDisplayFields: MerchantBusinessCardDraft["contactDisplayFields"];
    customContactLinks?: MerchantBusinessCardCustomContactLink[];
    targetUrl: string;
  }) {
    const orderedKeys = normalizeMerchantBusinessCardContactFieldOrder(input.contactFieldOrder);
    const contactOnlyFields = {
      ...(isContactFieldVisibleOnBusinessCard(input.contactDisplayFields, "merchantName") === false &&
      isContactFieldVisibleOnContactCard(input.contactDisplayFields, "merchantName")
        ? { merchantName: true }
        : {}),
      ...Object.fromEntries(
        orderedKeys
          .filter(
            (key) =>
              isContactFieldVisibleOnBusinessCard(input.contactDisplayFields, key) === false &&
              isContactFieldVisibleOnContactCard(input.contactDisplayFields, key),
          )
          .map((key) => [key, true]),
      ),
    } as Partial<MerchantBusinessCardDraft["contactOnlyFields"]>;
    const extraPhoneLines = normalizePhoneList(input.contacts.phones ?? [])
      .slice(1)
      .map((value, index) => `${index === 0 ? "工作" : `工作${index + 1}`}: ${value}`);
    const socialLines = orderedKeys
      .filter((key) => key !== "contactName" && key !== "phone" && key !== "email" && key !== "address")
      .map((key) => {
        const normalizedValue = normalizeText(input.contacts[key]);
        return normalizedValue ? `${CONTACT_FIELD_LABELS[key]}: ${normalizedValue}` : "";
      })
      .filter(Boolean);
    const primaryPhone =
      normalizePhoneList(input.contacts.phones ?? [input.contacts.phone])[0] || normalizeText(input.contacts.phone);

    return {
      displayName: normalizeText(input.contacts.contactName) || normalizeText(input.name),
      organization: normalizeText(input.name),
      title: normalizeText(input.title),
      phone: primaryPhone,
      phones: normalizePhoneList(input.contacts.phones ?? []),
      email: normalizeText(input.contacts.email),
      address: normalizeText(input.contacts.address),
      invoiceName: normalizeText(input.invoice.name),
      invoiceTaxNumber: normalizeText(input.invoice.taxNumber),
      invoiceAddress: normalizeText(input.invoice.address),
      wechat: normalizeText(input.contacts.wechat),
      whatsapp: normalizeText(input.contacts.whatsapp),
      twitter: normalizeText(input.contacts.twitter),
      weibo: normalizeText(input.contacts.weibo),
      telegram: normalizeText(input.contacts.telegram),
      linkedin: normalizeText(input.contacts.linkedin),
      discord: normalizeText(input.contacts.discord),
      facebook: normalizeText(input.contacts.facebook),
      instagram: normalizeText(input.contacts.instagram),
      tiktok: normalizeText(input.contacts.tiktok),
      douyin: normalizeText(input.contacts.douyin),
      xiaohongshu: normalizeText(input.contacts.xiaohongshu),
      googleReview: normalizeText(input.contacts.googleReview),
      contactFieldOrder: orderedKeys,
      customLinks: input.customContactLinks ?? [],
      ...(Object.keys(contactOnlyFields).length > 0 ? { contactOnlyFields } : {}),
      contactDisplayFields: input.contactDisplayFields,
      websiteUrl: normalizeText(input.targetUrl),
      note: [...extraPhoneLines, ...socialLines].join("\n"),
    };
  }

}

function getCustomTextSelectionKey(id: string) {
  return `${CUSTOM_TEXT_PREFIX}${id}`;
}

function getCustomTextIdFromSelectionKey(value: string) {
  return value.startsWith(CUSTOM_TEXT_PREFIX) ? value.slice(CUSTOM_TEXT_PREFIX.length) : "";
}

function getCustomTextLabel(text: string, index: number) {
  const normalized = normalizeText(text);
  return normalized ? normalized.slice(0, 12) : `自定义文本 ${index + 1}`;
}

