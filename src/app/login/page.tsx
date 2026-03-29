"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/components/I18nProvider";
import {
  clearStoredBrowserSupabaseSessionTokens,
  establishBrowserSupabaseSession,
  hasStoredBrowserSupabaseSessionTokens,
  isTransientAuthValidationError,
  persistBrowserSupabaseSessionSnapshot,
  recoverBrowserSupabaseSession,
} from "@/lib/authSessionRecovery";
import { ensureMerchantIdentityForUser, isMerchantNumericId } from "@/lib/merchantIdentity";
import { clearMerchantSignInBridge, setMerchantSignInBridge } from "@/lib/merchantSignInBridge";
import { buildMerchantBackendHref } from "@/lib/siteRouting";
import {
  canReachSupabaseGateway,
  getResolvedSupabaseUrl,
  resolvedSupabaseAnonKey,
  supabase,
} from "@/lib/supabase";

type LoginAuthUser = {
  id?: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
};

type LoginAuthSession = {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number | null;
  expires_in?: number;
  token_type?: string;
  user?: LoginAuthUser | null;
};

type ServerSignInResult = {
  user: LoginAuthUser | null;
  merchantId: string;
  needsJustSignedInBridge: boolean;
};

function LoginPageInner() {
  const { locale, t } = useI18n();
  const searchParams = useSearchParams();
  const isDevelopment = process.env.NODE_ENV === "development";
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const accountInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
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
  const loggedOut = useMemo(() => (searchParams.get("loggedOut") ?? "").trim() === "1", [searchParams]);
  const normalizedLocale = useMemo(() => locale.trim().toLowerCase(), [locale]);
  const loginAccountLabel = useMemo(() => {
    if (normalizedLocale.startsWith("zh-tw")) return "登入帳號";
    if (normalizedLocale.startsWith("ja")) return "ログインアカウント";
    if (normalizedLocale.startsWith("ko")) return "로그인 계정";
    if (normalizedLocale.startsWith("zh")) return "登录账号";
    return "Login Account";
  }, [normalizedLocale]);
  const loginAccountPlaceholder = useMemo(() => {
    if (normalizedLocale.startsWith("zh-tw")) return "信箱 / 使用者名稱 / 8位ID";
    if (normalizedLocale.startsWith("ja")) return "メール / ユーザー名 / 8桁ID";
    if (normalizedLocale.startsWith("ko")) return "이메일 / 사용자명 / 8자리 ID";
    if (normalizedLocale.startsWith("zh")) return "邮箱 / 用户名 / 8位ID";
    return "Email / Username / 8-digit ID";
  }, [normalizedLocale]);
  const loginAccountRequiredMessage = useMemo(() => {
    if (normalizedLocale.startsWith("zh-tw")) return "請輸入登入帳號";
    if (normalizedLocale.startsWith("ja")) return "ログインアカウントを入力してください";
    if (normalizedLocale.startsWith("ko")) return "로그인 계정을 입력해 주세요";
    if (normalizedLocale.startsWith("zh")) return "请输入登录账号";
    return "Please enter login account";
  }, [normalizedLocale]);
  const loginAccountTip = useMemo(() => {
    if (normalizedLocale.startsWith("zh-tw")) return "登入支援信箱、使用者名稱或 8 位 ID；註冊仍需填寫信箱。";
    if (normalizedLocale.startsWith("ja")) return "ログインはメール、ユーザー名、8桁IDに対応しています。新規登録はメール入力が必要です。";
    if (normalizedLocale.startsWith("ko")) return "로그인은 이메일, 사용자명, 8자리 ID를 지원합니다. 회원가입은 이메일이 필요합니다.";
    if (normalizedLocale.startsWith("zh")) return "登录支持邮箱、用户名或 8 位 ID；注册仍需填写邮箱。";
    return "Sign in supports email, username, or 8-digit ID. Sign up still requires an email.";
  }, [normalizedLocale]);

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

  useEffect(() => {
    if (!loggedOut) return;
    clearStoredBrowserSupabaseSessionTokens();
    clearMerchantSignInBridge();
    setAccount("");
    setPassword("");
    setMsg("");

    const scrub = () => {
      if (accountInputRef.current) {
        accountInputRef.current.value = "";
      }
      if (passwordInputRef.current) {
        passwordInputRef.current.value = "";
      }
    };

    scrub();
    const timers = [80, 260, 700].map((delay) => window.setTimeout(scrub, delay));
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [loggedOut]);

  const redirectToMerchantBackend = useCallback(
    async (
      user?: {
        id?: string;
        email?: string | null;
        user_metadata?: Record<string, unknown> | null;
        app_metadata?: Record<string, unknown> | null;
      } | null,
      preferredMerchantId?: string | null,
      options?: { withSignInBridge?: boolean },
    ) => {
      const decorateMerchantHref = (href: string) => {
        const url = new URL(href, window.location.origin);
        const targetMerchantId = url.pathname.replace(/^\/+/, "").split("/")[0]?.trim() ?? "";
        if (options?.withSignInBridge) {
          url.searchParams.set("justSignedIn", "1");
          if (isMerchantNumericId(targetMerchantId)) {
            setMerchantSignInBridge(targetMerchantId);
          }
        } else {
          url.searchParams.delete("justSignedIn");
          if (isMerchantNumericId(targetMerchantId)) {
            clearMerchantSignInBridge(targetMerchantId);
          }
        }
        return `${url.pathname}${url.search}${url.hash}`;
      };

      if (requestedRedirectPath) {
        window.location.href = decorateMerchantHref(requestedRedirectPath);
        return;
      }

      const directMerchantId = String(preferredMerchantId ?? "").trim();
      if (directMerchantId) {
        window.location.href = decorateMerchantHref(buildMerchantBackendHref(directMerchantId));
        return;
      }

      try {
        const resolved = await ensureMerchantIdentityForUser(user ?? undefined);
        if (resolved.merchantId) {
          window.location.href = decorateMerchantHref(buildMerchantBackendHref(resolved.merchantId));
          return;
        }
      } catch {
        // fallback to legacy route
      }
      window.location.href = decorateMerchantHref("/admin");
    },
    [requestedRedirectPath],
  );

  async function readEmailConfirmationRequired() {
    try {
      const response = await fetch(`${getResolvedSupabaseUrl()}/auth/v1/settings`, {
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

  function pickAuthUser(data: {
    session?: { user?: { id?: string; email?: string | null; user_metadata?: Record<string, unknown> | null } | null } | null;
    user?: { id?: string; email?: string | null; user_metadata?: Record<string, unknown> | null } | null;
  }) {
    return data.session?.user ?? data.user ?? null;
  }

  async function readValidatedSessionUser() {
    const session = await recoverBrowserSupabaseSession(1800);
    if (!session?.user) return null;

    try {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) {
        if (error && isTransientAuthValidationError(error)) {
          return session.user;
        }
        const recovered = await recoverBrowserSupabaseSession(1200);
        if (recovered?.user) return recovered.user;
        await supabase.auth.signOut({ scope: "local" }).catch(() => {
          // ignore local cleanup failure
        });
        return null;
      }
      return data.user;
    } catch {
      return session.user;
    }
  }

  useEffect(() => {
    let mounted = true;
    const gatewayProbe = canReachSupabaseGateway(2200)
      .then((gatewayReady) => {
        if (!mounted) return gatewayReady;
        setGatewayReachable(gatewayReady);
        return gatewayReady;
      })
      .catch(() => null as boolean | null);

    void gatewayProbe.then((gatewayReady) => {
      if (!mounted || gatewayReady !== true) return;
      void readEmailConfirmationRequired()
        .then((nextEmailConfirmationRequired) => {
          if (mounted && nextEmailConfirmationRequired !== null) {
            setEmailConfirmationRequired(nextEmailConfirmationRequired);
          }
        })
        .catch(() => {
          // Ignore non-critical settings read failures.
        });
    });

    if (hasStoredBrowserSupabaseSessionTokens()) {
      void readValidatedSessionUser()
        .then((user) => {
          if (!mounted) return;
          if (user) {
            void redirectToMerchantBackend(user);
          }
        })
        .catch(() => {
          // Ignore transient auth bootstrap errors to avoid runtime abort overlay.
        });
    }

    return () => {
      mounted = false;
    };
  }, [redirectToMerchantBackend]);

  function validateSignInForm(): string | null {
    const trimmedAccount = account.trim();

    if (!trimmedAccount) return loginAccountRequiredMessage;
    if (!password) return t("login.requiredPassword");
    if (password.length < 6) return t("login.passwordTooShort");

    return null;
  }

  function validateEmailForm(): string | null {
    const trimmedEmail = account.trim();

    if (!trimmedEmail) return t("login.requiredEmail");
    if (!trimmedEmail.includes("@")) return t("login.invalidEmail");
    if (!password) return t("login.requiredPassword");
    if (password.length < 6) return t("login.passwordTooShort");

    return null;
  }

  function isEmailNotConfirmed(message: string) {
    return /email not confirmed|email_not_confirmed/i.test(message);
  }

  function isInvalidCredentials(message: string) {
    return /invalid_credentials|invalid (authentication|login) credentials|invalid_grant/i.test(message);
  }

  function isUserAlreadyRegistered(message: string, code?: string) {
    if (code === "user_already_exists") return true;
    return /user already registered/i.test(message);
  }

  function getRegisteredAccountMessage(confirmed: boolean) {
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
    if (/browser_session_not_ready/i.test(message)) {
      return t("login.requestFailed");
    }
    if (/merchant_login_|auth_signin_|account_resolve_/i.test(message)) {
      return t("login.backendUnavailable");
    }
    if (/failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(message)) {
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

  function persistSessionSnapshot(session: LoginAuthSession) {
    return persistBrowserSupabaseSessionSnapshot({
      currentSession: session,
      session,
    });
  }

  async function stabilizeBrowserSession(session: LoginAuthSession) {
    const accessToken = String(session.access_token ?? "").trim();
    const refreshToken = String(session.refresh_token ?? "").trim();
    if (!accessToken || !refreshToken) {
      return {
        browserSessionReady: false,
        snapshotStored: false,
      };
    }

    const snapshotStored = persistSessionSnapshot(session);

    const establishedSession = await establishBrowserSupabaseSession(
      {
        access_token: accessToken,
        refresh_token: refreshToken,
      },
      900,
    ).catch(() => null);
    if (establishedSession?.user) {
      return {
        browserSessionReady: true,
        snapshotStored,
      };
    }

    if (snapshotStored) {
      void establishBrowserSupabaseSession(
        {
          access_token: accessToken,
          refresh_token: refreshToken,
        },
        2600,
      ).catch(() => null);
      return {
        browserSessionReady: false,
        snapshotStored,
      };
    }

    const recoveredSession = await recoverBrowserSupabaseSession(900).catch(() => null);
    return {
      browserSessionReady: Boolean(recoveredSession?.user),
      snapshotStored,
    };
  }

  async function signInViaServer(accountValue: string, passwordValue: string): Promise<ServerSignInResult> {
    const response = await withTimeout(
      fetch("/api/auth/merchant-login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          account: accountValue.trim(),
          password: passwordValue,
        }),
      }),
      20000,
    );

    const payload = (await response.json().catch(() => null)) as
      | {
          error?: unknown;
          message?: unknown;
          user?: LoginAuthUser | null;
          session?: LoginAuthSession | null;
          merchantId?: unknown;
        }
      | null;

    if (!response.ok) {
      const message =
        typeof payload?.message === "string"
          ? payload.message
          : typeof payload?.error === "string"
            ? payload.error
            : t("login.backendUnavailable");
      throw new Error(message);
    }

    const session = (payload?.session ?? null) as LoginAuthSession | null;
    const accessToken = String(session?.access_token ?? "").trim();
    const refreshToken = String(session?.refresh_token ?? "").trim();
    if (!session || !accessToken || !refreshToken) {
      throw new Error(t("login.requestFailed"));
    }

    const stabilization = await stabilizeBrowserSession(session).catch(() => ({
      browserSessionReady: false,
      snapshotStored: false,
    }));
    const hasStoredTokens = stabilization.snapshotStored || hasStoredBrowserSupabaseSessionTokens();
    if (!stabilization.browserSessionReady && !hasStoredTokens) {
      throw new Error("browser_session_not_ready");
    }

    return {
      user: (payload?.user ?? session?.user ?? null) as LoginAuthUser | null,
      merchantId: typeof payload?.merchantId === "string" ? payload.merchantId.trim() : "",
      needsJustSignedInBridge: !stabilization.browserSessionReady,
    };
  }

  async function signUp() {
    if (pendingAction) return;
    setMsg("");
    setNeedConfirmEmail(false);

    const validationError = validateEmailForm();
    if (validationError) return setMsg(validationError);
    const gatewayReady = await canReachSupabaseGateway(4000);
    setGatewayReachable(gatewayReady);

    setPendingAction("signup");
    try {
      const { data, error } = await withTimeout(
        supabase.auth.signUp({
          email: account.trim(),
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/login`,
          },
        }),
      );
      if (error) {
        if (isUserAlreadyRegistered(error.message, (error as { code?: string }).code)) {
          const status = await readRegistrationStatus(account);
          const confirmed = status?.exists ? status.confirmed : true;
          setNeedConfirmEmail(!confirmed);
          return setMsg(getRegisteredAccountMessage(confirmed));
        }
        return setMsg(normalizeError(error.message));
      }
      const needsConfirmation = signUpNeedsEmailConfirmation(data);
      setEmailConfirmationRequired(needsConfirmation);
      if (!needsConfirmation) {
        await redirectToMerchantBackend(pickAuthUser(data), undefined, { withSignInBridge: false });
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

    const validationError = validateSignInForm();
    if (validationError) return setMsg(validationError);
    const gatewayProbe = canReachSupabaseGateway(2200)
      .then((reachable) => {
        setGatewayReachable(reachable);
        return reachable;
      })
      .catch(() => null as boolean | null);

    setPendingAction("signin");
    try {
      const preferredMerchantId = isMerchantNumericId(account.trim()) ? account.trim() : "";
      const result = await signInViaServer(account, password);
      const resolvedMerchantId = preferredMerchantId || result.merchantId;
      await redirectToMerchantBackend(result.user, resolvedMerchantId, {
        withSignInBridge: result.needsJustSignedInBridge,
      });
    } catch (error) {
      const normalizedMessage = error instanceof Error ? normalizeError(error.message) : t("login.requestFailed");
      setNeedConfirmEmail(normalizedMessage === t("login.emailNotConfirmed"));
      const gatewayReady = await Promise.race([
        gatewayProbe,
        Promise.resolve(gatewayReachable),
      ]);
      if (gatewayReady === false && normalizedMessage === t("login.backendUnavailable") && isDevelopment) {
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

    const trimmedEmail = account.trim();
    if (!trimmedEmail) return setMsg(t("login.inputRegisterEmailFirst"));
    if (!trimmedEmail.includes("@")) return setMsg(t("login.invalidEmail"));
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

    const trimmedEmail = account.trim();
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
        <div className="text-xs text-gray-500">{loginAccountTip}</div>

        <div className="space-y-2">
          <div className="hidden" aria-hidden="true">
            <input type="text" tabIndex={-1} autoComplete="username" />
            <input type="password" tabIndex={-1} autoComplete="current-password" />
          </div>
          <div className="text-sm text-gray-600">{loginAccountLabel}</div>
          <input
            ref={accountInputRef}
            className="w-full rounded border p-2"
            type="text"
            name="merchant-login-account"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            data-lpignore="true"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            placeholder={loginAccountPlaceholder}
          />
        </div>

        <div className="space-y-2">
          <div className="text-sm text-gray-600">{t("login.password")}</div>
          <input
            ref={passwordInputRef}
            className="w-full rounded border p-2"
            type="password"
            name="merchant-login-password"
            autoComplete="new-password"
            data-lpignore="true"
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
