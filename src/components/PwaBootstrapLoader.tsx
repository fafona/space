"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const PwaBootstrap = dynamic(() => import("@/components/PwaBootstrap"), {
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
  if (document.documentElement.dataset.capacitor === "true") return true;
  const capacitor = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return capacitor?.isNativePlatform?.() === true;
}

export default function PwaBootstrapLoader() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (isNativeOrAppShellRuntime()) return;
    let cancelled = false;
    let timeoutId: number | undefined;
    let idleId: number | undefined;
    const schedule = () => {
      if (cancelled) return;
      setEnabled(true);
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

  return enabled ? <PwaBootstrap /> : null;
}
