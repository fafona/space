"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { AttendanceOwnerBacklogClient } from "@/lib/merchantAttendanceOwnerBacklogClient";
import type { OwnerBacklogQuery } from "@/lib/merchantAttendanceOwnerBacklog";
import { ownerBacklogTarget, type OwnerBacklogNavigation, type OwnerBacklogTarget } from "@/lib/merchantAttendanceOwnerBacklogNavigation";
type Props = { siteId: string; ownerId: string; apiFetch: AttendanceApiFetch; onClose: () => void;
  onSelect?: (target: OwnerBacklogTarget) => boolean; navigation?: OwnerBacklogNavigation; disabled?: boolean };
const labels: Record<OwnerBacklogQuery["kind"], string> = { all: "全部类型", correction: "首次补正", revision: "再次修订", missing: "整段漏卡" };
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40";
export default function MerchantAttendanceOwnerBacklogPanel(props: Props) {
  return <Screen key={`${props.siteId}:${props.ownerId}`} {...props}/>;
}
function Screen({ siteId, ownerId, apiFetch, onClose, onSelect, navigation = {}, disabled = false }: Props) {
  const client = useMemo(() => new AttendanceOwnerBacklogClient({ siteId, ownerId, apiFetch }), [siteId, ownerId, apiFetch]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot), result = state.result, busy = state.phase === "loading";
  const [kind, setKind] = useState<OwnerBacklogQuery["kind"]>("all");
  useEffect(() => {
    const hide = () => client.pause(), visibility = () => { if (document.hidden) hide(); };
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hide);
    return () => { hide(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); };
  }, [client]);
  return <section aria-label="负责人待审积压（只读）" className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-bold">负责人待审积压 · 只读</h3>
      <button type="button" className={button} onClick={() => { client.pause(); onClose(); }}>关闭待审积压</button></header>
    <p className="text-sm leading-6 text-slate-600">跨全部提交时间核对首次补正、再次修订及整段漏卡，最旧申请优先。本页仅列查询截点仍待审的摘要；待审不等于当前可批准，不检查审批冲突或代替审批详情。</p>
    <form aria-label="筛选负责人待审积压" className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void client.begin(kind); }}>
      <label className="min-w-0 text-sm">申请类型<select aria-label="申请类型" disabled={busy} className="mt-1 block w-full rounded-xl border border-slate-300 bg-white p-2" value={kind}
        onChange={event => { client.pause(); setKind(event.target.value as OwnerBacklogQuery["kind"]); }}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button type="submit" className={button} disabled={busy}>查询待审积压</button>
    </form>
    <p role="status" aria-live="polite" className="rounded-xl bg-blue-50 p-3 text-sm leading-6">{state.message}</p>
    {result && <>
      {!result.moduleEnabled && <p className="text-sm text-amber-900">新考勤已暂停；仍按当前负责人权限只读核对，不开放审批。</p>}
      <p className="break-all text-xs leading-6">当前查询：{labels[state.query!.kind]} · 第 {state.page} 页<br/>状态截点（UTC）：{result.asOf}<br/>本页核对 {result.scanned} 个候选，匹配 {result.items.length} 项；不是积压总数。</p>
      <ul className="space-y-3">{result.items.map(item => <li key={`${item.kind}:${item.requestId}`} className="min-w-0 space-y-2 rounded-xl border border-slate-200 p-3 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2"><p className="break-words font-semibold">{item.workerName} · {item.workerNo}</p><span>{labels[item.kind]} · 待审</span></div>
        <p className="break-all text-xs leading-6">提交（UTC）：{item.submittedAt}<br/>声明时段（UTC）：{item.proposedStartAt} → {item.proposedEndAt}<br/>申请编号：{item.requestId}</p>
        {onSelect && <button type="button" className={button} disabled={disabled || !ownerBacklogTarget(state, item, navigation)} onClick={() => {
          if (disabled || document.hidden) return;
          const target = ownerBacklogTarget(client.getSnapshot(), item, navigation);
          if (target && onSelect(target)) client.pause();
        }}>打开审批详情</button>}
      </li>)}</ul>
    </>}
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => void client.begin(kind)}>重新查询首页</button>
      <button type="button" className={button} disabled={busy || !result?.nextCursor} onClick={() => void client.next()}>下一页候选</button></div>
    <p className="text-xs leading-6 text-slate-500">每页最多核对 50 个候选，只保留当前页；空中间页仍可继续。翻页保持同一状态截点，但不是冻结快照；并发提交或处理后请重新查询首页。姓名和工号是当前标签，不是历史身份快照。</p>
    <p className="text-xs leading-6 text-slate-500">{onSelect ? "本清单不提交或审批；打开详情后重新读取最新状态。如有待确认操作，先核对原编号，不自动切换到新申请。" : "不提交、批准、驳回或恢复未知操作，不读取或改动其他工作区的草稿和待确认编号；本页不导航审批。"}不会将名单保存到浏览器，不轮询；隐藏或关闭后清屏，返回需手动查询。</p>
  </section>;
}
