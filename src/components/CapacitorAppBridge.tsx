"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { ScreenOrientation } from "@capacitor/screen-orientation";
import { StatusBar, Style } from "@capacitor/status-bar";

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

export default function CapacitorAppBridge() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    document.documentElement.dataset.capacitor = "true";

    void StatusBar.setOverlaysWebView({ overlay: false }).catch(() => undefined);
    void StatusBar.setStyle({ style: Style.Light }).catch(() => undefined);
    void StatusBar.setBackgroundColor({ color: "#081121" }).catch(() => undefined);
    void ScreenOrientation.lock({ orientation: "portrait" }).catch(() => undefined);

    if (window.location.pathname === "/") {
      window.location.replace(appendAppShellParam("/launch"));
      return undefined;
    }

    let removeBackButtonListener: (() => void) | undefined;
    void App.addListener("backButton", ({ canGoBack }) => {
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
      delete document.documentElement.dataset.capacitor;
    };
  }, []);

  return null;
}
