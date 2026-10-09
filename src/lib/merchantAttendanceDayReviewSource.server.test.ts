// Collector-shaped synthetic values only; no actual SQL/Auth/DB completeness.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { scheduleEvidenceWire, scheduleEvidenceCalendar, scheduleEvidenceLeave, scheduleEvidenceId as id, scheduleEvidenceActor as actor } from "../../scripts/fixtures/attendance-schedule-evidence-model";
import { exceptionUiEligibleSource } from "../../scripts/fixtures/attendance-plan-exception-ui-model";
import { DAY_CLASSIFICATION_INPUT_PROTOCOL, parseDayClassificationInput, type DayClassificationInput } from "./merchantAttendanceDayClassification";
import { DAY_REVIEW_PROTOCOL } from "./merchantAttendanceDayReviewContract";
import { DAY_REVIEW_PRIVATE_SOURCE_PROTOCOL, dayReviewAttendanceFacts, projectDayReviewSource } from "./merchantAttendanceDayReviewSource.server";
import { DAY_REVIEW_SOURCE_VIEW_PROTOCOL, dayReviewClassificationHead, parseDayReviewSourceView, type DayReviewSourceQuery } from "./merchantAttendanceDayReviewSource";
import type { DayReviewSavedResult } from "./merchantAttendanceDayReviewResult";
import { parsePeriodClosureSourceReport } from "./merchantAttendancePeriodClosureSourceReport";
import { projectPeriodClosureSource } from "./merchantAttendancePeriodClosure.server";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
function day(withRecord = false) {
  const query: DayReviewSourceQuery = { siteId: "99990009", access: "owner", mode: "preview", workerId: id(4), workDate: "2026-09-02", slotId: null, caseId: null };
  const wire = scheduleEvidenceWire({ query: { siteId: query.siteId, workerId: query.workerId, fromDate: query.workDate, throughDate: query.workDate }, empty: !withRecord });
  const report = wire.attendance, base = structuredClone(report.base) as unknown as Record<string, unknown>; delete base.asOf;
  const context = { pendingCorrections: [], missing: [], leave: [], calendar: [], plans: { items: [],
    sessions: withRecord ? report.base.items.map(item => ({ item, ruleBinding: null, relation: null, adoption: null, planRuleApproval: null })) : [] }, reviews: [] };
  const dayBoundaries = [{ date: query.workDate, fromAt: report.base.fromAt, toAt: report.base.toAt, skipped: false }];
  const sourceCanonical = { sourceVersion: "attendance-period-source-v1", siteId: query.siteId, workerId: query.workerId, employeeId: id(2), employeeAuthUserId: id(3),
    timeZone: "UTC", fromDate: query.workDate, throughDate: query.workDate, fromAt: report.base.fromAt, toAt: report.base.toAt, dayBoundaries,
    report: { version: report.version, base, missing: [], complete: true, payrollReady: false }, context };
  const sourceText = JSON.stringify(sourceCanonical), raw = { ...sourceCanonical, report, sourceCanonical, sourceText, sourceFingerprint: sha(sourceText),
    readAt: report.base.asOf, blockers: [], complete: true, validation: "owner_checked" };
  const target = { kind: "day" as const, workerId: query.workerId, employeeId: id(2), employeeAuthUserId: id(3), workDate: query.workDate, timeZone: "UTC",
    fromAt: report.base.fromAt, toAt: report.base.toAt, slotId: null };
  const input: DayClassificationInput = { protocol: DAY_CLASSIFICATION_INPUT_PROTOCOL, siteId: query.siteId, actorId: actor, asOf: report.base.asOf, target,
    source: { fingerprint: "a".repeat(64), coverage: "complete", identity: "matching", current: true, plans: [],
      records: withRecord ? [{ kind: "session", sourceId: report.base.items[0].startEventId, operationId: null, revision: 0,
        workerId: target.workerId, employeeId: target.employeeId, employeeAuthUserId: target.employeeAuthUserId,
        locationId: report.base.items[0].events[0].locationId, original: { startAt: report.base.items[0].events[0].occurredAt, endAt: report.base.items[0].events[1].occurredAt },
        selected: { startAt: report.base.items[0].events[0].occurredAt, endAt: report.base.items[0].events[1].occurredAt }, association: null }] : [],
      calendar: [], pending: [], conflicts: [], arrangements: [], caseHead: null } };
  return signed(query, input, raw, sourceCanonical);
}
function signed<T>(query: DayReviewSourceQuery, value: DayClassificationInput, raw: T, base: unknown) {
  const input = structuredClone(value), canonical = ["attendance-day-review-evidence-v1", input.target, base, [], dayReviewAttendanceFacts(parseDayClassificationInput(input))];
  const text = JSON.stringify(canonical); Object.assign(input, { source: { ...input.source, fingerprint: sha(text) } });
  return { query, raw: { protocol: DAY_REVIEW_PRIVATE_SOURCE_PROTOCOL, kind: query.mode, siteId: query.siteId, actorId: actor, readAt: input.asOf,
    query, input, source: { kind: input.target.kind, raw, outages: [], canonical, text, fingerprint: sha(text) }, saved: null as Extract<DayReviewSavedResult, { kind: "detail" }> | null, sourceChanged: null as boolean | null } };
}
function plan() {
  const old = exceptionUiEligibleSource(), query: DayReviewSourceQuery = { siteId: old.siteId, access: "owner", mode: "preview", workerId: old.worker.workerId,
    workDate: old.slot.workDate, slotId: old.slot.id, caseId: null };
  const { workerId, employeeId, employeeAuthUserId } = old.worker;
  const identity = { workerId, employeeId, employeeAuthUserId };
  const startAt = old.slot.startAt.replace(/\.([0-9]{3})Z$/, ".$1000Z"), endAt = old.slot.endAt.replace(/\.([0-9]{3})Z$/, ".$1000Z");
  const input: DayClassificationInput = { protocol: DAY_CLASSIFICATION_INPUT_PROTOCOL, siteId: old.siteId, actorId: old.actorId, asOf: old.readAt,
    target: { kind: "plan", ...identity, workDate: old.slot.workDate, timeZone: old.slot.timeZone, fromAt: startAt, toAt: endAt, slotId: old.slot.id },
    source: { fingerprint: "a".repeat(64), coverage: "complete", identity: "matching", current: true,
      plans: [{ slotId: old.slot.id, ...identity, revision: old.slot.revision, locationId: old.slot.locationId, workDate: old.slot.workDate, timeZone: old.slot.timeZone,
        startAt, endAt, cancelled: false, hasPublicationEvidence: true }],
      records: old.source.sessions.map(s => ({ kind: "session", sourceId: s.startEventId, operationId: null, revision: 0, ...identity, locationId: old.slot.locationId,
        original: { startAt: s.original.startAt!, endAt: s.original.endAt }, selected: { startAt: s.selected.startAt!, endAt: s.selected.endAt },
        association: { slotId: old.slot.id, operationId: s.operationId } })), calendar: [], pending: [], conflicts: [], arrangements: [], caseHead: null } };
  const sourceText = JSON.stringify(old.source), raw = { ...old, sourceText, fingerprint: sha(sourceText) };
  return signed(query, input, raw, old.source);
}

function manyEventsDay(count: number) {
  const { query, raw } = day(true), old = raw.source.raw, first = old.report.base.items[0].events[0];
  const events = Array.from({ length: count }, (_, n) => ({ ...first, id: n === 0 ? first.id : id(300000 + n), sequence: n + 1,
    action: n === 0 ? "clock_in" as const : n === count - 1 ? "clock_out" as const : n % 2 ? "break_start" as const : "break_end" as const,
    breakPaid: n > 0 && n < count - 1 && n % 2 ? false : null,
    occurredAt: n === count - 1 ? "2026-09-02T16:00:00.000000Z" : new Date(Date.parse("2026-09-02T08:00:00.000Z") + n * 1000).toISOString().replace(/\.([0-9]{3})Z$/, ".$1000Z") }));
  old.report.base.items[0].events = events;
  (old.sourceCanonical.report.base as { items: unknown[] }).items = structuredClone(old.report.base.items);
  old.sourceText = JSON.stringify(old.sourceCanonical); old.sourceFingerprint = sha(old.sourceText);
  return signed(query, raw.input, old, old.sourceCanonical);
}

test("C15-A private DAY verifies old raw report and new canonical before stripping all private material", () => {
  for (const hasRecord of [false, true]) {
    const { query, raw } = day(hasRecord), result = projectDayReviewSource(raw, query, actor);
    assert.equal(result.input.source.records.length, hasRecord ? 1 : 0); assert(Object.isFrozen(result.input.target));
    assert.doesNotMatch(JSON.stringify(result), /sourceCanonical|sourceText|latitude|longitude|validation|canonical|sourceVersion/);
    assert.equal(result.protocol, DAY_REVIEW_SOURCE_VIEW_PROTOCOL); assert.deepEqual(parseDayReviewSourceView(result, query, actor), result);
  }
});

test("C15-A outer hash self-consistency cannot drop or change a verified raw work record", () => {
  const { query, raw } = day(true);
  for (const records of [[], [{ ...raw.input.source.records[0], original: { startAt: "2026-09-02T09:00:00.000000Z", endAt: "2026-09-02T10:00:00.000000Z" },
    selected: { startAt: "2026-09-02T09:00:00.000000Z", endAt: "2026-09-02T10:00:00.000000Z" } }]]) {
    const changed = signed(query, { ...raw.input, source: { ...raw.input.source, records } }, raw.source.raw, raw.source.raw.sourceCanonical);
    assert.throws(() => projectDayReviewSource(changed.raw, query, actor));
  }
  const bad = structuredClone(raw); bad.source.raw.report.base.items[0].events[1].sequence = 42;
  assert.throws(() => projectDayReviewSource(bad, query, actor));
  const noProof = structuredClone(raw); noProof.source.raw.context.plans.sessions = [];
  noProof.source.raw.sourceText = JSON.stringify(noProof.source.raw.sourceCanonical); noProof.source.raw.sourceFingerprint = sha(noProof.source.raw.sourceText);
  const inconsistent = signed(query, noProof.input, noProof.source.raw, noProof.source.raw.sourceCanonical);
  assert.throws(() => projectDayReviewSource(inconsistent.raw, query, actor));
});

test("C15-A complete source accepts 1002 real events without widening the old archive guard", () => {
  const { query, raw } = manyEventsDay(1002), old = raw.source.raw;
  assert.equal(parsePeriodClosureSourceReport(old.report, { siteId: query.siteId, access: "owner", workerId: query.workerId,
    employeeId: raw.input.target.employeeId, employeeAuthUserId: raw.input.target.employeeAuthUserId, fromDate: query.workDate,
    throughDate: query.workDate, timeZone: "UTC", fromAt: old.fromAt, toAt: old.toAt, dayBoundaries: old.dayBoundaries }).base.rows[0].eventIds.length, 1002);
  assert.throws(() => projectPeriodClosureSource(old, { siteId: query.siteId, access: "owner", workerId: query.workerId, fromDate: query.workDate,
    throughDate: query.workDate, mode: "preview", periodId: null, operationId: null, version: null }));
  assert.equal(projectDayReviewSource(raw, query, actor).input.source.records.length, 1);
});

test("C15-A first PLAN branch is full173 v1, not a clipped day or an empty v3 substitution", () => {
  const { query, raw } = plan(), result = projectDayReviewSource(raw, query, actor);
  assert.equal(result.input.target.kind, "plan"); assert.equal(result.input.source.records.length, 1);
  assert.equal(result.input.target.fromAt, raw.input.target.fromAt); assert.equal(result.input.target.toAt, raw.input.target.toAt);
  const dropped = signed(query, { ...raw.input, source: { ...raw.input.source, records: [] } }, raw.source.raw, raw.source.raw.source);
  assert.throws(() => projectDayReviewSource(dropped.raw, query, actor));
  assert.throws(() => projectDayReviewSource(raw, { ...query, workDate: "2026-10-09" }, actor));
});

test("C15-A a new self-consistent SHA cannot invent or alter the old full plan/calendar projection", () => {
  const p = plan();
  for (const patch of [{ revision: p.raw.input.source.plans[0].revision + 1 }, { cancelled: true }, { hasPublicationEvidence: false }]) {
    const changed = signed(p.query, { ...p.raw.input, source: { ...p.raw.input.source, plans: [{ ...p.raw.input.source.plans[0], ...patch }] } }, p.raw.source.raw, p.raw.source.raw.source);
    assert.throws(() => projectDayReviewSource(changed.raw, p.query, actor));
  }
  const d = day(), fakePlan = { ...p.raw.input.source.plans[0], workerId: d.raw.input.target.workerId,
    employeeId: d.raw.input.target.employeeId, employeeAuthUserId: d.raw.input.target.employeeAuthUserId,
    workDate: d.query.workDate, startAt: "2026-09-02T08:00:00.000000Z", endAt: "2026-09-02T16:00:00.000000Z" };
  const invented = signed(d.query, { ...d.raw.input, source: { ...d.raw.input.source, plans: [fakePlan] } }, d.raw.source.raw, d.raw.source.raw.sourceCanonical);
  assert.throws(() => projectDayReviewSource(invented.raw, d.query, actor));
  const entryId = id(1995), calendar = { siteId: d.query.siteId, entryId, operationId: entryId, revision: 1 as const, kind: "closure" as const,
    status: "created" as const, locationId: null, timeZone: "UTC", fromDate: d.query.workDate, throughDate: d.query.workDate,
    fromAt: d.raw.input.target.fromAt, toAt: d.raw.input.target.toAt, recordedAt: "2026-09-01T00:00:00.000000Z" };
  const forged = signed(d.query, { ...d.raw.input, source: { ...d.raw.input.source, calendar: [calendar] } }, d.raw.source.raw, d.raw.source.raw.sourceCanonical);
  assert.throws(() => projectDayReviewSource(forged.raw, d.query, actor));
});

test("C15-A normalized pending, arrangement, conflict and current claims must match the complete old source", () => {
  const d = day(true), sourceId = id(1996), operationId = id(1997);
  const patches: Partial<DayClassificationInput["source"]>[] = [
    { pending: [{ kind: "missing", sourceId, operationId, revision: 1 }] },
    { pending: [{ kind: "outage", sourceId, operationId, revision: 1 }] },
    { arrangements: [{ requestId: sourceId, operationId, revision: 1, startAt: "2026-09-02T08:00:00.000000Z", endAt: "2026-09-02T16:00:00.000000Z" }] },
    { conflicts: [{ kind: "work_leave", sourceIds: [d.raw.input.source.records[0].sourceId, sourceId] }] }, { current: false },
  ];
  for (const patch of patches) {
    const changed = signed(d.query, { ...d.raw.input, source: { ...d.raw.input.source, ...patch } }, d.raw.source.raw, d.raw.source.raw.sourceCanonical);
    assert.throws(() => projectDayReviewSource(changed.raw, d.query, actor));
  }
  const p = plan(), changed = signed(p.query, { ...p.raw.input, source: { ...p.raw.input.source, current: false } }, p.raw.source.raw, p.raw.source.raw.source);
  assert.throws(() => projectDayReviewSource(changed.raw, p.query, actor));
});

test("C15-A real-shaped DAY calendar and approved leave retain their saved metadata and overlap observation", () => {
  const d = day(true), old = d.raw.source.raw, leave = scheduleEvidenceLeave(), summary = scheduleEvidenceCalendar(1, { kind: "closure" });
  const calendar = { siteId: d.query.siteId, entryId: summary.entryId, operationId: summary.entryId, revision: 1 as const, kind: "closure" as const,
    status: "created" as const, locationId: null, timeZone: "UTC", fromDate: summary.fromDate, throughDate: summary.throughDate,
    fromAt: d.raw.input.target.fromAt, toAt: d.raw.input.target.toAt, recordedAt: summary.createdAt };
  Object.assign(old.context, { leave: [leave], calendar: [{ summary, operationId: summary.entryId, recordedAt: summary.createdAt,
    fromAt: calendar.fromAt, toAt: calendar.toAt }] });
  old.sourceText = JSON.stringify(old.sourceCanonical); old.sourceFingerprint = sha(old.sourceText);
  const changed = signed(d.query, { ...d.raw.input, source: { ...d.raw.input.source, calendar: [calendar], conflicts: [{ kind: "work_leave",
    sourceIds: [d.raw.input.source.records[0].sourceId, leave.summary.requestId] }] } }, old, old.sourceCanonical);
  const result = projectDayReviewSource(changed.raw, d.query, actor);
  assert.deepEqual(result.input.source.calendar, [calendar]); assert.equal(result.input.source.conflicts[0].kind, "work_leave");
  const dropped = signed(d.query, { ...changed.raw.input, source: { ...changed.raw.input.source, conflicts: [] } }, old, old.sourceCanonical);
  assert.throws(() => projectDayReviewSource(dropped.raw, d.query, actor));
});

test("C15-A canonical SHA excludes this ledger's own head and transient read time", () => {
  const { query, raw } = day(), first = projectDayReviewSource(raw, query, actor), q = { ...query, caseId: id(1991) };
  const saved: Extract<DayReviewSavedResult, { kind: "detail" }> = { protocol: DAY_REVIEW_PROTOCOL, siteId: q.siteId, actorId: actor,
    readAt: raw.readAt, kind: "detail", access: "owner", replayed: false, operation: null,
    head: { caseId: id(1991), target: raw.input.target, openedAt: raw.readAt, revision: 1, latestSelf: null, needsResponse: false,
      latestDecision: { action: "decide", reason: "合成继续核查", outcome: "follow_up", sourceFingerprint: raw.source.fingerprint, observations: ["no_record"],
        calendarReference: null, selfStatementOperationId: null, receipt: { operationId: id(1992), caseId: id(1991), revision: 1, action: "decide",
          actorId: actor, recordedAt: raw.readAt, commandFingerprint: "b".repeat(64) } } } };
  const input = { ...raw.input, asOf: "2026-09-10T12:00:01.000001Z", source: { ...raw.input.source, caseHead: dayReviewClassificationHead(saved) } };
  const next = signed(q, input, raw.source.raw, raw.source.raw.sourceCanonical); next.raw.saved = saved; next.raw.sourceChanged = false;
  assert.equal(projectDayReviewSource(next.raw, q, actor).input.source.fingerprint, first.input.source.fingerprint);
  assert.throws(() => projectDayReviewSource({ ...next.raw, sourceChanged: true }, q, actor));
  assert.throws(() => projectDayReviewSource({ ...next.raw, input: { ...next.raw.input, source: { ...next.raw.input.source, caseHead: null } } }, q, actor));
});

test("C15-A malformed source, foreign query, unknown/private fields, getters and oversized Unicode are refused", () => {
  const { query, raw } = day();
  for (const patch of [{ actorId: id(99) }, { kind: "candidates" }, { readAt: "2026-09-10T12:00:00.000002Z" }, { authorityChecked: true },
    { source: { ...raw.source, fingerprint: "0".repeat(64) } }, { source: { ...raw.source, text: raw.source.text + " " } }])
    assert.throws(() => projectDayReviewSource({ ...raw, ...patch }, query, actor));
  let reads = 0; const getter = { ...raw }; Object.defineProperty(getter, "input", { enumerable: true, get() { reads++; return raw.input; } });
  assert.throws(() => projectDayReviewSource(getter, query, actor)); assert.equal(reads, 0);
  assert.throws(() => projectDayReviewSource({ ...raw, source: { ...raw.source, text: "界".repeat(1400000) } }, query, actor));
});
