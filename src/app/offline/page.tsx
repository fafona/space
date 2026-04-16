"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { readRecentMerchantLaunchMerchantId } from "@/lib/merchantLaunchState";
import { readRecentPwaRoutes } from "@/lib/pwaRecentRoutes";
import { buildMerchantBackendHref } from "@/lib/siteRouting";

type OfflineCopy = {
  title: string;
  body: string;
  retry: string;
  home: string;
  workspace: string;
  recentPage: string;
};

function resolveOfflineCopy(locale: string): OfflineCopy {
  const normalized = (locale || "").trim().toLowerCase();
  const language = normalized.split("-")[0] || "en";
  if (language === "zh") {
    return {
      title: "当前处于离线状态",
      body: "网络暂时不可用。你仍然可以返回已缓存页面，恢复连接后再刷新同步最新内容。",
      retry: "刷新重试",
      home: "返回首页",
      workspace: "打开最近工作区",
      recentPage: "打开最近页面",
    };
  }
  if (language === "es") {
    return {
      title: "Ahora estas sin conexion",
      body: "La red no esta disponible. Puedes volver a paginas ya guardadas y actualizar cuando regrese la conexion.",
      retry: "Reintentar",
      home: "Volver al inicio",
      workspace: "Abrir el ultimo panel",
      recentPage: "Abrir la ultima pagina",
    };
  }
  return {
    title: "You are offline",
    body: "The network is unavailable right now. You can return to cached pages and refresh again once the connection comes back.",
    retry: "Retry",
    home: "Back to home",
    workspace: "Open recent workspace",
    recentPage: "Open recent page",
  };
}

export default function OfflinePage() {
  const { locale } = useI18n();
  const copy = useMemo(() => resolveOfflineCopy(locale), [locale]);
  const [recentWorkspaceHref] = useState(() => {
    const merchantId = readRecentMerchantLaunchMerchantId();
    return merchantId ? buildMerchantBackendHref(merchantId) : "";
  });
  const [recentPageHref] = useState(() => {
    const recentPage = readRecentPwaRoutes().find((entry) => entry.path && entry.path !== "/");
    return recentPage?.path ?? "";
  });

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#1e3a8a_0%,#0f172a_42%,#020617_100%)] px-6 py-10 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-xl items-center justify-center">
        <section className="w-full rounded-[2rem] border border-white/15 bg-white/10 p-8 shadow-[0_30px_90px_rgba(2,6,23,0.4)] backdrop-blur-xl">
          <div className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.28em] text-sky-100">
            Faolla offline
          </div>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight">{copy.title}</h1>
          <p className="mt-3 text-sm leading-7 text-slate-200">{copy.body}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-slate-200"
            >
              {copy.retry}
            </button>
            <Link
              href="/"
              className="rounded-full border border-white/25 px-5 py-2.5 text-sm font-semibold text-white transition hover:border-white/40 hover:bg-white/10"
            >
              {copy.home}
            </Link>
            {recentWorkspaceHref ? (
              <Link
                href={recentWorkspaceHref}
                className="rounded-full border border-emerald-300/35 bg-emerald-300/12 px-5 py-2.5 text-sm font-semibold text-emerald-50 transition hover:border-emerald-300/55 hover:bg-emerald-300/18"
              >
                {copy.workspace}
              </Link>
            ) : null}
            {recentPageHref && recentPageHref !== recentWorkspaceHref ? (
              <Link
                href={recentPageHref}
                className="rounded-full border border-sky-300/35 bg-sky-300/12 px-5 py-2.5 text-sm font-semibold text-sky-50 transition hover:border-sky-300/55 hover:bg-sky-300/18"
              >
                {copy.recentPage}
              </Link>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
