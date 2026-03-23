"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  buildCurrentSuperAdminDeviceLabel,
  buildSuperAdminLoginHref,
  getOrCreateSuperAdminDeviceId,
  setSuperAdminAuthenticated,
} from "@/lib/superAdminAuth";
import { useI18n } from "@/components/I18nProvider";

function describeSuperAdminLoginError(code: string) {
  const normalized = String(code ?? "").trim();
  if (!normalized) return "登录失败，请重试。";
  if (normalized === "invalid_credentials") return "账号或密码错误。";
  if (normalized === "invalid_device") return "当前浏览器设备信息无效，请刷新后重试。";
  if (normalized === "device_mismatch") return "请在刚才登录的同一设备、同一浏览器中打开验证邮件。";
  if (normalized === "invalid_email_proof" || normalized === "invalid_or_expired_challenge") {
    return "本次邮箱验证已失效，请重新登录后再验证。";
  }
  if (normalized === "verification_env_missing") return "邮箱验证服务未配置完成，请稍后再试。";
  if (normalized === "verification_send_failed") return "验证邮件发送失败，请稍后重试。";
  return normalized;
}

function SuperAdminLoginForm() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const nextHref = useMemo(() => {
    const raw = (searchParams.get("next") ?? "").trim();
    if (!raw || !raw.startsWith("/")) return "/super-admin";
    return raw;
  }, [searchParams]);
  const challengeFromUrl = useMemo(() => (searchParams.get("superAdminChallenge") ?? "").trim(), [searchParams]);
  const proofFromUrl = useMemo(() => (searchParams.get("superAdminProof") ?? "").trim(), [searchParams]);
  const verifiedFromEmail = useMemo(() => (searchParams.get("superAdminVerified") ?? "").trim() === "1", [searchParams]);

  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [pendingAction, setPendingAction] = useState<"request" | "complete" | null>(null);
  const [emailPending, setEmailPending] = useState(false);
  const completedChallengeRef = useRef("");

  useEffect(() => {
    if (!verifiedFromEmail || !challengeFromUrl || !proofFromUrl) return;
    if (completedChallengeRef.current === challengeFromUrl) return;

    const deviceId = getOrCreateSuperAdminDeviceId();
    if (!deviceId) {
      setMessage("当前浏览器无法建立受信设备标识，请更换浏览器或关闭无痕模式后重试。");
      return;
    }

    completedChallengeRef.current = challengeFromUrl;
    setPendingAction("complete");
    setMessage("邮箱已验证，正在完成超级后台登录...");

    void fetch("/api/super-admin/auth/complete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        challenge: challengeFromUrl,
        proof: proofFromUrl,
        deviceId,
      }),
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string; nextPath?: string; ok?: boolean }
          | null;
        if (!response.ok || payload?.ok !== true) {
          throw new Error(describeSuperAdminLoginError(payload?.error ?? "super_admin_verification_failed"));
        }
        setSuperAdminAuthenticated();
        window.location.href = typeof payload?.nextPath === "string" && payload.nextPath.startsWith("/")
          ? payload.nextPath
          : nextHref;
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "超级后台登录失败，请重新验证。");
        setEmailPending(false);
      })
      .finally(() => {
        setPendingAction(null);
      });
  }, [challengeFromUrl, nextHref, proofFromUrl, verifiedFromEmail]);

  async function signIn() {
    if (pendingAction) return;
    setMessage("");
    setEmailPending(false);

    const deviceId = getOrCreateSuperAdminDeviceId();
    if (!deviceId) {
      setMessage("当前浏览器无法建立受信设备标识，请更换浏览器或关闭无痕模式后重试。");
      return;
    }

    setPendingAction("request");
    try {
      const response = await fetch("/api/super-admin/auth/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          account,
          password,
          next: nextHref,
          deviceId,
          deviceLabel: buildCurrentSuperAdminDeviceLabel(),
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; maskedEmail?: string; trustedDevice?: boolean }
        | null;
      if (!response.ok) {
        throw new Error(describeSuperAdminLoginError(payload?.error ?? "verification_send_failed"));
      }

      const maskedEmail = String(payload?.maskedEmail ?? "caimin6669@qq.com").trim();
      const trustedDeviceTip = payload?.trustedDevice ? "当前浏览器已在白名单内。" : "当前浏览器会在验证成功后加入白名单。";
      setEmailPending(true);
      setMessage(`验证邮件已发送到 ${maskedEmail}。请在刚才登录的同一设备、同一浏览器中打开邮件完成验证。${trustedDeviceTip}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "验证邮件发送失败，请稍后重试。");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-100 p-6">
      <div className="w-full max-w-md space-y-4 rounded-xl border bg-white p-6">
        <h1 className="text-xl font-bold">{t("superLogin.title")}</h1>
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          超级后台启用白名单设备。每次登录都需要发送邮件到 `caimin6669@qq.com` 完成验证。
        </div>
        <div className="space-y-2">
          <div className="text-sm text-gray-600">{t("superLogin.account")}</div>
          <input
            className="w-full rounded border p-2"
            value={account}
            onChange={(event) => setAccount(event.target.value)}
            placeholder={t("superLogin.accountPlaceholder")}
            autoComplete="username"
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
            autoComplete="current-password"
          />
        </div>
        {message ? (
          <div className={`text-sm ${emailPending ? "text-amber-700" : "text-rose-600"}`}>{message}</div>
        ) : null}
        <button
          type="button"
          className="w-full rounded bg-black px-3 py-2 text-white disabled:opacity-50"
          onClick={() => void signIn()}
          disabled={pendingAction !== null}
        >
          {pendingAction === "request"
            ? "发送验证邮件中..."
            : pendingAction === "complete"
              ? "验证中..."
              : t("superLogin.signIn")}
        </button>
        <div className="text-xs text-slate-500">
          如果邮件已经发出但未自动跳转，请回到这台设备上的同一浏览器，重新打开邮件里的验证链接。
        </div>
        <Link href="/login" className="block rounded border px-3 py-2 text-center text-sm hover:bg-gray-50">
          {t("superLogin.backMerchant")}
        </Link>
        <Link href={buildSuperAdminLoginHref(nextHref)} className="block text-center text-xs text-slate-400 hover:text-slate-600">
          重新开始超级后台验证
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
