"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AttendanceRecordsClient, attendanceManagementMessage, attendanceRecordsDateQuery } from "@/lib/merchantAttendanceManagementClient";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import ScopedTimesheetLauncher from "./MerchantAttendanceScopedTimesheetLauncher";

const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-40";
const input = "mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
const actions = { clock_in: "上班", break_start: "开始休息", break_end: "结束休息", clock_out: "下班" };
type RecordsPanelProps = {
  siteId: string; actorId: string; access: "owner" | "manager"; apiFetch: AttendanceApiFetch;
};
export default function MerchantAttendanceRecordsPanel(props: RecordsPanelProps) {
  return <RecordsScreen key={`${props.siteId}:${props.access}:${props.actorId}`} {...props} />;
}
function RecordsScreen({ siteId, actorId, access, apiFetch }: RecordsPanelProps) {
  const client = useMemo(() => new AttendanceRecordsClient({ siteId, access, apiFetch }), [siteId, access, apiFetch]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [start, setStart] = useState(() => new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10));
  const [end, setEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [zone, setZone] = useState("UTC");
  const [displayZone, setDisplayZone] = useState("UTC");
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<{ worker: { id: string; name: string } | null; location: { id: string; name: string } | null }>({ worker: null, location: null });
  useEffect(() => {
    const visible = () => { if (document.visibilityState === "hidden") client.invalidate(); else void client.refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { document.removeEventListener("visibilitychange", visible); client.invalidate(); };
  }, [client]);
  const query = () => {
    try {
      const q = attendanceRecordsDateQuery(siteId, access, start, end, zone);
      setDisplayZone(zone); setError("");
      void client.load({ ...q, workerId: filters.worker?.id ?? null, locationId: filters.location?.id ?? null });
    } catch (e) { client.invalidate(true); setError(attendanceManagementMessage(e)); }
  };
  const filter = (next: typeof filters) => {
    setFilters(next); setError("");
    if (state.query) void client.load({ ...state.query, workerId: next.worker?.id ?? null, locationId: next.location?.id ?? null, asOf: null, cursorAt: null, cursorId: null });
  };
  const busy = state.phase === "loading";
  return <section className="mt-5 min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6" aria-label="考勤明细">
    <header><h2 className="text-xl font-bold">考勤明细</h2><p className="mt-1 text-sm leading-6 text-slate-500">
      {access === "owner" ? "负责人可查看本企业的原始打卡记录。" : "仅显示当前角色及主管授权范围内的记录。"}不推算缺卡、工资或应出勤时数。</p></header>
    {access === "manager" && <ScopedTimesheetLauncher siteId={siteId} actorId={actorId} access="manager" apiFetch={apiFetch}/>}
    <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={e => { e.preventDefault(); query(); }}>
      <label className="min-w-0 text-sm">开始日期<input className={input} type="date" value={start} onChange={e => setStart(e.target.value)} required /></label>
      <label className="min-w-0 text-sm">结束日期（含当天）<input className={input} type="date" value={end} onChange={e => setEnd(e.target.value)} required /></label>
      <label className="min-w-0 text-sm">查询／显示时区<input className={input} list="attendance-record-zones" value={zone} onChange={e => setZone(e.target.value)} required />
        <datalist id="attendance-record-zones">{["UTC", "Europe/Madrid", "Atlantic/Canary", "Asia/Shanghai", "America/New_York"].map(z => <option value={z} key={z} />)}</datalist></label>
      <div className="flex items-end"><button className={`${button} w-full`} disabled={busy} type="submit">查询明细</button></div>
    </form>
    <p className="text-xs leading-5 text-slate-500">一次最多 30 个自然日，每页最多 50 条。UTC 为默认查询时区，不代表企业所在地时区。每次翻页、返回此标签页都会重新核验权限。</p>
    {(filters.worker || filters.location) && <div className="flex flex-wrap gap-2" aria-label="当前筛选">
      {filters.worker && <button className={button} onClick={() => filter({ ...filters, worker: null })}>人员：{filters.worker.name} ×</button>}
      {filters.location && <button className={button} onClick={() => filter({ ...filters, location: null })}>地点：{filters.location.name} ×</button>}
    </div>}
    <div role="status" className={`rounded-xl border p-3 text-sm ${error || state.phase === "blocked" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-blue-100 bg-blue-50 text-blue-900"}`}>
      {error || state.message}
      {state.result && !state.result.moduleEnabled && <p className="mt-1">平台已暂停新考勤，历史记录仍按当前权限提供。</p>}
    </div>
    {state.result && <>
      <p className="text-xs leading-5 text-slate-500">本次显示时区：{displayZone}。姓名、工号和地点名称为当前标签；事件时间、动作保持原始记录。
        {state.result.scopeRevision !== null && ` 主管范围版本：${state.result.scopeRevision}。`}</p>
      <div className="space-y-3">{state.result.items.map(r => <article key={r.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h3 className="break-words font-semibold">{r.workerName} <span className="text-sm font-normal text-slate-500">{r.workerNo}</span></h3>
          <p className="mt-1 break-words text-sm">{r.locationName}</p></div><span className="rounded-lg bg-white px-3 py-1 text-sm font-semibold text-blue-800">{actions[r.action]}</span></div>
        <p className="mt-2 text-sm">{new Intl.DateTimeFormat("zh-CN", { timeZone: displayZone, dateStyle: "medium", timeStyle: "medium", hourCycle: "h23" }).format(new Date(r.occurredAt))}</p>
        <p className="mt-1 text-xs text-slate-500">{r.source === "web" ? "网页打卡" : "终端打卡"} · 序号 {r.sequence}{r.breakPaid === null ? "" : r.breakPaid ? " · 带薪休息标记" : " · 非带薪休息标记"}</p>
        <div className="mt-3 flex flex-wrap gap-2"><button className={button} onClick={() => filter({ ...filters, worker: { id: r.workerId, name: r.workerName } })}>仅看此人员</button>
          <button className={button} onClick={() => filter({ ...filters, location: { id: r.locationId, name: r.locationName } })}>仅看此地点</button></div>
        <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer">原始时间与记录编号</summary><div className="mt-2 break-all leading-6">UTC：{r.occurredAt}<br />原记录时区：{r.timeZone}<br />编号：{r.id}</div></details>
      </article>)}</div>
    </>}
    <div className="flex flex-wrap gap-3"><button className={button} disabled={busy || !state.query || !!error} onClick={() => void client.refresh(true)}>重新查询首页</button>
      <button className={button} disabled={busy || !state.result?.nextCursor || !!error} onClick={() => void client.next()}>下一页</button></div>
    <p className="text-xs leading-5 text-slate-500">只保留当前页，不下载全企业历史。新增或延迟提交的记录请重新查询首页；本页不是结算报表或正式导出快照。</p>
  </section>;
}
