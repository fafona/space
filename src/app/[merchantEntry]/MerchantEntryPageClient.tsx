"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import LoadingProgressScreen from "@/components/LoadingProgressScreen";
import ServiceMaintenancePage from "@/components/ServiceMaintenancePage";
import SitePageClient from "@/app/site/[siteId]/SitePageClient";
import { loadPlatformState, subscribePlatformState } from "@/data/platformControlStore";
import { isMerchantNumericId, normalizeDomainPrefix } from "@/lib/merchantIdentity";
import { resolvePublishedSiteByPrefix } from "@/lib/publishedSiteLookup";
import { useHydrated } from "@/lib/useHydrated";

type MerchantEntryPageClientProps = {
  initialIsMobileViewport?: boolean;
  initialResolvedSiteId?: string;
};

export default function MerchantEntryPageClient({
  initialIsMobileViewport = false,
  initialResolvedSiteId = "",
}: MerchantEntryPageClientProps) {
  const params = useParams<{ merchantEntry: string }>();
  const merchantEntry = String(params?.merchantEntry ?? "").trim();
  const hydrated = useHydrated();
  const normalizedPrefix = useMemo(() => normalizeDomainPrefix(merchantEntry), [merchantEntry]);
  const [platformState, setPlatformState] = useState(() => loadPlatformState());
  const [remoteLookup, setRemoteLookup] = useState<{
    prefix: string;
    siteId: string;
    resolved: boolean;
  }>({
    prefix: normalizedPrefix,
    siteId: initialResolvedSiteId,
    resolved: !!initialResolvedSiteId,
  });

  useEffect(
    () =>
      subscribePlatformState(() => {
        setPlatformState(loadPlatformState());
      }),
    [],
  );

  useEffect(() => {
    if (!hydrated || !merchantEntry || isMerchantNumericId(merchantEntry)) return;
    if (initialResolvedSiteId) return;

    let mounted = true;
    const lookupPrefix = normalizedPrefix;

    void resolvePublishedSiteByPrefix(lookupPrefix).then((resolved) => {
      if (!mounted) return;
      setRemoteLookup({
        prefix: lookupPrefix,
        siteId: resolved?.siteId ?? "",
        resolved: true,
      });
    });

    return () => {
      mounted = false;
    };
  }, [hydrated, initialResolvedSiteId, merchantEntry, normalizedPrefix]);

  const resolvedSiteId = remoteLookup.prefix === normalizedPrefix ? remoteLookup.siteId : "";
  const remoteResolved =
    !merchantEntry || isMerchantNumericId(merchantEntry) || (remoteLookup.prefix === normalizedPrefix && remoteLookup.resolved);

  if (!hydrated) {
    return <LoadingProgressScreen message="正在加载站点..." />;
  }

  const byPrefix = merchantEntry
    ? [...platformState.sites]
        .filter((site) => site.id !== "site-main")
        .filter((site) => normalizeDomainPrefix(site.domainPrefix ?? site.domainSuffix) === normalizedPrefix)
        .sort((a, b) => {
          const aNumeric = isMerchantNumericId(a.id) ? 1 : 0;
          const bNumeric = isMerchantNumericId(b.id) ? 1 : 0;
          if (aNumeric !== bNumeric) return bNumeric - aNumeric;
          const aUpdated = new Date(a.updatedAt).getTime();
          const bUpdated = new Date(b.updatedAt).getTime();
          return (Number.isFinite(bUpdated) ? bUpdated : 0) - (Number.isFinite(aUpdated) ? aUpdated : 0);
        })[0] ?? null
    : null;
  if (byPrefix) {
    return <SitePageClient forcedSiteId={byPrefix.id} initialIsMobileViewport={initialIsMobileViewport} />;
  }

  const bySiteId = merchantEntry ? platformState.sites.find((site) => site.id === merchantEntry) : null;
  if (bySiteId) {
    return <SitePageClient forcedSiteId={bySiteId.id} initialIsMobileViewport={initialIsMobileViewport} />;
  }

  if (!remoteResolved) {
    return <LoadingProgressScreen message="正在加载站点..." />;
  }

  if (resolvedSiteId) {
    return <SitePageClient forcedSiteId={resolvedSiteId} initialIsMobileViewport={initialIsMobileViewport} />;
  }

  return <ServiceMaintenancePage title="站点准备中" description="该商户站点暂未完成首次发布，当前入口暂不可用，请稍后再访问。" />;
}
