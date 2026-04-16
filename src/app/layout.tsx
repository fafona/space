import { cookies, headers } from "next/headers";
import type { Viewport } from "next";
import Script from "next/script";
import ClientDomTranslator from "@/components/ClientDomTranslator";
import GlobalLanguageSwitcher from "@/components/GlobalLanguageSwitcher";
import { I18nProvider } from "@/components/I18nProvider";
import PwaBootstrap from "@/components/PwaBootstrap";
import UnhandledRejectionGuard from "@/components/UnhandledRejectionGuard";
import "./globals.css";
import { DEFAULT_LOCALE, I18N_COOKIE_KEY, readPreferredLocaleFromAcceptLanguage, resolveSupportedLocale } from "@/lib/i18n";
import {
  RECENT_MERCHANT_LAUNCH_MAX_AGE_MS,
  RECENT_MERCHANT_LAUNCH_STORAGE_KEY,
} from "@/lib/merchantLaunchState";

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
  try {
    const raw =
      window.sessionStorage.getItem(${JSON.stringify(RECENT_MERCHANT_LAUNCH_STORAGE_KEY)}) ||
      window.localStorage.getItem(${JSON.stringify(RECENT_MERCHANT_LAUNCH_STORAGE_KEY)}) ||
      "";
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const merchantId = typeof parsed?.merchantId === "string" ? parsed.merchantId.trim() : "";
    const updatedAt = Number(parsed?.updatedAt ?? 0);
    if (!/^\\d{8}$/.test(merchantId) || !Number.isFinite(updatedAt)) return;
    if (Date.now() - updatedAt > ${RECENT_MERCHANT_LAUNCH_MAX_AGE_MS}) return;
    window.location.replace("/launch");
  } catch {
    // Ignore launch bootstrap storage failures.
  }
})();
`;

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
      </head>
      <body>
        <Script id="standalone-launch" strategy="beforeInteractive">
          {STANDALONE_LAUNCH_SCRIPT}
        </Script>
        <Script id="i18n-pending" strategy="beforeInteractive">
          {I18N_PENDING_SCRIPT}
        </Script>
        <Script id="ignore-unhandled-rejection" strategy="beforeInteractive">
          {IGNORE_REJECTION_SCRIPT}
        </Script>
        <I18nProvider initialLocale={initialLocale}>
          <ClientDomTranslator />
          <UnhandledRejectionGuard />
          <PwaBootstrap />
          <GlobalLanguageSwitcher />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
