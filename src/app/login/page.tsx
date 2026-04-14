"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/components/I18nProvider";
import PasswordField, { getPasswordToggleLabels } from "@/components/PasswordField";
import {
  clearStoredBrowserSupabaseSessionTokens,
  establishBrowserSupabaseSession,
  hasStoredBrowserSupabaseSessionTokens,
  isTransientAuthValidationError,
  persistBrowserSupabaseSessionSnapshot,
  readMerchantSessionPayload,
  recoverBrowserSupabaseSession,
} from "@/lib/authSessionRecovery";
import { ensureMerchantIdentityForUser, isMerchantNumericId } from "@/lib/merchantIdentity";
import {
  clearStoredResetPasswordEmailRequest,
  persistResetPasswordEmailRequest,
} from "@/lib/resetPasswordEmailRequest";
import {
  clearStoredResetPasswordRecoveryPayload,
} from "@/lib/resetPasswordRecoveryPayload";
import {
  clearRecentMerchantLaunchState,
  persistRecentMerchantLaunchState,
  readRecentMerchantLaunchMerchantId,
} from "@/lib/merchantLaunchState";
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

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/g, "");
}

function normalizeOrigin(value: string) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimTrailingSlash(trimmed)}`;
  try {
    const parsed = new URL(candidate);
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return trimTrailingSlash(parsed.toString());
  } catch {
    return "";
  }
}

function toRootOrigin(value: string) {
  const normalized = normalizeOrigin(value);
  if (!normalized) return "";
  try {
    const parsed = new URL(normalized);
    const hostParts = parsed.hostname.split(".").filter(Boolean);
    if (hostParts.length >= 3) {
      parsed.hostname = hostParts.slice(1).join(".");
    }
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return trimTrailingSlash(parsed.toString());
  } catch {
    return "";
  }
}

function resolveAuthEmailRedirectOrigin() {
  const fromEnv = toRootOrigin(process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN ?? "");
  if (fromEnv) return fromEnv;
  if (typeof window !== "undefined" && window.location?.origin) {
    const fromWindow = toRootOrigin(window.location.origin);
    if (fromWindow) return fromWindow;
    return trimTrailingSlash(window.location.origin);
  }
  return "";
}

function isAndroidBrowser() {
  if (typeof navigator === "undefined") return false;
  return /android/i.test(String(navigator.userAgent ?? ""));
}

function isStandaloneDisplayMode() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true;
}

function readAndroidKeyboardInset() {
  if (typeof window === "undefined") return 0;
  const visualViewport = window.visualViewport;
  if (!visualViewport) return 0;
  const topRaw = Number.isFinite(visualViewport.offsetTop) ? visualViewport.offsetTop : 0;
  const bottomRaw = window.innerHeight - (visualViewport.height + topRaw);
  return Number.isFinite(bottomRaw) ? Math.max(0, Math.round(bottomRaw)) : 0;
}

function LoginPageInner() {
  const { locale, t } = useI18n();
  const searchParams = useSearchParams();
  const isDevelopment = process.env.NODE_ENV === "development";
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [resetCode, setResetCode] = useState("");
  const formViewportRef = useRef<HTMLDivElement>(null);
  const accountInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const isAndroid = useMemo(() => isAndroidBrowser(), []);
  const [androidKeyboardInset, setAndroidKeyboardInset] = useState(0);
  const [msg, setMsg] = useState<string>("");
  const [gatewayReachable, setGatewayReachable] = useState<boolean | null>(null);
  const [needConfirmEmail, setNeedConfirmEmail] = useState(false);
  const [emailConfirmationRequired, setEmailConfirmationRequired] = useState<boolean | null>(null);
  const [pendingResetEmail, setPendingResetEmail] = useState("");
  const [pendingResetEmailMasked, setPendingResetEmailMasked] = useState("");
  const [pendingAction, setPendingAction] = useState<
    "signin" | "signup" | "forgot" | "resend" | "verify_reset_code" | null
  >(null);
  const requestedRedirectPath = useMemo(() => {
    const raw = (searchParams.get("redirect") ?? "").trim();
    if (!raw.startsWith("/") || raw.startsWith("//")) return "";
    return raw;
  }, [searchParams]);
  const loggedOut = useMemo(() => (searchParams.get("loggedOut") ?? "").trim() === "1", [searchParams]);
  const launchRetry = useMemo(() => (searchParams.get("launchRetry") ?? "").trim() === "1", [searchParams]);
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
  const resetCodePreferredHint = useMemo(() => {
    if (normalizedLocale.startsWith("zh-tw")) {
      return "QQ、Foxmail、Hotmail、Outlook、Live 這些信箱請使用郵件驗證碼重設密碼，不要點郵件連結。";
    }
    if (normalizedLocale.startsWith("ja")) {
      return "QQ / Foxmail / Hotmail / Outlook / Live のメールは、メールコードでパスワードを再設定してください。メールリンクは使わないでください。";
    }
    if (normalizedLocale.startsWith("ko")) {
      return "QQ / Foxmail / Hotmail / Outlook / Live 메일은 이메일 인증코드로 비밀번호를 재설정해 주세요. 메일 링크는 누르지 마세요.";
    }
    if (normalizedLocale.startsWith("zh")) {
      return "QQ、Foxmail、Hotmail、Outlook、Live 这些邮箱请使用邮件验证码重置密码，不要点邮件链接。";
    }
    return "QQ, Foxmail, Hotmail, Outlook, and Live mailboxes should use the email code to reset the password instead of the email link.";
  }, [normalizedLocale]);
  const loginMethodPills = useMemo(() => {
    if (normalizedLocale.startsWith("zh-tw")) return ["信箱", "使用者名稱", "8 位 ID"];
    if (normalizedLocale.startsWith("ja")) return ["メール", "ユーザー名", "8 桁 ID"];
    if (normalizedLocale.startsWith("ko")) return ["이메일", "사용자명", "8자리 ID"];
    if (normalizedLocale.startsWith("zh")) return ["邮箱", "用户名", "8 位 ID"];
    return ["Email", "Username", "8-digit ID"];
  }, [normalizedLocale]);
  const secureAccessLabel = useMemo(() => {
    if (normalizedLocale.startsWith("zh-tw")) return "安全登入";
    if (normalizedLocale.startsWith("ja")) return "安全ログイン";
    if (normalizedLocale.startsWith("ko")) return "안전 로그인";
    if (normalizedLocale.startsWith("zh")) return "安全登录";
    return "Secure sign in";
  }, [normalizedLocale]);
  const continueLabel = useMemo(() => {
    if (normalizedLocale.startsWith("zh-tw")) return "繼續進入商戶後台";
    if (normalizedLocale.startsWith("ja")) return "管理画面に進む";
    if (normalizedLocale.startsWith("ko")) return "상인 백엔드로 계속";
    if (normalizedLocale.startsWith("zh")) return "继续进入商户后台";
    return "Continue to dashboard";
  }, [normalizedLocale]);
  const passwordToggleLabels = useMemo(() => getPasswordToggleLabels(locale), [locale]);
  const authEmailRedirectOrigin = useMemo(() => resolveAuthEmailRedirectOrigin(), []);
  const shouldShowResetCodePreferredHint = useMemo(
    () => shouldPreferResetCodeFlow(pendingResetEmail || account),
    [account, pendingResetEmail],
  );

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
    clearStoredResetPasswordEmailRequest();
    clearMerchantSignInBridge();
    clearRecentMerchantLaunchState();
    setAccount("");
    setPassword("");
    setResetCode("");
    setPendingResetEmail("");
    setPendingResetEmailMasked("");
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

  useEffect(() => {
    if (loggedOut || launchRetry || typeof window === "undefined") return;
    if (!isStandaloneDisplayMode()) return;
    if (hasStoredBrowserSupabaseSessionTokens()) return;
    const recentMerchantId = readRecentMerchantLaunchMerchantId();
    if (!isMerchantNumericId(recentMerchantId)) return;
    window.location.replace("/launch");
  }, [launchRetry, loggedOut]);

  useEffect(() => {
    if (!isAndroid || typeof window === "undefined" || typeof document === "undefined") return;

    let scrollTimer = 0;
    const scrollFocusedFieldIntoView = (delay = 0) => {
      window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => {
        const activeElement = document.activeElement;
        const viewport = formViewportRef.current;
        if (!(activeElement instanceof HTMLElement) || !viewport || !viewport.contains(activeElement)) return;
        activeElement.scrollIntoView({
          behavior: delay === 0 ? "auto" : "smooth",
          block: "center",
          inline: "nearest",
        });
      }, delay);
    };

    const syncKeyboardInset = (options?: { scrollDelay?: number }) => {
      const nextInset = readAndroidKeyboardInset();
      setAndroidKeyboardInset((current) => (current === nextInset ? current : nextInset));
      scrollFocusedFieldIntoView(options?.scrollDelay ?? 120);
    };

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target;
      const viewport = formViewportRef.current;
      if (!(target instanceof HTMLElement) || !viewport || !viewport.contains(target)) return;
      syncKeyboardInset({ scrollDelay: 180 });
      scrollFocusedFieldIntoView(320);
    };

    const handleFocusOut = () => {
      window.setTimeout(() => {
        setAndroidKeyboardInset(readAndroidKeyboardInset());
      }, 120);
    };

    const handleViewportResize = () => {
      syncKeyboardInset();
    };

    syncKeyboardInset({ scrollDelay: 0 });
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    window.addEventListener("resize", handleViewportResize);
    window.visualViewport?.addEventListener("resize", handleViewportResize);
    window.visualViewport?.addEventListener("scroll", handleViewportResize);
    return () => {
      window.clearTimeout(scrollTimer);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
      window.removeEventListener("resize", handleViewportResize);
      window.visualViewport?.removeEventListener("resize", handleViewportResize);
      window.visualViewport?.removeEventListener("scroll", handleViewportResize);
    };
  }, [isAndroid]);

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
        if (isMerchantNumericId(targetMerchantId)) {
          persistRecentMerchantLaunchState(targetMerchantId);
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

  async function readValidatedCookieBackedSession() {
    const payload = await readMerchantSessionPayload(2600).catch(() => null);
    if (!payload || payload.authenticated !== true || !payload.user) return null;
    const accessToken = typeof payload.accessToken === "string" ? payload.accessToken.trim() : "";
    const refreshToken = typeof payload.refreshToken === "string" ? payload.refreshToken.trim() : "";
    if (accessToken && refreshToken) {
      void establishBrowserSupabaseSession(
        {
          access_token: accessToken,
          refresh_token: refreshToken,
        },
        2200,
      ).catch(() => null);
    }
    return {
      user: payload.user as LoginAuthUser,
      merchantId: typeof payload.merchantId === "string" ? payload.merchantId.trim() : "",
    };
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

    void (async () => {
      try {
        if (hasStoredBrowserSupabaseSessionTokens()) {
          const user = await readValidatedSessionUser();
          if (!mounted) return;
          if (user) {
            await redirectToMerchantBackend(user);
            return;
          }
        }

        const cookieBackedSession = await readValidatedCookieBackedSession();
        if (!mounted) return;
        if (cookieBackedSession?.user) {
          await redirectToMerchantBackend(cookieBackedSession.user, cookieBackedSession.merchantId, {
            withSignInBridge: false,
          });
        }
      } catch {
        // Ignore transient auth bootstrap errors to avoid runtime abort overlay.
      }
    })();

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

  function getRegisteredAccountMessage() {
    if (normalizedLocale.startsWith("zh-tw")) {
      return "此信箱可能已註冊。請先直接登入；如果還沒有完成信箱驗證，可以使用下方的「重發驗證郵件」。";
    }
    if (normalizedLocale.startsWith("ja")) {
      return "このメールアドレスは既に登録済みの可能性があります。まずは直接ログインを試し、未確認の場合は下の確認メール再送を使ってください。";
    }
    if (normalizedLocale.startsWith("ko")) {
      return "이 이메일은 이미 등록되어 있을 수 있습니다. 먼저 바로 로그인해 보시고, 아직 이메일 인증이 끝나지 않았다면 아래의 인증 메일 재전송을 눌러 주세요.";
    }
    if (normalizedLocale.startsWith("zh")) {
      return "该邮箱可能已注册。请先直接登录；如果还没有完成邮箱验证，可以使用下方的“重发验证邮件”。";
    }
    return "This email may already be registered. Try signing in first. If the address is still waiting for verification, you can resend the verification email below.";
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

  function normalizeResetCodeError(message: string) {
    const normalized = normalizeError(message);
    if (/invalid_code|invalid_or_expired|expired|otp|token/i.test(message)) {
      return t("reset.invalidCode");
    }
    return normalized;
  }

  function shouldPreferResetCodeFlow(emailValue: string) {
    const domain = emailValue.trim().toLowerCase().split("@")[1] ?? "";
    return new Set(["qq.com", "vip.qq.com", "foxmail.com", "hotmail.com", "outlook.com", "live.com"]).has(domain);
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

    const snapshotStored = persistSessionSnapshot(session) || hasStoredBrowserSupabaseSessionTokens();
    void establishBrowserSupabaseSession(
      {
        access_token: accessToken,
        refresh_token: refreshToken,
      },
      2600,
    ).catch(() => null);

    const recoveredSession = await Promise.race([
      supabase.auth.getSession().then(({ data }) => data.session ?? null).catch(() => null),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), 180);
      }),
    ]);
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
            emailRedirectTo: `${authEmailRedirectOrigin || window.location.origin}/login`,
          },
        }),
      );
      if (error) {
        if (isUserAlreadyRegistered(error.message, (error as { code?: string }).code)) {
          setNeedConfirmEmail(true);
          return setMsg(getRegisteredAccountMessage());
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
            emailRedirectTo: `${authEmailRedirectOrigin || window.location.origin}/login`,
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
    setPendingResetEmail("");
    setPendingResetEmailMasked("");
    setResetCode("");

    const trimmedEmail = account.trim();
    if (!trimmedEmail) return setMsg(t("login.inputEmailBeforeForgot"));
    if (!trimmedEmail.includes("@")) return setMsg(t("login.invalidEmail"));
    const preferResetCodeFlow = shouldPreferResetCodeFlow(trimmedEmail);
    const gatewayReady = await canReachSupabaseGateway(4000);
    setGatewayReachable(gatewayReady);

    setPendingAction("forgot");
    try {
      const response = await withTimeout(
        fetch(preferResetCodeFlow ? "/api/auth/reset-password/request-code" : "/api/auth/reset-password/request", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            email: trimmedEmail,
          }),
        }),
      );
      const payload = (await response.json().catch(() => null)) as
        | { ok?: unknown; error?: unknown; maskedEmail?: unknown }
        | null;
      if (!response.ok || payload?.ok !== true) {
        const errorMessage = typeof payload?.error === "string" ? payload.error : t("login.requestFailed");
        return setMsg(normalizeError(errorMessage));
      }
      persistResetPasswordEmailRequest(trimmedEmail);
      if (preferResetCodeFlow) {
        const maskedEmail = typeof payload?.maskedEmail === "string" ? payload.maskedEmail : trimmedEmail;
        setPendingResetEmail(trimmedEmail);
        setPendingResetEmailMasked(maskedEmail);
        setResetCode("");
      }
      setMsg(t("login.forgotSuccess"));
    } catch (error) {
      setMsg(error instanceof Error ? normalizeError(error.message) : t("login.requestFailed"));
    } finally {
      setPendingAction(null);
    }
  }

  async function verifyResetCode() {
    if (pendingAction) return;
    setMsg("");

    const email = pendingResetEmail.trim() || account.trim().toLowerCase();
    if (!email || !email.includes("@")) return setMsg(t("login.inputEmailBeforeForgot"));
    if (!resetCode.trim()) return setMsg(t("reset.invalidCode"));

    setPendingAction("verify_reset_code");
    try {
      const response = await withTimeout(
        fetch("/api/auth/reset-password/verify-code", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            email,
            code: resetCode,
          }),
        }),
      );
      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: unknown;
            error?: unknown;
            ready?: unknown;
          }
        | null;
      if (!response.ok || payload?.ok !== true) {
        const errorMessage = typeof payload?.error === "string" ? payload.error : t("login.requestFailed");
        throw new Error(errorMessage);
      }
      if (payload?.ready !== true) {
        throw new Error(t("reset.sessionExpired"));
      }
      clearStoredResetPasswordRecoveryPayload();
      window.location.href = "/reset-password";
    } catch (error) {
      setMsg(error instanceof Error ? normalizeResetCodeError(error.message) : t("reset.invalidCode"));
    } finally {
      setPendingAction(null);
    }
  }

  const fieldClassName =
    "w-full rounded-[20px] border border-slate-200 bg-white px-4 py-3.5 text-[16px] text-slate-900 shadow-[0_10px_28px_rgba(15,23,42,0.06)] outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-4 focus:ring-slate-900/8 md:rounded-[22px] md:py-4";
  const secondaryButtonClassName =
    "rounded-[18px] border border-slate-200 bg-white/88 px-4 py-3 text-sm font-medium text-slate-700 shadow-[0_8px_24px_rgba(15,23,42,0.06)] transition hover:border-slate-300 hover:bg-white disabled:opacity-50 md:rounded-[20px]";
  const androidKeyboardOpen = isAndroid && androidKeyboardInset >= 100;
  const mobileFormSectionStyle =
    androidKeyboardInset > 0
      ? {
          paddingBottom: `calc(env(safe-area-inset-bottom) + 0.9rem + ${androidKeyboardInset}px)`,
        }
      : undefined;

  return (
    <main className="relative h-[100dvh] min-h-screen overflow-hidden overscroll-none bg-[#0b1424] text-slate-900">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,_#0b1424_0%,_#13213a_52%,_#eef4ff_100%)]" />
      <div className="absolute inset-x-0 top-0 h-[30rem] bg-[radial-gradient(circle_at_top,_rgba(125,211,252,0.16),_transparent_58%)]" />

      <div className="relative mx-auto flex h-full w-full max-w-6xl flex-col md:min-h-screen md:px-6 md:py-8">
        <div className="flex h-full w-full flex-col overflow-hidden md:min-h-0 md:flex-1 md:flex-row md:rounded-[34px] md:border md:border-white/10 md:bg-[#0f1a2f]/72 md:shadow-[0_28px_84px_rgba(8,17,33,0.28)]">
          <section
            className={`relative shrink-0 px-5 pb-4 pt-[calc(env(safe-area-inset-top)+0.875rem)] text-white sm:px-6 md:flex md:w-[44%] md:flex-col md:px-10 md:py-12 ${
              androidKeyboardOpen ? "hidden md:flex" : ""
            }`}
          >
            <div className="inline-flex w-fit items-center gap-3 rounded-full border border-white/14 bg-white/10 px-4 py-2 text-xs font-medium tracking-[0.24em] text-cyan-50/90 uppercase backdrop-blur">
              <span className="inline-flex h-2 w-2 rounded-full bg-emerald-300" />
              {secureAccessLabel}
            </div>

            <div className="mt-4 flex items-center gap-3 md:mt-7 md:gap-4">
              <div className="h-12 w-12 overflow-hidden rounded-[18px] shadow-[0_16px_40px_rgba(8,17,33,0.28)] md:h-16 md:w-16 md:rounded-[24px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/faolla-login-logo.png"
                  alt="Faolla logo"
                  className="h-full w-full object-cover"
                  loading="eager"
                  decoding="async"
                />
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.28em] text-slate-200/72">Merchant Space</div>
                <div className="mt-1 text-[1.7rem] font-semibold leading-none text-white md:mt-2 md:text-4xl">{t("login.title")}</div>
              </div>
            </div>

            <div className="mt-7 hidden max-w-md text-sm leading-7 text-slate-100/82 md:block md:text-[15px]">
              {loginAccountTip}
            </div>

            <div className="mt-6 hidden flex-wrap gap-2 md:flex">
              {loginMethodPills.map((pill) => (
                <span
                  key={pill}
                  className="rounded-full border border-white/14 bg-white/10 px-3 py-1.5 text-xs font-medium text-slate-50/92 backdrop-blur"
                >
                  {pill}
                </span>
              ))}
            </div>

            <div className="mt-8 hidden gap-3 md:mt-auto md:grid">
              <div className="rounded-[26px] border border-white/12 bg-white/10 p-4 backdrop-blur">
                <div className="text-xs uppercase tracking-[0.24em] text-cyan-100/70">Faolla</div>
                <div className="mt-2 text-lg font-semibold text-white">{continueLabel}</div>
                <div className="mt-1 text-sm leading-6 text-slate-100/72">
                  {emailConfirmationRequired === false ? t("login.firstRegisterTipAutoConfirm") : t("login.firstRegisterTip")}
                </div>
              </div>
            </div>
          </section>

          <section
            className={`relative flex min-h-0 flex-1 flex-col bg-[linear-gradient(180deg,_rgba(248,251,255,0.96)_0%,_#ffffff_34%,_#f8fbff_100%)] px-5 pt-4 sm:px-6 md:rounded-none md:px-10 md:py-12 md:shadow-none ${
              androidKeyboardOpen ? "rounded-t-none shadow-none" : "rounded-t-[28px] shadow-[0_-24px_60px_rgba(8,17,33,0.24)]"
            }`}
            style={mobileFormSectionStyle}
          >
            <div
              ref={formViewportRef}
              className={`mx-auto flex h-full min-h-0 w-full max-w-md flex-col overflow-y-auto overscroll-contain ${
                androidKeyboardOpen ? "justify-start pt-2" : "justify-center"
              } md:overflow-visible`}
            >
              <div className="space-y-4 md:space-y-6">
                <div className="space-y-1.5 md:space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Account</div>
                  <div className="text-2xl font-semibold tracking-tight text-slate-950">{t("login.title")}</div>
                  <div className="hidden text-sm leading-6 text-slate-500 md:block">
                    {loggedOut ? t("login.signIn") : loginAccountTip}
                  </div>
                  <div className="text-sm leading-5 text-slate-500 md:hidden">{loggedOut ? t("login.signIn") : secureAccessLabel}</div>
                </div>

                <div className="space-y-3 md:space-y-4">
                  <div className="hidden" aria-hidden="true">
                    <input type="text" tabIndex={-1} autoComplete="username" />
                    <input type="password" tabIndex={-1} autoComplete="current-password" />
                  </div>

                  <div className="space-y-2">
                    <div className="px-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{loginAccountLabel}</div>
                    <input
                      ref={accountInputRef}
                      className={fieldClassName}
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
                    <div className="px-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{t("login.password")}</div>
                    <PasswordField
                      ref={passwordInputRef}
                      className={fieldClassName}
                      name="merchant-login-password"
                      autoComplete="new-password"
                      data-lpignore="true"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        void signIn();
                      }}
                      placeholder={t("login.passwordMin6")}
                      showLabel={passwordToggleLabels.show}
                      hideLabel={passwordToggleLabels.hide}
                      toggleButtonTabIndex={-1}
                    />
                  </div>
                </div>

                {msg ? (
                  <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700 shadow-[0_10px_28px_rgba(15,23,42,0.04)] md:rounded-[22px]">
                    {msg}
                  </div>
                ) : null}

                <div className="space-y-3">
                  <button
                    className="w-full rounded-[20px] bg-slate-950 px-4 py-3.5 text-[15px] font-semibold text-white shadow-[0_18px_40px_rgba(15,23,42,0.24)] transition hover:bg-slate-800 disabled:opacity-50 md:rounded-[22px] md:py-4"
                    onClick={signIn}
                    disabled={pendingAction !== null}
                  >
                    {pendingAction === "signin" ? t("login.signingIn") : t("login.signIn")}
                  </button>

                  <div className="grid grid-cols-2 gap-3">
                    <button className={secondaryButtonClassName} onClick={signUp} disabled={pendingAction !== null}>
                      {pendingAction === "signup" ? t("login.signingUp") : t("login.signUp")}
                    </button>
                    <button className={secondaryButtonClassName} onClick={forgotPassword} disabled={pendingAction !== null}>
                      {pendingAction === "forgot" ? t("common.sending") : t("login.forgot")}
                    </button>
                  </div>

                  {isDevelopment && gatewayReachable === false ? (
                    <button
                      className="w-full rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 transition hover:bg-amber-100"
                      onClick={() => (window.location.href = "/admin?offline=1")}
                      disabled={pendingAction !== null}
                    >
                      {t("login.offlineDev")}
                    </button>
                  ) : null}

                  {pendingResetEmail && shouldShowResetCodePreferredHint ? (
                    <div className="rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900 md:rounded-[22px]">
                      {resetCodePreferredHint}
                    </div>
                  ) : null}

                  {pendingResetEmail ? (
                    <div className="space-y-3 rounded-[22px] border border-slate-200 bg-white/90 p-4 shadow-[0_14px_32px_rgba(15,23,42,0.05)] md:rounded-[26px]">
                      <div className="text-sm font-medium text-slate-600">
                        {t("login.resetCodeLabel")}
                        {pendingResetEmailMasked ? <span className="ml-2 text-xs text-slate-400">{pendingResetEmailMasked}</span> : null}
                      </div>
                      <input
                        className={fieldClassName}
                        value={resetCode}
                        onChange={(event) => setResetCode(event.target.value)}
                        placeholder={t("login.resetCodePlaceholder")}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                      />
                      <button
                        className={secondaryButtonClassName}
                        onClick={verifyResetCode}
                        disabled={pendingAction !== null}
                      >
                        {pendingAction === "verify_reset_code" ? t("login.verifyingResetCode") : t("login.verifyResetCode")}
                      </button>
                    </div>
                  ) : null}

                  {needConfirmEmail ? (
                    <button
                      className={secondaryButtonClassName}
                      onClick={resendConfirmationEmail}
                      disabled={pendingAction !== null}
                    >
                      {pendingAction === "resend" ? t("common.sending") : t("login.resend")}
                    </button>
                  ) : null}

                  <div className="hidden px-1 text-xs leading-6 text-slate-400 md:block">
                    {emailConfirmationRequired === false ? t("login.firstRegisterTipAutoConfirm") : t("login.firstRegisterTip")}
                  </div>
                </div>
              </div>
            </div>
            </section>
          </div>
        </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#0b1424]" />}>
      <LoginPageInner />
    </Suspense>
  );
}
