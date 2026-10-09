"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AttendanceSelfRequestsClient } from "@/lib/merchantAttendanceSelfRequestsClient";
import type { SelfRequestKind, SelfRequestStatus } from "@/lib/merchantAttendanceSelfRequests";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";

type Props = { siteId: string; employeeId: string; apiFetch: AttendanceApiFetch; onClose: () => void };
type KindFilter = "all" | SelfRequestKind;
type StatusFilter = "all" | SelfRequestStatus;
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40";
const kindLabels: Record<KindFilter, string> = {
  all: "全部类型",
  correction: "首次补正",
  revision: "再次修订",
  missing: "整段漏卡",
};
const statusLabels: Record<StatusFilter, string> = {
  all: "全部状态",
  submitted: "待审批",
  approved: "已批准",
  rejected: "已驳回",
  withdrawn: "已撤回",
};

export default function MerchantAttendanceSelfRequestsPanel(props: Props) {
  return <Screen key={`${props.siteId}:${props.employeeId}`} {...props}/>;
}

function Screen({ siteId, employeeId, apiFetch, onClose }: Props) {
  const client = useMemo(() => new AttendanceSelfRequestsClient({ siteId, employeeId, apiFetch }), [siteId, employeeId, apiFetch]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const result = state.result;
  const busy = state.phase === "loading";
  const [kind, setKind] = useState<KindFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");

  useEffect(() => {
    const hide = () => client.pause();
    const visibility = () => { if (document.hidden) hide(); };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", hide);
    return () => {
      hide();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", hide);
    };
  }, [client]);

  return <section aria-label="我的申请记录（只读）" className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-lg font-bold">我的申请记录（只读）</h3>
      <button type="button" className={button} onClick={() => { client.pause(); onClose(); }}>关闭申请记录</button>
    </header>
    <p className="text-sm leading-6 text-slate-600">
      汇总全部日期的首次补正、再次修订和整段漏卡三类申请及四种申请状态。只读取当前本人、当前考勤档案，不是审批入口、待办总数或工资记录。
    </p>
    <form aria-label="筛选我的申请记录" className="flex flex-wrap items-end gap-3" onSubmit={event => {
      event.preventDefault();
      void client.begin(kind, status);
    }}>
      <label className="min-w-0 text-sm">申请类型
        <select aria-label="申请类型" disabled={busy} className="mt-1 block w-full rounded-xl border border-slate-300 bg-white p-2" value={kind}
          onChange={event => { client.pause(); setKind(event.target.value as KindFilter); }}>
          {Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="min-w-0 text-sm">申请状态
        <select aria-label="申请状态" disabled={busy} className="mt-1 block w-full rounded-xl border border-slate-300 bg-white p-2" value={status}
          onChange={event => { client.pause(); setStatus(event.target.value as StatusFilter); }}>
          {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <button type="submit" className={button} disabled={busy}>查询我的申请</button>
    </form>
    <p role="status" aria-live="polite" className="rounded-xl bg-blue-50 p-3 text-sm leading-6">{state.message}</p>
    {result && state.query && <>
      {!result.moduleEnabled && <p className="text-sm text-amber-900">新考勤已暂停；仍可只读核对本人申请，不开放提交或审批。</p>}
      <p className="break-all text-xs leading-6">
        当前筛选：{kindLabels[state.query.kind]} · {statusLabels[state.query.status]} · 第 {state.page} 页<br/>
        时间截点（UTC）：{result.asOf}<br/>
        本页核对 {result.scanned} 个候选，匹配 {result.items.length} 项；不是全部记录或待办总数。
      </p>
      <ul className="space-y-3">{result.items.map(item => <li key={`${item.kind}:${item.requestId}`} className="min-w-0 space-y-2 rounded-xl border border-slate-200 p-3 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="break-words font-semibold">{item.workerName} · {item.workerNo}</p>
          <span>{kindLabels[item.kind]} · {statusLabels[item.status]}</span>
        </div>
        <p className="break-all text-xs leading-6">
          提交（UTC）：{item.submittedAt}<br/>
          申请时段（UTC）：{item.proposedStartAt} → {item.proposedEndAt}<br/>
          根申请编号：{item.rootRequestId}<br/>
          本次申请编号：{item.requestId}
          {item.closedAt && <><br/>处理／撤回（UTC）：{item.closedAt}</>}
        </p>
      </li>)}</ul>
    </>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={busy} onClick={() => void client.begin(kind, status)}>重新查询首页</button>
      <button type="button" className={button} disabled={busy || !result?.nextCursor} onClick={() => void client.next()}>下一页候选</button>
    </div>
    <p className="text-xs leading-6 text-slate-500">
      每页最多核对 50 个候选，只保留当前页；空中间页仍可继续。翻页固定同一 asOf 时间截点，但这不是数据库事务快照；并发提交、撤回或审批后，请重新查询首页。姓名和工号是当前标签，不是历史身份快照。
    </p>
    <p className="text-xs leading-6 text-slate-500">
      “已批准”只是申请的历史状态，不保证目前仍是生效的考勤结果。本页不提交、撤回、批准、驳回或恢复未知操作，不重建当前考勤或工资，也不跳转审批；不保存名单、不轮询，隐藏、离开或关闭页面会清除显示，返回后需手动查询。
    </p>
  </section>;
}
