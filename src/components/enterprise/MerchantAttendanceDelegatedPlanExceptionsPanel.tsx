"use client";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { AttendanceManagementClient, attendanceManagementPendingOperationId, type AttendanceManagementClientState, type ManagementStorage } from "@/lib/merchantAttendanceManagementDelegatedClient";
import { AttendanceDelegatedPlanExceptionsClient, type DelegatedPlanExceptionsClientState } from "@/lib/merchantAttendanceDelegatedPlanExceptionsClient";
import * as p from "@/lib/merchantAttendanceDelegatedPlanExceptions";
import * as m from "@/lib/merchantAttendanceManagementDelegation";
import { buildManagementPlanExceptionsGrant, buildManagementPlanExceptionsCommand, retireManagementPlanExceptionsClients, type ManagementPlanExceptionsGrantForm, type ManagementPlanExceptionsDraft } from "@/lib/merchantAttendanceDelegatedPlanExceptionsUi";
import PlanPosthocReviewEvidenceView from "./MerchantAttendancePlanPosthocReviewEvidenceView";
export type DelegatedPlanExceptionsPanelProps = Readonly<{ siteId: string; actorId: string; apiFetch: AttendanceApiFetch; isCurrentAuth: () => boolean;
  ownerMode?: boolean; enabled?: boolean; grantEnabled?: boolean; requesterKey?: string; onClose: () => void;
  storage?: () => ManagementStorage; registerLeaveGuard?: (guard: (() => boolean) | null) => void }>;
const field = "mt-1 w-full min-w-0 max-w-full rounded-lg border border-slate-300 bg-white p-2 text-sm";
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40";
const grantFieldLabels = ["受托员工 Employee ID", "受托账户 Auth ID", "目标档案 Worker ID", "目标员工 Employee ID", "目标账户 Auth ID"] as const;
const targetFieldLabels = ["真实授权 Grant ID", "指定档案 Worker ID", "指定排班 Slot ID"] as const;
const labels = { confirmed: "确认异常", excused: "说明后豁免", follow_up: "继续核查", cleared: "核对后未触发本次迟到／早退", not_applicable: "整段获批请假，本次规则不适用" };
const states: Readonly<Record<string, string>> = { triggered: "触发", not_triggered: "未触发（不代表整体出勤正常）", blocked: "依据不足", unconfigured: "未配置", disabled: "明确停用" };
const emptyGrant = (): ManagementPlanExceptionsGrantForm => ({ delegateEmployeeId: "", delegateAuthUserId: "", workerId: "", employeeId: "", employeeAuthUserId: "", locationIds: "",
  includePending: false, validFrom: "", validUntil: "", reason: "", acknowledged: false });
const emptyDraft = (): ManagementPlanExceptionsDraft => ({ outcome: "", note: "", acknowledged: false });
const anyInput = (...values: unknown[]): boolean => values.some(value => value === true || typeof value === "string" && value.length > 0
  || !!value && typeof value === "object" && anyInput(...Object.values(value)));
const authCurrent = (check: () => boolean) => { try { return check() === true; } catch { return false; } };
export function DelegatedPlanExceptionReview({ context }: { context: p.DelegatedPlanExceptionsContextResult }) {
  const d = context.context.review.detail!, source = d.current!;
  return <article className="min-w-0 space-y-3 rounded-xl border p-3 text-sm" data-delegated-plan-exceptions-review>
    <h3 className="font-bold">指定人员／排班的正式异常依据</h3><p className="break-words">{d.worker.workerName} · {d.worker.workerNo}</p>
    <p className="break-all">人员档案 {d.worker.workerId} · 员工 {d.worker.employeeId} · 账户 {d.worker.employeeAuthUserId}</p>
    <p className="break-all">排班 {d.slotId} · {source.slot.startAt} 至 {source.slot.endAt} · {source.slot.timeZone} · {source.slot.locationName}</p>
    <div className="grid gap-2 sm:grid-cols-2">{(["late", "early"] as const).map(key => <p className="rounded-lg bg-slate-50 p-2" key={key}>{key === "late" ? "迟到" : "早退"}：{states[source.candidate[key].state]}{source.candidate[key].minutes !== null && ` · 异常分钟 ${source.candidate[key].minutes}`}</p>)}</div>
    <p className="break-all">原始起止：{source.candidate.original.startAt ?? "未知"} — {source.candidate.original.endAt ?? "未知"}<br/>采用起止：{source.candidate.selected.startAt ?? "未知"} — {source.candidate.selected.endAt ?? "未知"}</p>
    {source.protocol === "plan-exception-source-v3" ? <PlanPosthocReviewEvidenceView state={source.state} posthoc={source.source.evaluation.posthoc}
      observations={source.source.evaluation.observations} leaveEdges={source.leaveEdges} saved={false}/> : <details className="space-y-2"><summary>当前关联、规则及相关资料</summary>
      <p className="break-all">固定规则核准：{source.source.approval ? `${source.source.approval.operationId} · 版本 ${source.source.approval.revision}` : "未核实"}</p>
      <ol className="space-y-2">{source.source.sessions.map(session => <li className="break-all rounded-lg bg-slate-50 p-2" key={session.startEventId}>原班次 {session.startEventId} · {session.relation.status}<br/>原始 {session.original.startAt ?? "未知"} — {session.original.endAt ?? "未知"}<br/>核定 {session.selected.startAt ?? "未知"} — {session.selected.endAt ?? "未知"}<br/>核准采用 {session.adoption?.status ?? "未知"}{session.effect && ` · 修订 ${session.effect.revision} · ${session.effect.operationId}`}</li>)}</ol>
      {Object.entries(source.source.context).map(([kind, section]) => <section className="space-y-1" key={kind}><p>{({ unassociated: "未关联班次", leave: "请假", calendar: "日历", missing: "漏卡", pendingCorrections: "待审补正／修订", workArrangements: "工作安排" } as Readonly<Record<string, string>>)[kind]}：{section.items.length} 项{section.limited ? "（有截断，不能视为完整）" : ""}</p><ol>{section.items.map((item, index) => <li className="break-all rounded-lg border p-2 text-xs" key={index}>{Object.entries(item).filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean").map(([key, value]) => <p key={key}>{key}：{String(value)}</p>)}</li>)}</ol></section>)}
    </details>}
    {source.blockers.length > 0 && <p className="break-words text-amber-800">需核查：{source.blockers.join("、")}。不得视为缺勤或自动确认。</p>}
    <p className="break-all">现处理版本 {d.revision} · 证据 {source.fingerprint} · 核对 UTC {context.readAt}</p>
    <p>本授权{context.scope.includePending ? "已明确包含授权前的合法排班" : "只允许授权登记后新发布的排班"}；不替换原始打卡、工时或已封存归档。</p>
    {d.latestDecision && <p className="break-words rounded-lg bg-slate-50 p-2">最近处理：{labels[d.latestDecision.outcome]} · {d.latestDecision.note}。{d.stale ? "依据已变化，不能沿用旧结论。" : "本次仍需明确选择，不自动复制决定。"}</p>}
    {d.history.length > 0 && <details><summary>此排班处理历史（{d.history.length} 条{d.historyTruncated ? "，部分历史未在本页返回" : ""}）</summary><ol className="space-y-2 pt-2">{d.history.map(item => <li className="break-words rounded-lg border p-2" key={item.operationId}>{item.kind === "decision" && item.outcome ? labels[item.outcome] : "员工说明"} · {item.note}<p className="break-all text-xs">版本 {item.revision} · 原操作 {item.operationId} · {item.recordedAt}</p></li>)}</ol></details>}
  </article>;
}
export default function MerchantAttendanceDelegatedPlanExceptionsPanel(props: DelegatedPlanExceptionsPanelProps) {
  const key = JSON.stringify([props.siteId, props.actorId, props.ownerMode === true, props.enabled, props.grantEnabled, props.requesterKey ?? null]);
  const [scope, setScope] = useState({ key, fetch: props.apiFetch, auth: props.isCurrentAuth, storage: props.storage, revision: 0 });
  if (scope.key !== key || scope.fetch !== props.apiFetch || scope.auth !== props.isCurrentAuth || scope.storage !== props.storage) {
    setScope({ key, fetch: props.apiFetch, auth: props.isCurrentAuth, storage: props.storage, revision: scope.revision + 1 }); return null;
  }
  if (!authCurrent(props.isCurrentAuth)) return null; return <Workspace key={scope.revision} {...props}/>;
}
function Workspace({ siteId, actorId, apiFetch, isCurrentAuth, ownerMode = false, enabled = false, grantEnabled = false, onClose, registerLeaveGuard, storage = browserStorage }: DelegatedPlanExceptionsPanelProps) {
  const mounted = useRef(false), visible = useRef(true), epoch = useRef(0), working = useRef(false), dirty = useRef(false);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const current = useCallback(() => mounted.current && visible.current && !document.hidden && authCurrent(isCurrentAuth), [isCurrentAuth]);
  const [state, setState] = useState<DelegatedPlanExceptionsClientState>({ phase: "idle", pending: null, result: null, message: "请明确读取；初始化不会联网。" });
  const [managementState, setManagementState] = useState<AttendanceManagementClientState>({ phase: "idle", pending: null, result: null, message: "授权管理尚未读取。" });
  const client = useMemo(() => new AttendanceDelegatedPlanExceptionsClient({ siteId, actorId, apiFetch, storage, isCurrentAuth: current, canWrite: () => enabled,
    onState: next => { if (mounted.current) setState(next); } }), [siteId, actorId, apiFetch, storage, current, enabled]);
  const management = useMemo(() => new AttendanceManagementClient({ siteId, actorId, apiFetch, storage, isCurrentAuth: current, canWrite: () => ownerMode && enabled && grantEnabled,
    onState: next => { if (mounted.current) setManagementState(next); } }), [siteId, actorId, apiFetch, storage, current, ownerMode, enabled, grantEnabled]);
  const [grant, setGrant] = useState<ManagementPlanExceptionsGrantForm>(emptyGrant), [draft, setDraft] = useState<ManagementPlanExceptionsDraft>(emptyDraft);
  const [target, setTarget] = useState({ grantId: "", workerId: "", slotId: "" }), [grantLookup, setGrantLookup] = useState(""), [revokeReason, setRevokeReason] = useState(""), [revokeAck, setRevokeAck] = useState(false);
  const [notice, setNotice] = useState(""); const latest = useRef({ state, managementState, grant, draft, target, revokeReason, revokeAck });
  latest.current = { state, managementState, grant, draft, target, revokeReason, revokeAck };
  const clear = useCallback(() => { dirty.current = false; setGrant(emptyGrant()); setDraft(emptyDraft()); setTarget({ grantId: "", workerId: "", slotId: "" }); setGrantLookup(""); setRevokeReason(""); setRevokeAck(false); setNotice(""); }, []);
  const suspend = useCallback(() => { epoch.current++; working.current = false; client.pause(); management.pause(); clear(); }, [client, management, clear]);
  const leave = useCallback(() => { if (!current()) return true; if (working.current) { setNotice("正在核验，请稍候；原编号会保留。"); return false; }
    if (dirty.current || client.hasLeaveRisk() || management.hasLeaveRisk()) { if (!window.confirm("未保存输入将清除；待确认原编号继续保留，仅可 GET 核对。确认离开？") || !current()) return false; }
    suspend(); return true; }, [current, client, management, suspend]);
  useLayoutEffect(() => { mounted.current = true; visible.current = !document.hidden; setWorkspaceReady(true);
    setState(client.getSnapshot()); setManagementState(management.getSnapshot()); const invalidate = () => { epoch.current++; working.current = false; };
    const visibility = () => { visible.current = !document.hidden; if (!visible.current) suspend(); else setState(value => ({ ...value })); };
    const unload = (event: BeforeUnloadEvent) => { if (dirty.current || working.current || client.hasLeaveRisk() || management.hasLeaveRisk()) { event.preventDefault(); event.returnValue = ""; } };
    const focus = () => { if (!authCurrent(isCurrentAuth)) suspend(); };
    document.addEventListener("visibilitychange", visibility); window.addEventListener("beforeunload", unload); window.addEventListener("focus", focus); window.addEventListener("pagehide", suspend);
    registerLeaveGuard?.(leave); return () => { mounted.current = false; invalidate(); retireManagementPlanExceptionsClients([client, management], () => mounted.current); clear();
      setState(client.getSnapshot()); setManagementState(management.getSnapshot()); registerLeaveGuard?.(null);
      document.removeEventListener("visibilitychange", visibility); window.removeEventListener("beforeunload", unload); window.removeEventListener("focus", focus); window.removeEventListener("pagehide", suspend); };
  }, [client, management, suspend, clear, leave, registerLeaveGuard, isCurrentAuth]);
  const ready = () => current() && !working.current;
  const discard = () => !dirty.current || window.confirm("读取新资料会清除未提交的授权／处理输入，确认继续？") && current();
  const run = async (task: () => Promise<unknown>, discardDraft = false) => { if (!ready() || discardDraft && !discard()) return;
    const token = epoch.current; working.current = true; setNotice(""); if (discardDraft) { dirty.current = false; setDraft(emptyDraft()); setGrant(emptyGrant()); setRevokeReason(""); setRevokeAck(false); }
    try { await task(); } catch { if (current() && epoch.current === token) setNotice("未能核实结果；如已提交，保留原编号，只读核对，不要重复提交。"); }
    finally { if (epoch.current === token) working.current = false; }
  };
  const readContext = () => { try { const query = p.parseDelegatedPlanExceptionsQuery({ siteId, mode: "context", ...target }); if (query.mode !== "context") return;
    void run(() => { management.pause(); return client.readContext(query); }, true); } catch { setNotice("请填写负责人提供的真实授权、人员档案和排班编号。"); } };
  const readManagement = (query: m.ManagementDelegationQuery) => void run(() => { client.pause(); return management.readManagement(query); }, true);
  const initialize = () => void run(async () => { await Promise.allSettled([client.initialize(), management.initialize()]); }, true);
  const recover = () => void run(async () => { let raw: string | null; try { raw = storage().getItem(client.storageKey); } catch { throw Error(); }
    if (raw === null) { await initializeLocal(); return; } const domain = Object.getOwnPropertyDescriptor(p.parseDelegatedPlanExceptionsJson(raw, false), "domain")?.value;
    if (domain === "plan-exceptions") await client.recover(); else await management.recover(); }, true);
  const initializeLocal = async () => { await Promise.allSettled([client.initialize(), management.initialize()]); };
  const context = state.result?.kind === "context" ? state.result : null, managed = managementState.result?.protocol === m.MANAGEMENT_DELEGATION_PROTOCOL ? managementState.result as m.ManagementDelegationResult : null;
  const submitDecision = () => { if (!ready() || !enabled || !context) return; const token = epoch.current, snapshot = latest.current, query = { siteId, mode: "context" as const, ...snapshot.target };
    if (!window.confirm("只处理此明确人员／排班的正式异常，不改原始打卡、核定工时或封存资料。确认只提交一次？") || !ready() || latest.current !== snapshot) return;
    void run(async () => { const command = await buildManagementPlanExceptionsCommand(context, query, actorId, snapshot.draft, crypto.randomUUID());
      if (!current() || epoch.current !== token || latest.current.state.result !== context || JSON.stringify(latest.current.draft) !== JSON.stringify(snapshot.draft) || JSON.stringify(latest.current.target) !== JSON.stringify(snapshot.target)) throw Error();
      dirty.current = anyInput(snapshot.grant, snapshot.revokeReason, snapshot.revokeAck); setDraft(emptyDraft()); await client.submit(query, command); });
  };
  const submitGrant = () => { if (!ready() || !ownerMode || !enabled || !grantEnabled || !managed || managed.kind === "receipt" || !managed.canGrant) return;
    const snapshot = latest.current; let command: m.ManagementDelegationGrantCommand; try { command = buildManagementPlanExceptionsGrant(snapshot.grant, crypto.randomUUID()); } catch { setNotice("请核验双身份、地点、UTC期限、理由与明确确认。"); return; }
    if (!window.confirm(snapshot.grant.includePending ? "此授权明确包含登记前旧排班，只处理已核验人员和地点，不授全员权限。确认？" : "只允许授权登记后新发布排班，不纳入旧待办。确认此唯一人员与地点授权？") || !ready() || latest.current !== snapshot) return;
    void run(async () => { dirty.current = anyInput(snapshot.draft, snapshot.revokeReason, snapshot.revokeAck); setGrant(emptyGrant()); await management.submitManagement(command); });
  };
  const revoke = () => { if (!ready() || !ownerMode || !enabled || !grantEnabled || managed?.kind !== "detail" || managed.item.delegatedAction !== "plan_exception_decide" || managed.item.status !== "granted" || !revokeAck) return;
    const snapshot = latest.current; let command: m.ManagementDelegationCommand; try { command = m.parseManagementDelegationCommand({ action: "revoke", operationId: crypto.randomUUID(), grantId: managed.item.grantId, expectedRevision: 1, reason: revokeReason.trim() }); } catch { setNotice("请填写明确撤销理由。"); return; }
    if (!window.confirm("仅撤销此授权，不删除或改写已经保存的异常处理。确认只提交一次？") || !ready() || latest.current !== snapshot) return;
    void run(async () => { dirty.current = anyInput(snapshot.grant, snapshot.draft); setRevokeReason(""); setRevokeAck(false); await management.submitManagement(command); });
  };
  const busy = state.phase === "loading" || state.phase === "saving" || managementState.phase === "loading" || managementState.phase === "saving", pending = state.pending ?? managementState.pending;
  let occupied = true; try { occupied = storage().getItem(client.storageKey) !== null; } catch { /* Storage failure never authorizes write. */ }
  const lock = !workspaceReady || busy || occupied || !current();
  const updateGrant = (change: Partial<ManagementPlanExceptionsGrantForm>) => { dirty.current = true;
    setGrant(value => ({ ...value, ...change, acknowledged: Object.keys(change).length === 1 && change.acknowledged === true })); };
  const updateTarget = (key: keyof typeof target, value: string) => {
    if (!ready() || lock || !enabled || target[key] === value || !discard()) return;
    // A confirmed target switch clears ALL unsaved forms together, never just
    // their shared dirty guard. Cancellation leaves the old context untouched.
    client.pause(); management.pause(); clear(); setTarget({ ...target, [key]: value });
  };
  return <section aria-label="正式异常审批委托" className="min-w-0 space-y-4 p-4 text-slate-900"><header className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold">正式异常审批委托</h2><button className={button} onClick={() => { if (leave()) onClose(); }}>关闭</button></header>
    <p className="text-sm">受托人以自己的真实账号操作，不扮演负责人。仅指定人员、地点和排班；没有全员目录、自动结论或撤销旧核定。新操作{enabled ? "已开放" : "未开放"}；关闭时仅核对原编号。</p>
    <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={initialize}>读取本地状态（不联网）</button><button className={button} disabled={busy} onClick={recover}>仅 GET 核验原编号</button></div>
    {pending && <p className="break-all rounded-xl bg-amber-50 p-3 text-sm">待核对原操作 {pending.domain === "plan-exceptions" ? pending.command.operationId : attendanceManagementPendingOperationId(pending)}；不要重发或换新编号。</p>}<p role="status" className="break-words rounded-xl bg-slate-100 p-3 text-sm">{notice || state.message}</p>
    {ownerMode && <section className="min-w-0 space-y-3 rounded-xl border p-3"><h3 className="font-bold">负责人：明确授权与撤销</h3><p className="text-sm">须核验真实编号；不会自动新增角色权限。默认不含旧排班，勾选“包含授权前排班”后才允许合法旧待办。</p>
      <fieldset disabled={lock} className="flex min-w-0 flex-wrap items-end gap-2"><button className={button} onClick={() => readManagement({ siteId, mode: "list", afterId: null, state: "all", delegatedAction: "plan_exception_decide" })}>读取正式异常授权（25条）</button><label className="min-w-0 flex-1 text-sm">真实授权编号<input aria-label="真实授权编号" className={field} maxLength={36} value={grantLookup} onChange={event => { setGrantLookup(event.target.value); management.pause(); }}/></label><button className={button} onClick={() => { try { readManagement(m.parseManagementDelegationQuery({ siteId, mode: "detail", grantId: grantLookup })); } catch { setNotice("请填写真实授权编号。"); } }}>读取授权详情</button></fieldset>
      <p role="status" className="break-words text-sm">{managementState.message}</p>
      {managed?.kind === "list" && <div className="space-y-2">{managed.items.map(item => <button className={`${button} block w-full break-all text-left`} key={item.grantId} disabled={lock} onClick={() => readManagement({ siteId, mode: "detail", grantId: item.grantId })}>{item.status} · {item.grantId}</button>)}{managed.nextId && <button className={button} disabled={lock} onClick={() => readManagement({ siteId, mode: "list", afterId: managed.nextId, state: "all", delegatedAction: "plan_exception_decide" })}>下一页授权</button>}</div>}
      {managed?.kind === "detail" && managed.item.delegatedAction === "plan_exception_decide" && managed.item.scope.kind === "formal_exception" && <article className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm"><p className="break-all">{managed.item.status} · {managed.item.grantId}<br/>受托员工 {managed.item.delegate.employeeId}／账户 {managed.item.delegate.authUserId}<br/>目标 {managed.item.scope.workerId}／{managed.item.scope.employeeId}／{managed.item.scope.employeeAuthUserId}<br/>地点 {managed.item.scope.locationIds.join("、")}<br/>UTC {managed.item.validFrom} 至 {managed.item.validUntil}</p><p>{managed.item.scope.includePending ? "包含授权前合法排班" : "不含授权前排班"} · {managed.item.authorityCurrent ? "当前有效（提交仍重验）" : "当前不可用"}</p>{managed.item.status === "granted" && <fieldset disabled={lock || !enabled || !grantEnabled} className="space-y-2"><label>撤销理由<input aria-label="撤销理由" className={field} maxLength={200} value={revokeReason} onChange={event => { dirty.current = true; setRevokeReason(event.target.value); }}/></label><label className="flex items-center gap-2"><input aria-label="已核验，明确撤销此授权" type="checkbox" checked={revokeAck} onChange={event => { dirty.current = true; setRevokeAck(event.target.checked); }}/>已核验，明确撤销此授权</label><button className={button} disabled={!enabled || !grantEnabled || !revokeAck} onClick={revoke}>撤销此授权（一次提交）</button></fieldset>}</article>}
      <details><summary className="cursor-pointer font-semibold">新增唯一人员的正式异常审批授权</summary><fieldset disabled={lock || !enabled || !grantEnabled || !managed || managed.kind === "receipt" || !managed.canGrant} className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
        {(["delegateEmployeeId", "delegateAuthUserId", "workerId", "employeeId", "employeeAuthUserId"] as const).map((key, index) => <label className="text-sm" key={key}>{grantFieldLabels[index]}<input aria-label={grantFieldLabels[index]} className={field} maxLength={36} value={grant[key]} onChange={event => updateGrant({ [key]: event.target.value })}/></label>)}
        <label className="text-sm">真实地点 ID（1—25个，逗号或换行分隔）<textarea aria-label="真实地点 ID（1—25个，逗号或换行分隔）" className={field} maxLength={1000} value={grant.locationIds} onChange={event => updateGrant({ locationIds: event.target.value })}/></label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input aria-label="明确包含授权登记前的合法排班（默认不选）" type="checkbox" checked={grant.includePending} onChange={event => updateGrant({ includePending: event.target.checked, acknowledged: false })}/>明确包含授权登记前的合法排班（默认不选）</label>
        <label className="text-sm">生效时间（UTC）<input aria-label="生效时间（UTC）" type="datetime-local" step="1" className={field} value={grant.validFrom} onChange={event => updateGrant({ validFrom: event.target.value })}/></label><label className="text-sm">失效时间（UTC，不含端点）<input aria-label="失效时间（UTC，不含端点）" type="datetime-local" step="1" className={field} value={grant.validUntil} onChange={event => updateGrant({ validUntil: event.target.value })}/></label>
        <label className="text-sm sm:col-span-2">授权理由<input aria-label="授权理由" className={field} maxLength={200} value={grant.reason} onChange={event => updateGrant({ reason: event.target.value })}/></label><label className="flex items-center gap-2 text-sm sm:col-span-2"><input aria-label="已核验双身份、地点、期限和旧排班边界，只授此明确动作" type="checkbox" checked={grant.acknowledged} onChange={event => updateGrant({ acknowledged: event.target.checked })}/>已核验双身份、地点、期限和旧排班边界，只授此明确动作</label><button className={button} disabled={!grant.acknowledged} onClick={submitGrant}>授予正式异常审批权（一次提交）</button>
      </fieldset></details></section>}
    <section className="min-w-0 space-y-3 rounded-xl border p-3"><h3 className="font-bold">受托人：指定排班审批</h3><fieldset disabled={lock || !enabled} className="grid min-w-0 gap-3 sm:grid-cols-3">{(["grantId", "workerId", "slotId"] as const).map((key, index) => <label className="text-sm" key={key}>{targetFieldLabels[index]}<input aria-label={targetFieldLabels[index]} className={field} maxLength={36} value={target[key]} onChange={event => updateTarget(key, event.target.value)}/></label>)}<button className={button} onClick={readContext}>读取此授权／人员／排班</button></fieldset>
      {context && <><DelegatedPlanExceptionReview context={context}/><fieldset disabled={lock || !enabled || !context.context.canDecide} className="space-y-3"><label className="block text-sm">明确处理<select aria-label="明确处理" className={field} value={draft.outcome} onChange={event => { dirty.current = true; setDraft(value => ({ ...value, outcome: event.target.value, acknowledged: false })); }}><option value="">请选择明确处理</option><option value="follow_up">继续核查（不会自动判断缺勤）</option><option value="confirmed" disabled={!context.context.canConclude}>确认异常</option><option value="excused" disabled={!context.context.canConclude}>说明后豁免</option>{context.context.canClear && <option value="cleared">{labels.cleared}</option>}{context.context.canNotApplicable && <option value="not_applicable">{labels.not_applicable}</option>}</select></label><label className="block text-sm">处理说明<textarea aria-label="处理说明" className={field} maxLength={500} value={draft.note} onChange={event => { dirty.current = true; setDraft(value => ({ ...value, note: event.target.value, acknowledged: false })); }}/></label><label className="flex items-center gap-2 text-sm"><input aria-label="已核验此真实人员、排班及完整依据，明确处理" type="checkbox" checked={draft.acknowledged} onChange={event => { dirty.current = true; setDraft(value => ({ ...value, acknowledged: event.target.checked })); }}/>已核验此真实人员、排班及完整依据，明确处理</label><button className={button} disabled={!draft.acknowledged || !draft.outcome || !draft.note.trim()} onClick={submitDecision}>提交本次处理（一次提交）</button></fieldset></>}
    </section>
    {state.result?.kind === "receipt" && state.result.receipt && <p className="break-all rounded-xl bg-slate-50 p-3 text-sm">最小回执：{state.result.receipt.operationId} · 处理版本 {state.result.receipt.reference.decisionRevision} · UTC {state.result.receipt.recordedAt}。不自动恢复当前正文。</p>}
  </section>;
}
function browserStorage(): ManagementStorage { return sessionStorage; }
