import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isMerchantNumericId } from "@/lib/merchantIdentity";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export type PublishedPageRow = {
  blocks?: unknown;
  slug?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

type MerchantProfileRow = {
  name?: string | null;
};

function readEnv(name: string) {
  return (process.env[name] ?? "").trim();
}

function toTimestamp(value: string | null | undefined) {
  const time = new Date(String(value ?? "")).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function isMissingPublishedSlugColumn(message: string) {
  return (
    /column\s+pages\.slug\s+does\s+not\s+exist/i.test(message) ||
    /could not find the ['"]slug['"] column of ['"]pages['"] in the schema cache/i.test(message)
  );
}

export function choosePreferredPublishedPageRow(current: PublishedPageRow | null, candidate: PublishedPageRow) {
  if (!current) return candidate;
  const currentUpdatedAt = Math.max(toTimestamp(current.updated_at), toTimestamp(current.created_at));
  const candidateUpdatedAt = Math.max(toTimestamp(candidate.updated_at), toTimestamp(candidate.created_at));
  return candidateUpdatedAt >= currentUpdatedAt ? candidate : current;
}

export function pickPublishedPageRow(rows: PublishedPageRow[]) {
  return rows
    .filter((item) => Array.isArray(item.blocks) && item.blocks.length > 0)
    .reduce<PublishedPageRow | null>((best, item) => choosePreferredPublishedPageRow(best, item), null);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const siteId = String(searchParams.get("siteId") ?? "").trim();
  if (!isMerchantNumericId(siteId)) {
    return NextResponse.json({ error: "invalid_site_id" }, { status: 400 });
  }

  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY") || readEnv("NEXT_SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "site_published_env_missing" }, { status: 503 });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const initialQuery = await supabase
      .from("pages")
      .select("blocks,slug,updated_at,created_at")
      .eq("merchant_id", siteId)
      .limit(20);

    let data = initialQuery.data as PublishedPageRow[] | null;
    let error = initialQuery.error;

    if (error && isMissingPublishedSlugColumn(error.message)) {
      const fallbackQuery = await supabase
        .from("pages")
        .select("blocks,updated_at,created_at")
        .eq("merchant_id", siteId)
        .limit(20);
      data = fallbackQuery.data as PublishedPageRow[] | null;
      error = fallbackQuery.error;
    }

    if (error) {
      return NextResponse.json(
        {
          error: "site_published_failed",
          message: error.message,
        },
        { status: 500 },
      );
    }

    const chosen = pickPublishedPageRow((data ?? []) as PublishedPageRow[]);

    if (!chosen || !Array.isArray(chosen.blocks) || chosen.blocks.length === 0) {
      return NextResponse.json({ error: "site_published_not_found" }, { status: 404 });
    }

    const { data: merchantProfile } = await supabase
      .from("merchants")
      .select("name")
      .eq("id", siteId)
      .limit(1)
      .maybeSingle();
    const merchantName = String((merchantProfile as MerchantProfileRow | null)?.name ?? "").trim();

    return NextResponse.json({
      ok: true,
      siteId,
      slug: String(chosen.slug ?? "").trim(),
      merchantName,
      blocks: chosen.blocks,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "site_published_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 500 },
    );
  }
}
