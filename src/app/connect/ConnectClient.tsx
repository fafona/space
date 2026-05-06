"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type AccountType = "merchant" | "personal";

type SessionPayload = {
  authenticated?: unknown;
  accountType?: unknown;
  accountId?: unknown;
  merchantId?: unknown;
  merchantIds?: unknown;
};

type EnsureContactPayload = {
  ok?: unknown;
  error?: unknown;
  message?: unknown;
  contact?: {
    merchantId?: unknown;
    merchantName?: unknown;
    merchantEmail?: unknown;
  } | null;
};

type PersonalProfilePayload = {
  ok?: unknown;
  favoriteSites?: Array<{
    id?: unknown;
    url?: unknown;
    name?: unknown;
    subtitle?: unknown;
    addedAt?: unknown;
  }> | null;
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAccountType(value: unknown): AccountType | "" {
  return value === "merchant" || value === "personal" ? value : "";
}

function normalizeAccountId(value: unknown) {
  const normalized = trimText(value);
  return /^\d{8}$/.test(normalized) ? normalized : "";
}

function readSessionPrimaryMerchantId(session: SessionPayload | null) {
  const direct = normalizeAccountId(session?.merchantId);
  if (direct) return direct;
  const list = Array.isArray(session?.merchantIds) ? session.merchantIds : [];
  return list.map(normalizeAccountId).find(Boolean) ?? "";
}

function readPayloadMessage(value: unknown, fallback: string) {
  const message = trimText(value);
  return message || fallback;
}

function buildCurrentRedirectPath() {
  if (typeof window === "undefined") return "/connect";
  return `${window.location.pathname}${window.location.search}`;
}

function redirectToPersonalLogin() {
  const redirect = encodeURIComponent(buildCurrentRedirectPath());
  window.location.replace(`/login?accountType=personal&redirect=${redirect}`);
}

function buildAccountHomeHref(session: SessionPayload | null, targetType: AccountType, targetId: string) {
  const accountType = normalizeAccountType(session?.accountType);
  if (accountType === "personal") {
    const url = new URL("/me", window.location.origin);
    url.searchParams.set("mobileTab", "conversations");
    if (targetId) url.searchParams.set("peerMerchantId", targetId);
    return `${url.pathname}${url.search}`;
  }

  const merchantId = readSessionPrimaryMerchantId(session);
  const url = new URL(merchantId ? `/${merchantId}` : "/admin", window.location.origin);
  url.searchParams.set("mobileTab", "conversations");
  if (targetId && targetType) {
    url.searchParams.set("peerAccountType", targetType);
    url.searchParams.set("peerAccountId", targetId);
  }
  return `${url.pathname}${url.search}`;
}

function normalizeFavoriteSites(value: PersonalProfilePayload["favoriteSites"]) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const id = trimText(item?.id);
      const url = trimText(item?.url);
      if (!id || !url) return null;
      return {
        id,
        url,
        name: trimText(item?.name),
        subtitle: trimText(item?.subtitle),
        addedAt: trimText(item?.addedAt) || new Date().toISOString(),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

async function ensureContact(targetType: AccountType, targetId: string, targetName: string) {
  const response = await fetch("/api/merchant-peer-messages", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      action: "ensure_contact",
      contactAccountId: targetId,
      contactName: targetName,
      contactAccountType: targetType,
    }),
  });
  const payload = (await response.json().catch(() => null)) as EnsureContactPayload | null;
  if (!response.ok || payload?.ok !== true) {
    throw new Error(readPayloadMessage(payload?.message || payload?.error, "添加会话失败，请稍后重试"));
  }
  return payload;
}

async function addMerchantFavorite(targetId: string, targetName: string, contactName: string) {
  const profileResponse = await fetch("/api/personal-profile", {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  if (!profileResponse.ok) return;
  const profilePayload = (await profileResponse.json().catch(() => null)) as PersonalProfilePayload | null;
  const currentSites = normalizeFavoriteSites(profilePayload?.favoriteSites ?? null);
  const favoriteUrl = new URL(`/site/${targetId}`, window.location.origin).toString();
  const nextSite = {
    id: `merchant:${targetId}`,
    url: favoriteUrl,
    name: contactName || targetName || targetId,
    subtitle: new URL(favoriteUrl).host,
    addedAt: new Date().toISOString(),
  };
  const nextSites = [nextSite, ...currentSites.filter((site) => site.id !== nextSite.id && site.url !== nextSite.url)].slice(0, 200);
  await fetch("/api/personal-profile", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      favoriteSites: nextSites,
    }),
  }).catch(() => undefined);
}

export default function ConnectClient() {
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("正在识别二维码...");
  const targetType = useMemo(() => normalizeAccountType(searchParams.get("type")), [searchParams]);
  const targetId = useMemo(() => normalizeAccountId(searchParams.get("id")), [searchParams]);
  const targetName = useMemo(() => trimText(searchParams.get("name")).slice(0, 80), [searchParams]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!targetType || !targetId) {
        setMessage("二维码无效，请重新扫描");
        return;
      }

      setMessage("正在检查登录状态...");
      const sessionResponse = await fetch("/api/auth/merchant-session", {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: { accept: "application/json" },
      }).catch(() => null);
      const session = sessionResponse && sessionResponse.ok
        ? ((await sessionResponse.json().catch(() => null)) as SessionPayload | null)
        : null;
      if (cancelled) return;

      if (session?.authenticated !== true) {
        setMessage("请先登录或注册个人用户");
        redirectToPersonalLogin();
        return;
      }

      const accountType = normalizeAccountType(session.accountType);
      const selfId = accountType === "personal" ? normalizeAccountId(session.accountId) : readSessionPrimaryMerchantId(session);
      if (selfId && selfId === targetId && accountType === targetType) {
        setMessage("这是你自己的二维码");
        window.setTimeout(() => {
          if (!cancelled) window.location.replace(buildAccountHomeHref(session, targetType, targetId));
        }, 600);
        return;
      }

      setMessage("正在添加会话...");
      const result = await ensureContact(targetType, targetId, targetName).catch((error) => {
        throw error instanceof Error ? error : new Error("添加会话失败，请稍后重试");
      });
      if (cancelled) return;

      if (targetType === "merchant" && accountType === "personal") {
        setMessage("正在收藏商户...");
        await addMerchantFavorite(targetId, targetName, trimText(result.contact?.merchantName)).catch(() => undefined);
      }

      setMessage("正在打开会话...");
      window.location.replace(buildAccountHomeHref(session, targetType, targetId));
    })().catch((error) => {
      if (cancelled) return;
      setMessage(error instanceof Error ? error.message : "二维码处理失败，请稍后重试");
    });

    return () => {
      cancelled = true;
    };
  }, [targetId, targetName, targetType]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-center text-slate-950">
      <section className="w-full max-w-sm rounded-[28px] bg-white px-6 py-8 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-950 text-xl font-semibold text-white">FA</div>
        <h1 className="mt-5 text-xl font-semibold">Faolla 二维码</h1>
        <p className="mt-3 text-sm leading-6 text-slate-500">{message}</p>
        <button
          type="button"
          className="mt-6 h-12 w-full rounded-full bg-slate-950 text-sm font-semibold text-white"
          onClick={() => {
            if (targetType && targetId) {
              window.location.href = buildAccountHomeHref(null, targetType, targetId);
            } else {
              window.location.href = "/";
            }
          }}
        >
          手动打开
        </button>
      </section>
    </main>
  );
}
