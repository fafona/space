"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AttendanceCorrectionControlsClient, type CorrectionControlIntent } from "@/lib/merchantAttendanceCorrectionControlsClient";
import type { CorrectionControlResult } from "@/lib/merchantAttendanceCorrectionControls";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40";
const input = "mt-1 w-full rounded-xl border border-slate-300 bg-white p-2 text-sm disabled:opacity-50";
const labels = { set_policy: "设置申请期限", lock_period: "锁定周期", unlock_period: "解锁周期" };
type Props = { siteId: string; ownerId: string; apiFetch: AttendanceApiFetch; onClose: () => void };
export default function MerchantAttendanceCorrectionControlsPanel(props: Props) { return <Screen key={`${props.siteId}:${props.ownerId}`} {...props}/>; }
function Screen({ siteId, ownerId, apiFetch, onClose }: Props) {
  const client = useMemo(() => new AttendanceCorrectionControlsClient({ siteId, ownerId, apiFetch, storage: () => window.sessionStorage }), [siteId, ownerId, apiFetch]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot), [dirty, setDirty] = useState(false);
  useEffect(() => { void client.initialize(); const visible = () => { if (document.visibilityState === "hidden") { client.pause(); setDirty(false); } else void client.initialize(); };
    document.addEventListener("visibilitychange", visible); return () => { document.removeEventListener("visibilitychange", visible); client.pause(); }; }, [client]);
  useEffect(() => { const warn = (e: BeforeUnloadEvent) => { if (dirty || state.pending) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty, state.pending]);
  const leaveDraft = () => !dirty || window.confirm("未提交的修改会丢失，继续吗？");
  const r = state.result, busy = state.phase === "saving" || state.phase === "loading";
  return <section aria-label="补正规则与锁定配置" className="mt-5 min-w-0 space-y-4 rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
    <header className="flex flex-wrap justify-between gap-3"><div><h2 className="text-xl font-bold">补正规则与锁定配置</h2><p className="mt-1 text-sm text-slate-600">仅当前商户负责人 · 配置准备</p></div>
      <button type="button" className={button} onClick={() => { if (!leaveDraft() || state.pending && !window.confirm("操作结果待确认，离开不会撤销保存。之后须用同一账号和标签页查询原编号，继续吗？")) return; client.pause(); onClose(); }}>返回考勤管理</button></header>
    <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-950">这里保存规则与锁定配置。新版员工补正入口按规则核验新申请，旧申请不自动套用新期限。这里不批准／驳回，也不改变已记录工时；不能将“已配置锁定”当作工时已冻结或工资已结算。</p>
    <p role="status" aria-live="polite" className="rounded-xl bg-blue-50 p-3 text-sm text-blue-950">{state.message}</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => { if (leaveDraft()) { setDirty(false); void client.initialize(); } }}>重新读取／查原收据</button>
      {state.pending && <button type="button" className={button} disabled={busy || state.phase !== "unconfirmed"} onClick={() => void client.retry()}>用原编号明确重试</button>}</div>
    {state.pending && <p className="break-all rounded-xl bg-amber-50 p-3 text-xs">待确认编号：{state.pending.command.operationId}。未查到收据也不能认定没保存；不自动新建编号。</p>}
    {r && <><div className="space-y-2 rounded-xl bg-slate-50 p-4 text-sm"><p>当前配置版本 {r.revision} · 企业设置版本 {r.settingsVersion} · 新周期使用 {r.timeZone}</p>
      <p>{r.policy ? `已配置期限：原始上班日期后 ${r.policy.values.submissionWindowDays} 个自然日内（0 为当日），按 ${r.policy.values.timeZone} 计算。` : "尚未配置申请期限，不替企业预设。"}</p>
      <p className="text-xs text-slate-500">用于新版入口保存后提交的申请；不追溯改写旧申请。期限以原始上班日期为基准，不能通过改申请时间延后截止日。审批与生效通路仍待接入。</p></div>
      <ControlForm key={`${r.revision}:${r.settingsVersion}`} result={r} disabled={busy || !!state.pending || !r.moduleEnabled} onDirty={() => setDirty(true)}
        onSubmit={intent => { setDirty(false); void client.submit(intent); }}/>
      <section className="space-y-2"><h3 className="font-bold">已配置的锁定周期（{r.activePeriods.length} / 200）</h3>
        {!r.activePeriods.length && <p className="text-sm text-slate-500">暂无锁定配置。</p>}
        <div className="max-h-80 space-y-2 overflow-auto">{r.activePeriods.map(p => <article key={p.periodId} className="rounded-xl border border-slate-200 p-3 text-sm"><p className="font-semibold">{p.fromDate} — {p.throughDate}（含结束日）</p>
          <p>{p.timeZone} · 配置版本 {p.revision}</p><details className="mt-1 text-xs"><summary>查看实际范围与编号</summary><p className="break-all">UTC：{p.startAt} 至 {p.endAt}（不含终点）<br/>{p.periodId}</p></details></article>)}</div>
      </section>
      <section className="space-y-2"><h3 className="font-bold">配置历史 · 只追加，不覆盖</h3><div className="max-h-96 space-y-2 overflow-auto">{r.entries.map(e => <article key={e.revision} className="rounded-xl border border-slate-200 p-3 text-sm">
        <h4 className="font-semibold">#{e.revision} · {labels[e.action]}</h4><p>{e.action === "set_policy" ? `${e.values.submissionWindowDays} 个自然日 · ${e.values.timeZone}` : `${e.values.fromDate} — ${e.values.throughDate} · ${e.values.timeZone}`}</p>
        <p className="break-words">理由：{e.reason}</p><p className="break-all text-xs text-slate-500">UTC：{e.recordedAt}<br/>操作编号：{e.operationId}</p></article>)}</div>
        <div className="flex gap-2"><button type="button" className={button} disabled={busy || !!state.pending} onClick={() => { if (leaveDraft()) { setDirty(false); void client.page(null); } }}>最新历史</button>
          <button type="button" className={button} disabled={busy || !!state.pending || !r.nextBeforeRevision} onClick={() => { if (leaveDraft()) { setDirty(false); void client.page(r.nextBeforeRevision); } }}>更早历史</button></div></section>
    </>}
    <p className="text-xs leading-6 text-slate-500">锁定覆盖整个企业，当前最多 200 个不重叠范围，每次最多 366 个自然日，只允许已经结束的日期。更换企业时区不会改变旧范围；解锁须选择原周期并说明理由，重新锁定会建立新编号。未提交草稿不持久保存，隐藏／卸载时清除；已发送操作只在当前标签页暂存，关闭标签页或清理站点后不能保证自动恢复。</p>
  </section>;
}
function ControlForm({ result: r, disabled, onDirty, onSubmit }: { result: CorrectionControlResult; disabled: boolean; onDirty: () => void; onSubmit: (i: CorrectionControlIntent) => void }) {
  const [action, setAction] = useState<CorrectionControlIntent["action"]>("set_policy"), [days, setDays] = useState(r.policy ? String(r.policy.values.submissionWindowDays) : "");
  const [from, setFrom] = useState(""), [through, setThrough] = useState(""), [periodId, setPeriod] = useState(""), [reason, setReason] = useState(""), [ack, setAck] = useState(false);
  return <form className="space-y-3 rounded-xl border border-slate-200 p-4" onChange={() => { onDirty(); setAck(false); }} onSubmit={e => {
    e.preventDefault(); if (disabled || !ack || !reason.trim() || [...reason.trim()].length > 500) return;
    const intent: CorrectionControlIntent = action === "set_policy" ? { action, submissionWindowDays: Number(days), reason }
      : action === "lock_period" ? { action, fromDate: from, throughDate: through, reason } : { action, periodId, reason };
    onSubmit(intent);
  }}>
    <label className="block text-sm">配置操作<select className={input} value={action} disabled={disabled} onChange={e => setAction(e.target.value as typeof action)}>{Object.entries(labels).map(([v, text]) => <option key={v} value={v}>{text}</option>)}</select></label>
    {action === "set_policy" ? <label className="block text-sm">原始上班日期后可提交天数（0—365）<input type="number" className={input} required min={0} max={365} step={1} value={days} disabled={disabled} onChange={e => setDays(e.target.value)}/></label>
      : action === "lock_period" ? <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">锁定开始日期<input type="date" required className={input} value={from} disabled={disabled} onChange={e => setFrom(e.target.value)}/></label><label className="text-sm">锁定结束日期（含）<input type="date" required className={input} value={through} disabled={disabled} onChange={e => setThrough(e.target.value)}/></label></div>
        : <label className="block text-sm">选择需要解锁的周期<select className={input} required value={periodId} disabled={disabled} onChange={e => setPeriod(e.target.value)}><option value="">请选择</option>{r.activePeriods.map(p => <option key={p.periodId} value={p.periodId}>{p.fromDate} — {p.throughDate} · {p.timeZone}</option>)}</select></label>}
    <label className="block text-sm">变更理由（必填，最多 500 字）<textarea className={input} required rows={2} value={reason} disabled={disabled} onChange={e => setReason(e.target.value)}/></label>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={ack} disabled={disabled} onChange={e => { e.stopPropagation(); setAck(e.target.checked); onDirty(); }}/><span>已核对范围与理由，确认保存配置；了解尚未接入审批与工时生效。</span></label>
    <button type="submit" className={button} disabled={disabled || !ack || !reason.trim() || [...reason.trim()].length > 500}>确认{labels[action]}</button>
  </form>;
}
