import { NextResponse } from "next/server";
import {
  isMerchantBusinessCardShareRevoked,
  loadMerchantBusinessCardSharePayloadByKey,
  normalizeMerchantBusinessCardShareImageUrl,
  normalizeMerchantBusinessCardShareKey,
  resolveMerchantBusinessCardShareOrigin,
} from "@/lib/merchantBusinessCardShare";
import type { MerchantBusinessCardAsset } from "@/lib/merchantBusinessCards";
import { loadCurrentMerchantSnapshotSites, loadPublishedMerchantSnapshotSites } from "@/lib/publishedMerchantService";
import { buildOriginScopedCacheKey, resolveConfiguredPublicRequestOrigin } from "@/lib/requestOrigin";

const CARD_IMAGE_CACHE_TTL_MS = 60_000;
const CARD_IMAGE_REDIRECT_CACHE_CONTROL = "no-store, max-age=0";

const cardImageUrlCache = new Map<
  string,
  {
    expiresAt: number;
    imageUrl: string;
  }
>();

async function withCardImageTimeout<T>(promise: Promise<T>, fallback: T, timeoutMs: number): Promise<T> {
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

function readCachedCardImageUrl(shareKey: string, requestOrigin: string) {
  const normalizedShareKey = normalizeMerchantBusinessCardShareKey(shareKey);
  const cacheKey = buildOriginScopedCacheKey(normalizedShareKey, requestOrigin);
  if (!cacheKey) return "";
  const cached = cardImageUrlCache.get(cacheKey);
  if (!cached) return "";
  if (cached.expiresAt <= Date.now()) {
    cardImageUrlCache.delete(cacheKey);
    return "";
  }
  return cached.imageUrl;
}

function writeCachedCardImageUrl(
  shareKey: string,
  requestOrigin: string,
  imageUrl: string | null | undefined,
) {
  const normalizedShareKey = normalizeMerchantBusinessCardShareKey(shareKey);
  const cacheKey = buildOriginScopedCacheKey(normalizedShareKey, requestOrigin);
  const normalizedImageUrl = String(imageUrl ?? "").trim();
  if (!cacheKey || !normalizedImageUrl) return;
  cardImageUrlCache.set(cacheKey, {
    expiresAt: Date.now() + CARD_IMAGE_CACHE_TTL_MS,
    imageUrl: normalizedImageUrl,
  });
}

function clearCachedCardImageUrl(shareKey: string, requestOrigin?: string) {
  const normalizedShareKey = normalizeMerchantBusinessCardShareKey(shareKey);
  if (!normalizedShareKey) return;
  const cacheKey = requestOrigin
    ? buildOriginScopedCacheKey(normalizedShareKey, requestOrigin)
    : "";
  if (cacheKey) {
    cardImageUrlCache.delete(cacheKey);
    return;
  }
  for (const key of Array.from(cardImageUrlCache.keys())) {
    if (key.startsWith(`${normalizedShareKey}|`)) cardImageUrlCache.delete(key);
  }
}

type CardImageSnapshotSite = {
  businessCards?: MerchantBusinessCardAsset[] | null;
};

export function findCardImageUrlInSnapshotSites(
  sites: CardImageSnapshotSite[],
  shareKey: string,
) {
  const normalizedShareKey = normalizeMerchantBusinessCardShareKey(shareKey);
  if (!normalizedShareKey) return "";
  for (const site of sites) {
    const cards = Array.isArray(site.businessCards) ? site.businessCards : [];
    const card = cards.find(
      (item) => normalizeMerchantBusinessCardShareKey(item.shareKey) === normalizedShareKey,
    );
    if (!card) continue;
    return String(card.shareImageUrl || card.imageUrl || "").trim();
  }
  return "";
}

export function normalizeCardImageRedirectUrl(value: string, origin: string) {
  const imageUrl = String(value ?? "").trim();
  if (!imageUrl) return "";
  try {
    const parsed = new URL(imageUrl);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    // Relative storage paths still need the public origin applied below.
  }
  return normalizeMerchantBusinessCardShareImageUrl(imageUrl, origin);
}

async function resolveCardImageUrlFromSnapshot(shareKey: string, origin: string) {
  const publishedImageUrl = findCardImageUrlInSnapshotSites(
    await loadPublishedMerchantSnapshotSites().catch(() => []),
    shareKey,
  );
  if (publishedImageUrl) {
    return normalizeCardImageRedirectUrl(publishedImageUrl, origin);
  }
  const currentImageUrl = findCardImageUrlInSnapshotSites(
    await loadCurrentMerchantSnapshotSites().catch(() => []),
    shareKey,
  );
  return normalizeCardImageRedirectUrl(currentImageUrl, origin);
}

function firstResolvedCardImageUrl(tasks: Array<Promise<string>>) {
  return new Promise<string>((resolve) => {
    if (tasks.length === 0) {
      resolve("");
      return;
    }
    let remaining = tasks.length;
    let settled = false;
    tasks.forEach((task) => {
      task
        .then((value) => {
          if (settled) return;
          const imageUrl = String(value ?? "").trim();
          if (imageUrl) {
            settled = true;
            resolve(imageUrl);
            return;
          }
          remaining -= 1;
          if (remaining <= 0) resolve("");
        })
        .catch(() => {
          if (settled) return;
          remaining -= 1;
          if (remaining <= 0) resolve("");
        });
    });
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ card: string }> },
) {
  const { card } = await params;
  const shareKey = normalizeMerchantBusinessCardShareKey(card);
  if (!shareKey) {
    return new NextResponse("Invalid business card image", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  }

  const requestOrigin = resolveConfiguredPublicRequestOrigin(request);
  const payloadOrigin = resolveMerchantBusinessCardShareOrigin(requestOrigin, requestOrigin) || requestOrigin;
  const cachedImageUrl = readCachedCardImageUrl(shareKey, requestOrigin);
  const payloadPromise = loadMerchantBusinessCardSharePayloadByKey(shareKey, payloadOrigin);
  const snapshotImagePromise = cachedImageUrl
    ? null
    : resolveCardImageUrlFromSnapshot(shareKey, payloadOrigin).catch(() => "");
  const revoked = await withCardImageTimeout(
    isMerchantBusinessCardShareRevoked({
      shareKey,
      preferredOrigin: requestOrigin,
    }),
    false,
    500,
  );
  if (revoked) {
    clearCachedCardImageUrl(shareKey);
    return new NextResponse("Business card image not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  }
  if (cachedImageUrl) {
    void payloadPromise.then((freshPayload) => {
      writeCachedCardImageUrl(shareKey, requestOrigin, freshPayload?.imageUrl);
    }).catch(() => null);
  }
  const imageUrl =
    cachedImageUrl ||
    (await withCardImageTimeout(
      firstResolvedCardImageUrl([
        payloadPromise.then((payload) => String(payload?.imageUrl ?? "").trim()),
        ...(snapshotImagePromise ? [snapshotImagePromise] : []),
      ]),
      "",
      4_000,
    ));
  if (!imageUrl) {
    return new NextResponse("Business card image not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  }
  writeCachedCardImageUrl(shareKey, requestOrigin, imageUrl);

  const response = NextResponse.redirect(imageUrl, { status: 302 });
  response.headers.set("cache-control", CARD_IMAGE_REDIRECT_CACHE_CONTROL);
  return response;
}
