"use client";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { AttendanceOutageClient, type OutageClientState, type OutageClientStorage } from "@/lib/merchantAttendanceOutageClient";
import { parseOutageLinkReference, outageLinkReferenceKey } from "@/lib/merchantAttendanceOutageLinks";
import type { OutageLinkEvidence, OutageLinkReference, OutageLinkSnapshot, OutageLinksCommand, OutageLinksQuery, OutageLinksResult } from "@/lib/merchantAttendanceOutageLinksContract";
import type { OutageReviewAction, OutageReviewEntry, OutageReviewProposal, OutageReviewQuery, OutageReviewResult } from "@/lib/merchantAttendanceOutageReviewContract";
import { integer, label, safeTree, same, site, uuid } from "@/lib/merchantAttendancePlanExceptionValidation";

export type OutageResolutionPanelProps = {
  siteId: string; actorId: string; access: "owner" | "self"; declarationId: string;
  apiFetch: AttendanceApiFetch; enabled: boolean;
  /** Internal parent contract: side-effect-free; true means there IS leave risk. */
  registerLeaveGuard?: (guard: (() => boolean) | null) => void;
};
export type OutageResolutionSourceDraft = {
  kind: "session" | "missing"; startEventId: string; lastEventId: string; lastSequence: string;
  effectOperationId: string; effectRevision: string; requestId: string; rootRequestId: string; approvalOperationId: string;
};
export const emptyOutageResolutionSource = (): OutageResolutionSourceDraft => ({ kind: "session", startEventId: "", lastEventId: "", lastSequence: "",
  effectOperationId: "", effectRevision: "", requestId: "", rootRequestId: "", approvalOperationId: "" });
export function outageResolutionReasonValid(reason: string) { try { label(reason, 1000); return true; } catch { return false; } }
export function outageResolutionSources(rows: OutageResolutionSourceDraft[]): OutageLinkReference[] | null {
  try {
    safeTree(rows, 16384); if (!Array.isArray(rows) || !rows.length || rows.length > 10) return null;
    const number = (raw: string) => { if (typeof raw !== "string" || !/^[1-9][0-9]*$/.test(raw)) throw Error("invalid_integer"); return integer(Number(raw)); };
    const sources = rows.map(row => row.kind === "session" ? parseOutageLinkReference({ kind: row.kind, startEventId: row.startEventId, lastEventId: row.lastEventId,
      lastSequence: number(row.lastSequence), effectOperationId: row.effectOperationId === "" ? null : row.effectOperationId, effectRevision: row.effectRevision === "" ? null : number(row.effectRevision) })
      : parseOutageLinkReference({ kind: row.kind, requestId: row.requestId, rootRequestId: row.rootRequestId, approvalOperationId: row.approvalOperationId }));
    return new Set(sources.map(outageLinkReferenceKey)).size === sources.length ? sources : null;
  } catch { return null; }
}
type LinkDraft = Omit<Extract<OutageLinksCommand, { action: "apply" }>, "operationId"> | Omit<Extract<OutageLinksCommand, { action: "revoke" }>, "operationId">;
export function outageResolutionLinkDraft(state: OutageClientState<"links">, action: "apply" | "revoke", reason: string, sources: OutageLinkReference[] | null): LinkDraft | null {
  const r = state.result, q = state.query;
  if (state.phase !== "ready" || state.pending || !state.canWrite || !r?.canWrite || r.receipt || !q || q.access !== "owner" || !outageResolutionReasonValid(reason)) return null;
  if (action === "apply") {
    if (q.mode !== "preview" || !r.preview?.eligible || !r.preview.fingerprint || !sources || !same(sources, q.sources) || r.revision > 98) return null;
    return { action, expectedRevision: r.revision, expectedFingerprint: r.preview.fingerprint, reason, sources };
  }
  if ((q.mode !== "detail" && q.mode !== "preview") || r.current?.action !== "apply" || r.revision > 99) return null;
  return { action, expectedRevision: r.revision, expectedFingerprint: r.current.fingerprint, reason };
}
export function outageResolutionReviewDraft(state: OutageClientState<"reviews">, action: OutageReviewAction, reason: string) {
  const r = state.result, q = state.query;
  if (state.phase !== "ready" || state.pending || !state.canWrite || !r?.canWrite || r.receipt || q?.mode !== "detail" || !outageResolutionReasonValid(reason)) return null;
  const safety = action === "dispute" || action === "reopen";
  if (r.revision > (safety ? 999 : 997) || (q.access === "self") !== (action === "confirm" || action === "dispute")) return null;
  const fingerprint = action === "propose" ? r.status?.basisFingerprint : r.proposal?.resultFingerprint;
  if (!fingerprint || action === "propose" && (!r.status?.canPropose || r.resultVersion >= 998)
    || action === "confirm" && !r.status?.canConfirm || action === "resolve" && !r.status?.canResolve
    || action === "reopen" && r.current?.action !== "resolve" || action !== "propose" && !r.proposal) return null;
  return { action, expectedRevision: r.revision, expectedResultVersion: r.resultVersion, expectedFingerprint: fingerprint, reason };
}
export function confirmOutageResolutionAction(confirm: () => boolean, current: () => boolean, action: () => void): boolean {
  if (!current() || !confirm() || !current()) return false; action(); return true;
}
// A scope may change during concurrent render before effect cleanup. Check the
// live scope at each storage boundary as well as either side of async transport;
// an old digest/response cannot acknowledge or remove its durable intent.
export function outageResolutionPorts(apiFetch: AttendanceApiFetch, storage: () => OutageClientStorage, isCurrent: () => boolean) {
  const check = () => { if (!isCurrent()) throw Error("identity_changed"); };
  return {
    storage: (): OutageClientStorage => { check(); return {
      getItem: key => { check(); const result = storage().getItem(key); check(); return result; },
      setItem: (key, value) => { check(); storage().setItem(key, value); check(); },
      removeItem: key => { check(); storage().removeItem(key); check(); },
    }; },
    apiFetch: (async (path, init) => { check(); const response = await apiFetch(path, init);
      if (!isCurrent()) { void response.body?.cancel().catch(() => {}); throw Error("identity_changed"); } return response;
    }) satisfies AttendanceApiFetch,
  };
}
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40";
const input = "mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2 text-sm disabled:bg-slate-50";
const hidden = () => typeof document !== "undefined" && document.hidden;
const actionNames = { apply: "关联来源", revoke: "撤销关联", propose: "提出核对结果", confirm: "本人确认", dispute: "本人异议", resolve: "负责人结案", reopen: "负责人重开" };
const blockerNames: Record<string, string> = {
  source_open: "工作段仍开放，不能结案", pending_source: "来源仍有待审补正或漏卡修订", source_changed: "来源或人员版本已变化，须重新核对关联",
  source_unavailable: "当前来源无法完整核验", identity_changed: "声明保存身份与当前绑定不同", source_outside_declaration: "来源不在声明影响范围内", duplicate_source: "重复引用同一来源",
  link_missing: "尚未保存来源关联", link_revoked: "来源关联已撤销", link_changed: "当前关联与结果保存版本不同", original_unknown: "原操作编号仍未核实，不代表操作失败",
  employee_unavailable: "当前员工或考勤人员不可用于确认结案", account_suspended: "考勤仍处于账号暂停保护", result_missing: "尚未提出核对结果", result_changed: "当前依据已不同于保存结果",
  unconfirmed: "等待本人确认这个结果版本", disputed: "本人对该版本提出异议", reopened: "结果已重开，原确认不能直接再次结案",
};
export default function MerchantAttendanceOutageResolutionPanel(props: OutageResolutionPanelProps) {
  const identity = `${props.siteId}:${props.actorId}:${props.access}:${props.declarationId}:${props.enabled}`;
  /* eslint-disable react-hooks/refs -- synchronous authority invalidation before layout cleanup; not rendered data */
  const live = useRef({ identity, apiFetch: props.apiFetch }); live.current = { identity, apiFetch: props.apiFetch };
  const isCurrent = useCallback(() => live.current.identity === identity && live.current.apiFetch === props.apiFetch, [identity, props.apiFetch]);
  /* eslint-enable react-hooks/refs */
  const [scope, setScope] = useState({ ...props, key: 0 });
  if (scope.siteId !== props.siteId || scope.actorId !== props.actorId || scope.access !== props.access || scope.declarationId !== props.declarationId
    || scope.enabled !== props.enabled || scope.apiFetch !== props.apiFetch) {
    setScope({ ...props, key: scope.key + 1 }); return null;
  }
  return <Prepared key={scope.key} {...props} isCurrent={isCurrent}/>;
}
function Prepared(props: OutageResolutionPanelProps & { isCurrent: () => boolean }) {
  const clients = useMemo(() => { try {
    site(props.siteId); uuid(props.actorId); uuid(props.declarationId);
    const options = { siteId: props.siteId, actorId: props.actorId, access: props.access, enabled: props.enabled,
      ...outageResolutionPorts(props.apiFetch, () => sessionStorage, props.isCurrent) };
    return { links: new AttendanceOutageClient({ ...options, kind: "links" }), reviews: new AttendanceOutageClient({ ...options, kind: "reviews" }) };
  } catch { return null; } }, [props.siteId, props.actorId, props.access, props.declarationId, props.apiFetch, props.enabled, props.isCurrent]);
  return clients ? <Screen {...props} clients={clients}/> : <section aria-label="故障来源与核对结果"><p role="alert">当前身份或声明编号无效，未读取或提交。</p></section>;
}
type Clients = { links: AttendanceOutageClient<"links">; reviews: AttendanceOutageClient<"reviews"> };
function Screen(props: OutageResolutionPanelProps & { clients: Clients; isCurrent: () => boolean }) {
  const { clients, registerLeaveGuard, enabled, access, declarationId } = props, { links, reviews } = clients;
  const ls = useSyncExternalStore(links.subscribe, links.getSnapshot, links.getSnapshot), rs = useSyncExternalStore(reviews.subscribe, reviews.getSnapshot, reviews.getSnapshot);
  const [shown, setShown] = useState(() => !hidden()), [rows, setRows] = useState<OutageResolutionSourceDraft[]>([emptyOutageResolutionSource()]);
  const [linkReason, setLinkReason] = useState(""), [reviewReason, setReviewReason] = useState(""), [linkAck, setLinkAck] = useState(false), [reviewAck, setReviewAck] = useState(false);
  const generation = useRef(0), dirty = useRef(false);
  const clearDraft = useCallback(() => { dirty.current = false; setRows([emptyOutageResolutionSource()]); setLinkReason(""); setReviewReason(""); setLinkAck(false); setReviewAck(false); }, []);
  const risk = useCallback(() => dirty.current || links.hasLeaveRisk() || reviews.hasLeaveRisk(), [links, reviews]);
  useLayoutEffect(() => { registerLeaveGuard?.(risk); return () => registerLeaveGuard?.(null); }, [registerLeaveGuard, risk]);
  useLayoutEffect(() => {
    const pause = () => { generation.current++; links.pause(); reviews.pause(); };
    const hide = () => flushSync(() => { pause(); clearDraft(); setShown(false); });
    const show = () => { if (!hidden()) { flushSync(() => { generation.current++; clearDraft(); setShown(true); }); void links.initialize(); void reviews.initialize(); } };
    const visibility = () => hidden() ? hide() : show();
    const unload = (event: BeforeUnloadEvent) => { if (!registerLeaveGuard && risk()) { event.preventDefault(); event.returnValue = ""; } };
    if (hidden()) pause(); else { void links.initialize(); void reviews.initialize(); }
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hide); window.addEventListener("pageshow", show); window.addEventListener("beforeunload", unload);
    return () => { pause(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); window.removeEventListener("beforeunload", unload); };
  }, [links, reviews, clearDraft, registerLeaveGuard, risk]);
  const visible = shown && !hidden(), busy = [ls.phase, rs.phase].some(p => p === "loading" || p === "saving"), pending = !!ls.pending || !!rs.pending;
  const matches = (r: OutageLinksResult | OutageReviewResult) => r.siteId === props.siteId && r.access === access && r.actorId === props.actorId && r.declarationId === declarationId;
  const linkResult = visible && ls.result && matches(ls.result) ? ls.result : null, reviewResult = visible && rs.result && matches(rs.result) ? rs.result : null;
  const linkQuery: OutageLinksQuery = { siteId: props.siteId, access, declarationId, mode: "detail" }, reviewQuery: OutageReviewQuery = { ...linkQuery };
  const sources = outageResolutionSources(rows), editable = visible && enabled && !busy && !pending;
  const linkDraft = (action: "apply" | "revoke") => linkResult && linkAck && editable ? outageResolutionLinkDraft(ls, action, linkReason, sources) : null;
  const reviewDraft = (action: OutageReviewAction) => reviewResult && reviewAck && editable ? outageResolutionReviewDraft(rs, action, reviewReason) : null;
  const changed = (kind: "links" | "reviews") => { generation.current++; dirty.current = true; if (kind === "links") setLinkAck(false); else setReviewAck(false); };
  const current = (epoch: number, left: typeof ls, right: typeof rs) => props.isCurrent() && visible && !hidden() && generation.current === epoch
    && links.getSnapshot() === left && reviews.getSnapshot() === right && ![left.phase, right.phase].some(p => p === "loading" || p === "saving");
  const read = (run: () => Promise<void>, discard = true) => {
    const epoch = generation.current, left = links.getSnapshot(), right = reviews.getSnapshot();
    if (!current(epoch, left, right) || busy || discard && dirty.current && !window.confirm("读取会清除未提交的来源输入与理由，继续？")) return;
    if (!current(epoch, left, right)) return; generation.current++; if (discard) clearDraft(); void run();
  };
  const confirm = (text: string, run: () => Promise<void>, eligible: () => boolean = () => true) => {
    const epoch = generation.current, left = links.getSnapshot(), right = reviews.getSnapshot();
    confirmOutageResolutionAction(() => window.confirm(text), () => current(epoch, left, right) && eligible(), () => { generation.current++; clearDraft(); void run(); });
  };
  const saveLink = (action: "apply" | "revoke") => {
    const draft = linkDraft(action); if (!draft) return;
    confirm(action === "apply" ? "保存这些明确来源为本声明的整组准备依据，替换原关联。开放或待审来源仍未解决；不会补打卡、改工时或结案。确认？" : "撤销本声明当前整组来源关联，不撤销补正、漏卡批准或原始打卡，也不自动解封。确认？",
      () => { reviews.pause(); return links.submit(linkQuery, draft); }, () => !!linkDraft(action));
  };
  const saveReview = (action: OutageReviewAction) => {
    const draft = reviewDraft(action); if (!draft) return;
    const texts: Record<OutageReviewAction, string> = { propose: "提出新的核对结果版本；原本人确认不会代替对新版本的确认。不会改工时或认定未知原号失败。确认？",
      confirm: "我本人已核对显示的结果版本、原始操作与来源快照，明确确认该精确版本。确认不会自动结案。继续？", dispute: "我本人对当前保存的结果版本提出异议；不会删除旧结果或自动解封周期。确认？",
      resolve: "依据本人对同一结果版本的明确确认及当前来源核验，保存本声明结案。不会自动送审、确认或封存周期。确认？", reopen: "重开当前已结案结果，旧记录保留；再次结案需新的本人确认或新的结果版本。确认？" };
    confirm(texts[action], () => { links.pause(); return reviews.submit(reviewQuery, draft); }, () => !!reviewDraft(action));
  };
  return <section aria-label="故障来源与核对结果" data-outage-resolution className="min-w-0 space-y-4 rounded-xl border border-indigo-200 p-3">
    <h3 className="text-lg font-bold">故障来源与核对结果</h3><p className="break-all text-sm">当前声明：{declarationId}</p>
    <p className="rounded-lg bg-amber-50 p-3 text-sm">关联只是准备核对，不是补打卡，也不修改原始、核定、漏卡工时或工资。原操作未知不代表失败；来源开放、待审或后来变化时不能据此结案。周期仍须另行明确送审、本人确认与负责人封存；已封存内容不会在这里自动解封或重写。</p>
    {!enabled && <p>新关联和核对操作已关闭；仍可明确读取保存资料、核对原编号。服务端拒绝读取时原编号继续保留。</p>}
    {!visible ? <p role="status">资料已隐藏，未提交输入已清除；返回后须明确重新读取。</p> : <>
      <ResolutionPending label="来源关联" state={ls} declarationId={declarationId} busy={busy} onRecover={() => read(() => links.recover())}
        onEnd={() => confirm("只结束服务器已经明确拒绝的这次来源关联尝试，不撤销任何历史操作。确认？", () => links.endRejectedAttempt(), () => links.getSnapshot().canEndRejectedAttempt)}/>
      <ResolutionPending label="核对结果" state={rs} declarationId={declarationId} busy={busy} onRecover={() => read(() => reviews.recover())}
        onEnd={() => confirm("只结束服务器已经明确拒绝的这次结果操作尝试，不取消或替代任何已保存结果。确认？", () => reviews.endRejectedAttempt(), () => reviews.getSnapshot().canEndRejectedAttempt)}/>
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy || pending} onClick={() => read(() => links.load(linkQuery))}>读取当前来源关联</button>
        <button type="button" className={button} disabled={busy || pending} onClick={() => read(() => links.load({ ...linkQuery, mode: "history", beforeRevision: null }))}>读取关联历史</button>
        <button type="button" className={button} disabled={busy || pending} onClick={() => read(() => reviews.load(reviewQuery))}>读取当前核对结果</button>
        <button type="button" className={button} disabled={busy || pending} onClick={() => read(() => reviews.load({ ...reviewQuery, mode: "history", beforeRevision: null }))}>读取核对历史</button></div>
      {linkResult && <OutageResolutionLinksView result={linkResult}/>}
      {linkResult?.historyTruncated && <button type="button" className={button} disabled={busy || pending} onClick={() => read(() => links.load({ ...linkQuery, mode: "history", beforeRevision: linkResult.history.at(-1)!.revision }))}>更早的关联历史</button>}
      {access === "owner" && <section aria-label="明确来源关联表单" className="space-y-3 rounded-lg border p-3">
        <h4 className="font-semibold">输入已知真实来源（最多10项）</h4><p className="text-sm">从原始记录／核定补正或已批准漏卡的合法页面核对编号与版本。此处不搜索全部人员，不从时间猜测来源，也不把未批准申请当成有效漏卡。</p>
        <fieldset disabled={!editable} className="space-y-3">{rows.map((row, index) => <SourceRow key={index} row={row} index={index} onChange={patch => { changed("links"); setRows(items => items.map((r, n) => n === index ? { ...r, ...patch } : r)); }}
          onRemove={rows.length > 1 ? () => { changed("links"); setRows(items => items.filter((_, n) => n !== index)); } : undefined}/>)}
          <button type="button" className={button} disabled={rows.length >= 10} onClick={() => { changed("links"); setRows(items => [...items, emptyOutageResolutionSource()]); }}>增加来源</button>
          <button type="button" className={button} disabled={!sources} onClick={() => { if (sources) read(() => links.load({ ...linkQuery, access: "owner", mode: "preview", sources }), false); }}>预览这些明确来源</button>
        </fieldset>
        <p className="text-xs">预览不会保存。编辑任一来源后，必须明确重新预览；每次关联保存替换整组，不是追加。开放／待审标记可以留作准备，但不能作为已解决证据。</p>
        <Reason label="来源关联理由" value={linkReason} disabled={!editable} onChange={value => { changed("links"); setLinkReason(value); }}/>
        <label className="flex gap-2 text-sm"><input type="checkbox" aria-label="确认已核对整组来源与声明" checked={linkAck} disabled={!editable} onChange={e => { generation.current++; dirty.current = true; setLinkAck(e.target.checked); }}/>已核对声明、来源精确版本、预览及理由；知道这不是结案。</label>
        <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!linkDraft("apply")} onClick={() => saveLink("apply")}>保存本次整组来源关联</button>
          <button type="button" className={button} disabled={!linkDraft("revoke")} onClick={() => saveLink("revoke")}>撤销当前来源关联</button></div>
      </section>}
      {reviewResult && <OutageResolutionReviewView result={reviewResult}/>}
      {reviewResult?.historyTruncated && <button type="button" className={button} disabled={busy || pending} onClick={() => read(() => reviews.load({ ...reviewQuery, mode: "history", beforeRevision: reviewResult.history.at(-1)!.revision }))}>更早的核对历史</button>}
      {reviewResult?.mode === "detail" && !reviewResult.receipt && <section aria-label="明确核对结果操作" className="space-y-3 rounded-lg border p-3">
        <p className="text-sm">{access === "owner" ? "负责人只能提出、结案或重开，不能替员工确认或提出本人异议。" : "本人只对显示的保存结果版本确认或提出异议，不修改负责人结果。"}</p>
        <Reason label={access === "owner" ? "负责人核对理由" : "本人核对说明"} value={reviewReason} disabled={!editable} onChange={value => { changed("reviews"); setReviewReason(value); }}/>
        <label className="flex gap-2 text-sm"><input type="checkbox" aria-label="确认已核对结果精确版本与证据" checked={reviewAck} disabled={!editable} onChange={e => { generation.current++; dirty.current = true; setReviewAck(e.target.checked); }}/>已核对结果版本 {reviewResult.resultVersion}、账本版本 {reviewResult.revision}、保存证据与当前变化。</label>
        <div className="flex flex-wrap gap-2">{(access === "owner" ? ["propose", "resolve", "reopen"] as const : ["confirm", "dispute"] as const).map(action => <button key={action} type="button" className={button} disabled={!reviewDraft(action)} onClick={() => saveReview(action)}>
          {{ propose: "提出新核对结果", resolve: "明确结案", reopen: "重开已结案结果", confirm: "本人确认当前结果", dispute: "本人提出异议" }[action]}</button>)}</div>
        <p className="text-xs">保存后只显示该原号回执；继续操作须明确重新读取。开放来源、待审、原号未知、绑定变化、异议等不能由勾选确认绕过。</p>
      </section>}
    </>}
  </section>;
}
function ResolutionPending({ label: name, state, declarationId, busy, onRecover, onEnd }: { label: string; state: OutageClientState<"links"> | OutageClientState<"reviews">;
  declarationId: string; busy: boolean; onRecover: () => void; onEnd: () => void }) {
  return <div className="min-w-0 space-y-2 text-sm"><p role="status" aria-live="polite">{name}：{state.message}</p>
    {state.result && state.result.declarationId !== declarationId && <p>已核对的是另一声明原号，正文不在当前声明展示；请明确读取当前声明。</p>}
    {state.pending && <div className="space-y-2 rounded-lg border border-amber-300 p-3"><p>结果待确认；不展示本地待确认正文，不自动重发，不从未找到回执推断操作失败。</p>
      <p className="break-all">{state.pending.query.declarationId !== declarationId ? "另一声明的待确认编号" : "本声明的待确认编号"}：{state.pending.command.operationId}<br/>声明：{state.pending.query.declarationId}</p>
      <button type="button" className={button} disabled={busy} onClick={onRecover}>只核对{name}原编号</button>
      {state.canEndRejectedAttempt && <button type="button" className={button} disabled={busy} onClick={onEnd}>结束已明确拒绝的{name}尝试</button>}</div>}
  </div>;
}
function SourceRow({ row, index, onChange, onRemove }: { row: OutageResolutionSourceDraft; index: number; onChange: (patch: Partial<OutageResolutionSourceDraft>) => void; onRemove?: () => void }) {
  const fields: [keyof OutageResolutionSourceDraft, string][] = row.kind === "session" ? [["startEventId", "开始事件编号"], ["lastEventId", "末尾事件编号"], ["lastSequence", "末尾序号"], ["effectOperationId", "核定操作编号（无核定留空）"], ["effectRevision", "核定版本（无核定留空）"]]
    : [["rootRequestId", "漏卡根申请编号"], ["requestId", "当前已批准申请编号"], ["approvalOperationId", "当前批准操作编号"]];
  return <fieldset className="min-w-0 space-y-2 rounded-lg bg-slate-50 p-3"><legend>第{index + 1}项来源</legend><label className="block text-sm">来源类型<select className={input} aria-label={`第${index + 1}项来源类型`} value={row.kind} onChange={e => onChange({ ...emptyOutageResolutionSource(), kind: e.target.value === "missing" ? "missing" : "session" })}><option value="session">原始／核定工作段</option><option value="missing">已批准漏卡</option></select></label>
    {fields.map(([key, name]) => <label key={key} className="block text-sm">{name}<input className={input} aria-label={`第${index + 1}项${name}`} value={row[key]} maxLength={key.includes("Revision") || key === "lastSequence" ? 16 : 36} onChange={e => onChange({ [key]: e.target.value })}/></label>)}
    {onRemove && <button type="button" className={button} onClick={onRemove}>移除第{index + 1}项来源</button>}</fieldset>;
}
function Reason({ label: name, value, disabled, onChange }: { label: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
  return <label className="block text-sm">{name}<textarea className={input} aria-label={name} rows={2} value={value} maxLength={1000} disabled={disabled} onChange={e => onChange(e.target.value)}/><span className="text-xs">必填1至1000字；无首尾空格、换行或控制字符。</span>{value && !outageResolutionReasonValid(value) && <span role="alert" className="block">理由格式尚不符合要求。</span>}</label>;
}
function Blockers({ values }: { values: readonly string[] }) { return values.length ? <ul className="space-y-1 text-sm text-amber-900">{values.map(value => <li key={value}>{blockerNames[value] ?? "当前依据不能完整核验"}</li>)}</ul> : <p className="text-sm">本次来源核验未报告阻断；不自动生成本人确认或结案。</p>; }
function Reference({ reference: r }: { reference: OutageLinkReference }) {
  return <p className="break-all text-xs">{r.kind === "session" ? <>工作段：{r.startEventId}<br/>末尾：{r.lastEventId} · 序号 {r.lastSequence}<br/>核定：{r.effectOperationId ?? "无"} · 版本 {r.effectRevision ?? "无"}</>
    : <>漏卡根申请：{r.rootRequestId}<br/>当前申请：{r.requestId}<br/>批准操作：{r.approvalOperationId}</>}</p>;
}
function Snapshot({ value }: { value: OutageLinkSnapshot }) {
  return <div className="min-w-0 space-y-1 rounded-lg border p-2"><Reference reference={value.reference}/><p className="break-all text-xs">地点 {value.locationId} · {value.timeZone}<br/>原始 UTC：{value.original ? `${value.original.startAt} → ${value.original.endAt ?? "未结束"}` : "漏卡无原始事件区间"}<br/>当前选定 UTC：{value.selected.startAt} → {value.selected.endAt ?? "未结束"}</p>
    <p className="text-sm">{value.open ? "来源仍开放" : "来源已结束"} · {value.pending ? "存在待审修订" : "本次未发现待审修订"}</p><p className="break-all text-xs">保存来源指纹：{value.evidenceFingerprint}</p></div>;
}
export function OutageResolutionEvidenceView({ evidence }: { evidence: OutageLinkEvidence }) {
  return <div className="min-w-0 space-y-2"><p className="break-all text-xs">考勤人员：{evidence.workerId}<br/>员工：{evidence.employeeId}<br/>保存 Auth：{evidence.employeeAuthUserId}<br/>人员版本 {evidence.workerVersion} · 员工版本 {evidence.employeeVersion} · 暂停代际 {evidence.generation}</p>
    <p className="break-all text-sm">声明影响 UTC：{evidence.declaredInterval.startAt} → {evidence.declaredInterval.endAt}<br/>{evidence.declaredInterval.timeZone} · 首尾偏移分钟 {evidence.declaredInterval.startOffsetMinutes} / {evidence.declaredInterval.endOffsetMinutes}</p>
    {evidence.items.map(item => <Snapshot key={outageLinkReferenceKey(item.reference)} value={item}/>)}</div>;
}
function Entry({ entry }: { entry: OutageReviewEntry }) { return <p className="break-all text-sm">{actionNames[entry.action]} · 账本版本 {entry.revision} · 结果版本 {entry.resultVersion}<br/>真实操作者：{entry.actorId}<br/>原操作：{entry.operationId} · {entry.recordedAt}<br/>理由：{entry.reason}<br/>结果指纹：{entry.resultFingerprint}</p>; }
function Proposal({ value }: { value: OutageReviewProposal }) {
  const original = value.evidence.original;
  return <section aria-label="保存的核对结果证据" className="min-w-0 space-y-2 rounded-lg border p-3"><h5 className="font-semibold">保存的核对结果（不随当前来源变化重写）</h5><Entry entry={value}/>
    <p className="break-all text-sm">关联版本 {value.evidence.linkRevision} · 原关联操作 {value.evidence.linkOperationId}<br/>关联指纹：{value.evidence.linkFingerprint}</p>
    <p className="break-all text-sm">{original.status === "not_required" ? "本声明未提供待核原操作编号；不代表没有其他待办。" : original.status === "verified" ? `原操作已核实于真实历史事件：${original.eventId}` : "原操作编号仍未核实，不代表失败或可重复补录。"}
      {original.operationId && <><br/>原操作线索：{original.operationId} · {original.channel}</>}</p><OutageResolutionEvidenceView evidence={value.evidence.linkEvidence}/></section>;
}
export function OutageResolutionLinksView({ result: r }: { result: OutageLinksResult }) {
  const saved = r.receipt?.entry ?? r.current;
  return <section aria-label="已核验关联资料" className="min-w-0 space-y-3 rounded-lg bg-slate-50 p-3"><h4 className="font-semibold">{r.receipt ? "来源关联原号回执" : "来源关联保存记录"} · 版本 {r.revision}</h4>
    <p className="text-xs">本次读取：{r.readAt}；只表示该读取时点，不自动轮询。</p>
    {saved && <div className="space-y-2"><p className="break-all text-sm">{actionNames[saved.action]} · 原操作 {saved.operationId}<br/>真实操作者：{saved.actorId} · {saved.recordedAt}<br/>理由：{saved.reason}<br/>保存指纹：{saved.fingerprint}</p>
      {saved.evidence ? <><h5 className="font-semibold">当时保存的来源快照</h5><OutageResolutionEvidenceView evidence={saved.evidence}/></> : <p>这是撤销记录，不删除旧关联或底层业务事实。</p>}</div>}
    {r.receipt && <p>已核验原操作回执，不证明关联仍为当前版本；下一步须明确重新读取。</p>}
    {r.preview && <section aria-label="当前来源重新核验" className="space-y-2 rounded-lg border border-blue-200 p-3"><h5 className="font-semibold">本次服务端重新核验（与保存快照分开）</h5><Blockers values={r.preview.blockers}/>
      <p>{r.preview.eligible ? "可以保存为准备关联，仍不等于可以确认或结案。" : "当前不能保存这些关联；不得只取部分来源绕过。"}</p>
      {r.preview.observations.map(o => <div key={outageLinkReferenceKey(o.reference)} className="space-y-1"><Reference reference={o.reference}/><p>{!o.available ? "当前不可完整核验，不推断来源不存在。" : o.changed ? "当前来源已不同于所核对保存依据。" : "本次未发现该来源引用变化。"}</p>{o.current && <Snapshot value={o.current}/>}</div>)}</section>}
    {r.mode === "history" && <><h5>关联历史（每页最多25条，不是完整来源快照）</h5>{r.history.map(e => <p key={e.operationId} className="break-all text-sm">版本 {e.revision} · {actionNames[e.action]} · {e.sourceCount} 项<br/>{e.operationId} · {e.actorId} · {e.recordedAt}<br/>{e.reason}</p>)}</>}
    {!saved && r.mode !== "history" && <p>尚无已保存来源关联；预览不等于保存。</p>}
  </section>;
}
export function OutageResolutionReviewView({ result: r }: { result: OutageReviewResult }) {
  return <section aria-label="已核验核对资料" className="min-w-0 space-y-3 rounded-lg bg-slate-50 p-3"><h4 className="font-semibold">{r.receipt ? "核对操作原号回执" : "核对结果与当前状态"} · 账本版本 {r.revision} · 结果版本 {r.resultVersion}</h4>
    <p className="text-xs">本次读取：{r.readAt}；状态不是持续监控结果。</p>
    {r.receipt ? <><Entry entry={r.receipt.entry}/><Proposal value={r.receipt.proposal}/><p>这是该原编号当时结果，不代表目前已结案；请明确重新读取当前状态。</p></> : <>
      {r.current && <div aria-label="最新保存操作"><Entry entry={r.current}/></div>}{r.proposal && <Proposal value={r.proposal}/>}
      {r.response && <section aria-label="这个结果版本的本人回应"><h5 className="font-semibold">这个结果版本的本人回应</h5><Entry entry={r.response}/></section>}
      {r.status && <section aria-label="当前结案核验"><h5 className="font-semibold">{r.status.resolved ? "本次核验：该声明当前已结案" : r.current?.action === "resolve" ? "原结案仍保留，但当前依据已不满足结案" : "当前未结案"}</h5><Blockers values={r.status.blockers}/>
        <p className="break-all text-xs">当前关联版本 {r.status.linkRevision} · 当前依据指纹 {r.status.basisFingerprint ?? "尚不可用"}</p></section>}
      {r.mode === "history" && <><h5>核对历史（每页最多25条，不以旧确认代替当前确认）</h5>{r.history.map(e => <Entry key={e.operationId} entry={e}/>)}</>}
    </>}
  </section>;
}
