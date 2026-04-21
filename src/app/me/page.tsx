"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useI18n } from "@/components/I18nProvider";
import { readMerchantSessionMerchantIds } from "@/lib/authSessionRecovery";
import { LANGUAGE_OPTIONS } from "@/lib/i18n";
import SupportMessageContent from "@/components/support/SupportMessageContent";
import {
  findMerchantPeerThreadForMerchants,
  type MerchantPeerContactSummary,
  type MerchantPeerThread,
} from "@/lib/merchantPeerInbox";
import { type PlatformSupportMessage, type PlatformSupportThread } from "@/lib/platformSupportInbox";
import {
  formatSupportConversationPreview,
  parseSupportMessageAttachmentPreview,
} from "@/lib/supportMessageAttachments";

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
type MobileSelfSection = "home" | "profile" | "cards" | "notifications";

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

type SupportContactRow = {
  key: PersonalConversationKey;
  name: string;
  badge?: string;
  subtitle: string;
  preview: string;
  updatedAt: string;
  unread: boolean;
  avatarLabel: string;
  avatarImageUrl: string;
  isOfficial: boolean;
};

const OFFICIAL_CONVERSATION_KEY: PersonalConversationKey = "official";
const SUPPORT_PHOTO_PICKER_ACCEPT = "image/png,image/jpeg,image/webp,image/heic,image/heif,image/gif";
const SUPPORT_FILE_PICKER_ACCEPT = [
  ".pdf",
  ".txt",
  ".csv",
  ".json",
  ".zip",
  ".rar",
  ".7z",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
].join(",");

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

function getSupportContactAvatarLabel(value: string, fallback = "商") {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const first = Array.from(trimmed)[0] ?? fallback;
  if (/^[a-z]$/i.test(first)) return first.toUpperCase();
  return first;
}

function buildVisibleSupportMessageKey(message: Pick<PersonalVisibleSupportMessage, "id" | "createdAt">) {
  return `${message.id}:${normalizeSupportMessageTimestamp(message.createdAt) || message.createdAt}`;
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

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      resolve(typeof reader.result === "string" ? reader.result : "");
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("file_read_failed"));
    });
    reader.readAsDataURL(file);
  });
}

function formatSupportAttachmentFileSize(bytes: number) {
  const size = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}MB`;
  if (size >= 1024) return `${Math.round(size / 1024)}KB`;
  return `${size}B`;
}

function buildSupportPhotoMessageText(label: "照片" | "拍照", fileName: string, url: string) {
  return [`${label}：${fileName || "图片"}`, url].filter(Boolean).join("\n");
}

function buildSupportFileMessageText(file: File, url: string) {
  const fileName = file.name.trim() || "文件";
  return [`文件：${fileName} (${formatSupportAttachmentFileSize(file.size)})`, url].join("\n");
}

function buildSupportLocationMapPreviewUrl(latitude: number, longitude: number) {
  const lat = latitude.toFixed(6);
  const lng = longitude.toFixed(6);
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

function buildSupportLocationMessageText(latitude: number, longitude: number, accuracy: number | null) {
  const lat = latitude.toFixed(6);
  const lng = longitude.toFixed(6);
  const accuracyLabel =
    typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy > 0
      ? `（约 ${Math.round(accuracy)} 米）`
      : "";
  return [`位置：${lat}, ${lng}${accuracyLabel}`, buildSupportLocationMapPreviewUrl(latitude, longitude)].join("\n");
}

function languageFlagImageUrl(countryCode: string) {
  return `https://flagcdn.com/24x18/${countryCode.toLowerCase()}.png`;
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
  const { locale, setLocale } = useI18n();
  const [payload, setPayload] = useState<MeSessionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [desktopSection, setDesktopSection] = useState<DesktopSection>("conversations");
  const [mobileTab, setMobileTab] = useState<MobileTab>("conversations");
  const [consumptionSection, setConsumptionSection] = useState<ConsumptionSection>("bookings");
  const [mobileConversationView, setMobileConversationView] = useState<MobileConversationView>("list");
  const [mobileSelfSection, setMobileSelfSection] = useState<MobileSelfSection>("home");
  const [mobileSelfLanguageMenuOpen, setMobileSelfLanguageMenuOpen] = useState(false);
  const [selectedConversationKey, setSelectedConversationKey] = useState<PersonalConversationKey>(OFFICIAL_CONVERSATION_KEY);
  const [supportThread, setSupportThread] = useState<PlatformSupportThread | null>(null);
  const [peerContacts, setPeerContacts] = useState<MerchantPeerContactSummary[]>([]);
  const [peerThreads, setPeerThreads] = useState<MerchantPeerThread[]>([]);
  const [supportLoading, setSupportLoading] = useState(false);
  const [peerLoading, setPeerLoading] = useState(false);
  const [supportSending, setSupportSending] = useState(false);
  const [supportAttachmentBusy, setSupportAttachmentBusy] = useState(false);
  const [supportAttachmentMenuOpen, setSupportAttachmentMenuOpen] = useState(false);
  const [supportSearching, setSupportSearching] = useState(false);
  const [supportError, setSupportError] = useState("");
  const [supportSearchError, setSupportSearchError] = useState("");
  const [supportDraft, setSupportDraft] = useState("");
  const [supportContactKeyword, setSupportContactKeyword] = useState("");
  const supportMessagesViewportRef = useRef<HTMLDivElement | null>(null);
  const supportInputRef = useRef<HTMLTextAreaElement | null>(null);
  const mobileSelfLanguageRootRef = useRef<HTMLDivElement | null>(null);
  const mobileSelfLanguageMenuRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    if (!mobileSelfLanguageMenuOpen || typeof document === "undefined") return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (mobileSelfLanguageRootRef.current?.contains(target)) return;
      if (mobileSelfLanguageMenuRef.current?.contains(target)) return;
      setMobileSelfLanguageMenuOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [mobileSelfLanguageMenuOpen]);

  const accountId =
    payload && typeof payload.accountId === "string" && /^\d{8}$/.test(payload.accountId.trim())
      ? payload.accountId.trim()
      : "";
  const email = payload?.user?.email?.trim() ?? "";
  const displayName = useMemo(() => readDisplayName(payload), [payload]);
  const profileName = displayName || email.split("@")[0] || accountId || "个人用户";
  const avatarLabel = getInitialLabel(profileName);
  const mobileSelfSelectedLanguage = useMemo(
    () => LANGUAGE_OPTIONS.find((item) => item.code === locale) ?? LANGUAGE_OPTIONS[0],
    [locale],
  );
  const mobileSelfProfileSummary = [accountId || "-", email || "-"].filter(Boolean).join(" / ");
  const mobileSelfCardsSummary = "个人名片夹会在下一步接入。";
  const mobileSelfNotificationSummary = "系统通知、提示音和震动设置。";

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
  const selectedConversationName = selectedConversationIsOfficial
    ? "Faolla"
    : selectedPeerContact?.merchantName || selectedPeerMerchantId || "商户";
  const selectedConversationMeta = selectedConversationIsOfficial
    ? "www.faolla.com"
    : [selectedPeerMerchantId, selectedPeerContact?.merchantEmail].filter(Boolean).join(" / ");
  const selectedConversationAvatarLabel = selectedConversationIsOfficial
    ? "FA"
    : getSupportContactAvatarLabel(selectedConversationName, "商");
  const selectedConversationLoading = selectedConversationIsOfficial ? supportLoading : peerLoading;
  const selectedConversationEmptyText = selectedConversationIsOfficial
    ? "还没有留言记录，可以直接在下方给 Faolla 留言。"
    : "还没有聊天记录，可以直接在下方发送第一条消息。";
  const selectedSupportSendButtonLabel = selectedConversationIsOfficial ? "发送留言" : "发送消息";
  const supportComposerAvailable = selectedConversationIsOfficial || !!selectedPeerContact;
  const supportComposerBusy = supportSending || supportAttachmentBusy;
  const supportCanSend = !!supportDraft.trim() && supportComposerAvailable;
  const supportContactRows: SupportContactRow[] = [
    {
      key: OFFICIAL_CONVERSATION_KEY,
      name: "Faolla",
      badge: "官方",
      subtitle: "www.faolla.com",
      preview: supportContactPreview || "还没有留言记录，可以直接在右侧给 Faolla 留言。",
      updatedAt: supportContactUpdatedAt,
      unread: false,
      avatarLabel: "FA",
      avatarImageUrl: "",
      isOfficial: true,
    },
    ...peerContacts.map((contact): SupportContactRow => ({
      key: `merchant:${contact.merchantId}`,
      name: contact.merchantName || contact.merchantId,
      subtitle: contact.merchantId,
      preview: formatSupportConversationPreview(contact.lastMessage?.text) || "还没有聊天记录，可以直接开始对话。",
      updatedAt: contact.updatedAt || contact.savedAt,
      unread: false,
      avatarLabel: getSupportContactAvatarLabel(contact.merchantName || contact.merchantId, "商"),
      avatarImageUrl: "",
      isOfficial: false,
    })),
  ];
  const mobileSupportContactListSummary = `全部 ${supportContactRows.length} 个会话已读`;

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
    setSupportSearchError("");
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
      setSupportSearchError(error instanceof Error ? error.message : "商户搜索失败，请稍后重试。");
    } finally {
      setSupportSearching(false);
    }
  }

  async function sendSupportTextPayload(rawText: string, options?: { clearDraft?: boolean }) {
    if (supportSending) return false;
    const text = rawText.trim();
    if (!text) return;
    if (!accountId) {
      setSupportError("个人账号信息还没准备好，请刷新后重试。");
      return false;
    }
    if (!selectedConversationIsOfficial && !selectedPeerMerchantId) {
      setSupportError("请先选择要聊天的商户。");
      return false;
    }

    setSupportSending(true);
    setSupportError("");
    setSupportAttachmentMenuOpen(false);
    if (options?.clearDraft) {
      setSupportDraft("");
    }
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
      if (!options?.clearDraft) {
        setSupportDraft("");
      }
      return true;
    } catch {
      setSupportError("消息发送失败，请稍后重试。");
      return false;
    } finally {
      setSupportSending(false);
    }
  }

  async function sendSupportMessage() {
    await sendSupportTextPayload(supportDraft, { clearDraft: true });
  }

  function focusSupportInput() {
    window.setTimeout(() => supportInputRef.current?.focus(), 0);
  }

  function openSupportContactThread(key: PersonalConversationKey) {
    setSelectedConversationKey(key);
    setMobileConversationView("thread");
    focusSupportInput();
  }

  function toggleSupportAttachmentMenu() {
    if (!supportComposerAvailable || supportComposerBusy) return;
    setSupportAttachmentMenuOpen((current) => !current);
  }

  async function uploadSupportAssetDataUrl(
    dataUrl: string,
    folder: "merchant-assets" | "merchant-files" = "merchant-assets",
  ) {
    const response = await fetch("/api/assets/upload", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        dataUrl,
        merchantHint: accountId || "personal",
        folder,
        usage: folder === "merchant-files" ? "support-file" : "support-image",
      }),
    });
    const payload = (await response.json().catch(() => null)) as { ok?: unknown; url?: unknown; message?: unknown } | null;
    const uploadedUrl = typeof payload?.url === "string" ? payload.url.trim() : "";
    if (response.ok && uploadedUrl) {
      return { ok: true as const, url: uploadedUrl, message: "" };
    }
    return {
      ok: false as const,
      url: "",
      message: typeof payload?.message === "string" ? payload.message.trim() : "",
    };
  }

  async function handleSupportImageAttachment(file: File, label: "照片" | "拍照") {
    if (supportComposerBusy) return;
    setSupportAttachmentBusy(true);
    setSupportAttachmentMenuOpen(false);
    supportInputRef.current?.blur();
    try {
      const uploadResult = await uploadSupportAssetDataUrl(await fileToDataUrl(file), "merchant-files");
      if (!uploadResult.ok || !uploadResult.url) {
        throw new Error(uploadResult.message || `${label}上传失败，请稍后重试`);
      }
      await sendSupportTextPayload(buildSupportPhotoMessageText(label, file.name.trim() || `${label}.jpg`, uploadResult.url));
    } catch (error) {
      setSupportError(error instanceof Error ? error.message : `${label}发送失败，请稍后重试`);
    } finally {
      setSupportAttachmentBusy(false);
    }
  }

  async function handleSupportFileAttachment(file: File) {
    if (supportComposerBusy) return;
    setSupportAttachmentBusy(true);
    setSupportAttachmentMenuOpen(false);
    supportInputRef.current?.blur();
    try {
      const uploadResult = await uploadSupportAssetDataUrl(await fileToDataUrl(file), "merchant-files");
      if (!uploadResult.ok || !uploadResult.url) {
        throw new Error(uploadResult.message || "文件上传失败，请稍后重试");
      }
      await sendSupportTextPayload(buildSupportFileMessageText(file, uploadResult.url));
    } catch (error) {
      setSupportError(error instanceof Error ? error.message : "文件发送失败，请稍后重试");
    } finally {
      setSupportAttachmentBusy(false);
    }
  }

  async function pickSupportFileViaTemporaryInput(options: {
    accept: string;
    capture?: "environment";
    onFile: (file: File) => Promise<void>;
  }) {
    if (typeof document === "undefined") return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = options.accept;
    if (options.capture) input.capture = options.capture;
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.top = "0";
    const cleanup = () => {
      input.remove();
    };
    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0] ?? null;
        cleanup();
        if (!file) return;
        void options.onFile(file);
      },
      { once: true },
    );
    document.body.appendChild(input);
    input.click();
  }

  async function openSupportPhotoPicker() {
    if (supportComposerBusy) return;
    setSupportAttachmentMenuOpen(false);
    supportInputRef.current?.blur();
    await pickSupportFileViaTemporaryInput({
      accept: SUPPORT_PHOTO_PICKER_ACCEPT,
      onFile: async (file) => handleSupportImageAttachment(file, "照片"),
    });
  }

  async function openSupportCameraPicker() {
    if (supportComposerBusy) return;
    setSupportAttachmentMenuOpen(false);
    supportInputRef.current?.blur();
    await pickSupportFileViaTemporaryInput({
      accept: SUPPORT_PHOTO_PICKER_ACCEPT,
      capture: "environment",
      onFile: async (file) => handleSupportImageAttachment(file, "拍照"),
    });
  }

  async function openSupportFilePicker() {
    if (supportComposerBusy) return;
    setSupportAttachmentMenuOpen(false);
    supportInputRef.current?.blur();
    await pickSupportFileViaTemporaryInput({
      accept: SUPPORT_FILE_PICKER_ACCEPT,
      onFile: async (file) => handleSupportFileAttachment(file),
    });
  }

  async function handleSupportLocationAttachment() {
    if (supportComposerBusy) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setSupportError("当前设备不支持位置发送");
      return;
    }
    setSupportAttachmentBusy(true);
    setSupportAttachmentMenuOpen(false);
    supportInputRef.current?.blur();
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 60000,
        });
      });
      await sendSupportTextPayload(
        buildSupportLocationMessageText(
          position.coords.latitude,
          position.coords.longitude,
          position.coords.accuracy,
        ),
      );
    } catch (error) {
      const message =
        error && typeof error === "object" && "code" in error && Number((error as { code?: unknown }).code) === 1
          ? "定位权限被拒绝，请先允许浏览器访问位置"
          : "位置发送失败，请稍后重试";
      setSupportError(message);
    } finally {
      setSupportAttachmentBusy(false);
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
              const messageKey = buildVisibleSupportMessageKey(message);
              const messageMeta = formatSupportClockTime(message.createdAt);
              return (
                <div key={messageKey} className="space-y-3">
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
                          parseSupportMessageAttachmentPreview(message.text)
                            ? "border border-transparent bg-transparent px-0 py-0"
                            : message.isSelf
                              ? "bg-slate-900 px-4 py-3 text-white"
                              : "border bg-white px-4 py-3 text-slate-900"
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

  function renderDesktopSupportComposer(className = "") {
    return (
      <div className={`min-w-0 shrink-0 space-y-3 border-t border-slate-200 bg-white px-5 py-4 ${className}`}>
        {supportError ? <div className="text-sm text-rose-600">{supportError}</div> : null}
        <textarea
          ref={supportInputRef}
          rows={4}
          className="w-full max-w-full min-w-0 resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 caret-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400"
          placeholder=""
          value={supportDraft}
          onChange={(event) => setSupportDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !event.ctrlKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            void sendSupportMessage();
          }}
          disabled={supportComposerBusy || !supportComposerAvailable}
        />
        <div className="flex min-w-0 justify-end">
          <button
            type="button"
            className="shrink-0 rounded bg-black px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
            onClick={() => void sendSupportMessage()}
            disabled={supportComposerBusy || !supportCanSend}
          >
            {supportComposerBusy ? "发送中..." : selectedSupportSendButtonLabel}
          </button>
        </div>
      </div>
    );
  }

  function renderMobileSupportComposer() {
    return (
      <div className="shrink-0 overscroll-none border-t border-slate-200/80 bg-[#edf1f7]/98 px-3 pb-[env(safe-area-inset-bottom)] pt-1 shadow-[0_-8px_30px_rgba(15,23,42,0.06)] backdrop-blur">
        {supportAttachmentMenuOpen ? (
          <div className="mb-2 rounded-[28px] bg-white px-3 py-3 shadow-[0_12px_28px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/80">
            <div className="grid grid-cols-5 gap-2">
              {[
                {
                  key: "photo",
                  label: "照片",
                  color: "bg-blue-50 text-blue-500",
                  onClick: () => void openSupportPhotoPicker(),
                  icon: (
                    <>
                      <path d="M6 8h2.3l1.2-1.7A1 1 0 0 1 10.3 6h3.4a1 1 0 0 1 .8.3L15.7 8H18a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.8" />
                      <circle cx="12" cy="13" r="3.1" stroke="currentColor" strokeWidth="1.8" />
                    </>
                  ),
                },
                {
                  key: "camera",
                  label: "拍照",
                  color: "bg-slate-100 text-slate-700",
                  onClick: () => void openSupportCameraPicker(),
                  icon: (
                    <>
                      <path d="M4 9a2 2 0 0 1 2-2h1.8l1.2-1.8A1 1 0 0 1 9.8 5h4.4a1 1 0 0 1 .8.2L16.2 7H18a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9Z" stroke="currentColor" strokeWidth="1.8" />
                      <circle cx="12" cy="12.5" r="3.1" stroke="currentColor" strokeWidth="1.8" />
                    </>
                  ),
                },
                {
                  key: "location",
                  label: "位置",
                  color: "bg-emerald-50 text-emerald-500",
                  onClick: () => void handleSupportLocationAttachment(),
                  icon: (
                    <>
                      <path d="M12 20s6-5.5 6-10a6 6 0 1 0-12 0c0 4.5 6 10 6 10Z" stroke="currentColor" strokeWidth="1.8" />
                      <circle cx="12" cy="10" r="2.2" fill="currentColor" />
                    </>
                  ),
                },
                {
                  key: "card",
                  label: "名片",
                  color: "bg-violet-50 text-violet-500",
                  onClick: () => setSupportError("名片夹发送下一步接入"),
                  icon: (
                    <>
                      <path d="M5 7.5A2.5 2.5 0 0 1 7.5 5h9A2.5 2.5 0 0 1 19 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 16.5v-9Z" stroke="currentColor" strokeWidth="1.8" />
                      <circle cx="12" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.8" />
                      <path d="M8.5 16a3.5 3.5 0 0 1 7 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </>
                  ),
                },
                {
                  key: "file",
                  label: "文件",
                  color: "bg-amber-50 text-amber-500",
                  onClick: () => void openSupportFilePicker(),
                  icon: (
                    <>
                      <path d="M8 4.5h5.2L18 9.3V18a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.8" />
                      <path d="M13 4.8V9h4.2" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                    </>
                  ),
                },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="flex flex-col items-center gap-2 rounded-2xl px-1 py-2 text-[11px] font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                  onClick={item.onClick}
                  disabled={supportComposerBusy}
                >
                  <span className={`flex h-12 w-12 items-center justify-center rounded-full ${item.color}`}>
                    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
                      {item.icon}
                    </svg>
                  </span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {supportError ? <div className="mb-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">{supportError}</div> : null}
        <div className="flex items-end gap-2">
          <button
            type="button"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-700 shadow-[0_8px_18px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/80 transition ${
              supportAttachmentMenuOpen ? "bg-slate-900 text-white" : "bg-white hover:bg-slate-50"
            }`}
            onClick={toggleSupportAttachmentMenu}
            disabled={!supportComposerAvailable || supportComposerBusy}
            aria-label="打开附件菜单"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
          <div className="flex min-h-11 min-w-0 flex-1 items-end overflow-hidden rounded-[28px] bg-white px-3 py-2 shadow-[0_8px_18px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/80">
            <textarea
              ref={supportInputRef}
              rows={1}
              className="min-h-[24px] w-full resize-none overflow-y-hidden bg-transparent px-1 py-0 text-base leading-6 outline-none transition placeholder:text-slate-400"
              placeholder=""
              value={supportDraft}
              onChange={(event) => setSupportDraft(event.target.value)}
              onFocus={() => setSupportAttachmentMenuOpen(false)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || !event.ctrlKey || event.nativeEvent.isComposing) return;
                event.preventDefault();
                void sendSupportMessage();
              }}
              disabled={supportComposerBusy || !supportComposerAvailable}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="enter"
            />
          </div>
          <button
            type="button"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white shadow-[0_10px_22px_rgba(34,197,94,0.28)] transition ${
              supportComposerBusy || supportCanSend
                ? "bg-emerald-500 hover:bg-emerald-600"
                : "bg-slate-300 shadow-none"
            }`}
            onClick={() => void sendSupportMessage()}
            disabled={supportComposerBusy || !supportCanSend}
            aria-label={supportComposerBusy ? "发送中" : selectedSupportSendButtonLabel}
          >
            {supportComposerBusy ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white" />
            ) : (
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                <path
                  d="M5 12.5 18.2 5.8c.7-.36 1.5.28 1.29 1.04l-2.84 10.2c-.18.66-.97.92-1.5.5l-3.7-2.94a1 1 0 0 1-.27-1.17l1.63-3.62-4.46 3.54a1 1 0 0 1-.84.2L5.64 13.2A.77.77 0 0 1 5 12.5Z"
                  fill="currentColor"
                />
              </svg>
            )}
          </button>
        </div>
      </div>
    );
  }

  function renderSupportContactRow(contactRow: SupportContactRow, options?: { mobile?: boolean }) {
    const active = selectedConversationKey === contactRow.key;
    return (
      <button
        type="button"
        className={
          options?.mobile
            ? `w-full rounded-[26px] border px-3 py-3.5 text-left shadow-[0_10px_24px_rgba(15,23,42,0.06)] transition ${
                active ? "border-slate-900 bg-white" : "border-slate-200 bg-white/90 hover:bg-white"
              }`
            : `w-full rounded-2xl border px-3 py-3 text-left transition ${
                active ? "border-blue-300 bg-blue-50" : "bg-white hover:bg-slate-50"
              }`
        }
        onClick={() => {
          if (options?.mobile) {
            openSupportContactThread(contactRow.key);
          } else {
            setSelectedConversationKey(contactRow.key);
            focusSupportInput();
          }
        }}
      >
        <div className="flex items-start gap-3">
          <SupportAvatarBadge
            label={contactRow.avatarLabel}
            className={`mt-0.5 h-12 w-12 text-sm shadow-sm ${
              contactRow.isOfficial || contactRow.unread
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-700"
            }`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className={`truncate text-sm ${options?.mobile ? "font-semibold" : "font-medium"} text-slate-900`}>
                    {contactRow.name}
                  </div>
                  {!contactRow.isOfficial ? (
                    <span className="truncate text-[11px] font-medium text-slate-400">{contactRow.subtitle}</span>
                  ) : null}
                  {contactRow.badge ? (
                    <span className="inline-flex shrink-0 items-center rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-medium leading-none text-white">
                      {contactRow.badge}
                    </span>
                  ) : null}
                  {contactRow.unread ? (
                    <span aria-label="有未读消息" className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-rose-500" />
                  ) : null}
                </div>
                {contactRow.isOfficial ? (
                  <div className={`${options?.mobile ? "mt-1" : ""} truncate text-[11px] text-slate-500`}>
                    {contactRow.subtitle}
                  </div>
                ) : null}
              </div>
              <div className="shrink-0 text-[11px] text-slate-400">
                {contactRow.updatedAt ? formatSupportConversationTime(contactRow.updatedAt) : options?.mobile ? "未开始" : "未聊天"}
              </div>
            </div>
            <div className={`${options?.mobile ? "text-[13px]" : "text-xs"} mt-2 truncate leading-5 text-slate-600`}>
              {contactRow.preview}
            </div>
          </div>
        </div>
      </button>
    );
  }

  function renderDesktopSupportSurface() {
    return (
      <div className="flex h-[calc(100vh-4rem)] min-h-[560px] min-w-0 overflow-hidden rounded-2xl border bg-white shadow-[0_18px_44px_rgba(15,23,42,0.06)] md:grid md:grid-cols-[320px_minmax(0,1fr)]">
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden border-b bg-white md:border-b-0 md:border-r">
          <div className="border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                className="min-w-0 flex-1 rounded border px-3 py-2 text-sm outline-none transition focus:border-slate-400"
                placeholder="精确搜索ID或邮箱"
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
                className="shrink-0 rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                onClick={() => void searchConversation()}
                disabled={supportSearching}
              >
                {supportSearching ? "搜索中..." : "搜索"}
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto bg-white p-3">
            {supportSearchError ? (
              <div className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">{supportSearchError}</div>
            ) : null}
            <div className="space-y-2">
              {supportContactRows.map((contactRow) => (
                <div key={contactRow.key}>{renderSupportContactRow(contactRow)}</div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-w-0 items-center justify-between gap-3 border-b px-5 py-4">
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
          {renderDesktopSupportComposer()}
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
        <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[linear-gradient(180deg,#f8fafc_0%,#eef2ff_48%,#f8fafc_100%)]">
          <div className="shrink-0 border-b border-slate-200/80 bg-white/90 px-3 pb-3 pt-[calc(env(safe-area-inset-top)+0.55rem)] shadow-[0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-900 hover:bg-slate-100"
                  onClick={() => setMobileConversationView("list")}
                  aria-label="返回会话列表"
                >
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
                    <path
                      d="M19 12H7M12 7l-5 5 5 5"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="square"
                      strokeLinejoin="miter"
                    />
                  </svg>
                </button>
                <SupportAvatarBadge label={selectedConversationAvatarLabel} className="h-11 w-11 bg-slate-900 text-sm text-white shadow-sm" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="truncate text-[15px] font-semibold text-slate-900">{selectedConversationName}</div>
                    {selectedConversationIsOfficial ? (
                      <span className="inline-flex shrink-0 items-center rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-medium leading-none text-white">
                        官方
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-500">{selectedConversationMeta || "-"}</div>
                </div>
              </div>
            </div>
          </div>
          {renderSupportMessageList("min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4 pt-4")}
          {renderMobileSupportComposer()}
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
              <div className="mt-1 text-xs text-slate-500">{mobileSupportContactListSummary}</div>
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
                placeholder="精确搜索ID或邮箱"
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
              className="inline-flex h-[41px] shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm shadow-sm hover:bg-slate-50 disabled:opacity-50"
              onClick={() => void searchConversation()}
              disabled={supportSearching}
            >
              {supportSearching ? "搜索中" : "搜索"}
            </button>
          </div>
          {supportSearchError ? (
            <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
              {supportSearchError}
            </div>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[calc(env(safe-area-inset-bottom)+5.85rem)] pt-3">
          <div className="space-y-2.5">
            {supportContactRows.map((contactRow) => (
              <div key={contactRow.key}>{renderSupportContactRow(contactRow, { mobile: true })}</div>
            ))}
          </div>
        </div>
      </>
    );
  }

  function renderMobileContent() {
    if (mobileTab === "conversations") return renderMobileConversationsContent();
    if (mobileTab === "consumption") return renderConsumptionContent();
    if (mobileTab === "self") {
      const selfMenuItems: Array<{
        key: MobileSelfSection;
        label: string;
        summary: string;
        icon: ReactNode;
      }> = [
        {
          key: "profile",
          label: "我的资料",
          summary: mobileSelfProfileSummary,
          icon: <Icon name="user" />,
        },
        {
          key: "cards",
          label: "名片夹",
          summary: mobileSelfCardsSummary,
          icon: <Icon name="card" />,
        },
        {
          key: "notifications",
          label: "通知",
          summary: mobileSelfNotificationSummary,
          icon: (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
              <path
                d="M12 4.5A4.5 4.5 0 0 0 7.5 9v2.1c0 .6-.2 1.2-.6 1.7L5.8 14a1 1 0 0 0 .8 1.6h10.8a1 1 0 0 0 .8-1.6l-1.1-1.2c-.4-.5-.6-1.1-.6-1.7V9A4.5 4.5 0 0 0 12 4.5Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <path d="M10.3 18a1.9 1.9 0 0 0 3.4 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          ),
        },
      ];
      return (
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
          <div className="relative shrink-0 border-b border-slate-200/80 bg-white/90 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] shadow-[0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur">
            <div className="absolute right-4 top-[calc(env(safe-area-inset-top)+0.7rem)] z-20">
              <div ref={mobileSelfLanguageRootRef} className="relative">
                <button
                  type="button"
                  className="flex h-11 items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-3 text-xs font-medium text-slate-800 shadow-[0_10px_24px_rgba(15,23,42,0.08)]"
                  onClick={() => setMobileSelfLanguageMenuOpen((current) => !current)}
                  aria-label="切换语言"
                  aria-expanded={mobileSelfLanguageMenuOpen}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={languageFlagImageUrl(mobileSelfSelectedLanguage.countryCode)}
                    alt={mobileSelfSelectedLanguage.label}
                    width={16}
                    height={12}
                    className="rounded-[2px] border border-slate-200 object-cover"
                    loading="eager"
                  />
                  <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-500" fill="none" aria-hidden="true">
                    <path d="m7 10 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {mobileSelfLanguageMenuOpen ? (
                  <div
                    ref={mobileSelfLanguageMenuRef}
                    className="absolute right-0 top-[calc(100%+0.5rem)] max-h-[55vh] w-[220px] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_22px_60px_rgba(15,23,42,0.22)]"
                  >
                    <div className="space-y-1">
                      {LANGUAGE_OPTIONS.map((item) => (
                        <button
                          key={item.code}
                          type="button"
                          className={`flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm transition ${
                            item.code === locale ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
                          }`}
                          onClick={() => {
                            setLocale(item.code);
                            setMobileSelfLanguageMenuOpen(false);
                          }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={languageFlagImageUrl(item.countryCode)}
                            alt={item.label}
                            width={16}
                            height={12}
                            className="rounded-[2px] border border-slate-200 object-cover"
                            loading="lazy"
                          />
                          <span className="truncate">{item.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            {mobileSelfSection === "home" ? (
              <div className="flex flex-col items-center px-4 text-center">
                <div className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-[30px] bg-slate-900 text-xl font-semibold text-white shadow-[0_18px_40px_rgba(15,23,42,0.16)]">
                  {avatarLabel}
                </div>
                <div className="mt-4 max-w-full truncate text-[28px] font-semibold leading-none text-slate-950">{profileName}</div>
                <div className="mt-2 max-w-full truncate text-sm text-slate-500">{accountId || email || "个人中心"}</div>
              </div>
            ) : (
              <div className="flex items-center gap-3 pr-16">
                <button
                  type="button"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-900 hover:bg-slate-100"
                  onClick={() => setMobileSelfSection("home")}
                  aria-label="返回自己主页"
                >
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
                    <path d="M19 12H7M12 7l-5 5 5 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" strokeLinejoin="miter" />
                  </svg>
                </button>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[16px] font-semibold text-slate-900">
                    {mobileSelfSection === "profile" ? "我的资料" : mobileSelfSection === "cards" ? "名片夹" : "通知"}
                  </div>
                  <div className="mt-1 truncate text-xs text-slate-500">
                    {mobileSelfSection === "profile"
                      ? "这里只显示个人账号资料。"
                      : mobileSelfSection === "cards"
                        ? "这里统一管理个人名片夹。"
                        : "这里控制系统消息通知、提示音和震动。"}
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+5.85rem)] pt-4">
            {mobileSelfSection === "home" ? (
              <div className="space-y-4">
                <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
                  <div className="divide-y divide-slate-100">
                    {selfMenuItems.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-slate-50"
                        onClick={() => setMobileSelfSection(item.key)}
                      >
                        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                          {item.icon}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-slate-900">{item.label}</span>
                          <span className="mt-1 block truncate text-xs leading-5 text-slate-500">{item.summary}</span>
                        </span>
                        <span className="text-slate-300">
                          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                            <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="overflow-hidden rounded-[28px] border border-rose-200/80 bg-white shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-rose-50/70 disabled:opacity-50"
                    onClick={() => void requestLogout()}
                    disabled={loggingOut}
                  >
                    <div className="text-sm font-semibold text-rose-600">{loggingOut ? "退出中..." : "退出登录"}</div>
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600">
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                        <path d="M14 7h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M10 8 6 12l4 4M7 12h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </button>
                </section>
              </div>
            ) : mobileSelfSection === "profile" ? (
              <PersonalInfoPanel accountId={accountId} displayName={displayName} email={email} />
            ) : mobileSelfSection === "cards" ? (
              <EmptyFeatureCard
                icon={<Icon name="card" />}
                title="名片夹"
                description="个人名片夹会在下一步接入，这里会统一展示保存和可发送的名片。"
              />
            ) : (
              <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
                <div className="border-b border-slate-100 px-5 py-4">
                  <div className="text-sm font-semibold text-slate-900">通知</div>
                  <div className="mt-1 text-xs text-slate-500">个人用户通知设置会在下一步接入。</div>
                </div>
                <div className="divide-y divide-slate-100">
                  {["系统消息通知", "消息提示音", "震动"].map((label) => (
                    <div key={label} className="flex items-center gap-3 px-5 py-4">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-900">{label}</div>
                        <div className="mt-1 text-xs leading-5 text-slate-500">暂未开启，后续接入个人通知后可在这里控制。</div>
                      </div>
                      <span className="relative inline-flex h-7 w-12 shrink-0 items-center rounded-full bg-slate-200 opacity-55">
                        <span className="inline-block h-5 w-5 translate-x-1 rounded-full bg-white shadow-sm" />
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
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
