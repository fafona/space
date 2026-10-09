import assert from "node:assert/strict";
import test from "node:test";
import { emptyAttendanceRuleDraft, RULE_KEYS, type AttendanceRuleDraft } from "./merchantAttendanceRuleDraft";
import { attendanceDayUtcRange } from "./merchantAttendanceTime";
import { parseRuleSourcesResult, type RuleSourcesQuery, type RuleSourcesResult, type RuleSourcesPersonalItem } from "./merchantAttendanceRuleSources";
import type { SourcesAssignment } from "./merchantAttendanceSources";
import type { GroupAssignmentDetail, GroupAssignmentItem } from "./merchantAttendanceGroups";
import type { RulesItem } from "./merchantAttendanceRules";
import { resolveCandidateThreeLayerRules as resolve, THREE_LAYER_RULE_MAX_SEGMENTS, type CandidateThreeLayerRulesResolution } from "./merchantAttendanceThreeLayerRules";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const query: RuleSourcesQuery = { siteId: "99990001", workerId: id(201), fromDate: "2026-10-24", throughDate: "2026-10-26" };
const stamp = "2026-09-01T10:00:00.123456Z", readAt = "2026-10-27T12:00:00.123456Z";
const values = (patch: Partial<AttendanceRuleDraft> = {}): AttendanceRuleDraft => ({ ...emptyAttendanceRuleDraft(), ...patch });
function source(q = query, timeZone = "UTC"): RuleSourcesResult {
  return parseRuleSourcesResult({ protocol: "rule-sources-v1", siteId: q.siteId, actorId: id(99), fromDate: q.fromDate, throughDate: q.throughDate,
    worker: { workerId: q.workerId, workerName: "Current worker", workerNo: "RULE-201", employeeId: id(101), employeeAuthUserId: id(102), version: 5, active: true, employeeActive: true },
    settingsVersion: 5, timeZone, fromAt: attendanceDayUtcRange(q.fromDate, timeZone).startAt, toAt: attendanceDayUtcRange(q.throughDate, timeZone).endAt, readAt,
    assignments: { limited: false, items: [] }, rules: { limited: false, items: [{ groupId: null, revision: 0, publications: [] }] },
    personal: { revision: 0, limited: false, items: [] } }, q, id(99));
}
function publication(revision = 2, effectiveOn = "2026-10-23", patch: Partial<AttendanceRuleDraft> = {}, groupId: string | null = null, timeZone = "UTC"): RulesItem {
  return { revision, operationId: id(10000 + revision + (groupId ? Number(groupId.slice(-6)) * 100 : 0)), actorId: id(98), action: "publish", reason: "Original candidate",
    recordedAt: stamp, settingsVersion: 1, groupRevision: groupId === null ? null : 1, timeZone, rules: values(patch), effectiveOn,
    effectiveAt: attendanceDayUtcRange(effectiveOn, timeZone).startAt, publishedRevision: null };
}
function stream(s: RuleSourcesResult, groupId: string | null, publications: RulesItem[], revision = Math.max(0, ...publications.map(p => p.revision))) {
  const value = { groupId, revision, publications }, index = s.rules.items.findIndex(item => item.groupId === groupId);
  if (index < 0) s.rules.items.push(value); else s.rules.items[index] = value;
}
function assignment(n = 601, groupId = id(501), startsOn = "2026-10-24", endsOn: string | null = "2026-10-26", timeZone = "UTC", status: "assigned" | "ended" | "cancelled" = "assigned"): SourcesAssignment {
  const original: GroupAssignmentItem = { assignmentId: id(n), groupId, groupName: "Original group", workerId: query.workerId, workerName: "Old name", workerNo: "OLD",
    employeeId: id(101), timeZone, startsOn, endsOn: status === "ended" ? null : endsOn, createdAt: stamp, updatedAt: stamp, revision: 1, status: "assigned" };
  const history: GroupAssignmentDetail["history"] = [{ item: original, command: { action: "assign", operationId: id(n), reason: "Assign", groupId,
    workerId: query.workerId, expectedGroupRevision: 1, expectedWorkerVersion: 1, expectedSettingsVersion: 1, timeZone, startsOn, endsOn: original.endsOn } }];
  const item: GroupAssignmentItem = status === "assigned" ? { ...original } : { ...original, endsOn, status, revision: 2, updatedAt: "2026-09-02T10:00:00.123456Z" };
  if (status === "ended") history.push({ item, command: { action: "end", operationId: id(n + 1000), assignmentId: id(n), expectedRevision: 1, reason: "End", endsOn: endsOn! } });
  if (status === "cancelled") history.push({ item, command: { action: "cancel", operationId: id(n + 1000), assignmentId: id(n), expectedRevision: 1, reason: "Cancel" } });
  return { detail: { ...item, history, canEnd: status === "assigned" && endsOn === null, canCancel: status !== "cancelled" },
    currentGroup: { groupId, revision: 4, name: "Current group", description: "", active: true, createdAt: stamp, updatedAt: stamp },
    fromAt: attendanceDayUtcRange(startsOn, timeZone).startAt, toAt: endsOn === null ? null : attendanceDayUtcRange(endsOn, timeZone).endAt,
    inPeriod: status !== "cancelled", originalInPeriod: true };
}
function group(s: RuleSourcesResult, a = assignment(), publications: RulesItem[] = []) { s.assignments.items.push(a); stream(s, a.detail.groupId, publications); }
function personal(revision = 1, startsOn = "2026-10-24", endsOn = "2026-10-26", patch: Partial<AttendanceRuleDraft> = {}, timeZone = "UTC", withdrawnRevision: number | null = null): RuleSourcesPersonalItem {
  const approval: RuleSourcesPersonalItem["approval"] = { revision, operationId: id(50000 + revision), actorId: id(97), action: "approve", reason: "Owner-approved candidate",
    recordedAt: `2026-09-01T10:00:00.${String(123455 + revision).padStart(6, "0")}Z`, employeeId: id(101), employeeAuthUserId: id(102), workerVersion: 2, settingsVersion: 2, timeZone, startsOn, endsOn,
    fromAt: attendanceDayUtcRange(startsOn, timeZone).startAt, toAt: attendanceDayUtcRange(endsOn, timeZone).endAt,
    rules: values({ lateGraceMinutes: { mode: "value", minutes: 1 }, ...patch }), approvedRevision: null };
  return { approval, withdrawal: withdrawnRevision === null ? null : { ...structuredClone(approval), action: "withdraw", approvedRevision: revision,
    revision: withdrawnRevision, operationId: id(50000 + withdrawnRevision), actorId: id(99), reason: "Withdraw before start",
    recordedAt: `2026-09-01T10:00:00.${String(123455 + withdrawnRevision).padStart(6, "0")}Z` } };
}
function people(s: RuleSourcesResult, items: RuleSourcesPersonalItem[], revision = Math.max(0, ...items.flatMap(p => [p.approval.revision, p.withdrawal?.revision ?? 0]))) {
  s.personal = { revision, limited: false, items };
}
function coverage(r: CandidateThreeLayerRulesResolution, s: RuleSourcesResult) {
  assert.equal(r.segments[0].fromAt, s.fromAt); assert.equal(r.segments.at(-1)!.toAt, s.toAt);
  for (let index = 0; index < r.segments.length; index++) {
    assert(r.segments[index].fromAt < r.segments[index].toAt);
    if (index) assert.equal(r.segments[index - 1].toAt, r.segments[index].fromAt);
  }
  assert.equal(r.formalReady, false); assert.equal(r.applied, false); assert(r.segments.length <= THREE_LAYER_RULE_MAX_SEGMENTS);
}
function blocked(r: CandidateThreeLayerRulesResolution, code: string) {
  for (const segment of r.segments) {
    assert.equal(segment.status, "blocked"); assert(segment.blockers.includes(code));
    for (const field of Object.values(segment.fields)) assert.deepEqual(field, { state: "blocked", minutes: null, source: null, trace: [] });
  }
}

test("complete absent personal source has missing_approval, no assigned group has no_assignment, never unread or implicit zero", () => {
  const s = source(), r = resolve(s); coverage(r, s); assert.equal(r.protocol, "candidate-three-layer-rules-v1");
  assert.equal(r.personalRevision, 0); assert.equal(r.employeeAuthUserId, id(102));
  assert.deepEqual(r.limitations, ["candidate_rules_not_applied", "historical_context_not_pinned"]);
  for (const field of Object.values(r.segments[0].fields)) {
    assert.equal(field.state, "unconfigured"); assert.equal(field.minutes, null); assert.equal(field.source, null);
    assert.deepEqual(field.trace.map(t => [t.layer, t.mode, t.ledgerRevision]), [["personal", "missing_approval", 0], ["group", "no_assignment", null], ["enterprise", "missing_publication", 0]]);
  }
  for (const key of ["attendance", "schedule", "leave", "calendar", "payroll", "assessment"]) assert.equal(key in r, false);
});

test("personal then group then enterprise resolves each field and keeps explicit zero, disabled and all three traces", () => {
  const s = source(); stream(s, null, [publication(2, "2026-10-23", { lateGraceMinutes: { mode: "value", minutes: 9 }, earlyGraceMinutes: { mode: "value", minutes: 10 },
    openSpanWarningMinutes: { mode: "value", minutes: 500 }, completedBreakMinimumMinutes: { mode: "value", minutes: 20 } })]);
  group(s, assignment(), [publication(2, "2026-10-23", { lateGraceMinutes: { mode: "value", minutes: 5 }, earlyGraceMinutes: { mode: "value", minutes: 6 },
    openSpanWarningMinutes: { mode: "value", minutes: 480 } }, id(501))]);
  people(s, [personal(1, "2026-10-24", "2026-10-26", { lateGraceMinutes: { mode: "value", minutes: 0 }, earlyGraceMinutes: { mode: "disabled" } })]);
  const fields = resolve(s).segments[0].fields;
  assert.equal(fields.lateGraceMinutes.minutes, 0); assert.equal(fields.lateGraceMinutes.source?.layer, "personal");
  assert.equal(fields.earlyGraceMinutes.state, "disabled"); assert.equal(fields.earlyGraceMinutes.minutes, null);
  assert.equal(fields.openSpanWarningMinutes.minutes, 480); assert.equal(fields.openSpanWarningMinutes.source?.layer, "group");
  assert.equal(fields.completedBreakMinimumMinutes.minutes, 20); assert.equal(fields.completedBreakMinimumMinutes.source?.layer, "enterprise");
  assert.deepEqual(fields.lateGraceMinutes.trace.map(t => t.minutes), [0, 5, 9]);
  assert(Object.values(fields).every(f => f.trace.map(t => t.layer).join() === "personal,group,enterprise"));
});

test("latest group inherit falls through to enterprise, not to an older group publication", () => {
  const s = source(); stream(s, null, [publication(2, "2026-10-23", { lateGraceMinutes: { mode: "value", minutes: 7 } })]);
  group(s, assignment(), [publication(2, "2026-10-23", { lateGraceMinutes: { mode: "value", minutes: 99 } }, id(501)), publication(4, "2026-10-25", {}, id(501))]);
  people(s, [personal(1, "2026-10-24", "2026-10-26", { lateGraceMinutes: { mode: "inherit" }, earlyGraceMinutes: { mode: "disabled" } })]);
  const r = resolve(s); coverage(r, s); assert.deepEqual(r.segments.map(s => s.fields.lateGraceMinutes.minutes), [99, 7]);
  const trace = r.segments[1].fields.lateGraceMinutes.trace;
  assert.deepEqual(trace.map(t => t.mode), ["inherit", "inherit", "value"]);
  assert.equal(trace[1].source?.layer, "group"); if (trace[1].source?.layer === "group") assert.equal(trace[1].source.publishRevision, 4);
});

test("known missing group publication falls through but enterprise disabled still stops, never zero", () => {
  const s = source(); group(s); stream(s, null, [publication(2, "2026-10-23", { earlyGraceMinutes: { mode: "disabled" } })]);
  people(s, [personal()]); const field = resolve(s).segments[0].fields.earlyGraceMinutes;
  assert.equal(field.state, "disabled"); assert.equal(field.minutes, null); assert.equal(field.source?.layer, "enterprise");
  assert.deepEqual(field.trace.map(t => t.mode), ["inherit", "missing_publication", "disabled"]);
});

test("personal starts and ends use half-open boundaries and restore lower-tier values after exclusive end", () => {
  const s = source(); stream(s, null, [publication(2, "2026-10-23", { lateGraceMinutes: { mode: "value", minutes: 8 } })]);
  people(s, [personal(1, "2026-10-25", "2026-10-25")]); const r = resolve(s); coverage(r, s);
  assert.deepEqual(r.segments.map(s => [s.fromAt, s.toAt, s.fields.lateGraceMinutes.minutes]), [
    ["2026-10-24T00:00:00.000Z", "2026-10-25T00:00:00.000Z", 8], ["2026-10-25T00:00:00.000Z", "2026-10-26T00:00:00.000Z", 1],
    ["2026-10-26T00:00:00.000Z", "2026-10-27T00:00:00.000Z", 8] ]);
  assert.deepEqual(r.segments.map(s => s.personalApprovalRevision), [undefined, 1, undefined]);
});

test("long personal carry-in keeps immutable original dates, IDs, versions, microseconds and historical owner provenance", () => {
  const s = source(); people(s, [personal(1, "2026-10-01", "2026-10-31", {}, "America/New_York")], 85);
  const r = resolve(s); coverage(r, s); assert.equal(r.segments.length, 1);
  const p = r.segments[0].fields.lateGraceMinutes.source; assert(p?.layer === "personal");
  assert.deepEqual(p, { layer: "personal", groupId: null, ledgerRevision: 85, approvalRevision: 1, employeeId: id(101), employeeAuthUserId: id(102),
    workerVersion: 2, settingsVersion: 2, operationId: id(50001), actorId: id(97), timeZone: "America/New_York", startsOn: "2026-10-01", endsOn: "2026-10-31",
    fromAt: "2026-10-01T04:00:00.000Z", toAt: "2026-11-01T04:00:00.000Z", recordedAt: stamp });
});

test("adjacent personal intervals can have nonchronological ledger revisions without gaps or ordering by approval time", () => {
  const s = source(); people(s, [personal(1, "2026-10-25", "2026-10-26", { lateGraceMinutes: { mode: "value", minutes: 2 } }),
    personal(2, "2026-10-24", "2026-10-24", { lateGraceMinutes: { mode: "value", minutes: 3 } })]);
  const r = resolve(s); coverage(r, s); assert.deepEqual(r.segments.map(s => s.personalApprovalRevision), [2, 1]);
  assert.deepEqual(r.segments.map(s => s.fields.lateGraceMinutes.minutes), [3, 2]);
});

test("withdrawn personal approval contributes neither value nor unnecessary boundary; replacement approval remains selected", () => {
  const s = source(); people(s, [personal(1, "2026-10-25", "2026-10-25", {}, "UTC", 2)]);
  let r = resolve(s); assert.equal(r.segments.length, 1); assert.equal(r.segments[0].fields.lateGraceMinutes.trace[0].mode, "missing_approval");
  assert.equal(r.segments[0].fields.lateGraceMinutes.trace[0].ledgerRevision, 2);
  people(s, [...s.personal.items, personal(3)]); r = resolve(s); assert.equal(r.segments.length, 1); assert.equal(r.segments[0].personalApprovalRevision, 3);
});

test("personal overrides still retain lower publication cutovers and provenance, including later draft head revisions", () => {
  const s = source(); stream(s, null, [publication(2), publication(4, "2026-10-25")], 99); people(s, [personal()]);
  const r = resolve(s); coverage(r, s); assert.equal(r.segments.length, 2); assert(r.segments.every(s => s.fields.lateGraceMinutes.minutes === 1));
  const sources = r.segments.map(s => s.fields.lateGraceMinutes.trace[2].source);
  assert(sources.every(s => s?.layer === "enterprise" && s.ledgerRevision === 99));
  assert.deepEqual(sources.map(s => s?.layer === "enterprise" ? s.publishRevision : null), [2, 4]);
});

test("group cutover inside one personal interval retains assignment revisions and fieldwise inheritance", () => {
  const s = source(); group(s, assignment(601, id(501), "2026-10-24", "2026-10-24"), [publication(2, "2026-10-23", { earlyGraceMinutes: { mode: "value", minutes: 3 } }, id(501))]);
  group(s, assignment(602, id(502), "2026-10-25", "2026-10-26"), [publication(2, "2026-10-23", { earlyGraceMinutes: { mode: "value", minutes: 5 } }, id(502))]);
  people(s, [personal()]); const r = resolve(s); coverage(r, s);
  assert.deepEqual(r.segments.map(s => [s.assignmentId, s.assignmentRevision, s.personalApprovalRevision, s.fields.earlyGraceMinutes.minutes]), [[id(601), 1, 1, 3], [id(602), 1, 1, 5]]);
});

test("cancelled assignments never apply and ended assignments stop at their final saved-zone end", () => {
  const s = source(); group(s, assignment(601, id(501), "2026-10-24", "2026-10-26", "UTC", "cancelled"), [publication(2, "2026-10-25", {}, id(501))]);
  people(s, [personal()]); assert.equal(resolve(s).segments.length, 1); assert.equal(resolve(s).segments[0].fields.lateGraceMinutes.trace[1].mode, "no_assignment");
  const t = source(); group(t, assignment(601, id(501), "2026-10-24", "2026-10-24", "UTC", "ended")); people(t, [personal()]);
  const r = resolve(t); coverage(r, t); assert.equal(r.segments[0].assignmentRevision, 2); assert.equal(r.segments[1].assignmentId, undefined);
});

test("DST and cross-zone personal/group intervals split exact UTC, not assumed 24-hour days", () => {
  const q = { ...query, fromDate: "2026-10-25", throughDate: "2026-10-25" }, s = source(q, "Europe/Madrid");
  group(s, assignment(601, id(501), "2026-10-25", "2026-10-25", "America/New_York"));
  people(s, [personal(1, "2026-10-25", "2026-10-25", {}, "Asia/Tokyo")]); const r = resolve(s); coverage(r, s);
  assert.deepEqual(r.segments.map(s => (Date.parse(s.toAt) - Date.parse(s.fromAt)) / 3600000), [6, 11, 8]);
  assert.deepEqual(r.segments.map(s => s.personalApprovalRevision), [1, 1, undefined]);
  assert.deepEqual(r.segments.map(s => s.groupId), [undefined, id(501), id(501)]);
});

test("skipped-next civil date and 2100 inclusive final date work without inventing dates or changing saved zones", () => {
  for (const [date, zone] of [["2011-12-29", "Pacific/Apia"], ["2100-12-31", "UTC"]]) {
    const s = source({ ...query, fromDate: date, throughDate: date }, zone);
    const p = personal(1, date, date, {}, zone); p.approval.recordedAt = date === "2011-12-29" ? "2011-12-27T10:00:00.123456Z" : stamp;
    s.readAt = date === "2011-12-29" ? "2011-12-31T10:00:00.123456Z" : "2100-12-31T10:00:00.123456Z";
    people(s, [p]); const r = resolve(s); coverage(r, s); assert.equal(r.segments.length, 1); assert.equal(r.segments[0].fields.lateGraceMinutes.minutes, 1);
  }
});

test("past and future queries remain current unsealed projections and never claim a historical applied policy", () => {
  for (const at of ["2026-10-01T10:00:00.123456Z", "2026-10-27T10:00:00.123456Z"]) {
    const s = source(); s.readAt = at; people(s, [personal()]); const r = resolve(s); coverage(r, s);
    assert(r.limitations.includes("historical_context_not_pinned")); assert(!r.limitations.includes("personal_exceptions_not_supported"));
    assert.equal(r.segments[0].fields.lateGraceMinutes.source?.recordedAt, stamp);
  }
});

test("any incomplete rules/assignments/personal section blocks globally even when a personal value could override it", () => {
  for (const key of ["assignments", "rules", "personal"] as const) {
    const s = source(); people(s, [personal()]); s[key].limited = true; s[key].items = [];
    const r = resolve(s); coverage(r, s); assert.equal(r.segments.length, 1); blocked(r, `${key}_truncated`);
  }
});

test("identity changes, inactive worker/employee and either unbound identity block without fabricating enterprise fallback", () => {
  for (const [patch, expected] of [[{ active: false }, "inactive_worker"], [{ employeeActive: false }, "inactive_employee"],
    [{ employeeId: null }, "unbound_employee"], [{ employeeAuthUserId: null }, "unbound_employee"]] as const) {
    const s = source(); people(s, [personal()]); Object.assign(s.worker, patch); blocked(resolve(s), expected);
  }
  const s = source(); s.warnings.push("identity_changed"); people(s, [personal()]); blocked(resolve(s), "identity_changed");
  const t = source(); group(t); t.assignments.items[0].detail.employeeId = id(444); blocked(resolve(t), "identity_changed");
});

test("ambiguous assignment, inactive group and missing lower streams remain blocked under a complete personal override", () => {
  const a = source(); group(a); a.assignments.items.push(assignment(602)); people(a, [personal()]); blocked(resolve(a), "assignment_overlap");
  const b = source(); group(b); b.assignments.items[0].currentGroup.active = false; people(b, [personal()]); blocked(resolve(b), "inactive_group");
  const c = source(); c.rules.items = []; people(c, [personal()]); blocked(resolve(c), "missing_rule_stream");
  const d = source(); d.assignments.items = [assignment()]; people(d, [personal()]); blocked(resolve(d), "missing_rule_stream");
});

test("overlap sanity guards block only ambiguous UTC portions; they never silently select one personal approval", () => {
  const s = source(); people(s, [personal(1, "2026-10-24", "2026-10-25"), personal(2, "2026-10-25", "2026-10-26")]);
  const r = resolve(s); coverage(r, s); assert.deepEqual(r.segments.map(s => s.status), ["candidate", "blocked", "candidate"]);
  assert.deepEqual(r.segments[1].blockers, ["personal_overlap"]); assert.equal(r.segments[1].personalApprovalRevision, undefined);
  const t = source(); group(t, assignment(601, id(501), "2026-10-24", "2026-10-24", "Europe/Madrid"));
  group(t, assignment(602, id(502), "2026-10-25", "2026-10-25", "Pacific/Kiritimati")); people(t, [personal()]);
  const overlap = resolve(t).segments.find(s => s.blockers.includes("assignment_overlap")); assert(overlap);
  assert.equal(overlap.fromAt, "2026-10-24T10:00:00.000Z"); assert.equal(overlap.toAt, "2026-10-24T22:00:00.000Z");
});

test("personal snapshot, dual IDs, stream revisions, duplicate operations and read-time precision have focused invariant guards", () => {
  for (const patch of [{ employeeId: id(444) }, { employeeAuthUserId: id(444) }, { workerVersion: 6 }, { settingsVersion: 6 },
    { rules: emptyAttendanceRuleDraft() }, { recordedAt: "2026-10-01T10:00:00.123Z" }]) {
    const s = source(), p = personal(); Object.assign(p.approval, patch); people(s, [p]); assert.throws(() => resolve(s), /attendance_three_layer_rules_invalid/);
  }
  const s = source(); people(s, [personal()], 0); assert.throws(() => resolve(s), /attendance_three_layer_rules_invalid/);
  const t = source(); people(t, [personal(), personal(2)]); t.personal.items[1].approval.operationId = t.personal.items[0].approval.operationId; assert.throws(() => resolve(t), /attendance_three_layer_rules_invalid/);
  const u = source(); u.readAt = "2026-09-01T10:00:00.123455Z"; people(u, [personal()]); assert.throws(() => resolve(u), /attendance_three_layer_rules_invalid/);
});

test("withdrawal snapshot and target cannot differ, be reused, or carry a revision beyond current stream", () => {
  for (const patch of [{ employeeId: id(444) }, { settingsVersion: 3 }, { approvedRevision: 2 }, { rules: values({ earlyGraceMinutes: { mode: "disabled" } }) }]) {
    const s = source(), p = personal(1, "2026-10-24", "2026-10-26", {}, "UTC", 2); Object.assign(p.withdrawal!, patch); people(s, [p]);
    assert.throws(() => resolve(s), /attendance_three_layer_rules_invalid/);
  }
  const s = source(); people(s, [personal(1, "2026-10-24", "2026-10-26", {}, "UTC", 2)], 1); assert.throws(() => resolve(s), /attendance_three_layer_rules_invalid/);
});

test("publication and assignment invariants prevent later drafts, reversed cutovers, duplicate streams and malformed derived UTC", () => {
  const a = source(), p = publication(); p.action = "save_draft"; stream(a, null, [p]); assert.throws(() => resolve(a), /attendance_three_layer_rules_invalid/);
  const b = source(); stream(b, null, [publication(2, "2026-10-25"), publication(4, "2026-10-24")]); assert.throws(() => resolve(b), /attendance_three_layer_rules_invalid/);
  const c = source(); c.rules.items.push({ ...c.rules.items[0] }); assert.throws(() => resolve(c), /attendance_three_layer_rules_invalid/);
  const d = source(); group(d); d.assignments.items[0].fromAt = "2026-10-24T01:00:00.000Z"; assert.throws(() => resolve(d), /attendance_three_layer_rules_invalid/);
});

test("all new output is deeply frozen, contains no input aliases, and leaves frozen normalized evidence unchanged", () => {
  const s = source(); group(s); people(s, [personal()]); const before = structuredClone(s);
  function freeze(v: unknown) { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } }
  function frozen(v: unknown) { if (v && typeof v === "object") { assert(Object.isFrozen(v)); Object.values(v).forEach(frozen); } }
  freeze(s); const r = resolve(s); frozen(r); assert.deepEqual(s, before);
  const t = source(); people(t, [personal()]); const output = resolve(t); t.personal.items[0].approval.actorId = id(444);
  t.personal.items[0].approval.rules.lateGraceMinutes = { mode: "disabled" }; t.warnings.push("unrelated");
  assert.equal(output.segments[0].fields.lateGraceMinutes.minutes, 1); assert.equal(output.segments[0].fields.lateGraceMinutes.source?.actorId, id(97));
});

test("explicit 100-item and 501-segment guards reject overfull input without silently truncating a candidate timeline", () => {
  assert.equal(THREE_LAYER_RULE_MAX_SEGMENTS, 501);
  const a = source(); a.assignments.items = Array.from({ length: 101 }, (_, n) => assignment(601 + n)); assert.throws(() => resolve(a), /attendance_three_layer_rules_too_large/);
  const b = source(); b.rules.items = Array.from({ length: 101 }, (_, n) => ({ groupId: id(501 + n), revision: 0, publications: [] })); assert.throws(() => resolve(b), /attendance_three_layer_rules_too_large/);
  const c = source(); stream(c, null, Array(101).fill(publication()), 999); assert.throws(() => resolve(c), /attendance_three_layer_rules_too_large/);
  const d = source(); people(d, Array.from({ length: 101 }, (_, n) => personal(n + 1))); assert.throws(() => resolve(d), /attendance_three_layer_rules_too_large/);
  const e = source(); people(e, Array.from({ length: 100 }, (_, n) => personal(n * 2 + 1, "2026-10-24", "2026-10-26", {}, "UTC", n * 2 + 2)));
  const r = resolve(e); coverage(r, e); assert.equal(r.segments.length, 1); assert.equal(r.segments[0].fields.lateGraceMinutes.state, "unconfigured");
});

test("a real new rule-source parser result composes directly without fake attendance sources or legacy personal-unsupported warnings", () => {
  const s = source(); group(s); people(s, [personal(1, "2026-10-24", "2026-10-26", {}, "UTC", 2), personal(3)]);
  const { warnings: ignored, ...base } = s; void ignored;
  const parsed = parseRuleSourcesResult({ ...base, assignments: { limited: false, items: s.assignments.items.map(a => ({ detail: a.detail, currentGroup: a.currentGroup })) } }, query, id(99));
  const r = resolve(parsed); coverage(r, parsed); assert.equal(r.segments[0].personalApprovalRevision, 3);
  assert(!r.limitations.includes("personal_exceptions_not_supported")); assert.equal(Object.keys(r.segments[0].fields).length, RULE_KEYS.length);
});
