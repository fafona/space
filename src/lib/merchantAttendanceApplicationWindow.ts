// 194: application-window transport. Existing application parsers retain their
// original business semantics. A digest is consistency evidence, not authority.
import { MerchantAttendanceError, attendanceDayUtcRange, attendanceLocalDate, attendanceTimeZone } from "./merchantAttendanceTime";
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { CORRECTION_ERRORS, parseCorrectionCommand, parseCorrectionResult, type CorrectionCommand, type CorrectionProposal, type CorrectionResult } from "./merchantAttendanceCorrection";
import { parseRevisionCycleCommand, parseRevisionCycleResult, type RevisionCycleCommand, type RevisionCycleResult } from "./merchantAttendanceRevisionCycle";
import { REVISION_CYCLE_ERRORS } from "./merchantAttendanceRevisionCycleResponse";
import { MISSING_ERRORS, parseMissingBody, parseMissingResult, type MissingCommand, type MissingQuery, type MissingResult } from "./merchantAttendanceMissing";
import { operationalRuleLedgerEncode, operationalRuleLedgerFreeze as freeze } from "./merchantAttendanceOperationalRuleLedger";
import { resolveOperationalRuleSource, operationalRuleSourceTuple, type OperationalRuleSource, type OperationalRuleSourceBaseline } from "./merchantAttendanceOperationalRuleSource";

export const APPLICATION_WINDOW_PROTOCOL = "attendance-application-window-v1" as const;
export const APPLICATION_WINDOW_BODY_LIMIT = 16384, APPLICATION_WINDOW_QUERY_LIMIT = 4096;
export const APPLICATION_WINDOW_RESPONSE_LIMIT = 262144, APPLICATION_WINDOW_RAW_LIMIT = 524288;
export const APPLICATION_WINDOW_FAMILIES = Object.freeze(["correction", "correction_revision", "missing", "missing_revision"] as const);
export type ApplicationWindowFamily = typeof APPLICATION_WINDOW_FAMILIES[number];
type Common = Readonly<{ siteId: string; family: ApplicationWindowFamily }>;
export type ApplicationWindowQuery = Common & (
  | Readonly<{ mode: "prepare"; family: "correction"; workerId: string; startEventId: string }>
  | Readonly<{ mode: "prepare"; family: "correction_revision"; workerId: string; baseRequestId: string }>
  | Readonly<{ mode: "prepare"; family: "missing" | "missing_revision"; workerId: string; fromDate: string; throughDate: string; proposedStartAt: string; supersedesRequestId: string | null }>
  | Readonly<{ mode: "detail"; workerId: string; requestId: string }>
  | Readonly<{ mode: "recover"; operationId: string }>);
export type ApplicationWindowOldCommand = (Extract<CorrectionCommand, { action: "submit" }> & { expectedPolicyRevision: number })
  | Extract<RevisionCycleCommand, { action: "submit" }> | Extract<MissingCommand, { action: "submit" | "revise" }>;
export type ApplicationWindowCommand = Readonly<{ command: ApplicationWindowOldCommand; expectedWindowFingerprint: string }>;
export type ApplicationWindow = Readonly<{ workerId: string; employeeId: string; employeeAuthUserId: string; observedAt: string; activationRevision: number;
  sourceFingerprint: string; windowFingerprint: string; baselinePolicy: OperationalRuleSourceBaseline; selectedDays: number | null; anchorAt: string;
  rootRequestId: string | null; rootDeadlineAt: string | null; baselineDeadlineAt: string; operationalDeadlineAt: string | null; effectiveDeadlineAt: string }>;
export type ApplicationWindowReceipt = Readonly<{ operationId: string; requestId: string; family: ApplicationWindowFamily; workerId: string; employeeId: string;
  employeeAuthUserId: string; actorId: string; recordedAt: string; commandFingerprint: string; windowFingerprint: string; effectiveDeadlineAt: string }>;
export type ApplicationWindowApplication = CorrectionResult | RevisionCycleResult | MissingResult;
export type ApplicationWindowResult = Readonly<{ protocol: typeof APPLICATION_WINDOW_PROTOCOL; siteId: string; actorId: string; family: ApplicationWindowFamily;
  mode: "prepare" | "detail" | "receipt" | "recover"; readAt: string; canSubmit: boolean; application: ApplicationWindowApplication | null;
  window: ApplicationWindow | null; receipt: ApplicationWindowReceipt | null }>;
export type ApplicationWindowParseInput = Readonly<{ query: ApplicationWindowQuery; authUserId: string; command: ApplicationWindowCommand | null; allowWrite?: boolean }>;
export const APPLICATION_WINDOW_ERRORS: Readonly<Record<string, number>> = Object.freeze({ attendance_application_window_invalid: 503,
  attendance_application_window_changed: 409, attendance_application_window_protocol_required: 409, attendance_application_window_disabled: 403,
  attendance_application_window_expired: 409, attendance_application_window_too_large: 422, attendance_application_window_not_found: 404 });
export function applicationWindowErrors(family: ApplicationWindowFamily): Readonly<Record<string, number>> {
  return { ...(family === "correction" ? CORRECTION_ERRORS : family === "correction_revision" ? REVISION_CYCLE_ERRORS : MISSING_ERRORS), ...APPLICATION_WINDOW_ERRORS };
}
function fail(code = "attendance_invalid_request"): never { throw new MerchantAttendanceError(code); }
function exact(raw: unknown, keys: readonly string[]) { try { return captureBrowserExact(raw, keys); } catch { return fail(); } }
const uuid = (v: unknown): string => typeof v === "string" && v.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v) ? v : fail();
const site = (v: unknown): string => typeof v === "string" && v.length === 8 && /^[0-9]{8}$/.test(v) ? v : fail();
const hash = (v: unknown): string => typeof v === "string" && v.length === 64 && /^[0-9a-f]{64}$/.test(v) ? v : fail();
const integer = (v: unknown, min = 0, max = 9007199254740990): number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min && v <= max ? v : fail();
function family(v: unknown): ApplicationWindowFamily { return typeof v === "string" && APPLICATION_WINDOW_FAMILIES.includes(v as ApplicationWindowFamily) ? v as ApplicationWindowFamily : fail(); }
function stamp(v: unknown): string { if (typeof v !== "string" || v.length !== 27 || !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(v)) fail();
  const short = v.slice(0, 23) + "Z"; if (!Number.isFinite(Date.parse(short)) || new Date(short).toISOString() !== short) fail(); return v; }
function day(v: unknown): string { if (typeof v !== "string" || v.length !== 10 || v < "2000-01-01" || v > "2100-12-31") fail(); stamp(v + "T00:00:00.000000Z"); return v; }
function unicode(s: string) { if (s.includes("\0")) fail(); for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i);
  if (c >= 0xd800 && c <= 0xdbff) { const n = s.charCodeAt(++i); if (!(n >= 0xdc00 && n <= 0xdfff)) fail(); } else if (c >= 0xdc00 && c <= 0xdfff) fail(); } }
function tree(raw: unknown, limit: number) { let nodes = 0; const seen = new Set<object>(); const walk = (v: unknown, depth: number): void => {
  if (++nodes > 50000 || depth > 32) fail(); if (v === null || typeof v === "boolean") return;
  if (typeof v === "string") { if (v.length > limit) fail("attendance_application_window_too_large"); unicode(v); return; }
  if (typeof v === "number") { if (!Number.isSafeInteger(v) || Object.is(v, -0)) fail(); return; }
  if (typeof v !== "object" || seen.has(v)) fail(); seen.add(v); const a = Array.isArray(v), keys = Reflect.ownKeys(v), proto = Object.getPrototypeOf(v);
  if (a ? proto !== Array.prototype || v.length > 202 || keys.length !== v.length + 1 : proto !== Object.prototype && proto !== null) fail();
  for (const key of keys) { if (typeof key !== "string" || key.length > limit) fail(); unicode(key); if (a && key === "length") continue;
    if (["__proto__", "constructor", "prototype"].includes(key) || a && !/^(0|[1-9][0-9]*)$/.test(key)) fail();
    const d = Object.getOwnPropertyDescriptor(v, key)!; if (!("value" in d) || !d.enumerable) fail();
    if (typeof d.value === "string" && (key === "id" || key.endsWith("Id"))) { if (key === "siteId") site(d.value); else uuid(d.value); } walk(d.value, depth + 1); }
  if (a) for (let i = 0; i < v.length; i++) if (!Object.hasOwn(v, String(i))) fail(); seen.delete(v);
  }; walk(raw, 0); if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > limit) fail("attendance_application_window_too_large"); }
export function parseApplicationWindowJson(text: string, purpose: "request" | "response" | "raw" = "response"): unknown {
  const limit = purpose === "request" ? APPLICATION_WINDOW_BODY_LIMIT : purpose === "raw" ? APPLICATION_WINDOW_RAW_LIMIT : APPLICATION_WINDOW_RESPONSE_LIMIT;
  try { if (typeof text !== "string" || text.length > limit || new TextEncoder().encode(text).byteLength > limit) fail("attendance_application_window_too_large"); unicode(text);
    const raw = parseCaptureBrowserJson(text); tree(raw, limit); return raw;
  } catch (e) { if (e instanceof MerchantAttendanceError && e.code === "attendance_application_window_too_large") throw e; return fail(purpose === "request" ? "attendance_invalid_request" : "attendance_application_window_invalid"); }
}
export function parseApplicationWindowQuery(raw: unknown): ApplicationWindowQuery {
  tree(raw, APPLICATION_WINDOW_QUERY_LIMIT); if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(); const v = raw as Record<string, unknown>, common = { siteId: site(v.siteId), family: family(v.family) };
  if (v.mode === "recover") { exact(v, ["siteId", "family", "mode", "operationId"]); return freeze({ ...common, mode: "recover", operationId: uuid(v.operationId) }); }
  if (v.mode === "detail") { exact(v, ["siteId", "family", "mode", "workerId", "requestId"]); return freeze({ ...common, mode: "detail", workerId: uuid(v.workerId), requestId: uuid(v.requestId) }); }
  if (v.mode !== "prepare") fail(); const workerId = uuid(v.workerId);
  if (common.family === "correction") { exact(v, ["siteId", "family", "mode", "workerId", "startEventId"]); return freeze({ ...common, family: common.family, mode: "prepare", workerId, startEventId: uuid(v.startEventId) }); }
  if (common.family === "correction_revision") { exact(v, ["siteId", "family", "mode", "workerId", "baseRequestId"]); return freeze({ ...common, family: common.family, mode: "prepare", workerId, baseRequestId: uuid(v.baseRequestId) }); }
  exact(v, ["siteId", "family", "mode", "workerId", "fromDate", "throughDate", "proposedStartAt", "supersedesRequestId"]);
  const fromDate = day(v.fromDate), throughDate = day(v.throughDate), proposedStartAt = stamp(v.proposedStartAt), supersedesRequestId = v.supersedesRequestId === null ? null : uuid(v.supersedesRequestId);
  if ((Date.parse(throughDate) - Date.parse(fromDate)) / 86400000 < 0 || (Date.parse(throughDate) - Date.parse(fromDate)) / 86400000 > 30 || (common.family === "missing") !== (supersedesRequestId === null)) fail();
  return freeze({ ...common, family: common.family, mode: "prepare", workerId, fromDate, throughDate, proposedStartAt, supersedesRequestId });
}
export function applicationWindowQueryString(input: ApplicationWindowQuery): string { const q = parseApplicationWindowQuery(input), p = new URLSearchParams(); Object.entries(q).forEach(([k, v]) => p.set(k, v === null ? "null" : String(v))); return p.toString(); }
export function parseApplicationWindowHttpQuery(url: string): ApplicationWindowQuery { const search = new URL(url).search;
  if (new TextEncoder().encode(search).byteLength > APPLICATION_WINDOW_QUERY_LIMIT) fail("attendance_application_window_too_large"); const p = new URLSearchParams(search), result: Record<string, unknown> = {};
  for (const [key, value] of p) { if (p.getAll(key).length !== 1 || ["__proto__", "constructor", "prototype"].includes(key)) fail(); result[key] = value === "null" ? null : value; }
  return parseApplicationWindowQuery(result); }
function missingQuery(q: Extract<ApplicationWindowQuery, { mode: "prepare" }>, requestId: string | null): MissingQuery {
  if (q.family !== "missing" && q.family !== "missing_revision") fail(); return { siteId: q.siteId, access: "self", fromDate: q.fromDate, throughDate: q.throughDate, requestId, operationId: null, beforeAt: null, beforeId: null };
}
export function parseApplicationWindowCommand(raw: unknown, input: ApplicationWindowQuery): ApplicationWindowCommand {
  tree(raw, APPLICATION_WINDOW_BODY_LIMIT); const q = parseApplicationWindowQuery(input); if (q.mode !== "prepare") fail();
  const c = exact(raw, ["command", "expectedWindowFingerprint"]), old = c.command as Record<string, unknown>; let command: ApplicationWindowOldCommand;
  if (q.family === "correction") { const parsed = parseCorrectionCommand({ ...(old ?? {}), siteId: q.siteId, expectedWorkerId: q.workerId }).command;
    if (parsed.action !== "submit" || parsed.expectedPolicyRevision === undefined || parsed.startEventId !== q.startEventId || Object.hasOwn(old, "siteId") || Object.hasOwn(old, "expectedWorkerId")) fail();
    command = { ...parsed, expectedPolicyRevision: parsed.expectedPolicyRevision };
  } else if (q.family === "correction_revision") { const parsed = parseRevisionCycleCommand(old); if (parsed.action !== "submit") fail(); command = parsed;
  } else { const parsed = parseMissingBody({ query: missingQuery(q, null), command: old }).command;
    if (parsed.action !== (q.family === "missing" ? "submit" : "revise") || !("proposal" in parsed) || parsed.expectedWorkerId !== q.workerId || parsed.proposal.startAt !== q.proposedStartAt
      || parsed.action === "revise" && parsed.supersedesRequestId !== q.supersedesRequestId) fail(); command = parsed;
  }
  return freeze({ command, expectedWindowFingerprint: hash(c.expectedWindowFingerprint) });
}
export function parseApplicationWindowBody(raw: unknown): { query: ApplicationWindowQuery; command: ApplicationWindowCommand } {
  tree(raw, APPLICATION_WINDOW_BODY_LIMIT); const v = exact(raw, ["query", "command"]), query = parseApplicationWindowQuery(v.query); return freeze({ query, command: parseApplicationWindowCommand(v.command, query) });
}
const proposalTuple = (p: CorrectionProposal) => [p.startAt, p.endAt, p.breaks.map(b => [b.startAt, b.endAt, b.paid])];
export async function applicationWindowCommandFingerprint(query: ApplicationWindowQuery, input: ApplicationWindowCommand, actor: string): Promise<string> {
  const q = parseApplicationWindowQuery(query), { command: c, expectedWindowFingerprint } = parseApplicationWindowCommand(input, q), actorId = uuid(actor); if (q.mode !== "prepare") fail();
  const qt = q.family === "correction" ? [q.siteId, q.mode, q.family, q.workerId, q.startEventId] : q.family === "correction_revision" ? [q.siteId, q.mode, q.family, q.workerId, q.baseRequestId]
    : [q.siteId, q.mode, q.family, q.workerId, q.fromDate, q.throughDate, q.proposedStartAt, q.supersedesRequestId];
  const ct = "startEventId" in c ? [c.action, c.operationId, c.expectedRevision, c.reason, c.startEventId, c.expectedLastEventId, c.expectedPolicyRevision, proposalTuple(c.proposal)]
    : "expectedBaseOperationId" in c ? [c.action, c.operationId, c.expectedRevision, c.reason, c.expectedBaseOperationId, c.expectedPolicyRevision, c.expectedEffectiveOperationId, proposalTuple(c.proposal)]
    : [c.action, c.operationId, c.reason, c.expectedWorkerId, c.expectedSettingsVersion, c.expectedPolicyRevision, c.locationId, c.timeZone, proposalTuple(c.proposal), c.action === "revise" ? c.supersedesRequestId : null, c.action === "revise" ? c.expectedApprovalOperationId : null];
  return digest(["attendance-application-window-command-v1", actorId, qt, ct, expectedWindowFingerprint]);
}
async function digest(tuple: Parameters<typeof operationalRuleLedgerEncode>[0]): Promise<string> { const bytes = new TextEncoder().encode(operationalRuleLedgerEncode(tuple));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join(""); }
/** Matches existing control-day boundaries: a skipped civil date advances to
 * its first real successor. No N*24-hour replacement for local natural days. */
// As in the existing CorrectionRules parser, Node does not recompute a
// deadline whose civil date is beyond its 2100 day-boundary horizon. SQL still
// computes the exact boundary; strict UTC6/min/source/baseline checks remain.
export function applicationWindowDeadline(anchor: string, days: number, zone: string): string | null {
  const at = stamp(anchor), count = integer(days, 0, 365), timeZone = attendanceTimeZone(zone), civil = attendanceLocalDate(at.slice(0, 23) + "Z", timeZone);
  day(civil); const target = new Date(civil + "T12:00:00.000Z"); target.setUTCDate(target.getUTCDate() + count + 1);
  if (target.getUTCFullYear() > 2100) return null;
  for (let i = 0; i < 4; i++) { try { const result = attendanceDayUtcRange(target.toISOString().slice(0, 10), timeZone).startAt; return result.slice(0, -1) + "000Z"; }
    catch (e) { if (!(e instanceof MerchantAttendanceError) || e.code !== "attendance_local_date_does_not_exist") throw e; target.setUTCDate(target.getUTCDate() + 1); } } return fail();
}
function parseWindow(raw: unknown): ApplicationWindow { const w = exact(raw, ["workerId", "employeeId", "employeeAuthUserId", "observedAt", "activationRevision", "sourceFingerprint", "windowFingerprint", "baselinePolicy", "selectedDays", "anchorAt", "rootRequestId", "rootDeadlineAt", "baselineDeadlineAt", "operationalDeadlineAt", "effectiveDeadlineAt"]);
  const b = exact(w.baselinePolicy, ["operationId", "revision", "recordedAt", "submissionWindowDays", "timeZone"]), baselinePolicy = { operationId: uuid(b.operationId), revision: integer(b.revision, 1), recordedAt: stamp(b.recordedAt), submissionWindowDays: integer(b.submissionWindowDays, 0, 365), timeZone: attendanceTimeZone(b.timeZone as string) };
  const result: ApplicationWindow = { workerId: uuid(w.workerId), employeeId: uuid(w.employeeId), employeeAuthUserId: uuid(w.employeeAuthUserId), observedAt: stamp(w.observedAt), activationRevision: integer(w.activationRevision), sourceFingerprint: hash(w.sourceFingerprint), windowFingerprint: hash(w.windowFingerprint), baselinePolicy,
    selectedDays: w.selectedDays === null ? null : integer(w.selectedDays, 0, 365), anchorAt: stamp(w.anchorAt), rootRequestId: w.rootRequestId === null ? null : uuid(w.rootRequestId), rootDeadlineAt: w.rootDeadlineAt === null ? null : stamp(w.rootDeadlineAt),
    baselineDeadlineAt: stamp(w.baselineDeadlineAt), operationalDeadlineAt: w.operationalDeadlineAt === null ? null : stamp(w.operationalDeadlineAt), effectiveDeadlineAt: stamp(w.effectiveDeadlineAt) };
  const baselineExpected = applicationWindowDeadline(result.anchorAt, baselinePolicy.submissionWindowDays, baselinePolicy.timeZone);
  const operationalExpected = result.selectedDays === null ? null : applicationWindowDeadline(result.anchorAt, result.selectedDays, baselinePolicy.timeZone);
  if (baselinePolicy.recordedAt > result.observedAt || result.anchorAt > result.observedAt || result.rootRequestId === null && result.rootDeadlineAt !== null
    || (result.selectedDays === null) !== (result.operationalDeadlineAt === null)
    || baselineExpected !== null && result.baselineDeadlineAt !== baselineExpected
    || operationalExpected !== null && result.operationalDeadlineAt !== operationalExpected
    || result.effectiveDeadlineAt !== [result.baselineDeadlineAt, result.operationalDeadlineAt, result.rootDeadlineAt].filter((x): x is string => x !== null).sort()[0]) fail();
  return result;
}
function application(raw: unknown, q: Exclude<ApplicationWindowQuery, { mode: "recover" }>): ApplicationWindowApplication {
  if (q.family === "correction") return parseCorrectionResult(raw, q.mode === "prepare" ? { siteId: q.siteId, expectedWorkerId: q.workerId, mode: "prepare", startEventId: q.startEventId }
    : { siteId: q.siteId, expectedWorkerId: q.workerId, mode: "detail", requestId: q.requestId, operationId: null }, true, true);
  if (q.family === "correction_revision") { const root = q.mode === "prepare" ? q.baseRequestId : uuid((raw as Record<string, unknown>).rootRequestId);
    return parseRevisionCycleResult(raw, { siteId: q.siteId, expectedWorkerId: q.workerId, baseRequestId: root, mode: q.mode, requestId: q.mode === "detail" ? q.requestId : null, operationId: null }); }
  if (q.mode === "prepare") return parseMissingResult(raw, missingQuery(q, q.family === "missing_revision" ? q.supersedesRequestId : null), false);
  const d = (raw as Record<string, unknown>).detail as Record<string, unknown>, submitted = stamp(d.submittedAt).slice(0, 10);
  return parseMissingResult(raw, { siteId: q.siteId, access: "self", fromDate: submitted, throughDate: submitted, requestId: q.requestId, operationId: null, beforeAt: null, beforeId: null }, false);
}
function baselineMatches(a: OperationalRuleSourceBaseline, b: OperationalRuleSourceBaseline | null) { return b !== null && Object.keys(a).every(k => a[k as keyof typeof a] === b[k as keyof typeof b]); }
export async function applicationWindowFingerprint(f: ApplicationWindowFamily, window: ApplicationWindow, source: OperationalRuleSource): Promise<string> {
  const tuple = operationalRuleSourceTuple(source), t0 = [...tuple.slice(0, 3), ...tuple.slice(4)];
  return digest([APPLICATION_WINDOW_PROTOCOL, f, window.activationRevision, t0, window.anchorAt, window.rootRequestId, window.rootDeadlineAt, window.selectedDays, window.baselineDeadlineAt, window.operationalDeadlineAt, window.effectiveDeadlineAt]);
}
export async function parseApplicationWindowResult(raw: unknown, input: ApplicationWindowParseInput): Promise<ApplicationWindowResult> {
  try { tree(raw, APPLICATION_WINDOW_RESPONSE_LIMIT); const snapshot = structuredClone(raw), q = parseApplicationWindowQuery(input.query), actorId = uuid(input.authUserId), command = input.command === null ? null : parseApplicationWindowCommand(input.command, q);
    const r = exact(snapshot, ["protocol", "siteId", "actorId", "family", "mode", "readAt", "canSubmit", "application", "window", "receipt"]), readAt = stamp(r.readAt);
    if (r.protocol !== APPLICATION_WINDOW_PROTOCOL || r.siteId !== q.siteId || r.actorId !== actorId || r.family !== q.family || typeof r.canSubmit !== "boolean" || r.mode !== (command ? "receipt" : q.mode)) fail();
    let app: ApplicationWindowApplication | null = null, window: ApplicationWindow | null = null, receipt: ApplicationWindowReceipt | null = null;
    if (r.mode === "prepare" || r.mode === "detail") { if (q.mode === "recover" || r.application === null || r.receipt !== null || r.mode === "detail" && r.canSubmit) fail(); app = application(r.application, q);
      if (app.workerId !== q.workerId || app.asOf > readAt || "receipt" in app && app.receipt !== null) fail();
      if (r.window !== null) { window = parseWindow(r.window); if (window.workerId !== q.workerId || window.employeeId !== app.employeeId || window.employeeAuthUserId !== actorId || window.observedAt > readAt) fail();
        const anchor = "basis" in app ? app.basis.events[0].occurredAt : q.mode === "prepare" && (q.family === "missing" || q.family === "missing_revision") ? q.proposedStartAt : "detail" in app ? app.detail!.proposal.startAt : fail();
        if (window.anchorAt !== anchor) fail();
        if (q.mode === "detail") { const submitted = "item" in app ? app.item!.submittedAt : "detail" in app ? app.detail!.submittedAt : fail(); if (window.activationRevision < 1 || window.observedAt !== submitted) fail(); }
        if (q.family === "correction" || q.family === "missing") { if (window.rootRequestId !== null || window.rootDeadlineAt !== null) fail(); }
        if (q.family === "correction_revision" && (!("rootRequestId" in app) || window.rootRequestId !== app.rootRequestId)) fail();
        if (q.family === "missing_revision" && (!("detail" in app) || !app.detail?.lineage || window.rootRequestId !== app.detail.lineage.rootRequestId || window.rootDeadlineAt === null)) fail();
      } else if (q.mode === "prepare") fail();
      const oldCan = "canRequest" in app ? app.canRequest : app.canSubmit;
      if (r.canSubmit && (!oldCan || !window || window.activationRevision === 0 || readAt >= window.effectiveDeadlineAt || input.allowWrite === false)) fail();
      if (r.canSubmit && q.mode === "prepare" && q.family === "missing_revision" && (!("detail" in app) || !app.detail || app.detail.status !== "approved"
        || !app.detail.lineage?.canRevise || app.detail.lineage.currentRequestId !== q.supersedesRequestId || !app.detail.lineage.currentApprovalOperationId)) fail();
    } else { if (r.application !== null || r.window !== null || r.canSubmit) fail();
      if (r.receipt !== null) { const v = exact(r.receipt, ["operationId", "requestId", "family", "workerId", "employeeId", "employeeAuthUserId", "actorId", "recordedAt", "commandFingerprint", "windowFingerprint", "effectiveDeadlineAt"]);
        receipt = { operationId: uuid(v.operationId), requestId: uuid(v.requestId), family: family(v.family), workerId: uuid(v.workerId), employeeId: uuid(v.employeeId), employeeAuthUserId: uuid(v.employeeAuthUserId), actorId: uuid(v.actorId), recordedAt: stamp(v.recordedAt), commandFingerprint: hash(v.commandFingerprint), windowFingerprint: hash(v.windowFingerprint), effectiveDeadlineAt: stamp(v.effectiveDeadlineAt) };
        if (receipt.actorId !== actorId || receipt.employeeAuthUserId !== actorId || receipt.family !== q.family || receipt.requestId !== receipt.operationId || receipt.recordedAt > readAt || receipt.recordedAt >= receipt.effectiveDeadlineAt
          || receipt.operationId !== (command?.command.operationId ?? (q.mode === "recover" ? q.operationId : null)) || q.mode !== "recover" && receipt.workerId !== q.workerId) fail();
        if (command && (receipt.windowFingerprint !== command.expectedWindowFingerprint || receipt.commandFingerprint !== await applicationWindowCommandFingerprint(q, command, actorId))) fail();
      } else if (command) fail();
    }
    return freeze({ protocol: APPLICATION_WINDOW_PROTOCOL, siteId: q.siteId, actorId, family: q.family, mode: r.mode as ApplicationWindowResult["mode"], readAt, canSubmit: r.canSubmit, application: app, window, receipt });
  } catch (e) { if (e instanceof MerchantAttendanceError && e.code === "attendance_application_window_too_large") throw e; return fail("attendance_application_window_invalid"); }
}
export async function parseApplicationWindowRpcResult(raw: unknown, input: ApplicationWindowParseInput): Promise<ApplicationWindowResult> {
  try { tree(raw, APPLICATION_WINDOW_RAW_LIMIT); const snapshot = structuredClone(raw), envelope = exact(snapshot, ["result", "source"]), result = await parseApplicationWindowResult(envelope.result, input);
    if (result.window === null) { if (envelope.source !== null) fail(); }
    else { const w = result.window, projection = await resolveOperationalRuleSource(envelope.source, { siteId: result.siteId, workerId: w.workerId, employeeId: w.employeeId, employeeAuthUserId: w.employeeAuthUserId, at: w.observedAt });
      const selected = projection.candidate.fields.correctionWindow, days = selected.state === "value" ? selected.value!.days : null;
      if (w.sourceFingerprint !== projection.source.sourceFingerprint || !baselineMatches(w.baselinePolicy, projection.source.baselineCorrectionPolicyRef) || w.selectedDays !== days
        || w.windowFingerprint !== await applicationWindowFingerprint(result.family, w, projection.source)) fail(); }
    return result;
  } catch (e) { if (e instanceof MerchantAttendanceError && e.code === "attendance_application_window_too_large") throw e; return fail("attendance_application_window_invalid"); }
}
export async function parseApplicationWindowResponse(raw: unknown, input: ApplicationWindowParseInput): Promise<ApplicationWindowResult> {
  tree(raw, APPLICATION_WINDOW_RESPONSE_LIMIT); const v = exact(raw, ["ok", "data"]); if (v.ok !== true) fail("attendance_application_window_invalid"); return parseApplicationWindowResult(v.data, input);
}
