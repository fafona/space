import { createClient } from "@supabase/supabase-js";
import type { Block } from "@/data/homeBlocks";
import { isMerchantNumericId } from "@/lib/merchantIdentity";

export type PublishedPageRow = {
  blocks?: unknown;
  slug?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

type MerchantProfileRow = {
  name?: string | null;
};

export type PublishedSitePayload = {
  siteId: string;
  slug: string;
  merchantName: string;
  blocks: Block[];
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

export async function fetchPublishedSitePayloadFromSupabase(siteId: string): Promise<PublishedSitePayload | null> {
  const normalizedSiteId = String(siteId ?? "").trim();
  if (!isMerchantNumericId(normalizedSiteId)) return null;

  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY") || readEnv("NEXT_SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return null;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });

  const initialQuery = await supabase
    .from("pages")
    .select("blocks,slug,updated_at,created_at")
    .eq("merchant_id", normalizedSiteId)
    .limit(20);

  let data = initialQuery.data as PublishedPageRow[] | null;
  let error = initialQuery.error;

  if (error && isMissingPublishedSlugColumn(error.message)) {
    const fallbackQuery = await supabase
      .from("pages")
      .select("blocks,updated_at,created_at")
      .eq("merchant_id", normalizedSiteId)
      .limit(20);
    data = fallbackQuery.data as PublishedPageRow[] | null;
    error = fallbackQuery.error;
  }

  if (error) {
    throw error;
  }

  const chosen = pickPublishedPageRow((data ?? []) as PublishedPageRow[]);
  if (!chosen || !Array.isArray(chosen.blocks) || chosen.blocks.length === 0) {
    return null;
  }

  const { data: merchantProfile } = await supabase
    .from("merchants")
    .select("name")
    .eq("id", normalizedSiteId)
    .limit(1)
    .maybeSingle();
  const merchantName = String((merchantProfile as MerchantProfileRow | null)?.name ?? "").trim();

  return {
    siteId: normalizedSiteId,
    slug: String(chosen.slug ?? "").trim(),
    merchantName,
    blocks: chosen.blocks as Block[],
  };
}
