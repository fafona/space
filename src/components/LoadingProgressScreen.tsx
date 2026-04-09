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
  bgColor: string;
  iconKind: "phone" | "map" | "image";
  iconSrc?: string;
};

type LoadingContactRow = {
  label: string;
  value: string;
  action?: LoadingAction;
};

type LoadingCopy = {
  badge: string;
  heroSubtitle: string;
  statusTitle: string;
  statusLine: string;
  previewLabel: string;
  previewMerchant: string;
  previewContactName: string;
  previewRows: LoadingContactRow[];
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
    heroSubtitle: isChinese ? "电话、WhatsApp、TikTok、Twitter、地图，一步直达" : "Call, WhatsApp, TikTok, Twitter, and maps in one tap",
    statusTitle: props.statusTitle?.trim() || phase.title,
    statusLine: props.statusDescription === undefined ? phase.line : props.statusDescription.trim(),
    previewLabel: isChinese ? "名片预览" : "Card preview",
    previewMerchant: "faolla",
    previewContactName: "Felix",
    previewRows: isChinese
      ? [
          {
            label: "电话",
            value: "+34 633130577",
            action: { key: "phone", label: "拨号", bgColor: "#007AFF", iconKind: "phone" },
          },
          {
            label: "WhatsApp",
            value: "+34 633130577",
            action: {
              key: "whatsapp",
              label: "打开 WhatsApp",
              bgColor: "#25D366",
              iconKind: "image",
              iconSrc: "/social-icons/whatsapp.svg",
            },
          },
          {
            label: "TikTok",
            value: "@faolla",
            action: {
              key: "tiktok",
              label: "打开 TikTok",
              bgColor: "#161823",
              iconKind: "image",
              iconSrc: "/social-icons/tiktok.svg",
            },
          },
          {
            label: "Twitter",
            value: "@faolla",
            action: {
              key: "twitter",
              label: "打开 Twitter",
              bgColor: "#111827",
              iconKind: "image",
              iconSrc: "/social-icons/twitter.svg",
            },
          },
          {
            label: "地址",
            value: "Sevilla / Spain",
            action: { key: "map", label: "导航", bgColor: "#EA4335", iconKind: "map" },
          },
        ]
      : [
          {
            label: "Phone",
            value: "+34 633130577",
            action: { key: "phone", label: "Call", bgColor: "#007AFF", iconKind: "phone" },
          },
          {
            label: "WhatsApp",
            value: "+34 633130577",
            action: {
              key: "whatsapp",
              label: "Open WhatsApp",
              bgColor: "#25D366",
              iconKind: "image",
              iconSrc: "/social-icons/whatsapp.svg",
            },
          },
          {
            label: "TikTok",
            value: "@faolla",
            action: {
              key: "tiktok",
              label: "Open TikTok",
              bgColor: "#161823",
              iconKind: "image",
              iconSrc: "/social-icons/tiktok.svg",
            },
          },
          {
            label: "Twitter",
            value: "@faolla",
            action: {
              key: "twitter",
              label: "Open Twitter",
              bgColor: "#111827",
              iconKind: "image",
              iconSrc: "/social-icons/twitter.svg",
            },
          },
          {
            label: "Address",
            value: "Sevilla / Spain",
            action: { key: "map", label: "Navigate", bgColor: "#EA4335", iconKind: "map" },
          },
        ],
  };
}

function ActionIcon(props: { action: LoadingAction }) {
  if (props.action.iconKind === "image" && props.action.iconSrc) {
    return (
      <Image
        src={props.action.iconSrc}
        alt=""
        width={18}
        height={18}
        className="h-[18px] w-[18px] object-contain"
      />
    );
  }

  if (props.action.iconKind === "map") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[18px] w-[18px] fill-white">
        <path d="M12 2a7 7 0 0 0-7 7c0 4.74 6.14 11.84 6.4 12.14a.8.8 0 0 0 1.2 0C12.86 20.84 19 13.74 19 9a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[18px] w-[18px] fill-white">
      <path d="M6.62 10.79a15.53 15.53 0 0 0 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.4 21 3 13.6 3 4c0-.55.45-1 1-1h3.49c.55 0 1 .45 1 1 0 1.24.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.19 2.2z" />
    </svg>
  );
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

      <div className="mt-4 text-sm leading-6 text-slate-700">
        <div className="text-slate-900">联系人: {copy.previewContactName}</div>
      </div>

      <div className="mt-4 space-y-3">
        {copy.previewRows.map((row) => (
          <div key={`${row.label}-${row.value}`} className="flex items-center justify-between gap-3">
            <div className="min-w-0 text-sm leading-6 text-slate-700">
              <span className="font-medium text-slate-900">{row.label}: </span>
              <span className="break-all">{row.value}</span>
            </div>
            {row.action ? (
              <div
                aria-label={row.action.label}
                title={row.action.label}
                className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full shadow-[0_8px_20px_rgba(15,23,42,0.14)]"
                style={{ background: row.action.bgColor }}
              >
                <ActionIcon action={row.action} />
              </div>
            ) : null}
          </div>
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

      <div className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(env(safe-area-inset-top)+1rem)] sm:px-6 lg:px-8">
        <div className="inline-flex w-fit items-center gap-3 rounded-full border border-white/14 bg-white/10 px-4 py-2 text-xs font-medium uppercase tracking-[0.24em] text-cyan-50/90 backdrop-blur">
          <span className="inline-flex h-2 w-2 rounded-full bg-emerald-300" />
          {copy.badge}
        </div>

        <div className="flex flex-1 items-center py-4 sm:py-6">
          <div className="w-full rounded-[28px] border border-white/14 bg-[linear-gradient(180deg,_rgba(8,17,33,0.54)_0%,_rgba(15,23,42,0.34)_100%)] p-5 shadow-[0_24px_60px_rgba(8,17,33,0.26)] backdrop-blur sm:p-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] lg:gap-8 lg:items-center">
            <div>
              <div className="flex items-center gap-3">
                <div className="relative h-14 w-14 overflow-hidden rounded-[20px] border border-white/16 bg-white/14 shadow-[0_16px_40px_rgba(8,17,33,0.28)]">
                  <Image src="/faolla-login-logo.png" alt="Faolla logo" fill sizes="56px" className="object-cover" priority />
                </div>
                <div className="min-w-0">
                  <div className="text-xl font-semibold leading-tight text-white sm:text-2xl">{copy.statusTitle}</div>
                  {copy.statusLine ? <div className="mt-1 text-xs font-medium text-slate-200/74 sm:text-sm">{copy.statusLine}</div> : null}
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
