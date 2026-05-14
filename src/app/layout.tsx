import { cookies, headers } from "next/headers";
import type { Viewport } from "next";
import Script from "next/script";
import ClientDomTranslator from "@/components/ClientDomTranslator";
import CapacitorAppBridge from "@/components/CapacitorAppBridge";
import GlobalLanguageSwitcher from "@/components/GlobalLanguageSwitcher";
import { I18nProvider } from "@/components/I18nProvider";
import MobileSwipeBack from "@/components/MobileSwipeBack";
import PwaBootstrapLoader from "@/components/PwaBootstrapLoader";
import UnhandledRejectionGuard from "@/components/UnhandledRejectionGuard";
import "./globals.css";
import { resolveFaollaWebBuildId } from "@/lib/faollaWebBuild";
import { DEFAULT_LOCALE, I18N_COOKIE_KEY, readPreferredLocaleFromAcceptLanguage, resolveSupportedLocale } from "@/lib/i18n";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#081121",
  interactiveWidget: "resizes-content",
};

const IGNORE_REJECTION_SCRIPT = `
(() => {
  if (typeof window === "undefined") return;
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const reasonText = typeof reason === "string" ? reason : "";
    const name = reason && typeof reason === "object" && typeof reason.name === "string" ? reason.name : "";
    const message =
      reason && typeof reason === "object" && typeof reason.message === "string"
        ? reason.message
        : reasonText;
    const isAuthError = Boolean(reason && typeof reason === "object" && reason.__isAuthError === true);
    const status = reason && typeof reason === "object" ? reason.status : undefined;
    if (
      name === "AbortError" ||
      message.includes("signal is aborted without reason") ||
      name === "AuthRetryableFetchError" ||
      status === 0 ||
      (isAuthError && (name === "AuthRetryableFetchError" || status === 0))
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
})();
`;

const I18N_PENDING_SCRIPT = `
(() => {
  if (typeof window === "undefined") return;
  try {
    const key = "merchant-space:locale:v1";
    const cookieKey = "merchant-space-locale-v1";
    const geoKey = "merchant-space:locale:geo:v1";
    const urlLocaleKey = "uiLocale";
    const requestedRaw = (new URLSearchParams(window.location.search).get(urlLocaleKey) || "").trim();
    if (requestedRaw) {
      window.localStorage.setItem(key, requestedRaw);
    }
    const cookieValue = document.cookie
      .split(";")
      .map((item) => item.trim())
      .find((item) => item.startsWith(cookieKey + "="))
      ?.slice(cookieKey.length + 1) || "";
    const raw = (
      requestedRaw ||
      window.localStorage.getItem(key) ||
      cookieValue ||
      window.localStorage.getItem(geoKey) ||
      ""
    ).trim().toLowerCase();
    const current = (
      document.documentElement.getAttribute("data-ui-locale") ||
      document.documentElement.lang ||
      ""
    ).trim().toLowerCase();
    if (!raw) return;
    const rawLanguage = raw.split("-")[0] || "";
    const currentLanguage = current.split("-")[0] || "";
    const sameResolvedLocale = Boolean(current) && raw === current;
    const sameNonChineseLanguage = Boolean(currentLanguage) && rawLanguage === currentLanguage && rawLanguage !== "zh";
    if (raw !== "zh-cn" && !sameResolvedLocale && !sameNonChineseLanguage) {
      document.documentElement.setAttribute("data-i18n-pending", "1");
    }
  } catch {
    // Ignore localStorage failures.
  }
})();
`;

const STANDALONE_LAUNCH_SCRIPT = `
(() => {
  if (typeof window === "undefined" || typeof navigator === "undefined") return;
  const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches || navigator.standalone === true;
  if (!standalone) return;
  try {
    const currentParams = new URLSearchParams(window.location.search || "");
    if ((currentParams.get("appShell") || "").trim().toLowerCase() === "faolla") {
      return;
    }
  } catch {
    // Ignore search param parsing failures and continue normal launch bootstrap.
  }
  if ((window.location.pathname || "/") !== "/") return;
  window.location.replace("/launch?appShell=faolla");
})();
`;

const FAOLLA_APP_SHELL_PREPAINT_SCRIPT = `
(() => {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  try {
    const params = new URLSearchParams(window.location.search || "");
    const isExplicitAppShell = (params.get("appShell") || "").trim().toLowerCase() === "faolla";
    const isStandalone =
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      navigator.standalone === true;
    const isAppShell = isExplicitAppShell || isStandalone || (params.get("nativeStart") || "").trim() === "1";
    if (!isAppShell) return;
    const pathname = window.location.pathname || "/";
    const isLaunch = pathname === "/launch";
    const isPublicShellPage =
      isExplicitAppShell &&
      !isLaunch &&
      (
        pathname === "/" ||
        pathname.indexOf("/site/") === 0 ||
        pathname.indexOf("/industry/") === 0
      );
    const launchColor = "#081121";
    const contentColor = "#f2f3f5";
    const paintReadyImmediately = isPublicShellPage;
    const isEmbedded = window.parent && window.parent !== window;
    document.documentElement.dataset.faollaAppShell = "true";
    document.documentElement.dataset.faollaLaunch = isLaunch ? "true" : "false";
    if (isEmbedded || paintReadyImmediately) {
      document.documentElement.dataset.faollaWebLaunchReady = "true";
    }
    const color = paintReadyImmediately ? contentColor : launchColor;
    document.documentElement.style.backgroundColor = color;
    const paintBody = () => {
      if (document.body) document.body.style.backgroundColor = color;
    };
    paintBody();
    document.addEventListener("DOMContentLoaded", paintBody, { once: true });
  } catch {
    // Prepaint is best-effort only.
  }
})();
`;

const FAOLLA_NATIVE_FAST_LAUNCH_SCRIPT = `
(() => {
  if (typeof window === "undefined") return;
  try {
    if ((window.location.pathname || "") !== "/launch") return;
    const params = new URLSearchParams(window.location.search || "");
    const isNativeLaunch =
      (params.get("appShell") || "").trim().toLowerCase() === "faolla" ||
      (params.get("nativeStart") || "").trim() === "1";
    if (!isNativeLaunch || params.has("nativeAuthRetry")) return;

    const storageKey = "merchant-space:recent-merchant-launch:v1";
    const recentRoutesKey = "merchant-space:pwa-recent-routes:v1";
    const maxAgeMs = 30 * 24 * 60 * 60 * 1000;
    const readRecentMerchantId = (storage) => {
      if (!storage) return "";
      const raw = storage.getItem(storageKey) || "";
      if (!raw) return "";
      const record = JSON.parse(raw);
      const merchantId = String(record && record.merchantId ? record.merchantId : "").trim();
      const updatedAt = Number(record && record.updatedAt ? record.updatedAt : 0);
      if (!/^\\d{8}$/.test(merchantId)) return "";
      if (!Number.isFinite(updatedAt) || updatedAt <= 0 || Date.now() - updatedAt > maxAgeMs) return "";
      return merchantId;
    };
    const normalizePreferredAppPath = (value) => {
      const path = String(value || "").trim();
      if (!path.startsWith("/")) return "";
      if (path === "/me" || path.indexOf("/me/") === 0) return path;
      if (/^\\/\\d{8}(?:\\/|$)/.test(path)) return path;
      return "";
    };
    const readRecentAppPath = (storage) => {
      if (!storage) return "";
      const raw = storage.getItem(recentRoutesKey) || "";
      if (!raw) return "";
      const records = JSON.parse(raw);
      if (!Array.isArray(records)) return "";
      for (const record of records) {
        const path = normalizePreferredAppPath(record && record.path);
        const updatedAt = Number(record && record.updatedAt ? record.updatedAt : 0);
        if (!path || !Number.isFinite(updatedAt) || updatedAt <= 0 || Date.now() - updatedAt > maxAgeMs) continue;
        return path;
      }
      return "";
    };

    let merchantId = "";
    let appPath = "";
    try {
      merchantId = readRecentMerchantId(window.sessionStorage);
      appPath = readRecentAppPath(window.sessionStorage);
    } catch {
      merchantId = "";
      appPath = "";
    }
    if (!merchantId || !appPath) {
      try {
        if (!merchantId) merchantId = readRecentMerchantId(window.localStorage);
        if (!appPath) appPath = readRecentAppPath(window.localStorage);
      } catch {
        merchantId = merchantId || "";
        appPath = appPath || "";
      }
    }
    const preferredPath = appPath || (merchantId ? "/" + merchantId : "");
    if (!preferredPath) return;

    const target = new URL(preferredPath, window.location.origin);
    target.searchParams.set("appShell", "faolla");
    window.location.replace(target.pathname + target.search + target.hash);
  } catch {
    // Fast launch is best-effort; the normal launch page can still recover.
  }
})();
`;

const FAOLLA_APP_SHELL_LOCATION_SCRIPT = `
(() => {
  if (typeof window === "undefined") return;
  let isAppShell = false;
  try {
    isAppShell = (new URLSearchParams(window.location.search || "").get("appShell") || "").trim().toLowerCase() === "faolla";
  } catch {
    isAppShell = false;
  }
  const syncAppShellPaint = () => {
    if (!isAppShell || typeof document === "undefined") return;
    const isLaunch = (window.location.pathname || "") === "/launch";
    const launchReady = document.documentElement.dataset.faollaWebLaunchReady === "true";
    const color = launchReady && !isLaunch ? "#f2f3f5" : "#081121";
    document.documentElement.dataset.faollaAppShell = "true";
    document.documentElement.dataset.faollaLaunch = isLaunch ? "true" : "false";
    document.documentElement.style.backgroundColor = color;
    if (document.body) {
      document.body.style.backgroundColor = color;
    }
  };

  syncAppShellPaint();
  if (!isAppShell || !window.parent || window.parent === window) return;

  const notifyParent = () => {
    try {
      window.parent.postMessage(
        {
          type: "faolla:app-shell-location",
          href: window.location.href,
        },
        "*",
      );
    } catch {
      // The embedded shell location bridge is best-effort only.
    }
  };

  const wrapHistoryMethod = (name) => {
    const original = window.history && window.history[name];
    if (typeof original !== "function") return;
    window.history[name] = function (...args) {
      const result = original.apply(this, args);
      window.setTimeout(syncAppShellPaint, 0);
      window.setTimeout(notifyParent, 0);
      return result;
    };
  };

  wrapHistoryMethod("pushState");
  wrapHistoryMethod("replaceState");
  window.addEventListener("popstate", syncAppShellPaint);
  window.addEventListener("hashchange", syncAppShellPaint);
  window.addEventListener("pageshow", syncAppShellPaint);
  window.addEventListener("popstate", notifyParent);
  window.addEventListener("hashchange", notifyParent);
  window.addEventListener("pageshow", notifyParent);
  window.setTimeout(notifyParent, 0);
})();
`;

const FAOLLA_MOBILE_SHELL_INLINE_STYLE = `
@media (display-mode: standalone) {
  html:not([data-faolla-web-launch-ready="true"]),
  html:not([data-faolla-web-launch-ready="true"]) body {
    background: #081121 !important;
  }
}
html[data-faolla-app-shell="true"][data-faolla-launch="true"],
html[data-faolla-app-shell="true"][data-faolla-launch="true"] body {
  background: #081121 !important;
}
html[data-faolla-app-shell="true"][data-faolla-web-launch-ready="true"][data-faolla-launch="false"],
html[data-faolla-app-shell="true"][data-faolla-web-launch-ready="true"][data-faolla-launch="false"] body {
  background: #f2f3f5 !important;
}
html[data-faolla-app-shell="true"]:not([data-faolla-web-launch-ready="true"]),
html[data-faolla-app-shell="true"]:not([data-faolla-web-launch-ready="true"]) body {
  background: #081121 !important;
}
#faolla-app-web-launch-cover {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: none;
  place-items: center;
  pointer-events: none;
  background:
    radial-gradient(circle at 50% 38%, rgba(40, 123, 173, 0.42), rgba(8, 17, 33, 0) 21rem),
    linear-gradient(180deg, #081121 0%, #0d1b2d 56%, #081121 100%);
  background-color: #081121;
  opacity: 1;
  visibility: visible;
  transition:
    opacity 180ms ease,
    visibility 180ms ease;
}
#faolla-app-web-launch-cover .faolla-launch-cover-stack {
  display: flex;
  align-items: center;
  flex-direction: column;
  justify-content: center;
  transform: translateY(-4vh);
}
.faolla-launch-solar-loader {
  position: relative;
  width: 6.8rem;
  height: 6.8rem;
  border-radius: 9999px;
  display: grid;
  place-items: center;
  background: radial-gradient(circle, rgba(125, 211, 252, 0.12) 0%, rgba(14, 165, 233, 0.06) 58%, transparent 72%);
  filter: drop-shadow(0 1rem 2.4rem rgba(14, 165, 233, 0.18));
}
.faolla-launch-solar-loader::before {
  content: "";
  position: absolute;
  inset: 0.18rem;
  border-radius: inherit;
  background:
    conic-gradient(
      from -90deg,
      transparent 0deg,
      rgba(147, 197, 253, 0.1) 42deg,
      rgba(125, 211, 252, 0.7) 96deg,
      rgba(219, 234, 254, 0.98) 132deg,
      rgba(56, 189, 248, 0.48) 165deg,
      transparent 220deg,
      transparent 360deg
    );
  -webkit-mask: radial-gradient(circle, transparent 0 50%, #000 51% 65%, transparent 66%);
  mask: radial-gradient(circle, transparent 0 50%, #000 51% 65%, transparent 66%);
  animation: faolla-launch-solar-spin 1.8s linear infinite;
}
.faolla-launch-solar-loader::after {
  content: "";
  display: none;
}
.faolla-launch-solar-loader .faolla-launch-logo-mark {
  position: relative;
  z-index: 1;
  display: block;
  width: 3.46rem;
  height: 3.4rem;
  background-image: url("/faolla-logo-f.png?v=20260508b");
  background-position: center;
  background-repeat: no-repeat;
  background-size: contain;
  filter:
    drop-shadow(0 0 1.1rem rgba(125, 211, 252, 0.32))
    drop-shadow(0 0.65rem 1.1rem rgba(14, 165, 233, 0.18));
  transform: translate(0.08rem, 0.1rem);
}
.faolla-launch-cover-title {
  margin-top: 1.75rem;
  color: #f8fafc;
  font-size: 1.8rem;
  line-height: 2rem;
  font-weight: 900;
  text-align: center;
  letter-spacing: 0;
}
@keyframes faolla-launch-solar-spin {
  to {
    transform: rotate(360deg);
  }
}
html[data-faolla-app-shell="true"]:not([data-faolla-web-launch-ready="true"])::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: 2147482999;
  pointer-events: none;
  background:
    radial-gradient(circle at 50% 38%, rgba(42, 74, 118, 0.7), rgba(8, 17, 33, 0) 21rem),
    linear-gradient(180deg, #081121 0%, #0d1b2d 56%, #081121 100%);
  opacity: 1;
  visibility: visible;
  transition:
    opacity 180ms ease,
    visibility 180ms ease;
}
html[data-faolla-app-shell="true"][data-faolla-web-launch-ready="true"]::before {
  opacity: 0;
  visibility: hidden;
}
html[data-faolla-app-shell="true"] #faolla-app-web-launch-cover {
  display: grid;
}
html[data-faolla-web-launch-ready="true"] #faolla-app-web-launch-cover {
  opacity: 0;
  visibility: hidden;
}
@media (max-width: 767px), (pointer: coarse) and (max-width: 1024px) {
  .faolla-personal-mobile-shell,
  .support-mobile-shell {
    background: #f2f3f5 !important;
  }
  .faolla-personal-mobile-shell,
  .support-mobile-shell,
  .faolla-personal-mobile-shell .faolla-mobile-self-header,
  .support-mobile-shell .faolla-mobile-self-header,
  .faolla-personal-mobile-shell .faolla-mobile-self-scroll,
  .support-mobile-shell .faolla-mobile-self-scroll {
    background: #f2f3f5 !important;
  }
  .faolla-mobile-list-header {
    border-bottom: 0 !important;
    background: #f2f3f5 !important;
    box-shadow: none !important;
    padding: calc(var(--faolla-mobile-safe-top, env(safe-area-inset-top, 0px)) + 0.5rem) 0.85rem 0.48rem !important;
  }
  .faolla-mobile-list-title {
    font-size: 1.06rem !important;
    line-height: 1.28rem !important;
    font-weight: 700 !important;
  }
  .faolla-mobile-list-summary {
    margin-top: 0.12rem !important;
    font-size: 0.72rem !important;
    line-height: 0.92rem !important;
  }
  .faolla-mobile-list-badge {
    width: 2.2rem !important;
    height: 2.2rem !important;
    border-radius: 0.7rem !important;
    font-size: 0.7rem !important;
  }
  .faolla-mobile-search-row {
    margin-top: 0.5rem !important;
    gap: 0.5rem !important;
  }
  .faolla-mobile-search-box {
    min-height: 2.125rem !important;
    height: 2.125rem !important;
    border-color: transparent !important;
    border-radius: 1.0625rem !important;
    background: #ffffff !important;
    padding: 0.28rem 0.68rem !important;
    box-shadow: none !important;
  }
  .faolla-mobile-search-box input {
    min-height: 1.2rem !important;
    padding: 0 !important;
    font-size: 0.82rem !important;
    line-height: 1rem !important;
  }
  .faolla-mobile-search-button {
    height: 2.125rem !important;
    min-height: 2.125rem !important;
    border-color: transparent !important;
    border-radius: 1.0625rem !important;
    padding: 0 0.68rem !important;
    background: #ffffff !important;
    font-size: 0.78rem !important;
    box-shadow: none !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-language-button,
  .support-mobile-shell .faolla-mobile-language-button {
    width: 2.2rem !important;
    height: 1.5rem !important;
    min-height: 1.5rem !important;
    border-radius: 0.1875rem !important;
    padding: 0 !important;
  }
  .faolla-mobile-chat-list {
    background: #f2f3f5 !important;
    padding: 0 0.85rem calc(var(--faolla-mobile-safe-bottom, env(safe-area-inset-bottom, 0px)) + 3.9rem) !important;
  }
  .faolla-mobile-chat-list > div {
    gap: 0 !important;
  }
  .faolla-mobile-chat-row {
    min-height: 4rem !important;
    border: 0 !important;
    border-bottom: 1px solid rgba(148, 163, 184, 0.2) !important;
    border-radius: 0 !important;
    background: transparent !important;
    box-shadow: none !important;
    padding: 0.46rem 0.08rem !important;
  }
  .faolla-mobile-chat-row:active {
    background: rgba(15, 23, 42, 0.04) !important;
  }
  .faolla-mobile-chat-row .faolla-mobile-chat-avatar {
    width: 3rem !important;
    height: 3rem !important;
    border-radius: 9999px !important;
    box-shadow: none !important;
  }
  .faolla-mobile-chat-avatar,
  .faolla-mobile-thread-avatar,
  .faolla-mobile-self-avatar,
  .faolla-support-avatar,
  .faolla-support-avatar *,
  .faolla-support-avatar > div,
  .faolla-support-avatar img {
    border-radius: 9999px !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-thread-avatar-button,
  .support-mobile-shell .faolla-mobile-thread-avatar-button,
  .faolla-personal-mobile-shell .faolla-mobile-thread-avatar,
  .support-mobile-shell .faolla-mobile-thread-avatar {
    width: 2.75rem !important;
    min-width: 2.75rem !important;
    max-width: 2.75rem !important;
    height: 2.75rem !important;
    min-height: 2.75rem !important;
    max-height: 2.75rem !important;
    aspect-ratio: 1 / 1 !important;
    border-radius: 9999px !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-thread-avatar-button .faolla-support-avatar,
  .support-mobile-shell .faolla-mobile-thread-avatar-button .faolla-support-avatar {
    width: 100% !important;
    height: 100% !important;
    aspect-ratio: 1 / 1 !important;
  }
  .faolla-mobile-chat-row .faolla-mobile-chat-name {
    font-size: 0.96rem !important;
    line-height: 1.16rem !important;
    font-weight: 650 !important;
  }
  .faolla-mobile-chat-row .faolla-mobile-chat-preview {
    margin-top: 0.2rem !important;
    font-size: 0.8rem !important;
    line-height: 1rem !important;
  }
  .faolla-mobile-chat-row .faolla-mobile-chat-time {
    font-size: 0.68rem !important;
    line-height: 0.86rem !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-self-header,
  .support-mobile-shell .faolla-mobile-self-header {
    border-bottom: 0 !important;
    box-shadow: none !important;
    padding: calc(var(--faolla-mobile-safe-top, env(safe-area-inset-top, 0px)) + 0.5rem) 0.85rem 0.75rem !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-self-profile-hero,
  .support-mobile-shell .faolla-mobile-self-profile-hero {
    padding-top: 0.05rem !important;
    padding-left: 0 !important;
    padding-right: 0 !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-self-scroll,
  .support-mobile-shell .faolla-mobile-self-scroll {
    padding-left: 0.85rem !important;
    padding-right: 0.85rem !important;
    padding-top: 0.55rem !important;
    padding-bottom: calc(var(--faolla-mobile-safe-bottom, env(safe-area-inset-bottom, 0px)) + 4rem) !important;
  }
  .support-mobile-nav-shell {
    max-width: min(430px, 100vw) !important;
  }
  .support-mobile-nav-shell > div {
    padding: 0.12rem 0.55rem calc(var(--faolla-mobile-safe-bottom, env(safe-area-inset-bottom, 0px)) + 0.12rem) !important;
  }
  .support-mobile-nav-shell > div > div {
    min-height: 3.28rem !important;
    border-radius: 1.38rem !important;
    gap: 0 !important;
    padding: 0.18rem !important;
    box-shadow: 0 3px 12px rgba(15, 23, 42, 0.07) !important;
  }
  .support-mobile-nav-shell button {
    min-height: 2.75rem !important;
    border-radius: 1.1rem !important;
    gap: 0.02rem !important;
    padding: 0.24rem 0.16rem !important;
    font-size: 0.66rem !important;
    line-height: 0.82rem !important;
  }
  .support-mobile-nav-shell button.bg-slate-900,
  .support-mobile-nav-shell button.bg-slate-950 {
    background: #eef2f7 !important;
    color: #0f172a !important;
    box-shadow: none !important;
  }
  .support-mobile-nav-shell button.faolla-mobile-nav-tab-active {
    background: #e2e8f0 !important;
    color: #020617 !important;
    font-weight: 700 !important;
    box-shadow:
      inset 0 0 0 1px rgba(15, 23, 42, 0.1),
      0 8px 18px rgba(15, 23, 42, 0.12) !important;
  }
  .support-mobile-nav-shell svg {
    width: 1.25rem !important;
    height: 1.25rem !important;
  }
  @supports (-webkit-touch-callout: none) {
    html:not([data-capacitor-platform="android"]) .support-mobile-nav-shell {
      max-width: min(430px, calc(100vw - 32px)) !important;
    }
    html:not([data-capacitor-platform="android"]) .support-mobile-nav-shell > div {
      padding-left: 0 !important;
      padding-right: 0 !important;
      padding-bottom: max(
        0.62rem,
        calc(var(--faolla-mobile-safe-bottom, env(safe-area-inset-bottom, 0px)) - 1.35rem)
      ) !important;
    }
  }
  .faolla-personal-mobile-shell button[aria-label="上传头像"],
  .support-mobile-shell button[aria-label="上传头像"],
  .faolla-personal-mobile-shell .faolla-mobile-self-avatar,
  .support-mobile-shell .faolla-mobile-self-avatar {
    width: 6.1rem !important;
    min-width: 6.1rem !important;
    max-width: 6.1rem !important;
    height: 6.1rem !important;
    min-height: 6.1rem !important;
    max-height: 6.1rem !important;
    aspect-ratio: 1 / 1 !important;
    border-radius: 9999px !important;
    overflow: hidden !important;
    box-shadow: 0 12px 28px rgba(15, 23, 42, 0.12) !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-self-avatar .faolla-support-avatar,
  .support-mobile-shell .faolla-mobile-self-avatar .faolla-support-avatar,
  .faolla-personal-mobile-shell .faolla-mobile-self-avatar .faolla-support-avatar > div,
  .support-mobile-shell .faolla-mobile-self-avatar .faolla-support-avatar > div {
    width: 100% !important;
    height: 100% !important;
    aspect-ratio: 1 / 1 !important;
    border-radius: 9999px !important;
    overflow: hidden !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-self-avatar img,
  .support-mobile-shell .faolla-mobile-self-avatar img {
    width: 100% !important;
    height: 100% !important;
    aspect-ratio: 1 / 1 !important;
    object-fit: cover !important;
    border-radius: 9999px !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-self-name,
  .support-mobile-shell .faolla-mobile-self-name {
    margin-top: 0.72rem !important;
    font-size: 1.55rem !important;
    line-height: 1.78rem !important;
    font-weight: 600 !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-self-subtitle,
  .support-mobile-shell .faolla-mobile-self-subtitle {
    margin-top: 0.38rem !important;
    font-size: 0.8rem !important;
    line-height: 1.05rem !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-card-stack,
  .support-mobile-shell .faolla-mobile-card-stack {
    gap: 0.72rem !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-menu-card,
  .support-mobile-shell .faolla-mobile-menu-card {
    border: 0 !important;
    border-radius: 1.1rem !important;
    background: #ffffff !important;
    box-shadow: 0 10px 28px rgba(15, 23, 42, 0.07) !important;
  }
  .faolla-personal-mobile-shell .divide-y > button,
  .support-mobile-shell .divide-y > button,
  .faolla-personal-mobile-shell .faolla-mobile-menu-row,
  .support-mobile-shell .faolla-mobile-menu-row {
    min-height: 3.5rem !important;
    padding: 0.58rem 0.82rem !important;
    gap: 0.7rem !important;
  }
  .faolla-personal-mobile-shell .divide-y > button > span:first-of-type,
  .support-mobile-shell .divide-y > button > span:first-of-type,
  .faolla-personal-mobile-shell .faolla-mobile-menu-icon,
  .support-mobile-shell .faolla-mobile-menu-icon {
    width: 2.1rem !important;
    height: 2.1rem !important;
    border-radius: 0.75rem !important;
  }
  .faolla-personal-mobile-shell .divide-y > button svg,
  .support-mobile-shell .divide-y > button svg,
  .faolla-personal-mobile-shell .faolla-mobile-menu-icon svg,
  .support-mobile-shell .faolla-mobile-menu-icon svg {
    width: 1.25rem !important;
    height: 1.25rem !important;
  }
  .faolla-personal-mobile-shell .divide-y > button .text-sm,
  .support-mobile-shell .divide-y > button .text-sm,
  .faolla-personal-mobile-shell .faolla-mobile-menu-title,
  .support-mobile-shell .faolla-mobile-menu-title {
    font-size: 0.92rem !important;
    line-height: 1.12rem !important;
    font-weight: 600 !important;
  }
  .faolla-personal-mobile-shell .divide-y > button .text-xs,
  .support-mobile-shell .divide-y > button .text-xs,
  .faolla-personal-mobile-shell .faolla-mobile-menu-summary,
  .support-mobile-shell .faolla-mobile-menu-summary {
    font-size: 0.7rem !important;
    line-height: 0.9rem !important;
  }
  .faolla-personal-mobile-shell [class*="rounded-[28px]"],
  .faolla-personal-mobile-shell [class*="rounded-[30px]"],
  .support-mobile-shell [class*="rounded-[28px]"],
  .support-mobile-shell [class*="rounded-[30px]"] {
    border-radius: 1.1rem !important;
  }
  .faolla-personal-mobile-shell .rounded-2xl,
  .support-mobile-shell .rounded-2xl {
    border-radius: 0.9rem !important;
  }
  .faolla-personal-mobile-shell button:not([aria-label="上传头像"]),
  .support-mobile-shell button:not([aria-label="上传头像"]) {
    min-height: 2.25rem;
  }
  .faolla-personal-mobile-shell button.h-12,
  .support-mobile-shell button.h-12,
  .faolla-personal-mobile-shell .h-12[role="button"],
  .support-mobile-shell .h-12[role="button"] {
    height: 2.5rem !important;
    min-height: 2.5rem !important;
  }
  .faolla-personal-mobile-shell button.h-11,
  .support-mobile-shell button.h-11 {
    height: 2.35rem !important;
    min-height: 2.35rem !important;
  }
  .faolla-personal-mobile-shell button.h-10,
  .support-mobile-shell button.h-10 {
    height: 2.25rem !important;
    min-height: 2.25rem !important;
  }
  .faolla-personal-mobile-shell button.px-4,
  .support-mobile-shell button.px-4,
  .faolla-personal-mobile-shell button.px-5,
  .support-mobile-shell button.px-5 {
    padding-left: 0.85rem !important;
    padding-right: 0.85rem !important;
  }
  .faolla-personal-mobile-shell .faolla-message-bubble,
  .support-mobile-shell .faolla-message-bubble {
    border-radius: 1rem !important;
    box-shadow: none !important;
    font-size: 0.94rem !important;
    line-height: 1.35 !important;
    max-width: 100% !important;
  }
  .faolla-personal-mobile-shell .faolla-message-bubble .faolla-support-message-text,
  .support-mobile-shell .faolla-message-bubble .faolla-support-message-text {
    font-size: 0.94rem !important;
    line-height: 1.35 !important;
  }
  .faolla-personal-mobile-shell .faolla-message-time,
  .support-mobile-shell .faolla-message-time {
    float: right !important;
    margin-left: 0.5rem !important;
    margin-top: 0.32rem !important;
    font-size: 0.68rem !important;
    line-height: 0.85rem !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-composer,
  .support-mobile-shell .faolla-mobile-composer {
    background: #f0f2f5 !important;
    padding-left: 0.5rem !important;
    padding-right: 0.5rem !important;
    padding-top: 0.25rem !important;
    box-shadow: none !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-input-shell,
  .support-mobile-shell .faolla-mobile-input-shell {
    min-height: 2.35rem !important;
    height: 2.35rem !important;
    align-items: center !important;
    border-radius: 1.2rem !important;
    padding: 0.42rem 0.75rem !important;
    box-shadow: none !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-input-shell textarea,
  .support-mobile-shell .faolla-mobile-input-shell textarea {
    min-height: 1.35rem !important;
    font-size: 1rem !important;
    line-height: 1.35rem !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-composer-icon,
  .faolla-personal-mobile-shell .faolla-mobile-composer-send,
  .support-mobile-shell .faolla-mobile-composer-icon,
  .support-mobile-shell .faolla-mobile-composer-send {
    width: 2.35rem !important;
    height: 2.35rem !important;
    min-height: 2.35rem !important;
    box-shadow: none !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-attachment-menu,
  .support-mobile-shell .faolla-mobile-attachment-menu {
    border-radius: 1rem !important;
    padding: 0.55rem !important;
    box-shadow: none !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-attachment-button,
  .support-mobile-shell .faolla-mobile-attachment-button {
    min-height: 3.25rem !important;
    padding: 0.25rem !important;
    font-size: 0.63rem !important;
  }
  .faolla-personal-mobile-shell article,
  .support-mobile-shell article {
    border-radius: 1rem !important;
    padding: 0.75rem !important;
    box-shadow: none !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-record-card,
  .support-mobile-shell .faolla-mobile-record-card {
    border-radius: 1rem !important;
    padding: 0.75rem !important;
    box-shadow: none !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-record-search,
  .support-mobile-shell .faolla-mobile-record-search,
  .faolla-personal-mobile-shell input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]),
  .support-mobile-shell input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]),
  .faolla-personal-mobile-shell select,
  .support-mobile-shell select,
  .faolla-personal-mobile-shell textarea,
  .support-mobile-shell textarea {
    border-radius: 1rem !important;
    font-size: 0.9rem !important;
    min-height: 2.15rem !important;
    padding: 0.34rem 0.68rem !important;
    box-shadow: none !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-record-search,
  .support-mobile-shell .faolla-mobile-record-search {
    min-height: 2.125rem !important;
    padding: 0.3rem 0.68rem !important;
    font-size: 0.82rem !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-search-box input,
  .support-mobile-shell .faolla-mobile-search-box input {
    min-height: 1.2rem !important;
    padding: 0 !important;
    border-radius: 0 !important;
    background: transparent !important;
    font-size: 0.82rem !important;
    line-height: 1rem !important;
  }
  .support-mobile-shell .faolla-mobile-filter-select,
  .faolla-personal-mobile-shell .faolla-mobile-filter-select {
    min-height: 2rem !important;
    border-radius: 1rem !important;
    padding: 0.28rem 2.15rem 0.28rem 1.1rem !important;
    box-shadow: none !important;
  }
  .support-mobile-shell .faolla-mobile-filter-select select,
  .faolla-personal-mobile-shell .faolla-mobile-filter-select select {
    min-height: 1.2rem !important;
    padding: 0 0.55rem 0 0.15rem !important;
    font-size: 0.78rem !important;
    line-height: 1rem !important;
  }
  .support-mobile-shell .faolla-mobile-status-dropdown {
    min-height: 1.875rem !important;
    height: 1.875rem !important;
    border-radius: 0.9375rem !important;
    box-shadow: none !important;
  }
  .support-mobile-shell .faolla-mobile-status-dropdown-button,
  .support-mobile-shell .faolla-mobile-status-dropdown-toggle {
    min-height: 1.875rem !important;
    height: 1.875rem !important;
    padding-top: 0 !important;
    padding-bottom: 0 !important;
    font-size: 0.72rem !important;
    line-height: 0.9rem !important;
  }
  .support-mobile-shell .faolla-mobile-status-dropdown-toggle {
    width: 1.9rem !important;
  }
  .faolla-personal-mobile-shell button.rounded-full,
  .support-mobile-shell button.rounded-full,
  .faolla-personal-mobile-shell button[class*="rounded-[14px]"],
  .support-mobile-shell button[class*="rounded-[14px]"],
  .faolla-personal-mobile-shell .faolla-mobile-record-action,
  .support-mobile-shell .faolla-mobile-record-action {
    min-height: 1.75rem !important;
    height: auto !important;
    border-radius: 0.875rem !important;
    padding: 0.22rem 0.55rem !important;
    font-size: 0.68rem !important;
    line-height: 0.9rem !important;
    box-shadow: none !important;
  }
  .faolla-personal-mobile-shell button[class*="rounded-[14px]"],
  .support-mobile-shell button[class*="rounded-[14px]"] {
    width: auto !important;
    min-width: 2.55rem !important;
  }
  .faolla-personal-mobile-shell a.rounded-full,
  .support-mobile-shell a.rounded-full {
    min-height: 1.75rem !important;
    height: auto !important;
    border-radius: 0.875rem !important;
    padding: 0.22rem 0.55rem !important;
    font-size: 0.68rem !important;
    line-height: 0.9rem !important;
    box-shadow: none !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-business-segment,
  .support-mobile-shell .faolla-mobile-business-segment {
    height: 2.125rem !important;
    min-height: 2.125rem !important;
    border-radius: 1.0625rem !important;
    padding: 0.125rem !important;
    box-shadow: none !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-business-segment-button,
  .support-mobile-shell .faolla-mobile-business-segment-button {
    height: 1.875rem !important;
    min-height: 1.875rem !important;
    border-radius: 0.9375rem !important;
    padding: 0 0.65rem !important;
    font-size: 0.75rem !important;
    line-height: 0.95rem !important;
    box-shadow: none !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-business-search,
  .support-mobile-shell .faolla-mobile-business-search {
    height: 2.125rem !important;
    min-height: 2.125rem !important;
    border-radius: 1.0625rem !important;
    padding: 0.25rem 0.65rem !important;
    box-shadow: none !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-business-menu-button,
  .support-mobile-shell .faolla-mobile-business-menu-button {
    width: 2.125rem !important;
    min-width: 2.125rem !important;
    height: 2.125rem !important;
    min-height: 2.125rem !important;
    border-radius: 1.0625rem !important;
    padding: 0 !important;
    box-shadow: none !important;
  }
  .support-mobile-shell a[href^="mailto:"],
  .support-mobile-shell a[href^="tel:"],
  .support-mobile-shell button[aria-label*="会话"],
  .support-mobile-shell button[aria-label*="邮件"],
  .support-mobile-shell button[aria-label*="电话"],
  .faolla-personal-mobile-shell a[href^="mailto:"],
  .faolla-personal-mobile-shell a[href^="tel:"],
  .faolla-personal-mobile-shell button[aria-label*="会话"],
  .faolla-personal-mobile-shell button[aria-label*="邮件"],
  .faolla-personal-mobile-shell button[aria-label*="电话"] {
    width: 2rem !important;
    min-width: 2rem !important;
    height: 2rem !important;
    min-height: 2rem !important;
    border-radius: 9999px !important;
    padding: 0 !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-composer-icon,
  .faolla-personal-mobile-shell .faolla-mobile-composer-send,
  .support-mobile-shell .faolla-mobile-composer-icon,
  .support-mobile-shell .faolla-mobile-composer-send {
    width: 2.35rem !important;
    min-width: 2.35rem !important;
    max-width: 2.35rem !important;
    height: 2.35rem !important;
    min-height: 2.35rem !important;
    max-height: 2.35rem !important;
    flex: 0 0 2.35rem !important;
    aspect-ratio: 1 / 1 !important;
    border-radius: 9999px !important;
    padding: 0 !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-search-button,
  .support-mobile-shell .faolla-mobile-search-button {
    height: 2.125rem !important;
    min-height: 2.125rem !important;
    border-radius: 1.0625rem !important;
    padding-top: 0 !important;
    padding-bottom: 0 !important;
  }
  .faolla-mobile-chat-avatar img,
  .faolla-mobile-self-avatar img,
  .faolla-support-avatar img {
    border-radius: 9999px !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-input-shell textarea,
  .support-mobile-shell .faolla-mobile-input-shell textarea {
    min-height: 1.35rem !important;
    padding: 0 !important;
    border-radius: 0 !important;
    background: transparent !important;
  }
  .faolla-personal-mobile-shell button.faolla-mobile-thread-avatar-button,
  .support-mobile-shell button.faolla-mobile-thread-avatar-button {
    box-sizing: border-box !important;
    width: 2.75rem !important;
    min-width: 2.75rem !important;
    max-width: 2.75rem !important;
    height: 2.75rem !important;
    min-height: 2.75rem !important;
    max-height: 2.75rem !important;
    flex: 0 0 2.75rem !important;
    aspect-ratio: 1 / 1 !important;
    padding: 0 !important;
    border-radius: 9999px !important;
    overflow: visible !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-thread-avatar,
  .support-mobile-shell .faolla-mobile-thread-avatar {
    box-sizing: border-box !important;
    width: 2.75rem !important;
    min-width: 2.75rem !important;
    max-width: 2.75rem !important;
    height: 2.75rem !important;
    min-height: 2.75rem !important;
    max-height: 2.75rem !important;
    flex: 0 0 2.75rem !important;
    aspect-ratio: 1 / 1 !important;
    padding: 0 !important;
    border-radius: 9999px !important;
    overflow: visible !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-thread-avatar > div,
  .support-mobile-shell .faolla-mobile-thread-avatar > div,
  .faolla-personal-mobile-shell .faolla-mobile-thread-avatar img,
  .support-mobile-shell .faolla-mobile-thread-avatar img {
    box-sizing: border-box !important;
    width: 100% !important;
    min-width: 100% !important;
    max-width: 100% !important;
    height: 100% !important;
    min-height: 100% !important;
    max-height: 100% !important;
    aspect-ratio: 1 / 1 !important;
    border-radius: 9999px !important;
    object-fit: cover !important;
  }
  .faolla-personal-mobile-shell button.faolla-mobile-self-avatar,
  .support-mobile-shell button.faolla-mobile-self-avatar {
    box-sizing: border-box !important;
    width: 6.125rem !important;
    min-width: 6.125rem !important;
    max-width: 6.125rem !important;
    height: 6.125rem !important;
    min-height: 6.125rem !important;
    max-height: 6.125rem !important;
    flex: 0 0 6.125rem !important;
    aspect-ratio: 1 / 1 !important;
    padding: 0 !important;
    border-radius: 9999px !important;
    overflow: visible !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-self-avatar-image,
  .support-mobile-shell .faolla-mobile-self-avatar-image,
  .faolla-personal-mobile-shell .faolla-mobile-self-avatar-image > div,
  .support-mobile-shell .faolla-mobile-self-avatar-image > div,
  .faolla-personal-mobile-shell .faolla-mobile-self-avatar-image img,
  .support-mobile-shell .faolla-mobile-self-avatar-image img {
    box-sizing: border-box !important;
    width: 6.125rem !important;
    min-width: 6.125rem !important;
    max-width: 6.125rem !important;
    height: 6.125rem !important;
    min-height: 6.125rem !important;
    max-height: 6.125rem !important;
    aspect-ratio: 1 / 1 !important;
    border-radius: 9999px !important;
    overflow: hidden !important;
    object-fit: cover !important;
  }
}
`;

const FAOLLA_MOBILE_SHELL_STYLE_SCRIPT = `
(() => {
  if (typeof document === "undefined") return;
  const css = ${JSON.stringify(FAOLLA_MOBILE_SHELL_INLINE_STYLE)};
  const styleId = "faolla-mobile-shell-size-overrides-runtime";
  let style = document.getElementById(styleId);
  if (!style) {
    style = document.createElement("style");
    style.id = styleId;
    document.head.appendChild(style);
  }
  if (style.textContent !== css) {
    style.textContent = css;
  }
})();
`;

function buildFaollaInlineCacheRefreshScript(buildId: string) {
  const serializedBuildId = JSON.stringify(buildId || "local");
  return `
(() => {
  if (typeof window === "undefined") return;
  const buildId = ${serializedBuildId};
  try {
    const startupParams = new URLSearchParams(window.location.search || "");
    const isNativeBoot = (startupParams.get("nativeStart") || "").trim() === "1" || startupParams.has("nativeBuild");
    if (isNativeBoot) return;
  } catch {
    // Native app update checks are handled after first paint by CapacitorAppBridge.
  }
  const storageKey = "faolla:inline-cache-build:v1";
  const markBuildSeen = () => {
    try {
      window.localStorage.setItem(storageKey, buildId);
    } catch {
      // Ignore storage failures.
    }
  };
  const isEmbeddedDocument = () => {
    try {
      return Boolean(window.parent && window.parent !== window);
    } catch {
      return true;
    }
  };
  if (isEmbeddedDocument()) {
    markBuildSeen();
    return;
  }
  let previous = "";
  try {
    previous = window.localStorage.getItem(storageKey) || "";
  } catch {
    previous = "";
  }

  const shouldReload = () => {
    try {
      const url = new URL(window.location.href);
      const marker = url.searchParams.get("__faollaInlineBuild") || "";
      const embedded = url.searchParams.get("appShell") === "faolla";
      const nativeRuntime =
        document.documentElement.dataset.capacitor === "true" ||
        Boolean(window.Capacitor && typeof window.Capacitor.isNativePlatform === "function" && window.Capacitor.isNativePlatform());
      return Boolean(marker) && marker !== buildId.slice(0, 12) && (embedded || nativeRuntime);
    } catch {
      return false;
    }
  };
  const reloadRequired = shouldReload();
  if (previous === buildId && !reloadRequired) return;
  if (!reloadRequired) {
    markBuildSeen();
    return;
  }

  const clearCaches = async () => {
    try {
      if ("caches" in window) {
        const keys = await window.caches.keys();
        await Promise.all(
          keys
            .filter((key) => key.indexOf("faolla-") === 0 && key !== "faolla-badge-state-v1")
            .map((key) => window.caches.delete(key)),
        );
      }
    } catch {
      // Best effort only.
    }
    try {
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(
          registrations.map(async (registration) => {
            const target = registration.active || registration.waiting || registration.installing || navigator.serviceWorker.controller;
            if (target) {
              target.postMessage({ type: "CLEAR_RUNTIME_CACHES" });
              target.postMessage({ type: "SKIP_WAITING" });
            }
            await registration.update().catch(() => undefined);
            const refreshedTarget = registration.waiting || registration.installing;
            if (refreshedTarget) {
              refreshedTarget.postMessage({ type: "CLEAR_RUNTIME_CACHES" });
              refreshedTarget.postMessage({ type: "SKIP_WAITING" });
            }
          }),
        );
      }
    } catch {
      // Best effort only.
    }
  };

  clearCaches().finally(() => {
    markBuildSeen();
    if (!reloadRequired) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("appShell", "faolla");
      url.searchParams.set("__faollaInlineBuild", buildId.slice(0, 12));
      window.location.replace(url.pathname + url.search + url.hash);
    } catch {
      window.location.reload();
    }
  });
})();
`;
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const cookieLocale = cookieStore.get(I18N_COOKIE_KEY)?.value ?? "";
  const acceptLanguageLocale = readPreferredLocaleFromAcceptLanguage(headerStore.get("accept-language"));
  const initialLocale = resolveSupportedLocale(cookieLocale || acceptLanguageLocale || DEFAULT_LOCALE);
  const faollaInlineCacheRefreshScript = buildFaollaInlineCacheRefreshScript(resolveFaollaWebBuildId());

  return (
    <html lang={initialLocale} data-ui-locale={initialLocale} suppressHydrationWarning>
      <head>
        <meta name="google" content="notranslate" />
        <meta httpEquiv="Content-Language" content="zh-CN,zh-TW,ja-JP,ko-KR,en-GB" />
        <meta name="application-name" content="Faolla.com" />
        <meta name="apple-mobile-web-app-title" content="Faolla.com" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <link rel="icon" href="/favicon.ico?v=20260409c" sizes="any" />
        <link rel="icon" href="/faolla-app-icon-192.png?v=20260409c" sizes="192x192" type="image/png" />
        <link rel="icon" href="/faolla-app-icon-512.png?v=20260409c" sizes="512x512" type="image/png" />
        <link rel="shortcut icon" href="/favicon.ico?v=20260409c" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=20260409c" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="preload" as="image" href="/faolla-logo-f.png?v=20260508b" />
        <script id="faolla-app-shell-prepaint" dangerouslySetInnerHTML={{ __html: FAOLLA_APP_SHELL_PREPAINT_SCRIPT }} />
        <style id="faolla-mobile-shell-size-overrides" dangerouslySetInnerHTML={{ __html: FAOLLA_MOBILE_SHELL_INLINE_STYLE }} />
        <script id="faolla-native-fast-launch" dangerouslySetInnerHTML={{ __html: FAOLLA_NATIVE_FAST_LAUNCH_SCRIPT }} />
      </head>
      <body>
        <div id="faolla-app-web-launch-cover" aria-hidden="true">
          <div className="faolla-launch-cover-stack">
            <div className="faolla-launch-solar-loader">
              <span className="faolla-launch-logo-mark" />
            </div>
            <div className="faolla-launch-cover-title">Faolla</div>
          </div>
        </div>
        <Script id="faolla-inline-cache-refresh" strategy="beforeInteractive">
          {faollaInlineCacheRefreshScript}
        </Script>
        <Script id="standalone-launch" strategy="beforeInteractive">
          {STANDALONE_LAUNCH_SCRIPT}
        </Script>
        <Script id="faolla-mobile-shell-style-runtime" strategy="beforeInteractive">
          {FAOLLA_MOBILE_SHELL_STYLE_SCRIPT}
        </Script>
        <Script id="faolla-app-shell-location" strategy="beforeInteractive">
          {FAOLLA_APP_SHELL_LOCATION_SCRIPT}
        </Script>
        <Script id="i18n-pending" strategy="beforeInteractive">
          {I18N_PENDING_SCRIPT}
        </Script>
        <Script id="ignore-unhandled-rejection" strategy="beforeInteractive">
          {IGNORE_REJECTION_SCRIPT}
        </Script>
        <I18nProvider initialLocale={initialLocale}>
          <ClientDomTranslator />
          <CapacitorAppBridge />
          <UnhandledRejectionGuard />
          <PwaBootstrapLoader />
          <GlobalLanguageSwitcher />
          <MobileSwipeBack />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
