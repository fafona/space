"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { calendarDateRange, calendarEntryRange } from "@/lib/merchantAttendanceCalendar";
import { AttendanceCalendarClient } from "@/lib/merchantAttendanceCalendarClient";
import { attendanceManagementRequest } from "@/lib/merchantAttendanceManagementClient";
import { parseAttendanceAdminResult, type AttendanceAdminLocation } from "@/lib/merchantAttendanceAdmin";
import type { AttendanceCalendarPanelProps } from "./MerchantAttendanceCalendarLauncher";

type Props = AttendanceCalendarPanelProps & { onClose: () => void };
type Range = { fromDate: string; throughDate: string };
type CalendarKind = "holiday" | "closure";
type DetailView = {
  entryId: string; locationId: string | null; locationName: string | null; timeZone: string; kind: CalendarKind; title: string;
  fromDate: string; throughDate: string; createdAt: string; revision: 1 | 2; status: "created" | "cancelled"; reason: string;
  cancelReason: string | null; cancelledAt: string | null; canCancel: boolean;
};

const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40";
const input = "mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white p-2 text-sm disabled:bg-slate-50 disabled:text-slate-500";
const kindLabels: Record<CalendarKind, string> = { holiday: "节假日提示", closure: "停业日提示" };

export default function MerchantAttendanceCalendarPanel(props: Props) {
  return <Screen key={`${props.siteId}:${props.ownerId}`} {...props}/>;
}

function Screen({ siteId, ownerId, apiFetch, onClose }: Props) {
  const client = useMemo(() => new AttendanceCalendarClient({ siteId, ownerId, apiFetch, storage: () => window.sessionStorage }), [siteId, ownerId, apiFetch]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const runtime = useMemo(() => ({ generation: 0, controller: null as AbortController | null }), []);
  const [visible, setVisible] = useState(false), [dirty, setDirty] = useState(false), [draftVersion, setDraftVersion] = useState(0);
  const [fromDate, setFromDate] = useState(""), [throughDate, setThroughDate] = useState(""), [loadedRange, setLoadedRange] = useState<Range | null>(null);
  const [scopeKey, setScopeKey] = useState(""), [showPayload, setShowPayload] = useState(false);
  const [locationSearch, setLocationSearch] = useState(""), [locations, setLocations] = useState<AttendanceAdminLocation[]>([]);
  const [locationCursor, setLocationCursor] = useState<string | null>(null), [locationLoading, setLocationLoading] = useState(false);
  const [locationMessage, setLocationMessage] = useState("输入地点名称后明确搜索；不会自动读取地点。 ");

  const clearPicker = (clearSearch = false) => {
    runtime.generation++; runtime.controller?.abort(); runtime.controller = null;
    setLocationLoading(false); setLocations([]); setLocationCursor(null);
    if (clearSearch) setLocationSearch("");
  };
  const clearDrafts = () => {
    setDirty(false); setDraftVersion(value => value + 1); setLoadedRange(null); setShowPayload(false);
  };

  useEffect(() => {
    let mounted = true;
    const initialize = async () => {
      setVisible(false); clearDrafts(); setScopeKey(""); clearPicker(true); const generation = ++runtime.generation;
      await client.initialize();
      if (mounted && generation === runtime.generation && document.visibilityState !== "hidden") setVisible(true);
    };
    const hide = () => { runtime.generation++; runtime.controller?.abort(); runtime.controller = null; setVisible(false); clearDrafts(); setScopeKey(""); clearPicker(true); client.pause(); };
    const visibility = () => { if (document.visibilityState === "hidden") hide(); else void initialize(); };
    if (document.visibilityState === "hidden") hide(); else void initialize();
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hide);
    return () => { mounted = false; hide(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); };
    // The client/runtime pair is identity-keyed by the outer component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, runtime]);

  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (!dirty && !state.pending) return;
      event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("beforeunload", unload); return () => window.removeEventListener("beforeunload", unload);
  }, [dirty, state.pending]);

  const result = visible ? state.result : null;
  useEffect(() => {
    if (!result) return;
    const nextKey = `${result.locationId ?? "enterprise"}:${result.locationVersion ?? "none"}:${result.timeZone}:${result.settingsVersion}`;
    if (nextKey === scopeKey) return;
    setScopeKey(nextKey); setLoadedRange(null); setShowPayload(!!result.receipt); setDirty(false); setDraftVersion(value => value + 1);
    try {
      const year = new Intl.DateTimeFormat("en", { timeZone: result.timeZone, year: "numeric" }).format(new Date());
      const next = { fromDate: `${year}-01-01`, throughDate: `${year}-12-31` }; calendarDateRange(next.fromDate, next.throughDate);
      setFromDate(next.fromDate); setThroughDate(next.throughDate);
    } catch { setFromDate(""); setThroughDate(""); }
  }, [result, scopeKey]);

  useEffect(() => {
    if (state.phase !== "blocked") return;
    clearPicker(true); clearDrafts(); setLocationMessage("读取失败，已清除地点候选和旧日历内容；请重新核对负责人权限。 ");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  const busy = state.phase === "loading" || state.phase === "saving";
  const locked = busy || !!state.pending || state.phase !== "ready";
  const validQuery = (() => { try { calendarDateRange(fromDate, throughDate); return true; } catch { return false; } })();
  const discard = (message = "未保存的日历提示草稿会清除，继续吗？") => !dirty || window.confirm(message);
  const close = () => {
    if (!discard()) return;
    if (state.pending && !window.confirm("操作结果仍待确认。离开不会撤销已发送操作，返回后须按原编号核对。继续吗？")) return;
    clearPicker(true); clearDrafts(); client.pause(); onClose();
  };

  const readLocations = async (cursor: string | null) => {
    if (locationLoading || locked || document.hidden) return;
    const generation = ++runtime.generation; runtime.controller?.abort(); const controller = new AbortController(); runtime.controller = controller;
    setLocationLoading(true); setLocations([]); setLocationCursor(null); setLocationMessage("正在读取当前工作地点…");
    try {
      const params = new URLSearchParams({ siteId, view: "locations", search: locationSearch }); if (cursor) params.set("cursor", cursor);
      const raw = await attendanceManagementRequest(apiFetch, `/api/merchant-enterprise/attendance/admin?${params}`, { method: "GET" },
        { signal: controller.signal, timeoutMs: 12000, maxBytes: 131072 });
      if (generation !== runtime.generation || document.hidden) return;
      const parsed = parseAttendanceAdminResult(raw, { siteId, view: "locations", operationId: null });
      setLocations(parsed.items as AttendanceAdminLocation[]); setLocationCursor(parsed.nextCursor);
      setLocationMessage(parsed.items.length ? "选择企业日历或一个工作地点；停用地点不再新增，现有提示仍按详情中的当前能力处理。" : "本页没有匹配地点；请修改条件后明确搜索。 ");
    } catch {
      if (generation === runtime.generation) {
        clearPicker(false); clearDrafts(); client.pause();
        setLocationMessage("无法读取地点；已清除候选和旧日历内容，请重新读取并核对负责人权限。 ");
      }
    } finally { if (generation === runtime.generation) { runtime.controller = null; setLocationLoading(false); } }
  };

  const selectScope = (locationId: string | null) => {
    if (locked || !discard("未保存的日历提示草稿会清除。确认切换日历范围？")) return;
    clearDrafts(); clearPicker(false); void client.context(locationId);
  };
  const changeRange = (kind: "from" | "through", value: string) => {
    setLoadedRange(null); setShowPayload(false);
    if (kind === "from") setFromDate(value); else setThroughDate(value);
  };
  const load = () => {
    if (locked || !validQuery || !discard("未保存的日历提示草稿会清除。确认查询其他日期？")) return;
    const range = { fromDate, throughDate }; setDirty(false); setDraftVersion(value => value + 1); setLoadedRange(range); setShowPayload(true); void client.load(range);
  };
  const back = () => {
    if (!discard()) return;
    setDirty(false); setDraftVersion(value => value + 1); setShowPayload(!!loadedRange);
    if (loadedRange) void client.load(loadedRange); else void client.context(result?.locationId ?? null);
  };

  return <section aria-label="节假日／停业日（仅提示）" className="my-4 min-w-0 space-y-4 rounded-2xl border border-blue-200 bg-white p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">节假日／停业日 · 仅提示</h2>
      <p className="mt-1 text-sm text-slate-600">负责人手动日历 · 企业或单一工作地点 · 当地日期</p></div>
      <button type="button" className={button} onClick={close}>关闭日历</button></header>
    <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-950">这些记录只是内部提示，不是国家法定节假日来源，也不会自动取消或阻止排班、请假、打卡、预约、工时或工资。重叠提示独立保留，不自动合并或每年重复。</p>
    <p role="status" aria-live="polite" className={`rounded-xl p-3 text-sm ${state.phase === "blocked" || state.pending ? "bg-amber-50 text-amber-950" : "bg-blue-50 text-blue-950"}`}>{state.message}</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => {
      if (discard()) { clearDrafts(); setScopeKey(""); void client.initialize(); }
    }}>{state.pending ? "重新读取／查原收据" : "重新读取企业日历"}</button>
      {state.pending && <button type="button" className={button} disabled={state.phase !== "unconfirmed"} onClick={() => {
        if (window.confirm("先查询原操作收据；如仍未确认，只使用同一操作编号重试原内容。继续吗？")) void client.retry();
      }}>用原编号明确重试</button>}</div>
    {state.pending && <p className="break-all rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">操作结果待确认；不能创建第二个编号。<br/>原操作编号：{state.pending.command.operationId}</p>}

    {result && <>
      <section aria-label="日历范围" className="space-y-3 rounded-xl border border-slate-200 p-3">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold">{result.locationId ? `地点日历：${result.locationName}` : "企业日历"}</h3>
          <p className="mt-1 text-sm">权威时区：{result.timeZone} · 考勤设置版本 {result.settingsVersion}{result.locationVersion === null ? "" : ` · 地点版本 ${result.locationVersion}`}</p></div>
          <button type="button" className={button} disabled={locked || result.locationId === null} onClick={() => selectScope(null)}>使用企业日历</button></div>
        <p className="text-xs leading-5 text-slate-600">企业提示按企业考勤 IANA 时区解释；地点提示按所选地点时区解释。同一企业日期不会自动复制为各地点的同名当地日期。</p>
        {result.locationId && !result.canCreate && <p role="alert" className="text-sm text-amber-900">该地点当前不可新增提示；仍可查询历史，并以每条详情显示的当前能力为准。</p>}
        <div className="flex flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-sm">日历地点搜索<input aria-label="日历地点搜索" className={input} maxLength={80}
          disabled={locked || locationLoading} value={locationSearch} onChange={event => { clearPicker(false); setLocationSearch(event.target.value); }}/></label>
          <button type="button" className={button} disabled={locked || locationLoading} onClick={() => void readLocations(null)}>搜索工作地点</button>
          <button type="button" className={button} disabled={locked || locationLoading || !locationCursor} onClick={() => void readLocations(locationCursor)}>下一页地点</button></div>
        <p className="text-xs text-slate-600">{locationMessage}</p>
        <div className="grid gap-2 sm:grid-cols-2">{locations.map(location => <button type="button" className={`${button} whitespace-normal text-left`} key={location.id}
          disabled={locked} onClick={() => selectScope(location.id)}>{location.name} · {location.timeZone} · {location.active ? "启用" : "停用（不再新增）"}</button>)}</div>
      </section>

      {!result.moduleEnabled && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">平台已暂停新的日历操作；仍可按当前负责人身份查询历史和原操作收据。</p>}
      {result.receipt && <section aria-label="日历操作收据" className="space-y-1 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
        <h3 className="font-semibold">原操作已确认 · {result.receipt.item.status === "cancelled" ? "已取消提示" : "已创建提示"}</h3>
        <p>{kindLabels[result.receipt.item.kind]} · {result.receipt.item.title} · {result.receipt.item.fromDate} → {result.receipt.item.throughDate}</p>
        <p className="break-all text-xs">提示编号：{result.receipt.item.entryId}<br/>操作编号：{result.receipt.command.operationId}</p>
      </section>}

      <section aria-label="日历日期查询" className="space-y-3 rounded-xl border border-slate-200 p-3">
        <h3 className="font-bold">查询当地日期提示</h3><div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">日历开始日期<input aria-label="日历开始日期" className={input} type="date" min="2000-01-01" max="2100-12-31" value={fromDate} disabled={busy || !!state.pending} onChange={event => changeRange("from", event.target.value)}/></label>
          <label className="text-sm">日历结束日期<input aria-label="日历结束日期" className={input} type="date" min="2000-01-01" max="2100-12-31" value={throughDate} disabled={busy || !!state.pending} onChange={event => changeRange("through", event.target.value)}/></label>
          <button type="button" className={button} disabled={locked || !validQuery} onClick={load}>查询日历提示</button></div>
        {!validQuery && <p role="alert" className="text-sm text-amber-900">请选择 2000～2100 年内连续 1～366 个当地日期。</p>}
        {!showPayload && <p className="text-xs text-slate-500">日期或范围已改变；旧查询已隐藏，不会自动发起新请求。</p>}
      </section>

      {!result.detail && <CreateForm key={`${scopeKey}:${draftVersion}`} timeZone={result.timeZone} scopeName={result.locationName ?? "企业"}
        disabled={locked || !result.moduleEnabled || !result.canCreate} onDirty={() => setDirty(true)} onCreate={input => {
          setDirty(false); setDraftVersion(value => value + 1); setShowPayload(true); void client.create(input);
        }}/>}

      {showPayload && (result.detail
        ? <Detail key={`${result.detail.entryId}:${result.detail.revision}:${draftVersion}`} detail={result.detail as DetailView} disabled={locked || !result.moduleEnabled}
            onDirty={() => setDirty(true)} onBack={back} onCancel={reason => { setDirty(false); setDraftVersion(value => value + 1); void client.cancel(reason); }}/>
        : <CalendarList result={result} disabled={locked} onDetail={entryId => { if (discard()) { setDirty(false); void client.detail(entryId); } }}
            onNext={() => { if (discard()) { setDirty(false); void client.next(); } }}/>) }
    </>}
    <p className="text-xs leading-6 text-slate-500">本页不读取员工资料，不导入预约或会员节日，不推断法定假日。只有明确查询、创建、取消或原号重试会请求相应操作；隐藏或关闭会清除草稿、地点候选和已显示内容。</p>
  </section>;
}

function CreateForm({ timeZone, scopeName, disabled, onDirty, onCreate }: { timeZone: string; scopeName: string; disabled: boolean; onDirty: () => void;
  onCreate: (input: { kind: CalendarKind; title: string; fromDate: string; throughDate: string; reason: string }) => void }) {
  const [kind, setKind] = useState<CalendarKind>("holiday"), [title, setTitle] = useState(""), [fromDate, setFromDate] = useState(""), [throughDate, setThroughDate] = useState("");
  const [reason, setReason] = useState(""), [preview, setPreview] = useState<Range | null>(null), [ack, setAck] = useState(false), [message, setMessage] = useState("");
  const titleValid = validText(title, 80), reasonValid = validText(reason, 200);
  const changed = () => { setPreview(null); setAck(false); setMessage(""); onDirty(); };
  const buildPreview = () => {
    try { calendarDateRange(fromDate, throughDate); calendarEntryRange(fromDate, throughDate, timeZone); setPreview({ fromDate, throughDate }); setAck(false); setMessage("已按权威 IANA 时区核对日期端点；请确认范围与提示类型。 "); }
    catch { setPreview(null); setAck(false); setMessage("请选择 2000～2100 年内连续 1～366 个实际存在的当地日期。 "); }
  };
  return <form aria-label="新增日历提示" className="space-y-3 rounded-xl border border-slate-200 p-4" onSubmit={event => {
    event.preventDefault(); if (disabled || !preview || !ack || !titleValid || !reasonValid) return;
    try { calendarDateRange(fromDate, throughDate); calendarEntryRange(fromDate, throughDate, timeZone); }
    catch { setPreview(null); setAck(false); setMessage("日期已变化或无效，请重新生成预览。 "); return; }
    if (preview.fromDate !== fromDate || preview.throughDate !== throughDate) return;
    if (window.confirm("确认创建这条日历提示？它不会自动改变排班、请假、打卡、预约、工时或工资。")) onCreate({ kind, title: title.trim(), fromDate, throughDate, reason: reason.trim() });
  }}>
    <h3 className="font-bold">新增{scopeName}日历提示</h3><p className="text-xs leading-5 text-slate-600">权威时区：{timeZone}。允许过去或未来日期，起止均包含；最长 366 天。重叠记录独立保留。</p>
    <fieldset disabled={disabled} className="space-y-3">
      <label className="block text-sm">提示类型<select aria-label="日历提示类型" className={input} value={kind} onChange={event => { setKind(event.target.value as CalendarKind); changed(); }}>
        <option value="holiday">节假日提示</option><option value="closure">停业日提示</option></select></label>
      <label className="block text-sm">提示标题（1～80 字）<input aria-label="日历提示标题" className={input} maxLength={160} value={title} onChange={event => { setTitle(event.target.value); changed(); }}/></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">提示开始日期<input aria-label="提示开始日期" className={input} type="date" min="2000-01-01" max="2100-12-31" value={fromDate} onChange={event => { setFromDate(event.target.value); changed(); }}/></label>
        <label className="text-sm">提示结束日期<input aria-label="提示结束日期" className={input} type="date" min="2000-01-01" max="2100-12-31" value={throughDate} onChange={event => { setThroughDate(event.target.value); changed(); }}/></label></div>
      <button type="button" className={button} onClick={buildPreview}>生成日历提示预览</button>
      {message && <p role="status" className="text-sm text-amber-900">{message}</p>}
      {preview && <section aria-label="日历提示预览" className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm">
        <h4 className="font-bold">尚未创建 · {kindLabels[kind]}</h4><p>{title.trim() || "（尚未填写标题）"}</p>
        <p>{preview.fromDate} → {preview.throughDate}（含首尾，共 {rangeDays(preview)} 天） · {timeZone}</p>
        <p className="mt-1 text-xs">只是日历提示；不是法定假日认证，也不会产生任何考勤或预约联动。</p></section>}
      <label className="block text-sm">创建原因（1～200 字，单行；请勿填写病历或员工隐私）<input aria-label="日历提示创建原因" className={input} maxLength={400} value={reason} onChange={event => { setReason(event.target.value); setAck(false); onDirty(); }}/></label>
      <label className="flex items-start gap-2 text-sm leading-6"><input type="checkbox" checked={ack} disabled={!preview || !titleValid || !reasonValid} onChange={event => { setAck(event.target.checked); onDirty(); }}/>
        <span>我已核对范围、当地日期、时区、类型和原因；确认这只是提示，不会自动改变其他业务记录。</span></label>
      <button className={button} disabled={!preview || !ack || !titleValid || !reasonValid}>明确创建日历提示</button>
    </fieldset>
  </form>;
}

function CalendarList({ result, disabled, onDetail, onNext }: { result: { items: Array<{ entryId: string; locationName: string | null; timeZone: string; kind: CalendarKind; title: string; fromDate: string; throughDate: string; createdAt: string; revision: number; status: "created" | "cancelled" }>; nextCursor: unknown }; disabled: boolean; onDetail: (id: string) => void; onNext: () => void }) {
  return <section aria-label="日历提示记录" className="space-y-3"><h3 className="font-bold">查询结果</h3>
    {!result.items.length && <p className="rounded-xl border border-slate-200 p-4 text-sm">本页没有匹配提示；不代表没有排班、预约或法定假日。</p>}
    {result.items.map(item => <article key={item.entryId} className="space-y-2 rounded-xl border border-slate-200 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2"><strong>{kindLabels[item.kind]} · {item.title}</strong><span>{item.status === "cancelled" ? "已取消（保留历史）" : "当前提示"}</span></div>
      <p>{item.fromDate} → {item.throughDate}（含首尾） · {item.timeZone}<br/>{item.locationName ?? "企业日历"}</p>
      <p className="break-all text-xs text-slate-500">创建 UTC：{item.createdAt} · 版本 {item.revision}<br/>提示编号：{item.entryId}</p>
      <button type="button" className={button} disabled={disabled} onClick={() => onDetail(item.entryId)}>查看日历提示详情</button>
    </article>)}
    <button type="button" className={button} disabled={disabled || !result.nextCursor} onClick={onNext}>下一页日历记录</button>
  </section>;
}

function Detail({ detail, disabled, onDirty, onBack, onCancel }: { detail: DetailView; disabled: boolean; onDirty: () => void; onBack: () => void; onCancel: (reason: string) => void }) {
  const [reason, setReason] = useState(""), [ack, setAck] = useState(false); const reasonValid = validText(reason, 200);
  return <article aria-label="日历提示详情" className="space-y-4 rounded-xl border border-blue-200 p-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-bold">{kindLabels[detail.kind]} · {detail.title}</h3><button type="button" className={button} onClick={onBack}>返回日期查询首页</button></div>
    <p>{detail.fromDate} → {detail.throughDate}（含首尾，共 {rangeDays(detail)} 天）<br/>{detail.locationName ?? "企业日历"} · {detail.timeZone}</p>
    <p className="break-words text-sm">创建原因：{detail.reason}</p>
    {detail.status === "cancelled" && <p className="break-words text-sm">取消原因：{detail.cancelReason}<br/>取消 UTC：{detail.cancelledAt}</p>}
    <p className="break-all text-xs text-slate-500">创建 UTC：{detail.createdAt} · 版本 {detail.revision}<br/>提示编号：{detail.entryId}</p>
    {detail.canCancel && <fieldset disabled={disabled} className="space-y-3 rounded-xl border border-slate-200 p-3"><legend className="font-semibold">取消当前提示</legend>
      <label className="block text-sm">取消原因（1～200 字，单行）<input aria-label="日历提示取消原因" className={input} maxLength={400} value={reason} onChange={event => { setReason(event.target.value); setAck(false); onDirty(); }}/></label>
      <label className="flex items-start gap-2 text-sm leading-6"><input type="checkbox" checked={ack} disabled={!reasonValid} onChange={event => { setAck(event.target.checked); onDirty(); }}/><span>我确认只取消这条提示并保留历史；不会取消排班、预约、请假或打卡。</span></label>
      <button type="button" className={button} disabled={!reasonValid || !ack} onClick={() => {
        if (window.confirm("确认取消这条日历提示并保留历史？其他业务记录不会改变。")) onCancel(reason.trim());
      }}>明确取消日历提示</button></fieldset>}
    {!detail.canCancel && <p className="text-sm text-slate-600">当前记录没有可执行操作；这里只读显示已保存提示及历史状态。</p>}
  </article>;
}

function validText(value: string, max: number) {
  const text = value.trim(); return [...text].length >= 1 && [...text].length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(text);
}
function rangeDays(range: Range) { return Math.round((Date.parse(`${range.throughDate}T00:00:00Z`) - Date.parse(`${range.fromDate}T00:00:00Z`)) / 86400000) + 1; }
