"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import {
  hasDirectResetPasswordRecoveryPayload,
  persistResetPasswordRecoveryPayload,
  readResetPasswordRecoveryPayloadFromUrl,
} from "@/lib/resetPasswordRecoveryPayload";

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

export default function ResetPasswordBridgePage() {
  const { t } = useI18n();
  const [message, setMessage] = useState("");
  const nextUrl = useMemo(() => "/reset-password", []);

  useEffect(() => {
    let cancelled = false;

    async function bridgeRecovery() {
      const payload = readResetPasswordRecoveryPayloadFromUrl(new URL(window.location.href));
      if (payload) {
        persistResetPasswordRecoveryPayload(payload);
      }
      if (payload?.accessToken && payload?.refreshToken) {
        await syncRecoverySessionToServer({
          accessToken: payload.accessToken,
          refreshToken: payload.refreshToken,
        });
      }
      if (cancelled) return;
      if (!payload || !hasDirectResetPasswordRecoveryPayload(payload)) {
        setMessage(t("reset.sessionExpired"));
        window.setTimeout(() => {
          if (!cancelled) {
            window.location.replace(nextUrl);
          }
        }, 600);
        return;
      }
      window.location.replace(nextUrl);
    }

    void bridgeRecovery();
    return () => {
      cancelled = true;
    };
  }, [nextUrl, t]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-100 p-6">
      <div className="w-full max-w-md rounded-xl border bg-white p-6 text-sm text-slate-600">
        {message || "正在准备重置会话..."}
      </div>
    </main>
  );
}
