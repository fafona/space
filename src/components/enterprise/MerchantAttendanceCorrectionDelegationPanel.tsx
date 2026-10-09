"use client";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { AttendanceCorrectionDelegationClient } from "@/lib/merchantAttendanceCorrectionDelegationClient";
import type { CorrectionDelegationCatalogItem, CorrectionDelegationGrant, CorrectionDelegationDelegateResponse, CorrectionDelegationResponse } from "@/lib/merchantAttendanceCorrectionDelegation";

export type CorrectionDelegationPanelProps = { siteId: string; access: "owner" | "delegate"; actorId: string; authUserId: string;
  apiFetch: AttendanceApiFetch; enabled?: boolean; isCurrentAuth?: () => boolean; onClose: () => void; registerLeaveGuard?: (guard: (() => boolean) | null) => void };
type Catalog = "delegates" | "workers" | "locations";
type Choices = { delegate: CorrectionDelegationCatalogItem | null; worker: CorrectionDelegationCatalogItem | null; location: CorrectionDelegationCatalogItem | null };
export type CorrectionGrantDraft = { from: string; until: string; reason: string; includePending: boolean; acknowledged: boolean };
export const emptyCorrectionGrantDraft = (): CorrectionGrantDraft => ({ from: "", until: "", reason: "", includePending: false, acknowledged: false });
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40";
const input = "mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white p-2 text-sm";
const names: Record<Catalog, string> = { delegates: "受托审批员工", workers: "目标考勤员工", locations: "原始班次保存地点" };
export const correctionDelegationReasonValid = (v: string, max = 200) => v === v.trim() && [...v].length > 0 && [...v].length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(v);
export function correctionDelegationUtc(v: string) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(v) || v.startsWith("0000")) throw Error("invalid_utc");
  const iso = v + ":00.000Z", ms = Date.parse(iso); if (!Number.isFinite(ms) || new Date(ms).toISOString() !== iso) throw Error("invalid_utc"); return v + ":00.000000Z";
}
export function confirmCorrectionDelegation(confirm: () => boolean, current: () => boolean, run: () => void) {
  if (!current() || !confirm() || !current()) return false; run(); return true;
}
export function correctionDelegationPorts(fetch: AttendanceApiFetch, storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem">, current: () => boolean) {
  const check = () => { if (!current()) throw Error("identity_changed"); };
  const target = () => { check(); const s = storage(); check(); return s; };
  return { isCurrentAuth: current, storage: () => ({ getItem: (key: string) => { const v = target().getItem(key); check(); return v; },
    setItem: (key: string, value: string) => { target().setItem(key, value); check(); }, removeItem: (key: string) => { target().removeItem(key); check(); } }),
    apiFetch: (async (path, init) => { check(); const r = await fetch(path, init); if (!current()) { void r.body?.cancel().catch(() => {}); throw Error("identity_changed"); } return r; }) satisfies AttendanceApiFetch };
}
/* eslint-disable react-hooks/refs -- Monotonic render-time revocation fences stale async work before effects. Abandoned renders only invalidate; they cannot grant authority. */
export default function MerchantAttendanceCorrectionDelegationPanel(props: CorrectionDelegationPanelProps) {
  const { isCurrentAuth } = props;
  const enabled = props.enabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_CORRECTION_DELEGATION_ENABLED === "1";
  const key = JSON.stringify([props.siteId, props.access, props.actorId, props.authUserId, enabled]);
  const live = useRef({ key, fetch: props.apiFetch, auth: props.isCurrentAuth, token: 0 });
  if (live.current.key !== key || live.current.fetch !== props.apiFetch || live.current.auth !== props.isCurrentAuth) live.current = { key, fetch: props.apiFetch, auth: props.isCurrentAuth, token: live.current.token + 1 };
  const token = live.current.token, isCurrent = useCallback(() => live.current.token === token && isCurrentAuth?.() !== false, [token, isCurrentAuth]);
  return <Prepared key={token} {...props} enabled={enabled} isCurrent={isCurrent}/>;
}
/* eslint-enable react-hooks/refs */
function Prepared(props: CorrectionDelegationPanelProps & { enabled: boolean; isCurrent: () => boolean }) {
  const client = useMemo(() => { try { return new AttendanceCorrectionDelegationClient({ siteId: props.siteId, access: props.access, actorId: props.actorId,
    expectedAuthUserId: props.authUserId, enabled: props.enabled, ...correctionDelegationPorts(props.apiFetch, () => sessionStorage, props.isCurrent) }); } catch { return null; } },
  [props.siteId, props.access, props.actorId, props.authUserId, props.enabled, props.apiFetch, props.isCurrent]);
  return client ? <Screen {...props} client={client}/> : <section className="p-4"><p role="alert">无法核验当前身份，未读取或提交。</p><button className={button} onClick={props.onClose}>关闭补正委托</button></section>;
}
function Screen({ client, access, enabled, isCurrent, onClose, registerLeaveGuard }: CorrectionDelegationPanelProps & { client: AttendanceCorrectionDelegationClient; enabled: boolean; isCurrent: () => boolean }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [shown, setShown] = useState(false), [draft, setDraft] = useState(emptyCorrectionGrantDraft), [formEpoch, setFormEpoch] = useState(0);
  const dirty = useRef(false), epoch = useRef(0);
  const clear = useCallback(() => { dirty.current = false; setDraft(emptyCorrectionGrantDraft()); setFormEpoch(v => v + 1); }, []);
  const invalidate = useCallback(() => { epoch.current++; client.pause(); clear(); }, [client, clear]);
  const leave = useCallback(() => { const generation = epoch.current, snapshot = client.getSnapshot(); return confirmCorrectionDelegation(
    () => !(dirty.current || client.hasLeaveRisk()) || window.confirm("离开会清除未提交草稿；已发送操作不会撤销，待确认原编号仍需核对。继续吗？"),
    () => isCurrent() && epoch.current === generation && client.getSnapshot() === snapshot, invalidate); }, [client, invalidate, isCurrent]);
  useLayoutEffect(() => { registerLeaveGuard?.(leave); return () => registerLeaveGuard?.(null); }, [leave, registerLeaveGuard]);
  useLayoutEffect(() => { const generationRef = epoch; const hide = () => { flushSync(() => { invalidate(); setShown(false); }); };
    const show = () => { if (!isCurrent() || document.hidden) return; epoch.current++; clear(); void client.initialize(); setShown(true); };
    const visibility = () => document.hidden ? hide() : show(), unload = (e: BeforeUnloadEvent) => { if (dirty.current || client.hasLeaveRisk()) { e.preventDefault(); e.returnValue = ""; } };
    if (!document.hidden) show(); document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hide); window.addEventListener("pageshow", show); window.addEventListener("beforeunload", unload);
    return () => { generationRef.current++; client.pause(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); window.removeEventListener("beforeunload", unload); };
  }, [client, clear, invalidate, isCurrent]);
  const visible = shown && isCurrent(), result = visible ? state.result : null, pending = visible ? state.pending : null;
  const busy = state.phase === "loading" || state.phase === "saving", editable = visible && state.phase === "ready" && !busy && !pending;
  const current = (generation: number, snapshot = state) => isCurrent() && shown && !document.hidden && generation === epoch.current && snapshot === client.getSnapshot();
  const mark = () => { epoch.current++; dirty.current = true; };
  const read = (run: () => void, discard = true) => { const generation = epoch.current, snapshot = client.getSnapshot(); if (!current(generation, snapshot) || busy) return;
    if (discard && dirty.current && !window.confirm("读取其他资料会清除未提交输入，继续吗？")) return;
    if (!current(generation, snapshot)) return; epoch.current++; if (discard) clear(); run(); };
  const confirm = (message: string, run: () => void, safeRevoke = false) => { const generation = epoch.current, snapshot = client.getSnapshot();
    return confirmCorrectionDelegation(() => window.confirm(message), () => current(generation, snapshot) && editable && (safeRevoke && access === "owner" || enabled && !!result?.canWrite),
      () => { epoch.current++; clear(); run(); }); };
  const owner = result?.protocol === "correction-delegations-v1" ? result : null, delegate = result?.protocol === "delegated-corrections-v1" ? result : null;
  const catalog = state.query?.access === "owner" ? state.query.catalog : null;
  const operationId = pending ? "decision" in pending.command ? pending.command.decision.operationId : pending.command.operationId : null;
  return <section aria-label="首次补正审批委托" className="min-w-0 space-y-4 p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><h2 className="text-xl font-bold">{access === "owner" ? "首次补正审批委托管理" : "受托首次补正审批"}</h2><button className={button} onClick={() => { if (leave()) onClose(); }}>关闭补正委托</button></header>
    <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6">只授予首次补正批准／驳回，不是连续修订或其他管理权限。范围同时限定审批员工、目标员工、原始班次保存地点及有效期；不是员工当前默认地点。不生成原始打卡、不计算工资，不绕过封存、来源和身份检查。</p>
    {!enabled && <p className="text-sm">新授予及审批关闭；当前负责人仍可核验委托并明确撤权，原操作者可只读核对原编号。</p>}
    <p role="status" className="break-words rounded-xl bg-blue-50 p-3 text-sm">{visible ? state.message : "页面已隐藏或身份变化，显示和草稿已清除，原编号保留。"}</p>
    <div className="flex flex-wrap gap-2"><button className={button} disabled={!visible || busy || !!pending || !enabled && access !== "owner"} onClick={() => read(() => { void client.load(); })}>{access === "owner" ? "读取补正委托列表" : "读取我的补正委托"}</button>
      {pending && <button className={button} disabled={busy} onClick={() => read(() => { void client.recover(); })}>核对原补正委托编号</button>}</div>
    {operationId && <div className="rounded-xl border border-amber-300 p-3 text-sm"><p>结果待确认，只读取原编号，不自动重发，不显示本地旧申请或理由。</p><p className="break-all">原操作编号：{operationId}</p></div>}
    {result && <CorrectionDelegationReceipt result={result}/>}
    {owner && <>
      {enabled && !owner.detail && !owner.receipt && <><section className="min-w-0 break-words rounded-xl bg-slate-50 p-3 text-sm"><p>受托审批员工：{state.choices.delegate?.name ?? "未选择"}</p><p>目标考勤员工：{state.choices.worker?.name ?? "未选择"}</p><p>原始班次保存地点：{state.choices.location?.name ?? "未选择"}</p></section>
        <div className="flex flex-wrap gap-2">{(Object.keys(names) as Catalog[]).map(kind => <button key={kind} className={button} disabled={!editable || !owner.canWrite} onClick={() => read(() => { void client.catalog(kind); }, false)}>选择{names[kind]}</button>)}</div>
        {owner.mode === "catalog" && catalog && <section className="space-y-2"><h3>{names[catalog]}目录（本页）</h3><ul className="space-y-2">{owner.catalogItems.map(item => <li key={item.id} className="min-w-0 rounded-xl border p-3 text-sm"><p className="break-words">{item.name} {item.workerNo} {item.timeZone}</p><button className={button} disabled={!editable || !owner.canWrite} onClick={() => { if (!current(epoch.current) || !editable) return; mark(); setDraft(d => ({ ...d, acknowledged: false })); if (catalog === "delegates") client.selectDelegate(item); else if (catalog === "workers") client.selectWorker(item); else client.selectLocation(item); }}>选用此{names[catalog]}</button></li>)}</ul>{owner.nextId && <button className={button} disabled={!editable} onClick={() => read(() => { void client.next(); }, false)}>下一页目录</button>}</section>}
        <CorrectionDelegationGrantForm choices={state.choices} draft={draft} disabled={!editable || !owner.canWrite} onDraft={v => { if (current(epoch.current)) { mark(); setDraft(v); } }} onGrant={v => confirm("确认这一个审批员工、目标员工、保存地点和有效期的补正审批委托？包含已有待审的选择也将保存。", () => { void client.grant(v); })}/></>}
      {owner.detail ? <CorrectionDelegationGrantView key={`${owner.detail.grantId}:${owner.detail.revision}:${formEpoch}`} grant={owner.detail} owner disabled={!editable} onDirty={mark} onRevoke={reason => confirm("明确撤销此补正委托？已完成决定不撤销。", () => { void client.revoke(owner.detail!.grantId, reason); }, true)}/>
        : owner.mode === "list" && <GrantList grants={owner.items} owner disabled={!editable} onOpen={g => read(() => { void client.detailGrant(g.grantId); })}/>}
      {owner.mode === "list" && owner.nextId && <button className={button} disabled={!editable} onClick={() => read(() => { void client.next(); })}>下一页委托</button>}
      {!owner.detail && owner.receipt?.action === "grant" && <p className="text-sm">回执不是当前授权状态；请明确重新读取委托详情后撤权。</p>}
    </>}
    {delegate && <>
      {delegate.mode === "grants" && <><GrantList grants={delegate.grants} owner={false} disabled={!editable || !enabled} onOpen={g => read(() => { void client.requests(g.grantId); })}/>{delegate.nextId && <button className={button} disabled={!editable || !enabled} onClick={() => read(() => { void client.next(); })}>下一页本人委托</button>}</>}
      {delegate.detail ? <CorrectionDelegationDetailView key={`${delegate.detail.requestId}:${delegate.detail.evidenceToken}:${formEpoch}`} detail={delegate.detail} disabled={!editable || !enabled || !delegate.canWrite} onDirty={mark} onDecide={(action, reason) => confirm(action === "approve" ? "明确批准首次补正？按现有规则影响核定工时，提交时重新核对来源与封存。" : "明确驳回首次补正并保存理由？", () => { void client.decide(action, reason); })}/>
        : delegate.mode === "list" && <section aria-label="范围内待审补正" className="space-y-2"><h3 className="font-semibold">所选委托内的待审首次补正</h3>{!delegate.items.length && <p>本页没有可见待审；不代表其他范围没有申请。</p>}<ul className="space-y-2">{delegate.items.map(item => <li key={item.requestId} className="min-w-0 rounded-xl border p-3 text-sm"><p className="break-words">{item.workerName} · {item.locationName}</p><p className="break-all text-xs">提交 UTC {item.submittedAt}<br/>申请 {item.requestId}</p><button className={button} disabled={!editable || !enabled} onClick={() => { const q = state.query; if (q?.access === "delegate" && q.grantId) read(() => { void client.detailRequest(q.grantId!, item.requestId); }); }}>读取受托补正详情</button></li>)}</ul>{delegate.nextCursor && <button className={button} disabled={!editable || !enabled} onClick={() => read(() => { void client.next(); })}>下一页待审补正</button>}</section>}
    </>}
    <p className="text-xs leading-6 text-slate-500">不自动读取或轮询。只可从本次目录选择；每次读取和提交重新鉴权，不自审批，不自动授予旧角色。原号仅保存在本标签页，请勿清除网站数据。</p>
  </section>;
}
export function CorrectionDelegationGrantForm({ choices, draft, disabled, onDraft, onGrant }: { choices: Choices; draft: CorrectionGrantDraft; disabled: boolean; onDraft: (v: CorrectionGrantDraft) => void; onGrant: (v: { includePending: boolean; validFrom: string; validUntil: string; reason: string }) => void }) {
  let dates: { validFrom: string; validUntil: string } | null = null; try { const validFrom = correctionDelegationUtc(draft.from), validUntil = correctionDelegationUtc(draft.until); if (validFrom < validUntil) dates = { validFrom, validUntil }; } catch { /* Explicit UTC only. */ }
  const valid = !!dates && !!choices.delegate && !!choices.worker && !!choices.location && choices.delegate.employeeId !== choices.worker.employeeId && choices.delegate.employeeAuthUserId !== choices.worker.employeeAuthUserId && correctionDelegationReasonValid(draft.reason);
  const change = (patch: Partial<CorrectionGrantDraft>) => onDraft({ ...draft, ...patch, acknowledged: false });
  return <form aria-label="授予首次补正委托" className="min-w-0 space-y-3 rounded-xl border p-3" onSubmit={e => { e.preventDefault(); if (!disabled && valid && draft.acknowledged && dates) onGrant({ ...dates, includePending: draft.includePending, reason: draft.reason }); }}>
    <p className="text-xs">日期按 UTC，不是本机当地时区；开始含、结束不含。未勾选“包含已有待审”时仅处理授予后提交的申请。</p><div className="grid min-w-0 gap-3 sm:grid-cols-2">{([['from', '补正委托开始时间（UTC）'], ['until', '补正委托结束时间（UTC）']] as const).map(([key, label]) => <label key={key} className="min-w-0 text-sm">{label}<input aria-label={label} className={input} type="datetime-local" step={60} disabled={disabled} value={draft[key]} onChange={e => change({ [key]: e.target.value })}/></label>)}</div>
    <label className="block text-sm">授权理由（1–200 字）<input aria-label="补正委托授权理由" className={input} disabled={disabled} value={draft.reason} maxLength={400} onChange={e => change({ reason: e.target.value })}/></label>
    <label className="flex gap-2 text-sm"><input type="checkbox" aria-label="包含已有待审补正" disabled={disabled} checked={draft.includePending} onChange={e => change({ includePending: e.target.checked })}/>明确包含授予前已提交的待审补正</label>
    <label className="flex gap-2 text-sm"><input type="checkbox" aria-label="确认首次补正委托" disabled={disabled || !valid} checked={draft.acknowledged} onChange={e => onDraft({ ...draft, acknowledged: e.target.checked })}/>已核对双方身份、保存地点、有效期及已有申请范围；不是自己审批本人。</label>
    <button className={button} disabled={disabled || !valid || !draft.acknowledged}>明确授予首次补正委托</button>
  </form>;
}
function GrantList({ grants, owner, disabled, onOpen }: { grants: CorrectionDelegationGrant[]; owner: boolean; disabled: boolean; onOpen: (g: CorrectionDelegationGrant) => void }) {
  return <section className="space-y-2"><h3 className="font-semibold">已读取的补正委托</h3>{!grants.length && <p>本页没有可见委托。</p>}<ul className="space-y-2">{grants.map(g => <li key={g.grantId} data-correction-grant-id={g.grantId} className="min-w-0 rounded-xl border p-3 text-sm"><p className="break-words">{g.delegate.name} → {g.worker.name} · {g.location.name}</p><p>{g.status === "revoked" ? "已撤销" : g.usable ? "本次可用" : "当前不可用"} · {g.includePending ? "含已有待审" : "仅授予后新申请"}</p><p className="break-all text-xs">UTC {g.validFrom} → {g.validUntil}</p><button className={button} disabled={disabled || !owner && !g.usable} onClick={() => onOpen(g)}>{owner ? "核对补正委托与撤权" : "读取此委托待审补正"}</button></li>)}</ul></section>;
}
export function CorrectionDelegationGrantView({ grant: g, owner, disabled = true, onDirty = () => {}, onRevoke = () => {} }: { grant: CorrectionDelegationGrant; owner: boolean; disabled?: boolean; onDirty?: () => void; onRevoke?: (reason: string) => void }) {
  const [reason, setReason] = useState(""), [ack, setAck] = useState(false);
  return <article className="min-w-0 space-y-2 rounded-xl border p-3 text-sm"><h3 className="break-words font-semibold">{g.delegate.name} → {g.worker.name} · {g.location.name}</h3><p>{g.status === "revoked" ? "已撤销" : g.usable ? "本次可用" : "当前不可用"} · 版本 {g.revision} · {g.includePending ? "包含已有待审" : "仅授予后新申请"}</p><p className="break-all">UTC {g.validFrom} → {g.validUntil}<br/>委托 {g.grantId}</p><p className="break-words">授权理由：{g.reason}</p>{g.revocation && <p className="break-words">已撤销：{g.revocation.recordedAt} · {g.revocation.reason}</p>}
    {owner && g.revision === 1 && g.status === "granted" && <div className="space-y-2"><p>撤权不撤销已完成审批；功能关闭时仍需当前负责人核验。</p><label className="block">撤权理由<input aria-label="补正委托撤权理由" className={input} disabled={disabled} value={reason} onChange={e => { onDirty(); setReason(e.target.value); setAck(false); }}/></label><label className="flex gap-2"><input aria-label="确认撤销补正委托" type="checkbox" disabled={disabled || !correctionDelegationReasonValid(reason)} checked={ack} onChange={e => { onDirty(); setAck(e.target.checked); }}/>明确撤销此项授权</label><button className={button} disabled={disabled || !ack || !correctionDelegationReasonValid(reason)} onClick={() => onRevoke(reason)}>明确撤销补正委托</button></div>}
  </article>;
}
export function CorrectionDelegationDetailView({ detail: d, disabled = true, onDirty = () => {}, onDecide = () => {} }: { detail: NonNullable<CorrectionDelegationDelegateResponse["detail"]>; disabled?: boolean; onDirty?: () => void; onDecide?: (action: "approve" | "reject", reason: string) => void }) {
  const [reason, setReason] = useState(""), [ack, setAck] = useState(false), valid = correctionDelegationReasonValid(reason, 500);
  return <article data-correction-delegation-detail className="min-w-0 space-y-3 rounded-xl border p-3 text-sm"><h3 className="break-words font-semibold">{d.workerName} · 首次补正核对</h3><p className="break-words">保存地点：{d.locationName} · 保存时区 {d.timeZone}</p><p className="break-all text-xs">申请 {d.requestId} · 版本 {d.revision}<br/>提交 UTC {d.submittedAt}</p>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">{([['原始完整记录', d.original], ['员工申请调整', d.proposal]] as const).map(([label, p]) => <section key={label} aria-label={label} className="min-w-0 rounded-xl bg-slate-50 p-3"><h4 className="font-semibold">{label}</h4><p className="break-all text-xs">UTC {p.startAt} → {p.endAt}</p>{p.breaks.length ? <ul>{p.breaks.map((b, n) => <li key={n} className="break-all text-xs">休息 {n + 1}：{b.startAt} → {b.endAt} · {b.paid ? "带薪" : "无薪"}</li>)}</ul> : <p>无休息区间。</p>}</section>)}</div>
    <p className="break-words">申请理由：{d.reason}</p>{d.blocked && <p role="alert" className="rounded-xl bg-amber-50 p-3">存在阻批准条件；不能批准。范围外或混合冲突只显示限制，不披露额外人员／事件；请交负责人核查。仍可驳回时不表示可批准。</p>}
    {d.blockers.length > 0 && <p className="break-all text-xs">本次限制：{d.blockers.join("、")}</p>}<p className="text-xs">批准影响核定工时，不改原始打卡、不计算工资。提交时重新核验授权、来源、申请版本和封存。</p>
    {(d.canApprove || d.canReject) && <div className="space-y-2"><label className="block">审核理由（1–500 字）<textarea aria-label="受托补正审核理由" className={input} disabled={disabled} maxLength={1000} value={reason} onChange={e => { onDirty(); setReason(e.target.value); setAck(false); }}/></label><label className="flex items-start gap-2"><input aria-label="确认受托补正审核" type="checkbox" disabled={disabled || !valid} checked={ack} onChange={e => { onDirty(); setAck(e.target.checked); }}/>已对照完整原始与申请区间、休息和限制，不是本人申请。</label><div className="flex flex-wrap gap-2">{d.canApprove && <button className={button} disabled={disabled || d.blocked || !ack || !valid} onClick={() => onDecide("approve", reason)}>明确批准受托补正</button>}{d.canReject && <button className={button} disabled={disabled || !ack || !valid} onClick={() => onDecide("reject", reason)}>明确驳回受托补正</button>}</div></div>}
  </article>;
}
export function CorrectionDelegationReceipt({ result }: { result: CorrectionDelegationResponse }) {
  const r = result.receipt; if (!r) return null; return <section aria-label="补正委托最小回执" className="min-w-0 space-y-2 rounded-xl bg-emerald-50 p-3 text-sm"><h3>原操作结果：{r.action === "grant" ? "已授予" : r.action === "revoke" ? "已撤销" : r.action === "approve" ? "已批准" : "已驳回"}</h3><p className="break-all">操作 {r.operationId}<br/>委托 {r.grantId}<br/>UTC {r.recordedAt}</p>{"requestId" in r && <p className="break-all">申请 {r.requestId} · 实际审核Auth {r.actorId}</p>}<p>这是最小保存回执，不恢复权限，不作为当前资料或再次审批依据；未从本地原命令补回正文。</p></section>;
}
