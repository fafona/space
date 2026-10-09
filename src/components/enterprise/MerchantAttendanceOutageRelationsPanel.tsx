"use client";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { AttendanceOutageClient, type OutageClientState } from "@/lib/merchantAttendanceOutageClient";
import type { OutageDeclaration } from "@/lib/merchantAttendanceOutageContract";
import type { OutageRelationEvidence, OutageRelationKind, OutageRelationsCommand, OutageRelationsQuery, OutageRelationsResult } from "@/lib/merchantAttendanceOutageRelationsContract";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { label, site, uuid } from "@/lib/merchantAttendancePlanExceptionValidation";
import { confirmOutageResolutionAction, outageResolutionPorts } from "./MerchantAttendanceOutageResolutionPanel";

export type OutageRelationsPanelProps = {
  siteId: string; actorId: string; access: "owner" | "self"; declarationId: string;
  apiFetch: AttendanceApiFetch; enabled: boolean;
  /** Side-effect-free; true means there IS leave risk. */
  registerLeaveGuard?: (guard: (() => boolean) | null) => void;
};
type DetailQuery = Extract<OutageRelationsQuery, { mode: "detail" }>;
export type OutageRelationsPairRead = { query: DetailQuery; declarations: [OutageDeclaration, OutageDeclaration]; readAt: [string, string] };
type RelationDraft = Omit<Extract<OutageRelationsCommand, { action: "apply" }>, "operationId"> | Omit<Extract<OutageRelationsCommand, { action: "revoke" }>, "operationId">;
export function outageRelationsTargetValid(id: string, own: string) { try { uuid(id); return id !== own; } catch { return false; } }
export function outageRelationsReasonValid(reason: string) { try { label(reason, 1000); return true; } catch { return false; } }
export function outageRelationsEvidenceMatches(pair: OutageRelationsPairRead, evidence: OutageRelationEvidence | null): boolean {
  if (!evidence || evidence.siteId !== pair.query.siteId) return false;
  return pair.declarations.every(record => record.workerId === evidence.workerId && record.employeeId === evidence.employeeId
    && record.employeeAuthUserId === evidence.employeeAuthUserId && evidence.declarations.some(ref => ref.declarationId === record.id && ref.operationId === record.operationId));
}
function pairScope(pair: OutageRelationsPairRead, q: DetailQuery, result: OutageRelationsResult): boolean {
  const [a, b] = pair.declarations;
  return pair.query.siteId === q.siteId && pair.query.access === q.access && pair.query.declarationId === q.declarationId && pair.query.relatedDeclarationId === q.relatedDeclarationId
    && result.siteId === q.siteId && result.access === q.access && result.mode === "detail" && result.declarationId === q.declarationId && result.relatedDeclarationId === q.relatedDeclarationId
    && a.id === q.declarationId && b.id === q.relatedDeclarationId && a.workerId === b.workerId && a.employeeId === b.employeeId && a.employeeAuthUserId === b.employeeAuthUserId;
}
export function outageRelationsDraft(state: OutageClientState<"relations">, pair: OutageRelationsPairRead | null, action: "apply" | "revoke", reason: string, kind: OutageRelationKind | ""): RelationDraft | null {
  const r = state.result, q = state.query;
  if (state.phase !== "ready" || state.pending || !state.canWrite || !r?.canWrite || r.receipt || q?.mode !== "detail" || q.access !== "owner"
    || !pair || !pairScope(pair, q, r) || !outageRelationsReasonValid(reason)) return null;
  if (action === "apply") {
    if (!r.preview?.eligible || !r.preview.fingerprint || r.revision > 98 || !outageRelationsEvidenceMatches(pair, r.preview.evidence)
      || kind !== "possible_duplicate" && kind !== "complementary") return null;
    return { action, kind, expectedRevision: r.revision, expectedFingerprint: r.preview.fingerprint, reason };
  }
  // Safe revocation uses the saved head, never the current apply eligibility.
  if (r.current?.action !== "apply" || r.revision < 1 || r.revision > 99 || !outageRelationsEvidenceMatches(pair, r.current.evidence)) return null;
  return { action, expectedRevision: r.revision, expectedFingerprint: r.current.fingerprint, reason };
}
type Reader = Pick<AttendanceOutageClient<"outages">, "load" | "getSnapshot">;
type RelationReader = Pick<AttendanceOutageClient<"relations">, "load" | "getSnapshot">;
/** No intermediate body escapes. Clients validate transport/actor; this binds
 * immutable record IDs/operations/identities to the independently read pair.
 * SQL-canonical record SHA is verified by the server, not recreated here. */
export async function readOutageRelationsPair(reader: Reader, relations: RelationReader, query: DetailQuery, current: () => boolean): Promise<OutageRelationsPairRead> {
  const declarations: OutageDeclaration[] = [], readAt: string[] = [];
  for (const declarationId of [query.declarationId, query.relatedDeclarationId]) {
    if (!current()) throw Error("outage_relation_read_cancelled");
    await reader.load({ siteId: query.siteId, access: query.access, mode: "declaration", declarationId });
    const s = reader.getSnapshot(), r = s.result;
    if (!current() || s.phase !== "ready" || s.pending || !r || r.receipt || r.mode !== "declaration" || r.siteId !== query.siteId || r.access !== query.access
      || r.detail?.kind !== "declaration" || r.detail.id !== declarationId) throw Error("outage_relation_read_unavailable");
    declarations.push(r.detail); readAt.push(r.readAt);
  }
  if (!current()) throw Error("outage_relation_read_cancelled");
  await relations.load(query);
  const s = relations.getSnapshot(), r = s.result;
  const pair: OutageRelationsPairRead = { query, declarations: declarations as [OutageDeclaration, OutageDeclaration], readAt: readAt as [string, string] };
  if (!current() || s.phase !== "ready" || s.pending || !r || r.receipt || !pairScope(pair, query, r)
    || r.preview?.evidence && !outageRelationsEvidenceMatches(pair, r.preview.evidence)
    || r.current?.evidence && !outageRelationsEvidenceMatches(pair, r.current.evidence)) throw Error("outage_relation_pair_changed");
  return pair;
}
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40";
const input = "mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2 text-sm disabled:bg-slate-50";
const hidden = () => typeof document !== "undefined" && document.hidden;
const kinds = { possible_duplicate: "可能重复", complementary: "相互补充" };
const blockers: Record<string, string> = { identity_changed: "当前身份绑定与保存声明不同", worker_inactive: "考勤人员未启用", employee_inactive: "企业员工未启用",
  account_suspended: "考勤处于暂停保护", settings_disabled: "考勤功能已关闭", pair_limit: "该声明关系数量已达上限", revision_limit: "该对关系版本已达上限" };
export default function MerchantAttendanceOutageRelationsPanel(props: OutageRelationsPanelProps) {
  const identity = `${props.siteId}:${props.actorId}:${props.access}:${props.declarationId}:${props.enabled}`;
  /* eslint-disable react-hooks/refs -- synchronous authority invalidation before effect cleanup */
  const live = useRef({ identity, apiFetch: props.apiFetch }); live.current = { identity, apiFetch: props.apiFetch };
  const isCurrent = useCallback(() => live.current.identity === identity && live.current.apiFetch === props.apiFetch, [identity, props.apiFetch]);
  /* eslint-enable react-hooks/refs */
  const [scope, setScope] = useState({ identity, apiFetch: props.apiFetch, key: 0 });
  if (scope.identity !== identity || scope.apiFetch !== props.apiFetch) { setScope({ identity, apiFetch: props.apiFetch, key: scope.key + 1 }); return null; }
  return <Prepared key={scope.key} {...props} isCurrent={isCurrent}/>;
}
function Prepared(props: OutageRelationsPanelProps & { isCurrent: () => boolean }) {
  const clients = useMemo(() => { try {
    site(props.siteId); uuid(props.actorId); uuid(props.declarationId);
    const options = { siteId: props.siteId, actorId: props.actorId, access: props.access, ...outageResolutionPorts(props.apiFetch, () => sessionStorage, props.isCurrent) };
    return { relations: new AttendanceOutageClient({ ...options, kind: "relations", enabled: props.enabled }), reader: new AttendanceOutageClient({ ...options, kind: "outages", enabled: false }) };
  } catch { return null; } }, [props.siteId, props.actorId, props.access, props.declarationId, props.apiFetch, props.enabled, props.isCurrent]);
  return clients ? <Screen {...props} clients={clients}/> : <section aria-label="声明之间的明确关系"><p role="alert">当前身份或声明编号无效，未读取或提交。</p></section>;
}
type Clients = { relations: AttendanceOutageClient<"relations">; reader: AttendanceOutageClient<"outages"> };
function Screen(props: OutageRelationsPanelProps & { clients: Clients; isCurrent: () => boolean }) {
  const { relations, reader } = props.clients, { access, declarationId, registerLeaveGuard, enabled, isCurrent } = props;
  const state = useSyncExternalStore(relations.subscribe, relations.getSnapshot, relations.getSnapshot), rs = useSyncExternalStore(reader.subscribe, reader.getSnapshot, reader.getSnapshot);
  const [shown, setShown] = useState(() => !hidden()), [other, setOther] = useState(""), [pair, setPair] = useState<OutageRelationsPairRead | null>(null);
  const [reason, setReason] = useState(""), [kind, setKind] = useState<OutageRelationKind | "">(""), [ack, setAck] = useState(false), [message, setMessage] = useState("");
  const generation = useRef(0), dirty = useRef(false), working = useRef(false), [readingPair, setReadingPair] = useState(false);
  const clear = useCallback(() => { dirty.current = false; setOther(""); setPair(null); setReason(""); setKind(""); setAck(false); setMessage(""); }, []);
  const risk = useCallback(() => dirty.current || working.current || relations.hasLeaveRisk() || reader.hasLeaveRisk(), [relations, reader]);
  useLayoutEffect(() => { registerLeaveGuard?.(risk); return () => registerLeaveGuard?.(null); }, [registerLeaveGuard, risk]);
  useLayoutEffect(() => {
    const pause = () => { generation.current++; working.current = false; relations.pause(); reader.pause(); };
    const hide = () => flushSync(() => { pause(); clear(); setReadingPair(false); setShown(false); });
    const show = () => { if (isCurrent() && !hidden()) { flushSync(() => { generation.current++; clear(); setReadingPair(false); setShown(true); }); void relations.initialize(); void reader.initialize(); } };
    const visibility = () => hidden() ? hide() : show();
    const unload = (event: BeforeUnloadEvent) => { if (!registerLeaveGuard && risk()) { event.preventDefault(); event.returnValue = ""; } };
    if (hidden()) pause(); else { void relations.initialize(); void reader.initialize(); }
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hide); window.addEventListener("pageshow", show); window.addEventListener("beforeunload", unload);
    return () => { pause(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); window.removeEventListener("beforeunload", unload); };
  }, [relations, reader, clear, registerLeaveGuard, risk, isCurrent]);
  const visible = shown && !hidden(), busy = readingPair || [state.phase, rs.phase].some(p => p === "loading" || p === "saving"), pending = !!state.pending || !!rs.pending;
  const result = visible && !readingPair && state.result?.declarationId === declarationId ? state.result : null;
  const base = { siteId: props.siteId, access, declarationId }, query = (id: string): DetailQuery => ({ ...base, mode: "detail", relatedDeclarationId: id });
  const live = (epoch: number) => props.isCurrent() && visible && !hidden() && generation.current === epoch;
  const current = (epoch: number, snapshot: typeof state, readSnapshot: typeof rs) => live(epoch) && !working.current && relations.getSnapshot() === snapshot && reader.getSnapshot() === readSnapshot
    && ![snapshot.phase, readSnapshot.phase].some(phase => phase === "loading" || phase === "saving");
  const start = () => { const epoch = generation.current, s = relations.getSnapshot(), r = reader.getSnapshot();
    if (!current(epoch, s, r) || busy || dirty.current && !window.confirm("读取会清除未提交的关系输入与理由，继续？") || !current(epoch, s, r)) return false;
    generation.current++; clear(); return true;
  };
  const read = (run: () => Promise<void>) => { if (start()) { reader.pause(); void run(); } };
  const readPair = async (id: string) => {
    if (!outageRelationsTargetValid(id, declarationId) || pending || !start()) return;
    const epoch = generation.current; working.current = true; setReadingPair(true); relations.pause(); reader.pause();
    try { const value = await readOutageRelationsPair(reader, relations, query(id), () => live(epoch));
      if (live(epoch)) { setPair(value); setOther(id); setMessage("双方声明与关系依据均已读取。以下为保存事实，不表示当前结案或周期处理已完成。"); }
    } catch { if (live(epoch)) { reader.pause(); relations.pause(); setPair(null); setMessage("未能完整核对双方声明与关系依据，已清除本次正文。请检查权限后明确重读；未提交任何关系。"); } }
    finally { if (generation.current === epoch) { working.current = false; setReadingPair(false); } }
  };
  const draft = (action: "apply" | "revoke") => visible && enabled && !busy && !pending && ack ? outageRelationsDraft(state, pair, action, reason, kind) : null;
  const confirm = (text: string, run: () => Promise<void>, allowed: () => boolean) => {
    const epoch = generation.current, s = relations.getSnapshot(), r = reader.getSnapshot();
    confirmOutageResolutionAction(() => window.confirm(text), () => current(epoch, s, r) && !busy && allowed(), () => { generation.current++; clear(); reader.pause(); void run(); });
  };
  const submit = (action: "apply" | "revoke") => { const command = draft(action), q = state.query; if (!command || q?.mode !== "detail") return;
    confirm(action === "apply" ? "明确记录这两份声明的关系提示？不合并声明，不沿用任何本人确认或结案，也不改变工时、周期阻断或其他关联。" : "明确撤销这对声明的当前关系提示？双方声明、历史关系、核对结果及周期事实均保留。",
      () => relations.submit(q, command), () => !!draft(action));
  };
  const changed = () => { generation.current++; dirty.current = true; setAck(false); };
  return <section aria-label="声明之间的明确关系" data-outage-relations className="min-w-0 space-y-3 rounded-xl border border-teal-200 p-3">
    <h3 className="text-lg font-bold">声明之间的明确关系</h3><p className="break-all text-sm">本声明：{declarationId}</p>
    <p className="rounded-lg bg-amber-50 p-3 text-sm">“可能重复”或“相互补充”仅是同一员工两份声明之间的明确提示。不自动合并，不传递到第三份声明，不复用本人确认或结案，不豁免周期逐项核对，也不增加或扣减工时。</p>
    {!enabled && <p>新关系写入已关闭；仍可明确读取历史或 GET 核对原编号。</p>}
    {!visible ? <p role="status">资料已隐藏，未提交输入已清除；返回后须明确重新读取。</p> : <>
      <p role="status" aria-live="polite">{message || state.message}</p>
      {rs.pending && <p role="alert">当前身份另有故障登记或声明待核编号，请先在上方原入口恢复；这里不回显或处理该命令正文。</p>}
      <OutageRelationsPending state={state} busy={busy} declarationId={declarationId} onRecover={() => read(() => relations.recover())}
        onEnd={() => confirm("只结束服务器本次已明确拒绝的本地关系尝试，不撤销历史。确认？", () => relations.endRejectedAttempt(), () => relations.getSnapshot().canEndRejectedAttempt)}/>
      <button type="button" className={button} disabled={busy || pending} onClick={() => read(() => relations.load({ ...base, mode: "list" }))}>读取本声明关系</button>
      {access === "owner" && <label className="block text-sm">另一份已知声明编号<input aria-label="关系另一声明编号" className={input} maxLength={36} disabled={busy || pending} value={other} onChange={e => { changed(); setPair(null); relations.pause(); reader.pause(); setOther(e.target.value); }}/></label>}
      {access === "owner" && <button type="button" className={button} disabled={busy || pending || !outageRelationsTargetValid(other, declarationId)} onClick={() => { void readPair(other); }}>读取双方声明与关系依据</button>}
      {readingPair && <p role="status">正在依次核验双方声明与关系，全部成功前不显示部分正文。</p>}
      {pair && !readingPair && <OutageRelationsPairView pair={pair}/>}
      {result && <OutageRelationsResultView result={result} disabled={busy || pending} onPair={id => { void readPair(id); }} onHistory={id => read(() => relations.load({ ...query(id), mode: "history", beforeRevision: null }))}/>}
      {result?.mode === "history" && result.historyTruncated && result.relatedDeclarationId && <button type="button" className={button} disabled={busy || pending} onClick={() => read(() => relations.load({ ...query(result.relatedDeclarationId!), mode: "history", beforeRevision: result.history.at(-1)!.revision }))}>更早的声明关系历史</button>}
      {access === "owner" && <section aria-label="明确声明关系表单" className="space-y-3 rounded-lg border p-3">
        <p className="text-sm">须先完整读取双方声明。登记使用当前预览；撤销使用已保存关系的精确版本，即使当前人员资格已变化也须服务端核验。</p>
        <label className="block text-sm">关系类型<select aria-label="声明关系类型" className={input} value={kind} disabled={!enabled || busy || pending || !pair} onChange={e => { changed(); setKind(e.target.value as OutageRelationKind | ""); }}><option value="">请明确选择（撤销不需选择）</option>{Object.entries(kinds).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
        <label className="block text-sm">登记／撤销理由<textarea aria-label="声明关系理由" className={input} rows={3} maxLength={2000} value={reason} disabled={!enabled || busy || pending || !pair} onChange={e => { changed(); setReason(e.target.value); }}/><span className="text-xs">1–1000 字；不填写密码、PIN 或不必要的个人信息。</span></label>
        <label className="flex items-start gap-2 text-sm"><input aria-label="确认双方声明关系" type="checkbox" checked={ack} disabled={!enabled || busy || pending || !pair} onChange={e => { generation.current++; dirty.current = true; setAck(e.target.checked); }}/><span>已阅读双方声明、当前关系与理由，明确本操作只是关系提示，不代替独立处理。</span></label>
        <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!draft("apply")} onClick={() => submit("apply")}>明确登记声明关系</button><button type="button" className={button} disabled={!draft("revoke")} onClick={() => submit("revoke")}>明确撤销声明关系</button></div>
      </section>}
    </>}
  </section>;
}
export function OutageRelationsPending({ state, busy, declarationId, onRecover, onEnd }: { state: OutageClientState<"relations">; busy: boolean; declarationId: string; onRecover: () => void; onEnd: () => void }) {
  const p = state.pending; if (!p) return null;
  return <section data-outage-relations-pending className="space-y-2 rounded-lg bg-amber-50 p-3 text-sm"><p>关系操作结果待核对；不自动重发，不从本地命令回显理由或正文。</p><p className="break-all">原操作：{p.command.operationId}<br/>原声明：{p.query.declarationId}<br/>另一声明：{"relatedDeclarationId" in p.query ? p.query.relatedDeclarationId : "待核验"}</p>
    {p.query.declarationId !== declarationId && <p>该待核编号属于另一份原声明；仅按原方向核对，不用于当前声明新写。</p>}
    <button type="button" className={button} disabled={busy} onClick={onRecover}>核对声明关系原编号</button>{state.canEndRejectedAttempt && <button type="button" className={button} disabled={busy} onClick={onEnd}>明确结束被拒绝关系尝试</button>}
    <p>查无、超时、权限失败或重载仍保留原编号，不视为操作失败。</p></section>;
}
export function OutageRelationsPairView({ pair }: { pair: OutageRelationsPairRead }) {
  return <section aria-label="已完整核对的双方声明" className="grid min-w-0 gap-3 md:grid-cols-2">{pair.declarations.map((r, i) => <article key={r.id} className="min-w-0 space-y-2 rounded-lg border p-3 text-sm">
    <h4 className="font-semibold">{i === 0 ? "本声明" : "另一声明"} · {r.recordedBy === "self" ? "本人声明" : "负责人代录（非本人确认）"}</h4>
    <p className="break-all">声明 {r.id}<br/>故障 {r.incidentId}<br/>原声明操作 {r.operationId}<br/>考勤人员 {r.workerId} · 企业员工 {r.employeeId}<br/>UTC [{r.interval.startAt}, {r.interval.endAt})<br/>保存时区 {r.interval.timeZone} · 偏移 {r.interval.startOffsetMinutes} / {r.interval.endOffsetMinutes} 分钟</p>
    <p className="whitespace-pre-wrap break-words">{r.statement}</p><p className="break-all">原打卡编号 {r.originalOperationId ?? "未提供；不代表打卡失败"}<br/>原渠道 {r.originalChannel ?? "未提供"}<br/>纸面参考 {r.paperReference ?? "未提供"}<br/>保存 UTC {r.recordedAt}<br/>读取 UTC {pair.readAt[i]}</p>
  </article>)}</section>;
}
export function OutageRelationsResultView({ result: r, disabled, onPair, onHistory }: { result: OutageRelationsResult; disabled: boolean; onPair: (id: string) => void; onHistory: (id: string) => void }) {
  const entries = r.receipt ? [r.receipt.entry] : r.mode === "list" ? r.items : r.mode === "history" ? r.history : r.current ? [r.current] : [];
  return <section aria-label="已保存声明关系资料" className="space-y-2 text-sm"><p>读取 UTC {r.readAt}。{r.mode === "list" ? "每声明最多 25 对曾关联声明（含已撤销），本列表不是自动合并结果。" : r.mode === "history" ? "每页最多 25 个不可变历史版本。" : r.receipt ? "以下是原号不可变保存回执，不证明当前关系仍有效。" : `当前关系版本 ${r.revision}。`}</p>
    {r.preview && <p>{r.preview.eligible ? "当前预览允许明确登记关系。" : `当前不能登记：${r.preview.blockers.map(b => blockers[b]).join("；")}。已保存关系仍可按权限明确撤销。`}</p>}
    {entries.length === 0 && <p>本次读取没有已保存关系条目。</p>}
    {entries.map(e => { const other = e.pair.find(id => id !== r.declarationId)!; return <article key={e.operationId} className="space-y-2 rounded-lg border p-3"><p className="break-all">{kinds[e.kind]} · {e.action === "apply" ? "登记" : "撤销"} · 版本 {e.revision}<br/>{e.pair.join(" ↔ ")}<br/>操作 {e.operationId}<br/>实际记录者 {e.actorId} · UTC {e.recordedAt}</p><p className="whitespace-pre-wrap break-words">{e.reason}</p>
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={disabled} onClick={() => onPair(other)}>读取双方声明与当前关系</button><button type="button" className={button} disabled={disabled} onClick={() => onHistory(other)}>读取这对关系历史</button></div></article>; })}
  </section>;
}
