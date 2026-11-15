"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { servicePortalOrigin } from "@/lib/merchantServiceFrame";
import { createPortal } from "react-dom";

const ServiceCenter = dynamic(() => import("@/components/service-center/ServiceCenterSheet"), { ssr: false });
export default function PublicWebsiteActions({ siteId, siteName = "", serviceOrigin = "" }: { siteId: string; siteName?: string; serviceOrigin?: string }) {
  const [open, setOpen] = useState(false), [visited, setVisited] = useState(false), [favoriteRequested, setFavoriteRequested] = useState(false);
  const [conversationRequested, setConversationRequested] = useState(false), [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<{ authenticated: boolean; favorited: boolean } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const requestedEntryHandled = useRef(false);
  useEffect(() => { const ready = setTimeout(() => setMounted(true), 0); return () => clearTimeout(ready); }, []);
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
  const launch = (favorite: boolean, conversation = false) => {
    setFavoriteRequested(favorite); setConversationRequested(conversation); setVisited(true); setOpen(true);
    if (conversation && !status) void refreshStatus();
  };
  useEffect(() => {
    if (!status || requestedEntryHandled.current || new URLSearchParams(window.location.search).get("openService") !== "favorite") return;
    requestedEntryHandled.current = true;
    setFavoriteRequested(true); setConversationRequested(false); setVisited(true); setOpen(true);
    const url = new URL(window.location.href); url.searchParams.delete("openService");
    window.history.replaceState(window.history.state, "", url);
  }, [status]);
  const buttonClass = "inline-flex min-h-10 items-center justify-center rounded-full border border-slate-200 bg-white/95 px-3 py-2 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50";
  return <div data-public-website-actions className="flex items-start gap-2">
    {status?.authenticated && !status.favorited ? <button type="button" className={buttonClass} aria-label="收藏并加入本店会员" onClick={() => launch(true)}>☆</button> : null}
    <button type="button" className={buttonClass} aria-haspopup="dialog" aria-expanded={open && !conversationRequested} onClick={() => launch(false)}>服务中心</button>
    {mounted ? createPortal(<button type="button" data-public-chat-launcher aria-haspopup="dialog" aria-expanded={open && conversationRequested}
      className="faolla-public-chat-launcher inline-flex min-h-12 items-center gap-2 rounded-full border border-white/20 bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-xl hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700"
      onClick={() => launch(false, true)}><svg aria-hidden="true" viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 9 9 0 0 1-3.8-.9L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5Z" /></svg>联系商户</button>, document.body) : null}
    {visited ? <ServiceCenter open={open} onClose={() => setOpen(false)} siteId={siteId} siteName={siteName} serviceOrigin={serviceOrigin}
      authenticated={status?.authenticated ?? null} refreshStatus={refreshStatus} favoriteRequested={favoriteRequested} conversationRequested={conversationRequested}
      onFavoriteChange={favorited => { setStatus({ authenticated: true, favorited }); }} onSignedOut={() => setStatus({ authenticated: false, favorited: false })} /> : null}
  </div>;
}
