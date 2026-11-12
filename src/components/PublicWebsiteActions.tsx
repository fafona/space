"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { buildPublicWebsiteWorkspaceHref, buildWebsitePlatformModeHref } from "@/lib/publicWebsiteNavigation";

function subscribeLocation(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener("hashchange", onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener("hashchange", onChange);
  };
}
const readLocation = () => window.location.href;
const readServerLocation = () => "";

/** Navigation only. No auth bootstrap, personal-data fetch or write on first paint. */
export default function PublicWebsiteActions({ siteId }: { siteId: string }) {
  const [open, setOpen] = useState(false);
  const source = useSyncExternalStore(subscribeLocation, readLocation, readServerLocation);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeEscape); };
  }, [open]);
  const origin = typeof window === "undefined" ? undefined : window.location.origin;
  const buttonClass = "inline-flex min-h-10 items-center justify-center rounded-full border border-slate-200 bg-white/95 px-3 py-2 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50";
  return <div ref={root} data-public-website-actions className="relative flex items-start gap-2">
    <a href={buildWebsitePlatformModeHref(source, origin)} target="_top" className={buttonClass} aria-label="在个人中心收藏本店" title="进入个人中心后点击星标收藏">☆</a>
    <button type="button" className={buttonClass} aria-expanded={open} aria-controls="public-website-account-menu" onClick={() => setOpen(value => !value)}>我的</button>
    {open ? <div id="public-website-account-menu" className="absolute right-0 top-full mt-2 grid w-48 gap-1 rounded-2xl border border-slate-200 bg-white p-2 text-sm text-slate-900 shadow-xl">
      {([
        ["self", "个人中心"], ["conversations", "会话咨询"], ["consumption", "我的订单与预约"], ["memberships", "我的会员"], ["favorites", "我的收藏"],
      ] as const).map(([section, label]) => <a key={section} href={buildPublicWebsiteWorkspaceHref(section, source, origin, siteId)} target="_top" className="rounded-xl px-3 py-2.5 hover:bg-slate-100" onClick={() => setOpen(false)}>{label}</a>)}
      <a href={buildWebsitePlatformModeHref(source, origin)} target="_top" className="rounded-xl border-t border-slate-100 px-3 py-2.5 text-slate-600 hover:bg-slate-100">在平台模式中打开</a>
    </div> : null}
  </div>;
}
