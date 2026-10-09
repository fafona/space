import { NextResponse } from "next/server";
import { isCanonicalPortalRequest } from "@/lib/canonicalPortalRequest";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { MerchantEnterpriseAccessError, requireMerchantEnterpriseEntitlement, resolveValidatedMerchantEnterpriseAuthContext } from "@/lib/merchantEnterpriseAuth.server";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { createAttendanceSelfLimiter, readAttendanceSelfJson } from "@/lib/merchantAttendanceSelf.server";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { LOCATION_SETUP_ERRORS, parseLocationSetupCommand, parseLocationSetupQuery } from "@/lib/merchantAttendanceLocationSetup";
import { executeLocationSetup } from "@/lib/merchantAttendanceLocationSetup.server";
export const locationSetupDependencies = {
  enabled: () => process.env.FAOLLA_ATTENDANCE_ADMIN_ENABLED === "1" && process.env.FAOLLA_ATTENDANCE_LOCATION_SETUP_ENABLED === "1",
  authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement,
  execute: executeLocationSetup, allow: createAttendanceSelfLimiter(),
};
export async function handleLocationSetup(request: Request, overrides: Partial<typeof locationSetupDependencies> = {}) {
  const deps = { ...locationSetupDependencies, ...overrides };
  const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization, x-merchant-access-token", ...(status === 429 ? { "Retry-After": "60" } : {}) } });
  if (!deps.enabled()) return reply({ ok: false, error: "attendance_not_available" }, 404);
  if (!["GET", "POST"].includes(request.method)) return reply({ ok: false, error: "method_not_allowed" }, 405);
  if (!isCanonicalPortalRequest(request) || !isTrustedSameOriginMutationRequest(request)) return reply({ ok: false, error: "forbidden_origin" }, 403);
  try {
    const context = await deps.authenticate(request);
    if (!context.authenticationMethods.length || context.authenticationMethods.some(m => ["invite", "magiclink", "recovery"].includes(m))) throw new MerchantAttendanceError("attendance_access_denied");
    const authUserId = attendanceSelfUuid(context.user.id);
    if (!deps.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
    if (request.method === "POST" && new URL(request.url).search) throw new MerchantAttendanceError("attendance_invalid_request");
    const body = request.method === "POST" ? parseLocationSetupCommand(await readAttendanceSelfJson(request)) : null;
    const query = body?.query ?? parseLocationSetupQuery(request.url), moduleEnabled = attendanceModuleEnabled(await deps.entitlement(query.siteId));
    const result = await deps.execute({ ...query, authUserId, command: body?.command ?? null, allowPrepare: moduleEnabled });
    return reply({ ok: true, ...result, moduleEnabled }, 200);
  } catch (e) {
    if (e instanceof MerchantEnterpriseAccessError) return reply({ ok: false, error: e.code }, e.status);
    const code = e instanceof MerchantAttendanceError && Object.hasOwn(LOCATION_SETUP_ERRORS, e.code) ? e.code : "attendance_unavailable";
    return reply({ ok: false, error: code }, LOCATION_SETUP_ERRORS[code] ?? 503);
  }
}
