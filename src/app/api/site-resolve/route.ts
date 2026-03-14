import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isMerchantNumericId, normalizeDomainPrefix } from "@/lib/merchantIdentity";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export type SiteResolveRow = {
  merchant_id?: string | null;
  slug?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const prefix = normalizeDomainPrefix(searchParams.get("prefix"));
  if (!prefix) {
    return NextResponse.json({ error: "invalid_prefix" }, { status: 400 });
  }

  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY") || readEnv("NEXT_SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "site_resolve_env_missing" }, { status: 503 });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const { data, error } = await supabase
      .from("pages")
      .select("merchant_id,slug,updated_at,created_at")
      .eq("slug", prefix)
      .limit(20);

    if (error) {
      return NextResponse.json(
        {
          error: "site_resolve_failed",
          message: error.message,
        },
        { status: 500 },
      );
    }

    const chosen = pickResolvedSiteRow((data ?? []) as SiteResolveRow[]);

    const siteId = String(chosen?.merchant_id ?? "").trim();
    if (!siteId) {
      return NextResponse.json({ error: "site_not_found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      prefix,
      siteId,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "site_resolve_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 500 },
    );
  }
}
