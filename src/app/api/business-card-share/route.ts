import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  buildMerchantBusinessCardShareManifestObjectPath,
  buildMerchantBusinessCardShareRevocationByKeyObjectPath,
  buildMerchantBusinessCardShareRevocationByLegacyPayloadObjectPath,
  resolveMerchantBusinessCardShareOrigin,
  buildMerchantBusinessCardShareUrl,
  normalizeMerchantBusinessCardSharePayload,
  normalizeMerchantBusinessCardShareContact,
  normalizeMerchantBusinessCardShareImageUrl,
  normalizeMerchantBusinessCardShareKey,
  normalizeMerchantBusinessCardShareTargetUrl,
} from "@/lib/merchantBusinessCardShare";
import { parseCookieValue, readMerchantRequestAccessTokens } from "@/lib/merchantAuthSession";
import { SUPER_ADMIN_SESSION_COOKIE, SUPER_ADMIN_SESSION_VALUE } from "@/lib/superAdminSession";

const BUCKET_CANDIDATES = ["page-assets", "assets", "uploads", "public"] as const;

type BusinessCardShareRequestBody = {
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

type PublicStorageClient = {
  storage: {
    from: (bucket: string) => PublicStorageBucketClient;
  };
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeImageDimension(value: unknown) {
  const normalized = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
  return normalized >= 120 && normalized <= 4096 ? normalized : 0;
}

function createShareKey() {
  return `card-${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

function createJsonBlob(value: unknown) {
  return new Blob([JSON.stringify(value)], { type: "application/json; charset=utf-8" });
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

async function isAuthorized(request: Request, supabaseUrl: string, serviceRoleKey: string) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  if (parseCookieValue(cookieHeader, SUPER_ADMIN_SESSION_COOKIE) === SUPER_ADMIN_SESSION_VALUE) {
    return true;
  }

  const accessTokens = readMerchantRequestAccessTokens(request);
  if (accessTokens.length === 0) return false;

  const authClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  for (const accessToken of accessTokens) {
    const { data, error } = await authClient.auth.getUser(accessToken);
    if (!error && data.user) {
      return true;
    }
  }
  return false;
}

export async function POST(request: Request) {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const serviceRoleKey =
    (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim() ||
    (process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ ok: false, error: "share_service_unavailable" }, { status: 503 });
  }

  if (!(await isAuthorized(request, supabaseUrl, serviceRoleKey))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: BusinessCardShareRequestBody | null = null;
  try {
    body = (await request.json()) as BusinessCardShareRequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const shareKey = normalizeMerchantBusinessCardShareKey(normalizeText(body?.key)) || createShareKey();
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
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  const payload = {
    name,
    imageUrl,
    ...(detailImageUrl ? { detailImageUrl } : {}),
    ...(detailImageUrl && detailImageHeight ? { detailImageHeight } : {}),
    targetUrl,
    ...(imageWidth ? { imageWidth } : {}),
    ...(imageHeight ? { imageHeight } : {}),
    ...(contact ? { contact } : {}),
  };
  const objectPath = buildMerchantBusinessCardShareManifestObjectPath(shareKey);
  if (!objectPath) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const blob = createJsonBlob(payload);
  const revocationKeyObjectPath = buildMerchantBusinessCardShareRevocationByKeyObjectPath(shareKey);
  if (revocationKeyObjectPath) {
    for (const bucket of BUCKET_CANDIDATES) {
      await supabase.storage.from(bucket).remove([revocationKeyObjectPath]);
    }
  }

  for (const bucket of BUCKET_CANDIDATES) {
    const uploaded = await supabase.storage.from(bucket).upload(objectPath, blob, {
      contentType: "application/json; charset=utf-8",
      cacheControl: "31536000",
      upsert: true,
    });
    if (uploaded.error) continue;

    const shareUrl = buildMerchantBusinessCardShareUrl({
      origin: shareOrigin,
      shareKey,
      imageUrl,
      targetUrl,
      name,
    });
    if (!shareUrl) break;

    return NextResponse.json({
      ok: true,
      shareKey,
      shareUrl,
      bucket,
      objectPath,
    });
  }

  return NextResponse.json({ ok: false, error: "share_manifest_upload_failed" }, { status: 409 });
}

export async function DELETE(request: Request) {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const serviceRoleKey =
    (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim() ||
    (process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ ok: false, error: "share_service_unavailable" }, { status: 503 });
  }

  if (!(await isAuthorized(request, supabaseUrl, serviceRoleKey))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: BusinessCardShareDeleteRequestBody | null = null;
  try {
    body = (await request.json()) as BusinessCardShareDeleteRequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
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
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const keyRevocation =
    keyRevocationObjectPath
      ? await uploadPublicJsonObject(supabase, keyRevocationObjectPath, {
          revokedAt: new Date().toISOString(),
          type: "share_key",
          shareKey,
        })
      : null;
  if (keyRevocation && !keyRevocation.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "share_revocation_upload_failed",
        shareKey,
        failedBuckets: keyRevocation.failedBuckets,
      },
      { status: 409 },
    );
  }

  const legacyRevocation =
    legacyRevocationObjectPath
      ? await uploadPublicJsonObject(supabase, legacyRevocationObjectPath, {
          revokedAt: new Date().toISOString(),
          type: "legacy_payload",
        })
      : null;
  if (legacyRevocation && !legacyRevocation.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "share_revocation_upload_failed",
        shareKey,
        failedBuckets: legacyRevocation.failedBuckets,
      },
      { status: 409 },
    );
  }

  const manifestRemoval = objectPath ? await removePublicObject(supabase, objectPath) : null;
  if (manifestRemoval && manifestRemoval.failedBuckets.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "share_manifest_delete_failed",
        shareKey,
        failedBuckets: manifestRemoval.failedBuckets,
      },
      { status: 409 },
    );
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
