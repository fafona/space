import { NextResponse } from "next/server";
import { MerchantEnterpriseAccessError, requireMerchantEnterpriseEntitlement, resolveValidatedMerchantEnterpriseAuthContext } from "@/lib/merchantEnterpriseAuth.server";
import { isCanonicalPortalRequest, resolveCanonicalPortalOrigin } from "@/lib/canonicalPortalRequest";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { createAttendanceSelfLimiter } from "@/lib/merchantAttendanceSelf.server";
import { executePlanPosthocEvaluation } from "@/lib/merchantAttendancePlanPosthocEvaluation.server";
import { PLAN_POSTHOC_EVALUATION_HTTP_ERRORS, parsePlanPosthocEvaluationHttpQuery, parsePlanPosthocEvaluationResponse, planPosthocEvaluationFacts } from "@/lib/merchantAttendancePlanPosthocEvaluationHttp";

export const planPosthocEvaluationDependencies = {
  authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement,
  allow: createAttendanceSelfLimiter(), execute: executePlanPosthocEvaluation,
};
const AUTH_ERRORS: Readonly<Record<string, number>> = {
  unauthorized: 401, authentication_required: 401, enterprise_auth_unavailable: 503,
  enterprise_entitlement_unavailable: 503, enterprise_management_disabled: 403, employee_password_authentication_required: 403,
};
export async function handlePlanPosthocEvaluation(request: Request, overrides: Partial<typeof planPosthocEvaluationDependencies> = {}) {
  const deps = { ...planPosthocEvaluationDependencies, ...overrides };
  const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: {
    "Cache-Control": "private, no-store", Vary: "Cookie, Authorization, x-merchant-access-token", "X-Content-Type-Options": "nosniff",
    ...(status === 429 ? { "Retry-After": "60" } : {}), ...(status === 405 ? { Allow: "GET" } : {}),
  } });
  if (request.method !== "GET") return reply({ ok: false, error: "method_not_allowed" }, 405);
  const origin = request.headers.get("origin");
  if (!isCanonicalPortalRequest(request) || origin !== null && origin !== resolveCanonicalPortalOrigin()
    || ["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "") || !isTrustedSameOriginMutationRequest(request)) {
    return reply({ ok: false, error: "forbidden_origin" }, 403);
  }
  try {
    const context = await deps.authenticate(request);
    if (!context.authenticationMethods.length || context.authenticationMethods.some(method => ["invite", "magiclink", "recovery"].includes(method))) throw new MerchantAttendanceError("attendance_access_denied");
    const authUserId = attendanceSelfUuid(context.user.id);
    if (!deps.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
    const query = parsePlanPosthocEvaluationHttpQuery(request.url);
    // Keep entitlement/auth availability checks but do not conflate the fresh
    // adoption-write/module switches with reading a saved evaluation. SQL owns
    // actual owner authorization; a browser-supplied actor never reaches it.
    await deps.entitlement(query.siteId);
    const result = await deps.execute({ query, authUserId });
    const body = { ok: true, data: planPosthocEvaluationFacts(result) };
    parsePlanPosthocEvaluationResponse(body, query, authUserId);
    return reply(body, 200);
  } catch (error) {
    if (error instanceof MerchantEnterpriseAccessError) {
      if (Object.hasOwn(AUTH_ERRORS, error.code) && AUTH_ERRORS[error.code] === error.status) return reply({ ok: false, error: error.code }, error.status);
      return reply({ ok: false, error: "attendance_unavailable" }, 503);
    }
    const code = error instanceof MerchantAttendanceError ? error.code : "attendance_unavailable", known = Object.hasOwn(PLAN_POSTHOC_EVALUATION_HTTP_ERRORS, code);
    return reply({ ok: false, error: known ? code : "attendance_unavailable" }, known ? PLAN_POSTHOC_EVALUATION_HTTP_ERRORS[code] : 503);
  }
}
