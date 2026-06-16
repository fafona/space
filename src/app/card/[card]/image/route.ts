import { NextResponse } from "next/server";
import {
  isMerchantBusinessCardShareRevoked,
  loadMerchantBusinessCardSharePayloadByKey,
  normalizeMerchantBusinessCardShareKey,
  resolveMerchantBusinessCardShareOrigin,
} from "@/lib/merchantBusinessCardShare";

const CARD_IMAGE_CACHE_TTL_MS = 60_000;
const CARD_IMAGE_REDIRECT_CACHE_CONTROL = "public, max-age=0, s-maxage=300, stale-while-revalidate=600";

const cardImageUrlCache = new Map<
  string,
  {
    expiresAt: number;
    imageUrl: string;
  }
>();

function resolveRequestOrigin(request: Request) {
  const forwardedHost = String(request.headers.get("x-forwarded-host") ?? "").trim();
  const host = forwardedHost || String(request.headers.get("host") ?? "").trim();
  const forwardedProto = String(request.headers.get("x-forwarded-proto") ?? "").trim();
  if (!host) return new URL(request.url).origin;
  const protocol = forwardedProto || (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${protocol}://${host}`;
}

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

function readCachedCardImageUrl(shareKey: string) {
  const normalizedShareKey = normalizeMerchantBusinessCardShareKey(shareKey);
  if (!normalizedShareKey) return "";
  const cached = cardImageUrlCache.get(normalizedShareKey);
  if (!cached) return "";
  if (cached.expiresAt <= Date.now()) {
    cardImageUrlCache.delete(normalizedShareKey);
    return "";
  }
  return cached.imageUrl;
}

function writeCachedCardImageUrl(shareKey: string, imageUrl: string | null | undefined) {
  const normalizedShareKey = normalizeMerchantBusinessCardShareKey(shareKey);
  const normalizedImageUrl = String(imageUrl ?? "").trim();
  if (!normalizedShareKey || !normalizedImageUrl) return;
  cardImageUrlCache.set(normalizedShareKey, {
    expiresAt: Date.now() + CARD_IMAGE_CACHE_TTL_MS,
    imageUrl: normalizedImageUrl,
  });
}

function clearCachedCardImageUrl(shareKey: string) {
  const normalizedShareKey = normalizeMerchantBusinessCardShareKey(shareKey);
  if (normalizedShareKey) cardImageUrlCache.delete(normalizedShareKey);
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

  const requestOrigin = resolveRequestOrigin(request);
  const payloadOrigin = resolveMerchantBusinessCardShareOrigin(requestOrigin, requestOrigin) || requestOrigin;
  const cachedImageUrl = readCachedCardImageUrl(shareKey);
  const payloadPromise = loadMerchantBusinessCardSharePayloadByKey(shareKey, payloadOrigin);
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
      writeCachedCardImageUrl(shareKey, freshPayload?.imageUrl);
    }).catch(() => null);
  }
  const imageUrl =
    cachedImageUrl ||
    (await withCardImageTimeout(
      payloadPromise.then((payload) => String(payload?.imageUrl ?? "").trim()).catch(() => ""),
      "",
      1_800,
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
  writeCachedCardImageUrl(shareKey, imageUrl);

  const response = NextResponse.redirect(imageUrl, { status: 302 });
  response.headers.set("cache-control", CARD_IMAGE_REDIRECT_CACHE_CONTROL);
  return response;
}
