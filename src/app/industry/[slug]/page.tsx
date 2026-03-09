"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { loadPlatformState, subscribePlatformState, type SiteStatus } from "@/data/platformControlStore";
import { buildMerchantFrontendHref, buildPlatformHomeHref } from "@/lib/siteRouting";
import { useHydrated } from "@/lib/useHydrated";

function statusBadge(status: SiteStatus) {
  if (status === "online") return "border-emerald-300 bg-emerald-50 text-emerald-700";
  if (status === "maintenance") return "border-amber-300 bg-amber-50 text-amber-700";
  return "border-rose-300 bg-rose-50 text-rose-700";
}

function statusLabel(status: SiteStatus) {
  if (status === "online") return "在线";
  if (status === "maintenance") return "维护中";
  return "离线";
}

function fmt(iso: string | null) {
  if (!iso) return "未发布";
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { hour12: false }) : iso;
}

export default function IndustryPage() {
  const params = useParams<{ slug: string }>();
  const slug = typeof params?.slug === "string" ? params.slug : "";
  const hydrated = useHydrated();
  const [platformState, setPlatformState] = useState(() => loadPlatformState());

  useEffect(
    () =>
      subscribePlatformState(() => {
        setPlatformState(loadPlatformState());
      }),
    [],
  );

  const category = useMemo(
    () => platformState.industryCategories.find((item) => item.slug === slug) ?? null,
    [platformState.industryCategories, slug],
  );
  const sites = useMemo(() => {
    if (!category) return [];
    return platformState.sites
      .filter((site) => site.categoryId === category.id)
      .sort((a, b) => {
        if (a.status !== b.status) {
          const rank = (status: SiteStatus) => (status === "online" ? 0 : status === "maintenance" ? 1 : 2);
          return rank(a.status) - rank(b.status);
        }
        return a.name.localeCompare(b.name, "zh-CN");
      });
  }, [category, platformState.sites]);

  if (!hydrated) {
    return (
      <main className="min-h-screen bg-slate-100 p-6">
        <div className="mx-auto max-w-6xl rounded-lg border bg-white p-4 text-sm text-slate-600">正在加载行业页...</div>
      </main>
    );
  }

  if (!category) {
    return (
      <main className="min-h-screen bg-slate-100 p-6">
        <div className="mx-auto max-w-6xl rounded-lg border bg-white p-6">
          <h1 className="text-xl font-bold text-slate-900">行业不存在</h1>
          <p className="mt-2 text-sm text-slate-600">该行业可能已被停用或 slug 已变更。</p>
          <div className="mt-4">
            <Link href={buildPlatformHomeHref()} className="rounded border px-3 py-2 text-sm hover:bg-slate-50">
              返回总站首页
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 py-8">
      <div className="mx-auto max-w-6xl px-6">
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500">行业导航</div>
              <h1 className="mt-1 text-2xl font-bold text-slate-900">{category.name}</h1>
              <p className="mt-2 text-sm text-slate-600">{category.description || "该行业暂无说明"}</p>
            </div>
            <Link href={buildPlatformHomeHref()} className="rounded border px-3 py-2 text-sm hover:bg-slate-50">
              返回总站首页
            </Link>
          </div>
        </div>

        <section className="mt-5 rounded-2xl border bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">商家站点</h2>
            <div className="text-sm text-slate-500">共 {sites.length} 个</div>
          </div>

          {sites.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {sites.map((site) => (
                <article key={site.id} className="rounded-xl border bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-base font-semibold text-slate-900">{site.name}</h3>
                    <span className={`rounded border px-2 py-0.5 text-xs ${statusBadge(site.status)}`}>
                      {statusLabel(site.status)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500 break-all">{site.domain}</div>
                  <div className="mt-1 text-xs text-slate-500">已发布版本：v{site.publishedVersion}</div>
                  <div className="mt-1 text-xs text-slate-500">最近发布：{fmt(site.lastPublishedAt)}</div>
                  <div className="mt-3">
                    <Link href={buildMerchantFrontendHref(site.id, site.domainPrefix ?? site.domainSuffix)} className="rounded border bg-black px-3 py-2 text-xs text-white">
                      进入商家站点
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-slate-500">该行业下暂未接入商家站点。</div>
          )}
        </section>
      </div>
    </main>
  );
}
