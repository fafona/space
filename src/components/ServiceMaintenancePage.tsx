"use client";

import { OFFICIAL_SERVICE_CONTACT, describeMerchantMaintenanceMessage, type MerchantServiceRestrictionReason } from "@/lib/merchantServiceStatus";

type ServiceMaintenancePageProps = {
  merchantName?: string | null;
  title?: string;
  reason?: MerchantServiceRestrictionReason;
  description?: string;
};

export default function ServiceMaintenancePage({
  merchantName,
  title = "服务维护中",
  reason = null,
  description,
}: ServiceMaintenancePageProps) {
  const displayName = String(merchantName ?? "").trim();
  const resolvedDescription = String(description ?? "").trim() || describeMerchantMaintenanceMessage(reason);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(255,255,255,.96),_rgba(247,239,227,1)_58%,_rgba(229,218,200,1))] px-5 py-10 text-slate-900 sm:px-6">
      <section className="mx-auto w-full max-w-2xl rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-[0_28px_90px_rgba(15,23,42,.12)] backdrop-blur sm:p-8">
        <div className="text-xs font-medium uppercase tracking-[0.24em] text-slate-400">FAOLLA SERVICE</div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {displayName ? <div className="mt-2 text-lg font-medium text-slate-700">{displayName}</div> : null}
        <p className="mt-4 text-sm leading-7 text-slate-600">{resolvedDescription}</p>

        <div className="mt-6 rounded-[28px] border border-slate-200 bg-slate-50 p-6 shadow-[0_16px_42px_rgba(15,23,42,.08)]">
          <div className="text-base font-semibold text-slate-900">官方联系方式</div>
          <div className="mt-4 space-y-3 text-sm leading-7 text-slate-700">
            <div>
              服务商：
              <a
                className="font-medium text-slate-900 underline underline-offset-4"
                href={OFFICIAL_SERVICE_CONTACT.serviceProviderUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                www.faolla.com
              </a>
            </div>
            <div>联系人：{OFFICIAL_SERVICE_CONTACT.contactName}</div>
            <div>
              WhatsApp：
              <a
                className="font-medium text-slate-900 underline underline-offset-4"
                href={`https://wa.me/${OFFICIAL_SERVICE_CONTACT.whatsapp.replace(/[^\d]/g, "")}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {OFFICIAL_SERVICE_CONTACT.whatsapp}
              </a>
            </div>
            <div>Wechat：{OFFICIAL_SERVICE_CONTACT.wechat}</div>
            <div>
              Mail：
              <a className="font-medium text-slate-900 underline underline-offset-4" href={`mailto:${OFFICIAL_SERVICE_CONTACT.email}`}>
                {OFFICIAL_SERVICE_CONTACT.email}
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
