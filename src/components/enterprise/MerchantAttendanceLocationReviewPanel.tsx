"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AttendanceLocationReviewCaseClient, AttendanceLocationReviewListClient, attendanceReviewMessage } from "@/lib/merchantAttendanceLocationReviewClient";
import { attendanceHistoryDateQuery } from "@/lib/merchantAttendanceHistoryClient";
import type { AttendanceLocationReviewResult, AttendanceReviewOutcome, AttendanceReviewState } from "@/lib/merchantAttendanceLocationReview";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import type { ExceptionActivity, ExceptionTarget } from "@/lib/merchantAttendanceExceptionWorkspace";
const button = "rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold disabled:opacity-40";
const input = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
const outcomes = { noted: "已核查（仅记录意见）", follow_up: "需补充说明", reopen: "重新打开" };
const states = { pending: "待核查", reviewed: "已核查", follow_up: "需补充说明" };
const reasons: Record<string, string> = { outside: "范围外", uncertain: "精度覆盖边界", stale: "定位已过期", future: "设备时间超前", denied: "定位权限未获准", timeout: "定位超时", unavailable: "定位不可用", unsupported: "设备不支持", not_provided: "未提供位置" };
const actions: Record<string, string> = { clock_in: "上班", clock_out: "下班", break_start: "开始休息", break_end: "结束休息" };
type Detail = Extract<AttendanceLocationReviewResult, { mode: "detail" }>;
function ReviewForm({ detail, submit }: { detail: Detail; submit: (outcome: AttendanceReviewOutcome, note: string, revision: number) => void }) {
  const [outcome, setOutcome] = useState<AttendanceReviewOutcome>("noted"), [note, setNote] = useState(""), [confirmed, setConfirmed] = useState(false);
  return <form data-attendance-draft className="space-y-3 rounded-2xl border border-blue-100 bg-blue-50 p-4" onSubmit={e => { e.preventDefault(); if (confirmed) submit(outcome, note, detail.item.reviewRevision); }}>
    <label className="block text-sm font-semibold">核查结论<select value={outcome} onChange={e => { setOutcome(e.target.value as AttendanceReviewOutcome); setConfirmed(false); }} className={input}>
      {Object.entries(outcomes).filter(([key]) => key !== "reopen" || detail.item.reviewState !== "pending").map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
    <label className="block text-sm font-semibold">理由（必填，最多 500 字）<input required maxLength={500} value={note} onChange={e => { setNote(e.target.value); setConfirmed(false); }} className={input}/></label>
    <p className="text-xs leading-5 text-slate-600">只填写核查所需说明，避免录入无关个人或敏感资料。需要修正打卡时间时应走补正流程，本页面不修改时间。「需补充说明」仅作状态标记，不会自动向员工发送通知。</p>
    <label className="flex items-start gap-2 text-sm leading-6"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-1"/>我确认仅追加核查意见，保留原始打卡和定位摘要；此结论不等于工资审批。</label>
    <button type="submit" disabled={!confirmed || !note.trim()} className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:opacity-40">保存核查意见</button>
  </form>;
}
type Props = { siteId: string; ownerId: string; apiFetch: AttendanceApiFetch; initialEventId?: string | null; draftDirty?: boolean; onWorkspaceActivity?: (a: ExceptionActivity) => void; onNavigate?: (t: ExceptionTarget) => void };
// Isolated candidate only; no production enterprise entry until full acceptance.
export default function MerchantAttendanceLocationReviewPanel(props: Props) { return <ReviewScreen key={`${props.siteId}:${props.ownerId}`} {...props}/>; }
function ReviewScreen({ siteId, ownerId, apiFetch, initialEventId, draftDirty = false, onWorkspaceActivity, onNavigate }: Props) {
  const list = useMemo(() => new AttendanceLocationReviewListClient({ siteId, apiFetch }), [siteId, apiFetch]);
  const cases = useMemo(() => new AttendanceLocationReviewCaseClient({ siteId, ownerId, apiFetch, storage: () => window.sessionStorage }), [siteId, ownerId, apiFetch]);
  const state = useSyncExternalStore(list.subscribe, list.getSnapshot, list.getSnapshot), current = useSyncExternalStore(cases.subscribe, cases.getSnapshot, cases.getSnapshot);
  const [start, setStart] = useState(() => new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10)), [end, setEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [zone, setZone] = useState("UTC"), [displayZone, setDisplayZone] = useState("UTC"), [status, setStatus] = useState<"all" | AttendanceReviewState>("pending"), [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void cases.initialize().then(() => { if (!cancelled && initialEventId && !cases.getSnapshot().eventId && cases.getSnapshot().phase !== "blocked") void cases.select(initialEventId); });
    const hide = () => { list.invalidate(); cases.pause(); };
    const visibility = () => { if (document.visibilityState !== "visible") hide(); else void cases.initialize(); };
    const unload = (event: BeforeUnloadEvent) => { if (cases.getSnapshot().pending) { event.preventDefault(); event.returnValue = ""; } };
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hide); window.addEventListener("beforeunload", unload);
    return () => { cancelled = true; hide(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); window.removeEventListener("beforeunload", unload); };
  }, [list, cases, initialEventId]);
  useEffect(() => { if (state.phase === "blocked") cases.pause(); }, [state.phase, cases]);
  const busy = state.phase === "loading", caseBusy = current.phase === "loading" || current.phase === "saving", detail = current.result;
  const pendingId = current.pending?.command.operationId ?? null, receiptId = detail?.receipt?.operationId ?? null, eventId = detail?.item.id ?? null;
  useEffect(() => { onWorkspaceActivity?.({ busy: busy || caseBusy, pendingId, receiptId, eventId, workerId: null }); }, [onWorkspaceActivity, busy, caseBusy, pendingId, receiptId, eventId]);
  return <section aria-label="定位异常核查" className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
    <header><h2 className="text-xl font-bold">定位异常核查</h2><p className="mt-2 text-sm leading-6 text-slate-600">仅当前企业负责人 · 保留打卡事实，追加核查意见 · 隔离候选页面，尚未上线</p></header>
    <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={e => { e.preventDefault(); if (draftDirty) return; try {
      const q = attendanceHistoryDateQuery(siteId, start, end, zone); setError(""); setDisplayZone(zone);
      void list.load({ siteId, mode: "list", fromAt: q.fromAt, toAt: q.toAt, status, workerId: null, locationId: null, asOf: null, cursorAt: null, cursorId: null });
    } catch (e) { list.invalidate(); setError(attendanceReviewMessage(e)); } }}>
      <label className="text-sm">开始日期<input type="date" required value={start} onChange={e => setStart(e.target.value)} className={input}/></label>
      <label className="text-sm">结束日期（含当天）<input type="date" required value={end} onChange={e => setEnd(e.target.value)} className={input}/></label>
      <label className="text-sm">查询／显示时区<input required value={zone} maxLength={100} onChange={e => setZone(e.target.value)} className={input}/></label>
      <label className="text-sm">核查状态<select value={status} onChange={e => setStatus(e.target.value as typeof status)} className={input}><option value="all">全部异常</option>{Object.entries(states).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
      <button type="submit" disabled={busy || draftDirty} className={button}>查询异常</button>
      <button type="button" disabled={busy || draftDirty || !state.query || !!error} onClick={() => void list.refresh()} className={button}>刷新首批</button>
      <button type="button" disabled={busy || draftDirty || !state.result?.nextCursor || !!error} onClick={() => void list.next()} className={button}>下一批</button>
    </form>
    <p className="text-xs leading-6 text-slate-500">最多 30 个自然日，每批检查 50 条打卡后筛选异常，不计算全量总数。核查状态不是固定导出快照；处理后请刷新首批，已翻过的记录可能有新结论。</p>
    <div role="status" aria-live="polite" className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm">{error || state.message}</div>
    <div className="grid items-start gap-5 xl:grid-cols-2">
      <div className="space-y-3">{state.result?.items.map(item => <article key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{item.workerName} · {item.workerNo}</h3><span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-950">{states[item.reviewState]}</span></div>
        <p className="mt-2 text-sm">{actions[item.action]} · {item.locationName} · {reasons[item.reason]}</p>
        <p className="mt-2 text-xs text-slate-600">{new Intl.DateTimeFormat("zh-CN", { timeZone: displayZone, dateStyle: "medium", timeStyle: "medium", hourCycle: "h23" }).format(new Date(item.occurredAt))} · {displayZone}</p>
        <button type="button" disabled={caseBusy || !!current.pending} onClick={() => onNavigate ? onNavigate({ step: "review", eventId: item.id, workerId: null }) : void cases.select(item.id)} className={`${button} mt-3`}>查看／核查 · v{item.reviewRevision}</button>
      </article>)}</div>
      <aside aria-label="异常详情与核查" className="space-y-4 rounded-2xl border border-slate-200 p-4">
        <div role="status" className="text-sm leading-6">{current.message}{current.pending && <p className="mt-2 break-all text-xs">待确认操作：{current.pending.command.operationId}</p>}</div>
        <div className="flex flex-wrap gap-2"><button type="button" disabled={caseBusy || draftDirty && !current.pending} onClick={() => void cases.initialize()} className={button}>重读详情／核对收据</button>
          {current.pending && <button type="button" disabled={caseBusy} onClick={() => void cases.retry()} className={button}>原编号重试</button>}</div>
        {detail && <><div className="rounded-xl bg-slate-50 p-3 text-sm leading-6"><h3 className="font-bold">{detail.item.workerName} · {actions[detail.item.action]} · {states[detail.item.reviewState]}</h3>
          <p>{detail.item.locationName} · {reasons[detail.item.reason]}</p><p className="break-all text-xs">原始打卡 UTC：{detail.item.occurredAt}</p>
          <p className="break-all text-xs">记录编号：{detail.item.id}</p>
          {onNavigate && <button type="button" className={`${button} my-2`} disabled={caseBusy || !!current.pending} onClick={() => onNavigate({ step: "discussion", eventId: detail.item.id, workerId: null })}>查看员工说明／公开回复</button>}
          <p>定位精度：{detail.summary.accuracyMeters === null ? "未提供" : `${detail.summary.accuracyMeters} 米`} · 距围栏中心：{detail.summary.distanceMeters === null ? "未提供" : `${detail.summary.distanceMeters} 米（取整）`}</p>
          <p className="break-all text-xs">取样 UTC：{detail.summary.capturedAt ?? "未提供位置"} · 取样时配置版本（设置／人员／地点）：{detail.summary.settingsVersion}/{detail.summary.workerVersion}/{detail.summary.locationVersion}</p>
          {!detail.moduleEnabled && <p className="mt-2 text-amber-900">新考勤已暂停，仍可核查已有异常；不会新增打卡。</p>}</div>
          {current.phase === "ready" && !current.pending && <ReviewForm key={`${detail.item.id}:${detail.item.reviewRevision}`} detail={detail} submit={(outcome, note, revision) => void cases.submit(outcome, note, revision)}/>}
          <details className="rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-semibold">核查记录 · 最近 {detail.history.length} 条</summary>
            <ol className="mt-3 space-y-3">{detail.history.map(h => <li key={h.revision} className="rounded-lg bg-slate-50 p-3 text-sm leading-6"><p className="font-semibold">v{h.revision} · {outcomes[h.outcome]}</p><p className="break-words">{h.note}</p><p className="break-all text-xs text-slate-500">{h.recordedAt} · {h.byCurrentOwner ? "当前负责人" : "历史负责人"} · {h.actorRef}</p></li>)}</ol>
            {detail.historyTruncated && <p className="mt-3 text-xs text-amber-900">这里只显示最近 20 条。更早记录仍保留，本页未提供完整历史导出。</p>}</details></>}
      </aside>
    </div>
    <p className="text-xs leading-6 text-slate-500">姓名与地点名称为当前标签，不冒充历史姓名。人员／地点停用不会删除异常；负责人身份仍会逐次验证。待确认核查理由暂存于本标签页，确认后移除，不缓存整页员工资料。</p>
  </section>;
}
