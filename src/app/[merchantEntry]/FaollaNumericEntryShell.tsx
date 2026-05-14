"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildFaollaShellHref,
  readStoredFaollaEntryUrl,
  resolveFaollaEntryUrlFromBrowser,
  writeStoredFaollaEntryUrl,
} from "@/lib/faollaEntry";
import { readStoredLocale } from "@/lib/i18n";

type FaollaNumericEntryShellProps = {
  merchantEntry: string;
};

function readInitialFaollaShellHref() {
  if (typeof window === "undefined") return "https://faolla.com/";
  const origin = window.location.origin;
  const entryHref = resolveFaollaEntryUrlFromBrowser(window.location.search, origin) || readStoredFaollaEntryUrl(origin) || "/";
  return buildFaollaShellHref(entryHref, readStoredLocale(), origin);
}

export default function FaollaNumericEntryShell({ merchantEntry }: FaollaNumericEntryShellProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const lastStoredHrefRef = useRef("");
  const [frameHref, setFrameHref] = useState(readInitialFaollaShellHref);
  const encodedMerchantEntry = encodeURIComponent(merchantEntry);
  const navItems = useMemo(
    () => [
      { key: "conversations", label: "会话", href: `/${encodedMerchantEntry}` },
      { key: "business", label: "生意", href: `/${encodedMerchantEntry}?section=business` },
      { key: "faolla", label: "Faolla", href: "" },
      { key: "self", label: "自己", href: `/${encodedMerchantEntry}?section=self` },
    ],
    [encodedMerchantEntry],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const origin = window.location.origin;
    const syncFrameLocation = () => {
      let nextHref = "";
      try {
        nextHref = frameRef.current?.contentWindow?.location.href ?? "";
      } catch {
        nextHref = "";
      }
      if (!nextHref || nextHref === lastStoredHrefRef.current) return;
      const storedHref = writeStoredFaollaEntryUrl(nextHref, origin);
      if (storedHref) lastStoredHrefRef.current = storedHref;
    };

    const intervalId = window.setInterval(syncFrameLocation, 900);
    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const goHome = () => {
    const nextHref = buildFaollaShellHref("/", readStoredLocale(), typeof window !== "undefined" ? window.location.origin : "https://faolla.com");
    setFrameHref(nextHref);
    if (typeof window !== "undefined") {
      writeStoredFaollaEntryUrl(nextHref, window.location.origin);
    }
  };

  return (
    <main className="fixed inset-0 overflow-hidden bg-white">
      <iframe
        ref={frameRef}
        title="Faolla.com"
        src={frameHref}
        onLoad={() => {
          if (typeof window === "undefined") return;
          let currentHref = frameHref;
          try {
            currentHref = frameRef.current?.contentWindow?.location.href ?? frameHref;
          } catch {
            currentHref = frameHref;
          }
          const storedHref = writeStoredFaollaEntryUrl(currentHref, window.location.origin);
          if (storedHref) lastStoredHrefRef.current = storedHref;
        }}
        className="absolute inset-0 h-full w-full border-0 bg-white"
      />
      <div className="pointer-events-none absolute left-4 top-[calc(env(safe-area-inset-top)+0.75rem)] z-10">
        <button
          type="button"
          aria-label="Faolla 首页"
          className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white/92 text-base font-black text-slate-950 shadow-[0_8px_26px_rgba(15,23,42,0.18)] backdrop-blur"
          onClick={goHome}
        >
          F
        </button>
      </div>
      <nav className="pointer-events-none fixed bottom-0 left-1/2 z-20 w-full max-w-md -translate-x-1/2 px-3 pb-[calc(env(safe-area-inset-bottom)+0.45rem)]">
        <div className="pointer-events-auto grid grid-cols-4 gap-1 rounded-[22px] border border-slate-200/80 bg-white/94 p-1.5 shadow-[0_-10px_32px_rgba(15,23,42,0.16)] backdrop-blur">
          {navItems.map((item) =>
            item.key === "faolla" ? (
              <button
                key={item.key}
                type="button"
                className="rounded-[16px] bg-slate-950 px-2 py-2 text-center text-xs font-semibold text-white"
                onClick={goHome}
              >
                {item.label}
              </button>
            ) : (
              <Link
                key={item.key}
                href={item.href}
                className="rounded-[16px] px-2 py-2 text-center text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                {item.label}
              </Link>
            ),
          )}
        </div>
      </nav>
    </main>
  );
}
