"use client";

import Image from "next/image";

type LoadingProgressScreenProps = {
  message?: string;
  locale?: string | null;
  statusTitle?: string;
  statusDescription?: string;
};

type LoadingCopy = {
  badge: string;
  heroTitle: string;
  heroSubtitle: string;
  previewLabel: string;
  previewMerchant: string;
  previewMeta: string[];
  statusTitle: string;
  statusLine: string;
  features: string[];
};

function isChineseLocale(locale?: string | null) {
  return (locale ?? "").trim().toLowerCase().startsWith("zh");
}

function resolvePhaseSummary(message: string, isChinese: boolean) {
  if (message.includes("定位商户")) {
    return isChinese
      ? {
          title: "确认商户入口",
          line: "站点匹配中",
        }
      : {
          title: "Matching merchant entry",
          line: "Connecting your site",
        };
  }

  if (message.includes("跳转到登录页")) {
    return isChinese
      ? {
          title: "进入登录页",
          line: "网站 · 名片",
        }
      : {
          title: "Opening login",
          line: "Site · Cards",
        };
  }

  if (message.includes("加载站点")) {
    return isChinese
      ? {
          title: "加载品牌页面",
          line: "网站 · 名片资料",
        }
      : {
          title: "Loading branded page",
          line: "Site · Card details",
        };
  }

  return isChinese
    ? {
        title: "正在进入商户后台",
        line: "网站 · 名片 · 会话",
      }
    : {
        title: "Opening merchant workspace",
        line: "Site · Cards · Chat",
      };
}

function resolveLoadingCopy(props: LoadingProgressScreenProps): LoadingCopy {
  const message = (props.message ?? "").trim();
  const isChinese = isChineseLocale(props.locale);
  const phase = resolvePhaseSummary(message, isChinese);

  return {
    badge: "Faolla.com",
    heroTitle: isChinese ? "一张名片，连起网站与会话" : "One card for your site and chat",
    heroSubtitle: isChinese
      ? "图片名片、链接名片、聊天展示"
      : "Image card, link card, and chat showcase",
    previewLabel: isChinese ? "名片预览" : "Card preview",
    previewMerchant: "faolla",
    previewMeta: isChinese
      ? ["联系人: Felix", "电话: +34 633130577", "地址: Sevilla / Spain"]
      : ["Contact: Felix", "Phone: +34 633130577", "Sevilla / Spain"],
    statusTitle: props.statusTitle?.trim() || phase.title,
    statusLine: phase.line,
    features: isChinese ? ["图片名片", "链接名片", "聊天展示"] : ["Image card", "Link card", "Chat showcase"],
  };
}

function LoadingCardPreview(props: { copy: LoadingCopy }) {
  const { copy } = props;

  return (
    <div className="rounded-[24px] bg-[linear-gradient(180deg,_rgba(255,255,255,0.96)_0%,_rgba(242,247,255,0.92)_100%)] p-4 text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_18px_40px_rgba(15,23,42,0.12)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{copy.previewLabel}</div>
          <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{copy.previewMerchant}</div>
        </div>
        <div className="relative h-11 w-11 overflow-hidden rounded-[14px] bg-white shadow-[0_12px_24px_rgba(15,23,42,0.12)]">
          <Image src="/faolla-login-logo.png" alt="Faolla logo" fill sizes="44px" className="object-cover" priority />
        </div>
      </div>
      <div className="mt-4 space-y-1.5 text-sm leading-6 text-slate-700">
        {copy.previewMeta.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
    </div>
  );
}

export default function LoadingProgressScreen(props: LoadingProgressScreenProps) {
  const copy = resolveLoadingCopy(props);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#081121] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.22),_transparent_34%),radial-gradient(circle_at_84%_16%,_rgba(45,212,191,0.16),_transparent_24%),linear-gradient(180deg,_#081121_0%,_#101b33_58%,_#dfe8fb_100%)]" />
      <div className="absolute -left-16 top-16 h-48 w-48 rounded-full bg-cyan-300/18 blur-3xl" />
      <div className="absolute right-[-2rem] top-32 h-56 w-56 rounded-full bg-emerald-300/14 blur-3xl" />
      <div className="absolute bottom-[-5rem] left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-white/12 blur-3xl" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(env(safe-area-inset-top)+1rem)] sm:px-6 lg:px-8">
        <div className="inline-flex w-fit items-center gap-3 rounded-full border border-white/14 bg-white/10 px-4 py-2 text-xs font-medium uppercase tracking-[0.24em] text-cyan-50/90 backdrop-blur">
          <span className="inline-flex h-2 w-2 rounded-full bg-emerald-300" />
          {copy.badge}
        </div>

        <div className="flex flex-1 items-center py-4 sm:py-6 lg:hidden">
          <div className="w-full rounded-[28px] border border-white/14 bg-[linear-gradient(180deg,_rgba(8,17,33,0.54)_0%,_rgba(15,23,42,0.34)_100%)] p-5 shadow-[0_24px_60px_rgba(8,17,33,0.26)] backdrop-blur">
            <div className="flex items-center gap-3">
              <div className="relative h-14 w-14 overflow-hidden rounded-[20px] border border-white/16 bg-white/14 shadow-[0_16px_40px_rgba(8,17,33,0.28)]">
                <Image src="/faolla-login-logo.png" alt="Faolla logo" fill sizes="56px" className="object-cover" priority />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100/76">Faolla</div>
                <div className="mt-1 text-xl font-semibold leading-tight text-white">{copy.statusTitle}</div>
                <div className="mt-1 text-xs font-medium text-slate-200/74">{copy.statusLine}</div>
              </div>
            </div>

            <div className="mt-4">
              <LoadingCardPreview copy={copy} />
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {copy.features.map((feature) => (
                <div
                  key={feature}
                  className="rounded-[18px] border border-white/10 bg-white/8 px-3 py-3 text-center text-xs font-semibold text-white"
                >
                  {feature}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="hidden flex-1 gap-8 lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,400px)] lg:items-center">
          <section className="max-w-2xl">
            <div className="flex items-center gap-4">
              <div className="relative h-16 w-16 overflow-hidden rounded-[24px] border border-white/16 bg-white/14 shadow-[0_16px_40px_rgba(8,17,33,0.28)] backdrop-blur">
                <Image src="/faolla-login-logo.png" alt="Faolla logo" fill sizes="64px" className="object-cover" priority />
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.28em] text-slate-200/72">Faolla</div>
                <div className="mt-2 text-xl font-semibold text-white sm:text-2xl">{copy.heroTitle}</div>
              </div>
            </div>

            <p className="mt-5 max-w-xl text-sm leading-7 text-slate-100/82 sm:text-base">{copy.heroSubtitle}</p>

            <div className="mt-6 max-w-xl">
              <LoadingCardPreview copy={copy} />
            </div>
          </section>

          <aside className="rounded-[32px] border border-white/16 bg-[linear-gradient(180deg,_rgba(8,17,33,0.56)_0%,_rgba(15,23,42,0.34)_100%)] p-6 shadow-[0_24px_60px_rgba(8,17,33,0.26)] backdrop-blur">
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-400/14 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-100">
              <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-emerald-300" />
              Faolla
            </div>
            <div className="mt-5 text-2xl font-semibold leading-tight text-white">{copy.statusTitle}</div>
            <div className="mt-2 text-sm font-medium text-slate-200/76">{copy.statusLine}</div>

            <div className="mt-6 grid gap-3">
              {copy.features.map((feature, index) => (
                <div
                  key={`${feature}-${index}`}
                  className="flex items-center gap-3 rounded-[20px] border border-white/10 bg-white/8 px-4 py-4"
                >
                  <div className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/12 text-sm font-semibold text-white">
                    {index + 1}
                  </div>
                  <div className="text-sm font-semibold text-white">{feature}</div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
