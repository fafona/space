// Synthetic frozen bytes, no database/authentication and no current tzdata.
import { createHash } from "node:crypto";
import type { ShiftRuleBindingResult, ShiftRulePoint, ShiftRuleField, ShiftRuleProvenance } from "../../src/lib/merchantAttendanceShiftRuleBinding";
export const shiftRuleBindingId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const id = shiftRuleBindingId;
export const shiftRuleBindingActor = id(1);
export const shiftRuleBindingQuery = { siteId: "99990009", workerId: id(4), startEventId: id(10) };
const record = "2026-08-01T08:00:00.000001Z";
const inherited = () => ({ lateGraceMinutes: { mode: "inherit" as const }, earlyGraceMinutes: { mode: "inherit" as const }, openSpanWarningMinutes: { mode: "inherit" as const }, completedBreakMinimumMinutes: { mode: "inherit" as const } });
export function shiftRulePoint(withLayers = false): ShiftRulePoint {
  const publication = { revision: 2, operationId: id(21), actorId: id(90), action: "publish" as const, reason: "Historical owner publication", recordedAt: record,
    settingsVersion: 1, groupRevision: null, timeZone: "UTC", rules: { ...inherited(), lateGraceMinutes: { mode: "value" as const, minutes: 0 }, earlyGraceMinutes: { mode: "disabled" as const }, completedBreakMinimumMinutes: { mode: "value" as const, minutes: 1 } },
    effectiveOn: "2026-09-01", effectiveAt: "2026-09-01T00:00:00.000Z", publishedRevision: null };
  const point: ShiftRulePoint = { protocol: "shift-rule-point-v1", algorithmVersion: "personal-group-enterprise-point-v1", bindingPolicy: "clock-in-whole-shift-v1",
    siteId: shiftRuleBindingQuery.siteId, workerId: shiftRuleBindingQuery.workerId, employeeId: id(2), employeeAuthUserId: id(3), workerVersion: 2, settingsVersion: 3,
    timeZone: "Europe/Madrid", assignment: null, enterprise: { revision: 4, publication }, group: null, personal: { revision: 0, approval: null }, fields: {} as ShiftRulePoint["fields"] };
  if (withLayers) {
    const item = { assignmentId: id(30), groupId: id(31), groupName: "Saved group", workerId: point.workerId, workerName: "Saved worker", workerNo: "OLD", employeeId: point.employeeId,
      timeZone: "UTC", startsOn: "2026-09-01", endsOn: null, createdAt: record, updatedAt: record, revision: 1 as const, status: "assigned" as const };
    point.assignment = { detail: { ...item, history: [{ item: { ...item }, command: { operationId: item.assignmentId, action: "assign", reason: "Saved assignment", groupId: item.groupId, workerId: point.workerId,
      expectedGroupRevision: 1, expectedWorkerVersion: 1, expectedSettingsVersion: 1, timeZone: "UTC", startsOn: item.startsOn, endsOn: null } }], canEnd: true, canCancel: true },
      workerVersion: 1, settingsVersion: 1, groupRevision: 1, fromAt: "2026-09-01T00:00:00.000000Z", toAt: null, originalFromAt: "2026-09-01T00:00:00.000000Z", originalToAt: null };
    point.group = { group: { groupId: id(31), revision: 2, name: "Current-at-binding group", description: "", active: true, createdAt: record, updatedAt: record }, revision: 2,
      publication: { ...publication, operationId: id(32), groupRevision: 1, rules: { ...inherited(), openSpanWarningMinutes: { mode: "value", minutes: 480 } } } };
    point.personal = { revision: 3, approval: { revision: 1, operationId: id(40), actorId: id(91), action: "approve", reason: "Saved personal choice", recordedAt: record,
      employeeId: point.employeeId, employeeAuthUserId: point.employeeAuthUserId, workerVersion: 1, settingsVersion: 1, timeZone: "UTC", startsOn: "2026-09-02", endsOn: "2026-09-02",
      fromAt: "2026-09-02T00:00:00.000Z", toAt: "2026-09-03T00:00:00.000Z", rules: { ...inherited(), lateGraceMinutes: { mode: "value", minutes: 5 } }, approvedRevision: null } };
  }
  return refreshShiftRulePointFields(point);
}
export function refreshShiftRulePointFields(point: ShiftRulePoint) {
  for (const key of ["lateGraceMinutes", "earlyGraceMinutes", "openSpanWarningMinutes", "completedBreakMinimumMinutes"] as const) {
    const field: ShiftRuleField = { state: "unconfigured", minutes: null, source: null, trace: [] };
    for (const layer of ["personal", "group", "enterprise"] as const) {
      const part = point[layer], item = layer === "personal" ? point.personal.approval : layer === "group" ? point.group?.publication : point.enterprise.publication;
      const gid = layer === "group" ? point.group?.group.groupId ?? null : null, head = part?.revision ?? null, choice = item?.rules?.[key];
      const mode = choice?.mode ?? (layer === "personal" ? "missing_approval" : layer === "group" && !point.group ? "no_assignment" : "missing_publication");
      const source: ShiftRuleProvenance | null = item ? { layer, groupId: gid, ledgerRevision: head!, operationId: item.operationId, revision: item.revision, actorId: item.actorId } : null;
      const minutes = choice?.mode === "value" ? choice.minutes : null;
      field.trace.push({ layer, groupId: gid, ledgerRevision: head, mode, minutes, source });
      if (field.state === "unconfigured" && (mode === "value" || mode === "disabled")) { field.state = mode; field.minutes = minutes; field.source = source; }
    }
    point.fields[key] = field;
  }
  return point;
}
export function rehashShiftRuleBinding(wire: ShiftRuleBindingResult, point: ShiftRulePoint | string) {
  const text = typeof point === "string" ? point : JSON.stringify(point), bytes = Buffer.from(text, "utf8");
  wire.binding!.source = { sourceId: id(9), sourceText: text, sourceSha256: createHash("sha256").update(bytes).digest("hex"), sourceBytes: bytes.length, canonicalFormat: "pg-jsonb-text-utf8-v1" };
  return wire;
}
export function shiftRuleBindingWire(status: ShiftRuleBindingResult["status"] = "verified", withLayers = false): ShiftRuleBindingResult {
  const result: ShiftRuleBindingResult = { protocol: "shift-rule-binding-v1", readOnly: true, formalReady: false, siteId: shiftRuleBindingQuery.siteId, actorId: shiftRuleBindingActor,
    worker: { workerId: shiftRuleBindingQuery.workerId, workerName: "Current worker", workerNo: "NOW", employeeId: id(2), employeeAuthUserId: id(3), version: 5, active: true, employeeActive: true },
    event: { startEventId: shiftRuleBindingQuery.startEventId, operationId: id(11), sequence: 1, locationId: id(5), occurredAt: "2026-09-02T08:00:00.000000Z", timeZone: "UTC", source: "web", employeeId: id(2) },
    status, reason: status === "verified" ? null : status === "missing" ? "binding_missing" : "source_quota", readAt: "2026-10-04T12:00:00.000001Z",
    binding: status === "missing" ? null : { channel: "self", requestAuthUserId: id(3), employeeId: id(2), employeeAuthUserId: id(3), workerVersion: 2, settingsVersion: 3,
      algorithmVersion: "personal-group-enterprise-point-v1", bindingPolicy: "clock-in-whole-shift-v1", recordedAt: "2026-09-02T08:00:00.000900Z", source: null } };
  return status === "verified" ? rehashShiftRuleBinding(result, shiftRulePoint(withLayers)) : result;
}
