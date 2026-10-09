import { resolveValidatedMerchantEnterpriseAuthContext, requireMerchantEnterprisePasswordAuthentication,
  requireMerchantEnterpriseEntitlement } from "@/lib/merchantEnterpriseAuth.server";
import { createAttendanceSelfLimiter } from "@/lib/merchantAttendanceSelf.server";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { parseIndependentHttpQuery, parseIndependentOwnerBody, parseIndependentAdminResult } from "@/lib/merchantAttendanceIndependent";
import { executeIndependentAdmin, independentAttendanceEnabled } from "@/lib/merchantAttendanceIndependent.server";
import { independentDeadline, independentReply, independentRequestOrigin, readIndependentBody } from "./transport";

export const independentDependencies = { authenticate: resolveValidatedMerchantEnterpriseAuthContext,
  entitlement: requireMerchantEnterpriseEntitlement, enabled: independentAttendanceEnabled,
  allow: createAttendanceSelfLimiter(), execute: executeIndependentAdmin, timeoutMs: 12000, bodyTimeoutMs: 5000 };
export async function handleIndependent(request: Request, overrides: Partial<typeof independentDependencies> = {}) {
  const d = { ...independentDependencies, ...overrides };
  return independentDeadline(request, d, async (check, signal) => {
    if (request.method !== "GET" && request.method !== "POST") throw new MerchantAttendanceError("method_not_allowed");
    independentRequestOrigin(request); if (request.method === "POST" && new URL(request.url).search) throw new MerchantAttendanceError("attendance_invalid_request");
    check(); const auth = await d.authenticate(request); check(); requireMerchantEnterprisePasswordAuthentication(auth);
    const actor = auth.user.id;
    if (typeof actor !== "string" || actor.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(actor)) throw new MerchantAttendanceError("attendance_access_denied");
    if (!d.allow(actor)) throw new MerchantAttendanceError("attendance_rate_limited");
    const parsed = request.method === "POST" ? parseIndependentOwnerBody(await readIndependentBody(request, check, signal, d.bodyTimeoutMs)) : null; check();
    const query = parsed?.query ?? parseIndependentHttpQuery(request.url), command = parsed?.command ?? null, pin = parsed && "pin" in parsed ? parsed.pin : null;
    let allowNew = false;
    if (command && ["create", "enable", "issue_pin", "bind_member"].includes(command.action) && d.enabled(query.siteId)) {
      try { allowNew = attendanceModuleEnabled(await d.entitlement(query.siteId)); } catch { /* Only new actions fail closed; saved handoff/revocation stays SQL-authorized. */ } check();
    }
    // No current-owner/active-member pregate here: SQL isolates minimum original
    // recovery from current-owner detail/history/write authority.
    const result = await d.execute({ query, command, pin, authUserId: actor, allowNew }, undefined, signal); check();
    const safe = await parseIndependentAdminResult(result, query, actor, command); check(); return independentReply({ ok: true, data: safe });
  });
}
