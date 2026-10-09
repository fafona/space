import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceClockRpcName } from "./merchantAttendanceRuleBindingDispatch.server";
import { executeAttendanceLocationClock } from "./merchantAttendanceLocationClock.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseLocationScheduleBody, parseLocationScheduleQuery, parseLocationScheduleResult, parseLocationScheduleServerResult,
  LOCATION_SCHEDULE_ERRORS, type LocationScheduleParseInput, type LocationScheduleResult } from "./merchantAttendanceLocationSchedule";

type Environment = Readonly<Record<string, string | undefined>>;
export function attendanceLocationScheduleEnabled(siteId: string, env: Environment = process.env): boolean {
  if (env.FAOLLA_ATTENDANCE_LOCATION_SCHEDULE_ENABLED !== "1" || !/^\d{8}$/.test(siteId)) return false;
  const raw = env.FAOLLA_ATTENDANCE_LOCATION_SCHEDULE_SITE_IDS;
  if (typeof raw !== "string" || raw.length > 4096) return false;
  const sites = raw.split(",").map(s => s.trim());
  return sites.length <= 100 && sites.every(s => /^\d{8}$/.test(s)) && sites.includes(siteId);
}
export function attendanceLocationScheduleBindRules(siteId: string): boolean {
  return attendanceClockRpcName("location", siteId) === "faolla_attendance_location_clock_bound_v1";
}
export type AttendanceLocationScheduleInput = LocationScheduleParseInput & {
  authUserId: string; moduleEnabled: boolean; allowWrite: boolean; bindRules: boolean;
};

/** Preserve the existing location-service preparation, range assertion and
 * receipt checks. Only its server-side RPC transport selects the new atomic
 * transaction. The raw fence is never returned to the route or browser. */
export async function executeAttendanceLocationSchedule(input: AttendanceLocationScheduleInput,
  service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()): Promise<LocationScheduleResult> {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  if ([input.moduleEnabled, input.allowWrite, input.bindRules].some(v => typeof v !== "boolean")) throw new MerchantAttendanceError("attendance_invalid_request");
  if (input.command) {
    if (!Object.hasOwn(input, "selection") || input.selection === undefined) throw new MerchantAttendanceError("attendance_invalid_request");
    const parsed = parseLocationScheduleBody({ siteId: input.siteId, command: input.command, selection: input.selection });
    if (input.operationId !== null || input.expectedWorkerId !== parsed.command.expectedWorkerId) throw new MerchantAttendanceError("attendance_invalid_request");
    if (!input.moduleEnabled) throw new MerchantAttendanceError("attendance_platform_paused");
    if (!input.allowWrite) throw new MerchantAttendanceError("attendance_location_schedule_disabled");
  } else {
    const q = new URLSearchParams({ siteId: input.siteId, expectedWorkerId: input.expectedWorkerId });
    if (input.operationId !== null) q.set("operationId", input.operationId);
    parseLocationScheduleQuery(`https://local.invalid/?${q}`);
    if (input.selection != null) throw new MerchantAttendanceError("attendance_invalid_request");
  }
  const captured: { value: LocationScheduleResult | null } = { value: null };
  const adapter: AttendanceSelfRpc = {
    rpc: async (name, args) => {
      if (!["faolla_attendance_location_clock_v2", "faolla_attendance_location_clock_bound_v1"].includes(name)
        || args.p_site_id !== input.siteId || args.p_auth_user_id !== input.authUserId
        || args.p_expected_worker_id !== input.expectedWorkerId || args.p_allow_new_sessions !== input.moduleEnabled
        || args.p_require_clock !== (input.command !== null)) throw new MerchantAttendanceError("attendance_unavailable");
      const writing = args.p_command !== null;
      const response = await service.rpc("faolla_attendance_location_schedule_v1", {
        ...args, p_selection: writing ? input.selection ?? null : null,
        p_allow_schedule: input.allowWrite, p_bind_rules: input.bindRules,
      });
      if (response.error) {
        const code = response.error.message ?? "";
        throw new MerchantAttendanceError(Object.hasOwn(LOCATION_SCHEDULE_ERRORS, code) ? code : "attendance_unavailable");
      }
      const expected: LocationScheduleParseInput = { siteId: input.siteId, expectedWorkerId: input.expectedWorkerId,
        command: writing ? input.command : null, operationId: writing ? null : args.p_operation_id as string | null,
        ...(writing ? { selection: input.selection ?? null } : {}), authUserId: input.authUserId };
      captured.value = parseLocationScheduleServerResult(response.data, expected);
      // Only the already-validated server payload, never the public projection,
      // can carry the original service's internal range-assertion inputs.
      return { data: (response.data as { clock: unknown }).clock, error: null };
    },
  };
  const clock = await executeAttendanceLocationClock({ siteId: input.siteId, expectedWorkerId: input.expectedWorkerId,
    operationId: input.operationId, command: input.command, authUserId: input.authUserId, moduleEnabled: input.moduleEnabled }, adapter);
  const extended = captured.value;
  if (!extended) throw new MerchantAttendanceError("attendance_location_schedule_invalid");
  // The legacy service can return an existing receipt directly from preparation.
  // Such a receipt must NOT be adopted retroactively or accepted for a changed
  // selection; parse the final result against the original explicit command.
  if (input.command && (!extended.association || !extended.adoption)) throw new MerchantAttendanceError("attendance_operation_conflict");
  if (input.command) {
    const original = extended.association!.selection, selected = input.selection ?? null;
    if ((original === null) !== (selected === null) || original !== null && selected !== null
      && (original.slotId !== selected.slotId || original.revision !== selected.revision)) throw new MerchantAttendanceError("attendance_operation_conflict");
  }
  return parseLocationScheduleResult({ ...extended, clock }, input.command ? input : {
    siteId: input.siteId, expectedWorkerId: input.expectedWorkerId, operationId: input.operationId,
    command: null, authUserId: input.authUserId,
  });
}
