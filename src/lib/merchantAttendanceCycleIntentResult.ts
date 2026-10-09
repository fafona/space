// 200 strict intent read/receipt projection. A valid digest is wire consistency,
// never proof of SQL origin, present authority, adoption or a sent period.
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { operationalRuleLedgerEncode, operationalRuleLedgerEqual as equal, operationalRuleLedgerFreeze as freeze } from "./merchantAttendanceOperationalRuleLedger";
import { attendanceDayUtcRange, attendanceTimeZone, MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseOperationalRuleSource, type OperationalRuleSource } from "./merchantAttendanceOperationalRuleSource";
import { prepareOperationalCycle, type CyclePreparation } from "./merchantAttendanceCyclePreparation";
import { CYCLE_INTENT_PROTOCOL, parseCycleIntentQuery, parseCycleIntentCommand, cycleIntentCommandFingerprint,
  type CycleIntentQuery, type CycleIntentCommand, type CycleIntentAccept } from "./merchantAttendanceCycleIntent";

export const CYCLE_INTENT_RESULT_LIMIT = 524288;
export const CYCLE_INTENT_ERRORS: Readonly<Record<string, number>> = Object.freeze({
  attendance_invalid_request: 400, attendance_access_denied: 403, attendance_settings_required: 409,
  attendance_worker_not_found: 404, attendance_platform_paused: 403, attendance_period_identity_changed: 409,
  attendance_operation_conflict: 409, attendance_period_overlap: 409, attendance_operational_cycle_invalid: 503,
  attendance_operational_cycle_disabled: 403, attendance_operational_cycle_changed: 409,
  attendance_operational_cycle_not_found: 404, attendance_operational_cycle_linked: 409,
  attendance_operational_cycle_out_of_range: 409, attendance_operational_cycle_protocol_required: 409,
  attendance_operational_cycle_too_large: 422, attendance_rate_limited: 429,
});
export type CycleIntentReceipt = Readonly<{ operationId: string; intentId: string; action: "accept" | "cancel" | "link";
  actorId: string; revision: 1 | 2; recordedAt: string; commandFingerprint: string; periodId: string | null; sendOperationId: string | null }>;
type Frame = Readonly<{ anchorDate: string; fromDate: string; throughDate: string; timeZone: string; fromAt: string; toAt: string; dueAt: string }>;
type SavedActor = Readonly<{ intentId: string; actorId: string; access: "owner" | "delegate"; grantId: string | null; employeeId: string; employeeAuthUserId: string }>;
export type CycleIntent = Frame & SavedActor & Readonly<{ workerId: string; source: OperationalRuleSource; preparation: CyclePreparation;
  acceptCommand: CycleIntentAccept; intentFingerprint: string; recordedAt: string }>;
export type CycleIntentListItem = Frame & SavedActor & Readonly<{ intentFingerprint: string; head: CycleIntentReceipt }>;
export type CycleIntentResult = Readonly<{ protocol: typeof CYCLE_INTENT_PROTOCOL; siteId: string; actorId: string; readAt: string;
  data: Readonly<{ kind: "preparation"; source: OperationalRuleSource; preparation: CyclePreparation; frameHead: Readonly<{ revision: number; lastOperationId: string | null }> | null }>
    | Readonly<{ kind: "detail"; intent: CycleIntent; head: CycleIntentReceipt }>
    | Readonly<{ kind: "list"; items: readonly CycleIntentListItem[]; nextCursor: string | null }>
    | Readonly<{ kind: "receipt" }>;
  receipt: CycleIntentReceipt | null }>;
function fail(): never { throw new MerchantAttendanceError("attendance_operational_cycle_invalid"); }
function exact(raw: unknown, keys: readonly string[]) { try { return captureBrowserExact(raw, keys); } catch { return fail(); } }
const uuid = (v: unknown): string => typeof v === "string" && v.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v) ? v : fail();
const hash = (v: unknown): string => typeof v === "string" && v.length === 64 && /^[0-9a-f]{64}$/.test(v) ? v : fail();
const integer = (v: unknown, min = 0): number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min && v < 9007199254740990 ? v : fail();
function instant(v: unknown): string {
  if (typeof v !== "string" || v.length !== 27 || !/^(?:20\d{2}|2100|2101)-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(v)) fail();
  const ms = v.slice(0, 23) + "Z"; if (!Number.isFinite(Date.parse(ms)) || new Date(ms).toISOString() !== ms) fail(); return v;
}
function date(v: unknown): string {
  if (typeof v !== "string" || v.length !== 10 || !/^(?:20\d{2}|2100)-\d{2}-\d{2}$/.test(v)) fail();
  const ms = Date.parse(v + "T00:00:00.000Z"); if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== v) fail(); return v;
}
/** Snapshot descriptors before the first digest; never invoke a getter/toJSON. */
function snapshot(raw: unknown): unknown {
  let nodes = 0; const path = new Set<object>();
  function copy(v: unknown, depth: number): unknown {
    if (++nodes > 30000 || depth > 24) fail();
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "string") { if (v.length > CYCLE_INTENT_RESULT_LIMIT) fail(); return v; }
    if (typeof v === "number") { if (!Number.isSafeInteger(v) || Object.is(v, -0)) fail(); return v; }
    if (!v || typeof v !== "object" || path.has(v)) fail();
    const arr = Array.isArray(v), prototype = Object.getPrototypeOf(v), keys = Reflect.ownKeys(v);
    if (arr ? prototype !== Array.prototype || v.length > 25 || keys.length !== v.length + 1 : prototype !== Object.prototype && prototype !== null) fail();
    path.add(v); const out: Record<string, unknown> | unknown[] = arr ? [] : {};
    for (const key of keys) {
      if (typeof key !== "string" || ["__proto__", "prototype", "constructor"].includes(key)) fail();
      if (arr && key === "length") continue;
      if (arr && !/^(0|[1-9][0-9]*)$/.test(key)) fail();
      const d = Object.getOwnPropertyDescriptor(v, key)!; if (!("value" in d) || !d.enumerable) fail();
      (out as Record<string, unknown>)[key] = copy(d.value, depth + 1);
    }
    path.delete(v); return out;
  }
  const out = copy(raw, 0); if (new TextEncoder().encode(JSON.stringify(out)).byteLength > CYCLE_INTENT_RESULT_LIMIT) fail(); return out;
}
function receipt(raw: unknown, readAt: string): CycleIntentReceipt {
  const r = exact(raw, ["operationId", "intentId", "action", "actorId", "revision", "recordedAt", "commandFingerprint", "periodId", "sendOperationId"]);
  const operationId = uuid(r.operationId), intentId = uuid(r.intentId), actorId = uuid(r.actorId), action = r.action;
  if (action !== "accept" && action !== "cancel" && action !== "link" || r.revision !== (action === "accept" ? 1 : 2)) fail();
  const recordedAt = instant(r.recordedAt), periodId = r.periodId === null ? null : uuid(r.periodId), sendOperationId = r.sendOperationId === null ? null : uuid(r.sendOperationId);
  if (recordedAt > readAt || (action === "accept") !== (operationId === intentId)
    || (action === "link" ? periodId === null || sendOperationId !== operationId : periodId !== null || sendOperationId !== null)) fail();
  return { operationId, intentId, action, actorId, revision: r.revision as 1 | 2, recordedAt, commandFingerprint: hash(r.commandFingerprint), periodId, sendOperationId };
}
function frame(r: Record<string, unknown>): Frame {
  const anchorDate = date(r.anchorDate), fromDate = date(r.fromDate), throughDate = date(r.throughDate), days = (Date.parse(throughDate) - Date.parse(fromDate)) / 86400000 + 1;
  if (days < 1 || days > 31 || anchorDate < fromDate || anchorDate > throughDate || typeof r.timeZone !== "string") fail();
  const timeZone = attendanceTimeZone(r.timeZone), fromAt = instant(r.fromAt), toAt = instant(r.toAt), dueAt = instant(r.dueAt);
  const micro = (text: string) => text.slice(0, -1) + "000Z";
  // Cross-check saved civil edges, including DST, without pretending elapsed
  // 24-hour arithmetic is an authoritative date boundary.
  if (fromAt !== micro(attendanceDayUtcRange(fromDate, timeZone).startAt)
    || toAt !== micro(attendanceDayUtcRange(throughDate, timeZone).endAt) || fromAt >= toAt || dueAt !== toAt) fail();
  return { anchorDate, fromDate, throughDate, timeZone, fromAt, toAt, dueAt };
}
function savedActor(r: Record<string, unknown>): SavedActor {
  if (r.access !== "owner" && r.access !== "delegate") fail(); const grantId = r.grantId === null ? null : uuid(r.grantId);
  if ((r.access === "owner") !== (grantId === null)) fail();
  return { intentId: uuid(r.intentId), actorId: uuid(r.actorId), access: r.access, grantId, employeeId: uuid(r.employeeId), employeeAuthUserId: uuid(r.employeeAuthUserId) };
}
async function source(raw: unknown, q: CycleIntentQuery, readAt: string): Promise<OperationalRuleSource> {
  const s = exact(raw, ["protocol", "siteId", "workerIdentity", "at", "settingsRef", "groupAssignmentRef", "layers", "baselineCorrectionPolicyRef", "sourceFingerprint"]);
  const w = exact(s.workerIdentity, ["workerId", "employeeId", "employeeAuthUserId", "workerVersion", "employeeVersion"]), at = instant(s.at);
  if (at > readAt) fail();
  return parseOperationalRuleSource(raw, { siteId: q.siteId, workerId: q.workerId, employeeId: uuid(w.employeeId), employeeAuthUserId: uuid(w.employeeAuthUserId), at });
}
async function digest(tuple: Parameters<typeof operationalRuleLedgerEncode>[0]): Promise<string> {
  const bytes = new TextEncoder().encode(operationalRuleLedgerEncode(tuple));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
}
export async function parseCycleIntentResult(raw: unknown, rawQuery: CycleIntentQuery, rawActor: string,
  rawCommand: CycleIntentCommand | null = null, representation: "sql" | "browser" = "browser"): Promise<CycleIntentResult> {
  try {
    if (representation !== "sql" && representation !== "browser") fail();
    const q = parseCycleIntentQuery(rawQuery), actorId = uuid(rawActor);
    const commandQuery: CycleIntentQuery = q.mode === "recover" ? { siteId: q.siteId, access: q.access, workerId: q.workerId, grantId: q.grantId, mode: "detail", intentId: q.intentId } : q;
    const c = rawCommand === null ? null : parseCycleIntentCommand(rawCommand, commandQuery);
    if (q.mode === "recover" && c && c.operationId !== q.operationId) fail();
    const r = exact(snapshot(raw), ["protocol", "siteId", "actorId", "readAt", "data", "receipt"]), readAt = instant(r.readAt);
    if (r.protocol !== CYCLE_INTENT_PROTOCOL || r.siteId !== q.siteId || r.actorId !== actorId) fail();
    const savedReceipt = r.receipt === null ? null : receipt(r.receipt, readAt);
    if (c && (!savedReceipt || savedReceipt.operationId !== c.operationId || savedReceipt.intentId !== c.intentId || savedReceipt.action !== c.action
      || savedReceipt.actorId !== actorId || savedReceipt.commandFingerprint !== await cycleIntentCommandFingerprint(commandQuery, c, actorId))) fail();
    let data: CycleIntentResult["data"];
    if (c || q.mode === "recover") {
      const d = exact(r.data, ["kind"]); if (d.kind !== "receipt") fail();
      if (q.mode === "recover" && savedReceipt && (savedReceipt.operationId !== q.operationId || savedReceipt.intentId !== q.intentId
        || savedReceipt.actorId !== actorId || savedReceipt.action === "link")) fail();
      data = { kind: "receipt" };
    } else {
      if (savedReceipt !== null) fail();
      if (q.mode === "prepare") {
        const d = exact(r.data, representation === "sql" ? ["kind", "source", "anchorDate", "activation", "frameHead"] : ["kind", "source", "preparation", "frameHead"]);
        if (d.kind !== "preparation") fail(); const s = await source(d.source, q, readAt);
        const p = representation === "sql" ? null : exact(d.preparation, ["protocol", "candidateOnly", "applied", "authorityChecked", "siteId", "workerIdentity", "observedAt", "settingsRef", "anchorDate", "activation", "choice", "state", "range", "sourceFingerprint", "preparationFingerprint"]);
        const preparation = await prepareOperationalCycle({ source: s, expected: { siteId: q.siteId, workerId: q.workerId, employeeId: s.workerIdentity.employeeId, employeeAuthUserId: s.workerIdentity.employeeAuthUserId, at: s.at },
          anchorDate: representation === "sql" ? d.anchorDate : p!.anchorDate, activation: representation === "sql" ? d.activation : p!.activation });
        if (preparation.anchorDate !== q.anchorDate || p && !equal(p, preparation)) fail();
        let frameHead: { revision: number; lastOperationId: string | null } | null = null;
        if (d.frameHead !== null) { const h = exact(d.frameHead, ["revision", "lastOperationId"]), revision = integer(h.revision), lastOperationId = h.lastOperationId === null ? null : uuid(h.lastOperationId);
          if ((revision === 0) !== (lastOperationId === null)) fail(); frameHead = { revision, lastOperationId }; }
        if ((preparation.state === "ready") !== (frameHead !== null)) fail(); data = { kind: "preparation", source: s, preparation, frameHead };
      } else if (q.mode === "detail") {
        const d = exact(r.data, ["kind", "intent", "head"]); if (d.kind !== "detail") fail();
        const i = exact(d.intent, ["intentId", "workerId", "employeeId", "employeeAuthUserId", "actorId", "access", "grantId", "anchorDate", "fromDate", "throughDate", "timeZone", "fromAt", "toAt", "dueAt", "source", "preparation", "acceptCommand", "intentFingerprint", "recordedAt"]);
        const a = savedActor(i), f = frame(i), recordedAt = instant(i.recordedAt), head = receipt(d.head, readAt), s = await source(i.source, q, recordedAt);
        if (a.intentId !== q.intentId || i.workerId !== q.workerId || head.intentId !== a.intentId || recordedAt > head.recordedAt) fail();
        const acceptQuery = { siteId: q.siteId, workerId: q.workerId, access: a.access, grantId: a.grantId, mode: "detail" as const, intentId: a.intentId };
        const acceptCommand = parseCycleIntentCommand(i.acceptCommand, acceptQuery); if (acceptCommand.action !== "accept") fail();
        const preparation = await prepareOperationalCycle({ source: s, expected: { siteId: q.siteId, workerId: q.workerId, employeeId: a.employeeId, employeeAuthUserId: a.employeeAuthUserId, at: s.at },
          anchorDate: f.anchorDate, activation: { revision: acceptCommand.expectedActivationRevision, active: true } });
        if (!equal(i.preparation, preparation) || preparation.state !== "ready" || !preparation.range || f.fromDate !== preparation.range.fromDate || f.throughDate !== preparation.range.throughDate
          || f.timeZone !== preparation.settingsRef.timeZone || acceptCommand.employeeId !== a.employeeId || acceptCommand.employeeAuthUserId !== a.employeeAuthUserId
          || acceptCommand.anchorDate !== f.anchorDate || acceptCommand.fromDate !== f.fromDate || acceptCommand.throughDate !== f.throughDate
          || acceptCommand.expectedWorkerVersion !== s.workerIdentity.workerVersion || acceptCommand.expectedEmployeeVersion !== s.workerIdentity.employeeVersion
          || acceptCommand.expectedSettingsVersion !== s.settingsRef.version || acceptCommand.expectedPreparationFingerprint !== preparation.preparationFingerprint) fail();
        const commandHash = await cycleIntentCommandFingerprint(acceptQuery, acceptCommand, a.actorId), intentFingerprint = hash(i.intentFingerprint);
        if (head.action === "accept" && (head.actorId !== a.actorId || head.recordedAt !== recordedAt || head.commandFingerprint !== commandHash)) fail();
        if (intentFingerprint !== await digest(["attendance-cycle-intent-v1", q.siteId, a.intentId, a.actorId, a.access, a.grantId, q.workerId, a.employeeId, a.employeeAuthUserId,
          f.anchorDate, f.fromDate, f.throughDate, f.timeZone, f.fromAt, f.toAt, f.dueAt, preparation.preparationFingerprint, s.sourceFingerprint, commandHash, recordedAt])) fail();
        data = { kind: "detail", intent: { ...a, ...f, workerId: q.workerId, source: s, preparation, acceptCommand, intentFingerprint, recordedAt }, head };
      } else {
        if (q.mode !== "list") fail(); const d = exact(r.data, ["kind", "items", "nextCursor"]); if (d.kind !== "list" || !Array.isArray(d.items) || d.items.length > 25) fail();
        let previous = q.cursor ?? ""; const items = d.items.map(rawItem => {
          const i = exact(rawItem, ["intentId", "actorId", "access", "grantId", "employeeId", "employeeAuthUserId", "anchorDate", "fromDate", "throughDate", "timeZone", "fromAt", "toAt", "dueAt", "intentFingerprint", "head"]);
          const a = savedActor(i), f = frame(i), head = receipt(i.head, readAt);
          if (a.intentId <= previous || head.intentId !== a.intentId || head.action === "accept" && head.actorId !== a.actorId) fail(); previous = a.intentId;
          return { ...a, ...f, intentFingerprint: hash(i.intentFingerprint), head };
        });
        const nextCursor = d.nextCursor === null ? null : uuid(d.nextCursor); if (nextCursor !== null && (items.length !== 25 || nextCursor !== previous)) fail();
        data = { kind: "list", items, nextCursor };
      }
    }
    return freeze({ protocol: CYCLE_INTENT_PROTOCOL, siteId: q.siteId, actorId, readAt, data, receipt: savedReceipt });
  } catch { return fail(); }
}
export async function parseCycleIntentResponse(raw: unknown, query: CycleIntentQuery, actor: string, command: CycleIntentCommand | null = null) {
  const r = exact(raw, ["ok", "data"]); if (r.ok !== true) fail(); return freeze({ ok: true as const, data: await parseCycleIntentResult(r.data, query, actor, command) });
}
export function parseCycleIntentResultJson(text: string): unknown {
  if (typeof text !== "string" || text.length > CYCLE_INTENT_RESULT_LIMIT || new TextEncoder().encode(text).byteLength > CYCLE_INTENT_RESULT_LIMIT) fail();
  try { return parseCaptureBrowserJson(text); } catch { return fail(); }
}
