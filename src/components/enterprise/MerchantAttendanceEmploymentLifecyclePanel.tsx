"use client";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AttendanceEmploymentLifecycleClient } from "@/lib/merchantAttendanceEmploymentLifecycleClient";
import type { EmploymentLifecycleCommand, EmploymentLifecycleDetail, EmploymentLifecycleReceipt, EmploymentLifecycleWorker } from "@/lib/merchantAttendanceEmploymentLifecycle";
import { employmentLifecycleOperatingOff } from "@/lib/merchantAttendanceEmploymentLifecycle";
import type { EmploymentLifecyclePanelProps } from "./MerchantAttendanceEmploymentLifecycleLauncher";

type Props = EmploymentLifecyclePanelProps & { onClose: () => void };
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40";
const blockNames: Record<string, string> = { binding_changed: "员工、Auth 或考勤人员身份已变化", not_paused: "需先有同身份且仍有效的考勤暂停",
  worker_active: "考勤人员仍启用", state_binding_changed: "末条原始事件已变化或归属无法核验", open_session: "原始班次尚未下班（含休息中），本页不能代收班",
  history_limit: "任职历史超过本次安全上限", history_uncontrolled: "历史任职链未满足受控条件", employment_closed: "当前任职期已结束",
  employment_open: "仍有未结束任职期", date_not_after_end: "办理日必须晚于上一任职结束日，不能同日再入职", date_out_of_range: "办理日期超出支持范围",
  pending_items: "存在尚未结束的排班或待审／已批准申请", pending_limit: "相关事项超过本次安全上限，不能视为空" };
const kindNames = { schedule: "排班", leave: "请假", trip: "出差", field: "外勤", remote: "远程" };
const statusNames = { published: "已发布", submitted: "待审", approved: "已批准" };
const stateNames = { untracked: "尚无受控任职操作", closed: "已正式结束任职期", rejoined: "已新增再入职期" };
const actionNames = { clock_in: "在班", break_start: "休息中", break_end: "休息后在班", clock_out: "已下班" };
export const employmentLifecycleReasonValid = (value: string) => value === value.trim() && [...value].length >= 1 && [...value].length <= 500 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
export const employmentLifecycleReady = (d: EmploymentLifecycleDetail, action: EmploymentLifecycleCommand["action"], reason: string, confirmed: boolean, disabled = false) =>
  !disabled && confirmed && employmentLifecycleReasonValid(reason) && !!d.suspension?.paused && !d.worker.active
  && !!d.worker.employeeId && !!d.worker.employeeAuthUserId && d.worker.employeeVersion !== null && d.periods.length > 0
  && !d.pending.limited && !d.pending.items.length && employmentLifecycleOperatingOff(d)
  && (action === "close" ? d.canClose && !d.closeBlockers.length : d.canRejoin && !d.rejoinBlockers.length);
export function confirmEmploymentLifecycle(confirm: () => boolean, current: () => boolean, submit: () => void) {
  if (!current() || !confirm() || !current()) return false; submit(); return true;
}
export default function MerchantAttendanceEmploymentLifecyclePanel(props: Props) {
  return <Prepared key={`${props.siteId}:${props.ownerId}:${props.workerId ?? "all"}`} {...props}/>;
}
function Prepared(props: Props) {
  const { siteId, ownerId, apiFetch } = props, enabled = props.enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_EMPLOYMENT_LIFECYCLE_ENABLED === "1";
  /* eslint-disable react-hooks/refs -- synchronous scope gate, never rendered authority */
  const scope = useRef({ siteId, ownerId, apiFetch, enabled }); scope.current = { siteId, ownerId, apiFetch, enabled };
  const client = useMemo(() => { try { return new AttendanceEmploymentLifecycleClient({ siteId, actorId: ownerId, apiFetch, enabled, storage: () => sessionStorage,
    isCurrentAuth: () => scope.current.siteId === siteId && scope.current.ownerId === ownerId && scope.current.apiFetch === apiFetch && scope.current.enabled === enabled }); } catch { return null; } }, [siteId, ownerId, apiFetch, enabled]);
  /* eslint-enable react-hooks/refs */
  return client ? <Screen {...props} enabled={enabled} client={client}/> : <section aria-label="任职结束与再入职" className="p-4"><p role="alert">当前负责人身份无法核验，未读取或提交。</p><button className={button} onClick={props.onClose}>关闭任职核验</button></section>;
}
function Screen({ client, workerId = null, enabled, onClose, registerLeaveGuard }: Props & { enabled: boolean; client: AttendanceEmploymentLifecycleClient }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot), [shown, setShown] = useState(false), [formEpoch, setFormEpoch] = useState(0);
  const dirty = useRef(false), epoch = useRef(0);
  const clear = useCallback(() => { dirty.current = false; setFormEpoch(value => value + 1); }, []);
  const leave = useCallback(() => { const generation = epoch.current;
    return (!(dirty.current || client.hasLeaveRisk()) || window.confirm("离开会清除未提交的任职理由。已发送操作不会撤销，未知原编号仍会保留；继续吗？")) && generation === epoch.current;
  }, [client]);
  useLayoutEffect(() => { registerLeaveGuard?.(leave); return () => registerLeaveGuard?.(null); }, [registerLeaveGuard, leave]);
  useLayoutEffect(() => {
    const hide = () => { epoch.current++; setShown(false); clear(); client.pause(); };
    const show = () => { epoch.current++; clear(); void client.initialize(); setShown(true); };
    const visibility = () => { if (document.hidden) hide(); else show(); };
    const unload = (event: BeforeUnloadEvent) => { if (dirty.current || client.hasLeaveRisk()) { event.preventDefault(); event.returnValue = ""; } };
    visibility(); document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hide); window.addEventListener("pageshow", show); window.addEventListener("beforeunload", unload);
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- invalidate the mounted client lifetime
      epoch.current++; client.pause(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); window.removeEventListener("beforeunload", unload);
    };
  }, [client, clear]);
  const result = shown ? state.result : null, pending = shown ? state.pending : null, busy = state.phase === "loading" || state.phase === "saving";
  const read = (run: () => void) => { const generation = epoch.current;
    if (!shown || document.hidden || busy || dirty.current && !window.confirm("读取资料会清除未提交的任职理由，继续吗？")) return;
    if (generation !== epoch.current || document.hidden) return; epoch.current++; clear(); run(); };
  const submit = (action: EmploymentLifecycleCommand["action"], reason: string) => { const generation = epoch.current, snapshot = client.getSnapshot();
    confirmEmploymentLifecycle(() => window.confirm(action === "close"
      ? "确认仅按服务器显示的企业当天结束当前任职期？本页不补下班、不取消申请、不恢复账号、考勤、PIN 或委托。"
      : "确认按服务器显示的企业当天新增同一身份任职期？不会恢复账号、解除考勤暂停、设置 PIN 或授予委托。"),
    () => shown && !document.hidden && enabled && !busy && !pending && !!result?.detail && epoch.current === generation && client.getSnapshot() === snapshot
      && employmentLifecycleReady(result.detail, action, reason, true),
    () => { epoch.current++; clear(); void client.submit(action, reason); }); };
  return <section aria-label="任职结束与再入职" data-employment-lifecycle className="min-w-0 space-y-4 p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><h2 className="text-xl font-bold">任职结束／再入职</h2><button type="button" className={button} onClick={() => { if (leave()) { client.pause(); onClose(); } }}>关闭任职核验</button></header>
    <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6">仅商户负责人办理同一考勤人员、员工与 Auth 的任职区间。只支持办理当天；不是劳动合同终止或工资结算，不追溯、不预约、不允许同日再入职。</p>
    <p className="text-sm leading-6">先由原流程停用并暂停，再核验任职。新增任职期不恢复账号或考勤，也不恢复旧 PIN／委托；这些都须分别明确处理。原先未启用考勤者不会因此启用。</p>
    {!enabled && <p role="note" className="rounded-xl bg-slate-100 p-3 text-sm">新任职操作已关闭；可核对原编号和读取已有资料，不会降级改用旧写入。</p>}
    <p role="status" className="break-words rounded-xl bg-blue-50 p-3 text-sm">{state.message}</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!shown || busy || !!pending} onClick={() => read(() => { void client.load(workerId); })}>
      {workerId ? "读取该人员任职依据" : "读取任职人员列表"}</button>
      {pending && <button type="button" className={button} disabled={!shown || busy} onClick={() => read(() => { void client.recover(); })}>核对原任职编号</button>}</div>
    {pending && <div data-employment-lifecycle-pending className="rounded-xl bg-amber-50 p-3 text-sm"><p>结果待确认，不重新提交；真实任职和打卡资格以服务端核验为准，请保留本标签页原编号。</p><p className="break-all">原操作编号：{pending.command.operationId}</p></div>}
    {result?.receipt && <><EmploymentLifecycleReceiptView receipt={result.receipt}/><button type="button" className={button} disabled={busy || !!pending}
      onClick={() => read(() => { void client.load(result.receipt!.workerId); })}>读取该人员当前任职</button></>}
    {result?.detail && <><EmploymentLifecycleDetailView key={`${result.detail.worker.id}:${formEpoch}`} detail={result.detail} disabled={!shown || !enabled || busy || !!pending}
      onDirty={() => { epoch.current++; dirty.current = true; }} onSubmit={submit}/>
      <button type="button" className={button} disabled={busy || !!pending} onClick={() => read(() => { void client.history(result.detail!.worker.id); })}>读取任职操作历史</button></>}
    {result?.mode === "list" && <section aria-label="任职人员列表" className="space-y-3"><p className="text-sm">每页最多 25 人；不自动扫描全部人员。</p>
      {!result.items.length && <p>本页没有人员；不代表其他页或历史没有记录。</p>}
      {result.items.map(item => <article key={item.worker.id} data-employment-worker={item.worker.id} className="min-w-0 space-y-2 rounded-xl border p-3"><EmploymentLifecycleWorkerView worker={item.worker}/>
        <p className="text-sm">{stateNames[item.state]} · 生命周期版本 {item.revision}</p><p className="text-sm">{item.period ? `${item.period.startsOn} 至 ${item.period.endsOn ?? "尚未结束"}` : "未读到可显示的任职期"}</p>
        <button type="button" className={button} disabled={busy || !!pending} onClick={() => read(() => { void client.load(item.worker.id); })}>核验此人员任职</button></article>)}
      {result.nextAfterId && <button type="button" className={button} disabled={busy || !!pending} onClick={() => read(() => { void client.next(); })}>下一页任职人员</button>}
    </section>}
    {result?.mode === "history" && <section aria-label="任职操作历史" className="space-y-3"><p className="text-sm">每页最多 25 条，按保存版本递增。以下仅为历史回执，不代表当前任职或恢复权限。</p>
      {!result.history.length && <p>本页没有任职操作。</p>}{result.history.map(receipt => <EmploymentLifecycleReceiptView key={receipt.operationId} receipt={receipt}/>)}
      <div className="flex flex-wrap gap-2">{state.query?.workerId && <button type="button" className={button} disabled={busy || !!pending} onClick={() => read(() => { void client.load(state.query!.workerId); })}>重新核验该人员</button>}
        {result.nextAfterRevision !== null && <button type="button" className={button} disabled={busy || !!pending} onClick={() => read(() => { void client.nextHistory(); })}>下一页任职历史</button>}</div>
    </section>}
  </section>;
}
export function EmploymentLifecycleWorkerView({ worker: w }: { worker: EmploymentLifecycleWorker }) {
  return <div className="min-w-0 text-sm"><p className="break-words font-semibold">{w.displayName} · 工号 {w.workerNo}</p><p>员工 {w.employeeName ?? "未核验"} · 考勤{w.active ? "启用" : "未启用"}</p>
    <details className="break-all"><summary>核对同一人员与双身份</summary><p>考勤人员 {w.id}<br/>员工 {w.employeeId ?? "未绑定"}<br/>Auth {w.employeeAuthUserId ?? "未绑定"}</p></details></div>;
}
export function EmploymentLifecycleDetailView({ detail: d, disabled = false, onDirty = () => {}, onSubmit = () => {} }: {
  detail: EmploymentLifecycleDetail; disabled?: boolean; onDirty?: () => void; onSubmit?: (action: EmploymentLifecycleCommand["action"], reason: string) => void;
}) {
  const [reason, setReason] = useState(""), [confirmed, setConfirmed] = useState(false), action = d.canRejoin ? "rejoin" : "close";
  return <article data-employment-lifecycle-detail className="min-w-0 space-y-3 rounded-xl border p-3 text-sm"><EmploymentLifecycleWorkerView worker={d.worker}/>
    <p>{stateNames[d.state]} · 生命周期版本 {d.revision}</p><p>服务器办理日 <strong>{d.today}</strong> · 企业时区 {d.timeZone}</p><p className="break-all">本次读取 UTC {d.readAt}</p>
    <p>人员版本 {d.worker.version} · 员工版本 {d.worker.employeeVersion ?? "未核验"} · 设置版本 {d.settingsVersion}。跨午夜或版本变化须重新读取。</p>
    <p>暂停：{d.suspension?.paused ? `仍暂停，代际 ${d.suspension.generation}` : "无可用的当前暂停"}；暂停前考勤{d.suspension?.wasActive === false ? "原本未启用，后续恢复也保持未启用" : d.suspension ? "原为启用" : "未核验"}。</p>
    <p>暂停时原始状态：{d.originalAction === null ? "没有原始事件" : actionNames[d.originalAction]}；当前原始状态：{d.currentAction === null ? "没有原始事件" : actionNames[d.currentAction]}。本页不改变事件或序列。</p>
    {d.administrativeBoundary && <p className="rounded-xl bg-amber-50 p-3" role="status">该原始班次已行政关闭，可以继续核验任职办理条件；未补造下班，工时仍待核定。核验边界 UTC {d.administrativeBoundary.verifiedEndAt}，不作为工时终点。</p>}
    <section aria-label="已保存任职期" className="space-y-2"><h3 className="font-semibold">已保存任职期</h3>{!d.periods.length && <p>未找到可核验任职期。</p>}
      <ol className="space-y-1">{d.periods.map(period => <li key={period.id} className="break-words">{period.startsOn} 至 {period.endsOn ?? "尚未结束"}（结束日包含当天）</li>)}</ol></section>
    <section aria-label="尚未结束的事项" className="space-y-2 rounded-xl bg-amber-50 p-3"><h3 className="font-semibold">未来或进行中的事项</h3>
      {d.pending.limited ? <p role="alert">相关事项超过安全读取上限，清单未展示；不能视为没有阻断，请先在原业务入口逐项核查。</p>
        : d.pending.items.length ? <ul className="space-y-2">{d.pending.items.map(item => <li key={`${item.kind}:${item.id}`} className="break-all">{kindNames[item.kind]} · {statusNames[item.status]}<br/>
          UTC {item.startAt} 至 {item.endAt}<br/>事项时区 {item.timeZone}<br/>原事项编号 {item.id}</li>)}</ul> : <p>本次未读到尚未结束的排班或待审／已批准申请；不等于全部历史已处理。</p>}
      <p>已过去的历史待审未统计，仍按原身份保留；不是 0。其他浏览器的未知编号不可观察。</p>
      <p>请关闭本工作区，回到同一负责人考勤配置中的原排班、请假或出差／外勤／远程入口，按原权限显式处置后重读。本页不会自动取消、拒绝、补下班；原流程不允许处置时仍保持阻断。</p>
    </section>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><section aria-label="任职结束阻断"><h3 className="font-semibold">当日结束资格</h3>
      {d.closeBlockers.length ? <ul className="list-inside list-disc">{d.closeBlockers.map(code => <li key={code}>{blockNames[code] ?? code}</li>)}</ul> : <p>本次读取满足结束条件，提交仍须重新核验。</p>}</section>
      <section aria-label="再入职阻断"><h3 className="font-semibold">当日再入职资格</h3>{d.rejoinBlockers.length ? <ul className="list-inside list-disc">{d.rejoinBlockers.map(code => <li key={code}>{blockNames[code] ?? code}</li>)}</ul> : <p>本次读取满足新增期条件，提交仍须重新核验。</p>}</section></div>
    {(d.canClose || d.canRejoin) && <div className="space-y-3"><label className="block">任职办理理由<textarea aria-label="任职办理理由" className="mt-1 w-full min-w-0 rounded-xl border p-2" rows={3} maxLength={500} disabled={disabled} value={reason}
      onChange={event => { onDirty(); setReason(event.target.value); setConfirmed(false); }}/></label>
      <label className="flex items-start gap-2"><input type="checkbox" aria-label="确认同身份与办理日期" disabled={disabled || !employmentLifecycleReasonValid(reason)} checked={confirmed}
        onChange={event => { onDirty(); setConfirmed(event.target.checked); }}/><span>已核对同一员工、Auth、考勤人员和版本；明确按 {d.timeZone} 的 {d.today} {action === "close" ? "结束当前任职期" : "新增任职期"}。不改变历史工时、归档，不自动恢复其他权限。</span></label>
      <button type="button" className={button} disabled={!employmentLifecycleReady(d, action, reason, confirmed, disabled)} onClick={() => { if (employmentLifecycleReady(d, action, reason, confirmed, disabled)) onSubmit(action, reason); }}>
        {action === "close" ? "明确结束当日任职" : "明确新增当日任职期"}</button></div>}
  </article>;
}
export function EmploymentLifecycleReceiptView({ receipt: r }: { receipt: EmploymentLifecycleReceipt }) {
  return <section data-employment-lifecycle-receipt={r.action} className="min-w-0 space-y-2 rounded-xl bg-emerald-50 p-3 text-sm"><h3 className="font-semibold">{r.action === "close" ? "原任职结束操作已确认" : "原再入职操作已确认"}</h3>
    <p>保存任职期：{r.startsOn} 至 {r.endsOn ?? "未结束"} · 生命周期版本 {r.revision}</p><p className="break-all">原操作编号 {r.operationId}<br/>真实操作者 {r.actorId}<br/>UTC {r.recordedAt}</p>
    <p>这是保存的原操作回执，不证明当前任职状态或打卡资格。账号、考勤暂停、PIN、委托仍是独立结果；没有自动恢复其中任何一项。</p></section>;
}
