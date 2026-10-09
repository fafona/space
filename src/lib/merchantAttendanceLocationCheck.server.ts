import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { evaluateAttendanceLocation, type AttendanceFence } from "./merchantAttendanceLocation";
import { ATTENDANCE_LOCATION_CHECK_ERRORS, ATTENDANCE_LOCATION_MAX_AGE_MS, attendanceLocationVersions,
  parseAttendanceLocationPolicy, type AttendanceLocationTarget, type AttendanceLocationCheckCommand } from "./merchantAttendanceLocationCheck";

export type AttendanceLocationCheckInput = AttendanceLocationTarget & { authUserId: string; command: AttendanceLocationCheckCommand | null };
export async function executeAttendanceLocationCheck(input: AttendanceLocationCheckInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  const versions = input.command ? attendanceLocationVersions(input.command) : null;
  const { data, error } = await service.rpc("faolla_attendance_location_policy_v1", {
    p_site_id: input.siteId, p_auth_user_id: input.authUserId, p_expected_worker_id: input.expectedWorkerId,
    p_expected_location_id: input.expectedLocationId, p_expected_versions: versions,
  });
  if (error) throw new MerchantAttendanceError(Object.hasOwn(ATTENDANCE_LOCATION_CHECK_ERRORS, error.message ?? "") ? error.message! : "attendance_unavailable");
  try {
    const policy = parseAttendanceLocationPolicy(data, input);
    if (versions && Object.entries(versions).some(([key, value]) => policy[key as keyof typeof versions] !== value)) throw Error("policy_mismatch");
    const raw = data as Record<string, unknown>, fence = raw.fence as AttendanceFence;
    // The fence and database clock are server-selected. Even preparation validates
    // the fence; invalid configuration must not trigger a device permission prompt.
    if (!fence || fence.maxAgeMs !== ATTENDANCE_LOCATION_MAX_AGE_MS) throw Error("invalid_fence");
    const classification = evaluateAttendanceLocation(fence, input.command?.position ?? null, policy.checkedAt);
    if (!input.command) return policy;
    if (["not_requested", "missing", "invalid"].includes(classification.reason)) throw Error("invalid_classification");
    return { ...policy, ...classification, distanceMeters: classification.distanceMeters === null ? null : Math.round(classification.distanceMeters) };
  } catch { throw new MerchantAttendanceError("attendance_unavailable"); }
}
