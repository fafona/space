import { NextResponse } from "next/server";
import { MerchantEnterpriseAccessError, requireMerchantEnterpriseEntitlement, resolveValidatedMerchantEnterpriseAuthContext } from "@/lib/merchantEnterpriseAuth.server";
import { isCanonicalPortalRequest, resolveCanonicalPortalOrigin } from "@/lib/canonicalPortalRequest";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { createAttendanceSelfLimiter } from "@/lib/merchantAttendanceSelf.server";
import { parsePlanCoverageAdoptionsHttpQuery as parsePlanCoverageHttpQuery, parsePlanCoverageAdoptionsData, parsePlanCoverageAdoptionsResponse, PLAN_ADOPTION_VIEW_ERRORS } from "@/lib/merchantAttendancePlanAdoptionView";
import { executePlanCoverageAdoptions, planAdoptionViewSiteEnabled } from "@/lib/merchantAttendancePlanAdoptionView.server";

export const planCoverageAdoptionsDependencies = {
  enabled: () => process.env.FAOLLA_ATTENDANCE_PLAN_COVERAGE_ENABLED === "1" && process.env.FAOLLA_ATTENDANCE_PLAN_ADOPTION_VIEW_ENABLED === "1",
  siteEnabled: planAdoptionViewSiteEnabled,
  authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement,
  allow: createAttendanceSelfLimiter(), execute: executePlanCoverageAdoptions,
};
const AUTH_ERRORS: Readonly<Record<string, number>> = {
  unauthorized: 401, authentication_required: 401, enterprise_auth_unavailable: 503,
  enterprise_entitlement_unavailable: 503, enterprise_management_disabled: 403, employee_password_authentication_required: 403,
};
export async function handlePlanCoverageAdoptions(request: Request, overrides: Partial<typeof planCoverageAdoptionsDependencies> = {}) {
  const deps = { ...planCoverageAdoptionsDependencies, ...overrides };
  const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: {
    "Cache-Control": "private, no-store", Vary: "Cookie, Authorization, x-merchant-access-token",
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    ...(status === 429 ? { "Retry-After": "60" } : {}), ...(status === 405 ? { Allow: "GET" } : {}),
  } });
  if (!deps.enabled()) return reply({ ok: false, error: "attendance_not_available" }, 404);
  if (request.method !== "GET") return reply({ ok: false, error: "method_not_allowed" }, 405);
  const origin = request.headers.get("origin");
  if (!isCanonicalPortalRequest(request) || origin !== null && origin !== resolveCanonicalPortalOrigin()
    || ["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "") || !isTrustedSameOriginMutationRequest(request))
    return reply({ ok: false, error: "forbidden_origin" }, 403);
  try {
    const context = await deps.authenticate(request);
    if (!context.authenticationMethods.length || context.authenticationMethods.some(method => ["invite", "magiclink", "recovery"].includes(method)))
      throw new MerchantAttendanceError("attendance_access_denied");
    const authUserId = attendanceSelfUuid(context.user.id);
    if (!deps.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
    const query = parsePlanCoverageHttpQuery(request.url);
    if (!deps.siteEnabled(query.siteId)) throw new MerchantAttendanceError("attendance_not_available");
    const moduleEnabled = attendanceModuleEnabled(await deps.entitlement(query.siteId));
    const data = parsePlanCoverageAdoptionsData(await deps.execute({ query, authUserId }), query, authUserId);
    const body = { ok: true, moduleEnabled, data };
    parsePlanCoverageAdoptionsResponse(body, query, authUserId);
    return reply(body, 200);
  } catch (error) {
    if (error instanceof MerchantEnterpriseAccessError) {
      if (Object.hasOwn(AUTH_ERRORS, error.code) && AUTH_ERRORS[error.code] === error.status)
        return reply({ ok: false, error: error.code }, error.status);
      return reply({ ok: false, error: "attendance_unavailable" }, 503);
    }
    const code = error instanceof MerchantAttendanceError ? error.code : "attendance_unavailable";
    const known = Object.hasOwn(PLAN_ADOPTION_VIEW_ERRORS, code);
    return reply({ ok: false, error: known ? code : "attendance_unavailable" }, known ? PLAN_ADOPTION_VIEW_ERRORS[code] : 503);
  }
}
