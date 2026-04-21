"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { readMerchantSessionMerchantIds } from "@/lib/authSessionRecovery";
import SupportMessageContent from "@/components/support/SupportMessageContent";
import {
  findMerchantPeerThreadForMerchants,
  type MerchantPeerContactSummary,
  type MerchantPeerThread,
} from "@/lib/merchantPeerInbox";
import { type PlatformSupportMessage, type PlatformSupportThread } from "@/lib/platformSupportInbox";
import { formatSupportConversationPreview } from "@/lib/supportMessageAttachments";

type MeSessionPayload = {
  authenticated?: unknown;
  accountType?: unknown;
  accountId?: unknown;
  merchantId?: unknown;
  merchantIds?: unknown;
  user?: {
    email?: string | null;
    user_metadata?: Record<string, unknown> | null;
    app_metadata?: Record<string, unknown> | null;
  } | null;
};

type DesktopSection = "conversations" | "bookings" | "orders" | "favorites" | "cards" | "profile";
type MobileTab = "conversations" | "consumption" | "faolla" | "self";
type ConsumptionSection = "bookings" | "orders";
type MobileConversationView = "list" | "thread";

type MenuItem = {
  key: DesktopSection;
  label: string;
  description: string;
  badge?: string;
};

type SupportResponsePayload = {
  ok?: unknown;
  error?: unknown;
  message?: unknown;
  thread?: PlatformSupportThread | null;
};

type MerchantPeerResponsePayload = {
  ok?: unknown;
  error?: unknown;
  message?: unknown;
  contact?: {
    merchantId?: unknown;
    merchantName?: unknown;
    merchantEmail?: unknown;
  } | null;
  contacts?: MerchantPeerContactSummary[];
  threads?: MerchantPeerThread[];
};

type PersonalConversationKey = "official" | `merchant:${string}`;

type PersonalVisibleSupportMessage = Pick<PlatformSupportMessage, "id" | "text" | "createdAt"> & {
  isSelf: boolean;
  senderLabel: string;
};

const OFFICIAL_CONVERSATION_KEY: PersonalConversationKey = "official";

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readPayloadMessage(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readDisplayName(payload: MeSessionPayload | null) {
  const userMetadata = payload?.user?.user_metadata ?? null;
  const appMetadata = payload?.user?.app_metadata ?? null;
  for (const source of [userMetadata, appMetadata]) {
    if (!source || typeof source !== "object") continue;
    for (const key of ["display_name", "displayName", "username", "name"]) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return "";
}

function getInitialLabel(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "我";
  const first = Array.from(trimmed)[0] ?? "我";
  return first.toUpperCase();
}

function normalizeSupportMessageTimestamp(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function compareSupportMessages(left: Pick<PersonalVisibleSupportMessage, "createdAt" | "id">, right: Pick<PersonalVisibleSupportMessage, "createdAt" | "id">) {
  const leftTs = new Date(normalizeSupportMessageTimestamp(left.createdAt) || left.createdAt).getTime();
  const rightTs = new Date(normalizeSupportMessageTimestamp(right.createdAt) || right.createdAt).getTime();
  if (leftTs !== rightTs) return leftTs - rightTs;
  return left.id.localeCompare(right.id, "en");
}

function formatSupportClockTime(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "-";
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleTimeString("zh-CN", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
      })
    : normalized;
}

function formatSupportConversationTime(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "-";
  const date = new Date(normalized);
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) return normalized;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfTarget = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - startOfTarget) / 86400000);

  if (dayDiff === 0) return formatSupportClockTime(normalized);
  if (dayDiff === 1) return "昨天";
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString("zh-CN", {
      month: "numeric",
      day: "numeric",
    });
  }
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
}

function formatSupportThreadDateLabel(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  const date = new Date(normalized);
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) return normalized;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfTarget = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - startOfTarget) / 86400000);

  if (dayDiff === 0) return "今天";
  if (dayDiff === 1) return "昨天";
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString("zh-CN", {
      month: "long",
      day: "numeric",
    });
  }
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function isSameSupportCalendarDay(left: string | null | undefined, right: string | null | undefined) {
  const leftDate = new Date(String(left ?? "").trim());
  const rightDate = new Date(String(right ?? "").trim());
  if (!Number.isFinite(leftDate.getTime()) || !Number.isFinite(rightDate.getTime())) return false;
  return (
    leftDate.getFullYear() === rightDate.getFullYear() &&
    leftDate.getMonth() === rightDate.getMonth() &&
    leftDate.getDate() === rightDate.getDate()
  );
}

function Icon({ name }: { name: "chat" | "shop" | "shield" | "user" | "calendar" | "order" | "star" | "card" }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      {name === "chat" ? (
        <path
          d="M5 7.5A2.5 2.5 0 0 1 7.5 5h9A2.5 2.5 0 0 1 19 7.5v6A2.5 2.5 0 0 1 16.5 16H10l-4 3v-3.2A2.8 2.8 0 0 1 3.5 13V7.5A2.5 2.5 0 0 1 6 5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {name === "shop" ? (
        <path
          d="M4 10.5 12 5l8 5.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18v-7.5ZM9 19.5v-5h6v5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {name === "shield" ? (
        <path
          d="M12 4 5.8 6.4v5.8c0 3.7 2.7 6.7 6.2 7.4 3.5-.7 6.2-3.7 6.2-7.4V6.4L12 4Zm0 4.1v4.4m0 0 2.3 2.2M12 12.5 9.7 14.7"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {name === "user" ? (
        <>
          <circle cx="12" cy="8.5" r="3.2" stroke="currentColor" strokeWidth="1.8" />
          <path d="M6.2 18.2a5.8 5.8 0 0 1 11.6 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </>
      ) : null}
      {name === "calendar" ? (
        <>
          <path d="M7 4.5v3M17 4.5v3M5.5 9h13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <rect x="4.5" y="6" width="15" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
        </>
      ) : null}
      {name === "order" ? (
        <>
          <path d="M7 6.5h10M7 11h10M7 15.5h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <rect x="4.5" y="3.5" width="15" height="17" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
        </>
      ) : null}
      {name === "star" ? (
        <path
          d="m12 4.4 2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7L12 4.4Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {name === "card" ? (
        <>
          <rect x="4" y="6" width="16" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M7.5 10h5M7.5 14h8.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </>
      ) : null}
    </svg>
  );
}

function EmptyFeatureCard({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_18px_44px_rgba(15,23,42,0.06)]">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-sm">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-lg font-semibold text-slate-950">{title}</div>
          <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
          {action ? <div className="mt-5">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}

function PersonalInfoPanel({
  accountId,
  displayName,
  email,
}: {
  accountId: string;
  displayName: string;
  email: string;
}) {
  const items = [
    { label: "个人 ID", value: accountId || "-" },
    { label: "昵称", value: displayName || "-" },
    { label: "邮箱", value: email || "-" },
  ];

  return (
    <div className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_18px_44px_rgba(15,23,42,0.06)] md:p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-slate-950">个人信息</div>
          <div className="mt-1 text-sm text-slate-500">这里显示当前个人账号的基础资料。</div>
        </div>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {items.map((item) => (
          <div key={item.label} className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="text-xs text-slate-500">{item.label}</div>
            <div className="mt-2 break-all text-base font-semibold text-slate-950">{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DesktopMenuButton({
  active,
  item,
  onClick,
}: {
  active: boolean;
  item: MenuItem;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-sm font-semibold transition ${
        active
          ? "border-slate-950 bg-slate-950 text-white shadow-[0_12px_28px_rgba(15,23,42,0.16)]"
          : "border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50"
      }`}
      onClick={onClick}
    >
      <span>{item.label}</span>
      {item.badge ? (
        <span className="inline-flex min-w-[1.45rem] items-center justify-center rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-semibold leading-none text-white">
          {item.badge}
        </span>
      ) : null}
    </button>
  );
}

function MobileBottomNav({
  activeTab,
  onChange,
}: {
  activeTab: MobileTab;
  onChange: (tab: MobileTab) => void;
}) {
  const items: Array<{ key: MobileTab; label: string; icon: ReactNode }> = [
    { key: "conversations", label: "会话", icon: <Icon name="chat" /> },
    { key: "consumption", label: "消费", icon: <Icon name="shop" /> },
    { key: "faolla", label: "Faolla", icon: <Icon name="shield" /> },
    { key: "self", label: "自己", icon: <Icon name="user" /> },
  ];

  return (
    <div className="support-mobile-nav-shell pointer-events-none fixed bottom-0 left-1/2 z-[2147483298] w-full max-w-md -translate-x-1/2 overscroll-none touch-none transition duration-200 md:hidden">
      <div
        className="pointer-events-auto relative px-4 pt-3 touch-manipulation"
        style={{ paddingBottom: "calc((env(safe-area-inset-bottom) / 2) + 0.03rem)" }}
      >
        <div className="flex items-center gap-1 rounded-[28px] border border-slate-200/80 bg-white/95 px-1.5 py-1.5 shadow-[0_18px_36px_rgba(15,23,42,0.12)] backdrop-blur">
          {items.map((item) => {
            const active = activeTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[22px] px-2 py-1.5 text-[10.5px] font-medium transition ${
                  active ? "bg-slate-900 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                }`}
                onClick={() => onChange(item.key)}
              >
                {item.icon}
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SupportAvatarBadge({
  label,
  className = "",
}: {
  label: string;
  className?: string;
}) {
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-2xl font-semibold ${className}`}>
      {label}
    </div>
  );
}

export default function MePage() {
  const [payload, setPayload] = useState<MeSessionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [desktopSection, setDesktopSection] = useState<DesktopSection>("conversations");
  const [mobileTab, setMobileTab] = useState<MobileTab>("conversations");
  const [consumptionSection, setConsumptionSection] = useState<ConsumptionSection>("bookings");
  const [mobileConversationView, setMobileConversationView] = useState<MobileConversationView>("list");
  const [selectedConversationKey, setSelectedConversationKey] = useState<PersonalConversationKey>(OFFICIAL_CONVERSATION_KEY);
  const [supportThread, setSupportThread] = useState<PlatformSupportThread | null>(null);
  const [peerContacts, setPeerContacts] = useState<MerchantPeerContactSummary[]>([]);
  const [peerThreads, setPeerThreads] = useState<MerchantPeerThread[]>([]);
  const [supportLoading, setSupportLoading] = useState(false);
  const [peerLoading, setPeerLoading] = useState(false);
  const [supportSending, setSupportSending] = useState(false);
  const [supportSearching, setSupportSearching] = useState(false);
  const [supportError, setSupportError] = useState("");
  const [supportDraft, setSupportDraft] = useState("");
  const [supportContactKeyword, setSupportContactKeyword] = useState("");
  const supportMessagesViewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      try {
        const response = await fetch("/api/auth/merchant-session", {
          method: "GET",
          cache: "no-store",
        });
        const nextPayload = (await response.json().catch(() => null)) as MeSessionPayload | null;
        if (cancelled) return;
        if (!response.ok || nextPayload?.authenticated !== true || !nextPayload?.user) {
          window.location.replace("/login?redirect=/me");
          return;
        }
        if (nextPayload.accountType !== "personal") {
          const merchantIds = readMerchantSessionMerchantIds(nextPayload);
          const merchantId =
            (typeof nextPayload.merchantId === "string" ? nextPayload.merchantId.trim() : "") || merchantIds[0] || "";
          window.location.replace(merchantId ? `/${merchantId}/admin` : "/admin");
          return;
        }
        setPayload(nextPayload);
      } catch {
        if (!cancelled) {
          window.location.replace("/login?redirect=/me");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const accountId =
    payload && typeof payload.accountId === "string" && /^\d{8}$/.test(payload.accountId.trim())
      ? payload.accountId.trim()
      : "";
  const email = payload?.user?.email?.trim() ?? "";
  const displayName = useMemo(() => readDisplayName(payload), [payload]);
  const profileName = displayName || email.split("@")[0] || accountId || "个人用户";
  const avatarLabel = getInitialLabel(profileName);

  const desktopMenuItems: MenuItem[] = useMemo(
    () => [
      { key: "conversations", label: "会话", description: "查看和商户、Faolla 的对话。" },
      { key: "bookings", label: "预约", description: "查看你提交给商户的预约记录。" },
      { key: "orders", label: "订单", description: "查看你在商户网站提交的订单。" },
      { key: "favorites", label: "收藏", description: "保存常用商户、页面和产品。" },
      { key: "cards", label: "名片夹", description: "管理收到或保存的名片。" },
    ],
    [],
  );
  const officialVisibleSupportMessages = useMemo<PersonalVisibleSupportMessage[]>(
    () =>
      (supportThread?.messages ?? [])
        .map((message) => ({
          id: message.id,
          text: message.text,
          createdAt: message.createdAt,
          isSelf: message.sender === "merchant",
          senderLabel: message.sender === "merchant" ? "我" : "Faolla",
        }))
        .sort(compareSupportMessages),
    [supportThread?.messages],
  );
  const selectedConversationIsOfficial = selectedConversationKey === OFFICIAL_CONVERSATION_KEY;
  const selectedPeerMerchantId = selectedConversationKey.startsWith("merchant:")
    ? selectedConversationKey.slice("merchant:".length).trim()
    : "";
  const selectedPeerContact = peerContacts.find((contact) => contact.merchantId === selectedPeerMerchantId) ?? null;
  const selectedPeerThread = useMemo(
    () =>
      accountId && selectedPeerMerchantId
        ? findMerchantPeerThreadForMerchants(
            {
              contacts: [],
              threads: peerThreads,
            },
            accountId,
            selectedPeerMerchantId,
          )
        : null,
    [accountId, peerThreads, selectedPeerMerchantId],
  );
  const peerVisibleSupportMessages = useMemo<PersonalVisibleSupportMessage[]>(
    () =>
      selectedPeerMerchantId
        ? (selectedPeerThread?.messages ?? [])
            .map((message) => ({
              id: message.id,
              text: message.text,
              createdAt: message.createdAt,
              isSelf: message.senderMerchantId === accountId,
              senderLabel:
                message.senderMerchantId === accountId
                  ? "我"
                  : selectedPeerContact?.merchantName || selectedPeerMerchantId,
            }))
            .sort(compareSupportMessages)
        : [],
    [accountId, selectedPeerContact?.merchantName, selectedPeerMerchantId, selectedPeerThread?.messages],
  );
  const visibleSupportMessages = selectedConversationIsOfficial ? officialVisibleSupportMessages : peerVisibleSupportMessages;
  const latestSupportMessage = officialVisibleSupportMessages[officialVisibleSupportMessages.length - 1] ?? null;
  const supportContactPreview =
    formatSupportConversationPreview(latestSupportMessage?.text) || "还没有留言记录，可以直接给 Faolla 留言。";
  const supportContactUpdatedAt = latestSupportMessage?.createdAt || "";
  const supportContactMatchesSearch = useMemo(() => {
    const keyword = supportContactKeyword.trim().toLowerCase();
    if (!keyword) return true;
    return ["faolla", "官方", "客服"].some((item) => item.toLowerCase().includes(keyword) || keyword.includes(item.toLowerCase()));
  }, [supportContactKeyword]);
  const filteredPeerContacts = useMemo(() => {
    const keyword = supportContactKeyword.trim().toLowerCase();
    if (!keyword) return peerContacts;
    return peerContacts.filter((contact) =>
      [
        contact.merchantId,
        contact.merchantName,
        contact.merchantEmail,
        formatSupportConversationPreview(contact.lastMessage?.text),
      ].some((item) => String(item ?? "").toLowerCase().includes(keyword)),
    );
  }, [peerContacts, supportContactKeyword]);
  const selectedConversationName = selectedConversationIsOfficial
    ? "Faolla"
    : selectedPeerContact?.merchantName || selectedPeerMerchantId || "商户";
  const selectedConversationMeta = selectedConversationIsOfficial
    ? "www.faolla.com"
    : [selectedPeerMerchantId, selectedPeerContact?.merchantEmail].filter(Boolean).join(" / ");
  const selectedConversationAvatarLabel = selectedConversationIsOfficial
    ? "FA"
    : getInitialLabel(selectedConversationName);
  const selectedConversationLoading = selectedConversationIsOfficial ? supportLoading : peerLoading;
  const selectedConversationEmptyText = selectedConversationIsOfficial
    ? "还没有留言记录，可以直接给 Faolla 留言。"
    : "还没有聊天记录，可以直接给这个商户发消息。";

  const loadSupportThread = useCallback(async (options?: { silent?: boolean }) => {
    if (!accountId) return;
    if (!options?.silent) setSupportLoading(true);
    setSupportError("");
    try {
      const params = new URLSearchParams({
        siteId: accountId,
      });
      if (email) params.set("merchantEmail", email);
      if (profileName) params.set("merchantName", profileName);
      const response = await fetch(`/api/support-messages?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
        },
      });
      const result = (await response.json().catch(() => null)) as SupportResponsePayload | null;
      if (!response.ok || !result || result.ok !== true) {
        throw new Error(typeof result?.error === "string" ? result.error : "support_load_failed");
      }
      setSupportThread(result.thread ?? null);
    } catch {
      setSupportError("会话加载失败，请稍后重试。");
    } finally {
      if (!options?.silent) setSupportLoading(false);
    }
  }, [accountId, email, profileName]);

  const loadPeerInbox = useCallback(async (options?: { silent?: boolean }) => {
    if (!accountId) return;
    if (!options?.silent) setPeerLoading(true);
    setSupportError("");
    try {
      const params = new URLSearchParams({
        siteId: accountId,
      });
      if (email) params.set("merchantEmail", email);
      if (profileName) params.set("merchantName", profileName);
      const response = await fetch(`/api/merchant-peer-messages?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
        },
      });
      const result = (await response.json().catch(() => null)) as MerchantPeerResponsePayload | null;
      if (!response.ok || !result || result.ok !== true) {
        throw new Error(typeof result?.error === "string" ? result.error : "peer_load_failed");
      }
      setPeerContacts(Array.isArray(result.contacts) ? result.contacts : []);
      setPeerThreads(Array.isArray(result.threads) ? result.threads : []);
    } catch {
      setSupportError("商户会话加载失败，请稍后重试。");
    } finally {
      if (!options?.silent) setPeerLoading(false);
    }
  }, [accountId, email, profileName]);

  async function searchConversation() {
    const query = supportContactKeyword.trim();
    if (!query) {
      setSelectedConversationKey(OFFICIAL_CONVERSATION_KEY);
      await Promise.all([loadSupportThread({ silent: true }), loadPeerInbox({ silent: true })]);
      return;
    }

    if (supportContactMatchesSearch) {
      setSelectedConversationKey(OFFICIAL_CONVERSATION_KEY);
      return;
    }

    if (!accountId || supportSearching) return;
    setSupportSearching(true);
    setSupportError("");
    try {
      const response = await fetch("/api/merchant-peer-messages", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          action: "search",
          query,
          siteId: accountId,
          merchantEmail: email,
          merchantName: profileName,
        }),
      });
      const result = (await response.json().catch(() => null)) as MerchantPeerResponsePayload | null;
      if (!response.ok || !result || result.ok !== true) {
        throw new Error(readPayloadMessage(result?.message, "没有找到匹配的商户，请输入完整 8 位商户 ID 或邮箱。"));
      }
      setPeerContacts(Array.isArray(result.contacts) ? result.contacts : []);
      setPeerThreads(Array.isArray(result.threads) ? result.threads : []);
      const merchantId = trimText(result.contact?.merchantId);
      if (merchantId) {
        setSelectedConversationKey(`merchant:${merchantId}`);
        setMobileConversationView("thread");
      }
    } catch (error) {
      setSupportError(error instanceof Error ? error.message : "商户搜索失败，请稍后重试。");
    } finally {
      setSupportSearching(false);
    }
  }

  async function sendSupportMessage() {
    if (supportSending) return;
    const text = supportDraft.trim();
    if (!text) return;
    if (!accountId) {
      setSupportError("个人账号信息还没准备好，请刷新后重试。");
      return;
    }
    if (!selectedConversationIsOfficial && !selectedPeerMerchantId) {
      setSupportError("请先选择要聊天的商户。");
      return;
    }

    setSupportSending(true);
    setSupportError("");
    try {
      const response = await fetch(selectedConversationIsOfficial ? "/api/support-messages" : "/api/merchant-peer-messages", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(
          selectedConversationIsOfficial
            ? {
                text,
                siteId: accountId,
                merchantEmail: email,
                merchantName: profileName,
              }
            : {
                action: "send",
                recipientMerchantId: selectedPeerMerchantId,
                text,
                siteId: accountId,
                merchantEmail: email,
                merchantName: profileName,
              },
        ),
      });
      const result = (await response.json().catch(() => null)) as (SupportResponsePayload & MerchantPeerResponsePayload) | null;
      if (!response.ok || !result || result.ok !== true) {
        throw new Error(typeof result?.error === "string" ? result.error : "support_send_failed");
      }
      if (selectedConversationIsOfficial) {
        setSupportThread(result.thread ?? null);
      } else {
        setPeerContacts(Array.isArray(result.contacts) ? result.contacts : []);
        setPeerThreads(Array.isArray(result.threads) ? result.threads : []);
      }
      setSupportDraft("");
    } catch {
      setSupportError("消息发送失败，请稍后重试。");
    } finally {
      setSupportSending(false);
    }
  }

  useEffect(() => {
    if (!accountId) return;
    void loadSupportThread();
    void loadPeerInbox({ silent: true });
  }, [accountId, loadPeerInbox, loadSupportThread]);

  useEffect(() => {
    const viewport = supportMessagesViewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [visibleSupportMessages.length, mobileConversationView, desktopSection, selectedConversationKey]);

  async function requestLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/merchant-logout", {
        method: "POST",
        cache: "no-store",
      }).catch(() => null);
    } finally {
      window.location.replace("/login?loggedOut=1");
    }
  }

  function renderSupportMessageList(className: string) {
    return (
      <div ref={supportMessagesViewportRef} className={className}>
        {selectedConversationLoading ? (
          <div className="rounded-2xl border border-dashed bg-white px-4 py-6 text-center text-sm text-slate-500">正在加载聊天记录...</div>
        ) : visibleSupportMessages.length ? (
          <div className="min-w-0 space-y-3">
            {visibleSupportMessages.map((message, index) => {
              const previousMessage = index > 0 ? visibleSupportMessages[index - 1] : null;
              const showDateDivider = !previousMessage || !isSameSupportCalendarDay(previousMessage.createdAt, message.createdAt);
              const messageMeta = formatSupportClockTime(message.createdAt);
              return (
                <div key={`${message.id}:${message.createdAt}`} className="space-y-3">
                  {showDateDivider ? (
                    <div className="flex justify-center">
                      <span className="rounded-full bg-white/90 px-3 py-1 text-[11px] text-slate-500 shadow-sm">
                        {formatSupportThreadDateLabel(message.createdAt)}
                      </span>
                    </div>
                  ) : null}
                  <div className={`flex min-w-0 ${message.isSelf ? "justify-end" : "justify-start"}`}>
                    <div className={`flex max-w-[82%] min-w-0 items-end ${message.isSelf ? "flex-row" : "flex-row-reverse"}`}>
                      <div
                        className={`min-w-0 rounded-2xl shadow-sm ${
                          message.isSelf
                            ? "bg-slate-900 px-4 py-3 text-white"
                            : "border border-slate-200 bg-white px-4 py-3 text-slate-900"
                        }`}
                      >
                        <SupportMessageContent value={message.text} isSelf={message.isSelf} />
                        <div className={`mt-2 text-right text-[10px] ${message.isSelf ? "text-white/70" : "text-slate-400"}`}>
                          {messageMeta}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed bg-white px-4 py-6 text-center text-sm text-slate-500">
            {selectedConversationEmptyText}
          </div>
        )}
      </div>
    );
  }

  function renderSupportComposer(className = "") {
    return (
      <div className={`min-w-0 shrink-0 space-y-3 border-t border-slate-200 bg-white px-5 py-4 ${className}`}>
        {supportError ? <div className="text-sm text-rose-600">{supportError}</div> : null}
        <textarea
          rows={4}
          className="w-full max-w-full min-w-0 resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 caret-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400"
          placeholder={`给 ${selectedConversationName} 发消息，Ctrl + Enter 发送`}
          value={supportDraft}
          onChange={(event) => setSupportDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !event.ctrlKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            void sendSupportMessage();
          }}
          disabled={supportSending}
        />
        <div className="flex min-w-0 justify-end">
          <button
            type="button"
            className="shrink-0 rounded bg-black px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
            onClick={() => void sendSupportMessage()}
            disabled={supportSending || !supportDraft.trim()}
          >
            {supportSending ? "发送中..." : "发送"}
          </button>
        </div>
      </div>
    );
  }

  function renderSupportContactCard(options?: { mobile?: boolean; contact?: MerchantPeerContactSummary | null }) {
    const contact = options?.contact ?? null;
    const isOfficial = !contact;
    const key: PersonalConversationKey = isOfficial ? OFFICIAL_CONVERSATION_KEY : `merchant:${contact.merchantId}`;
    const active = selectedConversationKey === key;
    const title = isOfficial ? "Faolla" : contact.merchantName || contact.merchantId;
    const subtitle = isOfficial ? "www.faolla.com" : [contact.merchantId, contact.merchantEmail].filter(Boolean).join(" / ");
    const preview = isOfficial
      ? supportContactPreview
      : formatSupportConversationPreview(contact.lastMessage?.text) || "还没有聊天记录，可以直接发消息。";
    const updatedAt = isOfficial ? supportContactUpdatedAt : contact.updatedAt || contact.savedAt;
    const avatarLabel = isOfficial ? "FA" : getInitialLabel(title);

    return (
      <button
        type="button"
        className={`w-full rounded-2xl border px-3 py-3 text-left shadow-sm transition ${
          active
            ? "border-slate-900 bg-slate-50"
            : options?.mobile
              ? "border-slate-200 bg-white"
              : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
        }`}
        onClick={() => {
          setSelectedConversationKey(key);
          if (options?.mobile) setMobileConversationView("thread");
        }}
      >
        <div className="flex items-start gap-3">
          <SupportAvatarBadge label={avatarLabel} className="mt-0.5 h-12 w-12 bg-slate-900 text-sm text-white" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="truncate text-sm font-medium text-slate-900">{title}</div>
                  {isOfficial ? (
                    <span className="inline-flex shrink-0 items-center rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-medium leading-none text-white">
                      官方
                    </span>
                  ) : null}
                </div>
                <div className="truncate text-[11px] text-slate-500">{subtitle || "-"}</div>
              </div>
              <div className="shrink-0 text-[11px] text-slate-400">
                {updatedAt ? formatSupportConversationTime(updatedAt) : "未聊天"}
              </div>
            </div>
            <div className="mt-2 truncate text-xs leading-5 text-slate-600">{preview}</div>
          </div>
        </div>
      </button>
    );
  }

  function renderDesktopSupportSurface() {
    return (
      <div className="flex h-[calc(100vh-10rem)] min-h-[560px] min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_44px_rgba(15,23,42,0.06)] md:grid md:grid-cols-[320px_minmax(0,1fr)]">
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r bg-white">
          <div className="border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                className="min-w-0 flex-1 rounded border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400"
                placeholder="搜索商户 / Faolla"
                value={supportContactKeyword}
                onChange={(event) => setSupportContactKeyword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  void searchConversation();
                }}
              />
              <button
                type="button"
                className="shrink-0 rounded border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
                onClick={() => void searchConversation()}
                disabled={supportSearching}
              >
                {supportSearching ? "搜索中" : "搜索"}
              </button>
            </div>
            {supportError ? <div className="mt-2 text-xs leading-5 text-rose-600">{supportError}</div> : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto bg-white p-3">
            <div className="space-y-2">
              {renderSupportContactCard()}
              {filteredPeerContacts.map((contact) => (
                <div key={contact.merchantId}>{renderSupportContactCard({ contact })}</div>
              ))}
              {!filteredPeerContacts.length && !supportContactMatchesSearch ? (
                <div className="rounded border border-dashed px-3 py-4 text-xs leading-5 text-slate-500">
                  输入完整 8 位商户 ID 或邮箱后点搜索，即可添加商户会话。
                </div>
              ) : null}
            </div>
          </div>
          {supportError ? <div className="mt-2 text-xs leading-5 text-rose-600">{supportError}</div> : null}
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-w-0 items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <SupportAvatarBadge label={selectedConversationAvatarLabel} className="h-12 w-12 bg-slate-900 text-sm text-white shadow-sm" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="truncate text-base font-semibold text-slate-900">{selectedConversationName}</div>
                  {selectedConversationIsOfficial ? (
                    <span className="inline-flex shrink-0 items-center rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-medium leading-none text-white">
                      官方
                    </span>
                  ) : null}
                </div>
                <div className="truncate text-xs text-slate-500">{selectedConversationMeta || "-"}</div>
              </div>
            </div>
          </div>
          {renderSupportMessageList("min-h-0 min-w-0 flex-1 overflow-y-auto bg-white px-5 py-5")}
          {renderSupportComposer()}
        </div>
      </div>
    );
  }

  function renderSectionContent(section: DesktopSection) {
    if (section === "conversations") {
      return renderDesktopSupportSurface();
    }
    if (section === "profile") {
      return <PersonalInfoPanel accountId={accountId} displayName={displayName} email={email} />;
    }

    const item = desktopMenuItems.find((entry) => entry.key === section) ?? desktopMenuItems[0];
    const iconName =
      section === "bookings"
        ? "calendar"
        : section === "orders"
          ? "order"
          : section === "favorites"
            ? "star"
            : section === "cards"
              ? "card"
              : "chat";

    return (
      <EmptyFeatureCard
        icon={<Icon name={iconName} />}
        title={item.label}
        description={`${item.description} 当前先完成个人后台布局，数据接入会在下一步继续补。`}
      />
    );
  }

  const desktopTitle =
    desktopSection === "profile"
      ? "个人信息"
      : (desktopMenuItems.find((item) => item.key === desktopSection)?.label ?? "会话");
  const desktopDescription =
    desktopSection === "profile"
      ? "管理当前个人账号资料。"
      : (desktopMenuItems.find((item) => item.key === desktopSection)?.description ?? "查看个人账号内容。");

  function renderConsumptionContent() {
    const isBookings = consumptionSection === "bookings";
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b border-slate-200/80 bg-white/90 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] shadow-[0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="inline-flex rounded-[24px] border border-slate-200 bg-white p-1 shadow-sm">
              <button
                type="button"
                className={`rounded-[19px] px-5 py-2.5 text-sm font-semibold transition ${
                  isBookings ? "bg-emerald-500 text-white shadow-sm" : "text-slate-500"
                }`}
                onClick={() => setConsumptionSection("bookings")}
              >
                预约
              </button>
              <button
                type="button"
                className={`rounded-[19px] px-5 py-2.5 text-sm font-semibold transition ${
                  !isBookings ? "bg-slate-950 text-white shadow-sm" : "text-slate-500"
                }`}
                onClick={() => setConsumptionSection("orders")}
              >
                订单
              </button>
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+5.85rem)] pt-4">
          <EmptyFeatureCard
            icon={<Icon name={isBookings ? "calendar" : "order"} />}
            title={isBookings ? "我的预约" : "我的订单"}
            description={isBookings ? "这里会集中展示你向商户提交的预约。" : "这里会集中展示你在商户网站提交的产品订单。"}
          />
        </div>
      </div>
    );
  }

  function renderMobileConversationsContent() {
    if (mobileConversationView === "thread") {
      return (
        <div className="flex h-full min-h-0 flex-col bg-white">
          <div className="shrink-0 border-b border-slate-200/80 bg-white/95 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] shadow-[0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur">
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm"
                onClick={() => setMobileConversationView("list")}
                aria-label="返回会话列表"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                  <path d="m15 6-6 6 6 6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <SupportAvatarBadge label={selectedConversationAvatarLabel} className="h-11 w-11 bg-slate-900 text-sm text-white shadow-sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="truncate text-[15px] font-semibold text-slate-900">{selectedConversationName}</div>
                  {selectedConversationIsOfficial ? (
                    <span className="inline-flex shrink-0 items-center rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-medium leading-none text-white">
                      官方
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 truncate text-xs text-slate-500">{selectedConversationMeta || "-"}</div>
              </div>
            </div>
          </div>
          {renderSupportMessageList("min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain bg-[#f8fafc] px-4 py-4")}
          {renderSupportComposer("pb-[calc(env(safe-area-inset-bottom)+0.9rem)]")}
        </div>
      );
    }

    return (
      <>
        <div className="shrink-0 border-b border-slate-200/80 bg-white/90 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] shadow-[0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-sm font-semibold text-white shadow-sm">
              会话
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold text-slate-900">聊天列表</div>
              <div className="mt-1 text-xs text-slate-500">固定保留 Faolla 官方客服</div>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <div className="flex min-h-[41px] min-w-0 flex-1 items-center gap-2.5 rounded-[20px] border border-slate-200 bg-[#f3f4f6] px-3.5 py-2 shadow-sm">
              <svg viewBox="0 0 24 24" className="h-[17px] w-[17px] shrink-0 text-slate-400" fill="none" aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.9" />
                <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                className="min-w-0 flex-1 bg-transparent text-[14px] leading-5 text-slate-900 outline-none placeholder:text-slate-400"
                placeholder="商户ID / 邮箱 / Faolla"
                value={supportContactKeyword}
                onChange={(event) => setSupportContactKeyword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  void searchConversation();
                }}
              />
            </div>
            <button
              type="button"
              className="inline-flex h-[41px] shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm shadow-sm hover:bg-slate-50"
              onClick={() => void searchConversation()}
              disabled={supportSearching}
            >
              {supportSearching ? "搜索中" : "搜索"}
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[calc(env(safe-area-inset-bottom)+5.85rem)] pt-3">
          <div className="space-y-2.5">
            {renderSupportContactCard({ mobile: true })}
            {filteredPeerContacts.map((contact) => (
              <div key={contact.merchantId}>{renderSupportContactCard({ mobile: true, contact })}</div>
            ))}
            {!filteredPeerContacts.length && !supportContactMatchesSearch ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white/80 px-4 py-5 text-sm text-slate-500">
                输入完整 8 位商户 ID 或邮箱后点搜索，即可添加商户会话。
              </div>
            ) : null}
          </div>
        </div>
      </>
    );
  }

  function renderMobileContent() {
    if (mobileTab === "conversations") return renderMobileConversationsContent();
    if (mobileTab === "consumption") return renderConsumptionContent();
    if (mobileTab === "self") {
      return (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+5.85rem)] pt-[calc(env(safe-area-inset-top)+1rem)]">
          <div className="mb-4 rounded-[30px] border border-white/75 bg-[linear-gradient(135deg,_rgba(8,17,33,0.96)_0%,_rgba(15,23,42,0.92)_52%,_rgba(15,118,110,0.84)_100%)] p-5 text-white shadow-[0_22px_55px_rgba(8,17,33,0.28)]">
            <div className="flex items-start gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[24px] bg-white/12 text-xl font-semibold tracking-[0.18em] text-white">
                {avatarLabel}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium uppercase tracking-[0.28em] text-slate-200/72">Personal Center</div>
                <div className="mt-2 truncate text-[28px] font-semibold tracking-tight text-white">{profileName}</div>
                <div className="mt-2 text-sm leading-6 text-slate-200/84">{accountId || email}</div>
              </div>
            </div>
          </div>
          <PersonalInfoPanel accountId={accountId} displayName={displayName} email={email} />
          <button
            type="button"
            className="mt-4 w-full rounded-[22px] border border-rose-200 bg-white px-4 py-3 text-sm font-semibold text-rose-600 shadow-sm"
            onClick={() => void requestLogout()}
            disabled={loggingOut}
          >
            {loggingOut ? "退出中..." : "退出登录"}
          </button>
        </div>
      );
    }
    if (mobileTab === "faolla") {
      return (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+5.85rem)] pt-[calc(env(safe-area-inset-top)+1rem)]">
          <EmptyFeatureCard
            icon={<Icon name="shield" />}
            title="Faolla"
            description="这里会放 Faolla 平台入口、官方通知和个人用户服务。"
            action={
              <Link
                href="/"
                className="inline-flex rounded-[18px] bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-sm"
              >
                打开 Faolla 首页
              </Link>
            }
          />
        </div>
      );
    }
    return null;
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12 text-sm text-slate-500">
        正在载入个人中心...
      </main>
    );
  }

  return (
    <>
      <main className="hidden min-h-screen bg-slate-50/70 pl-[320px] md:block">
        <aside className="fixed inset-y-0 left-0 z-30 w-[320px] border-r border-slate-200 bg-white/96 shadow-[12px_0_34px_rgba(15,23,42,0.06)] backdrop-blur">
          <div className="flex h-full min-h-0 flex-col p-4">
            <div className="rounded border border-slate-300 bg-slate-50 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="max-w-[160px] truncate text-sm font-semibold text-slate-900" title={profileName}>
                    {profileName}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    className="rounded border bg-white px-3 py-2 text-sm text-slate-900 transition-colors hover:bg-gray-50"
                    onClick={() => setDesktopSection("profile")}
                  >
                    个人信息
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-10 w-10 items-center justify-center rounded border bg-white text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
                    onClick={() => void requestLogout()}
                    disabled={loggingOut}
                    title={loggingOut ? "退出中..." : "退出登录"}
                    aria-label={loggingOut ? "退出中..." : "退出登录"}
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                      <path d="M14 7h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M10 8 6 12l4 4M7 12h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="grid gap-2">
                {desktopMenuItems.map((item) => (
                  <DesktopMenuButton
                    key={item.key}
                    item={item}
                    active={desktopSection === item.key}
                    onClick={() => setDesktopSection(item.key)}
                  />
                ))}
              </div>
            </div>

            <div className="mt-auto rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="text-sm font-semibold text-slate-900">个人中心</div>
              <p className="mt-2 text-sm leading-6 text-slate-500">个人用户后台会逐步接入会话、预约、订单、收藏和名片夹。</p>
            </div>
          </div>
        </aside>

        <section className="min-h-screen">
          <div className="border-b border-slate-200 bg-white/90 px-6 py-5 shadow-sm backdrop-blur">
            <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
              <div className="text-base font-semibold text-slate-900">{desktopTitle}</div>
              <div className="mt-1 text-sm text-slate-500">{desktopDescription}</div>
            </div>
          </div>
          <div className="px-6 py-8">{renderSectionContent(desktopSection)}</div>
        </section>
      </main>

      <main className="fixed inset-x-0 top-0 bottom-0 z-[120] flex min-h-0 flex-col overflow-hidden overscroll-none bg-[linear-gradient(180deg,#f8fafc_0%,#eef2ff_48%,#f8fafc_100%)] touch-manipulation md:hidden">
        {renderMobileContent()}
      </main>
      {mobileTab === "conversations" && mobileConversationView === "thread" ? null : (
        <MobileBottomNav activeTab={mobileTab} onChange={setMobileTab} />
      )}
    </>
  );
}
