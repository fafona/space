"use client";

import { useEffect, useMemo, useState } from "react";
import type { PersonalMembershipCard } from "@/lib/merchantMemberships";

type MerchantMembershipEntryProps = {
  siteId: string;
  siteName?: string;
  className?: string;
};

type PersonalMembershipsPayload = {
  ok?: unknown;
  memberships?: PersonalMembershipCard[];
};

type MembershipMutationPayload = {
  ok?: unknown;
  membership?: PersonalMembershipCard;
  message?: unknown;
};

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function buildPersonalLoginHref() {
  if (typeof window === "undefined") return "/login?accountType=personal";
  const loginFrom = window.location.href;
  return `/login?accountType=personal&loginFrom=${encodeURIComponent(loginFrom)}`;
}

function readPayloadMessage(value: unknown, fallback: string) {
  const message = trimText(value);
  return message || fallback;
}

export default function MerchantMembershipEntry({ siteId, siteName = "", className = "" }: MerchantMembershipEntryProps) {
  const [resolved, setResolved] = useState(false);
  const [membership, setMembership] = useState<PersonalMembershipCard | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const normalizedSiteId = siteId.trim();
  const joinable = /^\d{8}$/.test(normalizedSiteId);
  const active = membership?.status === "active";
  const buttonLabel = useMemo(() => {
    if (busy) return "处理中...";
    if (active) return "已是会员";
    if (membership?.status === "left") return "重新加入会员";
    return "加入会员";
  }, [active, busy, membership?.status]);

  useEffect(() => {
    if (!joinable) return;
    let cancelled = false;
    void fetch(`/api/personal-memberships?siteId=${encodeURIComponent(normalizedSiteId)}`, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
      },
    })
      .then(async (response) => {
        if (cancelled) return;
        if (response.status === 401) {
          setResolved(true);
          return;
        }
        const payload = (await response.json().catch(() => null)) as PersonalMembershipsPayload | null;
        const current = Array.isArray(payload?.memberships) ? payload.memberships[0] ?? null : null;
        setMembership(current);
        setResolved(true);
      })
      .catch(() => {
        if (!cancelled) setResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, [joinable, normalizedSiteId]);

  async function handleJoin() {
    if (!joinable || busy || active) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/memberships", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          siteId: normalizedSiteId,
          siteName,
        }),
      });
      if (response.status === 401) {
        window.location.assign(buildPersonalLoginHref());
        return;
      }
      const payload = (await response.json().catch(() => null)) as MembershipMutationPayload | null;
      if (!response.ok || payload?.ok !== true || !payload.membership) {
        throw new Error(readPayloadMessage(payload?.message, "加入会员失败，请稍后重试"));
      }
      setMembership(payload.membership);
      setMessage("已加入会员");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加入会员失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  if (!joinable || !resolved) return null;

  return (
    <div className={className}>
      <button
        type="button"
        className={`inline-flex items-center rounded-full border px-4 py-2 text-sm font-semibold shadow-[0_12px_30px_rgba(15,23,42,0.12)] backdrop-blur transition disabled:cursor-default ${
          active
            ? "border-emerald-200 bg-emerald-50/95 text-emerald-700"
            : "border-slate-200/80 bg-white/90 text-slate-900 hover:bg-white"
        }`}
        onClick={() => {
          void handleJoin();
        }}
        disabled={busy || active}
      >
        {buttonLabel}
      </button>
      {message && !active ? (
        <div className="mt-2 max-w-[220px] rounded-xl bg-slate-950/85 px-3 py-2 text-xs font-medium text-white shadow-lg">
          {message}
        </div>
      ) : null}
    </div>
  );
}
