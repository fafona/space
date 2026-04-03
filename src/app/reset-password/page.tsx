"use client";

import { createClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import PasswordField, { getPasswordToggleLabels } from "@/components/PasswordField";
import { recoverBrowserSupabaseSession } from "@/lib/authSessionRecovery";
import {
  clearStoredResetPasswordEmailRequest,
  persistResetPasswordEmailRequest,
  readStoredResetPasswordEmailRequest,
} from "@/lib/resetPasswordEmailRequest";
import {
  clearStoredResetPasswordRecoveryPayload,
  hasDirectResetPasswordRecoveryPayload,
  persistResetPasswordRecoveryPayload,
  readResetPasswordRecoveryHashParams,
  readResetPasswordRecoveryPayloadFromUrl,
  readStoredResetPasswordRecoveryPayload,
  type ResetPasswordRecoveryPayload,
} from "@/lib/resetPasswordRecoveryPayload";
import { getResolvedSupabaseUrl, resolvedSupabaseAnonKey } from "@/lib/supabase";

type RecoveryState = "checking" | "ready" | "expired";

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

function readRecoveryHashParams() {
  if (typeof window === "undefined") return new URLSearchParams();
  return readResetPasswordRecoveryHashParams(new URL(window.location.href));
}

function hasRecoveryIndicators() {
  if (typeof window === "undefined") return false;
  if (readStoredResetPasswordRecoveryPayload()) return true;
  const url = new URL(window.location.href);
  const hashParams = readRecoveryHashParams();
  return (
    hashParams.get("type") === "recovery" ||
    hashParams.has("access_token") ||
    hashParams.has("refresh_token") ||
    (url.searchParams.get("type") ?? "").trim() === "recovery" ||
    Boolean((url.searchParams.get("code") ?? "").trim()) ||
    Boolean((url.searchParams.get("token_hash") ?? url.searchParams.get("token") ?? "").trim())
  );
}

function hasUrlRecoveryIndicators() {
  if (typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  const hashParams = readRecoveryHashParams();
  return (
    hashParams.get("type") === "recovery" ||
    hashParams.has("access_token") ||
    hashParams.has("refresh_token") ||
    (url.searchParams.get("type") ?? "").trim() === "recovery" ||
    Boolean((url.searchParams.get("code") ?? "").trim()) ||
    Boolean((url.searchParams.get("token_hash") ?? url.searchParams.get("token") ?? "").trim())
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
  const [helperMsg, setHelperMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [recoveryState, setRecoveryState] = useState<RecoveryState>("checking");
  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [resendingCode, setResendingCode] = useState(false);
  const passwordToggleLabels = useMemo(() => getPasswordToggleLabels(locale), [locale]);
  const sessionExpiredMessageRef = useRef(t("reset.sessionExpired"));
  const timeoutMessageRef = useRef(t("login.timeout"));
  const recoveryResolvedRef = useRef(false);
  const recoveryPayloadRef = useRef<ResetPasswordRecoveryPayload | null>(null);
  const resetSupabase = useMemo(() => {
    return createClient(getResolvedSupabaseUrl(), resolvedSupabaseAnonKey, {
      auth: {
        storageKey: "merchant-space:password-reset-session:v1",
        persistSession: true,
        detectSessionInUrl: true,
        autoRefreshToken: true,
      },
    });
  }, []);

  useEffect(() => {
    sessionExpiredMessageRef.current = t("reset.sessionExpired");
    timeoutMessageRef.current = t("login.timeout");
  }, [t]);

  useEffect(() => {
    const storedRequest = readStoredResetPasswordEmailRequest();
    if (!storedRequest?.email) return;
    setResetEmail((current) => current || storedRequest.email);
  }, []);

  function normalizeResetCodeError(message: string) {
    const normalized = String(message ?? "").trim();
    if (/invalid_email/i.test(normalized)) return t("login.invalidEmail");
    if (/invalid_code|invalid_or_expired|expired|otp|token/i.test(normalized)) return t("reset.invalidCode");
    if (/env_missing|unavailable|failed to fetch|fetch failed|network/i.test(normalized)) {
      return t("login.backendUnavailable");
    }
    return normalized || t("login.requestFailed");
  }

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
        reject(new Error(timeoutMessageRef.current));
      }, timeoutMs);
    });

    try {
      return await Promise.race([safeTask, timeoutTask]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }, []);

  const hasServerRecoverySession = useCallback(
    async (timeoutMs = 6000) => {
      const response = await withTimeout(
        fetch("/api/auth/reset-password/session", {
          method: "GET",
          cache: "no-store",
          headers: {
            accept: "application/json",
          },
        }),
        timeoutMs,
      ).catch(() => null);

      if (!response || !response.ok) return false;
      const result = (await response.json().catch(() => null)) as { ready?: unknown } | null;
      return result?.ready === true;
    },
    [withTimeout],
  );

  const recoverResetSession = useCallback(
    async (timeoutMs = 5000) => {
      const storedPayload = recoveryPayloadRef.current ?? readStoredResetPasswordRecoveryPayload();
      if (storedPayload) {
        recoveryPayloadRef.current = storedPayload;
      }

      const code = String(storedPayload?.code ?? "").trim();
      if (code) {
        const { data, error } = await withTimeout(
          resetSupabase.auth.exchangeCodeForSession(code),
          Math.max(3000, timeoutMs),
        );
        if (!error && data.session) {
          clearStoredResetPasswordRecoveryPayload();
          clearRecoveryUrlArtifacts();
          return data.session;
        }
      }

      try {
        await resetSupabase.auth.initialize();
      } catch {
        // Keep going and try existing browser session recovery below.
      }

      const {
        data: { session: directSession },
      } = await resetSupabase.auth.getSession();
      if (directSession) {
        clearStoredResetPasswordRecoveryPayload();
        clearRecoveryUrlArtifacts();
        return directSession;
      }

      const initializedSession = await recoverBrowserSupabaseSession(Math.max(timeoutMs, 4500));
      if (initializedSession) {
        clearStoredResetPasswordRecoveryPayload();
        clearRecoveryUrlArtifacts();
        return initializedSession;
      }

      return null;
    },
    [resetSupabase, withTimeout],
  );

  useEffect(() => {
    let cancelled = false;
    const {
      data: { subscription },
    } = resetSupabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session) {
        recoveryResolvedRef.current = true;
        setRecoveryState("ready");
        setMsg("");
        clearStoredResetPasswordRecoveryPayload();
        clearRecoveryUrlArtifacts();
      }
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [resetSupabase]);

  useEffect(() => {
    let cancelled = false;

    async function initializeRecovery() {
      if (recoveryResolvedRef.current) return;
      const urlPayload = readResetPasswordRecoveryPayloadFromUrl(new URL(window.location.href));
      const preferFreshRecoveryAttempt = hasUrlRecoveryIndicators();
      if (preferFreshRecoveryAttempt && !urlPayload) {
        clearStoredResetPasswordRecoveryPayload();
        recoveryPayloadRef.current = null;
      }
      const storedPayload = urlPayload ?? (preferFreshRecoveryAttempt ? null : readStoredResetPasswordRecoveryPayload());
      if (storedPayload) {
        recoveryPayloadRef.current = storedPayload;
        persistResetPasswordRecoveryPayload(storedPayload);
        clearRecoveryUrlArtifacts();
        if (hasDirectResetPasswordRecoveryPayload(storedPayload)) {
          recoveryResolvedRef.current = true;
          setRecoveryState("ready");
          setMsg("");
          return;
        }
      }

      const hasIndicators = hasRecoveryIndicators();
      const deadline = Date.now() + (hasIndicators ? 20000 : 6000);
      while (!cancelled && Date.now() < deadline) {
        if (recoveryResolvedRef.current) return;
        const session = await recoverResetSession(hasIndicators ? 9000 : 5500).catch(() => null);
        if (cancelled || recoveryResolvedRef.current) return;
        if (session) {
          recoveryResolvedRef.current = true;
          setRecoveryState("ready");
          setMsg("");
          return;
        }
        const serverReady = await hasServerRecoverySession(hasIndicators ? 9000 : 5000).catch(() => false);
        if (cancelled || recoveryResolvedRef.current) return;
        if (serverReady) {
          recoveryResolvedRef.current = true;
          setRecoveryState("ready");
          setMsg("");
          return;
        }
        if (!hasIndicators) break;
        await delay(600);
      }
      if (cancelled || recoveryResolvedRef.current) return;
      setRecoveryState("expired");
      setMsg(sessionExpiredMessageRef.current);
    }

    void initializeRecovery();
    return () => {
      cancelled = true;
    };
  }, [hasServerRecoverySession, recoverResetSession]);

  const submitPasswordResetViaServer = useCallback(async () => {
    const payload = recoveryPayloadRef.current ?? readStoredResetPasswordRecoveryPayload();
    recoveryPayloadRef.current = payload;
    if (!payload || !hasDirectResetPasswordRecoveryPayload(payload)) {
      return false;
    }

    const response = await withTimeout(
      fetch("/api/auth/reset-password", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          password,
          accessToken: payload.accessToken,
          refreshToken: payload.refreshToken,
          tokenHash: payload.tokenHash,
        }),
      }),
      20000,
    );

      const result = (await response.json().catch(() => null)) as { ok?: unknown; error?: unknown } | null;
    if (!response.ok || result?.ok !== true) {
      const errorMessage = typeof result?.error === "string" ? result.error : "";
      if (/expired|session/i.test(errorMessage)) {
        clearStoredResetPasswordRecoveryPayload();
        recoveryPayloadRef.current = null;
        setRecoveryState("expired");
        setMsg(sessionExpiredMessageRef.current);
        return true;
      }
      if (/env_missing|unavailable/i.test(errorMessage)) {
        setMsg(t("login.backendUnavailable"));
        return true;
      }
      setMsg(errorMessage || t("login.requestFailed"));
      return true;
    }

    clearStoredResetPasswordRecoveryPayload();
    recoveryPayloadRef.current = null;
    clearStoredResetPasswordEmailRequest();
    setMsg(t("reset.successRedirect"));
    setTimeout(() => {
      window.location.href = "/login";
    }, 900);
    return true;
  }, [password, t, withTimeout]);

  async function updatePassword() {
    if (saving) return;
    setMsg("");
    const validationError = validate();
    if (validationError) return setMsg(validationError);
    if (recoveryState !== "ready") {
      const recoveredSession = await recoverResetSession(5500).catch(() => null);
      const serverReady = recoveredSession ? true : await hasServerRecoverySession(5500).catch(() => false);
      if (
        !recoveredSession &&
        !serverReady &&
        !hasDirectResetPasswordRecoveryPayload(recoveryPayloadRef.current ?? readStoredResetPasswordRecoveryPayload())
      ) {
        clearStoredResetPasswordRecoveryPayload();
        recoveryPayloadRef.current = null;
        setRecoveryState("expired");
        setMsg(sessionExpiredMessageRef.current);
        return;
      }
      recoveryResolvedRef.current = true;
      setRecoveryState("ready");
    }

    setSaving(true);
    try {
      const handledByServer = await submitPasswordResetViaServer();
      if (handledByServer) return;

      const { error } = await withTimeout(resetSupabase.auth.updateUser({ password }));

      if (error) {
        if (/session/i.test(error.message)) {
          clearStoredResetPasswordRecoveryPayload();
          recoveryPayloadRef.current = null;
          setRecoveryState("expired");
          setMsg(sessionExpiredMessageRef.current);
          return;
        }
        setMsg(error.message);
        return;
      }

      clearStoredResetPasswordRecoveryPayload();
      recoveryPayloadRef.current = null;
      clearStoredResetPasswordEmailRequest();
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

  async function resendResetEmailCode() {
    if (resendingCode || verifyingCode || saving) return;
    const email = resetEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      setMsg(t("login.invalidEmail"));
      return;
    }

    setMsg("");
    setHelperMsg("");
    setResendingCode(true);
    try {
      const response = await withTimeout(
        fetch("/api/auth/reset-password/request-code", {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({ email }),
        }),
      );
      const payload = (await response.json().catch(() => null)) as { ok?: unknown; error?: unknown } | null;
      if (!response.ok || payload?.ok !== true) {
        throw new Error(typeof payload?.error === "string" ? payload.error : t("login.requestFailed"));
      }
      persistResetPasswordEmailRequest(email);
      setResetCode("");
      setHelperMsg(t("login.forgotSuccess"));
    } catch (error) {
      setMsg(error instanceof Error ? normalizeResetCodeError(error.message) : t("login.requestFailed"));
    } finally {
      setResendingCode(false);
    }
  }

  async function verifyResetCodeFallback() {
    if (verifyingCode || resendingCode || saving) return;
    const email = resetEmail.trim().toLowerCase();
    const code = resetCode.trim();
    if (!email || !email.includes("@")) {
      setMsg(t("login.invalidEmail"));
      return;
    }
    if (!code) {
      setMsg(t("reset.invalidCode"));
      return;
    }

    setMsg("");
    setHelperMsg("");
    setVerifyingCode(true);
    try {
      const response = await withTimeout(
        fetch("/api/auth/reset-password/verify-code", {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({ email, code }),
        }),
      );
      const payload = (await response.json().catch(() => null)) as { ok?: unknown; error?: unknown } | null;
      if (!response.ok || payload?.ok !== true) {
        throw new Error(typeof payload?.error === "string" ? payload.error : t("reset.invalidCode"));
      }
      persistResetPasswordEmailRequest(email);
      recoveryResolvedRef.current = true;
      setRecoveryState("ready");
      setResetCode("");
      setMsg("");
    } catch (error) {
      setMsg(error instanceof Error ? normalizeResetCodeError(error.message) : t("reset.invalidCode"));
    } finally {
      setVerifyingCode(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-100 p-6 text-slate-900">
      <div className="w-full max-w-md space-y-4 rounded-xl border bg-white p-6 text-slate-900">
        <h1 className="text-xl font-bold text-slate-900">{t("reset.title")}</h1>

        <div className="space-y-2">
          <div className="text-sm text-gray-600">{t("reset.newPassword")}</div>
          <PasswordField
            className="w-full rounded border p-2 text-slate-900 placeholder:text-slate-300"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("login.passwordMin6")}
            disabled={saving || recoveryState === "checking"}
            showLabel={passwordToggleLabels.show}
            hideLabel={passwordToggleLabels.hide}
          />
        </div>

        <div className="space-y-2">
          <div className="text-sm text-gray-600">{t("reset.confirmPassword")}</div>
          <PasswordField
            className="w-full rounded border p-2 text-slate-900 placeholder:text-slate-300"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder={t("reset.inputConfirmPasswordAgain")}
            disabled={saving || recoveryState === "checking"}
            showLabel={passwordToggleLabels.show}
            hideLabel={passwordToggleLabels.hide}
          />
        </div>

        {recoveryState === "checking" ? <div className="text-sm text-slate-500">{t("common.loadingPage")}</div> : null}
        {msg ? <div className="text-sm text-red-600">{msg}</div> : null}

        {recoveryState === "expired" ? (
          <div className="space-y-3 rounded border border-slate-200 bg-slate-50 p-3">
            <div className="text-sm text-slate-600">{t("reset.codeHelp")}</div>
            {helperMsg ? <div className="text-sm text-slate-500">{helperMsg}</div> : null}
            <div className="space-y-2">
              <div className="text-sm text-gray-600">{t("reset.email")}</div>
              <input
                className="w-full rounded border p-2 text-slate-900 placeholder:text-slate-300"
                value={resetEmail}
                onChange={(event) => setResetEmail(event.target.value)}
                placeholder={t("login.email")}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                disabled={saving || verifyingCode || resendingCode}
              />
            </div>
            <div className="space-y-2">
              <div className="text-sm text-gray-600">{t("reset.code")}</div>
              <input
                className="w-full rounded border p-2 text-slate-900 placeholder:text-slate-300"
                value={resetCode}
                onChange={(event) => setResetCode(event.target.value)}
                placeholder={t("reset.codePlaceholder")}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                disabled={saving || verifyingCode || resendingCode}
              />
            </div>
            <div className="flex gap-2">
              <button
                className="flex-1 rounded border bg-white px-3 py-2 text-slate-900 hover:bg-gray-50 disabled:opacity-40"
                onClick={verifyResetCodeFallback}
                disabled={saving || verifyingCode || resendingCode}
              >
                {verifyingCode ? t("reset.verifyingCode") : t("reset.verifyCode")}
              </button>
              <button
                className="flex-1 rounded border bg-white px-3 py-2 text-slate-900 hover:bg-gray-50 disabled:opacity-40"
                onClick={resendResetEmailCode}
                disabled={saving || verifyingCode || resendingCode}
              >
                {resendingCode ? t("reset.resendingCode") : t("reset.resendCode")}
              </button>
            </div>
          </div>
        ) : null}

        <button
          className="w-full rounded bg-black px-3 py-2 text-white disabled:opacity-40"
          onClick={updatePassword}
          disabled={saving || recoveryState === "checking"}
        >
          {saving ? t("reset.submitting") : t("reset.confirmReset")}
        </button>

        <button
          className="w-full rounded border bg-white px-3 py-2 text-slate-900 hover:bg-gray-50"
          onClick={() => (window.location.href = "/login")}
        >
          {t("common.backToLogin")}
        </button>
      </div>
    </main>
  );
}
