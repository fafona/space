import { MERCHANT_ATTENDANCE_ACTIONS, requireAttendanceUuid, validateAttendanceCommand, type AttendanceAction, type AttendanceEvent } from "@/lib/merchantAttendance";
import { MerchantAttendanceError, attendanceInstant, attendanceTimeZone } from "@/lib/merchantAttendanceTime";
import { administrativeClockBoundary } from "./merchantAttendanceAdministrativeBoundary";
import type { AdministrativeClosureBoundary } from "./merchantAttendanceAdministrativeClosure";

export type AttendanceSelfCommand = {
  expectedWorkerId: string;
  operationId: string;
  locationId: string;
  action: AttendanceAction;
  expectedSequence: number;
};
export type AttendanceSelfResult = {
  workerId: string;
  locationId: string | null;
  state: { sequence: number; status: "off" | "working" | "break"; lastEvent: AttendanceEvent | null; administrativeBoundary?: AdministrativeClosureBoundary };
  receipt: AttendanceEvent | null;
  replayed: boolean;
};

export function attendanceSelfSite(value: unknown): string {
  if (typeof value !== "string" || !/^\d{8}$/.test(value)) throw new MerchantAttendanceError("attendance_invalid_request");
  return value;
}

export function attendanceSelfUuid(value: unknown): string {
  if (typeof value !== "string") throw new MerchantAttendanceError("attendance_invalid_request");
  try { requireAttendanceUuid(value); } catch { throw new MerchantAttendanceError("attendance_invalid_request"); }
  return value;
}

export function parseAttendanceSelfCommand(value: unknown): { siteId: string; command: AttendanceSelfCommand } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MerchantAttendanceError("attendance_invalid_request");
  const body = value as Record<string, unknown>;
  const keys = ["siteId", "expectedWorkerId", "operationId", "locationId", "action", "expectedSequence"];
  if (Object.keys(body).length !== keys.length || keys.some((key) => !Object.hasOwn(body, key))) throw new MerchantAttendanceError("attendance_invalid_request");
  if (typeof body.action !== "string" || !MERCHANT_ATTENDANCE_ACTIONS.includes(body.action as AttendanceAction)
    || typeof body.expectedSequence !== "number" || !Number.isSafeInteger(body.expectedSequence)
    || body.expectedSequence < 0 || body.expectedSequence >= Number.MAX_SAFE_INTEGER) throw new MerchantAttendanceError("attendance_invalid_request");
  return { siteId: attendanceSelfSite(body.siteId), command: {
    expectedWorkerId: attendanceSelfUuid(body.expectedWorkerId),
    operationId: attendanceSelfUuid(body.operationId), locationId: attendanceSelfUuid(body.locationId),
    action: body.action as AttendanceAction, expectedSequence: body.expectedSequence,
  } };
}

export function parseAttendanceSelfQuery(url: string) {
  const query = new URL(url).searchParams;
  for (const key of query.keys()) {
    if (!["siteId", "operationId"].includes(key) || query.getAll(key).length !== 1) throw new MerchantAttendanceError("attendance_invalid_request");
  }
  return { siteId: attendanceSelfSite(query.get("siteId")),
    operationId: query.has("operationId") ? attendanceSelfUuid(query.get("operationId")) : null };
}

export const ATTENDANCE_SELF_ERROR_STATUS: Readonly<Record<string, number>> = {
  attendance_invalid_request: 400, attendance_body_too_large: 413, attendance_invalid_content_type: 415,
  attendance_disabled: 403, attendance_web_disabled: 403, attendance_access_denied: 403,
  attendance_platform_paused: 403,
  attendance_location_denied: 403, attendance_location_verification_required: 403, attendance_not_employed: 403,
  attendance_operation_conflict: 409, attendance_sequence_conflict: 409, attendance_time_reversed: 409,
  attendance_worker_changed: 409,
  attendance_operational_punch_protocol_required: 409,
  attendance_already_clocked_in: 409, attendance_not_working: 409, attendance_not_on_break: 409,
  attendance_break_must_end: 409, attendance_not_clocked_in: 409,
  attendance_rate_limited: 429,
};

export function parseAttendanceSelfResult(data: unknown, input: { siteId: string; command: AttendanceSelfCommand | null; operationId: string | null }): AttendanceSelfResult {
  const fail = () => { throw new MerchantAttendanceError("attendance_unavailable"); };
  const value = data as AttendanceSelfResult | null;
  if (!value || !value.state || !Number.isSafeInteger(value.state.sequence) || value.state.sequence < 0
    || !["off", "working", "break"].includes(value.state.status) || typeof value.replayed !== "boolean") return fail();
  requireAttendanceUuid(value.workerId);
  if (input.command && value.workerId !== input.command.expectedWorkerId) return fail();
  if (value.locationId !== null) requireAttendanceUuid(value.locationId);
  const readEvent = (raw: AttendanceEvent | null): AttendanceEvent | null => {
    if (raw === null) return null;
    if (!raw || raw.siteId !== input.siteId || raw.workerId !== value.workerId
      || !Number.isSafeInteger(raw.sequence) || raw.sequence < 1 || raw.sequence > value.state.sequence) return fail();
    validateAttendanceCommand(raw); requireAttendanceUuid(raw.id);
    attendanceInstant(raw.occurredAt); attendanceTimeZone(raw.timeZone);
    return { id: raw.id, siteId: raw.siteId, workerId: raw.workerId, locationId: raw.locationId,
      operationId: raw.operationId, action: raw.action, breakPaid: raw.breakPaid,
      sequence: raw.sequence, occurredAt: raw.occurredAt, timeZone: raw.timeZone };
  };
  const lastEvent = readEvent(value.state.lastEvent); const receipt = readEvent(value.receipt);
  const boundaryDescriptor = Object.getOwnPropertyDescriptor(value.state, "administrativeBoundary");
  if (boundaryDescriptor && (!("value" in boundaryDescriptor) || !boundaryDescriptor.enumerable)) return fail();
  const boundary = boundaryDescriptor ? administrativeClockBoundary(boundaryDescriptor.value, { siteId: input.siteId, workerId: value.workerId,
    status: value.state.status, sequence: value.state.sequence, lastEvent }) : null;
  const expectedStatus = !lastEvent || lastEvent.action === "clock_out" ? "off" : lastEvent.action === "break_start" ? "break" : "working";
  if ((lastEvent?.sequence ?? 0) !== value.state.sequence || !boundary && value.state.status !== expectedStatus) return fail();
  const operationId = input.command?.operationId ?? input.operationId;
  if (receipt && receipt.operationId !== operationId) return fail();
  if (input.command && (!receipt || receipt.action !== input.command.action || receipt.locationId !== input.command.locationId)) return fail();
  if (!input.command && value.replayed) return fail();
  return { workerId: value.workerId, locationId: value.locationId,
    state: { sequence: value.state.sequence, status: value.state.status, lastEvent, ...(boundary ? { administrativeBoundary: boundary } : {}) }, receipt, replayed: value.replayed };
}
