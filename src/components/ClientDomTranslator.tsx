"use client";

import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef } from "react";
import { useI18n } from "@/components/I18nProvider";
import {
  ensureDomTranslations,
  hasTranslatableText,
  isDomTranslationCached,
  normalizeDomLocale,
  reverseTranslateDomText,
  translateDomText,
} from "@/lib/domTranslations";

const TRANSLATABLE_ATTRS = ["placeholder", "title", "aria-label"] as const;
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT"]);

function shouldSkipDomTranslatorForPath(pathname: string) {
  const normalized = pathname.trim();
  if (!normalized) return false;
  if (normalized === "/admin" || normalized.startsWith("/admin/")) return true;
  return /^\/\d{8}\/?$/.test(normalized);
}

function isEditableElement(element: Element | null) {
  if (!element) return false;
  if (element instanceof HTMLInputElement) {
    return !["button", "submit", "reset", "checkbox", "radio", "file", "color", "range"].includes(element.type);
  }
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLSelectElement) return true;
  if (element instanceof HTMLElement && element.isContentEditable) return true;
  return false;
}

function isTranslatableOptionElement(element: Element | null) {
  return element instanceof HTMLOptionElement;
}

type MerchantTextNode = Text & {
  __merchantSourceText?: string;
};

type MerchantElement = Element & {
  __merchantSourceAttrs?: Record<string, string>;
};

type MerchantInputElement = HTMLInputElement & {
  __merchantSourceInputValue?: string;
};

type TranslatorMutationGuard = {
  markTextMutation: (node: MerchantTextNode) => void;
  markAttrMutation: (element: MerchantElement, attr: (typeof TRANSLATABLE_ATTRS)[number]) => void;
  consumeTextMutation: (node: MerchantTextNode) => boolean;
  consumeAttrMutation: (element: MerchantElement, attr: string | null) => boolean;
};

function ensureElementSources(element: MerchantElement) {
  if (!element.__merchantSourceAttrs) {
    element.__merchantSourceAttrs = {};
  }
  return element.__merchantSourceAttrs;
}

function getTextSource(node: MerchantTextNode) {
  if (typeof node.__merchantSourceText === "string") return node.__merchantSourceText;
  const initial = node.nodeValue ?? "";
  node.__merchantSourceText = initial;
  return initial;
}

function collectMissingAndApplyText(
  node: MerchantTextNode,
  locale: string,
  missing: Set<string>,
  guard?: TranslatorMutationGuard,
  sourceRecoveryLocale?: string | null,
) {
  let source = getTextSource(node);
  if (locale === "zh-CN") {
    if (sourceRecoveryLocale && source === (node.nodeValue ?? "")) {
      const recovered = reverseTranslateDomText(source, sourceRecoveryLocale);
      if (recovered && recovered !== source) {
        source = recovered;
        node.__merchantSourceText = recovered;
      }
    }
    if ((node.nodeValue ?? "") !== source) {
      guard?.markTextMutation(node);
      node.nodeValue = source;
    }
    return;
  }

  const translated = translateDomText(source, locale);
  if (translated !== source) {
    if ((node.nodeValue ?? "") !== translated) {
      guard?.markTextMutation(node);
      node.nodeValue = translated;
    }
    return;
  }

  if (hasTranslatableText(source, locale) && !isDomTranslationCached(source, locale)) {
    missing.add(source);
  }
}

function collectMissingAndApplyAttrs(
  element: MerchantElement,
  locale: string,
  missing: Set<string>,
  guard?: TranslatorMutationGuard,
  sourceRecoveryLocale?: string | null,
) {
  const sources = ensureElementSources(element);

  TRANSLATABLE_ATTRS.forEach((attr) => {
    const current = element.getAttribute(attr);
    if (typeof sources[attr] !== "string") {
      sources[attr] = current ?? "";
    }

    let source = sources[attr] ?? "";
    if (!source) return;

    if (locale === "zh-CN") {
      if (sourceRecoveryLocale && source === (current ?? "")) {
        const recovered = reverseTranslateDomText(source, sourceRecoveryLocale);
        if (recovered && recovered !== source) {
          source = recovered;
          sources[attr] = recovered;
        }
      }
      if ((current ?? "") !== source) {
        guard?.markAttrMutation(element, attr);
        element.setAttribute(attr, source);
      }
      return;
    }

    const translated = translateDomText(source, locale);
    if (translated !== source) {
      if ((current ?? "") !== translated) {
        guard?.markAttrMutation(element, attr);
        element.setAttribute(attr, translated);
      }
      return;
    }

    if (hasTranslatableText(source, locale) && !isDomTranslationCached(source, locale)) {
      missing.add(source);
    }
  });

  if (element instanceof HTMLInputElement && ["button", "submit", "reset"].includes(element.type)) {
    const input = element as MerchantInputElement;
    if (typeof input.__merchantSourceInputValue !== "string") {
      input.__merchantSourceInputValue = input.value ?? "";
    }
    let source = input.__merchantSourceInputValue ?? "";
    if (!source) return;

    if (locale === "zh-CN") {
      if (sourceRecoveryLocale && source === input.value) {
        const recovered = reverseTranslateDomText(source, sourceRecoveryLocale);
        if (recovered && recovered !== source) {
          source = recovered;
          input.__merchantSourceInputValue = recovered;
        }
      }
      if (input.value !== source) {
        input.value = source;
      }
      return;
    }

    const translated = translateDomText(source, locale);
    if (translated !== source) {
      if (input.value !== translated) {
        input.value = translated;
      }
      return;
    }

    if (hasTranslatableText(source, locale) && !isDomTranslationCached(source, locale)) {
      missing.add(source);
    }
  }
}

function traverseAndApply(
  root: Node,
  locale: string,
  missing: Set<string>,
  skipSubtree = false,
  guard?: TranslatorMutationGuard,
  sourceRecoveryLocale?: string | null,
) {
  if (root.nodeType === Node.TEXT_NODE) {
    const parentElement = root.parentElement;
    const shouldSkip =
      skipSubtree ||
      Boolean(parentElement?.closest("[data-no-translate='1']")) ||
      (isEditableElement(parentElement) && !isTranslatableOptionElement(parentElement));
    if (!shouldSkip) {
      collectMissingAndApplyText(root as MerchantTextNode, locale, missing, guard, sourceRecoveryLocale);
    }
    return;
  }

  if (root.nodeType !== Node.ELEMENT_NODE) return;

  const element = root as MerchantElement;
  const shouldSkipElement =
    skipSubtree ||
    Boolean(element.closest("[data-no-translate='1']")) ||
    element.getAttribute("data-no-translate") === "1" ||
    SKIP_TAGS.has(element.tagName.toUpperCase());
  const shouldSkipChildren =
    shouldSkipElement ||
    (isEditableElement(element) && !(element instanceof HTMLSelectElement));

  if (!shouldSkipElement) {
    collectMissingAndApplyAttrs(element, locale, missing, guard, sourceRecoveryLocale);
  }

  const children = Array.from(element.childNodes);
  children.forEach((child) => {
    traverseAndApply(child, locale, missing, shouldSkipChildren, guard, sourceRecoveryLocale);
  });
}

function refreshMutationSource(mutation: MutationRecord) {
  if (mutation.type === "characterData") {
    const node = mutation.target as MerchantTextNode;
    node.__merchantSourceText = node.nodeValue ?? "";
    return;
  }

  if (mutation.type === "attributes" && mutation.target instanceof Element) {
    const element = mutation.target as MerchantElement;
    const attr = mutation.attributeName;
    if (!attr || !TRANSLATABLE_ATTRS.includes(attr as (typeof TRANSLATABLE_ATTRS)[number])) return;
    const sources = ensureElementSources(element);
    sources[attr] = element.getAttribute(attr) ?? "";
  }
}

export default function ClientDomTranslator() {
  const { locale } = useI18n();
  const pathname = usePathname();
  const applyVersionRef = useRef(0);
  const mutationGuardRef = useRef<TranslatorMutationGuard | null>(null);
  const previousLocaleRef = useRef<string>("zh-CN");

  if (!mutationGuardRef.current) {
    const translatedTextNodes = new WeakSet<MerchantTextNode>();
    const translatedAttrNodes = new WeakMap<MerchantElement, Set<string>>();
    mutationGuardRef.current = {
      markTextMutation: (node) => {
        translatedTextNodes.add(node);
      },
      markAttrMutation: (element, attr) => {
        const current = translatedAttrNodes.get(element) ?? new Set<string>();
        current.add(attr);
        translatedAttrNodes.set(element, current);
      },
      consumeTextMutation: (node) => {
        if (!translatedTextNodes.has(node)) return false;
        translatedTextNodes.delete(node);
        return true;
      },
      consumeAttrMutation: (element, attr) => {
        if (!attr) return false;
        const current = translatedAttrNodes.get(element);
        if (!current || !current.has(attr)) return false;
        current.delete(attr);
        if (current.size === 0) translatedAttrNodes.delete(element);
        return true;
      },
    };
  }

  useLayoutEffect(() => {
    if (typeof document === "undefined") return;
    if (shouldSkipDomTranslatorForPath(pathname)) {
      document.documentElement.removeAttribute("data-i18n-pending");
      return;
    }

    const normalizedLocale = normalizeDomLocale(locale);
    const isZhCn = normalizedLocale.toLowerCase() === "zh-cn";
    const previousLocale = previousLocaleRef.current;
    const sourceRecoveryLocale =
      isZhCn && previousLocale.toLowerCase() !== "zh-cn" ? previousLocale : null;
    previousLocaleRef.current = normalizedLocale;
    const shouldBlockFirstPaint =
      document.documentElement.getAttribute("data-i18n-pending") === "1" && !isZhCn;

    let disposed = false;
    let applying = false;
    let scheduled = false;
    let scheduledBlock = shouldBlockFirstPaint;
    const dirtyRoots = new Set<Node>();
    const mutationGuard = mutationGuardRef.current;
    const currentVersion = applyVersionRef.current + 1;
    applyVersionRef.current = currentVersion;

    const runApply = async (roots: Node[], block: boolean) => {
      if (disposed) return;

      const effectiveRoots = roots.length > 0 ? roots : [document.body];
      const missing = new Set<string>();

      applying = true;
      try {
        effectiveRoots.forEach((root) => {
          if (root.isConnected || root === document.body) {
            traverseAndApply(
              root,
              normalizedLocale,
              missing,
              false,
              mutationGuard ?? undefined,
              sourceRecoveryLocale,
            );
          }
        });
      } finally {
        applying = false;
      }

      if (isZhCn) {
        document.documentElement.removeAttribute("data-i18n-pending");
        return;
      }

      if (missing.size === 0) {
        if (block) {
          document.documentElement.removeAttribute("data-i18n-pending");
        }
        return;
      }

      if (block) {
        document.documentElement.setAttribute("data-i18n-pending", "1");
      }

      await ensureDomTranslations(missing, normalizedLocale);

      if (disposed || applyVersionRef.current !== currentVersion) return;

      applying = true;
      try {
        effectiveRoots.forEach((root) => {
          if (root.isConnected || root === document.body) {
            const noMissing = new Set<string>();
            traverseAndApply(
              root,
              normalizedLocale,
              noMissing,
              false,
              mutationGuard ?? undefined,
              sourceRecoveryLocale,
            );
          }
        });
      } finally {
        applying = false;
      }

      if (block) {
        document.documentElement.removeAttribute("data-i18n-pending");
      }
    };

    const flush = () => {
      if (disposed) return;
      scheduled = false;
      const roots = [...dirtyRoots];
      dirtyRoots.clear();
      const block = scheduledBlock;
      scheduledBlock = false;
      void runApply(roots, block);
    };

    const queueApply = (root: Node, block = false) => {
      dirtyRoots.add(root);
      if (block) scheduledBlock = true;
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(flush);
    };

    queueApply(document.body, shouldBlockFirstPaint);

    const observer = new MutationObserver((mutations) => {
      if (disposed || applying) return;

      mutations.forEach((mutation) => {
        if (mutation.type === "characterData" && mutationGuard?.consumeTextMutation(mutation.target as MerchantTextNode)) {
          return;
        }
        if (
          mutation.type === "attributes" &&
          mutation.target instanceof Element &&
          mutationGuard?.consumeAttrMutation(mutation.target as MerchantElement, mutation.attributeName)
        ) {
          return;
        }
        refreshMutationSource(mutation);
        if (mutation.type === "attributes") {
          queueApply(mutation.target, false);
          return;
        }
        if (mutation.type === "characterData") {
          queueApply(mutation.target, false);
          return;
        }
        if (mutation.type === "childList") {
          if (mutation.target) queueApply(mutation.target, false);
          mutation.addedNodes.forEach((node) => queueApply(node, false));
        }
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...TRANSLATABLE_ATTRS],
    });

    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [locale, pathname]);

  return null;
}
