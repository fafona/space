import { NextResponse } from "next/server";
import { MerchantEnterpriseAccessError, requireMerchantEnterpriseEntitlement, resolveValidatedMerchantEnterpriseAuthContext } from "@/lib/merchantEnterpriseAuth.server";
import { isCanonicalPortalRequest, resolveCanonicalPortalOrigin } from "@/lib/canonicalPortalRequest";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { createAttendanceSelfLimiter } from "@/lib/merchantAttendanceSelf.server";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { parseCaptureBrowserJson } from "@/lib/merchantAttendanceRuleCapturesBrowser";
import { RETENTION_API, RETENTION_BODY_LIMIT, RETENTION_ERRORS, parseRetentionBody, parseRetentionHttpQuery, parseRetentionResponse } from "@/lib/merchantAttendanceRetention";
import { executeRetention, retentionSiteEnabled } from "@/lib/merchantAttendanceRetention.server";

export const retentionDependencies = { authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement,
  allow: createAttendanceSelfLimiter(), siteEnabled: retentionSiteEnabled, execute: executeRetention, bodyTimeoutMs: 5000 };
const AUTH_ERRORS: Readonly<Record<string, number>> = { unauthorized: 401, authentication_required: 401, enterprise_auth_unavailable: 503,
  enterprise_entitlement_unavailable: 503, enterprise_management_disabled: 403, employee_password_authentication_required: 403 };
async function readBody(request: Request, timeoutMs: number): Promise<unknown> {
  if (!/^application\/json\s*(?:;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(request.headers.get("content-type")?.trim() ?? "")) throw new MerchantAttendanceError("attendance_invalid_content_type");
  const length = request.headers.get("content-length");
  if (length !== null && (!length || /[^0-9]/.test(length) || Number(length) > RETENTION_BODY_LIMIT)) throw new MerchantAttendanceError("attendance_body_too_large");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) throw new MerchantAttendanceError("attendance_unavailable");
  const reader = request.body?.getReader(); if (!reader) throw new MerchantAttendanceError("attendance_invalid_request");
  const decoder = new TextDecoder("utf-8", { fatal: true }), deadline = performance.now() + timeoutMs;
  let bytes = 0, text = "", stopped = false, rejectStop!: (e: MerchantAttendanceError) => void;
  const interruption = new Promise<never>((_, reject) => { rejectStop = reject; });
  const stop = () => { if (stopped) return; stopped = true; rejectStop(new MerchantAttendanceError("attendance_invalid_request")); void reader.cancel().catch(() => {}); };
  const timer = setTimeout(stop, timeoutMs); request.signal.addEventListener("abort", stop, { once: true });
  const consume = async () => {
    while (true) {
      if (stopped || request.signal.aborted || performance.now() >= deadline) throw new MerchantAttendanceError("attendance_invalid_request");
      const part = await reader.read();
      if (stopped || request.signal.aborted || performance.now() >= deadline) throw new MerchantAttendanceError("attendance_invalid_request");
      if (part.done) break;
      bytes += part.value.byteLength; if (bytes > RETENTION_BODY_LIMIT) throw new MerchantAttendanceError("attendance_body_too_large");
      text += decoder.decode(part.value, { stream: true });
    }
    if (length !== null && Number(length) !== bytes) throw new MerchantAttendanceError("attendance_invalid_request");
    return parseCaptureBrowserJson(text + decoder.decode());
  };
  try { if (request.signal.aborted) stop(); return await Promise.race([consume(), interruption]); }
  catch (error) { void reader.cancel().catch(() => {}); if (error instanceof MerchantAttendanceError) throw error; throw new MerchantAttendanceError("attendance_invalid_request"); }
  finally { clearTimeout(timer); request.signal.removeEventListener("abort", stop); reader.releaseLock(); }
}
export async function handleRetention(request: Request, overrides: Partial<typeof retentionDependencies> = {}) {
  const deps = { ...retentionDependencies, ...overrides };
  const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store",
    Vary: "Cookie, Authorization, x-merchant-access-token", "X-Content-Type-Options": "nosniff",
    ...(status === 405 ? { Allow: "GET, POST" } : {}), ...(status === 429 ? { "Retry-After": "60" } : {}) } });
  if (!["GET", "POST"].includes(request.method)) return reply({ ok: false, error: "method_not_allowed" }, 405);
  if (!isCanonicalPortalRequest(request) || request.headers.get("origin") !== null && request.headers.get("origin") !== resolveCanonicalPortalOrigin()
    || ["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "") || !isTrustedSameOriginMutationRequest(request)) return reply({ ok: false, error: "forbidden_origin" }, 403);
  try {
    const context = await deps.authenticate(request);
    if (!context.authenticationMethods.length || context.authenticationMethods.some(m => ["invite", "magiclink", "recovery"].includes(m))) throw new MerchantAttendanceError("attendance_access_denied");
    const authUserId = attendanceSelfUuid(context.user.id); if (!deps.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
    const url = new URL(request.url); if (url.pathname !== RETENTION_API || request.method === "POST" && url.search) throw new MerchantAttendanceError("attendance_invalid_request");
    const parsed = request.method === "POST" ? parseRetentionBody(await readBody(request, deps.bodyTimeoutMs)) : null;
    const query = parsed?.query ?? parseRetentionHttpQuery(request.url), command = parsed?.command ?? null;
    const allowWrite = attendanceModuleEnabled(await deps.entitlement(query.siteId)) && deps.siteEnabled(query.siteId);
    if (request.signal.aborted) throw new MerchantAttendanceError("attendance_invalid_request");
    // SQL decides fresh-vs-replay. A closed rollout is never an early HTTP rejection.
    const data = await deps.execute({ query, command, authUserId, allowWrite });
    if (data.canWrite && !allowWrite) throw new MerchantAttendanceError("attendance_retention_invalid");
    const body = { ok: true, canWrite: data.canWrite, data }; parseRetentionResponse(body, query, authUserId, command); return reply(body, 200);
  } catch (error) {
    if (error instanceof MerchantEnterpriseAccessError) return Object.hasOwn(AUTH_ERRORS, error.code) && AUTH_ERRORS[error.code] === error.status
      ? reply({ ok: false, error: error.code }, error.status) : reply({ ok: false, error: "attendance_unavailable" }, 503);
    const code = error instanceof MerchantAttendanceError ? error.code : "attendance_unavailable";
    return reply({ ok: false, error: Object.hasOwn(RETENTION_ERRORS, code) ? code : "attendance_unavailable" }, RETENTION_ERRORS[code] ?? 503);
  }
}
