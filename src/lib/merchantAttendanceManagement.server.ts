import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseAttendanceChoicesResult, type AttendanceChoicesQuery } from "./merchantAttendanceChoices";
import { ATTENDANCE_MANAGEMENT_ERRORS, parseAttendanceRecordsResult, parseAttendanceScopeResult,
  type AttendanceRecordsQuery, type AttendanceScopeCommand, type AttendanceScopeQuery } from "./merchantAttendanceManagement";

export type AttendanceScopeInput = AttendanceScopeQuery & { authUserId: string; command: AttendanceScopeCommand | null };
export type AttendanceRecordsInput = AttendanceRecordsQuery & { authUserId: string };
export async function executeAttendanceChoices(input: AttendanceChoicesQuery & { authUserId: string }, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const data = await rpc(service, "faolla_attendance_choices_v1", { p_site_id: input.siteId, p_auth_user_id: input.authUserId,
    p_query: input.ids ? { kind: input.kind, ids: input.ids } : { kind: input.kind, search: input.search, cursor: input.cursor } });
  try { return parseAttendanceChoicesResult(data, input); } catch { throw new MerchantAttendanceError("attendance_unavailable"); }
}
async function rpc(service: AttendanceSelfRpc | null, name: string, args: Record<string, unknown>) {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  const result = await service.rpc(name, args);
  if (result.error) {
    const code = result.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(ATTENDANCE_MANAGEMENT_ERRORS, code) ? code : "attendance_unavailable");
  }
  return result.data;
}
export async function executeAttendanceScopes(input: AttendanceScopeInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const data = await rpc(service, "faolla_attendance_scopes_v1", { p_site_id: input.siteId, p_auth_user_id: input.authUserId,
    p_employee_id: input.employeeId, p_command: input.command, p_operation_id: input.operationId });
  try {
    const parsed = parseAttendanceScopeResult(data, { ...input, operationId: input.command?.operationId ?? input.operationId });
    if (input.command && (!parsed.receipt || parsed.receipt.action !== input.command.action || parsed.receipt.grantId !== input.command.grantId
      || parsed.receipt.revision !== input.command.expectedRevision + 1)) throw Error("receipt_mismatch");
    return parsed;
  } catch { throw new MerchantAttendanceError("attendance_unavailable"); }
}
export async function executeAttendanceRecords(input: AttendanceRecordsInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const data = await rpc(service, "faolla_attendance_records_v1", { p_site_id: input.siteId, p_auth_user_id: input.authUserId,
    p_query: { access: input.access, fromAt: input.fromAt, toAt: input.toAt, workerId: input.workerId, locationId: input.locationId,
      asOf: input.asOf, cursorAt: input.cursorAt, cursorId: input.cursorId } });
  try { return parseAttendanceRecordsResult(data, input); } catch { throw new MerchantAttendanceError("attendance_unavailable"); }
}

// One grant, not the entire company: maximum 200 workers + 50 locations, 16 KiB.
export async function readAttendanceScopeJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new MerchantAttendanceError("attendance_invalid_content_type");
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 16384)) throw new MerchantAttendanceError("attendance_body_too_large");
  const reader = request.body?.getReader(); if (!reader) throw new MerchantAttendanceError("attendance_invalid_request");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 16384) { await reader.cancel(); throw new MerchantAttendanceError("attendance_body_too_large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new MerchantAttendanceError("attendance_invalid_request"); }
}
