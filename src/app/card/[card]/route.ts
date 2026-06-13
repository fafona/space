import { NextResponse } from "next/server";
import {
  buildMerchantBusinessCardContactDownloadUrl,
  buildMerchantBusinessCardShareManifestObjectPath,
  buildMerchantBusinessCardShareManifestPublicUrls,
  buildMerchantBusinessCardShareDescription,
  buildMerchantBusinessCardShareTitle,
  buildMerchantBusinessCardShareUrl,
  isMerchantBusinessCardShareRevoked,
  loadMerchantBusinessCardSharePayloadByKey,
  normalizeMerchantBusinessCardSharePayload,
  normalizeMerchantBusinessCardShareImageUrl,
  normalizeMerchantBusinessCardShareKey,
  normalizeMerchantBusinessCardShareVideoUrl,
  resolveMerchantBusinessCardShareOrigin,
  type MerchantBusinessCardShareContact,
  type MerchantBusinessCardSharePayload,
} from "@/lib/merchantBusinessCardShare";
import {
  normalizeMerchantBusinessCardContactSectionOrder,
  normalizeMerchantBusinessCardContactFieldOrder,
  type MerchantBusinessCardAsset,
  type MerchantBusinessCardContactSectionKey,
  type MerchantBusinessCardCustomContactLink,
  type MerchantBusinessCardContactDisplayKey,
} from "@/lib/merchantBusinessCards";
import { DEFAULT_LOCALE, I18N_STORAGE_KEY, LANGUAGE_OPTIONS } from "@/lib/i18n";
import { normalizePublicAssetUrl } from "@/lib/publicAssetUrl";
import {
  getContactCardVisibleMerchantCoupons,
  getMerchantCouponDisplayBoxColor,
  getMerchantCouponDisplayBoxStyle,
  getMerchantCouponDisplayButtonText,
  getMerchantCouponDisplayDescription,
  getMerchantCouponDisplayFieldOrder,
  getMerchantCouponDisplayMetaText,
  getMerchantCouponDisplayTitle,
  getMerchantCouponRemainingCount,
  getMerchantCouponDiscountLabel,
  isMerchantCouponDisplayFieldHidden,
  type MerchantCouponDisplayBoxStyle,
  type MerchantCouponDisplayField,
  type MerchantCouponRecord,
  type MerchantCouponUsageScenario,
} from "@/lib/merchantCoupons";
import { listMerchantCoupons } from "@/lib/merchantCoupons.server";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import {
  loadCurrentMerchantSnapshotSites,
  loadCurrentMerchantSnapshotSiteBySiteId,
  loadPublishedMerchantSnapshotSites,
  loadPublishedMerchantServiceStateByTargetUrl,
} from "@/lib/publishedMerchantService";
import { OFFICIAL_SERVICE_CONTACT, describeMerchantMaintenanceMessage, type MerchantServiceRestrictionReason } from "@/lib/merchantServiceStatus";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function serializeInlineScriptValue(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function normalizeText(value: string | null | undefined) {
  return String(value ?? "").trim();
}

const BUSINESS_CARD_SHARE_MANIFEST_BUCKETS = ["page-assets", "assets", "uploads", "public"] as const;
const GOOGLE_REVIEW_DISPLAY_TEXT = "欢迎评价";
const GOOGLE_REVIEW_DISPLAY_TRANSLATIONS: Record<string, string> = {
  "zh-CN": GOOGLE_REVIEW_DISPLAY_TEXT,
  "zh-TW": "\u6b61\u8fce\u8a55\u50f9",
  "ja-JP": "\u30ec\u30d3\u30e5\u30fc\u3092\u66f8\u304f",
  "ko-KR": "\ub9ac\ubdf0 \ub0a8\uae30\uae30",
  "en-GB": "Leave a review",
  "es-ES": "Deja una rese\u00f1a",
  "de-DE": "Bewertung schreiben",
  "fr-FR": "Laisser un avis",
  "tr-TR": "Yorum b\u0131rak\u0131n",
  "it-IT": "Lascia una recensione",
  "pl-PL": "Dodaj opini\u0119",
  "uk-UA": "\u0417\u0430\u043b\u0438\u0448\u0438\u0442\u0438 \u0432\u0456\u0434\u0433\u0443\u043a",
  "nl-NL": "Laat een review achter",
  "ro-RO": "Las\u0103 o recenzie",
  "pt-PT": "Deixe uma avalia\u00e7\u00e3o",
  "ru-RU": "\u041e\u0441\u0442\u0430\u0432\u0438\u0442\u044c \u043e\u0442\u0437\u044b\u0432",
  "el-GR": "\u0391\u03c6\u03ae\u03c3\u03c4\u03b5 \u03bc\u03b9\u03b1 \u03ba\u03c1\u03b9\u03c4\u03b9\u03ba\u03ae",
  "cs-CZ": "Zanechat recenzi",
  "sv-SE": "L\u00e4mna en recension",
  "hu-HU": "\u00cdrjon \u00e9rt\u00e9kel\u00e9st",
  "be-BY": "\u041f\u0430\u043a\u0456\u043d\u0443\u0446\u044c \u0432\u043e\u0434\u0433\u0443\u043a",
  "bg-BG": "\u041e\u0441\u0442\u0430\u0432\u0435\u0442\u0435 \u043e\u0442\u0437\u0438\u0432",
  "sr-RS": "Ostavite recenziju",
  "da-DK": "Skriv en anmeldelse",
  "fi-FI": "J\u00e4t\u00e4 arvostelu",
  "sk-SK": "Zanechajte recenziu",
  "no-NO": "Legg igjen en anmeldelse",
  "hr-HR": "Ostavite recenziju",
  "bs-BA": "Ostavite recenziju",
  "sq-AL": "Lini nj\u00eb vler\u00ebsim",
  "lt-LT": "Palikite atsiliepim\u0105",
  "sl-SI": "Pustite oceno",
  "lv-LV": "Atst\u0101jiet atsauksmi",
  "et-EE": "J\u00e4tke arvustus",
  "mk-MK": "\u041e\u0441\u0442\u0430\u0432\u0435\u0442\u0435 \u0440\u0435\u0446\u0435\u043d\u0437\u0438\u0458\u0430",
  "ca-ES": "Deixa una ressenya",
  "eu-ES": "Utzi iritzia",
  "gl-ES": "Deixa unha recensi\u00f3n",
  "cy-GB": "Gadewch adolygiad",
  "is-IS": "Skildu eftir ums\u00f6gn",
  "ga-IE": "F\u00e1g l\u00e9irmheas",
  "mt-MT": "\u0126alli revi\u017cjoni",
  "lb-LU": "Schreift eng Bew\u00e4ertung",
};

function buildLanguageFlagUrl(countryCode: string) {
  const code = normalizeText(countryCode).toLowerCase();
  return code ? `https://flagcdn.com/${code}.svg` : "";
}

type StorageOperationError = {
  message?: string | null;
} | null;

type PublicStorageBucketClient = {
  upload: (
    objectPath: string,
    body: Blob,
    options: {
      contentType: string;
      cacheControl: string;
      upsert: boolean;
    },
  ) => Promise<{ error: StorageOperationError }>;
};

type PublicStorageClient = {
  storage: {
    from: (bucket: string) => PublicStorageBucketClient;
  };
};

function createJsonBlob(value: unknown) {
  return new Blob([JSON.stringify(value)], { type: "application/json; charset=utf-8" });
}

function looksLikeUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function forcePublicStorageImageUrl(value: string, origin: string) {
  const trimmed = normalizeText(value);
  if (!trimmed) return "";
  const normalizedOrigin = normalizeText(origin).replace(/\/+$/g, "");
  if (!normalizedOrigin) return trimmed;
  const localhostMatch = trimmed.match(/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(\/storage\/v1\/object\/public\/.+)$/i);
  if (localhostMatch?.[1]) {
    return `${normalizedOrigin}${localhostMatch[1]}`;
  }
  return trimmed;
}

function deriveIntroPosterUrlFromVideoUrl(value: string) {
  const trimmed = normalizeText(value);
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    if (!/\.mp4$/i.test(parsed.pathname)) return "";
    parsed.pathname = parsed.pathname.replace(/\.mp4$/i, "-poster.jpg");
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return /\.mp4$/i.test(trimmed) ? trimmed.replace(/\.mp4$/i, "-poster.jpg") : "";
  }
}

function buildPhoneHref(rawPhone?: string) {
  const text = normalizeText(rawPhone);
  if (!text) return "";
  const hasPlus = text.startsWith("+");
  const digits = text.replace(/[^\d]/g, "");
  if (digits.length < 3) return "";
  return `tel:${hasPlus ? "+" : ""}${digits}`;
}

function buildAddressHref(rawAddress?: string) {
  const address = normalizeText(rawAddress);
  if (!address) return "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function buildGoogleReviewHref(rawValue?: string) {
  const value = normalizeText(rawValue);
  if (!value) return "";
  if (looksLikeUrl(value)) return value;
  const normalized = value.replace(/^@+/, "").trim();
  if (/^(?:www\.)?(?:google\.[^\s/]+|maps\.app\.goo\.gl|g\.page)\b/i.test(normalized)) {
    return `https://${normalized.replace(/^\/+/, "")}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

function buildInlineSvgIcon(
  kind:
    | "phone"
    | "map"
    | "copy"
    | "link"
    | "star"
    | "heart"
    | "chat"
    | "gift"
    | "google"
    | "download"
    | "review"
    | "favorite"
    | "checkin",
) {
  if (kind === "phone") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.62 10.79a15.53 15.53 0 0 0 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.4 21 3 13.6 3 4c0-.55.45-1 1-1h3.49c.55 0 1 .45 1 1 0 1.24.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.19 2.2z"/></svg>`;
  }
  if (kind === "map") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 4.74 6.14 11.84 6.4 12.14a.8.8 0 0 0 1.2 0C12.86 20.84 19 13.74 19 9a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"/></svg>`;
  }
  if (kind === "link") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.59 13.41a2 2 0 0 0 2.82 0l3.54-3.54a2 2 0 1 0-2.83-2.83l-.7.7-1.42-1.41.71-.71a4 4 0 0 1 5.66 5.66l-3.54 3.54a4 4 0 0 1-5.66 0 4 4 0 0 1 0-5.66l.71-.71 1.41 1.42-.7.7a2 2 0 0 0 0 2.84z"/><path d="M13.41 10.59a2 2 0 0 0-2.82 0l-3.54 3.54a2 2 0 1 0 2.83 2.83l.7-.7 1.42 1.41-.71.71a4 4 0 0 1-5.66-5.66l3.54-3.54a4 4 0 0 1 5.66 0 4 4 0 0 1 0 5.66l-.71.71-1.41-1.42.7-.7a2 2 0 0 0 0-2.84z"/></svg>`;
  }
  if (kind === "star") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.7 2.82 5.72 6.31.92-4.57 4.45 1.08 6.29L12 17.11l-5.64 2.97 1.08-6.29-4.57-4.45 6.31-.92L12 2.7z"/></svg>`;
  }
  if (kind === "heart") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.2-4.35-9.4-8.7C.72 8.58 2.8 4.5 6.8 4.5c2.08 0 3.4 1.12 4.2 2.18.8-1.06 2.12-2.18 4.2-2.18 4 0 6.08 4.08 4.2 7.8C19.2 16.65 12 21 12 21z"/></svg>`;
  }
  if (kind === "chat") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm3 5h10V7H7v2zm0 4h7v-2H7v2z"/></svg>`;
  }
  if (kind === "gift") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7h-2.18A3 3 0 0 0 12 5.83 3 3 0 0 0 6.18 7H4a2 2 0 0 0-2 2v3h20V9a2 2 0 0 0-2-2zM9 5a1 1 0 0 1 1 1v1H8a1 1 0 0 1 1-2zm6 0a1 1 0 0 1 1 2h-2V6a1 1 0 0 1 1-1zM4 14v6a2 2 0 0 0 2 2h5v-8H4zm9 8h5a2 2 0 0 0 2-2v-6h-7v8z"/></svg>`;
  }
  if (kind === "google") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.6 12.23c0-.74-.07-1.45-.19-2.14H12v4.05h5.38a4.6 4.6 0 0 1-1.99 3.02v2.51h3.23c1.89-1.74 2.98-4.3 2.98-7.44z"/><path d="M12 22c2.7 0 4.96-.89 6.62-2.33l-3.23-2.51c-.9.6-2.04.95-3.39.95-2.6 0-4.8-1.76-5.59-4.12H3.08v2.59A10 10 0 0 0 12 22z"/><path d="M6.41 13.99a6 6 0 0 1 0-3.98V7.42H3.08a10 10 0 0 0 0 9.16l3.33-2.59z"/><path d="M12 5.89c1.47 0 2.78.5 3.82 1.5l2.87-2.87C16.95 2.9 14.7 2 12 2a10 10 0 0 0-8.92 5.42l3.33 2.59C7.2 7.65 9.4 5.89 12 5.89z"/></svg>`;
  }
  if (kind === "download") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20h14v-2H5v2zM13 4h-2v8.17L7.41 8.59 6 10l6 6 6-6-1.41-1.41L13 12.17V4z"/></svg>`;
  }
  if (kind === "review") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm3 5h10V7H7v2zm0 4h7v-2H7v2z"/></svg>`;
  }
  if (kind === "favorite") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1zm2 2v12.55l4-2.29 4 2.29V5H8z"/></svg>`;
  }
  if (kind === "checkin") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.2 13.6-4-4 1.4-1.4 2.6 2.58 5.6-5.58 1.4 1.4-7 7z"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2V9zm-5 6V6a2 2 0 0 1 2-2h8v2H6v9H4z"/></svg>`;
}

function buildSocialHref(label: string, rawValue?: string) {
  const value = normalizeText(rawValue);
  if (!value) return "";
  if (looksLikeUrl(value) || /^weixin:\/\//i.test(value)) return value;
  if (label === "Google") return buildGoogleReviewHref(value);

  if (label === "邮箱") return `mailto:${value}`;
  if (label === "微信") {
    const wechatId = value.replace(/^@+/, "").trim();
    return wechatId ? `weixin://dl/chat?username=${encodeURIComponent(wechatId)}` : "weixin://";
  }
  if (label === "WhatsApp") {
    const digits = value.replace(/[^\d]/g, "");
    return digits ? `https://wa.me/${digits}` : "";
  }
  if (label === "Twitter") return `https://x.com/${value.replace(/^@+/, "")}`;
  if (label === "微博") return `https://weibo.com/n/${encodeURIComponent(value.replace(/^@+/, ""))}`;
  if (label === "Telegram") return `https://t.me/${value.replace(/^@+/, "")}`;
  if (label === "LinkedIn") return `https://www.linkedin.com/in/${value.replace(/^@+/, "")}`;
  if (label === "Discord") {
    const normalized = value.replace(/^@+/, "").trim();
    if (/^\d{5,}$/.test(normalized)) return `https://discord.com/users/${normalized}`;
    if (/^[A-Za-z0-9-]+$/.test(normalized)) return `https://discord.gg/${normalized}`;
    return "";
  }
  if (label === "TikTok") return `https://www.tiktok.com/@${value.replace(/^@+/, "")}`;
  if (label === "抖音") return `https://www.douyin.com/search/${encodeURIComponent(value.replace(/^@+/, ""))}`;
  if (label === "Instagram") return `https://www.instagram.com/${value.replace(/^@+/, "")}`;
  if (label === "Facebook") return `https://www.facebook.com/${value.replace(/^@+/, "")}`;
  if (label === "小红书") return `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(value)}`;
  return "";
}

function buildActionButtonHtml(input: {
  href: string;
  label: string;
  iconUrl?: string;
  iconSvg?: string;
  bgColor: string;
}) {
  const href = normalizeText(input.href);
  if (!href) return "";
  return `<a class="inline-action" href="${escapeHtml(href)}" aria-label="${escapeHtml(input.label)}" title="${escapeHtml(input.label)}" style="background:${escapeHtml(input.bgColor)}">
    ${
      input.iconUrl
        ? `<img src="${escapeHtml(input.iconUrl)}" alt="" />`
        : input.iconSvg || ""
    }
  </a>`;
}

function buildWeChatActionHtml(rawValue?: string) {
  const wechatId = normalizeText(rawValue).replace(/^@+/, "").trim();
  if (!wechatId) return "";
  return `<button class="inline-action inline-action-button" type="button" aria-label="\u590d\u5236\u5fae\u4fe1\u53f7\u5e76\u6253\u5f00\u5fae\u4fe1" title="\u590d\u5236\u5fae\u4fe1\u53f7\u5e76\u6253\u5f00\u5fae\u4fe1" style="background:#07C160" data-wechat-primary="weixin://" data-wechat-id="${escapeHtml(wechatId)}">
    <img src="/social-icons/wechat.svg" alt="" />
  </button>`;
}

function buildDouyinActionHtml(rawValue?: string) {
  const douyinId = normalizeText(rawValue).replace(/^@+/, "").trim();
  if (!douyinId) return "";
  return `<button class="inline-action inline-action-button" type="button" aria-label="\u590d\u5236\u6296\u97f3\u53f7\u5e76\u6253\u5f00\u6296\u97f3" title="\u590d\u5236\u6296\u97f3\u53f7\u5e76\u6253\u5f00\u6296\u97f3" style="background:#161823" data-douyin-primary="snssdk1128://" data-douyin-id="${escapeHtml(douyinId)}">
    <img src="/social-icons/tiktok.svg" alt="" />
  </button>`;
}

function buildDiscordActionHtml(rawValue?: string) {
  const discordValue = normalizeText(rawValue).trim();
  if (!discordValue) return "";
  const href = buildSocialHref("Discord", discordValue);
  if (href) {
    return buildActionButtonHtml({
      href,
      label: "打开 Discord",
      iconUrl: "/social-icons/discord.svg",
      bgColor: "#5865F2",
    });
  }
  return `<button class="inline-action inline-action-button" type="button" aria-label="\u590d\u5236 Discord \u8d26\u53f7\u5e76\u6253\u5f00 Discord" title="\u590d\u5236 Discord \u8d26\u53f7\u5e76\u6253\u5f00 Discord" style="background:#5865F2" data-discord-primary="discord://" data-discord-id="${escapeHtml(discordValue)}">
    <img src="/social-icons/discord.svg" alt="" />
  </button>`;
}

type SummaryRow = {
  label: string;
  value: string;
  actionHtml: string;
  key?: MerchantBusinessCardContactDisplayKey;
  translateValue?: boolean;
};

function buildCopyActionHtml(rawValue: string, label: string) {
  const normalizedValue = normalizeText(rawValue);
  if (!normalizedValue) return "";
  return `<button class="inline-action inline-action-button" type="button" aria-label="复制${escapeHtml(label)}" title="复制${escapeHtml(label)}" style="background:#0f172a" data-copy-value="${escapeHtml(normalizedValue)}" data-copy-label="${escapeHtml(label)}">
    ${buildInlineSvgIcon("copy")}
  </button>`;
}

function buildInvoiceSummaryRows(contact?: MerchantBusinessCardShareContact): SummaryRow[] {
  return [
    contact?.invoiceName
      ? {
          label: "\u540d\u79f0",
          value: contact.invoiceName,
          actionHtml: buildCopyActionHtml(contact.invoiceName, "\u540d\u79f0"),
        }
      : null,
    contact?.invoiceTaxNumber
      ? {
          label: "\u7a0e\u53f7",
          value: contact.invoiceTaxNumber,
          actionHtml: buildCopyActionHtml(contact.invoiceTaxNumber, "\u7a0e\u53f7"),
        }
      : null,
    contact?.invoiceAddress
      ? {
          label: "\u5730\u5740",
          value: contact.invoiceAddress,
          actionHtml: buildCopyActionHtml(contact.invoiceAddress, "\u5730\u5740"),
        }
      : null,
  ].filter((item): item is SummaryRow => !!item);
}

function buildSummaryRowsHtml(rows: SummaryRow[]) {
  return rows
    .map((row) => {
      const isAddress = row.key === "address";
      const rowClass = isAddress ? "summary-row summary-row-address" : "summary-row";
      const valueClass = isAddress ? "summary-value summary-value-address" : "summary-value";
      const fullAddressAttrs = isAddress
        ? ` role="button" tabindex="0" title="${escapeHtml(row.value)}" data-full-address="${escapeHtml(row.value)}"`
        : "";
      const valueTranslateAttrs = row.translateValue ? "" : ` data-no-translate="1"`;
      return `
        <div class="${rowClass}">
          <div class="summary-copy">
            <strong class="summary-label">${escapeHtml(row.label)}：</strong>
            <span class="${valueClass}"${valueTranslateAttrs}${fullAddressAttrs}>${escapeHtml(row.value)}</span>
          </div>
          ${row.actionHtml ? `<div class="summary-action">${row.actionHtml}</div>` : ""}
        </div>`;
    })
    .join("");
}

function buildInvoiceSummarySectionHtml(rows: SummaryRow[]) {
  if (rows.length === 0) return "";
  return `
    <div class="invoice-summary">
      <div class="invoice-title">\u5f00\u7968\u4fe1\u606f</div>
      <div class="invoice-body">${buildSummaryRowsHtml(rows)}</div>
    </div>`;
}

function buildSummaryActionHtmlFromKey(key: MerchantBusinessCardContactDisplayKey, label: string, value: string) {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) return "";
  if (key === "douyin") {
    return buildDouyinActionHtml(normalizedValue);
  }
  if (key === "discord") {
    return buildDiscordActionHtml(normalizedValue);
  }
  switch (key) {
    case "phone":
      return buildActionButtonHtml({
        href: buildPhoneHref(normalizedValue),
        label: label === "电话" ? "拨号" : `拨打${label}`,
        iconSvg: buildInlineSvgIcon("phone"),
        bgColor: "#007AFF",
      });
    case "email":
      return buildActionButtonHtml({
        href: `mailto:${normalizedValue}`,
        label: "发送邮件",
        iconUrl: "/social-icons/maildotru.svg",
        bgColor: "#0A84FF",
      });
    case "address":
      return buildActionButtonHtml({
        href: buildAddressHref(normalizedValue),
        label: "导航",
        iconSvg: buildInlineSvgIcon("map"),
        bgColor: "#EA4335",
      });
    case "wechat":
      return buildWeChatActionHtml(normalizedValue);
    case "whatsapp":
      return buildActionButtonHtml({
        href: buildSocialHref("WhatsApp", normalizedValue),
        label: "打开 WhatsApp",
        iconUrl: "/social-icons/whatsapp.svg",
        bgColor: "#25D366",
      });
    case "twitter":
      return buildActionButtonHtml({
        href: buildSocialHref("Twitter", normalizedValue),
        label: "打开 Twitter",
        iconUrl: "/social-icons/twitter.svg",
        bgColor: "#111827",
      });
    case "weibo":
      return buildActionButtonHtml({
        href: `https://weibo.com/n/${encodeURIComponent(normalizedValue.replace(/^@+/, ""))}`,
        label: "打开微博",
        iconUrl: "/social-icons/weibo.svg",
        bgColor: "#E6162D",
      });
    case "telegram":
      return buildActionButtonHtml({
        href: buildSocialHref("Telegram", normalizedValue),
        label: "打开 Telegram",
        iconUrl: "/social-icons/telegram.svg",
        bgColor: "#229ED9",
      });
    case "linkedin":
      return buildActionButtonHtml({
        href: buildSocialHref("LinkedIn", normalizedValue),
        label: "打开 LinkedIn",
        iconUrl: "/social-icons/linkedin.svg",
        bgColor: "#0A66C2",
      });
    case "facebook":
      return buildActionButtonHtml({
        href: buildSocialHref("Facebook", normalizedValue),
        label: "打开 Facebook",
        iconUrl: "/social-icons/facebook.svg",
        bgColor: "#1877F2",
      });
    case "instagram":
      return buildActionButtonHtml({
        href: buildSocialHref("Instagram", normalizedValue),
        label: "打开 Instagram",
        iconUrl: "/social-icons/instagram.svg",
        bgColor: "#E4405F",
      });
    case "tiktok":
      return buildActionButtonHtml({
        href: buildSocialHref("TikTok", normalizedValue),
        label: "打开 TikTok",
        iconUrl: "/social-icons/tiktok.svg",
        bgColor: "#111827",
      });
    case "xiaohongshu":
      return buildActionButtonHtml({
        href: `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(normalizedValue)}`,
        label: "打开小红书",
        iconUrl: "/social-icons/xiaohongshu.svg",
        bgColor: "#FF2442",
      });
    case "googleReview":
      return buildActionButtonHtml({
        href: buildGoogleReviewHref(normalizedValue),
        label: "Open Google review",
        iconUrl: "/social-icons/google.svg",
        bgColor: "#ffffff",
      });
    default:
      return "";
  }
}

function normalizeCustomContactHref(value?: string) {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  if (looksLikeUrl(normalized)) return normalized;
  if (/^(mailto|tel|sms|weixin):/i.test(normalized)) return normalized;
  const withProtocol = `https://${normalized.replace(/^\/+/, "")}`;
  return looksLikeUrl(withProtocol) && /\./.test(normalized) ? withProtocol : "";
}

function resolveCustomContactIconSvg(iconPreset?: string) {
  const preset = normalizeText(iconPreset);
  if (
    preset === "star" ||
    preset === "heart" ||
    preset === "chat" ||
    preset === "map" ||
    preset === "gift" ||
    preset === "google" ||
    preset === "download" ||
    preset === "review" ||
    preset === "favorite" ||
    preset === "checkin"
  ) {
    return buildInlineSvgIcon(preset);
  }
  return buildInlineSvgIcon("link");
}

function buildCustomContactLinkRows(customLinks?: MerchantBusinessCardCustomContactLink[]): SummaryRow[] {
  if (!Array.isArray(customLinks)) return [];
  return customLinks
    .map((item, index) => {
      const label = normalizeText(item.label) || `自定义${index + 1}`;
      const value = normalizeText(item.displayText) || normalizeText(item.url);
      if (!value) return null;
      return {
        label,
        value,
        actionHtml: buildActionButtonHtml({
          href: normalizeCustomContactHref(item.url),
          label,
          iconUrl: normalizeText(item.iconUrl),
          iconSvg: normalizeText(item.iconUrl) ? undefined : resolveCustomContactIconSvg(item.iconPreset),
          bgColor: normalizeText(item.bgColor) || "#0f172a",
        }),
      } satisfies SummaryRow;
    })
    .filter((item): item is SummaryRow => !!item);
}

function resolveContactNoteKey(label: string): MerchantBusinessCardContactDisplayKey | null {
  const normalizedLabel = normalizeText(label);
  if (!normalizedLabel) return null;
  if (/^工作\d*$/u.test(normalizedLabel)) return "phone";
  switch (normalizedLabel) {
    case "联系人":
      return "contactName";
    case "电话":
      return "phone";
    case "邮箱":
      return "email";
    case "地址":
      return "address";
    case "微信":
      return "wechat";
    case "WhatsApp":
      return "whatsapp";
    case "Twitter":
      return "twitter";
    case "微博":
      return "weibo";
    case "Telegram":
      return "telegram";
    case "LinkedIn":
      return "linkedin";
    case "Discord":
      return "discord";
    case "Facebook":
      return "facebook";
    case "Instagram":
      return "instagram";
    case "TikTok":
      return "tiktok";
    case "抖音":
      return "douyin";
    case "小红书":
      return "xiaohongshu";
    case "Google":
      return "googleReview";
    default:
      return null;
  }
}

function buildContactNoteFallbackRows(note?: string) {
  const rowsByKey: Partial<Record<MerchantBusinessCardContactDisplayKey, SummaryRow[]>> = {};
  const normalizedNote = normalizeText(note);
  if (!normalizedNote) return rowsByKey;

  for (const line of normalizedNote.split(/\r?\n+/).map((item) => item.trim()).filter(Boolean)) {
    const match = line.match(/^([^:：]+)\s*[:：]\s*(.+)$/u);
    if (!match) continue;
    const label = normalizeText(match[1]);
    const value = normalizeText(match[2]);
    const key = resolveContactNoteKey(label);
    if (!key || !value) continue;
    const row: SummaryRow = {
      label,
      value: key === "googleReview" ? GOOGLE_REVIEW_DISPLAY_TEXT : value,
      actionHtml: buildSummaryActionHtmlFromKey(key, label, value),
      key,
      translateValue: key === "googleReview",
    };
    rowsByKey[key] = [...(rowsByKey[key] ?? []), row];
  }

  return rowsByKey;
}

function buildLanguageSwitcherHtml() {
  const asiaOptions = LANGUAGE_OPTIONS.filter((item) => item.region === "asia");
  const preferredCodes = ["en-GB", "es-ES"];
  const europeOptions = (() => {
    const europe = LANGUAGE_OPTIONS.filter((item) => item.region === "europe");
    const preferred = preferredCodes
      .map((code) => europe.find((item) => item.code === code))
      .filter((item): item is (typeof LANGUAGE_OPTIONS)[number] => Boolean(item));
    const rest = europe.filter((item) => !preferredCodes.includes(item.code));
    return [...preferred, ...rest];
  })();
  const renderGroup = (label: string, options: typeof LANGUAGE_OPTIONS) =>
    `<optgroup label="${escapeHtml(label)}">
      ${options
        .map(
          (item) =>
            `<option value="${escapeHtml(item.code)}"${item.code === DEFAULT_LOCALE ? " selected" : ""}>${escapeHtml(item.label)}</option>`,
        )
        .join("")}
    </optgroup>`;

  const defaultOption = LANGUAGE_OPTIONS.find((item) => item.code === DEFAULT_LOCALE) ?? LANGUAGE_OPTIONS[0];
  const defaultFlag = defaultOption ? buildLanguageFlagUrl(defaultOption.countryCode) : "";

  return `<label class="lang-switcher" data-no-translate="1" title="${escapeHtml(defaultOption?.label ?? DEFAULT_LOCALE)}" aria-label="Select language">
    ${
      defaultFlag
        ? `<img data-language-flag src="${escapeHtml(defaultFlag)}" alt="${escapeHtml(defaultOption?.label ?? DEFAULT_LOCALE)}" width="80" height="60" decoding="async" />`
        : ""
    }
    <span class="lang-switcher-sr" data-language-label>${escapeHtml(defaultOption?.label ?? DEFAULT_LOCALE)}</span>
    <select id="contact-card-language" aria-label="Select language">
      ${renderGroup("Asia", asiaOptions)}
      ${renderGroup("Europe", europeOptions)}
    </select>
  </label>`;
}

function buildInlineI18nScript() {
  const languageOptions = LANGUAGE_OPTIONS.map(({ code, label, countryCode }) => ({
    code,
    label,
    countryCode,
  }));

  return `(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const STORAGE_KEY = ${serializeInlineScriptValue(I18N_STORAGE_KEY)};
    const CONTACT_CARD_STORAGE_KEY = STORAGE_KEY + ":contact-card";
    const CACHE_PREFIX = "merchant-space:dom-i18n-cache:v3:";
    const DEFAULT_LOCALE = ${serializeInlineScriptValue(DEFAULT_LOCALE)};
    const LANGUAGE_OPTIONS = ${serializeInlineScriptValue(languageOptions)};
    const FIXED_TRANSLATIONS = ${serializeInlineScriptValue({
      [GOOGLE_REVIEW_DISPLAY_TEXT]: GOOGLE_REVIEW_DISPLAY_TRANSLATIONS,
    })};
    const INTRO_UNMUTE_TEXT = {
      "zh-CN": "点按屏幕取消静音",
      "zh-TW": "點按螢幕取消靜音",
      "ja-JP": "画面をタップしてミュート解除",
      "ko-KR": "화면을 탭해 음소거 해제",
      "en-GB": "Tap screen to unmute",
      "es-ES": "Toca la pantalla para activar el sonido",
      "de-DE": "Tippe auf den Bildschirm, um den Ton einzuschalten",
      "fr-FR": "Touchez l'ecran pour activer le son",
      "tr-TR": "Sesi acmak icin ekrana dokunun",
      "it-IT": "Tocca lo schermo per attivare l'audio",
      "pl-PL": "Dotknij ekranu, aby wlaczyc dzwiek",
      "uk-UA": "Торкніться екрана, щоб увімкнути звук",
      "nl-NL": "Tik op het scherm om het geluid aan te zetten",
      "ro-RO": "Atinge ecranul pentru a activa sunetul",
      "pt-PT": "Toque no ecra para ativar o som",
      "ru-RU": "Коснитесь экрана, чтобы включить звук",
      "el-GR": "Πατήστε την οθόνη για άρση σίγασης",
      "cs-CZ": "Klepnete na obrazovku pro zapnuti zvuku",
      "sv-SE": "Tryck pa skarmen for att sla pa ljudet",
      "hu-HU": "Erintse meg a kepernyot a hang bekapcsolasahoz",
      "be-BY": "Дакраніцеся да экрана, каб уключыць гук",
      "bg-BG": "Докоснете екрана, за да включите звука",
      "sr-RS": "Dodirnite ekran da ukljucite zvuk",
      "da-DK": "Tryk pa skaermen for at sla lyden til",
      "fi-FI": "Napauta nayttoa poistaaksesi mykistyksen",
      "sk-SK": "Klepnutim na obrazovku zapnete zvuk",
      "no-NO": "Trykk pa skjermen for a sla pa lyden",
      "hr-HR": "Dodirnite zaslon za ukljucivanje zvuka",
      "bs-BA": "Dodirnite ekran da ukljucite zvuk",
      "sq-AL": "Prekni ekranin per te aktivizuar zerin",
      "lt-LT": "Palieskite ekrana, kad ijungtumete garsa",
      "sl-SI": "Dotaknite se zaslona za vklop zvoka",
      "lv-LV": "Pieskarieties ekranam, lai ieslegtu skanu",
      "et-EE": "Heli sisselulitamiseks puudutage ekraani",
      "mk-MK": "Допрете го екранот за да го вклучите звукот",
      "ca-ES": "Toca la pantalla per activar el so",
      "eu-ES": "Ukitu pantaila soinua aktibatzeko",
      "gl-ES": "Toca a pantalla para activar o son",
      "cy-GB": "Tapiwch y sgrin i droi'r sain ymlaen",
      "is-IS": "Pikkadu a skjainn til ad kveikja a hljodi",
      "ga-IE": "Tapail an scailean chun an fhuaim a chur ar siol",
      "mt-MT": "Tektek l-iskrin biex tixghel il-hoss",
      "lb-LU": "Tippt op den Ecran fir den Toun unzeschalten"
    };
    const INTRO_SKIP_TEXT = {
      "zh-CN": "跳过",
      "zh-TW": "跳過",
      "ja-JP": "スキップ",
      "ko-KR": "건너뛰기",
      "en-GB": "Skip",
      "es-ES": "Saltar",
      "de-DE": "Überspringen",
      "fr-FR": "Passer",
      "tr-TR": "Atla",
      "it-IT": "Salta",
      "pl-PL": "Pomiń",
      "pt-PT": "Saltar",
      "ru-RU": "Пропустить"
    };
    const INTRO_SOUND_TEXT = {
      "zh-CN": "开启声音",
      "zh-TW": "開啟聲音",
      "ja-JP": "音声をオン",
      "ko-KR": "소리 켜기",
      "en-GB": "Turn on sound",
      "es-ES": "Activar sonido",
      "de-DE": "Ton einschalten",
      "fr-FR": "Activer le son",
      "tr-TR": "Sesi aç",
      "it-IT": "Attiva audio",
      "pl-PL": "Włącz dźwięk",
      "pt-PT": "Ativar som",
      "ru-RU": "Включить звук"
    };
    const TRANSLATABLE_ATTRS = ["placeholder", "title", "aria-label"];
    const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT"]);
    const localeCacheStore = new Map();
    const reverseLocaleCacheStore = new Map();
    const loadedLocaleCache = new Set();
    const inFlightByLocale = new Map();
    let persistTimer = null;

    function resolveLocale(input) {
      const normalized = String(input || "").trim();
      if (!normalized) return DEFAULT_LOCALE;
      if (LANGUAGE_OPTIONS.some((item) => item.code === normalized)) return normalized;
      const language = normalized.toLowerCase().split("-")[0] || "";
      const matched = LANGUAGE_OPTIONS.find((item) => item.code.toLowerCase().startsWith(language + "-"));
      return matched ? matched.code : DEFAULT_LOCALE;
    }

    function getLanguageFlagUrl(countryCode) {
      const code = String(countryCode || "").trim().toLowerCase();
      return code ? "https://flagcdn.com/" + encodeURIComponent(code) + ".svg" : "";
    }

    function resolveFixedTranslation(source, locale) {
      const translations = FIXED_TRANSLATIONS[source];
      if (!translations) return "";
      const normalized = resolveLocale(locale);
      const language = normalized.toLowerCase().split("-")[0] || "";
      const languageMatch = LANGUAGE_OPTIONS.find((item) => item.code.toLowerCase().startsWith(language + "-"))?.code || "";
      return translations[normalized] || translations[languageMatch] || translations["en-GB"] || "";
    }

    function resolveFixedSource(input, locale) {
      const normalized = resolveLocale(locale);
      for (const source of Object.keys(FIXED_TRANSLATIONS)) {
        if (source === input || resolveFixedTranslation(source, normalized) === input) return source;
      }
      return "";
    }

    function readRequestedLocaleFromSearch(search) {
      try {
        const params = new URLSearchParams(String(search || "").replace(/^\\?/, ""));
        const requested = params.get("uiLocale") || params.get("locale") || params.get("lang") || "";
        return requested ? resolveLocale(requested) : "";
      } catch {
        return "";
      }
    }

    function readStoredLocaleCookie() {
      try {
        const match = String(document.cookie || "").match(/(?:^|;\\s*)merchant-space-locale-v1=([^;]+)/);
        return match?.[1] ? resolveLocale(decodeURIComponent(match[1])) : "";
      } catch {
        return "";
      }
    }

    function readStoredLocaleFromKey(key) {
      try {
        const stored = window.localStorage.getItem(key);
        return stored ? resolveLocale(stored) : "";
      } catch {
        return "";
      }
    }

    function detectSystemLocale() {
      const navigatorLanguages =
        Array.isArray(window.navigator.languages) && window.navigator.languages.length > 0
          ? window.navigator.languages
          : [window.navigator.language];
      for (const item of navigatorLanguages) {
        const resolved = resolveLocale(item);
        if (resolved) return resolved;
      }
      return "";
    }

    function detectInitialLocale() {
      const requested = readRequestedLocaleFromSearch(window.location.search);
      if (requested) return requested;
      const contactCardStored = readStoredLocaleFromKey(CONTACT_CARD_STORAGE_KEY);
      if (contactCardStored) return contactCardStored;
      const systemLocale = detectSystemLocale();
      if (systemLocale) return systemLocale;
      const stored = readStoredLocaleFromKey(STORAGE_KEY);
      if (stored) return stored;
      const cookieLocale = readStoredLocaleCookie();
      if (cookieLocale) return cookieLocale;
      return DEFAULT_LOCALE;
    }

    function toApiTarget(locale) {
      const normalized = resolveLocale(locale).toLowerCase();
      if (normalized === "zh-cn") return "zh-CN";
      if (normalized === "zh-tw") return "zh-TW";
      return normalized.split("-")[0] || "en";
    }

    function splitOuterWhitespace(input) {
      const match = String(input || "").match(/^(\\s*)([\\s\\S]*?)(\\s*)$/);
      if (!match) return { leading: "", core: String(input || ""), trailing: "" };
      return { leading: match[1] || "", core: match[2] || "", trailing: match[3] || "" };
    }

    function hasLetterLikeContent(input) {
      return /[A-Za-z\\u00C0-\\u024F\\u0370-\\u03FF\\u0400-\\u04FF\\u3040-\\u30FF\\uAC00-\\uD7AF\\u3400-\\u9FFF]/.test(input);
    }

    function isLikelyCodeOrToken(input) {
      if (/^(https?:\\/\\/|www\\.)/i.test(input)) return true;
      if (/\\S+@\\S+/.test(input)) return true;
      if (/^[\\w-./:@#%?=&]+$/.test(input) && !input.includes(" ")) return true;
      return false;
    }

    function shouldTranslateCoreText(input, locale) {
      if (toApiTarget(locale) === "zh-CN") return false;
      const trimmed = String(input || "").trim();
      if (!trimmed || trimmed.length > 320) return false;
      if (!hasLetterLikeContent(trimmed)) return false;
      if (isLikelyCodeOrToken(trimmed)) return false;
      if (/^[0-9\\s.,:;!?%+\\-_/()[\\]{}|]+$/.test(trimmed)) return false;
      return true;
    }

    function getLocaleCache(locale) {
      const normalized = resolveLocale(locale);
      let map = localeCacheStore.get(normalized);
      if (!map) {
        map = new Map();
        localeCacheStore.set(normalized, map);
      }
      if (!loadedLocaleCache.has(normalized)) {
        loadedLocaleCache.add(normalized);
        try {
          const raw = window.localStorage.getItem(CACHE_PREFIX + normalized);
          if (raw) {
            const parsed = JSON.parse(raw);
            Object.entries(parsed || {}).forEach(([source, translated]) => {
              if (!source || typeof source !== "string") return;
              if (!translated || typeof translated !== "string") return;
              map.set(source, translated);
            });
          }
        } catch {}
      }
      return map;
    }

    function getReverseLocaleCache(locale) {
      const normalized = resolveLocale(locale);
      const cache = getLocaleCache(normalized);
      const existing = reverseLocaleCacheStore.get(normalized);
      if (existing && existing.size >= cache.size) return existing;
      const reverse = new Map();
      cache.forEach((translated, source) => {
        if (!reverse.has(translated)) reverse.set(translated, source);
      });
      reverseLocaleCacheStore.set(normalized, reverse);
      return reverse;
    }

    function schedulePersist() {
      if (persistTimer !== null) return;
      persistTimer = window.setTimeout(() => {
        persistTimer = null;
        localeCacheStore.forEach((cache, locale) => {
          try {
            window.localStorage.setItem(CACHE_PREFIX + locale, JSON.stringify(Object.fromEntries(cache.entries())));
          } catch {}
        });
      }, 320);
    }

    function setCachedTranslation(locale, source, translated) {
      const normalized = resolveLocale(locale);
      const cache = getLocaleCache(normalized);
      cache.set(source, translated);
      const reverse = getReverseLocaleCache(normalized);
      if (!reverse.has(translated)) reverse.set(translated, source);
      schedulePersist();
    }

    function translateDomText(input, locale) {
      const normalized = resolveLocale(locale);
      if (toApiTarget(normalized) === "zh-CN") return input;
      const parts = splitOuterWhitespace(input);
      const fixed = resolveFixedTranslation(parts.core, normalized);
      if (fixed) return parts.leading + fixed + parts.trailing;
      if (!shouldTranslateCoreText(parts.core, normalized)) return input;
      const translated = getLocaleCache(normalized).get(parts.core);
      return translated ? parts.leading + translated + parts.trailing : input;
    }

    function reverseTranslateDomText(input, locale) {
      const normalized = resolveLocale(locale);
      if (toApiTarget(normalized) === "zh-CN") return input;
      const parts = splitOuterWhitespace(input);
      if (!parts.core) return null;
      const fixedSource = resolveFixedSource(parts.core, normalized);
      if (fixedSource) return parts.leading + fixedSource + parts.trailing;
      const source = getReverseLocaleCache(normalized).get(parts.core);
      return source ? parts.leading + source + parts.trailing : null;
    }

    async function requestTranslation(source, locale) {
      const target = toApiTarget(locale);
      if (target === "zh-CN") return source;
      const query = new URLSearchParams({ client: "gtx", sl: "auto", tl: target, dt: "t", q: source });
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch("https://translate.googleapis.com/translate_a/single?" + query.toString(), {
          method: "GET",
          signal: controller.signal,
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) return source;
        const json = await response.json();
        if (!Array.isArray(json) || !Array.isArray(json[0])) return source;
        const translated = json[0]
          .map((segment) => Array.isArray(segment) ? segment[0] : "")
          .filter((item) => typeof item === "string")
          .join("")
          .trim();
        return translated || source;
      } catch {
        return source;
      } finally {
        window.clearTimeout(timer);
      }
    }

    async function getOrRequestTranslation(source, locale) {
      const normalized = resolveLocale(locale);
      const cache = getLocaleCache(normalized);
      const cached = cache.get(source);
      if (cached) return cached;
      let localeInflight = inFlightByLocale.get(normalized);
      if (!localeInflight) {
        localeInflight = new Map();
        inFlightByLocale.set(normalized, localeInflight);
      }
      const inflight = localeInflight.get(source);
      if (inflight) return inflight;
      const promise = requestTranslation(source, normalized)
        .then((translated) => {
          const value = translated || source;
          setCachedTranslation(normalized, source, value);
          return value;
        })
        .finally(() => {
          localeInflight.delete(source);
        });
      localeInflight.set(source, promise);
      return promise;
    }

    async function ensureDomTranslations(texts, locale) {
      const normalized = resolveLocale(locale);
      if (toApiTarget(normalized) === "zh-CN") return;
      const queue = [];
      const seen = new Set();
      texts.forEach((text) => {
        const core = splitOuterWhitespace(text).core;
        if (!core || !shouldTranslateCoreText(core, normalized)) return;
        if (resolveFixedTranslation(core, normalized)) return;
        if (getLocaleCache(normalized).has(core) || seen.has(core)) return;
        seen.add(core);
        queue.push(core);
      });
      const workers = Array.from({ length: Math.max(1, Math.min(6, queue.length)) }).map(async () => {
        while (queue.length > 0) {
          const next = queue.shift();
          if (!next) break;
          await getOrRequestTranslation(next, normalized);
        }
      });
      await Promise.all(workers);
    }

    function isEditableElement(element) {
      if (!element) return false;
      if (element instanceof HTMLInputElement) {
        return !["button", "submit", "reset", "checkbox", "radio", "file", "color", "range"].includes(element.type);
      }
      if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true;
      return element instanceof HTMLElement && element.isContentEditable;
    }

    function ensureElementSources(element) {
      if (!element.__merchantSourceAttrs) element.__merchantSourceAttrs = {};
      return element.__merchantSourceAttrs;
    }

    function getTextSource(node) {
      if (typeof node.__merchantSourceText === "string") return node.__merchantSourceText;
      const initial = node.nodeValue || "";
      node.__merchantSourceText = initial;
      return initial;
    }

    function applyTextNode(node, locale, missing, sourceRecoveryLocale) {
      let source = getTextSource(node);
      if (locale === "zh-CN") {
        if (sourceRecoveryLocale && source === (node.nodeValue || "")) {
          const recovered = reverseTranslateDomText(source, sourceRecoveryLocale);
          if (recovered && recovered !== source) {
            source = recovered;
            node.__merchantSourceText = recovered;
          }
        }
        if ((node.nodeValue || "") !== source) node.nodeValue = source;
        return;
      }
      const translated = translateDomText(source, locale);
      if (translated !== source) {
        if ((node.nodeValue || "") !== translated) node.nodeValue = translated;
        return;
      }
      const core = splitOuterWhitespace(source).core;
      if (shouldTranslateCoreText(core, locale) && !getLocaleCache(locale).has(core)) {
        missing.add(source);
      }
    }

    function applyAttrs(element, locale, missing, sourceRecoveryLocale) {
      const sources = ensureElementSources(element);
      TRANSLATABLE_ATTRS.forEach((attr) => {
        const current = element.getAttribute(attr);
        if (typeof sources[attr] !== "string") sources[attr] = current || "";
        let source = sources[attr] || "";
        if (!source) return;
        if (locale === "zh-CN") {
          if (sourceRecoveryLocale && source === (current || "")) {
            const recovered = reverseTranslateDomText(source, sourceRecoveryLocale);
            if (recovered && recovered !== source) {
              source = recovered;
              sources[attr] = recovered;
            }
          }
          if ((current || "") !== source) element.setAttribute(attr, source);
          return;
        }
        const translated = translateDomText(source, locale);
        if (translated !== source) {
          if ((current || "") !== translated) element.setAttribute(attr, translated);
          return;
        }
        const core = splitOuterWhitespace(source).core;
        if (shouldTranslateCoreText(core, locale) && !getLocaleCache(locale).has(core)) {
          missing.add(source);
        }
      });
    }

    function traverse(root, locale, missing, skipSubtree, sourceRecoveryLocale) {
      if (!root) return;
      if (root.nodeType === Node.TEXT_NODE) {
        const parentElement = root.parentElement;
        const shouldSkip = skipSubtree || !!parentElement?.closest("[data-no-translate='1']") || isEditableElement(parentElement);
        if (!shouldSkip) applyTextNode(root, locale, missing, sourceRecoveryLocale);
        return;
      }
      if (root.nodeType !== Node.ELEMENT_NODE) return;
      const element = root;
      const nextSkip =
        skipSubtree ||
        !!element.closest("[data-no-translate='1']") ||
        element.getAttribute("data-no-translate") === "1" ||
        SKIP_TAGS.has(element.tagName.toUpperCase()) ||
        isEditableElement(element);
      if (!nextSkip) applyAttrs(element, locale, missing, sourceRecoveryLocale);
      Array.from(element.childNodes).forEach((child) => traverse(child, locale, missing, nextSkip, sourceRecoveryLocale));
    }

    function updateLanguageUi(locale) {
      const normalized = resolveLocale(locale);
      const selected = LANGUAGE_OPTIONS.find((item) => item.code === normalized) || LANGUAGE_OPTIONS[0];
      const labelEl = document.querySelector("[data-language-label]");
      const flagEl = document.querySelector("[data-language-flag]");
      const selectEl = document.getElementById("contact-card-language");
      const switcherEl = document.querySelector(".lang-switcher");
      if (labelEl && selected) labelEl.textContent = selected.label;
      if (flagEl && selected) {
        flagEl.setAttribute("src", getLanguageFlagUrl(selected.countryCode));
        flagEl.setAttribute("alt", selected.label);
      }
      if (switcherEl && selected) {
        switcherEl.setAttribute("title", selected.label);
        switcherEl.setAttribute("aria-label", selected.label);
      }
      if (selectEl && selectEl.value !== normalized) selectEl.value = normalized;
    }

    function resolveIntroText(map, locale, fallbackLocale) {
      const normalized = resolveLocale(locale);
      const language = normalized.toLowerCase().split("-")[0] || "";
      return map[normalized] || map[LANGUAGE_OPTIONS.find((item) => item.code.toLowerCase().startsWith(language + "-"))?.code || ""] || map[fallbackLocale] || map["en-GB"];
    }

    function updateIntroControls(locale) {
      const normalized = resolveLocale(locale);
      const prompt = document.querySelector("[data-intro-unmute-tip]");
      if (prompt) prompt.textContent = resolveIntroText(INTRO_UNMUTE_TEXT, normalized, "en-GB");
      const skip = document.querySelector("[data-intro-skip]");
      if (skip) skip.textContent = resolveIntroText(INTRO_SKIP_TEXT, normalized, "en-GB");
      const sound = document.querySelector("[data-intro-unmute]");
      if (sound) sound.textContent = resolveIntroText(INTRO_SOUND_TEXT, normalized, "en-GB");
    }

    async function applyLocale(locale, options = {}) {
      const normalized = resolveLocale(locale);
      const previousLocale = document.documentElement.getAttribute("data-ui-locale") || "zh-CN";
      document.documentElement.lang = normalized;
      document.documentElement.setAttribute("data-ui-locale", normalized);
      updateLanguageUi(normalized);
      updateIntroControls(normalized);
      if (options.persist === true) {
        try {
          window.localStorage.setItem(CONTACT_CARD_STORAGE_KEY, normalized);
          window.localStorage.setItem(STORAGE_KEY, normalized);
        } catch {}
      }
      const sourceRecoveryLocale = normalized === "zh-CN" && previousLocale.toLowerCase() !== "zh-cn" ? previousLocale : null;
      const missing = new Set();
      traverse(document.body, normalized, missing, false, sourceRecoveryLocale);
      if (normalized === "zh-CN" || missing.size === 0) return;
      await ensureDomTranslations(missing, normalized);
      traverse(document.body, normalized, new Set(), false, sourceRecoveryLocale);
    }

    const selectEl = document.getElementById("contact-card-language");
    if (selectEl) {
      selectEl.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLSelectElement)) return;
        void applyLocale(target.value, { persist: true });
      });
    }

    let wechatToastTimer = null;

    function showWechatToast(message, duration) {
      let toast = document.getElementById("wechat-open-toast");
      if (!toast) {
        toast = document.createElement("div");
        toast.id = "wechat-open-toast";
        toast.setAttribute("data-no-translate", "1");
        toast.style.position = "fixed";
        toast.style.left = "50%";
        toast.style.bottom = "24px";
        toast.style.transform = "translateX(-50%)";
        toast.style.maxWidth = "min(calc(100vw - 32px), 420px)";
        toast.style.padding = "10px 14px";
        toast.style.borderRadius = "14px";
        toast.style.background = "rgba(15,23,42,.92)";
        toast.style.color = "#fff";
        toast.style.fontSize = "13px";
        toast.style.lineHeight = "1.5";
        toast.style.boxShadow = "0 18px 40px rgba(15,23,42,.24)";
        toast.style.zIndex = "40";
        toast.style.opacity = "0";
        toast.style.pointerEvents = "none";
        toast.style.transition = "opacity .18s ease";
        document.body.appendChild(toast);
      }
      toast.textContent = String(message || "").trim();
      toast.style.opacity = "1";
      if (wechatToastTimer !== null) window.clearTimeout(wechatToastTimer);
      wechatToastTimer = window.setTimeout(() => {
        toast.style.opacity = "0";
      }, Number(duration) > 0 ? Number(duration) : 2400);
    }

    async function copyWechatId(value) {
      const normalized = String(value || "").trim();
      if (!normalized) return false;
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          await navigator.clipboard.writeText(normalized);
          return true;
        }
      } catch {}
      try {
        const textarea = document.createElement("textarea");
        textarea.value = normalized;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.left = "-99999px";
        textarea.style.top = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const copied = document.execCommand("copy");
        textarea.remove();
        return copied;
      } catch {
        return false;
      }
    }

    function launchWechatScheme(url) {
      const href = String(url || "").trim();
      if (!href) return;
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => {
        if (document.visibilityState === "visible") {
          window.location.href = href;
        }
      }, 12);
    }

    function isWechatBrowser() {
      try {
        return /micromessenger/i.test(String(navigator.userAgent || ""));
      } catch {
        return false;
      }
    }

    function navigateToUrl(url) {
      const href = String(url || "").trim();
      if (!href) return;
      try {
        window.location.assign(href);
      } catch {
        window.location.href = href;
      }
    }

    function openTargetUrl(url) {
      const href = String(url || "").trim();
      if (!href) return;
      if (!isWechatBrowser()) {
        navigateToUrl(href);
        return;
      }
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => {
        if (document.visibilityState === "visible") {
          navigateToUrl(href);
        }
      }, 24);
      window.setTimeout(() => {
        if (document.visibilityState === "visible") {
          showWechatToast("若未成功跳转，请点右上角并选择在浏览器中打开");
        }
      }, 720);
    }

    const wechatButtons = Array.from(document.querySelectorAll("[data-wechat-primary]"));
    wechatButtons.forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        const target = event.currentTarget;
        if (!(target instanceof HTMLElement)) return;
        const wechatId = String(target.dataset.wechatId || "").trim();
        const wechatAppHref = String(target.dataset.wechatPrimary || "weixin://").trim();
        if (!wechatId) return;
        const copied = await copyWechatId(wechatId);
        showWechatToast(
          copied
            ? "\u5df2\u590d\u5236\u5fae\u4fe1\u53f7\uff0c\u6b63\u5728\u5c1d\u8bd5\u6253\u5f00\u5fae\u4fe1\uff0c\u8bf7\u7c98\u8d34\u641c\u7d22\uff1a" + wechatId
            : "\u8bf7\u8bb0\u4e0b\u5fae\u4fe1\u53f7\u540e\u6253\u5f00\u5fae\u4fe1\u641c\u7d22\uff1a" + wechatId,
        );
        launchWechatScheme(wechatAppHref || "weixin://");
      });
    });

    const douyinButtons = Array.from(document.querySelectorAll("[data-douyin-primary]"));
    douyinButtons.forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        const target = event.currentTarget;
        if (!(target instanceof HTMLElement)) return;
        const douyinId = String(target.dataset.douyinId || "").trim();
        const douyinAppHref = String(target.dataset.douyinPrimary || "snssdk1128://").trim();
        if (!douyinId) return;
        const copied = await copyWechatId(douyinId);
        showWechatToast(
          copied
            ? "\u5df2\u590d\u5236\u6296\u97f3\u53f7\uff0c\u6b63\u5728\u5c1d\u8bd5\u6253\u5f00\u6296\u97f3\uff0c\u8bf7\u7c98\u8d34\u641c\u7d22\uff1a" + douyinId
            : "\u8bf7\u8bb0\u4e0b\u6296\u97f3\u53f7\u540e\u6253\u5f00\u6296\u97f3\u641c\u7d22\uff1a" + douyinId,
        );
        launchWechatScheme(douyinAppHref || "snssdk1128://");
      });
    });

    const discordButtons = Array.from(document.querySelectorAll("[data-discord-primary]"));
    discordButtons.forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        const target = event.currentTarget;
        if (!(target instanceof HTMLElement)) return;
        const discordId = String(target.dataset.discordId || "").trim();
        const discordAppHref = String(target.dataset.discordPrimary || "discord://").trim();
        if (!discordId) return;
        const copied = await copyWechatId(discordId);
        showWechatToast(
          copied
            ? "\u5df2\u590d\u5236 Discord \u8d26\u53f7\uff0c\u6b63\u5728\u5c1d\u8bd5\u6253\u5f00 Discord\uff0c\u8bf7\u7c98\u8d34\u641c\u7d22\uff1a" + discordId
            : "\u8bf7\u8bb0\u4e0b Discord \u8d26\u53f7\u540e\u6253\u5f00 Discord \u641c\u7d22\uff1a" + discordId,
        );
        launchWechatScheme(discordAppHref || "discord://");
      });
    });

    const copyButtons = Array.from(document.querySelectorAll("[data-copy-value]"));
    copyButtons.forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        const target = event.currentTarget;
        if (!(target instanceof HTMLElement)) return;
        const copyValue = String(target.dataset.copyValue || "").trim();
        const copyLabel = String(target.dataset.copyLabel || "").trim() || "内容";
        if (!copyValue) return;
        const copied = await copyWechatId(copyValue);
        showWechatToast(copied ? "已复制" + copyLabel : "请手动复制" + copyLabel + "：" + copyValue);
      });
    });

    const fullAddressValues = Array.from(document.querySelectorAll("[data-full-address]"));
    fullAddressValues.forEach((valueEl) => {
      const showFullAddress = (event) => {
        event.preventDefault();
        const target = event.currentTarget;
        if (!(target instanceof HTMLElement)) return;
        const fullAddress = String(target.dataset.fullAddress || "").trim();
        if (!fullAddress) return;
        showWechatToast(fullAddress, 5200);
      };
      valueEl.addEventListener("click", showFullAddress);
      valueEl.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        showFullAddress(event);
      });
    });

    const claimButtons = Array.from(document.querySelectorAll("[data-claim-coupon-id]"));
    claimButtons.forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        const target = event.currentTarget;
        if (!(target instanceof HTMLElement)) return;
        const couponId = String(target.dataset.claimCouponId || "").trim();
        const siteId = String(target.dataset.claimSiteId || "").trim();
        if (!couponId || !siteId) return;
        const originalText = target.textContent || "";
        target.setAttribute("disabled", "disabled");
        target.textContent = "\u6b63\u5728\u9886\u53d6...";
        try {
          const response = await fetch("/api/coupons/claim", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              siteId,
              couponId,
              siteName: document.title || "",
              pageUrl: window.location.href,
            }),
          });
          const payload = await response.json().catch(() => null);
          if (!response.ok) throw new Error(payload && payload.message ? payload.message : "claim_failed");
          if (payload && payload.savedToAccount === true) {
            showWechatToast("\u5df2\u9886\u53d6\uff0c\u5df2\u653e\u5165\u6211\u7684\u4f18\u60e0\u5238");
            target.textContent = "\u5df2\u9886\u53d6";
            return;
          }
          if (payload && typeof payload.claimResultUrl === "string" && payload.claimResultUrl) {
            window.location.assign(payload.claimResultUrl);
            return;
          }
          showWechatToast("\u5df2\u9886\u53d6");
        } catch (claimError) {
          target.removeAttribute("disabled");
          target.textContent = originalText;
          if (String(claimError && claimError.message ? claimError.message : "").includes("coupon_login_required")) {
            const redirect = encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);
            window.location.assign("/login?accountType=personal&redirect=" + redirect);
            return;
          }
          showWechatToast("\u6682\u65f6\u65e0\u6cd5\u9886\u53d6\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5");
        }
      });
    });

    const openTargetButtons = Array.from(document.querySelectorAll("[data-open-target-url]"));
    openTargetButtons.forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const target = event.currentTarget;
        if (!(target instanceof HTMLElement)) return;
        openTargetUrl(String(target.dataset.openTargetUrl || "").trim());
      });
    });

    const initialLocale = detectInitialLocale();
    void applyLocale(initialLocale);
  })();`.replace(/<\/script/gi, "<\\/script");
}

function buildContactSummaryHtmlLegacy(input: {
  name: string;
  contact?: MerchantBusinessCardShareContact;
}) {
  const secondaryPhone = input.contact?.phones?.find((value) => normalizeText(value) && value !== input.contact?.phone) || "";
  const rows = [
    input.contact?.title
      ? { label: "职位", value: input.contact.title, actionHtml: "" }
      : null,
    input.contact?.displayName
      ? { label: "联系人", value: input.contact.displayName, actionHtml: "" }
      : null,
    input.contact?.phone
      ? {
          label: "电话",
          value: input.contact.phone,
          actionHtml: buildActionButtonHtml({
            href: buildPhoneHref(input.contact.phone),
            label: "拨号",
            iconSvg: buildInlineSvgIcon("phone"),
            bgColor: "#007AFF",
          }),
        }
      : null,
    secondaryPhone
      ? {
          label: "工作",
          value: secondaryPhone,
          actionHtml: buildActionButtonHtml({
            href: buildPhoneHref(secondaryPhone),
            label: "拨打工作电话",
            iconSvg: buildInlineSvgIcon("phone"),
            bgColor: "#007AFF",
          }),
        }
      : null,
    input.contact?.email
      ? {
          label: "邮箱",
          value: input.contact.email,
          actionHtml: buildActionButtonHtml({
            href: buildSocialHref("邮箱", input.contact.email),
            label: "发送邮件",
            iconUrl: "/social-icons/maildotru.svg",
            bgColor: "#0A84FF",
          }),
        }
      : null,
    input.contact?.address
      ? {
          key: "address",
          label: "地址",
          value: input.contact.address,
          actionHtml: buildActionButtonHtml({
            href: buildAddressHref(input.contact.address),
            label: "导航",
            iconSvg: buildInlineSvgIcon("map"),
            bgColor: "#EA4335",
          }),
        }
      : null,
    input.contact?.invoiceName
      ? {
          label: "开票名称",
          value: input.contact.invoiceName,
          actionHtml: buildCopyActionHtml(input.contact.invoiceName, "开票名称"),
        }
      : null,
    input.contact?.invoiceTaxNumber
      ? {
          label: "税号",
          value: input.contact.invoiceTaxNumber,
          actionHtml: buildCopyActionHtml(input.contact.invoiceTaxNumber, "税号"),
        }
      : null,
    input.contact?.invoiceAddress
      ? {
          label: "开票地址",
          value: input.contact.invoiceAddress,
          actionHtml: buildCopyActionHtml(input.contact.invoiceAddress, "开票地址"),
        }
      : null,
    input.contact?.wechat
      ? {
          label: "微信",
          value: input.contact.wechat,
          actionHtml: buildWeChatActionHtml(input.contact.wechat),
        }
      : null,
    input.contact?.whatsapp
      ? {
          label: "WhatsApp",
          value: input.contact.whatsapp,
          actionHtml: buildActionButtonHtml({
            href: buildSocialHref("WhatsApp", input.contact.whatsapp),
            label: "打开 WhatsApp",
            iconUrl: "/social-icons/whatsapp.svg",
            bgColor: "#25D366",
          }),
        }
      : null,
    input.contact?.twitter
      ? {
          label: "Twitter",
          value: input.contact.twitter,
          actionHtml: buildActionButtonHtml({
            href: buildSocialHref("Twitter", input.contact.twitter),
            label: "打开 Twitter",
            iconUrl: "/social-icons/twitter.svg",
            bgColor: "#111827",
          }),
        }
      : null,
    input.contact?.weibo
      ? {
          label: "微博",
          value: input.contact.weibo,
          actionHtml: buildActionButtonHtml({
            href: buildSocialHref("微博", input.contact.weibo),
            label: "打开微博",
            iconUrl: "/social-icons/weibo.svg",
            bgColor: "#E6162D",
          }),
        }
      : null,
    input.contact?.telegram
      ? {
          label: "Telegram",
          value: input.contact.telegram,
          actionHtml: buildActionButtonHtml({
            href: buildSocialHref("Telegram", input.contact.telegram),
            label: "打开 Telegram",
            iconUrl: "/social-icons/telegram.svg",
            bgColor: "#229ED9",
          }),
        }
      : null,
    input.contact?.linkedin
      ? {
          label: "LinkedIn",
          value: input.contact.linkedin,
          actionHtml: buildActionButtonHtml({
            href: buildSocialHref("LinkedIn", input.contact.linkedin),
            label: "打开 LinkedIn",
            iconUrl: "/social-icons/linkedin.svg",
            bgColor: "#0A66C2",
          }),
        }
      : null,
    input.contact?.discord
      ? {
          label: "Discord",
          value: input.contact.discord,
          actionHtml: buildDiscordActionHtml(input.contact.discord),
        }
      : null,
    input.contact?.facebook
      ? {
          label: "Facebook",
          value: input.contact.facebook,
          actionHtml: buildActionButtonHtml({
            href: buildSocialHref("Facebook", input.contact.facebook),
            label: "打开 Facebook",
            iconUrl: "/social-icons/facebook.svg",
            bgColor: "#1877F2",
          }),
        }
      : null,
    input.contact?.instagram
      ? {
          label: "Instagram",
          value: input.contact.instagram,
          actionHtml: buildActionButtonHtml({
            href: buildSocialHref("Instagram", input.contact.instagram),
            label: "打开 Instagram",
            iconUrl: "/social-icons/instagram.svg",
            bgColor: "#E4405F",
          }),
        }
      : null,
    input.contact?.tiktok
      ? {
          label: "TikTok",
          value: input.contact.tiktok,
          actionHtml: buildActionButtonHtml({
            href: buildSocialHref("TikTok", input.contact.tiktok),
            label: "打开 TikTok",
            iconUrl: "/social-icons/tiktok.svg",
            bgColor: "#111827",
          }),
        }
      : null,
    input.contact?.douyin
      ? {
          label: "抖音",
          value: input.contact.douyin,
          actionHtml: buildDouyinActionHtml(input.contact.douyin),
        }
      : null,
    input.contact?.xiaohongshu
      ? {
          label: "小红书",
          value: input.contact.xiaohongshu,
          actionHtml: buildActionButtonHtml({
            href: buildSocialHref("小红书", input.contact.xiaohongshu),
            label: "打开小红书",
            iconUrl: "/social-icons/xiaohongshu.svg",
            bgColor: "#FF2442",
          }),
        }
      : null,
  ].filter(Boolean) as SummaryRow[];
  if (input.contact?.googleReview) {
    rows.push({
      label: "Google",
      value: GOOGLE_REVIEW_DISPLAY_TEXT,
      actionHtml: buildSummaryActionHtmlFromKey("googleReview", "Google", input.contact.googleReview),
      key: "googleReview",
      translateValue: true,
    });
  }
  const invoiceRows = buildInvoiceSummaryRows(input.contact);
  const invoiceLegacyLabels = new Set(["\u5f00\u7968\u540d\u79f0", "\u7a0e\u53f7", "\u5f00\u7968\u5730\u5740"]);
  const contactRows = rows.filter((row) => !invoiceLegacyLabels.has(row.label));

  if (contactRows.length === 0 && invoiceRows.length === 0) {
    return `<div class="summary-row"><span class="summary-value" data-no-translate="1">${escapeHtml(normalizeText(input.name) || "电子名片")}</span></div>`;
  }

  return `${buildSummaryRowsHtml(contactRows)}${buildInvoiceSummarySectionHtml(invoiceRows)}`;
}

function buildContactSummaryHtml(input: {
  name: string;
  contact?: MerchantBusinessCardShareContact;
}) {
  return buildOrderedContactSummaryHtml(input) || buildContactSummaryHtmlLegacy(input);
}

function formatCouponDate(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const CONTACT_COUPON_USAGE_LABELS: Record<MerchantCouponUsageScenario, string> = {
  order_cart: "订单",
  checkout_qr: "二维码",
  checkout_barcode: "条码",
  points_redemption: "积分兑换",
};

function formatContactCouponUsageScenarios(coupon: MerchantCouponRecord) {
  return coupon.usageScenarios.map((item) => CONTACT_COUPON_USAGE_LABELS[item]).filter(Boolean).join(" / ");
}

function buildContactCouponTextStyle(coupon: MerchantCouponRecord, role: MerchantCouponDisplayField) {
  const declarations: string[] = [];
  if (coupon.contentFontFamily) declarations.push(`font-family:${escapeHtml(coupon.contentFontFamily)}`);
  const color =
    role === "discount"
      ? coupon.discountTextColor
      : role === "title"
        ? coupon.titleTextColor
        : role === "description"
          ? coupon.descriptionTextColor
          : role === "button"
            ? coupon.buttonTextColor
          : coupon.metaTextColor;
  const fontSize =
    role === "discount"
      ? coupon.discountFontSize
      : role === "title"
        ? coupon.titleFontSize
        : role === "description"
          ? coupon.descriptionFontSize
          : role === "button"
            ? coupon.buttonFontSize
          : coupon.metaFontSize;
  if (color) declarations.push(`color:${escapeHtml(color)}`);
  if (fontSize > 0) declarations.push(`font-size:${Math.round(fontSize)}px`);
  return declarations;
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

function buildContactCouponBoxStyle(boxColor: string, boxStyle: MerchantCouponDisplayBoxStyle) {
  const color = boxColor || "#020617";
  if (boxStyle === "solid") return [`background-color:${escapeHtml(color)}`, `border-color:${escapeHtml(color)}`];
  if (boxStyle === "outline") return [`border-color:${escapeHtml(color)}`];
  if (boxStyle === "soft") {
    const backgroundColor = colorWithAlpha(color, 0.12);
    const borderColor = colorWithAlpha(color, 0.22) || color;
    return [`background-color:${escapeHtml(backgroundColor)}`, `border-color:${escapeHtml(borderColor)}`];
  }
  return [];
}

function buildContactCouponItemStyle(
  coupon: MerchantCouponRecord,
  field: MerchantCouponDisplayField,
  boxColor: string,
  boxStyle: MerchantCouponDisplayBoxStyle,
) {
  const declarations = [...buildContactCouponTextStyle(coupon, field), ...buildContactCouponBoxStyle(boxColor, boxStyle)];
  return declarations.length > 0 ? ` style="${declarations.join(";")}"` : "";
}

function buildContactCouponDefaultMetaText(input: {
  coupon: MerchantCouponRecord;
  usageLabel: string;
  remaining: number | null;
  expiresLabel: string;
}) {
  const { coupon, usageLabel, remaining, expiresLabel } = input;
  return [
    coupon.discountType === "product_voucher" && coupon.productBarcode ? `条码 ${coupon.productBarcode}` : "",
    coupon.discountType === "product_voucher" && coupon.productQuantity > 0 ? `数量 ${coupon.productQuantity}` : "",
    coupon.discountType === "product_voucher" && coupon.productAmount > 0 ? `商品金额 ${coupon.productAmount.toFixed(2)}` : "",
    coupon.discountType === "exchange_voucher" && coupon.exchangeQuantity > 0 ? `数量 ${coupon.exchangeQuantity}` : "",
    coupon.discountType === "ticket_voucher" && coupon.ticketDurationMinutes > 0 ? `时长 ${coupon.ticketDurationMinutes} min` : "",
    coupon.discountType === "points_voucher" && coupon.discountValue > 0 ? `抵扣 ${Math.round(coupon.discountValue)} 积分` : "",
    coupon.minimumAmount > 0 ? `门槛 ${coupon.minimumAmount.toFixed(2)}` : "",
    usageLabel,
    remaining !== null ? `剩余 ${remaining}` : "",
    expiresLabel ? `至 ${expiresLabel}` : "",
  ]
    .filter(Boolean)
    .join("  ");
}

function buildContactCouponDisplayItems(input: {
  coupon: MerchantCouponRecord;
  usageLabel: string;
  remaining: number | null;
  expiresLabel: string;
}) {
  const { coupon } = input;
  const displayMetaText = getMerchantCouponDisplayMetaText(coupon);
  const itemText: Record<MerchantCouponDisplayField, string> = {
    discount: getMerchantCouponDiscountLabel(coupon),
    title: getMerchantCouponDisplayTitle(coupon),
    description: getMerchantCouponDisplayDescription(coupon),
    meta: displayMetaText || buildContactCouponDefaultMetaText(input),
    button: getMerchantCouponDisplayButtonText(coupon),
  };
  return getMerchantCouponDisplayFieldOrder(coupon)
    .filter((field) => !isMerchantCouponDisplayFieldHidden(coupon, field))
    .map((field) => ({
      field,
      text: itemText[field],
      boxStyle: getMerchantCouponDisplayBoxStyle(coupon, field),
      boxColor: getMerchantCouponDisplayBoxColor(coupon, field),
    }))
    .filter((item) => item.text.trim());
}

function buildContactCouponDisplayItemHtml(input: {
  coupon: MerchantCouponRecord;
  field: MerchantCouponDisplayField;
  text: string;
  boxStyle: MerchantCouponDisplayBoxStyle;
  boxColor: string;
  index: number;
}) {
  const { coupon, field, text, boxStyle, boxColor, index } = input;
  const marginClass = index === 0 ? "" : field === "meta" ? " coupon-display-spaced-large" : " coupon-display-spaced";
  const frameClass = boxStyle === "none" ? "" : field === "button" ? " coupon-frame-button" : " coupon-frame-text";
  const style = buildContactCouponItemStyle(coupon, field, boxColor, boxStyle);
  const escapedText = escapeHtml(text);
  if (field === "button") {
    return `<button class="coupon-display-item coupon-display-button${marginClass}${frameClass}" type="button" data-claim-coupon-id="${escapeHtml(coupon.id)}" data-claim-site-id="${escapeHtml(coupon.siteId)}"${style}>${escapedText}</button>`;
  }
  if (field === "title") {
    return `<div class="coupon-display-item coupon-display-title${marginClass}${frameClass}"${style}>${escapedText}</div>`;
  }
  if (field === "description") {
    return `<div class="coupon-display-item coupon-display-description${marginClass}${frameClass}"${style}>${escapedText}</div>`;
  }
  if (field === "meta") {
    return `<div class="coupon-display-item coupon-display-meta${marginClass}${frameClass}"${style}>${escapedText}</div>`;
  }
  return `<div class="coupon-display-item coupon-display-discount${marginClass}${frameClass}"${style}>${escapedText}</div>`;
}

function buildContactCouponsHtml(coupons: MerchantCouponRecord[]) {
  if (coupons.length === 0) return "";
  return `
    <section class="coupon-section">
      <div class="coupon-title">优惠券</div>
      <div class="coupon-list">
        ${coupons
          .map((coupon) => {
            const remaining = getMerchantCouponRemainingCount(coupon);
            const expiresLabel = formatCouponDate(coupon.expiresAt);
            const usageLabel = formatContactCouponUsageScenarios(coupon);
            const displayItems = buildContactCouponDisplayItems({ coupon, usageLabel, remaining, expiresLabel });
            const hasButtonItem = displayItems.some((item) => item.field === "button");
            const backgroundImageUrl = normalizePublicAssetUrl(coupon.backgroundImageUrl);
            const backgroundOpacity = Math.max(0, Math.min(1, coupon.backgroundImageOpacity));
            const backgroundStyle = backgroundImageUrl
              ? ` style="background-image: linear-gradient(rgba(255,255,255,${escapeHtml((1 - backgroundOpacity).toFixed(3))}), rgba(255,255,255,${escapeHtml(
                  (1 - backgroundOpacity).toFixed(3),
                )})), url('${escapeHtml(backgroundImageUrl)}'); background-size: cover; background-position: center;"`
              : "";
            return `
              <article class="coupon-item"${backgroundStyle}>
                <div class="coupon-copy">
                  ${displayItems.map((item, index) => buildContactCouponDisplayItemHtml({ coupon, ...item, index })).join("")}
                </div>
                ${
                  hasButtonItem
                    ? ""
                    : `<button class="coupon-button" type="button" data-claim-coupon-id="${escapeHtml(coupon.id)}" data-claim-site-id="${escapeHtml(coupon.siteId)}">${escapeHtml(
                        getMerchantCouponDisplayButtonText(coupon),
                      )}</button>`
                }
              </article>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

async function loadContactCardCoupons(siteId: string) {
  const site = await loadCurrentMerchantSnapshotSiteBySiteId(siteId).catch(() => null);
  if (!site?.permissionConfig?.allowCouponModule) return [];
  const coupons = await listMerchantCoupons(siteId).catch(() => []);
  return getContactCardVisibleMerchantCoupons(coupons);
}

async function withContactCardTimeout<T>(promise: Promise<T>, fallback: T, timeoutMs = 3000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

type ContactCardSnapshotMatch = {
  siteId: string;
  card: MerchantBusinessCardAsset;
  allowIntroVideo: boolean;
};

function resolveContactCardSnapshotMatchFromSite(
  site: Awaited<ReturnType<typeof loadCurrentMerchantSnapshotSiteBySiteId>>,
  shareKey: string,
): ContactCardSnapshotMatch | null {
  const normalizedShareKey = normalizeMerchantBusinessCardShareKey(shareKey);
  if (!normalizedShareKey || !site || !Array.isArray(site.businessCards)) return null;
  const card = site.businessCards.find(
    (item) => normalizeMerchantBusinessCardShareKey(item.shareKey) === normalizedShareKey,
  ) as MerchantBusinessCardAsset | undefined;
  return card
    ? {
        siteId: normalizeText(site.id),
        card,
        allowIntroVideo: site.permissionConfig?.allowBusinessCardIntroVideo !== false,
      }
    : null;
}

async function resolveContactCardSnapshotMatch(shareKey: string, ownerMerchantId?: string | null) {
  const normalizedShareKey = normalizeMerchantBusinessCardShareKey(shareKey);
  if (!normalizedShareKey) return null;
  const ownerSiteId = normalizeText(ownerMerchantId);
  if (ownerSiteId) {
    const currentSite = await loadCurrentMerchantSnapshotSiteBySiteId(ownerSiteId).catch(() => null);
    const currentMatch = resolveContactCardSnapshotMatchFromSite(currentSite, normalizedShareKey);
    if (currentMatch) return currentMatch;
  }
  const currentSnapshot = await loadCurrentMerchantSnapshotSites().catch(() => []);
  const currentOwnerSite = currentSnapshot.find((site) =>
    Array.isArray(site.businessCards) &&
    site.businessCards.some((card) => normalizeMerchantBusinessCardShareKey(card.shareKey) === normalizedShareKey),
  );
  const currentMatch = resolveContactCardSnapshotMatchFromSite(currentOwnerSite ?? null, normalizedShareKey);
  if (currentMatch) return currentMatch;
  const snapshot = await loadPublishedMerchantSnapshotSites().catch(() => []);
  const ownerSite = snapshot.find((site) =>
    Array.isArray(site.businessCards) &&
    site.businessCards.some((card) => normalizeMerchantBusinessCardShareKey(card.shareKey) === normalizedShareKey),
  );
  if (!ownerSite || !Array.isArray(ownerSite.businessCards)) return null;
  return resolveContactCardSnapshotMatchFromSite(ownerSite, normalizedShareKey);
}

function normalizeSnapshotPhoneList(card: MerchantBusinessCardAsset) {
  const contacts = card.contacts;
  const phones = Array.isArray(contacts?.phones)
    ? contacts.phones.map((value) => normalizeText(value)).filter(Boolean)
    : [];
  const primaryPhone = normalizeText(contacts?.phone);
  return [...new Set([...phones, primaryPhone].filter(Boolean))];
}

function buildSharePayloadFromSnapshotMatch(
  match: ContactCardSnapshotMatch | null,
  preferredOrigin: string,
): MerchantBusinessCardSharePayload | null {
  if (!match) return null;
  const card = match.card;
  const targetUrl = normalizeText(card.targetUrl);
  if (!targetUrl) return null;
  const phones = normalizeSnapshotPhoneList(card);
  const primaryPhone = phones[0] || normalizeText(card.contacts?.phone);

  return normalizeMerchantBusinessCardSharePayload(
    {
      name: normalizeText(card.name) || normalizeText(card.contacts?.contactName),
      imageUrl: normalizeText(card.shareImageUrl) || normalizeText(card.imageUrl),
      detailImageUrl: normalizeText(card.contactPagePublicImageUrl) || normalizeText(card.contactPageImageUrl),
      detailImageHeight:
        typeof card.contactPageImageHeight === "number" ? Math.round(card.contactPageImageHeight) : undefined,
      introVideoUrl: match.allowIntroVideo ? normalizeText(card.contactIntroVideoUrl) : "",
      introPosterUrl: match.allowIntroVideo ? normalizeText(card.contactIntroVideoPosterUrl) : "",
      introVideoMuted: card.contactIntroVideoMuted,
      contactPageSectionOrder: card.contactPageSectionOrder,
      showContactSaveButton: card.showContactSaveButton,
      showContactWebsiteButton: card.showContactWebsiteButton,
      targetUrl,
      ownerMerchantId: match.siteId,
      imageWidth: typeof card.width === "number" ? Math.round(card.width) : undefined,
      imageHeight: typeof card.height === "number" ? Math.round(card.height) : undefined,
      contact: {
        displayName: normalizeText(card.contacts?.contactName) || normalizeText(card.name),
        organization: normalizeText(card.name),
        title: normalizeText(card.title),
        phone: primaryPhone,
        phones,
        email: normalizeText(card.contacts?.email),
        address: normalizeText(card.contacts?.address),
        invoiceName: normalizeText(card.invoice?.name),
        invoiceTaxNumber: normalizeText(card.invoice?.taxNumber),
        invoiceAddress: normalizeText(card.invoice?.address),
        wechat: normalizeText(card.contacts?.wechat),
        whatsapp: normalizeText(card.contacts?.whatsapp),
        twitter: normalizeText(card.contacts?.twitter),
        weibo: normalizeText(card.contacts?.weibo),
        telegram: normalizeText(card.contacts?.telegram),
        linkedin: normalizeText(card.contacts?.linkedin),
        discord: normalizeText(card.contacts?.discord),
        facebook: normalizeText(card.contacts?.facebook),
        instagram: normalizeText(card.contacts?.instagram),
        tiktok: normalizeText(card.contacts?.tiktok),
        douyin: normalizeText(card.contacts?.douyin),
        xiaohongshu: normalizeText(card.contacts?.xiaohongshu),
        googleReview: normalizeText(card.contacts?.googleReview),
        contactFieldOrder: normalizeMerchantBusinessCardContactFieldOrder(card.contactFieldOrder),
        customLinks: card.customContactLinks,
        contactOnlyFields: card.contactOnlyFields,
        websiteUrl: targetUrl,
      },
    },
    preferredOrigin,
  );
}

async function repairShareManifestFromSnapshot(input: {
  shareKey: string;
  snapshotMatch: ContactCardSnapshotMatch | null;
  payload: MerchantBusinessCardSharePayload | null;
  preferredOrigin: string;
}) {
  const shareKey = normalizeMerchantBusinessCardShareKey(input.shareKey);
  const objectPath = buildMerchantBusinessCardShareManifestObjectPath(shareKey);
  if (!shareKey || !objectPath || !input.snapshotMatch || !input.payload) return false;
  const normalizedPayload = normalizeMerchantBusinessCardSharePayload(
    {
      ...input.payload,
      ownerMerchantId: input.snapshotMatch.siteId,
    },
    input.preferredOrigin,
  );
  if (!normalizedPayload?.targetUrl) return false;
  const supabase = createServerSupabaseServiceClient() as unknown as PublicStorageClient | null;
  if (!supabase) return false;

  const payloadToStore = {
    ...normalizedPayload,
    updatedAt: new Date().toISOString(),
  } satisfies MerchantBusinessCardSharePayload;
  const blob = createJsonBlob(payloadToStore);
  let repaired = false;
  for (const bucket of BUSINESS_CARD_SHARE_MANIFEST_BUCKETS) {
    const uploaded = await supabase.storage.from(bucket).upload(objectPath, blob, {
      contentType: "application/json; charset=utf-8",
      cacheControl: "31536000",
      upsert: true,
    });
    if (!uploaded.error) {
      repaired = true;
    }
  }
  return repaired;
}

async function hasExistingShareManifestObject(shareKey: string, preferredOrigin: string) {
  const urls = buildMerchantBusinessCardShareManifestPublicUrls(shareKey, preferredOrigin);
  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        const response = await fetch(url, {
          method: "HEAD",
          cache: "no-store",
          next: { revalidate: 0 },
        });
        return response.ok;
      } catch {
        return false;
      }
    }),
  );
  return results.some(Boolean);
}

function buildOrderedContactSummaryHtml(input: {
  name: string;
  contact?: MerchantBusinessCardShareContact;
}) {
  const contact = input.contact;
  if (!contact) return "";

  const primaryPhone = normalizeText(contact.phone);
  const secondaryPhone =
    contact.phones?.find((value) => {
      const normalized = normalizeText(value);
      return normalized && normalized !== primaryPhone;
    }) || "";
  const orderedKeys = normalizeMerchantBusinessCardContactFieldOrder(contact.contactFieldOrder);
  const rowsByKey: Partial<Record<MerchantBusinessCardContactDisplayKey, SummaryRow[]>> = {};
  const invoiceRows = [
    contact.invoiceName
      ? {
          label: "\u540d\u79f0",
          value: contact.invoiceName,
          actionHtml: buildCopyActionHtml(contact.invoiceName, "\u540d\u79f0"),
        }
      : null,
    contact.invoiceTaxNumber
      ? {
          label: "税号",
          value: contact.invoiceTaxNumber,
          actionHtml: buildCopyActionHtml(contact.invoiceTaxNumber, "税号"),
        }
      : null,
    contact.invoiceAddress
      ? {
          label: "\u5730\u5740",
          value: contact.invoiceAddress,
          actionHtml: buildCopyActionHtml(contact.invoiceAddress, "\u5730\u5740"),
        }
      : null,
  ].filter((item): item is SummaryRow => !!item);

  const pushRow = (key: MerchantBusinessCardContactDisplayKey, row: SummaryRow | null) => {
    if (!row) return;
    rowsByKey[key] = [...(rowsByKey[key] ?? []), { ...row, key }];
  };

  pushRow(
    "contactName",
    contact.displayName
      ? {
          label: "联系人",
          value: contact.displayName,
          actionHtml: "",
        }
      : null,
  );
  pushRow(
    "phone",
    primaryPhone
      ? {
          label: "电话",
          value: primaryPhone,
          actionHtml: buildActionButtonHtml({
            href: buildPhoneHref(primaryPhone),
            label: "拨号",
            iconSvg: buildInlineSvgIcon("phone"),
            bgColor: "#007AFF",
          }),
        }
      : null,
  );
  pushRow(
    "phone",
    secondaryPhone
      ? {
          label: "工作",
          value: secondaryPhone,
          actionHtml: buildActionButtonHtml({
            href: buildPhoneHref(secondaryPhone),
            label: "拨打工作电话",
            iconSvg: buildInlineSvgIcon("phone"),
            bgColor: "#007AFF",
          }),
        }
      : null,
  );
  pushRow(
    "email",
    contact.email
      ? {
          label: "邮箱",
          value: contact.email,
          actionHtml: buildActionButtonHtml({
            href: `mailto:${contact.email}`,
            label: "发送邮件",
            iconUrl: "/social-icons/maildotru.svg",
            bgColor: "#0A84FF",
          }),
        }
      : null,
  );
  pushRow(
    "address",
    contact.address
      ? {
          label: "地址",
          value: contact.address,
          actionHtml: buildActionButtonHtml({
            href: buildAddressHref(contact.address),
            label: "导航",
            iconSvg: buildInlineSvgIcon("map"),
            bgColor: "#EA4335",
          }),
        }
      : null,
  );
  pushRow(
    "wechat",
    contact.wechat
      ? {
          label: "微信",
          value: contact.wechat,
          actionHtml: buildWeChatActionHtml(contact.wechat),
        }
      : null,
  );
  pushRow(
    "whatsapp",
    contact.whatsapp
      ? {
          label: "WhatsApp",
          value: contact.whatsapp,
          actionHtml: buildActionButtonHtml({
            href: buildSocialHref("WhatsApp", contact.whatsapp),
            label: "打开 WhatsApp",
            iconUrl: "/social-icons/whatsapp.svg",
            bgColor: "#25D366",
          }),
        }
      : null,
  );
  pushRow(
    "twitter",
    contact.twitter
      ? {
          label: "Twitter",
          value: contact.twitter,
          actionHtml: buildActionButtonHtml({
            href: buildSocialHref("Twitter", contact.twitter),
            label: "打开 Twitter",
            iconUrl: "/social-icons/twitter.svg",
            bgColor: "#111827",
          }),
        }
      : null,
  );
  pushRow(
    "weibo",
    contact.weibo
      ? {
          label: "微博",
          value: contact.weibo,
          actionHtml: buildActionButtonHtml({
            href: `https://weibo.com/n/${encodeURIComponent(contact.weibo.replace(/^@+/, ""))}`,
            label: "打开微博",
            iconUrl: "/social-icons/weibo.svg",
            bgColor: "#E6162D",
          }),
        }
      : null,
  );
  pushRow(
    "telegram",
    contact.telegram
      ? {
          label: "Telegram",
          value: contact.telegram,
          actionHtml: buildActionButtonHtml({
            href: buildSocialHref("Telegram", contact.telegram),
            label: "打开 Telegram",
            iconUrl: "/social-icons/telegram.svg",
            bgColor: "#229ED9",
          }),
        }
      : null,
  );
  pushRow(
    "linkedin",
    contact.linkedin
      ? {
          label: "LinkedIn",
          value: contact.linkedin,
          actionHtml: buildActionButtonHtml({
            href: buildSocialHref("LinkedIn", contact.linkedin),
            label: "打开 LinkedIn",
            iconUrl: "/social-icons/linkedin.svg",
            bgColor: "#0A66C2",
          }),
        }
      : null,
  );
  pushRow(
    "discord",
    contact.discord
      ? {
          label: "Discord",
          value: contact.discord,
          actionHtml: buildDiscordActionHtml(contact.discord),
        }
      : null,
  );
  pushRow(
    "facebook",
    contact.facebook
      ? {
          label: "Facebook",
          value: contact.facebook,
          actionHtml: buildActionButtonHtml({
            href: buildSocialHref("Facebook", contact.facebook),
            label: "打开 Facebook",
            iconUrl: "/social-icons/facebook.svg",
            bgColor: "#1877F2",
          }),
        }
      : null,
  );
  pushRow(
    "instagram",
    contact.instagram
      ? {
          label: "Instagram",
          value: contact.instagram,
          actionHtml: buildActionButtonHtml({
            href: buildSocialHref("Instagram", contact.instagram),
            label: "打开 Instagram",
            iconUrl: "/social-icons/instagram.svg",
            bgColor: "#E4405F",
          }),
        }
      : null,
  );
  pushRow(
    "tiktok",
    contact.tiktok
      ? {
          label: "TikTok",
          value: contact.tiktok,
          actionHtml: buildActionButtonHtml({
            href: buildSocialHref("TikTok", contact.tiktok),
            label: "打开 TikTok",
            iconUrl: "/social-icons/tiktok.svg",
            bgColor: "#111827",
          }),
        }
      : null,
  );
  pushRow(
    "douyin",
    contact.douyin
      ? {
          label: "抖音",
          value: contact.douyin,
          actionHtml: buildDouyinActionHtml(contact.douyin),
        }
      : null,
  );
  pushRow(
    "xiaohongshu",
    contact.xiaohongshu
      ? {
          label: "小红书",
          value: contact.xiaohongshu,
          actionHtml: buildActionButtonHtml({
            href: `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(contact.xiaohongshu)}`,
            label: "打开小红书",
            iconUrl: "/social-icons/xiaohongshu.svg",
            bgColor: "#FF2442",
          }),
        }
      : null,
  );
  pushRow(
    "googleReview",
    contact.googleReview
      ? {
          label: "Google",
          value: GOOGLE_REVIEW_DISPLAY_TEXT,
          actionHtml: buildSummaryActionHtmlFromKey("googleReview", "Google", contact.googleReview),
          translateValue: true,
        }
      : null,
  );

  const fallbackRowsByKey = buildContactNoteFallbackRows(contact.note);
  const rows: SummaryRow[] = [];
  if (contact.title) {
    rows.push({
      label: "职位",
      value: contact.title,
      actionHtml: "",
    });
  }
  for (const key of orderedKeys) {
    const directRows = rowsByKey[key] ?? [];
    const fallbackRows = fallbackRowsByKey[key] ?? [];
    const mergedRows = [...directRows];
    for (const fallbackRow of fallbackRows) {
      if (mergedRows.some((row) => row.label === fallbackRow.label && row.value === fallbackRow.value)) continue;
      mergedRows.push(fallbackRow);
    }
    rows.push(...mergedRows);
  }
  rows.push(...buildCustomContactLinkRows(contact.customLinks));

  if (rows.length === 0 && invoiceRows.length === 0) {
    return `<div class="summary-row"><span class="summary-value" data-no-translate="1">${escapeHtml(normalizeText(input.name) || "电子名片")}</span></div>`;
  }

  return `${buildSummaryRowsHtml(rows)}${buildInvoiceSummarySectionHtml(invoiceRows)}`;
}

function buildShareCardHtml(input: {
  title: string;
  description: string;
  merchantName: string;
  previewImageUrl?: string;
  contentImageUrl?: string;
  contentImageHeight?: number;
  introVideoUrl?: string;
  introPosterUrl?: string;
  introVideoMuted?: boolean;
  contactPageSectionOrder?: MerchantBusinessCardContactSectionKey[];
  showContactSaveButton?: boolean;
  showContactWebsiteButton?: boolean;
  summaryHtml: string;
  imageWidth?: number;
  imageHeight?: number;
  targetUrl: string;
  shareUrl: string;
  contactUrl?: string;
  couponsHtml?: string;
  introDebug?: boolean;
}) {
  const resolveIntroPlaybackVideoUrl = (value: string) => {
    if (!value) return value;
    return value.replace(
      /1780142418367-bvaijr\.mp4(?:\?[^#]*)?/i,
      "1780142418367-bvaijr-wechat-safe.mp4",
    );
  };
  const title = escapeHtml(input.title);
  const description = escapeHtml(input.description);
  const merchantName = escapeHtml(input.merchantName);
  const previewImageUrl = input.previewImageUrl ? escapeHtml(input.previewImageUrl) : "";
  const contentImageUrl = input.contentImageUrl ? escapeHtml(input.contentImageUrl) : "";
  const introVideoUrl = input.introVideoUrl ? escapeHtml(resolveIntroPlaybackVideoUrl(input.introVideoUrl)) : "";
  const introPosterUrl = input.introPosterUrl ? escapeHtml(input.introPosterUrl) : contentImageUrl || previewImageUrl;
  const introVideoMuted = input.introVideoMuted !== false;
  const contentImageHeight = input.contentImageHeight ?? 0;
  const targetUrl = escapeHtml(input.targetUrl);
  const shareUrl = escapeHtml(input.shareUrl);
  const introDebug = Boolean(input.introDebug);
  const inlineI18nScript = buildInlineI18nScript();
  const languageSwitcherHtml = buildLanguageSwitcherHtml();
  const contactPageSectionOrder = normalizeMerchantBusinessCardContactSectionOrder(input.contactPageSectionOrder);
  const contactImageSectionHtml = contentImageUrl
    ? `<a class="card" href="${targetUrl}">
          <img src="${contentImageUrl}" alt="${title}"${contentImageHeight ? ` style="height:${contentImageHeight}px;object-fit:contain;"` : ""} />
        </a>`
    : "";
  const contactSummarySectionHtml = input.summaryHtml ? `<div class="summary">${input.summaryHtml}</div>` : "";
  const contactCouponsSectionHtml = input.couponsHtml || "";
  const contactSectionHtmlByKey: Record<MerchantBusinessCardContactSectionKey, string> = {
    image: contactImageSectionHtml,
    contacts: contactSummarySectionHtml,
    coupons: contactCouponsSectionHtml,
  };
  const orderedContactSectionsHtml = contactPageSectionOrder
    .map((key) => contactSectionHtmlByKey[key])
    .filter(Boolean)
    .join("");
  const showContactSaveButton = input.showContactSaveButton !== false;
  const showContactWebsiteButton = input.showContactWebsiteButton !== false;
  const actionItemsHtml = [
    showContactSaveButton && input.contactUrl
      ? `<a class="button" href="${escapeHtml(input.contactUrl)}">一键保存到通讯录</a>`
      : "",
    showContactWebsiteButton
      ? `<button class="button secondary" type="button" data-open-target-url="${targetUrl}">进入官网</button>`
      : "",
  ].filter(Boolean).join("");

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Faolla" />
    <meta property="og:url" content="${shareUrl}" />
    ${previewImageUrl ? `<meta property="og:image:url" content="${previewImageUrl}" />` : ""}
    ${previewImageUrl ? `<meta property="og:image" content="${previewImageUrl}" />` : ""}
    ${previewImageUrl ? `<meta property="og:image:secure_url" content="${previewImageUrl}" />` : ""}
    ${previewImageUrl ? `<meta property="og:image:alt" content="${title}" />` : ""}
    ${previewImageUrl ? `<meta property="og:image:type" content="image/png" />` : ""}
    ${previewImageUrl && input.imageWidth ? `<meta property="og:image:width" content="${input.imageWidth}" />` : ""}
    ${previewImageUrl && input.imageHeight ? `<meta property="og:image:height" content="${input.imageHeight}" />` : ""}
    <meta name="twitter:card" content="${previewImageUrl ? "summary_large_image" : "summary"}" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    ${previewImageUrl ? `<meta name="twitter:image" content="${previewImageUrl}" />` : ""}
    ${previewImageUrl ? `<meta name="twitter:image:alt" content="${title}" />` : ""}
    <link rel="canonical" href="${shareUrl}" />
    <meta name="google" content="notranslate" />
    <style>
      *,
      *::before,
      *::after {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        font-family: "Segoe UI", Arial, sans-serif;
        background: #f5efe5;
        color: #0f172a;
      }
      main {
        min-height: 100vh;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: 16px 24px 24px;
        padding-top: max(16px, env(safe-area-inset-top));
      }
      .lang-switcher {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 20;
        display: block;
        width: 40px;
        height: 28px;
        min-height: 28px;
        border-radius: 2px;
        border: 1px solid rgba(148,163,184,.7);
        background: #fff;
        padding: 0;
        box-shadow: 0 1px 2px rgba(15,23,42,.12);
        overflow: hidden;
        cursor: pointer;
      }
      .lang-switcher img {
        display: block;
        width: 100%;
        height: 100%;
        border-radius: 0;
        border: 0;
        object-fit: cover;
        transform: none;
        filter: none;
      }
      .lang-switcher-sr {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
      .intro-overlay {
        position: fixed;
        inset: 0;
        z-index: 180;
        display: block;
        padding: 0;
        background: #000;
      }
      .intro-overlay.is-hidden {
        display: none;
      }
      .intro-card {
        position: relative;
        width: 100vw;
        height: 100vh;
        height: 100dvh;
        overflow: hidden;
        background: #000;
      }
      .intro-poster {
        position: absolute;
        inset: 0;
        z-index: 2;
        display: none;
        width: 100%;
        height: 100%;
        object-fit: contain;
        background: transparent;
        pointer-events: none;
        transition: opacity .18s ease;
      }
      .intro-card.has-intro-poster .intro-poster {
        display: block;
      }
      .intro-video {
        position: absolute;
        inset: 0;
        z-index: 1;
        display: block;
        width: 100vw;
        height: 100vh;
        height: 100dvh;
        border: 0;
        border-radius: 0;
        background: #000;
        object-fit: contain;
        opacity: 1;
      }
      .intro-overlay.has-video-progress .intro-video {
        opacity: 1;
      }
      .intro-overlay.is-playing .intro-poster,
      .intro-overlay.has-video-progress .intro-poster {
        opacity: 0;
      }
      .intro-overlay.needs-manual-play .intro-poster {
        opacity: .38;
      }
      .intro-skip {
        position: absolute;
        top: max(14px, calc(env(safe-area-inset-top) + 14px));
        right: max(14px, calc(env(safe-area-inset-right) + 14px));
        z-index: 4;
        border: 1px solid rgba(255,255,255,.32);
        border-radius: 999px;
        background: rgba(15,23,42,.62);
        color: #fff;
        padding: 9px 14px;
        backdrop-filter: blur(12px);
        font: inherit;
        font-size: 14px;
        cursor: pointer;
      }
      .intro-unmute-tip {
        position: absolute;
        left: 50%;
        bottom: max(28px, calc(env(safe-area-inset-bottom) + 28px));
        z-index: 4;
        transform: translateX(-50%);
        display: none;
        max-width: min(86vw, 360px);
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,.28);
        background: rgba(15,23,42,.68);
        color: #fff;
        padding: 10px 16px;
        font-size: 14px;
        line-height: 1.45;
        text-align: center;
        backdrop-filter: blur(14px);
        pointer-events: none;
        box-shadow: 0 12px 40px rgba(0,0,0,.24);
      }
      .intro-overlay.show-unmute-tip .intro-unmute-tip {
        display: block;
      }
      .intro-unmute-button {
        position: absolute;
        left: 50%;
        bottom: max(28px, calc(env(safe-area-inset-bottom) + 28px));
        z-index: 4;
        transform: translateX(-50%);
        display: none;
        max-width: min(86vw, 360px);
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,.34);
        background: rgba(15,23,42,.72);
        color: #fff;
        padding: 10px 18px;
        font: inherit;
        font-size: 14px;
        line-height: 1.45;
        text-align: center;
        backdrop-filter: blur(14px);
        cursor: pointer;
        box-shadow: 0 12px 40px rgba(0,0,0,.24);
      }
      .intro-overlay.show-unmute-action .intro-unmute-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .intro-debug-panel {
        position: absolute;
        left: max(10px, env(safe-area-inset-left));
        right: max(10px, env(safe-area-inset-right));
        bottom: max(10px, env(safe-area-inset-bottom));
        z-index: 6;
        max-height: 36vh;
        overflow: auto;
        border-radius: 12px;
        background: rgba(15,23,42,.86);
        color: #dbeafe;
        padding: 10px;
        font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        white-space: pre-wrap;
        word-break: break-word;
      }
      #contact-card-language {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        opacity: 0;
        cursor: pointer;
      }
      article {
        width: min(100%, 560px);
        background: rgba(255,255,255,.94);
        border: 1px solid rgba(15,23,42,.08);
        border-radius: 28px;
        padding: 20px;
        box-shadow: 0 24px 80px rgba(15,23,42,.12);
      }
      .brandline {
        margin: 0;
        text-align: center;
        font-size: 13px;
        letter-spacing: .28em;
        color: #64748b;
        text-transform: uppercase;
      }
      h1 {
        margin: 10px 0 0;
        font-size: 28px;
        text-align: center;
      }
      p {
        line-height: 1.6;
      }
      .card,
      .summary {
        display: block;
        overflow: hidden;
        border-radius: 22px;
        border: 1px solid rgba(15,23,42,.08);
        background: #fff;
      }
      .card img {
        display: block;
        width: 100%;
        height: auto;
      }
      .summary {
        margin-top: 16px;
        padding: 18px;
        line-height: 1.7;
      }
      .coupon-section {
        width: 100%;
        max-width: 100%;
        margin-top: 16px;
        border-radius: 18px;
        border: 1px solid rgba(15,23,42,.1);
        background: rgba(248,250,252,.9);
        padding: 14px;
        overflow: hidden;
      }
      .coupon-title {
        font-size: 15px;
        font-weight: 800;
        color: #0f172a;
      }
      .coupon-list {
        display: grid;
        gap: 10px;
        margin-top: 10px;
        width: 100%;
        max-width: 100%;
      }
      .coupon-item {
        display: grid;
        gap: 12px;
        width: 100%;
        max-width: 100%;
        border-radius: 16px;
        border: 1px solid rgba(15,23,42,.08);
        background: rgba(255,255,255,.94);
        padding: 14px;
        overflow: hidden;
      }
      .coupon-copy {
        min-width: 0;
        max-width: 100%;
      }
      .coupon-display-item {
        min-width: 0;
        max-width: 100%;
        overflow-wrap: anywhere;
      }
      .coupon-display-spaced {
        margin-top: 8px;
      }
      .coupon-display-spaced-large {
        margin-top: 12px;
      }
      .coupon-frame-text {
        display: inline-block;
        border: 1px solid rgba(15,23,42,.18);
        border-radius: 8px;
        padding: 4px 8px;
      }
      .coupon-frame-button {
        border: 1px solid rgba(15,23,42,.18);
        padding: 8px 16px;
      }
      .coupon-display-discount,
      .coupon-discount {
        font-size: 12px;
        font-weight: 800;
        letter-spacing: .12em;
        color: #f43f5e;
        text-transform: uppercase;
        overflow-wrap: anywhere;
      }
      .coupon-display-title,
      .coupon-name {
        margin-top: 6px;
        font-size: 16px;
        font-weight: 800;
        color: #0f172a;
        overflow-wrap: anywhere;
      }
      .coupon-display-title:first-child {
        margin-top: 0;
      }
      .coupon-display-description,
      .coupon-description {
        margin-top: 4px;
        font-size: 13px;
        color: #64748b;
        overflow-wrap: anywhere;
      }
      .coupon-display-description:first-child {
        margin-top: 0;
      }
      .coupon-display-meta,
      .coupon-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 8px;
        font-size: 12px;
        color: #64748b;
        min-width: 0;
        max-width: 100%;
        overflow-wrap: anywhere;
      }
      .coupon-meta span {
        min-width: 0;
        max-width: 100%;
        overflow-wrap: anywhere;
      }
      .coupon-display-button,
      .coupon-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        max-width: 100%;
        min-height: 40px;
        border-radius: 12px;
        border: 0;
        background: #0f172a;
        color: #fff;
        font: inherit;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
        text-align: center;
        overflow-wrap: anywhere;
        white-space: normal;
      }
      .summary-row + .summary-row {
        margin-top: 12px;
      }
      .summary-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .summary-copy {
        min-width: 0;
        display: flex;
        align-items: flex-start;
        gap: 4px;
        flex-wrap: wrap;
      }
      .summary-label {
        color: #0f172a;
      }
      .summary-value {
        color: #334155;
        word-break: break-word;
      }
      .summary-row-address .summary-copy {
        flex: 1 1 auto;
        flex-wrap: nowrap;
        align-items: center;
        overflow: hidden;
      }
      .summary-row-address .summary-label {
        flex: 0 0 auto;
      }
      .summary-value-address {
        display: block;
        min-width: 0;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: pointer;
      }
      .summary-value-address:focus {
        outline: 2px solid rgba(37,99,235,.35);
        outline-offset: 2px;
        border-radius: 6px;
      }
      .summary-action {
        flex-shrink: 0;
      }
      .invoice-summary {
        margin-top: 16px;
        border-radius: 18px;
        border: 1px solid rgba(15,23,42,.1);
        background: rgba(248,250,252,.9);
        padding: 14px;
      }
      .invoice-title {
        margin-bottom: 10px;
        font-size: 14px;
        font-weight: 700;
        color: #0f172a;
      }
      .invoice-body .summary-row:first-child {
        margin-top: 0;
      }
      .inline-action {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 34px;
        border-radius: 999px;
        box-shadow: 0 8px 20px rgba(15,23,42,.14);
      }
      .inline-action-button {
        border: 0;
        padding: 0;
        cursor: pointer;
      }
      .inline-action img,
      .inline-action svg {
        width: 18px;
        height: 18px;
      }
      .inline-action img {
        object-fit: contain;
      }
      .inline-action svg {
        fill: #fff;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 16px;
      }
      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 10px 16px;
        border-radius: 999px;
        text-decoration: none;
        border: 0;
        cursor: pointer;
        font: inherit;
      }
      .button {
        background: #0f172a;
        color: #fff;
      }
      .button.secondary {
        background: #fff;
        color: #0f172a;
        border: 1px solid rgba(15,23,42,.12);
      }
      .footer {
        margin-top: 20px;
        padding-top: 16px;
        border-top: 1px solid rgba(15,23,42,.08);
        font-size: 13px;
        color: #64748b;
        text-align: center;
      }
      .footer a {
        color: #0f172a;
        text-decoration: none;
        font-weight: 600;
      }
      @media (max-width: 767px) {
        .lang-switcher {
          top: max(12px, calc(env(safe-area-inset-top) + 12px));
          right: max(12px, calc(env(safe-area-inset-right) + 12px));
          width: 40px;
          height: 28px;
          min-height: 28px;
          z-index: 100;
        }
      }
      @media (max-width: 520px) {
        main {
          padding: 0 12px 12px;
          padding-top: env(safe-area-inset-top);
        }
        article {
          padding: 16px;
        }
        .summary-row {
          align-items: flex-start;
        }
      }
    </style>
  </head>
  <body>
    ${languageSwitcherHtml}
    ${
      introVideoUrl
        ? `<div class="intro-overlay" data-intro-overlay data-no-translate="1">
            <div class="intro-card${introPosterUrl ? " has-intro-poster" : ""}">
              <video class="intro-video" src="${introVideoUrl}"${introPosterUrl ? ` poster="${introPosterUrl}"` : ""} autoplay="autoplay"${introVideoMuted ? ` muted="muted"` : ""} playsinline="playsinline" webkit-playsinline="webkit-playsinline" preload="auto" data-intro-src="${introVideoUrl}"></video>
        <button class="intro-unmute-button" type="button" data-intro-unmute>开启声音</button>
        <button class="intro-skip" type="button" data-intro-skip>跳过</button>
        ${introDebug ? `<pre class="intro-debug-panel" data-intro-debug>intro debug boot</pre>` : ""}
      </div>
    </div>
    <noscript><style>.intro-overlay{display:none}</style></noscript>`
        : ""
    }
    <main>
      <article>
        <div class="brandline" data-no-translate="1">FAOLLA CARD</div>
        ${merchantName ? `<h1 data-no-translate="1">${merchantName}</h1>` : ""}
        ${orderedContactSectionsHtml}
        ${actionItemsHtml ? `<div class="actions">${actionItemsHtml}</div>` : ""}
        <div class="footer">
          名片服务由 <a href="https://www.faolla.com" target="_blank" rel="noopener noreferrer" data-no-translate="1">www.faolla.com</a> 提供
        </div>
      </article>
    </main>
    <script>${inlineI18nScript}</script>
    ${
      introVideoUrl
        ? `<script>(() => {
      const overlay = document.querySelector("[data-intro-overlay]");
      if (!overlay) return;
      const video = overlay.querySelector("video");
      const unmuteButton = overlay.querySelector("[data-intro-unmute]");
      const debugPanel = overlay.querySelector("[data-intro-debug]");
      const introMuted = ${introVideoMuted ? "true" : "false"};
      const introSrc = video?.getAttribute("data-intro-src") || video?.currentSrc || video?.src || "";
      const isWechat = /micromessenger/i.test(String(window.navigator?.userAgent || ""));
      let closed = false;
      let progressed = false;
      const getBridge = () => window.WeixinJSBridge || window.YixinJSBridge;
      const debug = (label, extra = {}) => {
        if (!debugPanel) return;
        const snapshot = {
          label,
          t: Math.round(performance.now()),
          readyState: video?.readyState,
          networkState: video?.networkState,
          paused: video?.paused,
          currentTime: video?.currentTime,
          duration: video?.duration,
          muted: video?.muted,
          defaultMuted: video?.defaultMuted,
          controls: video?.controls,
          error: video?.error ? { code: video.error.code, message: video.error.message || "" } : null,
          bridge: Boolean(getBridge()),
          visibility: document.visibilityState,
          ...extra,
        };
        debugPanel.textContent = [debugPanel.textContent, JSON.stringify(snapshot)].join(String.fromCharCode(10)).slice(-5000);
      };
      const closeIntro = () => {
        debug("close");
        closed = true;
        overlay.classList.remove("show-unmute-action");
        overlay.classList.add("is-hidden");
        try { video && video.pause(); } catch {}
      };
      if (!video) {
        debug("no-video");
        closeIntro();
        return;
      }
      debug("init", { ua: String(window.navigator?.userAgent || ""), src: introSrc, introMuted, isWechat });
      const reloadIntroSource = () => {
        if (!introSrc) return;
        try {
          debug("reload-source");
          video.pause?.();
          video.setAttribute("src", introSrc);
          video.load?.();
        } catch {}
      };
      const showUnmuteAction = () => {
        if (closed || introMuted || isWechat) return;
        overlay.classList.add("show-unmute-action");
      };
      const hideUnmuteAction = () => {
        overlay.classList.remove("show-unmute-action");
      };
      const prepareAutoplay = (forceMuted = false) => {
        video.autoplay = true;
        video.controls = false;
        video.setAttribute("autoplay", "");
        video.setAttribute("preload", "auto");
        video.setAttribute("playsinline", "");
        video.setAttribute("webkit-playsinline", "");
        const shouldMute = introMuted || (!isWechat && forceMuted);
        debug("prepare", { forceMuted, shouldMute });
        video.muted = shouldMute;
        video.defaultMuted = shouldMute;
        if (shouldMute) {
          video.setAttribute("muted", "");
          if (forceMuted && !introMuted) showUnmuteAction();
        } else {
          video.removeAttribute("muted");
          hideUnmuteAction();
        }
      };
      const restoreSound = (event) => {
        if (event && event.isTrusted === false) return;
        if (closed || introMuted) return;
        try {
          video.muted = false;
          video.defaultMuted = false;
          video.removeAttribute("muted");
          hideUnmuteAction();
          void video.play?.().catch?.(() => {
            showUnmuteAction();
          });
        } catch {
          showUnmuteAction();
        }
      };
      const markPlaying = () => {
        if (closed) return;
        const revealAt = isWechat ? 0.35 : 0.05;
        debug("mark-check", { revealAt });
        if (video.currentTime <= revealAt) return;
        progressed = true;
        overlay.classList.add("is-playing", "has-video-progress");
        overlay.classList.remove("needs-manual-play");
      };
      const revealVideo = () => {
        if (closed) return;
        overlay.classList.add("is-playing");
        overlay.classList.remove("needs-manual-play");
      };
      const keepIntroFallback = () => {
        if (closed || progressed) return;
        debug("fallback");
        try { video.controls = false; } catch {}
        overlay.classList.remove("is-hidden", "is-playing", "has-video-progress");
        overlay.classList.add("needs-manual-play");
      };
      const playIntro = (options = {}) => {
        if (closed) return Promise.resolve(false);
        const forceMuted = isWechat ? false : Boolean(options.forceMuted);
        const forceReload = !isWechat && Boolean(options.reload);
        debug("play-start", { forceMuted, forceReload });
        prepareAutoplay(forceMuted);
        if (forceReload) reloadIntroSource();
        const result = video.play?.();
        if (result && typeof result.then === "function") {
          return result
            .then(() => {
              debug("play-ok");
              markPlaying();
              return !video.paused || video.currentTime > 0.05;
            })
            .catch((error) => {
              debug("play-fail", { name: error?.name || "", message: error?.message || String(error || "") });
              if (isWechat) return false;
              if (!introMuted && !forceMuted) {
                return playIntro({ forceMuted: true, reload: true });
              }
              return false;
            });
        }
        if (!video.paused || video.currentTime > 0.05) {
          debug("play-sync-ok");
          markPlaying();
          return Promise.resolve(true);
        }
        debug("play-no-promise");
        return Promise.resolve(false);
      };
      const playThroughBridge = (options = {}) => {
        const bridge = getBridge();
        const forceMuted = Boolean(options.forceMuted);
        const nextOptions = isWechat ? { ...options, forceMuted: false } : options;
        debug("bridge-start", { hasBridge: Boolean(bridge), forceMuted });
        if (bridge && typeof bridge.invoke === "function") {
          try {
            bridge.invoke("getNetworkType", {}, () => {
              debug("bridge-callback");
              void playIntro(nextOptions).then((ok) => {
                debug("bridge-play-result", { ok });
                if (!isWechat && !ok && !introMuted && !forceMuted && !closed && !progressed) {
                  window.setTimeout(() => {
                    if (!closed && !progressed) void playThroughBridge({ forceMuted: true, reload: true });
                  }, 80);
                }
              });
            });
            return;
          } catch (error) {
            debug("bridge-error", { message: error?.message || String(error || "") });
          }
        }
        if (isWechat) debug("bridge-missing-direct-play");
        void playIntro(nextOptions);
      };
      prepareAutoplay();
      if (!isWechat) {
        try { video.load?.(); debug("load-called"); } catch (error) { debug("load-error", { message: error?.message || String(error || "") }); }
      } else {
        window.setTimeout(() => {
          try { video.load?.(); debug("wechat-load-called"); } catch (error) { debug("wechat-load-error", { message: error?.message || String(error || "") }); }
        }, 30);
      }
      ["loadstart", "loadedmetadata", "loadeddata", "canplay", "playing", "timeupdate", "pause", "waiting", "stalled", "suspend", "ended", "error"].forEach((name) => {
        video.addEventListener(name, () => debug("event:" + name));
      });
      video.addEventListener("playing", () => {
        markPlaying();
      });
      video.addEventListener("timeupdate", () => {
        markPlaying();
      });
      overlay.querySelector("[data-intro-skip]")?.addEventListener("click", closeIntro);
      unmuteButton?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        restoreSound(event);
      });
      video.addEventListener("click", restoreSound);
      video.addEventListener("ended", () => {
        if (isWechat && !progressed) keepIntroFallback();
        else closeIntro();
      }, { once: true });
      video.addEventListener("error", () => {
        if (isWechat) {
          debug("wechat-error-no-close");
        }
        else closeIntro();
      }, { once: true });
      video.addEventListener("loadeddata", () => {
        if (!isWechat) playThroughBridge();
      }, { once: true });
      video.addEventListener("canplay", () => {
        if (!isWechat) playThroughBridge();
      }, { once: true });
      window.addEventListener("pageshow", () => playThroughBridge(), { once: true });
      document.addEventListener("WeixinJSBridgeReady", () => playThroughBridge(), false);
      document.addEventListener("YixinJSBridgeReady", () => playThroughBridge(), false);
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden && video.paused) playThroughBridge();
      });
      if (isWechat) {
        [80, 600, 1400].forEach((delay) => {
          window.setTimeout(() => {
            if (!closed && !progressed) playThroughBridge();
          }, delay);
        });
        document.addEventListener("touchstart", () => {
          if (!closed && !progressed) playThroughBridge();
        }, { passive: true, once: true });
      } else {
        [0, 120, 600, 1200].forEach((delay) => {
          window.setTimeout(() => {
            if (!closed && !progressed) playThroughBridge();
          }, delay);
        });
        window.setTimeout(() => {
          if (!closed && !progressed && !introMuted) playThroughBridge({ forceMuted: true, reload: true });
        }, 1800);
        window.setTimeout(() => {
          if (closed || progressed) return;
          if (video.currentTime > 0.05) {
            markPlaying();
            return;
          }
          closeIntro();
        }, 3600);
        playThroughBridge();
      }
    })();</script>`
        : ""
    }
  </body>
</html>`;
}

function buildMaintenanceSummaryHtml(reason: MerchantServiceRestrictionReason) {
  return `
    <div class="summary-row">
      <div class="summary-copy">
        <strong class="summary-label">状态：</strong>
        <span class="summary-value">${escapeHtml(reason === "expired" ? "已过期" : "维护中")}</span>
      </div>
    </div>
    <div class="summary-row">
      <div class="summary-copy">
        <strong class="summary-label">说明：</strong>
        <span class="summary-value">${escapeHtml(describeMerchantMaintenanceMessage(reason))}</span>
      </div>
    </div>
    <div class="summary-row">
      <div class="summary-copy">
        <strong class="summary-label">服务商：</strong>
        <span class="summary-value" data-no-translate="1">${escapeHtml("www.faolla.com")}</span>
      </div>
      <div class="summary-action">
        <a class="inline-action" href="${escapeHtml(OFFICIAL_SERVICE_CONTACT.serviceProviderUrl)}" aria-label="打开服务商官网" title="打开服务商官网" style="background:#111827">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3z"/><path d="M5 5h6v2H7v10h10v-4h2v6H5V5z"/></svg>
        </a>
      </div>
    </div>
    <div class="summary-row">
      <div class="summary-copy">
        <strong class="summary-label">联系人：</strong>
        <span class="summary-value" data-no-translate="1">${escapeHtml(OFFICIAL_SERVICE_CONTACT.contactName)}</span>
      </div>
    </div>
    <div class="summary-row">
      <div class="summary-copy">
        <strong class="summary-label">WhatsApp：</strong>
        <span class="summary-value" data-no-translate="1">${escapeHtml(OFFICIAL_SERVICE_CONTACT.whatsapp)}</span>
      </div>
      <div class="summary-action">
        <a class="inline-action" href="${escapeHtml(`https://wa.me/${OFFICIAL_SERVICE_CONTACT.whatsapp.replace(/[^\d]/g, "")}`)}" aria-label="打开 WhatsApp" title="打开 WhatsApp" style="background:#25D366">
          <img src="/social-icons/whatsapp.svg" alt="" />
        </a>
      </div>
    </div>
    <div class="summary-row">
      <div class="summary-copy">
        <strong class="summary-label">Wechat：</strong>
        <span class="summary-value" data-no-translate="1">${escapeHtml(OFFICIAL_SERVICE_CONTACT.wechat)}</span>
      </div>
    </div>
    <div class="summary-row">
      <div class="summary-copy">
        <strong class="summary-label">Mail：</strong>
        <span class="summary-value" data-no-translate="1">${escapeHtml(OFFICIAL_SERVICE_CONTACT.email)}</span>
      </div>
      <div class="summary-action">
        <a class="inline-action" href="${escapeHtml(`mailto:${OFFICIAL_SERVICE_CONTACT.email}`)}" aria-label="发送邮件" title="发送邮件" style="background:#0A84FF">
          <img src="/social-icons/maildotru.svg" alt="" />
        </a>
      </div>
    </div>`;
}

// Legacy maintenance template kept temporarily to avoid touching unrelated share-card layout logic.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildMaintenanceCardHtml(input: {
  merchantName: string;
  shareUrl: string;
  reason: MerchantServiceRestrictionReason;
}) {
  return buildShareCardHtml({
    title: `${input.merchantName || "FAOLLA CARD"} | 服务维护中`,
    description: "该商户服务当前维护中，请联系官方服务支持。",
    merchantName: input.merchantName,
    summaryHtml: buildMaintenanceSummaryHtml(input.reason),
    targetUrl: OFFICIAL_SERVICE_CONTACT.serviceProviderUrl,
    shareUrl: input.shareUrl,
  });
}

function buildServiceMaintenanceSummaryHtml(reason: MerchantServiceRestrictionReason) {
  return `
    <div class="summary-row">
      <div class="summary-copy">
        <strong class="summary-label">状态：</strong>
        <span class="summary-value">${escapeHtml(reason === "expired" ? "已过期" : "维护中")}</span>
      </div>
    </div>
    <div class="summary-row">
      <div class="summary-copy">
        <strong class="summary-label">说明：</strong>
        <span class="summary-value">${escapeHtml(describeMerchantMaintenanceMessage(reason))}</span>
      </div>
    </div>
    <div class="summary-row">
      <div class="summary-copy">
        <strong class="summary-label">服务商：</strong>
        <span class="summary-value" data-no-translate="1">www.faolla.com</span>
      </div>
      <div class="summary-action">
        <a class="inline-action" href="${escapeHtml(OFFICIAL_SERVICE_CONTACT.serviceProviderUrl)}" aria-label="打开服务商官网" title="打开服务商官网" style="background:#111827">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3z"/><path d="M5 5h6v2H7v10h10v-4h2v6H5V5z"/></svg>
        </a>
      </div>
    </div>
    <div class="summary-row">
      <div class="summary-copy">
        <strong class="summary-label">联系人：</strong>
        <span class="summary-value" data-no-translate="1">${escapeHtml(OFFICIAL_SERVICE_CONTACT.contactName)}</span>
      </div>
    </div>
    <div class="summary-row">
      <div class="summary-copy">
        <strong class="summary-label">WhatsApp：</strong>
        <span class="summary-value" data-no-translate="1">${escapeHtml(OFFICIAL_SERVICE_CONTACT.whatsapp)}</span>
      </div>
      <div class="summary-action">
        <a class="inline-action" href="${escapeHtml(`https://wa.me/${OFFICIAL_SERVICE_CONTACT.whatsapp.replace(/[^\d]/g, "")}`)}" aria-label="打开 WhatsApp" title="打开 WhatsApp" style="background:#25D366">
          <img src="/social-icons/whatsapp.svg" alt="" />
        </a>
      </div>
    </div>
    <div class="summary-row">
      <div class="summary-copy">
        <strong class="summary-label">Wechat：</strong>
        <span class="summary-value" data-no-translate="1">${escapeHtml(OFFICIAL_SERVICE_CONTACT.wechat)}</span>
      </div>
    </div>
    <div class="summary-row">
      <div class="summary-copy">
        <strong class="summary-label">Mail：</strong>
        <span class="summary-value" data-no-translate="1">${escapeHtml(OFFICIAL_SERVICE_CONTACT.email)}</span>
      </div>
      <div class="summary-action">
        <a class="inline-action" href="${escapeHtml(`mailto:${OFFICIAL_SERVICE_CONTACT.email}`)}" aria-label="发送邮件" title="发送邮件" style="background:#0A84FF">
          <img src="/social-icons/maildotru.svg" alt="" />
        </a>
      </div>
    </div>`;
}

function buildServiceMaintenanceCardHtml(input: {
  merchantName: string;
  shareUrl: string;
  reason: MerchantServiceRestrictionReason;
}) {
  return buildShareCardHtml({
    title: `${input.merchantName || "FAOLLA CARD"} | 服务维护中`,
    description: "该商户服务当前维护中，请联系官方服务支持。",
    merchantName: input.merchantName,
    summaryHtml: buildServiceMaintenanceSummaryHtml(input.reason),
    targetUrl: OFFICIAL_SERVICE_CONTACT.serviceProviderUrl,
    shareUrl: input.shareUrl,
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ card: string }> },
) {
  const { card } = await params;
  const shareKey = normalizeMerchantBusinessCardShareKey(card);
  const requestUrl = new URL(request.url);
  const introDebug = requestUrl.searchParams.get("introDebug") === "1";
  const requestOrigin = requestUrl.origin;
  if (!shareKey) {
    return new NextResponse("Invalid business card link", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  }

  const [revoked, storedPayload] = await Promise.all([
    withContactCardTimeout(
      isMerchantBusinessCardShareRevoked({
        shareKey,
        preferredOrigin: requestOrigin,
      }),
      false,
    ),
    withContactCardTimeout(loadMerchantBusinessCardSharePayloadByKey(shareKey, requestOrigin), null),
  ]);
  if (revoked) {
    return new NextResponse("Business card not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  }

  const snapshotMatch = await withContactCardTimeout(
    resolveContactCardSnapshotMatch(shareKey, storedPayload?.ownerMerchantId).catch(() => null),
    null,
    storedPayload ? 1600 : 3500,
  );
  const snapshotPayload = buildSharePayloadFromSnapshotMatch(snapshotMatch, requestOrigin);
  const payload = storedPayload ?? snapshotPayload;

  if (!payload) {
    return new NextResponse("Business card not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  }
  if (!storedPayload && snapshotPayload) {
    void withContactCardTimeout(hasExistingShareManifestObject(shareKey, requestOrigin), true, 1200).then((exists) => {
      if (exists) return;
      void repairShareManifestFromSnapshot({
        shareKey,
        snapshotMatch,
        payload: snapshotPayload,
        preferredOrigin: requestOrigin,
      }).catch(() => false);
    });
  }

  const title = buildMerchantBusinessCardShareTitle(payload.name);
  const description = buildMerchantBusinessCardShareDescription(payload.name, payload.targetUrl);
  const publicOrigin = resolveMerchantBusinessCardShareOrigin(request.url, payload.targetUrl) || requestOrigin;
  const snapshotCard = snapshotMatch?.card ?? null;
  const normalizedShareImageUrl = payload.imageUrl
    ? normalizeMerchantBusinessCardShareImageUrl(payload.imageUrl, publicOrigin) || payload.imageUrl
    : "";
  const imageUrl = normalizedShareImageUrl ? forcePublicStorageImageUrl(normalizedShareImageUrl, publicOrigin) : "";
  const previewImageUrl = imageUrl;
  const detailImageUrl = payload.detailImageUrl
    ? forcePublicStorageImageUrl(
        normalizeMerchantBusinessCardShareImageUrl(payload.detailImageUrl, publicOrigin) || payload.detailImageUrl,
        publicOrigin,
      )
    : "";
  const introVideoSource =
    snapshotMatch?.allowIntroVideo === false
      ? ""
      : normalizeText(payload.introVideoUrl) || normalizeText(snapshotCard?.contactIntroVideoUrl);
  const introVideoUrl = introVideoSource
    ? normalizeMerchantBusinessCardShareVideoUrl(introVideoSource, publicOrigin) || introVideoSource
    : "";
  const introPosterSource =
    snapshotMatch?.allowIntroVideo === false
      ? ""
      : normalizeText(payload.introPosterUrl) ||
        normalizeText(snapshotCard?.contactIntroVideoPosterUrl) ||
        deriveIntroPosterUrlFromVideoUrl(introVideoUrl);
  const introPosterUrl =
    introVideoUrl && introPosterSource
      ? forcePublicStorageImageUrl(
          normalizeMerchantBusinessCardShareImageUrl(introPosterSource, publicOrigin) || introPosterSource,
          publicOrigin,
        )
      : "";
  const contactUrl =
    buildMerchantBusinessCardContactDownloadUrl({
      origin: publicOrigin,
      shareKey,
      targetUrl: payload.targetUrl,
    }) || undefined;
  const shareUrl = buildMerchantBusinessCardShareUrl({
    origin: publicOrigin,
    shareKey,
    imageUrl: previewImageUrl,
    detailImageUrl,
    targetUrl: payload.targetUrl,
    name: payload.name,
    contact: payload.contact,
  });
  const serviceState = await withContactCardTimeout(
    loadPublishedMerchantServiceStateByTargetUrl(payload.targetUrl).catch(() => null),
    null,
    1600,
  );
  if (serviceState?.maintenance) {
    return new NextResponse(
      buildServiceMaintenanceCardHtml({
        merchantName: payload.name || serviceState.merchantName || "FAOLLA CARD",
        shareUrl,
        reason: serviceState.reason,
      }),
      {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store, max-age=0",
        },
      },
    );
  }
  const contactCouponSiteId =
    normalizeText(payload.ownerMerchantId) ||
    normalizeText(snapshotMatch?.siteId) ||
    serviceState?.siteId ||
    "";
  const contactCoupons = contactCouponSiteId
    ? await withContactCardTimeout(loadContactCardCoupons(contactCouponSiteId), [], 1600)
    : [];

  return new NextResponse(
    buildShareCardHtml({
      title,
      description,
      merchantName: payload.name,
      previewImageUrl: previewImageUrl || undefined,
      contentImageUrl: detailImageUrl || undefined,
      contentImageHeight: payload.detailImageHeight,
      introVideoUrl: introVideoUrl || undefined,
      introPosterUrl: introPosterUrl || undefined,
      introVideoMuted: payload.introVideoMuted ?? snapshotCard?.contactIntroVideoMuted,
      contactPageSectionOrder: payload.contactPageSectionOrder ?? snapshotCard?.contactPageSectionOrder,
      showContactSaveButton: payload.showContactSaveButton ?? snapshotCard?.showContactSaveButton,
      showContactWebsiteButton: payload.showContactWebsiteButton ?? snapshotCard?.showContactWebsiteButton,
      summaryHtml: buildContactSummaryHtml({
        name: payload.name,
        contact: payload.contact,
      }),
      imageWidth: payload.imageWidth,
      imageHeight: payload.imageHeight,
      targetUrl: payload.targetUrl,
      shareUrl,
      contactUrl,
      couponsHtml: buildContactCouponsHtml(contactCoupons),
      introDebug,
    }),
    {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    },
  );
}
