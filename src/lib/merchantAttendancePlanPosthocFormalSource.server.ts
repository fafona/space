import { createHash } from "node:crypto";
import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { exact, safeTree, same, uuid } from "./merchantAttendancePlanExceptionValidation";
import { parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { projectPlanExceptionSource } from "./merchantAttendancePlanExceptions.server";
import { PLAN_POSTHOC_FORMAL_SOURCE_ERRORS, parsePlanPosthocFormalSource, parsePlanPosthocFormalSourceQuery } from "./merchantAttendancePlanPosthocFormalSource";
import type { PlanPosthocFormalSourceQuery, PlanPosthocFormalSourceResult } from "./merchantAttendancePlanPosthocFormalSourceContract";

export function projectPlanPosthocFormalSource(raw: unknown, query: PlanPosthocFormalSourceQuery, authUserId: string): PlanPosthocFormalSourceResult {
  let detached: unknown;
  try { safeTree(raw, 4194304); detached = JSON.parse(JSON.stringify(raw)); }
  catch { throw new MerchantAttendanceError("attendance_plan_posthoc_formal_invalid"); }
  const protocol = (detached as { protocol?: unknown } | null)?.protocol;
  if (protocol === "plan-exception-source-v1" || protocol === "plan-exception-source-v2") return projectPlanExceptionSource(detached, query, authUserId);
  try {
    const v = exact(detached, ["protocol", "siteId", "actorId", "worker", "slot", "readAt", "source", "sourceText", "fingerprint", "state", "eligible", "blockers", "candidate", "leaveEdges"]);
    if (typeof v.sourceText !== "string" || Buffer.byteLength(v.sourceText, "utf8") > 1048576
      || createHash("sha256").update(v.sourceText, "utf8").digest("hex") !== v.fingerprint
      || !same(parseCaptureBrowserJson(v.sourceText), v.source)) throw new Error("invalid source");
    const { sourceText: _sourceText, ...facts } = v; void _sourceText;
    return parsePlanPosthocFormalSource(facts, query, authUserId);
  } catch { throw new MerchantAttendanceError("attendance_plan_posthoc_formal_invalid"); }
}

// Only an independently callable owner-authorized SQL read. No existing source,
//review/clearance or period route is redirected; no new verdict can be written.
//Future decisions must collect/recompute in the same SQL transaction, not trust
//this service's result or browser-supplied candidate/leave coverage.
export async function executePlanPosthocFormalSource(input: { query: PlanPosthocFormalSourceQuery; authUserId: string }, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()): Promise<PlanPosthocFormalSourceResult> {
  const query = parsePlanPosthocFormalSourceQuery(input.query), authUserId = uuid(input.authUserId);
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  let response;
  try { response = await service.rpc("faolla_attendance_plan_posthoc_formal_source_v1", { p_query: query, p_auth_user_id: authUserId }); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (response.error) { const code = response.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(PLAN_POSTHOC_FORMAL_SOURCE_ERRORS, code) ? code : "attendance_unavailable"); }
  return projectPlanPosthocFormalSource(response.data, query, authUserId);
}
