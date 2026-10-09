import { NextResponse } from "next/server";
import { requireMerchantEnterpriseEntitlement, resolveValidatedMerchantEnterpriseAuthContext, MerchantEnterpriseAccessError, requireMerchantEnterprisePasswordAuthentication } from "@/lib/merchantEnterpriseAuth.server";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { isCanonicalPortalRequest } from "@/lib/canonicalPortalRequest";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { DISCUSSION_ERRORS, parseDiscussionCommand, parseDiscussionQuery, type DiscussionAccess } from "@/lib/merchantAttendanceLocationDiscussion";
import { createAttendanceSelfLimiter, readAttendanceSelfJson } from "@/lib/merchantAttendanceSelf.server";
import { executeAttendanceDiscussion, type DiscussionInput } from "@/lib/merchantAttendanceLocationDiscussion.server";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
export const discussionDependencies = {
  enabled: () => process.env.FAOLLA_ATTENDANCE_LOCATION_DISCUSSION_ENABLED === "1",
  accessEnabled: (access: DiscussionAccess) => process.env[access === "self" ? "FAOLLA_ATTENDANCE_SELF_ENABLED" : "FAOLLA_ATTENDANCE_ADMIN_ENABLED"] === "1",
  authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement,
  execute: executeAttendanceDiscussion, allow: createAttendanceSelfLimiter(),
};
export async function handleAttendanceDiscussion(request: Request, overrides: Partial<typeof discussionDependencies> = {}) {
  const deps = { ...discussionDependencies, ...overrides };
  const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization, x-merchant-access-token", ...(status === 429 ? { "Retry-After": "60" } : {}) } });
  if (!deps.enabled()) return reply({ ok: false, error: "attendance_not_available" }, 404);
  if (!["GET", "POST"].includes(request.method)) return reply({ ok: false, error: "method_not_allowed" }, 405);
  if (!isCanonicalPortalRequest(request) || !isTrustedSameOriginMutationRequest(request)) return reply({ ok: false, error: "forbidden_origin" }, 403);
  try {
    const context = await deps.authenticate(request), authUserId = attendanceSelfUuid(context.user.id);
    if (!deps.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
    let input: DiscussionInput;
    if (request.method === "POST") {
      if (new URL(request.url).search) throw new MerchantAttendanceError("attendance_invalid_request");
      const p = parseDiscussionCommand(await readAttendanceSelfJson(request));
      input = { authUserId, command: p.command, query: { siteId: p.siteId, access: p.access, expectedWorkerId: p.expectedWorkerId, mode: "detail", eventId: p.command.eventId, operationId: null } };
    } else input = { authUserId, command: null, query: parseDiscussionQuery(request.url) };
    if (!deps.accessEnabled(input.query.access)) return reply({ ok: false, error: "attendance_not_available" }, 404);
    if (input.query.access === "self") requireMerchantEnterprisePasswordAuthentication(context);
    else if (!context.authenticationMethods.length || context.authenticationMethods.some(m => ["invite", "magiclink", "recovery"].includes(m))) throw new MerchantAttendanceError("attendance_access_denied");
    const moduleEnabled = attendanceModuleEnabled(await deps.entitlement(input.query.siteId));
    // Existing-case correspondence is allowed while new attendance is paused.
    return reply({ ok: true, ...await deps.execute(input), moduleEnabled }, 200);
  } catch (e) {
    if (e instanceof MerchantEnterpriseAccessError) return reply({ ok: false, error: e.code }, e.status);
    const code = e instanceof MerchantAttendanceError ? e.code : "attendance_unavailable", known = Object.hasOwn(DISCUSSION_ERRORS, code);
    return reply({ ok: false, error: known ? code : "attendance_unavailable" }, known ? DISCUSSION_ERRORS[code] : 503);
  }
}
