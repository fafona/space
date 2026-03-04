"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  SUPER_ADMIN_ACCOUNT,
  SUPER_ADMIN_PASSWORD,
  setSuperAdminAuthenticated,
} from "@/lib/superAdminAuth";
import { useI18n } from "@/components/I18nProvider";

function SuperAdminLoginForm() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const nextHref = useMemo(() => {
    const raw = (searchParams.get("next") ?? "").trim();
    if (!raw || !raw.startsWith("/")) return "/super-admin";
    return raw;
  }, [searchParams]);
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  function signIn() {
    if (account.trim() !== SUPER_ADMIN_ACCOUNT || password !== SUPER_ADMIN_PASSWORD) {
      setMessage(t("superLogin.invalid"));
      return;
    }
    setSuperAdminAuthenticated();
    window.location.href = nextHref;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-100 p-6">
      <div className="w-full max-w-md space-y-4 rounded-xl border bg-white p-6">
        <h1 className="text-xl font-bold">{t("superLogin.title")}</h1>
        <div className="space-y-2">
          <div className="text-sm text-gray-600">{t("superLogin.account")}</div>
          <input
            className="w-full rounded border p-2"
            value={account}
            onChange={(event) => setAccount(event.target.value)}
            placeholder={t("superLogin.accountPlaceholder")}
          />
        </div>
        <div className="space-y-2">
          <div className="text-sm text-gray-600">{t("superLogin.password")}</div>
          <input
            type="password"
            className="w-full rounded border p-2"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={t("superLogin.passwordPlaceholder")}
          />
        </div>
        {message ? <div className="text-sm text-rose-600">{message}</div> : null}
        <button type="button" className="w-full rounded bg-black px-3 py-2 text-white" onClick={signIn}>
          {t("superLogin.signIn")}
        </button>
        <Link href="/login" className="block rounded border px-3 py-2 text-center text-sm hover:bg-gray-50">
          {t("superLogin.backMerchant")}
        </Link>
      </div>
    </main>
  );
}

export default function SuperAdminLoginPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-gray-100" />}>
      <SuperAdminLoginForm />
    </Suspense>
  );
}
