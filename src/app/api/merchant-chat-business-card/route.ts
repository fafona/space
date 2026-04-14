import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { MerchantListPublishedSite } from "@/data/homeBlocks";
import { readMerchantRequestAccessTokens } from "@/lib/merchantAuthSession";
import { normalizeMerchantBusinessCards, resolveMerchantBusinessCardForChatDisplay } from "@/lib/merchantBusinessCards";
import { listMerchantPeerContactsForMerchant } from "@/lib/merchantPeerInbox";
import {
  loadStoredMerchantPeerInbox,
  type MerchantPeerInboxStoreClient,
} from "@/lib/merchantPeerInboxStore";
import {
  buildPlatformMerchantSnapshotSite,
  upsertPlatformMerchantSnapshotSite,
} from "@/lib/platformMerchantSnapshot";
import {
  loadStoredPlatformMerchantSnapshot,
  savePlatformMerchantSnapshot,
  type PlatformMerchantSnapshotStoreClient,
} from "@/lib/platformMerchantSnapshotStore";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";
import { buildMerchantFrontendHref } from "@/lib/siteRouting";
import { isSuperAdminRequestAuthorized } from "@/lib/superAdminRequestAuth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type LoosePostgrestError = { message?: string } | null;
type LoosePostgrestResponse = {
  data?: unknown;
  error: LoosePostgrestError;
};
type LooseQueryBuilder = PromiseLike<LoosePostgrestResponse> & {
  select: (columns: string) => LooseQueryBuilder;
  eq: (column: string, value: unknown) => LooseQueryBuilder;
  limit: (value: number) => LooseQueryBuilder;
  maybeSingle: () => Promise<LoosePostgrestResponse>;
};
type LooseSupabaseClient = {
  from: (table: string) => LooseQueryBuilder;
  auth: {
    getUser: (token: string) => Promise<{
      data: { user: { id?: string; email?: string | null } | null };
      error: { message?: string } | null;
    }>;
  };
};

type MerchantRow = {
  id?: string | null;
  name?: string | null;
};

function readEnv(name: string) {
  return (process.env[name] ?? "").trim();
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeMerchantId(value: unknown) {
  const normalized = normalizeText(value);
  return /^\d{8}$/.test(normalized) ? normalized : "";
}

function normalizeExternalUrl(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  if (/^https?:\/\//i.test(normalized)) return normalized;
  return `https://${normalized.replace(/^\/+/, "")}`;
}

function isLocalOrIpHost(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    if (!hostname) return true;
    if (hostname === "localhost" || hostname === "0.0.0.0") return true;
    if (hostname === "::1" || hostname === "[::1]") return true;
    if (/^127(?:\.\d{1,3}){3}$/.test(hostname)) return true;
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return true;
    return false;
  } catch {
    return true;
  }
}

function buildSnapshotWebsiteHref(site: MerchantListPublishedSite | null, merchantId: string) {
  const explicitDomain = normalizeExternalUrl(site?.domain);
  if (explicitDomain && !isLocalOrIpHost(explicitDomain)) {
    return explicitDomain;
  }

  const domainPrefix = normalizeText(site?.domainPrefix || site?.domainSuffix);
  const publicBaseDomain = normalizeText(process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN);
  const builtHref = normalizeExternalUrl(
    buildMerchantFrontendHref(merchantId, domainPrefix || merchantId, publicBaseDomain || undefined),
  );
  if (builtHref && !isLocalOrIpHost(builtHref)) {
    return builtHref;
  }

  return explicitDomain || builtHref;
}

function buildFallbackChatBusinessCard(site: MerchantListPublishedSite | null, merchantId: string) {
  if (!site) return null;

  const imageUrl = normalizeText(site.merchantCardImageUrl) || normalizeText(site.chatAvatarImageUrl);
  const targetUrl = buildSnapshotWebsiteHref(site, merchantId);
  if (!imageUrl && !targetUrl) {
    return null;
  }

  const merchantName = normalizeText(site.merchantName) || normalizeText(site.name) || merchantId;
  const phone = normalizeText(site.contactPhone);
  const email = normalizeText(site.contactEmail);
  const address = [
    normalizeText(site.contactAddress),
    normalizeText(site.location?.city),
    normalizeText(site.location?.province),
    normalizeText(site.location?.country),
  ]
    .filter(Boolean)
    .join(" / ");

  return (
    normalizeMerchantBusinessCards([
      {
        id: `snapshot-fallback-${merchantId}`,
        createdAt: normalizeText(site.createdAt) || new Date(0).toISOString(),
        mode: targetUrl ? "link" : "image",
        name: merchantName,
        title: normalizeText(site.industry),
        imageUrl: imageUrl || normalizeText(site.chatAvatarImageUrl),
        shareImageUrl: imageUrl || undefined,
        contactPagePublicImageUrl: imageUrl || undefined,
        targetUrl,
        showInChat: true,
        contacts: {
          contactName: normalizeText(site.contactName) || merchantName,
          phone,
          phones: phone ? [phone] : [],
          email,
          address,
          wechat: "",
          whatsapp: "",
          twitter: "",
          weibo: "",
          telegram: "",
          linkedin: "",
          discord: "",
          facebook: "",
          instagram: "",
          tiktok: "",
          douyin: "",
          xiaohongshu: "",
        },
      },
    ])[0] ?? null
  );
}

function normalizeChatBusinessCard(value: unknown) {
  if (!value || typeof value !== "object") return null;
  return normalizeMerchantBusinessCards([value])[0] ?? null;
}

async function hasPeerMerchantAccess(
  supabase: LooseSupabaseClient,
  authorizedMerchantIds: Iterable<string>,
  merchantId: string,
) {
  const ownerMerchantIds = [...new Set(Array.from(authorizedMerchantIds).map((value) => normalizeMerchantId(value)).filter(Boolean))];
  if (ownerMerchantIds.length === 0) return false;
  const peerInbox = await loadStoredMerchantPeerInbox(supabase as unknown as MerchantPeerInboxStoreClient);
  return ownerMerchantIds.some((authorizedMerchantId) =>
    listMerchantPeerContactsForMerchant(peerInbox, authorizedMerchantId).some((contact) => contact.merchantId === merchantId),
  );
}

async function getAuthorizedMerchantIds(
  supabase: LooseSupabaseClient,
  userId: string,
  email: string,
) {
  const lookups: LooseQueryBuilder[] = [];

  if (userId) {
    ["user_id", "auth_user_id", "owner_user_id", "owner_id", "auth_id", "created_by", "created_by_user_id"].forEach(
      (column) => {
        lookups.push(supabase.from("merchants").select("id").eq(column, userId).limit(20));
      },
    );
  }

  if (email) {
    ["email", "owner_email", "contact_email", "user_email"].forEach((column) => {
      lookups.push(supabase.from("merchants").select("id").eq(column, email).limit(20));
    });
  }

  const settled = await Promise.allSettled(lookups);
  const merchantIds: string[] = [];
  settled.forEach((result) => {
    if (result.status !== "fulfilled" || result.value.error) return;
    ((result.value.data ?? []) as MerchantRow[]).forEach((row) => {
      const merchantId = normalizeMerchantId(row.id);
      if (!merchantId || merchantIds.includes(merchantId)) return;
      merchantIds.push(merchantId);
    });
  });
  return merchantIds;
}

async function isAuthorizedForMerchant(
  request: Request,
  supabase: LooseSupabaseClient,
  merchantId: string,
) {
  if (isSuperAdminRequestAuthorized(request)) {
    return true;
  }

  const authorizedMerchantIdSet = new Set<string>();

  const resolvedSession = await resolveMerchantSessionFromRequest(request);
  if (resolvedSession?.merchantId) {
    authorizedMerchantIdSet.add(resolvedSession.merchantId);
    if (resolvedSession.merchantId === merchantId) {
      return true;
    }
  }

  const accessTokens = readMerchantRequestAccessTokens(request);
  for (const accessToken of accessTokens) {
    const authResult = await supabase.auth.getUser(accessToken);
    if (authResult.error || !authResult.data.user) continue;

    const authorizedMerchantIds = await getAuthorizedMerchantIds(
      supabase,
      String(authResult.data.user.id ?? "").trim(),
      normalizeEmail(authResult.data.user.email),
    );
    authorizedMerchantIds.forEach((authorizedMerchantId) => {
      authorizedMerchantIdSet.add(authorizedMerchantId);
    });
    if (authorizedMerchantIds.includes(merchantId)) {
      return true;
    }
  }

  if (authorizedMerchantIdSet.size === 0) {
    return false;
  }

  return hasPeerMerchantAccess(supabase, authorizedMerchantIdSet, merchantId);
}

async function resolveMerchantName(supabase: LooseSupabaseClient, merchantId: string) {
  const { data, error } = await supabase
    .from("merchants")
    .select("id,name")
    .eq("id", merchantId)
    .limit(1)
    .maybeSingle();
  if (error) return merchantId;
  return normalizeText((data as MerchantRow | null)?.name) || merchantId;
}

export async function GET(request: Request) {
  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY") || readEnv("NEXT_SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "merchant_chat_business_card_env_missing" }, { status: 503 });
  }

  const merchantId = normalizeMerchantId(new URL(request.url).searchParams.get("merchantId"));
  if (!merchantId) {
    return NextResponse.json({ error: "invalid_merchant_id" }, { status: 400 });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }) as unknown as LooseSupabaseClient;

    const authorized = await isAuthorizedForMerchant(request, supabase, merchantId);
    if (!authorized) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const snapshotPayload = await loadStoredPlatformMerchantSnapshot(
      supabase as unknown as PlatformMerchantSnapshotStoreClient,
    );
    const snapshotSite = snapshotPayload?.snapshot.find((site) => site.id === merchantId) ?? null;
    const fallbackChatBusinessCard = buildFallbackChatBusinessCard(snapshotSite, merchantId);
    const resolvedChatBusinessCard =
      resolveMerchantBusinessCardForChatDisplay(snapshotSite?.businessCards ?? []) ??
      snapshotSite?.chatBusinessCard ??
      fallbackChatBusinessCard ??
      null;
    return NextResponse.json({
      ok: true,
      merchantId,
      profile: snapshotSite
        ? {
            ...snapshotSite,
            chatBusinessCard: resolvedChatBusinessCard,
          }
        : null,
      chatBusinessCard: resolvedChatBusinessCard,
      hasChatBusinessCard: !!resolvedChatBusinessCard,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "merchant_chat_business_card_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY") || readEnv("NEXT_SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "merchant_chat_business_card_env_missing" }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        merchantId?: unknown;
        businessCards?: unknown;
        chatBusinessCard?: unknown;
      }
    | null;
  const merchantId = normalizeMerchantId(body?.merchantId);
  if (!merchantId) {
    return NextResponse.json({ error: "invalid_merchant_id" }, { status: 400 });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }) as unknown as LooseSupabaseClient;

    const authorized = await isAuthorizedForMerchant(request, supabase, merchantId);
    if (!authorized) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const snapshotStore = supabase as unknown as PlatformMerchantSnapshotStoreClient;
    const existingPayload = await loadStoredPlatformMerchantSnapshot(snapshotStore);
    const existingSite = existingPayload?.snapshot.find((site) => site.id === merchantId) ?? null;
    const merchantName = existingSite?.merchantName || (await resolveMerchantName(supabase, merchantId));
    const normalizedBusinessCards = Object.prototype.hasOwnProperty.call(body ?? {}, "businessCards")
      ? normalizeMerchantBusinessCards(body?.businessCards)
      : normalizeMerchantBusinessCards(existingSite?.businessCards);
    const snapshotSite = buildPlatformMerchantSnapshotSite({
      id: merchantId,
      merchantName,
      signature: existingSite?.signature ?? "",
      domainPrefix: existingSite?.domainPrefix ?? existingSite?.domainSuffix ?? "",
      domainSuffix: existingSite?.domainSuffix ?? existingSite?.domainPrefix ?? "",
      name: existingSite?.name ?? merchantName,
      domain: existingSite?.domain ?? existingSite?.domainPrefix ?? merchantId,
      category: existingSite?.category ?? "",
      industry: existingSite?.industry ?? "",
      location: existingSite?.location ?? undefined,
      contactAddress: existingSite?.contactAddress ?? "",
      contactName: existingSite?.contactName ?? "",
      contactPhone: existingSite?.contactPhone ?? "",
      contactEmail: existingSite?.contactEmail ?? "",
      merchantCardImageUrl: existingSite?.merchantCardImageUrl ?? "",
      chatAvatarImageUrl: existingSite?.chatAvatarImageUrl ?? "",
      contactVisibility: existingSite?.contactVisibility,
      permissionConfig: existingSite?.permissionConfig ?? undefined,
      businessCards: normalizedBusinessCards,
      merchantCardImageOpacity: existingSite?.merchantCardImageOpacity ?? 1,
      status: existingSite?.status ?? "online",
      serviceExpiresAt: existingSite?.serviceExpiresAt ?? null,
      sortConfig: existingSite?.sortConfig ?? undefined,
      createdAt: existingSite?.createdAt ?? new Date().toISOString(),
      chatBusinessCard:
        resolveMerchantBusinessCardForChatDisplay(normalizedBusinessCards) ??
        normalizeChatBusinessCard(body?.chatBusinessCard) ??
        existingSite?.chatBusinessCard ??
        null,
    });
    if (!snapshotSite) {
      return NextResponse.json({ error: "merchant_chat_business_card_invalid" }, { status: 400 });
    }

    const saveResult = await savePlatformMerchantSnapshot(snapshotStore, {
      snapshot: upsertPlatformMerchantSnapshotSite(existingPayload?.snapshot ?? [], snapshotSite),
      defaultSortRule: existingPayload?.defaultSortRule ?? "created_desc",
      merchantConfigHistoryBySiteId: existingPayload?.merchantConfigHistoryBySiteId ?? {},
    });
    if (saveResult.error) {
      return NextResponse.json(
        { error: "merchant_chat_business_card_save_failed", message: saveResult.error },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      merchantId,
      hasChatBusinessCard: !!snapshotSite.chatBusinessCard,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "merchant_chat_business_card_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 500 },
    );
  }
}
