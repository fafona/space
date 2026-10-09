"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { merchantEnterpriseSupabase as supabase, isEnterpriseLogoutBlocked, onEnterpriseAuthStateChange } from "@/lib/merchantEnterpriseSupabase";
import { boundedDelegationRecoveryAuth, DELEGATION_RECOVERY_AUTH_TIMEOUT_MS } from "@/lib/merchantAttendanceDelegationRecovery";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import MerchantAttendanceAdministrativeClosurePanel from "./MerchantAttendanceAdministrativeClosurePanel";
type Auth = { userId: string; token: string; generation: number };
type Session = { access_token: string; user: { id: string } } | null;
export default function MerchantAttendanceAdministrativeClosurePage() {
  const [auth, setAuth] = useState<Auth | null>(null), [checking, setChecking] = useState(true), [reload, setReload] = useState(0);
  const generation = useRef(0), currentAuth = useRef<Auth | null>(null), leave = useRef<(() => boolean) | null>(null);
  const registerLeaveGuard = useCallback((value: (() => boolean) | null) => { leave.current = value; }, []);
  const invalidate = useCallback(() => { currentAuth.current = null; return ++generation.current; }, []);
  useEffect(() => { let active = true;
    const apply = (session: Session, timeoutMs = DELEGATION_RECOVERY_AUTH_TIMEOUT_MS) => {
      const epoch = invalidate(); setAuth(null); setChecking(true);
      const run = async () => { try { if (!session || isEnterpriseLogoutBlocked()) return;
        const result = await boundedDelegationRecoveryAuth(() => supabase.auth.getUser(session.access_token), timeoutMs);
        if (!active || generation.current !== epoch || isEnterpriseLogoutBlocked() || result.error || result.data.user?.id !== session.user.id) return;
        const next = { userId: result.data.user.id, token: session.access_token, generation: epoch }; currentAuth.current = next; setAuth(next);
      } catch { /* No local identifiers disclosed before actual Auth validation. */ }
      finally { if (active && generation.current === epoch) setChecking(false); } };
      queueMicrotask(() => { if (active && generation.current === epoch) void run(); });
    };
    const initial = invalidate(), started = performance.now(); setAuth(null); setChecking(true);
    const listener = onEnterpriseAuthStateChange((_event, session) => { if (active) apply(session); });
    void boundedDelegationRecoveryAuth(() => supabase.auth.getSession()).then(result => {
      if (active && generation.current === initial) apply(result.error ? null : result.data.session, DELEGATION_RECOVERY_AUTH_TIMEOUT_MS - (performance.now() - started));
    }, () => { if (active && generation.current === initial) apply(null); });
    return () => { active = false; invalidate(); listener.data.subscription.unsubscribe(); };
  }, [reload, invalidate]);
  const isCurrentAuth = useCallback(() => Boolean(auth && currentAuth.current === auth && generation.current === auth.generation && !isEnterpriseLogoutBlocked()), [auth]);
  const apiFetch: AttendanceApiFetch = useCallback((path, init) => {
    if (!auth || !isCurrentAuth()) return Promise.reject(Error("authentication_changed"));
    const headers = new Headers(init?.headers); headers.set("x-merchant-access-token", auth.token);
    return fetch(path, { ...init, headers, credentials: "omit", cache: "no-store", redirect: "error" });
  }, [auth, isCurrentAuth]);
  return <main className="mx-auto min-h-screen max-w-3xl space-y-5 px-4 py-8 text-slate-900">
    <h1 className="text-2xl font-bold">本人行政结案记录与异议</h1>
    <p className="text-sm leading-6">账号被企业暂停或已经结束任职后，仍可用本人密码账户读取保存给本人的行政记录、提出异议及核验原编号。不会恢复账号，不需要打卡权限，也不会代他人查询。身份已换绑时，旧正文不会交给新账号。</p>
    {checking ? <p role="status">正在验证当前真实登录身份…</p> : auth ? <Selection key={auth.generation} authUserId={auth.userId} apiFetch={apiFetch} isCurrentAuth={isCurrentAuth} registerLeaveGuard={registerLeaveGuard}/>
      : <p role="alert">请使用本人原密码账户登录。此页不接受员工身份编号，不从本地缓存猜测身份。</p>}
    <nav className="flex flex-wrap gap-3 text-sm" aria-label="行政记录页面导航"><Link className="rounded-xl border px-4 py-3" href="/enterprise" onClick={event => { if (leave.current && !leave.current()) event.preventDefault(); }}>返回企业登录／选择企业</Link>
      <button type="button" className="rounded-xl border px-4 py-3" disabled={checking} onClick={() => { if (leave.current && !leave.current()) return; invalidate(); setAuth(null); setChecking(true); setReload(v => v + 1); }}>重新验证登录</button></nav>
  </main>;
}
function Selection({ authUserId, apiFetch, isCurrentAuth, registerLeaveGuard }: { authUserId: string; apiFetch: AttendanceApiFetch; isCurrentAuth: () => boolean; registerLeaveGuard: (guard: (() => boolean) | null) => void }) {
  const [site, setSite] = useState(""), [selected, setSelected] = useState<string | null>(null);
  return selected ? <MerchantAttendanceAdministrativeClosurePanel key={selected} siteId={selected} access="self" authUserId={authUserId} apiFetch={apiFetch} isCurrentAuth={isCurrentAuth}
    enabled={false} registerLeaveGuard={registerLeaveGuard} onClose={() => setSelected(null)}/>
    : <form className="space-y-3 rounded-xl border bg-white p-4" onSubmit={event => { event.preventDefault(); if (isCurrentAuth() && site.length === 8 && /^[0-9]{8}$/.test(site)) setSelected(site); }}>
      <label className="block text-sm">商户编号（8位数字）<input className="mt-2 block w-full rounded-xl border p-3" aria-label="行政记录商户编号" inputMode="numeric" maxLength={8} autoComplete="off" value={site} onChange={e => setSite(e.target.value)}/></label>
      <p className="text-sm">选择后仅检查此商户与当前真实账号的本地原槽。服务端列表仍需下一步明确读取；不会自动提交。</p>
      <button type="submit" className="rounded-xl border px-4 py-3 disabled:opacity-40" disabled={site.length !== 8 || !/^[0-9]{8}$/.test(site)}>打开本人行政记录</button>
    </form>;
}
