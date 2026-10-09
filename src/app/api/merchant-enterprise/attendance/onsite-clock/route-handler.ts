import { isCanonicalPortalRequest } from "@/lib/canonicalPortalRequest";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { MerchantEnterpriseAccessError, requireMerchantEnterpriseEntitlement, requireMerchantEnterprisePasswordAuthentication,
  resolveValidatedMerchantEnterpriseAuthContext } from "@/lib/merchantEnterpriseAuth.server";
import { createAttendanceSelfLimiter, readAttendanceSelfJson } from "@/lib/merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { ONSITE_QR_ERRORS, parseOnsiteClockBody, parseOnsiteClockQuery } from "@/lib/merchantAttendanceOnsiteQr";
import { executeOnsiteClock } from "@/lib/merchantAttendanceOnsiteQr.server";
import { onsiteQrEnabled, onsiteReply } from "../onsite-code/route-handler";

export const onsiteClockDependencies = { enabled: onsiteQrEnabled, authenticate: resolveValidatedMerchantEnterpriseAuthContext,
  entitlement: requireMerchantEnterpriseEntitlement, allow: createAttendanceSelfLimiter(), execute: executeOnsiteClock };
export async function handleOnsiteClock(request: Request, overrides: Partial<typeof onsiteClockDependencies> = {}) {
  const d = { ...onsiteClockDependencies, ...overrides };
  if (!d.enabled()) return onsiteReply({ ok: false, error: "attendance_not_available" }, 404);
  if (!["GET", "POST"].includes(request.method)) return onsiteReply({ ok: false, error: "method_not_allowed" }, 405);
  if (!isCanonicalPortalRequest(request) || !isTrustedSameOriginMutationRequest(request)) return onsiteReply({ ok: false, error: "forbidden_origin" }, 403);
  try {
    const context = await d.authenticate(request); requireMerchantEnterprisePasswordAuthentication(context);
    const authUserId = attendanceSelfUuid(context.user.id);
    if (!d.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
    if (request.method === "POST" && new URL(request.url).search) throw new MerchantAttendanceError("attendance_invalid_request");
    const input = request.method === "POST" ? { ...parseOnsiteClockBody(await readAttendanceSelfJson(request)), operationId: null }
      : { ...parseOnsiteClockQuery(request.url), command: null, token: null };
    const allowNew = attendanceModuleEnabled(await d.entitlement(input.siteId));
    return onsiteReply({ ok: true, ...await d.execute({ ...input, authUserId, allowNew }), moduleEnabled: allowNew });
  } catch (error) {
    if (error instanceof MerchantEnterpriseAccessError) return onsiteReply({ ok: false, error: error.code }, error.status);
    const code = error instanceof MerchantAttendanceError && Object.hasOwn(ONSITE_QR_ERRORS, error.code) ? error.code : "attendance_unavailable";
    return onsiteReply({ ok: false, error: code }, ONSITE_QR_ERRORS[code] ?? 503);
  }
}
