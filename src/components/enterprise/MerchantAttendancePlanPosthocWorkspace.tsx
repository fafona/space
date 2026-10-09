"use client";
import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { PlanPosthocCandidate, PlanPosthocCommand, PlanPosthocQuery, PlanPosthocReference, PlanPosthocResult } from "@/lib/merchantAttendancePlanPosthocContract";
import type { PlanPosthocEvaluationResult, PlanPosthocEvaluationBlocker } from "@/lib/merchantAttendancePlanPosthocEvaluationContract";
import MerchantAttendancePlanPosthocSummary from "./MerchantAttendancePlanPosthocSummary";

export type PlanPosthocWorkspaceState = Readonly<{
  phase: "idle" | "loading" | "ready" | "saving" | "unconfirmed" | "blocked";
  result: PlanPosthocResult | null;
  evaluation: PlanPosthocEvaluationResult | null;
  pending: Readonly<{ query: PlanPosthocQuery; command: PlanPosthocCommand }> | null;
  message: string;
  canWrite: boolean;
}>;
/** The owner supplies the identity-bound durable controller. This UI neither
 * constructs commands nor owns HTTP, storage, operation IDs or recovery CAS. */
export interface PlanPosthocWorkspaceClient {
  initialize(): Promise<void>;
  load(): Promise<void>;
  evaluate(): Promise<void>;
  apply(input: { sources: PlanPosthocReference[]; reason: string }): Promise<void>;
  revoke(reason: string): Promise<void>;
  recover(): Promise<void>;
  retry(): Promise<void>;
  endAttempt(): Promise<void>;
  pause(): void;
  hasLeaveRisk(): boolean;
  getSnapshot(): PlanPosthocWorkspaceState;
  subscribe(listener: () => void): () => void;
}
export type PlanPosthocWorkspaceProps = {
  siteId: string; workerId: string; slotId: string; actorId: string;
  scopeEpoch?: string | number; active?: boolean; enabled: boolean; recoveryOnly?: boolean;
  client: PlanPosthocWorkspaceClient; onClose: () => void;
  registerLeaveGuard?: (guard: (() => boolean) | null) => void;
};
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40";
const input = "mt-1 w-full min-w-0 max-w-full rounded-lg border border-slate-300 bg-white p-2 text-sm";
const hidden = () => typeof document !== "undefined" && document.hidden;
const referenceKey = (r: PlanPosthocReference) => `${r.kind}:${r.kind === "session" ? r.startEventId : r.rootRequestId}`;
export function planPosthocReasonValid(reason: string) {
  return reason === reason.trim() && [...reason].length >= 1 && [...reason].length <= 1000 && !/[\u0000-\u001f\u007f-\u009f]/.test(reason);
}
export function confirmPlanPosthocAction(confirm: () => boolean, current: () => boolean, submit: () => void) {
  if (!current() || !confirm() || !current()) return false;
  submit(); return true;
}
export function planPosthocSelection(result: PlanPosthocResult, keys: readonly string[]): PlanPosthocReference[] | null {
  if (!result.preview?.eligible || keys.length > 10 || new Set(keys).size !== keys.length) return null;
  const selected: PlanPosthocReference[] = [];
  for (const key of keys) {
    const candidate = result.preview.candidates.find(c => referenceKey(c.reference) === key);
    if (!candidate?.available) return null;
    selected.push(candidate.reference);
  }
  return selected;
}
function matches(result: Pick<PlanPosthocResult, "siteId" | "worker" | "slot" | "actorId">, props: Pick<PlanPosthocWorkspaceProps, "siteId" | "workerId" | "slotId" | "actorId">) {
  return result.siteId === props.siteId && result.worker.workerId === props.workerId && result.slot.id === props.slotId && result.actorId === props.actorId;
}
export default function MerchantAttendancePlanPosthocWorkspace(props: PlanPosthocWorkspaceProps) {
  const active = props.active ?? true, epoch = props.scopeEpoch ?? 0, recoveryOnly = props.recoveryOnly === true;
  const [scope, setScope] = useState({ siteId: props.siteId, workerId: props.workerId, slotId: props.slotId, actorId: props.actorId, client: props.client, active, epoch, enabled: props.enabled, recoveryOnly, key: 0 });
  if (scope.siteId !== props.siteId || scope.workerId !== props.workerId || scope.slotId !== props.slotId || scope.actorId !== props.actorId
    || scope.client !== props.client || scope.active !== active || scope.epoch !== epoch || scope.enabled !== props.enabled || scope.recoveryOnly !== recoveryOnly) {
    setScope({ siteId: props.siteId, workerId: props.workerId, slotId: props.slotId, actorId: props.actorId, client: props.client, active, epoch, enabled: props.enabled, recoveryOnly, key: scope.key + 1 });
    return null;
  }
  return <Screen key={scope.key} {...props} active={active} recoveryOnly={recoveryOnly}/>;
}
function Screen(props: PlanPosthocWorkspaceProps & { active: boolean }) {
  const { client, active, enabled, onClose, registerLeaveGuard, recoveryOnly = false } = props;
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [shown, setShown] = useState(() => active && !hidden()), [draftEpoch, setDraftEpoch] = useState(0);
  const generation = useRef(0), dirty = useRef(false);
  const clearDraft = useCallback(() => { dirty.current = false; setDraftEpoch(value => value + 1); }, []);
  const leave = useCallback(() => {
    const epoch = generation.current;
    return (!(dirty.current || client.hasLeaveRisk()) || window.confirm("离开会清除未提交的采用选择与理由。已发送操作不会撤销，待确认原编号仍保留；继续离开？")) && epoch === generation.current;
  }, [client]);
  useLayoutEffect(() => { registerLeaveGuard?.(leave); return () => registerLeaveGuard?.(null); }, [registerLeaveGuard, leave]);
  useLayoutEffect(() => {
    const pause = () => { generation.current++; client.pause(); };
    const hide = () => flushSync(() => { pause(); clearDraft(); setShown(false); });
    const show = () => { if (active && !hidden()) { flushSync(() => setShown(true)); void client.initialize(); } };
    const visibility = () => { if (hidden()) hide(); else show(); };
    const unload = (event: BeforeUnloadEvent) => { if (dirty.current || client.hasLeaveRisk()) { event.preventDefault(); event.returnValue = ""; } };
    if (!active || hidden()) pause(); else void client.initialize();
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hide); window.addEventListener("pageshow", show); window.addEventListener("beforeunload", unload);
    return () => { pause(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); window.removeEventListener("beforeunload", unload); };
  }, [active, client, clearDraft]);
  const visible = active && shown && !hidden(), busy = state.phase === "loading" || state.phase === "saving";
  const rawPending = visible ? state.pending : null;
  const pendingMatches = !rawPending || rawPending.query.siteId === props.siteId && rawPending.query.workerId === props.workerId && rawPending.query.slotId === props.slotId;
  const pending = pendingMatches ? rawPending : null;
  const result = visible && !rawPending && state.result && matches(state.result, props) ? state.result : null;
  const evaluation = visible && !rawPending && state.evaluation && matches(state.evaluation, props) ? state.evaluation : null;
  const wrongScope = visible && (!pendingMatches || !!state.result && !matches(state.result, props) || !!state.evaluation && !matches(state.evaluation, props));
  const current = (snapshot: PlanPosthocWorkspaceState, epoch: number) => active && shown && !hidden() && generation.current === epoch && client.getSnapshot() === snapshot
    && snapshot.phase !== "loading" && snapshot.phase !== "saving";
  const read = (action: () => Promise<void>) => {
    const snapshot = client.getSnapshot(), epoch = generation.current;
    if (!current(snapshot, epoch) || busy || wrongScope) return;
    if (dirty.current && !window.confirm("重新核对会清除未提交的选择与理由，继续？")) return;
    if (!current(snapshot, epoch)) return;
    generation.current++; clearDraft(); void action();
  };
  const confirm = (message: string, action: () => Promise<void>, expected: PlanPosthocResult | null = null) => {
    const snapshot = client.getSnapshot(), epoch = generation.current;
    confirmPlanPosthocAction(() => window.confirm(message), () => current(snapshot, epoch) && !busy && !wrongScope
      && (expected === null || snapshot.result === expected && snapshot.pending === null && snapshot.canWrite && enabled),
      () => { generation.current++; clearDraft(); void action(); });
  };
  const close = () => { if (leave()) { generation.current++; client.pause(); clearDraft(); onClose(); } };
  return <section aria-label="负责人事后核对采用" data-plan-posthoc-workspace className="min-w-0 space-y-4 rounded-xl border border-indigo-200 bg-white p-3 sm:p-4">
    <header className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-lg font-bold">负责人事后核对采用</h3><button type="button" className={button} onClick={close}>返回异常核查</button></header>
    <p className="rounded-lg bg-amber-50 p-3 text-sm">这里只保存事后采用与撤销，不是员工原始选班，不改变原始打卡、核定工时、漏卡批准或工资。保存成功不等于结案；请返回异常核查，明确重新读取正式依据并另行保存处理结论。本人结果及周期仍按明确保存的决定核验。</p>
    {recoveryOnly ? <p className="text-sm">当前只核对这个已知目标的原号；不读取候选或评价，不采用、不撤销、不重试提交，也不停止本地跟踪。</p>
      : !enabled && <p className="text-sm">新采用与撤销已关闭；仍可明确读取历史及核对原编号，不自动重发。</p>}
    <p role="status" aria-live="polite" className="break-words text-sm">{visible ? state.message : "资料已隐藏；返回后需明确重新读取。"}</p>
    {wrongScope && <p role="alert">当前身份或目标与核对内容不一致；资料未展示，请返回原目标重新核验。待确认编号不会删除。</p>}
    {visible && !wrongScope && (state.phase === "blocked" || state.phase === "unconfirmed") && <p role="alert" className="text-sm text-amber-900">{state.message}</p>}
    {visible && !wrongScope && !recoveryOnly && <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy || !!rawPending} onClick={() => read(() => client.load())}>读取本排班采用与当前候选</button>
      <button type="button" className={button} disabled={busy || !!rawPending} onClick={() => read(() => client.evaluate())}>核对保存来源与请假（预览）</button></div>}
    {pending && !wrongScope && <div data-plan-posthoc-pending className="min-w-0 space-y-3 rounded-lg border border-amber-300 p-3 text-sm">
      <p>结果待确认；原选择和理由不会回填为已保存证据，不生成新编号。请先核对原编号。</p>
      <p>停止本地跟踪不会取消已发送请求，旧请求仍可能稍后成功；重新读取服务器历史后再处理。</p>
      <p className="break-all">原操作编号：{pending.command.operationId} · {pending.command.action === "apply" ? "采用操作" : "撤销操作"}</p>
      <MerchantAttendancePlanPosthocSummary verification="unverified"/>
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => read(() => client.recover())}>只核对原编号</button>
        {!recoveryOnly && <><button type="button" className={button} disabled={busy || !enabled} onClick={() => confirm("先GET核对同一原号；仅明确未找到且当前身份、版本与写权限重新核验通过后，才重试完全相同的原内容。不会生成新编号。继续？", () => client.retry())}>原编号核对后重试</button>
        <button type="button" className={button} disabled={busy} onClick={() => confirm("先GET核对原号；仅明确未找到并重新核验当前身份后，才停止本地跟踪。这不会取消已发送请求，旧请求仍可能稍后成功；重新读取服务器历史后再处理。继续？", () => client.endAttempt())}>停止本地跟踪</button></>}</div>
    </div>}
    {visible && !wrongScope && recoveryOnly && state.phase === "idle" && !pending && !result && <p className="text-sm">此目标尚无可核对的本标签页待确认原号；请核对输入。没有搜索或读取其他目标。</p>}
    {evaluation && !wrongScope && !recoveryOnly && <PlanPosthocEvaluationView key={`${evaluation.fingerprint}:${evaluation.readAt}`} result={evaluation}/>}
    {result && !wrongScope && <>
      <div className="min-w-0 space-y-1 text-sm"><p className="break-words">核对人员：{result.worker.workerName} · {result.worker.workerNo}</p><p className="break-all">排班 {result.slot.id} · 版本 {result.slot.revision} · 地点 {result.slot.locationId}</p><p className="break-all">计划 UTC {result.slot.startAt} → {result.slot.endAt} · {result.slot.timeZone}</p></div>
      <MerchantAttendancePlanPosthocSummary verification="verified" result={result} view={result.preview ? "current" : "saved"}/>
      {!state.canWrite && <p className="text-sm text-amber-900">本次没有取得新写许可；保留已核验历史，只读不等于可采用。</p>}
      {!recoveryOnly && <Editor key={`${draftEpoch}:${result.revision}:${result.readAt}:${result.preview?.fingerprint ?? "saved"}`} result={result} enabled={visible && enabled && state.canWrite && !busy && !wrongScope}
        onDirty={() => { generation.current++; dirty.current = true; }} onApply={(sources, reason) => confirm(sources.length ? "将以当前所选完整来源替换本计划整组事后采用。不会改变原始关联、工时或作出异常结论。确认保存？" : "确认以空组选取启用请假评价核查，并清空本计划原事后工作选取？这不是批准请假、无需评价或正常出勤结论。", () => client.apply({ sources, reason }), result)}
        onRevoke={reason => confirm("撤销本计划当前整组事后采用，引用当前已保存操作的指纹；不撤销漏卡批准，不减少工时，不自动重开已封存周期。确认？", () => client.revoke(reason), result)}/>}
    </>}
  </section>;
}
export function PlanPosthocWorkspaceEditor({ result, enabled, onDirty, onApply, onRevoke }: {
  result: PlanPosthocResult; enabled: boolean; onDirty: () => void;
  onApply: (sources: PlanPosthocReference[], reason: string) => void; onRevoke: (reason: string) => void;
}) {
  const [keys, setKeys] = useState<string[]>([]), [reason, setReason] = useState(""), [empty, setEmpty] = useState(false), [confirmed, setConfirmed] = useState(false), [page, setPage] = useState(0);
  const candidates = result.preview?.candidates ?? [], pages = Math.max(1, Math.ceil(candidates.length / 10));
  const sources = planPosthocSelection(result, keys), validReason = planPosthocReasonValid(reason), canApply = enabled && result.revision < 99 && sources !== null && (keys.length > 0 || empty) && validReason && confirmed;
  const canRevoke = enabled && result.revision < 100 && result.current?.action === "apply" && validReason && confirmed;
  const change = () => { onDirty(); setConfirmed(false); };
  return <section aria-label="明确采用或撤销" className="min-w-0 space-y-3 rounded-lg border border-indigo-200 p-3 text-sm">
    <h4 className="font-semibold">明确选择完整来源（最多10项）</h4>
    <p>每次保存替换整组事后选取，不是追加到旧组；原有采用不会被自动勾选。只采用当前可用来源，不拆分或迁移其他计划关联。</p>
    {!result.preview && <p>当前只有保存回执；新采用前须明确重新读取候选。撤销仍以最近保存操作为准。</p>}
    {result.preview && !result.preview.eligible && <p role="alert">当前整体预览有阻断，不能采用空组或部分来源绕过。</p>}
    <fieldset disabled={!enabled || !result.preview?.eligible} className="min-w-0 space-y-2"><legend>本次事后采用选择 · 已选 {keys.length} / 10</legend>
      {candidates.slice(page * 10, page * 10 + 10).map(candidate => {
        const key = referenceKey(candidate.reference), checked = keys.includes(key);
        return <label key={key} className="flex min-w-0 items-start gap-2 rounded-lg border p-2"><input type="checkbox" aria-label={`采用${candidate.reference.kind === "session" ? "真实班次" : "批准漏卡"} ${key}`} checked={checked}
          disabled={!candidate.available || !checked && keys.length >= 10} onChange={event => { change(); setEmpty(false); setKeys(values => event.target.checked ? [...values, key] : values.filter(value => value !== key)); }}/>
          <CandidateLabel candidate={candidate}/></label>;
      })}
      {!candidates.length && <p>没有候选不代表没有实际出勤。</p>}
    </fieldset>
    {pages > 1 && <nav aria-label="来源选择本地分页" className="flex flex-wrap items-center gap-2"><button type="button" className={button} disabled={page === 0} onClick={() => setPage(page - 1)}>上一页来源</button><span>{page + 1} / {pages}（跨页选择保留）</span><button type="button" className={button} disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>下一页来源</button></nav>}
    <label className="flex items-start gap-2"><input type="checkbox" aria-label="明确启用空组请假评价核查" checked={empty} disabled={!enabled || !result.preview?.eligible || keys.length > 0}
      onChange={event => { change(); setEmpty(event.target.checked); }}/><span>本次不采用工作来源，明确以空组启用请假评价核查（并清空原事后选取）；不代表已批准请假、无需评价或出勤正常。</span></label>
    <label className="block">采用或撤销理由（必填）<textarea aria-label="事后采用或撤销理由" className={input} rows={3} maxLength={1000} value={reason} disabled={!enabled}
      onChange={event => { change(); setReason(event.target.value); }}/></label>
    <p className="text-xs">理由为1至1000字，不含首尾空格、换行或控制字符；更改理由或选择后需重新确认。</p>
    {reason && !validReason && <p role="alert">请检查理由的长度、首尾空格及换行。</p>}
    <label className="flex items-start gap-2"><input type="checkbox" aria-label="确认已核对人员排班版本与采用范围" checked={confirmed} disabled={!enabled}
      onChange={event => { onDirty(); setConfirmed(event.target.checked); }}/><span>我已核对当前人员、地点、计划日期／版本及本次选择；知道保存采用或撤销本身不是异常结论。</span></label>
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!canApply} onClick={() => { if (canApply && sources) onApply(sources, reason); }}>{keys.length ? "保存本次整组采用" : "保存空组并启用请假评价核查"}</button>
      <button type="button" className={button} disabled={!canRevoke} onClick={() => { if (canRevoke) onRevoke(reason); }}>撤销当前整组事后采用</button></div>
    {result.current?.action === "apply" && <p className="break-all text-xs">撤销核对保存版本 {result.current.revision} · 指纹 {result.current.sourceFingerprint}；不使用当前候选预览指纹。</p>}
  </section>;
}
const Editor = PlanPosthocWorkspaceEditor;
function CandidateLabel({ candidate: c }: { candidate: PlanPosthocCandidate }) {
  return <span className="min-w-0 space-y-1 break-all"><span className="block font-medium">{c.reference.kind === "session" ? "真实班次" : "批准整段漏卡"} · {referenceKey(c.reference)}</span>
    <span className="block">原始 UTC {c.original ? `${c.original.startAt ?? "未知"} → ${c.original.endAt ?? "未结束"}` : "漏卡申报没有原始打卡端点"}</span>
    <span className="block">当前核定 UTC {c.selected.startAt ?? "未知"} → {c.selected.endAt ?? "未结束"}</span>
    <span className="block">地点 {c.locationId} · 时区 {c.timeZone}</span>
    {!c.available && <span className="block">不可采用：{c.blockers.join("、")}</span>}
    {c.claim && <span className="block">已有采用计划 {c.claim.slotId} · 版本 {c.claim.revision}（不自动搬移）</span>}
  </span>;
}

const evaluationStates: Record<PlanPosthocEvaluationResult["state"], string> = {
  not_active: "尚未启用或已撤销事后评价", blocked: "当前依据有阻断，不能作判断",
  required: "存在剩余要求，预览首末边缘", not_applicable: "已批请假覆盖，无需本次边缘评价（仅预览）",
};
const evaluationBlockers: Record<PlanPosthocEvaluationBlocker, string> = {
  posthoc_inactive: "没有当前有效采用", source_changed: "保存来源已变化", source_unavailable: "当前来源无法取得", context_unknown: "相关资料未完整核验",
  plan_not_ended: "计划尚未结束", slot_cancelled: "计划已取消", publication_missing: "发布身份依据缺失", worker_inactive: "人员当前未启用",
  association_unverified: "原始关联待核验", adoption_missing: "原开班缺少核准引用", adoption_unverified: "原核准引用待核验", approval_mismatch: "核准依据不一致", approval_missing: "缺少固定核准",
  session_open: "班次未结束", session_zero_duration: "班次为零时长", session_outside_plan: "班次在计划之外", session_overlap: "工作来源重叠", session_location_mismatch: "工作地点不一致",
  unassociated_session: "仍有未采用的真实班次", missing_request: "仍有待核查漏卡", pending_correction: "补正或再次修订待审", leave_pending: "请假待审", calendar_entry: "相关日历提示待核查", work_arrangement_pending: "工作安排待审",
  leave_context_unknown: "请假依据未完整核验", work_endpoint_missing: "工作首末端点不完整", work_zero_duration: "工作区间为零时长", source_outside_plan: "来源与计划无交集", work_leave_overlap: "实际工作与请假覆盖重叠",
  identity_unproven: "历史身份尚未证实", associated_elsewhere: "原始选择属于其他排班", claimed_elsewhere: "来源被其他计划采用", pending_missing: "漏卡或漏卡修订待审", sealed: "相关周期已封存",
};
const candidateStates = { blocked: "依据不足或本项不适用，未判断", unconfigured: "未配置，未知", disabled: "本项明确停用", triggered: "预览超出固定宽限", not_triggered: "预览未超出固定宽限（不代表整班正常）" };
function Span({ value }: { value: { startAt: string | null; endAt: string | null } | null }) {
  return <span className="break-all">{value ? `UTC ${value.startAt ?? "未知／不适用"} → ${value.endAt ?? "未知／不适用"}` : "没有原始打卡端点，不反推或补造"}</span>;
}
function EvaluationReference({ value }: { value: PlanPosthocReference }) {
  return value.kind === "session" ? <p className="break-all text-xs">真实班次起点 {value.startEventId} · 末事件 {value.lastEventId} · 序号 {value.lastSequence} · 核定操作 {value.effectOperationId ?? "无替换"}／版本 {value.effectRevision ?? "无替换"}</p>
    : <p className="break-all text-xs">批准漏卡申请 {value.requestId} · 根 {value.rootRequestId} · 批准操作 {value.approvalOperationId}（不是原始打卡）</p>;
}
function LocalRows<T>({ title, items, children, empty = "本次返回0项，不推导其他资料不存在。" }: {
  title: string; items: readonly T[] | null; children: (item: T, index: number) => ReactNode; empty?: string;
}) {
  const [page, setPage] = useState(0), count = items?.length ?? 0, pages = Math.max(1, Math.ceil(count / 10));
  return <section aria-label={title} className="min-w-0 space-y-2 rounded-lg border border-slate-200 p-2"><h5 className="font-semibold">{title}</h5>
    {items === null ? <p>未知：本次未得到可核验的完整结果，不能按0项处理。</p> : <><p>本次 {count} 项 · 每页最多10项</p>
      {items.slice(page * 10, page * 10 + 10).map((item, index) => <div key={page * 10 + index} className="min-w-0 border-t pt-2">{children(item, page * 10 + index)}</div>)}
      {!count && <p>{empty}</p>}{pages > 1 && <nav aria-label={`${title}分页`} className="flex flex-wrap items-center gap-2"><button type="button" className={button} disabled={page === 0} onClick={() => setPage(page - 1)}>上一页{title}</button><span>{page + 1} / {pages}</span><button type="button" className={button} disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>下一页{title}</button></nav>}</>}
  </section>;
}
/** Strict controller evaluation only: this presentation does not recalculate
 * endpoints, resolve identity/currentness, persist a verdict or change hours. */
export function PlanPosthocEvaluationView({ result: r }: { result: PlanPosthocEvaluationResult }) {
  const edge = r.leaveEdges, source = r.source;
  return <section aria-label="保存来源与请假核对预览" data-plan-posthoc-evaluation={r.state} className="min-w-0 space-y-3 rounded-xl border border-teal-200 bg-teal-50/30 p-3 text-sm">
    <h4 className="font-semibold">保存来源与请假 · 只读预览</h4><p data-plan-posthoc-evaluation-state>{evaluationStates[r.state]}</p>
    <p>本结果仅为当前核对预览，未保存正式异常结论，未替代员工结果或周期确认。无需评价不等于实际准点、全勤或已结案；不改变工时、请假余额或工资。</p>
    <p className="break-words">人员 {r.worker.workerName} · {r.worker.workerNo}</p><p className="break-all">排班 {r.slot.id} · 发布版本 {r.slot.revision} · 地点 {r.slot.locationId} · {r.slot.timeZone}</p>
    <p><Span value={{ startAt: r.slot.startAt, endAt: r.slot.endAt }}/></p><p className="break-all text-xs">读取 UTC {r.readAt} · 预览指纹 {r.fingerprint} · 采用账本版本 {source.posthoc.revision}</p>
    <LocalRows title="预览阻断" items={r.blockers} empty="本次未报告预览阻断；这不是新写许可或正式结论。">{blocker => <p>{evaluationBlockers[blocker]}（{blocker}）</p>}</LocalRows>
    <LocalRows title="保存来源与当前观察" items={source.posthoc.selected} empty="当前没有保存事后工作来源；原始关联和请假仍独立核验。">{(saved, index) => {
      const observation = source.observations[index];
      return <article data-plan-posthoc-observation className="min-w-0 space-y-2"><h6 className="font-semibold">保存来源 {index + 1}</h6><EvaluationReference value={saved.reference}/>
        <p data-plan-posthoc-saved-original>保存原始端点：<Span value={saved.original}/></p><p data-plan-posthoc-saved-selected>保存核定端点：<Span value={saved.selected}/></p>
        <p className="break-all">保存地点 {saved.locationId} · 时区 {saved.timeZone}</p>
        {!observation?.current ? <p>当前来源未取得，不能自动沿用保存端点。</p> : <><p>{observation.blockers.length ? "本次观察存在变化或不可用限制，不能静默换用新版本。" : "本次未报告保存引用／端点变化；仍受整体预览阻断约束。"}</p>
          <EvaluationReference value={observation.current.reference}/><p data-plan-posthoc-current-original>当前原始端点：<Span value={observation.current.original}/></p><p data-plan-posthoc-current-selected>当前核定端点：<Span value={observation.current.selected}/></p>
          <p className="break-all">当前地点 {observation.current.locationId} · 时区 {observation.current.timeZone}</p>
          <p className="break-all">当前来源限制：{observation.current.blockers.length ? observation.current.blockers.join("、") : "本次未报告（不是正式结论）"}</p></>}
        {observation?.blockers.map(blocker => <p key={blocker}>{evaluationBlockers[blocker]}（{blocker}）</p>)}</article>;
    }}</LocalRows>
    <LocalRows title="请假来源状态" items={source.leave.limited || !source.leave.resolved ? null : source.leave.items}>{item => <div className="space-y-1 break-all"><p>申请 {item.requestId} · 操作 {item.operationId} · 版本 {item.revision}</p>
      <p>{({ submitted: "待审批", approved: "已批准", rejected: "已驳回", withdrawn: "已撤回", cancelled: "已取消" })[item.status]} · {item.current ? "本次已核验为当前版本" : "非当前有效版本，不用于豁免"}</p><Span value={item}/></div>}</LocalRows>
    <p>批准覆盖：{edge.fullCoverage === null ? "未知，不能当作没有请假" : edge.fullCoverage ? "全部计划区间被覆盖（仍需检查其他阻断）" : "没有覆盖全部计划区间"}。中间请假不免除计划首尾要求，不推算中途缺勤。</p>
    <LocalRows title="已批请假覆盖" items={edge.approvedCoverage}>{item => <div className="space-y-2"><Span value={item}/><LocalRows title="本段请假引用" items={item.leaveRefs}>{ref => <p className="break-all">申请 {ref.requestId} · 操作 {ref.operationId} · 版本 {ref.revision}</p>}</LocalRows></div>}</LocalRows>
    <LocalRows title="剩余要求区间" items={edge.remainingRequired} empty="剩余要求为0段；仅表述本次请假覆盖几何结果，不证明实际出勤。">{item => <Span value={item}/>}</LocalRows>
    <p>剩余要求首末：<Span value={{ startAt: edge.requiredStartAt, endAt: edge.requiredEndAt }}/></p>
    <LocalRows title="工作与请假重叠" items={edge.workLeaveOverlaps} empty="本次未报告工作与请假交集，不代表其他出勤事项均正常。">{item => <div className="space-y-1 break-all"><Span value={item}/><p>{item.work.kind === "session" ? "真实班次" : "批准漏卡"} {item.work.sourceId} · 核定操作 {item.work.operationId ?? "无替换"}</p><p>请假 {item.leave.requestId} · 操作 {item.leave.operationId} · 版本 {item.leave.revision}</p><p>仍须人工核查；不自动抹去工作或取消请假。</p></div>}</LocalRows>
    <section aria-label="首末边缘候选预览" className="space-y-2"><h5 className="font-semibold">首末边缘候选（不是正式决定）</h5>
      <p>原始工作首末：<Span value={r.candidate.original}/></p><p>当前核定工作首末：<Span value={r.candidate.selected}/></p>
      {(["late", "early"] as const).map(kind => { const field = r.candidate[kind]; return <article key={kind} className="space-y-1 rounded-lg border p-2"><h6>{kind === "late" ? "计划开始边缘" : "计划结束边缘"}</h6><p>{candidateStates[field.state]}</p><p>固定宽限：{field.minutes === null ? "未知／未配置／不适用" : `${field.minutes} 分钟`}</p><p className="break-all">原始差值：{field.rawDeltaUs ?? "未知／不适用"} 微秒 · 超宽限：{field.excessUs ?? "未知／不适用"} 微秒</p></article>; })}
    </section>
  </section>;
}
