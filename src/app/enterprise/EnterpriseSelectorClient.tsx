"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildMerchantEnterpriseSitePath,
  describeMerchantEnterpriseMembershipAvailability,
  normalizeMerchantEnterpriseMembershipPayload,
  type MerchantEnterpriseMembership,
} from "@/lib/merchantEnterpriseMembershipSelector";
import { MerchantEnterpriseAuthGeneration } from "@/lib/merchantEnterpriseAuthGeneration";
import { merchantEnterpriseSupabase as supabase } from "@/lib/merchantEnterpriseSupabase";

type MembershipPayload = {
  ok?: boolean;
  memberships?: unknown;
  error?: string;
};

type MembershipLoadState = "idle" | "loading" | "ready" | "error";

type SelectorAuthContext = {
  token: string;
  generation: number;
};

type PasswordResetRequestPayload = {
  ok?: unknown;
  error?: unknown;
};

function membershipLoadError(response: Response, payload: MembershipPayload | null) {
  if (response.status === 401) return "企业登录已失效，请退出后重新登录。";
  if (response.status === 403) return "当前账号无权读取企业身份。";
  if (payload?.error === "enterprise_memberships_unavailable") {
    return "企业身份暂时无法读取，请稍后重试。";
  }
  return "无法加载企业列表，请稍后重试。";
}

function passwordResetRequestError(payload: PasswordResetRequestPayload | null) {
  if (payload?.error === "reset_password_invalid_email") {
    return "请输入有效的员工邮箱。";
  }
  if (payload?.error === "auth_rate_limited") {
    return "发送请求过于频繁，请稍后再试。";
  }
  return "暂时无法发送密码设置邮件，请稍后重试。";
}

function membershipStatusLabel(status: string) {
  if (status === "active") return "已启用";
  if (status === "disabled") return "已停用";
  if (status === "invited") return "待确认邀请";
  return "不可用";
}

export default function EnterpriseSelectorClient() {
  const [authContext, setAuthContext] = useState<SelectorAuthContext | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [memberships, setMemberships] = useState<MerchantEnterpriseMembership[]>([]);
  const [membershipLoadState, setMembershipLoadState] =
    useState<MembershipLoadState>("idle");
  const [membershipError, setMembershipError] = useState("");
  const [membershipReloadVersion, setMembershipReloadVersion] = useState(0);
  const [navigatingSiteId, setNavigatingSiteId] = useState("");
  const membershipRequestIdRef = useRef(0);
  const authGenerationRef = useRef(new MerchantEnterpriseAuthGeneration());
  const accessToken = authContext?.token ?? "";

  const clearMembershipScopeForAuthTransition = useCallback(
    (nextState: MembershipLoadState) => {
      membershipRequestIdRef.current += 1;
      setMemberships([]);
      setMembershipLoadState(nextState);
      setMembershipError("");
      setNavigatingSiteId("");
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const authGeneration = authGenerationRef.current;
    const initializationGeneration = authGeneration.begin();
    authGeneration.bindSessionToken(initializationGeneration, "");

    async function resolveSession(generation: number) {
      let token = "";
      try {
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);
          const code = url.searchParams.get("code")?.trim() ?? "";
          if (code) {
            url.searchParams.delete("code");
            window.history.replaceState(
              window.history.state,
              "",
              `${url.pathname}${url.search}${url.hash}`,
            );
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
              window.history.replaceState(
                window.history.state,
                "",
                `${url.pathname}${url.search}`,
              );
            }
          }
        }

        const result = await supabase.auth.getSession();
        if (result.error) throw result.error;
        token = result.data.session?.access_token ?? "";
        if (cancelled || !authGeneration.bindSessionToken(generation, token)) return;
        clearMembershipScopeForAuthTransition(token ? "loading" : "idle");
        setAuthContext(token ? { token, generation } : null);
      } catch {
        if (authGeneration.isGenerationCurrent(generation, cancelled)) {
          authGeneration.bindSessionToken(generation, "");
          clearMembershipScopeForAuthTransition("idle");
          setAuthContext(null);
          setMessage("登录链接无效或已过期，请重新登录。");
        }
      } finally {
        if (authGeneration.isGenerationCurrent(generation, cancelled)) {
          setCheckingSession(false);
        }
      }
    }

    void resolveSession(initializationGeneration);
    const listener = supabase.auth.onAuthStateChange((_event, session) => {
      const generation = authGeneration.begin();
      const token = session?.access_token ?? "";
      if (!authGeneration.bindSessionToken(generation, token) || cancelled) return;
      clearMembershipScopeForAuthTransition(token ? "loading" : "idle");
      setAuthContext(token ? { token, generation } : null);
      setCheckingSession(false);
    });

    return () => {
      cancelled = true;
      const invalidationGeneration = authGeneration.begin();
      authGeneration.bindSessionToken(invalidationGeneration, "");
      listener.data.subscription.unsubscribe();
    };
  }, [clearMembershipScopeForAuthTransition]);

  useEffect(() => {
    if (!authContext) return;
    const { token: requestToken, generation: authGeneration } = authContext;
    const requestId = membershipRequestIdRef.current + 1;
    membershipRequestIdRef.current = requestId;
    const controller = new AbortController();

    // Remove the previous tenant list before a refreshed or replaced token is
    // used, so one authenticated identity can never see another one's cards.
    setMemberships([]);
    setMembershipLoadState("loading");
    setMembershipError("");

    async function loadMemberships() {
      try {
        const response = await fetch("/api/merchant-enterprise/memberships", {
          method: "GET",
          headers: {
            "x-merchant-access-token": requestToken,
          },
          credentials: "omit",
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => null)) as MembershipPayload | null;
        if (response.ok !== true) {
          throw new Error(membershipLoadError(response, payload));
        }
        const normalized = normalizeMerchantEnterpriseMembershipPayload(payload);
        if (
          controller.signal.aborted ||
          membershipRequestIdRef.current !== requestId ||
          !authGenerationRef.current.isCurrent(authGeneration, requestToken)
        ) {
          return;
        }
        setMemberships(normalized);
        setMembershipLoadState("ready");
      } catch (error) {
        if (
          controller.signal.aborted ||
          membershipRequestIdRef.current !== requestId ||
          !authGenerationRef.current.isCurrent(authGeneration, requestToken)
        ) {
          return;
        }
        setMemberships([]);
        setMembershipLoadState("error");
        setMembershipError(
          error instanceof Error ? error.message : "无法加载企业列表，请稍后重试。",
        );
      }
    }

    void loadMemberships();
    return () => controller.abort();
  }, [authContext, membershipReloadVersion]);

  const enterMembership = useCallback((membership: MerchantEnterpriseMembership) => {
    if (!membership.enterable) return;
    const path = buildMerchantEnterpriseSitePath(membership.siteId);
    if (!path || typeof window === "undefined") return;
    setNavigatingSiteId(membership.siteId);
    window.location.assign(path);
  }, []);

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
      setPassword("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "登录失败，请检查邮箱和密码。");
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
      const response = await fetch("/api/auth/reset-password/request", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({
          email: normalizedEmail,
          returnTo: "/enterprise",
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | PasswordResetRequestPayload
        | null;
      if (!response.ok || payload?.ok !== true) {
        setMessage(passwordResetRequestError(payload));
        return;
      }
      setMessage("如果该邮箱已开通员工账号，密码设置邮件会发送到邮箱。");
    } catch {
      setMessage("暂时无法发送密码设置邮件，请稍后重试。");
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

  async function signOut() {
    setBusy(true);
    setMessage("");
    const authGeneration = authGenerationRef.current;
    const generation = authGeneration.begin();
    authGeneration.bindSessionToken(generation, "");
    clearMembershipScopeForAuthTransition("idle");
    setAuthContext(null);
    setCheckingSession(false);
    try {
      const result = await supabase.auth.signOut();
      if (result.error) throw result.error;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "退出失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  if (checkingSession) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 px-4 text-white">
        <div className="text-sm text-slate-300">正在验证企业账号...</div>
      </main>
    );
  }

  if (!accessToken) {
    return (
      <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top,#155e75,#0f172a_58%)] px-4 py-10">
        <section className="w-full max-w-md rounded-3xl border border-white/10 bg-white p-6 shadow-2xl sm:p-8">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-700">
            Faolla Enterprise
          </div>
          <h1 className="mt-3 text-2xl font-bold text-slate-950">进入企业工作台</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            使用企业负责人邀请的员工邮箱登录，再选择要进入的企业。
          </p>
          <form
            className="mt-6 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void signIn();
            }}
          >
            <label className="block text-sm font-medium text-slate-700">
              员工邮箱
              <input
                type="email"
                autoComplete="email"
                className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 text-base text-slate-950 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
                placeholder="name@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              密码
              <input
                type="password"
                autoComplete="current-password"
                className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 text-base text-slate-950 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
                placeholder="输入密码"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {message ? (
              <div role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {message}
              </div>
            ) : null}
            <button
              type="submit"
              className="w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-45"
              disabled={busy || !email.trim() || !password}
            >
              {busy ? "登录中..." : "登录并选择企业"}
            </button>
            <button
              type="button"
              className="w-full rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 disabled:opacity-45"
              disabled={busy || !email.trim()}
              onClick={() => void requestPasswordReset()}
            >
              忘记密码 / 设置密码
            </button>
          </form>
        </section>
      </main>
    );
  }

  if (navigatingSiteId) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 px-4 text-white">
        <div className="text-sm text-slate-300">正在安全进入企业工作台...</div>
      </main>
    );
  }

  const enterableCount = memberships.filter((membership) => membership.enterable).length;

  return (
    <main className="min-h-screen bg-[#f3f6fb] px-4 py-8 text-slate-950 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <header className="rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-teal-800 p-6 text-white shadow-xl sm:p-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200">
                Faolla Enterprise
              </div>
              <h1 className="mt-3 text-2xl font-bold sm:text-3xl">选择企业</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-200">
                每次只进入一家企业。切换时会重新加载工作台，不会沿用上一家企业的数据。
              </p>
            </div>
            <button
              type="button"
              className="self-start rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
              disabled={busy}
              onClick={() => void signOut()}
            >
              退出登录
            </button>
          </div>
        </header>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-bold">企业身份</h2>
              <p className="mt-1 text-sm text-slate-500">
                {membershipLoadState === "ready"
                  ? enterableCount === 1
                    ? "当前有 1 家企业可以进入，请点击下方按钮继续。"
                    : `当前有 ${enterableCount} 家企业可以进入。`
                  : "正在读取当前账号所属的企业。"}
              </p>
            </div>
            <button
              type="button"
              className="self-start rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-45"
              disabled={membershipLoadState === "loading"}
              onClick={() => setMembershipReloadVersion((version) => version + 1)}
            >
              重新加载
            </button>
          </div>

          {message ? (
            <div role="alert" className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {message}
            </div>
          ) : null}

          {membershipLoadState === "loading" ? (
            <div className="mt-6 grid gap-4 md:grid-cols-2" aria-label="正在加载企业身份">
              {[0, 1].map((item) => (
                <div key={item} className="h-44 animate-pulse rounded-2xl bg-slate-100" />
              ))}
            </div>
          ) : null}

          {membershipLoadState === "error" ? (
            <div
              role="alert"
              className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800"
            >
              {membershipError}
            </div>
          ) : null}

          {membershipLoadState === "ready" && memberships.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-900">
              当前账号没有可显示的企业身份。请确认登录邮箱，或联系企业负责人重新发送邀请。
            </div>
          ) : null}

          {membershipLoadState === "ready" && memberships.length > 0 ? (
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {memberships.map((membership) => (
                <article
                  key={membership.siteId}
                  className={`rounded-2xl border p-5 ${
                    membership.enterable
                      ? "border-teal-200 bg-teal-50/40"
                      : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-lg font-bold">{membership.siteName}</h3>
                      <p className="mt-1 text-xs text-slate-500">企业编号 {membership.siteId}</p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                        membership.enterable
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      {membershipStatusLabel(membership.status)}
                    </span>
                  </div>
                  <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-slate-500">员工</dt>
                      <dd className="mt-1 truncate font-semibold">{membership.displayName}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">角色</dt>
                      <dd className="mt-1 truncate font-semibold">{membership.roleName}</dd>
                    </div>
                  </dl>
                  <p className={`mt-4 text-sm ${membership.enterable ? "text-teal-800" : "text-slate-500"}`}>
                    {describeMerchantEnterpriseMembershipAvailability(membership)}
                  </p>
                  <button
                    type="button"
                    className="mt-5 w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                    disabled={!membership.enterable}
                    onClick={() => enterMembership(membership)}
                  >
                    {membership.enterable ? "进入工作台" : "无法进入"}
                  </button>
                </article>
              ))}
            </div>
          ) : null}
        </section>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-base font-bold">账号安全</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            企业员工会话与 Faolla 商户负责人会话相互独立，并仅保留在当前浏览器标签页。
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <label htmlFor="enterprise-selector-new-password" className="sr-only">
              设置或修改登录密码
            </label>
            <input
              id="enterprise-selector-new-password"
              type="password"
              autoComplete="new-password"
              className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-3 text-base"
              placeholder="设置或修改登录密码"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <button
              type="button"
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-45"
              disabled={busy || !newPassword}
              onClick={() => void setLoginPassword()}
            >
              设置密码
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
