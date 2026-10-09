import { exact, freeze, safeTree } from "./merchantAttendancePlanExceptionValidation";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { PLAN_POSTHOC_EVALUATION_ERRORS, parsePlanPosthocEvaluationQuery, parsePlanPosthocEvaluation } from "./merchantAttendancePlanPosthocEvaluation";
import type { PlanPosthocEvaluationQuery, PlanPosthocEvaluationFacts, PlanPosthocEvaluationResult } from "./merchantAttendancePlanPosthocEvaluationContract";

export const PLAN_POSTHOC_EVALUATION_API = "/api/merchant-enterprise/attendance/plan-posthoc-evaluation";
export const PLAN_POSTHOC_EVALUATION_HTTP_ERRORS: Readonly<Record<string, number>> = Object.freeze({ ...PLAN_POSTHOC_EVALUATION_ERRORS,
  attendance_rate_limited: 429, unauthorized: 401, authentication_required: 401, enterprise_auth_unavailable: 503,
  enterprise_entitlement_unavailable: 503, enterprise_management_disabled: 403, employee_password_authentication_required: 403,
  forbidden_origin: 403, method_not_allowed: 405,
});
export function planPosthocEvaluationQueryString(query: PlanPosthocEvaluationQuery): string {
  return new URLSearchParams(Object.entries(parsePlanPosthocEvaluationQuery(query))).toString();
}
export function parsePlanPosthocEvaluationHttpQuery(url: string): PlanPosthocEvaluationQuery {
  try {
    if (typeof url !== "string" || url.length > 8192 || /\s|[\u0000-\u001f\u007f-\u009f]/.test(url)) throw new Error("invalid");
    const parsed = new URL(url), values: Record<string, unknown> = Object.create(null);
    if (parsed.hash) throw new Error("invalid");
    for (const [key, value] of parsed.searchParams) {
      if (!["siteId", "workerId", "slotId"].includes(key) || parsed.searchParams.getAll(key).length !== 1) throw new Error("invalid");
      values[key] = value;
    }
    return parsePlanPosthocEvaluationQuery(values);
  } catch { throw new MerchantAttendanceError("attendance_invalid_request"); }
}
// Explicit whitelist, not spreading the service's derived preview or private
// SQL bytes into HTTP. This helper does NOT itself attest the service's result;
// the route reparses this exact facts envelope before responding.
export function planPosthocEvaluationFacts(result: PlanPosthocEvaluationResult): PlanPosthocEvaluationFacts {
  safeTree(result, 3145728);
  const { protocol, siteId, actorId, worker, slot, readAt, source, fingerprint } = result;
  return { protocol, siteId, actorId, worker, slot, readAt, source, fingerprint };
}
export function parsePlanPosthocEvaluationResponse(raw: unknown, query: PlanPosthocEvaluationQuery, actorId: string): PlanPosthocEvaluationResult {
  try {
    safeTree(raw, 2097152); const body = exact(raw, ["ok", "data"]); if (body.ok !== true) throw new Error("invalid");
    // The browser derives afresh from facts; accepting server/caller-supplied
    // candidate/eligible/outcome fields would bypass this exact boundary.
    return freeze(parsePlanPosthocEvaluation(body.data, query, actorId));
  } catch { throw new MerchantAttendanceError("attendance_plan_posthoc_evaluation_invalid"); }
}
