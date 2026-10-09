"use client";
import { lazy, Suspense, useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AttendanceOutageClient, outageClientPendingKey, type OutageClientStorage } from "@/lib/merchantAttendanceOutageClient";
import { OUTAGE_HTTP_BODY_LIMIT, parseOutageHttpBody } from "@/lib/merchantAttendanceOutageHttp";
import { parseCaptureBrowserJson } from "@/lib/merchantAttendanceRuleCapturesBrowser";
import { parseOutageInterval, type OutageInterval } from "@/lib/merchantAttendanceOutageTime";
import { exact, uuid } from "@/lib/merchantAttendancePlanExceptionValidation";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import type { OutageChannel, OutageCommand, OutageDeclaration, OutageIncident, OutageQuery, OutageReceipt, OutageRecord, OutageType } from "@/lib/merchantAttendanceOutageContract";
import type { OutageSubjectResult } from "@/lib/merchantAttendanceOutageSubject";

const Resolution = lazy(() => import("./MerchantAttendanceOutageResolutionPanel"));
const Relations = lazy(() => import("./MerchantAttendanceOutageRelationsPanel"));
const PrintTools = lazy(() => import("./MerchantAttendanceOutagePrint"));
export type OutagePanelProps = { siteId: string; actorId: string; access: "owner" | "self"; workerId?: string | null;
  apiFetch: AttendanceApiFetch; enabled: boolean; printEnabled?: boolean; relationsEnabled?: boolean; onClose: () => void; registerLeaveGuard?: (guard: (() => boolean) | null) => void };
export type OutageDateDraft = { start: string; end: string; timeZone: string; startOffset: string; endOffset: string };
export type OutageIncidentDraft = { dates: OutageDateDraft; type: OutageType; channel: OutageChannel; locationId: string; reason: string; ack: boolean };
export type OutageDeclarationDraft = { dates: OutageDateDraft; statement: string; originalOperationId: string; originalChannel: OutageChannel | ""; paperReference: string; ack: boolean };
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40";
const input = "mt-1 w-full min-w-0 rounded-xl border border-slate-300 bg-white p-2 text-sm disabled:bg-slate-50";
const types: Record<OutageType, string> = { network: "网络故障", device: "设备故障", service: "服务故障", other: "其他故障" };
const channels: Record<OutageChannel, string> = { web: "网页", location: "定位打卡", onsite: "现场扫码", pin: "现场 PIN", other: "其他／尚未确定" };
const emptyDates = (): OutageDateDraft => ({ start: "", end: "", timeZone: "", startOffset: "", endOffset: "" });
export const outagePanelEmptyIncident = (): OutageIncidentDraft => ({ dates: emptyDates(), type: "network", channel: "web", locationId: "", reason: "", ack: false });
export const outagePanelEmptyDeclaration = (): OutageDeclarationDraft => ({ dates: emptyDates(), statement: "", originalOperationId: "", originalChannel: "", paperReference: "", ack: false });
export const outagePanelTextValid = (value: string, max = 1000) => value === value.trim() && [...value].length >= 1 && [...value].length <= max && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
export const outagePanelUuidValid = (value: string) => { try { uuid(value); return true; } catch { return false; } };
export function outagePanelInterval(dates: OutageDateDraft, now = Date.now()): OutageInterval {
  const instant = (value: string, offset: string) => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || !/^(?:0|-?[1-9]\d{0,3})$/.test(offset)) throw Error("invalid_declared_time");
    const local = value + ":00.000Z", time = Date.parse(local), minutes = Number(offset);
    if (!Number.isFinite(time) || new Date(time).toISOString() !== local || minutes < -840 || minutes > 840) throw Error("invalid_declared_time");
    return new Date(time - minutes * 60000).toISOString().replace(/\.000Z$/, ".000000Z");
  };
  const value = parseOutageInterval({ startAt: instant(dates.start, dates.startOffset), endAt: instant(dates.end, dates.endOffset),
    timeZone: dates.timeZone, startOffsetMinutes: Number(dates.startOffset), endOffsetMinutes: Number(dates.endOffset) });
  if (!Number.isFinite(now) || Date.parse(value.endAt) > now) throw Error("future_declared_time");
  return value;
}
export function outagePanelDatesFromInterval(value: OutageInterval): OutageDateDraft | null {
  // This convenience uses saved offsets only, never a device timezone or rounded history.
  if (![value.startAt, value.endAt].every(at => /:00\.000000Z$/.test(at))) return null;
  return { start: new Date(Date.parse(value.startAt) + value.startOffsetMinutes * 60000).toISOString().slice(0, 16),
    end: new Date(Date.parse(value.endAt) + value.endOffsetMinutes * 60000).toISOString().slice(0, 16), timeZone: value.timeZone,
    startOffset: String(value.startOffsetMinutes), endOffset: String(value.endOffsetMinutes) };
}
function maybeInterval(dates: OutageDateDraft) { try { return outagePanelInterval(dates); } catch { return null; } }
export function outagePanelIncidentReady(draft: OutageIncidentDraft, disabled = false) {
  return !disabled && draft.ack && Object.hasOwn(types, draft.type) && Object.hasOwn(channels, draft.channel)
    && (!draft.locationId || outagePanelUuidValid(draft.locationId)) && outagePanelTextValid(draft.reason) && maybeInterval(draft.dates) !== null;
}
export function outagePanelDeclarationReady(draft: OutageDeclarationDraft, prepared: OutageSubjectResult, disabled = false) {
  const interval = maybeInterval(draft.dates);
  return !disabled && prepared.canWrite && draft.ack && outagePanelTextValid(draft.statement) && (!draft.paperReference || outagePanelTextValid(draft.paperReference, 120))
    && (draft.originalOperationId ? outagePanelUuidValid(draft.originalOperationId) && Object.hasOwn(channels, draft.originalChannel) : draft.originalChannel === "")
    && interval !== null && interval.startAt < prepared.incident.interval.endAt && interval.endAt > prepared.incident.interval.startAt;
}
export function confirmOutagePanelAction(confirm: () => boolean, current: () => boolean, submit: () => void) {
  if (!current() || !confirm() || !current()) return false; submit(); return true;
}
export function outagePanelHasRisk(dirty: boolean, pending: boolean, child: (() => boolean) | null) {
  try { return dirty || pending || !!child?.(); } catch { return true; }
}
export type OutagePanelKnownRecovery = { kind: "links" | "reviews" | "relations"; declarationId: string; operationId: string };
export function outagePanelPrintPending(storage: Pick<OutageClientStorage, "getItem">, siteId: string, access: "owner" | "self", actorId: string) {
  // Printing must also notice an exact pending key created after the panel's
  // initial scan. Even malformed/unknown bytes block; never erase them here.
  try { return (["outages", "links", "reviews", "relations"] as const).some(kind => storage.getItem(outageClientPendingKey(kind, siteId, access, actorId)) !== null); }
  catch { return true; }
}
export function outagePanelKnownRecoveries(storage: Pick<OutageClientStorage, "getItem">, siteId: string, access: "owner" | "self", actorId: string) {
  const entries: OutagePanelKnownRecovery[] = []; let blocked = false;
  for (const kind of ["links", "reviews", "relations"] as const) try {
    const raw = storage.getItem(outageClientPendingKey(kind, siteId, access, actorId)); if (raw === null) continue;
    if (new TextEncoder().encode(raw).byteLength > OUTAGE_HTTP_BODY_LIMIT + 1024) throw Error("oversized_pending");
    const p = exact(parseCaptureBrowserJson(raw), ["version", "kind", "actorId", "query", "command"]);
    if (p.version !== 1 || p.kind !== kind || p.actorId !== actorId) throw Error("invalid_pending");
    const body = parseOutageHttpBody(kind, { query: p.query, command: p.command }, actorId);
    if (body.query.siteId !== siteId || body.query.access !== access) throw Error("foreign_pending");
    entries.push({ kind, declarationId: body.query.declarationId, operationId: body.command.operationId });
  } catch { blocked = true; }
  return { entries, blocked };
}

export default function MerchantAttendanceOutagePanel(props: OutagePanelProps) {
  const scopeKey = `${props.siteId}:${props.access}:${props.actorId}:${props.workerId ?? ""}`;
  // Keep the old controller from acknowledging or erasing an intent after its
  // authenticated scope changes, even before React's cleanup has run.
  /* eslint-disable react-hooks/refs -- synchronous authorization gate, never rendered as UI */
  const live = useRef({ scopeKey, apiFetch: props.apiFetch, enabled: props.enabled }); live.current = { scopeKey, apiFetch: props.apiFetch, enabled: props.enabled };
  const isCurrent = useCallback(() => live.current.scopeKey === scopeKey && live.current.apiFetch === props.apiFetch && live.current.enabled === props.enabled,
    [scopeKey, props.apiFetch, props.enabled]);
  /* eslint-enable react-hooks/refs */
  return <Prepared key={scopeKey} {...props} isCurrent={isCurrent}/>;
}
function Prepared(props: OutagePanelProps & { isCurrent: () => boolean }) {
  const { siteId, actorId, access, apiFetch, enabled, isCurrent } = props;
  const client = useMemo(() => { try {
    return new AttendanceOutageClient({ kind: "outages", siteId, actorId, access, enabled,
      storage: () => { if (!isCurrent()) throw Error("identity_changed"); return sessionStorage; },
      apiFetch: async (path, init) => { if (!isCurrent()) throw Error("identity_changed"); const response = await apiFetch(path, init);
        if (!isCurrent()) { void response.body?.cancel().catch(() => {}); throw Error("identity_changed"); } return response; } });
  } catch { return null; } }, [siteId, actorId, access, apiFetch, enabled, isCurrent]);
  return client ? <Screen {...props} client={client}/> : <section aria-label="故障登记与逐人声明" className="p-4"><p role="alert">当前身份无法核验，未读取或提交。</p><button className={button} onClick={props.onClose}>关闭故障工作区</button></section>;
}
function Screen({ client, siteId, actorId, access, workerId, apiFetch, enabled, printEnabled, relationsEnabled, onClose, registerLeaveGuard, isCurrent }: OutagePanelProps & { client: AttendanceOutageClient<"outages">; isCurrent: () => boolean }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot), [shown, setShown] = useState(false);
  const [incidentId, setIncidentId] = useState(""), [declarationId, setDeclarationId] = useState("");
  const [recoveryDeclaration, setRecoveryDeclaration] = useState<string | null>(null), [knownRecoveries, setKnownRecoveries] = useState<{ entries: OutagePanelKnownRecovery[]; blocked: boolean }>({ entries: [], blocked: false });
  const [incidentDraft, setIncidentDraft] = useState(outagePanelEmptyIncident), [declarationDraft, setDeclarationDraft] = useState(outagePanelEmptyDeclaration);
  const dirty = useRef(false), generation = useRef(0), childRisk = useRef<(() => boolean) | null>(null), relationsRisk = useRef<(() => boolean) | null>(null);
  const registerChild = useCallback((guard: (() => boolean) | null) => { childRisk.current = guard; }, []);
  const registerRelations = useCallback((guard: (() => boolean) | null) => { relationsRisk.current = guard; }, []);
  const childrenRisk = useCallback(() => outagePanelHasRisk(false, false, childRisk.current) || outagePanelHasRisk(false, false, relationsRisk.current), []);
  const localRecoveries = useCallback(() => { if (!isCurrent()) return;
    try { setKnownRecoveries(outagePanelKnownRecoveries(sessionStorage, siteId, access, actorId)); } catch { setKnownRecoveries({ entries: [], blocked: true }); }
  }, [isCurrent, siteId, access, actorId]);
  const clearDrafts = useCallback(() => { dirty.current = false; setIncidentDraft(outagePanelEmptyIncident()); setDeclarationDraft(outagePanelEmptyDeclaration()); }, []);
  const risk = useCallback(() => outagePanelHasRisk(dirty.current, client.hasLeaveRisk(), childrenRisk), [client, childrenRisk]);
  const leave = useCallback(() => { const epoch = generation.current;
    return (!risk() || window.confirm("离开会清除未提交的登记、声明或核对输入。已发送操作不会撤销，待核编号仍需恢复；继续吗？")) && generation.current === epoch && isCurrent();
  }, [isCurrent, risk]);
  useLayoutEffect(() => { registerLeaveGuard?.(leave); return () => registerLeaveGuard?.(null); }, [leave, registerLeaveGuard]);
  useLayoutEffect(() => {
    const hide = () => { generation.current++; setShown(false); clearDrafts(); setIncidentId(""); setDeclarationId(""); setRecoveryDeclaration(null); setKnownRecoveries({ entries: [], blocked: false }); client.pause(); };
    const show = () => { if (!isCurrent() || document.hidden) return; generation.current++; clearDrafts(); localRecoveries(); void client.initialize(); setShown(true); };
    const visibility = () => { if (document.hidden) hide(); else show(); };
    const unload = (event: BeforeUnloadEvent) => { if (risk()) { event.preventDefault(); event.returnValue = ""; } };
    visibility(); document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hide); window.addEventListener("pageshow", show); window.addEventListener("beforeunload", unload);
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- revoke the live lifetime, not a captured generation
      generation.current++; client.pause(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); window.removeEventListener("beforeunload", unload);
    };
  }, [client, clearDrafts, isCurrent, risk, localRecoveries]);
  const result = shown ? state.result : null, pending = shown ? state.pending : null, prepared = shown ? state.prepared : null;
  const busy = state.phase === "loading" || state.phase === "saving", readable = shown && !busy && !pending;
  const writable = readable && enabled && state.phase === "ready" && state.canWrite;
  const mark = () => { generation.current++; dirty.current = true; };
  const read = (run: () => void) => { const epoch = generation.current, snapshot = client.getSnapshot();
    if (!shown || !isCurrent() || document.hidden || busy || pending) return;
    if (outagePanelHasRisk(dirty.current, false, childrenRisk) && !window.confirm("读取其他资料会清除未提交输入；已发送的原编号不会撤销，继续吗？")) return;
    if (generation.current !== epoch || client.getSnapshot() !== snapshot || document.hidden || !isCurrent()) return;
    generation.current++; clearDrafts(); setRecoveryDeclaration(null); run(); };
  const confirm = (message: string, run: () => void, canProceed = writable) => { const epoch = generation.current, snapshot = client.getSnapshot();
    return confirmOutagePanelAction(() => window.confirm(message), () => shown && isCurrent() && !document.hidden && canProceed
      && generation.current === epoch && client.getSnapshot() === snapshot, () => { generation.current++; clearDrafts(); run(); }); };
  const load = (query: OutageQuery) => read(() => { void client.load(query); });
  const knownIncident = outagePanelUuidValid(incidentId), knownDeclaration = outagePanelUuidValid(declarationId);
  const prepare = (id: string) => read(() => { setIncidentId(id); void client.prepare({ siteId, access, workerId: access === "owner" ? workerId ?? null : null, incidentId: id }); });
  const selectIncident = (id: string) => read(() => { setIncidentId(id); void client.load({ siteId, access, mode: "incident", incidentId: id }); });
  const declarations = (id: string) => read(() => { setIncidentId(id); void client.load({ siteId, access, mode: "declarations", incidentId: id, afterId: null }); });
  const openDeclaration = (id: string) => read(() => { setDeclarationId(id); void client.load({ siteId, access, mode: "declaration", declarationId: id }); });
  const enterRecovery = (id: string) => { const epoch = generation.current, snapshot = client.getSnapshot();
    if (!shown || busy || !isCurrent() || document.hidden || !leave()) return;
    if (generation.current !== epoch || client.getSnapshot() !== snapshot || document.hidden || !isCurrent()) return;
    generation.current++; clearDrafts(); client.pause(); setRecoveryDeclaration(id);
  };
  const resolutionDeclarationId = recoveryDeclaration ?? (result?.detail?.kind === "declaration" ? result.detail.id : null);
  const navigation = (kind: "incident" | "declaration", value: string) => { generation.current++; if (kind === "incident") setIncidentId(value); else setDeclarationId(value); };
  const createIncident = () => {
    if (!result || result.mode !== "incidents" || !result.canWrite || !outagePanelIncidentReady(incidentDraft, !writable)) return;
    const savedDraft = incidentDraft;
    confirm("明确登记这次故障？登记仅保留影响范围，不补造打卡，不增加或扣减工时。", () => {
      const id = crypto.randomUUID(), command: Omit<Extract<OutageCommand, { action: "create_incident" }>, "operationId"> = { action: "create_incident", incidentId: id, type: savedDraft.type, channel: savedDraft.channel,
        locationId: savedDraft.locationId || null, interval: outagePanelInterval(savedDraft.dates), reason: savedDraft.reason };
      void client.submit({ siteId, access: "owner", mode: "incident", incidentId: id }, command);
    });
  };
  const declare = () => {
    if (!prepared || prepared.incident.id !== incidentId || !outagePanelDeclarationReady(declarationDraft, prepared, !writable)) return;
    const s = prepared.subject, savedDraft = declarationDraft;
    confirm(access === "owner" ? "明确以负责人身份代录这名员工的声明？这不是员工本人确认，不证明原打卡失败，也不增加工时。" : "明确保存本人的故障声明？这不是补打卡，也不等于已核对结案。", () => {
      const id = crypto.randomUUID(), command: Omit<Extract<OutageCommand, { action: "declare" }>, "operationId"> = { action: "declare", declarationId: id, incidentId: prepared.incident.id,
        workerId: s.workerId, employeeId: s.employeeId, employeeAuthUserId: s.employeeAuthUserId, expectedWorkerVersion: s.workerVersion, expectedEmployeeVersion: s.employeeVersion, expectedGeneration: s.generation,
        interval: outagePanelInterval(savedDraft.dates), statement: savedDraft.statement, originalOperationId: savedDraft.originalOperationId || null,
        originalChannel: savedDraft.originalOperationId ? savedDraft.originalChannel as OutageChannel : null, paperReference: savedDraft.paperReference || null };
      void client.submit({ siteId, access, mode: "declaration", declarationId: id }, command);
    });
  };
  return <section aria-label="故障登记与逐人声明" data-outage-panel className="min-w-0 space-y-4 p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><h2 className="text-xl font-bold">{access === "owner" ? "故障登记与逐人声明" : "本人故障声明与恢复核对"}</h2><button type="button" className={button} onClick={() => { if (leave()) { client.pause(); onClose(); } }}>关闭故障工作区</button></header>
    <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6">这是故障留证与恢复核对，不是备用打卡机。不补造原始打卡、不回填或重复计入工时；实际记录错误仍须按已有补正／整段漏卡流程处理。</p>
    <p className="text-sm">原打卡结果未知时保留原编号；查无回执不等于失败。登记、关联、双方核对及负责人结案是不同步骤，负责人代录不能替员工确认。</p>
    {!enabled && <p role="note" className="text-sm text-amber-900">新写入入口已关闭，仍可明确读取已授权资料或核对待确认原编号；读取失败时编号继续保留，不自动重发。</p>}
    {shown && (printEnabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_OUTAGE_PRINT_ENABLED === "1") && <Suspense fallback={<p role="status">正在加载备用纸表工具…</p>}>
      <PrintTools siteId={siteId} actorId={actorId} access={access} declarationId={resolutionDeclarationId} apiFetch={apiFetch} enabled
        disabled={!readable || knownRecoveries.blocked || knownRecoveries.entries.length > 0} contextKey={`${result?.readAt ?? ""}:${state.phase}:${recoveryDeclaration ?? ""}:${incidentId}:${declarationId}`}
        available={() => isCurrent() && !document.hidden && shown && !busy && !pending && !risk() && !outagePanelPrintPending(sessionStorage, siteId, access, actorId)}/>
    </Suspense>}
    <p role="status" aria-live="polite" className="rounded-xl bg-blue-50 p-3 text-sm">{state.message}</p>
    {shown && <OutageRecoveryEntries entries={knownRecoveries.entries} blocked={knownRecoveries.blocked} disabled={busy} onOpen={enterRecovery}/>} 
    {pending && <OutagePendingView operationId={pending.command.operationId} canEnd={state.canEndRejectedAttempt} disabled={!shown || busy}
      onRecover={() => { if (shown && isCurrent() && !document.hidden && !busy) { generation.current++; clearDrafts(); void client.recover(); } }}
      onEnd={() => confirm("只结束本次被服务器明确拒绝的本地尝试？不撤销任何已保存事实；之后须重新读取。", () => { void client.endRejectedAttempt(); }, shown && !busy && state.canEndRejectedAttempt)}/>}
    <div className="space-y-3 rounded-xl border p-3">
      {access === "owner" && <button type="button" className={button} disabled={!readable} onClick={() => load({ siteId, access, mode: "incidents", afterId: null })}>读取故障登记列表</button>}
      <label className="block text-sm">已知故障编号<input aria-label="已知故障编号" className={input} value={incidentId} disabled={!readable} maxLength={36} onChange={e => navigation("incident", e.target.value)}/></label>
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!readable || !knownIncident} onClick={() => selectIncident(incidentId)}>读取已知故障</button>
        <button type="button" className={button} disabled={!readable || !knownIncident} onClick={() => declarations(incidentId)}>{access === "owner" ? "读取该故障声明列表" : "读取我的已保存声明"}</button>
        <button type="button" className={button} disabled={!readable || !knownIncident || access === "owner" && !workerId} onClick={() => prepare(incidentId)}>{access === "owner" ? "核验当前人员与故障" : "核验故障与本人声明资格"}</button></div>
      {access === "owner" && !workerId && <p className="text-xs">逐人代录请从考勤人员行进入；本全局入口不猜测员工或暂停代次。</p>}
      {access === "self" && <p className="text-xs">首次声明请使用“核验故障与本人声明资格”；尚无本人声明时，旧故障详情读取可能被拒绝，不会因此扩大访问范围。</p>}
      <label className="block text-sm">已知声明编号<input aria-label="已知声明编号" className={input} value={declarationId} disabled={!readable} maxLength={36} onChange={e => navigation("declaration", e.target.value)}/></label>
      <button type="button" className={button} disabled={!readable || !knownDeclaration} onClick={() => openDeclaration(declarationId)}>读取声明与恢复核对</button>
    </div>
    {result?.receipt && <OutageReceiptView receipt={result.receipt} disabled={!readable} onRead={r => r.action === "create_incident" ? selectIncident(r.recordId) : openDeclaration(r.recordId)}/>}
    {result && ["incidents", "declarations"].includes(result.mode) && <OutageRecordList items={result.items} mode={result.mode} disabled={!readable} onIncident={selectIncident} onDeclaration={openDeclaration}/>} 
    {result?.nextId && state.query && (state.query.mode === "incidents" || state.query.mode === "declarations") && <button type="button" className={button} disabled={!readable} onClick={() => {
      const query = client.getSnapshot().query; if (query?.mode === "incidents" || query?.mode === "declarations") load({ ...query, afterId: result.nextId });
    }}>下一页（每页最多 25 条）</button>}
    {result?.detail && <OutageRecordDetail record={result.detail}/>} 
    {result?.detail?.kind === "incident" && <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!readable} onClick={() => declarations(result.detail!.kind === "incident" ? result.detail!.id : "")}>读取此故障声明</button>
      <button type="button" className={button} disabled={!readable || access === "owner" && !workerId} onClick={() => prepare(result.detail!.id)}>核验人员后填写声明</button></div>}
    {access === "owner" && result?.mode === "incidents" && !result.receipt && <OutageIncidentForm draft={incidentDraft} disabled={!writable || !result.canWrite}
      onDraft={value => { mark(); setIncidentDraft(value); }} onSubmit={createIncident}/>}
    {prepared && <OutageDeclarationForm prepared={prepared} draft={declarationDraft} disabled={!writable || prepared.incident.id !== incidentId}
      onDraft={value => { mark(); setDeclarationDraft(value); }} onSubmit={declare}/>}
    {shown && resolutionDeclarationId && <Suspense fallback={<p role="status">正在加载该声明的恢复核对…</p>}>
      <Resolution key={`${siteId}:${access}:${actorId}:${resolutionDeclarationId}`} siteId={siteId} access={access} actorId={actorId} declarationId={resolutionDeclarationId} apiFetch={apiFetch} enabled={enabled} registerLeaveGuard={registerChild}/>
    </Suspense>}
    {shown && resolutionDeclarationId && <Suspense fallback={<p role="status">正在加载声明关系…</p>}>
      <Relations key={`${siteId}:${access}:${actorId}:${resolutionDeclarationId}`} siteId={siteId} access={access} actorId={actorId} declarationId={resolutionDeclarationId} apiFetch={apiFetch}
        enabled={relationsEnabled ?? process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_OUTAGE_RELATIONS_ENABLED === "1"} registerLeaveGuard={registerRelations}/>
    </Suspense>}
  </section>;
}

export function OutageIntervalFields({ value, disabled, prefix, onChange }: { value: OutageDateDraft; disabled: boolean; prefix: string; onChange: (value: OutageDateDraft) => void }) {
  const preview = maybeInterval(value);
  return <fieldset disabled={disabled} className="space-y-2"><legend className="font-semibold">{prefix}影响时段（过去的半开区间，最长 31 天）</legend>
    <p className="text-xs">填写该 IANA 时区的当地时间，并分别明确起止 UTC 偏移分钟。例：UTC 为 0，UTC+02:00 为 120；夏令时重复时间必须明确选择偏移，系统不会猜测。</p>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">{(["start", "end"] as const).map(key => <label key={key} className="block text-sm">{key === "start" ? "当地开始" : "当地结束"}<input aria-label={`${prefix}${key === "start" ? "当地开始" : "当地结束"}`} className={input} type="datetime-local" step={60} value={value[key]} onChange={e => onChange({ ...value, [key]: e.target.value })}/></label>)}</div>
    <label className="block text-sm">IANA 时区<input aria-label={`${prefix}IANA时区`} className={input} placeholder="例如 Europe/Madrid" value={value.timeZone} maxLength={100} onChange={e => onChange({ ...value, timeZone: e.target.value })}/></label>
    <div className="grid gap-3 sm:grid-cols-2">{(["startOffset", "endOffset"] as const).map(key => <label key={key} className="block text-sm">{key === "startOffset" ? "开始" : "结束"} UTC 偏移分钟<input aria-label={`${prefix}${key === "startOffset" ? "开始" : "结束"}UTC偏移分钟`} className={input} type="number" min={-840} max={840} step={1} value={value[key]} onChange={e => onChange({ ...value, [key]: e.target.value })}/></label>)}</div>
    {preview ? <p data-outage-interval-preview className="break-all text-xs">明确对应 UTC [{preview.startAt}, {preview.endAt})；这只是声明区间，不是工时。</p>
      : <p className="text-xs text-amber-900">请填写有效过去时段及匹配偏移；不存在的当地时间、错误偏移、反向或未来时段不能提交。</p>}
  </fieldset>;
}
export function OutageIncidentForm({ draft, disabled, onDraft, onSubmit }: { draft: OutageIncidentDraft; disabled: boolean; onDraft: (value: OutageIncidentDraft) => void; onSubmit: () => void }) {
  const change = (patch: Partial<OutageIncidentDraft>) => onDraft({ ...draft, ...patch, ack: false });
  return <form aria-label="负责人故障登记表单" className="space-y-3 rounded-xl border p-3" onSubmit={e => { e.preventDefault(); if (outagePanelIncidentReady(draft, disabled)) onSubmit(); }}>
    <h3 className="font-bold">登记一项故障</h3><p className="text-xs">登记后会生成独立故障编号；仍须逐人声明和核对，不批量替所有员工确认。</p>
    <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm">故障类型<select aria-label="故障类型" className={input} disabled={disabled} value={draft.type} onChange={e => change({ type: e.target.value as OutageType })}>{Object.entries(types).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
      <label className="block text-sm">影响渠道<select aria-label="故障影响渠道" className={input} disabled={disabled} value={draft.channel} onChange={e => change({ channel: e.target.value as OutageChannel })}>{Object.entries(channels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label></div>
    <label className="block text-sm">已知地点编号（可留空）<input aria-label="故障地点编号" className={input} disabled={disabled} value={draft.locationId} maxLength={36} onChange={e => change({ locationId: e.target.value })}/><span className="text-xs">不填表示未限定地点，不会自动采用员工默认地点；填写时服务器另行核验。</span></label>
    <OutageIntervalFields value={draft.dates} disabled={disabled} prefix="故障" onChange={dates => change({ dates })}/>
    <label className="block text-sm">故障情况与登记理由<textarea aria-label="故障登记理由" rows={3} className={input} disabled={disabled} maxLength={2000} value={draft.reason} onChange={e => change({ reason: e.target.value })}/><span className="text-xs">1–1000 字；不填写密码、PIN、令牌或不必要的个人信息。</span></label>
    <label className="flex items-start gap-2 text-sm"><input aria-label="确认登记故障" type="checkbox" checked={draft.ack} disabled={disabled} onChange={e => onDraft({ ...draft, ack: e.target.checked })}/><span>已核对故障类型、渠道和准确时段，明确留证；不宣称原打卡失败。</span></label>
    <button className={button} type="submit" disabled={!outagePanelIncidentReady(draft, disabled)}>明确登记故障</button>
  </form>;
}
export function OutageDeclarationForm({ prepared, draft, disabled, onDraft, onSubmit }: { prepared: OutageSubjectResult; draft: OutageDeclarationDraft; disabled: boolean; onDraft: (value: OutageDeclarationDraft) => void; onSubmit: () => void }) {
  const s = prepared.subject, change = (patch: Partial<OutageDeclarationDraft>) => onDraft({ ...draft, ...patch, ack: false }), dates = outagePanelDatesFromInterval(prepared.incident.interval);
  return <form aria-label="逐人故障声明表单" data-outage-prepared className="space-y-3 rounded-xl border p-3" onSubmit={e => { e.preventDefault(); if (outagePanelDeclarationReady(draft, prepared, disabled)) onSubmit(); }}>
    <h3 className="font-bold">{prepared.access === "self" ? "本人声明" : "负责人逐人代录"} · {s.displayName}</h3><p className="break-all text-xs">已核验故障 {prepared.incident.id} · {types[prepared.incident.type]} · {channels[prepared.incident.channel]}<br/>故障 UTC {prepared.incident.interval.startAt} → {prepared.incident.interval.endAt}<br/>当前人员版 {s.workerVersion} · 员工版 {s.employeeVersion} · 暂停代次 {s.generation}</p>
    <details className="text-xs"><summary>核验本次人员身份</summary><p className="break-all">考勤人员 {s.workerId}<br/>企业员工 {s.employeeId}<br/>Auth {s.employeeAuthUserId}</p></details>
    {prepared.access === "owner" && <p className="text-sm">负责人以自己的身份代录，不会显示为员工本人提交，也不能替本人确认。{!s.active || s.paused ? "该人员当前未启用或处于暂停；留证不恢复账号、考勤或旧委托。" : ""}</p>}
    {dates && <button type="button" className={button} disabled={disabled} onClick={() => change({ dates })}>使用已核验故障时段（仍需明确确认）</button>}
    <OutageIntervalFields value={draft.dates} disabled={disabled} prefix="声明" onChange={value => change({ dates: value })}/>
    <label className="block text-sm">本人情况／负责人代录说明<textarea aria-label="故障声明说明" className={input} rows={3} disabled={disabled} maxLength={2000} value={draft.statement} onChange={e => change({ statement: e.target.value })}/><span className="text-xs">1–1000 字；声明时段须与已核验故障相交，不按此时长增加工时。</span></label>
    <label className="block text-sm">原打卡操作编号（有则准确填写）<input aria-label="声明原打卡操作编号" className={input} disabled={disabled} value={draft.originalOperationId} maxLength={36} onChange={e => change({ originalOperationId: e.target.value })}/></label>
    <label className="block text-sm">原打卡渠道<select aria-label="声明原打卡渠道" className={input} disabled={disabled} value={draft.originalChannel} onChange={e => change({ originalChannel: e.target.value as OutageChannel | "" })}><option value="">未提供原编号／请选择</option>{Object.entries(channels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <p className="text-xs">原编号与渠道须同时提供或同时留空。登记原编号不会查询密码或重发原打卡；未知结果仍待核验。</p>
    <label className="block text-sm">纸面登记参考（可留空）<input aria-label="故障纸面参考" className={input} disabled={disabled} value={draft.paperReference} maxLength={240} onChange={e => change({ paperReference: e.target.value })}/><span className="text-xs">最多 120 字，仅参考编号；不是签名、附件或独立出勤证明。</span></label>
    <label className="flex items-start gap-2 text-sm"><input aria-label="确认逐人故障声明" type="checkbox" disabled={disabled} checked={draft.ack} onChange={e => onDraft({ ...draft, ack: e.target.checked })}/><span>已核对当前人员、故障与时段，明确保存本次声明；后续依据关联和双方确认仍须分别完成。</span></label>
    <button type="submit" className={button} disabled={!outagePanelDeclarationReady(draft, prepared, disabled)}>明确保存故障声明</button>
  </form>;
}
export function OutagePendingView({ operationId, canEnd, disabled, onRecover, onEnd }: { operationId: string; canEnd: boolean; disabled: boolean; onRecover: () => void; onEnd: () => void }) {
  return <section data-outage-pending className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm"><p>结果尚待核对，不自动重发，不从本地命令回显人员、理由或声明正文。</p><p className="break-all">原操作编号：{operationId}</p>
    <button type="button" className={button} disabled={disabled} onClick={onRecover}>核对故障原操作编号</button>
    {canEnd && <button type="button" className={button} disabled={disabled} onClick={onEnd}>明确结束被拒绝尝试</button>}
    <p className="text-xs">查无、超时或权限失败仍保留编号；只有本次明确拒绝才可手动结束。不会锁住原正常打卡或安全下班入口。</p></section>;
}
export function OutageRecoveryEntries({ entries, blocked, disabled, onOpen }: { entries: OutagePanelKnownRecovery[]; blocked: boolean; disabled: boolean; onOpen: (id: string) => void }) {
  return <>{blocked && <p role="alert" className="text-sm text-amber-900">本地恢复记录不可读取或校验失败，未覆盖或删除；请保留原编号交负责人核验。</p>}
    {entries.length > 0 && <section aria-label="本地待核来源与结果编号" className="space-y-2 rounded-xl border border-amber-300 p-3 text-sm"><p>仅检查本身份三个独立恢复位置，不读取或回显本地命令正文；进入后须明确 GET 核对。</p>
      {entries.map(entry => <div key={entry.kind} className="space-y-1"><p className="break-all">声明 {entry.declarationId} · 原操作 {entry.operationId}</p><button type="button" className={button} disabled={disabled} onClick={() => onOpen(entry.declarationId)}>{entry.kind === "links" ? "核对待确认来源关联" : entry.kind === "reviews" ? "核对待确认恢复结果" : "核对待确认声明关系"}</button></div>)}
    </section>}</>;
}
export function OutageReceiptView({ receipt: r, disabled = false, onRead }: { receipt: OutageReceipt; disabled?: boolean; onRead: (receipt: OutageReceipt) => void }) {
  return <section data-outage-receipt className="space-y-2 rounded-xl bg-emerald-50 p-3 text-sm"><h3 className="font-semibold">{r.action === "create_incident" ? "故障登记原号已确认" : "声明保存原号已确认"}</h3><p className="break-all">操作 {r.operationId}<br/>故障 {r.incidentId}<br/>{r.action === "declare" ? `声明 ${r.recordId}` : ""}<br/>实际操作者 {r.actorId}<br/>UTC {r.recordedAt}</p>
    <p>这是不可变保存回执，不证明当前依据仍有效、原打卡失败或恢复已结案；下一步须明确重新读取。</p><button type="button" className={button} disabled={disabled} onClick={() => onRead(r)}>读取该已保存记录</button></section>;
}
export function OutageRecordList({ items, mode, disabled, onIncident, onDeclaration }: { items: OutageRecord[]; mode: string; disabled: boolean; onIncident: (id: string) => void; onDeclaration: (id: string) => void }) {
  return <section aria-label={mode === "incidents" ? "故障登记列表" : "已保存故障声明列表"} className="space-y-2"><h3 className="font-bold">{mode === "incidents" ? "故障登记" : "已保存声明"}</h3><p className="text-xs">每页最多 25 条；本页为空不代表没有历史故障或未知打卡。</p>
    {items.map(item => <article data-outage-record={item.id} key={item.id} className="space-y-2 rounded-xl border p-3 text-sm"><p className="break-all">{item.kind === "incident" ? `${types[item.type]} · ${channels[item.channel]}` : item.recordedBy === "self" ? "本人声明" : "负责人代录（非本人确认）"}<br/>{item.id}<br/>UTC {item.interval.startAt} → {item.interval.endAt}</p><button type="button" className={button} disabled={disabled} onClick={() => item.kind === "incident" ? onIncident(item.id) : onDeclaration(item.id)}>读取{item.kind === "incident" ? "故障详情" : "声明与核对"}</button></article>)}
  </section>;
}
export function OutageRecordDetail({ record: r }: { record: OutageIncident | OutageDeclaration }) {
  return <article data-outage-detail={r.kind} className="space-y-2 rounded-xl border p-3 text-sm"><h3 className="font-bold">{r.kind === "incident" ? `${types[r.type]} · ${channels[r.channel]}` : r.recordedBy === "self" ? "员工本人已保存声明" : "负责人已保存代录声明"}</h3><p className="break-all">编号 {r.id}<br/>原操作 {r.operationId}<br/>UTC [{r.interval.startAt}, {r.interval.endAt})<br/>保存时区 {r.interval.timeZone} · 起止偏移 {r.interval.startOffsetMinutes} / {r.interval.endOffsetMinutes} 分钟<br/>登记 UTC {r.recordedAt}</p>
    <p className="whitespace-pre-wrap break-words">{r.kind === "incident" ? r.reason : r.statement}</p>
    {r.kind === "declaration" && <><p>以上是保存时的声明，不是本人结果确认，不直接增加工时或解除封存。</p><p className="break-all">所属故障 {r.incidentId}<br/>原打卡编号 {r.originalOperationId ?? "未提供；不据此宣称没有原打卡"}<br/>原渠道 {r.originalChannel ? channels[r.originalChannel] : "未提供"}<br/>纸面参考 {r.paperReference ?? "未提供"}</p><details className="text-xs"><summary>保存时身份与代次（不是当前操作资格）</summary><p className="break-all">人员 {r.workerId} · 员工 {r.employeeId}<br/>Auth {r.employeeAuthUserId}<br/>人员版 {r.workerVersion} · 员工版 {r.employeeVersion} · 暂停代次 {r.generation}<br/>实际记录者 {r.actorId}</p></details></>}
  </article>;
}
