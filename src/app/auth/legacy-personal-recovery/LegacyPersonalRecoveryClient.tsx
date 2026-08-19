"use client";

import Link from "next/link";
import { useState } from "react";

type RecoveryResponse = {
  ok?: boolean;
  error?: string;
  codeSent?: boolean;
  verified?: boolean;
  approvalPending?: boolean;
};

function describeError(code: string) {
  if (
    code === "legacy_personal_recovery_disabled" ||
    code === "legacy_personal_recovery_expired"
  ) {
    return "本次专用恢复通道已关闭。如仍需处理，请联系平台管理员。";
  }
  if (code === "legacy_personal_recovery_identity_mismatch") {
    return "输入信息与本次固定恢复对象不一致。";
  }
  if (
    code === "legacy_personal_recovery_otp_invalid_or_expired" ||
    code === "legacy_personal_recovery_nonce_invalid"
  ) {
    return "验证码或本次验证请求已失效，请重新获取验证码。";
  }
  if (code === "legacy_personal_recovery_otp_principal_mismatch") {
    return "验证码对应的账号与固定恢复对象不一致。";
  }
  if (code === "legacy_personal_recovery_rate_limited") {
    return "操作过于频繁，请稍后再试。";
  }
  if (code === "forbidden_origin") {
    return "请求来源未通过安全校验，请从本站页面重新操作。";
  }
  return "恢复服务暂时不可用，请稍后再试。";
}

export default function LegacyPersonalRecoveryClient() {
  const [email, setEmail] = useState("");
  const [personalAccountId, setPersonalAccountId] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [verified, setVerified] = useState(false);
  const [pending, setPending] = useState<"request" | "verify" | null>(null);
  const [message, setMessage] = useState("");

  async function post(path: string, body: Record<string, unknown>) {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as
      | RecoveryResponse
      | null;
    if (!response.ok || payload?.ok !== true) {
      throw new Error(describeError(payload?.error ?? ""));
    }
    return payload;
  }

  async function requestCode() {
    if (pending || verified) return;
    setPending("request");
    setMessage("");
    try {
      await post(
        "/api/auth/legacy-personal-recovery/request-code",
        { email, personalAccountId },
      );
      setCodeSent(true);
      setCode("");
      setMessage("验证码已发送。请检查邮箱并在 15 分钟内完成验证。" );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "恢复服务暂时不可用。" );
    } finally {
      setPending(null);
    }
  }

  async function verifyCode() {
    if (pending || verified || !codeSent) return;
    setPending("verify");
    setMessage("");
    try {
      await post(
        "/api/auth/legacy-personal-recovery/verify-code",
        { email, personalAccountId, code },
      );
      setVerified(true);
      setCode("");
      setMessage("邮箱验证已完成。平台管理员批准后，账号恢复才会最终生效。" );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "验证暂时不可用。" );
    } finally {
      setPending(null);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10">
      <section className="mx-auto w-full max-w-md space-y-5 rounded-2xl border bg-white p-6 shadow-sm">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold text-slate-950">个人账号专用恢复</h1>
          <p className="text-sm leading-6 text-slate-600">
            此页面只处理平台预先固定的一次性恢复对象。验证不会直接登录，也不会在浏览器中返回登录令牌。
          </p>
        </div>

        <label className="block space-y-1 text-sm text-slate-700">
          <span>原账号邮箱</span>
          <input
            className="w-full rounded-lg border px-3 py-2 outline-none focus:border-slate-500"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            disabled={verified || pending !== null}
          />
        </label>

        <label className="block space-y-1 text-sm text-slate-700">
          <span>原 8 位个人账号 ID</span>
          <input
            className="w-full rounded-lg border px-3 py-2 font-mono outline-none focus:border-slate-500"
            value={personalAccountId}
            onChange={(event) => setPersonalAccountId(event.target.value.replace(/\D/g, "").slice(0, 8))}
            inputMode="numeric"
            autoComplete="off"
            disabled={verified || pending !== null}
          />
        </label>

        <button
          type="button"
          className="w-full rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          disabled={
            verified ||
            pending !== null ||
            !email.trim() ||
            personalAccountId.length !== 8
          }
          onClick={() => void requestCode()}
        >
          {pending === "request" ? "正在发送..." : codeSent ? "重新发送验证码" : "发送邮箱验证码"}
        </button>

        {codeSent && !verified ? (
          <div className="space-y-3 rounded-xl border bg-slate-50 p-4">
            <label className="block space-y-1 text-sm text-slate-700">
              <span>邮箱验证码</span>
              <input
                className="w-full rounded-lg border bg-white px-3 py-2 font-mono tracking-widest outline-none focus:border-slate-500"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\s/g, "").slice(0, 12))}
                inputMode="numeric"
                autoComplete="one-time-code"
                disabled={pending !== null}
              />
            </label>
            <button
              type="button"
              className="w-full rounded-lg border border-slate-900 px-4 py-2 text-sm font-medium text-slate-900 disabled:opacity-50"
              disabled={pending !== null || code.length < 6}
              onClick={() => void verifyCode()}
            >
              {pending === "verify" ? "正在验证..." : "验证并等待管理员批准"}
            </button>
          </div>
        ) : null}

        {message ? (
          <div
            className={`rounded-lg px-3 py-2 text-sm leading-6 ${
              verified
                ? "bg-emerald-50 text-emerald-800"
                : "bg-amber-50 text-amber-900"
            }`}
            role="status"
          >
            {message}
          </div>
        ) : null}

        <Link href="/login" className="block text-center text-sm text-slate-500 hover:text-slate-900">
          返回登录页
        </Link>
      </section>
    </main>
  );
}
