import { NextResponse } from "next/server";
import { MerchantEnterpriseAccessError, requireMerchantEnterpriseEntitlement, resolveValidatedMerchantEnterpriseAuthContext } from "@/lib/merchantEnterpriseAuth.server";
import { isCanonicalPortalRequest, resolveCanonicalPortalOrigin } from "@/lib/canonicalPortalRequest";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { createAttendanceSelfLimiter } from "@/lib/merchantAttendanceSelf.server";
import { ACCOUNT_SUSPENSION_ERRORS, ACCOUNT_SUSPENSION_BODY_BYTE_LIMIT, parseAccountSuspensionJson,
  parseAccountSuspensionBody, parseAccountSuspensionHttpQuery, parseAccountSuspensionResponse } from "@/lib/merchantAttendanceAccountSuspension";
import { executeAccountSuspension } from "@/lib/merchantAttendanceAccountSuspension.server";

export const accountSuspensionDependencies = { authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement,
  allow: createAttendanceSelfLimiter(), execute: executeAccountSuspension, bodyTimeoutMs: 5000 };
const AUTH_ERRORS: Readonly<Record<string, number>> = { unauthorized: 401, authentication_required: 401, enterprise_auth_unavailable: 503,
  enterprise_entitlement_unavailable: 503, enterprise_management_disabled: 403, employee_password_authentication_required: 403 };
async function body(request: Request, limitMs: number) {
  if (!/^application\/json\s*(?:;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(request.headers.get("content-type")?.trim() ?? "")) throw new MerchantAttendanceError("attendance_invalid_content_type");
  const length = request.headers.get("content-length"); if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > ACCOUNT_SUSPENSION_BODY_BYTE_LIMIT)) throw new MerchantAttendanceError("attendance_body_too_large");
  if (!Number.isInteger(limitMs) || limitMs < 1 || limitMs > 5000) throw new MerchantAttendanceError("attendance_unavailable");
  const reader = request.body?.getReader(); if (!reader) throw new MerchantAttendanceError("attendance_invalid_request");
  let stopped = false, rejectStop!: (e: Error) => void; const deadline = performance.now() + limitMs;
  const interruption = new Promise<never>((_, reject) => { rejectStop = reject; });
  const stop = () => { if (!stopped) { stopped = true; rejectStop(new MerchantAttendanceError("attendance_invalid_request")); void reader.cancel().catch(() => {}); } };
  const timer = setTimeout(stop, limitMs); request.signal.addEventListener("abort", stop, { once: true });
  const consume = async () => { let n = 0, text = ""; const decoder = new TextDecoder("utf-8", { fatal: true });
    while (true) { if (stopped || request.signal.aborted || performance.now() >= deadline) throw new MerchantAttendanceError("attendance_invalid_request"); const c = await reader.read();
      if (stopped || request.signal.aborted || performance.now() >= deadline) throw new MerchantAttendanceError("attendance_invalid_request"); if (c.done) break;
      n += c.value.byteLength; if (n > ACCOUNT_SUSPENSION_BODY_BYTE_LIMIT) throw new MerchantAttendanceError("attendance_body_too_large"); text += decoder.decode(c.value, { stream: true }); }
    return parseAccountSuspensionJson(text + decoder.decode(), "request"); };
  try { if (request.signal.aborted) stop(); return await Promise.race([consume(), interruption]); }
  catch (e) { void reader.cancel().catch(() => {}); throw e instanceof MerchantAttendanceError ? e : new MerchantAttendanceError("attendance_invalid_request"); }
  finally { clearTimeout(timer); request.signal.removeEventListener("abort", stop); reader.releaseLock(); }
}
export async function handleAccountSuspension(request: Request, overrides: Partial<typeof accountSuspensionDependencies> = {}) {
  const deps = { ...accountSuspensionDependencies, ...overrides };
  const reply = (value: unknown, status: number) => NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    Vary: "Cookie, Authorization, x-merchant-access-token", ...(status === 429 ? { "Retry-After": "60" } : {}), ...(status === 405 ? { Allow: "GET, POST" } : {}) } });
  if (!["GET", "POST"].includes(request.method)) return reply({ ok: false, error: "method_not_allowed" }, 405);
  if (!isCanonicalPortalRequest(request) || request.headers.get("origin") !== null && request.headers.get("origin") !== resolveCanonicalPortalOrigin()
    || ["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "") || !isTrustedSameOriginMutationRequest(request)) return reply({ ok: false, error: "forbidden_origin" }, 403);
  try {
    if (request.method === "POST" && new URL(request.url).search) throw new MerchantAttendanceError("attendance_invalid_request");
    const parsed = request.method === "POST" ? parseAccountSuspensionBody(await body(request, deps.bodyTimeoutMs)) : null;
    const query = parsed?.query ?? parseAccountSuspensionHttpQuery(request.url);
    const context = await deps.authenticate(request);
    if (!context.authenticationMethods.length || context.authenticationMethods.some(m => ["invite", "magiclink", "recovery"].includes(m))) throw new MerchantAttendanceError("attendance_access_denied");
    const authUserId = attendanceSelfUuid(context.user.id); if (!deps.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
    // Original-actor minimal recovery is independent of employee role/owner and rollout/entitlement.
    const recovering = query.mode === "recover" || query.mode === "recover-status";
    const allowRestore = recovering ? false : attendanceModuleEnabled(await deps.entitlement(query.siteId));
    const result = await deps.execute({ query, command: parsed?.command ?? null, authUserId, allowRestore });
    const value = { ok: true, ...result }; parseAccountSuspensionResponse(value, query, authUserId, parsed?.command ?? null); return reply(value, 200);
  } catch (e) {
    if (e instanceof MerchantEnterpriseAccessError) return Object.hasOwn(AUTH_ERRORS, e.code) && AUTH_ERRORS[e.code] === e.status
      ? reply({ ok: false, error: e.code }, e.status) : reply({ ok: false, error: "attendance_unavailable" }, 503);
    const code = e instanceof MerchantAttendanceError ? e.code : "attendance_unavailable", known = Object.hasOwn(ACCOUNT_SUSPENSION_ERRORS, code);
    return reply({ ok: false, error: known ? code : "attendance_unavailable" }, known ? ACCOUNT_SUSPENSION_ERRORS[code] : 503);
  }
}
