"use client";
import { useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { FaollaMobileSettingsContent } from "@/components/FaollaMobileSettingsPages";
import { getFaollaMobileSettingsBackView, getFaollaMobileSettingsTitle, type FaollaMobileSettingsView, FAOLLA_MOBILE_LEGAL_KEY_TO_VIEW } from "@/components/FaollaMobileSettingsViews";
import { LANGUAGE_OPTIONS } from "@/lib/i18n";
import { FAOLLA_LEGAL_DOCUMENTS } from "@/lib/faollaLegalContent";
import { useFaollaAndroidAppUpdate } from "@/lib/useFaollaAndroidAppUpdate";
import { serviceButton, serviceCard, serviceInput } from "./serviceCenterClient";

export default function ServiceAccountSettings({ onLocaleChange }: { onLocaleChange?: (locale: string) => void }) {
  const [view, setView] = useState<FaollaMobileSettingsView>("settings");
  const { locale, setLocale } = useI18n();
  const update = useFaollaAndroidAppUpdate({ enabled: view === "settings-update" });
  return <div className="space-y-4" data-service-account-settings>
    {view !== "settings" ? <div className="flex items-center gap-3"><button type="button" className={serviceButton} onClick={() => { const back = getFaollaMobileSettingsBackView(view); setView(back === "home" ? "settings" : back); }}>← 返回设置上级</button><h4 className="text-sm font-semibold">{getFaollaMobileSettingsTitle(view)}</h4></div> : <section className={serviceCard}>
      <label className="block text-sm font-semibold" htmlFor="service-account-language">界面语言</label><p className="mb-3 mt-1 text-xs text-slate-500">同步切换商户网页和服务中心的语言。</p>
      <select id="service-account-language" className={serviceInput} data-no-translate="1" value={locale} onChange={event => { setLocale(event.target.value); onLocaleChange?.(event.target.value); }}>{LANGUAGE_OPTIONS.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}</select>
    </section>}
    <FaollaMobileSettingsContent view={view} notificationSummary="系统通知、提示音和震动设置" appUpdateState={update} onViewChange={setView} notificationContent={<section className={serviceCard + " space-y-3"}>
      <h4 className="font-semibold">通知</h4><p className="text-sm leading-6 text-slate-500">个人用户通知设置尚未接入；保留原有入口，暂不可配置。</p>
      {["系统消息通知", "消息提示音", "震动"].map(label => <div key={label} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 text-sm"><span>{label}</span><button type="button" role="switch" aria-label={label} aria-checked={false} disabled className="rounded-full bg-slate-200 px-3 py-1 text-xs text-slate-600">暂未开启</button></div>)}
    </section>} />
    {view === "settings" ? <section className={serviceCard}><h4 className="mb-3 text-sm font-semibold">法律文件</h4><div className="flex flex-wrap gap-2">{FAOLLA_LEGAL_DOCUMENTS.map(document => <button type="button" key={document.key} className={serviceButton} onClick={() => setView(FAOLLA_MOBILE_LEGAL_KEY_TO_VIEW[document.key])}>{document.title}</button>)}</div></section> : null}
  </div>;
}
