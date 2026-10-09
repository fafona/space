import { NextResponse } from "next/server";
import { MerchantEnterpriseAccessError, requireMerchantEnterpriseEntitlement, resolveValidatedMerchantEnterpriseAuthContext } from "@/lib/merchantEnterpriseAuth.server";
import { isCanonicalPortalRequest, resolveCanonicalPortalOrigin } from "@/lib/canonicalPortalRequest";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { createAttendanceSelfLimiter } from "@/lib/merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { outageSiteEnabled } from "@/lib/merchantAttendanceOutage.server";
import { executeOutageSubject } from "@/lib/merchantAttendanceOutageSubject.server";
import { OUTAGE_SUBJECT_ERRORS, parseOutageSubjectHttpQuery, parseOutageSubjectResponse } from "@/lib/merchantAttendanceOutageSubject";

export const outageSubjectDependencies = { authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement,
  allow: createAttendanceSelfLimiter(), siteEnabled: outageSiteEnabled, execute: executeOutageSubject };
const AUTH_ERRORS: Readonly<Record<string, number>> = { unauthorized: 401, authentication_required: 401, enterprise_auth_unavailable: 503,
  enterprise_entitlement_unavailable: 503, enterprise_management_disabled: 403, employee_password_authentication_required: 403 };
export async function handleOutageSubject(request: Request, overrides: Partial<typeof outageSubjectDependencies> = {}) {
  const deps = { ...outageSubjectDependencies, ...overrides };
  const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store",
    Vary: "Cookie, Authorization, x-merchant-access-token", "X-Content-Type-Options": "nosniff",
    ...(status === 405 ? { Allow: "GET" } : {}), ...(status === 429 ? { "Retry-After": "60" } : {}) } });
  if (request.method !== "GET") return reply({ ok: false, error: "method_not_allowed" }, 405);
  if (!isCanonicalPortalRequest(request) || request.headers.get("origin") !== null && request.headers.get("origin") !== resolveCanonicalPortalOrigin()
    || ["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "")) return reply({ ok: false, error: "forbidden_origin" }, 403);
  try {
    const context = await deps.authenticate(request);
    if (!context.authenticationMethods.length || context.authenticationMethods.some(m => ["invite", "magiclink", "recovery"].includes(m))) throw new MerchantAttendanceError("attendance_access_denied");
    const authUserId = attendanceSelfUuid(context.user.id); if (!deps.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
    const query = parseOutageSubjectHttpQuery(request.url), moduleEnabled = attendanceModuleEnabled(await deps.entitlement(query.siteId)) && deps.siteEnabled(query.siteId);
    const data = await deps.execute({ query, authUserId, moduleEnabled }), body = { ok: true, canWrite: moduleEnabled, data };
    parseOutageSubjectResponse(body, query, authUserId); return reply(body, 200);
  } catch (error) {
    if (error instanceof MerchantEnterpriseAccessError) return Object.hasOwn(AUTH_ERRORS, error.code) && AUTH_ERRORS[error.code] === error.status
      ? reply({ ok: false, error: error.code }, error.status) : reply({ ok: false, error: "attendance_unavailable" }, 503);
    const code = error instanceof MerchantAttendanceError ? error.code : "attendance_unavailable", known = Object.hasOwn(OUTAGE_SUBJECT_ERRORS, code);
    return reply({ ok: false, error: known ? code : "attendance_unavailable" }, known ? OUTAGE_SUBJECT_ERRORS[code] : 503);
  }
}
