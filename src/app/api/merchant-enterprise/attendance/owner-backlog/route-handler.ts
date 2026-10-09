import { NextResponse } from "next/server";
import { requireMerchantEnterpriseEntitlement, resolveValidatedMerchantEnterpriseAuthContext, MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { isCanonicalPortalRequest } from "@/lib/canonicalPortalRequest";
import { resolveRequestOrigin, resolvePublicOriginFromHeaders } from "@/lib/requestOrigin";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { createAttendanceSelfLimiter } from "@/lib/merchantAttendanceSelf.server";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { OWNER_BACKLOG_ERRORS, parseOwnerBacklogHttpQuery } from "@/lib/merchantAttendanceOwnerBacklog";
import { executeOwnerBacklog } from "@/lib/merchantAttendanceOwnerBacklog.server";

export const ownerBacklogDependencies = {
  enabled: () => process.env.FAOLLA_ATTENDANCE_OWNER_BACKLOG_ENABLED === "1" && process.env.FAOLLA_ATTENDANCE_ADMIN_ENABLED === "1",
  authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement,
  execute: executeOwnerBacklog, allow: createAttendanceSelfLimiter(),
};
export async function handleOwnerBacklog(request: Request, overrides: Partial<typeof ownerBacklogDependencies> = {}) {
  const deps = { ...ownerBacklogDependencies, ...overrides };
  const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: {
    "Cache-Control": "private, no-store", Vary: "Cookie, Authorization, x-merchant-access-token", "X-Content-Type-Options": "nosniff", ...(status === 429 ? { "Retry-After": "60" } : {}),
  } });
  if (!deps.enabled()) return reply({ ok: false, error: "attendance_not_available" }, 404);
  if (request.method !== "GET") return reply({ ok: false, error: "method_not_allowed" }, 405);
  const origin = request.headers.get("origin"), target = resolveRequestOrigin(request);
  if (!isCanonicalPortalRequest(request) || request.headers.get("sec-fetch-site") === "cross-site"
    || origin && origin !== target && origin !== resolvePublicOriginFromHeaders(request.headers, target)) return reply({ ok: false, error: "forbidden_origin" }, 403);
  try {
    const context = await deps.authenticate(request), authUserId = attendanceSelfUuid(context.user.id);
    if (!context.authenticationMethods.length || context.authenticationMethods.some(method => ["invite", "magiclink", "recovery"].includes(method)))
      throw new MerchantAttendanceError("attendance_access_denied");
    if (!deps.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
    const query = parseOwnerBacklogHttpQuery(request.url);
    const moduleEnabled = attendanceModuleEnabled(await deps.entitlement(query.siteId));
    // SQL checks the merchant's current owner on EVERY page. A paused module
    // remains readable, but this endpoint never grants any approval capability.
    return reply({ ok: true, ...await deps.execute({ query, authUserId }), moduleEnabled }, 200);
  } catch (error) {
    if (error instanceof MerchantEnterpriseAccessError) return reply({ ok: false, error: error.code }, error.status);
    const code = error instanceof MerchantAttendanceError ? error.code : "attendance_unavailable";
    const known = Object.hasOwn(OWNER_BACKLOG_ERRORS, code);
    return reply({ ok: false, error: known ? code : "attendance_unavailable" }, known ? OWNER_BACKLOG_ERRORS[code] : 503);
  }
}
