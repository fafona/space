import { NextResponse } from "next/server";
import {
  buildMerchantBusinessCardVCard,
  buildMerchantBusinessCardVCardFileName,
  isMerchantBusinessCardShareRevoked,
  loadMerchantBusinessCardSharePayloadByKey,
  normalizeMerchantBusinessCardSharePayload,
  normalizeMerchantBusinessCardShareKey,
  resolveMerchantBusinessCardShareOrigin,
  type MerchantBusinessCardSharePayload,
} from "@/lib/merchantBusinessCardShare";
import { loadCurrentMerchantSnapshotSites, loadPublishedMerchantSnapshotSites } from "@/lib/publishedMerchantService";
import { createServerTiming } from "@/lib/serverTiming";
import type { MerchantBusinessCardAsset } from "@/lib/merchantBusinessCards";
import { buildOriginScopedCacheKey, resolveConfiguredPublicRequestOrigin } from "@/lib/requestOrigin";

const CONTACT_DOWNLOAD_PAYLOAD_CACHE_TTL_MS = 60_000;
const CONTACT_DOWNLOAD_REVOCATION_NEGATIVE_CACHE_TTL_MS = 5_000;
const CONTACT_DOWNLOAD_REVOCATION_POSITIVE_CACHE_TTL_MS = 60_000;

const contactDownloadPayloadCache = new Map<
  string,
  {
    expiresAt: number;
    payload: MerchantBusinessCardSharePayload;
  }
>();

const contactDownloadRevocationCache = new Map<
  string,
  {
    expiresAt: number;
    pending?: Promise<boolean>;
    value?: boolean;
  }
>();

function buildContentDisposition(filename: string) {
  const safeAscii = filename.replace(/[^\x20-\x7E]+/g, "-").replace(/"/g, "");
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encoded}`;
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function withContactDownloadTimeout<T>(promise: Promise<T>, fallback: T, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function findContactDownloadSnapshotCard(
  sites: Awaited<ReturnType<typeof loadPublishedMerchantSnapshotSites>>,
  shareKey: string,
) {
  const normalizedShareKey = normalizeMerchantBusinessCardShareKey(shareKey);
  for (const site of sites) {
    const cards = Array.isArray(site.businessCards) ? site.businessCards : [];
    const card = cards.find((item) => normalizeMerchantBusinessCardShareKey(item.shareKey) === normalizedShareKey);
    if (card) return { siteId: normalizeText(site.id), card: card as MerchantBusinessCardAsset };
  }
  return null;
}

function buildContactDownloadPayloadFromSnapshot(
  match: { siteId: string; card: MerchantBusinessCardAsset } | null,
  origin: string,
) {
  if (!match) return null;
  const card = match.card;
  const contacts = card.contacts;
  const phones = Array.isArray(contacts?.phones)
    ? contacts.phones.map((value) => normalizeText(value)).filter(Boolean)
    : [];
  const primaryPhone = phones[0] || normalizeText(contacts?.phone);
  const targetUrl = normalizeText(card.targetUrl);
  if (!targetUrl) return null;
  return normalizeMerchantBusinessCardSharePayload(
    {
      name: normalizeText(card.name) || normalizeText(contacts?.contactName),
      targetUrl,
      ownerMerchantId: match.siteId,
      contact: {
        displayName: normalizeText(contacts?.contactName),
        organization: normalizeText(card.name),
        phone: primaryPhone,
        phones,
        email: normalizeText(contacts?.email),
        address: normalizeText(contacts?.address),
        wechat: normalizeText(contacts?.wechat),
        whatsapp: normalizeText(contacts?.whatsapp),
        twitter: normalizeText(contacts?.twitter),
        weibo: normalizeText(contacts?.weibo),
        telegram: normalizeText(contacts?.telegram),
        linkedin: normalizeText(contacts?.linkedin),
        discord: normalizeText(contacts?.discord),
        facebook: normalizeText(contacts?.facebook),
        instagram: normalizeText(contacts?.instagram),
        tiktok: normalizeText(contacts?.tiktok),
        douyin: normalizeText(contacts?.douyin),
        xiaohongshu: normalizeText(contacts?.xiaohongshu),
        googleReview: normalizeText(contacts?.googleReview),
        websiteUrl: targetUrl,
        contactFieldOrder: card.contactFieldOrder,
        contactOnlyFields: card.contactOnlyFields,
        contactDisplayFields: card.contactDisplayFields,
      },
    },
    origin,
  );
}

async function resolveContactDownloadPayloadFromSnapshot(shareKey: string, origin: string) {
  const publishedMatch = findContactDownloadSnapshotCard(await loadPublishedMerchantSnapshotSites().catch(() => []), shareKey);
  const publishedPayload = buildContactDownloadPayloadFromSnapshot(publishedMatch, origin);
  if (publishedPayload) return publishedPayload;
  const currentMatch = findContactDownloadSnapshotCard(await loadCurrentMerchantSnapshotSites().catch(() => []), shareKey);
  return buildContactDownloadPayloadFromSnapshot(currentMatch, origin);
}

function buildContactDownloadCacheKey(shareKey: string, origin: string) {
  const normalizedShareKey = normalizeMerchantBusinessCardShareKey(shareKey);
  return buildOriginScopedCacheKey(normalizedShareKey, origin);
}

function readCachedContactDownloadPayload(shareKey: string, origin: string) {
  const cacheKey = buildContactDownloadCacheKey(shareKey, origin);
  if (!cacheKey) return null;
  const cached = contactDownloadPayloadCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    contactDownloadPayloadCache.delete(cacheKey);
    return null;
  }
  return cached.payload;
}

function writeCachedContactDownloadPayload(
  shareKey: string,
  origin: string,
  payload: MerchantBusinessCardSharePayload | null | undefined,
) {
  const cacheKey = buildContactDownloadCacheKey(shareKey, origin);
  if (!cacheKey || !payload) return;
  contactDownloadPayloadCache.set(cacheKey, {
    expiresAt: Date.now() + CONTACT_DOWNLOAD_PAYLOAD_CACHE_TTL_MS,
    payload,
  });
}

function clearCachedContactDownloadPayload(shareKey: string, origin: string) {
  const cacheKey = buildContactDownloadCacheKey(shareKey, origin);
  if (cacheKey) contactDownloadPayloadCache.delete(cacheKey);
}

async function readContactDownloadRevocationCached(shareKey: string, origin: string) {
  const cacheKey = buildContactDownloadCacheKey(shareKey, origin);
  if (!cacheKey) return false;
  const cached = contactDownloadRevocationCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.pending) return cached.pending;
    return cached.value === true;
  }
  const pending = isMerchantBusinessCardShareRevoked({
    shareKey,
    preferredOrigin: origin,
  })
    .then((value) => value === true)
    .catch(() => false);
  contactDownloadRevocationCache.set(cacheKey, {
    expiresAt: Date.now() + CONTACT_DOWNLOAD_REVOCATION_NEGATIVE_CACHE_TTL_MS,
    pending,
  });
  const value = await pending;
  contactDownloadRevocationCache.set(cacheKey, {
    expiresAt:
      Date.now() +
      (value ? CONTACT_DOWNLOAD_REVOCATION_POSITIVE_CACHE_TTL_MS : CONTACT_DOWNLOAD_REVOCATION_NEGATIVE_CACHE_TTL_MS),
    value,
  });
  return value;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ card: string }> },
) {
  const timing = createServerTiming();
  const withTiming = (response: NextResponse) => {
    timing.apply(response.headers);
    return response;
  };
  const { card } = await params;
  const shareKey = normalizeMerchantBusinessCardShareKey(card);
  if (!shareKey) {
    return withTiming(new NextResponse("Invalid business card contact", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    }));
  }

  const requestOrigin = resolveConfiguredPublicRequestOrigin(request);
  const payloadOrigin = resolveMerchantBusinessCardShareOrigin(requestOrigin, requestOrigin) || requestOrigin;
  const cachedPayload = readCachedContactDownloadPayload(shareKey, payloadOrigin);
  const payloadPromise = loadMerchantBusinessCardSharePayloadByKey(shareKey, payloadOrigin);
  const snapshotPayloadPromise = cachedPayload
    ? null
    : resolveContactDownloadPayloadFromSnapshot(shareKey, payloadOrigin).catch(() => null);
  const revoked = await timing.time(
    "revocation",
    () =>
      withContactDownloadTimeout(
        readContactDownloadRevocationCached(shareKey, requestOrigin),
        false,
        350,
      ),
  );
  if (revoked) {
    clearCachedContactDownloadPayload(shareKey, payloadOrigin);
    return withTiming(new NextResponse("Business card contact not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    }));
  }
  if (cachedPayload) {
    void payloadPromise
      .then((freshPayload) => writeCachedContactDownloadPayload(shareKey, payloadOrigin, freshPayload))
      .catch(() => null);
  }
  const payload = await timing.time("payload", async () =>
    cachedPayload ||
    (await withContactDownloadTimeout(
      payloadPromise.then((freshPayload) => freshPayload).catch(() => null),
      null,
      2_000,
    )) ||
    (snapshotPayloadPromise
      ? await withContactDownloadTimeout(snapshotPayloadPromise, null, 2_000)
      : null),
    cachedPayload ? "cache" : "remote",
  );
  if (!payload) {
    return withTiming(new NextResponse("Business card contact not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    }));
  }
  writeCachedContactDownloadPayload(shareKey, payloadOrigin, payload);

  const vcard = await timing.time("render_vcard", async () => buildMerchantBusinessCardVCard(payload));
  const fileName = buildMerchantBusinessCardVCardFileName(payload);
  return withTiming(new NextResponse(vcard, {
    status: 200,
    headers: {
      "content-type": "text/vcard; charset=utf-8",
      "content-disposition": buildContentDisposition(fileName),
      "cache-control": "no-store, max-age=0",
    },
  }));
}
