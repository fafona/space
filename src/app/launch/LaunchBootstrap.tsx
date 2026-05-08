"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import LoadingProgressScreen from "@/components/LoadingProgressScreen";
import { useI18n } from "@/components/I18nProvider";
import {
  readMerchantSessionMerchantIds,
  readMerchantSessionPayload,
  resolveFrontendAuthPayload,
} from "@/lib/authSessionRecovery";
import { buildBackendAppShellHref } from "@/lib/faollaEntry";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { persistRecentMerchantLaunchState, readRecentMerchantLaunchMerchantId } from "@/lib/merchantLaunchState";
import { buildMerchantBackendHref } from "@/lib/siteRouting";

function resolveLaunchCopy(locale: string) {
  const normalized = (locale || "").trim().toLowerCase();
  if (normalized.startsWith("zh")) {
    return {
      title: "正在进入 Faolla",
      body: "正在检查登录状态并恢复最近的入口。",
    };
  }
  if (normalized.startsWith("es")) {
    return {
      title: "Abriendo tu espacio",
      body: "Estamos comprobando la sesion y recuperando tu ultimo acceso.",
    };
  }
  return {
    title: "Opening your workspace",
    body: "Checking your session and restoring your most recent workspace entry.",
  };
}

export default function LaunchBootstrap() {
  const { locale } = useI18n();
  const router = useRouter();
  const copy = resolveLaunchCopy(locale);

  useEffect(() => {
    let cancelled = false;
    const navigate = (href: string) => {
      if (cancelled) return;
      if (/^https?:\/\//i.test(href)) {
        window.location.replace(href);
        return;
      }
      router.replace(href);
    };

    void (async () => {
      try {
        const recentMerchantId = readRecentMerchantLaunchMerchantId();
        const launchParams = new URLSearchParams(window.location.search);
        const isNativeAppLaunch =
          (launchParams.get("appShell") || "").trim().toLowerCase() === "faolla" ||
          (launchParams.get("nativeStart") || "").trim() === "1" ||
          launchParams.has("nativeAuthRetry");
        const standaloneNavigator = navigator as Navigator & { standalone?: boolean };
        const isStandaloneLaunch =
          window.matchMedia?.("(display-mode: standalone)")?.matches === true || standaloneNavigator.standalone === true;
        const directSessionTimeoutMs = isNativeAppLaunch ? 900 : isStandaloneLaunch ? 1800 : 1600;
        const recoverySessionTimeoutMs = isNativeAppLaunch ? 2400 : isStandaloneLaunch ? 5200 : 3800;
        if (isNativeAppLaunch && !launchParams.has("nativeAuthRetry") && isMerchantNumericId(recentMerchantId)) {
          persistRecentMerchantLaunchState(recentMerchantId);
          navigate(buildBackendAppShellHref(buildMerchantBackendHref(recentMerchantId)));
          return;
        }

        const directPayloadTask = readMerchantSessionPayload(directSessionTimeoutMs, { includeClientTokens: true }).catch(() => null);
        const recoveryPayloadTask = resolveFrontendAuthPayload(recoverySessionTimeoutMs).catch(() => null);
        const directPayload = await directPayloadTask;
        const payload = directPayload?.authenticated === true ? directPayload : await recoveryPayloadTask;
        if (cancelled) return;

        if (payload?.authenticated === true) {
          if (payload.accountType === "personal") {
            navigate(buildBackendAppShellHref("/me"));
            return;
          }

          const merchantIds = readMerchantSessionMerchantIds(payload);
          const merchantId =
            merchantIds.find((value) => isMerchantNumericId(value)) ??
            merchantIds[0] ??
            (typeof payload.merchantId === "string" ? payload.merchantId.trim() : "");
          if (isMerchantNumericId(merchantId)) {
            persistRecentMerchantLaunchState(merchantId);
            navigate(buildBackendAppShellHref(buildMerchantBackendHref(merchantId)));
            return;
          }
        }

        if (isMerchantNumericId(recentMerchantId)) {
          if (isNativeAppLaunch) {
            navigate(buildBackendAppShellHref(buildMerchantBackendHref(recentMerchantId)));
            return;
          }
          navigate(`/login?launchRetry=1&merchantHint=${encodeURIComponent(recentMerchantId)}`);
          return;
        }

        navigate("/login?launchRetry=1");
      } catch {
        if (cancelled) return;
        navigate("/login?launchRetry=1");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return <LoadingProgressScreen locale={locale} statusTitle={copy.title} statusDescription={copy.body} />;
}
