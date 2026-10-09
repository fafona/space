import { NextResponse } from "next/server";
import { MerchantEnterpriseAccessError, requireMerchantEnterpriseEntitlement, requireMerchantEnterprisePasswordAuthentication, resolveValidatedMerchantEnterpriseAuthContext } from "@/lib/merchantEnterpriseAuth.server";
import { isCanonicalPortalRequest } from "@/lib/canonicalPortalRequest";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { createAttendanceAuditExportLimiter } from "@/lib/merchantAttendanceAuditExport.server";
import { readCorrectionJson } from "@/lib/merchantAttendanceCorrection.server";
import { parseUnifiedExportCommand, UNIFIED_EXPORT_ERRORS } from "@/lib/merchantAttendanceUnifiedExport";
import { executeUnifiedExport } from "@/lib/merchantAttendanceUnifiedExport.server";
import { unifiedTimesheetDependencies } from "../unified-timesheet/route-handler";
export const unifiedExportDependencies = {
  enabled: () => process.env.FAOLLA_ATTENDANCE_UNIFIED_EXPORT_ENABLED === "1" && unifiedTimesheetDependencies.enabled(), accessEnabled: unifiedTimesheetDependencies.accessEnabled,
  authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement, allow: createAttendanceAuditExportLimiter(), execute: executeUnifiedExport,
};
export async function handleUnifiedExport(request: Request, overrides: Partial<typeof unifiedExportDependencies> = {}) {
  const deps = { ...unifiedExportDependencies, ...overrides };
  const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization, x-merchant-access-token",
    "X-Content-Type-Options": "nosniff", ...(status === 429 ? { "Retry-After": "60" } : {}) } });
  if (!deps.enabled()) return reply({ ok: false, error: "attendance_not_available" }, 404);
  if (request.method !== "POST") return reply({ ok: false, error: "method_not_allowed" }, 405);
  if (!isCanonicalPortalRequest(request) || request.headers.get("sec-fetch-site") === "cross-site" || !isTrustedSameOriginMutationRequest(request)) return reply({ ok: false, error: "forbidden_origin" }, 403);
  try {
    if (new URL(request.url).search) throw new MerchantAttendanceError("attendance_invalid_request");
    const context = await deps.authenticate(request); requireMerchantEnterprisePasswordAuthentication(context);
    const authUserId = attendanceSelfUuid(context.user.id); if (!deps.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
    const command = parseUnifiedExportCommand(await readCorrectionJson(request));
    if (!deps.accessEnabled(command.query.access)) return reply({ ok: false, error: "attendance_not_available" }, 404);
    const moduleEnabled = attendanceModuleEnabled(await deps.entitlement(command.siteId));
    return reply({ ok: true, ...await deps.execute({ command, authUserId }), moduleEnabled }, 200);
  } catch (e) {
    if (e instanceof MerchantEnterpriseAccessError) return reply({ ok: false, error: e.code }, e.status);
    const code = e instanceof MerchantAttendanceError ? e.code : "attendance_unavailable", known = Object.hasOwn(UNIFIED_EXPORT_ERRORS, code);
    return reply({ ok: false, error: known ? code : "attendance_unavailable" }, known ? UNIFIED_EXPORT_ERRORS[code] : 503);
  }
}
