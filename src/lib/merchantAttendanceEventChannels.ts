import { MERCHANT_ATTENDANCE_ACTIONS, type AttendanceAction } from "./merchantAttendance";
import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import { attendanceSelfSite, attendanceSelfUuid } from "./merchantAttendanceSelf";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

export const EVENT_CHANNEL_MAX_ITEMS = 202;
export const EVENT_CHANNEL_MAX_BODY_BYTES = 16_384;
export const EVENT_CHANNEL_MAX_RESPONSE_BYTES = 65_536;
export type EventChannelsQuery = {
  siteId: string; access: "self" | "manager" | "owner"; workerId: string; locationId: string | null; eventIds: string[];
};
export type EventChannelItem = {
  eventId: string; action: AttendanceAction; occurredAt: string; channel: "web" | "onsite_qr" | "kiosk"; terminalId: string | null;
};
export type EventChannelsResult = {
  siteId: string; access: EventChannelsQuery["access"]; workerId: string; locationId: string | null;
  viewerEmployeeId: string | null; asOf: string; accessValidUntil: string | null; items: EventChannelItem[];
};
export const EVENT_CHANNEL_ERRORS: Readonly<Record<string, number>> = {
  attendance_invalid_request: 400, attendance_invalid_instant: 400, attendance_body_too_large: 413, attendance_invalid_content_type: 415,
  attendance_access_denied: 403, attendance_settings_required: 409, attendance_rate_limited: 429, attendance_unavailable: 503,
};

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MerchantAttendanceError("attendance_invalid_request");
  const object = value as Record<string, unknown>;
  if (Object.keys(object).length !== keys.length || keys.some(key => !Object.hasOwn(object, key))) throw new MerchantAttendanceError("attendance_invalid_request");
  return object;
}

/** Caller identity and authorization are never accepted from the browser. */
export function parseEventChannelsQuery(raw: unknown): EventChannelsQuery {
  const value = exact(raw, ["siteId", "access", "workerId", "locationId", "eventIds"]);
  const siteId = attendanceSelfSite(value.siteId), workerId = attendanceSelfUuid(value.workerId);
  if (value.access !== "self" && value.access !== "manager" && value.access !== "owner") throw new MerchantAttendanceError("attendance_invalid_request");
  const locationId = value.access === "manager" ? attendanceSelfUuid(value.locationId) : null;
  if (value.access !== "manager" && value.locationId !== null) throw new MerchantAttendanceError("attendance_invalid_request");
  if (!Array.isArray(value.eventIds) || value.eventIds.length < 1 || value.eventIds.length > EVENT_CHANNEL_MAX_ITEMS) throw new MerchantAttendanceError("attendance_invalid_request");
  const eventIds = Array.from(value.eventIds, attendanceSelfUuid);
  if (new Set(eventIds).size !== eventIds.length) throw new MerchantAttendanceError("attendance_invalid_request");
  return { siteId, access: value.access, workerId, locationId, eventIds };
}

/** Exact DB result, not the HTTP ok/moduleEnabled envelope. This supplements
 * existing event/report records; it never changes their source/calculations. */
export function parseEventChannelsResult(raw: unknown, input: EventChannelsQuery): EventChannelsResult {
  try {
    const query = parseEventChannelsQuery(input);
    const value = exact(raw, ["siteId", "access", "workerId", "locationId", "viewerEmployeeId", "asOf", "accessValidUntil", "items"]);
    if (value.siteId !== query.siteId || value.access !== query.access || value.workerId !== query.workerId || value.locationId !== query.locationId)
      throw Error("result_scope");
    const viewerEmployeeId = query.access === "owner" ? null : attendanceSelfUuid(value.viewerEmployeeId);
    if (query.access === "owner" && value.viewerEmployeeId !== null) throw Error("result_viewer");
    const asOf = attendanceRecordInstant(value.asOf);
    const accessValidUntil = value.accessValidUntil === null ? null : attendanceRecordInstant(value.accessValidUntil);
    if (query.access !== "manager" && accessValidUntil !== null || accessValidUntil !== null && accessValidUntil <= asOf) throw Error("result_expiry");
    if (!Array.isArray(value.items) || value.items.length !== query.eventIds.length) throw Error("result_coverage");
    const items = Array.from(value.items, (rawItem, index): EventChannelItem => {
      const item = exact(rawItem, ["eventId", "action", "occurredAt", "channel", "terminalId"]);
      if (item.eventId !== query.eventIds[index] || typeof item.action !== "string" || !MERCHANT_ATTENDANCE_ACTIONS.includes(item.action as AttendanceAction)
        || item.channel !== "web" && item.channel !== "onsite_qr" && item.channel !== "kiosk") throw Error("result_item");
      const occurredAt = attendanceRecordInstant(item.occurredAt);
      if (occurredAt > asOf) throw Error("result_time");
      const terminalId = item.channel === "onsite_qr" ? attendanceSelfUuid(item.terminalId) : null;
      if (item.channel !== "onsite_qr" && item.terminalId !== null) throw Error("result_terminal");
      return { eventId: query.eventIds[index], action: item.action as AttendanceAction, occurredAt, channel: item.channel, terminalId };
    });
    // Construct only approved public fields, including every nested item.
    return { siteId: query.siteId, access: query.access, workerId: query.workerId, locationId: query.locationId,
      viewerEmployeeId, asOf, accessValidUntil, items };
  } catch { throw new MerchantAttendanceError("attendance_unavailable"); }
}
