// 194: one bounded four-family endpoint. GET never writes; the only POST is an
// explicit submission or exact original-number replay, never an automatic retry.
import { NextResponse } from "next/server";
import { MerchantEnterpriseAccessError, requireMerchantEnterprisePasswordAuthentication, requireMerchantEnterpriseEntitlement, resolveValidatedMerchantEnterpriseAuthContext } from "@/lib/merchantEnterpriseAuth.server";
import { isCanonicalPortalRequest, resolveCanonicalPortalOrigin } from "@/lib/canonicalPortalRequest";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { createAttendanceSelfLimiter } from "@/lib/merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { APPLICATION_WINDOW_BODY_LIMIT, APPLICATION_WINDOW_FAMILIES, parseApplicationWindowJson, parseApplicationWindowBody, parseApplicationWindowHttpQuery,
  parseApplicationWindowResponse, applicationWindowErrors, type ApplicationWindowFamily } from "@/lib/merchantAttendanceApplicationWindow";
import { executeApplicationWindow, applicationWindowEnabled } from "@/lib/merchantAttendanceApplicationWindow.server";
export const applicationWindowDependencies = { enabled: applicationWindowEnabled, authenticate: resolveValidatedMerchantEnterpriseAuthContext,
  entitlement: requireMerchantEnterpriseEntitlement, allow: createAttendanceSelfLimiter(), execute: executeApplicationWindow, timeoutMs: 12000 };
function error(code: string): never { throw new MerchantAttendanceError(code); }
async function readBody(request: Request, check: () => void, registerCancel: (cancel: (() => void) | null) => void): Promise<unknown> {
  if (!/^application\/json\s*(?:;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(request.headers.get("content-type")?.trim() ?? "")) error("attendance_invalid_content_type");
  const length = request.headers.get("content-length"); if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > APPLICATION_WINDOW_BODY_LIMIT)) error("attendance_body_too_large");
  const reader = request.body?.getReader(); if (!reader) error("attendance_invalid_request"); let bytes = 0, text = ""; const decoder = new TextDecoder("utf-8", { fatal: true });
  const cancel = () => { void reader.cancel().catch(() => {}); }; registerCancel(cancel); request.signal.addEventListener("abort", cancel, { once: true });
  try { while (true) { check(); const item = await reader.read(); check(); if (item.done) break;
      bytes += item.value.byteLength; if (bytes > APPLICATION_WINDOW_BODY_LIMIT) error("attendance_body_too_large"); text += decoder.decode(item.value, { stream: true }); }
    return parseApplicationWindowJson(text + decoder.decode(), "request");
  } catch (e) { if (e instanceof MerchantAttendanceError) throw e; return error("attendance_invalid_request"); }
  finally { registerCancel(null); request.signal.removeEventListener("abort", cancel); cancel(); reader.releaseLock(); }
}
export async function handleApplicationWindow(request: Request, overrides: Partial<typeof applicationWindowDependencies> = {}) {
  const deps = { ...applicationWindowDependencies, ...overrides };
  const reply = (value: unknown, status: number) => NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie, Authorization, x-merchant-access-token", ...(status === 429 ? { "Retry-After": "60" } : {}) } });
  let family: ApplicationWindowFamily | null = null, stopped = false, reject!: (e: Error) => void, cancelBody: (() => void) | null = null;
  const deadline = performance.now() + deps.timeoutMs, cancel = () => { stopped = true; reject(new MerchantAttendanceError("attendance_application_window_invalid")); cancelBody?.(); };
  const pending = new Promise<never>((_, r) => { reject = r; }), timer = setTimeout(cancel, Math.max(1, Math.min(12000, deps.timeoutMs))); request.signal.addEventListener("abort", cancel, { once: true });
  const check = () => { if (stopped || request.signal.aborted || performance.now() >= deadline) error("attendance_application_window_invalid"); };
  const run = async () => {
    if (!Number.isInteger(deps.timeoutMs) || deps.timeoutMs < 1 || deps.timeoutMs > 12000) error("attendance_application_window_invalid");
    if (!["GET", "POST"].includes(request.method)) error("attendance_invalid_request");
    if (!isCanonicalPortalRequest(request) || request.headers.get("origin") !== null && request.headers.get("origin") !== resolveCanonicalPortalOrigin()
      || ["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "") || !isTrustedSameOriginMutationRequest(request)) error("attendance_access_denied");
    check(); const auth = await deps.authenticate(request); check(); requireMerchantEnterprisePasswordAuthentication(auth);
    const actor = auth.user.id; if (typeof actor !== "string" || actor.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(actor)) error("attendance_access_denied");
    if (!deps.allow(actor)) error("attendance_rate_limited"); if (request.method === "POST" && new URL(request.url).search) error("attendance_invalid_request");
    const body = request.method === "POST" ? parseApplicationWindowBody(await readBody(request, check, cancel => { cancelBody = cancel; })) : null; check();
    const query = body?.query ?? parseApplicationWindowHttpQuery(request.url); family = query.family; let allowWrite = false;
    if (query.mode === "prepare" && deps.enabled(query.siteId, query.family)) { if (body) { try { allowWrite = attendanceModuleEnabled(await deps.entitlement(query.siteId)); } catch { /* Only SQL may recognize an exact saved operation. */ } }
      else allowWrite = attendanceModuleEnabled(await deps.entitlement(query.siteId)); check(); }
    if (!body && query.mode === "prepare" && !allowWrite) error("attendance_application_window_disabled");
    const input = { query, command: body?.command ?? null, authUserId: actor, allowWrite }; check(); const result = await deps.execute(input); check();
    const value = { ok: true, data: result }; await parseApplicationWindowResponse(value, input); check(); return reply(value, 200);
  };
  try { return await Promise.race([run(), pending]); }
  catch (e) { const known = family === null ? Object.assign({}, ...APPLICATION_WINDOW_FAMILIES.map(applicationWindowErrors)) as Record<string, number> : applicationWindowErrors(family);
    const code = e instanceof MerchantEnterpriseAccessError ? e.status === 503 ? "attendance_application_window_invalid" : "attendance_access_denied" : e instanceof MerchantAttendanceError ? e.code : "attendance_application_window_invalid";
    return reply({ ok: false, error: Object.hasOwn(known, code) ? code : "attendance_application_window_invalid" }, known[code] ?? 503);
  } finally { stopped = true; clearTimeout(timer); request.signal.removeEventListener("abort", cancel); }
}
