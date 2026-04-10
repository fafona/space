import { resolveSupportedLocale } from "@/lib/i18n";

import { findUiGlossarySource, getUiGlossaryText } from "@/lib/uiGlossary";

export type DomLocale = string;

const CACHE_PREFIX = "merchant-space:dom-i18n-cache:v3:";
const REQUEST_TIMEOUT_MS = 10000;
const DEFAULT_CONCURRENCY = 6;

const localeCacheStore = new Map<string, Map<string, string>>();
const reverseLocaleCacheStore = new Map<string, Map<string, string>>();
const loadedLocaleCache = new Set<string>();
const inFlightByLocale = new Map<string, Map<string, Promise<string>>>();
const dirtyLocales = new Set<string>();

let persistTimer: number | null = null;

const MANUAL_DOM_TRANSLATIONS: Record<string, Record<string, string>> = {
  商户信息: {
    "zh-cn": "商户信息",
    "zh-tw": "商戶資訊",
    en: "Profile",
    es: "Perfil",
    fr: "Profil",
    de: "Profil",
    it: "Profilo",
    pt: "Perfil",
    ru: "Профиль",
    uk: "Профіль",
    pl: "Profil",
    tr: "Profil",
    nl: "Profiel",
    ro: "Profil",
    cs: "Profil",
    sv: "Profil",
    hu: "Profil",
    da: "Profil",
    fi: "Profiili",
    no: "Profil",
    sk: "Profil",
    hr: "Profil",
    bs: "Profil",
    sr: "Profil",
    bg: "Профил",
    el: "Προφίλ",
    sq: "Profil",
    lt: "Profilis",
    sl: "Profil",
    lv: "Profils",
    et: "Profiil",
    mk: "Профил",
    ca: "Perfil",
    eu: "Profila",
    gl: "Perfil",
    cy: "Proffil",
    is: "Prófíll",
    ga: "Próifíl",
    mt: "Profil",
    lb: "Profil",
    ja: "店舗情報",
    ko: "상점정보",
  },
  名片夹: {
    es: "Tarjetero",
  },
  我的名片夹: {
    es: "Mi tarjetero",
  },
  会话: {
    es: "Chat",
  },
  "会话，有新消息": {
    es: "Chat, con mensajes nuevos",
  },
  数据统计: {
    es: "Estadísticas",
  },
};

function toApiTarget(locale: string) {
  const normalized = resolveSupportedLocale(locale).toLowerCase();
  if (normalized === "zh-cn") return "zh-CN";
  if (normalized === "zh-tw") return "zh-TW";
  return normalized.split("-")[0] || "en";
}

function getManualDomTranslation(source: string, locale: string) {
  const glossaryTranslation = getUiGlossaryText(source, locale);
  if (glossaryTranslation !== source) return glossaryTranslation;
  const entry = MANUAL_DOM_TRANSLATIONS[source];
  if (!entry) return null;
  const normalized = normalizeDomLocale(locale).toLowerCase();
  const language = normalized.split("-")[0] || normalized;
  return entry[normalized] ?? entry[language] ?? null;
}

function getManualDomReverseSource(translated: string, locale: string) {
  const glossarySource = findUiGlossarySource(translated, locale);
  if (glossarySource) return glossarySource;
  const normalized = normalizeDomLocale(locale).toLowerCase();
  const language = normalized.split("-")[0] || normalized;
  for (const [source, entry] of Object.entries(MANUAL_DOM_TRANSLATIONS)) {
    const candidate = entry[normalized] ?? entry[language];
    if (candidate === translated) return source;
  }
  return null;
}

export function normalizeDomLocale(locale: string | null | undefined): DomLocale {
  return resolveSupportedLocale(locale);
}

function splitOuterWhitespace(input: string) {
  const match = input.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!match) {
    return { leading: "", core: input, trailing: "" };
  }
  return {
    leading: match[1] ?? "",
    core: match[2] ?? "",
    trailing: match[3] ?? "",
  };
}

function hasLetterLikeContent(input: string) {
  return /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u3040-\u30FF\uAC00-\uD7AF\u3400-\u9FFF]/.test(input);
}

function isLikelyCodeOrToken(input: string) {
  if (/^(https?:\/\/|www\.)/i.test(input)) return true;
  if (/\S+@\S+/.test(input)) return true;
  if (/^[\w-./:@#%?=&]+$/.test(input) && !input.includes(" ")) return true;
  return false;
}

function shouldTranslateCoreText(input: string, locale: string) {
  if (toApiTarget(locale) === "zh-CN") return false;
  const trimmed = input.trim();
  if (!trimmed) return false;
  if (trimmed.length > 320) return false;
  if (!hasLetterLikeContent(trimmed)) return false;
  if (isLikelyCodeOrToken(trimmed)) return false;
  if (/^[0-9\s.,:;!?%+\-_/()[\]{}|]+$/.test(trimmed)) return false;
  return true;
}

function getLocaleCache(locale: string) {
  const normalized = normalizeDomLocale(locale);
  let map = localeCacheStore.get(normalized);
  if (!map) {
    map = new Map<string, string>();
    localeCacheStore.set(normalized, map);
  }
  if (!loadedLocaleCache.has(normalized) && typeof window !== "undefined") {
    loadedLocaleCache.add(normalized);
    try {
      const raw = window.localStorage.getItem(`${CACHE_PREFIX}${normalized}`);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, string>;
        Object.entries(parsed).forEach(([source, translated]) => {
          if (!source || typeof source !== "string") return;
          if (!translated || typeof translated !== "string") return;
          map.set(source, translated);
        });
      }
    } catch {
      // Ignore cache parse failures.
    }
  }
  return map;
}

function getReverseLocaleCache(locale: string) {
  const normalized = normalizeDomLocale(locale);
  const cache = getLocaleCache(normalized);
  const existing = reverseLocaleCacheStore.get(normalized);
  if (existing && existing.size >= cache.size) return existing;

  const reverse = new Map<string, string>();
  cache.forEach((translated, source) => {
    if (!reverse.has(translated)) reverse.set(translated, source);
  });
  reverseLocaleCacheStore.set(normalized, reverse);
  return reverse;
}

function schedulePersist() {
  if (persistTimer !== null || typeof window === "undefined") return;
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    const locales = [...dirtyLocales];
    dirtyLocales.clear();
    locales.forEach((locale) => {
      const cache = localeCacheStore.get(locale);
      if (!cache) return;
      try {
        const payload = Object.fromEntries(cache.entries());
        window.localStorage.setItem(`${CACHE_PREFIX}${locale}`, JSON.stringify(payload));
      } catch {
        // Ignore storage write failures.
      }
    });
  }, 320);
}

function setCachedTranslation(locale: string, source: string, translated: string) {
  const normalized = normalizeDomLocale(locale);
  const cache = getLocaleCache(normalized);
  cache.set(source, translated);
  const reverse = getReverseLocaleCache(normalized);
  if (!reverse.has(translated)) reverse.set(translated, source);
  dirtyLocales.add(normalized);
  schedulePersist();
}

function parseTranslateResponse(json: unknown, fallback: string) {
  if (!Array.isArray(json) || !Array.isArray(json[0])) return fallback;
  const segments = json[0] as unknown[];
  const translated = segments
    .map((segment) => (Array.isArray(segment) ? segment[0] : ""))
    .filter((item): item is string => typeof item === "string")
    .join("")
    .trim();
  return translated || fallback;
}

async function requestTranslation(source: string, locale: string) {
  const target = toApiTarget(locale);
  if (target === "zh-CN") return source;

  const query = new URLSearchParams({
    client: "gtx",
    sl: "auto",
    tl: target,
    dt: "t",
    q: source,
  });

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`https://translate.googleapis.com/translate_a/single?${query.toString()}`, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) return source;
    const json = await response.json();
    return parseTranslateResponse(json, source);
  } catch {
    return source;
  } finally {
    window.clearTimeout(timer);
  }
}

async function getOrRequestTranslation(source: string, locale: string) {
  const normalized = normalizeDomLocale(locale);
  const cache = getLocaleCache(normalized);
  const cached = cache.get(source);
  if (cached) return cached;

  let localeInflight = inFlightByLocale.get(normalized);
  if (!localeInflight) {
    localeInflight = new Map<string, Promise<string>>();
    inFlightByLocale.set(normalized, localeInflight);
  }

  const inflight = localeInflight.get(source);
  if (inflight) return inflight;

  const promise = requestTranslation(source, normalized)
    .then((translated) => {
      setCachedTranslation(normalized, source, translated || source);
      return translated || source;
    })
    .finally(() => {
      localeInflight?.delete(source);
    });

  localeInflight.set(source, promise);
  return promise;
}

export function hasTranslatableText(input: string, locale: string) {
  const { core } = splitOuterWhitespace(input);
  return shouldTranslateCoreText(core, locale);
}

export function isDomTranslationCached(input: string, locale: string) {
  const normalized = normalizeDomLocale(locale);
  if (toApiTarget(normalized) === "zh-CN") return true;
  const { core } = splitOuterWhitespace(input);
  if (!shouldTranslateCoreText(core, normalized)) return true;
  if (getManualDomTranslation(core, normalized)) return true;
  return getLocaleCache(normalized).has(core);
}

export function translateDomText(input: string, locale: string) {
  const normalized = normalizeDomLocale(locale);
  if (toApiTarget(normalized) === "zh-CN") return input;

  const { leading, core, trailing } = splitOuterWhitespace(input);
  if (!shouldTranslateCoreText(core, normalized)) return input;

  const manual = getManualDomTranslation(core, normalized);
  if (manual) {
    return `${leading}${manual}${trailing}`;
  }

  const cache = getLocaleCache(normalized);
  const translated = cache.get(core);
  if (!translated) return input;
  return `${leading}${translated}${trailing}`;
}

export function reverseTranslateDomText(input: string, locale: string) {
  const normalized = normalizeDomLocale(locale);
  if (toApiTarget(normalized) === "zh-CN") return input;

  const { leading, core, trailing } = splitOuterWhitespace(input);
  if (!core) return null;

  const reverse = getReverseLocaleCache(normalized);
  const source = reverse.get(core);
  if (source) return `${leading}${source}${trailing}`;

  const manualSource = getManualDomReverseSource(core, normalized);
  if (!manualSource) return null;
  return `${leading}${manualSource}${trailing}`;
}

export async function ensureDomTranslations(texts: Iterable<string>, locale: string, concurrency = DEFAULT_CONCURRENCY) {
  const normalized = normalizeDomLocale(locale);
  if (toApiTarget(normalized) === "zh-CN") return;

  const unique = new Set<string>();
  for (const sourceText of texts) {
    const { core } = splitOuterWhitespace(sourceText);
    if (!core) continue;
    if (!shouldTranslateCoreText(core, normalized)) continue;
    if (getManualDomTranslation(core, normalized)) continue;
    if (getLocaleCache(normalized).has(core)) continue;
    unique.add(core);
  }

  if (unique.size === 0) return;

  const queue = [...unique];
  const workerCount = Math.max(1, Math.min(concurrency, queue.length));

  await Promise.all(
    Array.from({ length: workerCount }).map(async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (!next) break;
        await getOrRequestTranslation(next, normalized);
      }
    }),
  );
}
