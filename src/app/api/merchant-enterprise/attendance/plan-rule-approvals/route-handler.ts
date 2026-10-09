import { NextResponse } from "next/server";
import { MerchantEnterpriseAccessError, requireMerchantEnterpriseEntitlement, resolveValidatedMerchantEnterpriseAuthContext } from "@/lib/merchantEnterpriseAuth.server";
import { isCanonicalPortalRequest, resolveCanonicalPortalOrigin } from "@/lib/canonicalPortalRequest";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { createAttendanceSelfLimiter } from "@/lib/merchantAttendanceSelf.server";
import { parseCaptureBrowserJson } from "@/lib/merchantAttendanceRuleCapturesBrowser";
import { parsePlanRuleApprovalsHttpQuery, parsePlanRuleApprovalsBody, parsePlanRuleApprovalsResponse,
  PLAN_RULE_APPROVALS_ERRORS } from "@/lib/merchantAttendancePlanRuleApprovals";
import { executePlanRuleApprovals } from "@/lib/merchantAttendancePlanRuleApprovals.server";

export const planRuleApprovalsDependencies = {
  enabled: () => process.env.FAOLLA_ATTENDANCE_PLAN_RULE_APPROVALS_ENABLED === "1",
  authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement,
  allow: createAttendanceSelfLimiter(), execute: executePlanRuleApprovals, bodyTimeoutMs: 5000,
};
const AUTH_ERRORS: Readonly<Record<string, number>> = {
  unauthorized: 401, authentication_required: 401, enterprise_auth_unavailable: 503,
  enterprise_entitlement_unavailable: 503, enterprise_management_disabled: 403, employee_password_authentication_required: 403,
};
async function readBody(request: Request, timeoutMs: number): Promise<unknown> {
  if (!/^application\/json\s*(?:;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(request.headers.get("content-type")?.trim() ?? "")) {
    throw new MerchantAttendanceError("attendance_invalid_content_type");
  }
  const length = request.headers.get("content-length");
  if (length !== null && (!length || /[^0-9]/.test(length) || Number(length) > 8192)) throw new MerchantAttendanceError("attendance_body_too_large");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) throw new MerchantAttendanceError("attendance_unavailable");
  const reader = request.body?.getReader();
  if (!reader) throw new MerchantAttendanceError("attendance_invalid_request");
  const decoder = new TextDecoder("utf-8", { fatal: true }), deadline = performance.now() + timeoutMs;
  let bytes = 0, text = "", stopped = false, rejectStopped!: (error: MerchantAttendanceError) => void;
  const interruption = new Promise<never>((_, reject) => { rejectStopped = reject; });
  const stop = () => { if (stopped) return; stopped = true; rejectStopped(new MerchantAttendanceError("attendance_invalid_request")); void reader.cancel().catch(() => {}); };
  const timer = setTimeout(stop, timeoutMs);
  request.signal.addEventListener("abort", stop, { once: true });
  const consume = async () => {
    while (true) {
      if (stopped || request.signal.aborted || performance.now() >= deadline) throw new MerchantAttendanceError("attendance_invalid_request");
      const chunk = await reader.read();
      if (stopped || request.signal.aborted || performance.now() >= deadline) throw new MerchantAttendanceError("attendance_invalid_request");
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 8192) throw new MerchantAttendanceError("attendance_body_too_large");
      text += decoder.decode(chunk.value, { stream: true });
    }
    return parseCaptureBrowserJson(text + decoder.decode());
  };
  try { if (request.signal.aborted) stop(); return await Promise.race([consume(), interruption]); }
  catch (error) {
    void reader.cancel().catch(() => {});
    if (error instanceof MerchantAttendanceError) throw error;
    throw new MerchantAttendanceError("attendance_invalid_request");
  } finally { clearTimeout(timer); request.signal.removeEventListener("abort", stop); reader.releaseLock(); }
}

export async function handlePlanRuleApprovals(request: Request, overrides: Partial<typeof planRuleApprovalsDependencies> = {}) {
  const deps = { ...planRuleApprovalsDependencies, ...overrides };
  const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: {
    "Cache-Control": "private, no-store", Vary: "Cookie, Authorization, x-merchant-access-token", "X-Content-Type-Options": "nosniff",
    ...(status === 429 ? { "Retry-After": "60" } : {}), ...(status === 405 ? { Allow: "GET, POST" } : {}),
  } });
  if (!deps.enabled()) return reply({ ok: false, error: "attendance_not_available" }, 404);
  if (!["GET", "POST"].includes(request.method)) return reply({ ok: false, error: "method_not_allowed" }, 405);
  const origin = request.headers.get("origin");
  if (!isCanonicalPortalRequest(request) || origin !== null && origin !== resolveCanonicalPortalOrigin()
    || ["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "") || !isTrustedSameOriginMutationRequest(request)) {
    return reply({ ok: false, error: "forbidden_origin" }, 403);
  }
  try {
    const context = await deps.authenticate(request);
    if (!context.authenticationMethods.length || context.authenticationMethods.some(method => ["invite", "magiclink", "recovery"].includes(method))) throw new MerchantAttendanceError("attendance_access_denied");
    const authUserId = attendanceSelfUuid(context.user.id);
    if (!deps.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
    if (request.method === "POST" && new URL(request.url).search) throw new MerchantAttendanceError("attendance_invalid_request");
    const parsed = request.method === "POST" ? parsePlanRuleApprovalsBody(await readBody(request, deps.bodyTimeoutMs)) : null;
    const query = parsed?.query ?? parsePlanRuleApprovalsHttpQuery(request.url);
    if (request.method === "GET" && query.mode === "approve") throw new MerchantAttendanceError("attendance_invalid_request");
    const moduleEnabled = attendanceModuleEnabled(await deps.entitlement(query.siteId));
    // Paused new approvals fail in SQL. Only SQL can distinguish them from a
    // matching original operation, which must remain recoverable without writes.
    const data = await deps.execute({ query, command: parsed?.command ?? null, authUserId, moduleEnabled });
    const body = { ok: true, moduleEnabled, data };
    parsePlanRuleApprovalsResponse(body, query, authUserId, parsed?.command ?? null);
    return reply(body, 200);
  } catch (error) {
    if (error instanceof MerchantEnterpriseAccessError) {
      if (Object.hasOwn(AUTH_ERRORS, error.code) && AUTH_ERRORS[error.code] === error.status) return reply({ ok: false, error: error.code }, error.status);
      return reply({ ok: false, error: "attendance_unavailable" }, 503);
    }
    const code = error instanceof MerchantAttendanceError ? error.code : "attendance_unavailable", known = Object.hasOwn(PLAN_RULE_APPROVALS_ERRORS, code);
    return reply({ ok: false, error: known ? code : "attendance_unavailable" }, known ? PLAN_RULE_APPROVALS_ERRORS[code] : 503);
  }
}
