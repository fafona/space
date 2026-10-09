import { NextResponse } from "next/server";
import { MerchantEnterpriseAccessError, requireMerchantEnterpriseEntitlement, resolveValidatedMerchantEnterpriseAuthContext } from "@/lib/merchantEnterpriseAuth.server";
import { isCanonicalPortalRequest } from "@/lib/canonicalPortalRequest";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { createAttendanceSelfLimiter, readAttendanceSelfJson } from "@/lib/merchantAttendanceSelf.server";
import { parseGroupsBody, parseGroupsHttpQuery, GROUPS_ERRORS } from "@/lib/merchantAttendanceGroups";
import { executeGroups } from "@/lib/merchantAttendanceGroups.server";
export const groupsDependencies = {
  enabled: () => process.env.FAOLLA_ATTENDANCE_GROUPS_ENABLED === "1",
  authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement,
  allow: createAttendanceSelfLimiter(), execute: executeGroups,
};
export async function handleGroups(request: Request, overrides: Partial<typeof groupsDependencies> = {}) {
  const deps = { ...groupsDependencies, ...overrides };
  const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization, x-merchant-access-token",
    "X-Content-Type-Options": "nosniff", ...(status === 429 ? { "Retry-After": "60" } : {}) } });
  if (!deps.enabled()) return reply({ ok: false, error: "attendance_not_available" }, 404);
  if (!["GET", "POST"].includes(request.method)) return reply({ ok: false, error: "method_not_allowed" }, 405);
  if (!isCanonicalPortalRequest(request) || !isTrustedSameOriginMutationRequest(request)) return reply({ ok: false, error: "forbidden_origin" }, 403);
  try {
    const context = await deps.authenticate(request);
    if (!context.authenticationMethods.length || context.authenticationMethods.some(m => ["invite", "magiclink", "recovery"].includes(m))) throw new MerchantAttendanceError("attendance_access_denied");
    const authUserId = attendanceSelfUuid(context.user.id);
    if (!deps.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
    if (request.method === "POST" && new URL(request.url).search) throw new MerchantAttendanceError("attendance_invalid_request");
    const parsed = request.method === "POST" ? parseGroupsBody(await readAttendanceSelfJson(request)) : null;
    const query = parsed?.query ?? parseGroupsHttpQuery(request.url);
    const moduleEnabled = attendanceModuleEnabled(await deps.entitlement(query.siteId));
    return reply({ ok: true, ...await deps.execute({ query, command: parsed?.command ?? null, authUserId, allowWrite: moduleEnabled }), moduleEnabled }, 200);
  } catch (error) {
    if (error instanceof MerchantEnterpriseAccessError) return reply({ ok: false, error: error.code }, error.status);
    const code = error instanceof MerchantAttendanceError ? error.code : "attendance_unavailable";
    return reply({ ok: false, error: Object.hasOwn(GROUPS_ERRORS, code) ? code : "attendance_unavailable" }, GROUPS_ERRORS[code] ?? 503);
  }
}
