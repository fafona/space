import assert from "node:assert/strict";
import test from "node:test";
import { parseRuleSourcesQuery, parseRuleSourcesHttpQuery, ruleSourcesQueryString, parseRuleSourcesResult, parseRuleSourcesResponse, RULE_SOURCES_ERRORS,
  type RuleSourcesQuery, type RuleSourcesPersonalItem, type RuleSourcesResult } from "./merchantAttendanceRuleSources";
import { emptyAttendanceRuleDraft } from "./merchantAttendanceRuleDraft";
import { attendanceDayUtcRange, MerchantAttendanceError } from "./merchantAttendanceTime";
import type { GroupAssignmentDetail, GroupItem } from "./merchantAttendanceGroups";
import type { RulesItem } from "./merchantAttendanceRules";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(99), employee = id(101), auth = id(102);
const query: RuleSourcesQuery = { siteId: "99990001", workerId: id(201), fromDate: "2026-09-29", throughDate: "2026-10-01" };
type Wire = Omit<RuleSourcesResult, "assignments" | "warnings"> & { assignments: { limited: boolean; items: Array<{ detail: GroupAssignmentDetail; currentGroup: GroupItem }> } };
function wire(q = query, timeZone = "UTC"): Wire {
  return { protocol: "rule-sources-v1", siteId: q.siteId, actorId: owner, fromDate: q.fromDate, throughDate: q.throughDate,
    worker: { workerId: q.workerId, workerName: "Synthetic worker", workerNo: "QA-201", employeeId: employee, employeeAuthUserId: auth, version: 4, active: true, employeeActive: true },
    settingsVersion: 5, timeZone, fromAt: attendanceDayUtcRange(q.fromDate, timeZone).startAt, toAt: attendanceDayUtcRange(q.throughDate, timeZone).endAt,
    readAt: "2026-10-04T12:00:00.000001Z", assignments: { limited: false, items: [] }, rules: { limited: false, items: [{ groupId: null, revision: 0, publications: [] }] },
    personal: { revision: 0, limited: false, items: [] } };
}
function assignment(group = 701, assignmentNumber = 801, timeZone = "UTC", startsOn = "2026-09-28", endsOn: string | null = null): Wire["assignments"]["items"][number] {
  const original = { assignmentId: id(assignmentNumber), groupId: id(group), groupName: "Synthetic group", workerId: query.workerId,
    workerName: "Synthetic worker", workerNo: "QA-201", employeeId: employee, timeZone, startsOn, endsOn,
    createdAt: "2026-09-21T00:00:00.000001Z", updatedAt: "2026-09-21T00:00:00.000001Z", revision: 1 as const, status: "assigned" as const };
  return { detail: { ...original, history: [{ command: { operationId: original.assignmentId, action: "assign", reason: "Synthetic assignment", groupId: original.groupId,
    workerId: query.workerId, expectedGroupRevision: 1, expectedWorkerVersion: 1, expectedSettingsVersion: 1, timeZone, startsOn, endsOn }, item: { ...original } }], canEnd: endsOn === null, canCancel: true },
    currentGroup: { groupId: original.groupId, revision: 3, name: "Current group", description: "", active: true,
      createdAt: "2026-09-20T00:00:00.000001Z", updatedAt: "2026-09-25T00:00:00.000001Z" } };
}
function publication(n = 900, groupId: string | null = null, effectiveOn = "2026-09-28", revision = 2): RulesItem {
  return { revision, operationId: id(n), actorId: owner, action: "publish", reason: "Synthetic publication", recordedAt: "2026-09-25T00:00:00.000001Z",
    settingsVersion: 1, groupRevision: groupId === null ? null : 1, timeZone: "UTC", rules: { ...emptyAttendanceRuleDraft(), lateGraceMinutes: { mode: "value", minutes: 0 } },
    effectiveOn, effectiveAt: attendanceDayUtcRange(effectiveOn, "UTC").startAt, publishedRevision: null };
}
function personal(revision = 1, startsOn = "2026-09-29", endsOn = startsOn, withdrawn = false, timeZone = "UTC"): RuleSourcesPersonalItem {
  const approval: RuleSourcesPersonalItem["approval"] = { revision, operationId: id(1000 + revision), actorId: owner, action: "approve", reason: "Original owner-approved candidate",
    recordedAt: `2026-09-26T00:00:00.${String(revision).padStart(6, "0")}Z`, employeeId: employee, employeeAuthUserId: auth,
    workerVersion: 1, settingsVersion: 1, timeZone, startsOn, endsOn, fromAt: attendanceDayUtcRange(startsOn, timeZone).startAt,
    toAt: attendanceDayUtcRange(endsOn, timeZone).endAt, rules: { ...emptyAttendanceRuleDraft(), earlyGraceMinutes: { mode: "disabled" } }, approvedRevision: null };
  return { approval, withdrawal: withdrawn ? { ...structuredClone(approval), action: "withdraw", approvedRevision: revision, revision: revision + 1,
    operationId: id(1001 + revision), reason: "A later owner withdraws before start", actorId: id(98), recordedAt: `2026-09-26T00:00:00.${String(revision + 1).padStart(6, "0")}Z` } : null };
}
function populated(): Wire {
  const v = wire(), a = assignment(); v.assignments.items = [a];
  v.rules.items = [{ groupId: null, revision: 40, publications: [publication()] }, { groupId: a.currentGroup.groupId, revision: 90, publications: [publication(901, a.currentGroup.groupId)] }];
  v.personal = { revision: 4, limited: false, items: [personal(1, "2026-09-29", "2026-10-01", true), personal(3, "2026-09-30", "2026-10-01")] };
  return v;
}
const parse = (raw: unknown, q = query) => parseRuleSourcesResult(raw, q, owner);
const reject = (raw: unknown, code = "attendance_rule_sources_invalid") => assert.throws(() => parse(raw), error => error instanceof MerchantAttendanceError && error.code === code);
function freezeDeep(value: unknown): void { if (value && typeof value === "object") { Object.values(value).forEach(freezeDeep); Object.freeze(value); } }

test("strict four-field query covers at most seven civil dates and rejects duplicate/prototype HTTP keys", () => {
  const q = { ...query, throughDate: "2026-10-05" };
  assert.deepEqual(parseRuleSourcesHttpQuery(`https://www.faolla.com/api/rule-sources?${ruleSourcesQueryString(q)}`), q);
  for (const raw of [{ ...q, throughDate: "2026-10-06" }, { ...q, fromDate: "2026-10-06" }, { ...query, fromDate: "2026-02-30" }, { ...query, employeeId: employee }]) {
    assert.throws(() => parseRuleSourcesQuery(raw), error => error instanceof MerchantAttendanceError && error.code === "attendance_invalid_request");
  }
  for (const suffix of ["&siteId=99990001", "&__proto__=x", "&operationId=" + id(3), "&constructor=x"]) assert.throws(() => parseRuleSourcesHttpQuery(`https://example.test/?${ruleSourcesQueryString(query)}${suffix}`));
});
test("independent empty projection has no attendance dependency, no fake zero rules and exact warnings", () => {
  const result = parse(wire()); assert.equal(result.personal.revision, 0); assert.equal(result.personal.items.length, 0);
  assert.deepEqual(result.warnings, ["candidate_rules_not_applied", "historical_context_not_pinned"]);
  assert.equal("attendance" in result, false); assert.equal("schedule" in result, false);
  const response = parseRuleSourcesResponse({ ok: true, moduleEnabled: false, data: wire() }, query, owner);
  assert.equal(response.moduleEnabled, false); assert.equal(response.protocol, "rule-sources-v1");
  reject({ ...wire(), attendance: {} }); reject({ ...wire(), warnings: [] });
});
test("normalized assignment and personal snapshots are detached and frozen inputs are accepted", () => {
  const raw = populated(), before = structuredClone(raw); freezeDeep(raw);
  const parsed = parse(raw); assert.deepEqual(raw, before);
  assert.equal(parsed.assignments.items[0].inPeriod, true); assert.equal(parsed.assignments.items[0].originalInPeriod, true);
  assert.equal(parsed.assignments.items[0].fromAt, "2026-09-28T00:00:00.000Z");
  assert.equal(parsed.personal.items[0].withdrawal?.actorId, id(98)); assert.equal(parsed.rules.items[0].revision, 40);
  parsed.personal.items[0].approval.rules.earlyGraceMinutes = { mode: "value", minutes: 0 };
  parsed.assignments.items[0].detail.history[0].command.reason = "Locally detached";
  assert.deepEqual(raw, before);
});
test("actor, target, requested dates, current version and all timestamp bindings fail closed", () => {
  const changes: Array<(v: Wire) => void> = [v => { v.actorId = id(100); }, v => { v.siteId = "99990002"; }, v => { v.worker.workerId = id(999); },
    v => { v.fromDate = "2026-09-28"; }, v => { v.fromAt = "2026-09-29T00:00:00.001Z"; }, v => { v.toAt = "2026-10-02T00:00:00.001Z"; },
    v => { v.readAt = "2026-10-04T12:00:00.000Z"; }, v => { v.readAt = "2026-09-25T00:00:00.000000Z"; },
    v => { v.worker.version = 0; }, v => { v.settingsVersion = -0; }, v => { v.personal.items[0].approval.employeeAuthUserId = id(999); }];
  for (const change of changes) { const v = populated(); change(v); reject(v); }
});
test("UTC boundaries follow workplace DST and support the inclusive final 2100 date", () => {
  const dst = { ...query, fromDate: "2026-10-23", throughDate: "2026-10-29" }, raw = wire(dst, "Europe/Madrid");
  assert.equal(Date.parse(parse(raw, dst).toAt) - Date.parse(raw.fromAt), 7 * 86400000 + 3600000);
  const last = { ...query, fromDate: "2100-12-31", throughDate: "2100-12-31" };
  assert.equal(parse(wire(last), last).toAt, "2101-01-01T00:00:00.000Z");
  const skipped = { ...query, fromDate: "2011-12-30", throughDate: "2011-12-31" };
  assert.throws(() => parseRuleSourcesResult({ ...wire(), fromDate: skipped.fromDate, throughDate: skipped.throughDate, timeZone: "Pacific/Apia" }, skipped, owner));
});
test("original assignment overlap retains ended and cancelled history without calling it currently applicable", () => {
  for (const action of ["end", "cancel"] as const) {
    const v = wire(), a = assignment(), original = structuredClone(a.detail.history[0].item);
    const current = { ...original, endsOn: action === "end" ? "2026-09-28" : null, revision: 2 as const, status: action === "end" ? "ended" as const : "cancelled" as const, updatedAt: "2026-09-22T00:00:00.000001Z" };
    a.detail = { ...current, history: [a.detail.history[0], { command: action === "end" ? { operationId: id(880), action, reason: "End", assignmentId: original.assignmentId, expectedRevision: 1, endsOn: "2026-09-28" }
      : { operationId: id(880), action, reason: "Cancel", assignmentId: original.assignmentId, expectedRevision: 1 }, item: current }], canEnd: false, canCancel: action === "end" };
    v.assignments.items = [a]; v.rules.items.push({ groupId: a.currentGroup.groupId, revision: 0, publications: [] });
    const normalized = parse(v).assignments.items[0]; assert.equal(normalized.originalInPeriod, true); assert.equal(normalized.inPeriod, false);
  }
});
test("assignment collection uses saved-zone UTC carry-in, not matching civil labels", () => {
  const v = wire(), a = assignment(701, 801, "America/Los_Angeles", "2026-09-28", "2026-09-28");
  v.assignments.items = [a]; v.rules.items.push({ groupId: a.currentGroup.groupId, revision: 0, publications: [] });
  const normalized = parse(v).assignments.items[0]; assert.equal(normalized.toAt, "2026-09-29T07:00:00.000Z"); assert.equal(normalized.inPeriod, true);
  const excluded = assignment(701, 801, "UTC", "2026-09-28", "2026-09-28"); v.assignments.items = [excluded]; reject(v);
});
test("historical assignment identity mismatch is explicit while current inactive and unbound states are not invented", () => {
  const v = populated(); v.assignments.items[0].detail.employeeId = id(999); v.assignments.items[0].detail.history[0].item.employeeId = id(999);
  assert(parse(v).warnings.includes("identity_changed"));
  const empty = wire(); empty.worker.active = false; empty.worker.employeeActive = false; empty.worker.employeeId = null; empty.worker.employeeAuthUserId = null;
  assert.deepEqual(parse(empty).warnings.slice(2), ["inactive_worker", "inactive_employee", "unbound_employee"]);
  empty.personal.revision = 1; reject(empty);
});
test("rule heads retain one carry-in despite newer drafts and reject wrong scopes, duplicate carry-in or dates at upper boundary", () => {
  const v = populated(); v.rules.items[0].publications.push(publication(910, null, "2026-10-01", 4));
  assert.equal(parse(v).rules.items[0].publications.length, 2);
  const mutations: Array<(w: Wire) => void> = [w => { w.rules.items[1].groupId = id(799); }, w => { w.rules.items[0].publications.push(publication(910, null, "2026-09-29", 4)); },
    w => { w.rules.items[0].publications.push(publication(910, null, "2026-10-02", 4)); }, w => { w.rules.items[1].publications[0].operationId = w.rules.items[0].publications[0].operationId; },
    w => { w.rules.items[0].publications[0].action = "save_draft"; }, w => { w.rules.items.splice(0, 1); }];
  for (const mutation of mutations) { const raw = populated(); mutation(raw); reject(raw); }
});
test("100 global publications are complete but 101 cannot be passed as a truncated success", () => {
  const v = wire(); v.rules.items[0] = { groupId: null, revision: 2, publications: [publication(2000)] };
  for (let n = 1; n < 100; n++) { const a = assignment(3000 + n, 4000 + n); v.assignments.items.push(a); v.rules.items.push({ groupId: a.currentGroup.groupId, revision: 2, publications: [publication(2000 + n, a.currentGroup.groupId)] }); }
  assert.equal(parse(v).rules.items.flatMap(stream => stream.publications).length, 100);
  v.rules.items[0].revision = 4; v.rules.items[0].publications.push(publication(2100, null, "2026-10-01", 4)); reject(v);
  v.rules = { limited: true, items: [] }; assert(parse(v).warnings.includes("rules_truncated"));
});
test("bounded sections reject partial truncation, 101 assignments, and complete rules after limited assignments", () => {
  for (const name of ["assignments", "rules", "personal"] as const) { const v = populated(); v[name].limited = true; reject(v); }
  const v = wire(); v.assignments.limited = true; reject(v); v.rules = { limited: true, items: [] };
  assert(parse(v).warnings.includes("assignments_truncated"));
  const full = wire(); full.rules = { limited: true, items: [] };
  for (let n = 0; n < 100; n++) full.assignments.items.push(assignment(3000 + n, 4000 + n));
  assert.equal(parse(full).assignments.items.length, 100); full.assignments.items.push(assignment(3100, 4100)); reject(full);
});
test("personal source projects UTC overlaps including withdrawn approvals and is not capped to history page 25", () => {
  const v = wire(); v.personal.revision = 200;
  for (let n = 0; n < 100; n++) v.personal.items.push(personal(2 * n + 1, "2026-09-29", "2026-10-01", true));
  const parsed = parse(v); assert.equal(parsed.personal.items.length, 100); assert(parsed.personal.items.every(pair => pair.withdrawal));
  v.personal.revision = 202; v.personal.items.push(personal(201, "2026-09-29", "2026-10-01", true)); reject(v);
  v.personal = { revision: 202, limited: true, items: [] }; assert(parse(v).warnings.includes("personal_truncated"));
});
test("personal boundaries retain carry-in, exclude touching-only intervals and permit adjacent active intervals", () => {
  const v = wire(); v.personal = { revision: 3, limited: false, items: [personal(1, "2026-09-28", "2026-09-29"), personal(3, "2026-09-30", "2026-10-01")] };
  assert.equal(parse(v).personal.items.length, 2);
  v.personal.items[0] = personal(1, "2026-09-28", "2026-09-28"); reject(v);
  v.personal.items[0] = personal(1, "2026-09-28", "2026-09-29", false, "America/Los_Angeles"); reject(v); // overlaps second active UTC interval
});
test("withdrawal must retain the complete original identity, context and rules, ordered history and unique operation/revision", () => {
  const mutations: Array<(v: Wire) => void> = [v => { v.personal.items[0].withdrawal!.employeeId = id(999); }, v => { v.personal.items[0].withdrawal!.employeeAuthUserId = id(999); },
    v => { v.personal.items[0].withdrawal!.settingsVersion = 2; }, v => { v.personal.items[0].withdrawal!.workerVersion = 2; },
    v => { v.personal.items[0].withdrawal!.rules.earlyGraceMinutes = { mode: "value", minutes: 0 }; }, v => { v.personal.items[0].withdrawal!.approvedRevision = 3; },
    v => { v.personal.items[0].withdrawal!.operationId = v.personal.items[0].approval.operationId; }, v => { v.personal.items[1].approval.revision = 2; },
    v => { v.personal.items.reverse(); }, v => { v.personal.items[0].withdrawal!.recordedAt = "2026-09-29T00:00:00.000000Z"; },
    v => { v.personal.items[0].withdrawal!.recordedAt = "2026-09-25T23:59:59.999999Z"; }, v => { v.personal.revision = 2; }];
  for (const mutation of mutations) { const v = populated(); mutation(v); reject(v); }
});
test("nested keys, accessors, symbols, prototypes, sparse arrays and non-enumerable slots reject without executing getters", () => {
  const changes: Array<(v: Wire) => void> = [v => { Object.assign(v.worker, { extra: true }); }, v => { Object.assign(v.assignments.items[0].detail.history[0].command, { extra: true }); },
    v => { Object.assign(v.rules.items[0].publications[0].rules!.lateGraceMinutes, { extra: true }); }, v => { Object.assign(v.personal.items[0].approval, { withdrawnByRevision: 2 }); },
    v => { Object.defineProperty(v.personal.items[0], "approval", { get: () => { throw Error("must not run"); } }); },
    v => { Object.defineProperty(v.personal.items, "0", { enumerable: false }); }, v => { delete (v.personal.items as Array<RuleSourcesPersonalItem | undefined>)[0]; },
    v => { Object.defineProperty(v.worker, Symbol("hidden"), { value: true }); }, v => { Object.setPrototypeOf(v.worker, { inherited: true }); },
    v => { Object.defineProperty(v.worker, "version", { get: () => { throw Error("must not run"); } }); }, v => { Object.assign(v.personal.items[0], { loop: v }); }];
  for (const change of changes) { const raw = populated(); change(raw); reject(raw); }
  const v = populated(); let calls = 0; Object.defineProperty(v.worker, "version", { get: () => { calls++; return 4; } }); reject(v); assert.equal(calls, 0);
});
test("one-MiB UTF-8 tree and exact HTTP wrapper have distinct bounded error codes", () => {
  const v = wire(); v.worker.workerName = "界".repeat(350000); reject(v, "attendance_rule_sources_too_large");
  for (const raw of [{ ok: true, moduleEnabled: true, data: wire(), extra: true }, { ok: true, moduleEnabled: "true", data: wire() }, { ok: false, moduleEnabled: true, data: wire() }]) assert.throws(() => parseRuleSourcesResponse(raw, query, owner));
  assert.equal(RULE_SOURCES_ERRORS.attendance_rule_sources_invalid, 503); assert.equal(RULE_SOURCES_ERRORS.attendance_rule_sources_too_large, 422);
});
