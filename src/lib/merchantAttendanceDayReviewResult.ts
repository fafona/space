// C15-A saved public ledger projection. No private canonical source, GPS,
// current-source verdict or permission is inferred by these browser parsers.
import { captureBrowserExact as exact } from "./merchantAttendanceRuleCapturesBrowser";
import { enumValue, freeze, hash, integer, label, safeTree, same, stamp, uuid } from "./merchantAttendancePlanExceptionValidation";
import { DAY_CLASSIFICATION_OBSERVATIONS, DAY_CLASSIFICATION_OUTCOMES, parseDayClassificationTarget,
  type DayClassificationObservation, type DayClassificationOutcome, type DayClassificationTarget } from "./merchantAttendanceDayClassification";
import { DAY_REVIEW_PAGE_SIZE, DAY_REVIEW_PROTOCOL, DAY_REVIEW_RESPONSE_LIMIT, dayReviewReceiptMatches,
  parseDayReviewCommand, parseDayReviewQuery, parseDayReviewReceipt, type DayReviewAccess, type DayReviewCalendarReference,
  type DayReviewCommand, type DayReviewQuery, type DayReviewReceipt } from "./merchantAttendanceDayReviewContract";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

export type DayReviewDecisionEntry = Readonly<{ receipt: DayReviewReceipt; action: "decide"; reason: string;
  outcome: DayClassificationOutcome; sourceFingerprint: string; observations: readonly DayClassificationObservation[];
  calendarReference: DayReviewCalendarReference | null; selfStatementOperationId: string | null }>;
export type DayReviewSelfEntry = Readonly<{ receipt: DayReviewReceipt; reason: string; decisionOperationId: string }> & (
  Readonly<{ action: "explain"; claim: "worked_missing_records" | "not_worked" | "uncertain" }>
  | Readonly<{ action: "dispute"; claim: null }>);
export type DayReviewEntry = DayReviewDecisionEntry | DayReviewSelfEntry;
export type DayReviewCaseHead = Readonly<{ caseId: string; target: DayClassificationTarget; openedAt: string; revision: number;
  latestDecision: DayReviewDecisionEntry; latestSelf: DayReviewSelfEntry | null; needsResponse: boolean }>;
type Common = Readonly<{ protocol: typeof DAY_REVIEW_PROTOCOL; siteId: string; actorId: string; readAt: string }>;
type Cursor = Readonly<{ openedAt: string; caseId: string }>;
export type DayReviewSavedResult = Common & (
  Readonly<{ kind: "list"; access: DayReviewAccess; items: readonly DayReviewCaseHead[]; nextCursor: Cursor | null }>
  | Readonly<{ kind: "history"; access: DayReviewAccess; head: DayReviewCaseHead; items: readonly DayReviewEntry[]; nextRevision: number | null }>
  | Readonly<{ kind: "detail"; access: DayReviewAccess; head: DayReviewCaseHead; operation: DayReviewEntry | null; replayed: boolean }>
  | Readonly<{ kind: "receipt"; receipt: DayReviewReceipt; replayed: boolean }>);

function invalid(): never { throw new MerchantAttendanceError("attendance_day_review_invalid"); }
const bool = (v: unknown): boolean => typeof v === "boolean" ? v : invalid();
function clone(raw: unknown): unknown { safeTree(raw, DAY_REVIEW_RESPONSE_LIMIT); return JSON.parse(JSON.stringify(raw)); }
function list<T>(raw: unknown, parse: (v: unknown) => T): T[] {
  if (!Array.isArray(raw) || raw.length > DAY_REVIEW_PAGE_SIZE) invalid(); return raw.map(parse);
}
function observations(raw: unknown): DayClassificationObservation[] {
  if (!Array.isArray(raw) || raw.length > DAY_CLASSIFICATION_OBSERVATIONS.length) invalid();
  const result = raw.map(v => enumValue(v, DAY_CLASSIFICATION_OBSERVATIONS));
  if (!result.length || new Set(result).size !== result.length
    || result.some((v, i) => i > 0 && DAY_CLASSIFICATION_OBSERVATIONS.indexOf(v) <= DAY_CLASSIFICATION_OBSERVATIONS.indexOf(result[i - 1]))) invalid();
  if (result.includes("no_record") && result.some(v => ["open_record", "source_conflict", "unassociated_record", "recorded_work"].includes(v))) invalid();
  return result;
}
function calendar(raw: unknown): DayReviewCalendarReference | null {
  if (raw === null) return null; const r = exact(raw, ["entryId", "operationId", "revision"]), entryId = uuid(r.entryId), operationId = uuid(r.operationId);
  if (entryId !== operationId || r.revision !== 1) invalid(); return { entryId, operationId, revision: 1 };
}
function entry(raw: unknown, caseId: string, target: DayClassificationTarget, asOf: string): DayReviewEntry {
  if (raw === null || typeof raw !== "object") invalid(); const action = Object.getOwnPropertyDescriptor(raw, "action")?.value;
  const value = exact(raw, action === "decide" ? ["receipt", "action", "reason", "outcome", "sourceFingerprint", "observations", "calendarReference", "selfStatementOperationId"]
    : ["receipt", "action", "reason", "decisionOperationId", "claim"]);
  const receipt = parseDayReviewReceipt(value.receipt), reason = label(value.reason, 1000);
  if (receipt.caseId !== caseId || receipt.action !== action || receipt.recordedAt > asOf) invalid();
  if (action === "decide") {
    if (receipt.actorId === target.employeeAuthUserId) invalid();
    const outcome = enumValue(value.outcome, DAY_CLASSIFICATION_OUTCOMES), calendarReference = calendar(value.calendarReference);
    const observed = observations(value.observations);
    const selfStatementOperationId = value.selfStatementOperationId === null ? null : uuid(value.selfStatementOperationId);
    if ((outcome === "calendar_exempt") !== (calendarReference !== null) || outcome === "calendar_exempt" && target.kind !== "plan"
      || (outcome === "not_worked_reported") !== (selfStatementOperationId !== null)
      || selfStatementOperationId === receipt.operationId) invalid();
    if (outcome !== "follow_up" && observed.some(v => ["evidence_insufficient", "pending_source", "open_record", "source_conflict", "unassociated_record"].includes(v))
      || outcome === "recorded_work_reviewed" && !observed.includes("recorded_work")
      || outcome === "not_worked_reported" && (!observed.includes("no_record") || observed.includes("recorded_work"))) invalid();
    return { receipt, action, reason, outcome, sourceFingerprint: hash(value.sourceFingerprint), observations: observed, calendarReference, selfStatementOperationId };
  }
  if (action !== "explain" && action !== "dispute" || receipt.actorId !== target.employeeAuthUserId || receipt.revision < 2) invalid();
  const decisionOperationId = uuid(value.decisionOperationId); if (decisionOperationId === receipt.operationId) invalid();
  if (action === "dispute") { if (value.claim !== null) invalid(); return { receipt, action, reason, decisionOperationId, claim: null }; }
  return { receipt, action, reason, decisionOperationId, claim: enumValue(value.claim, ["worked_missing_records", "not_worked", "uncertain"] as const) };
}
function head(raw: unknown, actor: string, access: DayReviewAccess, asOf: string): DayReviewCaseHead {
  const h = exact(raw, ["caseId", "target", "openedAt", "revision", "latestDecision", "latestSelf", "needsResponse"]);
  const caseId = uuid(h.caseId), target = parseDayClassificationTarget(h.target), openedAt = stamp(h.openedAt), revision = integer(h.revision);
  if (openedAt > asOf || access === "self" && target.employeeAuthUserId !== actor) invalid();
  const latestDecision = entry(h.latestDecision, caseId, target, asOf); if (latestDecision.action !== "decide") invalid();
  const latestSelf = h.latestSelf === null ? null : entry(h.latestSelf, caseId, target, asOf);
  if (latestDecision.receipt.revision > revision || latestDecision.receipt.recordedAt < openedAt
    || latestDecision.receipt.revision === 1 && latestDecision.receipt.recordedAt !== openedAt) invalid();
  if (latestSelf !== null && (latestSelf.action === "decide" || latestSelf.receipt.revision !== revision || latestSelf.receipt.revision <= latestDecision.receipt.revision
    || latestSelf.decisionOperationId !== latestDecision.receipt.operationId || latestSelf.receipt.recordedAt < latestDecision.receipt.recordedAt)) invalid();
  if (latestSelf === null && latestDecision.receipt.revision !== revision || bool(h.needsResponse) !== (latestSelf !== null)) invalid();
  return { caseId, target, openedAt, revision, latestDecision, latestSelf: latestSelf as DayReviewSelfEntry | null, needsResponse: h.needsResponse as boolean };
}
function entryMatchesCommand(e: DayReviewEntry, q: DayReviewQuery, actor: string, c: DayReviewCommand, fingerprint: string): boolean {
  if (!dayReviewReceiptMatches(e.receipt, q, actor, c, fingerprint) || e.reason !== c.reason || e.action !== c.action) return false;
  return c.action === "decide" ? e.action === "decide" && e.outcome === c.outcome && e.sourceFingerprint === c.expectedFingerprint
    && same(e.calendarReference, c.calendarReference) && e.selfStatementOperationId === c.selfStatementOperationId
    : e.action !== "decide" && e.decisionOperationId === c.decisionOperationId && e.claim === c.claim;
}
function requireHeadConsistentEntry(e: DayReviewEntry, savedHead: DayReviewCaseHead): void {
  if (e.receipt.revision === 1 && e.receipt.recordedAt !== savedHead.openedAt) invalid();
  for (const known of [savedHead.latestDecision, savedHead.latestSelf]) {
    if (known !== null && (e.receipt.revision === known.receipt.revision || e.receipt.operationId === known.receipt.operationId)
      && !same(e, known)) invalid();
  }
}
/** A minimal original-actor receipt is intentionally valid without current
 * head/authority/source. It may not be substituted by a dynamic detail result. */
export function parseDayReviewSavedResult(raw: unknown, rawQuery: DayReviewQuery, actorId: string,
  expected: Readonly<{ command: DayReviewCommand; fingerprint: string }> | null = null): DayReviewSavedResult {
  try {
    const query = parseDayReviewQuery(rawQuery), actor = uuid(actorId), detached = clone(raw);
    const kind = detached && typeof detached === "object" ? Object.getOwnPropertyDescriptor(detached, "kind")?.value : undefined;
    const commonKeys = ["protocol", "siteId", "actorId", "readAt", "kind"];
    const result = exact(detached, [...commonKeys, ...(kind === "receipt" ? ["receipt", "replayed"] : kind === "list" ? ["access", "items", "nextCursor"]
      : kind === "history" ? ["access", "head", "items", "nextRevision"] : kind === "detail" ? ["access", "head", "operation", "replayed"] : invalid())]);
    if (result.protocol !== DAY_REVIEW_PROTOCOL || result.siteId !== query.siteId || result.actorId !== actor) invalid();
    const readAt = stamp(result.readAt), common: Common = { protocol: DAY_REVIEW_PROTOCOL, siteId: query.siteId, actorId: actor, readAt };
    const c = expected === null ? null : parseDayReviewCommand(query, expected.command), digest = expected === null ? null : hash(expected.fingerprint);
    if (kind === "receipt") {
      const receipt = parseDayReviewReceipt(result.receipt);
      if (query.mode !== "recover" && c === null || receipt.actorId !== actor || receipt.recordedAt > readAt
        || query.mode === "recover" && receipt.operationId !== query.operationId
        || c !== null && !dayReviewReceiptMatches(receipt, query, actor, c, digest!)) invalid();
      const replayed = bool(result.replayed); if (query.mode === "recover" && !replayed) invalid();
      return freeze({ ...common, kind: "receipt", receipt, replayed });
    }
    if (query.mode === "recover" || !Object.hasOwn(query, "access") || result.access !== query.access) invalid();
    const access = query.access;
    if (kind === "list") {
      if (query.mode !== "list" || c !== null) invalid();
      const items = list(result.items, v => head(v, actor, access, readAt));
      const key = (h: Pick<DayReviewCaseHead, "openedAt" | "caseId">) => h.openedAt + h.caseId;
      if (new Set(items.map(h => h.caseId)).size !== items.length || items.some((h, i) => query.workerId !== null && h.target.workerId !== query.workerId
        || query.cursor !== null && key(h) >= key(query.cursor) || i > 0 && key(h) >= key(items[i - 1]))) invalid();
      let nextCursor: Cursor | null = null;
      if (result.nextCursor !== null) { const cursor = exact(result.nextCursor, ["openedAt", "caseId"]);
        nextCursor = { openedAt: stamp(cursor.openedAt), caseId: uuid(cursor.caseId) };
        if (items.length !== DAY_REVIEW_PAGE_SIZE || key(nextCursor) !== key(items.at(-1)!)) invalid(); }
      return freeze({ ...common, access, kind: "list", items, nextCursor });
    }
    const savedHead = head(result.head, actor, access, readAt);
    if (query.mode === "detail" || query.mode === "history") { if (savedHead.caseId !== query.caseId) invalid(); }
    else if (query.mode !== "preview" || c?.action !== "decide" || savedHead.caseId !== c.caseId || savedHead.target.workerId !== query.workerId
      || savedHead.target.workDate !== query.workDate || savedHead.target.slotId !== query.slotId
      || savedHead.target.employeeId !== c.employeeId || savedHead.target.employeeAuthUserId !== c.employeeAuthUserId) invalid();
    if (kind === "history") {
      if (query.mode !== "history" || c !== null) invalid();
      const items = list(result.items, v => entry(v, savedHead.caseId, savedHead.target, readAt));
      items.forEach(e => requireHeadConsistentEntry(e, savedHead));
      if (new Set(items.map(e => e.receipt.operationId)).size !== items.length || items.some((e, i) => e.receipt.revision > savedHead.revision
        || e.receipt.recordedAt < savedHead.openedAt || query.beforeRevision !== null && e.receipt.revision >= query.beforeRevision
        || i > 0 && (e.receipt.revision !== items[i - 1].receipt.revision - 1 || e.receipt.recordedAt > items[i - 1].receipt.recordedAt))) invalid();
      const nextRevision = result.nextRevision === null ? null : integer(result.nextRevision, 2);
      if (nextRevision !== null && (items.length !== DAY_REVIEW_PAGE_SIZE || nextRevision !== items.at(-1)!.receipt.revision)
        || items.length === 0 && (query.beforeRevision === null || query.beforeRevision > 1)) invalid();
      // An unbounded first page must start at the true current ledger head;
      // subsequent pages are exact contiguous older revisions, never subsets.
      const wanted = Math.min(savedHead.revision, query.beforeRevision === null ? savedHead.revision : query.beforeRevision - 1);
      if (items.length && items[0].receipt.revision !== wanted || nextRevision === null && items.length && items.at(-1)!.receipt.revision !== 1) invalid();
      return freeze({ ...common, access, kind: "history", head: savedHead, items, nextRevision });
    }
    if (kind !== "detail" || query.mode !== "detail" && query.mode !== "preview") invalid();
    const operation = result.operation === null ? null : entry(result.operation, savedHead.caseId, savedHead.target, readAt), replayed = bool(result.replayed);
    if (operation !== null) requireHeadConsistentEntry(operation, savedHead);
    if (operation && (operation.receipt.revision > savedHead.revision || operation.receipt.recordedAt < savedHead.openedAt)) invalid();
    if (c === null ? operation !== null || replayed : operation === null || !entryMatchesCommand(operation, query, actor, c, digest!)) invalid();
    return freeze({ ...common, access, kind: "detail", head: savedHead, operation, replayed });
  } catch { return invalid(); }
}
