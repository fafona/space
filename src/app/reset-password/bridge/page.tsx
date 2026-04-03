"use client";

import { createClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import {
  buildResetPasswordRecoveryUrl,
  type ResetPasswordRecoveryPayload,
  persistResetPasswordRecoveryPayload,
  readResetPasswordRecoveryPayloadFromUrl,
} from "@/lib/resetPasswordRecoveryPayload";
import { getResolvedSupabaseUrl, resolvedSupabaseAnonKey } from "@/lib/supabase";

async function syncRecoverySessionToServer(input: {
  accessToken: string;
  refreshToken: string;
}) {
  try {
    await fetch("/api/auth/reset-password/session", {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
      }),
    });
  } catch {
    // Ignore bridge sync failures and fall back to sessionStorage payload.
  }
}

function hasDirectSessionPayload(payload: ResetPasswordRecoveryPayload | null | undefined) {
  return Boolean(payload?.accessToken && payload?.refreshToken);
}

function resolveBridgeOtpType(payload: ResetPasswordRecoveryPayload | null | undefined) {
  const rawType = String(payload?.type ?? "").trim();
  if (rawType === "email" || rawType === "magiclink" || rawType === "recovery") {
    return rawType;
  }
  return "recovery";
}

export default function ResetPasswordBridgePage() {
  const { t } = useI18n();
  const [message, setMessage] = useState("");
  const [pendingPayload, setPendingPayload] = useState<ResetPasswordRecoveryPayload | null>(null);
  const [activating, setActivating] = useState(false);
  const nextUrl = useMemo(() => "/reset-password", []);
  const resetSupabase = useMemo(() => {
    return createClient(getResolvedSupabaseUrl(), resolvedSupabaseAnonKey, {
      auth: {
        persistSession: false,
        detectSessionInUrl: false,
        autoRefreshToken: false,
      },
    });
  }, []);

  const redirectToResetPage = useCallback(
    (payload?: Partial<ResetPasswordRecoveryPayload> | null) => {
      const targetUrl = buildResetPasswordRecoveryUrl(new URL(nextUrl, window.location.origin), payload);
      window.location.replace(`${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`);
    },
    [nextUrl],
  );

  const finalizeRecoverySession = useCallback(
    async (payload: ResetPasswordRecoveryPayload) => {
      const accessToken = String(payload.accessToken ?? "").trim();
      const refreshToken = String(payload.refreshToken ?? "").trim();
      if (!accessToken || !refreshToken) {
        throw new Error(t("reset.sessionExpired"));
      }
      persistResetPasswordRecoveryPayload({
        ...payload,
        accessToken,
        refreshToken,
        type: "recovery",
        capturedAt: Date.now(),
      });
      await syncRecoverySessionToServer({
        accessToken,
        refreshToken,
      });
      redirectToResetPage({
        ...payload,
        accessToken,
        refreshToken,
        type: "recovery",
      });
    },
    [redirectToResetPage, t],
  );

  const activateRecovery = useCallback(async () => {
    if (activating) return;
    const payload = pendingPayload ?? readResetPasswordRecoveryPayloadFromUrl(new URL(window.location.href));
    if (!payload) {
      setMessage(t("reset.sessionExpired"));
      window.setTimeout(() => {
        redirectToResetPage();
      }, 600);
      return;
    }

    if (hasDirectSessionPayload(payload)) {
      setActivating(true);
      setMessage("");
      try {
        await finalizeRecoverySession(payload);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : t("reset.sessionExpired"));
      } finally {
        setActivating(false);
      }
      return;
    }

    setActivating(true);
    setMessage("");
    try {
      if (payload.code) {
        const { data, error } = await resetSupabase.auth.exchangeCodeForSession(payload.code);
        const accessToken = String(data.session?.access_token ?? "").trim();
        const refreshToken = String(data.session?.refresh_token ?? "").trim();
        if (error || !accessToken || !refreshToken) {
          throw new Error(error?.message || t("reset.sessionExpired"));
        }
        await finalizeRecoverySession({
          ...payload,
          accessToken,
          refreshToken,
          type: "recovery",
          capturedAt: Date.now(),
        });
        return;
      }

      if (payload.tokenHash) {
        const otpType = resolveBridgeOtpType(payload);
        const { data, error } = await resetSupabase.auth.verifyOtp({
          type: otpType,
          token_hash: payload.tokenHash,
        });
        const accessToken = String(data.session?.access_token ?? "").trim();
        const refreshToken = String(data.session?.refresh_token ?? "").trim();
        if (error || !accessToken || !refreshToken) {
          throw new Error(error?.message || t("reset.sessionExpired"));
        }
        await finalizeRecoverySession({
          ...payload,
          accessToken,
          refreshToken,
          type: "recovery",
          capturedAt: Date.now(),
        });
        return;
      }

      throw new Error(t("reset.sessionExpired"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("reset.sessionExpired"));
    } finally {
      setActivating(false);
    }
  }, [activating, finalizeRecoverySession, pendingPayload, redirectToResetPage, resetSupabase, t]);

  useEffect(() => {
    let cancelled = false;

    async function prepareRecovery() {
      const payload = readResetPasswordRecoveryPayloadFromUrl(new URL(window.location.href));
      if (!payload) {
        setMessage(t("reset.sessionExpired"));
        window.setTimeout(() => {
          if (!cancelled) {
            redirectToResetPage();
          }
        }, 600);
        return;
      }

      setPendingPayload(payload);
      persistResetPasswordRecoveryPayload(payload);

      if (!hasDirectSessionPayload(payload)) {
        return;
      }

      try {
        await finalizeRecoverySession(payload);
      } catch (error) {
        if (cancelled) return;
        setMessage(error instanceof Error ? error.message : t("reset.sessionExpired"));
      }
    }

    void prepareRecovery();
    return () => {
      cancelled = true;
    };
  }, [finalizeRecoverySession, redirectToResetPage, t]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-100 p-6">
      <div className="w-full max-w-md space-y-4 rounded-xl border bg-white p-6 text-sm text-slate-600">
        <div className="text-base font-semibold text-slate-900">{t("reset.title")}</div>
        <div>{message || "Preparing your reset session..."}</div>
        {pendingPayload && !hasDirectSessionPayload(pendingPayload) ? (
          <button
            className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
            onClick={() => {
              void activateRecovery();
            }}
            disabled={activating}
          >
            {activating ? t("reset.title") : t("reset.confirmReset")}
          </button>
        ) : null}
      </div>
    </main>
  );
}
