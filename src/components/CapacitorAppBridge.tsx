"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
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
const FAOLLA_NATIVE_WEB_RELOAD_STORAGE_KEY = "faolla:native-web-build-reload:v1";
const FAOLLA_NATIVE_WEB_BUILD_CHECK_THROTTLE_MS = 60_000;

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
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (isEmbeddedDocument()) return;

    document.documentElement.dataset.capacitor = "true";
    document.documentElement.dataset.capacitorPlatform = Capacitor.getPlatform();

    void StatusBar.setOverlaysWebView({ overlay: false }).catch(() => undefined);
    void StatusBar.setStyle({ style: Style.Dark }).catch(() => undefined);
    void StatusBar.setBackgroundColor({ color: "#ffffff" }).catch(() => undefined);

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

    const syncNativeWebBuild = async (force = false) => {
      const now = Date.now();
      if (!force && now - lastWebBuildCheckAt < FAOLLA_NATIVE_WEB_BUILD_CHECK_THROTTLE_MS) return;
      lastWebBuildCheckAt = now;

      const nextBuildId = await fetchCurrentWebBuildId().catch(() => "");
      if (!nextBuildId) return;

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
        return;
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
        window.location.replace(buildNativeWebReloadHref(nextBuildId));
      }
    };

    const refreshNativeSession = () => {
      void readMerchantSessionPayload(5200, { includeClientTokens: true }).catch(() => null);
    };
    void syncNativeWebBuild(true);
    refreshNativeSession();

    void App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) {
        void syncNativeWebBuild(true);
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
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.removeEventListener("popstate", syncNativeOrientation);
      window.removeEventListener("hashchange", syncNativeOrientation);
      window.removeEventListener("visibilitychange", syncNativeOrientation);
      delete document.documentElement.dataset.capacitor;
      delete document.documentElement.dataset.capacitorPlatform;
    };
  }, []);

  return null;
}
