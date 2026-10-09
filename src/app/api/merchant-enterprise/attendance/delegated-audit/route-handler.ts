//203 finite RESOURCE audit. Current delegated reads remain in SQL; original
//actor receipt recovery never requires a current role/entitlement pre-read.
import { NextResponse } from "next/server";
import { MerchantEnterpriseAccessError, requireMerchantEnterprisePasswordAuthentication, requireMerchantEnterpriseEntitlement,
  resolveValidatedMerchantEnterpriseAuthContext } from "@/lib/merchantEnterpriseAuth.server";
import { isCanonicalPortalRequest, resolveCanonicalPortalOrigin } from "@/lib/canonicalPortalRequest";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { createAttendanceSelfLimiter } from "@/lib/merchantAttendanceSelf.server";
import { createAttendanceAuditExportLimiter } from "@/lib/merchantAttendanceAuditExport.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { DELEGATED_AUDIT_REQUEST_BYTES, DELEGATED_AUDIT_RESULT_BYTES, parseDelegatedAuditJson, parseDelegatedAuditBody,
  parseDelegatedAuditHttpQuery, parseDelegatedAuditResult, buildDelegatedAuditCsv } from "@/lib/merchantAttendanceDelegatedAudit";
import { delegatedAuditSiteEnabled, executeDelegatedAudit } from "@/lib/merchantAttendanceDelegatedAudit.server";

export const delegatedAuditDependencies = { authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement,
  enabled: delegatedAuditSiteEnabled, allow: createAttendanceSelfLimiter(), allowExport: createAttendanceAuditExportLimiter(), execute: executeDelegatedAudit,
  timeoutMs: 12000, bodyTimeoutMs: 5000 };
const errors: Readonly<Record<string, readonly [number, string]>> = Object.freeze({
  attendance_invalid_request: [400, "请求内容不符合资源审计协议。"], attendance_access_denied: [403, "当前身份不能访问此审计范围。"],
  attendance_settings_required: [409, "请先完成考勤设置。"], attendance_delegated_audit_disabled: [403, "暂未开放委托资源审计。"],
  attendance_delegated_audit_invalid: [503, "暂时无法核实审计结果，请保留原编号。"], attendance_delegated_audit_too_large: [422, "审计扫描超出本次安全范围，请缩小时间范围。"],
  attendance_export_too_large: [413, "完整导出超出安全上限，请缩小时间范围。"], attendance_audit_not_found: [404, "未找到本授权范围可读取的完整记录。"],
  attendance_operation_conflict: [409, "该编号对应不同意图，请保留原编号核验。"], attendance_unavailable: [503, "暂时无法确认结果，请保留原编号核验。"],
  attendance_rate_limited: [429, "操作过于频繁，请稍后再试。"], attendance_invalid_content_type: [415, "请使用 UTF-8 JSON 请求。"],
  attendance_body_too_large: [413, "提交内容超出安全上限。"], method_not_allowed: [405, "此入口不支持该请求方法。"],
});
const responseHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie, Authorization, x-merchant-access-token, Accept" };
const fail = (code: string): never => { throw new MerchantAttendanceError(code); };
const reply = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: responseHeaders });
async function readBody(request: Request, check: () => void, signal: AbortSignal, timeoutMs: number) {
  if (!/^application\/json\s*(?:;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(request.headers.get("content-type")?.trim() ?? "")) fail("attendance_invalid_content_type");
  const length = request.headers.get("content-length"); if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > DELEGATED_AUDIT_REQUEST_BYTES)) fail("attendance_body_too_large");
  const reader = request.body?.getReader(); if (!reader) return fail("attendance_invalid_request");
  let stopped = false, reject!: (error: Error) => void; const interruption = new Promise<never>((_, r) => { reject = r; });
  const stop = () => { if (!stopped) { stopped = true; reject(new MerchantAttendanceError("attendance_invalid_request")); void reader.cancel().catch(() => {}); } };
  const timer = setTimeout(stop, timeoutMs); signal.addEventListener("abort", stop, { once: true });
  const consume = async () => {
    let bytes = 0, text = ""; const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    while (true) { check(); if (stopped || signal.aborted) return fail("attendance_invalid_request"); const chunk = await reader.read(); check();
      if (stopped || signal.aborted) return fail("attendance_invalid_request"); if (chunk.done) break;
      bytes += chunk.value.byteLength; if (bytes > DELEGATED_AUDIT_REQUEST_BYTES) fail("attendance_body_too_large"); text += decoder.decode(chunk.value, { stream: true }); }
    return parseDelegatedAuditBody(parseDelegatedAuditJson(text + decoder.decode()));
  };
  try { return await Promise.race([consume(), interruption]); }
  catch (error) { if (error instanceof MerchantAttendanceError && ["attendance_body_too_large", "attendance_unavailable"].includes(error.code)) throw error; return fail("attendance_invalid_request"); }
  finally { stopped = true; clearTimeout(timer); signal.removeEventListener("abort", stop); void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch { /* Cancelled parsing cannot dispatch. */ } }
}
export async function handleDelegatedAudit(request: Request, overrides: Partial<typeof delegatedAuditDependencies> = {}): Promise<Response> {
  const d = { ...delegatedAuditDependencies, ...overrides }, controller = new AbortController();
  let stopped = false, reject!: (error: Error) => void; const interruption = new Promise<never>((_, r) => { reject = r; });
  const deadline = performance.now() + d.timeoutMs, stop = () => { stopped = true; controller.abort(); reject(new MerchantAttendanceError("attendance_unavailable")); };
  const check = () => { if (stopped || request.signal.aborted || performance.now() >= deadline) fail("attendance_unavailable"); };
  const timer = setTimeout(stop, Math.max(1, Math.min(12000, d.timeoutMs))); request.signal.addEventListener("abort", stop, { once: true });
  const run = async () => {
    if (!Number.isInteger(d.timeoutMs) || d.timeoutMs < 1 || d.timeoutMs > 12000 || !Number.isInteger(d.bodyTimeoutMs) || d.bodyTimeoutMs < 1 || d.bodyTimeoutMs > 5000) fail("attendance_delegated_audit_invalid");
    if (request.method !== "GET" && request.method !== "POST") fail("method_not_allowed");
    if (!isCanonicalPortalRequest(request) || request.headers.get("origin") !== null && request.headers.get("origin") !== resolveCanonicalPortalOrigin()
      || ["same-site", "cross-site"].includes(request.headers.get("sec-fetch-site") ?? "") || !isTrustedSameOriginMutationRequest(request)) fail("attendance_access_denied");
    const accept = request.headers.get("accept")?.trim().toLowerCase() ?? "application/json";
    if (!["application/json", "*/*", "text/csv"].includes(accept) || accept === "text/csv" && request.method !== "POST") fail("attendance_invalid_request");
    const url = new URL(request.url);
    if (request.url.length > 32768 || request.url.includes("#") || request.method === "POST" && url.search) fail("attendance_invalid_request");
    try { decodeURIComponent(url.search.slice(1).replace(/\+/g, " ")); } catch { fail("attendance_invalid_request"); }
    check(); const auth = await d.authenticate(request); check(); requireMerchantEnterprisePasswordAuthentication(auth); const actor = auth.user.id;
    if (typeof actor !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(actor)) fail("attendance_access_denied");
    if (!d.allow(actor)) fail("attendance_rate_limited");
    const parsed = request.method === "POST" ? await readBody(request, check, controller.signal, d.bodyTimeoutMs) : null; check();
    const query = parsed?.query ?? parseDelegatedAuditHttpQuery(request.url), command = parsed?.command ?? null;
    if (command && !d.allowExport(actor)) fail("attendance_rate_limited");
    let allowAccess = false;
    //An off flag or entitlement failure still sends exact saved POST/minimal
    //GET recovery to SQL. No current owner/employee membership is guessed here.
    if (query.mode !== "recover" && d.enabled(query.siteId)) {
      try { allowAccess = attendanceModuleEnabled(await d.entitlement(query.siteId)); } catch { /* Fresh reads/exports fail closed, original number remains recoverable. */ } check();
    }
    const result = await d.execute({ query, command, authUserId: actor, allowAccess, signal: controller.signal }); check();
    const safe = await parseDelegatedAuditResult(result, query, actor, command); check();
    if (!allowAccess && safe.kind !== "receipt") fail("attendance_delegated_audit_invalid");
    if (accept === "text/csv" && safe.kind === "export") {
      if (query.mode !== "export" || command === null) return fail("attendance_delegated_audit_invalid");
      const out = await buildDelegatedAuditCsv(safe, query, actor, command); check(); const r = out.receipt;
      return new Response(out.csv, { status: 200, headers: { ...responseHeaders, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${out.filename}"`,
        "X-Attendance-Operation-Id": r.operationId, "X-Attendance-Actor-Id": r.actorId, "X-Attendance-Grant-Id": r.grantId,
        "X-Attendance-Command-Sha256": r.commandFingerprint, "X-Attendance-Result-Sha256": r.resultFingerprint,
        "X-Attendance-As-Of": r.asOf, "X-Attendance-Recorded-At": r.recordedAt, "X-Attendance-Result-Count": String(r.count) } });
    }
    //Even Accept:CSV cannot re-download a saved snapshot. Only its minimal
    //JSON receipt is returned, before any current-body permission is needed.
    const envelope = { ok: true, data: safe }; if (Buffer.byteLength(JSON.stringify(envelope), "utf8") > DELEGATED_AUDIT_RESULT_BYTES) fail("attendance_export_too_large");
    return reply(envelope);
  };
  try { check(); return await Promise.race([run(), interruption]); }
  catch (error) {
    const raw = error instanceof MerchantEnterpriseAccessError ? error.status === 503 ? "attendance_unavailable" : "attendance_access_denied"
      : error instanceof MerchantAttendanceError ? error.code : "attendance_delegated_audit_invalid";
    const code = Object.hasOwn(errors, raw) ? raw : "attendance_delegated_audit_invalid", [status, message] = errors[code]; return reply({ ok: false, error: { code, message } }, status);
  } finally { stopped = true; clearTimeout(timer); request.signal.removeEventListener("abort", stop); controller.abort(); }
}
