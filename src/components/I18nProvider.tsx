"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import {
  DEFAULT_LOCALE,
  detectDeviceLocale,
  detectGeoLocale,
  detectPreferredLocale,
  getLocaleBundle,
  hasManualLocalePreference,
  I18N_STORAGE_KEY,
  readRequestedLocaleFromSearch,
  resolveSupportedLocale,
  type TranslationKey,
  writeStoredLocale,
  writeManualLocale,
} from "@/lib/i18n";

type I18nContextValue = {
  locale: string;
  setLocale: (locale: string) => void;
  t: (key: TranslationKey) => string;
};

const I18nContext = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => undefined,
  t: (key) => key,
});

const LOCALE_CHANGE_EVENT = "merchant-space:locale-change";

function subscribeLocale(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const onLocaleChange = () => onStoreChange();
  const onStorage = (event: StorageEvent) => {
    if (event.key === I18N_STORAGE_KEY) onStoreChange();
  };
  window.addEventListener(LOCALE_CHANGE_EVENT, onLocaleChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(LOCALE_CHANGE_EVENT, onLocaleChange);
    window.removeEventListener("storage", onStorage);
  };
}

function getLocaleClientSnapshot() {
  return detectPreferredLocale();
}


export function I18nProvider({
  children,
  initialLocale = DEFAULT_LOCALE,
}: {
  children: React.ReactNode;
  initialLocale?: string;
}) {
  const resolvedInitialLocale = resolveSupportedLocale(initialLocale);
  const rawLocale = useSyncExternalStore(
    subscribeLocale,
    getLocaleClientSnapshot,
    () => resolvedInitialLocale,
  );
  const locale = resolveSupportedLocale(rawLocale);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (readRequestedLocaleFromSearch(window.location.search)) return;
    if (hasManualLocalePreference()) return;
    writeStoredLocale(locale, { source: "auto" });
  }, [locale]);

  useLayoutEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = locale;
    document.documentElement.setAttribute("data-ui-locale", locale);
  }, [locale]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const runtime = window as typeof window & { __merchantApplyTranslate?: (value: string) => void };
    runtime.__merchantApplyTranslate?.(locale);
  }, [locale]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (hasManualLocalePreference() || detectDeviceLocale()) return;

    let cancelled = false;
    void (async () => {
      const detected = await detectGeoLocale();
      if (!detected || cancelled) return;
      if (hasManualLocalePreference() || detectDeviceLocale()) return;
      const resolved = resolveSupportedLocale(detected);
      if (resolved === locale) return;
      writeStoredLocale(resolved, { source: "auto" });
      window.dispatchEvent(new Event(LOCALE_CHANGE_EVENT));
    })();

    return () => {
      cancelled = true;
    };
  }, [locale]);

  const bundle = getLocaleBundle(locale);
  const value: I18nContextValue = {
    locale,
    setLocale: (nextLocale) => {
      const resolved = resolveSupportedLocale(nextLocale);
      if (resolved === locale) return;

      // Selection must take effect immediately, including when a prior translation is still pending.
      writeManualLocale(resolved);
      if (typeof document !== "undefined") document.documentElement.removeAttribute("data-i18n-pending");
      if (typeof window !== "undefined") window.dispatchEvent(new Event(LOCALE_CHANGE_EVENT));
    },
    t: (key) => bundle[key] ?? key,
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
