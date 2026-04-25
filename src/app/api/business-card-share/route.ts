import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  buildMerchantBusinessCardShareLegacyFingerprint,
  buildMerchantBusinessCardShareManifestObjectPath,
  buildMerchantBusinessCardShareManifestPublicUrls,
  buildMerchantBusinessCardShareRevocationByKeyObjectPath,
  buildMerchantBusinessCardShareRevocationByLegacyPayloadObjectPath,
  createMerchantBusinessCardShareKey,
  resolveMerchantBusinessCardShareOrigin,
  buildMerchantBusinessCardShareUrl,
  normalizeMerchantBusinessCardSharePayload,
  normalizeMerchantBusinessCardShareContact,
  normalizeMerchantBusinessCardShareImageUrl,
  normalizeMerchantBusinessCardShareKey,
  normalizeMerchantBusinessCardShareTargetUrl,
  type MerchantBusinessCardShareContact,
  type MerchantBusinessCardSharePayload,
} from "@/lib/merchantBusinessCardShare";
import { type MerchantAuthUserSummary } from "@/lib/merchantAuthIdentity";
import { readPersonalAccountServiceConfigFromMetadata } from "@/lib/personalAccountServiceConfig";
import {
  normalizeMerchantBusinessCardContactFieldOrder,
  type MerchantBusinessCardAsset,
  type MerchantBusinessCardContactDisplayKey,
  type MerchantBusinessCardContactOnlyFields,
} from "@/lib/merchantBusinessCards";
import { readMerchantAuthCookie, readMerchantRequestAccessTokens } from "@/lib/merchantAuthSession";
import { type PlatformMerchantSnapshotPayload } from "@/lib/platformMerchantSnapshot";
import { loadStoredPlatformMerchantSnapshot, type PlatformMerchantSnapshotStoreClient } from "@/lib/platformMerchantSnapshotStore";
import {
  resolvePlatformAccountIdentityForUser,
  type PlatformIdentitySupabaseClient,
} from "@/lib/platformAccountIdentity";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";
import { createServerSupabaseAuthClient, createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import { isSuperAdminRequestAuthorized } from "@/lib/superAdminRequestAuth";

const BUCKET_CANDIDATES = ["page-assets", "assets", "uploads", "public"] as const;
const SNAPSHOT_CONTACT_FIELD_LABELS: Record<MerchantBusinessCardContactDisplayKey, string> = {
  contactName: "联系人",
  phone: "电话",
  email: "邮箱",
  address: "地址",
  wechat: "微信",
  whatsapp: "WhatsApp",
  twitter: "Twitter",
  weibo: "微博",
  telegram: "Telegram",
  linkedin: "LinkedIn",
  discord: "Discord",
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  douyin: "抖音",
  xiaohongshu: "小红书",
};

type BusinessCardShareRequestBody = {
  merchantId?: unknown;
  key?: unknown;
  name?: unknown;
  imageUrl?: unknown;
  detailImageUrl?: unknown;
  detailImageHeight?: unknown;
  targetUrl?: unknown;
  imageWidth?: unknown;
  imageHeight?: unknown;
  contact?: unknown;
};

type BusinessCardShareDeleteRequestBody = {
  merchantId?: unknown;
  key?: unknown;
  legacyPayload?: unknown;
};

type StorageOperationError = {
  message?: string | null;
} | null;

type PublicStorageBucketClient = {
  upload: (
    objectPath: string,
    body: Blob,
    options: {
      contentType: string;
      cacheControl: string;
      upsert: boolean;
    },
  ) => Promise<{ error: StorageOperationError }>;
  remove: (paths: string[]) => Promise<{ error: StorageOperationError }>;
};

type PublicStorageClient = PlatformMerchantSnapshotStoreClient & {
  storage: {
    from: (bucket: string) => PublicStorageBucketClient;
  };
};

type StoredShareManifest = MerchantBusinessCardSharePayload & {
  ownerMerchantId?: string;
};

type ShareActorContext =
  | {
      kind: "merchant";
      merchantId: string;
    }
  | {
      kind: "personal";
      merchantId: string;
      allowLinkMode: boolean;
    }
  | {
      kind: "super-admin";
      merchantId: string;
    };

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeMerchantId(value: unknown) {
  const normalized = normalizeText(value);
  return /^\d{8}$/.test(normalized) ? normalized : "";
}

function normalizeImageDimension(value: unknown) {
  const normalized = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
  return normalized >= 120 && normalized <= 4096 ? normalized : 0;
}

function normalizePhoneList(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => normalizeText(item))
        .filter(Boolean)
        .slice(0, 2)
    : [];
}

function createShareKey(body?: BusinessCardShareRequestBody | null) {
  const contact =
    body?.contact && typeof body.contact === "object" ? (body.contact as Record<string, unknown>) : undefined;
  return createMerchantBusinessCardShareKey({
    contactName: normalizeText(contact?.displayName ?? contact?.contactName),
    name: normalizeText(body?.name),
    targetUrl: normalizeText(body?.targetUrl),
  });
}

function createJsonBlob(value: unknown) {
  return new Blob([JSON.stringify(value)], { type: "application/json; charset=utf-8" });
}

function countShareContactFields(contact?: MerchantBusinessCardShareContact | null) {
  if (!contact) return 0;
  let count = 0;
  [
    "displayName",
    "organization",
    "title",
    "phone",
    "email",
    "address",
    "invoiceName",
    "invoiceTaxNumber",
    "invoiceAddress",
    "wechat",
    "whatsapp",
    "twitter",
    "weibo",
    "telegram",
    "linkedin",
    "discord",
    "facebook",
    "instagram",
    "tiktok",
    "douyin",
    "xiaohongshu",
    "websiteUrl",
    "note",
  ].forEach((key) => {
    if (normalizeText((contact as Record<string, unknown>)[key])) {
      count += 1;
    }
  });
  count += normalizePhoneList(contact.phones).length;
  count += Array.isArray(contact.contactFieldOrder) ? contact.contactFieldOrder.filter(Boolean).length : 0;
  count += contact.contactOnlyFields ? Object.values(contact.contactOnlyFields).filter(Boolean).length : 0;
  return count;
}

function normalizeStoredShareManifest(value: unknown, preferredOrigin: string) {
  if (!value || typeof value !== "object") return null;
  const payload = normalizeMerchantBusinessCardSharePayload(value as Record<string, unknown>, preferredOrigin);
  if (!payload) return null;
  return {
    ...payload,
    ...(normalizeMerchantId((value as { ownerMerchantId?: unknown }).ownerMerchantId)
      ? { ownerMerchantId: normalizeMerchantId((value as { ownerMerchantId?: unknown }).ownerMerchantId) }
      : {}),
  } satisfies StoredShareManifest;
}

async function loadStoredShareManifest(shareKey: string, preferredOrigin: string) {
  const normalizedShareKey = normalizeMerchantBusinessCardShareKey(shareKey);
  if (!normalizedShareKey) return null;

  const candidates: StoredShareManifest[] = [];
  for (const url of buildMerchantBusinessCardShareManifestPublicUrls(normalizedShareKey, preferredOrigin)) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        next: { revalidate: 0 },
      });
      if (!response.ok) continue;
      const payload = normalizeStoredShareManifest(await response.json().catch(() => null), preferredOrigin);
      if (payload) {
        candidates.push(payload);
      }
    } catch {
      continue;
    }
  }

  if (candidates.length === 0) return null;

  const [latest] = [...candidates].sort((left, right) => {
    const ownerDiff = Number(Boolean(right.ownerMerchantId)) - Number(Boolean(left.ownerMerchantId));
    if (ownerDiff !== 0) return ownerDiff;
    const updatedAtDiff = Date.parse(right.updatedAt ?? "") - Date.parse(left.updatedAt ?? "");
    if (Number.isFinite(updatedAtDiff) && updatedAtDiff !== 0) return updatedAtDiff;
    return countShareContactFields(right.contact) - countShareContactFields(left.contact);
  });
  return latest ?? candidates[0] ?? null;
}

export function isStorageObjectMissingError(message: string) {
  return /not found|does not exist|no such object|status code 404|resource was not found/i.test(
    normalizeText(message),
  );
}

async function uploadPublicJsonObject(
  supabase: PublicStorageClient,
  objectPath: string,
  payload: unknown,
) {
  const blob = createJsonBlob(payload);
  const failedBuckets: Array<{ bucket: string; message: string }> = [];

  for (const bucket of BUCKET_CANDIDATES) {
    const uploaded = await supabase.storage.from(bucket).upload(objectPath, blob, {
      contentType: "application/json; charset=utf-8",
      cacheControl: "31536000",
      upsert: true,
    });
    if (!uploaded.error) {
      return {
        ok: true as const,
        bucket,
      };
    }

    failedBuckets.push({
      bucket,
      message: normalizeText(uploaded.error.message) || "share_revocation_upload_failed",
    });
  }

  return {
    ok: false as const,
    failedBuckets,
  };
}

async function removePublicObject(
  supabase: PublicStorageClient,
  objectPath: string,
) {
  const deletedBuckets: string[] = [];
  const missingBuckets: string[] = [];
  const failedBuckets: Array<{ bucket: string; message: string }> = [];

  for (const bucket of BUCKET_CANDIDATES) {
    const removed = await supabase.storage.from(bucket).remove([objectPath]);
    if (!removed.error) {
      deletedBuckets.push(bucket);
      continue;
    }

    const message = normalizeText(removed.error.message);
    if (isStorageObjectMissingError(message)) {
      missingBuckets.push(bucket);
      continue;
    }

    failedBuckets.push({
      bucket,
      message: message || "share_manifest_delete_failed",
    });
  }

  return {
    deletedBuckets,
    missingBuckets,
    failedBuckets,
  };
}

function normalizeSnapshotCardContactOnlyFields(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Partial<MerchantBusinessCardContactOnlyFields>;
  const enabledEntries = Object.entries(source).filter(([, enabled]) => enabled === true);
  if (enabledEntries.length === 0) return undefined;
  return Object.fromEntries(enabledEntries) as Partial<MerchantBusinessCardContactOnlyFields>;
}

function buildSnapshotCardSharePayload(card: MerchantBusinessCardAsset, preferredOrigin: string) {
  const orderedKeys = normalizeMerchantBusinessCardContactFieldOrder(card.contactFieldOrder);
  const phones = normalizePhoneList(card.contacts?.phones ?? []);
  const extraPhoneLines = phones
    .slice(1)
    .map((value, index) => `${index === 0 ? "工作" : `工作${index + 1}`}: ${value}`);
  const socialLines = orderedKeys
    .filter((key) => key !== "contactName" && key !== "phone" && key !== "email" && key !== "address")
    .map((key) => {
      const normalizedValue = normalizeText(card.contacts?.[key]);
      return normalizedValue ? `${SNAPSHOT_CONTACT_FIELD_LABELS[key]}: ${normalizedValue}` : "";
    })
    .filter(Boolean);
  const primaryPhone = phones[0] || normalizeText(card.contacts?.phone);

  return normalizeMerchantBusinessCardSharePayload(
    {
      name: normalizeText(card.name),
      imageUrl: normalizeText(card.shareImageUrl) || normalizeText(card.imageUrl),
      detailImageUrl: normalizeText(card.contactPagePublicImageUrl) || normalizeText(card.contactPageImageUrl),
      detailImageHeight:
        typeof card.contactPageImageHeight === "number" ? Math.round(card.contactPageImageHeight) : undefined,
      targetUrl: normalizeText(card.targetUrl),
      imageWidth: typeof card.width === "number" ? Math.round(card.width) : undefined,
      imageHeight: typeof card.height === "number" ? Math.round(card.height) : undefined,
      contact: {
        displayName: normalizeText(card.contacts?.contactName) || normalizeText(card.name),
        organization: normalizeText(card.name),
        title: normalizeText(card.title),
        phone: primaryPhone,
        phones,
        email: normalizeText(card.contacts?.email),
        address: normalizeText(card.contacts?.address),
        invoiceName: normalizeText(card.invoice?.name),
        invoiceTaxNumber: normalizeText(card.invoice?.taxNumber),
        invoiceAddress: normalizeText(card.invoice?.address),
        wechat: normalizeText(card.contacts?.wechat),
        whatsapp: normalizeText(card.contacts?.whatsapp),
        twitter: normalizeText(card.contacts?.twitter),
        weibo: normalizeText(card.contacts?.weibo),
        telegram: normalizeText(card.contacts?.telegram),
        linkedin: normalizeText(card.contacts?.linkedin),
        discord: normalizeText(card.contacts?.discord),
        facebook: normalizeText(card.contacts?.facebook),
        instagram: normalizeText(card.contacts?.instagram),
        tiktok: normalizeText(card.contacts?.tiktok),
        douyin: normalizeText(card.contacts?.douyin),
        xiaohongshu: normalizeText(card.contacts?.xiaohongshu),
        contactFieldOrder: orderedKeys,
        ...(normalizeSnapshotCardContactOnlyFields(card.contactOnlyFields)
          ? { contactOnlyFields: normalizeSnapshotCardContactOnlyFields(card.contactOnlyFields) }
          : {}),
        websiteUrl: normalizeText(card.targetUrl),
        note: [...extraPhoneLines, ...socialLines].join("\n"),
      },
    },
    preferredOrigin,
  );
}

export function findShareOwnerMerchantIdInSnapshotPayload(
  snapshotPayload: PlatformMerchantSnapshotPayload | null,
  input: {
    shareKey?: string;
    legacyPayload?: MerchantBusinessCardSharePayload | null;
    preferredOrigin: string;
  },
) {
  const normalizedShareKey = normalizeMerchantBusinessCardShareKey(input.shareKey);
  const legacyFingerprint = input.legacyPayload
    ? buildMerchantBusinessCardShareLegacyFingerprint(input.legacyPayload, input.preferredOrigin)
    : "";
  if (!normalizedShareKey && !legacyFingerprint) return "";

  if (!snapshotPayload) return "";

  for (const site of snapshotPayload.snapshot) {
    const merchantId = normalizeMerchantId(site.id);
    if (!merchantId) continue;
    const cards = Array.isArray(site.businessCards) ? site.businessCards : [];
    if (
      normalizedShareKey &&
      cards.some((card) => normalizeMerchantBusinessCardShareKey(card.shareKey) === normalizedShareKey)
    ) {
      return merchantId;
    }
    if (!legacyFingerprint) continue;
    const matchedLegacyCard = cards.some((card) => {
      const payload = buildSnapshotCardSharePayload(card, input.preferredOrigin);
      if (!payload) return false;
      return buildMerchantBusinessCardShareLegacyFingerprint(payload, input.preferredOrigin) === legacyFingerprint;
    });
    if (matchedLegacyCard) {
      return merchantId;
    }
  }

  return "";
}

async function findSnapshotShareOwnerMerchantId(
  supabase: PublicStorageClient,
  input: {
    shareKey?: string;
    legacyPayload?: MerchantBusinessCardSharePayload | null;
    preferredOrigin: string;
  },
) {
  const snapshotPayload = await loadStoredPlatformMerchantSnapshot(supabase as unknown as PlatformMerchantSnapshotStoreClient);
  return findShareOwnerMerchantIdInSnapshotPayload(snapshotPayload, input);
}

async function resolveShareActorContext(request: Request, hintedMerchantId: string) {
  if (isSuperAdminRequestAuthorized(request)) {
    return {
      kind: "super-admin",
      merchantId: hintedMerchantId,
    } satisfies ShareActorContext;
  }

  const session = await resolveMerchantSessionFromRequest(request, {
    hintedMerchantId,
  }).catch(() => null);
  if (session?.merchantId) {
    return {
      kind: "merchant",
      merchantId: session.merchantId,
    } satisfies ShareActorContext;
  }

  const authSupabase = createServerSupabaseAuthClient();
  const adminSupabase = createServerSupabaseServiceClient() as unknown as PlatformIdentitySupabaseClient | null;
  if (!authSupabase || !adminSupabase) return null;

  const accessTokens = readMerchantRequestAccessTokens(request);
  const fallbackAccessToken = readMerchantAuthCookie(request);
  const candidates = [...accessTokens, fallbackAccessToken].map((value) => normalizeText(value)).filter(Boolean);
  let user: MerchantAuthUserSummary | null = null;
  for (const accessToken of candidates) {
    const { data, error } = await authSupabase.auth.getUser(accessToken).catch(() => ({ data: null, error: true }));
    if (!error && data?.user) {
      user = data.user as MerchantAuthUserSummary;
      break;
    }
  }
  if (!user?.id) return null;

  const identity = await resolvePlatformAccountIdentityForUser(adminSupabase, user);
  if (identity.accountType !== "personal" || !identity.accountId) return null;

  return {
    kind: "personal",
    merchantId: identity.accountId,
    allowLinkMode: readPersonalAccountServiceConfigFromMetadata(user).allowBusinessCardLinkMode,
  } satisfies ShareActorContext;
}

function canActorManageShare(actor: ShareActorContext, ownerMerchantId: string) {
  if (actor.kind === "super-admin") return true;
  return actor.merchantId === ownerMerchantId;
}

function jsonError(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json(
    {
      ok: false,
      error,
      ...(extra ?? {}),
    },
    { status },
  );
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }

  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const serviceRoleKey =
    (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim() ||
    (process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonError(503, "share_service_unavailable");
  }

  let body: BusinessCardShareRequestBody | null = null;
  try {
    body = (await request.json()) as BusinessCardShareRequestBody;
  } catch {
    return jsonError(400, "invalid_json");
  }

  const hintedMerchantId = normalizeMerchantId(body?.merchantId);
  const actor = await resolveShareActorContext(request, hintedMerchantId);
  if (!actor) {
    return jsonError(401, "unauthorized");
  }
  if (actor.kind === "personal" && !actor.allowLinkMode) {
    return jsonError(403, "share_link_mode_not_allowed");
  }

  const shareKey = normalizeMerchantBusinessCardShareKey(normalizeText(body?.key)) || createShareKey(body);
  const name = normalizeText(body?.name).slice(0, 80);
  const targetUrl = normalizeMerchantBusinessCardShareTargetUrl(normalizeText(body?.targetUrl));
  const shareOrigin = resolveMerchantBusinessCardShareOrigin(request.url, targetUrl);
  const imageUrl = normalizeMerchantBusinessCardShareImageUrl(normalizeText(body?.imageUrl), shareOrigin || request.url);
  const detailImageUrl = normalizeMerchantBusinessCardShareImageUrl(
    normalizeText(body?.detailImageUrl),
    shareOrigin || request.url,
  );
  const detailImageHeight = normalizeImageDimension(body?.detailImageHeight);
  const imageWidth = normalizeImageDimension(body?.imageWidth);
  const imageHeight = normalizeImageDimension(body?.imageHeight);
  const contact = normalizeMerchantBusinessCardShareContact(
    body?.contact && typeof body.contact === "object" ? (body.contact as Record<string, unknown>) : undefined,
    targetUrl,
  );
  if (!shareKey || !imageUrl || !targetUrl || !shareOrigin) {
    return jsonError(400, "invalid_payload");
  }

  const objectPath = buildMerchantBusinessCardShareManifestObjectPath(shareKey);
  if (!objectPath) {
    return jsonError(400, "invalid_payload");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }) as unknown as PublicStorageClient;
  const existingManifest = await loadStoredShareManifest(shareKey, request.url);
  const existingOwnerMerchantId =
    existingManifest?.ownerMerchantId ||
    (await findSnapshotShareOwnerMerchantId(supabase, {
      shareKey,
      preferredOrigin: request.url,
    }));

  if (existingManifest && existingOwnerMerchantId && !canActorManageShare(actor, existingOwnerMerchantId)) {
    return jsonError(403, "share_forbidden", { shareKey });
  }
  if (existingManifest && !existingOwnerMerchantId && actor.kind !== "super-admin") {
    return jsonError(403, "share_owner_not_found", { shareKey });
  }

  const payload = {
    name,
    imageUrl,
    ...(detailImageUrl ? { detailImageUrl } : {}),
    ...(detailImageUrl && detailImageHeight ? { detailImageHeight } : {}),
    updatedAt: new Date().toISOString(),
    targetUrl,
    ...(imageWidth ? { imageWidth } : {}),
    ...(imageHeight ? { imageHeight } : {}),
    ...(contact ? { contact } : {}),
    ...((existingOwnerMerchantId || actor.merchantId)
      ? { ownerMerchantId: existingOwnerMerchantId || actor.merchantId }
      : {}),
  } satisfies StoredShareManifest;

  const blob = createJsonBlob(payload);
  const revocationKeyObjectPath = buildMerchantBusinessCardShareRevocationByKeyObjectPath(shareKey);
  if (revocationKeyObjectPath) {
    for (const bucket of BUCKET_CANDIDATES) {
      await supabase.storage.from(bucket).remove([revocationKeyObjectPath]);
    }
  }

  const succeededBuckets: string[] = [];
  const failedBuckets: Array<{ bucket: string; message: string }> = [];

  for (const bucket of BUCKET_CANDIDATES) {
    const uploaded = await supabase.storage.from(bucket).upload(objectPath, blob, {
      contentType: "application/json; charset=utf-8",
      cacheControl: "31536000",
      upsert: true,
    });
    if (uploaded.error) {
      failedBuckets.push({
        bucket,
        message: normalizeText(uploaded.error.message) || "share_manifest_upload_failed",
      });
      continue;
    }
    succeededBuckets.push(bucket);
  }

  const shareUrl = buildMerchantBusinessCardShareUrl({
    origin: shareOrigin,
    shareKey,
    imageUrl,
    targetUrl,
    name,
  });

  if (succeededBuckets.length > 0 && shareUrl) {
    return NextResponse.json({
      ok: true,
      shareKey,
      shareUrl,
      buckets: succeededBuckets,
      objectPath,
    });
  }

  return jsonError(409, "share_manifest_upload_failed", { failedBuckets });
}

export async function DELETE(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }

  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const serviceRoleKey =
    (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim() ||
    (process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonError(503, "share_service_unavailable");
  }

  let body: BusinessCardShareDeleteRequestBody | null = null;
  try {
    body = (await request.json()) as BusinessCardShareDeleteRequestBody;
  } catch {
    return jsonError(400, "invalid_json");
  }

  const hintedMerchantId = normalizeMerchantId(body?.merchantId);
  const actor = await resolveShareActorContext(request, hintedMerchantId);
  if (!actor) {
    return jsonError(401, "unauthorized");
  }

  const shareKey = normalizeMerchantBusinessCardShareKey(normalizeText(body?.key));
  const legacyPayload = normalizeMerchantBusinessCardSharePayload(
    body?.legacyPayload && typeof body.legacyPayload === "object"
      ? (body.legacyPayload as Record<string, unknown>)
      : {},
    request.url,
  );
  const objectPath = buildMerchantBusinessCardShareManifestObjectPath(shareKey);
  const keyRevocationObjectPath = buildMerchantBusinessCardShareRevocationByKeyObjectPath(shareKey);
  const legacyRevocationObjectPath = buildMerchantBusinessCardShareRevocationByLegacyPayloadObjectPath(
    legacyPayload,
    request.url,
  );
  if (!objectPath && !legacyRevocationObjectPath) {
    return jsonError(400, "invalid_payload");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }) as unknown as PublicStorageClient;
  const existingManifest = shareKey ? await loadStoredShareManifest(shareKey, request.url) : null;
  const resolvedOwnerMerchantId =
    existingManifest?.ownerMerchantId ||
    (await findSnapshotShareOwnerMerchantId(supabase, {
      shareKey,
      legacyPayload,
      preferredOrigin: request.url,
    }));

  if (resolvedOwnerMerchantId && !canActorManageShare(actor, resolvedOwnerMerchantId)) {
    return jsonError(403, "share_forbidden", { shareKey });
  }
  if (!resolvedOwnerMerchantId && actor.kind !== "super-admin") {
    return jsonError(403, "share_owner_not_found", { shareKey });
  }

  const keyRevocation =
    keyRevocationObjectPath
      ? await uploadPublicJsonObject(supabase, keyRevocationObjectPath, {
          revokedAt: new Date().toISOString(),
          type: "share_key",
          shareKey,
          ...(resolvedOwnerMerchantId ? { ownerMerchantId: resolvedOwnerMerchantId } : {}),
        })
      : null;
  if (keyRevocation && !keyRevocation.ok) {
    return jsonError(409, "share_revocation_upload_failed", {
      shareKey,
      failedBuckets: keyRevocation.failedBuckets,
    });
  }

  const legacyRevocation =
    legacyRevocationObjectPath
      ? await uploadPublicJsonObject(supabase, legacyRevocationObjectPath, {
          revokedAt: new Date().toISOString(),
          type: "legacy_payload",
          ...(resolvedOwnerMerchantId ? { ownerMerchantId: resolvedOwnerMerchantId } : {}),
        })
      : null;
  if (legacyRevocation && !legacyRevocation.ok) {
    return jsonError(409, "share_revocation_upload_failed", {
      shareKey,
      failedBuckets: legacyRevocation.failedBuckets,
    });
  }

  const manifestRemoval = objectPath ? await removePublicObject(supabase, objectPath) : null;
  if (manifestRemoval && manifestRemoval.failedBuckets.length > 0) {
    return jsonError(409, "share_manifest_delete_failed", {
      shareKey,
      failedBuckets: manifestRemoval.failedBuckets,
    });
  }

  return NextResponse.json({
    ok: true,
    shareKey,
    deletedBuckets: manifestRemoval?.deletedBuckets ?? [],
    missingBuckets: manifestRemoval?.missingBuckets ?? [],
    revocationBuckets: [
      ...(keyRevocation?.ok ? [keyRevocation.bucket] : []),
      ...(legacyRevocation?.ok ? [legacyRevocation.bucket] : []),
    ],
  });
}
