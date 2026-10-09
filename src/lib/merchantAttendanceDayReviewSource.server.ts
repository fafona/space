// Private service projection: validate actual old collectors and the new
// canonical material before exposing bounded metadata. Never accepts a client
// candidate/artifact for a writer; the SQL RPC recollects in its own transaction.
import { createHash } from "node:crypto";
import { captureBrowserExact as exact, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { same, stamp, uuid } from "./merchantAttendancePlanExceptionValidation";
import { parseDayClassificationInput, type DayClassificationInput } from "./merchantAttendanceDayClassification";
import { parseDayReviewQuery } from "./merchantAttendanceDayReviewContract";
import { DAY_REVIEW_SOURCE_VIEW_PROTOCOL, parseDayReviewSourceView, type DayReviewSourceQuery } from "./merchantAttendanceDayReviewSource";
import { projectCompletePeriodClosureSource } from "./merchantAttendancePeriodClosure.server";
import { projectPlanPosthocFormalSource } from "./merchantAttendancePlanPosthocFormalSource.server";
import type { PlanPosthocFormalSourceResult } from "./merchantAttendancePlanPosthocFormalSourceContract";
import { validatePeriodOutageContext } from "./merchantAttendancePeriodOutageContext";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

export const DAY_REVIEW_PRIVATE_SOURCE_PROTOCOL = "attendance-day-review-source-v1";
function invalid(): never { throw new MerchantAttendanceError("attendance_day_review_invalid"); }
function object(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) invalid(); return raw as Record<string, unknown>;
}
function savedInstant6(raw: string): string { return raw.length === 24 ? stamp(raw, 3).slice(0, 23) + "000Z" : stamp(raw); }
// The general browser tree guard caps arrays at 1000. Actual private collectors
// permit 2002 events in one session and 4000 in the full source; don't silently
// narrow that accepted business boundary merely by reusing the browser helper.
function privateTree(raw: unknown): void {
  let nodes = 0; const ancestors = new Set<object>();
  const visit = (v: unknown, depth: number): void => {
    if (++nodes > 250000 || depth > 40) invalid();
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "string") {
      if (v.length > 4194304 || v.includes("\0")) invalid();
      for (let i = 0; i < v.length; i++) { const n = v.charCodeAt(i);
        if (n >= 0xd800 && n <= 0xdbff) { const next = v.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) invalid(); }
        else if (n >= 0xdc00 && n <= 0xdfff) invalid(); }
      return;
    }
    if (typeof v === "number") { if (!Number.isFinite(v) || Object.is(v, -0)) invalid(); return; }
    if (typeof v !== "object" || ancestors.has(v)) invalid(); ancestors.add(v);
    const array = Array.isArray(v), keys = Reflect.ownKeys(v), proto = Object.getPrototypeOf(v);
    if (array ? proto !== Array.prototype || v.length > 4000 || keys.length !== v.length + 1 : proto !== Object.prototype && proto !== null) invalid();
    for (const key of keys) { if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)) invalid();
      if (array && key === "length") continue;
      if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= (v as unknown[]).length)) invalid();
      const d = Object.getOwnPropertyDescriptor(v, key)!; if (!("value" in d) || !d.enumerable) invalid(); visit(d.value, depth + 1); }
    if (array) for (let i = 0; i < v.length; i++) if (!Object.hasOwn(v, String(i))) invalid(); ancestors.delete(v);
  };
  visit(raw, 0); if (Buffer.byteLength(JSON.stringify(raw), "utf8") > 4194304) invalid();
}
export function dayReviewAttendanceFacts(input: DayClassificationInput) {
  const { fingerprint: _f, current: _c, caseHead: _h, ...facts } = input.source; void _f; void _c; void _h; return facts;
}
function planOutages(raw: unknown, input: DayClassificationInput) {
  if (!Array.isArray(raw) || raw.length > 100) invalid(); if (!raw.length) return [];
  const t = input.target;
  const worker = { workerId: t.workerId, employeeId: t.employeeId, employeeAuthUserId: t.employeeAuthUserId, workerName: "Saved target", workerNo: "SAVED" };
  const range = { fromDate: t.workDate, throughDate: t.workDate, timeZone: t.timeZone, startAt: t.fromAt, endAt: t.toAt };
  // Pure reuse of the saved outage-ledger wire validator for this complete
  // slot interval. No period UUID/artifact is created, queried or persisted;
  // this adapter does not call the interval a complete civil day.
  const parsed = validatePeriodOutageContext({ sourceVersion: "attendance-period-source-v4", siteId: input.siteId,
    workerId: t.workerId, employeeId: t.employeeId, employeeAuthUserId: t.employeeAuthUserId,
    fromDate: t.workDate, throughDate: t.workDate, timeZone: t.timeZone, fromAt: t.fromAt, toAt: t.toAt,
    context: { pendingCorrections: [], missing: [], leave: [], calendar: [], plans: { items: [], sessions: [] }, reviews: [], outages: raw } }, worker, range);
  for (const item of parsed) for (const e of [item.current, item.proposal, item.response]) if (e !== null && e.recordedAt > input.asOf) invalid();
  if (!same(parsed, raw)) invalid(); return parsed;
}
function rows(raw: unknown): Record<string, unknown>[] { if (!Array.isArray(raw)) invalid(); return raw.map(object); }
function equalMembers(actual: readonly unknown[], expected: readonly unknown[], key: (v: Record<string, unknown>) => string): void {
  const ordered = (values: readonly unknown[]) => [...values].map(object).sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
  if (!same(ordered(actual), ordered(expected))) invalid();
}
// The normalizer's own outer SHA is not independent proof that it retained
// the old collector's plans, calendar or pending context. Compare those bounded
// projections with the already-validated full raw source as well.
function requireNormalizedContext(input: DayClassificationInput, context: Record<string, unknown>, slots: Record<string, unknown>[],
  leave: Record<string, unknown>[], outages: Record<string, unknown>[], day: boolean, observed: string): void {
  const t = input.target, identity = { workerId: t.workerId, employeeId: t.employeeId, employeeAuthUserId: t.employeeAuthUserId };
  const plans = slots.filter(s => savedInstant6(String(s.startAt)) < t.toAt && savedInstant6(String(s.endAt)) > t.fromAt).map(s => ({
    slotId: s.id, revision: s.revision, ...identity, locationId: s.locationId, workDate: s.workDate, timeZone: s.timeZone,
    startAt: savedInstant6(String(s.startAt)), endAt: savedInstant6(String(s.endAt)), cancelled: s.cancelled, hasPublicationEvidence: s.hasPublicationEvidence,
  }));
  equalMembers(input.source.plans, plans, p => String(p.slotId));
  const list = (key: string): Record<string, unknown>[] => context[key] === undefined ? [] : rows(day ? context[key] : object(context[key]).items);
  const calendar = list("calendar").map(c => {
    const s = day ? object(c.summary) : c;
    return { siteId: input.siteId, entryId: s.entryId, operationId: c.operationId, revision: s.revision, kind: s.kind, status: s.status,
      locationId: s.locationId, timeZone: s.timeZone, fromDate: s.fromDate, throughDate: s.throughDate,
      fromAt: savedInstant6(String(c.fromAt)), toAt: savedInstant6(String(c.toAt)), recordedAt: savedInstant6(String(c.recordedAt)) };
  });
  equalMembers(input.source.calendar, calendar, c => String(c.entryId));
  const pending = list("pendingCorrections").map(p => ({ kind: p.kind, sourceId: p.requestId, operationId: p.operationId, revision: p.revision }));
  for (const [kind, items] of [["missing", list("missing")], ["leave", leave]] as const) for (const p of items)
    if (p.status === "submitted") pending.push({ kind, sourceId: p.requestId, operationId: p.operationId, revision: p.revision });
  const arrangements: Record<string, unknown>[] = [];
  for (const a of list("workArrangements")) {
    const history = rows(a.history), last = history.at(-1); if (!last) invalid();
    if (a.status === "submitted") pending.push({ kind: "arrangement", sourceId: a.requestId, operationId: last.operationId, revision: a.revision });
    if (a.status === "approved") arrangements.push({ requestId: a.requestId, operationId: last.operationId, revision: a.revision,
      startAt: savedInstant6(String(a.startAt)), endAt: savedInstant6(String(a.endAt)) });
  }
  equalMembers(input.source.pending.filter(p => p.kind !== "outage"), pending, p => `${p.kind}:${p.sourceId}:${p.operationId}`);
  equalMembers(input.source.arrangements, arrangements, a => String(a.requestId));
  const unresolved = outages.filter(o => object(o.status).resolved !== true), actualOutages = input.source.pending.filter(p => p.kind === "outage");
  if (actualOutages.length !== unresolved.length) invalid();
  for (const o of unresolved) {
    const p = actualOutages.find(p => p.sourceId === o.declarationId); if (!p) invalid();
    // An unreviewed declaration's original operation is checked in SQL against
    // the immutable declaration ledger; that operation is not in this raw DTO.
    if (o.current === null ? p.revision !== 1 : p.operationId !== object(o.current).operationId || p.revision !== object(o.current).revision) invalid();
  }
  const conflicts: { kind: string; sourceIds: string[] }[] = [], records = [...input.source.records].sort((a, b) =>
    a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0);
  const end = (r: typeof records[number]) => {
    const at = r.administrativeBoundary?.verifiedEndAt ?? r.selected.endAt ?? observed; return at < t.toAt ? at : t.toAt;
  };
  for (let i = 0; i < records.length; i++) {
    const a = records[i];
    for (const b of records.slice(i + 1)) if ([t.fromAt, a.selected.startAt, b.selected.startAt].sort().at(-1)! < [end(a), end(b)].sort()[0])
      conflicts.push({ kind: "records_overlap", sourceIds: [a.sourceId, b.sourceId] });
    for (const l of leave) if (l.status === "approved" && [t.fromAt, a.selected.startAt, savedInstant6(String(l.startAt))].sort().at(-1)! < [end(a), savedInstant6(String(l.endAt))].sort()[0])
      conflicts.push({ kind: "work_leave", sourceIds: [a.sourceId, String(l.requestId)] });
  }
  // SQL builds pair order before sorting its final records. Pair membership is
  // meaningful here, not incidental source traversal order.
  const normalized = (values: readonly { kind: string; sourceIds: readonly string[] }[]) => values.map(c => ({ kind: c.kind, sourceIds: [...c.sourceIds].sort() }));
  equalMembers(normalized(input.source.conflicts), normalized(conflicts), c => `${c.kind}:${JSON.stringify(c.sourceIds)}`);
}
function requirePlanRecords(input: DayClassificationInput, old: PlanPosthocFormalSourceResult): void {
  const basis = old.protocol === "plan-exception-source-v3" ? old.source.evaluation.basis : old.source;
  const expected = new Map<string, { kind: "session" | "missing"; sourceId: string; operationId: string | null; revision: number;
    original: { startAt: string | null; endAt: string | null } | null; selected: { startAt: string | null; endAt: string | null } }>();
  const add = (item: NonNullable<ReturnType<typeof expected.get>>) => {
    const spans = [item.original, item.selected].filter(v => v !== null);
    if (!spans.some(v => v.startAt !== null && v.startAt < input.target.toAt && (v.endAt === null || v.endAt > input.target.fromAt))) return;
    const key = item.kind + ":" + item.sourceId, prior = expected.get(key);
    if (prior && !same(prior, item)) invalid(); expected.set(key, item);
  };
  for (const session of [...basis.sessions, ...basis.context.unassociated.items]) add({ kind: "session", sourceId: session.startEventId,
    operationId: session.effect?.operationId ?? null, revision: session.effect?.revision ?? 0, original: session.original, selected: session.selected });
  for (const missing of basis.context.missing.items) if (missing.isCurrentApproved) add({ kind: "missing", sourceId: missing.requestId,
    operationId: missing.operationId, revision: missing.revision, original: null, selected: { startAt: missing.startAt, endAt: missing.endAt } });
  if (old.protocol === "plan-exception-source-v3") for (const observation of old.source.evaluation.observations) {
    const current = observation.current; if (current === null) continue;
    const r = current.reference;
    if (r.kind === "session") add({ kind: "session", sourceId: r.startEventId, operationId: r.effectOperationId,
      revision: r.effectRevision ?? 0, original: current.original, selected: current.selected });
    else {
      const missing = basis.context.missing.items.find(m => m.isCurrentApproved && m.operationId === r.approvalOperationId);
      const relevant = [current.original, current.selected].some(v => v !== null && v.startAt !== null && v.startAt < input.target.toAt
        && (v.endAt === null || v.endAt > input.target.fromAt));
      if (!missing) { if (relevant) invalid(); continue; }
      add({ kind: "missing", sourceId: missing.requestId, operationId: missing.operationId, revision: missing.revision,
        original: null, selected: current.selected });
    }
  }
  if (input.source.records.length !== expected.size) invalid();
  for (const item of expected.values()) {
    const actual = input.source.records.find(r => r.kind === item.kind && r.sourceId === item.sourceId);
    if (!actual || actual.operationId !== item.operationId || actual.revision !== item.revision
      || !same(actual.original, item.original) || !same(actual.selected, item.selected)) invalid();
  }
}
export function projectDayReviewSource(raw: unknown, rawQuery: DayReviewSourceQuery, actorId: string) {
  try {
    privateTree(raw); const detached = JSON.parse(JSON.stringify(raw)), query = parseDayReviewQuery(rawQuery), actor = uuid(actorId);
    if (query.mode !== "candidates" && query.mode !== "preview") invalid();
    const v = exact(detached, ["protocol", "kind", "siteId", "actorId", "readAt", "query", "source", "input", "saved", "sourceChanged"]);
    if (v.protocol !== DAY_REVIEW_PRIVATE_SOURCE_PROTOCOL || v.kind !== query.mode || v.siteId !== query.siteId || v.actorId !== actor
      || !same(parseDayReviewQuery(v.query), query)) invalid();
    const input = parseDayClassificationInput(v.input), source = exact(v.source, ["kind", "raw", "outages", "canonical", "text", "fingerprint"]);
    const target = input.target, readAt = stamp(v.readAt);
    if (source.kind !== target.kind || input.siteId !== query.siteId || input.actorId !== actor || input.asOf !== readAt
      || input.source.coverage !== "complete" || input.source.identity !== "matching" || source.fingerprint !== input.source.fingerprint) invalid();
    let baseCanonical: unknown, outages: unknown;
    if (target.kind === "day") {
      if (!Array.isArray(source.outages) || source.outages.length) invalid(); outages = [];
      const old = projectCompletePeriodClosureSource(source.raw, { siteId: query.siteId, access: "owner", workerId: query.workerId,
        fromDate: query.workDate, throughDate: query.workDate, mode: "preview", periodId: null, operationId: null, version: null });
      const a = old.artifact;
      if (a.worker.employeeId !== target.employeeId || a.worker.employeeAuthUserId !== target.employeeAuthUserId
        || a.period.timeZone !== target.timeZone || a.period.startAt !== target.fromAt || a.period.endAt !== target.toAt
        || a.report.base.asOf > readAt) invalid();
      // A second self-consistent outer SHA may not hide an actual raw shift or
      // turn a correction's selected endpoints back into the original ones.
      const rawReport = object(object(source.raw).report), rawRows = object(rawReport.base).items;
      if (!Array.isArray(rawRows) || input.source.records.length !== a.report.base.rows.length + a.report.missing.length) invalid();
      const context = object(a.source.context), plans = object(context.plans), sessions = rows(plans.sessions);
      for (const row of a.report.base.rows) {
        const record = input.source.records.find(r => r.kind === "session" && r.sourceId === row.startEventId);
        const wireRow = rawRows.find(raw => object(raw).startEventId === row.startEventId), events = object(wireRow).events;
        const proofs = sessions.filter(s => object(s.item).startEventId === row.startEventId);
        if (proofs.length !== 1 || !same(proofs[0].item, wireRow)) invalid();
        if (!Array.isArray(events) || !events.length || !record || record.locationId !== object(events[0]).locationId
          || record.operationId !== (row.correction?.operationId ?? null) || record.revision !== (row.correction?.revision ?? 0)
          || !same(record.original, { startAt: row.original.startAt, endAt: row.original.endAt })
          || !same(record.selected, { startAt: row.selected.startAt, endAt: row.selected.endAt })
          || !same(record.administrativeBoundary ?? null, row.administrativeBoundary ?? null)) invalid();
      }
      const missingContext = object(a.source.context).missing;
      if (!Array.isArray(missingContext)) invalid();
      for (const missing of a.report.missing) {
        const record = input.source.records.find(r => r.kind === "missing" && r.sourceId === missing.requestId);
        const proof = missingContext.find(raw => object(raw).requestId === missing.requestId && object(raw).operationId === missing.operationId);
        if (!record || !proof || record.locationId !== missing.locationId || record.original !== null
          || record.operationId !== missing.operationId || record.revision !== object(proof).revision
          || !same(record.selected, { startAt: missing.proposal.startAt, endAt: missing.proposal.endAt })) invalid();
      }
      if (!input.source.current) invalid();
      requireNormalizedContext(input, context, rows(plans.items).map(p => object(p.slot)), rows(context.leave).map(l => ({ ...object(l.summary), operationId: l.operationId })),
        context.outages === undefined ? [] : rows(context.outages), true, a.report.base.asOf);
      baseCanonical = a.source;
    } else {
      const old = projectPlanPosthocFormalSource(source.raw, { siteId: query.siteId, workerId: query.workerId, slotId: target.slotId! }, actor);
      if (old.worker.employeeId !== target.employeeId || old.worker.employeeAuthUserId !== target.employeeAuthUserId
        || old.slot.workDate !== target.workDate || old.slot.timeZone !== target.timeZone
        || savedInstant6(old.slot.startAt) !== target.fromAt || savedInstant6(old.slot.endAt) !== target.toAt || old.readAt > readAt) invalid();
      requirePlanRecords(input, old);
      baseCanonical = old.source; outages = planOutages(source.outages, input);
      const basis = old.protocol === "plan-exception-source-v3" ? old.source.evaluation.basis : old.source;
      const current = old.protocol !== "plan-exception-source-v3" || !old.source.evaluation.resolutionBlockers.some(b => b === "source_changed" || b === "source_unavailable");
      if (input.source.current !== current) invalid();
      const leave = old.protocol === "plan-exception-source-v3" ? old.source.evaluation.leave.items : basis.context.leave.items;
      requireNormalizedContext(input, object(basis.context), [object(old.slot)], rows(leave), rows(outages), false, old.readAt);
    }
    const canonical = ["attendance-day-review-evidence-v1", target, baseCanonical, outages, dayReviewAttendanceFacts(input)];
    if (typeof source.text !== "string" || Buffer.byteLength(source.text, "utf8") > 1048576
      || createHash("sha256").update(source.text, "utf8").digest("hex") !== source.fingerprint
      || !same(parseCaptureBrowserJson(source.text), source.canonical) || !same(canonical, source.canonical)) invalid();
    return parseDayReviewSourceView({ protocol: DAY_REVIEW_SOURCE_VIEW_PROTOCOL, kind: v.kind, siteId: query.siteId, actorId: actor, readAt,
      input, saved: v.saved, sourceChanged: v.sourceChanged }, query, actor);
  } catch { return invalid(); }
}
