import { NextResponse } from "next/server";
import { isCanonicalPortalRequest, resolveCanonicalPortalOrigin } from "@/lib/canonicalPortalRequest";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { MerchantEnterpriseAccessError, requireMerchantEnterpriseEntitlement, requireMerchantEnterprisePasswordAuthentication,
  resolveValidatedMerchantEnterpriseAuthContext } from "@/lib/merchantEnterpriseAuth.server";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { createAttendanceSelfLimiter } from "@/lib/merchantAttendanceSelf.server";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { parseSelfScheduleAdoptionBody, parseSelfScheduleAdoptionQuery, parseSelfScheduleAdoptionHttpResult, parseSelfScheduleAdoptionJson,
  SELF_SCHEDULE_ADOPTION_ERRORS } from "@/lib/merchantAttendanceSelfScheduleAdoption";
import { executeAttendanceSelfScheduleAdoption, attendanceSelfScheduleAdoptionEnabled, attendanceSelfScheduleAdoptionBindRules } from "@/lib/merchantAttendanceSelfScheduleAdoption.server";

export const attendanceSelfScheduleAdoptionDependencies = {
  baseEnabled: () => process.env.FAOLLA_ATTENDANCE_SELF_ENABLED === "1",
  featureEnabled: attendanceSelfScheduleAdoptionEnabled, bindRules: attendanceSelfScheduleAdoptionBindRules,
  authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement,
  execute: executeAttendanceSelfScheduleAdoption, allow: createAttendanceSelfLimiter(), bodyTimeoutMs: 5000,
};
const AUTH_ERRORS: Readonly<Record<string, number>> = { unauthorized: 401, authentication_required: 401, enterprise_auth_unavailable: 503,
  enterprise_entitlement_unavailable: 503, employee_password_authentication_required: 403, enterprise_management_disabled: 403 };
async function readBody(request: Request, timeoutMs: number): Promise<unknown> {
  if (!/^application\/json\s*(?:;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(request.headers.get("content-type")?.trim() ?? "")) {
    throw new MerchantAttendanceError("attendance_invalid_content_type");
  }
  const length = request.headers.get("content-length");
  if (length !== null && (!length || /[^0-9]/.test(length) || Number(length) > 8192)) throw new MerchantAttendanceError("attendance_body_too_large");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) throw new MerchantAttendanceError("attendance_unavailable");
  const reader = request.body?.getReader(); if (!reader) throw new MerchantAttendanceError("attendance_invalid_request");
  const decoder = new TextDecoder("utf-8", { fatal: true }), until = performance.now() + timeoutMs;
  let bytes = 0, text = "", stopped = false, rejectStopped!: (error: MerchantAttendanceError) => void;
  const interruption = new Promise<never>((_, reject) => { rejectStopped = reject; });
  const stop = () => { if (stopped) return; stopped = true; rejectStopped(new MerchantAttendanceError("attendance_invalid_request")); void reader.cancel().catch(() => {}); };
  const timer = setTimeout(stop, timeoutMs); request.signal.addEventListener("abort", stop, { once: true });
  const consume = async () => {
    while (true) {
      if (stopped || request.signal.aborted || performance.now() >= until) throw new MerchantAttendanceError("attendance_invalid_request");
      const chunk = await reader.read();
      if (stopped || request.signal.aborted || performance.now() >= until) throw new MerchantAttendanceError("attendance_invalid_request");
      if (chunk.done) break; bytes += chunk.value.byteLength;
      if (bytes > 8192) throw new MerchantAttendanceError("attendance_body_too_large");
      text += decoder.decode(chunk.value, { stream: true });
    }
    return parseSelfScheduleAdoptionJson(text + decoder.decode(), "request");
  };
  try { if (request.signal.aborted) stop(); return await Promise.race([consume(), interruption]); }
  catch (error) { void reader.cancel().catch(() => {}); if (error instanceof MerchantAttendanceError) throw error; throw new MerchantAttendanceError("attendance_invalid_request"); }
  finally { clearTimeout(timer); request.signal.removeEventListener("abort", stop); reader.releaseLock(); }
}
export async function handleAttendanceSelfScheduleAdoption(request: Request, overrides: Partial<typeof attendanceSelfScheduleAdoptionDependencies> = {}) {
  const deps = { ...attendanceSelfScheduleAdoptionDependencies, ...overrides };
  const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: {
    "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", Vary: "Cookie, Authorization, x-merchant-access-token", "X-Content-Type-Options": "nosniff",
    ...(status === 429 ? { "Retry-After": "60" } : {}), ...(status === 405 ? { Allow: "GET, POST" } : {}),
  } });
  if (!deps.baseEnabled()) return reply({ ok: false, error: "attendance_not_available" }, 404);
  if (!["GET", "POST"].includes(request.method)) return reply({ ok: false, error: "method_not_allowed" }, 405);
  const origin = request.headers.get("origin");
  if (!isCanonicalPortalRequest(request) || origin !== null && origin !== resolveCanonicalPortalOrigin()
    || ["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "") || !isTrustedSameOriginMutationRequest(request)) return reply({ ok: false, error: "forbidden_origin" }, 403);
  try {
    const context = await deps.authenticate(request); requireMerchantEnterprisePasswordAuthentication(context);
    const authUserId = attendanceSelfUuid(context.user.id);
    if (!deps.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
    if (request.method === "POST" && new URL(request.url).search) throw new MerchantAttendanceError("attendance_invalid_request");
    const parsed = request.method === "POST" ? parseSelfScheduleAdoptionBody(await readBody(request, deps.bodyTimeoutMs)) : null;
    const input = parsed ? { ...parsed, operationId: null } : { ...parseSelfScheduleAdoptionQuery(request.url), command: null };
    const moduleEnabled = attendanceModuleEnabled(await deps.entitlement(input.siteId));
    const selectionEnabled = moduleEnabled && deps.featureEnabled(input.siteId);
    if (input.command && !moduleEnabled) throw new MerchantAttendanceError("attendance_platform_paused");
    if (input.command && !selectionEnabled) throw new MerchantAttendanceError("attendance_self_schedule_adoption_disabled");
    const result = await deps.execute({ ...input, authUserId, moduleEnabled, allowWrite: selectionEnabled, bindRules: deps.bindRules(input.siteId) });
    const body = { ok: true, ...result, moduleEnabled, selectionEnabled };
    parseSelfScheduleAdoptionHttpResult(body, { ...input, authUserId });
    return reply(body, 200);
  } catch (error) {
    if (error instanceof MerchantEnterpriseAccessError) {
      if (Object.hasOwn(AUTH_ERRORS, error.code) && AUTH_ERRORS[error.code] === error.status) return reply({ ok: false, error: error.code }, error.status);
      return reply({ ok: false, error: "attendance_unavailable" }, 503);
    }
    const code = error instanceof MerchantAttendanceError ? error.code : "attendance_unavailable", known = Object.hasOwn(SELF_SCHEDULE_ADOPTION_ERRORS, code);
    return reply({ ok: false, error: known ? code : "attendance_unavailable" }, known ? SELF_SCHEDULE_ADOPTION_ERRORS[code] : 503);
  }
}
