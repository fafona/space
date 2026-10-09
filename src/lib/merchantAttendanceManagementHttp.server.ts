// Additive HTTP boundary for scoped management executors (204/205).
// The separate 202/203 handlers retain their established export/rate contracts.
import { NextResponse } from "next/server";
import { MerchantEnterpriseAccessError, requireMerchantEnterprisePasswordAuthentication, requireMerchantEnterpriseEntitlement, resolveValidatedMerchantEnterpriseAuthContext } from "./merchantEnterpriseAuth.server";
import { isCanonicalPortalRequest, resolveCanonicalPortalOrigin } from "./canonicalPortalRequest";
import { isTrustedSameOriginMutationRequest } from "./requestMutationGuard";
import { attendanceModuleEnabled } from "./merchantAttendanceEntitlement";
import { createAttendanceSelfLimiter } from "./merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

type Query = Readonly<{ siteId: string; mode: string }>;
type Input<Q, C> = Readonly<{ query: Q; command: C | null; authUserId: string; allowed: boolean; signal: AbortSignal }>;
export type AttendanceManagementHttpAdapter<Q extends Query, C, R> = Readonly<{
  errors: Readonly<Record<string, number>>; invalidCode: string; requestBytes: number; resultBytes: number;
  parseQuery: (url: string) => Q; parseBody: (text: string) => Readonly<{ query: Q; command: C }>;
  enabled: (siteId: string) => boolean; execute: (input: Input<Q, C>) => Promise<R>;
  project: (raw: unknown, query: Q, actor: string, command: C | null) => Promise<R>;
}>;
export function attendanceManagementHttpDependencies<Q extends Query, C, R>(adapter: AttendanceManagementHttpAdapter<Q, C, R>) {
  return { authenticate: resolveValidatedMerchantEnterpriseAuthContext, entitlement: requireMerchantEnterpriseEntitlement,
    allow: createAttendanceSelfLimiter(), enabled: adapter.enabled, execute: adapter.execute, timeoutMs: 12000, bodyTimeoutMs: 5000 };
}
function fail(code: string): never { throw new MerchantAttendanceError(code); }
async function readJson(request: Request, maximum: number, timeoutMs: number, check: () => void, setCancel: (value: (() => void) | null) => void) {
  if (!/^application\/json\s*(?:;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(request.headers.get("content-type")?.trim() ?? "")) fail("attendance_invalid_content_type");
  const length = request.headers.get("content-length");
  if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > maximum)) fail("attendance_body_too_large");
  const reader = request.body?.getReader(); if (!reader) fail("attendance_invalid_request");
  let stopped = false, reject!: (error: Error) => void;
  const interrupted = new Promise<never>((_, r) => { reject = r; });
  const cancel = () => { if (!stopped) { stopped = true; reject(new MerchantAttendanceError("attendance_invalid_request")); void reader.cancel().catch(() => {}); } };
  const timer = setTimeout(cancel, timeoutMs); setCancel(cancel);
  const consume = async () => {
    let bytes = 0, text = ""; const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    while (true) {
      check(); if (stopped) fail("attendance_invalid_request");
      const part = await reader.read(); check(); if (stopped) fail("attendance_invalid_request"); if (part.done) break;
      bytes += part.value.byteLength; if (bytes > maximum) fail("attendance_body_too_large");
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
  };
  const consuming = consume(), release = () => { try { reader.releaseLock(); } catch { /* Preserve the original failure. */ } };
  try { return await Promise.race([consuming, interrupted]); }
  catch (error) { if (error instanceof MerchantAttendanceError) throw error; return fail("attendance_invalid_request"); }
  finally { stopped = true; clearTimeout(timer); setCancel(null); void reader.cancel().catch(() => {}); release(); void consuming.then(release, release); }
}
export async function handleAttendanceManagementHttp<Q extends Query, C, R>(request: Request, adapter: AttendanceManagementHttpAdapter<Q, C, R>,
  defaults: ReturnType<typeof attendanceManagementHttpDependencies<Q, C, R>>, overrides: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...overrides }, errors: Readonly<Record<string, number>> = { ...adapter.errors, attendance_rate_limited: 429,
    attendance_invalid_content_type: 415, attendance_body_too_large: 413, method_not_allowed: 405 };
  const reply = (value: unknown, status: number) => NextResponse.json(value, { status, headers: {
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie, Authorization, x-merchant-access-token",
  } });
  let stopped = false, reject!: (error: Error) => void, cancelBody: (() => void) | null = null;
  const work = new AbortController(), interrupted = new Promise<never>((_, r) => { reject = r; }), deadline = performance.now() + deps.timeoutMs;
  const stop = () => { if (!stopped) { stopped = true; work.abort(); reject(new MerchantAttendanceError(adapter.invalidCode)); cancelBody?.(); } };
  const timer = setTimeout(stop, Math.max(1, Math.min(12000, deps.timeoutMs))); request.signal.addEventListener("abort", stop, { once: true });
  const check = () => { if (stopped || request.signal.aborted || performance.now() >= deadline) { work.abort(); fail(adapter.invalidCode); } };
  const run = async () => {
    if (!Number.isInteger(deps.timeoutMs) || deps.timeoutMs < 1 || deps.timeoutMs > 12000
      || !Number.isInteger(deps.bodyTimeoutMs) || deps.bodyTimeoutMs < 1 || deps.bodyTimeoutMs > 5000) fail(adapter.invalidCode);
    if (request.method !== "GET" && request.method !== "POST") fail("method_not_allowed");
    if (!isCanonicalPortalRequest(request) || request.headers.get("origin") !== null && request.headers.get("origin") !== resolveCanonicalPortalOrigin()
      || ["same-site", "cross-site"].includes(request.headers.get("sec-fetch-site") ?? "") || !isTrustedSameOriginMutationRequest(request)) fail("attendance_access_denied");
    check(); const auth = await deps.authenticate(request); check(); requireMerchantEnterprisePasswordAuthentication(auth); const actor = auth.user.id;
    if (typeof actor !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(actor)) fail("attendance_access_denied");
    if (!deps.allow(actor)) fail("attendance_rate_limited");
    const url = new URL(request.url); if (request.url.length > 32768 || request.url.includes("#")) fail("attendance_invalid_request");
    try { decodeURIComponent(url.search.slice(1).replace(/\+/g, " ")); } catch { fail("attendance_invalid_request"); }
    if (request.method === "POST" && url.search) fail("attendance_invalid_request");
    const body = request.method === "POST" ? adapter.parseBody(await readJson(request, adapter.requestBytes, deps.bodyTimeoutMs, check, value => { cancelBody = value; })) : null;
    check(); const query = body?.query ?? adapter.parseQuery(request.url), command = body?.command ?? null;
    let allowed = false;
    // Original-actor recovery remains independent of new-write/current-access
    // rollout and entitlements. Current reads still receive their proper gate.
    if (query.mode !== "recover" && deps.enabled(query.siteId)) {
      try { allowed = attendanceModuleEnabled(await deps.entitlement(query.siteId)); } catch { /* Fail closed; do not remove old receipt access. */ } check();
    }
    const data = await deps.execute({ query, command, authUserId: actor, allowed, signal: work.signal }); check();
    const projected = await adapter.project(data, query, actor, command); check(); const value = { ok: true, data: projected };
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > adapter.resultBytes) fail(adapter.invalidCode);
    return reply(value, 200);
  };
  try { return await Promise.race([run(), interrupted]); }
  catch (error) {
    const code = error instanceof MerchantEnterpriseAccessError ? error.status === 503 ? adapter.invalidCode : "attendance_access_denied"
      : error instanceof MerchantAttendanceError ? error.code : adapter.invalidCode;
    const known = Object.hasOwn(errors, code) ? code : adapter.invalidCode;
    return reply({ ok: false, error: { code: known, message: known === "attendance_access_denied" ? "当前账号无权执行此操作。" : "暂时无法核实结果，请保留原操作编号再核对。" } }, errors[known]);
  } finally { stopped = true; work.abort(); clearTimeout(timer); request.signal.removeEventListener("abort", stop); }
}
