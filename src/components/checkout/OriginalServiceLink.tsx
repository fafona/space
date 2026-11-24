import { originalServiceHref } from "@/lib/merchantCheckoutOriginalService";
import { merchantSettlementLanguage } from "@/lib/merchantSettlement";
/** Navigation only; servicing page/API independently verify identity/scope. */
export function OriginalServiceLink({ enabled, siteId, operationKey, locale }: { enabled: boolean; siteId: string; operationKey: string; locale: string }) {
  if (!enabled) return null;
  return <a data-original-service-link target="_blank" rel="noopener noreferrer" href={originalServiceHref(siteId, operationKey, locale)} className="inline-flex min-h-11 items-center rounded-xl border border-teal-200 bg-white px-4 py-3 text-sm font-semibold text-teal-800">
    {merchantSettlementLanguage(locale) === "zh" ? "查看／处理原单" : merchantSettlementLanguage(locale) === "es" ? "Consultar / gestionar original" : "View / manage original"}
  </a>;
}
