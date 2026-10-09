import { NextResponse } from "next/server";
import { MerchantEnterpriseAccessError, requireMerchantEnterprisePasswordAuthentication, requireMerchantEnterpriseEntitlement, resolveValidatedMerchantEnterpriseAuthContext } from "@/lib/merchantEnterpriseAuth.server";
import { isCanonicalPortalRequest, resolveCanonicalPortalOrigin } from "@/lib/canonicalPortalRequest";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { createAttendanceSelfLimiter } from "@/lib/merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { CYCLE_SEND_BODY_LIMIT, parseCycleSendBodyJson, parseCycleSendHttpQuery, cycleSendQueryFrame, cycleSendCommandFingerprint } from "@/lib/merchantAttendanceCycleSend";
import { CYCLE_SEND_ERRORS, CYCLE_SEND_RESULT_LIMIT, parseCycleSendResponse } from "@/lib/merchantAttendanceCycleSendResult";
import { executeCycleSend, executeCycleSendRecovery, cycleSendEnabled } from "@/lib/merchantAttendanceCycleSend.server";
export const cycleSendDependencies = { authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement,
  enabled: cycleSendEnabled, allow: createAttendanceSelfLimiter(), write: executeCycleSend, recover: executeCycleSendRecovery, timeoutMs: 12000, bodyTimeoutMs: 5000 };
function fail(code = "attendance_operational_cycle_invalid"): never { throw new MerchantAttendanceError(code); }
async function readBody(request: Request, check: () => void, timeoutMs: number, setCancel: (cancel: (() => void) | null) => void) {
  if (!/^application\/json\s*(?:;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(request.headers.get("content-type")?.trim() ?? "")) fail("attendance_invalid_request");
  const length = request.headers.get("content-length"); if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > CYCLE_SEND_BODY_LIMIT)) fail("attendance_invalid_request");
  const reader = request.body?.getReader(); if (!reader) fail("attendance_invalid_request"); let stopped = false, reject!: (error: Error) => void;
  const interruption = new Promise<never>((_, r) => { reject = r; }), cancel = () => { if (!stopped) { stopped = true; reject(new MerchantAttendanceError("attendance_invalid_request")); void reader.cancel().catch(() => {}); } };
  const timer = setTimeout(cancel, timeoutMs); setCancel(cancel);
  const consume = async () => { let bytes = 0, text = ""; const decoder = new TextDecoder("utf-8", { fatal: true });
    while (true) { check(); if (stopped) fail(); const part = await reader.read(); check(); if (stopped) fail(); if (part.done) break;
      bytes += part.value.byteLength; if (bytes > CYCLE_SEND_BODY_LIMIT) fail("attendance_invalid_request"); text += decoder.decode(part.value, { stream: true }); }
    return parseCycleSendBodyJson(text + decoder.decode()); };
  try { return await Promise.race([consume(), interruption]); } catch (error) { if (error instanceof MerchantAttendanceError) throw error; return fail("attendance_invalid_request"); }
  finally { stopped = true; clearTimeout(timer); setCancel(null); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function handleCycleSend(request: Request, overrides: Partial<typeof cycleSendDependencies> = {}) {
  const deps = { ...cycleSendDependencies, ...overrides };
  const reply = (data: unknown, status: number) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie, Authorization, x-merchant-access-token" } });
  let stopped = false, reject!: (error: Error) => void, cancelBody: (() => void) | null = null; const work = new AbortController();
  const interruption = new Promise<never>((_, r) => { reject = r; }), deadline = performance.now() + deps.timeoutMs;
  const stop = () => { stopped = true; work.abort(); reject(new MerchantAttendanceError("attendance_operational_cycle_invalid")); cancelBody?.(); };
  const timer = setTimeout(stop, Math.max(1, Math.min(12000, deps.timeoutMs))); request.signal.addEventListener("abort", stop, { once: true });
  const check = () => { if (stopped || request.signal.aborted || performance.now() >= deadline) { work.abort(); fail(); } };
  const run = async () => {
    if (!Number.isInteger(deps.timeoutMs) || deps.timeoutMs < 1 || deps.timeoutMs > 12000 || !Number.isInteger(deps.bodyTimeoutMs) || deps.bodyTimeoutMs < 1 || deps.bodyTimeoutMs > 5000) fail();
    if (!["GET", "POST"].includes(request.method)) fail("attendance_invalid_request");
    if (!isCanonicalPortalRequest(request) || request.headers.get("origin") !== null && request.headers.get("origin") !== resolveCanonicalPortalOrigin()
      || ["same-site", "cross-site"].includes(request.headers.get("sec-fetch-site") ?? "") || !isTrustedSameOriginMutationRequest(request)) fail("attendance_access_denied");
    check(); const auth = await deps.authenticate(request); check(); requireMerchantEnterprisePasswordAuthentication(auth); const actor = auth.user.id;
    if (typeof actor !== "string" || actor.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(actor)) fail("attendance_access_denied");
    if (!deps.allow(actor)) fail("attendance_rate_limited"); if (request.method === "POST" && new URL(request.url).search) fail("attendance_invalid_request");
    const body = request.method === "POST" ? await readBody(request, check, deps.bodyTimeoutMs, c => { cancelBody = c; }) : null; check();
    let moduleEnabled = false, value;
    if (body) {
      if (deps.enabled(body.frame.siteId, body.frame.access)) { try { moduleEnabled = attendanceModuleEnabled(await deps.entitlement(body.frame.siteId)); } catch { /* A saved receipt remains recoverable. */ } check(); }
      const fingerprint = await cycleSendCommandFingerprint(body.frame, body.command, actor); check();
      const data = await deps.write({ body, authUserId: actor, allowWrite: moduleEnabled }, undefined, work.signal); check(); value = { ok: true, moduleEnabled, data };
      await parseCycleSendResponse(value, body.frame, actor, body.command.operationId, fingerprint, body.command); check();
    } else {
      const query = parseCycleSendHttpQuery(request.url); if (query.mode !== "recover") fail("attendance_invalid_request");
      // Explicit original-id GET is read-only and skips entitlement/source.
      // Fresh source preview continues to use its separately authorized route.
      const data = await deps.recover({ query, authUserId: actor }, undefined, work.signal); check(); value = { ok: true, moduleEnabled: false, data };
      await parseCycleSendResponse(value, cycleSendQueryFrame(query), actor, query.operationId, query.commandFingerprint); check();
    }
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > CYCLE_SEND_RESULT_LIMIT) fail(); return reply(value, 200);
  };
  try { return await Promise.race([run(), interruption]); }
  catch (error) { const code = error instanceof MerchantEnterpriseAccessError ? error.status === 503 ? "attendance_operational_cycle_invalid" : "attendance_access_denied"
    : error instanceof MerchantAttendanceError ? error.code : "attendance_operational_cycle_invalid";
    const known = Object.hasOwn(CYCLE_SEND_ERRORS, code) ? code : "attendance_operational_cycle_invalid";
    return reply({ ok: false, error: { code: known, message: known === "attendance_access_denied" ? "当前账号无权执行此周期送审。" : "暂时无法核实送审结果，请保留原操作编号再核对。" } }, CYCLE_SEND_ERRORS[known]); }
  finally { stopped = true; work.abort(); clearTimeout(timer); request.signal.removeEventListener("abort", stop); }
}
