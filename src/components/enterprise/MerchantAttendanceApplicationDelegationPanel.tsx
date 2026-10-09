"use client";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AttendanceApplicationDelegationClient } from "@/lib/merchantAttendanceApplicationDelegationClient";
import type { ApplicationDelegationGrant, ApplicationDelegationCatalogItem, ApplicationDelegationKind, ApplicationDelegationCategory,
  ApplicationDelegationDelegateResponse, ApplicationDelegationResponse } from "@/lib/merchantAttendanceApplicationDelegation";
import type { ApplicationDelegationPanelProps } from "./MerchantAttendanceApplicationDelegationLauncher";

const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40";
const input = "mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white p-2 text-sm disabled:bg-slate-50";
type Props = ApplicationDelegationPanelProps & { onClose: () => void };
type CatalogKind = "delegates" | "workers";
type Choices = { delegate: ApplicationDelegationCatalogItem | null; worker: ApplicationDelegationCatalogItem | null };
type Draft = { category: ApplicationDelegationCategory; kinds: ApplicationDelegationKind[]; includePending: boolean; historyAck: boolean; from: string; until: string; reason: string; ack: boolean };
type GrantInput = { category: ApplicationDelegationCategory; kinds: ApplicationDelegationKind[]; includePending: boolean; validFrom: string; validUntil: string; reason: string };
const kinds: ApplicationDelegationKind[] = ["trip", "field", "remote"];
const kindNames: Record<ApplicationDelegationKind, string> = { trip: "出差", field: "外勤", remote: "远程" };
const categoryNames = { leave: "请假", work_arrangement: "工作安排" };
const catalogNames: Record<CatalogKind, string> = { delegates: "受托审批员工", workers: "目标考勤员工" };
export const applicationDelegationEmptyDraft = (): Draft => ({ category: "leave", kinds: [], includePending: false, historyAck: false, from: "", until: "", reason: "", ack: false });
export const applicationDelegationReasonValid = (value: string) => value === value.trim() && [...value].length >= 1 && [...value].length <= 200 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
export function applicationDelegationUtc(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || value.startsWith("0000")) throw Error("invalid_utc");
  const iso = value + ":00.000Z", time = Date.parse(iso);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== iso) throw Error("invalid_utc"); return value + ":00.000000Z";
}
export function confirmApplicationDelegationAction(confirm: () => boolean, current: () => boolean, submit: () => void): boolean {
  if (!current() || !confirm() || !current()) return false; submit(); return true;
}
export function applicationDelegationDecisionReady(d: Pick<NonNullable<ApplicationDelegationDelegateResponse["detail"]>, "category" | "conflicts" | "blocked" | "sealed" | "canApprove" | "canReject">,
  action: "approve" | "reject", reason: string, ack: boolean, confirmConflicts: boolean, disabled = false): boolean {
  if (disabled || !ack || !applicationDelegationReasonValid(reason)) return false;
  return action === "reject" ? d.canReject : d.canApprove && !d.blocked && !d.sealed && (d.category !== "work_arrangement" || !d.conflicts.length || confirmConflicts);
}
export default function MerchantAttendanceApplicationDelegationPanel(props: Props) {
  const enabled = props.enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_APPLICATION_DELEGATION_ENABLED === "1";
  return <Prepared key={`${props.siteId}:${props.access}:${props.actorId}`} {...props} enabled={enabled}/>;
}
function Prepared(props: Props & { enabled: boolean }) {
  const { siteId, access, actorId, apiFetch, enabled } = props;
  const client = useMemo(() => { try { return new AttendanceApplicationDelegationClient({ siteId, access, actorId, apiFetch, enabled, storage: () => sessionStorage }); } catch { return null; } }, [siteId, access, actorId, apiFetch, enabled]);
  return client ? <Screen {...props} client={client}/> : <section aria-label="请假与工作安排委托" className="p-4"><p role="alert">当前身份无法核对申请委托，未读取或提交。</p><button type="button" className={button} onClick={props.onClose}>关闭申请委托</button></section>;
}
function Screen({ client, access, enabled, onClose, registerLeaveGuard }: Props & { enabled: boolean; client: AttendanceApplicationDelegationClient }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [shown, setShown] = useState(false), [draft, setDraft] = useState<Draft>(applicationDelegationEmptyDraft), [formEpoch, setFormEpoch] = useState(0);
  const dirty = useRef(false), epoch = useRef(0);
  const clearDraft = useCallback(() => { dirty.current = false; setDraft(applicationDelegationEmptyDraft()); setFormEpoch(value => value + 1); }, []);
  const leave = useCallback(() => { const generation = epoch.current; return (!(dirty.current || client.hasLeaveRisk())
    || window.confirm("离开会清除未提交的委托或审核意见。已发送操作不会撤销，原编号仍需核对；继续吗？")) && epoch.current === generation; }, [client]);
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
    if (generation !== epoch.current || document.hidden) return; epoch.current++; if (discard) clearDraft(); run(); };
  const confirm = (message: string, run: () => void, safeRevoke = false) => { const generation = epoch.current, snapshot = client.getSnapshot();
    return confirmApplicationDelegationAction(() => window.confirm(message), () => shown && !document.hidden && editable && (safeRevoke || enabled && !!result?.canWrite)
      && epoch.current === generation && client.getSnapshot() === snapshot, () => { epoch.current++; clearDraft(); run(); }); };
  const operationId = pending ? "decision" in pending.command ? pending.command.decision.operationId : pending.command.operationId : null;
  const owner = result?.protocol === "application-delegations-v1" ? result : null, delegate = result?.protocol === "delegated-applications-v1" ? result : null;
  const catalogKind = state.query?.access === "owner" ? state.query.catalog : null;
  return <section aria-label="请假与工作安排委托" data-application-delegation className="min-w-0 space-y-4 p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><h2 className="text-xl font-bold">{access === "owner" ? "请假与工作安排审批委托" : "受托请假与工作安排审批"}</h2><button type="button" className={button} onClick={() => { if (leave()) { client.pause(); onClose(); } }}>关闭申请委托</button></header>
    <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6">按目标人员及所选申请类别授权，不按门店限制，可能查看该人员跨门店申请的理由。请假与工作安排分别授权，工作安排仅限明确勾选的种类；不授权其他员工、全部历史或转授。只可批准／驳回，不能取消既有批准、改政策或自动重开封存。</p>
    <p className="text-sm leading-6">批准请假不扣余额、不算工资、不阻止打卡；批准出差／外勤／远程不证明实际出勤，不自动计工时或豁免异常。新委托不能批准已封存区间，需交当前负责人核验。</p>
    {!enabled && <p className="text-sm text-amber-900">新委托及新审批入口已关闭；可明确核对原编号，当前负责人仍可对已核验的授予安全撤权。服务端若不可读取，编号继续保留，不能保证立即恢复。</p>}
    <p role="status" aria-live="polite" className="break-words rounded-xl bg-blue-50 p-3 text-sm">{state.message}</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!shown || !enabled || busy || !!pending} onClick={() => read(() => { void client.load(); })}>{access === "owner" ? "读取申请委托列表" : "读取我的申请审批委托"}</button>
      {pending && <button type="button" className={button} disabled={!shown || busy} onClick={() => read(() => { void client.recover(); })}>核对原申请委托编号</button>}</div>
    {operationId && <div data-application-delegation-pending className="space-y-1 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm"><p>结果待确认，仅核对原编号，不自动重发或另起操作。不会锁住正常打卡或安全下班。</p><p className="break-all">原操作编号：{operationId}</p><p>未重新授权前不从本地命令显示申请正文、理由或人员资料。</p></div>}
    {result && <>{!result.canWrite && <p className="text-sm text-amber-900">当前不能新授予或审批。读取结果不代表仍有审批权限；负责人安全撤权另行核验。</p>}<ApplicationDelegationReceipt result={result}/>
      {owner && <>{enabled && !owner.detail && !owner.receipt && <>
        <ApplicationDelegationChoices choices={state.choices}/>
        <div className="flex flex-wrap gap-2">{(Object.keys(catalogNames) as CatalogKind[]).map(kind => <button key={kind} type="button" className={button} disabled={!editable || !owner.canWrite} onClick={() => read(() => { void client.catalog(kind); }, false)}>选择{catalogNames[kind]}</button>)}</div>
        {owner.mode === "catalog" && catalogKind && <ApplicationDelegationCatalog key={`${catalogKind}:${owner.readAt}`} kind={catalogKind} items={owner.catalogItems} disabled={!editable || !owner.canWrite}
          onSelect={item => { markDirty(); setDraft(value => ({ ...value, ack: false, historyAck: false })); if (catalogKind === "delegates") client.selectDelegate(item); else client.selectWorker(item); }} hasNext={!!owner.nextId} onNext={() => read(() => { void client.next(); }, false)}/>}
        <ApplicationDelegationGrantForm draft={draft} choices={state.choices} disabled={!editable || !owner.canWrite} onDraft={value => { markDirty(); setDraft(value); }}
          onGrant={value => confirm("确认授予这一人员、申请类别及有效期的独立审批权限？范围不按门店限制，包含此前待审的选择将一并保存。", () => { void client.grant(value); })}/>
      </>}
        {owner.detail ? <ApplicationDelegationGrantView key={`${owner.detail.grantId}:${owner.detail.revision}:${formEpoch}`} grant={owner.detail} owner disabled={!editable} onDirty={markDirty}
          onRevoke={reason => confirm("确认撤销此申请审批委托？已完成决定不撤销，不能再凭旧页面审批。", () => { void client.revoke(owner.detail!.grantId, reason); }, true)}/>
          : owner.mode === "list" && <GrantList grants={owner.items} access="owner" disabled={!editable} onOpen={grant => read(() => { void client.detailGrant(grant.grantId); })}/>}
        {owner.mode === "list" && owner.nextId && <button type="button" className={button} disabled={!editable} onClick={() => read(() => { void client.next(); })}>下一页申请委托</button>}
        {!owner.detail && owner.receipt?.action === "grant" && owner.receipt.revision === 1 && <SafeRevoke key={`${owner.receipt.operationId}:${formEpoch}`} disabled={!editable} onDirty={markDirty}
          onRevoke={reason => confirm("确认按刚核验的原授予编号安全撤权？服务端重新核对当前负责人及委托状态。", () => { void client.revoke(owner.receipt!.grantId, reason); }, true)}/>}
      </>}
      {delegate && <>{delegate.mode === "grants" && <><GrantList grants={delegate.grants} access="delegate" disabled={!editable || !enabled} onOpen={grant => read(() => { void client.requests(grant.grantId); })}/>
        {delegate.nextId && <button type="button" className={button} disabled={!editable} onClick={() => read(() => { void client.next(); })}>下一页本人申请委托</button>}</>}
        {delegate.detail ? <ApplicationDelegationDetailView key={`${delegate.detail.requestId}:${delegate.detail.evidenceFingerprint}:${formEpoch}`} detail={delegate.detail} disabled={!editable || !enabled || !delegate.canWrite} onDirty={markDirty}
          onDecide={(action, reason, conflicts) => confirm(action === "approve" ? "明确批准此申请？已显示冲突的确认不豁免隐藏阻断、身份、版本或封存检查。" : "明确驳回此申请并保存理由？", () => { void client.decide(action, reason, conflicts); })}/>
          : delegate.mode === "list" && <section aria-label="范围内待审申请" className="space-y-2"><h3 className="font-bold">所选委托内仍待审申请</h3>
            {!delegate.items.length && <p className="text-sm">本页没有可处理申请；不代表范围外或全部历史没有申请。</p>}
            <ul className="space-y-2">{delegate.items.map(item => <li data-application-delegation-request-id={item.requestId} className="min-w-0 rounded-xl border p-3 text-sm" key={item.requestId}><p className="break-words">{item.workerName} · {categoryNames[item.category]}{item.kind ? ` · ${kindNames[item.kind]}` : ""}</p><p className="break-all text-xs">申请 {item.requestId}<br/>申请 UTC {item.startAt} → {item.endAt}<br/>提交 UTC {item.submittedAt} · 保存时区 {item.timeZone}</p>
              <button type="button" className={`${button} mt-2`} disabled={!editable || !enabled} onClick={() => { const q = state.query; if (q?.access === "delegate" && q.grantId) read(() => { void client.detailRequest(q.grantId!, item.requestId); }); }}>读取受托申请详情</button></li>)}</ul>
            {delegate.nextCursor && <button type="button" className={button} disabled={!editable} onClick={() => read(() => { void client.next(); })}>下一页范围内申请</button>}
          </section>}
      </>}
    </>}
    <p className="text-xs leading-6 text-slate-500">不自动读取或轮询；每次明确查询均重新鉴权。换绑需要重新授权。未知结果仅保存小型原操作意图并明确 GET 核对，不迁移旧请假／工作安排编号；关闭标签页或清理存储后不能保证恢复。</p>
  </section>;
}
export function ApplicationDelegationChoices({ choices }: { choices: Choices }) {
  return <section aria-label="本次明确选择" className="space-y-2 rounded-xl bg-slate-50 p-3 text-sm"><h3 className="font-semibold">本次明确选择（不会自动选中）</h3><p className="break-words">受托审批员工：{choices.delegate?.name ?? "未选择"}</p><p className="break-words">目标考勤员工：{choices.worker ? `${choices.worker.name} · ${choices.worker.workerNo}` : "未选择"}</p><p className="text-xs">只能从当前服务端目录明确选择；具备某一类权限不表示另一类也可审批，提交时再次核验。</p></section>;
}
export function ApplicationDelegationCatalog({ kind, items, disabled, onSelect, hasNext, onNext }: { kind: CatalogKind; items: ApplicationDelegationCatalogItem[]; disabled: boolean; onSelect: (item: ApplicationDelegationCatalogItem) => void; hasNext: boolean; onNext: () => void }) {
  const [filter, setFilter] = useState(""); const shown = items.filter(item => `${item.name} ${item.workerNo ?? ""}`.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()));
  return <section aria-label={`${catalogNames[kind]}目录`} data-application-delegation-catalog={kind} className="min-w-0 space-y-2 rounded-xl border p-3"><h3 className="font-semibold">{catalogNames[kind]}目录 · 本页 {items.length} 项</h3>
    <label className="block text-sm">筛选当前页（不是全企业搜索）<input aria-label="筛选申请委托目录当前页" className={input} value={filter} disabled={disabled} onChange={event => setFilter(event.target.value)}/></label>
    {!shown.length && <p className="text-sm">本页没有符合筛选的项目；可清除筛选或明确读取下一页。</p>}
    <ul className="space-y-2">{shown.map(item => <li data-application-delegation-catalog-id={item.id} className="min-w-0 rounded-lg bg-slate-50 p-2 text-sm" key={item.id}><p className="break-words">{item.name}{item.workerNo ? ` · 工号 ${item.workerNo}` : ""}</p><button type="button" className={`${button} mt-1`} disabled={disabled} onClick={() => onSelect(item)}>选用此{catalogNames[kind]}</button></li>)}</ul>
    <button type="button" className={button} disabled={disabled || !hasNext} onClick={onNext}>下一页申请委托目录</button></section>;
}
export function ApplicationDelegationGrantForm({ draft, choices, disabled, onDraft, onGrant }: { draft: Draft; choices: Choices; disabled: boolean; onDraft: (value: Draft) => void; onGrant: (value: GrantInput) => void }) {
  let bounds: { validFrom: string; validUntil: string } | null = null;
  try { const validFrom = applicationDelegationUtc(draft.from), validUntil = applicationDelegationUtc(draft.until); if (validFrom < validUntil) bounds = { validFrom, validUntil }; } catch { /* No device-local conversion. */ }
  const selectedKinds = kinds.filter(kind => draft.kinds.includes(kind));
  const valid = !!choices.delegate && !!choices.worker && choices.delegate.employeeId !== choices.worker.employeeId && choices.delegate.employeeAuthUserId !== choices.worker.employeeAuthUserId
    && !!bounds && applicationDelegationReasonValid(draft.reason) && (draft.category === "leave" ? draft.kinds.length === 0 : selectedKinds.length > 0 && selectedKinds.length === draft.kinds.length)
    && (!draft.includePending || draft.historyAck);
  const change = (patch: Partial<Draft>) => onDraft({ ...draft, ...patch, ack: false, historyAck: false });
  return <form aria-label="授予单项申请审批委托" className="min-w-0 space-y-3 rounded-xl border p-3" onSubmit={event => { event.preventDefault(); if (!disabled && valid && draft.ack && bounds) onGrant({ ...bounds, category: draft.category, kinds: selectedKinds, includePending: draft.includePending, reason: draft.reason }); }}>
    <h3 className="font-semibold">分别授予一种申请类别</h3><label className="block text-sm">委托申请类别<select aria-label="委托申请类别" className={input} value={draft.category} disabled={disabled} onChange={event => change({ category: event.target.value as ApplicationDelegationCategory, kinds: [] })}><option value="leave">请假</option><option value="work_arrangement">工作安排</option></select></label>
    {draft.category === "work_arrangement" && <fieldset className="space-y-2"><legend className="text-sm font-semibold">明确勾选工作安排种类（至少一项）</legend>{kinds.map(kind => <label key={kind} className="flex gap-2 text-sm"><input aria-label={`授权${kindNames[kind]}审批`} type="checkbox" disabled={disabled} checked={draft.kinds.includes(kind)} onChange={event => change({ kinds: kinds.filter(value => value === kind ? event.target.checked : draft.kinds.includes(value)) })}/>{kindNames[kind]}</label>)}</fieldset>}
    <p className="text-sm text-amber-900">该人员所选申请类别，不按门店限制。按服务器保存的提交时间划分历史，而不是请假／安排发生日期；不会开放已终结历史。</p>
    <label className="flex items-start gap-2 text-sm"><input aria-label="包含此前仍待审申请" type="checkbox" disabled={disabled} checked={draft.includePending} onChange={event => change({ includePending: event.target.checked })}/><span>包含此前已提交且仍待审的申请（默认不包含）</span></label>
    {draft.includePending && <label className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm"><input aria-label="确认历史待审授权" type="checkbox" disabled={disabled} checked={draft.historyAck} onChange={event => onDraft({ ...draft, historyAck: event.target.checked, ack: false })}/><span>另行确认允许查看授权前仍待审申请的必要理由；并非全部历史或其他类别授权。</span></label>}
    <p className="text-xs">有效期按 UTC，不是手机当地时间；开始含、结束不含。它控制何时可以审批，不改变原申请时间。</p>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">{([['from', '申请委托开始时间（UTC）'], ['until', '申请委托结束时间（UTC）']] as const).map(([key, label]) => <label className="block min-w-0 text-sm" key={key}>{label}<input aria-label={label} type="datetime-local" step={60} className={input} disabled={disabled} value={draft[key]} onChange={event => change({ [key]: event.target.value })}/></label>)}</div>
    {bounds && <p className="break-all text-xs">将保存 UTC：{bounds.validFrom} → {bounds.validUntil}</p>}
    <label className="block text-sm">授权理由（1–200 字）<input aria-label="申请委托授权理由" className={input} disabled={disabled} maxLength={400} value={draft.reason} onChange={event => change({ reason: event.target.value })}/></label>
    <label className="flex items-start gap-2 text-sm"><input aria-label="确认申请审批委托" type="checkbox" disabled={disabled || !valid} checked={draft.ack} onChange={event => onDraft({ ...draft, ack: event.target.checked })}/><span>已核对两个人员身份、类别、种类、历史选择和 UTC 有效期，理解按人员而非门店授权。</span></label>
    <button type="submit" className={button} disabled={disabled || !valid || !draft.ack}>明确授予申请审批委托</button></form>;
}
function Scope({ grant: g }: { grant: ApplicationDelegationGrant }) {
  return <><p>{categoryNames[g.category]}{g.kinds.length ? ` · ${g.kinds.map(k => kindNames[k]).join("／")}` : ""} · 不按门店限制</p><p className="text-xs">{g.includePending ? "明确包含授予前已提交且仍待审的申请，不含已终结历史" : "仅授予时间起新提交的申请，不包含此前待审"}</p></>;
}
export function ApplicationDelegationGrantView({ grant: g, owner, disabled = true, onDirty = () => {}, onRevoke = () => {} }: { grant: ApplicationDelegationGrant; owner: boolean; disabled?: boolean; onDirty?: () => void; onRevoke?: (reason: string) => void }) {
  return <article data-application-delegation-grant className="min-w-0 space-y-2 rounded-xl border p-3 text-sm"><h3 className="break-words font-semibold">{g.delegate.name} → {g.worker.name}</h3><Scope grant={g}/><p>{g.status === "revoked" ? "已撤销" : g.usable ? "本次读取可用" : "当前不可用"} · 委托版本 {g.revision}</p>
    <p className="break-all text-xs">有效 UTC：{g.validFrom} → {g.validUntil}<br/>委托 {g.grantId}</p><p className="break-words">授权理由：{g.reason}</p>
    <details className="break-all text-xs"><summary>核对保存身份与授予依据</summary>受托员工 {g.delegate.employeeId}<br/>受托 Auth {g.delegate.authUserId}<br/>目标档案 {g.worker.workerId}<br/>目标员工 {g.worker.employeeId}<br/>目标 Auth {g.worker.authUserId}<br/>授予人 {g.grantedBy}<br/>授予 UTC {g.grantedAt}</details>
    {g.revocation && <p className="break-all text-xs">撤销 UTC {g.revocation.recordedAt}<br/>撤销操作 {g.revocation.operationId} · 操作者 {g.revocation.actorId}<br/>{g.revocation.reason}</p>}
    {owner && g.status === "granted" && g.revision === 1 && <SafeRevoke disabled={disabled} onDirty={onDirty} onRevoke={onRevoke}/>}</article>;
}
function GrantList({ grants, access, disabled, onOpen }: { grants: ApplicationDelegationGrant[]; access: "owner" | "delegate"; disabled: boolean; onOpen: (grant: ApplicationDelegationGrant) => void }) {
  return <section aria-label="申请审批委托列表" className="space-y-2"><h3 className="font-semibold">{access === "owner" ? "已保存的申请委托" : "本次可见的本人申请委托"}</h3>{!grants.length && <p className="text-sm">本页没有可显示委托，查看权限不会自动变成审批权限。</p>}
    <ul className="space-y-2">{grants.map(grant => <li data-application-delegation-grant-id={grant.grantId} className="min-w-0 rounded-xl border p-3 text-sm" key={grant.grantId}><p className="break-words">{grant.delegate.name} → {grant.worker.name}</p><Scope grant={grant}/><p className="break-all text-xs">UTC {grant.validFrom} → {grant.validUntil}<br/>{grant.status === "revoked" ? "已撤销" : grant.usable ? "本次读取可用" : "当前不可用"}</p><button type="button" className={`${button} mt-2`} disabled={disabled || access === "delegate" && !grant.usable} onClick={() => onOpen(grant)}>{access === "owner" ? "核对申请委托与撤权" : "读取此申请委托待审项"}</button></li>)}</ul></section>;
}
function SafeRevoke({ disabled, onDirty, onRevoke }: { disabled: boolean; onDirty: () => void; onRevoke: (reason: string) => void }) {
  const [reason, setReason] = useState(""), [ack, setAck] = useState(false);
  return <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm"><p>安全撤权不撤销已完成审批。暂停新功能时，当前负责人仍可对已核验委托明确撤权。</p><label className="block">撤权理由<input aria-label="申请委托撤权理由" className={input} value={reason} disabled={disabled} maxLength={400} onChange={event => { onDirty(); setReason(event.target.value); setAck(false); }}/></label>
    <label className="flex gap-2"><input aria-label="确认撤销申请委托" type="checkbox" disabled={disabled || !applicationDelegationReasonValid(reason)} checked={ack} onChange={event => { onDirty(); setAck(event.target.checked); }}/><span>确认撤销此原委托，不影响已保存历史。</span></label><button type="button" className={button} disabled={disabled || !ack || !applicationDelegationReasonValid(reason)} onClick={() => onRevoke(reason)}>明确撤销申请委托</button></div>;
}
export function ApplicationDelegationDetailView({ detail: d, disabled = true, onDirty = () => {}, onDecide = () => {} }: { detail: NonNullable<ApplicationDelegationDelegateResponse["detail"]>; disabled?: boolean; onDirty?: () => void; onDecide?: (action: "approve" | "reject", reason: string, confirmConflicts: boolean) => void }) {
  const [reason, setReason] = useState(""), [ack, setAck] = useState(false), [conflicts, setConflicts] = useState(false);
  const needsConflicts = d.category === "work_arrangement" && d.conflicts.length > 0;
  return <article data-application-delegation-detail className="min-w-0 space-y-3 rounded-xl border p-3 text-sm"><h3 className="break-words font-bold">{d.workerName} · 待审{categoryNames[d.category]}{d.kind ? ` · ${kindNames[d.kind]}` : ""}</h3><p className="break-all text-xs">申请 UTC：{d.startAt} → {d.endAt}<br/>保存时区 {d.timeZone}<br/>提交 UTC：{d.submittedAt}<br/>申请 {d.requestId}</p><p className="break-words">申请理由：{d.reason}</p>
    {d.blocked && <p role="alert" className="rounded-xl bg-amber-50 p-3">存在阻断，不能批准。未授权或历史范围外依据不在此披露，请交负责人核验；勾选确认不能绕过。</p>}
    {d.sealed && <p role="alert" className="rounded-xl bg-amber-50 p-3">涉及已封存期间，本委托不能批准；不在此重开。仍可按当前授权明确驳回。</p>}
    <section aria-label="已授权最小冲突摘要" className="space-y-2"><h4 className="font-semibold">审批必要的最小时间摘要</h4>{!d.conflicts.length ? <p className="text-sm">未显示可披露的重叠摘要，不代表没有隐藏阻断或实际出勤正常。</p> : <ul className="space-y-2">{d.conflicts.map((c, i) => <li data-application-delegation-conflict key={`${i}:${c.startAt}:${c.endAt}`} className="break-all rounded-lg bg-slate-50 p-2 text-xs">{c.source === "schedule" ? "目标员工排班时段" : c.kind === "leave" ? "授权内请假时段" : c.kind ? `授权内${kindNames[c.kind]}时段` : "授权内申请时段"} · UTC {c.startAt} → {c.endAt} · {c.timeZone}</li>)}</ul>}</section>
    <p className="text-xs">批准不改变工资、假期余额或真实打卡，不自动计工时或豁免异常；本入口不取消既有批准，也不修改政策。</p>
    {(d.canApprove || d.canReject) && <div className="space-y-2"><label className="block">审核理由（1–200 字）<input aria-label="受托申请审核理由" className={input} disabled={disabled} value={reason} maxLength={400} onChange={event => { onDirty(); setReason(event.target.value); setAck(false); }}/></label>
      {needsConflicts && d.canApprove && !d.blocked && !d.sealed && <label className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm"><input aria-label="确认已显示工作安排冲突" type="checkbox" disabled={disabled} checked={conflicts} onChange={event => { onDirty(); setConflicts(event.target.checked); setAck(false); }}/><span>已核对上方已授权冲突摘要，明确仍批准此工作安排；不代表可忽略任何隐藏阻断。</span></label>}
      <label className="flex items-start gap-2"><input aria-label="确认受托申请审核" type="checkbox" disabled={disabled || !applicationDelegationReasonValid(reason)} checked={ack} onChange={event => { onDirty(); setAck(event.target.checked); }}/><span>已核对完整申请、类别及限制，明确作出本次决定；不是本人的申请。</span></label>
      <div className="flex flex-wrap gap-2">{d.canApprove && <button type="button" className={button} disabled={!applicationDelegationDecisionReady(d, "approve", reason, ack, conflicts, disabled)} onClick={() => { if (applicationDelegationDecisionReady(d, "approve", reason, ack, conflicts, disabled)) onDecide("approve", reason, needsConflicts && conflicts); }}>明确批准受托申请</button>}
        {d.canReject && <button type="button" className={button} disabled={!applicationDelegationDecisionReady(d, "reject", reason, ack, false, disabled)} onClick={() => { if (applicationDelegationDecisionReady(d, "reject", reason, ack, false, disabled)) onDecide("reject", reason, false); }}>明确驳回受托申请</button>}</div></div>}
  </article>;
}
export function ApplicationDelegationReceipt({ result }: { result: ApplicationDelegationResponse }) {
  const r = result.receipt; if (!r) return null;
  return <section aria-label="申请委托最小操作回执" data-application-delegation-receipt className="min-w-0 space-y-2 rounded-xl bg-emerald-50 p-3 text-sm"><h3 className="font-semibold">原操作结果 · {r.action === "grant" ? "已授予" : r.action === "revoke" ? "已撤销" : r.action === "approve" ? "已批准" : "已驳回"}</h3><p className="break-all">操作 {r.operationId}<br/>委托 {r.grantId}<br/>UTC {r.recordedAt}</p>
    {"requestId" in r && <p className="break-all">{categoryNames[r.category]} · 申请 {r.requestId}<br/>实际审核者 Auth {r.actorId}</p>}{"revision" in r && <p>保存委托版本 {r.revision}</p>}
    <details className="break-all text-xs"><summary>原命令匹配指纹</summary>{r.commandFingerprint}</details><p>这是最小不可变回执，未恢复审批权限，也未重新核查当前申请。不从本地旧意图补回姓名、区间、正文或理由。</p></section>;
}
