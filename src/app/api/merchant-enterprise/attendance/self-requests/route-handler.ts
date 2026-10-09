import { NextResponse } from "next/server";
import { requireMerchantEnterpriseEntitlement, requireMerchantEnterprisePasswordAuthentication, resolveValidatedMerchantEnterpriseAuthContext, MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { isCanonicalPortalRequest } from "@/lib/canonicalPortalRequest";
import { resolveRequestOrigin, resolvePublicOriginFromHeaders } from "@/lib/requestOrigin";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { createAttendanceSelfLimiter } from "@/lib/merchantAttendanceSelf.server";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { SELF_REQUESTS_ERRORS, parseSelfRequestsHttpQuery } from "@/lib/merchantAttendanceSelfRequests";
import { executeSelfRequests } from "@/lib/merchantAttendanceSelfRequests.server";

export const selfRequestsDependencies = {
  enabled: () => process.env.FAOLLA_ATTENDANCE_SELF_REQUESTS_ENABLED === "1"
    && process.env.FAOLLA_ATTENDANCE_SELF_ENABLED === "1" && process.env.FAOLLA_ATTENDANCE_CORRECTIONS_ENABLED === "1",
  authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement,
  execute: executeSelfRequests, allow: createAttendanceSelfLimiter(),
};
export async function handleSelfRequests(request: Request, overrides: Partial<typeof selfRequestsDependencies> = {}) {
  const deps = { ...selfRequestsDependencies, ...overrides };
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
    requireMerchantEnterprisePasswordAuthentication(context);
    if (!deps.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
    const query = parseSelfRequestsHttpQuery(request.url), moduleEnabled = attendanceModuleEnabled(await deps.entitlement(query.siteId));
    return reply({ ok: true, ...await deps.execute({ query, authUserId }), moduleEnabled }, 200);
  } catch (error) {
    if (error instanceof MerchantEnterpriseAccessError) return reply({ ok: false, error: error.code }, error.status);
    const code = error instanceof MerchantAttendanceError ? error.code : "attendance_unavailable", known = Object.hasOwn(SELF_REQUESTS_ERRORS, code);
    return reply({ ok: false, error: known ? code : "attendance_unavailable" }, known ? SELF_REQUESTS_ERRORS[code] : 503);
  }
}
