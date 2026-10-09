import { NextResponse } from "next/server";
import { MerchantEnterpriseAccessError, requireMerchantEnterprisePasswordAuthentication, requireMerchantEnterpriseEntitlement, resolveValidatedMerchantEnterpriseAuthContext } from "@/lib/merchantEnterpriseAuth.server";
import { isCanonicalPortalRequest, resolveCanonicalPortalOrigin } from "@/lib/canonicalPortalRequest";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { createAttendanceSelfLimiter } from "@/lib/merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { DISPOSAL_EXECUTION_BODY_LIMIT, DISPOSAL_EXECUTION_ERRORS, parseDisposalExecutionJson, parseDisposalExecutionBody,
  parseDisposalExecutionHttpQuery, parseDisposalExecutionResponse } from "@/lib/merchantAttendanceRetentionDisposalExecution";
import { executeRetentionDisposal, disposalExecutionEnabled, DISPOSAL_LOCAL_SITE } from "@/lib/merchantAttendanceRetentionDisposalExecution.server";

export const disposalExecutionDependencies = { authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement,
  enabled: disposalExecutionEnabled, allow: createAttendanceSelfLimiter(), execute: executeRetentionDisposal, timeoutMs: 12000, bodyTimeoutMs: 5000 };
const messages: Record<keyof typeof DISPOSAL_EXECUTION_ERRORS, string> = {
  attendance_invalid_request: "请求不符合单条处置协议。", attendance_access_denied: "请使用当前有权查看此记录的本人密码账户。",
  attendance_operation_conflict: "原编号对应不同意图，请保留并核验原编号。", attendance_retention_disposal_invalid: "暂时无法核实结果，请保留原编号。",
  attendance_retention_disposal_changed: "来源、政策或关联保全已变化，请核验原编号并重新读取。", attendance_retention_disposal_blocked: "当前存在阻止处置的条件。",
  attendance_retention_disposal_disabled: "本地合成处置未开放，真实商户不支持此操作。", attendance_retention_disposal_not_found: "未找到当前身份可读取的记录。",
  attendance_retention_disposal_too_large: "资料超出本次有界读取范围。",
};
function fail(code: keyof typeof DISPOSAL_EXECUTION_ERRORS): never { throw new MerchantAttendanceError(code); }
async function readBody(request: Request, check: () => void, timeoutMs: number, setCancel: (cancel: (() => void) | null) => void) {
  if (!/^application\/json\s*(?:;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(request.headers.get("content-type")?.trim() ?? "")) fail("attendance_invalid_request");
  const length = request.headers.get("content-length");
  if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > DISPOSAL_EXECUTION_BODY_LIMIT)) fail("attendance_retention_disposal_too_large");
  const reader = request.body?.getReader(); if (!reader) fail("attendance_invalid_request");
  let stopped = false, reject!: (e: Error) => void;
  const interruption = new Promise<never>((_, r) => { reject = r; });
  const cancel = () => { if (!stopped) { stopped = true; reject(new MerchantAttendanceError("attendance_invalid_request")); void reader.cancel().catch(() => {}); } };
  const timer = setTimeout(cancel, timeoutMs); setCancel(cancel);
  const consume = async () => { let bytes = 0, text = ""; const decoder = new TextDecoder("utf-8", { fatal: true });
    while (true) { check(); if (stopped) fail("attendance_invalid_request"); const part = await reader.read(); check(); if (stopped) fail("attendance_invalid_request"); if (part.done) break;
      bytes += part.value.byteLength; if (bytes > DISPOSAL_EXECUTION_BODY_LIMIT) fail("attendance_retention_disposal_too_large"); text += decoder.decode(part.value, { stream: true }); }
    return parseDisposalExecutionJson(text + decoder.decode(), "request"); };
  try { return await Promise.race([consume(), interruption]); }
  catch (e) { if (e instanceof MerchantAttendanceError) throw e; return fail("attendance_invalid_request"); }
  finally { stopped = true; clearTimeout(timer); setCancel(null); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function handleRetentionDisposal(request: Request, overrides: Partial<typeof disposalExecutionDependencies> = {}) {
  const deps = { ...disposalExecutionDependencies, ...overrides };
  const reply = (value: unknown, status: number) => NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie, Authorization, x-merchant-access-token" } });
  let stopped = false, reject!: (e: Error) => void, cancelBody: (() => void) | null = null;
  const interruption = new Promise<never>((_, r) => { reject = r; }), deadline = performance.now() + deps.timeoutMs;
  const stop = () => { stopped = true; reject(new MerchantAttendanceError("attendance_retention_disposal_invalid")); cancelBody?.(); };
  const timer = setTimeout(stop, Math.max(1, Math.min(12000, deps.timeoutMs))); request.signal.addEventListener("abort", stop, { once: true });
  const check = () => { if (stopped || request.signal.aborted || performance.now() >= deadline) fail("attendance_retention_disposal_invalid"); };
  const run = async () => {
    if (!Number.isInteger(deps.timeoutMs) || deps.timeoutMs < 1 || deps.timeoutMs > 12000 || !Number.isInteger(deps.bodyTimeoutMs) || deps.bodyTimeoutMs < 1 || deps.bodyTimeoutMs > 5000) fail("attendance_retention_disposal_invalid");
    if (!["GET", "POST"].includes(request.method)) fail("attendance_invalid_request");
    if (!isCanonicalPortalRequest(request) || request.headers.get("origin") !== null && request.headers.get("origin") !== resolveCanonicalPortalOrigin()
      || ["same-site", "cross-site"].includes(request.headers.get("sec-fetch-site") ?? "") || !isTrustedSameOriginMutationRequest(request)) fail("attendance_access_denied");
    check(); const auth = await deps.authenticate(request); check(); requireMerchantEnterprisePasswordAuthentication(auth); const actor = auth.user.id;
    if (typeof actor !== "string" || actor.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(actor) || !deps.allow(actor)) fail("attendance_access_denied");
    if (request.method === "POST" && new URL(request.url).search) fail("attendance_invalid_request");
    const body = request.method === "POST" ? parseDisposalExecutionBody(await readBody(request, check, deps.bodyTimeoutMs, c => { cancelBody = c; })) : null; check();
    const query = body?.query ?? parseDisposalExecutionHttpQuery(request.url), command = body?.command ?? null;
    if (query.mode !== "recover" && query.siteId !== DISPOSAL_LOCAL_SITE) fail("attendance_retention_disposal_disabled");
    let allowWrite = false;
    // Recovery remains authenticated and SQL-authorized after flag/owner loss.
    if (command && deps.enabled(query.siteId)) { try { allowWrite = attendanceModuleEnabled(await deps.entitlement(query.siteId)); } catch { /* Fail closed only for new writes. */ } check(); }
    const result = await deps.execute({ query, command, authUserId: actor, allowWrite }); check();
    const value = { ok: true, data: result }; await parseDisposalExecutionResponse(value, query, actor, command); check(); return reply(value, 200);
  };
  try { return await Promise.race([run(), interruption]); }
  catch (e) { const code = e instanceof MerchantEnterpriseAccessError ? e.status === 503 ? "attendance_retention_disposal_invalid" : "attendance_access_denied" : e instanceof MerchantAttendanceError ? e.code : "attendance_retention_disposal_invalid";
    const known = Object.hasOwn(DISPOSAL_EXECUTION_ERRORS, code) ? code as keyof typeof DISPOSAL_EXECUTION_ERRORS : "attendance_retention_disposal_invalid";
    return reply({ ok: false, error: { code: known, message: messages[known] } }, DISPOSAL_EXECUTION_ERRORS[known]);
  } finally { stopped = true; clearTimeout(timer); request.signal.removeEventListener("abort", stop); }
}
