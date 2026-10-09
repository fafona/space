import { createServerSupabaseServiceClient } from "./superAdminServer";
import { attendanceClockRpcName } from "./merchantAttendanceRuleBindingDispatch.server";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { evaluateAttendanceLocation, type AttendanceFence } from "./merchantAttendanceLocation";
import { ATTENDANCE_LOCATION_CLOCK_ERRORS, parseAttendanceLocationClockResult, type AttendanceLocationClockQuery,
  type AttendanceLocationClockCommand, type AttendanceLocationClockResult } from "./merchantAttendanceLocationClock";

export type AttendanceLocationClockInput = AttendanceLocationClockQuery & {
  authUserId: string; command: AttendanceLocationClockCommand | null; moduleEnabled: boolean;
};
/** Coordinates stay inside this request. A server-only range assertion plus the
 * database policy fingerprint is not a client capability. The write RPC rechecks
 * policy, identity, sequence and freshness under its locks before both inserts. */
export async function executeAttendanceLocationClock(input: AttendanceLocationClockInput, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()): Promise<AttendanceLocationClockResult> {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  if (input.command && (input.command.expectedWorkerId !== input.expectedWorkerId || input.operationId !== null)) throw new MerchantAttendanceError("attendance_invalid_request");
  const common = { p_site_id: input.siteId, p_auth_user_id: input.authUserId, p_expected_worker_id: input.expectedWorkerId,
    p_allow_new_sessions: input.moduleEnabled, p_require_clock: input.command !== null };
  const clockRpcName = attendanceClockRpcName("location", input.siteId);
  const rpc = async (command: Record<string, unknown> | null, operationId: string | null, assertion: Record<string, unknown> | null) => {
    const response = await service.rpc(clockRpcName, { ...common, p_command: command, p_operation_id: operationId, p_assertion: assertion });
    if (response.error) {
      const message = response.error.message ?? "";
      throw new MerchantAttendanceError(Object.hasOwn(ATTENDANCE_LOCATION_CLOCK_ERRORS, message) ? message : "attendance_unavailable");
    }
    return response.data;
  };
  const readOperation = input.command?.operationId ?? input.operationId;
  const data = await rpc(null, readOperation, null);
  let before: AttendanceLocationClockResult;
  try { before = parseAttendanceLocationClockResult(data, { ...input, command: null, operationId: readOperation }); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (!input.command) return before;
  const command = input.command;
  if (before.receipt) {
    if (before.receipt.action !== command.action || before.receipt.locationId !== command.locationId) throw new MerchantAttendanceError("attendance_operation_conflict");
    if (!before.receiptGate || Object.entries(before.receiptGate.command).some(([key, value]) => command[key as keyof AttendanceLocationClockCommand] !== value))
      throw new MerchantAttendanceError("attendance_operation_conflict");
    // Preparation required current clock permission. This existing receipt has no
    // new write and no new sample, including after policy/channel pause.
    return { ...before, replayed: true };
  }
  const sqlCommand = { operationId: command.operationId, locationId: command.locationId, action: command.action, expectedSequence: command.expectedSequence,
    settingsVersion: command.settingsVersion, workerVersion: command.workerVersion, locationVersion: command.locationVersion,
    noticeRevision: command.noticeRevision, safeFinish: command.safeFinish };
  let assertion: Record<string, unknown> | null = null;
  try {
    const raw = data as Record<string, unknown>;
    if (before.policy && before.noticeGate.ready && !command.safeFinish) {
      if (typeof raw.internalPolicyFingerprint !== "string" || !/^[0-9a-f]{32}$/.test(raw.internalPolicyFingerprint)) throw Error("invalid_fingerprint");
      const fence = raw.internalFence as AttendanceFence;
      if (!fence || fence.maxAgeMs !== 60000) throw Error("invalid_fence");
      // Compute spatial classification without trusting the device clock as the
      // punch time. SQL alone classifies stale/future at its post-lock clock.
      const range = evaluateAttendanceLocation(fence, command.position, command.position?.capturedAt ?? "2000-01-01T00:00:00.000Z");
      if (command.position && !["inside", "outside", "uncertain"].includes(range.reason)) throw Error("invalid_range");
      assertion = { policyFingerprint: raw.internalPolicyFingerprint, algorithmVersion: 1,
        reason: command.position ? range.reason : command.positionFailure, capturedAt: command.position?.capturedAt ?? null,
        accuracyMeters: command.position?.accuracyMeters ?? null, distanceMeters: range.distanceMeters === null ? null : Math.round(range.distanceMeters) };
    }
  } catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  // Even a disabled/missing-policy snapshot reaches the write RPC for an
  // authoritative denial or a concurrently committed receipt; never skip guards.
  const saved = await rpc(sqlCommand, null, assertion);
  try { return parseAttendanceLocationClockResult(saved, input); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
}
