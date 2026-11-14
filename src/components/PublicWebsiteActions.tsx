"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { servicePortalOrigin } from "@/lib/merchantServiceFrame";

const ServiceCenter = dynamic(() => import("@/components/service-center/ServiceCenterSheet"), { ssr: false });
export default function PublicWebsiteActions({ siteId, siteName = "", serviceOrigin = "" }: { siteId: string; siteName?: string; serviceOrigin?: string }) {
  const [open, setOpen] = useState(false), [visited, setVisited] = useState(false), [favoriteRequested, setFavoriteRequested] = useState(false);
  const [status, setStatus] = useState<{ authenticated: boolean; favorited: boolean } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const requestedEntryHandled = useRef(false);
  const refreshStatus = useCallback(async () => {
    controller.current?.abort();
    const pending = new AbortController(); controller.current = pending;
    const timer = setTimeout(() => pending.abort(), 9000);
    try {
      const url = new URL("/api/merchant-service/status", servicePortalOrigin(serviceOrigin, window.location.origin));
      url.searchParams.set("siteId", siteId);
      const response = await fetch(url, { credentials: "include", cache: "no-store", signal: pending.signal });
      const data = await response.json();
      if (!pending.signal.aborted && response.ok && data.ok && typeof data.authenticated === "boolean" && typeof data.favorited === "boolean")
        setStatus({ authenticated: data.authenticated, favorited: data.favorited });
    } catch { /* Unknown is not a guest: account tools can still verify inside the isolated panel. */ }
    finally { clearTimeout(timer); }
  }, [siteId, serviceOrigin]);
  useEffect(() => {
    const timer = window.setTimeout(() => void refreshStatus(), 1200);
    const visible = () => { if (document.visibilityState === "visible") void refreshStatus(); };
    document.addEventListener("visibilitychange", visible);
    return () => { clearTimeout(timer); controller.current?.abort(); document.removeEventListener("visibilitychange", visible); };
  }, [refreshStatus]);
  const launch = (favorite: boolean) => { setFavoriteRequested(favorite); setVisited(true); setOpen(true); };
  useEffect(() => {
    if (!status || requestedEntryHandled.current || new URLSearchParams(window.location.search).get("openService") !== "favorite") return;
    requestedEntryHandled.current = true;
    setFavoriteRequested(true); setVisited(true); setOpen(true);
    const url = new URL(window.location.href); url.searchParams.delete("openService");
    window.history.replaceState(window.history.state, "", url);
  }, [status]);
  const buttonClass = "inline-flex min-h-10 items-center justify-center rounded-full border border-slate-200 bg-white/95 px-3 py-2 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50";
  return <div data-public-website-actions className="flex items-start gap-2">
    {status?.authenticated && !status.favorited ? <button type="button" className={buttonClass} aria-label="收藏并加入本店会员" onClick={() => launch(true)}>☆</button> : null}
    <button type="button" className={buttonClass} aria-haspopup="dialog" aria-expanded={open} onClick={() => launch(false)}>服务中心</button>
    {visited ? <ServiceCenter open={open} onClose={() => setOpen(false)} siteId={siteId} siteName={siteName} serviceOrigin={serviceOrigin}
      authenticated={status?.authenticated ?? null} refreshStatus={refreshStatus} favoriteRequested={favoriteRequested}
      onFavoriteChange={favorited => { setStatus({ authenticated: true, favorited }); }} onSignedOut={() => setStatus({ authenticated: false, favorited: false })} /> : null}
  </div>;
}
