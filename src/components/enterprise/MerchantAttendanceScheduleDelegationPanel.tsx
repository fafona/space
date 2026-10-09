"use client";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AttendanceScheduleDelegationClient } from "@/lib/merchantAttendanceScheduleDelegationClient";
import type { ScheduleDelegationGrant, ScheduleDelegationCatalogItem, ScheduleDelegationResult } from "@/lib/merchantAttendanceScheduleDelegation";
import { resolveScheduleWallSlots, type ScheduleWallSlot, type ScheduleSlot } from "@/lib/merchantAttendanceSchedule";
import { correctionTimeOffsets } from "@/lib/merchantAttendanceCorrectionForm";
import type { ScheduleDelegationPanelProps } from "./MerchantAttendanceScheduleDelegationLauncher";

const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40";
const input = "mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white p-2 text-sm disabled:bg-slate-50";
type Props = ScheduleDelegationPanelProps & { onClose: () => void };
type Action = "publish" | "cancel";
type Catalog = "delegates" | "workers" | "locations";
type Choices = { delegate: ScheduleDelegationCatalogItem | null; worker: ScheduleDelegationCatalogItem | null; location: ScheduleDelegationCatalogItem | null };
type Schedule = NonNullable<ScheduleDelegationResult["schedule"]>;
type GrantInput = { actions: Action[]; includeExistingFuture: boolean; validFrom: string; validUntil: string; reason: string };
type Draft = { actions: Action[]; includeExistingFuture: boolean; historyAck: boolean; from: string; until: string; reason: string; ack: boolean };
const catalogNames: Record<Catalog, string> = { delegates: "排班主管", workers: "目标考勤员工", locations: "授权地点" };
const actionNames = { grant: "已授予排班委托", revoke: "已撤销排班委托", publish: "已发布排班", cancel: "已取消班次" };
export const scheduleDelegationEmptyDraft = (): Draft => ({ actions: [], includeExistingFuture: false, historyAck: false, from: "", until: "", reason: "", ack: false });
export const scheduleDelegationReasonValid = (value: string) => value === value.trim() && [...value].length >= 1 && [...value].length <= 200 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
export function scheduleDelegationUtc(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || value.startsWith("0000")) throw Error("invalid_utc");
  const iso = value + ":00.000Z", time = Date.parse(iso);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== iso) throw Error("invalid_utc"); return value + ":00.000000Z";
}
export function confirmScheduleDelegationAction(confirm: () => boolean, current: () => boolean, submit: () => void): boolean {
  if (!current() || !confirm() || !current()) return false; submit(); return true;
}
export function scheduleDelegationRangeValid(from: string, through: string): boolean {
  if (from < "2000-01-01" || through > "2100-12-31") return false;
  try { scheduleDelegationUtc(from + "T00:00"); scheduleDelegationUtc(through + "T00:00"); } catch { return false; }
  const days = (Date.parse(through + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000;
  return Number.isInteger(days) && days >= 0 && days <= 30;
}
export function previewDelegatedSchedule(rows: ScheduleWallSlot[], schedule: Schedule, from: string, through: string): ScheduleSlot[] {
  if (schedule.rangeLimited || !schedule.grant.usableActions.includes("publish") || !scheduleDelegationRangeValid(from, through) || !rows.length || rows.length > 32) throw Error("当前范围不能发布，请重新核对授权与完整列表。");
  for (const row of rows) if (row.start.slice(0, 10) < from || row.start.slice(0, 10) > through) throw Error("班次开始日期须在所读日期范围内。");
  const slots = resolveScheduleWallSlots(rows, schedule.timeZone);
  let previousEnd = -Infinity;
  for (const [start, end] of slots) {
    const a = Date.parse(start), b = Date.parse(end);
    if (b <= a || b - a > 86400000 || a < previousEnd || a % 60000 || b % 60000) throw Error("每段须大于零且不超过 24 小时，各段不能重叠。");
    if (a < Date.parse(schedule.grant.validFrom) || b > Date.parse(schedule.grant.validUntil)) throw Error("每段完整班次必须位于授权有效期内。");
    previousEnd = b;
  }
  return slots;
}
export default function MerchantAttendanceScheduleDelegationPanel(props: Props) {
  const enabled = props.enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_SCHEDULE_DELEGATION_ENABLED === "1";
  return <Prepared key={`${props.siteId}:${props.access}:${props.actorId}`} {...props} enabled={enabled}/>;
}
function Prepared(props: Props & { enabled: boolean }) {
  const { siteId, access, actorId, apiFetch, enabled } = props;
  const client = useMemo(() => { try { return new AttendanceScheduleDelegationClient({ siteId, access, actorId, apiFetch, enabled, storage: () => sessionStorage }); } catch { return null; } }, [siteId, access, actorId, apiFetch, enabled]);
  return client ? <Screen {...props} client={client}/> : <section aria-label="排班委托" className="p-4"><p role="alert">当前身份无法核对排班委托，未读取或提交。</p><button type="button" className={button} onClick={props.onClose}>关闭排班委托</button></section>;
}
function Screen({ client, access, enabled, onClose, registerLeaveGuard }: Props & { enabled: boolean; client: AttendanceScheduleDelegationClient }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [shown, setShown] = useState(false), [draft, setDraft] = useState<Draft>(scheduleDelegationEmptyDraft), [formEpoch, setFormEpoch] = useState(0);
  const [selectedGrant, setSelectedGrant] = useState<ScheduleDelegationGrant | null>(null), [rangeDirty, setRangeDirty] = useState(false);
  const dirty = useRef(false), epoch = useRef(0);
  const clearDraft = useCallback(() => { dirty.current = false; setDraft(scheduleDelegationEmptyDraft()); setSelectedGrant(null); setRangeDirty(false); setFormEpoch(value => value + 1); }, []);
  const leave = useCallback(() => { const generation = epoch.current; return (!(dirty.current || client.hasLeaveRisk())
    || window.confirm("离开会清除未提交的授权或排班草稿。已发送操作不会撤销，原编号仍需核对；继续吗？")) && epoch.current === generation; }, [client]);
  useLayoutEffect(() => { registerLeaveGuard?.(leave); return () => registerLeaveGuard?.(null); }, [leave, registerLeaveGuard]);
  useLayoutEffect(() => {
    const hide = () => { epoch.current++; setShown(false); clearDraft(); client.pause(); };
    const show = () => { epoch.current++; clearDraft(); void client.initialize(); setShown(true); };
    const visibility = () => { if (document.hidden) hide(); else show(); };
    const unload = (event: BeforeUnloadEvent) => { if (dirty.current || client.hasLeaveRisk()) { event.preventDefault(); event.returnValue = ""; } };
    visibility(); document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hide); window.addEventListener("pageshow", show); window.addEventListener("beforeunload", unload);
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- invalidate this lifetime rather than a captured generation
      epoch.current++; client.pause(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); window.removeEventListener("beforeunload", unload); };
  }, [client, clearDraft]);
  const result = shown ? state.result : null, pending = shown ? state.pending : null;
  const busy = state.phase === "loading" || state.phase === "saving", editable = shown && !busy && !pending && state.phase === "ready";
  const markDirty = () => { epoch.current++; dirty.current = true; };
  const read = (run: () => void, discard = true) => { const generation = epoch.current;
    if (!shown || document.hidden || busy || discard && dirty.current && !window.confirm("读取其他资料会清除未提交输入，继续吗？")) return;
    if (generation !== epoch.current || document.hidden) return; epoch.current++; if (discard) clearDraft(); run(); };
  const confirm = (message: string, run: () => void, safeRevoke = false) => { const generation = epoch.current, snapshot = client.getSnapshot();
    return confirmScheduleDelegationAction(() => window.confirm(message), () => shown && !document.hidden && editable && (safeRevoke || enabled && !!result?.canWrite)
      && epoch.current === generation && client.getSnapshot() === snapshot, () => { epoch.current++; clearDraft(); run(); }); };
  const operationId = pending ? "decision" in pending.command ? pending.command.decision.operationId : pending.command.operationId : null;
  const schedule = result?.schedule, rangeGrant = schedule?.grant ?? selectedGrant;
  const catalogKind = state.query?.catalog;
  return <section aria-label="排班委托" data-schedule-delegation className="min-w-0 space-y-4 p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><h2 className="text-xl font-bold">{access === "owner" ? "主管排班授权" : "受托排班"}</h2><button type="button" className={button} onClick={() => { if (leave()) { client.pause(); onClose(); } }}>关闭排班委托</button></header>
    <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6">仅对明确的员工、地点、动作及期限授权，禁止自己管理自己的排班。地点仍须是目标员工当前默认地点；不会代改地点、管理公共模板或自动续排。排班不等于实际打卡、工时或工资，也不自动核准迟到／早退规则。</p>
    {!enabled && <p className="text-sm text-amber-900">新授权及受托排班已关闭；当前负责人仍可明确读取、撤销已有授权，原操作者可核对原编号。服务不可用时保留编号，不能保证立即恢复。</p>}
    <p role="status" aria-live="polite" className="break-words rounded-xl bg-blue-50 p-3 text-sm">{state.message}</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!shown || busy || !!pending || access === "delegate" && !enabled} onClick={() => read(() => { void client.load(); })}>{access === "owner" ? "读取排班授权列表" : "读取我的排班授权"}</button>
      {pending && <button type="button" className={button} disabled={!shown || busy} onClick={() => read(() => { void client.recover(); })}>核对原排班委托编号</button>}</div>
    {operationId && <div data-schedule-delegation-pending className="space-y-1 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm"><p>结果待确认，不重新提交；请保留本标签页原编号。此待办不代替真实打卡资格核验，也不锁住正常打卡或安全下班。</p><p className="break-all">原操作编号：{operationId}</p><p>未重新授权前不从本地命令显示人员、理由或排班正文。</p></div>}
    {result && <>{!result.canWrite && <p className="text-sm text-amber-900">当前不能发起新授权或受托排班；负责人安全撤权由服务端单独核验。</p>}<ScheduleDelegationReceipt result={result}/>
      {access === "owner" && <>{enabled && !result.detail && !result.receipt && <>
        <ScheduleDelegationChoices choices={state.choices}/>
        <div className="flex flex-wrap gap-2">{(Object.keys(catalogNames) as Catalog[]).map(kind => <button key={kind} type="button" className={button} disabled={!editable || !result.canWrite} onClick={() => read(() => { void client.catalog(kind); }, false)}>选择{catalogNames[kind]}</button>)}</div>
        {result.mode === "catalog" && catalogKind && <ScheduleDelegationCatalog key={`${catalogKind}:${result.readAt}`} kind={catalogKind} items={result.catalogItems} disabled={!editable || !result.canWrite}
          onSelect={item => { markDirty(); setDraft(value => ({ ...value, ack: false, historyAck: false })); if (catalogKind === "delegates") client.selectDelegate(item); else if (catalogKind === "workers") client.selectWorker(item); else client.selectLocation(item); }} hasNext={!!result.nextAfterId} onNext={() => read(() => { void client.next(); }, false)}/>}
        <ScheduleDelegationGrantForm draft={draft} choices={state.choices} disabled={!editable || !result.canWrite} onDraft={value => { markDirty(); setDraft(value); }}
          onGrant={value => confirm("确认授予所选主管对这一员工、地点、动作和期限的独立排班权限？包含授权前未来班次的额外选择将一并保存。", () => { void client.grant(value); })}/>
      </>}
        {result.detail ? <ScheduleDelegationGrantView key={`${result.detail.grantId}:${result.detail.revision}:${formEpoch}`} grant={result.detail} owner disabled={!editable} onDirty={markDirty}
          onRevoke={reason => confirm("明确撤销此排班授权？既有班次和历史依据不会删除，主管不能继续发起操作。", () => { void client.revoke(result.detail!.grantId, reason); }, true)}/>
          : result.mode === "list" && <GrantList grants={result.grants} disabled={!editable} onOpen={grant => read(() => { void client.detailGrant(grant.grantId); })}/>}
        {result.mode === "list" && result.nextAfterId && <button type="button" className={button} disabled={!editable} onClick={() => read(() => { void client.next(); })}>下一页排班授权</button>}
      </>}
      {access === "delegate" && <>{result.mode === "grants" && <><GrantList grants={result.grants} disabled={!editable || !enabled} onOpen={grant => read(() => setSelectedGrant(grant))}/>
        {result.nextAfterId && <button type="button" className={button} disabled={!editable || !enabled} onClick={() => read(() => { void client.next(); })}>下一页本人排班授权</button>}</>}
        {rangeGrant && <ScheduleRange key={`${rangeGrant.grantId}:${state.query?.fromDate ?? ""}:${state.query?.throughDate ?? ""}:${formEpoch}`} grant={rangeGrant}
          fromDate={state.query?.fromDate ?? ""} throughDate={state.query?.throughDate ?? ""} disabled={!editable || !enabled} onDirty={() => { markDirty(); setRangeDirty(true); }}
          onRead={(from, through) => read(() => { void client.schedule(rangeGrant.grantId, from, through); })}/>}
        {schedule && <ScheduleDelegationScheduleView key={`${schedule.grant.grantId}:${schedule.revision}:${schedule.settingsVersion}:${schedule.readAt}:${formEpoch}`} schedule={schedule}
          fromDate={state.query?.fromDate ?? ""} throughDate={state.query?.throughDate ?? ""} disabled={!editable || !enabled || !result.canWrite || rangeDirty} onDirty={markDirty}
          onPublish={(slots, reason) => confirm("明确发布已预览的全部班次？服务端将重新核对真实身份、授权、整段期限、版本、在职及重叠；预览不是已发布。", () => { void client.publish({ slots, reason }); })}
          onCancel={(slotId, reason) => confirm("明确取消已核对的这个未来班次？不删除旧记录，不自动发布替代班次或转移原规则核准。", () => { void client.cancel(slotId, reason); })}/>}</>}
    </>}
  </section>;
}
export function ScheduleDelegationChoices({ choices }: { choices: Choices }) {
  return <div className="space-y-1 rounded-xl bg-slate-50 p-3 text-sm"><p>目录不会自动选中；分页保留已明确选择的对象。</p><p>主管：{choices.delegate?.name ?? "未选择"}</p><p>目标员工：{choices.worker ? `${choices.worker.name} · ${choices.worker.workerNo ?? ""}` : "未选择"}</p><p>地点：{choices.location ? `${choices.location.name} · ${choices.location.timeZone}` : "未选择"}</p></div>;
}
export function ScheduleDelegationCatalog({ kind, items, disabled, onSelect, hasNext, onNext }: { kind: Catalog; items: ScheduleDelegationCatalogItem[]; disabled: boolean; onSelect: (item: ScheduleDelegationCatalogItem) => void; hasNext: boolean; onNext: () => void }) {
  const [search, setSearch] = useState(""); const shown = items.filter(item => `${item.name} ${item.workerNo ?? ""}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <section aria-label={`${catalogNames[kind]}目录`} className="min-w-0 space-y-2 rounded-xl border p-3"><h3 className="font-semibold">{catalogNames[kind]}目录 · 本页 {items.length} 项</h3>
    <label className="block text-sm">筛选本页姓名／工号<input className={input} value={search} maxLength={80} disabled={disabled} onChange={e => setSearch(e.target.value)}/></label><p className="text-xs">只筛选当前页，不是全企业搜索；可逐页选择。主管目录具备至少一种排班权限，不保证已具备所有勾选动作；授予时重新核验。</p>
    <ul className="space-y-2">{shown.map(item => <li data-schedule-delegation-catalog-id={item.id} className="min-w-0 rounded-lg bg-slate-50 p-2 text-sm" key={item.id}><p>{item.name}{item.workerNo ? ` · ${item.workerNo}` : ""}{item.timeZone ? ` · ${item.timeZone}` : ""}</p><button type="button" className={button} disabled={disabled} onClick={() => onSelect(item)}>选用此{catalogNames[kind]}</button></li>)}</ul>
    <button type="button" className={button} disabled={disabled || !hasNext} onClick={onNext}>下一页排班授权目录</button>
  </section>;
}
export function ScheduleDelegationGrantForm({ draft, choices, disabled, onDraft, onGrant }: { draft: Draft; choices: Choices; disabled: boolean; onDraft: (value: Draft) => void; onGrant: (value: GrantInput) => void }) {
  let bounds: { validFrom: string; validUntil: string } | null = null;
  try { const validFrom = scheduleDelegationUtc(draft.from), validUntil = scheduleDelegationUtc(draft.until); if (validFrom < validUntil) bounds = { validFrom, validUntil }; } catch { /* Explicit UTC input, never device local. */ }
  const identities = choices.delegate?.employeeId && choices.delegate.employeeAuthUserId && choices.worker?.employeeId && choices.worker.employeeAuthUserId && choices.location?.timeZone
    && choices.delegate.employeeId !== choices.worker.employeeId && choices.delegate.employeeAuthUserId !== choices.worker.employeeAuthUserId;
  const actions = (["publish", "cancel"] as const).filter(action => draft.actions.includes(action));
  const ready = !disabled && !!identities && !!bounds && actions.length > 0 && actions.length === draft.actions.length && scheduleDelegationReasonValid(draft.reason) && draft.ack && (!draft.includeExistingFuture || draft.historyAck);
  const change = (patch: Partial<Draft>) => onDraft({ ...draft, ...patch, ack: false, historyAck: false });
  return <form className="space-y-3 rounded-xl border p-3" onSubmit={e => { e.preventDefault(); if (ready && bounds) onGrant({ actions, includeExistingFuture: draft.includeExistingFuture, ...bounds, reason: draft.reason }); }}>
    <h3 className="font-semibold">明确授权范围</h3><fieldset disabled={disabled} className="space-y-3">
      <p className="text-sm">主管与目标员工必须不同；地点须是目标员工当前默认地点。授权窗口同时限制操作时点与完整班次，不是任职日期。</p>
      <div className="flex flex-wrap gap-4">{(["publish", "cancel"] as const).map(action => <label key={action} className="flex gap-2 text-sm"><input aria-label={action === "publish" ? "授权发布排班" : "授权取消班次"} type="checkbox" checked={draft.actions.includes(action)} onChange={e => change({ actions: e.target.checked ? [...draft.actions, action] : draft.actions.filter(x => x !== action) })}/>{action === "publish" ? "发布排班" : "取消班次"}</label>)}</div>
      <div className="grid gap-3 sm:grid-cols-2"><label className="min-w-0 text-sm">授权开始（UTC）<input aria-label="排班授权开始（UTC）" className={input} type="datetime-local" value={draft.from} onChange={e => change({ from: e.target.value })}/></label><label className="min-w-0 text-sm">授权结束（UTC）<input aria-label="排班授权结束（UTC）" className={input} type="datetime-local" value={draft.until} onChange={e => change({ until: e.target.value })}/></label></div>
      <label className="flex gap-2 text-sm"><input aria-label="包含授权前已存在未来班次" type="checkbox" checked={draft.includeExistingFuture} onChange={e => change({ includeExistingFuture: e.target.checked })}/>包含授权前已存在、尚未开始的班次（仅具有可核验发布双身份依据者）</label>
      {draft.includeExistingFuture && <label className="flex gap-2 text-sm"><input aria-label="确认已有未来班次授权" type="checkbox" checked={draft.historyAck} onChange={e => onDraft({ ...draft, historyAck: e.target.checked, ack: false })}/>我明确授权处理已有未来班次；缺旧依据仍由负责人处理，不自动回填。</label>}
      <label className="block text-sm">授权理由<input aria-label="排班授权理由" className={input} maxLength={200} value={draft.reason} onChange={e => change({ reason: e.target.value })}/></label>
      <label className="flex gap-2 text-sm"><input aria-label="确认排班授权范围" type="checkbox" checked={draft.ack} onChange={e => onDraft({ ...draft, ack: e.target.checked })}/>已核对主管、员工、地点、动作、UTC有效期及已有班次选择</label><button className={button} disabled={!ready}>明确授予排班委托</button>
    </fieldset>
  </form>;
}
export function ScheduleDelegationGrantView({ grant: g, owner = false, disabled = true, onDirty = () => {}, onRevoke = () => {} }: { grant: ScheduleDelegationGrant; owner?: boolean; disabled?: boolean; onDirty?: () => void; onRevoke?: (reason: string) => void }) {
  return <article data-schedule-delegation-grant={g.grantId} className="min-w-0 space-y-2 rounded-xl border p-3 text-sm"><p className="font-semibold">{g.delegate.name} → {g.worker.name} · {g.worker.workerNo}</p><p>{g.location.name} · {g.location.timeZone}</p><p>授权动作：{g.actions.map(x => x === "publish" ? "发布" : "取消").join("／")} · {g.status === "revoked" ? "已撤销" : "已授予"} · 授权版本 {g.revision}</p>
    <p className="break-all">UTC有效期：{g.validFrom} → {g.validUntil}</p><p>{g.includeExistingFuture ? "包含授予前已有未来班次，仅限保存双身份依据可核验者" : "不包含授予前已有未来班次"}</p><p>当前可用动作：{g.usableActions.map(x => x === "publish" ? "发布" : "取消").join("／") || "无"}；新操作仍须服务端核验。</p><p>授权理由：{g.reason}</p>
    <details className="break-all text-xs"><summary>保存授权与身份编号</summary><p>授权：{g.grantId} · 授予人：{g.grantedBy} · {g.grantedAt}</p><p>主管成员：{g.delegate.employeeId} · Auth：{g.delegate.authUserId}</p><p>目标worker：{g.worker.workerId} · 成员：{g.worker.employeeId} · Auth：{g.worker.authUserId} · 地点：{g.location.id}</p></details>
    {g.revocation && <p>撤权理由：{g.revocation.reason} · {g.revocation.recordedAt}</p>}{owner && g.status === "granted" && <ReasonAction label="撤权理由" submit="明确撤销排班委托" disabled={disabled} onDirty={onDirty} onSubmit={onRevoke}/>}
  </article>;
}
function GrantList({ grants, disabled, onOpen }: { grants: ScheduleDelegationGrant[]; disabled: boolean; onOpen: (grant: ScheduleDelegationGrant) => void }) {
  return <section aria-label="排班授权列表" className="space-y-3">{!grants.length && <p className="text-sm">本页没有可显示的授权，不代表其他范围或历史不存在。</p>}{grants.map(grant => <div key={grant.grantId} className="space-y-2"><ScheduleDelegationGrantView grant={grant}/><button type="button" className={button} disabled={disabled} onClick={() => onOpen(grant)}>选择此排班授权</button></div>)}</section>;
}
function ScheduleRange({ grant, fromDate, throughDate, disabled, onDirty, onRead }: { grant: ScheduleDelegationGrant; fromDate: string; throughDate: string; disabled: boolean; onDirty: () => void; onRead: (from: string, through: string) => void }) {
  const [from, setFrom] = useState(fromDate), [through, setThrough] = useState(throughDate);
  return <form aria-label="读取授权排班范围" className="space-y-3 rounded-xl border p-3" onSubmit={e => { e.preventDefault(); if (!disabled && scheduleDelegationRangeValid(from, through)) onRead(from, through); }}>
    <p className="text-sm">已选：{grant.worker.name} · {grant.location.name} · {grant.location.timeZone}。日期按班次开始的地点本地日，最多31日。</p><div className="grid gap-3 sm:grid-cols-2">
      <label className="min-w-0 text-sm">范围开始日期<input aria-label="受托排班开始日期" className={input} type="date" value={from} disabled={disabled} onChange={e => { setFrom(e.target.value); onDirty(); }}/></label><label className="min-w-0 text-sm">范围结束日期（含）<input aria-label="受托排班结束日期" className={input} type="date" value={through} disabled={disabled} onChange={e => { setThrough(e.target.value); onDirty(); }}/></label></div>
    <button className={button} disabled={disabled || !scheduleDelegationRangeValid(from, through)}>读取授权排班</button>
  </form>;
}
export function ScheduleDelegationScheduleView({ schedule: s, fromDate, throughDate, disabled = true, onDirty = () => {}, onPublish = () => {}, onCancel = () => {} }: { schedule: Schedule; fromDate: string; throughDate: string; disabled?: boolean; onDirty?: () => void; onPublish?: (slots: ScheduleSlot[], reason: string) => void; onCancel?: (slotId: string, reason: string) => void }) {
  return <section data-schedule-delegation-schedule className="min-w-0 space-y-3"><ScheduleDelegationGrantView grant={s.grant}/><p className="text-sm">所读开始日期：{fromDate} → {throughDate} · 地点时区：{s.timeZone}<br/>排班版本 {s.revision} · 设置版本 {s.settingsVersion} · 人员版本 {s.workerVersion} · 地点版本 {s.locationVersion}<br/>服务端核验时点：{s.readAt}</p>
    {s.rangeLimited ? <p role="alert">此范围超过100条，未显示部分列表，也不能发布或取消。请缩短日期范围重新读取。</p> : <>
      {!s.entries.length && <p className="text-sm">此授权范围没有可显示班次；不是无排班、缺勤或范围外资料的结论。</p>}
      {s.entries.map(entry => <article key={entry.slotId} data-schedule-delegation-slot={entry.slotId} className="min-w-0 space-y-2 rounded-xl border p-3 text-sm"><p>归属日期 {entry.workDate} · {entry.cancelled ? "已取消" : "已发布"} · 班次版本 {entry.revision}</p><p className="break-all">UTC：{entry.startAt} → {entry.endAt}<br/>原地点时区：{entry.timeZone}</p><p className="break-all">发布操作者：{entry.publishedBy} · {entry.publishedAt}</p>
        {entry.cancelled && <p className="break-all">取消操作者：{entry.cancelledBy} · {entry.cancelledAt}</p>}
        {entry.canCancel && !entry.cancelled && s.grant.usableActions.includes("cancel") && <ReasonAction label="取消班次理由" submit="明确取消受托班次" disabled={disabled} onDirty={onDirty} onSubmit={reason => onCancel(entry.slotId, reason)}/>}
      </article>)}
      {s.grant.usableActions.includes("publish") && <ScheduleDelegationPublishForm schedule={s} fromDate={fromDate} throughDate={throughDate} disabled={disabled} onDirty={onDirty} onPublish={onPublish}/>}
    </>}
  </section>;
}
export function ScheduleDelegationPublishForm({ schedule, fromDate, throughDate, disabled, onDirty, onPublish }: { schedule: Schedule; fromDate: string; throughDate: string; disabled: boolean; onDirty: () => void; onPublish: (slots: ScheduleSlot[], reason: string) => void }) {
  const empty = (): ScheduleWallSlot => ({ start: "", end: "", startOffset: "", endOffset: "" });
  const [rows, setRows] = useState<ScheduleWallSlot[]>([empty()]), [reason, setReason] = useState(""), [preview, setPreview] = useState<ScheduleSlot[] | null>(null), [ack, setAck] = useState(false), [message, setMessage] = useState("");
  const changed = () => { setPreview(null); setAck(false); setMessage(""); onDirty(); };
  const ready = !disabled && !!preview && ack && scheduleDelegationReasonValid(reason);
  return <form aria-label="受托班次预览与发布" className="space-y-3 rounded-xl border p-3" onSubmit={e => { e.preventDefault(); if (ready && preview) onPublish(preview, reason); }}>
    <h3 className="font-semibold">新增班次 · {schedule.timeZone}</h3><p className="text-sm">每批最多32段，各段≤24小时，不自动续排；跨夜须明确填写次日。未来180天、在职、重叠及最新授权由服务端最终核验。</p><fieldset className="space-y-3" disabled={disabled}>
      {rows.map((row, n) => <div key={n} className="grid min-w-0 gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-2">{(["start", "end"] as const).map(key => {
        const offsetKey = key === "start" ? "startOffset" : "endOffset"; let offsets: string[] = []; try { if (row[key]) offsets = correctionTimeOffsets(row[key], schedule.timeZone); } catch { /* Invalid local date stays unconfirmed. */ }
        return <label key={key} className="min-w-0 text-sm">第{n + 1}段{key === "start" ? "开始" : "结束"}（地点当地时间）<input aria-label={`第${n + 1}段${key === "start" ? "开始" : "结束"}`} className={input} type="datetime-local" value={row[key]} onChange={e => { changed(); setRows(rows.map((x, i) => i === n ? { ...x, [key]: e.target.value, [offsetKey]: "" } : x)); }}/>
          {row[key] && (offsets.length > 1 ? <select aria-label={`第${n + 1}段${key === "start" ? "开始" : "结束"}偏移`} className={input} value={row[offsetKey]} onChange={e => { changed(); setRows(rows.map((x, i) => i === n ? { ...x, [offsetKey]: e.target.value } : x)); }}><option value="">重复时间：明确选择 UTC 偏移</option>{offsets.map(offset => <option key={offset}>{offset}</option>)}</select> : <span className="text-xs">{offsets.length === 1 ? `UTC${offsets[0]}` : "当地时间不存在，请修改"}</span>)}</label>;
      })}{rows.length > 1 && <button type="button" className={button} onClick={() => { changed(); setRows(rows.filter((_, i) => i !== n)); }}>移除第{n + 1}段</button>}</div>)}
      <button type="button" className={button} disabled={rows.length >= 32} onClick={() => { changed(); setRows([...rows, empty()]); }}>增加班次段</button>
      <label className="block text-sm">发布理由<input aria-label="受托排班发布理由" className={input} value={reason} maxLength={200} onChange={e => { changed(); setReason(e.target.value); }}/></label>
      <button type="button" className={button} onClick={() => { setAck(false); setPreview(null); onDirty(); try { if (!scheduleDelegationReasonValid(reason)) throw Error("请填写有效发布理由。"); setPreview(previewDelegatedSchedule(rows, schedule, fromDate, throughDate)); setMessage("已生成本地预览，尚未发布；请核对全部时段及版本。"); } catch (e) { setMessage(e instanceof Error ? e.message : "无法预览，请检查时间。"); } }}>预览受托班次</button>
      {message && <p role="status" className="text-sm text-amber-900">{message}</p>}{preview && <div data-schedule-delegation-preview className="space-y-2 rounded-xl bg-blue-50 p-3 text-sm"><p>{schedule.grant.worker.name} · {schedule.grant.location.name} · {schedule.timeZone}</p><p>授权 {schedule.grant.grantId} · 授权版本 {schedule.grant.revision} · 排班版本 {schedule.revision} · 设置版本 {schedule.settingsVersion} · 人员版本 {schedule.workerVersion} · 地点版本 {schedule.locationVersion}</p><ol className="space-y-1">{preview.map(([a, b], i) => <li className="break-all" key={i}>第{i + 1}段 UTC：{a} → {b}</li>)}</ol><p>理由：{reason}</p></div>}
      <label className="flex gap-2 text-sm"><input aria-label="确认受托排班预览" type="checkbox" checked={ack} disabled={!preview} onChange={e => { setAck(e.target.checked); onDirty(); }}/>已核对人员、地点、日期、全部时段、理由、版本及授权</label><button className={button} disabled={!ready}>明确发布受托班次</button>
    </fieldset>
  </form>;
}
function ReasonAction({ label, submit, disabled, onDirty, onSubmit }: { label: string; submit: string; disabled: boolean; onDirty: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState(""), [ack, setAck] = useState(false);
  return <form className="space-y-2" onSubmit={e => { e.preventDefault(); if (!disabled && ack && scheduleDelegationReasonValid(reason)) onSubmit(reason); }}><label className="block text-sm">{label}<input className={input} aria-label={label} value={reason} maxLength={200} disabled={disabled} onChange={e => { setReason(e.target.value); setAck(false); onDirty(); }}/></label><label className="flex gap-2 text-sm"><input aria-label={`确认${submit}`} type="checkbox" checked={ack} disabled={disabled} onChange={e => { setAck(e.target.checked); onDirty(); }}/>已核对此项对象、版本与理由</label><button className={button} disabled={disabled || !ack || !scheduleDelegationReasonValid(reason)}>{submit}</button></form>;
}
export function ScheduleDelegationReceipt({ result }: { result: ScheduleDelegationResult }) {
  const r = result.receipt; if (!r) return null;
  return <section aria-label="排班委托最小回执" data-schedule-delegation-receipt={r.action} className="min-w-0 space-y-2 rounded-xl bg-emerald-50 p-3 text-sm"><p className="font-semibold">{actionNames[r.action]}</p><p className="break-all">原操作编号：{r.operationId}<br/>授权编号：{r.grantId}<br/>真实操作者：{r.actorId}<br/>记录时间：{r.recordedAt}</p><p>保存授权版本 {r.grantRevision}{r.scheduleRevision === null ? "" : ` · 保存排班版本 ${r.scheduleRevision}`}</p><p>这是原操作结果，未恢复排班权限；不显示本地待确认命令中的人员、理由或班次正文。不证明当前班次未取消，也不代表已核准规则或出勤。</p></section>;
}
