"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/components/I18nProvider";
import { resolveSupportedLocale } from "@/lib/i18n";
import { normalizeMerchantMembershipProfileDraft } from "@/lib/merchantMemberships";
import { buildServiceFrameUrl, isServiceFrameMessage, isServiceSection, SERVICE_FRAME_EVENT, servicePortalOrigin, type ServiceSection } from "@/lib/merchantServiceFrame";
import { serviceButton, type ServiceIdentity } from "./serviceCenterClient";

const LocalOrders = dynamic(() => import("./ServiceOrders"));
const LocalConversations = dynamic(() => import("./ServiceConversations"));
const LocalAccount = dynamic(() => import("./ServiceAccount"));
const Directory = dynamic(() => import("./ServiceDirectory"));
type Section = "menu" | "directory" | ServiceSection;
const sections = [{ id: "conversations", title: "会话", description: "联系商户，查看消息",
  tone: "border-teal-100 bg-teal-50/70 hover:border-teal-300", iconTone: "bg-teal-100 text-teal-800", path: "M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9H13a8.5 8.5 0 0 1 8 8v.5Z" },
  { id: "orders", title: "订单", description: "订单记录与预约安排",
    tone: "border-sky-100 bg-sky-50/70 hover:border-sky-300", iconTone: "bg-sky-100 text-sky-800", path: "M8 3v4M16 3v4M4 10h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1ZM8 14h3M8 17h7" },
  { id: "account", title: "我的", description: "个人资料、收藏与会员",
    tone: "border-violet-100 bg-violet-50/70 hover:border-violet-300", iconTone: "bg-violet-100 text-violet-800", path: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2" },
  { id: "directory", title: "Faolla", description: "发现更多本地商户",
    tone: "border-amber-100 bg-amber-50/70 hover:border-amber-300", iconTone: "bg-amber-100 text-amber-800", path: "m16 8-3 5-5 3 3-5 5-3ZM21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" }] as const;

export default function ServiceCenterSheet(props: { siteId: string; siteName: string; serviceOrigin: string;
  authenticated: boolean | null; refreshStatus: () => Promise<void>; onFavoriteChange: (value: boolean) => void;
  open: boolean; onClose: () => void; favoriteRequested: boolean;
  onSignedOut?: () => void;
}) {
  const { open, onClose, siteId } = props;
  const { locale, setLocale } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null), frame = useRef<HTMLIFrameElement>(null);
  const [section, setSection] = useState<Section>(props.favoriteRequested ? "favorite" : "menu");
  const [local, setLocal] = useState(false);
  const [localVisited, setLocalVisited] = useState<Set<Section>>(new Set());
  const [frameInitialSection, setFrameInitialSection] = useState<ServiceSection | null>(null);
  const [ready, setReady] = useState(false);
  const [slow, setSlow] = useState(false);
  const [retry, setRetry] = useState(0);
  const [nonce] = useState(() => crypto.randomUUID());
  const frameOrigin = servicePortalOrigin(props.serviceOrigin, window.location.origin);
  const select = (next: Section) => {
    if (props.authenticated === false || local || next === "directory") setLocalVisited(current => new Set([...current, next, section]));
    setSection(next); setLocal(false);
    if (isServiceSection(next) && (props.authenticated !== false || next === "favorite") && !frameInitialSection) setFrameInitialSection(next); };
  const sendState = () => frame.current?.contentWindow?.postMessage({ type: SERVICE_FRAME_EVENT, nonce, siteId,
    active: open && isServiceSection(section) && !local, ...(isServiceSection(section) ? { section } : {}), locale }, frameOrigin);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!open) { element.close(); return; }
    if (!element.open) element.showModal();
    const previous = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);
  useEffect(() => {
    if (open) select(props.favoriteRequested ? "favorite" : "menu");
    // Reopening chooses the entry requested by the user, not an identity refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, props.favoriteRequested]);
  useEffect(() => { sendState(); });
  useEffect(() => {
    if (!frameInitialSection || ready) return;
    const timer = setTimeout(() => setSlow(true), 10000);
    return () => clearTimeout(timer);
  }, [frameInitialSection, ready, retry]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!isServiceFrameMessage(event, { origin: frameOrigin, source: frame.current?.contentWindow ?? null, nonce, siteId })) return;
      if (event.data.event === "ready") { setReady(true); setSlow(false); sendState(); }
      if (event.data.event === "favorite" && typeof event.data.favorited === "boolean") props.onFavoriteChange(event.data.favorited);
      if (event.data.event === "done") { setSection("menu"); void props.refreshStatus(); }
      if (event.data.event === "locale" && typeof event.data.locale === "string" && resolveSupportedLocale(event.data.locale) === event.data.locale) setLocale(event.data.locale);
      if (event.data.event === "signed-out") { props.onSignedOut?.(); setSection("menu"); void props.refreshStatus(); }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  });
  const frameUrl = useMemo(() => frameInitialSection ? buildServiceFrameUrl({ origin: frameOrigin, parentOrigin: window.location.origin,
    siteId, nonce, section: frameInitialSection, locale, returnTo: window.location.href }) : "",
    // Locale/section updates use bounded postMessage, never reload the personal document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frameInitialSection, frameOrigin, siteId, nonce, retry]);
  const guestIdentity = useMemo<ServiceIdentity>(() => ({ authenticated: false, accountId: "", profile: normalizeMerchantMembershipProfileDraft({}), favoriteSites: [], memberships: [] }), []);
  const localProps = { siteId, siteName: props.siteName, identity: guestIdentity, refreshIdentity: props.refreshStatus };
  const localFeature = section !== "favorite" && (props.authenticated === false || local);
  const title = section === "menu" ? "服务中心" : section === "favorite" ? "收藏本店" : sections.find(item => item.id === section)?.title;
  const visibleFrame = isServiceSection(section) && !localFeature;
  return createPortal(<dialog ref={dialog} aria-labelledby="merchant-service-title" data-service-center
    className="faolla-service-sheet m-0 mt-auto w-full max-w-none overflow-hidden rounded-t-[28px] border-0 bg-slate-50 p-0 text-slate-900 shadow-2xl"
    onCancel={event => {
      // A file input's picker also emits `cancel`; React delegates that event
      // through this dialog. Only the dialog's own Escape request may close it.
      if (event.target !== event.currentTarget) return;
      event.preventDefault(); onClose();
    }}
    onClick={event => { if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientY < bounds.top || event.clientX < bounds.left || event.clientX > bounds.right) onClose(); }}>
    <div className="mx-auto flex h-full max-w-6xl flex-col">
      <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-slate-300" aria-hidden="true" />
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">{section !== "menu" ? <button type="button" className={serviceButton} onClick={() => select("menu")} aria-label="返回服务中心">←</button> : null}
          <div><h2 id="merchant-service-title" className="text-lg font-semibold">{title}</h2><p className="truncate text-xs text-slate-500">{props.siteName || "商户网站"} · 点击上方网页可返回</p></div></div>
        <button type="button" className={serviceButton} onClick={onClose} aria-label="关闭服务中心">关闭</button>
      </header>
      <div className={`min-h-0 flex-1 overscroll-contain p-3 sm:p-5 ${section === "conversations" ? "overflow-hidden" : "overflow-y-auto"}`} hidden={visibleFrame}>
        {section === "menu" ? <div className="grid gap-3 sm:grid-cols-2">{sections.map(item => <button key={item.id} type="button"
          data-service-section={item.id} className={`group flex min-h-28 items-center gap-4 rounded-2xl border p-5 text-left transition hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-700 ${item.tone}`} onClick={() => select(item.id)}>
          <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${item.iconTone}`} aria-hidden="true"><svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={item.path} /></svg></span>
          <span><span className="block font-semibold">{item.title}</span><span className="mt-1 block text-xs leading-5 text-slate-600">{item.description}</span></span><span className="ml-auto text-slate-500 transition-transform group-hover:translate-x-1" aria-hidden="true">→</span></button>)}</div> : null}
        {localVisited.has("directory") ? <div hidden={section !== "directory"}><Directory {...localProps} active={open && section === "directory"} /></div> : null}
        {(localVisited.has("orders") || localFeature && section === "orders") ? <div hidden={!localFeature || section !== "orders"}><LocalOrders {...localProps} active={open && localFeature && section === "orders"} /></div> : null}
        {(localVisited.has("conversations") || localFeature && section === "conversations") ? <div className="h-full min-h-0" hidden={!localFeature || section !== "conversations"}><LocalConversations {...localProps} active={open && localFeature && section === "conversations"} /></div> : null}
        {(localVisited.has("account") || localFeature && section === "account") ? <div hidden={!localFeature || section !== "account"}><LocalAccount {...localProps} active={open && localFeature && section === "account"} /></div> : null}
      </div>
      {visibleFrame && !ready ? <p role="status" className="p-3 text-sm text-slate-500">{slow ? "服务读取较慢，商户网页仍保留。" : "正在打开服务…"}</p> : null}
      {visibleFrame && slow ? <div className="flex gap-2 p-3"><button className={serviceButton} onClick={() => { setSlow(false); setReady(false); setRetry(value => value + 1); }}>重新打开服务</button></div> : null}
      {frameUrl ? <iframe key={retry} ref={frame} src={frameUrl} title="Faolla 个人服务" data-isolated-service-frame hidden={!visibleFrame}
        className={`min-h-0 w-full flex-1 border-0 ${visibleFrame ? "block" : "!hidden"}`} referrerPolicy="no-referrer"
        allow="camera; clipboard-write; web-share"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-top-navigation-by-user-activation" onLoad={sendState} /> : null}
      {section === "orders" && props.authenticated !== false ? <button type="button" className={serviceButton + " m-2 shrink-0"} onClick={() => { setLocalVisited(current => new Set([...current, "orders"])); setLocal(value => !value); }}>{local ? "查看账号订单与预约" : "查看本设备游客记录"}</button> : null}
    </div>
  </dialog>, document.body);
}
