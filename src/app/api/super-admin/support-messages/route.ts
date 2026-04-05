import { NextResponse } from "next/server";
import {
  createPlatformSupportMessage,
  upsertPlatformSupportThread,
} from "@/lib/platformSupportInbox";
import {
  loadStoredPlatformSupportInbox,
  savePlatformSupportInbox,
  type PlatformSupportInboxStoreClient,
} from "@/lib/platformSupportInboxStore";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import { isSuperAdminRequestAuthorized } from "@/lib/superAdminRequestAuth";
import { notifyMerchantPushSubscribers } from "@/lib/webPush";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSupportText(value: unknown) {
  return trimText(value).slice(0, 5000);
}

function buildPushPreview(text: string) {
  const normalized = normalizeSupportText(text).replace(/\s+/g, " ").trim();
  return normalized.length > 88 ? `${normalized.slice(0, 88)}…` : normalized;
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

function isAuthorized(request: Request) {
  return isSuperAdminRequestAuthorized(request);
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return noStoreJson({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServerSupabaseServiceClient();
  if (!supabase) {
    return noStoreJson({ error: "support_inbox_env_missing" }, { status: 503 });
  }

  const payload = await loadStoredPlatformSupportInbox(supabase as unknown as PlatformSupportInboxStoreClient);
  return noStoreJson({
    ok: true,
    threads: payload.threads,
  });
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return noStoreJson({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServerSupabaseServiceClient();
  if (!supabase) {
    return noStoreJson({ error: "support_inbox_env_missing" }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        merchantId?: unknown;
        siteId?: unknown;
        merchantName?: unknown;
        merchantEmail?: unknown;
        text?: unknown;
      }
    | null;
  const merchantId = trimText(body?.merchantId);
  const text = normalizeSupportText(body?.text);
  if (!merchantId || !text) {
    return noStoreJson({ error: "support_reply_invalid_payload" }, { status: 400 });
  }

  const payload = await loadStoredPlatformSupportInbox(supabase as unknown as PlatformSupportInboxStoreClient);
  const nextPayload = upsertPlatformSupportThread(payload, {
    merchantId,
    siteId: trimText(body?.siteId) || merchantId,
    merchantName: trimText(body?.merchantName),
    merchantEmail: trimText(body?.merchantEmail).toLowerCase(),
    message: createPlatformSupportMessage({
      sender: "super_admin",
      text,
    }),
  });
  const saveResult = await savePlatformSupportInbox(supabase as unknown as PlatformSupportInboxStoreClient, nextPayload);
  if (saveResult.error) {
    return noStoreJson(
      {
        error: "support_reply_save_failed",
        message: saveResult.error,
      },
      { status: 500 },
    );
  }

  await notifyMerchantPushSubscribers(supabase as unknown as PlatformSupportInboxStoreClient, {
    merchantId,
    title: "Faolla 官方",
    body: buildPushPreview(text),
    url: `/${merchantId}?support=official`,
    tag: `support:${merchantId}`,
  }).catch(() => {
    // Ignore notification delivery failures; the saved reply should still succeed.
  });

  return noStoreJson({
    ok: true,
    threads: nextPayload.threads,
    thread: nextPayload.threads.find((item) => item.merchantId === merchantId) ?? null,
  });
}
