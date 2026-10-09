import { NextResponse } from "next/server";
import { MerchantEnterpriseAccessError, requireMerchantEnterpriseEntitlement, requireMerchantEnterprisePasswordAuthentication, resolveValidatedMerchantEnterpriseAuthContext } from "@/lib/merchantEnterpriseAuth.server";
import { isCanonicalPortalRequest } from "@/lib/canonicalPortalRequest";
import { resolveRequestOrigin, resolvePublicOriginFromHeaders } from "@/lib/requestOrigin";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { createAttendanceSelfLimiter } from "@/lib/merchantAttendanceSelf.server";
import { parseUnifiedQuery, UNIFIED_REPORT_ERRORS, type UnifiedQuery } from "@/lib/merchantAttendanceUnifiedTimesheet";
import { executeUnifiedTimesheet } from "@/lib/merchantAttendanceUnifiedTimesheet.server";
export const unifiedTimesheetDependencies = {
  enabled: () => process.env.FAOLLA_ATTENDANCE_UNIFIED_REPORT_ENABLED === "1" && process.env.FAOLLA_ATTENDANCE_TIMESHEET_ENABLED === "1",
  accessEnabled: (access: UnifiedQuery["access"]) => access === "owner" ? process.env.FAOLLA_ATTENDANCE_ADMIN_ENABLED === "1" : process.env.FAOLLA_ATTENDANCE_SCOPED_TIMESHEET_ENABLED === "1"
    && (access === "self" ? process.env.FAOLLA_ATTENDANCE_SELF_ENABLED === "1" : process.env.FAOLLA_ATTENDANCE_RECORDS_ENABLED === "1"),
  authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement, allow: createAttendanceSelfLimiter(), execute: executeUnifiedTimesheet,
};
export async function handleUnifiedTimesheet(request: Request, overrides: Partial<typeof unifiedTimesheetDependencies> = {}) {
  const deps = { ...unifiedTimesheetDependencies, ...overrides };
  const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization, x-merchant-access-token",
    "X-Content-Type-Options": "nosniff", ...(status === 429 ? { "Retry-After": "60" } : {}) } });
  if (!deps.enabled()) return reply({ ok: false, error: "attendance_not_available" }, 404);
  if (request.method !== "GET") return reply({ ok: false, error: "method_not_allowed" }, 405);
  const origin = request.headers.get("origin"), target = resolveRequestOrigin(request);
  if (!isCanonicalPortalRequest(request) || request.headers.get("sec-fetch-site") === "cross-site" || origin && origin !== target && origin !== resolvePublicOriginFromHeaders(request.headers, target)) return reply({ ok: false, error: "forbidden_origin" }, 403);
  try {
    const query = parseUnifiedQuery(request.url); if (!deps.accessEnabled(query.access)) return reply({ ok: false, error: "attendance_not_available" }, 404);
    const context = await deps.authenticate(request); requireMerchantEnterprisePasswordAuthentication(context);
    const authUserId = attendanceSelfUuid(context.user.id); if (!deps.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
    const moduleEnabled = attendanceModuleEnabled(await deps.entitlement(query.siteId)), result = await deps.execute({ query, authUserId });
    return reply({ ok: true, ...result, moduleEnabled }, 200);
  } catch (e) {
    if (e instanceof MerchantEnterpriseAccessError) return reply({ ok: false, error: e.code }, e.status);
    const code = e instanceof MerchantAttendanceError ? e.code : "attendance_unavailable", known = Object.hasOwn(UNIFIED_REPORT_ERRORS, code);
    return reply({ ok: false, error: known ? code : "attendance_unavailable" }, known ? UNIFIED_REPORT_ERRORS[code] : 503);
  }
}
