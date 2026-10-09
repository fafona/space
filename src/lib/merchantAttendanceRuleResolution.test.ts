import assert from "node:assert/strict";
import test from "node:test";
import { emptyAttendanceRuleDraft, RULE_KEYS, type AttendanceRuleDraft } from "./merchantAttendanceRuleDraft";
import { attendanceDayUtcRange } from "./merchantAttendanceTime";
import { parseSourcesResult, type SourcesAssignment, type SourcesQuery, type SourcesResult } from "./merchantAttendanceSources";
import type { GroupAssignmentItem, GroupAssignmentDetail } from "./merchantAttendanceGroups";
import type { RulesItem } from "./merchantAttendanceRules";
import { CANDIDATE_RULE_MAX_SEGMENTS, resolveCandidateAttendanceRules as resolve, type CandidateAttendanceRuleResolution } from "./merchantAttendanceRuleResolution";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const query: SourcesQuery = { siteId: "99990001", workerId: id(201), fromDate: "2026-10-24", throughDate: "2026-10-26" };
const stamp = "2026-09-01T10:00:00.123456Z", readAt = "2026-10-27T12:00:00.123456Z";
const micro = (at: string) => at.replace(/\.([0-9]{3})Z$/, ".$1000Z");
const values = (patch: Partial<AttendanceRuleDraft> = {}): AttendanceRuleDraft => ({ ...emptyAttendanceRuleDraft(), ...patch });
function source(q = query, timeZone = "UTC"): SourcesResult {
  const fromAt = attendanceDayUtcRange(q.fromDate, timeZone).startAt, toAt = attendanceDayUtcRange(q.throughDate, timeZone).endAt;
  return parseSourcesResult({ protocol: "sources-v1", siteId: q.siteId, actorId: id(99), fromDate: q.fromDate, throughDate: q.throughDate,
    worker: { workerId: q.workerId, workerName: "Current synthetic worker", workerNo: "RULE-201", employeeId: id(101), version: 5, active: true },
    settingsVersion: 5, timeZone, fromAt, toAt, readAt,
    attendance: { version: "attendance-unified-v1", access: "owner", complete: true, payrollReady: false, missing: [],
      base: { ...q, workerName: "Current synthetic worker", workerNo: "RULE-201", employeeId: id(101), timeZone, fromAt: micro(fromAt), toAt: micro(toAt), asOf: readAt,
        sourceVersion: "raw-and-approved-v2", complete: true, items: [] } },
    assignments: { limited: false, items: [] }, rules: { limited: false, items: [{ groupId: null, revision: 0, publications: [] }] },
    schedule: { limited: false, items: [] }, leave: { limited: false, items: [] }, calendar: { limited: false, items: [] },
  }, q, id(99));
}
function publication(revision = 2, effectiveOn = "2026-10-23", patch: Partial<AttendanceRuleDraft> = {}, groupId: string | null = null, timeZone = "UTC"): RulesItem {
  return { revision, operationId: id(10000 + revision + (groupId ? Number(groupId.slice(-6)) * 100 : 0)), actorId: id(98), action: "publish", reason: "Synthetic candidate publication",
    recordedAt: stamp, settingsVersion: 1, groupRevision: groupId === null ? null : 1, timeZone, rules: values(patch), effectiveOn,
    effectiveAt: attendanceDayUtcRange(effectiveOn, timeZone).startAt, publishedRevision: null };
}
function setStream(s: SourcesResult, groupId: string | null, publications: RulesItem[], revision = Math.max(0, ...publications.map(p => p.revision))) {
  const item = { groupId, revision, publications }, index = s.rules.items.findIndex(r => r.groupId === groupId);
  if (index < 0) s.rules.items.push(item); else s.rules.items[index] = item;
}
function assignment(n = 601, groupId = id(501), startsOn = "2026-10-24", endsOn: string | null = "2026-10-26", timeZone = "UTC", status: "assigned" | "ended" | "cancelled" = "assigned"): SourcesAssignment {
  const original: GroupAssignmentItem = { assignmentId: id(n), groupId, groupName: "Original group", workerId: query.workerId, workerName: "Original worker", workerNo: "OLD",
    employeeId: id(101), timeZone, startsOn, endsOn: status === "ended" ? null : endsOn, createdAt: stamp, updatedAt: stamp, revision: 1, status: "assigned" };
  const history: GroupAssignmentDetail["history"] = [{ item: original, command: { action: "assign", operationId: id(n), reason: "Synthetic assignment", groupId, workerId: query.workerId,
    expectedGroupRevision: 1, expectedWorkerVersion: 1, expectedSettingsVersion: 1, timeZone, startsOn, endsOn: original.endsOn } }];
  const item: GroupAssignmentItem = status === "assigned" ? { ...original } : { ...original, endsOn, status, revision: 2, updatedAt: "2026-09-02T10:00:00.123456Z" };
  if (status === "ended") history.push({ item, command: { action: "end", operationId: id(n + 1000), assignmentId: id(n), expectedRevision: 1, reason: "Synthetic end", endsOn: endsOn! } });
  if (status === "cancelled") history.push({ item, command: { action: "cancel", operationId: id(n + 1000), assignmentId: id(n), expectedRevision: 1, reason: "Synthetic cancel" } });
  return { detail: { ...item, history, canEnd: status === "assigned" && endsOn === null, canCancel: status !== "cancelled" },
    currentGroup: { groupId, revision: 4, name: "Current group", description: "", active: true, createdAt: stamp, updatedAt: stamp },
    fromAt: attendanceDayUtcRange(startsOn, timeZone).startAt, toAt: endsOn === null ? null : attendanceDayUtcRange(endsOn, timeZone).endAt,
    inPeriod: status !== "cancelled", originalInPeriod: true };
}
function addGroup(s: SourcesResult, a = assignment(), publications: RulesItem[] = []) { s.assignments.items.push(a); setStream(s, a.detail.groupId, publications); }
function assertCoverage(r: CandidateAttendanceRuleResolution, s: SourcesResult) {
  assert.equal(r.segments[0].fromAt, s.fromAt); assert.equal(r.segments.at(-1)!.toAt, s.toAt);
  for (let n = 0; n < r.segments.length; n++) {
    assert(r.segments[n].fromAt < r.segments[n].toAt);
    if (n) assert.equal(r.segments[n - 1].toAt, r.segments[n].fromAt);
  }
  assert.equal(r.applied, false); assert.equal(r.formalReady, false); assert(r.segments.length <= CANDIDATE_RULE_MAX_SEGMENTS);
}
function assertBlocked(r: CandidateAttendanceRuleResolution, blocker: string) {
  assert(r.segments.every(s => s.status === "blocked" && s.blockers.includes(blocker)));
  for (const segment of r.segments) for (const field of Object.values(segment.fields)) assert.deepEqual(field, { state: "blocked", minutes: null, source: null, trace: [] });
}

test("known empty enterprise stream yields unconfigured candidate, never a default or personal policy", () => {
  const s = source(), r = resolve(s); assertCoverage(r, s); assert.equal(r.segments.length, 1);
  assert.equal(r.protocol, "candidate-rule-resolution-v1"); assert.equal(r.siteId, s.siteId); assert.equal(r.workerId, s.worker.workerId);
  assert.equal(r.actorId, s.actorId); assert.equal(r.readAt, readAt); assert.equal(r.timeZone, "UTC");
  assert.deepEqual(r.limitations, ["personal_exceptions_not_supported", "historical_context_not_pinned", "candidate_rules_not_applied"]);
  for (const field of Object.values(r.segments[0].fields)) {
    assert.equal(field.state, "unconfigured"); assert.equal(field.minutes, null); assert.equal(field.source, null);
    assert.deepEqual(field.trace, [{ layer: "enterprise", groupId: null, mode: "missing_publication", minutes: null, source: null }]);
  }
});

test("group resolves fields independently and preserves zero, explicit disabled and inherit", () => {
  const s = source(), g = id(501);
  setStream(s, null, [publication(2, "2026-10-23", { lateGraceMinutes: { mode: "value", minutes: 8 }, earlyGraceMinutes: { mode: "value", minutes: 9 },
    openSpanWarningMinutes: { mode: "value", minutes: 480 }, completedBreakMinimumMinutes: { mode: "value", minutes: 20 } })]);
  addGroup(s, assignment(), [publication(2, "2026-10-23", { lateGraceMinutes: { mode: "value", minutes: 0 }, earlyGraceMinutes: { mode: "disabled" },
    completedBreakMinimumMinutes: { mode: "value", minutes: 10 } }, g)]);
  const fields = resolve(s).segments[0].fields;
  assert.equal(fields.lateGraceMinutes.state, "value"); assert.equal(fields.lateGraceMinutes.minutes, 0); assert.equal(fields.lateGraceMinutes.source!.layer, "group");
  assert.equal(fields.earlyGraceMinutes.state, "disabled"); assert.equal(fields.earlyGraceMinutes.minutes, null); assert.equal(fields.earlyGraceMinutes.source!.groupId, g);
  assert.equal(fields.openSpanWarningMinutes.minutes, 480); assert.equal(fields.openSpanWarningMinutes.source!.layer, "enterprise");
  assert.equal(fields.completedBreakMinimumMinutes.minutes, 10);
  assert.deepEqual(fields.openSpanWarningMinutes.trace.map(t => [t.layer, t.mode]), [["group", "inherit"], ["enterprise", "value"]]);
  assert.deepEqual(fields.lateGraceMinutes.trace.map(t => t.minutes), [0, 8]);
});

test("enterprise disabled stops inheritance and never turns into a zero threshold", () => {
  const s = source(); setStream(s, null, [publication(2, "2026-10-23", { lateGraceMinutes: { mode: "disabled" } })]); addGroup(s, assignment(), [publication(2, "2026-10-23", {}, id(501))]);
  const field = resolve(s).segments[0].fields.lateGraceMinutes;
  assert.equal(field.state, "disabled"); assert.equal(field.minutes, null); assert.equal(field.source!.layer, "enterprise");
  assert.deepEqual(field.trace.map(t => t.mode), ["inherit", "disabled"]);
});

test("all published inherit choices remain unconfigured, with both publication traces", () => {
  const s = source(); setStream(s, null, [publication()]); addGroup(s, assignment(), [publication(2, "2026-10-23", {}, id(501))]);
  for (const field of Object.values(resolve(s).segments[0].fields)) {
    assert.equal(field.state, "unconfigured"); assert.equal(field.source, null); assert.equal(field.minutes, null);
    assert.deepEqual(field.trace.map(t => t.mode), ["inherit", "inherit"]); assert(field.trace.every(t => t.source !== null));
  }
});

test("known group stream without a publication inherits with missing_publication trace", () => {
  const s = source(); setStream(s, null, [publication(2, "2026-10-23", { lateGraceMinutes: { mode: "value", minutes: 7 } })]); addGroup(s);
  const r = resolve(s), field = r.segments[0].fields.lateGraceMinutes;
  assert.equal(r.segments[0].status, "candidate"); assert.equal(field.minutes, 7); assert.equal(field.source!.layer, "enterprise");
  assert.deepEqual(field.trace.map(t => t.mode), ["missing_publication", "value"]);
});

test("group publication starts at exact effective boundary, not at query start or read time", () => {
  const s = source(); setStream(s, null, [publication(2, "2026-10-23", { lateGraceMinutes: { mode: "value", minutes: 7 } })]);
  addGroup(s, assignment(), [publication(2, "2026-10-25", { lateGraceMinutes: { mode: "value", minutes: 3 } }, id(501))]);
  const r = resolve(s); assertCoverage(r, s); assert.equal(r.segments.length, 2);
  assert.deepEqual(r.segments.map(segment => segment.fields.lateGraceMinutes.minutes), [7, 3]);
  assert.equal(r.segments[0].toAt, "2026-10-25T00:00:00.000Z"); assert.equal(r.segments[1].fields.lateGraceMinutes.source!.effectiveAt, r.segments[1].fromAt);
});

test("all corresponding publication boundaries split even when a higher layer overrides them", () => {
  const s = source(); setStream(s, null, [publication(2), publication(4, "2026-10-25")]);
  addGroup(s, assignment(), [publication(2, "2026-10-23", { lateGraceMinutes: { mode: "value", minutes: 0 } }, id(501))]);
  const r = resolve(s); assertCoverage(r, s); assert.equal(r.segments.length, 2); assert(r.segments.every(segment => segment.fields.lateGraceMinutes.minutes === 0));
  assert.deepEqual(r.segments.map(segment => segment.fields.lateGraceMinutes.trace[1].source!.publishRevision), [2, 4]);
});

test("newer draft ledger revisions do not hide the relevant immutable publication", () => {
  const s = source(); setStream(s, null, [publication(2, "2026-10-23", { lateGraceMinutes: { mode: "value", minutes: 5 } })], 35);
  const p = resolve(s).segments[0].fields.lateGraceMinutes.source!;
  assert.equal(p.ledgerRevision, 35); assert.equal(p.publishRevision, 2); assert.equal(p.actorId, id(98)); assert.equal(p.operationId, id(10002));
  assert.equal(p.settingsVersion, 1); assert.equal(p.recordedAt, stamp); assert.equal(s.settingsVersion, 5);
});

test("historical publication group/settings versions and saved zones may differ from current context", () => {
  const s = source(); addGroup(s, assignment(), [publication(2, "2026-10-23", { earlyGraceMinutes: { mode: "value", minutes: 11 } }, id(501), "America/New_York")]);
  const p = resolve(s).segments[0].fields.earlyGraceMinutes.source!;
  assert.equal(p.timeZone, "America/New_York"); assert.equal(p.effectiveAt, "2026-10-23T04:00:00.000Z");
  assert.equal(p.groupRevision, 1); assert.equal(s.assignments.items[0].currentGroup.revision, 4); assert.equal(p.settingsVersion, 1);
});

test("adjacent group assignments cut over without overlap or gap and retain assignment provenance", () => {
  const s = source(); addGroup(s, assignment(601, id(501), "2026-10-24", "2026-10-24"), [publication(2, "2026-10-23", { lateGraceMinutes: { mode: "value", minutes: 1 } }, id(501))]);
  addGroup(s, assignment(602, id(502), "2026-10-25", "2026-10-26"), [publication(2, "2026-10-23", { lateGraceMinutes: { mode: "value", minutes: 2 } }, id(502))]);
  const r = resolve(s); assertCoverage(r, s); assert.deepEqual(r.segments.map(segment => segment.fields.lateGraceMinutes.minutes), [1, 2]);
  assert.deepEqual(r.segments.map(segment => [segment.assignmentId, segment.assignmentRevision, segment.groupId]), [[id(601), 1, id(501)], [id(602), 1, id(502)]]);
  assert(r.segments.every(segment => segment.status === "candidate" && !segment.blockers.length));
});

test("overlapping frozen-zone assignments block only their actual overlap interval", () => {
  const s = source(); addGroup(s, assignment(601, id(501), "2026-10-24", "2026-10-24", "Europe/Madrid"));
  addGroup(s, assignment(602, id(502), "2026-10-25", "2026-10-25", "Pacific/Kiritimati")); s.warnings.push("assignment_utc_overlap");
  const r = resolve(s); assertCoverage(r, s); assert.deepEqual(r.segments.map(segment => segment.status), ["candidate", "blocked", "candidate", "candidate"]);
  const blocked = r.segments[1]; assert.equal(blocked.fromAt, "2026-10-24T10:00:00.000Z"); assert.equal(blocked.toAt, "2026-10-24T22:00:00.000Z");
  assert.deepEqual(blocked.blockers, ["assignment_overlap"]); assert.equal(blocked.assignmentId, undefined); assert.equal(blocked.fields.lateGraceMinutes.state, "blocked");
});

test("two live assignments to the same group are still ambiguous and never silently deduplicated", () => {
  const s = source(); addGroup(s); s.assignments.items.push(assignment(602));
  assertBlocked(resolve(s), "assignment_overlap");
});

test("cancelled assignments and their otherwise irrelevant publication boundaries never apply", () => {
  const s = source(); setStream(s, null, [publication(2, "2026-10-23", { lateGraceMinutes: { mode: "value", minutes: 5 } })]);
  addGroup(s, assignment(601, id(501), "2026-10-24", "2026-10-26", "UTC", "cancelled"), [publication(2, "2026-10-25", { lateGraceMinutes: { mode: "value", minutes: 99 } }, id(501))]);
  const r = resolve(s); assert.equal(r.segments.length, 1); assert.equal(r.segments[0].assignmentId, undefined);
  assert.equal(r.segments[0].fields.lateGraceMinutes.minutes, 5); assert.equal(r.segments[0].fields.lateGraceMinutes.trace.length, 1);
});

test("ended assignment stops after its inclusive saved end date, then enterprise remains candidate", () => {
  const s = source(); addGroup(s, assignment(601, id(501), "2026-10-24", "2026-10-24", "UTC", "ended"));
  const r = resolve(s); assertCoverage(r, s); assert.equal(r.segments.length, 2); assert.equal(r.segments[0].assignmentRevision, 2);
  assert.equal(r.segments[0].toAt, "2026-10-25T00:00:00.000Z"); assert.equal(r.segments[1].assignmentId, undefined);
  assert.equal(r.segments[1].fields.lateGraceMinutes.trace[0].layer, "enterprise");
});

test("inactive current group blocks only its live assignment interval and does not fall back", () => {
  const s = source(); setStream(s, null, [publication(2, "2026-10-23", { lateGraceMinutes: { mode: "value", minutes: 5 } })]);
  const a = assignment(601, id(501), "2026-10-25", "2026-10-25"); a.currentGroup.active = false; addGroup(s, a);
  const r = resolve(s); assertCoverage(r, s); assert.deepEqual(r.segments.map(segment => segment.status), ["candidate", "blocked", "candidate"]);
  assert.deepEqual(r.segments[1].blockers, ["inactive_group"]); assert.equal(r.segments[1].fields.lateGraceMinutes.source, null);
});

test("missing enterprise or required group streams block instead of fabricating an inheritance path", () => {
  const enterpriseMissing = source(); enterpriseMissing.rules.items = []; assertBlocked(resolve(enterpriseMissing), "missing_rule_stream");
  const groupMissing = source(); groupMissing.assignments.items = [assignment()]; assertBlocked(resolve(groupMissing), "missing_rule_stream");
  const outside = source(); outside.assignments.items = [assignment(601, id(501), "2026-10-20", "2026-10-20")];
  assert.equal(resolve(outside).segments[0].status, "candidate");
});

test("limited assignments or rules globally block with no fabricated field values or group selection", () => {
  const s = source(); s.assignments.limited = true; s.rules = { limited: true, items: [] };
  const r = resolve(s); assertCoverage(r, s); assert.equal(r.segments.length, 1); assertBlocked(r, "assignments_truncated"); assertBlocked(r, "rules_truncated");
  const onlyRules = source(); addGroup(onlyRules); onlyRules.rules = { limited: true, items: [] }; assertBlocked(resolve(onlyRules), "rules_truncated");
});

test("historical identity change and current inactive worker block the complete query conservatively", () => {
  const s = source(); setStream(s, null, [publication(2, "2026-10-23", { lateGraceMinutes: { mode: "value", minutes: 8 } })]);
  s.warnings.push("identity_changed"); assertBlocked(resolve(s), "identity_changed");
  s.warnings = []; s.worker.active = false; assertBlocked(resolve(s), "inactive_worker");
});

test("schedule leave and calendar truncation stay explicit limitations without performing a classification", () => {
  const s = source(); s.schedule.limited = true; s.leave.limited = true; s.calendar.limited = true;
  const r = resolve(s); assert.equal(r.segments[0].status, "candidate"); assert.equal(r.formalReady, false);
  for (const warning of ["schedule_truncated", "leave_truncated", "calendar_truncated"]) assert(r.limitations.includes(warning));
  assert.equal("assessment" in r, false); assert.equal("absence" in r, false); assert.equal("payroll" in r, false);
});

test("DST query length and cross-zone group boundaries use exact UTC intervals, not assumed 24-hour days", () => {
  const q = { ...query, fromDate: "2026-10-25", throughDate: "2026-10-25" }, s = source(q, "Europe/Madrid");
  addGroup(s, assignment(601, id(501), "2026-10-25", "2026-10-25", "America/New_York"), [publication(2, "2026-10-25", { lateGraceMinutes: { mode: "value", minutes: 3 } }, id(501), "America/New_York")]);
  const r = resolve(s); assertCoverage(r, s); assert.equal(r.segments.length, 2);
  assert.deepEqual(r.segments.map(segment => (Date.parse(segment.toAt) - Date.parse(segment.fromAt)) / 3600000), [6, 19]);
  assert.equal(r.segments[0].groupId, undefined); assert.equal(r.segments[1].fields.lateGraceMinutes.minutes, 3);
});

test("returned data is deeply immutable, contains no input object aliases, and does not mutate a frozen input", () => {
  const s = source(); setStream(s, null, [publication(2, "2026-10-23", { lateGraceMinutes: { mode: "value", minutes: 4 } })]); const before = structuredClone(s);
  function freeze(value: unknown) { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } }
  freeze(s); const r = resolve(s); assert.deepEqual(s, before);
  function frozen(value: unknown) { if (value && typeof value === "object") { assert(Object.isFrozen(value)); Object.values(value).forEach(frozen); } }
  frozen(r); assert.equal(Reflect.set(r.segments[0].fields.lateGraceMinutes.source!, "actorId", id(999)), false);
  const mutable = source(); setStream(mutable, null, [publication(2, "2026-10-23", { lateGraceMinutes: { mode: "value", minutes: 4 } })]); const result = resolve(mutable);
  mutable.rules.items[0].publications[0].actorId = id(999); mutable.rules.items[0].publications[0].rules!.lateGraceMinutes = { mode: "value", minutes: 88 };
  assert.equal(result.segments[0].fields.lateGraceMinutes.minutes, 4); assert.equal(result.segments[0].fields.lateGraceMinutes.source!.actorId, id(98));
});

test("internal invariant guards reject invalid drafts, publication order and duplicated streams or operations", () => {
  const malformed = source(); const p = publication(); p.rules!.lateGraceMinutes = { mode: "value", minutes: -1 }; setStream(malformed, null, [p]); assert.throws(() => resolve(malformed), /attendance_rule_resolution_invalid/);
  const draft = source(); const d = publication(); d.action = "save_draft"; setStream(draft, null, [d]); assert.throws(() => resolve(draft), /attendance_rule_resolution_invalid/);
  const backwards = source(); setStream(backwards, null, [publication(2, "2026-10-25"), publication(4, "2026-10-24")]); assert.throws(() => resolve(backwards), /attendance_rule_resolution_invalid/);
  const duplicate = source(); duplicate.rules.items.push({ ...duplicate.rules.items[0] }); assert.throws(() => resolve(duplicate), /attendance_rule_resolution_invalid/);
  const operations = source(); const enterprise = publication(); setStream(operations, null, [enterprise]); const group = publication(2, "2026-10-23", {}, id(501)); group.operationId = enterprise.operationId;
  addGroup(operations, assignment(), [group]); assert.throws(() => resolve(operations), /attendance_rule_resolution_invalid/);
  const badRange = source(); badRange.toAt = badRange.fromAt; assert.throws(() => resolve(badRange), /attendance_rule_resolution_invalid/);
});

test("bounded input and output guards never silently truncate large candidate timelines", () => {
  assert.equal(CANDIDATE_RULE_MAX_SEGMENTS, 301);
  const assignments = source(); assignments.assignments.items = Array.from({ length: 101 }, (_, n) => assignment(601 + n)); assert.throws(() => resolve(assignments), /attendance_rule_resolution_too_large/);
  const streams = source(); streams.rules.items = Array.from({ length: 101 }, (_, n) => ({ groupId: id(501 + n), revision: 0, publications: [] })); assert.throws(() => resolve(streams), /attendance_rule_resolution_too_large/);
  const publications = source(); setStream(publications, null, Array(101).fill(publication()), 500); assert.throws(() => resolve(publications), /attendance_rule_resolution_too_large/);
  const atLimit = source(); atLimit.assignments.items = Array.from({ length: 100 }, (_, n) => assignment(601 + n)); setStream(atLimit, id(501), []);
  const r = resolve(atLimit); assertCoverage(r, atLimit); assertBlocked(r, "assignment_overlap"); assert.equal(Object.keys(r.segments[0].fields).length, RULE_KEYS.length);
});
