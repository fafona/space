"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AttendanceSelfRevisionHistoryClient } from "@/lib/merchantAttendanceSelfRevisionHistoryClient";
import type { RevisionHistoryStatus } from "@/lib/merchantAttendanceRevisionHistory";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
type Props = { siteId: string; employeeId: string; apiFetch: AttendanceApiFetch; onClose: () => void };
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40";
const labels: Record<RevisionHistoryStatus, string> = { all: "全部状态", submitted: "待负责人审批", approved: "已批准", rejected: "已驳回", withdrawn: "已撤回" };
export default function MerchantAttendanceSelfRevisionHistoryPanel(props: Props) {
  return <Screen key={`${props.siteId}:${props.employeeId}`} {...props}/>;
}
function Screen({ siteId, employeeId, apiFetch, onClose }: Props) {
  const client = useMemo(() => new AttendanceSelfRevisionHistoryClient({ siteId, employeeId, apiFetch }), [siteId, employeeId, apiFetch]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot), result = state.result, busy = state.phase === "loading";
  const [status, setStatus] = useState<RevisionHistoryStatus>("all");
  useEffect(() => {
    const hide = () => client.pause(), visibility = () => { if (document.hidden) hide(); };
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hide);
    return () => { hide(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); };
  }, [client]);
  return <section aria-label="本人跨班次修订记录" className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-bold">本人跨班次修订记录 · 只读</h3>
      <button type="button" className={button} onClick={() => { client.pause(); onClose(); }}>关闭修订记录</button></header>
    <p className="text-sm leading-6 text-slate-600">仅当前本人档案、本人身份提交的再次修订摘要，涵盖多个已批准的原班次。每次查询首页先只读核对身份，不依赖当前能否打卡。不包括首次补正、整段漏卡及浏览器待确认操作，不是全部考勤申请或工资记录。</p>
    <form aria-label="筛选本人跨班次修订" className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void client.begin(status); }}>
      <label className="min-w-0 text-sm">申请状态<select aria-label="申请状态" disabled={busy} className="mt-1 block w-full rounded-xl border border-slate-300 bg-white p-2" value={status}
        onChange={event => { client.pause(); setStatus(event.target.value as RevisionHistoryStatus); }}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button type="submit" className={button} disabled={busy}>查询本人修订记录</button>
    </form>
    <p role="status" aria-live="polite" className="rounded-xl bg-blue-50 p-3 text-sm leading-6">{state.message}</p>
    {result && <>
      {!result.moduleEnabled && <p className="text-sm text-amber-900">新考勤已暂停；仍按当前权限只读核对，不开启提交或审批。</p>}
      <p className="break-all text-xs leading-6">当前查询：{labels[state.query!.status]} · 第 {state.page} 页<br/>状态截点（UTC）：{result.asOf}<br/>本页核对 {result.scanned} 个候选，匹配 {result.items.length} 项；不是待审总数。</p>
      <ul className="space-y-3">{result.items.map(item => <li key={item.requestId} className="min-w-0 space-y-2 rounded-xl border border-slate-200 p-3 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2"><p className="break-words font-semibold">{item.workerName} · {item.workerNo}</p><span>{labels[item.status]}</span></div>
        <p className="break-all text-xs leading-6">提交版本 {item.submittedRevision} · 提交（UTC）：{item.submittedAt}<br/>声明时段（UTC）：{item.proposedStartAt} → {item.proposedEndAt}<br/>
          原批准申请编号：{item.rootRequestId}<br/>本次修订申请编号：{item.requestId}{item.closedAt && <><br/>处理／撤回（UTC）：{item.closedAt}</>}</p>
      </li>)}</ul>
    </>}
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => void client.begin(status)}>重新查询首页</button>
      <button type="button" className={button} disabled={busy || !result?.nextCursor} onClick={() => void client.next()}>下一页候选</button></div>
    <p className="text-xs leading-6 text-slate-500">每页最多核对 50 个候选，只保留当前页；空中间页仍可继续。翻页保持同一状态截点，新的申请、审批或撤回须重新查询首页。姓名和工号是当前标签，不是历史身份快照。</p>
    <p className="text-xs leading-6 text-slate-500">本页不提交、撤回、审批或恢复未知操作，不展示当前核定工时，也不代表冻结报表。无需定位；不保存名单、不轮询，隐藏或关闭页面会清除显示，返回后需手动查询。</p>
  </section>;
}
