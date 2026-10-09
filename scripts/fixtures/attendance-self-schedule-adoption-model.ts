// Synthetic browser-safe fixtures, not real employee or owner credentials.
import type { AttendanceSelfCommand } from "../../src/lib/merchantAttendanceSelf";
import type { SelfScheduleAdoptionHttpResult, SelfScheduleAdoptionParseInput, SelfScheduleAdoptionResult } from "../../src/lib/merchantAttendanceSelfScheduleAdoption";
import type { SelfScheduleSlot } from "../../src/lib/merchantAttendanceSelfSchedule";

export const selfScheduleAdoptionId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const selfScheduleAdoptionSite = "99990001";
export const selfScheduleAdoptionActor = selfScheduleAdoptionId(1);
export const selfScheduleAdoptionEmployee = selfScheduleAdoptionId(2);
export const selfScheduleAdoptionQuery = { siteId: selfScheduleAdoptionSite, operationId: null };
export const selfScheduleAdoptionSelection = { slotId: selfScheduleAdoptionId(6), revision: 3 };
export function selfScheduleAdoptionCommand(): AttendanceSelfCommand {
  return { expectedWorkerId: selfScheduleAdoptionId(3), operationId: selfScheduleAdoptionId(5),
    locationId: selfScheduleAdoptionId(4), action: "clock_in", expectedSequence: 0 };
}
export function selfScheduleAdoptionBody() {
  return { siteId: selfScheduleAdoptionSite, command: selfScheduleAdoptionCommand(), selection: { ...selfScheduleAdoptionSelection } };
}
export function selfScheduleAdoptionInput(post = false): SelfScheduleAdoptionParseInput {
  return { ...selfScheduleAdoptionQuery, command: post ? selfScheduleAdoptionCommand() : null, authUserId: selfScheduleAdoptionActor,
    expectedEmployeeId: selfScheduleAdoptionEmployee, ...(post ? { selection: { ...selfScheduleAdoptionSelection } } : {}) };
}
export function selfScheduleAdoptionSlot(): SelfScheduleSlot {
  return { id: selfScheduleAdoptionId(6), revision: 3, locationId: selfScheduleAdoptionId(4), locationName: "合成本人地点", timeZone: "Europe/Madrid",
    workDate: "2026-10-08", startAt: "2026-10-08T08:00:00.000Z", endAt: "2026-10-08T16:00:00.000Z", cancelled: false, hasPublicationEvidence: true };
}
export function selfScheduleAdoptionWire(post = false): SelfScheduleAdoptionResult {
  const command = selfScheduleAdoptionCommand();
  const event = post ? { id: selfScheduleAdoptionId(7), siteId: selfScheduleAdoptionSite, workerId: command.expectedWorkerId, locationId: command.locationId,
    operationId: command.operationId, action: "clock_in" as const, breakPaid: null, sequence: 1, occurredAt: "2026-10-08T07:50:00.000Z", timeZone: "Europe/Madrid" } : null;
  return { protocol: "self-schedule-adoption-v1", clock: { workerId: command.expectedWorkerId, locationId: command.locationId,
    state: { sequence: post ? 1 : 0, status: post ? "working" : "off", lastEvent: event }, receipt: event, replayed: false },
  choices: { timeZone: post ? null : "Europe/Madrid", fromDate: post ? null : "2026-10-07", throughDate: post ? null : "2026-10-09",
    revision: 3, limited: false, entries: post ? [] : [selfScheduleAdoptionSlot()] },
  association: post ? { startEventId: selfScheduleAdoptionId(7), operationId: command.operationId, selection: { ...selfScheduleAdoptionSelection }, status: "linked", reason: null,
    slot: selfScheduleAdoptionSlot(), observedRevision: 3, recordedAt: "2026-10-08T07:50:00.123456Z", currentCancelled: false } : null,
  adoption: post ? { startEventId: selfScheduleAdoptionId(7), operationId: command.operationId, channel: "self", employeeId: selfScheduleAdoptionEmployee,
    employeeAuthUserId: selfScheduleAdoptionActor, status: "adopted", reason: null, approval: { operationId: selfScheduleAdoptionId(8), revision: 6,
      sourceId: selfScheduleAdoptionId(9), sourceSha256: "a".repeat(64), recordedAt: "2026-10-05T09:00:00.123456Z" },
    recordedAt: "2026-10-08T07:50:00.123456Z", policy: "explicit-plan-approval-at-clock-in-v1" } : null };
}
export function selfScheduleAdoptionHttp(post = false, moduleEnabled = true, selectionEnabled = moduleEnabled): SelfScheduleAdoptionHttpResult {
  const result = selfScheduleAdoptionWire(post); if (!selectionEnabled) result.choices.entries = [];
  return { ok: true, moduleEnabled, selectionEnabled, ...result };
}
