"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/components/I18nProvider";
import { serviceRequest, SERVICE_IDENTITY_CHANGED, type ServiceIdentity } from "@/components/service-center/serviceCenterClient";
import { MemberCheckoutResumePanel } from "@/components/checkout/MemberCheckoutResumePanel";
import { buildServiceLoginHref } from "@/lib/merchantServiceLogin";
import { merchantSettlementLanguage } from "@/lib/merchantSettlement";
import { MemberCheckoutOriginalServicePanel } from "@/components/checkout/MemberCheckoutOriginalServicePanel";
const copy = {
  zh: { back: "返回商户", checking: "正在核验账号…", failed: "暂时无法核验账号，请重试。", retry: "重试", login: "请先登录本人账号查看结算原单。", signIn: "用户登录" },
  en: { back: "Back to merchant", checking: "Verifying account…", failed: "Account could not be verified.", retry: "Retry", login: "Sign in to view your own original checkout.", signIn: "Sign in" },
  es: { back: "Volver al comercio", checking: "Verificando cuenta…", failed: "No se pudo verificar la cuenta.", retry: "Reintentar", login: "Inicia sesión para consultar tu pago original.", signIn: "Iniciar sesión" },
};
export default function CheckoutResumeClient({ siteId, readOnly = false, originalServiceEnabled = false, serviceOperationKey }: { siteId: string; readOnly?: boolean; originalServiceEnabled?: boolean; serviceOperationKey?: string }) {
  const { locale } = useI18n(), t = copy[merchantSettlementLanguage(locale)], [accountId, setAccountId] = useState<string | null>(null), [ready, setReady] = useState(false), [failed, setFailed] = useState(false), [loginHref, setLoginHref] = useState("/login");
  const epoch = useRef(0), owned = useRef<AbortController | null>(null);
  const invalidate = useCallback(() => { epoch.current++; owned.current?.abort(); }, []);
  const clear = useCallback(() => { invalidate(); setAccountId(null); setReady(false); setFailed(false); }, [invalidate]);
  const check = useCallback(async () => {
    clear(); if (document.visibilityState === "hidden") return; const run = epoch.current, abort = new AbortController(); owned.current = abort;
    const timeout = setTimeout(() => abort.abort(), 12_000);
    try { const identity = await serviceRequest<ServiceIdentity>("/api/personal-favorites", { signal: abort.signal });
      if (run === epoch.current && !abort.signal.aborted) { setAccountId(identity.authenticated && /^\d{8}$/.test(identity.accountId) ? identity.accountId : null); setReady(true); }
      else if (run === epoch.current) setFailed(true);
    } catch { if (run === epoch.current) setFailed(true); } finally { clearTimeout(timeout); }
  }, [clear]);
  useEffect(() => {
    const first = setTimeout(() => { setLoginHref(buildServiceLoginHref(window.location.href)); void check(); }, 0);
    const focus = () => { void check(); }, visibility = () => document.visibilityState === "hidden" ? clear() : void check();
    const storage = (e: StorageEvent) => { if (e.key === null || /auth|account|session/i.test(e.key)) void check(); };
    window.addEventListener("focus", focus); window.addEventListener("pagehide", clear); window.addEventListener(SERVICE_IDENTITY_CHANGED, focus); window.addEventListener("storage", storage); document.addEventListener("visibilitychange", visibility);
    return () => { clearTimeout(first); invalidate(); window.removeEventListener("focus", focus); window.removeEventListener("pagehide", clear); window.removeEventListener(SERVICE_IDENTITY_CHANGED, focus); window.removeEventListener("storage", storage); document.removeEventListener("visibilitychange", visibility); };
  }, [check, clear, invalidate]);
  const button = "inline-flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm";
  return <main className="min-h-screen bg-slate-50"><nav className="mx-auto max-w-4xl px-5 pt-4"><Link href={`/site/${siteId}`} prefetch={false} className={button}>{t.back}</Link></nav>
    {ready ? accountId ? serviceOperationKey ? <MemberCheckoutOriginalServicePanel key={`${siteId}:${accountId}:${serviceOperationKey}`} siteId={siteId} accountId={accountId} operationKey={serviceOperationKey} locale={locale}/> : <MemberCheckoutResumePanel key={`${siteId}:${accountId}:${readOnly}`} siteId={siteId} accountId={accountId} locale={locale} readOnly={readOnly} originalServiceEnabled={originalServiceEnabled}/>
      : <section className="mx-auto max-w-4xl space-y-4 p-5"><p>{t.login}</p><a className={button} href={loginHref}>{t.signIn}</a></section>
      : <div role="status" className="mx-auto max-w-4xl space-y-3 p-5"><p>{failed ? t.failed : t.checking}</p>{failed && <button type="button" className={button} onClick={() => void check()}>{t.retry}</button>}</div>}
  </main>;
}
