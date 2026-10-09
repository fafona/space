import { NextResponse } from "next/server";
import { requireMerchantEnterpriseEntitlement, resolveValidatedMerchantEnterpriseAuthContext, MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { isCanonicalPortalRequest } from "@/lib/canonicalPortalRequest";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { ATTENDANCE_LOCATION_REVIEW_ERRORS, parseAttendanceLocationReviewCommand, parseAttendanceLocationReviewQuery } from "@/lib/merchantAttendanceLocationReview";
import { createAttendanceSelfLimiter, readAttendanceSelfJson } from "@/lib/merchantAttendanceSelf.server";
import { executeAttendanceLocationReview, type AttendanceLocationReviewInput } from "@/lib/merchantAttendanceLocationReview.server";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
export const attendanceLocationReviewDependencies = {
  enabled: () => process.env.FAOLLA_ATTENDANCE_ADMIN_ENABLED === "1" && process.env.FAOLLA_ATTENDANCE_LOCATION_REVIEW_ENABLED === "1",
  authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement,
  execute: executeAttendanceLocationReview, allow: createAttendanceSelfLimiter(),
};
export async function handleAttendanceLocationReview(request: Request, overrides: Partial<typeof attendanceLocationReviewDependencies> = {}) {
  const deps = { ...attendanceLocationReviewDependencies, ...overrides };
  const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization, x-merchant-access-token", ...(status === 429 ? { "Retry-After": "60" } : {}) } });
  if (!deps.enabled()) return reply({ ok: false, error: "attendance_not_available" }, 404);
  if (!["GET", "POST"].includes(request.method)) return reply({ ok: false, error: "method_not_allowed" }, 405);
  if (!isCanonicalPortalRequest(request) || !isTrustedSameOriginMutationRequest(request)) return reply({ ok: false, error: "forbidden_origin" }, 403);
  try {
    const context = await deps.authenticate(request);
    if (!context.authenticationMethods.length || context.authenticationMethods.some(m => ["invite", "magiclink", "recovery"].includes(m))) throw new MerchantAttendanceError("attendance_access_denied");
    const authUserId = attendanceSelfUuid(context.user.id);
    if (!deps.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
    let input: AttendanceLocationReviewInput;
    if (request.method === "POST") {
      if (new URL(request.url).search) throw new MerchantAttendanceError("attendance_invalid_request");
      const parsed = parseAttendanceLocationReviewCommand(await readAttendanceSelfJson(request));
      input = { authUserId, command: parsed.command, query: { siteId: parsed.siteId, mode: "detail", eventId: parsed.command.eventId, operationId: null } };
    } else input = { authUserId, command: null, query: parseAttendanceLocationReviewQuery(request.url) };
    const moduleEnabled = attendanceModuleEnabled(await deps.entitlement(input.query.siteId));
    // Pausing new attendance must not prevent the current owner from reviewing
    // existing exceptions. This endpoint cannot create or edit a punch.
    return reply({ ok: true, ...await deps.execute(input), moduleEnabled }, 200);
  } catch (e) {
    if (e instanceof MerchantEnterpriseAccessError) return reply({ ok: false, error: e.code }, e.status);
    const code = e instanceof MerchantAttendanceError ? e.code : "attendance_unavailable";
    const known = Object.hasOwn(ATTENDANCE_LOCATION_REVIEW_ERRORS, code);
    return reply({ ok: false, error: known ? code : "attendance_unavailable" }, known ? ATTENDANCE_LOCATION_REVIEW_ERRORS[code] : 503);
  }
}
