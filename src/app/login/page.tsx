"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import { ensureMerchantIdentityForUser } from "@/lib/merchantIdentity";
import { buildMerchantBackendHref } from "@/lib/siteRouting";
import { canReachSupabaseGateway, supabase } from "@/lib/supabase";

export default function LoginPage() {
  const { t } = useI18n();
  const isDevelopment = process.env.NODE_ENV === "development";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string>("");
  const [gatewayReachable, setGatewayReachable] = useState<boolean | null>(null);
  const [needConfirmEmail, setNeedConfirmEmail] = useState(false);
  const [pendingAction, setPendingAction] = useState<"signin" | "signup" | "forgot" | "resend" | null>(null);

  async function redirectToMerchantBackend(user?: {
    id?: string;
    email?: string | null;
    user_metadata?: Record<string, unknown> | null;
    app_metadata?: Record<string, unknown> | null;
  } | null) {
    const withJustSignedIn = (href: string) => {
      const url = new URL(href, window.location.origin);
      url.searchParams.set("justSignedIn", "1");
      return `${url.pathname}${url.search}${url.hash}`;
    };

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
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      const gatewayReady = await canReachSupabaseGateway(4000);
      if (!mounted) return;
      setGatewayReachable(gatewayReady);
      if (!gatewayReady) return;
      await supabase.auth
        .getSession()
        .then(({ data }) => {
          if (!mounted) return;
          if (data.session) {
            void redirectToMerchantBackend(data.session.user);
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
  }, []);

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

  function normalizeError(message: string) {
    if (isEmailNotConfirmed(message)) {
      return t("login.emailNotConfirmed");
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
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user) return session.user;
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
    if (!(await canReachSupabaseGateway(4000))) {
      setGatewayReachable(false);
      return setMsg(t("login.backendUnavailable"));
    }
    setGatewayReachable(true);

    setPendingAction("signup");
    try {
      const { error } = await withTimeout(supabase.auth.signUp({ email: email.trim(), password }));
      if (error) return setMsg(normalizeError(error.message));
      setMsg(t("login.signupSuccess"));
      setNeedConfirmEmail(true);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : t("login.requestFailed"));
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
    if (!(await canReachSupabaseGateway(4000))) {
      setGatewayReachable(false);
      if (isDevelopment) {
        window.location.href = "/admin?offline=1";
        return;
      }
      return setMsg(t("login.backendUnavailable"));
    }
    setGatewayReachable(true);

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
      const sessionResult = persistedUser ? null : await supabase.auth.getSession();
      await redirectToMerchantBackend(persistedUser ?? sessionResult?.data.session?.user);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : t("login.requestFailed"));
    } finally {
      setPendingAction(null);
    }
  }

  async function resendConfirmationEmail() {
    if (pendingAction) return;
    setMsg("");

    const trimmedEmail = email.trim();
    if (!trimmedEmail) return setMsg(t("login.inputRegisterEmailFirst"));
    if (!(await canReachSupabaseGateway(4000))) {
      setGatewayReachable(false);
      return setMsg(t("login.backendUnavailable"));
    }
    setGatewayReachable(true);

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
      setMsg(error instanceof Error ? error.message : t("login.requestFailed"));
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
    if (!(await canReachSupabaseGateway(4000))) {
      setGatewayReachable(false);
      return setMsg(t("login.backendUnavailable"));
    }
    setGatewayReachable(true);

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
      setMsg(error instanceof Error ? error.message : t("login.requestFailed"));
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

        <div className="text-xs text-gray-500">{t("login.firstRegisterTip")}</div>
      </div>
    </main>
  );
}
