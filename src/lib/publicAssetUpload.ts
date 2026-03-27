import { recoverBrowserSupabaseSession } from "@/lib/authSessionRecovery";
import { supabase } from "@/lib/supabase";

const BUCKET_CANDIDATES = ["page-assets", "assets", "uploads", "public"] as const;
const FOLDER_CANDIDATES = new Set(["merchant-assets", "merchant-audio"]);

function parseDataUrlMeta(dataUrl: string) {
  const matched = dataUrl.match(/^data:((?:image|audio)\/[a-zA-Z0-9.+-]+);base64,/i);
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
    return "bin";
  })();
  return { mime, extension };
}

function dataUrlToBlob(dataUrl: string, mime: string) {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime });
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

async function getAssetUploadAccessToken(timeoutMs = 4500) {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const directToken = String(session?.access_token ?? "").trim();
    if (directToken) return directToken;
  } catch {
    // Fall through to browser session recovery.
  }

  try {
    const recoveredSession = await recoverBrowserSupabaseSession(Math.max(2200, timeoutMs));
    return String(recoveredSession?.access_token ?? "").trim();
  } catch {
    return "";
  }
}

async function uploadDataUrlViaServerApi(dataUrl: string, merchantHint: string, folder: string): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const accessToken = await getAssetUploadAccessToken(attempt === 0 ? 4500 : 9000);
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }
      const response = await fetchWithTimeout("/api/assets/upload", {
        method: "POST",
        headers,
        credentials: "same-origin",
        body: JSON.stringify({
          dataUrl,
          merchantHint,
          folder,
        }),
      }, attempt === 0 ? 15_000 : 20_000);
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
  },
): Promise<string | null> {
  const meta = parseDataUrlMeta(dataUrl);
  const folder = String(options?.folder ?? "merchant-assets").trim();
  if (!meta || !FOLDER_CANDIDATES.has(folder)) return null;

  const merchantHint = sanitizeMerchantHint(options?.merchantHint ?? "public");
  const uploadedViaServer = await uploadDataUrlViaServerApi(dataUrl, merchantHint, folder);
  if (uploadedViaServer) return uploadedViaServer;

  const blob = dataUrlToBlob(dataUrl, meta.mime);
  const now = new Date();
  const yyyy = `${now.getFullYear()}`;
  const mm = `${now.getMonth() + 1}`.padStart(2, "0");

  for (const bucket of BUCKET_CANDIDATES) {
    const objectPath = `${folder}/${merchantHint}/${yyyy}/${mm}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${meta.extension}`;
    const uploaded = await supabase.storage.from(bucket).upload(objectPath, blob, {
      contentType: meta.mime,
      upsert: false,
    });
    if (uploaded.error) continue;
    const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
    if (data?.publicUrl) return data.publicUrl;
  }

  return null;
}

export async function uploadImageDataUrlToPublicStorage(dataUrl: string, merchantHint = "public") {
  return uploadDataUrlToPublicStorage(dataUrl, {
    merchantHint,
    folder: "merchant-assets",
  });
}
