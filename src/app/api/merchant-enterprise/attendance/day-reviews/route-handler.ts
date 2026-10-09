//199 only: SQL owns current scope and original-actor minimal recovery. There is
//no current employee/owner pre-gate and no browser-supplied source authority.
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { MerchantEnterpriseAccessError, requireMerchantEnterprisePasswordAuthentication, requireMerchantEnterpriseEntitlement,
  resolveValidatedMerchantEnterpriseAuthContext } from "@/lib/merchantEnterpriseAuth.server";
import { isCanonicalPortalRequest, resolveCanonicalPortalOrigin } from "@/lib/canonicalPortalRequest";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { createAttendanceSelfLimiter } from "@/lib/merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { DAY_REVIEW_REQUEST_LIMIT, DAY_REVIEW_RESPONSE_LIMIT, parseDayReviewJson, parseDayReviewBody, parseDayReviewHttpQuery,
  dayReviewCommandFingerprintText } from "@/lib/merchantAttendanceDayReviewContract";
import { parseDayReviewSavedResult } from "@/lib/merchantAttendanceDayReviewResult";
import { parseDayReviewSourceView } from "@/lib/merchantAttendanceDayReviewSource";
import { dayReviewsSiteEnabled, executeDayReviews } from "@/lib/merchantAttendanceDayReview.server";

export const dayReviewDependencies = { authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement,
  enabled: dayReviewsSiteEnabled, allow: createAttendanceSelfLimiter(), execute: executeDayReviews, timeoutMs: 12000, bodyTimeoutMs: 5000 };
const errors: Readonly<Record<string, readonly [number, string]>> = {
  attendance_invalid_request: [400, "请求内容不符合出勤核查协议。"], attendance_access_denied: [403, "当前身份不能访问此核查范围。"],
  attendance_module_disabled: [403, "当前未开放新的出勤核查决定。"], attendance_paused: [403, "当前暂停新的出勤核查决定。"],
  attendance_rate_limited: [429, "操作过于频繁，请稍后再试。"], attendance_operation_not_found: [404, "暂未查到原操作，保留原编号并交负责人核验。"],
  attendance_day_review_not_found: [404, "未找到当前身份可读取的核查记录。"], attendance_invalid_content_type: [415, "请使用 UTF-8 JSON 请求。"],
  attendance_body_too_large: [413, "提交内容超出安全上限。"], attendance_day_review_too_large: [422, "完整资料超出本次读取范围，不能视为没有记录。"],
  attendance_operation_conflict: [409, "原编号对应不同意图，请保留原编号核验。"], attendance_worker_changed: [409, "人员资料已变化，请保留原编号重新核验。"],
  attendance_day_review_identity_changed: [409, "保存的人员身份边界不一致，请交负责人核验。"],
  attendance_day_review_source_changed: [409, "来源已变化，请核验原编号后重新读取。"], attendance_day_review_head_changed: [409, "核查版本已变化，请核验原编号后重新读取。"],
  attendance_day_review_ineligible: [409, "当前来源不满足此决定条件，请继续核查。"],
  attendance_unavailable: [503, "暂时无法确认结果，请保留原编号核验。"], attendance_day_review_invalid: [503, "暂时无法核实完整资料，请保留原编号。"],
  method_not_allowed: [405, "此入口不支持该请求方式。"],
};
function fail(code: string): never { throw new MerchantAttendanceError(code); }
function reply(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie, Authorization, x-merchant-access-token" } });
}
async function readBody(request: Request, check: () => void, signal: AbortSignal, timeoutMs: number) {
  if (!/^application\/json\s*(?:;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(request.headers.get("content-type")?.trim() ?? "")) fail("attendance_invalid_content_type");
  const length = request.headers.get("content-length");
  if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > DAY_REVIEW_REQUEST_LIMIT)) fail("attendance_body_too_large");
  const reader = request.body?.getReader(); if (!reader) fail("attendance_invalid_request");
  let stopped = false, reject!: (error: Error) => void;
  const interruption = new Promise<never>((_, r) => { reject = r; });
  const stop = () => { if (!stopped) { stopped = true; reject(new MerchantAttendanceError("attendance_invalid_request")); void reader.cancel().catch(() => {}); } };
  const timer = setTimeout(stop, timeoutMs); signal.addEventListener("abort", stop, { once: true });
  const consume = async () => {
    let bytes = 0, text = ""; const decoder = new TextDecoder("utf-8", { fatal: true });
    while (true) { check(); if (stopped || signal.aborted) fail("attendance_invalid_request"); const chunk = await reader.read(); check();
      if (stopped || signal.aborted) fail("attendance_invalid_request"); if (chunk.done) break;
      bytes += chunk.value.byteLength; if (bytes > DAY_REVIEW_REQUEST_LIMIT) fail("attendance_body_too_large"); text += decoder.decode(chunk.value, { stream: true }); }
    return parseDayReviewBody(parseDayReviewJson(text + decoder.decode()));
  };
  try { return await Promise.race([consume(), interruption]); }
  catch (error) { if (error instanceof MerchantAttendanceError && ["attendance_body_too_large", "attendance_unavailable"].includes(error.code)) throw error;
    return fail("attendance_invalid_request"); }
  finally { stopped = true; clearTimeout(timer); signal.removeEventListener("abort", stop); void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* A cancelled read has no dispatch authority. */ } }
}
export async function handleDayReviews(request: Request, overrides: Partial<typeof dayReviewDependencies> = {}): Promise<Response> {
  const d = { ...dayReviewDependencies, ...overrides }, controller = new AbortController();
  let stopped = false, reject!: (error: Error) => void; const interruption = new Promise<never>((_, r) => { reject = r; });
  const deadline = performance.now() + d.timeoutMs;
  const stop = () => { stopped = true; controller.abort(); reject(new MerchantAttendanceError("attendance_unavailable")); };
  const check = () => { if (stopped || request.signal.aborted || performance.now() >= deadline) fail("attendance_unavailable"); };
  const timer = setTimeout(stop, Math.max(1, Math.min(12000, d.timeoutMs))); request.signal.addEventListener("abort", stop, { once: true });
  const run = async () => {
    if (!Number.isInteger(d.timeoutMs) || d.timeoutMs < 1 || d.timeoutMs > 12000 || !Number.isInteger(d.bodyTimeoutMs) || d.bodyTimeoutMs < 1 || d.bodyTimeoutMs > 5000) fail("attendance_day_review_invalid");
    if (request.method !== "GET" && request.method !== "POST") fail("method_not_allowed");
    if (!isCanonicalPortalRequest(request) || request.headers.get("origin") !== null && request.headers.get("origin") !== resolveCanonicalPortalOrigin()
      || ["same-site", "cross-site"].includes(request.headers.get("sec-fetch-site") ?? "") || !isTrustedSameOriginMutationRequest(request)) fail("attendance_access_denied");
    if (request.method === "POST" && new URL(request.url).search) fail("attendance_invalid_request");
    check(); const auth = await d.authenticate(request); check(); requireMerchantEnterprisePasswordAuthentication(auth);
    const actor = auth.user.id;
    if (typeof actor !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(actor)) fail("attendance_access_denied");
    if (!d.allow(actor)) fail("attendance_rate_limited");
    const parsed = request.method === "POST" ? await readBody(request, check, controller.signal, d.bodyTimeoutMs) : null; check();
    let query;
    try { query = parsed?.query ?? parseDayReviewHttpQuery(request.url); } catch { return fail("attendance_invalid_request"); }
    const command = parsed?.command ?? null; let moduleEnabled = false;
    if (command?.action === "decide" && d.enabled(query.siteId)) {
      try { moduleEnabled = attendanceModuleEnabled(await d.entitlement(query.siteId)); } catch { /* SQL first recovers an exact saved operation even when new decisions are off. */ } check();
    }
    const result = await d.execute({ query, command, authUserId: actor, moduleEnabled, signal: controller.signal }); check();
    const safe = command === null && (query.mode === "candidates" || query.mode === "preview") ? parseDayReviewSourceView(result, query, actor)
      : parseDayReviewSavedResult(result, query, actor, command === null ? null : { command,
        fingerprint: createHash("sha256").update(dayReviewCommandFingerprintText(query, actor, command), "utf8").digest("hex") });
    const envelope = { ok: true, data: safe }; if (Buffer.byteLength(JSON.stringify(envelope), "utf8") > DAY_REVIEW_RESPONSE_LIMIT) fail("attendance_day_review_too_large");
    check(); return reply(envelope);
  };
  try { check(); return await Promise.race([run(), interruption]); }
  catch (error) {
    const raw = error instanceof MerchantEnterpriseAccessError ? error.status === 503 ? "attendance_unavailable" : "attendance_access_denied"
      : error instanceof MerchantAttendanceError ? error.code : "attendance_day_review_invalid";
    const code = Object.hasOwn(errors, raw) ? raw : "attendance_day_review_invalid", [status, message] = errors[code];
    return reply({ ok: false, error: { code, message } }, status);
  } finally { stopped = true; clearTimeout(timer); request.signal.removeEventListener("abort", stop); controller.abort(); }
}
