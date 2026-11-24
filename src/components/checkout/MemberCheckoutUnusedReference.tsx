"use client";
import { useState, useSyncExternalStore } from "react";
import { merchantSettlementLanguage } from "@/lib/merchantSettlement";
import type { UnusedReferenceActions, UnusedReferenceView } from "@/lib/merchantCheckoutBoundClient";
import type { CheckoutDraftReleaseCheck } from "@/lib/merchantCheckoutDraftLease";
import type { UnusedReferenceReview } from "@/lib/merchantCheckoutUnusedReference";

type Port = UnusedReferenceActions & { getSnapshot(): UnusedReferenceView & { phase: string; pending: boolean; original?: unknown; originalReview?: unknown }; subscribe(fn: () => void): () => void };
const copy = {
  zh: { title: "安全继续", note: "先检查这次提交。只有尚未成单时才能关闭本次编号；关闭后会阻止迟到提交，购物车、会员和填写内容均保留。已有原单不能在这里取消。", check: "检查这次提交", working: "正在核对…", unused: "这次编号尚未成单，可以选择关闭它，再重新核对内容。", closed: "服务器已关闭这次编号；本机引用仍保留，确认后可安全继续。", agree: "关闭这次未成单编号，保留购物车、会员及填写内容", close: "关闭未成单编号并继续", unbound: "这个旧编号没有可靠的原身份绑定，已保留。请继续核对原单；不会补造绑定或清空内容。", draft: "购物车已变化、缺失或暂时无法读取，编号和已有内容均保留。请先核对原购物车。", failed: "暂时无法确认，请重新检查。编号已保留，不会重复提交或扣减。" },
  en: { title: "Continue safely", note: "Check this attempt first. Only an uncommitted reference can be closed. Closing blocks late submission and keeps your cart, membership and form. It does not cancel an existing original.", check: "Check this attempt", working: "Checking…", unused: "This reference has not created an original. You may close it, then review your details again.", closed: "The server closed this reference. Its local reference is kept until you confirm continuing.", agree: "Close this uncommitted reference and keep my cart, membership and form", close: "Close unused reference & continue", unbound: "This older reference has no reliable original-identity binding and is kept. Continue checking its original; no binding is invented and nothing is cleared.", draft: "The cart changed, is missing or cannot be read. Its reference and existing content are kept. Check the original cart first.", failed: "This could not be confirmed. Check again. The reference is kept; nothing is resubmitted or debited again." },
  es: { title: "Continuar con seguridad", note: "Comprueba este intento primero. Solo se puede cerrar una referencia sin pedido. El cierre impide envíos tardíos y conserva el carrito, la membresía y el formulario. No cancela un pedido existente.", check: "Comprobar este intento", working: "Comprobando…", unused: "Esta referencia no ha creado un pedido. Puedes cerrarla y volver a revisar los datos.", closed: "El servidor cerró esta referencia. La referencia local se conserva hasta que confirmes continuar.", agree: "Cerrar esta referencia sin pedido y conservar el carrito, la membresía y el formulario", close: "Cerrar referencia sin pedido y continuar", unbound: "Esta referencia antigua no tiene una vinculación fiable con la identidad original y se conserva. Sigue consultando el original; no se inventa una vinculación ni se borra nada.", draft: "El carrito cambió, falta o no se puede leer. Se conservan la referencia y el contenido. Revisa primero el carrito original.", failed: "No se pudo confirmar. Comprueba de nuevo. Se conserva la referencia; no se reenvía ni descuenta otra vez." },
};
export function MemberCheckoutUnusedReference({ controller, ...props }: { controller: unknown; locale: string; verifyDraft?: CheckoutDraftReleaseCheck; onReleased?: () => void }) {
  if (!controller || typeof controller !== "object" || !("reviewUnused" in controller) || typeof controller.reviewUnused !== "function" || !("closeUnused" in controller) || typeof controller.closeUnused !== "function") return null;
  return <Active controller={controller as Port} {...props}/>;
}
function Active({ controller, locale, verifyDraft, onReleased }: { controller: Port; locale: string; verifyDraft?: CheckoutDraftReleaseCheck; onReleased?: () => void }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot), t = copy[merchantSettlementLanguage(locale)], [agreedReview, setAgreedReview] = useState<UnusedReferenceReview | null>(null);
  // Agreement belongs to this exact read, not a coincidentally equal hash on
  // a later check. A new review invalidates it without an effect-driven reset.
  const review = state.unusedReferenceReview, busy = state.unusedReferenceBusy === true, agreed = !!review && agreedReview === review;
  if ((!state.pending || state.phase !== "unconfirmed" || state.original || state.originalReview) && !busy) return null;
  const message = state.unusedReferenceError === "checkout_reference_unbound" ? t.unbound : state.unusedReferenceError === "checkout_draft_unconfirmed" ? t.draft : state.unusedReferenceError ? t.failed : "";
  const button = "min-h-11 rounded-xl border border-teal-200 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-50";
  return <aside data-unused-reference className="space-y-3 rounded-2xl border border-teal-200 bg-teal-50 p-4 text-sm leading-6">
    <h2 className="font-semibold">{t.title}</h2><p>{t.note}</p>{message && <p role="alert">{message}</p>}
    <button type="button" className={button} disabled={busy} onClick={() => { setAgreedReview(null); void controller.reviewUnused(); }}>{busy ? t.working : t.check}</button>
    {review && review.state !== "original" && <div className="space-y-3"><p role="status">{review.state === "closed" ? t.closed : t.unused}</p>
      <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-teal-700" checked={agreed} disabled={busy} onChange={e => setAgreedReview(e.target.checked ? review : null)}/><span>{t.agree}</span></label>
      <button type="button" className={button + " w-full !bg-teal-800 !text-white"} disabled={busy || !agreed} onClick={() => {
        setAgreedReview(null); void controller.closeUnused(true, verifyDraft).then(() => { const next = controller.getSnapshot(); if (next.phase === "idle" && !next.pending) onReleased?.(); });
      }}>{t.close}</button>
    </div>}
  </aside>;
}
