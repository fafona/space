"use client";

import { useSyncExternalStore } from "react";
import { useI18n } from "@/components/I18nProvider";
import { getDomTranslationStatus, getDomTranslationServerStatus, subscribeDomTranslationStatus, requestDomTranslationRetry } from "@/lib/domTranslationStatus";

/** Non-modal feedback beside a language control. It never covers or locks the page. */
export default function LanguageTranslationFeedback() {
  const { locale } = useI18n();
  const status = useSyncExternalStore(subscribeDomTranslationStatus, getDomTranslationStatus, getDomTranslationServerStatus);
  if (status.locale !== locale || status.state === "idle") return null;
  const pending = status.state === "pending";
  const labels = locale.startsWith("zh")
    ? { pending: "正在翻译…", incomplete: "部分内容未翻译", retry: "重试翻译" }
    : locale.startsWith("es")
      ? { pending: "Traduciendo…", incomplete: "Traducción incompleta", retry: "Reintentar traducción" }
      : { pending: "Translating…", incomplete: "Translation incomplete", retry: "Retry translation" };
  return (
    <div data-no-translate="1" data-translation-feedback={pending ? "pending" : "incomplete"} role="status"
      className="absolute right-0 top-full z-10 mt-1 flex max-w-[min(280px,85vw)] items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-950 shadow-sm">
      <span>{pending ? labels.pending : labels.incomplete}</span>
      {!pending && <button type="button" className="shrink-0 font-semibold underline underline-offset-2" onClick={() => requestDomTranslationRetry(locale)}>{labels.retry}</button>}
    </div>
  );
}
