import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "./merchantAttendanceSelf";
import { captureBrowserExact } from "./merchantAttendanceRuleCapturesBrowser";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { validateShiftCheckTree, type ShiftCheckQuery } from "./merchantAttendanceShiftCheck";
import type { PlanCoverageQuery } from "./merchantAttendancePlanCoverage";
import { projectShiftCheck } from "./merchantAttendanceShiftCheck.server";
import { projectPlanCoverage } from "./merchantAttendancePlanCoverage.server";
import { parseShiftCheckAdoptionQuery as parseShiftCheckQuery, parsePlanCoverageAdoptionsQuery as parsePlanCoverageQuery,
  parseShiftCheckAdoptionData, parsePlanCoverageAdoptionsData, PLAN_ADOPTION_VIEW_ERRORS,
  type ShiftCheckAdoptionData, type PlanCoverageAdoptionsData } from "./merchantAttendancePlanAdoptionView";

type Environment = Readonly<Record<string, string | undefined>>;
export function planAdoptionViewSiteEnabled(siteId: string, env: Environment = process.env): boolean {
  if (env.FAOLLA_ATTENDANCE_PLAN_ADOPTION_VIEW_ENABLED !== "1" || typeof siteId !== "string" || !/^\d{8}$/.test(siteId) || siteId.length !== 8) return false;
  const raw = env.FAOLLA_ATTENDANCE_PLAN_ADOPTION_VIEW_SITE_IDS;
  if (typeof raw !== "string" || raw.length > 4096) return false;
  const sites = raw.split(",").map(s => s.trim());
  return sites.length <= 100 && sites.every(s => s.length === 8 && /^\d{8}$/.test(s)) && sites.includes(siteId);
}
function invalid(error: unknown): never {
  if (error instanceof MerchantAttendanceError && ["attendance_shift_check_too_large", "attendance_plan_coverage_too_large", "attendance_plan_adoption_view_too_large"].includes(error.code))
    throw new MerchantAttendanceError("attendance_plan_adoption_view_too_large");
  throw new MerchantAttendanceError("attendance_plan_adoption_view_invalid");
}
/** The one SQL response contains the old authorized evidence and its fixed
 * sidecar. Old projectors still verify full133 source bytes on the server.
 * We never join a second HTTP response or read the latest140 approval head. */
export function projectShiftCheckAdoption(raw: unknown, input: ShiftCheckQuery, actorId: string): ShiftCheckAdoptionData {
  const query = parseShiftCheckQuery(input);
  try {
    validateShiftCheckTree(raw);
    const v = captureBrowserExact(raw, ["protocol", "check", "adoption"]);
    if (v.protocol !== "shift-check-adoption-source-v1") throw Error("invalid_protocol");
    const check = projectShiftCheck(v.check, query, actorId);
    return parseShiftCheckAdoptionData({ protocol: "shift-check-adoption-v1", check, adoption: v.adoption }, query, actorId);
  } catch (error) { return invalid(error); }
}
export function projectPlanCoverageAdoptions(raw: unknown, input: PlanCoverageQuery, actorId: string): PlanCoverageAdoptionsData {
  const query = parsePlanCoverageQuery(input);
  try {
    validateShiftCheckTree(raw);
    const v = captureBrowserExact(raw, ["protocol", "coverage", "adoptions"]);
    if (v.protocol !== "plan-coverage-adoptions-source-v1") throw Error("invalid_protocol");
    const coverage = projectPlanCoverage(v.coverage, query, actorId);
    return parsePlanCoverageAdoptionsData({ protocol: "plan-coverage-adoptions-v1", coverage, adoptions: v.adoptions }, query, actorId);
  } catch (error) { return invalid(error); }
}
async function rpc(name: string, query: ShiftCheckQuery | PlanCoverageQuery, authUserId: string, service: AttendanceSelfRpc | null) {
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  let response;
  try { response = await service.rpc(name, { p_query: query, p_auth_user_id: authUserId }); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (response.error) {
    const code = response.error.message ?? "";
    throw new MerchantAttendanceError(Object.hasOwn(PLAN_ADOPTION_VIEW_ERRORS, code) ? code : "attendance_unavailable");
  }
  return response.data;
}
export async function executeShiftCheckAdoption(input: { query: ShiftCheckQuery; authUserId: string },
  service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()): Promise<ShiftCheckAdoptionData> {
  const query = parseShiftCheckQuery(input.query), authUserId = attendanceSelfUuid(input.authUserId);
  return projectShiftCheckAdoption(await rpc("faolla_attendance_shift_check_adoption_v1", query, authUserId, service), query, authUserId);
}
export async function executePlanCoverageAdoptions(input: { query: PlanCoverageQuery; authUserId: string },
  service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()): Promise<PlanCoverageAdoptionsData> {
  const query = parsePlanCoverageQuery(input.query), authUserId = attendanceSelfUuid(input.authUserId);
  return projectPlanCoverageAdoptions(await rpc("faolla_attendance_plan_coverage_adoptions_v1", query, authUserId, service), query, authUserId);
}
