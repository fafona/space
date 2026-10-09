"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AttendanceDiscussionClient } from "@/lib/merchantAttendanceLocationDiscussionClient";
import type { DiscussionAccess, DiscussionItem } from "@/lib/merchantAttendanceLocationDiscussion";
import { attendanceHistoryDateQuery } from "@/lib/merchantAttendanceHistoryClient";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import type { ExceptionActivity, ExceptionTarget } from "@/lib/merchantAttendanceExceptionWorkspace";
const button = "rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold disabled:opacity-40";
const input = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
const reasons: Record<string, string> = { outside: "范围外", uncertain: "精度覆盖边界", stale: "定位已过期", future: "设备时间超前", denied: "定位权限未获准", timeout: "定位超时", unavailable: "定位不可用", unsupported: "设备不支持", not_provided: "未提供位置" };
const states = { pending: "待核查", reviewed: "已核查", follow_up: "需补充说明" };
const discussionState = (item: DiscussionItem) => item.lastAuthor === "self" ? "员工已补充 · 待负责人回复" : item.lastAuthor === "owner" ? "负责人已有回复" : "暂无公开说明";
type Props = { siteId: string; access: DiscussionAccess; actorId: string; apiFetch: AttendanceApiFetch; initialEventId?: string | null; initialWorkerId?: string | null;
  draftDirty?: boolean; onWorkspaceActivity?: (a: ExceptionActivity) => void; onNavigate?: (t: ExceptionTarget) => void };
// Local candidate only. Neither this panel nor the discussion route activates GPS.
export default function MerchantAttendanceLocationDiscussionPanel(props: Props) { return <Screen key={`${props.siteId}:${props.access}:${props.actorId}`} {...props}/>; }
function MessageForm({ access, submit }: { access: DiscussionAccess; submit: (note: string) => void }) {
  const [note, setNote] = useState(""), [confirmed, setConfirmed] = useState(false);
  return <form data-attendance-draft className="space-y-3 rounded-2xl border border-blue-100 bg-blue-50 p-4" onSubmit={e => { e.preventDefault(); if (confirmed) submit(note); }}>
    <label className="block text-sm font-semibold">{access === "self" ? "补充说明" : "发给员工的回复"}（最多 500 字）<input required maxLength={500} value={note} onChange={e => { setNote(e.target.value); setConfirmed(false); }} className={input}/></label>
    <p className="text-xs leading-6">只填写核查所需事实，不上传无关敏感资料。提交后保留原文，可另写补充；本功能不修改打卡、不批准工资、不自动发送邮件或通知。</p>
    <label className="flex items-start gap-2 text-sm leading-6"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-1"/>{access === "self" ? "我确认将说明提交给企业负责人。" : "我确认这段回复可以向该员工公开，不是内部备注。"}</label>
    <button disabled={!confirmed || !note.trim()} className={button}>提交{access === "self" ? "说明" : "公开回复"}</button>
  </form>;
}
function Screen({ siteId, access, actorId, apiFetch, initialEventId, initialWorkerId, draftDirty = false, onWorkspaceActivity, onNavigate }: Props) {
  const client = useMemo(() => new AttendanceDiscussionClient({ siteId, access, actorId, apiFetch, storage: () => window.sessionStorage }), [siteId, access, actorId, apiFetch]);
  const s = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [start, setStart] = useState(() => new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10)), [end, setEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [zone, setZone] = useState("UTC"), [error, setError] = useState("");
  useEffect(() => {
    void client.initialize(initialEventId ? { eventId: initialEventId, expectedWorkerId: initialWorkerId ?? null } : undefined); const hide = () => client.pause();
    const visibility = () => { if (document.visibilityState !== "visible") hide(); else void client.initialize(); };
    const unload = (e: BeforeUnloadEvent) => { if (client.getSnapshot().pending) { e.preventDefault(); e.returnValue = ""; } };
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hide); window.addEventListener("beforeunload", unload);
    return () => { hide(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); window.removeEventListener("beforeunload", unload); };
  }, [client, initialEventId, initialWorkerId]);
  const busy = s.phase === "loading" || s.phase === "saving";
  const pendingId = s.pending?.command.operationId ?? null, receiptId = s.detail?.receipt?.operationId ?? null, eventId = s.detail?.item.eventId ?? null, workerId = s.detail?.workerId ?? null;
  const viewReady = s.phase === "ready";
  useEffect(() => { onWorkspaceActivity?.({ busy, pendingId, receiptId, eventId, workerId, viewReady }); }, [onWorkspaceActivity, busy, pendingId, receiptId, eventId, workerId, viewReady]);
  return <section aria-label="定位异常说明与回复" className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
    <header><h2 className="text-xl font-bold">{access === "self" ? "我的定位异常与说明" : "员工定位异常说明与回复"}</h2><p className="mt-2 text-sm text-slate-600">本地候选 · 未上线 · 不会请求定位或改写原始打卡</p></header>
    <form className="grid gap-3 sm:grid-cols-3" onSubmit={e => { e.preventDefault(); if (draftDirty) return; try {
      const q = attendanceHistoryDateQuery(siteId, start, end, zone); setError(""); void client.load({ ...q, mode: "list", access });
    } catch { client.pause(); setError("请检查日期与时区，最多查询 30 个自然日。"); } }}>
      <label className="text-sm">开始日期<input type="date" required value={start} onChange={e => setStart(e.target.value)} className={input}/></label>
      <label className="text-sm">结束日期<input type="date" required value={end} onChange={e => setEnd(e.target.value)} className={input}/></label>
      <label className="text-sm">查询时区<input required value={zone} onChange={e => setZone(e.target.value)} className={input}/></label>
      <button disabled={busy || draftDirty || !!s.pending} className={button}>查询／刷新首批</button><button type="button" disabled={busy || draftDirty || !s.list?.nextCursor} onClick={() => void client.next()} className={button}>下一批</button>
    </form>
    <p className="text-xs leading-6 text-slate-500">每批检查最多 50 条打卡，空批也可能有下一批。包括已核查异常；沟通状态与核查状态分开。新说明不自动改核查结论，无实时轮询，请手动刷新。员工仅查看当前本人档案中由本人账号对应员工发起的异常。</p>
    <div role="status" aria-live="polite" className="rounded-xl bg-blue-50 p-3 text-sm">{error || s.message}</div>
    <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || draftDirty && !s.pending} onClick={() => { setError(""); void client.initialize(); }} className={button}>重读详情／核对收据</button>
      {s.pending && <button type="button" disabled={busy} onClick={() => void client.retry()} className={button}>使用原编号重试</button>}</div>
    {s.list && <div className="grid gap-3 md:grid-cols-2">{s.list.items.map(item => <article key={item.eventId} className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <h3 className="font-semibold">{item.workerName} · {reasons[item.reason]}</h3><p className="text-sm">核查：{states[item.reviewState]}</p><p className="text-sm font-semibold text-blue-800">{discussionState(item)}</p>
      <p className="break-all text-xs">原始 UTC：{item.occurredAt}</p><button type="button" disabled={busy || !!s.pending} onClick={() => onNavigate ? onNavigate({ step: "discussion", eventId: item.eventId, workerId: s.list!.workerId }) : void client.select(item.eventId)} className={button}>查看说明与回复</button>
    </article>)}</div>}
    {s.detail && <div className="space-y-4 rounded-2xl border border-slate-200 p-4">
      <h3 className="font-bold">{s.detail.item.workerName} · {reasons[s.detail.item.reason]} · {states[s.detail.item.reviewState]}</h3><p className="text-sm text-blue-800">{discussionState(s.detail.item)}</p>
      <p className="break-all text-xs">原始 UTC：{s.detail.item.occurredAt} · 记录：{s.detail.item.eventId}</p>
      {!s.detail.moduleEnabled && <p className="text-sm text-amber-900">新考勤已暂停；此处仅处理已有异常。</p>}
      <ol className="space-y-3">{s.detail.history.map(h => <li key={h.revision} className={`rounded-xl p-4 ${h.author === "owner" ? "bg-blue-50" : "bg-slate-50"}`}>
        <p className="text-sm font-semibold">{h.author === "owner" ? "负责人公开回复" : "员工说明"} · 第 {h.revision} 条</p><p className="mt-2 break-words text-sm">{h.note}</p><p className="mt-2 text-xs text-slate-500">UTC：{h.recordedAt}</p>
      </li>)}</ol>
      {s.detail.historyTruncated && <p className="text-xs text-amber-900">仅展示最近 20 条，更早记录保留；本页暂不提供完整历史导出。</p>}
      {s.phase === "ready" && !s.pending && (s.detail.canPost ? <MessageForm key={`${s.detail.item.eventId}:${s.detail.item.revision}`} access={access} submit={note => void client.submit(note)}/> : <p className="text-sm">当前只有本人查看权限，不能提交说明。</p>)}
    </div>}
    <p className="text-xs leading-6 text-slate-500">不显示负责人的内部核查备注，也不把核查状态当作工资审批。姓名是当前标签。未确认说明暂存于本标签页，确认后移除；退出或清理浏览器存储可能丢失本地恢复编号。</p>
  </section>;
}
