// Synthetic protocol fixtures only: no SQL, auth claims, GPS or hash proof.
import type { AttendanceLocationClockCommand } from "../../src/lib/merchantAttendanceLocationClock";
import type { LocationScheduleHttpResult, LocationScheduleParseInput, LocationScheduleResult } from "../../src/lib/merchantAttendanceLocationSchedule";
import type { SelfScheduleSlot } from "../../src/lib/merchantAttendanceSelfSchedule";

export const locationScheduleId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const locationScheduleSite = "99990001";
export const locationScheduleActor = locationScheduleId(1);
export const locationScheduleEmployee = locationScheduleId(2);
export const locationScheduleSelection = { slotId: locationScheduleId(6), revision: 3 };
export const locationScheduleQuery = { siteId: locationScheduleSite, expectedWorkerId: locationScheduleId(3), operationId: null };
const at = "2026-10-08T07:50:00.000Z";
export function locationScheduleCommand(): AttendanceLocationClockCommand {
  return { expectedWorkerId: locationScheduleId(3), operationId: locationScheduleId(5), locationId: locationScheduleId(4), action: "clock_in", expectedSequence: 0,
    settingsVersion: 2, workerVersion: 4, locationVersion: 7, noticeRevision: 8, safeFinish: false,
    position: { latitude: 37.3, longitude: -5.9, accuracyMeters: 10, capturedAt: at }, positionFailure: null };
}
export function locationScheduleInput(post = false): LocationScheduleParseInput {
  return { ...locationScheduleQuery, command: post ? locationScheduleCommand() : null,
    authUserId: locationScheduleActor, employeeId: locationScheduleEmployee, ...(post ? { selection: { ...locationScheduleSelection } } : {}) };
}
export function locationScheduleSlot(): SelfScheduleSlot {
  return { id: locationScheduleId(6), revision: 3, locationId: locationScheduleId(4), locationName: "合成定位地点", timeZone: "Europe/Madrid",
    workDate: "2026-10-08", startAt: "2026-10-08T08:00:00.000Z", endAt: "2026-10-08T16:00:00.000Z", cancelled: false, hasPublicationEvidence: true };
}
export function locationScheduleWire(post = false): LocationScheduleResult {
  const command = locationScheduleCommand();
  const event = post ? { id: locationScheduleId(7), siteId: locationScheduleSite, workerId: command.expectedWorkerId, locationId: command.locationId,
    operationId: command.operationId, action: "clock_in" as const, breakPaid: null, sequence: 1, occurredAt: at, timeZone: "Europe/Madrid" } : null;
  const { expectedWorkerId: _worker, position: _position, positionFailure: _failure, ...intent } = command;
  void _worker; void _position; void _failure;
  return { protocol: "location-schedule-v1", clock: { siteId: locationScheduleSite, employeeId: locationScheduleEmployee, workerId: command.expectedWorkerId,
    locationId: command.locationId, state: { sequence: post ? 1 : 0, status: post ? "working" : "off", lastEvent: event }, receipt: event, replayed: false,
    channelEnabled: true, policy: { settingsVersion: 2, workerVersion: 4, locationVersion: 7, mode: "record_and_review", maxAgeMs: 60000, algorithmVersion: 1 },
    locationResult: post ? { eventId: locationScheduleId(7), settingsVersion: 2, workerVersion: 4, locationVersion: 7, algorithmVersion: 1,
      reason: "inside", needsReview: false, capturedAt: at, accuracyMeters: 10, distanceMeters: 0 } : null,
    noticeGate: { ready: true, reason: "ready", revision: 8 }, finish: post ? { locationId: command.locationId, settingsVersion: 2, workerVersion: 4, locationVersion: 7 } : null,
    receiptGate: post ? { noticeRevision: 8, safeFinish: false, command: intent } : null },
  choices: { timeZone: post ? null : "Europe/Madrid", fromDate: post ? null : "2026-10-07", throughDate: post ? null : "2026-10-09", revision: 3,
    limited: false, entries: post ? [] : [locationScheduleSlot()] },
  association: post ? { startEventId: locationScheduleId(7), operationId: command.operationId, selection: { ...locationScheduleSelection }, status: "linked", reason: null,
    slot: locationScheduleSlot(), observedRevision: 3, recordedAt: "2026-10-08T07:50:00.123456Z", currentCancelled: false } : null,
  adoption: post ? { startEventId: locationScheduleId(7), operationId: command.operationId, channel: "location", employeeId: locationScheduleEmployee,
    employeeAuthUserId: locationScheduleActor, status: "adopted", reason: null, approval: { operationId: locationScheduleId(8), revision: 6,
      sourceId: locationScheduleId(9), sourceSha256: "a".repeat(64), recordedAt: "2026-10-05T09:00:00.123456Z" },
    recordedAt: "2026-10-08T07:50:00.123456Z", policy: "explicit-plan-approval-at-clock-in-v1" } : null };
}
export function locationScheduleHttp(post = false, moduleEnabled = true, selectionEnabled = moduleEnabled): LocationScheduleHttpResult {
  const result = locationScheduleWire(post); if (!selectionEnabled) result.choices.entries = [];
  return { ok: true, moduleEnabled, selectionEnabled, ...result };
}
export function locationScheduleRaw(post = false) {
  const result = locationScheduleWire(post);
  return { ...result, clock: { ...result.clock, internalPolicyFingerprint: "b".repeat(32),
    internalFence: { latitude: 37.3, longitude: -5.9, radiusMeters: 100, maxAgeMs: 60000 } } };
}
