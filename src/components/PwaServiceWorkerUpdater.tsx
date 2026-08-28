"use client";

import { useEffect } from "react";
import { buildFaollaServiceWorkerPath } from "@/lib/faollaServiceWorker";

const FAOLLA_SERVICE_WORKER_PATH = buildFaollaServiceWorkerPath();
const UPDATE_RESUME_INTERVAL_MS = 5 * 60 * 1000;

function requestWorkerActivation(worker: ServiceWorker | null | undefined) {
  worker?.postMessage({ type: "SKIP_WAITING" });
}

export default function PwaServiceWorkerUpdater() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    let cancelled = false;
    let reloadTriggered = false;
    let lastUpdateAt = 0;
    let registration: ServiceWorkerRegistration | null = null;
    const controlledAtStartup = Boolean(navigator.serviceWorker.controller);
    const trackedRegistrations = new WeakSet<ServiceWorkerRegistration>();
    const trackedWorkers = new WeakSet<ServiceWorker>();

    const trackInstallingWorker = (worker: ServiceWorker | null) => {
      if (!worker || trackedWorkers.has(worker)) return;
      trackedWorkers.add(worker);
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          requestWorkerActivation(registration?.waiting ?? worker);
        }
      });
    };

    const bindRegistration = (nextRegistration: ServiceWorkerRegistration) => {
      registration = nextRegistration;
      requestWorkerActivation(nextRegistration.waiting);
      if (trackedRegistrations.has(nextRegistration)) return;
      trackedRegistrations.add(nextRegistration);
      trackInstallingWorker(nextRegistration.installing);
      nextRegistration.addEventListener("updatefound", () => {
        trackInstallingWorker(nextRegistration.installing);
      });
    };

    const ensureCurrentWorker = async (force = false) => {
      if (cancelled || navigator.onLine === false) return;
      const now = Date.now();
      if (!force && now - lastUpdateAt < UPDATE_RESUME_INTERVAL_MS) return;
      lastUpdateAt = now;
      try {
        const nextRegistration = await navigator.serviceWorker.register(FAOLLA_SERVICE_WORKER_PATH, {
          scope: "/",
          updateViaCache: "none",
        });
        if (cancelled) return;
        bindRegistration(nextRegistration);
        await nextRegistration.update().catch(() => undefined);
        if (cancelled) return;
        requestWorkerActivation(nextRegistration.waiting);
      } catch {
        // App-shell startup must continue even when service workers are unavailable.
      }
    };

    const handleControllerChange = () => {
      if (cancelled || reloadTriggered || !controlledAtStartup) return;
      reloadTriggered = true;
      window.location.reload();
    };
    const handleResume = () => {
      if (document.visibilityState === "hidden") return;
      void ensureCurrentWorker();
    };

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    window.addEventListener("focus", handleResume);
    window.addEventListener("online", handleResume);
    document.addEventListener("visibilitychange", handleResume);
    void ensureCurrentWorker(true);

    return () => {
      cancelled = true;
      registration = null;
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      window.removeEventListener("focus", handleResume);
      window.removeEventListener("online", handleResume);
      document.removeEventListener("visibilitychange", handleResume);
    };
  }, []);

  return null;
}
