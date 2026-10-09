import { createServerSupabaseServiceClient } from "./superAdminServer";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { EVENT_CHANNEL_ERRORS, EVENT_CHANNEL_MAX_BODY_BYTES, parseEventChannelsQuery, parseEventChannelsResult,
  type EventChannelsQuery, type EventChannelsResult } from "./merchantAttendanceEventChannels";

export type EventChannelsInput = { query: EventChannelsQuery; authUserId: string };

/** Read-only historical attribution. No QR signing key, live-terminal check or
 * admission flag is involved. SQL revalidates current read authority per batch. */
export async function executeEventChannels(input: EventChannelsInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()): Promise<EventChannelsResult> {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 2
    || !Object.hasOwn(input, "query") || !Object.hasOwn(input, "authUserId")) throw new MerchantAttendanceError("attendance_invalid_request");
  const query = parseEventChannelsQuery(input.query), authUserId = attendanceSelfUuid(input.authUserId);
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  let response: Awaited<ReturnType<AttendanceSelfRpc["rpc"]>>;
  try {
    response = await service.rpc("faolla_attendance_event_channels_v1", {
      p_site_id: query.siteId, p_auth_user_id: authUserId,
      p_query: { access: query.access, workerId: query.workerId, locationId: query.locationId, eventIds: query.eventIds },
    });
  } catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (!response || typeof response !== "object") throw new MerchantAttendanceError("attendance_unavailable");
  if (response.error) {
    const code = response.error.message;
    throw new MerchantAttendanceError(typeof code === "string" && Object.hasOwn(EVENT_CHANNEL_ERRORS, code) ? code : "attendance_unavailable");
  }
  return parseEventChannelsResult(response.data, query);
}

export async function readEventChannelsJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new MerchantAttendanceError("attendance_invalid_content_type");
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > EVENT_CHANNEL_MAX_BODY_BYTES)) throw new MerchantAttendanceError("attendance_body_too_large");
  const reader = request.body?.getReader();
  if (!reader) throw new MerchantAttendanceError("attendance_invalid_request");
  let bytes = 0, serialized = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > EVENT_CHANNEL_MAX_BODY_BYTES) { await reader.cancel(); throw new MerchantAttendanceError("attendance_body_too_large"); }
      serialized += decoder.decode(value, { stream: true });
    }
    return JSON.parse(serialized + decoder.decode());
  } catch (error) {
    if (error instanceof MerchantAttendanceError) throw error;
    throw new MerchantAttendanceError("attendance_invalid_request");
  } finally { reader.releaseLock(); }
}
