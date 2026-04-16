"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/components/I18nProvider";

const FAOLLA_SERVICE_WORKER_PATH = "/faolla-sw.js";
const PWA_UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
const PWA_INSTALL_DISMISS_STORAGE_KEY = "merchant-space:pwa-install-dismissed:v1";
const PWA_INSTALL_COMPLETED_STORAGE_KEY = "merchant-space:pwa-install-completed:v1";
const PWA_INSTALL_DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type PwaCopy = {
  offlineTitle: string;
  offlineBody: string;
  offlineAction: string;
  updateTitle: string;
  updateBody: string;
  updateAction: string;
  dismissAction: string;
  installTitle: string;
  installBody: string;
  installAction: string;
  iosInstallBody: string;
  iosInstallAction: string;
};

function resolvePwaCopy(locale: string): PwaCopy {
  const normalized = (locale || "").trim().toLowerCase();
  const language = normalized.split("-")[0] || "en";
  if (language === "zh") {
    return {
      offlineTitle: "当前离线",
      offlineBody: "网络恢复前可继续使用已缓存页面，恢复后再同步最新内容。",
      offlineAction: "刷新重试",
      updateTitle: "发现新版本",
      updateBody: "立即更新后会刷新页面，并切换到最新版本。",
      updateAction: "立即更新",
      dismissAction: "稍后",
      installTitle: "添加到主屏幕",
      installBody: "安装后可像 App 一样从桌面打开，并保留更新与离线能力。",
      installAction: "立即安装",
      iosInstallBody: "在 Safari 点分享，再选“添加到主屏幕”，就能像 App 一样打开。",
      iosInstallAction: "知道了",
    };
  }
  if (language === "es") {
    return {
      offlineTitle: "Sin conexión",
      offlineBody: "Puedes seguir usando las páginas ya guardadas y sincronizar después cuando vuelva la red.",
      offlineAction: "Reintentar",
      updateTitle: "Nueva versión disponible",
      updateBody: "Actualiza ahora para recargar la página con la versión más reciente.",
      updateAction: "Actualizar",
      dismissAction: "Luego",
      installTitle: "Instalar como app",
      installBody: "Instala esta web para abrirla desde el inicio con una experiencia más parecida a una app.",
      installAction: "Instalar",
      iosInstallBody: "En Safari, toca Compartir y luego \"Añadir a pantalla de inicio\" para usarla como app.",
      iosInstallAction: "Entendido",
    };
  }
  return {
    offlineTitle: "Offline",
    offlineBody: "You can keep using cached pages now and sync the latest content once the connection returns.",
    offlineAction: "Retry",
    updateTitle: "New version available",
    updateBody: "Update now to reload the page with the latest version.",
    updateAction: "Update now",
    dismissAction: "Later",
    installTitle: "Install as app",
    installBody: "Install this site to open it from your home screen with a more app-like experience.",
    installAction: "Install",
    iosInstallBody: "In Safari, tap Share and choose Add to Home Screen to use it like an app.",
    iosInstallAction: "Got it",
  };
}

function isStandaloneDisplayMode() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true;
}

function isMobileSafariBrowser() {
  if (typeof navigator === "undefined") return false;
  const userAgent = navigator.userAgent || "";
  const isAppleMobile = /iPhone|iPad|iPod/i.test(userAgent);
  if (!isAppleMobile) return false;
  return /Safari/i.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/i.test(userAgent);
}

function hasRecentInstallDismissal() {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(PWA_INSTALL_DISMISS_STORAGE_KEY) || "";
    const dismissedAt = Number(raw || 0);
    return Number.isFinite(dismissedAt) && dismissedAt > 0 && Date.now() - dismissedAt < PWA_INSTALL_DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

function writeInstallDismissal() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PWA_INSTALL_DISMISS_STORAGE_KEY, String(Date.now()));
  } catch {
    // Ignore storage failures.
  }
}

function markInstallCompleted() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PWA_INSTALL_COMPLETED_STORAGE_KEY, "1");
    window.localStorage.removeItem(PWA_INSTALL_DISMISS_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function hasCompletedInstall() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PWA_INSTALL_COMPLETED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export default function PwaBootstrap() {
  const pathname = usePathname();
  const { locale } = useI18n();
  const copy = useMemo(() => resolvePwaCopy(locale), [locale]);
  const [isOffline, setIsOffline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine === false : false,
  );
  const [updateReady, setUpdateReady] = useState(false);
  const [isApplyingUpdate, setIsApplyingUpdate] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(max-width: 767px)").matches
      : false,
  );
  const [installPromptReady, setInstallPromptReady] = useState(false);
  const [showIosInstallGuide, setShowIosInstallGuide] = useState(false);
  const waitingWorkerRef = useRef<ServiceWorker | null>(null);
  const deferredInstallPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const reloadTriggeredRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncOnlineState = () => setIsOffline(navigator.onLine === false);
    syncOnlineState();
    window.addEventListener("online", syncOnlineState);
    window.addEventListener("offline", syncOnlineState);
    return () => {
      window.removeEventListener("online", syncOnlineState);
      window.removeEventListener("offline", syncOnlineState);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const handleChange = () => setIsMobileViewport(mediaQuery.matches);
    handleChange();
    mediaQuery.addEventListener("change", handleChange);
    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncInstallVisibility = () => {
      if (isStandaloneDisplayMode()) {
        markInstallCompleted();
        setInstallPromptReady(false);
        setShowIosInstallGuide(false);
        return;
      }

      const dismissedRecently = hasRecentInstallDismissal();
      const alreadyInstalled = hasCompletedInstall();
      if (dismissedRecently || alreadyInstalled) {
        setInstallPromptReady(false);
        setShowIosInstallGuide(false);
        return;
      }

      setShowIosInstallGuide(isMobileSafariBrowser());
    };

    const visibilityFrame = window.requestAnimationFrame(syncInstallVisibility);

    const handleBeforeInstallPrompt = (event: Event) => {
      const promptEvent = event as BeforeInstallPromptEvent;
      promptEvent.preventDefault();
      deferredInstallPromptRef.current = promptEvent;
      if (!hasRecentInstallDismissal() && !hasCompletedInstall()) {
        setInstallPromptReady(true);
      }
    };

    const handleAppInstalled = () => {
      deferredInstallPromptRef.current = null;
      setInstallPromptReady(false);
      setShowIosInstallGuide(false);
      markInstallCompleted();
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt as EventListener);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.cancelAnimationFrame(visibilityFrame);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt as EventListener);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, [pathname]);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    let cancelled = false;
    let updateTimer: number | null = null;

    const markWaitingWorker = (worker: ServiceWorker | null) => {
      waitingWorkerRef.current = worker;
      setUpdateReady(Boolean(worker));
    };

    const bindRegistration = (registration: ServiceWorkerRegistration) => {
      if (registration.waiting) {
        markWaitingWorker(registration.waiting);
      }

      const trackInstallingWorker = (worker: ServiceWorker | null) => {
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            markWaitingWorker(registration.waiting ?? worker);
          }
        });
      };

      trackInstallingWorker(registration.installing);
      registration.addEventListener("updatefound", () => {
        trackInstallingWorker(registration.installing);
      });

      updateTimer = window.setInterval(() => {
        void registration.update().catch(() => undefined);
      }, PWA_UPDATE_CHECK_INTERVAL_MS);
    };

    const handleControllerChange = () => {
      if (reloadTriggeredRef.current) return;
      reloadTriggeredRef.current = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

    void navigator.serviceWorker
      .register(FAOLLA_SERVICE_WORKER_PATH, {
        scope: "/",
        updateViaCache: "none",
      })
      .then((registration) => {
        if (cancelled) return;
        bindRegistration(registration);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      if (updateTimer) {
        window.clearInterval(updateTimer);
      }
    };
  }, []);

  const applyUpdate = () => {
    const target = waitingWorkerRef.current;
    if (!target) return;
    setIsApplyingUpdate(true);
    target.postMessage({ type: "SKIP_WAITING" });
  };

  const hideUpdatePrompt = () => {
    waitingWorkerRef.current = null;
    setUpdateReady(false);
  };

  const dismissInstallPrompt = () => {
    writeInstallDismissal();
    deferredInstallPromptRef.current = null;
    setInstallPromptReady(false);
    setShowIosInstallGuide(false);
  };

  const applyInstallPrompt = async () => {
    const target = deferredInstallPromptRef.current;
    if (!target) return;
    await target.prompt();
    const choice = await target.userChoice.catch(() => null);
    if (choice?.outcome === "accepted") {
      markInstallCompleted();
      setInstallPromptReady(false);
      setShowIosInstallGuide(false);
      return;
    }
    writeInstallDismissal();
    setInstallPromptReady(false);
  };

  const showOfflineBanner = isOffline && typeof window !== "undefined" && window.location.pathname !== "/offline";
  const showUpdatePrompt = updateReady;
  const inStandalone = typeof window !== "undefined" ? isStandaloneDisplayMode() : false;
  const isMobileAdminShell = isMobileViewport && pathname.startsWith("/admin");
  const promptBottomClassName = isMobileAdminShell
    ? "bottom-[calc(env(safe-area-inset-bottom)+6.4rem)]"
    : inStandalone
      ? "bottom-[calc(env(safe-area-inset-bottom)+1rem)]"
      : "bottom-4";
  const showInstallPrompt = !inStandalone && !showUpdatePrompt && (installPromptReady || showIosInstallGuide);

  if (!showOfflineBanner && !showUpdatePrompt && !showInstallPrompt) return null;

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 z-[2147482500] mx-auto flex max-w-xl flex-col gap-3 px-3 ${promptBottomClassName}`}
    >
      {showOfflineBanner ? (
        <div className="pointer-events-auto rounded-2xl border border-amber-300 bg-amber-50/95 px-4 py-3 text-slate-900 shadow-[0_16px_40px_rgba(15,23,42,0.18)] backdrop-blur">
          <div className="text-sm font-semibold">{copy.offlineTitle}</div>
          <div className="mt-1 text-xs leading-5 text-slate-600">{copy.offlineBody}</div>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700"
            >
              {copy.offlineAction}
            </button>
            <Link
              href="/offline"
              className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
            >
              /offline
            </Link>
          </div>
        </div>
      ) : null}

      {showUpdatePrompt ? (
        <div
          className={`pointer-events-auto rounded-[1.4rem] border border-white/12 bg-slate-950/92 px-4 py-3 text-white shadow-[0_18px_46px_rgba(2,6,23,0.34)] backdrop-blur-xl ${
            isMobileViewport ? "mx-auto w-full max-w-sm" : "ml-auto w-full max-w-md"
          }`}
        >
          <div className="flex items-start gap-3">
            <div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_0_6px_rgba(52,211,153,0.14)]" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold leading-5">{copy.updateTitle}</div>
              <div className="mt-1 text-[11px] leading-5 text-slate-300">{copy.updateBody}</div>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={applyUpdate}
              disabled={isApplyingUpdate}
              className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-slate-200 disabled:cursor-wait disabled:opacity-60"
            >
              {copy.updateAction}
            </button>
            <button
              type="button"
              onClick={hideUpdatePrompt}
              disabled={isApplyingUpdate}
              className="rounded-full border border-white/14 bg-white/6 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-white/24 hover:bg-white/10 disabled:opacity-60"
            >
              {copy.dismissAction}
            </button>
          </div>
        </div>
      ) : null}

      {showInstallPrompt ? (
        <div
          className={`pointer-events-auto rounded-[1.4rem] border border-slate-200 bg-white/95 px-4 py-3 text-slate-900 shadow-[0_18px_42px_rgba(15,23,42,0.18)] backdrop-blur ${
            isMobileViewport ? "mx-auto w-full max-w-sm" : "ml-auto w-full max-w-md"
          }`}
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-950 text-sm text-white">
              +
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold leading-5">{copy.installTitle}</div>
              <div className="mt-1 text-[11px] leading-5 text-slate-600">
                {showIosInstallGuide ? copy.iosInstallBody : copy.installBody}
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            {!showIosInstallGuide ? (
              <button
                type="button"
                onClick={() => {
                  void applyInstallPrompt();
                }}
                className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800"
              >
                {copy.installAction}
              </button>
            ) : null}
            <button
              type="button"
              onClick={dismissInstallPrompt}
              className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
            >
              {showIosInstallGuide ? copy.iosInstallAction : copy.dismissAction}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
