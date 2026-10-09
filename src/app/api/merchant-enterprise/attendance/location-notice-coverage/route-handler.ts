import { NextResponse } from "next/server";
import { requireMerchantEnterpriseEntitlement, resolveValidatedMerchantEnterpriseAuthContext, MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { isCanonicalPortalRequest } from "@/lib/canonicalPortalRequest";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { createAttendanceSelfLimiter } from "@/lib/merchantAttendanceSelf.server";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { COVERAGE_ERRORS, parseCoverageQuery } from "@/lib/merchantAttendanceNoticeCoverage";
import { executeAttendanceNoticeCoverage } from "@/lib/merchantAttendanceNoticeCoverage.server";

export const coverageDependencies = {
  enabled: () => process.env.FAOLLA_ATTENDANCE_NOTICE_COVERAGE_ENABLED === "1"
    && process.env.FAOLLA_ATTENDANCE_LOCATION_NOTICE_ENABLED === "1" && process.env.FAOLLA_ATTENDANCE_ADMIN_ENABLED === "1",
  authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement,
  execute: executeAttendanceNoticeCoverage, allow: createAttendanceSelfLimiter(),
};
export async function handleAttendanceNoticeCoverage(request: Request, overrides: Partial<typeof coverageDependencies> = {}) {
  const deps = { ...coverageDependencies, ...overrides };
  const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: {
    "Cache-Control": "private, no-store", Vary: "Cookie, Authorization, x-merchant-access-token", ...(status === 429 ? { "Retry-After": "60" } : {}),
  } });
  if (!deps.enabled()) return reply({ ok: false, error: "attendance_not_available" }, 404);
  if (request.method !== "GET") return reply({ ok: false, error: "method_not_allowed" }, 405);
  if (!isCanonicalPortalRequest(request)) return reply({ ok: false, error: "forbidden_origin" }, 403);
  try {
    const context = await deps.authenticate(request), authUserId = attendanceSelfUuid(context.user.id);
    if (!context.authenticationMethods.length || context.authenticationMethods.some(method => ["invite", "magiclink", "recovery"].includes(method))) throw new MerchantAttendanceError("attendance_access_denied");
    if (!deps.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
    const query = parseCoverageQuery(request.url), moduleEnabled = attendanceModuleEnabled(await deps.entitlement(query.siteId));
    // The SQL function verifies the current owner on every page. Pausing new
    // attendance never turns this read into publication, acknowledgement or work.
    return reply({ ok: true, ...await deps.execute({ query, authUserId }), moduleEnabled }, 200);
  } catch (error) {
    if (error instanceof MerchantEnterpriseAccessError) return reply({ ok: false, error: error.code }, error.status);
    const code = error instanceof MerchantAttendanceError ? error.code : "attendance_unavailable";
    const known = Object.hasOwn(COVERAGE_ERRORS, code);
    return reply({ ok: false, error: known ? code : "attendance_unavailable" }, known ? COVERAGE_ERRORS[code] : 503);
  }
}
