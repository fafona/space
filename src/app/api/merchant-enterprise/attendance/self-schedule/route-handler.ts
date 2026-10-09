import { NextResponse } from "next/server";
import { requireMerchantEnterpriseEntitlement, requireMerchantEnterprisePasswordAuthentication,
  resolveValidatedMerchantEnterpriseAuthContext, MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { createAttendanceSelfLimiter, readAttendanceSelfJson } from "@/lib/merchantAttendanceSelf.server";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { parseSelfScheduleBody, parseSelfScheduleQuery, SELF_SCHEDULE_ERRORS } from "@/lib/merchantAttendanceSelfSchedule";
import { attendanceSelfScheduleEnabled, attendanceSelfScheduleBindRules, executeAttendanceSelfSchedule } from "@/lib/merchantAttendanceSelfSchedule.server";

export const attendanceSelfScheduleDependencies = {
  baseEnabled: () => process.env.FAOLLA_ATTENDANCE_SELF_ENABLED === "1",
  featureEnabled: attendanceSelfScheduleEnabled, bindRules: attendanceSelfScheduleBindRules,
  authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement,
  execute: executeAttendanceSelfSchedule, allow: createAttendanceSelfLimiter(),
};
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization, x-merchant-access-token" };
export async function handleAttendanceSelfSchedule(request: Request, overrides: Partial<typeof attendanceSelfScheduleDependencies> = {}) {
  const deps = { ...attendanceSelfScheduleDependencies, ...overrides };
  const reply = (body: unknown, status: number) => NextResponse.json(body, { status,
    headers: status === 429 ? { ...headers, "Retry-After": "60" } : headers });
  if (!deps.baseEnabled()) return reply({ ok: false, error: "attendance_not_available" }, 404);
  if (!["GET", "POST"].includes(request.method)) return reply({ ok: false, error: "method_not_allowed" }, 405);
  if (!isTrustedSameOriginMutationRequest(request)) return reply({ ok: false, error: "forbidden_origin" }, 403);
  try {
    const context = await deps.authenticate(request);
    requireMerchantEnterprisePasswordAuthentication(context);
    const authUserId = attendanceSelfUuid(context.user.id);
    if (!deps.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
    const input = request.method === "POST"
      ? { ...parseSelfScheduleBody(await readAttendanceSelfJson(request)), operationId: null }
      : { ...parseSelfScheduleQuery(request.url), command: null, selection: null };
    const moduleEnabled = attendanceModuleEnabled(await deps.entitlement(input.siteId));
    const selectionEnabled = moduleEnabled && deps.featureEnabled(input.siteId);
    if (input.command && !moduleEnabled) throw new MerchantAttendanceError("attendance_platform_paused");
    if (input.command && !selectionEnabled) throw new MerchantAttendanceError("attendance_self_schedule_disabled");
    // Disabling the independent selection feature is not an authorization bypass
    // or an excuse to discard a pending operation. GET still checks current auth
    // and the original self RPC; the total SELF switch remains authoritative.
    const result = await deps.execute({ ...input, authUserId, allowWrite: selectionEnabled, bindRules: deps.bindRules(input.siteId) });
    return reply({ ok: true, ...result, moduleEnabled, selectionEnabled }, 200);
  } catch (error) {
    if (error instanceof MerchantEnterpriseAccessError) return reply({ ok: false, error: error.code }, error.status);
    const code = error instanceof MerchantAttendanceError ? error.code : "attendance_unavailable";
    const known = Object.hasOwn(SELF_SCHEDULE_ERRORS, code);
    return reply({ ok: false, error: known ? code : "attendance_unavailable" }, known ? SELF_SCHEDULE_ERRORS[code] : 503);
  }
}
