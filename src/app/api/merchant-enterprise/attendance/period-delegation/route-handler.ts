import { NextResponse } from "next/server";
import { MerchantEnterpriseAccessError, requireMerchantEnterpriseEntitlement, resolveValidatedMerchantEnterpriseAuthContext } from "@/lib/merchantEnterpriseAuth.server";
import { isCanonicalPortalRequest, resolveCanonicalPortalOrigin } from "@/lib/canonicalPortalRequest";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { createAttendanceSelfLimiter } from "@/lib/merchantAttendanceSelf.server";
import {
  PERIOD_DELEGATION_ERRORS, PERIOD_DELEGATION_BODY_BYTE_LIMIT, parsePeriodDelegationJson,
  parsePeriodDelegationBody, parsePeriodDelegationHttpQuery, parsePeriodDelegationResponse,
} from "@/lib/merchantAttendancePeriodDelegation";
import { executePeriodDelegation, periodDelegationEnabled, periodDelegationSafetyAccess } from "@/lib/merchantAttendancePeriodDelegation.server";

export const periodDelegationDependencies = {
  authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement,
  allow: createAttendanceSelfLimiter(), execute: executePeriodDelegation, enabled: periodDelegationEnabled, bodyTimeoutMs: 5000,
};
const AUTH_ERRORS: Readonly<Record<string, number>> = {
  unauthorized: 401, authentication_required: 401, enterprise_auth_unavailable: 503,
  enterprise_entitlement_unavailable: 503, enterprise_management_disabled: 403, employee_password_authentication_required: 403,
};
async function body(request: Request, limitMs: number) {
  if (!/^application\/json\s*(?:;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(request.headers.get("content-type")?.trim() ?? "")) throw new MerchantAttendanceError("attendance_invalid_content_type");
  const length = request.headers.get("content-length");
  if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > PERIOD_DELEGATION_BODY_BYTE_LIMIT)) throw new MerchantAttendanceError("attendance_body_too_large");
  if (!Number.isInteger(limitMs) || limitMs < 1 || limitMs > 5000) throw new MerchantAttendanceError("attendance_unavailable");
  const reader = request.body?.getReader();
  if (!reader) throw new MerchantAttendanceError("attendance_invalid_request");
  let stopped = false, rejectStop!: (error: Error) => void;
  const deadline = performance.now() + limitMs;
  const interruption = new Promise<never>((_, reject) => { rejectStop = reject; });
  const stop = () => {
    if (!stopped) { stopped = true; rejectStop(new MerchantAttendanceError("attendance_invalid_request")); void reader.cancel().catch(() => {}); }
  };
  const timer = setTimeout(stop, limitMs); request.signal.addEventListener("abort", stop, { once: true });
  const consume = async () => {
    let bytes = 0, text = ""; const decoder = new TextDecoder("utf-8", { fatal: true });
    while (true) {
      if (stopped || request.signal.aborted || performance.now() >= deadline) throw new MerchantAttendanceError("attendance_invalid_request");
      const part = await reader.read();
      if (stopped || request.signal.aborted || performance.now() >= deadline) throw new MerchantAttendanceError("attendance_invalid_request");
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > PERIOD_DELEGATION_BODY_BYTE_LIMIT) throw new MerchantAttendanceError("attendance_body_too_large");
      text += decoder.decode(part.value, { stream: true });
    }
    return parsePeriodDelegationJson(text + decoder.decode(), "request");
  };
  try { if (request.signal.aborted) stop(); return await Promise.race([consume(), interruption]); }
  catch (error) { void reader.cancel().catch(() => {}); throw error instanceof MerchantAttendanceError ? error : new MerchantAttendanceError("attendance_invalid_request"); }
  finally { clearTimeout(timer); request.signal.removeEventListener("abort", stop); reader.releaseLock(); }
}

export async function handlePeriodDelegation(request: Request, overrides: Partial<typeof periodDelegationDependencies> = {}) {
  const deps = { ...periodDelegationDependencies, ...overrides };
  const reply = (value: unknown, status: number) => NextResponse.json(value, { status, headers: {
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie, Authorization, x-merchant-access-token",
    ...(status === 429 ? { "Retry-After": "60" } : {}), ...(status === 405 ? { Allow: "GET, POST" } : {}),
  } });
  if (!["GET", "POST"].includes(request.method)) return reply({ ok: false, error: "method_not_allowed" }, 405);
  if (!isCanonicalPortalRequest(request) || request.headers.get("origin") !== null && request.headers.get("origin") !== resolveCanonicalPortalOrigin()
    || ["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "") || !isTrustedSameOriginMutationRequest(request)) {
    return reply({ ok: false, error: "forbidden_origin" }, 403);
  }
  try {
    if (request.method === "POST" && new URL(request.url).search) throw new MerchantAttendanceError("attendance_invalid_request");
    const parsed = request.method === "POST" ? parsePeriodDelegationBody(await body(request, deps.bodyTimeoutMs)) : null;
    const query = parsed?.query ?? parsePeriodDelegationHttpQuery(request.url), context = await deps.authenticate(request);
    if (!context.authenticationMethods.length || context.authenticationMethods.some(method => ["invite", "magiclink", "recovery"].includes(method))) {
      throw new MerchantAttendanceError("attendance_access_denied");
    }
    const authUserId = attendanceSelfUuid(context.user.id);
    if (!deps.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
    const command = parsed?.command ?? null, safe = periodDelegationSafetyAccess(query, command);
    // Owner metadata, explicit revocation and minimal original-actor recovery
    //must survive entitlement/rollout changes. They never authorize source reads.
    const allowWrite = !safe && attendanceModuleEnabled(await deps.entitlement(query.siteId)) && deps.enabled(query.siteId);
    if (!allowWrite && !safe) throw new MerchantAttendanceError("attendance_period_delegation_disabled");
    const result = await deps.execute({ query, command, authUserId, allowWrite });
    const value = { ok: true, ...result };
    parsePeriodDelegationResponse(value, query, { authUserId }, command);
    return reply(value, 200);
  } catch (error) {
    if (error instanceof MerchantEnterpriseAccessError) {
      return Object.hasOwn(AUTH_ERRORS, error.code) && AUTH_ERRORS[error.code] === error.status
        ? reply({ ok: false, error: error.code }, error.status) : reply({ ok: false, error: "attendance_unavailable" }, 503);
    }
    const code = error instanceof MerchantAttendanceError ? error.code : "attendance_unavailable", known = Object.hasOwn(PERIOD_DELEGATION_ERRORS, code);
    return reply({ ok: false, error: known ? code : "attendance_unavailable" }, known ? PERIOD_DELEGATION_ERRORS[code] : 503);
  }
}
