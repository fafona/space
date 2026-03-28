"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import AdminClient from "@/app/admin/AdminClient";
import SitePageClient from "@/app/site/[siteId]/SitePageClient";
import LoadingProgressScreen from "@/components/LoadingProgressScreen";
import { loadPlatformState, subscribePlatformState } from "@/data/platformControlStore";
import {
  hasStoredBrowserSupabaseSessionTokens,
  isTransientAuthValidationError,
  recoverBrowserSupabaseSession,
} from "@/lib/authSessionRecovery";
import { buildMerchantSiteLinker } from "@/lib/merchantSiteLinking";
import { isMerchantNumericId, normalizeDomainPrefix } from "@/lib/merchantIdentity";
import { clearMerchantSignInBridge, hasMerchantSignInBridge } from "@/lib/merchantSignInBridge";
import { resolvePublishedSiteByPrefix } from "@/lib/publishedSiteLookup";
import { buildPlatformHomeHref } from "@/lib/siteRouting";
import { isSupabaseEnabled, supabase } from "@/lib/supabase";
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
  const searchParams = useSearchParams();
  const merchantEntry = String(params?.merchantEntry ?? "").trim();
  const isNumericMerchantEntry = isMerchantNumericId(merchantEntry);
  const hydrated = useHydrated();
  const justSignedIn = useMemo(() => (searchParams.get("justSignedIn") ?? "").trim() === "1", [searchParams]);
  const skipEntrySessionCheck = useMemo(
    () => hydrated && justSignedIn && isNumericMerchantEntry,
    [hydrated, isNumericMerchantEntry, justSignedIn],
  );
  const recentSignInBridgeActive = useMemo(
    () => hydrated && justSignedIn && isNumericMerchantEntry && hasMerchantSignInBridge(merchantEntry),
    [hydrated, isNumericMerchantEntry, justSignedIn, merchantEntry],
  );
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
  const [numericAdminAuthReady, setNumericAdminAuthReady] = useState(() => recentSignInBridgeActive);
  const [numericAdminAuthenticated, setNumericAdminAuthenticated] = useState(() => recentSignInBridgeActive);
  const [numericSessionEmail, setNumericSessionEmail] = useState("");
  const [numericSessionLookupDone, setNumericSessionLookupDone] = useState(() => !isNumericMerchantEntry || !isSupabaseEnabled);
  const matchMerchantSite = useMemo(
    () => buildMerchantSiteLinker(platformState.sites, platformState.users),
    [platformState.sites, platformState.users],
  );
  const numericScopedSiteId = useMemo(() => {
    if (!merchantEntry || !isNumericMerchantEntry) return "";
    const matched = matchMerchantSite({
      merchantId: merchantEntry,
      email: numericSessionEmail,
    });
    return matched?.id || merchantEntry;
  }, [isNumericMerchantEntry, matchMerchantSite, merchantEntry, numericSessionEmail]);

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

  useEffect(() => {
    if (!hydrated || !merchantEntry || !isNumericMerchantEntry) return;
    if (!isSupabaseEnabled) return;

    let mounted = true;
    if (skipEntrySessionCheck) {
      setNumericAdminAuthenticated(true);
      setNumericAdminAuthReady(true);
      return () => {
        mounted = false;
      };
    }
    if (recentSignInBridgeActive) {
      return () => {
        mounted = false;
      };
    }

    const redirectToLogin = () => {
      if (!mounted || typeof window === "undefined") return;
      setNumericAdminAuthenticated(false);
      setNumericAdminAuthReady(true);
      window.location.replace(`/login?redirect=${encodeURIComponent(`/${merchantEntry}`)}`);
    };

    void (async () => {
      let session = await recoverBrowserSupabaseSession(4500);
      if (!mounted) return;
      if (!session?.user) {
        if (hasStoredBrowserSupabaseSessionTokens()) {
          setNumericAdminAuthenticated(true);
          setNumericAdminAuthReady(true);
          return;
        }
        redirectToLogin();
        return;
      }

      try {
        const { data, error } = await supabase.auth.getUser();
        if (!mounted) return;
        if (error || !data.user) {
          if (error && isTransientAuthValidationError(error)) {
            setNumericAdminAuthenticated(true);
            setNumericAdminAuthReady(true);
            return;
          }
          session = await recoverBrowserSupabaseSession(2200);
          if (!mounted) return;
          if (!session?.user) {
            if (hasStoredBrowserSupabaseSessionTokens()) {
              setNumericAdminAuthenticated(true);
              setNumericAdminAuthReady(true);
              return;
            }
            await supabase.auth.signOut({ scope: "local" }).catch(() => {
              // Ignore local cleanup failure.
            });
            redirectToLogin();
            return;
          }
        }
      } catch {
        if (!mounted) return;
        setNumericAdminAuthenticated(true);
        setNumericAdminAuthReady(true);
        return;
      }

      setNumericAdminAuthenticated(true);
      setNumericAdminAuthReady(true);
    })().catch(() => {
      redirectToLogin();
    });

    return () => {
      mounted = false;
    };
  }, [hydrated, isNumericMerchantEntry, merchantEntry, recentSignInBridgeActive, skipEntrySessionCheck]);

  useEffect(() => {
    if (!hydrated || !merchantEntry || !isNumericMerchantEntry || !isSupabaseEnabled) return;

    let mounted = true;
    if (skipEntrySessionCheck) {
      setNumericSessionLookupDone(true);
      return () => {
        mounted = false;
      };
    }
    void Promise.resolve()
      .then(() => {
        if (!mounted) return null;
        setNumericSessionLookupDone(false);
        return recoverBrowserSupabaseSession(2200);
      })
      .then((session) => {
        if (!mounted) return;
        setNumericSessionEmail(String(session?.user?.email ?? "").trim().toLowerCase());
      })
      .catch(() => {
        if (!mounted) return;
        setNumericSessionEmail("");
      })
      .finally(() => {
        if (!mounted) return;
        setNumericSessionLookupDone(true);
      });

    return () => {
      mounted = false;
    };
  }, [hydrated, isNumericMerchantEntry, merchantEntry, skipEntrySessionCheck]);

  useEffect(() => {
    if (!recentSignInBridgeActive) return;

    let mounted = true;
    void recoverBrowserSupabaseSession(3200)
      .then((session) => {
        if (!mounted || !session?.user) return;
        clearMerchantSignInBridge(merchantEntry);
      })
      .catch(() => {
        // Keep bridge available during transient recovery failures.
      });

    return () => {
      mounted = false;
    };
  }, [merchantEntry, recentSignInBridgeActive]);

  const resolvedSiteId = remoteLookup.prefix === normalizedPrefix ? remoteLookup.siteId : "";
  const remoteResolved =
    !merchantEntry || isNumericMerchantEntry || (remoteLookup.prefix === normalizedPrefix && remoteLookup.resolved);

  if (!hydrated) {
    return <LoadingProgressScreen message="正在加载站点..." />;
  }

  if (merchantEntry && isNumericMerchantEntry) {
    if (!isSupabaseEnabled) {
      return <AdminClient forcedScope={`site-${numericScopedSiteId || merchantEntry}`} />;
    }
    if (skipEntrySessionCheck) {
      return <AdminClient forcedScope={`site-${numericScopedSiteId || merchantEntry}`} />;
    }
    if (!numericSessionLookupDone) {
      return <LoadingProgressScreen message="正在定位商户站点..." />;
    }
    if (recentSignInBridgeActive) {
      return <AdminClient forcedScope={`site-${numericScopedSiteId || merchantEntry}`} />;
    }
    if (!numericAdminAuthReady) {
      return <LoadingProgressScreen message="正在检查登录状态..." />;
    }
    if (!numericAdminAuthenticated) {
      return <LoadingProgressScreen message="正在跳转到登录页..." />;
    }
    return <AdminClient forcedScope={`site-${numericScopedSiteId || merchantEntry}`} />;
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
        <p className="mt-2 text-sm text-slate-600">请检查商户后台地址（8位 ID）或商户前台前缀是否正确。</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/login" className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50">
            去商户登录
          </Link>
          <Link href={buildPlatformHomeHref()} className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50">
            去总站首页
          </Link>
        </div>
      </div>
    </main>
  );
}
