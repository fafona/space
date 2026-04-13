"use client";

import Image from "next/image";
import type { ReactNode } from "react";

type LoadingProgressScreenProps = {
  message?: string;
  locale?: string | null;
  statusTitle?: string;
  statusDescription?: string;
  children?: ReactNode;
};

type ContactPreviewItem = {
  key: string;
  value: string;
  iconSrc?: string;
  iconColor: string;
  iconClassName?: string;
  iconNode?: ReactNode;
};

function resolveWelcomeHeadline(locale?: string | null, fallback?: string) {
  const normalized = (locale ?? "").trim().toLowerCase();
  const byLanguage: Record<string, string> = {
    zh: "欢迎使用 FAOLLA 愿您生意兴隆！",
    ja: "FAOLLAへようこそ ご商売の繁盛をお祈りします！",
    ko: "FAOLLA에 오신 것을 환영합니다. 번창을 기원합니다!",
    en: "Welcome to FAOLLA. Wishing you a thriving business!",
    es: "Bienvenido a FAOLLA. ¡Que tu negocio prospere!",
    fr: "Bienvenue sur FAOLLA. Nous vous souhaitons une activité prospère !",
    de: "Willkommen bei FAOLLA. Viel Erfolg für Ihr Geschäft!",
    tr: "FAOLLA'ya hoş geldiniz. İşinizin gelişmesini dileriz!",
    it: "Benvenuto su FAOLLA. Ti auguriamo un'attività prospera!",
    pl: "Witamy w FAOLLA. Życzymy pomyślnego rozwoju Twojego biznesu!",
    uk: "Ласкаво просимо до FAOLLA. Бажаємо процвітання вашому бізнесу!",
    nl: "Welkom bij FAOLLA. We wensen je veel succes met je bedrijf!",
    ro: "Bine ai venit la FAOLLA. Îți dorim o afacere prosperă!",
    pt: "Bem-vindo à FAOLLA. Desejamos muito sucesso ao seu negócio!",
    ru: "Добро пожаловать в FAOLLA. Желаем процветания вашему бизнесу!",
    el: "Καλώς ήρθατε στη FAOLLA. Ευχόμαστε ευημερία στην επιχείρησή σας!",
    cs: "Vítejte ve FAOLLA. Přejeme vašemu podnikání mnoho úspěchů!",
    sv: "Välkommen till FAOLLA. Vi önskar ditt företag stor framgång!",
    hu: "Üdvözöljük a FAOLLA oldalán. Sok sikert kívánunk vállalkozásához!",
    be: "Сардэчна запрашаем у FAOLLA. Жадаем росквіту вашаму бізнесу!",
    bg: "Добре дошли във FAOLLA. Пожелаваме успех на вашия бизнес!",
    sr: "Dobro došli na FAOLLA. Želimo vam uspešno poslovanje!",
    da: "Velkommen til FAOLLA. Vi ønsker din forretning stor succes!",
    fi: "Tervetuloa FAOLLAan. Toivotamme yrityksellesi menestystä!",
    sk: "Vitajte vo FAOLLA. Prajeme vášmu podnikaniu veľa úspechov!",
    no: "Velkommen til FAOLLA. Vi ønsker bedriften din stor suksess!",
    hr: "Dobro došli u FAOLLA. Želimo vam uspješno poslovanje!",
    bs: "Dobro došli na FAOLLA. Želimo vam uspješno poslovanje!",
    sq: "Mirë se vini në FAOLLA. Ju urojmë mbarësi në biznesin tuaj!",
    lt: "Sveiki atvykę į FAOLLA. Linkime jūsų verslui klestėjimo!",
    sl: "Dobrodošli v FAOLLA. Želimo vam uspešno poslovanje!",
    lv: "Laipni lūdzam FAOLLA. Vēlam jūsu biznesam izaugsmi!",
    et: "Tere tulemast FAOLLA-sse. Soovime teie ettevõttele edu!",
    mk: "Добредојдовте во FAOLLA. Ви посакуваме успешен бизнис!",
    ca: "Benvingut a FAOLLA. Et desitgem molta prosperitat!",
    eu: "Ongi etorri FAOLLAra. Zure negozioari oparotasuna opa dizugu!",
    gl: "Benvido a FAOLLA. Desexámosche un negocio próspero!",
    cy: "Croeso i FAOLLA. Dymunwn fusnes lwyddiannus i chi!",
    is: "Velkomin til FAOLLA. Við óskum fyrirtækinu þínu mikillar velgengni!",
    ga: "Fáilte go FAOLLA. Guímid rath ar do ghnó!",
    mt: "Merħba f'FAOLLA. Nawguraw prosperità lin-negozju tiegħek!",
    lb: "Wëllkomm bei FAOLLA. Mir wënschen Ärem Geschäft vill Erfolleg!",
  };
  const subtag = normalized.split("-")[0] ?? "";
  return byLanguage[subtag] ?? fallback?.trim() ?? byLanguage.en;
}

function resolveQuickAccessTagline(locale?: string | null) {
  const normalized = (locale ?? "").trim().toLowerCase();
  const byLanguage: Record<string, string> = {
    zh: "电话、WhatsApp、TikTok、Twitter、地图，一键直达",
    ja: "電話、WhatsApp、TikTok、Twitter、地図へワンタップ",
    ko: "전화, WhatsApp, TikTok, Twitter, 지도까지 한 번에",
    en: "Call, WhatsApp, TikTok, Twitter, and maps in one tap",
    es: "Llamadas, WhatsApp, TikTok, Twitter y mapa, todo en un toque",
    fr: "Appels, WhatsApp, TikTok, Twitter et carte, tout en un geste",
    de: "Anruf, WhatsApp, TikTok, Twitter und Karte mit einem Klick",
    tr: "Arama, WhatsApp, TikTok, Twitter ve harita, tek dokunuşla",
    it: "Chiamate, WhatsApp, TikTok, Twitter e mappa, tutto in un tocco",
    pt: "Chamadas, WhatsApp, TikTok, Twitter e mapa, tudo em um toque",
    ru: "Звонок, WhatsApp, TikTok, Twitter и карта — в одно касание",
  };
  const subtag = normalized.split("-")[0] ?? "";
  return byLanguage[subtag] ?? byLanguage.en;
}

function PhoneGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-current">
      <path d="M6.62 10.79a15.45 15.45 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.01-.24c1.11.37 2.3.57 3.58.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.3 21 3 13.7 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.28.2 2.47.57 3.58a1 1 0 0 1-.24 1.01l-2.2 2.2Z" />
    </svg>
  );
}

function MapGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-current">
      <path d="M12 2a7 7 0 0 0-7 7c0 5.12 5.39 10.72 6.01 11.35a1.4 1.4 0 0 0 1.98 0C13.61 19.72 19 14.12 19 9a7 7 0 0 0-7-7Zm0 9.75A2.75 2.75 0 1 1 12 6.25a2.75 2.75 0 0 1 0 5.5Z" />
    </svg>
  );
}

export default function LoadingProgressScreen(props: LoadingProgressScreenProps) {
  const locale = (props.locale ?? "").trim().toLowerCase();
  const headline = resolveWelcomeHeadline(locale, props.statusTitle);
  const quickAccessTagline = resolveQuickAccessTagline(locale);
  const contactItems: ContactPreviewItem[] = [
    { key: "phone", value: "+34 633130577", iconColor: "#1B78FF", iconNode: <PhoneGlyph /> },
    { key: "whatsapp", value: "+34 633130577", iconSrc: "/social-icons/whatsapp.svg", iconColor: "#25D366" },
    { key: "tiktok", value: "@faolla", iconSrc: "/social-icons/tiktok.svg", iconColor: "#111827", iconClassName: "h-5 w-5 invert" },
    { key: "twitter", value: "@faolla", iconSrc: "/social-icons/twitter.svg", iconColor: "#111827", iconClassName: "h-5 w-5 invert" },
    { key: "map", value: "Sevilla / Spain", iconColor: "#F04A3A", iconNode: <MapGlyph /> },
  ];

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#081121]">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#091221_0%,#10203a_50%,#0f1a30_100%)]" />
      <div className="absolute inset-x-0 top-0 h-[24rem] bg-[radial-gradient(circle_at_top_left,_rgba(125,211,252,0.16),_transparent_48%)]" />
      <div className="absolute inset-x-0 top-0 h-[20rem] bg-[radial-gradient(circle_at_top_right,_rgba(45,212,191,0.1),_transparent_42%)]" />
      <div className="absolute inset-x-0 bottom-0 h-[12rem] bg-[linear-gradient(180deg,transparent_0%,rgba(6,12,24,0.34)_100%)]" />

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 sm:p-6">
        <div className="grid w-full max-w-[1620px] gap-4 lg:grid-cols-[minmax(0,1.08fr)_minmax(460px,0.92fr)] lg:gap-8">
          <div className="hidden rounded-[36px] border border-white/12 bg-[#0d1830]/92 p-8 text-white shadow-[0_24px_64px_rgba(8,17,33,0.22)] backdrop-blur-sm lg:flex lg:min-h-[470px] lg:flex-col lg:justify-between">
            <div className="inline-flex items-center gap-3 rounded-full border border-white/12 bg-white/8 px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.26em] text-cyan-50/88">
              <span className="h-2 w-2 rounded-full bg-emerald-300" />
              FAOLLA.COM
            </div>
            <div className="space-y-6">
              <div className="space-y-3">
                <div className="text-sm font-semibold uppercase tracking-[0.34em] text-cyan-50/62">FAOLLA</div>
                <div className="max-w-[34rem] text-4xl font-semibold leading-tight text-white">{headline}</div>
                <div className="text-xl font-medium text-cyan-50/78">{quickAccessTagline}</div>
              </div>
            </div>
          </div>

          <div className="hidden rounded-[36px] border border-white/18 bg-[rgba(247,250,255,0.985)] p-8 text-slate-900 shadow-[0_30px_70px_rgba(8,17,33,0.22)] backdrop-blur lg:flex lg:min-h-[470px] lg:flex-col">
            <div className="flex items-start justify-between gap-6">
              <div className="space-y-4">
                <div className="text-[15px] font-semibold uppercase tracking-[0.22em] text-slate-300">faolla</div>
                <div className="text-[54px] font-semibold leading-none tracking-tight text-slate-950">faolla</div>
                <div className="text-2xl font-medium text-slate-700">Felix</div>
              </div>
              <div className="flex h-[78px] w-[78px] items-center justify-center overflow-hidden rounded-[24px] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(235,244,255,0.88))] shadow-[0_18px_40px_rgba(15,23,42,0.12)]">
                <Image src="/faolla-app-icon-192.png" alt="" width={78} height={78} className="h-full w-full object-cover" unoptimized />
              </div>
            </div>
            <div className="mt-8 flex-1 space-y-5">
              {contactItems.map((item) => (
                <div key={item.key} className="flex items-center gap-4">
                  <div className="min-w-0 flex-1 text-[29px] font-medium tracking-[-0.015em] text-slate-700">{item.value}</div>
                  <span
                    className="inline-flex h-[56px] w-[56px] items-center justify-center rounded-full shadow-[0_14px_28px_rgba(15,23,42,0.14)]"
                    style={{ backgroundColor: item.iconColor, color: "#ffffff" }}
                  >
                    {item.iconSrc ? (
                      <img
                        src={item.iconSrc}
                        alt=""
                        className={
                          item.iconClassName
                            ? item.iconClassName.replace(/\bh-5\b/g, "h-7").replace(/\bw-5\b/g, "w-7")
                            : "h-7 w-7"
                        }
                      />
                    ) : (
                      item.iconNode
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[30px] border border-white/12 bg-[#0d1830]/94 p-5 text-white shadow-[0_24px_54px_rgba(8,17,33,0.24)] backdrop-blur lg:hidden">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-50/65">FAOLLA</div>
              <div className="mt-2 text-[26px] font-semibold leading-[1.15] text-white">{headline}</div>
              <div className="mt-3 text-[15px] font-medium leading-6 text-cyan-50/78">{quickAccessTagline}</div>
            </div>
            <div className="mt-5 rounded-[26px] border border-white/16 bg-[rgba(247,250,255,0.985)] p-4 text-slate-900 shadow-[0_22px_40px_rgba(8,17,33,0.2)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-300">faolla</div>
                  <div className="mt-2 text-[34px] font-semibold leading-none tracking-tight text-slate-950">faolla</div>
                  <div className="mt-2 text-lg font-medium text-slate-700">Felix</div>
                </div>
                <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-[18px] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(235,244,255,0.88))] shadow-[0_12px_24px_rgba(15,23,42,0.12)]">
                  <Image src="/faolla-app-icon-192.png" alt="" width={56} height={56} className="h-full w-full object-cover" unoptimized />
                </div>
              </div>
              <div className="mt-5 space-y-3">
                {contactItems.map((item) => (
                  <div key={item.key} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1 truncate text-[16px] font-medium text-slate-700">{item.value}</div>
                    <span
                      className="inline-flex h-11 w-11 items-center justify-center rounded-full shadow-[0_12px_24px_rgba(15,23,42,0.12)]"
                      style={{ backgroundColor: item.iconColor, color: "#ffffff" }}
                    >
                      {item.iconSrc ? (
                        <img src={item.iconSrc} alt="" className={item.iconClassName ?? "h-5 w-5"} />
                      ) : (
                        item.iconNode
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {props.children ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-4 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
          <div className="pointer-events-auto w-full max-w-md">{props.children}</div>
        </div>
      ) : null}
    </main>
  );
}
