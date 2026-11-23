"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { serviceRequest, SERVICE_IDENTITY_CHANGED, type ServiceIdentity } from "@/components/service-center/serviceCenterClient";
import { MemberCheckoutResultPanel } from "@/components/checkout/MemberCheckoutResultPanel";
import { MemberOnSiteResultPanel } from "@/components/checkout/MemberOnSiteResultPanel";
import { buildServiceLoginHref } from "@/lib/merchantServiceLogin";
export default function CheckoutResultClient({ siteId, operationKey, onSite = false }: { siteId: string; operationKey: string; onSite?: boolean }) {
  const { locale } = useI18n(), [identity, setIdentity] = useState<string | null>(null), [ready, setReady] = useState(false), [failed, setFailed] = useState(false);
  const sequence = useRef(0), [loginHref, setLoginHref] = useState("/login?accountType=personal");
  const check = useCallback(async () => {
    const run = ++sequence.current; setIdentity(null); setReady(false); setFailed(false);
    try { const result = await serviceRequest<ServiceIdentity>("/api/personal-favorites");
      if (run === sequence.current) { setIdentity(result.authenticated ? result.accountId : null); setReady(true); }
    } catch { if (run === sequence.current) setFailed(true); }
  }, []);
  const invalidate = useCallback(() => { ++sequence.current; }, []);
  useEffect(() => {
    const first = setTimeout(() => { setLoginHref(buildServiceLoginHref(window.location.href)); void check(); }, 0);
    const focus = () => { if (document.visibilityState === "visible") void check(); };
    window.addEventListener("focus", focus); window.addEventListener(SERVICE_IDENTITY_CHANGED, focus); document.addEventListener("visibilitychange", focus);
    return () => { clearTimeout(first); invalidate(); window.removeEventListener("focus", focus); window.removeEventListener(SERVICE_IDENTITY_CHANGED, focus); document.removeEventListener("visibilitychange", focus); };
  }, [check, invalidate]);
  return <main className="min-h-screen bg-slate-50">
    {ready ? onSite ? <MemberOnSiteResultPanel siteId={siteId} operationKey={operationKey} identityKey={identity} locale={locale} loginHref={loginHref}/> : <MemberCheckoutResultPanel siteId={siteId} operationKey={operationKey} identityKey={identity} locale={locale} loginHref={loginHref}/>
      : <div role="status" className="mx-auto max-w-3xl space-y-3 p-6 text-sm text-slate-600"><p>{locale.startsWith("zh") ? failed ? "暂时无法核验账号，请重试。" : "正在核验账号…" : locale.startsWith("es") ? failed ? "No se pudo verificar la cuenta." : "Verificando cuenta…" : failed ? "Account could not be verified." : "Verifying account…"}</p>
        {failed && <button type="button" className="min-h-11 rounded-xl border bg-white px-4" onClick={() => void check()}>{locale.startsWith("zh") ? "重试" : locale.startsWith("es") ? "Reintentar" : "Retry"}</button>}</div>}
  </main>;
}
