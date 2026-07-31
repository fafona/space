"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MerchantEnterpriseManager from "@/components/admin/MerchantEnterpriseManager";
import { merchantEnterpriseSupabase as supabase } from "@/lib/merchantEnterpriseSupabase";

type InvitationCredential = {
  invitationVersion: number;
  invitationToken: string;
};

async function acceptEnterpriseMembership(
  siteId: string,
  accessToken: string,
  invitation: InvitationCredential | null,
) {
  const response = await fetch("/api/merchant-enterprise/employees/accept", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-merchant-access-token": accessToken,
    },
    credentials: "omit",
    cache: "no-store",
    body: JSON.stringify({
      siteId,
      ...(invitation
        ? {
            invitationVersion: invitation.invitationVersion,
            invitationToken: invitation.invitationToken,
          }
        : {}),
    }),
  });
  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
  } | null;
  if (response.ok && payload?.ok) return;
  if (payload?.error === "enterprise_management_disabled") {
    throw new Error("当前企业尚未开通企业管理。");
  }
  if (payload?.error === "merchant_employee_not_invited") {
    throw new Error("该账号没有收到此企业的员工邀请。");
  }
  if (payload?.error === "merchant_access_denied") {
    throw new Error("邀请对应的角色已停用，请联系企业负责人。");
  }
  if (payload?.error === "employee_account_disabled") {
    throw new Error("员工账号已停用，请联系企业负责人。");
  }
  if (payload?.error === "employee_invitation_expired") {
    throw new Error("这封邀请已过期，请联系企业负责人重新发送。");
  }
  if (payload?.error === "employee_invitation_revoked") {
    throw new Error("这封邀请已被撤销，请联系企业负责人。");
  }
  if (payload?.error === "employee_invitation_superseded") {
    throw new Error("这不是最新的邀请邮件，请打开最近收到的那一封。");
  }
  if (payload?.error === "employee_invitation_credentials_required") {
    throw new Error("请从最新的邀请邮件进入企业工作台。");
  }
  throw new Error("员工邀请确认失败，请稍后重试。");
}

export default function EnterprisePortalClient({ siteId }: { siteId: string }) {
  const [accessToken, setAccessToken] = useState("");
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const invitationCredentialRef = useRef<InvitationCredential | null>(null);
  const acceptedAccessTokenRef = useRef("");
  const acceptanceInFlightRef = useRef<Promise<void> | null>(null);

  const ensureMembershipAccepted = useCallback(
    async (token: string) => {
      if (!token || acceptedAccessTokenRef.current === token) return;
      if (acceptanceInFlightRef.current) return acceptanceInFlightRef.current;
      const invitation = invitationCredentialRef.current;
      const acceptance = acceptEnterpriseMembership(siteId, token, invitation)
        .then(() => {
          acceptedAccessTokenRef.current = token;
          invitationCredentialRef.current = null;
        })
        .finally(() => {
          if (acceptanceInFlightRef.current === acceptance) {
            acceptanceInFlightRef.current = null;
          }
        });
      acceptanceInFlightRef.current = acceptance;
      return acceptance;
    },
    [siteId],
  );

  useEffect(() => {
    let cancelled = false;
    async function resolveSession() {
      try {
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);
          const code = url.searchParams.get("code")?.trim() ?? "";
          const invitationVersionText = url.searchParams.get("iv")?.trim() ?? "";
          const invitationToken = url.searchParams.get("it")?.trim() ?? "";
          const invitationVersion = Number(invitationVersionText);
          if (
            Number.isSafeInteger(invitationVersion) &&
            invitationVersion > 0 &&
            /^[A-Za-z0-9_-]{32,256}$/.test(invitationToken)
          ) {
            invitationCredentialRef.current = {
              invitationVersion,
              invitationToken,
            };
          }
          if (code || invitationVersionText || invitationToken) {
            url.searchParams.delete("code");
            url.searchParams.delete("iv");
            url.searchParams.delete("it");
            window.history.replaceState(
              window.history.state,
              "",
              `${url.pathname}${url.search}${url.hash}`,
            );
          }
          if (code) {
            const exchanged = await supabase.auth.exchangeCodeForSession(code);
            if (exchanged.error) throw exchanged.error;
          } else if (url.hash) {
            const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
            const hashAccessToken = hash.get("access_token")?.trim() ?? "";
            const hashRefreshToken = hash.get("refresh_token")?.trim() ?? "";
            if (hashAccessToken && hashRefreshToken) {
              const established = await supabase.auth.setSession({
                access_token: hashAccessToken,
                refresh_token: hashRefreshToken,
              });
              if (established.error) throw established.error;
              window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
            }
          }
        }
        const result = await supabase.auth.getSession();
        if (result.error) throw result.error;
        const token = result.data.session?.access_token ?? "";
        if (token) await ensureMembershipAccepted(token);
        if (!cancelled) setAccessToken(token);
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : "邀请链接无效或已过期。");
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    }
    void resolveSession();
    const listener = supabase.auth.onAuthStateChange((_event, session) => {
      const token = session?.access_token ?? "";
      if (!token) {
        if (!cancelled) setAccessToken("");
        return;
      }
      void Promise.resolve()
        .then(() => ensureMembershipAccepted(token))
        .then(() => {
          if (!cancelled) setAccessToken(token);
        })
        .catch((error) => {
          if (!cancelled) {
            setAccessToken("");
            setMessage(error instanceof Error ? error.message : "员工邀请确认失败。");
          }
        });
    });
    return () => {
      cancelled = true;
      listener.data.subscription.unsubscribe();
    };
  }, [ensureMembershipAccepted, siteId]);

  async function signIn() {
    setBusy(true);
    setMessage("");
    try {
      const result = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (result.error) throw result.error;
      const token = result.data.session?.access_token ?? "";
      if (!token) throw new Error("登录未返回有效会话。");
      await ensureMembershipAccepted(token);
      setAccessToken(token);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "登录失败，请检查邮箱和密码。");
    } finally {
      setBusy(false);
    }
  }

  async function setLoginPassword() {
    if (newPassword.length < 8) {
      setMessage("新密码至少需要 8 个字符。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await supabase.auth.updateUser({ password: newPassword });
      if (result.error) throw result.error;
      setNewPassword("");
      setMessage("登录密码已设置。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "密码设置失败。");
    } finally {
      setBusy(false);
    }
  }

  async function requestPasswordReset() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setMessage("请先填写员工邮箱。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const redirectTo =
        typeof window === "undefined"
          ? undefined
          : `${window.location.origin}/enterprise/${encodeURIComponent(siteId)}`;
      const result = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        ...(redirectTo ? { redirectTo } : {}),
      });
      if (result.error) throw result.error;
      setMessage("如果该邮箱已开通员工账号，密码设置邮件会发送到邮箱。");
    } catch {
      setMessage("暂时无法发送密码设置邮件，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  if (checking) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 px-4 text-white">
        <div className="text-sm text-slate-300">正在验证企业账号...</div>
      </main>
    );
  }

  if (!/^\d{8}$/.test(siteId)) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 px-4 text-white">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6">企业入口无效。</div>
      </main>
    );
  }

  if (!accessToken) {
    return (
      <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top,#164e63,#0f172a_55%)] px-4 py-10">
        <section className="w-full max-w-md rounded-3xl border border-white/10 bg-white p-6 shadow-2xl">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-700">Faolla Enterprise</div>
          <h1 className="mt-3 text-2xl font-bold text-slate-950">员工登录</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">使用企业负责人邀请的员工邮箱登录。</p>
          <div className="mt-6 space-y-3">
            <input
              type="email"
              autoComplete="email"
              className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm"
              placeholder="员工邮箱"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <input
              type="password"
              autoComplete="current-password"
              className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm"
              placeholder="密码"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void signIn();
              }}
            />
            {message ? <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{message}</div> : null}
            <button
              type="button"
              className="w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-45"
              disabled={busy || !email.trim() || !password}
              onClick={() => void signIn()}
            >
              {busy ? "登录中..." : "登录企业工作台"}
            </button>
            <button
              type="button"
              className="w-full rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 disabled:opacity-45"
              disabled={busy || !email.trim()}
              onClick={() => void requestPasswordReset()}
            >
              忘记密码 / 设置密码
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f3f6fb]">
      <div className="flex flex-wrap items-center justify-end gap-2 border-b border-slate-200 bg-white px-4 py-2">
        <input
          type="password"
          autoComplete="new-password"
          className="w-48 rounded-lg border border-slate-300 px-3 py-2 text-xs"
          placeholder="设置或修改登录密码"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
        />
        <button
          type="button"
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-45"
          disabled={busy || !newPassword}
          onClick={() => void setLoginPassword()}
        >
          设置密码
        </button>
        <button
          type="button"
          className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white"
          onClick={() => void supabase.auth.signOut()}
        >
          退出
        </button>
        {message ? <span className="text-xs text-slate-600">{message}</span> : null}
      </div>
      <MerchantEnterpriseManager siteId={siteId} accessToken={accessToken} standalone />
    </main>
  );
}
