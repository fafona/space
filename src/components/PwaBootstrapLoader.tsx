"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const PwaBootstrap = dynamic(() => import("@/components/PwaBootstrap"), {
  loading: () => null,
  ssr: false,
});

const PwaServiceWorkerUpdater = dynamic(() => import("@/components/PwaServiceWorkerUpdater"), {
  loading: () => null,
  ssr: false,
});

function isNativeOrAppShellRuntime() {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search || "");
    if ((params.get("appShell") || "").trim().toLowerCase() === "faolla") return true;
    if ((params.get("nativeStart") || "").trim() === "1") return true;
  } catch {
    // Ignore URL parsing failures.
  }
  if (document.documentElement.dataset.faollaRequestedAppShell === "true") return true;
  if (document.documentElement.dataset.faollaAppShell === "true") return true;
  if (document.documentElement.dataset.capacitor === "true") return true;
  const capacitor = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return capacitor?.isNativePlatform?.() === true;
}

export default function PwaBootstrapLoader() {
  const [mode, setMode] = useState<"pending" | "service-worker-only" | "full">("pending");

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | undefined;
    let idleId: number | undefined;
    if (isNativeOrAppShellRuntime()) {
      timeoutId = window.setTimeout(() => {
        if (!cancelled) setMode("service-worker-only");
      }, 0);
      return () => {
        cancelled = true;
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      };
    }
    const schedule = () => {
      if (cancelled) return;
      setMode("full");
    };
    const win = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (typeof win.requestIdleCallback === "function") {
      idleId = win.requestIdleCallback(schedule, { timeout: 1800 });
    } else {
      timeoutId = window.setTimeout(schedule, 1200);
    }
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      if (idleId !== undefined && typeof win.cancelIdleCallback === "function") {
        win.cancelIdleCallback(idleId);
      }
    };
  }, []);

  if (mode === "service-worker-only") return <PwaServiceWorkerUpdater />;
  if (mode === "full") return <PwaBootstrap />;
  return null;
}
