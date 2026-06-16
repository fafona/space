import type { Metadata } from "next";
import { headers } from "next/headers";
import { cache } from "react";
import ServiceMaintenancePage from "@/components/ServiceMaintenancePage";
import { isMobileViewportRequest } from "@/lib/deviceViewport";
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
import SitePageClient from "./SitePageClient";

type SitePageProps = {
  params: Promise<{
    siteId: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const fetchPublishedSitePayloadForRequest = cache((siteId: string) =>
  fetchPublishedSitePayloadFromSupabase(siteId),
);
const SITE_METADATA_PAYLOAD_TIMEOUT_MS = 1_200;
const SITE_PAGE_PAYLOAD_TIMEOUT_MS = 2_200;

type PublishedSitePayloadResult = Awaited<ReturnType<typeof fetchPublishedSitePayloadFromSupabase>>;

async function withPublishedSitePayloadTimeout(
  promise: Promise<PublishedSitePayloadResult | null>,
  timeoutMs: number,
) {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<PublishedSitePayloadResult | null>((resolve) => {
        timeout = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function fetchPublishedSitePayloadForRequestFast(siteId: string, timeoutMs: number) {
  return withPublishedSitePayloadTimeout(fetchPublishedSitePayloadForRequest(siteId).catch(() => null), timeoutMs);
}

function readPublicOrigin() {
  const configured = String(process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN ?? "").trim();
  if (!configured) return "https://www.faolla.com";
  try {
    return new URL(/^https?:\/\//i.test(configured) ? configured : `https://${configured}`).origin;
  } catch {
    return "https://www.faolla.com";
  }
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

function readSearchParamValue(searchParams: Record<string, string | string[] | undefined> | undefined, key: string) {
  const value = searchParams?.[key];
  return Array.isArray(value) ? value[0] : value;
}

function isContactCardFastEntry(searchParams: Record<string, string | string[] | undefined> | undefined) {
  return String(readSearchParamValue(searchParams, "entry") ?? "").trim().toLowerCase() === "card";
}

export async function generateMetadata({ params, searchParams }: SitePageProps): Promise<Metadata> {
  const { siteId } = await params;
  const resolvedSearchParams = await searchParams;
  if (isContactCardFastEntry(resolvedSearchParams)) return {};
  const publishedSite = await fetchPublishedSitePayloadForRequestFast(siteId, SITE_METADATA_PAYLOAD_TIMEOUT_MS);
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

export default async function SitePage({ params, searchParams }: SitePageProps) {
  const { siteId } = await params;
  const resolvedSearchParams = await searchParams;
  const initialIsMobileViewport = isMobileViewportRequest(await headers());
  if (isContactCardFastEntry(resolvedSearchParams)) {
    return <SitePageClient forcedSiteId={siteId} initialIsMobileViewport={initialIsMobileViewport} />;
  }
  const publishedSite = await fetchPublishedSitePayloadForRequestFast(siteId, SITE_PAGE_PAYLOAD_TIMEOUT_MS);
  if (publishedSite?.serviceState?.maintenance) {
    return (
      <ServiceMaintenancePage
        title="站点维护中"
        merchantName={publishedSite.merchantName || publishedSite.serviceState.merchantName || siteId}
        reason={publishedSite.serviceState.reason}
      />
    );
  }
  const profile = buildProfileForSeo(siteId, publishedSite);
  const jsonLd = publishedSite?.blocks?.length ? buildMerchantLocalBusinessJsonLd(profile, readPublicOrigin()) : null;

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
        forcedSiteId={siteId}
        initialIsMobileViewport={initialIsMobileViewport}
        initialPublishedBlocks={publishedSite?.blocks}
        initialMerchantName={publishedSite?.merchantName}
        initialOrderManagementEnabled={publishedSite?.orderManagementEnabled}
      />
    </>
  );
}
