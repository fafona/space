import { I18N_URL_PARAM } from "@/lib/i18n";

export const FAOLLA_SECTION_PARAM = "section";
export const FAOLLA_SECTION_VALUE = "faolla";
export const FAOLLA_URL_PARAM = "faollaUrl";
export const FAOLLA_APP_SHELL_PARAM = "appShell";
export const FAOLLA_APP_SHELL_VALUE = "faolla";
export const FAOLLA_LAST_ENTRY_STORAGE_KEY = "faolla:last-entry-url";

type NormalizeFaollaEntryOptions = {
  allowCrossOrigin?: boolean;
  allowFaollaCrossOrigin?: boolean;
};

function getRuntimeOrigin(fallbackOrigin?: string | null) {
  const fallback = String(fallbackOrigin ?? "").trim();
  if (/^https?:\/\//i.test(fallback)) return fallback;
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return "https://faolla.com";
}

function isFaollaHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "faolla.com" || normalized.endsWith(".faolla.com");
}

function isSameLocalHostname(left: string, right: string) {
  const normalizedLeft = left.trim().toLowerCase();
  const normalizedRight = right.trim().toLowerCase();
  if (normalizedLeft !== normalizedRight) return false;
  return normalizedLeft === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(normalizedLeft);
}

function isTrustedFaollaCrossOrigin(candidate: URL, runtime: URL) {
  if (candidate.origin === runtime.origin) return true;
  if (isFaollaHostname(candidate.hostname) && isFaollaHostname(runtime.hostname)) return true;
  return isSameLocalHostname(candidate.hostname, runtime.hostname);
}

function isBackendOrApiPath(pathname: string) {
  return /^\/(?:\d{8}|admin|api|login|me|super-admin)(?:\/|$)/i.test(pathname);
}

function isUsableFrontendEntryUrl(value: string) {
  try {
    return !isBackendOrApiPath(new URL(value).pathname);
  } catch {
    return false;
  }
}

export function normalizeFaollaEntryUrl(
  value: unknown,
  fallbackOrigin?: string | null,
  options: NormalizeFaollaEntryOptions = {},
) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  if (/^(?:javascript|data|blob):/i.test(raw)) return "";

  try {
    const runtimeOrigin = getRuntimeOrigin(fallbackOrigin);
    const url = new URL(raw, runtimeOrigin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    const runtimeUrl = new URL(runtimeOrigin);
    if (
      !options.allowCrossOrigin &&
      url.origin !== runtimeUrl.origin &&
      !(options.allowFaollaCrossOrigin && isTrustedFaollaCrossOrigin(url, runtimeUrl))
    ) {
      return "";
    }
    return url.toString();
  } catch {
    return "";
  }
}

export function readStoredFaollaEntryUrl(fallbackOrigin?: string | null) {
  if (typeof window === "undefined") return "";
  const storages = [window.sessionStorage, window.localStorage];
  for (const storage of storages) {
    try {
      const normalized = normalizeFaollaEntryUrl(storage.getItem(FAOLLA_LAST_ENTRY_STORAGE_KEY) ?? "", fallbackOrigin, {
        allowFaollaCrossOrigin: true,
      });
      if (!normalized) continue;
      if (isUsableFrontendEntryUrl(normalized)) return normalized;
      storage.removeItem(FAOLLA_LAST_ENTRY_STORAGE_KEY);
    } catch {
      // Some browsers block storage in private or embedded contexts.
    }
  }
  return "";
}

export function clearStoredFaollaEntryUrl() {
  if (typeof window === "undefined") return;
  for (const storage of [window.sessionStorage, window.localStorage]) {
    try {
      storage.removeItem(FAOLLA_LAST_ENTRY_STORAGE_KEY);
    } catch {
      // Best-effort cleanup only.
    }
  }
}

export function resolveFaollaEntryUrlFromBrowser(search: string | null | undefined, fallbackOrigin?: string | null) {
  if (typeof window === "undefined") return "";
  clearStoredFaollaEntryUrl();
  const origin = fallbackOrigin || window.location.origin;
  const fromSearch = readFaollaEntryUrlFromSearch(search, origin);
  return fromSearch && isUsableFrontendEntryUrl(fromSearch) ? fromSearch : "";
}

export function isFaollaSectionSearch(search: string | null | undefined) {
  try {
    return (
      (new URLSearchParams(String(search ?? "")).get(FAOLLA_SECTION_PARAM) ?? "")
        .trim()
        .toLowerCase() === FAOLLA_SECTION_VALUE
    );
  } catch {
    return false;
  }
}

export function readFaollaEntryUrlFromSearch(search: string | null | undefined, fallbackOrigin?: string | null) {
  try {
    return normalizeFaollaEntryUrl(
      new URLSearchParams(String(search ?? "")).get(FAOLLA_URL_PARAM) ?? "",
      fallbackOrigin,
      { allowFaollaCrossOrigin: true },
    );
  } catch {
    return "";
  }
}

export function buildBackendFaollaHref(baseHref: string, faollaUrl: string, fallbackOrigin?: string | null) {
  const normalizedFaollaUrl = normalizeFaollaEntryUrl(faollaUrl, fallbackOrigin, { allowFaollaCrossOrigin: true });
  if (!normalizedFaollaUrl || !isUsableFrontendEntryUrl(normalizedFaollaUrl)) return baseHref;

  const runtimeOrigin = getRuntimeOrigin(fallbackOrigin);
  try {
    const url = new URL(baseHref || "/", runtimeOrigin);
    url.searchParams.set(FAOLLA_SECTION_PARAM, FAOLLA_SECTION_VALUE);
    url.searchParams.set(FAOLLA_URL_PARAM, normalizedFaollaUrl);
    return url.origin === runtimeOrigin ? `${url.pathname}${url.search}${url.hash}` : url.toString();
  } catch {
    return baseHref;
  }
}

export function buildFaollaShellHref(sourceHref: string, locale?: string | null, fallbackOrigin?: string | null) {
  const defaultOrigin = getFaollaDefaultOrigin(fallbackOrigin);
  const rawSourceHref = String(sourceHref ?? "").trim();
  const source = rawSourceHref === "/" ? defaultOrigin : rawSourceHref || defaultOrigin;
  const normalized =
    normalizeFaollaEntryUrl(source, fallbackOrigin, { allowCrossOrigin: true }) ||
    normalizeFaollaEntryUrl(defaultOrigin, fallbackOrigin);
  const resolved = normalized && isUsableFrontendEntryUrl(normalized) ? normalized : defaultOrigin;

  try {
    const url = new URL(resolved, getRuntimeOrigin(fallbackOrigin));
    const normalizedLocale = String(locale ?? "").trim();
    if (normalizedLocale) url.searchParams.set(I18N_URL_PARAM, normalizedLocale);
    url.searchParams.set(FAOLLA_APP_SHELL_PARAM, FAOLLA_APP_SHELL_VALUE);
    return url.toString();
  } catch {
    return defaultOrigin;
  }
}

function getFaollaDefaultOrigin(fallbackOrigin?: string | null) {
  const runtimeOrigin = getRuntimeOrigin(fallbackOrigin);
  try {
    const url = new URL(runtimeOrigin);
    if (isFaollaHostname(url.hostname)) {
      return `${url.protocol}//faolla.com${url.port ? `:${url.port}` : ""}/`;
    }
    return `${url.origin}/`;
  } catch {
    return "https://faolla.com/";
  }
}
