"use client";
import { LOCATION_DISPOSAL_NOTICE } from "@/lib/merchantAttendanceLocationDisposal";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AttendanceRetentionClient, retentionClientPendingKey } from "@/lib/merchantAttendanceRetentionClient";
import { RETENTION_CATEGORIES, RETENTION_MAX_DAYS, type RetentionCategory, type RetentionCommand, type RetentionPolicy, type RetentionQuery, type RetentionRecord } from "@/lib/merchantAttendanceRetentionContract";
import { readRetentionPeriods, readRetentionWorkers } from "@/lib/merchantAttendanceRetentionDirectory";
import type { AttendanceAdminWorker } from "@/lib/merchantAttendanceAdmin";
import type { PeriodClosureSummary } from "@/lib/merchantAttendancePeriodClosure";
import type { RetentionLauncherProps } from "./MerchantAttendanceRetentionLauncher";
import MerchantAttendanceRetentionPeriodsV2Picker from "./MerchantAttendanceRetentionPeriodsV2Picker";
import type { RetentionPeriodArtifactSelection } from "@/lib/merchantAttendanceRetentionPeriodsV2Client";
const button = "rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold disabled:opacity-40";
const input = "mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm disabled:bg-slate-50";
const box = "min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-4";
const labels: Record<RetentionCategory, string> = { events: "原始打卡记录", location_results: "定位摘要", period_artifact: "固定周期归档" };
const actions = { set_policy: "设置保留期限", hold: "登记保全", release: "解除保全" };
const hidden = () => typeof document !== "undefined" && document.hidden;
const utcDay = (value: string) => `${value}T00:00:00.000000Z`;
const followingDay = (value: string) => new Date(Date.parse(`${value}T00:00:00Z`) + 86400000).toISOString().replace(".000Z", ".000000Z");

// Revocation happens during render, before a delayed response or old event can
// use changed requester/scope props. An interrupted render only revokes authority.
/* eslint-disable react-hooks/refs */
function useDiscoveryScope(key: string, client: AttendanceRetentionClient) {
  const current = useRef({ key, client });
  if (current.current.key !== key || current.current.client !== client) current.current = { key, client };
  const scope = current.current;
  return useCallback(() => current.current === scope, [scope]);
}
/* eslint-enable react-hooks/refs */
type DiscoverySession = { siteId: string; actorId: string; workerId: string; fromDate: string; throughDate: string; isCurrentAuth: () => boolean };

function PolicyEditor({ policy, disabled, changed, submit }: { policy: RetentionPolicy; disabled: boolean; changed: () => void; submit: (days: number | null, reason: string) => void }) {
  const [days, setDays] = useState(policy.retentionDays === null ? "" : String(policy.retentionDays)), [reason, setReason] = useState("");
  return <form className="space-y-3" onSubmit={e => { e.preventDefault(); submit(days === "" ? null : Number(days), reason.trim()); }}>
    <p className="text-sm">当前：{policy.retentionDays === null ? "未配置期限" : `${policy.retentionDays} 天`} · 版本 {policy.revision}</p>
    <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">保留天数（留空为不设置）<input type="number" min={1} max={RETENTION_MAX_DAYS} step={1} className={input} value={days} onChange={e => { changed(); setDays(e.target.value); }}/></label>
      <label className="text-sm">设置理由<input className={input} required maxLength={500} value={reason} onChange={e => { changed(); setReason(e.target.value); }}/></label>
      <button type="submit" className={button} disabled={!reason.trim()}>保存试算期限</button>
    </fieldset>
    <p className="text-xs leading-5 text-slate-500">期限只用于到期试算，不是法定保留期限建议，也不会触发删除。修改后按新期限重新试算，历史设置保留。</p>
  </form>;
}
function RecordEditor({ record, disabled, changed, submit }: { record: RetentionRecord; disabled: boolean; changed: () => void; submit: (action: "hold" | "release", reason: string) => void }) {
  const [reason, setReason] = useState("");
  return <form className="space-y-3" onSubmit={e => { e.preventDefault(); submit(record.preservation.held ? "release" : "hold", reason.trim()); }}>
    <fieldset disabled={disabled} className="space-y-3"><label className="block text-sm">{record.preservation.held ? "解除" : "保全"}理由<input className={input} required maxLength={500} value={reason} onChange={e => { changed(); setReason(e.target.value); }}/></label>
      <button className={button} disabled={!reason.trim()}>{record.preservation.held ? "明确解除本条保全" : "登记本条资料保全"}</button></fieldset>
    <p className="text-xs leading-5 text-slate-500">只登记本条资料，不自动保全关联记录。解除保全不删除资料，不是删除许可。</p>
  </form>;
}
export default function MerchantAttendanceRetentionPanel(props: RetentionLauncherProps & { enabled: boolean; onClose: () => void }) {
  const { siteId, actorId, apiFetch, enabled, registerLeaveGuard, onClose } = props;
  const client = useMemo(() => new AttendanceRetentionClient({ siteId, actorId, apiFetch, enabled, storage: () => window.sessionStorage }), [siteId, actorId, apiFetch, enabled]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [category, setCategory] = useState<RetentionCategory>("events"), [recordId, setRecordId] = useState(""), [operationId, setOperationId] = useState("");
  const [workerId, setWorkerId] = useState(""), [periodId, setPeriodId] = useState(""), [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState(() => new Date().toISOString().slice(0, 10)), [throughDate, setThroughDate] = useState(fromDate);
  const [workers, setWorkers] = useState<AttendanceAdminWorker[]>([]), [cursor, setCursor] = useState<string | null>(null), [periods, setPeriods] = useState<PeriodClosureSummary[]>([]);
  const [directoryBusy, setDirectoryBusy] = useState(false), [note, setNote] = useState(""), [shown, setShown] = useState(true), [page, setPage] = useState(0);
  const dirty = useRef(false), directory = useRef<AbortController | null>(null), guard = useRef<() => boolean>(() => true);
  const periodsV2Enabled = props.periodsV2Enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_RETENTION_PERIODS_V2_ENABLED === "1";
  const [discovery, setDiscovery] = useState<DiscoverySession | null>(null);
  const discoveryGuard = useRef<(() => boolean) | null>(null), activeDiscovery = useRef<DiscoverySession | null>(null);
  const registerDiscoveryGuard = useCallback((value: (() => boolean) | null) => { discoveryGuard.current = value; }, []);
  const isDiscoveryScopeCurrent = useDiscoveryScope(JSON.stringify([siteId, actorId, workerId, fromDate, throughDate, enabled, periodsV2Enabled, props.active, props.disabled]), client);
  useLayoutEffect(() => {
    if (activeDiscovery.current && !activeDiscovery.current.isCurrentAuth()) {
      discoveryGuard.current?.(); activeDiscovery.current = null; setDiscovery(null);
    }
  }, [isDiscoveryScopeCurrent]);
  const clear = useCallback(() => { client.pause(); directory.current?.abort(); directory.current = null; setDirectoryBusy(false); dirty.current = false;
    discoveryGuard.current?.(); activeDiscovery.current = null; setDiscovery(null);
    setWorkers([]); setCursor(null); setPeriods([]); setWorkerId(""); setPeriodId(""); setRecordId(""); setOperationId(""); setSearch(""); setNote(""); setPage(0); }, [client]);
  const risk = useCallback(() => dirty.current || directory.current !== null || client.hasLeaveRisk(), [client]);
  useLayoutEffect(() => { guard.current = () => { const snapshot = client.getSnapshot(); if (risk() && !window.confirm("有未提交输入或待确认编号。关闭后原编号保留，但输入和当前显示会清除，继续？")) return false;
    if (client.getSnapshot() !== snapshot || discoveryGuard.current?.() === false) return false; clear(); return true; }; registerLeaveGuard?.(() => guard.current());
    return () => { registerLeaveGuard?.(null); client.pause(); directory.current?.abort(); }; }, [client, clear, registerLeaveGuard, risk]);
  useEffect(() => { const visibility = () => { clear(); setShown(!hidden()); if (!hidden()) void client.initialize(); }, hide = () => { clear(); setShown(false); }, unload = (e: BeforeUnloadEvent) => { if (risk()) { e.preventDefault(); e.returnValue = ""; } };
    if (hidden()) { clear(); setShown(false); } else { void client.initialize(); }
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hide); window.addEventListener("pageshow", visibility); window.addEventListener("beforeunload", unload);
    return () => { client.pause(); directory.current?.abort(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", visibility); window.removeEventListener("beforeunload", unload); };
  }, [client, clear, risk]);
  const busy = directoryBusy || state.phase === "saving" || state.phase === "loading", pending = !!state.pending;
  const visible = shown && !hidden(), result = visible ? state.result : null;
  function discoveryAllowed() {
    const snapshot = client.getSnapshot();
    if (!enabled || !periodsV2Enabled || props.active === false || props.disabled || !isDiscoveryScopeCurrent()
      || hidden() || !shown || dirty.current || directory.current || snapshot.pending || ["loading", "saving"].includes(snapshot.phase)) return false;
    // Another tab or an unresolved raw storage entry is also a blocker. Never
    // discard or repair an old intent just to enter this read-only picker.
    try { return sessionStorage.getItem(retentionClientPendingKey(siteId, actorId)) === null; } catch { return false; }
  }
  function openDiscovery() {
    if (!workerId || activeDiscovery.current || !discoveryAllowed()) { setNote("请先处理未保存输入、读取请求或待确认操作，再查找长期周期归档。"); return; }
    const session: DiscoverySession = { siteId, actorId, workerId, fromDate, throughDate,
      isCurrentAuth: () => activeDiscovery.current === session && discoveryAllowed() };
    client.pause(); setNote(""); activeDiscovery.current = session; setDiscovery(session);
  }
  function closeDiscovery() { discoveryGuard.current?.(); activeDiscovery.current = null; setDiscovery(null); }
  function selectDiscovery(selection: RetentionPeriodArtifactSelection) {
    const session = activeDiscovery.current;
    if (!session || !session.isCurrentAuth() || selection.siteId !== siteId || selection.actorId !== actorId || selection.workerId !== workerId) return;
    closeDiscovery(); setCategory("period_artifact"); setRecordId(selection.artifactId); setPage(0); setNote("");
    // The selection is only a locator. The existing fresh record GET supplies
    // its own preservation CAS/source and current write permission.
    void client.load({ siteId, mode: "record", category: "period_artifact", recordId: selection.artifactId });
  }
  function beginRead() { const snapshot = client.getSnapshot(); if (hidden() || directory.current || ["loading", "saving"].includes(snapshot.phase)) return false;
    if (dirty.current && !window.confirm("读取新资料会清除未提交的保留设置或理由，继续？")) return false;
    if (snapshot !== client.getSnapshot() || hidden()) return false; dirty.current = false; client.pause(); setNote(""); setPage(0); return true; }
  function load(query: RetentionQuery) { if (pending || !beginRead()) return; void client.load(query); }
  function changeQuery(run: () => void) { if (busy || pending || !beginRead()) return; run(); }
  async function directoryRead(kind: "workers" | "periods", next: string | null = null) {
    if (pending || !beginRead()) return; const controller = new AbortController(); directory.current = controller; setDirectoryBusy(true);
    if (kind === "workers") { setWorkers([]); setCursor(null); setWorkerId(""); setPeriods([]); setPeriodId(""); } else { setPeriods([]); setPeriodId(""); }
    try { if (kind === "workers") { const data = await readRetentionWorkers(apiFetch, siteId, controller.signal, search, next);
        if (directory.current === controller && !controller.signal.aborted && !hidden()) { setWorkers(data.items); setCursor(data.nextCursor); } }
      else { const data = await readRetentionPeriods(apiFetch, siteId, actorId, workerId, fromDate, throughDate, controller.signal);
        if (directory.current === controller && !controller.signal.aborted && !hidden()) setPeriods(data); }
    } catch { if (directory.current === controller && !hidden()) setNote("未能读取选择列表。未提交任何操作；仍可用已有记录编号查询历史资料。"); }
    finally { if (directory.current === controller) { directory.current = null; setDirectoryBusy(false); } }
  }
  function submit(command: RetentionCommand) { const snapshot = client.getSnapshot(); if (!visible || busy || pending || !enabled || !snapshot.canWrite) return;
    if (!window.confirm(`${actions[command.action]}？仅保存保留／保全元数据，不删除或改写原始资料。`)) return;
    if (snapshot !== client.getSnapshot() || hidden()) return; dirty.current = false; setNote(""); void client.submit(command); }
  function preview() { try { load(category === "period_artifact" ? { siteId, mode: "preview", category, workerId, periodId }
      : { siteId, mode: "preview", category, workerId, fromAt: utcDay(fromDate), toAt: followingDay(throughDate) }); }
    catch { setNote("请选择有效日期；起止日期最多31天。"); } }
  const policies = result?.data.kind === "policies" ? result.data.items : [], policy = policies.find(p => p.category === category);
  const record = result?.data.kind === "record" ? result.data.item : null, previewRows = result?.data.kind === "preview" ? result.data.items : [];
  const editable = enabled && state.canWrite && !busy && !pending && visible;
  if (discovery) return <MerchantAttendanceRetentionPeriodsV2Picker {...discovery} enabled={enabled && periodsV2Enabled} apiFetch={apiFetch}
    onSelect={selectDiscovery} onClose={closeDiscovery} registerLeaveGuard={registerDiscoveryGuard}/>;
  return <section aria-label="考勤资料保留工作区" className="min-w-0 space-y-4 p-4 sm:p-6">
    <header className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-bold">资料保留与单条保全</h2><p className="mt-1 text-sm text-slate-500">当前商户负责人 · 元数据登记与到期试算</p></div><button className={button} onClick={() => { if (guard.current()) onClose(); }}>关闭</button></header>
    <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6">这里不会删除、脱敏或改写打卡、定位摘要及固定归档，不会改变工时或工资。到期仅表示按所设天数计算达到期限，不代表可删除。保全只针对明确选择的单条资料，关联记录需另行处理。</p>
    {!enabled && <p className="text-sm">新设置与保全写入未开放；仍可核对当前身份的待确认原编号。</p>}
    <p role="status" aria-live="polite" className="rounded-xl bg-slate-50 p-3 text-sm">{note || state.message}</p>
    {!visible ? <p>页面隐藏时已清除资料和未提交输入；返回后请明确重新读取。</p> : <>
      {state.pending && <div className="space-y-2 rounded-xl border border-amber-300 p-4"><p className="break-all text-sm">待确认操作：{state.pending.command.operationId}</p><p className="text-sm">没有回执不代表失败，不会自动重发或生成新编号。</p>
        <button className={button} disabled={busy} onClick={() => { if (beginRead()) void client.recover(); }}>读取原编号回执</button>
        {state.canEndRejectedAttempt && <button className={button} disabled={busy} onClick={() => { const s = client.getSnapshot(); if (window.confirm("仅结束这次服务器已明确拒绝的本地尝试？不撤销历史操作。") && s === client.getSnapshot() && !hidden()) void client.endRejectedAttempt(); }}>结束已明确拒绝的尝试</button>}
      </div>}
      <fieldset disabled={busy || pending} className="grid min-w-0 gap-3 sm:grid-cols-2"><label className="text-sm">资料类别<select className={input} value={category} onChange={e => changeQuery(() => { setCategory(e.target.value as RetentionCategory); setRecordId(""); })}>{RETENTION_CATEGORIES.map(c => <option key={c} value={c}>{labels[c]}</option>)}</select></label>
        <div className="flex flex-wrap items-end gap-2"><button className={button} onClick={() => load({ siteId, mode: "policies" })}>读取保留设置</button><button className={button} onClick={() => load({ siteId, mode: "history", category, recordId: null, beforeRevision: null })}>设置历史</button></div></fieldset>
      {policy && <section className={box}><h3 className="font-bold">{labels[category]} · 试算期限</h3><PolicyEditor key={`${result!.readAt}:${category}`} policy={policy} disabled={!editable} changed={() => { dirty.current = true; }} submit={(days, reason) => submit({ siteId, category, operationId: crypto.randomUUID(), action: "set_policy", expectedRevision: policy.revision, retentionDays: days, reason })}/></section>}
      <section className={box}><h3 className="font-bold">按人员和范围试算</h3><p className="text-xs leading-5 text-slate-500">原始记录和定位摘要按原事件发生时间选择，日期以UTC计、含结束日，最多31天／100条；超量需缩小范围。期限起算使用接收时间，归档使用保存时间。</p>
        <fieldset disabled={busy || pending} className="grid gap-3 sm:grid-cols-2"><label className="text-sm">查找考勤人员<input className={input} maxLength={80} value={search} onChange={e => changeQuery(() => { setSearch(e.target.value); setWorkers([]); setCursor(null); setWorkerId(""); setPeriods([]); setPeriodId(""); })}/></label>
          <div className="flex flex-wrap items-end gap-2"><button className={button} onClick={() => void directoryRead("workers")}>读取人员</button>{cursor && <button className={button} onClick={() => void directoryRead("workers", cursor)}>下一页人员</button>}</div>
          <label className="text-sm">选择人员<select className={input} value={workerId} onChange={e => changeQuery(() => { setWorkerId(e.target.value); setPeriods([]); setPeriodId(""); })}><option value="">请选择</option>{workers.map(w => <option value={w.id} key={w.id}>{w.workerNo} · {w.displayName}{w.active ? "" : "（已停用）"}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-2"><label className="text-sm">UTC起日<input type="date" className={input} value={fromDate} onChange={e => changeQuery(() => { setFromDate(e.target.value); setPeriods([]); setPeriodId(""); })}/></label><label className="text-sm">UTC结束日<input type="date" className={input} value={throughDate} onChange={e => changeQuery(() => { setThroughDate(e.target.value); setPeriods([]); setPeriodId(""); })}/></label></div>
          {category === "period_artifact" && <><button className={button} disabled={!workerId} onClick={() => void directoryRead("periods")}>读取相同起止日期的已有周期</button><label className="text-sm">选择固定归档所属周期<select className={input} value={periodId} onChange={e => changeQuery(() => setPeriodId(e.target.value))}><option value="">请选择周期</option>{periods.map(p => <option key={p.periodId} value={p.periodId}>{p.fromDate}～{p.throughDate} · 版本{p.currentVersion}</option>)}</select></label></>}
          <button className={button} disabled={!workerId || category === "period_artifact" && !periodId} onClick={preview}>只读试算</button>
          {category === "period_artifact" && periodsV2Enabled && <button type="button" className={button} disabled={!enabled || !workerId} onClick={openDiscovery}>按长期周期／版本查找归档</button>}
        </fieldset>
        {result?.data.kind === "preview" && <><p className="text-sm">本次 {previewRows.length} 条 · 试算时刻 {result.data.asOf} · 不执行删除</p><div className="space-y-2">{previewRows.slice(page * 10, page * 10 + 10).map(row => <button key={row.recordId} disabled={busy || pending} className={`${button} w-full break-all text-left`} onClick={() => load({ siteId, mode: "record", category: row.category, recordId: row.recordId })}><span className="block">{row.ageState === "due" ? "已到期（仅试算）" : row.ageState === "not_due" ? "未到期" : "未配置期限"} · {row.preservation.held ? "已保全" : "未保全"}</span><span className="mt-1 block text-xs">{row.recordId}</span></button>)}</div>
          {previewRows.length > 10 && <div className="flex gap-2"><button className={button} disabled={page === 0} onClick={() => setPage(p => p - 1)}>上一页结果</button><button className={button} disabled={(page + 1) * 10 >= previewRows.length} onClick={() => setPage(p => p + 1)}>下一页结果</button></div>}</>}
      </section>
      <section className={box}><h3 className="font-bold">按已有编号核对历史资料</h3><fieldset disabled={busy || pending} className="flex min-w-0 flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-sm">{category === "period_artifact" ? "归档编号（不是周期编号）" : "原始事件编号"}<input className={input} value={recordId} maxLength={36} onChange={e => changeQuery(() => setRecordId(e.target.value))}/></label><button className={button} disabled={!recordId} onClick={() => load({ siteId, mode: "record", category, recordId })}>读取本条资料</button><button className={button} disabled={!recordId} onClick={() => load({ siteId, mode: "history", category, recordId, beforeRevision: null })}>本条保全历史</button></fieldset>
        <p className="text-xs leading-5 text-slate-500">可核对离职、换绑或负责人交接前的本商户保存资料；不把当前人员绑定补写为历史身份。</p></section>
      {record && <section className={box}><h3 className="font-bold">{labels[record.category]} · 当前保存事实</h3><dl className="grid gap-2 break-all text-sm sm:grid-cols-2"><div><dt>资料编号</dt><dd>{record.recordId}</dd></div><div><dt>起算时间</dt><dd>{record.anchorAt}</dd></div><div><dt>试算到期时间</dt><dd>{record.dueAt ?? "未设置"}</dd></div><div><dt>状态</dt><dd>{record.ageState === "due" ? "已到期（仅试算）" : record.ageState === "not_due" ? "未到期" : "未配置期限"} · {record.preservation.held ? "已保全" : "未保全"} · 版本{record.preservation.revision}</dd></div></dl>
        {record.source.kind === "location_summary" && record.source.disposal && <p data-location-disposed className="text-sm">{LOCATION_DISPOSAL_NOTICE}</p>}
        {record.preservation.reason && <p className="break-words text-sm">最近保全理由：{record.preservation.reason}</p>}
        <RecordEditor key={`${result!.readAt}:${record.recordId}`} record={record} disabled={!editable} changed={() => { dirty.current = true; }} submit={(action, reason) => submit({ siteId, category: record.category, recordId: record.recordId, operationId: crypto.randomUUID(), action, expectedRevision: record.preservation.revision, expectedSourceFingerprint: record.sourceFingerprint, reason })}/>
        <button className={button} disabled={busy || pending} onClick={() => load({ siteId, mode: "history", category: record.category, recordId: record.recordId, beforeRevision: null })}>读取此条保全历史</button></section>}
      {result?.data.kind === "history" && <section className={box}><h3 className="font-bold">历史登记（旧版本不代表当前状态）</h3>{result.data.items.length === 0 && <p className="text-sm">暂无历史登记。</p>}{result.data.items.map(item => <article key={item.operationId} className="space-y-1 rounded-xl bg-slate-50 p-3 text-sm"><p>版本{item.revision} · {actions[item.command.action]} · {item.recordedAt}</p><p className="break-words">理由：{item.command.reason}</p><p className="break-all text-xs">操作人：{item.actorId} · 编号：{item.operationId}</p></article>)}
        {result.data.nextBeforeRevision !== null && state.query?.mode === "history" && <button className={button} disabled={busy || pending} onClick={() => { if (state.query?.mode === "history" && result.data.kind === "history") load({ ...state.query, beforeRevision: result.data.nextBeforeRevision }); }}>下一页历史</button>}</section>}
      {result?.data.kind === "receipt" && <section className={box}><h3 className="font-bold">原操作核对</h3>{result.receipt ? <><p className="text-sm">已核对保存回执：{actions[result.receipt.command.action]} · 版本{result.receipt.revision}</p><p className="break-all text-xs">{result.receipt.operationId}</p><p className="text-sm">这是原操作结果；当前状态请明确重新读取。</p></> : <p className="text-sm">当前未查到回执，不能据此认定操作失败或再次提交。</p>}</section>}
      <section className={box}><h3 className="font-bold">其他已知操作编号</h3><fieldset disabled={busy || pending} className="flex min-w-0 flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-sm">本商户当前身份的操作编号<input className={input} value={operationId} maxLength={36} onChange={e => changeQuery(() => setOperationId(e.target.value))}/></label><button className={button} disabled={!operationId} onClick={() => load({ siteId, mode: "recover", operationId })}>只读核对原编号</button></fieldset></section>
    </>}
  </section>;
}
