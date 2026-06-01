"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MerchantMembershipListItem } from "@/lib/merchantMemberships";

type MerchantMemberManagerProps = {
  siteId: string;
  siteName?: string;
  className?: string;
};

type MembershipsPayload = {
  ok?: unknown;
  memberships?: MerchantMembershipListItem[];
  message?: unknown;
};

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function formatDateTime(value: string | null | undefined) {
  const timestamp = Date.parse(String(value ?? ""));
  if (!Number.isFinite(timestamp)) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function statusLabel(status: MerchantMembershipListItem["status"]) {
  return status === "left" ? "已退会" : "会员中";
}

function readPayloadMessage(value: unknown, fallback: string) {
  return trimText(value) || fallback;
}

export default function MerchantMemberManager({ siteId, siteName = "", className = "" }: MerchantMemberManagerProps) {
  const [memberships, setMemberships] = useState<MerchantMembershipListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const normalizedSiteId = siteId.trim();

  const stats = useMemo(() => {
    const active = memberships.filter((membership) => membership.status === "active").length;
    const left = memberships.filter((membership) => membership.status === "left").length;
    return {
      active,
      left,
      total: memberships.length,
    };
  }, [memberships]);

  const loadMemberships = useCallback(async () => {
    if (!/^\d{8}$/.test(normalizedSiteId)) {
      setMemberships([]);
      setLoadError("当前商户资料还没准备好，请稍后重试。");
      return;
    }
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch(`/api/memberships?siteId=${encodeURIComponent(normalizedSiteId)}`, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
        },
      });
      const payload = (await response.json().catch(() => null)) as MembershipsPayload | null;
      if (!response.ok || payload?.ok !== true) {
        throw new Error(readPayloadMessage(payload?.message, "会员列表加载失败，请稍后重试"));
      }
      setMemberships(Array.isArray(payload.memberships) ? payload.memberships : []);
    } catch (error) {
      setMemberships([]);
      setLoadError(error instanceof Error ? error.message : "会员列表加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [normalizedSiteId]);

  useEffect(() => {
    void loadMemberships();
  }, [loadMemberships]);

  return (
    <section className={`space-y-4 ${className}`}>
      <div className="rounded-[24px] border border-slate-200 bg-white px-5 py-4 shadow-[0_12px_32px_rgba(15,23,42,0.05)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-950">会员管理</h1>
            <p className="mt-1 text-sm text-slate-500">
              {siteName || normalizedSiteId} · 加入会员的个人用户会在这里保留记录，退会后资料自动隐藏。
            </p>
          </div>
          <button
            type="button"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            onClick={() => void loadMemberships()}
            disabled={loading}
          >
            {loading ? "刷新中..." : "刷新"}
          </button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-xs text-slate-500">全部会员</div>
            <div className="mt-1 text-2xl font-semibold text-slate-950">{stats.total}</div>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <div className="text-xs text-emerald-700">会员中</div>
            <div className="mt-1 text-2xl font-semibold text-emerald-700">{stats.active}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-xs text-slate-500">已退会</div>
            <div className="mt-1 text-2xl font-semibold text-slate-700">{stats.left}</div>
          </div>
        </div>
      </div>

      {loadError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{loadError}</div>
      ) : null}

      <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_12px_32px_rgba(15,23,42,0.05)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">会员列表</h2>
            <p className="mt-1 text-sm text-slate-500">会员卡号按“商户 ID + 6 位流水号”生成。</p>
          </div>
        </div>
        {loading && memberships.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-8 text-center text-sm text-slate-500">
            会员列表加载中...
          </div>
        ) : memberships.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center text-sm text-slate-500">
            还没有会员。个人用户在商户首页加入会员后会显示在这里。
          </div>
        ) : (
          <div className="mt-4 grid gap-3">
            {memberships.map((membership) => (
              <article
                key={membership.id}
                className={`rounded-2xl border p-4 ${
                  membership.status === "left" ? "border-slate-200 bg-slate-50" : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="truncate text-base font-semibold text-slate-950">
                        {membership.profileVisible ? membership.name || membership.accountId || membership.memberNo : "已退会会员"}
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          membership.status === "active" ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {statusLabel(membership.status)}
                      </span>
                    </div>
                    <div className="mt-1 font-mono text-xs font-semibold text-slate-500">会员卡号: {membership.memberNo}</div>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <div>加入: {formatDateTime(membership.joinedAt)}</div>
                    {membership.leftAt ? <div className="mt-1">退会: {formatDateTime(membership.leftAt)}</div> : null}
                  </div>
                </div>
                {membership.profileVisible ? (
                  <div className="mt-4 grid gap-2 text-sm text-slate-600 md:grid-cols-3">
                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                      <div className="text-xs text-slate-400">个人用户 ID</div>
                      <div className="mt-1 truncate font-semibold text-slate-800">{membership.accountId || "-"}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                      <div className="text-xs text-slate-400">电话</div>
                      <div className="mt-1 truncate font-semibold text-slate-800">{membership.phone || "-"}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                      <div className="text-xs text-slate-400">邮箱</div>
                      <div className="mt-1 truncate font-semibold text-slate-800">{membership.email || "-"}</div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl bg-white px-3 py-2 text-sm text-slate-500">此会员已退会，个人资料不可查看。</div>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
