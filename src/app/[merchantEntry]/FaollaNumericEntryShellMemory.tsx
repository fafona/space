"use client";

import { useEffect } from "react";
import {
  FAOLLA_APP_SHELL_LOCATION_MESSAGE,
  buildFaollaShellHref,
  isFaollaBackendShellUrl,
  normalizeFaollaEntryUrl,
  readStoredFaollaEntryUrl,
  writeStoredFaollaEntryUrl,
} from "@/lib/faollaEntry";
import { readStoredLocale } from "@/lib/i18n";
import { isTrustedFrontendAuthBridgeOrigin } from "@/lib/frontendAuthBridge";

type FaollaNumericEntryShellMemoryProps = {
  frameId: string;
  hasExplicitEntryHref: boolean;
};

function readFrame(frameId: string) {
  const frame = document.getElementById(frameId);
  return frame instanceof HTMLIFrameElement ? frame : null;
}

export default function FaollaNumericEntryShellMemory({
  frameId,
  hasExplicitEntryHref,
}: FaollaNumericEntryShellMemoryProps) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const origin = window.location.origin;
    const frame = readFrame(frameId);

    if (!hasExplicitEntryHref && frame) {
      const storedHref = readStoredFaollaEntryUrl(origin);
      if (storedHref) {
        frame.src = buildFaollaShellHref(storedHref, readStoredLocale(), origin);
      }
    }

    const handleMessage = (event: MessageEvent) => {
      if (!isTrustedFrontendAuthBridgeOrigin(event.origin, origin)) return;
      const message =
        event.data && typeof event.data === "object" && !Array.isArray(event.data)
          ? (event.data as Record<string, unknown>)
          : null;
      if (message?.type !== FAOLLA_APP_SHELL_LOCATION_MESSAGE) return;
      const href = typeof message.href === "string" ? message.href.trim() : "";
      const normalized = normalizeFaollaEntryUrl(href, origin, { allowFaollaCrossOrigin: true });
      if (!normalized) return;

      const currentFrame = readFrame(frameId);
      if (isFaollaBackendShellUrl(normalized, origin)) {
        if (currentFrame) currentFrame.src = buildFaollaShellHref("/", readStoredLocale(), origin);
        return;
      }
      writeStoredFaollaEntryUrl(normalized, origin);
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [frameId, hasExplicitEntryHref]);

  return null;
}
