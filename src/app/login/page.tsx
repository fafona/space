"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/components/I18nProvider";
import { ensureMerchantIdentityForUser } from "@/lib/merchantIdentity";
import { buildMerchantBackendHref } from "@/lib/siteRouting";
import { canReachSupabaseGateway, resolvedSupabaseAnonKey, resolvedSupabaseUrl, supabase } from "@/lib/supabase";

function LoginPageInner() {
  const { locale, t } = useI18n();
  const searchParams = useSearchParams();
  const isDevelopment = process.env.NODE_ENV === "development";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string>("");
  const [gatewayReachable, setGatewayReachable] = useState<boolean | null>(null);
  const [needConfirmEmail, setNeedConfirmEmail] = useState(false);
  const [emailConfirmationRequired, setEmailConfirmationRequired] = useState<boolean | null>(null);
  const [pendingAction, setPendingAction] = useState<"signin" | "signup" | "forgot" | "resend" | null>(null);
  const requestedRedirectPath = useMemo(() => {
    const raw = (searchParams.get("redirect") ?? "").trim();
    if (!raw.startsWith("/") || raw.startsWith("//")) return "";
    return raw;
  }, [searchParams]);

  useEffect(() => {
    const confirmed = (searchParams.get("confirmed") ?? "").trim();
    const message = (searchParams.get("confirm_message") ?? "").trim();
    if (!confirmed && !message) return;
    if (confirmed === "1") {
      setNeedConfirmEmail(false);
      setMsg(message || "邮箱验证成功，请直接登录。");
      return;
    }
    if (confirmed === "0") {
      setNeedConfirmEmail(true);
      setMsg(message || "邮箱验证失败，请重新发送验证邮件。");
    }
  }, [searchParams]);

  const redirectToMerchantBackend = useCallback(
    async (user?: {
      id?: string;
      email?: string | null;
      user_metadata?: Record<string, unknown> | null;
      app_metadata?: Record<string, unknown> | null;
    } | null) => {
      const withJustSignedIn = (href: string) => {
        const url = new URL(href, window.location.origin);
        url.searchParams.set("justSignedIn", "1");
        return `${url.pathname}${url.search}${url.hash}`;
      };

      if (requestedRedirectPath) {
        window.location.href = withJustSignedIn(requestedRedirectPath);
        return;
      }

      try {
        const resolved = await ensureMerchantIdentityForUser(user ?? undefined);
        if (resolved.merchantId) {
          window.location.href = withJustSignedIn(buildMerchantBackendHref(resolved.merchantId));
          return;
        }
      } catch {
        // fallback to legacy route
      }
      window.location.href = withJustSignedIn("/admin");
    },
    [requestedRedirectPath],
  );

  async function readEmailConfirmationRequired() {
    try {
      const response = await fetch(`${resolvedSupabaseUrl}/auth/v1/settings`, {
        headers: { apikey: resolvedSupabaseAnonKey },
        cache: "no-store",
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as { mailer_autoconfirm?: unknown };
      return typeof payload.mailer_autoconfirm === "boolean" ? !payload.mailer_autoconfirm : null;
    } catch {
      return null;
    }
  }

  function signUpNeedsEmailConfirmation(data: {
    session?: { user?: { email_confirmed_at?: string | null; user_metadata?: Record<string, unknown> | null } | null } | null;
    user?: { email_confirmed_at?: string | null; user_metadata?: Record<string, unknown> | null } | null;
  }) {
    const user = data.session?.user ?? data.user ?? null;
    const metadata = user?.user_metadata;
    const emailVerified =
      metadata && typeof metadata === "object" ? (metadata.email_verified as boolean | undefined) === true : false;
    return !(data.session || user?.email_confirmed_at || emailVerified);
  }

  async function readValidatedSessionUser() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user) return null;

    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      await supabase.auth.signOut({ scope: "local" }).catch(() => {
        // ignore local cleanup failure
      });
      return null;
    }
    return data.user;
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      const gatewayReady = await canReachSupabaseGateway(4000);
      if (!mounted) return;
      setGatewayReachable(gatewayReady);
      if (!gatewayReady) return;
      const nextEmailConfirmationRequired = await readEmailConfirmationRequired();
      if (mounted && nextEmailConfirmationRequired !== null) {
        setEmailConfirmationRequired(nextEmailConfirmationRequired);
      }
      await readValidatedSessionUser()
        .then((user) => {
          if (!mounted) return;
          if (user) {
            void redirectToMerchantBackend(user);
          }
        })
        .catch(() => {
          // Ignore transient auth bootstrap errors to avoid runtime abort overlay.
        });
    })().catch(() => {
      // ignore bootstrap failure
    });
    return () => {
      mounted = false;
    };
  }, [redirectToMerchantBackend]);

  function validateForm(): string | null {
    const trimmedEmail = email.trim();

    if (!trimmedEmail) return t("login.requiredEmail");
    if (!trimmedEmail.includes("@")) return t("login.invalidEmail");
    if (!password) return t("login.requiredPassword");
    if (password.length < 6) return t("login.passwordTooShort");

    return null;
  }

  function isEmailNotConfirmed(message: string) {
    return /Email not confirmed/i.test(message);
  }

  function isInvalidCredentials(message: string) {
    return /invalid (authentication|login) credentials|invalid_grant/i.test(message);
  }

  function isUserAlreadyRegistered(message: string, code?: string) {
    if (code === "user_already_exists") return true;
    return /user already registered/i.test(message);
  }

  function getRegisteredAccountMessage(confirmed: boolean) {
    const normalizedLocale = locale.trim().toLowerCase();
    if (normalizedLocale.startsWith("zh-tw")) {
      return confirmed
        ? "此信箱已註冊，請直接登入。"
        : "此信箱已註冊，但尚未完成信箱驗證。請先驗證信箱，或點擊下方「重發驗證郵件」。";
    }
    if (normalizedLocale.startsWith("ja")) {
      return confirmed
        ? "このメールアドレスは既に登録されています。直接ログインしてください。"
        : "このメールアドレスは既に登録されていますが、メール確認が未完了です。先に確認するか、下の確認メール再送を使ってください。";
    }
    if (normalizedLocale.startsWith("ko")) {
      return confirmed
        ? "이 이메일은 이미 등록되어 있습니다. 바로 로그인해 주세요."
        : "이 이메일은 이미 등록되어 있지만 이메일 인증이 아직 끝나지 않았습니다. 먼저 인증하거나 아래의 인증 메일 재전송을 눌러 주세요.";
    }
    if (normalizedLocale.startsWith("zh")) {
      return confirmed
        ? "该邮箱已注册，请直接登录。"
        : "该邮箱已注册，但还没完成邮箱验证。请先验证邮箱，或点击下方“重发验证邮件”。";
    }
    return confirmed
      ? "This email is already registered. Please sign in."
      : "This email is already registered but not verified yet. Verify your email first, or use resend verification below.";
  }

  async function readRegistrationStatus(emailValue: string) {
    try {
      const response = await fetch("/api/auth/status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: emailValue.trim() }),
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as { exists?: unknown; confirmed?: unknown };
      return {
        exists: payload.exists === true,
        confirmed: payload.confirmed === true,
      };
    } catch {
      return null;
    }
  }

  function normalizeError(message: string) {
    if (/supabase_unavailable:/i.test(message)) {
      return t("login.backendUnavailable");
    }
    if (isEmailNotConfirmed(message)) {
      return t("login.emailNotConfirmed");
    }
    if (isInvalidCredentials(message)) {
      return t("superLogin.invalid");
    }
    return message;
  }

  async function withTimeout<T>(task: Promise<T>, timeoutMs = 15000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;
    const safeTask = task.catch((error) => {
      if (timedOut) {
        return new Promise<T>(() => {});
      }
      throw error;
    });
    const timeoutTask = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new Error(t("login.timeout")));
      }, timeoutMs);
    });

    try {
      return await Promise.race([safeTask, timeoutTask]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function waitForPersistedSessionUser(timeoutMs = 3000) {
    const deadline = Date.now() + Math.max(400, timeoutMs);
    while (Date.now() < deadline) {
      const user = await readValidatedSessionUser();
      if (user) return user;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 120);
      });
    }
    return null;
  }

  async function signUp() {
    if (pendingAction) return;
    setMsg("");
    setNeedConfirmEmail(false);

    const validationError = validateForm();
    if (validationError) return setMsg(validationError);
    const gatewayReady = await canReachSupabaseGateway(4000);
    setGatewayReachable(gatewayReady);

    setPendingAction("signup");
    try {
      const { data, error } = await withTimeout(
        supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/login`,
          },
        }),
      );
      if (error) {
        if (isUserAlreadyRegistered(error.message, (error as { code?: string }).code)) {
          const status = await readRegistrationStatus(email);
          const confirmed = status?.exists ? status.confirmed : true;
          setNeedConfirmEmail(!confirmed);
          return setMsg(getRegisteredAccountMessage(confirmed));
        }
        return setMsg(normalizeError(error.message));
      }
      const needsConfirmation = signUpNeedsEmailConfirmation(data);
      setEmailConfirmationRequired(needsConfirmation);
      if (!needsConfirmation) {
        const persistedUser = await waitForPersistedSessionUser();
        await redirectToMerchantBackend(persistedUser ?? data.session?.user ?? data.user);
        return;
      }
      setMsg(t("login.signupSuccess"));
      setNeedConfirmEmail(true);
    } catch (error) {
      setMsg(error instanceof Error ? normalizeError(error.message) : t("login.requestFailed"));
    } finally {
      setPendingAction(null);
    }
  }

  async function signIn() {
    if (pendingAction) return;
    setMsg("");
    setNeedConfirmEmail(false);

    const validationError = validateForm();
    if (validationError) return setMsg(validationError);
    const gatewayReady = await canReachSupabaseGateway(4000);
    setGatewayReachable(gatewayReady);

    setPendingAction("signin");
    try {
      const { data, error } = await withTimeout(
        supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        }),
      );
      if (error) {
        setNeedConfirmEmail(isEmailNotConfirmed(error.message));
        return setMsg(normalizeError(error.message));
      }
      if (data.session?.user) {
        const persistedUser = await waitForPersistedSessionUser();
        await redirectToMerchantBackend(persistedUser ?? data.session.user);
        return;
      }
      const persistedUser = await waitForPersistedSessionUser();
      const sessionUser = persistedUser ?? (await readValidatedSessionUser());
      await redirectToMerchantBackend(sessionUser);
    } catch (error) {
      const normalizedMessage = error instanceof Error ? normalizeError(error.message) : t("login.requestFailed");
      if (!gatewayReady && normalizedMessage === t("login.backendUnavailable") && isDevelopment) {
        window.location.href = "/admin?offline=1";
        return;
      }
      setMsg(normalizedMessage);
    } finally {
      setPendingAction(null);
    }
  }

  async function resendConfirmationEmail() {
    if (pendingAction) return;
    setMsg("");

    const trimmedEmail = email.trim();
    if (!trimmedEmail) return setMsg(t("login.inputRegisterEmailFirst"));
    const gatewayReady = await canReachSupabaseGateway(4000);
    setGatewayReachable(gatewayReady);

    setPendingAction("resend");
    try {
      const { error } = await withTimeout(
        supabase.auth.resend({
          type: "signup",
          email: trimmedEmail,
          options: {
            emailRedirectTo: `${window.location.origin}/login`,
          },
        }),
      );

      if (error) return setMsg(normalizeError(error.message));
      setMsg(t("login.resendSuccess"));
    } catch (error) {
      setMsg(error instanceof Error ? normalizeError(error.message) : t("login.requestFailed"));
    } finally {
      setPendingAction(null);
    }
  }

  async function forgotPassword() {
    if (pendingAction) return;
    setMsg("");
    setNeedConfirmEmail(false);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) return setMsg(t("login.inputEmailBeforeForgot"));
    if (!trimmedEmail.includes("@")) return setMsg(t("login.invalidEmail"));
    const gatewayReady = await canReachSupabaseGateway(4000);
    setGatewayReachable(gatewayReady);

    setPendingAction("forgot");
    try {
      const { error } = await withTimeout(
        supabase.auth.resetPasswordForEmail(trimmedEmail, {
          redirectTo: `${window.location.origin}/reset-password`,
        }),
      );

      if (error) return setMsg(normalizeError(error.message));
      setMsg(t("login.forgotSuccess"));
    } catch (error) {
      setMsg(error instanceof Error ? normalizeError(error.message) : t("login.requestFailed"));
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-100 p-6">
      <div className="w-full max-w-md space-y-4 rounded-xl border bg-white p-6">
        <h1 className="text-xl font-bold">{t("login.title")}</h1>

        <div className="space-y-2">
          <div className="text-sm text-gray-600">{t("login.email")}</div>
          <input
            className="w-full rounded border p-2"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>

        <div className="space-y-2">
          <div className="text-sm text-gray-600">{t("login.password")}</div>
          <input
            className="w-full rounded border p-2"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("login.passwordMin6")}
          />
        </div>

        {msg ? <div className="text-sm text-red-600">{msg}</div> : null}

        <div className="flex gap-2">
          <button
            className="flex-1 rounded bg-black px-3 py-2 text-white disabled:opacity-50"
            onClick={signIn}
            disabled={pendingAction !== null}
          >
            {pendingAction === "signin" ? t("login.signingIn") : t("login.signIn")}
          </button>
          <button
            className="flex-1 rounded border bg-white px-3 py-2 disabled:opacity-50"
            onClick={signUp}
            disabled={pendingAction !== null}
          >
            {pendingAction === "signup" ? t("login.signingUp") : t("login.signUp")}
          </button>
        </div>

        {isDevelopment && gatewayReachable === false ? (
          <button
            className="w-full rounded border bg-amber-50 px-3 py-2 text-amber-900 hover:bg-amber-100"
            onClick={() => (window.location.href = "/admin?offline=1")}
            disabled={pendingAction !== null}
          >
            {t("login.offlineDev")}
          </button>
        ) : null}

        <button
          className="w-full rounded border bg-white px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
          onClick={forgotPassword}
          disabled={pendingAction !== null}
        >
          {pendingAction === "forgot" ? t("common.sending") : t("login.forgot")}
        </button>

        {needConfirmEmail ? (
          <button
            className="w-full rounded border bg-white px-3 py-2 hover:bg-gray-50 disabled:opacity-50"
            onClick={resendConfirmationEmail}
            disabled={pendingAction !== null}
          >
            {pendingAction === "resend" ? t("common.sending") : t("login.resend")}
          </button>
        ) : null}

        <div className="text-xs text-gray-500">
          {emailConfirmationRequired === false ? t("login.firstRegisterTipAutoConfirm") : t("login.firstRegisterTip")}
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-gray-100" />}>
      <LoginPageInner />
    </Suspense>
  );
}
