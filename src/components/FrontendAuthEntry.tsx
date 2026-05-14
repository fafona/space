"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { MerchantCookieSessionPayload } from "@/lib/authSessionRecovery";
import { buildBackendFaollaHref } from "@/lib/faollaEntry";
import { readFrontendAuthMerchantIds } from "@/lib/frontendAuthAvatar";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { buildMerchantBackendHref } from "@/lib/siteRouting";

type FrontendAuthEntryProps = {
  className?: string;
  loginClassName?: string;
  avatarClassName?: string;
  currentMerchantId?: string;
  merchantName?: string;
  merchantAvatarUrl?: string;
  autoOpenWorkspace?: boolean;
  hideLogin?: boolean;
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function buildLoginHrefFromCurrentUrl(currentUrl: string) {
  if (!currentUrl) return "/login";
  let loginFrom = currentUrl;
  try {
    const url = new URL(currentUrl, typeof window !== "undefined" ? window.location.origin : "https://www.faolla.com");
    url.searchParams.delete("appShell");
    url.searchParams.delete("__faollaInlineBuild");
    url.searchParams.delete("__faollaWebBuild");
    url.searchParams.delete("nativeBuild");
    loginFrom = url.toString();
  } catch {
    loginFrom = currentUrl;
  }
  return `/login?loginFrom=${encodeURIComponent(loginFrom)}`;
}

async function resolveDeferredFrontendAuthPayload(timeoutMs: number) {
  const { resolveFrontendAuthPayload } = await import("@/lib/authSessionRecovery");
  return resolveFrontendAuthPayload(timeoutMs);
}

function readPrimaryMerchantId(payload: MerchantCookieSessionPayload | null, merchantIds: string[]) {
  const payloadMerchantId = trimText(payload?.merchantId);
  const payloadAccountId = trimText(payload?.accountId);
  return (
    merchantIds.find((value) => isMerchantNumericId(value)) ||
    (isMerchantNumericId(payloadMerchantId) ? payloadMerchantId : "") ||
    (isMerchantNumericId(payloadAccountId) ? payloadAccountId : "")
  );
}

function buildWorkspaceHref(payload: MerchantCookieSessionPayload | null, currentUrl: string) {
  if (payload?.authenticated !== true) return "";
  const sourceUrl = currentUrl || "/";
  if (payload.accountType === "personal") {
    return buildBackendFaollaHref("/me", sourceUrl);
  }
  const primaryMerchantId = readPrimaryMerchantId(payload, readFrontendAuthMerchantIds(payload));
  return buildBackendFaollaHref(primaryMerchantId ? buildMerchantBackendHref(primaryMerchantId) : "/admin", sourceUrl);
}

export default function FrontendAuthEntry({
  className = "",
  loginClassName = "",
  autoOpenWorkspace = false,
  hideLogin = false,
}: FrontendAuthEntryProps) {
  const skipAuthResolution = hideLogin && !autoOpenWorkspace;
  const [resolved, setResolved] = useState(() => skipAuthResolution);
  const [currentUrl] = useState(() => (typeof window !== "undefined" ? window.location.href : ""));
  const [payload, setPayload] = useState<MerchantCookieSessionPayload | null>(null);

  useEffect(() => {
    if (skipAuthResolution) return;

    let cancelled = false;
    const retryDelays = [0, 1200, 3200, 7000];
    let retryTimer: number | null = null;

    const run = (attemptIndex: number) => {
      retryTimer = window.setTimeout(() => {
        void resolveDeferredFrontendAuthPayload(attemptIndex === 0 ? 2600 : 4200)
          .then((nextPayload) => {
            if (cancelled) return;
            if (nextPayload) {
              setPayload(nextPayload);
              setResolved(true);
              return;
            }
            setPayload(null);
            setResolved(true);
            if (attemptIndex + 1 < retryDelays.length) {
              run(attemptIndex + 1);
            }
          })
          .catch(() => {
            if (cancelled) return;
            setPayload(null);
            setResolved(true);
            if (attemptIndex + 1 < retryDelays.length) {
              run(attemptIndex + 1);
            }
          });
      }, retryDelays[attemptIndex] ?? 0);
    };

    run(0);
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [skipAuthResolution]);

  const loginHref = useMemo(() => buildLoginHrefFromCurrentUrl(currentUrl), [currentUrl]);

  useEffect(() => {
    if (!autoOpenWorkspace || !resolved || payload?.authenticated !== true || typeof window === "undefined") return;
    const nextHref = buildWorkspaceHref(payload, currentUrl || window.location.href);
    if (!nextHref) return;
    window.location.replace(nextHref);
  }, [autoOpenWorkspace, currentUrl, payload, resolved]);

  if (skipAuthResolution || !resolved) return null;
  if (payload?.authenticated === true) return null;
  if (hideLogin) return null;

  return (
    <div className={className}>
      <Link
        href={loginHref}
        target="_top"
        className={
          loginClassName ||
          "inline-flex items-center rounded-full border border-slate-200/80 bg-white/90 px-4 py-2 text-sm font-semibold text-slate-900 shadow-[0_12px_30px_rgba(15,23,42,0.14)] backdrop-blur transition hover:bg-white"
        }
        aria-label="登录"
      >
        登录
      </Link>
    </div>
  );
}
