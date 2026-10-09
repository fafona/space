import { NextResponse } from "next/server";
import { MerchantEnterpriseAccessError, requireMerchantEnterpriseEntitlement, resolveValidatedMerchantEnterpriseAuthContext } from "@/lib/merchantEnterpriseAuth.server";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { isCanonicalPortalRequest } from "@/lib/canonicalPortalRequest";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { createAttendanceSelfLimiter } from "@/lib/merchantAttendanceSelf.server";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { ATTENDANCE_MANAGEMENT_ERRORS, parseAttendanceScopeCommand, parseAttendanceScopeQuery } from "@/lib/merchantAttendanceManagement";
import { executeAttendanceScopes, readAttendanceScopeJson } from "@/lib/merchantAttendanceManagement.server";

export const attendanceScopesDependencies = { enabled: () => process.env.FAOLLA_ATTENDANCE_ADMIN_ENABLED === "1",
  authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement,
  execute: executeAttendanceScopes, allow: createAttendanceSelfLimiter() };
export async function handleAttendanceScopes(request: Request, overrides: Partial<typeof attendanceScopesDependencies> = {}) {
  const deps = { ...attendanceScopesDependencies, ...overrides };
  const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store",
    Vary: "Cookie, Authorization, x-merchant-access-token", ...(status === 429 ? { "Retry-After": "60" } : {}) } });
  if (!deps.enabled()) return reply({ ok: false, error: "attendance_not_available" }, 404);
  if (!["GET", "POST"].includes(request.method)) return reply({ ok: false, error: "method_not_allowed" }, 405);
  if (!isCanonicalPortalRequest(request) || !isTrustedSameOriginMutationRequest(request)) return reply({ ok: false, error: "forbidden_origin" }, 403);
  try {
    const context = await deps.authenticate(request);
    if (!context.authenticationMethods.length || context.authenticationMethods.some(m => ["invite", "magiclink", "recovery"].includes(m))) throw new MerchantAttendanceError("attendance_access_denied");
    const authUserId = attendanceSelfUuid(context.user.id);
    if (!deps.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
    const input = request.method === "POST" ? { ...parseAttendanceScopeCommand(await readAttendanceScopeJson(request)), operationId: null }
      : { ...parseAttendanceScopeQuery(request.url), command: null };
    const moduleEnabled = attendanceModuleEnabled(await deps.entitlement(input.siteId));
    // Security revocation must remain possible while new attendance is paused.
    if (input.command?.action === "put" && !moduleEnabled) throw new MerchantAttendanceError("attendance_platform_paused");
    const result = await deps.execute({ ...input, authUserId });
    return reply({ ok: true, ...result, moduleEnabled }, 200);
  } catch (e) {
    if (e instanceof MerchantEnterpriseAccessError) return reply({ ok: false, error: e.code }, e.status);
    const code = e instanceof MerchantAttendanceError ? e.code : "attendance_unavailable";
    const known = Object.hasOwn(ATTENDANCE_MANAGEMENT_ERRORS, code);
    return reply({ ok: false, error: known ? code : "attendance_unavailable" }, known ? ATTENDANCE_MANAGEMENT_ERRORS[code] : 503);
  }
}
