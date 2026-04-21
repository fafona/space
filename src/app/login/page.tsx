"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/components/I18nProvider";
import PasswordField, { getPasswordToggleLabels } from "@/components/PasswordField";
import {
  clearStoredBrowserSupabaseSessionTokens,
  hasStoredBrowserSupabaseSessionTokens,
  readMerchantSessionMerchantIds,
  readMerchantSessionPayload,
} from "@/lib/authSessionRecovery";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
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
} from "@/lib/supabase";
import { type PlatformAccountType } from "@/lib/platformAccounts";

type LoginAuthUser = {
  id?: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
};

type ServerSignInResult = {
  user: LoginAuthUser | null;
  accountType: PlatformAccountType;
  accountId: string;
  merchantId: string;
  merchantIds: string[];
  needsJustSignedInBridge: boolean;
};

type AuthView = "signin" | "signup_personal" | "signup_merchant";

function isAndroidBrowser() {
  if (typeof navigator === "undefined") return false;
  return /android/i.test(String(navigator.userAgent ?? ""));
}

function isStandaloneDisplayMode() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true;
}

function pickPrimaryMerchantId(preferredMerchantId: string | null | undefined, merchantIds: string[]) {
  const directMerchantId = String(preferredMerchantId ?? "").trim();
  if (directMerchantId) return directMerchantId;
  return merchantIds.find((value) => isMerchantNumericId(value)) ?? merchantIds[0] ?? "";
}

function normalizePlatformAccountType(value: unknown): PlatformAccountType | "" {
  if (value === "personal") return "personal";
  if (value === "merchant") return "merchant";
  return "";
}

function normalizePlatformAccountId(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return /^\d{8}$/.test(normalized) ? normalized : "";
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
  const [pendingSignupVerificationEmail, setPendingSignupVerificationEmail] = useState("");
  const [pendingSignupVerificationMaskedEmail, setPendingSignupVerificationMaskedEmail] = useState("");
  const [pendingSignupVerificationAccountType, setPendingSignupVerificationAccountType] =
    useState<PlatformAccountType | null>(null);
  const [signupCode, setSignupCode] = useState("");
  const [authView, setAuthView] = useState<AuthView>("signin");
  const [pendingAction, setPendingAction] = useState<
    "signin" | "signup" | "forgot" | "resend" | "resend_signup_code" | "verify_reset_code" | "verify_signup_code" | null
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
  const registrationEmailLabel = useMemo(() => {
    if (normalizedLocale.startsWith("zh-tw")) return "註冊信箱";
    if (normalizedLocale.startsWith("ja")) return "登録メール";
    if (normalizedLocale.startsWith("ko")) return "가입 이메일";
    if (normalizedLocale.startsWith("zh")) return "注册邮箱";
    return "Registration Email";
  }, [normalizedLocale]);
  const registrationEmailPlaceholder = useMemo(() => {
    if (normalizedLocale.startsWith("zh-tw")) return "請輸入註冊信箱";
    if (normalizedLocale.startsWith("ja")) return "登録メールアドレスを入力";
    if (normalizedLocale.startsWith("ko")) return "가입 이메일을 입력하세요";
    if (normalizedLocale.startsWith("zh")) return "请输入注册邮箱";
    return "Enter your registration email";
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
  const signupCodePreferredHint = useMemo(() => {
    if (normalizedLocale.startsWith("zh-tw")) {
      return "QQ、Foxmail、Hotmail、Outlook、Live 這些信箱請直接輸入註冊驗證碼，不要點郵件連結。";
    }
    if (normalizedLocale.startsWith("ja")) {
      return "QQ / Foxmail / Hotmail / Outlook / Live のメールは、登録確認コードを入力してください。メールリンクは使わないでください。";
    }
    if (normalizedLocale.startsWith("ko")) {
      return "QQ / Foxmail / Hotmail / Outlook / Live 메일은 가입 인증 코드를 입력해 주세요. 메일 링크는 누르지 마세요.";
    }
    if (normalizedLocale.startsWith("zh")) {
      return "QQ、Foxmail、Hotmail、Outlook、Live 这些邮箱请直接输入注册验证码，不要点邮件链接。";
    }
    return "QQ, Foxmail, Hotmail, Outlook, and Live mailboxes should use the registration code instead of the email link.";
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
  const welcomeLoginTitle = useMemo(() => {
    if (normalizedLocale.startsWith("zh-tw")) return "歡迎登入Faolla";
    if (normalizedLocale.startsWith("ja")) return "Faollaへようこそ";
    if (normalizedLocale.startsWith("ko")) return "Faolla에 로그인";
    if (normalizedLocale.startsWith("zh")) return "欢迎登录Faolla";
    return "Welcome to Faolla";
  }, [normalizedLocale]);
  const passwordToggleLabels = useMemo(() => getPasswordToggleLabels(locale), [locale]);
  const shouldShowResetCodePreferredHint = useMemo(
    () => shouldPreferResetCodeFlow(pendingResetEmail || account),
    [account, pendingResetEmail],
  );
  const shouldShowSignupCodePreferredHint = useMemo(
    () => shouldPreferResetCodeFlow(pendingSignupVerificationEmail || account),
    [account, pendingSignupVerificationEmail],
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

  const personalSignUpLabel = useMemo(() => {
    if (normalizedLocale.startsWith("zh")) return "个人注册";
    return "Personal Sign Up";
  }, [normalizedLocale]);
  const merchantSignUpLabel = useMemo(() => {
    if (normalizedLocale.startsWith("zh")) return "商家注册";
    return "Merchant Sign Up";
  }, [normalizedLocale]);
  const personalSignUpTip = useMemo(() => {
    if (normalizedLocale.startsWith("zh-tw")) return "使用信箱完成個人帳號註冊，註冊後可進入個人中心。";
    if (normalizedLocale.startsWith("ja")) return "メールで個人アカウントを登録し、登録後は個人センターに入れます。";
    if (normalizedLocale.startsWith("ko")) return "이메일로 개인 계정을 등록하면 가입 후 개인 센터로 들어갑니다.";
    if (normalizedLocale.startsWith("zh")) return "使用邮箱完成个人账号注册，注册后可进入个人中心。";
    return "Register a personal account with your email, then enter your personal center.";
  }, [normalizedLocale]);
  const merchantSignUpTip = useMemo(() => {
    if (normalizedLocale.startsWith("zh-tw")) return "使用信箱完成商家帳號註冊，註冊後可進入商戶後台。";
    if (normalizedLocale.startsWith("ja")) return "メールで商家アカウントを登録し、登録後は商戸バックエンドに入れます。";
    if (normalizedLocale.startsWith("ko")) return "이메일로 상가 계정을 등록하면 가입 후 상인 백엔드로 들어갑니다.";
    if (normalizedLocale.startsWith("zh")) return "使用邮箱完成商家账号注册，注册后可进入商户后台。";
    return "Register a merchant account with your email, then enter the merchant admin.";
  }, [normalizedLocale]);
  const authSectionLabel = useMemo(() => {
    if (authView === "signup_personal") return personalSignUpLabel;
    if (authView === "signup_merchant") return merchantSignUpLabel;
    if (normalizedLocale.startsWith("zh-tw")) return "帳號";
    if (normalizedLocale.startsWith("ja")) return "アカウント";
    if (normalizedLocale.startsWith("ko")) return "계정";
    if (normalizedLocale.startsWith("zh")) return "账号";
    return "Account";
  }, [authView, merchantSignUpLabel, normalizedLocale, personalSignUpLabel]);
  const authPrimaryTitle = useMemo(() => {
    if (authView === "signup_personal") return personalSignUpLabel;
    if (authView === "signup_merchant") return merchantSignUpLabel;
    return welcomeLoginTitle;
  }, [authView, merchantSignUpLabel, personalSignUpLabel, welcomeLoginTitle]);
  const authDescription = useMemo(() => {
    if (authView === "signup_personal") return personalSignUpTip;
    if (authView === "signup_merchant") return merchantSignUpTip;
    return loginAccountTip;
  }, [authView, loginAccountTip, merchantSignUpTip, personalSignUpTip]);
  const authHeroPills = useMemo(() => {
    if (authView === "signup_personal") {
      if (normalizedLocale.startsWith("zh")) return ["邮箱注册", "个人中心"];
      return ["Email Sign Up", "Personal Center"];
    }
    if (authView === "signup_merchant") {
      if (normalizedLocale.startsWith("zh")) return ["邮箱注册", "商户后台"];
      return ["Email Sign Up", "Merchant Admin"];
    }
    return loginMethodPills;
  }, [authView, loginMethodPills, normalizedLocale]);
  const accountFieldLabel = authView === "signin" ? loginAccountLabel : registrationEmailLabel;
  const accountFieldPlaceholder = authView === "signin" ? loginAccountPlaceholder : registrationEmailPlaceholder;
  const activeSignupAccountType: PlatformAccountType | null =
    authView === "signup_personal" ? "personal" : authView === "signup_merchant" ? "merchant" : null;
  const signUpSubmitLabel = useMemo(() => {
    if (normalizedLocale.startsWith("zh-tw")) return "註冊";
    if (normalizedLocale.startsWith("ja")) return "登録";
    if (normalizedLocale.startsWith("ko")) return "가입";
    if (normalizedLocale.startsWith("zh")) return "注册";
    return "Sign Up";
  }, [normalizedLocale]);
  const signingUpSubmitLabel = useMemo(() => {
    if (normalizedLocale.startsWith("zh-tw")) return "註冊中...";
    if (normalizedLocale.startsWith("ja")) return "登録中...";
    if (normalizedLocale.startsWith("ko")) return "가입 중...";
    if (normalizedLocale.startsWith("zh")) return "注册中...";
    return "Signing up...";
  }, [normalizedLocale]);
  const signUpSuccessBackToLoginMessage = useMemo(() => {
    if (normalizedLocale.startsWith("zh-tw")) return "註冊成功，請登入。";
    if (normalizedLocale.startsWith("ja")) return "登録が完了しました。ログインしてください。";
    if (normalizedLocale.startsWith("ko")) return "가입이 완료되었습니다. 로그인해 주세요.";
    if (normalizedLocale.startsWith("zh")) return "注册成功，请登录。";
    return "Registration completed. Please sign in.";
  }, [normalizedLocale]);
  const signUpCodeSentMessage = useMemo(() => {
    if (normalizedLocale.startsWith("zh-tw")) return "註冊驗證碼已發送，請輸入驗證碼完成註冊。";
    if (normalizedLocale.startsWith("ja")) return "登録確認コードを送信しました。コードを入力して登録を完了してください。";
    if (normalizedLocale.startsWith("ko")) return "가입 인증 코드를 보냈습니다. 코드를 입력해 가입을 완료해 주세요.";
    if (normalizedLocale.startsWith("zh")) return "注册验证码已发送，请输入验证码完成注册。";
    return "The registration code has been sent. Enter it to complete registration.";
  }, [normalizedLocale]);
  const signUpCodeFallbackMessage = useMemo(() => {
    if (normalizedLocale.startsWith("zh-tw")) return "註冊已提交。請檢查信箱驗證，或使用下方按鈕重發驗證碼。";
    if (normalizedLocale.startsWith("ja")) return "登録を受け付けました。メールを確認するか、下のボタンで確認コードを再送してください。";
    if (normalizedLocale.startsWith("ko")) return "가입이 접수되었습니다. 이메일을 확인하거나 아래 버튼으로 인증 코드를 다시 보내세요.";
    if (normalizedLocale.startsWith("zh")) return "注册已提交。请检查邮箱验证，或使用下方按钮重发验证码。";
    return "Registration submitted. Check your email or resend the code below.";
  }, [normalizedLocale]);
  const signUpCodeVerifiedMessage = useMemo(() => {
    if (normalizedLocale.startsWith("zh-tw")) return "註冊驗證成功，請登入。";
    if (normalizedLocale.startsWith("ja")) return "登録確認が完了しました。ログインしてください。";
    if (normalizedLocale.startsWith("ko")) return "가입 인증이 완료되었습니다. 로그인해 주세요.";
    if (normalizedLocale.startsWith("zh")) return "注册验证成功，请登录。";
    return "Registration verified. Please sign in.";
  }, [normalizedLocale]);
  const signupCodeLabel = useMemo(() => {
    if (normalizedLocale.startsWith("zh-tw")) return "註冊驗證碼";
    if (normalizedLocale.startsWith("ja")) return "登録確認コード";
    if (normalizedLocale.startsWith("ko")) return "가입 인증 코드";
    if (normalizedLocale.startsWith("zh")) return "注册验证码";
    return "Registration Code";
  }, [normalizedLocale]);
  const verifySignupCodeLabel = useMemo(() => {
    if (normalizedLocale.startsWith("zh-tw")) return "驗證並完成註冊";
    if (normalizedLocale.startsWith("ja")) return "確認して登録完了";
    if (normalizedLocale.startsWith("ko")) return "인증하고 가입 완료";
    if (normalizedLocale.startsWith("zh")) return "验证并完成注册";
    return "Verify and Finish Sign Up";
  }, [normalizedLocale]);
  const resendSignupCodeLabel = useMemo(() => {
    if (normalizedLocale.startsWith("zh-tw")) return "重發註冊驗證碼";
    if (normalizedLocale.startsWith("ja")) return "登録確認コードを再送";
    if (normalizedLocale.startsWith("ko")) return "가입 인증 코드 다시 보내기";
    if (normalizedLocale.startsWith("zh")) return "重发注册验证码";
    return "Resend Registration Code";
  }, [normalizedLocale]);
  const verifyingSignupCodeLabel = useMemo(() => {
    if (normalizedLocale.startsWith("zh-tw")) return "驗證中...";
    if (normalizedLocale.startsWith("ja")) return "確認中...";
    if (normalizedLocale.startsWith("ko")) return "인증 중...";
    if (normalizedLocale.startsWith("zh")) return "验证中...";
    return "Verifying...";
  }, [normalizedLocale]);
  const redirectToAccountHome = useCallback(
    async (
      _user?: {
        id?: string;
        email?: string | null;
        user_metadata?: Record<string, unknown> | null;
        app_metadata?: Record<string, unknown> | null;
      } | null,
      session?: {
        accountType?: PlatformAccountType | "";
        accountId?: string | null;
        merchantId?: string | null;
        merchantIds?: string[];
      },
      options?: { withSignInBridge?: boolean },
    ) => {
      const accountType = session?.accountType === "personal" ? "personal" : "merchant";
      if (accountType === "personal") {
        const targetHref = requestedRedirectPath.startsWith("/me") ? requestedRedirectPath : "/me";
        window.location.href = targetHref;
        return;
      }

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

      if (requestedRedirectPath && !requestedRedirectPath.startsWith("/me")) {
        window.location.href = decorateMerchantHref(requestedRedirectPath);
        return;
      }

      const directMerchantId = String(session?.merchantId ?? "").trim();
      if (directMerchantId) {
        window.location.href = decorateMerchantHref(buildMerchantBackendHref(directMerchantId));
        return;
      }
      const resolvedMerchantId = pickPrimaryMerchantId(null, session?.merchantIds ?? []);
      if (resolvedMerchantId) {
        window.location.href = decorateMerchantHref(buildMerchantBackendHref(resolvedMerchantId));
        return;
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

  async function readValidatedCookieBackedSession() {
    const payload = await readMerchantSessionPayload(2600).catch(() => null);
    if (!payload || payload.authenticated !== true || !payload.user) return null;
    const merchantIds = readMerchantSessionMerchantIds(payload);
    const accountType = normalizePlatformAccountType(payload.accountType) || (merchantIds.length > 0 ? "merchant" : "");
    return {
      user: payload.user as LoginAuthUser,
      accountType: accountType || "merchant",
      accountId: normalizePlatformAccountId(payload.accountId),
      merchantId: pickPrimaryMerchantId(
        typeof payload.merchantId === "string" ? payload.merchantId.trim() : "",
        merchantIds,
      ),
      merchantIds,
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
        const cookieBackedSession = await readValidatedCookieBackedSession();
        if (!mounted) return;
        if (cookieBackedSession?.user) {
          clearStoredBrowserSupabaseSessionTokens();
          await redirectToAccountHome(cookieBackedSession.user, {
            accountType: cookieBackedSession.accountType,
            accountId: cookieBackedSession.accountId,
            merchantId: cookieBackedSession.merchantId,
            merchantIds: cookieBackedSession.merchantIds,
          }, {
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
  }, [redirectToAccountHome]);

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
      return "此信箱可能已註冊。請先直接登入；如果還沒有完成信箱驗證，可以使用下方的「重發註冊驗證碼」。";
    }
    if (normalizedLocale.startsWith("ja")) {
      return "このメールアドレスは既に登録済みの可能性があります。まずは直接ログインを試し、未確認の場合は下の登録確認コード再送を使ってください。";
    }
    if (normalizedLocale.startsWith("ko")) {
      return "이 이메일은 이미 등록되어 있을 수 있습니다. 먼저 바로 로그인해 보시고, 아직 이메일 인증이 끝나지 않았다면 아래의 가입 인증 코드 재전송을 눌러 주세요.";
    }
    if (normalizedLocale.startsWith("zh")) {
      return "该邮箱可能已注册。请先直接登录；如果还没有完成邮箱验证，可以使用下方的“重发注册验证码”。";
    }
    return "This email may already be registered. Try signing in first. If the address is still waiting for verification, you can resend the registration code below.";
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
          accountType?: unknown;
          accountId?: unknown;
          merchantId?: unknown;
          merchantIds?: unknown;
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

    const merchantIds = readMerchantSessionMerchantIds(payload);
    return {
      user: (payload?.user ?? null) as LoginAuthUser | null,
      accountType: normalizePlatformAccountType(payload?.accountType) || "merchant",
      accountId: normalizePlatformAccountId(payload?.accountId),
      merchantId: pickPrimaryMerchantId(
        typeof payload?.merchantId === "string" ? payload.merchantId.trim() : "",
        merchantIds,
      ),
      merchantIds,
      needsJustSignedInBridge: false,
    };
  }

  async function signUp(accountType: PlatformAccountType) {
    if (pendingAction) return;
    setMsg("");
    setNeedConfirmEmail(false);
    setPendingSignupVerificationEmail("");
    setPendingSignupVerificationMaskedEmail("");
    setPendingSignupVerificationAccountType(null);
    setSignupCode("");

    const validationError = validateEmailForm();
    if (validationError) return setMsg(validationError);
    const gatewayReady = await canReachSupabaseGateway(4000);
    setGatewayReachable(gatewayReady);

    setPendingAction("signup");
    try {
      const response = await withTimeout(
        fetch("/api/auth/merchant-signup", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          cache: "no-store",
          body: JSON.stringify({
            email: account.trim(),
            password,
            accountType,
          }),
        }),
      );
      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: unknown;
            error?: unknown;
            message?: unknown;
            needsConfirmation?: unknown;
            accountType?: unknown;
            accountId?: unknown;
            merchantId?: unknown;
            merchantIds?: unknown;
            codeSent?: unknown;
            maskedEmail?: unknown;
            user?: LoginAuthUser | null;
          }
        | null;
      if (!response.ok) {
        const message = typeof payload?.message === "string" ? payload.message : typeof payload?.error === "string" ? payload.error : t("login.requestFailed");
        const errorCode = typeof payload?.error === "string" ? payload.error : "";
        if (isUserAlreadyRegistered(message, errorCode)) {
          setNeedConfirmEmail(true);
          setPendingSignupVerificationEmail(account.trim().toLowerCase());
          setPendingSignupVerificationAccountType(accountType);
          return setMsg(getRegisteredAccountMessage());
        }
        return setMsg(normalizeError(message));
      }
      const needsConfirmation = payload?.needsConfirmation === true;
      setEmailConfirmationRequired(needsConfirmation);
      clearStoredBrowserSupabaseSessionTokens();
      setAuthView("signin");
      if (needsConfirmation) {
        setPendingSignupVerificationEmail(account.trim().toLowerCase());
        setPendingSignupVerificationMaskedEmail(
          typeof payload?.maskedEmail === "string" ? payload.maskedEmail : account.trim().toLowerCase(),
        );
        setPendingSignupVerificationAccountType(accountType);
        setMsg(payload?.codeSent === true ? signUpCodeSentMessage : signUpCodeFallbackMessage);
      } else {
        setPendingSignupVerificationEmail("");
        setPendingSignupVerificationMaskedEmail("");
        setPendingSignupVerificationAccountType(null);
        setMsg(signUpSuccessBackToLoginMessage);
      }
      setNeedConfirmEmail(needsConfirmation);
    } catch (error) {
      setMsg(error instanceof Error ? normalizeError(error.message) : t("login.requestFailed"));
    } finally {
      setPendingAction(null);
    }
  }

  function selectSignupView(accountType: PlatformAccountType) {
    if (pendingAction) return;
    setAuthView(accountType === "personal" ? "signup_personal" : "signup_merchant");
    setMsg("");
    setNeedConfirmEmail(false);
    setPendingResetEmail("");
    setPendingResetEmailMasked("");
    setPendingSignupVerificationEmail("");
    setPendingSignupVerificationMaskedEmail("");
    setPendingSignupVerificationAccountType(null);
    setResetCode("");
    setSignupCode("");
  }

  function submitPrimaryAuthAction() {
    if (activeSignupAccountType) {
      void signUp(activeSignupAccountType);
      return;
    }
    void signIn();
  }

  async function signIn() {
    if (pendingAction) return;
    setAuthView("signin");
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
      const result = await signInViaServer(account, password);
      clearStoredBrowserSupabaseSessionTokens();
      await redirectToAccountHome(result.user, {
        accountType: result.accountType,
        accountId: result.accountId,
        merchantId: result.merchantId,
        merchantIds: result.merchantIds,
      }, {
        withSignInBridge: result.needsJustSignedInBridge,
      });
    } catch (error) {
      const normalizedMessage = error instanceof Error ? normalizeError(error.message) : t("login.requestFailed");
      setNeedConfirmEmail(normalizedMessage === t("login.emailNotConfirmed"));
      if (normalizedMessage === t("login.emailNotConfirmed") && account.includes("@")) {
        setPendingSignupVerificationEmail(account.trim().toLowerCase());
        setPendingSignupVerificationMaskedEmail(account.trim().toLowerCase());
        setSignupCode("");
      }
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

    const trimmedEmail = (pendingSignupVerificationEmail || account).trim().toLowerCase();
    if (!trimmedEmail) return setMsg(t("login.inputRegisterEmailFirst"));
    if (!trimmedEmail.includes("@")) return setMsg(t("login.invalidEmail"));
    const gatewayReady = await canReachSupabaseGateway(4000);
    setGatewayReachable(gatewayReady);

    setPendingAction("resend_signup_code");
    try {
      const response = await withTimeout(
        fetch("/api/auth/merchant-signup/request-code", {
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
      setPendingSignupVerificationEmail(trimmedEmail);
      setPendingSignupVerificationMaskedEmail(
        typeof payload?.maskedEmail === "string" ? payload.maskedEmail : trimmedEmail,
      );
      setSignupCode("");
      setMsg(signUpCodeSentMessage);
    } catch (error) {
      setMsg(error instanceof Error ? normalizeError(error.message) : t("login.requestFailed"));
    } finally {
      setPendingAction(null);
    }
  }

  async function verifySignupCode() {
    if (pendingAction) return;
    setMsg("");

    const email = (pendingSignupVerificationEmail || account).trim().toLowerCase();
    if (!email || !email.includes("@")) return setMsg(t("login.inputRegisterEmailFirst"));
    if (!signupCode.trim()) return setMsg(t("reset.invalidCode"));

    setPendingAction("verify_signup_code");
    try {
      const response = await withTimeout(
        fetch("/api/auth/merchant-signup/verify-code", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            email,
            code: signupCode,
            accountType: pendingSignupVerificationAccountType ?? undefined,
          }),
        }),
      );
      const payload = (await response.json().catch(() => null)) as
        | { ok?: unknown; error?: unknown; verified?: unknown }
        | null;
      if (!response.ok || payload?.ok !== true || payload?.verified !== true) {
        const errorMessage = typeof payload?.error === "string" ? payload.error : t("login.requestFailed");
        throw new Error(errorMessage);
      }
      setPendingSignupVerificationEmail("");
      setPendingSignupVerificationMaskedEmail("");
      setPendingSignupVerificationAccountType(null);
      setSignupCode("");
      setNeedConfirmEmail(false);
      setAuthView("signin");
      setMsg(signUpCodeVerifiedMessage);
    } catch (error) {
      setMsg(error instanceof Error ? normalizeResetCodeError(error.message) : t("reset.invalidCode"));
    } finally {
      setPendingAction(null);
    }
  }

  async function forgotPassword() {
    if (pendingAction) return;
    setAuthView("signin");
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
  const signupSwitchButtonClassName = (active: boolean) =>
    active
      ? "rounded-[18px] border border-slate-950 bg-slate-950 px-4 py-3 text-sm font-medium text-white shadow-[0_8px_24px_rgba(15,23,42,0.14)] transition hover:bg-slate-900 disabled:opacity-50 md:rounded-[20px]"
      : secondaryButtonClassName;
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
                <div className="text-xs font-medium uppercase tracking-[0.28em] text-slate-200/72">Faolla Account</div>
                <div className="mt-1 text-[1.7rem] font-semibold leading-none text-white md:mt-2 md:text-4xl">{authPrimaryTitle}</div>
              </div>
            </div>

            <div className="mt-7 hidden max-w-md text-sm leading-7 text-slate-100/82 md:block md:text-[15px]">
              {authDescription}
            </div>

            <div className="mt-6 hidden flex-wrap gap-2 md:flex">
              {authHeroPills.map((pill) => (
                <span
                  key={pill}
                  className="rounded-full border border-white/14 bg-white/10 px-3 py-1.5 text-xs font-medium text-slate-50/92 backdrop-blur"
                >
                  {pill}
                </span>
              ))}
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
                  <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">{authSectionLabel}</div>
                  <div className="text-2xl font-semibold tracking-tight text-slate-950">{authPrimaryTitle}</div>
                  <div className="hidden text-sm leading-6 text-slate-500 md:block">
                    {loggedOut ? t("login.signIn") : authDescription}
                  </div>
                  <div className="text-sm leading-5 text-slate-500 md:hidden">{loggedOut ? t("login.signIn") : authDescription}</div>
                </div>

                <div className="space-y-3 md:space-y-4">
                  <div className="hidden" aria-hidden="true">
                    <input type="text" tabIndex={-1} autoComplete="username" />
                    <input type="password" tabIndex={-1} autoComplete="current-password" />
                  </div>

                  <div className="space-y-2">
                    <div className="px-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{accountFieldLabel}</div>
                    <input
                      ref={accountInputRef}
                      className={fieldClassName}
                      type={authView === "signin" ? "text" : "email"}
                      name="merchant-login-account"
                      autoComplete="off"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      data-lpignore="true"
                      value={account}
                      onChange={(e) => setAccount(e.target.value)}
                      placeholder={accountFieldPlaceholder}
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
                        submitPrimaryAuthAction();
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
                    onClick={submitPrimaryAuthAction}
                    disabled={pendingAction !== null}
                  >
                    {pendingAction === "signin"
                      ? t("login.signingIn")
                      : pendingAction === "signup"
                        ? signingUpSubmitLabel
                        : activeSignupAccountType
                          ? signUpSubmitLabel
                          : t("login.signIn")}
                  </button>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <button
                      className={signupSwitchButtonClassName(authView === "signup_personal")}
                      onClick={() => selectSignupView("personal")}
                      disabled={pendingAction !== null}
                    >
                      {personalSignUpLabel}
                    </button>
                    <button
                      className={signupSwitchButtonClassName(authView === "signup_merchant")}
                      onClick={() => selectSignupView("merchant")}
                      disabled={pendingAction !== null}
                    >
                      {merchantSignUpLabel}
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

                  {pendingSignupVerificationEmail && shouldShowSignupCodePreferredHint ? (
                    <div className="rounded-[20px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900 md:rounded-[22px]">
                      {signupCodePreferredHint}
                    </div>
                  ) : null}

                  {pendingSignupVerificationEmail ? (
                    <div className="space-y-3 rounded-[22px] border border-slate-200 bg-white/90 p-4 shadow-[0_14px_32px_rgba(15,23,42,0.05)] md:rounded-[26px]">
                      <div className="text-sm font-medium text-slate-600">
                        {signupCodeLabel}
                        {pendingSignupVerificationMaskedEmail ? (
                          <span className="ml-2 text-xs text-slate-400">{pendingSignupVerificationMaskedEmail}</span>
                        ) : null}
                      </div>
                      <input
                        className={fieldClassName}
                        value={signupCode}
                        onChange={(event) => setSignupCode(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter") return;
                          event.preventDefault();
                          void verifySignupCode();
                        }}
                        placeholder={t("login.resetCodePlaceholder")}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        inputMode="numeric"
                      />
                      <button
                        className={secondaryButtonClassName}
                        onClick={verifySignupCode}
                        disabled={pendingAction !== null}
                      >
                        {pendingAction === "verify_signup_code" ? verifyingSignupCodeLabel : verifySignupCodeLabel}
                      </button>
                    </div>
                  ) : null}

                  {needConfirmEmail ? (
                    <button
                      className={secondaryButtonClassName}
                      onClick={resendConfirmationEmail}
                      disabled={pendingAction !== null}
                    >
                      {pendingAction === "resend" || pendingAction === "resend_signup_code"
                        ? t("common.sending")
                        : resendSignupCodeLabel}
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
