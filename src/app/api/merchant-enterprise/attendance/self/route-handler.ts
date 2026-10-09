import { NextResponse } from "next/server";
import { requireMerchantEnterpriseEntitlement, requireMerchantEnterprisePasswordAuthentication,
  resolveValidatedMerchantEnterpriseAuthContext, MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { ATTENDANCE_SELF_ERROR_STATUS, attendanceSelfUuid, parseAttendanceSelfCommand, parseAttendanceSelfQuery } from "@/lib/merchantAttendanceSelf";
import { createAttendanceSelfLimiter, executeAttendanceSelf, readAttendanceSelfJson } from "@/lib/merchantAttendanceSelf.server";
import { attendanceActionAllowed, attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";

const allow = createAttendanceSelfLimiter();
export const attendanceSelfDependencies = {
  enabled: () => process.env.FAOLLA_ATTENDANCE_SELF_ENABLED === "1",
  authenticate: resolveValidatedMerchantEnterpriseAuthContext,
  entitlement: requireMerchantEnterpriseEntitlement,
  execute: executeAttendanceSelf,
  allow,
};
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization, x-merchant-access-token" };

export async function handleAttendanceSelf(request: Request, overrides: Partial<typeof attendanceSelfDependencies> = {}) {
  const deps = { ...attendanceSelfDependencies, ...overrides };
  const reply = (body: unknown, status: number) => NextResponse.json(body, {
    status, headers: status === 429 ? { ...headers, "Retry-After": "60" } : headers,
  });
  if (!deps.enabled()) return reply({ ok: false, error: "attendance_not_available" }, 404);
  if (!["GET", "POST"].includes(request.method)) return reply({ ok: false, error: "method_not_allowed" }, 405);
  if (!isTrustedSameOriginMutationRequest(request)) return reply({ ok: false, error: "forbidden_origin" }, 403);
  try {
    // Exactly one auth validation; DB resolves membership/role without board queries.
    const context = await deps.authenticate(request);
    requireMerchantEnterprisePasswordAuthentication(context);
    const authUserId = attendanceSelfUuid(context.user.id);
    if (!deps.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
    const input = request.method === "POST"
      ? { ...parseAttendanceSelfCommand(await readAttendanceSelfJson(request)), operationId: null }
      : { ...parseAttendanceSelfQuery(request.url), command: null };
    const moduleEnabled = attendanceModuleEnabled(await deps.entitlement(input.siteId));
    if (input.command && !attendanceActionAllowed(moduleEnabled, input.command.action)) throw new MerchantAttendanceError("attendance_platform_paused");
    const result = await deps.execute({ ...input, authUserId });
    return reply({ ok: true, ...result, moduleEnabled }, 200);
  } catch (error) {
    if (error instanceof MerchantEnterpriseAccessError) return reply({ ok: false, error: error.code }, error.status);
    const code = error instanceof MerchantAttendanceError ? error.code : "attendance_unavailable";
    const known = Object.hasOwn(ATTENDANCE_SELF_ERROR_STATUS, code);
    return reply({ ok: false, error: known ? code : "attendance_unavailable" }, known ? ATTENDANCE_SELF_ERROR_STATUS[code] : 503);
  }
}
