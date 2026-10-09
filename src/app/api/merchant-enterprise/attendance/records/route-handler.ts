import { NextResponse } from "next/server";
import { MerchantEnterpriseAccessError, requireMerchantEnterpriseEntitlement, requireMerchantEnterprisePasswordAuthentication,
  resolveValidatedMerchantEnterpriseAuthContext } from "@/lib/merchantEnterpriseAuth.server";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { isCanonicalPortalRequest } from "@/lib/canonicalPortalRequest";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { createAttendanceSelfLimiter } from "@/lib/merchantAttendanceSelf.server";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { ATTENDANCE_MANAGEMENT_ERRORS, parseAttendanceRecordsQuery } from "@/lib/merchantAttendanceManagement";
import { executeAttendanceRecords } from "@/lib/merchantAttendanceManagement.server";

export const attendanceRecordsDependencies = { enabled: () => process.env.FAOLLA_ATTENDANCE_RECORDS_ENABLED === "1",
  authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement,
  execute: executeAttendanceRecords, allow: createAttendanceSelfLimiter() };
export async function handleAttendanceRecords(request: Request, overrides: Partial<typeof attendanceRecordsDependencies> = {}) {
  const deps = { ...attendanceRecordsDependencies, ...overrides };
  const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store",
    Vary: "Cookie, Authorization, x-merchant-access-token", ...(status === 429 ? { "Retry-After": "60" } : {}) } });
  if (!deps.enabled()) return reply({ ok: false, error: "attendance_not_available" }, 404);
  if (request.method !== "GET") return reply({ ok: false, error: "method_not_allowed" }, 405);
  if (!isCanonicalPortalRequest(request) || !isTrustedSameOriginMutationRequest(request)) return reply({ ok: false, error: "forbidden_origin" }, 403);
  try {
    const context = await deps.authenticate(request), input = parseAttendanceRecordsQuery(request.url);
    if (input.access === "manager") requireMerchantEnterprisePasswordAuthentication(context);
    else if (!context.authenticationMethods.length || context.authenticationMethods.some(m => ["invite", "magiclink", "recovery"].includes(m))) throw new MerchantAttendanceError("attendance_access_denied");
    const authUserId = attendanceSelfUuid(context.user.id);
    if (!deps.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
    const moduleEnabled = attendanceModuleEnabled(await deps.entitlement(input.siteId));
    // access selects an auth path, never a granted role. DB verifies current owner
    // or manager on every page, including when reading paused historical records.
    const result = await deps.execute({ ...input, authUserId });
    return reply({ ok: true, ...result, moduleEnabled }, 200);
  } catch (e) {
    if (e instanceof MerchantEnterpriseAccessError) return reply({ ok: false, error: e.code }, e.status);
    const code = e instanceof MerchantAttendanceError ? e.code : "attendance_unavailable";
    const known = Object.hasOwn(ATTENDANCE_MANAGEMENT_ERRORS, code);
    return reply({ ok: false, error: known ? code : "attendance_unavailable" }, known ? ATTENDANCE_MANAGEMENT_ERRORS[code] : 503);
  }
}
