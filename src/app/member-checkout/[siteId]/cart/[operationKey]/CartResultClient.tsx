"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { serviceRequest, SERVICE_IDENTITY_CHANGED, type ServiceIdentity } from "@/components/service-center/serviceCenterClient";
import { MemberCartResultPanel } from "@/components/checkout/MemberCartResultPanel";
import { buildServiceLoginHref } from "@/lib/merchantServiceLogin";
export default function CartResultClient({ siteId, operationKey }: { siteId: string; operationKey: string }) {
  const { locale } = useI18n(), [identity, setIdentity] = useState<string | null>(null), [ready, setReady] = useState(false), [failed, setFailed] = useState(false), [loginHref, setLoginHref] = useState("/login");
  const epoch = useRef(0);
  const invalidate = useCallback(() => { ++epoch.current; }, []);
  const check = useCallback(async () => {
    const run = ++epoch.current; setIdentity(null); setReady(false); setFailed(false);
    try { const result = await serviceRequest<ServiceIdentity>("/api/personal-favorites"); if (run === epoch.current) { setIdentity(result.authenticated ? result.accountId : null); setReady(true); } }
    catch { if (run === epoch.current) setFailed(true); }
  }, []);
  useEffect(() => {
    const clear = () => { invalidate(); setIdentity(null); setReady(false); setFailed(false); };
    const visible = () => { if (document.visibilityState === "hidden") clear(); else void check(); };
    const first = setTimeout(() => { setLoginHref(buildServiceLoginHref(window.location.href)); void check(); }, 0);
    window.addEventListener("focus", visible); window.addEventListener(SERVICE_IDENTITY_CHANGED, visible); document.addEventListener("visibilitychange", visible);
    return () => { invalidate(); clearTimeout(first); window.removeEventListener("focus", visible); window.removeEventListener(SERVICE_IDENTITY_CHANGED, visible); document.removeEventListener("visibilitychange", visible); };
  }, [check, invalidate]);
  return <main className="min-h-screen bg-slate-50">{ready ? <MemberCartResultPanel siteId={siteId} operationKey={operationKey} identityKey={identity} locale={locale} loginHref={loginHref}/>
    : <div role="status" className="mx-auto max-w-4xl space-y-3 p-6 text-sm"><p>{locale.startsWith("zh") ? failed ? "暂时无法核验账号，请重试。" : "正在核验账号…" : locale.startsWith("es") ? failed ? "No se pudo verificar la cuenta." : "Verificando cuenta…" : failed ? "Account could not be verified." : "Verifying account…"}</p>
      {failed && <button className="min-h-11 rounded-xl border bg-white px-4" onClick={() => void check()}>{locale.startsWith("zh") ? "重试" : locale.startsWith("es") ? "Reintentar" : "Retry"}</button>}</div>}</main>;
}
