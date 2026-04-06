import Script from "next/script";
import "./globals.css";
import ClientDomTranslator from "@/components/ClientDomTranslator";
import GlobalLanguageSwitcher from "@/components/GlobalLanguageSwitcher";
import { I18nProvider } from "@/components/I18nProvider";
import UnhandledRejectionGuard from "@/components/UnhandledRejectionGuard";
import type { Viewport } from "next";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#081121",
  interactiveWidget: "overlays-content",
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
    const cookieValue = document.cookie
      .split(";")
      .map((item) => item.trim())
      .find((item) => item.startsWith(cookieKey + "="))
      ?.slice(cookieKey.length + 1) || "";
    const raw = (
      window.localStorage.getItem(key) ||
      cookieValue ||
      window.localStorage.getItem(geoKey) ||
      ""
    ).trim().toLowerCase();
    if (!raw) return;
    if (raw !== "zh-cn") {
      document.documentElement.setAttribute("data-i18n-pending", "1");
    }
  } catch {
    // Ignore localStorage failures.
  }
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <meta name="google" content="notranslate" />
        <meta httpEquiv="Content-Language" content="zh-CN,zh-TW,ja-JP,ko-KR,en-GB" />
        <meta name="application-name" content="Faolla.com" />
        <meta name="apple-mobile-web-app-title" content="Faolla.com" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="manifest" href="/manifest.webmanifest" />
      </head>
      <body>
        <Script id="i18n-pending" strategy="beforeInteractive">
          {I18N_PENDING_SCRIPT}
        </Script>
        <Script id="ignore-unhandled-rejection" strategy="beforeInteractive">
          {IGNORE_REJECTION_SCRIPT}
        </Script>
        <I18nProvider>
          <ClientDomTranslator />
          <UnhandledRejectionGuard />
          <GlobalLanguageSwitcher />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
