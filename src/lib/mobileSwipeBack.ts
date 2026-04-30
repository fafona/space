export const MOBILE_SWIPE_BACK_EVENT = "faolla:mobile-swipe-back";

export type MobileSwipeBackEventDetail = {
  pathname: string;
  search: string;
  fallbackHref: string;
  origin: string;
};

type MobileSwipeBackGesture = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  viewportWidth?: number;
  elapsedMs?: number;
};

const MOBILE_SWIPE_BACK_MIN_DISTANCE = 78;
const MOBILE_SWIPE_BACK_MAX_VERTICAL_DRIFT = 72;
const MOBILE_SWIPE_BACK_MAX_DURATION_MS = 900;
const SHELL_SEARCH_PARAMS = ["appShell", "uiLocale"] as const;
const RESERVED_PORTAL_SUBDOMAINS = new Set(["www", "main", "portal"]);

function normalizeSearch(search: string | null | undefined) {
  const raw = String(search ?? "").trim();
  if (!raw) return "";
  return raw.startsWith("?") ? raw : `?${raw}`;
}

export function normalizeMobileSwipeBackPathname(pathname: string | null | undefined) {
  const raw = String(pathname ?? "").trim();
  if (!raw) return "/";
  try {
    const parsed = new URL(raw, "https://faolla.local");
    return normalizeMobileSwipeBackPath(parsed.pathname);
  } catch {
    return normalizeMobileSwipeBackPath(raw.split(/[?#]/)[0] ?? "/");
  }
}

function normalizeMobileSwipeBackPath(pathname: string) {
  const prefixed = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const compact = prefixed.replace(/\/{2,}/g, "/").replace(/\/+$/g, "");
  return compact || "/";
}

export function getMobileSwipeBackEdgeWidth(viewportWidth: number | null | undefined) {
  const width = typeof viewportWidth === "number" && Number.isFinite(viewportWidth) ? viewportWidth : 0;
  if (width <= 0) return 96;
  return Math.max(48, Math.min(112, Math.round(width * 0.26)));
}

export function isMobileSwipeBackGesture(input: MobileSwipeBackGesture) {
  const startX = Number(input.startX);
  const startY = Number(input.startY);
  const endX = Number(input.endX);
  const endY = Number(input.endY);
  if (![startX, startY, endX, endY].every(Number.isFinite)) return false;
  if (startX < 0 || startX > getMobileSwipeBackEdgeWidth(input.viewportWidth)) return false;

  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const verticalDrift = Math.abs(deltaY);
  if (deltaX < MOBILE_SWIPE_BACK_MIN_DISTANCE) return false;
  if (verticalDrift > MOBILE_SWIPE_BACK_MAX_VERTICAL_DRIFT) return false;
  if (deltaX <= verticalDrift * 1.35) return false;
  if (
    typeof input.elapsedMs === "number" &&
    Number.isFinite(input.elapsedMs) &&
    input.elapsedMs > MOBILE_SWIPE_BACK_MAX_DURATION_MS
  ) {
    return false;
  }
  return true;
}

export function createMobileSwipeBackEvent(detail: MobileSwipeBackEventDetail) {
  return new CustomEvent<MobileSwipeBackEventDetail>(MOBILE_SWIPE_BACK_EVENT, {
    cancelable: true,
    detail,
  });
}

export function resolveMobileSwipeBackHref(
  pathname: string | null | undefined,
  search: string | null | undefined = "",
  origin: string | null | undefined = "",
) {
  const path = normalizeMobileSwipeBackPathname(pathname);
  const normalizedSearch = normalizeSearch(search);

  if (path === "/") {
    const portalOrigin = resolvePortalOriginFromMerchantSubdomain(origin, normalizedSearch);
    return portalOrigin ? appendPreservedShellParams(`${portalOrigin}/`, normalizedSearch) : "";
  }

  const fallbackPath = resolveFallbackPath(path);
  if (!fallbackPath) return "";
  return appendPreservedShellParams(fallbackPath, normalizedSearch);
}

function resolveFallbackPath(path: string) {
  if (path === "/reset-password/bridge") return "/reset-password";
  if (path === "/reset-password") return "/login";
  if (path === "/super-admin/editor/latest") return "/super-admin/latest";
  if (path === "/super-admin/editor") return "/super-admin/latest";
  if (path === "/super-admin/latest" || path === "/super-admin/login" || path === "/super-admin") return "/";
  if (path === "/booking-calendar") return "/me";
  if (path === "/admin" || path === "/me") return "/";
  if (path === "/launch" || path === "/login" || path === "/offline" || path === "/portal" || path === "/pwa") return "/";
  if (/^\/(?:industry|site|u)\/[^/]+$/i.test(path)) return "/";
  if (/^\/card\/[^/]+$/i.test(path)) return "/";
  if (/^\/share\/business-card(?:\/|$)/i.test(path)) return "/";
  if (/^\/\d{8}$/.test(path)) return "/";

  const segments = path.split("/").filter(Boolean);
  if (segments.length <= 1) return "/";
  return `/${segments.slice(0, -1).join("/")}`;
}

function appendPreservedShellParams(href: string, search: string) {
  const preserved = readPreservedShellParams(search);
  if (preserved.length === 0) return href;

  if (/^https?:\/\//i.test(href)) {
    try {
      const url = new URL(href);
      preserved.forEach(([key, value]) => url.searchParams.set(key, value));
      return url.toString();
    } catch {
      return href;
    }
  }

  const hashIndex = href.indexOf("#");
  const hrefWithoutHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const hash = hashIndex >= 0 ? href.slice(hashIndex) : "";
  try {
    const url = new URL(hrefWithoutHash || "/", "https://faolla.local");
    preserved.forEach(([key, value]) => url.searchParams.set(key, value));
    return `${url.pathname}${url.search}${hash}`;
  } catch {
    return href;
  }
}

function readPreservedShellParams(search: string) {
  try {
    const params = new URLSearchParams(search);
    return SHELL_SEARCH_PARAMS.flatMap((key) => {
      const value = (params.get(key) ?? "").trim();
      return value ? ([[key, value]] as const) : [];
    });
  } catch {
    return [];
  }
}

function resolvePortalOriginFromMerchantSubdomain(origin: string | null | undefined, search: string) {
  if (!isFaollaAppShellSearch(search)) return "";
  const rawOrigin = String(origin ?? "").trim();
  if (!rawOrigin) return "";

  try {
    const url = new URL(rawOrigin);
    const labels = url.hostname.split(".").filter(Boolean);
    const prefix = labels[0]?.toLowerCase() ?? "";
    if (labels.length < 3 || !prefix || RESERVED_PORTAL_SUBDOMAINS.has(prefix)) return "";
    const rootHostname = labels.slice(1).join(".");
    return `${url.protocol}//${rootHostname}${url.port ? `:${url.port}` : ""}`;
  } catch {
    return "";
  }
}

function isFaollaAppShellSearch(search: string) {
  try {
    return (new URLSearchParams(search).get("appShell") ?? "").trim().toLowerCase() === "faolla";
  } catch {
    return false;
  }
}
