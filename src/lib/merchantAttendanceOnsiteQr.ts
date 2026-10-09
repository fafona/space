import { ATTENDANCE_SELF_ERROR_STATUS, attendanceSelfSite, attendanceSelfUuid, parseAttendanceSelfCommand,
  parseAttendanceSelfQuery, parseAttendanceSelfResult, type AttendanceSelfCommand, type AttendanceSelfResult } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

export const ONSITE_QR_LIFETIME_MS = 45_000;
export const ONSITE_QR_MAX_TOKEN_BYTES = 1_400;
export type OnsiteClaims = {
  v: 1; purpose: "faolla.attendance.onsite"; siteId: string; terminalId: string; locationId: string;
  pairedAtMs: number; issuedAtMs: number; expiresAtMs: number; nonce: string;
};
export type OnsiteCommand = AttendanceSelfCommand & { expectedEmployeeId: string };
export type OnsiteClockBody = { siteId: string; token: string; command: OnsiteCommand };
export type OnsiteClockQuery = { siteId: string; operationId: string | null };
export type OnsiteClockResult = AttendanceSelfResult & { employeeId: string };
export type OnsiteIssueResult = {
  siteId: string; terminalId: string; locationId: string; issuedAtMs: number; expiresAtMs: number; token: string;
};

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MerchantAttendanceError("attendance_invalid_request");
  const object = value as Record<string, unknown>;
  if (Object.keys(object).length !== keys.length || keys.some(key => !Object.hasOwn(object, key))) throw new MerchantAttendanceError("attendance_invalid_request");
  return object;
}

/** The returned insertion order is the one canonical JSON encoding for aq1.
 * Freshness uses the database clock after locks, not this structural parser. */
export function parseOnsiteClaims(input: unknown): OnsiteClaims {
  try {
    const value = exactObject(input, ["v", "purpose", "siteId", "terminalId", "locationId", "pairedAtMs", "issuedAtMs", "expiresAtMs", "nonce"]);
    if (value.v !== 1 || value.purpose !== "faolla.attendance.onsite") throw Error("claims_domain");
    const milliseconds = (v: unknown): number => {
      if (typeof v !== "number" || !Number.isSafeInteger(v) || Object.is(v, -0) || v < 0 || v > 8_640_000_000_000_000) throw Error("claims_time");
      return v;
    };
    const pairedAtMs = milliseconds(value.pairedAtMs), issuedAtMs = milliseconds(value.issuedAtMs), expiresAtMs = milliseconds(value.expiresAtMs);
    if (pairedAtMs > issuedAtMs || expiresAtMs - issuedAtMs !== ONSITE_QR_LIFETIME_MS) throw Error("claims_lifetime");
    return { v: 1, purpose: "faolla.attendance.onsite", siteId: attendanceSelfSite(value.siteId), terminalId: attendanceSelfUuid(value.terminalId),
      locationId: attendanceSelfUuid(value.locationId), pairedAtMs, issuedAtMs, expiresAtMs, nonce: attendanceSelfUuid(value.nonce) };
  } catch { throw new MerchantAttendanceError("attendance_qr_invalid"); }
}

export function parseOnsiteClockBody(input: unknown): OnsiteClockBody {
  const value = exactObject(input, ["siteId", "token", "command"]);
  const siteId = attendanceSelfSite(value.siteId);
  // aq1 is ASCII: character length equals its UTF-8 byte length.
  if (typeof value.token !== "string" || value.token.length > ONSITE_QR_MAX_TOKEN_BYTES
    || !/^aq1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value.token)) throw new MerchantAttendanceError("attendance_qr_invalid");
  const command = exactObject(value.command, ["expectedWorkerId", "expectedEmployeeId", "operationId", "locationId", "action", "expectedSequence"]);
  const base = parseAttendanceSelfCommand({ siteId, expectedWorkerId: command.expectedWorkerId, operationId: command.operationId,
    locationId: command.locationId, action: command.action, expectedSequence: command.expectedSequence });
  return { siteId, token: value.token, command: { ...base.command, expectedEmployeeId: attendanceSelfUuid(command.expectedEmployeeId) } };
}

/** No QR capability is ever accepted in a URL/query string. */
export function parseOnsiteClockQuery(url: string): OnsiteClockQuery {
  try { return parseAttendanceSelfQuery(url); }
  catch { throw new MerchantAttendanceError("attendance_invalid_request"); }
}

export const ONSITE_QR_ERRORS: Readonly<Record<string, number>> = {
  ...ATTENDANCE_SELF_ERROR_STATUS,
  attendance_settings_required: 409,
  attendance_terminal_denied: 403,
  attendance_qr_invalid: 400,
  attendance_qr_expired: 409,
  attendance_qr_used: 409,
};

export function parseOnsiteClockResult(input: unknown, expected: OnsiteClockQuery & { command: OnsiteCommand | null }): OnsiteClockResult {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("invalid_result");
    const value = input as Record<string, unknown>, base = parseAttendanceSelfResult(value, expected);
    const employeeId = attendanceSelfUuid(value.employeeId);
    if (expected.command && employeeId !== expected.command.expectedEmployeeId) throw Error("employee_changed");
    if (base.state.administrativeBoundary && base.state.administrativeBoundary.employeeId !== employeeId) throw Error("employee_changed");
    // Project only the public receipt and binding fields, including nested events.
    return { workerId: base.workerId, employeeId, locationId: base.locationId, state: base.state, receipt: base.receipt, replayed: base.replayed };
  } catch { throw new MerchantAttendanceError("attendance_unavailable"); }
}
