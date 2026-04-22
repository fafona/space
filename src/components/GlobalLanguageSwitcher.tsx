"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { usePathname } from "next/navigation";
import { useI18n } from "@/components/I18nProvider";
import { LANGUAGE_OPTIONS, resolveSupportedLocale } from "@/lib/i18n";
import { useHydrated } from "@/lib/useHydrated";

function flagImageUrl(countryCode: string) {
  return `https://flagcdn.com/${countryCode.toLowerCase()}.svg`;
}

export default function GlobalLanguageSwitcher() {
  const hydrated = useHydrated();
  const pathname = usePathname();
  const { locale, setLocale, t } = useI18n();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(max-width: 767px)").matches
      : false,
  );
  const [allowMobileAdminSwitcher, setAllowMobileAdminSwitcher] = useState(false);
  const inEditor = pathname.startsWith("/admin") || pathname.startsWith("/super-admin/editor");
  const isAdminPage = pathname.startsWith("/admin");
  const isMobileAdminSwitcherVisible = isMobileViewport && allowMobileAdminSwitcher;
  const isMobileAdminPage = isMobileViewport && (isAdminPage || allowMobileAdminSwitcher);
  const mobileAdminTopClassName =
    isMobileAdminSwitcherVisible
      ? "top-[calc(env(safe-area-inset-top)+0.75rem)]"
      : inEditor
        ? "top-[4.25rem] md:top-[4.5rem]"
        : "top-3 md:top-5";
  const resolvedLocale = useMemo(() => resolveSupportedLocale(locale), [locale]);

  const selected = useMemo(
    () => LANGUAGE_OPTIONS.find((item) => item.code === resolvedLocale) ?? LANGUAGE_OPTIONS[0],
    [resolvedLocale],
  );
  const asianOptions = useMemo(() => LANGUAGE_OPTIONS.filter((item) => item.region === "asia"), []);
  const europeanOptions = useMemo(() => {
    const preferredCodes = ["en-GB", "es-ES"];
    const europe = LANGUAGE_OPTIONS.filter((item) => item.region === "europe");
    const preferred = preferredCodes
      .map((code) => europe.find((item) => item.code === code))
      .filter((item): item is (typeof LANGUAGE_OPTIONS)[number] => Boolean(item));
    const rest = europe.filter((item) => !preferredCodes.includes(item.code));
    return [...preferred, ...rest];
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const handleChange = () => setIsMobileViewport(mediaQuery.matches);
    handleChange();
    mediaQuery.addEventListener("change", handleChange);
    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const readVisibility = () => {
      setAllowMobileAdminSwitcher(document.documentElement.getAttribute("data-mobile-language-switcher") === "show");
    };
    const handleVisibilityChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ visible?: boolean }>;
      if (typeof customEvent.detail?.visible === "boolean") {
        setAllowMobileAdminSwitcher(customEvent.detail.visible);
        return;
      }
      readVisibility();
    };
    readVisibility();
    const observer = new MutationObserver(() => {
      readVisibility();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-mobile-language-switcher"],
    });
    window.addEventListener("merchant-mobile-language-switcher-change", handleVisibilityChange as EventListener);
    return () => {
      observer.disconnect();
      window.removeEventListener("merchant-mobile-language-switcher-change", handleVisibilityChange as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isMobileAdminPage, open]);

  useEffect(() => {
    if (!open || !rootRef.current || typeof window === "undefined") return;

    const updateMenuStyle = () => {
      const triggerRect = rootRef.current?.getBoundingClientRect();
      if (!triggerRect) return;

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const horizontalGap = viewportWidth >= 768 ? 20 : 12;
      const verticalGap = 12;
      const desiredWidth = Math.min(272, Math.max(220, viewportWidth - horizontalGap * 2));
      const availableBelow = viewportHeight - triggerRect.bottom - verticalGap;
      const availableAbove = triggerRect.top - verticalGap;
      const openUpward = availableBelow < 260 && availableAbove > availableBelow;

      setMenuStyle({
        position: "fixed",
        top: openUpward ? undefined : Math.max(verticalGap, triggerRect.bottom + 8),
        bottom: openUpward ? Math.max(verticalGap, viewportHeight - triggerRect.top + 8) : undefined,
        right: Math.max(horizontalGap, viewportWidth - triggerRect.right),
        width: `${desiredWidth}px`,
        maxHeight: `${Math.max(220, openUpward ? availableAbove : availableBelow)}px`,
        zIndex: isMobileAdminPage ? 2147483606 : 2147483600,
      });
    };

    updateMenuStyle();
    window.addEventListener("resize", updateMenuStyle);
    window.addEventListener("scroll", updateMenuStyle, true);
    return () => {
      window.removeEventListener("resize", updateMenuStyle);
      window.removeEventListener("scroll", updateMenuStyle, true);
    };
  }, [isMobileAdminPage, open]);

  if (!hydrated) return null;

  const isLoginPage = pathname === "/login";
  const showOnMobile = isLoginPage;
  if (isMobileViewport && !showOnMobile) return null;

  const menuContent =
    open && menuStyle
      ? createPortal(
          <div
            ref={menuRef}
            style={menuStyle}
            className="overflow-y-auto overscroll-contain rounded-xl border border-slate-300 bg-white p-2 text-xs shadow-[0_22px_60px_rgba(15,23,42,0.22)]"
          >
            <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Asia</div>
            <div className="space-y-1">
              {asianOptions.map((item) => (
                <button
                  key={item.code}
                  type="button"
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition ${
                    item.code === resolvedLocale ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
                  }`}
                  onClick={() => {
                    setLocale(item.code);
                    setOpen(false);
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={flagImageUrl(item.countryCode)}
                    alt={item.label}
                    width={16}
                    height={12}
                    className="rounded-[2px] border border-slate-200 object-cover"
                    loading="lazy"
                  />
                  <span className="truncate">{item.label}</span>
                </button>
              ))}
            </div>
            <div className="mb-1 mt-3 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Europe</div>
            <div className="space-y-1">
              {europeanOptions.map((item) => (
                <button
                  key={item.code}
                  type="button"
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition ${
                    item.code === resolvedLocale ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
                  }`}
                  onClick={() => {
                    setLocale(item.code);
                    setOpen(false);
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={flagImageUrl(item.countryCode)}
                    alt={item.label}
                    width={16}
                    height={12}
                    className="rounded-[2px] border border-slate-200 object-cover"
                    loading="lazy"
                  />
                  <span className="truncate">{item.label}</span>
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      data-no-translate="1"
      className={`pointer-events-none fixed right-3 ${isMobileAdminPage ? "z-[2147483605]" : "z-[20010]"} ${mobileAdminTopClassName} md:right-5`}
    >
      <div ref={rootRef} className="pointer-events-auto relative">
        <button
          type="button"
          className="block h-6 w-9 overflow-hidden rounded-[4px] border border-slate-300/80 bg-transparent p-0 transition hover:brightness-105"
          onClick={() => setOpen((prev) => !prev)}
          aria-label={t("lang.placeholder")}
          aria-expanded={open}
          title={selected.label}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={flagImageUrl(selected.countryCode)}
            alt={selected.label}
            width={80}
            height={60}
            className="block h-full w-full object-cover"
            loading="eager"
          />
        </button>
      </div>
      {menuContent}
    </div>
  );
}
