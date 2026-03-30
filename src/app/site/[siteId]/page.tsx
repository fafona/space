import { headers } from "next/headers";
import SitePageClient from "./SitePageClient";
import { isMobileViewportRequest } from "@/lib/deviceViewport";
import { fetchPublishedSitePayloadFromSupabase } from "@/lib/publishedSiteData";

type SitePageProps = {
  params: Promise<{
    siteId: string;
  }>;
};

export default async function SitePage({ params }: SitePageProps) {
  const { siteId } = await params;
  const initialIsMobileViewport = isMobileViewportRequest(await headers());
  const publishedSite = await fetchPublishedSitePayloadFromSupabase(siteId).catch(() => null);

  return (
    <SitePageClient
      forcedSiteId={siteId}
      initialIsMobileViewport={initialIsMobileViewport}
      initialPublishedBlocks={publishedSite?.blocks}
      initialMerchantName={publishedSite?.merchantName}
    />
  );
}
