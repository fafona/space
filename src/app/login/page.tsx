"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string>("");
  const [needConfirmEmail, setNeedConfirmEmail] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    "signin" | "signup" | "forgot" | "resend" | null
  >(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) window.location.href = "/admin";
    });
  }, []);

  function validateForm(): string | null {
    const trimmedEmail = email.trim();

    if (!trimmedEmail) return "请输入邮箱";
    if (!trimmedEmail.includes("@")) return "请输入正确的邮箱格式";
    if (!password) return "请输入密码";
    if (password.length < 6) return "密码至少 6 位";

    return null;
  }

  function isEmailNotConfirmed(message: string) {
    return /Email not confirmed/i.test(message);
  }

  function normalizeError(message: string) {
    if (isEmailNotConfirmed(message)) {
      return "邮箱未验证，请先去邮箱点击验证链接后再登录。";
    }
    return message;
  }

  async function withTimeout<T>(task: Promise<T>, timeoutMs = 15000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeoutTask = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("请求超时，请稍后重试")), timeoutMs);
    });

    try {
      return await Promise.race([task, timeoutTask]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function signUp() {
    if (pendingAction) return;
    setMsg("");
    setNeedConfirmEmail(false);

    const validationError = validateForm();
    if (validationError) return setMsg(validationError);

    setPendingAction("signup");
    try {
      const { error } = await withTimeout(
        supabase.auth.signUp({ email: email.trim(), password }),
      );
      if (error) return setMsg(normalizeError(error.message));
      setMsg("注册成功，请检查邮箱完成验证，然后再登录。");
      setNeedConfirmEmail(true);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "请求失败，请检查网络后重试");
    } finally {
      setPendingAction(null);
    }
  }

  async function signIn() {
    if (pendingAction) return;
    setMsg("");
    setNeedConfirmEmail(false);

    const validationError = validateForm();
    if (validationError) return setMsg(validationError);

    setPendingAction("signin");
    try {
      const { error } = await withTimeout(
        supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        }),
      );
      if (error) {
        setNeedConfirmEmail(isEmailNotConfirmed(error.message));
        return setMsg(normalizeError(error.message));
      }
      window.location.href = "/admin";
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "请求失败，请检查网络后重试");
    } finally {
      setPendingAction(null);
    }
  }

  async function resendConfirmationEmail() {
    if (pendingAction) return;
    setMsg("");

    const trimmedEmail = email.trim();
    if (!trimmedEmail) return setMsg("请先输入注册邮箱");

    setPendingAction("resend");
    try {
      const { error } = await withTimeout(
        supabase.auth.resend({
          type: "signup",
          email: trimmedEmail,
          options: {
            emailRedirectTo: `${window.location.origin}/login`,
          },
        }),
      );

      if (error) return setMsg(normalizeError(error.message));
      setMsg("验证邮件已重新发送，请检查收件箱和垃圾箱。");
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "请求失败，请检查网络后重试");
    } finally {
      setPendingAction(null);
    }
  }

  async function forgotPassword() {
    if (pendingAction) return;
    setMsg("");
    setNeedConfirmEmail(false);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) return setMsg("请先输入邮箱，再点击找回密码");
    if (!trimmedEmail.includes("@")) return setMsg("请输入正确的邮箱格式");

    setPendingAction("forgot");
    try {
      const { error } = await withTimeout(
        supabase.auth.resetPasswordForEmail(trimmedEmail, {
          redirectTo: `${window.location.origin}/reset-password`,
        }),
      );

      if (error) return setMsg(normalizeError(error.message));
      setMsg("找回密码邮件已发送，请去邮箱点击链接后重置密码。");
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "请求失败，请检查网络后重试");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <main className="min-h-screen bg-gray-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border rounded-xl p-6 space-y-4">
        <h1 className="text-xl font-bold">商家后台登录</h1>

        <div className="space-y-2">
          <div className="text-sm text-gray-600">邮箱</div>
          <input
            className="border p-2 w-full rounded"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>

        <div className="space-y-2">
          <div className="text-sm text-gray-600">密码</div>
          <input
            className="border p-2 w-full rounded"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="至少 6 位"
          />
        </div>

        {msg ? <div className="text-sm text-red-600">{msg}</div> : null}

        <div className="flex gap-2">
          <button
            className="flex-1 px-3 py-2 rounded bg-black text-white disabled:opacity-50"
            onClick={signIn}
            disabled={pendingAction !== null}
          >
            {pendingAction === "signin" ? "登录中..." : "登录"}
          </button>
          <button
            className="flex-1 px-3 py-2 rounded border bg-white disabled:opacity-50"
            onClick={signUp}
            disabled={pendingAction !== null}
          >
            {pendingAction === "signup" ? "注册中..." : "注册"}
          </button>
        </div>

        <button
          className="w-full px-3 py-2 rounded border bg-white hover:bg-gray-50 disabled:opacity-50"
          onClick={forgotPassword}
          disabled={pendingAction !== null}
        >
          {pendingAction === "forgot" ? "发送中..." : "忘记密码（通过邮箱找回）"}
        </button>

        {needConfirmEmail ? (
          <button
            className="w-full px-3 py-2 rounded border bg-white hover:bg-gray-50 disabled:opacity-50"
            onClick={resendConfirmationEmail}
            disabled={pendingAction !== null}
          >
            {pendingAction === "resend" ? "发送中..." : "重发验证邮件"}
          </button>
        ) : null}

        <div className="text-xs text-gray-500">首次注册后需要先验证邮箱，再进行登录。</div>
      </div>
    </main>
  );
}
