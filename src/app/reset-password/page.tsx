"use client";

import { createClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import PasswordField, { getPasswordToggleLabels } from "@/components/PasswordField";
import { recoverBrowserSupabaseSession } from "@/lib/authSessionRecovery";
import { getResolvedSupabaseUrl, resolvedSupabaseAnonKey } from "@/lib/supabase";

type RecoveryState = "checking" | "ready" | "expired";

type RecoveryPayload = {
  accessToken: string;
  refreshToken: string;
  tokenHash: string;
  code: string;
  type: string;
  capturedAt: number;
};

const RESET_RECOVERY_STORAGE_KEY = "merchant-space:password-reset-recovery:v1";
const RESET_RECOVERY_STORAGE_TTL_MS = 30 * 60 * 1000;

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

function readRecoveryHashParams() {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.hash.replace(/^#/, ""));
}

function normalizeRecoveryPayload(input: Partial<RecoveryPayload> | null | undefined): RecoveryPayload | null {
  const accessToken = String(input?.accessToken ?? "").trim();
  const refreshToken = String(input?.refreshToken ?? "").trim();
  const tokenHash = String(input?.tokenHash ?? "").trim();
  const code = String(input?.code ?? "").trim();
  const type = String(input?.type ?? "").trim();
  const capturedAt =
    typeof input?.capturedAt === "number" && Number.isFinite(input.capturedAt) ? input.capturedAt : Date.now();
  if (!accessToken && !tokenHash && !code) return null;
  if (Date.now() - capturedAt > RESET_RECOVERY_STORAGE_TTL_MS) return null;
  return {
    accessToken,
    refreshToken,
    tokenHash,
    code,
    type,
    capturedAt,
  };
}

function readRecoveryPayloadFromUrl(): RecoveryPayload | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const hashParams = readRecoveryHashParams();
  return normalizeRecoveryPayload({
    accessToken: hashParams.get("access_token") ?? "",
    refreshToken: hashParams.get("refresh_token") ?? "",
    tokenHash: url.searchParams.get("token_hash") ?? url.searchParams.get("token") ?? "",
    code: url.searchParams.get("code") ?? "",
    type: hashParams.get("type") ?? url.searchParams.get("type") ?? "",
    capturedAt: Date.now(),
  });
}

function readStoredRecoveryPayload(): RecoveryPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(RESET_RECOVERY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RecoveryPayload>;
    const normalized = normalizeRecoveryPayload(parsed);
    if (!normalized) {
      window.sessionStorage.removeItem(RESET_RECOVERY_STORAGE_KEY);
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}

function persistRecoveryPayload(payload: RecoveryPayload | null) {
  if (typeof window === "undefined") return;
  try {
    if (!payload) {
      window.sessionStorage.removeItem(RESET_RECOVERY_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(RESET_RECOVERY_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore browser storage failures.
  }
}

function clearStoredRecoveryPayload() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(RESET_RECOVERY_STORAGE_KEY);
  } catch {
    // Ignore browser storage cleanup failures.
  }
}

function hasDirectRecoveryPayload(payload: RecoveryPayload | null | undefined) {
  if (!payload) return false;
  return Boolean((payload.accessToken && payload.refreshToken) || payload.tokenHash);
}

function hasRecoveryIndicators() {
  if (typeof window === "undefined") return false;
  if (readStoredRecoveryPayload()) return true;
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
  const sessionExpiredMessageRef = useRef(t("reset.sessionExpired"));
  const timeoutMessageRef = useRef(t("login.timeout"));
  const recoveryResolvedRef = useRef(false);
  const recoveryPayloadRef = useRef<RecoveryPayload | null>(null);
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

  const recoverResetSession = useCallback(
    async (timeoutMs = 5000) => {
      const storedPayload = recoveryPayloadRef.current ?? readStoredRecoveryPayload();
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
          clearStoredRecoveryPayload();
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
        clearStoredRecoveryPayload();
        clearRecoveryUrlArtifacts();
        return directSession;
      }

      const initializedSession = await recoverBrowserSupabaseSession(Math.max(timeoutMs, 4500));
      if (initializedSession) {
        clearStoredRecoveryPayload();
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
        clearStoredRecoveryPayload();
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
      const urlPayload = readRecoveryPayloadFromUrl();
      const storedPayload = urlPayload ?? readStoredRecoveryPayload();
      if (storedPayload) {
        recoveryPayloadRef.current = storedPayload;
        persistRecoveryPayload(storedPayload);
        clearRecoveryUrlArtifacts();
        if (hasDirectRecoveryPayload(storedPayload)) {
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
  }, [recoverResetSession]);

  const submitPasswordResetViaServer = useCallback(async () => {
    const payload = recoveryPayloadRef.current ?? readStoredRecoveryPayload();
    recoveryPayloadRef.current = payload;
    if (!payload || !hasDirectRecoveryPayload(payload)) {
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

    clearStoredRecoveryPayload();
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
      if (!recoveredSession && !hasDirectRecoveryPayload(recoveryPayloadRef.current ?? readStoredRecoveryPayload())) {
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
          setMsg(sessionExpiredMessageRef.current);
          return;
        }
        setMsg(error.message);
        return;
      }

      clearStoredRecoveryPayload();
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
            disabled={saving || recoveryState === "checking"}
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
            disabled={saving || recoveryState === "checking"}
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
