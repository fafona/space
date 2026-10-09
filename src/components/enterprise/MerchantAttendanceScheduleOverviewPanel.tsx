"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AttendanceScheduleOverviewClient } from "@/lib/merchantAttendanceScheduleOverviewClient";
import { attendanceManagementRequest } from "@/lib/merchantAttendanceManagementClient";
import { parseAttendanceAdminResult, type AttendanceAdminWorker } from "@/lib/merchantAttendanceAdmin";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";

type Props = { siteId: string; ownerId: string; apiFetch: AttendanceApiFetch; onClose: () => void };
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40";
const input = "mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white p-2 text-sm disabled:opacity-50";
const nextDate = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const validRange = (fromDate: string, throughDate: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(throughDate)) return false;
  const days = (Date.parse(`${throughDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86400000;
  return Number.isInteger(days) && days >= 0 && days <= 30;
};
const localStamp = (value: string, timeZone: string) => new Intl.DateTimeFormat("zh-CN", { timeZone, year: "numeric", month: "2-digit",
  day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(value));

export default function MerchantAttendanceScheduleOverviewPanel(props: Props) {
  return <Screen key={`${props.siteId}:${props.ownerId}`} {...props}/>;
}

function Screen({ siteId, ownerId, apiFetch, onClose }: Props) {
  const client = useMemo(() => new AttendanceScheduleOverviewClient({ siteId, ownerId, apiFetch }), [siteId, ownerId, apiFetch]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [fromDate, setFromDate] = useState(today), [throughDate, setThroughDate] = useState(nextDate(today, 6));
  const [search, setSearch] = useState(""), [workers, setWorkers] = useState<AttendanceAdminWorker[]>([]);
  const [workerCursor, setWorkerCursor] = useState<string | null>(null), [workerLoading, setWorkerLoading] = useState(false);
  const [workerMessage, setWorkerMessage] = useState("输入姓名或工号后明确搜索考勤人员；不会自动读取。");
  const [selected, setSelected] = useState<AttendanceAdminWorker[]>([]);
  const picker = useMemo(() => ({ generation: 0, controller: null as AbortController | null }), []);
  const result = state.result, busy = state.phase === "loading";

  const stopPicker = (clear: boolean) => {
    picker.generation++; picker.controller?.abort(); picker.controller = null; setWorkerLoading(false);
    if (clear) { setWorkers([]); setWorkerCursor(null); }
  };
  useEffect(() => {
    const hide = () => {
      picker.generation++; picker.controller?.abort(); picker.controller = null;
      setWorkerLoading(false); setWorkers([]); setWorkerCursor(null); setSelected([]); setSearch(""); client.pause();
    };
    const visibility = () => { if (document.hidden) hide(); };
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hide);
    return () => { picker.generation++; picker.controller?.abort(); client.pause();
      document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); };
  }, [client, picker]);
  useEffect(() => {
    if (state.phase !== "blocked") return;
    picker.generation++; picker.controller?.abort(); picker.controller = null;
    setWorkerLoading(false); setWorkers([]); setWorkerCursor(null); setSelected([]); setSearch("");
    setWorkerMessage("总览读取失败，已清除人员候选和已选身份；请重新核对负责人权限。");
  }, [state.phase, picker]);

  const readWorkers = async (cursor: string | null) => {
    if (workerLoading || typeof document !== "undefined" && document.hidden) return;
    const generation = ++picker.generation; picker.controller?.abort(); const controller = new AbortController(); picker.controller = controller;
    setWorkerLoading(true); setWorkers([]); setWorkerCursor(null); setWorkerMessage("正在读取当前考勤人员标签…");
    try {
      const params = new URLSearchParams({ siteId, view: "workers", search }); if (cursor) params.set("cursor", cursor);
      const raw = await attendanceManagementRequest(apiFetch, `/api/merchant-enterprise/attendance/admin?${params}`, { method: "GET" },
        { signal: controller.signal, timeoutMs: 12000, maxBytes: 131072 });
      if (generation !== picker.generation) return;
      if (document.hidden) { stopPicker(true); setSelected([]); setSearch(""); client.pause(); return; }
      const parsed = parseAttendanceAdminResult(raw, { siteId, view: "workers", operationId: null });
      setWorkers(parsed.items as AttendanceAdminWorker[]); setWorkerCursor(parsed.nextCursor);
      setWorkerMessage(parsed.items.length ? "请选择最多 20 位考勤人员；停用档案也可核对历史排班。" : "本页没有匹配的考勤人员；这不是排班或缺勤结论。");
    } catch {
      if (generation === picker.generation) { setWorkers([]); setWorkerCursor(null); setSelected([]); client.pause();
        setWorkerMessage("无法读取考勤人员；已清除候选、已选身份和旧总览，请重新核对权限后手动重试。"); }
    } finally {
      if (generation === picker.generation) { picker.controller = null; setWorkerLoading(false); }
    }
  };
  const changeSearch = (value: string) => { stopPicker(true); client.pause(); setSearch(value); setWorkerMessage("搜索条件已修改；请明确点击搜索考勤人员。"); };
  const toggleWorker = (worker: AttendanceAdminWorker) => {
    client.pause();
    if (selected.some(item => item.id === worker.id)) setSelected(selected.filter(item => item.id !== worker.id));
    else if (selected.length >= 20) setWorkerMessage("每次最多选择 20 位考勤人员；请先移除一位。");
    else setSelected([...selected, worker].sort((a, b) => a.id.localeCompare(b.id)));
  };
  const changeDate = (kind: "from" | "through", value: string) => {
    client.pause(); if (kind === "from") setFromDate(value); else setThroughDate(value);
  };
  const begin = () => {
    if (busy || !selected.length || !validRange(fromDate, throughDate)) return;
    void client.begin({ workerIds: selected.map(worker => worker.id).sort(), fromDate, throughDate });
  };
  const close = () => { stopPicker(true); client.pause(); onClose(); };

  return <section aria-label="多人排班总览（只读）" className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-bold">多人排班总览 · 只读</h3>
      <p className="mt-1 text-sm leading-6 text-slate-600">一次核对最多 20 位已有考勤人员、最多 31 个地点本地工作日；不发布、修改或取消排班。</p></div>
      <button type="button" className={button} onClick={close}>关闭排班总览</button></header>
    <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6">日期筛选针对每条安排所属地点的本地工作日，不把跨地点日期范围当成一个 UTC 日。结果保留已取消历史行，不计算缺勤、工时、工资或人员总数。</p>

    <div aria-label="选择总览人员" className="space-y-3 rounded-xl border border-slate-200 p-3">
      <div className="flex flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-sm">总览人员搜索<input aria-label="总览人员搜索" className={input} maxLength={80}
        value={search} onChange={event => changeSearch(event.target.value)}/></label>
        <button type="button" className={button} disabled={workerLoading} onClick={() => void readWorkers(null)}>搜索考勤人员</button>
        <button type="button" className={button} disabled={workerLoading || !workerCursor} onClick={() => void readWorkers(workerCursor)}>下一页人员</button></div>
      <p className="text-xs leading-5 text-slate-600">{workerMessage}</p>
      <div className="grid gap-2 sm:grid-cols-2">{workers.map(worker => {
        const checked = selected.some(item => item.id === worker.id), label = `${worker.displayName} · ${worker.workerNo}`;
        return <label key={worker.id} className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-sm"><input type="checkbox" aria-label={label} checked={checked}
          disabled={!checked && selected.length >= 20} onChange={() => toggleWorker(worker)}/><span><span className="font-semibold">{label}</span>
          <span className="block text-xs text-slate-500">当前考勤档案 · {worker.active ? "启用" : "停用（仍可核对历史）"}</span></span></label>;
      })}</div>
      <div className="space-y-2"><p className="text-xs font-semibold">已选当前考勤档案：{selected.length} / 20</p><div className="flex flex-wrap gap-2">{selected.map(worker =>
        <button type="button" className={button} key={worker.id} onClick={() => toggleWorker(worker)}>移除 {worker.displayName} · {worker.workerNo}</button>)}</div></div>
    </div>

    <div aria-label="总览查询条件" className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 p-3">
      <label className="text-sm">总览开始日期<input aria-label="总览开始日期" className={input} type="date" value={fromDate}
        onChange={event => changeDate("from", event.target.value)}/></label>
      <label className="text-sm">总览结束日期<input aria-label="总览结束日期" className={input} type="date" value={throughDate}
        onChange={event => changeDate("through", event.target.value)}/></label>
      <button type="button" className={button} disabled={busy || !selected.length || !validRange(fromDate, throughDate)} onClick={begin}>查询排班总览</button>
    </div>
    {!validRange(fromDate, throughDate) && <p role="alert" className="text-sm text-amber-900">请选择同日或最多连续 31 个本地工作日。</p>}
    <p role="status" aria-live="polite" className="rounded-xl bg-blue-50 p-3 text-sm leading-6">{state.message}</p>

    {result && <>
      {!result.moduleEnabled && <p className="text-sm text-amber-900">新考勤已暂停；仍按当前负责人权限只读核对已有排班，不开放任何排班写入。</p>}
      <p className="break-all text-xs leading-6">第 {state.page} 页 · 本页扫描 {result.scanned} 条候选，显示 {result.items.length} 条；不是排班总数。<br/>
        查询工作日：{result.fromDate} → {result.throughDate} · 所选人员 {result.workerIds.length} 位 · 总览修订 {result.revision}<br/>
        只读协议：{result.protocol} · {result.readOnly ? "只读响应" : "响应不可用"}</p>
      {!result.items.length && <p className="rounded-xl border border-slate-200 p-3 text-sm">本页未显示安排；可能是空中间页或当前筛选未命中，不表示员工缺勤、没有排班或不存在其他页。</p>}
      <div className="space-y-3">{result.items.map(item => <article key={item.id} className={`space-y-2 rounded-xl border p-4 ${item.cancelled ? "border-slate-200 bg-slate-50" : "border-blue-200"}`}>
        <div className="flex flex-wrap items-start justify-between gap-2"><strong className="break-words">排班历史员工标签：{item.workerName}</strong>
          <span className="text-sm">{item.cancelled ? "已取消（保留历史行）" : "已安排"}</span></div>
        <p className="text-sm">排班历史地点标签：{item.locationName}<br/>地点时区：{item.timeZone}<br/>工作日（地点本地）：{item.workDate}</p>
        <p className="text-sm">地点本地时段：{localStamp(item.startAt, item.timeZone)} → {localStamp(item.endAt, item.timeZone)}</p>
        <details className="break-all text-xs text-slate-500"><summary>UTC 时间、修订及编号</summary>
          UTC：{item.startAt} → {item.endAt}<br/>安排编号：{item.id}<br/>人员编号：{item.workerId}<br/>地点编号：{item.locationId}<br/>
          安排修订：{item.revision}{item.cancelRevision === null ? "" : ` · 取消修订：${item.cancelRevision}`}</details>
      </article>)}</div>
      <button type="button" className={button} disabled={busy || !result.nextCursor} onClick={() => void client.next()}>下一页安排</button>
    </>}
    <p className="text-xs leading-6 text-slate-500">选人列表显示当前考勤档案标签；结果行显示排班记录保存的历史员工和地点标签，两者可能不同。只在明确搜索人员或查询总览时读取，不轮询、不保存浏览器名单；修改筛选、隐藏或关闭会清除旧总览并作废迟到响应。</p>
  </section>;
}
