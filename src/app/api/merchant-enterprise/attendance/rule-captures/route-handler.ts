import { NextResponse } from "next/server";
import { MerchantEnterpriseAccessError, requireMerchantEnterpriseEntitlement, resolveValidatedMerchantEnterpriseAuthContext } from "@/lib/merchantEnterpriseAuth.server";
import { isCanonicalPortalRequest, resolveCanonicalPortalOrigin } from "@/lib/canonicalPortalRequest";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { createAttendanceSelfLimiter } from "@/lib/merchantAttendanceSelf.server";
import { parseRuleCapturesBody, parseRuleCapturesHttpQuery, RULE_CAPTURES_ERRORS } from "@/lib/merchantAttendanceRuleCaptures";
import { executeRuleCaptures } from "@/lib/merchantAttendanceRuleCaptures.server";

export const ruleCapturesDependencies = {
  enabled: () => process.env.FAOLLA_ATTENDANCE_RULE_CAPTURES_ENABLED === "1",
  authenticate: resolveValidatedMerchantEnterpriseAuthContext,
  entitlement: requireMerchantEnterpriseEntitlement,
  bodyTimeoutMs: 5000,
  allow: createAttendanceSelfLimiter(), execute: executeRuleCaptures,
};

const MAX_BODY_BYTES = 8192;
// These are the documented codes produced by the two authentication/entitlement
// dependencies used here. Unexpected errors must not echo upstream detail.
const AUTH_ERRORS: Readonly<Record<string, number>> = {
  unauthorized: 401, authentication_required: 401, enterprise_auth_unavailable: 503,
  enterprise_entitlement_unavailable: 503, enterprise_management_disabled: 403,
  employee_password_authentication_required: 403,
};

async function readCaptureJson(request: Request, timeoutMs: number): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.trim() ?? "";
  if (!/^application\/json\s*(?:;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(contentType)) throw new MerchantAttendanceError("attendance_invalid_content_type");
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) throw new MerchantAttendanceError("attendance_body_too_large");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) throw new MerchantAttendanceError("attendance_unavailable");
  const reader = request.body?.getReader();
  if (!reader) throw new MerchantAttendanceError("attendance_invalid_request");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, text = "", stopped = false;
  const deadline = performance.now() + timeoutMs;
  let rejectStopped!: (error: MerchantAttendanceError) => void;
  const interrupted = new Promise<never>((_, reject) => { rejectStopped = reject; });
  const stop = () => {
    if (stopped) return;
    stopped = true; rejectStopped(new MerchantAttendanceError("attendance_invalid_request"));
    void reader.cancel().catch(() => {});
  };
  const timer = setTimeout(stop, timeoutMs);
  request.signal.addEventListener("abort", stop, { once: true });
  const consume = async () => {
    while (true) {
      // One total deadline, not a new allowance per chunk. The monotonic check
      // also bounds immediately-ready/empty chunks that could starve a timer.
      if (stopped || request.signal.aborted || performance.now() >= deadline) throw new MerchantAttendanceError("attendance_invalid_request");
      const chunk = await reader.read();
      if (stopped || request.signal.aborted || performance.now() >= deadline) throw new MerchantAttendanceError("attendance_invalid_request");
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY_BYTES) throw new MerchantAttendanceError("attendance_body_too_large");
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  };
  try {
    if (request.signal.aborted) stop();
    return await Promise.race([consume(), interrupted]);
  } catch (error) {
    // Cancellation is best effort: a failed/hanging source cancellation cannot
    // hold an oversized or malformed request open or replace its safe error.
    void reader.cancel().catch(() => {});
    if (error instanceof MerchantAttendanceError) throw error;
    throw new MerchantAttendanceError("attendance_invalid_request");
  } finally { clearTimeout(timer); request.signal.removeEventListener("abort", stop); reader.releaseLock(); }
}

export async function handleRuleCaptures(request: Request, overrides: Partial<typeof ruleCapturesDependencies> = {}) {
  const deps = { ...ruleCapturesDependencies, ...overrides };
  const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: {
    "Cache-Control": "private, no-store", Vary: "Cookie, Authorization, x-merchant-access-token", "X-Content-Type-Options": "nosniff",
    ...(status === 429 ? { "Retry-After": "60" } : {}), ...(status === 405 ? { Allow: "GET, POST" } : {}),
  } });
  if (!deps.enabled()) return reply({ ok: false, error: "attendance_not_available" }, 404);
  if (request.method !== "GET" && request.method !== "POST") return reply({ ok: false, error: "method_not_allowed" }, 405);
  const origin = request.headers.get("origin");
  if (!isCanonicalPortalRequest(request) || origin !== null && origin !== resolveCanonicalPortalOrigin()
    || ["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "")
    || !isTrustedSameOriginMutationRequest(request)) return reply({ ok: false, error: "forbidden_origin" }, 403);
  try {
    const context = await deps.authenticate(request);
    if (!context.authenticationMethods.length || context.authenticationMethods.some(method => ["invite", "magiclink", "recovery"].includes(method))) {
      throw new MerchantAttendanceError("attendance_access_denied");
    }
    const authUserId = attendanceSelfUuid(context.user.id);
    if (!deps.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
    if (request.method === "POST" && new URL(request.url).search) throw new MerchantAttendanceError("attendance_invalid_request");
    const parsed = request.method === "POST" ? parseRuleCapturesBody(await readCaptureJson(request, deps.bodyTimeoutMs)) : null;
    const query = parsed?.query ?? parseRuleCapturesHttpQuery(request.url);
    const moduleEnabled = attendanceModuleEnabled(await deps.entitlement(query.siteId));
    // Do not pre-reject paused POST: only the RPC can distinguish an immutable
    // original-operation recovery from a new capture that must remain denied.
    const data = await deps.execute({ query, command: parsed?.command ?? null, authUserId, moduleEnabled });
    return reply({ ok: true, moduleEnabled, data }, 200);
  } catch (error) {
    if (error instanceof MerchantEnterpriseAccessError) {
      if (Object.hasOwn(AUTH_ERRORS, error.code) && AUTH_ERRORS[error.code] === error.status) return reply({ ok: false, error: error.code }, error.status);
      return reply({ ok: false, error: "attendance_unavailable" }, 503);
    }
    const code = error instanceof MerchantAttendanceError ? error.code : "attendance_unavailable";
    return reply({ ok: false, error: Object.hasOwn(RULE_CAPTURES_ERRORS, code) ? code : "attendance_unavailable" }, RULE_CAPTURES_ERRORS[code] ?? 503);
  }
}
