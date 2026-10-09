"use client";
import { lazy, Suspense, useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { AttendanceCycleIntentClient, cycleIntentAuthCurrent, type CycleIntentPending } from "@/lib/merchantAttendanceCycleIntentClient";
import { parseCycleIntentBody, parseCycleIntentQuery, type CycleIntentScope, type CycleIntentQuery, type CycleIntentCommand } from "@/lib/merchantAttendanceCycleIntent";
import type { CycleIntentResult, CycleIntentReceipt } from "@/lib/merchantAttendanceCycleIntentResult";
import { periodClosurePendingKey } from "@/lib/merchantAttendancePeriodClosureClient";
import { periodDelegatedClosurePendingKey, type PeriodDelegatedClosureScope } from "@/lib/merchantAttendancePeriodDelegatedClosureClient";
import { captureBrowserExact } from "@/lib/merchantAttendanceRuleCapturesBrowser";

const SendPanel = lazy(() => import("./MerchantAttendanceCycleSendPanel"));
const delegateKeys = ["siteId", "actorEmployeeId", "expectedAuthUserId", "grantId", "workerId", "targetEmployeeId", "targetAuthUserId", "authorizedFromDate", "authorizedThroughDate"] as const;

export type CycleIntentPanelProps = { scope: CycleIntentScope; actorId: string; apiFetch: AttendanceApiFetch; enabled?: boolean;
  delegateScope?: PeriodDelegatedClosureScope; initialIntentId?: string; isCurrentAuth?: () => boolean; onClose: () => void; registerLeaveGuard?: (guard: (() => boolean) | null) => void };

// A verified navigation pointer only pre-fills an ID. Opening/mounting never
// reads it automatically or imports another workspace's saved business body.
export function cycleIntentInitialId(scope: CycleIntentScope, value?: string): string {
  if (value === undefined) return "";
  const query = parseCycleIntentQuery({ ...scope, mode: "detail", intentId: value });
  return query.mode === "detail" ? query.intentId : "";
}
type Preparation = Extract<CycleIntentResult["data"], { kind: "preparation" }>;
type Detail = Extract<CycleIntentResult["data"], { kind: "detail" }>;
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40";
const field = "mt-1 block w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2 text-sm";
const states = { consumer_disabled: "周期采用尚未启用", unconfigured: "尚未设置周期规则", disabled: "周期规则已停用", manual: "规则要求手动选择范围，本入口不自动代选", ready: "可明确采用的日期候选" };
const actionName = { accept: "采用意向", cancel: "取消意向", link: "已关联送审" };
export const cycleIntentDelegateScopeKey = (value?: PeriodDelegatedClosureScope) => JSON.stringify(value === undefined ? null : delegateKeys.map(k => value[k]));
export function cycleIntentSharedPeriodKey(scope: CycleIntentScope, actorId: string, raw?: PeriodDelegatedClosureScope): string | null {
  try {
    if (scope.access === "owner") return raw === undefined && scope.grantId === null ? periodClosurePendingKey(scope.siteId, "owner", actorId) : null;
    const s = captureBrowserExact(raw, delegateKeys) as PeriodDelegatedClosureScope;
    if (s.siteId !== scope.siteId || s.expectedAuthUserId !== actorId || s.workerId !== scope.workerId || s.grantId !== scope.grantId) return null;
    return periodDelegatedClosurePendingKey(s);
  } catch { return null; }
}
export function cycleIntentPeriodSlotBusy(key: string | null, storage: Pick<Storage, "getItem">): boolean {
  if (key === null) return true; try { return storage.getItem(key) !== null; } catch { return true; }
}
export function cycleIntentCanOpenSend(value: CycleIntentResult, scope: CycleIntentScope, actorId: string, raw?: PeriodDelegatedClosureScope): boolean {
  if (value.data.kind !== "detail" || value.siteId !== scope.siteId || value.actorId !== actorId || value.receipt !== null
    || value.data.intent.access !== scope.access || value.data.intent.workerId !== scope.workerId || value.data.intent.grantId !== scope.grantId
    || cycleIntentSharedPeriodKey(scope, actorId, raw) === null) return false;
  if (scope.access === "owner") return true;
  const i = value.data.intent; return !!raw && i.employeeId === raw.targetEmployeeId && i.employeeAuthUserId === raw.targetAuthUserId
    && i.fromDate >= raw.authorizedFromDate && i.throughDate <= raw.authorizedThroughDate;
}
export function cycleIntentCompositeLeave(child: (() => boolean) | null, ownRisk: () => boolean, periodRisk: () => boolean, confirm: () => boolean) {
  if (child && !child()) return false;
  // A registered send child already covers the same shared period slot.
  return !(ownRisk() || !child && periodRisk()) || confirm();
}

export function cycleIntentPanelCommand(scope: CycleIntentScope, data: Preparation | Detail, action: "accept" | "cancel", reason: string, operationId: string) {
  let command: CycleIntentCommand;
  if (action === "accept") {
    if (data.kind !== "preparation" || data.preparation.state !== "ready" || !data.preparation.range || !data.frameHead) throw Error("preparation_required");
    const p = data.preparation, range = data.preparation.range, w = data.source.workerIdentity;
    command = { action, operationId, intentId: operationId, anchorDate: p.anchorDate, fromDate: range.fromDate, throughDate: range.throughDate,
      employeeId: w.employeeId, employeeAuthUserId: w.employeeAuthUserId, expectedWorkerVersion: w.workerVersion, expectedEmployeeVersion: w.employeeVersion,
      expectedSettingsVersion: p.settingsRef.version, expectedActivationRevision: p.activation.revision, expectedPreparationFingerprint: p.preparationFingerprint,
      expectedFrameRevision: data.frameHead.revision, expectedFrameHeadOperationId: data.frameHead.lastOperationId, reason };
  } else {
    if (data.kind !== "detail" || data.head.action !== "accept" || data.head.revision !== 1) throw Error("active_intent_required");
    command = { action, operationId, intentId: data.intent.intentId, expectedRevision: 1, expectedHeadOperationId: data.head.operationId,
      expectedIntentFingerprint: data.intent.intentFingerprint, reason };
  }
  return parseCycleIntentBody({ query: { ...scope, mode: "detail", intentId: command.intentId }, command });
}
export function confirmCycleIntentAction(confirm: () => boolean, current: () => boolean, send: () => void) {
  if (!current() || !confirm() || !current()) return false; send(); return true;
}
export function CycleIntentPreparationView({ data }: { data: Preparation }) {
  const p = data.preparation;
  return <article data-cycle-preparation className="min-w-0 space-y-2 rounded-xl border p-3 text-sm">
    <h3 className="font-bold">{states[p.state]}</h3><p>参考日期：{p.anchorDate} · 保存设置时区：{p.settingsRef.timeZone}</p>
    {p.range && <p className="font-semibold">候选范围：{p.range.fromDate} — {p.range.throughDate}（{p.range.civilDays} 个民事日）</p>}
    <p>人员版本 {data.source.workerIdentity.workerVersion} · 员工版本 {data.source.workerIdentity.employeeVersion} · 设置版本 {p.settingsRef.version} · 启用版本 {p.activation.revision}</p>
    {data.frameHead && <p>范围版本 {data.frameHead.revision}；保存时将再次核对来源、当前权限和范围版本。</p>}
    <p>这是日期候选，不是已采用、已送审、本人确认或工资结果。</p>
  </article>;
}
export function CycleIntentReceiptView({ receipt }: { receipt: CycleIntentReceipt }) {
  return <p className="break-all rounded-xl bg-slate-50 p-3 text-sm">已核验原编号：{receipt.operationId} · {actionName[receipt.action]} · 版本 {receipt.revision}。请重新读取当前详情。</p>;
}

// Any authority/transport/scope change synchronously drops the old subtree;
// async guards also check the actual host Auth callback before every update.
export default function MerchantAttendanceCycleIntentPanel(props: CycleIntentPanelProps) {
  const { scope: s } = props;
  const delegateScopeKey = cycleIntentDelegateScopeKey(props.delegateScope);
  const [marker, setMarker] = useState({ siteId: s.siteId, access: s.access, workerId: s.workerId, grantId: s.grantId,
    delegateScopeKey, initialIntentId: props.initialIntentId, actorId: props.actorId, apiFetch: props.apiFetch, isCurrentAuth: props.isCurrentAuth, enabled: props.enabled, version: 0 });
  if (marker.siteId !== s.siteId || marker.access !== s.access || marker.workerId !== s.workerId || marker.grantId !== s.grantId || marker.actorId !== props.actorId
    || marker.delegateScopeKey !== delegateScopeKey || marker.initialIntentId !== props.initialIntentId || marker.apiFetch !== props.apiFetch || marker.isCurrentAuth !== props.isCurrentAuth || marker.enabled !== props.enabled) {
    setMarker({ siteId: s.siteId, access: s.access, workerId: s.workerId, grantId: s.grantId, actorId: props.actorId,
      delegateScopeKey, initialIntentId: props.initialIntentId, apiFetch: props.apiFetch, isCurrentAuth: props.isCurrentAuth, enabled: props.enabled, version: marker.version + 1 }); return null;
  }
  if (!cycleIntentAuthCurrent(props.isCurrentAuth)) return null;
  return <Scope key={marker.version} {...props}/>;
}
function Scope({ scope, actorId, apiFetch, enabled = false, delegateScope, initialIntentId, isCurrentAuth, onClose, registerLeaveGuard }: CycleIntentPanelProps) {
  const { siteId, access, workerId, grantId } = scope;
  const mounted = useRef(false), visible = useRef(true), epoch = useRef(0), working = useRef(false);
  const current = useCallback(() => mounted.current && visible.current && !document.hidden && cycleIntentAuthCurrent(isCurrentAuth), [isCurrentAuth]);
  const client = useMemo(() => new AttendanceCycleIntentClient({ siteId, actorId, apiFetch, storage: () => sessionStorage, isCurrent: current }), [siteId, actorId, apiFetch, current]);
  const [data, setData] = useState<CycleIntentResult | null>(null), [readQuery, setReadQuery] = useState<CycleIntentQuery | null>(null);
  const [pending, setPending] = useState<CycleIntentPending | null>(null), [blocked, setBlocked] = useState(true), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [anchorDate, setAnchorDate] = useState(""), [intentId, setIntentId] = useState(() => cycleIntentInitialId(scope, initialIntentId)), [draft, setDraft] = useState({ reason: "", ack: false });
  const [sendDetail, setSendDetail] = useState<CycleIntentResult | null>(null), sendChildGuard = useRef<(() => boolean) | null>(null);
  const registerSendGuard = useCallback((guard: (() => boolean) | null) => { sendChildGuard.current = guard; }, []);
  const latest = useRef({ data, draft, sendDetail }); latest.current = { data, draft, sendDetail };
  const dirty = useCallback(() => !!latest.current.draft.reason || latest.current.draft.ack, []);
  const stored = useCallback(() => { try { return sessionStorage.getItem(client.key) !== null; } catch { return true; } }, [client]);
  const periodKey = cycleIntentSharedPeriodKey(scope, actorId, delegateScope);
  const periodStored = useCallback(() => { try { return cycleIntentPeriodSlotBusy(periodKey, sessionStorage); } catch { return true; } }, [periodKey]);
  const subscribePeriod = useCallback((listener: () => void) => { window.addEventListener("storage", listener); window.addEventListener("focus", listener);
    return () => { window.removeEventListener("storage", listener); window.removeEventListener("focus", listener); }; }, []);
  const periodBusy = useSyncExternalStore(subscribePeriod, periodStored, () => true);
  const mayLeave = useCallback(() => cycleIntentCompositeLeave(sendChildGuard.current, () => working.current || stored() || dirty(), periodStored,
    () => window.confirm("仍有未提交理由或待确认原编号。离开会清除正文和草稿，但不会删除或重发原编号。确定离开吗？")), [stored, dirty, periodStored]);
  const clear = useCallback(() => { setData(null); setReadQuery(null); setDraft({ reason: "", ack: false }); }, []);
  const pauseClient = useCallback(() => { epoch.current++; client.pause(); }, [client]);
  const local = useCallback(async () => {
    if (!current() || working.current) return; const token = epoch.current;
    try { const value = await client.load(); if (current() && token === epoch.current) { setPending(value); setBlocked(value !== null); } }
    catch { if (current() && token === epoch.current) { setBlocked(true); setMessage("本地原编号无法核实，保留原内容，不发起新操作；请勿清除存储后重复提交。"); } }
  }, [client, current]);
  useLayoutEffect(() => {
    mounted.current = true; visible.current = !document.hidden; void local(); registerLeaveGuard?.(mayLeave);
    const pause = () => { visible.current = false; pauseClient(); working.current = false;
      flushSync(() => { clear(); setSendDetail(null); setAnchorDate(""); setIntentId(""); setPending(null); setBlocked(true); setBusy(false); setMessage("已暂停并清除正文、理由和选择。待确认原编号保留；返回后请显式读取本地状态。"); }); };
    const visibility = () => { if (document.hidden) pause(); else visible.current = true; };
    const unload = (event: BeforeUnloadEvent) => { if (working.current || stored() || periodStored() || dirty()) { event.preventDefault(); event.returnValue = ""; } };
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", pause); window.addEventListener("beforeunload", unload);
    return () => { mounted.current = false; pauseClient(); registerLeaveGuard?.(null);
      document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", pause); window.removeEventListener("beforeunload", unload); };
  }, [clear, dirty, local, mayLeave, pauseClient, periodStored, registerLeaveGuard, stored]);
  const read = async (query: CycleIntentQuery) => {
    if (!current() || working.current || blocked || stored() || latest.current.sendDetail) return; const token = epoch.current;
    if (periodStored() && !window.confirm("共享周期槽仍有待确认原号。本次只读取意向，不覆盖、清除或重发原号；核验须进入首次送审或原周期入口。继续只读吗？")) return;
    if (dirty() && !window.confirm("重新读取会丢弃未提交理由和勾选，是否继续？")) return;
    if (!current() || token !== epoch.current || stored()) return;
    working.current = true; setBusy(true); setMessage(""); clear();
    try { const value = await client.read(query); if (current() && token === epoch.current) { setData(value); setReadQuery(query); } }
    catch { if (current() && token === epoch.current) { clear(); setMessage("未能核验当前授权范围的完整资料。请明确重读，不把失败当作空记录或采用成功。"); } }
    finally { if (current() && token === epoch.current) { working.current = false; setBusy(false); } }
  };
  const recover = async () => {
    if (!current() || working.current || latest.current.sendDetail) return; const token = epoch.current;
    if (dirty() && !window.confirm("原编号核验会清除当前未提交理由，是否继续？")) return;
    if (!current() || token !== epoch.current) return;
    working.current = true; setBusy(true); clear();
    try { const value = await client.recover(); if (current() && token === epoch.current) { setData(value); setPending(null); setBlocked(false); setMessage("匹配原命令和原操作者的 GET 回执已核验；原编号现已解除待确认。"); } }
    catch { if (current() && token === epoch.current) { setBlocked(true); setMessage("原编号仍未确认，已保留。未查到不等于提交失败，不自动重发。"); } }
    finally { if (current() && token === epoch.current) { working.current = false; setBusy(false); void local(); } }
  };
  const send = (action: "accept" | "cancel") => {
    const snapshot = latest.current, value = snapshot.data?.data, token = epoch.current, frozen = JSON.stringify(snapshot.draft);
    if (periodStored()) { setMessage("共享周期槽仍有待确认原号（包括旧格式）。请先进入首次送审核验或回原周期入口核验；不能新采用或取消意向。"); return; }
    if (!current() || working.current || blocked || stored() || !snapshot.draft.ack || !snapshot.draft.reason.trim() || action === "accept" && !enabled
      || !value || value.kind !== "preparation" && value.kind !== "detail") return;
    let pair: ReturnType<typeof cycleIntentPanelCommand>;
    try { pair = cycleIntentPanelCommand({ siteId, access, workerId, grantId }, value, action, snapshot.draft.reason.trim(), crypto.randomUUID()); }
    catch { setMessage("请核对本次理由和最新读取结果；尚未发送，未自动修改日期。"); return; }
    const still = () => current() && token === epoch.current && !working.current && !stored() && !periodStored() && !latest.current.sendDetail && latest.current.data === snapshot.data && JSON.stringify(latest.current.draft) === frozen;
    confirmCycleIntentAction(() => window.confirm(action === "accept" ? "明确保存此候选日期的采用意向？本操作不生成工时表、不送审、不确认工时。仅发送一次，随后须 GET 核验原编号。" : "明确取消此尚未关联送审的采用意向？不修改旧工时表或旧归档。仅发送一次，随后须 GET 核验原编号。"), still, () => {
      working.current = true; setBusy(true); setBlocked(true); clear();
      void (async () => { try { await client.post(pair.query, pair.command); if (current() && token === epoch.current) setMessage("已收到响应，但原编号仍保留。请仅 GET 核验原编号，再重新读取当前详情。"); }
        catch { if (current() && token === epoch.current) setMessage("结果未确认，保留原编号；不要重复采用或取消，请仅 GET 核验。"); }
        finally { if (current() && token === epoch.current) { working.current = false; setBusy(false); void local(); } } })();
    });
  };
  const lock = busy || blocked, result = data?.data, preparation = result?.kind === "preparation" ? result : null, detail = result?.kind === "detail" ? result : null;
  const canAccept = !!preparation && preparation.preparation.state === "ready" && preparation.frameHead !== null && preparation.preparation.range !== null;
  const canCancel = detail?.head.action === "accept" && detail.head.revision === 1;
  const acknowledged = draft.ack && !!draft.reason.trim();
  const closeSend = () => { if (!current()) return; pauseClient(); clear(); setSendDetail(null); setMessage("首次送审工作区已关闭，旧详情和草稿已清除。请显式重新读取当前意向；不会自动重采或重发。"); };
  const openSend = () => {
    const selected = latest.current.data, token = epoch.current;
    if (!current() || working.current || blocked || stored() || !selected || !cycleIntentCanOpenSend(selected, scope, actorId, delegateScope) || !mayLeave()) return;
    if (!current() || token !== epoch.current || latest.current.data !== selected || stored()) return;
    pauseClient(); clear(); if (selected.data.kind === "detail") setIntentId(selected.data.intent.intentId); setSendDetail(selected);
  };
  if (sendDetail) return <Suspense fallback={<section className="space-y-3 p-4"><p role="status">正在加载首次送审工作区…</p><button type="button" className={button} onClick={() => { if (mayLeave()) closeSend(); }}>返回周期意向</button></section>}>
    <SendPanel detail={sendDetail} actorId={actorId} apiFetch={apiFetch} enabled={enabled} delegateScope={delegateScope} isCurrentAuth={current}
      registerLeaveGuard={registerSendGuard} onClose={closeSend}/></Suspense>;
  return <section aria-label="周期采用意向工作区" className="min-w-0 max-w-full space-y-4 p-4 text-slate-900 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">周期采用意向</h2><p className="mt-2 text-sm text-slate-600">{access === "owner" ? "负责人范围" : "当前委托范围"} · 仅处理当前选定人员。这里只保存采用意向；首次送审须显式打开独立工作区，不自动生成或送审。</p></div><button type="button" className={button} onClick={() => { if (mayLeave()) onClose(); }}>关闭周期意向</button></header>
    {!enabled && <p className="rounded-xl bg-amber-50 p-3 text-sm">新的采用意向尚未开放。当前权限下仍可显式读取、取消未关联意向，或核验原编号；服务端另行核验权限。</p>}
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => void local()}>读取本地状态（不联网）</button><button type="button" className={button} disabled={busy} onClick={() => void recover()}>仅 GET 核验原编号</button></div>
    {pending && <p className="break-all rounded-xl bg-amber-50 p-3 text-sm">待确认：{actionName[pending.command.action]} · 原编号 {pending.command.operationId}。只能按保存的原范围核验，不重发 POST。</p>}
    {message && <p role="status" className="break-words rounded-xl bg-slate-100 p-3 text-sm">{message}</p>}
    <fieldset disabled={lock} className="flex min-w-0 flex-wrap items-end gap-3"><label className="min-w-0 flex-1 text-sm">周期参考日期<input aria-label="周期参考日期" className={field} type="date" min="2000-01-01" max="2100-12-31" value={anchorDate} onChange={e => setAnchorDate(e.target.value)}/></label><button type="button" className={button} disabled={!anchorDate} onClick={() => void read({ siteId, access, workerId, grantId, mode: "prepare", anchorDate })}>读取来源和日期候选</button><button type="button" className={button} onClick={() => void read({ siteId, access, workerId, grantId, mode: "list", cursor: null })}>读取采用意向列表</button></fieldset>
    <fieldset disabled={lock} className="flex min-w-0 flex-wrap items-end gap-3"><label className="min-w-0 flex-1 text-sm">已知意向编号<input aria-label="已知意向编号" className={field} maxLength={36} value={intentId} onChange={e => setIntentId(e.target.value)}/></label><button type="button" className={button} disabled={!intentId} onClick={() => void read({ siteId, access, workerId, grantId, mode: "detail", intentId })}>读取意向详情</button></fieldset>
    {preparation && <CycleIntentPreparationView data={preparation}/>}
    {result?.kind === "list" && <div data-cycle-list className="min-w-0 space-y-3"><p className="text-sm">本页 {result.items.length} 条，每页最多 25 条。逐条重新读取详情后才能取消；不自动加载下一页。</p>{result.items.map(item => <article key={item.intentId} className="min-w-0 space-y-2 rounded-xl border p-3 text-sm"><p>{item.fromDate} — {item.throughDate} · {item.timeZone} · {actionName[item.head.action]}</p><p className="break-all">意向编号：{item.intentId}</p><button type="button" className={button} disabled={lock} onClick={() => void read({ siteId, access, workerId, grantId, mode: "detail", intentId: item.intentId })}>重新读取此意向详情</button></article>)}{result.nextCursor && readQuery?.mode === "list" && <button type="button" className={button} disabled={lock} onClick={() => void read({ ...readQuery, cursor: result.nextCursor })}>读取下一页意向</button>}</div>}
    {detail && <article data-cycle-detail className="min-w-0 space-y-2 rounded-xl border p-3 text-sm"><h3 className="font-bold">已保存周期意向 · {actionName[detail.head.action]}</h3><p>{detail.intent.fromDate} — {detail.intent.throughDate} · {detail.intent.timeZone}</p><p className="break-all">意向编号：{detail.intent.intentId} · 当前版本 {detail.head.revision}</p><p className="break-words">原采用理由：{detail.intent.acceptCommand.reason}</p><p>原采用者和来源保留；不把旧来源当作当前权限。</p>{detail.head.action === "link" && <p className="break-all">已关联工时表 {detail.head.periodId}，不能从此入口取消或改写。</p>}{data && cycleIntentCanOpenSend(data, scope, actorId, delegateScope) && <button type="button" className={button} disabled={lock} onClick={openSend}>打开首次送审／核验原号</button>}</article>}
    {(canAccept || canCancel) && <fieldset disabled={lock || periodBusy} className="min-w-0 space-y-3 rounded-xl border p-3"><legend>明确处理本次意向</legend><label className="block text-sm">本次理由<textarea aria-label="周期意向理由" className={field} maxLength={1000} rows={3} value={draft.reason} onChange={e => setDraft({ reason: e.target.value, ack: false })}/></label><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={draft.ack} onChange={e => setDraft({ ...draft, ack: e.target.checked })}/>已核对人员和日期；理解采用意向不生成工时表、不送审、不确认工资。</label><div className="flex flex-wrap gap-2">{canAccept && <button type="button" className={button} disabled={!enabled || !acknowledged} onClick={() => send("accept")}>明确保存采用意向</button>}{canCancel && <button type="button" className={button} disabled={!acknowledged} onClick={() => send("cancel")}>明确取消未关联意向</button>}</div></fieldset>}
    {result?.kind === "receipt" && data?.receipt && <CycleIntentReceiptView receipt={data.receipt}/>}
  </section>;
}
