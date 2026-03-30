"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import AdminClient from "@/app/admin/AdminClient";
import LoadingProgressScreen from "@/components/LoadingProgressScreen";
import { loadPlatformState, subscribePlatformState } from "@/data/platformControlStore";
import {
  hasStoredBrowserSupabaseSessionTokens,
  isTransientAuthValidationError,
  recoverBrowserSupabaseSession,
} from "@/lib/authSessionRecovery";
import { buildMerchantSiteLinker } from "@/lib/merchantSiteLinking";
import { clearMerchantSignInBridge, hasMerchantSignInBridge } from "@/lib/merchantSignInBridge";
import { isSupabaseEnabled, supabase } from "@/lib/supabase";
import { useHydrated } from "@/lib/useHydrated";

export default function MerchantNumericEntryPageClient() {
  const params = useParams<{ merchantEntry: string }>();
  const searchParams = useSearchParams();
  const merchantEntry = String(params?.merchantEntry ?? "").trim();
  const hydrated = useHydrated();
  const [justSignedIn] = useState(() => (searchParams.get("justSignedIn") ?? "").trim() === "1");
  const [hasStoredSessionTokens] = useState(() => {
    if (typeof window === "undefined") return false;
    return hasStoredBrowserSupabaseSessionTokens();
  });
  const skipEntrySessionCheck = useMemo(
    () => hydrated && (justSignedIn || hasStoredSessionTokens),
    [hasStoredSessionTokens, hydrated, justSignedIn],
  );
  const recentSignInBridgeActive = useMemo(
    () => hydrated && justSignedIn && hasMerchantSignInBridge(merchantEntry),
    [hydrated, justSignedIn, merchantEntry],
  );
  const [platformState, setPlatformState] = useState(() => loadPlatformState());
  const [numericAdminAuthReady, setNumericAdminAuthReady] = useState(() => recentSignInBridgeActive);
  const [numericAdminAuthenticated, setNumericAdminAuthenticated] = useState(() => recentSignInBridgeActive);
  const [numericSessionEmail, setNumericSessionEmail] = useState("");
  const [numericSessionLookupDone, setNumericSessionLookupDone] = useState(() => !isSupabaseEnabled);
  const matchMerchantSite = useMemo(
    () => buildMerchantSiteLinker(platformState.sites, platformState.users),
    [platformState.sites, platformState.users],
  );
  const numericScopedSiteId = useMemo(() => {
    if (!merchantEntry) return "";
    const matched = matchMerchantSite({
      merchantId: merchantEntry,
      email: numericSessionEmail,
    });
    return matched?.id || merchantEntry;
  }, [matchMerchantSite, merchantEntry, numericSessionEmail]);

  useEffect(
    () =>
      subscribePlatformState(() => {
        setPlatformState(loadPlatformState());
      }),
    [],
  );

  useEffect(() => {
    if (!hydrated || !justSignedIn || typeof window === "undefined") return;
    try {
      const url = new URL(window.location.href);
      if (!url.searchParams.has("justSignedIn")) return;
      url.searchParams.delete("justSignedIn");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // Ignore URL cleanup failures; AdminClient still keeps the bridge state in memory.
    }
  }, [hydrated, justSignedIn]);

  useEffect(() => {
    if (!hydrated || !merchantEntry || !isSupabaseEnabled) return;

    let mounted = true;
    if (skipEntrySessionCheck) {
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
  }, [hydrated, merchantEntry, recentSignInBridgeActive, skipEntrySessionCheck]);

  useEffect(() => {
    if (!hydrated || !merchantEntry || !isSupabaseEnabled) return;

    let mounted = true;
    if (skipEntrySessionCheck) {
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
  }, [hydrated, merchantEntry, skipEntrySessionCheck]);

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

  if (!hydrated) {
    return <LoadingProgressScreen message="正在加载站点..." />;
  }

  if (!isSupabaseEnabled || skipEntrySessionCheck || recentSignInBridgeActive) {
    return <AdminClient forcedScope={`site-${numericScopedSiteId || merchantEntry}`} initialJustSignedIn={justSignedIn} />;
  }
  if (!numericSessionLookupDone) {
    return <LoadingProgressScreen message="正在定位商户站点..." />;
  }
  if (!numericAdminAuthReady) {
    return <LoadingProgressScreen message="正在检查登录状态..." />;
  }
  if (!numericAdminAuthenticated) {
    return <LoadingProgressScreen message="正在跳转到登录页..." />;
  }
  return <AdminClient forcedScope={`site-${numericScopedSiteId || merchantEntry}`} initialJustSignedIn={justSignedIn} />;
}
