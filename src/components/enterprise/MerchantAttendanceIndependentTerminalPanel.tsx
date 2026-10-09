"use client";
import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { AttendanceIndependentTerminalClient } from "@/lib/merchantAttendanceIndependentTerminalClient";
import type { IndependentAction } from "@/lib/merchantAttendanceIndependent";
const actionText = { clock_in: "上班", break_start: "开始休息", break_end: "结束休息", clock_out: "下班" };
const button = "rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm disabled:opacity-40";
/** Detached public terminal workspace. No merchant login, fabricated employee
 * identity or pairing secret is accepted by props, URL or browser storage. */
export default function MerchantAttendanceIndependentTerminalPanel({ allowNew = false }: { allowNew?: boolean }) {
  const client = useMemo(() => new AttendanceIndependentTerminalClient({ apiFetch: (url, init) => fetch(url, init), storage: () => sessionStorage, allowNew }), [allowNew]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [no, setNo] = useState(""), [pin, setPin] = useState(""), [from, setFrom] = useState(""), [through, setThrough] = useState(""), [paid, setPaid] = useState(false);
  const [localMessage, setLocalMessage] = useState("");
  const busy = state.phase === "loading" || state.phase === "saving", validPin = /^\d{8,12}$/.test(pin);
  const result = state.result?.data, subject = result?.kind === "state" ? result.subject : result?.kind === "personal" ? result.report : null;
  useLayoutEffect(() => {
    const clear = () => { flushSync(() => { client.pause(); setPin(""); setNo(""); setFrom(""); setThrough(""); setPaid(false); setLocalMessage(""); }); };
    const hidden = () => { if (document.hidden) clear(); };
    document.addEventListener("visibilitychange", hidden); window.addEventListener("pagehide", clear);
    return () => { client.dispose(); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", clear); };
  }, [client]);
  useEffect(() => { if (!pin && !no) return; const timer = setTimeout(() => { client.clear(); setPin(""); setNo(""); setFrom(""); setThrough(""); setPaid(false); setLocalMessage("15秒后，输入与资料已清除；原待确认编号仍保留。"); }, 15000);
    return () => clearTimeout(timer); }, [pin, no, client]);
  const run = (work: (value: string) => Promise<unknown>) => {
    if (document.hidden || busy || !validPin) return; const value = pin; setPin(""); setLocalMessage("");
    void work(value).catch(() => { setLocalMessage("未能确认操作结果。请保留原编号，重新验证本人 PIN；不会自动重复提交。"); });
  };
  const punch = (action: IndependentAction) => { if (!validPin || !window.confirm(`确认${actionText[action]}？仅提交这一个动作，以服务器时间为准。`)) return;
    run(value => client.punch(action, value, action === "break_start" ? paid : null)); };
  const report = result?.kind === "personal" ? result.report : null;
  return <main className="mx-auto min-h-screen max-w-3xl space-y-5 p-4 py-8 text-slate-900">
    <header className="space-y-3"><h1 className="text-2xl font-bold">独立员工终端打卡</h1>
      <p className="rounded-xl bg-amber-50 p-4 text-sm leading-6">仅供已由负责人建立的独立考勤人员。每次操作重新验证本人 PIN；配对设备不等于真实到场，需要定位的地点不能由此绕过。</p>
      <div className="flex flex-wrap gap-3"><Link prefetch={false} className="text-sm underline" href="/enterprise/attendance-terminal">原终端配对／撤销状态入口</Link>
        <button className={button} disabled={busy} onClick={() => { setPin(""); setNo(""); setFrom(""); setThrough(""); setPaid(false); setLocalMessage(""); void client.initialize().catch(() => {}); }}>检查已配对设备</button>
        <button className={button} disabled={busy} onClick={() => { client.clear(); setPin(""); setNo(""); setFrom(""); setThrough(""); setPaid(false); setLocalMessage(""); }}>清除资料／下一位</button></div>
      {state.device && <p className="break-words text-sm">{state.device.label} · 企业 {state.device.siteId}</p>}
      {(!allowNew || state.device?.moduleEnabled === false) && <p className="text-sm text-amber-800">新上班／新休息未开放；仍可验证本人、核对原编号，以及在服务端允许时结束休息或下班。</p>}
    </header>
    <form className="space-y-4 rounded-2xl border border-slate-300 bg-white p-5" onSubmit={e => { e.preventDefault(); run(value => client.read(no.trim(), value)); }}>
      <label className="block text-sm">本人考勤工号<input className="mt-2 w-full min-w-0 rounded-xl border p-3" maxLength={40} autoComplete="off" value={no} disabled={busy || !state.device}
        onChange={e => { client.clear(); setPin(""); setFrom(""); setThrough(""); setPaid(false); setLocalMessage(""); setNo(e.target.value); }} /></label>
      <label className="block text-sm">本次操作的本人 PIN<input className="mt-2 w-full min-w-0 rounded-xl border p-3" type="password" inputMode="numeric" autoComplete="off" maxLength={12}
        value={pin} disabled={busy || !state.device} onChange={e => setPin(e.target.value)} /></label>
      <div className="flex flex-wrap gap-3"><button className={button} disabled={busy || !state.device || !no.trim() || !validPin}>验证并读取当前状态</button>
        <button type="button" className={button} disabled={busy || !state.device || !no.trim() || !validPin} onClick={() => run(value => client.recover(no.trim(), value))}>只读核对原编号（不重新打卡）</button></div>
      <p className="text-xs leading-6 text-slate-500">核对使用携 PIN 的只读 POST 验证原回执，不是再次提交打卡。未知／空结果不会清除原编号。</p>
    </form>
    <p role="status" className="break-words text-sm leading-6">{localMessage || state.message}</p>
    {state.pending && <p className="break-all rounded-xl bg-amber-50 p-4 text-xs">待核对原编号：{state.pending.command.operationId} · {actionText[state.pending.command.action]}</p>}
    {result?.kind === "state" && <section aria-label="本人当前打卡状态" className="space-y-4 rounded-2xl border border-blue-200 bg-blue-50 p-5">
      <h2 className="break-words font-semibold">{result.subject.displayName} · {result.subject.workerNo}</h2>
      <p>当前：{{ off: "未上班", working: "工作中", break: "休息中" }[result.head.status]} · 顺序 {result.head.sequence}</p>
      <p className="text-sm">请重新输入 PIN 后确认一个动作。</p>
      <div className="flex flex-wrap gap-3">
        {result.head.status === "off" && <button className={button} disabled={busy || !validPin || !allowNew || !state.device?.moduleEnabled} onClick={() => punch("clock_in")}>确认上班</button>}
        {result.head.status === "working" && <><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={paid} disabled={busy} onChange={e => setPaid(e.target.checked)} />本次休息计为带薪（仅事实快照）</label>
          <button className={button} disabled={busy || !validPin || !allowNew || !state.device?.moduleEnabled} onClick={() => punch("break_start")}>确认开始休息</button>
          <button className={button} disabled={busy || !validPin} onClick={() => punch("clock_out")}>确认下班</button></>}
        {result.head.status === "break" && <button className={button} disabled={busy || !validPin} onClick={() => punch("break_end")}>确认结束休息</button>}
      </div>
    </section>}
    {subject && <section aria-label="本人原始明细" className="space-y-4 rounded-2xl border p-5">
      <h2 className="font-semibold">本人原始明细（未规则评估）</h2><p className="text-sm">最多31个地点日，每页最多25个完整班次；开放班次明确标为未结束。不是工资表或正式周期。</p>
      {!report && <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">开始日期<input className="mt-2 block w-full rounded-xl border p-3" type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="text-sm">结束日期<input className="mt-2 block w-full rounded-xl border p-3" type="date" value={through} onChange={e => setThrough(e.target.value)} /></label>
        <button className={button} disabled={busy || !validPin || !from || !through} onClick={() => run(value => client.personal(subject.workerNo, value, from, through))}>重新验证 PIN 并查询当前页</button></div>}
      {report && <><p className="text-sm">{report.fromDate}—{report.throughDate} · {report.timeZone} · {report.rangeComplete ? "范围已完整读取" : "仅当前页"}</p>
        {report.items.length === 0 && <p className="text-sm">当前范围没有班次。</p>}
        {report.items.map(item => <article key={item.startEventId} className="space-y-2 rounded-xl border p-3"><p className="font-medium">{item.complete ? "已结束班次" : "开放班次（未结束）"}</p>
          {item.events.map(row => <p key={row.event.id} className="break-words text-sm">{actionText[row.event.action]} · {row.event.occurredAt} UTC · 顺序 {row.event.sequence}</p>)}</article>)}
        {report.nextCursor && <button className={button} disabled={busy || !validPin} onClick={() => run(value => client.personal(report.workerNo, value, report.fromDate, report.throughDate, report.nextCursor))}>重新验证 PIN 并读取下一页</button>}</>}
    </section>}
    {result?.kind === "receipt" && result.receipt && <section className="rounded-2xl border border-green-200 bg-green-50 p-5"><p>原打卡已确认：{actionText[result.receipt.event.action]}</p>
      <p className="break-all text-sm">{result.receipt.operationId} · {result.receipt.event.occurredAt} UTC</p></section>}
    <footer className="text-xs leading-6 text-slate-500">PIN不保存到浏览器存储，不放进链接。每次提交后立即清除输入；15秒、隐藏标签页或离开页面时清除正文。非秘密原编号和完整命令只留在本标签页会话存储，核对前不自动重试、不离线补传。</footer>
  </main>;
}
