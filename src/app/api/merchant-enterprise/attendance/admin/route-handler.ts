import { NextResponse } from "next/server";
import { requireMerchantEnterpriseEntitlement, resolveValidatedMerchantEnterpriseAuthContext, MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { isCanonicalPortalRequest } from "@/lib/canonicalPortalRequest";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { ATTENDANCE_ADMIN_ERRORS, parseAttendanceAdminCommand, parseAttendanceAdminQuery } from "@/lib/merchantAttendanceAdmin";
import { createAttendanceSelfLimiter, readAttendanceSelfJson } from "@/lib/merchantAttendanceSelf.server";
import { executeAttendanceAdmin } from "@/lib/merchantAttendanceAdmin.server";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";

export const attendanceAdminDependencies = {
  enabled: () => process.env.FAOLLA_ATTENDANCE_ADMIN_ENABLED === "1",
  authenticate: resolveValidatedMerchantEnterpriseAuthContext,
  entitlement: requireMerchantEnterpriseEntitlement,
  execute: executeAttendanceAdmin,
  allow: createAttendanceSelfLimiter(),
};
export async function handleAttendanceAdmin(request: Request, overrides: Partial<typeof attendanceAdminDependencies> = {}) {
  const deps = { ...attendanceAdminDependencies, ...overrides };
  const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: {
    "Cache-Control": "private, no-store", Vary: "Cookie, Authorization, x-merchant-access-token", ...(status === 429 ? { "Retry-After": "60" } : {}),
  } });
  if (!deps.enabled()) return reply({ ok: false, error: "attendance_not_available" }, 404);
  if (!["GET", "POST"].includes(request.method)) return reply({ ok: false, error: "method_not_allowed" }, 405);
  if (!isCanonicalPortalRequest(request) || !isTrustedSameOriginMutationRequest(request)) return reply({ ok: false, error: "forbidden_origin" }, 403);
  try {
    const context = await deps.authenticate(request);
    // Owner OAuth and normal password sessions remain supported, not invitation/recovery sessions.
    if (!context.authenticationMethods.length || context.authenticationMethods.some((m) => ["invite", "magiclink", "recovery"].includes(m)))
      throw new MerchantAttendanceError("attendance_access_denied");
    const authUserId = attendanceSelfUuid(context.user.id);
    if (!deps.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
    const input = request.method === "POST"
      ? { ...parseAttendanceAdminCommand(await readAttendanceSelfJson(request)), view: "settings" as const, cursor: null, search: "", operationId: null }
      : { ...parseAttendanceAdminQuery(request.url), command: null };
    const moduleEnabled = attendanceModuleEnabled(await deps.entitlement(input.siteId));
    if (input.command && !moduleEnabled) throw new MerchantAttendanceError("attendance_platform_paused");
    // Current owner identity checked under a DB row lock, including every GET/retry.
    const result = await deps.execute({ ...input, authUserId });
    return reply({ ok: true, ...result, moduleEnabled }, 200);
  } catch (e) {
    if (e instanceof MerchantEnterpriseAccessError) return reply({ ok: false, error: e.code }, e.status);
    const code = e instanceof MerchantAttendanceError ? e.code : "attendance_unavailable";
    return reply({ ok: false, error: Object.hasOwn(ATTENDANCE_ADMIN_ERRORS, code) ? code : "attendance_unavailable" }, Object.hasOwn(ATTENDANCE_ADMIN_ERRORS, code) ? ATTENDANCE_ADMIN_ERRORS[code].status : 503);
  }
}
