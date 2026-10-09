// C15-A PURE FOUNDATION ONLY. Caller observations are not trusted collection,
// authorization, a saved decision or proof of full civil-day UTC boundaries.
// No hours, attendance offence, payroll, old late/early or period state changes.
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { captureBrowserExact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { parseAdministrativeReportBoundary, type AdministrativeReportBoundary } from "./merchantAttendanceAdministrativeBoundary";

export const DAY_CLASSIFICATION_INPUT_PROTOCOL = "attendance-day-classification-input-v1" as const;
export const DAY_CLASSIFICATION_PREVIEW_PROTOCOL = "attendance-day-classification-preview-v1" as const;
export const DAY_CLASSIFICATION_BYTE_LIMIT = 262144, DAY_CLASSIFICATION_ITEM_LIMIT = 100;
export const DAY_CLASSIFICATION_OBSERVATIONS = Object.freeze(["evidence_insufficient", "pending_source", "open_record", "source_conflict", "unassociated_record", "no_record", "recorded_work"] as const);
export const DAY_CLASSIFICATION_OUTCOMES = Object.freeze(["follow_up", "calendar_exempt", "not_worked_reported", "recorded_work_reviewed"] as const);
export type DayClassificationObservation = typeof DAY_CLASSIFICATION_OBSERVATIONS[number];
export type DayClassificationOutcome = typeof DAY_CLASSIFICATION_OUTCOMES[number];
type Coverage = "complete" | "unknown" | "over_limit";
type Identity = Readonly<{ workerId: string; employeeId: string; employeeAuthUserId: string }>;
type Endpoints = Readonly<{ startAt: string; endAt: string | null }>;
export type DayClassificationTarget = Identity & Readonly<{ kind: "day" | "plan"; workDate: string; timeZone: string; fromAt: string; toAt: string; slotId: string | null }>;
export type DayClassificationPlan = Identity & Readonly<{ slotId: string; revision: number; locationId: string; workDate: string; timeZone: string; startAt: string; endAt: string; cancelled: boolean; hasPublicationEvidence: boolean }>;
export type DayClassificationRecord = Identity & Readonly<{ kind: "session" | "missing"; sourceId: string; operationId: string | null; revision: number;
  locationId: string; original: Endpoints | null; selected: Endpoints; association: Readonly<{ slotId: string; operationId: string }> | null;
  administrativeBoundary?: AdministrativeReportBoundary | null }>;
export type DayClassificationCalendar = Readonly<{ siteId: string; entryId: string; operationId: string; revision: 1 | 2; kind: "holiday" | "closure";
  status: "created" | "cancelled"; locationId: string | null; timeZone: string; fromDate: string; throughDate: string; fromAt: string; toAt: string; recordedAt: string }>;
type SavedReference = Readonly<{ operationId: string; revision: number; recordedAt: string }>;
export type DayClassificationSelfStatement = SavedReference & Readonly<{ caseId: string; actorId: string; decisionOperationId: string }> & (
  Readonly<{ kind: "explain"; claim: "worked_missing_records" | "not_worked" | "uncertain" }> | Readonly<{ kind: "dispute"; claim: null }>);
export type DayClassificationCaseHead = Readonly<{ caseId: string; target: DayClassificationTarget; revision: number; coverage: "complete" | "unknown";
  latestDecision: SavedReference | null; latestSelf: DayClassificationSelfStatement | null }>;
export type DayClassificationInput = Readonly<{ protocol: typeof DAY_CLASSIFICATION_INPUT_PROTOCOL; siteId: string; asOf: string; actorId: string;
  target: DayClassificationTarget; source: Readonly<{ fingerprint: string; coverage: Coverage; identity: "matching" | "unproven"; current: boolean;
    plans: readonly DayClassificationPlan[]; records: readonly DayClassificationRecord[]; calendar: readonly DayClassificationCalendar[];
    pending: readonly Readonly<{ kind: "correction" | "revision" | "missing" | "leave" | "arrangement" | "outage"; sourceId: string; operationId: string; revision: number }>[];
    conflicts: readonly Readonly<{ kind: "records_overlap" | "work_leave"; sourceIds: readonly string[] }>[];
    arrangements: readonly Readonly<{ requestId: string; operationId: string; revision: number; startAt: string; endAt: string }>[];
    caseHead: DayClassificationCaseHead | null }> }>;
const BLOCKERS = ["evidence_incomplete", "identity_unproven", "source_not_current", "target_not_ended", "self_review", "pending_source", "open_record", "source_conflict", "unassociated_record",
  "administrative_hours_unassessed", "plan_required", "plan_cancelled", "publication_missing", "covering_closure_missing", "work_record_present", "latest_not_worked_statement_required", "recorded_work_required"] as const;
export type DayClassificationBlocker = typeof BLOCKERS[number];
type CalendarReference = Pick<DayClassificationCalendar, "entryId" | "operationId" | "revision" | "locationId" | "timeZone" | "fromAt" | "toAt">;
export type DayClassificationCandidate = Readonly<{ outcome: DayClassificationOutcome; candidateState: "candidate" | "blocked"; blockers: readonly DayClassificationBlocker[];
  calendarReferences: readonly CalendarReference[]; selfStatementReference: SavedReference & Readonly<{ caseId: string; decisionOperationId: string }> | null }>;
export type DayClassificationPreview = Readonly<{ protocol: typeof DAY_CLASSIFICATION_PREVIEW_PROTOCOL; candidateOnly: true; authorityChecked: false; applied: false;
  evidenceOrigin: "caller_provided"; sourceFingerprintVerified: false; boundariesVerified: false; siteId: string; asOf: string; target: DayClassificationTarget; sourceFingerprint: string;
  evidenceCompleteness: "caller_claimed_complete" | "incomplete"; observations: readonly DayClassificationObservation[]; candidates: readonly DayClassificationCandidate[];
  background: Readonly<{ planCount: number; cancelledPlanCount: number; calendarCount: number; approvedArrangementCount: number; unassociatedRecordCount: number; workDuringClosure: boolean }> }>;

function invalid(): never { throw new MerchantAttendanceError("attendance_day_classification_invalid"); }
function exact(v: unknown, keys: readonly string[]) { try { return captureBrowserExact(v, keys); } catch { return invalid(); } }
function freeze<T>(v: T): T { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function unicode(v: string) { if (v.includes("\0")) invalid(); for (let i = 0; i < v.length; i++) { const n = v.charCodeAt(i);
  if (n >= 0xd800 && n <= 0xdbff) { const next = v.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) invalid(); } else if (n >= 0xdc00 && n <= 0xdfff) invalid(); } }
function tree(raw: unknown) {
  let nodes = 0; const ancestors = new Set<object>(); const visit = (v: unknown, depth: number): void => {
    if (++nodes > 20000 || depth > 18) invalid(); if (v === null || typeof v === "boolean") return;
    if (typeof v === "string") { if (v.length > DAY_CLASSIFICATION_BYTE_LIMIT) invalid(); unicode(v); return; }
    if (typeof v === "number") { if (!Number.isSafeInteger(v) || Object.is(v, -0)) invalid(); return; }
    if (typeof v !== "object" || ancestors.has(v)) invalid(); ancestors.add(v);
    const array = Array.isArray(v), proto = Object.getPrototypeOf(v), keys = Reflect.ownKeys(v);
    if (array ? proto !== Array.prototype || v.length > DAY_CLASSIFICATION_ITEM_LIMIT || keys.length !== v.length + 1 : proto !== Object.prototype && proto !== null) invalid();
    for (const key of keys) { if (typeof key !== "string" || key.length > DAY_CLASSIFICATION_BYTE_LIMIT) invalid(); unicode(key);
      if (array && key === "length") continue; if (["__proto__", "constructor", "prototype"].includes(key) || array && !/^(0|[1-9][0-9]*)$/.test(key)) invalid();
      const d = Object.getOwnPropertyDescriptor(v, key)!; if (!("value" in d) || !d.enumerable) invalid(); visit(d.value, depth + 1); }
    if (array) for (let i = 0; i < v.length; i++) if (!Object.hasOwn(v, String(i))) invalid(); ancestors.delete(v);
  }; visit(raw, 0); if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > DAY_CLASSIFICATION_BYTE_LIMIT) invalid();
}
const uuid = (v: unknown): string => typeof v === "string" && v.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v) ? v : invalid();
const site = (v: unknown): string => typeof v === "string" && v.length === 8 && /^[0-9]{8}$/.test(v) ? v : invalid();
const hash = (v: unknown): string => typeof v === "string" && v.length === 64 && /^[0-9a-f]{64}$/.test(v) ? v : invalid();
const bool = (v: unknown): boolean => typeof v === "boolean" ? v : invalid();
const integer = (v: unknown, min = 1, max = 9007199254740990): number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min && v <= max ? v : invalid();
function choice<T extends string>(v: unknown, values: readonly T[]): T { return typeof v === "string" && values.includes(v as T) ? v as T : invalid(); }
function array<T>(v: unknown, parse: (v: unknown) => T, key: (v: T) => string): T[] { if (!Array.isArray(v) || v.length > DAY_CLASSIFICATION_ITEM_LIMIT) invalid(); const result = v.map(parse);
  if (new Set(result.map(key)).size !== result.length) invalid(); return result; }
function stamp(v: unknown): string { if (typeof v !== "string" || v.length !== 27 || !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(v)) invalid();
  const short = v.slice(0, 23) + "Z"; if (!Number.isFinite(Date.parse(short)) || new Date(short).toISOString() !== short) invalid(); return v; }
function day(v: unknown): string { if (typeof v !== "string" || v.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(v) || v < "2000-01-01" || v > "2100-12-31") invalid();
  stamp(v + "T00:00:00.000000Z"); return v; }
// These are saved labels beside already-saved UTC geometry, not requests to
// reinterpret a historical date using this browser's current tzdata.
function zone(v: unknown): string { if (typeof v !== "string" || !v.length || v.length > 100 || v !== v.trim()
  || v !== "UTC" && !/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+$/.test(v)) invalid(); return v; }
function micros(v: string): bigint { return BigInt(Date.parse(v.slice(0, 23) + "Z")) * BigInt(1000) + BigInt(v.slice(23, 26)); }
const identity = (r: Record<string, unknown>): Identity => ({ workerId: uuid(r.workerId), employeeId: uuid(r.employeeId), employeeAuthUserId: uuid(r.employeeAuthUserId) });
const sameIdentity = (a: Identity, b: Identity) => a.workerId === b.workerId && a.employeeId === b.employeeId && a.employeeAuthUserId === b.employeeAuthUserId;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function interval(start: string, end: string, maxDays: number) { const duration = micros(end) - micros(start); if (duration <= BigInt(0) || duration > BigInt(maxDays) * BigInt(86400000000)) invalid(); }
const intersects = (start: string, end: string | null, from: string, to: string) => start < to && (end === null || end > from);
function target(raw: unknown): DayClassificationTarget {
  const t = exact(raw, ["kind", "workerId", "employeeId", "employeeAuthUserId", "workDate", "timeZone", "fromAt", "toAt", "slotId"]);
  const value = { kind: choice(t.kind, ["day", "plan"] as const), ...identity(t), workDate: day(t.workDate), timeZone: zone(t.timeZone), fromAt: stamp(t.fromAt), toAt: stamp(t.toAt), slotId: t.slotId === null ? null : uuid(t.slotId) };
  if ((value.kind === "day") !== (value.slotId === null)) invalid(); interval(value.fromAt, value.toAt, value.kind === "day" ? 2 : 1); return value;
}
/** Structural saved-frame parser only; it does not establish its SQL origin. */
export function parseDayClassificationTarget(raw: unknown): DayClassificationTarget {
  try { tree(raw); return freeze(target(raw)); } catch { return invalid(); }
}
function endpoints(raw: unknown, asOf: string): Endpoints { const e = exact(raw, ["startAt", "endAt"]), startAt = stamp(e.startAt), endAt = e.endAt === null ? null : stamp(e.endAt);
  if (startAt > asOf || endAt !== null && endAt > asOf) invalid(); if (endAt !== null) interval(startAt, endAt, 31); return { startAt, endAt }; }
function reference(raw: unknown, asOf: string): SavedReference { const r = exact(raw, ["operationId", "revision", "recordedAt"]), result = { operationId: uuid(r.operationId), revision: integer(r.revision), recordedAt: stamp(r.recordedAt) };
  if (result.recordedAt > asOf) invalid(); return result; }
function caseHead(raw: unknown, frame: DayClassificationTarget, asOf: string): DayClassificationCaseHead | null {
  if (raw === null) return null; const c = exact(raw, ["caseId", "target", "revision", "coverage", "latestDecision", "latestSelf"]);
  const caseId = uuid(c.caseId), savedTarget = target(c.target), revision = integer(c.revision), coverage = choice(c.coverage, ["complete", "unknown"] as const);
  if (!same(savedTarget, frame)) invalid(); const latestDecision = c.latestDecision === null ? null : reference(c.latestDecision, asOf); let latestSelf: DayClassificationSelfStatement | null = null;
  if (c.latestSelf !== null) { const s = exact(c.latestSelf, ["caseId", "operationId", "revision", "recordedAt", "actorId", "decisionOperationId", "kind", "claim"]), kind = choice(s.kind, ["explain", "dispute"] as const);
    const base = { ...reference({ operationId: s.operationId, revision: s.revision, recordedAt: s.recordedAt }, asOf), caseId: uuid(s.caseId), actorId: uuid(s.actorId), decisionOperationId: uuid(s.decisionOperationId) };
    if (kind === "dispute") { if (s.claim !== null) invalid(); latestSelf = { ...base, kind, claim: null }; }
    else latestSelf = { ...base, kind, claim: choice(s.claim, ["worked_missing_records", "not_worked", "uncertain"] as const) };
    if (latestSelf.caseId !== caseId || latestSelf.actorId !== frame.employeeAuthUserId || !latestDecision || latestSelf.decisionOperationId !== latestDecision.operationId
      || latestSelf.operationId === latestDecision.operationId || latestSelf.revision <= latestDecision.revision || latestSelf.revision !== revision || latestSelf.recordedAt < latestDecision.recordedAt) invalid();
  }
  if (coverage === "unknown" ? latestDecision !== null || latestSelf !== null : !latestDecision || latestDecision.revision > revision || latestSelf === null && latestDecision.revision !== revision) invalid();
  return { caseId, target: savedTarget, revision, coverage, latestDecision, latestSelf };
}

/** Normalized metadata, NOT a trusted-source adapter. No supplied claim or
 * fingerprint is upgraded to proven database completeness/authority here. */
export function parseDayClassificationInput(raw: unknown): DayClassificationInput {
  try { tree(raw); const r = exact(raw, ["protocol", "siteId", "asOf", "actorId", "target", "source"]);
    if (r.protocol !== DAY_CLASSIFICATION_INPUT_PROTOCOL) invalid(); const siteId = site(r.siteId), asOf = stamp(r.asOf), actorId = uuid(r.actorId), frame = target(r.target);
    const s = exact(r.source, ["fingerprint", "coverage", "identity", "current", "plans", "records", "calendar", "pending", "conflicts", "arrangements", "caseHead"]);
    const plans = array(s.plans, raw => { const p = exact(raw, ["slotId", "revision", "workerId", "employeeId", "employeeAuthUserId", "locationId", "workDate", "timeZone", "startAt", "endAt", "cancelled", "hasPublicationEvidence"]);
      const result = { slotId: uuid(p.slotId), revision: integer(p.revision), ...identity(p), locationId: uuid(p.locationId), workDate: day(p.workDate), timeZone: zone(p.timeZone), startAt: stamp(p.startAt), endAt: stamp(p.endAt), cancelled: bool(p.cancelled), hasPublicationEvidence: bool(p.hasPublicationEvidence) };
      interval(result.startAt, result.endAt, 1); if (!sameIdentity(result, frame) || !intersects(result.startAt, result.endAt, frame.fromAt, frame.toAt)
        || micros(result.startAt) % BigInt(60000000) || micros(result.endAt) % BigInt(60000000)) invalid(); return result;
    }, p => p.slotId);
    const records = array(s.records, raw => {
      const hasBoundary = raw !== null && typeof raw === "object" && Object.hasOwn(raw, "administrativeBoundary");
      const v = exact(raw, ["kind", "sourceId", "operationId", "revision", "workerId", "employeeId", "employeeAuthUserId", "locationId", "original", "selected", "association", ...(hasBoundary ? ["administrativeBoundary"] : [])]);
      const kind = choice(v.kind, ["session", "missing"] as const), original = v.original === null ? null : endpoints(v.original, asOf), selected = endpoints(v.selected, asOf), operationId = v.operationId === null ? null : uuid(v.operationId), revision = integer(v.revision, 0);
      const administrativeBoundary = hasBoundary && v.administrativeBoundary !== null ? parseAdministrativeReportBoundary(v.administrativeBoundary) : null;
      let association = null; if (v.association !== null) { const a = exact(v.association, ["slotId", "operationId"]); association = { slotId: uuid(a.slotId), operationId: uuid(a.operationId) }; if (!plans.some(p => p.slotId === association!.slotId)) invalid(); }
      const result = { kind, sourceId: uuid(v.sourceId), operationId, revision, ...identity(v), locationId: uuid(v.locationId), original, selected, association,
        ...(hasBoundary ? { administrativeBoundary } : {}) };
      if (administrativeBoundary && (kind !== "session" || !original || original.endAt !== null || selected.endAt !== null || !same(original, selected)
        || operationId !== null || revision !== 0 || administrativeBoundary.startEventId !== result.sourceId || administrativeBoundary.startAt !== original.startAt
        || administrativeBoundary.recordedAt > asOf || administrativeBoundary.verifiedEndAt > asOf)) invalid();
      if (!sameIdentity(result, frame) || (operationId === null) !== (revision === 0) || kind === "missing" && (original !== null || selected.endAt === null || operationId === null)
        || kind === "session" && (original === null || operationId === null && !same(original, selected) || operationId !== null && (original.endAt === null || selected.endAt === null))
        || !intersects(selected.startAt, administrativeBoundary?.verifiedEndAt ?? selected.endAt, frame.fromAt, frame.toAt)
          && !(original && intersects(original.startAt, administrativeBoundary?.verifiedEndAt ?? original.endAt, frame.fromAt, frame.toAt))) invalid();
      return result;
    }, v => v.sourceId);
    const calendar = array(s.calendar, raw => { const c = exact(raw, ["siteId", "entryId", "operationId", "revision", "kind", "status", "locationId", "timeZone", "fromDate", "throughDate", "fromAt", "toAt", "recordedAt"]);
      const value: DayClassificationCalendar = { siteId: site(c.siteId), entryId: uuid(c.entryId), operationId: uuid(c.operationId), revision: integer(c.revision, 1, 2) as 1 | 2,
        kind: choice(c.kind, ["holiday", "closure"] as const), status: choice(c.status, ["created", "cancelled"] as const), locationId: c.locationId === null ? null : uuid(c.locationId), timeZone: zone(c.timeZone),
        fromDate: day(c.fromDate), throughDate: day(c.throughDate), fromAt: stamp(c.fromAt), toAt: stamp(c.toAt), recordedAt: stamp(c.recordedAt) };
      if (value.siteId !== siteId || value.revision !== (value.status === "created" ? 1 : 2) || (value.revision === 1) !== (value.operationId === value.entryId) || value.recordedAt > asOf || value.throughDate < value.fromDate
        || (Date.parse(value.throughDate) - Date.parse(value.fromDate)) / 86400000 >= 366) invalid(); interval(value.fromAt, value.toAt, 368); return value;
    }, c => c.entryId);
    const pending = array(s.pending, raw => { const p = exact(raw, ["kind", "sourceId", "operationId", "revision"]); return { kind: choice(p.kind, ["correction", "revision", "missing", "leave", "arrangement", "outage"] as const), sourceId: uuid(p.sourceId), operationId: uuid(p.operationId), revision: integer(p.revision) }; }, p => p.kind + ":" + p.sourceId);
    const conflicts = array(s.conflicts, raw => { const c = exact(raw, ["kind", "sourceIds"]), kind = choice(c.kind, ["records_overlap", "work_leave"] as const);
      const sourceIds = array(c.sourceIds, uuid, v => v); if (sourceIds.length < 2 || sourceIds.length > 4 || !sourceIds.some(id => records.some(r => r.sourceId === id))
        || kind === "records_overlap" && sourceIds.some(id => !records.some(r => r.sourceId === id))) invalid(); return { kind, sourceIds };
    }, c => c.kind + ":" + [...c.sourceIds].sort().join(","));
    const arrangements = array(s.arrangements, raw => { const a = exact(raw, ["requestId", "operationId", "revision", "startAt", "endAt"]), value = { requestId: uuid(a.requestId), operationId: uuid(a.operationId), revision: integer(a.revision), startAt: stamp(a.startAt), endAt: stamp(a.endAt) };
      interval(value.startAt, value.endAt, 366); if (!intersects(value.startAt, value.endAt, frame.fromAt, frame.toAt)) invalid(); return value;
    }, a => a.requestId);
    const source: DayClassificationInput["source"] = { fingerprint: hash(s.fingerprint), coverage: choice(s.coverage, ["complete", "unknown", "over_limit"] as const), identity: choice(s.identity, ["matching", "unproven"] as const), current: bool(s.current), plans, records, calendar, pending, conflicts, arrangements, caseHead: caseHead(s.caseHead, frame, asOf) };
    if (source.coverage !== "complete" && (plans.length || records.length || calendar.length || pending.length || conflicts.length || arrangements.length || source.caseHead !== null)) invalid();
    if (source.coverage === "complete" && frame.kind === "plan") { const plan = plans.find(p => p.slotId === frame.slotId);
      if (!plan || plan.startAt !== frame.fromAt || plan.endAt !== frame.toAt || plan.workDate !== frame.workDate || plan.timeZone !== frame.timeZone) invalid(); }
    return freeze({ protocol: DAY_CLASSIFICATION_INPUT_PROTOCOL, siteId, asOf, actorId, target: frame, source });
  } catch { return invalid(); }
}
export function parseDayClassificationInputJson(text: string): DayClassificationInput { try {
  if (typeof text !== "string" || text.length > DAY_CLASSIFICATION_BYTE_LIMIT || new TextEncoder().encode(text).byteLength > DAY_CLASSIFICATION_BYTE_LIMIT) invalid(); unicode(text);
  return parseDayClassificationInput(parseCaptureBrowserJson(text));
} catch { return invalid(); } }

export function evaluateDayClassification(raw: unknown): DayClassificationPreview {
  const input = parseDayClassificationInput(raw), { source: s, target: t, asOf } = input;
  const complete = s.coverage === "complete" && s.identity === "matching" && s.current, ended = asOf >= t.toAt;
  const administrative = s.records.some(r => r.administrativeBoundary !== null && r.administrativeBoundary !== undefined);
  const open = s.records.some(r => !r.administrativeBoundary && (r.original?.endAt === null || r.selected.endAt === null));
  const unassociated = s.records.filter(r => !r.association || t.kind === "plan" && r.association.slotId !== t.slotId);
  // Detect only overlap inside this full target. Raw records remain visible when
  // a correction moved their selected endpoints outside it; that outside
  // geometry is not itself an in-target conflict. Supplied conflicts still block.
  const selected = s.records.map(r => { const end = r.administrativeBoundary?.verifiedEndAt ?? r.selected.endAt ?? asOf;
    return { startAt: r.selected.startAt > t.fromAt ? r.selected.startAt : t.fromAt, endAt: end < t.toAt ? end : t.toAt }; }).filter(r => r.startAt < r.endAt);
  const overlaps = selected.some((a, i) => selected.slice(i + 1).some(b => intersects(a.startAt, a.endAt, b.startAt, b.endAt)));
  const conflict = s.conflicts.length > 0 || overlaps, hasWork = complete && s.records.some(r => r.selected.endAt !== null || r.original?.endAt != null);
  const observations = DAY_CLASSIFICATION_OBSERVATIONS.filter((_, i) => [!complete || !ended || administrative, s.pending.length > 0, open, conflict, unassociated.length > 0,
    complete && ended && s.records.length === 0, hasWork][i]);
  const common = new Set<DayClassificationBlocker>();
  if (s.coverage !== "complete") common.add("evidence_incomplete"); if (s.identity !== "matching") common.add("identity_unproven"); if (!s.current) common.add("source_not_current");
  if (!ended) common.add("target_not_ended"); if (input.actorId === t.employeeAuthUserId) common.add("self_review");
  if (s.pending.length) common.add("pending_source"); if (open) common.add("open_record"); if (conflict) common.add("source_conflict"); if (unassociated.length) common.add("unassociated_record");
  if (administrative) common.add("administrative_hours_unassessed");
  const plan = t.kind === "plan" ? s.plans.find(p => p.slotId === t.slotId) : null;
  const covering = plan && !plan.cancelled && plan.hasPublicationEvidence ? s.calendar.filter(c => c.kind === "closure" && c.status === "created" && (c.locationId === null || c.locationId === plan.locationId) && c.fromAt <= plan.startAt && c.toAt >= plan.endAt) : [];
  const statement = s.caseHead?.coverage === "complete" && s.caseHead.latestSelf?.kind === "explain" && s.caseHead.latestSelf.claim === "not_worked" ? s.caseHead.latestSelf : null;
  const candidates = DAY_CLASSIFICATION_OUTCOMES.map(outcome => {
    const found = new Set<DayClassificationBlocker>(outcome === "follow_up" ? common.has("self_review") ? ["self_review"] : [] : common);
    if (outcome === "calendar_exempt") { if (!plan) found.add("plan_required"); if (plan?.cancelled) found.add("plan_cancelled"); if (plan && !plan.hasPublicationEvidence) found.add("publication_missing"); if (!covering.length) found.add("covering_closure_missing"); }
    if (outcome === "not_worked_reported") { if (s.records.length) found.add("work_record_present"); if (!statement) found.add("latest_not_worked_statement_required"); }
    if (outcome === "recorded_work_reviewed" && !hasWork) found.add("recorded_work_required");
    const blockers = BLOCKERS.filter(b => found.has(b)); return { outcome, candidateState: blockers.length ? "blocked" as const : "candidate" as const, blockers,
      calendarReferences: outcome === "calendar_exempt" && !blockers.length ? covering.map(c => ({ entryId: c.entryId, operationId: c.operationId, revision: c.revision, locationId: c.locationId, timeZone: c.timeZone, fromAt: c.fromAt, toAt: c.toAt })) : [],
      selfStatementReference: outcome === "not_worked_reported" && !blockers.length && statement ? { caseId: statement.caseId, operationId: statement.operationId, revision: statement.revision, recordedAt: statement.recordedAt, decisionOperationId: statement.decisionOperationId } : null };
  });
  return freeze({ protocol: DAY_CLASSIFICATION_PREVIEW_PROTOCOL, candidateOnly: true, authorityChecked: false, applied: false, evidenceOrigin: "caller_provided", sourceFingerprintVerified: false, boundariesVerified: false,
    siteId: input.siteId, asOf, target: t, sourceFingerprint: s.fingerprint, evidenceCompleteness: complete ? "caller_claimed_complete" : "incomplete", observations, candidates,
    background: { planCount: s.plans.length, cancelledPlanCount: s.plans.filter(p => p.cancelled).length, calendarCount: s.calendar.length, approvedArrangementCount: s.arrangements.length,
      unassociatedRecordCount: unassociated.length, workDuringClosure: hasWork && covering.length > 0 } });
}
