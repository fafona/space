"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MerchantBusinessApiClient } from "@/lib/merchantBusinessApiClient";
import { getMerchantConversationFrontendAccess } from "@/lib/merchantConversationFrontendAccess";
import GuestChatPanel from "@/components/service-center/GuestChatPanel";
import { useMerchantGuestInbox } from "@/components/service-center/useMerchantGuestInbox";
import MerchantGuestInboxStatus from "@/components/service-center/MerchantGuestInboxStatus";
import GuestAvatar from "@/components/service-center/GuestAvatar";
import { useI18n } from "@/components/I18nProvider";
import { ChatTranslationProvider, ChatTranslationToggle, TranslatedChatText } from "@/components/support/ChatTranslation";
import { guestConversationId, mergeMerchantConversations } from "@/lib/merchantConversationList";
import type {
  MerchantPeerContactSummary,
  MerchantPeerMessage,
  MerchantPeerThread,
} from "@/lib/merchantPeerInbox";
import type { MerchantStaffBusinessPermission } from "@/lib/merchantStaffBusiness";

type MerchantEmployeeConversationPanelProps = {
  siteId: string;
  apiClient: MerchantBusinessApiClient;
  permissions: readonly MerchantStaffBusinessPermission[];
  onAuthorizationInvalid?: () => void;
};

type PeerSearchResult = {
  merchantId: string;
  merchantName: string;
  accountType?: "merchant" | "personal";
};

type InboxResponse = {
  ok?: boolean;
  error?: string;
  message?: string;
  currentMerchantId?: string;
  contacts?: unknown[];
  threads?: unknown[];
  readState?: { peerLastRead?: Record<string, unknown> };
  contact?: unknown;
  thread?: unknown;
};

const ACCOUNT_ID_PATTERN = /^\d{8}$/;

function text(value: unknown, maxLength = 5000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function iso(value: unknown) {
  const normalized = text(value, 64);
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function normalizePeerMessage(value: unknown): MerchantPeerMessage | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = text(record.id, 160);
  const senderMerchantId = text(record.senderMerchantId, 8);
  const messageText = text(record.text, 5000);
  const createdAt = iso(record.createdAt);
  if (!id || !ACCOUNT_ID_PATTERN.test(senderMerchantId) || !messageText || !createdAt) {
    return null;
  }
  return { id, senderMerchantId, text: messageText, createdAt };
}

function normalizePeerContact(value: unknown): MerchantPeerContactSummary | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const merchantId = text(record.merchantId, 8);
  const merchantName = text(record.merchantName, 160) || merchantId;
  const savedAt = iso(record.savedAt);
  const updatedAt = iso(record.updatedAt);
  if (!ACCOUNT_ID_PATTERN.test(merchantId) || !savedAt || !updatedAt) return null;
  const lastMessage = record.lastMessage
    ? normalizePeerMessage(record.lastMessage)
    : null;
  const accountType =
    record.accountType === "merchant" || record.accountType === "personal"
      ? record.accountType
      : undefined;
  return {
    merchantId,
    merchantName,
    merchantEmail: "",
    ...(accountType ? { accountType } : {}),
    savedAt,
    updatedAt,
    lastMessage,
  };
}

function normalizePeerThread(value: unknown): MerchantPeerThread | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const merchantAId = text(record.merchantAId, 8);
  const merchantBId = text(record.merchantBId, 8);
  const threadKey = text(record.threadKey, 32);
  const updatedAt = iso(record.updatedAt);
  if (
    !ACCOUNT_ID_PATTERN.test(merchantAId) ||
    !ACCOUNT_ID_PATTERN.test(merchantBId) ||
    merchantAId === merchantBId ||
    !threadKey ||
    !updatedAt
  ) {
    return null;
  }
  const messages = Array.isArray(record.messages)
    ? record.messages
        .map(normalizePeerMessage)
        .filter((message): message is MerchantPeerMessage => Boolean(message))
        .slice(-200)
    : [];
  return {
    threadKey,
    merchantAId,
    merchantAName: text(record.merchantAName, 160) || merchantAId,
    merchantAEmail: "",
    merchantBId,
    merchantBName: text(record.merchantBName, 160) || merchantBId,
    merchantBEmail: "",
    updatedAt,
    messages,
  };
}

function normalizeSearchResult(value: unknown): PeerSearchResult | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const merchantId = text(record.merchantId, 8);
  if (!ACCOUNT_ID_PATTERN.test(merchantId)) return null;
  const accountType =
    record.accountType === "merchant" || record.accountType === "personal"
      ? record.accountType
      : undefined;
  return {
    merchantId,
    merchantName: text(record.merchantName, 160) || merchantId,
    ...(accountType ? { accountType } : {}),
  };
}

function normalizeReadState(value: InboxResponse["readState"]) {
  if (!value?.peerLastRead || typeof value.peerLastRead !== "object") {
    return {} as Record<string, string>;
  }
  return Object.fromEntries(
    Object.entries(value.peerLastRead)
      .map(([accountId, timestamp]) => [accountId, iso(timestamp)] as const)
      .filter(
        ([accountId, timestamp]) =>
          ACCOUNT_ID_PATTERN.test(accountId) && Boolean(timestamp),
      ),
  );
}
function formatDateTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function responseError(payload: InboxResponse | null, fallback: string) {
  return text(payload?.message, 300) || text(payload?.error, 120) || fallback;
}

function isUnread(
  contact: MerchantPeerContactSummary,
  currentMerchantId: string,
  peerLastRead: Record<string, string>,
) {
  const latest = contact.lastMessage;
  if (!latest || latest.senderMerchantId === currentMerchantId) return false;
  const latestTimestamp = Date.parse(latest.createdAt);
  const readTimestamp = Date.parse(peerLastRead[contact.merchantId] ?? "");
  return Number.isFinite(latestTimestamp) &&
    (!Number.isFinite(readTimestamp) || latestTimestamp > readTimestamp);
}

export default function MerchantEmployeeConversationPanel({
  siteId,
  apiClient,
  permissions,
  onAuthorizationInvalid,
}: MerchantEmployeeConversationPanelProps) {
  const { locale } = useI18n();
  const [translationEnabled,setTranslationEnabled]=useState(true);
  const access = useMemo(
    () => getMerchantConversationFrontendAccess(permissions),
    [permissions],
  );
  const [contacts, setContacts] = useState<MerchantPeerContactSummary[]>([]);
  const [threads, setThreads] = useState<MerchantPeerThread[]>([]);
  const [currentMerchantId, setCurrentMerchantId] = useState(siteId);
  const [peerLastRead, setPeerLastRead] = useState<Record<string, string>>({});
  const [selectedContactId, setSelectedContactId] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [searchResult, setSearchResult] = useState<PeerSearchResult | null>(null);
  const [draft, setDraft] = useState("");
  const [selectedGuestId, setSelectedGuestId] = useState("");
  const [mobileThread, setMobileThread] = useState(false);
  const [mobile, setMobile] = useState(false);
  const guestInbox = useMerchantGuestInbox({ siteId, active: access.view, apiClient, onAuthorizationInvalid });
  const requestGenerationRef = useRef(0);
  const busyRef = useRef(false);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const sync = () => setMobile(query.matches);
    sync(); query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  useEffect(() => { setSelectedGuestId(""); setMobileThread(false); setDraft(""); }, [siteId, apiClient]);

  const requestJson = useCallback(
    async (path: string, init?: RequestInit) => {
      const response = await apiClient(path, init);
      const payload = (await response.json().catch(() => null)) as InboxResponse | null;
      if (!response.ok || !payload?.ok) {
        if (response.status === 401 || response.status === 403) {
          onAuthorizationInvalid?.();
        }
        throw new Error(responseError(payload, "会话请求失败，请稍后重试。"));
      }
      return payload;
    },
    [apiClient, onAuthorizationInvalid],
  );

  const applyInbox = useCallback((payload: InboxResponse) => {
    const nextContacts = Array.isArray(payload.contacts)
      ? payload.contacts
          .map(normalizePeerContact)
          .filter((contact): contact is MerchantPeerContactSummary => Boolean(contact))
      : [];
    const nextThreads = Array.isArray(payload.threads)
      ? payload.threads
          .map(normalizePeerThread)
          .filter((thread): thread is MerchantPeerThread => Boolean(thread))
      : [];
    const nextCurrentMerchantId = text(payload.currentMerchantId, 8);
    setContacts(nextContacts);
    setThreads(nextThreads);
    if (ACCOUNT_ID_PATTERN.test(nextCurrentMerchantId)) {
      setCurrentMerchantId(nextCurrentMerchantId);
    }
    setPeerLastRead(normalizeReadState(payload.readState));
    setSelectedContactId((current) =>
      nextContacts.some((contact) => contact.merchantId === current)
        ? current
        : nextContacts[0]?.merchantId ?? "",
    );
  }, []);

  const refreshInbox = useCallback(async () => {
    if (!access.view) return;
    const generation = ++requestGenerationRef.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ siteId });
      const payload = await requestJson(
        `/api/merchant-peer-messages?${params.toString()}`,
      );
      if (generation === requestGenerationRef.current) applyInbox(payload);
    } catch (requestError) {
      if (generation === requestGenerationRef.current) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "会话加载失败，请稍后重试。",
        );
      }
    } finally {
      if (generation === requestGenerationRef.current) setLoading(false);
    }
  }, [access.view, applyInbox, requestJson, siteId]);

  useEffect(() => {
    if (!access.view) {
      requestGenerationRef.current += 1;
      setContacts([]);
      setThreads([]);
      setSelectedContactId("");
      return;
    }
    void refreshInbox();
    // Replacing the refresh control must not leave account messages frozen.
    // Keep the same visible-only cadence as guest conversations; never replay
    // a send, and invalidate pre-send reads before applying a write response.
    const resume = () => { if (document.visibilityState === "visible" && !busyRef.current) void refreshInbox(); };
    const interval = setInterval(resume, 15000);
    document.addEventListener("visibilitychange", resume);
    return () => {
      requestGenerationRef.current += 1;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [access.view, refreshInbox]);

  useEffect(() => {
    if (!access.search) {
      setQuery("");
      setSearchResult(null);
    }
  }, [access.search]);

  const activeContact = contacts.find(
    (contact) => contact.merchantId === selectedContactId,
  );
  const activeThread = threads.find(
    (thread) =>
      (thread.merchantAId === currentMerchantId &&
        thread.merchantBId === selectedContactId) ||
      (thread.merchantBId === currentMerchantId &&
        thread.merchantAId === selectedContactId),
  );
  const conversationRows = mergeMerchantConversations(contacts.map(contact => ({
    key: `merchant:${contact.merchantId}`, name: contact.merchantName,
    unreadCount: isUnread(contact, currentMerchantId, peerLastRead) ? 1 : 0,
    subtitle: `账号 ${contact.merchantId}`, preview: contact.lastMessage?.text || "暂无消息。",
    updatedAt: contact.updatedAt, unread: isUnread(contact, currentMerchantId, peerLastRead),
    avatarLabel: (contact.merchantName || contact.merchantId).slice(0, 1), isOfficial: false,
  })), guestInbox.threads, locale);

  useEffect(() => {
    if (selectedGuestId || mobile && !mobileThread) return;
    const latestIncoming = [...(activeThread?.messages ?? [])]
      .reverse()
      .find((message) => message.senderMerchantId !== currentMerchantId);
    if (!activeContact || !latestIncoming) return;
    const currentReadTimestamp = Date.parse(
      peerLastRead[activeContact.merchantId] ?? "",
    );
    const latestTimestamp = Date.parse(latestIncoming.createdAt);
    if (
      Number.isFinite(currentReadTimestamp) &&
      Number.isFinite(latestTimestamp) &&
      currentReadTimestamp >= latestTimestamp
    ) {
      return;
    }
    let cancelled = false;
    void requestJson("/api/merchant-peer-messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "mark_read",
        siteId,
        contactMerchantId: activeContact.merchantId,
        lastReadAt: latestIncoming.createdAt,
      }),
    })
      .then((payload) => {
        if (!cancelled) setPeerLastRead(normalizeReadState(payload.readState));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [
    activeContact,
    activeThread,
    currentMerchantId,
    peerLastRead,
    requestJson,
    siteId,
    selectedGuestId,
    mobile,
    mobileThread,
  ]);

  async function searchPeer() {
    if (!access.search || !query.trim() || busy) return;
    setBusy(true);
    setError("");
    setSearchResult(null);
    try {
      const payload = await requestJson("/api/merchant-peer-messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "lookup", siteId, query: query.trim() }),
      });
      const result = normalizeSearchResult(payload.contact);
      if (!result) throw new Error("搜索结果无效，请稍后重试。");
      setSearchResult(result);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "搜索失败，请稍后重试。",
      );
    } finally {
      setBusy(false);
    }
  }

  async function startConversation() {
    if (!access.start || !searchResult || busy) return;
    requestGenerationRef.current += 1;
    setBusy(true);
    setError("");
    try {
      const payload = await requestJson("/api/merchant-peer-messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "ensure_contact",
          siteId,
          contactAccountId: searchResult.merchantId,
          contactAccountType: searchResult.accountType,
        }),
      });
      applyInbox(payload);
      setSelectedContactId(searchResult.merchantId);
      setSelectedGuestId(""); setMobileThread(true);
      setQuery("");
      setSearchResult(null);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "发起会话失败，请稍后重试。",
      );
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage() {
    if (selectedGuestId) return;
    const nextText = draft.trim();
    if (!access.send || !activeContact || !nextText || busy) return;
    requestGenerationRef.current += 1;
    setBusy(true);
    setError("");
    try {
      const payload = await requestJson("/api/merchant-peer-messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "send",
          siteId,
          recipientMerchantId: activeContact.merchantId,
          text: nextText.slice(0, 5000),
        }),
      });
      applyInbox(payload);
      setSelectedContactId(activeContact.merchantId);
      setDraft("");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "消息发送失败，请稍后重试。",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!access.view) {
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        当前角色没有查看会话的权限。
      </section>
    );
  }

  return (
    <ChatTranslationProvider scope={`${siteId}:${selectedGuestId||selectedContactId}`} enabled={translationEnabled} active={access.view}><section data-merchant-conversations className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <header className={`${mobileThread ? "hidden md:flex" : "flex"} flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4`}>
        <div>
          <h2 className="text-lg font-semibold text-slate-950">会话</h2>
          <p className="mt-1 text-xs text-slate-500">
            客户、商户和游客消息统一显示；Faolla 官方支持会话不会显示在员工工作台。
          </p>
        </div>
        <ChatTranslationToggle enabled={translationEnabled} onChange={setTranslationEnabled}/>
      </header>

      {access.search ? (
        <div className={`${mobileThread ? "hidden md:block" : ""} border-b border-slate-200 bg-slate-50 px-5 py-3`}>
          <div className="flex flex-wrap gap-2">
            <label htmlFor="employee-conversation-search" className="sr-only">
              精确搜索账号 ID 或邮箱
            </label>
            <input
              id="employee-conversation-search"
              className="min-w-56 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
              placeholder="输入完整的 8 位账号 ID 或邮箱"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value.slice(0, 320));
                setSearchResult(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") void searchPeer();
              }}
            />
            <button
              type="button"
              className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
              disabled={busy || !query.trim()}
              onClick={() => void searchPeer()}
            >
              精确搜索
            </button>
          </div>
          {searchResult ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900">
                  {searchResult.merchantName}
                </div>
                <div className="text-xs text-slate-500">账号 {searchResult.merchantId}</div>
              </div>
              {access.start ? (
                <button
                  type="button"
                  className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-45"
                  disabled={busy}
                  onClick={() => void startConversation()}
                >
                  发起会话
                </button>
              ) : (
                <span className="text-xs text-slate-500">没有发起会话权限</span>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="border-b border-rose-100 bg-rose-50 px-5 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid h-[min(720px,80dvh)] min-h-[420px] md:grid-cols-[280px_minmax(0,1fr)]">
        <aside aria-label="会话对象列表" className={`${mobileThread ? "hidden md:flex" : "flex"} min-h-0 flex-col border-b border-slate-200 md:border-b-0 md:border-r`}>
          <div className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            聊天列表 {conversationRows.length}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {conversationRows.length === 0 && !loading && !guestInbox.loading ? (
              <div className="px-4 py-8 text-center text-sm text-slate-500">
                暂无会话。
              </div>
            ) : null}
            {conversationRows.map((contact) => {
              const unread = contact.unread;
              const selected = selectedGuestId ? guestConversationId(contact.key) === selectedGuestId : contact.key === `merchant:${selectedContactId}`;
              return (
                <button
                  key={contact.key}
                  data-conversation-id={contact.key}
                  type="button"
                  className={`flex w-full items-start gap-3 border-t border-slate-100 px-4 py-3 text-left ${
                    selected ? "bg-blue-50" : "hover:bg-slate-50"
                  }`}
                  onClick={() => { const id = guestConversationId(contact.key); setSelectedGuestId(id); if (!id) setSelectedContactId(contact.key.slice("merchant:".length)); setMobileThread(true); }}
                >
                  {contact.guestNumber?<GuestAvatar className="h-9 w-9"/>:<span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-bold text-white">
                    {contact.avatarLabel}
                  </span>}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-slate-900">
                        <span data-no-translate="1">{contact.name}</span>
                      </span>
                      {unread ? (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-blue-600" aria-label="有新消息" />
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-slate-500">
                      <span data-no-translate="1">{contact.preview}</span>
                    </span>
                  </span>
                </button>
              );
            })}
            <MerchantGuestInboxStatus inbox={guestInbox} />
          </div>
        </aside>

        <div className={selectedGuestId ? `${mobileThread ? "flex" : "hidden md:flex"} min-h-0 min-w-0 flex-col` : "hidden"}>
          <GuestChatPanel key={siteId} siteId={siteId} merchant active={!!selectedGuestId && (!mobile || mobileThread)}
            conversationId={selectedGuestId} inboxThread={guestInbox.threads.find(thread => thread.id === selectedGuestId)}
            apiClient={apiClient} canSend={access.send} onAuthorizationInvalid={onAuthorizationInvalid}
            onThreadUpdated={guestInbox.updateThread} onBack={() => setMobileThread(false)} />
        </div>
        <div className={selectedGuestId ? "hidden" : `${mobileThread ? "flex" : "hidden md:flex"} min-h-0 min-w-0 flex-col`}>
          {activeContact ? (
            <>
              <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-3">
                <button type="button" className="rounded-xl border px-3 py-2 md:hidden" aria-label="返回会话列表" onClick={() => setMobileThread(false)}>←</button>
                <div>
                <div className="font-semibold text-slate-950">{activeContact.merchantName}</div>
                <div className="text-xs text-slate-500">账号 {activeContact.merchantId}</div>
                </div>
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50/60 px-4 py-5">
                {(activeThread?.messages ?? []).length === 0 ? (
                  <div className="py-10 text-center text-sm text-slate-500">
                    暂无消息。
                  </div>
                ) : null}
                {(activeThread?.messages ?? []).map((message) => {
                  const mine = message.senderMerchantId === currentMerchantId;
                  return (
                    <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[82%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                          mine
                            ? "bg-slate-950 text-white"
                            : "border border-slate-200 bg-white text-slate-800"
                        }`}
                      >
                        <div className="whitespace-pre-wrap break-words"><TranslatedChatText value={message.text}/></div>
                        <div className={`mt-1 text-[10px] ${mine ? "text-slate-300" : "text-slate-400"}`}>
                          {formatDateTime(message.createdAt)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-slate-200 p-4">
                {access.send ? (
                  <div className="flex items-end gap-2">
                    <label htmlFor="employee-conversation-message" className="sr-only">
                      消息内容
                    </label>
                    <textarea
                      id="employee-conversation-message"
                      rows={2}
                      maxLength={5000}
                      className="min-h-12 flex-1 resize-y rounded-xl border border-slate-300 px-3 py-2 text-sm"
                      placeholder="输入文字消息"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          void sendMessage();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-45"
                      disabled={busy || !draft.trim()}
                      onClick={() => void sendMessage()}
                    >
                      发送
                    </button>
                  </div>
                ) : (
                  <div className="text-center text-xs text-slate-500">
                    当前角色只能查看会话，不能发送消息。
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="grid flex-1 place-items-center p-8 text-sm text-slate-500">
              请选择一个会话。
            </div>
          )}
        </div>
      </div>
    </section></ChatTranslationProvider>
  );
}
