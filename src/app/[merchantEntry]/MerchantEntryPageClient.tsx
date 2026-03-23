"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import AdminClient from "@/app/admin/AdminClient";
import SitePageClient from "@/app/site/[siteId]/SitePageClient";
import LoadingProgressScreen from "@/components/LoadingProgressScreen";
import { loadPlatformState, subscribePlatformState } from "@/data/platformControlStore";
import { isMerchantNumericId, normalizeDomainPrefix } from "@/lib/merchantIdentity";
import { resolvePublishedSiteByPrefix } from "@/lib/publishedSiteLookup";
import { buildPlatformHomeHref } from "@/lib/siteRouting";
import { isSupabaseEnabled, supabase, supabaseStorageKeyProjectRef } from "@/lib/supabase";
import { useHydrated } from "@/lib/useHydrated";

type MerchantEntryPageClientProps = {
  initialIsMobileViewport?: boolean;
  initialResolvedSiteId?: string;
};

function extractSessionTokens(input: unknown): { access_token: string; refresh_token: string } | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const containers: unknown[] = [record, record.currentSession, record.session];
  for (const container of containers) {
    if (!container || typeof container !== "object") continue;
    const candidate = container as Record<string, unknown>;
    const access = typeof candidate.access_token === "string" ? candidate.access_token.trim() : "";
    const refresh = typeof candidate.refresh_token === "string" ? candidate.refresh_token.trim() : "";
    if (access && refresh) return { access_token: access, refresh_token: refresh };
  }
  return null;
}

function isInvalidRefreshTokenMessage(message: string) {
  return /invalid refresh token|already used/i.test(String(message ?? ""));
}

async function pollSession(timeoutMs: number) {
  const deadline = Date.now() + Math.max(400, timeoutMs);
  while (Date.now() < deadline) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session) return session;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 220);
    });
  }
  return null;
}

async function tryRecoverSessionFromStoredToken() {
  if (typeof window === "undefined") return null;
  const expectedRef = supabaseStorageKeyProjectRef.trim();
  const preferredKey = expectedRef ? `sb-${expectedRef}-auth-token` : "";
  if (!preferredKey) return null;

  try {
    const raw = window.localStorage.getItem(preferredKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    const tokens = extractSessionTokens(parsed);
    if (!tokens) return null;
    const { data } = await supabase.auth.setSession(tokens);
    return data.session ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (isInvalidRefreshTokenMessage(message)) {
      try {
        window.localStorage.removeItem(preferredKey);
      } catch {
        // Ignore localStorage cleanup failures.
      }
    }
    return null;
  }
}

async function recoverMerchantSession(timeoutMs: number) {
  const direct = await pollSession(timeoutMs);
  if (direct) return direct;

  const fromStored = await tryRecoverSessionFromStoredToken();
  if (fromStored) return fromStored;

  try {
    const { data } = await supabase.auth.refreshSession();
    if (data.session) return data.session;
  } catch {
    // Ignore refresh failures and fall back to one final short poll.
  }

  return pollSession(1200);
}

export default function MerchantEntryPageClient({
  initialIsMobileViewport = false,
  initialResolvedSiteId = "",
}: MerchantEntryPageClientProps) {
  const params = useParams<{ merchantEntry: string }>();
  const searchParams = useSearchParams();
  const merchantEntry = String(params?.merchantEntry ?? "").trim();
  const hydrated = useHydrated();
  const justSignedIn = useMemo(() => (searchParams.get("justSignedIn") ?? "").trim() === "1", [searchParams]);
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
  const [numericAdminAuthReady, setNumericAdminAuthReady] = useState(false);
  const [numericAdminAuthenticated, setNumericAdminAuthenticated] = useState(false);

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
    if (!hydrated || !merchantEntry || !isMerchantNumericId(merchantEntry)) return;
    if (!isSupabaseEnabled) return;

    let mounted = true;
    const redirectToLogin = () => {
      if (!mounted || typeof window === "undefined") return;
      setNumericAdminAuthenticated(false);
      setNumericAdminAuthReady(true);
      window.location.replace(`/login?redirect=${encodeURIComponent(`/${merchantEntry}`)}`);
    };

    void (async () => {
      const {
        data: { session: rawSession },
      } = await supabase.auth.getSession();
      let session = rawSession;
      if (!mounted) return;
      if (!session?.user && justSignedIn) {
        session = await recoverMerchantSession(6000);
        if (!mounted) return;
      }
      if (!session?.user) {
        redirectToLogin();
        return;
      }

      try {
        const { data, error } = await supabase.auth.getUser();
        if (!mounted) return;
        if (error || !data.user) {
          if (!justSignedIn) {
            await supabase.auth.signOut({ scope: "local" }).catch(() => {
              // Ignore local cleanup failure.
            });
            redirectToLogin();
            return;
          }
        }
      } catch {
        if (!mounted) return;
        if (!justSignedIn) {
          redirectToLogin();
          return;
        }
      }

      setNumericAdminAuthenticated(true);
      setNumericAdminAuthReady(true);
    })().catch(() => {
      redirectToLogin();
    });

    return () => {
      mounted = false;
    };
  }, [hydrated, justSignedIn, merchantEntry]);

  const resolvedSiteId = remoteLookup.prefix === normalizedPrefix ? remoteLookup.siteId : "";
  const remoteResolved =
    !merchantEntry || isMerchantNumericId(merchantEntry) || (remoteLookup.prefix === normalizedPrefix && remoteLookup.resolved);

  if (!hydrated) {
    return <LoadingProgressScreen message="正在加载站点..." />;
  }

  if (merchantEntry && isMerchantNumericId(merchantEntry)) {
    if (!isSupabaseEnabled) {
      return <AdminClient forcedScope={`site-${merchantEntry}`} />;
    }
    if (!numericAdminAuthReady) {
      return <LoadingProgressScreen message="正在检查登录状态..." />;
    }
    if (!numericAdminAuthenticated) {
      return <LoadingProgressScreen message="正在跳转到登录页..." />;
    }
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
