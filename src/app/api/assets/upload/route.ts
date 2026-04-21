import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createDefaultMerchantPermissionConfig } from "@/data/platformControlStore";
import { type MerchantAuthUserSummary } from "@/lib/merchantAuthIdentity";
import { readMerchantAuthCookie, readMerchantRequestAccessTokens } from "@/lib/merchantAuthSession";
import {
  resolvePlatformAccountIdentityForUser,
  type PlatformIdentitySupabaseClient,
} from "@/lib/platformAccountIdentity";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import {
  loadStoredPlatformMerchantSnapshot,
  type PlatformMerchantSnapshotStoreClient,
} from "@/lib/platformMerchantSnapshotStore";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";
import { createServerSupabaseAuthClient, createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import { isSuperAdminRequestAuthorized } from "@/lib/superAdminRequestAuth";

const BUCKET_CANDIDATES = ["page-assets", "assets", "uploads", "public"] as const;
const FOLDER_CANDIDATES = new Set(["merchant-assets", "merchant-audio", "merchant-files"]);

type AssetUploadRequestBody = {
  dataUrl?: string;
  merchantHint?: string;
  folder?: string;
  usage?: unknown;
};

type AssetUsage =
  | "common-block-image"
  | "gallery-block-image"
  | "business-card-background"
  | "business-card-contact"
  | "business-card-export"
  | "support-image"
  | "support-file"
  | "audio"
  | "generic-image";

type ActorContext =
  | {
      ok: true;
      effectiveMerchantHint: string;
      permissionConfig: ReturnType<typeof createDefaultMerchantPermissionConfig>;
    }
  | { ok: false };

function parseDataUrlMeta(dataUrl: string) {
  const matched = dataUrl.match(/^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,/i);
  if (!matched) return null;
  const mime = matched[1].toLowerCase();
  const extension = (() => {
    if (mime === "image/jpeg") return "jpg";
    if (mime === "image/png") return "png";
    if (mime === "image/webp") return "webp";
    if (mime === "image/gif") return "gif";
    if (mime === "image/bmp") return "bmp";
    if (mime === "image/svg+xml") return "svg";
    if (mime === "audio/mpeg" || mime === "audio/mp3") return "mp3";
    if (mime === "audio/wav" || mime === "audio/x-wav") return "wav";
    if (mime === "audio/ogg") return "ogg";
    if (mime === "audio/aac") return "aac";
    if (mime === "audio/webm") return "webm";
    if (mime === "audio/mp4") return "m4a";
    if (mime === "application/pdf") return "pdf";
    if (mime === "text/plain") return "txt";
    if (mime === "text/csv") return "csv";
    if (mime === "application/json") return "json";
    if (mime === "application/zip" || mime === "application/x-zip-compressed") return "zip";
    if (mime === "application/x-rar-compressed") return "rar";
    if (mime === "application/x-7z-compressed") return "7z";
    if (mime === "application/msword") return "doc";
    if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
    if (mime === "application/vnd.ms-excel") return "xls";
    if (mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "xlsx";
    if (mime === "application/vnd.ms-powerpoint") return "ppt";
    if (mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return "pptx";
    const subtype = mime.split("/")[1] ?? "";
    const normalizedSubtype = subtype.split("+")[0]?.split(".").pop()?.replace(/[^a-z0-9]+/gi, "");
    return normalizedSubtype || "bin";
  })();
  return { mime, extension };
}

function dataUrlToBlob(dataUrl: string, mime: string) {
  const base64 = dataUrl.split(",")[1] ?? "";
  const bytes = Buffer.from(base64, "base64");
  return new Blob([bytes], { type: mime });
}

function sanitizeMerchantHint(input: string) {
  const normalized = String(input ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-");
  return normalized || "public";
}

function normalizeStoragePublicUrl(value: string) {
  const normalized = String(value ?? "").trim();
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

function normalizeAssetUsage(value: unknown, folder: string, mime: string): AssetUsage {
  const normalized = String(value ?? "").trim();
  if (
    normalized === "common-block-image" ||
    normalized === "gallery-block-image" ||
    normalized === "business-card-background" ||
    normalized === "business-card-contact" ||
    normalized === "business-card-export" ||
    normalized === "support-image" ||
    normalized === "support-file" ||
    normalized === "audio"
  ) {
    return normalized;
  }
  if (folder === "merchant-audio" || mime.startsWith("audio/")) return "audio";
  if (folder === "merchant-files") return "support-file";
  return "generic-image";
}

function getAssetUploadLimitBytes(input: {
  usage: AssetUsage;
  permissionConfig: ReturnType<typeof createDefaultMerchantPermissionConfig>;
}) {
  const permissionConfig = input.permissionConfig;
  switch (input.usage) {
    case "gallery-block-image":
      return Math.max(50, Math.round(permissionConfig.galleryBlockImageLimitKb)) * 1024;
    case "business-card-background":
      return Math.max(50, Math.round(permissionConfig.businessCardBackgroundImageLimitKb)) * 1024;
    case "business-card-contact":
      return Math.max(50, Math.round(permissionConfig.businessCardContactImageLimitKb)) * 1024;
    case "business-card-export":
      return Math.max(50, Math.round(permissionConfig.businessCardExportImageLimitKb)) * 1024;
    case "support-image":
      return 512 * 1024;
    case "support-file":
      return 8 * 1024 * 1024;
    case "audio":
      return 10 * 1024 * 1024;
    case "common-block-image":
    case "generic-image":
    default:
      return Math.max(50, Math.round(permissionConfig.commonBlockImageLimitKb)) * 1024;
  }
}

async function resolveActorContext(
  request: Request,
  supabase: PlatformMerchantSnapshotStoreClient,
  merchantHint: string,
): Promise<ActorContext> {
  if (isSuperAdminRequestAuthorized(request)) {
    return {
      ok: true,
      effectiveMerchantHint: merchantHint || "platform",
      permissionConfig: createDefaultMerchantPermissionConfig(),
    };
  }

  const resolvedSession = await resolveMerchantSessionFromRequest(request);
  if (!resolvedSession?.merchantId) {
    const authSupabase = createServerSupabaseAuthClient();
    const adminSupabase = createServerSupabaseServiceClient() as unknown as PlatformIdentitySupabaseClient | null;
    if (!authSupabase || !adminSupabase) return { ok: false };

    const accessTokens = readMerchantRequestAccessTokens(request);
    const fallbackAccessToken = readMerchantAuthCookie(request);
    const candidates = [...accessTokens, fallbackAccessToken].map((value) => String(value ?? "").trim()).filter(Boolean);
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
    if (!user) return { ok: false };

    const identity = await resolvePlatformAccountIdentityForUser(adminSupabase, user);
    if (identity.accountType !== "personal" || !identity.accountId) return { ok: false };
    return {
      ok: true,
      effectiveMerchantHint: sanitizeMerchantHint(identity.accountId || merchantHint || "personal"),
      permissionConfig: createDefaultMerchantPermissionConfig(),
    };
  }

  const snapshotPayload = await loadStoredPlatformMerchantSnapshot(supabase).catch(() => null);
  const snapshotSite = snapshotPayload?.snapshot.find((site) => site.id === resolvedSession.merchantId) ?? null;
  return {
    ok: true,
    effectiveMerchantHint: sanitizeMerchantHint(resolvedSession.merchantId),
    permissionConfig: snapshotSite?.permissionConfig ?? createDefaultMerchantPermissionConfig(),
  };
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
    return NextResponse.json(
      {
        ok: false,
        code: "asset_upload_service_unavailable",
        message: "Asset upload service is not configured.",
      },
      { status: 503 },
    );
  }

  let body: AssetUploadRequestBody;
  try {
    body = (await request.json()) as AssetUploadRequestBody;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        code: "invalid_json",
        message: "Request body must be valid JSON.",
      },
      { status: 400 },
    );
  }

  const dataUrl = String(body.dataUrl ?? "").trim();
  const folder = String(body.folder ?? "").trim();
  if (!dataUrl || !FOLDER_CANDIDATES.has(folder)) {
    return NextResponse.json(
      {
        ok: false,
        code: "invalid_payload",
        message: "A supported upload payload is required.",
      },
      { status: 400 },
    );
  }

  const meta = parseDataUrlMeta(dataUrl);
  if (!meta) {
    return NextResponse.json(
      {
        ok: false,
        code: "unsupported_asset",
        message: "Only supported image, audio, and common document data URLs can be uploaded.",
      },
      { status: 400 },
    );
  }

  const blob = dataUrlToBlob(dataUrl, meta.mime);
  const merchantHint = sanitizeMerchantHint(String(body.merchantHint ?? "public"));
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const actor = await resolveActorContext(request, supabase as unknown as PlatformMerchantSnapshotStoreClient, merchantHint);
  if (!actor.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: "unauthorized",
        message: "Unauthorized asset upload request.",
      },
      { status: 401 },
    );
  }

  const usage = normalizeAssetUsage(body.usage, folder, meta.mime);
  const limitBytes = getAssetUploadLimitBytes({
    usage,
    permissionConfig: actor.permissionConfig,
  });
  if (blob.size > limitBytes) {
    return NextResponse.json(
      {
        ok: false,
        code: "asset_size_limit_exceeded",
        message: `Asset exceeds the allowed size limit (${Math.round(limitBytes / 1024)}KB).`,
      },
      { status: 413 },
    );
  }

  const now = new Date();
  const yyyy = `${now.getFullYear()}`;
  const mm = `${now.getMonth() + 1}`.padStart(2, "0");
  const uploadErrors: string[] = [];

  for (const bucket of BUCKET_CANDIDATES) {
    const objectPath = `${folder}/${actor.effectiveMerchantHint}/${yyyy}/${mm}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${meta.extension}`;
    const uploaded = await supabase.storage.from(bucket).upload(objectPath, blob, {
      contentType: meta.mime,
      upsert: false,
    });
    if (uploaded.error) {
      uploadErrors.push(`${bucket}: ${uploaded.error.message}`);
      continue;
    }
    const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
    if (data?.publicUrl) {
      return NextResponse.json({
        ok: true,
        bucket,
        objectPath,
        url: normalizeStoragePublicUrl(data.publicUrl),
      });
    }
    uploadErrors.push(`${bucket}: failed to resolve public url`);
  }

  return NextResponse.json(
    {
      ok: false,
      code: "asset_upload_failed",
      message: uploadErrors.join(" | ") || "Asset upload failed.",
    },
    { status: 409 },
  );
}
