"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { ensureDomTranslations, hasTranslatableText, isDomTranslationCached } from "@/lib/domTranslations";
import {
  DEFAULT_LOCALE,
  detectGeoLocale,
  detectPreferredLocale,
  getLocaleBundle,
  hasStoredLocalePreference,
  I18N_STORAGE_KEY,
  resolveSupportedLocale,
  type TranslationKey,
  writeStoredLocale,
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
const TRANSLATABLE_ATTRS = ["placeholder", "title", "aria-label"] as const;
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT"]);

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

function isEditableWarmupElement(element: Element | null) {
  if (!element) return false;
  if (element instanceof HTMLInputElement) {
    return !["button", "submit", "reset", "checkbox", "radio", "file", "color", "range"].includes(element.type);
  }
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLSelectElement) return true;
  if (element instanceof HTMLElement && element.isContentEditable) return true;
  return false;
}

function collectPageMissingTranslations(locale: string) {
  if (typeof document === "undefined") return new Set<string>();
  const missing = new Set<string>();

  const walk = (node: Node, skipSubtree = false) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue ?? "";
      const parentElement = node.parentElement;
      const shouldSkip =
        skipSubtree ||
        Boolean(parentElement?.closest("[data-no-translate='1']")) ||
        isEditableWarmupElement(parentElement);
      if (!shouldSkip && hasTranslatableText(text, locale) && !isDomTranslationCached(text, locale)) {
        missing.add(text);
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const element = node as Element;
    const shouldSkipElement =
      skipSubtree ||
      Boolean(element.closest("[data-no-translate='1']")) ||
      element.getAttribute("data-no-translate") === "1" ||
      SKIP_TAGS.has(element.tagName.toUpperCase());
    const shouldSkipChildren =
      shouldSkipElement || (isEditableWarmupElement(element) && !(element instanceof HTMLSelectElement));

    if (!shouldSkipElement) {
      for (const attr of TRANSLATABLE_ATTRS) {
        const value = element.getAttribute(attr) ?? "";
        if (value && hasTranslatableText(value, locale) && !isDomTranslationCached(value, locale)) {
          missing.add(value);
        }
      }

      if (element instanceof HTMLInputElement && ["button", "submit", "reset"].includes(element.type)) {
        const value = element.value ?? "";
        if (value && hasTranslatableText(value, locale) && !isDomTranslationCached(value, locale)) {
          missing.add(value);
        }
      }
    }

    Array.from(element.childNodes).forEach((child) => walk(child, shouldSkipChildren));
  };

  walk(document.body);
  return missing;
}

export function I18nProvider({
  children,
  initialLocale = DEFAULT_LOCALE,
}: {
  children: React.ReactNode;
  initialLocale?: string;
}) {
  const resolvedInitialLocale = resolveSupportedLocale(initialLocale);
  const localeSwitchVersionRef = useRef(0);
  const rawLocale = useSyncExternalStore(
    subscribeLocale,
    getLocaleClientSnapshot,
    () => resolvedInitialLocale,
  );
  const locale = resolveSupportedLocale(rawLocale);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const storedRaw = window.localStorage.getItem(I18N_STORAGE_KEY);
      if (!storedRaw || resolveSupportedLocale(storedRaw) !== locale || storedRaw.trim() !== locale) {
        writeStoredLocale(locale);
      }
    } catch {
      writeStoredLocale(locale);
    }
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
    if (hasStoredLocalePreference()) return;

    let cancelled = false;
    void (async () => {
      const detected = await detectGeoLocale();
      if (!detected || cancelled) return;
      if (hasStoredLocalePreference()) return;
      const resolved = resolveSupportedLocale(detected);
      if (resolved === locale) return;
      writeStoredLocale(resolved);
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

      const applyLocale = () => {
        if (typeof document !== "undefined" && resolved.toLowerCase() === "zh-cn") {
          document.documentElement.removeAttribute("data-i18n-pending");
        }
        writeStoredLocale(resolved);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event(LOCALE_CHANGE_EVENT));
        }
      };

      if (resolved.toLowerCase() === "zh-cn" || typeof window === "undefined" || typeof document === "undefined") {
        applyLocale();
        return;
      }

      const currentVersion = localeSwitchVersionRef.current + 1;
      localeSwitchVersionRef.current = currentVersion;

      void (async () => {
        try {
          const missing = collectPageMissingTranslations(resolved);
          if (missing.size > 0) {
            await ensureDomTranslations(missing, resolved);
          }
        } catch {
          // Ignore translation warm-up failures and switch locale anyway.
        }
        if (localeSwitchVersionRef.current !== currentVersion) return;
        applyLocale();
      })();
    },
    t: (key) => bundle[key] ?? key,
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
