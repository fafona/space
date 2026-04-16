"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/components/I18nProvider";

const FAOLLA_SERVICE_WORKER_PATH = "/faolla-sw.js";
const PWA_UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

type PwaCopy = {
  offlineTitle: string;
  offlineBody: string;
  offlineAction: string;
  updateTitle: string;
  updateBody: string;
  updateAction: string;
  dismissAction: string;
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
  };
}

function isStandaloneDisplayMode() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true;
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
  const waitingWorkerRef = useRef<ServiceWorker | null>(null);
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

  const showOfflineBanner = isOffline && typeof window !== "undefined" && window.location.pathname !== "/offline";
  const showUpdatePrompt = updateReady;
  const inStandalone = typeof window !== "undefined" ? isStandaloneDisplayMode() : false;
  const isMobileAdminShell = isMobileViewport && pathname.startsWith("/admin");
  const promptBottomClassName = isMobileAdminShell
    ? "bottom-[calc(env(safe-area-inset-bottom)+6.4rem)]"
    : inStandalone
      ? "bottom-[calc(env(safe-area-inset-bottom)+1rem)]"
      : "bottom-4";

  if (!showOfflineBanner && !showUpdatePrompt) return null;

  return (
    <div className={`pointer-events-none fixed inset-x-0 z-[2147482500] mx-auto flex max-w-xl flex-col gap-3 px-3 ${promptBottomClassName}`}>
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
        <div className="pointer-events-auto rounded-2xl border border-sky-200 bg-white/96 px-4 py-3 text-slate-900 shadow-[0_20px_48px_rgba(15,23,42,0.2)] backdrop-blur">
          <div className="text-sm font-semibold">{copy.updateTitle}</div>
          <div className="mt-1 text-xs leading-5 text-slate-600">{copy.updateBody}</div>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={applyUpdate}
              disabled={isApplyingUpdate}
              className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:cursor-wait disabled:opacity-60"
            >
              {copy.updateAction}
            </button>
            <button
              type="button"
              onClick={hideUpdatePrompt}
              disabled={isApplyingUpdate}
              className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900 disabled:opacity-60"
            >
              {copy.dismissAction}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
