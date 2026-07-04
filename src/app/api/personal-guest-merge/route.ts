import { NextResponse } from "next/server";
import { attachPersonalMerchantBookingsByGuestHash } from "@/lib/merchantBookings.server";
import { attachPersonalMerchantOrdersByGuestHash } from "@/lib/merchantOrders.server";
import { readPersonalCustomerProfileFromSession } from "@/lib/personalCustomerProfile";
import { hashPersonalGuestMergeToken } from "@/lib/personalGuestMerge.server";
import { resolvePersonalAccountSessionFromRequest } from "@/lib/personalAccountSession.server";
import { createPlatformSupportMessage, upsertPlatformSupportThread } from "@/lib/platformSupportInbox";
import {
  loadStoredPlatformSupportInbox,
  savePlatformSupportInbox,
  type PlatformSupportInboxStoreClient,
} from "@/lib/platformSupportInboxStore";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function trimText(value: unknown, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeIsoString(value: unknown) {
  const normalized = trimText(value, 80);
  if (!normalized) return "";
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function normalizeOrderRefs(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const refs: Array<{ siteId: string; orderId: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const siteId = trimText(record.siteId, 32);
    const orderId = trimText(record.orderId || record.id, 160);
    const key = `${siteId}:${orderId}`;
    if (!siteId || !orderId || seen.has(key)) continue;
    seen.add(key);
    refs.push({ siteId, orderId });
    if (refs.length >= 200) break;
  }
  return refs;
}

function normalizeBookingRefs(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const refs: Array<{ siteId: string; bookingId: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const siteId = trimText(record.siteId, 32);
    const bookingId = trimText(record.bookingId || record.id, 160);
    const key = `${siteId}:${bookingId}`;
    if (!siteId || !bookingId || seen.has(key)) continue;
    seen.add(key);
    refs.push({ siteId, bookingId });
    if (refs.length >= 200) break;
  }
  return refs;
}

function normalizeSupportMessages(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const messages: Array<{ id: string; text: string; createdAt: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const text = trimText(record.text, 5000);
    if (!text) continue;
    const id = trimText(record.id, 160) || `guest-support-${messages.length + 1}`;
    if (seen.has(id)) continue;
    seen.add(id);
    messages.push({
      id,
      text,
      createdAt: normalizeIsoString(record.createdAt) || new Date().toISOString(),
    });
    if (messages.length >= 200) break;
  }
  return messages;
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }

  const session = await resolvePersonalAccountSessionFromRequest(request);
  if (!session) return noStoreJson({ ok: false, error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as
    | {
        guestMergeToken?: unknown;
        orders?: unknown;
        bookings?: unknown;
        supportMessages?: unknown;
      }
    | null;
  const guestHash = hashPersonalGuestMergeToken(body?.guestMergeToken);
  if (!guestHash) return noStoreJson({ ok: false, error: "invalid_guest_merge_token" }, { status: 400 });

  const orderRefs = normalizeOrderRefs(body?.orders);
  const bookingRefs = normalizeBookingRefs(body?.bookings);
  const supportMessages = normalizeSupportMessages(body?.supportMessages);

  const [attachedOrders, attachedBookings] = await Promise.all([
    attachPersonalMerchantOrdersByGuestHash({
      guestHash,
      accountId: session.accountId,
      userId: session.userId,
      email: session.email,
      records: orderRefs,
    }),
    attachPersonalMerchantBookingsByGuestHash({
      guestHash,
      accountId: session.accountId,
      userId: session.userId,
      email: session.email,
      records: bookingRefs,
    }),
  ]);

  let supportMessageCount = 0;
  if (supportMessages.length > 0) {
    const supabase = createServerSupabaseServiceClient();
    if (supabase) {
      const profile = readPersonalCustomerProfileFromSession({
        authenticated: true,
        accountType: "personal",
        accountId: session.accountId,
        user: session.user,
      });
      let payload = await loadStoredPlatformSupportInbox(supabase as unknown as PlatformSupportInboxStoreClient);
      const thread = payload.threads.find((item) => item.merchantId === session.accountId) ?? null;
      const existingIds = new Set((thread?.messages ?? []).map((message) => message.id));
      for (const message of supportMessages) {
        const messageId = `guest:${guestHash.slice(7, 19)}:${message.id}`;
        if (existingIds.has(messageId)) continue;
        existingIds.add(messageId);
        supportMessageCount += 1;
        payload = upsertPlatformSupportThread(payload, {
          merchantId: session.accountId,
          siteId: session.accountId,
          merchantName: profile.name || session.email || session.accountId,
          merchantEmail: session.email,
          message: createPlatformSupportMessage({
            id: messageId,
            sender: "merchant",
            text: message.text,
            createdAt: message.createdAt,
          }),
        });
      }
      if (supportMessageCount > 0) {
        const saveResult = await savePlatformSupportInbox(supabase as unknown as PlatformSupportInboxStoreClient, payload);
        if (saveResult.error) {
          return noStoreJson(
            { ok: false, error: "support_message_save_failed", message: saveResult.error },
            { status: 500 },
          );
        }
      }
    }
  }

  return noStoreJson({
    ok: true,
    orders: attachedOrders,
    bookings: attachedBookings,
    supportMessageCount,
  });
}
