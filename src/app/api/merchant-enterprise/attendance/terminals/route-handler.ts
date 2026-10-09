import { NextResponse } from "next/server";
import { requireMerchantEnterpriseEntitlement, resolveValidatedMerchantEnterpriseAuthContext, MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { isCanonicalPortalRequest } from "@/lib/canonicalPortalRequest";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { createAttendanceSelfLimiter, readAttendanceSelfJson } from "@/lib/merchantAttendanceSelf.server";
import { executeTerminalAdmin } from "@/lib/merchantAttendanceTerminal.server";
import { TERMINAL_ERRORS, parseTerminalBody, parseTerminalQuery } from "@/lib/merchantAttendanceTerminal";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";

export const terminalAdminDependencies = {
  enabled: () => process.env.FAOLLA_ATTENDANCE_TERMINALS_ENABLED === "1",
  authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement,
  execute: executeTerminalAdmin, allow: createAttendanceSelfLimiter(),
};
export function terminalReply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
    Vary: "Cookie, Authorization, x-merchant-access-token", ...(status === 429 ? { "Retry-After": "60" } : {}) } });
}
export function terminalError(error: unknown) {
  if (error instanceof MerchantEnterpriseAccessError) return terminalReply({ ok: false, error: error.code }, error.status);
  const code = error instanceof MerchantAttendanceError && Object.hasOwn(TERMINAL_ERRORS, error.code) ? error.code : "attendance_unavailable";
  return terminalReply({ ok: false, error: code }, TERMINAL_ERRORS[code]?.status ?? 503);
}
export async function handleTerminalAdmin(request: Request, overrides: Partial<typeof terminalAdminDependencies> = {}) {
  const deps = { ...terminalAdminDependencies, ...overrides };
  if (!deps.enabled()) return terminalReply({ ok: false, error: "attendance_not_available" }, 404);
  if (!["GET", "POST"].includes(request.method)) return terminalReply({ ok: false, error: "method_not_allowed" }, 405);
  if (!isCanonicalPortalRequest(request) || !isTrustedSameOriginMutationRequest(request)) return terminalReply({ ok: false, error: "forbidden_origin" }, 403);
  try {
    const context = await deps.authenticate(request);
    if (!context.authenticationMethods.length || context.authenticationMethods.some(m => ["invite", "magiclink", "recovery"].includes(m))) throw new MerchantAttendanceError("attendance_access_denied");
    const authUserId = attendanceSelfUuid(context.user.id);
    if (!deps.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
    if (request.method === "POST" && new URL(request.url).search) throw new MerchantAttendanceError("attendance_invalid_request");
    const input = request.method === "POST" ? { ...parseTerminalBody(await readAttendanceSelfJson(request)), cursor: null, terminalId: null }
      : { ...parseTerminalQuery(request.url), command: null };
    const moduleEnabled = attendanceModuleEnabled(await deps.entitlement(input.siteId));
    // Paused attendance still permits owner reads, exact retry lookup and revocation.
    return terminalReply({ ok: true, ...await deps.execute({ ...input, authUserId, allowCreate: moduleEnabled }), moduleEnabled });
  } catch (error) { return terminalError(error); }
}
