"use client";

import { useEffect } from "react";
import LoadingProgressScreen from "@/components/LoadingProgressScreen";
import { useI18n } from "@/components/I18nProvider";
import { readMerchantSessionMerchantIds, readMerchantSessionPayload } from "@/lib/authSessionRecovery";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { persistRecentMerchantLaunchState, readRecentMerchantLaunchMerchantId } from "@/lib/merchantLaunchState";
import { buildMerchantBackendHref } from "@/lib/siteRouting";

function resolveLaunchCopy(locale: string) {
  const normalized = (locale || "").trim().toLowerCase();
  if (normalized.startsWith("zh")) {
    return {
      title: "正在进入工作区",
      body: "正在检查登录状态并恢复最近的工作入口。",
    };
  }
  if (normalized.startsWith("es")) {
    return {
      title: "Abriendo tu espacio",
      body: "Estamos comprobando la sesión y recuperando tu último acceso.",
    };
  }
  return {
    title: "Opening your workspace",
    body: "Checking your session and restoring your most recent workspace entry.",
  };
}

export default function LaunchBootstrap() {
  const { locale } = useI18n();
  const copy = resolveLaunchCopy(locale);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const recentMerchantId = readRecentMerchantLaunchMerchantId();
        const payload = await readMerchantSessionPayload(2600).catch(() => null);
        if (cancelled) return;

        if (payload?.authenticated === true) {
          if (payload.accountType === "personal") {
            window.location.replace("/me");
            return;
          }

          const merchantIds = readMerchantSessionMerchantIds(payload);
          const merchantId =
            merchantIds.find((value) => isMerchantNumericId(value)) ??
            merchantIds[0] ??
            (typeof payload.merchantId === "string" ? payload.merchantId.trim() : "");
          if (isMerchantNumericId(merchantId)) {
            persistRecentMerchantLaunchState(merchantId);
            window.location.replace(buildMerchantBackendHref(merchantId));
            return;
          }
        }

        if (isMerchantNumericId(recentMerchantId)) {
          window.location.replace(`/login?launchRetry=1&merchantHint=${encodeURIComponent(recentMerchantId)}`);
          return;
        }

        window.location.replace("/login?launchRetry=1");
      } catch {
        if (cancelled) return;
        window.location.replace("/login?launchRetry=1");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return <LoadingProgressScreen locale={locale} statusTitle={copy.title} statusDescription={copy.body} />;
}
