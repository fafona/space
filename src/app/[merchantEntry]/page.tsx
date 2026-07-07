import { createClient } from "@supabase/supabase-js";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import ServiceMaintenancePage from "@/components/ServiceMaintenancePage";
import SitePageClient from "@/app/site/[siteId]/SitePageClient";
import { isMobileViewportRequest } from "@/lib/deviceViewport";
import { isMerchantNumericId, normalizeDomainPrefix } from "@/lib/merchantIdentity";
import {
  buildMerchantLocalBusinessJsonLd,
  buildMerchantSeoCanonicalUrl,
  buildMerchantSeoDescription,
  buildMerchantSeoTitle,
  isMerchantSeoIndexable,
  resolveMerchantSeoImageUrl,
  type MerchantSeoProfile,
} from "@/lib/merchantSeo";
import { fetchPublishedSitePayloadFromSupabase } from "@/lib/publishedSiteData";
import { buildFaollaShellHref } from "@/lib/faollaEntry";
import { DEFAULT_LOCALE, readRequestedLocaleFromSearch } from "@/lib/i18n";

type MerchantEntryPageProps = {
  params: Promise<{
    merchantEntry: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
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

const MERCHANT_ENTRY_PREFIX_TIMEOUT_MS = 1_500;
const MERCHANT_ENTRY_METADATA_PAYLOAD_TIMEOUT_MS = 800;
const MERCHANT_ENTRY_PAGE_PAYLOAD_TIMEOUT_MS = 4_000;

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PublishedSitePayloadResult = Awaited<ReturnType<typeof fetchPublishedSitePayloadFromSupabase>>;

function readEnv(key: string) {
  return String(process.env[key] ?? "").trim();
}

async function withMerchantEntryTimeout<T>(promise: Promise<T>, fallback: T, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function fetchPublishedSitePayloadFast(siteId: string, timeoutMs: number) {
  return withMerchantEntryTimeout<PublishedSitePayloadResult | null>(
    fetchPublishedSitePayloadFromSupabase(siteId).catch(() => null),
    null,
    timeoutMs,
  );
}

function readPublicOrigin() {
  const configured = readEnv("NEXT_PUBLIC_PORTAL_BASE_DOMAIN");
  if (!configured) return "https://www.faolla.com";
  try {
    return new URL(/^https?:\/\//i.test(configured) ? configured : `https://${configured}`).origin;
  } catch {
    return "https://www.faolla.com";
  }
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

function buildProfileForSeo(
  siteId: string,
  publishedSite: Awaited<ReturnType<typeof fetchPublishedSitePayloadFromSupabase>>,
): MerchantSeoProfile {
  return {
    id: siteId,
    ...(publishedSite?.merchantProfile ?? {}),
    merchantName: publishedSite?.merchantProfile?.merchantName || publishedSite?.merchantName || publishedSite?.serviceState?.merchantName,
    status: publishedSite?.serviceState?.status ?? publishedSite?.merchantProfile?.status,
    serviceExpiresAt: publishedSite?.serviceState?.serviceExpiresAt ?? publishedSite?.merchantProfile?.serviceExpiresAt,
  };
}

function escapeJsonForHtml(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

async function resolveInitialSiteIdByPrefixUncached(prefix: string) {
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

const resolveInitialSiteIdByPrefix = cache(resolveInitialSiteIdByPrefixUncached);

function resolveInitialSiteIdByPrefixFast(prefix: string) {
  return withMerchantEntryTimeout(resolveInitialSiteIdByPrefix(prefix).catch(() => ""), "", MERCHANT_ENTRY_PREFIX_TIMEOUT_MS);
}

export async function generateMetadata({ params }: MerchantEntryPageProps): Promise<Metadata> {
  const { merchantEntry } = await params;
  if (isMerchantNumericId(merchantEntry)) return {};
  const siteId = await resolveInitialSiteIdByPrefixFast(merchantEntry);
  if (!siteId) return {};
  const publishedSite = await fetchPublishedSitePayloadFast(siteId, MERCHANT_ENTRY_METADATA_PAYLOAD_TIMEOUT_MS);
  const profile = buildProfileForSeo(siteId, publishedSite);
  const publicOrigin = readPublicOrigin();
  const title = buildMerchantSeoTitle(profile);
  const description = buildMerchantSeoDescription(profile);
  const canonical = buildMerchantSeoCanonicalUrl(profile, publicOrigin);
  const image = resolveMerchantSeoImageUrl(profile, publicOrigin);
  const indexable = Boolean(publishedSite?.blocks?.length) && isMerchantSeoIndexable(profile);

  return {
    title,
    description,
    alternates: {
      canonical,
    },
    robots: {
      index: indexable,
      follow: true,
    },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: "Faolla",
      type: "website",
      images: image ? [{ url: image, alt: title }] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

function readSearchParamValue(searchParams: Record<string, string | string[] | undefined> | undefined, key: string) {
  const value = searchParams?.[key];
  return Array.isArray(value) ? value[0] : value;
}

function buildSearchString(searchParams: Record<string, string | string[] | undefined> | undefined) {
  const params = new URLSearchParams();
  Object.entries(searchParams ?? {}).forEach(([key, value]) => {
    if (typeof value === "string") {
      params.set(key, value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, item));
    }
  });
  const text = params.toString();
  return text ? `?${text}` : "";
}

function readRequestOrigin(headerList: Headers) {
  const host = headerList.get("x-forwarded-host") || headerList.get("host") || "faolla.com";
  const proto = headerList.get("x-forwarded-proto") || "https";
  return `${proto}://${host}`;
}

export default async function MerchantEntryPage({ params, searchParams }: MerchantEntryPageProps) {
  const { merchantEntry } = await params;
  const resolvedSearchParams = await searchParams;
  const requestHeaders = await headers();
  const initialIsMobileViewport = isMobileViewportRequest(requestHeaders);
  if (isMerchantNumericId(merchantEntry)) {
    if (String(readSearchParamValue(resolvedSearchParams, "section") ?? "").trim().toLowerCase() === "faolla") {
      const explicitEntryHref = String(readSearchParamValue(resolvedSearchParams, "faollaUrl") ?? "").trim();
      const initialSourceHref = explicitEntryHref || "/";
      const searchText = buildSearchString(resolvedSearchParams);
      const locale = readRequestedLocaleFromSearch(searchText) || DEFAULT_LOCALE;
      redirect(
        buildFaollaShellHref(initialSourceHref, locale, readRequestOrigin(requestHeaders), {
          preferRuntimeOrigin: true,
        }),
      );
    }
    const { default: MerchantNumericEntryPageClient } = await import("./MerchantNumericEntryPageClient");
    return <MerchantNumericEntryPageClient />;
  }

  const initialResolvedSiteId = await resolveInitialSiteIdByPrefixFast(merchantEntry);
  if (initialResolvedSiteId) {
    const publishedSite = await fetchPublishedSitePayloadFast(initialResolvedSiteId, MERCHANT_ENTRY_PAGE_PAYLOAD_TIMEOUT_MS);
    if (publishedSite?.blocks?.length) {
      if (publishedSite.serviceState?.maintenance) {
        return (
          <ServiceMaintenancePage
            title="站点维护中"
            merchantName={publishedSite.merchantName || publishedSite.serviceState.merchantName || initialResolvedSiteId}
            reason={publishedSite.serviceState.reason}
          />
        );
      }
      const profile = buildProfileForSeo(initialResolvedSiteId, publishedSite);
      const jsonLd = buildMerchantLocalBusinessJsonLd(profile, readPublicOrigin());
      return (
        <>
          {jsonLd ? (
            <script
              type="application/ld+json"
              dangerouslySetInnerHTML={{
                __html: escapeJsonForHtml(jsonLd),
              }}
            />
          ) : null}
          <SitePageClient
            forcedSiteId={initialResolvedSiteId}
            initialIsMobileViewport={initialIsMobileViewport}
            initialPublishedBlocks={publishedSite.blocks}
            initialMerchantName={publishedSite.merchantName}
            initialOrderManagementEnabled={publishedSite.orderManagementEnabled}
          />
        </>
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
