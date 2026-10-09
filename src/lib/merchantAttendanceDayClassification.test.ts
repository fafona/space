// Synthetic pure observations ONLY. No SQL/source completeness/Auth acceptance.
import test from "node:test";
import assert from "node:assert/strict";
import { DAY_CLASSIFICATION_INPUT_PROTOCOL, DAY_CLASSIFICATION_OBSERVATIONS, DAY_CLASSIFICATION_OUTCOMES,
  parseDayClassificationInput, parseDayClassificationInputJson, evaluateDayClassification,
  type DayClassificationInput, type DayClassificationRecord, type DayClassificationCalendar, type DayClassificationCaseHead } from "./merchantAttendanceDayClassification";
import { ADMINISTRATIVE_REPORT_BOUNDARY_PROTOCOL } from "./merchantAttendanceAdministrativeBoundary";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const who = { workerId: id(1), employeeId: id(2), employeeAuthUserId: id(3) };
const at = (hour: string, date = "2026-10-07") => `${date}T${hour}:00.000000Z`;
function input(): DayClassificationInput { return { protocol: DAY_CLASSIFICATION_INPUT_PROTOCOL, siteId: "99990001", asOf: at("23:00"), actorId: id(4),
  target: { kind: "plan", ...who, workDate: "2026-10-07", timeZone: "UTC", fromAt: at("09:00"), toAt: at("17:00"), slotId: id(5) },
  source: { fingerprint: "a".repeat(64), coverage: "complete", identity: "matching", current: true, plans: [{ ...who, slotId: id(5), revision: 1, locationId: id(6),
    workDate: "2026-10-07", timeZone: "UTC", startAt: at("09:00"), endAt: at("17:00"), cancelled: false, hasPublicationEvidence: true }], records: [], calendar: [], pending: [], conflicts: [], arrangements: [], caseHead: null } }; }
function record(n = 10, start = "09:00", end: string | null = "17:00"): DayClassificationRecord { const edges = { startAt: at(start), endAt: end === null ? null : at(end) };
  return { kind: "session", sourceId: id(n), operationId: null, revision: 0, ...who, locationId: id(6), original: { ...edges }, selected: { ...edges }, association: { slotId: id(5), operationId: id(n + 100) } }; }
function calendar(patch: Partial<DayClassificationCalendar> = {}): DayClassificationCalendar { return { siteId: "99990001", entryId: id(20), operationId: id(20), revision: 1, kind: "closure", status: "created",
  locationId: null, timeZone: "UTC", fromDate: "2026-10-07", throughDate: "2026-10-07", fromAt: at("00:00"), toAt: at("00:00", "2026-10-08"), recordedAt: at("00:00", "2026-10-06"), ...patch }; }
function head(value = input(), claim: "worked_missing_records" | "not_worked" | "uncertain" = "not_worked"): DayClassificationCaseHead { return { caseId: id(30), target: value.target, revision: 2, coverage: "complete",
  latestDecision: { operationId: id(31), revision: 1, recordedAt: at("18:00") }, latestSelf: { caseId: id(30), operationId: id(32), revision: 2, actorId: who.employeeAuthUserId,
    decisionOperationId: id(31), recordedAt: at("19:00"), kind: "explain", claim } }; }
const evaluate = (value: DayClassificationInput, patch: Partial<DayClassificationInput["source"]> = {}) => evaluateDayClassification({ ...value, source: { ...value.source, ...patch } });
const candidate = (r: ReturnType<typeof evaluate>, outcome: typeof DAY_CLASSIFICATION_OUTCOMES[number]) => r.candidates.find(c => c.outcome === outcome)!;

test("C15-A complete empty plan only observes no_record; no absence, hours, default exemption or invented authority", () => {
  const r = evaluate(input()); assert.deepEqual(r.observations, ["no_record"]); assert.deepEqual(r.candidates.map(c => c.outcome), DAY_CLASSIFICATION_OUTCOMES);
  assert.equal(candidate(r, "follow_up").candidateState, "candidate");
  for (const kind of DAY_CLASSIFICATION_OUTCOMES.slice(1)) assert.equal(candidate(r, kind).candidateState, "blocked");
  assert.equal(r.candidateOnly, true); assert.equal(r.applied, false); assert.equal(r.authorityChecked, false); assert.equal(r.boundariesVerified, false); assert.equal(r.sourceFingerprintVerified, false);
  assert.equal(r.evidenceOrigin, "caller_provided"); assert.equal(r.evidenceCompleteness, "caller_claimed_complete");
  assert.doesNotMatch(JSON.stringify(r), /absent|zero_hours|normal_day|workedUs/);
});

test("C15-A historical zone labels never reinterpret the saved UTC target or calendar geometry", () => {
  const original = input(), timeZone = "Saved/Unavailable_Name", value = { ...original, target: { ...original.target, timeZone },
    source: { ...original.source, plans: original.source.plans.map(p => ({ ...p, timeZone })), calendar: [calendar({ timeZone })] } };
  const parsed = parseDayClassificationInput(value), result = evaluateDayClassification(parsed);
  assert.equal(parsed.target.fromAt, at("09:00")); assert.equal(parsed.target.timeZone, "Saved/Unavailable_Name");
  assert.equal(candidate(result, "calendar_exempt").candidateState, "candidate");
  for (const timeZone of ["+01:00", " UTC", "UTC\n", "Saved//Name", "Saved/Name\0"])
    assert.throws(() => parseDayClassificationInput({ ...value, target: { ...value.target, timeZone } }));
});

test("C15-A incomplete, unproven, stale and unfinished never infer no_record or substantive candidate", () => {
  const original = input();
  const values = [
    { ...original, source: { ...original.source, coverage: "unknown", plans: [] } },
    { ...original, source: { ...original.source, coverage: "over_limit", plans: [] } },
    { ...original, source: { ...original.source, identity: "unproven" } },
    { ...original, source: { ...original.source, current: false } },
    { ...original, asOf: at("16:59") },
  ];
  for (const value of values) { const r = evaluateDayClassification(value); assert.deepEqual(r.observations, ["evidence_insufficient"]);
    assert.equal(candidate(r, "follow_up").candidateState, "candidate"); for (const c of r.candidates.slice(1)) assert.equal(c.candidateState, "blocked"); }
  assert.throws(() => parseDayClassificationInput({ ...original, source: { ...original.source, coverage: "unknown" } }));
  assert.throws(() => parseDayClassificationInput({ ...original, source: { ...original.source, coverage: "over_limit", plans: [], records: [record()] } }));
  for (const patch of [{ identity: "unproven" as const }, { current: false }]) {
    const r = evaluate(original, { ...patch, records: [record()] }); assert(!r.observations.includes("recorded_work")); assert(!r.observations.includes("no_record"));
    assert.equal(candidate(r, "recorded_work_reviewed").candidateState, "blocked");
  }
});

test("C15-A owner!=target is only a candidate fence, not proof of role", () => {
  const r = evaluateDayClassification({ ...input(), actorId: who.employeeAuthUserId });
  for (const c of r.candidates) assert(c.blockers.includes("self_review")); assert.equal(r.authorityChecked, false);
});

test("C15-A closure needs one full original-plan cover and original location; records stay visible", () => {
  const value = input(), r = evaluate(value, { records: [record()], calendar: [calendar(), calendar({ entryId: id(21), operationId: id(21), locationId: id(6) })] });
  assert.deepEqual(r.observations, ["recorded_work"]); assert.equal(candidate(r, "calendar_exempt").candidateState, "candidate");
  assert.equal(candidate(r, "calendar_exempt").calendarReferences.length, 2); assert.equal(r.background.workDuringClosure, true);
  assert.equal(candidate(r, "recorded_work_reviewed").candidateState, "candidate"); assert.equal(candidate(r, "not_worked_reported").candidateState, "blocked");
  assert.deepEqual(value.source.records, []);
});

test("C15-A holiday/cancelled/foreign location/partial/touching/multiple pieces cannot grant closure candidate", () => {
  for (const entries of [[calendar({ kind: "holiday" })], [calendar({ status: "cancelled", revision: 2, operationId: id(22) })], [calendar({ locationId: id(99) })],
    [calendar({ fromAt: at("10:00") })], [calendar({ toAt: at("09:00") })], [calendar({ fromAt: at("17:00") })],
    [calendar({ toAt: at("12:00") }), calendar({ entryId: id(21), operationId: id(21), fromAt: at("12:00") })]]) {
    const r = evaluate(input(), { calendar: entries }); assert(candidate(r, "calendar_exempt").blockers.includes("covering_closure_missing"));
  }
  assert.throws(() => evaluate(input(), { calendar: [calendar({ siteId: "99990002" })] }));
  assert.throws(() => evaluate(input(), { calendar: [calendar({ operationId: id(22) })] }));
});

test("C15-A cross-midnight full plan and supplied DST UTC geometry are never clipped/recomputed", () => {
  const value = input(), plan = { ...value.source.plans[0], timeZone: "Europe/Madrid", workDate: "2026-10-24", startAt: at("22:00", "2026-10-24"), endAt: at("08:00", "2026-10-25") };
  const cross = { ...value, asOf: at("12:00", "2026-10-25"), target: { ...value.target, timeZone: plan.timeZone, workDate: plan.workDate, fromAt: plan.startAt, toAt: plan.endAt }, source: { ...value.source, plans: [plan] } };
  const partial = calendar({ timeZone: "Europe/Madrid", fromDate: "2026-10-24", throughDate: "2026-10-24", fromAt: at("22:00", "2026-10-23"), toAt: at("22:00", "2026-10-24") });
  assert.equal(candidate(evaluate(cross, { calendar: [partial] }), "calendar_exempt").candidateState, "blocked");
  const full = { ...partial, throughDate: "2026-10-25", toAt: at("23:00", "2026-10-25") };
  assert.equal(candidate(evaluate(cross, { calendar: [full] }), "calendar_exempt").candidateState, "candidate");
  assert.throws(() => evaluateDayClassification({ ...cross, target: { ...cross.target, fromAt: at("00:00", "2026-10-25") } }));
  assert.equal(evaluate(cross).target.fromAt, plan.startAt); assert.equal(evaluate(cross).boundariesVerified, false);
});

test("C15-A latest same-case own not_worked statement is explicitly referenced; older/read/uncertain/dispute do not suffice", () => {
  const value = input(), current = head(value), r = evaluate(value, { caseHead: current });
  assert.equal(candidate(r, "not_worked_reported").candidateState, "candidate"); assert.equal(candidate(r, "not_worked_reported").selfStatementReference?.operationId, id(32));
  for (const claim of ["worked_missing_records", "uncertain"] as const) assert.equal(candidate(evaluate(value, { caseHead: head(value, claim) }), "not_worked_reported").candidateState, "blocked");
  const disputed: DayClassificationCaseHead = { ...current, latestSelf: { ...current.latestSelf!, kind: "dispute", claim: null } };
  assert.equal(candidate(evaluate(value, { caseHead: disputed }), "not_worked_reported").candidateState, "blocked");
  assert.equal(candidate(evaluate(value, { caseHead: { ...current, revision: 1, latestSelf: null } }), "not_worked_reported").candidateState, "blocked");
  assert.equal(candidate(evaluate(value, { caseHead: { ...current, coverage: "unknown", latestDecision: null, latestSelf: null } }), "not_worked_reported").candidateState, "blocked");
  for (const patch of [{ revision: 3 }, { latestSelf: { ...current.latestSelf!, actorId: id(90) } }, { latestSelf: { ...current.latestSelf!, decisionOperationId: id(90) } },
    { latestSelf: { ...current.latestSelf!, caseId: id(90) } }, { target: { ...current.target, toAt: at("18:00") } }]) assert.throws(() => evaluate(value, { caseHead: { ...current, ...patch } as DayClassificationCaseHead }));
});

test("C15-A raw, correction and approved missing are real record categories; opposite facts block reported-not-worked", () => {
  const value = input(), base = record(), corrected = { ...base, operationId: id(70), revision: 1, selected: { startAt: at("09:01"), endAt: at("17:01") } };
  const missing: DayClassificationRecord = { ...base, kind: "missing", sourceId: id(71), operationId: id(72), revision: 1, original: null };
  for (const fact of [base, corrected, missing]) { const r = evaluate(value, { records: [fact], caseHead: head(value) });
    assert.deepEqual(r.observations, ["recorded_work"]); assert(candidate(r, "not_worked_reported").blockers.includes("work_record_present")); }
  assert.throws(() => evaluate(value, { records: [{ ...base, original: { ...base.original!, endAt: null }, operationId: id(70), revision: 1 }] }));
  assert.throws(() => evaluate(value, { records: [{ ...missing, operationId: null, revision: 0 }] }));
});

test("C15-A all six pending categories block substantive conclusions, never add hours", () => {
  for (const kind of ["correction", "revision", "missing", "leave", "arrangement", "outage"] as const) {
    const r = evaluate(input(), { pending: [{ kind, sourceId: id(40), operationId: id(41), revision: 1 }], calendar: [calendar()] });
    assert.deepEqual(r.observations, ["pending_source", "no_record"]); for (const c of r.candidates.slice(1)) assert(c.blockers.includes("pending_source"));
  }
});

test("C15-A approved administrative closure stays unknown work, not an open or fabricated completed session", () => {
  const value = input(), raw = record(10, "09:00", null), administrativeBoundary = { protocol: ADMINISTRATIVE_REPORT_BOUNDARY_PROTOCOL,
    operationId: id(80), startEventId: raw.sourceId, startSequence: 1, startAt: at("09:00"), tailEventId: raw.sourceId, tailSequence: 1,
    tailAction: "clock_in" as const, tailOccurredAt: at("09:00"), verifiedEndAt: at("12:00"), recordedAt: at("13:00"), sourceFingerprint: "b".repeat(64) };
  const fact = { ...raw, administrativeBoundary }, r = evaluate(value, { records: [fact], calendar: [calendar()] });
  assert.deepEqual(r.observations, ["evidence_insufficient"]); assert.equal(candidate(r, "follow_up").candidateState, "candidate");
  for (const c of r.candidates.slice(1)) assert(c.blockers.includes("administrative_hours_unassessed"));
  const parsed = parseDayClassificationInput({ ...value, source: { ...value.source, records: [fact] } });
  assert.equal(parsed.source.records[0].original?.endAt, null); assert.equal(parsed.source.records[0].selected.endAt, null);
  // A following real session does not overlap an administratively closed raw
  // chain merely because that original chain still lacks a clock_out.
  const following = record(11, "13:00", "17:00"), combined = evaluate(value, { records: [fact, following] });
  assert(!combined.observations.includes("source_conflict")); assert(!combined.observations.includes("open_record")); assert(combined.observations.includes("recorded_work"));
  for (const patch of [{ sourceId: id(90) }, { selected: { startAt: at("09:00"), endAt: at("12:00") } },
    { operationId: id(81), revision: 1 }, { kind: "missing", original: null }, { administrativeBoundary: { ...administrativeBoundary, recordedAt: at("23:01") } }])
    assert.throws(() => evaluate(value, { records: [{ ...fact, ...patch } as DayClassificationRecord] }));
  const outside = { ...value, target: { ...value.target, fromAt: at("14:00"), toAt: at("17:00") }, source: { ...value.source,
    plans: [{ ...value.source.plans[0], startAt: at("14:00"), endAt: at("17:00") }], records: [fact] } };
  assert.throws(() => evaluateDayClassification(outside));
});

test("C15-A open/conflict/unassociated coexist with positive closed records but block reviewed", () => {
  const records = [record(10, "09:00", "12:00"), { ...record(11, "11:00", null), association: null }];
  const r = evaluate(input(), { records, pending: [{ kind: "revision", sourceId: id(40), operationId: id(41), revision: 1 }] });
  assert.deepEqual(r.observations, DAY_CLASSIFICATION_OBSERVATIONS.filter(x => ["pending_source", "open_record", "source_conflict", "unassociated_record", "recorded_work"].includes(x)));
  for (const b of ["open_record", "source_conflict", "unassociated_record"] as const) assert(candidate(r, "recorded_work_reviewed").blockers.includes(b));
  const adjacent = evaluate(input(), { records: [record(10, "09:00", "12:00"), record(11, "12:00", "17:00")] }); assert(!adjacent.observations.includes("source_conflict"));
  const shifted = [record(10, "09:00", "12:00"), record(11, "12:00", "17:00")].map((r, i) => ({ ...r, operationId: id(200 + i), revision: 1,
    selected: { startAt: at("18:00"), endAt: at("20:00") } }));
  const outside = evaluate(input(), { records: shifted }); assert(!outside.observations.includes("source_conflict")); assert(outside.observations.includes("recorded_work"));
  const leave = evaluate(input(), { records: [record()], conflicts: [{ kind: "work_leave", sourceIds: [id(10), id(50)] }] }); assert(leave.observations.includes("source_conflict"));
});

test("C15-A day list retains both plans and outside/unassociated facts; arrangements are background only", () => {
  const value = input(), day = { ...value, target: { ...value.target, kind: "day" as const, slotId: null, fromAt: at("00:00"), toAt: at("00:00", "2026-10-08") }, asOf: at("01:00", "2026-10-08") };
  const plans = [value.source.plans[0], { ...value.source.plans[0], slotId: id(7), startAt: at("18:00"), endAt: at("20:00"), cancelled: true }];
  const outside = { ...record(12, "21:00", "22:00"), association: null }, r = evaluate(day, { plans, records: [record(), outside] });
  assert.equal(r.background.planCount, 2); assert.equal(r.background.cancelledPlanCount, 1); assert.equal(r.background.unassociatedRecordCount, 1);
  assert.deepEqual(r.observations, ["unassociated_record", "recorded_work"]); assert(candidate(r, "calendar_exempt").blockers.includes("plan_required"));
  const noPlan = evaluate(day, { plans: [], arrangements: [{ requestId: id(80), operationId: id(81), revision: 2, startAt: at("09:00"), endAt: at("17:00") }] });
  assert.deepEqual(noPlan.observations, ["no_record"]); assert.equal(noPlan.background.approvedArrangementCount, 1); assert(!noPlan.observations.includes("recorded_work"));
});

test("C15-A malformed scope/identity/bounds and actual101-item input fail closed without truncation", () => {
  const value = input();
  for (const bad of [{ ...value, actorId: id(4) + "\n" }, { ...value, target: { ...value.target, timeZone: "+01:00" } }, { ...value, asOf: "2026-02-30T00:00:00.000000Z" },
    { ...value, target: { ...value.target, workDate: "2026-02-29" } }, { ...value, target: { ...value.target, slotId: null } },
    { ...value, source: { ...value.source, records: [{ ...record(), employeeAuthUserId: id(90) }] } },
    { ...value, source: { ...value.source, plans: Array.from({ length: 101 }, (_, i) => ({ ...value.source.plans[0], slotId: id(1000 + i) })) } }]) assert.throws(() => parseDayClassificationInput(bad));
  assert.throws(() => evaluate(value, { records: [record(), record()] }));
  assert.throws(() => evaluate(value, { records: [{ ...record(), selected: { startAt: at("17:00"), endAt: at("09:00") } }] }));
});

test("C15-A exact JSON/descriptors/Unicode/tree validation executes zero getters", () => {
  const value = input(); let calls = 0; const unsafe = { ...value }; Object.defineProperty(unsafe, "source", { enumerable: true, get() { calls++; return value.source; } });
  assert.throws(() => parseDayClassificationInput(unsafe)); assert.equal(calls, 0);
  const key = "x".repeat(262145), huge = { ...value }; Object.defineProperty(huge, key, { enumerable: true, get() { calls++; return null; } });
  assert.throws(() => parseDayClassificationInput(huge)); assert.equal(calls, 0);
  for (const suffix of ["\n", "\r\n", "\u2028", "\u2029"]) assert.throws(() => parseDayClassificationInput({ ...value, actorId: value.actorId + suffix }));
  assert.throws(() => parseDayClassificationInput({ ...value, extra: "\ud800" })); assert.throws(() => parseDayClassificationInput({ ...value, extra: "\0" }));
  assert.throws(() => parseDayClassificationInputJson(JSON.stringify(value).replace('"siteId":"99990001"', '"siteId":"99990001","siteId":"99990001"')));
  assert.throws(() => parseDayClassificationInputJson(" ".repeat(262145))); assert.throws(() => parseDayClassificationInput(Object.assign(Object.create({ inherited: true }), value)));
  const cyclic: Record<string, unknown> = { ...value }; cyclic.loop = cyclic; assert.throws(() => parseDayClassificationInput(cyclic));
  const sparse = new Array(1); sparse[2] = record(); assert.throws(() => parseDayClassificationInput({ ...value, source: { ...value.source, records: sparse } }));
});

test("C15-A detached immutable input/output preserve endpoints; source hash remains unverified metadata", () => {
  const mutable = structuredClone({ ...input(), source: { ...input().source, records: [record()], calendar: [calendar()] } });
  const parsed = parseDayClassificationInput(mutable), before = JSON.stringify(mutable), result = evaluateDayClassification(mutable);
  assert.equal(JSON.stringify(mutable), before); assert(Object.isFrozen(parsed)); assert(Object.isFrozen(parsed.source.records[0].selected)); assert(Object.isFrozen(result.candidates[1].calendarReferences));
  assert(Object.isFrozen(DAY_CLASSIFICATION_OBSERVATIONS)); assert(Object.isFrozen(DAY_CLASSIFICATION_OUTCOMES));
  assert.notEqual(parsed, mutable); assert.notEqual(parsed.source.records[0], mutable.source.records[0]);
  assert.deepEqual(parseDayClassificationInputJson(JSON.stringify(mutable)), parsed);
  assert.throws(() => { (result.observations as string[]).push("normal_day"); });
  const changed = evaluateDayClassification({ ...mutable, source: { ...mutable.source, fingerprint: "b".repeat(64) } });
  assert.equal(changed.sourceFingerprint, "b".repeat(64)); assert.equal(changed.sourceFingerprintVerified, false);
});
