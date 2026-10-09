import { NextResponse } from "next/server";
import { MerchantEnterpriseAccessError, requireMerchantEnterpriseEntitlement, resolveValidatedMerchantEnterpriseAuthContext } from "@/lib/merchantEnterpriseAuth.server";
import { isCanonicalPortalRequest } from "@/lib/canonicalPortalRequest";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { createAttendanceSelfLimiter } from "@/lib/merchantAttendanceSelf.server";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { ATTENDANCE_MANAGEMENT_ERRORS } from "@/lib/merchantAttendanceManagement";
import { parseAttendanceChoicesQuery } from "@/lib/merchantAttendanceChoices";
import { executeAttendanceChoices } from "@/lib/merchantAttendanceManagement.server";

export const attendanceChoicesDependencies = { enabled: () => process.env.FAOLLA_ATTENDANCE_ADMIN_ENABLED === "1",
  authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement,
  execute: executeAttendanceChoices, allow: createAttendanceSelfLimiter() };
export async function handleAttendanceChoices(request: Request, overrides: Partial<typeof attendanceChoicesDependencies> = {}) {
  const deps = { ...attendanceChoicesDependencies, ...overrides };
  const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store",
    Vary: "Cookie, Authorization, x-merchant-access-token", ...(status === 429 ? { "Retry-After": "60" } : {}) } });
  if (!deps.enabled()) return reply({ ok: false, error: "attendance_not_available" }, 404);
  if (request.method !== "GET") return reply({ ok: false, error: "method_not_allowed" }, 405);
  if (!isCanonicalPortalRequest(request)) return reply({ ok: false, error: "forbidden_origin" }, 403);
  try {
    const context = await deps.authenticate(request);
    if (!context.authenticationMethods.length || context.authenticationMethods.some(m => ["invite", "magiclink", "recovery"].includes(m))) throw new MerchantAttendanceError("attendance_access_denied");
    const authUserId = attendanceSelfUuid(context.user.id);
    if (!deps.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
    const input = parseAttendanceChoicesQuery(request.url), moduleEnabled = attendanceModuleEnabled(await deps.entitlement(input.siteId));
    return reply({ ok: true, ...await deps.execute({ ...input, authUserId }), moduleEnabled }, 200);
  } catch (e) {
    if (e instanceof MerchantEnterpriseAccessError) return reply({ ok: false, error: e.code }, e.status);
    const code = e instanceof MerchantAttendanceError ? e.code : "attendance_unavailable";
    const known = Object.hasOwn(ATTENDANCE_MANAGEMENT_ERRORS, code);
    return reply({ ok: false, error: known ? code : "attendance_unavailable" }, known ? ATTENDANCE_MANAGEMENT_ERRORS[code] : 503);
  }
}
