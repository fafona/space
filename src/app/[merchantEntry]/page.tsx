"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import AdminClient from "@/app/admin/AdminClient";
import SitePageClient from "@/app/site/[siteId]/SitePageClient";
import LoadingProgressScreen from "@/components/LoadingProgressScreen";
import { loadPlatformState, subscribePlatformState } from "@/data/platformControlStore";
import { isMerchantNumericId, normalizeDomainPrefix } from "@/lib/merchantIdentity";
import { resolvePublishedSiteByPrefix } from "@/lib/publishedSiteLookup";
import { buildPlatformHomeHref } from "@/lib/siteRouting";
import { useHydrated } from "@/lib/useHydrated";

export default function MerchantEntryPage() {
  const params = useParams<{ merchantEntry: string }>();
  const merchantEntry = String(params?.merchantEntry ?? "").trim();
  const hydrated = useHydrated();
  const normalizedPrefix = useMemo(() => normalizeDomainPrefix(merchantEntry), [merchantEntry]);
  const [platformState, setPlatformState] = useState(() => loadPlatformState());
  const [remoteLookup, setRemoteLookup] = useState<{ prefix: string; siteId: string }>({
    prefix: "",
    siteId: "",
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

    let mounted = true;
    const lookupPrefix = normalizedPrefix;
    void resolvePublishedSiteByPrefix(lookupPrefix).then((resolved) => {
      if (!mounted) return;
      setRemoteLookup({
        prefix: lookupPrefix,
        siteId: resolved?.siteId ?? "",
      });
    });
    return () => {
      mounted = false;
    };
  }, [hydrated, merchantEntry, normalizedPrefix]);

  const resolvedSiteId = remoteLookup.prefix === normalizedPrefix ? remoteLookup.siteId : "";
  const remoteResolved = !merchantEntry || isMerchantNumericId(merchantEntry) || remoteLookup.prefix === normalizedPrefix;

  if (!hydrated) {
    return <LoadingProgressScreen message="\u6b63\u5728\u52a0\u8f7d\u7ad9\u70b9..." />;
  }

  if (merchantEntry && isMerchantNumericId(merchantEntry)) {
    return <AdminClient forcedScope={`site-${merchantEntry}`} />;
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
    return <SitePageClient forcedSiteId={byPrefix.id} />;
  }

  const bySiteId = merchantEntry ? platformState.sites.find((site) => site.id === merchantEntry) : null;
  if (bySiteId) {
    return <SitePageClient forcedSiteId={bySiteId.id} />;
  }

  if (!remoteResolved) {
    return <LoadingProgressScreen message="\u6b63\u5728\u52a0\u8f7d\u7ad9\u70b9..." />;
  }

  if (resolvedSiteId) {
    return <SitePageClient forcedSiteId={resolvedSiteId} />;
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-3xl rounded-lg border bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">
          {"\u5730\u5740\u672a\u5339\u914d\u5230\u7ad9\u70b9"}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          {"\u8bf7\u68c0\u67e5\u5546\u6237\u540e\u53f0\u5730\u5740\uff088\u4f4d ID\uff09\u6216\u5546\u6237\u524d\u53f0\u524d\u7f00\u662f\u5426\u6b63\u786e\u3002"}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/login" className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50">
            {"\u53bb\u5546\u6237\u767b\u5f55"}
          </Link>
          <Link href={buildPlatformHomeHref()} className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50">
            {"\u53bb\u603b\u7ad9\u9996\u9875"}
          </Link>
        </div>
      </div>
    </main>
  );
}
