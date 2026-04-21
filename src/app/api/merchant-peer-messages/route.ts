import { NextResponse } from "next/server";
import type { MerchantListPublishedSite } from "@/data/homeBlocks";
import {
  createMerchantPeerMessage,
  findMerchantPeerThreadForMerchants,
  listMerchantPeerContactsForMerchant,
  listMerchantPeerThreadsForMerchant,
  upsertMerchantPeerContact,
  upsertMerchantPeerMessage,
} from "@/lib/merchantPeerInbox";
import {
  loadStoredMerchantPeerInbox,
  saveMerchantPeerInbox,
  type MerchantPeerInboxStoreClient,
} from "@/lib/merchantPeerInboxStore";
import { buildMerchantPeerPushNotification } from "@/lib/merchantPushEvents";
import { type MerchantAuthUserSummary } from "@/lib/merchantAuthIdentity";
import {
  readMerchantAuthCookie,
  readMerchantRequestAccessTokens,
} from "@/lib/merchantAuthSession";
import {
  resolvePlatformAccountIdentityForUser,
  type PlatformIdentitySupabaseClient,
} from "@/lib/platformAccountIdentity";
import {
  isPersonalAccountNumericId,
  readPlatformAccountIdFromMetadata,
  readPlatformAccountTypeFromMetadata,
  readPlatformUsernameFromMetadata,
} from "@/lib/platformAccounts";
import {
  loadStoredPlatformMerchantSnapshot,
  type PlatformMerchantSnapshotStoreClient,
} from "@/lib/platformMerchantSnapshotStore";
import { createServerSupabaseAuthClient, createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";
import { notifyMerchantPushSubscribers } from "@/lib/webPush";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ResolvedMerchantRecord = {
  merchantId: string;
  merchantName: string;
  merchantEmail: string;
};

type PersonalPeerProfile = {
  accountType: "personal";
  displayName: string;
  avatarUrl: string;
  signature: string;
  phone: string;
  email: string;
  contactCard: string;
};

type MerchantPeerProfile = {
  accountType: "merchant";
  displayName: string;
  avatarUrl: string;
  signature: string;
  email: string;
  phone: string;
  contactCard: string;
  industry: string;
  location: MerchantListPublishedSite["location"] | null;
  contactName: string;
  contactAddress: string;
  domain: string;
  domainPrefix: string;
  domainSuffix: string;
  merchantCardImageUrl: string;
  contactVisibility: MerchantListPublishedSite["contactVisibility"] | null;
  chatBusinessCard: MerchantListPublishedSite["chatBusinessCard"] | null;
};

type MerchantPeerSessionHintInput = {
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

function normalizeSupportText(value: unknown) {
  return trimText(value).slice(0, 5000);
}

function readMetadataString(metadata: Record<string, unknown> | null | undefined, ...keys: string[]) {
  if (!metadata || typeof metadata !== "object") return "";
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizeStoragePublicUrl(value: unknown) {
  const normalized = trimText(value);
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    if (url.protocol === "http:" && url.pathname.startsWith("/storage/v1/object/public/")) {
      url.protocol = "https:";
      return url.toString();
    }
  } catch {
    return normalized;
  }
  return normalized;
}

function readPersonalPeerProfile(user: MerchantAuthUserSummary): PersonalPeerProfile {
  const userMetadata = user.user_metadata && typeof user.user_metadata === "object" ? user.user_metadata : {};
  const appMetadata = user.app_metadata && typeof user.app_metadata === "object" ? user.app_metadata : {};
  const profile =
    userMetadata.personal_profile && typeof userMetadata.personal_profile === "object"
      ? (userMetadata.personal_profile as Record<string, unknown>)
      : {};
  const read = (...keys: string[]) =>
    readMetadataString(profile, ...keys) || readMetadataString(userMetadata, ...keys) || readMetadataString(appMetadata, ...keys);

  return {
    accountType: "personal",
    displayName: read("displayName", "display_name", "username", "name"),
    avatarUrl: normalizeStoragePublicUrl(read("avatarUrl", "avatar_url", "personalAvatarUrl", "chatAvatarImageUrl")),
    signature: read("signature", "bio"),
    phone: read("phone", "contact_phone", "contactPhone"),
    email: read("email", "contact_email", "contactEmail") || normalizeEmail(user.email),
    contactCard: read("contactCard", "contact_card", "businessCardUrl", "business_card_url"),
  };
}

async function loadPersonalPeerProfiles(
  supabase: PlatformIdentitySupabaseClient | null,
  accountIds: string[],
) {
  const targetIds = new Set(accountIds.filter((accountId) => isPersonalAccountNumericId(accountId)));
  const profileMap = new Map<string, PersonalPeerProfile>();
  if (!supabase || targetIds.size === 0) return profileMap;

  let page = 1;
  while (targetIds.size > profileMap.size) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 }).catch(() => ({
      data: null,
      error: new Error("list_users_failed"),
    }));
    if (error) break;
    const users = data?.users ?? [];
    for (const user of users) {
      const summary = {
        id: user.id,
        email: user.email ?? null,
        user_metadata: user.user_metadata ?? null,
        app_metadata: user.app_metadata ?? null,
      } satisfies MerchantAuthUserSummary;
      const accountId = readPlatformAccountIdFromMetadata(summary);
      if (!targetIds.has(accountId)) continue;
      const accountType =
        readPlatformAccountTypeFromMetadata(summary, isPersonalAccountNumericId(accountId) ? "personal" : "") || "";
      if (accountType !== "personal") continue;
      profileMap.set(accountId, readPersonalPeerProfile(summary));
    }
    if (users.length < 200) break;
    page += 1;
  }

  return profileMap;
}

function readMerchantPeerProfile(site: MerchantListPublishedSite): MerchantPeerProfile {
  const merchantCardImageUrl = normalizeStoragePublicUrl(site.merchantCardImageUrl);
  const avatarUrl = normalizeStoragePublicUrl(site.chatAvatarImageUrl) || merchantCardImageUrl;
  const chatBusinessCard =
    site.chatBusinessCard ??
    (Array.isArray(site.businessCards)
      ? site.businessCards.find((card) => card && card.showInChat !== false && card.chatDisplayDisabled !== true) ?? null
      : null);
  return {
    accountType: "merchant",
    displayName: trimText(site.merchantName) || trimText(site.name) || trimText(site.id),
    avatarUrl,
    signature: trimText(site.signature),
    email: normalizeEmail(site.contactEmail),
    phone: trimText(site.contactPhone),
    contactCard: merchantCardImageUrl,
    industry: trimText(site.industry),
    location: site.location ?? null,
    contactName: trimText(site.contactName),
    contactAddress: trimText(site.contactAddress),
    domain: trimText(site.domain),
    domainPrefix: trimText(site.domainPrefix),
    domainSuffix: trimText(site.domainSuffix),
    merchantCardImageUrl,
    contactVisibility: site.contactVisibility ?? null,
    chatBusinessCard,
  };
}

async function loadMerchantPeerProfiles(
  supabase: PlatformMerchantSnapshotStoreClient | null,
  accountIds: string[],
) {
  const targetIds = new Set(accountIds.map((accountId) => normalizeMerchantId(accountId)).filter(Boolean));
  const profileMap = new Map<string, MerchantPeerProfile>();
  if (!supabase || targetIds.size === 0) return profileMap;

  const snapshotPayload = await loadStoredPlatformMerchantSnapshot(supabase).catch(() => null);
  (snapshotPayload?.snapshot ?? []).forEach((site) => {
    const siteId = normalizeMerchantId(site.id);
    if (!siteId || !targetIds.has(siteId)) return;
    profileMap.set(siteId, readMerchantPeerProfile(site));
  });
  return profileMap;
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

async function resolveMerchantPeerSession(request: Request, hint?: MerchantPeerSessionHintInput) {
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

function readResolvedMerchantEmail(record: Record<string, unknown> | null | undefined) {
  const candidates = [
    record?.user_email,
    record?.email,
    record?.owner_email,
    record?.contact_email,
  ];
  return candidates.map((value) => normalizeEmail(value)).find(Boolean) ?? "";
}

function toResolvedMerchantRecord(record: Record<string, unknown> | null | undefined) {
  const merchantId = normalizeMerchantId(record?.id);
  if (!merchantId) return null;
  return {
    merchantId,
    merchantName: trimText(record?.name) || merchantId,
    merchantEmail: readResolvedMerchantEmail(record),
  } satisfies ResolvedMerchantRecord;
}

async function resolveMerchantById(
  supabase: ReturnType<typeof createServerSupabaseServiceClient>,
  merchantId: string,
) {
  const normalizedMerchantId = normalizeMerchantId(merchantId);
  if (!supabase || !normalizedMerchantId) return null;
  const { data, error } = await supabase
    .from("merchants")
    .select("id,name,email,owner_email,contact_email,user_email")
    .eq("id", normalizedMerchantId)
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return toResolvedMerchantRecord((data ?? null) as Record<string, unknown> | null);
}

async function resolveMerchantByEmail(
  supabase: ReturnType<typeof createServerSupabaseServiceClient>,
  email: string,
) {
  const normalizedEmail = normalizeEmail(email);
  if (!supabase || !normalizedEmail) return { record: null, ambiguous: false };

  const lookups = await Promise.allSettled(
    ["email", "owner_email", "contact_email", "user_email"].map((column) =>
      supabase
        .from("merchants")
        .select("id,name,email,owner_email,contact_email,user_email")
        .eq(column, normalizedEmail)
        .limit(10),
    ),
  );
  const records = new Map<string, ResolvedMerchantRecord>();
  lookups.forEach((result) => {
    if (result.status !== "fulfilled" || result.value.error) return;
    const rows = Array.isArray(result.value.data) ? result.value.data : [];
    rows.forEach((row) => {
      const record = toResolvedMerchantRecord((row ?? null) as Record<string, unknown> | null);
      if (!record || records.has(record.merchantId)) return;
      records.set(record.merchantId, record);
    });
  });
  const resolved = [...records.values()];
  return {
    record: resolved[0] ?? null,
    ambiguous: resolved.length > 1,
  };
}

async function resolveMerchantByExactQuery(
  supabase: ReturnType<typeof createServerSupabaseServiceClient>,
  query: string,
) {
  const normalizedQuery = trimText(query);
  if (!normalizedQuery) {
    return { record: null, error: "search_empty" as const };
  }
  const merchantId = normalizeMerchantId(normalizedQuery);
  if (merchantId) {
    return {
      record: await resolveMerchantById(supabase, merchantId),
      error: null,
    };
  }

  const email = normalizeEmail(normalizedQuery);
  if (email && email.includes("@")) {
    const resolved = await resolveMerchantByEmail(supabase, email);
    if (resolved.ambiguous) {
      return { record: null, error: "search_ambiguous" as const };
    }
    return {
      record: resolved.record,
      error: null,
    };
  }

  return { record: null, error: "search_requires_exact_id_or_email" as const };
}

async function buildInboxResponse(
  payload: Awaited<ReturnType<typeof loadStoredMerchantPeerInbox>>,
  merchantId: string,
  supabase?: (PlatformIdentitySupabaseClient & PlatformMerchantSnapshotStoreClient) | null,
) {
  const contacts = listMerchantPeerContactsForMerchant(payload, merchantId);
  const personalProfiles = await loadPersonalPeerProfiles(
    supabase ?? null,
    contacts.map((contact) => contact.merchantId),
  );
  const merchantProfiles = await loadMerchantPeerProfiles(
    supabase ?? null,
    contacts.map((contact) => contact.merchantId),
  );
  const enrichedContacts = contacts.map((contact) => {
    const personalProfile = personalProfiles.get(contact.merchantId);
    const merchantProfile = merchantProfiles.get(contact.merchantId);
    const peerProfile = personalProfile ?? merchantProfile ?? null;
    if (!peerProfile) return contact;
    return {
      ...contact,
      accountType: peerProfile.accountType,
      merchantName: peerProfile.displayName || contact.merchantName,
      merchantEmail: peerProfile.email || contact.merchantEmail,
      avatarImageUrl: peerProfile.avatarUrl,
      chatAvatarImageUrl: peerProfile.avatarUrl,
      signature: peerProfile.signature,
      contactPhone: peerProfile.phone,
      contactCard: peerProfile.contactCard,
      ...(merchantProfile
        ? {
            industry: merchantProfile.industry,
            location: merchantProfile.location,
            contactName: merchantProfile.contactName,
            contactAddress: merchantProfile.contactAddress,
            domain: merchantProfile.domain,
            domainPrefix: merchantProfile.domainPrefix,
            domainSuffix: merchantProfile.domainSuffix,
            merchantCardImageUrl: merchantProfile.merchantCardImageUrl,
            contactVisibility: merchantProfile.contactVisibility,
            chatBusinessCard: merchantProfile.chatBusinessCard,
          }
        : {}),
    };
  });
  const threads = listMerchantPeerThreadsForMerchant(payload, merchantId);
  return {
    ok: true,
    contacts: enrichedContacts,
    threads,
  };
}

export async function GET(request: Request) {
  const session = await resolveMerchantPeerSession(request);
  if (!session) {
    return noStoreJson({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServerSupabaseServiceClient();
  if (!supabase) {
    return noStoreJson({ error: "merchant_peer_inbox_env_missing" }, { status: 503 });
  }

  const payload = await loadStoredMerchantPeerInbox(supabase as unknown as MerchantPeerInboxStoreClient);
  return noStoreJson({
    ...(await buildInboxResponse(
      payload,
      session.merchantId,
      supabase as unknown as PlatformIdentitySupabaseClient & PlatformMerchantSnapshotStoreClient,
    )),
    currentMerchantId: session.merchantId,
    currentMerchantEmail: session.merchantEmail,
  });
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }

  const body = (await request.json().catch(() => null)) as
    | {
        action?: unknown;
        query?: unknown;
        text?: unknown;
        recipientMerchantId?: unknown;
        merchantName?: unknown;
        merchantEmail?: unknown;
        siteId?: unknown;
      }
    | null;
  const session = await resolveMerchantPeerSession(request, body);
  if (!session) {
    return noStoreJson({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServerSupabaseServiceClient();
  if (!supabase) {
    return noStoreJson({ error: "merchant_peer_inbox_env_missing" }, { status: 503 });
  }

  const action = trimText(body?.action);

  if (action === "search") {
    const resolved = await resolveMerchantByExactQuery(supabase, trimText(body?.query));
    if (resolved.error === "search_empty") {
      return noStoreJson({ error: "search_empty", message: "请输入完整的商户ID或邮箱。" }, { status: 400 });
    }
    if (resolved.error === "search_requires_exact_id_or_email") {
      return noStoreJson(
        { error: "search_requires_exact_id_or_email", message: "只支持精确搜索 8 位商户ID或完整邮箱。" },
        { status: 400 },
      );
    }
    if (resolved.error === "search_ambiguous") {
      return noStoreJson(
        { error: "search_ambiguous", message: "这个邮箱对应多个商户，请改用商户ID精确搜索。" },
        { status: 409 },
      );
    }
    if (!resolved.record) {
      return noStoreJson({ error: "merchant_not_found", message: "没有找到匹配的商户。" }, { status: 404 });
    }
    if (resolved.record.merchantId === session.merchantId) {
      return noStoreJson(
        { error: "cannot_chat_with_self", message: "不能搜索自己，请输入其他商户的ID或邮箱。" },
        { status: 400 },
      );
    }

    const payload = await loadStoredMerchantPeerInbox(supabase as unknown as MerchantPeerInboxStoreClient);
    const nextPayload = upsertMerchantPeerContact(payload, {
      ownerMerchantId: session.merchantId,
      contactMerchantId: resolved.record.merchantId,
      contactName: resolved.record.merchantName,
      contactEmail: resolved.record.merchantEmail,
    });
    const saveResult = await saveMerchantPeerInbox(supabase as unknown as MerchantPeerInboxStoreClient, nextPayload);
    if (saveResult.error) {
      return noStoreJson(
        { error: "merchant_contact_save_failed", message: saveResult.error },
        { status: 500 },
      );
    }

    return noStoreJson({
      ...(await buildInboxResponse(
        nextPayload,
        session.merchantId,
        supabase as unknown as PlatformIdentitySupabaseClient & PlatformMerchantSnapshotStoreClient,
      )),
      contact: resolved.record,
    });
  }

  if (action === "send") {
    const text = normalizeSupportText(body?.text);
    const recipientMerchantId = normalizeMerchantId(body?.recipientMerchantId);
    if (!recipientMerchantId || !text) {
      return noStoreJson({ error: "merchant_message_invalid" }, { status: 400 });
    }
    if (recipientMerchantId === session.merchantId) {
      return noStoreJson({ error: "cannot_chat_with_self", message: "不能给自己发送消息。" }, { status: 400 });
    }

    const recipient = await resolveMerchantById(supabase, recipientMerchantId);
    if (!recipient) {
      return noStoreJson({ error: "merchant_not_found", message: "目标商户不存在。" }, { status: 404 });
    }
    const sender =
      (await resolveMerchantById(supabase, session.merchantId)) ??
      ({
        merchantId: session.merchantId,
        merchantName: trimText(body?.merchantName) || session.merchantName || session.merchantId,
        merchantEmail: normalizeEmail(body?.merchantEmail) || session.merchantEmail,
      } satisfies ResolvedMerchantRecord);

    const payload = await loadStoredMerchantPeerInbox(supabase as unknown as MerchantPeerInboxStoreClient);
    const nextPayload = upsertMerchantPeerMessage(payload, {
      senderMerchantId: sender.merchantId,
      senderMerchantName: trimText(body?.merchantName) || sender.merchantName,
      senderMerchantEmail: normalizeEmail(body?.merchantEmail) || sender.merchantEmail,
      recipientMerchantId: recipient.merchantId,
      recipientMerchantName: recipient.merchantName,
      recipientMerchantEmail: recipient.merchantEmail,
      message: createMerchantPeerMessage({
        senderMerchantId: sender.merchantId,
        text,
      }),
    });
    const saveResult = await saveMerchantPeerInbox(supabase as unknown as MerchantPeerInboxStoreClient, nextPayload);
    if (saveResult.error) {
      return noStoreJson(
        { error: "merchant_message_save_failed", message: saveResult.error },
        { status: 500 },
      );
    }

    const notification = buildMerchantPeerPushNotification({
      recipientMerchantId: recipient.merchantId,
      senderMerchantId: sender.merchantId,
      senderMerchantName: sender.merchantName,
      text,
    });

    await notifyMerchantPushSubscribers(supabase as unknown as MerchantPeerInboxStoreClient, {
      merchantId: recipient.merchantId,
      ...notification,
    }).catch(() => {
      // Ignore notification delivery failures; the saved message should still succeed.
    });

    return noStoreJson({
      ...(await buildInboxResponse(
        nextPayload,
        session.merchantId,
        supabase as unknown as PlatformIdentitySupabaseClient & PlatformMerchantSnapshotStoreClient,
      )),
      thread: findMerchantPeerThreadForMerchants(nextPayload, session.merchantId, recipient.merchantId),
    });
  }

  return noStoreJson({ error: "unsupported_action" }, { status: 400 });
}
