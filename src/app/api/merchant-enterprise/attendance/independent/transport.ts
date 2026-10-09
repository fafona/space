// New 196 endpoints only. No legacy route/body/permission behavior is changed.
import { NextResponse } from "next/server";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { INDEPENDENT_BODY_LIMIT, parseIndependentJson } from "@/lib/merchantAttendanceIndependent";
import { isCanonicalPortalRequest, resolveCanonicalPortalOrigin } from "@/lib/canonicalPortalRequest";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";

const errors: Readonly<Record<string, readonly [number, string]>> = Object.freeze({
  attendance_invalid_request: [400, "请求内容不符合独立考勤协议。"], attendance_access_denied: [403, "当前身份不能访问此考勤范围。"],
  attendance_terminal_denied: [403, "终端凭证不可用，请联系负责人核对。"], attendance_pin_invalid: [403, "凭证不可用，请重新输入或联系负责人。"],
  attendance_platform_paused: [403, "当前未开放新的独立考勤操作。"], attendance_independent_disabled: [403, "当前未开放新的独立考勤操作。"],
  attendance_rate_limited: [429, "操作过于频繁，请稍后再试。"], attendance_pin_busy: [429, "验证繁忙，请稍后明确重试。"],
  attendance_pin_unconfigured: [503, "暂时无法验证凭证，请联系负责人。"], attendance_independent_invalid: [503, "暂时无法确认结果，请保留原编号核验。"],
  attendance_unavailable: [503, "暂时无法确认结果，请保留原编号核验。"], attendance_body_too_large: [413, "提交内容超出安全上限。"],
  attendance_invalid_content_type: [415, "请使用 UTF-8 JSON 请求。"], attendance_independent_too_large: [422, "资料超出本次安全读取范围。"],
  attendance_independent_not_found: [404, "未找到当前身份可读取的独立考勤档案。"], attendance_settings_required: [409, "请先完成企业考勤设置。"],
  attendance_operation_conflict: [409, "原编号对应不同意图，请保留并核验原编号。"], attendance_independent_changed: [409, "资料已经变化，请核验原编号并重新读取。"],
  attendance_independent_identity_changed: [409, "保存的身份边界不一致，请交负责人核验。"], attendance_independent_bound: [409, "此档案已绑定会员，不能继续使用独立凭证。"],
  attendance_independent_unchanged: [409, "该状态已经生效，请读取原操作结果。"], attendance_employee_invalid: [409, "请选择本企业有效且尚未关联的员工。"],
  attendance_invalid_transition: [409, "此动作与当前打卡状态不符。"], attendance_location_denied: [409, "当前工作地点不可用。"],
  attendance_location_verification_required: [409, "此地点需要位置验证，不支持此终端凭证方式。"], attendance_not_employed: [409, "当前不在有效任职日期内。"],
  attendance_open_sessions: [409, "仍有未结束班次，请先由负责人核验。"], attendance_sequence_conflict: [409, "打卡序列已变化，请核验原编号并重新读取。"],
  attendance_time_reversed: [409, "服务器时间异常，不能视为已完成。"], method_not_allowed: [405, "此入口不支持该请求方式。"],
});
export function independentReply(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie, Authorization, x-merchant-access-token" } });
}
export function independentErrorReply(error: unknown) {
  const raw = error instanceof MerchantEnterpriseAccessError ? error.status === 503 ? "attendance_independent_invalid" : "attendance_access_denied" : error instanceof MerchantAttendanceError ? error.code : "attendance_independent_invalid";
  const code = Object.hasOwn(errors, raw) ? raw : "attendance_independent_invalid", [status, message] = errors[code];
  return independentReply({ ok: false, error: { code, message } }, status);
}
export function independentRequestOrigin(request: Request) {
  if (!isCanonicalPortalRequest(request) || request.headers.get("origin") !== null && request.headers.get("origin") !== resolveCanonicalPortalOrigin()
    || ["same-site", "cross-site"].includes(request.headers.get("sec-fetch-site") ?? "") || !isTrustedSameOriginMutationRequest(request)) throw new MerchantAttendanceError("attendance_access_denied");
}
export type IndependentTransportLimits = { timeoutMs: number; bodyTimeoutMs: number };
export async function independentDeadline(request: Request, limits: IndependentTransportLimits,
  run: (check: () => void, signal: AbortSignal) => Promise<Response>): Promise<Response> {
  let stopped = false, reject!: (error: Error) => void; const controller = new AbortController(), interruption = new Promise<never>((_, r) => { reject = r; });
  const deadline = performance.now() + limits.timeoutMs;
  const stop = () => { stopped = true; controller.abort(); reject(new MerchantAttendanceError("attendance_independent_invalid")); };
  const check = () => { if (stopped || request.signal.aborted || performance.now() >= deadline) throw new MerchantAttendanceError("attendance_independent_invalid"); };
  const timer = setTimeout(stop, Math.max(1, Math.min(12000, limits.timeoutMs))); request.signal.addEventListener("abort", stop, { once: true });
  try {
    if (!Number.isInteger(limits.timeoutMs) || limits.timeoutMs < 1 || limits.timeoutMs > 12000 || !Number.isInteger(limits.bodyTimeoutMs) || limits.bodyTimeoutMs < 1 || limits.bodyTimeoutMs > 5000) throw new MerchantAttendanceError("attendance_independent_invalid");
    check(); return await Promise.race([run(check, controller.signal), interruption]);
  } catch (error) { return independentErrorReply(error); }
  finally { stopped = true; clearTimeout(timer); request.signal.removeEventListener("abort", stop); controller.abort(); }
}
export async function readIndependentBody(request: Request, check: () => void, signal: AbortSignal, timeoutMs: number) {
  if (!/^application\/json\s*(?:;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(request.headers.get("content-type")?.trim() ?? "")) throw new MerchantAttendanceError("attendance_invalid_content_type");
  const length = request.headers.get("content-length");
  if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > INDEPENDENT_BODY_LIMIT)) throw new MerchantAttendanceError("attendance_body_too_large");
  const reader = request.body?.getReader(); if (!reader) throw new MerchantAttendanceError("attendance_invalid_request");
  let stopped = false, reject!: (error: Error) => void; const interruption = new Promise<never>((_, r) => { reject = r; });
  const stop = () => { if (!stopped) { stopped = true; reject(new MerchantAttendanceError("attendance_invalid_request")); void reader.cancel().catch(() => {}); } };
  const timer = setTimeout(stop, timeoutMs); signal.addEventListener("abort", stop, { once: true });
  const consume = async () => {
    let bytes = 0, text = ""; const decoder = new TextDecoder("utf-8", { fatal: true });
    while (true) { check(); if (stopped) throw new MerchantAttendanceError("attendance_invalid_request"); const chunk = await reader.read(); check();
      if (stopped) throw new MerchantAttendanceError("attendance_invalid_request"); if (chunk.done) break;
      bytes += chunk.value.byteLength; if (bytes > INDEPENDENT_BODY_LIMIT) throw new MerchantAttendanceError("attendance_body_too_large"); text += decoder.decode(chunk.value, { stream: true }); }
    return parseIndependentJson(text + decoder.decode(), true);
  };
  try { return await Promise.race([consume(), interruption]); }
  catch (error) { if (error instanceof MerchantAttendanceError) throw error; throw new MerchantAttendanceError("attendance_invalid_request"); }
  finally { stopped = true; clearTimeout(timer); signal.removeEventListener("abort", stop); void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch { /* cancelled pending read owns no business dispatch */ } }
}
