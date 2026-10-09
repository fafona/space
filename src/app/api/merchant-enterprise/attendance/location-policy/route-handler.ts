import { NextResponse } from "next/server";
import { requireMerchantEnterpriseEntitlement, resolveValidatedMerchantEnterpriseAuthContext, MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { isCanonicalPortalRequest } from "@/lib/canonicalPortalRequest";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { ATTENDANCE_LOCATION_POLICY_ERRORS, parseAttendanceLocationPolicyCommand, parseAttendanceLocationPolicyQuery } from "@/lib/merchantAttendanceLocationPolicy";
import { createAttendanceSelfLimiter, readAttendanceSelfJson } from "@/lib/merchantAttendanceSelf.server";
import { executeAttendanceLocationPolicy } from "@/lib/merchantAttendanceLocationPolicy.server";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";

export const attendanceLocationPolicyDependencies = {
  enabled: () => process.env.FAOLLA_ATTENDANCE_ADMIN_ENABLED === "1" && process.env.FAOLLA_ATTENDANCE_LOCATION_POLICY_ENABLED === "1",
  authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement,
  execute: executeAttendanceLocationPolicy, allow: createAttendanceSelfLimiter(),
};
export async function handleAttendanceLocationPolicy(request: Request, overrides: Partial<typeof attendanceLocationPolicyDependencies> = {}) {
  const deps = { ...attendanceLocationPolicyDependencies, ...overrides };
  const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: {
    "Cache-Control": "private, no-store", Vary: "Cookie, Authorization, x-merchant-access-token", ...(status === 429 ? { "Retry-After": "60" } : {}),
  } });
  if (!deps.enabled()) return reply({ ok: false, error: "attendance_not_available" }, 404);
  if (!["GET", "POST"].includes(request.method)) return reply({ ok: false, error: "method_not_allowed" }, 405);
  if (!isCanonicalPortalRequest(request) || !isTrustedSameOriginMutationRequest(request)) return reply({ ok: false, error: "forbidden_origin" }, 403);
  try {
    const context = await deps.authenticate(request);
    if (!context.authenticationMethods.length || context.authenticationMethods.some(m => ["invite", "magiclink", "recovery"].includes(m))) throw new MerchantAttendanceError("attendance_access_denied");
    const authUserId = attendanceSelfUuid(context.user.id);
    if (!deps.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
    if (request.method === "POST" && new URL(request.url).search) throw new MerchantAttendanceError("attendance_invalid_request");
    const input = request.method === "POST"
      ? { ...parseAttendanceLocationPolicyCommand(await readAttendanceSelfJson(request)), operationId: null }
      : { ...parseAttendanceLocationPolicyQuery(request.url), command: null };
    const moduleEnabled = attendanceModuleEnabled(await deps.entitlement(input.siteId));
    // Paused writes may replay an already committed receipt; new revisions are
    // rejected inside the owner-locked RPC, never by a client supplied flag.
    const result = await deps.execute({ ...input, authUserId, allowWrite: moduleEnabled });
    return reply({ ok: true, ...result, moduleEnabled }, 200);
  } catch (e) {
    if (e instanceof MerchantEnterpriseAccessError) return reply({ ok: false, error: e.code }, e.status);
    const code = e instanceof MerchantAttendanceError ? e.code : "attendance_unavailable";
    return reply({ ok: false, error: Object.hasOwn(ATTENDANCE_LOCATION_POLICY_ERRORS, code) ? code : "attendance_unavailable" }, ATTENDANCE_LOCATION_POLICY_ERRORS[code] ?? 503);
  }
}
