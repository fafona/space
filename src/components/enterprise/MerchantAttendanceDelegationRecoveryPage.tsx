"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { merchantEnterpriseSupabase as supabase, isEnterpriseLogoutBlocked, onEnterpriseAuthStateChange } from "@/lib/merchantEnterpriseSupabase";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { boundedDelegationRecoveryAuth, DELEGATION_RECOVERY_AUTH_TIMEOUT_MS } from "@/lib/merchantAttendanceDelegationRecovery";
import MerchantAttendanceDelegationRecoveryPanel from "./MerchantAttendanceDelegationRecoveryPanel";

type Auth = { userId: string; token: string; generation: number };
type Session = { access_token: string; user: { id: string } } | null;
export default function MerchantAttendanceDelegationRecoveryPage() {
  const [auth, setAuth] = useState<Auth | null>(null), [checking, setChecking] = useState(true), [reload, setReload] = useState(0);
  const generation = useRef(0), currentAuth = useRef<Auth | null>(null);
  const invalidateAuth = useCallback(() => { currentAuth.current = null; return ++generation.current; }, []);
  useEffect(() => {
    let active = true;
    const apply = (session: Session, timeoutMs = DELEGATION_RECOVERY_AUTH_TIMEOUT_MS) => {
      const epoch = invalidateAuth(); setAuth(null); setChecking(true);
      const run = async () => {
        try {
          if (!session || isEnterpriseLogoutBlocked()) return;
          // getSession is local state; validate identity before disclosing even
          // local pending IDs. The recovery API validates real auth again.
          const result = await boundedDelegationRecoveryAuth(() => supabase.auth.getUser(session.access_token), timeoutMs);
          if (!active || generation.current !== epoch || isEnterpriseLogoutBlocked() || result.error || result.data.user?.id !== session.user.id) return;
          const next = { userId: result.data.user.id, token: session.access_token, generation: epoch };
          currentAuth.current = next; setAuth(next);
        } catch { /* Authentication failures reveal no local identifiers. */ }
        finally { if (active && generation.current === epoch) setChecking(false); }
      };
      // Do not await Supabase methods inside its auth notification callback.
      queueMicrotask(() => { if (active && generation.current === epoch) void run(); });
    };
    const initial = invalidateAuth(), startedAt = performance.now(); setAuth(null); setChecking(true);
    const listener = onEnterpriseAuthStateChange((_event, session) => { if (active) apply(session); });
    void boundedDelegationRecoveryAuth(() => supabase.auth.getSession()).then(result => {
      if (active && generation.current === initial) apply(result.error ? null : result.data.session,
        DELEGATION_RECOVERY_AUTH_TIMEOUT_MS - (performance.now() - startedAt));
    }, () => { if (active && generation.current === initial) apply(null); });
    return () => { active = false; invalidateAuth(); listener.data.subscription.unsubscribe(); };
  }, [reload, invalidateAuth]);
  const isCurrentAuth = useCallback(() => Boolean(auth && currentAuth.current === auth && generation.current === auth.generation && !isEnterpriseLogoutBlocked()), [auth]);
  const apiFetch: AttendanceApiFetch = useCallback((path, init) => {
    if (!auth || !isCurrentAuth()) return Promise.reject(Error("authentication_changed"));
    const headers = new Headers(init?.headers); headers.set("x-merchant-access-token", auth.token);
    return fetch(path, { ...init, headers, credentials: "omit", cache: "no-store", redirect: "error" });
  }, [auth, isCurrentAuth]);
  return <main className="mx-auto min-h-screen max-w-2xl space-y-5 px-4 py-8 text-slate-900">
    <h1 className="text-2xl font-bold">核对未确认考勤操作</h1>
    <p className="text-sm leading-6 text-slate-600">查看权限被撤销后，这里仍可核对原账号的已知委托、企业账号状态及任职结束／再入职操作结果。不能在这里授予权限、审批、停用／恢复账号、办理任职、解除考勤暂停或代他人查询。</p>
    {checking ? <p role="status">正在验证当前登录身份…</p> : auth
      ? <MerchantAttendanceDelegationRecoveryPanel key={auth.generation} authUserId={auth.userId} apiFetch={apiFetch} isCurrentAuth={isCurrentAuth}/>
      : <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm leading-6">当前没有可核验的员工登录身份。请在本标签页返回企业登录，使用原账号密码登录后，再打开此入口。身份换绑或无法登录时请联系负责人。</p>}
    <nav className="flex flex-wrap gap-3 text-sm" aria-label="恢复页面导航">
      <Link className="rounded-xl border px-4 py-3" href="/enterprise/attendance-owner-notifications-recovery">核对负责人通知已读结果</Link>
      <Link className="rounded-xl border px-4 py-3" href="/enterprise">返回企业登录／选择企业</Link>
      <button type="button" className="rounded-xl border px-4 py-3" disabled={checking} onClick={() => { invalidateAuth(); setAuth(null); setChecking(true); setReload(v => v + 1); }}>重新验证登录</button>
    </nav>
  </main>;
}
