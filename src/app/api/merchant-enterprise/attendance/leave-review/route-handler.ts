import { NextResponse } from "next/server";
import { MerchantEnterpriseAccessError, requireMerchantEnterpriseEntitlement, resolveValidatedMerchantEnterpriseAuthContext } from "@/lib/merchantEnterpriseAuth.server";
import { isCanonicalPortalRequest } from "@/lib/canonicalPortalRequest";
import { resolveRequestOrigin, resolvePublicOriginFromHeaders } from "@/lib/requestOrigin";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { createAttendanceSelfLimiter } from "@/lib/merchantAttendanceSelf.server";
import { parseLeaveReviewHttpQuery, LEAVE_REVIEW_ERRORS } from "@/lib/merchantAttendanceLeaveReview";
import { executeLeaveReview } from "@/lib/merchantAttendanceLeaveReview.server";
export const leaveReviewDependencies = {
  enabled: () => process.env.FAOLLA_ATTENDANCE_LEAVE_REVIEW_ENABLED === "1" && process.env.FAOLLA_ATTENDANCE_LEAVE_ENABLED === "1",
  authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement,
  allow: createAttendanceSelfLimiter(), execute: executeLeaveReview,
};
export async function handleLeaveReview(request: Request, overrides: Partial<typeof leaveReviewDependencies> = {}) {
  const deps = { ...leaveReviewDependencies, ...overrides };
  const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization, x-merchant-access-token",
    "X-Content-Type-Options": "nosniff", ...(status === 429 ? { "Retry-After": "60" } : {}) } });
  if (!deps.enabled()) return reply({ ok: false, error: "attendance_not_available" }, 404);
  if (request.method !== "GET") return reply({ ok: false, error: "method_not_allowed" }, 405);
  const origin = request.headers.get("origin"), target = resolveRequestOrigin(request);
  if (!isCanonicalPortalRequest(request) || request.headers.get("sec-fetch-site") === "cross-site"
    || origin && origin !== target && origin !== resolvePublicOriginFromHeaders(request.headers, target)) return reply({ ok: false, error: "forbidden_origin" }, 403);
  try {
    const context = await deps.authenticate(request);
    if (!context.authenticationMethods.length || context.authenticationMethods.some(m => ["invite", "magiclink", "recovery"].includes(m))) throw new MerchantAttendanceError("attendance_access_denied");
    const authUserId = attendanceSelfUuid(context.user.id);
    if (!deps.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
    const query = parseLeaveReviewHttpQuery(request.url), moduleEnabled = attendanceModuleEnabled(await deps.entitlement(query.siteId));
    return reply({ ok: true, ...await deps.execute({ query, authUserId }), moduleEnabled }, 200);
  } catch (error) {
    if (error instanceof MerchantEnterpriseAccessError) return reply({ ok: false, error: error.code }, error.status);
    const code = error instanceof MerchantAttendanceError ? error.code : "attendance_unavailable";
    return reply({ ok: false, error: Object.hasOwn(LEAVE_REVIEW_ERRORS, code) ? code : "attendance_unavailable" }, LEAVE_REVIEW_ERRORS[code] ?? 503);
  }
}
