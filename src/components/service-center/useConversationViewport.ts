"use client";

import { useEffect, useRef } from "react";
import { serviceSheetViewport } from "@/lib/serviceSheetViewport";

export function useConversationViewport(active: boolean) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!active || !element) return;
    const viewport = window.visualViewport;
    let frame = 0;
    const sync = () => {
      frame = 0;
      const bounds = serviceSheetViewport(viewport?.height ?? window.innerHeight, viewport?.offsetTop ?? 0, window.innerHeight);
      if (!bounds) return;
      element.style.setProperty("--faolla-service-visible-height", `${bounds.height}px`);
      element.style.setProperty("--faolla-service-visible-top", `${bounds.top}px`);
      element.dataset.keyboardOpen = String(bounds.keyboardOpen);
      element.dataset.chatCompact = String(bounds.compact);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };
    sync();
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      element.style.removeProperty("--faolla-service-visible-height");
      element.style.removeProperty("--faolla-service-visible-top");
      delete element.dataset.keyboardOpen;
      delete element.dataset.chatCompact;
    };
  }, [active]);
  return dialog;
}
