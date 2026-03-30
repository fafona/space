"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import PasswordField, { getPasswordToggleLabels } from "@/components/PasswordField";
import { canReachSupabaseGateway, supabase } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const { locale, t } = useI18n();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const passwordToggleLabels = useMemo(() => getPasswordToggleLabels(locale), [locale]);

  function validate(): string | null {
    if (!password) return t("reset.requiredNewPassword");
    if (password.length < 6) return t("reset.newPasswordTooShort");
    if (!confirmPassword) return t("reset.requiredConfirmPassword");
    if (password !== confirmPassword) return t("reset.passwordMismatch");
    return null;
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

  async function updatePassword() {
    if (saving) return;
    setMsg("");
    const validationError = validate();
    if (validationError) return setMsg(validationError);
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

        {msg ? <div className="text-sm text-red-600">{msg}</div> : null}

        <button
          className="w-full rounded bg-black px-3 py-2 text-white disabled:opacity-40"
          onClick={updatePassword}
          disabled={saving}
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
