import { NextResponse } from "next/server";
import {
  buildMerchantBusinessCardContactDownloadUrl,
  buildMerchantBusinessCardShareDescription,
  buildMerchantBusinessCardShareTitle,
  buildMerchantBusinessCardShareUrl,
  isMerchantBusinessCardShareRevoked,
  loadMerchantBusinessCardSharePayloadByKey,
  normalizeMerchantBusinessCardShareImageUrl,
  normalizeMerchantBusinessCardShareKey,
  resolveMerchantBusinessCardShareOrigin,
  type MerchantBusinessCardShareContact,
} from "@/lib/merchantBusinessCardShare";
import {
  normalizeMerchantBusinessCardContactFieldOrder,
  type MerchantBusinessCardContactDisplayKey,
} from "@/lib/merchantBusinessCards";
import { DEFAULT_LOCALE, I18N_STORAGE_KEY, LANGUAGE_OPTIONS } from "@/lib/i18n";

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

function looksLikeUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function buildCardImageRouteUrl(origin: string, shareKey: string) {
  const normalizedOrigin = normalizeText(origin).replace(/\/+$/g, "");
  const normalizedKey = normalizeText(shareKey);
  if (!normalizedOrigin || !normalizedKey) return "";
  return `${normalizedOrigin}/card/${normalizedKey}/image`;
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

function buildInlineSvgIcon(kind: "phone" | "map") {
  if (kind === "phone") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.62 10.79a15.53 15.53 0 0 0 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.4 21 3 13.6 3 4c0-.55.45-1 1-1h3.49c.55 0 1 .45 1 1 0 1.24.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.19 2.2z"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 4.74 6.14 11.84 6.4 12.14a.8.8 0 0 0 1.2 0C12.86 20.84 19 13.74 19 9a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"/></svg>`;
}

function buildSocialHref(label: string, rawValue?: string) {
  const value = normalizeText(rawValue);
  if (!value) return "";
  if (looksLikeUrl(value) || /^weixin:\/\//i.test(value)) return value;

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

type SummaryRow = { label: string; value: string; actionHtml: string };

function buildSummaryActionHtmlFromKey(key: MerchantBusinessCardContactDisplayKey, label: string, value: string) {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) return "";
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
    case "discord":
      return buildActionButtonHtml({
        href: buildSocialHref("Discord", normalizedValue),
        label: "打开 Discord",
        iconUrl: "/social-icons/discord.svg",
        bgColor: "#5865F2",
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
    case "douyin":
      return buildActionButtonHtml({
        href: `https://www.douyin.com/search/${encodeURIComponent(normalizedValue.replace(/^@+/, ""))}`,
        label: "打开抖音",
        iconUrl: "/social-icons/tiktok.svg",
        bgColor: "#161823",
      });
    case "xiaohongshu":
      return buildActionButtonHtml({
        href: `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(normalizedValue)}`,
        label: "打开小红书",
        iconUrl: "/social-icons/xiaohongshu.svg",
        bgColor: "#FF2442",
      });
    default:
      return "";
  }
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
      value,
      actionHtml: buildSummaryActionHtmlFromKey(key, label, value),
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
  const defaultFlag = defaultOption ? `https://flagcdn.com/24x18/${defaultOption.countryCode.toLowerCase()}.png` : "";

  return `<label class="lang-switcher" data-no-translate="1" title="${escapeHtml(defaultOption?.label ?? DEFAULT_LOCALE)}" aria-label="Select language">
    ${defaultFlag ? `<img data-language-flag src="${escapeHtml(defaultFlag)}" alt="${escapeHtml(defaultOption?.label ?? DEFAULT_LOCALE)}" />` : ""}
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
    const CACHE_PREFIX = "merchant-space:dom-i18n-cache:v3:";
    const DEFAULT_LOCALE = ${serializeInlineScriptValue(DEFAULT_LOCALE)};
    const LANGUAGE_OPTIONS = ${serializeInlineScriptValue(languageOptions)};
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
      if (!shouldTranslateCoreText(parts.core, normalized)) return input;
      const translated = getLocaleCache(normalized).get(parts.core);
      return translated ? parts.leading + translated + parts.trailing : input;
    }

    function reverseTranslateDomText(input, locale) {
      const normalized = resolveLocale(locale);
      if (toApiTarget(normalized) === "zh-CN") return input;
      const parts = splitOuterWhitespace(input);
      if (!parts.core) return null;
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
        flagEl.setAttribute("src", "https://flagcdn.com/24x18/" + selected.countryCode.toLowerCase() + ".png");
        flagEl.setAttribute("alt", selected.label);
      }
      if (switcherEl && selected) {
        switcherEl.setAttribute("title", selected.label);
        switcherEl.setAttribute("aria-label", selected.label);
      }
      if (selectEl && selectEl.value !== normalized) selectEl.value = normalized;
    }

    async function applyLocale(locale) {
      const normalized = resolveLocale(locale);
      const previousLocale = document.documentElement.getAttribute("data-ui-locale") || "zh-CN";
      document.documentElement.lang = normalized;
      document.documentElement.setAttribute("data-ui-locale", normalized);
      updateLanguageUi(normalized);
      try {
        window.localStorage.setItem(STORAGE_KEY, normalized);
      } catch {}
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
        void applyLocale(target.value);
      });
    }

    let wechatToastTimer = null;

    function showWechatToast(message) {
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
      }, 2400);
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

    const openTargetButtons = Array.from(document.querySelectorAll("[data-open-target-url]"));
    openTargetButtons.forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const target = event.currentTarget;
        if (!(target instanceof HTMLElement)) return;
        openTargetUrl(String(target.dataset.openTargetUrl || "").trim());
      });
    });

    let initialLocale = DEFAULT_LOCALE;
    try {
      initialLocale = resolveLocale(window.localStorage.getItem(STORAGE_KEY));
    } catch {}
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
          actionHtml: buildActionButtonHtml({
            href: buildSocialHref("Discord", input.contact.discord),
            label: "打开 Discord",
            iconUrl: "/social-icons/discord.svg",
            bgColor: "#5865F2",
          }),
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
          actionHtml: buildActionButtonHtml({
            href: buildSocialHref("抖音", input.contact.douyin),
            label: "打开抖音",
            iconUrl: "/social-icons/tiktok.svg",
            bgColor: "#161823",
          }),
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
  ].filter(Boolean) as Array<{ label: string; value: string; actionHtml: string }>;

  if (rows.length === 0) {
    return `<div class="summary-row"><span class="summary-value" data-no-translate="1">${escapeHtml(normalizeText(input.name) || "电子名片")}</span></div>`;
  }

  return rows
    .map(
      (row) => `
        <div class="summary-row">
          <div class="summary-copy">
            <strong class="summary-label">${escapeHtml(row.label)}：</strong>
            <span class="summary-value" data-no-translate="1">${escapeHtml(row.value)}</span>
          </div>
          ${row.actionHtml ? `<div class="summary-action">${row.actionHtml}</div>` : ""}
        </div>`,
    )
    .join("");
}

function buildContactSummaryHtml(input: {
  name: string;
  contact?: MerchantBusinessCardShareContact;
}) {
  return buildOrderedContactSummaryHtml(input) || buildContactSummaryHtmlLegacy(input);
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

  const pushRow = (key: MerchantBusinessCardContactDisplayKey, row: SummaryRow | null) => {
    if (!row) return;
    rowsByKey[key] = [...(rowsByKey[key] ?? []), row];
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
          actionHtml: buildActionButtonHtml({
            href: buildSocialHref("Discord", contact.discord),
            label: "打开 Discord",
            iconUrl: "/social-icons/discord.svg",
            bgColor: "#5865F2",
          }),
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
          actionHtml: buildActionButtonHtml({
            href: `https://www.douyin.com/search/${encodeURIComponent(contact.douyin.replace(/^@+/, ""))}`,
            label: "打开抖音",
            iconUrl: "/social-icons/tiktok.svg",
            bgColor: "#161823",
          }),
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

  if (rows.length === 0) {
    return `<div class="summary-row"><span class="summary-value" data-no-translate="1">${escapeHtml(normalizeText(input.name) || "电子名片")}</span></div>`;
  }

  return rows
    .map(
      (row) => `
        <div class="summary-row">
          <div class="summary-copy">
            <strong class="summary-label">${escapeHtml(row.label)}：</strong>
            <span class="summary-value" data-no-translate="1">${escapeHtml(row.value)}</span>
          </div>
          ${row.actionHtml ? `<div class="summary-action">${row.actionHtml}</div>` : ""}
        </div>`,
    )
    .join("");
}

function buildShareCardHtml(input: {
  title: string;
  description: string;
  merchantName: string;
  previewImageUrl?: string;
  contentImageUrl?: string;
  contentImageHeight?: number;
  summaryHtml: string;
  imageWidth?: number;
  imageHeight?: number;
  targetUrl: string;
  shareUrl: string;
  contactUrl?: string;
}) {
  const title = escapeHtml(input.title);
  const description = escapeHtml(input.description);
  const merchantName = escapeHtml(input.merchantName);
  const previewImageUrl = input.previewImageUrl ? escapeHtml(input.previewImageUrl) : "";
  const contentImageUrl = input.contentImageUrl ? escapeHtml(input.contentImageUrl) : "";
  const contentImageHeight = input.contentImageHeight ?? 0;
  const targetUrl = escapeHtml(input.targetUrl);
  const shareUrl = escapeHtml(input.shareUrl);
  const inlineI18nScript = buildInlineI18nScript();
  const languageSwitcherHtml = buildLanguageSwitcherHtml();

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
      body {
        margin: 0;
        font-family: "Segoe UI", Arial, sans-serif;
        background: #f5efe5;
        color: #0f172a;
      }
      main {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 72px 24px 24px;
      }
      .lang-switcher {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 20;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 42px;
        height: 42px;
        border-radius: 999px;
        border: 1px solid rgba(15,23,42,.12);
        background: rgba(255,255,255,.94);
        box-shadow: 0 18px 40px rgba(15,23,42,.12);
        backdrop-filter: blur(10px);
        overflow: hidden;
        cursor: pointer;
      }
      .lang-switcher img {
        width: 20px;
        height: 15px;
        border-radius: 3px;
        border: 1px solid rgba(15,23,42,.08);
        object-fit: cover;
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
      .summary-action {
        flex-shrink: 0;
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
      @media (max-width: 520px) {
        main {
          padding: 70px 12px 12px;
        }
        article {
          padding: 16px;
        }
        .lang-switcher {
          top: 12px;
          right: 12px;
          width: 40px;
          height: 40px;
        }
        .summary-row {
          align-items: flex-start;
        }
      }
    </style>
  </head>
  <body>
    ${languageSwitcherHtml}
    <main>
      <article>
        <div class="brandline" data-no-translate="1">FAOLLA CARD</div>
        ${merchantName ? `<h1 data-no-translate="1">${merchantName}</h1>` : ""}
        ${
          contentImageUrl
            ? `<a class="card" href="${targetUrl}">
          <img src="${contentImageUrl}" alt="${title}"${contentImageHeight ? ` style="height:${contentImageHeight}px;object-fit:cover;"` : ""} />
        </a>`
            : ""
        }
        <div class="summary">${input.summaryHtml}</div>
        <div class="actions">
          ${
            input.contactUrl
              ? `<a class="button" href="${escapeHtml(input.contactUrl)}">一键保存到通讯录</a>`
              : ""
          }
          <button class="button secondary" type="button" data-open-target-url="${targetUrl}">打开网页</button>
        </div>
        <div class="footer">
          名片服务由 <a href="https://www.faolla.com" target="_blank" rel="noopener noreferrer" data-no-translate="1">www.faolla.com</a> 提供
        </div>
      </article>
    </main>
    <script>${inlineI18nScript}</script>
  </body>
</html>`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ card: string }> },
) {
  const { card } = await params;
  const shareKey = normalizeMerchantBusinessCardShareKey(card);
  const requestUrl = new URL(request.url);
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

  if (
    await isMerchantBusinessCardShareRevoked({
      shareKey,
      preferredOrigin: requestOrigin,
    })
  ) {
    return new NextResponse("Business card not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  }

  const payload = await loadMerchantBusinessCardSharePayloadByKey(shareKey, requestOrigin);
  if (!payload) {
    return new NextResponse("Business card not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  }

  const title = buildMerchantBusinessCardShareTitle(payload.name);
  const description = buildMerchantBusinessCardShareDescription(payload.name, payload.targetUrl);
  const publicOrigin = resolveMerchantBusinessCardShareOrigin(request.url, payload.targetUrl) || requestOrigin;
  const normalizedShareImageUrl = payload.imageUrl
    ? normalizeMerchantBusinessCardShareImageUrl(payload.imageUrl, publicOrigin) || payload.imageUrl
    : "";
  const imageUrl = normalizedShareImageUrl ? forcePublicStorageImageUrl(normalizedShareImageUrl, publicOrigin) : "";
  const previewImageUrl = imageUrl ? buildCardImageRouteUrl(publicOrigin, shareKey) || imageUrl : "";
  const detailImageUrl = payload.detailImageUrl
    ? forcePublicStorageImageUrl(
        normalizeMerchantBusinessCardShareImageUrl(payload.detailImageUrl, publicOrigin) || payload.detailImageUrl,
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

  return new NextResponse(
    buildShareCardHtml({
      title,
      description,
      merchantName: payload.name,
      previewImageUrl: previewImageUrl || undefined,
      contentImageUrl: detailImageUrl || undefined,
      contentImageHeight: payload.detailImageHeight,
      summaryHtml: buildContactSummaryHtml({
        name: payload.name,
        contact: payload.contact,
      }),
      imageWidth: payload.imageWidth,
      imageHeight: payload.imageHeight,
      targetUrl: payload.targetUrl,
      shareUrl,
      contactUrl,
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
