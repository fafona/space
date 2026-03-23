"use client";

import {
  SUPER_ADMIN_DEVICE_ID_KEY,
  SUPER_ADMIN_LOGIN_PATH,
  SUPER_ADMIN_SESSION_COOKIE,
  SUPER_ADMIN_SESSION_KEY,
  SUPER_ADMIN_SESSION_VALUE,
} from "@/lib/superAdminSession";

export {
  SUPER_ADMIN_DEVICE_ID_KEY,
  SUPER_ADMIN_LOGIN_PATH,
  SUPER_ADMIN_SESSION_COOKIE,
  SUPER_ADMIN_SESSION_KEY,
  SUPER_ADMIN_SESSION_VALUE,
};

function readSuperAdminCookie() {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .some((part) => part === `${SUPER_ADMIN_SESSION_COOKIE}=${SUPER_ADMIN_SESSION_VALUE}`);
}

function writeSuperAdminCookie(enabled: boolean) {
  if (typeof document === "undefined") return;
  const maxAge = enabled ? 60 * 60 * 12 : 0;
  document.cookie = `${SUPER_ADMIN_SESSION_COOKIE}=${enabled ? SUPER_ADMIN_SESSION_VALUE : ""}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

export function isSuperAdminAuthenticated() {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(SUPER_ADMIN_SESSION_KEY) === SUPER_ADMIN_SESSION_VALUE || readSuperAdminCookie();
}

export function syncSuperAdminAuthenticatedCookie() {
  if (typeof window === "undefined") return false;
  const hasLocalSession = localStorage.getItem(SUPER_ADMIN_SESSION_KEY) === SUPER_ADMIN_SESSION_VALUE;
  if (!hasLocalSession) return readSuperAdminCookie();
  if (!readSuperAdminCookie()) {
    writeSuperAdminCookie(true);
  }
  return true;
}

export function setSuperAdminAuthenticated() {
  if (typeof window === "undefined") return;
  localStorage.setItem(SUPER_ADMIN_SESSION_KEY, SUPER_ADMIN_SESSION_VALUE);
  writeSuperAdminCookie(true);
}

export function clearSuperAdminAuthenticated() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SUPER_ADMIN_SESSION_KEY);
  writeSuperAdminCookie(false);
}

export function buildSuperAdminLoginHref(nextPath = "/super-admin") {
  const cleanNext = nextPath.trim() || "/super-admin";
  return `${SUPER_ADMIN_LOGIN_PATH}?next=${encodeURIComponent(cleanNext)}`;
}

export function getOrCreateSuperAdminDeviceId() {
  if (typeof window === "undefined") return "";
  const existing = localStorage.getItem(SUPER_ADMIN_DEVICE_ID_KEY)?.trim() ?? "";
  if (existing) return existing;
  const nextId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `device-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(SUPER_ADMIN_DEVICE_ID_KEY, nextId);
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
