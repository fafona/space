import { NextResponse } from "next/server";
import { MerchantEnterpriseAccessError, requireMerchantEnterpriseEntitlement, requireMerchantEnterprisePasswordAuthentication,
  resolveValidatedMerchantEnterpriseAuthContext } from "@/lib/merchantEnterpriseAuth.server";
import { isCanonicalPortalRequest } from "@/lib/canonicalPortalRequest";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { createAttendanceSelfLimiter } from "@/lib/merchantAttendanceSelf.server";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { ATTENDANCE_HISTORY_ERRORS, parseAttendanceHistoryQuery } from "@/lib/merchantAttendanceHistory";
import { executeAttendanceHistory } from "@/lib/merchantAttendanceHistory.server";

export const attendanceHistoryDependencies = { enabled: () => process.env.FAOLLA_ATTENDANCE_SELF_ENABLED === "1",
  authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement,
  execute: executeAttendanceHistory, allow: createAttendanceSelfLimiter() };
export async function handleAttendanceHistory(request: Request, overrides: Partial<typeof attendanceHistoryDependencies> = {}) {
  const deps = { ...attendanceHistoryDependencies, ...overrides };
  const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: {
    "Cache-Control": "private, no-store", Vary: "Cookie, Authorization, x-merchant-access-token",
    ...(status === 429 ? { "Retry-After": "60" } : {}),
  } });
  if (!deps.enabled()) return reply({ ok: false, error: "attendance_not_available" }, 404);
  if (request.method !== "GET") return reply({ ok: false, error: "method_not_allowed" }, 405);
  if (!isCanonicalPortalRequest(request) || !isTrustedSameOriginMutationRequest(request)) return reply({ ok: false, error: "forbidden_origin" }, 403);
  try {
    const context = await deps.authenticate(request);
    requireMerchantEnterprisePasswordAuthentication(context);
    const authUserId = attendanceSelfUuid(context.user.id);
    if (!deps.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
    const input = parseAttendanceHistoryQuery(request.url);
    const moduleEnabled = attendanceModuleEnabled(await deps.entitlement(input.siteId));
    // Read history even when new punches are paused. Current account, role and
    // employee->worker binding are resolved under locks by the RPC on every page.
    return reply({ ok: true, ...await deps.execute({ ...input, authUserId }), moduleEnabled }, 200);
  } catch (error) {
    if (error instanceof MerchantEnterpriseAccessError) return reply({ ok: false, error: error.code }, error.status);
    const code = error instanceof MerchantAttendanceError ? error.code : "attendance_unavailable";
    const known = Object.hasOwn(ATTENDANCE_HISTORY_ERRORS, code);
    return reply({ ok: false, error: known ? code : "attendance_unavailable" }, known ? ATTENDANCE_HISTORY_ERRORS[code] : 503);
  }
}
