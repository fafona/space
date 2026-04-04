import { NextResponse } from "next/server";
import {
  removeMerchantPushSubscription,
  upsertMerchantPushSubscription,
  type MerchantPushPermission,
  type MerchantWebPushSubscription,
} from "@/lib/merchantPushSubscriptions";
import {
  loadStoredMerchantPushSubscriptions,
  saveStoredMerchantPushSubscriptions,
  type MerchantPushSubscriptionStoreClient,
} from "@/lib/merchantPushSubscriptionStore";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import {
  isMerchantWebPushConfigured,
  readMerchantWebPushPublicKey,
  syncMerchantPushBadgeCountForSubscription,
} from "@/lib/webPush";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type MerchantPushSessionHintInput = {
  siteId?: unknown;
  merchantEmail?: unknown;
  merchantName?: unknown;
} | null;

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

function normalizePermission(value: unknown): MerchantPushPermission {
  const normalized = trimText(value);
  if (normalized === "granted" || normalized === "denied" || normalized === "unsupported") {
    return normalized;
  }
  return "default";
}

function normalizeBadgeCount(value: unknown) {
  const numeric =
    typeof value === "number" && Number.isFinite(value)
      ? Math.round(value)
      : Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(999, numeric));
}

function normalizeSubscription(value: unknown): MerchantWebPushSubscription | null {
  if (!value || typeof value !== "object") return null;
  const source = value as MerchantWebPushSubscription;
  const endpoint = trimText(source.endpoint);
  if (!endpoint) return null;
  const p256dh = trimText(source.keys?.p256dh);
  const auth = trimText(source.keys?.auth);
  return {
    endpoint,
    expirationTime:
      typeof source.expirationTime === "number" && Number.isFinite(source.expirationTime)
        ? source.expirationTime
        : null,
    keys: p256dh || auth ? { p256dh, auth } : undefined,
  };
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

function buildFallbackMerchantPushSession(request: Request, hint?: MerchantPushSessionHintInput) {
  const url = new URL(request.url);
  const merchantId =
    normalizeMerchantId(hint?.siteId) ||
    normalizeMerchantId(url.searchParams.get("siteId")) ||
    normalizeMerchantId(request.headers.get("x-merchant-site-id"));
  if (!merchantId) return null;
  return {
    merchantId,
    merchantEmail:
      normalizeEmail(hint?.merchantEmail) ||
      normalizeEmail(url.searchParams.get("merchantEmail")) ||
      normalizeEmail(request.headers.get("x-merchant-email")),
    merchantName:
      trimText(hint?.merchantName) ||
      trimText(url.searchParams.get("merchantName")) ||
      trimText(request.headers.get("x-merchant-name")),
  };
}

async function resolveMerchantPushSession(request: Request, hint?: MerchantPushSessionHintInput) {
  const session = await resolveMerchantSessionFromRequest(request);
  if (session) return session;
  return buildFallbackMerchantPushSession(request, hint);
}

export async function GET(request: Request) {
  const session = await resolveMerchantPushSession(request);
  if (!session) {
    return noStoreJson({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServerSupabaseServiceClient();
  if (!supabase) {
    return noStoreJson({ error: "merchant_push_env_missing" }, { status: 503 });
  }

  const payload = await loadStoredMerchantPushSubscriptions(
    supabase as unknown as MerchantPushSubscriptionStoreClient,
  );
  const currentSubscriptions = payload.subscriptions.filter((item) => item.merchantId === session.merchantId);
  return noStoreJson({
    ok: true,
    configured: isMerchantWebPushConfigured(),
    publicKeyPresent: Boolean(readMerchantWebPushPublicKey()),
    subscriptions: currentSubscriptions.map((item) => ({
      endpoint: item.endpoint,
      badgeCount: item.badgeCount,
      permission: item.permission,
      updatedAt: item.updatedAt,
    })),
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | {
        action?: unknown;
        siteId?: unknown;
        merchantName?: unknown;
        merchantEmail?: unknown;
        subscription?: unknown;
        endpoint?: unknown;
        unreadCount?: unknown;
        permission?: unknown;
        userAgent?: unknown;
      }
    | null;

  const session = await resolveMerchantPushSession(request, body);
  if (!session) {
    return noStoreJson({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServerSupabaseServiceClient();
  if (!supabase) {
    return noStoreJson({ error: "merchant_push_env_missing" }, { status: 503 });
  }

  const action = trimText(body?.action);
  if (action === "subscribe") {
    if (!isMerchantWebPushConfigured()) {
      return noStoreJson({ error: "merchant_web_push_not_configured" }, { status: 503 });
    }
    const subscription = normalizeSubscription(body?.subscription);
    if (!subscription) {
      return noStoreJson({ error: "merchant_push_subscription_invalid" }, { status: 400 });
    }
    const payload = await loadStoredMerchantPushSubscriptions(
      supabase as unknown as MerchantPushSubscriptionStoreClient,
    );
    const nextPayload = upsertMerchantPushSubscription(payload, {
      merchantId: session.merchantId,
      merchantName: trimText(body?.merchantName) || session.merchantName,
      merchantEmail: normalizeEmail(body?.merchantEmail) || session.merchantEmail,
      subscription,
      permission: normalizePermission(body?.permission),
      userAgent: trimText(body?.userAgent) || trimText(request.headers.get("user-agent")),
    });
    const saveResult = await saveStoredMerchantPushSubscriptions(
      supabase as unknown as MerchantPushSubscriptionStoreClient,
      nextPayload,
    );
    if (saveResult.error) {
      return noStoreJson({ error: "merchant_push_subscription_save_failed", message: saveResult.error }, { status: 500 });
    }
    return noStoreJson({
      ok: true,
      endpoint: subscription.endpoint,
      configured: true,
    });
  }

  if (action === "unsubscribe") {
    const endpoint = trimText(body?.endpoint) || trimText((body?.subscription as MerchantWebPushSubscription | null)?.endpoint);
    if (!endpoint) {
      return noStoreJson({ error: "merchant_push_subscription_invalid" }, { status: 400 });
    }
    const payload = await loadStoredMerchantPushSubscriptions(
      supabase as unknown as MerchantPushSubscriptionStoreClient,
    );
    const nextPayload = removeMerchantPushSubscription(payload, endpoint);
    const saveResult = await saveStoredMerchantPushSubscriptions(
      supabase as unknown as MerchantPushSubscriptionStoreClient,
      nextPayload,
    );
    if (saveResult.error) {
      return noStoreJson({ error: "merchant_push_subscription_remove_failed", message: saveResult.error }, { status: 500 });
    }
    return noStoreJson({
      ok: true,
      endpoint,
    });
  }

  if (action === "sync-badge") {
    const endpoint = trimText(body?.endpoint) || trimText((body?.subscription as MerchantWebPushSubscription | null)?.endpoint);
    if (!endpoint) {
      return noStoreJson({ error: "merchant_push_subscription_invalid" }, { status: 400 });
    }
    const saveResult = await syncMerchantPushBadgeCountForSubscription(
      supabase as unknown as MerchantPushSubscriptionStoreClient,
      session.merchantId,
      endpoint,
      normalizeBadgeCount(body?.unreadCount),
      normalizePermission(body?.permission),
    );
    if (saveResult.error) {
      return noStoreJson({ error: "merchant_push_badge_sync_failed", message: saveResult.error }, { status: 500 });
    }
    return noStoreJson({ ok: true });
  }

  return noStoreJson({ error: "unsupported_action" }, { status: 400 });
}
