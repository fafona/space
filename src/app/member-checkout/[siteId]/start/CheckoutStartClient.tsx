"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/components/I18nProvider";
import { serviceRequest, SERVICE_IDENTITY_CHANGED, type ServiceIdentity } from "@/components/service-center/serviceCenterClient";
import { MemberCheckoutStartPanel } from "@/components/checkout/MemberCheckoutStartPanel";
import type { CheckoutClientSelection } from "@/lib/merchantCheckoutClient";
import { buildServiceLoginHref } from "@/lib/merchantServiceLogin";

export default function CheckoutStartClient({ siteId, initialSelection }: { siteId: string; initialSelection: CheckoutClientSelection }) {
  const { locale } = useI18n(), [accountId, setAccountId] = useState<string | null>(null), [ready, setReady] = useState(false), [failed, setFailed] = useState(false);
  const sequence = useRef(0), [loginHref, setLoginHref] = useState("/login");
  const check = useCallback(async () => {
    const run = ++sequence.current; setAccountId(null); setReady(false); setFailed(false);
    try {
      const identity = await serviceRequest<ServiceIdentity>("/api/personal-favorites");
      if (run === sequence.current) { setAccountId(identity.authenticated && /^\d{8}$/.test(identity.accountId) ? identity.accountId : null); setReady(true); }
    } catch { if (run === sequence.current) setFailed(true); }
  }, []);
  const invalidate = useCallback(() => { ++sequence.current; }, []);
  useEffect(() => {
    const first = setTimeout(() => { setLoginHref(buildServiceLoginHref(window.location.href)); void check(); }, 0);
    const visible = () => { if (document.visibilityState === "visible") void check(); };
    window.addEventListener("focus", visible); window.addEventListener(SERVICE_IDENTITY_CHANGED, visible); document.addEventListener("visibilitychange", visible);
    return () => { clearTimeout(first); invalidate(); window.removeEventListener("focus", visible); window.removeEventListener(SERVICE_IDENTITY_CHANGED, visible); document.removeEventListener("visibilitychange", visible); };
  }, [check, invalidate]);
  const label = locale.startsWith("zh") ? failed ? "暂时无法核验账号，请重试。" : "正在核验账号…"
    : locale.startsWith("es") ? failed ? "No se pudo verificar la cuenta." : "Verificando cuenta…" : failed ? "Account could not be verified." : "Verifying account…";
  return <main className="min-h-screen bg-slate-50">
    <div className="mx-auto max-w-3xl px-5 pt-4"><Link href="/" prefetch={false} className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-800">{locale.startsWith("zh") ? "返回商户重新选择" : locale.startsWith("es") ? "Volver al comercio" : "Back to merchant"}</Link></div>
    {ready ? <MemberCheckoutStartPanel siteId={siteId} accountId={accountId} initialSelection={initialSelection} locale={locale} loginHref={loginHref}/>
      : <div role="status" className="mx-auto max-w-3xl space-y-3 p-6 text-sm text-slate-600"><p>{label}</p>{failed && <button type="button" className="min-h-11 rounded-xl border bg-white px-4" onClick={() => void check()}>{locale.startsWith("zh") ? "重试" : locale.startsWith("es") ? "Reintentar" : "Retry"}</button>}</div>}
  </main>;
}
