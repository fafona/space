"use client";

import { useEffect, useRef, useState } from "react";
import { GLOBAL_TOAST_DURATION_MS, GLOBAL_TOAST_EVENT, type GlobalToastPayload } from "@/lib/globalToast";

type ToastState = GlobalToastPayload & {
  id: number;
};

export default function GlobalToastViewport() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const clearTimer = () => {
      if (timeoutRef.current === null) return;
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    };

    const onToast = (event: Event) => {
      const payload = (event as CustomEvent<GlobalToastPayload>).detail;
      const message = String(payload?.message ?? "").trim();
      if (!message) return;
      clearTimer();
      setToast({
        id: Date.now(),
        message,
        tone: payload?.tone ?? "default",
      });
      timeoutRef.current = window.setTimeout(() => {
        setToast(null);
        timeoutRef.current = null;
      }, GLOBAL_TOAST_DURATION_MS);
    };

    window.addEventListener(GLOBAL_TOAST_EVENT, onToast);
    return () => {
      clearTimer();
      window.removeEventListener(GLOBAL_TOAST_EVENT, onToast);
    };
  }, []);

  if (!toast) return null;

  const toneClassName =
    toast.tone === "error"
      ? "bg-rose-950/90 text-white"
      : toast.tone === "success"
        ? "bg-slate-950/90 text-white"
        : "bg-slate-950/90 text-white";

  return (
    <div className="pointer-events-none fixed inset-0 z-[2147483600] flex items-center justify-center p-4">
      <div
        key={toast.id}
        className={`max-w-[min(36rem,calc(100vw-2rem))] rounded-xl px-4 py-2.5 text-center text-sm font-medium shadow-[0_18px_60px_rgba(15,23,42,0.25)] backdrop-blur ${toneClassName}`}
        role={toast.tone === "error" ? "alert" : "status"}
        aria-live="polite"
      >
        {toast.message}
      </div>
    </div>
  );
}
