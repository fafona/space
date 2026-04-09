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
  eyebrow: string;
  title: string;
  subtitle: string;
  previewLabel: string;
  statusPill: string;
  statusTitle: string;
  statusDescription: string;
  highlights: Array<{
    title: string;
    description: string;
  }>;
};

function isChineseLocale(locale?: string | null) {
  return (locale ?? "").trim().toLowerCase().startsWith("zh");
}

function resolveLoadingCopy(props: LoadingProgressScreenProps): LoadingCopy {
  const message = (props.message ?? "").trim();
  const isChinese = isChineseLocale(props.locale);

  const statusByPhase = (() => {
    if (message.includes("定位商户")) {
      return isChinese
        ? {
            title: "正在确认商户入口",
            description: "请稍等，我们正在匹配你的商户站点与后台入口。",
          }
        : {
            title: "Matching your merchant entry",
            description: "Please wait while we connect your site prefix with the correct workspace.",
          };
    }
    if (message.includes("跳转到登录页")) {
      return isChinese
        ? {
            title: "正在进入登录页",
            description: "商户登录入口马上就好，接下来可以继续编辑网站和名片。",
          }
        : {
            title: "Opening your login page",
            description: "Your merchant login entry is almost ready so you can continue editing your site and cards.",
          };
    }
    if (message.includes("加载站点")) {
      return isChinese
        ? {
            title: "正在准备品牌页面",
            description: "请稍等，我们正在载入网站内容、名片资料和会话展示。",
          }
        : {
            title: "Preparing your branded page",
            description: "Please wait while we load your site content, card details, and chat showcase.",
          };
    }
    return isChinese
      ? {
          title: "正在为你准备名片工作台",
          description: "登录完成后，你可以继续编辑网站、生成联系卡，并把名片直接放进会话里。",
        }
      : {
          title: "Preparing your card workspace",
          description: "Once sign-in completes, you can edit your site, create contact cards, and pin them into chat.",
        };
  })();

  return {
    badge: "Faolla.com",
    eyebrow: isChinese ? "Merchant Card Suite" : "Merchant Card Suite",
    title: isChinese ? "一张名片，把网站、联系卡和聊天展示连在一起" : "One card for your site, contact link, and chat showcase",
    subtitle: isChinese
      ? "上传头像后，图片名片、链接名片和会话展示会保持同一套品牌信息，登录后就能继续管理。"
      : "Once your avatar is uploaded, picture cards, link cards, and chat showcases stay aligned with the same brand details.",
    previewLabel: isChinese ? "名片功能预览" : "Card feature preview",
    statusPill: isChinese ? "Card flow" : "Card flow",
    statusTitle: props.statusTitle?.trim() || statusByPhase.title,
    statusDescription: props.statusDescription?.trim() || statusByPhase.description,
    highlights: isChinese
      ? [
          {
            title: "图片名片",
            description: "适合聊天发送，保留头像、品牌色和二维码。",
          },
          {
            title: "链接名片",
            description: "打开就是官网、电话、邮箱和地址。",
          },
          {
            title: "聊天展示",
            description: "把常用名片固定在会话里，客户一进来就能看到。",
          },
        ]
      : [
          {
            title: "Image card",
            description: "Perfect for chat sharing with avatar, brand color, and QR code.",
          },
          {
            title: "Link card",
            description: "Open directly to your site, phone, email, and address.",
          },
          {
            title: "Chat showcase",
            description: "Pin your favorite card so customers see it right away.",
          },
        ],
  };
}

export default function LoadingProgressScreen(props: LoadingProgressScreenProps) {
  const copy = resolveLoadingCopy(props);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#081121] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.22),_transparent_34%),radial-gradient(circle_at_84%_16%,_rgba(45,212,191,0.16),_transparent_24%),linear-gradient(180deg,_#081121_0%,_#101b33_56%,_#dfe8fb_100%)]" />
      <div className="absolute -left-16 top-16 h-48 w-48 rounded-full bg-cyan-300/18 blur-3xl" />
      <div className="absolute right-[-2rem] top-32 h-56 w-56 rounded-full bg-emerald-300/14 blur-3xl" />
      <div className="absolute bottom-[-5rem] left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-white/12 blur-3xl" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-[calc(env(safe-area-inset-top)+1.5rem)] sm:px-6 lg:px-8">
        <div className="inline-flex w-fit items-center gap-3 rounded-full border border-white/14 bg-white/10 px-4 py-2 text-xs font-medium uppercase tracking-[0.24em] text-cyan-50/90 backdrop-blur">
          <span className="inline-flex h-2 w-2 rounded-full bg-emerald-300" />
          {copy.badge}
        </div>

        <div className="mt-8 grid flex-1 gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,400px)] lg:items-center">
          <section className="max-w-2xl">
            <div className="flex items-center gap-4">
              <div className="relative h-16 w-16 overflow-hidden rounded-[24px] border border-white/16 bg-white/14 shadow-[0_16px_40px_rgba(8,17,33,0.28)] backdrop-blur">
                <Image src="/faolla-login-logo.png" alt="Faolla logo" fill sizes="64px" className="object-cover" priority />
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.28em] text-slate-200/72">{copy.eyebrow}</div>
                <div className="mt-2 text-xl font-semibold text-white sm:text-2xl">Faolla</div>
              </div>
            </div>

            <h1 className="mt-8 text-3xl font-semibold leading-tight text-white sm:text-4xl lg:text-[2.85rem]">{copy.title}</h1>
            <p className="mt-4 max-w-xl text-sm leading-7 text-slate-100/82 sm:text-base">{copy.subtitle}</p>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {copy.highlights.map((highlight) => (
                <div
                  key={highlight.title}
                  className="rounded-[22px] border border-white/12 bg-white/10 px-4 py-4 backdrop-blur shadow-[0_16px_40px_rgba(8,17,33,0.16)]"
                >
                  <div className="text-sm font-semibold text-white">{highlight.title}</div>
                  <div className="mt-2 text-xs leading-6 text-slate-200/80">{highlight.description}</div>
                </div>
              ))}
            </div>

            <div className="mt-8 max-w-xl rounded-[30px] border border-white/14 bg-white/10 p-4 shadow-[0_24px_60px_rgba(8,17,33,0.22)] backdrop-blur">
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-50/82">{copy.previewLabel}</div>
              <div className="mt-4 rounded-[26px] bg-[linear-gradient(180deg,_rgba(255,255,255,0.96)_0%,_rgba(242,247,255,0.92)_100%)] p-5 text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_18px_40px_rgba(15,23,42,0.12)]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-2xl font-semibold tracking-tight text-slate-950">faolla</div>
                    <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-400">
                      business card
                    </div>
                  </div>
                  <div className="relative h-12 w-12 overflow-hidden rounded-[16px] bg-white shadow-[0_12px_24px_rgba(15,23,42,0.12)]">
                    <Image src="/faolla-login-logo.png" alt="Faolla logo" fill sizes="48px" className="object-cover" priority />
                  </div>
                </div>

                <div className="mt-5 space-y-2 text-sm leading-6 text-slate-700">
                  <div>联系人: Felix</div>
                  <div>电话: +34 633130577</div>
                  <div>邮箱: caimin00x@gmail.com</div>
                  <div>地址: Sevilla / Spain</div>
                </div>

                <div className="mt-5 flex flex-wrap gap-2 text-[11px] font-medium text-slate-600">
                  <span className="rounded-full bg-slate-900 px-3 py-1 text-white">图片名片</span>
                  <span className="rounded-full bg-slate-100 px-3 py-1">链接名片</span>
                  <span className="rounded-full bg-slate-100 px-3 py-1">聊天展示</span>
                </div>
              </div>
            </div>
          </section>

          <aside className="rounded-[32px] border border-white/16 bg-[linear-gradient(180deg,_rgba(8,17,33,0.56)_0%,_rgba(15,23,42,0.34)_100%)] p-6 shadow-[0_24px_60px_rgba(8,17,33,0.26)] backdrop-blur">
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-400/14 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-100">
              <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-emerald-300" />
              {copy.statusPill}
            </div>
            <div className="mt-5 text-2xl font-semibold leading-tight text-white">{copy.statusTitle}</div>
            <p className="mt-3 text-sm leading-6 text-slate-200/78">{copy.statusDescription}</p>

            <div className="mt-6 space-y-3">
              {copy.highlights.map((highlight, index) => (
                <div
                  key={`${highlight.title}-${index}`}
                  className="flex items-start gap-3 rounded-[22px] border border-white/10 bg-white/8 px-4 py-4"
                >
                  <div className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/12 text-sm font-semibold text-white">
                    {index + 1}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">{highlight.title}</div>
                    <div className="mt-1 text-xs leading-6 text-slate-200/74">{highlight.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
