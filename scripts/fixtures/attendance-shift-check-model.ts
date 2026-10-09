// Synthetic, pure test data only; not bundled in the application/browser.
import { shiftRuleBindingWire, shiftRuleBindingQuery, shiftRuleBindingActor, shiftRuleBindingId } from "./attendance-shift-rule-binding-model";
import { projectShiftCheck } from "../../src/lib/merchantAttendanceShiftCheck.server";
import type { AttendanceSessionEvent } from "../../src/lib/merchantAttendanceSession";
import type { ShiftCheckEffect } from "../../src/lib/merchantAttendanceShiftCheck";
import type { SelfScheduleAssociation } from "../../src/lib/merchantAttendanceSelfSchedule";
export const shiftCheckQuery = shiftRuleBindingQuery, shiftCheckActor = shiftRuleBindingActor, shiftCheckId = shiftRuleBindingId;
export function shiftCheckSource(status: "verified" | "unverified" | "missing" = "verified", completed = false) {
  const binding = shiftRuleBindingWire(status, true), first = binding.event;
  binding.readAt = "2026-09-02T16:00:00.000000Z";
  const events: AttendanceSessionEvent[] = [{ id: first.startEventId, locationId: first.locationId, sequence: first.sequence, action: "clock_in",
    occurredAt: first.occurredAt, timeZone: first.timeZone, source: first.source, breakPaid: null }];
  if (completed) events.push(
    { ...events[0], id: shiftCheckId(12), sequence: 2, action: "break_start", occurredAt: "2026-09-02T09:00:00.000000Z", breakPaid: false },
    { ...events[0], id: shiftCheckId(13), sequence: 3, action: "break_end", occurredAt: "2026-09-02T09:00:59.999999Z" },
    { ...events[0], id: shiftCheckId(14), sequence: 4, action: "clock_out", occurredAt: "2026-09-02T10:00:00.000000Z" });
  return { protocol: "shift-check-source-v1" as const, binding, asOf: binding.readAt, events, effect: null as ShiftCheckEffect | null, relation: null as SelfScheduleAssociation | null };
}
export const shiftCheckWire = (status: "verified" | "unverified" | "missing" = "verified", completed = false) =>
  structuredClone(projectShiftCheck(shiftCheckSource(status, completed), shiftCheckQuery, shiftCheckActor));
export const shiftCheckHttp = (status: "verified" | "unverified" | "missing" = "verified", completed = false, moduleEnabled = true) =>
  ({ ok: true, moduleEnabled, data: shiftCheckWire(status, completed) });
export function shiftCheckApprovedEffect(): ShiftCheckEffect {
  const requestId = shiftCheckId(70), operationId = shiftCheckId(71), recordedAt = "2026-09-02T11:00:00.000000Z";
  return { requestId, operationId, revision: 1, policyRevision: 1, action: "approve", originalLastEventId: shiftCheckId(14), recordedAt,
    employeeId: shiftCheckId(2), timeZone: "UTC", proposal: { startAt: "2026-09-02T07:00:00.000000Z", endAt: "2026-09-02T10:00:00.000000Z",
      breaks: [{ startAt: "2026-09-02T09:00:00.000000Z", endAt: "2026-09-02T09:01:00.000000Z", paid: true }] },
    calculationVersion: "declaration-v1", elapsedUs: 10800000000, workedUs: 10740000000, breakUs: 60000000, paidBreakUs: 60000000,
    lineage: { rootRequestId: requestId, rootOperationId: operationId, rootRecordedAt: recordedAt, previousOperationId: null } };
}
