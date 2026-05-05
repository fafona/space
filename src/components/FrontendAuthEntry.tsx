"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MerchantCookieSessionPayload } from "@/lib/authSessionRecovery";
import { buildBackendFaollaHref, isFaollaAppShellSearch } from "@/lib/faollaEntry";
import { readFrontendAuthMerchantIds, resolveFrontendAuthAvatarUrl } from "@/lib/frontendAuthAvatar";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { normalizePublicAssetUrl } from "@/lib/publicAssetUrl";
import { buildMerchantBackendHref } from "@/lib/siteRouting";

type FrontendAuthEntryProps = {
  className?: string;
  loginClassName?: string;
  avatarClassName?: string;
  currentMerchantId?: string;
  merchantName?: string;
  merchantAvatarUrl?: string;
  autoOpenWorkspace?: boolean;
};

type PersonalProfileResponsePayload = {
  ok?: unknown;
  user?: MerchantCookieSessionPayload["user"] | null;
  profile?: Record<string, unknown> | null;
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function resolveDeferredFrontendAuthPayload(timeoutMs: number) {
  const { resolveFrontendAuthPayload } = await import("@/lib/authSessionRecovery");
  return resolveFrontendAuthPayload(timeoutMs);
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

function readMerchantPreviewProfile(value: unknown) {
  const root = readRecord(value);
  const profile = readRecord(root?.profile);
  const chatBusinessCard = readRecord(root?.chatBusinessCard) ?? readRecord(profile?.chatBusinessCard);
  const name =
    readMetadataString(profile, "merchantName", "name", "displayName", "display_name") ||
    readMetadataString(chatBusinessCard, "name", "title");
  const avatarUrl =
    readMetadataString(profile, "chatAvatarImageUrl", "merchantCardImageUrl", "avatarUrl", "avatar_url", "logoUrl") ||
    readMetadataString(chatBusinessCard, "imageUrl", "shareImageUrl", "contactPagePublicImageUrl");
  return {
    name,
    avatarUrl,
  };
}

function mergePersonalProfileResponseIntoPayload(
  payload: MerchantCookieSessionPayload | null,
  result: PersonalProfileResponsePayload | null,
) {
  if (!payload?.user || !result || result.ok !== true) return payload;
  const responseUser = result.user ?? null;
  const currentMetadata = readRecord(payload.user.user_metadata) ?? {};
  const responseMetadata = readRecord(responseUser?.user_metadata) ?? {};
  const currentProfile = readRecord(currentMetadata.personal_profile) ?? {};
  const responseProfile = readRecord(responseMetadata.personal_profile) ?? {};
  const explicitProfile = readRecord(result.profile) ?? {};
  const mergedProfile = {
    ...currentProfile,
    ...responseProfile,
    ...explicitProfile,
  };
  const displayName =
    readMetadataString(mergedProfile, "displayName", "display_name", "name") ||
    readMetadataString(responseMetadata, "displayName", "display_name", "name") ||
    readMetadataString(currentMetadata, "displayName", "display_name", "name");
  const avatarUrl =
    readMetadataString(mergedProfile, "avatarUrl", "avatar_url", "personalAvatarUrl", "chatAvatarImageUrl") ||
    readMetadataString(responseMetadata, "avatarUrl", "avatar_url", "personalAvatarUrl", "chatAvatarImageUrl") ||
    readMetadataString(currentMetadata, "avatarUrl", "avatar_url", "personalAvatarUrl", "chatAvatarImageUrl");
  return {
    ...payload,
    user: {
      ...payload.user,
      ...responseUser,
      user_metadata: {
        ...currentMetadata,
        ...responseMetadata,
        personal_profile: mergedProfile,
        ...(displayName ? { displayName, display_name: displayName } : {}),
        ...(avatarUrl ? { avatarUrl, avatar_url: avatarUrl } : {}),
      },
    },
  } satisfies MerchantCookieSessionPayload;
}

export default function FrontendAuthEntry({
  className = "",
  loginClassName = "",
  avatarClassName = "",
  currentMerchantId = "",
  merchantName = "",
  merchantAvatarUrl = "",
  autoOpenWorkspace = false,
}: FrontendAuthEntryProps) {
  const [resolved, setResolved] = useState(false);
  const [currentUrl] = useState(() => (typeof window !== "undefined" ? window.location.href : ""));
  const [payload, setPayload] = useState<MerchantCookieSessionPayload | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [merchantPreview, setMerchantPreview] = useState({ merchantId: "", name: "", avatarUrl: "" });
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && isFaollaAppShellSearch(window.location.search)) {
      return;
    }

    let cancelled = false;
    const retryDelays = [0, 1200, 3200, 7000];
    let retryTimer: number | null = null;

    const run = (attemptIndex: number) => {
      retryTimer = window.setTimeout(() => {
        void resolveDeferredFrontendAuthPayload(attemptIndex === 0 ? 2600 : 4200).then((nextPayload) => {
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
        }).catch(() => {
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
  }, []);

  const loginHref = useMemo(
    () => (currentUrl ? `/login?loginFrom=${encodeURIComponent(currentUrl)}` : "/login"),
    [currentUrl],
  );

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

  useEffect(() => {
    if (!resolved || payload?.authenticated !== true || payload.accountType !== "personal") return;
    let cancelled = false;
    const controller = new AbortController();
    void fetch("/api/personal-profile", {
      method: "GET",
      cache: "no-store",
      credentials: "include",
      headers: {
        accept: "application/json",
      },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json().catch(() => null)) as PersonalProfileResponsePayload | null;
      })
      .then((result) => {
        if (cancelled || !result) return;
        setPayload((current) => mergePersonalProfileResponseIntoPayload(current, result));
      })
      .catch(() => {
        // Public pages can still render the current cookie/bridge identity.
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [payload?.accountId, payload?.accountType, payload?.authenticated, payload?.user?.id, resolved]);

  useEffect(() => {
    if (!autoOpenWorkspace || !resolved || payload?.authenticated !== true || typeof window === "undefined") return;
    const nextHref = buildWorkspaceHref(payload, currentUrl || window.location.href);
    if (!nextHref) return;
    window.location.replace(nextHref);
  }, [autoOpenWorkspace, currentUrl, payload, resolved]);

  useEffect(() => {
    if (!resolved || payload?.authenticated !== true || payload.accountType !== "merchant") {
      return;
    }

    const merchantIds = readFrontendAuthMerchantIds(payload);
    const normalizedCurrentMerchantId = currentMerchantId.trim();
    const ownMerchantId =
      trimText(payload.merchantId) ||
      merchantIds[0] ||
      (/^\d{8}$/.test(trimText(payload.accountId)) ? trimText(payload.accountId) : "");
    const lookupMerchantId =
      normalizedCurrentMerchantId && merchantIds.includes(normalizedCurrentMerchantId)
        ? normalizedCurrentMerchantId
        : ownMerchantId;
    if (!/^\d{8}$/.test(lookupMerchantId)) return;

    let cancelled = false;
    const controller = new AbortController();
    void fetch(`/api/merchant-chat-business-card?merchantId=${encodeURIComponent(lookupMerchantId)}`, {
      method: "GET",
      cache: "no-store",
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json().catch(() => null)) as unknown;
      })
      .then((json) => {
        if (cancelled || !json) return;
        const preview = readMerchantPreviewProfile(json);
        setMerchantPreview({
          merchantId: lookupMerchantId,
          name: preview.name,
          avatarUrl: normalizePublicAssetUrl(preview.avatarUrl),
        });
      })
      .catch(() => {
        if (!cancelled) {
          setMerchantPreview((current) =>
            current.merchantId === lookupMerchantId ? { merchantId: lookupMerchantId, name: "", avatarUrl: "" } : current,
          );
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [currentMerchantId, payload, resolved]);

  const renderLoginLink = () => (
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

  if (!resolved) return renderLoginLink();

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

  const merchantIds = readFrontendAuthMerchantIds(payload);
  const currentSiteBelongsToSession =
    payload.accountType === "merchant" && currentMerchantId.trim() && merchantIds.includes(currentMerchantId.trim());
  const merchantPreviewApplies =
    payload.accountType === "merchant" && merchantPreview.merchantId && merchantIds.includes(merchantPreview.merchantId);
  const merchantContextName =
    (merchantPreviewApplies ? merchantPreview.name : "") || (currentSiteBelongsToSession ? merchantName.trim() : "");
  const name = (payload.accountType === "merchant" ? merchantContextName : "") || readSessionDisplayName(payload);
  const avatarUrl = normalizePublicAssetUrl(
    resolveFrontendAuthAvatarUrl({
      accountType: payload.accountType,
      sessionAvatarUrl: readSessionAvatarUrl(payload),
      merchantPreviewAvatarUrl: merchantPreview.avatarUrl,
      currentMerchantAvatarUrl: merchantAvatarUrl,
      merchantPreviewApplies: Boolean(merchantPreviewApplies),
      currentSiteBelongsToSession: Boolean(currentSiteBelongsToSession),
    }),
  );
  const avatarLabel = getAvatarLabel(name);
  const accountId = readSessionAccountId(payload, merchantIds);
  const accountTypeLabel = payload.accountType === "personal" ? "普通用户" : "商户用户";
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
          className="fixed right-[max(0.75rem,env(safe-area-inset-right))] top-[calc(env(safe-area-inset-top)+4.25rem)] z-[2147483000] max-h-[calc(100dvh-6rem)] w-[min(20rem,calc(100vw-1.5rem))] overflow-y-auto rounded-[28px] border border-slate-200/90 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)] ring-1 ring-slate-950/5 sm:absolute sm:right-0 sm:top-[calc(100%+0.75rem)]"
        >
          <div className="support-preserve-light-surface bg-slate-50 px-5 py-5 text-center">
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
        </div>
      ) : null}
    </div>
  );
}
