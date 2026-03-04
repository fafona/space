"use client";

import { useEffect } from "react";

function isIgnorableRejectionReason(reason: unknown) {
  if (!reason || typeof reason !== "object") return false;
  const record = reason as { name?: unknown; message?: unknown; __isAuthError?: unknown; status?: unknown };
  const name = typeof record.name === "string" ? record.name : "";
  const message = typeof record.message === "string" ? record.message : "";
  if (name === "AbortError") return true;
  if (message.includes("signal is aborted without reason")) return true;
  if (name === "AuthRetryableFetchError") return true;
  if (Number(record.status) === 0) return true;
  if (record.__isAuthError === true && name === "AuthRetryableFetchError") return true;
  if (record.__isAuthError === true && record.status === 0) return true;
  return false;
}

export default function UnhandledRejectionGuard() {
  useEffect(() => {
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (!isIgnorableRejectionReason(event.reason)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("unhandledrejection", onUnhandledRejection, true);
    return () => {
      window.removeEventListener("unhandledrejection", onUnhandledRejection, true);
    };
  }, []);

  return null;
}
