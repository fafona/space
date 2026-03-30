"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { toPng } from "html-to-image";
import QRCode from "qrcode";
import {
  MERCHANT_BUSINESS_CARD_RATIO_OPTIONS,
  MERCHANT_BUSINESS_CARD_PHONE_LIMIT,
  applyMerchantBusinessCardContactFieldOrderToTextLayout,
  createDefaultMerchantBusinessCardDraft,
  getMerchantBusinessCardRequiredFields,
  normalizeMerchantBusinessCardDraft,
  normalizeMerchantBusinessCardContactFieldOrder,
  type MerchantBusinessCardAsset,
  type MerchantBusinessCardContactDisplayKey,
  type MerchantBusinessCardCustomText,
  type MerchantBusinessCardDraft,
  type MerchantBusinessCardFieldKey,
  type MerchantBusinessCardMode,
  type MerchantBusinessCardProfileInput,
} from "@/lib/merchantBusinessCards";
import { ColorOrGradientPicker, ColorSwatchPalette } from "@/components/admin/ColorOrGradientPicker";
import {
  buildMerchantBusinessCardShareUrl,
  buildMerchantBusinessCardContactDownloadUrl,
  buildMerchantBusinessCardLegacyContactDownloadUrl,
  normalizeMerchantBusinessCardShareImageUrl,
  resolveMerchantBusinessCardShareOrigin,
  type MerchantBusinessCardShareContact,
} from "@/lib/merchantBusinessCardShare";
import { recoverBrowserSupabaseSession } from "@/lib/authSessionRecovery";
import { uploadImageDataUrlToPublicStorage } from "@/lib/publicAssetUpload";
import { buildMerchantDomain } from "@/lib/siteRouting";
import { supabase } from "@/lib/supabase";

type MerchantBusinessCardManagerProps = {
  siteBaseDomain: string;
  profile: MerchantBusinessCardProfileInput;
  cards: MerchantBusinessCardAsset[];
  cardLimit?: number;
  allowLinkMode?: boolean;
  backgroundImageLimitKb?: number;
  contactPageImageLimitKb?: number;
  exportImageLimitKb?: number;
  onCardsChange: (cards: MerchantBusinessCardAsset[]) => void;
};

type MerchantBusinessCardEditableContactFieldKey = MerchantBusinessCardContactDisplayKey;

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
];

const CONTACT_FIELD_LABELS = Object.fromEntries(CONTACT_FIELDS.map((item) => [item.key, item.label])) as Record<
  MerchantBusinessCardEditableContactFieldKey,
  string
>;

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
const FONT_SIZE_OPTIONS = [12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72, 80];
const TYPOGRAPHY_FONT_SIZE_INPUT_KEY = "merchant-business-card-typography-font-size";
const QR_MIN_READABLE_SIZE = 96;
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

function formatOpacityPercent(value: number) {
  return `${Math.round(clamp(value, 0, 1) * 100)}%`;
}

function getCardModeLabel(mode: MerchantBusinessCardMode) {
  return mode === "link" ? "链接模式" : "图片模式";
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

function createShareKey() {
  return createId("card").toLowerCase();
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
  return new Blob([await sourceBlob.arrayBuffer()], {
    type: "image/png",
  });
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

function buildInitialImageCompressionPlan(sourceBytes: number, limitBytes: number) {
  const ratio = clamp(limitBytes / Math.max(sourceBytes, 1), 0.05, 1);
  if (ratio >= 0.72) {
    return {
      scale: 1,
      quality: clamp(ratio * 0.96, 0.68, 0.92),
    };
  }
  return {
    scale: clamp(Math.sqrt(ratio / 0.84) * 0.99, 0.16, 1),
    quality: 0.84,
  };
}

function refineImageCompressionPlan(
  previous: { scale: number; quality: number },
  candidateBytes: number,
  limitBytes: number,
) {
  const ratio = clamp(limitBytes / Math.max(candidateBytes, 1), 0.05, 1);
  return {
    scale: clamp(previous.scale * Math.sqrt(ratio) * 0.98, 0.12, 1),
    quality: clamp(Math.min(previous.quality * ratio * 1.04, previous.quality), 0.42, 0.92),
  };
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
    return { blob, dataUrl: "", bytes: blob.size };
  }
  const dataUrl = canvas.toDataURL("image/webp", quality);
  return { blob: null, dataUrl, bytes: estimateDataUrlBytes(dataUrl) };
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
  let plan = buildInitialImageCompressionPlan(originalBytes || limitBytes + 1, limitBytes);
  let bestCandidate:
    | {
        blob: Blob | null;
        dataUrl: string;
        bytes: number;
      }
    | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await yieldToBrowser();
    const candidate = await renderCompressedImageCandidate(image, plan.scale, plan.quality);
    if (!bestCandidate || candidate.bytes < bestCandidate.bytes) {
      bestCandidate = candidate;
    }
    if (candidate.bytes <= limitBytes) {
      const finalized = await finalizeCompressedImageCandidate(candidate);
      return {
        dataUrl: finalized.dataUrl,
        compressed: true,
        bytes: finalized.bytes,
      };
    }
    plan = refineImageCompressionPlan(plan, candidate.bytes, limitBytes);
  }

  if (bestCandidate) {
    const finalized = await finalizeCompressedImageCandidate(bestCandidate);
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

function estimateDataUrlBytes(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] ?? "";
  if (!base64) {
    return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(dataUrl).length : dataUrl.length;
  }
  return Math.max(0, Math.floor((base64.length * 3) / 4));
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

function looksLikeMobileBrowser() {
  if (typeof navigator === "undefined") return false;
  return /android|iphone|ipad|ipod|mobile|micromessenger|wechat/i.test(navigator.userAgent);
}

function parseDownloadFileName(contentDisposition: string | null, fallback: string) {
  const utf8Match = contentDisposition?.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return fallback;
    }
  }
  const asciiMatch = contentDisposition?.match(/filename="([^"]+)"/i);
  if (asciiMatch?.[1]) {
    return asciiMatch[1];
  }
  return fallback;
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
  return key === "phone" ? buildPhoneContactValue(contacts) : normalizeText(contacts[key]);
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
}: {
  draft: MerchantBusinessCardDraft;
  websiteUrl: string;
  qrCodeUrl: string;
  scale: number;
  renderMode?: "preview" | "export";
}) {
  const isExport = renderMode === "export";
  const orderedContactFields = getOrderedContactFields(draft.contactFieldOrder);
  const contacts = orderedContactFields.map(({ key, label }) => {
    const value = resolveContactDisplayValue(draft.contacts, key);
    if (!value || draft.contactOnlyFields[key]) return null;
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
          borderRadius: "28px",
          border: isExport ? "none" : "1px solid rgba(15,23,42,.12)",
          background: "transparent",
          boxShadow: isExport ? "none" : "0 24px 60px rgba(15,23,42,.18)",
        }}
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
            className="absolute inset-0 h-full w-full object-cover"
            style={{ opacity: draft.backgroundImageOpacity }}
          />
        ) : null}
        {isExport ? null : <div className="absolute inset-0 bg-white/12" />}
        {TEXT_LAYOUT_FIELDS.filter(
          ({ key }) =>
            key === "merchantName" ||
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
      </div>
    </div>
  );
}

function buildContactPreviewRows(
  name: string,
  contacts: MerchantBusinessCardDraft["contacts"],
  contactFieldOrder: MerchantBusinessCardDraft["contactFieldOrder"],
) {
  const phoneValues = normalizePhoneList(Array.isArray(contacts.phones) ? contacts.phones : []);
  const primaryPhone = phoneValues[0] || normalizeText(contacts.phone);
  return getOrderedContactFields(contactFieldOrder)
    .flatMap(({ key, label }) => {
      if (key === "phone") {
        return [
          primaryPhone ? { label: "电话", value: primaryPhone } : null,
          ...phoneValues
            .slice(primaryPhone ? 1 : 0)
            .map((value, index) => ({ label: index === 0 ? "工作" : `工作${index + 1}`, value })),
        ].filter((item): item is { label: string; value: string } => !!item);
      }

      const value =
        key === "contactName"
          ? normalizeText(contacts.contactName) || normalizeText(name)
          : normalizeText(contacts[key]);
      return value ? [{ label, value }] : [];
    });
}

function ContactCardSurface({
  name,
  targetUrl,
  contacts,
  contactFieldOrder,
  imageUrl,
  imageHeight,
}: {
  name: string;
  targetUrl: string;
  contacts: MerchantBusinessCardDraft["contacts"];
  contactFieldOrder: MerchantBusinessCardDraft["contactFieldOrder"];
  imageUrl?: string;
  imageHeight: number;
}) {
  const rows = buildContactPreviewRows(name, contacts, contactFieldOrder);
  const displayName = normalizeText(name) || "未命名名片";
  const hasImage = Boolean(normalizeText(imageUrl));
  const domainLabel = normalizeText(targetUrl).replace(/^https?:\/\//i, "");

  return (
    <div className="mx-auto w-full max-w-[430px] rounded-[32px] border border-white/70 bg-white/95 p-5 shadow-[0_28px_90px_rgba(15,23,42,.12)]">
      <div className="mb-4 text-center">
        <div className="text-[11px] font-medium uppercase tracking-[0.24em] text-slate-400">FAOLLA CARD</div>
        <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{displayName}</div>
      </div>

      {hasImage ? (
        <div
          className="overflow-hidden rounded-[28px] border border-slate-200 bg-slate-50 shadow-[0_16px_42px_rgba(15,23,42,.08)]"
          style={{ height: `${imageHeight}px` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt={displayName} className="block h-full w-full object-cover" />
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className={`rounded-[28px] border border-slate-200 bg-slate-50 p-5 shadow-[0_16px_42px_rgba(15,23,42,.08)] ${hasImage ? "mt-5" : ""}`}>
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

      <div className="mt-5 flex gap-3">
        <button
          type="button"
          className="flex-1 cursor-default rounded-full bg-slate-900 px-5 py-3 text-base font-semibold text-white"
        >
          一键保存到通讯录
        </button>
        <button
          type="button"
          className="rounded-full border border-slate-300 bg-white px-5 py-3 text-base font-medium text-slate-900"
        >
          打开网页
        </button>
      </div>

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
  disabled = false,
  onChange,
}: {
  label: string;
  statusText: string;
  detailText?: string;
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
          <input type="file" accept="image/*" className="sr-only" onChange={onChange} disabled={disabled} />
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

export default function MerchantBusinessCardManager({
  siteBaseDomain,
  profile,
  cards,
  cardLimit = 1,
  allowLinkMode = true,
  backgroundImageLimitKb = 300,
  contactPageImageLimitKb = 300,
  exportImageLimitKb = 400,
  onCardsChange,
}: MerchantBusinessCardManagerProps) {
  const [draft, setDraft] = useState(() => createDefaultMerchantBusinessCardDraft(profile));
  const [draftShareKey, setDraftShareKey] = useState(() => createShareKey());
  const [editorOpen, setEditorOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<MerchantBusinessCardAsset | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [deletingCardId, setDeletingCardId] = useState<string | null>(null);
  const [tip, setTip] = useState("");
  const [hasPreviewed, setHasPreviewed] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
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
  const hiddenPreviewRef = useRef<HTMLDivElement | null>(null);

  const missingFields = useMemo(() => getMerchantBusinessCardRequiredFields(profile), [profile]);
  const canCreate = missingFields.length === 0;
  const websiteUrl = useMemo(
    () => buildMerchantDomain(siteBaseDomain, normalizeText(profile.domainPrefix), "https"),
    [siteBaseDomain, profile.domainPrefix],
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
    : draft.fieldTypography[primarySelectedFieldKey as MerchantBusinessCardFieldKey];
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
  const requiresPreviewBeforeSave = !editingCardId && !hasPreviewed;
  const qrMayBeUnreadable = draft.qr.size < QR_MIN_READABLE_SIZE;
  const qrReadyForCurrentDraft = !draft.showQr || !!qrCodeUrl;
  const cardLimitReached = !editingCardId && cards.length >= normalizedCardLimit;
  const canOpenCreateEditor = canCreate && !cardLimitReached;
  const normalizedBackgroundImageLimitKb = useMemo(
    () => Math.max(50, Math.min(5000, Math.round(Number(backgroundImageLimitKb) || 300))),
    [backgroundImageLimitKb],
  );
  const normalizedContactPageImageLimitKb = useMemo(
    () => Math.max(50, Math.min(5000, Math.round(Number(contactPageImageLimitKb) || 300))),
    [contactPageImageLimitKb],
  );
  const normalizedExportImageLimitKb = useMemo(
    () => Math.max(50, Math.min(5000, Math.round(Number(exportImageLimitKb) || 400))),
    [exportImageLimitKb],
  );
  const editingCard = useMemo(
    () => (editingCardId ? cards.find((card) => card.id === editingCardId) ?? null : null),
    [cards, editingCardId],
  );
  const canUseDraftLinkMode = allowLinkMode || editingCard?.mode === "link";
  const activeLinkShareKey = useMemo(() => {
    if (draft.mode !== "link") return "";
    return normalizeText(editingCard?.shareKey) || normalizeText(draftShareKey) || "";
  }, [draft.mode, draftShareKey, editingCard]);
  const draftLinkUrl = useMemo(() => {
    if (draft.mode !== "link" || !websiteUrl) return "";
    return buildMerchantBusinessCardShareUrl({
      origin: resolveMerchantBusinessCardShareOrigin(undefined, websiteUrl),
      shareKey: activeLinkShareKey,
      targetUrl: websiteUrl,
      name: normalizeText(draft.name) || "商户名片",
      contact: buildShareContactPayload({
        name: draft.name,
        title: draft.title,
        contacts: draft.contacts,
        contactFieldOrder: draft.contactFieldOrder,
        contactOnlyFields: draft.contactOnlyFields,
        targetUrl: websiteUrl,
      }),
    });
  }, [activeLinkShareKey, draft.contactFieldOrder, draft.contactOnlyFields, draft.contacts, draft.mode, draft.name, draft.title, websiteUrl]);
  const qrTargetUrl = draft.mode === "link" ? draftLinkUrl || websiteUrl : websiteUrl;

  useEffect(() => {
    clearNumberInputDraft(TYPOGRAPHY_FONT_SIZE_INPUT_KEY);
  }, [primarySelectedFieldKey, selectedTypographyFontSize]);

  useEffect(() => {
    if (!tip) return;
    const timer = window.setTimeout(() => setTip(""), 2600);
    return () => window.clearTimeout(timer);
  }, [tip]);

  useEffect(() => {
    let cancelled = false;
    if (!qrTargetUrl) {
      setQrCodeUrl("");
      return;
    }
    void QRCode.toDataURL(qrTargetUrl, { width: clamp(draft.qr.size * 2, 96, 1200), margin: 1, errorCorrectionLevel: "M" })
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
    setDraft((current) => normalizeMerchantBusinessCardDraft({ ...current, mode: "image" }));
    setHasPreviewed(false);
    setPreviewAsset(null);
  }, [canUseDraftLinkMode, draft.mode]);

  const applyDraft = (recipe: (current: MerchantBusinessCardDraft) => MerchantBusinessCardDraft) => {
    setDraft((current) => normalizeMerchantBusinessCardDraft(recipe(current)));
    setHasPreviewed(false);
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
    const nextDraft = createDefaultMerchantBusinessCardDraft(profile);
    setDraft(nextDraft);
    setContactPhoneEditorValues(resolveDraftPhoneValues(nextDraft.contacts));
    setBackgroundImageFileName("");
    setBackgroundImageFileDetail("");
    setIsBackgroundImageProcessing(false);
    setContactPageImageFileName("");
    setContactPageImageFileDetail("");
    setIsContactPageImageProcessing(false);
    setDraftShareKey(createShareKey());
    setSelectedFieldKeys(["merchantName"]);
    setEditingCardId(null);
    setHasPreviewed(false);
    setPreviewAsset(null);
    setPreviewOpen(false);
    setEditorOpen(true);
  };

  const openEditorForCard = (card: MerchantBusinessCardAsset) => {
    if (!canCreate) return;
    const nextDraft = normalizeMerchantBusinessCardDraft(card);
    setDraft(nextDraft);
    setContactPhoneEditorValues(resolveDraftPhoneValues(nextDraft.contacts));
    setBackgroundImageFileName("");
    setBackgroundImageFileDetail("");
    setIsBackgroundImageProcessing(false);
    setContactPageImageFileName("");
    setContactPageImageFileDetail("");
    setIsContactPageImageProcessing(false);
    setDraftShareKey(normalizeText(card.shareKey) || createShareKey());
    setSelectedFieldKeys(["merchantName"]);
    setEditingCardId(card.id);
    setHasPreviewed(true);
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
      applyDraft((current) => ({ ...current, backgroundImageUrl: optimized.dataUrl }));
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

  const handleGenerate = async () => {
    if (!websiteUrl || !qrReadyForCurrentDraft || requiresPreviewBeforeSave) return;
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
        setTip(`导出名片图片不能超过 ${normalizedExportImageLimitKb} KB，请调整内容或背景后再试`);
      } else if (error instanceof Error && error.message === "share_auth_unavailable") {
        setTip("登录状态还没准备好，请刷新后台后再试一次");
      } else if (error instanceof Error && error.message === "share_request_timeout") {
        setTip("生成超时，请稍后重试");
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
      applyDraft((current) => ({ ...current, contactPageImageUrl: imageUrl }));
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

  const updateContactOnlyField = (
    key: keyof MerchantBusinessCardDraft["contactOnlyFields"],
    checked: boolean,
  ) => {
    applyDraft((current) => ({
      ...current,
      contactOnlyFields: {
        ...current.contactOnlyFields,
        [key]: checked,
      },
    }));
  };

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
      targetUrl,
      imageWidth: card.width,
      imageHeight: card.height,
      contact: buildShareContactPayload({
        name: card.name,
        title: card.title,
        contacts: card.contacts,
        contactFieldOrder: card.contactFieldOrder,
        contactOnlyFields: card.contactOnlyFields,
        targetUrl,
      }),
    };
  }

  async function deleteCardShare(card: MerchantBusinessCardAsset) {
    const shareKey = normalizeText(card.shareKey);
    const legacyPayload = buildLegacySharePayload(card);
    if (card.mode !== "link") {
      return;
    }
    if (!shareKey && !legacyPayload) {
      throw new Error("share_delete_failed");
    }

    const initialAccessToken = await getShareAccessToken();
    let lastErrorCode = "";

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const accessToken = attempt === 0 ? initialAccessToken : await getShareAccessToken();
        const headers: Record<string, string> = {
          "content-type": "application/json",
        };
        if (accessToken) {
          headers.Authorization = `Bearer ${accessToken}`;
        }

        const response = await fetchWithTimeout(
          "/api/business-card-share",
          {
            method: "DELETE",
            headers,
            credentials: "same-origin",
            body: JSON.stringify({
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
        if (attempt === 0 && (response.status === 401 || lastErrorCode === "unauthorized")) {
          await recoverBrowserSupabaseSession(9000).catch(() => null);
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
    try {
      await deleteCardShare(card);

      const nextCards = cards.filter((item) => item.id !== card.id);
      onCardsChange(nextCards);
      if (previewAsset?.id === card.id) {
        setPreviewAsset(null);
        setPreviewOpen(false);
      }
      if (editingCardId === card.id) {
        setEditingCardId(null);
        setEditorOpen(false);
        setDraft(createDefaultMerchantBusinessCardDraft(profile));
        setHasPreviewed(false);
      }
      setTip(card.mode === "link" ? "名片已删除，二维码和联系卡链接已失效" : "名片已删除");
    } catch (error) {
      if (error instanceof Error && error.message === "share_delete_unauthorized") {
        setTip("登录状态失效，联系卡链接未删除，请重新登录后重试");
      } else if (error instanceof Error && error.message === "share_delete_timeout") {
        setTip("删除超时，二维码和联系卡链接暂未失效，请稍后重试");
      } else if (card.mode === "link") {
        setTip("删除失败，二维码和联系卡链接未失效，请重试");
      } else {
        setTip("删除失败，请重试");
      }
    } finally {
      setDeletingCardId((current) => (current === card.id ? null : current));
    }
  };

  const previewMode = previewAsset?.mode || draft.mode;
  const previewTargetUrl = normalizeText(previewAsset?.targetUrl) || websiteUrl;
  const previewName = normalizeText(previewAsset?.name) || normalizeText(draft.name) || "名片预览";
  const previewTitle = normalizeText(previewAsset?.title) || normalizeText(draft.title);
  const previewContacts = previewAsset?.contacts || draft.contacts;
  const previewContactFieldOrder = previewAsset?.contactFieldOrder || draft.contactFieldOrder;
  const previewContactImageUrl =
    normalizeText(previewAsset?.contactPagePublicImageUrl) ||
    normalizeText(previewAsset?.contactPageImageUrl) ||
    normalizeText(draft.contactPageImageUrl);
  const previewContactImageHeight = previewAsset?.contactPageImageHeight || draft.contactPageImageHeight;
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

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
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
              <span className="text-sm font-medium text-slate-500">{`${cards.length}/${normalizedCardLimit}`}</span>
            </span>
            <span className="mt-1.5 block text-xs leading-5 text-slate-500">
              完善商户信息后可生成名片。链接模式会生成联系卡链接，对方手机打开后可保存联系人。
            </span>
          </span>
        </button>
      </div>
      {!canCreate ? <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">{`需先完善以下商户信息后才能生成名片：${missingFields.join(" / ")}`}</div> : null}
      {canCreate && cardLimitReached ? <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">{`名片夹已达到上限（${normalizedCardLimit} 张），请先删除旧名片，或到超级后台调整名片夹数量限制。`}</div> : null}
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
              <div><div className="text-lg font-semibold text-slate-900">{editingCardId ? "修改名片" : "生成名片"}</div><div className="text-sm text-slate-500">先选择图片模式或链接模式，再调整样式并预览生成。</div></div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50" onClick={() => { setPreviewAsset(null); setHasPreviewed(true); setPreviewOpen(true); }}>预览</button>
                <button type="button" className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50" onClick={() => { setEditorOpen(false); setEditingCardId(null); }}>关闭</button>
              </div>
            </div>
            <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(520px,680px)]">
              <div className="min-h-0 overflow-y-auto px-4 py-4">
                <div className="grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                  <section className="space-y-2.5 rounded-xl border bg-slate-50 p-3 xl:col-span-2">
                    <div className="text-sm font-semibold text-slate-900">基础设置</div>
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
                      <label className="block text-xs text-slate-600">名片名称<input className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm" value={draft.name} onFocus={() => setSingleSelectedField("merchantName")} onChange={(event) => applyDraft((current) => ({ ...current, name: event.target.value }))} /></label>
                      <label className="block text-xs text-slate-600">职位<input className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm" value={draft.title} onFocus={() => setSingleSelectedField("title")} onChange={(event) => applyDraft((current) => ({ ...current, title: event.target.value }))} /></label>
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="block text-xs text-slate-600">比例<select className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm" value={draft.ratioMode} onChange={(event) => applyDraft((current) => ({ ...current, ratioMode: event.target.value as MerchantBusinessCardDraft["ratioMode"], ...(() => resolveRatioDimensions(event.target.value as MerchantBusinessCardDraft["ratioMode"], current.width, current.height))() }))}>{MERCHANT_BUSINESS_CARD_RATIO_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}<option value="custom">自定义</option></select></label>
                      <label className="block text-xs text-slate-600">
                        宽度
                        <input
                          type="number"
                          inputMode="numeric"
                          step={1}
                          min={320}
                          max={1600}
                          className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm"
                          value={getNumberInputValue("card-width", draft.width)}
                          onChange={(event) =>
                            handleNumberInputChange("card-width", event.target.value, draft.width, 320, 1600, (value) =>
                              handleSize(value, "width"),
                            )
                          }
                          onBlur={() => commitNumberInput("card-width", draft.width, 320, 1600, (value) => handleSize(value, "width"))}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                          }}
                        />
                      </label>
                      <label className="block text-xs text-slate-600">
                        高度
                        <input
                          type="number"
                          inputMode="numeric"
                          step={1}
                          min={180}
                          max={1600}
                          className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm"
                          value={getNumberInputValue("card-height", draft.height)}
                          onChange={(event) =>
                            handleNumberInputChange("card-height", event.target.value, draft.height, 180, 1600, (value) =>
                              handleSize(value, "height"),
                            )
                          }
                          onBlur={() => commitNumberInput("card-height", draft.height, 180, 1600, (value) => handleSize(value, "height"))}
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
                            <ImageFilePicker
                              label="背景图"
                              statusText={backgroundImagePickerStatus}
                              detailText={backgroundImagePickerDetail}
                              disabled={isBackgroundImageProcessing}
                              onChange={(event) => void handleBackgroundUpload(event)}
                            />
                            <div className="mt-1 text-[11px] text-slate-400">默认上限 {normalizedBackgroundImageLimitKb} KB，超过上限时会自动压缩到限制内。</div>
                          </div>
                          <label className="block text-xs text-slate-600">图片透明度<div className="mt-1 flex items-center gap-3 rounded border bg-white px-3 py-2"><input type="range" min="0" max="1" step="0.01" className="min-w-0 flex-1" value={draft.backgroundImageOpacity} onChange={(event) => applyDraft((current) => ({ ...current, backgroundImageOpacity: clamp(Number(event.target.value), 0, 1) }))} /><span className="w-12 shrink-0 text-right text-xs text-slate-500">{formatOpacityPercent(draft.backgroundImageOpacity)}</span></div></label>
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
                              applyDraft((current) => ({ ...current, contactPageImageUrl: "" }));
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
                  </section>
                  <section className="space-y-2.5 rounded-xl border bg-slate-50 p-3 xl:col-span-2">
                    <div className="text-sm font-semibold text-slate-900">联系方式</div>
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
                                    <div className="text-xs font-medium text-slate-700">
                                      {phoneIndex === 0
                                        ? `电话（最多 ${MERCHANT_BUSINESS_CARD_PHONE_LIMIT} 个）`
                                        : phoneIndex === 1
                                          ? "工作电话"
                                          : `电话${phoneIndex + 1}`}
                                    </div>
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
                                      <button
                                        type="button"
                                        className="rounded border bg-white px-2 py-1 text-[11px] whitespace-nowrap hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                        onClick={() => moveContactField(key, "up")}
                                        disabled={!canMoveUp}
                                      >
                                        上移
                                      </button>
                                    ) : (
                                      <div className="hidden md:block" />
                                    )}
                                    {phoneIndex === 0 ? (
                                      <button
                                        type="button"
                                        className="rounded border bg-white px-2 py-1 text-[11px] whitespace-nowrap hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                        onClick={() => moveContactField(key, "down")}
                                        disabled={!canMoveDown}
                                      >
                                        下移
                                      </button>
                                    ) : (
                                      <div className="hidden md:block" />
                                    )}
                                    {phoneIndex === 0 ? (
                                      <label className="flex items-center gap-1.5 whitespace-nowrap rounded border bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-700">
                                        <input
                                          type="checkbox"
                                          checked={draft.contactOnlyFields[key]}
                                          onChange={(event) => updateContactOnlyField(key, event.target.checked)}
                                        />
                                        仅联系卡展示
                                      </label>
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
                                <div className="text-xs font-medium text-slate-700">{label}</div>
                                <input
                                  className="min-w-0 rounded border bg-white px-3 py-2 text-sm"
                                  value={draft.contacts[key]}
                                  onFocus={() => setSingleSelectedField(key)}
                                  onChange={(event) =>
                                    applyDraft((current) => ({ ...current, contacts: { ...current.contacts, [key]: event.target.value } }))
                                  }
                                  placeholder={`请输入${label}`}
                                />
                                <button
                                  type="button"
                                  className="rounded border bg-white px-2 py-1 text-[11px] whitespace-nowrap hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                  onClick={() => moveContactField(key, "up")}
                                  disabled={!canMoveUp}
                                >
                                  上移
                                </button>
                                <button
                                  type="button"
                                  className="rounded border bg-white px-2 py-1 text-[11px] whitespace-nowrap hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                  onClick={() => moveContactField(key, "down")}
                                  disabled={!canMoveDown}
                                >
                                  下移
                                </button>
                                <label className="flex items-center gap-1.5 whitespace-nowrap rounded border bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-700">
                                  <input
                                    type="checkbox"
                                    checked={draft.contactOnlyFields[key]}
                                    onChange={(event) => updateContactOnlyField(key, event.target.checked)}
                                  />
                                  仅联系卡展示
                                </label>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                  <section className="space-y-2.5 rounded-xl border bg-slate-50 p-3 xl:col-span-2">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-slate-900">自定义文本</div>
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
                              <button type="button" className="rounded border border-rose-200 bg-white px-2 py-1 text-xs text-rose-600 hover:bg-rose-50" onClick={() => removeCustomText(item.id)}>删除</button>
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
                  </section>
                  <section className="space-y-3 rounded-xl border bg-slate-50 p-3 xl:col-span-2">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                        <div className="text-sm font-semibold text-slate-900">位置与字体样式</div>
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
                  </section>
                </div>
              </div>
              <aside className="min-h-0 overflow-y-auto border-l bg-slate-50 px-4 py-4">
                <div className="sticky top-0 space-y-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">实时预览</div>
                    <div className="text-xs text-slate-500">先点击“预览”确认样式，再点击“生成”。</div>
                  </div>
                  <div className="overflow-hidden rounded-2xl border bg-slate-900/5 p-3">
                    <div className="flex justify-center">
                      <CardSurface draft={draft} websiteUrl={websiteUrl} qrCodeUrl={qrCodeUrl} scale={scale} />
                    </div>
                  </div>
                  {draft.mode === "link" ? (
                    <div className="overflow-hidden rounded-2xl border bg-white p-3">
                      <div className="mb-2 text-xs font-semibold text-slate-700">联系卡预览</div>
                      <div className="flex justify-center rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <ContactCardSurface
                          name={normalizeText(draft.name) || "名片预览"}
                          targetUrl={websiteUrl}
                          contacts={draft.contacts}
                          contactFieldOrder={draft.contactFieldOrder}
                          imageUrl={normalizeText(draft.contactPageImageUrl) || undefined}
                          imageHeight={draft.contactPageImageHeight}
                        />
                      </div>
                    </div>
                  ) : null}
                  <div className="rounded-xl border bg-white px-3 py-2 text-xs text-slate-600">
                    {draft.mode === "link"
                      ? "当前为链接模式：二维码和链接都会进入联系卡，对方手机打开后可保存到通讯录。"
                      : "当前为图片模式：生成后可保存或复制名片图片。"}
                  </div>
                  {requiresPreviewBeforeSave ? (
                    <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      先点击“预览”，再生成名片。
                    </div>
                  ) : null}
                </div>
              </aside>
            </div>
          </div>
        </div>,
      ) : null}

      {folderOpen ? overlay(
        <div className="fixed inset-0 z-[2147483000] bg-black/45 p-4" onMouseDown={() => setFolderOpen(false)}>
          <div className="mx-auto flex h-full max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"><div><div className="text-lg font-semibold text-slate-900">名片夹</div><div className="text-sm text-slate-500">查看已生成的图片名片或链接名片，可预览并继续操作。</div></div><div className="flex flex-wrap gap-2"><button type="button" className="rounded bg-black px-3 py-2 text-sm text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50" onClick={openCreateEditorFromFolder} disabled={!canOpenCreateEditor}>生成名片</button><button type="button" className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50" onClick={() => setFolderOpen(false)}>关闭</button></div></div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {cards.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {cards.map((card) => (
                    <article key={card.id} className="overflow-hidden rounded-2xl border bg-slate-50 shadow-sm">
                      <div className="space-y-4 p-4">
                        <button
                          type="button"
                          className="block w-full overflow-hidden rounded-2xl border bg-transparent text-left"
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
                          </div>
                          <div className="text-xs text-slate-500">
                            {new Date(card.createdAt).toLocaleString("zh-CN", { hour12: false })}
                          </div>
                          {card.mode === "link" ? (
                            <div className="mt-1 text-xs text-slate-500">手机打开联系卡链接后可直接保存联系人。</div>
                          ) : null}
                        </div>
                        {card.mode === "link" ? (
                          <div className="space-y-2">
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
                                onClick={() => void copyCardLink(card)}
                              >
                                复制联系卡链接
                              </button>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50"
                                onClick={() => void downloadCardContact(card)}
                              >
                                下载联系人
                              </button>
                              <button
                                type="button"
                                className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50"
                                onClick={() => void copyCardImage(card)}
                              >
                                复制名片图片
                              </button>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
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
              ) : (
                <div className="flex min-h-[240px] items-center justify-center rounded-2xl border border-dashed bg-slate-50 px-6 text-center text-sm text-slate-500">
                  还没有生成名片。请先在上方点击“生成名片”制作一张。
                </div>
              )}
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
                  <div className="flex min-h-full items-center justify-center rounded-3xl border border-white/10 bg-white/5 p-4">
                    {previewAsset ? (
                      /* 预览的是用户刚生成或上传的实际图片资源，这里需要原样展示。 */
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={previewAsset.imageUrl} alt={previewAsset.name} className="block h-auto max-w-full bg-transparent object-contain" />
                    ) : (
                      <CardSurface draft={draft} websiteUrl={websiteUrl} qrCodeUrl={qrCodeUrl} scale={fullScale} />
                    )}
                  </div>
                  <div className="flex min-h-full items-start justify-center rounded-3xl border border-white/10 bg-white/5 p-4">
                    <ContactCardSurface
                      name={previewName}
                      targetUrl={previewTargetUrl}
                      contacts={previewContacts}
                      contactFieldOrder={previewContactFieldOrder}
                      imageUrl={previewContactImageUrl}
                      imageHeight={previewContactImageHeight}
                    />
                  </div>
                </div>
              ) : (
                <div className="mx-auto flex min-h-full items-center justify-center">
                  {previewAsset ? (
                    /* 预览的是用户刚生成或上传的实际图片资源，这里需要原样展示。 */
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={previewAsset.imageUrl} alt={previewAsset.name} className="block h-auto max-w-full bg-transparent object-contain" />
                  ) : (
                    <CardSurface draft={draft} websiteUrl={websiteUrl} qrCodeUrl={qrCodeUrl} scale={fullScale} />
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
                  <button
                    type="button"
                    className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
                    onClick={() => void handleGenerate()}
                    disabled={!websiteUrl || !qrReadyForCurrentDraft || isGenerating || requiresPreviewBeforeSave}
                  >
                    {isGenerating ? (editingCardId ? "保存中..." : "生成中...") : (editingCardId ? "保存修改" : "生成")}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>,
      ) : null}

      {tip ? overlay(<div className="pointer-events-none fixed inset-0 z-[2147483200] flex items-center justify-center p-4"><div className="rounded-lg bg-black/85 px-4 py-2 text-sm text-white shadow-lg">{tip}</div></div>) : null}
    </div>
  );

  function resolveRatioDimensions(
    ratioMode: MerchantBusinessCardDraft["ratioMode"],
    width: number,
    height: number,
  ) {
    if (ratioMode === "custom") return { width, height };
    const ratio = MERCHANT_BUSINESS_CARD_RATIO_OPTIONS.find((item) => item.id === ratioMode);
    if (!ratio) return { width, height };
    return { width, height: Math.max(180, Math.round((width * ratio.height) / ratio.width)) };
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
    return `${safeBaseName}'s card.png`;
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

  async function getShareAccessToken() {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const directToken = String(session?.access_token ?? "").trim();
      if (directToken) return directToken;
    } catch {
      // Fall through to cookie-backed server auth.
    }
    return "";
  }

  function updateCardShareMeta(
    cardId: string,
    patch: Partial<Pick<MerchantBusinessCardAsset, "shareImageUrl" | "shareKey" | "contactPagePublicImageUrl">>,
  ) {
    onCardsChange(
      cards.map((item) =>
        item.id === cardId
          ? {
              ...item,
              ...patch,
            }
          : item,
      ),
    );
  }

  async function resolveShareImageUrl(input: {
    card?: MerchantBusinessCardAsset | null;
    renderedImageUrl?: string;
    cardName?: string;
    targetUrl?: string;
  }) {
    const shareOrigin = resolveMerchantBusinessCardShareOrigin(undefined, input.targetUrl);
    const existingPublicUrl = normalizeMerchantBusinessCardShareImageUrl(
      normalizeText(input.card?.shareImageUrl) || normalizeText(input.card?.imageUrl),
      shareOrigin,
    );
    if (existingPublicUrl) {
      if (input.card && normalizeText(input.card.shareImageUrl) !== existingPublicUrl) {
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
    );
    const publicUrl = normalizeMerchantBusinessCardShareImageUrl(uploadedUrl, shareOrigin);
    if (publicUrl && input.card) {
      updateCardShareMeta(input.card.id, { shareImageUrl: publicUrl });
    }
    return publicUrl;
  }

  async function resolveContactPageImageUrl(input: {
    card?: MerchantBusinessCardAsset | null;
    imageUrl?: string;
    cardName?: string;
    targetUrl?: string;
  }) {
    const shareOrigin = resolveMerchantBusinessCardShareOrigin(undefined, input.targetUrl);
    const existingPublicUrl = normalizeMerchantBusinessCardShareImageUrl(
      normalizeText(input.card?.contactPagePublicImageUrl) || normalizeText(input.imageUrl) || normalizeText(input.card?.contactPageImageUrl),
      shareOrigin,
    );
    if (existingPublicUrl) {
      if (input.card && normalizeText(input.card.contactPagePublicImageUrl) !== existingPublicUrl) {
        updateCardShareMeta(input.card.id, { contactPagePublicImageUrl: existingPublicUrl });
      }
      return existingPublicUrl;
    }

    const sourceImageUrl = normalizeText(input.imageUrl) || normalizeText(input.card?.contactPageImageUrl);
    if (!/^data:image\//i.test(sourceImageUrl)) return "";

    const uploadedUrl = await uploadImageDataUrlToPublicStorage(
      sourceImageUrl,
      sanitizeShareAssetHint(
        `${normalizeText(profile.domainPrefix) || normalizeText(input.cardName) || normalizeText(input.card?.name) || normalizeText(profile.merchantName)}-contact`,
      ),
    );
    const publicUrl = normalizeMerchantBusinessCardShareImageUrl(uploadedUrl, shareOrigin);
    if (publicUrl && input.card) {
      updateCardShareMeta(input.card.id, { contactPagePublicImageUrl: publicUrl });
    }
    return publicUrl;
  }

  async function buildShareBundle(input: {
    targetUrl: string;
    cardName: string;
    shareKey?: string;
    card?: MerchantBusinessCardAsset | null;
    renderedImageUrl?: string;
    contactPageImageUrl?: string;
    contactPageImageHeight?: number;
    imageWidth?: number;
    imageHeight?: number;
    contact?: MerchantBusinessCardShareContact;
  }) {
    const targetUrl = normalizeText(input.targetUrl);
    if (!targetUrl) {
      throw new Error("missing_target");
    }
    const shareImageUrl = await resolveShareImageUrl({
      card: input.card,
      renderedImageUrl: input.renderedImageUrl,
      cardName: input.cardName,
      targetUrl,
    });
    const detailImageUrl = await resolveContactPageImageUrl({
      card: input.card,
      imageUrl: input.contactPageImageUrl,
      cardName: input.cardName,
      targetUrl,
    });
    const fallbackShareUrl = buildMerchantBusinessCardShareUrl({
      origin: resolveMerchantBusinessCardShareOrigin(undefined, targetUrl),
      imageUrl: shareImageUrl,
      detailImageUrl,
      detailImageHeight: input.contactPageImageHeight,
      targetUrl,
      name: input.cardName,
      contact: input.contact,
    });
    const fallbackContactUrl = buildMerchantBusinessCardLegacyContactDownloadUrl({
      origin: resolveMerchantBusinessCardShareOrigin(undefined, targetUrl),
      imageUrl: shareImageUrl,
      detailImageUrl,
      detailImageHeight: input.contactPageImageHeight,
      targetUrl,
      name: input.cardName,
      contact: input.contact,
    });
    if (!shareImageUrl) {
      if (fallbackShareUrl) {
        return {
          shareUrl: fallbackShareUrl,
          contactUrl: fallbackContactUrl,
          shareImageUrl: "",
          detailImageUrl,
          shareKey: "",
        };
      }
      throw new Error("share_image_unavailable");
    }
    const initialAccessToken = await getShareAccessToken();
    let shareUrl = "";
    let shareKey = "";
    let lastErrorCode = "";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const accessToken = attempt === 0 ? initialAccessToken : await getShareAccessToken();
        const headers: Record<string, string> = {
          "content-type": "application/json",
        };
        if (accessToken) {
          headers.Authorization = `Bearer ${accessToken}`;
        }
        const response = await fetchWithTimeout("/api/business-card-share", {
          method: "POST",
          headers,
          credentials: "same-origin",
          body: JSON.stringify({
            key: normalizeText(input.shareKey),
            name: input.cardName,
            imageUrl: shareImageUrl,
            detailImageUrl,
            detailImageHeight:
              typeof input.contactPageImageHeight === "number"
                ? Math.round(input.contactPageImageHeight)
                : undefined,
            targetUrl,
            imageWidth: typeof input.imageWidth === "number" ? Math.round(input.imageWidth) : undefined,
            imageHeight: typeof input.imageHeight === "number" ? Math.round(input.imageHeight) : undefined,
            contact: input.contact,
          }),
        }, attempt === 0 ? 15_000 : 20_000);
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
          break;
        }
        if (attempt === 0 && (response.status === 401 || lastErrorCode === "unauthorized")) {
          await recoverBrowserSupabaseSession(9000).catch(() => null);
          await delay(500);
          continue;
        }
        if (attempt === 0 && response.status >= 500) {
          await delay(400);
          continue;
        }
      } catch (error) {
        lastErrorCode = error instanceof Error && error.name === "AbortError" ? "share_request_timeout" : "share_link_unavailable";
        if (attempt === 0) {
          await delay(400);
          continue;
        }
      }
      shareUrl = "";
      shareKey = "";
      break;
    }
    if (!shareUrl || !shareKey) {
      if (fallbackShareUrl) {
        return {
          shareUrl: fallbackShareUrl,
          contactUrl: fallbackContactUrl,
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
            : "share_link_unavailable",
      );
    }
    if (input.card && (shareKey || shareImageUrl || detailImageUrl)) {
      updateCardShareMeta(input.card.id, {
        ...(shareImageUrl ? { shareImageUrl } : {}),
        ...(shareKey ? { shareKey } : {}),
        ...(detailImageUrl ? { contactPagePublicImageUrl: detailImageUrl } : {}),
      });
    }
    return {
      shareUrl,
      contactUrl:
        buildMerchantBusinessCardContactDownloadUrl({
          shareKey,
          targetUrl,
        }) || fallbackContactUrl,
      shareImageUrl,
      detailImageUrl,
      shareKey,
    };
  }

  async function saveCurrentDraftToFolder() {
    const node = hiddenPreviewRef.current;
    if (!node || !websiteUrl || !qrReadyForCurrentDraft) return null;
    if (!editingCardId && cards.length >= normalizedCardLimit) {
      throw new Error("business_card_limit_reached");
    }

    const imageUrl = await renderCardNodeToImage(node);
    if (estimateDataUrlBytes(imageUrl) > normalizedExportImageLimitKb * 1024) {
      throw new Error("export_image_limit_exceeded");
    }
    const nextDraft = normalizeMerchantBusinessCardDraft(draft);
    const existingCard = editingCardId ? cards.find((card) => card.id === editingCardId) ?? null : null;
    const resolvedShareKey =
      nextDraft.mode === "link"
        ? normalizeText(existingCard?.shareKey) || normalizeText(draftShareKey) || createShareKey()
        : "";
    const shareContactPayload =
      nextDraft.mode === "link"
        ? buildShareContactPayload({
            name: nextDraft.name,
            title: nextDraft.title,
            contacts: nextDraft.contacts,
            contactFieldOrder: nextDraft.contactFieldOrder,
            contactOnlyFields: nextDraft.contactOnlyFields,
            targetUrl: websiteUrl,
          })
        : undefined;
    const shareBundle =
      nextDraft.mode === "link"
        ? await buildShareBundle({
            targetUrl: websiteUrl,
            cardName: normalizeText(nextDraft.name) || "商户名片",
            shareKey: resolvedShareKey,
            card: existingCard,
            renderedImageUrl: imageUrl,
            contactPageImageUrl: normalizeText(nextDraft.contactPageImageUrl),
            contactPageImageHeight: nextDraft.contactPageImageHeight,
            imageWidth: nextDraft.width,
            imageHeight: nextDraft.height,
            contact: shareContactPayload,
          })
        : null;
    if (nextDraft.mode === "link" && !normalizeText(shareBundle?.shareKey)) {
      throw new Error("share_link_unavailable");
    }
    const asset: MerchantBusinessCardAsset = {
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
    };

    onCardsChange(
      existingCard
        ? cards.map((card) => (card.id === existingCard.id ? asset : card))
        : [asset, ...cards],
    );
    setEditingCardId(asset.id);
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
    const targetUrl = normalizeText(card.targetUrl);
    if (!targetUrl) {
      setTip("当前名片没有可复制的网站链接");
      return;
    }
    try {
      const { shareUrl } = await buildShareBundle({
        targetUrl,
        cardName: normalizeText(card.name) || "商户名片",
        shareKey: normalizeText(card.shareKey),
        card,
        contactPageImageUrl: normalizeText(card.contactPageImageUrl),
        imageWidth: card.width,
        imageHeight: card.height,
        contact: buildShareContactPayload({
          name: card.name,
          title: card.title,
          contacts: card.contacts,
          contactFieldOrder: card.contactFieldOrder,
          contactOnlyFields: card.contactOnlyFields,
          targetUrl,
        }),
      });
      await copyTextToClipboard(shareUrl);
      setTip("联系卡链接已复制，手机打开后可保存联系人");
    } catch {
      setTip("复制失败，请重试");
    }
  }

  async function downloadCardContact(card: MerchantBusinessCardAsset) {
    const targetUrl = normalizeText(card.targetUrl);
    if (!targetUrl) {
      setTip("当前名片没有可下载的联系人");
      return;
    }
    try {
      const { contactUrl } = await buildShareBundle({
        targetUrl,
        cardName: normalizeText(card.name) || "商户名片",
        shareKey: normalizeText(card.shareKey),
        card,
        contactPageImageUrl: normalizeText(card.contactPageImageUrl),
        imageWidth: card.width,
        imageHeight: card.height,
        contact: buildShareContactPayload({
          name: card.name,
          title: card.title,
          contacts: card.contacts,
          contactFieldOrder: card.contactFieldOrder,
          contactOnlyFields: card.contactOnlyFields,
          targetUrl,
        }),
      });
      if (!contactUrl) {
        setTip("联系人下载地址生成失败，请重试");
        return;
      }
      await openContactDownload(contactUrl, normalizeText(card.contacts.contactName) || normalizeText(card.name));
      setTip("联系人已开始下载");
    } catch {
      setTip("下载失败，请重试");
    }
  }

  async function openContactDownload(url: string, fallbackName: string) {
    if (looksLikeMobileBrowser()) {
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
      return;
    }

    const response = await fetch(url, {
      credentials: "same-origin",
    });
    if (!response.ok) {
      throw new Error("contact_download_failed");
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = parseDownloadFileName(
      response.headers.get("content-disposition"),
      `${(fallbackName || "contact").replace(/[\\/:*?\"<>|]+/g, "").trim() || "contact"}.vcf`,
    );
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  function buildShareContactPayload(input: {
    name: string;
    title: string;
    contacts: MerchantBusinessCardDraft["contacts"];
    contactFieldOrder: MerchantBusinessCardDraft["contactFieldOrder"];
    contactOnlyFields: MerchantBusinessCardDraft["contactOnlyFields"];
    targetUrl: string;
  }) {
    const orderedKeys = normalizeMerchantBusinessCardContactFieldOrder(input.contactFieldOrder);
    const contactOnlyFields = Object.fromEntries(
      orderedKeys.filter((key) => input.contactOnlyFields[key]).map((key) => [key, true]),
    ) as Partial<MerchantBusinessCardDraft["contactOnlyFields"]>;
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
      contactFieldOrder: orderedKeys,
      ...(Object.keys(contactOnlyFields).length > 0 ? { contactOnlyFields } : {}),
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

