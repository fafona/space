// Synthetic, browser-safe PIN schedule wire. The test PIN is not a credential.
import type { PinClockCommand } from "../../src/lib/merchantAttendancePinClock";
import type { PinScheduleBody, PinScheduleHttpResult, PinScheduleParseInput, PinScheduleResult } from "../../src/lib/merchantAttendancePinSchedule";
import type { SelfScheduleSlot } from "../../src/lib/merchantAttendanceSelfSchedule";

export const pinScheduleId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const pinScheduleSite = "99990001";
export const pinScheduleTerminal = pinScheduleId(10);
export const pinScheduleEmployee = pinScheduleId(2);
export const pinScheduleEmployeeAuth = pinScheduleId(1);
export const pinScheduleWorkerNo = "PIN-01";
export const pinSchedulePin = "01738264";
export const pinScheduleSelection = { slotId: pinScheduleId(6), revision: 3 };
export function pinScheduleCommand(): PinClockCommand {
  return { expectedWorkerId: pinScheduleId(3), expectedEmployeeId: pinScheduleEmployee, operationId: pinScheduleId(5),
    locationId: pinScheduleId(4), action: "clock_in", expectedSequence: 0 };
}
export function pinScheduleBody(write = false): PinScheduleBody {
  return { workerNo: pinScheduleWorkerNo, pin: pinSchedulePin, command: write ? pinScheduleCommand() : null,
    operationId: null, selection: write ? { ...pinScheduleSelection } : null };
}
export function pinScheduleInput(write = false): PinScheduleParseInput {
  return { siteId: pinScheduleSite, terminalId: pinScheduleTerminal, workerNo: pinScheduleWorkerNo, command: write ? pinScheduleCommand() : null,
    operationId: null, selection: write ? { ...pinScheduleSelection } : null, expectedWorkerId: pinScheduleId(3),
    expectedEmployeeId: pinScheduleEmployee, expectedEmployeeAuthUserId: pinScheduleEmployeeAuth };
}
export function pinScheduleSlot(): SelfScheduleSlot {
  return { id: pinScheduleId(6), revision: 3, locationId: pinScheduleId(4), locationName: "合成 PIN 终端地点", timeZone: "Europe/Madrid",
    workDate: "2026-10-08", startAt: "2026-10-08T08:00:00.000Z", endAt: "2026-10-08T16:00:00.000Z", cancelled: false, hasPublicationEvidence: true };
}
export function pinScheduleWire(write = false): PinScheduleResult {
  const command = pinScheduleCommand();
  const event = write ? { id: pinScheduleId(7), siteId: pinScheduleSite, workerId: command.expectedWorkerId, locationId: command.locationId,
    operationId: command.operationId, action: "clock_in" as const, breakPaid: null, sequence: 1, occurredAt: "2026-10-08T07:50:00.000Z", timeZone: "Europe/Madrid" } : null;
  return { protocol: "pin-schedule-v1", clock: { siteId: pinScheduleSite, terminalId: pinScheduleTerminal, workerNo: pinScheduleWorkerNo,
    workerName: "合成 PIN 员工", workerId: command.expectedWorkerId, employeeId: pinScheduleEmployee, locationId: command.locationId,
    state: { sequence: write ? 1 : 0, status: write ? "working" : "off", lastEvent: event }, receipt: event, replayed: false,
    canStart: true, canFinish: true, blockReason: null },
  choices: { timeZone: write ? null : "Europe/Madrid", fromDate: write ? null : "2026-10-07", throughDate: write ? null : "2026-10-09",
    revision: 3, limited: false, entries: write ? [] : [pinScheduleSlot()] },
  association: write ? { startEventId: pinScheduleId(7), operationId: command.operationId, selection: { ...pinScheduleSelection }, status: "linked", reason: null,
    slot: pinScheduleSlot(), observedRevision: 3, recordedAt: "2026-10-08T07:50:00.123456Z", currentCancelled: false } : null,
  adoption: write ? { startEventId: pinScheduleId(7), operationId: command.operationId, channel: "pin", employeeId: pinScheduleEmployee,
    employeeAuthUserId: pinScheduleEmployeeAuth, status: "adopted", reason: null, approval: { operationId: pinScheduleId(8), revision: 6,
      sourceId: pinScheduleId(9), sourceSha256: "a".repeat(64), recordedAt: "2026-10-05T09:00:00.123456Z" },
    recordedAt: "2026-10-08T07:50:00.123456Z", policy: "explicit-plan-approval-at-clock-in-v1" } : null };
}
export function pinScheduleHttp(write = false, moduleEnabled = true, selectionEnabled = moduleEnabled): PinScheduleHttpResult {
  const result = pinScheduleWire(write); if (!selectionEnabled) result.choices.entries = []; if (!moduleEnabled) result.clock.canStart = false;
  return { ok: true, moduleEnabled, selectionEnabled, ...result };
}
