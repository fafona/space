import { NextResponse } from "next/server";
import { type MerchantAuthUserSummary } from "@/lib/merchantAuthIdentity";
import {
  readMerchantAuthCookie,
  readMerchantRequestAccessTokens,
} from "@/lib/merchantAuthSession";
import {
  listMerchantPeerThreadsForMerchant,
  type MerchantPeerMessage,
  type MerchantPeerThread,
} from "@/lib/merchantPeerInbox";
import {
  loadStoredMerchantPeerInbox,
  type MerchantPeerInboxStoreClient,
} from "@/lib/merchantPeerInboxStore";
import {
  loadStoredPlatformSupportInbox,
  type PlatformSupportInboxStoreClient,
} from "@/lib/platformSupportInboxStore";
import { listMerchantBookings } from "@/lib/merchantBookings.server";
import {
  isMerchantBookingPendingMerchantTouch,
  type MerchantBookingRecord,
} from "@/lib/merchantBookings";
import { listMerchantOrders } from "@/lib/merchantOrders.server";
import {
  formatMerchantOrderAmount,
  isMerchantOrderPendingMerchantTouch,
  type MerchantOrderRecord,
} from "@/lib/merchantOrders";
import {
  resolvePlatformAccountIdentityForUser,
  type PlatformIdentitySupabaseClient,
} from "@/lib/platformAccountIdentity";
import { readPlatformUsernameFromMetadata } from "@/lib/platformAccounts";
import { createServerSupabaseAuthClient, createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type NativeNotificationSessionHintInput = {
  siteId?: unknown;
  merchantEmail?: unknown;
  merchantName?: unknown;
} | null;

type NativeNotificationCandidate = {
  key: string;
  title: string;
  body: string;
  url: string;
  createdAt: string;
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown) {
  return trimText(value).toLowerCase();
}

function normalizeMerchantId(value: unknown) {
  const normalized = trimText(value);
  return /^\d{8}$/.test(normalized) ? normalized : "";
}

function normalizeIsoString(value: unknown) {
  const normalized = trimText(value);
  if (!normalized) return "";
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function normalizeLastReadMap(value: unknown) {
  const normalized = trimText(value);
  if (!normalized) return {} as Record<string, string>;
  try {
    const parsed = JSON.parse(normalized) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([key, timestamp]) => [normalizeMerchantId(key), normalizeIsoString(timestamp)] as const)
        .filter(([key, timestamp]) => key && timestamp),
    );
  } catch {
    return {};
  }
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

async function resolveNativeNotificationSession(request: Request, hint?: NativeNotificationSessionHintInput) {
  const merchantSession = await resolveMerchantSessionFromRequest(request, {
    hintedMerchantId: normalizeMerchantId(hint?.siteId),
    hintedMerchantEmail: normalizeEmail(hint?.merchantEmail),
    hintedMerchantName: trimText(hint?.merchantName),
  });
  if (merchantSession) return merchantSession;

  const authSupabase = createServerSupabaseAuthClient();
  const adminSupabase = createServerSupabaseServiceClient() as unknown as PlatformIdentitySupabaseClient | null;
  if (!authSupabase) return null;

  const accessTokens = readMerchantRequestAccessTokens(request);
  const fallbackAccessToken = readMerchantAuthCookie(request);
  const candidates = [...accessTokens, fallbackAccessToken].map((value) => trimText(value)).filter(Boolean);
  let user: MerchantAuthUserSummary | null = null;
  for (const accessToken of candidates) {
    const { data, error } = await authSupabase.auth
      .getUser(accessToken)
      .catch(() => ({ data: null, error: true }));
    if (!error && data?.user) {
      user = data.user as MerchantAuthUserSummary;
      break;
    }
  }
  if (!user) return null;

  const identity = await resolvePlatformAccountIdentityForUser(adminSupabase, user);
  if (identity.accountType !== "personal" || !identity.accountId) return null;

  return {
    merchantId: identity.accountId,
    merchantEmail: normalizeEmail(user.email),
    merchantName: trimText(hint?.merchantName) || readPlatformUsernameFromMetadata(user) || normalizeEmail(user.email),
  };
}

function buildPreview(text: string, maxLength = 88) {
  const normalized = trimText(text).replace(/\s+/g, " ").trim();
  if (!normalized) return "你有一条新消息";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`;
}

function normalizeNotificationTimestamp(value: unknown, fallback: unknown = "") {
  return normalizeIsoString(value) || normalizeIsoString(fallback) || new Date(0).toISOString();
}

function formatNotificationDateTime(value: unknown) {
  const normalized = normalizeIsoString(value);
  if (!normalized) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(normalized));
}

function compareCandidate(left: NativeNotificationCandidate | null, right: NativeNotificationCandidate | null) {
  if (!left) return right;
  if (!right) return left;
  const leftTs = new Date(left.createdAt).getTime();
  const rightTs = new Date(right.createdAt).getTime();
  if (rightTs > leftTs) return right;
  if (rightTs < leftTs) return left;
  return right.key > left.key ? right : left;
}

function getPeerContactId(thread: MerchantPeerThread, merchantId: string) {
  if (thread.merchantAId === merchantId) return thread.merchantBId;
  if (thread.merchantBId === merchantId) return thread.merchantAId;
  return "";
}

function getPeerContactName(thread: MerchantPeerThread, merchantId: string) {
  if (thread.merchantAId === merchantId) return thread.merchantBName || thread.merchantBId;
  if (thread.merchantBId === merchantId) return thread.merchantAName || thread.merchantAId;
  return "";
}

function buildPeerCandidate(input: {
  merchantId: string;
  contactId: string;
  contactName: string;
  message: MerchantPeerMessage;
}) {
  return {
    key: `peer:${input.contactId}:${input.message.id}:${input.message.createdAt}`,
    title: `新消息 - ${input.contactName || input.contactId}`,
    body: buildPreview(input.message.text),
    url: `/${input.merchantId}?support=merchant:${input.contactId}&appShell=faolla`,
    createdAt: input.message.createdAt,
  } satisfies NativeNotificationCandidate;
}

function buildBookingCandidate(merchantId: string, booking: MerchantBookingRecord) {
  const createdAt = normalizeNotificationTimestamp(booking.updatedAt, booking.createdAt);
  const customerName = trimText(booking.customerName) || "客户";
  const serviceParts = [trimText(booking.store), trimText(booking.item) || trimText(booking.title)].filter(Boolean);
  const appointmentText = formatNotificationDateTime(booking.appointmentAt);
  return {
    key: `booking:${booking.id}`,
    title: `新预约 - ${customerName}`,
    body: buildPreview([serviceParts.join(" · "), appointmentText].filter(Boolean).join(" · ") || "有新的预约需要处理"),
    url: `/${merchantId}?mobileTab=business&businessSection=booking&appShell=faolla`,
    createdAt,
  } satisfies NativeNotificationCandidate;
}

function buildOrderCandidate(merchantId: string, order: MerchantOrderRecord) {
  const createdAt = normalizeNotificationTimestamp(order.updatedAt, order.createdAt);
  const customerName = trimText(order.customer?.name) || trimText(order.customer?.phone) || "客户";
  const itemSummary =
    order.items
      .slice(0, 2)
      .map((item) => {
        const name = trimText(item.name) || trimText(item.code) || "商品";
        return item.quantity > 1 ? `${name}×${item.quantity}` : name;
      })
      .filter(Boolean)
      .join("、") || `${Math.max(1, order.totalQuantity)}件商品`;
  const amount = formatMerchantOrderAmount(order.totalAmount, order.pricePrefix);
  return {
    key: `order:${order.id}`,
    title: `新订单 - ${customerName}`,
    body: buildPreview([itemSummary, amount].filter(Boolean).join(" · ") || "有新的订单需要处理"),
    url: `/${merchantId}?mobileTab=business&businessSection=orders&appShell=faolla`,
    createdAt,
  } satisfies NativeNotificationCandidate;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const hint = {
    siteId: url.searchParams.get("siteId"),
    merchantEmail: url.searchParams.get("merchantEmail"),
    merchantName: url.searchParams.get("merchantName"),
  };
  const session = await resolveNativeNotificationSession(request, hint);
  if (!session) {
    return noStoreJson({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServerSupabaseServiceClient();
  if (!supabase) {
    return noStoreJson({ error: "merchant_native_notification_env_missing" }, { status: 503 });
  }

  const merchantId = session.merchantId;
  const officialLastReadAt = normalizeIsoString(url.searchParams.get("officialLastReadAt"));
  const peerLastReadMap = normalizeLastReadMap(url.searchParams.get("peerLastRead"));
  const officialLastReadTs = new Date(officialLastReadAt || 0).getTime();

  const [supportPayload, peerPayload, bookingRecords, orderRecords] = await Promise.all([
    loadStoredPlatformSupportInbox(supabase as unknown as PlatformSupportInboxStoreClient),
    loadStoredMerchantPeerInbox(supabase as unknown as MerchantPeerInboxStoreClient),
    listMerchantBookings(merchantId, { includeAutomationState: true }).catch(() => [] as MerchantBookingRecord[]),
    listMerchantOrders(merchantId).catch(() => [] as MerchantOrderRecord[]),
  ]);

  let unreadCount = 0;
  let latest: NativeNotificationCandidate | null = null;

  const supportThread = supportPayload.threads.find((item) => item.merchantId === merchantId) ?? null;
  (supportThread?.messages ?? []).forEach((message) => {
    if (message.sender !== "super_admin") return;
    const createdAt = normalizeIsoString(message.createdAt);
    const createdAtTs = new Date(createdAt || 0).getTime();
    if (!createdAt || createdAtTs <= officialLastReadTs) return;
    unreadCount += 1;
    latest = compareCandidate(latest, {
      key: `official:${message.id}:${message.createdAt}`,
      title: "Faolla 官方回复",
      body: buildPreview(message.text),
      url: `/${merchantId}?support=official&appShell=faolla`,
      createdAt: message.createdAt,
    });
  });

  const peerThreads = listMerchantPeerThreadsForMerchant(peerPayload, merchantId);
  peerThreads.forEach((thread) => {
    const contactId = getPeerContactId(thread, merchantId);
    if (!contactId) return;
    const contactName = getPeerContactName(thread, merchantId);
    const lastReadTs = new Date(peerLastReadMap[contactId] || 0).getTime();
    thread.messages.forEach((message) => {
      if (message.senderMerchantId === merchantId) return;
      const createdAt = normalizeIsoString(message.createdAt);
      const createdAtTs = new Date(createdAt || 0).getTime();
      if (!createdAt || createdAtTs <= lastReadTs) return;
      unreadCount += 1;
      latest = compareCandidate(latest, buildPeerCandidate({ merchantId, contactId, contactName, message }));
    });
  });

  bookingRecords.forEach((booking) => {
    if (booking.status !== "active" || !isMerchantBookingPendingMerchantTouch(booking)) return;
    unreadCount += 1;
    latest = compareCandidate(latest, buildBookingCandidate(merchantId, booking));
  });

  orderRecords.forEach((order) => {
    if (order.status !== "pending" || !isMerchantOrderPendingMerchantTouch(order)) return;
    unreadCount += 1;
    latest = compareCandidate(latest, buildOrderCandidate(merchantId, order));
  });

  return noStoreJson({
    ok: true,
    merchantId,
    unreadCount: Math.max(0, Math.min(999, unreadCount)),
    latest,
  });
}
