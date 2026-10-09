"use client";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AttendanceMissingDelegationClient } from "@/lib/merchantAttendanceMissingDelegationClient";
import type { MissingDelegationGrant, MissingDelegationCatalogItem,
  MissingDelegationDelegateResponse, MissingDelegationResponse } from "@/lib/merchantAttendanceMissingDelegation";
import type { MissingDelegationPanelProps } from "./MerchantAttendanceMissingDelegationLauncher";

const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40";
const input = "mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white p-2 text-sm disabled:bg-slate-50";
type Props = MissingDelegationPanelProps & { onClose: () => void };
type CatalogKind = "delegates" | "workers" | "locations";
type Choices = { delegate: MissingDelegationCatalogItem | null; worker: MissingDelegationCatalogItem | null; location: MissingDelegationCatalogItem | null };
type GrantDraft = { from: string; until: string; reason: string; ack: boolean };
const emptyDraft = (): GrantDraft => ({ from: "", until: "", reason: "", ack: false });
const catalogNames: Record<CatalogKind, string> = { delegates: "受托审批员工", workers: "目标考勤员工", locations: "申请保存地点" };
export const missingDelegationReasonValid = (value: string) => value === value.trim() && [...value].length >= 1 && [...value].length <= 200 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
export function missingDelegationUtc(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || value.startsWith("0000")) throw Error("invalid_utc");
  const iso = value + ":00.000Z", time = Date.parse(iso);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== iso) throw Error("invalid_utc");
  return value + ":00.000000Z";
}
export function confirmMissingDelegationAction(confirm: () => boolean, current: () => boolean, submit: () => void): boolean {
  if (!current() || !confirm() || !current()) return false; submit(); return true;
}
export default function MerchantAttendanceMissingDelegationPanel(props: Props) {
  const enabled = props.enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_MISSING_DELEGATION_ENABLED === "1";
  return <Prepared key={`${props.siteId}:${props.access}:${props.actorId}`} {...props} enabled={enabled}/>;
}
function Prepared(props: Props & { enabled: boolean }) {
  const { siteId, access, actorId, apiFetch, enabled } = props;
  const client = useMemo(() => { try { return new AttendanceMissingDelegationClient({ siteId, access, actorId, apiFetch, enabled, storage: () => sessionStorage }); } catch { return null; } }, [siteId, access, actorId, apiFetch, enabled]);
  return client ? <Screen {...props} client={client}/> : <section aria-label="漏卡审批委托" className="p-4"><p role="alert">当前身份无法核对漏卡委托，未读取或提交。</p><button type="button" className={button} onClick={props.onClose}>关闭漏卡委托</button></section>;
}
function Screen({ client, access, enabled, onClose, registerLeaveGuard }: Props & { enabled: boolean; client: AttendanceMissingDelegationClient }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [shown, setShown] = useState(false), [draft, setDraft] = useState<GrantDraft>(emptyDraft), [formEpoch, setFormEpoch] = useState(0);
  const dirty = useRef(false), epoch = useRef(0);
  const clearDraft = useCallback(() => { dirty.current = false; setDraft(emptyDraft()); setFormEpoch(value => value + 1); }, []);
  const leave = useCallback(() => { const generation = epoch.current;
    return (!(dirty.current || client.hasLeaveRisk()) || window.confirm("离开会清除未提交的委托或审核意见。已发送操作不会撤销，原编号仍需核对；继续吗？")) && epoch.current === generation;
  }, [client]);
  useLayoutEffect(() => { registerLeaveGuard?.(leave); return () => registerLeaveGuard?.(null); }, [leave, registerLeaveGuard]);
  useLayoutEffect(() => {
    const hide = () => { epoch.current++; setShown(false); clearDraft(); client.pause(); };
    const show = () => { epoch.current++; clearDraft(); void client.initialize(); setShown(true); };
    const visibility = () => { if (document.hidden) hide(); else show(); };
    const unload = (event: BeforeUnloadEvent) => { if (dirty.current || client.hasLeaveRisk()) { event.preventDefault(); event.returnValue = ""; } };
    visibility(); document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hide); window.addEventListener("pageshow", show); window.addEventListener("beforeunload", unload);
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- invalidate the current lifetime, not a captured generation
      epoch.current++; client.pause(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); window.removeEventListener("beforeunload", unload); };
  }, [client, clearDraft]);
  const result = shown ? state.result : null, pending = shown ? state.pending : null;
  const busy = state.phase === "loading" || state.phase === "saving", editable = shown && !busy && !pending && state.phase === "ready";
  const markDirty = () => { epoch.current++; dirty.current = true; };
  const read = (run: () => void, discard = true) => { const generation = epoch.current;
    if (!shown || document.hidden || busy || discard && dirty.current && !window.confirm("读取其他资料会清除未提交输入，继续吗？")) return;
    if (generation !== epoch.current || document.hidden) return;
    epoch.current++; if (discard) clearDraft(); run();
  };
  const confirm = (message: string, run: () => void, safeRevoke = false) => { const generation = epoch.current, snapshot = client.getSnapshot();
    return confirmMissingDelegationAction(() => window.confirm(message), () => shown && !document.hidden && editable && (safeRevoke || enabled && !!result?.canWrite)
      && epoch.current === generation && client.getSnapshot() === snapshot, () => { epoch.current++; clearDraft(); run(); });
  };
  const operationId = pending ? "decision" in pending.command ? pending.command.decision.operationId : pending.command.operationId : null;
  const owner = result?.protocol === "missing-delegations-v1" ? result : null;
  const delegate = result?.protocol === "delegated-missing-v1" ? result : null;
  const catalogKind = state.query?.access === "owner" ? state.query.catalog : null;
  return <section aria-label="漏卡审批委托" data-missing-delegation className="min-w-0 space-y-4 p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><h2 className="text-xl font-bold">{access === "owner" ? "漏卡审批委托管理" : "受托漏卡审批"}</h2>
      <button type="button" className={button} onClick={() => { if (leave()) { client.pause(); onClose(); } }}>关闭漏卡委托</button></header>
    <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6">仅限整段漏卡审批，不是全企业管理授权。每项委托同时限定一位审批员工、一位目标员工和一个申请保存地点；不是当前默认地点。批准会按现有规则进入核定工时，不生成原始打卡，不修改工资，不绕过封存、身份或冲突检查。</p>
    {!enabled && <p className="text-sm text-amber-900">新委托及新审批入口已关闭；可明确核对原编号，当前负责人仍可对已核验的授予安全撤权。服务端若不可读取，编号继续保留，不能保证立即恢复。</p>}
    <p role="status" aria-live="polite" className="break-words rounded-xl bg-blue-50 p-3 text-sm">{state.message}</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!shown || !enabled || busy || !!pending} onClick={() => read(() => { void client.load(); })}>{access === "owner" ? "读取漏卡委托列表" : "读取我的有效委托"}</button>
      {pending && <button type="button" className={button} disabled={!shown || busy} onClick={() => read(() => { void client.recover(); })}>核对原漏卡委托编号</button>}</div>
    {operationId && <div data-missing-delegation-pending className="space-y-1 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm"><p>结果待确认，仅核对原编号，不自动重发或另起操作。此待确认不会锁住正常打卡或安全下班。</p><p className="break-all">原操作编号：{operationId}</p><p>未重新授权前不从本地命令显示申请正文、理由或人员资料。</p></div>}
    {result && <>
      {!result.canWrite && <p className="text-sm text-amber-900">当前不能新授予或审批。只读结果不代表仍有审批权限；负责人安全撤权另行核验。</p>}
      <MissingDelegationReceipt result={result}/>
      {owner && <>
        {enabled && !owner.detail && !owner.receipt && <>
          <MissingDelegationChoices choices={state.choices}/>
          <div className="flex flex-wrap gap-2">{(Object.keys(catalogNames) as CatalogKind[]).map(kind => <button key={kind} type="button" className={button} disabled={!editable || !owner.canWrite}
            onClick={() => read(() => { void client.catalog(kind); }, false)}>选择{catalogNames[kind]}</button>)}</div>
          {owner.mode === "catalog" && catalogKind && <MissingDelegationCatalog key={`${catalogKind}:${owner.readAt}`} kind={catalogKind} items={owner.catalogItems} disabled={!editable || !owner.canWrite}
            onSelect={item => { markDirty(); setDraft(value => ({ ...value, ack: false })); if (catalogKind === "delegates") client.selectDelegate(item); else if (catalogKind === "workers") client.selectWorker(item); else client.selectLocation(item); }}
            hasNext={!!owner.nextId} onNext={() => read(() => { void client.next(); }, false)}/>}
          <MissingDelegationGrantForm draft={draft} choices={state.choices} disabled={!editable || !owner.canWrite} onDraft={value => { markDirty(); setDraft(value); }}
            onGrant={value => confirm("确认授予这一个员工、目标人员与保存地点的独立漏卡审批权限？不会自动授予其他管理权限。", () => { void client.grant(value); })}/>
        </>}
        {owner.detail ? <MissingDelegationGrantView key={`${owner.detail.grantId}:${owner.detail.revision}:${formEpoch}`} grant={owner.detail} owner disabled={!editable}
          onDirty={markDirty} onRevoke={reason => confirm("确认撤销此漏卡审批委托？已完成决定不撤销，不能再凭旧页面审批。", () => { void client.revoke(owner.detail!.grantId, reason); }, true)}/>
          : owner.mode === "list" && <GrantList grants={owner.items} access="owner" disabled={!editable} onOpen={grant => read(() => { void client.detailGrant(grant.grantId); })}/>} 
        {owner.mode === "list" && owner.nextId && <button type="button" className={button} disabled={!editable} onClick={() => read(() => { void client.next(); })}>下一页委托</button>}
        {!owner.detail && owner.receipt?.action === "grant" && owner.receipt.revision === 1 && <SafeRevoke key={`${owner.receipt.operationId}:${formEpoch}`} disabled={!editable} onDirty={markDirty}
          onRevoke={reason => confirm("确认按刚核验的原授予编号安全撤权？由服务端重新核对当前负责人及委托状态。", () => { void client.revoke(owner.receipt!.grantId, reason); }, true)}/>}
      </>}
      {delegate && <>
        {delegate.mode === "grants" && <><GrantList grants={delegate.grants} access="delegate" disabled={!editable || !enabled} onOpen={grant => read(() => { void client.requests(grant.grantId); })}/>
          {delegate.nextId && <button type="button" className={button} disabled={!editable} onClick={() => read(() => { void client.next(); })}>下一页本人委托</button>}</>}
        {delegate.detail ? <MissingDelegationDetailView key={`${delegate.detail.requestId}:${delegate.detail.evidenceToken}:${formEpoch}`} detail={delegate.detail} disabled={!editable || !enabled || !delegate.canWrite}
          onDirty={markDirty} onDecide={(action, reason) => confirm(action === "approve" ? "明确批准此整段漏卡申请？批准会影响核定工时，旧检查和封存仍在事务内核验。" : "明确驳回此整段漏卡申请并保存理由？", () => { void client.decide(action, reason); })}/>
          : delegate.mode === "list" && <section aria-label="范围内待审漏卡" className="space-y-2"><h3 className="font-bold">所选委托内的待审申请</h3>
            {!delegate.items.length && <p className="text-sm">本页没有可处理申请；不代表没有出勤，也不表示有权查看范围外资料。</p>}
            <ul className="space-y-2">{delegate.items.map(item => <li className="min-w-0 rounded-xl border p-3 text-sm" key={item.requestId}><p className="break-words">{item.workerName} · {item.locationName}</p><p className="break-all text-xs">申请 {item.requestId}<br/>提交 UTC {item.submittedAt} · 保存时区 {item.timeZone}</p>
              <button type="button" className={`${button} mt-2`} disabled={!editable || !enabled} onClick={() => { const q = state.query; if (q?.access === "delegate" && q.grantId) read(() => { void client.detailRequest(q.grantId!, item.requestId); }); }}>读取受托申请详情</button></li>)}</ul>
            {delegate.nextCursor && <button type="button" className={button} disabled={!editable} onClick={() => read(() => { void client.next(); })}>下一页范围内申请</button>}
          </section>}
      </>}
    </>}
    <p className="text-xs leading-6 text-slate-500">不自动读取或轮询；每次明确查询均重新鉴权。只有当前负责人能授予和撤权，受托者不能转授或处理本人申请。双方换绑需要重新授权。本标签页只保存小型原操作意图用于核验，清理存储或关闭标签页后不能保证恢复。</p>
  </section>;
}
export function MissingDelegationChoices({ choices }: { choices: Choices }) {
  return <section aria-label="本次明确选择" className="space-y-2 rounded-xl bg-slate-50 p-3 text-sm"><h3 className="font-semibold">本次明确选择（不会自动选中）</h3>
    <p className="break-words">受托审批员工：{choices.delegate?.name ?? "未选择"}</p><p className="break-words">目标考勤员工：{choices.worker ? `${choices.worker.name} · ${choices.worker.workerNo}` : "未选择"}</p><p className="break-words">申请保存地点：{choices.location ? `${choices.location.name} · ${choices.location.timeZone}` : "未选择"}</p>
    <p className="text-xs">仅能从当前服务端目录中明确选择；查看权限不等于漏卡审批权限。</p></section>;
}
export function MissingDelegationCatalog({ kind, items, disabled, onSelect, hasNext, onNext }: { kind: CatalogKind; items: MissingDelegationCatalogItem[]; disabled: boolean; onSelect: (item: MissingDelegationCatalogItem) => void; hasNext: boolean; onNext: () => void }) {
  const [filter, setFilter] = useState("");
  const shown = items.filter(item => `${item.name} ${item.workerNo ?? ""} ${item.timeZone ?? ""}`.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()));
  return <section aria-label={`${catalogNames[kind]}目录`} data-missing-delegation-catalog={kind} className="min-w-0 space-y-2 rounded-xl border p-3"><h3 className="font-semibold">{catalogNames[kind]}目录 · 本页 {items.length} 项</h3>
    <label className="block text-sm">筛选当前页（不是全企业搜索）<input aria-label="筛选委托目录当前页" className={input} value={filter} disabled={disabled} onChange={event => setFilter(event.target.value)}/></label>
    {!shown.length && <p className="text-sm">本页没有符合筛选的项目；可清除筛选或明确读取下一页。</p>}
    <ul className="space-y-2">{shown.map(item => <li data-missing-delegation-catalog-id={item.id} className="min-w-0 rounded-lg bg-slate-50 p-2 text-sm" key={item.id}><p className="break-words">{item.name}{item.workerNo ? ` · 工号 ${item.workerNo}` : ""}{item.timeZone ? ` · ${item.timeZone}` : ""}</p><button type="button" className={`${button} mt-1`} disabled={disabled} onClick={() => onSelect(item)}>选用此{catalogNames[kind]}</button></li>)}</ul>
    <button type="button" className={button} disabled={disabled || !hasNext} onClick={onNext}>下一页目录</button></section>;
}
export function MissingDelegationGrantForm({ draft, choices, disabled, onDraft, onGrant }: { draft: GrantDraft; choices: Choices; disabled: boolean; onDraft: (value: GrantDraft) => void; onGrant: (value: { validFrom: string; validUntil: string; reason: string }) => void }) {
  let bounds: { validFrom: string; validUntil: string } | null = null;
  try { const validFrom = missingDelegationUtc(draft.from), validUntil = missingDelegationUtc(draft.until); if (validFrom < validUntil) bounds = { validFrom, validUntil }; } catch { /* No implicit device-local conversion. */ }
  const valid = !!choices.delegate && !!choices.worker && !!choices.location && choices.delegate.employeeId !== choices.worker.employeeId
    && choices.delegate.employeeAuthUserId !== choices.worker.employeeAuthUserId && !!bounds && missingDelegationReasonValid(draft.reason);
  const change = (patch: Partial<GrantDraft>) => onDraft({ ...draft, ...patch, ack: false });
  return <form aria-label="授予单项漏卡审批委托" className="min-w-0 space-y-3 rounded-xl border p-3" onSubmit={event => { event.preventDefault(); if (!disabled && valid && draft.ack && bounds) onGrant({ ...bounds, reason: draft.reason }); }}>
    <h3 className="font-semibold">明确授予一项委托</h3><p className="text-xs leading-6">有效期输入按 UTC，不是手机当地时间；开始含、结束不含。此期限控制何时可以审批，不改写申请保存地点，不延长员工申请期限。不能授权自己处理自己的申请。</p>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">{([['from', '委托开始时间（UTC）'], ['until', '委托结束时间（UTC）']] as const).map(([key, label]) => <label className="block min-w-0 text-sm" key={key}>{label}<input aria-label={label} type="datetime-local" step={60} className={input} disabled={disabled} value={draft[key]} onChange={event => change({ [key]: event.target.value })}/></label>)}</div>
    {bounds && <p className="break-all text-xs">将保存 UTC：{bounds.validFrom} → {bounds.validUntil}</p>}
    <label className="block text-sm">授权理由（1–200 字）<input aria-label="漏卡委托授权理由" className={input} disabled={disabled} maxLength={400} value={draft.reason} onChange={event => change({ reason: event.target.value })}/></label>
    <label className="flex items-start gap-2 text-sm"><input aria-label="确认漏卡审批委托" type="checkbox" disabled={disabled || !valid} checked={draft.ack} onChange={event => onDraft({ ...draft, ack: event.target.checked })}/><span>已核对三项明确选择、双方身份与 UTC 有效期，了解这是独立审批授权，不会赋予其他管理权限。</span></label>
    <button type="submit" className={button} disabled={disabled || !valid || !draft.ack}>明确授予漏卡审批委托</button></form>;
}
export function MissingDelegationGrantView({ grant: g, owner, disabled = true, onDirty = () => {}, onRevoke = () => {} }: { grant: MissingDelegationGrant; owner: boolean; disabled?: boolean; onDirty?: () => void; onRevoke?: (reason: string) => void }) {
  return <article data-missing-delegation-grant className="min-w-0 space-y-2 rounded-xl border p-3 text-sm"><h3 className="break-words font-semibold">{g.delegate.name} → {g.worker.name} · {g.location.name}</h3>
    <p>{g.status === "revoked" ? "已撤销" : g.usable ? "本次读取可用" : "当前不可用"} · 委托版本 {g.revision}</p>
    <p className="break-all text-xs">有效 UTC：{g.validFrom} → {g.validUntil}<br/>保存地点时区：{g.location.timeZone}<br/>委托 {g.grantId}</p><p className="break-words">授权理由：{g.reason}</p>
    <details className="break-all text-xs"><summary>核对保存身份与授予依据</summary>受托员工 {g.delegate.employeeId}<br/>受托 Auth {g.delegate.authUserId}<br/>目标档案 {g.worker.workerId}<br/>目标员工 {g.worker.employeeId}<br/>目标 Auth {g.worker.authUserId}<br/>地点 {g.location.locationId}<br/>授予人 {g.grantedBy}<br/>授予 UTC {g.grantedAt}</details>
    {g.revocation && <p className="break-all text-xs">撤销 UTC {g.revocation.recordedAt}<br/>撤销操作 {g.revocation.operationId} · 操作者 {g.revocation.actorId}<br/>{g.revocation.reason}</p>}
    {owner && g.status === "granted" && g.revision === 1 && <SafeRevoke disabled={disabled} onDirty={onDirty} onRevoke={onRevoke}/>}</article>;
}
function GrantList({ grants, access, disabled, onOpen }: { grants: MissingDelegationGrant[]; access: "owner" | "delegate"; disabled: boolean; onOpen: (grant: MissingDelegationGrant) => void }) {
  return <section aria-label="漏卡审批委托列表" className="space-y-2"><h3 className="font-semibold">{access === "owner" ? "已保存的委托" : "本次可见的本人委托"}</h3>
    {!grants.length && <p className="text-sm">本页没有可显示委托；已有记录查看权限不会自动变成审批权限。</p>}
    <ul className="space-y-2">{grants.map(grant => <li data-missing-delegation-grant-id={grant.grantId} className="min-w-0 rounded-xl border p-3 text-sm" key={grant.grantId}><p className="break-words">{grant.delegate.name} → {grant.worker.name} · {grant.location.name}</p><p className="break-all text-xs">UTC {grant.validFrom} → {grant.validUntil}<br/>{grant.status === "revoked" ? "已撤销" : grant.usable ? "本次读取可用" : "当前不可用"}</p>
      <button type="button" className={`${button} mt-2`} disabled={disabled || access === "delegate" && !grant.usable} onClick={() => onOpen(grant)}>{access === "owner" ? "核对委托与撤权" : "读取此委托待审申请"}</button></li>)}</ul></section>;
}
function SafeRevoke({ disabled, onDirty, onRevoke }: { disabled: boolean; onDirty: () => void; onRevoke: (reason: string) => void }) {
  const [reason, setReason] = useState(""), [ack, setAck] = useState(false);
  return <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm"><p>安全撤权不撤销已完成的审批。暂停新功能时，当前负责人仍可明确撤权。</p>
    <label className="block">撤权理由<input aria-label="漏卡委托撤权理由" className={input} value={reason} disabled={disabled} maxLength={400} onChange={event => { onDirty(); setReason(event.target.value); setAck(false); }}/></label>
    <label className="flex gap-2"><input aria-label="确认撤销漏卡委托" type="checkbox" disabled={disabled || !missingDelegationReasonValid(reason)} checked={ack} onChange={event => { onDirty(); setAck(event.target.checked); }}/><span>确认撤销此原委托，不影响已保存历史。</span></label>
    <button type="button" className={button} disabled={disabled || !ack || !missingDelegationReasonValid(reason)} onClick={() => onRevoke(reason)}>明确撤销漏卡委托</button></div>;
}
export function MissingDelegationDetailView({ detail: d, disabled = true, onDirty = () => {}, onDecide = () => {} }: { detail: NonNullable<MissingDelegationDelegateResponse["detail"]>; disabled?: boolean; onDirty?: () => void; onDecide?: (action: "approve" | "reject", reason: string) => void }) {
  const [reason, setReason] = useState(""), [ack, setAck] = useState(false);
  return <article data-missing-delegation-detail className="min-w-0 space-y-3 rounded-xl border p-3 text-sm"><h3 className="break-words font-bold">{d.workerName} · 待审整段漏卡</h3><p className="break-words">申请保存地点：{d.locationName} · {d.timeZone}</p>
    <p className="break-all text-xs">申报 UTC：{d.proposal.startAt} → {d.proposal.endAt}<br/>提交 UTC：{d.submittedAt}<br/>申请 {d.requestId}</p><p className="break-words">申请理由：{d.reason}</p>
    {d.proposal.breaks.length ? <ul className="space-y-1">{d.proposal.breaks.map((rest, i) => <li key={i} className="break-all text-xs">休息 {i + 1} UTC：{rest.startAt} → {rest.endAt} · {rest.paid ? "申报为带薪" : "申报为无薪"}</li>)}</ul> : <p>未申报休息。</p>}
    {d.blocked && <p role="alert" className="rounded-xl bg-amber-50 p-3">存在阻断条件，不能批准。范围外或混合冲突不在此披露，请交负责人核查；不要另填人员或地点绕过。</p>}
    <p className="text-xs">批准将按既有规则进入核定工时，不是原始打卡，也不自动计算工资。页面读取不替代提交时的授权、版本、来源和封存检查。</p>
    {(d.canApprove || d.canReject) && <div className="space-y-2"><label className="block">审核理由（1–200 字）<input aria-label="受托漏卡审核理由" className={input} disabled={disabled} value={reason} maxLength={400} onChange={event => { onDirty(); setReason(event.target.value); setAck(false); }}/></label>
      <label className="flex items-start gap-2"><input aria-label="确认受托漏卡审核" type="checkbox" disabled={disabled || !missingDelegationReasonValid(reason)} checked={ack} onChange={event => { onDirty(); setAck(event.target.checked); }}/><span>已核对完整申报、保存地点和限制，明确作出本次决定；不是本人的申请。</span></label>
      <div className="flex flex-wrap gap-2">{d.canApprove && <button type="button" className={button} disabled={disabled || d.blocked || !ack || !missingDelegationReasonValid(reason)} onClick={() => onDecide("approve", reason)}>明确批准受托漏卡</button>}
        {d.canReject && <button type="button" className={button} disabled={disabled || !ack || !missingDelegationReasonValid(reason)} onClick={() => onDecide("reject", reason)}>明确驳回受托漏卡</button>}</div></div>}
  </article>;
}
export function MissingDelegationReceipt({ result }: { result: MissingDelegationResponse }) {
  const r = result.receipt; if (!r) return null;
  return <section aria-label="漏卡委托最小操作回执" data-missing-delegation-receipt className="min-w-0 space-y-2 rounded-xl bg-emerald-50 p-3 text-sm"><h3 className="font-semibold">原操作结果 · {r.action === "grant" ? "已授予" : r.action === "revoke" ? "已撤销" : r.action === "approve" ? "已批准" : "已驳回"}</h3>
    <p className="break-all">操作 {r.operationId}<br/>委托 {r.grantId}<br/>UTC {r.recordedAt}</p>
    {"requestId" in r && <p className="break-all">申请 {r.requestId}<br/>实际审核者 Auth {r.actorId}</p>}
    {"revision" in r && <p>保存委托版本 {r.revision}</p>}
    <details className="break-all text-xs"><summary>原命令匹配指纹</summary>{r.commandFingerprint}</details>
    <p>这是最小不可变回执，未恢复审批权限，也未重新核查当前申请。不会从本地旧意图补回姓名、区间、正文或理由。</p></section>;
}
