"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MerchantPeerContactSummary, MerchantPeerThread } from "@/lib/merchantPeerInbox";
import type { PlatformSupportThread } from "@/lib/platformSupportInbox";
import { ensurePersonalGuestIdentity, readPersonalGuestProfile, readPersonalGuestPeerContacts, readPersonalGuestPeerThreads,
  readPersonalGuestSupportThread, appendPersonalGuestPeerMessage, appendPersonalGuestSupportMessage } from "@/lib/personalGuestSession";
import { parseSupportMessageAttachmentPreview, formatSupportConversationPreview } from "@/lib/supportMessageAttachments";
import { serviceButton, serviceCard, serviceInput, serviceRequest, type ServicePanelProps } from "./serviceCenterClient";

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
const safeLink = (value: string) => { try { const url = new URL(value, window.location.origin); return /^https?:$/.test(url.protocol) ? url.href : ""; } catch { return ""; } };

export default function ServiceConversations({ active, identity, siteId, siteName }: ServicePanelProps) {
  const [contacts, setContacts] = useState<MerchantPeerContactSummary[]>([]);
  const [threads, setThreads] = useState<MerchantPeerThread[]>([]);
  const [official, setOfficial] = useState<PlatformSupportThread | null>(null);
  const [selected, setSelected] = useState(siteId);
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
    if (!active || !identity?.authenticated || !latestInboundAt || document.visibilityState !== "visible") return;
    const key = `${identity.accountId}:${selected}:${latestInboundAt}`;
    if (readReceipts.current.has(key)) return;
    readReceipts.current.add(key);
    void serviceRequest(selected === "official" ? "/api/support-messages" : "/api/merchant-peer-messages", {
      method: "POST", body: JSON.stringify({ action: "mark_read", siteId: identity.accountId, lastReadAt: latestInboundAt,
        ...(selected !== "official" ? { contactMerchantId: selected } : {}) }),
    }).catch(() => { readReceipts.current.delete(key); });
  }, [active, identity?.authenticated, identity?.accountId, latestInboundAt, selected]);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [selected, messages.length]);
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
      if (result.contact?.merchantId) setSelected(result.contact.merchantId);
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
  const rows = [{ id: siteId, name: siteName || "本店" }, ...contacts.filter(contact => contact.merchantId !== siteId).map(contact => ({ id: contact.merchantId, name: contact.merchantName || contact.merchantId })), { id: "official", name: "Faolla 官方" }];
  return <div className="space-y-3" data-service-conversations>
    {!identity?.authenticated ? <p className="text-xs text-slate-500">游客会话仅临时保存在本设备；登录后可同步账号消息。</p> : null}
    <div className="flex gap-2"><select data-no-translate="1" aria-label="选择会话" className={serviceInput} value={selected} onChange={event => { setSelected(event.target.value); setHistoryOffset(0); }}>{rows.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
      <button type="button" className={serviceButton + " shrink-0"} disabled={busy || loading} onClick={() => void load()}>刷新会话</button></div>
    {identity?.authenticated ? <form className="flex gap-2" onSubmit={event => { event.preventDefault(); void findContact(); }}><input className={serviceInput} aria-label="搜索会话账号" placeholder="商户或个人 8 位 ID / 邮箱" value={search} onChange={event => setSearch(event.target.value)} /><button className={serviceButton + " shrink-0"} disabled={busy}>查找</button></form> : null}
    {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
    <div ref={scroller} className={serviceCard + " h-[min(36dvh,380px)] min-h-40 space-y-3 overflow-y-auto overscroll-contain"} aria-label="聊天记录">
      {selected !== "official" && identity?.authenticated && historyOffset >= 0 ? <button type="button" className={serviceButton} disabled={busy} onClick={() => void loadHistory()}>读取历史消息</button> : null}
      {loading ? <p role="status">正在读取会话…</p> : !messages.length ? <p className="py-8 text-center text-sm text-slate-500">暂无消息。</p> : null}
      {messages.map(message => { const attachment = parseSupportMessageAttachmentPreview(message.text); const link = attachment?.linkUrl ? safeLink(attachment.linkUrl) : "";
        return <div key={message.id} data-no-translate="1" className={`flex ${message.mine ? "justify-end" : "justify-start"}`}><div className={`max-w-[85%] break-words rounded-2xl px-4 py-3 text-sm ${message.mine ? "bg-sky-100" : "bg-slate-100"}`}>
          {attachment?.imageUrl ? <img src={attachment.imageUrl} alt="会话图片" loading="lazy" className="max-h-60 max-w-full rounded-xl object-contain" /> : <p className="whitespace-pre-wrap">{message.text}</p>}
          {link ? <a href={link} target="_blank" rel="noreferrer" className="underline">打开链接</a> : null}
          <p className="mt-1 text-[10px] text-slate-500">{message.createdAt.replace("T", " ").slice(0, 19)}</p>
        </div></div>; })}
    </div>
    <form className="space-y-2" onSubmit={event => { event.preventDefault(); void send(); }}><textarea className={serviceInput + " min-h-20 resize-y"} aria-label="输入消息" placeholder="输入消息…" maxLength={5000} value={draft} onChange={event => setDraft(event.target.value)} />
      <div className="flex items-center justify-between gap-2"><label className={serviceButton + " cursor-pointer"}>图片 / 文件<input type="file" className="sr-only" disabled={busy} onChange={event => { void attach(event.target.files?.[0]); event.target.value = ""; }} /></label>
        <button type="submit" className={serviceButton + " !bg-slate-950 !text-white"} disabled={busy || !draft.trim()}>{busy ? "处理中…" : "发送"}</button></div></form>
    <p className="sr-only" data-no-translate="1">{formatSupportConversationPreview(messages[messages.length - 1]?.text)}</p>
  </div>;
}
