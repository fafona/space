"use client";
import { lazy, Suspense, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AttendanceNoticeClient } from "@/lib/merchantAttendanceLocationNoticeClient";
import { locationNoticeTemplate1, type NoticeQuery, type NoticeResult, type NoticeCommand, type PublicNoticeValues } from "@/lib/merchantAttendanceLocationNotice";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { useAttendanceLocationWorkspaceActivity, type AttendanceWorkspaceReporter } from "./useAttendanceLocationWorkspaceActivity";
const Coverage = lazy(() => import("./MerchantAttendanceNoticeCoveragePanel"));
const button = "rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold disabled:opacity-40";
function TextPreview({ values }: { values: PublicNoticeValues }) { return <ol className="space-y-2 text-sm leading-6">{locationNoticeTemplate1(values).map((line, i) => <li key={i}>{line}</li>)}</ol>; }
function ActionForm({ result, submit }: { result: NoticeResult; submit: (action: NoticeCommand["action"], reason: string) => void }) {
  const [reason, setReason] = useState(""), [confirmed, setConfirmed] = useState(false), [action, setAction] = useState<NoticeCommand["action"]>(result.access === "self" ? "acknowledge" : result.canPublish ? "publish" : "withdraw");
  const allowed = action === "publish" ? result.canPublish : action === "withdraw" ? result.canWithdraw : result.canAcknowledge;
  return <form className="space-y-3 rounded-2xl border border-blue-100 bg-blue-50 p-4" onSubmit={e => { e.preventDefault(); if (confirmed && allowed) submit(action, reason); }}>
    {result.access === "owner" && <><label className="block text-sm font-semibold">操作<select value={action} onChange={e => { setAction(e.target.value as typeof action); setConfirmed(false); }} className="ml-3 rounded-lg border p-2"><option value="publish" disabled={!result.canPublish}>发布当前草稿</option><option value="withdraw" disabled={!result.canWithdraw}>撤回当前告知</option></select></label>
      <label className="block text-sm font-semibold">操作说明（员工可见，最多 240 字）<input required maxLength={240} value={reason} onChange={e => { setReason(e.target.value); setConfirmed(false); }} className="mt-2 w-full rounded-xl border border-slate-300 bg-white p-3"/></label></>}
    <label className="flex items-start gap-2 text-sm leading-6"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-1"/>{result.access === "self"
      ? `我确认收到上方第 ${result.current?.revision} 版告知。本操作不是同意定位，也不会请求位置。`
      : action === "publish" ? `我确认向员工公开下方草稿 v${result.draft?.revision} 及操作说明。此次只发布告知，不启用围栏、定位或自动清理。` : "我确认撤回当前告知，保留历史与员工已提交的版本确认；接入版本校验的候选定位打卡将停止接受本版本的新提交，已有班次可明确选择无定位收尾。"}</label>
    <button disabled={!allowed || !confirmed || result.access === "owner" && !reason.trim()} className={button}>{action === "acknowledge" ? "确认收到本版本告知" : action === "publish" ? "发布告知版本" : "撤回告知版本"}</button>
  </form>;
}
type Props = { query: NoticeQuery; actorId: string; apiFetch: AttendanceApiFetch; onWorkspaceActivity?: AttendanceWorkspaceReporter };
// Candidate: both workspaces are default-off. No implicit acknowledgement or activation.
export default function MerchantAttendanceLocationNoticePanel(props: Props) { return <Screen key={`${props.query.siteId}:${props.query.access}:${props.actorId}:${props.query.locationId}:${props.query.expectedWorkerId}`} {...props}/>; }
function Screen({ query, actorId, apiFetch, onWorkspaceActivity }: Props) {
  const { siteId, access, locationId, expectedWorkerId } = query;
  const client = useMemo(() => new AttendanceNoticeClient({ query: { siteId, access, locationId, expectedWorkerId, operationId: null }, actorId, apiFetch, storage: () => window.sessionStorage }), [siteId, access, locationId, expectedWorkerId, actorId, apiFetch]);
  const s = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot), r = s.result, busy = s.phase === "loading" || s.phase === "saving";
  useAttendanceLocationWorkspaceActivity(onWorkspaceActivity, s.phase, s.pending?.command.operationId ?? null, r?.receipt?.operationId ?? null);
  useEffect(() => {
    void client.initialize(); const hide = () => client.pause(), visibility = () => { if (document.visibilityState === "visible") void client.initialize(); else hide(); };
    const unload = (e: BeforeUnloadEvent) => { if (client.getSnapshot().pending) { e.preventDefault(); e.returnValue = ""; } };
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hide); window.addEventListener("beforeunload", unload);
    return () => { hide(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); window.removeEventListener("beforeunload", unload); };
  }, [client]);
  return <section aria-label="定位政策告知" className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
    <header><h2 className="text-xl font-bold">{access === "owner" ? "定位政策发布与撤回" : "我的定位政策告知"}</h2><p className="mt-2 text-sm text-slate-600">本地候选 · 尚未上线 · 无自动确认／邮件送达／定位采集</p></header>
    <div role="status" aria-live="polite" className="rounded-xl bg-blue-50 p-3 text-sm">{s.message}</div>
    <div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => void client.initialize()} className={button}>重新读取／核对收据</button>{s.pending && <button disabled={busy} onClick={() => void client.retry()} className={button}>原编号重试</button>}</div>
    {r && <><div className="rounded-2xl border border-slate-200 p-4"><h3 className="font-semibold">{r.location.name} · {r.current ? `告知版本 ${r.current.revision}` : "尚未发布告知"}</h3>
      {!r.moduleEnabled && <p className="mt-2 text-sm text-amber-900">新考勤发布已暂停；仍可查看、核对原收据或撤回告知。</p>}
      {r.current && <><p className="my-3 text-sm">{r.current.action === "withdraw" ? "已撤回" : r.noticeCurrent ? "当前已发布版本" : "配置已变化或地点已停用：只能查看历史，不可新增确认"} · {r.current.recordedAt}</p>
        <p className="mb-3 break-words text-sm">操作说明：{r.current.reason}</p>{r.current.values && <TextPreview values={r.current.values}/>}</>}
      {r.acknowledgedAt && <p className="mt-3 text-sm font-semibold text-emerald-800">本人已确认收到此版本：{r.acknowledgedAt}（不代表已启用定位）</p>}</div>
      {access === "owner" && r.draft && <details open className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><summary className="font-semibold">待发布草稿 v{r.draft.revision} · 与已发布版本分开</summary>
        <div className="mt-3"><TextPreview values={r.draft.values}/><p className="mt-2 text-xs">草稿围栏中心（仅负责人）：{r.draft.values.latitude}，{r.draft.values.longitude}</p></div></details>}
      {s.phase === "ready" && !s.pending && r.location.id === locationId && (r.canPublish || r.canWithdraw || r.canAcknowledge) && <ActionForm key={`${r.current?.revision ?? 0}:${r.draft?.revision ?? 0}:${r.settingsVersion}:${r.location.version}:${r.acknowledgedAt ?? ""}`} result={r} submit={(action, reason) => void client.submit(action, reason)}/>}
      {r.receipt && <p className="break-all text-xs text-slate-500">原操作回执：{r.receipt.action} · 对应版本 {r.receipt.revision} · {r.receipt.recordedAt}。上方展示的是当前版本。</p>}</>}
    {process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_NOTICE_COVERAGE_ENABLED === "1" && access === "owner" && r && <Suspense fallback={<p role="status">正在加载只读确认情况面板…</p>}>
      <Coverage key={`${r.current?.revision ?? 0}:${r.settingsVersion}:${r.location.version}`} siteId={siteId} locationId={locationId} ownerId={actorId} apiFetch={apiFetch}/>
    </Suspense>}
    <p className="text-xs leading-6 text-slate-500">政策更新需要新的版本确认，旧回执不冒充新版本确认。本页不会判断法律依据或强制员工同意，不会证明员工实际阅读理解全文。本地候选定位打卡已增加最终版本校验；通知送达统计、自动保留期限执行和实机验收仍未完成，确认后不能据此开启线上定位。</p>
  </section>;
}
