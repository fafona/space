// Synthetic, browser-safe wire fixtures. The token has a canonical zero-byte
// signature for structural tests only; it is NOT a real signed QR capability.
import type { OnsiteClaims, OnsiteCommand } from "../../src/lib/merchantAttendanceOnsiteQr";
import type { OnsiteScheduleHttpResult, OnsiteScheduleParseInput, OnsiteScheduleResult } from "../../src/lib/merchantAttendanceOnsiteSchedule";
import type { SelfScheduleSlot } from "../../src/lib/merchantAttendanceSelfSchedule";

export const onsiteScheduleId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const onsiteScheduleSite = "99990001";
export const onsiteScheduleActor = onsiteScheduleId(1);
export const onsiteScheduleEmployee = onsiteScheduleId(2);
export const onsiteScheduleQuery = { siteId: onsiteScheduleSite, operationId: null };
export const onsiteScheduleSelection = { slotId: onsiteScheduleId(6), revision: 3 };
const at = "2026-10-08T07:50:00.000Z";
export function onsiteScheduleCommand(): OnsiteCommand {
  return { expectedWorkerId: onsiteScheduleId(3), expectedEmployeeId: onsiteScheduleEmployee, operationId: onsiteScheduleId(5),
    locationId: onsiteScheduleId(4), action: "clock_in", expectedSequence: 0 };
}
export function onsiteScheduleClaims(): OnsiteClaims {
  const issuedAtMs = Date.parse(at);
  return { v: 1, purpose: "faolla.attendance.onsite", siteId: onsiteScheduleSite, terminalId: onsiteScheduleId(10), locationId: onsiteScheduleId(4),
    pairedAtMs: issuedAtMs - 86400000, issuedAtMs, expiresAtMs: issuedAtMs + 45000, nonce: onsiteScheduleId(11) };
}
export function onsiteScheduleToken(claims = onsiteScheduleClaims()): string {
  const base64url = (value: string) => btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `aq1.${base64url(JSON.stringify(claims))}.${base64url("\0".repeat(32))}`;
}
export function onsiteScheduleBody() {
  return { siteId: onsiteScheduleSite, token: onsiteScheduleToken(), command: onsiteScheduleCommand(), selection: { ...onsiteScheduleSelection } };
}
export function onsiteScheduleInput(post = false): OnsiteScheduleParseInput {
  return { ...onsiteScheduleQuery, command: post ? onsiteScheduleCommand() : null, authUserId: onsiteScheduleActor,
    employeeId: onsiteScheduleEmployee, expectedWorkerId: onsiteScheduleId(3), ...(post ? { selection: { ...onsiteScheduleSelection } } : {}) };
}
export function onsiteScheduleSlot(): SelfScheduleSlot {
  return { id: onsiteScheduleId(6), revision: 3, locationId: onsiteScheduleId(4), locationName: "合成现场地点", timeZone: "Europe/Madrid",
    workDate: "2026-10-08", startAt: "2026-10-08T08:00:00.000Z", endAt: "2026-10-08T16:00:00.000Z", cancelled: false, hasPublicationEvidence: true };
}
export function onsiteScheduleWire(post = false): OnsiteScheduleResult {
  const command = onsiteScheduleCommand();
  const event = post ? { id: onsiteScheduleId(7), siteId: onsiteScheduleSite, workerId: command.expectedWorkerId, locationId: command.locationId,
    operationId: command.operationId, action: "clock_in" as const, breakPaid: null, sequence: 1, occurredAt: at, timeZone: "Europe/Madrid" } : null;
  return { protocol: "onsite-schedule-v1", clock: { workerId: command.expectedWorkerId, employeeId: onsiteScheduleEmployee, locationId: command.locationId,
    state: { sequence: post ? 1 : 0, status: post ? "working" : "off", lastEvent: event }, receipt: event, replayed: false },
  choices: { timeZone: post ? null : "Europe/Madrid", fromDate: post ? null : "2026-10-07", throughDate: post ? null : "2026-10-09",
    revision: 3, limited: false, entries: post ? [] : [onsiteScheduleSlot()] },
  association: post ? { startEventId: onsiteScheduleId(7), operationId: command.operationId, selection: { ...onsiteScheduleSelection }, status: "linked", reason: null,
    slot: onsiteScheduleSlot(), observedRevision: 3, recordedAt: "2026-10-08T07:50:00.123456Z", currentCancelled: false } : null,
  adoption: post ? { startEventId: onsiteScheduleId(7), operationId: command.operationId, channel: "onsite", employeeId: onsiteScheduleEmployee,
    employeeAuthUserId: onsiteScheduleActor, status: "adopted", reason: null, approval: { operationId: onsiteScheduleId(8), revision: 6,
      sourceId: onsiteScheduleId(9), sourceSha256: "a".repeat(64), recordedAt: "2026-10-05T09:00:00.123456Z" },
    recordedAt: "2026-10-08T07:50:00.123456Z", policy: "explicit-plan-approval-at-clock-in-v1" } : null };
}
export function onsiteScheduleHttp(post = false, moduleEnabled = true, selectionEnabled = moduleEnabled): OnsiteScheduleHttpResult {
  const result = onsiteScheduleWire(post); if (!selectionEnabled) result.choices.entries = [];
  return { ok: true, moduleEnabled, selectionEnabled, ...result };
}
