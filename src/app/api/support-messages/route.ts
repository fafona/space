import { NextResponse } from "next/server";
import { OFFICIAL_SERVICE_CONTACT } from "@/lib/merchantServiceStatus";
import {
  createPlatformSupportMessage,
  upsertPlatformSupportThread,
  type PlatformSupportThread,
} from "@/lib/platformSupportInbox";
import {
  loadStoredPlatformSupportInbox,
  savePlatformSupportInbox,
  type PlatformSupportInboxStoreClient,
} from "@/lib/platformSupportInboxStore";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSupportText(value: unknown) {
  return trimText(value).slice(0, 5000);
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

function buildThreadResponse(thread: PlatformSupportThread | null, merchantId: string, merchantEmail = "") {
  return (
    thread ?? {
      merchantId,
      siteId: merchantId,
      merchantName: "",
      merchantEmail,
      updatedAt: "",
      messages: [],
    }
  );
}

export async function GET(request: Request) {
  const session = await resolveMerchantSessionFromRequest(request);
  if (!session) {
    return noStoreJson({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServerSupabaseServiceClient();
  if (!supabase) {
    return noStoreJson({ error: "support_inbox_env_missing" }, { status: 503 });
  }

  const payload = await loadStoredPlatformSupportInbox(supabase as unknown as PlatformSupportInboxStoreClient);
  const thread = payload.threads.find((item) => item.merchantId === session.merchantId) ?? null;
  return noStoreJson({
    ok: true,
    thread: buildThreadResponse(thread, session.merchantId, thread?.merchantEmail || session.merchantEmail),
    officialContact: OFFICIAL_SERVICE_CONTACT,
  });
}

export async function POST(request: Request) {
  const session = await resolveMerchantSessionFromRequest(request);
  if (!session) {
    return noStoreJson({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServerSupabaseServiceClient();
  if (!supabase) {
    return noStoreJson({ error: "support_inbox_env_missing" }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        text?: unknown;
        merchantName?: unknown;
        merchantEmail?: unknown;
        siteId?: unknown;
      }
    | null;
  const text = normalizeSupportText(body?.text);
  if (!text) {
    return noStoreJson({ error: "support_message_empty" }, { status: 400 });
  }

  const payload = await loadStoredPlatformSupportInbox(supabase as unknown as PlatformSupportInboxStoreClient);
  const nextPayload = upsertPlatformSupportThread(payload, {
    merchantId: session.merchantId,
    siteId: trimText(body?.siteId) || session.merchantId,
    merchantName: trimText(body?.merchantName),
    merchantEmail: trimText(body?.merchantEmail).toLowerCase() || session.merchantEmail,
    message: createPlatformSupportMessage({
      sender: "merchant",
      text,
    }),
  });
  const saveResult = await savePlatformSupportInbox(supabase as unknown as PlatformSupportInboxStoreClient, nextPayload);
  if (saveResult.error) {
    return noStoreJson(
      {
        error: "support_message_save_failed",
        message: saveResult.error,
      },
      { status: 500 },
    );
  }

  const thread = nextPayload.threads.find((item) => item.merchantId === session.merchantId) ?? null;
  return noStoreJson({
    ok: true,
    thread: buildThreadResponse(thread, session.merchantId, thread?.merchantEmail || session.merchantEmail),
  });
}
