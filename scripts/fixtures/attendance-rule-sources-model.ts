// Synthetic raw130 DTOs for client/rendering tests. These are not database
// receipts, real employees or the old mixed attendance Sources128 protocol.
import { attendanceDayUtcRange } from "../../src/lib/merchantAttendanceTime";
import { emptyAttendanceRuleDraft } from "../../src/lib/merchantAttendanceRuleDraft";
import type { RuleSourcesQuery, RuleSourcesResult, RuleSourcesPersonalItem } from "../../src/lib/merchantAttendanceRuleSources";
import type { GroupAssignmentDetail, GroupItem } from "../../src/lib/merchantAttendanceGroups";
import type { RulesItem } from "../../src/lib/merchantAttendanceRules";

export const ruleSourcesId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const ruleSourcesOwner = ruleSourcesId(99);
export const ruleSourcesQuery: RuleSourcesQuery = { siteId: "99990001", workerId: ruleSourcesId(201), fromDate: "2026-09-29", throughDate: "2026-10-01" };
export type RuleSourcesWire = Omit<RuleSourcesResult, "assignments" | "warnings"> & {
  assignments: { limited: boolean; items: Array<{ detail: GroupAssignmentDetail; currentGroup: GroupItem }> };
};
const employee = ruleSourcesId(101), employeeAuth = ruleSourcesId(102);
const day = (date: string, delta: number) => new Date(Date.parse(date + "T00:00:00.000Z") + delta * 86400000).toISOString().slice(0, 10);

export function ruleSourcesWire(q = ruleSourcesQuery, timeZone = "UTC"): RuleSourcesWire {
  return { protocol: "rule-sources-v1", siteId: q.siteId, actorId: ruleSourcesOwner, fromDate: q.fromDate, throughDate: q.throughDate,
    worker: { workerId: q.workerId, workerName: "Synthetic worker", workerNo: "QA-201", employeeId: employee,
      employeeAuthUserId: employeeAuth, version: 4, active: true, employeeActive: true },
    settingsVersion: 5, timeZone, fromAt: attendanceDayUtcRange(q.fromDate, timeZone).startAt,
    toAt: attendanceDayUtcRange(q.throughDate, timeZone).endAt, readAt: "2026-10-04T12:00:00.000001Z",
    assignments: { limited: false, items: [] }, rules: { limited: false, items: [{ groupId: null, revision: 0, publications: [] }] },
    personal: { revision: 0, limited: false, items: [] } };
}

export function ruleSourcesHttp(q = ruleSourcesQuery, moduleEnabled = true) {
  return { ok: true as const, moduleEnabled, data: ruleSourcesWire(q) };
}

export function ruleSourcesAssignment(q = ruleSourcesQuery, group = 701, assignment = 801): RuleSourcesWire["assignments"]["items"][number] {
  const original = { assignmentId: ruleSourcesId(assignment), groupId: ruleSourcesId(group), groupName: "Original synthetic group",
    workerId: q.workerId, workerName: "Synthetic worker", workerNo: "QA-201", employeeId: employee, timeZone: "UTC",
    startsOn: day(q.fromDate, -1), endsOn: null, createdAt: "2026-09-21T00:00:00.000001Z", updatedAt: "2026-09-21T00:00:00.000001Z",
    revision: 1 as const, status: "assigned" as const };
  return { detail: { ...original, history: [{ command: { operationId: original.assignmentId, action: "assign", reason: "Synthetic assignment",
    groupId: original.groupId, workerId: q.workerId, expectedGroupRevision: 1, expectedWorkerVersion: 1, expectedSettingsVersion: 1,
    timeZone: "UTC", startsOn: original.startsOn, endsOn: null }, item: { ...original } }], canEnd: true, canCancel: true },
    currentGroup: { groupId: original.groupId, revision: 3, name: "Current synthetic group", description: "", active: true,
      createdAt: "2026-09-20T00:00:00.000001Z", updatedAt: "2026-09-25T00:00:00.000001Z" } };
}

export function ruleSourcesPublication(operation = 900, groupId: string | null = null, effectiveOn = "2026-09-28", revision = 2): RulesItem {
  return { revision, operationId: ruleSourcesId(operation), actorId: ruleSourcesOwner, action: "publish", reason: "Synthetic publication",
    recordedAt: "2026-09-25T00:00:00.000001Z", settingsVersion: 1, groupRevision: groupId === null ? null : 1, timeZone: "UTC",
    rules: { ...emptyAttendanceRuleDraft(), lateGraceMinutes: { mode: "value", minutes: 12 }, earlyGraceMinutes: { mode: "value", minutes: 3 },
      openSpanWarningMinutes: { mode: "value", minutes: 120 }, completedBreakMinimumMinutes: { mode: "disabled" } },
    effectiveOn, effectiveAt: attendanceDayUtcRange(effectiveOn, "UTC").startAt, publishedRevision: null };
}

export function ruleSourcesPersonal(revision = 1, startsOn = "2026-09-29", endsOn = startsOn, withdrawn = false): RuleSourcesPersonalItem {
  const approval: RuleSourcesPersonalItem["approval"] = { revision, operationId: ruleSourcesId(1000 + revision), actorId: ruleSourcesOwner,
    action: "approve", reason: "Synthetic personal candidate", recordedAt: `2026-09-26T00:00:00.${String(revision).padStart(6, "0")}Z`,
    employeeId: employee, employeeAuthUserId: employeeAuth, workerVersion: 1, settingsVersion: 1, timeZone: "UTC", startsOn, endsOn,
    fromAt: attendanceDayUtcRange(startsOn, "UTC").startAt, toAt: attendanceDayUtcRange(endsOn, "UTC").endAt,
    rules: { ...emptyAttendanceRuleDraft(), lateGraceMinutes: { mode: "value", minutes: 0 } }, approvedRevision: null };
  return { approval, withdrawal: withdrawn ? { ...structuredClone(approval), action: "withdraw", approvedRevision: revision, revision: revision + 1,
    operationId: ruleSourcesId(1001 + revision), actorId: ruleSourcesId(98), reason: "Synthetic withdrawal before start",
    recordedAt: `2026-09-26T00:00:00.${String(revision + 1).padStart(6, "0")}Z` } : null };
}

export function ruleSourcesPopulated(q = ruleSourcesQuery): RuleSourcesWire {
  const raw = ruleSourcesWire(q), assignment = ruleSourcesAssignment(q);
  const enterprise = ruleSourcesPublication(900, null, day(q.fromDate, -1));
  const group = ruleSourcesPublication(901, assignment.currentGroup.groupId, day(q.fromDate, -1));
  group.rules = { ...emptyAttendanceRuleDraft(), earlyGraceMinutes: { mode: "disabled" }, completedBreakMinimumMinutes: { mode: "value", minutes: 1 } };
  raw.assignments.items = [assignment];
  raw.rules.items = [{ groupId: null, revision: 40, publications: [enterprise] }, { groupId: assignment.currentGroup.groupId, revision: 90, publications: [group] }];
  raw.personal = { revision: 3, limited: false, items: [ruleSourcesPersonal(1, q.fromDate, q.throughDate, true), ruleSourcesPersonal(3, q.fromDate)] };
  return raw;
}
