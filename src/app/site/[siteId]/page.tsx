import { headers } from "next/headers";
import ServiceMaintenancePage from "@/components/ServiceMaintenancePage";
import { isMobileViewportRequest } from "@/lib/deviceViewport";
import { fetchPublishedSitePayloadFromSupabase } from "@/lib/publishedSiteData";
import SitePageClient from "./SitePageClient";

type SitePageProps = {
  params: Promise<{
    siteId: string;
  }>;
};

export default async function SitePage({ params }: SitePageProps) {
  const { siteId } = await params;
  const initialIsMobileViewport = isMobileViewportRequest(await headers());
  const publishedSite = await fetchPublishedSitePayloadFromSupabase(siteId).catch(() => null);
  if (publishedSite?.serviceState?.maintenance) {
    return (
      <ServiceMaintenancePage
        title="站点维护中"
        merchantName={publishedSite.merchantName || publishedSite.serviceState.merchantName || siteId}
        reason={publishedSite.serviceState.reason}
      />
    );
  }

  return (
    <SitePageClient
      forcedSiteId={siteId}
      initialIsMobileViewport={initialIsMobileViewport}
      initialPublishedBlocks={publishedSite?.blocks}
      initialMerchantName={publishedSite?.merchantName}
    />
  );
}
