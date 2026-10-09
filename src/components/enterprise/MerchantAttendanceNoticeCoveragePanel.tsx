"use client";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { AttendanceNoticeCoverageClient } from "@/lib/merchantAttendanceNoticeCoverageClient";
import { COVERAGE_PAGE_SIZE } from "@/lib/merchantAttendanceNoticeCoverage";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
type Props = { siteId: string; locationId: string; ownerId: string; apiFetch: AttendanceApiFetch };
const button = "rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold disabled:opacity-40";
const exclusionLabels = { worker_inactive: "考勤档案已停用", employee_unavailable: "未绑定可用员工或员工已停用", role_unavailable: "角色不可用或缺少本人考勤查看权限" };

export default function MerchantAttendanceNoticeCoveragePanel(props: Props) {
  return <Screen key={`${props.siteId}:${props.locationId}:${props.ownerId}`} {...props}/>;
}
function Screen({ siteId, locationId, ownerId, apiFetch }: Props) {
  const client = useMemo(() => new AttendanceNoticeCoverageClient({ siteId, locationId, ownerId, apiFetch }), [siteId, locationId, ownerId, apiFetch]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot), result = state.result, busy = state.phase === "loading";
  useEffect(() => {
    const hide = () => client.invalidate(), visibility = () => { if (document.hidden) hide(); };
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hide);
    return () => { hide(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); };
  }, [client]);
  return <section aria-label="定位告知确认情况" className="min-w-0 space-y-4 rounded-2xl border border-teal-200 bg-white p-4">
    <header><h3 className="font-bold">定位告知确认情况 · 负责人只读</h3>
      <p className="mt-2 text-sm text-slate-600">按当前默认地点归属核对考勤档案。这里只记录员工明确确认本版本的情况，不是送达率、已读率、同意定位或打卡资格证明。</p></header>
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => void client.loadFirst()}>重新查询首页</button>
      <button type="button" className={button} disabled={busy || !result?.nextCursor} onClick={() => void client.loadNext()}>下一页</button></div>
    <p role="status" aria-live="polite" className="text-sm leading-6">{state.message}</p>
    {result && <>
      <p className="break-words text-sm">{result.location.name} · {result.notice ? `告知版本 ${result.notice.revision}（${result.notice.action === "publish" ? "已发布" : "已撤回"}）` : "尚未发布告知"}</p>
      <p className="break-all text-xs text-slate-600">本次读取时间（UTC）：{result.observedAt} · 本页 {result.items.length} 条，最多 {COVERAGE_PAGE_SIZE} 条；翻页替换当前页，不累加为历史快照。</p>
      {!result.moduleEnabled && <p className="text-sm text-amber-900">新考勤已暂停；本页仍可只读核对，不启用任何通路。</p>}
      {result.notice?.action === "publish" && !result.noticeCurrent && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">配置已变化或地点已停用：下方仅统计这一历史发布版本，不表示当前可新增确认。</p>}
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
        <div><dt>当前归属档案</dt><dd>{result.counts.assigned}</dd></div><div><dt>符合基本身份条件</dt><dd>{result.counts.eligible}</dd></div>
        <div><dt>不符合基本身份条件</dt><dd>{result.counts.excluded}</dd></div><div><dt>本版已确认</dt><dd>{result.counts.confirmed ?? "—"}</dd></div><div><dt>本版尚无确认</dt><dd>{result.counts.pending ?? "—"}</dd></div>
      </dl>
      <p className="text-xs leading-6 text-slate-600">基本身份条件仅核对当前员工、角色的本人查看权限及启用的考勤档案；不代表已启用定位或满足在职、打卡等其他条件。未发布或已撤回时不计算本版确认人数；旧版本与其他身份的确认不继承。</p>
      {result.items.length ? <ol className="space-y-3">{result.items.map(item => <li key={item.workerId} className="rounded-xl border border-slate-200 p-3 text-sm">
        <p className="break-words font-semibold">{item.displayName} · {item.workerNo}</p>
        <p className="mt-1">{!item.eligible ? `不符合基本身份条件：${item.exclusion ? exclusionLabels[item.exclusion] : "请重新核对"}`
          : item.acknowledgedAt ? `本版已明确确认（UTC）：${item.acknowledgedAt}`
            : result.notice?.action === "publish" ? "本版尚无当前身份的确认记录（不等于未送达）" : "本版确认：—"}</p>
      </li>)}</ol> : <p className="text-sm">本页没有当前归属档案；不能据此推断通知是否送达。</p>}
    </>}
    <p className="text-xs leading-6 text-slate-500">仅点击时读取，不自动刷新、后台轮询、发送通知、代为确认或保存名单。切到后台会清除显示；返回后需手动重新查询。</p>
  </section>;
}
