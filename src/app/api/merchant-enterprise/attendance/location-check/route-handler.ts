import { NextResponse } from "next/server";
import { requireMerchantEnterpriseEntitlement, requireMerchantEnterprisePasswordAuthentication,
  resolveValidatedMerchantEnterpriseAuthContext, MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { isCanonicalPortalRequest } from "@/lib/canonicalPortalRequest";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { createAttendanceSelfLimiter, readAttendanceSelfJson } from "@/lib/merchantAttendanceSelf.server";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { ATTENDANCE_LOCATION_CHECK_ERRORS, parseAttendanceLocationCommand, parseAttendanceLocationQuery } from "@/lib/merchantAttendanceLocationCheck";
import { executeAttendanceLocationCheck } from "@/lib/merchantAttendanceLocationCheck.server";

export const attendanceLocationCheckDependencies = {
  enabled: () => process.env.FAOLLA_ATTENDANCE_SELF_ENABLED === "1" && process.env.FAOLLA_ATTENDANCE_LOCATION_CHECK_ENABLED === "1",
  authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement,
  execute: executeAttendanceLocationCheck, allow: createAttendanceSelfLimiter(),
};
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization, x-merchant-access-token", "Referrer-Policy": "no-referrer" };
export async function handleAttendanceLocationCheck(request: Request, overrides: Partial<typeof attendanceLocationCheckDependencies> = {}) {
  const deps = { ...attendanceLocationCheckDependencies, ...overrides };
  const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: status === 429 ? { ...headers, "Retry-After": "60" } : headers });
  if (!deps.enabled()) return reply({ ok: false, error: "attendance_not_available" }, 404);
  if (!["GET", "POST"].includes(request.method)) return reply({ ok: false, error: "method_not_allowed" }, 405);
  if (!isCanonicalPortalRequest(request) || !isTrustedSameOriginMutationRequest(request)) return reply({ ok: false, error: "forbidden_origin" }, 403);
  try {
    // Coordinates only enter a bounded POST body, never a URL, SQL argument or log.
    const context = await deps.authenticate(request); requireMerchantEnterprisePasswordAuthentication(context);
    const authUserId = attendanceSelfUuid(context.user.id);
    if (!deps.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
    if (request.method === "POST" && new URL(request.url).search) throw new MerchantAttendanceError("attendance_invalid_request");
    const command = request.method === "POST" ? parseAttendanceLocationCommand(await readAttendanceSelfJson(request)) : null;
    const target = command ? { siteId: command.siteId, expectedWorkerId: command.expectedWorkerId, expectedLocationId: command.expectedLocationId } : parseAttendanceLocationQuery(request.url);
    if (!attendanceModuleEnabled(await deps.entitlement(target.siteId))) throw new MerchantAttendanceError("attendance_platform_paused");
    const result = await deps.execute({ ...target, authUserId, command });
    return reply({ ok: true, ...result, moduleEnabled: true }, 200);
  } catch (error) {
    if (error instanceof MerchantEnterpriseAccessError) return reply({ ok: false, error: error.code }, error.status);
    const code = error instanceof MerchantAttendanceError ? error.code : "attendance_unavailable";
    const known = Object.hasOwn(ATTENDANCE_LOCATION_CHECK_ERRORS, code);
    return reply({ ok: false, error: known ? code : "attendance_unavailable" }, known ? ATTENDANCE_LOCATION_CHECK_ERRORS[code] : 503);
  }
}
