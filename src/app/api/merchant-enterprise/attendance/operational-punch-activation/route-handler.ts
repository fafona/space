import { NextResponse } from "next/server";
import { MerchantEnterpriseAccessError, requireMerchantEnterpriseEntitlement, resolveValidatedMerchantEnterpriseAuthContext } from "@/lib/merchantEnterpriseAuth.server";
import { isCanonicalPortalRequest, resolveCanonicalPortalOrigin } from "@/lib/canonicalPortalRequest";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { attendanceSelfUuid } from "@/lib/merchantAttendanceSelf";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { createAttendanceSelfLimiter } from "@/lib/merchantAttendanceSelf.server";
import { OPERATIONAL_PUNCH_ACTIVATION_BODY_LIMIT, OPERATIONAL_PUNCH_ACTIVATION_ERRORS, OPERATIONAL_PUNCH_ACTIVATION_MESSAGES,
  parseOperationalPunchActivationJson, parseOperationalPunchActivationBody, parseOperationalPunchActivationHttpQuery, parseOperationalPunchActivationResponse, type OperationalPunchActivationError } from "@/lib/merchantAttendanceOperationalPunchActivation";
import { executeOperationalPunchActivation, operationalPunchEnabled } from "@/lib/merchantAttendanceOperationalPunchActivation.server";
export const operationalPunchActivationDependencies = { enabled: operationalPunchEnabled, authenticate: resolveValidatedMerchantEnterpriseAuthContext,
  entitlement: requireMerchantEnterpriseEntitlement, allow: createAttendanceSelfLimiter(), execute: executeOperationalPunchActivation, bodyTimeoutMs: 5000 };
async function readBody(request: Request, timeout: number) {
  if (!/^application\/json\s*(?:;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(request.headers.get("content-type")?.trim() ?? "")) throw new MerchantAttendanceError("attendance_invalid_request");
  const length = request.headers.get("content-length"); if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > OPERATIONAL_PUNCH_ACTIVATION_BODY_LIMIT)) throw new MerchantAttendanceError("attendance_operational_punch_too_large");
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 5000) throw new MerchantAttendanceError("attendance_operational_punch_invalid");
  const reader = request.body?.getReader(); if (!reader) throw new MerchantAttendanceError("attendance_invalid_request");
  let stopped = false, reject!: (e: Error) => void; const until = performance.now() + timeout, interrupted = new Promise<never>((_, r) => { reject = r; });
  const stop = () => { stopped = true; reject(new MerchantAttendanceError("attendance_invalid_request")); void reader.cancel().catch(() => {}); };
  const timer = setTimeout(stop, timeout); request.signal.addEventListener("abort", stop, { once: true });
  const consume = async () => { let text = "", n = 0; const decoder = new TextDecoder("utf-8", { fatal: true }); while (true) {
    if (stopped || request.signal.aborted || performance.now() >= until) throw new MerchantAttendanceError("attendance_invalid_request"); const c = await reader.read();
    if (stopped || request.signal.aborted || performance.now() >= until) throw new MerchantAttendanceError("attendance_invalid_request"); if (c.done) break;
    n += c.value.byteLength; if (n > OPERATIONAL_PUNCH_ACTIVATION_BODY_LIMIT) throw new MerchantAttendanceError("attendance_operational_punch_too_large"); text += decoder.decode(c.value, { stream: true });
  } return parseOperationalPunchActivationJson(text + decoder.decode(), true); };
  try { if (request.signal.aborted) stop(); return await Promise.race([consume(), interrupted]); }
  catch (e) { if (e instanceof MerchantAttendanceError) throw e; throw new MerchantAttendanceError("attendance_invalid_request"); }
  finally { clearTimeout(timer); request.signal.removeEventListener("abort", stop); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function handleOperationalPunchActivation(request: Request, overrides: Partial<typeof operationalPunchActivationDependencies> = {}) {
  const deps = { ...operationalPunchActivationDependencies, ...overrides }, reply = (value: unknown, status: number) => NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie, Authorization, x-merchant-access-token" } });
  const error = (code: OperationalPunchActivationError) => reply({ ok: false, error: { code, message: OPERATIONAL_PUNCH_ACTIVATION_MESSAGES[code] } }, OPERATIONAL_PUNCH_ACTIVATION_ERRORS[code]);
  if (!["GET", "POST"].includes(request.method)) return error("attendance_invalid_request");
  if (!isCanonicalPortalRequest(request) || request.headers.get("origin") !== null && request.headers.get("origin") !== resolveCanonicalPortalOrigin() || ["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "") || !isTrustedSameOriginMutationRequest(request)) return error("attendance_access_denied");
  try {
    if (request.method === "POST" && (new URL(request.url).search || new URL(request.url).hash)) throw new MerchantAttendanceError("attendance_invalid_request");
    const parsed = request.method === "POST" ? parseOperationalPunchActivationBody(await readBody(request, deps.bodyTimeoutMs)) : null;
    const query = parsed?.query ?? parseOperationalPunchActivationHttpQuery(request.url), auth = await deps.authenticate(request);
    if (!auth.authenticationMethods.length || auth.authenticationMethods.some(x => ["invite", "magiclink", "recovery"].includes(x))) throw new MerchantAttendanceError("attendance_access_denied");
    const authUserId = attendanceSelfUuid(auth.user.id); if (!deps.allow(authUserId)) throw new MerchantAttendanceError("attendance_rate_limited");
    let allowActivate = false;
    if (query.mode === "current" && parsed?.command.action !== "deactivate" && deps.enabled(query.siteId)) {
      try { allowActivate = attendanceModuleEnabled(await deps.entitlement(query.siteId)); } catch { /* Eligibility failure cannot grant activation; SQL still proves owner for safe reads. */ }
    }
    const result = await deps.execute({ query, command: parsed?.command ?? null, authUserId, allowActivate }), value = { ok: true, data: result };
    await parseOperationalPunchActivationResponse(value, query, authUserId, parsed?.command ?? null); return reply(value, 200);
  } catch (e) {
    if (e instanceof MerchantEnterpriseAccessError) return error(e.status === 503 ? "attendance_operational_punch_invalid" : "attendance_access_denied");
    const code = e instanceof MerchantAttendanceError ? e.code : "attendance_operational_punch_invalid"; return error(Object.hasOwn(OPERATIONAL_PUNCH_ACTIVATION_ERRORS, code) ? code as OperationalPunchActivationError : "attendance_operational_punch_invalid");
  }
}
