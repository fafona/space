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

function appendAppShellParam(path: string) {
  try {
    const url = new URL(path, window.location.origin);
    url.searchParams.set("appShell", "faolla");
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return path;
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

export default function CapacitorAppBridge() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

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

    if (window.location.pathname === "/") {
      window.location.replace(appendAppShellParam("/launch"));
      return undefined;
    }

    let removeBackButtonListener: (() => void) | undefined;
    let removeAppStateListener: (() => void) | undefined;

    const refreshNativeSession = () => {
      void readMerchantSessionPayload(5200, { includeClientTokens: true }).catch(() => null);
    };
    refreshNativeSession();

    void App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) {
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
