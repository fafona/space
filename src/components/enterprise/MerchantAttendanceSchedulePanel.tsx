"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AttendanceScheduleClient, type ScheduleIntent } from "@/lib/merchantAttendanceScheduleClient";
import { resolveScheduleWallSlots, type ScheduleResult, type ScheduleQuery, type ScheduleWallSlot } from "@/lib/merchantAttendanceSchedule";
import { correctionTimeOffsets } from "@/lib/merchantAttendanceCorrectionForm";
import { attendanceManagementRequest } from "@/lib/merchantAttendanceManagementClient";
import { parseAttendanceAdminResult, type AttendanceAdminWorker } from "@/lib/merchantAttendanceAdmin";
import type { SchedulePanelProps } from "./MerchantAttendanceScheduleLauncher";
import MerchantAttendanceShiftTemplatesLauncher from "./MerchantAttendanceShiftTemplatesLauncher";
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40";
const input = "mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white p-2 text-sm disabled:opacity-50";
const nextDate = (date: string, days: number) => new Date(Date.parse(date + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
const stamp = (value: string, zone: string) => new Intl.DateTimeFormat("zh-CN", { timeZone: zone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
export default function MerchantAttendanceSchedulePanel(props: SchedulePanelProps & { onClose: () => void }) {
  return <Screen key={`${props.siteId}:${props.actorId}:${props.access}`} {...props}/>;
}
function Screen({ siteId, actorId, access, apiFetch, onClose }: SchedulePanelProps & { onClose: () => void }) {
  const client = useMemo(() => { const today = new Date().toISOString().slice(0, 10);
    return new AttendanceScheduleClient({ query: { siteId, access, workerId: null, operationId: null, fromDate: today, throughDate: nextDate(today, 6) }, actorId, apiFetch, storage: () => window.sessionStorage });
  }, [siteId, actorId, access, apiFetch]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot), [dirty, setDirty] = useState(false);
  useEffect(() => { void client.initialize(); const visible = () => { setDirty(false); if (document.visibilityState === "hidden") client.pause(); else void client.initialize(); };
    document.addEventListener("visibilitychange", visible); return () => { document.removeEventListener("visibilitychange", visible); client.pause(); }; }, [client]);
  useEffect(() => { const unload = (e: BeforeUnloadEvent) => { if (dirty || state.pending) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", unload); return () => window.removeEventListener("beforeunload", unload); }, [dirty, state.pending]);
  const leave = () => (!dirty || window.confirm("未提交的排班草稿会丢失，继续吗？")) && (!state.pending || window.confirm("操作结果仍待确认。离开不会撤销，返回时查询原操作编号，继续吗？"));
  const r = state.result, busy = state.phase === "loading" || state.phase === "saving";
  const load = (query: ScheduleQuery) => { if (!dirty || window.confirm("未提交的排班草稿会丢失，继续吗？")) { setDirty(false); void client.load(query); } };
  return <section aria-label={access === "owner" ? "员工排班工作区" : "我的排班工作区"} className="my-4 min-w-0 space-y-4 rounded-2xl border border-blue-200 bg-white p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">{access === "owner" ? "员工排班" : "我的排班"}</h2><p className="mt-1 text-sm text-slate-500">计划与实际记录分开 · 班次以开始日期归属 · 每次查看最多 31 天</p></div>
      <button type="button" className={button} onClick={() => { if (leave()) { client.pause(); onClose(); } }}>关闭排班</button></header>
    <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6">排班只表示工作安排，不生成打卡，不自动扣休息或判定缺勤，也不计算工资。修改已发布安排请先取消再新增；开始后的班次不能在这里追溯修改。</p>
    <p role="status" aria-live="polite" className="rounded-xl bg-blue-50 p-3 text-sm">{state.message}</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => { if (!dirty || window.confirm("放弃未提交草稿并重新读取？")) { setDirty(false); void client.initialize(); } }}>重新读取／查原收据</button>
      {state.pending && <button type="button" className={button} disabled={state.phase !== "unconfirmed"} onClick={() => void client.retry()}>用原编号明确重试</button>}</div>
    {state.pending && <p className="break-all text-sm text-amber-900">待确认编号：{state.pending.command.operationId}。核对前不能改员工、范围或发起第二笔操作。</p>}
    <RangeForm key={`${state.query.fromDate}:${state.query.throughDate}`} query={state.query} disabled={busy || !!state.pending} onLoad={load}/>
    {r && <>
      {access === "owner" && <WorkerPicker key={state.query.workerId ?? "empty"} siteId={siteId} apiFetch={apiFetch} disabled={busy || !!state.pending} onSelect={id => load({ ...state.query, workerId: id })}/>}
      {r.worker && <div className="rounded-xl bg-slate-50 p-3 text-sm"><strong>{r.worker.name}</strong><p>默认地点：{r.worker.location?.name ?? "未配置"} · {r.worker.location?.timeZone ?? r.timeZone}</p>
        <p>当前排班版本 {r.revision}{!r.rangeLimited && <> · 日期范围内有效安排 {r.entries.filter(e => !e.cancelled).length} 段 · 计划时长 {(r.entries.filter(e => !e.cancelled).reduce((n, e) => n + Date.parse(e.endAt) - Date.parse(e.startAt), 0) / 3600000).toFixed(2)} 小时</>}</p></div>}
      {access === "owner" && r.worker && <PublishForm key={`${r.worker.id}:${r.revision}:${r.settingsVersion}:${r.fromDate}:${r.throughDate}`} result={r} siteId={siteId} ownerId={actorId} apiFetch={apiFetch} disabled={busy || !!state.pending || !r.moduleEnabled || !r.worker.active || !r.worker.location?.active}
        onDirty={() => setDirty(true)} onSubmit={intent => { setDirty(false); void client.submit(intent); }}/>}
      {access === "owner" && !r.worker && <p className="text-sm text-slate-600">请搜索并选择考勤人员，然后安排班次。</p>}
      {r.rangeLimited && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm">此日期范围超过 100 条安排，列表与合计暂不显示。请缩短查询日期；原操作收据仍可正常核对。</p>}
      {r.worker && !r.rangeLimited && !r.entries.length && <p className="rounded-xl border border-slate-200 p-4 text-sm">所选开始日期范围内暂无排班，不代表缺勤。</p>}
      <div className="space-y-3">{r.entries.map(e => <article key={e.id} className={`rounded-xl border p-4 ${e.cancelled ? "border-slate-200 bg-slate-50" : "border-blue-200"}`}>
        <div className="flex flex-wrap justify-between gap-2"><strong>{stamp(e.startAt, e.timeZone)} — {stamp(e.endAt, e.timeZone)}</strong><span className="text-sm">{e.cancelled ? "已取消" : "已安排"}</span></div>
        <p className="mt-1 text-sm">{e.locationName} · {e.timeZone} · 归属 {e.workDate} · {((Date.parse(e.endAt) - Date.parse(e.startAt)) / 3600000).toFixed(2)} 小时</p>
        <p className="text-xs text-slate-500">发布时员工：{e.workerName}</p>
        <p className="mt-1 break-words text-sm">安排理由：{e.reason}{e.cancelled && <><br/>取消理由：{e.cancelReason}</>}</p>
        <details className="mt-2 break-all text-xs text-slate-500"><summary>UTC 时间及编号</summary>{e.startAt} — {e.endAt}<br/>{e.id}</details>
        {access === "owner" && !e.cancelled && <CancelForm disabled={busy || !!state.pending || !r.moduleEnabled} onDirty={() => setDirty(true)} onSubmit={reason => { setDirty(false); void client.submit({ action: "cancel", slotId: e.id, reason }); }}/>}
      </article>)}</div>
    </>}
    <p className="text-xs leading-5 text-slate-500">目前由商户负责人发布；员工仅查看本人。待确认操作仅保存在当前账号、企业和标签页，关闭标签页后不能保证恢复。隐藏页面会清除未提交草稿并重新核验身份。</p>
  </section>;
}
function RangeForm({ query, disabled, onLoad }: { query: ScheduleQuery; disabled: boolean; onLoad: (q: ScheduleQuery) => void }) {
  const [from, setFrom] = useState(query.fromDate), [through, setThrough] = useState(query.throughDate);
  return <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); onLoad({ ...query, fromDate: from, throughDate: through }); }}>
    <label className="text-sm">开始日期<input className={input} type="date" required value={from} disabled={disabled} onChange={e => setFrom(e.target.value)}/></label>
    <label className="text-sm">结束日期（含）<input className={input} type="date" required value={through} disabled={disabled} onChange={e => setThrough(e.target.value)}/></label><button className={button} disabled={disabled}>查询安排</button></form>;
}
function WorkerPicker({ siteId, apiFetch, disabled, onSelect }: Pick<SchedulePanelProps, "siteId" | "apiFetch"> & { disabled: boolean; onSelect: (id: string) => void }) {
  const [search, setSearch] = useState(""), [items, setItems] = useState<AttendanceAdminWorker[]>([]), [cursor, setCursor] = useState<string | null>(null), [message, setMessage] = useState("输入姓名或工号，搜索已有考勤人员。"), [loading, setLoading] = useState(false);
  const controller = useMemo(() => ({ current: null as AbortController | null, generation: 0 }), []);
  useEffect(() => () => { controller.generation++; controller.current?.abort(); }, [controller]);
  const read = async (next: string | null) => {
    if (disabled || loading) return; const g = ++controller.generation; controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setLoading(true); setItems([]); setCursor(null);
    try { const params = new URLSearchParams({ siteId, view: "workers", search }); if (next) params.set("cursor", next);
      const raw = await attendanceManagementRequest(apiFetch, `/api/merchant-enterprise/attendance/admin?${params}`, {}, { signal: abort.signal });
      const r = parseAttendanceAdminResult(raw, { siteId, view: "workers", operationId: null });
      if (g !== controller.generation) return; setItems(r.items as AttendanceAdminWorker[]); setCursor(r.nextCursor); setMessage(r.items.length ? "选择一位员工" : "未找到考勤人员，请先在考勤配置中关联员工。");
    } catch { if (g === controller.generation) { setItems([]); setMessage("无法读取人员，请重新核验权限后重试。"); } }
    finally { if (g === controller.generation) setLoading(false); }
  };
  return <div className="rounded-xl border border-slate-200 p-3"><form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); void read(null); }}>
    <label className="min-w-0 flex-1 text-sm">考勤人员搜索<input className={input} maxLength={80} value={search} disabled={disabled || loading} onChange={e => { setSearch(e.target.value); setItems([]); setCursor(null); }}/></label><button className={button} disabled={disabled || loading}>搜索人员</button></form>
    <p className="my-2 text-xs text-slate-500">{message}</p><div className="flex flex-wrap gap-2">{items.map(w => <button type="button" className={button} disabled={disabled} key={w.id} onClick={() => onSelect(w.id)}>{w.displayName} · {w.workerNo}{!w.active && "（已停用）"}</button>)}</div>
    {cursor && <button type="button" className={`${button} mt-2`} disabled={disabled || loading} onClick={() => void read(cursor)}>下一页人员</button>}</div>;
}
function PublishForm({ result: r, siteId, ownerId, apiFetch, disabled, onDirty, onSubmit }: { result: ScheduleResult; siteId: string; ownerId: string; apiFetch: SchedulePanelProps["apiFetch"]; disabled: boolean; onDirty: () => void; onSubmit: (i: ScheduleIntent) => void }) {
  const [repeat, setRepeat] = useState(false), [weekdays, setWeekdays] = useState([1, 2, 3, 4, 5]);
  const [segments, setSegments] = useState([{ start: "09:00", end: "17:00", next: false }]), [rows, setRows] = useState<ScheduleWallSlot[]>([]);
  const [reason, setReason] = useState(""), [ack, setAck] = useState(false), [message, setMessage] = useState("");
  const zone = r.worker?.location?.timeZone ?? r.timeZone;
  const changed = () => { setRows([]); setAck(false); setMessage(""); onDirty(); };
  const preview = () => {
    try {
      const result: ScheduleWallSlot[] = [];
      for (let day = r.fromDate; day <= (repeat ? r.throughDate : r.fromDate); day = nextDate(day, 1)) {
        if (repeat && !weekdays.includes(new Date(`${day}T00:00:00Z`).getUTCDay())) continue;
        for (const segment of segments) result.push({ start: `${day}T${segment.start}`, end: `${nextDate(day, segment.next ? 1 : 0)}T${segment.end}`, startOffset: "", endOffset: "" });
      }
      if (!result.length || result.length > 32) throw Error("请选择至少一段、每批最多 32 段；更多安排请分批发布。");
      setRows(result); setAck(false); setMessage("请核对每段时间；夏令时重复时间须选择偏移，不存在的时间须返回修改。");
    } catch (e) { setMessage(e instanceof Error ? e.message : "请检查时间。"); }
  };
  return <form className="space-y-3 rounded-xl border border-slate-200 p-4" onSubmit={e => { e.preventDefault(); if (disabled || !ack || !r.worker?.location) return;
    try { onSubmit({ action: "publish", locationId: r.worker.location.id, timeZone: zone, slots: resolveScheduleWallSlots(rows, zone), reason: reason.trim() }); }
    catch (error) { setMessage(error instanceof Error ? error.message : "请检查时间。"); }
  }}>
    <h3 className="font-bold">新增安排 · {zone}</h3><p className="text-xs text-slate-500">单日安排使用查询开始日 {r.fromDate}；重复安排只展开当前日期范围，不自动无限续期。休息可通过拆成多段表示，不推断带薪规则。</p>
    <MerchantAttendanceShiftTemplatesLauncher siteId={siteId} ownerId={ownerId} apiFetch={apiFetch} applyDisabled={disabled} writeDisabled={!r.moduleEnabled}
      onDirty={onDirty} onApply={template => { setSegments(template.segments.map(segment => ({ start: segment.start, end: segment.end, next: segment.nextDay }))); changed(); }}/>
    <fieldset disabled={disabled} className="space-y-3">
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={repeat} onChange={e => { setRepeat(e.target.checked); changed(); }}/>按每周重复展开当前范围</label>
      {repeat && <div className="flex flex-wrap gap-3">{["日", "一", "二", "三", "四", "五", "六"].map((label, index) => <label key={label} className="flex gap-1 text-sm"><input type="checkbox" checked={weekdays.includes(index)} onChange={e => { setWeekdays(e.target.checked ? [...weekdays, index] : weekdays.filter(n => n !== index)); changed(); }}/>周{label}</label>)}</div>}
      {segments.map((segment, index) => <div className="grid gap-2 sm:grid-cols-4" key={index}>
        <label className="text-sm">第 {index + 1} 段开始<input className={input} type="time" required value={segment.start} onChange={e => { setSegments(segments.map((s, i) => i === index ? { ...s, start: e.target.value } : s)); changed(); }}/></label>
        <label className="text-sm">第 {index + 1} 段结束<input className={input} type="time" required value={segment.end} onChange={e => { setSegments(segments.map((s, i) => i === index ? { ...s, end: e.target.value } : s)); changed(); }}/></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={segment.next} onChange={e => { setSegments(segments.map((s, i) => i === index ? { ...s, next: e.target.checked } : s)); changed(); }}/>次日结束</label>
        {segments.length > 1 && <button type="button" className={button} onClick={() => { setSegments(segments.filter((_, i) => i !== index)); changed(); }}>删除第 {index + 1} 段</button>}</div>)}
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={segments.length >= 4} onClick={() => { setSegments([...segments, { start: "17:00", end: "21:00", next: false }]); changed(); }}>增加一段</button><button type="button" className={button} onClick={preview}>生成安排预览</button></div>
      <label className="block text-sm">安排理由<input className={input} maxLength={200} required value={reason} onChange={e => { setReason(e.target.value); setAck(false); onDirty(); }}/></label>
      {message && <p role="status" className="text-sm text-amber-900">{message}</p>}
      {rows.length > 0 && <div className="max-h-80 space-y-3 overflow-auto rounded-xl bg-slate-50 p-3">{rows.map((row, index) => <div key={index} className="grid gap-2 text-xs sm:grid-cols-2">{(["start", "end"] as const).map(key => {
        const choices = correctionTimeOffsets(row[key], zone), offsetKey = key === "start" ? "startOffset" : "endOffset";
        return <label key={key}>{key === "start" ? "开始" : "结束"} {row[key].replace("T", " ")}{choices.length === 1 ? ` UTC${choices[0]}` : !choices.length ? " · 时间不存在" : <select aria-label={`第 ${index + 1} 段${key === "start" ? "开始" : "结束"}偏移`} className={input} required value={row[offsetKey]} onChange={e => { setRows(rows.map((s, i) => i === index ? { ...s, [offsetKey]: e.target.value } : s)); setAck(false); onDirty(); }}><option value="">请选择重复时间的偏移</option>{choices.map(offset => <option key={offset}>{offset}</option>)}</select>}</label>;
      })}</div>)}</div>}
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={ack} disabled={!rows.length} onChange={e => { setAck(e.target.checked); onDirty(); }}/>已核对 {rows.length} 段安排、地点时区和理由，确认发布</label>
      <button className={button} disabled={!rows.length || !ack || !reason.trim()}>发布排班</button>
    </fieldset>
  </form>;
}
function CancelForm({ disabled, onDirty, onSubmit }: { disabled: boolean; onDirty: () => void; onSubmit: (reason: string) => void }) {
  const [open, setOpen] = useState(false), [reason, setReason] = useState("");
  return open ? <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); if (!disabled && reason.trim()) onSubmit(reason.trim()); }}>
    <label className="min-w-0 flex-1 text-sm">取消理由<input className={input} required maxLength={200} disabled={disabled} value={reason} onChange={e => { setReason(e.target.value); onDirty(); }}/></label>
    <button className={button} disabled={disabled || !reason.trim()}>确认取消班次</button></form>
    : <button type="button" className={`${button} mt-3`} disabled={disabled} onClick={() => setOpen(true)}>取消此班次</button>;
}
