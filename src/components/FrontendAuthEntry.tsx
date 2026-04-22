"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
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

function readSessionAccountId(payload: MerchantCookieSessionPayload | null, merchantIds: string[]) {
  return (
    trimText(payload?.accountId) ||
    trimText(payload?.merchantId) ||
    merchantIds[0] ||
    trimText(payload?.user?.email) ||
    "-"
  );
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
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    if (!accountMenuOpen) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      setAccountMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountMenuOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [accountMenuOpen]);

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
  const accountId = readSessionAccountId(payload, merchantIds);
  const accountTypeLabel = payload.accountType === "personal" ? "个人用户" : "商户用户";
  const resolvedBackendHref = backendHref || (payload.accountType === "personal" ? "/me" : "/admin");
  const renderAvatar = () =>
    avatarUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={avatarUrl} alt={name} className="h-full w-full object-cover" />
    ) : (
      <span>{avatarLabel}</span>
    );

  return (
    <div ref={rootRef} className={`${className} relative`}>
      <button
        type="button"
        className={
          avatarClassName ||
          "inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-white/80 bg-slate-950 text-sm font-bold text-white shadow-[0_12px_30px_rgba(15,23,42,0.22)] ring-1 ring-slate-950/10 transition hover:scale-[1.03]"
        }
        onClick={() => setAccountMenuOpen((current) => !current)}
        aria-label="账号菜单"
        aria-expanded={accountMenuOpen}
        aria-haspopup="menu"
        title="账号菜单"
      >
        {renderAvatar()}
      </button>
      {accountMenuOpen ? (
        <div
          className="absolute right-0 top-[calc(100%+0.75rem)] z-[2147483000] w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-[28px] border border-slate-200/90 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)] ring-1 ring-slate-950/5"
          role="menu"
        >
          <div className="bg-slate-50 px-5 py-5 text-center">
            <div className="mx-auto flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-slate-950 text-lg font-bold text-white ring-4 ring-white">
              {renderAvatar()}
            </div>
            <div className="mt-3 truncate text-base font-semibold text-slate-950">{name}</div>
            <div className="mt-1 text-xs font-medium text-slate-500">{accountTypeLabel}</div>
            <div className="mt-2 inline-flex max-w-full items-center rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm">
              <span className="shrink-0 text-slate-400">ID</span>
              <span className="ml-1 truncate">{accountId}</span>
            </div>
          </div>
          <div className="p-3">
            <Link
              href={resolvedBackendHref}
              target="_top"
              className="flex w-full items-center justify-center rounded-full bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(15,23,42,0.18)] transition hover:bg-slate-800"
              role="menuitem"
              onClick={() => setAccountMenuOpen(false)}
            >
              进入后台
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
