"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { clearRecentPwaRoutes, readRecentPwaRoutes, type PwaRecentRouteRecord } from "@/lib/pwaRecentRoutes";

const PWA_INSTALL_DISMISS_STORAGE_KEY = "merchant-space:pwa-install-dismissed:v1";
const PWA_INSTALL_COMPLETED_STORAGE_KEY = "merchant-space:pwa-install-completed:v1";

type PwaSettingsCopy = {
  title: string;
  body: string;
  installLabel: string;
  installInstalled: string;
  installBrowser: string;
  installIosReady: string;
  workerLabel: string;
  workerActive: string;
  workerWaiting: string;
  workerMissing: string;
  cacheLabel: string;
  cacheEmpty: string;
  cacheCountSuffix: string;
  recentLabel: string;
  recentEmpty: string;
  recentWarmAction: string;
  recentClearAction: string;
  recentWarmReady: string;
  recentWarmFailed: string;
  recentAppBadge: string;
  recentPublicBadge: string;
  hintTitle: string;
  hintBody: string;
  updateAction: string;
  applyUpdateAction: string;
  refreshAction: string;
  clearCacheAction: string;
  resetInstallAction: string;
  offlineAction: string;
  backAction: string;
  updateChecking: string;
  updateReady: string;
  updateLatest: string;
  updateFailed: string;
  cacheCleared: string;
  cacheClearFailed: string;
  installReset: string;
};

function resolvePwaSettingsCopy(locale: string): PwaSettingsCopy {
  const normalized = (locale || "").trim().toLowerCase();
  const language = normalized.split("-")[0] || "en";

  if (language === "zh") {
    return {
      title: "PWA 设置",
      body: "这里可以查看当前安装状态、缓存情况，并手动检查更新或清理缓存。",
      installLabel: "安装状态",
      installInstalled: "已作为应用安装",
      installBrowser: "当前仍以浏览器网页方式打开",
      installIosReady: "可在 Safari 中手动添加到主屏幕",
      workerLabel: "Service Worker",
      workerActive: "已接管当前页面",
      workerWaiting: "发现新版本，等待应用",
      workerMissing: "当前未注册",
      cacheLabel: "缓存",
      cacheEmpty: "当前没有 Faolla 缓存",
      cacheCountSuffix: "个缓存",
      recentLabel: "最近访问页",
      recentEmpty: "当前还没有最近访问记录",
      recentWarmAction: "预热最近页面",
      recentClearAction: "清空最近记录",
      recentWarmReady: "最近访问页已交给 Service Worker 预热。",
      recentWarmFailed: "最近访问页预热失败，请稍后重试。",
      recentAppBadge: "工作区",
      recentPublicBadge: "公开页",
      hintTitle: "建议",
      hintBody: "清理缓存后，已离线保存的页面会被移除；下次联网访问时会重新缓存。",
      updateAction: "检查更新",
      applyUpdateAction: "应用更新",
      refreshAction: "刷新页面",
      clearCacheAction: "清理缓存",
      resetInstallAction: "重新显示安装引导",
      offlineAction: "打开离线页",
      backAction: "返回首页",
      updateChecking: "正在检查新版本…",
      updateReady: "已检测到新版本，可立即应用。",
      updateLatest: "当前已经是最新版本。",
      updateFailed: "检查更新失败，请稍后重试。",
      cacheCleared: "Faolla 缓存已清理。",
      cacheClearFailed: "缓存清理失败，请稍后重试。",
      installReset: "安装提示已重置，返回页面后会重新显示。",
    };
  }

  if (language === "es") {
    return {
      title: "Ajustes PWA",
      body: "Aquí puedes revisar la instalación, la caché y gestionar actualizaciones manualmente.",
      installLabel: "Instalación",
      installInstalled: "La app ya está instalada",
      installBrowser: "Ahora mismo se está usando en modo navegador",
      installIosReady: "Puedes añadirla manualmente a la pantalla de inicio en Safari",
      workerLabel: "Service Worker",
      workerActive: "La página ya está controlada",
      workerWaiting: "Hay una versión nueva esperando aplicarse",
      workerMissing: "No está registrado ahora mismo",
      cacheLabel: "Caché",
      cacheEmpty: "No hay caché de Faolla disponible",
      cacheCountSuffix: "cachés",
      recentLabel: "Páginas recientes",
      recentEmpty: "Todavía no hay páginas recientes registradas",
      recentWarmAction: "Precargar recientes",
      recentClearAction: "Borrar recientes",
      recentWarmReady: "Las páginas recientes se han enviado al Service Worker para precarga.",
      recentWarmFailed: "No se pudieron precargar las páginas recientes. Inténtalo de nuevo.",
      recentAppBadge: "Panel",
      recentPublicBadge: "Pública",
      hintTitle: "Consejo",
      hintBody: "Si limpias la caché, las páginas guardadas para uso offline se volverán a descargar al abrirlas con conexión.",
      updateAction: "Buscar actualizaciones",
      applyUpdateAction: "Aplicar actualización",
      refreshAction: "Recargar",
      clearCacheAction: "Limpiar caché",
      resetInstallAction: "Mostrar instalación otra vez",
      offlineAction: "Abrir modo offline",
      backAction: "Volver al inicio",
      updateChecking: "Buscando una versión nueva…",
      updateReady: "Se ha encontrado una versión nueva y ya se puede aplicar.",
      updateLatest: "Ya estás en la versión más reciente.",
      updateFailed: "No se pudo comprobar la actualización. Inténtalo de nuevo.",
      cacheCleared: "La caché de Faolla se ha limpiado.",
      cacheClearFailed: "No se pudo limpiar la caché. Inténtalo de nuevo.",
      installReset: "La guía de instalación se ha reactivado para la próxima visita.",
    };
  }

  return {
    title: "PWA Settings",
    body: "Review installation state, cached resources, and manually manage updates from here.",
    installLabel: "Install status",
    installInstalled: "Installed as an app",
    installBrowser: "Currently running in the browser",
    installIosReady: "Can be added manually from Safari",
    workerLabel: "Service Worker",
    workerActive: "Currently controlling this page",
    workerWaiting: "A newer version is waiting to be applied",
    workerMissing: "Not registered right now",
    cacheLabel: "Cache",
    cacheEmpty: "No Faolla caches are available right now",
    cacheCountSuffix: "caches",
    recentLabel: "Recent pages",
    recentEmpty: "No recent pages have been recorded yet",
    recentWarmAction: "Warm recent pages",
    recentClearAction: "Clear recent list",
    recentWarmReady: "Recent pages were handed off to the Service Worker for warming.",
    recentWarmFailed: "Recent page warming failed. Please try again later.",
    recentAppBadge: "Workspace",
    recentPublicBadge: "Public",
    hintTitle: "Tip",
    hintBody: "Clearing cache removes offline copies. They will be downloaded again the next time you open them online.",
    updateAction: "Check for updates",
    applyUpdateAction: "Apply update",
    refreshAction: "Refresh page",
    clearCacheAction: "Clear cache",
    resetInstallAction: "Show install guide again",
    offlineAction: "Open offline page",
    backAction: "Back to home",
    updateChecking: "Checking for a newer version…",
    updateReady: "A new version is ready and can be applied now.",
    updateLatest: "You are already on the latest version.",
    updateFailed: "Update check failed. Please try again later.",
    cacheCleared: "Faolla caches were cleared.",
    cacheClearFailed: "Cache clearing failed. Please try again later.",
    installReset: "Install guidance has been reset and will show again later.",
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

type WorkerState = "active" | "waiting" | "missing";

export default function PwaSettingsPage() {
  const { locale } = useI18n();
  const copy = useMemo(() => resolvePwaSettingsCopy(locale), [locale]);
  const [installed, setInstalled] = useState(false);
  const [iosInstallReady, setIosInstallReady] = useState(false);
  const [workerState, setWorkerState] = useState<WorkerState>("missing");
  const [cacheNames, setCacheNames] = useState<string[]>([]);
  const [recentRoutes, setRecentRoutes] = useState<PwaRecentRouteRecord[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isApplyingUpdate, setIsApplyingUpdate] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [isWarmingRecentRoutes, setIsWarmingRecentRoutes] = useState(false);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    let cancelled = false;

    const syncPwaState = async () => {
      if (typeof window === "undefined") return;

      setInstalled(isStandaloneDisplayMode());
      setIosInstallReady(!isStandaloneDisplayMode() && isMobileSafariBrowser());

      if ("serviceWorker" in navigator) {
        const registration = (await navigator.serviceWorker.getRegistration("/").catch(() => null)) ?? null;
        if (cancelled) return;
        registrationRef.current = registration;
        if (registration?.waiting) {
          setWorkerState("waiting");
        } else if (registration?.active || navigator.serviceWorker.controller) {
          setWorkerState("active");
        } else {
          setWorkerState("missing");
        }
      } else if (!cancelled) {
        setWorkerState("missing");
      }

      if ("caches" in window) {
        const keys = await caches.keys().catch(() => []);
        if (cancelled) return;
        setCacheNames(keys.filter((key) => key.startsWith("faolla-")).sort());
      }

      setRecentRoutes(readRecentPwaRoutes());
    };

    void syncPwaState();

    const handleControllerChange = () => {
      if (cancelled) return;
      window.location.reload();
    };

    navigator.serviceWorker?.addEventListener("controllerchange", handleControllerChange);

    return () => {
      cancelled = true;
      navigator.serviceWorker?.removeEventListener("controllerchange", handleControllerChange);
    };
  }, []);

  const refreshCacheNames = async () => {
    if (typeof window === "undefined" || !("caches" in window)) return;
    const keys = await caches.keys().catch(() => []);
    setCacheNames(keys.filter((key) => key.startsWith("faolla-")).sort());
  };

  const checkForUpdates = async () => {
    const registration = registrationRef.current;
    if (!registration) {
      setStatusMessage(copy.updateFailed);
      return;
    }

    setIsCheckingUpdate(true);
    setStatusMessage(copy.updateChecking);
    try {
      await registration.update();
      const refreshedRegistration =
        (await navigator.serviceWorker.getRegistration("/").catch(() => registration)) ?? registration;
      registrationRef.current = refreshedRegistration;
      const waitingWorker = refreshedRegistration?.waiting ?? null;
      if (waitingWorker) {
        setWorkerState("waiting");
        setStatusMessage(copy.updateReady);
      } else {
        setWorkerState(refreshedRegistration?.active || navigator.serviceWorker.controller ? "active" : "missing");
        setStatusMessage(copy.updateLatest);
      }
    } catch {
      setStatusMessage(copy.updateFailed);
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const applyUpdate = () => {
    const worker = registrationRef.current?.waiting ?? null;
    if (!worker) {
      setStatusMessage(copy.updateLatest);
      return;
    }
    setIsApplyingUpdate(true);
    setStatusMessage(copy.updateReady);
    worker.postMessage({ type: "SKIP_WAITING" });
  };

  const clearPwaCache = async () => {
    if (typeof window === "undefined" || !("caches" in window)) return;
    setIsClearingCache(true);
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith("faolla-")).map((key) => caches.delete(key)));
      await refreshCacheNames();
      setStatusMessage(copy.cacheCleared);
    } catch {
      setStatusMessage(copy.cacheClearFailed);
    } finally {
      setIsClearingCache(false);
    }
  };

  const resetInstallGuidance = () => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(PWA_INSTALL_DISMISS_STORAGE_KEY);
      window.localStorage.removeItem(PWA_INSTALL_COMPLETED_STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
    setStatusMessage(copy.installReset);
    setInstalled(isStandaloneDisplayMode());
    setIosInstallReady(!isStandaloneDisplayMode() && isMobileSafariBrowser());
  };

  const warmRecentRoutes = async () => {
    const registration = registrationRef.current;
    if (!registration) {
      setStatusMessage(copy.recentWarmFailed);
      return;
    }
    const nextRecentRoutes = readRecentPwaRoutes();
    setRecentRoutes(nextRecentRoutes);
    const routes = nextRecentRoutes.map((entry) => entry.path).filter(Boolean);
    if (!routes.length) {
      setStatusMessage(copy.recentEmpty);
      return;
    }
    const targetWorker =
      registration.active ??
      navigator.serviceWorker.controller ??
      registration.waiting ??
      registration.installing ??
      null;
    if (!targetWorker) {
      setStatusMessage(copy.recentWarmFailed);
      return;
    }

    setIsWarmingRecentRoutes(true);
    try {
      targetWorker.postMessage({ type: "WARM_RECENT_ROUTES", routes });
      setStatusMessage(copy.recentWarmReady);
    } catch {
      setStatusMessage(copy.recentWarmFailed);
    } finally {
      setIsWarmingRecentRoutes(false);
    }
  };

  const clearRecentRoutes = () => {
    clearRecentPwaRoutes();
    setRecentRoutes([]);
  };

  const installStatusText = installed
    ? copy.installInstalled
    : iosInstallReady
      ? copy.installIosReady
      : copy.installBrowser;
  const workerStatusText =
    workerState === "waiting"
      ? copy.workerWaiting
      : workerState === "active"
        ? copy.workerActive
        : copy.workerMissing;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#0f172a_0%,#081121_38%,#030712_100%)] px-4 py-8 text-white sm:px-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <section className="rounded-[2rem] border border-white/12 bg-white/8 px-5 py-6 shadow-[0_24px_70px_rgba(2,6,23,0.36)] backdrop-blur-xl sm:px-7">
          <div className="inline-flex items-center rounded-full border border-sky-300/18 bg-sky-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-100">
            Faolla PWA
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">{copy.title}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-200">{copy.body}</p>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          <article className="rounded-[1.6rem] border border-white/12 bg-slate-950/54 px-4 py-4 shadow-[0_16px_40px_rgba(2,6,23,0.22)]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{copy.installLabel}</div>
            <div className="mt-3 text-base font-semibold text-white">{installStatusText}</div>
          </article>
          <article className="rounded-[1.6rem] border border-white/12 bg-slate-950/54 px-4 py-4 shadow-[0_16px_40px_rgba(2,6,23,0.22)]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{copy.workerLabel}</div>
            <div className="mt-3 text-base font-semibold text-white">{workerStatusText}</div>
          </article>
          <article className="rounded-[1.6rem] border border-white/12 bg-slate-950/54 px-4 py-4 shadow-[0_16px_40px_rgba(2,6,23,0.22)]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{copy.cacheLabel}</div>
            <div className="mt-3 text-base font-semibold text-white">
              {cacheNames.length ? `${cacheNames.length} ${copy.cacheCountSuffix}` : copy.cacheEmpty}
            </div>
          </article>
        </section>

        <section className="rounded-[1.8rem] border border-white/12 bg-slate-950/54 px-5 py-5 shadow-[0_16px_40px_rgba(2,6,23,0.22)]">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                void checkForUpdates();
              }}
              disabled={isCheckingUpdate}
              className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-slate-200 disabled:cursor-wait disabled:opacity-60"
            >
              {copy.updateAction}
            </button>
            <button
              type="button"
              onClick={applyUpdate}
              disabled={workerState !== "waiting" || isApplyingUpdate}
              className="rounded-full border border-white/14 bg-white/8 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/24 hover:bg-white/12 disabled:opacity-40"
            >
              {copy.applyUpdateAction}
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-full border border-white/14 bg-white/8 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/24 hover:bg-white/12"
            >
              {copy.refreshAction}
            </button>
            <button
              type="button"
              onClick={() => {
                void clearPwaCache();
              }}
              disabled={isClearingCache}
              className="rounded-full border border-amber-300/24 bg-amber-300/10 px-4 py-2 text-sm font-semibold text-amber-100 transition hover:border-amber-300/40 hover:bg-amber-300/14 disabled:opacity-40"
            >
              {copy.clearCacheAction}
            </button>
            <button
              type="button"
              onClick={resetInstallGuidance}
              className="rounded-full border border-emerald-300/24 bg-emerald-300/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:border-emerald-300/40 hover:bg-emerald-300/14"
            >
              {copy.resetInstallAction}
            </button>
          </div>
          {statusMessage ? <div className="mt-4 text-sm leading-6 text-slate-300">{statusMessage}</div> : null}
        </section>

        <section className="rounded-[1.8rem] border border-white/12 bg-slate-950/54 px-5 py-5 shadow-[0_16px_40px_rgba(2,6,23,0.22)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-white">{copy.recentLabel}</div>
              <div className="mt-1 text-xs leading-5 text-slate-400">
                {recentRoutes.length ? `${recentRoutes.length} ${copy.cacheCountSuffix}` : copy.recentEmpty}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  void warmRecentRoutes();
                }}
                disabled={isWarmingRecentRoutes}
                className="rounded-full border border-white/14 bg-white/8 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/24 hover:bg-white/12 disabled:opacity-40"
              >
                {copy.recentWarmAction}
              </button>
              <button
                type="button"
                onClick={clearRecentRoutes}
                className="rounded-full border border-white/14 bg-white/8 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/24 hover:bg-white/12"
              >
                {copy.recentClearAction}
              </button>
            </div>
          </div>
          {recentRoutes.length ? (
            <div className="mt-4 space-y-2">
              {recentRoutes.map((entry) => (
                <div
                  key={entry.path}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/6 px-3 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-white">{entry.path}</div>
                    <div className="mt-1 text-[11px] leading-5 text-slate-400">
                      {new Date(entry.updatedAt).toLocaleString(locale || undefined)}
                    </div>
                  </div>
                  <span className="rounded-full border border-white/10 bg-white/8 px-3 py-1 text-[11px] font-semibold text-slate-200">
                    {entry.kind === "app" ? copy.recentAppBadge : copy.recentPublicBadge}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section className="rounded-[1.8rem] border border-white/12 bg-slate-950/54 px-5 py-5 shadow-[0_16px_40px_rgba(2,6,23,0.22)]">
          <div className="text-sm font-semibold text-white">{copy.hintTitle}</div>
          <div className="mt-2 text-sm leading-7 text-slate-300">{copy.hintBody}</div>
          {cacheNames.length ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {cacheNames.map((cacheName) => (
                <span
                  key={cacheName}
                  className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] font-medium text-slate-200"
                >
                  {cacheName}
                </span>
              ))}
            </div>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/offline"
              className="rounded-full border border-white/14 bg-white/8 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/24 hover:bg-white/12"
            >
              {copy.offlineAction}
            </Link>
            <Link
              href="/"
              className="rounded-full border border-white/14 bg-white/8 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/24 hover:bg-white/12"
            >
              {copy.backAction}
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
