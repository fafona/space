"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { useRouter } from "next/navigation";
import { ScreenOrientation } from "@capacitor/screen-orientation";
import { StatusBar, Style } from "@capacitor/status-bar";
import { readMerchantSessionPayload } from "@/lib/authSessionRecovery";
import {
  createMobileSwipeBackEvent,
  resolveMobileSwipeBackHref,
} from "@/lib/mobileSwipeBack";

const FAOLLA_NATIVE_WEB_VERSION_URL = "/api/app-web-version";
const FAOLLA_NATIVE_WEB_BUILD_STORAGE_KEY = "faolla:native-web-build:v1";
const FAOLLA_NATIVE_WEB_CACHE_BUILD_STORAGE_KEY = "faolla:native-web-cache-build:v1";
const FAOLLA_NATIVE_BUILD_STORAGE_KEY = "faolla:native-build:v1";
const FAOLLA_NATIVE_WEB_RELOAD_STORAGE_KEY = "faolla:native-web-build-reload:v1";
const FAOLLA_NATIVE_WEB_BUILD_CHECK_THROTTLE_MS = 60_000;
const FAOLLA_NATIVE_STARTUP_MAINTENANCE_DELAY_MS = 12_000;
const FAOLLA_NATIVE_RESUME_MAINTENANCE_DELAY_MS = 4_000;
const FAOLLA_LAUNCH_BAR_COLOR = "#081121";
const FAOLLA_CONTENT_BAR_COLOR = "#ffffff";

type FaollaNativeOpenUrlWindow = Window &
  typeof globalThis & {
    __faollaNativeOpenUrl?: (url: string) => boolean;
  };

function readObjectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readWebBuildId(payload: unknown) {
  const record = readObjectRecord(payload);
  return readTrimmedString(record?.buildId);
}

function appendAppShellParam(path: string) {
  try {
    const url = new URL(path, window.location.origin);
    url.searchParams.set("appShell", "faolla");
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return path;
  }
}

function isEmbeddedDocument() {
  try {
    return window.parent !== window;
  } catch {
    return true;
  }
}

function isFaollaAppShellDocument() {
  try {
    return (new URLSearchParams(window.location.search || "").get("appShell") ?? "").trim().toLowerCase() === "faolla";
  } catch {
    return false;
  }
}

function isStandaloneShellDocument() {
  try {
    const standalone =
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    return Boolean(standalone);
  } catch {
    return false;
  }
}

function shouldUseWebLaunchCover() {
  return isFaollaAppShellDocument() || isStandaloneShellDocument();
}

function resolveNativeBackHref(pathname: string) {
  if (pathname.startsWith("/admin/games/") || pathname.startsWith("/admin/tools/")) {
    return "/admin?mobileTab=self&selfSection=games";
  }
  if (pathname.startsWith("/me/games/") || pathname.startsWith("/me/tools/")) {
    return "/me?mobileTab=self&selfSection=games";
  }
  if (pathname === "/bufuzai" || pathname === "/game-lobby") return "/launch";
  return "";
}

function dispatchNativeAppBackEvent() {
  const origin = window.location.origin;
  const pathname = window.location.pathname || "/";
  const search = window.location.search || "";
  const fallbackHref = resolveMobileSwipeBackHref(pathname, search, origin);
  const backEvent = createMobileSwipeBackEvent({
    pathname,
    search,
    fallbackHref,
    origin,
    source: "android-back",
  });
  window.dispatchEvent(backEvent);
  return backEvent.defaultPrevented;
}

function resolveNativeOrientation(pathname: string) {
  if (pathname.endsWith("/games/tank-battle")) return "landscape";
  return "portrait";
}

function buildNativeWebReloadHref(buildId: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("appShell", "faolla");
  url.searchParams.set("__faollaWebBuild", buildId.slice(0, 12));
  return `${url.pathname}${url.search}${url.hash}`;
}

function readNativeBuildParam() {
  try {
    return new URLSearchParams(window.location.search || "").get("nativeBuild")?.trim() || "";
  } catch {
    return "";
  }
}

function resolveNativeClientNavigationHref(rawUrl: string) {
  const trimmedUrl = rawUrl.trim();
  if (!trimmedUrl) return "";
  try {
    const url = new URL(trimmedUrl, window.location.origin);
    if (url.origin !== window.location.origin) return url.toString();
    url.searchParams.set("appShell", "faolla");
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "";
  }
}

function hideNativeLaunchCover() {
  const nativeBridge = (window as typeof window & {
    FaollaNativeUpdates?: { hideLaunchCover?: () => void };
  }).FaollaNativeUpdates;
  if (typeof nativeBridge?.hideLaunchCover !== "function") return;
  nativeBridge.hideLaunchCover();
}

function showNativeLaunchCover() {
  const nativeBridge = (window as typeof window & {
    FaollaNativeUpdates?: { showLaunchCover?: () => void };
  }).FaollaNativeUpdates;
  if (typeof nativeBridge?.showLaunchCover !== "function") return;
  nativeBridge.showLaunchCover();
}

function applyNativeLaunchStatusBar() {
  if (!Capacitor.isNativePlatform()) return;
  void StatusBar.setOverlaysWebView({ overlay: false }).catch(() => undefined);
  void StatusBar.setStyle({ style: Style.Dark }).catch(() => undefined);
  void StatusBar.setBackgroundColor({ color: FAOLLA_LAUNCH_BAR_COLOR }).catch(() => undefined);
}

function applyNativeContentStatusBar() {
  if (!Capacitor.isNativePlatform()) return;
  void StatusBar.setOverlaysWebView({ overlay: false }).catch(() => undefined);
  void StatusBar.setStyle({ style: Style.Light }).catch(() => undefined);
  void StatusBar.setBackgroundColor({ color: FAOLLA_CONTENT_BAR_COLOR }).catch(() => undefined);
}

function hideWebLaunchCover() {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.faollaWebLaunchReady = "true";
}

function showWebLaunchCover() {
  if (typeof document === "undefined") return;
  delete document.documentElement.dataset.faollaWebLaunchReady;
}

function hideLaunchCovers() {
  hideWebLaunchCover();
  hideNativeLaunchCover();
  window.setTimeout(applyNativeContentStatusBar, 220);
}

function showLaunchCovers() {
  showWebLaunchCover();
  showNativeLaunchCover();
  applyNativeLaunchStatusBar();
}

function waitForNextTwoFrames() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

function isLaunchContentReady() {
  if (typeof document === "undefined" || typeof window === "undefined") return false;
  const pathname = window.location.pathname || "/";
  if (pathname === "/launch") return false;
  if (document.querySelector(".faolla-loading-progress-screen")) return false;
  if (
    document.querySelector(
      [
        ".support-mobile-shell",
        ".faolla-personal-mobile-shell",
        ".faolla-personal-desktop-shell",
        "main[data-editor-mode]",
      ].join(","),
    )
  ) {
    return true;
  }
  const visibleText = (document.body?.textContent ?? "").trim();
  return document.readyState === "complete" && visibleText.length > 0;
}

function canForceHideLaunchCoverAfterTimeout() {
  if (typeof document === "undefined" || typeof window === "undefined") return false;
  if ((window.location.pathname || "/") === "/launch") return false;
  if (document.querySelector(".faolla-loading-progress-screen")) return false;
  return document.readyState === "complete" && (document.body?.children.length ?? 0) > 0;
}

function scheduleLaunchCoverHideWhenContentReady(minDelayMs = 220, maxDelayMs = 60000) {
  const startedAt = Date.now();
  const tick = () => {
    const elapsed = Date.now() - startedAt;
    if (elapsed >= minDelayMs && (isLaunchContentReady() || (elapsed >= maxDelayMs && canForceHideLaunchCoverAfterTimeout()))) {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(hideLaunchCovers);
      });
      return;
    }
    window.setTimeout(tick, 50);
  };
  window.setTimeout(tick, minDelayMs);
}

async function refreshFaollaServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
  await Promise.all(
    registrations.map(async (registration) => {
      const target = registration.active ?? registration.waiting ?? registration.installing ?? navigator.serviceWorker.controller;
      target?.postMessage({ type: "CLEAR_RUNTIME_CACHES" });
      await registration.update().catch(() => undefined);
      const waitingWorker = registration.waiting;
      if (waitingWorker) {
        waitingWorker.postMessage({ type: "SKIP_WAITING" });
      }
    }),
  );
}

async function clearFaollaRuntimeCaches() {
  const tasks: Array<Promise<unknown>> = [refreshFaollaServiceWorker()];

  if (typeof window !== "undefined" && "caches" in window) {
    tasks.push(
      window.caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((key) => key.startsWith("faolla-") && key !== "faolla-badge-state-v1")
              .map((key) => window.caches.delete(key)),
          ),
        )
        .catch(() => undefined),
    );
  }

  await Promise.all(tasks);
}

async function fetchCurrentWebBuildId() {
  const url = new URL(FAOLLA_NATIVE_WEB_VERSION_URL, window.location.origin);
  url.searchParams.set("t", String(Date.now()));
  const response = await fetch(url.toString(), {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) return "";
  return readWebBuildId(await response.json().catch(() => null));
}

export default function CapacitorAppBridge() {
  const router = useRouter();

  useEffect(() => {
    const embeddedDocument = isEmbeddedDocument();

    if (shouldUseWebLaunchCover() && embeddedDocument) {
      window.requestAnimationFrame(hideWebLaunchCover);
    } else if (shouldUseWebLaunchCover() && !Capacitor.isNativePlatform()) {
      window.setTimeout(() => {
        window.requestAnimationFrame(hideWebLaunchCover);
      }, 900);
    }

    if (!Capacitor.isNativePlatform()) return;
    if (embeddedDocument) return;

    document.documentElement.dataset.capacitor = "true";
    document.documentElement.dataset.capacitorPlatform = Capacitor.getPlatform();

    applyNativeLaunchStatusBar();

    let activeOrientation = "";
    const syncNativeOrientation = () => {
      const nextOrientation = resolveNativeOrientation(window.location.pathname);
      if (nextOrientation === activeOrientation) return;
      activeOrientation = nextOrientation;
      void ScreenOrientation.lock({ orientation: nextOrientation }).catch(() => undefined);
    };

    const scheduleNativeOrientationSync = () => {
      window.setTimeout(syncNativeOrientation, 0);
    };

    const nativeOpenUrlWindow = window as FaollaNativeOpenUrlWindow;
    const previousNativeOpenUrlHandler = nativeOpenUrlWindow.__faollaNativeOpenUrl;
    nativeOpenUrlWindow.__faollaNativeOpenUrl = (rawUrl: string) => {
      const href = resolveNativeClientNavigationHref(rawUrl);
      if (!href) return false;
      if (href.startsWith("http://") || href.startsWith("https://")) {
        window.location.assign(href);
        return true;
      }
      router.push(href);
      scheduleNativeOrientationSync();
      return true;
    };

    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;

    window.history.pushState = function pushState(...args) {
      const result = originalPushState.apply(this, args);
      scheduleNativeOrientationSync();
      return result;
    };

    window.history.replaceState = function replaceState(...args) {
      const result = originalReplaceState.apply(this, args);
      scheduleNativeOrientationSync();
      return result;
    };

    syncNativeOrientation();
    window.addEventListener("popstate", syncNativeOrientation);
    window.addEventListener("hashchange", syncNativeOrientation);
    window.addEventListener("visibilitychange", syncNativeOrientation);

    if (window.location.pathname === "/" && !isFaollaAppShellDocument()) {
      window.location.replace(appendAppShellParam("/launch"));
      return undefined;
    }

    let removeBackButtonListener: (() => void) | undefined;
    let removeAppStateListener: (() => void) | undefined;
    let lastWebBuildCheckAt = 0;
    const recordNativeBuildOnce = () => {
      const nativeBuild = readNativeBuildParam();
      if (!nativeBuild) return Promise.resolve();
      let previousNativeBuild = "";
      try {
        previousNativeBuild = window.localStorage.getItem(FAOLLA_NATIVE_BUILD_STORAGE_KEY) ?? "";
      } catch {
        previousNativeBuild = "";
      }
      if (previousNativeBuild === nativeBuild) return Promise.resolve();
      try {
        window.localStorage.setItem(FAOLLA_NATIVE_BUILD_STORAGE_KEY, nativeBuild);
      } catch {
        // Ignore localStorage failures.
      }
      return Promise.resolve();
    };

    const syncNativeWebBuild = async (force = false): Promise<"ready" | "reloading"> => {
      const now = Date.now();
      if (!force && now - lastWebBuildCheckAt < FAOLLA_NATIVE_WEB_BUILD_CHECK_THROTTLE_MS) return "ready";
      lastWebBuildCheckAt = now;

      const nextBuildId = await fetchCurrentWebBuildId().catch(() => "");
      if (!nextBuildId) return "ready";

      let previousBuildId = "";
      let cacheBuildId = "";
      let lastReloadBuildId = "";
      try {
        previousBuildId = window.localStorage.getItem(FAOLLA_NATIVE_WEB_BUILD_STORAGE_KEY) ?? "";
        cacheBuildId = window.localStorage.getItem(FAOLLA_NATIVE_WEB_CACHE_BUILD_STORAGE_KEY) ?? "";
        lastReloadBuildId = window.localStorage.getItem(FAOLLA_NATIVE_WEB_RELOAD_STORAGE_KEY) ?? "";
      } catch {
        previousBuildId = "";
        cacheBuildId = "";
        lastReloadBuildId = "";
      }

      const needsCacheRefresh = cacheBuildId !== nextBuildId;
      const needsReload = lastReloadBuildId !== nextBuildId && (previousBuildId !== nextBuildId || needsCacheRefresh);

      if (!needsCacheRefresh && !needsReload) {
        try {
          window.localStorage.setItem(FAOLLA_NATIVE_WEB_BUILD_STORAGE_KEY, nextBuildId);
        } catch {
          // Ignore localStorage failures; the current page can continue.
        }
        return "ready";
      }

      if (needsCacheRefresh) {
        await clearFaollaRuntimeCaches();
      }

      try {
        window.localStorage.setItem(FAOLLA_NATIVE_WEB_BUILD_STORAGE_KEY, nextBuildId);
        window.localStorage.setItem(FAOLLA_NATIVE_WEB_CACHE_BUILD_STORAGE_KEY, nextBuildId);
        if (needsReload) {
          window.localStorage.setItem(FAOLLA_NATIVE_WEB_RELOAD_STORAGE_KEY, nextBuildId);
        }
      } catch {
        // Ignore localStorage failures and still refresh once.
      }

      if (needsReload) {
        showLaunchCovers();
        await waitForNextTwoFrames();
        window.location.replace(buildNativeWebReloadHref(nextBuildId));
        return "reloading";
      }
      return "ready";
    };

    const refreshNativeSession = () => {
      if (window.location.pathname === "/launch") return;
      void readMerchantSessionPayload(5200, { includeClientTokens: true }).catch(() => null);
    };

    let launchCoverHideScheduled = false;
    const scheduleInitialLaunchCoverHide = () => {
      if (launchCoverHideScheduled) return;
      launchCoverHideScheduled = true;
      scheduleLaunchCoverHideWhenContentReady();
    };
    const launchCoverHideFallback = window.setTimeout(scheduleInitialLaunchCoverHide, 60000);

    scheduleInitialLaunchCoverHide();
    const nativeStartupMaintenanceTimer = window.setTimeout(() => {
      void recordNativeBuildOnce()
        .then(() => syncNativeWebBuild(true))
        .catch(() => undefined);
    }, FAOLLA_NATIVE_STARTUP_MAINTENANCE_DELAY_MS);
    const nativeSessionRefreshTimer = window.setTimeout(refreshNativeSession, 1800);

    void App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) {
        window.setTimeout(() => {
          void syncNativeWebBuild(true);
        }, FAOLLA_NATIVE_RESUME_MAINTENANCE_DELAY_MS);
        refreshNativeSession();
        scheduleNativeOrientationSync();
      }
    }).then((handle) => {
      removeAppStateListener = () => {
        void handle.remove();
      };
    });

    void App.addListener("backButton", ({ canGoBack }) => {
      if (dispatchNativeAppBackEvent()) {
        return;
      }
      const nativeBackHref = resolveNativeBackHref(window.location.pathname);
      if (nativeBackHref) {
        window.location.assign(appendAppShellParam(nativeBackHref));
        return;
      }
      if (canGoBack) {
        window.history.back();
        return;
      }
      void App.exitApp();
    }).then((handle) => {
      removeBackButtonListener = () => {
        void handle.remove();
      };
    });

    return () => {
      removeBackButtonListener?.();
      removeAppStateListener?.();
      window.clearTimeout(launchCoverHideFallback);
      window.clearTimeout(nativeStartupMaintenanceTimer);
      window.clearTimeout(nativeSessionRefreshTimer);
      if (previousNativeOpenUrlHandler) {
        nativeOpenUrlWindow.__faollaNativeOpenUrl = previousNativeOpenUrlHandler;
      } else {
        delete nativeOpenUrlWindow.__faollaNativeOpenUrl;
      }
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.removeEventListener("popstate", syncNativeOrientation);
      window.removeEventListener("hashchange", syncNativeOrientation);
      window.removeEventListener("visibilitychange", syncNativeOrientation);
      delete document.documentElement.dataset.capacitor;
      delete document.documentElement.dataset.capacitorPlatform;
    };
  }, [router]);

  return null;
}
