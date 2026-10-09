// 195: no active-employee/self.view pre-gate. SQL validates saved self identity;
// password Auth, same-origin and bounded transport still apply to every path.
import { NextResponse } from "next/server";
import { MerchantEnterpriseAccessError, requireMerchantEnterprisePasswordAuthentication, requireMerchantEnterpriseEntitlement, resolveValidatedMerchantEnterpriseAuthContext } from "@/lib/merchantEnterpriseAuth.server";
import { isCanonicalPortalRequest, resolveCanonicalPortalOrigin } from "@/lib/canonicalPortalRequest";
import { isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { attendanceModuleEnabled } from "@/lib/merchantAttendanceEntitlement";
import { createAttendanceSelfLimiter } from "@/lib/merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { ADMINISTRATIVE_CLOSURE_BODY_LIMIT, ADMINISTRATIVE_CLOSURE_ERRORS, parseAdministrativeClosureJson, parseAdministrativeClosureBody,
  parseAdministrativeClosureHttpQuery, parseAdministrativeClosureResponse } from "@/lib/merchantAttendanceAdministrativeClosure";
import { executeAdministrativeClosure, administrativeClosureEnabled } from "@/lib/merchantAttendanceAdministrativeClosure.server";

export const administrativeClosureDependencies = { authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement,
  enabled: administrativeClosureEnabled, allow: createAttendanceSelfLimiter(), execute: executeAdministrativeClosure, timeoutMs: 12000, bodyTimeoutMs: 5000 };
const messages: Record<keyof typeof ADMINISTRATIVE_CLOSURE_ERRORS, string> = {
  attendance_invalid_request: "请求内容不符合行政结案协议。", attendance_access_denied: "请使用有权查看此记录的本人密码账户。",
  attendance_operation_conflict: "原编号对应不同意图，请保留并核验原编号。", attendance_period_sealed: "相关周期已封存，不能改变该边界。",
  attendance_administrative_closure_invalid: "暂时无法核实结果，请保留原编号。", attendance_administrative_closure_changed: "当前资料已变化，请核验原编号并重新读取。",
  attendance_administrative_closure_blocked: "当前存在阻止行政结案的条件。", attendance_administrative_closure_disabled: "当前未开放新的行政结案。",
  attendance_administrative_closure_not_found: "未找到当前身份可读取的记录。", attendance_administrative_closure_too_large: "资料超出本次有界读取范围。",
};
function error(code: keyof typeof ADMINISTRATIVE_CLOSURE_ERRORS): never { throw new MerchantAttendanceError(code); }
async function body(request: Request, check: () => void, timeoutMs: number, setCancel: (cancel: (() => void) | null) => void) {
  if (!/^application\/json\s*(?:;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(request.headers.get("content-type")?.trim() ?? "")) error("attendance_invalid_request");
  const length = request.headers.get("content-length");
  if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > ADMINISTRATIVE_CLOSURE_BODY_LIMIT)) error("attendance_administrative_closure_too_large");
  const reader = request.body?.getReader(); if (!reader) error("attendance_invalid_request");
  let stopped = false, reject!: (e: Error) => void;
  const interruption = new Promise<never>((_, r) => { reject = r; });
  const cancel = () => { if (!stopped) { stopped = true; reject(new MerchantAttendanceError("attendance_invalid_request")); void reader.cancel().catch(() => {}); } };
  const timer = setTimeout(cancel, timeoutMs); setCancel(cancel);
  const consume = async () => { let bytes = 0, text = ""; const decoder = new TextDecoder("utf-8", { fatal: true });
    while (true) { check(); if (stopped) error("attendance_invalid_request"); const part = await reader.read(); check(); if (stopped) error("attendance_invalid_request"); if (part.done) break;
      bytes += part.value.byteLength; if (bytes > ADMINISTRATIVE_CLOSURE_BODY_LIMIT) error("attendance_administrative_closure_too_large"); text += decoder.decode(part.value, { stream: true }); }
    return parseAdministrativeClosureJson(text + decoder.decode(), true); };
  try { return await Promise.race([consume(), interruption]); }
  catch (e) { if (e instanceof MerchantAttendanceError) throw e; return error("attendance_invalid_request"); }
  finally { stopped = true; clearTimeout(timer); setCancel(null); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function handleAdministrativeClosure(request: Request, overrides: Partial<typeof administrativeClosureDependencies> = {}) {
  const deps = { ...administrativeClosureDependencies, ...overrides };
  const reply = (value: unknown, status: number) => NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie, Authorization, x-merchant-access-token" } });
  let stopped = false, reject!: (e: Error) => void, cancelBody: (() => void) | null = null;
  const interruption = new Promise<never>((_, r) => { reject = r; });
  const deadline = performance.now() + deps.timeoutMs;
  const stop = () => { stopped = true; reject(new MerchantAttendanceError("attendance_administrative_closure_invalid")); cancelBody?.(); };
  const timer = setTimeout(stop, Math.max(1, Math.min(12000, deps.timeoutMs))); request.signal.addEventListener("abort", stop, { once: true });
  const check = () => { if (stopped || request.signal.aborted || performance.now() >= deadline) error("attendance_administrative_closure_invalid"); };
  const run = async () => {
    if (!Number.isInteger(deps.timeoutMs) || deps.timeoutMs < 1 || deps.timeoutMs > 12000 || !Number.isInteger(deps.bodyTimeoutMs) || deps.bodyTimeoutMs < 1 || deps.bodyTimeoutMs > 5000) error("attendance_administrative_closure_invalid");
    if (!["GET", "POST"].includes(request.method)) error("attendance_invalid_request");
    if (!isCanonicalPortalRequest(request) || request.headers.get("origin") !== null && request.headers.get("origin") !== resolveCanonicalPortalOrigin()
      || ["same-site", "cross-site"].includes(request.headers.get("sec-fetch-site") ?? "") || !isTrustedSameOriginMutationRequest(request)) error("attendance_access_denied");
    check(); const auth = await deps.authenticate(request); check(); requireMerchantEnterprisePasswordAuthentication(auth);
    const actor = auth.user.id;
    if (typeof actor !== "string" || actor.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(actor) || !deps.allow(actor)) error("attendance_access_denied");
    if (request.method === "POST" && new URL(request.url).search) error("attendance_invalid_request");
    const parsed = request.method === "POST" ? parseAdministrativeClosureBody(await body(request, check, deps.bodyTimeoutMs, c => { cancelBody = c; })) : null; check();
    const query = parsed?.query ?? parseAdministrativeClosureHttpQuery(request.url), command = parsed?.command ?? null;
    let allowClose = false;
    // Metadata/candidate reads remain SQL-authorized even with the close flag
    // disabled. Eligibility only grants the ability to create a new boundary.
    if (query.access === "owner" && query.mode === "candidate" && deps.enabled(query.siteId)) {
      try { allowClose = attendanceModuleEnabled(await deps.entitlement(query.siteId)); } catch { /* Fail closed for new closure, retain safe access. */ } check();
    }
    const result = await deps.execute({ query, command, authUserId: actor, allowClose }); check();
    const value = { ok: true, data: result }; await parseAdministrativeClosureResponse(value, query, actor, command); check(); return reply(value, 200);
  };
  try { return await Promise.race([run(), interruption]); }
  catch (e) { const code = e instanceof MerchantEnterpriseAccessError ? e.status === 503 ? "attendance_administrative_closure_invalid" : "attendance_access_denied" : e instanceof MerchantAttendanceError ? e.code : "attendance_administrative_closure_invalid";
    const known = Object.hasOwn(ADMINISTRATIVE_CLOSURE_ERRORS, code) ? code as keyof typeof ADMINISTRATIVE_CLOSURE_ERRORS : "attendance_administrative_closure_invalid";
    return reply({ ok: false, error: { code: known, message: messages[known] } }, ADMINISTRATIVE_CLOSURE_ERRORS[known]);
  } finally { stopped = true; clearTimeout(timer); request.signal.removeEventListener("abort", stop); }
}
