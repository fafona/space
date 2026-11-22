"use client";
import { useI18n } from "@/components/I18nProvider";
import { MerchantCheckoutConfigurationPanel } from "@/components/checkout/MerchantCheckoutConfigurationPanel";

export default function CheckoutConfigurationClient({ siteId }: { siteId: string }) {
  const { locale } = useI18n();
  return <main className="min-h-screen bg-slate-50"><nav className="mx-auto max-w-6xl px-4 pt-4 text-sm text-slate-600"><a href={`/admin?scope=site-${siteId}`}>← {locale.startsWith("zh") ? "返回商户后台" : locale.startsWith("es") ? "Volver al panel" : "Back to merchant panel"}</a></nav>
    <MerchantCheckoutConfigurationPanel siteId={siteId} locale={locale}/></main>;
}
