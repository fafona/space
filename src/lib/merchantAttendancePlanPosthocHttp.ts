import { exact, bool, freeze, safeTree } from "./merchantAttendancePlanExceptionValidation";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { PLAN_POSTHOC_ERRORS, parsePlanPosthocQuery, parsePlanPosthocCommand, parsePlanPosthocResult } from "./merchantAttendancePlanPosthoc";
import type { PlanPosthocQuery, PlanPosthocCommand, PlanPosthocResult } from "./merchantAttendancePlanPosthocContract";

export const PLAN_POSTHOC_API = "/api/merchant-enterprise/attendance/plan-posthoc";
export const PLAN_POSTHOC_HTTP_ERRORS: Readonly<Record<string, number>> = Object.freeze({ ...PLAN_POSTHOC_ERRORS,
  attendance_body_too_large: 413, attendance_invalid_content_type: 415, attendance_rate_limited: 429,
  unauthorized: 401, authentication_required: 401, enterprise_auth_unavailable: 503,
  enterprise_entitlement_unavailable: 503, enterprise_management_disabled: 403,
  employee_password_authentication_required: 403, forbidden_origin: 403, method_not_allowed: 405,
});
export type PlanPosthocResponse = { canWrite: boolean; result: PlanPosthocResult };
export function planPosthocQueryString(raw: PlanPosthocQuery) {
  return new URLSearchParams(Object.entries(parsePlanPosthocQuery(raw)).filter((v): v is [string, string] => v[1] !== null)).toString();
}
export function parsePlanPosthocHttpQuery(url: string): PlanPosthocQuery {
  try {
    if (typeof url !== "string" || url.length > 8192 || /\s|[\u0000-\u001f\u007f-\u009f]/.test(url)) throw Error("invalid");
    const parsed = new URL(url); if (parsed.hash) throw Error("invalid");
    const params = parsed.searchParams, q: Record<string, unknown> = { operationId: null };
    for (const [k, v] of params) {
      if (!["siteId", "workerId", "slotId", "mode", "operationId"].includes(k) || params.getAll(k).length !== 1) throw Error("invalid");
      q[k] = v;
    }
    return parsePlanPosthocQuery(q);
  } catch { throw new MerchantAttendanceError("attendance_invalid_request"); }
}
export function parsePlanPosthocBody(raw: unknown) {
  try {
    safeTree(raw, 8192); const b = exact(raw, ["query", "command"]), query = parsePlanPosthocQuery(b.query), command = parsePlanPosthocCommand(b.command);
    if (query.mode !== "detail") throw Error("invalid"); return { query, command };
  } catch { throw new MerchantAttendanceError("attendance_invalid_request"); }
}
export function parsePlanPosthocResponse(raw: unknown, query: PlanPosthocQuery, actorId: string, command: PlanPosthocCommand | null = null): PlanPosthocResponse {
  try {
    const r = exact(raw, ["ok", "canWrite", "data"]); if (r.ok !== true) throw Error("invalid");
    return freeze({ canWrite: bool(r.canWrite), result: parsePlanPosthocResult(r.data, query, actorId, command) });
  } catch { throw new MerchantAttendanceError("attendance_plan_posthoc_adoption_invalid"); }
}
