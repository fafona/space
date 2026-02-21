"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  function validate(): string | null {
    if (!password) return "请输入新密码";
    if (password.length < 6) return "新密码至少 6 位";
    if (!confirmPassword) return "请再次输入新密码";
    if (password !== confirmPassword) return "两次输入的密码不一致";
    return null;
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

  async function updatePassword() {
    if (saving) return;
    setMsg("");
    const validationError = validate();
    if (validationError) return setMsg(validationError);

    setSaving(true);
    try {
      const { error } = await withTimeout(supabase.auth.updateUser({ password }));

      if (error) {
        if (/session/i.test(error.message)) {
          setMsg("重置会话已失效，请回到登录页重新发送找回密码邮件。");
          return;
        }
        setMsg(error.message);
        return;
      }

      setMsg("密码已重置成功，正在跳转到登录页...");
      setTimeout(() => {
        window.location.href = "/login";
      }, 900);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "请求失败，请检查网络后重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border rounded-xl p-6 space-y-4">
        <h1 className="text-xl font-bold">重置密码</h1>

        <div className="space-y-2">
          <div className="text-sm text-gray-600">新密码</div>
          <input
            className="border p-2 w-full rounded"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="至少 6 位"
          />
        </div>

        <div className="space-y-2">
          <div className="text-sm text-gray-600">确认新密码</div>
          <input
            className="border p-2 w-full rounded"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="再次输入新密码"
          />
        </div>

        {msg ? <div className="text-sm text-red-600">{msg}</div> : null}

        <button
          className="w-full px-3 py-2 rounded bg-black text-white disabled:opacity-40"
          onClick={updatePassword}
          disabled={saving}
        >
          {saving ? "提交中..." : "确认重置密码"}
        </button>

        <button
          className="w-full px-3 py-2 rounded border bg-white hover:bg-gray-50"
          onClick={() => (window.location.href = "/login")}
        >
          返回登录
        </button>
      </div>
    </main>
  );
}
