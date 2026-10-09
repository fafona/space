import { createHash } from "node:crypto";
import { createServerSupabaseServiceClient } from "./superAdminServer";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { exact, safeTree, same, uuid } from "./merchantAttendancePlanExceptionValidation";
import { parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { PLAN_POSTHOC_EVALUATION_ERRORS, parsePlanPosthocEvaluationQuery, parsePlanPosthocEvaluation } from "./merchantAttendancePlanPosthocEvaluation";
import type { PlanPosthocEvaluationQuery } from "./merchantAttendancePlanPosthocEvaluationContract";

export function projectPlanPosthocEvaluation(raw: unknown, query: PlanPosthocEvaluationQuery, authUserId: string) {
  try {
    safeTree(raw, 4194304);
    const v = exact(raw, ["protocol", "siteId", "actorId", "worker", "slot", "readAt", "source", "sourceText", "fingerprint"]);
    if (typeof v.sourceText !== "string" || Buffer.byteLength(v.sourceText, "utf8") > 1048576
      || createHash("sha256").update(v.sourceText, "utf8").digest("hex") !== v.fingerprint
      || !same(parseCaptureBrowserJson(v.sourceText), v.source)) throw new Error("invalid source");
    const { sourceText: _sourceText, ...facts } = v; void _sourceText;
    return parsePlanPosthocEvaluation(facts, query, authUserId);
  } catch { throw new MerchantAttendanceError("attendance_plan_posthoc_evaluation_invalid"); }
}

// Independent owner-only read, with the ACTUAL actor passed through to SQL.
// No allow-write argument, command, current-owner impersonation or flag-gated
// mutation. A future formal writer must recompute/verify under its SQL locks;
// the derived client preview below is never an authorized decision artifact.
export async function executePlanPosthocEvaluation(input: { query: PlanPosthocEvaluationQuery; authUserId: string }, service: AttendanceSelfRpc | null = createServerSupabaseServiceClient()) {
  const query = parsePlanPosthocEvaluationQuery(input.query), authUserId = uuid(input.authUserId);
  if (!service) throw new MerchantAttendanceError("attendance_unavailable");
  let result;
  try { result = await service.rpc("faolla_attendance_plan_posthoc_evaluation_v1", { p_query: query, p_auth_user_id: authUserId }); }
  catch { throw new MerchantAttendanceError("attendance_unavailable"); }
  if (result.error) { const code = result.error.message ?? ""; throw new MerchantAttendanceError(Object.hasOwn(PLAN_POSTHOC_EVALUATION_ERRORS, code) ? code : "attendance_unavailable"); }
  return projectPlanPosthocEvaluation(result.data, query, authUserId);
}
