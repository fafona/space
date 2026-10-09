"use client";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { AttendanceApiFetch } from "@/lib/merchantAttendanceSelfClient";
import { AttendanceCycleSendClient, type CycleSendPending } from "@/lib/merchantAttendanceCycleSendClient";
import { parseCycleSendBody, type CycleSendBody } from "@/lib/merchantAttendanceCycleSend";
import type { CycleSendResult } from "@/lib/merchantAttendanceCycleSendResult";
import type { CycleIntentResult } from "@/lib/merchantAttendanceCycleIntentResult";
import { CYCLE_INTENT_PROTOCOL } from "@/lib/merchantAttendanceCycleIntent";
import { captureBrowserExact, captureBrowserUuid, parseCaptureBrowserJson } from "@/lib/merchantAttendanceRuleCapturesBrowser";
import { operationalRuleLedgerFreeze as freeze } from "@/lib/merchantAttendanceOperationalRuleLedger";
import { PERIOD_CLOSURE_V2_CLIENT_API } from "@/lib/merchantAttendancePeriodClosureV2Client";
import { parsePeriodClosureV2Query, parsePeriodClosureV2Response, periodClosureV2QueryString } from "@/lib/merchantAttendancePeriodClosureV2";
import { PERIOD_DELEGATED_CLOSURE_API, parsePeriodDelegatedClosureQuery, parsePeriodDelegatedClosureResponse, periodDelegatedClosureQueryString } from "@/lib/merchantAttendancePeriodDelegatedClosure";
import { periodDelegatedClosurePendingKey, type PeriodDelegatedClosureScope } from "@/lib/merchantAttendancePeriodDelegatedClosureClient";
import type { PeriodClosureArtifact, PeriodDelegatedArtifactDraft } from "@/lib/merchantAttendancePeriodClosure";

export type CycleSendPanelProps = { detail: CycleIntentResult; actorId: string; apiFetch: AttendanceApiFetch; enabled?: boolean;
  delegateScope?: PeriodDelegatedClosureScope; isCurrentAuth?: () => boolean; onClose: () => void;
  registerLeaveGuard?: (guard: (() => boolean) | null) => void };
const scopeKeys = ["siteId", "actorEmployeeId", "expectedAuthUserId", "grantId", "workerId", "targetEmployeeId", "targetAuthUserId", "authorizedFromDate", "authorizedThroughDate"] as const;
export type CycleSendPanelContext = Readonly<{ siteId: string; actorId: string; access: "owner" | "delegate"; workerId: string; grantId: string | null;
  employeeId: string; employeeAuthUserId: string; intentId: string; expectedIntentFingerprint: string;
  fromDate: string; throughDate: string; timeZone: string; fromAt: string; toAt: string;
  delegateScope: Readonly<PeriodDelegatedClosureScope> | null; acceptedByActor: boolean }>;
export type CycleSendPanelSource = Readonly<{ artifact: PeriodClosureArtifact | PeriodDelegatedArtifactDraft; blockers: readonly string[];
  moduleEnabled: boolean; canSend: boolean }>;
const button = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40";
function fail(): never { throw Error("cycle_send_source_unverified"); }
const currentAuth = (read?: () => boolean) => { try { return read?.() === true; } catch { return false; } };

// The parent supplies an actual parsed detail. These additional bindings keep
// current viewer identity separate from the original accepting actor/frame.
export function cycleSendPanelContext(detail: CycleIntentResult, actorId: string, rawScope?: PeriodDelegatedClosureScope): CycleSendPanelContext {
  captureBrowserUuid(actorId); if (detail.protocol !== CYCLE_INTENT_PROTOCOL || detail.actorId !== actorId || detail.data.kind !== "detail" || detail.receipt !== null) fail();
  const { intent: i, head: h } = detail.data;
  if (i.access !== "owner" && i.access !== "delegate") fail();
  const base = { siteId: detail.siteId, workerId: i.workerId, fromDate: i.fromDate, throughDate: i.throughDate,
    mode: "preview" as const, periodId: null, operationId: null, version: null, cursor: null };
  const q = i.access === "owner" ? parsePeriodClosureV2Query({ ...base, access: "owner" }) : parsePeriodDelegatedClosureQuery({ ...base, access: "delegate", grantId: i.grantId });
  if (i.access === "owner" && i.grantId !== null || i.access === "delegate" && i.grantId === null
    || i.source.workerIdentity.workerId !== i.workerId || i.source.workerIdentity.employeeId !== i.employeeId || i.source.workerIdentity.employeeAuthUserId !== i.employeeAuthUserId
    || !i.preparation.range || i.preparation.range.fromDate !== i.fromDate || i.preparation.range.throughDate !== i.throughDate || i.preparation.settingsRef.timeZone !== i.timeZone
    || i.acceptCommand.employeeId !== i.employeeId || i.acceptCommand.employeeAuthUserId !== i.employeeAuthUserId
    || i.acceptCommand.fromDate !== i.fromDate || i.acceptCommand.throughDate !== i.throughDate || h.intentId !== i.intentId) fail();
  let delegateScope: Readonly<PeriodDelegatedClosureScope> | null = null;
  if (i.access === "owner") { if (rawScope !== undefined) fail(); }
  else {
    const s = captureBrowserExact(rawScope, scopeKeys) as PeriodDelegatedClosureScope; periodDelegatedClosurePendingKey(s);
    if (s.siteId !== q.siteId || s.expectedAuthUserId !== actorId || s.grantId !== i.grantId || s.workerId !== i.workerId
      || s.targetEmployeeId !== i.employeeId || s.targetAuthUserId !== i.employeeAuthUserId
      || i.fromDate < s.authorizedFromDate || i.throughDate > s.authorizedThroughDate) fail();
    delegateScope = freeze({ ...s });
  }
  const acceptedByActor = i.actorId === actorId && h.actorId === actorId && h.action === "accept" && h.revision === 1
    && h.operationId === i.intentId && h.periodId === null && h.sendOperationId === null && i.acceptCommand.intentId === i.intentId && i.acceptCommand.operationId === i.intentId;
  return freeze({ siteId: q.siteId, actorId, access: i.access, workerId: q.workerId, grantId: i.grantId,
    employeeId: i.employeeId, employeeAuthUserId: i.employeeAuthUserId, intentId: i.intentId, expectedIntentFingerprint: i.intentFingerprint,
    fromDate: q.fromDate, throughDate: q.throughDate, timeZone: i.timeZone, fromAt: i.fromAt, toAt: i.toAt, delegateScope, acceptedByActor });
}
export function cycleSendPanelPreviewRequest(c: CycleSendPanelContext) {
  const base = { siteId: c.siteId, workerId: c.workerId, fromDate: c.fromDate, throughDate: c.throughDate, mode: "preview" as const,
    periodId: null, operationId: null, version: null, cursor: null };
  if (c.access === "owner") { const query = parsePeriodClosureV2Query({ ...base, access: "owner" });
    return { access: "owner" as const, query, url: `${PERIOD_CLOSURE_V2_CLIENT_API}?${periodClosureV2QueryString(query)}` }; }
  const query = parsePeriodDelegatedClosureQuery({ ...base, access: "delegate", grantId: c.grantId });
  return { access: "delegate" as const, query, url: `${PERIOD_DELEGATED_CLOSURE_API}?${periodDelegatedClosureQueryString(query)}` };
}
export function parseCycleSendPanelSource(raw: unknown, c: CycleSendPanelContext): CycleSendPanelSource {
  const request = cycleSendPanelPreviewRequest(c);
  const result = request.access === "owner" ? parsePeriodClosureV2Response(raw, request.query, { ownerId: c.actorId, authUserId: c.actorId })
    : parsePeriodDelegatedClosureResponse(raw, request.query, { authUserId: c.actorId, employeeId: c.delegateScope!.actorEmployeeId,
      targetEmployeeId: c.employeeId, targetAuthUserId: c.employeeAuthUserId });
  if (result.data.kind !== "preview" || result.data.preview.period !== null) fail();
  const p = result.data.preview, a = p.artifact, s = a.source;
  if (a.worker.workerId !== c.workerId || a.worker.employeeId !== c.employeeId || a.worker.employeeAuthUserId !== c.employeeAuthUserId
    || a.period.fromDate !== c.fromDate || a.period.throughDate !== c.throughDate || a.period.timeZone !== c.timeZone || a.period.startAt !== c.fromAt || a.period.endAt !== c.toAt
    || s.siteId !== c.siteId || s.workerId !== c.workerId || s.employeeId !== c.employeeId || s.employeeAuthUserId !== c.employeeAuthUserId
    || s.fromDate !== c.fromDate || s.throughDate !== c.throughDate || s.timeZone !== c.timeZone || s.fromAt !== c.fromAt || s.toAt !== c.toAt
    || a.report.access !== c.access) fail();
  const canSend = c.acceptedByActor && result.moduleEnabled && p.blockers.length === 0
    && (result.data.access !== "delegate" || result.data.usableActions.includes("send"));
  return freeze({ artifact: a, blockers: [...p.blockers], moduleEnabled: result.moduleEnabled, canSend });
}

// Explicit GET only. The one deadline covers fetch, strict UTF-8 stream, JSON
// and actual legacy owner/delegate response parsing; no retries or new route.
export async function readCycleSendPanelSource(c: CycleSendPanelContext, apiFetch: AttendanceApiFetch, signal: AbortSignal,
  isCurrent: () => boolean, timeoutMs = 12000): Promise<CycleSendPanelSource> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 12000 || !c.acceptedByActor) fail();
  const controller = new AbortController(), deadline = performance.now() + timeoutMs;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, reject!: (error: Error) => void;
  const interrupted = new Promise<never>((_, no) => { reject = no; });
  const stop = () => { controller.abort(); void reader?.cancel().catch(() => {}); reject(Error("source_cancelled_or_unknown")); };
  const guard = () => { if (signal.aborted || controller.signal.aborted || performance.now() >= deadline || !currentAuth(isCurrent)) fail(); };
  const timer = setTimeout(stop, timeoutMs); signal.addEventListener("abort", stop, { once: true });
  try {
    return await Promise.race([Promise.resolve().then(async () => {
      guard(); const request = cycleSendPanelPreviewRequest(c), response = await apiFetch(request.url, { method: "GET", headers: { Accept: "application/json" },
        signal: controller.signal, cache: "no-store", redirect: "error" });
      try { guard(); } catch (error) { void response.body?.cancel().catch(() => {}); throw error; }
      if (!response.ok || response.status !== 200 || response.redirected || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
        void response.body?.cancel().catch(() => {}); fail();
      }
      reader = response.body?.getReader(); if (!reader) fail(); let text = "", bytes = 0; const decoder = new TextDecoder("utf-8", { fatal: true });
      try { while (true) { const part = await reader.read(); guard(); if (part.done) break;
        bytes += part.value.byteLength; if (bytes > 4194304) fail(); text += decoder.decode(part.value, { stream: true }); } text += decoder.decode(); }
      finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
      guard(); const result = parseCycleSendPanelSource(parseCaptureBrowserJson(text), c); guard(); return result;
    }), interrupted]);
  } finally { clearTimeout(timer); signal.removeEventListener("abort", stop); controller.abort(); void reader?.cancel().catch(() => {}); }
}
export function cycleSendPanelCommand(c: CycleSendPanelContext, source: CycleSendPanelSource, reason: string, periodId: string, operationId: string): CycleSendBody {
  if (!c.acceptedByActor || !source.canSend || !source.moduleEnabled || source.blockers.length || periodId === operationId || periodId === c.intentId) fail();
  // Rebind the frozen preview immediately before the final explicit action.
  const a = source.artifact;
  if (a.worker.workerId !== c.workerId || a.worker.employeeId !== c.employeeId || a.worker.employeeAuthUserId !== c.employeeAuthUserId
    || a.period.fromDate !== c.fromDate || a.period.throughDate !== c.throughDate || a.period.timeZone !== c.timeZone || a.period.startAt !== c.fromAt || a.period.endAt !== c.toAt || a.report.access !== c.access) fail();
  return parseCycleSendBody({ frame: { siteId: c.siteId, access: c.access, workerId: c.workerId, grantId: c.grantId,
    fromDate: c.fromDate, throughDate: c.throughDate, periodId, intentId: c.intentId, expectedIntentFingerprint: c.expectedIntentFingerprint },
    command: { action: "send", operationId, periodId, expectedRevision: 0, expectedVersion: 0, expectedFingerprint: a.sourceFingerprint, reason } });
}
export function confirmCycleSend(confirm: () => boolean, current: () => boolean, submit: () => void) {
  if (!current() || !confirm() || !current()) return false; submit(); return true;
}
export function CycleSendSourceView({ source }: { source: CycleSendPanelSource }) {
  const { artifact: a } = source;
  return <article data-cycle-send-source className="min-w-0 space-y-2 rounded-xl border p-3 text-sm"><h3 className="font-bold">本次明确读取的工时来源</h3>
    <p className="break-words">{a.worker.workerName} · {a.worker.workerNo} · {a.period.fromDate} — {a.period.throughDate} · {a.period.timeZone}</p>
    <p>已核对保存的人员双身份、日期和 UTC 边界；共 {a.dayBoundaries.length} 个日期边界，{a.report.base.rows.length} 条记录、{a.report.missing.length} 条批准的补报。</p>
    {source.blockers.length > 0 ? <div className="space-y-1 rounded-lg bg-amber-50 p-2"><p>条件不足，不能送审：</p><ul className="list-inside list-disc">{source.blockers.map(b => <li key={b}>{b}</li>)}</ul></div>
      : <p>{source.canSend ? "来源未返回阻断项，仍须明确确认且服务端重新核验。" : "当前功能或委托操作权限未开放，不能送审。"}</p>}
    <p>这只是来源预览，不是已送审、员工确认、封存或工资结果。</p></article>;
}
export function CycleSendVerifiedView({ value }: { value: CycleSendResult }) {
  if (value.data.kind !== "linked" || value.receipt === null) return null;
  return <article data-cycle-send-verified className="min-w-0 space-y-2 rounded-xl bg-emerald-50 p-3 text-sm"><h3 className="font-bold">原号 GET 已核验：首次第 1 版已送审</h3>
    <p className="break-all">工时表：{value.receipt.periodId} · 原操作：{value.receipt.operationId}</p><p>仅证明原首次送审与采用意向的关联；不表示员工已确认或工时表已封存。请关闭并重新读取当前详情。</p></article>;
}

export default function MerchantAttendanceCycleSendPanel(props: CycleSendPanelProps) {
  const scopeToken = JSON.stringify(props.delegateScope === undefined ? null : scopeKeys.map(k => props.delegateScope![k]));
  const context = useMemo(() => { try {
    const values: unknown[] | null = JSON.parse(scopeToken), ownedScope = values === null ? undefined
      : Object.fromEntries(scopeKeys.map((k, n) => [k, values[n]])) as PeriodDelegatedClosureScope;
    return cycleSendPanelContext(props.detail, props.actorId, ownedScope);
  } catch { return null; } }, [props.detail, props.actorId, scopeToken]);
  const [marker, setMarker] = useState({ detail: props.detail, actorId: props.actorId, scopeToken, apiFetch: props.apiFetch,
    isCurrentAuth: props.isCurrentAuth, enabled: props.enabled, version: 0 });
  if (marker.detail !== props.detail || marker.actorId !== props.actorId || marker.scopeToken !== scopeToken || marker.apiFetch !== props.apiFetch
    || marker.isCurrentAuth !== props.isCurrentAuth || marker.enabled !== props.enabled) {
    setMarker({ detail: props.detail, actorId: props.actorId, scopeToken, apiFetch: props.apiFetch, isCurrentAuth: props.isCurrentAuth,
      enabled: props.enabled, version: marker.version + 1 }); return null;
  }
  if (!context || !currentAuth(props.isCurrentAuth)) return null;
  return <Workspace key={marker.version} {...props} context={context}/>;
}
function Workspace({ context: c, apiFetch, enabled = false, isCurrentAuth, registerLeaveGuard, onClose }: CycleSendPanelProps & { context: CycleSendPanelContext }) {
  const mounted = useRef(false), visible = useRef(true), epoch = useRef(0), working = useRef(false), sourceRequest = useRef<AbortController | null>(null);
  const current = useCallback(() => mounted.current && visible.current && !document.hidden && currentAuth(isCurrentAuth), [isCurrentAuth]);
  const client = useMemo(() => new AttendanceCycleSendClient({ siteId: c.siteId, actorId: c.actorId,
    ...(c.access === "owner" ? { access: "owner" as const } : { access: "delegate" as const, delegateScope: c.delegateScope! }),
    apiFetch, storage: () => sessionStorage, isCurrentAuth: current }), [c, apiFetch, current]);
  const [source, setSource] = useState<CycleSendPanelSource | null>(null), [pending, setPending] = useState<CycleSendPending | null>(null);
  const [verified, setVerified] = useState<CycleSendResult | null>(null), [blocked, setBlocked] = useState(true), [busy, setBusy] = useState(false), [retired, setRetired] = useState(false);
  const [exposed, setExposed] = useState(true), [draft, setDraft] = useState({ reason: "", ack: false }), [message, setMessage] = useState("");
  const latest = useRef({ source, draft, retired }); latest.current = { source, draft, retired };
  const dirty = useCallback(() => !!latest.current.draft.reason || latest.current.draft.ack, []);
  const stored = useCallback(() => { try { return sessionStorage.getItem(client.storageKey) !== null; } catch { return true; } }, [client]);
  const clear = useCallback(() => { setSource(null); setVerified(null); setDraft({ reason: "", ack: false }); }, []);
  const invalidate = useCallback(() => { epoch.current++; sourceRequest.current?.abort(); sourceRequest.current = null; client.pause(); }, [client]);
  const pause = useCallback(() => { invalidate(); working.current = false;
    flushSync(() => { clear(); setPending(null); setBlocked(true); setBusy(false); setExposed(false); setMessage("正文、理由和选择已隐藏；原周期槽保留，返回后请显式读取本地状态。"); }); }, [clear, invalidate]);
  const mayLeave = useCallback(() => !(working.current || client.hasLeaveRisk() || dirty()) || window.confirm("仍有未提交草稿或待确认周期原号。离开会清除正文与理由，不删除原号、不重复提交。确定离开吗？"), [client, dirty]);
  const local = useCallback(async () => {
    if (!current() || working.current) return; const token = epoch.current; working.current = true; setBusy(true);
    try { const value = await client.load(); if (current() && token === epoch.current) { setPending(value); setBlocked(value !== null); setExposed(true);
      setMessage(value ? "发现首次送审原号；只能显式 GET 核验，不重发。" : "原周期槽为空；未联网、未提交。"); } }
    catch { if (current() && token === epoch.current) { setPending(null); setBlocked(true); setMessage("原槽不是可核验的首次送审格式，或存储不可用。保留内容；旧格式请回原周期入口核验，不能覆盖或清除后重发。"); } }
    finally { if (current() && token === epoch.current) { working.current = false; setBusy(false); } }
  }, [client, current]);
  useLayoutEffect(() => {
    mounted.current = true; visible.current = !document.hidden; void local(); registerLeaveGuard?.(mayLeave);
    const visibility = () => { if (document.hidden) pause(); else visible.current = true; };
    const unload = (event: BeforeUnloadEvent) => { if (working.current || client.hasLeaveRisk() || dirty()) { event.preventDefault(); event.returnValue = ""; } };
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", pause); window.addEventListener("beforeunload", unload);
    return () => { mounted.current = false; invalidate(); client.dispose(); registerLeaveGuard?.(null);
      document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", pause); window.removeEventListener("beforeunload", unload); };
  }, [client, dirty, invalidate, local, mayLeave, pause, registerLeaveGuard]);
  const readSource = async () => {
    if (!current() || working.current || blocked || stored() || retired || !c.acceptedByActor) return; const token = epoch.current;
    if (dirty() && !window.confirm("重新读取来源会丢弃未提交理由和勾选，是否继续？")) return;
    if (!current() || token !== epoch.current || stored()) return;
    const controller = new AbortController(); sourceRequest.current = controller; working.current = true; setBusy(true); clear(); setMessage("");
    try { const value = await readCycleSendPanelSource(c, apiFetch, controller.signal, () => current() && token === epoch.current && !stored());
      if (current() && token === epoch.current && !stored()) { setSource(value); setExposed(true); } }
    catch { if (current() && token === epoch.current) { clear(); setMessage("来源、人员身份、保存边界或当前权限无法核验；未提交。请明确重新读取，不把失败当作空记录。"); } }
    finally { if (current() && token === epoch.current) { if (sourceRequest.current === controller) sourceRequest.current = null; working.current = false; setBusy(false); } }
  };
  const send = () => {
    const snapshot = latest.current, token = epoch.current, draftBytes = JSON.stringify(snapshot.draft);
    const still = () => current() && !working.current && token === epoch.current && enabled && !blocked && !stored() && !latest.current.retired
      && c.acceptedByActor && snapshot.source !== null && snapshot.source.canSend && latest.current.source === snapshot.source
      && JSON.stringify(latest.current.draft) === draftBytes && snapshot.draft.ack;
    if (!still()) return;
    confirmCycleSend(() => window.confirm("明确按保存日期和本次来源首次送审第 1 版？只提交一次，随后须 GET 核验原编号；不是员工本人确认，不会封存或计算工资。"), still, () => {
      let pair: CycleSendBody; try { pair = cycleSendPanelCommand(c, snapshot.source!, snapshot.draft.reason.trim(), crypto.randomUUID(), crypto.randomUUID()); }
      catch { setMessage("理由或本次完整来源不符合首次送审要求；尚未提交，请核对后明确重读。"); return; }
      if (!still()) return; working.current = true; setBusy(true); setBlocked(true); clear();
      void (async () => { try { await client.submit(pair.frame, pair.command); if (current() && token === epoch.current) setMessage("收到响应但原号仍待核对。请仅 GET 核验，不能重复首次送审。"); }
        catch { if (current() && token === epoch.current) setMessage("结果未确认；保留原周期槽，只能显式 GET 核验。不自动重发。"); }
        finally { if (current() && token === epoch.current) { working.current = false; setBusy(false); void local(); } } })();
    });
  };
  const recover = async () => {
    if (!current() || working.current) return; const token = epoch.current;
    if (dirty() && !window.confirm("核验原编号会清除当前未提交理由，是否继续？")) return;
    if (!current() || token !== epoch.current) return; working.current = true; setBusy(true); clear();
    try { const value = await client.recover(); if (current() && token === epoch.current) { setVerified(value); setPending(null); setBlocked(false); setRetired(true); setExposed(true); setMessage("原号 GET 已完整核验。请关闭并重新读取当前意向和工时表，不沿用旧详情再次送审。"); } }
    catch { if (current() && token === epoch.current) { setBlocked(true); setPending(client.getSnapshot().pending); setMessage("原号未获完整匹配的 GET 回执，保留不动；查无回执不等于提交失败。旧格式请回原入口核验。"); } }
    finally { if (current() && token === epoch.current) { working.current = false; setBusy(false); } }
  };
  const locked = busy || blocked || retired;
  return <section aria-label="周期首次送审工作区" className="min-w-0 max-w-full space-y-4 p-4 text-slate-900 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">周期首次送审</h2><p className="mt-2 text-sm text-slate-600">{c.access === "owner" ? "负责人" : "真实委托"}入口 · 仅首次第 1 版，不提供本人确认或封存。</p></div><button type="button" className={button} onClick={() => { if (mayLeave()) onClose(); }}>关闭首次送审</button></header>
    {!enabled && <p className="rounded-xl bg-amber-50 p-3 text-sm">新首次送审尚未开放；仍可在真实登录状态下显式 GET 核验原号。</p>}
    {exposed && <article data-cycle-send-intent className="min-w-0 space-y-2 rounded-xl border p-3 text-sm"><p>{c.fromDate} — {c.throughDate} · 保存时区 {c.timeZone}</p><p className="break-all">采用意向：{c.intentId}</p><p>{c.acceptedByActor ? "此详情仍为原操作者采用、尚未关联送审；提交时服务端再次核验。" : "不是原操作者当前未关联的采用意向；不能从此详情新送审，原号核验不受此限制。"}</p></article>}
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => { if (!dirty() || window.confirm("重新读取本地状态会清除草稿，是否继续？")) { clear(); void local(); } }}>读取本地原槽（不联网）</button><button type="button" className={button} disabled={busy} onClick={() => void recover()}>仅 GET 核验首次送审原号</button><button type="button" className={button} disabled={locked || !c.acceptedByActor} onClick={() => void readSource()}>读取当前工时来源</button></div>
    {pending && exposed && <p className="break-all rounded-xl bg-amber-50 p-3 text-sm">待核对首次送审：{pending.command.operationId} · 原范围 {pending.frame.fromDate} — {pending.frame.throughDate}。按原 worker 和原范围 GET，不重发 POST。</p>}
    {message && <p role="status" className="break-words rounded-xl bg-slate-100 p-3 text-sm">{message}</p>}
    {source && exposed && <CycleSendSourceView source={source}/>}
    {source?.canSend && exposed && <fieldset disabled={locked || !enabled} className="min-w-0 space-y-3 rounded-xl border p-3"><legend>明确首次送审</legend><label className="block text-sm">本次送审理由<textarea aria-label="首次送审理由" className="mt-1 block w-full min-w-0 rounded-lg border border-slate-300 p-2 text-sm" rows={3} maxLength={500} value={draft.reason} onChange={e => setDraft({ reason: e.target.value, ack: false })}/></label><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={draft.ack} onChange={e => setDraft({ ...draft, ack: e.target.checked })}/>已核对人员、保存日期和来源；理解只首次送审，不代员工确认或封存。</label><button type="button" className={button} disabled={!draft.ack} onClick={send}>明确首次送审第 1 版</button></fieldset>}
    {verified && exposed && <CycleSendVerifiedView value={verified}/>}
  </section>;
}
