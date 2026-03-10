import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPER_ADMIN_SESSION_COOKIE, SUPER_ADMIN_SESSION_VALUE } from "@/lib/superAdminSession";

const BUCKET_CANDIDATES = ["page-assets", "assets", "uploads", "public"] as const;
const FOLDER_CANDIDATES = new Set(["merchant-assets", "merchant-audio"]);

type AssetUploadRequestBody = {
  dataUrl?: string;
  merchantHint?: string;
  folder?: string;
};

function parseCookieValue(cookieHeader: string, key: string) {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${key}=`))
    ?.slice(key.length + 1) ?? "";
}

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
    if (mime === "audio/mpeg") return "mp3";
    if (mime === "audio/mp3") return "mp3";
    if (mime === "audio/wav") return "wav";
    if (mime === "audio/x-wav") return "wav";
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
  const bytes = Buffer.from(base64, "base64");
  return new Blob([bytes], { type: mime });
}

function sanitizeMerchantHint(input: string) {
  const normalized = (input ?? "").trim().replace(/[^a-zA-Z0-9_-]+/g, "-");
  return normalized || "public";
}

async function isAuthorized(request: Request, supabaseUrl: string, serviceRoleKey: string) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  if (parseCookieValue(cookieHeader, SUPER_ADMIN_SESSION_COOKIE) === SUPER_ADMIN_SESSION_VALUE) {
    return true;
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const accessToken = tokenMatch?.[1]?.trim() ?? "";
  if (!accessToken) return false;

  const authClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await authClient.auth.getUser(accessToken);
  return !error && !!data.user;
}

export async function POST(request: Request) {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const serviceRoleKey =
    (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim() ||
    (process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      {
        ok: false,
        code: "asset_upload_service_unavailable",
        message: "资源上传服务未配置。",
      },
      { status: 503 },
    );
  }

  if (!(await isAuthorized(request, supabaseUrl, serviceRoleKey))) {
    return NextResponse.json(
      {
        ok: false,
        code: "unauthorized",
        message: "当前会话无权上传资源。",
      },
      { status: 401 },
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
        message: "请求体不是有效 JSON。",
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
        message: "缺少有效的资源内容。",
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
        message: "仅支持图片或音频 data URL。",
      },
      { status: 400 },
    );
  }

  const blob = dataUrlToBlob(dataUrl, meta.mime);
  const merchantHint = sanitizeMerchantHint(String(body.merchantHint ?? "public"));
  const now = new Date();
  const yyyy = `${now.getFullYear()}`;
  const mm = `${now.getMonth() + 1}`.padStart(2, "0");
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const uploadErrors: string[] = [];

  for (const bucket of BUCKET_CANDIDATES) {
    const objectPath = `${folder}/${merchantHint}/${yyyy}/${mm}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${meta.extension}`;
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
        url: data.publicUrl,
      });
    }
    uploadErrors.push(`${bucket}: failed to resolve public url`);
  }

  return NextResponse.json(
    {
      ok: false,
      code: "asset_upload_failed",
      message: uploadErrors.join(" | ") || "资源上传失败",
    },
    { status: 409 },
  );
}
