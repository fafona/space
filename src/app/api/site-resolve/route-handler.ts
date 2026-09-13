import { NextResponse } from "next/server";
import { isMerchantNumericId, normalizeDomainPrefix } from "@/lib/merchantIdentity";
import { createServerTiming } from "@/lib/serverTiming";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export type SiteResolveRow = {
  merchant_id?: string | null;
  slug?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

const SITE_RESOLVE_QUERY_TIMEOUT_MS = 1_200;
const SITE_RESOLVE_CACHE_TTL_MS = 60_000;
const SITE_RESOLVE_MISS_CACHE_TTL_MS = 5_000;
const SITE_RESOLVE_SUCCESS_CACHE_CONTROL = "public, max-age=15, s-maxage=60, stale-while-revalidate=120";
const SITE_RESOLVE_MISS_CACHE_CONTROL = "public, max-age=5, s-maxage=5";

type SiteResolveCacheEntry = {
  expiresAt: number;
  pending?: Promise<string>;
  siteId?: string;
};

const siteResolveCache = new Map<string, SiteResolveCacheEntry>();

function readEnv(name: string) {
  return (process.env[name] ?? "").trim();
}

function toTimestamp(value: string | null | undefined) {
  const time = new Date(String(value ?? "")).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function choosePreferredSiteResolveRow(current: SiteResolveRow | null, candidate: SiteResolveRow) {
  if (!current) return candidate;
  const currentMerchantId = String(current.merchant_id ?? "").trim();
  const candidateMerchantId = String(candidate.merchant_id ?? "").trim();
  const currentNumeric = isMerchantNumericId(currentMerchantId);
  const candidateNumeric = isMerchantNumericId(candidateMerchantId);
  if (candidateNumeric && !currentNumeric) return candidate;
  if (currentNumeric && !candidateNumeric) return current;

  const currentUpdatedAt = Math.max(toTimestamp(current.updated_at), toTimestamp(current.created_at));
  const candidateUpdatedAt = Math.max(toTimestamp(candidate.updated_at), toTimestamp(candidate.created_at));
  return candidateUpdatedAt >= currentUpdatedAt ? candidate : current;
}

export function pickResolvedSiteRow(rows: SiteResolveRow[]) {
  return rows
    .filter((item) => String(item.merchant_id ?? "").trim().length > 0)
    .reduce<SiteResolveRow | null>((best, item) => choosePreferredSiteResolveRow(best, item), null);
}

export function __clearSiteResolveCacheForTests() {
  siteResolveCache.clear();
}

function readCachedSiteResolve(prefix: string) {
  const cached = siteResolveCache.get(prefix);
  if (!cached || cached.expiresAt <= Date.now()) {
    if (cached) siteResolveCache.delete(prefix);
    return null;
  }
  return cached;
}

function writeSiteResolveCache(prefix: string, siteId: string) {
  siteResolveCache.set(prefix, {
    expiresAt: Date.now() + (siteId ? SITE_RESOLVE_CACHE_TTL_MS : SITE_RESOLVE_MISS_CACHE_TTL_MS),
    siteId,
  });
}

async function resolveSiteIdFromSupabase(prefix: string, supabaseUrl: string, serviceRoleKey: string) {
  const cached = readCachedSiteResolve(prefix);
  if (cached?.pending) return cached.pending;
  if (cached?.siteId !== undefined) return cached.siteId;

  const pending = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SITE_RESOLVE_QUERY_TIMEOUT_MS);
    const query = new URLSearchParams({
      select: "merchant_id,slug,updated_at,created_at",
      slug: `eq.${prefix}`,
      limit: "20",
    });
    try {
      const response = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/rest/v1/pages?${query.toString()}`, {
        method: "GET",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          Accept: "application/json",
        },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) return "";

      const rows = (await response.json().catch(() => null)) as SiteResolveRow[] | null;
      const chosen = pickResolvedSiteRow(Array.isArray(rows) ? rows : []);
      const siteId = String(chosen?.merchant_id ?? "").trim();
      return isMerchantNumericId(siteId) ? siteId : "";
    } catch {
      return "";
    } finally {
      clearTimeout(timeout);
    }
  })();

  siteResolveCache.set(prefix, {
    expiresAt: Date.now() + SITE_RESOLVE_QUERY_TIMEOUT_MS,
    pending,
  });
  const siteId = await pending;
  writeSiteResolveCache(prefix, siteId);
  return siteId;
}

export async function GET(request: Request) {
  const timing = createServerTiming();
  const withTiming = (response: NextResponse) => {
    timing.apply(response.headers);
    return response;
  };
  const { searchParams } = new URL(request.url);
  const prefix = normalizeDomainPrefix(searchParams.get("prefix"));
  if (!prefix) {
    return withTiming(NextResponse.json({ error: "invalid_prefix" }, { status: 400 }));
  }

  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY") || readEnv("NEXT_SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return withTiming(NextResponse.json({ error: "site_resolve_env_missing" }, { status: 503 }));
  }

  try {
    const siteId = await timing.time("resolve", () => resolveSiteIdFromSupabase(prefix, supabaseUrl, serviceRoleKey));
    if (!siteId) {
      return withTiming(NextResponse.json(
        { error: "site_not_found" },
        {
          status: 404,
          headers: {
            "cache-control": SITE_RESOLVE_MISS_CACHE_CONTROL,
          },
        },
      ));
    }

    return withTiming(NextResponse.json(
      {
        ok: true,
        prefix,
        siteId,
      },
      {
        headers: {
          "cache-control": SITE_RESOLVE_SUCCESS_CACHE_CONTROL,
        },
      },
    ));
  } catch (error) {
    return withTiming(NextResponse.json(
      {
        error: "site_resolve_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 500 },
    ));
  }
}
