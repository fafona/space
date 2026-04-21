"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import {
  collectPwaWarmRoutes,
  persistRecentPwaRoute,
  resolvePreferredPwaLaunchPath,
  shouldAutoWarmPwaRoutes,
} from "@/lib/pwaRecentRoutes";

const FAOLLA_SERVICE_WORKER_PATH = "/faolla-sw.js";
const PWA_UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
const PWA_UPDATE_RESUME_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const PWA_INSTALL_DISMISS_STORAGE_KEY = "merchant-space:pwa-install-dismissed:v1";
const PWA_INSTALL_COMPLETED_STORAGE_KEY = "merchant-space:pwa-install-completed:v1";
const PWA_INSTALL_DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PWA_RECENT_ROUTE_WARM_SESSION_KEY = "merchant-space:pwa-recent-routes-warmed:v1";
const PWA_MOBILE_PROMPT_GAP_PX = 24;
const PWA_MOBILE_BOTTOM_NAV_FALLBACK_PX = 96;

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
  iosInstallHint: string;
  iosInstallStepShare: string;
  iosInstallStepAddToHome: string;
  iosInstallStepConfirm: string;
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
      iosInstallBody: "在 Safari 里按下面 3 步操作，就能把 Faolla 添加到主屏幕。",
      iosInstallHint: "如果 Safari 工具栏在顶部，分享按钮也会出现在顶部右侧。",
      iosInstallStepShare: "点击 Safari 的“分享”按钮",
      iosInstallStepAddToHome: "在菜单里选择“添加到主屏幕”",
      iosInstallStepConfirm: "最后点击“添加”完成安装",
      iosInstallAction: "知道了",
    };
  }

  if (language === "es") {
    return {
      offlineTitle: "Sin conexión",
      offlineBody: "Puedes seguir usando las páginas guardadas y sincronizar después cuando vuelva la red.",
      offlineAction: "Reintentar",
      updateTitle: "Nueva versión disponible",
      updateBody: "Actualiza ahora para recargar la página con la versión más reciente.",
      updateAction: "Actualizar",
      dismissAction: "Luego",
      installTitle: "Instalar como app",
      installBody: "Instala esta web para abrirla desde el inicio con una experiencia más parecida a una app.",
      installAction: "Instalar",
      iosInstallBody: "En Safari, sigue estos 3 pasos para añadir Faolla a la pantalla de inicio.",
      iosInstallHint: "Si la barra de Safari está arriba, el botón Compartir también aparecerá arriba a la derecha.",
      iosInstallStepShare: "Toca el botón Compartir de Safari",
      iosInstallStepAddToHome: 'Elige "Añadir a pantalla de inicio"',
      iosInstallStepConfirm: 'Confirma con "Añadir" para terminar',
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
    iosInstallBody: "In Safari, follow these 3 steps to add Faolla to your home screen.",
    iosInstallHint: "If Safari shows the toolbar at the top, the Share button will also appear in the top-right corner.",
    iosInstallStepShare: "Tap Safari's Share button",
    iosInstallStepAddToHome: "Choose Add to Home Screen",
    iosInstallStepConfirm: "Finish by tapping Add",
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

function shouldReserveMobileBottomNav(pathname: string | null) {
  const normalizedPath = String(pathname ?? "").trim();
  return (
    normalizedPath === "/admin" ||
    normalizedPath === "/me" ||
    normalizedPath.startsWith("/me/") ||
    /^\/\d{8}(?:\/|$)/.test(normalizedPath)
  );
}

function readMobileBottomNavOffset() {
  if (typeof window === "undefined" || typeof document === "undefined") return 0;
  const viewportHeight = Math.max(0, window.innerHeight || window.visualViewport?.height || 0);
  const shells = Array.from(document.querySelectorAll<HTMLElement>(".support-mobile-nav-shell"));
  return shells.reduce((maxOffset, shell) => {
    const style = window.getComputedStyle(shell);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return maxOffset;
    if (shell.getAttribute("aria-hidden") === "true") return maxOffset;
    const rect = shell.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return maxOffset;
    const bottomOverlap = viewportHeight > 0 ? Math.max(0, viewportHeight - rect.top) : 0;
    return Math.max(maxOffset, Math.ceil(bottomOverlap || rect.height));
  }, 0);
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
  const [mobileBottomUiHeight, setMobileBottomUiHeight] = useState(0);
  const [installPromptReady, setInstallPromptReady] = useState(false);
  const [showIosInstallGuide, setShowIosInstallGuide] = useState(false);
  const waitingWorkerRef = useRef<ServiceWorker | null>(null);
  const deferredInstallPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const reloadTriggeredRef = useRef(false);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const lastUpdateCheckAtRef = useRef(0);
  const latestPathnameRef = useRef(pathname);

  const postLaunchTargetToWorker = (registration: ServiceWorkerRegistration | null, path: string) => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return;
    if (!registration || !path) return;
    const targetWorker =
      registration.active ??
      navigator.serviceWorker.controller ??
      registration.waiting ??
      registration.installing ??
      null;
    if (!targetWorker) return;
    targetWorker.postMessage({ type: "SYNC_LAUNCH_TARGET", path });
  };

  useEffect(() => {
    persistRecentPwaRoute(pathname);
  }, [pathname]);

  useEffect(() => {
    latestPathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    const launchTarget = resolvePreferredPwaLaunchPath(pathname);
    postLaunchTargetToWorker(registrationRef.current, launchTarget);
  }, [pathname]);

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
    if (!isMobileViewport) {
      const resetFrameId = window.requestAnimationFrame(() => {
        setMobileBottomUiHeight(0);
      });
      return () => {
        window.cancelAnimationFrame(resetFrameId);
      };
    }

    const measureBottomUi = () => {
      const nextOffset = readMobileBottomNavOffset();
      setMobileBottomUiHeight((currentOffset) => (currentOffset === nextOffset ? currentOffset : nextOffset));
    };

    measureBottomUi();
    const frameId = window.requestAnimationFrame(measureBottomUi);
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measureBottomUi) : null;
    document.querySelectorAll<HTMLElement>(".support-mobile-nav-shell").forEach((shell) => {
      resizeObserver?.observe(shell);
    });
    const mutationObserver = typeof MutationObserver !== "undefined" ? new MutationObserver(measureBottomUi) : null;
    mutationObserver?.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "aria-hidden"],
    });
    window.addEventListener("resize", measureBottomUi);
    window.addEventListener("orientationchange", measureBottomUi);
    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener("resize", measureBottomUi);
      window.removeEventListener("orientationchange", measureBottomUi);
    };
  }, [isMobileViewport, pathname]);

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

    const warmRecentRoutes = (registration: ServiceWorkerRegistration) => {
      if (typeof window === "undefined" || navigator.onLine === false || !shouldAutoWarmPwaRoutes()) return;
      try {
        if (window.sessionStorage.getItem(PWA_RECENT_ROUTE_WARM_SESSION_KEY) === "1") return;
      } catch {
        // Ignore sessionStorage failures.
      }
      const routes = collectPwaWarmRoutes(latestPathnameRef.current);
      if (!routes.length) return;
      const targetWorker =
        registration.active ??
        navigator.serviceWorker.controller ??
        registration.waiting ??
        registration.installing ??
        null;
      if (!targetWorker) return;
      targetWorker.postMessage({ type: "WARM_RECENT_ROUTES", routes });
      try {
        window.sessionStorage.setItem(PWA_RECENT_ROUTE_WARM_SESSION_KEY, "1");
      } catch {
        // Ignore sessionStorage failures.
      }
    };

    const silentlyCheckForUpdates = (registration: ServiceWorkerRegistration, force = false) => {
      if (navigator.onLine === false) return;
      const now = Date.now();
      if (!force && now - lastUpdateCheckAtRef.current < PWA_UPDATE_RESUME_CHECK_INTERVAL_MS) {
        return;
      }
      lastUpdateCheckAtRef.current = now;
      void registration.update().catch(() => undefined);
    };

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

      silentlyCheckForUpdates(registration, true);
      updateTimer = window.setInterval(() => {
        silentlyCheckForUpdates(registration, true);
      }, PWA_UPDATE_CHECK_INTERVAL_MS);
    };

    const handleControllerChange = () => {
      if (reloadTriggeredRef.current) return;
      reloadTriggeredRef.current = true;
      window.location.reload();
    };

    const handleResume = () => {
      if (document.visibilityState === "hidden") return;
      const registration = registrationRef.current;
      if (!registration) return;
      silentlyCheckForUpdates(registration);
      warmRecentRoutes(registration);
    };

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    window.addEventListener("focus", handleResume);
    window.addEventListener("online", handleResume);
    document.addEventListener("visibilitychange", handleResume);

    void navigator.serviceWorker
      .register(FAOLLA_SERVICE_WORKER_PATH, {
        scope: "/",
        updateViaCache: "none",
      })
      .then((registration) => {
        if (cancelled) return;
        registrationRef.current = registration;
        bindRegistration(registration);
        postLaunchTargetToWorker(registration, resolvePreferredPwaLaunchPath(latestPathnameRef.current));
        warmRecentRoutes(registration);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      registrationRef.current = null;
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      window.removeEventListener("focus", handleResume);
      window.removeEventListener("online", handleResume);
      document.removeEventListener("visibilitychange", handleResume);
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
  const mobileBottomPromptOffset =
    isMobileViewport && shouldReserveMobileBottomNav(pathname)
      ? Math.max(mobileBottomUiHeight, PWA_MOBILE_BOTTOM_NAV_FALLBACK_PX) + PWA_MOBILE_PROMPT_GAP_PX
      : mobileBottomUiHeight > 0
        ? mobileBottomUiHeight + PWA_MOBILE_PROMPT_GAP_PX
        : 0;
  const promptBottomStyle = {
    bottom:
      mobileBottomPromptOffset > 0
        ? `calc(env(safe-area-inset-bottom) + ${mobileBottomPromptOffset}px)`
        : inStandalone
          ? "calc(env(safe-area-inset-bottom) + 1rem)"
          : "1rem",
  } as const;
  const showInstallPrompt = !inStandalone && !showUpdatePrompt && (installPromptReady || showIosInstallGuide);
  const showInstallCard = showInstallPrompt && !showIosInstallGuide;
  const showBottomPromptStack = showOfflineBanner || showUpdatePrompt || showInstallCard;

  if (!showBottomPromptStack && !showIosInstallGuide) return null;

  return (
    <>
      {showBottomPromptStack ? (
        <div
          className="pointer-events-none fixed inset-x-0 z-[2147483450] mx-auto flex max-w-xl flex-col gap-3 px-3"
          style={promptBottomStyle}
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

          {showInstallCard ? (
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
                  <div className="mt-1 text-[11px] leading-5 text-slate-600">{copy.installBody}</div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void applyInstallPrompt();
                  }}
                  className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800"
                >
                  {copy.installAction}
                </button>
                <button
                  type="button"
                  onClick={dismissInstallPrompt}
                  className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
                >
                  {copy.dismissAction}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {showIosInstallGuide ? (
        <div className="pointer-events-auto fixed inset-0 z-[2147482501] bg-slate-950/62 backdrop-blur-[2px]">
          <div className="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+1rem)] mx-auto w-full max-w-sm px-4">
            <div className="mb-3 flex justify-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/15 bg-white/10 text-3xl text-white shadow-[0_12px_32px_rgba(15,23,42,0.35)] animate-bounce">
                ↑
              </div>
            </div>
            <div className="rounded-[1.6rem] border border-white/12 bg-slate-950/92 px-4 py-4 text-white shadow-[0_20px_48px_rgba(15,23,42,0.42)] backdrop-blur-xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold leading-5">{copy.installTitle}</div>
                  <div className="mt-1 text-[11px] leading-5 text-slate-300">{copy.iosInstallBody}</div>
                </div>
                <div className="rounded-full border border-white/14 bg-white/10 px-2 py-1 text-[10px] font-semibold text-slate-200">
                  Safari
                </div>
              </div>

              <div className="mt-4 space-y-2.5">
                {[
                  copy.iosInstallStepShare,
                  copy.iosInstallStepAddToHome,
                  copy.iosInstallStepConfirm,
                ].map((step, index) => (
                  <div
                    key={step}
                    className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/6 px-3 py-3"
                  >
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-bold text-slate-950">
                      {index + 1}
                    </div>
                    <div className="text-xs leading-5 text-slate-100">{step}</div>
                  </div>
                ))}
              </div>

              <div className="mt-3 rounded-2xl border border-sky-400/18 bg-sky-400/10 px-3 py-2 text-[11px] leading-5 text-sky-100">
                {copy.iosInstallHint}
              </div>

              <div className="mt-4 flex items-center justify-between gap-2">
                <div className="rounded-full border border-white/12 bg-white/6 px-3 py-1.5 text-[11px] font-semibold text-slate-200">
                  ↑ 分享
                </div>
                <button
                  type="button"
                  onClick={dismissInstallPrompt}
                  className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-slate-200"
                >
                  {copy.iosInstallAction}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
