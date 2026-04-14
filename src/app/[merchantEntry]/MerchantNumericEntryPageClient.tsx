"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import AdminClient from "@/app/admin/AdminClient";
import LoadingProgressScreen from "@/components/LoadingProgressScreen";
import { loadPlatformState, subscribePlatformState } from "@/data/platformControlStore";
import { readRecentMerchantLaunchMerchantId } from "@/lib/merchantLaunchState";
import {
  readMerchantSessionMerchantIds,
  readMerchantSessionPayload,
} from "@/lib/authSessionRecovery";
import { buildMerchantSiteLinker } from "@/lib/merchantSiteLinking";
import { clearMerchantSignInBridge, hasMerchantSignInBridge } from "@/lib/merchantSignInBridge";
import { canReachSupabaseGateway, isSupabaseEnabled } from "@/lib/supabase";
import { useHydrated } from "@/lib/useHydrated";

export default function MerchantNumericEntryPageClient() {
  const params = useParams<{ merchantEntry: string }>();
  const searchParams = useSearchParams();
  const merchantEntry = String(params?.merchantEntry ?? "").trim();
  const hydrated = useHydrated();
  const [justSignedIn] = useState(() => (searchParams.get("justSignedIn") ?? "").trim() === "1");
  const hasRecentLaunchEntry = useMemo(() => {
    if (!hydrated || typeof window === "undefined") return false;
    return readRecentMerchantLaunchMerchantId() === merchantEntry;
  }, [hydrated, merchantEntry]);
  const skipEntrySessionCheck = useMemo(() => hydrated && justSignedIn, [hydrated, justSignedIn]);
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

  const readCookieBackedMerchantIdentity = useCallback(async (timeoutMs = 4500) => {
    const payload = await readMerchantSessionPayload(timeoutMs).catch(() => null);
    if (!payload || payload.authenticated !== true) return null;
    const merchantIds = readMerchantSessionMerchantIds(payload);
    return {
      merchantId:
        (typeof payload.merchantId === "string" ? payload.merchantId.trim() : "") ||
        merchantIds.find(Boolean) ||
        "",
      email: typeof payload.user?.email === "string" ? payload.user.email.trim().toLowerCase() : "",
    };
  }, []);

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

    const allowTransientResumeRecovery = async () => {
      if (!hasRecentLaunchEntry) return false;
      const gatewayReady = await canReachSupabaseGateway(1800).catch(() => null);
      if (!mounted || gatewayReady !== false) return false;
      setNumericAdminAuthenticated(true);
      setNumericAdminAuthReady(true);
      return true;
    };

    void (async () => {
      const cookieBackedIdentity = await readCookieBackedMerchantIdentity(4500);
      if (!mounted) return;
      if (cookieBackedIdentity) {
        setNumericSessionEmail(cookieBackedIdentity.email);
        setNumericAdminAuthenticated(true);
        setNumericAdminAuthReady(true);
        return;
      }
      if (await allowTransientResumeRecovery()) {
        return;
      }
      redirectToLogin();
    })().catch(() => {
      void readCookieBackedMerchantIdentity(3200)
        .then(async (cookieBackedIdentity) => {
          if (!mounted) return;
          if (cookieBackedIdentity) {
            setNumericSessionEmail(cookieBackedIdentity.email);
            setNumericAdminAuthenticated(true);
            setNumericAdminAuthReady(true);
            return;
          }
          if (await allowTransientResumeRecovery()) {
            return;
          }
          redirectToLogin();
        })
        .catch(() => {
          void allowTransientResumeRecovery().then((preserved) => {
            if (preserved) return;
            redirectToLogin();
          });
        });
    });

    return () => {
      mounted = false;
    };
  }, [
    hasRecentLaunchEntry,
    hydrated,
    merchantEntry,
    readCookieBackedMerchantIdentity,
    recentSignInBridgeActive,
    skipEntrySessionCheck,
  ]);

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
        return readCookieBackedMerchantIdentity(2200);
      })
      .then(async (cookieBackedIdentity) => {
        if (!mounted) return;
        const sessionEmail = String(cookieBackedIdentity?.email ?? "").trim().toLowerCase();
        if (sessionEmail) {
          setNumericSessionEmail(sessionEmail);
          return;
        }
        setNumericSessionEmail("");
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
  }, [hydrated, merchantEntry, readCookieBackedMerchantIdentity, skipEntrySessionCheck]);

  useEffect(() => {
    if (!recentSignInBridgeActive) return;

    let mounted = true;
    void readCookieBackedMerchantIdentity(3200)
      .then((cookieBackedIdentity) => {
        if (!mounted || !cookieBackedIdentity) return;
        clearMerchantSignInBridge(merchantEntry);
      })
      .catch(() => {
        // Keep bridge available during transient recovery failures.
      });

    return () => {
      mounted = false;
    };
  }, [merchantEntry, readCookieBackedMerchantIdentity, recentSignInBridgeActive]);

  if (!hydrated) {
    return <LoadingProgressScreen message="正在加载站点..." />;
  }

  if (!isSupabaseEnabled || skipEntrySessionCheck || recentSignInBridgeActive) {
    return (
      <AdminClient
        forcedScope={`site-${numericScopedSiteId || merchantEntry}`}
        initialJustSignedIn={justSignedIn}
        startInLoadingState
      />
    );
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
  return (
    <AdminClient
      forcedScope={`site-${numericScopedSiteId || merchantEntry}`}
      initialJustSignedIn={justSignedIn}
      startInLoadingState
    />
  );
}
