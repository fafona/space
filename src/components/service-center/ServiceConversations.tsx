"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { MerchantPeerContactSummary, MerchantPeerThread } from "@/lib/merchantPeerInbox";
import type { PlatformSupportThread } from "@/lib/platformSupportInbox";
import { ensurePersonalGuestIdentity, readPersonalGuestProfile, readPersonalGuestPeerContacts, readPersonalGuestPeerThreads,
  readPersonalGuestSupportThread, appendPersonalGuestPeerMessage, appendPersonalGuestSupportMessage } from "@/lib/personalGuestSession";
import { parseSupportMessageAttachmentPreview, formatSupportConversationPreview } from "@/lib/supportMessageAttachments";
import { serviceButton, serviceInput, serviceRequest, type ServicePanelProps } from "./serviceCenterClient";

const subscribeDesktop = (notify: () => void) => {
  const query = window.matchMedia("(min-width: 768px)");
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};
const desktopSnapshot = () => window.matchMedia("(min-width: 768px)").matches;
const serverSnapshot = () => false;
function ConversationAvatar({ name, image, official = false }: { name: string; image?: string; official?: boolean }) {
  return <span className={`relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full text-sm font-semibold ${official ? "bg-slate-900 text-white" : "bg-teal-100 text-teal-900"}`} aria-hidden="true">
    {official ? "FA" : Array.from(name.trim()).slice(0, 2).join("")}
    {image ? <img src={image} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" onError={event => { event.currentTarget.hidden = true; }} /> : null}
  </span>;
}

type Inbox = { contacts?: MerchantPeerContactSummary[]; threads?: MerchantPeerThread[]; thread?: MerchantPeerThread;
  messagePage?: { hasMore?: boolean; offset?: number } };
const mergeThreads = (old: MerchantPeerThread[], next: MerchantPeerThread[]) => {
  const map = new Map(old.map(thread => [thread.threadKey, thread]));
  for (const thread of next) {
    const previous = map.get(thread.threadKey);
    const messages = [...new Map([...(previous?.messages ?? []), ...thread.messages].map(message => [message.id, message])).values()].sort((a,b) => a.createdAt.localeCompare(b.createdAt));
    map.set(thread.threadKey, { ...thread, messages });
  }
  return [...map.values()];
};
const safeLink = (value: string) => { if (!value.trim()) return ""; try { const url = new URL(value, window.location.origin); return /^https?:$/.test(url.protocol) ? url.href : ""; } catch { return ""; } };

export default function ServiceConversations({ active, identity, siteId, siteName }: ServicePanelProps) {
  const [contacts, setContacts] = useState<MerchantPeerContactSummary[]>([]);
  const [threads, setThreads] = useState<MerchantPeerThread[]>([]);
  const [official, setOfficial] = useState<PlatformSupportThread | null>(null);
  const [selected, setSelected] = useState(siteId);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const desktop = useSyncExternalStore(subscribeDesktop, desktopSnapshot, serverSnapshot);
  const chatVisible = desktop || mobileChatOpen;
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [historyOffset, setHistoryOffset] = useState(0);
  const loadLock = useRef(false);
  const requestVersion = useRef(0);
  const readReceipts = useRef(new Set<string>());
  const scroller = useRef<HTMLDivElement>(null);
  const guestId = useRef("");
  const accountId = identity?.authenticated ? identity.accountId : guestId.current;
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!identity || loadLock.current) return;
    loadLock.current = true;
    const version = requestVersion.current;
    try {
      if (!identity.authenticated) {
        const guest = ensurePersonalGuestIdentity(); guestId.current = guest.accountId;
        setContacts(readPersonalGuestPeerContacts(guest)); setThreads(readPersonalGuestPeerThreads(guest));
        setOfficial(readPersonalGuestSupportThread(guest, readPersonalGuestProfile())); return;
      }
      const [inbox, support] = await Promise.allSettled([
        serviceRequest<Inbox>(`/api/merchant-peer-messages?siteId=${encodeURIComponent(identity.accountId)}`, { signal }),
        serviceRequest<{ thread?: PlatformSupportThread }>(`/api/support-messages?siteId=${encodeURIComponent(identity.accountId)}`, { signal }),
      ]);
      if (signal?.aborted || version !== requestVersion.current) return;
      if (inbox.status === "fulfilled") { setContacts(inbox.value.contacts ?? []); setThreads(current => mergeThreads(current, inbox.value.threads ?? [])); }
      if (support.status === "fulfilled") setOfficial(support.value.thread ?? null);
      if (inbox.status === "rejected" || support.status === "rejected") setError("部分会话读取失败，请刷新重试。");
    } finally { loadLock.current = false; if (!signal?.aborted && version === requestVersion.current) setLoading(false); }
  }, [identity]);
  useEffect(() => { ++requestVersion.current; readReceipts.current.clear(); setContacts([]); setThreads([]); setOfficial(null); setDraft(""); setError(""); }, [identity?.accountId]);
  useEffect(() => {
    if (!active || !identity) return;
    const controller = new AbortController(); setLoading(true);
    void load(controller.signal);
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(controller.signal); }, 15000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [active, identity, load]);
  const currentThread = threads.find(thread => (thread.merchantAId === selected && thread.merchantBId === accountId) || (thread.merchantBId === selected && thread.merchantAId === accountId));
  const messages = selected === "official" ? (official?.messages ?? []).map(message => ({ ...message, mine: message.sender === "merchant" }))
    : (currentThread?.messages ?? []).map(message => ({ ...message, mine: message.senderMerchantId === accountId }));
  const latestInboundAt = messages.filter(message => !message.mine).map(message => message.createdAt).sort().at(-1) || "";
  useEffect(() => {
    if (!active || !chatVisible || !identity?.authenticated || !latestInboundAt || document.visibilityState !== "visible") return;
    const key = `${identity.accountId}:${selected}:${latestInboundAt}`;
    if (readReceipts.current.has(key)) return;
    readReceipts.current.add(key);
    void serviceRequest(selected === "official" ? "/api/support-messages" : "/api/merchant-peer-messages", {
      method: "POST", body: JSON.stringify({ action: "mark_read", siteId: identity.accountId, lastReadAt: latestInboundAt,
        ...(selected !== "official" ? { contactMerchantId: selected } : {}) }),
    }).catch(() => { readReceipts.current.delete(key); });
  }, [active, chatVisible, identity?.authenticated, identity?.accountId, latestInboundAt, selected]);
  useEffect(() => { if (chatVisible) scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [selected, messages.length, chatVisible]);
  const send = async (text = draft) => {
    if (!text.trim() || busy || !identity) return;
    setBusy(true); setError("");
    try {
      if (!identity.authenticated) {
        if (selected === "official") appendPersonalGuestSupportMessage(text);
        else appendPersonalGuestPeerMessage({ recipientMerchantId: selected, recipientMerchantName: selected === siteId ? siteName : contacts.find(contact => contact.merchantId === selected)?.merchantName, text });
        setDraft(""); await load(); return;
      }
      const payload = selected === "official"
        ? { text, siteId: identity.accountId, merchantEmail: identity.profile.email, merchantName: identity.profile.nickname }
        : { action: "send", recipientMerchantId: selected, text, siteId: identity.accountId, merchantEmail: identity.profile.email, merchantName: identity.profile.nickname };
      const result = await serviceRequest<Inbox & { thread?: MerchantPeerThread | PlatformSupportThread }>(selected === "official" ? "/api/support-messages" : "/api/merchant-peer-messages", { method: "POST", body: JSON.stringify(payload) });
      if (selected === "official") setOfficial(result.thread as PlatformSupportThread ?? null);
      else { setContacts(result.contacts ?? contacts); setThreads(current => mergeThreads(current, result.threads ?? [])); }
      setDraft("");
    } catch { setError("发送结果暂时无法确认，请先刷新会话核对，避免重复发送。输入内容已保留。"); }
    finally { setBusy(false); }
  };
  const findContact = async () => {
    if (busy || !identity?.authenticated || !search.trim()) return;
    setBusy(true); setError("");
    try {
      const result = await serviceRequest<Inbox & { contact?: MerchantPeerContactSummary }>("/api/merchant-peer-messages", { method: "POST", body: JSON.stringify({ action: "ensure_contact",
        siteId: identity.accountId, contactAccountId: /^\d{8}$/.test(search.trim()) ? search.trim() : "", contactEmail: search.includes("@") ? search.trim() : "" }) });
      setContacts(result.contacts ?? contacts); setThreads(current => mergeThreads(current, result.threads ?? []));
      if (result.contact?.merchantId) { setSelected(result.contact.merchantId); setHistoryOffset(0); setMobileChatOpen(true); }
    } catch (error) { setError(error instanceof Error ? error.message : "未找到该账号。"); }
    finally { setBusy(false); }
  };
  const loadHistory = async () => {
    if (!identity?.authenticated || busy || selected === "official") return;
    setBusy(true); setError("");
    try {
      const result = await serviceRequest<Inbox>(`/api/merchant-peer-messages?contactMerchantId=${encodeURIComponent(selected)}&offset=${historyOffset}&limit=80`);
      if (result.thread) setThreads(current => mergeThreads(current, [result.thread!]));
      setHistoryOffset(result.messagePage?.hasMore ? historyOffset + 80 : -1);
    } catch { setError("历史消息读取失败。"); } finally { setBusy(false); }
  };
  const attach = async (file: File | undefined) => {
    if (!file || busy) return;
    if (file.size > 8 * 1024 * 1024) { setError("请选择不超过 8 MB 的文件。"); return; }
    setBusy(true); setError("");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
      const image = file.type.startsWith("image/");
      if (!identity?.authenticated) { if (image) setDraft(current => `${current}\n图片：${dataUrl}`.trim()); else setError("请先登录后发送文件。"); return; }
      const result = await serviceRequest<{ url: string }>("/api/assets/upload", { method: "POST", body: JSON.stringify({ dataUrl, merchantHint: identity.accountId,
        folder: image ? "merchant-assets" : "merchant-files", usage: image ? "support-image" : "support-file" }) });
      setDraft(current => `${current}\n${image ? "图片" : "文件"}：${result.url}`.trim());
    } catch { setError("附件上传失败，请重试。"); } finally { setBusy(false); }
  };
  const rows = [{ id: "official", name: "Faolla", contact: undefined as MerchantPeerContactSummary | undefined },
    { id: siteId, name: siteName || "本店", contact: contacts.find(contact => contact.merchantId === siteId) },
    ...contacts.filter(contact => contact.merchantId !== siteId).map(contact => ({ id: contact.merchantId, name: contact.merchantName || contact.merchantId, contact }))]
    .map(row => {
      const thread = threads.find(thread => (thread.merchantAId === row.id && thread.merchantBId === accountId) || (thread.merchantBId === row.id && thread.merchantAId === accountId));
      const lastMessage = row.id === "official" ? official?.messages.at(-1) : thread?.messages.at(-1) ?? row.contact?.lastMessage;
      return { ...row, image: safeLink(row.contact?.chatAvatarImageUrl || row.contact?.avatarImageUrl || ""),
        preview: formatSupportConversationPreview(lastMessage?.text) || "暂无消息", updatedAt: lastMessage?.createdAt || "" };
    });
  const selectedRow = rows.find(row => row.id === selected);
  return <div className="flex h-full min-h-0 flex-col gap-2" data-service-conversations>
    {!identity?.authenticated ? <p className="shrink-0 px-1 text-xs leading-5 text-slate-500">游客会话仅临时保存在本设备；登录后可同步账号消息。</p> : null}
    {error ? <p role="alert" className="shrink-0 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
    <div className="grid min-h-0 flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]">
      <aside aria-label="会话对象列表" className={`${mobileChatOpen ? "hidden" : "flex"} min-h-0 flex-col md:flex md:border-r md:border-slate-200`}>
        <div className="shrink-0 space-y-3 border-b border-slate-100 bg-slate-50/70 p-4">
          <div className="flex items-center justify-between gap-2"><div><h3 className="font-semibold">聊天列表</h3><p className="mt-1 text-xs text-slate-500">全部 {rows.length} 个会话</p></div>
            <button type="button" className={serviceButton + " !px-3 !py-2 !text-xs"} disabled={busy || loading} onClick={() => void load()}>刷新会话</button></div>
          {identity?.authenticated ? <form className="flex gap-2" onSubmit={event => { event.preventDefault(); void findContact(); }}><input className={serviceInput + " !rounded-full !text-xs"} aria-label="搜索会话账号" placeholder="8 位 ID / 邮箱" value={search} onChange={event => setSearch(event.target.value)} /><button className={serviceButton + " shrink-0 !px-3 !text-xs"} disabled={busy}>查找</button></form> : null}
        </div>
        <nav aria-label="选择会话" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
          {rows.map(row => <button key={row.id} type="button" data-conversation-id={row.id} aria-pressed={selected === row.id} disabled={busy}
            className={`flex w-full items-center gap-3 rounded-xl border-b border-slate-100 px-3 py-4 text-left transition focus-visible:outline-2 focus-visible:outline-teal-700 ${selected === row.id ? "bg-teal-50 md:ring-1 md:ring-inset md:ring-teal-200" : "hover:bg-slate-50"}`}
            onClick={() => { setSelected(row.id); setHistoryOffset(0); setMobileChatOpen(true); }}>
            <ConversationAvatar name={row.name} image={row.image} official={row.id === "official"} />
            <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span data-no-translate="1" className="truncate text-sm font-semibold">{row.name}</span>{row.id === "official" ? <span className="rounded-full bg-slate-900 px-1.5 py-0.5 text-[10px] text-white">官方</span> : null}<span className="ml-auto shrink-0 text-[10px] text-slate-500" data-no-translate="1">{row.updatedAt ? row.updatedAt.slice(5, 10).replace("-", "/") : ""}</span></span>
              <span className="mt-1 block truncate text-xs leading-5 text-slate-500" data-no-translate="1">{row.preview}</span></span>
          </button>)}
        </nav>
      </aside>
      <section aria-label="当前会话" className={`${mobileChatOpen ? "flex" : "hidden"} min-h-0 min-w-0 flex-col md:flex`}>
        <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 py-3 sm:px-4">
          <button type="button" className={serviceButton + " !px-3 md:hidden"} aria-label="返回会话列表" onClick={() => setMobileChatOpen(false)}>←</button>
          <ConversationAvatar name={selectedRow?.name || selected} image={selectedRow?.image} official={selected === "official"} />
          <div className="min-w-0"><h3 className="truncate text-sm font-semibold" data-no-translate="1">{selectedRow?.name || selected}</h3><p className="mt-1 text-xs text-slate-500">{selected === "official" ? "Faolla 官方服务" : "会话消息"}</p></div>
          <button type="button" className={serviceButton + " ml-auto shrink-0 !px-3"} aria-label="刷新当前会话" title="刷新当前会话" disabled={busy || loading} onClick={() => void load()}><svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 18 17" /></svg></button>
        </header>
        <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-slate-50/70 p-4" aria-label="聊天记录">
          {selected !== "official" && identity?.authenticated && historyOffset >= 0 ? <div className="text-center"><button type="button" className={serviceButton + " !rounded-full !py-1.5 !text-xs"} disabled={busy} onClick={() => void loadHistory()}>读取历史消息</button></div> : null}
          {loading ? <p role="status">正在读取会话…</p> : !messages.length ? <p className="py-8 text-center text-sm text-slate-500">暂无消息。</p> : null}
          {messages.map(message => { const attachment = parseSupportMessageAttachmentPreview(message.text); const link = attachment?.linkUrl ? safeLink(attachment.linkUrl) : "";
            return <div key={message.id} data-no-translate="1" className={`flex ${message.mine ? "justify-end" : "justify-start"}`}><div className={`max-w-[85%] break-words rounded-2xl px-4 py-3 text-sm ${message.mine ? "rounded-tr-sm bg-teal-100" : "rounded-tl-sm border border-slate-200 bg-white"}`}>
              {attachment?.imageUrl ? <img src={attachment.imageUrl} alt="会话图片" loading="lazy" className="max-h-60 max-w-full rounded-xl object-contain" /> : <p className="whitespace-pre-wrap">{message.text}</p>}
              {link ? <a href={link} target="_blank" rel="noreferrer" className="underline">打开链接</a> : null}
              <p className="mt-1 text-[10px] text-slate-500">{message.createdAt.replace("T", " ").slice(0, 19)}</p>
            </div></div>; })}
        </div>
        <form className="shrink-0 space-y-2 border-t border-slate-200 bg-white p-3" onSubmit={event => { event.preventDefault(); void send(); }}><textarea className={serviceInput + " block h-16 resize-none"} aria-label="输入消息" placeholder="输入消息…" maxLength={5000} value={draft} onChange={event => setDraft(event.target.value)} />
          <div className="flex items-center justify-between gap-2"><label className={serviceButton + " cursor-pointer focus-within:outline-2 focus-within:outline-teal-700"}>图片 / 文件<input aria-label="图片 / 文件" type="file" className="sr-only" disabled={busy} onChange={event => { void attach(event.target.files?.[0]); event.target.value = ""; }} /></label>
            <button type="submit" className={serviceButton + " !border-teal-700 !bg-teal-700 !px-5 !text-white hover:!bg-teal-800"} disabled={busy || !draft.trim()}>{busy ? "处理中…" : "发送"}</button></div></form>
      </section>
    </div>
  </div>;
}
