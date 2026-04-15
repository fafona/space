import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  normalizePlatformMerchantConfigArchivePayload,
  type PlatformMerchantConfigArchivePayload,
} from "@/lib/platformMerchantConfigArchive";
import {
  loadStoredPlatformMerchantConfigArchive,
  type PlatformMerchantConfigArchiveStoreClient,
} from "@/lib/platformMerchantConfigArchiveStore";
import { isSuperAdminRequestAuthorized } from "@/lib/superAdminRequestAuth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type QueryBuilder = PromiseLike<{ data?: unknown; error: { message?: string } | null }> & {
  select: (columns: string) => QueryBuilder;
  is: (column: string, value: unknown) => QueryBuilder;
  eq: (column: string, value: unknown) => QueryBuilder;
  limit: (value: number) => QueryBuilder;
  maybeSingle: () => Promise<{ data?: unknown; error: { message?: string } | null }>;
};

type LooseSupabaseClient = {
  from: (table: string) => QueryBuilder;
};

function readEnv(name: string) {
  return String(process.env[name] ?? "").trim();
}

function createServerSupabaseClient() {
  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY") || readEnv("NEXT_SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }) as unknown as LooseSupabaseClient;
}

function clampLimit(value: string | null) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 40;
  return Math.min(parsed, 200);
}

function filterArchivePayloadBySiteId(
  payload: PlatformMerchantConfigArchivePayload,
  siteId: string,
  limit: number,
): PlatformMerchantConfigArchivePayload {
  const normalizedSiteId = siteId.trim();
  const audits = payload.audits.filter((entry) => entry.siteId === normalizedSiteId).slice(0, limit);
  const backups = payload.backups.filter((entry) => entry.siteId === normalizedSiteId).slice(0, limit);
  return normalizePlatformMerchantConfigArchivePayload({ audits, backups });
}

export async function GET(request: Request) {
  if (!isSuperAdminRequestAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: "platform_merchant_config_archive_env_missing" }, { status: 503 });
  }

  const url = new URL(request.url);
  const siteId = String(url.searchParams.get("siteId") ?? "").trim();
  const limit = clampLimit(url.searchParams.get("limit"));
  const payload = await loadStoredPlatformMerchantConfigArchive(
    supabase as unknown as PlatformMerchantConfigArchiveStoreClient,
  );
  const filteredPayload = siteId
    ? filterArchivePayloadBySiteId(payload, siteId, limit)
    : normalizePlatformMerchantConfigArchivePayload({
        audits: payload.audits.slice(0, limit),
        backups: payload.backups.slice(0, limit),
      });

  return NextResponse.json(
    {
      ok: true,
      payload: filteredPayload,
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
