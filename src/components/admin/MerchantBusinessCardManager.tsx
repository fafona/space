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
  createDefaultMerchantBusinessCardDraft,
  getMerchantBusinessCardRequiredFields,
  normalizeMerchantBusinessCardDraft,
  type MerchantBusinessCardAsset,
  type MerchantBusinessCardCustomText,
  type MerchantBusinessCardDraft,
  type MerchantBusinessCardFieldKey,
  type MerchantBusinessCardMode,
  type MerchantBusinessCardProfileInput,
} from "@/lib/merchantBusinessCards";
import {
  buildMerchantBusinessCardShareUrl,
  buildMerchantBusinessCardContactDownloadUrl,
  buildMerchantBusinessCardLegacyContactDownloadUrl,
  normalizeMerchantBusinessCardShareImageUrl,
  resolveMerchantBusinessCardShareOrigin,
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
  onCardsChange: (cards: MerchantBusinessCardAsset[]) => void;
};

type MerchantBusinessCardEditableContactFieldKey = Exclude<keyof MerchantBusinessCardDraft["contacts"], "phones">;

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
  { key: "xiaohongshu", label: "小红书" },
];

const TEXT_LAYOUT_FIELDS: Array<{ key: MerchantBusinessCardFieldKey; label: string }> = [
  { key: "merchantName", label: "商户名称" },
  { key: "title", label: "职位" },
  { key: "website", label: "网站说明" },
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
  { key: "xiaohongshu", label: "小红书" },
];

const FONT_FAMILY_OPTIONS = [
  { value: "", label: "默认" },
  { value: "Microsoft YaHei, SimHei, sans-serif", label: "微软雅黑" },
  { value: "Arial, Helvetica, sans-serif", label: "Arial" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "Times New Roman, Times, serif", label: "Times New Roman" },
];

const FONT_SIZE_OPTIONS = [12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48];
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

const CUSTOM_TEXT_PREFIX = "custom:";

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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
  return values.map((item) => normalizeText(item)).filter(Boolean);
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
  const contacts = CONTACT_FIELDS.filter(({ key }) => normalizeText(draft.contacts[key]));
  const websiteText = [draft.websiteLabel, draft.showWebsiteUrl ? websiteUrl.replace(/^https?:\/\//i, "") : ""]
    .map((item) => item.trim())
    .filter(Boolean)
    .join("\n");
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
        {contacts.map(({ key, label }) => (
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
            {key === "contactName"
              ? draft.contacts[key]
              : `${label}: ${key === "phone" ? buildPhoneContactValue(draft.contacts) : draft.contacts[key]}`}
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
          {qrCodeUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrCodeUrl} alt="商户网站二维码" className="h-full w-full object-contain" />
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function MerchantBusinessCardManager({ siteBaseDomain, profile, cards, cardLimit = 1, onCardsChange }: MerchantBusinessCardManagerProps) {
  const [draft, setDraft] = useState(() => createDefaultMerchantBusinessCardDraft(profile));
  const [draftShareKey, setDraftShareKey] = useState(() => createShareKey());
  const [editorOpen, setEditorOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<MerchantBusinessCardAsset | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [tip, setTip] = useState("");
  const [hasPreviewed, setHasPreviewed] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [numberInputDrafts, setNumberInputDrafts] = useState<Record<string, string>>({});
  const [selectedFieldKeys, setSelectedFieldKeys] = useState<string[]>(["merchantName"]);
  const [fontStyleEditorOpen, setFontStyleEditorOpen] = useState(false);
  const [applyUnifiedTypography, setApplyUnifiedTypography] = useState(false);
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
  const contactPhoneEditorValues = useMemo(() => resolveDraftPhoneValues(draft.contacts), [draft.contacts]);
  const positionEditorItems = useMemo(
    () => [
      ...TEXT_LAYOUT_FIELDS.map((item) => ({
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
    [draft.customTexts],
  );
  const scale = useMemo(
    () => Math.min(1, 520 / Math.max(1, draft.width), 460 / Math.max(1, draft.height)),
    [draft.height, draft.width],
  );
  const normalizedCardLimit = useMemo(() => Math.max(1, Math.min(100, Math.round(Number(cardLimit) || 1))), [cardLimit]);
  const fullScale = useMemo(() => Math.min(1, 1000 / Math.max(1, draft.width)), [draft.width]);
  const requiresPreviewBeforeSave = !editingCardId && !hasPreviewed;
  const qrMayBeUnreadable = draft.qr.size < QR_MIN_READABLE_SIZE;
  const cardLimitReached = !editingCardId && cards.length >= normalizedCardLimit;
  const canOpenCreateEditor = canCreate && !cardLimitReached;
  const activeLinkShareKey = useMemo(() => {
    if (draft.mode !== "link") return "";
    const existingCard = editingCardId ? cards.find((card) => card.id === editingCardId) ?? null : null;
    return normalizeText(existingCard?.shareKey) || normalizeText(draftShareKey) || "";
  }, [cards, draft.mode, draftShareKey, editingCardId]);
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
        targetUrl: websiteUrl,
      }),
    });
  }, [activeLinkShareKey, draft.contacts, draft.mode, draft.name, draft.title, websiteUrl]);
  const qrTargetUrl = draft.mode === "link" ? draftLinkUrl || websiteUrl : websiteUrl;

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
    setDraft(createDefaultMerchantBusinessCardDraft(profile));
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
    setDraft(normalizeMerchantBusinessCardDraft(card));
    setDraftShareKey(normalizeText(card.shareKey) || createShareKey());
    setSelectedFieldKeys(["merchantName"]);
    setEditingCardId(card.id);
    setHasPreviewed(true);
    setPreviewAsset(null);
    setPreviewOpen(false);
    setFolderOpen(false);
    setEditorOpen(true);
  };

  const handleBackgroundUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const reader = new FileReader();
      const imageUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
        reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
        reader.readAsDataURL(file);
      });
      applyDraft((current) => ({ ...current, backgroundImageUrl: imageUrl }));
    } catch {
      setTip("背景图上传失败，请重试");
    } finally {
      event.target.value = "";
    }
  };

  const handleGenerate = async () => {
    if (!websiteUrl || !qrCodeUrl || requiresPreviewBeforeSave) return;
    setIsGenerating(true);
    try {
      const asset = await saveCurrentDraftToFolder();
      if (!asset) {
        setTip("名片生成失败，请重试");
        return;
      }
      setEditorOpen(false);
      setFolderOpen(true);
      setPreviewAsset(asset);
      setTip(editingCardId ? "名片已更新并保存到名片夹" : "名片已生成并保存到名片夹");
    } catch (error) {
      if (error instanceof Error && error.message === "business_card_limit_reached") {
        setTip(`名片夹已达到上限（${normalizedCardLimit} 张），请先删除旧名片或到超级后台调整数量限制`);
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
    try {
      const reader = new FileReader();
      const imageUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
        reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
        reader.readAsDataURL(file);
      });
      applyDraft((current) => ({ ...current, contactPageImageUrl: imageUrl }));
    } catch {
      setTip("联系卡图片上传失败，请重试");
    } finally {
      event.target.value = "";
    }
  };

  const updateDraftPhones = (nextPhones: string[]) => {
    const normalizedPhones = normalizePhoneList(nextPhones);
    applyDraft((current) => ({
      ...current,
      contacts: {
        ...current.contacts,
        phone: normalizedPhones[0] ?? "",
        phones: normalizedPhones,
      },
    }));
  };

  const deleteCard = (card: MerchantBusinessCardAsset) => {
    if (typeof window !== "undefined" && !window.confirm(`确认删除名片“${card.name}”吗？`)) {
      return;
    }
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
    setTip("名片已删除");
  };

  const openCardTarget = (card: MerchantBusinessCardAsset) => {
    if (!card.targetUrl) {
      setTip("当前名片没有可打开的网站链接");
      return;
    }
    window.open(card.targetUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">名片</div>
          <div className="text-xs text-slate-500">完善商户信息后可生成名片。链接模式会生成联系卡链接，对方手机打开后可保存联系人。</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50" onClick={openEditor} disabled={!canOpenCreateEditor}>生成名片</button>
          <button type="button" className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50" onClick={() => setFolderOpen(true)} disabled={cards.length === 0}>{`名片夹 (${cards.length}/${normalizedCardLimit})`}</button>
        </div>
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
                <button type="button" className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50" onClick={() => { setHasPreviewed(true); void handleGenerate(); }} disabled={!websiteUrl || !qrCodeUrl || isGenerating || requiresPreviewBeforeSave}>{isGenerating ? (editingCardId ? "保存中..." : "生成中...") : (editingCardId ? "保存修改" : "生成")}</button>
                <button type="button" className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50" onClick={() => { setEditorOpen(false); setEditingCardId(null); }}>关闭</button>
              </div>
            </div>
            <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(520px,680px)]">
              <div className="min-h-0 overflow-y-auto px-4 py-4">
                <div className="grid gap-3 xl:grid-cols-2">
                  <section className="space-y-2.5 rounded-xl border bg-slate-50 p-3">
                    <div className="text-sm font-semibold text-slate-900">基础设置</div>
                    <div className="space-y-2">
                      <div className="text-xs text-slate-600">名片模式</div>
                      <div className="grid gap-2 md:grid-cols-2">
                        {CARD_MODE_OPTIONS.map((option) => {
                          const active = draft.mode === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              className={`rounded-xl border px-3 py-3 text-left transition ${
                                active
                                  ? "border-slate-900 bg-slate-900 text-white"
                                  : "border-slate-300 bg-white text-slate-900 hover:border-slate-400"
                              }`}
                              onClick={() => applyDraft((current) => ({ ...current, mode: option.value }))}
                            >
                              <div className="text-sm font-semibold">{option.label}</div>
                              <div className={`mt-1 text-xs ${active ? "text-slate-200" : "text-slate-500"}`}>{option.description}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <label className="block text-xs text-slate-600">名片名称<input className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm" value={draft.name} onFocus={() => setSingleSelectedField("merchantName")} onChange={(event) => applyDraft((current) => ({ ...current, name: event.target.value }))} /></label>
                    <label className="block text-xs text-slate-600">职位<input className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm" value={draft.title} onFocus={() => setSingleSelectedField("title")} onChange={(event) => applyDraft((current) => ({ ...current, title: event.target.value }))} /></label>
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
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
                      <label className="block text-xs text-slate-600">背景图<input type="file" accept="image/*" className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm" onChange={(event) => void handleBackgroundUpload(event)} /></label>
                      <label className="block text-xs text-slate-600">背景色<input type="color" className="mt-1 h-[42px] w-full rounded border bg-white px-2 py-1" value={draft.backgroundColor} onChange={(event) => applyDraft((current) => ({ ...current, backgroundColor: event.target.value }))} /></label>
                      <label className="block text-xs text-slate-600">图片透明度<div className="mt-1 flex items-center gap-3 rounded border bg-white px-3 py-2"><input type="range" min="0" max="1" step="0.01" className="min-w-0 flex-1" value={draft.backgroundImageOpacity} onChange={(event) => applyDraft((current) => ({ ...current, backgroundImageOpacity: clamp(Number(event.target.value), 0, 1) }))} /><span className="w-12 shrink-0 text-right text-xs text-slate-500">{formatOpacityPercent(draft.backgroundImageOpacity)}</span></div></label>
                      <label className="block text-xs text-slate-600">背景色透明度<div className="mt-1 flex items-center gap-3 rounded border bg-white px-3 py-2"><input type="range" min="0" max="1" step="0.01" className="min-w-0 flex-1" value={draft.backgroundColorOpacity} onChange={(event) => applyDraft((current) => ({ ...current, backgroundColorOpacity: clamp(Number(event.target.value), 0, 1) }))} /><span className="w-12 shrink-0 text-right text-xs text-slate-500">{formatOpacityPercent(draft.backgroundColorOpacity)}</span></div></label>
                    </div>
                    {draft.mode === "link" ? (
                      <div className="rounded-xl border bg-white px-3 py-3">
                        <div className="text-xs font-semibold text-slate-700">联系卡中间展示图</div>
                        <div className="mt-1 text-xs leading-5 text-slate-500">这里可以单独上传一张图片给收到名片的人看。不上传时，联系卡页面会默认展示姓名、电话、邮箱这些名片信息。</div>
                        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_120px]">
                          <label className="block text-xs text-slate-600">
                            上传图片
                            <input type="file" accept="image/*" className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm" onChange={(event) => void handleContactPageImageUpload(event)} />
                          </label>
                          <button
                            type="button"
                            className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                            onClick={() => applyDraft((current) => ({ ...current, contactPageImageUrl: "" }))}
                            disabled={!normalizeText(draft.contactPageImageUrl)}
                          >
                            恢复默认
                          </button>
                        </div>
                        {normalizeText(draft.contactPageImageUrl) ? (
                          <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={draft.contactPageImageUrl} alt="联系卡展示图预览" className="block h-40 w-full rounded-xl object-cover" />
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px]">
                      <label className="block text-xs text-slate-600">网站说明<input className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm" value={draft.websiteLabel} placeholder="扫码进入网站" onFocus={() => setSingleSelectedField("website")} onChange={(event) => applyDraft((current) => ({ ...current, websiteLabel: event.target.value }))} /></label>
                      <label className="flex items-end gap-2 text-xs text-slate-600"><input type="checkbox" className="mb-3" checked={draft.showWebsiteUrl} onChange={(event) => applyDraft((current) => ({ ...current, showWebsiteUrl: event.target.checked }))} />显示域名</label>
                    </div>
                    <div className="rounded border bg-white px-3 py-2 text-xs text-slate-500">{`当前二维码网址：${websiteUrl || "请先填写域名前缀"}`}</div>
                  </section>
                  <section className="space-y-2.5 rounded-xl border bg-slate-50 p-3">
                    <div className="text-sm font-semibold text-slate-900">二维码</div>
                    <div className="grid gap-3 md:grid-cols-3">
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
                    {qrMayBeUnreadable ? (
                      <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                        当前二维码尺寸偏小，可能无法识别，建议至少保持在 {QR_MIN_READABLE_SIZE}px。
                      </div>
                    ) : null}
                    <div className="rounded-xl border bg-white p-4"><div className="mb-3 text-xs font-medium text-slate-500">二维码预览</div><div className="flex h-32 w-32 items-center justify-center rounded-xl border bg-slate-50 p-2">{qrCodeUrl ? <img src={qrCodeUrl} alt="二维码预览" className="h-full w-full object-contain" /> : <span className="text-xs text-slate-400">暂无二维码</span>}</div></div>
                  </section>
                  <section className="space-y-2.5 rounded-xl border bg-slate-50 p-3 xl:col-span-2">
                    <div className="text-sm font-semibold text-slate-900">联系方式</div>
                    <div className="rounded-xl border bg-white p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="text-xs font-medium text-slate-700">电话（可增加）</div>
                        <button
                          type="button"
                          className="rounded border bg-white px-2 py-1 text-xs hover:bg-slate-50"
                          onClick={() => updateDraftPhones([...contactPhoneEditorValues, ""])}
                        >
                          增加电话
                        </button>
                      </div>
                      <div className="space-y-2">
                        {contactPhoneEditorValues.map((phone, index) => (
                          <div key={`phone-${index}`} className="flex items-center gap-2">
                            <input
                              className="w-full rounded border bg-white px-3 py-2 text-sm"
                              value={phone}
                              onFocus={() => setSingleSelectedField("phone")}
                              onChange={(event) => {
                                const next = [...contactPhoneEditorValues];
                                next[index] = event.target.value;
                                updateDraftPhones(next);
                              }}
                              placeholder={`请输入电话${contactPhoneEditorValues.length > 1 ? index + 1 : ""}`}
                            />
                            <button
                              type="button"
                              className="rounded border bg-white px-2 py-2 text-xs hover:bg-slate-50 disabled:opacity-50"
                              onClick={() => {
                                const next = contactPhoneEditorValues.filter((_, removeIndex) => removeIndex !== index);
                                updateDraftPhones(next.length > 0 ? next : [""]);
                              }}
                              disabled={contactPhoneEditorValues.length <= 1}
                            >
                              删除
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {CONTACT_FIELDS.filter(({ key }) => key !== "phone").map(({ key, label }) => (
                        <label key={key} className="block text-xs text-slate-600">
                          {label}
                          <input
                            className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm"
                            value={draft.contacts[key]}
                            onFocus={() => setSingleSelectedField(key)}
                            onChange={(event) =>
                              applyDraft((current) => ({ ...current, contacts: { ...current.contacts, [key]: event.target.value } }))
                            }
                            placeholder={`请输入${label}`}
                          />
                        </label>
                      ))}
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
                            className={`rounded-xl border bg-white p-3 ${selectedFieldKeys.includes(getCustomTextSelectionKey(item.id)) ? "border-slate-900 ring-2 ring-slate-200" : ""}`}
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
                        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px]">
                          <label className="block text-xs text-slate-600">字体<select className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm" value={selectedTypography.fontFamily || ""} onChange={(event) => updateTypography({ fontFamily: event.target.value })}>{FONT_FAMILY_OPTIONS.map((option) => <option key={option.label} value={option.value}>{option.label}</option>)}</select></label>
                          <label className="block text-xs text-slate-600">字号<select className="mt-1 w-full rounded border bg-white px-3 py-2 text-sm" value={selectedTypography.fontSize} onChange={(event) => updateTypography({ fontSize: Number(event.target.value) })}>{FONT_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
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
                            className={`rounded-xl border bg-white p-3 transition ${isSelected ? "border-slate-900 ring-2 ring-slate-200" : "hover:border-slate-300"}`}
                            onClick={(event) => handleSelectedFieldClick(item.id, event)}
                          >
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <div className="text-xs font-medium text-slate-700">{item.label}</div>
                              {isCurrent ? <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] text-white">当前</span> : isSelected ? <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] text-slate-700">已选</span> : null}
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
              <aside className="min-h-0 overflow-y-auto border-l bg-slate-50 px-4 py-4"><div className="sticky top-0 space-y-3"><div><div className="text-sm font-semibold text-slate-900">实时预览</div><div className="text-xs text-slate-500">先点击“预览”确认样式，再点击“生成”。</div></div><div className="overflow-hidden rounded-2xl border bg-slate-900/5 p-3"><div className="flex justify-center"><CardSurface draft={draft} websiteUrl={websiteUrl} qrCodeUrl={qrCodeUrl} scale={scale} /></div></div><div className="rounded-xl border bg-white px-3 py-2 text-xs text-slate-600">{draft.mode === "link" ? "当前为链接模式：二维码和链接都会进入联系卡，对方手机打开后可保存到通讯录。" : "当前为图片模式：生成后可保存或复制名片图片。"}</div>{requiresPreviewBeforeSave ? <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">先点击“预览”，再生成名片。</div> : null}</div></aside>
            </div>
          </div>
        </div>,
      ) : null}

      {folderOpen ? overlay(
        <div className="fixed inset-0 z-[2147483000] bg-black/45 p-4" onMouseDown={() => setFolderOpen(false)}>
          <div className="mx-auto flex h-full max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-5 py-4"><div><div className="text-lg font-semibold text-slate-900">名片夹</div><div className="text-sm text-slate-500">查看已生成的图片名片或链接名片，可预览并继续操作。</div></div><button type="button" className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50" onClick={() => setFolderOpen(false)}>关闭</button></div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{cards.length > 0 ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{cards.map((card) => <article key={card.id} className="overflow-hidden rounded-2xl border bg-slate-50 shadow-sm"><div className="space-y-4 p-4"><button type="button" className="block w-full overflow-hidden rounded-2xl border bg-transparent text-left" onClick={() => { setPreviewAsset(card); setPreviewOpen(true); }}><img src={card.imageUrl} alt={card.name} className="block h-auto w-full object-cover bg-transparent" /></button><div><div className="flex items-center gap-2"><div className="text-base font-semibold text-slate-900">{card.name}</div><span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] text-white">{getCardModeLabel(card.mode)}</span></div><div className="text-xs text-slate-500">{new Date(card.createdAt).toLocaleString("zh-CN", { hour12: false })}</div>{card.mode === "link" ? <div className="mt-1 text-xs text-slate-500">手机打开联系卡链接后可直接保存联系人。</div> : null}</div>{card.mode === "link" ? <div className="space-y-2"><div className="grid grid-cols-2 gap-2"><button type="button" className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50" onClick={() => { setPreviewAsset(card); setPreviewOpen(true); }}>预览</button><button type="button" className="rounded bg-black px-3 py-2 text-sm text-white hover:bg-slate-800" onClick={() => void copyCardLink(card)}>复制联系卡链接</button></div><div className="grid grid-cols-2 gap-2"><button type="button" className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50" onClick={() => void downloadCardContact(card)}>下载联系人</button><button type="button" className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50" onClick={() => void copyCardImage(card)}>复制名片图片</button></div><div className="grid grid-cols-2 gap-2"><button type="button" className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50" onClick={() => openEditorForCard(card)}>修改</button><button type="button" className="rounded border border-rose-200 bg-white px-3 py-2 text-sm text-rose-600 hover:bg-rose-50" onClick={() => deleteCard(card)}>删除</button></div></div> : <div className="grid grid-cols-2 gap-2"><button type="button" className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50" onClick={() => { setPreviewAsset(card); setPreviewOpen(true); }}>预览</button><button type="button" className="rounded bg-black px-3 py-2 text-sm text-white hover:bg-slate-800" onClick={() => void saveCard(card)}>保存</button><button type="button" className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50" onClick={() => openEditorForCard(card)}>修改</button><button type="button" className="rounded border border-rose-200 bg-white px-3 py-2 text-sm text-rose-600 hover:bg-rose-50" onClick={() => deleteCard(card)}>删除</button></div>}</div></article>)}</div> : <div className="flex min-h-[240px] items-center justify-center rounded-2xl border border-dashed bg-slate-50 px-6 text-center text-sm text-slate-500">还没有生成名片。先去点击“生成名片”制作一张。</div>}</div>
          </div>
        </div>,
      ) : null}

      {previewOpen ? overlay(
        <div className="fixed inset-0 z-[2147483100] bg-black/65 p-4" onMouseDown={() => { setPreviewOpen(false); setPreviewAsset(null); }}>
          <div className="mx-auto flex h-full max-h-[calc(100vh-2rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-5 py-4"><div><div className="text-base font-semibold text-slate-900">{previewAsset?.name || draft.name || "名片预览"}</div><div className="text-xs text-slate-500">{getCardModeLabel(previewAsset?.mode || draft.mode)}</div></div><div className="flex gap-2">{(previewAsset?.mode || draft.mode) === "link" && (previewAsset?.targetUrl || websiteUrl) ? <><button type="button" className="rounded bg-black px-3 py-2 text-sm text-white hover:bg-slate-800" onClick={() => previewAsset ? void copyCardLink(previewAsset) : copyPreviewLink(websiteUrl)}>复制联系卡链接</button><button type="button" className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50" onClick={() => previewAsset ? void downloadCardContact(previewAsset) : void downloadPreviewContact(websiteUrl)}>下载联系人</button><button type="button" className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50" onClick={() => previewAsset ? void copyCardImage(previewAsset) : void copyPreviewImage()}>复制名片图片</button></> : null}<button type="button" className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50" onClick={() => { setPreviewOpen(false); setPreviewAsset(null); }}>关闭</button></div></div>
            <div className="flex-1 overflow-auto bg-black p-4"><div className="mx-auto flex min-h-full items-center justify-center">{previewAsset ? <button type="button" className="block bg-transparent text-left" onClick={() => previewAsset.mode === "link" ? openCardTarget(previewAsset) : undefined}><img src={previewAsset.imageUrl} alt={previewAsset.name} className="block h-auto max-w-full bg-transparent object-contain" /></button> : <CardSurface draft={draft} websiteUrl={websiteUrl} qrCodeUrl={qrCodeUrl} scale={fullScale} />}</div></div>
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
    imageWidth?: number;
    imageHeight?: number;
    contact?: {
      displayName?: string;
      organization?: string;
      title?: string;
      phone?: string;
      email?: string;
      address?: string;
      websiteUrl?: string;
      note?: string;
    };
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
      targetUrl,
      name: input.cardName,
      contact: input.contact,
    });
    const fallbackContactUrl = buildMerchantBusinessCardLegacyContactDownloadUrl({
      origin: resolveMerchantBusinessCardShareOrigin(undefined, targetUrl),
      imageUrl: shareImageUrl,
      detailImageUrl,
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
    if (!node || !websiteUrl || !qrCodeUrl) return null;
    if (!editingCardId && cards.length >= normalizedCardLimit) {
      throw new Error("business_card_limit_reached");
    }

    const imageUrl = await renderCardNodeToImage(node);
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

  async function copyPreviewImage() {
    try {
      const asset = await saveCurrentDraftToFolder();
      if (!asset) {
        setTip("请先预览名片后再复制");
        return;
      }
      await copyImageToClipboard(asset.imageUrl);
      setTip("名片图片已复制，并已保存到名片夹");
    } catch (error) {
      setTip(error instanceof Error && error.message === "business_card_limit_reached" ? `名片夹已达到上限（${normalizedCardLimit} 张），请先删除旧名片或到超级后台调整数量限制` : "复制失败，请重试");
    }
  }

  async function copyCardImage(card: MerchantBusinessCardAsset) {
    try {
      await copyImageToClipboard(card.imageUrl);
      setTip("名片图片已复制，可直接发送");
    } catch {
      setTip("复制失败，请重试");
    }
  }

  async function copyPreviewLink(url: string) {
    const normalizedUrl = normalizeText(url);
    if (!normalizedUrl) {
      setTip("当前名片没有可复制的网站链接");
      return;
    }

    try {
      const asset = await saveCurrentDraftToFolder();
      if (!asset) {
        setTip("请先预览名片后再复制");
        return;
      }
      const { shareUrl } = await buildShareBundle({
        targetUrl: normalizedUrl,
        cardName: normalizeText(asset.name) || "商户名片",
        shareKey: normalizeText(asset.shareKey),
        card: asset,
        contactPageImageUrl: normalizeText(asset.contactPageImageUrl),
        imageWidth: asset.width,
        imageHeight: asset.height,
        contact: buildShareContactPayload({
          name: asset.name,
          title: asset.title,
          contacts: asset.contacts,
          targetUrl: normalizedUrl,
        }),
      });
      await copyTextToClipboard(shareUrl);
      setTip("联系卡链接已复制，并已保存到名片夹");
    } catch (error) {
      setTip(error instanceof Error && error.message === "business_card_limit_reached" ? `名片夹已达到上限（${normalizedCardLimit} 张），请先删除旧名片或到超级后台调整数量限制` : "复制失败，请重试");
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
          targetUrl,
        }),
      });
      await copyTextToClipboard(shareUrl);
      setTip("联系卡链接已复制，手机打开后可保存联系人");
    } catch {
      setTip("复制失败，请重试");
    }
  }

  async function downloadPreviewContact(url: string) {
    const normalizedUrl = normalizeText(url);
    if (!normalizedUrl) {
      setTip("当前名片没有可下载的联系人");
      return;
    }
    try {
      const asset = await saveCurrentDraftToFolder();
      if (!asset) {
        setTip("请先预览名片后再下载联系人");
        return;
      }
      const { contactUrl } = await buildShareBundle({
        targetUrl: normalizedUrl,
        cardName: normalizeText(asset.name) || "商户名片",
        shareKey: normalizeText(asset.shareKey),
        card: asset,
        contactPageImageUrl: normalizeText(asset.contactPageImageUrl),
        imageWidth: asset.width,
        imageHeight: asset.height,
        contact: buildShareContactPayload({
          name: asset.name,
          title: asset.title,
          contacts: asset.contacts,
          targetUrl: normalizedUrl,
        }),
      });
      if (!contactUrl) {
        setTip("联系人下载地址生成失败，请重试");
        return;
      }
      await openContactDownload(contactUrl, normalizeText(asset.contacts.contactName) || normalizeText(asset.name));
      setTip("联系人已开始下载，并已保存到名片夹");
    } catch (error) {
      setTip(error instanceof Error && error.message === "business_card_limit_reached" ? `名片夹已达到上限（${normalizedCardLimit} 张），请先删除旧名片或到超级后台调整数量限制` : "下载失败，请重试");
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
    targetUrl: string;
  }) {
    const extraPhoneLines = normalizePhoneList(input.contacts.phones ?? []).slice(1).map((value, index) => `电话${index + 2}: ${value}`);
    const socialLines = [
      ["微信", input.contacts.wechat],
      ["WhatsApp", input.contacts.whatsapp],
      ["Twitter", input.contacts.twitter],
      ["微博", input.contacts.weibo],
      ["Telegram", input.contacts.telegram],
      ["LinkedIn", input.contacts.linkedin],
      ["Discord", input.contacts.discord],
      ["Facebook", input.contacts.facebook],
      ["Instagram", input.contacts.instagram],
      ["TikTok", input.contacts.tiktok],
      ["小红书", input.contacts.xiaohongshu],
    ]
      .map(([label, value]) => {
        const normalizedValue = normalizeText(value);
        return normalizedValue ? `${label}: ${normalizedValue}` : "";
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
      xiaohongshu: normalizeText(input.contacts.xiaohongshu),
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

