"use client";

import {
  SUPER_ADMIN_DEVICE_COOKIE_MAX_AGE_SECONDS,
  SUPER_ADMIN_DEVICE_ID_COOKIE,
  SUPER_ADMIN_DEVICE_ID_KEY,
  SUPER_ADMIN_LOGIN_PATH,
  SUPER_ADMIN_SESSION_COOKIE_MAX_AGE_SECONDS,
  SUPER_ADMIN_SESSION_KEY,
  SUPER_ADMIN_SESSION_VALUE,
  resolveSuperAdminCookieDomainFromHostname,
} from "@/lib/superAdminSession";
import type { SuperAdminTrustedDeviceDetails } from "@/lib/superAdminTrustedDevices";

export {
  SUPER_ADMIN_DEVICE_ID_COOKIE,
  SUPER_ADMIN_DEVICE_ID_KEY,
  SUPER_ADMIN_LOGIN_PATH,
  SUPER_ADMIN_SESSION_KEY,
  SUPER_ADMIN_SESSION_VALUE,
};

type UserAgentBrand = {
  brand?: string;
  version?: string;
};

type UserAgentHighEntropyValues = {
  model?: string;
  mobile?: boolean;
  platform?: string;
  platformVersion?: string;
  uaFullVersion?: string;
  fullVersionList?: UserAgentBrand[];
  formFactors?: string[];
};

type NavigatorWithDeviceHints = Navigator & {
  deviceMemory?: number;
  hardwareConcurrency?: number;
  userAgentData?: {
    platform?: string;
    mobile?: boolean;
    brands?: UserAgentBrand[];
    getHighEntropyValues?: (hints: string[]) => Promise<UserAgentHighEntropyValues>;
  };
};

function readCookieValue(key: string) {
  if (typeof document === "undefined") return "";
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${key}=`))
    ?.slice(key.length + 1) ?? "";
}

const SUPER_ADMIN_SESSION_RECENT_KEY = "merchant-space:super-admin-session-recent:v1";
const SUPER_ADMIN_SESSION_CONFIRMATION_GRACE_MS = Math.min(30_000, SUPER_ADMIN_SESSION_COOKIE_MAX_AGE_SECONDS * 1000);
const SUPER_ADMIN_SESSION_CONFIRMATION_RETRY_DELAYS_MS = [0, 350, 1_000, 2_500, 5_000, 8_000] as const;

function readRecentSuperAdminAuthTimestamp() {
  if (typeof window === "undefined") return 0;
  const raw = localStorage.getItem(SUPER_ADMIN_SESSION_RECENT_KEY) ?? "";
  const timestamp = Number.parseInt(raw, 10);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function markRecentSuperAdminAuthentication() {
  if (typeof window === "undefined") return;
  localStorage.setItem(SUPER_ADMIN_SESSION_RECENT_KEY, `${Date.now()}`);
}

function clearRecentSuperAdminAuthentication() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SUPER_ADMIN_SESSION_RECENT_KEY);
}

function hasPendingRecentSuperAdminAuthentication() {
  const timestamp = readRecentSuperAdminAuthTimestamp();
  return timestamp > 0 && Date.now() - timestamp <= SUPER_ADMIN_SESSION_CONFIRMATION_GRACE_MS;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function buildCookieDomainPart() {
  if (typeof window === "undefined") return "";
  const cookieDomain = resolveSuperAdminCookieDomainFromHostname(window.location.hostname);
  return cookieDomain ? `; Domain=${cookieDomain}` : "";
}

function clearHostOnlyCookie(key: string) {
  if (typeof document === "undefined") return;
  document.cookie = `${key}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function readSuperAdminDeviceIdCookie() {
  return readCookieValue(SUPER_ADMIN_DEVICE_ID_COOKIE).trim();
}

function writeSuperAdminDeviceIdCookie(deviceId: string) {
  if (typeof document === "undefined") return;
  const normalizedDeviceId = String(deviceId ?? "").trim();
  const cookieDomainPart = buildCookieDomainPart();
  if (cookieDomainPart) {
    clearHostOnlyCookie(SUPER_ADMIN_DEVICE_ID_COOKIE);
  }
  document.cookie = `${SUPER_ADMIN_DEVICE_ID_COOKIE}=${normalizedDeviceId}; Path=/; Max-Age=${
    normalizedDeviceId ? SUPER_ADMIN_DEVICE_COOKIE_MAX_AGE_SECONDS : 0
  }; SameSite=Lax${cookieDomainPart}`;
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readBrowserName(userAgent: string) {
  const ua = userAgent.toLowerCase();
  if (ua.includes("edg/")) return "Edge";
  if (ua.includes("chrome/")) return "Chrome";
  if (ua.includes("firefox/")) return "Firefox";
  if (ua.includes("safari/") && !ua.includes("chrome/")) return "Safari";
  return "Browser";
}

function readBrowserVersion(userAgent: string, highEntropy: UserAgentHighEntropyValues | null) {
  const fullVersionList = Array.isArray(highEntropy?.fullVersionList) ? highEntropy.fullVersionList : [];
  const browserName = readBrowserName(userAgent);
  const matchBrand = fullVersionList.find((item) => normalizeText(item.brand).includes(browserName));
  if (normalizeText(matchBrand?.version)) return normalizeText(matchBrand?.version);
  if (browserName === "Edge") return normalizeText(/edg\/([\d.]+)/i.exec(userAgent)?.[1]);
  if (browserName === "Chrome") return normalizeText(/chrome\/([\d.]+)/i.exec(userAgent)?.[1]);
  if (browserName === "Firefox") return normalizeText(/firefox\/([\d.]+)/i.exec(userAgent)?.[1]);
  if (browserName === "Safari") {
    return normalizeText(/version\/([\d.]+)/i.exec(userAgent)?.[1] ?? highEntropy?.uaFullVersion);
  }
  return normalizeText(highEntropy?.uaFullVersion);
}

function readOperatingSystem(userAgent: string, platformHint: string, highEntropy: UserAgentHighEntropyValues | null) {
  const normalizedPlatform = platformHint.toLowerCase();
  const normalizedUa = userAgent.toLowerCase();
  if (normalizedUa.includes("iphone") || normalizedUa.includes("ipad") || normalizedUa.includes("ipod")) {
    const version = normalizeText(/os ([\d_]+)/i.exec(userAgent)?.[1]).replace(/_/g, ".");
    return version ? `iOS ${version}` : "iOS";
  }
  if (normalizedUa.includes("android")) {
    const version = normalizeText(/android ([\d.]+)/i.exec(userAgent)?.[1] ?? highEntropy?.platformVersion);
    return version ? `Android ${version}` : "Android";
  }
  if (normalizedUa.includes("mac os x") || normalizedPlatform.includes("mac")) {
    const version = normalizeText(/mac os x ([\d_]+)/i.exec(userAgent)?.[1]).replace(/_/g, ".");
    return version ? `macOS ${version}` : "macOS";
  }
  if (normalizedUa.includes("windows") || normalizedPlatform.includes("win")) {
    const version = normalizeText(/windows nt ([\d.]+)/i.exec(userAgent)?.[1] ?? highEntropy?.platformVersion);
    return version ? `Windows ${version}` : "Windows";
  }
  if (normalizedUa.includes("cros")) return "ChromeOS";
  if (normalizedUa.includes("linux") || normalizedPlatform.includes("linux")) return "Linux";
  return platformHint || "Unknown";
}

function readDeviceModel(userAgent: string, platformHint: string, highEntropy: UserAgentHighEntropyValues | null) {
  const highEntropyModel = normalizeText(highEntropy?.model);
  if (highEntropyModel) return highEntropyModel;
  if (/iphone/i.test(userAgent)) return "iPhone";
  if (/ipad/i.test(userAgent)) return "iPad";
  if (/ipod/i.test(userAgent)) return "iPod";
  if (/android/i.test(userAgent)) return "Android device";
  if (/macintosh|mac os x/i.test(userAgent)) return "Mac";
  if (/windows/i.test(userAgent)) return "PC";
  return platformHint || "Current device";
}

function readDeviceType(userAgent: string, highEntropy: UserAgentHighEntropyValues | null) {
  const formFactors = Array.isArray(highEntropy?.formFactors)
    ? highEntropy.formFactors.map((item) => normalizeText(item).toLowerCase()).filter(Boolean)
    : [];
  if (formFactors.includes("tablet")) return "tablet" as const;
  if (formFactors.includes("mobile")) return "mobile" as const;
  if (highEntropy?.mobile === true) return "mobile" as const;
  if (/ipad|tablet/i.test(userAgent)) return "tablet" as const;
  if (/iphone|ipod|mobile/i.test(userAgent)) return "mobile" as const;
  if (/android/i.test(userAgent) && /mobile/i.test(userAgent)) return "mobile" as const;
  if (/windows|macintosh|linux|cros/i.test(userAgent)) return "desktop" as const;
  return "unknown" as const;
}

function formatDimensions(width: unknown, height: unknown, suffix = "") {
  const normalizedWidth = typeof width === "number" && Number.isFinite(width) ? Math.round(width) : 0;
  const normalizedHeight = typeof height === "number" && Number.isFinite(height) ? Math.round(height) : 0;
  if (!normalizedWidth || !normalizedHeight) return "";
  return `${normalizedWidth}×${normalizedHeight}${suffix}`;
}

function formatLanguages(navigatorValue: NavigatorWithDeviceHints) {
  const languages = Array.isArray(navigatorValue.languages)
    ? navigatorValue.languages.map((item) => normalizeText(item)).filter(Boolean)
    : [];
  const primary = normalizeText(navigatorValue.language) || languages[0] || "";
  return {
    language: primary,
    languages: languages.slice(0, 8),
  };
}

function formatBrands(
  navigatorValue: NavigatorWithDeviceHints,
  highEntropy: UserAgentHighEntropyValues | null,
  browserName: string,
  browserVersion: string,
) {
  const brandsSource = Array.isArray(highEntropy?.fullVersionList) && highEntropy.fullVersionList.length > 0
    ? highEntropy.fullVersionList
    : Array.isArray(navigatorValue.userAgentData?.brands)
      ? navigatorValue.userAgentData.brands
      : [];
  const brands = brandsSource
    .map((item) => {
      const brand = normalizeText(item.brand);
      const version = normalizeText(item.version);
      return brand ? `${brand}${version ? ` ${version}` : ""}` : "";
    })
    .filter(Boolean)
    .slice(0, 8);
  if (brands.length > 0) return brands;
  return browserName ? [`${browserName}${browserVersion ? ` ${browserVersion}` : ""}`] : [];
}

export function isSuperAdminAuthenticated() {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(SUPER_ADMIN_SESSION_KEY) === SUPER_ADMIN_SESSION_VALUE;
}

export function syncSuperAdminAuthenticatedCookie() {
  return isSuperAdminAuthenticated();
}

export async function refreshSuperAdminAuthenticatedState() {
  if (typeof window === "undefined") return false;
  const shouldRetry = hasPendingRecentSuperAdminAuthentication();
  const delays = shouldRetry ? SUPER_ADMIN_SESSION_CONFIRMATION_RETRY_DELAYS_MS : [0];
  for (const waitMs of delays) {
    if (waitMs > 0) {
      await delay(waitMs);
    }
    try {
      const response = await fetch("/api/super-admin/auth/session", {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
        },
      });
      const payload = (await response.json().catch(() => null)) as { authenticated?: unknown } | null;
      const authenticated = response.ok && payload?.authenticated !== false;
      if (authenticated) {
        localStorage.setItem(SUPER_ADMIN_SESSION_KEY, SUPER_ADMIN_SESSION_VALUE);
        markRecentSuperAdminAuthentication();
        return true;
      }
    } catch {
      if (!shouldRetry) {
        return localStorage.getItem(SUPER_ADMIN_SESSION_KEY) === SUPER_ADMIN_SESSION_VALUE;
      }
    }
  }
  localStorage.removeItem(SUPER_ADMIN_SESSION_KEY);
  clearRecentSuperAdminAuthentication();
  return false;
}

export function setSuperAdminAuthenticated() {
  if (typeof window === "undefined") return;
  localStorage.setItem(SUPER_ADMIN_SESSION_KEY, SUPER_ADMIN_SESSION_VALUE);
  markRecentSuperAdminAuthentication();
}

export function clearSuperAdminAuthenticated() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SUPER_ADMIN_SESSION_KEY);
  clearRecentSuperAdminAuthentication();
}

export function buildSuperAdminLoginHref(nextPath = "/super-admin") {
  const cleanNext = nextPath.trim() || "/super-admin";
  return `${SUPER_ADMIN_LOGIN_PATH}?next=${encodeURIComponent(cleanNext)}`;
}

export function getOrCreateSuperAdminDeviceId() {
  if (typeof window === "undefined") return "";
  const existing = localStorage.getItem(SUPER_ADMIN_DEVICE_ID_KEY)?.trim() ?? "";
  if (existing) {
    if (readSuperAdminDeviceIdCookie() !== existing) {
      writeSuperAdminDeviceIdCookie(existing);
    }
    return existing;
  }
  const sharedCookieDeviceId = readSuperAdminDeviceIdCookie();
  if (sharedCookieDeviceId) {
    localStorage.setItem(SUPER_ADMIN_DEVICE_ID_KEY, sharedCookieDeviceId);
    return sharedCookieDeviceId;
  }
  const nextId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `device-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(SUPER_ADMIN_DEVICE_ID_KEY, nextId);
  writeSuperAdminDeviceIdCookie(nextId);
  return nextId;
}

export function buildCurrentSuperAdminDeviceLabel() {
  if (typeof window === "undefined") return "当前设备";
  const navigatorValue = navigator as NavigatorWithDeviceHints;
  const platform = normalizeText(navigatorValue.userAgentData?.platform ?? navigator.platform) || "Unknown";
  const browser = readBrowserName(String(navigator.userAgent ?? ""));
  return `${platform} / ${browser}`;
}

export async function collectCurrentSuperAdminDeviceDetails(): Promise<SuperAdminTrustedDeviceDetails> {
  if (typeof window === "undefined") {
    return {
      platform: "",
      os: "",
      browser: "",
      browserVersion: "",
      model: "",
      deviceType: "unknown",
      language: "",
      languages: [],
      timezone: "",
      screen: "",
      viewport: "",
      userAgent: "",
      brands: [],
      deviceMemory: "",
      hardwareConcurrency: "",
    };
  }

  const navigatorValue = navigator as NavigatorWithDeviceHints;
  const userAgent = String(navigator.userAgent ?? "");
  let highEntropy: UserAgentHighEntropyValues | null = null;
  if (typeof navigatorValue.userAgentData?.getHighEntropyValues === "function") {
    try {
      highEntropy = await navigatorValue.userAgentData.getHighEntropyValues([
        "model",
        "platform",
        "platformVersion",
        "uaFullVersion",
        "fullVersionList",
        "formFactors",
      ]);
    } catch {
      highEntropy = null;
    }
  }

  const platform = normalizeText(
    highEntropy?.platform ?? navigatorValue.userAgentData?.platform ?? navigator.platform ?? "",
  );
  const browser = readBrowserName(userAgent);
  const browserVersion = readBrowserVersion(userAgent, highEntropy);
  const { language, languages } = formatLanguages(navigatorValue);
  const timezone = normalizeText(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const screen = formatDimensions(
    typeof window.screen !== "undefined" ? window.screen.width : 0,
    typeof window.screen !== "undefined" ? window.screen.height : 0,
    typeof window.devicePixelRatio === "number" && Number.isFinite(window.devicePixelRatio)
      ? ` @${window.devicePixelRatio.toFixed(window.devicePixelRatio % 1 === 0 ? 0 : 2)}x`
      : "",
  );
  const viewport = formatDimensions(window.innerWidth, window.innerHeight);

  return {
    platform: platform || "Unknown",
    os: readOperatingSystem(userAgent, platform, highEntropy),
    browser,
    browserVersion,
    model: readDeviceModel(userAgent, platform, highEntropy),
    deviceType: readDeviceType(userAgent, highEntropy),
    language,
    languages,
    timezone,
    screen,
    viewport,
    userAgent,
    brands: formatBrands(navigatorValue, highEntropy, browser, browserVersion),
    deviceMemory:
      typeof navigatorValue.deviceMemory === "number" && Number.isFinite(navigatorValue.deviceMemory)
        ? `${navigatorValue.deviceMemory} GB`
        : "",
    hardwareConcurrency:
      typeof navigatorValue.hardwareConcurrency === "number" && Number.isFinite(navigatorValue.hardwareConcurrency)
        ? `${navigatorValue.hardwareConcurrency}`
        : "",
  };
}
