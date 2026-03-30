"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import PasswordField, { getPasswordToggleLabels } from "@/components/PasswordField";
import {
  establishBrowserSupabaseSession,
  recoverBrowserSupabaseSession,
  syncMerchantSessionCookies,
} from "@/lib/authSessionRecovery";
import { canReachSupabaseGateway, supabase } from "@/lib/supabase";

type RecoveryState = "checking" | "ready" | "expired";

function readRecoveryHashParams() {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.hash.replace(/^#/, ""));
}

function hasRecoveryIndicators() {
  if (typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  const hashParams = readRecoveryHashParams();
  return (
    hashParams.get("type") === "recovery" ||
    hashParams.has("access_token") ||
    hashParams.has("refresh_token") ||
    (url.searchParams.get("type") ?? "").trim() === "recovery" ||
    Boolean((url.searchParams.get("code") ?? "").trim()) ||
    Boolean((url.searchParams.get("token_hash") ?? url.searchParams.get("token") ?? "").trim()) ||
    (url.searchParams.get("confirmed") ?? "").trim() === "1"
  );
}

function clearRecoveryUrlArtifacts() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const key of ["code", "type", "token_hash", "token", "confirmed", "confirm_message"]) {
    url.searchParams.delete(key);
  }
  url.hash = "";
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}`);
}

export default function ResetPasswordPage() {
  const { locale, t } = useI18n();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [recoveryState, setRecoveryState] = useState<RecoveryState>("checking");
  const passwordToggleLabels = useMemo(() => getPasswordToggleLabels(locale), [locale]);

  function validate(): string | null {
    if (!password) return t("reset.requiredNewPassword");
    if (password.length < 6) return t("reset.newPasswordTooShort");
    if (!confirmPassword) return t("reset.requiredConfirmPassword");
    if (password !== confirmPassword) return t("reset.passwordMismatch");
    return null;
  }

  const withTimeout = useCallback(async <T,>(task: Promise<T>, timeoutMs = 15000): Promise<T> => {
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
  }, [t]);

  const recoverResetSession = useCallback(async (timeoutMs = 5000) => {
    const directSession = await recoverBrowserSupabaseSession(Math.min(2200, timeoutMs));
    if (directSession) {
      void syncMerchantSessionCookies(directSession, 2500);
      clearRecoveryUrlArtifacts();
      return directSession;
    }

    const hashParams = readRecoveryHashParams();
    const hashType = (hashParams.get("type") ?? "").trim();
    const accessToken = (hashParams.get("access_token") ?? "").trim();
    const refreshToken = (hashParams.get("refresh_token") ?? "").trim();
    if (hashType === "recovery" && accessToken && refreshToken) {
      const established = await establishBrowserSupabaseSession(
        {
          access_token: accessToken,
          refresh_token: refreshToken,
        },
        timeoutMs,
      );
      if (established) {
        void syncMerchantSessionCookies(established, 2500);
        clearRecoveryUrlArtifacts();
        return established;
      }
    }

    try {
      await supabase.auth.initialize();
    } catch {
      // Keep going and try the explicit fallbacks below.
    }

    const initializedSession = await recoverBrowserSupabaseSession(timeoutMs);
    if (initializedSession) {
      void syncMerchantSessionCookies(initializedSession, 2500);
      clearRecoveryUrlArtifacts();
      return initializedSession;
    }

    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      const code = (url.searchParams.get("code") ?? "").trim();
      if (code) {
        const { data, error } = await withTimeout(supabase.auth.exchangeCodeForSession(code), Math.max(3000, timeoutMs));
        if (!error && data.session) {
          void syncMerchantSessionCookies(data.session, 2500);
          clearRecoveryUrlArtifacts();
          return data.session;
        }
      }

      const tokenHash = (url.searchParams.get("token_hash") ?? url.searchParams.get("token") ?? "").trim();
      const queryType = (url.searchParams.get("type") ?? "").trim();
      if (tokenHash && queryType === "recovery") {
        const { data, error } = await withTimeout(
          supabase.auth.verifyOtp({
            type: "recovery",
            token_hash: tokenHash,
          }),
          Math.max(3000, timeoutMs),
        );
        if (!error && data.session) {
          void syncMerchantSessionCookies(data.session, 2500);
          clearRecoveryUrlArtifacts();
          return data.session;
        }
      }
    }

    return null;
  }, [withTimeout]);

  useEffect(() => {
    let cancelled = false;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session) {
        setRecoveryState("ready");
        setMsg("");
        void syncMerchantSessionCookies(session, 2500);
        clearRecoveryUrlArtifacts();
      }
    });

    async function initializeRecovery() {
      const session = await recoverResetSession(5500).catch(() => null);
      if (cancelled) return;
      if (session) {
        setRecoveryState("ready");
        setMsg("");
        return;
      }
      setRecoveryState("expired");
      if (hasRecoveryIndicators()) {
        setMsg(t("reset.sessionExpired"));
        return;
      }
      setMsg(t("reset.sessionExpired"));
    }

    void initializeRecovery();
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [recoverResetSession, t]);

  async function updatePassword() {
    if (saving) return;
    setMsg("");
    const validationError = validate();
    if (validationError) return setMsg(validationError);
    if (recoveryState !== "ready") {
      const recoveredSession = await recoverResetSession(5500).catch(() => null);
      if (!recoveredSession) {
        setRecoveryState("expired");
        setMsg(t("reset.sessionExpired"));
        return;
      }
      setRecoveryState("ready");
    }
    if (!(await canReachSupabaseGateway(4000))) {
      return setMsg(t("login.backendUnavailable"));
    }

    setSaving(true);
    try {
      const { error } = await withTimeout(supabase.auth.updateUser({ password }));

      if (error) {
        if (/session/i.test(error.message)) {
          setMsg(t("reset.sessionExpired"));
          return;
        }
        setMsg(error.message);
        return;
      }

      setMsg(t("reset.successRedirect"));
      setTimeout(() => {
        window.location.href = "/login";
      }, 900);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : t("login.requestFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-100 p-6">
      <div className="w-full max-w-md space-y-4 rounded-xl border bg-white p-6">
        <h1 className="text-xl font-bold">{t("reset.title")}</h1>

        <div className="space-y-2">
          <div className="text-sm text-gray-600">{t("reset.newPassword")}</div>
          <PasswordField
            className="w-full rounded border p-2"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("login.passwordMin6")}
            showLabel={passwordToggleLabels.show}
            hideLabel={passwordToggleLabels.hide}
          />
        </div>

        <div className="space-y-2">
          <div className="text-sm text-gray-600">{t("reset.confirmPassword")}</div>
          <PasswordField
            className="w-full rounded border p-2"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder={t("reset.inputConfirmPasswordAgain")}
            showLabel={passwordToggleLabels.show}
            hideLabel={passwordToggleLabels.hide}
          />
        </div>

        {recoveryState === "checking" ? <div className="text-sm text-slate-500">{t("common.loadingPage")}</div> : null}
        {msg ? <div className="text-sm text-red-600">{msg}</div> : null}

        <button
          className="w-full rounded bg-black px-3 py-2 text-white disabled:opacity-40"
          onClick={updatePassword}
          disabled={saving || recoveryState === "checking"}
        >
          {saving ? t("reset.submitting") : t("reset.confirmReset")}
        </button>

        <button
          className="w-full rounded border bg-white px-3 py-2 hover:bg-gray-50"
          onClick={() => (window.location.href = "/login")}
        >
          {t("common.backToLogin")}
        </button>
      </div>
    </main>
  );
}
