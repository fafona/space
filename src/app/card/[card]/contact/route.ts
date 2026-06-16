import { NextResponse } from "next/server";
import {
  buildMerchantBusinessCardVCard,
  buildMerchantBusinessCardVCardFileName,
  isMerchantBusinessCardShareRevoked,
  loadMerchantBusinessCardSharePayloadByKey,
  normalizeMerchantBusinessCardShareKey,
  resolveMerchantBusinessCardShareOrigin,
  type MerchantBusinessCardSharePayload,
} from "@/lib/merchantBusinessCardShare";

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

function resolveRequestOrigin(request: Request) {
  const forwardedHost = String(request.headers.get("x-forwarded-host") ?? "").trim();
  const host = forwardedHost || String(request.headers.get("host") ?? "").trim();
  const forwardedProto = String(request.headers.get("x-forwarded-proto") ?? "").trim();
  if (!host) return new URL(request.url).origin;
  const protocol = forwardedProto || (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${protocol}://${host}`;
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

function buildContactDownloadCacheKey(shareKey: string, origin: string) {
  const normalizedShareKey = normalizeMerchantBusinessCardShareKey(shareKey);
  const normalizedOrigin = String(origin ?? "").trim();
  return normalizedShareKey && normalizedOrigin ? `${normalizedShareKey}|${normalizedOrigin}` : "";
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
  const { card } = await params;
  const shareKey = normalizeMerchantBusinessCardShareKey(card);
  if (!shareKey) {
    return new NextResponse("Invalid business card contact", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  }

  const requestOrigin = resolveRequestOrigin(request);
  const payloadOrigin = resolveMerchantBusinessCardShareOrigin(requestOrigin, requestOrigin) || requestOrigin;
  const cachedPayload = readCachedContactDownloadPayload(shareKey, payloadOrigin);
  const payloadPromise = loadMerchantBusinessCardSharePayloadByKey(shareKey, payloadOrigin);
  const revoked = await withContactDownloadTimeout(
    readContactDownloadRevocationCached(shareKey, requestOrigin),
    false,
    350,
  );
  if (revoked) {
    clearCachedContactDownloadPayload(shareKey, payloadOrigin);
    return new NextResponse("Business card contact not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  }
  if (cachedPayload) {
    void payloadPromise
      .then((freshPayload) => writeCachedContactDownloadPayload(shareKey, payloadOrigin, freshPayload))
      .catch(() => null);
  }
  const payload =
    cachedPayload ||
    (await withContactDownloadTimeout(
      payloadPromise.then((freshPayload) => freshPayload).catch(() => null),
      null,
      2_000,
    ));
  if (!payload) {
    return new NextResponse("Business card contact not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  }
  writeCachedContactDownloadPayload(shareKey, payloadOrigin, payload);

  const vcard = buildMerchantBusinessCardVCard(payload);
  const fileName = buildMerchantBusinessCardVCardFileName(payload);
  return new NextResponse(vcard, {
    status: 200,
    headers: {
      "content-type": "text/vcard; charset=utf-8",
      "content-disposition": buildContentDisposition(fileName),
      "cache-control": "no-store, max-age=0",
    },
  });
}
