import { NextResponse } from "next/server";
import { MerchantEnterpriseAccessError, requireMerchantEnterpriseEntitlement, requireMerchantEnterprisePasswordAuthentication,
  resolveValidatedMerchantEnterpriseAuthContext } from "@/lib/merchantEnterpriseAuth.server";
import { isCanonicalPortalRequest } from "@/lib/canonicalPortalRequest";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { createAttendanceSelfLimiter } from "@/lib/merchantAttendanceSelf.server";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { EVENT_CHANNEL_ERRORS, EVENT_CHANNEL_MAX_RESPONSE_BYTES, parseEventChannelsQuery, parseEventChannelsResult } from "@/lib/merchantAttendanceEventChannels";
import { executeEventChannels, readEventChannelsJson } from "@/lib/merchantAttendanceEventChannels.server";

export const eventChannelsDependencies = {
  enabled: () => process.env.FAOLLA_ATTENDANCE_SELF_ENABLED === "1" && process.env.FAOLLA_ATTENDANCE_EVENT_CHANNELS_ENABLED === "1",
  authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement,
  allow: createAttendanceSelfLimiter(), execute: executeEventChannels,
};
function reply(body: unknown, status = 200) {
  const serialized = JSON.stringify(body);
  const oversized = Buffer.byteLength(serialized, "utf8") > EVENT_CHANNEL_MAX_RESPONSE_BYTES;
  return new NextResponse(oversized ? JSON.stringify({ ok: false, error: "attendance_unavailable" }) : serialized, {
    status: oversized ? 503 : status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer", Vary: "Cookie, Authorization, x-merchant-access-token", ...(status === 429 ? { "Retry-After": "60" } : {}) },
  });
}
export async function handleEventChannels(request: Request, overrides: Partial<typeof eventChannelsDependencies> = {}) {
  const deps = { ...eventChannelsDependencies, ...overrides };
  if (!deps.enabled()) return reply({ ok: false, error: "attendance_not_available" }, 404);
  if (request.method !== "POST") return reply({ ok: false, error: "method_not_allowed" }, 405);
  if (!isCanonicalPortalRequest(request) || !isTrustedSameOriginMutationRequest(request)) return reply({ ok: false, error: "forbidden_origin" }, 403);
  try {
    if (new URL(request.url).search) throw new MerchantAttendanceError("attendance_invalid_request");
    const context = await deps.authenticate(request); requireMerchantEnterprisePasswordAuthentication(context);
    const authUserId = attendanceSelfUuid(context.user.id);
    if (!deps.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
    const query = parseEventChannelsQuery(await readEventChannelsJson(request));
    const moduleEnabled = attendanceModuleEnabled(await deps.entitlement(query.siteId));
    // Existing historical facts remain readable while collection is paused.
    const result = parseEventChannelsResult(await deps.execute({ query, authUserId }), query);
    return reply({ ok: true, ...result, moduleEnabled });
  } catch (error) {
    if (error instanceof MerchantEnterpriseAccessError) return reply({ ok: false, error: error.code }, error.status);
    const code = error instanceof MerchantAttendanceError && Object.hasOwn(EVENT_CHANNEL_ERRORS, error.code) ? error.code : "attendance_unavailable";
    return reply({ ok: false, error: code }, EVENT_CHANNEL_ERRORS[code]);
  }
}
