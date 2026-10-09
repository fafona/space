"use client";
import Link from "next/link";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { AttendanceOnsiteDisplayClient } from "@/lib/merchantAttendanceOnsiteDisplayClient";
import MerchantAttendanceTerminalRecovery from "./MerchantAttendanceTerminalRecovery";

export default function MerchantAttendanceOnsiteDisplay({ scanOrigin, recoveryUrl }: { scanOrigin: string | null; recoveryUrl?: string | null }) {
  const client = useMemo(() => new AttendanceOnsiteDisplayClient({ scanOrigin }), [scanOrigin]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getServerSnapshot);
  useEffect(() => {
    void client.start(!document.hidden, navigator.onLine);
    const changed = () => { void client.setEnvironment(!document.hidden, navigator.onLine); };
    const leaving = () => { void client.setEnvironment(false, navigator.onLine); };
    document.addEventListener("visibilitychange", changed); window.addEventListener("online", changed); window.addEventListener("offline", changed);
    window.addEventListener("pagehide", leaving); window.addEventListener("pageshow", changed);
    return () => {
      document.removeEventListener("visibilitychange", changed); window.removeEventListener("online", changed); window.removeEventListener("offline", changed);
      window.removeEventListener("pagehide", leaving); window.removeEventListener("pageshow", changed); client.dispose();
    };
  }, [client]);
  return <main className="mx-auto min-h-screen max-w-3xl space-y-5 p-5 py-8 text-slate-900">
    <p className="text-xs font-semibold tracking-widest text-slate-500">FAOLLA ENTERPRISE</p>
    <h1 className="text-2xl font-bold">门店现场扫码</h1>
    <p className="rounded-xl bg-amber-50 p-4 text-sm leading-6">此页面只在已配对终端展示短时现场码。员工请用自己的手机扫码、登录本人账号，并明确选择打卡动作。公共终端不要登录员工或负责人账号。</p>
    <section aria-label="门店动态现场码" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
      <p role="status" aria-live="polite" className="text-sm leading-6">{state.message}</p>
      {state.code ? <div className="space-y-4">
        <div className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-2">
          {/* Local PNG only. No optimizer, remote image request, token text or download link. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={state.code.image} width={512} height={512} alt="门店动态现场码，请用本人手机扫描后登录并选择打卡动作" className="h-auto w-full"/>
        </div>
        <p className="text-center text-lg font-semibold tabular-nums" role="timer" aria-live="off">现场码剩余 {state.remainingSeconds} 秒</p>
        <dl className="space-y-2 text-sm"><div><dt className="inline font-semibold">企业编号：</dt><dd className="inline">{state.code.siteId}</dd></div>
          <div><dt className="font-semibold">地点编号</dt><dd className="break-all font-mono text-xs">{state.code.locationId}</dd></div>
          <div><dt className="font-semibold">终端编号</dt><dd className="break-all font-mono text-xs">{state.code.terminalId}</dd></div></dl>
        {!state.code.moduleEnabled && <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6">平台已暂停新增上班和开始休息。符合当前权限的员工仍可通过本人手机结束已有休息或完成下班，最终结果以服务器确认记录为准。</p>}
      </div> : <div className="flex min-h-48 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">{state.phase === "loading" ? "正在获取新码，旧码已清除…" : "当前没有可扫描的现场码"}</div>}
      <button type="button" className="min-h-12 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold disabled:opacity-40"
        disabled={!state.canRefresh} onClick={() => void client.refresh()}>{state.phase === "error" ? "重新获取现场码" : "刷新现场码"}{state.retryAfterSeconds > 0 ? `（${state.retryAfterSeconds} 秒后）` : ""}</button>
      <p className="text-xs leading-5 text-slate-500">页面可见且联网时约每 30 秒更新。断网、切到后台或发生错误时隐藏现场码；恢复页面或网络后重新核对。倒计时在本机运行，不会每秒请求服务器。</p>
    </section>
    <section className="space-y-2 text-sm leading-6" aria-label="现场扫码说明">
      <p>同一张有效码可供多名员工各自使用；每位员工每张码最多确认一次动作，下一次动作需要新码。扫描、打开页面或看到二维码都不等于打卡成功。</p>
      <p>首次扫码后如果需要登录，请登录完成后重新扫描当前新码。请勿截图或转发现场码；短时码仍可能被实时转发，不能保证真实到店，也不能完全防止代打。</p>
      <p>不能使用本人手机或扫码失败时，请联系负责人按企业既定替代方式处理；本页不会补造记录，也不提供离线打卡。</p>
    </section>
    <MerchantAttendanceTerminalRecovery url={recoveryUrl}/>
    <Link prefetch={false} className="inline-block rounded-xl border border-slate-300 px-4 py-3 text-sm underline" href="/enterprise/attendance-terminal">查看或配对门店终端</Link>
  </main>;
}
