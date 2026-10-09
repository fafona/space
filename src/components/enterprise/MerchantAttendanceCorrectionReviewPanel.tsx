"use client";
import RulesNotice from "./MerchantAttendanceCorrectionRulesNotice";
import DecisionNotice from "./MerchantAttendanceCorrectionDecisionNotice";
import EventChannels from "./MerchantAttendanceEventChannels";
import {correctionStatusLabel} from "@/lib/merchantAttendanceCorrection";
import { lazy, Suspense, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type {CorrectionDecisionRecord} from "@/lib/merchantAttendanceCorrectionDecisionRecord";
import { AttendanceCorrectionReviewClient, correctionReviewDateQuery } from "@/lib/merchantAttendanceCorrectionReviewClient";
import { CORRECTION_CHECK_LABELS, correctionReviewComparison, inspectCorrectionReview, type CorrectionReviewResult } from "@/lib/merchantAttendanceCorrectionReview";
import { formatAttendanceDurationUs } from "@/lib/merchantAttendanceSession";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40";
const input = "mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white p-2 text-sm";
const DecisionPanel=lazy(()=>import("./MerchantAttendanceCorrectionDecisionPanel"));
type Props = { siteId: string; ownerId: string; apiFetch: AttendanceApiFetch; onClose: () => void; decisionsEnabled?:boolean;
  initialRequestId?: string; registerLeaveGuard?: (guard: (() => boolean) | null) => void };
export default function MerchantAttendanceCorrectionReviewPanel(props: Props) { return <Screen key={`${props.siteId}:${props.ownerId}:${props.initialRequestId ?? "list"}`} {...props}/>; }
function Screen({ siteId, ownerId, apiFetch, onClose, initialRequestId, registerLeaveGuard, decisionsEnabled=process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_CORRECTION_DECISIONS_ENABLED === "1" && process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_CURRENT_CORRECTION_DECISIONS_ENABLED === "1" }: Props) {
  const client = useMemo(() => new AttendanceCorrectionReviewClient({ siteId, apiFetch }), [siteId, apiFetch]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [from, setFrom] = useState(() => new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10));
  const [through, setThrough] = useState(() => new Date().toISOString().slice(0, 10)), [zone, setZone] = useState("UTC");
  const [status, setStatus] = useState<"all" | "submitted" | "withdrawn">("all"), [worker, setWorker] = useState<{ id: string; name: string } | null>(null), [error, setError] = useState("");
  const [decisionTarget,setDecisionTarget]=useState<string|null|undefined>(initialRequestId);
  useEffect(() => { if(decisionsEnabled&&decisionTarget!==undefined)return; const visible = () => { if (document.visibilityState === "hidden") client.invalidate(); else void client.refresh(); };
    document.addEventListener("visibilitychange", visible); return () => { document.removeEventListener("visibilitychange", visible); client.invalidate(); }; }, [client,decisionsEnabled,decisionTarget]);
  const busy = state.phase === "loading", r = state.result;
  const changed = () => { client.invalidate(true); setError(""); };
  const openDecision=(requestId:string|null)=>{client.invalidate();setDecisionTarget(requestId);};
  const channels=(result:Extract<CorrectionReviewResult,{mode:"detail"}>)=><EventChannels siteId={siteId} actorId={ownerId} access="owner" workerId={result.item.workerId} eventIds={result.application.basis.events.map(event=>event.id)} readKey={result.asOf} apiFetch={apiFetch}/>;
  if(decisionsEnabled&&decisionTarget!==undefined)return <Suspense fallback={<p role="status" className="p-4">正在加载审批操作…</p>}><DecisionPanel siteId={siteId} ownerId={ownerId} initialRequestId={decisionTarget} apiFetch={apiFetch}
    registerLeaveGuard={registerLeaveGuard} onClose={()=>{if(initialRequestId !== undefined) { onClose(); return; } setDecisionTarget(undefined);void client.refresh();}} renderReview={result=><><ReviewDetail result={result.review} decision={result.decision} decisionContext/>{channels(result.review)}</>}/></Suspense>;
  return <section aria-label="负责人补正申请核对" className="mt-5 min-w-0 space-y-4 rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold">补正申请核对</h2><p className="mt-1 text-sm text-slate-600">仅当前商户负责人 · 只读预核对</p></div><button type="button" className={button} onClick={() => { client.invalidate(); onClose(); }}>返回考勤管理</button></header>
    <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-950">本页只读，目前不能在这里批准或驳回。详情核对提交时期限、当前锁定与已有决定；{decisionsEnabled?"请进入独立审批操作页重新核对并明确确认。":"审批操作入口尚未开放。"}不能拿只读结果当批准凭证。</p>
    {decisionsEnabled&&<button type="button" className={button} disabled={busy} onClick={()=>openDecision(null)}>审批操作／恢复待确认</button>}
    <form className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" onSubmit={e => { e.preventDefault(); try { const q = correctionReviewDateQuery(siteId, from, through, zone, status, worker?.id ?? null); setError(""); void client.load(q); }
      catch { client.invalidate(true); setError("请核对提交日期和时区，一次最多查询 30 个自然日。"); } }}>
      <label className="text-sm">提交开始日期<input className={input} type="date" required value={from} onChange={e => { changed(); setFrom(e.target.value); }}/></label>
      <label className="text-sm">提交结束日期（含）<input className={input} type="date" required value={through} onChange={e => { changed(); setThrough(e.target.value); }}/></label>
      <label className="text-sm">日期查询时区<input className={input} value={zone} list="correction-review-zones" required onChange={e => { changed(); setZone(e.target.value); }}/>
        <datalist id="correction-review-zones">{["UTC", "Europe/Madrid", "Atlantic/Canary", "Asia/Shanghai"].map(z => <option key={z} value={z}/>)}</datalist></label>
      <label className="text-sm">申请状态<select className={input} value={status} onChange={e => { changed(); setStatus(e.target.value as typeof status); }}><option value="all">全部</option><option value="submitted">未撤回（含已审批）</option><option value="withdrawn">已撤回</option></select></label>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2 xl:col-span-4"><button type="submit" className={button} disabled={busy}>查询申请</button>
        {worker && <><span className="text-sm">仅查看：{worker.name}</span><button type="button" className={button} onClick={() => { changed(); setWorker(null); }}>清除员工筛选</button></>}
      </div>
    </form>
    <p role="status" aria-live="polite" className={`rounded-xl p-3 text-sm ${error || state.phase === "blocked" ? "bg-rose-50 text-rose-900" : "bg-blue-50 text-blue-950"}`}>{error || state.message}</p>
    {r?.mode === "list" && <div className="space-y-3">{r.items.map(item => <article key={item.requestId} className="space-y-2 rounded-xl border border-slate-200 p-3 text-sm">
      <h3 className="font-bold">{item.workerName} · {item.workerNo}</h3><p>{correctionStatusLabel(item)} · 申请版本 {item.revision}</p>
      <p className="break-all text-xs">提交 UTC：{item.submittedAt}<br/>声明 UTC：{item.startAt} → {item.endAt}</p>
      <div className="flex flex-wrap gap-2"><button type="button" className={button} onClick={() => void client.detail(item.requestId)}>核对差异与冲突</button>
        <button type="button" className={button} onClick={() => { changed(); setWorker({ id: item.workerId, name: item.workerName }); }}>筛选此员工</button></div></article>)}
      {!r.items.length && <p className="text-sm text-slate-600">本批未匹配申请。{r.nextCursor ? "仍有后续候选，请查看下一批。" : "可调整筛选后查询。"}</p>}
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => void client.first()}>重新查询首页</button><button type="button" className={button} disabled={busy || !r.nextCursor} onClick={() => void client.next()}>下一批</button></div>
      <p className="break-all text-xs text-slate-500">本次分页截止 UTC：{r.asOf}。按提交时间排序，每批最多扫描 50 份；不是实时总数或锁定报表。显示名与工号为当前标签，详情重新读取当前状态。</p>
    </div>}
    {r?.mode === "detail" && <><div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => void client.first()}>返回最新列表</button><button type="button" className={button} disabled={busy} onClick={() => void client.refresh()}>重新核对本申请</button>{decisionsEnabled&&<button type="button" className={button} disabled={busy} onClick={()=>openDecision(r.item.requestId)}>进入本申请审批</button>}</div><ReviewDetail result={r}/>{channels(r)}</>}
    <p className="text-xs leading-6 text-slate-500">新考勤暂停后，仍可按当前负责人权限核对既有申请。不会将他人的申请资料存入浏览器持久存储，不轮询；切到后台即隐藏，返回时重新鉴权。页面关闭时不会提交任何审批。</p>
  </section>;
}
function ReviewDetail({ result: r,decision,decisionContext=false }: { result: Extract<CorrectionReviewResult, { mode: "detail" }>;decision?:CorrectionDecisionRecord|null;decisionContext?:boolean }) {
  const a = r.application, checks = inspectCorrectionReview(r), diff = correctionReviewComparison(r), original = diff?.original.totals, proposed = diff?.proposed.totals;
  const outcome=decision??r.item.decision;
  const stamp = (s: string | null) => s ? new Intl.DateTimeFormat("zh-CN", { timeZone: a.basis.events[0].timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "shortOffset" }).format(new Date(s)) : "未记录";
  return <div className="space-y-4"><header><h3 className="text-lg font-bold">{r.item.workerName} · {r.item.workerNo}</h3><p className="mt-1 text-sm">{correctionStatusLabel({...r.item,decision:outcome})} · 当前版本 {r.item.revision}</p><p className="mt-2 break-all text-xs text-slate-500">申请编号：{r.item.requestId}<br/>核对时刻 UTC：{r.asOf}</p></header>
    <DecisionNotice decision={outcome}/>
    <RulesNotice rules={a.rules}/>
    <section className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4"><h4 className="font-bold">核对结果 · 不能作为批准凭证</h4>
      {checks.issues.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{checks.issues.map(issue => <li key={issue}>{CORRECTION_CHECK_LABELS[issue]}</li>)}</ul> : <p className="text-sm">已接入的原始记录、相邻班次及在职日期检查未发现阻断项；仍不代表可以批准。</p>}
      {!decisionContext&&<><h5 className="pt-2 text-sm font-bold">尚未完成的审批条件</h5><ul className="list-disc space-y-1 pl-5 text-sm">{checks.remainingChecks.map(text => <li key={text}>{text}</li>)}</ul></>}
      <p className="text-xs">这里比较原始前后班次；决定事务另行复核已批准修订。定位异常、排班、工资与其他劳动规则不能据此推断通过。</p></section>
    {diff && proposed ? <div className="overflow-x-auto"><table className="w-full min-w-[32rem] text-left text-sm"><caption className="mb-2 text-left font-bold">提交时原始班次与申请值 · {diff.original.timeZone}</caption><thead><tr><th className="p-2">项目</th><th className="p-2">提交时原始记录</th><th className="p-2">员工声明（{outcome?.action==="approve"?"已批准":"非已批准"}）</th></tr></thead>
      <tbody>{[["上班", stamp(diff.original.startAt), stamp(diff.proposed.startAt)], ["下班", stamp(diff.original.endAt), stamp(diff.proposed.endAt)],
        ["工作段", original ? formatAttendanceDurationUs(original.workedUs) : "未结束，不推算", formatAttendanceDurationUs(proposed.workedUs)],
        ["全部休息", original ? formatAttendanceDurationUs(original.breakUs) : "未结束，不推算", formatAttendanceDurationUs(proposed.breakUs)],
        ["带薪休息标记", original ? formatAttendanceDurationUs(original.paidBreakUs) : "未结束，不推算", formatAttendanceDurationUs(proposed.paidBreakUs)]].map(([label, before, after]) => <tr key={label} className="border-t border-slate-200"><th className="p-2 font-medium">{label}</th><td className="p-2">{before}</td><td className="p-2">{after}</td></tr>)}</tbody></table></div>
      : <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-900">该声明超出可计算范围，无法提供工时差异；原始内容仍可在下方核查，不推算或批准。</p>}
    <p className="break-words rounded-xl bg-slate-50 p-3 text-sm">申请理由：{a.reason}{a.withdrawal && <><br/>撤回理由：{a.withdrawal.reason}<br/>撤回 UTC：{a.withdrawal.recordedAt}</>}</p>
    <details className="rounded-xl border border-slate-200 p-3 text-sm"><summary className="cursor-pointer font-semibold">原始记录与声明明细（UTC，保留微秒）</summary>
      <div className="mt-3 space-y-3"><p className="break-all">声明：{a.proposal.startAt} → {a.proposal.endAt}</p><h5 className="font-bold">声明休息（{a.proposal.breaks.length} 段）</h5>{a.proposal.breaks.map((b, n) => <p key={n} className="break-all text-xs">{b.startAt} → {b.endAt} · {b.paid ? "带薪声明" : "非带薪声明"}</p>)}
        {([['提交时', a.basis], ['当前', r.evidence.currentBasis]] as const).map(([title, basis]) => <div key={title}><h5 className="font-bold">{title}原始动作</h5>{basis ? <ol className="mt-2 max-h-60 space-y-1 overflow-auto text-xs">{basis.events.map(e => <li key={e.id} className="break-all">{e.sequence}. {e.action} · {e.occurredAt}</li>)}</ol> : <p>当前原始班次无法完整核对，请核查记录。</p>}</div>)}
        <p className="break-all text-xs">前一班次结束：{r.evidence.previous?.occurredAt ?? "无可核对记录"}<br/>后一班次开始：{r.evidence.next?.occurredAt ?? "无可核对记录"}</p></div></details>
    <details className="rounded-xl border border-slate-200 p-3 text-sm"><summary className="cursor-pointer font-semibold">在职日期核对</summary><p className="mt-2 text-xs text-slate-500">使用申请班次时区的自然日，结束时刻不包含在下一天；这里只核对本声明覆盖日期。</p>
      {r.evidence.employmentPeriods.map(p => <p key={p.startsOn} className="mt-2">{p.startsOn} → {p.endsOn ?? "未设置结束日期"}</p>)}{!r.evidence.employmentPeriods.length && <p className="mt-2">没有覆盖该声明的在职区间。</p>}</details>
  </div>;
}
