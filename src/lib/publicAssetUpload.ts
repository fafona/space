import { recoverBrowserSupabaseSession } from "@/lib/authSessionRecovery";
import { supabase } from "@/lib/supabase";

const FOLDER_CANDIDATES = new Set(["merchant-assets", "merchant-audio"]);

export type PublicAssetUploadUsage =
  | "common-block-image"
  | "gallery-block-image"
  | "business-card-background"
  | "business-card-contact"
  | "business-card-export"
  | "audio"
  | "generic-image";

function parseDataUrlMeta(dataUrl: string) {
  const matched = dataUrl.match(/^data:((?:image|audio)\/[a-zA-Z0-9.+-]+);base64,/i);
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

async function getAssetUploadAccessToken() {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const directToken = String(session?.access_token ?? "").trim();
    if (directToken) return directToken;
  } catch {
    // Fall through to cookie-backed server auth.
  }
  return "";
}

async function uploadDataUrlViaServerApi(
  dataUrl: string,
  merchantHint: string,
  folder: string,
  usage: PublicAssetUploadUsage,
): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const accessToken = await getAssetUploadAccessToken();
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }
      const response = await fetchWithTimeout(
        "/api/assets/upload",
        {
          method: "POST",
          headers,
          credentials: "same-origin",
          body: JSON.stringify({
            dataUrl,
            merchantHint,
            folder,
            usage,
          }),
        },
        attempt === 0 ? 15_000 : 20_000,
      );
      if (response.ok) {
        const payload = (await response.json().catch(() => null)) as { url?: unknown } | null;
        return typeof payload?.url === "string" && payload.url.trim() ? payload.url.trim() : null;
      }
      if (attempt === 0 && response.status === 401) {
        await recoverBrowserSupabaseSession(9000).catch(() => null);
        await delay(500);
        continue;
      }
    } catch {
      if (attempt === 0) {
        await recoverBrowserSupabaseSession(9000).catch(() => null);
        await delay(500);
        continue;
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
