//202 foundation only; not a generic management executor. SQL separates current
//owner read/grant/revoke from original-actor minimum receipt recovery.
import { NextResponse } from "next/server";
import { MerchantEnterpriseAccessError, requireMerchantEnterprisePasswordAuthentication, requireMerchantEnterpriseEntitlement,
  resolveValidatedMerchantEnterpriseAuthContext } from "@/lib/merchantEnterpriseAuth.server";
import { isCanonicalPortalRequest, resolveCanonicalPortalOrigin } from "@/lib/canonicalPortalRequest";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { createAttendanceSelfLimiter } from "@/lib/merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { MANAGEMENT_DELEGATION_REQUEST_BYTES, MANAGEMENT_DELEGATION_RESULT_BYTES, parseManagementDelegationJson,
  parseManagementDelegationBody, parseManagementDelegationHttpQuery, parseManagementDelegationResult } from "@/lib/merchantAttendanceManagementDelegation";
import { managementDelegationSiteEnabled, executeManagementDelegation } from "@/lib/merchantAttendanceManagementDelegation.server";

export const managementDelegationDependencies = { authenticate: resolveValidatedMerchantEnterpriseAuthContext,
  entitlement: requireMerchantEnterpriseEntitlement, enabled: managementDelegationSiteEnabled,
  allow: createAttendanceSelfLimiter(), execute: executeManagementDelegation, timeoutMs: 12000, bodyTimeoutMs: 5000 };
const errors: Readonly<Record<string, readonly [number, string]>> = Object.freeze({
  attendance_invalid_request: [400, "请求内容不符合管理授权协议。"], attendance_access_denied: [403, "当前身份不能访问此管理授权范围。"],
  attendance_management_delegation_disabled: [403, "当前未开放新增管理授权。"],
  attendance_management_delegation_invalid: [503, "暂时无法核实管理授权结果，请保留原编号。"],
  attendance_management_delegation_not_found: [404, "未找到当前身份可读取的授权。"],
  attendance_management_delegation_scope_invalid: [409, "人员身份、角色能力或授权对象已变化，请重新核对。"],
  attendance_management_delegation_changed: [409, "授权状态已变化，请先核验原编号。"],
  attendance_management_delegation_limit: [422, "授权资料超出本次安全范围。"],
  attendance_operation_conflict: [409, "原编号对应不同意图，请保留原编号核验。"],
  attendance_settings_required: [409, "请先完成企业考勤设置。"], attendance_unavailable: [503, "暂时无法确认结果，请保留原编号核验。"],
  attendance_rate_limited: [429, "操作过于频繁，请稍后再试。"], attendance_invalid_content_type: [415, "请使用 UTF-8 JSON 请求。"],
  attendance_body_too_large: [413, "提交内容超出安全上限。"], method_not_allowed: [405, "此入口不支持该请求方式。"],
});
function fail(code: string): never { throw new MerchantAttendanceError(code); }
function reply(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie, Authorization, x-merchant-access-token" } });
}
async function readBody(request: Request, check: () => void, signal: AbortSignal, timeoutMs: number) {
  if (!/^application\/json\s*(?:;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(request.headers.get("content-type")?.trim() ?? "")) fail("attendance_invalid_content_type");
  const length = request.headers.get("content-length");
  if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > MANAGEMENT_DELEGATION_REQUEST_BYTES)) fail("attendance_body_too_large");
  const reader = request.body?.getReader(); if (!reader) fail("attendance_invalid_request");
  let stopped = false, reject!: (error: Error) => void;
  const interruption = new Promise<never>((_, r) => { reject = r; });
  const stop = () => { if (!stopped) { stopped = true; reject(new MerchantAttendanceError("attendance_invalid_request")); void reader.cancel().catch(() => {}); } };
  const timer = setTimeout(stop, timeoutMs); signal.addEventListener("abort", stop, { once: true });
  const consume = async () => {
    let bytes = 0, text = ""; const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    while (true) { check(); if (stopped || signal.aborted) fail("attendance_invalid_request"); const chunk = await reader.read(); check();
      if (stopped || signal.aborted) fail("attendance_invalid_request"); if (chunk.done) break;
      bytes += chunk.value.byteLength; if (bytes > MANAGEMENT_DELEGATION_REQUEST_BYTES) fail("attendance_body_too_large"); text += decoder.decode(chunk.value, { stream: true }); }
    return parseManagementDelegationBody(parseManagementDelegationJson(text + decoder.decode()));
  };
  try { return await Promise.race([consume(), interruption]); }
  catch (error) { if (error instanceof MerchantAttendanceError && ["attendance_body_too_large", "attendance_unavailable"].includes(error.code)) throw error;
    return fail("attendance_invalid_request"); }
  finally { stopped = true; clearTimeout(timer); signal.removeEventListener("abort", stop); void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* Cancelled parsing cannot dispatch. */ } }
}
export async function handleManagementDelegation(request: Request, overrides: Partial<typeof managementDelegationDependencies> = {}): Promise<Response> {
  const d = { ...managementDelegationDependencies, ...overrides }, controller = new AbortController();
  let stopped = false, reject!: (error: Error) => void; const interruption = new Promise<never>((_, r) => { reject = r; });
  const deadline = performance.now() + d.timeoutMs;
  const stop = () => { stopped = true; controller.abort(); reject(new MerchantAttendanceError("attendance_unavailable")); };
  const check = () => { if (stopped || request.signal.aborted || performance.now() >= deadline) fail("attendance_unavailable"); };
  const timer = setTimeout(stop, Math.max(1, Math.min(12000, d.timeoutMs))); request.signal.addEventListener("abort", stop, { once: true });
  const run = async () => {
    if (!Number.isInteger(d.timeoutMs) || d.timeoutMs < 1 || d.timeoutMs > 12000 || !Number.isInteger(d.bodyTimeoutMs) || d.bodyTimeoutMs < 1 || d.bodyTimeoutMs > 5000) fail("attendance_management_delegation_invalid");
    if (request.method !== "GET" && request.method !== "POST") fail("method_not_allowed");
    if (!isCanonicalPortalRequest(request) || request.headers.get("origin") !== null && request.headers.get("origin") !== resolveCanonicalPortalOrigin()
      || ["same-site", "cross-site"].includes(request.headers.get("sec-fetch-site") ?? "") || !isTrustedSameOriginMutationRequest(request)) fail("attendance_access_denied");
    const url = new URL(request.url);
    if (request.url.length > 32768 || request.url.includes("#") || request.method === "POST" && url.search) fail("attendance_invalid_request");
    try { decodeURIComponent(url.search.slice(1).replace(/\+/g, " ")); } catch { fail("attendance_invalid_request"); }
    check(); const auth = await d.authenticate(request); check(); requireMerchantEnterprisePasswordAuthentication(auth);
    const actor = auth.user.id;
    if (typeof actor !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(actor)) fail("attendance_access_denied");
    if (!d.allow(actor)) fail("attendance_rate_limited");
    const parsed = request.method === "POST" ? await readBody(request, check, controller.signal, d.bodyTimeoutMs) : null; check();
    const query = parsed?.query ?? parseManagementDelegationHttpQuery(request.url), command = parsed?.command ?? null;
    let allowGrant = false;
    //Do not gate minimum recovery or current-owner revocation on rollout,
    //membership or a browser-supplied permission. SQL checks these separately.
    if ((query.mode === "list" || query.mode === "detail" || command?.action === "grant") && d.enabled(query.siteId)) {
      try { allowGrant = attendanceModuleEnabled(await d.entitlement(query.siteId)); } catch { /* New grants fail closed; exact saved POST remains recoverable. */ } check();
    }
    const result = await d.execute({ query, command, authUserId: actor, allowGrant, signal: controller.signal }); check();
    const safe = await parseManagementDelegationResult(result, query, actor, command); check();
    if (!allowGrant && (safe.kind === "list" || safe.kind === "detail") && safe.canGrant) fail("attendance_management_delegation_invalid");
    const envelope = { ok: true, data: safe }; if (Buffer.byteLength(JSON.stringify(envelope), "utf8") > MANAGEMENT_DELEGATION_RESULT_BYTES) fail("attendance_management_delegation_limit");
    return reply(envelope);
  };
  try { check(); return await Promise.race([run(), interruption]); }
  catch (error) {
    const raw = error instanceof MerchantEnterpriseAccessError ? error.status === 503 ? "attendance_unavailable" : "attendance_access_denied"
      : error instanceof MerchantAttendanceError ? error.code : "attendance_management_delegation_invalid";
    const code = Object.hasOwn(errors, raw) ? raw : "attendance_management_delegation_invalid", [status, message] = errors[code];
    return reply({ ok: false, error: { code, message } }, status);
  } finally { stopped = true; clearTimeout(timer); request.signal.removeEventListener("abort", stop); controller.abort(); }
}
