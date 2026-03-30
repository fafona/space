import { headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import SitePageClient from "@/app/site/[siteId]/SitePageClient";
import { isMobileViewportRequest } from "@/lib/deviceViewport";
import { isMerchantNumericId, normalizeDomainPrefix } from "@/lib/merchantIdentity";
import { fetchPublishedSitePayloadFromSupabase } from "@/lib/publishedSiteData";

type MerchantEntryPageProps = {
  params: Promise<{
    merchantEntry: string;
  }>;
};

type QueryErrorLike = { message?: string } | null;
type QueryResult<T> = { data: T | null; error: QueryErrorLike };
type LooseQueryBuilder<T> = {
  select: (columns: string) => QueryBuilder<T>;
  eq: (column: string, value: unknown) => QueryBuilder<T>;
  limit: (value: number) => QueryBuilder<T>;
};
type QueryBuilder<T> = LooseQueryBuilder<T> & {
  then: Promise<QueryResult<T[]>>["then"];
};
type LooseSupabaseClient = {
  from: (table: string) => LooseQueryBuilder<{ merchant_id?: string | null; slug?: string | null; updated_at?: string | null; created_at?: string | null }>;
};

function readEnv(key: string) {
  return String(process.env[key] ?? "").trim();
}

function createServerSupabaseClient() {
  const url = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey =
    readEnv("SUPABASE_SERVICE_ROLE_KEY") ||
    readEnv("NEXT_SUPABASE_SERVICE_ROLE_KEY") ||
    readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
}

function toTimestamp(value: string | null | undefined) {
  const time = new Date(String(value ?? "")).getTime();
  return Number.isFinite(time) ? time : 0;
}

function choosePreferredResolvedRow(
  current: { merchant_id?: string | null; updated_at?: string | null; created_at?: string | null } | null,
  candidate: { merchant_id?: string | null; updated_at?: string | null; created_at?: string | null },
) {
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

async function resolveInitialSiteIdByPrefix(prefix: string) {
  const normalizedPrefix = normalizeDomainPrefix(prefix);
  if (!normalizedPrefix) return "";

  const supabase = createServerSupabaseClient() as unknown as LooseSupabaseClient | null;
  if (!supabase) return "";

  try {
    const queryResult = (await supabase
      .from("pages")
      .select("merchant_id,slug,updated_at,created_at")
      .eq("slug", normalizedPrefix)
      .limit(20)) as unknown as QueryResult<
      {
        merchant_id?: string | null;
        slug?: string | null;
        updated_at?: string | null;
        created_at?: string | null;
      }[]
    >;

    if (queryResult.error) return "";

    const chosen = (queryResult.data ?? [])
      .filter((row) => String(row?.merchant_id ?? "").trim().length > 0)
      .reduce<{
        merchant_id?: string | null;
        updated_at?: string | null;
        created_at?: string | null;
      } | null>((best, row) => choosePreferredResolvedRow(best, row), null);

    const siteId = String(chosen?.merchant_id ?? "").trim();
    return isMerchantNumericId(siteId) ? siteId : "";
  } catch {
    return "";
  }
}

export default async function MerchantEntryPage({ params }: MerchantEntryPageProps) {
  const { merchantEntry } = await params;
  const initialIsMobileViewport = isMobileViewportRequest(await headers());
  if (isMerchantNumericId(merchantEntry)) {
    const { default: MerchantNumericEntryPageClient } = await import("./MerchantNumericEntryPageClient");
    return <MerchantNumericEntryPageClient />;
  }

  const initialResolvedSiteId = await resolveInitialSiteIdByPrefix(merchantEntry);
  if (initialResolvedSiteId) {
    const publishedSite = await fetchPublishedSitePayloadFromSupabase(initialResolvedSiteId).catch(() => null);
    if (publishedSite?.blocks?.length) {
      return (
        <SitePageClient
          forcedSiteId={initialResolvedSiteId}
          initialIsMobileViewport={initialIsMobileViewport}
          initialPublishedBlocks={publishedSite.blocks}
          initialMerchantName={publishedSite.merchantName}
        />
      );
    }
  }

  const { default: MerchantEntryPageClient } = await import("./MerchantEntryPageClient");
  return (
    <MerchantEntryPageClient
      initialIsMobileViewport={initialIsMobileViewport}
      initialResolvedSiteId={initialResolvedSiteId}
    />
  );
}
