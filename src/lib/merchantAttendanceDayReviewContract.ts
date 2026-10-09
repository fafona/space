// C15-A transport foundation only. These parsers grant no source, calendar,
// worker or approval authority. SQL must collect the full fixed target again.
import { captureBrowserExact as exact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { hash, label, safeTree, site, stamp, uuid } from "./merchantAttendancePlanExceptionValidation";
import { operationalRuleLedgerEncode, operationalRuleLedgerFreeze as freeze } from "./merchantAttendanceOperationalRuleLedger";
import { DAY_CLASSIFICATION_OUTCOMES, type DayClassificationOutcome } from "./merchantAttendanceDayClassification";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

export const DAY_REVIEW_API = "/api/merchant-enterprise/attendance/day-reviews";
export const DAY_REVIEW_PROTOCOL = "attendance-day-review-v1" as const;
export const DAY_REVIEW_REQUEST_LIMIT = 8192, DAY_REVIEW_RESPONSE_LIMIT = 1048576, DAY_REVIEW_PAGE_SIZE = 25;
export type DayReviewAccess = "owner" | "self";
type CaseCursor = Readonly<{ openedAt: string; caseId: string }>;
export type DayReviewQuery = Readonly<{ siteId: string }> & (
  Readonly<{ access: "owner"; mode: "candidates"; workerId: string; workDate: string }>
  | Readonly<{ access: "owner"; mode: "preview"; workerId: string; workDate: string; slotId: string | null; caseId: string | null }>
  | Readonly<{ access: DayReviewAccess; mode: "list"; workerId: string | null; cursor: CaseCursor | null }>
  | Readonly<{ access: DayReviewAccess; mode: "detail"; caseId: string }>
  | Readonly<{ access: DayReviewAccess; mode: "history"; caseId: string; beforeRevision: number | null }>
  | Readonly<{ mode: "recover"; operationId: string }>
);
export type DayReviewCalendarReference = Readonly<{ entryId: string; operationId: string; revision: 1 }>;
export type DayReviewDecideCommand = Readonly<{
  action: "decide"; operationId: string; caseId: string; expectedRevision: number;
  workerId: string; employeeId: string; employeeAuthUserId: string; expectedFingerprint: string;
  outcome: DayClassificationOutcome; calendarReference: DayReviewCalendarReference | null; selfStatementOperationId: string | null; reason: string;
}>;
export type DayReviewSelfCommand = Readonly<{ operationId: string; expectedRevision: number; decisionOperationId: string; reason: string }> & (
  Readonly<{ action: "explain"; claim: "worked_missing_records" | "not_worked" | "uncertain" }>
  | Readonly<{ action: "dispute"; claim: null }>
);
export type DayReviewCommand = DayReviewDecideCommand | DayReviewSelfCommand;
export type DayReviewReceipt = Readonly<{ operationId: string; caseId: string; revision: number; action: DayReviewCommand["action"];
  actorId: string; recordedAt: string; commandFingerprint: string }>;

function invalid(): never { throw new MerchantAttendanceError("attendance_day_review_invalid"); }
function detached(raw: unknown, cap = DAY_REVIEW_REQUEST_LIMIT): unknown { safeTree(raw, cap); return parseCaptureBrowserJson(JSON.stringify(raw)); }
const tag = (raw: unknown, key: string): unknown => raw && typeof raw === "object" ? Object.getOwnPropertyDescriptor(raw, key)?.value : undefined;
function integer(raw: unknown, min: number): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || Object.is(raw, -0) || raw < min || raw > 9007199254740990) invalid(); return raw;
}
function day(raw: unknown): string {
  if (typeof raw !== "string" || raw.length !== 10 || raw < "2000-01-01" || raw > "2100-12-31") invalid();
  stamp(raw + "T00:00:00.000000Z"); return raw;
}
function access(raw: unknown): DayReviewAccess { if (raw !== "owner" && raw !== "self") invalid(); return raw; }
function cursor(raw: unknown): CaseCursor | null {
  if (raw === null) return null; const v = exact(raw, ["openedAt", "caseId"]); return { openedAt: stamp(v.openedAt), caseId: uuid(v.caseId) };
}
export function parseDayReviewQuery(raw: unknown): DayReviewQuery {
  try {
    const source = detached(raw), mode = tag(source, "mode"), siteId = site(tag(source, "siteId"));
    if (mode === "recover") { const q = exact(source, ["siteId", "mode", "operationId"]); return freeze({ siteId, mode, operationId: uuid(q.operationId) }); }
    if (mode === "candidates" || mode === "preview") {
      const q = exact(source, mode === "candidates" ? ["siteId", "access", "mode", "workerId", "workDate"] : ["siteId", "access", "mode", "workerId", "workDate", "slotId", "caseId"]);
      if (q.access !== "owner") invalid(); const workerId = uuid(q.workerId), workDate = day(q.workDate);
      return freeze(mode === "candidates" ? { siteId, access: "owner", mode, workerId, workDate }
        : { siteId, access: "owner", mode, workerId, workDate, slotId: q.slotId === null ? null : uuid(q.slotId), caseId: q.caseId === null ? null : uuid(q.caseId) });
    }
    if (mode === "list") { const q = exact(source, ["siteId", "access", "mode", "workerId", "cursor"]), a = access(q.access), workerId = q.workerId === null ? null : uuid(q.workerId);
      if (a === "self" && workerId !== null) invalid(); return freeze({ siteId, access: a, mode, workerId, cursor: cursor(q.cursor) }); }
    if (mode === "detail") { const q = exact(source, ["siteId", "access", "mode", "caseId"]); return freeze({ siteId, access: access(q.access), mode, caseId: uuid(q.caseId) }); }
    if (mode === "history") { const q = exact(source, ["siteId", "access", "mode", "caseId", "beforeRevision"]);
      return freeze({ siteId, access: access(q.access), mode, caseId: uuid(q.caseId), beforeRevision: q.beforeRevision === null ? null : integer(q.beforeRevision, 1) }); }
    return invalid();
  } catch { return invalid(); }
}
/** Nullable fields are omitted on the wire; cursor components are an atomic pair. */
export function dayReviewQueryString(raw: DayReviewQuery): string {
  const q = parseDayReviewQuery(raw), params = new URLSearchParams();
  for (const [key, value] of Object.entries(q)) {
    if (value === null) continue;
    if (key === "cursor") { const c = value as CaseCursor; params.set("cursorOpenedAt", c.openedAt); params.set("cursorCaseId", c.caseId); }
    else params.set(key, String(value));
  }
  return params.toString();
}
export function parseDayReviewHttpQuery(text: string): DayReviewQuery {
  try {
    if (typeof text !== "string" || text.length > 4096 || /[\u0000-\u0020\u007f#]/.test(text) || /%(?![0-9a-fA-F]{2})/.test(text)) invalid();
    const p = new URL(text).searchParams, mode = p.get("mode");
    const optional = mode === "preview" ? ["slotId", "caseId"] : mode === "list" ? ["workerId", "cursorOpenedAt", "cursorCaseId"] : mode === "history" ? ["beforeRevision"] : [];
    const required = mode === "candidates" || mode === "preview" ? ["siteId", "access", "mode", "workerId", "workDate"]
      : mode === "list" ? ["siteId", "access", "mode"] : mode === "detail" || mode === "history" ? ["siteId", "access", "mode", "caseId"]
        : mode === "recover" ? ["siteId", "mode", "operationId"] : invalid();
    for (const key of p.keys()) if (!required.includes(key) && !optional.includes(key) || p.getAll(key).length !== 1 || !p.get(key)) invalid();
    if (required.some(key => !p.has(key))) invalid();
    const base = Object.fromEntries(required.map(key => [key, p.get(key)]));
    if (mode === "preview") return parseDayReviewQuery({ ...base, slotId: p.get("slotId"), caseId: p.get("caseId") });
    if (mode === "list") {
      if (p.has("cursorOpenedAt") !== p.has("cursorCaseId")) invalid();
      return parseDayReviewQuery({ ...base, workerId: p.get("workerId"), cursor: p.has("cursorCaseId") ? { openedAt: p.get("cursorOpenedAt"), caseId: p.get("cursorCaseId") } : null });
    }
    if (mode === "history") {
      const before = p.get("beforeRevision"); if (before !== null && !/^[1-9][0-9]{0,15}$/.test(before)) invalid();
      return parseDayReviewQuery({ ...base, beforeRevision: before === null ? null : Number(before) });
    }
    return parseDayReviewQuery(base);
  } catch { return invalid(); }
}
export function parseDayReviewJson(text: string, cap = DAY_REVIEW_REQUEST_LIMIT): unknown {
  try {
    if (typeof text !== "string" || text.length > cap || new TextEncoder().encode(text).byteLength > cap) invalid();
    const value = parseCaptureBrowserJson(text); safeTree(value, cap); return value;
  } catch { return invalid(); }
}
export function parseDayReviewCommand(query: DayReviewQuery, raw: unknown): DayReviewCommand {
  try {
    const q = parseDayReviewQuery(query), source = detached(raw), action = tag(source, "action");
    if (action === "decide") {
      const c = exact(source, ["action", "operationId", "caseId", "expectedRevision", "workerId", "employeeId", "employeeAuthUserId", "expectedFingerprint", "outcome", "calendarReference", "selfStatementOperationId", "reason"]);
      if (q.mode !== "preview" || q.access !== "owner" || q.workerId !== c.workerId || q.caseId !== null && q.caseId !== c.caseId) invalid();
      const expectedRevision = integer(c.expectedRevision, 0); if ((q.caseId === null) !== (expectedRevision === 0)) invalid();
      if (typeof c.outcome !== "string" || !DAY_CLASSIFICATION_OUTCOMES.includes(c.outcome as DayClassificationOutcome)) invalid();
      const outcome = c.outcome as DayClassificationOutcome; let calendarReference: DayReviewCalendarReference | null = null;
      if (c.calendarReference !== null) { const r = exact(c.calendarReference, ["entryId", "operationId", "revision"]);
        const entryId = uuid(r.entryId), operationId = uuid(r.operationId); if (r.revision !== 1 || entryId !== operationId) invalid(); calendarReference = { entryId, operationId, revision: 1 }; }
      const selfStatementOperationId = c.selfStatementOperationId === null ? null : uuid(c.selfStatementOperationId);
      if ((outcome === "calendar_exempt") !== (calendarReference !== null) || outcome === "calendar_exempt" && q.slotId === null
        || (outcome === "not_worked_reported") !== (selfStatementOperationId !== null) || outcome === "not_worked_reported" && q.caseId === null) invalid();
      return freeze({ action, operationId: uuid(c.operationId), caseId: uuid(c.caseId), expectedRevision, workerId: uuid(c.workerId), employeeId: uuid(c.employeeId),
        employeeAuthUserId: uuid(c.employeeAuthUserId), expectedFingerprint: hash(c.expectedFingerprint), outcome, calendarReference, selfStatementOperationId, reason: label(c.reason, 1000) });
    }
    if (action !== "explain" && action !== "dispute" || q.mode !== "detail" || q.access !== "self") invalid();
    const c = exact(source, ["action", "operationId", "expectedRevision", "decisionOperationId", "claim", "reason"]);
    const common = { operationId: uuid(c.operationId), expectedRevision: integer(c.expectedRevision, 1), decisionOperationId: uuid(c.decisionOperationId), reason: label(c.reason, 1000) };
    if (action === "dispute") { if (c.claim !== null) invalid(); return freeze({ ...common, action, claim: null }); }
    if (c.claim !== "worked_missing_records" && c.claim !== "not_worked" && c.claim !== "uncertain") invalid();
    return freeze({ ...common, action, claim: c.claim });
  } catch { return invalid(); }
}
export function parseDayReviewBody(raw: unknown) {
  try { const body = exact(detached(raw), ["query", "command"]), query = parseDayReviewQuery(body.query); return freeze({ query, command: parseDayReviewCommand(query, body.command) }); }
  catch { return invalid(); }
}
export function dayReviewCommandFingerprintText(query: DayReviewQuery, actorId: string, rawCommand: DayReviewCommand): string {
  const q = parseDayReviewQuery(query), c = parseDayReviewCommand(q, rawCommand);
  const frame = q.mode === "preview" ? [q.mode, q.access, q.workerId, q.workDate, q.slotId, q.caseId] : q.mode === "detail" ? [q.mode, q.access, q.caseId] : invalid();
  const command = c.action === "decide" ? [c.action, c.operationId, c.caseId, c.expectedRevision, c.workerId, c.employeeId, c.employeeAuthUserId, c.expectedFingerprint, c.outcome,
    c.calendarReference ? [c.calendarReference.entryId, c.calendarReference.operationId, c.calendarReference.revision] : null, c.selfStatementOperationId, c.reason]
    : [c.action, c.operationId, c.expectedRevision, c.decisionOperationId, c.claim, c.reason];
  return operationalRuleLedgerEncode(["attendance-day-review-command-v1", q.siteId, uuid(actorId), frame, command]);
}
export async function dayReviewCommandFingerprint(query: DayReviewQuery, actorId: string, command: DayReviewCommand): Promise<string> {
  const text = dayReviewCommandFingerprintText(query, actorId, command), digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}
export function parseDayReviewReceipt(raw: unknown): DayReviewReceipt {
  try { const r = exact(detached(raw, 4096), ["operationId", "caseId", "revision", "action", "actorId", "recordedAt", "commandFingerprint"]);
    if (r.action !== "decide" && r.action !== "explain" && r.action !== "dispute") invalid();
    return freeze({ operationId: uuid(r.operationId), caseId: uuid(r.caseId), revision: integer(r.revision, 1), action: r.action, actorId: uuid(r.actorId), recordedAt: stamp(r.recordedAt), commandFingerprint: hash(r.commandFingerprint) });
  } catch { return invalid(); }
}
/** A complete-command receipt match only; never substitutes for fresh source. */
export function dayReviewReceiptMatches(raw: unknown, query: DayReviewQuery, actorId: string, command: DayReviewCommand, fingerprint: string): boolean {
  try { const r = parseDayReviewReceipt(raw), q = parseDayReviewQuery(query), c = parseDayReviewCommand(q, command), caseId = c.action === "decide" ? c.caseId : q.mode === "detail" ? q.caseId : invalid();
    return r.operationId === c.operationId && r.caseId === caseId && r.revision === c.expectedRevision + 1 && r.action === c.action && r.actorId === uuid(actorId) && r.commandFingerprint === hash(fingerprint);
  } catch { return false; }
}
