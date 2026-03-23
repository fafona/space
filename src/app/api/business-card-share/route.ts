import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  buildMerchantBusinessCardShareManifestObjectPath,
  resolveMerchantBusinessCardShareOrigin,
  buildMerchantBusinessCardShareUrl,
  normalizeMerchantBusinessCardShareImageUrl,
  normalizeMerchantBusinessCardShareKey,
  normalizeMerchantBusinessCardShareTargetUrl,
} from "@/lib/merchantBusinessCardShare";
import { SUPER_ADMIN_SESSION_COOKIE, SUPER_ADMIN_SESSION_VALUE } from "@/lib/superAdminSession";

const BUCKET_CANDIDATES = ["page-assets", "assets", "uploads", "public"] as const;

type BusinessCardShareRequestBody = {
  key?: unknown;
  name?: unknown;
  imageUrl?: unknown;
  targetUrl?: unknown;
};

function parseCookieValue(cookieHeader: string, key: string) {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${key}=`))
    ?.slice(key.length + 1) ?? "";
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function createShareKey() {
  return `card-${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
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
  if (!shareKey || !imageUrl || !targetUrl || !shareOrigin) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  const payload = JSON.stringify({
    name,
    imageUrl,
    targetUrl,
  });
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
  const blob = new Blob([payload], { type: "application/json; charset=utf-8" });

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
