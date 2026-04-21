"use client";

import { useEffect, useMemo, useState } from "react";
import { readMerchantSessionMerchantIds } from "@/lib/authSessionRecovery";

type MeSessionPayload = {
  authenticated?: unknown;
  accountType?: unknown;
  accountId?: unknown;
  merchantId?: unknown;
  merchantIds?: unknown;
  user?: {
    email?: string | null;
    user_metadata?: Record<string, unknown> | null;
    app_metadata?: Record<string, unknown> | null;
  } | null;
};

function readDisplayName(payload: MeSessionPayload | null) {
  const userMetadata = payload?.user?.user_metadata ?? null;
  const appMetadata = payload?.user?.app_metadata ?? null;
  for (const source of [userMetadata, appMetadata]) {
    if (!source || typeof source !== "object") continue;
    for (const key of ["display_name", "displayName", "username", "name"]) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return "";
}

export default function MePage() {
  const [payload, setPayload] = useState<MeSessionPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      try {
        const response = await fetch("/api/auth/merchant-session", {
          method: "GET",
          cache: "no-store",
        });
        const nextPayload = (await response.json().catch(() => null)) as MeSessionPayload | null;
        if (cancelled) return;
        if (!response.ok || nextPayload?.authenticated !== true || !nextPayload?.user) {
          window.location.replace("/login?redirect=/me");
          return;
        }
        if (nextPayload.accountType !== "personal") {
          const merchantIds = readMerchantSessionMerchantIds(nextPayload);
          const merchantId =
            (typeof nextPayload.merchantId === "string" ? nextPayload.merchantId.trim() : "") || merchantIds[0] || "";
          window.location.replace(merchantId ? `/${merchantId}/admin` : "/admin");
          return;
        }
        setPayload(nextPayload);
      } catch {
        if (!cancelled) {
          window.location.replace("/login?redirect=/me");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const accountId =
    payload && typeof payload.accountId === "string" && /^\d{8}$/.test(payload.accountId.trim())
      ? payload.accountId.trim()
      : "";
  const email = payload?.user?.email?.trim() ?? "";
  const displayName = useMemo(() => readDisplayName(payload), [payload]);

  if (loading) {
    return <main className="min-h-screen bg-slate-50 px-6 py-12 text-sm text-slate-500">正在载入个人中心...</main>;
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Personal Center</div>
        <h1 className="mt-3 text-3xl font-semibold text-slate-950">个人中心</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          个人用户入口已经接通。下一步会继续补上我的订单、我的预约和与商户对话。
        </p>
        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="text-xs text-slate-500">个人 ID</div>
            <div className="mt-2 text-lg font-semibold text-slate-950">{accountId || "-"}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="text-xs text-slate-500">昵称</div>
            <div className="mt-2 text-lg font-semibold text-slate-950">{displayName || "-"}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="text-xs text-slate-500">邮箱</div>
            <div className="mt-2 break-all text-lg font-semibold text-slate-950">{email || "-"}</div>
          </div>
        </div>
      </div>
    </main>
  );
}
