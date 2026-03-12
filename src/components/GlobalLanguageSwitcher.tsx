"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useI18n } from "@/components/I18nProvider";
import { LANGUAGE_OPTIONS } from "@/lib/i18n";
import { useHydrated } from "@/lib/useHydrated";

function flagImageUrl(countryCode: string) {
  return `https://flagcdn.com/24x18/${countryCode.toLowerCase()}.png`;
}

export default function GlobalLanguageSwitcher() {
  const hydrated = useHydrated();
  const pathname = usePathname();
  const { locale, setLocale, t } = useI18n();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const inEditor = pathname.startsWith("/admin") || pathname.startsWith("/super-admin/editor");

  const selected = useMemo(
    () => LANGUAGE_OPTIONS.find((item) => item.code === locale) ?? LANGUAGE_OPTIONS[0],
    [locale],
  );
  const asianOptions = useMemo(() => LANGUAGE_OPTIONS.filter((item) => item.region === "asia"), []);
  const europeanOptions = useMemo(
    () => {
      const preferredCodes = ["en-GB", "es-ES"];
      const europe = LANGUAGE_OPTIONS.filter((item) => item.region === "europe");
      const preferred = preferredCodes
        .map((code) => europe.find((item) => item.code === code))
        .filter((item): item is (typeof LANGUAGE_OPTIONS)[number] => Boolean(item));
      const rest = europe.filter((item) => !preferredCodes.includes(item.code));
      return [...preferred, ...rest];
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
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
  }, [open]);

  if (!hydrated) return null;

  return (
    <div
      data-no-translate="1"
      className={`pointer-events-none fixed right-3 z-[20010] md:right-5 ${
        inEditor ? "top-[4.25rem] md:top-[4.5rem]" : "top-3 md:top-5"
      }`}
    >
      <div ref={rootRef} className="pointer-events-auto relative">
        <button
          type="button"
          className="flex items-center gap-0 rounded-lg border border-slate-300 bg-white/95 px-2 py-1.5 text-xs text-slate-800 shadow-md backdrop-blur hover:bg-white md:gap-2"
          onClick={() => setOpen((prev) => !prev)}
          aria-label={t("lang.placeholder")}
          aria-expanded={open}
        >
          <img
            src={flagImageUrl(selected.countryCode)}
            alt={selected.label}
            width={16}
            height={12}
            className="rounded-[2px] border border-slate-200 object-cover"
            loading="eager"
          />
          <span className="hidden md:inline">{selected.label}</span>
        </button>
        {open ? (
          <div className="absolute right-0 mt-1 max-h-[60vh] w-[17rem] overflow-y-auto rounded-lg border border-slate-300 bg-white p-2 text-xs shadow-lg">
            <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Asia</div>
            <div className="space-y-1">
              {asianOptions.map((item) => (
                <button
                  key={item.code}
                  type="button"
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition ${
                    item.code === locale ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
                  }`}
                  onClick={() => {
                    setLocale(item.code);
                    setOpen(false);
                  }}
                >
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
                    item.code === locale ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
                  }`}
                  onClick={() => {
                    setLocale(item.code);
                    setOpen(false);
                  }}
                >
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
          </div>
        ) : null}
      </div>
    </div>
  );
}
