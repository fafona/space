"use client";
import { useState } from "react";
import { serviceButton, serviceRequest } from "./serviceCenterClient";

export default function ServiceAccountSessionActions({ onSignedOut, onRefresh }: { onSignedOut: () => void; onRefresh: () => Promise<void> }) {
  const [intent, setIntent] = useState<"logout" | "switch" | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const logout = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await serviceRequest("/api/auth/merchant-logout", { method: "POST" });
      try { const { clearStoredBrowserSupabaseSessionTokens } = await import("@/lib/authSessionRecovery"); clearStoredBrowserSupabaseSessionTokens(); } catch { /* Server-confirmed logout still invalidates the private UI. */ }
      onSignedOut();
    } catch { setError("暂时无法确认退出结果，请重新读取账号状态后再试。"); }
    finally { setBusy(false); }
  };
  return <section className="space-y-3" aria-label="账号操作">
    <div className="grid grid-cols-2 gap-3"><button type="button" className={serviceButton} disabled={busy} onClick={() => { setIntent("switch"); setError(""); }}>切换账号</button><button type="button" className={serviceButton + " !border-rose-100 !text-rose-700"} disabled={busy} onClick={() => { setIntent("logout"); setError(""); }}>退出登录</button></div>
    {intent ? <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm" role="region" aria-label={intent === "switch" ? "切换账号确认" : "退出登录确认"}><p className="font-semibold">{intent === "switch" ? "先退出当前账号，再选择其他账号登录。" : "确认退出当前账号？"}</p><p className="mt-2 text-xs leading-5 text-slate-600">不会退会或删除资料、积分、订单、预约和会话。退出后可点击“用户登录 / 注册”重新登录。</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" className={serviceButton} disabled={busy} onClick={() => void logout()}>{busy ? "退出中…" : "确认退出当前账号"}</button><button type="button" className={serviceButton} disabled={busy} onClick={() => setIntent(null)}>取消</button></div></div> : null}
    {error ? <div role="alert" className="space-y-2 text-sm text-rose-700"><p>{error}</p><button type="button" className={serviceButton} disabled={busy} onClick={() => void onRefresh()}>重新读取账号状态</button></div> : null}
  </section>;
}
