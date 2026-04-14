"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import PasswordField, { getPasswordToggleLabels } from "@/components/PasswordField";
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
  if (normalized === "invalid_email_code") return "请输入有效的邮箱验证码。";
  if (normalized === "invalid_or_expired_email_code") return "验证码无效或已过期，请重新获取后再试。";
  if (normalized === "device_mismatch") return "请在刚才登录的同一设备、同一浏览器中完成验证。";
  if (normalized === "device_limit_reached") return "白名单设备已达到上限，请先移除旧设备后再登录。";
  if (normalized === "invalid_email_proof" || normalized === "invalid_or_expired_challenge") {
    return "本次邮箱验证已失效，请重新登录后再验证。";
  }
  if (normalized === "verification_env_missing") return "邮箱验证服务未配置完成，请稍后再试。";
  if (normalized === "verification_send_failed") return "验证码邮件发送失败，请稍后重试。";
  return normalized;
}

function SuperAdminLoginForm() {
  const { locale, t } = useI18n();
  const searchParams = useSearchParams();
  const nextHref = useMemo(() => {
    const raw = (searchParams.get("next") ?? "").trim();
    if (!raw || !raw.startsWith("/")) return "/super-admin";
    return raw;
  }, [searchParams]);
  const challengeFromUrl = useMemo(() => (searchParams.get("superAdminChallenge") ?? "").trim(), [searchParams]);
  const proofFromUrl = useMemo(() => (searchParams.get("superAdminProof") ?? "").trim(), [searchParams]);
  const verifiedFromEmail = useMemo(() => (searchParams.get("superAdminVerified") ?? "").trim() === "1", [searchParams]);
  const loggedOut = useMemo(() => (searchParams.get("loggedOut") ?? "").trim() === "1", [searchParams]);

  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const accountInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const [emailCode, setEmailCode] = useState("");
  const [message, setMessage] = useState("");
  const [pendingAction, setPendingAction] = useState<"request" | "complete" | "verify_code" | null>(null);
  const [emailPending, setEmailPending] = useState(false);
  const [pendingChallenge, setPendingChallenge] = useState("");
  const completedChallengeRef = useRef("");
  const activeChallenge = challengeFromUrl || pendingChallenge;
  const passwordToggleLabels = useMemo(() => getPasswordToggleLabels(locale), [locale]);

  useEffect(() => {
    if (!loggedOut) return;
    setAccount("");
    setPassword("");
    setEmailCode("");
    setMessage("");

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
    if (!verifiedFromEmail || !challengeFromUrl || !proofFromUrl) return;
    if (completedChallengeRef.current === challengeFromUrl) return;

    const deviceId = getOrCreateSuperAdminDeviceId();
    if (!deviceId) {
      setMessage("当前浏览器无法建立受信设备标识，请更换浏览器或关闭无痕模式后重试。");
      return;
    }

    completedChallengeRef.current = challengeFromUrl;
    setPendingChallenge(challengeFromUrl);
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
          | { error?: string; nextPath?: string; ok?: boolean; message?: string }
          | null;
        if (!response.ok || payload?.ok !== true) {
          throw new Error(payload?.message || describeSuperAdminLoginError(payload?.error ?? "super_admin_verification_failed"));
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
    setPendingChallenge("");

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
        | {
            error?: string;
            maskedEmail?: string;
            trustedDevice?: boolean;
            challenge?: string;
            message?: string;
            maxDevices?: number;
            currentCount?: number;
            requestIp?: string;
          }
        | null;
      if (!response.ok) {
        throw new Error(payload?.message || describeSuperAdminLoginError(payload?.error ?? "verification_send_failed"));
      }

      const maskedEmail = String(payload?.maskedEmail ?? "").trim() || "已配置的验证邮箱";
      const trustedDeviceTip = payload?.trustedDevice
        ? "当前浏览器已在白名单内。"
        : "当前浏览器会在验证成功后加入白名单。";
      const limitTip =
        typeof payload?.maxDevices === "number" && Number.isFinite(payload.maxDevices)
          ? `当前白名单上限 ${payload.maxDevices} 台，已登记 ${payload.currentCount ?? 0} 台。`
          : "";
      const requestIpTip = payload?.requestIp ? `本次登录 IP：${payload.requestIp}。` : "";
      setPendingChallenge(typeof payload?.challenge === "string" ? payload.challenge : "");
      setEmailPending(true);
      setMessage(
        `验证码邮件已发送到 ${maskedEmail}。你可以直接在当前页面输入验证码，或继续在同一设备、同一浏览器里点击邮件链接完成验证。${trustedDeviceTip}${limitTip}${requestIpTip}`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "验证码邮件发送失败，请稍后重试。");
    } finally {
      setPendingAction(null);
    }
  }

  async function verifyEmailCode() {
    if (pendingAction) return;
    if (!activeChallenge) {
      setEmailPending(false);
      setMessage("请先登录并发送验证码邮件。");
      return;
    }

    const deviceId = getOrCreateSuperAdminDeviceId();
    if (!deviceId) {
      setEmailPending(false);
      setMessage("当前浏览器无法建立受信设备标识，请更换浏览器或关闭无痕模式后重试。");
      return;
    }

    setPendingAction("verify_code");
    try {
      const response = await fetch("/api/super-admin/auth/verify-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          challenge: activeChallenge,
          deviceId,
          code: emailCode,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; nextPath?: string; ok?: boolean; message?: string }
        | null;
      if (!response.ok || payload?.ok !== true) {
        throw new Error(payload?.message || describeSuperAdminLoginError(payload?.error ?? "super_admin_verification_failed"));
      }
      setSuperAdminAuthenticated();
      window.location.href = typeof payload?.nextPath === "string" && payload.nextPath.startsWith("/")
        ? payload.nextPath
        : nextHref;
    } catch (error) {
      setEmailPending(false);
      setMessage(error instanceof Error ? error.message : "验证码验证失败，请重新获取后再试。");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-100 p-6">
      <div className="w-full max-w-md space-y-4 rounded-xl border bg-white p-6">
        <h1 className="text-xl font-bold">{t("superLogin.title")}</h1>
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          超级后台启用白名单设备。每次登录都需要向已配置的验证邮箱发送验证邮件，收到验证码后也可以直接在这里输入。
        </div>
        <div className="space-y-2">
          <div className="hidden" aria-hidden="true">
            <input type="text" tabIndex={-1} autoComplete="username" />
            <input type="password" tabIndex={-1} autoComplete="current-password" />
          </div>
          <div className="text-sm text-gray-600">{t("superLogin.account")}</div>
          <input
            ref={accountInputRef}
            className="w-full rounded border p-2"
            value={account}
            onChange={(event) => setAccount(event.target.value)}
            placeholder={t("superLogin.accountPlaceholder")}
            name="super-admin-login-account"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            data-lpignore="true"
          />
        </div>
        <div className="space-y-2">
          <div className="text-sm text-gray-600">{t("superLogin.password")}</div>
          <PasswordField
            ref={passwordInputRef}
            className="w-full rounded border p-2"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={t("superLogin.passwordPlaceholder")}
            name="super-admin-login-password"
            autoComplete="new-password"
            data-lpignore="true"
            showLabel={passwordToggleLabels.show}
            hideLabel={passwordToggleLabels.hide}
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>邮箱验证码</span>
            {activeChallenge ? <span className="text-xs text-slate-400">已发送验证码，可直接输入</span> : null}
          </div>
          <input
            className="w-full rounded border p-2"
            value={emailCode}
            onChange={(event) => setEmailCode(event.target.value)}
            placeholder="输入邮件里的验证码"
            inputMode="numeric"
            autoComplete="one-time-code"
          />
          <button
            type="button"
            className="w-full rounded border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
            onClick={() => void verifyEmailCode()}
            disabled={pendingAction !== null || !activeChallenge || !emailCode.trim()}
          >
            {pendingAction === "verify_code" ? "验证验证码中..." : "提交验证码"}
          </button>
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
            ? "发送验证码邮件中..."
            : pendingAction === "complete" || pendingAction === "verify_code"
              ? "验证中..."
              : t("superLogin.signIn")}
        </button>
        <div className="text-xs text-slate-500">
          邮件发出后，你可以直接输入验证码，也可以回到这台设备上的同一浏览器里继续点击邮件验证链接。
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
