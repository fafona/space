"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  readMerchantSessionMerchantIds,
  readMerchantSessionPayload,
  type MerchantCookieSessionPayload,
} from "@/lib/authSessionRecovery";
import { buildBackendFaollaHref } from "@/lib/faollaEntry";
import { normalizePublicAssetUrl } from "@/lib/publicAssetUrl";
import { buildMerchantBackendHref } from "@/lib/siteRouting";

type FrontendAuthEntryProps = {
  className?: string;
  loginClassName?: string;
  avatarClassName?: string;
  currentMerchantId?: string;
  merchantAvatarUrl?: string;
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readMetadataString(source: Record<string, unknown> | null | undefined, ...keys: string[]) {
  if (!source) return "";
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function readProfileRecord(payload: MerchantCookieSessionPayload | null) {
  const userMetadata = readRecord(payload?.user?.user_metadata);
  return readRecord(userMetadata?.personal_profile) ?? readRecord(userMetadata?.profile);
}

function readSessionDisplayName(payload: MerchantCookieSessionPayload | null) {
  const userMetadata = readRecord(payload?.user?.user_metadata);
  const appMetadata = readRecord(payload?.user?.app_metadata);
  const profile = readProfileRecord(payload);
  return (
    readMetadataString(profile, "displayName", "display_name", "name", "merchantName") ||
    readMetadataString(
      userMetadata,
      "displayName",
      "display_name",
      "username",
      "name",
      "merchantName",
      "merchant_name",
    ) ||
    readMetadataString(appMetadata, "displayName", "display_name", "username", "name", "merchantName", "merchant_name") ||
    trimText(payload?.user?.email).split("@")[0] ||
    trimText(payload?.accountId) ||
    trimText(payload?.merchantId) ||
    "Faolla"
  );
}

function readSessionAvatarUrl(payload: MerchantCookieSessionPayload | null) {
  const userMetadata = readRecord(payload?.user?.user_metadata);
  const appMetadata = readRecord(payload?.user?.app_metadata);
  const profile = readProfileRecord(payload);
  return (
    readMetadataString(
      profile,
      "avatarUrl",
      "avatar_url",
      "personalAvatarUrl",
      "chatAvatarImageUrl",
      "merchantCardImageUrl",
    ) ||
    readMetadataString(
      userMetadata,
      "avatarUrl",
      "avatar_url",
      "personalAvatarUrl",
      "chatAvatarImageUrl",
      "merchantCardImageUrl",
      "logoUrl",
    ) ||
    readMetadataString(appMetadata, "avatarUrl", "avatar_url", "chatAvatarImageUrl", "merchantCardImageUrl", "logoUrl")
  );
}

function getAvatarLabel(name: string) {
  const normalized = name.trim();
  if (!normalized) return "F";
  const ascii = normalized.match(/[A-Za-z0-9]/g)?.join("") ?? "";
  if (ascii) return ascii.slice(0, 2).toUpperCase();
  return Array.from(normalized).slice(0, 2).join("");
}

export default function FrontendAuthEntry({
  className = "",
  loginClassName = "",
  avatarClassName = "",
  currentMerchantId = "",
  merchantAvatarUrl = "",
}: FrontendAuthEntryProps) {
  const [resolved, setResolved] = useState(false);
  const [currentUrl] = useState(() => (typeof window !== "undefined" ? window.location.href : ""));
  const [payload, setPayload] = useState<MerchantCookieSessionPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readMerchantSessionPayload(2500).then((nextPayload) => {
      if (cancelled) return;
      setPayload(nextPayload?.authenticated === true ? nextPayload : null);
      setResolved(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loginHref = useMemo(
    () => (currentUrl ? `/login?loginFrom=${encodeURIComponent(currentUrl)}` : "/login"),
    [currentUrl],
  );

  const backendHref = useMemo(() => {
    if (!payload?.authenticated || !currentUrl) return "";
    if (payload.accountType === "personal") {
      return buildBackendFaollaHref("/me", currentUrl);
    }
    const merchantIds = readMerchantSessionMerchantIds(payload);
    const primaryMerchantId = trimText(payload.merchantId) || merchantIds[0] || "";
    const baseHref = primaryMerchantId ? buildMerchantBackendHref(primaryMerchantId) : "/admin";
    return buildBackendFaollaHref(baseHref, currentUrl);
  }, [currentUrl, payload]);

  if (!resolved) return null;

  const loggedIn = payload?.authenticated === true;
  if (!loggedIn) {
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

  const merchantIds = readMerchantSessionMerchantIds(payload);
  const currentSiteBelongsToSession =
    payload.accountType === "merchant" && currentMerchantId.trim() && merchantIds.includes(currentMerchantId.trim());
  const name = readSessionDisplayName(payload);
  const avatarUrl = normalizePublicAssetUrl(
    readSessionAvatarUrl(payload) || (currentSiteBelongsToSession ? merchantAvatarUrl : ""),
  );
  const avatarLabel = getAvatarLabel(name);

  return (
    <div className={className}>
      <Link
        href={backendHref || (payload.accountType === "personal" ? "/me" : "/admin")}
        target="_top"
        className={
          avatarClassName ||
          "inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-white/80 bg-slate-950 text-sm font-bold text-white shadow-[0_12px_30px_rgba(15,23,42,0.22)] ring-1 ring-slate-950/10 transition hover:scale-[1.03]"
        }
        aria-label="进入后台"
        title="进入后台"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt={name} className="h-full w-full object-cover" />
        ) : (
          <span>{avatarLabel}</span>
        )}
      </Link>
    </div>
  );
}
