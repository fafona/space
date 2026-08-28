import { NextResponse as FrameworkNextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { createDefaultMerchantPermissionConfig } from "@/data/platformControlStore";
import {
  authorizeMerchantBusinessRequest,
  reauthorizeMerchantBusinessMutation,
  toMerchantBusinessAccessResponse,
  type MerchantBusinessActor,
} from "@/lib/merchantBusinessActor.server";
import type { MerchantStaffBusinessPermission } from "@/lib/merchantStaffBusiness";
import { type MerchantAuthUserSummary } from "@/lib/merchantAuthIdentity";
import { readMerchantAuthCookie, readMerchantRequestAccessTokens } from "@/lib/merchantAuthSession";
import { buildPersonalAccountPermissionConfig, readPersonalAccountServiceConfigFromMetadata } from "@/lib/personalAccountServiceConfig";
import {
  resolvePlatformAccountIdentityForUser,
  type PlatformIdentitySupabaseClient,
} from "@/lib/platformAccountIdentity";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { normalizePublicAssetResponseUrl } from "@/lib/publicAssetUrl";
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
const BUSINESS_CARD_INTRO_VIDEO_SOURCE_LIMIT_BYTES = 80 * 1024 * 1024;
const PRIVATE_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
} as const;

export function withAssetUploadPrivateResponseHeaders<T extends FrameworkNextResponse>(
  response: T,
) {
  for (const [name, value] of Object.entries(PRIVATE_RESPONSE_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

export function assetUploadJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(PRIVATE_RESPONSE_HEADERS)) {
    headers.set(name, value);
  }
  return FrameworkNextResponse.json(body, { ...init, headers });
}

// Keep every route-local early return on the same private response contract.
const NextResponse = { json: assetUploadJson } as const;

type AssetUploadSuccessBodyInput = {
  bucket: string;
  url: string;
  objectPath?: string;
  thumbnailUrl?: string;
  thumbnailObjectPath?: string;
  posterUrl?: string;
  posterObjectPath?: string;
};

export function buildAssetUploadSuccessBody(
  input: AssetUploadSuccessBodyInput,
  employeeBusinessRequest: boolean,
) {
  if (employeeBusinessRequest) {
    return {
      ok: true,
      url: input.url,
      ...(input.thumbnailUrl ? { thumbnailUrl: input.thumbnailUrl } : {}),
      ...(input.posterUrl ? { posterUrl: input.posterUrl } : {}),
    };
  }
  return {
    ok: true,
    bucket: input.bucket,
    ...(input.objectPath ? { objectPath: input.objectPath } : {}),
    url: input.url,
    ...(input.posterUrl
      ? { posterUrl: input.posterUrl, posterObjectPath: input.posterObjectPath }
      : {}),
    ...(input.thumbnailUrl
      ? {
          thumbnailUrl: input.thumbnailUrl,
          thumbnailObjectPath: input.thumbnailObjectPath,
        }
      : {}),
  };
}

export function buildAssetUploadFailureMessage(
  uploadErrors: readonly string[],
  fallback: string,
  employeeBusinessRequest: boolean,
) {
  return employeeBusinessRequest
    ? fallback
    : uploadErrors.join(" | ") || fallback;
}

type AssetUploadCleanupStorage = {
  from(bucket: string): {
    remove(objectPaths: string[]): PromiseLike<unknown>;
  };
};

export async function cleanupEmployeeBusinessAssetUploadObjects(
  storage: AssetUploadCleanupStorage,
  bucket: string,
  objectPaths: readonly string[],
  employeeBusinessRequest: boolean,
) {
  if (!employeeBusinessRequest) return;
  const uniquePaths = [...new Set(objectPaths.filter(Boolean))];
  if (uniquePaths.length === 0) return;
  // This is compensating cleanup through the service storage client. It must
  // remain available after the employee authorization has been revoked.
  await Promise.resolve(storage.from(bucket).remove(uniquePaths)).catch(
    () => undefined,
  );
}

type AssetUploadRequestBody = {
  dataUrl?: string;
  sourceUrl?: string;
  siteId?: string;
  merchantHint?: string;
  folder?: string;
  usage?: unknown;
  businessPurpose?: unknown;
};

export type AssetUploadBusinessPurpose = "order-catalog" | "redemption-catalog";

type AssetUsage =
  | "common-block-image"
  | "gallery-block-image"
  | "page-background"
  | "business-card-background"
  | "business-card-contact"
  | "business-card-export"
  | "business-card-intro-video"
  | "business-card-intro-image"
  | "business-card-intro-audio"
  | "business-card-background-audio"
  | "product-image"
  | "support-image"
  | "support-file"
  | "audio"
  | "generic-image";

type ActorContext =
  | {
      ok: true;
      effectiveMerchantHint: string;
      permissionConfig: ReturnType<typeof createDefaultMerchantPermissionConfig>;
      businessAuthorization?: {
        actor: MerchantBusinessActor;
        requiredPermission: MerchantStaffBusinessPermission;
        purpose: AssetUploadBusinessPurpose;
      };
    }
  | { ok: false; status?: number; code?: string };

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

function inferVideoMimeFromFileName(fileName: string) {
  if (/\.mp4$/i.test(fileName)) return "video/mp4";
  if (/\.m4v$/i.test(fileName)) return "video/x-m4v";
  if (/\.webm$/i.test(fileName)) return "video/webm";
  if (/\.(ogv|ogg)$/i.test(fileName)) return "video/ogg";
  if (/\.mov$/i.test(fileName)) return "video/quicktime";
  if (/\.mkv$/i.test(fileName)) return "video/x-matroska";
  if (/\.avi$/i.test(fileName)) return "video/x-msvideo";
  if (/\.3gp$/i.test(fileName)) return "video/3gpp";
  if (/\.3g2$/i.test(fileName)) return "video/3gpp2";
  if (/\.(mpg|mpeg)$/i.test(fileName)) return "video/mpeg";
  return "";
}

function parseBlobUploadMeta(blob: Blob, fileName: string) {
  const rawMime = String(blob.type || "").toLowerCase();
  const inferredVideoMime = inferVideoMimeFromFileName(fileName);
  const mime =
    inferredVideoMime && (!rawMime || rawMime === "application/octet-stream")
      ? inferredVideoMime
      : rawMime || inferredVideoMime || "application/octet-stream";
  const extension = parseDataUrlMeta(`data:${mime};base64,`)?.extension || fileName.split(".").pop()?.replace(/[^a-z0-9]+/gi, "") || "bin";
  return { mime, extension };
}

function dataUrlToBlob(dataUrl: string, mime: string) {
  const base64 = dataUrl.split(",")[1] ?? "";
  const bytes = Buffer.from(base64, "base64");
  return new Blob([new Uint8Array(bytes)], { type: mime });
}

function isAllowedPublicStorageImageSourceUrl(value: string, requestUrl: string) {
  try {
    const url = new URL(value, requestUrl);
    const hostname = url.hostname.toLowerCase();
    const allowedHost =
      hostname === "faolla.com" ||
      hostname.endsWith(".faolla.com") ||
      hostname.endsWith(".supabase.co") ||
      hostname === "localhost" ||
      hostname === "127.0.0.1";
    if (!allowedHost) return null;
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.pathname.startsWith("/storage/v1/object/public/")) return null;
    return url;
  } catch {
    return null;
  }
}

async function fetchPublicStorageImageSource(input: { sourceUrl: string; requestUrl: string; maxBytes: number }) {
  const url = isAllowedPublicStorageImageSourceUrl(input.sourceUrl, input.requestUrl);
  if (!url) {
    throw new Error("unsupported_source_url");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`source_fetch_failed_${response.status}`);
    }
    const mime = String(response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
    if (!mime.startsWith("image/") || mime === "image/svg+xml") {
      throw new Error("unsupported_source_mime");
    }
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > input.maxBytes) {
      throw new Error("source_size_limit_exceeded");
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength <= 0) {
      throw new Error("empty_source_image");
    }
    if (buffer.byteLength > input.maxBytes) {
      throw new Error("source_size_limit_exceeded");
    }
    const extension = parseDataUrlMeta(`data:${mime};base64,`)?.extension || "img";
    return {
      sourceUrl: normalizeStoragePublicUrl(url.toString()),
      blob: new Blob([new Uint8Array(buffer)], { type: mime }),
      meta: { mime, extension },
    };
  } finally {
    clearTimeout(timeout);
  }
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

function getFfmpegBinaryCandidates() {
  return Array.from(
    new Set(
      [
        process.env.FFMPEG_PATH,
        typeof ffmpegPath === "string" ? ffmpegPath : "",
        path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"),
        "ffmpeg",
      ]
        .map((candidate) => candidate?.trim())
        .filter((candidate): candidate is string => Boolean(candidate)),
    ),
  );
}

async function runFfmpeg(args: string[], timeoutMs = 180_000) {
  const binaryCandidates = getFfmpegBinaryCandidates();
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

function probeMediaDurationWithBinary(binaryPath: string, inputPath: string, timeoutMs: number) {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(binaryPath, ["-hide_banner", "-i", inputPath], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let settled = false;
    const finishReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finishReject(new Error("ffmpeg_timeout"));
    }, timeoutMs);
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });
    child.on("error", finishReject);
    child.on("close", () => {
      if (settled) return;
      const matched = stderr.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/i);
      if (!matched) {
        finishReject(new Error("media_duration_unavailable"));
        return;
      }
      const hours = Number(matched[1]);
      const minutes = Number(matched[2]);
      const seconds = Number(matched[3]);
      const duration = hours * 3600 + minutes * 60 + seconds;
      if (!Number.isFinite(duration) || duration <= 0) {
        finishReject(new Error("media_duration_unavailable"));
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(duration);
    });
  });
}

async function probeMediaDurationSeconds(blob: Blob, extension: string) {
  const workspace = await mkdtemp(path.join(tmpdir(), "faolla-audio-probe-"));
  const inputPath = path.join(workspace, `source.${extension.replace(/[^a-z0-9]+/gi, "") || "audio"}`);
  try {
    await writeFile(inputPath, Buffer.from(await blob.arrayBuffer()));
    let lastError: unknown = null;
    for (const binaryPath of getFfmpegBinaryCandidates()) {
      try {
        return await probeMediaDurationWithBinary(binaryPath, inputPath, 15_000);
      } catch (error) {
        lastError = error;
        if (!isFfmpegBinaryUnavailable(error)) break;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("ffmpeg_unavailable");
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function transcodeBusinessCardIntroVideo(input: {
  blob: Blob;
  extension: string;
  targetBytes: number;
}) {
  const workspace = await mkdtemp(path.join(tmpdir(), "faolla-intro-video-"));
  const extension = input.extension.replace(/[^a-z0-9]+/gi, "") || "video";
  const inputPath = path.join(workspace, `source.${extension}`);
  const profiles = [
    { width: 540, crf: 26, audio: "96k", maxrate: "900k", bufsize: "1800k" },
    { width: 540, crf: 30, audio: "80k", maxrate: "700k", bufsize: "1400k" },
    { width: 480, crf: 32, audio: "64k", maxrate: "520k", bufsize: "1040k" },
    { width: 360, crf: 34, audio: "64k", maxrate: "360k", bufsize: "720k" },
  ];
  try {
    const buffer = Buffer.from(await input.blob.arrayBuffer());
    await writeFile(inputPath, buffer);
    let smallestOutput: Buffer | null = null;
    let lastTranscodeError: unknown = null;
    for (const [index, profile] of profiles.entries()) {
      const outputPath = path.join(workspace, `intro-${index}.mp4`);
      try {
        await runFfmpeg([
          "-y",
          "-i",
          inputPath,
          "-map",
          "0:v:0",
          "-map",
          "0:a?",
          "-vf",
          `fps=24,scale=${profile.width}:-2:force_original_aspect_ratio=decrease,crop=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1`,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-tune",
          "fastdecode",
          "-crf",
          `${profile.crf}`,
          "-maxrate",
          profile.maxrate,
          "-bufsize",
          profile.bufsize,
          "-pix_fmt",
          "yuv420p",
          "-profile:v",
          "baseline",
          "-level:v",
          "3.0",
          "-tag:v",
          "avc1",
          "-x264-params",
          "keyint=48:min-keyint=24:scenecut=0:ref=1:bframes=0:cabac=0:weightp=0:8x8dct=0:aud=1",
          "-c:a",
          "aac",
          "-b:a",
          profile.audio,
          "-ac",
          "2",
          "-ar",
          "44100",
          "-brand",
          "mp42",
          "-video_track_timescale",
          "90000",
          "-movflags",
          "+faststart",
          outputPath,
        ]);
      } catch (error) {
        lastTranscodeError = error;
        continue;
      }
      const outputBuffer = await readFile(outputPath);
      if (outputBuffer.byteLength <= 0) {
        lastTranscodeError = new Error("empty_transcoded_video");
        continue;
      }
      if (!smallestOutput || outputBuffer.byteLength < smallestOutput.byteLength) {
        smallestOutput = outputBuffer;
      }
      if (outputBuffer.byteLength <= input.targetBytes) {
        return new Blob([new Uint8Array(outputBuffer)], { type: "video/mp4" });
      }
    }
    if (smallestOutput) {
      return new Blob([new Uint8Array(smallestOutput)], { type: "video/mp4" });
    }
    throw lastTranscodeError instanceof Error ? lastTranscodeError : new Error("empty_transcoded_video");
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function extractBusinessCardIntroVideoPoster(input: {
  blob: Blob;
  extension: string;
}) {
  const workspace = await mkdtemp(path.join(tmpdir(), "faolla-intro-poster-"));
  const extension = input.extension.replace(/[^a-z0-9]+/gi, "") || "video";
  const inputPath = path.join(workspace, `source.${extension}`);
  const baseFilter = "scale=720:-2:force_original_aspect_ratio=decrease,crop=trunc(iw/2)*2:trunc(ih/2)*2";
  const representativeFilter = `thumbnail=72,${baseFilter}`;
  const posterAttempts = [
    {
      outputPath: path.join(workspace, "poster-first.jpg"),
      args: ["-y", "-i", inputPath, "-frames:v", "1", "-vf", baseFilter, "-q:v", "3"],
    },
    {
      outputPath: path.join(workspace, "poster-representative-025.jpg"),
      args: ["-y", "-ss", "0.25", "-i", inputPath, "-frames:v", "1", "-vf", representativeFilter, "-q:v", "3"],
    },
    {
      outputPath: path.join(workspace, "poster-representative-080.jpg"),
      args: ["-y", "-ss", "0.8", "-i", inputPath, "-frames:v", "1", "-vf", representativeFilter, "-q:v", "3"],
    },
  ];
  try {
    const buffer = Buffer.from(await input.blob.arrayBuffer());
    await writeFile(inputPath, buffer);
    let lastError: unknown = null;
    for (const attempt of posterAttempts) {
      try {
        await runFfmpeg([...attempt.args, attempt.outputPath], 60_000);
        const outputBuffer = await readFile(attempt.outputPath);
        if (outputBuffer.byteLength > 0) {
          return new Blob([new Uint8Array(outputBuffer)], { type: "image/jpeg" });
        }
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("empty_intro_video_poster");
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function createImageThumbnail(input: {
  blob: Blob;
  extension: string;
}) {
  const workspace = await mkdtemp(path.join(tmpdir(), "faolla-image-thumb-"));
  const extension = input.extension.replace(/[^a-z0-9]+/gi, "") || "image";
  const inputPath = path.join(workspace, `source.${extension}`);
  const outputPath = path.join(workspace, "thumbnail.webp");
  try {
    const buffer = Buffer.from(await input.blob.arrayBuffer());
    await writeFile(inputPath, buffer);
    await runFfmpeg(
      [
        "-y",
        "-i",
        inputPath,
        "-frames:v",
        "1",
        "-vf",
        "scale=640:640:force_original_aspect_ratio=decrease",
        "-an",
        "-c:v",
        "libwebp",
        "-quality",
        "78",
        "-compression_level",
        "4",
        outputPath,
      ],
      60_000,
    );
    const outputBuffer = await readFile(outputPath);
    if (outputBuffer.byteLength > 0) {
      return new Blob([new Uint8Array(outputBuffer)], { type: "image/webp" });
    }
    throw new Error("empty_image_thumbnail");
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
  return normalizePublicAssetResponseUrl(normalized);
}

function normalizeAssetUsage(value: unknown, folder: string, mime: string): AssetUsage {
  const normalized = String(value ?? "").trim();
  if (
    normalized === "common-block-image" ||
    normalized === "gallery-block-image" ||
    normalized === "page-background" ||
    normalized === "business-card-background" ||
    normalized === "business-card-contact" ||
    normalized === "business-card-export" ||
    normalized === "business-card-intro-video" ||
    normalized === "business-card-intro-image" ||
    normalized === "business-card-intro-audio" ||
    normalized === "business-card-background-audio" ||
    normalized === "product-image" ||
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

export type ProductImageUploadProcessingError = {
  status: 422;
  code: "unsupported_product_image" | "product_image_decode_failed";
  message: string;
};

/** Product images must be decodable before any object is written to storage. */
export function resolveProductImageUploadProcessingError(input: {
  usage: unknown;
  mime: unknown;
  thumbnailReady: boolean;
}): ProductImageUploadProcessingError | null {
  if (input.usage !== "product-image") return null;
  const mime = String(input.mime ?? "").trim().toLowerCase();
  if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") {
    return {
      status: 422,
      code: "unsupported_product_image",
      message: "Product images must be JPEG, PNG, or WebP files.",
    };
  }
  if (!input.thumbnailReady) {
    return {
      status: 422,
      code: "product_image_decode_failed",
      message: "Product image decoding failed. Please choose another JPEG, PNG, or WebP file.",
    };
  }
  return null;
}

function getAssetUploadLimitBytes(input: {
  usage: AssetUsage;
  permissionConfig: ReturnType<typeof createDefaultMerchantPermissionConfig>;
}) {
  const permissionConfig = input.permissionConfig;
  switch (input.usage) {
    case "page-background":
      return 512 * 1024;
    case "gallery-block-image":
      return Math.max(50, Math.round(permissionConfig.galleryBlockImageLimitKb)) * 1024;
    case "business-card-background":
      return Math.max(50, Math.round(permissionConfig.businessCardBackgroundImageLimitKb)) * 1024;
    case "business-card-contact":
      return Math.max(50, Math.round(permissionConfig.businessCardContactImageLimitKb)) * 1024;
    case "business-card-export":
      return Math.max(50, Math.round(permissionConfig.businessCardExportImageLimitKb)) * 1024;
    case "business-card-intro-video":
      return Math.max(
        1,
        Math.round(permissionConfig.businessCardIntroVideoLimitMb || createDefaultMerchantPermissionConfig().businessCardIntroVideoLimitMb),
      ) * 1024 * 1024;
    case "business-card-intro-image":
    case "business-card-intro-audio":
      return 200 * 1024;
    case "business-card-background-audio":
      return 5 * 1024 * 1024;
    case "support-image":
      return 512 * 1024;
    case "product-image":
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

export type AssetUploadActorContextDependencies = {
  resolveMerchantSession: typeof resolveMerchantSessionFromRequest;
};

const DEFAULT_ACTOR_CONTEXT_DEPENDENCIES: AssetUploadActorContextDependencies = {
  resolveMerchantSession: resolveMerchantSessionFromRequest,
};

export async function resolveAssetUploadActorContext(
  request: Request,
  supabase: PlatformMerchantSnapshotStoreClient,
  merchantHint: string,
  dependencies: AssetUploadActorContextDependencies = DEFAULT_ACTOR_CONTEXT_DEPENDENCIES,
): Promise<ActorContext> {
  if (await isSuperAdminRequestAuthorized(request)) {
    return {
      ok: true,
      effectiveMerchantHint: merchantHint || "platform",
      permissionConfig: createDefaultMerchantPermissionConfig(),
    };
  }

  const hintedMerchantId = isMerchantNumericId(merchantHint) ? merchantHint : "";
  const resolvedSession = await dependencies.resolveMerchantSession(
    request,
    hintedMerchantId ? { hintedMerchantId } : undefined,
  );
  if (resolvedSession?.merchantId && hintedMerchantId && resolvedSession.merchantId !== hintedMerchantId) {
    return { ok: false };
  }
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

  const snapshotPayload = await loadStoredPlatformMerchantSnapshot(supabase, { includeHistory: false }).catch(() => null);
  const snapshotSite = snapshotPayload?.snapshot.find((site) => site.id === resolvedSession.merchantId) ?? null;
  return {
    ok: true,
    effectiveMerchantHint: sanitizeMerchantHint(resolvedSession.merchantId),
    permissionConfig: snapshotSite?.permissionConfig ?? createDefaultMerchantPermissionConfig(),
  };
}

export type AssetUploadBusinessAuthorizationDependencies = {
  authorizeBusinessRequest: typeof authorizeMerchantBusinessRequest;
  reauthorizeBusinessMutation: typeof reauthorizeMerchantBusinessMutation;
  resolveLegacyActor: typeof resolveAssetUploadActorContext;
};

const DEFAULT_BUSINESS_AUTHORIZATION_DEPENDENCIES: AssetUploadBusinessAuthorizationDependencies = {
  authorizeBusinessRequest: authorizeMerchantBusinessRequest,
  reauthorizeBusinessMutation: reauthorizeMerchantBusinessMutation,
  resolveLegacyActor: resolveAssetUploadActorContext,
};

const ASSET_UPLOAD_BUSINESS_PERMISSIONS: Record<
  AssetUploadBusinessPurpose,
  MerchantStaffBusinessPermission
> = {
  "order-catalog": "orders.catalog.manage",
  "redemption-catalog": "redemptions.catalog.manage",
};

function normalizeAssetUploadBusinessPurpose(value: unknown): AssetUploadBusinessPurpose | null {
  const purpose = typeof value === "string" ? value.trim().toLowerCase() : "";
  return purpose === "order-catalog" || purpose === "redemption-catalog"
    ? purpose
    : null;
}

export async function resolveAssetUploadRequestActorContext(
  request: Request,
  supabase: PlatformMerchantSnapshotStoreClient,
  input: {
    merchantHint: string;
    rawMerchantHint: string;
    siteId: string;
    folder: string;
    usage: unknown;
    businessPurpose: unknown;
    businessPurposeProvided: boolean;
  },
  dependencyOverrides: Partial<AssetUploadBusinessAuthorizationDependencies> = {},
): Promise<ActorContext> {
  const dependencies = {
    ...DEFAULT_BUSINESS_AUTHORIZATION_DEPENDENCIES,
    ...dependencyOverrides,
  };
  const explicitBusinessToken = request.headers.has("x-merchant-access-token");
  const businessRequest = explicitBusinessToken || input.businessPurposeProvided;
  if (!businessRequest) {
    return dependencies.resolveLegacyActor(request, supabase, input.merchantHint);
  }

  const purpose = normalizeAssetUploadBusinessPurpose(input.businessPurpose);
  if (!purpose) {
    return { ok: false, status: 400, code: "invalid_business_purpose" };
  }
  const siteId = input.siteId.trim();
  const rawMerchantHint = input.rawMerchantHint.trim();
  if (
    !isMerchantNumericId(siteId) ||
    (rawMerchantHint.length > 0 && rawMerchantHint !== siteId)
  ) {
    return { ok: false, status: 400, code: "invalid_business_site_id" };
  }
  if (
    input.folder !== "merchant-assets" ||
    String(input.usage ?? "").trim().toLowerCase() !== "product-image"
  ) {
    return { ok: false, status: 400, code: "invalid_business_asset_scope" };
  }

  const requiredPermission = ASSET_UPLOAD_BUSINESS_PERMISSIONS[purpose];
  try {
    const actor = await dependencies.authorizeBusinessRequest(request, {
      siteId,
      requiredPermission,
    });
    return {
      ok: true,
      effectiveMerchantHint: siteId,
      permissionConfig: createDefaultMerchantPermissionConfig(),
      businessAuthorization: { actor, requiredPermission, purpose },
    };
  } catch (error) {
    const access = toMerchantBusinessAccessResponse(error);
    return {
      ok: false,
      status: access.status,
      code: String(access.body.error ?? "business_authorization_failed"),
    };
  }
}

export async function reauthorizeAssetUploadStorageWrite(
  request: Request,
  actor: Extract<ActorContext, { ok: true }>,
  dependencyOverrides: Partial<AssetUploadBusinessAuthorizationDependencies> = {},
) {
  if (!actor.businessAuthorization) return { ok: true as const };
  const dependencies = {
    ...DEFAULT_BUSINESS_AUTHORIZATION_DEPENDENCIES,
    ...dependencyOverrides,
  };
  try {
    await dependencies.reauthorizeBusinessMutation(request, {
      actor: actor.businessAuthorization.actor,
      requiredPermissions: [actor.businessAuthorization.requiredPermission],
    });
    return { ok: true as const };
  } catch (error) {
    const access = toMerchantBusinessAccessResponse(error);
    return {
      ok: false as const,
      status: access.status,
      code: String(access.body.error ?? "business_authorization_failed"),
    };
  }
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return withAssetUploadPrivateResponseHeaders(
      getTrustedMutationRequestErrorResponse(),
    );
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

  let body: AssetUploadRequestBody | null = null;
  let originalBlob: Blob | null = null;
  let meta: { mime: string; extension: string } | null = null;
  let folder = "";
  let merchantHint = "public";
  let rawMerchantHint = "";
  let businessSiteId = "";
  let usageInput: unknown = undefined;
  let businessPurposeInput: unknown = undefined;
  let businessPurposeProvided = false;
  let sourceAssetUrl = "";
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.toLowerCase().includes("multipart/form-data")) {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        {
          ok: false,
          code: "invalid_form_data",
          message: "上传文件解析失败，请确认文件没有超过上传上限后重新选择上传。",
        },
        { status: 400 },
      );
    }
    const filePart = formData.get("file");
    if (!(filePart instanceof Blob) || filePart.size <= 0) {
      return NextResponse.json(
        {
          ok: false,
          code: "invalid_payload",
          message: "A supported upload payload is required.",
        },
        { status: 400 },
      );
    }
    const fileName = String((filePart as { name?: unknown }).name ?? "");
    originalBlob = filePart;
    meta = parseBlobUploadMeta(filePart, fileName);
    folder = String(formData.get("folder") ?? "").trim();
    rawMerchantHint = String(formData.get("merchantHint") ?? "").trim();
    merchantHint = sanitizeMerchantHint(rawMerchantHint || "public");
    businessSiteId = String(formData.get("siteId") ?? "").trim();
    usageInput = formData.get("usage");
    businessPurposeProvided = formData.has("businessPurpose");
    businessPurposeInput = formData.get("businessPurpose");
  } else {
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
    meta = parseDataUrlMeta(dataUrl);
    if (meta) {
      originalBlob = dataUrlToBlob(dataUrl, meta.mime);
    } else {
      sourceAssetUrl = String(body.sourceUrl ?? "").trim();
    }
    folder = String(body.folder ?? "").trim();
    rawMerchantHint = String(body.merchantHint ?? "").trim();
    merchantHint = sanitizeMerchantHint(rawMerchantHint || "public");
    businessSiteId = String(body.siteId ?? "").trim();
    usageInput = body.usage;
    businessPurposeProvided = Object.prototype.hasOwnProperty.call(body, "businessPurpose");
    businessPurposeInput = body.businessPurpose;
  }

  if ((!originalBlob && !sourceAssetUrl) || !FOLDER_CANDIDATES.has(folder)) {
    return NextResponse.json(
      {
        ok: false,
        code: "invalid_payload",
        message: "A supported upload payload is required.",
      },
      { status: 400 },
    );
  }

  if (!meta && !sourceAssetUrl) {
    return NextResponse.json(
      {
        ok: false,
        code: "unsupported_asset",
        message: "Only supported image, audio, video, and common document data URLs can be uploaded.",
      },
      { status: 400 },
    );
  }

  if (sourceAssetUrl && String(usageInput ?? "").trim().toLowerCase() !== "product-image") {
    return NextResponse.json(
      {
        ok: false,
        code: "unsupported_source_usage",
        message: "Source image thumbnail generation is only available for product images.",
      },
      { status: 400 },
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const actor = await resolveAssetUploadRequestActorContext(
    request,
    supabase as unknown as PlatformMerchantSnapshotStoreClient,
    {
      merchantHint,
      rawMerchantHint,
      siteId: businessSiteId,
      folder,
      usage: usageInput,
      businessPurpose: businessPurposeInput,
      businessPurposeProvided,
    },
  );
  if (!actor.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: actor.code ?? "unauthorized",
        message: "Unauthorized asset upload request.",
      },
      { status: actor.status ?? 401 },
    );
  }
  const employeeBusinessRequest = Boolean(actor.businessAuthorization);

  if (!meta && sourceAssetUrl) {
    try {
      const source = await fetchPublicStorageImageSource({
        sourceUrl: sourceAssetUrl,
        requestUrl: request.url,
        maxBytes: 8 * 1024 * 1024,
      });
      originalBlob = source.blob;
      meta = source.meta;
      sourceAssetUrl = source.sourceUrl;
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          code: error instanceof Error ? error.message : "unsupported_source_url",
          message: "Source image cannot be used for thumbnail generation.",
        },
        { status: 400 },
      );
    }
  }

  if (!originalBlob || !meta) {
    return NextResponse.json(
      {
        ok: false,
        code: "unsupported_asset",
        message: "Only supported image, audio, video, and common document data URLs can be uploaded.",
      },
      { status: 400 },
    );
  }

  const usage = normalizeAssetUsage(usageInput, folder, meta.mime);
  if (usage === "page-background" && actor.permissionConfig.allowInsertBackground === false) {
    return NextResponse.json(
      {
        ok: false,
        code: "page_background_not_allowed",
        message: "The current account cannot upload page backgrounds.",
      },
      { status: 403 },
    );
  }
  if (usage === "business-card-intro-video" && actor.permissionConfig.allowBusinessCardIntroVideo === false) {
    return NextResponse.json(
      {
        ok: false,
        code: "business_card_intro_video_not_allowed",
        message: "当前账号未开启联系卡开场视频权限。",
      },
      { status: 403 },
    );
  }
  if (usage === "business-card-intro-image" && !meta.mime.startsWith("image/")) {
    return NextResponse.json(
      {
        ok: false,
        code: "unsupported_intro_image",
        message: "联系卡开场图片必须是受支持的图片文件。",
      },
      { status: 400 },
    );
  }
  if (
    (usage === "business-card-intro-audio" || usage === "business-card-background-audio") &&
    !meta.mime.startsWith("audio/")
  ) {
    return NextResponse.json(
      {
        ok: false,
        code: "unsupported_business_card_audio",
        message: "联系卡音乐必须是受支持的音频文件。",
      },
      { status: 400 },
    );
  }
  const limitBytes = getAssetUploadLimitBytes({
    usage,
    permissionConfig: actor.permissionConfig,
  });
  const originalLimitBytes = usage === "business-card-intro-video" ? BUSINESS_CARD_INTRO_VIDEO_SOURCE_LIMIT_BYTES : limitBytes;
  if (originalBlob.size > originalLimitBytes) {
    return NextResponse.json(
      {
        ok: false,
        code: "asset_size_limit_exceeded",
        message: `Asset exceeds the allowed size limit (${Math.round(originalLimitBytes / 1024)}KB).`,
      },
      { status: 413 },
    );
  }

  if (usage === "business-card-intro-audio" || usage === "business-card-background-audio") {
    const maxDurationSeconds = usage === "business-card-intro-audio" ? 15 : 5 * 60;
    try {
      const durationSeconds = await probeMediaDurationSeconds(originalBlob, meta.extension);
      if (durationSeconds > maxDurationSeconds + 0.05) {
        return NextResponse.json(
          {
            ok: false,
            code: "business_card_audio_duration_exceeded",
            message:
              usage === "business-card-intro-audio"
                ? "开场音乐最长为 15 秒，请缩短后重新上传。"
                : "背景音乐最长为 5 分钟，请缩短后重新上传。",
          },
          { status: 413 },
        );
      }
    } catch (error) {
      console.error("[asset-upload] business card audio duration probe failed", error);
      return NextResponse.json(
        {
          ok: false,
          code: "business_card_audio_duration_unavailable",
          message: "无法读取音频时长，请更换 MP3、M4A、AAC、WAV 或 OGG 文件后重试。",
        },
        { status: 422 },
      );
    }
  }

  let uploadBlob = originalBlob;
  let uploadMime = meta.mime;
  let uploadExtension = meta.extension;
  let introVideoPosterBlob: Blob | null = null;
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
        targetBytes: limitBytes,
      });
      uploadMime = "video/mp4";
      uploadExtension = "mp4";
      introVideoPosterBlob = await extractBusinessCardIntroVideoPoster({
        blob: uploadBlob,
        extension: uploadExtension,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "";
      console.error("[asset-upload] intro video transcode failed", errorMessage);
      const message =
        errorMessage === "ffmpeg_timeout"
          ? "视频转码超时，请换用更短的视频后再上传。"
          : errorMessage === "ffmpeg_unavailable" || isFfmpegBinaryUnavailable(error)
            ? "服务器视频转码组件不可用，请稍后再试。"
            : "视频无法转成安卓和网页稳定播放的 MP4/H.264 格式，请换用更短的视频后再上传。";
      return NextResponse.json(
        {
          ok: false,
          code: "intro_video_transcode_failed",
          message,
        },
        { status: 422 },
      );
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

  let imageThumbnailBlob: Blob | null = null;
  if (
    usage === "product-image" &&
    (uploadMime === "image/jpeg" || uploadMime === "image/png" || uploadMime === "image/webp")
  ) {
    try {
      imageThumbnailBlob = await createImageThumbnail({
        blob: uploadBlob,
        extension: uploadExtension,
      });
    } catch (error) {
      console.warn("[asset-upload] image thumbnail generation failed", error instanceof Error ? error.message : error);
    }
  }
  const productImageProcessingError = resolveProductImageUploadProcessingError({
    usage,
    mime: uploadMime,
    thumbnailReady: Boolean(imageThumbnailBlob),
  });
  if (productImageProcessingError) {
    return NextResponse.json(
      {
        ok: false,
        code: productImageProcessingError.code,
        message: productImageProcessingError.message,
      },
      { status: productImageProcessingError.status },
    );
  }

  const now = new Date();
  const yyyy = `${now.getFullYear()}`;
  const mm = `${now.getMonth() + 1}`.padStart(2, "0");
  const uploadErrors: string[] = [];
  const authorizeStorageWrite = async () => {
    const authorization = await reauthorizeAssetUploadStorageWrite(request, actor);
    if (authorization.ok) return null;
    return NextResponse.json(
      {
        ok: false,
        code: authorization.code,
        message: "Asset upload authorization is no longer current.",
      },
      { status: authorization.status },
    );
  };

  if (sourceAssetUrl) {
    if (!imageThumbnailBlob) {
      return NextResponse.json(
        {
          ok: false,
          code: "thumbnail_generation_failed",
          message: "Source image thumbnail could not be generated.",
        },
        { status: 422 },
      );
    }

    for (const bucket of BUCKET_CANDIDATES) {
      const objectBasePath = `${folder}/${actor.effectiveMerchantHint}/${yyyy}/${mm}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const thumbnailObjectPath = `${objectBasePath}-thumb.webp`;
      const authorizationError = await authorizeStorageWrite();
      if (authorizationError) return authorizationError;
      const uploadedThumbnail = await supabase.storage.from(bucket).upload(thumbnailObjectPath, imageThumbnailBlob, {
        contentType: "image/webp",
        upsert: false,
      });
      if (uploadedThumbnail.error) {
        uploadErrors.push(`${bucket}: thumbnail ${uploadedThumbnail.error.message}`);
        continue;
      }
      const { data: thumbnailData } = supabase.storage.from(bucket).getPublicUrl(thumbnailObjectPath);
      const thumbnailPublicUrl = thumbnailData?.publicUrl ? normalizeStoragePublicUrl(thumbnailData.publicUrl) : "";
      if (!thumbnailPublicUrl) {
        uploadErrors.push(`${bucket}: failed to resolve thumbnail public url`);
        await cleanupEmployeeBusinessAssetUploadObjects(
          supabase.storage,
          bucket,
          [thumbnailObjectPath],
          employeeBusinessRequest,
        );
        continue;
      }
      return NextResponse.json(buildAssetUploadSuccessBody({
        bucket,
        url: sourceAssetUrl,
        thumbnailUrl: thumbnailPublicUrl,
        thumbnailObjectPath,
      }, employeeBusinessRequest));
    }

    return NextResponse.json(
      {
        ok: false,
        code: "thumbnail_upload_failed",
        message: buildAssetUploadFailureMessage(
          uploadErrors,
          "Thumbnail upload failed.",
          employeeBusinessRequest,
        ),
      },
      { status: 409 },
    );
  }

  for (const bucket of BUCKET_CANDIDATES) {
    const objectBasePath = `${folder}/${actor.effectiveMerchantHint}/${yyyy}/${mm}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const objectPath = `${objectBasePath}.${uploadExtension}`;
    const authorizationError = await authorizeStorageWrite();
    if (authorizationError) return authorizationError;
    const uploaded = await supabase.storage.from(bucket).upload(objectPath, uploadBlob, {
      contentType: uploadMime,
      upsert: false,
    });
    if (uploaded.error) {
      uploadErrors.push(`${bucket}: ${uploaded.error.message}`);
      continue;
    }
    const writtenObjectPaths = [objectPath];
    let posterObjectPath = "";
    let posterPublicUrl = "";
    if (introVideoPosterBlob) {
      posterObjectPath = `${objectBasePath}-poster.jpg`;
      const posterAuthorizationError = await authorizeStorageWrite();
      if (posterAuthorizationError) {
        // This is compensating cleanup for a base object written while the
        // authorization was still current. It must run even after revocation.
        await supabase.storage.from(bucket).remove([objectPath]).catch(() => undefined);
        return posterAuthorizationError;
      }
      const uploadedPoster = await supabase.storage.from(bucket).upload(posterObjectPath, introVideoPosterBlob, {
        contentType: "image/jpeg",
        upsert: false,
      });
      if (uploadedPoster.error) {
        await supabase.storage.from(bucket).remove([objectPath]).catch(() => undefined);
        uploadErrors.push(`${bucket}: poster ${uploadedPoster.error.message}`);
        continue;
      }
      writtenObjectPaths.push(posterObjectPath);
      const { data: posterData } = supabase.storage.from(bucket).getPublicUrl(posterObjectPath);
      posterPublicUrl = posterData?.publicUrl ? normalizeStoragePublicUrl(posterData.publicUrl) : "";
      if (!posterPublicUrl) {
        await supabase.storage.from(bucket).remove([objectPath, posterObjectPath]).catch(() => undefined);
        uploadErrors.push(`${bucket}: failed to resolve poster public url`);
        continue;
      }
    }
    let thumbnailObjectPath = "";
    let thumbnailPublicUrl = "";
    if (imageThumbnailBlob) {
      thumbnailObjectPath = `${objectBasePath}-thumb.webp`;
      const thumbnailAuthorizationError = await authorizeStorageWrite();
      if (thumbnailAuthorizationError) {
        await supabase.storage
          .from(bucket)
          .remove([objectPath, posterObjectPath].filter(Boolean))
          .catch(() => undefined);
        return thumbnailAuthorizationError;
      }
      const uploadedThumbnail = await supabase.storage.from(bucket).upload(thumbnailObjectPath, imageThumbnailBlob, {
        contentType: "image/webp",
        upsert: false,
      });
      if (uploadedThumbnail.error) {
        console.warn("[asset-upload] image thumbnail upload failed", `${bucket}: ${uploadedThumbnail.error.message}`);
        if (employeeBusinessRequest) {
          await cleanupEmployeeBusinessAssetUploadObjects(
            supabase.storage,
            bucket,
            writtenObjectPaths,
            true,
          );
          uploadErrors.push(`${bucket}: thumbnail ${uploadedThumbnail.error.message}`);
          continue;
        }
        thumbnailObjectPath = "";
      } else {
        writtenObjectPaths.push(thumbnailObjectPath);
        const { data: thumbnailData } = supabase.storage.from(bucket).getPublicUrl(thumbnailObjectPath);
        thumbnailPublicUrl = thumbnailData?.publicUrl ? normalizeStoragePublicUrl(thumbnailData.publicUrl) : "";
        if (!thumbnailPublicUrl) {
          console.warn("[asset-upload] image thumbnail public url unavailable", `${bucket}: ${thumbnailObjectPath}`);
          if (employeeBusinessRequest) {
            await cleanupEmployeeBusinessAssetUploadObjects(
              supabase.storage,
              bucket,
              writtenObjectPaths,
              true,
            );
            uploadErrors.push(`${bucket}: failed to resolve thumbnail public url`);
            continue;
          }
          thumbnailObjectPath = "";
        }
      }
    }
    const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
    if (data?.publicUrl) {
      return NextResponse.json(buildAssetUploadSuccessBody({
        bucket,
        objectPath,
        url: normalizeStoragePublicUrl(data.publicUrl),
        ...(posterPublicUrl ? { posterUrl: posterPublicUrl, posterObjectPath } : {}),
        ...(thumbnailPublicUrl ? { thumbnailUrl: thumbnailPublicUrl, thumbnailObjectPath } : {}),
      }, employeeBusinessRequest));
    }
    uploadErrors.push(`${bucket}: failed to resolve public url`);
    await cleanupEmployeeBusinessAssetUploadObjects(
      supabase.storage,
      bucket,
      writtenObjectPaths,
      employeeBusinessRequest,
    );
  }

  return NextResponse.json(
    {
      ok: false,
      code: "asset_upload_failed",
      message: buildAssetUploadFailureMessage(
        uploadErrors,
        "Asset upload failed.",
        employeeBusinessRequest,
      ),
    },
    { status: 409 },
  );
}
