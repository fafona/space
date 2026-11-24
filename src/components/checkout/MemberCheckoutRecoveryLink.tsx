"use client";
import { buildCheckoutResumeHref } from "@/lib/merchantCheckoutResumeClient";
import { merchantSettlementLanguage } from "@/lib/merchantSettlement";

const copy = {
  zh: { link: "只读核对本人原单", note: "只查询本账号的会员结算记录，不认领旧共享购物车。旧普通订单请到订单列表核对；此入口不清车、不释放原编号。" },
  en: { link: "View my original (read-only)", note: "Read this account’s member checkout records only; no shared cart is claimed. Check old regular orders in the order list. This link clears no cart or original reference." },
  es: { link: "Consultar mi original (solo lectura)", note: "Consulta solo los pagos de socio de tu cuenta, sin asignar el carrito compartido. Revisa los pedidos normales antiguos en su lista. No borra carritos ni referencias." },
};

/** Navigation only. Mounted after exact server discovery, not a purchase,
 * ownership, draft migration or permission to discard an unknown result. */
export function MemberCheckoutRecoveryLink({ siteId, locale }: { siteId: string; locale: string }) {
  let href: string;
  try { href = buildCheckoutResumeHref(siteId, locale); } catch { return null; }
  const t = copy[merchantSettlementLanguage(locale)];
  return <aside data-cart-recovery-entry className="min-w-0 shrink-0 space-y-1 border-t border-sky-100 bg-sky-50 px-3 py-2 text-slate-900 sm:px-5">
    <a data-checkout-resume-link href={href} target="_blank" rel="noopener noreferrer"
      className="inline-flex min-h-11 max-w-full items-center rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm font-semibold text-sky-900">{t.link}</a>
    <p className="text-xs leading-5 text-slate-600">{t.note}</p>
  </aside>;
}
