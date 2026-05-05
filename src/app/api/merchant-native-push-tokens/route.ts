import { NextResponse } from "next/server";
import {
  removeMerchantNativePushToken,
  setMerchantNativePushTokenBadgeCount,
  upsertMerchantNativePushToken,
} from "@/lib/merchantNativePushTokens";
import {
  loadStoredMerchantNativePushTokens,
  saveStoredMerchantNativePushTokens,
  type MerchantNativePushTokenStoreClient,
} from "@/lib/merchantNativePushTokenStore";
import { isMerchantNativePushConfigured } from "@/lib/firebaseCloudMessaging";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

function normalizeBadgeCount(value: unknown) {
  const numeric =
    typeof value === "number" && Number.isFinite(value)
      ? Math.round(value)
      : Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(999, numeric));
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | {
        action?: unknown;
        token?: unknown;
        platform?: unknown;
        siteId?: unknown;
        merchantName?: unknown;
        merchantEmail?: unknown;
        unreadCount?: unknown;
      }
    | null;

  const session = await resolveMerchantSessionFromRequest(request, {
    hintedMerchantId: normalizeMerchantId(body?.siteId),
    hintedMerchantEmail: normalizeEmail(body?.merchantEmail),
    hintedMerchantName: trimText(body?.merchantName),
  });
  if (!session) {
    return noStoreJson({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServerSupabaseServiceClient();
  if (!supabase) {
    return noStoreJson({ error: "merchant_native_push_env_missing" }, { status: 503 });
  }

  const token = trimText(body?.token);
  if (!token) {
    return noStoreJson({ error: "merchant_native_push_token_invalid" }, { status: 400 });
  }

  const payload = await loadStoredMerchantNativePushTokens(
    supabase as unknown as MerchantNativePushTokenStoreClient,
  );
  const action = trimText(body?.action);

  if (action === "register") {
    const nextPayload = upsertMerchantNativePushToken(payload, {
      token,
      platform: "android",
      merchantId: session.merchantId,
      merchantName: trimText(body?.merchantName) || session.merchantName,
      merchantEmail: normalizeEmail(body?.merchantEmail) || session.merchantEmail,
      badgeCount: normalizeBadgeCount(body?.unreadCount),
      userAgent: trimText(request.headers.get("user-agent")),
    });
    const saveResult = await saveStoredMerchantNativePushTokens(
      supabase as unknown as MerchantNativePushTokenStoreClient,
      nextPayload,
    );
    if (saveResult.error) {
      return noStoreJson({ error: "merchant_native_push_token_save_failed", message: saveResult.error }, { status: 500 });
    }
    return noStoreJson({
      ok: true,
      configured: isMerchantNativePushConfigured(),
    });
  }

  if (action === "unregister") {
    const nextPayload = removeMerchantNativePushToken(payload, token);
    const saveResult = await saveStoredMerchantNativePushTokens(
      supabase as unknown as MerchantNativePushTokenStoreClient,
      nextPayload,
    );
    if (saveResult.error) {
      return noStoreJson({ error: "merchant_native_push_token_remove_failed", message: saveResult.error }, { status: 500 });
    }
    return noStoreJson({ ok: true });
  }

  if (action === "sync-badge") {
    const nextPayload = setMerchantNativePushTokenBadgeCount(payload, token, normalizeBadgeCount(body?.unreadCount));
    const saveResult = await saveStoredMerchantNativePushTokens(
      supabase as unknown as MerchantNativePushTokenStoreClient,
      nextPayload,
    );
    if (saveResult.error) {
      return noStoreJson({ error: "merchant_native_push_badge_sync_failed", message: saveResult.error }, { status: 500 });
    }
    return noStoreJson({ ok: true });
  }

  return noStoreJson({ error: "unsupported_action" }, { status: 400 });
}
