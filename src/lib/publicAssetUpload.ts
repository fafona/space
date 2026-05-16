const FOLDER_CANDIDATES = new Set(["merchant-assets", "merchant-audio"]);

export class PublicAssetUploadError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, input?: { status?: number; code?: string }) {
    super(message);
    this.name = "PublicAssetUploadError";
    this.status = input?.status ?? 0;
    this.code = input?.code ?? "asset_upload_failed";
  }
}

export type PublicAssetUploadUsage =
  | "common-block-image"
  | "gallery-block-image"
  | "business-card-background"
  | "business-card-contact"
  | "business-card-export"
  | "business-card-intro-video"
  | "audio"
  | "generic-image";

function parseDataUrlMeta(dataUrl: string) {
  const matched = dataUrl.match(/^data:((?:image|audio|video)\/[a-zA-Z0-9.+-]+);base64,/i);
  if (!matched) return null;
  return { mime: matched[1].toLowerCase() };
}

function sanitizeMerchantHint(input: string) {
  const normalized = String(input ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-");
  return normalized || "public";
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, Math.max(500, timeoutMs));
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readUploadErrorMessage(response: Response) {
  const payload = (await response.json().catch(() => null)) as {
    code?: unknown;
    error?: unknown;
    message?: unknown;
  } | null;
  const message = String(payload?.message ?? payload?.error ?? "").trim();
  const code = String(payload?.code ?? payload?.error ?? "").trim();
  if (message) return { message, code };
  if (response.status === 413) return { message: "文件超过服务器允许的上传大小，请缩短视频后再上传。", code };
  if (response.status === 401) return { message: "登录状态失效，请刷新后台后重新上传。", code };
  if (response.status === 403) return { message: "上传请求被安全校验拦截，请刷新后台后重试。", code };
  if (response.status === 422) return { message: "视频无法转成网页可播放格式，请换用 MP4/H.264 视频。", code };
  return { message: `上传失败（${response.status}），请稍后重试。`, code };
}

async function uploadDataUrlViaServerApi(
  dataUrl: string,
  merchantHint: string,
  folder: string,
  usage: PublicAssetUploadUsage,
): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const timeoutMs =
        usage === "business-card-intro-video" ? (attempt === 0 ? 180_000 : 240_000) : attempt === 0 ? 15_000 : 20_000;
      const response = await fetchWithTimeout(
        "/api/assets/upload",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          credentials: "same-origin",
          body: JSON.stringify({
            dataUrl,
            merchantHint,
            folder,
            usage,
          }),
        },
        timeoutMs,
      );
      if (response.ok) {
        const payload = (await response.json().catch(() => null)) as { url?: unknown } | null;
        return typeof payload?.url === "string" && payload.url.trim() ? payload.url.trim() : null;
      }
      if (attempt === 0 && (response.status === 401 || response.status === 503)) {
        await delay(500);
        continue;
      }
      if (usage === "business-card-intro-video") {
        const detail = await readUploadErrorMessage(response);
        throw new PublicAssetUploadError(detail.message, {
          status: response.status,
          code: detail.code,
        });
      }
    } catch (error) {
      if (error instanceof PublicAssetUploadError) {
        throw error;
      }
      if (attempt === 0) {
        await delay(500);
        continue;
      }
      if (usage === "business-card-intro-video") {
        throw new PublicAssetUploadError("开场视频上传或转码超时，请换用更短的视频后再上传。");
      }
      return null;
    }
  }
  return null;
}

export async function uploadDataUrlToPublicStorage(
  dataUrl: string,
  options?: {
    merchantHint?: string;
    folder?: "merchant-assets" | "merchant-audio";
    usage?: PublicAssetUploadUsage;
  },
): Promise<string | null> {
  const meta = parseDataUrlMeta(dataUrl);
  const folder = String(options?.folder ?? "merchant-assets").trim();
  if (!meta || !FOLDER_CANDIDATES.has(folder)) return null;

  const merchantHint = sanitizeMerchantHint(options?.merchantHint ?? "public");
  const usage =
    options?.usage ??
    (folder === "merchant-audio" || meta.mime.startsWith("audio/") ? "audio" : "generic-image");
  return uploadDataUrlViaServerApi(dataUrl, merchantHint, folder, usage);
}

export async function uploadImageDataUrlToPublicStorage(
  dataUrl: string,
  merchantHint = "public",
  usage: PublicAssetUploadUsage = "generic-image",
) {
  return uploadDataUrlToPublicStorage(dataUrl, {
    merchantHint,
    folder: "merchant-assets",
    usage,
  });
}
