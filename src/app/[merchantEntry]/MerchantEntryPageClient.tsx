"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import LoadingProgressScreen from "@/components/LoadingProgressScreen";
import SitePageClient from "@/app/site/[siteId]/SitePageClient";
import { loadPlatformState, subscribePlatformState } from "@/data/platformControlStore";
import { isMerchantNumericId, normalizeDomainPrefix } from "@/lib/merchantIdentity";
import { resolvePublishedSiteByPrefix } from "@/lib/publishedSiteLookup";
import { buildPlatformHomeHref } from "@/lib/siteRouting";
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

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-3xl rounded-lg border bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">地址未匹配到站点</h1>
        <p className="mt-2 text-sm text-slate-600">请检查商户后台地址、商户 ID 或商户前台前缀是否正确。</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={buildPlatformHomeHref()} className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50">
            去总站首页
          </Link>
        </div>
      </div>
    </main>
  );
}
