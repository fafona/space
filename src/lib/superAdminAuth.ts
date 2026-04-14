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

export {
  SUPER_ADMIN_DEVICE_ID_COOKIE,
  SUPER_ADMIN_DEVICE_ID_KEY,
  SUPER_ADMIN_LOGIN_PATH,
  SUPER_ADMIN_SESSION_KEY,
  SUPER_ADMIN_SESSION_VALUE,
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
const SUPER_ADMIN_SESSION_CONFIRMATION_GRACE_MS = Math.min(15_000, SUPER_ADMIN_SESSION_COOKIE_MAX_AGE_SECONDS * 1000);
const SUPER_ADMIN_SESSION_CONFIRMATION_RETRY_DELAYS_MS = [0, 250, 900, 1800] as const;

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
      const authenticated = response.ok && payload?.authenticated === true;
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

function readBrowserName(userAgent: string) {
  const ua = userAgent.toLowerCase();
  if (ua.includes("edg/")) return "Edge";
  if (ua.includes("chrome/")) return "Chrome";
  if (ua.includes("safari/") && !ua.includes("chrome/")) return "Safari";
  if (ua.includes("firefox/")) return "Firefox";
  return "Browser";
}

export function buildCurrentSuperAdminDeviceLabel() {
  if (typeof window === "undefined") return "当前设备";
  const userAgentData = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = String(userAgentData.userAgentData?.platform ?? navigator.platform ?? "Unknown").trim() || "Unknown";
  const browser = readBrowserName(String(navigator.userAgent ?? ""));
  return `${platform} / ${browser}`;
}
