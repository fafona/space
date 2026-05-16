import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { createDefaultMerchantPermissionConfig } from "@/data/platformControlStore";
import { type MerchantAuthUserSummary } from "@/lib/merchantAuthIdentity";
import { readMerchantAuthCookie, readMerchantRequestAccessTokens } from "@/lib/merchantAuthSession";
import { buildPersonalAccountPermissionConfig, readPersonalAccountServiceConfigFromMetadata } from "@/lib/personalAccountServiceConfig";
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

export const runtime = "nodejs";

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
  | "business-card-intro-video"
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
    if (mime === "video/mp4") return "mp4";
    if (mime === "video/x-m4v") return "m4v";
    if (mime === "video/webm") return "webm";
    if (mime === "video/ogg") return "ogv";
    if (mime === "video/quicktime") return "mov";
    if (mime === "video/x-matroska") return "mkv";
    if (mime === "video/x-msvideo") return "avi";
    if (mime === "video/3gpp") return "3gp";
    if (mime === "video/3gpp2") return "3g2";
    if (mime === "video/mpeg") return "mpg";
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
  return new Blob([new Uint8Array(bytes)], { type: mime });
}

function runFfmpegBinary(binaryPath: string, args: string[], timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(binaryPath, args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("ffmpeg_timeout"));
    }, timeoutMs);

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr || `ffmpeg_exit_${code ?? "unknown"}`));
    });
  });
}

function isFfmpegBinaryUnavailable(error: unknown) {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  const message = error instanceof Error ? error.message : "";
  return code === "ENOENT" || code === "EACCES" || message.includes("ENOENT") || message.includes("EACCES");
}

async function runFfmpeg(args: string[], timeoutMs = 180_000) {
  const binaryCandidates = [typeof ffmpegPath === "string" ? ffmpegPath : "", "ffmpeg"].filter(Boolean);
  let lastError: unknown = null;
  for (const binaryPath of binaryCandidates) {
    try {
      await runFfmpegBinary(binaryPath, args, timeoutMs);
      return;
    } catch (error) {
      lastError = error;
      if (!isFfmpegBinaryUnavailable(error)) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("ffmpeg_unavailable");
}

async function transcodeBusinessCardIntroVideo(input: {
  blob: Blob;
  extension: string;
}) {
  const workspace = await mkdtemp(path.join(tmpdir(), "faolla-intro-video-"));
  const extension = input.extension.replace(/[^a-z0-9]+/gi, "") || "video";
  const inputPath = path.join(workspace, `source.${extension}`);
  const outputPath = path.join(workspace, "intro.mp4");
  try {
    const buffer = Buffer.from(await input.blob.arrayBuffer());
    await writeFile(inputPath, buffer);
    await runFfmpeg([
      "-y",
      "-i",
      inputPath,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-vf",
      "scale=720:-2:force_original_aspect_ratio=decrease",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "26",
      "-pix_fmt",
      "yuv420p",
      "-profile:v",
      "main",
      "-c:a",
      "aac",
      "-b:a",
      "96k",
      "-ac",
      "2",
      "-ar",
      "44100",
      "-movflags",
      "+faststart",
      outputPath,
    ]);
    const outputBuffer = await readFile(outputPath);
    if (outputBuffer.byteLength <= 0) {
      throw new Error("empty_transcoded_video");
    }
    return new Blob([new Uint8Array(outputBuffer)], { type: "video/mp4" });
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
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
    normalized === "business-card-intro-video" ||
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
    case "business-card-intro-video":
      return 10 * 1024 * 1024;
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
      permissionConfig: buildPersonalAccountPermissionConfig(readPersonalAccountServiceConfigFromMetadata(user)),
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
        message: "Only supported image, audio, video, and common document data URLs can be uploaded.",
      },
      { status: 400 },
    );
  }

  const originalBlob = dataUrlToBlob(dataUrl, meta.mime);
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
  if (originalBlob.size > limitBytes) {
    return NextResponse.json(
      {
        ok: false,
        code: "asset_size_limit_exceeded",
        message: `Asset exceeds the allowed size limit (${Math.round(limitBytes / 1024)}KB).`,
      },
      { status: 413 },
    );
  }

  let uploadBlob = originalBlob;
  let uploadMime = meta.mime;
  let uploadExtension = meta.extension;
  if (usage === "business-card-intro-video") {
    if (!meta.mime.startsWith("video/")) {
      return NextResponse.json(
        {
          ok: false,
          code: "unsupported_intro_video",
          message: "Business card intro video must be a supported video file.",
        },
        { status: 400 },
      );
    }

    try {
      uploadBlob = await transcodeBusinessCardIntroVideo({
        blob: originalBlob,
        extension: meta.extension,
      });
      uploadMime = "video/mp4";
      uploadExtension = "mp4";
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "";
      console.error("[asset-upload] intro video transcode failed", errorMessage);
      if (meta.mime === "video/mp4") {
        uploadBlob = originalBlob;
        uploadMime = "video/mp4";
        uploadExtension = "mp4";
      } else {
        const message =
          errorMessage === "ffmpeg_timeout"
            ? "视频转码超时，请换用更短的视频后再上传。"
            : errorMessage === "ffmpeg_unavailable" || isFfmpegBinaryUnavailable(error)
              ? "服务器视频转码组件不可用，请稍后再试。"
              : "视频无法转成网页可播放格式，请换用 MP4/H.264 视频后再上传。";
        return NextResponse.json(
          {
            ok: false,
            code: "intro_video_transcode_failed",
            message,
          },
          { status: 422 },
        );
      }
    }

    if (uploadBlob.size > limitBytes) {
      return NextResponse.json(
        {
          ok: false,
          code: "asset_size_limit_exceeded",
          message: `视频超过上限（${Math.round(limitBytes / 1024)}KB），请缩短视频或降低清晰度后再上传。`,
        },
        { status: 413 },
      );
    }
  }

  const now = new Date();
  const yyyy = `${now.getFullYear()}`;
  const mm = `${now.getMonth() + 1}`.padStart(2, "0");
  const uploadErrors: string[] = [];

  for (const bucket of BUCKET_CANDIDATES) {
    const objectPath = `${folder}/${actor.effectiveMerchantHint}/${yyyy}/${mm}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${uploadExtension}`;
    const uploaded = await supabase.storage.from(bucket).upload(objectPath, uploadBlob, {
      contentType: uploadMime,
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
