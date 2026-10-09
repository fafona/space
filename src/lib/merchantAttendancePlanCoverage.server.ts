import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { captureBrowserExact } from "./merchantAttendanceRuleCapturesBrowser";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { parseShiftCheckQuery, validateShiftCheckTree } from "./merchantAttendanceShiftCheck";
import { projectShiftCheck } from "./merchantAttendanceShiftCheck.server";
import { parsePlanCoverageQuery, parsePlanCoverageData, parsePlanCoverageResponse, PLAN_COVERAGE_BYTE_LIMIT, PLAN_COVERAGE_ERRORS,
  type PlanCoverageQuery, type PlanCoverageData } from "./merchantAttendancePlanCoverage";

const invalid = (): never => { throw new MerchantAttendanceError("attendance_plan_coverage_invalid"); };
const tooLarge = (): never => { throw new MerchantAttendanceError("attendance_plan_coverage_too_large"); };

/** One RPC owns authorization, stable relation membership and each child read.
 * Preserve its outer read interval and individual child cutoffs. Each full133
 * source is verified on the server before making the compact browser response;
 * no HTTP fan-out or reconstruction from today's rules/timezone data occurs. */
export function projectPlanCoverage(raw: unknown, input: PlanCoverageQuery, actorId: string): PlanCoverageData {
  const query = parsePlanCoverageQuery(input);
  try {
    validateShiftCheckTree(raw);
    if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > PLAN_COVERAGE_BYTE_LIMIT) tooLarge();
    const v = captureBrowserExact(raw, ["protocol", "siteId", "actorId", "worker", "slot", "readStartedAt", "readCompletedAt", "sessions"]);
    if (v.protocol !== "plan-coverage-source-v1" || v.siteId !== query.siteId || v.actorId !== actorId || !Array.isArray(v.sessions)) invalid();
    const rawSessions = v.sessions as unknown[];
    if (rawSessions.length > 10) tooLarge();
    let eventCount = 0;
    const children = rawSessions.map(rawChild => {
      const child = captureBrowserExact(rawChild, ["protocol", "binding", "asOf", "events", "effect", "relation"]);
      if (!Array.isArray(child.events)) invalid();
      eventCount += (child.events as unknown[]).length;
      if (eventCount > 2002) tooLarge();
      return child;
    });
    const sessions = children.map(child => {
      const binding = captureBrowserExact(child.binding, ["protocol", "readOnly", "formalReady", "siteId", "actorId", "worker", "event", "status", "reason", "binding", "readAt"]);
      const event = captureBrowserExact(binding.event, ["startEventId", "operationId", "sequence", "locationId", "occurredAt", "timeZone", "source", "employeeId"]);
      const childQuery = parseShiftCheckQuery({ siteId: query.siteId, workerId: query.workerId, startEventId: event.startEventId });
      return projectShiftCheck(child, childQuery, actorId);
    });
    const data = parsePlanCoverageData({ protocol: "plan-coverage-v1", algorithmVersion: "explicit-closed-spans-v1", readOnly: true, formalReady: false,
      siteId: v.siteId, actorId: v.actorId, worker: v.worker, slot: v.slot, readStartedAt: v.readStartedAt, readCompletedAt: v.readCompletedAt, sessions }, query, actorId);
    parsePlanCoverageResponse({ ok: true, moduleEnabled: false, data }, query, actorId);
    return data;
  } catch (error) {
    if (error instanceof MerchantAttendanceError && ["attendance_shift_check_too_large", "attendance_plan_coverage_too_large"].includes(error.code)) tooLarge();
    return invalid();
  }
}

export async function executePlanCoverage(input: { query: PlanCoverageQuery; authUserId: string },
  service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()): Promise<PlanCoverageData> {
  const query = parsePlanCoverageQuery(input.query), authUserId = attendanceSelfUuid(input.authUserId);
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  let response;
  try { response = await service.rpc("faolla_attendance_plan_coverage_v1", { p_query: query, p_auth_user_id: authUserId }); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (response.error) {
    const code = response.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(PLAN_COVERAGE_ERRORS, code) ? code : "attendance_unavailable");
  }
  return projectPlanCoverage(response.data, query, authUserId);
}
