"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { isServiceFrameMessage, isServiceSection, SERVICE_FRAME_EVENT, type ServiceSection } from "@/lib/merchantServiceFrame";
import { serviceButton, serviceRequest, ServiceRequestError, SERVICE_IDENTITY_CHANGED, type ServiceIdentity } from "./serviceCenterClient";

const Conversations = dynamic(() => import("./ServiceConversations"));
const Orders = dynamic(() => import("./ServiceOrders"));
const Account = dynamic(() => import("./ServiceAccount"));
const Favorite = dynamic(() => import("./ServiceFavorite"));

export default function ServiceFrameClient({ siteId, siteName, parentOrigin, nonce, initialSection }: {
  siteId: string; siteName: string; parentOrigin: string; nonce: string; initialSection: ServiceSection;
}) {
  const [identity, setIdentity] = useState<ServiceIdentity | null>(null);
  const [section, setSection] = useState<ServiceSection>(initialSection);
  const [active, setActive] = useState(true);
  const [error, setError] = useState("");
  const [visited, setVisited] = useState<Set<ServiceSection>>(new Set([initialSection]));
  const version = useRef(0);
  const { setLocale } = useI18n();
  const localeSetter = useRef(setLocale);
  useEffect(() => { localeSetter.current = setLocale; }, [setLocale]);
  const notify = useCallback((event: "ready" | "favorite" | "done" | "locale" | "signed-out", favorited?: boolean, locale?: string) => {
    window.parent.postMessage({ type: SERVICE_FRAME_EVENT, nonce, siteId, event,
      ...(typeof favorited === "boolean" ? { favorited } : {}), ...(locale ? { locale } : {}) }, parentOrigin);
  }, [nonce, siteId, parentOrigin]);
  const refreshIdentity = useCallback(async () => {
    const current = ++version.current;
    try {
      // Uses the existing canonical cookie renewal. Its payload never leaves this origin.
      await serviceRequest("/api/auth/merchant-session").catch(error => {
        // A definitive expiry may become a guest; a transient failure must not silently log the user out.
        if (!(error instanceof ServiceRequestError) || error.status !== 401) throw error;
      });
      const result = await serviceRequest<ServiceIdentity>("/api/personal-favorites");
      if (current === version.current) { setError(""); setIdentity(result.authenticated ? result : { ...result, accountId: "", profile: {} as ServiceIdentity["profile"], memberships: [], favoriteSites: [] }); }
    } catch { if (current === version.current) setError("账号状态暂时无法读取，请重试；不会清除你的登录或记录。"); }
  }, []);
  useEffect(() => {
    notify("ready");
    const handle = (event: MessageEvent) => {
      if (!isServiceFrameMessage(event, { origin: parentOrigin, source: window.parent, nonce, siteId })) return;
      if (typeof event.data.active === "boolean") setActive(event.data.active);
      if (isServiceSection(event.data.section)) { setSection(event.data.section); setVisited(current => new Set([...current, event.data.section])); }
      if (typeof event.data.locale === "string") localeSetter.current(event.data.locale);
    };
    const changed = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      // The host receives only its own favorite bit, never another merchant's state or account data.
      if (detail?.siteId === siteId && typeof detail.favorited === "boolean") notify("favorite", detail.favorited);
    };
    window.addEventListener("message", handle); window.addEventListener(SERVICE_IDENTITY_CHANGED, changed);
    return () => { window.removeEventListener("message", handle); window.removeEventListener(SERVICE_IDENTITY_CHANGED, changed); };
  }, [nonce, parentOrigin, siteId, refreshIdentity, notify]);
  useEffect(() => {
    if (!active) return;
    const firstRead = window.setTimeout(() => void refreshIdentity(), 0);
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refreshIdentity(); }, 120000);
    return () => { clearTimeout(firstRead); clearInterval(timer); };
  }, [active, refreshIdentity]);
  const props = { siteId, siteName, identity, refreshIdentity };
  return <main data-service-frame-content data-service-active={active ? "true" : "false"} className={`bg-slate-50 p-3 text-slate-900 sm:p-5 ${section === "conversations" ? "flex h-dvh min-h-0 flex-col overflow-hidden" : "min-h-screen"}`}>
    {error ? <div role="alert" className="mb-4 rounded-xl bg-rose-50 p-4 text-sm"><p>{error}</p><button type="button" className={serviceButton + " mt-3"} onClick={() => void refreshIdentity()}>重新读取账号</button></div> : null}
    {!identity && !error ? <p role="status">正在读取账号…</p> : null}
    {identity && visited.has("conversations") ? <div className="min-h-0 flex-1" key={identity.accountId + ":conversations"} hidden={section !== "conversations"}><Conversations {...props} active={active && section === "conversations"} /></div> : null}
    {identity && visited.has("orders") ? <div key={identity.accountId + ":orders"} hidden={section !== "orders"}><Orders {...props} active={active && section === "orders"} /></div> : null}
    {identity && visited.has("account") ? <div key={identity.accountId + ":account"} hidden={section !== "account"}><Account {...props} active={active && section === "account"} onLocaleChange={locale => notify("locale", undefined, locale)} onSignedOut={() => {
      ++version.current; setIdentity({ authenticated: false, accountId: "", profile: {} as ServiceIdentity["profile"], favoriteSites: [], memberships: [] }); notify("signed-out");
    }} /></div> : null}
    {identity && visited.has("favorite") ? <div key={identity.accountId + ":favorite"} hidden={section !== "favorite"}><Favorite {...props} active={active && section === "favorite"} onDone={() => notify("done")} /></div> : null}
  </main>;
}
