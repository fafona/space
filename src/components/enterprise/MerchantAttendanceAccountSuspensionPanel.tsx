"use client";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AttendanceAccountSuspensionClient } from "@/lib/merchantAttendanceAccountSuspensionClient";
import type { AccountSuspensionDetail, AccountSuspensionItem, AccountSuspensionReceipt, AccountStatusReceipt } from "@/lib/merchantAttendanceAccountSuspension";
import type { AccountSuspensionPanelProps } from "./MerchantAttendanceAccountSuspensionLauncher";

const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40";
type Props = AccountSuspensionPanelProps & { onClose: () => void };
const blockers: Record<string, string> = { already_restored: "此暂停已解除", binding_changed: "员工或登录身份已变化", employee_inactive: "企业账号尚未恢复",
  role_invalid: "当前角色权限不足", location_invalid: "当前地点无效", employment_invalid: "当前任职日期不允许", employment_closed: "任职已结束或当前任职依据不可用；需核验同身份有效任职后再明确恢复", settings_disabled: "企业考勤尚未启用",
  worker_missing: "原考勤人员不存在", state_binding_changed: "原在班身份不匹配" };
const actionNames: Record<string, string> = { clock_in: "上班中", break_start: "休息中", break_end: "休息后在班", clock_out: "已下班" };
const employeeStatusNames: Record<string, string> = { active: "已恢复／启用", disabled: "已停用", invited: "尚未接受邀请" };
const actionName = (action: string | null) => actionNames[action ?? ""] ?? "没有原始事件";
export const accountSuspensionReasonValid = (reason: string) => reason === reason.trim() && [...reason].length >= 1 && [...reason].length <= 500 && !/[\u0000-\u001f\u007f-\u009f]/.test(reason);
export const accountSuspensionRestoreReady = (detail: AccountSuspensionDetail, reason: string, confirmed: boolean, disabled = false) =>
  !disabled && detail.canRestore && !detail.blockers.length && confirmed && accountSuspensionReasonValid(reason);
export function confirmAccountSuspensionRestore(confirm: () => boolean, current: () => boolean, submit: () => void) {
  if (!current() || !confirm() || !current()) return false; submit(); return true;
}
export default function MerchantAttendanceAccountSuspensionPanel(props: Props) {
  return <Prepared key={`${props.siteId}:${props.ownerId}`} {...props}/>;
}
function Prepared(props: Props) {
  const { siteId, ownerId, apiFetch } = props;
  // The controller consults this gate only during asynchronous work. Invalidate
  // the old scope synchronously, before a later response can clear its pending.
  /* eslint-disable react-hooks/refs -- this ref is an authorization gate, never rendered UI */
  const scope = useRef({ siteId, ownerId, apiFetch }); scope.current = { siteId, ownerId, apiFetch };
  const client = useMemo(() => { try { return new AttendanceAccountSuspensionClient({ siteId, actorId: ownerId, apiFetch, storage: () => sessionStorage,
    isCurrentAuth: () => scope.current.siteId === siteId && scope.current.ownerId === ownerId && scope.current.apiFetch === apiFetch }); } catch { return null; } }, [siteId, ownerId, apiFetch]);
  /* eslint-enable react-hooks/refs */
  return client ? <Screen key={`${siteId}:${ownerId}`} {...props} client={client}/> : <section aria-label="账号与考勤暂停核验" className="p-4"><p role="alert">当前负责人身份无法核验，未读取或提交。</p><button className={button} onClick={props.onClose}>关闭暂停核验</button></section>;
}
function Screen({ client, onClose, registerLeaveGuard }: Props & { client: AttendanceAccountSuspensionClient }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot), [shown, setShown] = useState(false), [formEpoch, setFormEpoch] = useState(0);
  const dirty = useRef(false), epoch = useRef(0);
  const clear = useCallback(() => { dirty.current = false; setFormEpoch(value => value + 1); }, []);
  const leave = useCallback(() => { const generation = epoch.current; return (!(dirty.current || client.hasLeaveRisk()) || window.confirm("离开会清除未提交的核验理由。已发送操作不会撤销，未知原编号仍需核对；继续吗？")) && epoch.current === generation; }, [client]);
  useLayoutEffect(() => { registerLeaveGuard?.(leave); return () => registerLeaveGuard?.(null); }, [leave, registerLeaveGuard]);
  useLayoutEffect(() => {
    const hide = () => { epoch.current++; setShown(false); clear(); client.pause(); };
    const show = () => { epoch.current++; clear(); void client.initialize(); setShown(true); };
    const visibility = () => { if (document.hidden) hide(); else show(); };
    const unload = (event: BeforeUnloadEvent) => { if (dirty.current || client.hasLeaveRisk()) { event.preventDefault(); event.returnValue = ""; } };
    visibility(); document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hide); window.addEventListener("pageshow", show); window.addEventListener("beforeunload", unload);
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- invalidate the current mounted lifetime
      epoch.current++; client.pause(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); window.removeEventListener("beforeunload", unload); };
  }, [client, clear]);
  const result = shown ? state.result : null, pending = shown ? state.pending : null, busy = state.phase === "loading" || state.phase === "saving";
  const read = (run: () => void) => { const generation = epoch.current;
    if (!shown || document.hidden || busy || dirty.current && !window.confirm("读取资料会清除未提交的核验理由，继续吗？")) return;
    if (generation !== epoch.current || document.hidden) return; epoch.current++; clear(); run(); };
  const restore = (reason: string) => { const generation = epoch.current, snapshot = client.getSnapshot();
    confirmAccountSuspensionRestore(() => window.confirm("确认核验当前同一员工、登录身份及考勤人员后解除暂停？不会自动下班、改变任职日期、恢复旧 PIN 或旧委托。"),
      () => shown && !document.hidden && !busy && !pending && !!result?.detail?.canRestore && epoch.current === generation && client.getSnapshot() === snapshot,
      () => { epoch.current++; clear(); void client.restore(reason); }); };
  return <section aria-label="账号与考勤暂停核验" data-account-suspension className="min-w-0 space-y-4 p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><h2 className="text-xl font-bold">考勤暂停待核验</h2><button type="button" className={button} onClick={() => { if (leave()) { client.pause(); onClose(); } }}>关闭暂停核验</button></header>
    <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6">仅核验本企业账号停用留下的暂停。账号恢复不等于考勤恢复；不自动下班、不改变在职日期、不处理申请，也不创建新的考勤档案。</p>
    <p className="text-sm leading-6">账号恢复、考勤暂停解除、设置新 PIN、重新授予委托是四个独立结果。旧 PIN 与旧委托不会因解除暂停恢复。</p>
    <p role="status" className="break-words rounded-xl bg-blue-50 p-3 text-sm">{state.message}</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!shown || busy || !!pending} onClick={() => read(() => { void client.load(); })}>读取当前暂停列表</button>
      {pending && <button type="button" className={button} disabled={!shown || busy} onClick={() => read(() => { void client.recover(); })}>核对原恢复编号</button>}</div>
    {pending && <div data-account-suspension-pending className="rounded-xl bg-amber-50 p-3 text-sm"><p>恢复结果待确认，仅核对原编号，不自动重发。不会锁住正常打卡或安全下班。</p><p className="break-all">原操作编号：{pending.command.operationId}</p></div>}
    {result?.receipt && <AccountSuspensionReceiptView receipt={result.receipt}/>}
    {result?.statusReceipt && <AccountStatusReceiptView receipt={result.statusReceipt}/>}
    {result?.detail ? <AccountSuspensionDetailView key={`${result.detail.suspension.suspensionId}:${formEpoch}`} detail={result.detail} disabled={!shown || busy || !!pending}
      onDirty={() => { epoch.current++; dirty.current = true; }} onRestore={restore}/>
      : result?.mode === "list" && <section aria-label="当前暂停名单" className="space-y-2"><p className="text-sm">本页最多 25 条；没有记录不代表历史上从未停用。</p>
        {!result.items.length && <p>本页没有当前暂停。</p>}
        {result.items.map(item => <article key={item.suspensionId} data-account-suspension-id={item.suspensionId} className="min-w-0 space-y-2 rounded-xl border p-3"><AccountSuspensionIdentity item={item}/>
          <button type="button" className={button} disabled={busy || !!pending} onClick={() => read(() => { void client.detail(item.suspensionId); })}>核验此暂停</button></article>)}
        {result.nextAfterId && <button type="button" className={button} disabled={busy || !!pending} onClick={() => read(() => { void client.next(); })}>下一页暂停名单</button>}
      </section>}
  </section>;
}
export function AccountSuspensionIdentity({ item }: { item: AccountSuspensionItem }) {
  return <div className="min-w-0 text-sm"><p className="break-words font-semibold">{item.employeeName} · {item.workerName ?? "无考勤人员档案"}</p><p>暂停代际 {item.generation} · UTC {item.recordedAt}</p>
    <details className="break-all"><summary>核对保存的双身份</summary><p>员工 {item.employeeId}<br/>Auth {item.employeeAuthUserId ?? "未绑定"}<br/>考勤人员 {item.workerId ?? "不存在；不会自动创建"}</p></details></div>;
}
export function AccountSuspensionDetailView({ detail: d, disabled = false, onDirty = () => {}, onRestore = () => {} }: { detail: AccountSuspensionDetail; disabled?: boolean; onDirty?: () => void; onRestore?: (reason: string) => void }) {
  const [reason, setReason] = useState(""), [confirmed, setConfirmed] = useState(false);
  return <article data-account-suspension-detail className="min-w-0 space-y-3 rounded-xl border p-3 text-sm"><AccountSuspensionIdentity item={d.suspension}/>
    <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2"><div><dt>企业账号</dt><dd>{employeeStatusNames[d.employeeStatus ?? ""] ?? "当前不存在"}</dd></div>
      <div><dt>暂停前考勤启用状态</dt><dd>{d.suspension.wasActive === null ? "无考勤人员" : d.suspension.wasActive ? "启用" : "原本未启用（解除后仍未启用）"}</dd></div>
      <div><dt>暂停时原始在班状态</dt><dd>{actionName(d.originalAction)}</dd></div><div><dt>当前原始在班状态</dt><dd>{actionName(d.currentAction)}</dd></div>
      <div><dt>旧 PIN</dt><dd>{d.pinInvalidated ? "已失效；本页未设置新 PIN" : "没有已确认的 PIN 失效记录；未设置新 PIN"}</dd></div>
      <div><dt>旧委托</dt><dd>{d.delegationsInvalidated ? "已失效；须另行重新授予" : "没有已确认的委托失效记录；未重新授权"}</dd></div></dl>
    <section aria-label="待处理事项核验范围" className="rounded-xl bg-slate-50 p-3"><h3 className="font-semibold">待处理事项：本页未统计</h3><p>请假：未核查；出差／外勤／远程：未核查；整段漏卡：未核查。请返回考勤配置，使用原负责人申请入口按现有权限处理；本页不代批或代收班。</p><p>其他浏览器的未知操作编号无法观测，不代表 0。请由原操作者携原编号核对。</p></section>
    {d.blockers.length > 0 && <ul role="alert" className="list-inside list-disc text-amber-900">{d.blockers.map(code => <li key={code}>{blockers[code] ?? code}</li>)}</ul>}
    {!d.canRestore ? <p>当前不能解除暂停；请处理显示的阻断并明确重新读取。</p> : <div className="space-y-3"><label className="block">恢复核验理由<textarea aria-label="恢复核验理由" className="mt-1 w-full min-w-0 rounded-xl border p-2" rows={3} maxLength={500} disabled={disabled} value={reason}
      onChange={event => { onDirty(); setReason(event.target.value); setConfirmed(false); }}/></label>
      <label className="flex items-start gap-2"><input type="checkbox" aria-label="确认同一身份解除暂停" disabled={disabled || !accountSuspensionReasonValid(reason)} checked={confirmed} onChange={event => { onDirty(); setConfirmed(event.target.checked); }}/><span>已核对同一员工、Auth、原考勤档案与当前资格；保持原始在班状态，旧 PIN／委托仍失效。</span></label>
      <button type="button" className={button} disabled={!accountSuspensionRestoreReady(d, reason, confirmed, disabled)} onClick={() => { if (accountSuspensionRestoreReady(d, reason, confirmed, disabled)) onRestore(reason); }}>明确解除考勤暂停</button></div>}
  </article>;
}
export function AccountSuspensionReceiptView({ receipt: r }: { receipt: AccountSuspensionReceipt }) {
  return <section data-account-suspension-receipt className="min-w-0 space-y-2 rounded-xl bg-emerald-50 p-3 text-sm"><h3 className="font-semibold">已确认解除该次暂停</h3><p className="break-all">操作 {r.operationId}<br/>暂停 {r.suspensionId} · 代际 {r.generation}<br/>UTC {r.recordedAt}</p>
    <p>保存恢复结果：{r.workerActive === null ? "无考勤档案，未创建人员" : r.workerActive ? "恢复原考勤启用值" : "保持原本未启用"}。这是原操作回执，不证明当前仍可打卡；没有自动下班、设置 PIN 或重新授予委托。</p></section>;
}
export function AccountStatusReceiptView({ receipt: r }: { receipt: AccountStatusReceipt }) {
  return <section data-account-status-receipt className="min-w-0 space-y-2 rounded-xl bg-emerald-50 p-3 text-sm"><h3 className="font-semibold">企业账号{r.status === "active" ? "恢复" : "停用"}原操作已确认</h3><p className="break-all">操作 {r.operationId}<br/>员工 {r.employeeId} · 账号版本 {r.version}<br/>UTC {r.recordedAt}</p>
    <p>{r.suspensionId ? "此原号关联考勤暂停记录，请由负责人明确核验。" : "此原号没有关联考勤暂停记录，不能推断考勤已恢复。"}账号恢复不自动解除考勤暂停，也不恢复旧 PIN／委托。</p></section>;
}
