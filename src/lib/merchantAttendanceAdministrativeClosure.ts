// Pure administrative-closure protocol. Shape/hash checks do not prove DB locks,
// ownership, raw-source authenticity, or that a closure can already be executed.
import { captureBrowserExact, captureBrowserUuid, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { operationalRuleLedgerEncode, operationalRuleLedgerFreeze as freeze } from "./merchantAttendanceOperationalRuleLedger";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

export const ADMINISTRATIVE_CLOSURE_API = "/api/merchant-enterprise/attendance/administrative-closures";
export const ADMINISTRATIVE_CLOSURE_PROTOCOL = "attendance-administrative-closures-v1" as const;
export const ADMINISTRATIVE_CLOSURE_BOUNDARY_PROTOCOL = "attendance-administrative-boundary-v1" as const;
export const ADMINISTRATIVE_CLOSURE_MAX_REVISION = 9007199254740990;
export const ADMINISTRATIVE_CLOSURE_BODY_LIMIT = 8192, ADMINISTRATIVE_CLOSURE_RESPONSE_LIMIT = 131072;
export const ADMINISTRATIVE_CLOSURE_BLOCKERS = ["not_paused", "identity_changed", "employment_changed", "suspension_changed", "source_changed", "session_not_open", "already_closed", "revision_limit", "feature_disabled", "period_sealed", "source_too_large"] as const;
export type AdministrativeClosureBlocker = typeof ADMINISTRATIVE_CLOSURE_BLOCKERS[number];
export type AdministrativeClosureAccess = "owner" | "self";
export type AdministrativeClosureAction = "record_unknown" | "close" | "self_dispute" | "owner_respond";
export type AdministrativeClosureIdentity = Readonly<{ workerId: string; employeeId: string; employeeAuthUserId: string }>;
export type AdministrativeClosureCaseScope = AdministrativeClosureIdentity & Readonly<{ employmentPeriodId: string; startEventId: string; startSequence: number; startAt: string }>;
export type AdministrativeClosureFrame = AdministrativeClosureCaseScope & Readonly<{ suspensionId: string; generation: number; tailEventId: string; tailSequence: number; tailAction: "clock_in" | "break_start" | "break_end"; tailOccurredAt: string; timeZone: string }>;
export type AdministrativeClosureContext = Readonly<{ workerVersion: number; employeeVersion: number; settingsVersion: number; employmentRevision: number; sourceFingerprint: string }>;
export type AdministrativeClosureBoundary = AdministrativeClosureFrame & Readonly<{ protocol: typeof ADMINISTRATIVE_CLOSURE_BOUNDARY_PROTOCOL; siteId: string; operationId: string; revision: number; verifiedEndAt: string; recordedAt: string; sourceFingerprint: string }>;
export type AdministrativeClosureQuery = Readonly<
  | { siteId: string; access: "owner"; mode: "workers"; afterId: string | null }
  | { siteId: string; access: "owner"; mode: "candidate"; workerId: string }
  | { siteId: string; access: AdministrativeClosureAccess; mode: "list"; afterId: string | null }
  | { siteId: string; access: AdministrativeClosureAccess; mode: "detail"; startEventId: string }
  | { siteId: string; access: AdministrativeClosureAccess; mode: "history"; startEventId: string; beforeRevision: number | null }
  | { siteId: string; access: AdministrativeClosureAccess; mode: "recover"; operationId: string }>;
type CommandBase = Readonly<{ operationId: string; startEventId: string; expectedRevision: number; reason: string }>;
export type AdministrativeClosureCommand = CommandBase & Readonly<
  | { action: "record_unknown"; workerId: string; expectedSourceFingerprint: string; verifiedEndAt: null }
  | { action: "close"; workerId: string; expectedSourceFingerprint: string; verifiedEndAt: string }
  | { action: "self_dispute"; expectedClosedOperationId: string | null }
  | { action: "owner_respond"; disputeOperationId: string }>;
export type AdministrativeClosureEntry = Readonly<{ operationId: string; startEventId: string; revision: number; action: AdministrativeClosureAction; actorId: string; actorAccess: AdministrativeClosureAccess; reason: string; verifiedEndAt: string | null; disputeOperationId: string | null; frame: AdministrativeClosureFrame | null; context: AdministrativeClosureContext | null; recordedAt: string; commandFingerprint: string }>;
export type AdministrativeClosureReceipt = Readonly<{ operationId: string; startEventId: string; revision: number; action: AdministrativeClosureAction; actorId: string; recordedAt: string; commandFingerprint: string }>;
export type AdministrativeClosureSummary = Readonly<{ startEventId: string; identity: AdministrativeClosureIdentity; employmentPeriodId: string; state: "pending" | "closed"; revision: number; verifiedEndAt: string | null; closedOperationId: string | null; hasDispute: boolean; updatedAt: string }>;
export type AdministrativeClosureCapabilities = Readonly<{ canRecordUnknown: boolean; canClose: boolean; canDispute: boolean; canRespond: boolean }>;
export type AdministrativeClosureDetail = Readonly<{ summary: AdministrativeClosureSummary | null; frame: AdministrativeClosureFrame | null; context: AdministrativeClosureContext | null; evidenceOperationId: string | null; currentEntry: AdministrativeClosureEntry | null; closure: AdministrativeClosureBoundary | null; capabilities: AdministrativeClosureCapabilities; blockers: readonly AdministrativeClosureBlocker[] }>;
export type AdministrativeClosureWorker = Readonly<{ workerId: string; employeeId: string | null; employeeAuthUserId: string | null; workerNo: string; displayName: string; paused: boolean }>;
export type AdministrativeClosureData = Readonly<
  | { kind: "workers"; items: readonly AdministrativeClosureWorker[]; nextAfterId: string | null }
  | { kind: "list"; items: readonly AdministrativeClosureSummary[]; nextAfterId: string | null }
  | { kind: "candidate" | "detail"; detail: AdministrativeClosureDetail }
  | { kind: "history"; startEventId: string; items: readonly AdministrativeClosureEntry[]; nextBeforeRevision: number | null }
  | { kind: "receipt"; receipt: AdministrativeClosureReceipt | null }>;
export type AdministrativeClosureResult = Readonly<{ protocol: typeof ADMINISTRATIVE_CLOSURE_PROTOCOL; siteId: string; access: AdministrativeClosureAccess; actorId: string; readAt: string; data: AdministrativeClosureData }>;
export const ADMINISTRATIVE_CLOSURE_ERRORS = Object.freeze({ attendance_invalid_request: 400, attendance_access_denied: 403, attendance_operation_conflict: 409, attendance_period_sealed: 409,
  attendance_administrative_closure_invalid: 503, attendance_administrative_closure_changed: 409, attendance_administrative_closure_blocked: 409,
  attendance_administrative_closure_disabled: 403, attendance_administrative_closure_not_found: 404, attendance_administrative_closure_too_large: 422 });
export type AdministrativeClosureError = keyof typeof ADMINISTRATIVE_CLOSURE_ERRORS;
export type AdministrativeClosureResponse = Readonly<{ ok: true; data: AdministrativeClosureResult } | { ok: false; error: { code: AdministrativeClosureError; message: string } }>;

const MAX = ADMINISTRATIVE_CLOSURE_MAX_REVISION;
function fail(): never { throw new MerchantAttendanceError("attendance_invalid_request"); }
function invalid(): never { throw new MerchantAttendanceError("attendance_administrative_closure_invalid"); }
function exact(v: unknown, keys: readonly string[]) { try { return captureBrowserExact(v, keys); } catch { return fail(); } }
function tag(v: unknown, key: string): unknown { return v && typeof v === "object" ? Object.getOwnPropertyDescriptor(v, key)?.value : undefined; }
function uuid(v: unknown): string { if (typeof v !== "string" || v.length !== 36) fail(); try { return captureBrowserUuid(v); } catch { return fail(); } }
function nullableUuid(v: unknown) { return v === null ? null : uuid(v); }
function site(v: unknown): string { return typeof v === "string" && v.length === 8 && /^[0-9]{8}$/.test(v) ? v : fail(); }
function integer(v: unknown, min = 0, max = MAX): number { return typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min && v <= max ? v : fail(); }
function bool(v: unknown): boolean { return typeof v === "boolean" ? v : fail(); }
function access(v: unknown): AdministrativeClosureAccess { return v === "owner" || v === "self" ? v : fail(); }
function action(v: unknown): AdministrativeClosureAction { return v === "record_unknown" || v === "close" || v === "self_dispute" || v === "owner_respond" ? v : fail(); }
function hash(v: unknown): string { return typeof v === "string" && v.length === 64 && /^[0-9a-f]{64}$/.test(v) ? v : fail(); }
function unicode(v: string) { for (let i = 0; i < v.length; i++) { const n = v.charCodeAt(i); if (n >= 0xd800 && n <= 0xdbff) { const next = v.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) fail(); } else if (n >= 0xdc00 && n <= 0xdfff) fail(); } }
function label(v: unknown, max: number): string { if (typeof v !== "string" || !v || v !== v.trim() || [...v].length > max || /[\u0000-\u001f\u007f-\u009f]/.test(v)) fail(); unicode(v); return v; }
function instant(v: unknown): string { if (typeof v !== "string" || v.length !== 27 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(v) || v.slice(0, 10) < "2000-01-01" || v.slice(0, 10) > "2100-12-31") fail(); const ms = v.slice(0, 23) + "Z"; if (!Number.isFinite(Date.parse(ms)) || new Date(ms).toISOString() !== ms) fail(); return v; }
function nullableInstant(v: unknown) { return v === null ? null : instant(v); }
function same(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }

// Own every nested value before the first await. Accessors, sparse arrays,
// exotic prototypes, cycles and excessive trees are rejected without invocation.
function snapshot(raw: unknown, cap: number): unknown {
  const seen = new Set<object>(); let nodes = 0;
  function copy(v: unknown, depth: number): unknown {
    if (++nodes > 8000 || depth > 16) fail();
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "string") { if (v.length > cap) fail(); unicode(v); return v; }
    if (typeof v === "number") { if (!Number.isSafeInteger(v) || Object.is(v, -0)) fail(); return v; }
    if (!v || typeof v !== "object" || seen.has(v)) fail();
    const proto = Object.getPrototypeOf(v), ds = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(v); seen.add(v);
    let result: unknown;
    if (Array.isArray(v)) {
      if (proto !== Array.prototype || v.length > 1000 || keys.length !== v.length + 1) fail();
      const values: unknown[] = []; for (let i = 0; i < v.length; i++) { const d = ds[String(i)]; if (!d || !("value" in d) || !d.enumerable) fail(); values.push(copy(d.value, depth + 1)); } result = values;
    } else {
      if (proto !== Object.prototype && proto !== null) fail();
      const values: Record<string, unknown> = {}; for (const key of keys) { if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)) fail(); const d = ds[key]; if (!("value" in d) || !d.enumerable) fail(); values[key] = copy(d.value, depth + 1); } result = values;
    }
    seen.delete(v); return result;
  }
  const result = copy(raw, 0); if (new TextEncoder().encode(JSON.stringify(result)).byteLength > cap) fail(); return result;
}
const IDENTITY_KEYS = ["workerId", "employeeId", "employeeAuthUserId"] as const;
const CASE_KEYS = [...IDENTITY_KEYS, "employmentPeriodId", "startEventId", "startSequence", "startAt"] as const;
const FRAME_KEYS = [...CASE_KEYS, "suspensionId", "generation", "tailEventId", "tailSequence", "tailAction", "tailOccurredAt", "timeZone"] as const;
function identity(raw: unknown): AdministrativeClosureIdentity { const v = exact(raw, IDENTITY_KEYS); return freeze({ workerId: uuid(v.workerId), employeeId: uuid(v.employeeId), employeeAuthUserId: uuid(v.employeeAuthUserId) }); }
function pick(v: Record<string, unknown>, keys: readonly string[]) { return Object.fromEntries(keys.map(k => [k, v[k]])); }
export function parseAdministrativeClosureCaseScope(raw: unknown): AdministrativeClosureCaseScope { const v = exact(raw, CASE_KEYS); return freeze({ ...identity(pick(v, IDENTITY_KEYS)), employmentPeriodId: uuid(v.employmentPeriodId), startEventId: uuid(v.startEventId), startSequence: integer(v.startSequence, 1), startAt: instant(v.startAt) }); }
export function administrativeClosureSameCase(a: AdministrativeClosureCaseScope, b: AdministrativeClosureCaseScope): boolean { return CASE_KEYS.every(k => a[k] === b[k]); }
export function parseAdministrativeClosureFrame(raw: unknown): AdministrativeClosureFrame {
  const v = exact(raw, FRAME_KEYS), scope = parseAdministrativeClosureCaseScope(pick(v, CASE_KEYS));
  if (v.tailAction !== "clock_in" && v.tailAction !== "break_start" && v.tailAction !== "break_end") fail();
  const result: AdministrativeClosureFrame = { ...scope, suspensionId: uuid(v.suspensionId), generation: integer(v.generation, 1), tailEventId: uuid(v.tailEventId), tailSequence: integer(v.tailSequence, scope.startSequence), tailAction: v.tailAction, tailOccurredAt: instant(v.tailOccurredAt), timeZone: label(v.timeZone, 100) };
  if (result.tailSequence - scope.startSequence > 2001 || result.tailOccurredAt < scope.startAt) fail();
  if (result.tailSequence === scope.startSequence ? result.tailEventId !== scope.startEventId || result.tailAction !== "clock_in" || result.tailOccurredAt !== scope.startAt : result.tailEventId === scope.startEventId || result.tailAction === "clock_in") fail();
  return freeze(result);
}
export function parseAdministrativeClosureContext(raw: unknown): AdministrativeClosureContext { const v = exact(raw, ["workerVersion", "employeeVersion", "settingsVersion", "employmentRevision", "sourceFingerprint"]); return freeze({ workerVersion: integer(v.workerVersion, 1), employeeVersion: integer(v.employeeVersion, 1), settingsVersion: integer(v.settingsVersion, 1), employmentRevision: integer(v.employmentRevision), sourceFingerprint: hash(v.sourceFingerprint) }); }
export function parseAdministrativeClosureBoundary(raw: unknown): AdministrativeClosureBoundary {
  const v = exact(raw, [...FRAME_KEYS, "protocol", "siteId", "operationId", "revision", "verifiedEndAt", "recordedAt", "sourceFingerprint"]); if (v.protocol !== ADMINISTRATIVE_CLOSURE_BOUNDARY_PROTOCOL) fail();
  const f = parseAdministrativeClosureFrame(pick(v, FRAME_KEYS)), end = instant(v.verifiedEndAt), at = instant(v.recordedAt); if (end < f.tailOccurredAt || end > at) fail();
  return freeze({ ...f, protocol: ADMINISTRATIVE_CLOSURE_BOUNDARY_PROTOCOL, siteId: site(v.siteId), operationId: uuid(v.operationId), revision: integer(v.revision, 1), verifiedEndAt: end, recordedAt: at, sourceFingerprint: hash(v.sourceFingerprint) });
}
export function parseAdministrativeClosureQuery(raw: unknown): AdministrativeClosureQuery {
  const mode = tag(raw, "mode"), base = ["siteId", "access", "mode"], extra = mode === "workers" || mode === "list" ? ["afterId"] : mode === "candidate" ? ["workerId"] : mode === "detail" ? ["startEventId"] : mode === "history" ? ["startEventId", "beforeRevision"] : mode === "recover" ? ["operationId"] : fail();
  const v = exact(raw, [...base, ...extra]), siteId = site(v.siteId), a = access(v.access);
  if (mode === "workers" || mode === "candidate") { if (a !== "owner") fail(); return freeze(mode === "workers" ? { siteId, access: a, mode, afterId: nullableUuid(v.afterId) } : { siteId, access: a, mode, workerId: uuid(v.workerId) }); }
  if (mode === "list") return freeze({ siteId, access: a, mode, afterId: nullableUuid(v.afterId) });
  if (mode === "detail") return freeze({ siteId, access: a, mode, startEventId: uuid(v.startEventId) });
  if (mode === "history") return freeze({ siteId, access: a, mode, startEventId: uuid(v.startEventId), beforeRevision: v.beforeRevision === null ? null : integer(v.beforeRevision, 1) });
  return freeze({ siteId, access: a, mode: "recover", operationId: uuid(v.operationId) });
}
export function parseAdministrativeClosureCommand(raw: unknown): AdministrativeClosureCommand {
  const a = action(tag(raw, "action")), base = ["operationId", "startEventId", "expectedRevision", "reason", "action"], extra = a === "close" || a === "record_unknown" ? ["workerId", "expectedSourceFingerprint", "verifiedEndAt"] : a === "self_dispute" ? ["expectedClosedOperationId"] : ["disputeOperationId"];
  const v = exact(raw, [...base, ...extra]), common = { operationId: uuid(v.operationId), startEventId: uuid(v.startEventId), expectedRevision: integer(v.expectedRevision, 0, MAX - 1), reason: label(v.reason, 500) };
  if (a === "close" || a === "record_unknown") { const source = { workerId: uuid(v.workerId), expectedSourceFingerprint: hash(v.expectedSourceFingerprint) }; if (a === "record_unknown") { if (v.verifiedEndAt !== null) fail(); return freeze({ ...common, action: a, ...source, verifiedEndAt: null }); } return freeze({ ...common, action: a, ...source, verifiedEndAt: instant(v.verifiedEndAt) }); }
  if (!common.expectedRevision) fail();
  if (a === "self_dispute") return freeze({ ...common, action: a, expectedClosedOperationId: nullableUuid(v.expectedClosedOperationId) });
  const disputeOperationId = uuid(v.disputeOperationId); if (disputeOperationId === common.operationId) fail(); return freeze({ ...common, action: a, disputeOperationId });
}
function bind(q: AdministrativeClosureQuery, c: AdministrativeClosureCommand, recover = false) {
  if (q.access !== (c.action === "self_dispute" ? "self" : "owner")) fail();
  if (recover && q.mode === "recover") { if (q.operationId !== c.operationId) fail(); return; }
  if (c.action === "close" || c.action === "record_unknown") { if (q.mode !== "candidate" || q.workerId !== c.workerId) fail(); }
  else if (q.mode !== "detail" || q.startEventId !== c.startEventId) fail();
}
export function parseAdministrativeClosureBody(raw: unknown) { const v = exact(raw, ["query", "command"]), query = parseAdministrativeClosureQuery(v.query), command = parseAdministrativeClosureCommand(v.command); bind(query, command); return freeze({ query, command }); }
export function administrativeClosureQueryString(raw: AdministrativeClosureQuery): string { const q = parseAdministrativeClosureQuery(raw); return new URLSearchParams(Object.entries(q).map(([k, v]) => [k, v === null ? "null" : String(v)])).toString(); }
export function parseAdministrativeClosureHttpQuery(url: string): AdministrativeClosureQuery {
  const u = new URL(url); if (url.includes("#") || u.hash || u.search.length > 2048) fail(); const pairs = [...u.searchParams.entries()]; if (new Set(pairs.map(([k]) => k)).size !== pairs.length) fail();
  const raw: Record<string, unknown> = Object.fromEntries(pairs); for (const k of ["afterId", "beforeRevision"]) if (raw[k] === "null") raw[k] = null;
  if (typeof raw.beforeRevision === "string") { if (!/^[1-9][0-9]{0,15}$/.test(raw.beforeRevision)) fail(); raw.beforeRevision = Number(raw.beforeRevision); } return parseAdministrativeClosureQuery(raw);
}
export function parseAdministrativeClosureJson(text: string, request = false): unknown { const cap = request ? ADMINISTRATIVE_CLOSURE_BODY_LIMIT : ADMINISTRATIVE_CLOSURE_RESPONSE_LIMIT; if (typeof text !== "string" || text.length > cap || new TextEncoder().encode(text).byteLength > cap) throw new MerchantAttendanceError("attendance_administrative_closure_too_large"); try { return parseCaptureBrowserJson(text); } catch { return request ? fail() : invalid(); } }
export function administrativeClosureCommandText(siteId: string, actorId: string, a: AdministrativeClosureAccess, raw: AdministrativeClosureCommand): string {
  const c = parseAdministrativeClosureCommand(raw), actor = uuid(actorId), siteValue = site(siteId), mode = access(a); if (mode !== (c.action === "self_dispute" ? "self" : "owner")) fail();
  const extra = c.action === "close" || c.action === "record_unknown" ? [c.workerId, c.expectedSourceFingerprint, c.verifiedEndAt] : c.action === "self_dispute" ? [c.expectedClosedOperationId] : [c.disputeOperationId];
  return operationalRuleLedgerEncode(["attendance-administrative-closure-command-v1", siteValue, actor, mode, [c.operationId, c.startEventId, c.action, c.expectedRevision, c.reason, ...extra]]);
}
export async function administrativeClosureCommandFingerprint(siteId: string, actorId: string, a: AdministrativeClosureAccess, raw: AdministrativeClosureCommand): Promise<string> {
  const ownedText = administrativeClosureCommandText(siteId, actorId, a, raw), bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ownedText)); return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, "0")).join("");
}
export function parseAdministrativeClosureReceipt(raw: unknown): AdministrativeClosureReceipt { const v = exact(raw, ["operationId", "startEventId", "revision", "action", "actorId", "recordedAt", "commandFingerprint"]); return freeze({ operationId: uuid(v.operationId), startEventId: uuid(v.startEventId), revision: integer(v.revision, 1), action: action(v.action), actorId: uuid(v.actorId), recordedAt: instant(v.recordedAt), commandFingerprint: hash(v.commandFingerprint) }); }
export function administrativeClosureReceiptMatches(raw: AdministrativeClosureReceipt, command: AdministrativeClosureCommand, actorId: string, fingerprint: string): boolean {
  try { const r = parseAdministrativeClosureReceipt(raw), c = parseAdministrativeClosureCommand(command); return r.operationId === c.operationId && r.startEventId === c.startEventId && r.revision === c.expectedRevision + 1 && r.action === c.action && r.actorId === uuid(actorId) && r.commandFingerprint === hash(fingerprint); } catch { return false; }
}
export function parseAdministrativeClosureEntry(raw: unknown): AdministrativeClosureEntry {
  const v = exact(raw, ["operationId", "startEventId", "revision", "action", "actorId", "actorAccess", "reason", "verifiedEndAt", "disputeOperationId", "frame", "context", "recordedAt", "commandFingerprint"]), r = parseAdministrativeClosureReceipt(pick(v, ["operationId", "startEventId", "revision", "action", "actorId", "recordedAt", "commandFingerprint"]));
  const frame = v.frame === null ? null : parseAdministrativeClosureFrame(v.frame), context = v.context === null ? null : parseAdministrativeClosureContext(v.context), actorAccess = access(v.actorAccess), end = nullableInstant(v.verifiedEndAt), dispute = nullableUuid(v.disputeOperationId);
  if (actorAccess !== (r.action === "self_dispute" ? "self" : "owner") || (r.action === "close" || r.action === "record_unknown") !== (frame !== null && context !== null) || (frame === null) !== (context === null)) fail();
  if (frame && (frame.startEventId !== r.startEventId || frame.tailOccurredAt > r.recordedAt)) fail();
  if (r.action === "close" ? !end || !frame || end < frame.tailOccurredAt || end > r.recordedAt : end !== null) fail();
  if (r.action === "owner_respond" ? !dispute || dispute === r.operationId : dispute !== null) fail();
  if (r.action === "self_dispute" && r.revision < 2 || r.action === "owner_respond" && r.revision < 3) fail();
  return freeze({ ...r, actorAccess, reason: label(v.reason, 500), verifiedEndAt: end, disputeOperationId: dispute, frame, context });
}
export function parseAdministrativeClosureSummary(raw: unknown): AdministrativeClosureSummary {
  const v = exact(raw, ["startEventId", "identity", "employmentPeriodId", "state", "revision", "verifiedEndAt", "closedOperationId", "hasDispute", "updatedAt"]); if (v.state !== "pending" && v.state !== "closed") fail(); const end = nullableInstant(v.verifiedEndAt), closed = nullableUuid(v.closedOperationId), at = instant(v.updatedAt);
  if (v.state === "closed" ? !end || !closed || end > at : end !== null || closed !== null) fail();
  return freeze({ startEventId: uuid(v.startEventId), identity: identity(v.identity), employmentPeriodId: uuid(v.employmentPeriodId), state: v.state, revision: integer(v.revision, 1), verifiedEndAt: end, closedOperationId: closed, hasDispute: bool(v.hasDispute), updatedAt: at });
}
function summaryScope(s: AdministrativeClosureSummary, f: AdministrativeClosureCaseScope) { return s.startEventId === f.startEventId && s.employmentPeriodId === f.employmentPeriodId && IDENTITY_KEYS.every(k => s.identity[k] === f[k]); }
function parseDetail(raw: unknown, q: Extract<AdministrativeClosureQuery, { mode: "candidate" | "detail" }>, actor: string, at: string): AdministrativeClosureDetail {
  const v = exact(raw, ["summary", "frame", "context", "evidenceOperationId", "currentEntry", "closure", "capabilities", "blockers"]), summary = v.summary === null ? null : parseAdministrativeClosureSummary(v.summary), frame = v.frame === null ? null : parseAdministrativeClosureFrame(v.frame), context = v.context === null ? null : parseAdministrativeClosureContext(v.context), evidenceOperationId = nullableUuid(v.evidenceOperationId), currentEntry = v.currentEntry === null ? null : parseAdministrativeClosureEntry(v.currentEntry), closure = v.closure === null ? null : parseAdministrativeClosureBoundary(v.closure);
  const caps = exact(v.capabilities, ["canRecordUnknown", "canClose", "canDispute", "canRespond"]), capabilities = { canRecordUnknown: bool(caps.canRecordUnknown), canClose: bool(caps.canClose), canDispute: bool(caps.canDispute), canRespond: bool(caps.canRespond) };
  if (!Array.isArray(v.blockers) || v.blockers.length > ADMINISTRATIVE_CLOSURE_BLOCKERS.length || new Set(v.blockers).size !== v.blockers.length || v.blockers.some(b => !ADMINISTRATIVE_CLOSURE_BLOCKERS.includes(b))) fail(); const blockers = [...v.blockers] as AdministrativeClosureBlocker[];
  if ((frame === null) !== (context === null) || (summary === null) !== (currentEntry === null)) fail();
  if (frame && (frame.tailOccurredAt > at || summary && !summaryScope(summary, frame))) fail();
  if (summary && (summary.updatedAt > at || currentEntry!.startEventId !== summary.startEventId || currentEntry!.revision !== summary.revision || currentEntry!.recordedAt !== summary.updatedAt)) fail();
  if (currentEntry?.frame && (!summary || !summaryScope(summary, currentEntry.frame) || frame && !administrativeClosureSameCase(frame, currentEntry.frame))) fail();
  if (summary?.state === "closed") { if (!closure || closure.siteId !== q.siteId || !summaryScope(summary, closure) || closure.operationId !== summary.closedOperationId || closure.verifiedEndAt !== summary.verifiedEndAt || closure.revision > summary.revision || closure.recordedAt > summary.updatedAt || frame && !administrativeClosureSameCase(frame, closure)) fail(); }
  else if (closure !== null) fail();
  if (currentEntry?.action === "close" && (!closure || currentEntry.operationId !== closure.operationId || currentEntry.revision !== closure.revision || currentEntry.recordedAt !== closure.recordedAt || currentEntry.verifiedEndAt !== closure.verifiedEndAt || !same(currentEntry.frame, pick(closure, FRAME_KEYS)) || currentEntry.context?.sourceFingerprint !== closure.sourceFingerprint)) fail();
  if (currentEntry?.action === "record_unknown" && summary?.state !== "pending" || currentEntry?.action === "self_dispute" && !summary?.hasDispute || currentEntry?.action === "owner_respond" && !summary?.hasDispute) fail();
  if (q.mode === "candidate") {
    if (evidenceOperationId !== null || capabilities.canDispute || capabilities.canRespond || frame && frame.workerId !== q.workerId || summary && summary.identity.workerId !== q.workerId) fail();
    if (!frame && (!blockers.length || capabilities.canRecordUnknown || capabilities.canClose)) fail();
  } else {
    if (!summary || !frame || !context || !evidenceOperationId || summary.startEventId !== q.startEventId || capabilities.canRecordUnknown || capabilities.canClose) fail();
    if (currentEntry!.frame && (evidenceOperationId !== currentEntry!.operationId || !same(frame, currentEntry!.frame) || !same(context, currentEntry!.context))) fail();
    if (!currentEntry!.frame && evidenceOperationId === currentEntry!.operationId) fail();
    if (closure && (evidenceOperationId !== closure.operationId || !same(frame, pick(closure, FRAME_KEYS)) || context.sourceFingerprint !== closure.sourceFingerprint)) fail();
  }
  if (q.access === "self" ? !frame || frame.employeeAuthUserId !== actor || capabilities.canRespond || capabilities.canRecordUnknown || capabilities.canClose : capabilities.canDispute) fail();
  if (currentEntry?.actorAccess === "self" && summary && currentEntry.actorId !== summary.identity.employeeAuthUserId) fail();
  if (capabilities.canRespond && !summary?.hasDispute || capabilities.canDispute && !summary || (capabilities.canClose || capabilities.canRecordUnknown) && (blockers.length > 0 || summary?.state === "closed") || summary?.revision === MAX && Object.values(capabilities).some(Boolean)) fail();
  return freeze({ summary, frame, context, evidenceOperationId, currentEntry, closure, capabilities, blockers });
}
function array(raw: unknown): unknown[] { if (!Array.isArray(raw) || raw.length > 25) fail(); return raw; }
function page(ids: string[], next: string | null, after: string | null) { if (ids.some((id, i) => id <= (i ? ids[i - 1] : after ?? "")) || next !== null && (ids.length !== 25 || next !== ids.at(-1))) fail(); }
async function checkEntryFingerprint(e: AdministrativeClosureEntry, siteId: string) {
  // self_dispute's expectedClosedOperationId lives in its saved command, not
  // this compact history DTO. Never pretend its opaque hash was recomputed.
  if (e.action === "self_dispute") return;
  const common = { operationId: e.operationId, startEventId: e.startEventId, expectedRevision: e.revision - 1, reason: e.reason };
  const c: AdministrativeClosureCommand = e.action === "owner_respond" ? { ...common, action: "owner_respond", disputeOperationId: e.disputeOperationId! } : e.action === "close" ? { ...common, action: "close", workerId: e.frame!.workerId, expectedSourceFingerprint: e.context!.sourceFingerprint, verifiedEndAt: e.verifiedEndAt! } : { ...common, action: "record_unknown", workerId: e.frame!.workerId, expectedSourceFingerprint: e.context!.sourceFingerprint, verifiedEndAt: null };
  if (e.commandFingerprint !== await administrativeClosureCommandFingerprint(siteId, e.actorId, e.actorAccess, c)) invalid();
}
export async function parseAdministrativeClosureResult(raw: unknown, rawQuery: AdministrativeClosureQuery, actorId: string, rawCommand: AdministrativeClosureCommand | null = null): Promise<AdministrativeClosureResult> {
  try {
    const owned = snapshot(raw, ADMINISTRATIVE_CLOSURE_RESPONSE_LIMIT), q = parseAdministrativeClosureQuery(rawQuery), actor = uuid(actorId), c = rawCommand === null ? null : parseAdministrativeClosureCommand(rawCommand); if (c) bind(q, c, true);
    const r = exact(owned, ["protocol", "siteId", "access", "actorId", "readAt", "data"]); if (r.protocol !== ADMINISTRATIVE_CLOSURE_PROTOCOL || r.siteId !== q.siteId || r.access !== q.access || r.actorId !== actor) invalid(); const at = instant(r.readAt);
    let data: AdministrativeClosureData; const entries: AdministrativeClosureEntry[] = [];
    if (q.mode === "recover" || c) {
      const d = exact(r.data, ["kind", "receipt"]); if (d.kind !== "receipt") invalid(); const receipt = d.receipt === null ? null : parseAdministrativeClosureReceipt(d.receipt);
      if (q.mode !== "recover" && !receipt || receipt && (receipt.actorId !== actor || receipt.recordedAt > at || receipt.operationId !== (q.mode === "recover" ? q.operationId : c!.operationId) || (receipt.action === "self_dispute" ? "self" : "owner") !== q.access)) invalid();
      if (receipt && c && !administrativeClosureReceiptMatches(receipt, c, actor, await administrativeClosureCommandFingerprint(q.siteId, actor, q.access, c))) invalid();
      data = { kind: "receipt", receipt };
    } else if (q.mode === "workers") {
      const d = exact(r.data, ["kind", "items", "nextAfterId"]); if (d.kind !== "workers") invalid();
      const items = array(d.items).map(rawItem => { const v = exact(rawItem, ["workerId", "employeeId", "employeeAuthUserId", "workerNo", "displayName", "paused"]); const employeeId = nullableUuid(v.employeeId), employeeAuthUserId = nullableUuid(v.employeeAuthUserId); if (employeeId === null && employeeAuthUserId !== null) fail(); return { workerId: uuid(v.workerId), employeeId, employeeAuthUserId, workerNo: label(v.workerNo, 40), displayName: label(v.displayName, 120), paused: bool(v.paused) }; });
      const nextAfterId = nullableUuid(d.nextAfterId); page(items.map(i => i.workerId), nextAfterId, q.afterId); data = { kind: "workers", items, nextAfterId };
    } else if (q.mode === "list") {
      const d = exact(r.data, ["kind", "items", "nextAfterId"]); if (d.kind !== "list") invalid(); const items = array(d.items).map(parseAdministrativeClosureSummary), nextAfterId = nullableUuid(d.nextAfterId);
      if (items.some(i => i.updatedAt > at || q.access === "self" && i.identity.employeeAuthUserId !== actor)) invalid(); page(items.map(i => i.startEventId), nextAfterId, q.afterId); data = { kind: "list", items, nextAfterId };
    } else if (q.mode === "history") {
      const d = exact(r.data, ["kind", "startEventId", "items", "nextBeforeRevision"]); if (d.kind !== "history" || d.startEventId !== q.startEventId) invalid(); const items = array(d.items).map(parseAdministrativeClosureEntry), nextBeforeRevision = d.nextBeforeRevision === null ? null : integer(d.nextBeforeRevision, 2);
      const seen = new Set<string>(); let scope: AdministrativeClosureFrame | null = null;
      for (let i = 0; i < items.length; i++) { const item = items[i]; if (item.startEventId !== q.startEventId || item.recordedAt > at || seen.has(item.operationId) || i > 0 && (item.revision !== items[i - 1].revision - 1 || item.recordedAt > items[i - 1].recordedAt) || q.access === "self" && (item.actorAccess === "self" && item.actorId !== actor || item.frame && item.frame.employeeAuthUserId !== actor)) invalid(); seen.add(item.operationId); if (item.frame) { if (scope && !administrativeClosureSameCase(scope, item.frame)) invalid(); scope = item.frame; } }
      const closes = items.filter(i => i.action === "close"); if (closes.length > 1 || closes.length === 1 && items.some(i => i.action === "record_unknown" && i.revision > closes[0].revision) || scope && items.some(i => i.actorAccess === "self" && i.actorId !== scope!.employeeAuthUserId)) invalid();
      if (q.beforeRevision !== null && (items.length !== Math.min(25, q.beforeRevision - 1) || items.length > 0 && items[0].revision !== q.beforeRevision - 1)) invalid();
      if (items.length && items.at(-1)!.revision > 1 ? items.length !== 25 || nextBeforeRevision !== items.at(-1)!.revision : nextBeforeRevision !== null) invalid();
      entries.push(...items); data = { kind: "history", startEventId: q.startEventId, items, nextBeforeRevision };
    } else {
      const d = exact(r.data, ["kind", "detail"]); if (d.kind !== q.mode) invalid(); const detail = parseDetail(d.detail, q, actor, at); if (detail.currentEntry) entries.push(detail.currentEntry); data = { kind: q.mode, detail };
    }
    for (const entry of entries) await checkEntryFingerprint(entry, q.siteId);
    return freeze({ protocol: ADMINISTRATIVE_CLOSURE_PROTOCOL, siteId: q.siteId, access: q.access, actorId: actor, readAt: at, data });
  } catch { return invalid(); }
}
export async function parseAdministrativeClosureResponse(raw: unknown, query: AdministrativeClosureQuery, actorId: string, command: AdministrativeClosureCommand | null = null): Promise<AdministrativeClosureResponse> {
  try { const owned = snapshot(raw, ADMINISTRATIVE_CLOSURE_RESPONSE_LIMIT), ok = tag(owned, "ok"); if (ok === true) { const r = exact(owned, ["ok", "data"]); return freeze({ ok: true, data: await parseAdministrativeClosureResult(r.data, query, actorId, command) }); }
    const r = exact(owned, ["ok", "error"]), e = exact(r.error, ["code", "message"]); if (r.ok !== false || typeof e.code !== "string" || !Object.hasOwn(ADMINISTRATIVE_CLOSURE_ERRORS, e.code)) invalid(); return freeze({ ok: false, error: { code: e.code as AdministrativeClosureError, message: label(e.message, 500) } });
  } catch { return invalid(); }
}
