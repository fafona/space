import { NextResponse } from "next/server";
import { OFFICIAL_SERVICE_CONTACT } from "@/lib/merchantServiceStatus";
import { type MerchantAuthUserSummary } from "@/lib/merchantAuthIdentity";
import {
  readMerchantAuthCookie,
  readMerchantRequestAccessTokens,
} from "@/lib/merchantAuthSession";
import {
  resolvePlatformAccountIdentityForUser,
  type PlatformIdentitySupabaseClient,
} from "@/lib/platformAccountIdentity";
import { readPlatformUsernameFromMetadata } from "@/lib/platformAccounts";
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
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { createServerSupabaseAuthClient, createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SupportSessionHintInput = {
  siteId?: unknown;
  merchantEmail?: unknown;
  merchantName?: unknown;
} | null;

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSupportText(value: unknown) {
  return trimText(value).slice(0, 5000);
}

function normalizeSupportEmail(value: unknown) {
  return trimText(value).toLowerCase();
}

function normalizeMerchantId(value: unknown) {
  const normalized = trimText(value);
  return /^\d{8}$/.test(normalized) ? normalized : "";
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

async function resolveSupportSession(request: Request, hint?: SupportSessionHintInput) {
  const merchantSession = await resolveMerchantSessionFromRequest(request, {
    hintedMerchantId: normalizeMerchantId(hint?.siteId),
    hintedMerchantEmail: normalizeSupportEmail(hint?.merchantEmail),
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
    merchantEmail: normalizeSupportEmail(user.email),
    merchantName: trimText(hint?.merchantName) || readPlatformUsernameFromMetadata(user) || normalizeSupportEmail(user.email),
  };
}

export async function GET(request: Request) {
  const session = await resolveSupportSession(request);
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
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }

  const body = (await request.json().catch(() => null)) as
    | {
        text?: unknown;
        merchantName?: unknown;
        merchantEmail?: unknown;
        siteId?: unknown;
      }
    | null;
  const session = await resolveSupportSession(request, body);
  if (!session) {
    return noStoreJson({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServerSupabaseServiceClient();
  if (!supabase) {
    return noStoreJson({ error: "support_inbox_env_missing" }, { status: 503 });
  }

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
