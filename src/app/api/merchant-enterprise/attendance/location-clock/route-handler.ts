import { NextResponse } from "next/server";
import { isCanonicalPortalRequest } from "@/lib/canonicalPortalRequest";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { MerchantEnterpriseAccessError, requireMerchantEnterpriseEntitlement, requireMerchantEnterprisePasswordAuthentication,
  resolveValidatedMerchantEnterpriseAuthContext } from "@/lib/merchantEnterpriseAuth.server";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { createAttendanceSelfLimiter, readAttendanceSelfJson } from "@/lib/merchantAttendanceSelf.server";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { ATTENDANCE_LOCATION_CLOCK_ERRORS, parseAttendanceLocationClockCommand, parseAttendanceLocationClockQuery } from "@/lib/merchantAttendanceLocationClock";
import { executeAttendanceLocationClock } from "@/lib/merchantAttendanceLocationClock.server";

export const attendanceLocationClockDependencies = {
  enabled: () => process.env.FAOLLA_ATTENDANCE_SELF_ENABLED === "1" && process.env.FAOLLA_ATTENDANCE_LOCATION_CLOCK_ENABLED === "1",
  authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement,
  execute: executeAttendanceLocationClock, allow: createAttendanceSelfLimiter(),
};
export async function handleAttendanceLocationClock(request: Request, overrides: Partial<typeof attendanceLocationClockDependencies> = {}) {
  const deps = { ...attendanceLocationClockDependencies, ...overrides };
  const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store",
    Vary: "Cookie, Authorization, x-merchant-access-token", ...(status === 429 ? { "Retry-After": "60" } : {}) } });
  if (!deps.enabled()) return reply({ ok: false, error: "attendance_not_available" }, 404);
  if (!["GET", "POST"].includes(request.method)) return reply({ ok: false, error: "method_not_allowed" }, 405);
  if (!isCanonicalPortalRequest(request) || !isTrustedSameOriginMutationRequest(request)) return reply({ ok: false, error: "forbidden_origin" }, 403);
  try {
    const context = await deps.authenticate(request); requireMerchantEnterprisePasswordAuthentication(context);
    const authUserId = attendanceSelfUuid(context.user.id);
    if (!deps.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
    if (request.method === "POST" && new URL(request.url).search) throw new MerchantAttendanceError("attendance_invalid_request");
    const parsed = request.method === "POST" ? parseAttendanceLocationClockCommand(await readAttendanceSelfJson(request)) : null;
    const input = parsed ? { ...parsed, expectedWorkerId: parsed.command.expectedWorkerId, operationId: null }
      : { ...parseAttendanceLocationClockQuery(request.url), command: null };
    const moduleEnabled = attendanceModuleEnabled(await deps.entitlement(input.siteId));
    // Admission is passed by the server, not the body. RPC allows receipt replay
    // while paused, denies new starts and still validates permitted shift closing.
    const result = await deps.execute({ ...input, authUserId, moduleEnabled });
    return reply({ ok: true, ...result, moduleEnabled }, 200);
  } catch (error) {
    if (error instanceof MerchantEnterpriseAccessError) return reply({ ok: false, error: error.code }, error.status);
    const code = error instanceof MerchantAttendanceError ? error.code : "attendance_unavailable", known = Object.hasOwn(ATTENDANCE_LOCATION_CLOCK_ERRORS, code);
    return reply({ ok: false, error: known ? code : "attendance_unavailable" }, known ? ATTENDANCE_LOCATION_CLOCK_ERRORS[code] : 503);
  }
}
