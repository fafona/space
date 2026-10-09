import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import { attendanceClockRpcName } from "./merchantAttendanceRuleBindingDispatch.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { ATTENDANCE_SELF_ERROR_STATUS, parseAttendanceSelfResult, type AttendanceSelfCommand, type AttendanceSelfResult } from "@/lib/merchantAttendanceSelf";

export type AttendanceSelfInput = {
  siteId: string; authUserId: string; command: AttendanceSelfCommand | null; operationId: string | null;
};
export type AttendanceSelfRpc = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
  data: unknown; error: { message?: string; code?: string } | null;
}> };

export async function executeAttendanceSelf(input: AttendanceSelfInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()): Promise<AttendanceSelfResult> {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  const result = await service.rpc(attendanceClockRpcName("self", input.siteId), {
    p_site_id: input.siteId, p_auth_user_id: input.authUserId,
    p_command: input.command, p_operation_id: input.operationId,
  });
  if (result.error) {
    const code = result.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(ATTENDANCE_SELF_ERROR_STATUS, code) ? code : "attendance_unavailable");
  }
  // Explicitly validate and select response fields. No raw RPC object (or future
  // internal employee fields) is forwarded to the browser.
  try { return parseAttendanceSelfResult(result.data, input); } catch {
    throw new MerchantAttendanceError("attendance_unavailable");
  }
}


export async function readAttendanceSelfJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new MerchantAttendanceError("attendance_invalid_content_type");
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 4096)) throw new MerchantAttendanceError("attendance_body_too_large");
  const reader = request.body?.getReader();
  if (!reader) throw new MerchantAttendanceError("attendance_invalid_request");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4096) { await reader.cancel(); throw new MerchantAttendanceError("attendance_body_too_large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new MerchantAttendanceError("attendance_invalid_request"); }
}

// Bounded per-process abuse protection, NOT a distributed quota. Database locking
// and operation uniqueness, not this limiter, guarantee punch correctness.
export function createAttendanceSelfLimiter() {
  const buckets = new Map<string, { count: number; until: number }>();
  return (authUserId: string, now = Date.now()) => {
    if (buckets.size >= 10000) {
      for (const [key, value] of buckets) if (value.until <= now) buckets.delete(key);
      if (buckets.size >= 10000 && !buckets.has(authUserId)) return false;
    }
    const bucket = buckets.get(authUserId);
    if (!bucket || bucket.until <= now) { buckets.set(authUserId, { count: 1, until: now + 60000 }); return true; }
    return ++bucket.count <= 60;
  };
}
