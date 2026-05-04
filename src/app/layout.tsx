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
  window.location.replace("/launch");
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
      window.setTimeout(notifyParent, 0);
      return result;
    };
  };

  wrapHistoryMethod("pushState");
  wrapHistoryMethod("replaceState");
  window.addEventListener("popstate", notifyParent);
  window.addEventListener("hashchange", notifyParent);
  window.addEventListener("pageshow", notifyParent);
  window.setTimeout(notifyParent, 0);
})();
`;

const FAOLLA_MOBILE_SHELL_INLINE_STYLE = `
@media (max-width: 767px), (pointer: coarse) and (max-width: 1024px) {
  .faolla-personal-mobile-shell,
  .support-mobile-shell {
    background: #f7f8fa !important;
  }
  .support-mobile-nav-shell {
    max-width: min(430px, 100vw) !important;
  }
  .support-mobile-nav-shell > div {
    padding: 0.5rem 0.7rem calc(var(--faolla-mobile-safe-bottom, env(safe-area-inset-bottom, 0px)) + 0.45rem) !important;
  }
  .support-mobile-nav-shell > div > div {
    min-height: 4.6rem !important;
    border-radius: 2.15rem !important;
    gap: 0.2rem !important;
    padding: 0.42rem !important;
    box-shadow: 0 12px 28px rgba(15, 23, 42, 0.11) !important;
  }
  .support-mobile-nav-shell button {
    min-height: 3.65rem !important;
    border-radius: 1.65rem !important;
    gap: 0.1rem !important;
    padding: 0.45rem 0.35rem !important;
    font-size: 0.76rem !important;
    line-height: 1rem !important;
  }
  .support-mobile-nav-shell svg {
    width: 1.6rem !important;
    height: 1.6rem !important;
  }
  .faolla-personal-mobile-shell button[aria-label="上传头像"],
  .support-mobile-shell button[aria-label="上传头像"],
  .faolla-personal-mobile-shell .faolla-mobile-self-avatar,
  .support-mobile-shell .faolla-mobile-self-avatar {
    width: 7.25rem !important;
    height: 7.25rem !important;
    border-radius: 9999px !important;
    box-shadow: 0 12px 28px rgba(15, 23, 42, 0.12) !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-self-name,
  .support-mobile-shell .faolla-mobile-self-name {
    margin-top: 1.15rem !important;
    font-size: 2rem !important;
    line-height: 2.15rem !important;
    font-weight: 600 !important;
  }
  .faolla-personal-mobile-shell .faolla-mobile-self-subtitle,
  .support-mobile-shell .faolla-mobile-self-subtitle {
    margin-top: 0.55rem !important;
    font-size: 0.9rem !important;
    line-height: 1.2rem !important;
  }
  .faolla-personal-mobile-shell .divide-y > button,
  .support-mobile-shell .divide-y > button,
  .faolla-personal-mobile-shell .faolla-mobile-menu-row,
  .support-mobile-shell .faolla-mobile-menu-row {
    min-height: 4.9rem !important;
    padding: 1rem 1.25rem !important;
    gap: 1rem !important;
  }
  .faolla-personal-mobile-shell .divide-y > button > span:first-of-type,
  .support-mobile-shell .divide-y > button > span:first-of-type,
  .faolla-personal-mobile-shell .faolla-mobile-menu-icon,
  .support-mobile-shell .faolla-mobile-menu-icon {
    width: 3rem !important;
    height: 3rem !important;
    border-radius: 1.1rem !important;
  }
  .faolla-personal-mobile-shell .divide-y > button svg,
  .support-mobile-shell .divide-y > button svg,
  .faolla-personal-mobile-shell .faolla-mobile-menu-icon svg,
  .support-mobile-shell .faolla-mobile-menu-icon svg {
    width: 1.55rem !important;
    height: 1.55rem !important;
  }
  .faolla-personal-mobile-shell .divide-y > button .text-sm,
  .support-mobile-shell .divide-y > button .text-sm,
  .faolla-personal-mobile-shell .faolla-mobile-menu-title,
  .support-mobile-shell .faolla-mobile-menu-title {
    font-size: 1.06rem !important;
    line-height: 1.35rem !important;
    font-weight: 600 !important;
  }
  .faolla-personal-mobile-shell .divide-y > button .text-xs,
  .support-mobile-shell .divide-y > button .text-xs,
  .faolla-personal-mobile-shell .faolla-mobile-menu-summary,
  .support-mobile-shell .faolla-mobile-menu-summary {
    font-size: 0.82rem !important;
    line-height: 1.1rem !important;
  }
  .faolla-personal-mobile-shell [class*="rounded-[28px]"],
  .faolla-personal-mobile-shell [class*="rounded-[30px]"],
  .support-mobile-shell [class*="rounded-[28px]"],
  .support-mobile-shell [class*="rounded-[30px]"] {
    border-radius: 1.9rem !important;
  }
}
`;

function buildFaollaInlineCacheRefreshScript(buildId: string) {
  const serializedBuildId = JSON.stringify(buildId || "local");
  return `
(() => {
  if (typeof window === "undefined") return;
  const buildId = ${serializedBuildId};
  const storageKey = "faolla:inline-cache-build:v1";
  let previous = "";
  try {
    previous = window.localStorage.getItem(storageKey) || "";
  } catch {
    previous = "";
  }
  if (previous === buildId) return;

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
          }),
        );
      }
    } catch {
      // Best effort only.
    }
  };

  const shouldReload = () => {
    try {
      const url = new URL(window.location.href);
      const marker = url.searchParams.get("__faollaInlineBuild") || "";
      const embedded = url.searchParams.get("appShell") === "faolla";
      const nativeRuntime =
        document.documentElement.dataset.capacitor === "true" ||
        Boolean(window.Capacitor && typeof window.Capacitor.isNativePlatform === "function" && window.Capacitor.isNativePlatform());
      return marker !== buildId.slice(0, 12) && (embedded || nativeRuntime || url.pathname === "/launch");
    } catch {
      return false;
    }
  };

  clearCaches().finally(() => {
    try {
      window.localStorage.setItem(storageKey, buildId);
    } catch {
      // Ignore storage failures.
    }
    if (!shouldReload()) return;
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
        <style id="faolla-mobile-shell-size-overrides" dangerouslySetInnerHTML={{ __html: FAOLLA_MOBILE_SHELL_INLINE_STYLE }} />
      </head>
      <body>
        <Script id="faolla-inline-cache-refresh" strategy="beforeInteractive">
          {faollaInlineCacheRefreshScript}
        </Script>
        <Script id="standalone-launch" strategy="beforeInteractive">
          {STANDALONE_LAUNCH_SCRIPT}
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
