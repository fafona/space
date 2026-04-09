"use client";

import Image from "next/image";

type LoadingProgressScreenProps = {
  message?: string;
  locale?: string | null;
  statusTitle?: string;
  statusDescription?: string;
};

type LoadingAction = {
  key: string;
  label: string;
  accentClassName: string;
};

type LoadingCopy = {
  badge: string;
  heroTitle: string;
  heroSubtitle: string;
  statusTitle: string;
  statusLine: string;
  previewLabel: string;
  previewMerchant: string;
  previewMeta: string[];
  actionTitle: string;
  actions: LoadingAction[];
};

function isChineseLocale(locale?: string | null) {
  return (locale ?? "").trim().toLowerCase().startsWith("zh");
}

function resolvePhaseCopy(message: string, isChinese: boolean) {
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
          line: "网站 / 名片",
        }
      : {
          title: "Opening login",
          line: "Site / Cards",
        };
  }

  if (message.includes("加载站点")) {
    return isChinese
      ? {
          title: "加载品牌页面",
          line: "网站 / 名片资料",
        }
      : {
          title: "Loading branded page",
          line: "Site / Card details",
        };
  }

  return isChinese
    ? {
        title: "正在进入商户后台",
        line: "网站 / 名片 / 会话",
      }
    : {
        title: "Opening merchant workspace",
        line: "Site / Cards / Chat",
      };
}

function resolveLoadingCopy(props: LoadingProgressScreenProps): LoadingCopy {
  const message = (props.message ?? "").trim();
  const isChinese = isChineseLocale(props.locale);
  const phase = resolvePhaseCopy(message, isChinese);

  return {
    badge: "Faolla.com",
    heroTitle: isChinese ? "一张名片，连起网站与会话" : "One card for your site and chat",
    heroSubtitle: isChinese ? "电话、WhatsApp、地图，一步直达" : "Call, WhatsApp, and map in one tap",
    statusTitle: props.statusTitle?.trim() || phase.title,
    statusLine: props.statusDescription?.trim() || phase.line,
    previewLabel: isChinese ? "名片预览" : "Card preview",
    previewMerchant: "faolla",
    previewMeta: isChinese
      ? ["联系人: Felix", "电话: +34 633130577", "地址: Sevilla / Spain"]
      : ["Contact: Felix", "Phone: +34 633130577", "Sevilla / Spain"],
    actionTitle: isChinese ? "一键联系" : "Quick actions",
    actions: isChinese
      ? [
          { key: "phone", label: "电话", accentClassName: "from-cyan-400/24 to-blue-400/10" },
          { key: "whatsapp", label: "WhatsApp", accentClassName: "from-emerald-400/26 to-green-400/10" },
          { key: "map", label: "地图", accentClassName: "from-amber-300/26 to-orange-400/10" },
        ]
      : [
          { key: "phone", label: "Call", accentClassName: "from-cyan-400/24 to-blue-400/10" },
          { key: "whatsapp", label: "WhatsApp", accentClassName: "from-emerald-400/26 to-green-400/10" },
          { key: "map", label: "Map", accentClassName: "from-amber-300/26 to-orange-400/10" },
        ],
  };
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.6 4.9c.6-.6 1.6-.8 2.3-.4l2 1.1c.8.4 1.2 1.4.9 2.3l-.6 1.7a2 2 0 0 0 .5 2l1.9 1.9a2 2 0 0 0 2 .5l1.7-.6c.9-.3 1.9.1 2.3.9l1.1 2c.4.7.2 1.7-.4 2.3l-1 1c-1.2 1.2-3 1.7-4.7 1.2-3.6-1-7.1-4.5-8.1-8.1-.5-1.7 0-3.5 1.2-4.7z" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 11.6A8 8 0 0 1 8.4 19l-3.4.8.9-3.2A8 8 0 1 1 20 11.6z" />
      <path d="M9.2 8.9c.2-.4.4-.4.7-.4h.6c.2 0 .4 0 .5.4l.7 1.6c.1.3.1.4 0 .6l-.5.6c-.1.1-.2.3 0 .6.3.6 1.3 1.7 2.9 2.3.3.1.5 0 .6-.1l.7-.8c.2-.2.4-.2.6-.1l1.5.7c.3.1.5.2.5.4v.5c0 .3-.2.8-.6 1.2-.3.3-.8.5-1.5.5-1 0-2.3-.4-3.8-1.5-1.6-1.1-2.6-2.5-3-3.7-.4-1.1-.3-2 .1-2.8z" />
    </svg>
  );
}

function MapPinIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s6-5.5 6-11a6 6 0 1 0-12 0c0 5.5 6 11 6 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </svg>
  );
}

function ActionIcon(props: { actionKey: string }) {
  if (props.actionKey === "phone") return <PhoneIcon />;
  if (props.actionKey === "whatsapp") return <WhatsAppIcon />;
  return <MapPinIcon />;
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

      <div className="mt-5 rounded-[20px] border border-slate-200/80 bg-white/84 px-3 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.06)]">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{copy.actionTitle}</div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {copy.actions.map((action) => (
            <div
              key={action.key}
              className={`rounded-[18px] border border-slate-200/80 bg-gradient-to-br ${action.accentClassName} px-2 py-3 text-center text-slate-900`}
            >
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-[0_8px_18px_rgba(15,23,42,0.08)]">
                <ActionIcon actionKey={action.key} />
              </div>
              <div className="mt-2 text-[11px] font-semibold">{action.label}</div>
            </div>
          ))}
        </div>
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

      <div className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(env(safe-area-inset-top)+1rem)] sm:px-6 lg:px-8">
        <div className="inline-flex w-fit items-center gap-3 rounded-full border border-white/14 bg-white/10 px-4 py-2 text-xs font-medium uppercase tracking-[0.24em] text-cyan-50/90 backdrop-blur">
          <span className="inline-flex h-2 w-2 rounded-full bg-emerald-300" />
          {copy.badge}
        </div>

        <div className="flex flex-1 items-center py-4 sm:py-6">
          <div className="w-full rounded-[28px] border border-white/14 bg-[linear-gradient(180deg,_rgba(8,17,33,0.54)_0%,_rgba(15,23,42,0.34)_100%)] p-5 shadow-[0_24px_60px_rgba(8,17,33,0.26)] backdrop-blur sm:p-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)] lg:gap-8 lg:items-center">
            <div>
              <div className="flex items-center gap-3">
                <div className="relative h-14 w-14 overflow-hidden rounded-[20px] border border-white/16 bg-white/14 shadow-[0_16px_40px_rgba(8,17,33,0.28)]">
                  <Image src="/faolla-login-logo.png" alt="Faolla logo" fill sizes="56px" className="object-cover" priority />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100/76">Faolla</div>
                  <div className="mt-1 text-xl font-semibold leading-tight text-white sm:text-2xl">{copy.statusTitle}</div>
                  <div className="mt-1 text-xs font-medium text-slate-200/74 sm:text-sm">{copy.statusLine}</div>
                </div>
              </div>

              <div className="mt-4 text-sm leading-6 text-slate-100/78 sm:text-base">{copy.heroSubtitle}</div>

              <div className="mt-5 lg:hidden">
                <LoadingCardPreview copy={copy} />
              </div>
            </div>

            <div className="mt-5 hidden lg:block">
              <LoadingCardPreview copy={copy} />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
